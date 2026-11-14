/**
 * Batch 23f — one construction path for the vendored bot finalizer.
 *
 * The pipeline itself is `bot/order-finalizer.js`, copied byte-for-byte into
 * `lib/vendor/` by `scripts/copy-vendor.cjs` (run by `npm run build`). This file
 * only supplies the tenant-pinned deps:
 *
 *   - `resolvePath` pins the tenant from the EVENT PATH, never from a
 *     reverse-index guess: the e2e business has an outlet literally named
 *     `pizza`, so `resolvePath('orders/…')` must resolve to the business the
 *     order actually belongs to.
 *   - `updateData` strips `undefined` (RTDB rejects it) exactly like the bot's
 *     own helper.
 *   - `getLoyaltyConfig` returns the raw node — `computeTenderPaise` owns the
 *     only default the tender math reads (100 paise/point).
 *
 * Used by both the shadow triggers (batch 23c) and the real finalizer (23f), so
 * a shadow verdict and a real run are produced by the same code.
 */

import * as path from 'path';
import { getDB } from '../firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const VENDOR = path.join(__dirname, '../../vendor');
const { createOrderFinalizer } = require(path.join(VENDOR, 'bot/order-finalizer.js'));
const { createDiscountEngine } = require(path.join(VENDOR, 'bot/discount-engine-core.js'));
const orderPricing = require(path.join(VENDOR, 'bot/order-pricing.js'));
const { isDineInOrder } = require(path.join(VENDOR, 'bot/utils.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

/** Same classification the bot uses, re-exported so a trigger guard cannot drift. */
export { isDineInOrder };

/** Same two sources `isWebOrderSource` accepts in `bot/index.js`. */
export const WEB_ORDER_SOURCES = ['webview_delivery', 'APP'];

/** Matches `stripUndefined` in bot/firebase.js — RTDB rejects undefined values. */
export function stripUndefined(value: any): any {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) out[k] = v === undefined ? null : stripUndefined(v);
  return out;
}

export interface TenantDb {
  db: any;
  resolvePath: (p: string) => string;
  getData: (p: string) => Promise<any>;
  updateData: (p: string, data: any) => Promise<void>;
}

export function tenantDb(bid: string, oid: string): TenantDb {
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
  return { db, resolvePath, getData, updateData };
}

/**
 * The finalizer plus the discount engine it was built with. `releaseDiscountUsage`
 * lives on the engine (cancel compensation), so callers need it alongside the
 * finalizer without paying for a second construction.
 */
export function makeOrderFinalizer(bid: string, oid: string) {
  const { db, resolvePath, getData, updateData } = tenantDb(bid, oid);
  const saveUserProfile = async (jid: string, data: any) => {
    const clean = String(jid).replace(/[^0-9]/g, '');
    await updateData(`profiles/${clean}`, data);
  };
  const getLoyaltyConfig = async () => (await getData('loyalty/config')) || {};
  const discountEngine = createDiscountEngine({ db, getData, resolvePath });
  const finalizer = createOrderFinalizer({
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
  return { finalizer, discountEngine, db, resolvePath, getData, updateData };
}
