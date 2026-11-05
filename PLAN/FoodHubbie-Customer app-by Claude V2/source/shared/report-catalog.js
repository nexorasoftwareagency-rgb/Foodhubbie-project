/**
 * FoodHubbie ERP | REPORT CATALOG + AGGREGATIONS (pure — no imports, runnable in node or browser)
 * Single source of truth for the Admin report runner (Phase 4, OrderRestro port §5):
 * the UI renders the catalog (never hardcodes report names) and every report is
 * one pure aggregation over plain data the caller fetched from RTDB.
 *
 * Shape (OrderRestro spec): runReport(key, data) → { columns[], rows[][], colTypes[] }
 *   - columns: header labels
 *   - rows:    array of arrays (raw values — money as NUMBERS, formatted by the
 *              renderer/exporter, never pre-formatted strings)
 *   - colTypes: per-column 'text' | 'num' | 'money' (alignment + Phase 5 export styling)
 *
 * Conventions (match the existing analytics KPIs — analytics-mobile.js):
 *   - Revenue basis: orders with status 'Delivered' or 'Served' (completed only).
 *     Cancelled/Pending/Placed orders never count toward money.
 *   - Day/hour bucketing is IST (UTC+5:30, fixed — no DST in India), same as
 *     the app's dayKey().
 *   - Customer phone: order.phone || order.customerPhone ||
 *     tableSessionsContact[sessionId].customerPhone || .guestPhone, normalized
 *     to the last 10 digits.
 *   - Payment buckets: exact 'cash'/'upi' (case-insensitive), everything else COD.
 *
 * data = {
 *   orders:     [...],                     // already range-filtered by the caller
 *   contacts:   { sessionId: { customerPhone|guestPhone } },
 *   dishes:     { dishId: { name, category, price, stock, veg } },
 *   attendance: { 'YYYY-MM-DD': { uid: { minutes } } },
 *   staff:      [{ uid, displayName }],
 * }
 * Each catalog entry lists what it needs in `req` so the caller fetches only
 * what the selected report consumes (orders are always fetched).
 */

// IST day key for a timestamp (ms) or ISO string → 'YYYY-MM-DD'
export function dayKeyIST(v) {
    const ms = toMs(v);
    if (!ms) return '';
    return new Date(ms + 19800000).toISOString().slice(0, 10);
}

// IST hour-of-day (0-23) for a timestamp
export function hourKeyIST(v) {
    const ms = toMs(v);
    if (!ms) return -1;
    return new Date(ms + 19800000).getUTCHours();
}

