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

// ── the module is socket-free ─────────────────────────────────────────────
ok(/module\.exports\s*=\s*\{\s*createOrderFinalizer\s*\}/.test(mod), 'exports exactly createOrderFinalizer');
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
for (const key of ['priceChanged', 'discount', 'total', 'tax', 'inventoryDeducted', 'tender', 'discountUsageRecorded']) {
    ok(new RegExp(`\\b${key}:`).test(mod), `finalizeWebOrder reports ${key} (shadow-compare field)`);
}

// ── the factory actually builds and its math is the shared math ───────────
const { createOrderFinalizer } = require(path.join(ROOT, 'bot/order-finalizer.js'));
ok(typeof createOrderFinalizer === 'function', 'module loads with no side effects');
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

// ── wiring: script + CI ───────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
ok(pkg.scripts && pkg.scripts['test:order-finalizer'] === 'node tests/order-finalizer.check.cjs',
    'npm run test:order-finalizer is wired', String(pkg.scripts && pkg.scripts['test:order-finalizer']));
const ci = read('.github/workflows/ci.yml');
ok(ci.includes('node tests/order-finalizer.check.cjs'), 'CI runs this guard');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
