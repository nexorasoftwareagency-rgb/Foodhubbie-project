/**
 * FoodHubbie ERP | COST MATH (pure — no imports, runnable in node or browser)
 *
 * PRICING (decided 2026-11-01 — percentage of order value, no flat per-order fees):
 *   "Foodhubbie-App Orders"  3%  — delivery app orders + every status notification sent on the app
 *   WhatsApp bot ordering   3%
 *   POS counter + QR menu   1%
 *   Unclassified / legacy   3%  (`other`, and any unknown source string)
 *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
 *
 * Legacy modes stay readable for old rows: 'per_order' (flat ₹ rates) and
 * 'commission_1pct' (1% on delivery-webview only). New/migrated outlets use 'percentage'.
 */

export const DEFAULT_RATES = { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2 }; // legacy 'per_order' mode only
export const PROMO_RATE = 1;
export const FREE_PROMO_TOKENS = 15;
export const COMMISSION_PCT = 0.01;
// Minimum first wallet top-up before a restaurant goes live (paid to FoodHubbie directly by UPI/bank;
// Supreme Admin records it under billing/payments).
export const MIN_TOPUP = 1000; // first-time wallet top-up without WhatsApp
export const MIN_TOPUP_WITH_WA = 1500; // with WhatsApp bot
export const MIN_BALANCE = 250; // maintain always
// Low-balance warning: balance at or below this share of everything topped up so far.
export const LOW_BALANCE_RATIO = 0.25;

// Billing modes (outlet billing.mode): 'percentage' (default — share of order value per channel),
// 'per_order' (legacy flat ₹ rates) and 'commission_1pct' (legacy: 1% on WhatsApp delivery only).
export const PERCENT_RATES = { QR: 0.01, POS: 0.01, webview_delivery: 0.03, WA: 0.03, other: 0.03, default: 0.03 };
export const APP_PLAN_NAME = 'Foodhubbie-App Orders';
// Meta-cost planning slots (S2 / S1 track — not a billing behavior).
// Meta charges per Message (utility / marketing / auth / service) and has a
// 1,000 / month / phone-number free tier for service messages (reset monthly,
// does not roll over; per WABA — NOT per business). Per BILLING-MODEL.md Â§4.
// These fields are placeholders for the cost-ledger to track — they do NOT
// change restaurant-facing pricing (percentage plan stays). See docs/BILLING-MODEL.md.
export const META_COST_PLANNING = { tierCandidate: 'TechProvider', serviceFreeTierPerMonth: 1000, serviceFreeResetsMonthly: true, metaCurrency: 'INR' };
export function normalizeMode(mode) {
    if (mode === 'per_order' || mode === 'commission_1pct') return mode;
    return 'percentage';
}
export const percentOf = (src) => PERCENT_RATES[src] ?? PERCENT_RATES.default;
/** Human label for a source's rate under a mode, e.g. "3% of order" or "\u20B92/order". */
export function rateLabel(src, mode, rates = DEFAULT_RATES) {
    const m = normalizeMode(mode);
    if (m === 'percentage') return `${Math.round(percentOf(src) * 1000) / 10}% of order`;
    if (m === 'commission_1pct' && src === 'webview_delivery') return '1% of order';
    return `\u20B9${rates[src] ?? rates.other ?? 0}/order`;
}

const _n = (x) => Number(x) || 0;

/**
 * D4 wallet gate (agreed behaviour 2026-11-01): with `enforce == true`,
 *   - bot stops when balance <= max(10% of topped-up, FLAT bot threshold) → 'low'
 *   - QR/menu ordering stops when balance <= 0 → 'closed'
 *   - POS is NEVER gated (counter staff settle in person)
 * Demo tenant is hard-skipped upstream (consumer-side), not here.
 */
export const WALLET_FLAT_THRESHOLD = 100;
export function walletGate(w = {}) {
    const b = _r2(_n(w.balance));
    if (b <= 0) return 'closed';
    const topped = _n(w.paid);
    const botThresh = Math.max(topped * 0.1, WALLET_FLAT_THRESHOLD);
    if (b <= botThresh) return 'low';
    return 'ok';
}
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

// Live orders carry both 'WA' and 'wa' (2 lowercase ones exist on roshani-pizza); an exact-case
// lookup would silently bill those at the default rate. Canonicalise once, here. Unknown source
// strings fall into the 3% `other` bucket rather than escaping the rate table.
const SOURCE_ALIASES = {
    qr: 'QR', pos: 'POS', wa: 'WA', whatsapp: 'WA',
    webview_delivery: 'webview_delivery', 'webview-delivery': 'webview_delivery', app: 'webview_delivery',
    other: 'other',
};

export function sourceOf(order) {
    if (!order) return 'other';
    if (order.source) return SOURCE_ALIASES[String(order.source).trim().toLowerCase()] || 'other';
    return (order.type === 'Dine-in' || order.type === 'Walk-in') ? 'POS' : 'other';
}

export function feeOf(order, rates = DEFAULT_RATES, mode = 'percentage') {
    const src = sourceOf(order);
    if (mode === 'percentage') {
        return Math.round((Number(order.total) || 0) * percentOf(src) * 100) / 100;
    }
    if (mode === 'commission_1pct' && src === 'webview_delivery') {
        return Math.round((Number(order.total) || 0) * COMMISSION_PCT * 100) / 100;
    }
    return rates[src] ?? rates.other ?? 0;
}

