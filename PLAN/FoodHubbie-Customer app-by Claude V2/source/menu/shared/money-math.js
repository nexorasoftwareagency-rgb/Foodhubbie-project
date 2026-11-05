/**
 * FoodHubbie ERP | MONEY MATH (pure — no imports, runnable in node or browser)
 * Single source of truth for order totals: discount → taxable value → tax →
 * service charge → delivery fee → total. Consumed by:
 *   menu/js/order.js + menu/js/delivery-order.js + menu/js/ui.js
 *                 (customer checkout + live cart display — via the
 *                 byte-identical menu/shared copy; menu hosting cannot
 *                 reach /shared)
 *   Admin/js/features/pos.js                (walk-in POS display + placement)
 *   bot/index.js                            (server-side re-verification of
 *                                            client-placed QR/web orders)
 *
 * Model (owner-locked 2026-10-26):
 *   - Discounts come off the food subtotal FIRST; GST is charged on the net
 *     taxable value — trade discounts recorded on the invoice are excluded
 *     from the taxable value (CGST Sec 15(3)(a)).
 *   - Multiple tax rates (CGST + SGST) each apply to the SAME taxable value;
 *     each line is rounded to 2dp, the tax total is their rounded sum.
 *   - Service charge applies to the FULL subtotal (pre-discount), only when
 *     enabled — dine-in only, never on delivery (owner decision).
 *   - Delivery fee sits OUTSIDE the taxable value: added after tax, never taxed.
 *   - Total floors at 0.
 *
 * Extracted from five drifting hand-rolled copies (menu order.js, menu
 * delivery-order.js, menu ui.js updateCartTotals, Admin pos.js ×2). Clean-room
 * implementation of Foodhubbie's own production math. menu/shared/money-math.js
 * must stay byte-identical to this file (tools/check-shared-twins.cjs guards it).
 */

// EPSILON-guarded half-up rounding (same convention as discount-rules.js).
// Legacy copies without the guard floor exact .005 boundaries by one paisa
// (2.675 → 2.67); the guarded form rounds them half-up (2.675 → 2.68).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Compute the full totals for one order.
 *
 * @param {Object} opts
 * @param {number} opts.subtotal - Food subtotal in ₹ (cart lines only)
 * @param {number} [opts.discount] - Verified discount amount in ₹ (clamped to [0, subtotal])
 * @param {Array}  [opts.taxRates] - [{name, rate}] — rate in percent
 * @param {boolean} [opts.serviceChargeEnabled] - SC applies (dine-in only)
 * @param {number} [opts.serviceChargeRate] - SC percent (of FULL subtotal)
 * @param {number} [opts.deliveryFee] - Delivery fee in ₹ (outside taxable value)
 * @returns {{subtotal, discount, taxable, taxItems, tax, serviceCharge, deliveryFee, total}}
 */
export function computeOrderTotals({ subtotal, discount = 0, taxRates = [], serviceChargeEnabled = false, serviceChargeRate = 0, deliveryFee = 0 } = {}) {
    // Trust-boundary coercion: settings and client payloads may carry strings,
    // nulls or undefined — money math must never produce NaN.
    const sub = Math.max(0, round2(Number(subtotal) || 0));
    const disc = Math.min(Math.max(round2(Number(discount) || 0), 0), sub);
    const taxable = round2(sub - disc);
    const rates = Array.isArray(taxRates) ? taxRates : [];
    const taxItems = rates.map(r => ({
        name: r && r.name,
        rate: r && r.rate,
        amount: round2(taxable * ((Number(r && r.rate) || 0) / 100)),
    }));
    const tax = recomputeTaxOnTaxable(taxable, taxItems) ?? 0;
    const serviceCharge = serviceChargeEnabled ? round2(sub * ((Number(serviceChargeRate) || 0) / 100)) : 0;
    const fee = round2(Number(deliveryFee) || 0);
    const total = Math.max(0, round2(taxable + tax + serviceCharge + fee));
    return { subtotal: sub, discount: disc, taxable, taxItems, tax, serviceCharge, deliveryFee: fee, total };
}

/**
 * Recompute tax for an ALREADY-PLACED order from its own stored taxItems
 * rates, on a (possibly corrected) taxable value. Used by the bot's
 * server-side re-verification: the client-claimed `tax` must never be
 * trusted once the discount has been corrected — the taxable value changed.
 * Rounds exactly like computeOrderTotals (per-line, then the sum) so the
 * re-verify never "corrects" an honest order by a rounding paisa.
 * Returns null when the order carries no usable taxItems (legacy orders) —
 * the caller falls back to its legacy formula.
 */
