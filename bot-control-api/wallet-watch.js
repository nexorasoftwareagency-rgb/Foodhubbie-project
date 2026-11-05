/**
 * D4 WALLET GATE — SERVER-SIDE PUBLISHER (bot-control-api/wallet-watch.js)
 * ============================================================================
 * `outlets/{oid}/walletGate` is public state ('low' | 'closed' | ''/absent) that
 * the WhatsApp bot, the QR menu and the Customer App read before letting a
 * customer order. It used to be written by the restaurant's own Admin Costs tab,
 * which meant (a) it only refreshed when somebody happened to open that tab and
 * (b) the restaurant could un-gate itself. This module is now the only writer:
 *
 *   - recomputes the wallet with the exact same math as the Admin Costs tab and
 *     Supreme (shared/cost-math.js over billing + orders + promo campaigns),
 *     reading the ledger from the ROOT `walletBilling/{bid}/{oid}` node (money
 *     must live outside the tenant-writable `businesses/{bid}` subtree),
 *   - publishes only for outlets whose FoodHubbie plan has armed
 *     `billing.wallet.enforce === true` (Supreme switches it on),
 *   - clears the node for every other outlet, so nothing is gated by accident,
 *   - hard-skips the demo tenant (its seeded history is not a real wallet).
 *
 * SCALE (audit item E): an armed outlet's orders node is mirrored ONCE with a
 * live listener and the 60 s pass recomputes from memory — RTDB pushes only the
 * deltas after the first snapshot. The old code re-downloaded every order every
 * minute (127 KB/min for the live pizza outlet at 183 orders, growing linearly;
 * 7 MB/min at 10k orders). The mirror is dropped the moment an outlet is
 * disarmed, so no unarmed tenant costs memory.
 *
 * One pass per minute: `outletIndex` + each outlet's `walletBilling` + gate nodes
 * plus one tiny campaigns read per armed outlet. Requires Node >= 22.12 for
 * require(esm) of shared/cost-math.js.
 * Self-check: node bot-control-api/wallet-watch.js
 * ============================================================================
 */
const { computeWallet, walletGate } = require('../shared/cost-math.js');

const DEMO_BID = 'foodhubbie-demo';
const INTERVAL_MS = Math.max(60, Number(process.env.WALLET_GATE_INTERVAL_SEC) || 60) * 1000;
const FIRST_SNAPSHOT_MS = 20000;

/** Only an explicitly armed, non-demo outlet is ever gated. */
function isArmed(bid, billing) {
    return bid !== DEMO_BID && !!(billing && billing.wallet && billing.wallet.enforce === true);
}

/** Stored value for a computed wallet: '' (open) | 'low' | 'closed'. */
function gateFor(wallet) {
    const g = walletGate(wallet || {});
    return g === 'ok' ? '' : g;
}

// Armed outlets only: 'bid/oid' -> { orders, ref, onChange, ready }
const mirrors = new Map();

/**
 * Live mirror of one outlet's orders node. The first snapshot resolves
 * `ready`; every later child change is pushed by RTDB into `orders`. A failed
 * listener is released so the next pass retries from scratch.
 */
function ensureOrdersMirror(db, bid, oid) {
    const key = `${bid}/${oid}`;
    const hit = mirrors.get(key);
    if (hit) return hit;

    const ref = db.ref(`businesses/${bid}/outlets/${oid}/orders`);
    const entry = { orders: {}, ref, onChange: null };
    let resolveFirst, rejectFirst;
    entry.ready = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    entry.ready.catch(() => {}); // a caller that stops awaiting must not crash the process

    const timer = setTimeout(() => {
        release(key);
        rejectFirst(new Error('orders snapshot timed out'));
    }, FIRST_SNAPSHOT_MS);
    if (timer.unref) timer.unref();

    entry.onChange = (snap) => {
        entry.orders = snap.val() || {};
        clearTimeout(timer);
        resolveFirst(entry);
    };
    mirrors.set(key, entry);
    try {
        ref.on('value', entry.onChange, (err) => {
            clearTimeout(timer);
            release(key);
            rejectFirst(err || new Error('orders listener failed'));
        });
    } catch (err) {
        clearTimeout(timer);
        release(key);
        rejectFirst(err);
    }
    return entry;
}

/** Drop a mirror (disarmed outlet, deleted outlet, listener error). */
function release(key) {
    const entry = mirrors.get(key);
    if (!entry) return;
    mirrors.delete(key);
    try { entry.ref.off('value', entry.onChange); } catch (_) { /* already gone */ }
}

