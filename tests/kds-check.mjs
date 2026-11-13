/**
 * KDS (Kitchen Display System) guard (static).
 *
 * Pins the invariants the 2026-11-13 KDS review established, so the bugs it
 * found cannot quietly return:
 *  - the sidebar badge counts exactly what the KDS shows (Dine-in
 *    Placed/Confirmed/Ready) — not every type, not unpaid Served;
 *  - the KOT never prints a Cancelled order and carries size + addons;
 *  - window.open null (popup blocker) cannot throw uncaught;
 *  - no order path falls back to a hardcoded 'pizza' outlet id;
 *  - `Preparing` stays a phantom: no order writer sets it and the KDS groups
 *    Confirmed orders under the Preparing column header only;
 *  - the dead artifacts of the removed live-orders table (e4f0b0b) stay gone.
 *
 * Run: node tests/kds-check.mjs  (npm run test:kds)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const tables = read('Admin/js/features/tables.js');
const orders = read('Admin/js/features/orders.js');
const css = read('Admin/style.css');
const html = read('Admin/index.html');

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

// ---- F1: badge parity with the KDS ----------------------------------------
ok(/KDS-visible only: Dine-in with a status the kitchen can still act on/.test(orders),
    'badge comment states the real rule');
ok(/if \(\(o\.type \|\| ''\)\.trim\(\) !== 'Dine-in'\) return;/.test(orders),
    'badge counts Dine-in orders only');
ok(!/status === 'Served' && o\.paymentStatus !== 'Paid' && !o\.paidAt/.test(
    orders.slice(orders.indexOf('function updateLiveBadge'), orders.indexOf('function updateDashboardStats'))),
    'badge no longer counts unpaid Served (the KDS never shows it)');

// ---- F2: no dead Online-first sort / unreachable source badges -------------
ok(!/aOnline \? -1 : 1/.test(tables), 'KDS render has no Online-first sort');
const srcBadge = tables.slice(tables.indexOf('function _sourceBadge'), tables.indexOf('function _kitchenCard'));
ok(!/isOnline|isPOS/.test(srcBadge), '_sourceBadge has no ONLINE/POS branches');
ok(!/source-pos|source-online/.test(css), 'dead .source-online/.source-pos CSS removed');

// ---- F3: Preparing stays a phantom -----------------------------------------
ok(!/'Preparing': \['Ready', 'Cancelled'\]/.test(tables),
    'advance map has no Preparing transition');
ok(!/st === 'Confirmed' \|\| st === 'Preparing'/.test(tables),
    'KDS grouping no longer guards a Preparing status');
ok(!/status === 'Preparing'/.test(tables), 'no status === Preparing check in tables.js');

// ---- F4: KOT correctness ----------------------------------------------------
const kot = tables.slice(tables.indexOf('function _printTableKOT'), tables.indexOf('async function _printBillForGroup'));
ok(/filter\(o => o\.status !== 'Cancelled'\)/.test(kot), 'KOT skips Cancelled orders');
ok(/it\.size/.test(kot), 'KOT item lines carry size');
ok(/addons/.test(kot), 'KOT item lines carry addons');
ok(/if \(!w\) \{ showToast\('Popup blocked/.test(kot), 'popup blocker is null-guarded with a toast');
ok(/No live items to print/.test(kot), 'all-cancelled session does not print an empty KOT');

// ---- F5: no hardcoded outlet fallback ---------------------------------------
ok(!/outlet \|\| 'pizza'/.test(orders), "orders.js has no (order.outlet || 'pizza') fallback");
ok(/order\.outlet \|\| Outlet\.current/.test(orders), 'orders.js falls back to the current tenant');

// ---- F6/F7: dead artifacts stay gone ----------------------------------------
ok(!/\.kds-card/.test(css), 'dead .kds-card* CSS block removed');
ok(!/kdsUrgentPulse/.test(css), 'dead kdsUrgentPulse keyframes removed');
ok(!/liveOrdersTable/.test(orders), 'no liveOrdersTable refs in orders.js');
ok(!/liveOrdersMap/.test(orders), 'no liveOrdersMap refs in orders.js');
ok(!/LIVE_STATUSES/.test(orders), 'unused LIVE_STATUSES removed');
ok(!/_liveOrdersUnsub/.test(orders), 'never-assigned _liveOrdersUnsub removed');
ok(/Real-time kitchen display \(KDS\)/.test(html), 'Kitchen subtitle no longer promises delivery tracking');
ok(!fs.existsSync(path.join(root, 'Admin/js/demo/demo-data.js')),
    'orphaned demo-data.js (seeded the phantom Preparing status) deleted');

// ---- F8: card body opens the drawer -----------------------------------------
ok(/data-action="openTableDrawerByOrder" data-order-id/.test(tables),
    'kitchen card body routes to openTableDrawerByOrder');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
