#!/usr/bin/env node
/**
 * Batch 23c — build step: copy the socket-free bot modules + the pure shared
 * math into `lib/vendor/` so the deployed Functions bundle can require them at
 * runtime (`path.join(__dirname, '../vendor/bot/order-finalizer.js')`).
 *
 * Why copy instead of duplicating: the repo is the source of truth. This script
 * ONLY copies bytes — no transform, no re-export — so the Functions-side
 * finalizer and the WhatsApp bot run literally the same file. `lib/` is
 * gitignored, and `firebase.json` runs `npm run build` (which runs this) in the
 * functions predeploy hook, so the vendored tree can never drift from the repo
 * by more than one build.
 *
 * Two package.json files are written because the Functions package is CommonJS
 * and `shared/*.js` is ESM (`export`). Without them Node would parse the shared
 * math as CJS and every guarded require in the finalizer would fall back to the
 * legacy money math — the shadow compare would silently compare wrong numbers.
 * `lib/vendor/shared/package.json {"type":"module"}` makes require(esm) work on
 * Node >= 22.12 (nodejs22 runtime).
 *
 *   node scripts/copy-vendor.cjs            copy + write .manifest.json
 *   node scripts/copy-vendor.cjs --check    exit 1 if the tree is stale/missing
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../lib/vendor');

// Repo path -> vendored path. Keep both the module graph of
// `bot/order-finalizer.js` and the discount-engine core in sync: utils,
// order-pricing, discount-engine-core, and the four guarded shared imports.
const FILES = [
    'bot/order-finalizer.js',
    'bot/utils.js',
    'bot/order-pricing.js',
    'bot/discount-engine-core.js',
    // Batch 23g: loyalty accrual/clawback + the redemption queue handler. Both
    // are socket-free; `redeem.js` also carries `pointsLapsed`, which the
    // accrual transaction uses for inactivity expiry.
    'bot/loyalty-engine.js',
    'bot/redeem.js',
    // Batch 23h: rider FCM pushes. The Functions triggers build the same copy
    // and resolve order.riderId (UID or email) with the same rules as the bot.
    'bot/rider-push.js',
    'shared/money-math.js',
    'shared/loyalty-math.js',
    'shared/discount-rules.js',
    'shared/geo/geo.js',
    // Batch 23d-2: the notify endpoint prunes the customer inbox with the same
    // module the bot and the control API use, so the cap can never drift.
    'shared/push-inbox.cjs',
    // Batch 23d-3: onboarding writes the same billing defaults to the
    // server-only walletBilling root as the control API; a stale copy here
    // would silently under-provision new tenants.
    'shared/billing-defaults.cjs',
    // Batch 23j: the nightly demo reseed. The builder and its static content are
    // plain CJS with no fs/no firebase-admin, so the Function and the CLI run
    // literally the same bytes (the CLI passed the money math in; so does the
    // factory). `payroll-math.js` is the ESM half of that injected money object.
    'tools/demo-seed-core.cjs',
    'tools/demo-fixtures.cjs',
    'shared/payroll-math.js',
    // Batch 23l: the wallet gate publisher. `cost-math.js` is THE money math
    // (percentage rates, prepaid promo tokens, orderFeePaise deltas) and
    // `meta-cost-math.js` is its one import — a stale copy here would gate
    // outlets on the wrong balance, and the drifted `src/shared/wallet/compute.ts`
    // port it replaces is deleted in the same batch.
    'shared/cost-math.js',
    'shared/meta-cost-math.js',
];

// Module-type markers. `functions/package.json` has no "type", so a .js file is
// CJS unless a nearer package.json says otherwise.
const TYPE_MARKERS = {
    'bot/package.json': { type: 'commonjs' },
    'shared/package.json': { type: 'module' },
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const abs = (rel) => path.join(OUT, rel);

/**
 * Prove the vendored tree actually LOADS and that the shared math is live — not
 * merely that the bytes were copied. Without the module-type markers the shared
 * ESM falls back to the finalizer's frozen legacy math, which would make every
 * shadow comparison silently compare the wrong numbers.
 */
