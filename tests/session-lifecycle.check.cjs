/* Guard: dine-in session lifetime policy (owner decision 2026-11-12).
 *
 *   scan, no order        3h  → table frees, nothing to settle
 *   has at least one order 24h → the bill survives the meal
 *   paid                  0   → full payment frees the table atomically, and
 *                              the LAST group of a multi-bill frees it too
 *
 * The old flat 2h timer cancelled every unpaid order at expiry — including
 * Served ones — and `touchSession()` only fires on app taps, so a party that
 * ate for two hours without touching the phone had real revenue deleted.
 *
 * Static only — no Firebase, no network. `npm run test:session-lifecycle`.
 * Mutation self-test: SESSION_FILE=tables old copy / TABLES_FILE=... must fail.
 */
const fs = require('fs');
const path = require('path');

const sessionFile = process.env.SESSION_FILE || path.join(__dirname, '..', 'menu', 'js', 'session.js');
const tablesFile = process.env.TABLES_FILE || path.join(__dirname, '..', 'Admin', 'js', 'features', 'tables.js');
const sessionSrc = fs.readFileSync(sessionFile, 'utf8');
const tablesSrc = fs.readFileSync(tablesFile, 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};
const hours = (name, src) => {
    const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
    return m ? eval(m[1]) / 3600000 : 0; // eslint-disable-line no-eval
};

// ---- menu/js/session.js : the two windows -------------------------------
const scanH = hours('SCAN_WINDOW_MS', sessionSrc);
const orderH = hours('ORDER_WINDOW_MS', sessionSrc);
ok(scanH === 3, `scan window is 3h (got ${scanH}h)`);
ok(orderH === 24, `order window is 24h (got ${orderH}h)`);

// The old flat timer must be gone from every writer, not just unused.
ok(!/7200000/.test(sessionSrc), 'no 7200000 (2h) literal left in session.js');

// Creation is a scan → 3h. Attaching an order → 24h.
ok(/expiresAt: now \+ sessionWindowMs\(false\)/.test(sessionSrc),
    'new session uses the scan window (sessionWindowMs(false))');
ok(/sess\.expiresAt = now \+ sessionWindowMs\(true\)/.test(sessionSrc),
    'order attach bumps to the order window (sessionWindowMs(true))');

// The two extenders must follow what the session already holds.
const extenders = (sessionSrc.match(/sessionWindowMs\(_sessionHasOrders\(\)\)/g) || []).length;
ok(extenders === 2, `touchSession + saveCheckoutContact both follow _sessionHasOrders() (got ${extenders})`);

// ---- Admin/js/features/tables.js : the sweep ----------------------------
ok(/const POLICEABLE_STATUS = new Set\(\['active', 'billing'\]\)/.test(tablesSrc),
    'sweep covers active AND billing (a stuck bill used to block the table for ever)');
ok(/if \(!POLICEABLE_STATUS\.has\(s\.status\)/.test(tablesSrc),
    'sweep gate uses POLICEABLE_STATUS');

// A served order is a debt, never a phantom: it must be skipped by the cancel loop.
ok(/const st = _orders\[oid\]\?\.status;[\s\S]{0,200}?st === 'Served' \|\| st === 'Delivered'\) return;/.test(tablesSrc),
    'served/delivered orders are never auto-cancelled at expiry');
ok(/cancelledReason: 'Session expired'/.test(tablesSrc), 'unreached orders are still cancelled with a reason');

// Walkout must be recorded while the table still points at the session.
const walkoutAt = tablesSrc.indexOf('await checkAndRecordWalkout(linkedTable.id, id)');
const clearAt = tablesSrc.indexOf("`tables/${linkedTable.id}`] ?? null") !== -1 ? Infinity : tablesSrc.indexOf("{ status: 'free', currentSession: null, updatedAt: now }");
ok(walkoutAt > 0 && walkoutAt < clearAt, 'walkout is recorded before the table pointer is cleared');

// Multi-bill: the last group paid must free the table.
ok(/async function _freeTableIfLastGroupPaid\(/.test(tablesSrc), '_freeTableIfLastGroupPaid exists');
ok(/await _freeTableIfLastGroupPaid\(tableId, sess, groupId, now\)/.test(tablesSrc),
    'group payment calls _freeTableIfLastGroupPaid');
const freeBody = tablesSrc.slice(tablesSrc.indexOf('async function _freeTableIfLastGroupPaid(')).slice(0, 1200);
ok(/\/status`\]: 'closed'/.test(freeBody) && /\/currentSession`\]: null/.test(freeBody),
    'the auto-close closes the session and frees the table');

// Full-table payment already closed + freed the table — must stay that way.
ok(/updates\[`tables\/\$\{tableId\}\/status`\] = 'free';\s*\n\s*updates\[`tables\/\$\{tableId\}\/currentSession`\] = null;/.test(tablesSrc),
    'full-table payment still closes and frees the table atomically');

// Walkout orders must not come back as KDS cards.
ok(/o\.status !== 'Pending' && o\.status !== 'Walkout'/.test(tablesSrc),
    'walkout orders are excluded from the dine-in KDS queue');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
