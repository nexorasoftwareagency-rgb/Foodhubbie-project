/**
 * Menu/js/discount.js
 * Lightweight discount code validator for the customer-facing menu.
 * Fetches enabled coupon-type discounts from Firebase and validates
 * the customer-entered code against them.
 */
import { outletRef, get } from './firebase.js';

const CACHE_TTL_MS = 60_000;
let _cache = null;
let _fetchedAt = 0;

async function fetchDiscounts() {
    const now = Date.now();
    if (_cache && (now - _fetchedAt) < CACHE_TTL_MS) return _cache;
    try {
        const snap = await get(outletRef('discounts'));
        const all = snap.val() || {};
        _cache = Object.entries(all)
            .filter(([, d]) => d && d.enabled !== false && d.type === 'coupon' && d.couponCode)
            .map(([id, d]) => ({ id, ...d }));
    } catch (_) {
        _cache = _cache || [];
    }
    _fetchedAt = now;
    return _cache;
}

/**
 * Validate a coupon code against active discounts.
 * @param {string} code - Customer-entered code
 * @param {number} subtotal - Cart subtotal in ₹
 * @returns {Promise<null|{discountId:string, name:string, couponCode:string, mode:string, value:number, maxCap:number|null, amount:number}>}
 */
export async function validateCoupon(code, subtotal) {
    if (!code || !String(code).trim()) return null;
    const normalized = String(code).trim().toUpperCase();
    const discounts = await fetchDiscounts();
    const now = Date.now();

    for (const d of discounts) {
        if (String(d.couponCode).toUpperCase() !== normalized) continue;
        // Check validity window
        if (d.startsAt && now < d.startsAt) continue;
        if (d.endsAt && d.endsAt > 0 && now > d.endsAt) continue;
        // Check min subtotal
        if (d.minSubtotal && subtotal < d.minSubtotal) continue;
        // Check global limit
        if (d.globalLimit && (d.stats?.usedCount || 0) >= d.globalLimit) continue;

        const raw = d.mode === 'percent' ? subtotal * (Number(d.value) || 0) / 100 : Number(d.value) || 0;
        const amount = d.maxCap ? Math.min(raw, d.maxCap) : raw;
        if (amount <= 0) continue;

        return {
            discountId: d.id,
            name: d.name || d.couponCode,
            couponCode: d.couponCode,
            mode: d.mode,
            value: d.value,
            maxCap: d.maxCap || null,
            amount: Math.round(amount),
        };
    }
    return null;
}
