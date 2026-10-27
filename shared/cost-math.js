/**
 * FoodHubbie ERP | COST MATH (pure — no imports, runnable in node or browser)
 * Rates mirror the public pricing page (website/index.html):
 *   QR Table ₹2/order · POS counter ₹1/order · WhatsApp orders ₹5/order (incl. delivery webview)
 *   Official pack: commission_1pct mode (1% of delivery-webview revenue) overrides the flat fee
 *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
 */

export const DEFAULT_RATES = { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2 };
export const PROMO_RATE = 1;
export const FREE_PROMO_TOKENS = 15;
export const COMMISSION_PCT = 0.01;
// Minimum first wallet top-up before a restaurant goes live (paid to FoodHubbie directly by UPI/bank;
// Supreme Admin records it under billing/payments).
export const MIN_TOPUP = 1000;

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
    const mode = b.mode === 'commission_1pct' ? 'commission_1pct' : 'per_order';
    const idx = computeCostIndex(orders || {}, rates, mode);
    let promoSent = 0;
    for (const c of Object.values(campaigns || {})) promoSent += _n(c && c.totalSent);
    const sum = (node) => Object.values(node || {}).reduce((a, x) => a + _n(x && x.amount), 0);
    const paid = _r2(sum(b.payments));
    const charges = _r2(sum(b.charges));
    const used = _r2(idx.total + promoSent * PROMO_RATE);
    return { paid, charges, used, balance: _r2(paid - used - charges), topUpDone: paid >= MIN_TOPUP, minTopUp: MIN_TOPUP };
}

const EXCLUDED = new Set(['Cancelled', 'Refunded']);

export function sourceOf(order) {
    if (!order) return 'other';
    if (order.source) return order.source;
    return (order.type === 'Dine-in' || order.type === 'Walk-in') ? 'POS' : 'other';
}

export function feeOf(order, rates = DEFAULT_RATES, mode = 'per_order') {
    const src = sourceOf(order);
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
    console.log('cost-math OK');
}
