/**
 * FoodHubbie ERP | COST MATH (pure — no imports, runnable in node or browser)
 * Rates mirror the public pricing page (website/index.html):
 *   QR Table ₹2/order · POS counter ₹1/order · WhatsApp Baileys ₹3/order · Official ₹5/order
 *   commission_1pct mode = the 1% option on total revenue (WhatsApp Official pack only)
 *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
 */

export const DEFAULT_RATES = { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2 };
export const PROMO_RATE = 1;
export const FREE_PROMO_TOKENS = 15;
export const COMMISSION_PCT = 0.01;

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
    assert.equal(r.total, 6, 'QR2 + POS1 + webview3');
    assert.equal(r.bySource.QR.orders, 1);
    const p = computeCostIndex({ a: o(500, 'webview_delivery') }, DEFAULT_RATES, 'commission_1pct');
    assert.equal(p.total, 5, '1% of 500');
    const legacy = computeCostIndex({ a: { total: 100, type: 'Dine-in', status: 'Delivered' } });
    assert.equal(legacy.total, 1, 'untagged dine-in → POS rate');
    assert.equal(PROMO_RATE, 1, 'promo ₹1/token');
    console.log('cost-math OK');
}
