/**
 * BOT Promotional Campaigns — thin adapter over the ONE shared runner.
 *
 * Every rule, gate, pacing decision, consent check, token charge and the 30-day
 * expiry sweep lives in the socket-free `./promotions-engine` +
 * `./promotions-rules` pair, which Cloud Functions vendors verbatim. This file
 * only binds the bot's socket, RTDB handle and store/customer readers to that
 * engine, so the bot and the cloud sweep can never drift.
 *
 * The bot used to carry a second, 400-line copy of the campaign loop here. It was
 * deleted in batch 23q: a duplicate send path is how `totalSent` got zeroed on
 * resume and how a paused campaign could be walked past the consent gate.
 */

const {
    isJidFrozen, isMetaTransport, isSocketDead, OutboundTracker,
} = require('./utils');
const { db, resolvePath, billingPath } = require('./firebase');
const { createPromotionsEngine } = require('./promotions-engine');

const outboundTracker = new OutboundTracker(db, resolvePath);

// A slice returns `nextSliceAt` = the 60-120 s batch pause as a timestamp. The
// bot loops in-process (it is long-lived), so it simply waits that long; a wait
// longer than this is a quiet-hours deferral and is left to the resume sweep, so
// one campaign cannot hold the process for eight hours.
const MAX_INLINE_WAIT_MS = 5 * 60 * 1000;
const MAX_SLICES = 40;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** Socket-shaped transport for the shared send path (same object the cloud uses). */
function transportFor(sock) {
    if (!sock || typeof sock.sendMessage !== 'function') return null;
    return {
        isMeta: isMetaTransport(sock),
        // sendTemplate is optional on a Baileys socket; the engine falls back to
        // text/image when it is missing, which is exactly the old behaviour.
        sendTemplate: typeof sock.sendTemplate === 'function'
            ? (jid, payload) => sock.sendTemplate(jid, payload)
            : undefined,
        sendMessage: (jid, content, opts) => sock.sendMessage(jid, content, opts),
    };
}

/**
 * One engine per invocation, bound to the current socket. Cloud Functions builds
 * the same object in `functions/src/shared/promotions/factory.ts`.
 */
function makeEngine(sock, ctx) {
    const OUTLET = (ctx && ctx.OUTLET) || 'pizza';
    const getData = (ctx && ctx.getData) || (async () => null);
    const cryptoErrors = Number(ctx && ctx.cryptoErrorCount) || 0;
    return createPromotionsEngine({
        db,
        resolvePath,
        billingPath,
        outlet: OUTLET,
        transport: transportFor(sock),
        getStore: () => getData('settings/Store', OUTLET),
        getCustomer: (phone) => getData(`customers/${phone}`, OUTLET),
        getFirstLinkedAt: async () => {
            const pair = await getData('bot/pair', OUTLET);
            return Number(pair && pair.firstLinkedAt) || 0;
        },
        isFrozen: (jid) => isJidFrozen(jid),
        // A Baileys socket can be dead (reconnect pending) or thrash on crypto
        // errors; an official-API transport has no socket to lose, so only the
        // crypto counter can degrade it. (The old inline loop called
        // `isSocketDead()` unconditionally, which is always true for a meta
        // transport and would pause every campaign before its first send.)
        isDegraded: () => {
            if (!isMetaTransport(sock) && isSocketDead(sock)) return true;
            return cryptoErrors > 100;
        },
        onTrack: () => outboundTracker.trackSend(OUTLET, 'promo'),
        log: console,
    });
}

/**
 * Run (or resume) a campaign to completion, one bounded slice at a time.
 * Kept as an in-process loop so the bot's behaviour is unchanged; the cloud
 * sweep re-enters the SAME `runSlice()` on its next minute tick instead.
 */
