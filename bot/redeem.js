/**
 * Loyalty redemption (server-authoritative).
 *
 * The menu app cannot write redemption records: it pushes a request to
 * bot/redeemQueue and the bot (admin SDK, rules bypass) is the only writer.
 * That is what makes a code trustworthy — cost comes from loyalty/config,
 * never from the client, and the points are actually deducted.
 *
 * customers/{phone}/loyalty gains `pointsSpent`; spendable balance is
 * lifetimePoints - pointsSpent (tiers stay on lifetime, so spending never
 * demotes anyone).
 */
const crypto = require('crypto');

function canAfford(lifetimePoints, pointsSpent, cost) {
    const c = Number(cost);
    if (!Number.isFinite(c) || c <= 0) return false;
    return (Number(lifetimePoints) || 0) - (Number(pointsSpent) || 0) >= c;
}

function initRedeemListener({ db, resolvePath, OUTLET }) {
    const qRef = db.ref(resolvePath('bot/redeemQueue', OUTLET));
    qRef.off('child_added');
    qRef.on('child_added', async (snap) => {
        const req = snap.val() || {};
        const key = String(snap.key || '');
        const phone = String(req.phone || '');
        try {
            if (!/^[6-9][0-9]{9}$/.test(phone) || !key) throw new Error('bad request');
            const cfg = (await db.ref(resolvePath('loyalty/config', OUTLET)).once('value')).val() || {};
            const reward = (cfg.rewards || []).find(r => r && r.id === req.rewardId);
            if (!reward) throw new Error('unknown reward');
            const cost = Number(reward.cost);
            if (!Number.isFinite(cost) || cost <= 0) throw new Error('invalid cost');

            const loyRef = db.ref(resolvePath(`customers/${phone}/loyalty`, OUTLET));
            // RTDB hands the first transaction attempt `null` even when the node
            // exists (cold transaction queue), and returning undefined aborts.
            // Seed it from a read so a missing record is the only abort case.
            const base = (await loyRef.once('value')).val();
            const tx = await loyRef.transaction((cur) => {
                const node = cur || base;
                if (!node) return;
                if (!canAfford(node.lifetimePoints, node.pointsSpent, cost)) return;
                node.pointsSpent = (Number(node.pointsSpent) || 0) + cost;
                return node;
            });
            if (!tx.committed) throw new Error('insufficient points');

            const code = 'LOYAL' + crypto.randomInt(100000, 1000000);
            await db.ref(resolvePath(`customers/${phone}/rewards/${key}`, OUTLET)).set({
                rewardId: reward.id,
                label: reward.label || reward.id,
                cost,
                code,
                status: 'active',
                redeemedAt: Date.now(),
                outlet: OUTLET
            });
            console.log(`[Redeem] ${phone} redeemed ${reward.id} (-${cost} pts) code ${code}`);
        } catch (e) {
            console.warn(`[Redeem] rejected ${key}: ${e.message}`);
        } finally {
            snap.ref.remove().catch(() => {});
        }
    });
    console.log(`[Bot] Redeem listener started on bot/redeemQueue`);
}

module.exports = { canAfford, initRedeemListener };
