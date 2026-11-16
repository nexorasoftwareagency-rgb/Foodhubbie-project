/**
 * Batch 23l — the wallet gate engine: the ONE publisher of
 * `businesses/{bid}/outlets/{oid}/walletGate`.
 *
 * `walletGate` is public state ('low' | 'closed' | ''/absent) that the WhatsApp
 * bot, the QR menu and the Customer App read before letting a customer order.
 * Until this batch it was written by `bot-control-api/wallet-watch.js`, a 60 s
 * `setInterval` on the EC2 box — which has been offline since 2026-11-11, so an
 * armed outlet could never be gated (or un-gated) again. The box is not coming
 * back; the publisher belongs in the cloud.
 *
 * ## Why not just run the same pass here
 *
 * The EC2 pass held a live mirror of every armed outlet's whole `orders` node.
 * In a Function there is no process to hold a mirror, and re-reading the orders
 * node per pass is exactly the egress bug class of batches 11/14/15 (live pizza
 * is 128 KB of orders, growing forever). So the cloud keeps an **incremental
 * order-fee index** instead:
 *
 *   meta/walletWatch/{bid}/{oid} = {
 *     orderFeesPaise, orders, pricingKey, at, by,   // the index
 *     gate, balance, publishedAt,                   // what was published
 *   }
 *
 *   - Every order write applies `orderFeePaise(billing, after) − …(before)` to
 *     the index in a transaction (`applyOrderFeeDelta`). That is O(1) reads.
 *     If the index is missing or priced for another plan, that same function
 *     rebuilds it from the orders node once and treats the rebuild as
 *     authoritative — it already contains the event, so no delta is added on
 *     top (`ensureFeeIndex().rebuilt`).
 *   - `pricingKey` = `[mode, rates]`. A mode/rate change re-prices the ENTIRE
 *     order history, so a changed key forces a full recompute instead of a
 *     delta (the same reason the batch-12 announcement said a mode switch
 *     re-prices past orders).
 *   - The hourly `walletGateReconcile` rebuilds the index exactly for every
 *     armed outlet, which bounds any lost/duplicated delta to one hour.
 *
 * The summary lives under `meta/`, deliberately OUTSIDE `walletBilling`: a write
 * there would re-fire `onWalletLedgerChange` and the publisher would feed
 * itself. `meta/walletWatch` is Admin-SDK-only, so it needs no rules change.
 *
 * ## The money math is not re-implemented
 *
 * `shared/cost-math.js` is vendored byte-for-byte into `lib/vendor/` by
 * `scripts/copy-vendor.cjs` (the batch 23b "one module, two runners" pattern),
 * so the gate is computed by the same `computeWalletFromIndex` / `orderFeePaise`
 * the Admin Costs tab and Supreme use. The drifted `src/shared/wallet/compute.ts`
 * port (wrong rates, wrong keys, honoured `enforce` itself) is deleted in this
 * batch — never re-add a second wallet implementation.
 *
 * `foodhubbie-demo` is hard-skipped everywhere: the nightly reseed writes 363
 * fake orders and the demo must never show a gate to a visitor.
 */

import * as path from 'path';
import { logger } from 'firebase-functions/v2';
import { getDB } from '../firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const costMath = require(path.join(__dirname, '../../vendor/shared/cost-math.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

export const DEMO_BID = 'foodhubbie-demo';
export const SUMMARY_ROOT = 'meta/walletWatch';

/** Only an explicitly armed, non-demo outlet is ever gated. */
export function isArmed(bid: string, billing: any): boolean {
  return bid !== DEMO_BID && !!(billing && billing.wallet && billing.wallet.enforce === true);
}

/** Stored value for a computed wallet: '' (open) | 'low' | 'closed'. */
export function gateFor(wallet: any): string {
  const g = costMath.walletGate(wallet || {});
  return g === 'ok' ? '' : g;
}

/** `[mode, rates]` — a change re-prices all history, so it invalidates the index. */
export function pricingKey(billing: any): string {
  return JSON.stringify([
    costMath.normalizeMode(billing && billing.mode),
    (billing && billing.rates) || null,
  ]);
}

export const orderFeePaise = (billing: any, order: any): number =>
  costMath.orderFeePaise(billing || {}, order || null);

const summaryPath = (bid: string, oid: string) => `${SUMMARY_ROOT}/${bid}/${oid}`;
const gatePath = (bid: string, oid: string) =>
  `businesses/${bid}/outlets/${oid}/walletGate`;

export async function readBilling(bid: string, oid: string): Promise<any> {
  const snap = await getDB().ref(`walletBilling/${bid}/${oid}`).once('value');
  return snap.exists() ? snap.val() : null;
}

export async function readSummary(bid: string, oid: string): Promise<any> {
  const snap = await getDB().ref(summaryPath(bid, oid)).once('value');
  return snap.exists() ? snap.val() : null;
}

