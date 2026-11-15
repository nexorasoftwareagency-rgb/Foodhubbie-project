/**
 * Loyalty redemption (server-authoritative, device-bound).
 *
 * The menu app cannot write redemption records: it pushes a request to
 * bot/redeemQueue and the server (admin SDK, rules bypass) is the only writer —
 * that is the WhatsApp bot, or the Cloud Functions trigger when the loyalty
 * relay flag is on (batch 23g). One shared claim keeps the two from ever
 * double-spending a request.
 * That is what makes a code trustworthy — cost comes from loyalty/config,
 * never from the client, and the points are actually deducted.
 *
 * Proof of ownership: the request carries the device's anonymous auth uid
 * (`appUid`). The rules only accept a write when auth.uid == appUid AND
 * customers/{phone}/devices/{appUid} exists (the same first-phone-wins binding
 * that protects the customer's orders), so typing someone's phone number is
 * never enough. Redemption is immediate — no WhatsApp OTP, no code entry in
 * the app; the reward shows up at checkout as a one-tap tender.
 *
 * customers/{phone}/loyalty gains `pointsSpent`; spendable balance is
 * lifetimePoints - pointsSpent (tiers stay on lifetime, so spending never
 * demotes anyone). Points lapse after `expiryDays` of inactivity (0 = never).
 */
const crypto = require('crypto');

const DAY_MS = 86400000;

function canAfford(lifetimePoints, pointsSpent, cost) {
    const c = Number(cost);
    if (!Number.isFinite(c) || c <= 0) return false;
    return (Number(lifetimePoints) || 0) - (Number(pointsSpent) || 0) >= c;
}

// Inactivity expiry: true when the last paid order is older than expiryDays.
// expiryDays 0/absent = points never lapse. No lastOrderAt = nothing to judge.
function pointsLapsed(lastOrderAt, expiryDays, now = Date.now()) {
    const d = Number(expiryDays);
    const last = Number(lastOrderAt);
    if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(last) || last <= 0) return false;
    return now - last > d * DAY_MS;
}

// Batch 23g: the queue handler is SOCKET-FREE and shared with the Cloud
// Functions trigger (`onRedeemRequest`), exactly like the order finalizer.
// At-most-once: a claim under bot/redeemClaims/{queueKey} is taken with a
// transaction before any points move, so the bot and a Function that both see
// the same request can never deduct twice or mint two codes. A claim older than
// CLAIM_TTL_MS may be taken over, so a crashed run cannot wedge the queue.
const CLAIM_TTL_MS = 5 * 60 * 1000;

async function redeemRewardRequest({ db, resolvePath, OUTLET, key, req, owner = 'bot' }) {
    const queueRef = db.ref(resolvePath('bot/redeemQueue', OUTLET));
    const claimRef = db.ref(resolvePath(`bot/redeemClaims/${String(key)}`, OUTLET));
    const rewardRef = (phone, rkey) => db.ref(resolvePath(`customers/${phone}/rewards/${rkey}`, OUTLET));

    async function reject(phone, reason) {
        if (!key) return;
        if (!/^[6-9][0-9]{9}$/.test(phone)) { await queueRef.child(key).remove().catch(() => {}); return; }
        await rewardRef(phone, key).set({ status: 'rejected', reason, redeemedAt: Date.now(), outlet: OUTLET }).catch(() => {});
        await queueRef.child(key).remove().catch(() => {});
    }

    const phone = String((req && req.phone) || '');
    try {
        if (!/^[6-9][0-9]{9}$/.test(phone) || !key) throw new Error('bad request');
        const appUid = String(req.appUid || '').trim();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(appUid)) throw new Error('device not linked');

        // Claim once, whichever writer gets here first (cold-tx seeded).
        const seed = ((await claimRef.once('value').catch(() => null)) || {}).val();
        const now0 = Date.now();
        const claim = await claimRef.transaction((cur) => {
            const c = cur || seed;
            if (c && now0 - Number(c.at || 0) < CLAIM_TTL_MS) return;   // held
            return { at: now0, by: owner };
        }).catch(() => null);
        if (!claim || !claim.committed) return { ok: false, skipped: 'claimed' };

        const device = await db.ref(resolvePath(`customers/${phone}/devices/${appUid}`, OUTLET)).once('value');
        if (!device.exists()) throw new Error('device not linked');

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
        if (!base) throw new Error('insufficient points');
        if (pointsLapsed(base.lastOrderAt, cfg.expiryDays)) throw new Error('points expired');
        if (!canAfford(base.lifetimePoints, base.pointsSpent, cost)) throw new Error('insufficient points');

        const tx = await loyRef.transaction((cur) => {
            const node = cur || base;
            if (!node) return;
            if (!canAfford(node.lifetimePoints, node.pointsSpent, cost)) return;
            node.pointsSpent = (Number(node.pointsSpent) || 0) + cost;
            return node;
        });
        if (!tx.committed) throw new Error('insufficient points');

        const code = 'LOYAL' + crypto.randomInt(100000, 1000000);
        await rewardRef(phone, key).set({
            rewardId: reward.id,
            label: reward.label || reward.id,
            cost,
            code,
            status: 'active',
            redeemedAt: Date.now(),
            outlet: OUTLET
        });
        await queueRef.child(key).remove().catch(() => {});
        console.log(`[Redeem] ${phone} redeemed ${reward.id} (-${cost} pts) code ${code} (${owner})`);
        return { ok: true, code, cost };
    } catch (e) {
        console.warn(`[Redeem] rejected ${key}: ${e.message}`);
        await reject(phone, e.message);
        return { ok: false, error: e.message };
    }
}

function initRedeemListener({ db, resolvePath, OUTLET }) {
    const qRef = db.ref(resolvePath('bot/redeemQueue', OUTLET));
    qRef.off('child_added');
    qRef.off('child_changed');

    qRef.on('child_added', (snap) => {
        redeemRewardRequest({ db, resolvePath, OUTLET, key: String(snap.key || ''), req: snap.val() || {}, owner: 'bot' })
            .catch(e => console.warn('[Redeem] handler error:', e.message));
    });
    console.log(`[Bot] Redeem listener started on bot/redeemQueue`);
}

module.exports = { canAfford, pointsLapsed, redeemRewardRequest, initRedeemListener };

