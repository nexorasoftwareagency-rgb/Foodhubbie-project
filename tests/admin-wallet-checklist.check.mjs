// Runs the REAL Admin/js/features/{costs,setup-checklist}.js against stubbed Firebase/DOM (no network).
// Builds a temp tree from the real sources so the test follows the code. Run: node tests/admin-wallet-checklist.check.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-wallet-'));
const put = (rel, txt) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
const copy = (rel, to = rel) => put(to, fs.readFileSync(rel, 'utf8'));
copy('Admin/js/features/costs.js'); copy('Admin/js/features/setup-checklist.js'); copy('shared/cost-math.js', 'Admin/shared/cost-math.js');
put('Admin/js/state.js', 'export const state = { locked: false };');
put('Admin/js/ui.js', "export const SUPPORT_WA = 'https://wa.me/x'; export const canAccessTab = () => true;");
put('Admin/js/firebase.js', `export const Outlet = { ref: (p) => p };
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
assert.equal(e.walletBalance.textContent, '−₹200'); assert.ok(e.walletStatus.textContent.includes('negative')); console.log('PASS negative balance flagged');
console.log('ALL PASSED');
`);
put('checklist.mjs', `import assert from 'assert';
const root = { style: {}, innerHTML: '', querySelector() { return null; } };
globalThis.document = { getElementById: () => root }; globalThis.window = { open() {} };
const { state } = await import('./Admin/js/state.js');
const { loadSetupChecklist } = await import('./Admin/js/features/setup-checklist.js');
const run = async (data, locked = false) => { globalThis.DATA = data; state.locked = locked; root.style = {}; root.innerHTML = ''; await loadSetupChecklist(); return root; };
const full = { 'settings/Store': { storeName: 'A', address: 'B' }, dishes: { d: {} }, tables: { t: {} }, orders: { o: {} }, 'whatsapp/status': 'active', billing: { payments: { p: { amount: 1000 } } } };

let e = await run({}, true);
assert(e.innerHTML.includes('0 of 6 done')); assert(e.innerHTML.includes('Top up your wallet (minimum ₹1,000)')); assert(e.innerHTML.includes('data-setup-support'));
assert(e.innerHTML.lastIndexOf('Top up your wallet') < e.innerHTML.indexOf('Take your first order'), 'top-up is the last setup step, before first order');
console.log('PASS new locked outlet: 0 of 6, top-up step with support button');
assert(!e.innerHTML.includes('data-tab="walkin"'), 'first-order link hidden while locked'); console.log('PASS first order not offered while locked');

e = await run({ ...full, billing: { payments: { p: { amount: 999 } } } }, true);
assert(e.innerHTML.includes('Contact support')); console.log('PASS 999 is below the minimum -> top-up still pending');

e = await run({ ...full, orders: null }, true);
assert(e.style.display !== 'none' && e.innerHTML.includes('switching your restaurant live')); console.log('PASS paid but still locked: activation message');

e = await run(full, false);
assert.equal(e.style.display, 'none'); console.log('PASS required steps + first order done -> panel hidden');

e = await run({ ...full, tables: null, 'whatsapp/status': null });
assert.equal(e.style.display, 'none'); console.log('PASS optional steps never keep the panel open');

e = await run({ ...full, billing: 'ERR' });
assert(e.style.display !== 'none' && e.innerHTML.includes('⏳')); console.log('PASS billing read error -> unknown, panel stays');
console.log('ALL PASSED');
`);

let bad = 0;
for (const f of ['wallet.mjs', 'checklist.mjs']) {
  const r = spawnSync(process.execPath, [f], { cwd: tmp, encoding: 'utf8' });
  process.stdout.write(r.stdout); if (r.status !== 0) { bad++; process.stderr.write(r.stderr); }
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
