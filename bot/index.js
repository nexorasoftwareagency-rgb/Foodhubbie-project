/**
 * ROSHANI ERP | WHATSAPP BOT CORE v4.0
 * Multi-Outlet Instance (Restaurant-Bot)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// =============================
// OUTLET CONFIGURATION (UNIFIED CORE)
// =============================
const OUTLET = (process.env.OUTLET || 'outlet').trim();
const OUTLET_NAME = 'Hamare Restaurant';
const OUTLET_EMOJI = '🏪';
// Fixed developer number — used by promo opt-out filter and report recipients.
const DEVELOPER_NUMBER = "9724649971";

// WhatsApp delivery webview — served from the QR menu hosting target.
const WEBVIEW_DELIVERY_HOST = "https://foodhubbie-qrmenu.web.app";
const WEBVIEW_BOT_PHONE = process.env.WA_BOT_PHONE || "919724649971";

const fs = require('fs');
const path = require('path');
const redis = require('redis');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');
const pino = require('pino');
const admin = require('firebase-admin');
const { getData, setData, updateData, db, resolvePath, getUserProfile, saveUserProfile } = require('./firebase');
const { resolveOutletId, resolveBusinessIdFor, initializeOutletBusinessIndex } = require('./helpers/outlet-resolution');
const { createMetaTransport, getTransportMode, getPhoneNumberId } = require('./transport');
const discountEngine = require('./discount-engine');

// ── Suppress noisy libsignal session-state dumps ────────────────────────
// Baileys' underlying libsignal fork writes raw `console.log("Closing
// session:", SessionEntry {...})` calls directly — these bypass the pino
// `logger` option passed to makeWASocket entirely (it's not gated by any
// log level), so setting logger level to 'warn' does NOT suppress it.
// This dumps full cryptographic session/ratchet state to stdout on every
// message send — a real security concern for anything reading PM2 logs,
// not just noise. Filtering at the console.log call site is the only
// place this can actually be stopped.
const _origConsoleLog = console.log;
console.log = function (...args) {
    const first = args[0];
    if (typeof first === 'string' && /^(Closing session|Opening session|Closing open session)/i.test(first)) {
        return; // drop — this is a libsignal session-state dump, not app output
    }
    return _origConsoleLog.apply(console, args);
};

// ── Extracted modules ──────────────────────────────────────────────────────
const {
    formatJid, maskJid, formatOrderId,
    getISTDateInfo, getISTDateString, isShopOpen,
    calculateDistance, getFeeFromSlabs,
    formatCartSummary, formatOrderInvoice, getFunnyFoodJoke, getFoodFunnyProgress,
    isSocketDead, RateLimiter, isBlockedJid, OutboundTracker, BaileysSendTracker
} = require('./utils');

// ── Outbound tracker (best-effort analytics, never blocks sends) ──────
const outboundTracker = new OutboundTracker(db, resolvePath);
const baileysSendTracker = new BaileysSendTracker();
const promo = require('./promotions');
const { sendDailyReport, sendMonthlyReport, sendWeeklyReport } = require('./reports');
const riderNotify = require('./rider');
const { logChatMessage } = require('./chat-log');

let sharpLib;
try { sharpLib = require('sharp'); } catch (_) { console.warn('⚠️ sharp not installed — image format conversion disabled'); }

let redisClient;

// Admin JIDs cache — refreshed every 5 minutes to avoid per-message Firebase calls
let cachedAdminJids = null;
let cachedAdminJidsExpiry = 0;
const ADMIN_CACHE_TTL = 300000;

// Blocked numbers cache — loaded from settings/Bot/blockedNumbers
let blockedNumbers = new Set();

// ── Ban Detection ──────────────────────────────────────────────────────
let consecutiveSendFailures = 0;
const BAN_DETECT_FAILURE_THRESHOLD = 3;
const BAN_DETECT_FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 min window
let _failureWindowStart = Date.now();

let _sessionAlertSock = null;
async function _writeBanAlert(type, severity, message) {
    try {
        const alertPath = `bot/alerts/${OUTLET}`;
        const ref = db.ref(resolvePath(alertPath));
        await ref.push({ type, severity, message, createdAt: Date.now() });
        console.log(`[SESSION-INVALIDATION] ${severity === 'critical' ? '🔴' : '🟡'} ${type}: ${message}`);
        if (_sessionAlertSock) {
            try {
                const adminJids = await getCachedAdminJids();
                if (adminJids && adminJids.length > 0) {
                    const banMsg = '⚠️ *SESSION DISCONNECTED \u2014 ' + OUTLET_NAME + '* 🚨\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\u26a0\ufe0f Severity: ' + severity.toUpperCase() + '\n💬 ' + message + '\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\nRe-pair from Admin Dashboard.';
                    await Promise.all(adminJids.map(j => _sessionAlertSock.sendMessage(j, { text: banMsg }).catch(() => {})));
                    console.log('[SESSION-INVALIDATION] WhatsApp alert sent to admin');
                }
            } catch (e) { console.error('[SESSION-INVALIDATION] WhatsApp admin failed:', e.message); }
        }
    } catch (e) {
        console.error('[SESSION-INVALIDATION] Failed to write alert:', e.message);
    }
}

function _onSendSuccess() {
    consecutiveSendFailures = 0;
}

function _onSendFailure() {
    const now = Date.now();
    if (now - _failureWindowStart > BAN_DETECT_FAILURE_WINDOW_MS) {
        consecutiveSendFailures = 0;
        _failureWindowStart = now;
    }
    consecutiveSendFailures++;
    if (consecutiveSendFailures >= BAN_DETECT_FAILURE_THRESHOLD) {
        const msg = consecutiveSendFailures + ' consecutive send failures in ' + ((now - _failureWindowStart) / 60000).toFixed(1) + ' min — possible ban';
        _writeBanAlert('send_failure_spike', 'warning', msg);
        consecutiveSendFailures = 0;
        _failureWindowStart = now;
    }
}
const redisUrl = process.env.REDIS_URL || '';

if (!redisUrl) {
    redisClient = { get: async () => null, setEx: async () => {}, del: async () => {} };
    console.log('⚠️ Redis not configured — using in-memory only');
} else if (redisUrl.includes('clustercfg')) {
    // AWS ElastiCache Cluster Mode
    redisClient = redis.createCluster({
        rootNodes: [{ url: redisUrl }],
        defaults: {
            socket: {
                tls: redisUrl.startsWith('rediss://'),
                rejectUnauthorized: false // Often needed for AWS self-signed certs
            }
        }
    });
    console.log('🚀 Redis initialized in CLUSTER mode');
} else {
    // Standard Redis / Localhost
    redisClient = redis.createClient({ url: redisUrl });
    console.log('🚀 Redis initialized in STANDALONE mode');
}

// Track Redis health for degraded-mode fallbacks
let redisReady = false;

if (redisUrl) {
    redisClient.on('error', (err) => console.log('Redis Client Error', err));
    redisClient.on('ready', () => { redisReady = true; });
    redisClient.on('end', () => { redisReady = false; });
    redisClient.connect().then(async () => {
        redisReady = true;
        console.log('✅ Connected to Redis');
        // NOTE: deliberately NOT bulk-deleting status:* keys here. That was
        // tried and reverted — see restartEpoch below (Option B). Deleting
        // every processed-status entry on each connect wipes the bot's
        // memory of what it already sent for every in-flight order, so the
        // very next event for each of them re-enters handleOrderStatusUpdate
        // with a clean slate and re-sends every status from scratch. That's
        // the exact "duplicate notifications after bot restart" bug
        // restartEpoch exists to prevent — reintroducing a delete here
        // defeats it completely. If old keys ever need trimming, rely on
        // their existing STATUS_TTL expiry, not a manual sweep on connect.
    }).catch(console.error);
}

// --- GLOBAL STATE (Migrating to Redis) ---
// We keep local variables for temporary locks if needed, but primary state moves to Redis
let reportInterval = null;
let dailyReportSent = false;
let weeklyReportSent = false;
let monthlyReportSent = false;
const startupTime = Date.now();
// Option B: restartEpoch — entries from previous sessions are ignored
// instead of bulk-deleting all status:* keys (which causes duplicate messages).
const restartEpoch = startupTime;

// Track current socket to clean up on reconnect
let currentSock = null;

// =============================
// HEALTH CHECK ENDPOINT
// =============================
const http = require('http');
// port 0 → OS-assigned free port; provision always passes HEALTH_PORT explicitly
const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 0;

const healthSrv = http.createServer((req, res) => {
    if (req.url !== '/health') { res.writeHead(404); return res.end(); }
    const isConnected = currentSock && !isSocketDead(currentSock);
    const body = JSON.stringify({
        outlet: OUTLET,
        whatsapp: isConnected ? 'connected' : 'disconnected',
        redis: redisClient ? 'configured' : 'not_configured',
        uptimeSeconds: Math.floor(process.uptime()),
        cryptoErrorCount,
        timestamp: new Date().toISOString()
    });
    res.writeHead(isConnected ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(body);
});
healthSrv.listen(HEALTH_PORT, () => console.log(`🩺 Health check listening on :${healthSrv.address().port}/health`));

let firebaseListenersInitialized = false;

// Crypto/session error monitoring (for auto-healing and visibility)
let cryptoErrorCount = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_CRYPTO_ERRORS = 500; // Triggers session reset if exceeded rapidly

const SESSION_TTL = 30 * 60; // Redis TTL is in seconds (30 mins)
const STATUS_TTL = 24 * 60 * 60; // 24 hours

// Order notification rate limiter — prevents WhatsApp rate-limit bans
// during order bursts (e.g. 100 simultaneous orders at dinner rush).
const orderRateLimiter = new RateLimiter(20, 60_000); // 20 sends per minute

// In-memory dedup fallback used when Redis is offline
const localStatusCache = new Map();
const LOCAL_CACHE_TTL = 3600000; // 1 hour
// In-memory session fallback when Redis is unavailable
const localSessionCache = new Map();

// SAFEST-FIRST: per-sender processing lock. One outlet = one Node process
// owns every session for that outlet (see orchestrator), so a plain
// in-process promise chain is enough — no Redis round-trip needed, and it
// adds ZERO delay for the normal case (one message at a time per sender).
const _senderLocks = new Map();
function withSenderLock(sender, fn) {
    const previous = _senderLocks.get(sender) || Promise.resolve();
    const current = previous.then(fn, fn);
    const tracked = current.catch(() => {});
    _senderLocks.set(sender, tracked);
    tracked.finally(() => {
        if (_senderLocks.get(sender) === tracked) _senderLocks.delete(sender);
    });
    return current;
}

// ── Auto-cleanup stale session files (prevents Bad MAC errors) ──────────────
// Baileys stores Signal Protocol session files in session_data_{OUTLET}/.
// When contacts rebuild sessions (reinstall WhatsApp, new phone), old files
// become stale and cause "Bad MAC" errors. This prunes files older than 7 days.
const SESSION_DIR = path.join(__dirname, 'session_data_' + OUTLET);
const SESSION_FILE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function cleanupStaleSessions() {
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const files = fs.readdirSync(SESSION_DIR);
        const now = Date.now();
        let cleaned = 0;
        for (const file of files) {
            if (file === 'creds.json') continue; // Never delete main credentials
            const filePath = path.join(SESSION_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > SESSION_FILE_MAX_AGE) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            } catch (_) {}
        }
        if (cleaned > 0) console.log(`[SESSION] 🧹 Cleaned ${cleaned} stale session files (older than 7 days)`);
    } catch (e) {
        console.error('[SESSION] Cleanup error:', e.message);
    }
}

// Run cleanup immediately on startup
cleanupStaleSessions();

// Run cleanup every 24 hours
setInterval(cleanupStaleSessions, 24 * 60 * 60 * 1000);

// --- REDIS HELPERS ---
async function getSession(sender) {
    try {
        const data = await redisClient.get(`session:${sender}`);
        if (data) return JSON.parse(data);
    } catch (e) { }
    // Fallback to in-memory when Redis unavailable
    const cached = localSessionCache.get(sender);
    if (cached && cached._expiry > Date.now()) return cached;
    return null;
}
async function saveSession(sender, data) {
    try {
        if (data) {
            data._expiry = Date.now() + SESSION_TTL * 1000;
            localSessionCache.set(sender, data);
            await redisClient.setEx(`session:${sender}`, SESSION_TTL, JSON.stringify(data));
        } else {
            localSessionCache.delete(sender);
            await redisClient.del(`session:${sender}`);
        }
    } catch (e) { }
}

async function getProcessedStatus(id) {
    try {
        if (redisReady) {
            const raw = await redisClient.get(`status:${id}`);
            if (raw) {
                const data = JSON.parse(raw);
// Option B: ignore entries from previous bot sessions
            // If no restartEpoch (old format), treat as stale and ignore
            if (!data.restartEpoch || data.restartEpoch < restartEpoch) return null;
                return data;
            }
        }
    } catch (e) { }
    return localStatusCache.get(id) || null;
}
async function saveProcessedStatus(id, data) {
    try {
        if (data) {
            const entry = { ...data, restartEpoch };
            localStatusCache.set(id, entry);
            if (redisReady) await redisClient.setEx(`status:${id}`, STATUS_TTL, JSON.stringify(entry));
        }
    } catch (e) { }
}

// =============================
// 1. HELPERS & UTILS
// =============================
// All utility functions (formatJid, maskJid, getISTDateInfo,
// getISTDateString, isSocketDead, calculateDistance, getFeeFromSlabs,
// isShopOpen, formatCartSummary, formatOrderInvoice,
// getFunnyFoodJoke, getFoodFunnyProgress)
// are imported from ./utils above.

async function getReportRecipients() {
    const recipients = new Set();

    try {
        // Add Fixed Developer
        const devJid = formatJid(DEVELOPER_NUMBER);
        if (devJid) recipients.add(devJid);

        // Get THIS outlet's admin only
        const storeSettings = await getData("settings/Store", OUTLET) || {};
        const deliverySettings = await getData("settings/Delivery", OUTLET) || {};

        const adminNum = storeSettings.phone || deliverySettings.reportPhone;
        if (adminNum) {
            const adminJid = formatJid(adminNum);
            if (adminJid) recipients.add(adminJid);
        }

    } catch (e) {
        console.error("[Reports] Recipient Resolution Error:", e);
    }

    // Safety fallback
    if (recipients.size === 0) recipients.add(formatJid(DEVELOPER_NUMBER));
    return Array.from(recipients);
}

async function getCachedAdminJids() {
    if (cachedAdminJids && Date.now() < cachedAdminJidsExpiry) {
        return cachedAdminJids;
    }
    cachedAdminJids = await getReportRecipients();
    cachedAdminJidsExpiry = Date.now() + ADMIN_CACHE_TTL;
    return cachedAdminJids;
}

/**
 * COMMAND LISTENER
 * Monitors the 'bot/commands' node for real-time triggers from the Admin Dashboard.
 */
