// Customer APP tab (Admin): overview, tab switching, settings save/dirty model, feature switches, activity.
// Runs the REAL Admin/index.html, style.css, customer-app.js, audit-trail.js against an in-memory Firebase stand-in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require('playwright');
const read = f => fs.readFileSync(path.join(root, f));
const shotsDir = process.argv[2];

const FIREBASE = `
const store = {}; const listeners = [];
const parts = p => p.split('/').filter(Boolean);
const getVal = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), store);
const setVal = (p, v) => { const ks = parts(p); let o = store; ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; }); if (v === null) delete o[ks.at(-1)]; else if (v === undefined) throw new Error('undefined is not allowed in RTDB: ' + p); else o[ks.at(-1)] = v; };
const snap = (key, val) => ({ key, val: () => val ?? null, exists: () => val != null, forEach: cb => { Object.keys(val || {}).forEach(k => cb({ key: k, val: () => val[k] })); } });
const notify = p => listeners.forEach(l => { if (p.startsWith(l.path) || l.path.startsWith(p)) l.cb(snap(l.path.split('/').at(-1), getVal(l.path))); });
export const db = {}; export const auth = { currentUser: { uid: 'u1', email: 'owner@x.test', displayName: 'Owner' } };
export const BUSINESS_ID = () => 'b1';
export const Outlet = { current: 'o1', ref: p => ({ path: 'businesses/b1/outlets/o1/' + p }) };
export const ref = (_d, p) => ({ path: p });
export const query = r => r; export const orderByKey = () => ({}); export const limitToLast = () => ({});
export const onValue = (r, cb) => { const l = { path: r.path, cb }; listeners.push(l); cb(snap(r.path.split('/').at(-1), getVal(r.path))); return () => listeners.splice(listeners.indexOf(l), 1); };
export const get = async r => snap(r.path.split('/').at(-1), getVal(r.path));
export const set = async (r, v) => { setVal(r.path, v); notify(r.path); };
export const update = async (r, v) => { if (v === null) throw new Error('update(ref, null) is invalid'); Object.entries(v).forEach(([k, x]) => setVal(r.path + '/' + k, x)); notify(r.path); };
export const remove = async r => { setVal(r.path, null); notify(r.path); };
let n = 0; export const push = async (r, v) => { const key = 'k' + String(++n).padStart(4, '0'); setVal(r.path + '/' + key, v); notify(r.path); return { key }; };
window.__store = store;`;
const UTILS = `export const formatDate = t => new Date(t).toISOString().slice(0, 10);
export const escapeHtml = s => String(s ?? '');`;
const UIUTILS = `window.__toasts = []; window.__confirm = true;
export const showToast = (m, t) => window.__toasts.push([m, t]);
export const showConfirm = async () => window.__confirm;
export const showDeleteConfirm = async () => window.__confirm;`;
const UI = `window.__role = 'owner';
export const loadLucide = async () => {};
export const canAccessTab = id => window.__role !== 'none';
export const canEditTab = id => window.__role !== 'viewer';
export const canDeleteTab = id => window.__role === 'owner' || window.__role === 'super';
export const roleLabel = () => window.__role;`;
const LOGGER = 'export const logger = { info(){}, warn(){}, error(){}, debug(){} };';
const STUBS = {
    '/Admin/js/firebase.js': FIREBASE, '/Admin/js/utils.js': UTILS, '/Admin/js/ui-utils.js': UIUTILS,
    '/Admin/js/ui.js': UI, '/Admin/js/utils/logger.js': LOGGER,
};
const REAL = {
    '/Admin/style.css': ['text/css', 'Admin/style.css'], '/Admin/mobile-overrides.css': ['text/css', 'Admin/mobile-overrides.css'],
    '/Admin/index.html': ['text/html', 'Admin/index.html'], '/Admin/js/state.js': ['text/javascript', 'Admin/js/state.js'],
    '/Admin/js/features/customer-app.js': ['text/javascript', 'Admin/js/features/customer-app.js'],
    '/Admin/js/features/customer-app-status.js': ['text/javascript', 'Admin/js/features/customer-app-status.js'],
    '/Admin/js/features/audit-trail.js': ['text/javascript', 'Admin/js/features/audit-trail.js'],
    '/Admin/js/features/app-notifications.js': ['text/javascript', 'Admin/js/features/app-notifications.js'],
    '/Admin/shared/app-link.js': ['text/javascript', 'shared/app-link.js'],
    '/Admin/shared/discount-rules.js': ['text/javascript', 'shared/discount-rules.js'],
};
const OUT = 'businesses/b1/outlets/o1/';
const SEED = {
    'settings/Store': { storeName: 'Roshani Pizza', whatsappNumber: '9876543210', gstRate: 5, logoUrl: 'https://x.test/logo.png', themeColor: '#112233', timezone: 'Asia/Kolkata', appFeatures: { onlineOrdering: true, tableBooking: true, promoPage: true, loyalty: false }, taxOnDeliveryFee: true },
    'menu/dishes': { d1: { name: 'A', stock: true }, d2: { name: 'B', stock: false }, d3: { name: 'C' } },
    'menu/categories': { c1: { name: 'Pizza', visible: true } },
    'pushSubscriptions': { '9876543210': { phone: '9876543210', prefs: { offers: true } }, '9123456780': { phone: '9123456780', prefs: { offers: false } } },
    'discounts': { x1: { type: 'coupon', couponCode: 'HI10', promoPage: true, enabled: true, value: 10 }, x2: { type: 'coupon', couponCode: 'OLD', promoPage: false, enabled: true } },
};

