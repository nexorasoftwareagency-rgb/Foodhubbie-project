/**
 * Order Status Change RTDB Trigger
 * 
 * Handles order lifecycle events when status changes:
 * - Pending → Placed: Initialize processing
 * - Placed → Confirmed: Notify kitchen
 * - Confirmed → Delivered: Process loyalty accrual
 * - Delivered → Cancelled: Process refund/clawback
 * - Any → Refunded: Handle refund
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[OrderStatusChange] Admin init failed', { error: err.message });
});

/**
 * The public demo tenant is hard-skipped, like every other order trigger
 * (23e-23h). This handler is the only one that WRITES to the order it observes
 * (`placedAt`/`confirmedAt`/...), so without the guard a nightly consumer reseed
 * would stamp server timestamps onto 353 seeded orders - the demo would stop
 * being the bytes the builder produced - and burn a write plus a full order read
 * per event.
 */
const DEMO_BUSINESS_ID = 'foodhubbie-demo';

/**
 * Trigger on order status changes
 */
export const onOrderStatusChange = onValueWritten(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status',
    secrets: [],
  },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;
    const before = event.data.before.val();
    const after = event.data.after.val();

    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[OrderStatusChange] Status changed', {
      correlationId,
      bid,
      oid,
      orderId,
      before,
      after,
    });

    try {
      // Ignore if no actual change
      if (before === after) {
        logger.info('[OrderStatusChange] No change detected, skipping', { correlationId });
        return;
      }

      const db = getDB();

      // Load the full order data
      const orderSnap = await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`).once('value');
      const order = orderSnap.val();

      if (!order) {
        logger.warn('[OrderStatusChange] Order not found', { correlationId, bid, oid, orderId });
        return;
      }

      // Handle specific transitions
      switch (after) {
        case 'Placed':
          if (before === 'Pending') {
            logger.info('[OrderStatusChange] Order placed', { correlationId, orderId });
            // Order is now placed - can trigger kitchen notification, etc.
            await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}/placedAt`).set(Date.now());
          }
          break;

        case 'Confirmed':
          logger.info('[OrderStatusChange] Order confirmed', { correlationId, orderId });
          await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}/confirmedAt`).set(Date.now());
          // Notify kitchen staff
          break;

        case 'Delivered':
          logger.info('[OrderStatusChange] Order delivered', { correlationId, orderId });
          await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}/deliveredAt`).set(Date.now());
          // Process loyalty accrual would happen here
          break;

        case 'Cancelled':
          logger.info('[OrderStatusChange] Order cancelled', { correlationId, orderId });
          await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}/cancelledAt`).set(Date.now());
          // Process refund/clawback would happen here
          break;

        case 'Refunded':
          logger.info('[OrderStatusChange] Order refunded', { correlationId, orderId });
          await db.ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}/refundedAt`).set(Date.now());
          break;

        default:
          logger.info('[OrderStatusChange] Status transition', { correlationId, before, after });
      }

      logger.info('[OrderStatusChange] Completed', { correlationId, orderId, after });
    } catch (error) {
      logger.error('[OrderStatusChange] Processing failed', {
        correlationId,
        bid,
        oid,
        orderId,
        error: (error as Error).message,
      });
    }
  }
);
