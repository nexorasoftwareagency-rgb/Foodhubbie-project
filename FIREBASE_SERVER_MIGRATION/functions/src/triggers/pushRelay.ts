/**
 * Push relay (batch 23e) — the three push paths that until now only existed
 * inside the EC2 WhatsApp worker:
 *
 *   1. `onOrderPushAdmin`    new order            -> admin devices
 *   2. `onOrderPushCustomer` order status changed -> customer inbox + FCM
 *   3. `onLoyaltyTierUp`     tier actually rose   -> customer inbox + FCM
 *
 * Why: the box has been offline since 2026-11-11. Orders placed in the customer
 * app are still accepted, but the customer gets no status push and no in-app
 * inbox row, and nobody is alerted to a new order. These three paths are pure
 * Admin SDK + FCM — no socket, no pm2 — so they belong in the cloud.
 *
 * ## The one switch (never double-send)
 *
 * `config/pushRelay/enabled === true` means the Functions own the sends; when it
 * is that value `bot/index.js` returns early from all three senders
 * (`isPushRelayEnabled`). Every other state — absent, false, unreadable — means
 * the bot keeps its old behaviour and every trigger here is a no-op. Only an
 * explicit `true` enables either side, so a failed flag read can never make
 * both senders fire for the same event.
 *
 * ## Idempotency
 *
 *   - admin alert: the bot's own `orders/{id}/_fcmSent` claim, taken with a
 *     transaction before the multicast. Both senders respect the same flag, so
 *     a flag flip or a retried invocation cannot page twice.
 *   - customer status: the inbox key `{orderId}_{status}` is the dedupe key,
 *     exactly as the bot's own check was.
 *   - tier-up: only a real rank increase fires, and the inbox key is derived
 *     from `tierReachedAt`, so an event replay cannot duplicate it.
 *
 * ## Deliberate deviations from the bot (documented in doc 33)
 *
 *   - The customer trigger listens on `.../orders/{orderId}/status`, not the
 *     whole order node: a payment mirror or a KOT stamp can no longer invoke a
 *     sender at all (the bot only avoided the send, after a cap read).
 *   - The inbox-exists check runs BEFORE the cap, so a duplicate event cannot
 *     spend a transactional slot for a push that will not go out.
 *   - The tier-up inbox key is `tier_{tier}_{tierReachedAt}` instead of
 *     `tier_{tier}_{Date.now()}` (the bot's key was not replay-safe).
 *
 * The demo tenant is hard-skipped: the nightly reseed writes ~353 orders, and
 * the admin alert matches every `isSuper`, so those fake orders would otherwise
 * page the owner's real device 353 times a night.
 */

import * as path from 'path';
import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, getMessaging } from '../shared/firebase/admin';
import { checkAndConsumeCap, isDeadPushCode } from '../shared/notify/caps';
import { formatOrderId } from '../shared/utils';

/* eslint-disable @typescript-eslint/no-var-requires */
const { prunePushInbox } = require(path.join(__dirname, '../vendor/shared/push-inbox.cjs'));
/* eslint-enable @typescript-eslint/no-var-requires */

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/pushRelay/enabled';
// Same host the bot builds customer links from (bot/index.js WEBVIEW_DELIVERY_HOST).
const MENU_ORIGIN = (process.env.WEBVIEW_DELIVERY_HOST || 'https://menu.foodhubbie.in').replace(
  /\/$/,
  '',
);

const BASE_OPTS = {
  region: 'us-central1',
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  secrets: ['FIREBASE_DATABASE_URL'],
};

/** Only an explicit `true` turns the relay on. A read failure means "off". */
async function relayEnabled(): Promise<boolean> {
  try {
    const snap = await getDB().ref(RELAY_FLAG).once('value');
    return snap.val() === true;
  } catch (err) {
    logger.warn('[PushRelay] relay flag unreadable - staying off', {
      error: (err as Error).message,
    });
    return false;
  }
}

