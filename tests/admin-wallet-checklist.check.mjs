// Runs the REAL Admin/js/features/{costs,setup-checklist}.js against stubbed Firebase/DOM (no network).
// Builds a temp tree from the real sources so the test follows the code. Run: node tests/admin-wallet-checklist.check.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-wallet-'));
const put = (rel, txt) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
const copy = (rel, to = rel) => put(to, fs.readFileSync(rel, 'utf8'));
copy('Admin/js/features/costs.js'); copy('Admin/js/features/setup-checklist.js'); copy('Admin/js/features/wallet-alert.js'); copy('shared/cost-math.js', 'Admin/shared/cost-math.js');
put('Admin/js/state.js', 'export const state = { locked: false };');
put('Admin/js/ui.js', "export const SUPPORT_WA = 'https://wa.me/919724649971?text=x'; export const supportWa = (t) => 'https://wa.me/919724649971?text=' + encodeURIComponent(t); export const canAccessTab = () => true; export const switchTab = async (t) => { (globalThis.__TABS ||= []).push(t); };");
put('Admin/js/firebase.js', `export const Outlet = { ref: (p) => p, current: 'o1' };
export const limitToLast = () => null, query = (p) => p;
export const get = async (p) => { const v = globalThis.DATA[p]; if (v === 'ERR') throw new Error('x'); return { exists: () => v != null, val: () => v ?? null }; };
export const onValue = (p, cb) => { cb({ val: () => globalThis.DATA[p] ?? null }); return () => {}; };
export const onChildAdded = () => () => {}, onChildChanged = () => () => {}, orderByChild = () => null, startAt = () => null, endAt = () => null;
`);
put('package.json', '{"type":"module"}');
put('wallet.mjs', `import assert from 'assert';
const els = {}; const el = (id) => els[id] || (els[id] = { id, textContent: '', innerHTML: '', style: {}, addEventListener() {}, querySelector() { return null; }, classList: { toggle() {}, add() {}, remove() {} } });
globalThis.document = { getElementById: el, querySelectorAll: () => [], querySelector: () => null };
globalThis.window = { open() {} };
const { state } = await import('./Admin/js/state.js');
const run = async (data, locked = false) => {
  globalThis.DATA = data; state.locked = locked; for (const k in els) delete els[k]; el('walletBalance'); el('walletHistoryBody');
  const m = await import('./Admin/js/features/costs.js?' + Math.random()); m.loadCosts(); await new Promise(r => setTimeout(r, 400)); m.cleanupCosts(); return els;
};
let e = await run({ billing: { payments: { a: { amount: 1000, method: 'UPI', receiptNo: 'RCP-1', createdAt: Date.now() } } }, orders: { o1: { source: 'QR', status: 'Delivered', total: 100, createdAt: '2026-10-01' } }, 'bot/promotions/campaigns': { c: { totalSent: 10 } } });
assert.equal(e.walletBalance.textContent, '₹988', e.walletBalance.textContent);
assert.equal(e.walletStatus.textContent, 'Your restaurant is live.');
assert.ok(e.walletHistoryBody.innerHTML.includes('RCP-1') && e.walletHistoryBody.innerHTML.includes('UPI'));
console.log('PASS wallet = topped up - usage; history listed; live status');
e = await run({ billing: { payments: {} }, orders: {} }, true);
assert.ok(e.walletStatus.textContent.includes('Top up at least ₹1,000')); assert.ok(e.walletHistoryBody.innerHTML.includes('No top-ups yet'));
console.log('PASS no top-up: prompts for minimum');
e = await run({ billing: { payments: { a: { amount: 1000, createdAt: 1 } } }, orders: {} }, true);
assert.ok(e.walletStatus.textContent.includes('Top-up received')); console.log('PASS topped up but still locked: activation message');
e = await run({ billing: { payments: { a: { amount: 1000, createdAt: 1 } } }, orders: 'ERR' });
assert.equal(e.walletBalance.textContent, '—'); assert.ok(e.walletStatus.textContent.includes('Could not load')); console.log('PASS usage read failure: no overstated balance shown');
e = await run({ billing: { payments: { a: { amount: 1000, createdAt: 1 } }, charges: { c: { amount: 1200 } } }, orders: {} });
assert.equal(e.walletBalance.textContent, '−₹200'); assert.ok(e.walletStatus.textContent.includes('finished')); console.log('PASS negative balance flagged as finished');
e = await run({ billing: { payments: { a: { amount: 1000, createdAt: 1 } }, charges: { c: { amount: 800 } } }, orders: {} });
assert.ok(e.walletStatus.textContent.includes('Low balance') && e.walletStatus.textContent.includes('25%')); console.log('PASS 200 left of 1000 topped up: low-balance message');
e = await run({ billing: { mode: 'percentage', payments: { a: { amount: 1000, createdAt: 1 } } }, orders: { o: { source: 'webview_delivery', status: 'Delivered', total: 10000, createdAt: '2026-10-01' } } });
assert.equal(e.walletBalance.textContent, '₹800'); console.log('PASS percentage package: 2% of 10000 WhatsApp order = 200 used');
console.log('ALL PASSED');
`);
put('alert.mjs', `import assert from 'assert';
const els = { walletAlert: { style: {}, innerHTML: '', querySelector() { return null; } } };
globalThis.document = { getElementById: (id) => els[id] }; globalThis.window = { open() {} };
const { state } = await import('./Admin/js/state.js');
const run = async (data, locked = false) => { globalThis.DATA = data; state.locked = locked; els.walletAlert.style = {}; els.walletAlert.innerHTML = ''; const m = await import('./Admin/js/features/wallet-alert.js?' + Math.random()); await m.loadWalletAlert(); return els.walletAlert; };
const pay = (a) => ({ billing: { payments: { p: { amount: a } } } });
let e = await run({ ...pay(1000), orders: { a: { source: 'QR', status: 'Delivered', total: 100, createdAt: 'x' } } });
assert.equal(e.style.display, 'none'); console.log('PASS healthy wallet: no alert');
e = await run({ billing: { payments: { p: { amount: 1000 } }, mode: 'percentage' }, orders: { a: { source: 'webview_delivery', status: 'Delivered', total: 37500, createdAt: 'x' } } });
assert.ok(e.innerHTML.includes('Low wallet balance'), e.innerHTML); assert.ok(e.innerHTML.includes('25%')); console.log('PASS 2% WhatsApp percentage usage pushes wallet to low (250 left of 1000)');
e = await run({ billing: { payments: { p: { amount: 1000 } }, mode: 'percentage' }, orders: { a: { source: 'webview_delivery', status: 'Delivered', total: 50000, createdAt: 'x' } } });
assert.ok(e.innerHTML.includes('Wallet balance finished')); console.log('PASS wallet used up: finished alert');
e = await run({ billing: { payments: {} }, orders: { a: { source: 'QR', status: 'Delivered', total: 1, createdAt: 'x' } } });
assert.equal(e.style.display, 'none'); console.log('PASS never topped up: no alert (checklist covers it)');
e = await run({ billing: { payments: { p: { amount: 1000 } }, mode: 'percentage' }, orders: { a: { source: 'webview_delivery', status: 'Delivered', total: 37500, createdAt: 'x' } } }, true);
assert.equal(e.style.display, 'none'); console.log('PASS setup mode: checklist owns the wallet message, no duplicate alert');
console.log('ALL PASSED');
`);
put('checklist.mjs', `import assert from 'assert';
const root = { style: {}, innerHTML: '' };
const nodes = {};          // selector -> fake element, so deep-links can be observed
const handlers = [];       // { btn, fn } collected from the real render()
const fakeEl = (sel) => {
  const el = { sel, clicked: 0, focused: 0, scrolled: 0, flashes: 0 };
  el.click = () => { el.clicked++; };
  el.focus = () => { el.focused++; };
  el.scrollIntoView = () => { el.scrolled++; };
  el.classList = { add: () => { el.flashes++; }, remove: () => {} };
  return el;
};
root.querySelector = (sel) => nodes[sel] || null;
root.querySelectorAll = (sel) => {
  if (sel !== '[data-setup-goto]') return [];
  return [...root.innerHTML.matchAll(/data-setup-goto="([^"]+)"( data-setup-secondary="1")?/g)].map((m) => {
    const btn = { dataset: { setupGoto: m[1], ...(m[2] ? { setupSecondary: '1' } : {}) } };
    btn.addEventListener = (_ev, fn) => handlers.push({ btn, fn });
    return btn;
  });
};
globalThis.document = { getElementById: () => root, querySelector: (s) => nodes[s] || null, querySelectorAll: () => [] };
globalThis.window = { open() {} };
const { state } = await import('./Admin/js/state.js');
const { loadSetupChecklist } = await import('./Admin/js/features/setup-checklist.js');
const run = async (data, locked = true) => {
  globalThis.DATA = data; state.locked = locked; root.style = {}; root.innerHTML = '';
  handlers.length = 0; globalThis.__TABS = [];
  await loadSetupChecklist(); return root;
};
const click = async (id, secondary) => {
  const h = handlers.find(x => x.btn.dataset.setupGoto === id && Boolean(x.btn.dataset.setupSecondary) === Boolean(secondary));
  assert.ok(h, 'no click handler for ' + id + (secondary ? ' (secondary)' : ''));
  h.fn({ currentTarget: h.btn });
  await new Promise(r => setTimeout(r, 300)); // gotoStep awaits switchTab + waitFor
};
const profile = { 'settings/Store': { storeName: 'A', address: 'B' } };
const menu = { categories: { c: {} }, dishes: { d: {} } };
const full = { ...profile, ...menu, tables: { t: {} }, orders: { o: {} }, 'whatsapp/status': 'active', billing: { payments: { p: { amount: 1000 } } } };

let e = await run({});
assert(e.innerHTML.includes('0 of 7 done'), 'seven dependency-ordered steps');
assert(e.innerHTML.includes('setup-hero__title">Add your restaurant name and address'), 'hero leads with the first step');
assert(e.innerHTML.includes('Next step'), 'hero carries a next-step label');
assert(e.innerHTML.includes('Open settings'), 'first step deep-links to the store settings');
assert(!e.innerHTML.includes('data-state="unknown"'), 'a missing Store node is "todo", never "unknown"');
console.log('PASS new locked outlet: 0 of 7, hero leads with the first step');

e = await run({ ...profile, ...menu });
assert(e.innerHTML.includes('Add ₹1,000 to your wallet'), 'top-up becomes the next required step once the menu exists');
assert(e.innerHTML.includes('Contact us to top up'), 'top-up hands off to support instead of a blocked tab');
assert(e.innerHTML.includes('See wallet'), 'secondary link to the wallet');
assert(e.innerHTML.includes('data-setup-goto="topup"') && !e.innerHTML.includes('data-setup-goto="topup" disabled'), 'top-up is actionable');
console.log('PASS menu done: top-up is the hero step with a support hand-off');

e = await run({ ...profile, ...menu, billing: { payments: { p: { amount: 999 } } } });
assert(e.innerHTML.includes('Add ₹1,000 to your wallet'), '999 is below the minimum');
console.log('PASS 999 is below the minimum -> top-up still pending');

assert(e.innerHTML.includes('data-setup-goto="order" disabled'), 'first order not actionable while locked');
assert(e.innerHTML.includes('after go-live'), 'the blocked step says why');
console.log('PASS first order not offered while locked');

e = await run(full);
assert(e.innerHTML.includes('Everything is set up'), 'paid and complete -> activation message');
assert(!e.innerHTML.includes('aria-current="step"'), 'no step is highlighted when nothing is blocking');
assert(e.innerHTML.includes('7 of 7 done'), 'progress matches the hero');
console.log('PASS paid but still locked: activation message, no contradictory highlight');

e = await run({ ...full, tables: null, 'whatsapp/status': null });
assert(e.innerHTML.includes('Everything is set up') && e.innerHTML.includes('6 of 7 done') === false, 'optional steps left do not block go-live');
assert(e.innerHTML.includes('All required steps done'));
assert(e.innerHTML.includes('aria-valuenow="100"'), 'goal met -> full progress bar');
console.log('PASS optional steps left -> still "everything set up"');

e = await run(full, false);
assert.equal(e.style.display, 'none', 'a live outlet never shows the setup checklist');
console.log('PASS live outlet: panel hidden (no false top-up prompt)');

e = await run({ ...full, billing: 'ERR' });
assert(e.style.display !== 'none' && e.innerHTML.includes('data-state="unknown"'), 'unknown billing keeps the panel visible and marks it unknown');
assert(e.innerHTML.includes('could not be checked'), 'unknown blocking step is stated plainly');
console.log('PASS billing read error -> unknown, panel stays');

// --- deep-link contract ---------------------------------------------------
// Profile -> Settings > General, focus the store-name field.
const storeName = fakeEl('#settingStoreName'); nodes['#settingStoreName'] = storeName;
const general = fakeEl('[data-subtab="general"]'); nodes['[data-subtab="general"]'] = general;
await run({});
await click('profile');
assert.deepEqual(globalThis.__TABS, ['settings'], 'switches to the settings tab');
assert.equal(general.clicked, 1, 'lands on the general subtab');
assert.equal(storeName.focused, 1, 'focuses the store-name field');
assert.ok(storeName.scrolled >= 1, 'scrolls the field into view');
console.log('PASS deep-link: profile -> Settings > General > #settingStoreName');

// Category -> Categories tab, opens the add-category modal button.
const addCat = fakeEl('#btnAddCategory'); nodes['#btnAddCategory'] = addCat;
await run(profile);
await click('category');
assert.deepEqual(globalThis.__TABS, ['categories']);
assert.equal(addCat.clicked, 1, 'clicks the add-category button');
console.log('PASS deep-link: category -> Categories > #btnAddCategory');

// Top-up -> support hand-off (no tab switch), and the secondary link opens the wallet.
let opened = null;
globalThis.window.open = (u) => { opened = u; };
await run({ ...profile, ...menu });
await click('topup');
assert.ok(opened && opened.includes('wa.me/919724649971'), 'opens WhatsApp support');
assert.ok(decodeURIComponent(opened).includes('top up my wallet'), 'prefilled message says what is needed');
assert.deepEqual(globalThis.__TABS, [], 'support steps do not switch tabs');
await click('topup', true);
assert.deepEqual(globalThis.__TABS, ['costs'], 'secondary link opens the wallet');
console.log('PASS deep-link: top-up -> support hand-off + wallet secondary');

console.log('ALL PASSED');
`);

let bad = 0;
for (const f of ['wallet.mjs', 'checklist.mjs', 'alert.mjs']) {
  const r = spawnSync(process.execPath, [f], { cwd: tmp, encoding: 'utf8' });
  process.stdout.write(r.stdout); if (r.status !== 0) { bad++; process.stderr.write(r.stderr); }
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
