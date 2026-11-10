/**
 * Wallet Update RTDB Trigger
 * 
 * Handles wallet balance changes:
 * - Recomputes wallet gate when balance changes
 * - Logs balance history
 * - Triggers notifications for low/closed states
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, ref } from '../shared/firebase/admin';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[WalletUpdate] Admin init failed', { error: err.message });
});

/**
 * Trigger on wallet balance changes
 */
export const onWalletUpdate = onValueWritten(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    ref: 'walletBilling/{bid}/{oid}/balancePaise',
    secrets: [],
  },
  async (event) => {
    const { bid, oid } = event.params;
    const before = event.data.before.val();
    const after = event.data.after.val();

    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[WalletUpdate] Balance changed', {
      correlationId,
      bid,
      oid,
      before,
      after,
    });

    try {
      // Ignore if no actual change
      if (before === after) {
        logger.info('[WalletUpdate] No change detected, skipping', { correlationId });
        return;
      }

      const db = getDB();

      // Determine wallet gate from new balance
      let gate: string;
      if (after <= 0) {
        gate = 'closed';
      } else if (after < 50000) { // ₹500 in paise
        gate = 'low';
      } else {
        gate = 'open';
      }

      // Update walletGate on the outlet
      await ref(`businesses/${bid}/outlets/${oid}/walletGate`).set(gate);

      // Log balance history
      await ref(`walletBilling/${bid}/${oid}/balanceHistory`).push({
        previous: before,
        current: after,
        gate,
        changedAt: Date.now(),
      });

      // Log low balance alert
      if (gate === 'closed') {
        logger.warn('[WalletUpdate] Wallet closed - balance depleted', {
          correlationId,
          bid,
          oid,
          balance: after,
        });

        // Could send notification to outlet admin here
      } else if (gate === 'low') {
        logger.warn('[WalletUpdate] Wallet low balance warning', {
          correlationId,
          bid,
          oid,
          balance: after,
        });
      }

      logger.info('[WalletUpdate] Completed', { correlationId, bid, oid, gate, balance: after });
    } catch (error) {
      logger.error('[WalletUpdate] Processing failed', {
        correlationId,
        bid,
        oid,
        error: (error as Error).message,
      });
    }
  }
);
