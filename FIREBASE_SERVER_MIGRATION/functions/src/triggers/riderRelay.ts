/**
 * Rider push relay (batch 23h) — the two rider FCM sends that used to live
 * inside the EC2 WhatsApp worker's `orders` child_changed listener:
 *
 *   1. `onRiderAssigned`  orders/{id}/riderId written  -> "New Order Assigned!"
 *   2. `onRiderStatus`    orders/{id}/status written   -> "ready for pickup" / "cancelled"
 *
 * Why: the box has been offline since 2026-11-11. A rider app user could be
 * assigned an order and never be told, and a rider waiting for pickup heard
 * nothing. Both paths are pure Admin SDK + FCM — no socket, no pm2 — so they
 * belong in the cloud.
 *
 * ## The one switch (never double-send)
 *
 * `config/riderRelay/enabled === true` means the Functions own these pushes;
 * `bot/index.js` then returns early from its rider branch (`isRiderRelayEnabled`,
 * 30 s cache). Every other state — absent, false, unreadable — means the bot
 * keeps its old behaviour and both triggers are no-ops. Only an explicit `true`
 * enables either side, so a failed flag read can never make both senders fire.
 *
 * ## Idempotency
 *
 * The bot kept its "already pushed" state in memory (`orderState`), so a process
 * restart lost it and every replay pushed again. Here the marker is durable on
 * the order node:
 *
 *   - `_riderFcm/assigned` = `{ rider, at, by }` — transaction claims only when
 *     the recorded rider differs from the one in this event.
 *   - `_riderFcm/status`   = `{ status, at, by }` — transaction claims only when
 *     the recorded status differs from the one in this event.
 *   - `_riderFcm/last`     = the outcome of the most recent push (uid, sent,
 *     reason). Support-facing: "did the rider actually get told?" — and the
 *     only way to prove on a live device that an email resolved to a UID.
 *
 * A lost claim is a silent no-op; a send failure is logged, never retried (the
 * bot never retried either, and a duplicated "your order is ready" is worse
 * than a missed one).
 *
 * ## Deliberate deviations from the bot (recorded in doc 36)
 *
 *   - The triggers listen on the `riderId` / `status` LEAVES, not the whole
 *     order node, so `_fcmSent` / `finalizeClaim` / stock stamps cannot wake a
 *     rider sender at all.
 *   - An order created already carrying a rider now pushes (the bot's
 *     `child_added` only recorded it).
 *   - A WhatsApp JID in `riderId` is skipped instead of being used as an RTDB
 *     key (it contains `.`, so the bot threw and logged on every such order).
 *
 * The demo tenant is hard-skipped: the nightly reseed writes ~353 fake orders
 * with seeded riders, and none of it should reach a device.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { makeRiderPush, riderStatusEvent } from '../shared/rider/factory';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/riderRelay/enabled';

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
    logger.warn('[RiderRelay] relay flag unreadable - staying off', {
      error: (err as Error).message,
    });
    return false;
  }
}

function orderBase(bid: string, oid: string, orderId: string): string {
  return `businesses/${bid}/outlets/${oid}/orders/${orderId}`;
}

/** Record what actually happened, best-effort — never fail the push for it. */
async function recordOutcome(
  orderRefPath: string,
  event: string,
  result: any,
): Promise<void> {
  await getDB()
    .ref(`${orderRefPath}/_riderFcm/last`)
    .set({
      event,
      uid: result.uid || '',
      sent: result.sent === true,
      reason: result.reason || (result.sent ? 'sent' : 'unknown'),
      at: Date.now(),
      by: 'cloud',
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 1. Rider assigned -> push  (mirrors the bot's assignment branch)
// ---------------------------------------------------------------------------

export const onRiderAssigned = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/riderId' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const riderId = String(event.data.after.val() || '');
    if (!riderId) return; // unassigned: nobody to tell
    if (event.data.before.exists() && String(event.data.before.val()) === riderId) return;

    const base = orderBase(bid, oid, orderId);
    const order = (await getDB().ref(base).once('value')).val();
    if (!order) return;

    const claim = await getDB()
      .ref(`${base}/_riderFcm/assigned`)
      .transaction((cur: any) =>
        cur && cur.rider === riderId ? undefined : { rider: riderId, at: Date.now(), by: 'cloud' },
      );
    if (!claim.committed) return;

    const result = await makeRiderPush(bid, oid).push({
      orderId,
      order,
      outlet: oid,
      event: 'assigned',
    });
    await recordOutcome(base, 'assigned', result);
    logger.info('[RiderRelay] assigned push', { oid, orderId, sent: result.sent, reason: result.reason });
  },
);

// ---------------------------------------------------------------------------
// 2. Order status -> rider push  (ready / packed / cooked / cancelled)
// ---------------------------------------------------------------------------

export const onRiderStatus = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const statusAfter = String(event.data.after.val() || '');
    const statusBefore = String(event.data.before.val() || '');
    if (!statusAfter) return;
    if (event.data.before.exists() && statusAfter === statusBefore) return;

    const kind = riderStatusEvent(statusAfter);
    if (!kind) return;

    const base = orderBase(bid, oid, orderId);
    const order = (await getDB().ref(base).once('value')).val();
    if (!order || !order.riderId) return;

    const claim = await getDB()
      .ref(`${base}/_riderFcm/status`)
      .transaction((cur: any) =>
        cur && cur.status === statusAfter
          ? undefined
          : { status: statusAfter, at: Date.now(), by: 'cloud' },
      );
    if (!claim.committed) return;

    const result = await makeRiderPush(bid, oid).push({
      orderId,
      order,
      outlet: oid,
      event: kind,
      status: statusAfter,
    });
    await recordOutcome(base, kind, result);
    logger.info('[RiderRelay] status push', {
      oid,
      orderId,
      status: statusAfter,
      sent: result.sent,
      reason: result.reason,
    });
  },
);
