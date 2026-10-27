/**
 * SHARED DISCOUNT EVALUATOR (I/O layer)
 * Used by both Admin (POS preview) and Bot (order placement).
 * Resolves the best applicable discount for a given cart + customer context.
 *
 * Pure math + eligibility rules live in shared/discount-rules.js — the single
 * source of truth. The P2-9 formula used to be triplicated here, in
 * bot/discount-engine.js and menu/js/discount.js with "keep in sync"
 * comments, and had already drifted. This file keeps only what touches
 * Firebase: caches, the feature flag, and usage recording.
 */

import { Outlet, ref, get, runTransaction, push } from '../firebase.js';
import {
    discountAmount, evaluateDiscounts, isDiscountActiveNow, discountAllowsChannel,
    cartHasCategory, needsPinApproval,
} from '../../shared/discount-rules.js';

// Re-exported so existing importers (utils.js → needsPinApproval) and future
// consumers keep a single familiar import path.
export { discountAmount, isDiscountActiveNow, discountAllowsChannel, needsPinApproval };

const CACHE_TTL_MS = 30_000;
const _cache = { data: null, fetchedAt: 0 };
const _catCache = { data: null, fetchedAt: 0 };
const FEATURE_FLAG_PATH = 'discounts/featureEnabled';

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

// isDiscountActiveNow, discountAllowsChannel and needsPinApproval moved to
// shared/discount-rules.js and are re-exported above. discounts.js and
// discountsReports.js still keep their own local copies of the active/channel
// logic (pre-existing, not touched here to avoid risking a regression in
// already-reviewed code) but could be pointed at the shared module in a
// future pass.

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
                    const matches = cartHasCategory(cart, d.categoryIds, categories);
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
                return cartHasCategory(cart, d.categoryIds, categories);
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
 * Evaluate which discount(s) apply to this checkout.
 * Eligibility + math live in shared/discount-rules.js (evaluateDiscounts);
 * this wrapper adds only the Firebase I/O: feature flag, discounts fetch,
 * and the category key→name bridge.
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
    const { subtotal = 0 } = ctx;
    if (!subtotal || subtotal <= 0) return null;
    if (!await _isFeatureEnabled()) return null;

    const all = await getAllDiscounts();
    const list = Object.entries(all)
        .filter(([, d]) => d && d.type && d.value != null)
        .map(([id, d]) => ({ id, ...d }));
    // Only touch the categories node when a category discount could win —
    // keeps the common checkout read count unchanged.
    const categories = list.some(d => d.type === 'category') ? await getAllCategories() : [];

    return evaluateDiscounts(list, { ...ctx, categories });
}

/**
 * Persist a usage record + bump the discount's stats atomically.
 * Called from POS and Bot after a successful order.
 * Pass isVoid: true to decrement stats for voided redemptions.
 */
export async function recordDiscountUsage({ discountId, orderId, customerPhone, amountGiven, channel, discountLabel, discountSource, globalLimit, isVoid }) {
    try {
        // Manual discounts (POS "Manual Discount" / %) have no `discounts/{id}`
        // record — bumping their stats creates phantom nodes that render as
        // blank cards in the Discounts tab. Their usage row is still logged.
        if (!String(discountId || '').startsWith('manual:')) {
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
        }
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
