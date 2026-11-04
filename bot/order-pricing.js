/**
 * bot/order-pricing.js
 *
 * Server-side re-pricing for orders the customer's browser writes itself
 * (source 'APP' from the restaurant app, 'webview_delivery' from the WhatsApp
 * delivery page). Until now only the discount, tax and total were re-checked;
 * every unit price came from the customer's phone, so a modified client could
 * send ₹1 for a ₹299 dish and the bill would honour it.
 *
 * This module rebuilds each line from the outlet catalog:
 *   - dish found by `dishId` (new orders) or by name (older orders; QR bakes
 *     the size into the name as "Dish (Large)"),
 *   - price = selected size price + catalog add-on prices,
 *   - combo lines are checked as a group against the combo's own discount
 *     (combo-math); a group that does not add up falls back to catalog prices
 *     (the customer never pays MORE than the menu, only loses the combo saving
 *     when the claim cannot be verified),
 *   - a line that cannot be matched to the catalog keeps its claimed price and
 *     is reported so the caller can log/flag it — inventing a price would
 *     either overcharge or give food away.
 *
 * Pure: no imports, no I/O. Self-check: node bot/order-pricing.js
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function normText(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

// QR orders bake the size into the name: "Cheese Pizza (Medium)".
function splitSize(name) {
    const raw = String(name == null ? '' : name).trim();
    const m = raw.match(/^(.*\S)\s*\(([^()]{1,30})\)$/);
    if (!m) return { base: raw, size: '' };
    return { base: m[1].trim(), size: m[2].trim() };
}

function sizeEntries(dish) {
    const sizes = dish && dish.sizes;
    if (!sizes) return [];
    if (Array.isArray(sizes)) {
        return sizes
            .map(s => (s && typeof s === 'object')
                ? { label: s.label || s.name || '', price: Number(s.price) }
                : { label: String(s), price: NaN })
            .filter(s => s.label && Number.isFinite(s.price));
    }
    if (typeof sizes === 'object') {
        return Object.entries(sizes)
            .map(([label, v]) => ({ label, price: Number(v && typeof v === 'object' ? v.price : v) }))
            .filter(s => s.label && Number.isFinite(s.price));
    }
    return [];
}

// Base unit price for a dish at a given size label. Sized dishes always price
// at a real tier: a label we do not recognise falls back to the HIGHEST tier,
// so a tampered size can never buy a large at the small price.
function basePrice(dish, sizeLabel) {
    const base = Number(dish && dish.price);
    const entries = sizeEntries(dish);
    if (!entries.length) return Number.isFinite(base) ? base : null;
    const want = normText(sizeLabel);
    if (!want) return Number.isFinite(base) ? base : Math.min(...entries.map(e => e.price));
    const hit = entries.find(e => normText(e.label) === want);
    if (hit) return hit.price;
    return Math.max(...entries.map(e => e.price));
}

// Combo lines are built by the clients with the dish's declared base price
// (`dish.price`, else its first size tier) and `size: 'Regular'` — the combo
// discount is what makes the deal, not a size selection. Match that exactly so
// an honest combo is never re-priced.
function comboBase(dish) {
    const base = Number(dish && dish.price);
    if (Number.isFinite(base)) return base;
    const entries = sizeEntries(dish);
    return entries.length ? entries[0].price : null;
}

function addonsPrice(dish, addons) {
    const list = Array.isArray(addons) ? addons : [];
    if (!list.length) return 0;
    const catalog = Array.isArray(dish && dish.addons) ? dish.addons : [];
    let total = 0;
    for (const a of list) {
        const name = normText(a && typeof a === 'object' ? (a.name ?? a.label) : a);
        if (!name) continue;
        const hit = catalog.find(c => normText(c && c.name) === name);
        // Catalog price wins; a name the catalog does not know keeps the
        // claimed price (it is not money the menu can justify either way).
        const claimed = Number(a && typeof a === 'object' ? a.price : 0) || 0;
        total += hit ? Number(hit.price) || 0 : claimed;
    }
    return total;
}

function resolveDish(dishes, item) {
    if (!dishes) return null;
    const id = item && item.dishId;
    if (id && dishes[id]) return { dish: dishes[id], key: id };
    const { base, size } = splitSize(item && item.name);
    const bare = splitSize(base).base;    // "Dish (Large) (Medium)" tolerance
    const wanted = normText(bare || base);
    if (!wanted) return null;
    const byName = Object.entries(dishes).filter(([, d]) => d && normText(d.name) === wanted);
    if (!byName.length) return null;
    // Prefer the entry whose size table carries the requested label.
    if (byName.length > 1 && size) {
        const withSize = byName.find(([, d]) => sizeEntries(d).some(e => normText(e.label) === normText(size)));
        if (withSize) return { dish: withSize[1], key: withSize[0] };
    }
    return { dish: byName[0][1], key: byName[0][0] };
}

function comboPriceTotal(originalTotal, discountType, discountValue) {
    const v = Number(discountValue) || 0;
    if (discountType === 'percentage') {
        const pct = Math.min(Math.max(v, 0), 100);
        return Math.max(0, Math.round(originalTotal * (1 - pct / 100)));
    }
    return Math.max(0, Math.round(originalTotal - Math.max(v, 0)));
}

// One copy of a combo exactly as the admin defined it: the catalog-base total
// of its dishes, and the advertised price after the combo discount. The
// clients bake each copy's cart lines from this same composition, so a group
// of N copies must total N x `total`. null when the composition cannot be
// priced (deleted dish, empty combo) — the caller then charges catalog prices.
function comboOneCopy(combo, dishes) {
    const items = combo && combo.items
        ? (Array.isArray(combo.items) ? combo.items : Object.values(combo.items))
        : [];
    if (!items.length) return null;
    let base = 0, qty = 0;
    for (const it of items) {
        // The clients skip a combo dish they cannot resolve, so the target
        // price is baked from what remains — mirror that exactly.
        const dish = dishes && dishes[it && it.dishId];
        if (!dish) continue;
        const q = Math.max(1, Math.round(Number(it.qty) || 1));
        base += (comboBase(dish) ?? 0) * q;
        qty += q;
    }
    return { base, qty, total: comboPriceTotal(base, combo.discountType, combo.discountValue) };
}

/**
 * @param {object} p
 * @param {Array|object} p.items   order.items (array, or legacy map)
 * @param {object} p.dishes        outlet dishes node
 * @param {object} [p.combos]      outlet combos node
 * @param {number} [p.subtotal]    the subtotal the client claimed; when given,
 *                                 a mismatch alone counts as a correction
 * @returns {{items: Array|object, subtotal:number, changed:boolean, unmatched:string[]}}
 */
