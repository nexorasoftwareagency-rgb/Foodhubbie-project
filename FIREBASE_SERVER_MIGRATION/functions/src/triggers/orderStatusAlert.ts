/**
 * onOrderStatusAlert — WhatsApp "NEW ORDER" alert for the outlet's own team.
 *
 * Parity port of the bot's `alertAdminFinalizedWebOrder` + `notifyAdmin('NEW')`
 * (`bot/index.js`), which are socket-only and therefore die with the Baileys
 * worker. Batch 23n: the same message now leaves from the Cloud API.
 *
 * WHY THE `stockDeducted` LEAF: a browser-written order is finalised by exactly
 * one runner (the bot's finalizer or `onWebOrderPlaced`), and both write
 * `stockDeducted: true` in their single bookkeeping update. Listening on that
 * leaf fires exactly once per order, after the money is final — so the alert
 * can never show the customer's claimed total, and a status flip / payment
 * mirror / `_fcmSent` stamp cannot wake the sender. Dine-in, QR and POS orders
 * never get the flag and never get this text, which is exactly what the bot
 * did (it alerted web orders only).
 *
 * Config flag: config/orderStatusAlert/enabled === true (absent = no-op, the
 * bot keeps the job). Demo tenant hard-skipped. `_adminWaNotified` is claimed
 * by transaction BEFORE the send, so a replay, a restart or the bot's own
 * sender cannot text the owner twice — whoever claims first wins.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { formatOrderId } from '../shared/utils';
import { makeTenantTransport, tenantAlertRecipients } from '../shared/whatsapp/factory';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/orderStatusAlert/enabled';

/** Same set `bot/index.js isWebOrderSource` alerts for. */
const WEB_ORDER_SOURCES = ['webview_delivery', 'APP'];

/** `919748509436` -> `91****9436`; never log a full customer/staff number. */
function maskPhone(v: string): string {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `${d.slice(0, 2)}****${d.slice(-4)}`;
}

/** The `notifyAdmin(order, 'NEW')` body, verbatim in structure. */
function buildNewOrderMessage(order: any, orderId: string): string {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText =
    items
      .map((i: any) => `• ${i.name}${i.size ? ` (${i.size})` : ''} x${i.quantity}`)
      .join('\n') || '• (no item lines)';
  const tender = order.loyaltyTender && Number(order.loyaltyTender.amountPaise) > 0 ? order.loyaltyTender : null;
  let msg =
    '🔔 *NEW ORDER RECEIVED!* 🔔\n════════════════════════\n' +
    `🆔 ID: #${formatOrderId(order.orderId || orderId)}\n` +
    `👤 Customer: ${order.customerName || 'Customer'}\n` +
    `📞 Phone: ${order.phone || 'N/A'}\n` +
    `📍 Address: ${order.address || (order.tableNo ? `Table ${order.tableNo}` : '-')}\n` +
    '════════════════════════\n' +
    `📦 Items:\n${itemsText}\n` +
    '════════════════════════\n' +
    `💰 Total: ₹${Number(order.total || 0)}`;
  if (tender) {
    const payable =
      order.totalDue != null
        ? Number(order.totalDue)
        : Math.max(0, Number(order.total || 0) - Number(tender.amount || 0));
    msg +=
      `\n🎁 Loyalty tender (${tender.points} pts): -₹${tender.amount}` +
      `\n💵 Payable: ₹${payable}`;
  }
  msg += `\n💳 Method: ${order.paymentMethod || 'N/A'}`;
  if (order.priceReview && Array.isArray(order.priceReview.lines) && order.priceReview.lines.length) {
    msg +=
      `\n⚠️ *CHECK PRICES:* not on the menu / unverified: ${order.priceReview.lines.join(', ')}` +
      ` (customer price ₹${order.priceReview.unverifiedAmount || 0}).`;
  }
  return msg;
}

export const onOrderStatusAlert = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/stockDeducted',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async (event) => {
    const { bid, oid, orderId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    // Only the finalizer's claim counts; a `false`/absent write is not an order.
    if (event.data.after.val() !== true) return;

    await initializeAdmin();

    // Config flag gate — unreadable means "stay off" (the bot keeps the job).
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return;
    } catch {
      return;
    }

    const order = (await getDB()
      .ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`)
      .once('value')).val();
    if (!order) return;
    if (!WEB_ORDER_SOURCES.includes(String(order.source || ''))) return;
    if (order._adminWaNotified === true) return;

    // Build the send path FIRST: a tenant with no number connected must not
    // burn the claim, or the alert would be lost without ever being attempted.
    let recipients: string[] = [];
    let transport: any = null;
    try {
      recipients = await tenantAlertRecipients(bid, oid);
      transport = (await makeTenantTransport(bid, oid)).transport;
    } catch (e: any) {
      logger.warn('[OrderStatusAlert] no WhatsApp transport, alert skipped', {
        bid, oid, orderId, error: e && e.message,
      });
      return;
    }

    // Durable at-most-once claim (cold-tx seeded: RTDB hands a null value to
    // the first invocation even when the node exists).
    const claimRef = getDB().ref(
      `businesses/${bid}/outlets/${oid}/orders/${orderId}/_adminWaNotified`,
    );
    const claimSnap = await claimRef.once('value').catch(() => null);
    const seed = claimSnap ? claimSnap.val() : null;
    const claim = await claimRef
      .transaction((cur: boolean | null) => ((cur || seed) ? undefined : true))
      .catch(() => null);
    if (!claim || !claim.committed) return;

    const displayId = formatOrderId(order.orderId || orderId);
    const body = buildNewOrderMessage(order, orderId);
    let sent = 0;
    for (const to of recipients) {
      try {
        await transport.sendMessage(to, { text: body });
        sent++;
      } catch (e: any) {
        logger.warn('[OrderStatusAlert] send failed', { oid, to: maskPhone(to), error: e && e.message });
      }
    }
    logger.info('[OrderStatusAlert] Admin alert sent', {
      bid, oid, orderId, displayId, recipients: recipients.length, sent,
    });
  },
);