function initCommandListener(sock) {
    console.log(`[Bot] Command Listener Started: Listening on 'bot/commands'...`);
    const cmdRef = db.ref(resolvePath('bot/commands', OUTLET));
    cmdRef.off("child_added"); // Clear previous listeners to avoid duplicates on reconnection
    cmdRef.on("child_added", async (snap) => {
        const cmd = snap.val();
        if (!cmd) return;

        console.log(`[Bot] Command Received: ${cmd.action} (Target: ${cmd.targetDate || 'N/A'})`);

        try {
            if (cmd.action === "SEND_DAILY_REPORT") {
                await sendDailyReport(sock, { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids }, cmd.targetDate);
                console.log(`[Bot] Daily Report sent successfully for ${cmd.targetDate}`);
            } else if (cmd.action === "SEND_WEEKLY_REPORT") {
                await sendWeeklyReport(sock, { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids });
                console.log(`[Bot] Weekly Report sent successfully`);
            } else if (cmd.action === "SEND_MONTHLY_REPORT") {
                await sendMonthlyReport(sock, { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids });
                console.log(`[Bot] Monthly Report sent successfully`);
            } else if (cmd.action === "SEND_PROMOTION") {
                // Fire-and-forget — long-running, runs to completion or until paused
                promo.runPromotionCampaign(sock, cmd, { OUTLET, db, getData, cryptoErrorCount }).catch(err => {
                    console.error("[Promo] Campaign error:", err);
                });
                console.log(`[Promo] Campaign ${cmd.campaignId} dispatched`);
            } else if (cmd.action === "SEND_GENERIC_MESSAGE") {
                const jid = formatJid(cmd.phone);
                if (jid) {
                    if (sock.user?.id?.startsWith('meta:') && typeof sock.sendTemplate === 'function') {
                        try {
                            // Proactive (biz-initiated) plain text is dropped by Meta
                            // with 131047 outside the 24h service window — send via an
                            // approved template instead. No-variable templates reject
                            // the body component (code 100) → falls back to text below.
                            await sock.sendTemplate(jid, { name: process.env.PROACTIVE_TEMPLATE || 'bot_live_update', language: process.env.PROACTIVE_LANGUAGE || 'en', body: cmd.message || '' });
                            console.log(`[Bot] Generic message sent (template) to ${maskJid(jid)}`);
                        } catch (e) {
                            console.warn(`[Bot] Template send failed, text fallback for ${maskJid(jid)}: ${e.message || e}`);
                            await sock.sendMessage(jid, { text: cmd.message || "" });
                            console.log(`[Bot] Generic message sent (text) to ${maskJid(jid)}`);
                        }
                    } else {
                        await sock.sendMessage(jid, { text: cmd.message || "" });
                        console.log(`[Bot] Generic message sent to ${maskJid(jid)}`);
                    }
                } else {
                    console.warn(`[Bot] SEND_GENERIC_MESSAGE skipped — invalid phone: "${cmd.phone}"`);
                }
            }
            // Remove the command after processing
            await snap.ref.remove();
        } catch (err) {
            console.error("[Bot] Command Execution Error:", err);
        }
    });
}

// =============================
// 2. ORDER & NOTIFICATION CORE
// =============================

async function generateOrderId(outlet = 'outlet') {
    const today = new Date();
    const d = today.getDate().toString().padStart(2, '0');
    const m = (today.getMonth() + 1).toString().padStart(2, '0');
    const yy = String(today.getFullYear()).slice(-2);
    const dateStr = `${d}${m}${yy}`;

    const seqRef = db.ref(resolvePath(`metadata/orderSequence/${dateStr}`, outlet));
    const result = await seqRef.transaction((current) => (current || 0) + 1);

    const seqNum = result.snapshot.val() || 1;
    return `${dateStr}-${seqNum}`;
}

async function createWebviewToken(outlet, phone) {
    const token = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    await db.ref(resolvePath(`webviewTokens/${token}`, outlet)).set({
        phone,
        createdAt: new Date().toISOString(),
        used: false,
    });
    return token;
}

// Reuse this phone's last token within 30 min of generation; after that, mint a new one.
// (Client-side webview already expires tokens 1h after creation.)
const WEBVIEW_TOKEN_REUSE_MS = 30 * 60 * 1000;
async function getOrCreateWebviewToken(outlet, phone, user) {
    const existing = user?.webviewToken;
    if (existing && user.webviewTokenAt && Date.now() - user.webviewTokenAt < WEBVIEW_TOKEN_REUSE_MS) {
        const snap = await db.ref(resolvePath(`webviewTokens/${existing}`, outlet)).once('value').catch(() => null);
        const td = snap?.val();
        if (td && !td.used) return existing;
    }
    const token = await createWebviewToken(outlet, phone);
    if (user) { user.webviewToken = token; user.webviewTokenAt = Date.now(); }
    return token;
}

// Send the CTA as an interactive URL button (meta transport); falls back to image + link text (baileys).
async function sendOrderCTA(sock, sender, menuImg, ctaText, menuUrl) {
    if (typeof sock.sendButton === 'function') {
        return sock.sendButton(sender, {
            body: ctaText,
            url: menuUrl,
            title: 'Order Now',
            headerImageUrl: typeof menuImg === 'string' && menuImg.startsWith('http') ? menuImg : undefined,
            footer: `Freshly made • ${OUTLET_NAME}`
        });
    }
    return sendImage(sock, sender, menuImg, `${ctaText}\n════════════════════════--\n${menuUrl}`, OUTLET, true, 'menu_display');
}

// Full greeting flow: greeting image + menu + order button. Token reused within 30 min.
async function sendOrderFlow(sock, sender, pushName, user) {
    const [store, bot] = await Promise.all([
        getData("settings/Store", OUTLET),
        getData("settings/Bot", OUTLET)
    ]);

    let welcome = (user?.hasProfile && user?.name)
        ? `Namaste *${user.name}* ji! 👋\nAapke favorite items taiyar hain! ${OUTLET_EMOJI}`
        : `Namaste *${pushName}* ji! 👋`;
    welcome += `\n════════════════════════`;
    welcome += `\n✨ *${OUTLET_NAME} mein aapka swagat hai!* ${OUTLET_EMOJI}`;
    welcome += `\n════════════════════════`;
    welcome += `\nMazedar khana, fatafat aapke darwaze tak! 🚀`;
    const greetingImg = bot?.greetingImage || store?.bannerImage;
    await sendImage(sock, sender, greetingImg, welcome, undefined, false, 'greeting');

    // Wait 2 seconds for WhatsApp to prepare preview rendering
    await new Promise(r => setTimeout(r, 2000));

    return resendMenuCTA(sock, sender, user, store, bot);
}

// Resend just the menu CTA (menu image + order link/button) — used for C2/C3/C5.
async function resendMenuCTA(sock, sender, user, store, bot, ctaText) {
    if (!store || !bot) {
        const data = await Promise.all([
            getData("settings/Store", OUTLET),
            getData("settings/Bot", OUTLET)
        ]);
        store = data[0]; bot = data[1];
    }
    const phone = sender.replace(/[^0-9]/g, '').slice(-10);
    const token = await getOrCreateWebviewToken(OUTLET, phone, user);
    const menuUrl = `${WEBVIEW_DELIVERY_HOST}/delivery.html?b=${resolveBusinessIdFor(OUTLET)}&o=${OUTLET}&session=${phone}&src=wa&bot=${WEBVIEW_BOT_PHONE}&token=${token}`;
    const menuImg = bot?.menuImage || store?.bannerImage;
        if (!ctaText) ctaText = `👇 *niche link pe Click karke abhi order Karen* 👇`;
    return sendOrderCTA(sock, sender, menuImg, ctaText, menuUrl);
}

async function appendContactInfo(text, outlet = 'outlet') {
    if (!text) return '';
    try {
        const storeSettings = await getData("settings/Store", outlet) || {};
        const deliverySettings = await getData("settings/Delivery", outlet) || {};
        const adminNum = storeSettings.phone || deliverySettings.reportPhone || DEVELOPER_NUMBER;
        return `${text}\n${'-'.repeat(32)}\nIf you have any Doubt Contact Admin: *${adminNum}*`;
    } catch (e) {
        return text;
    }
}

