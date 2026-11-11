/* Guard: the Admin Tables tab must never go back to downloading the whole
 * tableSessions node. That listener was 83.7 KB on live pizza and grows with
 * every session ever created (FIREBASE_SERVER_MIGRATION/18 + /20).
 * Static only — no Firebase, no network. `npm run test:tables-window`. */
const fs = require('fs');
const path = require('path');

const file = process.env.TABLES_FILE || path.join(__dirname, '..', 'Admin', 'js', 'features', 'tables.js');
const src = fs.readFileSync(file, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

// 1. Window constant exists and covers the 24h policy + the revenue-today KPI.
const m = src.match(/const SESSION_WINDOW_MS = ([^;]+);/);
ok(!!m, 'SESSION_WINDOW_MS constant exists');
const hours = m ? eval(m[1]) / 3600000 : 0; // eslint-disable-line no-eval
ok(hours >= 24 && hours <= 48, `window is 24-48h (got ${hours}h)`);

// 2. The listener is a bounded query on openedAt.
ok(/onValue\(\s*query\(_sessRef\(\),\s*orderByChild\('openedAt'\),\s*startAt\(Date\.now\(\) - SESSION_WINDOW_MS\)\)/.test(src),
    'sessions listener is orderByChild(openedAt) + startAt(window)');

// 3. The old whole-node listener must not exist anywhere.
const wholeNode = /onValue\(\s*_sessRef\(\)\s*,/.test(src);
ok(!wholeNode, 'no whole-node onValue(_sessRef()) listener');

// 4. Reconciliation is wired on both sides + released on cleanup.
ok(/_tablesListener = onValue[\s\S]{0,400}_sessionsLoaded\) _syncExtraSessions\(\)/.test(src),
    'table pointer changes trigger _syncExtraSessions()');
ok(/_sessions = snap\.val\(\) \|\| \{\};[\s\S]{0,400}_applyExtraSessions\(\);[\s\S]{0,200}_syncExtraSessions\(\)/.test(src),
    'window snapshots re-apply reconciled sessions and re-sync tails');
ok(/_releaseAllExtraSessions\(\)/.test(src), 'cleanupTables releases reconciled tails');

// 5. startAt must be imported (a missing import is a runtime-only failure).
ok(/limitToLast, startAt \}|\{[\s\S]*\bstartAt\b[\s\S]*\} from '\.\.\/firebase\.js'/.test(src),
    'startAt is imported from firebase.js');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
