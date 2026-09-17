/**
 * BOT Promotional Campaign Engine
 * Self-contained module: campaign runner, opt-out, consent, locks, logging.
 * Requires: db, OUTLET, getData, formatJid, getISTDateInfo from parent.
 */

const {
    formatJid, getISTDateInfo, randomBetween, isSocketDead, OutboundTracker
} = require('./utils');
const { db, resolvePath } = require('./firebase');
const { paceBurstSend } = require('./send-pacer');
const outboundTracker = new OutboundTracker(db, resolvePath);

const PROMO_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROMO_HEARTBEAT_EVERY = 10;
const PROMO_PAUSE_EVERY = 30;
const PROMO_PAUSE_MS = 30_000;
const PROMO_SOCKET_DEAD_GRACE_MS = 5_000;
const PROMO_SCHEDULE_MISSED_GRACE_MS = 15 * 60 * 1000;
const PROMO_WARMUP_DAILY_LIMITS = [20, 40, 60, 100, 150, 200, 250];
const PROMO_DAILY_LIMIT = 300;
const PROMO_MIN_DELAY_MS = 8000;
const PROMO_MAX_DELAY_MS = 15000;
const PROMO_BATCH_MIN_PAUSE_MS = 60000;
const PROMO_BATCH_MAX_PAUSE_MS = 120000;
const PROMO_MENU_MIN_DELAY_MS = 1500;
const PROMO_MENU_MAX_DELAY_MS = 3000;
const PROMO_FAILURE_WINDOW = 20;
const PROMO_FAILURE_MIN_SAMPLE = 10;
const PROMO_MAX_FAILURE_RATE = 0.35;

let _killSwitchCache = { value: false, ts: 0 };
let _promoEnabledCache = { value: true, ts: 0 };
let _dailyLimitCache = { value: PROMO_WARMUP_DAILY_LIMITS[0], ts: 0 };

async function sendPromotionalMessage(sock, jid, text, mediaUrl, sendStopMsg, outlet) {
    let finalText = text;
    if (sendStopMsg && !/stop/i.test(finalText)) finalText += '\n------------------------\n_Reply STOP to unsubscribe._';
    try {
        // Meta transport: promotional sends are biz-initiated — plain text is
        // dropped with 131047 outside the 24h window. Try an approved template
        // first; fall back to the legacy text/image path (delivers in-window).
        const isMetaSock = !!sock.user?.id?.startsWith('meta:');
        if (isMetaSock && typeof sock.sendTemplate === 'function') {
            try {
                await sock.sendTemplate(jid, { name: process.env.PROACTIVE_TEMPLATE || 'bot_live_update', language: process.env.PROACTIVE_LANGUAGE || 'en', body: finalText, _logChat: false });
                outboundTracker.trackSend(outlet || 'pizza', 'promo');
                return;
            } catch (e) {
                console.warn(`[Promo] Template send failed for ${jid}, text fallback: ${e.message || e}`);
            }
        }
        if (mediaUrl) {
            let payload;
            if (typeof mediaUrl === 'string' && mediaUrl.startsWith('data:image')) {
                const base64Data = mediaUrl.split(',')[1];
                payload = { image: Buffer.from(base64Data, 'base64'), caption: finalText };
            } else {
                payload = { image: { url: mediaUrl }, caption: finalText };
            }
            await sock.sendMessage(jid, payload, { _logChat: false });
        } else {
            await sock.sendMessage(jid, { text: finalText }, { _logChat: false });
        }
        outboundTracker.trackSend(outlet || 'pizza', 'promo');
    } catch (err) {
        console.error(`[Promo] sendMessage failed for ${jid}:`, err.message || err);
        throw err;
    }
}

