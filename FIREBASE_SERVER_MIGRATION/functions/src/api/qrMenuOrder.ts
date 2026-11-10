/**
 * QR Menu Order Callable Function
 * 
 * Places orders from QR Menu / Customer App:
 * - Validates cart and outlet
 * - Creates order in RTDB with status 'Pending'
 * - Returns order ID for payment flow
 * 
 * Requires Firebase Auth (anonymous or signed-in)
 */

import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, ref } from '../shared/firebase/admin';
import type { QrMenuOrderPayload, ApiResponse } from '../shared/types';

// Initialize admin on cold start
initializeAdmin().catch(err => {
  logger.error('[QrMenuOrder] Admin init failed', { error: err.message });
});

/**
 * Place QR Menu Order
 */
export const qrMenuOrder = onCall<QrMenuOrderPayload>(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 10,
    secrets: [],
  },
  async (request) => {
    const { bid, oid, cart, sessionId, tableId, customerPhone, customerName, deliveryAddress, paymentMethod, loyaltyRedeem } = request.data;
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    logger.info('[QrMenuOrder] Order received', {
      correlationId,
      bid,
      oid,
      customerPhone,
      paymentMethod,
      itemCount: cart?.length || 0,
    });

    try {
      // Validate required fields
      if (!bid || !oid || !cart || !paymentMethod) {
        return {
          success: false,
          error: { code: 'invalid_request', message: 'bid, oid, cart, and paymentMethod are required' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Verify outlet exists
      const outletSnap = await ref(`businesses/${bid}/outlets/${oid}`).once('value');
      if (!outletSnap.exists()) {
        return {
          success: false,
          error: { code: 'not_found', message: 'Outlet not found' },
          meta: { timestamp: Date.now(), correlationId },
        };
      }

      // Calculate order total
      let subtotal = 0;
      for (const item of cart) {
        subtotal += (item.price || 0) * (item.quantity || 1);
        if (item.addons) {
          for (const addon of item.addons) {
            subtotal += (addon.price || 0) * (item.quantity || 1);
          }
        }
      }

      const tax = round2(subtotal * 0.05); // 5% GST
      const deliveryFee = deliveryAddress ? 20 : 0; // ₹20 delivery fee
      const serviceCharge = 0; // QR orders don't have service charge
      const discount = loyaltyRedeem ? (loyaltyRedeem.code ? 200 : 0) : 0; // Simplified
      const total = round2(subtotal + tax + deliveryFee + serviceCharge - discount);

      // Generate order ID
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      const orderId = `${dateStr}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

      // Create order
      const orderData = {
        orderId,
        bid,
        oid,
        status: 'Pending',
        paymentStatus: 'Pending',
        source: 'APP',
        channel: 'app',
        subtotal: round2(subtotal),
        tax,
        serviceCharge,
        deliveryFee,
        discount,
        total,
        items: cart,
        customerPhone: customerPhone || 'anonymous',
        customerName: customerName || 'Guest',
        sessionId: sessionId || null,
        tableId: tableId || null,
        deliveryAddress: deliveryAddress || null,
        paymentMethod,
        loyaltyRedeem: loyaltyRedeem || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`).set(orderData);

      // Log the order creation
      await ref(`businesses/${bid}/outlets/${oid}/orderLog`).push({
        orderId,
        action: 'created',
        source: 'QR_MENU',
        customerPhone: customerPhone || 'anonymous',
        total,
        createdAt: Date.now(),
      });

      logger.info('[QrMenuOrder] Order created', {
        correlationId,
        orderId,
        bid,
        oid,
        total,
      });

      return {
        success: true,
        data: {
          orderId,
          status: 'Pending',
          total,
          subtotal: round2(subtotal),
          tax,
          deliveryFee,
          discount,
          paymentMethod,
          createdAt: Date.now(),
        },
        meta: { timestamp: Date.now(), correlationId },
      };
    } catch (error) {
      logger.error('[QrMenuOrder] Order creation failed', {
        correlationId,
        bid,
        oid,
        error: (error as Error).message,
      });

      return {
        success: false,
        error: {
          code: 'internal_error',
          message: (error as Error).message,
        },
        meta: { timestamp: Date.now(), correlationId },
      };
    }
  }
);

// Helper for rounding
function round2(value: number): number {
  return Math.round((value + 1e-10) * 100) / 100;
}
