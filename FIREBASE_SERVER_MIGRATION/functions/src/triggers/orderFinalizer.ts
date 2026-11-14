/**
 * Web/app order finalizer — REAL MODE (batch 23f).
 *
 * `menu/js/delivery.js` and `menu/js/app-checkout.js` write orders straight to
 * Firebase from the customer's browser, so every money field on them is a claim.
 * `bot/order-finalizer.js` is the server's answer: re-price the lines from the
 * catalog, re-derive tax + delivery fee from the outlet's settings, re-run the
 * discount, burn a claimed reward code, deduct stock, mirror the customer
 * profile and record discount usage. Batch 23c proved that module agrees with
 * the bot on live orders (shadow compare). This file makes it the real writer.
 *
 * Two triggers:
 *
 *   1. `onWebOrderPlaced` — on order creation, claim the shared finalization
 *      lock (`orders/{id}/finalizeClaim`, TTL 5 min, inside the module) and run
 *      the pipeline. A replay, a bot catch-up or a second invocation loses the
 *      claim and returns without touching money or stock.
 *   2. `onOrderCancelledCompensate` — on a real status change to
 *      cancelled/refunded, give back exactly what finalization took: the
 *      reward code it burned (`usedOnOrder`-guarded), the discount usage
 *      (`discountUsageReversed`) and the stock (`inventoryDeducted` →
 *      `stockRestored`). Every inner operation carries its own at-most-once
 *      claim, so this trigger needs none.
 *
 * ## The one switch
 *
 * `config/orderFinalizer/enabled === true` means the Functions own order
 * finalization; when it is that value `bot/index.js` stands down
 * (`isOrderFinalizerRelayEnabled`) for finalize AND for both compensations.
 * Every other state — absent, false, unreadable — leaves the bot in charge and
 * makes both triggers no-ops. Only an explicit `true` enables either side.
 *
 * ## Deviations from the bot (documented in doc 34)
 *
 *   - The cancel trigger listens on `.../orders/{orderId}/status`, not the whole
 *     order node, so a payment mirror or a KOT stamp cannot invoke it.
 *   - The demo tenant is hard-skipped: the nightly reseed writes hundreds of
 *     orders and the demo is a public sandbox, not a shop.
 *   - The WhatsApp "NEW ORDER" text cannot move (socket-only). While the flag
 *     is on the bot sends it itself from `alertAdminFinalizedWebOrder`, keyed on
 *     `_adminWaNotified`, once the finalized order is visible — so it carries
 *     the corrected total, never the customer's claim.
 */

import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import {
  makeOrderFinalizer,
  isDineInOrder,
  WEB_ORDER_SOURCES,
} from '../shared/order-finalizer/factory';

initializeAdmin().catch((err: Error) => {
  logger.error('[OrderFinalizer] Admin init failed', { error: err.message });
});

const FINALIZER_FLAG = 'config/orderFinalizer/enabled';
const DEMO_BUSINESS_ID = 'foodhubbie-demo';

const BASE_OPTS = {
  region: 'us-central1',
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  secrets: ['FIREBASE_DATABASE_URL'],
};

/** Only an explicit `true` turns the cloud finalizer on. A read failure = off. */
async function finalizerEnabled(): Promise<boolean> {
  try {
    const snap = await getDB().ref(FINALIZER_FLAG).once('value');
    return snap.val() === true;
  } catch (err) {
    logger.warn('[OrderFinalizer] flag unreadable - staying off', {
      error: (err as Error).message,
    });
    return false;
  }
}

/** Compact, log-safe summary of what the pipeline decided. */
function verdictSummary(verdict: any) {
  return {
    ok: !!verdict?.ok,
    skipped: verdict?.skipped ?? null,
    priceChanged: !!verdict?.priceChanged,
    subtotal: verdict?.subtotal ?? null,
    discount: verdict?.discount ?? null,
    deliveryFee: verdict?.deliveryFee ?? null,
    total: verdict?.total ?? null,
    tax: verdict?.tax ?? null,
    tenderPaise: verdict?.tender?.amountPaise ?? null,
    inventory: verdict?.inventoryDeducted ? Object.keys(verdict.inventoryDeducted).length : 0,
    discountUsageRecorded: !!verdict?.discountUsageRecorded,
  };
}

