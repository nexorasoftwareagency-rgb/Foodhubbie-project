/**
 * BOT Pure utilities — string helpers, date, formatting, delivery geo.
 * Zero external dependencies.
 */

// ── String helpers ─────────────────────────────────────────────────────────

// Unified order ID → display string. Callers add "#".
// Same logic as Admin/js/utils.js, menu/js/order.js, SupremeAdmin, rider utils.
function formatOrderId(o) {
    const id = typeof o === 'string' ? o : (o && (o.orderId || o.id)) || '';
    if (!id) return 'N/A';
    if (/^\d{6}-\d+$/.test(id)) return id;
    const m = String(id).match(/^(\d{4})(\d{2})(\d{2})-(\d+)$/);
    if (m) return `${m[3]}${m[2]}${m[1].slice(2)}-${Number(m[4])}`;
    return String(id).slice(-6).toUpperCase();
}

function formatJid(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('0')) clean = clean.substring(1);
    if (clean.length === 10) clean = '91' + clean;
    return (clean.length >= 10) ? (clean + "@s.whatsapp.net") : null;
}

function maskJid(jid) {
    if (!jid || !jid.includes('@')) return jid;
    const [phone, domain] = jid.split('@');
    if (phone.length <= 4) return `****@${domain}`;
    return `${phone.substring(0, 2)}****${phone.slice(-4)}@${domain}`;
}

// ── Blocklist check ──────────────────────────────────────────────────────

function isBlockedJid(jid, blockedSet) {
    if (!blockedSet || blockedSet.size === 0) return false;
    const phone = (jid || '').replace(/[^0-9]/g, '');
    return blockedSet.has(jid) || blockedSet.has(phone) ||
        [...blockedSet].some(bn => phone.endsWith(bn) || bn.endsWith(phone));
}

// ── Date / IST helpers ─────────────────────────────────────────────────────

function getISTDateInfo(customDate = null) {
    const now = customDate ? new Date(customDate) : new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + IST_OFFSET);
    return {
        dateStr: istTime.toISOString().split('T')[0],
        hour: istTime.getUTCHours(),
        minute: istTime.getUTCMinutes(),
        istObject: istTime
    };
}

function getISTDateString(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(date.getTime() + IST_OFFSET);
    return istTime.toISOString().split('T')[0];
}

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const cleanStr = String(timeStr).trim().toUpperCase();
    const isPM = cleanStr.includes('PM');
    const isAM = cleanStr.includes('AM');
    const parts = cleanStr.replace(/AM|PM/i, '').trim().split(':');
    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    return hours * 60 + minutes;
}