function toMs(v) {
    if (typeof v === 'number') return v > 0 ? v : 0;
    if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
    return 0;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => Number(v) || 0;
// RTDB arrays may come back as objects with numeric keys — normalize to a list.
const toList = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
const isCompleted = (o) => o && (o.status === 'Delivered' || o.status === 'Served');
const normPhone = (raw) => String(raw || '').replace(/\D/g, '').slice(-10);
function phoneOf(o, contacts) {
    const c = (contacts && o.sessionId && contacts[o.sessionId]) || {};
    return normPhone(o.phone || o.customerPhone || c.customerPhone || c.guestPhone) || '';
}
function itemsOf(o) {
    const raw = o.cart || o.items || {};
    const list = toList(raw);
    return list.length ? list : (o.item ? [{ name: o.item, qty: 1, price: o.total }] : []);
}

export const REPORT_CATALOG = [
    // --- Sales (revenue-bearing) ---
    { key: 'sales-summary',   title: 'Sales Summary (per day)', group: 'Sales', revenue: true },
    { key: 'sales-by-item',   title: 'Sales by Item',           group: 'Sales', revenue: true },
    { key: 'payment-methods', title: 'Payment Methods',         group: 'Sales', revenue: true },
    { key: 'peak-hours',      title: 'Peak Hours',              group: 'Sales', revenue: true },
    { key: 'order-types',     title: 'Order Types',             group: 'Sales', revenue: true },
    // --- Tax (revenue-bearing) ---
    { key: 'tax-summary',     title: 'Tax Summary by Rate',     group: 'Tax', revenue: true },
    // --- Customers (revenue-bearing) ---
    { key: 'top-customers',   title: 'Top Customers',           group: 'Customers', revenue: true, req: ['contacts'] },
    // --- Staff ---
    { key: 'staff-attendance', title: 'Staff Attendance',       group: 'Staff', revenue: false, req: ['attendance', 'staff'] },
    // --- Operations ---
    { key: 'order-status',    title: 'Order Status Funnel',     group: 'Operations', revenue: false },
    // --- Inventory ---
    { key: 'menu-items',      title: 'Menu Items Snapshot',     group: 'Inventory', revenue: false, snapshot: true, req: ['dishes'] },
];

// Ordered unique groups (catalog order defines sidebar order)
export const REPORT_GROUPS = [...new Set(REPORT_CATALOG.map(r => r.group))];

export function getReport(key) {
    return REPORT_CATALOG.find(r => r.key === key) || null;
}

/**
 * Run one report. Returns { columns, rows, colTypes } or null for unknown keys.
 */
export function runReport(key, data = {}) {
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const completed = orders.filter(isCompleted);
    const contacts = data.contacts || {};

    switch (key) {
        case 'sales-summary': {
            const byDay = new Map();
            for (const o of completed) {
                const d = dayKeyIST(o.createdAt);
                if (!d) continue;
                const b = byDay.get(d) || { n: 0, rev: 0, disc: 0, tax: 0 };
                b.n += 1; b.rev += num(o.total); b.disc += num(o.discount); b.tax += num(o.tax);
                byDay.set(d, b);
            }
            const rows = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
                .map(([d, b]) => [d, b.n, round2(b.rev), round2(b.disc), round2(b.tax), b.n ? round2(b.rev / b.n) : 0]);
            return {
                columns: ['Date', 'Orders', 'Revenue', 'Discounts', 'Tax', 'Avg Order'],
                rows, colTypes: ['text', 'num', 'money', 'money', 'money', 'money'],
            };
        }

        case 'sales-by-item': {
            const byItem = new Map();
            for (const o of completed) {
                for (const it of itemsOf(o)) {
                    const name = (it && (it.name || it.item)) || 'Unknown item';
                    const qty = num(it && (it.qty || it.quantity)) || 1;
                    const b = byItem.get(name) || { qty: 0, rev: 0 };
                    b.qty += qty; b.rev += qty * num(it && it.price);
                    byItem.set(name, b);
                }
            }
            const rows = [...byItem.entries()].sort((a, b) => (b[1].rev - a[1].rev) || a[0].localeCompare(b[0]))
                .map(([name, b]) => [name, b.qty, round2(b.rev)]);
            return { columns: ['Item', 'Qty Sold', 'Revenue'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'payment-methods': {
            const buckets = { cash: { n: 0, amt: 0 }, upi: { n: 0, amt: 0 }, cod: { n: 0, amt: 0 } };
            for (const o of completed) {
                const pm = String(o.paymentMethod || 'cod').toLowerCase();
                const b = buckets[pm === 'upi' ? 'upi' : (pm === 'cash' ? 'cash' : 'cod')];
                b.n += 1; b.amt += num(o.total);
            }
            const label = { cash: 'Cash', upi: 'UPI', cod: 'COD / Other' };
            const rows = Object.entries(buckets).map(([k, b]) => [label[k], b.n, round2(b.amt)]);
            return { columns: ['Method', 'Orders', 'Amount'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'peak-hours': {
            const byHour = Array.from({ length: 24 }, () => ({ n: 0, rev: 0 }));
            for (const o of completed) {
                const h = hourKeyIST(o.createdAt);
                if (h < 0) continue;
                byHour[h].n += 1; byHour[h].rev += num(o.total);
            }
            const rows = byHour.map((b, h) => [`${String(h).padStart(2, '0')}:00`, b.n, round2(b.rev)])
                .filter(r => r[1] > 0);
            return { columns: ['Hour (IST)', 'Orders', 'Revenue'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'order-types': {
            const byType = new Map();
            for (const o of completed) {
                const t = o.type || 'Unknown';
                const b = byType.get(t) || { n: 0, rev: 0 };
                b.n += 1; b.rev += num(o.total);
                byType.set(t, b);
            }
            const rows = [...byType.entries()].sort((a, b) => (b[1].rev - a[1].rev) || a[0].localeCompare(b[0]))
                .map(([t, b]) => [t, b.n, round2(b.rev)]);
            return { columns: ['Type', 'Orders', 'Revenue'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'tax-summary': {
            const byComp = new Map();
            let unspecified = 0;
            for (const o of completed) {
                const items = toList(o.taxItems);
                if (items.length) {
                    for (const t of items) {
                        if (!t) continue;
                        const k = `${t.name || 'Tax'} @ ${num(t.rate)}%`;
                        const b = byComp.get(k) || { n: 0, amt: 0 };
                        b.n += 1; b.amt += num(t.amount);
                        byComp.set(k, b);
                    }
                } else if (num(o.tax) > 0) {
                    unspecified += num(o.tax);
                }
            }
            const rows = [...byComp.entries()].sort((a, b) => (b[1].amt - a[1].amt) || a[0].localeCompare(b[0]))
                .map(([k, b]) => [k, b.n, round2(b.amt)]);
            if (unspecified > 0) rows.push(['Unspecified (legacy orders)', null, round2(unspecified)]);
            return { columns: ['Tax Component', 'Line Count', 'Tax Collected'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'top-customers': {
            const byPhone = new Map();
            for (const o of completed) {
                const p = phoneOf(o, contacts);
                if (!p) continue;
                const b = byPhone.get(p) || { n: 0, amt: 0, last: 0 };
                b.n += 1; b.amt += num(o.total);
                const t = toMs(o.createdAt);
                if (t > b.last) b.last = t;
                byPhone.set(p, b);
            }
            const rows = [...byPhone.entries()].sort((a, b) => (b[1].amt - a[1].amt) || a[0].localeCompare(b[0]))
                .map(([p, b]) => [p, b.n, round2(b.amt), b.last ? dayKeyIST(b.last) : '']);
            return { columns: ['Phone', 'Orders', 'Total Spent', 'Last Order'], rows, colTypes: ['text', 'num', 'money', 'text'] };
        }

        case 'staff-attendance': {
            const att = data.attendance || {};
            const names = new Map((Array.isArray(data.staff) ? data.staff : []).map(s => [s.uid, s.displayName || s.uid]));
            const byUid = new Map();
            for (const [date, dayAtt] of Object.entries(att)) {
                for (const [uid, a] of Object.entries(dayAtt || {})) {
                    if (!a || a.inAt == null) continue; // never clocked in that day
                    const b = byUid.get(uid) || { days: 0, mins: 0 };
                    b.days += 1;
                    b.mins += num(a.minutes);
                    byUid.set(uid, b);
                }
            }
            const rows = [...byUid.entries()].sort((a, b) => (names.get(a[0]) || a[0]).localeCompare(names.get(b[0]) || b[0]) || a[0].localeCompare(b[0]))
                .map(([uid, b]) => [names.get(uid) || uid, b.days, round2(b.mins / 60)]);
            return { columns: ['Staff', 'Days Present', 'Hours'], rows, colTypes: ['text', 'num', 'num'] };
        }

        case 'order-status': {
            const byStatus = new Map();
            for (const o of orders) { // ALL orders here — the funnel includes cancelled/pending
                const s = o.status || 'Placed';
                const b = byStatus.get(s) || { n: 0, amt: 0 };
                b.n += 1; b.amt += num(o.total);
                byStatus.set(s, b);
            }
            const rows = [...byStatus.entries()].sort((a, b) => (b[1].n - a[1].n) || a[0].localeCompare(b[0]))
                .map(([s, b]) => [s, b.n, round2(b.amt)]);
            return { columns: ['Status', 'Orders', 'Order Value'], rows, colTypes: ['text', 'num', 'money'] };
        }

        case 'menu-items': {
            const dishes = data.dishes || {};
            const rows = Object.entries(dishes)
                .sort(([ia, a], [ib, b]) => ((a && a.name) || ia).localeCompare((b && b.name) || ib) || ia.localeCompare(ib))
                .map(([id, d]) => [
                (d && d.name) || id,
                (d && d.category) || '',
                round2(num(d && d.price)),
                d && d.stock === false ? 'Out' : 'In stock',
                d && d.veg ? 'Veg' : 'Non-veg',
            ]);
            return { columns: ['Item', 'Category', 'Price', 'Stock', 'Type'], rows, colTypes: ['text', 'text', 'money', 'text', 'text'] };
        }

        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Self-check: `node shared/report-catalog.js`
// ---------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('report-catalog')) {
    import('node:assert').then(({ default: assert }) => {
        // Fixtures: 3 orders on 2026-10-20/21 IST, 1 cancelled (excluded), 1 pending (excluded)
        const orders = [
            { // QR dine-in, completed, CGST+SGST
                orderId: 'o1', status: 'Delivered', type: 'Dine-in', source: 'QR', sessionId: 's1',
                createdAt: '2026-10-20T06:30:00.000Z', // 12:00 IST
                paymentMethod: 'Cash', total: 500, discount: 50, tax: 25,
                taxItems: [{ name: 'CGST', rate: 2.5, amount: 12.5 }, { name: 'SGST', rate: 2.5, amount: 12.5 }],
                cart: { item_0: { name: 'Margherita', qty: 2, price: 199 }, item_1: { name: 'Coke', qty: 1, price: 52 } },
            },
            { // delivery, completed
                orderId: 'o2', status: 'Delivered', type: 'Online',
                createdAt: '2026-10-20T15:30:00.000Z', // 21:00 IST
                paymentMethod: 'COD', total: 332.9, discount: 0, tax: 14.9,
                taxItems: [{ name: 'GST', rate: 5, amount: 14.9 }],
                cart: { item_0: { name: 'Farmhouse', qty: 1, price: 299 } },
            },
            { // cancelled — excluded from every money report
                orderId: 'o3', status: 'Cancelled', type: 'Dine-in',
                createdAt: '2026-10-21T05:00:00.000Z', total: 999,
                cart: { item_0: { name: 'Never shipped', qty: 1, price: 999 } },
            },
            { // pending QR draft — excluded
                orderId: 'o4', status: 'Pending', type: 'Dine-in', sessionId: 's2',
                createdAt: '2026-10-21T07:00:00.000Z', total: 250,
                cart: { item_0: { name: 'Garlic Bread', qty: 1, price: 250 } },
            },
        ];
        const data = {
            orders,
            contacts: { s1: { customerPhone: '919300000001' } },
            dishes: { d1: { name: 'Margherita', category: 'Pizza', price: 199, stock: true, veg: true }, d2: { name: 'Chicken Tikka', category: 'Starters', price: 299, stock: false, veg: false } },
            attendance: {
                '2026-10-20': { u1: { inAt: 'x', minutes: 600 }, u2: { inAt: 'x', minutes: 300 } },
                '2026-10-21': { u1: { inAt: 'x', minutes: 480 } },
            },
            staff: [{ uid: 'u1', displayName: 'Ramesh' }, { uid: 'u2', displayName: 'Sunita' }],
        };

        // catalog integrity: unique keys, groups ordered, every entry well-formed
        const keys = REPORT_CATALOG.map(r => r.key);
        assert.strictEqual(new Set(keys).size, keys.length, 'catalog keys unique');
        assert.ok(REPORT_GROUPS.length >= 5 && REPORT_GROUPS[0] === 'Sales');

        // sales-summary: 2 completed orders on 10-20 IST (both), none on 10-21
        const ss = runReport('sales-summary', data);
        assert.deepStrictEqual(ss.rows, [['2026-10-20', 2, 832.9, 50, 39.9, 416.45]]);
        assert.strictEqual(ss.columns.length, ss.colTypes.length);

        // sales-by-item: Margherita 2×199=398, Farmhouse 299, Coke 52 — cancelled excluded
        const si = runReport('sales-by-item', data);
        assert.deepStrictEqual(si.rows[0], ['Margherita', 2, 398]);
        assert.strictEqual(si.rows.find(r => r[0] === 'Never shipped'), undefined);

        // payment-methods: cash 500, cod 332.9
        const pm = runReport('payment-methods', data);
        assert.deepStrictEqual(pm.rows.find(r => r[0] === 'Cash'), ['Cash', 1, 500]);
        assert.deepStrictEqual(pm.rows.find(r => r[0] === 'COD / Other'), ['COD / Other', 1, 332.9]);

        // peak-hours: 12:00 IST and 21:00 IST buckets only
        const ph = runReport('peak-hours', data);
        assert.deepStrictEqual(ph.rows, [['12:00', 1, 500], ['21:00', 1, 332.9]]);

        // order-types: Dine-in 1 / 500, Online 1 / 332.9
        const ot = runReport('order-types', data);
        assert.deepStrictEqual(ot.rows, [['Dine-in', 1, 500], ['Online', 1, 332.9]]);

        // tax-summary: CGST+SGST 25, GST 14.9 — no unspecified (all have taxItems)
        const tx = runReport('tax-summary', data);
        assert.deepStrictEqual(tx.rows.find(r => r[0] === 'CGST @ 2.5%'), ['CGST @ 2.5%', 1, 12.5]);
        assert.deepStrictEqual(tx.rows.find(r => r[0] === 'GST @ 5%'), ['GST @ 5%', 1, 14.9]);
        // legacy order without taxItems lands in Unspecified
        const tx2 = runReport('tax-summary', { orders: [...orders, { status: 'Delivered', createdAt: '2026-10-21T06:00:00.000Z', total: 100, tax: 5 }] });
        assert.strictEqual(tx2.rows.find(r => r[0].startsWith('Unspecified'))[2], 5);

        // top-customers: phone from contacts for QR order; raw phone for delivery (none → excluded)
        const tc = runReport('top-customers', data);
        assert.deepStrictEqual(tc.rows, [['9300000001', 1, 500, '2026-10-20']]);

        // staff-attendance: Ramesh 2 days 18h, Sunita 1 day 5h — sorted by name asc
        const sa = runReport('staff-attendance', data);
        assert.deepStrictEqual(sa.rows, [['Ramesh', 2, 18], ['Sunita', 1, 5]]);

        // order-status: ALL orders counted (4), cancelled + pending present
        const os = runReport('order-status', data);
        assert.strictEqual(os.rows.find(r => r[0] === 'Cancelled')[1], 1);
        assert.strictEqual(os.rows.reduce((s, r) => s + r[1], 0), 4);

        // menu-items: snapshot ignores orders entirely
        const mi = runReport('menu-items', data);
        assert.deepStrictEqual(mi.rows[0], ['Chicken Tikka', 'Starters', 299, 'Out', 'Non-veg']);

        // unknown key → null; hostile data → empty rows, not throws
        assert.strictEqual(runReport('nope', data), null);
        assert.deepStrictEqual(runReport('sales-summary', {}).rows, []);
        assert.deepStrictEqual(runReport('sales-summary', { orders: [null, undefined, {}] }).rows, []);

        console.log('report-catalog OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