export const onWebOrderPlaced = onValueCreated(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    const order = event.data.val();
    if (!order || typeof order !== 'object') return;
    if (!WEB_ORDER_SOURCES.includes(String(order.source || ''))) return;
    if (!(await finalizerEnabled())) return;
    // Same gate as `shouldFinalizeWebOrder` in bot/index.js: an order the
    // customer cancelled before anyone saw it must not burn a reward or take
    // stock, and a finalized order must never run again.
    if (String(order.status || '') !== 'Placed') return;
    if (order.stockDeducted === true) return;

    const { finalizer } = makeOrderFinalizer(bid, oid);
    const verdict = await finalizer.finalizeWebOrder({
      orderId,
      order: { ...order, outlet: oid },
      owner: 'cloud',
    });
    logger.info('[OrderFinalizer] finalized', { bid, oid, orderId, ...verdictSummary(verdict) });

    // A claimed run is not an error: the bot (or a concurrent invocation) owns
    // this order. Anything else with ok:false is a hard failure — throw so the
    // platform records it instead of silently leaving an un-finalized order.
    if (!verdict.ok && !verdict.skipped) {
      throw new Error(`finalizeWebOrder failed for ${orderId}`);
    }
  },
);

/**
 * Give back the discount usage a cancelled/refunded web/app order consumed.
 * Mirrors `releaseOrderDiscountUsage` in bot/index.js, including the durable
 * `discountUsageReversed` claim so a duplicate event cannot decrement twice.
 */
async function releaseOrderDiscountUsage(
  bid: string,
  oid: string,
  orderId: string,
  order: any,
  discountEngine: any,
  db: any,
  resolvePath: (p: string) => string,
): Promise<boolean> {
  if (!order || !order.discountId || !(Number(order.discount) > 0)) return false;
  if (order.discountUsageRecorded !== true || order.discountUsageReversed === true) return false;
  const statusLower = String(order.status || '').toLowerCase();
  if (statusLower !== 'cancelled' && statusLower !== 'refunded') return false;
  if (isDineInOrder(order)) return false;

  const flagRef = db.ref(resolvePath(`orders/${orderId}/discountUsageReversed`));
  const seed = ((await flagRef.once('value').catch(() => null)) || {}).val();
  const claim = await flagRef.transaction((cur: any) => ((cur || seed) ? undefined : true)).catch(() => null);
  if (!claim || !claim.committed) return false;

  await discountEngine.releaseDiscountUsage({
    OUTLET: oid,
    orderId,
    discountId: order.discountId,
    customerPhone: order.phone,
    amountGiven: order.discount,
    discountLabel: order.discountLabel,
    discountSource: order.discountSource,
  });
  logger.info('[OrderFinalizer] discount usage released', { bid, oid, orderId, discountId: order.discountId });
  return true;
}

/**
 * Give the reward code back when the order it was tendered on is cancelled.
 * Mirrors `resurrectRewardTender` in bot/index.js: the transaction only clears
 * a code that this exact order burned, so a redemption of the same points on a
 * NEW order can never be undone by a late cancel event. Idempotent.
 */
async function resurrectRewardTender(
  bid: string,
  oid: string,
  orderId: string,
  order: any,
  db: any,
  resolvePath: (p: string) => string,
): Promise<boolean> {
  const tender = order && order.loyaltyTender;
  const phone = order && order.phone ? String(order.phone).replace(/\D/g, '').slice(-10) : '';
  if (!tender || !tender.rewardKey || !/^[6-9]\d{9}$/.test(phone)) return false;
  const ref = db.ref(resolvePath(`customers/${phone}/rewards/${String(tender.rewardKey)}`));
  const seed = ((await ref.once('value').catch(() => null)) || {}).val();
  const tx = await ref.transaction((cur: any) => {
    const node = cur || seed;
    if (!node || node.usedOnOrder !== String(orderId)) return undefined;
    return { ...node, status: 'active', usedAt: null, usedOnOrder: null };
  }).catch(() => null);
  if (tx && tx.committed) {
    logger.info('[OrderFinalizer] reward code returned', { bid, oid, orderId, rewardKey: tender.rewardKey });
    return true;
  }
  return false;
}

export const onOrderCancelledCompensate = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status' },
  async (event) => {
    const statusAfter = String(event.data.after.val() || '').toLowerCase();
    if (statusAfter !== 'cancelled' && statusAfter !== 'refunded') return;

    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    if (!(await finalizerEnabled())) return;

    // The leaf event carries only the status — read the order for the rest.
    // A newer status may already have replaced the cancel; act on the truth.
    const db = getDB();
    const snap = await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`).once('value');
    const order = snap.val();
    if (!order) return;
    if (String(order.status || '').toLowerCase() !== statusAfter) return;
    if (!WEB_ORDER_SOURCES.includes(String(order.source || ''))) return;

    const { finalizer, discountEngine, resolvePath } = makeOrderFinalizer(bid, oid);
    // Same order as the bot: free the reward, then the discount, then the stock.
    await resurrectRewardTender(bid, oid, orderId, order, db, resolvePath);
    await releaseOrderDiscountUsage(bid, oid, orderId, order, discountEngine, db, resolvePath);
    const restored = await finalizer.restoreOrderInventory(orderId, order);
    if (restored) logger.info('[OrderFinalizer] stock restored', { bid, oid, orderId });
  },
);
