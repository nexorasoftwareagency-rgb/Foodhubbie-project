/**
 * Web/app order finalizer — SHADOW MODE (batch 23c).
 *
 * `menu/js/delivery.js` and `menu/js/app-checkout.js` write orders straight to
 * Firebase from the customer's browser, so every money field on them is a claim.
 * The WhatsApp bot answers that in `bot/order-finalizer.js` (batch 23b): it
 * re-prices the lines from the catalog, re-derives tax + delivery fee from the
 * outlet's settings, re-runs the discount, burns a claimed reward code and
 * deducts stock.
 *
 * This file runs **the same module** in Cloud Functions and never writes to the
 * order:
 *
 *   1. `onWebOrderPlacedShadow` — on order creation, compute a dry-run verdict
 *      and store it under `migrationShadow/orderFinalizer/{bid}/{oid}/{orderId}`.
 *   2. `onWebOrderFinalizedShadow` — when the bot flips `stockDeducted` to true,
 *      compare that stored verdict with the order the bot actually produced and
 *      store `{matched, diffs}`.
 *
 * Why at creation: comparing at the finalize event alone would compare the
 * module against already-corrected values and prove nothing. The claim has to be
 * captured before the bot rewrites it.
 *
 * The module is copied verbatim from the repo by `scripts/copy-vendor.cjs` (run
 * by `npm run build`), so the shadow verdict is produced by the same bytes the
 * bot runs — not a TypeScript re-implementation that could drift.
 *
 * Kill switch: set `migrationFlags/orderFinalizerShadow/enabled` to `false` to
 * stop both triggers (missing / any other value = enabled). Nothing here can
 * change an order, a stock count, a reward code or a billing row.
 */

