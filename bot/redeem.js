/**
 * Loyalty redemption (server-authoritative, WhatsApp-OTP verified).
 *
 * The menu app cannot write redemption records: it pushes a request to
 * bot/redeemQueue and the bot (admin SDK, rules bypass) is the only writer.
 * That is what makes a code trustworthy — cost comes from loyalty/config,
 * never from the client, and the points are actually deducted.
 *
 * OTP step: the request alone is NOT enough (anyone can type anyone's phone).
 * The bot first sends a 6-digit code to that phone on WhatsApp and parks the
 * request (rewards/{key}.status = 'otp_required'). Only a request that comes
 * back carrying the right code (3 tries, 10 minutes) is redeemed.
 *
 * customers/{phone}/loyalty gains `pointsSpent`; spendable balance is
 * lifetimePoints - pointsSpent (tiers stay on lifetime, so spending never
 * demotes anyone). Points lapse after `expiryDays` of inactivity (0 = never).
 */
const crypto = require('crypto');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_TRIES = 3;
const OTP_MAX_SENDS = 3;          // per phone per TTL window
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

function hashOtp(key, otp) {
    return crypto.createHash('sha256').update(`${key}:${otp}`).digest('hex');
}

function initRedeemListener({ db, resolvePath, OUTLET, sendText }) {
    const qRef = db.ref(resolvePath('bot/redeemQueue', OUTLET));
    const sends = new Map(); // phone -> [timestamps]
    qRef.off('child_added');
    qRef.off('child_changed');

    const rewardRef = (phone, key) => db.ref(resolvePath(`customers/${phone}/rewards/${key}`, OUTLET));
    const otpRef = (key) => db.ref(resolvePath(`bot/redeemOtp/${key}`, OUTLET));

    async function reject(phone, key, reason) {
        if (!key) return;
        if (!/^[6-9][0-9]{9}$/.test(phone)) { await qRef.child(key).remove().catch(() => {}); return; }
        await rewardRef(phone, key).set({ status: 'rejected', reason, redeemedAt: Date.now(), outlet: OUTLET }).catch(() => {});
        await otpRef(key).remove().catch(() => {});
        await qRef.child(key).remove().catch(() => {});
    }

    async function handle(snap) {
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
            if (!base) throw new Error('insufficient points');
            if (pointsLapsed(base.lastOrderAt, cfg.expiryDays)) throw new Error('points expired');
            if (!canAfford(base.lifetimePoints, base.pointsSpent, cost)) throw new Error('insufficient points');

            // ── Step 1: no code yet → send one and park the request ──
            if (!req.otp) {
                if (typeof sendText !== 'function') throw new Error('otp unavailable');
                const now = Date.now();
                const recent = (sends.get(phone) || []).filter(t => now - t < OTP_TTL_MS);
                if (recent.length >= OTP_MAX_SENDS) throw new Error('too many codes');
                const otp = String(crypto.randomInt(100000, 1000000));
                await otpRef(key).set({ hash: hashOtp(key, otp), phone, expiresAt: now + OTP_TTL_MS, tries: 0 });
                const sent = await sendText(phone, `Your ${reward.label || 'reward'} redemption code is ${otp}. It is valid for 10 minutes. If you did not ask for this, ignore this message.`);
                if (sent === false) { await otpRef(key).remove().catch(() => {}); throw new Error('otp unavailable'); }
                recent.push(now); sends.set(phone, recent);
                await rewardRef(phone, key).set({ status: 'otp_required', rewardId: reward.id, redeemedAt: now, outlet: OUTLET });
                return; // request stays queued until the code comes back
            }

            // ── Step 2: verify the code ──
            const rec = (await otpRef(key).once('value')).val();
            if (!rec || rec.phone !== phone || Date.now() > rec.expiresAt) throw new Error('code expired');
            if ((rec.tries || 0) >= OTP_MAX_TRIES) throw new Error('too many attempts');
            const given = Buffer.from(hashOtp(key, String(req.otp)));
            const want = Buffer.from(rec.hash);
            if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
                const tries = (rec.tries || 0) + 1;
                await otpRef(key).update({ tries });
                if (tries >= OTP_MAX_TRIES) throw new Error('too many attempts');
                // wrong code: clear it so the customer can try again
                await qRef.child(key).update({ otp: null });
                await rewardRef(phone, key).update({ status: 'otp_required', lastError: 'wrong code', wrongTries: tries });
                return;
            }

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
            await otpRef(key).remove().catch(() => {});
            await qRef.child(key).remove().catch(() => {});
            console.log(`[Redeem] ${phone} redeemed ${reward.id} (-${cost} pts) code ${code}`);
        } catch (e) {
            console.warn(`[Redeem] rejected ${key}: ${e.message}`);
            await reject(phone, key, e.message);
        }
    }

    qRef.on('child_added', handle);
    // Customer re-submits the same request with `otp` filled in.
    qRef.on('child_changed', (snap) => { if ((snap.val() || {}).otp) return handle(snap); });
    console.log(`[Bot] Redeem listener started on bot/redeemQueue`);
}

module.exports = { canAfford, pointsLapsed, hashOtp, initRedeemListener };
