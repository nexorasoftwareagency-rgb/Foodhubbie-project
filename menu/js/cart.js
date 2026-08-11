/**
 * Menu/js/cart.js
 * Local (in-memory) cart for the CURRENT order being built.
 * This is intentionally separate from the session's running total —
 * the cart only represents items not yet submitted. Once "PLACE ORDER"
 * is pressed, order.js writes the cart to /orders and session.js folds
 * the totals into the session's running bill, then the cart is cleared.
 *
 * Cart is persisted to sessionStorage so navigation / accidental
 * refresh does not lose the user's lineup.
 */

const STORAGE_KEY = 'roshani_cart';

function persistCart() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Cart.lines)); } catch (e) { console.warn('[Cart] Storage error:', e); }
}

export const Cart = {
    lines: {},   // { lineId: { dishId, name, img, size, addons:[names], qty, unitPrice, instructions } }
};

export function restoreCart() {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) Cart.lines = JSON.parse(saved);
    } catch { Cart.lines = {}; }
}

export function addLine(line) {
    const lineId = `${line.dishId}_${line.size}_${(line.addons || []).join('-')}_${Date.now()}`;
    const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0;
    const qty = typeof line.qty === 'number' && line.qty > 0 ? line.qty : 1;
    Cart.lines[lineId] = { ...line, unitPrice, qty };
    persistCart();
    window.dispatchEvent(new CustomEvent('cart:changed'));
    return lineId;
}

export function setQty(lineId, qty) {
    if (!Cart.lines[lineId]) return;
    if (qty <= 0) { delete Cart.lines[lineId]; }
    else { Cart.lines[lineId].qty = qty; }
    persistCart();
    window.dispatchEvent(new CustomEvent('cart:changed'));
}

export function clearCart() {
    Cart.lines = {};
    sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('cart:changed'));
}

export function lineCount() {
    return Object.values(Cart.lines).reduce((s, l) => s + l.qty, 0);
}

export function subtotal() {
    return Object.values(Cart.lines).reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0);
}

export function isEmpty() {
    return Object.keys(Cart.lines).length === 0;
}
