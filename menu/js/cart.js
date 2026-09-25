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
 * Storage is scoped per context (QR sessionId, Webview token) to avoid
 * cross-contamination between dine-in and delivery flows.
 */

const DEFAULT_STORAGE_KEY = 'foodhubbie_cart';

/**
 * Get the storage key for the QR dine-in flow.
 * Scoped to the table sessionId so cart persists across refreshes
 * for the same table session, but is isolated from other tables/sessions.
 */
export function getQRStorageKey() {
    const sessionId = (typeof Session !== 'undefined' && Session.sessionId) || '';
    return sessionId ? `foodhubbie_cart_qr_${sessionId}` : DEFAULT_STORAGE_KEY;
}

/**
 * Get the storage key for the Webview delivery flow.
 * Scoped to the one-time webview token so each delivery link
 * gets its own isolated cart.
 */
export function getWebviewStorageKey(token) {
    return token ? `foodhubbie_cart_webview_${token}` : DEFAULT_STORAGE_KEY;
}

/**
 * Internal: persist cart to a specific storage key.
 */
function _persistCart(key) {
    try { sessionStorage.setItem(key, JSON.stringify(Cart.lines)); } catch (e) { console.warn('[Cart] Storage error:', e); }
}

export const Cart = {
    lines: {},   // { lineId: { dishId, name, img, size, addons:[names], qty, unitPrice, instructions } }
};

/**
 * Restore cart from sessionStorage using the provided key.
 * Falls back to default key if no key provided (backward compatibility).
 */
export function restoreCart(key) {
    const storageKey = key || DEFAULT_STORAGE_KEY;
    try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) Cart.lines = JSON.parse(saved);
        else Cart.lines = {};
    } catch { Cart.lines = {}; }
}

/**
 * Add a line to the cart and persist using the provided key.
 */
export function addLine(line, key) {
    const lineId = `${line.dishId}_${line.size}_${(line.addons || []).join('-')}_${Date.now()}`;
    const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0;
    const qty = typeof line.qty === 'number' && line.qty > 0 ? line.qty : 1;
    Cart.lines[lineId] = { ...line, unitPrice, qty };
    _persistCart(key || DEFAULT_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('cart:changed'));
    return lineId;
}

/**
 * Update quantity for a line and persist using the provided key.
 */
export function setQty(lineId, qty, key) {
    if (!Cart.lines[lineId]) return;
    if (qty <= 0) { delete Cart.lines[lineId]; }
    else { Cart.lines[lineId].qty = qty; }
    _persistCart(key || DEFAULT_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('cart:changed'));
}

/**
 * Clear the in-memory cart and remove from sessionStorage using the provided key.
 */
export function clearCart(key) {
    Cart.lines = {};
    sessionStorage.removeItem(key || DEFAULT_STORAGE_KEY);
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
