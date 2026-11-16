/**
 * Wallet gate triggers (batch 23l) — the three events that can change a gate.
 *
 * The publisher itself lives in `src/shared/wallet/gate.ts`; this file is only
 * the wiring. There is **no feature flag**: the EC2 writer is deleted in the
 * same batch, so unlike 23e/23f/23g/23h there is no second owner to switch off.
 * Safety comes from `isArmed` — nothing is published, and nothing is held, until
 * Supreme arms `walletBilling/{bid}/{oid}/wallet.enforce` (no outlet is armed
 * live today, so this deploy changes no behaviour).
 *
 *   1. `onOrderBillingChange`  orders/{id}             -> apply the fee delta
 *   2. `onWalletLedgerChange`  walletBilling/{bid}/{oid} -> top-up / charge / arm
 *   3. `onWalletGateTouched`   outlets/{oid}/walletGate -> self-heal a tamper
 *
 * The third one replaces the EC2 pass's 60 s self-heal: `walletGate` cannot be
 * given a server-only rule (it must be world-readable for the menu and the bot)
 * and the `businesses/$bid` write cascade makes it tenant-writable, so the
 * publisher answers any write it did not make. Its own publish re-fires the
 * trigger once; the summary records what was published, so that echo is skipped.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin } from '../shared/firebase/admin';
import {
  DEMO_BID,
  applyOrderFeeDelta,
  isArmed,
  publishGate,
  readSummary,
} from '../shared/wallet/gate';

const BASE_OPTS = {
  region: 'us-central1',
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  secrets: ['FIREBASE_DATABASE_URL'],
};

// ---------------------------------------------------------------------------
// 1. Any order write -> the outlet's fee index + gate
// ---------------------------------------------------------------------------
// This listens on the WHOLE order node on purpose: a new order, a cancellation,
// a total correction after re-pricing and a re-opened order all change what the
// outlet owes, and they arrive as different fields (status, total, subtotal…).
// Leaf listeners cannot see all of them. The cost is one small billing read per
// order event (a `charge` change is the only way the per-order rate changes);
// a write with no billing delta returns before the transaction and the publish.
export const onOrderBillingChange = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}' },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BID) return;
    await initializeAdmin();
    const before = event.data.before.exists() ? event.data.before.val() : null;
    const after = event.data.after.exists() ? event.data.after.val() : null;
    const result = await applyOrderFeeDelta(bid, oid, before, after);
    if (result.skipped) return;
    logger.info('[WalletGate] order delta', {
      bid,
      oid,
      orderId,
      delta: result.delta,
      rebuilt: result.rebuilt === true,
      gate: result.gate || 'open',
      balance: result.balance,
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Billing ledger change -> republish (top-up, payment, charge, arm/disarm)
// ---------------------------------------------------------------------------
// `metaCostPublisher` writes `balancePaise` here every 15 minutes — unrelated to
// the restaurant wallet — so an outlet that was not armed before and is not
// armed after is skipped entirely. Any change while armed republishes, because
// payments, charges, promo-token packs and the arm switch all move the wallet.
export const onWalletLedgerChange = onValueWritten(
  { ...BASE_OPTS, ref: 'walletBilling/{bid}/{oid}' },
  async (event) => {
    const { bid, oid } = event.params;
    if (bid === DEMO_BID) return;
    await initializeAdmin();
    const before = event.data.before.exists() ? event.data.before.val() : null;
    const after = event.data.after.exists() ? event.data.after.val() : null;
    if (!isArmed(bid, before) && !isArmed(bid, after)) return;
    const result = await publishGate(bid, oid, { billing: after });
    logger.info('[WalletGate] ledger change republished', {
      bid,
      oid,
      armed: result.armed === true,
      gate: result.gate || 'open',
      balance: result.balance,
    });
  },
);

// ---------------------------------------------------------------------------
// 3. A write the publisher did not make -> recompute and overwrite it
// ---------------------------------------------------------------------------
export const onWalletGateTouched = onValueWritten(
  { ...BASE_OPTS, ref: 'businesses/{bid}/outlets/{oid}/walletGate' },
  async (event) => {
    const { bid, oid } = event.params;
    if (bid === DEMO_BID) return;
    await initializeAdmin();
    const current = String(
      event.data.after.val() == null ? '' : event.data.after.val(),
    )
      .trim()
      .toLowerCase();
    // Our own publish: the summary already records this exact value.
    const summary = await readSummary(bid, oid);
    if (summary && summary.pricingKey && String(summary.gate || '') === current) return;
    const result = await publishGate(bid, oid);
    logger.info('[WalletGate] tamper reconciled', {
      bid,
      oid,
      was: current,
      now: result.gate || 'open',
    });
  },
);
