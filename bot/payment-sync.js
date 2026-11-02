/**
 * Customer payment history sync.
 *
 * The payment truth lives on orders/{id} (Admin/POS set paymentMethod and
 * paymentStatus at settlement or delivery). Customers cannot read delivery
 * orders (rules), so the bot mirrors the payment fields onto the customer's
 * own record customers/{phone}/orders/{id}, which the app's Orders and
 * Payments tabs read.
 *
 * Also mirrors live delivery tracking (rider, handover OTP) and the order mode.
 * Mirror only: never creates a record (the placement/accrual paths own that),
 * never writes anything but status/total/payment fields.
 */
const PAID = 'Paid';

function str(v) {
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null;
}

/**
 * Pure: the fields to merge into the customer's order record.
 * paidAt is set once, the first time the order is seen as Paid, and cleared
 * when a settled bill is voided (Paid -> Unpaid).
 */
function buildPaymentPatch(order, existing = {}, now = Date.now(), extra = {}) {
    const paymentStatus = str(order && order.paymentStatus) || 'Pending';
    const patch = {
        status: str(order && order.status) || existing.status || 'Placed',
        total: Number(order && order.total) || 0,
        paymentStatus,
        paymentMethod: str(order && order.paymentMethod),
        paymentUpdatedAt: now,
        orderMode: order && order.orderMode ? String(order.orderMode).slice(0, 12) : (existing.orderMode || null),
        // Live delivery tracking for the app's Orders tab: rider details while the
        // order is on its way, and the handover OTP the customer reads to the rider.
        riderName: extra.rider && extra.rider.name ? String(extra.rider.name).slice(0, 60) : null,
        riderPhone: extra.rider && extra.rider.phone ? String(extra.rider.phone).replace(/\D/g, '').slice(-10) || null : null,
        deliveryOtp: extra.otp ? String(extra.otp).slice(0, 8) : null,
    };
    if (paymentStatus === PAID) patch.paidAt = Number(existing.paidAt) || now;
    else patch.paidAt = null;
    return patch;
}

async function syncCustomerPayment({ db, resolvePath, phone, orderId, order, outlet, now = Date.now(), extra = {} }) {
    if (!phone || !orderId || !order) return false;
    const ref = db.ref(resolvePath(`customers/${phone}/orders/${String(orderId)}`, outlet));
    const snap = await ref.once('value');
    const existing = snap.val();
    if (!existing) return false; // not mirrored for this customer: nothing to keep in sync
    const patch = buildPaymentPatch(order, existing, now, extra);
    const same = ['status', 'total', 'paymentStatus', 'paymentMethod', 'riderName', 'riderPhone', 'deliveryOtp', 'orderMode'].every(k => (existing[k] ?? null) === (patch[k] ?? null));
    if (same) return false; // idempotent: no write when nothing changed
    await ref.update(patch);
    return true;
}

module.exports = { buildPaymentPatch, syncCustomerPayment };
