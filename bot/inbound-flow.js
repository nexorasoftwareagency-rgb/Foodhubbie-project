'use strict';
/**
 * bot/inbound-flow.js — the ONE socket-free inbound WhatsApp handler.
 *
 * Batch 23b/23f/23g pattern: extract the logic, inject its dependencies, and run
 * literally the same bytes from the WhatsApp bot and from Cloud Functions.
 * `createInboundFlow()` touches nothing ambient — no Baileys, no Redis, no
 * `bot/firebase`, no `bot/index.js` — so `functions/scripts/copy-vendor.cjs` can
 * vendor it into the Functions bundle.
 *
 * WHAT THIS REPLACES
 *   - `bot/index.js` `messages.upsert` handler (state machine at 2632-2692 plus
 *     the opt-out / rejection / freeze blocks above it) on the bot side.
 *   - `functions/src/taskqueue/processInboundMessage.ts` in the cloud. That file
 *     is a DIFFERENT PRODUCT (text menu, `order <dish>`, text cart, COD/UPI) and
 *     must never ship: it cannot charge GST, apply the delivery slab fee, redeem
 *     a reward or deduct stock. This module keeps the real product:
 *
 *       START -> AWAITING_ORDER_INTENT -> WEBVIEW
 *
 *     greeting image + Hinglish welcome (no CTA on spec) -> optional menu image +
 *     interactive "Order Now" URL button -> `delivery.html` with a per-phone
 *     webview token, where the customer gets the real cart, GST, delivery fee,
 *     coupons and reward tender.
 *
 * STATE (RTDB, survives cold starts — the old bot kept it in Redis and the
 * strike tracker in `bot/utils.js` memory, neither of which exists on Functions)
 *   bot/chatState/{phone10}                  session + webview token + strikes
 *   bot/processed/{YYYY-MM-DD}/{safeMsgId}   inbound dedupe (3-day window)
 *   bot/promotions/optout/{phone10}          promo opt-out / opt-in (shared)
 *   webviewTokens/{token}                    { phone, createdAt, used }
 *   profiles/{digits}                        name/address for the greeting
 *   outlets/{oid}/walletGate + settings/*    read per message (60 s cache)
 *
 * NOT PORTED, DELIBERATELY
 *   - `MENU_BROWSING` / `CART_REVIEW` / `CHECKOUT` / `PAYMENT` (text ordering).
 *   - Admin `!report` / `!status` / `!ping` (they need the bot process).
 *   - Baileys jitter, Sharp re-encoding, base64 images — since batch 15 every
 *     image is a Storage https URL, which is exactly what the Meta API takes.
 *
 * Shape of the message the caller passes (each runner normalizes its own wire
 * format; the Functions trigger maps Meta's button/list replies into `text`):
 *   { jid | from, id, text, pushName, fromMe? }
 */

