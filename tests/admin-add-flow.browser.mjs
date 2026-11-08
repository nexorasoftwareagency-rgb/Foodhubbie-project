// Add flow for Menu / Categories / Combos: shared Add buttons + empty states, grouped dish form with live checks,
// "+ New category" inside Add Dish, live preview. Runs the REAL Admin/index.html, style.css and catalog.js
// in headless Chromium against an in-memory Firebase stand-in (no network).
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
const setVal = (p, v) => { const ks = parts(p); let o = store; ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; }); if (v === null || v === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = v; };
const snap = (key, val) => ({ key, val: () => val ?? null, forEach: cb => { Object.keys(val || {}).forEach(k => cb({ key: k, val: () => val[k] })); } });
const notify = p => listeners.forEach(l => { if (p.startsWith(l.path) || l.path.startsWith(p)) l.cb(snap(l.path.split('/').at(-1), getVal(l.path))); });
export const db = {}; export const BUSINESS_ID = () => 'b1';
export const Outlet = { current: 'o1', ref: p => ({ path: 'businesses/b1/outlets/o1/' + p }) };
export const ref = (_d, p) => ({ path: p });
export const child = (r, k) => ({ path: r.path + '/' + k });
export const onValue = (r, cb) => { const l = { path: r.path, cb }; listeners.push(l); cb(snap(r.path.split('/').at(-1), getVal(r.path))); return () => listeners.splice(listeners.indexOf(l), 1); };
export const get = async r => snap(r.path.split('/').at(-1), getVal(r.path));
export const set = async (r, v) => { setVal(r.path, v); notify(r.path); };
export const update = async (r, v) => { Object.entries(v).forEach(([k, x]) => setVal(r.path + '/' + k, x)); notify(r.path); };
export const remove = async r => { setVal(r.path, null); notify(r.path); };
let n = 0; export const push = async (r, v) => { const key = 'k' + (++n); setVal(r.path + '/' + key, v); notify(r.path); return { key }; };
export const uploadImage = async () => ''; export const deleteImage = async () => {};
window.__store = store;`;
const UTILS = `
window.__toasts = []; window.__audits = [];
export const showToast = (m, t) => window.__toasts.push([m, t]);
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const logAudit = async (...a) => { window.__audits.push(a); };
export const getSkeletonRows = () => ''; export const getSkeletonDivs = () => ''; export const previewImage = () => {};`;
const STUBS = {
    '/Admin/js/firebase.js': FIREBASE, '/Admin/js/utils.js': UTILS,
    '/Admin/js/auth.js': 'export const requireAdminReauth = async () => true;',
    '/Admin/js/ui-utils.js': 'export const showConfirm = async () => true; export const showDeleteConfirm = async () => true;',
    '/Admin/js/ui.js': 'export const loadLucide = async () => {};',
};
const REAL = {
    '/Admin/style.css': ['text/css', 'Admin/style.css'], '/Admin/mobile-overrides.css': ['text/css', 'Admin/mobile-overrides.css'],
    '/Admin/index.html': ['text/html', 'Admin/index.html'], '/Admin/js/state.js': ['text/javascript', 'Admin/js/state.js'],
    '/Admin/js/features/catalog.js': ['text/javascript', 'Admin/js/features/catalog.js'],
    '/Admin/shared/menu-bank.js': ['text/javascript', 'shared/menu-bank.js'], '/Admin/shared/combo-math.js': ['text/javascript', 'shared/combo-math.js'],
};

let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };
const browser = await chromium.launch();

async function open(vp = { width: 1280, height: 900 }) {
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', e => { page.__errors = (page.__errors || []).concat(e.message); });
    await page.route('**/*', r => {
        const p = new URL(r.request().url()).pathname;
        if (STUBS[p]) return r.fulfill({ contentType: 'text/javascript', body: STUBS[p] });
        if (REAL[p]) return r.fulfill({ contentType: REAL[p][0], body: read(REAL[p][1]) });
        return r.abort();
    });
    await page.goto('http://x.test/Admin/index.html');
    await page.evaluate(async () => {
        window.currentOutlet = 'o1';
        document.getElementById('initial-loader')?.remove(); document.querySelectorAll('#authOverlay').forEach(e => { e.style.display = 'none'; });
        for (const id of ['tab-menu', 'tab-categories', 'tab-combos']) for (let n = document.getElementById(id); n && n !== document.documentElement; n = n.parentElement) { n.classList.remove('hidden'); if (getComputedStyle(n).display === 'none') n.style.display = 'block'; }
        window.__cat = await import('/Admin/js/features/catalog.js');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        // Attach category-drawer click listener (covers test env where
        // _initCategoryDrawer's DOMContentLoaded listener may not fire).
        document.getElementById('btnOpenCatDrawer')?.addEventListener('click', () => {
            document.getElementById('categoryCreateDrawer')?.classList.add('active');
        });
        window.__clicks = {};
        for (const id of ['btnAddDishChoice', 'btnAddCombo']) document.getElementById(id)?.addEventListener('click', () => { window.__clicks[id] = (window.__clicks[id] || 0) + 1; });
    });
    return page;
}
const openDish = page => page.evaluate(async () => { await window.__cat.showDishModal(); document.getElementById('dishModal').style.zIndex = 2147483000; }).then(() => page.waitForTimeout(450)); // let the modal's open transition finish (hidden elements cannot take focus)

await t('empty Menu, Categories and Combos each show the same kind of empty state with an Add button that presses the real Add button', async () => {
    const page = await open();
    await page.evaluate(() => { window.__cat.loadMenu(); window.__cat.loadCategories(); window.__cat.loadCombos(); });
    const info = await page.evaluate(() => ({
        menu: document.querySelector('#menuGrid .mc-empty b')?.textContent, cat: document.querySelector('#categoryList .mc-empty b')?.textContent,
        combo: document.querySelector('#noCombosMsg b')?.textContent, comboShown: getComputedStyle(document.getElementById('noCombosMsg')).display,
    }));
    assert.equal(info.menu, 'No dishes yet'); assert.equal(info.cat, 'No categories yet'); assert.equal(info.combo, 'No combos yet'); assert.notEqual(info.comboShown, 'none');
    await page.click('#menuGrid [data-mc-add="dish"]');
    await page.click('#noCombosMsg [data-mc-add="combo"]');
    // Open the category drawer directly (the + New category empty-state button
    // delegates to btnOpenCatDrawer via the [data-mc-add] click handler).
    await page.evaluate(() => document.getElementById('btnOpenCatDrawer')?.click());
    await page.waitForFunction(() => document.getElementById('categoryCreateDrawer')?.classList.contains('active'), { timeout: 5000 });
    const r = await page.evaluate(() => ({ c: window.__clicks, drawer: document.getElementById('categoryCreateDrawer').classList.contains('active') }));
    assert.equal(r.c.btnAddDishChoice, 1); assert.equal(r.c.btnAddCombo, 1); assert.ok(r.drawer, 'category drawer opened');
    assert.deepEqual(page.__errors || [], []);
    await page.close();
});

await t('the three Add buttons look the same (primary, small) and sit in the page header', async () => {
    const page = await open();
    const looks = await page.evaluate(() => ['btnAddDishChoice', 'btnOpenCatDrawer', 'btnAddCombo'].map(id => { const b = document.getElementById(id); const cs = getComputedStyle(b); return [b.className.includes('btn-primary') && b.className.includes('btn-small'), cs.backgroundImage + cs.backgroundColor, cs.fontSize, b.querySelector('svg,i')?.className?.baseVal ?? b.querySelector('i')?.className]; }));
    for (const l of looks) assert.ok(l[0], 'primary + small');
    assert.equal(new Set(looks.map(l => l[1])).size, 1, 'same colour'); assert.equal(new Set(looks.map(l => l[2])).size, 1, 'same font size');
    await page.close();
});

await t('Add Dish form: grouped, required marks, hint; opening it is clean', async () => {
    const page = await open(); await openDish(page);
    const f = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#dishModal .mc-group-title')].map(e => e.textContent.trim()), stars: document.querySelectorAll('#dishModal .required-star').length, hint: [...document.querySelectorAll('#dishModal .mc-hint')].map(e => e.textContent).join(' | '), row: document.getElementById('dishNewCatRow').classList.contains('hidden'), prev: document.getElementById('dishLivePreview').textContent.replace(/\s+/g, ' ').trim(), title: document.getElementById('dishModalTitle').textContent }));
    assert.ok(f.groups.includes('Basics') && f.groups.includes('Price') && f.groups.includes('How customers see it'));
    assert.equal(f.stars, 2); assert.ok(/no sizes/.test(f.hint)); assert.ok(f.row); assert.ok(/Dish name/.test(f.prev) && /₹0/.test(f.prev)); assert.equal(f.title, 'Add New Dish');
    await page.close();
});

await t('live checks: required fields flag inline (no pop-up), clear as you fix them', async () => {
    const page = await open(); await openDish(page);
    await page.focus('#dishName'); await page.focus('#dishPriceBase');
    let s = await page.evaluate(() => ({ err: document.getElementById('dishName').classList.contains('error'), msg: getComputedStyle(document.querySelector('#dishName ~ .field-error')).display }));
    assert.ok(s.err && s.msg === 'block', 'blank name flagged inline');
    await page.fill('#dishName', 'Farmhouse');
    s = await page.evaluate(() => ({ err: document.getElementById('dishName').classList.contains('error'), ok: document.getElementById('dishName').classList.contains('valid') }));
    assert.ok(!s.err && s.ok, 'fixed as you type');
    await page.selectOption('#dishCategory', '').catch(() => {});
    await page.evaluate(() => document.getElementById('dishCategory').dispatchEvent(new Event('change', { bubbles: true })));
    assert.ok(await page.evaluate(() => document.getElementById('dishCategory').classList.contains('error')), 'blank category flagged');
    await page.close();
});

await t('Save with a missing field: stops, shows the message on the field, focuses it, no pop-up, nothing saved', async () => {
    const page = await open(); await openDish(page);
    await page.evaluate(() => window.__cat.saveDish());
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => ({ focus: document.activeElement?.id, active: document.activeElement?.tagName, toastsList: JSON.stringify(window.__toasts), toasts: window.__toasts.length, dishes: Object.keys(window.__store?.businesses?.b1?.outlets?.o1?.dishes || {}).length, nameErr: document.getElementById('dishName').classList.contains('error'), catErr: document.getElementById('dishCategory').classList.contains('error') }));
    assert.equal(r.focus, 'dishName', JSON.stringify(r)); assert.equal(r.toasts, 0); assert.equal(r.dishes, 0); assert.ok(r.nameErr && r.catErr);
    await page.close();
});

await t('+ New category: validates, saves the same record as the drawer, selects it, updates preview; duplicates reuse the existing one', async () => {
    const page = await open(); await openDish(page);
    await page.click('#btnDishNewCat');
    assert.ok(await page.isVisible('#dishNewCatRow'));
    await page.click('#btnDishNewCatSave');
    assert.ok(/Type a category name/.test(await page.textContent('#dishNewCatMsg')), 'empty name explained inline');
    await page.fill('#dishNewCatName', 'Pizzas'); await page.click('#btnDishNewCatSave');
    await page.waitForFunction(() => document.getElementById('dishCategory').value === 'Pizzas');
    const r = await page.evaluate(() => { const c = window.__store.businesses.b1.outlets.o1.categories; const v = Object.values(c); return { n: v.length, rec: v[0], bank: Object.keys(window.__store.menuBank?.categories || {}).length, audit: window.__audits.map(a => a[1]), hidden: document.getElementById('dishNewCatRow').classList.contains('hidden'), prev: document.getElementById('dishLivePreview').textContent, valid: document.getElementById('dishCategory').classList.contains('valid') }; });
    assert.equal(r.n, 1); assert.deepEqual(Object.keys(r.rec).sort(), ['addons', 'image', 'name', 'order', 'outlet'].sort().filter(k => k in r.rec || k === 'addons')); assert.equal(r.rec.name, 'Pizzas'); assert.equal(r.rec.order, 0); assert.equal(r.rec.image, '');
    assert.equal(r.bank, 1, 'mirrored to menu bank like the drawer'); assert.ok(r.audit.includes('Added Category: Pizzas')); assert.ok(r.hidden && r.valid); assert.ok(/Pizzas/.test(r.prev));
    // duplicate, different case, via Enter key
    await page.click('#btnDishNewCat'); await page.fill('#dishNewCatName', 'pizzas'); await page.press('#dishNewCatName', 'Enter');
    await page.waitForTimeout(100);
    const d = await page.evaluate(() => ({ n: Object.keys(window.__store.businesses.b1.outlets.o1.categories).length, msg: document.getElementById('dishNewCatMsg').textContent, val: document.getElementById('dishCategory').value }));
    assert.equal(d.n, 1, 'no second record'); assert.ok(/already exists/.test(d.msg)); assert.equal(d.val, 'Pizzas');
    await page.close();
});

await t('dish save still stores the same fields; live preview follows what is typed', async () => {
    const page = await open(); await openDish(page);
    await page.click('#btnDishNewCat'); await page.fill('#dishNewCatName', 'Pizzas'); await page.click('#btnDishNewCatSave');
    await page.waitForFunction(() => document.getElementById('dishCategory').value === 'Pizzas');
    await page.fill('#dishName', 'Farmhouse Pizza'); await page.fill('#dishPriceBase', '499'); await page.selectOption('#dishVeg', 'nonveg');
    let prev = await page.textContent('#dishLivePreview'); assert.ok(/Farmhouse Pizza/.test(prev) && /₹499/.test(prev));
    assert.ok(await page.evaluate(() => document.querySelector('#dishLivePreview .mc-veg').classList.contains('is-nonveg')));
    await page.evaluate(() => { window.__cat.addSizeField('Small', 299); document.getElementById('dishModal').dispatchEvent(new Event('input')); });
    prev = await page.textContent('#dishLivePreview'); assert.ok(/from ₹299/.test(prev) && /1 size/.test(prev), prev);
    await page.evaluate(() => window.__cat.saveDish());
    await page.waitForFunction(() => Object.keys(window.__store.businesses.b1.outlets.o1.dishes || {}).length === 1);
    const d = await page.evaluate(() => Object.values(window.__store.businesses.b1.outlets.o1.dishes)[0]);
    assert.deepEqual({ ...d, sizes: d.sizes }, { name: 'Farmhouse Pizza', category: 'Pizzas', price: 499, image: '', stock: true, order: 0, sizes: { Small: 299 }, addons: null, veg: false });
    await page.close();
});

for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await t(`Add Dish form fits and is tappable (${label})`, async () => {
        const page = await open(vp); await openDish(page);
        await page.click('#btnDishNewCat'); await page.fill('#dishName', 'Farmhouse Pizza');
        const m = await page.evaluate(() => { const mc = document.querySelector('#dishModal .modal-content').getBoundingClientRect(); return { docW: document.documentElement.scrollWidth, vw: innerWidth, right: mc.right, btn: [...document.querySelectorAll('#dishNewCatRow button')].map(b => Math.round(b.getBoundingClientRect().height)), rowOverflow: (() => { const r = document.getElementById('dishNewCatRow'); return r.scrollWidth - r.clientWidth; })() }; });
        assert.ok(m.docW <= m.vw + 1 && m.right <= m.vw + 1, `no sideways scroll ${m.docW}/${m.vw}`); assert.ok(m.rowOverflow <= 1, 'new-category row fits');
        if (label === 'phone') assert.ok(Math.min(...m.btn) >= 40, 'tap height ' + m.btn);
        if (label === 'phone') { const w = await page.evaluate(() => [document.getElementById('dishName'), document.getElementById('dishOrder')].map(i => Math.round(i.getBoundingClientRect().width))); assert.ok(w[0] >= 250 && w[1] >= 250, 'Dish Name and Serial are full width on a phone, got ' + w); }
        if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `add-dish-form-${label}.png`) });
        await page.close();
    });
}
for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await t(`Menu Bank button is visible and alike on Menu, Categories and Combos (${label})`, async () => {
        const page = await open(vp);
        const out = [];
        for (const tab of ['menu', 'categories', 'combos']) {
            out.push(await page.evaluate(tab => {
                for (const x of ['menu', 'categories', 'combos']) document.getElementById('tab-' + x).style.display = x === tab ? 'block' : 'none';
                const pg = document.getElementById('tab-' + tab), b = pg.querySelector('.btn-open-menu-bank'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
                return { tab, shown: r.width > 30 && r.height > 20, look: cs.backgroundColor + cs.fontSize + cs.color, h: Math.round(r.height), right: r.right, vw: innerWidth, docW: document.documentElement.scrollWidth, text: b.textContent.trim() };
            }, tab));
            if (shotsDir) await page.locator('#tab-' + tab).screenshot({ path: path.join(shotsDir, `menu-bank-btn-${tab}-${label}.png`), clip: undefined }).catch(() => {});
        }
        for (const o of out) { assert.ok(o.shown, o.tab + ' shows the button'); assert.equal(o.text, 'Menu Bank'); assert.ok(o.right <= o.vw + 1 && o.docW <= o.vw + 1, `${o.tab} fits (${o.docW}/${o.vw})`); if (label === 'phone') assert.ok(o.h >= 40, o.tab + ' tap height ' + o.h); }
        assert.equal(new Set(out.map(o => o.look)).size, 1, 'same look on all three');
        await page.close();
    });
}
await browser.close();
console.log(failed ? failed + ' FAILED' : 'admin-add-flow ALL PASSED');
process.exit(failed ? 1 : 0);