// ---- customer copy: mirrors CUSTOMER_APP_STATUS in bot/index.js ------------
const STATUS_COPY: Record<string, { title: string; body: string }> = {
  placed: { title: 'Order received', body: 'We received your order and will confirm it shortly.' },
  confirmed: { title: 'Order confirmed', body: 'The kitchen is preparing your order.' },
  preparing: { title: 'Order is being prepared', body: 'Your food is on the stove.' },
  ready: { title: 'Order is ready', body: 'Your order is packed and waiting for the rider.' },
  packed: { title: 'Order is packed', body: 'Your order is packed and waiting for the rider.' },
  'picked up': { title: 'Order picked up', body: 'Your rider has picked up the order.' },
  'out for delivery': {
    title: 'Out for delivery',
    body: 'Your rider is on the way. Share the delivery OTP when they arrive.',
  },
  'reached drop location': {
    title: 'Rider has arrived',
    body: 'Your rider is at your location. Share the delivery OTP to receive your order.',
  },
  delivered: { title: 'Delivered', body: 'Enjoy your meal! Thank you for ordering.' },
  served: { title: 'Order collected', body: 'Thank you for ordering!' },
  cancelled: {
    title: 'Order cancelled',
    body: 'Your order was cancelled. Contact the restaurant if this looks wrong.',
  },
};

/** Pickup has no rider, so its ready/collected copy differs (bot parity). */
function appStatusCopy(
  statusLower: string,
  order: any,
): { title: string; body: string } | undefined {
  if (order && order.type === 'Pickup') {
    if (statusLower === 'ready') {
      return { title: 'Ready for pickup', body: 'Your order is ready. Please collect it at the counter.' };
    }
    if (statusLower === 'served') {
      return { title: 'Order collected', body: 'Thank you for ordering!' };
    }
  }
  return STATUS_COPY[statusLower];
}

/** Last 10 digits if it is a valid Indian mobile, else '' (bot parity). */
function customerAppPhone(order: any): string {
  const digits = String((order && order.phone) || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(last10) ? last10 : '';
}

function isDineInOrder(order: any): boolean {
  return !!order && (order.type === 'dine-in' || order.isDineIn || !!order.tableId);
}

interface SubEntry {
  key: string;
  token: string;
  /** Order-status pushes respect this; loyalty does not (bot parity). */
  orderUpdates: boolean;
}

/** This phone's device subscriptions at one outlet, one read. */
async function customerSubscriptions(bid: string, oid: string, phone: string): Promise<SubEntry[]> {
  const snap = await getDB()
    .ref(`businesses/${bid}/outlets/${oid}/pushSubscriptions`)
    .once('value');
  const subs = snap.val() || {};
  return Object.entries(subs)
    .filter(([, sub]: any) => sub && sub.token && String(sub.phone || '') === phone)
    .map(([key, sub]: any) => ({
      key,
      token: String(sub.token),
      orderUpdates: !sub.prefs || sub.prefs.orderUpdates !== false,
    }));
}

/** Remove subscriptions whose token FCM has permanently rejected. */
async function pruneDeadSubscriptions(
  bid: string,
  oid: string,
  entries: SubEntry[],
  responses: any[],
): Promise<void> {
  await Promise.all(
    responses.map(async (r, i) => {
      if (r && r.success) return;
      if (!isDeadPushCode(r && r.error && r.error.code)) return;
      const entry = entries[i];
      if (!entry) return;
      await getDB()
        .ref(`businesses/${bid}/outlets/${oid}/pushSubscriptions/${entry.key}`)
        .remove()
        .catch(() => {});
    }),
  );
}

// ---------------------------------------------------------------------------
// 1. New order -> admin devices  (mirrors sendFCMToAdmins)
// ---------------------------------------------------------------------------

export const onOrderPushAdmin = onValueCreated(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const orderRef = getDB().ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`);
    const order = (await orderRef.once('value')).val();
    if (!order) return;

    // The bot's own claim, shared by both senders. Taken BEFORE the multicast so
    // a crash can lose one alert but can never page twice.
    const claimRef = orderRef.child('_fcmSent');
    if ((await claimRef.once('value')).val() === true) return;
    const claim = await claimRef.transaction((cur: boolean | null) =>
      cur === true ? undefined : true,
    );
    if (!claim.committed) return;

    const outlet = String(order.outlet || oid);
    const admins = (await getDB().ref('admins').once('value')).val() || {};
    const entries = Object.entries(admins)
      .filter(([, a]: any) => !!a && !!a.fcmToken)
      .filter(
        ([, a]: any) =>
          a.isSuper === true ||
          a.isSupreme === true ||
          !a.outlet ||
          String(a.outlet) === outlet,
      )
      .map(([uid, a]: any) => ({ uid, token: String(a.fcmToken) }));
    if (entries.length === 0) return;

    // Two admin records can share a device token; keep one uid for cleanup.
    const seen = new Map<string, string>();
    for (const e of entries) if (!seen.has(e.token)) seen.set(e.token, e.uid);
    const unique = [...seen.keys()];

    const title = `🆕 New Order #${formatOrderId(order.orderId || orderId)}`;
    const itemCount = Array.isArray(order.items)
      ? order.items.length
      : order.items
        ? Object.keys(order.items).length
        : 0;
    const where = order.tableNo ? `Table ${order.tableNo}` : order.type || outlet.toUpperCase();
    const body = `${order.customerName || 'Customer'} · ${
      itemCount ? `${itemCount} items · ` : ''
    }₹${order.total || 0} · ${where} · ${outlet.toUpperCase()}`;

    let image = '';
    try {
      const store = (
        await getDB().ref(`businesses/${bid}/outlets/${oid}/settings/Store`).once('value')
      ).val();
      image = store?.bannerImage || store?.greetingImage || '';
    } catch {
      /* image is optional */
    }

    try {
      const results = await getMessaging().sendEachForMulticast({
        tokens: unique,
        // Data-only on purpose: Admin/sw.js runs onBackgroundMessage, and a
        // `notification` payload would make the SDK auto-display its own
        // untagged popup AND call our handler -> two stacked popups.
        data: { orderId, outlet, type: 'new_order', title, body, image },
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high' } },
      });

      const failed = results.responses.filter((r) => !r.success).length;
      if (failed > 0) {
        logger.warn(`[PushRelay] ${failed}/${unique.length} admin notifications failed`);
        await Promise.all(
          results.responses.map(async (r, i) => {
            if (r.success) return;
            const token = unique[i];
            const uid = seen.get(token);
            const code = (r.error as any)?.code || 'unknown';
            logger.warn(`[PushRelay] Admin token failed (uid=${uid})`, { code });
            if (isDeadPushCode(code) && uid) {
              try {
                await getDB().ref(`admins/${uid}/fcmToken`).remove();
                await getDB().ref(`admins/${uid}/fcmTokenInvalidAt`).set(Date.now());
              } catch (cleanupErr) {
                logger.error('[PushRelay] Token cleanup failed', {
                  uid,
                  error: (cleanupErr as Error).message,
                });
              }
            }
          }),
        );
      }

      // A token that just succeeded is alive again: clear the stale failure stamp.
      const recovered = unique.filter(
        (token, i) =>
          results.responses[i]?.success && (admins as any)[seen.get(token)!]?.fcmTokenInvalidAt,
      );
      await Promise.all(
        recovered.map((token) =>
          getDB()
            .ref(`admins/${seen.get(token)}/fcmTokenInvalidAt`)
            .remove()
            .catch(() => {}),
        ),
      );
    } catch (e) {
      logger.error('[PushRelay] sendFCMToAdmins error', { error: (e as Error).message });
    }
  },
);

