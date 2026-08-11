/**
 * SHARED DISCOUNT EVALUATOR
 * Used by both Admin (POS preview) and Bot (order placement).
 * Resolves the best applicable discount for a given cart + customer context.
 */

import { Outlet, ref, get, runTransaction, push } from '../firebase.js';

const CACHE_TTL_MS = 30_000;
const _cache = { data: null, fetchedAt: 0 };
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
}

async function _isFeatureEnabled() {
    try {
        const snap = await get(Outlet.ref(FEATURE_FLAG_PATH));
        return snap.val() !== false; // null/undefined = on by default
    } catch (_) {
        return true;
    }
}

function _cartHasCategory(cart, categoryIds) {
    if (!Array.isArray(cart) || !Array.isArray(categoryIds) || categoryIds.length === 0) return false;
    return cart.some(item => categoryIds.includes(item.categoryId) || categoryIds.includes(item.category));
}

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

    const customerPhone = customer?.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;

    const candidates = list.filter(d =>
        d.enabled !== false
        && now >= (d.startsAt || 0)
        && (d.endsAt === 0 || d.endsAt == null || now <= d.endsAt)
        && (!d.minSubtotal || subtotal >= d.minSubtotal)
        && (!d.globalLimit || (d.stats?.usedCount || 0) < d.globalLimit)
        && (!d.channel || d.channel === 'all' || d.channel === channel || (d.channel === 'both' && (channel === 'whatsapp' || channel === 'pos')))
        && (!d.perCustomerLimit || !customerPhone || (customer?.discountUsage?.[d.id] || 0) < d.perCustomerLimit)
    );

    const applicable = candidates.filter(d => {
        if (d.type === 'global')     return true;
        if (d.type === 'firstOrder') return !customer?.firstOrderDiscountUsed;
        if (d.type === 'category')   return _cartHasCategory(cart, d.categoryIds);
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
 */
export async function recordDiscountUsage({ discountId, orderId, customerPhone, amountGiven, channel, discountLabel, discountSource, globalLimit }) {
    try {
        // Bump stats atomically — abort if globalLimit would be exceeded
        let reserved = true;
        const txResult = await runTransaction(Outlet.ref(`discounts/${discountId}/stats`), (cur) => {
            cur = cur || {};
            const nextCount = (cur.usedCount || 0) + 1;
            if (globalLimit && nextCount > globalLimit) { reserved = false; return; }
            return {
                usedCount: nextCount,
                totalDiscountGiven: (cur.totalDiscountGiven || 0) + Math.round(Number(amountGiven) || 0),
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
            source: discountSource || ''
        });
    } catch (e) {
        console.warn('[Discounts] Failed to record usage:', e?.message || e);
    }
}
