// Direct-mode (no table) check: real menu app in headless Chromium, Firebase CDN
// modules replaced by an in-memory stub. Not a substitute for a real-device test.
// Run: NODE_PATH=$(npm root -g) node tests/direct-mode.check.mjs
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// menu/ is the hosting root in production (absolute /css, /js, /shared URLs)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'menu');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const DB = {
    businesses: { 'roshani-pizza': { outlets: { pizza: {
        settings: { Store: { storeName: 'Roshani Pizza', lat: 25.888, lng: 85.026 }, Delivery: { slabs: [{ km: 3, fee: 30 }, { km: 10, fee: 60 }] } },
        categories: { c1: { name: 'Pizza', order: 1 } },
        dishes: { d1: { name: 'Margherita', category: 'c1', price: 199, stock: true, sizes: [{ label: 'Regular', price: 199 }] } },
        customers: { '9876543210': {
            loyalty: { phone: '9876543210', lifetimePoints: 1200, pointsSpent: 200, totalSpent: 2400, orderCount: 2, tier: 'silver', updatedAt: 1 },
            orders: {
                A100: { orderId: 'A100', status: 'Delivered', total: 398, createdAt: 2000, paymentStatus: 'Paid', paymentMethod: 'UPI', paidAt: 2500, source: 'QR', itemsSummary: [{ name: 'Margherita', qty: 2 }] },
                A200: { orderId: 'A200', status: 'Out for Delivery', total: 250, createdAt: 4000, source: 'APP', orderMode: 'delivery', paymentStatus: 'Pending', riderName: 'Amit', riderPhone: '9123456780', deliveryOtp: '4821', itemsSummary: [{ name: 'Pasta', qty: 1 }] },
                A201: { orderId: 'A201', status: 'Placed', total: 120, createdAt: 4100, source: 'APP', orderMode: 'pickup', paymentStatus: 'Pending', itemsSummary: [{ name: 'Cola', qty: 2 }] },
                A101: { orderId: 'A101', status: 'Out for Delivery', total: 199, createdAt: 3000, paymentStatus: 'Pending', source: 'webview_delivery', itemsSummary: [{ name: 'Garlic Bread', qty: 1 }] }
            }
        } },
        tables: { t1: { number: 7, token: 'GOODTOKEN', capacity: 4, status: 'free' } }
    } } } }
};
const dbStub = `
const DB = ${JSON.stringify(DB)};
window.__writes = [];
const at = (p) => p.split('/').filter(Boolean).reduce((n, k) => (n == null ? n : n[k]), DB);
const put = (p, v) => { const ks = p.split('/').filter(Boolean); let n = DB; ks.slice(0, -1).forEach(k => { n[k] = (n[k] && typeof n[k] === 'object') ? n[k] : {}; n = n[k]; }); n[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
const snap = (v) => ({ exists: () => v != null, val: () => (v === undefined ? null : v), forEach: (f) => { Object.entries(v || {}).forEach(([k, x]) => f({ key: k, val: () => x })); }, key: null });
export const getDatabase = () => ({});
export const ref = (db, p) => ({ path: p || '', key: (p || '').split('/').pop() });
export const get = async (r) => snap(at(r.path));
export const onValue = (r, cb) => { Promise.resolve().then(() => cb(snap(at(r.path)))); return () => {}; };
export const set = async (r, v) => { if (r.path.includes('/devices/') && window.__denyDevice && !(v && v.code && v.code === window.__linkCode)) throw new Error('PERMISSION_DENIED'); window.__writes.push({ path: r.path, value: JSON.parse(JSON.stringify(v)) }); put(r.path, v); };
export const update = async (r, o) => { window.__writes.push({ path: r.path, update: o }); const cur = at(r.path) || {}; put(r.path, { ...cur, ...o }); };
export const push = (r) => { const k = 'k' + Math.random().toString(36).slice(2, 8); return { path: r.path + '/' + k, key: k }; };
export const runTransaction = async (r, fn) => { const cur = at(r.path); const nv = fn(cur === undefined ? null : cur); put(r.path, nv); return { committed: true, snapshot: snap(nv) }; };
`;
const STUBS = {
    'firebase-app.js': 'export const initializeApp = () => ({});',
    'firebase-database.js': dbStub,
    'firebase-auth.js': 'export const getAuth = () => ({ currentUser: null }); export const signInAnonymously = async () => ({ user: { uid: "ANON-TEST", getIdToken: async () => "t" } });',
    'firebase-messaging.js': 'export const getMessaging = () => ({}); export const getToken = async () => null; export const onMessage = () => () => {}; export const deleteToken = async () => true;',
};

