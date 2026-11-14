// Guards the customer-app fixes from the Customer App audit (menu/ only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let failed = 0;
const t = (n, fn) => { try { fn(); console.log('ok  ', n); } catch (e) { failed++; console.log('FAIL', n, '-', e.message); } };

const app = read('menu/js/app.js'), ui = read('menu/js/ui.js'), cust = read('menu/js/customer.js'), home = read('menu/home.html');

t('app.js: combo limits use the imported outletRef (no bare Outlet)', () => { assert.ok(!/\bOutlet\.ref\(/.test(app)); assert.ok(/combos\/\$\{combo\.id\}\/currentRedemptions/.test(app)); });
t('app.js: sign out calls a function that exists', () => { assert.ok(!/clearWalkinCart/.test(app)); assert.ok(/sign-out'\) \{\s*clearCart\(/.test(app)); });
t('ui.js: combo "Also add" uses a callback, not undefined globals', () => {
    const body = ui.slice(ui.indexOf('export function showComboSheet'), ui.indexOf('export function hideComboSheet'));
    assert.ok(/onCrossSell/.test(body)); assert.ok(!/\baddLine\(|\bM\.dishes|_dishPrice|clearDiscountIfCartChanged/.test(body));
    assert.ok(/\}, \(\) => _addComboToCart\(combo\.id\), \(dishId\) =>/.test(app));
});
t('home.html: inline script parses (hhClose declared once)', () => {
    const m = [...home.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n');
    const f = path.join(os.tmpdir(), 'home-inline-check.mjs'); fs.writeFileSync(f, m);
    execFileSync(process.execPath, ['--check', f]);
});
t('menu honours Admin "visible:false" for dishes and categories', () => {
    const load = app.slice(app.indexOf('M.categories ='), app.indexOf('const now = Date.now();', app.indexOf('M.categories =')));
    assert.ok(/c\.visible !== false/.test(load) && /d\.visible !== false/.test(load) && /d\.stock !== false/.test(load));
});
t('unsafe DB values are escaped in HTML', () => {
    assert.ok(!/<img src="\$\{c\.image\}"/.test(app) && !/<img src="\$\{c\.image\}"/.test(read('menu/js/delivery.js')));
    assert.ok(/id="qty-\$\{esc\(id\)\}"/.test(ui) && /esc\(searchTerm\)/.test(ui));
    assert.ok(/esc\(o\.emoji/.test(cust));
});
t('promo links and notification urls only allow safe schemes', () => {
    assert.ok(/\^https\?:\\\/\\\//.test(ui.slice(ui.indexOf('].filter(l =>'), ui.indexOf('].filter(l =>') + 80)));
    assert.ok(/u\.origin === window\.location\.origin/.test(cust));
});
t('customer.js: confirm button label is per call; prefs JSON parse safe', () => {
    assert.ok(/showConfirm\(message, title = 'Confirm', okLabel = 'Confirm'\)/.test(cust));
    assert.equal((cust.match(/getItem\(PREFS_KEY\) \|\| \{\}\)/g) || []).length, 0);
    assert.ok(!/Forget everything<\/button>/.test(cust));
});
t('cart lineId is attribute-safe and unique even in the same millisecond', async () => {
    const ss = new Map(); globalThis.sessionStorage = { getItem: k => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v), removeItem: k => ss.delete(k) };
    globalThis.window = { dispatchEvent() {} }; globalThis.CustomEvent = class {};
    const { addLine, Cart } = await import(pathToFileURL(path.join(root, 'menu/js/cart.js')).href);
    const a = addLine({ dishId: 'd1', size: 'Large "x"', addons: ['Extra <b>cheese</b>'], qty: 1, unitPrice: 5 }, 'k');
    const b = addLine({ dishId: 'd1', size: 'Large "x"', addons: ['Extra <b>cheese</b>'], qty: 1, unitPrice: 5 }, 'k');
    assert.match(a, /^[A-Za-z0-9_-]+$/); assert.notEqual(a, b); assert.equal(Object.keys(Cart.lines).length, 2);
}); 
await new Promise(r => setTimeout(r, 300));
console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
