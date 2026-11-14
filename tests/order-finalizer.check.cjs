#!/usr/bin/env node
/**
 * Guard: batch 23b — the web/app order finalizer is SOCKET-FREE and is the
 * single finalization path in the WhatsApp bot.
 *
 *   node tests/order-finalizer.check.cjs        (npm run test:order-finalizer)
 *
 * Background: `menus/js/*` writes orders straight to Firebase, so the server
 * re-prices them (catalog, tax, delivery fee, discount, reward tender, stock).
 * That pipeline used to be inline in `bot/index.js`, which the Cloud Functions
 * trigger (batch 23c) cannot import — it would drag Baileys, Redis and a
 * privileged Firebase init into the Functions bundle. It now lives in
 * `bot/order-finalizer.js` behind injected deps.
 *
 * This guard pins the extraction so it cannot quietly regress:
 *   - the module imports nothing but `./utils` + the pure `shared/*` math,
 *   - every DB/socket capability arrives as a dep (missing dep = loud throw),
 *   - `bot/index.js` has exactly ONE finalization call site and no leftover
 *     local copies of the extracted helpers,
 *   - `isDineInOrder` has one definition (bot/utils.js) shared by both files,
 *   - the returned record carries the fields 23c's shadow compare needs.
 *
 * Static + one in-process build of the factory. No network, no credentials.
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

const mod = read('bot/order-finalizer.js');
const index = read('bot/index.js');
const utils = read('bot/utils.js');
const engine = read('bot/discount-engine-core.js');
const engineShim = read('bot/discount-engine.js');

// ── the module is socket-free ─────────────────────────────────────────────
ok(/module\.exports\s*=\s*\{\s*createOrderFinalizer,\s*compareFinalization\s*\}/.test(mod),
    'exports exactly createOrderFinalizer + the pure compareFinalization');
for (const bad of [
    "require('baileys')",
    "require('@whiskeysockets/baileys')",
    "require('redis')",
    "require('./firebase')",
    "require('./index')",
    "require('./helpers/",
    "require('./promotions')",
]) {
    ok(!mod.includes(bad), `does not import ${bad}`);
}
const requires = [...mod.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
ok(requires.length > 0, 'has the expected guarded requires', requires.join(', '));
ok(requires.every((r) => r === './utils' || r.startsWith('../shared/')),
    'only ./utils + the pure shared/* modules are require()d', requires.join(', '));
ok(/function createOrderFinalizer\(deps\)/.test(mod), 'capabilities are injected, not module-level singletons');
ok(/missing required dep/.test(mod), 'the factory refuses to build with a missing dep');
ok(/cold-tx seed|cur \|\| reward|cur \|\| seed|cur \|\| base/.test(mod), 'transactions seed the cold first ticket (RTDB hands null even for existing nodes)');

// ── one finalization path in the bot ──────────────────────────────────────
const callSites = index.match(/finalizeWebOrder\(/g) || [];
ok(callSites.length === 1, 'bot/index.js has exactly one finalizeWebOrder call site', String(callSites.length));
for (const helper of ['deductInventoryStock', 'restoreOrderInventory', 'verifyRewardTender', 'verifiedOrderTotals', 'serverTaxRates', 'serverDeliveryFee']) {
    const localDef = new RegExp(`^\\s*(?:async\\s+)?function\\s+${helper}\\s*\\(`, 'm').test(index);
    ok(!localDef, `bot/index.js has no local ${helper} definition`);
}
ok(/orderFinalizer\.restoreOrderInventory/.test(index), 'cancel/refund restore goes through the module');
ok(/orderFinalizer\.verifiedOrderTotals/.test(index) && /orderFinalizer\.serverTaxRates/.test(index),
    'the QR dine-in verifier reuses the same money math (one definition)');
ok(/order-finalizer failed to load/.test(index), 'guarded require keeps the WhatsApp bot alive on a broken module');

// Deps wiring: every required capability is passed at the construction site.
const ctor = (index.match(/createOrderFinalizer\(\{[\s\S]*?\}\)/) || [''])[0];
ok(!!ctor, 'bot/index.js constructs the finalizer');
for (const dep of ['db', 'getData', 'updateData', 'resolvePath', 'saveUserProfile', 'getLoyaltyConfig', 'discountEngine', 'orderPricing', 'defaultOutlet: OUTLET']) {
    ok(ctor.includes(dep), `construction passes ${dep}`);
}
ok(/notify:\s*\(sock, orderId, order, type\)/.test(ctor), 'construction passes the WhatsApp alert as notify');

// ── isDineInOrder: one definition, shared ─────────────────────────────────
const defs = (src) => (src.match(/function\s+isDineInOrder\s*\(/g) || []).length;
ok(defs(utils) === 1 && defs(index) === 0 && defs(mod) === 0,
    'isDineInOrder defined once, in bot/utils.js', `utils=${defs(utils)} index=${defs(index)} module=${defs(mod)}`);
ok(/isDineInOrder,/.test(utils), 'bot/utils.js exports isDineInOrder');
ok(/\bisDineInOrder\b/.test(index) && /\bisDineInOrder\b/.test(mod), 'both files import/use the shared definition');

// ── 23c shadow compare contract ───────────────────────────────────────────
for (const key of ['priceChanged', 'subtotal', 'discount', 'discountId', 'deliveryFee', 'total', 'tax', 'taxItems', 'inventoryDeducted', 'tender', 'discountUsageRecorded']) {
    ok(new RegExp(`\\b${key}:`).test(mod), `finalizeWebOrder reports ${key} (shadow-compare field)`);
}

// ── 23c dry run: compute the verdict, write nothing ───────────────────────
// The Functions trigger must be able to run this exact pipeline against a live
// order without touching it, so every write in the interface is behind `shadow`
// and both mutating helpers take { dryRun }.
ok(mod.includes("async function finalizeWebOrder({ orderId, order, sock = null, dryRun = false, owner = 'server' })"),
    'finalizeWebOrder accepts an explicit dryRun flag (defaults to a real run) and a claim owner');
ok(/const shadow = !!dryRun;/.test(mod), 'every write is guarded by one shadow flag');
for (const [site, label] of [
    ['if (!shadow) await updateData(`orders/${orderId}`, { priceReview: review }', 'priceReview write'],
    ['if (!shadow) await updateData(`orders/${orderId}`, { items: priced.items, subtotal: priced.subtotal }', 're-priced items write'],
    ['await (shadow ? Promise.resolve() : updateData(`orders/${orderId}`, correction', 'verified-total write-back'],
    ['if (!shadow) await updateData(`orders/${orderId}`, correction, outlet).catch(() => {})', 'discount correction write'],
    ['if (!shadow) await updateData(`orders/${orderId}`, { stockDeducted: true, inventoryDeducted }', 'stock flag write'],
    ['if (!shadow && notify) notify(sock, orderId, order, "NEW")', 'WhatsApp new-order alert'],
    ['if (!shadow && order.phone) {', 'customer profile mirror'],
    ['if (!shadow && order.discount > 0 && order.discountId) {', 'discount usage record'],
]) {
    ok(mod.includes(site), `dry run does not perform the ${label}`);
}
ok(/await deductInventoryStock\(sock, order\.items, outlet, \{ dryRun: shadow \}\)/.test(mod),
    'stock is computed in dry run, not written');
ok(mod.includes('async function deductInventoryStock(sock, items, outlet = defaultOutlet, opts = {})')
    && /const dryRun = !!\(opts && opts\.dryRun\)/.test(mod)
    && mod.includes('if (!dryRun) {\n                    await inventoryRef.child(id).update')
    && /if \(!dryRun && newStock <= threshold/.test(mod),
    'stock deduction writes and alerts only on a real run');
ok(mod.includes('async function verifyRewardTender(orderId, order, outlet, opts = {})')
    && mod.includes('if (dryRun) return tenderRecord;')
    && mod.indexOf('if (dryRun) return tenderRecord;') < mod.indexOf('const burn = await rewardRef.transaction'),
    'a reward code is only burned on a real run (dry run returns the would-be record)');

// compareFinalization is pure: no deps, no I/O.
const compareBody = mod.slice(mod.indexOf('function compareFinalization('), mod.indexOf('module.exports'));
ok(!/updateData\(|\.transaction\(|\.once\(|require\(/.test(compareBody), 'compareFinalization performs no I/O');
ok(mod.includes('function compareFinalization(shadow, actual)'), 'compareFinalization takes the shadow record + the finalized order');

// ── 23c prerequisite: the discount engine lost its ./firebase import ──────
ok(!engine.includes("require('./firebase"), 'discount-engine-core.js owns no Firebase instance');
ok(!engine.includes("require('./discount-engine"), 'the core is not built on the bot shim');
ok(engine.includes('function createDiscountEngine({ db, getData, resolvePath })'), 'the core takes its DB capability as arguments');
ok(engine.includes('missing required dep'), 'the core refuses to build without db/getData/resolvePath');
ok(engine.includes('const key = resolvePath(') && engine.includes('_cache.set(key,'),
    'the discount cache is keyed by the RESOLVED path (colliding outlet ids cannot share an entry)');
ok(engine.includes('module.exports = { createDiscountEngine, discountAmount }'), 'the core exports the factory + the pure amount helper');
ok(engineShim.length < 1200, 'the bot shim is a shim, not a second implementation', engineShim.length + ' bytes');
ok(engineShim.includes('createDiscountEngine({ db, getData, resolvePath })'), 'the shim builds the core from bot/firebase.js');
ok(engineShim.includes('...createDiscountEngine'), 'the shim keeps every existing call site working');
ok(!/async function|transaction\(/.test(engineShim), 'no logic lives in the shim');

// ── the factory actually builds and its math is the shared math ───────────
const { createOrderFinalizer, compareFinalization } = require(path.join(ROOT, 'bot/order-finalizer.js'));
ok(typeof createOrderFinalizer === 'function', 'module loads with no side effects');
ok(typeof compareFinalization === 'function', 'compareFinalization is exported from the module');
let threw = null;
try { createOrderFinalizer({}); } catch (e) { threw = e.message; }
ok(!!threw && /missing required dep/.test(threw), 'empty deps throw loudly', threw || 'no throw');
const stub = createOrderFinalizer({
    db: {}, getData: async () => null, updateData: async () => {},
    resolvePath: (p) => p, saveUserProfile: async () => {},
    getLoyaltyConfig: async () => ({}), discountEngine: {}, orderPricing: {},
});
ok(typeof stub.finalizeWebOrder === 'function' && typeof stub.verifyRewardTender === 'function',
    'factory returns the pipeline surface');
const legacy = stub.verifiedOrderTotals({ subtotal: 100, discount: 10, claimedTax: 5, deliveryFee: 20 });
ok(legacy.total === 115 && legacy.tax === null, 'legacy fallback totals unchanged (100 + 5 + 20 - 10)', JSON.stringify(legacy));
const taxed = stub.verifiedOrderTotals({
    subtotal: 1000, discount: 100, taxRates: [{ name: 'GST', rate: 5 }], serviceCharge: 50,
});
ok(taxed.tax === 45 && taxed.total === 995 && taxed.taxName === 'GST',
    'tax on net taxable + SC on subtotal (900 + 45 + 50)', JSON.stringify(taxed));
const noTax = stub.verifiedOrderTotals({ subtotal: 200, discount: 0, taxRates: [], claimedTax: 18 });
ok(noTax.tax === 0 && noTax.total === 200, 'an empty taxRates array means no tax, never the client claim', JSON.stringify(noTax));

// ── compareFinalization: the shadow verdict vs the bot's order ────────────
const shadowRec = {
    ok: true, subtotal: 697, discount: 70, discountId: 'd1', deliveryFee: 20,
    total: 678.35, tax: 31.35, taxItems: [{ name: 'GST', rate: 5, amount: 31.35 }],
    inventoryDeducted: { 'i-marg': 2, 'i-farm': 1 },
    tender: { amountPaise: 20000 }, discountUsageRecorded: true,
};
const actualOrder = {
    subtotal: 697, discount: 70, discountId: 'd1', deliveryFee: 20,
    total: 678.35, tax: 31.35, taxItems: [{ name: 'GST', rate: 5, amount: 31.35 }],
    inventoryDeducted: { 'i-farm': 1, 'i-marg': 2 },
    loyaltyTender: { amountPaise: 20000 }, discountUsageRecorded: true,
};
const same = compareFinalization(shadowRec, actualOrder);
ok(same.matched === true && same.diffs.length === 0, 'a faithful finalization matches (key order + paisa rounding do not matter)', JSON.stringify(same.diffs));
const diffsOf = (patch) => compareFinalization(shadowRec, { ...actualOrder, ...patch }).diffs.map((d) => d.field);
ok(diffsOf({ total: 1 }).join() === 'total', 'a tampered total is reported');
ok(diffsOf({ subtotal: 1 }).join() === 'subtotal', 'a tampered subtotal is reported');
ok(diffsOf({ discount: 0, discountId: null, discountUsageRecorded: false }).sort().join() === 'discount,discountId,discountUsageRecorded',
    'a discount that was not applied is reported once per consequence', diffsOf({ discount: 0, discountId: null, discountUsageRecorded: false }).join());
ok(diffsOf({ deliveryFee: 0 }).join() === 'deliveryFee', 'a delivery fee that was not re-derived is reported');
ok(diffsOf({ tax: 0 }).join() === 'tax', 'a stale tax amount is reported');
ok(diffsOf({ taxItems: [] }).join() === 'taxItems', 'a stale tax breakdown is reported');
ok(diffsOf({ inventoryDeducted: { 'i-marg': 1 } }).join() === 'inventoryDeducted', 'a wrong stock deduction is reported');
ok(diffsOf({ loyaltyTender: null }).join() === 'loyaltyTender.amountPaise', 'a missing reward tender is reported');
ok(compareFinalization(null, actualOrder).matched === false && compareFinalization(null, actualOrder).diffs[0].field === 'record',
    'a missing shadow record is a mismatch, never a pass');
ok(compareFinalization({ ...shadowRec, total: 678.352 }, { ...actualOrder, total: 678.35 }).matched === true,
    'money compares at paisa precision (2dp rounding on both sides)');

// ── batch 23f: at-most-once claim shared by bot + cloud ───────────────────
ok(/const FINALIZE_CLAIM_TTL_MS = 5 \* 60 \* 1000;/.test(mod),
    'an abandoned finalization claim expires after 5 minutes');
ok(/async function claimFinalization\(orderId, outlet, owner\)/.test(mod)
    && /orders\/\$\{orderId\}\/finalizeClaim/.test(mod)
    && /\.transaction\(/.test(mod)
    && /cur \|\| seed/.test(mod),
    'the claim is a cold-tx-seeded transaction on orders/{id}/finalizeClaim');
ok(mod.indexOf("result.skipped = 'already-finalized';") > -1
    && mod.indexOf("result.skipped = 'already-finalized';") < mod.indexOf('// --- SAFEST-FIRST: server-side re-pricing ---'),
    'a finalized order returns before any side effect');
ok(mod.indexOf("result.skipped = 'claimed';") > -1
    && mod.indexOf("result.skipped = 'claimed';") < mod.indexOf('// --- SAFEST-FIRST: server-side re-pricing ---'),
    'a lost claim returns before any side effect');
ok(/if \(!shadow\) \{\s*await db\.ref\(resolvePath\(`orders\/\$\{orderId\}\/finalizeClaim`, outlet\)\)\.remove\(\)/.test(mod),
    'a hard failure releases the claim so a later event can retry');
ok(/skipped: null,/.test(mod), 'the verdict reports why a run was skipped');

// ── batch 23f: the bot stands down when the cloud owns finalization ───────
ok(/async function isOrderFinalizerRelayEnabled\(\)/.test(index)
    && /config\/orderFinalizer\/enabled/.test(index)
    && /snap\.val\(\) === true/.test(index),
    'the bot reads the same flag and only an explicit true disables it');
ok(/await orderFinalizer\.finalizeWebOrder\(\{ orderId: snap\.key, order, sock: currentSock, owner: 'bot' \}\)/.test(index),
    'the bot labels its own finalization claim');
ok(/if \(shouldFinalizeWebOrder\(order\) && orderFinalizer && !finalizerRelay\)/.test(index),
    'the bot does not finalize while the cloud owns it');
ok(/if \(order && !finalizerRelay\) releaseOrderDiscountUsage/.test(index),
    'the bot does not release discount usage while the cloud owns it');
ok(/if \(order && orderFinalizer && !finalizerRelay\) orderFinalizer\.restoreOrderInventory/.test(index),
    'the bot does not restore stock while the cloud owns it');
ok(/async function alertAdminFinalizedWebOrder/.test(index)
    && /orders\/\$\{orderId\}\/_adminWaNotified/.test(index)
    && /\.transaction\(/.test(index)
    && /if \(order\.stockDeducted !== true\) return;/.test(index),
    'the WhatsApp admin alert stays in the bot, claimed once, after finalization');

// ── wiring: script + CI ───────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
ok(pkg.scripts && pkg.scripts['test:order-finalizer'] === 'node tests/order-finalizer.check.cjs',
    'npm run test:order-finalizer is wired', String(pkg.scripts && pkg.scripts['test:order-finalizer']));
const ci = read('.github/workflows/ci.yml');
ok(ci.includes('node tests/order-finalizer.check.cjs'), 'CI runs this guard');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
