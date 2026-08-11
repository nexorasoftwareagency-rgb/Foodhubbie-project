/**
 * BOT-SIDE DISCOUNT ENGINE
 * Mirrors the Admin's discount-evaluator.js but uses firebase-admin (bypasses rules).
 * Used inside processOrderPlacement to auto-apply the best eligible discount.
 */

const db = require('./firebase.js').db; // firebase-admin instance
const { getData } = require('./firebase.js');

const CACHE_TTL_MS = 30_000;
const _cache = { data: null, fetchedAt: 0, outlet: null };

const _priority = { firstOrder: 4, coupon: 3, global: 2, category: 1 };

async function getAllDiscounts(OUTLET) {
    const now = Date.now();
    if (_cache.outlet === OUTLET && _cache.data && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.data;
    try {
        const snap = await db.ref(`${OUTLET}/discounts`).once('value');
        _cache.data = snap.val() || {};
    } catch (_) {
        _cache.data = _cache.data || {};
    }
    _cache.outlet = OUTLET;
    _cache.fetchedAt = now;
    return _cache.data;
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
 * Evaluate the best discount for a given checkout context.
 * Returns { discount, allApplied, amount, label, source } or null.
 */
async function evaluateDiscount({ OUTLET, customer, subtotal, couponCode, cart, channel = 'whatsapp', now = Date.now() }) {
    if (!subtotal || subtotal <= 0) return null;

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
 * Validate a customer-entered coupon code against the discounts node.
 * Returns the matched discount or null. Case-insensitive.
 */
async function validateCouponCode(OUTLET, code) {
    if (!code) return null;
    const all = await getAllDiscounts(OUTLET);
    const lower = String(code).toLowerCase();
    const now = Date.now();
    for (const [id, d] of Object.entries(all)) {
        if (!d || d.type !== 'coupon' || !d.couponCode) continue;
        if (String(d.couponCode).toLowerCase() === lower) {
            if (d.enabled === false) return { id, ...d, status: 'disabled' };
            if (d.startsAt && now < d.startsAt) return { id, ...d, status: 'not_started' };
            if (d.endsAt && d.endsAt > 0 && now > d.endsAt) return { id, ...d, status: 'expired' };
            return { id, ...d, status: 'valid' };
        }
    }
    return null;
}

/**
 * Persist a usage record + bump the discount's stats atomically.
 */
async function recordDiscountUsage({ OUTLET, discountId, orderId, customerPhone, amountGiven, globalLimit, channel, discountLabel, discountSource }) {
    try {
        let reserved = true;
        const txResult = await db.ref(`${OUTLET}/discounts/${discountId}/stats`).transaction((cur) => {
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

        const usageId = db.ref(`${OUTLET}/discountsUsage`).push().key;
        await db.ref(`${OUTLET}/discountsUsage/${usageId}`).set({
            discountId, discountLabel: discountLabel || '',
            orderId: orderId || '', customerPhone: customerPhone || '',
            amountGiven: Math.round(Number(amountGiven) || 0),
            appliedAt: Date.now(), channel: channel || 'whatsapp',
            source: discountSource || ''
        });
        return true;
    } catch (e) {
        console.warn('[Discounts] recordDiscountUsage failed:', e?.message || e);
        return false;
    }
}

/**
 * Format the discount line that appears on the invoice / receipt.
 */
function formatDiscountLine(discount) {
    if (!discount || !discount.discount) return '';
    const label = discount.discount.name ? ` (${discount.discount.name})` : '';
    return `🎁 Discount${label}: -₹${Number(discount.amount).toFixed(0)}\n`;
}

module.exports = { evaluateDiscount, validateCouponCode, recordDiscountUsage, formatDiscountLine, getAllDiscounts };
