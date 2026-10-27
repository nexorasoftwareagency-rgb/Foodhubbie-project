/**
 * BOT-SIDE DISCOUNT ENGINE (I/O wrapper)
 * Wraps shared/discount-rules.js — the single source of truth shared with
 * Admin (discount-evaluator.js) and the menu checkout (menu/shared copy) —
 * with firebase-admin I/O (bypasses rules).
 * Used inside processOrderPlacement to auto-apply the best eligible discount.
 */

const db = require('./firebase.js').db; // firebase-admin instance
const { getData, resolvePath } = require('./firebase.js');

// The pure rules live in ../shared/discount-rules.js (same repo checkout that
// ships to EC2 at /var/www/foodhubbie, so a relative require reaches it).
// require(esm) needs Node >= 22.12; on an older runtime or a partial deploy
// missing shared/ we degrade gracefully: the 4-line amount formula keeps
// working via the frozen local copy below, full evaluation returns null
// (no discount applied — never a WRONG discount), and the warn shows in pm2.
let rules = null;
try { rules = require('../shared/discount-rules.js'); }
catch (e) {
    console.warn('[Discounts] shared/discount-rules.js failed to load — full discount evaluation disabled.'
        + ' Ensure the EC2 deploy includes the repo shared/ folder and Node >= 22.12. Detail:', e && e.message);
}

// ponytail: frozen fallback for the amount formula only — delete once EC2 is
// confirmed on Node >= 22.12 with shared/ present in the checkout.
function _localDiscountAmount(d, subtotal) {
    let amt = d.mode === 'percent' ? subtotal * (Number(d.value) || 0) / 100 : Number(d.value) || 0;
    if (d.maxCap && amt > d.maxCap) amt = d.maxCap;
    return amt;
}
const discountAmount = rules ? rules.discountAmount : _localDiscountAmount;

const CACHE_TTL_MS = 30_000;
const _cache = { data: null, fetchedAt: 0, outlet: null };