export function recomputeTaxOnTaxable(taxable, taxItems) {
    const items = Array.isArray(taxItems) ? taxItems : [];
    if (items.length === 0) return null;
    const base = round2(taxable);
    return round2(items.reduce((s, it) => s + round2(base * ((Number(it && it.rate) || 0) / 100)), 0));
}

// check: node shared/money-math.js
// (dynamic import + .then, NOT top-level await — top-level await would make
// this module un-require()-able and bot/index.js requires it.)
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('money-math')) {
    import('node:assert').then(({ default: assert }) => {
        // round2: FP dust + decimal half-up convention
        assert.strictEqual(round2(10.1 + 0.2), 10.3, 'float dust cleaned');
        assert.strictEqual(round2(2.675), 2.68, 'half-up wins over float floor');
        assert.strictEqual(round2(1.005), 1.01);
        assert.strictEqual(round2('12.34'), 12.34, 'string coerced');
        // dine-in happy path: GST split rates on net taxable, SC on FULL subtotal
        const t = computeOrderTotals({
            subtotal: 500, discount: 50,
            taxRates: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
            serviceChargeEnabled: true, serviceChargeRate: 5,
        });
        assert.strictEqual(t.taxable, 450);
        assert.deepStrictEqual(t.taxItems, [
            { name: 'CGST', rate: 2.5, amount: 11.25 },
            { name: 'SGST', rate: 2.5, amount: 11.25 },
        ]);
        assert.strictEqual(t.tax, 22.5);
        assert.strictEqual(t.serviceCharge, 25, 'SC on full subtotal, not taxable');
        assert.strictEqual(t.total, 497.5);
        // discount clamped to subtotal; SC still applies (full-subtotal policy)
        const wiped = computeOrderTotals({ subtotal: 500, discount: 600, taxRates: [{ name: 'GST', rate: 5 }], serviceChargeEnabled: true, serviceChargeRate: 5 });
        assert.strictEqual(wiped.discount, 500);
        assert.strictEqual(wiped.taxable, 0);
        assert.strictEqual(wiped.tax, 0);
        assert.strictEqual(wiped.serviceCharge, 25);
        assert.strictEqual(wiped.total, 25);
        // delivery model: tax on net taxable, fee outside it, SC never (owner decision)
        const d = computeOrderTotals({ subtotal: 300, discount: 30, taxRates: [{ name: 'GST', rate: 5 }], serviceChargeEnabled: false, serviceChargeRate: 5, deliveryFee: 40 });
        assert.strictEqual(d.taxable, 270);
        assert.strictEqual(d.tax, 13.5);
        assert.strictEqual(d.serviceCharge, 0, 'SC disabled for delivery even when a rate is passed');
        assert.strictEqual(d.total, 323.5);
        const d2 = computeOrderTotals({ subtotal: 300, discount: 30, taxRates: [{ name: 'GST', rate: 5 }], deliveryFee: 100 });
        assert.strictEqual(d2.tax, 13.5, 'bigger fee never changes tax');
        assert.strictEqual(d2.total, 383.5);
        // degenerate + hostile inputs
        assert.deepStrictEqual(computeOrderTotals({}), { subtotal: 0, discount: 0, taxable: 0, taxItems: [], tax: 0, serviceCharge: 0, deliveryFee: 0, total: 0 });
        assert.strictEqual(computeOrderTotals({ subtotal: -100, discount: -50 }).total, 0, 'negatives clamped');
        assert.strictEqual(computeOrderTotals({ subtotal: '500', discount: '50', taxRates: [{ name: 'GST', rate: 5 }] }).total, 472.5, 'string money coerced');
        // recompute: verify-path parity with placement math
        assert.strictEqual(recomputeTaxOnTaxable(450, [{ rate: 2.5 }, { rate: 2.5 }]), 22.5);
        assert.strictEqual(recomputeTaxOnTaxable(450, []), null, 'legacy orders fall back');
        assert.strictEqual(recomputeTaxOnTaxable(450, [{ rate: 0 }]), 0);
        assert.strictEqual(recomputeTaxOnTaxable(t.taxable, [{ rate: 2.5 }, { rate: 2.5 }]), t.tax, 'verify == placement');
        console.log('money-math OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