/** Promo campaigns bill ₹1 per uncovered send, so the gate needs them live. */
async function readCampaigns(bid: string, oid: string): Promise<any> {
  try {
    const snap = await getDB()
      .ref(`businesses/${bid}/outlets/${oid}/bot/promotions/campaigns`)
      .once('value');
    return snap.val() || {};
  } catch (err) {
    logger.warn('[WalletGate] campaigns unreadable - billing them as zero', {
      bid,
      oid,
      error: (err as Error).message,
    });
    return {};
  }
}

/**
 * Exact rebuild: read the outlet's orders ONCE and rebuild the index. Only the
 * hourly reconcile and a `pricingKey` change take this path.
 */
export async function recomputeFeeIndex(bid: string, oid: string, billing: any): Promise<any> {
  const snap = await getDB().ref(`businesses/${bid}/outlets/${oid}/orders`).once('value');
  const idx = costMath.costIndexFor(billing || {}, snap.val() || {});
  const rec = {
    orderFeesPaise: Math.max(0, Math.round((Number(idx.total) || 0) * 100)),
    orders: Number(idx.count) || 0,
    pricingKey: pricingKey(billing),
    at: Date.now(),
    by: 'reconcile',
  };
  await getDB().ref(summaryPath(bid, oid)).update(rec);
  return rec;
}

/**
 * The index, rebuilt only when it is missing or priced for a different plan.
 *
 * `rebuilt` is load-bearing. A rebuild reads the live orders tree, which already
 * contains the write that fired the trigger, so the result is AUTHORITATIVE for
 * this event — the caller must publish it and never add the event's delta on
 * top. Doing both double-counted the triggering order (found in review
 * 2026-11-16: a rebuild seed of 6000 paise plus a 6000 delta published 'low' on
 * a wallet that should have stayed open).
 */
export async function ensureFeeIndex(
  bid: string,
  oid: string,
  billing: any,
): Promise<{ index: any; rebuilt: boolean }> {
  const cur = await readSummary(bid, oid);
  const key = pricingKey(billing);
  if (cur && cur.pricingKey === key && typeof cur.orderFeesPaise === 'number') {
    return {
      rebuilt: false,
      index: {
        orderFeesPaise: cur.orderFeesPaise,
        orders: Number(cur.orders) || 0,
        pricingKey: cur.pricingKey,
        at: cur.at,
        by: cur.by,
      },
    };
  }
  return { rebuilt: true, index: await recomputeFeeIndex(bid, oid, billing) };
}

/**
 * Recompute + publish one outlet. Writes the gate only when the value actually
 * changes, so republishing a steady wallet costs nothing. An outlet that is not
 * armed has its gate AND its summary removed — nothing may be gated by accident.
 */
export async function publishGate(
  bid: string,
  oid: string,
  opts: { billing?: any; index?: any } = {},
): Promise<any> {
  if (bid === DEMO_BID) return { gate: '', armed: false, skipped: 'demo' };
  const db = getDB();
  const billing = 'billing' in opts ? opts.billing : await readBilling(bid, oid);
  const gateRef = db.ref(gatePath(bid, oid));
  const sumRef = db.ref(summaryPath(bid, oid));

  if (!isArmed(bid, billing)) {
    const gateSnap = await gateRef.once('value');
    if (gateSnap.exists()) {
      await gateRef.remove();
      logger.info('[WalletGate] gate cleared (not armed)', { bid, oid });
    }
    const sumSnap = await sumRef.once('value');
    if (sumSnap.exists()) await sumRef.remove();
    return { gate: '', armed: false, balance: null };
  }

  const index = opts.index || (await ensureFeeIndex(bid, oid, billing)).index;
  const campaigns = await readCampaigns(bid, oid);
  const wallet = costMath.computeWalletFromIndex({
    billing,
    orderFeeTotal: (Number(index.orderFeesPaise) || 0) / 100,
    campaigns,
  });
  const next = gateFor(wallet);

  const curSnap = await gateRef.once('value');
  const current = String(curSnap.val() == null ? '' : curSnap.val()).trim().toLowerCase();
  if (next !== current) {
    if (next) await gateRef.set(next);
    else await gateRef.remove();
    logger.info('[WalletGate] published', { bid, oid, gate: next || 'open', balance: wallet.balance });
  }
  await sumRef.update({ gate: next, balance: wallet.balance, publishedAt: Date.now() });
  return {
    gate: next,
    armed: true,
    balance: wallet.balance,
    paid: wallet.paid,
    used: wallet.used,
    charges: wallet.charges,
    orderFeesPaise: Number(index.orderFeesPaise) || 0,
  };
}

/**
 * Apply one order's billing delta to the index, then republish. A write that
 * changes nothing billable (an `_fcmSent` stamp, a finalize claim, a status that
 * stays billed) returns before the transaction and before any publish — an
 * order produces ~10 such writes.
 */