const crypto = require('crypto');
const {
    formatJid, maskJid, isBlockedJid, isShopOpen, walletGateBlocks,
} = require('./utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WEBVIEW_TOKEN_REUSE_MS = 30 * 60 * 1000;
const FREEZE_STRIKES = 3;
const FREEZE_MS = 30 * 60 * 1000;
const STRIKE_CONTINUOUS_MS = 15 * 60 * 1000;
const MSG_LIMIT_PER_MIN = 40;
const PROC_DEDUPE_DAYS = 3;
const SETTINGS_TTL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Copy (the live strings, with the emoji repaired — the repo copies carry
// mojibake from a PowerShell round-trip, so the live bot currently renders
// replacement characters instead of these)
// ---------------------------------------------------------------------------
const WALLET_PAUSED_TEXT = '⏳ *Ordering is temporarily unavailable*\n\nAbhi naye orders nahi le pa rahe hain. Kripya thodi der baad dobara try karein. 🙏';
const CTA_DEFAULT = '👇 *niche link pe Click karke abhi order Karen* 👇';
const CTA_NUDGE = '💡 *Tap below to browse & order!*';
const TRACK_TEXT = '📋 Tap the menu link above to order again. Your recent orders will show in the webview.';
const NUDGE_TEXT = '🍽️ *Khana order karne ke liye:* **Menu** ya **Order** type karein — link turant milega! 🙏';
const RESET_TEXT = '❌ *Order Reset.* Reply with any message to start again.';
const RATE_TEXT = "⚠️ *Slow down!* You're sending messages too fast. Please wait a moment before trying again.";
const OPTOUT_TEXT = "✅ You've been unsubscribed from promotional messages. Reply START to opt back in anytime.";
const OPTIN_TEXT = "🎉 Welcome back! You're re-subscribed to promotional messages.";

const RE_ORDER_INTENT = /^(menu|order)$/i;
const RE_GREETING = /^(order|menu|food|start|restart|hi+|hello+|hey+)$/i;
const RE_TRACK = /^(track|status|where)$/i;
const RE_STOP = /^(stop|unsubscribe|opt[\s-]?out)$/i;
const RE_START = /^start$/i;
const RE_REJECTION = /^(who( is)?( this| dis)?\??|what('?s| is)?( this)?\??|why( me)?\??|not interested\.?|no,?\s*thanks?\.?|wrong number\.?|leave me alone\.?|don'?t (message|text|contact) me\.?|who dis\??)$/i;
const RE_NON_CONVERSATIONAL = /@newsletter|@broadcast|@g\.us/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const digitsOf = (v) => String(v || '').replace(/[^0-9]/g, '');
const phone10Of = (v) => {
    const d = digitsOf(v);
    return d.length >= 10 ? d.slice(-10) : null;
};
/** Firebase keys cannot contain . $ # [ ] / — Meta ids are `wamid.HBg...`. */
const safeKey = (v) => String(v || '').replace(/[.#$\[\]/]/g, '_');
const istDay = (ms) => new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * @param {Object}   o
 * @param {Object}   o.db             firebase-admin Database (`.ref(path)`)
 * @param {Function} o.resolvePath    ALREADY tenant-bound: (path) => full path
 * @param {string}   o.outlet         outlet id (`pizza`)
 * @param {string}   o.businessId     business id (`roshani-pizza`)
 * @param {Object}   o.transport      sock-shaped: sendMessage/sendButton/user
 * @param {string}  [o.outletName]    display name (settings/Store.storeName)
 * @param {string}  [o.outletEmoji]
 * @param {string}  [o.webviewHost]   https://menu.foodhubbie.in
 * @param {string}  [o.botPhone]      the bot's own number (digits, no +)
 * @param {string}  [o.developerNumber]
 * @param {Function}[o.adminNumbers]  async () => string[] (override)
 * @param {Function}[o.chatLog]       async ({jid,msgId,from,text,name}) => void
 * @param {Function}[o.pace]          async (jid) => void (Baileys pacer only)
 * @param {Function}[o.now]           () => ms (tests / deterministic runs)
 * @param {Function}[o.log]           (...args) => void
 */
function createInboundFlow(o = {}) {
    const {
        db, resolvePath, outlet, businessId, transport,
        outletName = '', outletEmoji = '🍽️',
        webviewHost = 'https://menu.foodhubbie.in',
        botPhone = '', developerNumber = '',
        adminNumbers = null, chatLog = null, pace = null,
        now = () => Date.now(), log = () => {},
    } = o;

    if (!db || typeof db.ref !== 'function') throw new Error('createInboundFlow: db is required');
    if (typeof resolvePath !== 'function') throw new Error('createInboundFlow: resolvePath is required');
    if (!outlet) throw new Error('createInboundFlow: outlet is required');
    if (!businessId) throw new Error('createInboundFlow: businessId is required');
    if (!transport || typeof transport.sendMessage !== 'function') {
        throw new Error('createInboundFlow: transport.sendMessage is required');
    }

    const at = (p) => resolvePath(p);
    const statePath = (p10) => at(`bot/chatState/${p10}`);
    const displayName = () => outletName || 'Restaurant';

    // Per-process caches. A cold start just pays one extra read.
    let _settings = { at: 0, store: null, bot: null };
    let _blocked = { at: 0, set: new Set() };
    let _admins = { at: 0, list: [] };
    let _prunedDay = null;

    async function readSettings() {
        if (_settings.store && now() - _settings.at < SETTINGS_TTL_MS) return _settings;
        const [storeSnap, botSnap] = await Promise.all([
            db.ref(at('settings/Store')).once('value').catch(() => null),
            db.ref(at('settings/Bot')).once('value').catch(() => null),
        ]);
        _settings = {
            at: now(),
            store: (storeSnap && storeSnap.val()) || {},
            bot: (botSnap && botSnap.val()) || {},
        };
        return _settings;
    }

    async function getBlockedSet() {
        if (now() - _blocked.at < SETTINGS_TTL_MS) return _blocked.set;
        const snap = await db.ref(at('settings/Bot/blockedNumbers')).once('value').catch(() => null);
        const arr = snap && snap.val();
        _blocked = { at: now(), set: new Set(Array.isArray(arr) ? arr.filter(Boolean) : []) };
        return _blocked.set;
    }

    /** Promo opt-out exemption + "never strike an admin" gate. */
    async function getAdminJids() {
        if (adminNumbers) return adminNumbers();
        if (now() - _admins.at < SETTINGS_TTL_MS) return _admins.list;
        const list = [];
        try {
            const [storeSnap, deliverySnap] = await Promise.all([
                db.ref(at('settings/Store')).once('value').catch(() => null),
                db.ref(at('settings/Delivery')).once('value').catch(() => null),
            ]);
            const store = (storeSnap && storeSnap.val()) || {};
            const delivery = (deliverySnap && deliverySnap.val()) || {};
            const adminNum = store.phone || delivery.reportPhone;
            if (adminNum) { const j = formatJid(adminNum); if (j) list.push(j); }
        } catch (_) { /* admin resolution is best-effort */ }
        if (developerNumber) { const j = formatJid(developerNumber); if (j) list.push(j); }
        _admins = { at: now(), list };
        return list;
    }

    async function isAdmin(jid) {
        try {
            const admins = await getAdminJids();
            if (admins.includes(jid)) return true;
            const p10 = phone10Of(jid);
            if (!p10) return false;
            return admins.some((a) => phone10Of(a) === p10);
        } catch (_) {
            return false;
        }
    }

    // ---- dedupe -----------------------------------------------------------
    async function alreadyProcessed(msgId) {
        if (!msgId) return false;
        const key = safeKey(msgId);
        const snap = await db.ref(at(`bot/processed/${istDay(now())}/${key}`)).once('value').catch(() => null);
        return !!(snap && snap.exists() && snap.val());
    }

    async function markProcessed(msgId) {
        if (!msgId) return;
        const day = istDay(now());
        try {
            await db.ref(at(`bot/processed/${day}/${safeKey(msgId)}`)).set({ ts: now() });
            // Bound the node to PROC_DEDUPE_DAYS: drop the bucket from a few days
            // back, once per process per day. A no-op remove is a single op.
            if (_prunedDay !== day) {
                _prunedDay = day;
                const oldDay = istDay(now() - PROC_DEDUPE_DAYS * 24 * 60 * 60 * 1000);
                await db.ref(at(`bot/processed/${oldDay}`)).remove().catch(() => {});
            }
        } catch (_) { /* dedupe is best-effort */ }
    }

    // ---- session ----------------------------------------------------------
    async function loadSession(p10) {
        const snap = await db.ref(statePath(p10)).once('value').catch(() => null);
        return (snap && snap.val()) || null;
    }

    async function saveSession(p10, session) {
        const payload = { ...session, lastActivity: now(), updatedAt: new Date(now()).toISOString() };
        await db.ref(statePath(p10)).set(payload).catch((e) => log('[INBOUND] session save failed', e.message));
    }

    async function loadProfile(jid) {
        const clean = digitsOf(jid);
        if (!clean) return null;
        const snap = await db.ref(at(`profiles/${clean}`)).once('value').catch(() => null);
        return (snap && snap.val()) || null;
    }

    // ---- strikes / freeze (RTDB-backed: a cloud cold start must not reset it)
    async function isFrozen(session) {
        const until = Number(session && session.frozenUntil || 0);
        if (!until) return false;
        if (until <= now()) {
            session.frozenUntil = null;
            session.strikes = 0;
            return false;
        }
        return true;
    }

    /** Returns true when the 30-minute freeze just triggered (stay silent). */
    function recordWrongMessage(session) {
        const lastAt = Number(session.strikesAt || 0);
        let strikes = Number(session.strikes || 0);
        if (strikes && now() - lastAt > STRIKE_CONTINUOUS_MS) strikes = 0;
        strikes += 1;
        session.strikesAt = now();
        if (strikes >= FREEZE_STRIKES) {
            session.strikes = 0;
            session.frozenUntil = now() + FREEZE_MS;
            log(`[FREEZE] ${outlet} — 3 wrong messages, silent for 30 min`);
            return true;
        }
        session.strikes = strikes;
        return false;
    }

    // ---- wallet gate + webview token --------------------------------------
    async function getWalletGate() {
        try {
            const snap = await db.ref(at('walletGate')).once('value');
            return String(snap.val() || '').trim().toLowerCase() || null;
        } catch (e) {
            log('[WALLET] gate read failed', e.message);
            return null; // fail open — a DB hiccup must never take ordering down
        }
    }

    async function getOrCreateWebviewToken(p10, session) {
        const existing = session.webviewToken;
        if (existing && session.webviewTokenAt && now() - session.webviewTokenAt < WEBVIEW_TOKEN_REUSE_MS) {
            const snap = await db.ref(at(`webviewTokens/${existing}`)).once('value').catch(() => null);
            const td = snap && snap.val();
            if (td && !td.used) return existing;
        }
        // crypto, not Math.random(): this token is the customer's identity in the
        // webview (it pre-fills their phone), so it must not be guessable.
        const token = crypto.randomBytes(12).toString('hex');
        await db.ref(at(`webviewTokens/${token}`)).set({
            phone: p10,
            createdAt: new Date(now()).toISOString(),
            used: false,
        });
        session.webviewToken = token;
        session.webviewTokenAt = now();
        return token;
    }

    // ---- outbound ---------------------------------------------------------
    async function say(jid, text) {
        if (pace) await pace(jid).catch(() => {});
        return transport.sendMessage(jid, { text });
    }

    async function sendImage(jid, image, text, settings) {
        const s = settings || await readSettings();
        const contact = (s.store && s.store.phone) || (s.store && s.store.reportPhone) || '';
        const body = contact ? `${text}\n${'-'.repeat(32)}\nIf you have any Doubt Contact Admin: *${contact}*` : text;
        if (typeof image === 'string' && image.startsWith('http')) {
            try {
                if (pace) await pace(jid).catch(() => {});
                return await transport.sendMessage(jid, { image, caption: body });
            } catch (e) {
                log('[INBOUND] image send failed, text fallback:', e.message || e);
            }
        }
        return say(jid, body);
    }

    async function sendOrderCTA(jid, menuImg, ctaText, menuUrl) {
        if (typeof transport.sendButton === 'function') {
            if (pace) await pace(jid).catch(() => {});
            return transport.sendButton(jid, {
                body: ctaText,
                url: menuUrl,
                title: 'Order Now',
                headerImageUrl: typeof menuImg === 'string' && menuImg.startsWith('http') ? menuImg : undefined,
                footer: `Freshly made • ${displayName()}`,
            });
        }
        return sendImage(jid, menuImg, `${ctaText}\n${'═'.repeat(24)}\n${menuUrl}`);
    }

    /**
     * Full greeting: greeting image + Hinglish welcome. `withMenu=false` sends the
     * greeting only — a first contact must never receive the order CTA on spec.
     */
    async function sendOrderFlow(jid, pushName, session, withMenu = true) {
        if (withMenu) {
            const gate = walletGateBlocks(await getWalletGate());
            if (gate) {
                log(`[WALLET] gate=${gate} — order CTA suppressed for ${maskJid(jid)}`);
                return say(jid, WALLET_PAUSED_TEXT);
            }
        }
        const { store, bot } = await readSettings();

        let welcome = (session && session.hasProfile && session.name)
            ? `Namaste *${session.name}* ji! 👋\nAapke favorite items taiyar hain! ${outletEmoji}`
            : `Namaste *${pushName || 'ji'}* ji! 👋`;
        welcome += `\n${'═'.repeat(24)}`;
        welcome += `\n✨ *${displayName()} mein aapka swagat hai!* ${outletEmoji}`;
        welcome += `\n${'═'.repeat(24)}`;
        welcome += '\nMazedar khana, fatafat aapke darwaze tak! 🚀';
        if (!withMenu) {
            welcome += '\n\n🍽️ *Khana order karne ke liye:* *Menu* ya *Order* type karein — menu + link turant milega.';
        }
        const greetingImg = (bot && bot.greetingImage) || (store && store.bannerImage);
        await sendImage(jid, greetingImg, welcome, { store, bot });

        if (!withMenu) return;
        return resendMenuCTA(jid, session, { store, bot });
    }

    /** Menu image + "Order Now" button carrying this phone's webview token. */
    async function resendMenuCTA(jid, session, settings, ctaTextOverride) {
        const gate = walletGateBlocks(await getWalletGate());
        if (gate) {
            log(`[WALLET] gate=${gate} — order CTA suppressed for ${maskJid(jid)}`);
            return say(jid, WALLET_PAUSED_TEXT);
        }
        const s = settings && settings.store ? settings : await readSettings();
        const p10 = phone10Of(jid);
        const token = await getOrCreateWebviewToken(p10, session);
        // "Back to WhatsApp" in the webview must return the customer to THIS bot.
        // A Baileys sock carries `<phone>:<device>@s.whatsapp.net`; the Meta
        // transport's `user.id` is `meta:<phoneNumberId>` — an id, not a number —
        // so it falls back to the configured bot number (never the raw id).
        const sockPhone = (String((transport.user && transport.user.id) || '').match(/^(\d+):/) || [])[1];
        const botNum = sockPhone || digitsOf(botPhone);
        const menuUrl = `${String(webviewHost).replace(/\/$/, '')}/delivery.html` +
            `?b=${encodeURIComponent(businessId)}&o=${encodeURIComponent(outlet)}` +
            `&session=${p10}&src=wa&bot=${botNum}&token=${token}`;
        const menuImg = (s.bot && s.bot.menuImage) || (s.store && s.store.bannerImage);
        return sendOrderCTA(jid, menuImg, ctaTextOverride || CTA_DEFAULT, menuUrl);
    }

    // ---- main entry -------------------------------------------------------
    /**
     * @param {Object} message { jid|from, id, text, pushName, fromMe? }
     * @returns {Promise<{handled:boolean, reason?:string, step?:string}>}
     */
    async function handleInbound(message = {}) {
        const raw = String(message.jid || message.from || '').trim();
        if (!raw) return { handled: false, reason: 'no-sender' };
        if (message.fromMe) return { handled: false, reason: 'from-me' };

        // One guard covers every downstream path: channels, status broadcasts
        // and groups were never a product, and replying into them burns sends.
        if (RE_NON_CONVERSATIONAL.test(raw)) return { handled: false, reason: 'non-conversational' };

        const jid = formatJid(raw) || raw;
        const p10 = phone10Of(raw);
        if (!p10) return { handled: false, reason: 'bad-sender' };

        // Blocklist — silently ignore, never bounce a reply.
        const blocked = await getBlockedSet();
        if (isBlockedJid(jid, blocked) || blocked.has(p10)) {
            log(`[BLOCKED] Ignoring message from ...${p10.slice(-4)}`);
            return { handled: false, reason: 'blocked' };
        }

        const msgId = message.id ? safeKey(message.id) : '';
        if (await alreadyProcessed(msgId)) return { handled: false, reason: 'duplicate' };
        await markProcessed(msgId);

        // Read receipt + chat history (best-effort, never block the flow).
        if (typeof transport.readMessages === 'function' && message.key) {
            Promise.resolve(transport.readMessages([message.key])).catch(() => {});
        }
        const text = String(message.text || '').trim();
        const pushName = String(message.pushName || '');
        log(`[IN] ${maskJid(jid)}: "${text.slice(0, 80)}"`);
        if (chatLog) {
            Promise.resolve(chatLog({ jid, msgId: message.id || msgId, from: 'customer', text, name: pushName || undefined }))
                .catch((e) => log('[CHAT-LOG] inbound hook error:', e && e.message));
        }

        // ---- promo opt-out / opt-in / auto-rejection ----------------------
        let isAuth = false;
        try {
            isAuth = await isAdmin(jid);
            if (!isAuth && text) {
                if (RE_STOP.test(text)) {
                    await db.ref(at(`bot/promotions/optout/${p10}`)).update({ jid, optedOutAt: now() }).catch(() => {});
                    await say(jid, OPTOUT_TEXT);
                    return { handled: true, reason: 'opt-out' };
                }
                if (RE_START.test(text)) {
                    const snap = await db.ref(at(`bot/promotions/optout/${p10}`)).once('value').catch(() => null);
                    if (snap && snap.exists()) {
                        await db.ref(at(`bot/promotions/optout/${p10}`)).update({ reOptInAt: now() }).catch(() => {});
                        await say(jid, OPTIN_TEXT);
                        return { handled: true, reason: 'opt-in' };
                    }
                }
                // A first-time contact reading as confusion/rejection must not get
                // the greeting+menu+button blast — sending more promo-adjacent
                // content in reply to a rejection is what spam classifiers flag.
                if (RE_REJECTION.test(text)) {
                    const existing = await loadSession(p10);
                    if (!existing) {
                        await db.ref(at(`bot/promotions/optout/${p10}`)).update({
                            jid, optedOutAt: now(), reason: 'auto-rejection-reply',
                        }).catch(() => {});
                        await say(jid, `Maaf kijiye disturb karne ke liye — yeh ${displayName()} ka WhatsApp order line hai. Aapko aage koi message nahi bheja jayega. Jab bhi order karna ho, *START* type kar dena.`);
                        return { handled: true, reason: 'auto-rejection' };
                    }
                }
            }
        } catch (e) {
            log('[Promo] opt-out handler error:', e.message);
        }

        // ---- session ------------------------------------------------------
        let session = await loadSession(p10);
        if (await isFrozen(session || {})) {
            log(`[FREEZE] ignoring message from frozen ${maskJid(jid)}`);
            if (session) await saveSession(p10, session);
            return { handled: false, reason: 'frozen' };
        }

        if (typeof transport.sendPresenceUpdate === 'function') {
            Promise.resolve(transport.sendPresenceUpdate('composing', jid)).catch(() => {});
        }

        if (!session) {
            const profile = await loadProfile(jid);
            session = {
                step: 'START',
                pushName,
                msgCount: 0,
                lastReset: now(),
                hasProfile: !!(profile && profile.name),
                name: (profile && profile.name) || null,
                phone: p10,
                email: null,
            };
        }
        if (pushName) session.pushName = pushName;

        // ---- rate limit ---------------------------------------------------
        if (now() - Number(session.lastReset || 0) > 60000) {
            session.msgCount = 0;
            session.lastReset = now();
        }
        session.msgCount = Number(session.msgCount || 0) + 1;
        if (session.msgCount > MSG_LIMIT_PER_MIN) {
            if (session.msgCount === MSG_LIMIT_PER_MIN + 1) await say(jid, RATE_TEXT).catch(() => {});
            await saveSession(p10, session);
            return { handled: false, reason: 'rate-limited', step: session.step };
        }

        const lower = text.toLowerCase();
        if (lower === 'cancel' || lower === 'reset') {
            session.step = 'START';
            await saveSession(p10, session);
            await say(jid, RESET_TEXT);
            return { handled: true, reason: 'reset', step: 'START' };
        }

        // ---- state machine ------------------------------------------------
        let reason = 'no-op';

        if (session.step === 'START') {
            const { store } = await readSettings();
            if (store && store.shopOpenTime && store.shopCloseTime &&
                !isShopOpen(store.shopOpenTime, store.shopCloseTime, store.shopStatus)) {
                await saveSession(p10, session);
                await say(jid, `🌙 *${displayName().toUpperCase()} IS CLOSED*\n${'═'.repeat(24)}\n` +
                    `Hours: ${store.shopOpenTime || 'N/A'} - ${store.shopCloseTime || 'N/A'}\n` +
                    `${'═'.repeat(24)}\nSee you later! 👋`);
                return { handled: true, reason: 'shop-closed', step: session.step };
            }
            if (RE_ORDER_INTENT.test(text)) {
                await sendOrderFlow(jid, pushName || session.pushName, session, true);
                session.step = 'WEBVIEW';
                reason = 'menu-sent';
            } else {
                await sendOrderFlow(jid, pushName || session.pushName, session, false);
                session.step = 'AWAITING_ORDER_INTENT';
                reason = 'greeted';
            }
        } else if (session.step === 'AWAITING_ORDER_INTENT') {
            if (RE_ORDER_INTENT.test(text)) {
                session.strikes = 0;
                session.frozenUntil = null;
                await resendMenuCTA(jid, session);
                session.step = 'WEBVIEW';
                reason = 'menu-resent';
            } else if (!isAuth && recordWrongMessage(session)) {
                reason = 'frozen-now';
            } else {
                await say(jid, NUDGE_TEXT);
                reason = 'nudged';
            }
        } else if (session.step === 'WEBVIEW') {
            if (RE_GREETING.test(text)) {
                if (RE_ORDER_INTENT.test(text)) { session.strikes = 0; session.frozenUntil = null; }
                await resendMenuCTA(jid, session);
                reason = 'menu-resent';
            } else if (RE_TRACK.test(text)) {
                await say(jid, TRACK_TEXT);
                reason = 'track-hint';
            } else if (!isAuth && recordWrongMessage(session)) {
                reason = 'frozen-now';
            } else {
                await resendMenuCTA(jid, session, null, CTA_NUDGE);
                reason = 'cta-resent';
            }
        } else {
            // Unknown/legacy step (e.g. a session left in a retired text-cart
            // step) — fall back to the greeting rather than dead-ending.
            session.step = 'START';
            await sendOrderFlow(jid, pushName || session.pushName, session, false);
            session.step = 'AWAITING_ORDER_INTENT';
            reason = 'recovered';
        }

        await saveSession(p10, session);
        return { handled: true, reason, step: session.step };
    }

    return { handleInbound, phone10Of, loadSession, outlet, businessId };
}

module.exports = { createInboundFlow };

// ---------------------------------------------------------------------------
// Self-check: node bot/inbound-flow.js
// Proves the product paths against an in-memory RTDB + a recording transport.
// A SECOND flow instance shares the same DB, which is the cold-start case the
// old in-memory strike tracker could not survive.
// ---------------------------------------------------------------------------
if (require.main === module) {
    const assert = require('assert');

    function fakeDb() {
        const data = new Map();
        const snapOf = (v) => ({ exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : v) });
        const setLocal = (p, v) => {
            for (const k of [...data.keys()]) if (k === p || k.startsWith(p + '/')) data.delete(k);
            if (v !== null && v !== undefined) data.set(p, v);
        };
        return {
            data,
            ref(p) {
                return {
                    async once() { return snapOf(data.get(p)); },
                    async set(v) { setLocal(p, v); },
                    async update(v) {
                        const cur = data.get(p);
                        const base = (cur && typeof cur === 'object' && !Array.isArray(cur)) ? { ...cur } : {};
                        for (const [k, val] of Object.entries(v || {})) base[k] = val;
                        setLocal(p, base);
                    },
                    async remove() { setLocal(p, null); },
                };
            },
        };
    }

    function fakeTransport() {
        const sent = [];
        return {
            sent,
            user: { id: 'meta:1211796118690392' },
            async sendMessage(jid, content) { sent.push({ kind: 'text', jid, content }); return {}; },
            async sendButton(jid, opts) { sent.push({ kind: 'button', jid, opts }); return {}; },
            async readMessages() { },
            async sendPresenceUpdate() { },
        };
    }

    (async () => {
        const db = fakeDb();
        const resolvePath = (p) => `businesses/roshani-pizza/outlets/pizza/${p}`;
        // Seed: store settings + one greeting/menu image (Storage URLs, as live).
        db.ref(resolvePath('settings/Store')).set({ storeName: 'Roshani Pizza', phone: '9724649971', bannerImage: 'https://x/banner.jpg' });
        db.ref(resolvePath('settings/Bot')).set({ greetingImage: 'https://x/greet.jpg', menuImage: 'https://x/menu.jpg' });

        const t1 = fakeTransport();
        const flow = createInboundFlow({
            db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza',
            transport: t1, outletName: 'Roshani Pizza', botPhone: '917485095436',
            developerNumber: '9724649971', now: () => 1_800_000_000_000,
        });

        // 1. First contact: greeting only, no order CTA, no token minted.
        let r = await flow.handleInbound({ jid: '919900000001', id: 'm1', text: 'hi', pushName: 'Ravi' });
        assert.strictEqual(r.reason, 'greeted');
        assert.strictEqual(t1.sent.filter((s) => s.kind === 'button').length, 0);
        assert.ok(t1.sent.some((s) => s.kind === 'text' && s.content.image === 'https://x/greet.jpg'));
        assert.strictEqual(db.data.get(resolvePath('bot/chatState/9900000001')).step, 'AWAITING_ORDER_INTENT');

        // 2. Explicit intent → interactive button + a minted webview token.
        r = await flow.handleInbound({ jid: '919900000001', id: 'm2', text: 'menu' });
        assert.strictEqual(r.reason, 'menu-resent');
        const btn = t1.sent.find((s) => s.kind === 'button');
        assert.ok(btn, 'expected an interactive Order Now button');
        assert.ok(/^https:\/\/menu\.foodhubbie\.in\/delivery\.html\?b=roshani-pizza&o=pizza&session=9900000001&src=wa&bot=917485095436&token=[0-9a-f]{24}$/.test(btn.opts.url), btn.opts.url);
        assert.strictEqual(btn.opts.title, 'Order Now');
        const token = btn.opts.url.split('token=')[1];
        assert.strictEqual(db.data.get(resolvePath(`webviewTokens/${token}`)).phone, '9900000001');
        assert.strictEqual(db.data.get(resolvePath('bot/chatState/9900000001')).step, 'WEBVIEW');

        // 3. Token is reused within 30 min (no duplicate token node).
        await flow.handleInbound({ jid: '919900000001', id: 'm3', text: 'order' });
        const btn2 = t1.sent.filter((s) => s.kind === 'button').pop();
        assert.ok(btn2.opts.url.endsWith(token), 'token should be reused inside the 30 min window');

        // 4. Dedupe: same Meta message id twice → second is a no-op.
        const before = t1.sent.length;
        r = await flow.handleInbound({ jid: '919900000001', id: 'm3', text: 'order' });
        assert.strictEqual(r.reason, 'duplicate');
        assert.strictEqual(t1.sent.length, before);

        // 5. Wallet gate stops NEW order links but not the chat.
        db.ref(resolvePath('walletGate')).set('closed');
        const t5 = fakeTransport();
        const flow5 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t5, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        r = await flow5.handleInbound({ jid: '919900000002', id: 'm4', text: 'order' });
        assert.strictEqual(r.reason, 'menu-sent');
        assert.strictEqual(t5.sent.filter((s) => s.kind === 'button').length, 0);
        assert.ok(t5.sent.some((s) => s.content && s.content.text && s.content.text.includes('temporarily unavailable')));
        db.ref(resolvePath('walletGate')).set('');

        // 6. Shop closed: one closed message, no greeting/menu.
        const t6 = fakeTransport();
        const flow6 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t6, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        const store = db.data.get(resolvePath('settings/Store'));
        db.ref(resolvePath('settings/Store')).set({ ...store, shopOpenTime: '09:00', shopCloseTime: '10:00', shopStatus: 'FORCE_CLOSED' });
        r = await flow6.handleInbound({ jid: '919900000003', id: 'm5', text: 'hi' });
        assert.strictEqual(r.reason, 'shop-closed');
        assert.ok(t6.sent[0].content.text.includes('IS CLOSED'));
        db.ref(resolvePath('settings/Store')).set(store);

        // 7. STOP opts out (writes the shared opt-out node) and replies.
        const t7 = fakeTransport();
        const flow7 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t7, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        r = await flow7.handleInbound({ jid: '919900000004', id: 'm6', text: 'STOP' });
        assert.strictEqual(r.reason, 'opt-out');
        assert.ok(db.data.get(resolvePath('bot/promotions/optout/9900000004')).optedOutAt);
        assert.ok(t7.sent[0].content.text.includes('unsubscribed'));
        r = await flow7.handleInbound({ jid: '919900000004', id: 'm7', text: 'start' });
        assert.strictEqual(r.reason, 'opt-in');
        assert.ok(db.data.get(resolvePath('bot/promotions/optout/9900000004')).reOptInAt);

        // 8. Rejection reply from a stranger → opt-out + one calm line.
        const t8 = fakeTransport();
        const flow8 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t8, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        r = await flow8.handleInbound({ jid: '919900000005', id: 'm8', text: 'who is this?' });
        assert.strictEqual(r.reason, 'auto-rejection');
        assert.strictEqual(db.data.get(resolvePath('bot/promotions/optout/9900000005')).reason, 'auto-rejection-reply');
        assert.strictEqual(t8.sent.length, 1);

        // 9. Three wrong messages freeze the chat for 30 min — and the strike
        //    survives a cold start (new instance, same DB).
        const t9 = fakeTransport();
        const mk9 = () => createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t9, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        await mk9().handleInbound({ jid: '919900000006', id: 'w0', text: 'menu' }); // -> WEBVIEW
        await mk9().handleInbound({ jid: '919900000006', id: 'w1', text: 'blah' });
        await mk9().handleInbound({ jid: '919900000006', id: 'w2', text: 'blah' });
        r = await mk9().handleInbound({ jid: '919900000006', id: 'w3', text: 'blah' });
        assert.strictEqual(r.reason, 'frozen-now');
        const sentBeforeFreeze = t9.sent.length;
        r = await mk9().handleInbound({ jid: '919900000006', id: 'w4', text: 'blah' });
        assert.strictEqual(r.reason, 'frozen');
        assert.strictEqual(t9.sent.length, sentBeforeFreeze, 'a frozen chat must be totally silent');
        assert.ok(db.data.get(resolvePath('bot/chatState/9900000006')).frozenUntil > 1_800_000_000_000);

        // 10. Non-conversational JIDs are dropped before anything else.
        r = await flow.handleInbound({ jid: '120363000000000000@newsletter', id: 'n1', text: 'hi' });
        assert.strictEqual(r.reason, 'non-conversational');

        // 11. Rate limit: the 41st message in a minute gets one warning, then silence.
        //     `menu` (an intent word) is used so no strike/freeze interferes.
        const t11 = fakeTransport();
        let clock = 1_800_000_000_000;
        const flow11 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t11, outletName: 'Roshani Pizza', now: () => clock });
        for (let i = 0; i < 41; i++) await flow11.handleInbound({ jid: '919900000007', id: `r${i}`, text: 'menu' });
        const warn = t11.sent.filter((s) => s.content && s.content.text && s.content.text.includes('Slow down'));
        assert.strictEqual(warn.length, 1, 'exactly one slow-down warning');
        assert.strictEqual(db.data.get(resolvePath('bot/chatState/9900000007')).msgCount, 41);

        // 12. Unknown/legacy step recovers instead of dead-ending.
        const t12 = fakeTransport();
        const flow12 = createInboundFlow({ db, resolvePath, outlet: 'pizza', businessId: 'roshani-pizza', transport: t12, outletName: 'Roshani Pizza', now: () => 1_800_000_000_000 });
        db.ref(resolvePath('bot/chatState/9900000008')).set({ step: 'CHECKOUT', msgCount: 0, lastReset: 1_800_000_000_000 });
        r = await flow12.handleInbound({ jid: '919900000008', id: 'x1', text: 'hello' });
        assert.strictEqual(r.reason, 'recovered');
        assert.strictEqual(r.step, 'AWAITING_ORDER_INTENT');

        console.log('inbound-flow self-check: 12/12 OK');
    })().catch((e) => {
        console.error('inbound-flow self-check FAILED:', e && e.stack || e);
        process.exit(1);
    });
}
