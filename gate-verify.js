/**
 * gate-verify.js — 17-GATE structural verifier for the multi-tenant refactor
 * (businesses/{bid}/outlets/{oid}).
 *
 * Checks the repo statically (no network, no credentials) so CI can run it on
 * every push. The LIVE DB check (guide 17.5) is gated on a real service-account
 * file — run with SERVICE_ACCOUNT env when credentials exist:
 *   SERVICE_ACCOUNT=bot/service-account.json FIREBASE_DB_URL=... node gate-verify.js --live
 *
 * Exit codes: 0 = pass (warnings allowed), 1 = fail (structural break).
 * Per guide 17.8, checks are calibrated to repo reality, not idealized specs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
let failures = 0;
let warnings = 0;

function check(name, cond, detail = '') {
    if (cond) {
        console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function warn(name, detail) {
    warnings++;
    console.log(`  WARN  ${name} — ${detail}`);
}

function read(p) {
    return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function grep(p, pattern) {
    const src = read(p);
    return src.match(new RegExp(pattern, 'g')) || [];
}

console.log('gate-verify: 17-GATE structural checks\n');

// ---- 1. database.rules.json must be valid JSON with the tenant hierarchy ----
console.log('[1] database.rules.json');
let rules = null;
try {
    rules = JSON.parse(read('database.rules.json'));
    check('rules parses as JSON', true);
} catch (e) {
    failures++;
    check('rules parses as JSON', false, e.message);
    rules = {};
}
if (rules && rules.rules) {
    const root = rules.rules;
    check('root has businesses node', !!root.businesses);
    const biz = root.businesses || {};
    // guide uses $bid/$oid shorthand; repo wildcards are $businessId/$outletId
    const bizKey = Object.keys(biz).find(k => k.startsWith('$')) || '';
    check('businesses has $businessId wildcard', bizKey === '$businessId', bizKey || 'missing');
    const bids = biz[bizKey] || {};
    check('$businessId has outlets node', !!bids.outlets);
    const outs = bids.outlets || {};
    const outKey = Object.keys(outs).find(k => k.startsWith('$')) || '';
    check('outlets has $outletId wildcard', outKey === '$outletId', outKey || 'missing');
}

// ---- 2. bot/firebase.js resolvePath — shared list + no stale literals ----
console.log('\n[2] bot/firebase.js resolvePath');
const fbSrc = read('bot/firebase.js');
const sharedList = ['admins', 'riders', 'riderStats', 'migrationStatus', 'logs', 'settlements', 'phoneNumberIndex'];
const sharedOk = sharedList.every(n => fbSrc.includes(`'${n}'`));
check('resolvePath shared list intact', sharedOk, sharedOk ? sharedList.join(',') : 'missing node');
check('resolvePath uses outlet-resolution helper', /outletPath\(resolveBusinessId\(\)/.test(fbSrc));
check('no botUsers references', !/botUsers/.test(fbSrc));
check('no botStatus references', !/botStatus/.test(fbSrc));

// ---- 3. bot/index.js — migrated literals, no stale tenant paths ----
console.log('\n[3] bot/index.js');
const indexSrc = read('bot/index.js');
check('imports resolvePath from firebase', /require\('\.\/firebase'\)/.test(indexSrc) && /resolvePath/.test(indexSrc));
check('no botUsers references', !/botUsers/.test(indexSrc));
check('no botStatus references', !/botStatus/.test(indexSrc));
check('no raw ${OUTLET}/orders literal', !/\$\{OUTLET\}\/orders/.test(indexSrc));
check('no outlets/${outlet}/ double-prefix', !/outlets\/\$\{outlet\}\//.test(indexSrc));

// Baileys: Section 9 removes it AFTER the gate — warn, not fail (guide 17.8)
if (/\@whiskeysockets\/baileys/.test(indexSrc) || /makeWASocket/.test(indexSrc)) {
    warn('Baileys still required in bot/index.js', 'deferred to Section 9 — does not block this gate');
}

// ---- 4. menu/js/firebase.js — tenant-prefixed outletRef ----
console.log('\n[4] menu/js/firebase.js');
const menuSrc = read('menu/js/firebase.js');
check('BUSINESS_ID resolved from ?b=', /get\('b'\)/.test(menuSrc));
check('outletRef uses businesses/{bid}/outlets/{oid}', /businesses\/\$\{BUSINESS_ID\}\/outlets\/\$\{OUTLET\}\//.test(menuSrc));

// ---- 5. Admin/js/firebase.js — tenantRef/tenantPath + Outlet.ref ----
console.log('\n[5] Admin/js/firebase.js');
const adminSrc = read('Admin/js/firebase.js');
check('BUSINESS_ID getter present', /window\.currentBusinessId/.test(adminSrc));
check('tenantRef exported', /export function tenantRef/.test(adminSrc));
check('tenantPath exported', /export function tenantPath/.test(adminSrc));
const adminGlobal = ['admins', 'riders', 'logs', 'migrationStatus', 'settlements'];
const globalOk = adminGlobal.every(n => adminSrc.includes(`'${n}'`));
check('Outlet.ref globalPaths list', globalOk, globalOk ? adminGlobal.join(',') : 'missing node');
check('Outlet.ref falls back to tenantRef', /return tenantRef\(this\.current/.test(adminSrc));

// ---- 6. rider-app constants.ts — tenantPath + BUSINESS_ID ----
console.log('\n[6] rider-app/src/lib/constants.ts');
const riderSrc = read('rider-app/src/lib/constants.ts');
check('BUSINESS_ID constant', /export const BUSINESS_ID = "roshani"/.test(riderSrc));
check('tenantPath helper', /export function tenantPath/.test(riderSrc));
check('orders dbPath tenant-scoped', /singleOrder: \(outlet: OutletId, orderId: string\) => tenantPath\(outlet, `orders\/\$\{orderId\}`\)/.test(riderSrc));
check('settlements stays platform-root', /settlements: \(rId: string\) => `settlements\/\$\{rId\}`/.test(riderSrc));

// ---- 7. syntax check all touched bot/admin/menu JS ----
console.log('\n[7] syntax (node --check)');
const syntaxFiles = [
    'bot/index.js', 'bot/firebase.js', 'bot/promotions.js', 'bot/discount-engine.js',
    'bot/reports.js', 'bot/rider.js', 'bot/helpers/outlet-resolution.js',
    'bot/tests/unit.test.js', 'bot/tests/integration.test.js',
    'Admin/js/auth.js', 'Admin/js/bot-status.js', 'Admin/js/firebase.js',
    'Admin/js/features/analytics.js', 'Admin/js/features/analytics-mobile.js',
    'Admin/js/features/rider-analytics.js', 'Admin/js/features/pos.js',
    'Admin/js/features/orders.js', 'Admin/js/features/promotions.js',
    'Admin/js/features/settings.js'
];
for (const f of syntaxFiles) {
    try {
        execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
        check(`syntax ok: ${f}`, true);
    } catch (e) {
        check(`syntax ok: ${f}`, false, String(e.stderr || e.message).trim().slice(0, 200));
    }
}

// ---- 8. LIVE gate (guide 17.5) — only when service account provided ----
console.log('\n[8] live DB gate (17.5)');
const saPath = process.env.SERVICE_ACCOUNT;
const dbUrl = process.env.FIREBASE_DB_URL;
if (process.argv.includes('--live')) {
    if (!saPath || !dbUrl) {
        warn('--live requested but SERVICE_ACCOUNT/FIREBASE_DB_URL missing', 'skipped');
    } else {
        try {
            const script = `
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require(${JSON.stringify(path.resolve(ROOT, saPath))})),
  databaseURL: ${JSON.stringify(dbUrl)}
});
admin.database().ref('businesses').limitToFirst(1).once('value', (snap) => {
  const data = snap.val();
  if (!data) { console.log('FAIL:no businesses/ node'); process.exit(1); }
  const bid = Object.keys(data)[0];
  const outlets = data[bid] && data[bid].outlets;
  if (!outlets) { console.log('FAIL:businesses/' + bid + '/outlets missing'); process.exit(1); }
  console.log('OK: found businesses/' + bid + '/outlets/' + Object.keys(outlets)[0]);
  process.exit(0);
}).catch(e => { console.log('FAIL:' + e.message); process.exit(1); });`;
            const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' });
            check('live businesses/{bid}/outlets exists', /OK:/.test(out), out.trim());
        } catch (e) {
            check('live businesses/{bid}/outlets exists', false, String(e.stdout || e.message).trim());
        }
    }
} else {
    console.log('  SKIP  (use --live + SERVICE_ACCOUNT + FIREBASE_DB_URL to run 17.5)');
}

// ---- summary ----
console.log(`\nResult: ${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures === 0 ? 0 : 1);
