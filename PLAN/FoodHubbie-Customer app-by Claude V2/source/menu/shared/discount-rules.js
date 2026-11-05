/**
 * FoodHubbie ERP | DISCOUNT RULES (pure — no imports, runnable in node or browser)
 * Single source of truth for discount math + eligibility, consumed by:
 *   Admin/js/features/discount-evaluator.js  (POS + table billing preview)
 *   bot/discount-engine.js                   (WhatsApp order placement, EC2)
 *   menu/js/discount.js                      (customer QR checkout — via the
 *                                             byte-identical menu/shared copy;
 *                                             menu hosting cannot reach /shared)
 *
 * P2-9 policy (locked): base = food subtotal only (no tax/SC/delivery).
 * Stacked discounts each use the full food subtotal as base; the grand total
 * is capped at the subtotal. This formula used to live in three files with
 * "keep in sync" comments and had already drifted (admin matched coupons by
 * `d.couponCode` truthiness instead of `type === 'coupon'`; the table-channel
 * per-customer counter existed only admin-side). One module, zero drift.
 *
 * Happy-hour windows + coupon rejection reasons are clean-room
 * re-implementations of ideas studied in OrderRestro (AGPL-3.0) — logic
 * adopted, no source copied. menu/shared/discount-rules.js must stay
 * byte-identical to this file (tools/check-shared-twins.cjs guards it).
 */

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Amount for ONE discount off the food subtotal. Exact legacy semantics:
 * `maxCap` is falsy-means-uncapped, and the result is NOT rounded here —
 * stacked amounts are summed raw and the stack total is rounded once, so
 * per-discount rounding must not creep in (it would shift stacked totals
 * by a paisa versus every order placed before this module existed).
 */
export function discountAmount(d, subtotal) {
    let amt = d.mode === 'percent' ? subtotal * (Number(d.value) || 0) / 100 : Number(d.value) || 0;
    if (d.maxCap && amt > d.maxCap) amt = d.maxCap;
    return amt;
}

/** True if a discount is enabled and within its active window right now. */
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
 * Does the cart contain anything in one of this discount's categories?
 *
 * `categoryIds` are Firebase push keys; `item.category` is a category NAME
 * (POS walk-in cart stores `dish.category`) and `item.categoryId` is usually
 * absent. Compare keys against keys, then keys (resolved via `categories`)
 * against names — otherwise this always returns false and category
 * discounts never fire in any channel. `categories` is optional: callers
 * without the key→name bridge (bot) pass nothing and match on raw fields.
 * Accepts a cart array or an object map (bot webview payloads).
 */
export function cartHasCategory(cart, categoryIds, categories) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return false;
    const items = Array.isArray(cart) ? cart : Object.values(cart || {});
    if (!items.length) return false;
    const names = new Set(
        (categories || [])
            .filter(c => c && categoryIds.includes(c.id))
            .map(c => c.name)
    );
    return items.some(item => categoryIds.includes(item.categoryId)
        || categoryIds.includes(item.category)
        || names.has(item.category));
}

const PRIORITY = { firstOrder: 4, coupon: 3, global: 2, category: 1 };

function _pickBest(group, subtotal) {
    return group.slice().sort((a, b) => {
        const pa = PRIORITY[a.type] || 0, pb = PRIORITY[b.type] || 0;
        if (pa !== pb) return pb - pa;
        return discountAmount(b, subtotal) - discountAmount(a, subtotal);
    })[0];
}

/**
 * Evaluate which discount(s) apply to this checkout — the pure core shared
 * by Admin and bot. Callers fetch the discounts node themselves (different
 * Firebase SDKs) and pass `[{id, ...discount}]`.
 *
 * @param {Array}  discounts - Candidate definitions (pre-filtered to entries with type + value)
 * @param {Object} ctx
 * @param {Object} [ctx.customer] - Customer record (may be null for new customers)
 * @param {number} ctx.subtotal - Food subtotal in ₹ (NOT including tax/SC/delivery)
 * @param {string} [ctx.couponCode] - Customer-entered coupon code
 * @param {Array}  [ctx.cart] - Cart items (for category discounts)
 * @param {string} [ctx.channel] - 'pos' | 'whatsapp' | 'website' | 'table'
 * @param {Array}  [ctx.categories] - [{id, name}] key→name bridge for category discounts
 * @param {number} [ctx.now] - Override "now" timestamp (default Date.now())
 * @returns {null | { discount, allApplied, amount, label, source }}
 */
