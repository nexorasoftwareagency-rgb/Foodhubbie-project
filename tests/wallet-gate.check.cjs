#!/usr/bin/env node
/**
 * Wallet gate guard (batch 23l).
 *
 *   node tests/wallet-gate.check.cjs
 *
 * `outlets/{oid}/walletGate` decides whether the WhatsApp bot, the QR menu and
 * the Customer App may take a new order. It had exactly one writer, the 60 s
 * `bot-control-api/wallet-watch.js` pass — on a box that has been offline since
 * 2026-11-11. Batch 23l moved the publisher to Functions (an incremental
 * order-fee index + three triggers + an hourly exact reconcile) and DELETED the
 * EC2 writer. Full record: FIREBASE_SERVER_MIGRATION/41_WALLET_GATE_FUNCTIONS.md.
 *
 * The durable risks this guard pins:
 *   - the gate must be computed by the SHARED money math, never a second port
 *     (the drifted `src/shared/wallet/compute.ts` was deleted here),
 *   - a second writer must never come back (that is how batch 14's bug shipped),
 *   - `foodhubbie-demo` is never gated,
 *   - only `wallet.enforce === true` gates anything,
 *   - the index and the reconcile must never read the `businesses` tree,
 *   - a rebuild is authoritative — never rebuild AND add the event's delta
 *     (the 2026-11-16 review fix: it double-counted the triggering order).
 *
 * Behaviour runs the REAL `shared/cost-math.js`; the rest is static source
 * inspection. No network, no credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
// Durable comments explain why things were removed; static pins must read code.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GATE = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/wallet/gate.ts';
const TRIGGERS = 'FIREBASE_SERVER_MIGRATION/functions/src/triggers/walletGate.ts';
const SCHEDULED = 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/walletGateReconcile.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';
const VENDOR = 'FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs';
const SERVER = 'bot-control-api/server.js';
const SUPREME = 'SupremeAdmin/js/features/restaurant-profile.js';

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

// Node >= 22.12 (require(esm)); repo CI pins 24. shared/package.json is type:module.
const costMath = require('../shared/cost-math.js');

// ---------------------------------------------------------------------------
// 1. The shared math: the cloud publisher's inputs behave like the dashboard's
// ---------------------------------------------------------------------------
const billed = { total: 1000, source: 'QR', status: 'Delivered' };
ok('orderFeePaise: 1% QR', costMath.orderFeePaise({}, billed) === 1000, costMath.orderFeePaise({}, billed));
ok(
  'orderFeePaise: a cancelled order bills nothing (case-insensitive)',
  costMath.orderFeePaise({}, { ...billed, status: 'cancelled' }) === 0
);
ok(
  'orderFeePaise: a Pending QR cart bills nothing',
  costMath.orderFeePaise({}, { ...billed, status: 'Pending' }) === 0
);
ok(
  'orderFeePaise: untagged dine-in is POS 1%',
  costMath.orderFeePaise({}, { total: 1000, type: 'Dine-in' }) === 1000
);
ok(
  'orderFeePaise: Customer App 2%',
  costMath.orderFeePaise({}, { total: 1000, source: 'APP', status: 'Delivered' }) === 2000
);
ok(
  'orderFeePaise: WhatsApp 3%',
  costMath.orderFeePaise({}, { total: 1000, source: 'webview_delivery', status: 'Delivered' }) === 3000
);
ok(
  'orderFeePaise: a legacy per_order row still bills the flat ₹2',
  costMath.orderFeePaise({ mode: 'per_order' }, billed) === 200
);
ok('costIndexFor defaults to the percentage package', costMath.costIndexFor({}, { a: billed }).total === 10);
ok(
  'costIndexFor honours a legacy row',
  costMath.costIndexFor({ mode: 'per_order', rates: { QR: 2 } }, { a: billed }).total === 2
);

const wIndex = costMath.computeWalletFromIndex({
  billing: { mode: 'percentage', payments: { p: { amount: 1500 } } },
  orderFeeTotal: 10,
  campaigns: { c: { totalSent: 5 } },
});
const wOrders = costMath.computeWallet({
  billing: { mode: 'percentage', payments: { p: { amount: 1500 } } },
  orders: { a: billed },
  campaigns: { c: { totalSent: 5 } },
});
ok('computeWalletFromIndex === computeWallet (the gate cannot drift from Admin)', JSON.stringify(wIndex) === JSON.stringify(wOrders), wIndex);
ok('gate wallet: paid 1500 - 10 fees - 5 promo = 1485', wIndex.balance === 1485 && wIndex.orderFees === 10);

// gateFor() maps the shared walletGate() onto the stored values.
ok('walletGate: healthy -> ok (stored as empty)', costMath.walletGate({ paid: 1000, balance: 500 }) === 'ok');
ok('walletGate: low -> low', costMath.walletGate({ paid: 1000, balance: 100 }) === 'low');
ok('walletGate: zero balance -> closed', costMath.walletGate({ balance: 0 }) === 'closed');
ok('walletGate: negative balance -> closed', costMath.walletGate({ balance: -5 }) === 'closed');
// Promo sends are money: an armed outlet whose only cost is promos still drops.
const promoBilled = costMath.computeWalletFromIndex({
  billing: { payments: { p: { amount: 1000 } } },
  orderFeeTotal: 0,
  campaigns: { c: { totalSent: 900 } },
});
ok('uncovered promo sends can push an armed gate to low', costMath.walletGate(promoBilled) === 'low', promoBilled);
// Prepaid tokens cover their send, exactly like the wallet KPI.
const covered = costMath.computeWalletFromIndex({
  billing: { payments: { p: { amount: 1000 } }, tokens: { balance: 0 }, tokenPacks: { welcome: { qty: 900 } } },
  orderFeeTotal: 0,
  campaigns: { c: { totalSent: 900 } },
});
ok('prepaid tokens keep the same outlet open', costMath.walletGate(covered) === 'ok' && covered.used === 0, covered);

// ---------------------------------------------------------------------------
// 2. The engine: shared math, one summary, no second implementation
// ---------------------------------------------------------------------------
const gate = read(GATE);
const gateCode = stripComments(gate);
ok('the engine requires the VENDORED shared/cost-math.js', /vendor\/shared\/cost-math\.js/.test(gateCode));
ok('the engine no longer owns a wallet port', !/computeWallet\s*\(/.test(gateCode.replace(/costMath\.computeWalletFromIndex/g, 'X')));
ok("demo is hard-skipped by business id", /DEMO_BID = 'foodhubbie-demo'/.test(gateCode));
ok('only an explicit wallet.enforce === true arms an outlet', /wallet\.enforce === true/.test(gateCode));
ok('summary lives OUTSIDE walletBilling (meta/walletWatch)', /SUMMARY_ROOT = 'meta\/walletWatch'/.test(gateCode));
ok('billing is read from the server-only walletBilling root', /walletBilling\/\$\{bid\}\/\$\{oid\}/.test(gateCode));
ok('the order-fee index is applied by a seeded transaction', /cur && cur\.pricingKey === key \? cur : seed/.test(gateCode));
ok('a pricing-mode change invalidates the index', /pricingKey/.test(gateCode) && /normalizeMode/.test(gateCode));
ok('an unarmed outlet has its gate REMOVED (never left stale)', /gateSnap\.exists\(\)[\s\S]{0,200}gateRef\.remove\(\)/.test(gateCode));
ok('an unarmed outlet has its summary removed too', /sumSnap\.exists\(\)[\s\S]{0,120}sumRef\.remove\(\)/.test(gateCode));
ok('the gate value is only written when it changes', /if \(next !== current\)/.test(gateCode));
ok('no whole-businesses read in the engine', !/ref\(['"`]businesses['"`]\)/.test(gateCode));
ok('reconcile enumerates the walletBilling root', /ref\('walletBilling'\)/.test(gateCode));
ok('order events are no-ops when the order is not billable-changed', /no-billing-change/.test(gateCode));

// Review fix 2026-11-16 — rebuild authority. A rebuild reads the live orders
// tree, which already contains the write that fired the trigger, so adding the
// event's delta on top counted the triggering order twice: one ₹40 order on a
// ₹100-paid wallet seeded 4000 paise, then added 4000 more, publishing 'low'
// (balance 20) instead of open (balance 60). A rebuild now publishes itself and
// the delta transaction is skipped.
ok('ensureFeeIndex reports whether it rebuilt', /Promise<\{ index: any; rebuilt: boolean \}>/.test(gateCode));
ok('a rebuilt index is authoritative (published, no delta)', /if \(ensured\.rebuilt\)[\s\S]{0,300}index: ensured\.index/.test(gateCode));
ok('the rebuilt branch applies zero deltas', /delta: 0,[\s\S]{0,60}rebuilt: true/.test(gateCode));
const rebuiltAt = gateCode.indexOf('if (ensured.rebuilt)');
const deltaTxAt = gateCode.indexOf('.transaction((cur');
ok('the rebuilt branch returns BEFORE the delta transaction', rebuiltAt > 0 && deltaTxAt > rebuiltAt, { rebuiltAt, deltaTxAt });
ok('the delta path still seeds from the returned index', /const seed = ensured\.index;/.test(gateCode));

// ---------------------------------------------------------------------------
// 3. The three triggers: correct refs, demo skipped, no flag needed
// ---------------------------------------------------------------------------
const trig = stripComments(read(TRIGGERS));
ok('trigger: whole order node (status/total/re-pricing all change the fee)', /ref: 'businesses\/\{bid\}\/outlets\/\{oid\}\/orders\/\{orderId\}'/.test(trig));
ok('trigger: billing ledger', /ref: 'walletBilling\/\{bid\}\/\{oid\}'/.test(trig));
ok('trigger: the gate itself (tamper self-heal)', /ref: 'businesses\/\{bid\}\/outlets\/\{oid\}\/walletGate'/.test(trig));
ok('all three triggers skip the demo tenant', (trig.match(/bid === DEMO_BID/g) || []).length === 3);
ok('a ledger change that was and stays unarmed does nothing', /!isArmed\(bid, before\) && !isArmed\(bid, after\)/.test(trig));
ok('the gate echo from our own publish is skipped', /summary\.gate \|\| ''\) === current/.test(trig));
ok('the order trigger logs whether the index was rebuilt', /rebuilt: result\.rebuilt === true/.test(trig));
ok('three exports: order / ledger / gate', /export const onOrderBillingChange/.test(trig) && /export const onWalletLedgerChange/.test(trig) && /export const onWalletGateTouched/.test(trig));

// ---------------------------------------------------------------------------
// 4. The hourly reconcile
// ---------------------------------------------------------------------------
const sched = stripComments(read(SCHEDULED));
ok('reconcile is a scheduled Function', /onSchedule\(/.test(sched));
ok('reconcile is hourly at :07 IST', /schedule: '7 \* \* \* \*'/.test(sched) && /Asia\/Kolkata/.test(sched));
ok('reconcile runs one instance at a time', /maxInstances: 1/.test(sched));
ok('reconcile calls the shared rebuild, never a reimplementation', /reconcileWalletGates\(\)/.test(sched));

// ---------------------------------------------------------------------------
// 5. Wired into the deployed entry point
// ---------------------------------------------------------------------------
const index = stripComments(read(INDEX));
ok('index.ts exports the reconcile', /walletGateReconcile/.test(index));
ok('index.ts exports all three triggers', /onOrderBillingChange/.test(index) && /onWalletLedgerChange/.test(index) && /onWalletGateTouched/.test(index));

const vendor = read(VENDOR);
ok('copy-vendor vendors shared/cost-math.js', /'shared\/cost-math\.js'/.test(vendor));
ok('copy-vendor vendors shared/meta-cost-math.js', /'shared\/meta-cost-math\.js'/.test(vendor));
ok('copy-vendor load check pins the percentage rates', /qrFee !== 1000 \|\| appFee !== 2000 \|\| waFee !== 3000/.test(vendor));

// ---------------------------------------------------------------------------
// 6. Exactly one writer: the EC2 pass is gone
// ---------------------------------------------------------------------------
ok('bot-control-api/wallet-watch.js is deleted', !exists('bot-control-api/wallet-watch.js'));
const server = stripComments(read(SERVER));
ok('the control API no longer requires wallet-watch', !/wallet-watch/.test(server));
ok('the control API no longer boots the watcher', !/startWalletWatcher/.test(server));
ok('the instant-publish route is gone', !/\/api\/bot\/wallet-gate\//.test(server));
const supreme = stripComments(read(SUPREME));
ok('Supreme no longer posts to the deleted route', !/\/api\/bot\/wallet-gate\//.test(supreme));
ok('Supreme still writes the arm flag to walletBilling', /walletBilling\/\$\{currentBid\}\/\$\{currentOid\}\/wallet/.test(supreme));

// ---------------------------------------------------------------------------
// 7. The drifted port stays deleted
// ---------------------------------------------------------------------------
ok('src/shared/wallet/compute.ts stays deleted', !exists('FIREBASE_SERVER_MIGRATION/functions/src/shared/wallet/compute.ts'));
ok(
  'no module imports a wallet implementation other than the vendored math',
  !read('FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/sendOutboundMessage.ts').includes('wallet/compute')
);

if (process.exitCode) {
  console.error(`\nwallet gate guard: FAILED (${pass} passed)`);
} else {
  console.log(`\nwallet gate guard: ${pass}/${pass} passed`);
}
