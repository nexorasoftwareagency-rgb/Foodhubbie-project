#!/usr/bin/env node
/**
 * seed-demo-tenant.cjs - synthetic, READ-ONLY demo tenant for www.foodhubbie.in/demo
 *
 * Creates (or fully replaces) `businesses/foodhubbie-demo` and the demo admin
 * `demo@foodhubbie.in`, then seeds ~45 days of realistic history so every Admin
 * tab has something to show.
 *
 * Safety model (see database.rules.json):
 *   - `admins/{uid}.isDemo = true` blocks every write under
 *     `businesses/$businessId` (the business-level `.write` grant is the only
 *     one that could cascade past deeper denies).
 *   - The demo admin has `businessId = foodhubbie-demo`, so it cannot read or
 *     write any real tenant.
 *   - `outletIndex/demo` is deliberately NOT written: the demo outlet can never
 *     be resolved by a QR/menu link, so no customer order can land here.
 *   - No `outlet.whatsapp` node: bot-control-api's orchestrator only manages
 *     outlets that have one, so no bot worker is ever spawned for the demo.
 *
 * Fixtures (dishes, riders, customers, staff, inventory, ...) are imported from
 * Admin/js/demo/demo-data.js - the same dataset the static /demo/tour replica
 * renders - so the live demo and the tour show the same restaurant. Money is
 * computed with the real shared/money-math.js.
 *
 * Idempotent: a run rewrites the whole business subtree and re-asserts the auth
 * user + admin node. Dry-run by default.
 *
 *   node tools/seed-demo-tenant.cjs            # dry run: build + print summary
 *   node tools/seed-demo-tenant.cjs --apply    # write to RTDB
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const admin = require(path.join(ROOT, 'bot', 'node_modules', 'firebase-admin'));
const serviceAccount = require(path.join(ROOT, 'bot', 'service-account.json'));

const APPLY = process.argv.includes('--apply');
const BID = 'foodhubbie-demo';
const OID = 'demo';
const DEMO_EMAIL = 'demo@foodhubbie.in';
const DEMO_PASSWORD = 'Demo@Foodhubbie2026';
const DEMO_NAME = 'Demo Dashboard';
const DEMO_OUTLET_NAME = 'Demo Dashboard';
// Menu + combos are copied from the live Roshani Pizza outlet so the demo
// showcases the real product catalog (prices, sizes, photos, combos) instead of
// invented fixtures. Read over the public REST API: no credentials needed.
const SOURCE_BID = process.env.DEMO_SOURCE_BID || 'roshani-pizza';
const SOURCE_OID = process.env.DEMO_SOURCE_OID || 'pizza';
const DB_URL = process.env.FIREBASE_DATABASE_URL
    || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const IST = 19800000; // +05:30

// ---------------------------------------------------------------- utilities

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pad2 = (n) => String(n).padStart(2, '0');
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/** Epoch ms of 00:00 IST on the IST day containing `ts`. */
function istMidnight(ts) {
    const d = new Date(ts + IST);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST;
}
function ymd(ts) {
    const d = new Date(ts + IST);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function ddmmyy(ts) {
    const d = new Date(ts + IST);
    return `${pad2(d.getUTCDate())}${pad2(d.getUTCMonth() + 1)}${String(d.getUTCFullYear()).slice(2)}`;
}
function istHour(ts) {
    return new Date(ts + IST).getUTCHours();
}
/** ISO week key ('2026-W44') for the IST day containing `ts`. */
function isoWeekKey(ts) {
    const d = new Date(istMidnight(ts) + IST);
    const dow = (d.getUTCDay() + 6) % 7;           // Mon = 0
    d.setUTCDate(d.getUTCDate() - dow + 3);        // Thursday of that week
    const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const fdow = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - fdow + 3);
    const week = 1 + Math.round((d - first) / (7 * DAY));
    return `${d.getUTCFullYear()}-W${pad2(week)}`;
}
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}
function svgImage(label, bg) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">`
        + `<rect width="600" height="400" fill="${bg}"/>`
        + `<text x="300" y="200" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#ffffff" text-anchor="middle">${label}</text>`
        + `<text x="300" y="248" font-family="Arial,Helvetica,sans-serif" font-size="19" fill="#ffffff" opacity=".75" text-anchor="middle">FoodHubbie demo</text>`
        + `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function token(rnd) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 16; i++) out += chars[Math.floor(rnd() * chars.length)];
    return out;
}

// ------------------------------------------------------------ fixture load
// demo-data.js is an ES module whose only import is ../../shared/money-math.js
// (which does not exist under Admin/). Copy both into a temp dir as .mjs with
// the import rewritten, then dynamic-import them.

async function loadFixtures() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-demo-seed-'));
    fs.copyFileSync(path.join(ROOT, 'shared', 'money-math.js'), path.join(tmp, 'money-math.mjs'));
    fs.copyFileSync(path.join(ROOT, 'shared', 'payroll-math.js'), path.join(tmp, 'payroll-math.mjs'));

    const src = fs.readFileSync(path.join(ROOT, 'Admin', 'js', 'demo', 'demo-data.js'), 'utf8')
        .replace("from '../../shared/money-math.js'", "from './money-math.mjs'");
    const extra = '\nexport { DISHES, CATEGORIES, COMBOS, RIDERS, CUSTOMERS, STAFF, INVENTORY, '
        + 'SUPPLIERS, EXPENSES, DISCOUNTS, FEEDBACK, CHATS, ROLES, TABLES, EXPENSE_CATEGORIES, '
        + 'PROMOTIONS, AUDIT_LOG };\n';
    fs.writeFileSync(path.join(tmp, 'fixtures.mjs'), src + extra);

    const money = await import(pathToFileURL(path.join(tmp, 'money-math.mjs')).href);
    const payroll = await import(pathToFileURL(path.join(tmp, 'payroll-math.mjs')).href);
    const fixtures = await import(pathToFileURL(path.join(tmp, 'fixtures.mjs')).href);
    return {
        money: { ...money, computePayroll: payroll.computePayroll },
        fixtures,
        cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    };
}

// ------------------------------------------------------------------ catalog

/**
 * Read the live catalog (categories/dishes/combos) straight from RTDB. Those
 * nodes are publicly readable (the customer menu needs them), so this works
 * from any machine — no service account for the read, only for the write.
 */
async function loadLiveCatalog() {
    const base = `${DB_URL}/businesses/${SOURCE_BID}/outlets/${SOURCE_OID}`;
    const out = {};
    for (const node of ['categories', 'dishes', 'combos']) {
        const res = await fetch(`${base}/${node}.json`);
        if (!res.ok) throw new Error(`source catalog ${node}: HTTP ${res.status}`);
        out[node] = (await res.json()) || {};
    }
    if (!Object.keys(out.dishes).length) throw new Error(`source catalog is empty (${SOURCE_BID}/${SOURCE_OID})`);
    return out;
}

function buildCatalog(live, fx) {
    const categories = {};
    for (const [id, c] of Object.entries(live.categories)) {
        categories[id] = {
            name: c.name,
            icon: c.icon || '',
            order: Number(c.order) || 0,
            visible: c.visible !== false,
            desc: c.desc || '',
            image: c.image || '',
            addons: c.addons || {},
            createdAt: c.createdAt || NOW - 60 * DAY,
        };
    }

    const dishes = {};
    for (const [id, d] of Object.entries(live.dishes)) {
        const stock = d.stock !== false;
        dishes[id] = {
            ...d,
            stock,
            available: stock,
            gstRate: d.gstRate || 5,
            desc: d.desc || d.description || '',
            createdAt: d.createdAt || NOW - 60 * DAY,
            updatedAt: NOW - 2 * DAY,
        };
    }

    const combos = {};
    for (const [id, c] of Object.entries(live.combos)) {
        combos[id] = {
            ...c,
            // The live windows are campaign dates; the demo must show every
            // combo as running, otherwise the tab looks broken on most days.
            disabled: false,
            startAt: NOW - 30 * DAY,
            endAt: NOW + 365 * DAY,
            createdAt: c.createdAt || NOW - 30 * DAY,
            updatedAt: NOW - 2 * DAY,
        };
        delete combos[id].sourceOid;
    }

    // The order generator below is written against the fixture ids d1..d14.
    // Map each onto a real menu item (alphabetical, deterministic) so seeded
    // history references live dish ids, names and prices.
    const liveKeys = Object.keys(dishes).sort((a, b) => String(dishes[a].name).localeCompare(String(dishes[b].name)));
    const dishMap = {};
    fx.DISHES.forEach((d, i) => { dishMap[d.id] = liveKeys[i % liveKeys.length]; });

    return { categories, dishes, combos, dishMap };
}

// ------------------------------------------------------------------- orders

const LINE_POOL = [
    [['d1', 1], ['d13', 1]],
    [['d3', 2], ['d8', 1]],
    [['d2', 1], ['d6', 1], ['d14', 2]],
    [['d9', 1], ['d11', 1]],
    [['d4', 1], ['d7', 1], ['d13', 2]],
    [['d1', 2], ['d12', 1]],
    [['d10', 1], ['d14', 1]],
    [['d3', 1], ['d8', 2], ['d13', 2]],
    [['d1', 1], ['d6', 1], ['d13', 2]],
    [['d2', 2], ['d7', 1]],
    [['d5', 1], ['d12', 2]],
];

function buildOrders({ rnd, money, fx, dishes, dishMap, discounts, customers }) {
    const orders = {};
    const seqByDay = {};
    const discountUsage = {};
    const ordersByPhone = {};
    const riderTotals = {};
    const dishByKey = {};
    for (const [key, d] of Object.entries(dishes)) dishByKey[key] = d;

    const RIDER_KEYS = fx.RIDERS.map((r) => `rider_${r.id}`);
    const GUESTS = fx.CUSTOMERS.map((c) => ({ name: c.name, phone: c.phone.replace(/\D/g, '').slice(-10) }));

    function nextSeq(ts) {
        const key = ddmmyy(ts);
        seqByDay[key] = (seqByDay[key] || 0) + 1;
        return { key, seq: seqByDay[key], orderId: `DD-${key}-${seqByDay[key]}` };
    }

    function priceLines(specs) {
        return specs.map(([dishId, qty]) => {
            const key = dishMap[dishId];
            const d = dishByKey[key];
            if (!d) throw new Error(`seed dish map miss: ${dishId}`);
            return {
                id: key,
                name: d.name,
                qty,
                quantity: qty,
                price: d.price,
                unitPrice: d.price,
                total: d.price * qty,
                size: 'Regular',
                addon: '',
                instructions: '',
            };
        });
    }

    /**
     * @param {object} spec
     *   ts, channel ('delivery'|'qr'|'pos'), status, paid, method, guest, phone,
     *   lines, tableId, tableNumber, sessionId, riderId, note, discountId
     */
    function makeOrder(spec) {
        const lines = priceLines(spec.lines);
        const subtotal = money.round2(lines.reduce((s, l) => s + l.price * l.qty, 0));
        const delivery = spec.channel === 'delivery';
        const dineIn = !delivery;

        // --- discount (only when the order qualifies) ---
        let discountAmount = 0;
        let dDoc = null;
        if (spec.discountId && discounts[spec.discountId]) {
            dDoc = discounts[spec.discountId];
            if (subtotal >= (dDoc.minSubtotal || 0)) {
                discountAmount = dDoc.mode === 'percent'
                    ? money.round2(subtotal * (dDoc.value / 100))
                    : Number(dDoc.value) || 0;
                if (dDoc.maxCap) discountAmount = Math.min(discountAmount, dDoc.maxCap);
                discountAmount = Math.min(discountAmount, subtotal);
            } else {
                dDoc = null;
            }
        }

        const fee = delivery ? (subtotal >= 499 ? 0 : pick(rnd, [29, 49, 69])) : 0;
        const totals = money.computeOrderTotals({
            subtotal,
            discount: discountAmount,
            taxRates: dineIn
                ? [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }]
                : [{ name: 'GST', rate: 5 }],
            serviceChargeEnabled: dineIn,
            serviceChargeRate: 5,
            deliveryFee: fee,
        });

        const id = nextSeq(spec.ts);
        const riderName = spec.riderId
            ? (fx.RIDERS.find((r) => `rider_${r.id}` === spec.riderId) || {}).name || ''
            : '';

        const order = {
            orderId: id.orderId,
            items: lines,
            subtotal: totals.subtotal,
            discount: totals.discount,
            taxable: totals.taxable,
            taxItems: totals.taxItems,
            tax: totals.tax,
            taxName: dineIn ? 'GST' : 'GST',
            serviceCharge: totals.serviceCharge,
            serviceChargeName: 'Service Charge',
            serviceChargeRate: dineIn ? 5 : 0,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            paymentMethod: spec.paid === false ? (spec.method || 'Pending') : (spec.method || 'UPI'),
            paymentStatus: spec.paid === false ? 'Pending' : 'Paid',
            customerName: spec.guest || 'Walk-in guest',
            phone: spec.phone || '',
            address: delivery ? (spec.address || 'B-402, Sea Breeze, Bandra West (demo)') : '',
            tableId: spec.tableId || null,
            tableNo: spec.tableNumber || null,
            sessionId: spec.sessionId || null,
            riderId: spec.riderId || null,
            riderName,
            status: spec.status,
            type: delivery ? 'Online' : 'Dine-in',
            source: spec.channel === 'qr' ? 'QR' : spec.channel === 'pos' ? 'POS' : (spec.source || 'WA'),
            stockDeducted: true,
            timestamp: spec.ts,
            createdAt: new Date(spec.ts).toISOString(),
            outlet: OID,
            assignedRider: spec.riderId || '',
            createdBy: DEMO_EMAIL,
            note: spec.note || '',
        };
        if (delivery) {
            order.distanceKm = Math.round((1.5 + rnd() * 7) * 10) / 10;
            order.lat = 19.06 + rnd() * 0.02;
            order.lng = 72.83 + rnd() * 0.02;
        }
        if (dDoc) {
            order.discountId = spec.discountId;
            order.discountLabel = dDoc.name;
            order.discountCode = dDoc.couponCode;
            order.discountSource = `coupon:${dDoc.couponCode}`;
            const uKey = `du_${Object.keys(discountUsage).length + 1}`;
            discountUsage[uKey] = {
                discountId: spec.discountId,
                discountLabel: dDoc.name,
                orderId: id.orderId,
                customerPhone: spec.phone || '',
                amountGiven: Math.round(totals.discount),
                appliedAt: spec.ts,
                channel: delivery ? 'whatsapp' : 'table',
                source: `coupon:${dDoc.couponCode}`,
                discountSource: `coupon:${dDoc.couponCode}`,
            };
            const st = dDoc.stats || { usedCount: 0, totalDiscountGiven: 0, lastUsedAt: 0 };
            st.usedCount += 1;
            st.totalDiscountGiven = money.round2(st.totalDiscountGiven + totals.discount);
            st.lastUsedAt = Math.max(st.lastUsedAt || 0, spec.ts);
            dDoc.stats = st;
        }

        orders[id.orderId] = order;

        // Denormalised rider totals (riderStats mirrors the rider app's shape:
        // earnings = sum of delivery fees on delivered orders).
        if (spec.riderId && delivery && spec.status === 'Delivered') {
            const rt = riderTotals[spec.riderId] || { totalOrders: 0, totalEarnings: 0 };
            rt.totalOrders += 1;
            rt.totalEarnings = money.round2(rt.totalEarnings + totals.deliveryFee);
            riderTotals[spec.riderId] = rt;
        }
        if (spec.phone) {
            const p = spec.phone;
            (ordersByPhone[p] = ordersByPhone[p] || []).push(order);
        }
        return { order, key: id.orderId };
    }

    // ---- today: live board + open table sessions -------------------------
    const today = istMidnight(NOW);
    const at = (minsAgo) => Math.max(today + 8 * HOUR, NOW - minsAgo * MIN);

    const openTables = [
        {
            session: 'sess_demo_1', table: 'table_01', guest: 'Diya Kapoor', phone: '9000000202', guests: 2,
            openedAt: at(96), orders: [
                { minsAgo: 96, status: 'Served', lines: [['d1', 1], ['d6', 1], ['d13', 2]] },
            ],
        },
        {
            session: 'sess_demo_2', table: 'table_02', guest: 'Walk-in guest', phone: '', guests: 4,
            openedAt: at(48), billRequested: true, orders: [
                { minsAgo: 44, status: 'Served', lines: [['d3', 1], ['d8', 1], ['d14', 2]] },
            ],
        },
        {
            session: 'sess_demo_3', table: 'table_05', guest: 'Kabir Malhotra', phone: '9000000203', guests: 2,
            openedAt: at(19), orders: [
                { minsAgo: 18, status: 'Confirmed', lines: [['d2', 1], ['d8', 1], ['d14', 2]] },
            ],
        },
        {
            session: 'sess_demo_4', table: 'table_07', guest: 'Office group (6)', phone: '', guests: 6,
            openedAt: at(12), groups: true, orders: [
                { minsAgo: 12, status: 'Placed', lines: [['d1', 3], ['d3', 2]] },
                { minsAgo: 6, status: 'Placed', lines: [['d7', 2], ['d14', 3]] },
            ],
        },
    ];

    const tables = {};
    fx.TABLES.forEach((t, i) => {
        tables[`table_${pad2(i + 1)}`] = {
            id: `table_${pad2(i + 1)}`,
            number: pad2(i + 1),
            capacity: t.seats,
            zone: t.zone,
            status: 'free',
            active: true,
            token: token(rnd),
            createdAt: NOW - 60 * DAY,
            updatedAt: NOW - 3 * DAY,
        };
    });

    const tableSessions = {};
    const tableSessionsContact = {};
    const tableRequests = {};

    for (const ot of openTables) {
        const keys = [];
        for (const o of ot.orders) {
            const { key } = makeOrder({
                ts: at(o.minsAgo), channel: 'qr', status: o.status, paid: false,
                guest: ot.guest, phone: ot.phone, lines: o.lines,
                tableId: ot.table, tableNumber: tables[ot.table].number, sessionId: ot.session,
            });
            keys.push(key);
        }
        const sessOrders = keys.map((k) => orders[k]);
        const grandTotal = money.round2(sessOrders.reduce((s, o) => s + o.total, 0));
        const tax = money.round2(sessOrders.reduce((s, o) => s + o.tax, 0));
        const disc = money.round2(sessOrders.reduce((s, o) => s + o.discount, 0));
        tableSessions[ot.session] = {
            sessionId: ot.session,
            tableId: ot.table,
            tableNumber: tables[ot.table].number,
            tableToken: tables[ot.table].token,
            status: 'open',
            openedAt: ot.openedAt,
            guestCount: ot.guests,
            customerName: ot.guest,
            orders: keys,
            runningTotal: grandTotal,
            grandTotal,
            tax,
            discount: disc,
            lastOrderAt: NOW - ot.orders[ot.orders.length - 1].minsAgo * MIN,
        };
        if (ot.groups) {
            tableSessions[ot.session].orderGroups = {
                group_1: { id: 'group_1', label: 'Group 1', orders: [keys[0]], status: 'open', createdAt: at(12) },
                group_2: { id: 'group_2', label: 'Group 2', orders: [keys[1]], status: 'open', createdAt: at(6) },
            };
        }
        tables[ot.table].status = ot.billRequested ? 'billing' : 'occupied';
        tables[ot.table].currentSession = ot.session;
        if (ot.phone) tableSessionsContact[ot.session] = { phone: ot.phone };
    }

    // closed sessions from earlier today (paid dine-in bills)
    const closed = [
        { session: 'sess_demo_0a', table: 'table_03', guest: 'Rohan Gupta', phone: '9000000205', minsAgo: 248, lines: [['d2', 1], ['d11', 2]], method: 'UPI' },
        { session: 'sess_demo_0b', table: 'table_06', guest: 'Aarav Sharma', phone: '9000000201', minsAgo: 300, lines: [['d4', 1], ['d13', 2]], method: 'Card' },
    ];
    for (const cs of closed) {
        const ts = at(cs.minsAgo);
        const { key } = makeOrder({
            ts, channel: 'qr', status: 'Served', paid: true, method: cs.method,
            guest: cs.guest, phone: cs.phone, lines: cs.lines,
            tableId: cs.table, tableNumber: tables[cs.table].number, sessionId: cs.session,
        });
        const o = orders[key];
        tableSessions[cs.session] = {
            sessionId: cs.session,
            tableId: cs.table,
            tableNumber: tables[cs.table].number,
            tableToken: tables[cs.table].token,
            status: 'closed',
            openedAt: ts - 35 * MIN,
            closedAt: ts + 20 * MIN,
            paidAt: ts + 20 * MIN,
            guestCount: 2,
            customerName: cs.guest,
            orders: [key],
            runningTotal: o.total,
            grandTotal: o.total,
            tax: o.tax,
            discount: o.discount,
            paymentMethod: cs.method,
        };
    }

    // pending table requests
    tableRequests.req_demo_1 = {
        tableId: 'table_02', tableNumber: '02', type: 'bill', status: 'pending', createdAt: at(9),
    };
    tableRequests.req_demo_2 = {
        tableId: 'table_05', tableNumber: '05', type: 'water', status: 'pending', createdAt: at(4),
    };
    tableRequests.req_demo_3 = {
        tableId: 'table_01', tableNumber: '01', type: 'clean', status: 'resolved',
        createdAt: at(70), resolvedAt: at(66),
    };

    // delivery / takeaway / POS board for today
    makeOrder({
        ts: at(26), channel: 'delivery', source: 'WA', status: 'Out for Delivery', paid: true, method: 'UPI',
        guest: 'Aarav Sharma', phone: '9000000201', riderId: RIDER_KEYS[0],
        lines: [['d2', 1], ['d6', 1], ['d13', 2]],
        address: 'B-402, Sea Breeze, Bandra West (demo)',
    });
    makeOrder({
        ts: at(42), channel: 'delivery', source: 'webview_delivery', status: 'Reached Drop Location', paid: true,
        method: 'UPI', guest: 'Ishita Rai', phone: '9000000204', riderId: RIDER_KEYS[1],
        lines: [['d3', 1], ['d10', 1], ['d14', 2]], discountId: 'disc_loyal100',
    });
    makeOrder({
        ts: at(128), channel: 'delivery', source: 'WA', status: 'Delivered', paid: true, method: 'UPI',
        guest: 'Aarav Sharma', phone: '9000000201', riderId: RIDER_KEYS[0],
        lines: [['d4', 2], ['d13', 2]],
    });
    makeOrder({
        ts: at(205), channel: 'delivery', source: 'webview_delivery', status: 'Delivered', paid: true,
        method: 'COD', guest: 'Meera Pillai', phone: '9000000206', riderId: RIDER_KEYS[3],
        lines: [['d3', 1], ['d7', 1]], discountId: 'disc_welcome10',
    });
    makeOrder({
        ts: at(300), channel: 'delivery', source: 'WA', status: 'Delivered', paid: true, method: 'UPI',
        guest: 'Aditya Menon', phone: '9000000208', riderId: RIDER_KEYS[0], lines: [['d2', 1]],
    });
    makeOrder({
        ts: at(74), channel: 'delivery', source: 'WA', status: 'Cancelled', paid: false,
        guest: 'Kabir Malhotra', phone: '9000000203',
        lines: [['d5', 1]], note: 'Customer cancelled - item unavailable',
    });
    makeOrder({
        ts: at(156), channel: 'pos', status: 'Delivered', paid: true, method: 'Cash',
        guest: 'Walk-in guest', lines: [['d1', 1], ['d8', 1], ['d14', 1]],
    });
    makeOrder({
        ts: at(230), channel: 'pos', status: 'Delivered', paid: true, method: 'UPI',
        guest: 'Walk-in guest', lines: [['d6', 2], ['d13', 2]],
    });

    // ---- history: 44 previous days ---------------------------------------
    const weekend = (ts) => {
        const dow = new Date(ts + IST).getUTCDay();
        return dow === 0 || dow === 6;
    };
    for (let dayAgo = 44; dayAgo >= 1; dayAgo--) {
        const dayStart = istMidnight(NOW) - dayAgo * DAY;
        let count = 6 + Math.floor(rnd() * 3);
        if (weekend(dayStart)) count += 2 + Math.floor(rnd() * 2);

        for (let k = 0; k < count; k++) {
            const hour = 11 + Math.floor(rnd() * 11);           // 11:00 - 21:59 IST
            const ts = dayStart + hour * HOUR + Math.floor(rnd() * 60) * MIN;
            const r = rnd();
            const guest = pick(rnd, GUESTS);
            const lines = pick(rnd, LINE_POOL);
            const useDiscount = rnd() < 0.22;

            if (r < 0.45) {
                const riderId = rnd() < 0.75 ? pick(rnd, RIDER_KEYS) : null;
                makeOrder({
                    ts, channel: 'delivery', source: rnd() < 0.5 ? 'WA' : 'webview_delivery',
                    status: 'Delivered', paid: true,
                    method: pick(rnd, ['UPI', 'Cash', 'Card', 'COD']),
                    guest: guest.name, phone: guest.phone, riderId, lines,
                    discountId: useDiscount ? pick(rnd, ['disc_welcome10', 'disc_loyal100', 'disc_happyhour']) : null,
                });
            } else if (r < 0.78) {
                const tIdx = Math.floor(rnd() * fx.TABLES.length);
                makeOrder({
                    ts, channel: 'qr', status: 'Served', paid: true,
                    method: pick(rnd, ['UPI', 'Cash', 'Card']),
                    guest: guest.name, phone: guest.phone, lines,
                    tableId: `table_${pad2(tIdx + 1)}`, tableNumber: pad2(tIdx + 1),
                    discountId: useDiscount ? 'disc_happyhour' : null,
                });
            } else {
                makeOrder({
                    ts, channel: 'pos', status: 'Delivered', paid: true,
                    method: pick(rnd, ['UPI', 'Cash', 'Card']),
                    guest: 'Walk-in guest', lines,
                });
            }
        }
    }

    // ---- customer aggregates + loyalty -----------------------------------
    const byPhone = {};
    for (const [phone, list] of Object.entries(ordersByPhone)) {
        const done = list.filter((o) => o.status !== 'Cancelled');
        if (!done.length) continue;
        const totalSpent = money.round2(done.reduce((s, o) => s + o.total, 0));
        const earnBase = money.round2(done.reduce((s, o) => s + (o.subtotal - o.discount), 0));
        const lifetimePoints = Math.floor(earnBase / 20);          // 1 pt / Rs 20
        const last = done.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
        byPhone[phone] = {
            name: last.customerName,
            totalSpent,
            lifetimePoints,
            orderCount: done.length,
            lastOrderAt: last.timestamp,
            lastOrderDate: last.createdAt,
        };
    }

    const ranked = Object.entries(byPhone).sort((a, b) => b[1].lifetimePoints - a[1].lifetimePoints);
    const rankings = {};
    ranked.forEach(([phone, agg], i) => {
        rankings[phone] = {
            phone,
            business: BID,
            outlet: OID,
            rank: i + 1,
            lifetimePoints: agg.lifetimePoints,
            tier: agg.lifetimePoints >= 5000 ? 'gold' : agg.lifetimePoints >= 1000 ? 'silver' : 'bronze',
            totalSpent: agg.totalSpent,
            updatedAt: NOW,
        };
    });

    return {
        orders, tables, tableSessions, tableSessionsContact, tableRequests,
        seqByDay, discountUsage, riderTotals, byPhone, rankings, ordersByPhone,
    };
}

// -------------------------------------------------------------------- staff

function buildStaff({ rnd, money, fx, moneyMath }) {
    const staff = {};
    const staffList = [];
    for (const s of fx.STAFF) {
        const uid = `staff_${s.uid}`;
        staff[uid] = {
            uid,
            displayName: s.displayName,
            email: s.email,
            role: s.role,
            isActive: s.status === 'Active',
            payType: s.payType,
            rate: s.rate,
            discountCeilingPct: s.role === 'owner' ? 100 : 20,
            createdAt: new Date(NOW - 90 * DAY).toISOString(),
            createdBy: 'demo-seed',
        };
        if (s.status === 'Active') staffList.push({ uid, payType: s.payType, rate: s.rate });
    }

    // attendance: last 14 IST days (the UI shows 7; the closed payroll run
    // covers the previous Mon..Sun week, so it needs those days too)
    const attendance = {};
    const todayKey = ymd(NOW);
    for (let d = 13; d >= 0; d--) {
        const dayKey = ymd(istMidnight(NOW) - d * DAY);
        const day = {};
        for (const s of fx.STAFF) {
            if (s.status !== 'Active') continue;
            if (d > 0 && rnd() > 0.88) continue;                  // occasional day off
            const inAt = new Date(istMidnight(NOW) - d * DAY + (9 + Math.floor(rnd() * 3)) * HOUR + Math.floor(rnd() * 50) * MIN);
            const openShift = d === 0 && rnd() > 0.4;
            const minutes = openShift ? null : 420 + Math.floor(rnd() * 160);
            day[`staff_${s.uid}`] = {
                inAt: inAt.toISOString(),
                outAt: openShift ? null : new Date(inAt.getTime() + minutes * MIN).toISOString(),
                minutes,
            };
        }
        attendance[dayKey] = day;
    }

    // shifts for the current ISO week
    const week = isoWeekKey(NOW);
    const shifts = {
        [week]: {
            staff_s1: [{ day: 0, startMinute: 600, endMinute: 1320, station: 'Floor' }],
            staff_s2: [{ day: 0, startMinute: 600, endMinute: 1080 }, { day: 2, startMinute: 600, endMinute: 1080 }],
            staff_s3: [{ day: 1, startMinute: 660, endMinute: 1140, station: 'Counter' }, { day: 3, startMinute: 660, endMinute: 1140, station: 'Counter' }],
            staff_s4: [{ day: 1, startMinute: 1020, endMinute: 1380, station: 'Floor' }, { day: 4, startMinute: 1020, endMinute: 1380, station: 'Floor' }],
        },
    };

    const leave = {
        leave_demo_1: {
            uid: 'staff_s4', from: addDays(todayKey, 3), to: addDays(todayKey, 3),
            paid: false, reason: 'Family function', status: 'pending',
            requestedAt: NOW - 2 * DAY, decidedAt: null, decidedBy: null,
        },
        leave_demo_2: {
            uid: 'staff_s3', from: addDays(todayKey, -4), to: addDays(todayKey, -4),
            paid: false, reason: 'Medical', status: 'approved',
            requestedAt: NOW - 6 * DAY, decidedAt: NOW - 5 * DAY, decidedBy: DEMO_EMAIL,
        },
        leave_demo_3: {
            uid: 'staff_s2', from: addDays(todayKey, -9), to: addDays(todayKey, -8),
            paid: true, reason: 'Annual leave', status: 'approved',
            requestedAt: NOW - 14 * DAY, decidedAt: NOW - 12 * DAY, decidedBy: DEMO_EMAIL,
        },
    };

    // one closed payroll run: last full Mon..Sun week
    const lastMonday = istMidnight(NOW) - ((new Date(istMidnight(NOW) + IST).getUTCDay() + 6) % 7) * DAY - 7 * DAY;
    const periodStart = ymd(lastMonday);
    const periodEnd = ymd(lastMonday + 6 * DAY);
    const minutesByUid = {};
    const unpaidLeaveDaysByUid = {};
    for (let i = 0; i < 7; i++) {
        const dayAtt = attendance[ymd(lastMonday + i * DAY)] || {};
        for (const [uid, a] of Object.entries(dayAtt)) {
            if (a && a.minutes != null) minutesByUid[uid] = (minutesByUid[uid] || 0) + a.minutes;
        }
    }
    unpaidLeaveDaysByUid.staff_s4 = 1;
    const lines = moneyMath.computePayroll({
        periodStart, periodEnd, tipPool: 900, staff: staffList, minutesByUid, unpaidLeaveDaysByUid,
    });
    const payrollRuns = {
        [`${periodStart}__${periodEnd}`]: {
            periodStart,
            periodEnd,
            tipPool: 900,
            lines,
            closedAt: new Date(istMidnight(NOW) - 5 * DAY).toISOString(),
            closedBy: DEMO_EMAIL,
        },
    };

    const staffChanges = {
        sc_demo_1: {
            action: 'staff_create', targetStaffUid: 'staff_s5', oldValue: null,
            newValue: { displayName: 'Farah Sheikh', role: 'waiter' },
            actorUid: 'demo-seed', actorRole: 'owner', actorName: 'Ramesh Iyer',
            timestamp: NOW - 6 * DAY, note: 'Created waiter account',
        },
        sc_demo_2: {
            action: 'staff_update', targetStaffUid: 'staff_s3',
            oldValue: { rate: 160 }, newValue: { rate: 180 },
            actorUid: 'demo-seed', actorRole: 'owner', actorName: 'Ramesh Iyer',
            timestamp: NOW - 4 * DAY, note: 'Updated staff profile',
        },
        sc_demo_3: {
            action: 'staff_disable', targetStaffUid: 'staff_s5',
            oldValue: { isActive: true }, newValue: { isActive: false },
            actorUid: 'demo-seed', actorRole: 'manager', actorName: 'Sunita Rao',
            timestamp: NOW - 3 * DAY, note: 'Account disabled by manager',
        },
        sc_demo_4: {
            action: 'staff_enable', targetStaffUid: 'staff_s5',
            oldValue: { isActive: false }, newValue: { isActive: true },
            actorUid: 'demo-seed', actorRole: 'owner', actorName: 'Ramesh Iyer',
            timestamp: NOW - 2 * DAY, note: 'Account re-enabled',
        },
    };

    return { staff, attendance, shifts, leave, payrollRuns, staffChanges, week };
}

// ---------------------------------------------------------------- inventory

function buildInventory({ rnd, money, fx }) {
    const inventory = {};
    const log = {};
    fx.INVENTORY.forEach((i, idx) => {
        inventory[`inv_${i.id}`] = {
            id: `inv_${i.id}`,
            name: i.name,
            sku: `DD-${String(idx + 1).padStart(3, '0')}`,
            unit: i.unit,
            stock: i.stock,
            threshold: i.min,
            cost: i.cost,
            supplier: i.supplier,
            updatedAt: new Date(NOW - (idx + 1) * HOUR).toISOString(),
        };
    });

    const logs = [
        { itemId: 'inv_i2', delta: -1.5, prevStock: 10, newStock: 8.5, reason: 'Order #DD (demo)' },
        { itemId: 'inv_i1', delta: 20, prevStock: 22, newStock: 42, reason: 'Purchase - Mumbai Mill Co.' },
        { itemId: 'inv_i5', delta: -2, prevStock: 8, newStock: 6, reason: 'Wastage' },
        { itemId: 'inv_i9', delta: -0.4, prevStock: 2.5, newStock: 2.1, reason: 'Order #DD (demo)' },
        { itemId: 'inv_i10', delta: -30, prevStock: 350, newStock: 320, reason: 'Order #DD (demo)' },
        { itemId: 'inv_i7', delta: -1, prevStock: 6, newStock: 5, reason: 'Order #DD (demo)' },
    ];
    logs.forEach((l, i) => {
        log[`log_demo_${i + 1}`] = {
            itemId: l.itemId, delta: l.delta, prevStock: l.prevStock, newStock: l.newStock,
            user: 'demo@foodhubbie.in', timestamp: NOW - (i + 1) * 3 * HOUR, reason: l.reason,
        };
    });

    return { inventory, inventoryLog: log };
}

// ----------------------------------------------------------------- expenses

function buildExpenses({ rnd, money, fx }) {
    const meta = [
        { name: 'Rent', icon: 'home', color: '#3b82f6', budget: 40000 },
        { name: 'Utilities', icon: 'zap', color: '#F59E0B', budget: 10000 },
        { name: 'Salaries', icon: 'credit-card', color: '#10B981', budget: 200000 },
        { name: 'Raw Material', icon: 'utensils', color: '#8B5CF6', budget: 60000 },
        { name: 'Marketing', icon: 'megaphone', color: '#EC4899', budget: 15000 },
        { name: 'Maintenance', icon: 'wrench', color: '#0EA5E9', budget: 8000 },
        { name: 'Software', icon: 'laptop', color: '#64748B', budget: 5000 },
    ];
    const categories = {};
    meta.forEach((m, i) => {
        categories[`ec_${i + 1}`] = {
            name: m.name, icon: m.icon, color: m.color, displayOrder: i + 1,
            monthlyBudget: m.budget, alertThreshold: 80, isSystem: true,
        };
    });

    const catIdByName = {};
    for (const [id, c] of Object.entries(categories)) catIdByName[c.name] = id;

    const expenses = {};
    const rows = [
        { daysAgo: 0, cat: 'Raw Material', vendor: 'Dairyline Foods', amount: 8600, method: 'UPI', status: 'approved', note: 'Weekly dairy restock' },
        { daysAgo: 0, cat: 'Utilities', vendor: 'Adani Electricity', amount: 4120, method: 'Bank', status: 'pending', note: 'September meter' },
        { daysAgo: 1, cat: 'Marketing', vendor: 'Meta Ads', amount: 2500, method: 'Card', status: 'approved', note: 'Weekend reach campaign' },
        { daysAgo: 2, cat: 'Maintenance', vendor: 'CoolAir Services', amount: 1800, method: 'Cash', status: 'approved', note: 'AC service - dining area' },
        { daysAgo: 3, cat: 'Salaries', vendor: 'Payroll run', amount: 42000, method: 'Bank', status: 'approved', note: 'Fortnightly payout' },
        { daysAgo: 4, cat: 'Software', vendor: 'FoodHubbie', amount: 1990, method: 'Card', status: 'approved', note: 'Monthly subscription' },
        { daysAgo: 6, cat: 'Raw Material', vendor: 'Mumbai Mill Co.', amount: 5400, method: 'UPI', status: 'approved', note: 'Flour and pasta' },
        { daysAgo: 8, cat: 'Rent', vendor: 'Hill Road Properties', amount: 40000, method: 'Bank', status: 'approved', note: 'Monthly rent' },
        { daysAgo: 9, cat: 'Marketing', vendor: 'Instagram Ads', amount: 3200, method: 'Card', status: 'rejected', note: 'Duplicate invoice' },
        { daysAgo: 11, cat: 'Utilities', vendor: 'Brihanmumbai Water', amount: 1450, method: 'UPI', status: 'approved', note: 'Water bill' },
    ];
    rows.forEach((r, i) => {
        const date = ymd(istMidnight(NOW) - r.daysAgo * DAY);
        const catId = catIdByName[r.cat] || 'ec_1';
        expenses[`exp_demo_${i + 1}`] = {
            amount: r.amount,
            categoryId: catId,
            categoryName: r.cat,
            createdAt: istMidnight(NOW) - r.daysAgo * DAY + 11 * HOUR,
            createdBy: DEMO_EMAIL,
            date,
            description: r.note,
            vendor: r.vendor,
            method: r.method,
            outletId: OID,
            status: r.status,
            statusAt: r.status === 'pending' ? null : istMidnight(NOW) - r.daysAgo * DAY + 13 * HOUR,
            statusBy: r.status === 'pending' ? null : DEMO_EMAIL,
        };
    });

    return { categories, expenses };
}

// ---------------------------------------------------------------- discounts

function buildDiscounts({ fx, money }) {
    const discounts = {};
    const spec = [
        {
            key: 'disc_welcome10', name: 'WELCOME10', code: 'WELCOME10', mode: 'percent', value: 10,
            channel: 'all', minSubtotal: 299, maxCap: 0, globalLimit: 500, perCustomerLimit: 1,
            enabled: true, stats: { usedCount: 42, totalDiscountGiven: 1260 },
        },
        {
            key: 'disc_loyal100', name: 'LOYAL100', code: 'LOYAL100', mode: 'flat', value: 100,
            channel: 'whatsapp', minSubtotal: 599, maxCap: 100, globalLimit: 200, perCustomerLimit: 2,
            enabled: true, stats: { usedCount: 17, totalDiscountGiven: 1700 },
        },
        {
            key: 'disc_happyhour', name: 'HAPPYHOUR', code: 'HAPPYHOUR', mode: 'percent', value: 15,
            channel: 'table', minSubtotal: 0, maxCap: 150, globalLimit: 150, perCustomerLimit: 0,
            enabled: true, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '15:00', endTime: '18:00',
            stats: { usedCount: 9, totalDiscountGiven: 540 },
        },
        {
            key: 'disc_family50', name: 'FAMILY50', code: 'FAMILY50', mode: 'flat', value: 50,
            channel: 'all', minSubtotal: 899, maxCap: 50, globalLimit: 100, perCustomerLimit: 1,
            enabled: false, stats: { usedCount: 31, totalDiscountGiven: 1550 },
        },
    ];
    spec.forEach((d, i) => {
        const fxRow = fx.DISCOUNTS[i] || {};
        discounts[d.key] = {
            id: d.key,
            name: d.name,
            type: 'coupon',
            mode: d.mode,
            value: d.value,
            couponCode: d.code,
            enabled: d.enabled,
            channel: d.channel,
            minSubtotal: d.minSubtotal,
            maxCap: d.maxCap,
            globalLimit: d.globalLimit,
            perCustomerLimit: d.perCustomerLimit,
            stackable: false,
            startsAt: NOW - 40 * DAY,
            endsAt: 0,
            daysOfWeek: d.daysOfWeek || null,
            startTime: d.startTime || '',
            endTime: d.endTime || '',
            description: fxRow.window && fxRow.window !== 'Always on' ? `Window: ${fxRow.window}` : 'Always on',
            stats: { usedCount: d.stats.usedCount, totalDiscountGiven: d.stats.totalDiscountGiven, lastUsedAt: NOW - 2 * HOUR },
            engineVersion: 1,
            createdAt: NOW - 40 * DAY,
            updatedAt: NOW - 2 * DAY,
        };
    });
    return discounts;
}

// ------------------------------------------------------------------- loyalty

function buildLoyalty({ rnd, money, fx, orders, byPhone, rankings, ordersByPhone }) {
    const config = {
        earnRatePaisePerPoint: 2000,
        redeemValuePaisePerPoint: 100,
        minSpendAfterRedemption: 199,
        earnEnabled: true,
        dineInEarnEnabled: true,
        clawbackEnabled: true,
        tiers: {
            bronze: { min: 0, label: 'Bronze', multiplier: 1 },
            silver: { min: 1000, label: 'Silver', multiplier: 1.25 },
            gold: { min: 5000, label: 'Gold', multiplier: 1.5 },
        },
        rewards: [
            { id: 'free-garlic-bread', label: 'Free Garlic Bread', cost: 200, type: 'item' },
            { id: '10pct-off', label: '10% Off Next Order', cost: 500, type: 'discount' },
            { id: 'free-dessert', label: 'Free Dessert', cost: 800, type: 'item' },
        ],
        updatedAt: NOW - 20 * DAY,
        updatedBy: DEMO_EMAIL,
    };

    const customers = {};
    const tierFor = (pts) => (pts >= 5000 ? 'gold' : pts >= 1000 ? 'silver' : 'bronze');

    for (const c of fx.CUSTOMERS) {
        const phone = c.phone.replace(/\D/g, '').slice(-10);
        const agg = byPhone[phone] || { name: c.name, totalSpent: 0, lifetimePoints: 0, orderCount: 0, lastOrderAt: NOW - 3 * DAY };
        const recent = (ordersByPhone[phone] || []).slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
        const ordersMap = {};
        for (const o of recent) {
            ordersMap[o.orderId] = {
                orderId: o.orderId, createdAt: o.timestamp, total: o.total, status: o.status, type: o.type,
            };
        }
        customers[phone] = {
            name: agg.name || c.name,
            phone,
            address: 'Bandra West, Mumbai (demo address)',
            location: { lat: 19.05 + rnd() * 0.03, lng: 72.82 + rnd() * 0.04 },
            mapsLink: 'https://maps.google.com/?q=19.06,72.83',
            lastOrderDate: agg.lastOrderDate || new Date(agg.lastOrderAt).toISOString(),
            lastSeen: agg.lastOrderAt,
            orderCount: agg.orderCount,
            totalSpent: agg.totalSpent,
            registeredAt: NOW - (60 + Math.floor(rnd() * 60)) * DAY,
            promotionalConsent: true,
            loyalty: {
                lifetimePoints: agg.lifetimePoints,
                points: agg.lifetimePoints,
                tier: tierFor(agg.lifetimePoints),
                totalSpent: agg.totalSpent,
                orderCount: agg.orderCount,
                updatedAt: NOW,
            },
            orders: ordersMap,
            app: { name: agg.name || c.name, phone, platform: 'android', registeredAt: NOW - 60 * DAY },
        };
    }

    // one redeemed + one live reward on the top customer
    const topPhone = Object.keys(customers)[0];
    if (topPhone) {
        const top = customers[topPhone];
        const burned = 500;
        top.rewards = {
            reward_demo_1: {
                rewardId: '10pct-off', label: '10% Off Next Order', code: 'RW-DEMO-4821', cost: burned,
                status: 'redeemed', createdAt: NOW - 12 * DAY, redeemedAt: NOW - 9 * DAY,
                redeemedOrderId: 'DD-DEMO',
            },
            reward_demo_2: {
                rewardId: 'free-garlic-bread', label: 'Free Garlic Bread', code: 'RW-DEMO-9134', cost: 200,
                status: 'active', createdAt: NOW - 2 * DAY, redeemedAt: null, redeemedOrderId: null,
            },
        };
        top.loyalty.points = Math.max(0, top.loyalty.points - burned);
    }

    return { config, customers, rankings };
}

// --------------------------------------------------------------------- chat

function buildChats({ rnd, fx }) {
    const chats = {};
    fx.CHATS.forEach((c, idx) => {
        // Thread key = last-10-digits of the JID (bot/chat-log.js convention).
        const phone = c.phone.replace(/\D/g, '').slice(-10);
        const jid = `91${phone}@s.whatsapp.net`;
        const messages = {};
        c.messages.forEach((m, i) => {
            const ts = NOW - (fx.CHATS.length - idx) * 3 * HOUR - (c.messages.length - i) * 2 * MIN;
            messages[`msg_${idx + 1}_${i + 1}`] = {
                from: m.from === 'restaurant' ? 'bot' : 'customer',
                text: m.text,
                ts,
                type: 'text',
            };
        });
        const last = c.messages[c.messages.length - 1];
        chats[phone] = {
            meta: {
                name: c.name,
                phone: jid,
                lastTs: NOW - (fx.CHATS.length - idx) * 3 * HOUR,
                lastText: last.text,
                lastDir: last.from === 'restaurant' ? 'bot' : 'customer',
                unread: c.unread || 0,
            },
            messages,
        };
    });
    return chats;
}

// ----------------------------------------------------------------- feedback

function buildFeedback({ money, fx }) {
    const feedbacks = {};
    fx.FEEDBACK.forEach((f, i) => {
        const ts = NOW - (i + 1) * 5 * HOUR;
        feedbacks[`fb_demo_${i + 1}`] = {
            rating: f.rating,
            customerName: f.customer,
            phone: `90000002${String(i + 1).padStart(2, '0')}`,
            reason: f.rating >= 4 ? 'Great food' : 'Delivery time',
            comment: f.comment,
            orderId: f.orderId,
            timestamp: ts,
            outlet: OID,
        };
    });
    return feedbacks;
}

// ---------------------------------------------------------------- bot + misc

function buildBot({ rnd, money, fx }) {
    const status = {
        status: 'Online',
        outlet: OID,
        lastSeen: NOW + 365 * DAY,     // keeps the demo badge "online" until the next reseed
    };
    const pair = { status: 'connected', phone: '+91 90000 00001', updatedAt: NOW - 40 * DAY };

    const usage = {};
    for (let d = 6; d >= 0; d--) {
        const key = ymd(istMidnight(NOW) - d * DAY);
        const order_notification = 6 + Math.floor(rnd() * 8);
        const rider_broadcast = 2 + Math.floor(rnd() * 4);
        const promo = d === 1 ? 42 : Math.floor(rnd() * 6);
        const admin_alert = Math.floor(rnd() * 3);
        usage[key] = {
            total: order_notification + rider_broadcast + promo + admin_alert,
            order_notification, rider_broadcast, promo, admin_alert,
            updatedAt: NOW - d * DAY,
        };
    }

    const campaigns = {
        c_demo_done: {
            id: 'c_demo_done',
            status: 'done',
            template: fx.PROMOTIONS[0].message,
            waTemplateName: fx.PROMOTIONS[0].shell,
            greeting: false,
            mediaUrl: null,
            recipients: Array.from({ length: 214 }, (_, i) => `91900000${String(1000 + i).slice(-4)}`),
            currentIndex: 214,
            totalSent: 209,
            totalFailed: 5,
            createdAt: NOW - 2 * DAY,
            startedAt: NOW - 2 * DAY,
            completedAt: NOW - 2 * DAY + 90 * MIN,
            lastHeartbeat: NOW - 2 * DAY + 90 * MIN,
            requestedBy: DEMO_EMAIL,
            quietHours: null,
            sendStopMsg: true,
            menuText: null,
            menuImageUrl: null,
        },
        c_demo_scheduled: {
            id: 'c_demo_scheduled',
            status: 'scheduled',
            template: fx.PROMOTIONS[1].message,
            waTemplateName: fx.PROMOTIONS[1].shell,
            greeting: false,
            mediaUrl: null,
            recipients: Array.from({ length: 68 }, (_, i) => `91900000${String(2000 + i).slice(-4)}`),
            currentIndex: 0,
            totalSent: 0,
            totalFailed: 0,
            createdAt: NOW - 6 * HOUR,
            runAt: istMidnight(NOW) + DAY + 12 * HOUR,
            requestedBy: DEMO_EMAIL,
            quietHours: { start: 21, end: 9 },
            sendStopMsg: true,
            menuText: null,
            menuImageUrl: null,
        },
    };

    const logs = {};
    for (let i = 0; i < 6; i++) {
        logs[`log_demo_${i + 1}`] = {
            jid: `91900000${String(3000 + i).slice(-4)}@s.whatsapp.net`,
            status: i === 3 ? 'failed' : 'sent',
            sentAt: NOW - (i + 1) * 40 * MIN,
            error: i === 3 ? 'recipient not on WhatsApp' : null,
            couponCode: i === 0 ? 'WELCOME10' : null,
            campaignId: 'c_demo_done',
        };
    }

    const promotions = {
        enabled: true,
        killSwitch: false,
        dailyCount: { [ymd(NOW)]: 12 },
        campaigns,
        logs,
        optout: {},
    };

    return { status, pair, usage, promotions };
}

function buildBilling() {
    return {
        mode: 'per_order',
        rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1, commission1pct: 0.01 },
        setup: { amount: 500, status: 'non_refundable', date: new Date(NOW - 88 * DAY).toISOString() },
        tokens: { balance: 15, updatedAt: NOW - 10 * DAY },
        tokenPacks: {
            welcome: {
                qty: 15, priceRs: 0, note: 'Free welcome pack',
                grantedAt: NOW - 88 * DAY, grantedBy: 'system',
            },
        },
        payments: {
            pay_demo_1: {
                amount: 1500, method: 'UPI', period: ymd(NOW - 56 * DAY).slice(0, 7),
                note: 'Advance top-up', createdAt: NOW - 56 * DAY,
                createdBy: 'system', receiptNo: 'RCP-DEMO-0001',
            },
            pay_demo_2: {
                amount: 1990, method: 'Card', period: ymd(NOW - 27 * DAY).slice(0, 7),
                note: 'Monthly settlement', createdAt: NOW - 27 * DAY,
                createdBy: 'system', receiptNo: 'RCP-DEMO-0002',
            },
        },
        charges: {
            chg_demo_1: {
                amount: 1842, reason: 'Monthly usage', period: ymd(NOW - 27 * DAY).slice(0, 7),
                createdAt: NOW - 27 * DAY, createdBy: 'system', receiptNo: 'RCP-DEMO-0003',
            },
            chg_demo_2: {
                amount: 1264, reason: 'Monthly usage', period: ymd(NOW).slice(0, 7),
                createdAt: NOW - 1 * DAY, createdBy: 'system', receiptNo: 'RCP-DEMO-0004',
            },
        },
    };
}

const ALL_TABS = ['dashboard', 'orders', 'live', 'walkin', 'tables', 'promotions', 'discounts',
    'menu', 'categories', 'combos', 'menu-browser', 'inventory', 'riders', 'customers', 'loyalty',
    'chat', 'reports', 'riderAnalytics', 'feedback', 'liveTracker', 'payments', 'expenses',
    'notifications', 'costs', 'settings'];

function buildSettings({ rnd, fx }) {
    const store = {
        entityName: DEMO_OUTLET_NAME,
        storeName: DEMO_OUTLET_NAME,
        address: fx.DEMO_OUTLET.address,
        gstin: fx.DEMO_OUTLET.gstin,
        fssai: fx.DEMO_OUTLET.fssai,
        tagline: 'Live demo · every feature enabled · reseeded nightly',
        poweredBy: 'Powered by FoodHubbie',
        shopOpenTime: '11:00',
        shopCloseTime: '23:30',
        shopStatus: 'AUTO',
        wifiName: 'DemoDashboard_Guest',
        wifiPass: 'demo1234',
        lat: '19.0596',
        lng: '72.8295',
        instagram: 'https://instagram.com/ (demo)',
        facebook: 'https://facebook.com/ (demo)',
        googleReviewLink: 'https://example.com/review (demo)',
        paymentQR: '',
        customerMenuBgImage: svgImage(DEMO_OUTLET_NAME, '#7C2D12'),
    };

    const delivery = {
        developerPhone: '919000000001',
        reportPhone: '919000000001',
        notifyPhone: '919000000001',
        backupCode: '2026',
        slabs: [{ km: 3, fee: 29 }, { km: 6, fee: 49 }, { km: 10, fee: 69 }],
    };

    const security = { discountCeilingPct: 0, managerPinHash: '' };

    const features = {
        discountApproval: false,
        expense: true,
        staffManagement: true,
        loyalty: true,
        whatsappBot: true,
    };

    const roles = {
        admin: { name: 'Admin', level: 2, tabs: ALL_TABS },
        owner: { name: 'Owner', level: 2, tabs: ALL_TABS },
        manager: { name: 'Manager', level: 1, tabs: ALL_TABS.filter((t) => t !== 'settings') },
        cashier: { name: 'Cashier', level: 0, tabs: ['dashboard', 'walkin', 'tables', 'orders', 'live', 'notifications'] },
        waiter: { name: 'Waiter', level: -1, tabs: ['orders', 'live', 'notifications'] },
    };

    const bot = {
        imgConfirmed: svgImage('Order confirmed', '#16A34A'),
        imgReady: svgImage('Order ready', '#E84908'),
        imgOut: svgImage('Out for delivery', '#0EA5E9'),
        imgDelivered: svgImage('Delivered', '#7C3AED'),
        imgFeedback: svgImage('Rate your order', '#DB2777'),
        greetingImage: svgImage('Welcome to Demo Dashboard', '#E84908'),
        menuImage: svgImage('Our Menu', '#111827'),
    };

    const display = {
        checkShowAddress: true,
        checkShowFSSAI: true,
        checkShowFeedbackQR: true,
        checkShowGSTIN: true,
        checkShowPoweredBy: true,
        checkShowQR: true,
        checkShowSocial: true,
        checkShowStoreName: true,
        checkShowTagline: true,
        checkShowWifiInfo: true,
    };

    return {
        Store: store,
        Delivery: delivery,
        Security: security,
        features,
        roles,
        Bot: bot,
        Display: display,
        Expenses: {
            currencyDisplay: '\u20B9',
            autoApproveThreshold: 2000,
            expenseCeilingPct: 10,
            updatedAt: NOW - 20 * DAY,
            updatedBy: DEMO_EMAIL,
        },
        inventory: { availability: true, stockTracking: true },
    };
}

// ---------------------------------------------------------------------- main

(async () => {
    console.log(`[demo-seed] ${APPLY ? 'APPLY' : 'DRY RUN'} -> ${DB_URL} (${BID}/${OID})`);

    const { money, fixtures: fx, cleanup } = await loadFixtures();
    const rnd = mulberry32(20261028);

    const live = await loadLiveCatalog();
    const { categories, dishes, combos, dishMap } = buildCatalog(live, fx);
    console.log(`[demo-seed] catalog source  ${SOURCE_BID}/${SOURCE_OID} -> `
        + `${Object.keys(categories).length} categories, ${Object.keys(dishes).length} dishes, ${Object.keys(combos).length} combos`);
    const discounts = buildDiscounts({ fx, money });
    const orderData = buildOrders({ rnd, money, fx, dishes, dishMap, discounts });
    const staffData = buildStaff({ rnd, money, fx, moneyMath: money });
    const invData = buildInventory({ rnd, money, fx });
    const expData = buildExpenses({ rnd, money, fx });
    const loyaltyData = buildLoyalty({
        rnd, money, fx, orders: orderData.orders, byPhone: orderData.byPhone,
        rankings: orderData.rankings, ordersByPhone: orderData.ordersByPhone,
    });
    const chats = buildChats({ rnd, fx });
    const feedbacks = buildFeedback({ money, fx });
    const bot = buildBot({ rnd, money, fx });
    const settings = buildSettings({ rnd, fx });

    const riderStats = {};
    for (const r of fx.RIDERS) {
        const key = `rider_${r.id}`;
        const t = orderData.riderTotals[key] || { totalOrders: 0, totalEarnings: 0 };
        riderStats[key] = {
            totalOrders: t.totalOrders,
            totalEarnings: t.totalEarnings,
            avgRating: r.rating,
            deliveredOrders: {},
        };
    }

    const riders = {};
    fx.RIDERS.forEach((r, i) => {
        const uid = `rider_${r.id}`;
        const phone = r.phone.replace(/\D/g, '').slice(-10);
        const offline = r.status === 'Offline';
        riders[uid] = {
            uid,
            name: r.name,
            phone,
            email: `${r.name.split(' ')[0].toLowerCase()}.${r.name.split(' ')[1].toLowerCase()}@demo.example`,
            businessId: BID,
            outlet: OID,
            status: r.status === 'On delivery' ? 'On Delivery' : r.status,
            vehicle: r.vehicle,
            zone: r.zone,
            address: `${r.zone}, Mumbai (demo)`,
            age: String(22 + i),
            fatherName: 'Demo',
            qualification: '12th',
            aadharNo: '',
            aadharPhoto: '',
            profilePhoto: '',
            fcmToken: '',
            isAdmin: false,
            // The app only treats a rider as online when lastSeen is within 5
            // minutes, and this tenant is reseeded nightly — a past timestamp
            // would flip every rider to Offline within minutes of the seed.
            lastSeen: offline ? NOW - 3 * HOUR : NOW + 365 * DAY,
            // Positions for the Live Tracker map (Bandra West, demo offsets).
            location: offline ? null : {
                lat: 19.0596 + (i - 1) * 0.006,
                lng: 72.8295 + (i - 1) * 0.007,
                ts: NOW,
            },
            createdAt: NOW - 60 * DAY,
        };
    });

    const settlements = {
        rider_r1: {
            SETTLE_DEMO_1: {
                amountCollected: 480, ordersClearedCount: 6,
                settledByAdmin: DEMO_EMAIL, timestamp: NOW - 2 * DAY,
            },
        },
        rider_r2: {
            SETTLE_DEMO_2: {
                amountCollected: 320, ordersClearedCount: 4,
                settledByAdmin: DEMO_EMAIL, timestamp: NOW - 3 * DAY,
            },
        },
    };

    const outlet = {
        name: DEMO_OUTLET_NAME,
        outletNo: 'DD',
        contactPhone: '919000000001',
        email: DEMO_EMAIL,
        disabled: false,
        suspended: false,
        createdAt: NOW - 88 * DAY,
        orders: orderData.orders,
        tables: orderData.tables,
        tableSessions: orderData.tableSessions,
        tableSessionsContact: orderData.tableSessionsContact,
        tableRequests: orderData.tableRequests,
        categories,
        dishes,
        combos,
        discounts,
        discountsUsage: orderData.discountUsage,
        customers: loyaltyData.customers,
        chats,
        riders,
        riderStats,
        settlements,
        staff: staffData.staff,
        attendance: staffData.attendance,
        shifts: staffData.shifts,
        leave: staffData.leave,
        payrollRuns: staffData.payrollRuns,
        inventory: invData.inventory,
        'inventory-log': invData.inventoryLog,
        expenseCategories: expData.categories,
        expenses: expData.expenses,
        feedbacks,
        loyalty: { config: loyaltyData.config, rankings: loyaltyData.rankings },
        audit: { staffChanges: staffData.staffChanges },
        billing: buildBilling(),
        settings,
        dineinSettings: {
            taxEnabled: true,
            taxName: 'GST',
            taxRate: 5,
            taxRates: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
            serviceChargeEnabled: true,
            serviceChargeName: 'Service Charge',
            serviceChargeRate: 5,
            qrBaseUrl: 'https://foodhubbie-qrmenu.web.app/',
            offers: [
                { code: 'WELCOME10', title: 'First order?', description: '10% off on orders above \u20B9299' },
                { code: 'HAPPYHOUR', title: 'Happy hours', description: '15% off between 3 PM and 6 PM' },
            ],
        },
        bot: {
            status: bot.status,
            [OID]: { pair: bot.pair },
            usage: bot.usage,
            promotions: bot.promotions,
        },
        metadata: {
            orderSequence: orderData.seqByDay,
            seededAt: NOW,
            seededBy: 'tools/seed-demo-tenant.cjs',
        },
    };

    const business = {
        name: 'FoodHubbie Demo',
        contactPhone: '919000000001',
        email: DEMO_EMAIL,
        plan: 'growth',
        createdAt: NOW - 88 * DAY,
        outlets: { [OID]: outlet },
    };

    const orderCount = Object.keys(orderData.orders).length;
    const bytes = Buffer.byteLength(JSON.stringify(business));
    console.log('[demo-seed] orders        ', orderCount);
    console.log('[demo-seed] open sessions ', Object.values(orderData.tableSessions).filter((s) => s.status === 'open').length);
    console.log('[demo-seed] customers     ', Object.keys(loyaltyData.customers).length);
    console.log('[demo-seed] dishes/combos ', Object.keys(dishes).length, '/', Object.keys(combos).length);
    console.log('[demo-seed] staff         ', Object.keys(staffData.staff).length);
    const run = staffData.payrollRuns[Object.keys(staffData.payrollRuns)[0]];
    console.log('[demo-seed] payroll lines ', run.lines.length,
        '· net', money.round2(run.lines.reduce((s, l) => s + l.netPay, 0)));
    console.log('[demo-seed] payload       ', (bytes / 1024).toFixed(1) + ' KB');

    if (!APPLY) {
        cleanup();
        console.log('[demo-seed] dry run complete - pass --apply to write');
        process.exit(0);
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DB_URL,
    });
    const db = admin.database();

    // 1. Auth user (create once, then keep password/display name in sync)
    let user;
    try {
        user = await admin.auth().getUserByEmail(DEMO_EMAIL);
        await admin.auth().updateUser(user.uid, {
            password: DEMO_PASSWORD, displayName: DEMO_NAME, emailVerified: true, disabled: false,
        });
        console.log('[demo-seed] auth user updated', user.uid);
    } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
        user = await admin.auth().createUser({
            email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: DEMO_NAME, emailVerified: true,
        });
        console.log('[demo-seed] auth user created', user.uid);
    }

    // 2. Business subtree (whole-node replace: the demo tenant has no live writers)
    await db.ref(`businesses/${BID}`).set(business);
    console.log('[demo-seed] wrote businesses/' + BID);

    // 3. Admin node
    await db.ref(`admins/${user.uid}`).set({
        uid: user.uid,
        email: DEMO_EMAIL,
        name: DEMO_NAME,
        displayName: DEMO_NAME,
        role: 'Admin',
        outlet: OID,
        businessId: BID,
        isDemo: true,
        isActive: true,
        fcmToken: '',
        createdAt: NOW,
    });
    console.log('[demo-seed] wrote admins/' + user.uid);

    // 4. The demo outlet must never be resolvable from a QR/menu link
    await db.ref(`outletIndex/${OID}`).remove();
    console.log('[demo-seed] ensured outletIndex/' + OID + ' is absent');

    cleanup();
    console.log('[demo-seed] done');
    process.exit(0);
})().catch((e) => {
    console.error('[demo-seed] FAILED:', e && (e.stack || e.message || e));
    process.exit(1);
});