async function personalizeTemplate(tpl, phone, campaignId, couponCode, OUTLET, getData) {
    if (!tpl) return '';
    let out = String(tpl);
    try {
        const store = await getData("settings/Store", OUTLET);
        if (store && store.storeName) out = out.replaceAll('{storeName}', store.storeName);
    } catch (_) {}
    out = out.replaceAll('{phone}', phone);
    if (couponCode) out = out.replaceAll('{couponCode}', couponCode);
    try {
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
        const cust = await getData(`customers/${cleanPhone}`, OUTLET);
        if (cust) {
            out = out.replaceAll('{name}', cust.name || 'Customer');
            const lod = cust.lastOrderDate ? new Date(cust.lastOrderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'first time';
            out = out.replaceAll('{lastOrderDate}', lod);
        } else {
            out = out.replaceAll('{name}', 'Customer');
            out = out.replaceAll('{lastOrderDate}', 'first time');
        }
    } catch (_) {
        out = out.replaceAll('{name}', 'Customer');
        out = out.replaceAll('{lastOrderDate}', 'first time');
    }
    return out;
}

async function isKillSwitchOn(OUTLET, db) {
    const now = Date.now();
    if (now - _killSwitchCache.ts < 2000) return _killSwitchCache.value;
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/killSwitch`, OUTLET)).once('value');
        _killSwitchCache = { value: snap.val() === true, ts: now };
        return _killSwitchCache.value;
    } catch (_) {
        return _killSwitchCache.value;
    }
}

async function isPromoEnabled(OUTLET, db) {
    const now = Date.now();
    if (now - _promoEnabledCache.ts < 2000) return _promoEnabledCache.value;
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/enabled`, OUTLET)).once('value');
        _promoEnabledCache = { value: snap.val() !== false, ts: now };
        return _promoEnabledCache.value;
    } catch (_) {
        return _promoEnabledCache.value;
    }
}

async function getSafeDailyLimit(OUTLET, db) {
    const now = Date.now();
    if (now - _dailyLimitCache.ts < 5 * 60 * 1000) return _dailyLimitCache.value;
    let value = PROMO_WARMUP_DAILY_LIMITS[0];
    try {
        const snap = await db.ref(resolvePath('bot/pair', OUTLET)).once('value');
        const firstLinkedAt = snap.val()?.firstLinkedAt;
        if (firstLinkedAt) {
            const daysSinceLink = Math.floor((now - firstLinkedAt) / (24 * 60 * 60 * 1000));
            value = daysSinceLink < PROMO_WARMUP_DAILY_LIMITS.length
                ? PROMO_WARMUP_DAILY_LIMITS[daysSinceLink]
                : PROMO_DAILY_LIMIT;
        }
    } catch (_) {}
    _dailyLimitCache = { value, ts: now };
    return value;
}

async function isOptedOut(phone, OUTLET, db) {
    try {
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
        const snap = await db.ref(resolvePath(`bot/promotions/optout/${cleanPhone}`, OUTLET)).once('value');
        return snap.exists();
    } catch (_) {
        return false;
    }
}

async function hasPromoConsent(phone, OUTLET, db) {
    try {
        const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
        const snap = await db.ref(resolvePath(`customers/${cleanPhone}/promotionalConsent`, OUTLET)).once('value');
        return snap.val() === true;
    } catch (_) {
        return false;
    }
}

async function sleepThroughQuietHours(quietHours, isKillSwitchOnFn) {
    if (!quietHours || quietHours.start == null || quietHours.end == null) return;
    const ist = getISTDateInfo();
    const cur = ist.hour + ist.minute / 60;
    const s = Number(quietHours.start);
    const e = Number(quietHours.end);
    let inQuiet = false;
    let minutesToWait = 0;
    if (s < e) {
        inQuiet = cur >= s && cur < e;
        minutesToWait = inQuiet ? (e - cur) * 60 : 0;
    } else {
        inQuiet = cur >= s || cur < e;
        if (cur >= s) minutesToWait = (24 - cur + e) * 60;
        else minutesToWait = (e - cur) * 60;
    }
    if (inQuiet && minutesToWait > 0) {
        console.log(`[Promo] Quiet hours active — sleeping ${minutesToWait.toFixed(0)} min`);
        let remaining = minutesToWait * 60 * 1000;
        while (remaining > 0) {
            const slice = Math.min(remaining, 5 * 60 * 1000);
            await new Promise(r => setTimeout(r, slice));
            remaining -= slice;
            if (await isKillSwitchOnFn()) throw new Error('kill-switch');
        }
    }
}

