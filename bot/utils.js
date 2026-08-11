/**
 * BOT Pure utilities — string helpers, date, formatting, delivery geo.
 * Zero external dependencies.
 */

// ── String helpers ─────────────────────────────────────────────────────────

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
        lines += `   Qty: ${item.quantity} x ₹${item.unitPrice + (item.addons?.reduce((s, a) => s + a.price, 0) || 0)} = ₹${itemTotal}\n\n`;
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
    const displayId = orderId ? orderId.slice(-5) : "N/A";
    let msg = `🧾 *ORDER SUMMARY*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🆔 *Order ID:* #${displayId}\n`;
    msg += `👤 *Customer:* ${order.customerName || "Guest"}\n`;
    msg += `📍 *Type:* ${order.type || "Online"}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *ITEMS:*\n${itemsText}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *Subtotal:* ₹${order.subtotal || order.itemTotal || 0}\n`;
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
    return `\n*Progress:* [ ${bar} ]\n`;
}

// ── Coupon ─────────────────────────────────────────────────────────────────

const _COUPON_WORDS = ['PIZZA', 'DEAL', 'FEAST', 'SAVE', 'YUMMY', 'TREAT', 'SALE', 'FRESH', 'HOT', 'MEGA', 'SUPER', 'LUCKY', 'BOGO', 'FREE', 'WOW', 'YAY'];

function generateCouponCode(prefix = '') {
    const word = prefix || _COUPON_WORDS[Math.floor(Math.random() * _COUPON_WORDS.length)];
    const num = Math.floor(Math.random() * 90 + 10);
    return `${word}${num}`;
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

module.exports = {
    formatJid, maskJid,
    getISTDateInfo, getISTDateString, parseTime, isShopOpen, randomBetween,
    calculateDistance, getFeeFromSlabs,
    formatCartSummary, formatOrderInvoice, getFunnyFoodJoke, getFoodFunnyProgress,
    generateCouponCode, isSocketDead
};
