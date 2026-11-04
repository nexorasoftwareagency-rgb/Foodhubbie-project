// Customer payment-history mirror check. Run: node tests/payment-sync.check.cjs
const assert = require('assert/strict');
const { buildPaymentPatch, syncCustomerPayment } = require('../bot/payment-sync.js');

// ── pure patch ──
let p = buildPaymentPatch({ status: 'Delivered', total: 398, paymentStatus: 'Paid', paymentMethod: 'UPI' }, {}, 1000);
assert.equal(p.paymentStatus, 'Paid'); assert.equal(p.paymentMethod, 'UPI'); assert.equal(p.paidAt, 1000);
p = buildPaymentPatch({ status: 'Delivered', total: 398, paymentStatus: 'Paid', paymentMethod: 'UPI' }, { paidAt: 500 }, 2000);
assert.equal(p.paidAt, 500, 'paidAt is set once');
p = buildPaymentPatch({ status: 'Served', total: 100, paymentStatus: 'Unpaid', paymentMethod: null }, { paidAt: 500 }, 3000);
assert.equal(p.paidAt, null, 'voided bill clears paidAt'); assert.equal(p.paymentMethod, null);
p = buildPaymentPatch({ total: '12.5' }, {}, 1);
assert.equal(p.paymentStatus, 'Pending', 'missing status = Pending'); assert.equal(p.total, 12.5); assert.equal(p.status, 'Placed');
p = buildPaymentPatch({ paymentMethod: '  ', paymentStatus: 'Paid' }, {}, 1);
assert.equal(p.paymentMethod, null, 'blank method ignored');

