// Menu cart persistence — the customer's basket must survive a refresh.
// Run: node tests/menu-cart-refresh.check.cjs
//
// Two regressions are guarded here:
//   1. cart.js used to persist every mutation to DEFAULT_STORAGE_KEY no matter
//      which scope restoreCart() had loaded, so a webview/QR basket vanished.
//   2. app.js unload handlers called cleanupSession(), which deleted the cart
//      key and the group choice — so scanning a QR, adding an item and hitting
//      refresh emptied the basket.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
    // ---- 1. cart.js scope behaviour (DOM stubbed) -------------------------
    const store = new Map();
    globalThis.sessionStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        get length() { return store.size; },
        key: (i) => [...store.keys()][i],
    };
    globalThis.window = { dispatchEvent() {} };
    globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

    const cart = await import(require('url').pathToFileURL(path.join(ROOT, 'menu/js/cart.js')).href);
    const { Cart, restoreCart, addLine, setQty, clearCart, getWebviewStorageKey } = cart;
    const line = (dishId) => ({ dishId, name: dishId, img: '', size: 'Regular', addons: [], unitPrice: 100, qty: 1 });

    restoreCart('foodhubbie_cart_webview_T1');
    const id = addLine(line('d1'));
    assert.ok(store.has('foodhubbie_cart_webview_T1'), 'mutation persists under the restored token key');
    assert.ok(!store.has('foodhubbie_cart'), 'mutation never leaks into the default key');
    restoreCart('foodhubbie_cart_webview_T1');
    assert.equal(Cart.lines[id].dishId, 'd1', 'basket survives a reload');
    setQty(id, 3);
    assert.equal(JSON.parse(store.get('foodhubbie_cart_webview_T1'))[id].qty, 3, 'qty persists under the same key');

    store.set('foodhubbie_cart', JSON.stringify({ keep: { dishId: 'keep', qty: 1, unitPrice: 1 } }));
    clearCart();
    assert.ok(!store.has('foodhubbie_cart_webview_T1'), 'clearCart removes the restored scope');
    assert.ok(store.has('foodhubbie_cart'), 'an unrelated default basket is untouched');

    store.clear();
    restoreCart(getWebviewStorageKey(''));
    addLine(line('d2'));
    assert.ok(store.has('foodhubbie_cart'), 'direct mode uses the default key');
    addLine(line('d3'), 'scope_b');
    assert.ok(store.has('scope_b'), 'an explicit key still overrides the restored scope');

    // ---- 2. source guards ------------------------------------------------
    const app = read('menu/js/app.js');
    const session = read('menu/js/session.js');

    assert.ok(/export function detachSessionListeners\(/.test(session), 'session.js exports detachSessionListeners');
    assert.ok(/export function cleanupSession\([\s\S]{0,120}?detachSessionListeners\(\)/.test(session), 'cleanupSession still tears listeners down');

    const cleanupStart = session.indexOf('export function cleanupSession(');
    const cleanupBody = session.slice(cleanupStart, cleanupStart + 600);
    assert.ok(/removeItem\(`_pizza_group_\$\{Session\.sessionId\}`\)/.test(cleanupBody), 'a real session end still drops the group choice');
    assert.ok(/clearCart\(getQRStorageKey\(\)\)/.test(cleanupBody), 'a real session end still clears the cart');

    const unload = app.match(/window\.addEventListener\('(?:beforeunload|pagehide)'[\s\S]*?\);/g) || [];
    assert.equal(unload.length, 2, 'both unload listeners are present');
    unload.forEach((h) => {
        assert.ok(/detachSessionListeners\(\)/.test(h), 'unload detaches listeners');
        assert.ok(!/cleanupSession\(\)/.test(h), 'unload must NOT clear the cart / group choice');
    });

    // ---- 3. toast surface ------------------------------------------------
    // ui.js bails out (and wedges _toastShowing) when #toast is missing, so the
    // prune announcement — and every other customer message — silently vanished.
    assert.ok(/id="toast"/.test(read('menu/index.html')), 'menu/index.html has the #toast element');
    assert.ok(/getElementById\('toast'\)/.test(read('menu/js/ui.js')), 'ui.js showToast targets #toast');

    console.log('menu-cart-refresh OK — scope + unload + toast guards pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
