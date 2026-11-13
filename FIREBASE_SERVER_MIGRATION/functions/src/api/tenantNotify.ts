/**
 * Push notification endpoint (batch 23d-2) — the second control-API route to
 * leave EC2.
 *
 * `POST /tenant-api/notify` is a pure cloud operation: verify the caller's ID
 * token, resolve the tenant from `admins/{uid}`, read that outlet's
 * `pushSubscriptions`, honour offers consent / quiet hours / daily caps, write
 * the in-app inbox and send the FCM multicast. No pm2, no socket, no bot.
 *
 * Contract is byte-compatible with `bot-control-api/server.js`: same body,
 * same response keys, same error strings, same caps (`bot/notification-caps.js`)
 * and same inbox/log rules. The tenant always comes from the VERIFIED token.
 *
 * Wiring: `config/notifyUrl` in RTDB points the Admin dashboard here. The client
 * falls back to `config/tunnelUrl` when it is absent, so deleting this function
 * changes nothing.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import path from 'path';
import { initializeAdmin, getDB, getMessaging } from '../shared/firebase/admin';
import { HttpError, readJsonBody, routeOf, tenantFromToken } from '../shared/http/tenant';

// CJS shared module, vendored byte-for-byte by scripts/copy-vendor.cjs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prunePushInbox } = require(path.join(__dirname, '../vendor/shared/push-inbox.cjs'));

const MAX_BODY_BYTES = 100 * 1024;
const HISTORY_ROWS = 20;

const DASHBOARD_ORIGINS: Array<string | RegExp> = [
  'https://foodhubbie-admins.web.app',
  'https://foodhubbie-supremeadmin.web.app',
  'https://app.foodhubbie.in',
  'https://control.foodhubbie.in',
  'https://rider.foodhubbie.in',
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

// ---- mirror of bot/notification-caps.js (guard pins equality) --------------
const IST_OFFSET_MS = 5 * 3600000 + 30 * 60000;
const CAPS: Record<string, number> = { order: 50, loyalty: 5, promo: 3 };

function istBucketKey(ts = Date.now()): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isQuietHours(ts = Date.now()): boolean {
  const h = new Date(ts + IST_OFFSET_MS).getUTCHours();
  return h >= 21 || h < 9;
}

async function checkAndConsumeCap(
  bid: string,
  oid: string,
  phone: string,
  type: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) return { allowed: true };
  if ((type === 'promo' || type === 'offer') && isQuietHours()) {
    return { allowed: false, reason: 'quiet_hours' };
  }
  const cap = CAPS[type] ?? CAPS.order;
  const bucket = istBucketKey();
  const capRef = getDB().ref(`businesses/${bid}/outlets/${oid}/notifyCaps/${phone}/${type}/${bucket}`);
  try {
    const current = Number((await capRef.get()).val() || 0);
    if (current >= cap) return { allowed: false, reason: 'daily_cap' };
    await capRef.set(current + 1);
    return { allowed: true };
  } catch (e) {
    // Never block notifications on cap-store failure.
    logger.warn('[Notify] cap check failed', { error: (e as Error).message });
    return { allowed: true };
  }
}

async function logNotifySend(bid: string, oid: string, row: any): Promise<void> {
  try {
    const base = getDB().ref(`businesses/${bid}/outlets/${oid}/notifyLog`);
    await base.push().set(row);
    const snap = await base.get();
    const keys = Object.keys(snap.val() || {}).sort();
    if (keys.length > HISTORY_ROWS) {
      const updates: Record<string, null> = {};
      for (const k of keys.slice(0, keys.length - HISTORY_ROWS)) updates[k] = null;
      await base.update(updates);
    }
  } catch (e) {
    logger.warn('[Notify] history write failed', { error: (e as Error).message });
  }
}

async function handleNotify(req: any, res: any): Promise<void> {
  const { bid, oid, uid } = await tenantFromToken(req);
  const body = await readJsonBody(req, MAX_BODY_BYTES, 'Payload too large (max 100 KB)');
  const { title, body: text, data = {}, testMode, audience, phone, type } = body || {};

  if (!title || !text) throw new HttpError(400, 'title and body are required');
  if (String(title).length > 100 || String(text).length > 300) {
    throw new HttpError(400, 'title or body is too long');
  }

  const cleanPhone = String(phone || '').replace(/[^\d]/g, '').slice(-10);
  if (audience === 'phone' && !/^[6-9]\d{9}$/.test(cleanPhone)) {
    throw new HttpError(400, 'A valid phone is required for this audience');
  }
  const messageType = String(type || 'promo').slice(0, 20);
  const isTest = testMode === true || testMode === 'true' || data.testMode === 'true';
  const d = data || {};

  const historyRow = (sent: number, failed: number, inbox: number, total: number) => ({
    at: Date.now(),
    type: messageType,
    audience: isTest ? 'test' : (audience === 'phone' ? 'phone' : 'all'),
    ...(cleanPhone && audience === 'phone' && !isTest ? { phone: cleanPhone } : {}),
    title: String(title).slice(0, 100),
    sent, failed, inbox, total,
    test: isTest,
    by: uid,
  });

  const db = getDB();
  const subs = (await db.ref(`businesses/${bid}/outlets/${oid}/pushSubscriptions`).get()).val() || {};
  let entries: any[] = Object.entries(subs).map(([key, sub]: any) => ({ key, ...sub }));

  if (audience === 'phone') {
    entries = entries.filter((e) => String(e.phone || '') === cleanPhone);
  }
  // Promotional sends honour the customer's offers preference. Existing records
  // created before consent existed are treated as opted in.
  if (messageType !== 'order') {
    entries = entries.filter((e) => !e.prefs || e.prefs.offers === true);
  }
  if (isTest) {
    const own = (await db.ref(`admins/${uid}/fcmToken`).get()).val();
    entries = own ? [{ key: 'test', token: own, phone: null }] : [];
  }

  const notifyType = messageType === 'order' ? 'order' : 'promo';
  const capped: any[] = [];
  for (const entry of entries) {
    const phoneStr = String(entry.phone || '');
    if (!phoneStr || !/^[6-9]\d{9}$/.test(phoneStr)) {
      capped.push(entry);
      continue;
    }
    const cap = await checkAndConsumeCap(bid, oid, phoneStr, notifyType);
    if (cap.allowed) capped.push(entry);
    else logger.info(`[Notify] suppressed for ${phoneStr}: ${cap.reason}`);
  }
  entries = capped;

  const tokens = entries.map((e) => e.token).filter(Boolean);
  if (tokens.length === 0) {
    await logNotifySend(bid, oid, historyRow(0, 0, 0, 0));
    res.json({ ok: true, sent: 0, inbox: 0, message: 'No subscribers for this outlet' });
    return;
  }

  const menuOrigin = (process.env.MENU_WEB_ORIGIN || 'https://menu.foodhubbie.in').replace(/\/$/, '');
  const link = `${menuOrigin}/${encodeURIComponent(oid)}/delivery.html?o=${encodeURIComponent(oid)}&b=${encodeURIComponent(bid)}&tab=notifications`;

  // In-app inbox entry per subscribed phone, independent of FCM delivery.
  const phoneSet = new Set(
    entries.map((e) => String(e.phone || '')).filter((p) => /^[6-9]\d{9}$/.test(p)),
  );
  let inboxCount = 0;
  if (!isTest) {
    for (const customerPhone of phoneSet) {
      try {
        const phoneInboxRef = db.ref(`businesses/${bid}/outlets/${oid}/pushInbox/${customerPhone}`);
        await phoneInboxRef.push({
          title: String(title).slice(0, 100),
          body: String(text).slice(0, 300),
          type: messageType,
          sentAt: Date.now(),
          ...(d.orderId ? { orderId: String(d.orderId).slice(0, 100) } : {}),
          ...(d.status ? { status: String(d.status).slice(0, 40) } : {}),
          url: link,
        });
        await prunePushInbox(phoneInboxRef);
        inboxCount += 1;
      } catch (e) {
        logger.warn('[Notify] inbox write failed', { error: (e as Error).message });
      }
    }
  }

  // FCM data values must be flat strings.
  const flat = Object.fromEntries(
    Object.entries({ title, body: text, ...d, type: messageType, url: link, outlet: oid, business: bid })
      .map(([k, v]) => [k, String(v)]),
  );

  const response = await getMessaging().sendEachForMulticast({
    tokens,
    data: flat,
    android: { priority: 'high' },
    apns: { payload: { aps: { 'content-available': 1 } } },
    webpush: { fcmOptions: { link } },
  });
  const successCount = response.responses.filter((r) => r.success).length;
  const failureCount = response.responses.length - successCount;

  if (failureCount > 0) {
    const deadCodes = new Set([
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
      'messaging/invalid-registration-token',
    ]);
    await Promise.all(
      response.responses.map(async (r, i) => {
        if (r.success) return;
        const token = tokens[i];
        const entry = entries.find((e) => e.token === token);
        const code = (r.error as any)?.code || 'unknown';
        logger.warn(`[Notify] FCM failed for ${String(token).slice(0, 12)}...`, { code });
        if (deadCodes.has(code) && entry && entry.key !== 'test') {
          await db.ref(`businesses/${bid}/outlets/${oid}/pushSubscriptions/${entry.key}`).remove().catch(() => {});
        }
      }),
    );
  }

  await logNotifySend(bid, oid, historyRow(successCount, failureCount, inboxCount, tokens.length));
  res.json({ ok: true, sent: successCount, failed: failureCount, total: tokens.length, inbox: inboxCount });
}

export const tenantNotify = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    cpu: 1,
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 20,
    ingressSettings: 'ALLOW_ALL',
    cors: DASHBOARD_ORIGINS,
    secrets: ['FIREBASE_DATABASE_URL'],
    labels: { 'critical-path': 'true' },
  },
  async (req, res) => {
    const route = routeOf(req, 'tenantNotify');
    res.set('Cache-Control', 'no-store');
    try {
      if (route === '/health' && req.method === 'GET') {
        res.json({ ok: true, service: 'tenant-notify' });
        return;
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      await initializeAdmin();
      if (route === '/tenant-api/notify') {
        await handleNotify(req, res);
        return;
      }
      throw new HttpError(404, `Unknown route ${route}`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) {
        logger.error('[Notify] request failed', { route, method: req.method, error: (err as Error).message });
        res.status(500).json({ error: `Notification send failed - ${(err as Error).message}` });
        return;
      }
      res.status(status).json({ error: (err as Error).message });
    }
  },
);