// ---------------------------------------------------------------------------
// 2. Order status -> customer inbox + FCM  (mirrors notifyCustomerApp)
// ---------------------------------------------------------------------------

export const onOrderPushCustomer = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const statusAfter = String(event.data.after.val() || '').toLowerCase();
    const statusBefore = String(event.data.before.val() || '').toLowerCase();
    // Creation counts (before is null); a rewrite of the same status does not.
    if (!statusAfter || (event.data.before.exists() && statusAfter === statusBefore)) return;

    const order = (await getDB()
      .ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`)
      .once('value')).val();
    if (!order) return;
    if (isDineInOrder(order)) return;

    const copy = appStatusCopy(statusAfter, order);
    const phone = customerAppPhone(order);
    if (!copy || !phone) return;

    const sendable = (await customerSubscriptions(bid, oid, phone)).filter((e) => e.orderUpdates);
    if (sendable.length === 0) return;

    const displayId = formatOrderId(order.orderId || orderId);
    const rawOrderId = String(order.orderId || orderId);
    const statusKey = statusAfter.replace(/[^a-z0-9]+/g, '-');
    const inboxRef = getDB().ref(
      `businesses/${bid}/outlets/${oid}/pushInbox/${phone}/${rawOrderId.replace(
        /[^A-Za-z0-9_-]/g,
        '',
      )}_${statusKey}`,
    );

    // The inbox row IS the dedupe marker. Checked before the cap so a duplicate
    // event cannot spend a transactional slot for a push that will not go out.
    if ((await inboxRef.once('value')).exists()) return;

    const cap = await checkAndConsumeCap(bid, oid, phone, 'order');
    if (!cap.allowed) {
      logger.info('[PushRelay] order push suppressed', { oid, phone, reason: cap.reason });
      return;
    }

    // Restaurant-app customers land back in the app's Orders tab; delivery.html
    // is only for WhatsApp-bot links (bot parity).
    const url =
      order.source === 'APP'
        ? `${MENU_ORIGIN}/?b=${bid}&o=${oid}&tab=orders`
        : `${MENU_ORIGIN}/${oid}/delivery.html?b=${bid}&o=${oid}&order=${encodeURIComponent(
            rawOrderId,
          )}&tab=notifications`;
    const title = `Order #${displayId} - ${copy.title}`;

    try {
      await inboxRef.set({
        title,
        body: copy.body,
        type: 'order',
        orderId: rawOrderId,
        status: statusAfter,
        sentAt: Date.now(),
        url,
      });
      await prunePushInbox(getDB().ref(`businesses/${bid}/outlets/${oid}/pushInbox/${phone}`));

      const response = await getMessaging().sendEachForMulticast({
        tokens: sendable.map((e) => e.token),
        data: {
          title,
          body: copy.body,
          type: 'order',
          orderId: rawOrderId,
          status: statusAfter,
          url,
          outlet: oid,
          business: bid,
        },
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: url } },
      });
      await pruneDeadSubscriptions(bid, oid, sendable, response.responses);
    } catch (e) {
      logger.error('[PushRelay] notifyCustomerApp error', { error: (e as Error).message });
    }
  },
);