export function evaluateDiscounts(discounts, ctx = {}) {
    const { customer = null, subtotal = 0, couponCode = null, cart = [], channel = 'whatsapp', categories = [], now = Date.now() } = ctx;
    if (!subtotal || subtotal <= 0) return null;
    if (!Array.isArray(discounts) || discounts.length === 0) return null;

    const customerPhone = customer?.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;

    const candidates = discounts.filter(d =>
        d
        && d.enabled !== false
        && now >= (d.startsAt || 0)
        && (d.endsAt === 0 || d.endsAt == null || now <= d.endsAt)
        && (!d.minSubtotal || subtotal >= d.minSubtotal)
        && (!d.globalLimit || (d.stats?.usedCount || 0) < d.globalLimit)
        && discountAllowsChannel(d, channel)
        && (!d.perCustomerLimit || !customerPhone ||
            (customer?.discountUsage?.[d.id] || 0) < d.perCustomerLimit
            // For table channel, also check separate table counter
            && (channel !== 'table' || (customer?.discountUsage?.table?.[d.id] || 0) < d.perCustomerLimit))
        && inSchedule(d, now)
    );

    const applicable = candidates.filter(d => {
        if (d.type === 'global')     return true;
        if (d.type === 'firstOrder') return !customer?.firstOrderDiscountUsed;
        if (d.type === 'category')   return cartHasCategory(cart, d.categoryIds, categories);
        if (d.type === 'coupon')     return !!couponCode && String(couponCode).toLowerCase() === String(d.couponCode || '').toLowerCase();
        return false;
    });

    if (applicable.length === 0) return null;

    // Group-aware exclusivity: within an exclusiveGroup only the best wins;
    // stackable discounts ride on top of the best exclusive one.
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
    for (const d of chosen) total += discountAmount(d, subtotal);
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

/** Lifecycle status of a coupon-type discount, for customer-facing messaging. */
export function couponStatus(d, now = Date.now()) {
    if (!d) return null;
    if (d.enabled === false) return 'disabled';
    if (d.startsAt && now < d.startsAt) return 'not_started';
    if (d.endsAt && d.endsAt > 0 && now > d.endsAt) return 'expired';
    if (!inSchedule(d, now)) return 'not_in_window';
    return 'valid';
}

/** Human-readable text for each non-valid coupon status (customer-facing). */
export const COUPON_STATUS_TEXT = {
    disabled: 'This coupon is currently disabled',
    not_started: 'This coupon is not active yet — please try again later',
    expired: 'This coupon has expired',
    not_in_window: 'This coupon is not valid at this time — check its scheduled hours',
};

/**
 * Weekly schedule (happy hour) check for a discount doc. Absent/empty
 * schedule = valid at any time. Days follow JS getDay() (0 = Sunday …
 * 6 = Saturday); times are outlet-local "HH:MM" (IST). Delegates to
 * promotionActive so the editor-stored fields and this check can never
 * drift apart.
 */
export function inSchedule(d, now = Date.now()) {
    if (!d) return true;
    const scheduled = (Array.isArray(d.daysOfWeek) && d.daysOfWeek.length > 0)
        || d.startTime || d.endTime
        || Number.isFinite(d.startMinute) || Number.isFinite(d.endMinute);
    if (!scheduled) return true;
    const ist = new Date(Number(now) + 19800000); // IST = UTC+5:30, matches the report buckets
    return promotionActive(d, ist.getUTCDay(), ist.getUTCHours() * 60 + ist.getUTCMinutes());
}

/**
 * Happy-hour windows (day-of-week + time-of-day automatic discounts).
 * `day` follows JS getDay() (0 = Sunday); `minute` is minutes since midnight.
 * Windows accept precomputed `startMinute`/`endMinute` or `startTime`/`endTime`
 * "HH:MM" strings — whatever the authoring UI stores. End-exclusive so a
 * 18:00–20:00 promo is still live at 19:59:59 and gone at 20:00:00.
 */
export function toMinutes(hhmm) {
    const parts = String(hhmm || '').split(':');
    const h = Number(parts[0]), m = Number(parts[1] || 0);
    if (!Number.isInteger(h) || h < 0 || h > 23) return NaN;
    if (!Number.isInteger(m) || m < 0 || m > 59) return NaN;
    return h * 60 + m;
}

export function promotionActive(p, day, minute) {
    if (!p || p.isActive === false) return false;
    if (Array.isArray(p.daysOfWeek) && p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(day)) return false;
    const start = Number.isFinite(p.startMinute) ? p.startMinute : toMinutes(p.startTime);
    const end = Number.isFinite(p.endMinute) ? p.endMinute : toMinutes(p.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (end <= start) return false; // malformed window never matches
    return minute >= start && minute < end;
}

/**
 * Approval ceiling for MANUAL discounts, expressed as a % of the bill.
 * Returns true only when a human-entered discount is above `ceilingPct`
 * and the ceiling is switched on (>0). Auto-applied discounts are out of
 * scope: they are author-defined and already bounded by `maxCap`.
 */
export function needsPinApproval(discountValue, subtotal, ceilingPct) {
    if (!(ceilingPct > 0) || !(subtotal > 0)) return false;
    return (Number(discountValue) / subtotal) * 100 > ceilingPct;
}

// check: node shared/discount-rules.js
// (dynamic import + .then, NOT top-level await — top-level await would make
// this module un-require()-able and bot/discount-engine.js requires it.)
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('discount-rules')) {
    import('node:assert').then(({ default: assert }) => {
        // discountAmount — the locked P2-9 policy (mirrors bot/tests/unit.test.js)
        assert.strictEqual(discountAmount({ mode: 'percent', value: 10 }, 500), 50);
        assert.strictEqual(discountAmount({ mode: 'flat', value: 100 }, 500), 100);
        assert.strictEqual(discountAmount({ mode: 'percent', value: 50, maxCap: 80 }, 500), 80);
        assert.strictEqual(discountAmount({ mode: 'flat', value: 90, maxCap: 0 }, 500), 90, 'maxCap=0 = uncapped');
        // stacking: full subtotal per discount, grand total capped at subtotal
        // (stackables must sit in different exclusiveGroups — within one group
        // only the best discount survives, that is the exclusivity rule)
        const stack = evaluateDiscounts([
            { id: 'a', type: 'global', mode: 'percent', value: 80, stackable: true, exclusiveGroup: 'g1' },
            { id: 'b', type: 'category', categoryIds: ['x'], mode: 'percent', value: 80, stackable: true, exclusiveGroup: 'g2' },
        ], { subtotal: 500, cart: [{ categoryId: 'x' }] });
        assert.strictEqual(stack.amount, 500, 'stack capped at subtotal');
        assert.strictEqual(stack.allApplied.length, 2, 'both stackables applied');
        // exclusive group: only the best non-stackable wins (priority firstOrder > global)
        const ex = evaluateDiscounts([
            { id: 'a', type: 'global', mode: 'percent', value: 10 },
            { id: 'b', type: 'firstOrder', mode: 'flat', value: 200, exclusiveGroup: 'g' },
            { id: 'c', type: 'global', mode: 'flat', value: 50, exclusiveGroup: 'g' },
        ], { subtotal: 500, customer: { phone: '919876543210' } });
        assert.strictEqual(ex.amount, 200);
        assert.strictEqual(ex.allApplied.length, 1);
        assert.strictEqual(ex.label, 'New Customer Discount');
        assert.strictEqual(ex.source, 'firstOrder');
        // coupon match is type-gated and case-insensitive
        const cp = evaluateDiscounts([
            { id: 'c1', type: 'coupon', couponCode: 'SAVE50', mode: 'flat', value: 50 },
        ], { subtotal: 500, couponCode: 'save50' });
        assert.strictEqual(cp.amount, 50);
        assert.strictEqual(cp.source, 'coupon:SAVE50');
        assert.strictEqual(evaluateDiscounts([{ id: 'c1', type: 'coupon', couponCode: 'SAVE50', mode: 'flat', value: 50 }], { subtotal: 500, couponCode: 'OTHER' }), null);
        // limits: min subtotal, global cap, per-customer cap (incl. table counter)
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'global', mode: 'flat', value: 50, minSubtotal: 600 }], { subtotal: 500 }), null);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'global', mode: 'flat', value: 50, globalLimit: 5, stats: { usedCount: 5 } }], { subtotal: 500 }), null);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'global', mode: 'flat', value: 50, perCustomerLimit: 1 }], { subtotal: 500, customer: { phone: '919876543210', discountUsage: { a: 1 } } }), null);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'global', mode: 'flat', value: 50, perCustomerLimit: 1 }], { subtotal: 500, channel: 'table', customer: { phone: '919876543210', discountUsage: { a: 0, table: { a: 1 } } } }), null, 'table counter enforced');
        // category matching: key, raw name, and bridged name all match
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'category', categoryIds: ['k1'], mode: 'percent', value: 10 }], { subtotal: 500, cart: [{ categoryId: 'k1' }] }).amount, 50);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'category', categoryIds: ['k1'], mode: 'percent', value: 10 }], { subtotal: 500, cart: [{ category: 'Hot Drinks' }], categories: [{ id: 'k1', name: 'Hot Drinks' }] }).amount, 50);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'category', categoryIds: ['k1'], mode: 'percent', value: 10 }], { subtotal: 500, cart: [{ category: 'Pizza' }], categories: [{ id: 'k1', name: 'Hot Drinks' }] }), null);
        // channel matrix (P0-4)
        assert.strictEqual(discountAllowsChannel({ channel: 'pos' }, 'table'), true);
        assert.strictEqual(discountAllowsChannel({ channel: 'pos' }, 'whatsapp'), false);
        assert.strictEqual(discountAllowsChannel({ channel: 'both' }, 'table'), true);
        assert.strictEqual(discountAllowsChannel({}, 'table'), true);
        // coupon lifecycle + human reason
        assert.strictEqual(couponStatus({ enabled: false }), 'disabled');
        assert.strictEqual(couponStatus({ startsAt: Date.now() + 1000 }), 'not_started');
        assert.strictEqual(couponStatus({ endsAt: Date.now() - 1000 }), 'expired');
        assert.strictEqual(couponStatus({}), 'valid');
        assert.ok(COUPON_STATUS_TEXT.expired.length > 5);
        // happy-hour window edges
        assert.strictEqual(promotionActive({ daysOfWeek: [5], startTime: '18:00', endTime: '20:00', isActive: true }, 5, toMinutes('18:00')), true, 'start-inclusive');
        assert.strictEqual(promotionActive({ daysOfWeek: [5], startTime: '18:00', endTime: '20:00' }, 5, toMinutes('19:59')), true);
        assert.strictEqual(promotionActive({ daysOfWeek: [5], startTime: '18:00', endTime: '20:00' }, 5, toMinutes('20:00')), false, 'end-exclusive');
        assert.strictEqual(promotionActive({ daysOfWeek: [5], startTime: '18:00', endTime: '20:00' }, 6, toMinutes('19:00')), false, 'wrong day');
        assert.strictEqual(promotionActive({ startTime: '18:00', endTime: '20:00', isActive: false }, 5, toMinutes('19:00')), false);
        assert.strictEqual(promotionActive({ startTime: '20:00', endTime: '18:00' }, 5, toMinutes('19:00')), false, 'malformed window');
        // weekly schedule on discounts (Phase 6 happy-hour): IST wall-clock from a fixed now
        // Date.UTC(2026, 9, 27, 10, 30) = 10:30Z → IST 16:00 on Tuesday 2026-10-27
        const t = Date.UTC(2026, 9, 27, 10, 30) - 19800000;
        assert.strictEqual(inSchedule({}, t), true, 'unscheduled = always');
        assert.strictEqual(inSchedule(null, t), true);
        assert.strictEqual(inSchedule({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }, t), true, 'Tue 16:00 inside 09-18 weekdays');
        assert.strictEqual(inSchedule({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '16:30', endTime: '18:00' }, t), false, 'after end');
        assert.strictEqual(inSchedule({ daysOfWeek: [0, 6], startTime: '09:00', endTime: '18:00' }, t), false, 'weekend only');
        assert.strictEqual(inSchedule({ startTime: '20:00', endTime: '18:00' }, t), false, 'malformed window never matches');
        assert.strictEqual(couponStatus({ daysOfWeek: [0, 6], startTime: '09:00', endTime: '18:00' }, t), 'not_in_window');
        assert.strictEqual(couponStatus({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }, t), 'valid');
        assert.ok(COUPON_STATUS_TEXT.not_in_window.length > 5);
        // schedule gates the pricing path itself
        assert.strictEqual(evaluateDiscounts([{ id: 'hh', type: 'global', mode: 'percent', value: 10, daysOfWeek: [0, 6], startTime: '09:00', endTime: '18:00' }], { subtotal: 500, now: t }), null, 'outside window → no discount');
        assert.strictEqual(evaluateDiscounts([{ id: 'hh', type: 'global', mode: 'percent', value: 10, daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }], { subtotal: 500, now: t }).amount, 50, 'inside window → applies');
        // manual-discount PIN ceiling
        assert.strictEqual(needsPinApproval(151, 1000, 15), true);
        assert.strictEqual(needsPinApproval(150, 1000, 15), false);
        assert.strictEqual(needsPinApproval(500, 0, 15), false);
        // degenerate inputs
        assert.strictEqual(evaluateDiscounts([], { subtotal: 500 }), null);
        assert.strictEqual(evaluateDiscounts([{ id: 'a', type: 'global', mode: 'flat', value: 50 }], { subtotal: 0 }), null);
        console.log('discount-rules OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
