#!/usr/bin/env node
/**
 * Nightly demo reseed guard (batch 23j).
 *
 *   node tests/demo-reseed.check.cjs
 *
 * The job is a scheduled Cloud Function that rewrites the PUBLIC demo tenant, so
 * this guard pins the things that make it safe and correct:
 *
 *   1. the schedule / runtime wiring,
 *   2. the 20 h claim (a retry cannot reseed twice, a failure cannot loop),
 *   3. the builder is DETERMINISTIC and import-free — a frozen `now` must give
 *      byte-identical bytes, and the module must not reach for `fs`,
 *      firebase-admin, `Date.now()` or the network (it is vendored into the
 *      Functions bundle and runs inside it),
 *   4. it only ever writes the demo tenant (and must never write `whatsapp` or
 *      `outletIndex/demo` — either one would expose or provision the sandbox),
 *   5. the root cause of the broken reseed stays fixed: the fixtures are NOT
 *      `Admin/js/demo/demo-data.js` (deleted as an orphan by the KDS review).
 *
 * Behaviour on the real database was proven live (see doc 38); this file is the
 * static half that stops a future edit from quietly changing it.
 */
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// `DEMO_RESEED_FN` exists only so the mutation self-test can point the guard at
// a deliberately broken copy (see doc 38).
const FN = process.env.DEMO_RESEED_FN
    || 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/demoReseed.ts';
const FACTORY = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/demo/factory.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';
const COPY_VENDOR = 'FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs';
const CORE = 'tools/demo-seed-core.cjs';
const FIXTURES = 'tools/demo-fixtures.cjs';
const CLI = 'tools/seed-demo-tenant.cjs';

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fn = stripComments(read(FN));
const factory = stripComments(read(FACTORY));
const index = read(INDEX);
const copyVendor = read(COPY_VENDOR);
const core = read(CORE);
const fixtures = read(FIXTURES);
const cli = read(CLI);