function verifyLoad() {
    const problems = [];
    const finalizerMod = require(abs('bot/order-finalizer.js'));
    const { createDiscountEngine } = require(abs('bot/discount-engine-core.js'));
    const rules = require(abs('shared/discount-rules.js'));
    const inbox = require(abs('shared/push-inbox.cjs'));
    const billing = require(abs('shared/billing-defaults.cjs'));
    const riderPush = require(abs('bot/rider-push.js'));

    if (typeof finalizerMod.createOrderFinalizer !== 'function') problems.push('createOrderFinalizer is not exported');
    if (typeof finalizerMod.compareFinalization !== 'function') problems.push('compareFinalization is not exported');
    if (typeof createDiscountEngine !== 'function') problems.push('createDiscountEngine is not exported');
    if (typeof inbox.prunePushInbox !== 'function' || inbox.DEFAULT_CAP !== 50) {
        problems.push('shared/push-inbox.cjs did not load (prunePushInbox/DEFAULT_CAP)');
    }
    const defaults = typeof billing.getBillingDefaults === 'function' ? billing.getBillingDefaults() : null;
    if (!defaults || defaults.mode !== 'percentage' || !defaults.messageCaps || defaults.setup?.amount !== 0) {
        problems.push('shared/billing-defaults.cjs did not load the current defaults (percentage/messageCaps/no setup fee)');
    }
    if (typeof rules.evaluateDiscounts !== 'function') {
        problems.push('shared/discount-rules.js did not load as ESM (require(esm) needs Node >= 22.12)');
    }
    if (typeof rules.discountAmount !== 'function' || rules.discountAmount({ mode: 'percent', value: 10 }, 697) !== 69.7) {
        problems.push('discountAmount is not the shared math');
    }
    // Batch 23h: the rider push copy + status mapping are the contract the
    // Functions triggers share with the bot. A stale vendored copy would send a
    // different message than the one the bot used to send.
    if (typeof riderPush.createRiderPush !== 'function') problems.push('createRiderPush is not exported');
    const riderCopy = riderPush.riderPushCopy('assigned', { displayId: 'X1', total: 250 });
    if (!riderCopy || riderCopy.title !== 'New Order Assigned!' || !riderCopy.body.includes('₹250')) {
        problems.push('rider push copy drifted from the bot wording');
    }
    if (riderPush.riderStatusEvent('cooked') !== 'ready' || riderPush.riderStatusEvent('delivered') !== '') {
        problems.push('riderStatusEvent no longer maps cooked->ready / ignores other statuses');
    }

    // Batch 23j: the demo builder must load and BUILD in the bundle — a stale
    // fixture copy or a missing payroll import would only show up at 03:00 IST
    // as a failed reseed with the demo left stale. The stub catalog keeps this
    // offline; the point is that the module graph resolves and the money math
    // (computeOrderTotals/round2 + computePayroll) is the real one.
    const demoCore = require(abs('tools/demo-seed-core.cjs'));
    const demoFixtures = require(abs('tools/demo-fixtures.cjs'));
    const payroll = require(abs('shared/payroll-math.js'));
    if (typeof demoCore.createDemoSeedCore !== 'function' || typeof demoCore.loadLiveCatalog !== 'function') {
        problems.push('tools/demo-seed-core.cjs did not load (createDemoSeedCore/loadLiveCatalog)');
    }
    if (!demoFixtures.DISHES || demoFixtures.DISHES.length !== 14 || !demoFixtures.TABLES || demoFixtures.TABLES.length !== 8) {
        problems.push('tools/demo-fixtures.cjs did not load the demo content (14 dishes / 8 tables)');
    }
    if (typeof payroll.computePayroll !== 'function') {
        problems.push('shared/payroll-math.js did not load as ESM (computePayroll)');
    }
    if (typeof demoCore.createDemoSeedCore === 'function' && typeof payroll.computePayroll === 'function') {
        const stubLive = {
            categories: { c1: { name: 'Cat', order: 1 } },
            dishes: { k1: { name: 'Margherita', price: 199, gstRate: 5 } },
            combos: {},
        };
        try {
            const built = demoCore
                .createDemoSeedCore({
                    now: 1763000000000,
                    money: { ...require(abs('shared/money-math.js')), computePayroll: payroll.computePayroll },
                    fixtures: demoFixtures,
                    live: stubLive,
                })
                .buildTenant();
            if (!built || !built.business || !built.billing || !(built.stats.orders > 0)) {
                problems.push('the demo builder produced no tenant from the stub catalog');
            }
            if (built.billing.mode !== 'percentage') {
                problems.push('the demo billing row is no longer on the percentage plan');
            }
        } catch (err) {
            problems.push('the demo builder threw in the bundle: ' + (err && err.message));
        }
    }

    // Batch 23l: the wallet gate. Percentage rates, the index entry point and a
    // real order delta must all be live — a stale/absent copy would let the
    // publisher gate on a number no dashboard shows.
    const costMath = require(abs('shared/cost-math.js'));
    if (typeof costMath.computeWalletFromIndex !== 'function' || typeof costMath.computeWallet !== 'function') {
        problems.push('shared/cost-math.js did not load as ESM (computeWallet/computeWalletFromIndex)');
    } else {
        const qrFee = costMath.orderFeePaise({}, { total: 1000, source: 'QR', status: 'Delivered' });
        const appFee = costMath.orderFeePaise({}, { total: 1000, source: 'APP', status: 'Delivered' });
        const waFee = costMath.orderFeePaise({}, { total: 1000, source: 'webview_delivery', status: 'Delivered' });
        if (qrFee !== 1000 || appFee !== 2000 || waFee !== 3000) {
            problems.push(`percentage rates drifted (QR ${qrFee} / app ${appFee} / WA ${waFee} paise per ₹1000, expected 1000/2000/3000)`);
        }
        const idxWallet = costMath.computeWalletFromIndex({
            billing: { mode: 'percentage', payments: { p: { amount: 2000 } } },
            orderFeeTotal: 10,
            campaigns: { c: { totalSent: 2 } },
        });
        if (!idxWallet || idxWallet.orderFees !== 10 || idxWallet.used !== 12 || idxWallet.balance !== 1988) {
            problems.push('computeWalletFromIndex is not the shared wallet math: ' + JSON.stringify(idxWallet));
        }
    }

    const stub = finalizerMod.createOrderFinalizer({
        db: {}, getData: async () => null, updateData: async () => {},
        resolvePath: (p) => p, saveUserProfile: async () => {},
        getLoyaltyConfig: async () => ({}), discountEngine: {}, orderPricing: {},
    });
    const taxed = stub.verifiedOrderTotals({
        subtotal: 1000, discount: 100, taxRates: [{ name: 'GST', rate: 5 }], serviceCharge: 50,
    });
    if (taxed.total !== 995 || taxed.tax !== 45) {
        problems.push(`tax math fell back to the legacy module (expected 995/45, got ${taxed.total}/${taxed.tax})`);
    }

    const identical = { subtotal: 697, discount: 70, discountId: 'd', deliveryFee: 20, total: 678.35, tax: 31.35, taxItems: [{ name: 'GST', rate: 5, amount: 31.35 }], inventoryDeducted: { a: 2 } };
    const cmp = finalizerMod.compareFinalization({ ...identical, tender: { amountPaise: 20000 }, discountUsageRecorded: true }, { ...identical, loyaltyTender: { amountPaise: 20000 }, discountUsageRecorded: true });
    if (!cmp || cmp.matched !== true) problems.push('compareFinalization did not match an identical record: ' + JSON.stringify(cmp));
    return problems;
}