const browser = await chromium.launch();
let failures = 0;
async function scenario(name, fn) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'www.gstatic.com') {
            const f = u.pathname.split('/').pop();
            return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export {};' });
        }
        if (u.hostname.startsWith('localhost')) return route.continue();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try { await fn(page, ctx); console.log('PASS', name); }
    catch (e) { failures++; console.log('FAIL', name, '-', e.message, (e.stack||'').split('\n').find(l=>l.includes('direct-mode.check'))); }
    if (errors.length) { failures++; console.log('  page errors:', errors.slice(0, 3)); }
    await ctx.close();
}
const active = (page) => page.evaluate(() => document.querySelector('.screen.active')?.id);
const URL_DIRECT = `${base}/index.html?o=pizza&b=roshani-pizza`;

await scenario('first open (no table) shows sign-in, not "invalid QR"', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenSignIn', null, { timeout: 8000 });
    assert.equal(await page.textContent('#signInBrand'), 'Roshani Pizza');
});

await scenario('bad phone is rejected, name stays optional', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '12345');
    await page.click('#btnSignIn');
    assert.match(await page.textContent('#signInError'), /10-digit/);
    assert.equal(await active(page), 'screenSignIn');
});

await scenario('phone only (no name) signs in and lands on the full menu', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    assert.match(await page.textContent('#screenMenu'), /Margherita/, 'menu items are shown');
    const prof = JSON.parse(await page.evaluate(() => Object.entries(localStorage).find(([k]) => /profile/i.test(k))?.[1] || 'null'));
    assert.equal(prof.phone, '9876543210'); assert.equal(prof.name, 'Guest');
});

await scenario('returning visitor skips sign-in and sees the menu first', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210'); await page.fill('#signInName', 'Rahul');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.goto(URL_DIRECT);
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenMenu', null, { timeout: 8000 });
    assert.match(await page.textContent('#menuGreeting'), /Rahul/);
});

await scenario('notification tap (?tab=orders) opens the Orders tab for a signed-in customer', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.goto(URL_DIRECT + '&tab=orders');
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenOrders', null, { timeout: 8000 });
    await page.waitForSelector('.account-order-card', { timeout: 5000 });
});

await scenario('invalid ?t= still shows the invalid-QR screen', async (page) => {
    await page.goto(URL_DIRECT + '&t=WRONG');
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenInvalid', null, { timeout: 8000 });
});

await scenario('valid table token still opens dine-in (welcome screen)', async (page) => {
    await page.goto(URL_DIRECT + '&t=GOODTOKEN');
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenWelcome', null, { timeout: 8000 });
});

await scenario('table older than 4h is forgotten; recent one is reused', async (page) => {
    await page.goto(URL_DIRECT + '&t=GOODTOKEN');
    await page.waitForSelector('#screenWelcome.active');
    await page.goto(URL_DIRECT);                     // same visit: back to the table
    await page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screenWelcome', null, { timeout: 8000 });
    await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('fh_last_table_at')); localStorage.setItem(k, String(Date.now() - 5 * 3600 * 1000)); });
    await page.goto(URL_DIRECT);                     // next day: restaurant app, not the old table
    await page.waitForFunction(() => ['screenSignIn', 'screenMenu'].includes(document.querySelector('.screen.active')?.id), null, { timeout: 8000 });
});