// ── mirror against an in-memory db ──
const store = {};
const get = (path) => path.split('/').filter(Boolean).reduce((n, k) => (n == null ? n : n[k]), store);
const put = (path, v) => { const ks = path.split('/').filter(Boolean); let n = store; ks.slice(0, -1).forEach(k => { n[k] = n[k] || {}; n = n[k]; }); n[ks[ks.length - 1]] = v; };
let writes = 0;
const db = { ref: (path) => ({
    once: async () => ({ val: () => { const v = get(path); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    update: async (o) => { writes++; const cur = get(path) || {}; put(path, { ...cur, ...o }); },
}) };
const resolvePath = (p) => `o/${p}`;
const PH = '9876543210', ID = 'A100';

(async () => {
    // no mirror record -> nothing created
    assert.equal(await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { total: 100 }, outlet: 'o' }), false);
    assert.equal(get(`o/customers/${PH}/orders/${ID}`), undefined, 'never creates a record');

    put(`o/customers/${PH}/orders/${ID}`, { orderId: ID, status: 'Placed', total: 398, paymentStatus: 'Pending', itemsSummary: [{ name: 'Margherita', qty: 2 }], createdAt: 111 });
    // paid at settlement
    assert.equal(await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Delivered', total: 398, paymentStatus: 'Paid', paymentMethod: 'Cash' }, outlet: 'o', now: 5000 }), true);
    let rec = get(`o/customers/${PH}/orders/${ID}`);
    assert.equal(rec.paymentStatus, 'Paid'); assert.equal(rec.paymentMethod, 'Cash'); assert.equal(rec.paidAt, 5000); assert.equal(rec.status, 'Delivered');
    assert.deepEqual(rec.itemsSummary, [{ name: 'Margherita', qty: 2 }], 'placement fields kept'); assert.equal(rec.createdAt, 111);
    // same event again -> no write (idempotent)
    const before = writes;
    assert.equal(await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Delivered', total: 398, paymentStatus: 'Paid', paymentMethod: 'Cash' }, outlet: 'o', now: 9000 }), false);
    assert.equal(writes, before); assert.equal(get(`o/customers/${PH}/orders/${ID}`).paidAt, 5000);
    // void
    await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Served', total: 398, paymentStatus: 'Unpaid', paymentMethod: null }, outlet: 'o', now: 9500 });
    rec = get(`o/customers/${PH}/orders/${ID}`);
    assert.equal(rec.paymentStatus, 'Unpaid'); assert.equal(rec.paidAt, null);

    // live tracking: rider + delivery code + order mode are mirrored, then cleared
    await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Out for Delivery', total: 398, paymentStatus: 'Pending', orderMode: 'delivery' }, outlet: 'o', now: 9600, extra: { rider: { name: 'Amit', phone: '+91 91234-56780' }, otp: '4821' } });
    rec = get(`o/customers/${PH}/orders/${ID}`);
    assert.equal(rec.riderName, 'Amit'); assert.equal(rec.riderPhone, '9123456780'); assert.equal(rec.deliveryOtp, '4821'); assert.equal(rec.orderMode, 'delivery');
    const w2 = writes;
    assert.equal(await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Out for Delivery', total: 398, paymentStatus: 'Pending', orderMode: 'delivery' }, outlet: 'o', now: 9700, extra: { rider: { name: 'Amit', phone: '9123456780' }, otp: '4821' } }), false);
    assert.equal(writes, w2, 'tracking sync is idempotent');
    await syncCustomerPayment({ db, resolvePath, phone: PH, orderId: ID, order: { status: 'Delivered', total: 398, paymentStatus: 'Paid', paymentMethod: 'Cash', orderMode: 'delivery' }, outlet: 'o', now: 9800 });
    rec = get(`o/customers/${PH}/orders/${ID}`);
    assert.equal(rec.deliveryOtp, null, 'delivery code not kept after delivery'); assert.equal(rec.riderPhone, null);
    // no phone -> skipped
    assert.equal(await syncCustomerPayment({ db, resolvePath, phone: '', orderId: ID, order: { total: 1 }, outlet: 'o' }), false);

    // source guards: hook + merge (not replace) of the accrual mirror
    const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/index.js'), 'utf8');
    assert.match(src, /paymentSync\.syncCustomerPayment/, 'child_changed hook wired');
    assert.doesNotMatch(src, /customers\/\$\{phone\}\/orders\/\$\{String\(orderId\)\}`, outlet\)\)\.set\(\{\s*orderId/, 'accrual mirror must not replace the record');
    assert.match(src, /function isWebOrderSource/, 'APP orders share web-order finalization');
    assert.match(src, /source\s*===\s*'APP'/, 'bot recognises APP orders');
    assert.match(src, /'Pickup'/, 'pickup handled (no rider broadcast)');
    // review fixes (bot)
    assert.match(src, /async function resurrectRewardTender/, 'reward goes back on cancel even if no points were earned');
    assert.match(src, /if \(isCancel\) await resurrectRewardTender/, 'cancel path restores the reward before the accrual check');
    assert.match(src, /order\.source === 'APP'\s*\n?\s*\? `\$\{WEBVIEW_DELIVERY_HOST\}\/\?b=/, 'app push opens the app, not delivery.html');
    assert.match(src, /missedWebOrder/, 'web/app orders placed during bot downtime are still finalized');
    assert.match(src, /base\.app\?\.consent\?\.offers/, 'app orders never force promotional consent on');
    const promo = require('fs').readFileSync(require('path').join(__dirname, '../bot/promotions.js'), 'utf8');
    assert.match(promo, /app\/consent\/offers/, 'promotions honour the app Offers switch');
    assert.match(src, /customers\/\$\{phone\}\/app\/name[\s\S]{0,200}tab=loyalty/, 'tier-up push opens the app for app customers');

    // server-side re-pricing: browser-written prices are rebuilt from the catalog
    assert.match(src, /const orderPricing = require\('\.\/order-pricing'\)/, 're-pricer loaded');
    const finalize = src.slice(src.indexOf('if (shouldFinalizeWebOrder(order)) {'));
    const repriceAt = finalize.indexOf('orderPricing.repriceOrder');
    const discountAt = finalize.indexOf('discountEngine.evaluateDiscount');
    assert.ok(repriceAt > -1, 'web/app orders are re-priced before anything trusts the subtotal');
    assert.ok(repriceAt < discountAt, 're-pricing runs BEFORE the discount re-validation');
    assert.match(finalize, /order\.subtotal = priced\.subtotal/, 'corrected subtotal feeds the rest of finalization');
    const fs2 = require('fs'), path2 = require('path');
    for (const f of ['menu/js/app-checkout.js', 'menu/js/delivery-order.js']) {
        assert.match(fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8'), /dishId: l\.dishId/, `${f} sends dishId so re-pricing resolves by id`);
    }

    // tax rates + delivery fee are the outlet's settings, never the phone's
    assert.match(src, /async function _serverTaxRates/, 'tax rates are re-derived from the outlet settings');
    assert.match(src, /async function _serverDeliveryFee/, 'delivery fee is re-derived from the slab table');
    assert.strictEqual(src.match(/taxRates: await _serverTaxRates\(OUTLET\)/g)?.length, 1, 'QR dine-in totals use the server tax rates');
    assert.match(finalize, /const serverTaxRates = await _serverTaxRates/, 'web finalization reads the server tax rates');
    assert.match(finalize, /taxRates: serverTaxRates/, 'verified total uses the server rates, not the client taxItems');
    assert.match(finalize, /deliveryFee: serverDeliveryFee/, 'verified total uses the server delivery fee');
    assert.ok(finalize.indexOf('_serverTaxRates') < finalize.indexOf('discountEngine.evaluateDiscount'), 'tax/fee are resolved BEFORE the discount re-validation');
    assert.match(finalize, /\.\.\.moneyFields\(money\)/, 'the verified tax breakdown is written back onto the order');
    assert.doesNotMatch(src, /_verifiedOrderTotal\(/, 'no call site left on the old client-owned verifier');

    // discount usage must be reversible when the sale falls through: a global
    // limit or a first-order one-shot cannot stay consumed by a cancelled order
    const engine = fs2.readFileSync(path2.join(__dirname, '../bot/discount-engine.js'), 'utf8');
    assert.match(engine, /async function releaseDiscountUsage/, 'discount engine can release a recorded usage');
    assert.match(engine, /module\.exports = \{[^}]*releaseDiscountUsage/, 'releaseDiscountUsage is exported');
    assert.match(finalize, /discountUsageRecorded: true/, 'finalization stamps that the usage really landed');
    assert.ok(finalize.indexOf('discountUsageRecorded') > finalize.indexOf('recordDiscountUsage'), 'flag is written only after recordDiscountUsage');
    const releaseAt = src.indexOf('async function releaseOrderDiscountUsage');
    assert.ok(releaseAt > -1, 'cancel path has a release helper');
    const listener = src.slice(src.indexOf('orderRef.on("child_changed"'));
    assert.ok(listener.indexOf('releaseOrderDiscountUsage(snap.key, order)') > -1, 'child_changed calls the release helper');
    assert.ok(listener.indexOf('releaseOrderDiscountUsage') < listener.indexOf('if (sameStatusRecently) return;'), 'release runs BEFORE the debounce gate');
    assert.match(src, /order\.discountUsageRecorded !== true \|\| order\.discountUsageReversed === true/, 'only recorded, not-yet-reversed usage is given back');

    // stock must come back too, and only what the deduction really took
    assert.match(src, /async function restoreOrderInventory/, 'cancel path has a stock restore helper');
    assert.match(finalize, /const inventoryDeducted = await deductInventoryStock/, 'finalization waits for the deduction (a cancel cannot race it)');
    assert.match(finalize, /\{ stockDeducted: true, inventoryDeducted \}/, 'finalization records exactly what was taken');
    assert.ok(listener.indexOf('restoreOrderInventory(snap.key, order)') > -1, 'child_changed calls the restore helper');
    assert.ok(listener.indexOf('restoreOrderInventory(snap.key, order)') < listener.indexOf('if (sameStatusRecently) return;'), 'restore runs BEFORE the debounce gate');
    assert.match(src, /order\.stockDeducted !== true \|\| order\.stockRestored === true/, 'only deducted, not-yet-restored stock is given back');
    assert.match(src, /const claim = await flagRef\.transaction/, 'restore claims the order before touching stock (at most once)');

    // D4 wallet gate: an enforced low/closed balance stops NEW bot order links.
    // The flag is public-read and written by Admin only when enforcement is armed.
    assert.match(src, /walletGateBlocks/, 'bot reads the D4 wallet gate');
    assert.match(src, /getWalletGate\(OUTLET\)/, 'gate is read for the bot own outlet id');
    const wg = fs2.readFileSync(path2.join(__dirname, '../bot/wallet-gate.js'), 'utf8');
    assert.match(wg, /resolvePath\('walletGate', outlet\)/, 'gate comes from the outlet node');
    assert.match(wg, /\.once\('value'\)/, 'fresh read — the stop flag must not sit behind the 30 s cache');
    assert.match(wg, /catch[\s\S]{0,120}return null/, 'read failures fail open');
    const flow = src.slice(src.indexOf('async function sendOrderFlow'), src.indexOf('function appendContactInfo'));
    assert.ok(flow.indexOf('walletGateBlocks') > -1 && flow.indexOf('walletGateBlocks') < flow.indexOf('const [store, bot] = await Promise.all(['), 'menu flow checks the gate before the greeting/CTA');
    const cta = src.slice(src.indexOf('async function resendMenuCTA'), src.indexOf('function appendContactInfo'));
    assert.ok(cta.indexOf('walletGateBlocks') < cta.indexOf('getOrCreateWebviewToken'), 'gate blocks BEFORE minting a webview token');
    assert.ok(cta.indexOf('walletGateBlocks') < cta.indexOf('sendOrderCTA'), 'gate blocks the order CTA');
    assert.match(fs2.readFileSync(path2.join(__dirname, '../bot/utils.js'), 'utf8'), /function walletGateBlocks/, 'decision helper lives with the other bot pure utils');
    console.log('payment-sync OK');
})().catch(e => { console.error(e); process.exit(1); });
