/**
 * Seed the PUBLIC DEMO tenant (foodhubbie-demo/demo) with a fresh 88-day
 * synthetic dataset: 6 categories / 22 real dishes / 4 combos copied from the
 * live catalog, ~350 orders, open sessions, customers, staff + payroll, riders,
 * inventory, expenses and billing into `walletBilling/`.
 *
 * Batch 23j: the tenant is BUILT by `tools/demo-seed-core.cjs` (the same module
 * the nightly Cloud Function `demoReseed` runs) and its static content lives in
 * `tools/demo-fixtures.cjs`. This file is only the command line: resolve the
 * ESM money math, read the public catalog, print the summary, and — with
 * `--apply` — write it.
 *
 *   node tools/seed-demo-tenant.cjs                 # dry run: build + print summary
 *   node tools/seed-demo-tenant.cjs --apply         # write to RTDB
 *   DEMO_SEED_NOW=1763000000000 node tools/...      # freeze the clock (deterministic)
 *
 * Never seeds `outletIndex/demo` (no QR/menu link may resolve the demo outlet)
 * and never gives the outlet a `whatsapp` node.
 */

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const admin = require(path.join(ROOT, 'bot', 'node_modules', 'firebase-admin'));
const serviceAccount = require(path.join(ROOT, 'bot', 'service-account.json'));

const {
    createDemoSeedCore, loadLiveCatalog,
    BID, OID, DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME, SOURCE_BID, SOURCE_OID,
} = require('./demo-seed-core.cjs');

const APPLY = process.argv.includes('--apply');
const NOW_OVERRIDE = Number(process.env.DEMO_SEED_NOW) || 0;
const DB_URL = process.env.FIREBASE_DATABASE_URL
    || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

(async () => {
    console.log(`[demo-seed] ${APPLY ? 'APPLY' : 'DRY RUN'} -> ${DB_URL} (${BID}/${OID})`);

    const moneyMath = await import(pathToFileURL(path.join(ROOT, 'shared', 'money-math.js')).href);
    const payrollMath = await import(pathToFileURL(path.join(ROOT, 'shared', 'payroll-math.js')).href);
    const money = { ...moneyMath, computePayroll: payrollMath.computePayroll };

    const live = await loadLiveCatalog({ dbUrl: DB_URL, sourceBid: SOURCE_BID, sourceOid: SOURCE_OID });
    const core = createDemoSeedCore({
        now: NOW_OVERRIDE || Date.now(),
        money,
        fixtures: require('./demo-fixtures.cjs'),
        live,
    });
    const { business, billing, stats } = core.buildTenant();

    console.log('[demo-seed] catalog source  ', `${SOURCE_BID}/${SOURCE_OID} -> ${Object.keys(business.outlets[OID].categories).length} categories, `
        + `${stats.dishes} dishes, ${stats.combos} combos`);
    console.log('[demo-seed] orders        ', stats.orders);
    console.log('[demo-seed] open sessions ', stats.openSessions);
    console.log('[demo-seed] customers     ', stats.customers);
    console.log('[demo-seed] dishes/combos ', stats.dishes, '/', stats.combos);
    console.log('[demo-seed] staff         ', stats.staff);
    console.log('[demo-seed] payroll lines ', stats.payrollLines, '· net', stats.payrollNet);
    console.log('[demo-seed] payload       ', (stats.payloadBytes / 1024).toFixed(1) + ' KB');

    if (!APPLY) {
        console.log('[demo-seed] dry run complete - pass --apply to write');
        return;
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DB_URL,
    });
    const db = admin.database();

    // 1. Auth user (create once, then keep password/display name in sync)
    let user;
    try {
        user = await admin.auth().getUserByEmail(DEMO_EMAIL);
        await admin.auth().updateUser(user.uid, {
            password: DEMO_PASSWORD, displayName: DEMO_NAME, emailVerified: true, disabled: false,
        });
        console.log('[demo-seed] auth user updated', user.uid);
    } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
        user = await admin.auth().createUser({
            email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: DEMO_NAME, emailVerified: true,
        });
        console.log('[demo-seed] auth user created', user.uid);
    }

    // 2. Business subtree (whole-node replace: the demo tenant has no live writers)
    await db.ref(`businesses/${BID}`).set(business);
    console.log('[demo-seed] wrote businesses/' + BID);

    // Money lives at the ROOT (server-owned): businesses/{bid} is tenant-writable.
    await db.ref(`walletBilling/${BID}/${OID}`).set(billing);
    console.log('[demo-seed] wrote walletBilling/' + BID + '/' + OID);

    // 3. Admin node
    await db.ref(`admins/${user.uid}`).set({
        uid: user.uid,
        email: DEMO_EMAIL,
        name: DEMO_NAME,
        displayName: DEMO_NAME,
        role: 'Admin',
        outlet: OID,
        businessId: BID,
        isDemo: true,
        isActive: true,
        fcmToken: '',
        createdAt: Date.now(),
    });
    console.log('[demo-seed] wrote admins/' + user.uid);

    // 4. The demo outlet must never be resolvable from a QR/menu link
    await db.ref(`outletIndex/${OID}`).remove();
    console.log('[demo-seed] ensured outletIndex/' + OID + ' is absent');

    console.log('[demo-seed] done');
    process.exit(0);
})().catch((e) => {
    console.error('[demo-seed] FAILED:', e && (e.stack || e.message || e));
    process.exit(1);
});