/**
 * Recompute + publish one outlet. Writes only when the value actually changes,
 * so N passes a minute cost no quota. Returns the published value.
 * Fails open in the sense that matters: an outlet whose orders cannot be read
 * keeps whatever gate it had instead of being published as closed on no data.
 */
async function publishWalletGate(admin, bid, oid) {
    const base = `businesses/${bid}/outlets/${oid}`;
    const db = admin.database();
    const [billingSnap, gateSnap] = await Promise.all([
        db.ref(`walletBilling/${bid}/${oid}`).get(),
        db.ref(`${base}/walletGate`).get(),
    ]);
    const billing = billingSnap.val() || null;

    let next = '';
    let balance = null;
    if (isArmed(bid, billing)) {
        const mirror = await ensureOrdersMirror(db, bid, oid).ready;
        const campSnap = await db.ref(`${base}/bot/promotions/campaigns`).get().catch(() => null);
        const w = computeWallet({
            billing,
            orders: mirror.orders,
            campaigns: campSnap ? campSnap.val() || {} : {},
        });
        next = gateFor(w);
        balance = w.balance;
    } else {
        release(`${bid}/${oid}`); // disarmed or demo — hold no order mirror
    }

    const current = gateSnap.exists() ? String(gateSnap.val() || '').trim().toLowerCase() : '';
    if (next !== current) {
        const ref = db.ref(`${base}/walletGate`);
        if (next) await ref.set(next);
        else await ref.remove();
        console.log(`[wallet-gate] ${bid}/${oid} \u2192 ${next || 'open'}${balance === null ? '' : ` (balance \u20B9${balance})`}`);
    }
    return { gate: next, balance };
}

/** One pass over every known outlet. Never throws out of a single outlet. */
async function pass(admin) {
    const snap = await admin.database().ref('outletIndex').get();
    const index = snap.val() || {};
    const seen = new Set();
    for (const [oid, meta] of Object.entries(index)) {
        const bid = typeof meta === 'string' ? meta : (meta && meta.bid);
        if (!bid) continue;
        seen.add(`${bid}/${oid}`);
        try {
            await publishWalletGate(admin, bid, oid);
        } catch (err) {
            console.warn(`[wallet-gate] ${bid}/${oid} skipped:`, err && err.message);
        }
    }
    // an outlet removed from the index while armed would otherwise keep its listener forever
    for (const key of [...mirrors.keys()]) if (!seen.has(key)) release(key);
}

async function startWalletWatcher({ admin }) {
    let running = false;
    const run = async () => {
        if (running) return; // a slow pass must not stack
        running = true;
        try {
            await pass(admin);
        } catch (err) {
            console.error('[wallet-gate] pass failed:', err && err.message);
        } finally {
            running = false;
        }
    };
    await run();
    setInterval(run, INTERVAL_MS);
    console.log(`[wallet-gate] publisher armed \u2014 every ${INTERVAL_MS / 1000}s, publishes only while billing.wallet.enforce is on`);
}

