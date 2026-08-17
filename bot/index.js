/**
 * ROSHANI ERP | WHATSAPP BOT CORE v4.0
 * Single-Outlet Instance (Pizza-Bot / Cake-Bot)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// =============================
// OUTLET CONFIGURATION (UNIFIED CORE)
// =============================
const OUTLET = (process.env.OUTLET || 'pizza').trim();
let OUTLET_NAME = 'Our Restaurant';
const OUTLET_EMOJI = OUTLET === 'pizza' ? '🍕' : '🎂';
let OTHER_OUTLET_NAME = 'Our Other Store';
const OTHER_OUTLET_EMOJI = OUTLET === 'pizza' ? '🎂' : '🍕';
const OTHER_OUTLET_NUMBER = '';
// Fixed developer number (mirrors getReportRecipients). Used by promo opt-out
// filter to recognize admin senders and let them continue ordering.
const DEVELOPER_NUMBER_FALLBACK = "9724649971";

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
const { resolveBusinessIdFor } = require('./helpers/outlet-resolution');
const { createMetaTransport, getTransportMode, getPhoneNumberId } = require('./transport');
const discountEngine = require('./discount-engine');

// ── Extracted modules ──────────────────────────────────────────────────────
const {
    formatJid, maskJid,
    getISTDateInfo, getISTDateString, isShopOpen,
    calculateDistance, getFeeFromSlabs,
    formatCartSummary, formatOrderInvoice, getFunnyFoodJoke, getFoodFunnyProgress,
    isSocketDead
} = require('./utils');
const promo = require('./promotions');
const { sendDailyReport, sendMonthlyReport, sendWeeklyReport } = require('./reports');
const riderNotify = require('./rider');

let redisClient;

// Admin JIDs cache — refreshed every 5 minutes to avoid per-message Firebase calls
let cachedAdminJids = null;
let cachedAdminJidsExpiry = 0;
const ADMIN_CACHE_TTL = 300000;
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
    redisClient.connect().then(() => {
        redisReady = true;
        console.log('✅ Connected to Redis');
    }).catch(console.error);
}

// --- GLOBAL STATE (Migrating to Redis) ---
// We keep local variables for temporary locks if needed, but primary state moves to Redis
let reportInterval = null;
let dailyReportSent = false;
let weeklyReportSent = false;
let monthlyReportSent = false;
const startupTime = Date.now();

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

// In-memory dedup fallback used when Redis is offline
const localStatusCache = new Map();
const LOCAL_CACHE_TTL = 3600000; // 1 hour
// In-memory session fallback when Redis is unavailable
const localSessionCache = new Map();

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
            const data = await redisClient.get(`status:${id}`);
            if (data) return JSON.parse(data);
        }
    } catch (e) { }
    return localStatusCache.get(id) || null;
}
async function saveProcessedStatus(id, data) {
    try {
        if (data) {
            localStatusCache.set(id, data);
            if (redisReady) await redisClient.setEx(`status:${id}`, STATUS_TTL, JSON.stringify(data));
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
    const DEVELOPER_NUMBER = "9724649971"; // Fixed Developer

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

async function generateOrderId(outlet = 'pizza') {
    const today = new Date();
    const y = today.getFullYear();
    const m = (today.getMonth() + 1).toString().padStart(2, '0');
    const d = today.getDate().toString().padStart(2, '0');
    const dateStr = `${y}${m}${d}`;

    const seqRef = db.ref(resolvePath(`metadata/orderSequence/${dateStr}`, outlet));
    const result = await seqRef.transaction((current) => (current || 0) + 1);

    const seqNum = result.snapshot.val() || 1;
    return `${dateStr}-${seqNum.toString().padStart(4, '0')}`;
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
    return sendImage(sock, sender, menuImg, `${ctaText}\n--------------------------\n${menuUrl}`, OUTLET, true);
}

// Full greeting flow: greeting image + menu + order button. Token reused within 30 min.
async function sendOrderFlow(sock, sender, pushName, user) {
    const [store, bot] = await Promise.all([
        getData("settings/Store", OUTLET),
        getData("settings/Bot", OUTLET)
    ]);

    let welcome = (user?.hasProfile && user?.name)
        ? `Welcome back, *${user.name}*! 👋\nYour favorite items are ready for you. ${OUTLET_EMOJI}`
        : `Hello *${pushName}*! 👋`;
    welcome += `\n------------------------`;
    welcome += `\n✨ *WELCOME TO ${OUTLET_NAME.toUpperCase()}* ${OUTLET_EMOJI}`;
    welcome += `\n------------------------`;
    welcome += `\nDelicious food, delivered fast to your doorstep! 🚀`;
    const greetingImg = bot?.greetingImage || store?.bannerImage;
    await sendImage(sock, sender, greetingImg, welcome);

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
    if (!ctaText) ctaText = `🛒 *Ready to order?*\n👇 *TAP THE LINK BELOW TO ORDER NOW* 👇`;
    return sendOrderCTA(sock, sender, menuImg, ctaText, menuUrl);
}

async function appendContactInfo(text, outlet = 'pizza') {
    if (!text) return '';
    try {
        const storeSettings = await getData("settings/Store", outlet) || {};
        const deliverySettings = await getData("settings/Delivery", outlet) || {};
        const DEVELOPER_NUMBER = "9724649971";
        const adminNum = storeSettings.phone || deliverySettings.reportPhone || DEVELOPER_NUMBER;
        return `${text}\n${'-'.repeat(32)}\nIf you have any Doubt Contact Admin: *${adminNum}*`;
    } catch (e) {
        return text;
    }
}

async function sendImage(sock, to, image, text, outlet = 'pizza', skipContact = false) {
    const finalMsg = skipContact ? text : await appendContactInfo(text, outlet);
    if (!image) {
        await sock.sendMessage(to, { text: finalMsg });
        return;
    }
    try {
        let payload;
        if (typeof image === 'string' && image.startsWith('data:image')) {
            const base64Data = image.split(',')[1];
            payload = { image: Buffer.from(base64Data, 'base64'), caption: finalMsg };
        } else {
            payload = { image: { url: image }, caption: finalMsg };
        }
        await sock.sendMessage(to, payload);
    } catch (err) {
        console.error("Image Send Error:", err.message || err);
        // Fallback to text ONLY if it wasn't already a text message failure
        try {
            await sock.sendMessage(to, { text: finalMsg });
        } catch (textErr) {
            console.error("Critical Send Error:", textErr.message || textErr);
        }
    }
}

async function deductInventoryStock(sock, items, outlet = 'pizza') {
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
                        `🚩 Threshold: *${threshold}*\n------------------------\n` +
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

async function getRiderByEmail(email, outlet = 'pizza') {
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

async function addInAppNotification(uid, title, body, type = 'info', icon = 'bell', outlet = 'pizza') {
    if (!uid) return;
    try {
        const notifId = "NOTIF" + Date.now();
        await setData(`riders/${uid}/notifications/${notifId}`, {
            id: notifId, title, body, type, icon, timestamp: Date.now(), read: false
        }, outlet);
    } catch (err) { console.error("Notification Error:", err); }
}

async function sendInvalidInputHelp(sock, sender, user) {
    let helpMsg = "⚠️ *Invalid Selection.* ";
    switch (user.step) {
        case "CATEGORY":
            helpMsg += "Please reply with a *Category Number* from the list above.\n------------------------\n🛒 *9* View Cart\n🏠 *0* Main Menu";
            break;
        case "DISH":
            helpMsg += "Please reply with an *Item Number* from the list above.\n------------------------\n🛒 *9* View Cart\n🔙 *0* Back to Categories";
            break;
        case "SIZE":
            helpMsg += "Please select a *Size Number* (1, 2, etc.) from the options above.";
            break;
        case "ADDONS":
            helpMsg += "Reply with an *Add-on Number* to add it, or *0* (Zero) if you are *DONE*.";
            break;
        case "QUANTITY":
            helpMsg += "Please enter a quantity between *1* and *50*.";
            break;
        case "LOCATION":
            helpMsg += "You *must* share your location to proceed.\n\n📍 *How to share:*\n1️⃣ Tap 📎 (Paperclip) or *+* → *Location* → *Send Your Current Location*\n\n⚙️ *If Location option is missing:*\n→ *Settings > Apps > WhatsApp > Permissions > Location* → Allow\n→ Turn ON *GPS/Location Services* in phone settings";
            break;
        case "CONFIRM_PAY":
            helpMsg += "Please reply with *1* to Confirm Order or *2* to Cancel.";
            break;
        case "PLACE_ORDER":
            helpMsg += "Please reply with *1* for Cash or *2* for UPI.";
            break;
        case "CART_VIEW":
            helpMsg += "Please reply with *1* to Proceed to Checkout or *2* to Clear Cart.";
            break;
        case "AWAIT_COUPON":
            helpMsg += "If you have a coupon code, reply with it. Otherwise reply *0* to skip and continue.";
            break;
        case "REUSE_PROFILE":
            helpMsg += "Please reply with *1* to use your saved details or *2* to enter new ones.";
            break;
        default:
            helpMsg += "Please follow the instructions in the message above or reply *RESET* to start over.";
    }
    try {
        const result = await sock.sendMessage(sender, { text: helpMsg });
        console.log(`[SEND OK] to ${maskJid(sender)} id=${result?.key?.id} fromMe=${result?.key?.fromMe}`);
    } catch (err) {
        console.error(`[SEND ERR] to ${maskJid(sender)}:`, err.message);
    }
}

// =============================
// 3. CORE BOT LOGIC (SOCKET WRAPPER)
// =============================

async function sendCategories(sock, sender, user) {
    const outlet = user.outlet || 'pizza';
    const [categories, botSettings, storeSettings] = await Promise.all([
        getData('categories', outlet),
        getData("settings/Bot", outlet).catch(() => ({})),
        getData("settings/Store", outlet).catch(() => ({}))
    ]);
    if (!categories) return sock.sendMessage(sender, { text: "❌ No categories available right now." });

    user.categoryList = Object.entries(categories).map(([id, val]) => ({ id, ...val }));

    const storeName = storeSettings.storeName || 'Our Restaurant';
    const emoji = outlet === 'pizza' ? "🍕" : "🎂";
    const headerEmoji = outlet === 'pizza' ? "🔥" : "✨";

    let msg = `✨ *${storeName.toUpperCase()}* ✨\n`;
    msg += `🍽️ *SELECT CATEGORY - ${outlet.toUpperCase()}*\n`;

    user.categoryList.forEach((c, i) => {
        msg += `${i + 1}️⃣  ${c.name}\n`;
    });

    msg += `🛒 *9* View Cart\n0️⃣ *Take one step Back* 🔙\n`;
    msg += `_Reply with a number to browse_`;

    user.step = "CATEGORY";
    const menuImg = botSettings.menuImage || storeSettings.bannerImage;
    await sendImage(sock, sender, menuImg, msg);
}

async function sendCartView(sock, sender, user, isAdded = false) {
    if (!user.cart || user.cart.length === 0) {
        let msg = `🛒 *YOUR CART IS EMPTY*\n`;
        msg += `You haven't added anything to your cart yet. 🍕\n`;
        msg += `1️⃣  *Browse Menu* 🍽️\n`;
        msg += `🏠 *0* Main Menu`;
        user.step = "EMPTY_CART_VIEW";
        return sock.sendMessage(sender, { text: msg });
    }
    const { lines, subtotal } = formatCartSummary(user.cart);
    let msg = `${isAdded ? `✅ *ADDED TO CART!* 🛒` : `🛒 *YOUR CART SUMMARY*`}\n`;
    msg += lines;
    msg += `------------------------\n💰 *Subtotal: ₹${subtotal}*\n`;
    msg += `1️⃣  *Add another item* 🍕\n`;
    msg += `2️⃣  *Proceed to Checkout* 🚀\n`;
    msg += `3️⃣  *Clear Cart* 🗑️\n`;
    msg += `0️⃣  *Back* 🔙\n`;
    msg += `_Reply with 1, 2, 3 or 0_`;
    user.step = "CART_VIEW";
    return sock.sendMessage(sender, { text: await appendContactInfo(msg, user.outlet) });
}

async function sendFCMToAdmins(orderId, order) {
    try {
        const outlet = order.outlet || 'pizza';
        const snap = await db.ref('admins').once('value');
        const admins = snap.val();
        if (!admins) return;
        const tokens = Object.values(admins).map(a => a.fcmToken).filter(Boolean);
        if (tokens.length === 0) return;
        const unique = [...new Set(tokens)];
        const title = `🆕 New Order #${orderId.slice(-5)}`;
        const body = `${order.customerName || 'Customer'} · ₹${order.total || 0} · ${outlet.toUpperCase()}`;
        const results = await admin.messaging().sendEachForMulticast({
            tokens: unique,
            notification: { title, body },
            data: { orderId, outlet, type: 'new_order', title, body },
            android: { priority: "high", ttl: "86400s" },
            webpush: { headers: { TTL: "86400", Urgency: "high" } }
        });
        const failed = results.responses.filter(r => !r.success).length;
        if (failed > 0) console.warn(`[FCM] ${failed}/${unique.length} admin notifications failed`);
    } catch (e) {
        console.error('[FCM] sendFCMToAdmins error:', e.message);
    }
}

async function notifyAdmin(sock, orderId, order, type = 'NEW') {
    try {
        if (!sock || isSocketDead(sock)) return;
        const outlet = order.outlet || 'pizza';
        const jids = await getCachedAdminJids();
        if (!jids || jids.length === 0) return;

        let msg = "";
        if (type === 'CANCELLED') {
            msg = `⚠️ *LOST SALE / ABANDONED* ⚠️\n━━━━━━━━━━━━━━━━━━━━\n👤 *Customer:* ${order.customerName || 'Anonymous'}\n📞 *Phone:* ${order.phone || 'N/A'}\n💰 *Potential Total:* ₹${order.total || 0}\n🏪 *Outlet:* ${outlet.toUpperCase()}\n━━━━━━━━━━━━━━━━━━━━\n_User cancelled at final checkout step._`;
        } else if (type === 'RIDER_ACCEPTED') {
            const riderName = order.riderName || order.riderId || order.assignedRider || 'A rider';
            msg = `🛵 *RIDER ON THE WAY TO RESTAURANT* 🛵\n━━━━━━━━━━━━━━━━━━━━\n🆔 ID: #${orderId.slice(-5)}\n👤 Customer: ${order.customerName || 'N/A'}\n📞 Phone: ${order.phone || 'N/A'}\n🛵 Rider: ${riderName}\n📞 Rider Phone: ${order.riderPhone || 'N/A'}\n━━━━━━━━━━━━━━━━━━━━\n_Get the order ready for pickup._`;
        } else if (type === 'RIDER_ARRIVED') {
            const riderName = order.riderName || order.riderId || order.assignedRider || 'A rider';
            msg = `🛵 *RIDER ARRIVED AT RESTAURANT* 🛵\n━━━━━━━━━━━━━━━━━━━━\n🆔 ID: #${orderId.slice(-5)}\n🛵 Rider: ${riderName}\n━━━━━━━━━━━━━━━━━━━━\n_Hand over the order for pickup._`;
        } else {
            let itemsText = (order.items || []).map(i => `• ${i.name} (${i.size}) x${i.quantity}`).join('\n');
            let adminMsg = type === 'NEW' ? `🔔 *NEW ORDER RECEIVED!* 🔔\n------------------------\n` : `📦 *ORDER UPDATE* 📦\n------------------------\n`;
            adminMsg += `🆔 ID: #${orderId.slice(-5)}\n👤 Customer: ${order.customerName}\n📞 Phone: ${order.phone}\n📍 Address: ${order.address}\n------------------------\n📦 Items:\n${itemsText}\n------------------------\n💰 Total: ₹${order.total || 0}\n💳 Method: ${order.paymentMethod}`;
            msg = adminMsg;
        }

        await Promise.all(jids.map(jid => sock.sendMessage(jid, { text: msg }).catch(() => {})));
    } catch (err) { console.error("Admin Notify Error:", err); }
}

async function handleOrderStatusUpdate(sock, id, order, isNew = false) {
    try {
        if (!sock || isSocketDead(sock)) return;
        // FIX: Robust JID resolution for both Online and POS orders.
        // POS orders usually store the phone in 'order.phone'. 
        // Online orders store the JID in 'order.whatsappNumber'.
        let jid = null;

        // PRIORITIZE: whatsappNumber if it's a standard JID. 
        // If it's a @lid (Linked ID), we prefer formatting the phone for a standard @s.whatsapp.net JID
        const storedJid = String(order.whatsappNumber || "");
        if (storedJid.includes('@') && !storedJid.endsWith('@lid')) {
            jid = storedJid;
        } else {
            // Fallback to phone field (POS orders, incomplete profiles, or @lid cases)
            const rawPhone = order.phone || order.whatsappNumber;
            if (rawPhone && rawPhone !== "Walk-in" && !String(rawPhone).endsWith('@lid')) {
                jid = formatJid(rawPhone);
            }
        }

        if (!jid) {
            const status = (order.status || "Unknown").toUpperCase();
            const type = (order.type || order.orderType || "Walk-in");
            if (order.phone !== "Walk-in") {
                console.warn(`[BOT] ⚠️ Skipping Notification for #${id.slice(-5)} (${type}): No valid phone. Value: "${order.phone}"`);
                updateData(`bot/logs/${id}`, { error: "No valid JID", phone: order.phone && order.phone !== 'undefined' ? order.phone : null, type, timestamp: Date.now() }, order.outlet || OUTLET).catch(() => { });
            }
            return;
        }

        const currentStatus = (order.status || "").trim();
        const statusLower = currentStatus.toLowerCase();
        const orderType = (order.type || order.orderType || "Online").trim();
        const typeLower = orderType.toLowerCase();
        const isDineIn = typeLower.includes("dine") || typeLower.includes("walk") || orderType === "Dine-in";

        if (isDineIn) {
            console.log(`[BOT] 🍽️ Dine-in Order Detected: #${id.slice(-5)} | Status: ${currentStatus} | Target: ${maskJid(jid)}`);
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
        console.log(`[Status Update] 🔍 Processing Order #${id.slice(-5)} | Status: ${currentStatus} | OTP Changed: ${isOtpChanged} | Target: ${maskedJid}`);

        if (!currentProcessedStatus || currentProcessedStatus.status !== currentStatus || isNew || isOtpChanged || shouldSendOtpMessage) {
            const currentRider = order.riderId || order.assignedRider || "";
            const lastRider = currentProcessedStatus?.riderId || "";
            const isRiderChanged = currentRider && currentRider !== lastRider;

            await saveProcessedStatus(id, {
                status: currentStatus,
                timestamp: Date.now(),
                lastOtp: storedOTP,
                riderId: currentRider
            });

            console.log(`[Status Update] 🔔 State Updated for #${id.slice(-5)}: Status=${currentStatus}, Rider=${currentRider || 'None'}`);

            // NEW: Notify Rider on Assignment
            if (isRiderChanged) {
                console.log(`[RIDER] 🔄 Rider Change Detected for #${id.slice(-5)}: ${lastRider} -> ${currentRider}`);
                await riderNotify.notifyRiderAssignment(sock, id, order, addInAppNotification);
            }

            const botSettings = await getData("settings/Bot", order.outlet) || {};
            let msg = "";
            let img = null;

            if (statusLower === "placed") {
                msg = `🎉 *ORDER PLACED!* ${OUTLET_EMOJI}\n━━━━━━━━━━━━━━━━━━━━\n${formatOrderInvoice(id, order)}We've received your order and our team is reviewing it now. ⏳\nYou'll get an update as soon as it's confirmed! ❤️`;
                img = botSettings.imgPlaced || botSettings.imgConfirmed;
            } else if (statusLower === "confirmed") {
                if (isDineIn && isNew) {
                    msg = `🍕 *WELCOME TO ROSHANI ${order.outlet?.toUpperCase() || 'PIZZA'}!* ✨\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nYour counter order has been *CONFIRMED*! 🎊\n🆔 *Order ID:* #${id.slice(-5)}\n👤 *Customer:* ${order.customerName || 'Guest'}\n${order.tableNo ? `🪑 *Table No:* ${order.tableNo}\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━\nYour delicious meal is being prepared right now! 👨‍🍳🔥\n_Thank you for dining with us!_ 🙏`;
                } else {
                    msg = `✅ *ORDER CONFIRMED!* 🎊\n━━━━━━━━━━━━━━━━━━━━\n${formatOrderInvoice(id, order)}Your order is being prepared with love! ❤️\n${getFoodFunnyProgress("Confirmed")}`;
                }
                img = botSettings.imgConfirmed;
            } else if (statusLower === "ready" || statusLower === "packed") {
                msg = `📦 *PACKED & READY!* 🚀\n━━━━━━━━━━━━━━━━━━━━\nYour delicious order #${id.slice(-5)} is ready and packed! 🍱\n${isDineIn ? "It's ready to be served! 🍽️" : "Waiting for the rider to pick it up. 🛵"}\n${getFoodFunnyProgress("Ready")}`;
                img = botSettings.imgReady;

                if (!isDineIn) {
                    if (order.riderPhone) {
                        await riderNotify.notifyRiderPickup(sock, order, addInAppNotification);
                    } else {
                        await riderNotify.broadcastPickupAvailable(sock, id, order, getData, addInAppNotification);
                    }
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
                    const rider = (riderId.includes('@')) ? await getRiderByEmail(riderId, order.outlet || 'pizza') : { name: order.riderName, phone: order.riderPhone };
                    if (rider) {
                        riderInfoText = `\n📞 *Rider:* ${rider.name || "Delivery Partner"} (${rider.phone || ""})`;
                    }
                }

                if (isOtpChanged) {
                    msg = `🔑 *NEW DELIVERY OTP!* 🔄\n━━━━━━━━━━━━━━━━━━━━\nYour previous code is now invalid. Please use the new one below for your delivery #${id.slice(-5)}:\n🔑 *NEW OTP:* ${otp}${riderInfoText}\n💰 *Total:* ₹${order.total || 0}\n_Share this code ONLY with the rider upon arrival._`;
                } else {
                    msg = `🛵 *OUT FOR DELIVERY!* 🚀\n━━━━━━━━━━━━━━━━━━━━\nOur rider is on the way to your location! 🛵💨\n🆔 Order: #${id.slice(-5)}\n🔑 *OTP:* ${otp} (Share with rider only)${riderInfoText}\n💰 *Total:* ₹${order.total || 0}\n${getFoodFunnyProgress("Out for Delivery")}`;
                }
                img = botSettings.imgOut;
            } else if (statusLower === "reached drop location") {
                let otp = storedOTP;
                if (!otp) {
                    otp = Math.floor(1000 + Math.random() * 9000).toString();
                    await updateData(`orders/${id}`, { otp: otp, deliveryOTP: otp }, order.outlet);
                }
                msg = `📍 *RIDER HAS REACHED!* 🚨\n━━━━━━━━━━━━━━━━━━━━\nOur rider has arrived at your location for order #${id.slice(-5)}.\n🔑 *OTP:* ${otp} (Please share with rider)\nPlease be ready to receive your order. Thank you! 🙏`;
                img = botSettings.imgOut;
            } else if (statusLower === "delivered" || statusLower === "served") {
                msg = `✅ *${isDineIn ? 'SERVED' : 'DELIVERED'} SUCCESSFULLY!* 🍕❤️\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🆔 *Order ID:* #${id.slice(-5)}\n🤝 *Payment:* ${order.paymentMethod}\n💵 *Total Paid:* ₹${order.total || 0}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n*Enjoy your meal!* 😋\n${getFunnyFoodJoke()}`;
                img = botSettings.imgDelivered;
            } else if (statusLower === "cancelled") {
                msg = `❌ *ORDER CANCELLED* ❌\n━━━━━━━━━━━━━━━━━━━━\nWe're sorry, your order #${id.slice(-5)} has been cancelled.\nReason: ${order.cancelReason || "Store Busy / Technical Issue"}\nIf you have any questions, please contact us. 🙏`;
            }

            const prevStatus = currentProcessedStatus?.status || "None";
            console.log(`[BOT] 🔔 Status Change for #${id.slice(-5)}: ${prevStatus} -> ${currentStatus} (${jid ? 'Valid JID' : 'NO JID'})`);

            if (msg) {
                console.log(`[BOT] 📧 Sending ${currentStatus} notification to ${maskJid(jid)}...`);
                const sendResult = await sendImage(sock, jid, img, msg, order.outlet || 'pizza', true);

                // CRITICAL: Preserve ALL fields in processedStatus to avoid duplicate rider pings on next update
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
                // If no message defined for this status, still mark as processed
                await saveProcessedStatus(id, {
                    ...(currentProcessedStatus || {}),
                    status: currentStatus,
                    lastOtp: storedOTP,
                    timestamp: Date.now()
                });
            }
        } else {
            // Log skip reason if needed
            if (currentProcessedStatus && currentProcessedStatus.status === currentStatus) {
                // Already processed this status
            } else if (!jid) {
                // Already handled in the check above
            }
        }
    } catch (err) {
        console.error("Status Update Error:", err);
        updateData(`bot/logs/${id}`, { error: err.message, timestamp: Date.now() }, order.outlet || OUTLET).catch(() => { });
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

    // Patch sendMessage to log every send attempt with delivery diagnostics
    const _origSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async function(jid, content, opts) {
        const textPreview = content?.text ? content.text.slice(0, 60) : (content?.caption ? content.caption.slice(0, 60) : 'non-text');
        try {
            const result = await _origSendMessage(jid, content, opts);
            const msgId = result?.key?.id || result?.messages?.[0]?.id || result;
            const cryptoWarn = cryptoErrorCount > 10 ? ` cryptoErrs=${cryptoErrorCount}` : '';
            console.log(`[SEND OK] to ${maskJid(jid)} text="${textPreview}" wsOpen=${sock.ws?.isOpen} msgId=${msgId}${cryptoWarn}`);
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
        const alertMsg = `⚠️ *Daily report failed to generate* for ${OUTLET_NAME} (${dateOverride || 'today'}).\nCheck \`pm2 logs ${OUTLET === 'pizza' ? 'pizza-bot' : 'cake-bot'}\` for details.`;
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

        orderRef.on("child_changed", (snap) => {
            const order = snap.val();
            if (order && currentSock) handleOrderStatusUpdate(currentSock, snap.key, order);
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
        if (!currentProcessedStatus && orderTime > startupTime - timeBuffer) {
            // --- WEBVIEW DELIVERY ORDER: server-side finalization ---
            // The delivery webview (menu/delivery.html) writes the order
            // straight to Firebase (no chat round-trip). The bot never ran
            // processOrderPlacement() for this order, so the side effects
            // that function normally handles — stock deduction and saving
            // the customer's profile/record — haven't happened yet. Do them
            // here, reusing the SAME functions processOrderPlacement uses,
            // before the "Order Placed" message goes out below.
            if (order.source === "webview_delivery" && !order.stockDeducted) {
                try {
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

            handleOrderStatusUpdate(currentSock, snap.key, order, true);
        } else {
            // Just mark as processed without sending message
            await saveProcessedStatus(snap.key, { status: order.status, timestamp: Date.now() });
        }
    });
        firebaseListenersInitialized = true;
    }

    sock.ev.on('connection.update', (update) => {
        if (isMetaTransport) return; // Meta transport registers its own connection.update handler
        if (sock !== currentSock) return;
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.generate(qr, { small: true });
            // Stream the QR to Firebase so the Supreme Admin dashboard can
            // render it live (its data-store already subscribes to
            // businesses/{bid}/outlets/{oid}/bot/*). Writing on every QR
            // refresh is fine — Baileys re-emits ~every 20-30s while unpaired.
            updateData('bot/pair', { qr, status: 'waiting', updatedAt: Date.now() }, OUTLET).catch(() => {});
        }
        if (connection === 'open') {
            initFCMWatcher();
    console.log(`✅ ${OUTLET_NAME.toUpperCase()} BOT IS ONLINE`);
            console.log(`[AUTH] user=${JSON.stringify(sock.user)}`);
            reconnectAttempts = 0;
            cryptoErrorCount = 0;
            // Pairing complete — drop the QR, mark connected (dashboard closes its QR modal).
            updateData('bot/pair', { qr: null, status: 'connected', connectedAt: Date.now() }, OUTLET).catch(() => {});
        }
        const DISCONNECT_REASON_NAMES = Object.fromEntries(
            Object.entries(DisconnectReason).map(([name, code]) => [code, name])
        );

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const reasonName = DISCONNECT_REASON_NAMES[code] || `unknown(${code})`;
            if (code !== DisconnectReason.loggedOut) {
                reconnectAttempts++;
                // Exponential backoff: 5s, 15s, 45s, 120s max
                const delay = Math.min(5000 * Math.pow(3, Math.min(reconnectAttempts - 1, 3)), 120000);
                console.log(`🔌 Disconnected [${reasonName}, code=${code}] (attempt ${reconnectAttempts}). Reconnecting in ${(delay / 1000).toFixed(0)}s...`);
                if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startBot(); }, delay);
            } else {
                console.log(`❌ Logged out [${reasonName}]. Delete session folder and restart.`);
                updateData('bot/pair', { qr: null, status: 'logged_out', updatedAt: Date.now() }, OUTLET).catch(() => {});
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

            // Deduplication to prevent double responses
            const msgId = msg.key?.id || Math.random().toString(36).slice(2);
            if (await getProcessedStatus(msgId)) return;
            saveProcessedStatus(msgId, { ts: Date.now() }).catch(() => {});

            // Mark as read (fire-and-forget — don't block processing)
            sock.readMessages([msg.key]).catch(() => {});

            let sender = msg.key.remoteJid;
            // Baileys 6.x supports @lid natively — keep the JID as-is from WhatsApp
            // for consistent session keys and correct routing via relayMessage's isLid path.
            // Prevents session fragmentation between @lid and @s.whatsapp.net formats.
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            const pushName = msg.pushName || "";
            console.log(`[IN] ${maskJid(sender)}: "${text.slice(0, 80)}"`);

            // --- PROMOTIONAL OPT-OUT / OPT-IN HANDLER ---
            // Detect STOP / START from non-admin senders BEFORE the order-flow
            // state machine so it short-circuits the rest of the handler.
            // IMPORTANT: opt-out keys are stored as last-10-digits (matches
            // the customers/ keys) so the recipient filter can use a simple
            // set-membership check.
            try {
                const adminNumbers = await getCachedAdminJids();
                const isAuthorized = adminNumbers.includes(sender) || sender.startsWith(DEVELOPER_NUMBER_FALLBACK);
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
                }
            } catch (optOutErr) {
                console.error("[Promo] Opt-out handler error:", optOutErr.message);
            }

            // Show typing indicator (fire-and-forget — don't block processing)
            sock.sendPresenceUpdate('composing', sender).catch(() => {});

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
                const DEVELOPER_NUMBER = "9724649971";
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
                        return sock.sendMessage(sender, { text: `🌙 *${OUTLET_NAME.toUpperCase()} IS CLOSED*\n------------------------\nHours: ${store.shopOpenTime || 'N/A'} - ${store.shopCloseTime || 'N/A'}\n------------------------\nSee you later! 👋` });
                    }

                    // Full flow: greeting + menu image + order button (token reused within 30 min)
                    await sendOrderFlow(sock, sender, pushName, user);

                    // Set user step to WEBVIEW so bot knows they're ordering via webview
                    user.step = "WEBVIEW";
                    return;
                }

                // WEBVIEW STEP: User is ordering via webview link
                // Every message triggers the full flow (greeting + menu + order button),
                // reusing this phone's token within 30 min of generation.
                if (user.step === "WEBVIEW") {
                    // C4: If they send "track" or "status", check for recent orders
                    if (/^(track|status|where)$/i.test(text)) {
                        return sock.sendMessage(sender, { text: "📋 Type *status* to check your order status, or tap the menu link above to order again." });
                    }
                    // C3: Menu keywords → resend just the menu CTA
                    if (/^(order|menu|pizza|cake|food|start|restart)$/i.test(text)) {
                        return resendMenuCTA(sock, sender, user);
                    }
                    // C5: Anything else → nudge + resend the menu CTA
                    return resendMenuCTA(sock, sender, user, null, null, `💡 *Tap below to browse & order!*`);
                }


                if (user.step === "CATEGORY") {
                    try {
                        if (text === "0") {
                            user.step = "START";
                            return sock.sendMessage(sender, { text: `🏠 *Main Menu* — Send any message to restart.` });
                        }
                        if (text === "9") return sendCartView(sock, sender, user);
                        const cat = user.categoryList[parseInt(text) - 1];
                        if (!cat) return sendInvalidInputHelp(sock, sender, user);

                        const dishes = await getData(`dishes`, user.outlet) || {};
                        user.dishList = Object.entries(dishes)
                            .filter(([id, d]) => d.category === cat.name && d.stock !== false)
                            .map(([id, d]) => ({ id, ...d }));

                        if (user.dishList.length === 0) return sock.sendMessage(sender, { text: "❌ No items in this category." });

                        let dMsg = `🍽️ *${cat.name.toUpperCase()}*\n`;
                        user.dishList.forEach((d, i) => { dMsg += `${i + 1}️⃣  *${d.name}*\n`; });
                        dMsg += `🛒 *9* View Cart\n0️⃣ *Take one step Back* 🔙`;
                        user.step = "DISH";
                        return await sendImage(sock, sender, cat.image, dMsg);
                    } catch (catErr) {
                        console.error("[CATEGORY ERR]", catErr);
                        return sock.sendMessage(sender, { text: "❌ Something went wrong. Please try again." });
                    }
                }

                if (user.step === "DISH") {
                    if (text === "0") return sendCategories(sock, sender, user);
                    if (text === "9") return sendCartView(sock, sender, user);
                    const dish = user.dishList[parseInt(text) - 1];
                    if (!dish) return sendInvalidInputHelp(sock, sender, user);

                    user.current = { dish };
                    user.sizeList = Object.entries(dish.sizes || { "Regular": dish.price });
                    let sMsg = `📏 *SELECT SIZE*\n`;
                    user.sizeList.forEach(([s, p], i) => { sMsg += `${i + 1}️⃣  ${s} — ₹${p}\n`; });
                    sMsg += `0️⃣ *Take one step Back* 🔙`;
                    user.step = "SIZE";
                    return await sendImage(sock, sender, dish.image, sMsg);
                }

                if (user.step === "SIZE") {
                    if (text === "0") {
                        const dishList = user.dishList || [];
                        if (dishList.length === 0) return sendCategories(sock, sender, user);

                        let dMsg = `🍽️ *${(dishList[0]?.category || "ITEMS").toUpperCase()}*\n`;
                        dishList.forEach((d, i) => { dMsg += `${i + 1}️⃣  *${d.name}*\n`; });
                        dMsg += `🛒 *9* View Cart\n0️⃣ *Take one step Back* 🔙`;
                        user.step = "DISH";
                        return sock.sendMessage(sender, { text: dMsg });
                    }
                    const [size, price] = user.sizeList[parseInt(text) - 1] || [];
                    if (!size) return sendInvalidInputHelp(sock, sender, user);

                    user.current.size = size;
                    user.current.unitPrice = price;
                    user.current.addons = [];

                    user.step = "QUANTITY";
                    let qtyMsg = `🔢 *STEP 4: ENTER QUANTITY* 🍕\n`;
                    qtyMsg += `*How many of this item would you like to order?*\n`;
                    qtyMsg += `_Example: Reply with 1, 2, 5, etc._\n`;
                    qtyMsg += `0️⃣ *Take one step Back* 🔙`;
                    return sock.sendMessage(sender, { text: await appendContactInfo(qtyMsg, user.outlet) });
                }

                if (user.step === "QUANTITY") {
                    const qty = parseInt(text);
                    if (text === "0") {
                        const dish = user.current.dish;
                        user.sizeList = Object.entries(dish.sizes || { "Regular": dish.price });
                        let sMsg = `📏 *SELECT SIZE*\n`;
                        user.sizeList.forEach(([s, p], i) => { sMsg += `${i + 1}️⃣  ${s} — ₹${p}\n`; });
                        sMsg += `0️⃣ *Take one step Back* 🔙`;
                        user.step = "SIZE";
                        return sock.sendMessage(sender, { text: sMsg });
                    }
                    if (isNaN(qty) || qty < 1 || qty > 50) return sendInvalidInputHelp(sock, sender, user);

                    const addonTotal = user.current.addons.reduce((s, a) => s + a.price, 0);
                    user.cart.push({
                        name: user.current.dish.name,
                        size: user.current.size,
                        unitPrice: user.current.unitPrice,
                        addons: user.current.addons,
                        quantity: qty,
                        total: (user.current.unitPrice + addonTotal) * qty,
                        outlet: OUTLET
                    });

                    user.step = "ADDED_TO_CART";
                    return sendCartView(sock, sender, user, true);
                }

                if (user.step === "ADDED_TO_CART") {
                    if (text === "1") return sendCategories(sock, sender, user);
                    if (text === "2") return sendCartView(sock, sender, user);
                    if (text === "0") {
                        // Back to SIZE selection for the current dish
                        const dish = user.current.dish;
                        user.sizeList = Object.entries(dish.sizes || { "Regular": dish.price });
                        let sMsg = `📏 *SELECT SIZE*\n`;
                        user.sizeList.forEach(([s, p], i) => { sMsg += `${i + 1}️⃣  ${s} — ₹${p}\n`; });
                        sMsg += `0️⃣ *Take one step Back* 🔙`;
                        user.step = "SIZE";
                        return await sendImage(sock, sender, dish.image, sMsg);
                    }
                    return sock.sendMessage(sender, { text: "⚠️ Reply *1* to add more, *2* to view cart or *0* to go back." });
                }

                if (user.step === "EMPTY_CART_VIEW") {
                    if (text === "1") return sendCategories(sock, sender, user);
                    if (text === "0") { return sendCategories(sock, sender, user); }
                    return sock.sendMessage(sender, { text: "⚠️ Reply *1* to browse menu or *0* to go back." });
                }

                if (user.step === "CART_VIEW") {
                    if (text === "1") return sendCategories(sock, sender, user);
                    if (text === "2") {
                        // New: optional coupon step
                        user.step = "AWAIT_COUPON";
                        let couponMsg = `🎟️ *HAVE A COUPON CODE?* 🎟️\n`;
                        couponMsg += `If you have a discount code, reply with it now.\n`;
                        couponMsg += `Otherwise, reply *0* to skip and continue to checkout.\n`;
                        couponMsg += `0️⃣ *Skip — continue to checkout*`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(couponMsg, user.outlet) });
                    }
                    if (text === "3") {
                        user.step = "START"; user.current = {}; user.cart = [];
                        return sock.sendMessage(sender, { text: await appendContactInfo("🗑️ Cart cleared. Reply with any message to start again.", user.outlet) });
                    }
                    if (text === "0") {
                        return sendCategories(sock, sender, user);
                    }
                    return sendInvalidInputHelp(sock, sender, user);
                }

                if (user.step === "AWAIT_COUPON") {
                    if (text === "0") {
                        // Skip coupon; go to REUSE_PROFILE or NAME
                        if (user.profile && user.profile.name) {
                            user.step = "REUSE_PROFILE";
                            let profileMsg = `👤 *REUSE YOUR SAVED DETAILS?*\n`;
                            profileMsg += `Name: ${user.profile.name}\n`;
                            profileMsg += `Phone: ${user.profile.phone}\n`;
                            profileMsg += `Address: ${user.profile.address || "N/A"}\n`;
                            profileMsg += `1️⃣ Yes, use these details\n`;
                            profileMsg += `2️⃣ No, enter new details\n`;
                            profileMsg += `0️⃣ *Take one step Back* 🔙`;
                            return sock.sendMessage(sender, { text: await appendContactInfo(profileMsg, user.outlet) });
                        }
                        user.step = "NAME";
                        let nameMsg = `👤 *STEP 1: ENTER YOUR FULL NAME* ✨\n`;
                        nameMsg += `Please provide your name so we can address you correctly and prepare your order.\n`;
                        nameMsg += `_Example: Rajesh Kumar_\n`;
                        nameMsg += `0️⃣ *Take one step Back* 🔙`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(nameMsg, user.outlet) });
                    }
                    // Validate coupon
                    try {
                        const matched = await discountEngine.validateCouponCode(user.outlet, text.trim());
                        if (matched && matched.status === 'valid') {
                            user.couponCode = matched.couponCode;
                            await sock.sendMessage(sender, { text: `✅ Coupon *${matched.couponCode}* accepted! Continuing to checkout…` });
                        } else if (matched && matched.status === 'expired') {
                            user.couponCode = null;
                            await sock.sendMessage(sender, { text: `⏰ Coupon *${text.trim()}* has expired. Reply *0* to skip or try another code.` });
                            return;
                        } else if (matched && matched.status === 'not_started') {
                            user.couponCode = null;
                            await sock.sendMessage(sender, { text: `📅 Coupon *${text.trim()}* is not active yet. Reply *0* to skip or try another code.` });
                            return;
                        } else if (matched && matched.status === 'disabled') {
                            user.couponCode = null;
                            await sock.sendMessage(sender, { text: `❌ Coupon *${text.trim()}* is no longer active. Reply *0* to skip or try another code.` });
                            return;
                        } else {
                            user.couponCode = null;
                            await sock.sendMessage(sender, { text: `❌ Invalid code *${text.trim()}*. Reply *0* to skip or try another code.` });
                            return; // stay on AWAIT_COUPON
                        }
                    } catch (e) {
                        console.error('[BOT] Coupon validation error:', e);
                        user.couponCode = null;
                    }
                    // Proceed to REUSE_PROFILE or NAME
                    if (user.profile && user.profile.name) {
                        user.step = "REUSE_PROFILE";
                        let profileMsg = `👤 *REUSE YOUR SAVED DETAILS?*\n`;
                        profileMsg += `Name: ${user.profile.name}\n`;
                        profileMsg += `Phone: ${user.profile.phone}\n`;
                        profileMsg += `Address: ${user.profile.address || "N/A"}\n`;
                        profileMsg += `1️⃣ Yes, use these details\n`;
                        profileMsg += `2️⃣ No, enter new details\n`;
                        profileMsg += `0️⃣ *Take one step Back* 🔙`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(profileMsg, user.outlet) });
                    }
                    user.step = "NAME";
                    let nameMsg = `👤 *STEP 1: ENTER YOUR FULL NAME* ✨\n`;
                    nameMsg += `Please provide your name so we can address you correctly and prepare your order.\n`;
                    nameMsg += `_Example: Rajesh Kumar_\n`;
                    nameMsg += `0️⃣ *Take one step Back* 🔙`;
                    return sock.sendMessage(sender, { text: await appendContactInfo(nameMsg, user.outlet) });
                }

                if (user.step === "REUSE_PROFILE") {
                    if (text === "1") {
                        user.name = user.profile.name;
                        user.phone = user.profile.phone;
                        user.address = user.profile.address;
                        saveUserProfile(sender, { name: user.name, phone: user.phone, address: user.address }, user.outlet || OUTLET).catch(() => {});
                        // Note: We intentionally DO NOT reuse user.location here as per request

                        user.step = "LOCATION";
                        let locMsg = `📍 *SHARE YOUR LOCATION* 🌍\n`;
                        locMsg += `Please share your *Live* or *Current* Location so we can calculate the delivery fee.\n`;
                        locMsg += `*How to share:*\n`;
                        locMsg += `1️⃣ Tap the 📎 (Paperclip) or *+* button in WhatsApp\n`;
                        locMsg += `2️⃣ Tap *Location*\n`;
                        locMsg += `3️⃣ Tap *Send Your Current Location*\n`;
                        locMsg += `------------------------\n`;
                        locMsg += `⚙️ *Location option missing?*\n`;
                        locMsg += `→ *Settings > Apps > WhatsApp > Permissions > Location* → Allow\n`;
                        locMsg += `→ Also turn ON *GPS/Location Services* in phone settings\n`;
                        locMsg += `------------------------\n`;
                        locMsg += `⚠️ *Order cannot be placed without location.*\n`;
                        locMsg += `0️⃣ *Take one step Back* 🔙`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(locMsg, user.outlet) });
                    }
                    if (text === "2") {
                        user.step = "NAME";
                        let nameMsg = `👤 *STEP 1: ENTER YOUR FULL NAME* ✨\n`;
                        nameMsg += `Please provide your name so we can address you correctly and prepare your order.\n`;
                        nameMsg += `_Example: Rajesh Kumar_\n`;
                        nameMsg += `0️⃣ *Take one step Back* 🔙`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(nameMsg, user.outlet) });
                    }
                    if (text === "0") {
                        user.step = "CART_VIEW";
                        return sendCartView(sock, sender, user);
                    }
                    return sendInvalidInputHelp(sock, sender, user);
                }
                if (user.step === "NAME") {
                    if (text === "0") {
                        user.step = "CART_VIEW";
                        return sendCartView(sock, sender, user);
                    }
                    user.name = text;
                    user.step = "PHONE";
                    if (user.name) {
                        saveUserProfile(sender, { name: user.name, phone: user.phone || "", address: user.address || "" }, user.outlet || OUTLET).catch(() => {});
                    }
                    return sock.sendMessage(sender, { text: await appendContactInfo("📞 *STEP 2: ENTER YOUR 10 DIGIT MOBILE NUMBER*\n_Example: 9876543210. We will use this to contact you regarding your order._\n0️⃣ *Take one step Back* 🔙", user.outlet) });
                }

                if (user.step === "PHONE") {
                    if (text === "0") {
                        user.step = "NAME";
                        let nameMsg = `👤 *STEP 1: ENTER YOUR FULL NAME* ✨\n`;
                        nameMsg += `Please provide your name so we can address you correctly and prepare your order.\n`;
                        nameMsg += `_Example: Rajesh Kumar_\n`;
                        nameMsg += `0️⃣ *Take one step Back* 🔙`;
                        return sock.sendMessage(sender, { text: await appendContactInfo(nameMsg, user.outlet) });
                    }
                    user.phone = text;
                    saveUserProfile(sender, { name: user.name || "", phone: user.phone }, user.outlet || OUTLET).catch(() => {});
                    user.step = "ADDRESS";
                    return sock.sendMessage(sender, { text: await appendContactInfo("🏠 *STEP 3: ENTER YOUR DELIVERY ADDRESS*\n_Please provide your complete address including landmark, house number, etc._\n0️⃣ *Take one step Back* 🔙", user.outlet) });
                }

                if (user.step === "ADDRESS") {
                    if (text === "0") {
                        user.step = "PHONE";
                        return sock.sendMessage(sender, { text: await appendContactInfo("📞 *STEP 2: ENTER YOUR 10 DIGIT MOBILE NUMBER*\n_Example: 9876543210. We will use this to contact you regarding your order._\n0️⃣ *Take one step Back* 🔙", user.outlet) });
                    }
                    user.address = text;
                    saveUserProfile(sender, { name: user.name || "", phone: user.phone || "", address: user.address }, user.outlet || OUTLET).catch(() => {});
                    user.step = "LOCATION";
                    let locMsg = `📍 *SHARE YOUR LOCATION* 🌍\n`;
                    locMsg += `Please share your *Live* or *Current* Location so we can calculate the delivery fee.\n`;
                    locMsg += `*How to share:*\n`;
                    locMsg += `1️⃣ Tap the 📎 (Paperclip) or *+* button in WhatsApp\n`;
                    locMsg += `2️⃣ Tap *Location*\n`;
                    locMsg += `3️⃣ Tap *Send Your Current Location*\n`;
                    locMsg += `------------------------\n`;
                    locMsg += `⚙️ *Location option missing?*\n`;
                    locMsg += `→ *Settings > Apps > WhatsApp > Permissions > Location* → Allow\n`;
                    locMsg += `→ Also turn ON *GPS/Location Services* in phone settings\n`;
                    locMsg += `------------------------\n`;
                    locMsg += `⚠️ *Order cannot be placed without location.*\n`;
                    locMsg += `0️⃣ *Take one step Back* 🔙`;
                    return sock.sendMessage(sender, { text: await appendContactInfo(locMsg, user.outlet) });
                }

                if (user.step === "LOCATION") {
                    if (text === "0") {
                        user.step = "ADDRESS";
                        return sock.sendMessage(sender, { text: await appendContactInfo("🏠 *STEP 3: ENTER YOUR DELIVERY ADDRESS*\n_Please provide your complete address including landmark, house number, etc._\n0️⃣ *Take one step Back* 🔙", user.outlet) });
                    }
                    const loc = msg.message?.locationMessage;
                    if (!loc) {
                        return sock.sendMessage(sender, { text: await appendContactInfo("❌ *LOCATION REQUIRED — Cannot proceed without it!*\n\n📍 Please share your location using the steps below:\n\n1️⃣ Tap the 📎 (Paperclip) or *+* button\n2️⃣ Tap *Location*\n3️⃣ Tap *Send Your Current Location*\n\n⚙️ *If Location option is missing:*\n→ Go to your phone *Settings > Apps > WhatsApp > Permissions*\n→ Set *Location* to *Allow*\n→ Also enable *GPS/Location Services* in your phone settings\n\n🔄 Try again after enabling — we cannot deliver without your location.\n0️⃣ *Take one step Back* 🔙", user.outlet) });
                    }
                    user.location = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
                    saveUserProfile(sender, { name: user.name || "", phone: user.phone || "", address: user.address || "", location: user.location }, user.outlet || OUTLET).catch(() => {});
                    return handleCheckoutFinal(sock, sender, user);
                }

                if (user.step === "CONFIRM_PAY") {
                    if (text === "0") {
                        user.step = "CART_VIEW";
                        return sendCartView(sock, sender, user);
                    }
                    if (text === "2") {
                        // Record Lost Sale — complete data for analytics
                        const lostId = "L-" + Date.now();
                        const { lines, subtotal } = formatCartSummary(user.cart);
                        const deliveryFee = user.deliveryFee || 0;
                        const total = subtotal + deliveryFee - (user.discount || 0);
                        const lostData = {
                            cancelledAt: new Date().toISOString(),
                            customerName: user.name || "Anonymous",
                            phone: user.phone || "N/A",
                            address: user.address || "",
                            location: user.location || null,
                            total,
                            subtotal,
                            deliveryFee,
                            discount: user.discount || 0,
                            discountLabel: user.discountLabel || null,
                            cart: user.cart || [],
                            sourceStep: "CONFIRM_PAY",
                            reason: "Cancelled at final invoice step",
                            outlet: user.outlet || "pizza",
                            channel: "whatsapp"
                        };

                        await setData(`logs/lostSales/${lostId}`, lostData);

                        // Save lost-sale customer to customer database for follow-up
                        if (user.phone) {
                            const cleanPhone = String(user.phone).replace(/\D/g, '').slice(-10);
                            const custRef = db.ref(resolvePath(`customers/${cleanPhone}`, user.outlet));
                            custRef.transaction((existing) => {
                                const base = existing || {};
                                return {
                                    ...base,
                                    name: user.name || base.name,
                                    phone: cleanPhone,
                                    address: user.address || base.address || "",
                                    location: user.location || base.location || null,
                                    lastSeen: Date.now(),
                                    lostSaleCount: (base.lostSaleCount || 0) + 1,
                                    lastLostSaleAt: new Date().toISOString(),
                                    promotionalConsent: base.promotionalConsent ?? true
                                };
                            }).catch(() => {});
                        }

                        // Notify Admin
                        await notifyAdmin(sock, lostId, {
                            customerName: user.name || "Anonymous",
                            phone: user.phone || "N/A",
                            total,
                            outlet: user.outlet || "pizza"
                        }, 'CANCELLED');

                        const outlet = user.outlet;
                        user = null; // Mark session for deletion in Redis 
                        return sock.sendMessage(sender, { text: await appendContactInfo("❌ Order Cancelled. We hope to serve you next time! 🙏", outlet) });
                    }
                    if (text === "1") {
                        await processOrderPlacement(sock, sender, user, "COD");
                        user = null;
                        return;
                    }
                    return sendInvalidInputHelp(sock, sender, user);
                }

                async function processOrderPlacement(sock, sender, user, method) {
                    try {
                        const orderId = await generateOrderId(user.outlet);
                        const { subtotal } = formatCartSummary(user.cart);

                        const deliveryFee = user.deliveryFee || 0;
                        const finalOrder = {
                            orderId, outlet: user.outlet,
                            type: "Online", // Explicitly tag as Online order
                            customerName: user.name,
                            phone: user.phone,
                            whatsappNumber: sender, // Save sender JID for status updates
                            address: user.address,
                            lat: user.location.lat, lng: user.location.lng,
                            subtotal, deliveryFee, total: subtotal + deliveryFee - (user.discount || 0),
                            distanceKm: user.distanceKm,
                            status: "Placed", paymentMethod: method, paymentStatus: "Pending",
                            createdAt: new Date().toISOString(),
                            assignedRider: "",
                            items: user.cart,
                            stockDeducted: true,
                            // New discount tracking fields
                            discount: user.discount || 0,
                            discountId: user.discountId || null,
                            discountLabel: user.discountLabel || null,
                            discountSource: user.discountSource || (user.discount ? 'manual' : 'none'),
                            discountMode: user.discountMode || 'fixed',
                            discountValue: user.discountValue || 0,
                            discountGlobalLimit: user.discountGlobalLimit || 0,
                            _fcmSent: true
                        };

                        await setData(`orders/${orderId}`, finalOrder, user.outlet);

                        // Send confirmation to user IMMEDIATELY (fastest possible response)
                        let successMsg = `🎉 *ORDER PLACED SUCCESSFULLY!* 🎉\n`;
                        successMsg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        successMsg += `🆔 *Order ID:* #${finalOrder.orderId.slice(-5)}\n`;
                        successMsg += `🏪 *Shop:* ${OUTLET_NAME}\n`;
                        successMsg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        successMsg += `*Please wait while the admin confirms your order!* ⏳\n`;
                        successMsg += `Total: ₹${finalOrder.total}`;
                        await sock.sendMessage(sender, { text: await appendContactInfo(successMsg, user.outlet) });

                        // Fire-and-forget: all side effects (non-blocking)
                        notifyAdmin(sock, orderId, finalOrder, 'NEW').catch(() => {});
                        sendFCMToAdmins(orderId, finalOrder).catch(() => {});
                        saveUserProfile(sender, {
                            name: user.name, phone: user.phone,
                            address: user.address, location: user.location,
                            lastOutlet: user.outlet
                        }, user.outlet || OUTLET).catch(() => {});

                        // Save complete profile to outlet's customers node
                        if (user.phone) {
                            const cleanPhone = String(user.phone).replace(/\D/g, '').slice(-10);
                            const mapsLink = user.location ? `https://maps.google.com/?q=${user.location.lat},${user.location.lng}` : "";
                            const isFirstOrderDiscount = user.discountSource === 'firstOrder' && user.discountId;
                            const custRef = db.ref(resolvePath(`customers/${cleanPhone}`, user.outlet));
                            custRef.transaction((existing) => {
                                const base = existing || {};
                                const merged = {
                                    ...base,
                                    name: user.name || base.name,
                                    phone: cleanPhone,
                                    address: user.address || base.address || "",
                                    location: user.location || base.location || null,
                                    mapsLink: mapsLink || base.mapsLink || "",
                                    lastOrderDate: new Date().toISOString(),
                                    promotionalConsent: true,
                                    orderCount: (base.orderCount || 0) + 1,
                                    totalSpent: (base.totalSpent || 0) + (user.total || 0),
                                    lastSeen: Date.now()
                                };
                                if (isFirstOrderDiscount) {
                                    merged.firstOrderDiscountUsed = Date.now();
                                    merged.firstOrderDiscountId = user.discountId;
                                }
                                if (user.discountId && user.discount > 0) {
                                    merged.discountUsage = merged.discountUsage || {};
                                    merged.discountUsage[user.discountId] = (merged.discountUsage[user.discountId] || 0) + 1;
                                }
                                return merged;
                            }).catch(() => {});
                        }

                        // Log discount usage (best-effort)
                        if (finalOrder.discount > 0 && finalOrder.discountId) {
                            discountEngine.recordDiscountUsage({
                                OUTLET: user.outlet,
                                discountId: finalOrder.discountId,
                                orderId,
                                customerPhone: finalOrder.phone,
                                amountGiven: finalOrder.discount,
                                channel: 'whatsapp',
                                globalLimit: finalOrder.discountGlobalLimit,
                                discountLabel: finalOrder.discountLabel,
                                discountSource: finalOrder.discountSource
                            }).catch(() => {});
                        }

                        // Fire-and-forget: deduct stock AFTER user gets reply
                        deductInventoryStock(sock, finalOrder.items, user.outlet).catch(e =>
                            console.error("[BOT] Stock deduction failed:", e)
                        );

                    } catch (e) {
                        console.error("Order Placement Error:", e);
                        await sock.sendMessage(sender, { text: "❌ Error placing your order. Please try again." });
                    }
                }

            })(); // <-- End of Message Handler IIFE

            // Final Session Save
            await saveSession(sender, user);

        } catch (err) { console.error("Message Handler Error:", err); }
    });

    if (isMetaTransport) {
        await sock.start();
    }
}

async function handleCheckoutFinal(sock, sender, user) {
    try {
        const cleanPhone = String(user.phone || '').replace(/\D/g, '').slice(-10);
        const [delSettings, storeSettings, customerSnap] = await Promise.all([
            getData("settings/Delivery", user.outlet) || {},
            getData("settings/Store", user.outlet) || {},
            cleanPhone ? getData(`customers/${cleanPhone}`, user.outlet) : null
        ]);

        const outletCoords = {
            lat: parseFloat(storeSettings?.lat || 0),
            lng: parseFloat(storeSettings?.lng || 0)
        };

        let dist = 0;
        let fee = 0;
        if (user.location && outletCoords.lat && outletCoords.lng) {
            dist = calculateDistance(user.location.lat, user.location.lng, outletCoords.lat, outletCoords.lng);
            fee = getFeeFromSlabs(dist, delSettings.slabs || []);
        }

        user.distanceKm = dist;
        user.deliveryFee = fee;
        const { lines, subtotal } = formatCartSummary(user.cart);

        // Auto-evaluate discount (best of: firstOrder / coupon / global / category)
        try {
            const discountEval = await discountEngine.evaluateDiscount({
                OUTLET: user.outlet,
                customer: customerSnap,
                subtotal,
                couponCode: user.couponCode || null,
                cart: user.cart,
                channel: 'whatsapp'
            });
            if (discountEval) {
                user.discount = discountEval.amount;
                user.discountId = discountEval.discount.id;
                user.discountLabel = discountEval.label;
                user.discountSource = discountEval.source;
                user.discountMode = discountEval.discount.mode || 'fixed';
                user.discountValue = discountEval.discount.value || 0;
                user.discountGlobalLimit = discountEval.discount.globalLimit || 0;
            } else {
                user.discount = 0;
                user.discountId = null;
                user.discountLabel = null;
                user.discountSource = null;
                user.discountMode = null;
                user.discountValue = 0;
            }
        } catch (e) {
            console.error('[BOT] Discount evaluation failed:', e?.message || e);
            user.discount = 0;
        }

        user.step = "CONFIRM_PAY";

        let sum = `🧾 *INVOICE*\n`;
        sum += `━━━━━━━━━━━━━━━━━━━━\n`;
        sum += `${lines}`;
        sum += `━━━━━━━━━━━━━━━━━━━━\n`;
        sum += `💰 Subtotal: ₹${subtotal}\n`;
        sum += `🚚 Delivery (${dist.toFixed(1)}km): ₹${fee}\n`;
        if (user.discount) {
            const discLabel = user.discountMode === 'percent' && user.discountValue
                ? `${user.discountLabel || ''} ${user.discountValue}% off`.trim()
                : user.discountLabel || '';
            sum += `🎁 Discount (${discLabel}): -₹${user.discount}\n`;
        }
        sum += `💵 *TOTAL: ₹${subtotal + fee - (user.discount || 0)}*\n`;
        sum += `1️⃣ Confirm Order\n`;
        sum += `2️⃣ Cancel\n`;
        sum += `0️⃣ *Take one step Back* 🔙`;

        return sock.sendMessage(sender, { text: await appendContactInfo(sum, user.outlet) });
    } catch (e) {
        console.error("Checkout Final Error:", e);
        return sock.sendMessage(sender, { text: "❌ Error calculating delivery fee. Please try again." });
    }
}


// Watch for new orders from non-WA sources (QR menu, REST API) → send FCM to admins
function initFCMWatcher() {
  const ONE_MIN_MS = 60000;
  for (const outlet of ['pizza', 'cake']) {
    db.ref(resolvePath('orders', outlet)).on('child_added', (snap) => {
      const order = snap.val() || {};
      if (order._fcmSent) return;
      const createdAt = new Date(order.createdAt).getTime();
      if (Date.now() - createdAt > ONE_MIN_MS) return; // skip old orders on restart
      sendFCMToAdmins(snap.key, order).catch(() => {});
      snap.ref.child('_fcmSent').set(true).catch(() => {});
    });
  }
}

startBot();