export function computeCostIndex(orders, rates = DEFAULT_RATES, mode = 'percentage') {
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

    // --- current pricing (percentage is the default mode) ---
    assert.equal(percentOf('webview_delivery'), 0.03, 'Foodhubbie-App Orders 3%');
    assert.equal(percentOf('WA'), 0.03, 'WhatsApp bot ordering 3%');
    assert.equal(percentOf('QR'), 0.01, 'QR menu 1%');
    assert.equal(percentOf('POS'), 0.01, 'POS counter 1%');
    assert.equal(percentOf('other'), 0.03, 'unclassified 3%');
    assert.equal(percentOf('nonsense'), 0.03, 'unknown source never escapes the rate table');
    assert.equal(APP_PLAN_NAME, 'Foodhubbie-App Orders');
    const pk = computeCostIndex({ a: o(1000, 'QR'), b: o(500, 'POS'), c: o(1000, 'webview_delivery'), d: o(200, 'WA'), e: o(100, 'other'), f: o(9999, 'QR', 'Cancelled'), g: o(9999, 'QR', 'Refunded') });
    assert.equal(pk.count, 5, 'cancelled + refunded excluded');
    assert.equal(pk.total, 10 + 5 + 30 + 6 + 3, '1% QR/POS + 3% app/WhatsApp/other');
    assert.equal(pk.bySource.webview_delivery.cost, 30, 'app order ₹1000 → ₹30');
    assert.equal(feeOf({ total: 333.33, source: 'QR' }), 3.33, 'rounded to paise');
    assert.equal(sourceOf({ source: 'wa' }), 'WA', 'lowercase wa canonicalised (2 live orders)');
    assert.equal(sourceOf({ source: 'WEBVIEW_DELIVERY' }), 'webview_delivery', 'case-insensitive source');
    assert.equal(sourceOf({ type: 'Dine-in' }), 'POS', 'untagged dine-in → POS');
    assert.equal(computeCostIndex({ a: { total: 100, type: 'Dine-in' } }).total, 1, 'untagged dine-in → 1%');
    assert.equal(normalizeMode(undefined), 'percentage', 'percentage is the default mode');
    assert.equal(normalizeMode('junk'), 'percentage');
    assert.equal(normalizeMode('per_order'), 'per_order', 'legacy mode still selectable');
    assert.equal(normalizeMode('commission_1pct'), 'commission_1pct');
    assert.equal(rateLabel('webview_delivery'), '3% of order');
    assert.equal(rateLabel('QR'), '1% of order');
    assert.equal(PROMO_RATE, 1, 'promo ₹1/token');

    // --- legacy modes stay readable for old rows ---
    const flat = computeCostIndex({ a: o(100, 'QR'), b: o(100, 'POS'), c: o(100, 'webview_delivery'), d: o(100, 'QR', 'Cancelled') }, DEFAULT_RATES, 'per_order');
    assert.equal(flat.count, 3, 'cancelled excluded');
    assert.equal(flat.total, 8, 'legacy QR2 + POS1 + webview5');
    assert.equal(flat.bySource.QR.orders, 1);
    assert.equal(rateLabel('QR', 'per_order'), '\u20B92/order');
    const p = computeCostIndex({ a: o(500, 'webview_delivery') }, DEFAULT_RATES, 'commission_1pct');
    assert.equal(p.total, 5, 'legacy 1% of 500');

    // --- wallet ---
    const w = computeWallet({
        billing: { mode: 'per_order', payments: { a: { amount: 1000 }, b: { amount: 500 } }, charges: { c: { amount: 200 } } },
        orders: { a: o(100, 'QR'), b: o(100, 'POS'), c: o(100, 'QR', 'Cancelled') },
        campaigns: { x: { totalSent: 10 } },
    });
    assert.equal(w.paid, 1500); assert.equal(w.used, 13, 'legacy QR2 + POS1 + 10 promo'); assert.equal(w.charges, 200);
    assert.equal(w.balance, 1287, 'paid - used - charges'); assert.equal(w.topUpDone, true);
    assert.equal(computeWallet({ billing: { payments: { a: { amount: 999 } } } }).topUpDone, false, 'below minimum');
    assert.equal(computeWallet({}).balance, 0, 'empty is zero');
    const wp = computeWallet({ billing: { payments: { a: { amount: 1000 } } }, orders: { a: o(1000, 'webview_delivery') } });
    assert.equal(wp.used, 30, 'wallet defaults to the 3% app-orders rate');
    // low balance: <= 25% of everything topped up
    assert.equal(walletLevel({ paid: 0 }), 'none'); assert.equal(walletLevel({ paid: 1000, used: 500 }), 'ok');
    assert.equal(walletLevel({ paid: 1000, used: 750 }), 'low', 'exactly 25% left'); assert.equal(walletLevel({ paid: 1000, used: 749 }), 'ok');
    assert.equal(walletLevel({ paid: 1000, used: 900, charges: 100 }), 'empty'); assert.equal(walletLevel({ paid: 1000, used: 1200 }), 'empty');
    // --- D4 wallet gate ---
    assert.equal(walletGate({ balance: 0 }), 'closed', 'balance 0 closes QR');
    assert.equal(walletGate({ balance: -5 }), 'closed', 'negative closes QR');
    assert.equal(walletGate({ paid: 1000, balance: 100 }), 'low', 'bot stops at max(10% topped-up, 100) — exactly flat');
    assert.equal(walletGate({ paid: 1000, balance: 101 }), 'ok', 'just above threshold OK');
    assert.equal(walletGate({ paid: 1500, balance: 149 }), 'low', 'below 10% of topped-up (150) → low');
    assert.equal(walletGate({ paid: 200, balance: 20 }), 'low', '10% of small top-up yields the flat ₹100 floor');
    assert.equal(walletGate({ paid: 200, balance: 100 }), 'low', 'at exactly the flat ₹100 → low');
    console.log('cost-math OK');
}
