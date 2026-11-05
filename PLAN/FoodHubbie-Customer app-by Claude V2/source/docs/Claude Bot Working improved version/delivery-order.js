/**
 * Menu/js/delivery-order.js
 * Places DELIVERY orders directly into the existing {outlet}/orders node —
 * same pattern as menu/js/order.js (the dine-in QR app), which already
 * writes orders straight from the browser with no server round-trip.
 *
 * Field shape mirrors bot/index.js's processOrderPlacement() "Online" order
 * exactly (type, phone, lat/lng, deliveryFee, assignedRider, discount*
 * fields), NOT the Dine-in shape order.js uses — Admin's status pipeline
 * and the bot's WhatsApp notifier branch on these fields, so keeping the
 * shape identical is what makes the rest of the system (Admin dashboard,
 * rider app, status messages) work without any changes.
 *
 * What happens after this write, with ZERO new code:
 *   1. bot/index.js's existing `orderRef.on("child_added", ...)` listener
 *      picks up the new order, finishes server-side-only steps (stock
 *      deduction, saving the customer's profile) and sends the customer
 *      the "🎉 ORDER PLACED!" invoice message.
 *   2. As Admin/rider-app move the order through its statuses, the
 *      existing `orderRef.on("child_changed", ...)` listener sends every
 *      subsequent WhatsApp update (Confirmed, Ready, Rider assigned + OTP,
 *      Delivered) automatically.
 */
import { outletRef, push, set, get, OUTLET } from './firebase.js';
import { calculateDistance, getFeeFromSlabs } from './geo.js';

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {Object} opts
 * @param {Object[]} opts.cartLines - Object.values(Cart.lines)
 * @param {string} opts.customerName
 * @param {string} opts.customerPhone - 10-digit
 * @param {string} opts.address
 * @param {{lat:number,lng:number}} opts.location
 * @param {string} [opts.note]
 * @param {Object|null} [opts.discount] - result of validateCoupon(), or null
 * @returns {Promise<{orderId:string, total:number, deliveryFee:number}>}
 */
export async function placeDeliveryOrder({ cartLines, customerName, customerPhone, address, location, note = '', discount = null }) {
    if (!cartLines || cartLines.length === 0) throw new Error('Cart is empty');
    if (!customerName) throw new Error('Name is required');
    if (!customerPhone || customerPhone.length !== 10) throw new Error('A valid 10-digit phone number is required');
    if (!address) throw new Error('Delivery address is required');
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
        throw new Error('Location permission is required to place a delivery order');
    }

    // --- Delivery fee: same distance → slabs calc as bot/index.js's
    //     handleCheckoutFinal(), using shared/geo/geo.js (copied to
    //     menu/js/geo.js — identical logic, already proven client-side
    //     since Admin/shared/geo/geo.js is the same file reused there). ---
    const [delSnap, storeSnap] = await Promise.all([
        get(outletRef('settings/Delivery')),
        get(outletRef('settings/Store')),
    ]);
    const delSettings = delSnap.val() || {};
    const storeSettings = storeSnap.val() || {};
    const outletCoords = {
        lat: parseFloat(storeSettings.lat ?? (OUTLET === 'cake' ? 25.887472 : 25.887944)),
        lng: parseFloat(storeSettings.lng ?? (OUTLET === 'cake' ? 85.026861 : 85.026194)),
    };
    const dist = calculateDistance(location.lat, location.lng, outletCoords.lat, outletCoords.lng);
    const deliveryFee = getFeeFromSlabs(dist, delSettings.slabs || []);

    // --- Items: same shape bot/index.js's user.cart already uses, so
    //     formatOrderInvoice() / formatCartSummary() read it unchanged. ---
    const items = cartLines.map(l => ({
        name: l.name,
        size: l.size,
        unitPrice: l.unitPrice,
        addons: (l.addons || []).map((n, i) => ({ name: n, price: (l.addonPrices || [])[i] || 0 })),
        quantity: l.qty,
        total: round2(l.unitPrice * l.qty),
        outlet: OUTLET,
        instructions: l.instructions || '',
    }));

    const subtotal = round2(items.reduce((s, it) => s + it.total, 0));
    const discountAmount = discount && discount.amount > 0 ? Math.min(round2(discount.amount), subtotal + deliveryFee) : 0;
    const total = round2(subtotal + deliveryFee - discountAmount);

    const newOrderRef = push(outletRef('orders'));
    const orderPayload = {
        orderId: newOrderRef.key,
        outlet: OUTLET,
        type: 'Online',
        source: 'webview_delivery',   // lets bot/index.js recognize direct-write orders
        customerName,
        phone: customerPhone,
        address,
        lat: location.lat, lng: location.lng,
        subtotal, deliveryFee, total,
        status: 'Placed',
        paymentMethod: 'COD', paymentStatus: 'Pending',
        createdAt: new Date().toISOString(),
        assignedRider: '',
        items,
        stockDeducted: false,          // bot deducts stock on pickup (see child_added hook)
        note: note || '',
    };
    if (discountAmount > 0) {
        orderPayload.discount = discountAmount;
        orderPayload.discountId = discount.discountId || null;
        orderPayload.discountLabel = discount.name || discount.couponCode || null;
        orderPayload.discountSource = 'coupon:' + (discount.couponCode || '');
        orderPayload.discountMode = discount.mode || 'fixed';
        orderPayload.discountValue = discount.value || 0;
        orderPayload.discountGlobalLimit = discount.maxCap || 0;
    }

    await set(newOrderRef, orderPayload);

    return { orderId: newOrderRef.key, total, deliveryFee };
}