function build() {
    const manifest = { files: {} };
    for (const rel of FILES) {
        const src = path.join(REPO, rel);
        if (!fs.existsSync(src)) {
            console.error(`copy-vendor: MISSING source ${rel}`);
            process.exit(1);
        }
        const buf = fs.readFileSync(src);
        const dest = abs(rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        manifest.files[rel] = { bytes: buf.length, sha256: sha256(buf) };
    }
    for (const [rel, json] of Object.entries(TYPE_MARKERS)) {
        fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
        fs.writeFileSync(abs(rel), JSON.stringify(json) + '\n');
    }
    fs.writeFileSync(path.join(OUT, '.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const total = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
    const problems = verifyLoad();
    if (problems.length) {
        console.error('copy-vendor: LOAD CHECK FAILED\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    console.log(`copy-vendor: ${FILES.length} modules, ${(total / 1024).toFixed(1)} KB -> lib/vendor/ (load check OK)`);
}

function check() {
    const problems = [];
    for (const rel of FILES) {
        const src = path.join(REPO, rel);
        const dest = abs(rel);
        if (!fs.existsSync(dest)) { problems.push(`missing  ${rel}`); continue; }
        if (sha256(fs.readFileSync(src)) !== sha256(fs.readFileSync(dest))) problems.push(`stale    ${rel}`);
    }
    for (const [rel, json] of Object.entries(TYPE_MARKERS)) {
        if (!fs.existsSync(abs(rel)) || fs.readFileSync(abs(rel), 'utf8').trim() !== JSON.stringify(json)) {
            problems.push(`missing  ${rel} (module type marker)`);
        }
    }
    if (problems.length) {
        console.error('copy-vendor --check: FAIL\n  ' + problems.join('\n  ') + '\n  run `node scripts/copy-vendor.cjs`');
        process.exit(1);
    }
    const loadProblems = verifyLoad();
    if (loadProblems.length) {
        console.error('copy-vendor --check: LOAD FAIL\n  ' + loadProblems.join('\n  '));
        process.exit(1);
    }
    console.log(`copy-vendor --check: OK (${FILES.length} modules match the repo, load check OK)`);
}

if (process.argv.includes('--check')) check();
else build();