async function runPromotionCampaign(sock, cmd, ctx) {
    const campaignId = cmd && cmd.campaignId;
    if (!campaignId) {
        console.warn('[Promo] Invalid campaign command: missing campaignId');
        return;
    }
    const engine = makeEngine(sock, ctx);
    for (let i = 0; i < MAX_SLICES; i++) {
        const res = await engine.runSlice(cmd);
        if (!res || !res.continue) {
            if (res && res.status === 'waiting' && res.reason === 'lease-held') {
                console.warn(`[Promo] Campaign ${campaignId} waiting: lease held by another campaign`);
            }
            return res;
        }
        const waitMs = Number(res.nextSliceAt || 0) - Date.now();
        if (waitMs > MAX_INLINE_WAIT_MS) {
            // Quiet hours / a long batch pause: the heartbeat sweep resumes it,
            // so the process is not parked for hours holding a lease.
            console.log(`[Promo] Campaign ${campaignId} deferred for ${Math.round(waitMs / 60000)} min`);
            return res;
        }
        if (waitMs > 0) await sleep(waitMs);
    }
    console.warn(`[Promo] Campaign ${campaignId} still running after ${MAX_SLICES} slices — leaving it to the sweep`);
}

/** Heartbeat: pick up campaigns the previous process left mid-flight. */
async function resumeStuckPromotions(sock, ctx) {
    const OUTLET = (ctx && ctx.OUTLET) || 'pizza';
    try {
        const snap = await db.ref(resolvePath('bot/promotions/campaigns', OUTLET))
            .orderByChild('status').equalTo('running').once('value');
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) return;
        for (const id of Object.keys(snap.val() || {})) {
            console.log(`[Promo] Resuming campaign ${id}`);
            runPromotionCampaign(sock, { campaignId: id }, ctx)
                .catch((err) => console.error(`[Promo] Resume error for ${id}:`, err && err.message));
        }
    } catch (e) {
        console.error('[Promo] resumeStuckPromotions error:', e.message);
    }
}

/**
 * Heartbeat: start campaigns whose scheduled time has come.
 * `startAt(1)` is load-bearing — an `orderByChild` query with only `endAt()`
 * also returns children that lack `runAt` (null sorts first), which made every
 * heartbeat download the whole campaigns node, inline media and all.
 */
async function pickupScheduledPromotions(sock, ctx) {
    const OUTLET = (ctx && ctx.OUTLET) || 'pizza';
    try {
        const snap = await db.ref(resolvePath('bot/promotions/campaigns', OUTLET))
            .orderByChild('runAt').startAt(1).endAt(Date.now()).once('value');
        if (!snap || typeof snap.exists !== 'function' || !snap.exists()) return;
        for (const [id, c] of Object.entries(snap.val() || {})) {
            if (!c || c.status !== 'scheduled') continue;
            // The engine decides due / still-waiting / missed-window, so a
            // campaign picked up a second late is not raced by two callers.
            runPromotionCampaign(sock, { campaignId: id }, ctx)
                .catch((err) => console.error(`[Promo] Scheduled start error for ${id}:`, err && err.message));
        }
    } catch (e) {
        console.error('[Promo] pickupScheduledPromotions error:', e.message);
    }
}

/** 30-day sweep of logs + terminal campaigns (also strips dead inline media). */
async function expireOldPromoLogs(OUTLET, ignoredDb) {
    try {
        await makeEngine(null, { OUTLET }).expireOldPromoLogs();
    } catch (e) {
        console.error('[Promo] expireOldPromoLogs error:', e.message);
    }
}

/**
 * The consent rule, exported so it stays testable (unit: bot/tests/unit.test.js;
 * live matrix in the 2026-11-03 V2 bot-review E2E). The engine's `promoConsent`
 * is the same rule over injected reads; this one takes a db so tests can drive
 * it directly. Keep them in lockstep.
 */
async function hasPromoConsent(phone, OUTLET, db) {
    try {
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
        const [snap, appSnap] = await Promise.all([
            db.ref(resolvePath(`customers/${cleanPhone}/promotionalConsent`, OUTLET)).once('value'),
            db.ref(resolvePath(`customers/${cleanPhone}/app/consent/offers`, OUTLET)).once('value'),
        ]);
        // The customer's own "Offers" switch in the restaurant app wins both ways:
        // switched off = never message (even if an order once flagged consent);
        // switched on = allowed.
        if (appSnap.val() === false) return false;
        return snap.val() === true || appSnap.val() === true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    runPromotionCampaign, resumeStuckPromotions, pickupScheduledPromotions, expireOldPromoLogs,
    hasPromoConsent,
};