function isShopOpen(openTime, closeTime, statusOverride) {
    if (statusOverride === 'FORCE_OPEN') return true;
    if (statusOverride === 'FORCE_CLOSED') return false;
    if (!openTime || !closeTime) return true;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(now);
    const h = parseInt(parts.find(p => p.type === 'hour').value);
    const m = parseInt(parts.find(p => p.type === 'minute').value);
    const currentTime = h * 60 + m;

    const start = parseTime(openTime);
    const end = parseTime(closeTime);

    if (end < start) {
        return currentTime >= start || currentTime <= end;
    }
    return currentTime >= start && currentTime <= end;
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Delivery / Geo ─────────────────────────────────────────────────────────

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function getFeeFromSlabs(distance, slabs) {
    if (!slabs || slabs.length === 0) return 0;
    for (const slab of slabs) {
        if (distance <= slab.km) return slab.fee;
    }
    return slabs[slabs.length - 1].fee;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatCartSummary(cart) {
    if (!cart || cart.length === 0) return { lines: '_Your cart is empty_', subtotal: 0 };
    let lines = '';
    let subtotal = 0;
    cart.forEach((item, i) => {
        const itemTotal = item.total || 0;
        subtotal += itemTotal;
        lines += `${i + 1}. *${item.name}* (${item.size})\n`;
        if (item.addons && item.addons.length > 0) {
            lines += `   + ${item.addons.map(a => a.name).join(', ')}\n`;
        }
        lines += `   Qty: ${item.quantity} x ₹${item.unitPrice + (item.addons?.reduce((s, a) => s + a.price, 0) || 0)} = ₹${itemTotal}\n`;
        if (i < cart.length - 1) lines += `------------------------\n`;
    });
    return { lines, subtotal };
}

function formatOrderInvoice(orderId, order) {
    let itemsText = "";
    Object.values(order.items || {}).forEach((item) => {
        const qty = item.quantity || item.qty || 1;
        const price = item.lineTotal || item.total || (item.price * qty) || 0;
        itemsText += `• *${item.name}* (${item.size || 'Regular'}) x${qty} - ₹${price}\n`;
        if (item.addons && item.addons.length > 0) {
            const addonNames = Array.isArray(item.addons)
                ? item.addons.map(a => a.name).join(", ")
                : Object.keys(item.addons).join(", ");
            itemsText += `  _Addons: ${addonNames}_\n`;
        }
    });
    const displayId = formatOrderId(orderId || order);
    let msg = `🧾 *ORDER SUMMARY*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🆔 *Order ID:* #${displayId}\n`;
    msg += `👤 *Customer:* ${order.customerName || "Guest"}\n`;
    msg += `📍 *Type:* ${order.type || "Online"}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *ITEMS:*\n${itemsText}`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Subtotal:* ₹${order.subtotal || order.itemTotal || 0}\n`;
    if (order.distanceKm) msg += `📍 *Distance:* ${order.distanceKm} km\n`;
    if (order.deliveryFee) msg += `🚚 *Shipping:* ₹${order.deliveryFee}\n`;
    if (order.discount) {
        const pctInfo = order.discountMode === 'percent' && order.discountValue ? ` (${order.discountValue}% off)` : '';
        msg += `🎁 *Discount${pctInfo}:* -₹${order.discount}\n`;
    }
    msg += `💵 *TOTAL AMOUNT: ₹${order.total || 0}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    return msg;
}

function getFunnyFoodJoke() {
    const jokes = [
        "Why did the pizza go to the doctor? It was feeling a bit 'cheesy'! 🍕",
        "What's a pizza's favorite movie? 'Slice of life'! 🎬",
        "What do you call a fake pizza? A 'pepper-phoney'! 🍕",
        "How do you fix a broken pizza? With tomato paste! 🍅",
        "Why did the baker go to jail? He was caught 'kneading' the dough too much! 🍞",
        "What's a pizza's favorite song? 'Slice, Slice, Baby'! 🎵",
        "Why did the pizza delivery guy get a promotion? He always 'delivered' on time! 🚲",
        "What do you call a sleepy pizza? A 'doze-za'! 😴",
        "Why did the tomato turn red? Because it saw the pizza dressing! 🍅",
        "What's the best way to eat pizza? With your mouth! 😋"
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
}

function getFoodFunnyProgress(status, name = "") {
    const bars = {
        "Confirmed": "✅⬜⬜⬜⬜",
        "Ready": "✅👨‍🍳🔥📦",
        "Out for Delivery": "✅👨‍🍳🔥📦🚀",
        "Delivered": "✅👨‍🍳🔥📦🍕"
    };
    const bar = bars[status] || "⬜⬜⬜⬜⬜";
    return `\n------------------------\n*Progress:* [ ${bar} ]\n`;
}

// ── Warm-up-aware broadcast pacing ──────────────────────────────────────────
// A freshly-linked WhatsApp number is the most ban-prone state there is.
// Multi-recipient loops (rider broadcasts) are the one place we can safely
// slow down without touching customer-facing order replies. This always
// adds *some* delay between recipients (there was none before), and adds
// more during a number's first week since its first-ever successful pairing.
const WARMUP_DAYS = 7;
const WARMUP_DELAY_RANGE_MS = [3000, 5000];
const NORMAL_DELAY_RANGE_MS = [800, 1500];

function getBroadcastDelayRangeMs(firstLinkedAt) {
    if (!firstLinkedAt) return WARMUP_DELAY_RANGE_MS; // unknown age — be conservative
    const daysSinceLink = (Date.now() - firstLinkedAt) / (24 * 60 * 60 * 1000);
    return daysSinceLink < WARMUP_DAYS ? WARMUP_DELAY_RANGE_MS : NORMAL_DELAY_RANGE_MS;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Rate Limiter (order notifications) ──────────────────────────────────────
// Sliding-window rate limiter: caps sends per minute to prevent WhatsApp
// rate-limit bans during order bursts (e.g. 100 simultaneous orders).
const ORDER_RATE_LIMIT = 20; // max sends per window
const ORDER_RATE_WINDOW_MS = 60_000; // 1 minute window

class RateLimiter {
    constructor(maxPerWindow = ORDER_RATE_LIMIT, windowMs = ORDER_RATE_WINDOW_MS) {
        this.maxPerWindow = maxPerWindow;
        this.windowMs = windowMs;
        this.timestamps = []; // timestamps of recent sends
    }

    async wait() {
        const now = Date.now();
        // Purge timestamps outside the window
        this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
        if (this.timestamps.length >= this.maxPerWindow) {
            // Wait until the oldest send expires
            const oldest = this.timestamps[0];
            const waitMs = this.windowMs - (now - oldest) + 50; // +50ms buffer
            console.log(`[RateLimiter] ⏳ Rate limit hit (${this.timestamps.length}/${this.maxPerWindow}). Waiting ${(waitMs / 1000).toFixed(1)}s...`);
            await sleep(waitMs);
            // Purge again after wait
            this.timestamps = this.timestamps.filter(t => Date.now() - t < this.windowMs);
        }
        this.timestamps.push(Date.now());
    }
}

// ── Coupon ─────────────────────────────────────────────────────────────────

// ── Baileys Send Tracker (per-recipient jitter) ────────────────────────────
// Mimics human sending patterns: 2-5s gap between distinct recipients,
// no delay for same-recipient (likely order updates to same customer).
const BAILLEYS_SEND_DELAY_MIN_MS = 2000;
const BAILLEYS_SEND_DELAY_MAX_MS = 5000;
const BAILLEYS_SAME_RECIPIENT_MIN_MS = 2000;

class BaileysSendTracker {
    constructor() {
        this._lastSendByPhone = new Map(); // phone → timestamp
    }

    async waitBeforeSend(phoneNumber) {
        if (!phoneNumber) return;
        const phone = String(phoneNumber).replace(/\D/g, '');
        const lastSend = this._lastSendByPhone.get(phone);
        if (lastSend) {
            const elapsed = Date.now() - lastSend;
            if (elapsed < BAILLEYS_SAME_RECIPIENT_MIN_MS) {
                return; // same recipient, skip delay
            }
        }
        // Different recipient or first send — add jitter
        await sleep(randomBetween(BAILLEYS_SEND_DELAY_MIN_MS, BAILLEYS_SEND_DELAY_MAX_MS));
    }

    trackSend(phoneNumber) {
        if (!phoneNumber) return;
        const phone = String(phoneNumber).replace(/\D/g, '');
        this._lastSendByPhone.set(phone, Date.now());
        // Evict entries older than 5 minutes to prevent memory leak
        const cutoff = Date.now() - 5 * 60 * 1000;
        for (const [p, ts] of this._lastSendByPhone) {
            if (ts < cutoff) this._lastSendByPhone.delete(p);
        }
    }
}

// ── Socket health ──────────────────────────────────────────────────────────

function isSocketDead(sock) {
    if (!sock) return true;
    if (!sock.ws) return true;
    // Baileys 6.x uses custom WebSocketClient (not standard ws library):
    // .isOpen (bool), .isClosing (bool), .isClosed (bool) — NOT .readyState
    if (sock.ws.isClosed || sock.ws.isClosing) return true;
    return false;
}

// ── Outbound Tracker ──────────────────────────────────────────────────
// Tracks daily outbound message counts per outlet in Firebase.
// Path: businesses/{bid}/outlets/{oid}/bot/usage/{IST-date}
// { total, order_notification, rider_broadcast, promo, admin_alert, updatedAt }

class OutboundTracker {
    constructor(dbRef, resolvePath) {
        this._db = dbRef;
        this._resolvePath = resolvePath;
    }

    _istDate() {
        return new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
    }

    async trackSend(outlet, type) {
        const today = this._istDate();
        const ref = this._db.ref(this._resolvePath(`bot/usage/${today}`, outlet));
        try {
            await ref.transaction((cur) => {
                cur = cur || {};
                cur.total = (cur.total || 0) + 1;
                cur[type] = (cur[type] || 0) + 1;
                cur.updatedAt = Date.now();
                return cur;
            });
        } catch (e) {
            // Best-effort — never crash the bot over analytics
        }
    }
}

module.exports = {
    formatJid, maskJid, isBlockedJid,
    formatOrderId,
    getISTDateInfo, getISTDateString, isShopOpen, randomBetween,
    calculateDistance, getFeeFromSlabs,
    formatCartSummary, formatOrderInvoice, getFunnyFoodJoke, getFoodFunnyProgress,
    isSocketDead,
    getBroadcastDelayRangeMs, sleep,
    RateLimiter, OutboundTracker, BaileysSendTracker
};
