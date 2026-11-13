/**
 * DISCOUNT ENGINE CORE (I/O wrapper, dependency-injected — batch 23c)
 *
 * The pure rules live in `shared/discount-rules.js` (single source of truth
 * shared with Admin and the menu checkout). This file wraps them with the DB
 * reads/writes an evaluation and a usage record need, WITHOUT owning a Firebase
 * instance: `db`, `getData` and `resolvePath` arrive as arguments.
 *
 * Why: the WhatsApp bot builds one engine from `bot/firebase.js` (see the
 * `bot/discount-engine.js` shim), and the Cloud Functions order-finalizer shadow
 * trigger builds its own from the Functions admin instance + an event-scoped
 * path resolver — same code, no `bot/firebase.js` (which would initialise a
 * privileged app and hard-code the database URL) inside the Functions bundle.
 *
 * Behaviour is unchanged from the pre-23c module; the cache is now keyed by the
 * RESOLVED discounts path so two tenants whose outlet ids collide (the e2e
 * business has an outlet literally named `pizza`) can never share a cache entry.
 */

// The pure rules. require(esm) needs Node >= 22.12; on an older runtime or a
// partial deploy missing shared/ we degrade gracefully: the 4-line amount
// formula keeps working via the frozen local copy below, full evaluation
// returns null (no discount applied — never a WRONG discount), and the warn
// shows in pm2 / Functions logs.
let rules = null;
try { rules = require('../shared/discount-rules.js'); }
catch (e) {
    console.warn('[Discounts] shared/discount-rules.js failed to load — full discount evaluation disabled.'
        + ' Ensure the deploy includes the repo shared/ folder and Node >= 22.12. Detail:', e && e.message);
}

// ponytail: frozen fallback for the amount formula only — delete once every
// runtime is confirmed on Node >= 22.12 with shared/ present.
function _localDiscountAmount(d, subtotal) {
    let amt = d.mode === 'percent' ? subtotal * (Number(d.value) || 0) / 100 : Number(d.value) || 0;
    if (d.maxCap && amt > d.maxCap) amt = d.maxCap;
    return amt;
}
const discountAmount = rules ? rules.discountAmount : _localDiscountAmount;

/**
 * @param {object} deps
 * @param {object} deps.db            firebase-admin database instance
 * @param {(p: string, o: string) => Promise<any>} deps.getData
 * @param {(p: string, o: string) => string} deps.resolvePath
 */
function createDiscountEngine({ db, getData, resolvePath }) {
    if (!db) throw new Error('discount-engine: missing required dep "db"');
    if (typeof getData !== 'function') throw new Error('discount-engine: missing required dep "getData"');
    if (typeof resolvePath !== 'function') throw new Error('discount-engine: missing required dep "resolvePath"');

    const CACHE_TTL_MS = 30_000;
    const _cache = new Map();   // resolved discounts path -> { data, fetchedAt }

    async function getAllDiscounts(OUTLET) {
        const key = resolvePath('discounts', OUTLET);
        const now = Date.now();
        const hit = _cache.get(key);
        if (hit && hit.data && (now - hit.fetchedAt) < CACHE_TTL_MS) return hit.data;
        let data = (hit && hit.data) || {};
        try {
            const snap = await db.ref(key).once('value');
            data = snap.val() || {};
        } catch (_) { /* keep the last good copy */ }
        _cache.set(key, { data, fetchedAt: now });
        return data;
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

    /**
     * Reverse the usage `recordDiscountUsage` recorded when the sale falls
     * through — the order is cancelled or refunded after the bot finalized it.
     * Without this a limited coupon stays consumed forever: `stats.usedCount`
     * never frees up, the customer's `discountUsage` counter keeps them locked
     * out of a per-customer offer, and a first-order customer never gets their
     * one-shot back after cancelling.
     *
     * Writes a NEGATIVE audit row so summing a discount's history still nets to
     * zero (Admin's void path uses the same convention). Callers guarantee this
     * runs at most once per order; every decrement is floored at 0 anyway.
     */
    async function releaseDiscountUsage({ OUTLET, orderId, discountId, customerPhone, amountGiven, discountLabel, discountSource }) {
        if (!discountId) return false;
        const amount = Math.abs(Math.round(Number(amountGiven) || 0));
        try {
            const statsRef = db.ref(resolvePath(`discounts/${discountId}/stats`, OUTLET));
            const statsSnap = await statsRef.once('value').catch(() => null);
            // No stats node (discount deleted since) — do not resurrect it.
            if (statsSnap && statsSnap.exists()) {
                const seed = statsSnap.val() || {};
                await statsRef.transaction((cur) => {
                    const node = cur || seed;   // first ticket is null even when it exists
                    return {
                        ...node,
                        usedCount: Math.max(0, (node.usedCount || 0) - 1),
                        totalDiscountGiven: Math.max(0, (node.totalDiscountGiven || 0) - amount)
                    };
                });
            }
            const usageId = db.ref(resolvePath(`discountsUsage`, OUTLET)).push().key;
            await db.ref(resolvePath(`discountsUsage/${usageId}`, OUTLET)).set({
                discountId, discountLabel: discountLabel || '',
                orderId: orderId || '', customerPhone: customerPhone || '',
                amountGiven: -amount,
                appliedAt: Date.now(), channel: 'webview',
                source: discountSource || '', discountSource: discountSource || '',
                voidReason: 'order-cancelled'
            });

            const phone10 = customerPhone ? String(customerPhone).replace(/\D/g, '').slice(-10) : '';
            if (/^[6-9]\d{9}$/.test(phone10)) {
                const custRef = db.ref(resolvePath(`customers/${phone10}`, OUTLET));
                const baseSnap = await custRef.once('value').catch(() => null);
                await custRef.transaction((c) => {
                    const node = c || (baseSnap && baseSnap.val());
                    if (!node) return undefined;
                    const updated = { ...node };
                    const usage = { ...(node.discountUsage || {}) };
                    const count = Number(usage[discountId]) || 0;
                    if (count > 1) usage[discountId] = count - 1;
                    else delete usage[discountId];
                    updated.discountUsage = usage;
                    if (discountSource === 'firstOrder' && node.firstOrderDiscountId === discountId) {
                        delete updated.firstOrderDiscountUsed;
                        delete updated.firstOrderDiscountId;
                    }
                    return updated;
                }).catch(e => console.warn('[Discounts] release customer counter failed:', e?.message || e));
            }
            return true;
        } catch (e) {
            console.warn('[Discounts] releaseDiscountUsage failed:', e?.message || e);
            return false;
        }
    }

    return { evaluateDiscount, validateCouponCode, recordDiscountUsage, releaseDiscountUsage, discountAmount };
}

module.exports = { createDiscountEngine, discountAmount };