const signInAndAddDish = async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210'); await page.fill('#signInName', 'Rahul');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.getByText('Margherita').first().click();
    await page.waitForSelector('#screenCustomize.active');
    await page.click('#btnAddToOrder');
    await page.waitForSelector('#screenMenu.active');
    await page.evaluate(() => document.getElementById('btnOpenCartFromMenu').click());
    await page.waitForSelector('#screenCart.active');
    await page.evaluate(() => document.getElementById('btnPlaceOrder').click());
    await page.waitForSelector('#screenCheckout.active');
};
const orderWrites = (page) => page.evaluate(() => window.__writes.filter(w => /\/orders\/[^/]+$/.test(w.path) && !/\/customers\//.test(w.path)));

await scenario('direct-mode: Place order opens the in-app checkout, prefilled', async (page) => {
    await signInAndAddDish(page);
    assert.equal(await page.inputValue('#coName'), 'Rahul');
    assert.equal(await page.inputValue('#coPhone'), '9876543210');
    assert.match(await page.textContent('#coLines'), /Item total/);
    assert.deepEqual(await orderWrites(page), [], 'nothing written yet');
});

await scenario('pickup order: written with source APP, no address, no fee, payment pending', async (page) => {
    await signInAndAddDish(page);
    await page.click('[data-co-mode="pickup"]');
    assert.equal(await page.isVisible('#coAddressWrap'), false);
    assert.match(await page.textContent('#btnCoPlace'), /PICKUP/);
    await page.fill('#coNote', 'no onion');
    await page.click('#btnCoPlace');
    await page.waitForSelector('#screenOrders.active', { timeout: 8000 });
    const w = await orderWrites(page);
    assert.equal(w.length, 1);
    const o = w[0].value;
    assert.equal(o.source, 'APP'); assert.equal(o.channel, 'app'); assert.equal(o.type, 'Pickup'); assert.equal(o.orderMode, 'pickup');
    assert.equal(o.status, 'Placed'); assert.equal(o.paymentStatus, 'Pending'); assert.equal(o.stockDeducted, false);
    assert.equal(o.appUid, 'ANON-TEST'); assert.equal(o.phone, '9876543210'); assert.equal(o.customerName, 'Rahul');
    assert.equal(o.deliveryFee, 0); assert.equal(o.address, undefined); assert.equal(o.lat, undefined);
    assert.equal(o.subtotal, 199); assert.equal(o.total, 208.95, '199 + 5% GST');
    assert.equal(o.note, 'no onion'); assert.equal(o.items.length, 1); assert.equal(o.items[0].quantity, 1);
    assert.match(o.createdAt, /^\d{4}-\d{2}-\d{2}T/); assert.equal(o.assignedRider, null);
    // history entry for the Orders tab
    const mirror = await page.evaluate(() => window.__writes.find(x => /customers\/9876543210\/orders\//.test(x.path))?.value);
    assert.equal(mirror.source, 'APP'); assert.equal(mirror.orderMode, 'pickup'); assert.equal(mirror.paymentStatus, 'Pending'); assert.equal(mirror.total, 208.95);
    // cart emptied
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => /cart/i.test(k) && sessionStorage.getItem(k) && sessionStorage.getItem(k) !== '[]' && sessionStorage.getItem(k) !== '{}').length), 0, 'cart emptied');
});

await scenario('delivery order: needs location + address, fee from slabs, COD', async (page, ctx) => {
    await ctx.grantPermissions(['geolocation']);
    await ctx.setGeolocation({ latitude: 25.889, longitude: 85.027 });  // ~0.15 km from the store
    await signInAndAddDish(page);
    // no location yet: button asks for it instead of ordering
    assert.match(await page.textContent('#btnCoPlace'), /SHARE LOCATION/);
    await page.click('#btnCoPlace');
    await page.waitForFunction(() => /Location shared/.test(document.getElementById('coLocStatus')?.textContent || ''), null, { timeout: 8000 });
    assert.match(await page.textContent('#coLines'), /Delivery fee/);
    // address is required
    await page.click('#btnCoPlace');
    assert.deepEqual(await orderWrites(page), [], 'refused without an address');
    await page.fill('#coAddress', 'Flat 4, MG Road, near the temple');
    await page.click('#btnCoPlace');
    await page.waitForSelector('#screenOrders.active', { timeout: 8000 });
    const o = (await orderWrites(page))[0].value;
    assert.equal(o.type, 'Online'); assert.equal(o.orderMode, 'delivery'); assert.equal(o.source, 'APP');
    assert.equal(o.deliveryFee, 30); assert.equal(o.total, 238.95, '199 + 9.95 GST + 30 fee (fee outside tax)');
    assert.equal(o.paymentMethod, 'COD'); assert.equal(o.paymentStatus, 'Pending');
    assert.equal(o.address, 'Flat 4, MG Road, near the temple'); assert.equal(typeof o.lat, 'number'); assert.ok(o.distanceKm >= 0);
});

await scenario('checkout validates name and phone', async (page) => {
    await signInAndAddDish(page);
    await page.click('[data-co-mode="pickup"]');
    await page.fill('#coPhone', '12345');
    await page.click('#btnCoPlace');
    assert.deepEqual(await orderWrites(page), []);
    assert.equal(await active(page), 'screenCheckout');
});

await scenario('tracking: delivery steps, rider and delivery code; pickup steps; cancel only while Placed', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.click('[data-bottom-tab="screenOrders"]');
    await page.waitForSelector('.account-order-card[data-order-id="A200"]', { timeout: 5000 });
    const del = await page.textContent('.account-order-card[data-order-id="A200"]');
    assert.match(del, /On the way/); assert.match(del, /Amit/); assert.match(del, /4821/); assert.match(del, /Delivery code/);
    assert.equal(await page.locator('.account-order-card[data-order-id="A200"] [data-cancel-order]').count(), 0, 'no cancel once on the way');
    const pick = await page.textContent('.account-order-card[data-order-id="A201"]');
    assert.match(pick, /Collected/); assert.doesNotMatch(pick, /On the way/);
    assert.equal(await page.locator('.account-order-card[data-order-id="A201"] [data-cancel-order]').count(), 1);
    page.on('dialog', d => d.accept());
    await page.click('.account-order-card[data-order-id="A201"] [data-cancel-order]');
    await page.waitForFunction(() => window.__writes.some(w => /orders\/A201\/status$/.test(w.path) && w.value === 'Cancelled'), null, { timeout: 5000 });
    await page.waitForFunction(() => /cancelled/i.test(document.querySelector('.account-order-card[data-order-id="A201"]')?.textContent || ''), null, { timeout: 5000 });
});

