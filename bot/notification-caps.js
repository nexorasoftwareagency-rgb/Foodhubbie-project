/**
 * notification-caps.js — Production-grade push notification rate limiting
 * and timezone-aware gating for FoodHubbie.
 *
 * Two concerns, both best-effort (never block order flow):
 *
 * 1. FREQUENCY CAPPING — per (outlet, phone, type) counters in RTDB.
 *    Transactional (order status) has a generous cap; marketing/promo has a
 *    tight cap to prevent fatigue and mass opt-outs.
 *
 * 2. QUIET HOURS — marketing/promo notifications are suppressed between
 *    21:00 and 09:00 IST (India Standard Time, UTC+5:30). Transactional
 *    order-status pushes always go through (customers expect them).
 *
 * All reads/writes go through RTDB so state is shared across bot restarts
 * and across the control-API (manual admin sends).
 */

const ADMIN = require('firebase-admin');
// The control-API resolves a DIFFERENT firebase-admin copy (its own
// node_modules) than this module, so its initializeApp() never initializes
// ours - ADMIN.database() here would throw "The default Firebase app does
// not exist" at send time. server.js injects its database after init;
// bot/index.js shares this module's copy, so the fallback covers it.
// (Calling ADMIN.database() at module load was a boot crash - keep lazy.)
let _injectedDb = null;
function setDatabase(database) { _injectedDb = database; }
function db() { return _injectedDb || ADMIN.database(); }

// IST offset in ms: UTC + 5:30 = 19800000 ms
const IST_OFFSET_MS = 5 * 3600000 + 30 * 60000;

/** Caps per (outlet, phone, notificationType). Stored under
 *  businesses/{bid}/outlets/{oid}/notifyCaps/{phone}/{type}/{bucket} */
function capRef(outlet, phone, type) {
    return db().ref(`outlets/${outlet}/notifyCaps/${phone}/${type}`);
}

/** Returns the IST bucket key for a timestamp (UTC date string in IST). */
function istBucketKey(ts = Date.now()) {
    const d = new Date(ts + IST_OFFSET_MS);
    return d.toISOString().slice(0, 10); // 'YYYY-MM-DD' in IST
}

/** Max notifications per IST day per (outlet, phone, type). */
const CAPS = {
    order: 50,   // transactional order-status pushes — generous
    loyalty: 5,  // tier-up / points — low
    promo: 3,    // marketing — tight to prevent fatigue
};

/** Quiet hours in IST: marketing suppressed 21:00–09:00. Transactional
 *  (order) pushes always allowed. */
function isQuietHours(ts = Date.now()) {
    const d = new Date(ts + IST_OFFSET_MS);
    const h = d.getUTCHours(); // already IST-adjusted via offset above
    return h >= 21 || h < 9;
}

/**
 * Checks whether a notification of `type` may be sent to `phone` at `outlet`.
 * Returns { allowed: boolean, reason?: string }.
 * On allow, also increments the counter (caller should not double-count).
 */
async function checkAndConsumeCap(outlet, phone, type = 'order') {
    if (!phone || !/^[6-9]\d{9}$/.test(String(phone))) {
        return { allowed: true }; // no phone → can't cap, let it through
    }

    // Marketing/promo is suppressed during quiet hours
    if (type === 'promo' || type === 'offer') {
        if (isQuietHours()) {
            return { allowed: false, reason: 'quiet_hours' };
        }
    }

    const cap = CAPS[type] ?? CAPS.order;
    const bucket = istBucketKey();
    const ref = capRef(outlet, phone, type);

    try {
        const snap = await ref.child(bucket).once('value');
        const current = Number(snap.val() || 0);
        if (current >= cap) {
            return { allowed: false, reason: 'daily_cap' };
        }
        // Increment (transaction not needed — worst case we slightly over-count)
        await ref.child(bucket).set(current + 1);
        return { allowed: true };
    } catch (e) {
        // Never block notifications on cap-store failure
        console.warn('[notify-caps] cap check failed:', e.message);
        return { allowed: true };
    }
}

/** Returns remaining quota for a (outlet, phone, type) — for UI display. */
async function getCapRemaining(outlet, phone, type = 'order') {
    if (!phone || !/^[6-9]\d{9}$/.test(String(phone))) return CAPS[type] ?? CAPS.order;
    const cap = CAPS[type] ?? CAPS.order;
    const bucket = istBucketKey();
    try {
        const snap = await capRef(outlet, phone, type).child(bucket).once('value');
        const used = Number(snap.val() || 0);
        return Math.max(0, cap - used);
    } catch { return cap; }
}

module.exports = {
    checkAndConsumeCap,
    getCapRemaining,
    isQuietHours,
    setDatabase,
    IST_OFFSET_MS,
    CAPS,
};