async function sendImage(sock, to, image, text, outlet = 'outlet', skipContact = false, trackType = 'order_notification') {
    // Blocklist check — silently skip sending to blocked numbers.
    // Returns true (not false) because this is a PERMANENT, intentional
    // non-send, not a transient failure — the caller uses this return
    // value to decide whether to retry, and retrying a blocked number
    // would just loop forever for no reason.
    if (isBlockedJid(to, blockedNumbers)) {
        console.log(`[BLOCKED] Skipping outbound to ${(to || '').replace(/[^0-9]/g, '').slice(-4)}`);
        return true;
    }
    // Baileys-specific per-recipient jitter (skip for Meta transport)
    const _isBaileys = !sock.user?.id?.startsWith('meta:');
    if (_isBaileys) {
        const phone = (to || '').replace(/[^0-9]/g, '');
        await baileysSendTracker.waitBeforeSend(phone);
        baileysSendTracker.trackSend(phone);
    }
    const finalMsg = skipContact ? text : await appendContactInfo(text, outlet);

    // FAST PATH: Pre-converted PNG base64 — skip fetch + Sharp entirely
    // Format: "data:image/png;base64,..." (stored as imgPlacedPng, imgConfirmedPng, etc.)
    if (typeof image === 'string' && image.startsWith('data:image/png;base64,')) {
        if (!image) {
            // handled below
        } else {
            try {
                const pngBuf = Buffer.from(image.split(',')[1], 'base64');
                await sock.sendMessage(to, { image: pngBuf, caption: finalMsg });
                outboundTracker.trackSend(outlet, trackType);
                _onSendSuccess();
                console.log(`[SEND OK] to ${maskJid(to)} type=image trackType=${trackType} (pre-converted PNG)`);
                return true;
            } catch (err) {
                console.warn(`[SEND IMAGE] Pre-converted PNG send failed, falling back: ${err.message}`);
                // fall through to normal path
            }
        }
    }

    if (!image) {
        try {
            await sock.sendMessage(to, { text: finalMsg });
            outboundTracker.trackSend(outlet, trackType);
            _onSendSuccess();
            console.log(`[SEND OK] to ${maskJid(to)} type=text trackType=${trackType}`);
            return true;
        } catch (e) {
            console.error("Text Send Error:", e.message || e);
            _onSendFailure();
            console.log(`[SEND FAIL] to ${maskJid(to)} type=text trackType=${trackType}`);
        }
        return false;
    }
    try {
        let payload;
        // Pre-convert ANY image to JPEG buffer via Sharp so Baileys'
        // extractImageThumb never chokes on WebP/corrupt/broken formats.
        if (typeof image === 'string') {
            let inputBuf;
            let isDataUrlJpeg = false;
            if (image.startsWith('data:image')) {
                inputBuf = Buffer.from(image.split(',')[1], 'base64');
                // If already JPEG data URL, convert to PNG (Sharp handles PNG better than JPEG for thumbnail generation)
                if (image.startsWith('data:image/jpeg') || image.startsWith('data:image/jpg')) {
                    if (sharpLib) {
                        try {
                            console.log(`[SEND IMAGE] Converting JPEG data URL to PNG for Baileys thumbnail compatibility`);
                            inputBuf = await sharpLib(inputBuf).png().toBuffer();
                            console.log(`[SEND IMAGE] Converted JPEG to PNG successfully`);
                        } catch (e) {
                            console.warn(`[SEND IMAGE] PNG conversion failed, using original JPEG: ${e.message}`);
                        }
                    }
                }
            } else {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 15000);
                const resp = await fetch(image, { signal: ctrl.signal });
                clearTimeout(timer);
                if (!resp.ok) throw new Error(`Image fetch ${resp.status}`);
                inputBuf = Buffer.from(await resp.arrayBuffer());
                // Convert URL-fetched JPEG to PNG for Baileys thumbnail compatibility
                if (sharpLib) {
                    try {
                        console.log(`[SEND IMAGE] Converting URL-fetched JPEG to PNG for Baileys thumbnail compatibility`);
                        inputBuf = await sharpLib(inputBuf).png().toBuffer();
                        console.log(`[SEND IMAGE] Converted URL JPEG to PNG successfully`);
                    } catch (e) {
                        console.warn(`[SEND IMAGE] PNG conversion failed, using original JPEG: ${e.message}`);
                    }
                }
            }
            // Already converted to PNG above (or fell back to raw), send as-is
            payload = { image: inputBuf, caption: finalMsg };
        } else {
            payload = { image: image, caption: finalMsg };
        }
        await sock.sendMessage(to, payload);
        outboundTracker.trackSend(outlet, trackType);
        _onSendSuccess();
        console.log(`[SEND OK] to ${maskJid(to)} type=image trackType=${trackType}`);
        return true;
    } catch (err) {
        console.error("Image Send Error:", err.message || err);
        _onSendFailure();
        // Fallback to text ONLY if it wasn't already a text message failure
        try {
            await sock.sendMessage(to, { text: finalMsg });
            outboundTracker.trackSend(outlet, trackType);
            _onSendSuccess();
            console.log(`[SEND OK] to ${maskJid(to)} type=text-fallback trackType=${trackType} (image failed: ${err.message || err})`);
            return true;
        } catch (textErr) {
            console.error("Critical Send Error:", textErr.message || textErr);
            _onSendFailure();
            console.log(`[SEND FAIL] to ${maskJid(to)} trackType=${trackType} — both image and text-fallback failed`);
            return false;
        }
    }
}

async function deductInventoryStock(sock, items, outlet = 'outlet') {
    if (!items || !Array.isArray(items) || items.length === 0) return;
    try {
        const inventoryRef = db.ref(resolvePath('inventory', outlet));
        const snapshot = await inventoryRef.once('value');
        const inventory = snapshot.val() || {};
        const deliverySettings = await getData("settings/Delivery", outlet) || {};
        const notifyPhone = deliverySettings.notifyPhone || deliverySettings.reportPhone;

        for (const item of items) {
            const itemName = (item.name || item.item).toLowerCase();
            const invEntry = Object.entries(inventory).find(([id, data]) => data.name.toLowerCase() === itemName);

            if (invEntry) {
                const [id, data] = invEntry;
                const qty = item.quantity || 1;
                const newStock = Math.max(0, (data.stock || 0) - qty);
                const threshold = data.threshold || 0;

                await inventoryRef.child(id).update({
                    stock: newStock,
                    updatedAt: new Date().toISOString()
                });

                if (newStock <= threshold && notifyPhone) {
                    const alertMsg = `⚠️ *LOW STOCK ALERT* ⚠️\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `📦 Item: *${data.name}*\n` +
                        `📉 Current Stock: *${newStock}*\n` +
                        `🚩 Threshold: *${threshold}*\n════════════════════════\n` +
                        `_Please refill stock from Admin Panel immediately!_`;

                    const jid = formatJid(notifyPhone);
                    if (jid) sock.sendMessage(jid, { text: alertMsg }).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error("[INVENTORY] ❌ Stock Deduction Error:", e);
    }
}

async function cleanupStaleOrders(sock) {
    try {
        const ordersRef = db.ref(resolvePath('orders', OUTLET));
        const snap = await ordersRef.once('value');
        if (!snap.exists()) return;

        const now = Date.now();
        const FIVE_HOURS = 5 * 60 * 60 * 1000;
        const updates = {};
        const cancelMsg = "Sorry , Hame Maaf Kijiyega, ham aapka Order Deliver nahi kar payen, Please Order Again 🙏";

        snap.forEach(child => {
            const o = child.val();
            const status = (o.status || "").toLowerCase();
            if (status === "delivered" || status === "cancelled" || status === "archived") return;

            const orderTime = o.createdAt || o.timestamp || o.assignedAt || 0;
            if (orderTime > 0 && (now - orderTime) > FIVE_HOURS) {
                updates[`${child.key}/status`] = "Cancelled";
                updates[`${child.key}/cancellationReason`] = "System Auto-Cancel: Exceeded 5 hours";
                updates[`${child.key}/cancelledAt`] = now;

                const jid = formatJid(o.phone || o.whatsappNumber);
                if (jid && sock) {
                    sock.sendMessage(jid, { text: cancelMsg }).catch(e => console.error("Auto-cancel notification failed", e));
                }
                console.log(`[Garbage Collector] Auto-cancelled stale order #${child.key}`);
            }
        });

        if (Object.keys(updates).length > 0) {
            await ordersRef.update(updates);
        }
    } catch (e) {
        console.error("[Garbage Collector] Error:", e);
    }
}

async function getRiderByEmail(email, outlet = 'outlet') {
    if (!email) return null;
    try {
        const riders = await getData("riders", outlet);
        if (!riders) return null;
        for (const uid in riders) {
            if (riders[uid].email?.toLowerCase() === email.toLowerCase()) {
                return { uid, ...riders[uid] };
            }
        }
    } catch (err) { console.error("Rider Lookup Error:", err); }
    return null;
}

async function addInAppNotification(uid, title, body, type = 'info', icon = 'bell', outlet = 'outlet') {
    if (!uid) return;
    try {
        const notifId = "NOTIF" + Date.now();
        await setData(`riders/${uid}/notifications/${notifId}`, {
            id: notifId, title, body, type, icon, timestamp: Date.now(), read: false
        }, outlet);
    } catch (err) { console.error("Notification Error:", err); }
}

// =============================
// 3. CORE BOT LOGIC (SOCKET WRAPPER)
// =============================

async function sendFCMToAdmins(orderId, order) {
    try {
        const outlet = order.outlet || 'outlet';
        const snap = await db.ref('admins').once('value');
        const admins = snap.val();
        if (!admins) return;
        // Keep uid alongside each token so a dead token can be traced back
        // to the admin record it belongs to and cleaned up below.
        const entries = Object.entries(admins)
            .filter(([, a]) => !!a.fcmToken)
            .map(([uid, a]) => ({ uid, token: a.fcmToken }));
        if (entries.length === 0) return;
        // De-dupe by token (two admin records could share a token on a
        // shared device) while keeping one uid per token for cleanup.
        const seen = new Map();
        entries.forEach(e => { if (!seen.has(e.token)) seen.set(e.token, e.uid); });
        const unique = [...seen.keys()];
        const title = `🆕 New Order #${formatOrderId(order.orderId || orderId)}`;
        const body = `${order.customerName || 'Customer'} · ₹${order.total || 0} · ${outlet.toUpperCase()}`;
        const results = await admin.messaging().sendEachForMulticast({
            tokens: unique,
            notification: { title, body },
            data: { orderId, outlet, type: 'new_order', title, body },
            android: { priority: "high" },
            webpush: { headers: { Urgency: "high" } }
        });
        const failed = results.responses.filter(r => !r.success).length;
        if (failed > 0) {
            console.warn(`[FCM] ${failed}/${unique.length} admin notifications failed`);
            // Log WHY each one failed — without this, "4/4 failed" tells us
            // nothing (stale token vs bad credentials vs quota vs something
            // else). Also auto-clean genuinely dead tokens so they stop
            // being retried forever and silently eating the whole batch.
            const deadCodes = new Set([
                'messaging/registration-token-not-registered',
                'messaging/invalid-argument',
                'messaging/invalid-registration-token'
            ]);
            await Promise.all(results.responses.map(async (r, i) => {
                if (r.success) return;
                const token = unique[i];
                const code = r.error?.code || 'unknown';
                const uidForToken = seen.get(token);
                console.warn(`[FCM] Admin token failed (uid=${uidForToken}): ${code} — ${r.error?.message || 'no message'}`);
                if (deadCodes.has(code) && uidForToken) {
                    try {
                        await db.ref(`admins/${uidForToken}/fcmToken`).remove();
                        await db.ref(`admins/${uidForToken}/fcmTokenInvalidAt`).set(Date.now());
                        console.warn(`[FCM] Removed dead token for uid=${uidForToken} (${code}) — they'll need to re-open the admin panel to re-register.`);
                    } catch (cleanupErr) {
                        console.error(`[FCM] Token cleanup failed for uid=${uidForToken}:`, cleanupErr.message);
                    }
                }
            }));
        }
    } catch (e) {
        console.error('[FCM] sendFCMToAdmins error:', e.message);
    }
}

async function sendFCMToRider(riderId, title, body, data = {}) {
    try {
        const snap = await db.ref(`riders/${riderId}/fcmToken`).once('value');
        const token = snap.val();
        if (!token) return;
        await admin.messaging().send({
            token,
            notification: { title, body },
            data,
            android: { priority: 'high' },
            webpush: { headers: { Urgency: 'high' } }
        });
    } catch (e) {
        console.error(`[FCM] sendFCMToRider error (rider ${riderId}):`, e.message);
    }
}

async function notifyAdmin(sock, orderId, order, type = 'NEW') {
    try {
        if (!sock || isSocketDead(sock)) return;
        const outlet = order.outlet || 'outlet';
        const jids = await getCachedAdminJids();
        if (!jids || jids.length === 0) return;

        let msg = "";
        if (type === 'CANCELLED') {
            msg = `⚠️ *LOST SALE / ABANDONED* ⚠️\n━━━━━━━━━━━━━━━━━━━━\n👤 *Customer:* ${order.customerName || 'Anonymous'}\n📞 *Phone:* ${order.phone || 'N/A'}\n💰 *Potential Total:* ₹${order.total || 0}\n🏪 *Outlet:* ${outlet.toUpperCase()}\n━━━━━━━━━━━━━━━━━━━━\n_User cancelled at final checkout step._`;
        } else if (type === 'RIDER_ACCEPTED') {
            const riderName = order.riderName || order.riderId || order.assignedRider || 'A rider';
            msg = `🛵 *RIDER ON THE WAY TO RESTAURANT* 🛵\n━━━━━━━━━━━━━━━━━━━━\n🆔 ID: #${formatOrderId(order.orderId || orderId)}\n👤 Customer: ${order.customerName || 'N/A'}\n📞 Phone: ${order.phone || 'N/A'}\n🛵 Rider: ${riderName}\n📞 Rider Phone: ${order.riderPhone || 'N/A'}\n━━━━━━━━━━━━━━━━━━━━\n_Get the order ready for pickup._`;
        } else if (type === 'RIDER_ARRIVED') {
            const riderName = order.riderName || order.riderId || order.assignedRider || 'A rider';
            msg = `🛵 *RIDER ARRIVED AT RESTAURANT* 🛵\n━━━━━━━━━━━━━━━━━━━━\n🆔 ID: #${formatOrderId(order.orderId || orderId)}\n🛵 Rider: ${riderName}\n━━━━━━━━━━━━━━━━━━━━\n_Hand over the order for pickup._`;
        } else {
            let itemsText = (order.items || []).map(i => `• ${i.name} (${i.size}) x${i.quantity}`).join('\n');
            let adminMsg = type === 'NEW' ? `🔔 *NEW ORDER RECEIVED!* 🔔\n════════════════════════\n` : `📦 *ORDER UPDATE* 📦\n════════════════════════\n`;
            adminMsg += `🆔 ID: #${formatOrderId(order.orderId || orderId)}\n👤 Customer: ${order.customerName}\n📞 Phone: ${order.phone}\n📍 Address: ${order.address}\n════════════════════════\n📦 Items:\n${itemsText}\n════════════════════════\n💰 Total: ₹${order.total || 0}\n💳 Method: ${order.paymentMethod}`;
            msg = adminMsg;
        }

        await Promise.all(jids.map(jid => sock.sendMessage(jid, { text: msg }).catch(() => {})));
    } catch (err) { console.error("Admin Notify Error:", err); }
}


