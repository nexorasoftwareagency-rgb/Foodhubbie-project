/**
 * META COST BALANCE PUBLISHER (bot-control-api/meta-cost-publisher.js)
 * =========================================================================
 * Arms the `_metaCostGuard` in bot/transport.js by writing `balancePaise`
 * (remaining Meta credit) to `walletBilling/{bid}/{oid}` on a fixed interval.
 *
 * The guard reads `walletBilling/{bid}/{oid}/balancePaise` + `/metaUsage/{YYYY-MM}`
 * before every meta-transport send. Without a numeric balancePaise it fails
 * open (never blocks). This publisher is what arms it:
 *
 *   balancePaise = META_CREDIT_LINE_START_PAISE - accumulated metaUsage cost
 *                  for the current month
 *
 * Each outlet gets its own allocated share of the shared credit line, so one
 * outlet's usage cannot drain another's balance. Writes only when the value
 * changes (no quota churn).
 *
 * Env:
 *   META_CREDIT_LINE_START_PAISE  starting credit per outlet (default 100000 = ₹1,000)
 *   META_COST_PUBLISH_INTERVAL_SEC  publish cadence seconds (default 300 = 5 min)
 *
 * Self-check: node bot-control-api/meta-cost-publisher.js
 */

const DEMO_BID = 'foodhubbie-demo';
const START_PAISE = Number(process.env.META_CREDIT_LINE_START_PAISE) || 100000; // ₹1,000
const INTERVAL_MS = Math.max(60, Number(process.env.META_COST_PUBLISH_INTERVAL_SEC) || 300) * 1000;

/** Only an outlet with metaUsage is worth publishing a balance for. */
function shouldPublish(bid, billing) {
    return bid !== DEMO_BID && !!billing;
}

/** Compute balance from starting credit minus this month's meta cost. */
function computeBalance(billing, metaUsage) {
    const monthKey = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7); // YYYY-MM
    const usage = (metaUsage && metaUsage[monthKey]) || {};
    const totalCost = Number(usage && usage.totalCostPaise) || 0;
    return Math.max(0, START_PAISE - totalCost);
}

async function publishBalance(admin, bid, oid) {
    const db = admin.database();
    const [billingSnap, usageSnap] = await Promise.all([
        db.ref(`walletBilling/${bid}/${oid}`).get(),
        db.ref(`walletBilling/${bid}/${oid}/metaUsage`).get(),
    ]);
    const billing = billingSnap.val() || null;
    if (!shouldPublish(bid, billing)) return;

    const balance = computeBalance(billing, usageSnap.val());
    const path = `walletBilling/${bid}/${oid}`;
    const ref = db.ref(`${path}/balancePaise`);

    // Only write when changed — no quota churn.
    const existing = Number((await ref.get()).val());
    if (!Number.isFinite(existing) || Math.abs(existing - balance) >= 1) {
        await ref.set(balance);
        console.log(`[meta-cost] ${bid}/${oid} balancePaise → ${balance} (start ₹${START_PAISE / 100})`);
    }
    return balance;
}

async function pass(admin) {
    const snap = await admin.database().ref('outletIndex').get();
    const index = snap.val() || {};
    for (const [oid, meta] of Object.entries(index)) {
        const bid = typeof meta === 'string' ? meta : (meta && meta.bid);
        if (!bid) continue;
        try {
            await publishBalance(admin, bid, oid);
        } catch (err) {
            console.warn(`[meta-cost] ${bid}/${oid} skipped:`, err && err.message);
        }
    }
}

async function startMetaCostPublisher({ admin }) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await pass(admin); } catch (err) { console.error('[meta-cost] pass failed:', err && err.message); }
        finally { running = false; }
    };
    await run();
    setInterval(run, INTERVAL_MS);
    console.log(`[meta-cost] publisher armed — every ${INTERVAL_MS / 1000}s, start credit ₹${START_PAISE / 100} per outlet`);
}

// check: node bot-control-api/meta-cost-publisher.js
if (require.main === module) {
    const assert = require('node:assert');
    // computeBalance with no usage → full credit
    assert.equal(computeBalance({}, {}), START_PAISE, 'no usage = full credit');
    // computeBalance with usage → reduced credit
    const used = { '2026-11': { totalCostPaise: 2500 } };
    assert.equal(computeBalance({}, used), START_PAISE - 2500, 'usage reduces balance');
    assert.equal(computeBalance({}, { '2026-11': { totalCostPaise: START_PAISE + 5000 } }), 0, 'balance floored at 0');
    console.log('meta-cost-publisher OK');
    process.exit(0);
}

module.exports = { startMetaCostPublisher, publishBalance, pass, computeBalance, START_PAISE };
