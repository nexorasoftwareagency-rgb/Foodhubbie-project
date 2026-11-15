#!/usr/bin/env node
/**
 * Batch 23g guard — the loyalty relay.
 *
 * Two halves:
 *
 *   1. BEHAVIOUR — run the real `bot/loyalty-engine.js` (the bytes Cloud
 *      Functions vendors) against an in-memory RTDB stand-in: earn on
 *      Delivered/Served, idempotency, dine-in settle on paymentStatus:'Paid',
 *      tableSessionsContact phone resolution, the bill-discount split, clawback
 *      on cancel/refund/bill void, re-earn after a void, reward resurrect, and
 *      the redemption claim.
 *   2. SOURCE PINS — the one switch exists on both sides (bot stands down,
 *      triggers stay no-op unless `config/loyaltyRelay/enabled === true`), the
 *      triggers listen on leaves and hard-skip the demo tenant, the tier-up
 *      push is not duplicated, and the vendored files are actually copied.
 *
 * Run: node tests/loyalty-engine.check.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL  ' + name + '\n        ' + (err && err.message));
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * In-memory RTDB stand-in (the Admin SDK surface the engine actually uses)
 * ──────────────────────────────────────────────────────────────────────── */
function makeFakeDb(initial) {
  const store = new Map();
  for (const [k, v] of Object.entries(initial || {})) store.set(k, JSON.parse(JSON.stringify(v)));
  const log = { sets: [], updates: [], removes: [], tx: [] };
  const attempted = new Set();

  const snapOf = (p) => ({
    key: p.split('/').filter(Boolean).pop() || null,
    val: () => (store.has(p) ? JSON.parse(JSON.stringify(store.get(p))) : null),
    exists: () => store.has(p),
  });

  function ref(p) {
    const refPath = String(p);
    return {
      key: refPath.split('/').filter(Boolean).pop() || null,
      child: (c) => ref(refPath + '/' + c),
      once: async () => snapOf(refPath),
      get: async () => snapOf(refPath),
      set: async (v) => { store.set(refPath, JSON.parse(JSON.stringify(v))); log.sets.push(refPath); },
      update: async (v) => {
        const cur = store.has(refPath) ? store.get(refPath) : {};
        store.set(refPath, { ...cur, ...JSON.parse(JSON.stringify(v)) });
        log.updates.push(refPath);
      },
      remove: async () => { store.delete(refPath); log.removes.push(refPath); },
      transaction: async (fn) => {
        log.tx.push(refPath);
        // Real RTDB hands the FIRST attempt on a ref `null` even when the node
        // exists (proven live 2026-11-02), then re-runs the update with the
        // server value when the guessed old value did not match before it
        // commits. Modelling both is what makes a cold-tx `cur || seed` and a
        // second concurrent writer visible here instead of silently passing.
        const has = store.has(refPath);
        const first = !attempted.has(refPath);
        attempted.add(refPath);
        let next = fn(first ? null : (has ? JSON.parse(JSON.stringify(store.get(refPath))) : null));
        if (next === undefined) return { committed: false, snapshot: snapOf(refPath) };
        if (first && has) {
          // CAS mismatch on the cold guess -> the SDK retries with the real value.
          next = fn(JSON.parse(JSON.stringify(store.get(refPath))));
          if (next === undefined) return { committed: false, snapshot: snapOf(refPath) };
        }
        store.set(refPath, JSON.parse(JSON.stringify(next)));
        return { committed: true, snapshot: snapOf(refPath) };
      },
    };
  }

  return { ref, store, log };
}

const OUTLET = 'e2e-outlet';
const BIZ = 'e2e-biz';
const loyaltyMath = require('../shared/loyalty-math.js');
const moneyMath = require('../shared/money-math.js');
const redeem = require('../bot/redeem.js');
const { isDineInOrder, formatOrderId } = require('../bot/utils.js');
const { createLoyaltyEngine } = require('../bot/loyalty-engine.js');

const P = (p) => `businesses/${BIZ}/outlets/${OUTLET}/${p}`;
const resolvePath = (p, o) => `businesses/${BIZ}/outlets/${o || OUTLET}/${p}`;

