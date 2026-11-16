/**
 * onOrderStatusAlert — RTDB Trigger (batch: EC2 retirement)
 *
 * Sends a WhatsApp "NEW ORDER" alert to outlet admins when an order status
 * flips to 'Placed' for the first time. Replaces the EC2 bot's socket-only
 * alertAdminFinalizedWebOrder (bot/index.js:1184) and the WhatsApp portion
 * of handleOrderStatusUpdate (bot/index.js:1371).
 *
 * Listens on the orders/{orderId}/status leaf so a payment mirror or KOT
 * stamp cannot trigger an alert — only genuine status transitions.
 *
 * Config flag: config/orderStatusAlert/enabled === true (default false)
 * Demo tenant (foodhubbie-demo) is hard-skipped.
 * Dedupe: orders/{orderId}/_adminWaNotified prevents duplicate alerts.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { enqueueTask } from '../shared/utils/taskQueue';
import { formatOrderId } from '../shared/utils';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/orderStatusAlert/enabled';

export const onOrderStatusAlert = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    // Config flag gate
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return;
    } catch {
      return;
    }

    const statusAfter = String(event.data.after.val() || '').toLowerCase();
    const statusBefore = String(event.data.before.val() || '').toLowerCase();
    if (!statusAfter) return;
    if (event.data.before.exists() && statusAfter === statusBefore) return; // no change

    // Read full order
    const orderRef = getDB().ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`);
    const order = (await orderRef.once('value')).val();
    if (!order) return;

    // QR orders don't get admin WhatsApp alerts
    if (order.source === 'QR') return;

    // Only alert on first 'Placed'
    if (statusAfter !== 'placed') return;

    // Dedupe check
    if (order._adminWaNotified === true) return;

    // Resolve admin JIDs for this outlet (outlet match + isSuper/isSupreme)
    const adminsSnap = await getDB().ref('admins').once('value');
    const admins = adminsSnap.val() || {};
    const adminEntries = Object.entries(admins)
      .filter(([, a]: any) => !!a && !!a.fcmToken) // need a contact method
      .filter(
        ([, a]: any) =>
          a.isSuper === true ||
          a.isSupreme === true ||
          !a.outlet ||
          String(a.outlet) === oid,
      )
      .map(([uid, a]: any) => ({ uid, waJid: a.whatsappJid || a.phone, name: a.name || a.email || uid }));

    if (adminEntries.length === 0) {
      logger.info('[OrderStatusAlert] No admin recipients', { bid, oid, orderId });
      return;
    }

    // Build message text (parity with EC2 alertAdminFinalizedWebOrder)
    const displayId = formatOrderId(order.orderId || orderId);
    const itemCount = Array.isArray(order.items)
      ? order.items.length
      : order.items
        ? Object.keys(order.items).length
        : 0;
    const where = order.tableNo ? `Table ${order.tableNo}` : order.type || oid.toUpperCase();
    const body =
      `🆕 *New Order #${displayId}*\n` +
      `${order.customerName || 'Customer'} · ` +
      (itemCount ? `${itemCount} items · ` : '') +
      `₹${Number(order.total || 0)} · ${where} · ${oid.toUpperCase()}`;

    // Mark as notified (transaction, cold-tx seeded) before sending
    const notifiedRef = orderRef.child('_adminWaNotified');
    const claim = await notifiedRef.transaction((cur: boolean | null) =>
      cur === true ? undefined : true,
    );
    if (!claim.committed) return; // another invocation already marked it

    // Enqueue outbound WhatsApp text to each admin
    const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await Promise.all(
      adminEntries.map((entry) => {
        if (!entry.waJid) return Promise.resolve();
        return enqueueTask('sendOutboundMessage', {
          to: entry.waJid,
          outlet: oid,
          businessId: bid,
          type: 'text',
          text: body,
          correlationId,
          _logChat: true,
        });
      }),
    );

    logger.info('[OrderStatusAlert] Admin alert queued', {
      bid, oid, orderId, displayId, recipients: adminEntries.length,
    });
  },
);

export { formatOrderId };
