/**
 * FoodHubbie ERP | LOYALTY MATH (pure — no imports, runnable in node or browser)
 * Single source of truth for loyalty earn/redeem arithmetic. Consumed by:
 *   bot/index.js        (earn on final states, dine-in settlement accrual,
 *                        clawback on cancellation, reward tender validation)
 *   menu/js/delivery.js (reward-code tender preview at checkout — via the
 *                        byte-identical menu/shared copy; menu hosting cannot
 *                        reach /shared)
 *   Admin/js/features/loyalty.js (effective-cashback display)
 *
 * Policy (research-locked, plan doc §9 — parameters are Admin-configurable
 * via loyalty/config, the formulas are not):
 *   R1  earn base = subtotal − discount ONLY (tax, service charge and the
 *       delivery fee never earn points). Orders that predate the subtotal
 *       field fall back to order.total (the pre-Phase-2 behavior).
 *   R2  redemption is a TENDER (mode of payment), never a discount — it
 *       reduces the amount payable, never the taxable value.
 *   R9  optional minimum spend AFTER redemption: tender is capped at
 *       totalDue − minSpend.
 *
 * Money units: order fields are RUPEES; tender/min-spend math is PAISE
 * (integers) so redemption never loses or invents a paisa.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * R1 earn base in rupees. Prefers subtotal − discount (new orders carry both);
 * falls back to order.total for legacy orders that never had a subtotal.
 * Never negative.
 */
export function computeEarnBase(order = {}) {
    const sub = Number(order.subtotal);
    const base = Number.isFinite(sub)
        ? sub - (Number(order.discount) || 0)
        : Number(order.total) || 0;
    return Math.max(0, round2(base));
}

/**
 * Points for an order. Two-stage floor exactly as the bot has always done:
 * floor(base paise / rate) first, then × tier multiplier, then floor again —
 * changing this order silently makes tiers more generous.
 */
export function computeEarnPoints(earnBaseRs, earnRatePaisePerPoint, multiplier = 1) {
    const rate = Number(earnRatePaisePerPoint);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    const basePoints = Math.floor((Math.max(0, Number(earnBaseRs) || 0) * 100) / rate);
    if (basePoints <= 0) return 0;
    return Math.floor(basePoints * (Number(multiplier) || 1));
}

/**
 * Highest tier whose min threshold the points have reached (thresholds are
 * inclusive — matches the bot's accrual loop). Unknown/missing tiers keep
 * the caller on bronze.
 */
export function tierForPoints(points, tiers) {
    const p = Number(points) || 0;
    let tier = 'bronze';
    for (const name of ['bronze', 'silver', 'gold']) {
        const t = tiers && tiers[name];
        if (t && p >= (Number(t.min) || 0)) tier = name;
    }
    return tier;
}

/**
 * R2/R9 tender value in PAISE for redeeming `points` against a bill.
 * tender = min(points × pointValue, totalDue − minSpendAfterRedemption),
 * floored at 0 — a bill below the minimum spend cannot be redeemed against.
 */
export function computeTenderPaise({ points, redeemValuePaisePerPoint = 100, totalDuePaise = 0, minSpendAfterRedemptionPaise = 0 } = {}) {
    const pts = Math.floor(Number(points) || 0);
    const val = Number(redeemValuePaisePerPoint);
    if (pts <= 0 || !Number.isFinite(val) || val <= 0) return 0;
    const due = Math.max(0, Math.round(Number(totalDuePaise) || 0));
    const minSpend = Math.max(0, Math.round(Number(minSpendAfterRedemptionPaise) || 0));
    const room = Math.max(0, due - minSpend);
    return Math.min(pts * Math.round(val), room);
}

/**
 * Split a bill-level discount across a settlement's orders, proportional to
 * each order's earn base, in PAISE, with largest-remainder rounding so the
 * shares sum to EXACTLY the bill discount (no paisa invented or lost).
 * Returns one paise share per base, same order. Zero bases get zero share.
 */