// Per-order lock: serialize status updates so concurrent child_changed
// events for the same order don't race on Redis reads/writes.
const _orderStatusLocks = new Map();

async function handleOrderStatusUpdate(sock, id, order, isNew = false) {
    // Wait for any in-flight handler on this order, then claim the slot.
    while (_orderStatusLocks.has(id)) {
        await _orderStatusLocks.get(id);
    }
    let release;
    _orderStatusLocks.set(id, new Promise(r => { release = r; }));
    try {
        if (!sock || isSocketDead(sock)) return;
        // FIX: Robust JID resolution for both Online and POS orders.
        // POS orders usually store the phone in 'order.phone'. 
        // Online orders store the JID in 'order.whatsappNumber'.
        let jid = null;

        // PRIORITIZE: whatsappNumber if it's a standard JID. 
        // If it's a @lid (Linked ID), we prefer formatting the phone for a standard @s.whatsapp.net JID
        const storedJid = String(order.whatsappNumber || "");
        if (storedJid.includes('@')) {
            jid = storedJid;
        } else {
            // Fallback to phone field (POS orders, incomplete profiles)
            const rawPhone = order.phone || order.whatsappNumber;
            if (rawPhone && rawPhone !== "Walk-in") {
                jid = formatJid(rawPhone);
            }
        }

        if (!jid) {
            const type = (order.type || order.orderType || "Walk-in");
            // Dine-in QR orders intentionally carry no phone (PII lives in
            // tableSessionsContact) — silent skip, not a warning.
            const isDineIn = /dine|walk/i.test(String(type));
            if (!isDineIn) {
                console.warn(`[BOT] ⚠️ Skipping Notification for #${formatOrderId(order.orderId || id)} (${type}): No valid phone. Value: "${order.phone}"`);
                updateData(`bot/logs/${id}`, { error: "No valid JID", phone: order.phone || null, type, timestamp: Date.now() }, order.outlet || OUTLET).catch(() => { });
            }
            return;
        }

        const currentStatus = (order.status || "").trim();
        const statusLower = currentStatus.toLowerCase();
        const orderType = (order.type || order.orderType || "Online").trim();
        const typeLower = orderType.toLowerCase();
        const isDineIn = typeLower.includes("dine") || typeLower.includes("walk") || orderType === "Dine-in";

        if (isDineIn) {
            console.log(`[BOT] 🍽️ Dine-in Order Detected: #${formatOrderId(order.orderId || id)} | Status: ${currentStatus} | Target: ${maskJid(jid)}`);
        }

        const phoneDisplay = order.phone || order.whatsappNumber || "N/A";

        // Fetch current status from Redis Cache
        const currentProcessedStatus = await getProcessedStatus(id);

        // Track OTP changes to trigger resend notifications even if status is same
        const storedOTP = order.deliveryOTP || order.otp || order.otpCode;
        const isDeliveryOtpStatus = statusLower === "out for delivery" || statusLower === "reached drop location";

        const isOtpChanged = currentProcessedStatus &&
            isDeliveryOtpStatus &&
            currentProcessedStatus.lastOtp &&
            currentProcessedStatus.lastOtp !== storedOTP;

        // Also send if it's a delivery OTP status and we have a valid OTP but no cached lastOtp but no cached lastOtp (handles restart / first time)
        const shouldSendOtpMessage = isDeliveryOtpStatus && storedOTP && !currentProcessedStatus?.lastOtp && !currentProcessedStatus?.lastOtp;

        const maskedJid = maskJid(jid);
        console.log(`[Status Update] 🔍 Processing Order #${formatOrderId(order.orderId || id)} | Status: ${currentStatus} | OTP Changed: ${isOtpChanged} | Target: ${maskedJid} | CachedStatus: ${currentProcessedStatus?.status || 'null'} | isNew: ${isNew}`);

        if (!currentProcessedStatus || currentProcessedStatus.status !== currentStatus || isNew || isOtpChanged || shouldSendOtpMessage) {
            const currentRider = order.riderId || order.assignedRider || "";
            const lastRider = currentProcessedStatus?.riderId || "";
            const isRiderChanged = currentRider && currentRider !== lastRider;

            // IMPORTANT: do NOT write `status: currentStatus` here yet. This
            // used to mark the status "processed" before the notification
            // was actually sent — sendImage() never threw on failure (it
            // swallows errors internally), so a transient send failure
            // (network blip, socket mid-reconnect, image-format crash
            // cascading into a failed text-fallback too) would leave this
            // status permanently marked as done in Redis with the customer
            // never having received it, and no retry would ever happen.
            // `status` is now only written after send is confirmed to have
            // actually succeeded, further down. Only bookkeeping fields
            // that don't gate re-sends (rider/OTP tracking) are safe to
            // write early.
            await saveProcessedStatus(id, {
                ...(currentProcessedStatus || {}),
                timestamp: Date.now(),
                lastOtp: storedOTP,
                riderId: currentRider
            });

            console.log(`[Status Update] 🔔 Processing #${formatOrderId(order.orderId || id)}: Status=${currentStatus}, Rider=${currentRider || 'None'}`);

            // NEW: Notify Rider on Assignment
            if (isRiderChanged) {
                console.log(`[RIDER] 🔄 Rider Change Detected for #${formatOrderId(order.orderId || id)}: ${lastRider} -> ${currentRider}`);
                await riderNotify.notifyRiderAssignment(sock, id, order, addInAppNotification);
            }

            const botSettings = await getData("settings/Bot", order.outlet) || {};
            const storeSettings = await getData("settings/Store", order.outlet) || {};
            // Fallback chain: pre-converted PNG -> specific status image URL -> menu image -> banner image -> 1x1 transparent PNG base64 (never fails)
            const fallbackImg = botSettings.menuImage || storeSettings.bannerImage || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
            let msg = "";
            let img = null;

            if (statusLower === "placed") {
                msg = `🎉 *ORDER PLACED!* ${OUTLET_EMOJI}\n━━━━━━━━━━━━━━━━━━━━\n${formatOrderInvoice(id, order)}We've received your order and our team is reviewing it now. ⏳\nYou'll get an update as soon as it's confirmed! ❤️`;
                img = botSettings.imgPlacedPng || botSettings.imgPlaced || botSettings.imgConfirmedPng || botSettings.imgConfirmed || fallbackImg;
            } else if (statusLower === "confirmed") {
                if (isDineIn && isNew) {
                    const outletName = order.outlet?.toUpperCase() || 'OUR RESTAURANT';
                    msg = `🏪 *WELCOME TO ${outletName}!* ✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nYour counter order has been *CONFIRMED*! 🎊\n🆔 *Order ID:* #${formatOrderId(order.orderId || id)}\n👤 *Customer:* ${order.customerName || 'Guest'}\n${order.tableNo ? `🪑 *Table No:* ${order.tableNo}\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━\nYour delicious meal is being prepared right now! 👨‍🍳🔥\n_Thank you for dining with us!_ 🙏`;
                } else {
                    msg = `✅ *ORDER CONFIRMED!* 🎊\n━━━━━━━━━━━━━━━━━━━━\n${formatOrderInvoice(id, order)}Your order is being prepared with love! ❤️\n${getFoodFunnyProgress("Confirmed")}`;
                }
                img = botSettings.imgConfirmedPng || botSettings.imgConfirmed || fallbackImg;
            } else if (statusLower === "ready" || statusLower === "packed") {
                msg = `📦 *PACKED & READY!* 🚀\n━━━━━━━━━━━━━━━━━━━━\nYour delicious order #${formatOrderId(order.orderId || id)} is ready and packed! 🍱\n${isDineIn ? "It's ready to be served! 🍽️" : "Waiting for the rider to pick it up. 🛵"}\n${getFoodFunnyProgress("Ready")}`;
                img = botSettings.imgReadyPng || botSettings.imgReady || fallbackImg;

                if (!isDineIn) {
                    // Only notify if a rider is actually assigned (has riderId)
                    if (order.riderId && order.riderPhone) {
                        await riderNotify.notifyRiderPickup(sock, order, addInAppNotification);
                    } else if (!order.riderId) {
                        // No rider assigned yet — broadcast to available riders
                        await riderNotify.broadcastPickupAvailable(sock, id, order, getData, addInAppNotification);
                    }
                    // If riderId exists but no riderPhone, skip (data inconsistency)
                }
            } else if (statusLower === "arriving at restaurant") {
                // Rider accepted -> restaurant staff should know the rider is en route
                // (this is an internal alert, not a customer-facing one — the customer
                // is told at pickup/delivery milestones instead).
                notifyAdmin(sock, id, order, 'RIDER_ACCEPTED').catch(() => {});
                msg = "";
            } else if (statusLower === "arrived at restaurant") {
                notifyAdmin(sock, id, order, 'RIDER_ARRIVED').catch(() => {});
                msg = "";
            } else if (statusLower === "picked up" || statusLower === "out for delivery") {
                let otp = storedOTP;
                if (!otp) {
                    otp = Math.floor(1000 + Math.random() * 9000).toString();
                    await updateData(`orders/${id}`, { otp: otp, deliveryOTP: otp }, order.outlet);
                }

                let riderInfoText = "";
                const riderId = order.riderId || order.assignedRider;
                if (riderId) {
                    // Distinguish email (user@domain.com) from JID (phone@s.whatsapp.net)
                    // Email has a domain part with dot, JID has known WhatsApp domains
                    const isEmail = riderId.includes('@') && 
                        !riderId.includes('@s.whatsapp.net') && 
                        !riderId.includes('@g.us') && 
                        !riderId.includes('@broadcast') &&
                        riderId.split('@')[1]?.includes('.');
                    const rider = isEmail 
                        ? await getRiderByEmail(riderId, order.outlet || 'outlet') 
                        : { name: order.riderName, phone: order.riderPhone };
                    if (rider) {
                        riderInfoText = `\n📞 *Rider:* ${rider.name || "Delivery Partner"} (${rider.phone || ""})`;
                    }
                }

                if (isOtpChanged) {
                    msg = `🔑 *NEW DELIVERY OTP!* 🔄\n━━━━━━━━━━━━━━━━━━━━\nYour previous code is now invalid. Please use the new one below for your delivery #${formatOrderId(order.orderId || id)}:\n🔑 *NEW OTP:* ${otp}${riderInfoText}\n💰 *Total:* ₹${order.total || 0}\n_Share this code ONLY with the rider upon arrival._`;
                } else {
                    msg = `🛵 *OUT FOR DELIVERY!* 🚀\n━━━━━━━━━━━━━━━━━━━━\nOur rider is on the way to your location! 🛵💨\n🆔 Order: #${formatOrderId(order.orderId || id)}\n🔑 *OTP:* ${otp} (Share with rider only)${riderInfoText}\n💰 *Total:* ₹${order.total || 0}\n${getFoodFunnyProgress("Out for Delivery")}`;
                }
                img = botSettings.imgOutPng || botSettings.imgOut || fallbackImg;
            } else if (statusLower === "reached drop location") {
                let otp = storedOTP;
                if (!otp) {
                    otp = Math.floor(1000 + Math.random() * 9000).toString();
                    await updateData(`orders/${id}`, { otp: otp, deliveryOTP: otp }, order.outlet);
                }
                msg = `📍 *RIDER HAS REACHED!* 🚨\n━━━━━━━━━━━━━━━━━━━━\nOur rider has arrived at your location for order #${formatOrderId(order.orderId || id)}.\n🔑 *OTP:* ${otp} (Please share with rider)\nKripya order lene ke liye taiyar rahein. Shukriya! 🙏`;
                img = botSettings.imgOutPng || botSettings.imgOut || fallbackImg;
            } else if (statusLower === "delivered" || statusLower === "served") {
                msg = `✅ *${isDineIn ? 'SERVED' : 'DELIVERED'} SUCCESSFULLY!* 🏪❤️\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Order ID:* #${formatOrderId(order.orderId || id)}\n🤝 *Payment:* ${order.paymentMethod}\n💵 *Total Paid:* ₹${order.total || 0}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n*Enjoy your meal!* 😋\n${getFunnyFoodJoke()}`;
                img = botSettings.imgDeliveredPng || botSettings.imgDelivered || fallbackImg;
            } else if (statusLower === "cancelled") {
                msg = `❌ *ORDER CANCELLED* ❌\n━━━━━━━━━━━━━━━━━━━━\nAapka order #${formatOrderId(order.orderId || id)} cancel ho gaya hai. 😔\nReason: ${order.cancelReason || "Store Busy / Technical Issue"}\nKoi sawaal ho toh humse baat karein. 🙏`;
            }

            const prevStatus = currentProcessedStatus?.status || "None";
            console.log(`[BOT] 🔔 Status Change for #${formatOrderId(order.orderId || id)}: ${prevStatus} -> ${currentStatus} (${jid ? 'Valid JID' : 'NO JID'})`);

            if (msg) {
                console.log(`[BOT] 📧 Sending ${currentStatus} notification to ${maskJid(jid)}...`);
                await orderRateLimiter.wait();
                const orderTrackType = (statusLower === 'placed' || statusLower === 'confirmed') ? 'order_notification' : 'order_update';
                const sendResult = await sendImage(sock, jid, img, msg, order.outlet || 'outlet', true, orderTrackType);

                if (sendResult) {
                    // Only NOW is this status considered "processed" — the
                    // customer actually received it (or it was a permanent,
                    // non-retryable skip like a blocked number).
                    await saveProcessedStatus(id, {
                        ...(currentProcessedStatus || {}),
                        status: currentStatus,
                        lastOtp: storedOTP,
                        timestamp: Date.now()
                    });

                    updateData(`bot/logs/${id}`, {
                        lastSent: currentStatus,
                        jid: maskJid(jid),
                        success: true,
                        timestamp: Date.now()
                    }, order.outlet || OUTLET).catch(() => { });
                } else {
                    // Send genuinely failed. Deliberately leave `status`
                    // un-advanced in the cache so the next child_changed
                    // event for this order (or a bot restart) re-enters this
                    // branch and retries — instead of silently losing this
                    // notification forever. Surface it in bot/alerts so it's
                    // visible in the Admin panel without pinging anyone on
                    // WhatsApp for what may just be a transient blip.
                    console.error(`[Status Update] ❌ Notification FAILED for #${formatOrderId(order.orderId || id)} (${currentStatus}) — will retry on next order update.`);
                    db.ref(resolvePath(`bot/alerts/${order.outlet || OUTLET}`))
                        .push({
                            type: 'status_notification_failed',
                            severity: 'warning',
                            message: `Order #${formatOrderId(order.orderId || id)} — "${currentStatus}" notification failed to send to customer.`,
                            orderId: id,
                            status: currentStatus,
                            createdAt: Date.now()
                        }).catch(() => { });

                    updateData(`bot/logs/${id}`, {
                        lastSent: currentStatus,
                        jid: maskJid(jid),
                        success: false,
                        timestamp: Date.now()
                    }, order.outlet || OUTLET).catch(() => { });
                }
            } else {
                // If no message defined for this status, still mark as processed
                await saveProcessedStatus(id, {
                    ...(currentProcessedStatus || {}),
                    status: currentStatus,
                    lastOtp: storedOTP,
                    timestamp: Date.now()
                });
            }
        } else {
            if (currentProcessedStatus && currentProcessedStatus.status === currentStatus) {
                console.log(`[Status Update] ⏭️ Skipping #${formatOrderId(order.orderId || id)}: status '${currentStatus}' already processed (cached: '${currentProcessedStatus.status}')`);
            } else if (!jid) {
                console.log(`[Status Update] ⏭️ Skipping #${formatOrderId(order.orderId || id)}: no JID`);
            } else {
                console.log(`[Status Update] ⏭️ Skipping #${formatOrderId(order.orderId || id)}: unknown skip reason (cached: ${JSON.stringify(currentProcessedStatus)}, isNew: ${isNew}, otpChanged: ${isOtpChanged}, shouldSendOtp: ${shouldSendOtpMessage})`);
            }
        }
    } catch (err) {
        console.error("Status Update Error:", err);
        updateData(`bot/logs/${id}`, { error: err.message, timestamp: Date.now() }, order.outlet || OUTLET).catch(() => { });
    } finally {
        _orderStatusLocks.delete(id);
        release();
    }
}


// SAFEST-FIRST: sibling fix to the webview_delivery discount re-validation.
// Dine-in QR orders (menu/js/order.js, tableSessions running-bill flow)
// compute discount/total client-side the same unverified way delivery
// orders used to. This re-runs the server-side evaluation and, critically,
// also corrects the per-table running bill in tableSessions/{sessionId} —
// attachOrderToSession() already folded the client's (unverified) numbers
// into that running total before the order was ever promoted to 'Placed',
// so a discount fix limited to the order document alone would leave the
// table's bill wrong even after the order record itself was corrected.
async function verifyQrOrderDiscount(orderId, order, OUTLET) {
    // Dine-in orders don't carry a phone on the order record itself (kept
    // out deliberately — see order.js's PII comment), so per-customer
    // limits (perCustomerLimit, firstOrder) can't be tied to a returning
    // guest here the way WhatsApp/webview orders can. customer stays null;
    // evaluateDiscount() still enforces global/date/minSubtotal/channel
    // gating correctly, it just can't personalize per-guest limits for an
    // anonymous dine-in order. Known limitation, not something this fix
    // can close without collecting guest identity at the table.
    let verified = null;
    let correctedDiscount = 0;
    try {
        const claimedCouponCode = (order.discountSource || '').startsWith('coupon:')
            ? order.discountSource.slice('coupon:'.length)
            : null;
        // order.js stores items as an object ({item_0,...}); delivery-order.js
        // stores an array. _cartHasCategory only checks arrays — normalize.
        const cartForVerify = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
        verified = await discountEngine.evaluateDiscount({
            OUTLET, customer: null, subtotal: order.subtotal,
            couponCode: claimedCouponCode, cart: cartForVerify, channel: 'website'
        });
        correctedDiscount = verified ? verified.amount : 0;
    } catch (discErr) {
        console.error(`[QROrder] Discount re-validation failed for ${orderId}, zeroing out:`, discErr);
        correctedDiscount = 0; // fail safe — never honor an unverified amount
    }
    const correctedTotal = Math.max(0, Math.round(((order.subtotal || 0) + (order.tax || 0) + (order.serviceCharge || 0) - correctedDiscount) * 100) / 100);
    const claimedDiscount = order.discount || 0;
    const claimedTotal = order.total || 0;
    if (correctedDiscount !== claimedDiscount || correctedTotal !== claimedTotal) {
        console.warn(`[QROrder] Discount mismatch on ${orderId}: client claimed ₹${claimedDiscount} (total ₹${claimedTotal}), server verified ₹${correctedDiscount} (total ₹${correctedTotal}). Correcting order + session.`);
    }
    const orderCorrection = verified ? {
        discount: correctedDiscount, discountId: verified.discount.id,
        discountLabel: verified.label, discountSource: verified.source,
        discountMode: verified.discount.mode || 'fixed', discountValue: verified.discount.value || 0,
        total: correctedTotal, discountVerified: true
    } : {
        discount: 0, discountId: null, discountLabel: null, discountSource: null,
        discountMode: null, discountValue: 0, total: correctedTotal, discountVerified: true
    };
    await updateData(`orders/${orderId}`, orderCorrection, OUTLET);

    // Fold the SAME correction into the table's running bill. This must be
    // a delta applied via transaction, not an overwrite — the session
    // aggregates totals across every order at the table, and other orders
    // (or this same table adding more items) can be writing to it
    // concurrently.
    if (order.sessionId) {
        const discountDelta = correctedDiscount - claimedDiscount;
        const totalDelta = correctedTotal - claimedTotal;
        if (discountDelta !== 0 || totalDelta !== 0) {
            try {
                const sessRef = db.ref(resolvePath(`tableSessions/${order.sessionId}`, OUTLET));
                await sessRef.transaction((sess) => {
                    if (!sess) return sess; // session gone — nothing to correct
                    // Session already closed/billed: don't retroactively
                    // change a bill that's already been settled with the
                    // customer. The order record itself is still corrected
                    // above, for accurate reporting.
                    if (sess.status === 'billing' || sess.status === 'closed' || sess.status === 'paid') return undefined;
                    sess.discount = Math.round(((sess.discount || 0) + discountDelta) * 100) / 100;
                    sess.grandTotal = Math.round(((sess.grandTotal || 0) + totalDelta) * 100) / 100;
                    return sess;
                });
            } catch (sessErr) {
                console.error(`[QROrder] Session correction failed for ${order.sessionId} (order ${orderId}):`, sessErr);
            }
        }
    }
}


// 4. MAIN START FUNCTION
// =============================

// =============================
// GLOBAL ERROR HANDLERS (prevent silent crashes)
// =============================
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err?.message || err);
});
process.on('unhandledRejection', (err) => {
    console.error('[FATAL] Unhandled Rejection:', err?.message || err);
});

