// Combo pricing — single source of truth for the Admin Combos tab, QR menu,
// WhatsApp webview, and POS (6 former copies of this math).
// menu/shared/combo-math.js is a byte-identical copy: the menu hosting target
// serves only menu/, so /shared 404s there (SPA rewrite -> module graph death).

export function isComboActive(combo, now = Date.now()) {
    if (combo.disabled) return false;
    return (combo.startAt || 0) <= now && now <= (combo.endAt || 0);
}

export function comboPriceTotal(originalTotal, discountType, discountValue) {
    const v = Number(discountValue) || 0;
    if (discountType === 'percentage') {
        const pct = Math.min(Math.max(v, 0), 100);
        return Math.max(0, Math.round(originalTotal * (1 - pct / 100)));
    }
    return Math.max(0, Math.round(originalTotal - Math.max(v, 0)));
}

// Per-unit cart prices for every combo item. Integer prices can't always sum
// to the exact combo total (e.g. qty 2 at ₹50 with ₹1 off), so the last
// items absorb the rounding residual — off by at most ₹1 per item.
export function bakeComboUnitPrices(entries, discountType, discountValue) {
    // entries: [{ base, qty }] — qty >= 1
    const v = Number(discountValue) || 0;
    const original = entries.reduce((s, e) => s + e.base * e.qty, 0);
    const target = comboPriceTotal(original, discountType, v);
    let prices;
    if (discountType === 'percentage') {
        const pct = Math.min(Math.max(v, 0), 100);
        prices = entries.map(e => Math.max(0, Math.round(e.base * (1 - pct / 100))));
    } else {
        const units = entries.reduce((s, e) => s + e.qty, 0) || 1;
        const share = Math.max(v, 0) / units;
        prices = entries.map(e => Math.max(0, Math.round(e.base - share)));
    }
    let sum = prices.reduce((s, p, i) => s + p * entries[i].qty, 0);
    for (let i = prices.length - 1; i >= 0 && sum !== target; i--) {
        const step = target > sum ? 1 : -1;
        const next = Math.max(0, prices[i] + step);
        if (next === prices[i]) continue;
        sum += (next - prices[i]) * entries[i].qty;
        prices[i] = next;
    }
    return prices;
}