async function getAllDiscounts(OUTLET) {
    const now = Date.now();
    if (_cache.outlet === OUTLET && _cache.data && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.data;
    try {
        const snap = await db.ref(resolvePath(`discounts`, OUTLET)).once('value');
        _cache.data = snap.val() || {};
    } catch (_) {
        _cache.data = _cache.data || {};
    }
    _cache.outlet = OUTLET;
    _cache.fetchedAt = now;
    return _cache.data;
}

/**
 * Evaluate the best discount for a given checkout context.
 * Returns { discount, allApplied, amount, label, source } or null.
 */
async function evaluateDiscount({ OUTLET, customer, subtotal, couponCode, cart, channel = 'whatsapp', now = Date.now() }) {
    if (!subtotal || subtotal <= 0) return null;
    if (!rules) return null;

    // Feature flag check (cached via getData)
    let enabled = true;
    try {
        const flagVal = await getData('discounts/featureEnabled', OUTLET);
        enabled = flagVal !== false;
    } catch (_) {}
    if (!enabled) return null;

    const all = await getAllDiscounts(OUTLET);
    const list = Object.entries(all)
        .filter(([, d]) => d && d.type && d.value != null)
        .map(([id, d]) => ({ id, ...d }));

    // Eligibility, exclusivity, stacking and the P2-9 subtotal cap all live in
    // the shared core — identical to the Admin POS preview by construction.
    // (categories bridge intentionally not passed yet: bot webview carts carry
    // raw category fields, so behavior is unchanged; flip in the marketing phase.)
    return rules.evaluateDiscounts(list, { customer, subtotal, couponCode, cart, channel, now });
}

/**
 * Validate a customer-entered coupon code against the discounts node.
 * Returns the matched discount or null. Case-insensitive. Non-valid matches
 * carry `status` plus a human-readable `reason` for customer messaging.
 */
async function validateCouponCode(OUTLET, code) {
    if (!code) return null;
    const all = await getAllDiscounts(OUTLET);
    const lower = String(code).toLowerCase();
    const now = Date.now();
    for (const [id, d] of Object.entries(all)) {
        if (!d || d.type !== 'coupon' || !d.couponCode) continue;
        if (String(d.couponCode).toLowerCase() === lower) {
            const status = rules ? rules.couponStatus(d, now) : _localCouponStatus(d, now);
            const out = { id, ...d, status };
            if (rules && status !== 'valid') out.reason = rules.COUPON_STATUS_TEXT[status];
            return out;
        }
    }
    return null;
}

// ponytail: emergency fallback (shared/ missing on a partial deploy) — same
// checks as before the shared module existed. Delete with _localDiscountAmount.
function _localCouponStatus(d, now) {
    if (d.enabled === false) return 'disabled';
    if (d.startsAt && now < d.startsAt) return 'not_started';
    if (d.endsAt && d.endsAt > 0 && now > d.endsAt) return 'expired';
    return 'valid';
}

/**
 * Persist a usage record + bump the discount's stats atomically.
 */
async function recordDiscountUsage({ OUTLET, discountId, orderId, customerPhone, amountGiven, globalLimit, channel, discountLabel, discountSource }) {
    try {
        let reserved = true;
        const txResult = await db.ref(resolvePath(`discounts/${discountId}/stats`, OUTLET)).transaction((cur) => {
            cur = cur || {};
            const nextCount = (cur.usedCount || 0) + 1;
            if (globalLimit && nextCount > globalLimit) {
                reserved = false;
                return;
            }
            return {
                usedCount: nextCount,
                totalDiscountGiven: (cur.totalDiscountGiven || 0) + Math.round(Number(amountGiven) || 0),
                lastUsedAt: Date.now()
            };
        });

        if (!reserved || !txResult.committed) {
            console.warn(`[Discounts] Redemption cap reached for ${discountId} — usage not recorded.`);
            return false;
        }

        const usageId = db.ref(resolvePath(`discountsUsage`, OUTLET)).push().key;
        await db.ref(resolvePath(`discountsUsage/${usageId}`, OUTLET)).set({
            discountId, discountLabel: discountLabel || '',
            orderId: orderId || '', customerPhone: customerPhone || '',
            amountGiven: Math.round(Number(amountGiven) || 0),
            appliedAt: Date.now(), channel: channel || 'whatsapp',
            source: discountSource || '',
            discountSource: discountSource || ''
        });

        // Per-customer counters (Phase 1 review fix): the shared evaluator
        // enforces perCustomerLimit and one-time first-order discounts from
        // customer.discountUsage / firstOrderDiscountUsed — POS writes those
        // (pos.js), but the bot never did, so a WhatsApp/webview guest could
        // reuse a limited discount indefinitely. Best-effort: a counter
        // failure must never fail the order itself.
        const phone10 = customerPhone ? String(customerPhone).replace(/\D/g, '').slice(-10) : '';
        const isFirst = discountSource === 'firstOrder' && !!discountId;
        const bump = !!discountId && Number(amountGiven) > 0;
        if (/^[6-9]\d{9}$/.test(phone10) && (isFirst || bump)) {
            const custRef = db.ref(resolvePath(`customers/${phone10}`, OUTLET));
            // Seed from a read first: RTDB hands the first transaction attempt
            // `null` even when the node exists (cold queue) — returning a
            // fresh record blind would wipe the real customer profile.
            const baseSnap = await custRef.once('value').catch(() => null);
            const base = baseSnap && baseSnap.val();
            await custRef.transaction((c) => {
                const node = c || base;
                if (!node) {
                    // Minimal counter record — the fuller profile is created
                    // by the order/profile sync paths; never invent a name.
                    const fresh = { phone: phone10, createdAt: Date.now(), lastSeen: Date.now() };
                    if (isFirst) { fresh.firstOrderDiscountUsed = Date.now(); fresh.firstOrderDiscountId = discountId; }
                    if (bump) fresh.discountUsage = { [discountId]: 1 };
                    return fresh;
                }
                const updated = { ...node };
                if (isFirst && !node.firstOrderDiscountUsed) {
                    updated.firstOrderDiscountUsed = Date.now();
                    updated.firstOrderDiscountId = discountId;
                }
                if (bump) {
                    updated.discountUsage = { ...(node.discountUsage || {}) };
                    updated.discountUsage[discountId] = (updated.discountUsage[discountId] || 0) + 1;
                }
                return updated;
            }).catch(e => console.warn('[Discounts] customer counter update failed:', e?.message || e));
        }
        return true;
    } catch (e) {
        console.warn('[Discounts] recordDiscountUsage failed:', e?.message || e);
        return false;
    }
}

module.exports = { evaluateDiscount, validateCouponCode, recordDiscountUsage, discountAmount };
