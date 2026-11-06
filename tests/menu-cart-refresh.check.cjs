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
    const { Cart, restoreCart, addLine, setQty, clearCart, getWebviewStorageKey, getQRStorageKey, setCartScope } = cart;
    const line = (dishId) => ({ dishId, name: dishId, img: '', size: 'Regular', addons: [], unitPrice: 100, qty: 1 });

    // QR keys come from the session id the caller passes; the old helper read a
    // non-existent global `Session`, so every QR basket silently shared the
    // default key (and could be restored at a different table).
    assert.equal(getQRStorageKey('S1'), 'foodhubbie_cart_qr_S1', 'QR key is session-scoped');
    assert.notEqual(getQRStorageKey('S1'), getQRStorageKey('S2'), 'different sessions never share a key');
    assert.equal(getQRStorageKey(), 'foodhubbie_cart', 'no session id falls back to the default key');

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

    // A QR session created on the first add moves the scope without dropping
    // the draft that triggered it.
    store.clear();
    restoreCart(getQRStorageKey());
    addLine(line('d4'));
    assert.ok(store.has('foodhubbie_cart'), 'QR basket starts on the default key before a session exists');
    setCartScope(getQRStorageKey('S1'));
    assert.ok(store.has('foodhubbie_cart'), 'switching scope does not rewrite storage on its own');
    addLine(line('d5'));
    assert.equal(Object.keys(JSON.parse(store.get('foodhubbie_cart_qr_S1'))).length, 2, 'in-memory lines move to the session key on the next mutation');
    restoreCart(getQRStorageKey('S1'));
    assert.equal(Object.keys(Cart.lines).length, 2, 'the session basket survives a reload');

    // ---- 2. source guards ------------------------------------------------
    const app = read('menu/js/app.js');
    const session = read('menu/js/session.js');

    // Refresh must not lose the guest's own bill: restoring the saved group
    // while staff settle it (billing) or after payment (paid) is the fix for
    // the "Split or Share? / No joinable groups" dead end.
    const restoreAt = session.indexOf('const savedGroup =');
    const restoreBlock = restoreAt >= 0 ? session.slice(restoreAt, restoreAt + 700) : '';
    assert.ok(/savedGroup\.status === 'billing'/.test(restoreBlock), 'a bill being settled still restores the guest group');
    assert.ok(/savedGroup\.status === 'paid'/.test(restoreBlock), 'a paid group still restores (receipt view)');

    assert.ok(/export function detachSessionListeners\(/.test(session), 'session.js exports detachSessionListeners');
    assert.ok(/export function reattachSessionWatch\(/.test(session), 'session.js exports reattachSessionWatch');
    assert.ok(/export function cleanupSession\([\s\S]{0,120}?detachSessionListeners\(\)/.test(session), 'cleanupSession still tears listeners down');

    const cleanupStart = session.indexOf('export function cleanupSession(');
    const cleanupBody = session.slice(cleanupStart, cleanupStart + 600);
    assert.ok(/removeItem\(`_pizza_group_\$\{Session\.sessionId\}`\)/.test(cleanupBody), 'a real session end still drops the group choice');
    assert.ok(/clearCart\(getQRStorageKey\(Session\.sessionId\)\)/.test(cleanupBody), 'a real session end still clears the session cart');

    const unload = app.match(/window\.addEventListener\('(?:beforeunload|pagehide)'[\s\S]*?\);/g) || [];
    assert.equal(unload.length, 2, 'both unload listeners are present');
    unload.forEach((h) => {
        assert.ok(/detachSessionListeners\(\)/.test(h), 'unload detaches listeners');
        assert.ok(!/cleanupSession\(\)/.test(h), 'unload must NOT clear the cart / group choice');
    });
    assert.ok(/addEventListener\('pageshow',[\s\S]{0,80}e\.persisted[\s\S]{0,80}reattachSessionWatch\(\)/.test(app), 'bfcache restore re-arms the session watch');
    assert.ok(/const qrKey = getQRStorageKey\(Session\.sessionId\);[\s\S]{0,120}?setCartScope\(qrKey\)/.test(app), 'the first QR add binds the basket to the session key');

    // ---- 3. toast surface ------------------------------------------------
    // ui.js bails out (and wedges _toastShowing) when #toast is missing, so the
    // prune announcement — and every other customer message — silently vanished.
    const html = read('menu/index.html');
    const ui = read('menu/js/ui.js');
    assert.ok(/id="toast"/.test(html), 'menu/index.html has the #toast element');
    assert.ok(/getElementById\('toast'\)/.test(ui), 'ui.js showToast targets #toast');
    assert.ok(/if \(!t\) \{ _toastShowing = false; return; \}/.test(ui), 'a missing surface can never wedge the toast queue');

    const css = read('menu/css/app.css');
    const toastRule = (css.match(/\.toast\{[^}]*\}/) || [''])[0];
    assert.ok(toastRule, 'app.css defines .toast');
    const toastZ = Number((toastRule.match(/z-index:(\d+)/) || [])[1]);
    const onbZ = Number((css.match(/\.onb-overlay\{[^}]*z-index:(\d+)/) || [])[1]);
    assert.ok(toastZ > onbZ, 'toast renders above the onboarding sheet');
    const toastBottom = Number((toastRule.match(/bottom:calc\((\d+)px/) || [])[1]);
    assert.ok(toastBottom >= 120, 'toast clears the bottom nav + cart bar');
    assert.ok(/width:max-content/.test(toastRule), 'toast sizes to its message, not 50vw');

    console.log('menu-cart-refresh OK — scope + unload + toast guards pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