async function sendWithRetry(sock, jid, text, mediaUrl, maxRetries, sendStopMsg, outlet) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sendPromotionalMessage(sock, jid, text, mediaUrl, sendStopMsg, outlet);
            return { ok: true, attempts: attempt };
        } catch (err) {
            lastErr = err;
            console.warn(`[Promo] Attempt ${attempt}/${maxRetries} failed for ${jid}: ${err.message || err}`);
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 5000));
        }
    }
    return { ok: false, error: lastErr?.message || 'unknown', attempts: maxRetries };
}

async function acquirePromoLock(campaignId, OUTLET, db) {
    try {
        const ref = db.ref(resolvePath(`bot/promotions/lock`, OUTLET));
        const tx = await ref.transaction(c => {
            if (c && c.campaignId && c.campaignId !== campaignId) return c;
            return { campaignId, acquiredAt: Date.now() };
        });
        return tx.committed;
    } catch (_) {
        return false;
    }
}

async function releasePromoLock(OUTLET, db) {
    try { await db.ref(resolvePath(`bot/promotions/lock`, OUTLET)).remove(); } catch (_) {}
}

async function logPromoResult(campaignId, phone, jid, result, couponCode, OUTLET, db) {
    try {
        await db.ref(resolvePath(`bot/promotions/logs/${campaignId}/${phone}`, OUTLET)).set({
            jid, status: result.ok ? 'sent' : 'failed', sentAt: Date.now(), error: result.error || null, couponCode: couponCode || null
        });
    } catch (e) {
        console.error(`[Promo] Failed to write log for ${phone}:`, e.message);
    }
}

async function logPromoSkip(campaignId, phone, reason, OUTLET, db) {
    try {
        await db.ref(resolvePath(`bot/promotions/logs/${campaignId}/${phone}`, OUTLET)).set({
            status: 'skipped', sentAt: Date.now(), reason
        });
    } catch (_) {}
}

