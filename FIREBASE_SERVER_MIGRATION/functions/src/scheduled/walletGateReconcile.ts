/**
 * Hourly wallet gate reconcile (batch 23l).
 *
 * The incremental order-fee index in `src/shared/wallet/gate.ts` is O(1) per
 * order event, but an index can drift: a trigger invocation lost to a cold
 * start, a deploy window, a delta applied against a stale seed. This job is the
 * authority — once an hour it rebuilds every armed outlet's index EXACTLY from
 * its orders and republishes the gate, and it sweeps the gate + summary of every
 * outlet that is not armed.
 *
 * Why hourly and not every minute: the EC2 pass ran every 60 s because that was
 * the only thing keeping the gate fresh. Here the triggers do that in seconds,
 * so the reconcile only has to bound the error of a lost event. Hourly keeps the
 * read cost trivial even when every outlet is armed, and a wrongly-open gate can
 * never last longer than one hour.
 *
 * Enumeration: the server-only `walletBilling` root (one ~11 KB read for the
 * whole estate) — never the `businesses` tree, which is the exact egress bug
 * class batches 11/14/15/23i paid for.
 *
 * `foodhubbie-demo` is hard-skipped: the nightly reseed writes 363 fake orders
 * and a visitor must never meet a gate on the public sandbox.
 *
 * No feature flag: unlike 23e–23h there is no bot counterpart to hand ownership
 * to (the EC2 writer is deleted), and an unarmed estate costs one small read.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin } from '../shared/firebase/admin';
import { reconcileWalletGates } from '../shared/wallet/gate';

initializeAdmin().catch((err: Error) => {
  logger.error('[WalletGate] Admin init failed', { error: err.message });
});

/** Exported so the E2E can call the exact deployed runner, and `jobs:run` proofs. */
export async function runWalletGateReconcile(): Promise<any> {
  await initializeAdmin();
  const summary = await reconcileWalletGates();
  logger.info('[WalletGate] reconcile done', summary);
  return summary;
}

export const walletGateReconcile = onSchedule(
  {
    // :07 — out of phase with dailySettlement (23:00) and demoReseed (03:00).
    schedule: '7 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async () => {
    await runWalletGateReconcile();
  },
);
