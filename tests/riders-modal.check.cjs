/**
 * Rider modal guard (tests/riders-modal.check.cjs)
 * ============================================================================
 * Pins the invariants that made "Add New Rider" a dead end in production
 * (reported from app.foodhubbie.in, 2026-11-18):
 *
 *   1. NO DANGLING DOM IDS. `Admin/js/features/riders.js` reached for
 *      `#riderModalSteps`, an element that has NEVER existed in
 *      `Admin/index.html` — so opening the modal threw
 *      "Cannot read properties of null (reading 'style')", and CLOSING it
 *      threw too, which turned a successful save into a bogus
 *      "Rider Save Error" toast. Every id the module looks up must exist in
 *      the markup (or be an explicitly optional, null-guarded one).
 *   2. NO UNGUARDED DOM CHAINS. `getElementById('x').style` is the exact
 *      shape of that crash; the rule bans the chain outright so the class
 *      cannot come back through a different id.
 *   3. THE SECONDARY AUTH IS ASKED FOR, NOT GUESSED. The app is created
 *      LAZILY on first use, so reading an availability flag BEFORE the
 *      initialiser had ever run reported "unavailable" on every fresh page
 *      and blocked rider creation entirely. The shared accessor must
 *      initialise on demand.
 *   4. THE FORM MAY NOT ASK FOR LESS THAN THE DATABASE. `database.rules.json`
 *      validates a rider's phone as a 5-15 character string, so a blank
 *      phone was rejected by the database AFTER the Firebase Auth account
 *      had already been created (an orphaned login).
 *   5. THE MARKUP TELLS THE TRUTH. The phone/aadhar placeholders suggested
 *      "+91 99999 00000" / "0000 0000 0000" while the code demands exactly
 *      10 / 12 digits — the placeholder taught a format the form rejected.
 *
 * Run: node tests/riders-modal.check.cjs
 * Env overrides (for the mutation self-test):
 *   RIDERS_FILE, INDEX_FILE, FIREBASE_JS_FILE, RULES_FILE
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RIDERS_FILE = process.env.RIDERS_FILE || path.join(ROOT, 'Admin', 'js', 'features', 'riders.js');
const INDEX_FILE = process.env.INDEX_FILE || path.join(ROOT, 'Admin', 'index.html');
const FIREBASE_JS_FILE = process.env.FIREBASE_JS_FILE || path.join(ROOT, 'Admin', 'js', 'firebase.js');
const RULES_FILE = process.env.RULES_FILE || path.join(ROOT, 'database.rules.json');

const read = (f) => fs.readFileSync(f, 'utf8');
const riders = read(RIDERS_FILE);
const index = read(INDEX_FILE);
const firebaseJs = read(FIREBASE_JS_FILE);
const rules = read(RULES_FILE);

// Judge CODE, not prose: strip line comments (CRLF-safe).
const code = riders.replace(/\r\n/g, '\n').split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { console.error('  FAIL ' + msg); fails++; } };

// ---------------------------------------------------------------------------
// 1 + 2: the DOM contract
// ---------------------------------------------------------------------------

// `management-tab-container` is read once into a variable and then guarded
// (`if (manageTab) ... else ...`), so it is legitimately optional.
const OPTIONAL_IDS = new Set(['management-tab-container']);

const usedIds = [...new Set([...code.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)].map((m) => m[1]))];
const missing = usedIds.filter((id) => !new RegExp(`id=["']${id}["']`).test(index) && !OPTIONAL_IDS.has(id));
ok(usedIds.length > 20, `the module looks up ${usedIds.length} static element ids`);
ok(missing.length === 0, 'every element id the rider module looks up exists in Admin/index.html'
    + (missing.length ? ' — missing: ' + missing.join(', ') : ''));

// The exact crash shape: a property read straight off getElementById(...).
// It is only safe when that id is really in the markup — the production crash
// was `getElementById('riderModalSteps').style` on an id that never existed.
const chained = [...new Set([...code.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)\s*\.\s*(style|classList|innerText|innerHTML|value|textContent|files|disabled|src)/g)]
    .map((m) => m[1]))];
const chainedMissing = chained.filter((id) => !new RegExp(`id=["']${id}["']`).test(index));
ok(chained.length > 20, `${chained.length} elements are read through a property chain`);
ok(chainedMissing.length === 0, 'no property chain can hit a missing element (the null-deref shape)'
    + (chainedMissing.length ? ' — missing: ' + chainedMissing.join(', ') : ''));

// The optional id must stay guarded (a future edit could un-guard it).
ok(/const manageTab = document\.getElementById\('management-tab-container'\);/.test(code)
    && /if \(manageTab\)/.test(code),
    'the one optional id stays null-guarded');

// ---------------------------------------------------------------------------
// 3: the secondary Auth
// ---------------------------------------------------------------------------

const saveFn = code.slice(code.indexOf('export async function saveRiderAccount'));
const createBranch = saveFn.slice(saveFn.indexOf('} else {', saveFn.indexOf('state.isEditRiderMode')));
ok(!/isSecondaryAuthAvailable\(\)/.test(createBranch),
    'the create branch does not consult the availability flag before initialising');
ok(/const _sa = getSecondaryAuth\(\);\s*\n\s*if \(!_sa\)/.test(createBranch),
    'the create branch asks for the secondary Auth first, then judges the instance');

ok(/export function isSecondaryAuthAvailable\(\)\s*\{\s*return !!getSecondaryAuth\(\);/.test(firebaseJs),
    'the shared accessor initialises on demand (it can never report "unavailable" for an unasked app)');
ok(/getApps\(\)\.find\(\(a\) => a\.name === 'secondary_auth'\)/.test(firebaseJs),
    'the secondary app is reused if it already exists (initializeApp throws on a duplicate name)');

// ---------------------------------------------------------------------------
// 4: the form may not ask for less than the database
// ---------------------------------------------------------------------------

const phoneRule = rules.match(/"phone":\s*\{\s*"\.validate":\s*"([^"]+)"/);
ok(!!phoneRule, 'the database rule for a rider phone is readable');
if (phoneRule) {
    const min = Number((phoneRule[1].match(/length\s*>=\s*(\d+)/) || [])[1]);
    ok(min >= 5, `the database requires a phone of at least ${min} characters`);
}
ok(!/if \(phone && !\/\^\\d\{10\}\$/.test(code),
    'the phone check is NOT optional — a blank phone is refused by the form, not by the database');
ok(/if \(!\/\^\\d\{10\}\$\/\.test\(phone\)\)/.test(code),
    'the phone must be exactly 10 digits');

// ---------------------------------------------------------------------------
// 5: the markup tells the truth
// ---------------------------------------------------------------------------

const phoneInput = (index.match(/<input id="riderPhone"[\s\S]*?>/) || [''])[0];
const aadharInput = (index.match(/<input id="riderAadharNo"[\s\S]*?>/) || [''])[0];
ok(/placeholder="9999900000"/.test(phoneInput), 'the phone placeholder shows the format the form accepts');
ok(/maxlength="10"/.test(phoneInput), 'the phone input is capped at 10 digits');
ok(/placeholder="000000000000"/.test(aadharInput), 'the aadhar placeholder shows the format the form accepts');
ok(/maxlength="12"/.test(aadharInput), 'the aadhar input is capped at 12 digits');
ok(/Primary Phone <span class="required-star">\*<\/span>/.test(index), 'the primary phone is marked required');
ok(/Aadhar Number <span class="required-star">\*<\/span>/.test(index), 'the aadhar number is marked required');

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nAll rider-modal checks passed');