async function runPromotionCampaign(sock, cmd, ctx) {
    const { OUTLET, db, getData, cryptoErrorCount } = ctx;
    const { campaignId, template, mediaUrl, recipients = [], quietHours, requestedBy, greeting = false, menuText = null, menuImageUrl = null, sendStopMsg = true, isTest = false } = cmd;
    if (!campaignId || !Array.isArray(recipients) || recipients.length === 0) {
        console.warn(`[Promo] Invalid campaign command: ${campaignId}`);
        return;
    }
    const list = recipients.slice(0, PROMO_DAILY_LIMIT);
    const recentResults = [];

    console.log(`[Promo] ▶️ Campaign ${campaignId} starting/resuming (${list.length} recipients, fixed safe pacing)`);

    try {
        await db.ref('logs/audit').push({
            action: 'PROMO_START', campaignId, by: requestedBy || 'admin', timestamp: Date.now()
        });
    } catch (_) {}

    await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({
        status: 'running', startedAt: Date.now(), totalSent: 0, totalFailed: 0
    });

    if (!await acquirePromoLock(campaignId, OUTLET, db)) {
        console.warn(`[Promo] Lock not acquired — another campaign is running. Aborting ${campaignId}.`);
        await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'aborted', reason: 'lock-conflict' });
        return;
    }

    let startIndex = 0;
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}/currentIndex`, OUTLET)).once('value');
        startIndex = Number(snap.val() || 0);
    } catch (_) {}
    if (startIndex >= list.length) {
        console.log(`[Promo] Campaign ${campaignId} already complete.`);
        await releasePromoLock(OUTLET, db);
        return;
    }

    const todayStr = getISTDateInfo().dateStr;
    let dailySentToday = 0;
    let safeDailyLimit = await getSafeDailyLimit(OUTLET, db);
    try {
        const dailySnap = await db.ref(resolvePath(`bot/promotions/dailyCount/${todayStr}`, OUTLET)).once('value');
        dailySentToday = Number(dailySnap.val() || 0);
        console.log(`[Promo] Daily promo count today: ${dailySentToday}/${safeDailyLimit}`);
    } catch (_) {}

    let sent = 0, failed = 0;

    try {
        for (let i = startIndex; i < list.length; i++) {
            if (!await isPromoEnabled(OUTLET, db)) {
                console.warn(`[Promo] Promotional sending is OFF (dashboard toggle). Pausing ${campaignId}.`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'paused', pauseReason: 'promo-disabled' });
                return;
            }

            if (await isKillSwitchOn(OUTLET, db)) {
                console.warn(`[Promo] Kill-switch engaged. Pausing ${campaignId}.`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'paused', pauseReason: 'kill-switch' });
                return;
            }

            try { await sleepThroughQuietHours(quietHours, () => isKillSwitchOn(OUTLET, db)); } catch (e) { if (e.message === 'kill-switch') return; }

            if (isSocketDead(sock) || cryptoErrorCount > 100) {
                console.warn(`[Promo] Socket/session degraded. Pausing ${campaignId} (will resume on reconnect).`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'paused', pauseReason: 'session-degraded', currentIndex: i });
                return;
            }

            if (i % 25 === 0 && !await acquirePromoLock(campaignId, OUTLET, db)) {
                console.warn(`[Promo] Lock lost mid-campaign. Pausing.`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'paused', pauseReason: 'lock-lost', currentIndex: i });
                return;
            }

            if (!isTest && dailySentToday >= safeDailyLimit) {
                console.log(`[Promo] Daily limit (${safeDailyLimit}) reached. Pausing ${campaignId}.`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'paused', pauseReason: 'daily-limit', currentIndex: i, dailyLimitApplied: safeDailyLimit });
                return;
            }

            const phone = list[i];
            const jid = formatJid(phone);
            if (!jid) { await logPromoSkip(campaignId, phone, 'invalid-jid', OUTLET, db); failed++; continue; }
            if (!isTest && await isOptedOut(phone, OUTLET, db)) { await logPromoSkip(campaignId, phone, 'opted-out', OUTLET, db); continue; }
            if (!isTest && !await hasPromoConsent(phone, OUTLET, db)) { await logPromoSkip(campaignId, phone, 'no-consent', OUTLET, db); continue; }

            let text = await personalizeTemplate(template, phone, campaignId, null, OUTLET, getData);
            if (greeting) {
                try {
                    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
                    const cust = await getData(`customers/${cleanPhone}`, OUTLET);
                    const name = cust?.name || 'there';
                    if (!/^hi\s+/i.test(text)) text = `Hi ${name},\n------------------------\n${text}`;
                } catch (_) {
                    if (!/^hi\s+/i.test(text)) text = `Hi there,\n------------------------\n${text}`;
                }
            }

            let finalText = text;
            if (menuText && String(menuText).trim().length > 0) {
                finalText += '\n------------------------\n' + String(menuText);
            }
            let mainImage = mediaUrl;
            let extraImage = null;
            if (!mainImage && menuImageUrl) {
                mainImage = menuImageUrl;
            } else if (mainImage && menuImageUrl && menuImageUrl !== mainImage) {
                extraImage = menuImageUrl;
            }

            await paceBurstSend();
            const result = await sendWithRetry(sock, jid, finalText, mainImage, 2, sendStopMsg, OUTLET);
            await logPromoResult(campaignId, phone, jid, result, null, OUTLET, db);

            recentResults.push(result.ok);
            if (recentResults.length > PROMO_FAILURE_WINDOW) recentResults.shift();
            if (recentResults.length >= PROMO_FAILURE_MIN_SAMPLE) {
                const failRate = recentResults.filter((ok) => !ok).length / recentResults.length;
                if (failRate > PROMO_MAX_FAILURE_RATE) {
                    console.warn(`[Promo] Circuit breaker: ${(failRate * 100).toFixed(0)}% failures over last ${recentResults.length} sends. Pausing ${campaignId}.`);
                    await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({
                        status: 'paused', pauseReason: 'high-failure-rate', currentIndex: i + 1, totalSent: sent, totalFailed: failed
                    });
                    return;
                }
            }

            if (result.ok) {
                sent++;
                if (!isTest) {
                    dailySentToday++;
                    try { await db.ref(resolvePath(`bot/promotions/dailyCount/${todayStr}`, OUTLET)).set(dailySentToday); } catch (_) {}
                }
                if (extraImage) {
                    try {
                        await new Promise(r => setTimeout(r, randomBetween(PROMO_MENU_MIN_DELAY_MS, PROMO_MENU_MAX_DELAY_MS)));
                        let imgPayload;
                        if (typeof extraImage === 'string' && extraImage.startsWith('data:image')) {
                            const base64Data = extraImage.split(',')[1];
                            imgPayload = { image: Buffer.from(base64Data, 'base64') };
                        } else {
                            imgPayload = { image: { url: extraImage } };
                        }
                        await sock.sendMessage(jid, imgPayload, { _logChat: false });
                        outboundTracker.trackSend(OUTLET, 'promo');
                    } catch (e) {
                        console.warn(`[Promo] Menu image failed for ${jid}:`, e.message || e);
                    }
                }
            } else {
                failed++;
            }

            if ((i + 1) % PROMO_HEARTBEAT_EVERY === 0) {
                if (!isTest) {
                    try {
                        const fresh = await db.ref(resolvePath(`bot/promotions/dailyCount/${todayStr}`, OUTLET)).once('value');
                        dailySentToday = Number(fresh.val() || dailySentToday);
                    } catch (_) {}
                }
                await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({
                    currentIndex: i + 1, totalSent: sent, totalFailed: failed, lastHeartbeat: Date.now()
                });
            }

            if (!isTest) {
                if ((i + 1) % PROMO_PAUSE_EVERY === 0) {
                    const pauseMs = randomBetween(PROMO_BATCH_MIN_PAUSE_MS, PROMO_BATCH_MAX_PAUSE_MS);
                    console.log(`[Promo] Batch pause (${Math.round(pauseMs/1000)}s) after ${i+1} sends`);
                    await new Promise(r => setTimeout(r, pauseMs));
                } else {
                    await new Promise(r => setTimeout(r, randomBetween(PROMO_MIN_DELAY_MS, PROMO_MAX_DELAY_MS)));
                }
            }
        }

        await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({
            status: 'done', completedAt: Date.now(), currentIndex: list.length, totalSent: sent, totalFailed: failed
        });
        await db.ref('logs/audit').push({
            action: 'PROMO_DONE', campaignId, sent, failed, timestamp: Date.now()
        });
        console.log(`[Promo] ✅ Campaign ${campaignId} done. sent=${sent} failed=${failed}`);
    } catch (err) {
        console.error(`[Promo] Campaign ${campaignId} crashed:`, err);
        await db.ref(resolvePath(`bot/promotions/campaigns/${campaignId}`, OUTLET)).update({ status: 'stopped', error: err.message });
    } finally {
        await releasePromoLock(OUTLET, db);
    }
}

async function resumeStuckPromotions(sock, ctx) {
    const { OUTLET, db } = ctx;
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/campaigns`, OUTLET)).orderByChild('status').equalTo('running').once('value');
        if (!snap.exists()) return;
        const stuck = snap.val();
        for (const id of Object.keys(stuck)) {
            const c = stuck[id];
            const cmd = {
                campaignId: id,
                template: c.template,
                mediaUrl: c.mediaUrl || null,
                greeting: c.greeting === true,
                menuText: c.menuText || null,
                menuImageUrl: c.menuImageUrl || null,
                sendStopMsg: c.sendStopMsg !== false,
                recipients: c.recipients || [],
                quietHours: c.quietHours || null,
                requestedBy: c.requestedBy || 'admin-resume',
            };
            if (!Array.isArray(cmd.recipients) || cmd.recipients.length === 0) {
                console.warn(`[Promo] Cannot resume ${id}: no recipients in campaign doc`);
                await db.ref(resolvePath(`bot/promotions/campaigns/${id}`, OUTLET)).update({ status: 'stopped', reason: 'no-recipients-on-resume' });
                continue;
            }
            console.log(`[Promo] 🔄 Resuming campaign ${id} from index ${c.currentIndex || 0}`);
            runPromotionCampaign(sock, cmd, ctx).catch(err => console.error(`[Promo] Resume error for ${id}:`, err));
        }
    } catch (e) {
        console.error('[Promo] resumeStuckPromotions error:', e.message);
    }
}

