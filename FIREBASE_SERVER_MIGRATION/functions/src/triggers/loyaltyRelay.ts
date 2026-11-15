/**
 * Loyalty relay (batch 23g) — the three loyalty writes that until now only
 * existed inside the EC2 WhatsApp worker:
 *
 *   1. `onOrderLoyaltyStatus`   order status changed        -> accrue / claw back
 *   2. `onOrderLoyaltyPayment`  order paymentStatus changed -> dine-in settle / void
 *   3. `onRedeemRequest`        app reward redemption       -> deduct points, mint code
 *
 * Why: the box has been offline since 2026-11-11. A delivered app order earns
 * no points, a cancelled one keeps them, a settled table bill never credits the
 * guest, and a reward redeemed in the app sits in `bot/redeemQueue` forever.
 * All three paths are pure Admin SDK — no socket — so they belong in the cloud.
 *
 * ## The one switch (never double-write)
 *
 * `config/loyaltyRelay/enabled === true` means the Functions own loyalty; when it
 * is that value `bot/index.js` stops calling `processLoyalty` and does not start
 * its redemption listener (`isLoyaltyRelayEnabled`, 30 s in-process cache).
 * Every other state — absent, false, unreadable — means the bot keeps its old
 * behaviour and every trigger here is a no-op. Only an explicit `true` enables
 * either side, so a failed flag read can never make both writers act.
 *
 * A flip race is also safe because both writers share the engine's own
 * idempotency: `loyalty/accruals/{orderId}` + the `lastAccruedOrderId`
 * transaction guard (earn), the deleted accrual record + `lastClawedOrderId`
 * (clawback), and the `bot/redeemClaims/{key}` claim (redemption).
 *
 * ## Deliberate deviations from the bot
 *
 *   - The triggers listen on the `status` / `paymentStatus` LEAVES, not the
 *     whole order: a stock stamp, a rider field or `_fcmSent` cannot invoke the
 *     engine at all. Each leaf also short-circuits on values that can never
 *     matter, so a normal order costs ~2 invocations instead of one per write.
 *   - The demo tenant is hard-skipped: `foodhubbie-demo` is a public sandbox
 *     whose 353 seeded orders would otherwise farm loyalty for fake customers.
 *   - The tier-up push is NOT sent from here — `onLoyaltyTierUp` (batch 23e)
 *     already watches `customers/{phone}/loyalty` and fires from the write.
 *
 * ## Honest limits
 *
 *   - RTDB triggers do not replay events missed while a function was failing or
 *     being deployed. An order that reaches Delivered during a cold deploy
 *     would need its status re-written to earn. (The bot had the same gap.)
 *   - The redemption trigger holds the request in `bot/redeemQueue` until a
 *     winner removes it; a rejected request leaves a `rejected` reward node as
 *     its audit trail, exactly like the bot.
 */

import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { makeLoyaltyEngine } from '../shared/loyalty/factory';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/loyaltyRelay/enabled';

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
    logger.warn('[LoyaltyRelay] relay flag unreadable - staying off', {
      error: (err as Error).message,
    });
    return false;
  }
}

/** Statuses the engine can act on. Anything else is a cheap early return. */
const ACTIONABLE_STATUS = new Set(['delivered', 'served', 'cancelled', 'refunded', 'canceled']);
/** paymentStatus values the dine-in path can act on. */
const ACTIONABLE_PAYMENT = new Set(['paid', 'unpaid']);

async function readOrder(bid: string, oid: string, orderId: string): Promise<any> {
  const snap = await getDB()
    .ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`)
    .once('value');
  return snap.val();
}

async function runEngine(bid: string, oid: string, orderId: string, order: any, why: string) {
  const { engine } = makeLoyaltyEngine(bid, oid);
  await engine.processLoyalty(orderId, order);
  logger.info('[LoyaltyRelay] processed', { bid, oid, orderId, why });
}

export const onOrderLoyaltyStatus = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    const status = String(event.data.after.val() || '').toLowerCase();
    if (!ACTIONABLE_STATUS.has(status)) return;

    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const order = await readOrder(bid, oid, orderId);
    if (!order) return;
    await runEngine(bid, oid, orderId, order, `status:${status}`);
  },
);

export const onOrderLoyaltyPayment = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/paymentStatus' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    const payment = String(event.data.after.val() || '').toLowerCase();
    if (!ACTIONABLE_PAYMENT.has(payment)) return;

    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const order = await readOrder(bid, oid, orderId);
    if (!order) return;
    // Only a dine-in order changes anything on a payment flip (delivery earns
    // from its Delivered status); skip the engine run for everything else.
    const { engine } = makeLoyaltyEngine(bid, oid);
    if (!engine.isDineIn(order)) return;
    await engine.processLoyalty(orderId, order);
    logger.info('[LoyaltyRelay] processed', { bid, oid, orderId, why: `payment:${payment}` });
  },
);

export const onRedeemRequest = onValueCreated(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/bot/redeemQueue/{reqId}' },
  async (event) => {
    const { bid, oid, reqId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    const request = event.data.val();
    if (!request) return;

    await initializeAdmin();
    if (!(await relayEnabled())) return;

    const { db, resolvePath, redeem } = makeLoyaltyEngine(bid, oid);
    const result = await redeem.redeemRewardRequest({
      db,
      resolvePath,
      OUTLET: oid,
      key: String(reqId),
      req: request,
      owner: 'cloud',
    });
    logger.info('[LoyaltyRelay] redemption request handled', { bid, oid, reqId, result });
  },
);
