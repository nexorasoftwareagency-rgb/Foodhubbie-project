// Redemption OTP + expiry check — in-memory fake of the Realtime Database.
// Run: node tests/loyalty-redeem.check.cjs
const assert = require('assert/strict');
const redeem = require('../bot/redeem.js');

const store = {};
const get = (p) => p.split('/').filter(Boolean).reduce((n, k) => (n == null ? n : n[k]), store);
const put = (p, v) => {
    const ks = p.split('/').filter(Boolean); let n = store;
    ks.slice(0, -1).forEach(k => { n[k] = (n[k] && typeof n[k] === 'object') ? n[k] : {}; n = n[k]; });
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v));
};
const listeners = { child_added: [], child_changed: [] };
function ref(p) {
    return {
        key: p.split('/').pop(),
        child: (c) => ref(p + '/' + c),
        once: async () => { const v = get(p); return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) }; },
        set: async (v) => put(p, v),
        update: async (o) => { const cur = get(p) || {}; Object.entries(o).forEach(([k, v]) => { if (v === null) delete cur[k]; else cur[k] = v; }); put(p, cur); },
        remove: async () => put(p, null),
        transaction: async (fn) => { const cur = get(p); const out = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur))); if (out === undefined) return { committed: false }; put(p, out); return { committed: true }; },
        off: () => {},
        on: (ev, cb) => listeners[ev].push(cb),
    };
}
const sent = [];
const db = { ref };
const resolvePath = (p) => `o/${p}`;
redeem.initRedeemListener({ db, resolvePath, OUTLET: 'o1', sendText: async (ph, t) => { sent.push({ ph, t }); return true; } });
const snapOf = (key) => ({ key, val: () => get(`o/bot/redeemQueue/${key}`), ref: ref(`o/bot/redeemQueue/${key}`) });
const fire = async (ev, key) => { for (const cb of listeners[ev]) await cb(snapOf(key)); };
const PH = '9876543210';

(async () => {
    // pure helpers
    assert.equal(redeem.pointsLapsed(Date.now() - 200 * 86400000, 180), true);
    assert.equal(redeem.pointsLapsed(Date.now() - 100 * 86400000, 180), false);
    assert.equal(redeem.pointsLapsed(Date.now() - 900 * 86400000, 0), false, '0 = never');

    put('o/loyalty/config', { rewards: [{ id: 'r1', label: 'Free Samosa', cost: 200 }], expiryDays: 180 });
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 500, pointsSpent: 0, lastOrderAt: Date.now() });

    // 1) request without code -> OTP sent, nothing deducted
    put('o/bot/redeemQueue/k1', { phone: PH, rewardId: 'r1', requestedAt: 1, outlet: 'o1' });
    await fire('child_added', 'k1');
    assert.equal(sent.length, 1); assert.match(sent[0].t, /\b\d{6}\b/);
    assert.equal(get(`o/customers/${PH}/rewards/k1`).status, 'otp_required');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 0, 'no deduction before the code');
    assert.ok(get('o/bot/redeemQueue/k1'), 'request parked');
    const otp = sent[0].t.match(/\b(\d{6})\b/)[1];

    // 2) wrong code -> still no deduction, try again allowed
    put('o/bot/redeemQueue/k1/otp', otp === '111111' ? '222222' : '111111');
    await fire('child_changed', 'k1');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 0);
    assert.equal(get(`o/customers/${PH}/rewards/k1`).lastError, 'wrong code');
    assert.equal(get(`o/customers/${PH}/rewards/k1`).wrongTries, 1, 'wrong-code counter lets the app tell a new failure from an old one');

    // 3) right code -> redeemed once, 200 deducted, code minted, request gone
    put('o/bot/redeemQueue/k1/otp', otp);
    await fire('child_changed', 'k1');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 200);
    assert.equal(get(`o/customers/${PH}/rewards/k1`).status, 'active');
    assert.match(get(`o/customers/${PH}/rewards/k1`).code, /^LOYAL\d{6}$/);
    assert.equal(get('o/bot/redeemQueue/k1'), undefined);

    // 4) 3 wrong codes -> rejected, nothing deducted
    put('o/bot/redeemQueue/k2', { phone: PH, rewardId: 'r1', requestedAt: 2, outlet: 'o1' });
    await fire('child_added', 'k2');
    for (let i = 0; i < 3; i++) { put('o/bot/redeemQueue/k2/otp', '000000'); await fire('child_changed', 'k2'); }
    assert.equal(get(`o/customers/${PH}/rewards/k2`).status, 'rejected');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 200);

    // 5) lapsed points -> rejected before any code is sent
    const before = sent.length;
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 500, pointsSpent: 0, lastOrderAt: Date.now() - 300 * 86400000 });
    put('o/bot/redeemQueue/k3', { phone: PH, rewardId: 'r1', requestedAt: 3, outlet: 'o1' });
    await fire('child_added', 'k3');
    assert.equal(sent.length, before, 'no code for expired points');
    assert.equal(get(`o/customers/${PH}/rewards/k3`).reason, 'points expired');

    // 6) too few points -> rejected, no code
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 50, pointsSpent: 0, lastOrderAt: Date.now() });
    put('o/bot/redeemQueue/k4', { phone: PH, rewardId: 'r1', requestedAt: 4, outlet: 'o1' });
    await fire('child_added', 'k4');
    assert.equal(sent.length, before);
    assert.equal(get(`o/customers/${PH}/rewards/k4`).reason, 'insufficient points');

    // 7) rate limit: 3 codes per phone per window
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 5000, pointsSpent: 0, lastOrderAt: Date.now() });
    const base = sent.length; let rejected = 0;
    for (let i = 0; i < 5; i++) {
        put(`o/bot/redeemQueue/s${i}`, { phone: PH, rewardId: 'r1', requestedAt: 5, outlet: 'o1' });
        await fire('child_added', `s${i}`);
        if (get(`o/customers/${PH}/rewards/s${i}`).status === 'rejected') rejected++;
    }
    assert.ok(sent.length - base <= 3, 'no more than 3 codes'); assert.ok(rejected >= 2);

    // 8) source guard: the earn transaction must carry pointsSpent forward
    // (it used to rebuild the node without it, refunding redeemed points).
    const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/index.js'), 'utf8');
    assert.match(src, /pointsSpent: spent,/, 'accrual tx keeps pointsSpent');
    assert.match(src, /points: Math\.max\(0, lifetime - spent\)/, 'balance = lifetime - spent');

    console.log('loyalty-redeem OK');
})().catch(e => { console.error(e); process.exit(1); });
