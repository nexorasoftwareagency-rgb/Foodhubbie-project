// Loyalty redemption (device-bound, no OTP) — in-memory fake of the Realtime Database.
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
        once: async () => {
            const v = get(p);
            return {
                exists: () => v !== undefined && v !== null,
                val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
            };
        },
        set: async (v) => put(p, v),
        update: async (o) => { const cur = get(p) || {}; Object.entries(o).forEach(([k, v]) => { if (v === null) delete cur[k]; else cur[k] = v; }); put(p, cur); },
        remove: async () => put(p, null),
        transaction: async (fn) => { const cur = get(p); const out = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur))); if (out === undefined) return { committed: false }; put(p, out); return { committed: true }; },
        off: () => {},
        on: (ev, cb) => listeners[ev].push(cb),
    };
}
const db = { ref };
const resolvePath = (p) => `o/${p}`;
redeem.initRedeemListener({ db, resolvePath, OUTLET: 'o1' });
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
    put(`o/customers/${PH}/devices/uid1`, { at: 1 });

    // 1) device-bound request redeems immediately: points deducted, code minted,
    //    request cleared — no OTP, no WhatsApp message.
    put('o/bot/redeemQueue/k1', { phone: PH, rewardId: 'r1', requestedAt: 1, outlet: 'o1', appUid: 'uid1' });
    await fire('child_added', 'k1');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 200);
    assert.equal(get(`o/customers/${PH}/rewards/k1`).status, 'active');
    assert.match(get(`o/customers/${PH}/rewards/k1`).code, /^LOYAL\d{6}$/);
    assert.equal(get('o/bot/redeemQueue/k1'), undefined);

    // 2) a device that is not registered under the phone cannot redeem it
    put('o/bot/redeemQueue/k2', { phone: PH, rewardId: 'r1', requestedAt: 2, outlet: 'o1', appUid: 'uid2' });
    await fire('child_added', 'k2');
    assert.equal(get(`o/customers/${PH}/rewards/k2`).status, 'rejected');
    assert.equal(get(`o/customers/${PH}/rewards/k2`).reason, 'device not linked');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 200, 'nothing deducted');
    assert.equal(get('o/bot/redeemQueue/k2'), undefined);

    // 3) legacy shape without appUid is refused (no unverified phone redeems)
    put('o/bot/redeemQueue/k3', { phone: PH, rewardId: 'r1', requestedAt: 3, outlet: 'o1' });
    await fire('child_added', 'k3');
    assert.equal(get(`o/customers/${PH}/rewards/k3`).reason, 'device not linked');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 200);

    // 4) a second redemption on the same device accumulates pointsSpent
    put('o/bot/redeemQueue/k4', { phone: PH, rewardId: 'r1', requestedAt: 4, outlet: 'o1', appUid: 'uid1' });
    await fire('child_added', 'k4');
    assert.equal(get(`o/customers/${PH}/loyalty`).pointsSpent, 400);
    assert.equal(get(`o/customers/${PH}/rewards/k4`).status, 'active');

    // 5) too few points -> rejected before anything is written
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 50, pointsSpent: 0, lastOrderAt: Date.now() });
    put('o/bot/redeemQueue/k5', { phone: PH, rewardId: 'r1', requestedAt: 5, outlet: 'o1', appUid: 'uid1' });
    await fire('child_added', 'k5');
    assert.equal(get(`o/customers/${PH}/rewards/k5`).reason, 'insufficient points');

    // 6) lapsed points -> rejected
    put(`o/customers/${PH}/loyalty`, { lifetimePoints: 500, pointsSpent: 0, lastOrderAt: Date.now() - 300 * 86400000 });
    put('o/bot/redeemQueue/k6', { phone: PH, rewardId: 'r1', requestedAt: 6, outlet: 'o1', appUid: 'uid1' });
    await fire('child_added', 'k6');
    assert.equal(get(`o/customers/${PH}/rewards/k6`).reason, 'points expired');

    // 7) source guard: the earn transaction must carry pointsSpent forward
    // (it used to rebuild the node without it, refunding redeemed points).
    const src = require('fs').readFileSync(require('path').join(__dirname, '../bot/index.js'), 'utf8');
    assert.match(src, /pointsSpent: spent,/, 'accrual tx keeps pointsSpent');
    assert.match(src, /points: Math\.max\(0, lifetime - spent\)/, 'balance = lifetime - spent');

    console.log('loyalty-redeem OK');
})().catch(e => { console.error(e); process.exit(1); });