let pass = 0;
const ok = (label, cond, detail) => {
    if (!cond) {
        console.error('  FAIL  ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
        process.exitCode = 1;
        return;
    }
    pass++;
    console.log('  ok  ' + label);
};

(async () => {
    // -----------------------------------------------------------------------
    // 1. The schedule (same wall clock as the dead box cron: 03:00 IST)
    // -----------------------------------------------------------------------
    ok('scheduled daily at 03:00 IST', /schedule:\s*'0 3 \* \* \*'/.test(fn));
    ok('runs in Asia/Kolkata', /timeZone:\s*'Asia\/Kolkata'/.test(fn));
    ok('single instance, so two passes cannot race the claim', /maxInstances:\s*1/.test(fn));
    ok('has FIREBASE_DATABASE_URL bound (public catalog read + writes)', /secrets:\s*\['FIREBASE_DATABASE_URL'\]/.test(fn));
    ok('bounded runtime (build + ~0.5 MB write)', /timeoutSeconds:\s*300/.test(fn));
    ok('exported from the functions entry point', /export \{ demoReseed \}/.test(index));

    // -----------------------------------------------------------------------
    // 2. The claim: one transactional stamp, taken BEFORE the work
    // -----------------------------------------------------------------------
    ok('the claim lives at meta/demoReseed/last', /const CLAIM_PATH = 'meta\/demoReseed\/last'/.test(fn));
    ok('the window is 20 h (daily schedule clears it, a retry does not)', /MIN_INTERVAL_MS = 20 \* 60 \* 60 \* 1000/.test(fn));
    ok('the claim is a transaction, not read-then-set', /ref\(CLAIM_PATH\)\.transaction\(/.test(fn));
    ok('a recent pass aborts the transaction', /if \(at && now - at < MIN_INTERVAL_MS\) return undefined/.test(fn));
    ok('the cold-null pass CLAIMS instead of aborting (RTDB hands null first)',
        /const at = cur && typeof cur === 'object' \? Number\(cur\.at\) \|\| 0 : 0;/.test(fn));
    ok('a lost claim returns before anything is built',
        /if \(!\(await claimPass\(db, now\)\)\)[\s\S]{0,200}return \{ at: now, ran: false, reason: 'recent' \}/.test(fn));
    ok('a failure keeps the claim (no retry loop) but records the reason',
        /reason: 'error', error: message/.test(fn));

    // -----------------------------------------------------------------------
    // 3. The builder is deterministic and import-free
    // -----------------------------------------------------------------------
    // Scan CODE, not prose: both files document the very patterns these checks
    // forbid ("no fs, no Date.now()" in the header).
    const coreCode = stripComments(core);
    const fixturesCode = stripComments(fixtures);
    ok('no fs / path / os require in the builder', !/require\(\s*['"](fs|node:fs|path|node:path|os)['"]\s*\)/.test(coreCode));
    ok('no firebase-admin in the builder', !/firebase-admin/.test(coreCode));
    ok('no Date.now() in the builder (the injected clock is the only time source)',
        !/Date\.now\(\)/.test(coreCode));
    ok('the builder exposes buildTenant()', /function buildTenant\(\)/.test(coreCode) && /return \{ buildTenant \};/.test(coreCode));
    ok('the catalog read is the one explicit async export', /async function loadLiveCatalog/.test(coreCode));

    const fx = require(path.join(ROOT, FIXTURES));
    ok('fixtures are plain CJS data (no imports, no clock, no network)',
        !/^\s*(import|export)\s/m.test(fixturesCode) && !/Date\.now\(\)/.test(fixturesCode) && !/\bfetch\(/.test(fixturesCode));
    ok('fixtures carry the 11 arrays the builder reads', ['DEMO_OUTLET', 'DISHES', 'RIDERS', 'CUSTOMERS', 'STAFF',
        'INVENTORY', 'PROMOTIONS', 'DISCOUNTS', 'FEEDBACK', 'CHATS', 'TABLES'].every((k) => k in fx));
    ok('the deleted demo page data is NOT resurrected', !exists('Admin/js/demo/demo-data.js'));
    ok('the CLI reads the shared fixtures + core, not the deleted page',
        /demo-fixtures\.cjs/.test(cli) && /demo-seed-core\.cjs/.test(cli) && !/demo-data\.js/.test(cli));

    const coreMod = require(path.join(ROOT, CORE));
    const moneyMath = await import(require('url').pathToFileURL(path.join(ROOT, 'shared/money-math.js')).href);
    const payrollMath = await import(require('url').pathToFileURL(path.join(ROOT, 'shared/payroll-math.js')).href);
    const money = { ...moneyMath, computePayroll: payrollMath.computePayroll };

    // A stub catalog keeps this check offline; the point is determinism + the
    // real money math, not the live menu.
    const live = {
        categories: { c1: { name: 'Pizza', order: 1 } },
        dishes: { k1: { name: 'Margherita', price: 199, gstRate: 5 } },
        combos: {},
    };
    const FROZEN = 1763000000000;
    const build = () => coreMod.createDemoSeedCore({ now: FROZEN, money, fixtures: fx, live }).buildTenant();
    const a = build();
    const b = build();
    const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
    ok('a frozen clock produces byte-identical bytes', hash(a.business) === hash(b.business) && hash(a.billing) === hash(b.billing));
    ok('a different clock produces different bytes', (() => {
        const c = coreMod.createDemoSeedCore({ now: FROZEN + 86400000, money, fixtures: fx, live }).buildTenant();
        return hash(c.business) !== hash(a.business);
    })());
    ok('the tenant is built with orders, sessions and a payroll run',
        a.stats.orders > 0 && a.stats.dishes > 0 && a.stats.payrollLines > 0 && a.stats.payloadBytes > 100000);

    const outlet = a.business.outlets[coreMod.OID];
    ok('the demo outlet exists under the demo business', !!outlet && coreMod.BID === 'foodhubbie-demo' && coreMod.OID === 'demo');
    ok('the outlet carries NO whatsapp node (bot-control-api would spawn a worker)',
        !Object.prototype.hasOwnProperty.call(outlet, 'whatsapp'));
    ok('money is on the percentage plan (never the legacy per-order row)', a.billing.mode === 'percentage');
    ok('the welcome token pack is present (prepaid promo model)', Number(a.billing.tokens.balance) >= 0
        && !!a.billing.tokenPacks && !!a.billing.tokenPacks.welcome);
    ok('settings/Delivery.backupCode is 4 digits (anything else silently fails Save Settings)',
        /^\d{4}$/.test(String(outlet.settings?.Delivery?.backupCode || '')));
    ok('settings/Store.storeName is the demo name the sidebar shows',
        outlet.settings?.Store?.storeName === coreMod.DEMO_OUTLET_NAME);

    // -----------------------------------------------------------------------
    // 4. Writes: only the demo tenant, and never the two forbidden nodes
    // -----------------------------------------------------------------------
    ok('writes businesses/{DEMO_BID} once, without the orders section',
        /ref\(`businesses\/\$\{DEMO_BID\}`\)/.test(fn)
        && /\.set\(\{ \.\.\.business, outlets:/.test(fn)
        && /delete outlet\.orders/.test(fn));
    ok('writes orders in chunks under the v2 trigger budget (500 events/write)',
        /ORDERS_PER_WRITE = (\d+)/.test(fn) && Number(RegExp.$1) <= 40
        && /ordersRef\.update\(patch\)/.test(fn));
    ok('DELETES yesterday\'s orders in chunks too (a delete fans out like a write)',
        // Live run 2 was rejected by TOO_MANY_TRIGGERS with the old two-phase
        // write: omitting `orders` from the parent set() deletes every order and
        // fires the `status` triggers with after = null.
        /existing\.slice\(i, i \+ ORDERS_PER_WRITE\)/.test(fn)
        && /patch\[key\] = null/.test(fn)
        && fn.indexOf('existing.slice') < fn.indexOf('.set({ ...business'));
    ok('the chunk loop covers every built order (no silent drop)',
        /for \(let i = 0; i < keys\.length; i \+= ORDERS_PER_WRITE\)/.test(fn)
        && /writtenOrders !== stats\.orders/.test(fn));
    ok('writes the server-only walletBilling row, not a tenant billing node',
        /ref\(`walletBilling\/\$\{DEMO_BID}\/\$\{DEMO_OID\}`\)\.set\(billing\)/.test(fn)
        && !/billing'\)/.test(fn));
    ok('mirrors the demo admin with isDemo:true', /isDemo: true/.test(fn) && /ref\(`admins\/\$\{uid\}`\)\.set/.test(fn));
    ok('REMOVES outletIndex/demo (no QR/menu link may resolve the sandbox)',
        /ref\(`outletIndex\/\$\{DEMO_OID\}`\)\.remove\(\)/.test(fn));
    ok('never writes a whatsapp node', !/whatsapp/i.test(fn));
    ok('never writes outletIndex (only removes it)', !/outletIndex[\s\S]{0,40}\.set\(/.test(fn));
    const refs = [...fn.matchAll(/db\s*\n?\s*\.ref\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ''));
    ok('every database reference is one of the demo paths', refs.length > 0 && refs.every((r) =>
        r === '`businesses/${DEMO_BID}`' || r === '`walletBilling/${DEMO_BID}/${DEMO_OID}`'
        || r === '`businesses/${DEMO_BID}/outlets/${DEMO_OID}/orders`'
        || r === '`admins/${uid}`' || r === '`outletIndex/${DEMO_OID}`' || r === 'CLAIM_PATH'), refs);
    ok('keeps the demo Auth user usable (password/name/verified) on every pass',
        /updateUser\(user\.uid, \{[\s\S]{0,200}password: DEMO_PASSWORD/.test(fn));

    // -----------------------------------------------------------------------
    // 5. The bundle actually carries the builder
    // -----------------------------------------------------------------------
    ok('copy-vendor vendors the core + fixtures + payroll math',
        /'tools\/demo-seed-core\.cjs'/.test(copyVendor) && /'tools\/demo-fixtures\.cjs'/.test(copyVendor)
        && /'shared\/payroll-math\.js'/.test(copyVendor));
    ok('copy-vendor load-checks the builder (a broken bundle must fail the build)',
        /the demo builder produced no tenant/.test(copyVendor));
    ok('the factory resolves the vendored core from lib/vendor',
        /path\.join\(__dirname, '\.\.\/\.\.\/vendor'\)/.test(factory) && /tools\/demo-seed-core\.cjs/.test(factory));
    ok('the factory injects the real money + payroll math',
        /computePayroll: payrollMath\.computePayroll/.test(factory));
    ok('the factory takes `now` as an argument (no wall clock inside)',
        /opts: \{ now: number/.test(factory) || /now: number;/.test(factory));

    // -----------------------------------------------------------------------
    // 6. Every order trigger hard-skips the demo tenant
    // -----------------------------------------------------------------------
    // The nightly reseed creates ~353 orders in one pass. A trigger that does
    // not skip the demo would run hundreds of times against fake food: the
    // legacy status handler WRITES `placedAt` onto the seeded order (so the demo
    // stops being the bytes the builder produced) and the 23c shadow triggers
    // dry-run the real finalizer and write a shadow row per web-source order.
    // Both were found live during the 23j E2E — the write itself was also
    // rejected by the 500-events-per-write v2 trigger cap.
    const TRIGGERS_DIR = path.join(ROOT, 'FIREBASE_SERVER_MIGRATION/functions/src/triggers');
    const ORDER_REF = /ref:\s*'businesses\/\{bid\}\/outlets\/\{oid\}\/orders\//;
    const orderTriggers = fs.readdirSync(TRIGGERS_DIR).filter((f) => f.endsWith('.ts'))
        .filter((f) => ORDER_REF.test(fs.readFileSync(path.join(TRIGGERS_DIR, f), 'utf8')));
    ok('found every module that watches an order path', orderTriggers.length >= 6, orderTriggers);
    ok('every order trigger hard-skips the demo tenant', orderTriggers.every((f) =>
        /DEMO_BUSINESS_ID\s*=\s*'foodhubbie-demo'/.test(fs.readFileSync(path.join(TRIGGERS_DIR, f), 'utf8'))
        && /bid === DEMO_BUSINESS_ID/.test(fs.readFileSync(path.join(TRIGGERS_DIR, f), 'utf8'))),
        orderTriggers.filter((f) => !/bid === DEMO_BUSINESS_ID/.test(fs.readFileSync(path.join(TRIGGERS_DIR, f), 'utf8'))));
    ok('every watch module declares its own demo constant (no shared import to drift)',
        orderTriggers.every((f) => /DEMO_BUSINESS_ID\s*=\s*'foodhubbie-demo'/.test(fs.readFileSync(path.join(TRIGGERS_DIR, f), 'utf8'))));

    console.log(`\n${pass} passed, ${process.exitCode ? 1 : 0} failed`);
})().catch((e) => {
    console.error('demo-reseed guard crashed:', e && (e.stack || e));
    process.exit(1);
});