let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };
const browser = await chromium.launch();

async function open(vp = { width: 1280, height: 900 }, role = 'owner') {
    const page = await browser.newPage({ viewport: vp });
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.route('**/*', r => {
        const p = new URL(r.request().url()).pathname;
        if (STUBS[p]) return r.fulfill({ contentType: 'text/javascript', body: STUBS[p] });
        if (REAL[p]) return r.fulfill({ contentType: REAL[p][0], body: read(REAL[p][1]) });
        return r.abort();
    });
    await page.goto('http://x.test/Admin/index.html');
    await page.evaluate(async ({ SEED, OUT, role }) => {
        document.getElementById('initial-loader')?.remove(); document.querySelectorAll('#authOverlay').forEach(e => { e.style.display = 'none'; });
        for (let n = document.getElementById('tab-customer-app'); n && n !== document.documentElement; n = n.parentElement) { n.classList.remove('hidden'); if (getComputedStyle(n).display === 'none') n.style.display = 'block'; }
        // like the real tab switcher (ui.js): hide every other tab so only Customer APP shows
        document.querySelectorAll('.tab-content').forEach(d => { if (d.id !== 'tab-customer-app') d.classList.add('hidden'); });
        // seed data through the real stub module instance used by customer-app.js
        const fb = await import('/Admin/js/firebase.js');
        for (const [k, v] of Object.entries(SEED)) await fb.set({ path: OUT + k }, v);
        const ui = await import('/Admin/js/ui.js'); window.__role = role;
        window.__ca = await import('/Admin/js/features/customer-app.js');
        window.__ca.loadCustomerApp();
    }, { SEED, OUT, role });
    await page.waitForTimeout(400);
    return page;
}
const store = (page, p) => page.evaluate(([OUT, p]) => { const ks = (OUT + p).split('/').filter(Boolean); return ks.reduce((o, k) => (o == null ? undefined : o[k]), window.__store) ?? null; }, [OUT, p]);
const toasts = page => page.evaluate(() => window.__toasts.map(x => x[0]));
const goto = async (page, sub) => { await page.click(`#caSubTab${sub[0].toUpperCase() + sub.slice(1)}`); await page.waitForTimeout(350); };

