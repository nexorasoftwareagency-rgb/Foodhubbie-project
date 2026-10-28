/**
 * FoodHubbie ERP | COST MATH (pure — no imports, runnable in node or browser)
 * Rates mirror the public pricing page (website/index.html):
 *   QR Table ₹2/order · POS counter ₹1/order · WhatsApp orders ₹5/order (incl. delivery webview)
 *   Official pack: commission_1pct mode (1% of delivery-webview revenue) overrides the flat fee
 *   Percentage package: 'percentage' mode = 1% of order value on every source, 2% on WhatsApp-based ordering
 *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
 */

export const DEFAULT_RATES = { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2 };
export const PROMO_RATE = 1;
export const FREE_PROMO_TOKENS = 15;
export const COMMISSION_PCT = 0.01;
// Minimum first wallet top-up before a restaurant goes live (paid to FoodHubbie directly by UPI/bank;
// Supreme Admin records it under billing/payments).
export const MIN_TOPUP = 1000;
// Low-balance warning: balance at or below this share of everything topped up so far.
export const LOW_BALANCE_RATIO = 0.25;

// Billing modes (outlet billing.mode): 'per_order' flat rates (default), 'commission_1pct' (legacy: 1% on
// WhatsApp delivery only) and 'percentage' (percentage package: share of order value on every order).
export const PERCENT_RATES = { default: 0.01, webview_delivery: 0.02, WA: 0.02 }; // 1% everything, 2% WhatsApp-based ordering
export function normalizeMode(mode) {
    return mode === 'percentage' ? 'percentage' : mode === 'commission_1pct' ? 'commission_1pct' : 'per_order';
}
export const percentOf = (src) => PERCENT_RATES[src] ?? PERCENT_RATES.default;
/** Human label for a source's rate under a mode, e.g. "2% of order" or "\u20B92/order". */
export function rateLabel(src, mode, rates = DEFAULT_RATES) {
    const m = normalizeMode(mode);
    if (m === 'percentage') return `${Math.round(percentOf(src) * 1000) / 10}% of order`;
    if (m === 'commission_1pct' && src === 'webview_delivery') return '1% of order';
    return `\u20B9${rates[src] ?? rates.other ?? 0}/order`;
}

const _n = (x) => Number(x) || 0;
const _r2 = (x) => Math.round(x * 100) / 100;

/**
 * Prepaid wallet view of the existing billing ledger.
 * balance = paid - (order fees + promo sends + manual charges). Same numbers as Supreme's "due", sign flipped.
 * `billing` = outlet.billing node, `orders` = all outlet orders, `campaigns` = bot.promotions.campaigns.
 */
export function computeWallet({ billing, orders, campaigns } = {}) {
    const b = billing || {};
    const rates = { ...DEFAULT_RATES, ...(b.rates || {}) };
    const mode = normalizeMode(b.mode);
    const idx = computeCostIndex(orders || {}, rates, mode);
    let promoSent = 0;
    for (const c of Object.values(campaigns || {})) promoSent += _n(c && c.totalSent);
    const sum = (node) => Object.values(node || {}).reduce((a, x) => a + _n(x && x.amount), 0);
    const paid = _r2(sum(b.payments));
    const charges = _r2(sum(b.charges));
    const used = _r2(idx.total + promoSent * PROMO_RATE);
    return { paid, charges, used, balance: _r2(paid - used - charges), topUpDone: paid >= MIN_TOPUP, minTopUp: MIN_TOPUP, level: walletLevel({ paid, used, charges }) };
}

/** 'none' (never topped up) | 'ok' | 'low' (balance <= 25% of total topped up) | 'empty' (balance <= 0). */
export function walletLevel({ paid = 0, used = 0, charges = 0 } = {}) {
    const p = _n(paid);
    if (p <= 0) return 'none';
    const bal = p - _n(used) - _n(charges);
    if (bal <= 0) return 'empty';
    return bal <= p * LOW_BALANCE_RATIO ? 'low' : 'ok';
}

const EXCLUDED = new Set(['Cancelled', 'Refunded']);

export function sourceOf(order) {
    if (!order) return 'other';
    if (order.source) return order.source;
    return (order.type === 'Dine-in' || order.type === 'Walk-in') ? 'POS' : 'other';
}

export function feeOf(order, rates = DEFAULT_RATES, mode = 'per_order') {
    const src = sourceOf(order);
    if (mode === 'percentage') {
        return Math.round((Number(order.total) || 0) * percentOf(src) * 100) / 100;
    }
    if (mode === 'commission_1pct' && src === 'webview_delivery') {
        return Math.round((Number(order.total) || 0) * COMMISSION_PCT * 100) / 100;
    }
    return rates[src] ?? rates.other ?? 0;
}

