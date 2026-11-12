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

const evaluate = read(path.join(source, 'src', 'shared', 'health', 'evaluate.ts'));
ok(!/from 'firebase/.test(evaluate) && !/require\('firebase/.test(evaluate), 'evaluate.ts stays dependency-free (self-check runs it from lib/)');
ok(/STALE_AFTER_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(evaluate), 'stale threshold is 5 minutes');

// The self-check must cover the transition rules, not just the happy path.
const selfCheck = read(path.join(source, 'scripts', 'health-selfcheck.cjs'));
ok(/recovered/.test(selfCheck) && /repeat/.test(selfCheck) && /degraded/.test(selfCheck),
    'self-check covers recovery, hourly repeat and degraded');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
