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

// The storage key this page restored its cart under. Every mutation used to
// persist to DEFAULT_STORAGE_KEY no matter which scope was restored, so a
// webview/QR cart vanished on refresh and clearCart(tokenKey) removed nothing.
let _activeKey = DEFAULT_STORAGE_KEY;

function _key(key) {
    return key || _activeKey || DEFAULT_STORAGE_KEY;
}

/**
 * Get the storage key for the QR dine-in flow.
 * Scoped to the table sessionId so the basket survives refreshes for the same
 * table session but never leaks into another table's session.
 *
 * The sessionId is passed explicitly: this module cannot read session.js's
 * `Session` (it is an ES-module export, not a browser global), and importing it
 * here would create a session.js <-> cart.js cycle.
 */
export function getQRStorageKey(sessionId) {
    return sessionId ? `foodhubbie_cart_qr_${sessionId}` : DEFAULT_STORAGE_KEY;
}

/**
 * Point future mutations at `key` WITHOUT touching the in-memory lines.
 * Used when a QR session is created: the basket is empty at that moment and has
 * to move from the default key to the session key before the first addLine().
 */
export function setCartScope(key) {
    _activeKey = _key(key);
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
 * Writes to both sessionStorage (fast, survives refresh) and localStorage
 * (backup, survives browser restart / tab close).
 *
 * The two stores are written independently: a browser that denies localStorage
 * (private mode, storage pressure, embedded webviews) must still get the
 * sessionStorage copy, so one failing store can never blank the other.
 *
 * Only CONTEXT-SCOPED keys get a durable backup. The default key is shared by
 * the direct/app flow AND by the QR flow before a table session exists, so a
 * durable copy of it would let an old app basket surface on a scanned table
 * (wrong items, wrong outlet). A scoped key (qr_<sessionId> / webview_<token>)
 * belongs to exactly one visit, so its backup can only ever come back to that
 * same visit.
 */
function _isScopedKey(key) {
    return key.startsWith('foodhubbie_cart_qr_') || key.startsWith('foodhubbie_cart_webview_');
}

function _persistCart(key) {
    const payload = JSON.stringify(Cart.lines);
    try { sessionStorage.setItem(key, payload); }
    catch (e) { console.warn('[Cart] sessionStorage error:', e); }
    if (!_isScopedKey(key)) return;
    try { localStorage.setItem(key + '_backup', payload); }
    catch (e) { /* private mode / storage disabled — sessionStorage still holds the cart */ }
}

export const Cart = {
    lines: {},   // { lineId: { dishId, name, img, size, addons:[names], qty, unitPrice, instructions } }
};

/**
 * Restore cart from sessionStorage using the provided key.
 * Falls back to default key if no key provided (backward compatibility).
 */
export function restoreCart(key) {
    _activeKey = _key(key);
    const storageKey = _activeKey;
    let saved = null;
    try { saved = sessionStorage.getItem(storageKey); }
    catch (e) { /* storage disabled */ }
    if (!saved) {
        // Fall back to the localStorage backup (survives browser restart / tab close).
        // Only context-scoped keys have one — see _persistCart().
        if (_isScopedKey(storageKey)) {
            try { saved = localStorage.getItem(storageKey + '_backup'); }
            catch (e) { /* storage disabled — nothing else to restore from */ }
            if (saved) { try { sessionStorage.setItem(storageKey, saved); } catch (e) {} }
        }
    }
    try { Cart.lines = saved ? JSON.parse(saved) : {}; }
    catch { Cart.lines = {}; }
    // Repaint the badge/bar for the restored lines — restoring used to be
    // silent, so a reload with items in the cart showed no count.
    window.dispatchEvent(new CustomEvent('cart:changed'));
}

/**
 * Add a line to the cart and persist using the provided key.
 */
export function addLine(line, key) {
    const lineId = `${line.dishId}_${line.size}_${(line.addons || []).join('-')}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '_') + Math.random().toString(36).slice(2, 6);
    const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0;
    const qty = typeof line.qty === 'number' && line.qty > 0 ? line.qty : 1;
    Cart.lines[lineId] = { ...line, unitPrice, qty };
    _persistCart(_key(key));
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
    _persistCart(_key(key));
    window.dispatchEvent(new CustomEvent('cart:changed'));
}

/**
 * Clear the in-memory cart and remove it from both stores.
 */
export function clearCart(key) {
    Cart.lines = {};
    const k = _key(key);
    try { sessionStorage.removeItem(k); } catch (e) {}
    try { localStorage.removeItem(k + '_backup'); } catch (e) {}
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