// ---------------------------------------------------------------------------
// 3. Loyalty tier up -> customer inbox + FCM  (mirrors notifyTierUp)
// ---------------------------------------------------------------------------

const TIER_RANK: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };

export const onLoyaltyTierUp = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/customers/{phone}/loyalty' },
  async (event) => {
    const { bid, oid, phone } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const after = event.data.after.val();
    const before = event.data.before.val();
    if (!after) return;

    const newTier = String(after.tier || '').toLowerCase();
    const oldTier = String((before && before.tier) || 'bronze').toLowerCase();
    if (newTier === oldTier) return;
    // Only a real promotion pushes: a clawback can move points (and the tier)
    // down, and "you're now Bronze" is not news anyone wants.
    if (!(TIER_RANK[newTier] > TIER_RANK[oldTier])) return;

    const label = newTier === 'gold' ? 'Gold' : newTier === 'silver' ? 'Silver' : '';
    if (!label || !/^[6-9]\d{9}$/.test(phone)) return;

    // Tier news is loyalty-adjacent, so it honours the loyalty cap and does NOT
    // check `prefs.orderUpdates` (bot parity: loyalty has its own cap).
    const entries = await customerSubscriptions(bid, oid, phone);
    if (entries.length === 0) return;

    // Deterministic per tier-reached event, so an event replay cannot duplicate.
    const stamp = Number(after.tierReachedAt) || Date.now();
    const inboxRef = getDB().ref(
      `businesses/${bid}/outlets/${oid}/pushInbox/${phone}/tier_${newTier}_${stamp}`,
    );
    if ((await inboxRef.once('value')).exists()) return;

    const cap = await checkAndConsumeCap(bid, oid, phone, 'loyalty');
    if (!cap.allowed) {
      logger.info('[PushRelay] tier-up push suppressed', { oid, phone, reason: cap.reason });
      return;
    }

    const title = `🎉 You're now ${label}`;
    const body = `Loyalty tier reached: ${label} earns ${
      newTier === 'gold' ? '1.5×' : '1.25×'
    } points on every order from now on.`;
    // App-profile customers land on the app's Loyalty tab; WhatsApp-only
    // customers keep the delivery page link (bot parity).
    const appProfile = await getDB()
      .ref(`businesses/${bid}/outlets/${oid}/customers/${phone}/app/name`)
      .once('value')
      .catch(() => null);
    const url =
      appProfile && appProfile.exists()
        ? `${MENU_ORIGIN}/?b=${bid}&o=${oid}&tab=loyalty`
        : `${MENU_ORIGIN}/${oid}/delivery.html?b=${bid}&o=${oid}&tab=account`;

    try {
      await inboxRef.set({
        title,
        body,
        type: 'loyalty',
        status: newTier,
        sentAt: Date.now(),
        url,
      });
      await prunePushInbox(getDB().ref(`businesses/${bid}/outlets/${oid}/pushInbox/${phone}`));

      const response = await getMessaging().sendEachForMulticast({
        tokens: entries.map((e) => e.token),
        data: { title, body, type: 'loyalty', tier: newTier, url, outlet: oid, business: bid },
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: url } },
      });
      await pruneDeadSubscriptions(bid, oid, entries, response.responses);
      logger.info(`[PushRelay] tier-up push ${oldTier} -> ${newTier}`, { oid, phone });
    } catch (e) {
      logger.error('[PushRelay] notifyTierUp error', { error: (e as Error).message });
    }
  },
);