export async function applyOrderFeeDelta(
  bid: string,
  oid: string,
  before: any,
  after: any,
  opts: { billing?: any } = {},
): Promise<any> {
  if (bid === DEMO_BID) return { skipped: 'demo' };
  const billing = 'billing' in opts ? opts.billing : await readBilling(bid, oid);
  if (!isArmed(bid, billing)) return { skipped: 'unarmed' };

  const delta = orderFeePaise(billing, after) - orderFeePaise(billing, before);
  const countDelta =
    (costMath.isBilledOrder(after) ? 1 : 0) - (costMath.isBilledOrder(before) ? 1 : 0);
  if (!delta && !countDelta) return { skipped: 'no-billing-change' };

  const ensured = await ensureFeeIndex(bid, oid, billing);
  if (ensured.rebuilt) {
    // The rebuild read the orders tree AFTER this write landed, so it already
    // includes the event — adding `delta` would count it twice (deleted order:
    // subtract it twice). The rebuild is authoritative: publish it, skip the
    // deltas. Review fix 2026-11-16.
    const published = await publishGate(bid, oid, { billing, index: ensured.index });
    return {
      delta: 0,
      countDelta: 0,
      rebuilt: true,
      index: ensured.index,
      ...published,
    };
  }
  const seed = ensured.index;
  const key = pricingKey(billing);
  const res = await getDB()
    .ref(summaryPath(bid, oid))
    .transaction((cur: any) => {
      // Admin-SDK transactions get a cold `null` on the first call even for an
      // existing node — seed, never trust the first pass (batch-12/23f lesson).
      const base = cur && cur.pricingKey === key ? cur : seed;
      const nextTotal = Math.round((Number(base.orderFeesPaise) || 0) + delta);
      if (nextTotal < 0) {
        logger.warn('[WalletGate] fee index clamped at 0 — the hourly reconcile will rebuild it', {
          bid,
          oid,
          had: base.orderFeesPaise,
          delta,
        });
      }
      return {
        ...base,
        orderFeesPaise: Math.max(0, nextTotal),
        orders: Math.max(0, (Number(base.orders) || 0) + countDelta),
        pricingKey: key,
        at: Date.now(),
        by: 'order',
      };
    });
  if (!res.committed) return { skipped: 'transaction-aborted' };
  const index = res.snapshot.val() || seed;
  const published = await publishGate(bid, oid, { billing, index });
  return { delta, countDelta, index, ...published };
}

/**
 * Hourly exact reconcile. Iterates the server-only `walletBilling` root (one
 * ~11 KB read for the whole estate), never the `businesses` tree.
 */
export async function reconcileWalletGates(): Promise<any> {
  const db = getDB();
  const billingRoot = (await db.ref('walletBilling').once('value')).val() || {};
  const summaries = (await db.ref(SUMMARY_ROOT).once('value')).val() || {};
  const result: any = {
    outlets: 0,
    armed: 0,
    rebuilt: 0,
    gated: 0,
    cleared: 0,
    errors: 0,
    demoSkipped: 0,
  };

  for (const bid of Object.keys(billingRoot)) {
    if (bid === DEMO_BID) {
      result.demoSkipped += Object.keys(billingRoot[bid] || {}).length;
      continue;
    }
    for (const oid of Object.keys(billingRoot[bid] || {})) {
      result.outlets += 1;
      const billing = billingRoot[bid][oid];
      try {
        if (isArmed(bid, billing)) {
          result.armed += 1;
          const index = await recomputeFeeIndex(bid, oid, billing);
          result.rebuilt += 1;
          const pub = await publishGate(bid, oid, { billing, index });
          if (pub.gate) result.gated += 1;
        } else {
          const gateSnap = await db.ref(gatePath(bid, oid)).once('value');
          if (gateSnap.exists()) {
            await db.ref(gatePath(bid, oid)).remove();
            result.cleared += 1;
          }
          if (summaries[bid] && summaries[bid][oid]) {
            await db.ref(summaryPath(bid, oid)).remove();
            result.cleared += 1;
          }
        }
      } catch (err) {
        result.errors += 1;
        logger.warn('[WalletGate] outlet skipped', { bid, oid, error: (err as Error).message });
      }
    }
  }

  // a summary for an outlet whose billing row is gone (deleted tenant)
  for (const bid of Object.keys(summaries)) {
    if (bid === DEMO_BID || bid === 'reconcile') continue;
    for (const oid of Object.keys(summaries[bid] || {})) {
      if (billingRoot[bid] && billingRoot[bid][oid]) continue;
      await db.ref(summaryPath(bid, oid)).remove().catch(() => {});
      result.cleared += 1;
    }
  }

  const summary = { at: Date.now(), by: 'cloud', ...result };
  await db.ref(`${SUMMARY_ROOT}/reconcile`).set(summary);
  return summary;
}