async function startBot() {
    // Initialize outlet -> businessId reverse index for O(1) tenant path resolution
    try {
        await initializeOutletBusinessIndex(db);
    } catch (e) {
        console.error('[Bot] Failed to initialize outlet business index:', e.message);
    }

    // Resolve live store name from Firebase (ponytail: hardcoded brand removed —
    // falls back to "Our Restaurant" if the store name isn't set yet).
    try {
        const storeSettings = await getData("settings/Store", OUTLET);
        if (storeSettings && storeSettings.storeName) OUTLET_NAME = storeSettings.storeName.trim();
    } catch (_) {}
    console.log(`🚀 Starting ${OUTLET_NAME} WhatsApp Bot (${OUTLET})...`);

    // Determine active transport (meta | baileys) — controlled from Supreme Admin
    const transportMode = await getTransportMode(OUTLET);
    console.log(`🚀 Starting ${OUTLET_NAME} WhatsApp Bot (${OUTLET}) — transport=${transportMode}`);

    // Clean up previous socket on reconnect
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (currentSock) {
        try { currentSock.end(undefined); } catch (_) {}
        currentSock = null;
    }

    let sock;
    let isMetaTransport = false;
    if (transportMode === 'meta') {
        isMetaTransport = true;
        const phoneNumberId = await getPhoneNumberId(OUTLET);
        const accessToken = process.env.WA_PERMANENT_TOKEN;
        sock = createMetaTransport({ outlet: OUTLET, phoneNumberId, accessToken, redisUrl });
        sock.ev.on('connection.update', (update) => {
            if (sock !== currentSock) return;
            const { connection } = update;
            if (connection === 'open') {
            _sessionAlertSock = currentSock;
                initFCMWatcher();
                console.log(`✅ ${OUTLET_NAME.toUpperCase()} BOT IS ONLINE (Meta API)`);
                reconnectAttempts = 0;
                cryptoErrorCount = 0;
            } else if (connection === 'close') {
                reconnectAttempts++;
                const delay = Math.min(5000 * Math.pow(3, Math.min(reconnectAttempts - 1, 3)), 120000);
                console.log(`🔌 Meta transport closed (attempt ${reconnectAttempts}). Reconnecting in ${(delay / 1000).toFixed(0)}s...`);
                if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startBot(); }, delay);
            }
        });
    } else {
        // Pairing intent from the Supreme dashboard. Two cases:
        //  - switch to baileys (requested, no rescan): keep the saved session
        //    if one exists — Baileys reconnects silently, no QR needed.
        //  - explicit re-pair (rescan): wipe the session dir so a fresh QR
        //    is emitted.
        // Must run BEFORE useMultiFileAuthState — wiping after loading state
        // would leave the old creds in memory and `makeWASocket` would use
        // them anyway.
        const pairIntent = await getData('bot/pair', OUTLET);
        if (pairIntent && pairIntent.requested === true) {
            const dir = 'session_data_' + OUTLET;
            if (pairIntent.rescan === true) {
                try {
                    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
                    console.log(`[PAIR] re-pair requested — wiped ${dir}, emitting fresh QR`);
                } catch (err) {
                    console.error('[PAIR] failed to wipe session dir:', err.message);
                }
            } else {
                const hasSession = fs.existsSync(`${dir}/creds.json`);
                console.log(`[PAIR] switched to baileys — ${hasSession ? 'reusing saved session (no QR needed)' : 'no saved session, waiting for QR'}`);
            }
            await updateData('bot/pair', { requested: false, rescan: false, status: 'waiting', updatedAt: Date.now() }, OUTLET);
        }

        // useMultiFileAuthState writes creds.json immediately; ensure the dir
        // exists (rescan wipes it above, and first-time baileys has none).
        fs.mkdirSync('session_data_' + OUTLET, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState('session_data_' + OUTLET);
        const { version } = await fetchLatestBaileysVersion();

        const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });
        sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: baileysLogger,
        browser: ['Windows', 'Chrome', '10'],
        connectTimeoutMs: 90000,
        defaultQueryTimeoutMs: 120000,
        keepAliveIntervalMs: 15000,
        markOnlineOnConnect: false,
        emitOwnEvents: true
    });
        sock.ev.on('creds.update', saveCreds);
    }

    // Patch sendMessage to log every send attempt with delivery diagnostics.
    // Chat history is logged from sendMessage AND sendTemplate/sendButton
    // (Meta transport sends replies via sendTemplate, not sendMessage), so
    // the chat tab always sees the bot's half of the conversation.
    const _origSendMessage = sock.sendMessage.bind(sock);
    const _logOutboundChat = (jid, text, msgId) => {
        // Best-effort AND fire-and-forget (never delays the send). Skip
        // groups/broadcast, and any send explicitly tagged _logChat:false
        // (promo campaigns, rider ops).
        try {
            const target = String(jid);
            const isGroupish = target.includes('@g.us') || target.includes('@broadcast') || target.includes('@newsletter');
            if (!isGroupish && msgId) {
                logChatMessage({ outlet: OUTLET, jid: target, msgId, from: 'bot', text: text || '' });
            }
        } catch (chatLogErr) {
            console.warn("[CHAT-LOG] outbound hook error:", chatLogErr.message);
        }
    };
    sock.sendMessage = async function(jid, content, opts) {
        const textPreview = content?.text ? content.text.slice(0, 60) : (content?.caption ? content.caption.slice(0, 60) : 'non-text');
        try {
            const result = await _origSendMessage(jid, content, opts);
            const msgId = result?.key?.id || result?.messages?.[0]?.id || result;
            const cryptoWarn = cryptoErrorCount > 10 ? ` cryptoErrs=${cryptoErrorCount}` : '';
            console.log(`[SEND OK] to ${maskJid(jid)} text="${textPreview}" wsOpen=${sock.ws?.isOpen} msgId=${msgId}${cryptoWarn}`);
            if (opts?._logChat !== false) {
                _logOutboundChat(jid, content?.text || content?.caption || '', msgId);
            }
            // G5: Meta messaging quota numerator. Baileys sends don't consume
            // Cloud API tier, so only meta transport counts. Per-IST-day key,
            // atomic increment — the quota endpoint sums today's sends.
            if (isMetaTransport) {
                const bid = resolveBusinessIdFor(OUTLET);
                const day = getISTDateInfo().dateStr;
                const usageRef = db.ref(`businesses/${bid}/outlets/${OUTLET}/whatsapp/usage/${day}`);
                usageRef.transaction((count) => (count || 0) + 1).catch(() => {});
            }
            return result;
        } catch (err) {
            console.error(`[SEND ERR] to ${maskJid(jid)} text="${textPreview}":`, err.message || err);
            throw err;
        }
    };
    currentSock = sock;

    // Graceful shutdown handlers — allow PM2 to SIGTERM cleanly
    // so the WhatsApp socket closes gracefully instead of being hard-killed.
    // This prevents abrupt disconnects that look like client crashes to WhatsApp.
    if (!globalThis._shutdownHandlerInstalled) {
        globalThis._shutdownHandlerInstalled = true;
        let shuttingDown = false;
        process.on('SIGTERM', async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`[SHUTDOWN] SIGTERM received — gracefully closing WhatsApp socket...`);
            try {
                if (currentSock && !isSocketDead(currentSock)) {
                    await currentSock.end(undefined);
                    console.log(`[SHUTDOWN] WhatsApp socket closed gracefully`);
                }
            } catch (e) {
                console.error(`[SHUTDOWN] Error during graceful close:`, e.message);
            }
            setTimeout(() => process.exit(0), 500);
        });
        process.on('SIGINT', async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`[SHUTDOWN] SIGINT received — gracefully closing WhatsApp socket...`);
            try {
                if (currentSock && !isSocketDead(currentSock)) {
                    await currentSock.end(undefined);
                    console.log(`[SHUTDOWN] WhatsApp socket closed gracefully`);
                }
            } catch (e) {
                console.error(`[SHUTDOWN] Error during graceful close:`, e.message);
            }
            setTimeout(() => process.exit(0), 500);
        });
    }

    // Meta transport delivers replies via sendTemplate/sendButton (not
    // sendMessage) — patch those too so the chat tab logs the bot's half.
    if (typeof sock.sendTemplate === 'function') {
        const _origSendTemplate = sock.sendTemplate.bind(sock);
        sock.sendTemplate = async function(jid, opts = {}) {
            const result = await _origSendTemplate(jid, opts);
            const msgId = result?.key?.id || result?.messages?.[0]?.id || result;
            if (opts?._logChat !== false) {
                _logOutboundChat(jid, opts?.body || '', msgId);
            }
            return result;
        };
    }
    if (typeof sock.sendButton === 'function') {
        const _origSendButton = sock.sendButton.bind(sock);
        sock.sendButton = async function(jid, opts = {}) {
            const result = await _origSendButton(jid, opts);
            const msgId = result?.key?.id || result?.messages?.[0]?.id || result;
            if (opts?._logChat !== false) {
                _logOutboundChat(jid, opts?.body || '', msgId);
            }
            return result;
        };
    }

    initCommandListener(sock);

    // Heartbeat & Cleanup & Report Scheduling
    if (reportInterval) clearInterval(reportInterval);
    reportInterval = setInterval(async () => {
        // Log crypto health summary (helpful to detect session degradation)
        if (cryptoErrorCount > 0) {
            console.log(`[CRYPTO] 📊 ${cryptoErrorCount} undecryptable messages since last connect (session ${cryptoErrorCount > 10 ? 'may need attention' : 'healthy'})`);
        }
        updateData(`bot/status`, { lastSeen: Date.now(), status: 'Online', outlet: OUTLET }, OUTLET).catch(() => { });

        // Refresh admin JID cache every heartbeat cycle
        cachedAdminJids = await getReportRecipients();
        cachedAdminJidsExpiry = Date.now() + ADMIN_CACHE_TTL;

        // Clean stale entries from local status cache
        const cutoff = Date.now() - LOCAL_CACHE_TTL;
        for (const [k, v] of localStatusCache) {
            const entryTime = v.ts || v.timestamp || 0;
            if (entryTime > 0 && entryTime < cutoff) localStatusCache.delete(k);
        }

        // Get Time in Asia/Kolkata accurately
        const ist = getISTDateInfo();
        const hour = ist.hour;
        const minute = ist.minute;

async function sendDailyReportSafely(dateOverride = null) {
    try {
        await sendDailyReport(currentSock, { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids }, dateOverride);
        dailyReportSent = true;
    } catch (err) {
        console.error('[REPORT] ❌ Daily report failed:', err);
        const jids = await getCachedAdminJids().catch(() => []);
        const alertMsg = `⚠️ *Daily report failed to generate* for ${OUTLET_NAME} (${dateOverride || 'today'}).\nCheck \`pm2 logs ${OUTLET}-bot\` for details.`;
        await Promise.all((jids || []).map(jid => sock.sendMessage(jid, { text: alertMsg }).catch(() => {})));
    }
}

        // 1. Daily Report at 9:30 PM (21:30)
        if (hour === 21 && minute === 30 && !dailyReportSent) {
            await sendDailyReportSafely();
        }

        // 2. Late Night Catch-up (If bot was off at 21:30, send it at 1:30 AM for YESTERDAY)
        if (hour === 1 && minute === 30 && !dailyReportSent) {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const yDateStr = getISTDateString(yesterday.toISOString());
            await sendDailyReportSafely(yDateStr);
        }

        // Reset flags at 4 AM IST
        if (hour === 4 && minute === 0) {
            dailyReportSent = false;
            weeklyReportSent = false;
            monthlyReportSent = false;
        }

        // 4. Promotion heartbeat: pick up scheduled campaigns whose runAt is due.
        promo.pickupScheduledPromotions(currentSock, { OUTLET, db }).catch(err => console.error("[Promo] Scheduled pickup error:", err));

        // 5. Expire promotion logs older than 30 days (best-effort, every 5 min)
        promo.expireOldPromoLogs(OUTLET, db).catch(err => console.error("[Promo] Log expiry error:", err));
    }, 300000);

    // Firebase Listeners — Only initialize once, reuse across reconnects
    if (!firebaseListenersInitialized) {
        const orderRef = db.ref(resolvePath('orders', OUTLET));

        // In-memory (not Redis) short-window debounce: a single order update
        // from the app often writes several fields in quick succession
        // (status, otp, discountVerified, stockDeducted, _fcmSent, ...),
        // and each write fires its own child_changed event. Key on
        // orderId+status (not just orderId) so this only ever collapses
        // truly redundant re-fires of the SAME status — a genuine rapid
        // status transition (different status value) always goes through
        // immediately, regardless of timing. The real send-dedup lives in
        // getProcessedStatus/saveProcessedStatus and is unaffected either way;
        // this purely cuts redundant Redis lookups/logging for same-status noise.
        const _recentChildChanged = new Map(); // orderId -> { status, ts }
        const CHILD_CHANGED_DEBOUNCE_MS = 2000;

        orderRef.on("child_changed", (snap) => {
            const order = snap.val();
            const now = Date.now();
            const last = _recentChildChanged.get(snap.key);
            const sameStatusRecently = last && last.status === order?.status && (now - last.ts) < CHILD_CHANGED_DEBOUNCE_MS;
            _recentChildChanged.set(snap.key, { status: order?.status, ts: now });
            // Evict old entries so this map doesn't grow unbounded over a long-running process.
            if (_recentChildChanged.size > 500) {
                const cutoff = now - CHILD_CHANGED_DEBOUNCE_MS * 5;
                for (const [k, v] of _recentChildChanged) { if (v.ts < cutoff) _recentChildChanged.delete(k); }
            }
            if (sameStatusRecently) return;
            if (order && currentSock) handleOrderStatusUpdate(currentSock, snap.key, order);
            // Dine-in QR orders (tableSessions flow) get discount/total
            // computed client-side in menu/js/order.js, same unverified
            // pattern the webview_delivery fix already closed. This is
            // the sibling fix for that channel — see verifyQrOrderDiscount.
            if (order && order.source === 'QR' && order.status === 'Placed' && !order.discountVerified) {
                verifyQrOrderDiscount(snap.key, order, OUTLET).catch(e =>
                    console.error(`[QROrder] Discount verification error for ${snap.key}:`, e));
            }
        });
        orderRef.on("child_added", async (snap) => {
            const order = snap.val();
            if (!order || !currentSock) return;

        // Only handle "new" orders if they were created after the bot started
        const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : 0;
        const type = (order.type || order.orderType || "").toLowerCase();
        const isDineIn = type.includes("dine") || type.includes("walk");

        // Be more lenient for Dine-in (30 mins) to ensure counter bookings are not missed
        const timeBuffer = isDineIn ? 1800000 : 10000;

        const currentProcessedStatus = await getProcessedStatus(snap.key);
        const isNewOrder = orderTime > startupTime - timeBuffer;
        if (!currentProcessedStatus && isNewOrder) {
            // --- WEBVIEW DELIVERY ORDER: server-side finalization ---
            // The delivery webview (menu/delivery.html) writes the order
            // straight to Firebase (no chat round-trip). The side effects
            // (stock deduction, customer profile save, discount usage logging)
            // are handled inline here before the "Order Placed" message.
            if (order.source === "webview_delivery" && !order.stockDeducted) {
                try {
                    // --- SAFEST-FIRST: server-side discount re-validation ---
                    // This order was written directly by the customer's browser
                    // (menu/js/delivery-order.js), which computed discount/total
                    // client-side with nothing re-checking it server-side. Re-run
                    // the SAME evaluation the bot already trusts for WhatsApp
                    // orders, and overwrite whatever the client sent with the
                    // server-computed truth before anything (admin notification,
                    // stats, invoice) treats it as final.
                    try {
                        const cleanPhoneForDiscount = order.phone ? String(order.phone).replace(/\D/g, "").slice(-10) : null;
                        const customerForDiscount = cleanPhoneForDiscount ? await getData(`customers/${cleanPhoneForDiscount}`, order.outlet) : null;
                        const claimedCouponCode = (order.discountSource || '').startsWith('coupon:')
                            ? order.discountSource.slice('coupon:'.length)
                            : null;
                        // channel: 'website' — matches the "Website/App only" option
                        // in the discount editor; a discount scoped to 'whatsapp' or
                        // 'pos' only will correctly NOT apply here even if the
                        // client-side check let it through before this fix.
                        const verified = await discountEngine.evaluateDiscount({
                            OUTLET: order.outlet,
                            customer: customerForDiscount,
                            subtotal: order.subtotal,
                            couponCode: claimedCouponCode,
                            cart: order.items,
                            channel: 'website'
                        });
                        const correctedDiscount = verified ? verified.amount : 0;
                        const correctedTotal = Math.max(0, Math.round((order.subtotal || 0) + (order.deliveryFee || 0) - correctedDiscount));
                        if (correctedDiscount !== (order.discount || 0) || correctedTotal !== (order.total || 0)) {
                            console.warn(`[WebOrder] Discount mismatch on ${snap.key}: client claimed ₹${order.discount || 0} (total ₹${order.total}), server verified ₹${correctedDiscount} (total ₹${correctedTotal}). Correcting.`);
                        }
                        const correction = verified ? {
                            discount: correctedDiscount,
                            discountId: verified.discount.id,
                            discountLabel: verified.label,
                            discountSource: verified.source,
                            discountMode: verified.discount.mode || 'fixed',
                            discountValue: verified.discount.value || 0,
                            discountGlobalLimit: verified.discount.globalLimit || 0,
                            total: correctedTotal
                        } : {
                            discount: 0, discountId: null, discountLabel: null, discountSource: null,
                            discountMode: null, discountValue: 0, discountGlobalLimit: 0,
                            total: correctedTotal
                        };
                        await updateData(`orders/${snap.key}`, correction, order.outlet);
                        Object.assign(order, correction); // keep everything below consistent with the verified truth
                    } catch (discErr) {
                        console.error("[WebOrder] Discount re-validation failed:", discErr);
                        // Fail safe: if verification itself breaks, don't honor an
                        // unverified client-supplied discount — zero it out rather
                        // than risk giving away money on a check we couldn't run.
                        const safeTotal = Math.round((order.subtotal || 0) + (order.deliveryFee || 0));
                        const correction = { discount: 0, discountId: null, discountLabel: null, discountSource: null, discountMode: null, discountValue: 0, discountGlobalLimit: 0, total: safeTotal };
                        await updateData(`orders/${snap.key}`, correction, order.outlet).catch(() => {});
                        Object.assign(order, correction);
                    }

                    deductInventoryStock(currentSock, order.items, order.outlet).catch(e =>
                        console.error("[WebOrder] Stock deduction failed:", e));
                    await updateData(`orders/${snap.key}`, { stockDeducted: true }, order.outlet);

                    notifyAdmin(currentSock, snap.key, order, "NEW").catch(() => {});

                    if (order.phone) {
                        const cleanPhone = String(order.phone).replace(/\D/g, "").slice(-10);
                        const jid = formatJid(order.phone);
                        saveUserProfile(jid, {
                            name: order.customerName || "",
                            phone: order.phone,
                            address: order.address || "",
                            location: (order.lat && order.lng) ? { lat: order.lat, lng: order.lng } : null,
                            lastOutlet: order.outlet
                        }).catch(() => {});

                        const mapsLink = (order.lat && order.lng) ? `https://maps.google.com/?q=${order.lat},${order.lng}` : "";
                        db.ref(resolvePath(`customers/${cleanPhone}`, order.outlet)).transaction((existing) => {
                            const base = existing || {};
                            return {
                                ...base,
                                registeredAt: base.registeredAt || Date.now(),
                                name: order.customerName || base.name,
                                phone: cleanPhone,
                                address: order.address || base.address || "",
                                location: (order.lat && order.lng) ? { lat: order.lat, lng: order.lng } : (base.location || null),
                                mapsLink: mapsLink || base.mapsLink || "",
                                lastOrderDate: order.createdAt || new Date().toISOString(),
                                promotionalConsent: true,
                                orderCount: (base.orderCount || 0) + 1,
                                totalSpent: (base.totalSpent || 0) + (order.total || 0),
                                lastSeen: Date.now()
                            };
                        }).catch(() => {});
                    }

                    if (order.discount > 0 && order.discountId) {
                        discountEngine.recordDiscountUsage({
                            OUTLET: order.outlet,
                            discountId: order.discountId,
                            orderId: snap.key,
                            customerPhone: order.phone,
                            amountGiven: order.discount,
                            channel: "webview",
                            globalLimit: order.discountGlobalLimit,
                            discountLabel: order.discountLabel,
                            discountSource: order.discountSource
                        }).catch(() => {});
                    }
                } catch (webOrderErr) {
                    console.error("[WebOrder] Finalization error:", webOrderErr);
                }
            }

        }
        // ALWAYS call handleOrderStatusUpdate with isNew=true for new orders.
        // initFCMWatcher's _fcmSent write triggers child_changed which can
        // pre-cache status before child_added finishes, so we must not gate
        // the status notification on !currentProcessedStatus.
        if (isNewOrder) {
            await handleOrderStatusUpdate(currentSock, snap.key, order, true).catch(e => console.error("[CHILD-ADDED] handleOrderStatusUpdate error:", e));
        }
    });

    // Blocked numbers listener — keep cache in sync
    const blockedRef = db.ref(resolvePath('settings/Bot/blockedNumbers', OUTLET));
    blockedRef.on('value', (snap) => {
        const arr = snap.val();
        blockedNumbers = new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
        if (blockedNumbers.size > 0) console.log(`[BLOCKED] ${blockedNumbers.size} numbers blocked`);
    });

    firebaseListenersInitialized = true;
    }

    let _wasConnected = false;

    sock.ev.on('connection.update', (update) => {
        if (isMetaTransport) return; // Meta transport registers its own connection.update handler
        if (sock !== currentSock) return;
        const { connection, lastDisconnect, qr } = update;
        if (qr && _wasConnected) {
            // QR after connection was open = session expired (ban or re-pair needed)
            _writeBanAlert('session_expired', 'critical',
                'QR code received after connection was open — session expired or banned');
            updateData('bot/pair', { qr, status: 'banned', updatedAt: Date.now() }, OUTLET).catch(() => {});
        }
        if (qr) {
            qrcode.generate(qr, { small: true });
            updateData('bot/pair', { qr, status: 'waiting', updatedAt: Date.now() }, OUTLET).catch(() => {});
        }
        if (connection === 'open') {
            _sessionAlertSock = currentSock;
            _wasConnected = true;
            initFCMWatcher();
    console.log(`✅ ${OUTLET_NAME.toUpperCase()} BOT IS ONLINE`);
            console.log(`[AUTH] user=${JSON.stringify(sock.user)}`);
            reconnectAttempts = 0;
            cryptoErrorCount = 0;
            consecutiveSendFailures = 0;
            updateData('bot/pair', { qr: null, status: 'connected', connectedAt: Date.now() }, OUTLET).catch(() => {});
            getData('bot/pair', OUTLET).then((pair) => {
                if (!pair || !pair.firstLinkedAt) {
                    updateData('bot/pair', { firstLinkedAt: Date.now() }, OUTLET).catch(() => {});
                }
            }).catch(() => {});
        }
        const DISCONNECT_REASON_NAMES = Object.fromEntries(
            Object.entries(DisconnectReason).map(([name, code]) => [code, name])
        );

        if (connection === 'close') {
            _wasConnected = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            const reasonName = DISCONNECT_REASON_NAMES[code] || `unknown(${code})`;
            if (code === DisconnectReason.loggedOut) {
                _writeBanAlert('session_invalidated', 'critical',
                    `Logged out (DisconnectReason.loggedOut, code=${code}) — session banned or revoked`);
                updateData('bot/pair', { qr: null, status: 'logged_out', updatedAt: Date.now() }, OUTLET).catch(() => {});
                // Pause all promo campaigns on ban
                getData('bot/promotions', OUTLET).then((promos) => {
                    if (promos?.enabled) {
                        updateData('bot/promotions', { enabled: false, killSwitch: true, bannedAt: Date.now() }, OUTLET).catch(() => {});
                        console.log(`[SESSION-INVALIDATION] Auto-paused promotions for ${OUTLET}`);
                    }
                }).catch(() => {});
            } else {
                reconnectAttempts++;
                const delay = Math.min(5000 * Math.pow(3, Math.min(reconnectAttempts - 1, 3)), 120000);
                console.log(`🔌 Disconnected [${reasonName}, code=${code}] (attempt ${reconnectAttempts}). Reconnecting in ${(delay / 1000).toFixed(0)}s...`);
                if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startBot(); }, delay);
            }
        }
    });

    // Resume any campaigns that were running when the bot last lost connection.
    // Scans `bot/{outlet}/promotions/campaigns` for status==='running' and
    // rebuilds the command payload from the stored campaign doc.
    promo.resumeStuckPromotions(currentSock, { OUTLET, db }).catch(err => console.error("[Promo] Resume sweep error:", err));

    // =============================
    // 5. MESSAGE HANDLER (INTERNAL)
    // =============================
    sock.ev.on('messages.upsert', async (m) => {
        try {
            // Skip if this is from an old socket (reconnected)
            if (sock !== currentSock) return;
            if (m.type !== 'notify') return;
            const msg = m.messages[0];
            if (!msg.message) {
                // Crypto/session decryption failure (Baileys internal - Bad MAC etc.)
                cryptoErrorCount++;
                // Log only every 100th failure, or if a minute passed since last log
                const now = Date.now();
                if (cryptoErrorCount % 100 === 1) {
                    console.warn(`[CRYPTO] ⚠️ ${cryptoErrorCount} messages undecryptable so far. StubType: ${msg.messageStubType || 'N/A'}`);
                }
                // Auto-recovery: if crypto errors spike, aggressively prune session files
                if (cryptoErrorCount === MAX_CRYPTO_ERRORS) {
                    console.error(`[CRYPTO] 🔴 ${MAX_CRYPTO_ERRORS}+ undecryptable messages. Auto-pruning stale sessions...`);
                    try {
                        if (fs.existsSync(SESSION_DIR)) {
                            const files = fs.readdirSync(SESSION_DIR);
                            let pruned = 0;
                            for (const file of files) {
                                if (file === 'creds.json') continue;
                                try { fs.unlinkSync(path.join(SESSION_DIR, file)); pruned++; } catch (_) {}
                            }
                            console.log(`[CRYPTO] 🧹 Auto-pruned ${pruned} session files. Bot will re-establish sessions on next messages.`);
                        }
                    } catch (_) {}
                }
                return;
            }
            if (msg.key.fromMe) return;

            let sender = msg.key.remoteJid;
            // Blocklist check — silently ignore messages from blocked numbers
            if (isBlockedJid(sender, blockedNumbers)) {
                console.log(`[BLOCKED] Ignoring message from ${(sender || '').replace(/[^0-9]/g, '').slice(-4)}`);
                return;
            }

            // Deduplication to prevent double responses
            const msgId = msg.key?.id || Math.random().toString(36).slice(2);
            if (await getProcessedStatus(msgId)) return;
            saveProcessedStatus(msgId, { ts: Date.now() }).catch(() => {});

            // Mark as read (fire-and-forget — don't block processing)
            sock.readMessages([msg.key]).catch(() => {});

            // sender already declared above for blocklist check
            // Baileys 6.x supports @lid natively — keep the JID as-is from WhatsApp
            // for consistent session keys and correct routing via relayMessage's isLid path.
            // Prevents session fragmentation between @lid and @s.whatsapp.net formats.
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            const pushName = msg.pushName || "";
            console.log(`[IN] ${maskJid(sender)}: "${text.slice(0, 80)}"`);

            // Chat history — log every inbound message (incl. STOP/START)
            // BEFORE the opt-out handler so those replies still land in the
            // thread. Best-effort; groups/broadcasts are skipped (not threads).
            try {
                const isGroupish = sender.includes('@g.us') || sender.includes('@broadcast') || sender.includes('@newsletter');
                if (!isGroupish) {
                    logChatMessage({ outlet: OUTLET, jid: sender, msgId, from: 'customer', text, name: pushName || undefined });
                }
            } catch (chatLogErr) {
                console.warn("[CHAT-LOG] inbound hook error:", chatLogErr.message);
            }

            // --- PROMOTIONAL OPT-OUT / OPT-IN HANDLER ---
            // Detect STOP / START from non-admin senders BEFORE the order-flow
            // state machine so it short-circuits the rest of the handler.
            // IMPORTANT: opt-out keys are stored as last-10-digits (matches
            // the customers/ keys) so the recipient filter can use a simple
            // set-membership check.
            try {
                const adminNumbers = await getCachedAdminJids();
                const isAuthorized = adminNumbers.includes(sender) || sender.startsWith(DEVELOPER_NUMBER);
                if (!isAuthorized && text) {
                    const optOutKey = sender.replace(/[^0-9]/g, '').slice(-10);
                    if (/^(stop|unsubscribe|opt[\s-]?out)$/i.test(text)) {
                        await updateData(`bot/promotions/optout/${optOutKey}`, {
                            jid: sender, optedOutAt: Date.now()
                        }, OUTLET);
                        await sock.sendMessage(sender, {
                            text: "✅ You've been unsubscribed from promotional messages. Reply START to opt back in anytime."
                        });
                        return;
                    }
                    if (/^start$/i.test(text)) {
                        const optoutSnap = await db.ref(resolvePath(`bot/promotions/optout/${optOutKey}`, OUTLET)).once('value');
                        if (optoutSnap.exists()) {
                            await db.ref(resolvePath(`bot/promotions/optout/${optOutKey}`, OUTLET)).update({ reOptInAt: Date.now() });
                            await sock.sendMessage(sender, { text: "🎉 Welcome back! You're re-subscribed to promotional messages." });
                            return;
                        }
                    }

                    // SAFEST-FIRST: a first-time contact (no existing order session)
                    // whose message reads as confusion or rejection ("who is this",
                    // "not interested", "wrong number", etc.) must NOT receive the
                    // full greeting-image + menu + order-button blast. Sending more
                    // promotional content in reply to a rejection is exactly the
                    // pattern WhatsApp's spam classifier flags — this short-circuits
                    // it with one plain line instead, and quietly opts them out so a
                    // later promo campaign doesn't re-contact them either.
                    const isRejectionReply = /^(who( is)?( this| dis)?\??|what('?s| is)?( this)?\??|why( me)?\??|not interested\.?|no,?\s*thanks?\.?|wrong number\.?|leave me alone\.?|don'?t (message|text|contact) me\.?|who dis\??)$/i.test(text.trim());
                    if (isRejectionReply) {
                        const existingSession = await getSession(sender);
                        if (!existingSession) {
                            await updateData(`bot/promotions/optout/${optOutKey}`, {
                                jid: sender, optedOutAt: Date.now(), reason: 'auto-rejection-reply'
                            }, OUTLET);
                            await sock.sendMessage(sender, {
                                text: "Maaf kijiye disturb karne ke liye — yeh " + OUTLET_NAME + " ka WhatsApp order line hai. Aapko aage koi message nahi bheja jayega. Jab bhi order karna ho, *START* type kar dena."
                            });
                            return;
                        }
                    }
                }
            } catch (optOutErr) {
                console.error("[Promo] Opt-out handler error:", optOutErr.message);
            }

            // Show typing indicator (fire-and-forget — don't block processing)
            sock.sendPresenceUpdate('composing', sender).catch(() => {});

            // SAFEST-FIRST: everything from session read through save runs
            // inside a per-sender lock — prevents duplicate orders from
            // rapid double-taps (see withSenderLock above).
            await withSenderLock(sender, async () => {
            let user = await getSession(sender);
            if (!user) {
                const profile = await getUserProfile(sender, OUTLET);
                user = {
                    step: "START",
                    current: {},
                    cart: [],
                    pushName: pushName,
                    msgCount: 0,
                    lastReset: Date.now(),
                    profile: profile || null,
                    name: profile?.name || null,
                    phone: profile?.phone || sender.split('@')[0].slice(-10),
                    address: profile?.address || null,
                    location: profile?.location || null
                };

                if (profile && profile.name) {
                    user.hasProfile = true;
                }
            }
            user.lastActivity = Date.now();

            // Run message logic in an IIFE to capture all early returns,
            // so we can safely save the user session to Redis at the end.
            await (async () => {

                console.log(`[FLOW] step=${user.step || "null"} text="${text.slice(0, 40)}" sid=${user.msgCount}`);

                // --- RATE LIMITING ---
                const now = Date.now();
                if (now - user.lastReset > 60000) {
                    user.msgCount = 0;
                    user.lastReset = now;
                }
                user.msgCount++;

                // --- ADMIN COMMANDS ---
                const adminNumbers = await getCachedAdminJids();
                const isAuthorized = adminNumbers.includes(sender) || sender.startsWith(DEVELOPER_NUMBER);

                if (isAuthorized && text.startsWith('!')) {
                    const cmd = text.toLowerCase().slice(1);
                    console.log(`[ADMIN] Command: ${cmd} from ${sender}`);

                    if (cmd === 'report' || cmd === 'sales') {
                        await sock.sendMessage(sender, { text: "⏳ Generating latest sales report..." });
                        await sendDailyReport(sock, { OUTLET, OUTLET_NAME, OUTLET_EMOJI, getData, getCachedAdminJids });
                        return;
                    }
                    if (cmd === 'status') {
                        const uptime = Math.floor(process.uptime() / 60);
                        const processed = await getProcessedStatus('global') || {};
                        const count = Object.keys(processed || {}).length;
                        const statusMsg = `🤖 *BOT STATUS DASHBOARD*\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `✅ Status: *Online*\n` +
                            `⏱️ Uptime: *${uptime} mins*\n` +
                            `📊 Orders in Memory: *${count}*\n` +
                            `🔗 Socket JID: *${sock.user?.id || 'Connected'}*\n` +
                            `━━━━━━━━━━━━━━━━━━━━`;
                        return await sock.sendMessage(sender, { text: statusMsg });
                    }
                    if (cmd === 'ping') {
                        return await sock.sendMessage(sender, { text: "🏓 *Pong!* Bot is active and listening." });
                    }
                }

                if (user.msgCount > 40) {
                    if (user.msgCount === 41) {
                        await sock.sendMessage(sender, { text: "⚠️ *Slow down!* You're sending messages too fast. Please wait a moment before trying again." });
                    }
                    return;
                }

                if (text.toLowerCase() === "cancel" || text.toLowerCase() === "reset") {
                    user.step = "START"; user.current = {}; user.cart = [];
                    return sock.sendMessage(sender, { text: "❌ *Order Reset.* Reply with any message to start again." });
                }

                // STATE MACHINE
                if (user.step === "START") {
                    user.outlet = OUTLET; // Hardcoded — no outlet selection needed
                    const store = await getData("settings/Store", OUTLET);

                    // Check if shop is open before showing menu
                    if (store && !isShopOpen(store.shopOpenTime, store.shopCloseTime, store.shopStatus)) {
                        return sock.sendMessage(sender, { text: `🌙 *${OUTLET_NAME.toUpperCase()} IS CLOSED*\n════════════════════════\nHours: ${store.shopOpenTime || 'N/A'} - ${store.shopCloseTime || 'N/A'}\n════════════════════════\nSee you later! 👋` });
                    }

                    // SAFEST-FIRST: never blast the order-link/menu-image CTA at a
                    // first-time contact on spec. Only explicit order-intent words
                    // (menu/order) trigger the full flow. Greetings like
                    // hi/hello/hey get a plain welcome with Hinglish instructions.
                    if (/^(menu|order)$/i.test(text.trim())) {
                        await sendOrderFlow(sock, sender, pushName, user);
                        user.step = "WEBVIEW";
                        return;
                    }

                    let plainWelcome = (user?.hasProfile && user?.name)
                        ? `Namaste *${user.name}* ji! 👋 *${OUTLET_NAME}* mein wapas aane ke liye shukriya.`
                        : `Namaste *${pushName}*! 👋 Yeh *${OUTLET_NAME}* ka WhatsApp ordering bot hai.`;
                    plainWelcome += `\n\n🍽️ *Khana order karne ke liye:* **Menu** ya **Order** type karein — menu + link turant milega.`;
                    await sock.sendMessage(sender, { text: plainWelcome });
                    user.step = "AWAITING_ORDER_INTENT";
                    return;
                }

                // AWAITING_ORDER_INTENT: greeted, but hasn't confirmed they want to
                // order yet. Only explicit order-intent words trigger the full flow.
                if (user.step === "AWAITING_ORDER_INTENT") {
                    if (/^(menu|order)$/i.test(text.trim())) {
                        const store = await getData("settings/Store", OUTLET);
                        await resendMenuCTA(sock, sender, user, store, null);
                        user.step = "WEBVIEW";
                        return;
                    }
                    // Already handled by the opt-out/rejection block above for exact
                    // matches; anything else just gets one quiet nudge, no CTA.
                    return sock.sendMessage(sender, { text: `🍽️ *Khana order karne ke liye:* **Menu** ya **Order** type karein — link turant milega! 🙏` });
                }

// WEBVIEW STEP: User is ordering via webview link
                // Every message triggers the full flow (greeting + menu + order button),
                // reusing this phone's token within 30 min of generation.
                if (user.step === "WEBVIEW") {
                    // C3: Menu keywords → resend just the menu CTA
                    if (/^(order|menu|food|start|restart|hi+|hello+|hey+)$/i.test(text)) {
                        return resendMenuCTA(sock, sender, user);
                    }
                    // C4: Track/status keywords → nudge to use webview
                    if (/^(track|status|where)$/i.test(text)) {
                        return sock.sendMessage(sender, { text: "📋 Tap the menu link above to order again. Your recent orders will show in the webview." });
                    }
                    // C5: Anything else → nudge + resend the menu CTA
                    return resendMenuCTA(sock, sender, user, null, null, `💡 *Tap below to browse & order!*`);
                }


            })(); // <-- End of Message Handler IIFE

            // Final Session Save
            await saveSession(sender, user);
            }); // <-- End of per-sender lock (withSenderLock)

        } catch (err) { console.error("Message Handler Error:", err); }
    });

    if (isMetaTransport) {
        await sock.start();
    }
}

// Watch for new orders from non-WA sources (QR menu, REST API) → send FCM to admins
function initFCMWatcher() {
  const ONE_MIN_MS = 60000;
  const orderState = new Map(); // orderId -> { riderId, status } (RTDB child_changed has no `before`)

  // Bot runs as single-outlet instance (determined by process.env.OUTLET)
  // resolvePath('orders') uses the bot's own outlet from process.env.OUTLET
  const ordersRef = db.ref(resolvePath('orders'));

  ordersRef.on('child_added', (snap) => {
    const order = snap.val() || {};
    orderState.set(snap.key, { riderId: order.riderId, status: order.status });
    if (order._fcmSent) return;
    const createdAt = new Date(order.createdAt).getTime();
    if (Date.now() - createdAt > ONE_MIN_MS) return; // skip old orders on restart
    sendFCMToAdmins(snap.key, order).catch(() => {});
    snap.ref.child('_fcmSent').set(true).catch(() => {});
  });

  // Rider push on assignment / key status change (this bot only handles its own outlet)
  // The outlet is derived from the listener's scope, not from order data
  // (QR/menu orders don't have an 'outlet' field on the record)
  // Use the bot's configured outlet for FCM payload
  const botOutlet = resolveOutletId();
  ordersRef.on('child_changed', async (snap) => {
    const after = snap.val() || {};
    const orderId = snap.key;
    const before = orderState.get(orderId) || {};
    orderState.set(orderId, { riderId: after.riderId, status: after.status });
    if (after.riderId && after.riderId !== before.riderId) {
      // Resolve rider UID for FCM token lookup (riderId on order may be email or UID)
      let riderUid = after.riderId;
      if (riderUid && !riderUid.includes('@') && riderUid.length > 20) {
        // Likely already a UID (long Firebase UID)
      } else if (riderUid && riderUid.includes('@') && !riderUid.includes('@s.whatsapp.net') && !riderUid.includes('@g.us') && !riderUid.includes('@broadcast')) {
        // Looks like an email - resolve to UID
        const rider = await getRiderByEmail(riderUid, botOutlet);
        riderUid = rider?.uid || riderUid;
      }
      if (riderUid) {
        sendFCMToRider(riderUid, 'New Order Assigned!', `Order #${formatOrderId(after.orderId || orderId)} for ₹${after.total || 0} — Please check the app.`, { orderId, outlet: botOutlet, type: 'rider_assigned', url: './index.html' });
      }
    } else if (after.riderId && after.status && after.status !== before.status) {
      const s = String(after.status).toLowerCase();
      // Resolve rider UID for status change FCM
      let riderUid = after.riderId;
      if (riderUid && !riderUid.includes('@') && riderUid.length > 20) {
        // Likely already a UID
      } else if (riderUid && riderUid.includes('@') && !riderUid.includes('@s.whatsapp.net') && !riderUid.includes('@g.us') && !riderUid.includes('@broadcast')) {
        const rider = await getRiderByEmail(riderUid, botOutlet);
        riderUid = rider?.uid || riderUid;
      }
      if (['ready', 'packed', 'cooked'].includes(s)) {
        if (riderUid) sendFCMToRider(riderUid, `Order #${formatOrderId(after.orderId || orderId)}`, `Order #${formatOrderId(after.orderId || orderId)} is ready for pickup!`, { orderId, outlet: botOutlet, type: 'status_change', status: after.status });
      } else if (s === 'cancelled') {
        if (riderUid) sendFCMToRider(riderUid, `Order #${formatOrderId(after.orderId || orderId)}`, `Order #${formatOrderId(after.orderId || orderId)} has been cancelled.`, { orderId, outlet: botOutlet, type: 'status_change', status: after.status });
      }
    }
  });
}

startBot();