function repriceOrder({ items, dishes, combos, subtotal: claimedSubtotal }) {
    const isMap = !!items && !Array.isArray(items) && typeof items === 'object';
    const list = isMap ? Object.values(items) : (Array.isArray(items) ? items : []);
    const out = list.map(it => (it && typeof it === 'object' ? { ...it } : null));
    const unmatched = [];
    const comboLines = new Map();       // comboId -> [{ index, base, qty }]
    let changed = false;

    const qtyOf = (it) => Math.max(1, Math.round(Number(it.quantity ?? it.qty) || 1));
    // `total` is only refreshed when the line already carries one, so a legacy
    // map line ({name, price, qty}) is not reshaped into the array contract.
    const setPrice = (it, unit, qty) => {
        const unitR = round2(unit);
        const total = round2(unitR * qty);
        if (round2(Number(it.unitPrice) || 0) === unitR) {
            if (it.total != null && round2(Number(it.total) || 0) !== total) {
                it.total = total;
                changed = true;
            }
            return;
        }
        it.unitPrice = unitR;
        if (it.price != null) it.price = unitR;
        if (it.total != null) it.total = total;
        changed = true;
    };

    out.forEach((it, index) => {
        if (!it) return;
        const qty = qtyOf(it);
        const found = resolveDish(dishes, it);
        if (!found) {
            unmatched.push(String(it.name || '').trim() || `line ${index + 1}`);
            return;
        }
        const { size } = splitSize(it.name);
        const sizeLabel = it.size || size || '';
        const price = it.comboId ? comboBase(found.dish) : basePrice(found.dish, sizeLabel);
        if (price == null) { unmatched.push(String(it.name || '').trim() || `line ${index + 1}`); return; }
        const unit = round2(price + addonsPrice(found.dish, it.addons));

        if (it.comboId) {
            if (!comboLines.has(it.comboId)) comboLines.set(it.comboId, []);
            comboLines.get(it.comboId).push({ index, base: unit, qty });
            return;                     // priced after the whole group is known
        }
        setPrice(it, unit, qty);
    });

    // Combos: the advertised price is the catalog base minus the combo's own
    // discount. Verify the group total against N copies of the combo exactly as
    // the admin defined it; if it does not add up, charge catalog base (the
    // customer loses the combo saving, never pays above the menu).
    for (const [comboId, lines] of comboLines) {
        const combo = combos && combos[comboId];
        const claimedTotal = lines.reduce((s, l) => {
            const it = out[l.index];
            return s + (Number(it.unitPrice) || 0) * l.qty;
        }, 0);
        const one = combo && !combo.disabled ? comboOneCopy(combo, dishes) : null;
        const groupQty = lines.reduce((s, l) => s + l.qty, 0);
        const copies = one && one.qty ? groupQty / one.qty : 0;
        const ok = !!one && Number.isInteger(copies) && copies >= 1
            && Math.abs(round2(claimedTotal) - round2(one.total * copies)) < 0.01;
        for (const l of lines) {
            const it = out[l.index];
            const keep = Number(it.unitPrice) || 0;
            setPrice(it, ok ? keep : l.base, l.qty);
        }
    }

    const subtotal = round2(out.reduce((s, it) => s + (it ? (Number(it.unitPrice) || 0) * qtyOf(it) : 0), 0));
    // A line-by-line match does not prove the subtotal: the client can write
    // honest items and an understated subtotal, and the discount/tax math runs
    // on the subtotal. Reconcile the claim too.
    if (claimedSubtotal != null && round2(Number(claimedSubtotal) || 0) !== subtotal) changed = true;
    let result = out;
    if (isMap) {
        result = {};
        Object.keys(items).forEach((k, i) => { result[k] = out[i]; });
    }
    return { items: result, subtotal, changed, unmatched };
}