export function distributeBillDiscountPaise(billDiscountRs, basesRs) {
    const bases = (Array.isArray(basesRs) ? basesRs : []).map(b => Math.max(0, round2(Number(b) || 0)));
    const out = bases.map(() => 0);
    const totalPaise = Math.max(0, Math.round((Number(billDiscountRs) || 0) * 100));
    if (totalPaise <= 0 || bases.length === 0) return out;
    const basePaise = bases.map(b => Math.round(b * 100));
    const sum = basePaise.reduce((s, b) => s + b, 0);
    if (sum <= 0) return out;
    const raw = basePaise.map(b => (b * totalPaise) / sum);
    const floors = raw.map(Math.floor);
    let leftover = totalPaise - floors.reduce((s, f) => s + f, 0);
    const order = raw.map((r, i) => [r - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let k = 0; leftover > 0 && k < order.length; k++, leftover--) floors[order[k][1]]++;
    return floors;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('loyalty-math')) {
    import('node:assert/strict').then(assert => {
        // R1 earn base
        assert.strictEqual(computeEarnBase({ subtotal: 500, discount: 50, total: 525 }), 450, 'subtotal − discount, tax/fee excluded');
        assert.strictEqual(computeEarnBase({ total: 525 }), 525, 'legacy order falls back to total');
        assert.strictEqual(computeEarnBase({ subtotal: 300, discount: 400 }), 0, 'never negative');
        assert.strictEqual(computeEarnBase({}), 0);
        assert.strictEqual(computeEarnBase({ subtotal: '500.5', discount: '0.5' }), 500, 'string money coerced');
        // two-stage floor preserved (bot parity)
        assert.strictEqual(computeEarnPoints(500, 2000, 1), 25, '₹500 at ₹20/pt = 25 pts');
        assert.strictEqual(computeEarnPoints(500, 2000, 1.5), 37, 'gold: floor(25 × 1.5) = 37');
        assert.strictEqual(computeEarnPoints(10, 2000, 1), 0, 'below one point earns nothing');
        assert.strictEqual(computeEarnPoints(500, 0, 1), 0, 'bad rate earns nothing');
        // tier thresholds inclusive, ordered low→high
        const tiers = { bronze: { min: 0, multiplier: 1 }, silver: { min: 1000, multiplier: 1.25 }, gold: { min: 5000, multiplier: 1.5 } };
        assert.strictEqual(tierForPoints(0, tiers), 'bronze');
        assert.strictEqual(tierForPoints(1000, tiers), 'silver', 'min is inclusive');
        assert.strictEqual(tierForPoints(4999, tiers), 'silver');
        assert.strictEqual(tierForPoints(5000, tiers), 'gold');
        assert.strictEqual(tierForPoints(99999, undefined), 'bronze', 'missing config stays bronze');
        // R2/R9 tender
        assert.strictEqual(computeTenderPaise({ points: 50, redeemValuePaisePerPoint: 100, totalDuePaise: 50000 }), 5000, '50 pts × ₹1 = ₹50');
        assert.strictEqual(computeTenderPaise({ points: 500, redeemValuePaisePerPoint: 100, totalDuePaise: 30000 }), 30000, 'capped at amount due');
        assert.strictEqual(computeTenderPaise({ points: 500, redeemValuePaisePerPoint: 100, totalDuePaise: 30000, minSpendAfterRedemptionPaise: 10000 }), 20000, 'R9 room = due − minSpend');
        assert.strictEqual(computeTenderPaise({ points: 500, redeemValuePaisePerPoint: 100, totalDuePaise: 8000, minSpendAfterRedemptionPaise: 10000 }), 0, 'bill below min spend → no redemption');
        assert.strictEqual(computeTenderPaise({ points: 0, redeemValuePaisePerPoint: 100, totalDuePaise: 50000 }), 0);
        assert.strictEqual(computeTenderPaise({ points: 10, redeemValuePaisePerPoint: 0, totalDuePaise: 50000 }), 0);
        // bill-discount distribution: exact sum, proportional, largest-remainder
        const shares = distributeBillDiscountPaise(100, [500, 300, 200]);
        assert.strictEqual(shares.reduce((s, x) => s + x, 0), 10000, 'shares sum to the bill discount exactly');
        assert.strictEqual(shares[0], 5000, 'biggest base gets the biggest share');
        assert.deepStrictEqual(distributeBillDiscountPaise(0.3, [1, 1, 1, 1]), [8, 8, 7, 7], 'sub-paise split rounds fairly (largest remainder)');
        assert.strictEqual(distributeBillDiscountPaise(0.3, [1, 1, 1, 1]).reduce((s, x) => s + x, 0), 30, 'sub-paise shares still sum exactly');
        assert.deepStrictEqual(distributeBillDiscountPaise(100, []), []);
        assert.deepStrictEqual(distributeBillDiscountPaise(100, [0, 0]), [0, 0], 'no earn base → no share');
        assert.deepStrictEqual(distributeBillDiscountPaise(0, [500, 500]), [0, 0]);
        console.log('loyalty-math OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