async function pickupScheduledPromotions(sock, ctx) {
    const { OUTLET, db } = ctx;
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/campaigns`, OUTLET)).orderByChild('runAt').endAt(Date.now()).once('value');
        if (!snap.exists()) return;
        const due = snap.val();
        for (const id of Object.keys(due)) {
            const c = due[id];
            if (c.status !== 'scheduled') continue;
            const late = Date.now() - (c.runAt || 0);
            if (late > PROMO_SCHEDULE_MISSED_GRACE_MS) {
                await db.ref(resolvePath(`bot/promotions/campaigns/${id}`, OUTLET)).update({ status: 'expired', reason: 'missed-window', lateBy: late });
                continue;
            }
            await db.ref(resolvePath(`bot/promotions/campaigns/${id}`, OUTLET)).update({ status: 'running', startedAt: Date.now() });
            const cmdRef = db.ref(resolvePath(`bot/commands`, OUTLET)).push();
            await cmdRef.set({
                action: 'SEND_PROMOTION',
                campaignId: id,
                template: c.template,
                mediaUrl: c.mediaUrl || null,
                greeting: c.greeting === true,
                menuText: c.menuText || null,
                menuImageUrl: c.menuImageUrl || null,
                sendStopMsg: c.sendStopMsg !== false,
                recipients: c.recipients || [],
                quietHours: c.quietHours || null,
                requestedBy: c.requestedBy || 'admin'
            });
        }
    } catch (e) {
        console.error('[Promo] pickupScheduledPromotions error:', e.message);
    }
}

async function expireOldPromoLogs(OUTLET, db) {
    try {
        const snap = await db.ref(resolvePath(`bot/promotions/logs`, OUTLET)).once('value');
        if (snap.exists()) {
            const campaigns = snap.val();
            const cutoff = Date.now() - PROMO_LOG_TTL_MS;
            for (const cid of Object.keys(campaigns)) {
                const camp = campaigns[cid];
                const allOld = Object.values(camp).every(r => (r.sentAt || 0) < cutoff);
                if (allOld && Object.keys(camp).length > 0) {
                    await db.ref(resolvePath(`bot/promotions/logs/${cid}`, OUTLET)).remove();
                }
            }
        }
        // ponytail: also clean up completed/stopped/expired campaigns older than 30 days
        const campSnap = await db.ref(resolvePath(`bot/promotions/campaigns`, OUTLET)).once('value');
        if (campSnap.exists()) {
            const camps = campSnap.val();
            const cutoff = Date.now() - PROMO_LOG_TTL_MS;
            for (const [cid, c] of Object.entries(camps)) {
                const terminalStatuses = ['done', 'stopped', 'expired', 'aborted'];
                if (terminalStatuses.includes(c.status) && (c.completedAt || c.startedAt || 0) < cutoff) {
                    await db.ref(resolvePath(`bot/promotions/campaigns/${cid}`, OUTLET)).remove();
                }
            }
        }
    } catch (e) {
        console.error('[Promo] expireOldPromoLogs error:', e.message);
    }
}

module.exports = {
    sendPromotionalMessage, personalizeTemplate,
    isKillSwitchOn, isPromoEnabled, isOptedOut, hasPromoConsent,
    sleepThroughQuietHours, sendWithRetry,
    acquirePromoLock, releasePromoLock, logPromoResult, logPromoSkip,
    runPromotionCampaign, resumeStuckPromotions, pickupScheduledPromotions, expireOldPromoLogs,
    getSafeDailyLimit,
    PROMO_DAILY_LIMIT, PROMO_WARMUP_DAILY_LIMITS
};
