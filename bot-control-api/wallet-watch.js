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
 * EGRESS (batch 14): `walletBilling` and `outletIndex` are held as one live
 * listener each instead of being re-read every minute. A pass used to cost 34
 * `.get()`s (~29 KB measured, of which the payload was only 6.5 KB — the rest
 * was per-request framing), which was 40% of ALL remaining RTDB traffic and 5x
 * bad at 100 outlets. Now the initial snapshot is read once and RTDB pushes only
 * deltas, so a steady-state pass costs a handful of tiny gate reads.
 *
 * A failed or slow cache snapshot aborts the pass instead of publishing: an
 * outlet is never opened because its billing could not be read. This module is
 * the ONLY writer of `walletGate` (the Cloud Function `walletGateCheck` was
 * deleted in batch 14 — it read the legacy pruned `outlets/{oid}/billing` node,
 * so it always considered every outlet disarmed and reopened any armed gate
 * within a minute).
 *
 * Requires Node >= 22.12 for require(esm) of shared/cost-math.js.
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

// ---------------------------------------------------------------------------
// Root caches: 'walletBilling' | 'outletIndex' -> { data, ready, ref, onChange }
//
// Both nodes change only when the platform writes them (a payment, a top-up,
// an arm switch, a new outlet), so a listener costs one snapshot plus deltas
// instead of a full re-read every minute. `ready` resolves on the first
// snapshot; a timeout or listener error rejects it and the pass publishes
// nothing rather than treating "unknown" as "unarmed".
// ---------------------------------------------------------------------------
const caches = new Map();

function ensureCache(db, path) {
    const hit = caches.get(path);
    if (hit) return hit;

    const ref = db.ref(path);
    const entry = { data: null, ref, onChange: null };
    let resolveFirst, rejectFirst;
    entry.ready = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    entry.ready.catch(() => {}); // a caller that stops awaiting must not crash the process

    const timer = setTimeout(() => {
        releaseCache(path);
        rejectFirst(new Error(`${path} snapshot timed out`));
    }, FIRST_SNAPSHOT_MS);
    if (timer.unref) timer.unref();

    entry.onChange = (snap) => {
        entry.data = snap.val() || null;
        clearTimeout(timer);
        resolveFirst(entry);
    };
    caches.set(path, entry);
    try {
        ref.on('value', entry.onChange, (err) => {
            clearTimeout(timer);
            releaseCache(path);
            rejectFirst(err || new Error(`${path} listener failed`));
        });
    } catch (err) {
        clearTimeout(timer);
        releaseCache(path);
        rejectFirst(err);
    }
    return entry;
}

function releaseCache(path) {
    const entry = caches.get(path);
    if (!entry) return;
    caches.delete(path);
    try { entry.ref.off('value', entry.onChange); } catch (_) { /* already gone */ }
}

/** Billing for one outlet out of the cached root (never a per-outlet read). */
function billingOf(entry, bid, oid) {
    const root = entry && entry.data;
    return (root && root[bid] && root[bid][oid]) || null;
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
    const [billingEntry, gateSnap] = await Promise.all([
        ensureCache(db, 'walletBilling').ready,
        db.ref(`${base}/walletGate`).get(),
    ]);
    const billing = billingOf(billingEntry, bid, oid);

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
    const indexEntry = await ensureCache(admin.database(), 'outletIndex').ready;
    const index = indexEntry.data || {};
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
        // two root caches (walletBilling, outletIndex) + one orders mirror
        assert.equal(fake.count.on, 3, 'two root caches + one orders listener, nothing per-outlet');
        assert.equal(fake.count.onPaths.includes('walletBilling'), true, 'walletBilling is held as a listener');
        assert.equal(fake.count.onPaths.includes('outletIndex'), true, 'outletIndex is held as a listener');
        assert.equal(fake.count.onPaths.includes(ordersPath), true, 'the orders mirror is on the armed outlet');
        assert.equal(fake.count.downloadedOrders, 1, 'orders downloaded once');

        const getsAfterFirst = fake.count.gets;
        const pathsAfterFirst = fake.count.getPaths.length;
        await pass(fake.admin);
        assert.equal(fake.count.on, 3, 'second pass does not re-attach any listener');
        // Only 2 gate reads + 1 campaigns read: no walletBilling, no outletIndex, no orders.
        assert.equal(fake.count.gets - getsAfterFirst, 3, 'second pass reads only the gate nodes + campaigns');
        const passTwoPaths = fake.count.getPaths.slice(pathsAfterFirst).join(' ');
        assert.equal(passTwoPaths.includes('walletBilling'), false, 'no per-outlet billing read');
        assert.equal(passTwoPaths.includes('outletIndex'), false, 'no outletIndex read');
        assert.equal(passTwoPaths.includes('/orders'), false, 'no orders read');
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
        fake.push('walletBilling');
        await pass(fake.admin);
        assert.equal(fake.tree.businesses.b.outlets.o.walletGate, undefined, 'disarming removes the gate');
        assert.equal(fake.count.ordersListeners(), 0, 'disarming releases the orders listener');
        assert.equal(fake.count.listeners(), 2, 'the two root caches stay attached (they are shared)');

        // demo is never watched even when someone arms it
        fake.tree.walletBilling['foodhubbie-demo'] = { demo: { wallet: { enforce: true } } };
        fake.push('walletBilling');
        await pass(fake.admin);
        assert.equal(fake.tree.businesses['foodhubbie-demo'].outlets.demo.walletGate, undefined, 'demo never gated');
        assert.equal(fake.count.ordersListeners(), 0, 'demo never watched');

        // a cached billing node must actually arm the outlet back (delta, not re-read)
        fake.tree.walletBilling.b.o.wallet.enforce = true;
        fake.push('walletBilling');
        await pass(fake.admin);
        assert.equal(fake.count.ordersListeners(), 1, 're-arming from a cached delta attaches the orders mirror again');
        const beforeFailedPass = fake.count.gets;
        await pass(fake.admin);
        assert.equal(fake.count.gets - beforeFailedPass, 3, 'a steady pass never re-reads billing or the index');

        console.log('wallet-watch OK');
        process.exit(0);
    })().catch((e) => { console.error('wallet-watch FAILED:', e && e.message); process.exit(1); });

    /** Minimal RTDB stand-in: get / on / off / set / remove over a plain object. */
    function fakeDb(tree) {
        const listeners = [];
        const count = {
            gets: 0, on: 0, onPaths: [], getPaths: [], downloadedOrders: 0,
            listeners: () => listeners.length,
            ordersListeners: () => listeners.filter((l) => l.path.endsWith('/orders')).length,
        };
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
                        async get() { count.gets++; count.getPaths.push(path); if (path.endsWith('/orders')) count.downloadedOrders++; return snap(getAt(path)); },
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
