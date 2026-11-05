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
 * One cheap pass per minute: `outletIndex` + each outlet's `walletBilling` node. The
 * expensive all-order read only happens for armed outlets (today: none).
 * Requires Node >= 22.12 for require(esm) of shared/cost-math.js.
 * Self-check: node bot-control-api/wallet-watch.js
 * ============================================================================
 */
const { computeWallet, walletGate } = require('../shared/cost-math.js');

const DEMO_BID = 'foodhubbie-demo';
const INTERVAL_MS = Math.max(60, Number(process.env.WALLET_GATE_INTERVAL_SEC) || 60) * 1000;

/** Only an explicitly armed, non-demo outlet is ever gated. */
function isArmed(bid, billing) {
    return bid !== DEMO_BID && !!(billing && billing.wallet && billing.wallet.enforce === true);
}

/** Stored value for a computed wallet: '' (open) | 'low' | 'closed'. */
function gateFor(wallet) {
    const g = walletGate(wallet || {});
    return g === 'ok' ? '' : g;
}

/**
 * Recompute + publish one outlet. Writes only when the value actually changes,
 * so N passes a minute cost no quota. Returns the published value.
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
        const [ordersSnap, campSnap] = await Promise.all([
            db.ref(`${base}/orders`).get(),
            db.ref(`${base}/bot/promotions/campaigns`).get().catch(() => null),
        ]);
        const w = computeWallet({
            billing,
            orders: ordersSnap.val() || {},
            campaigns: campSnap ? campSnap.val() || {} : {},
        });
        next = gateFor(w);
        balance = w.balance;
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
    for (const [oid, meta] of Object.entries(index)) {
        const bid = typeof meta === 'string' ? meta : (meta && meta.bid);
        if (!bid) continue;
        try {
            await publishWalletGate(admin, bid, oid);
        } catch (err) {
            console.warn(`[wallet-gate] ${bid}/${oid} skipped:`, err && err.message);
        }
    }
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
    assert.equal(isArmed('roshani-pizza', { wallet: { enforce: true } }), true, 'armed outlet publishes');
    assert.equal(isArmed('roshani-pizza', { wallet: { enforce: false } }), false, 'observe mode never gates');
    assert.equal(isArmed('roshani-pizza', {}), false, 'unseeded billing never gates');
    assert.equal(isArmed(DEMO_BID, { wallet: { enforce: true } }), false, 'demo tenant is never gated');
    assert.equal(gateFor({ paid: 1000, balance: 500 }), '', 'healthy wallet stores empty string');
    assert.equal(gateFor({ paid: 1000, balance: 100 }), 'low', 'low wallet stores low');
    assert.equal(gateFor({ balance: 0 }), 'closed', 'zero balance stores closed');
    assert.equal(gateFor({ balance: -5 }), 'closed', 'negative balance stores closed');
    console.log('wallet-watch OK');
}

module.exports = { startWalletWatcher, publishWalletGate, pass, isArmed, gateFor };
