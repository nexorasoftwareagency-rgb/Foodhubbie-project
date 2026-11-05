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
    console.log('payment-sync OK');
})().catch(e => { console.error(e); process.exit(1); });
