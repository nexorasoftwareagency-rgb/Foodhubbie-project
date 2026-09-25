/**
 * SHARED DISCOUNT EVALUATOR
 * Used by both Admin (POS preview) and Bot (order placement).
 * Resolves the best applicable discount for a given cart + customer context.
 */

import { Outlet, ref, get, runTransaction, push } from '../firebase.js';

const CACHE_TTL_MS = 30_000;
const _cache = { data: null, fetchedAt: 0 };
const _catCache = { data: null, fetchedAt: 0 };
const FEATURE_FLAG_PATH = 'discounts/featureEnabled';

const _priority = { firstOrder: 4, coupon: 3, global: 2, category: 1 };

/**
 * Fetch all enabled+active discount definitions for the current outlet.
 * Cached for 30 s to spare Firebase reads.
 */
export async function getAllDiscounts() {
    const now = Date.now();
    if (_cache.data && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.data;
    try {
        const snap = await get(Outlet.ref('discounts'));
        _cache.data = snap.val() || {};
    } catch (_) {
        _cache.data = _cache.data || {};
    }
    _cache.fetchedAt = now;
    return _cache.data;
}

export function clearDiscountCache() {
    _cache.data = null;
    _cache.fetchedAt = 0;
    _catCache.data = null;
    _catCache.fetchedAt = 0;
}

/**
 * Category push-key → name list, cached 30 s like the discounts list.
 *
 * Discounts store category KEYS (catalog.js creates them with `push()`),
 * but every cart carries category NAMES — the POS walk-in cart stores
 * `dish.category`, and QR order items store none at all. Without this
 * bridge `_cartHasCategory` can never match and category discounts are dead.
 */
export async function getAllCategories() {
    const now = Date.now();
    if (_catCache.data && (now - _catCache.fetchedAt) < CACHE_TTL_MS) return _catCache.data;
    try {
        const snap = await get(Outlet.ref('categories'));
        _catCache.data = Object.entries(snap.val() || {}).map(([id, c]) => ({ id, name: c && c.name }));
    } catch (_) {
        _catCache.data = _catCache.data || [];
    }
    _catCache.fetchedAt = now;
    return _catCache.data;
}

/**
 * True if a discount is enabled and within its active window right now.
 * Shared home for this check — POS's offers panel uses it directly;
 * discounts.js and discountsReports.js each still keep their own local
 * copy of the same logic (pre-existing, not touched here to avoid
 * risking a regression in already-reviewed code) but could be pointed
 * at this one in a future pass.
 */
export function isDiscountActiveNow(d, now = Date.now()) {
    if (!d || d.enabled === false) return false;
    if (d.startsAt && now < d.startsAt) return false;
    if (d.endsAt && d.endsAt !== 0 && now > d.endsAt) return false;
    return true;
}

/** True if a discount's `channel` field permits it to apply on this channel. */
export function discountAllowsChannel(d, channel) {
    return !d.channel || d.channel === 'all' || d.channel === channel
        // Table bills settle through the POS terminal, so a POS-only discount
        // covers them too — table billing passes channel:'table' (tables.js),
        // while the editor can only author WhatsApp/POS/Both/Website/All.
        || (d.channel === 'pos' && channel === 'table')
        || (d.channel === 'both' && (channel === 'whatsapp' || channel === 'pos' || channel === 'table'));
}

/**
 * Builds the list of currently-eligible-for-display discounts for a
 * quick-apply offers panel: active, channel-permitted, not at its global
 * redemption cap. Coupon types sort first. Shared by POS's and Table
 * Bill Payment's "Active offers" panels so both apply the exact same
 * eligibility rule — a discount that shows as available in one always
 * shows (or doesn't) the same way in the other.
 *
 * Async because it needs the category key→name map to judge category
 * discounts (see getAllCategories). Callers must `await`.
 */
export async function getEligibleOffersForDisplay(all, { channel = 'pos', now = Date.now(), cart = [], includeNonMatchingCategories = false } = {}) {
    const categories = await getAllCategories();
    const baseList = Object.entries(all || {})
        .map(([id, d]) => ({ id, ...d }))
        .filter(d => d && d.type && d.value != null)
        .filter(d => isDiscountActiveNow(d, now))
        .filter(d => discountAllowsChannel(d, channel))
        .filter(d => !d.globalLimit || (d.stats?.usedCount || 0) < d.globalLimit);

    if (includeNonMatchingCategories) {
        // Include category discounts even if they don't match cart, but mark them
        return baseList
            .filter(d => {
                if (d.type === 'category') {
                    const matches = _cartHasCategory(cart, d.categoryIds, categories);
                    d._categoryMatches = matches;
                    return true; // Include all category discounts
                }
                return true;
            })
            .sort((a, b) => (a.type === 'coupon' ? 0 : 1) - (b.type === 'coupon' ? 0 : 1));
    }

    // Original behavior: filter out non-matching category discounts
    return baseList
        .filter(d => {
            if (d.type === 'category') {
                return _cartHasCategory(cart, d.categoryIds, categories);
            }
            return true;
        })
        .sort((a, b) => (a.type === 'coupon' ? 0 : 1) - (b.type === 'coupon' ? 0 : 1));
}

async function _isFeatureEnabled() {
    try {
        const snap = await get(Outlet.ref(FEATURE_FLAG_PATH));
        return snap.val() !== false; // null/undefined = on by default
    } catch (_) {
        return true;
    }
}

/**
 * Does the cart contain anything in one of this discount's categories?
 *
 * `categoryIds` are Firebase push keys; `item.category` is a category NAME
 * (POS walk-in cart stores `dish.category`) and `item.categoryId` is usually
 * absent. Compare keys against keys, then keys (resolved via `categories`)
 * against names — otherwise this always returns false and category
 * discounts never fire in any channel.
 */
function _cartHasCategory(cart, categoryIds, categories) {
    if (!Array.isArray(cart) || !Array.isArray(categoryIds) || categoryIds.length === 0) return false;
    const names = new Set(
        (categories || [])
            .filter(c => c && categoryIds.includes(c.id))
            .map(c => c.name)
    );
    return cart.some(item => categoryIds.includes(item.categoryId)
        || categoryIds.includes(item.category)
        || names.has(item.category));
}

// P2-9 policy (locked): base = food subtotal only (ctx.subtotal excludes tax/SC/delivery).
// Stacked discounts each use the full food subtotal as base; grand total is capped at subtotal below.
// Same formula in menu/js/discount.js and bot/discount-engine.js — keep in sync.
function _discountAmount(d, subtotal) {
    let amt = d.mode === 'percent' ? subtotal * (Number(d.value) || 0) / 100 : Number(d.value) || 0;
    if (d.maxCap && amt > d.maxCap) amt = d.maxCap;
    return amt;
}

function _pickBest(group, subtotal) {
    return group.slice().sort((a, b) => {
        const pa = _priority[a.type] || 0, pb = _priority[b.type] || 0;
        if (pa !== pb) return pb - pa;
        return _discountAmount(b, subtotal) - _discountAmount(a, subtotal);
    })[0];
}

/**
 * Evaluate which discount(s) apply to this checkout.
 * @param {Object} ctx
 * @param {Object} [ctx.customer] - Customer record (may be null for new customers)
 * @param {number} ctx.subtotal - Food subtotal in ₹ (NOT including delivery)
 * @param {string} [ctx.couponCode] - Customer-entered coupon code
 * @param {Array}  [ctx.cart] - Cart items (for category discounts)
 * @param {string} [ctx.channel] - Channel: 'pos', 'whatsapp', 'website', etc.
 * @param {number} [ctx.now] - Override "now" timestamp (default Date.now())
 * @returns {Promise<null | { discount, allApplied, amount, label, source }>}
 */
export async function evaluateDiscount(ctx = {}) {
    const { customer = null, subtotal = 0, couponCode = null, cart = [], channel = 'whatsapp', now = Date.now() } = ctx;
    if (!subtotal || subtotal <= 0) return null;
    if (!await _isFeatureEnabled()) return null;

    const all = await getAllDiscounts();
    const list = Object.entries(all)
        .filter(([, d]) => d && d.type && d.value != null)
        .map(([id, d]) => ({ id, ...d }));
    // Only touch the categories node when a category discount could win —
    // keeps the common checkout read count unchanged.
    const categories = list.some(d => d.type === 'category') ? await getAllCategories() : [];

    const customerPhone = customer?.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;

    const candidates = list.filter(d =>
        d.enabled !== false
        && now >= (d.startsAt || 0)
        && (d.endsAt === 0 || d.endsAt == null || now <= d.endsAt)
        && (!d.minSubtotal || subtotal >= d.minSubtotal)
        && (!d.globalLimit || (d.stats?.usedCount || 0) < d.globalLimit)
        && discountAllowsChannel(d, channel)
        && (!d.perCustomerLimit || !customerPhone || 
            (customer?.discountUsage?.[d.id] || 0) < d.perCustomerLimit &&
            // For table channel, also check separate table counter
            (channel !== 'table' || (customer?.discountUsage?.table?.[d.id] || 0) < d.perCustomerLimit))
    );

    const applicable = candidates.filter(d => {
        if (d.type === 'global')     return true;
        if (d.type === 'firstOrder') return !customer?.firstOrderDiscountUsed;
        if (d.type === 'category')   return _cartHasCategory(cart, d.categoryIds, categories);
        if (d.type === 'coupon')     return !!couponCode && String(couponCode).toLowerCase() === String(d.couponCode || '').toLowerCase();
        return false;
    });

    if (applicable.length === 0) return null;

    // Group-aware exclusivity
    const byGroup = new Map();
    for (const d of applicable) {
        const g = d.exclusiveGroup || '__none__';
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(d);
    }
    const bestPerGroup = [...byGroup.values()].map(g => _pickBest(g, subtotal));
    const exclusive    = bestPerGroup.filter(d => !d.stackable);
    const stackables   = bestPerGroup.filter(d =>  d.stackable);
    const chosen       = exclusive.length > 0 ? [_pickBest(exclusive, subtotal), ...stackables] : bestPerGroup;

    let total = 0;
    for (const d of chosen) total += _discountAmount(d, subtotal);
    total = Math.round(Math.min(total, subtotal));

    if (total <= 0) return null;
    const primary = chosen[0];
    return {
        discount: primary,
        allApplied: chosen,
        amount: total,
        label: primary.name || (primary.type === 'firstOrder' ? 'New Customer Discount' : 'Discount'),
        source: primary.type === 'coupon'
            ? `coupon:${primary.couponCode}`
            : primary.type === 'firstOrder'
                ? 'firstOrder'
                : `auto:${primary.type}`,
    };
}

/**
 * Persist a usage record + bump the discount's stats atomically.
 * Called from POS and Bot after a successful order.
 * Pass isVoid: true to decrement stats for voided redemptions.
 */
export async function recordDiscountUsage({ discountId, orderId, customerPhone, amountGiven, channel, discountLabel, discountSource, globalLimit, isVoid }) {
    try {
        // Bump stats atomically — abort if globalLimit would be exceeded
        let reserved = true;
        const txResult = await runTransaction(Outlet.ref(`discounts/${discountId}/stats`), (cur) => {
            cur = cur || {};
            const currentCount = cur.usedCount || 0;
            const nextCount = isVoid ? Math.max(0, currentCount - 1) : currentCount + 1;
            // amountGiven arrives already correctly signed by the caller
            // (negative for a void, positive for a normal redemption) — do
            // NOT re-negate it here. An earlier version did `isVoid ? -amount
            // : amount`, which double-negated a void's already-negative
            // value back to positive: voiding a discount INCREASED
            // totalDiscountGiven instead of decreasing it, and recorded a
            // positive audit-trail entry for a void instead of a negative
            // one — so summing a discount's usage history would overcount
            // by double the voided amount instead of netting to zero.
            const amount = Math.round(Number(amountGiven) || 0);
            if (globalLimit && nextCount > globalLimit) { reserved = false; return; }
            return {
                usedCount: nextCount,
                totalDiscountGiven: (cur.totalDiscountGiven || 0) + amount,
                lastUsedAt: Date.now()
            };
        });
        if (!reserved || !txResult.committed) { console.warn(`[Discounts] Redemption cap reached or tx failed for ${discountId}`); return; }
        const usageId = push(Outlet.ref('discountsUsage')).key;
        await Outlet.ref(`discountsUsage/${usageId}`).set({
            discountId, discountLabel: discountLabel || '',
            orderId: orderId || '', customerPhone: customerPhone || '',
            amountGiven: Math.round(Number(amountGiven) || 0),
            appliedAt: Date.now(), channel: channel || 'pos',
            source: discountSource || '',
            // P2-8: readers (discounts.js / discountsReports.js) key off discountSource;
            // bot + this writer historically only set `source` — write both so void
            // rows and type filters resolve without field-name drift.
            discountSource: discountSource || ''
        });
    } catch (e) {
        console.warn('[Discounts] Failed to record usage:', e?.message || e);
    }
}