// check: node bot-control-api/wallet-watch.js
if (require.main === module) {
    const assert = require('node:assert');

    // ---- pure helpers ----
    assert.equal(isArmed('roshani-pizza', { wallet: { enforce: true } }), true, 'armed outlet publishes');
    assert.equal(isArmed('roshani-pizza', { wallet: { enforce: false } }), false, 'observe mode never gates');
    assert.equal(isArmed('roshani-pizza', {}), false, 'unseeded billing never gates');
    assert.equal(isArmed(DEMO_BID, { wallet: { enforce: true } }), false, 'demo tenant is never gated');
    assert.equal(gateFor({ paid: 1000, balance: 500 }), '', 'healthy wallet stores empty string');
    assert.equal(gateFor({ paid: 1000, balance: 100 }), 'low', 'low wallet stores low');
    assert.equal(gateFor({ balance: 0 }), 'closed', 'zero balance stores closed');
    assert.equal(gateFor({ balance: -5 }), 'closed', 'negative balance stores closed');

    // ---- the mirror: one orders read per armed outlet, deltas after that ----
    const fake = fakeDb({
        walletBilling: { b: { o: { payments: { p1: { amount: 1000 } }, wallet: { enforce: true } } } },
        businesses: {
            b: {
                outlets: {
                    o: {
                        orders: { o1: { status: 'Placed', total: 1000, source: 'QR' } }, // 1% -> ₹10 used
                        bot: { promotions: { campaigns: {} } },
                    },
                },
            },
            'foodhubbie-demo': {
                outlets: { demo: { orders: { d1: { status: 'Placed', total: 5000, source: 'QR' } }, bot: {} } },
            },
        },
        outletIndex: { o: { bid: 'b' }, demo: { bid: 'foodhubbie-demo' } },
    });
    const ordersPath = 'businesses/b/outlets/o/orders';

    (async () => {
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, undefined, 'healthy armed outlet gets no gate node');
        assert.equal(fake.count.on, 1, 'one orders listener for the armed outlet');
        assert.equal(fake.count.onPaths.includes(ordersPath), true, 'the listener is on the armed outlet orders');
        assert.equal(fake.count.downloadedOrders, 1, 'orders downloaded once');

        const getsAfterFirst = fake.count.gets;
        await pass(fake.admin);
        assert.equal(fake.count.on, 1, 'second pass does not re-attach the listener');
        // outletIndex + (armed: billing + gate + campaigns) + (demo: billing + gate). No orders read.
        assert.equal(fake.count.gets - getsAfterFirst, 6, 'second pass reads only the small nodes');
        assert.equal(fake.count.downloadedOrders, 1, 'second pass downloads no orders');

        // a new order arrives -> RTDB pushes it -> the next pass bills it from memory
        fake.tree.businesses.b.outlets.o.orders.o2 = { status: 'Placed', total: 90000, source: 'QR' }; // +₹900
        fake.push(ordersPath);
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, 'low', 'delta applied from memory: 990 -> 90 (low)');

        fake.tree.businesses.b.outlets.o.orders.o3 = { status: 'Placed', total: 100000, source: 'QR' }; // +₹1000
        fake.push(ordersPath);
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, 'closed', 'delta applied from memory: balance -910 (closed)');

        // a lowercase cancelled order must not bill (item D)
        fake.tree.businesses.b.outlets.o.orders.o4 = { status: 'cancelled', total: 100000, source: 'QR' };
        fake.push(ordersPath);
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, 'closed', 'cancelled order does not change the gate');

        // disarm -> gate removed, mirror released
        fake.tree.walletBilling.b.o.wallet.enforce = false;
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, undefined, 'disarming removes the gate');
        assert.equal(fake.count.listeners(), 0, 'disarming releases the orders listener');

        // demo is never watched even when someone arms it
        fake.tree.walletBilling['foodhubbie-demo'] = { demo: { wallet: { enforce: true } } };
        await pass(fake.admin);
        assert.equal(fake.tree.businesses['foodhubbie-demo'].outlets.demo.walletGate, undefined, 'demo never gated');
        assert.equal(fake.count.listeners(), 0, 'demo never watched');

        console.log('wallet-watch OK');
        process.exit(0);
    })().catch((e) => { console.error('wallet-watch FAILED:', e && e.message); process.exit(1); });

    /** Minimal RTDB stand-in: get / on / off / set / remove over a plain object. */
    function fakeDb(tree) {
        const listeners = [];
        const count = { gets: 0, on: 0, onPaths: [], downloadedOrders: 0, listeners: () => listeners.length };
        const getAt = (p) => p.split('/').reduce((n, k) => (n == null ? n : n[k]), tree);
        const setAt = (p, v) => {
            const ks = p.split('/');
            let node = tree;
            for (const k of ks.slice(0, -1)) node = node[k] = node[k] || {};
            const last = ks[ks.length - 1];
            if (v === undefined) delete node[last]; else node[last] = v;
        };
        const snap = (v) => ({ val: () => (v === undefined ? null : v), exists: () => v !== undefined && v !== null });
        const admin = {
            database: () => ({
                ref(path) {
                    return {
                        async get() { count.gets++; if (path.endsWith('/orders')) count.downloadedOrders++; return snap(getAt(path)); },
                        on(_evt, cb) { count.on++; count.onPaths.push(path); if (path.endsWith('/orders')) count.downloadedOrders++; listeners.push({ path, cb }); cb(snap(getAt(path))); },
                        off(_evt, cb) { const i = listeners.findIndex((l) => l.path === path && l.cb === cb); if (i >= 0) listeners.splice(i, 1); },
                        async set(v) { setAt(path, v); },
                        async remove() { setAt(path, undefined); },
                    };
                },
            }),
        };
        return {
            admin, tree, count,
            push(path) { listeners.filter((l) => l.path === path).forEach((l) => l.cb(snap(getAt(path)))); },
        };
    }
}

module.exports = { startWalletWatcher, publishWalletGate, pass, isArmed, gateFor, mirrors };
