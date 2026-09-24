/**
 * Menu/js/order.js
 * Places orders into the EXISTING pizza/orders node (Decision #2 — single
 * source of truth, no parallel dineinOrders/qrOrders node).
 *
 * Additional fields written onto the standard order record, exactly as
 * specified in "ORDER STRUCTURE":
 *   type, source, table, tableId, tableToken, sessionId
 *
 * COMPATIBILITY NOTE: the architecture doc's example uses type:"DineIn"
 * (no hyphen). This implementation writes type:"Dine-in" (with hyphen)
 * instead, because the EXISTING Admin/js/features/orders.js already
 * defines STATUS_SEQUENCES['Dine-in'] = ["Confirmed","Ready","Delivered"]
 * and getStatusOptions() branches on that exact literal string. Writing
 * "DineIn" would silently fall through to the default/Online status
 * pipeline in the existing code, breaking the printing/notifications/
 * KDS grouping. Using "Dine-in" makes this order indistinguishable from
 * any other admin-side dine-in order for every existing downstream
 * system, while source:"QR" is added so reports can still tell a
 * QR-originated order apart from a staff-entered POS dine-in order.
 * See the "Compatibility Notes" section of the Commands & Guidance doc
 * for how to change this if you would rather standardize on "DineIn"
 * and update orders.js's STATUS_SEQUENCES key to match.
 */
import { outletRef, set, update, get, runTransaction } from './firebase.js';
import { Session, attachOrderToSession, ensureSession, assertOutletEnabled } from './session.js';
import { Cart, clearCart, subtotal as cartSubtotal } from './cart.js';

function round2(n) { return Math.round(n * 100) / 100; }

// Unified order ID → display string. Callers add "#".
// Same logic as Admin/js/utils.js, bot/utils.js, SupremeAdmin, rider utils.
export function formatOrderId(o) {
    const id = typeof o === 'string' ? o : (o && (o.orderId || o.id)) || '';
    if (!id) return 'N/A';
    if (/^\d{6}-\d+$/.test(id)) return id;
    const m = String(id).match(/^(\d{4})(\d{2})(\d{2})-(\d+)$/);
    if (m) return `${m[3]}${m[2]}${m[1].slice(2)}-${Number(m[4])}`;
    return String(id).slice(-6).toUpperCase();
}

// Daily atomic sequence → DDMMYY-N (unpadded). Path key also DDMMYY.
export async function generateOrderId() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const dateStr = `${dd}${mm}${yy}`;
    const seqRef = outletRef(`metadata/orderSequence/${dateStr}`);
    const result = await runTransaction(seqRef, (current) => (current || 0) + 1);
    const seqNum = (result.snapshot && result.snapshot.val()) || 1;
    return `${dateStr}-${seqNum}`;
}

/**
 * @param {Object} opts
 * @param {number} opts.taxPercent
 * @param {boolean} opts.taxEnabled
 * @param {boolean} opts.serviceChargeEnabled
 * @param {number} opts.serviceChargeRate
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone
 * @param {Object} [opts.discount] - Applied discount from evaluator
 * @param {number} [opts.discount.amount] - Discount amount in ₹
 * @param {string} [opts.discount.label] - Discount label
 * @param {string} [opts.discount.source] - Source string (e.g. "coupon:WELCOME20")
 * @param {string} [opts.discount.discountId] - Firebase discount ID */