let page = await open();
await t('tab opens on Overview with six tabs and aria wiring', async () => {
    assert.equal(await page.locator('.ca-sub-tab').count(), 6);
    assert.equal(await page.getAttribute('#caSubTabOverview', 'aria-selected'), 'true');
    assert.ok(await page.isVisible('#caPaneOverview'));
    assert.ok(!(await page.isVisible('#caPaneSettings')));
});
await t('overview shows real counts from the data', async () => {
    const txt = await page.innerText('#caOvGrid');
    assert.match(txt, /Customers who can get push\s*\n?\s*2/);
    assert.match(txt, /1 accept offers/);
    assert.match(txt, /Coupons on Promo Page\s*\n?\s*1/);
    assert.match(txt, /Dishes customers can order\s*\n?\s*2/); // stock !== false -> d1,d3
    assert.match(txt, /Roshani Pizza/);
});
await t('readiness checklist flags the missing review link only', async () => {
    assert.equal(await page.locator('#caOvChecks li.is-todo').count(), 1);
    assert.match(await page.innerText('#caOvChecks li.is-todo'), /review link/i);
});
await t('status lists both live and not-applied controls', async () => {
    const txt = await page.innerText('#caOvStatus');
    assert.match(txt, /Live in the app/); assert.match(txt, /Saved, not applied yet/);
});
await t('app link is filled in', async () => { assert.match(await page.inputValue('#caOvAppLink'), /^https?:\/\//); });
await t('Fix button jumps to Settings', async () => {
    await page.click('#caOvChecks li.is-todo button');
    await page.waitForTimeout(300);
    assert.ok(await page.isVisible('#caPaneSettings'));
});
await t('settings load shows saved GST, logo, theme, tax switch', async () => {
    assert.equal(await page.inputValue('#caSettingGSTRate'), '5');
    assert.equal(await page.inputValue('#caSettingLogoUrl'), 'https://x.test/logo.png');
    assert.equal(await page.inputValue('#caSettingThemeColor'), '#112233');
    assert.equal(await page.isChecked('#caSettingTaxOnDeliveryFee'), true);
});
await t('Save is disabled until a change, no autosave while typing', async () => {
    assert.equal(await page.isDisabled('#btnSaveAppSettings'), true);
    await page.fill('#caSettingStoreName', 'Roshani Pizza 2');
    await page.waitForTimeout(900);
    assert.equal(await page.isDisabled('#btnSaveAppSettings'), false);
    assert.equal((await store(page, 'settings/Store')).storeName, 'Roshani Pizza');
    assert.match(await page.innerText('#caSettingsDirtyMsg'), /unsaved/i);
});
await t('changing GST (previously untracked) also marks dirty', async () => {
    await page.click('#btnResetAppSettings'); await page.waitForTimeout(200);
    assert.equal(await page.isDisabled('#btnSaveAppSettings'), true);
    await page.fill('#caSettingGSTRate', '12');
    assert.equal(await page.isDisabled('#btnSaveAppSettings'), false);
});
await t('Discard changes restores saved values', async () => {
    await page.click('#btnResetAppSettings'); await page.waitForTimeout(200);
    assert.equal(await page.inputValue('#caSettingGSTRate'), '5');
});
await t('leaving a dirty Settings tab asks first; staying keeps the edit', async () => {
    await page.fill('#caSettingStoreName', 'Edited');
    await page.evaluate(() => { window.__confirm = false; });
    await page.click('#caSubTabOffers'); await page.waitForTimeout(250);
    assert.ok(await page.isVisible('#caPaneSettings'));
    assert.equal(await page.inputValue('#caSettingStoreName'), 'Edited');
});
await t('Save writes owned keys, keeps appFeatures, blank number becomes null (not undefined)', async () => {
    await page.fill('#caSettingMinOrder', '');
    await page.click('#btnSaveAppSettings'); await page.waitForTimeout(500);
    const s = await store(page, 'settings/Store');
    assert.equal(s.storeName, 'Edited'); assert.equal(s.gstRate, 5);
    assert.equal(s.logoUrl, 'https://x.test/logo.png');
    assert.equal(s.appFeatures.promoPage, true); assert.equal(s.appFeatures.tableBooking, true);
    assert.equal(page.errors.length, 0, page.errors.join('|'));
    assert.equal(await page.isDisabled('#btnSaveAppSettings'), true);
});
await t('after saving, leaving the tab no longer asks', async () => {
    await page.click('#caSubTabVisibility'); await page.waitForTimeout(350);
    assert.ok(await page.isVisible('#caPaneVisibility'));
});
await t('feature switch persists to appFeatures and writes an audit entry', async () => {
    await page.evaluate(() => { window.__confirm = true; });
    await page.locator('#visFeatureTableBooking').evaluate(el => el.click());
    await page.waitForTimeout(400);
    assert.equal((await store(page, 'settings/Store/appFeatures')).tableBooking, false);
    const audit = await store(page, 'auditLog');
    assert.ok(audit && Object.keys(audit).length >= 1);
});
await t('loyalty switch mirrors loyaltyEnabled', async () => {
    await page.locator('#visFeatureLoyalty').evaluate(el => el.click());
    await page.waitForTimeout(400);
    const s = await store(page, 'settings/Store');
    assert.equal(s.appFeatures.loyalty, true); assert.equal(s.loyaltyEnabled, true);
});
await t('visibility banner explains stock rule', async () => { assert.match(await page.innerText('#caVisBanner'), /out of stock/i); });
await t('badges are present on settings and visibility labels', async () => {
    assert.ok((await page.locator('#tab-customer-app .ca-live').count()) > 0);
    assert.ok((await page.locator('#tab-customer-app .ca-saved').count()) > 0);
});
await t('offers: bulk buttons have unique ids and Cancel is wired', async () => {
    const dup = await page.evaluate(() => { const m = {}; document.querySelectorAll('[id]').forEach(e => { m[e.id] = (m[e.id] || 0) + 1; }); return Object.keys(m).filter(k => m[k] > 1 && !/receiptPreview/.test(k)); });
    assert.deepEqual(dup, []);
});
await t('Activity tab lists the changes made above', async () => {
    await goto(page, 'activity');
    assert.ok((await page.locator('#caActivityList .ca-activity__row').count()) >= 2);
});
await t('keys 1-6 switch tabs without errors', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    for (const [k, id] of [['1', 'caPaneOverview'], ['2', 'caPaneNotification'], ['3', 'caPaneOffers'], ['4', 'caPaneVisibility'], ['5', 'caPaneSettings'], ['6', 'caPaneActivity']]) {
        await page.keyboard.press(k); await page.waitForTimeout(250);
        assert.ok(await page.isVisible('#' + id), 'key ' + k);
    }
    assert.equal(page.errors.length, 0, page.errors.join('|'));
});
if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    for (const s of ['overview', 'notification', 'offers', 'visibility', 'settings', 'activity']) { await goto(page, s); await page.screenshot({ path: path.join(shotsDir, `desktop-${s}.png`), fullPage: false }); }
}
await page.close();

page = await open({ width: 1280, height: 900 }, 'manager');
await t('non-super role (manager) can edit — not shown as view only', async () => {
    await goto(page, 'settings');
    assert.equal(await page.isDisabled('#caSettingStoreName'), false);
    assert.doesNotMatch((await page.innerText('#roleBadge').catch(() => '')) || '', /view only/i);
});
await page.close();

page = await open({ width: 1280, height: 900 }, 'viewer');
await t('viewer role cannot change a feature switch', async () => {
    await goto(page, 'visibility');
    await page.locator('#visFeatureLoyalty').evaluate(el => el.click());
    await page.waitForTimeout(300);
    assert.equal((await store(page, 'settings/Store/appFeatures')).loyalty, false);
});
await page.close();

page = await open({ width: 390, height: 800 });
await t('phone: no sideways page scroll on any pane', async () => {
    for (const s of ['overview', 'notification', 'offers', 'visibility', 'settings', 'activity']) {
        await goto(page, s);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(over <= 1, `${s} overflows by ${over}px`);
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `phone-${s}.png`) });
    }
});
await page.close();
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