import * as path from 'path';
import { onValueCreated, onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const VENDOR = path.join(__dirname, '../vendor');
const { createOrderFinalizer, compareFinalization } = require(path.join(VENDOR, 'bot/order-finalizer.js'));
const { createDiscountEngine } = require(path.join(VENDOR, 'bot/discount-engine-core.js'));
const orderPricing = require(path.join(VENDOR, 'bot/order-pricing.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

initializeAdmin().catch((err: Error) => {
  logger.error('[OrderFinalizerShadow] Admin init failed', { error: err.message });
});

const WEB_SOURCES = ['webview_delivery', 'APP'];
const FLAG_PATH = 'migrationFlags/orderFinalizerShadow/enabled';
const SHADOW_ROOT = 'migrationShadow/orderFinalizer';

/** Same 60 s container-local cache as the bot's flag reads. */
let flagCache: { at: number; enabled: boolean } | null = null;

async function shadowEnabled(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < 60_000) return flagCache.enabled;
  let enabled = true; // missing flag = enabled (this is an observation-only path)
  try {
    const snap = await getDB().ref(FLAG_PATH).once('value');
    if (snap.val() === false) enabled = false;
  } catch (err) {
    logger.warn('[OrderFinalizerShadow] kill switch unreadable, staying enabled', { error: (err as Error).message });
  }
  flagCache = { at: Date.now(), enabled };
  return enabled;
}

/** Matches `stripUndefined` in bot/firebase.js — RTDB rejects undefined values. */
function stripUndefined(value: any): any {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) out[k] = v === undefined ? null : stripUndefined(v);
  return out;
}

/**
 * Build the finalizer the way `bot/index.js` does, but with the tenant pinned by
 * the event path instead of the bot's outlet→business index: the e2e business
 * has an outlet literally named `pizza`, so `resolvePath` must never guess.
 */
function makeFinalizer(bid: string, oid: string) {
  const db = getDB();
  const resolvePath = (p: string) =>
    (String(p).startsWith('businesses/') ? String(p) : `businesses/${bid}/outlets/${oid}/${p}`);
  const getData = async (p: string) => {
    const snap = await db.ref(resolvePath(p)).once('value');
    return snap.val();
  };
  const updateData = async (p: string, data: any) => {
    await db.ref(resolvePath(p)).update(stripUndefined(data));
  };
  const saveUserProfile = async (jid: string, data: any) => {
    const clean = String(jid).replace(/[^0-9]/g, '');
    await updateData(`profiles/${clean}`, data);
  };
  // The bot's `getLoyaltyConfig` only adds defaults for fields the tender math
  // does not read (earn rate, tiers), so the raw node is equivalent here —
  // `computeTenderPaise` owns the only defaults that matter (100 paise/point).
  const getLoyaltyConfig = async () => (await getData('loyalty/config')) || {};
  const discountEngine = createDiscountEngine({ db, getData, resolvePath });
  return createOrderFinalizer({
    db,
    getData,
    updateData,
    resolvePath,
    saveUserProfile,
    getLoyaltyConfig,
    discountEngine,
    orderPricing,
    defaultOutlet: oid,
  });
}

/** Compact shape written to the shadow node — enough to audit a mismatch. */
function baseRow(bid: string, oid: string, orderId: string, order: any) {
  return {
    bid,
    oid,
    orderId,
    source: order.source || null,
    channel: order.channel || null,
    orderType: order.type || null,
    claimed: {
      subtotal: order.subtotal ?? null,
      discount: order.discount ?? null,
      deliveryFee: order.deliveryFee ?? null,
      tax: order.tax ?? null,
      total: order.total ?? null,
      itemCount: Array.isArray(order.items) ? order.items.length : 0,
    },
  };
}

export const onWebOrderPlacedShadow = onValueCreated(
  {
    ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    const order = event.data.val();
    if (!order || typeof order !== 'object') return;
    if (!WEB_SOURCES.includes(String(order.source || ''))) return;
    if (!(await shadowEnabled())) return;

    const rowRef = getDB().ref(`${SHADOW_ROOT}/${bid}/${oid}/${orderId}`);
    // The bot only finalizes `Placed`; anything else (a pre-bot cancel) has no
    // verdict to compare later.
    if (String(order.status || '') !== 'Placed') {
      await rowRef.update({ ...baseRow(bid, oid, orderId, order), stage: 'skipped', reason: `status:${order.status || 'none'}`, at: Date.now() });
      return;
    }
    // Race: the bot finalized before this trigger ran. A dry run now would read
    // post-finalization state (used reward, bumped discount usage) and could
    // report a false mismatch, so record the skip instead of inventing proof.
    if (order.stockDeducted === true) {
      await rowRef.update({ ...baseRow(bid, oid, orderId, order), stage: 'skipped', reason: 'already-finalized', at: Date.now() });
      return;
    }

    try {
      const finalizer = makeFinalizer(bid, oid);
      const verdict = await finalizer.finalizeWebOrder({
        orderId,
        order: { ...order, outlet: oid },
        dryRun: true,
      });
      await rowRef.update({
        ...baseRow(bid, oid, orderId, order),
        stage: 'placed',
        at: Date.now(),
        verdict,
        matched: null,
        diffs: null,
      });
      logger.info('[OrderFinalizerShadow] verdict recorded', {
        bid, oid, orderId,
        ok: verdict.ok,
        priceChanged: verdict.priceChanged,
        discount: verdict.discount,
        total: verdict.total,
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      await rowRef.update({
        ...baseRow(bid, oid, orderId, order),
        stage: 'error',
        at: Date.now(),
        error: message,
      }).catch(() => {});
      // Throw so the RTDB trigger retries: a transient read failure must not
      // silently remove the shadow proof for this order.
      throw err;
    }
  },
);

export const onWebOrderFinalizedShadow = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/stockDeducted',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async (event) => {
    if (event.data.after.val() !== true) return; // only the bot's finalize flip
    if (!(await shadowEnabled())) return;

    const { bid, oid, orderId } = event.params;
    const db = getDB();
    const rowRef = db.ref(`${SHADOW_ROOT}/${bid}/${oid}/${orderId}`);
    const [rowSnap, orderSnap] = await Promise.all([
      rowRef.once('value'),
      db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`).once('value'),
    ]);
    const row = rowSnap.val();
    const order = orderSnap.val();
    if (!order) return;

    if (!row || !row.verdict) {
      await rowRef.update({
        ...baseRow(bid, oid, orderId, order),
        stage: 'finalized',
        finalizedAt: Date.now(),
        matched: null,
        diffs: null,
        reason: row ? 'no-shadow-verdict' : 'no-shadow-row',
      });
      return;
    }

    const cmp = compareFinalization(row.verdict, order);
    await rowRef.update({
      stage: 'finalized',
      finalizedAt: Date.now(),
      matched: cmp.matched,
      diffs: cmp.diffs,
      actual: {
        subtotal: order.subtotal ?? null,
        discount: order.discount ?? null,
        deliveryFee: order.deliveryFee ?? null,
        tax: order.tax ?? null,
        total: order.total ?? null,
        discountUsageRecorded: order.discountUsageRecorded === true,
        tenderPaise: order.loyaltyTender?.amountPaise ?? null,
      },
    });
    if (cmp.matched) {
      logger.info('[OrderFinalizerShadow] MATCH', { bid, oid, orderId });
    } else {
      logger.warn('[OrderFinalizerShadow] MISMATCH', { bid, oid, orderId, diffs: cmp.diffs });
    }
  },
);