export function computeCostIndex(orders, rates = DEFAULT_RATES, mode = 'per_order') {
    const bySource = {};
    let total = 0, count = 0;
    for (const o of Object.values(orders || {})) {
        if (!o || EXCLUDED.has(o.status)) continue;
        const src = sourceOf(o);
        const fee = feeOf(o, rates, mode);
        const b = bySource[src] || (bySource[src] = { orders: 0, cost: 0 });
        b.orders += 1; b.cost += fee;
        total += fee; count += 1;
    }
    return { total: Math.round(total * 100) / 100, count, bySource };
}

// check: node shared/cost-math.js
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('cost-math')) {
    const { default: assert } = await import('node:assert');
    const o = (total, source, status) => ({ total, source, status: status || 'Delivered' });
    const r = computeCostIndex({ a: o(100, 'QR'), b: o(100, 'POS'), c: o(100, 'webview_delivery'), d: o(100, 'QR', 'Cancelled') });
    assert.equal(r.count, 3, 'cancelled excluded');
    assert.equal(r.total, 8, 'QR2 + POS1 + webview5');
    assert.equal(r.bySource.QR.orders, 1);
    const p = computeCostIndex({ a: o(500, 'webview_delivery') }, DEFAULT_RATES, 'commission_1pct');
    assert.equal(p.total, 5, '1% of 500');
    const legacy = computeCostIndex({ a: { total: 100, type: 'Dine-in', status: 'Delivered' } });
    assert.equal(legacy.total, 1, 'untagged dine-in → POS rate');
    assert.equal(PROMO_RATE, 1, 'promo ₹1/token');
    assert.equal(DEFAULT_RATES.WA, 5, 'WhatsApp order ₹5');
    const w = computeWallet({
        billing: { payments: { a: { amount: 1000 }, b: { amount: 500 } }, charges: { c: { amount: 200 } } },
        orders: { a: o(100, 'QR'), b: o(100, 'POS'), c: o(100, 'QR', 'Cancelled') },
        campaigns: { x: { totalSent: 10 } },
    });
    assert.equal(w.paid, 1500); assert.equal(w.used, 13, 'QR2 + POS1 + 10 promo'); assert.equal(w.charges, 200);
    assert.equal(w.balance, 1287, 'paid - used - charges'); assert.equal(w.topUpDone, true);
    assert.equal(computeWallet({ billing: { payments: { a: { amount: 999 } } } }).topUpDone, false, 'below minimum');
    assert.equal(computeWallet({}).balance, 0, 'empty is zero');
    // percentage package: 1% QR/POS/other, 2% WhatsApp (webview + WA); cancelled still excluded
    const pk = computeCostIndex({ a: o(1000, 'QR'), b: o(500, 'POS'), c: o(1000, 'webview_delivery'), d: o(200, 'WA'), e: o(100, 'other'), f: o(9999, 'QR', 'Cancelled') }, DEFAULT_RATES, 'percentage');
    assert.equal(pk.total, 10 + 5 + 20 + 4 + 1, '1% QR/POS/other + 2% WhatsApp');
    assert.equal(feeOf({ total: 333.33, source: 'QR' }, DEFAULT_RATES, 'percentage'), 3.33, 'rounded to paise');
    assert.equal(normalizeMode('percentage'), 'percentage'); assert.equal(normalizeMode('junk'), 'per_order'); assert.equal(normalizeMode('commission_1pct'), 'commission_1pct');
    assert.equal(rateLabel('webview_delivery', 'percentage'), '2% of order'); assert.equal(rateLabel('QR', 'percentage'), '1% of order'); assert.equal(rateLabel('QR', 'per_order'), '\u20B92/order');
    const wp = computeWallet({ billing: { mode: 'percentage', payments: { a: { amount: 1000 } } }, orders: { a: o(1000, 'webview_delivery') } });
    assert.equal(wp.used, 20, 'wallet uses the percentage package');
    // low balance: <= 25% of everything topped up
    assert.equal(walletLevel({ paid: 0 }), 'none'); assert.equal(walletLevel({ paid: 1000, used: 500 }), 'ok');
    assert.equal(walletLevel({ paid: 1000, used: 750 }), 'low', 'exactly 25% left'); assert.equal(walletLevel({ paid: 1000, used: 749 }), 'ok');
    assert.equal(walletLevel({ paid: 1000, used: 900, charges: 100 }), 'empty'); assert.equal(walletLevel({ paid: 1000, used: 1200 }), 'empty');
    console.log('cost-math OK');
}