export async function placeOrder({ taxPercent = 5, taxEnabled = true, taxRates, serviceChargeEnabled = false, serviceChargeRate = 0, customerName = '', customerPhone = '', discount = null } = {}) {
    // Restaurant-disabled gate — the rules also deny the write, but a clear
    // error beats a silent permission failure mid-checkout.
    await assertOutletEnabled();
    const sessResult = await ensureSession();
    if (!sessResult.ok) throw new Error('Session not available');
    if (sessResult.isNewSession) {
        clearCart();
        throw new Error('Session expired — please review your cart and try again');
    }
    if (Object.keys(Cart.lines).length === 0) throw new Error('Cart is empty');

    const items = {};
    Object.values(Cart.lines).forEach((l, i) => {
        items[`item_${i}`] = {
            name: l.name + (l.size && l.size !== 'Regular' ? ` (${l.size})` : ''),
            qty: l.qty,
            price: l.unitPrice,
            addons: l.addons || [],
            instructions: l.instructions || ''
        };
    });

    const subtotal = round2(cartSubtotal());
    const rates = (taxRates && Array.isArray(taxRates) && taxRates.length > 0) ? taxRates : (taxEnabled ? [{ name: 'Tax', rate: taxPercent }] : []);
    const taxItems = rates.map(r => ({ name: r.name, rate: r.rate, amount: round2(subtotal * (r.rate / 100)) }));
    const tax = taxItems.reduce((s, t) => s + t.amount, 0);
    const serviceCharge = serviceChargeEnabled ? round2(subtotal * (serviceChargeRate / 100)) : 0;
    const discountAmount = discount && discount.amount > 0 ? Math.min(round2(discount.amount), subtotal + tax + serviceCharge) : 0;
    const total = round2(subtotal + tax + serviceCharge - discountAmount);
    const taxName = rates.map(r => r.name).join(' + ');

    const orderPayload = {
        // --- Standard fields every existing order has ---
        status: 'Placed',
        items,
        subtotal, tax, taxItems, taxName, serviceCharge, total,
        paymentStatus: 'Pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),

        // --- Dine-in / QR specific fields (additive only) ---
        type: 'Dine-in',              // see compatibility note above
        source: 'QR',
        table: String(Session.table.number),
        tableId: Session.tableId,
        sessionId: Session.sessionId,
        orderGroupId: Session.currentGroupId || '',

        // --- Optional contact, collected at checkout only ---
        customerName: customerName || ''
        // PII (phone) intentionally omitted — written to tableSessionsContact instead
    };
    // --- Discount (if applied) ---
    if (discountAmount > 0) {
        orderPayload.discount = discountAmount;
        orderPayload.discountLabel = discount.label || '';
        // validateCoupon now returns source:'coupon:CODE'; fall back for callers
        // that only provide couponCode (bot re-verify extracts claimed code from this).
        orderPayload.discountSource = discount.source || (discount.couponCode ? 'coupon:' + discount.couponCode : '');
        orderPayload.discountId = discount.discountId || '';
        orderPayload.discountMode = discount.mode || 'fixed';
        orderPayload.discountValue = discount.value || 0;
    }

    const orderId = await generateOrderId();
    const newOrderRef = outletRef(`orders/${orderId}`);
    // Write as 'Pending' first so the order is never visible as 'Placed' in KDS if the session attach fails
    var writeData = {};
    for (var k in orderPayload) { writeData[k] = orderPayload[k]; }
    writeData.orderId = orderId;
    writeData.status = 'Pending';
    await set(newOrderRef, writeData);

    // Fold this order's totals into the session's running bill
    const attached = await attachOrderToSession(newOrderRef.key, { subtotal, tax, serviceCharge, total, discount: discountAmount }, Session.currentGroupId);
    if (!attached) {
        // Transaction aborted: session/group is no longer active. Order is orphaned in /orders.
        update(newOrderRef, { status: 'Cancelled', cancelledReason: 'Session inactive at placement' }).catch(() => {});
        throw new Error('Session or group is no longer active — order could not be linked');
    }
    // Promote to 'Placed' only after successful session attachment
    try {
        await update(newOrderRef, { status: 'Placed' });
    } catch (err) {
        update(newOrderRef, { status: 'Cancelled', cancelledReason: 'Promotion failed' }).catch(() => {});
        console.error('[Order] Promotion failed:', err);
        throw new Error('Could not place order. Please try again.');
    }

    // Clear cart immediately so the user can start a new order
    clearCart();

    // Write order-level guest record (fire-and-forget; must not reject the caller)
    const cleanPhone = (customerPhone || '').replace(/[^\d]/g, '');
    if (cleanPhone.length >= 10) {
        const _writeGuest = (attempt) => {
            set(outletRef(`guests/${cleanPhone}/orders/${newOrderRef.key}`), {
                name: customerName || '',
                total,
                placedAt: new Date().toISOString(),
                source: 'QR'
            }).catch(e => {
                if (attempt < 1) setTimeout(() => _writeGuest(attempt + 1), 500);
                else console.warn('[Order] Guest record write failed:', e);
            });
        };
        _writeGuest(0);
    }

    return { orderId, ...orderPayload };
}
