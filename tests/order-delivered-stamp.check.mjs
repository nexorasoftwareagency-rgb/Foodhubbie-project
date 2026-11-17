/**
 * Delivered-timestamp ownership guard (static).
 *
 * Why this exists (2026-11-17, M1 pre-delete audit):
 *   `onOrderStatusChange` (a Cloud Function slated for deletion in
 *   PLAN/BACKEND-ARCHITECTURE.md §9.4) was the ONLY writer of
 *   `orders/{id}/deliveredAt` for the standard Admin flow - the Admin's
 *   `updateStatus(id, 'Delivered')` wrote status/paymentMethod/paymentStatus
 *   and nothing else. That stamp is READ by the rider performance report
 *   (Admin/js/features/rider-analytics.js), which computes delivery minutes
 *   from `assignedAt` + `deliveredAt`.
 *
 *   So deleting the Function would have silently emptied that report's
 *   "average delivery time" for Admin-delivered orders (the reader filters
 *   rows with a null duration instead of failing loudly).
 *
 *   The fix is one-writer-per-path: the transition that marks an order
 *   Delivered now stamps its own timestamp, so the Function can go.
 *
 * Run: node tests/order-delivered-stamp.check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Env overrides so the mutation self-test can point the guard at a pre-fix copy.
const ORDERS_FILE = process.env.ORDERS_FILE || 'Admin/js/features/orders.js';
const SW_FILE = process.env.SW_FILE || 'Admin/sw.js';

const orders = fs.readFileSync(
    path.isAbsolute(ORDERS_FILE) ? ORDERS_FILE : path.join(root, ORDERS_FILE), 'utf8');
const riderAnalytics = read('Admin/js/features/rider-analytics.js');
const sw = fs.readFileSync(
    path.isAbsolute(SW_FILE) ? SW_FILE : path.join(root, SW_FILE), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

// ---- 1. the Admin transition stamps the timestamp ---------------------------
ok(/const dbUpdates = status === "Delivered"/.test(orders),
    'updateStatus builds a separate DB payload for the Delivered transition');
ok(/\? \{ \.\.\.updates, deliveredAt: serverTimestamp\(\) \}/.test(orders),
    'the Delivered transition stamps deliveredAt with serverTimestamp()');
ok(/await update\(Outlet\.ref\(`orders\/\$\{id\}`\), dbUpdates\)/.test(orders),
    'the DB write carries the stamped payload');

// ---- 2. the sentinel never reaches the optimistic paint --------------------
ok(/optimisticApply\(id, updates\)/.test(orders),
    'the optimistic paint gets the payload WITHOUT the server-timestamp sentinel');
ok(!/optimisticApply\(id, dbUpdates\)/.test(orders),
    'the server-timestamp sentinel is never handed to the optimistic paint');
ok(!/optimisticApply\([^)]*serverTimestamp/.test(orders),
    'no serverTimestamp sentinel is passed to optimisticApply anywhere');

// ---- 3. the stamp has a real reader ----------------------------------------
ok(/_ms\(o\.deliveredAt\)/.test(riderAnalytics),
    'the rider performance report reads order.deliveredAt (the stamp is not dead code)');
ok(/tenantRef\(outlet, 'orders'\)/.test(riderAnalytics),
    'that reader reads the restaurant order node - the same node updateStatus writes');

// ---- 4. the other writer is untouched --------------------------------------
ok(/deliveredAt: serverTimestamp\(\)/.test(orders),
    'the force-deliver path still stamps deliveredAt');

// ---- 5. the served-file rule: a SW-served file changed -> cache bumped -----
const cacheName = (sw.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '';
ok(/js\/features\/orders\.js/.test(sw),
    'the Admin SW precaches js/features/orders.js (so a change to it needs a cache bump)');
const version = (cacheName.match(/v5\.12\.(\d+)/) || [])[1];
ok(!!version && Number(version) >= 60,
    `the Admin SW CACHE_NAME is bumped to >= v5.12.60 (found ${cacheName || 'none'})`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