module.exports = { normText, splitSize, sizeEntries, basePrice, comboBase, addonsPrice, resolveDish, comboPriceTotal, repriceOrder };

// ── self-check ────────────────────────────────────────────────────────────
if (require.main === module) {
    const assert = require('assert/strict');
    const dishes = {
        d1: { name: 'Margherita', price: 199 },
        d2: { name: 'Farmhouse', price: 69, sizes: { Small: 69, Medium: 119, Large: 159 } },
        d3: { name: 'Garlic Bread', price: 99, addons: [{ name: 'Cheese Dip', price: 20 }, { name: 'Butter', price: 10 }] },
        d4: { name: 'Burger', price: 89 },
    };
    const combos = { c1: { discountType: 'fixed', discountValue: 40, items: [{ dishId: 'd1', qty: 1 }, { dishId: 'd4', qty: 2 }] } };
    const c2 = { discountType: 'fixed', discountValue: 20, items: [{ dishId: 'd2', qty: 1 }, { dishId: 'd4', qty: 1 }] };

    // by id, flat price
    let r = repriceOrder({ dishes, items: [{ dishId: 'd1', name: 'Margherita', unitPrice: 1, total: 2, quantity: 2 }] });
    assert.equal(r.items[0].unitPrice, 199);
    assert.equal(r.items[0].total, 398);
    assert.equal(r.subtotal, 398);
    assert.equal(r.changed, true);

    // by name, size label, size in the name (QR shape)
    r = repriceOrder({ dishes, items: [{ name: 'Farmhouse', size: 'Large', unitPrice: 69, quantity: 1 }] });
    assert.equal(r.items[0].unitPrice, 159);
    r = repriceOrder({ dishes, items: [{ name: 'Farmhouse (Medium)', price: 69, qty: 1 }] });
    assert.equal(r.items[0].unitPrice, 119);

    // unknown size on a sized dish -> highest tier (never the small price)
    r = repriceOrder({ dishes, items: [{ dishId: 'd2', name: 'Farmhouse', size: 'Bogus', unitPrice: 1, quantity: 1 }] });
    assert.equal(r.items[0].unitPrice, 159);

    // addons: catalog price wins, unknown add-on keeps the claimed price
    r = repriceOrder({ dishes, items: [{ dishId: 'd3', name: 'Garlic Bread', unitPrice: 1, quantity: 1, addons: [{ name: 'Cheese Dip', price: 0 }, { name: 'Butter', price: 10 }] }] });
    assert.equal(r.items[0].unitPrice, 129);

    // honest order is untouched
    r = repriceOrder({ dishes, items: [{ dishId: 'd1', name: 'Margherita', unitPrice: 199, total: 199, quantity: 1 }] });
    assert.equal(r.changed, false);

    // ... but an understated subtotal alone is still a correction
    r = repriceOrder({ dishes, subtotal: 1, items: [{ dishId: 'd1', name: 'Margherita', unitPrice: 199, total: 199, quantity: 1 }] });
    assert.equal(r.changed, true);
    assert.equal(r.subtotal, 199);

    // combo: the advertised price is base minus the combo discount, verified per group
    r = repriceOrder({ dishes, combos, items: [
        { dishId: 'd1', name: 'Margherita', unitPrice: 159, quantity: 1, comboId: 'c1' },
        { dishId: 'd4', name: 'Burger', unitPrice: 89, quantity: 2, comboId: 'c1' },
    ] });
    assert.equal(r.changed, false, '199 + 2x89 = 377; -40 = 337 matches the claimed group total');
    assert.equal(r.subtotal, 337);

    r = repriceOrder({ dishes, combos, items: [
        { dishId: 'd1', name: 'Margherita', unitPrice: 199, quantity: 1, comboId: 'c1' },
        { dishId: 'd4', name: 'Burger', unitPrice: 89, quantity: 2, comboId: 'c1' },
    ] });
    assert.equal(r.subtotal, 377, 'a group that skips the combo price is charged the catalog base');

    r = repriceOrder({ dishes, combos, items: [
        { dishId: 'd1', name: 'Margherita', unitPrice: 1, quantity: 1, comboId: 'c1' },
        { dishId: 'd4', name: 'Burger', unitPrice: 1, quantity: 2, comboId: 'c1' },
    ] });
    assert.equal(r.changed, true);
    assert.equal(r.items[0].unitPrice, 199);
    assert.equal(r.items[1].unitPrice, 89);

    // a combo the admin disabled cannot be claimed
    r = repriceOrder({ dishes, combos: { c1: { ...combos.c1, disabled: true } }, items: [
        { dishId: 'd1', name: 'Margherita', unitPrice: 159, quantity: 1, comboId: 'c1' },
        { dishId: 'd4', name: 'Burger', unitPrice: 89, quantity: 2, comboId: 'c1' },
    ] });
    assert.equal(r.subtotal, 377);

    // realistic combo: a sized dish written with size 'Regular' must price at
    // its declared base (what the menu charges), never the Large tier
    r = repriceOrder({ dishes, combos: { c2 }, items: [
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 59, total: 59, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 79, total: 79, quantity: 1, comboId: 'c2' },
    ] });
    assert.equal(r.changed, false, '69 + 89 = 158, -20 = 138 = 59 + 79');
    assert.equal(r.subtotal, 138);
    r = repriceOrder({ dishes, combos: { c2 }, items: [
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 1, total: 1, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 1, total: 1, quantity: 1, comboId: 'c2' },
    ] });
    assert.equal(r.subtotal, 158, 'a tampered combo falls back to the menu price');

    // the same combo added twice (two line sets, one comboId) is two copies
    r = repriceOrder({ dishes, combos: { c2 }, items: [
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 59, total: 59, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 79, total: 79, quantity: 1, comboId: 'c2' },
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 59, total: 59, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 79, total: 79, quantity: 1, comboId: 'c2' },
    ] });
    assert.equal(r.changed, false, 'two copies = 2 x 138');
    assert.equal(r.subtotal, 276);
    r = repriceOrder({ dishes, combos: { c2 }, items: [
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 59, total: 59, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 79, total: 79, quantity: 1, comboId: 'c2' },
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 0, total: 0, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 0, total: 0, quantity: 1, comboId: 'c2' },
    ] });
    assert.equal(r.subtotal, 316, 'four combo lines claimed as one combo are charged catalog');

    // a line that is not part of the combo but carries its id breaks the count
    r = repriceOrder({ dishes, combos: { c2 }, items: [
        { dishId: 'd2', name: 'Farmhouse', size: 'Regular', unitPrice: 59, total: 59, quantity: 1, comboId: 'c2' },
        { dishId: 'd4', name: 'Burger', size: 'Regular', unitPrice: 79, total: 79, quantity: 1, comboId: 'c2' },
        { dishId: 'd1', name: 'Margherita', unitPrice: 159, total: 159, quantity: 1, comboId: 'c2' },
    ] });
    assert.equal(r.subtotal, 357, '3 lines cannot be N whole copies of a 2-item combo');

    // unresolvable line keeps the claim and is reported
    r = repriceOrder({ dishes, items: [{ name: 'Ghost Dish', unitPrice: 5, quantity: 1 }] });
    assert.deepEqual(r.unmatched, ['Ghost Dish']);
    assert.equal(r.items[0].unitPrice, 5);

    // legacy map shape round-trips
    r = repriceOrder({ dishes, items: { item_0: { name: 'Margherita', price: 1, qty: 2 } } });
    assert.equal(r.items.item_0.unitPrice, 199);
    assert.equal(r.subtotal, 398);

    console.log('order-pricing OK');
}