function engineFor(db) {
  return createLoyaltyEngine({
    db,
    resolvePath,
    loyaltyMath,
    moneyMath,
    redeem,
    isDineInOrder,
    formatOrderId,
    businessIdFor: () => BIZ,
    defaultOutlet: OUTLET,
  });
}

const CONFIG = {
  earnEnabled: true,
  dineInEarnEnabled: true,
  clawbackEnabled: true,
  earnRatePaisePerPoint: 2000, // 1 pt per ₹20
  redeemValuePaisePerPoint: 100,
  expiryDays: 0,
  tiers: {
    bronze: { min: 0, multiplier: 1 },
    silver: { min: 100, multiplier: 1.25 },
    gold: { min: 500, multiplier: 1.5 },
  },
  rewards: [{ id: 'r100', label: '₹100 off', cost: 100 }],
};

const seed = (extra) => ({ [P('loyalty/config')]: CONFIG, ...(extra || {}) });
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  console.log('Loyalty engine (batch 23g)\n');

  /* ── factory + config ────────────────────────────────────────────────── */

  await check('the factory refuses to build without its deps', () => {
    assert.throws(() => createLoyaltyEngine({ resolvePath, isDineInOrder, redeem }), /missing dep "db"/);
    assert.throws(() => createLoyaltyEngine({ db: makeFakeDb({}), resolvePath, isDineInOrder }), /redeem\.pointsLapsed/);
  });

  await check('getLoyaltyConfig applies the documented defaults', async () => {
    const engine = engineFor(makeFakeDb({}));
    const cfg = await engine.getLoyaltyConfig(OUTLET);
    assert.strictEqual(cfg.earnRatePaisePerPoint, 5000);
    assert.strictEqual(cfg.expiryDays, 0);
    assert.strictEqual(cfg.tiers.silver.min, 1000);
    assert.strictEqual(cfg.tiers.gold.multiplier, 1.5);
  });

  await check('earnEnabled:false earns nothing', async () => {
    const db = makeFakeDb(seed({ [P('loyalty/config')]: { ...CONFIG, earnEnabled: false } }));
    await engineFor(db).processLoyalty('ord-off', {
      orderId: 'ord-off', status: 'Delivered', type: 'delivery', phone: '9000000208',
      subtotal: 100, total: 105, paymentStatus: 'Paid',
    });
    assert.strictEqual(db.store.has(P('customers/9000000208/loyalty')), false);
  });

  /* ── delivery earn + idempotency + clawback ──────────────────────────── */

  const db = makeFakeDb(seed());
  const engine = engineFor(db);
  const order = {
    orderId: 'ord-earn-1', status: 'Delivered', type: 'delivery', phone: '9000000201',
    subtotal: 500, discount: 50, total: 531, paymentStatus: 'Paid', source: 'APP',
  };
  await engine.processLoyalty('ord-earn-1', order);

  await check('a delivered order earns on subtotal minus discount only', () => {
    const loy = db.store.get(P('customers/9000000201/loyalty'));
    assert.ok(loy, 'loyalty node written');
    assert.strictEqual(loy.points, 22, '₹450 / ₹20 = 22 pts; tax + fee never earn');
    assert.strictEqual(loy.lifetimePoints, 22);
    assert.strictEqual(loy.pointsSpent, 0);
    assert.strictEqual(loy.orderCount, 1);
    assert.strictEqual(loy.lastAccruedOrderId, 'ord-earn-1');
    assert.strictEqual(loy.tier, 'bronze');
  });

  await check('the accrual record keeps the audit trail', () => {
    const rec = db.store.get(P('loyalty/accruals/ord-earn-1'));
    assert.ok(rec);
    assert.strictEqual(rec.pointsEarned, 22);
    assert.strictEqual(rec.earnBase, 450);
    assert.strictEqual(rec.phone, '9000000201');
    assert.strictEqual(rec.business, BIZ);
  });

  await check('the leaderboard mirror is written with a server-computed rank', () => {
    const r = db.store.get(P('loyalty/rankings/9000000201'));
    assert.ok(r);
    assert.strictEqual(r.lifetimePoints, 22);
    assert.strictEqual(r.rank, 1);
  });

  await check('the customer order history row is written', () => {
    const row = db.store.get(P('customers/9000000201/orders/ord-earn-1'));
    assert.ok(row);
    assert.strictEqual(row.pointsEarned, 22);
    assert.strictEqual(row.status, 'delivered');
  });

  await check('a replayed event cannot earn twice', async () => {
    await engine.processLoyalty('ord-earn-1', order);
    const again = db.store.get(P('customers/9000000201/loyalty'));
    assert.strictEqual(again.points, 22);
    assert.strictEqual(again.lifetimePoints, 22);
    assert.strictEqual(again.orderCount, 1);
  });

  await check('a status that is not Delivered/Served earns nothing', async () => {
    const before = db.store.get(P('customers/9000000201/loyalty'));
    await engine.processLoyalty('ord-earn-1', { ...order, status: 'Placed' });
    assert.deepStrictEqual(db.store.get(P('customers/9000000201/loyalty')), before);
  });

  await check('cancelling claws the points back and deletes the accrual lock', async () => {
    await engine.processLoyalty('ord-earn-1', { ...order, status: 'Cancelled' });
    const after = db.store.get(P('customers/9000000201/loyalty'));
    assert.strictEqual(after.points, 0);
    assert.strictEqual(after.lifetimePoints, 0);
    assert.strictEqual(after.orderCount, 0);
    assert.strictEqual(after.lastAccruedOrderId, null);
    assert.strictEqual(after.lastClawedOrderId, 'ord-earn-1');
    assert.strictEqual(db.store.has(P('loyalty/accruals/ord-earn-1')), false);
  });

  await check('the clawback keeps an audit copy with its reason', () => {
    const audit = db.store.get(P('loyalty/clawbacks/ord-earn-1'));
    assert.ok(audit);
    assert.strictEqual(audit.pointsEarned, 22);
    assert.strictEqual(audit.reason, 'cancelled');
    assert.ok(audit.clawedAt > 0);
  });

  await check('a second cancel cannot claw twice', async () => {
    const before = db.store.get(P('customers/9000000201/loyalty'));
    await engine.processLoyalty('ord-earn-1', { ...order, status: 'Cancelled' });
    assert.deepStrictEqual(db.store.get(P('customers/9000000201/loyalty')), before);
  });

  await check('a cancelled-then-repaid bill earns again (lock released)', async () => {
    await engine.processLoyalty('ord-earn-1', { ...order, status: 'Delivered' });
    const again = db.store.get(P('customers/9000000201/loyalty'));
    assert.strictEqual(again.points, 22);
    assert.strictEqual(again.orderCount, 1);
  });

  await check('a refund claws back like a cancel', async () => {
    await engine.processLoyalty('ord-earn-1', { ...order, status: 'Refunded' });
    assert.strictEqual(db.store.get(P('customers/9000000201/loyalty')).points, 0);
  });

  await check('clawbackEnabled:false keeps a cancelled order\'s points', async () => {
    const dbnc = makeFakeDb(seed({ [P('loyalty/config')]: { ...CONFIG, clawbackEnabled: false } }));
    const enc = engineFor(dbnc);
    const o = {
      orderId: 'ord-nc', status: 'Delivered', type: 'delivery', phone: '9000000209',
      subtotal: 100, total: 105, paymentStatus: 'Paid',
    };
    await enc.processLoyalty('ord-nc', o);
    await enc.processLoyalty('ord-nc', { ...o, status: 'Cancelled' });
    assert.strictEqual(dbnc.store.get(P('customers/9000000209/loyalty')).points, 5);
    assert.ok(dbnc.store.get(P('loyalty/accruals/ord-nc')), 'lock stays because nothing was reversed');
  });

  await check('the tier multiplier of the CURRENT tier applies to new earnings', async () => {
    const dbs = makeFakeDb(seed({
      [P('customers/9000000300/loyalty')]: {
        points: 120, lifetimePoints: 120, pointsSpent: 0, tier: 'silver', orderCount: 3,
      },
    }));
    await engineFor(dbs).processLoyalty('ord-silver', {
      orderId: 'ord-silver', status: 'Delivered', type: 'delivery', phone: '9000000300',
      subtotal: 200, total: 210, paymentStatus: 'Paid',
    });
    const loy = dbs.store.get(P('customers/9000000300/loyalty'));
    // ₹200 / ₹20 = 10 base pts, silver x1.25 -> 12
    assert.strictEqual(loy.points, 132);
    assert.strictEqual(loy.lifetimePoints, 132);
  });

  /* ── dine-in ─────────────────────────────────────────────────────────── */

  const dbd = makeFakeDb(seed({
    [P('tableSessionsContact/sess-1')]: { customerPhone: '+91 90000 00202' },
  }));
  const ed = engineFor(dbd);
  const dineOrder = {
    orderId: 'dine-1', status: 'Served', type: 'dine-in', sessionId: 'sess-1',
    subtotal: 400, discount: 0, total: 420, paymentStatus: 'Paid', tableId: 'table_03',
  };

  await check('dineInPhoneFor resolves the guest from tableSessionsContact', async () => {
    assert.strictEqual(await ed.dineInPhoneFor(dineOrder, OUTLET), '9000000202');
  });

  await check('an unpaid dine-in order earns nothing', async () => {
    await ed.processLoyalty('dine-1', { ...dineOrder, paymentStatus: 'Pending' });
    assert.strictEqual(dbd.store.has(P('customers/9000000202/loyalty')), false);
  });

  await check('a settled dine-in bill credits the guest', async () => {
    await ed.processLoyalty('dine-1', dineOrder);
    const loy = dbd.store.get(P('customers/9000000202/loyalty'));
    assert.ok(loy, 'phone came from tableSessionsContact');
    assert.strictEqual(loy.points, 20, '₹400 / ₹20 = 20 pts');
  });

  await check('voiding a settled bill claws the dine-in credit back', async () => {
    await ed.processLoyalty('dine-1', { ...dineOrder, paymentStatus: 'Unpaid' });
    assert.strictEqual(dbd.store.get(P('customers/9000000202/loyalty')).points, 0);
    assert.strictEqual(dbd.store.get(P('loyalty/clawbacks/dine-1')).reason, 'bill-void');
  });

  await check('an anonymous table guest earns nothing instead of throwing', async () => {
    const db3 = makeFakeDb(seed());
    const e3 = engineFor(db3);
    await e3.processLoyalty('dine-3', {
      orderId: 'dine-3', status: 'Served', type: 'dine-in', sessionId: 'sess-missing',
      subtotal: 400, total: 420, paymentStatus: 'Paid',
    });
    assert.strictEqual(db3.store.has('loyalty/accruals/dine-3'), false);
    assert.strictEqual(await e3.dineInPhoneFor({ sessionId: 'sess-missing' }, OUTLET), '');
  });

  await check('dineInEarnEnabled:false stops dine-in credit only', async () => {
    const dbx = makeFakeDb(seed({
      [P('loyalty/config')]: { ...CONFIG, dineInEarnEnabled: false },
      [P('tableSessionsContact/sess-x')]: { customerPhone: '9000000210' },
    }));
    await engineFor(dbx).processLoyalty('dine-x', {
      orderId: 'dine-x', status: 'Served', type: 'dine-in', sessionId: 'sess-x',
      subtotal: 400, total: 420, paymentStatus: 'Paid',
    });
    assert.strictEqual(dbx.store.has(P('customers/9000000210/loyalty')), false);
  });

  await check('the bill discount is split across the covered orders before earning', async () => {
    const dbb = makeFakeDb(seed({
      [P('tableSessionsContact/sess-b')]: { customerPhone: '9000000204' },
      [P('tableSessions/sess-b')]: { discount: 30, orders: ['g1-o1', 'g1-o2'] },
      [P('orders/g1-o1')]: { status: 'Served', subtotal: 300, discount: 0 },
      [P('orders/g1-o2')]: { status: 'Served', subtotal: 100, discount: 0 },
    }));
    await engineFor(dbb).processLoyalty('g1-o1', {
      orderId: 'g1-o1', status: 'Served', type: 'dine-in', sessionId: 'sess-b',
      subtotal: 300, discount: 0, total: 315, paymentStatus: 'Paid',
    });
    const rec = dbb.store.get(P('loyalty/accruals/g1-o1'));
    // ₹30 over ₹300 / ₹100 -> ₹22.50 / ₹7.50 shares (largest remainder).
    assert.strictEqual(rec.earnBase, 277.5);
    assert.strictEqual(rec.pointsEarned, 13); // floor(27750 / 2000)
  });

  /* ── reward resurrect ────────────────────────────────────────────────── */

  await check('cancelling returns a burned reward code even when nothing accrued', async () => {
    const dbr = makeFakeDb(seed({
      [P('customers/9000000205/rewards/rw1')]: {
        status: 'used', usedOnOrder: 'ord-rw', code: 'LOYAL123456', cost: 100, rewardId: 'r100',
      },
    }));
    await engineFor(dbr).processLoyalty('ord-rw', {
      orderId: 'ord-rw', status: 'Cancelled', type: 'delivery', phone: '9000000205',
      subtotal: 200, total: 210,
      loyaltyTender: { rewardKey: 'rw1', code: 'LOYAL123456' },
    });
    const rw = dbr.store.get(P('customers/9000000205/rewards/rw1'));
    assert.strictEqual(rw.status, 'active');
    assert.strictEqual(rw.usedOnOrder, null);
    assert.strictEqual(dbr.store.has(P('loyalty/accruals/ord-rw')), false);
  });

  await check('a code burned on another order is left alone', async () => {
    const dbr = makeFakeDb(seed({
      [P('customers/9000000206/rewards/rw2')]: {
        status: 'used', usedOnOrder: 'some-other-order', code: 'LOYAL999999',
      },
    }));
    await engineFor(dbr).processLoyalty('ord-rw2', {
      orderId: 'ord-rw2', status: 'Cancelled', type: 'delivery', phone: '9000000206',
      loyaltyTender: { rewardKey: 'rw2', code: 'LOYAL999999' },
    });
    assert.strictEqual(dbr.store.get(P('customers/9000000206/rewards/rw2')).status, 'used');
  });

  /* ── redemption queue ────────────────────────────────────────────────── */

  const dbr2 = makeFakeDb(seed({
    [P('customers/9000000207/loyalty')]: {
      points: 250, pointsSpent: 0, lifetimePoints: 250, lastOrderAt: Date.now(), tier: 'silver',
    },
    [P('customers/9000000207/devices/dev-1')]: { phone: '9000000207', linkedAt: Date.now() },
  }));
  const req = (over) => ({
    phone: '9000000207', rewardId: 'r100', outlet: OUTLET, appUid: 'dev-1', requestedAt: Date.now(), ...over,
  });

  const first = await redeem.redeemRewardRequest({
    db: dbr2, resolvePath, OUTLET, key: 'req-1', req: req(), owner: 'cloud',
  });

  await check('a valid request deducts the configured cost and mints a code', () => {
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    assert.strictEqual(first.cost, 100);
    assert.match(first.code, /^LOYAL\d{6}$/);
    const loy = dbr2.store.get(P('customers/9000000207/loyalty'));
    assert.strictEqual(loy.pointsSpent, 100);
    assert.strictEqual(loy.lifetimePoints, 250, 'spending never demotes');
    const rw = dbr2.store.get(P('customers/9000000207/rewards/req-1'));
    assert.strictEqual(rw.status, 'active');
    assert.strictEqual(rw.code, first.code);
    assert.strictEqual(rw.cost, 100);
    assert.strictEqual(dbr2.store.has(P('bot/redeemQueue/req-1')), false, 'queue entry consumed');
  });

  await check('the same request replayed cannot spend a second time', async () => {
    const again = await redeem.redeemRewardRequest({
      db: dbr2, resolvePath, OUTLET, key: 'req-1', req: req(), owner: 'bot',
    });
    assert.deepStrictEqual(again, { ok: false, skipped: 'claimed' });
    assert.strictEqual(dbr2.store.get(P('customers/9000000207/loyalty')).pointsSpent, 100);
  });

  await check('a bot and cloud copy of one request can only spend once', async () => {
    // Both writers race the same fresh key; the claim lets exactly one through.
    const [a, b] = await Promise.all([
      redeem.redeemRewardRequest({ db: dbr2, resolvePath, OUTLET, key: 'req-race', req: req(), owner: 'bot' }),
      redeem.redeemRewardRequest({ db: dbr2, resolvePath, OUTLET, key: 'req-race', req: req(), owner: 'cloud' }),
    ]);
    const winners = [a, b].filter((r) => r.ok).length;
    assert.strictEqual(winners, 1, 'exactly one writer wins the claim');
    assert.strictEqual(dbr2.store.get(P('customers/9000000207/loyalty')).pointsSpent, 200);
  });

  await check('an unlinked device is rejected with an audit row', async () => {
    const res = await redeem.redeemRewardRequest({
      db: dbr2, resolvePath, OUTLET, key: 'req-2', req: req({ appUid: 'other-device' }), owner: 'cloud',
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'device not linked');
    assert.strictEqual(dbr2.store.get(P('customers/9000000207/rewards/req-2')).status, 'rejected');
    assert.strictEqual(dbr2.store.has(P('bot/redeemQueue/req-2')), false);
  });

  await check('insufficient points is rejected, never partially spent', async () => {
    const before = dbr2.store.get(P('customers/9000000207/loyalty')).pointsSpent;
    const res = await redeem.redeemRewardRequest({
      db: dbr2, resolvePath, OUTLET, key: 'req-3', req: req(), owner: 'cloud',
    });
    assert.strictEqual(res.error, 'insufficient points');
    assert.strictEqual(dbr2.store.get(P('customers/9000000207/loyalty')).pointsSpent, before);
  });

  await check('an unknown reward id is rejected before any transaction', async () => {
    const res = await redeem.redeemRewardRequest({
      db: dbr2, resolvePath, OUTLET, key: 'req-4', req: req({ rewardId: 'nope' }), owner: 'cloud',
    });
    assert.strictEqual(res.error, 'unknown reward');
  });

  /* ── source pins ─────────────────────────────────────────────────────── */

  await check('the bot stands down on config/loyaltyRelay/enabled === true', () => {
    const src = read('bot/index.js');
    assert.match(src, /async function isLoyaltyRelayEnabled\(\)/);
    assert.match(src, /db\.ref\('config\/loyaltyRelay\/enabled'\)\.once\('value'\)/);
    assert.match(src, /_loyaltyRelayCache = \{ at: Date\.now\(\), on: snap\.val\(\) === true \};/);
    assert.match(src, /_loyaltyRelayCache = \{ at: Date\.now\(\), on: false \};/, 'unreadable flag leaves the bot in charge');
    assert.match(src, /Date\.now\(\) - _loyaltyRelayCache\.at < 30000/, '30 s cache, read on every order event');
  });

  await check('the bot only skips processLoyalty + redemption when the relay owns them', () => {
    const src = read('bot/index.js');
    assert.match(src, /const \[finalizerRelay, loyaltyRelay\] = order/);
    assert.match(src, /if \(order && !loyaltyRelay\) processLoyalty\(/);
    assert.match(src, /if \(!\(await isLoyaltyRelayEnabled\(\)\)\) redeem\.initRedeemListener\(/);
  });

  await check('the bot builds the engine with its FCM tier-up callback behind a guarded require', () => {
    const src = read('bot/index.js');
    assert.match(src, /const \{ createLoyaltyEngine \} = require\('\.\/loyalty-engine'\)/);
    assert.match(src, /onTierUp: \(phone, newTier, oldTier, outlet, bid\) => notifyTierUp\(/);
    assert.match(src, /getLoyaltyConfig = loyaltyEngine\.getLoyaltyConfig/);
    assert.match(src, /\[LOYALTY\] loyalty-engine failed to load/);
  });

  await check('the engine is socket-free (no Baileys, no bot/index, no pm2)', () => {
    const src = read('bot/loyalty-engine.js');
    for (const banned of ['baileys', "require('./index')", "require('./firebase')", 'pm2', 'redis']) {
      assert.ok(!src.includes(banned), 'engine must not reference ' + banned);
    }
    assert.match(src, /module\.exports = \{ createLoyaltyEngine \}/);
  });

  await check('the redemption handler is exported and claim-guarded', () => {
    const src = read('bot/redeem.js');
    assert.match(src, /module\.exports = \{ canAfford, pointsLapsed, redeemRewardRequest, initRedeemListener \}/);
    assert.match(src, /bot\/redeemClaims\/\$\{String\(key\)\}/);
    assert.match(src, /const CLAIM_TTL_MS = 5 \* 60 \* 1000/);
    assert.match(src, /if \(!claim \|\| !claim\.committed\) return \{ ok: false, skipped: 'claimed' \}/);
  });

  await check('the relay triggers watch leaves, not whole orders', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/loyaltyRelay.ts');
    assert.match(src, /orders\/\{orderId\}\/status'/);
    assert.match(src, /orders\/\{orderId\}\/paymentStatus'/);
    assert.match(src, /bot\/redeemQueue\/\{reqId\}'/);
    assert.ok(!/ref: 'businesses\/\{bid\}\/outlets\/\{oid\}\/orders\/\{orderId\}'/.test(src), 'no whole-order listener');
  });

  await check('the relay is off unless the flag is exactly true, and skips the demo tenant', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/loyaltyRelay.ts');
    assert.match(src, /const RELAY_FLAG = 'config\/loyaltyRelay\/enabled'/);
    assert.match(src, /return snap\.val\(\) === true/);
    assert.match(src, /const DEMO_BUSINESS_ID = 'foodhubbie-demo'/);
    const guards = src.match(/if \(bid === DEMO_BUSINESS_ID\) return;/g) || [];
    assert.strictEqual(guards.length, 3, 'all three triggers hard-skip the demo tenant');
    const flagChecks = src.match(/if \(!\(await relayEnabled\(\)\)\) return;/g) || [];
    assert.strictEqual(flagChecks.length, 3, 'all three triggers gated by the one switch');
  });

  await check('the relay short-circuits on non-actionable status values', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/loyaltyRelay.ts');
    assert.match(src, /new Set\(\['delivered', 'served', 'cancelled', 'refunded', 'canceled'\]\)/);
    assert.match(src, /new Set\(\['paid', 'unpaid'\]\)/);
    assert.match(src, /if \(!ACTIONABLE_STATUS\.has\(status\)\) return;/);
    assert.match(src, /if \(!ACTIONABLE_PAYMENT\.has\(payment\)\) return;/);
    assert.match(src, /if \(!engine\.isDineIn\(order\)\) return;/);
  });

  await check('the relay never sends the tier-up push itself (onLoyaltyTierUp owns it)', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/loyaltyRelay.ts');
    assert.ok(!/onTierUp/.test(src), 'no onTierUp dep in the cloud factory call');
    assert.ok(!/messaging|sendEachForMulticast/.test(src), 'no FCM in the loyalty relay');
    assert.match(src, /config\/loyaltyRelay\/enabled/);
  });

  await check('the cloud factory pins the tenant and omits onTierUp', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/shared/loyalty/factory.ts');
    assert.match(src, /export function makeLoyaltyEngine\(bid: string, oid: string\)/);
    assert.match(src, /const \{ db, resolvePath \} = tenantDb\(bid, oid\)/);
    assert.match(src, /businessIdFor: \(\) => bid/);
    assert.match(src, /defaultOutlet: oid/);
    assert.ok(!/onTierUp:/.test(src), 'no onTierUp dep passed (the tier-up push is a trigger)');
  });

  await check('the three triggers are exported from index.ts', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/src/index.ts');
    assert.match(src, /onOrderLoyaltyStatus,\s*\n\s*onOrderLoyaltyPayment,\s*\n\s*onRedeemRequest,\s*\n\} from '\.\/triggers\/loyaltyRelay'/);
  });

  await check('the engine and the redemption handler are vendored into the bundle', () => {
    const src = read('FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs');
    assert.match(src, /'bot\/loyalty-engine\.js'/);
    assert.match(src, /'bot\/redeem\.js'/);
  });

  await check('the demo seeder never gives the demo tenant a relay flag', () => {
    const src = read('tools/seed-demo-tenant.cjs');
    assert.ok(!/loyaltyRelay/.test(src));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('guard crashed:', err);
  process.exit(1);
});
