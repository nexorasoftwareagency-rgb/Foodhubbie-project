#!/usr/bin/env node
/**
 * Guard: the Functions deploy source must be the code that is actually live.
 *
 *   node tests/functions-source.check.cjs
 *
 * Background (batch 23a): `firebase.json` used `"functions": { "code": "functions" }`.
 * `code` is not a recognised key (the key is `source`), so the CLI silently fell
 * back to the `functions/` directory - a stale plain-JS tree that contains ONE
 * function (`processDishImage`, never deployed). A `firebase deploy --only
 * functions` from the repo root would therefore have DELETED all 11 live
 * functions. The real source is `FIREBASE_SERVER_MIGRATION/functions` (TS,
 * nodejs22), which is what is deployed today.
 *
 * Static checks only - no network, no credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (detail ? ' :: ' + detail : '')); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const firebaseJson = JSON.parse(read('firebase.json'));
const fnCfg = firebaseJson.functions || {};
const source = String(fnCfg.source || '').replace(/\\/g, '/');

ok(!!fnCfg.source, 'firebase.json functions.source is set (the key the CLI reads)', JSON.stringify(Object.keys(fnCfg)));
ok(!('code' in fnCfg), 'the dead "code" key is gone (it was silently ignored)');
ok(source === 'FIREBASE_SERVER_MIGRATION/functions', 'deploy source is the tree the 11 live functions come from', source);

const pkgPath = path.join(ROOT, source, 'package.json');
ok(fs.existsSync(pkgPath), 'source dir has a package.json', source);
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
ok(!!(pkg.dependencies && pkg.dependencies['firebase-functions']), 'source depends on firebase-functions', JSON.stringify(pkg.dependencies || {}));
ok(!(pkg.dependencies && pkg.dependencies.sharp), 'source has no sharp (that belongs to the abandoned functions/ tree)');
ok(String((pkg.engines && pkg.engines.node) || '') === '22', 'runs on Node 22 (deployed runtime)', String(pkg.engines && pkg.engines.node));


// The legacy plain-JS tree must exist but must NOT be the deploy source.
const legacy = path.join(ROOT, 'functions', 'index.js');
ok(fs.existsSync(legacy), 'legacy functions/ tree still present (left in place, not deployed)');

// Batch 23a export + wiring.
const entry = read(path.join(source, 'src', 'index.ts'));
ok(/export\s*\{\s*platformHealth\s*\}/.test(entry), 'index.ts exports platformHealth');

const health = read(path.join(source, 'src', 'scheduled', 'platformHealth.ts'));
ok(/schedule:\s*'every 5 minutes'/.test(health), 'platformHealth runs every 5 minutes');
ok(/secrets:\s*\[\s*'FIREBASE_DATABASE_URL'\s*\]/.test(health), 'platformHealth binds FIREBASE_DATABASE_URL');
ok(/status-all/.test(health), 'platformHealth probes api.foodhubbie.in/api/bot/status-all');
ok(/sendEachForMulticast/.test(health), 'platformHealth pushes via FCM multicast');
ok(/fcmTokenInvalidAt/.test(health), 'platformHealth marks dead tokens (same convention as the bot)');
// Never download the whole tree (batch-10 / batch-14 lesson).
ok(!/ref\(\s*'businesses'\s*\)/.test(health), 'platformHealth does not read the businesses tree');
ok(!/ref\(`businesses\/\$\{[^}]+\}\/outlets\/\$\{[^}]+\}\/botStatus`\s*\)\.once/.test(health),
    'platformHealth reads only botStatus leaves, not the node with its history');


// Batch 23c export + wiring: the web/app order finalizer runs in the Functions
// bundle in SHADOW mode (dry run, compare with the bot's own order).
ok(/export\s*\{\s*onWebOrderPlacedShadow,/.test(entry) && /onWebOrderFinalizedShadow/.test(entry),
    'index.ts exports both order-finalizer shadow triggers');
ok(/node scripts\/copy-vendor\.cjs/.test(String(pkg.scripts && pkg.scripts.build)),
    'the build copies the bot modules into lib/vendor before tsc compiles');

const copyVendor = read(path.join(source, 'scripts', 'copy-vendor.cjs'));
for (const rel of [
    'bot/order-finalizer.js', 'bot/utils.js', 'bot/order-pricing.js', 'bot/discount-engine-core.js',
    'shared/money-math.js', 'shared/loyalty-math.js', 'shared/discount-rules.js', 'shared/geo/geo.js',
]) {
    ok(copyVendor.includes(`'${rel}'`), `vendor list ships ${rel}`);
}
ok(/shared\/package\.json': \{ type: 'module' \}/.test(copyVendor),
    'the ESM shared math gets a {type:module} marker (CJS package would fall back to legacy math)');
ok(/function verifyLoad\(\)/.test(copyVendor) && /tax math fell back/.test(copyVendor),
    'the build proves the vendored tree loads with the shared math, not just that bytes were copied');

const shadowTrigger = read(path.join(source, 'src', 'triggers', 'orderFinalizerShadow.ts'));
ok(/onValueCreated\(/.test(shadowTrigger), 'the placed stage triggers on order creation');
ok(/orders\/\{orderId\}\/stockDeducted/.test(shadowTrigger), 'the finalize stage triggers on the stockDeducted flag, not the whole order');
ok(/dryRun: true/.test(shadowTrigger), 'the shadow run is a DRY RUN');
ok(!/dryRun: false/.test(shadowTrigger), 'nothing in the trigger opts out of dry run');
ok(/compareFinalization\(/.test(shadowTrigger), 'the finalize stage compares the stored verdict with the bot order');
ok(/migrationFlags\/orderFinalizerShadow\/enabled/.test(shadowTrigger), 'a kill switch can stop both triggers');
ok(/WEB_SOURCES = \['webview_delivery', 'APP'\]/.test(shadowTrigger), 'only browser-written orders are observed');
ok(/secrets: \['FIREBASE_DATABASE_URL'\]/.test(shadowTrigger), 'both triggers bind FIREBASE_DATABASE_URL');
ok(/require\(path\.join\(VENDOR/.test(shadowTrigger), 'the trigger loads the vendored copy of the bot module (no re-implementation)');

const evaluate = read(path.join(source, 'src', 'shared', 'health', 'evaluate.ts'));
ok(!/from 'firebase/.test(evaluate) && !/require\('firebase/.test(evaluate), 'evaluate.ts stays dependency-free (self-check runs it from lib/)');
ok(/STALE_AFTER_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(evaluate), 'stale threshold is 5 minutes');

// The self-check must cover the transition rules, not just the happy path.
const selfCheck = read(path.join(source, 'scripts', 'health-selfcheck.cjs'));
ok(/recovered/.test(selfCheck) && /repeat/.test(selfCheck) && /degraded/.test(selfCheck),
    'self-check covers recovery, hourly repeat and degraded');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