await scenario('dedicated-app tabs: Menu, Cart, Orders, Loyalty, Account', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210'); await page.fill('#signInName', 'Rahul');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    const labels = await page.$$eval('#bottomNav .bottom-nav-item', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => [...e.querySelectorAll('span')].pop().textContent.trim()));
    assert.deepEqual(labels, ['Menu', 'Cart', 'Orders', 'Loyalty', 'Account']);

    await page.click('[data-bottom-tab="screenOrders"]');
    await page.waitForSelector('#screenOrders.active');
    await page.waitForFunction(() => document.querySelectorAll('#ordersScreenBody .account-order-card').length === 4, null, { timeout: 5000 });
    const ordersText = await page.textContent('#ordersScreenBody');
    assert.match(ordersText, /A101/); assert.match(ordersText, /Out for Delivery/); assert.match(ordersText, /Garlic Bread/);

    await page.click('[data-bottom-tab="screenLoyalty"]');
    await page.waitForSelector('#screenLoyalty.active');
    await page.waitForFunction(() => /Silver/i.test(document.getElementById('loyaltyScreenBody')?.textContent || ''), null, { timeout: 5000 });
    const loy = await page.textContent('#loyaltyScreenBody');
    assert.match(loy, /1000|Loyalty points/); // spendable = 1200 - 200
    assert.doesNotMatch(loy, /Order A100/, 'orders live on their own tab');

    await page.click('[data-bottom-tab="screenPromotions"]');
    await page.waitForSelector('#screenPromotions.active');
    await page.waitForSelector('#promoPaneAccount:not(.hidden)', { timeout: 5000 });
    assert.match(await page.textContent('#accountProfileCard'), /Rahul/);
    assert.doesNotMatch(await page.textContent('#accountProfileCard'), /Order A100/, 'account is profile-only');
});

await scenario('Payments view: paid vs pay-on-delivery, totals, details', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.click('[data-bottom-tab="screenOrders"]');
    await page.waitForFunction(() => document.querySelectorAll('#ordersScreenBody .account-order-card').length === 4, null, { timeout: 5000 });
    await page.click('[data-orders-view="payments"]');
    await page.waitForSelector('#paymentsList .pay-row', { timeout: 5000 });
    const text = await page.textContent('#ordersScreenBody');
    assert.match(text, /Paid · UPI/); assert.match(text, /Pay on delivery/);
    assert.match(text, /not a tax invoice/);
    const stats = await page.$$eval('#ordersScreenBody .account-stats .stat', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.match(stats[0], /398/); assert.match(stats[0], /Paid/); assert.match(stats[1], /569/); assert.match(stats[1], /To pay/);
    await page.click('.pay-row[data-order-id="A100"] summary');
    assert.match(await page.textContent('.pay-row[data-order-id="A100"] .pay-detail'), /Paid on/);
    await page.click('[data-orders-view="orders"]');
    await page.waitForSelector('#ordersScreenBody .account-order-card');
});

await scenario('privacy: first phone owns the number and is registered', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.waitForFunction(() => window.__writes.some(w => /customers\/9876543210\/devices\/ANON-TEST$/.test(w.path)), null, { timeout: 5000 });
    // the profile is only written after the device is registered
    const order = await page.evaluate(() => window.__writes.map(w => w.path.replace(/^.*customers\/9876543210\//, '')));
    assert.ok(order.indexOf('devices/ANON-TEST') < order.indexOf('app'), 'device registered before the profile write');
});

await scenario('privacy: number owned by another phone -> hidden data, link code unlocks', async (page) => {
    await page.addInitScript(() => { window.__denyDevice = true; window.__linkCode = '12345678'; });
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.waitForFunction(() => /already used on another phone/i.test(document.body.textContent), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__writes.some(w => /customers\/9876543210\/app$/.test(w.path))), false, 'no profile write while locked');
    await page.click('[data-bottom-tab="screenOrders"]');
    await page.waitForFunction(() => /already set up on another phone/.test(document.getElementById('ordersScreenBody')?.textContent || ''), null, { timeout: 5000 });
    // account tab: wrong code refused, right code unlocks
    await page.click('[data-bottom-tab="screenPromotions"]');
    await page.waitForSelector('#linkCodeInput', { timeout: 5000 });
    await page.fill('#linkCodeInput', '00000000'); await page.click('#btnLinkDevice');
    await page.waitForFunction(() => /wrong or has expired/i.test(document.body.textContent), null, { timeout: 5000 });
    await page.fill('#linkCodeInput', '12345678'); await page.click('#btnLinkDevice');
    await page.waitForSelector('#btnMakeLinkCode', { timeout: 5000 });
    assert.equal(await page.locator('#linkCodeInput').count(), 0, 'lock card replaced after linking');
});

await scenario('privacy: owner can make a link code (8 digits, 10 minutes)', async (page) => {
    await page.goto(URL_DIRECT);
    await page.waitForSelector('#screenSignIn.active');
    await page.fill('#signInPhone', '9876543210');
    await page.click('#btnSignIn');
    await page.waitForSelector('#screenMenu.active');
    await page.click('[data-bottom-tab="screenPromotions"]');
    await page.waitForSelector('#btnMakeLinkCode', { timeout: 5000 });
    await page.click('#btnMakeLinkCode');
    await page.waitForSelector('#linkCodeOut:not(.hidden)', { timeout: 5000 });
    assert.match(await page.textContent('#linkCodeOut'), /^\d{4} \d{4}$/);
    const w = await page.evaluate(() => window.__writes.find(x => /customers\/9876543210\/link$/.test(x.path))?.value);
    assert.match(w.code, /^\d{8}$/); assert.ok(w.exp - Date.now() > 9 * 60000 && w.exp - Date.now() <= 10 * 60000 + 2000);
});


await scenario('table (dine-in) app keeps its original tabs', async (page) => {
    await page.goto(URL_DIRECT + '&t=GOODTOKEN');
    await page.waitForSelector('#screenWelcome.active');
    const hidden = await page.$$eval('#bottomNav .direct-only', els => els.map(e => getComputedStyle(e).display));
    assert.deepEqual(hidden, ['none', 'none']);
    assert.equal(await page.textContent('#navPromosLabel'), 'Promos');
});

await browser.close(); server.close();
console.log(failures ? `${failures} FAILED` : 'direct-mode ALL PASSED');
process.exit(failures ? 1 : 0);
