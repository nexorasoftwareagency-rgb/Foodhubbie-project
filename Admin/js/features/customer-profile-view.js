// ============================================================================
// CUSTOMER PROFILE 360 — VIEW LAYER (pure: no Firebase, no DOM, node-testable)
//
// Everything the Customer Profile drawer shows is built here as plain strings
// from plain data, so it can be unit-tested (tests/customer-profile.check.cjs)
// and so customer-profile.js only has to fetch, save and wire events.
//
// The money / billing basis is NOT re-implemented here. The caller passes the
// real helpers from shared/cost-math.js and shared/loyalty-math.js (`calc`),
// exactly like loyalty-view.js does, so "paid orders" can never drift from the
// platform's own billing definition.
//
// WHY the shared modules are injected instead of imported: Admin feature
// modules resolve `../../shared/*` only AFTER tools/build.mjs copies the
// repo-root shared/ tree into Admin/dist/shared/. A source-tree import would
// break every node-level test, so the dependency travels as an argument.
//
// PAID-ORDER BASIS (the honesty rule of this page):
//   "Lifetime spend" counts orders the customer actually PAID for.
//   Cancelled / refunded / pending orders are excluded (shared isBilledOrder),
//   and so are orders whose paymentStatus is explicitly not Paid. Everything
//   excluded is COUNTED and shown, never silently dropped.
// ============================================================================

export const PROFILE_TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'orders', label: 'Orders' },
    { key: 'loyalty', label: 'Loyalty' },
    { key: 'discounts', label: 'Discounts' },
    { key: 'notes', label: 'Notes' },
];

export const TIER_ORDER = ['bronze', 'silver', 'gold'];
export const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

// Channel mix — the order source collapsed to the five ways a guest buys.
export const CHANNELS = ['QR menu', 'WhatsApp', 'Customer app', 'Counter', 'Other'];

export const DAY_PARTS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Late night'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// RFM segments. `tone` maps to the chip colours in CUSTOMER_PROFILE_CSS.
export const RFM_SEGMENTS = {
    champion: { label: 'Champion', tone: 'ok', blurb: 'Visits often and spends well — keep them close.' },
    loyal: { label: 'Loyal', tone: 'ok', blurb: 'Comes back regularly.' },
    potential: { label: 'Potential loyalist', tone: 'good', blurb: 'Recent first visits — worth a nudge.' },
    promising: { label: 'Promising', tone: 'good', blurb: 'New, and just getting started.' },
    'at-risk': { label: 'At risk', tone: 'warn', blurb: 'Used to visit often, but has gone quiet.' },
    attention: { label: 'Needs attention', tone: 'warn', blurb: 'Visits have slowed down.' },
    dormant: { label: 'Dormant', tone: 'bad', blurb: 'Long since the last visit.' },
    lapsed: { label: 'Lapsed', tone: 'bad', blurb: 'Was a regular — has not come back for a long time.' },
    new: { label: 'New', tone: 'neutral', blurb: 'No paid visits yet.' },
};

const STATUS_META = {
    delivered: { label: 'Delivered', tone: 'ok' },
    served: { label: 'Served', tone: 'ok' },
    ready: { label: 'Ready', tone: 'good' },
    preparing: { label: 'Preparing', tone: 'good' },
    confirmed: { label: 'Confirmed', tone: 'good' },
    placed: { label: 'Placed', tone: 'warn' },
    pending: { label: 'Pending', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'bad' },
    canceled: { label: 'Cancelled', tone: 'bad' },
    refunded: { label: 'Refunded', tone: 'bad' },
    walkout: { label: 'Walkout', tone: 'bad' },
};

export function statusMeta(status) {
    const k = String(status || '').trim().toLowerCase();
    return STATUS_META[k] || { label: status ? String(status) : 'Unknown', tone: 'neutral' };
}

// ------------------------------------------------------------------ helpers

// Numeric character references, built from char codes so no editor or
// pipeline can silently rewrite the entity literals (a named-entity version
// of this function shipped broken once: every replacement was a no-op).
const CHAR_CODE = { '&': 38, '<': 60, '>': 62, '"': 34, "'": 39, '`': 96 };
const NUM_REF = (n) => String.fromCharCode(38, 35) + n + String.fromCharCode(59);

export function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"'`]/g, (ch) => NUM_REF(CHAR_CODE[ch]));
}

export function num(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('en-IN') : '0';
}

export function money(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return '₹0';
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
}

export function round2(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v)) return 0;
    return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function fmtPhone(p) {
    const d = String(p || '').replace(/\D/g, '').slice(-10);
    return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : String(p || '');
}

/**
 * Indian 10-digit mobile as the key used everywhere in the database
 * (customers/{phone}, chatMeta/{last10}, discountsUsage.customerPhone).
 *
 * STRICT on purpose: exactly 10 digits, or exactly 12 starting with the
 * country code 91, or exactly 11 starting with a domestic 0. Anything else is
 * rejected rather than trimmed — slicing the last 10 digits off a mistyped
 * number would open a DIFFERENT customer's profile.
 */
export function normalizePhone(p) {
    const s = String(p || '').replace(/\D/g, '');
    const ok10 = (x) => /^[6-9]\d{9}$/.test(x);
    if (s.length === 10) return ok10(s) ? s : '';
    if (s.length === 12 && s.startsWith('91')) {
        const local = s.slice(2);
        if (ok10(local)) return local;
    }
    if (s.length === 11 && s.startsWith('0')) {
        const local = s.slice(1);
        if (ok10(local)) return local;
    }
    return '';
}

/**
 * Timestamps in this database are messy on purpose (legacy writers): a number
 * (ms epoch), an ISO string, or a numeric string. Never guess — return null
 * when it cannot be read, so a bad row can never become "today".
 */
export function toTs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const n = Number(trimmed);
            return Number.isFinite(n) ? n : null;
        }
        const d = Date.parse(trimmed);
        return Number.isFinite(d) ? d : null;
    }
    if (typeof v === 'object' && typeof v.toMillis === 'function') {
        const n = v.toMillis();
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istHourWeekday(ts) {
    const d = new Date(Number(ts) + IST_OFFSET_MS);
    return { hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

export function dayPartOf(hour) {
    if (hour >= 6 && hour < 11) return 'Breakfast';
    if (hour >= 11 && hour < 16) return 'Lunch';
    if (hour >= 16 && hour < 19) return 'Snacks';
    if (hour >= 19 && hour < 23) return 'Dinner';
    return 'Late night';
}

export function fmtDateTime(ts) {
    const t = toTs(ts);
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function fmtDate(ts) {
    const t = toTs(ts);
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** "3 days ago" / "today" / "2 months ago" — compact, honest about the unit. */
export function agoLabel(ts, now = Date.now()) {
    const t = toTs(ts);
    if (!t) return '—';
    const mins = Math.floor((now - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function itemsOf(order) {
    if (!order) return [];
    if (Array.isArray(order.items)) return order.items;
    if (Array.isArray(order.cart)) return order.cart;
    if (order.items && typeof order.items === 'object') return Object.values(order.items);
    return [];
}

/** The channel an order came in through, collapsed to the five we report on. */
export function channelOf(order) {
    const src = String(order && order.source || '').trim().toLowerCase();
    const ch = String(order && order.channel || '').trim().toLowerCase();
    const type = String(order && order.type || '').trim().toLowerCase();
    if (src === 'pos' || type === 'walk-in' || type === 'walkin') return 'Counter';
    if (src === 'app' || ch === 'app') return 'Customer app';
    if (src === 'qr' || type === 'dine-in' || type === 'dinein') return 'QR menu';
    if (src === 'wa' || src === 'whatsapp' || src === 'webview_delivery' || src === 'webview-delivery') return 'WhatsApp';
    return 'Other';
}

function orderPhone(order) {
    return normalizePhone((order && (order.customerPhone || order.phone)) || '');
}

// -------------------------------------------------------------- paid orders

/**
 * True when the order counts as money the customer actually paid.
 * `isBilledOrder` (shared/cost-math.js) is the platform billing basis and
 * rejects cancelled / refunded / pending; on top of that we reject anything
 * whose payment status says it was NOT paid (including a walkout — the food
 * was eaten, the money was never collected).
 */
export function isPaidOrder(order, isBilledOrder) {
    if (!order) return false;
    if (typeof isBilledOrder !== 'function') throw new Error('customer-profile-view: isBilledOrder is required');
    if (!isBilledOrder(order)) return false;
    const st = String(order.status || '').trim().toLowerCase();
    // Eaten but never collected: the food is gone and the money never
    // arrived. Checked BEFORE paymentStatus — a walkout row must never be
    // counted as spend, whatever its payment stamp says.
    if (st === 'walkout') return false;
    const ps = String(order.paymentStatus || '').trim().toLowerCase();
    if (ps === 'paid') return true;
    if (['unpaid', 'pending', 'failed', 'refunded', 'walkout'].includes(ps)) return false;
    return ['delivered', 'served', 'completed', 'paid', 'closed'].includes(st);
}

function orderTs(order) {
    return toTs(order && order.createdAt) ?? toTs(order && order.timestamp) ?? 0;
}

// ---------------------------------------------------------------- analytics

export function computeLifetime(orders, now, isBilledOrder) {
    const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
    const paid = [];
    let excluded = 0;
    for (const o of list) {
        if (isPaidOrder(o, isBilledOrder)) paid.push(o);
        else excluded++;
    }
    const sorted = [...paid].sort((a, b) => orderTs(a) - orderTs(b));
    const spend = sorted.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const lastTs = sorted.length ? orderTs(sorted[sorted.length - 1]) || null : null;
    const firstTs = sorted.length ? orderTs(sorted[0]) || null : null;

    // Own mean gap between visits — the yardstick the RFM score is built on.
    let avgGapDays = null;
    if (sorted.length > 1) {
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) {
            const d = (orderTs(sorted[i]) - orderTs(sorted[i - 1])) / 86400000;
            if (d > 0) gaps.push(d);
        }
        if (gaps.length) avgGapDays = round2(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }

    return {
        totalOrders: list.length,
        paidCount: paid.length,
        excludedCount: excluded,
        lifetimeSpend: round2(spend),
        aov: paid.length ? round2(spend / paid.length) : 0,
        firstVisitAt: firstTs,
        lastVisitAt: lastTs,
        daysInactive: lastTs ? Math.max(0, Math.floor((now - lastTs) / 86400000)) : null,
        avgGapDays,
        paid: sorted,
    };
}

export function computeChannels(orders, isBilledOrder) {
    const rows = CHANNELS.map((key) => ({ key, count: 0, spend: 0 }));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const o of (orders || [])) {
        if (!isPaidOrder(o, isBilledOrder)) continue;
        const row = byKey[channelOf(o)];
        row.count++;
        row.spend += Number(o.total) || 0;
    }
    const total = rows.reduce((s, r) => s + r.count, 0);
    return rows
        .filter((r) => r.count > 0)
        .map((r) => ({ ...r, spend: round2(r.spend), pct: total ? round2((r.count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
}

export function computeFavourites(orders, isBilledOrder, limit = 5) {
    const map = new Map();
    for (const o of (orders || [])) {
        if (!isPaidOrder(o, isBilledOrder)) continue;
        // The RTDB key is the real id; `orderId` is missing on some legacy rows.
        const oid = String((o && (o._id || o.orderId)) || '');
        for (const it of itemsOf(o)) {
            const name = String(it && it.name || '').trim() || 'Item';
            const key = name.toLowerCase();
            let e = map.get(key);
            if (!e) { e = { name, qty: 0, spend: 0, orders: 0, sizes: new Set() }; map.set(key, e); }
            const qty = Number(it.qty || it.quantity || 1) || 0;
            e.qty += qty;
            e.spend += Number(it.total != null ? it.total : (Number(it.price || 0) * qty)) || 0;
            if (oid && !e.orders_seen) e.orders_seen = new Set();
            if (oid) e.orders_seen.add(oid);
            if (it.size) e.sizes.add(String(it.size));
        }
    }
    return [...map.values()]
        .map((e) => ({
            name: e.name,
            qty: e.qty,
            spend: round2(e.spend),
            orders: e.orders_seen ? e.orders_seen.size : 0,
            sizes: [...e.sizes].slice(0, 3),
        }))
        .sort((a, b) => b.qty - a.qty || b.spend - a.spend)
        .slice(0, limit);
}

export function computeRhythm(orders, isBilledOrder) {
    const parts = Object.fromEntries(DAY_PARTS.map((k) => [k, 0]));
    const days = Object.fromEntries(WEEKDAYS.map((k) => [k, 0]));
    let counted = 0;
    for (const o of (orders || [])) {
        if (!isPaidOrder(o, isBilledOrder)) continue;
        const ts = orderTs(o);
        if (!ts) continue;
        const { hour, weekday } = istHourWeekday(ts);
        parts[dayPartOf(hour)]++;
        days[WEEKDAYS[weekday]]++;
        counted++;
    }
    const topPart = DAY_PARTS.reduce((best, k) => (parts[k] > parts[best] ? k : best), DAY_PARTS[0]);
    const topDay = WEEKDAYS.reduce((best, k) => (days[k] > days[best] ? k : best), WEEKDAYS[0]);
    return {
        parts,
        days,
        counted,
        preferredPart: counted ? topPart : null,
        preferredDay: counted ? topDay : null,
        partPct: counted ? round2((parts[topPart] / counted) * 100) : 0,
    };
}

export function computeDiscounts(orders, usageRows, isBilledOrder) {
    const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
    let total = 0;
    let ordersWith = 0;
    let gross = 0;
    for (const o of list) {
        if (!isPaidOrder(o, isBilledOrder)) continue;
        const d = Number(o.discount || 0) || 0;
        gross += (Number(o.total) || 0) + d;
        if (d > 0) { total += d; ordersWith++; }
    }
    const byOffer = new Map();
    for (const u of (usageRows || [])) {
        const label = u.discountLabel || u.discountId || u.discountSource || 'Offer';
        let e = byOffer.get(label);
        if (!e) { e = { label, id: u.discountId || '', count: 0, amount: 0 }; byOffer.set(label, e); }
        e.count++;
        e.amount += Number(u.amountGiven || 0) || 0;
    }
    return {
        total: round2(total),
        ordersWith,
        offers: byOffer.size,
        gross: round2(gross),
        reliancePct: gross > 0 ? round2((total / gross) * 100) : 0,
        byOffer: [...byOffer.values()].map((e) => ({ ...e, amount: round2(e.amount) })).sort((a, b) => b.amount - a.amount),
    };
}

/**
 * The restaurant's OWN customer base, used to score frequency and spend.
 *
 * Every guest is compared with the median guest of THIS outlet over the same
 * window — otherwise a customer who visits once a month would look like a
 * "champion" simply because everyone else visits once a month too.
 *
 * Returns { customers, visitsMedian, spendMedian } — the median visits per
 * month and median monthly spend across the outlet's paying customers.
 */
export function computeBase(orders, now, isBilledOrder, opts = {}) {
    const windowDays = Number(opts.windowDays) || 180;
    const winStart = now - windowDays * 86400000;
    const per = new Map();
    for (const o of (orders || [])) {
        if (!isPaidOrder(o, isBilledOrder)) continue;
        const ts = orderTs(o);
        if (ts < winStart) continue;
        const ph = orderPhone(o);
        if (!ph) continue;
        let e = per.get(ph);
        if (!e) { e = { visits: 0, spend: 0 }; per.set(ph, e); }
        e.visits++;
        e.spend += Number(o.total) || 0;
    }
    const months = windowDays / 30;
    const median = (arr) => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const mid = s.length >> 1;
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const rows = [...per.values()];
    return {
        customers: rows.length,
        visitsMedian: round2(median(rows.map((e) => e.visits / months))),
        spendMedian: round2(median(rows.map((e) => e.spend / months))),
        windowDays,
    };
}

const band = (ratio) => (ratio >= 1.5 ? 5 : ratio >= 1 ? 4 : ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1);
// Fallback bands for outlets with too few paying customers to build a base.
const bandVisits = (vpm) => (vpm >= 4 ? 5 : vpm >= 2 ? 4 : vpm >= 1 ? 3 : vpm >= 0.5 ? 2 : 1);
const bandSpend = (spm) => (spm >= 1500 ? 5 : spm >= 800 ? 4 : spm >= 400 ? 3 : spm >= 150 ? 2 : 1);

/**
 * RFM with two different yardsticks, because they answer different questions:
 *
 *   RECENCY (r) — measured against the guest's OWN visit rhythm.
 *     Their mean gap between visits (floor 7 days) says how long they have
 *     been away. A weekly regular is not "at risk" after 10 quiet days; a
 *     twice-a-year guest is not "at risk" after 10 days either. The lapsing
 *     test uses the same yardstick: 3× their own gap, and at least 60 days.
 *
 *   FREQUENCY (f) and MONETARY (m) — measured against the RESTAURANT's own
 *     customer base (the median guest of this outlet over the same window).
 *     Without a base, absolute bands are used as a fallback.
 */
export function computeRfm(orders, now, isBilledOrder, opts = {}) {
    const windowDays = Number(opts.windowDays) || 180;
    const paid = (orders || []).filter((o) => isPaidOrder(o, isBilledOrder));
    if (!paid.length) {
        return {
            segment: 'new', r: 0, f: 0, m: 0, score: 0,
            daysInactive: null, expectedGapDays: null, expectedVisits: 0, actualVisits: 0,
            expectedSpend: 0, actualSpend: 0, windowDays, lapsed: false, risk: 'none',
            baseSource: 'none', baseCustomers: 0,
            note: 'No paid orders yet — nothing to score.',
        };
    }
    const sorted = [...paid].sort((a, b) => orderTs(a) - orderTs(b));
    const lastTs = orderTs(sorted[sorted.length - 1]);
    const daysInactive = lastTs ? Math.max(0, Math.floor((now - lastTs) / 86400000)) : 0;

    // Their OWN rhythm: the mean gap between their visits (floor 7 days).
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
        const d = (orderTs(sorted[i]) - orderTs(sorted[i - 1])) / 86400000;
        if (d > 0) gaps.push(d);
    }
    const ownGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const expectedGapDays = Math.max(7, round2(ownGap || 30));

    // The same fixed window for everyone, so the guest and the base are
    // measured over identical time.
    const months = windowDays / 30;
    const winStart = now - windowDays * 86400000;
    const inWin = sorted.filter((o) => orderTs(o) >= winStart);
    const visitsPerMonth = inWin.length / months;
    const actualSpend = round2(inWin.reduce((s, o) => s + (Number(o.total) || 0), 0));
    const monthlySpend = round2(actualSpend / months);

    const r = daysInactive <= expectedGapDays * 0.5 ? 5
        : daysInactive <= expectedGapDays ? 4
            : daysInactive <= expectedGapDays * 2 ? 3
                : daysInactive <= expectedGapDays * 3 ? 2 : 1;

    const base = opts.base || null;
    const useBase = !!(base && base.customers >= 3 && base.visitsMedian > 0 && base.spendMedian > 0);
    let f; let m; let expectedVisits; let expectedSpend; let baseSource;
    if (useBase) {
        f = band(visitsPerMonth / base.visitsMedian);
        m = band(monthlySpend / base.spendMedian);
        expectedVisits = round2(base.visitsMedian * months);
        expectedSpend = round2(base.spendMedian * months);
        baseSource = 'restaurant';
    } else {
        f = bandVisits(visitsPerMonth);
        m = bandSpend(monthlySpend);
        expectedVisits = round2(visitsPerMonth * months);
        expectedSpend = round2(monthlySpend * months);
        baseSource = 'guest';
    }

    // One or two orders are not a segment — they are a first impression.
    let segment;
    if (paid.length < 3) {
        segment = r >= 4 ? 'promising' : 'potential';
    } else if (r >= 4 && f >= 4) segment = 'champion';
    else if (r >= 3 && f >= 3) segment = 'loyal';
    else if (r >= 4 && f <= 2) segment = 'potential';
    else if (r >= 3 && f <= 2) segment = 'promising';
    else if (r <= 2 && f >= 4) segment = 'at-risk';
    else if (r <= 2 && f === 3) segment = 'attention';
    else segment = 'dormant';

    const lapsed = paid.length >= 3 && daysInactive > Math.max(expectedGapDays * 3, 60);
    if (lapsed) segment = 'lapsed';

    const risk = ['champion', 'loyal', 'potential', 'promising'].includes(segment) ? 'low'
        : segment === 'attention' ? 'medium' : 'high';

    return {
        segment,
        r, f, m,
        score: Math.round((r + f + m) / 3 * 100) / 100,
        daysInactive,
        expectedGapDays,
        ownGapDays: ownGap ? round2(ownGap) : null,
        expectedVisits,
        actualVisits: inWin.length,
        visitsPerMonth: round2(visitsPerMonth),
        expectedSpend,
        actualSpend,
        monthlySpend,
        windowDays,
        lapsed,
        risk,
        baseSource,
        baseCustomers: base ? base.customers : 0,
        note: '',
    };
}

/**
 * Marketing consent, mirroring bot/promotions.js hasPromoConsent EXACTLY:
 * the customer's own app switch wins both ways; without any signal the bot
 * treats the guest as NOT contactable, so "not set" means blocked.
 */
export function consentState(customer, app, optOut) {
    const offers = app && app.consent ? app.consent.offers : undefined;
    const legacy = typeof (customer && customer.promotionalConsent) === 'boolean'
        ? customer.promotionalConsent : undefined;
    if (optOut) {
        return { state: 'opted-out', label: 'Unsubscribed', tone: 'bad', detail: 'They sent STOP — promotional messages are blocked.', source: 'STOP' };
    }
    if (offers === false) {
        return { state: 'opted-out', label: 'Opted out', tone: 'bad', detail: 'Offers are switched off in the customer app.', source: 'Customer app' };
    }
    if (offers === true || legacy === true) {
        return {
            state: 'opted-in', label: 'Opted in', tone: 'ok',
            detail: 'Promotional messages are allowed.', source: offers === true ? 'Customer app' : 'Legacy flag',
        };
    }
    return {
        state: 'not-set', label: 'Not set', tone: 'warn',
        detail: 'No consent recorded — promotional messages stay blocked.', source: null,
    };
}

export function computeCompleteness(customer, app, consent) {
    const c = customer || {};
    const loc = c.location || {};
    const fields = [
        { key: 'name', label: 'Name', ok: !!String(c.name || (app && app.name) || '').trim() },
        { key: 'phone', label: 'Phone', ok: true },
        { key: 'address', label: 'Address', ok: !!String(c.address || '').trim() },
        { key: 'location', label: 'Map pin', ok: loc.lat != null && loc.lng != null },
        { key: 'app', label: 'App account', ok: !!app },
        { key: 'device', label: 'Device', ok: !!(app && app.platform) },
        { key: 'consent', label: 'Marketing consent', ok: consent.state !== 'not-set' },
    ];
    const filled = fields.filter((f) => f.ok).length;
    return { fields, filled, total: fields.length, pct: Math.round((filled / fields.length) * 100) };
}

// ------------------------------------------------------------------ profile

/**
 * Build the whole profile from raw rows. `calc` MUST carry the shared
 * helpers: { isBilledOrder, tierForPoints }.
 */
export function buildProfile(input, calc) {
    if (!calc || typeof calc.isBilledOrder !== 'function' || typeof calc.tierForPoints !== 'function') {
        throw new Error('customer-profile-view: calc { isBilledOrder, tierForPoints } is required');
    }
    const {
        phone: rawPhone,
        customer = null,
        orders = [],
        ranking = null,
        loyaltyConfig = null,
        adjustments = [],
        usageRows = [],
        chat = null,
        feedbacks = [],
        rewards = {},
        optOut = false,
        base = null,
        now = Date.now(),
    } = input || {};

    const phone = normalizePhone(rawPhone);
    const c = customer || {};
    const app = c.app || null;
    const myOrders = (Array.isArray(orders) ? orders : []).filter((o) => orderPhone(o) === phone);
    const paidOrders = myOrders.filter((o) => isPaidOrder(o, calc.isBilledOrder));

    const lifetime = computeLifetime(myOrders, now, calc.isBilledOrder);
    const rfm = computeRfm(myOrders, now, calc.isBilledOrder, { base });
    const channels = computeChannels(myOrders, calc.isBilledOrder);
    const favourites = computeFavourites(myOrders, calc.isBilledOrder);
    const rhythm = computeRhythm(myOrders, calc.isBilledOrder);
    const discounts = computeDiscounts(myOrders, usageRows, calc.isBilledOrder);
    const consent = consentState(c, app, optOut);
    const completeness = computeCompleteness(c, app, consent);

    const loy = c.loyalty || {};
    const tiers = (loyaltyConfig && loyaltyConfig.tiers) || null;
    const lifetimePoints = Number(loy.lifetimePoints != null ? loy.lifetimePoints : (ranking && ranking.lifetimePoints) || 0) || 0;
    const tier = tiers ? calc.tierForPoints(lifetimePoints, tiers) : String(loy.tier || (ranking && ranking.tier) || 'bronze');
    const tierLabel = (tiers && tiers[tier] && tiers[tier].label) || TIER_LABEL[tier] || tier;
    const points = Math.max(0, Number(loy.points) || 0);
    const redeemPaise = Number(loyaltyConfig && loyaltyConfig.redeemValuePaisePerPoint) || 100;

    let nextTier = null;
    if (tiers) {
        const curMin = Number(tiers[tier] && tiers[tier].min) || 0;
        const nextKey = TIER_ORDER.find((k) => Number(tiers[k] && tiers[k].min) > curMin);
        if (nextKey) {
            const nextMin = Number(tiers[nextKey].min) || 0;
            nextTier = {
                key: nextKey,
                label: tiers[nextKey].label || TIER_LABEL[nextKey] || nextKey,
                min: nextMin,
                needed: Math.max(0, nextMin - lifetimePoints),
                pct: nextMin > curMin ? Math.min(100, Math.max(0, Math.round(((lifetimePoints - curMin) / (nextMin - curMin)) * 100))) : 0,
            };
        }
    }

    const rewardList = Object.entries(rewards || {})
        .map(([id, r]) => ({ id, ...(r || {}) }))
        .filter((r) => r && typeof r === 'object')
        .sort((a, b) => (toTs(b.redeemedAt) || toTs(b.createdAt) || 0) - (toTs(a.redeemedAt) || toTs(a.createdAt) || 0));

    const adjustmentList = (Array.isArray(adjustments) ? adjustments : [])
        .filter((a) => normalizePhone(a && a.phone) === phone)
        .sort((a, b) => (toTs(b.createdAt) || 0) - (toTs(a.createdAt) || 0));

    const feedbackList = (Array.isArray(feedbacks) ? feedbacks : [])
        .filter((f) => normalizePhone(f && f.phone) === phone)
        .sort((a, b) => (toTs(b.timestamp) || 0) - (toTs(a.timestamp) || 0));

    const notesMap = c.notes && typeof c.notes === 'object' ? c.notes : {};
    const notes = Object.entries(notesMap)
        .map(([id, n]) => ({ id, ...(n || {}) }))
        .filter((n) => n && typeof n === 'object' && String(n.text || '').trim())
        .sort((a, b) => (toTs(b.at) || 0) - (toTs(a.at) || 0));
    const tags = Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string' && t.trim()) : [];

    const name = String(c.name || (app && app.name) || (chat && chat.name) || '').trim()
        || (c.customerName ? String(c.customerName).trim() : '')
        || 'Anonymous guest';

    return {
        phone,
        name,
        calc,
        customer: c,
        app,
        chat,
        ranking,
        orders: myOrders.slice().sort((a, b) => orderTs(b) - orderTs(a)),
        paidOrders,
        lifetime,
        rfm,
        channels,
        favourites,
        rhythm,
        discounts,
        consent,
        completeness,
        loyalty: {
            points,
            lifetimePoints,
            tier,
            tierLabel,
            nextTier,
            rank: ranking && ranking.rank != null ? ranking.rank : null,
            valueRs: round2((points * redeemPaise) / 100),
            redeemPaise,
            lastAdjustment: loy.lastAdjustment || null,
            lastOrderAt: loy.lastOrderAt || null,
            tierReachedAt: loy.tierReachedAt || null,
            adjustedTotal: adjustmentList.reduce((s, a) => s + (Number(a.delta) || 0), 0),
            adjustments: adjustmentList,
            rewards: rewardList,
        },
        discounts,
        notes,
        tags,
        feedbacks: feedbackList,
        now,
    };
}

// ------------------------------------------------------------------ markup

function chip(label, tone) {
    return `<span class="cp-chip cp-chip-${esc(tone)}">${esc(label)}</span>`;
}

function card(title, body, sub) {
    return `<section class="cp-card">
        <div class="cp-card-head"><h3 class="cp-card-title">${esc(title)}</h3>${sub ? `<span class="cp-card-sub">${esc(sub)}</span>` : ''}</div>
        <div class="cp-card-body">${body}</div>
    </section>`;
}

function emptyState(text) {
    return `<p class="cp-empty">${esc(text)}</p>`;
}

function scoreDots(score) {
    let out = '';
    for (let i = 1; i <= 5; i++) out += `<span class="cp-dot-score${i <= score ? ' is-on' : ''}"></span>`;
    return `<span class="cp-dots" aria-hidden="true">${out}</span>`;
}

export function renderHead(p) {
    const initials = (p.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    const tierTone = p.loyalty.tier === 'gold' ? 'gold' : p.loyalty.tier === 'silver' ? 'silver' : 'bronze';
    const phoneDigits = p.phone || '';
    const wa = phoneDigits ? `https://wa.me/91${phoneDigits}` : '';
    const memberSince = toTs(p.customer.registeredAt) || toTs(p.app && p.app.registeredAt);
    return `
    <div class="cp-head-main">
        <div class="cp-avatar" aria-hidden="true">${esc(initials)}</div>
        <div class="cp-head-id">
            <h2 class="cp-name" id="custProfName">${esc(p.name)}</h2>
            <div class="cp-sub">
                <span class="cp-phone">${esc(fmtPhone(phoneDigits))}</span>
                ${chip(p.loyalty.tierLabel, tierTone)}
                ${p.lifetime.paidCount ? chip(`${num(p.lifetime.paidCount)} paid orders`, 'neutral') : ''}
            </div>
            <div class="cp-sub cp-sub-dim">
                ${memberSince ? `Customer since ${esc(fmtDate(memberSince))}` : 'Join date unknown'}
                ${p.customer.lastSeen ? ` · Last seen ${esc(agoLabel(p.customer.lastSeen, p.now))}` : ''}
            </div>
        </div>
    </div>
    <div class="cp-head-actions">
        ${wa ? `<a class="cp-act" href="${esc(wa)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i><span>WhatsApp</span></a>` : ''}
        ${phoneDigits ? `<a class="cp-act" href="tel:+91${esc(phoneDigits)}"><i data-lucide="phone"></i><span>Call</span></a>` : ''}
        <button type="button" class="cp-act" data-cp="copy-phone"><i data-lucide="copy"></i><span>Copy</span></button>
    </div>`;
}

export function renderTabs(active) {
    return PROFILE_TABS.map((t) => {
        const on = t.key === active;
        return `<button type="button" class="cp-tab" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-cp-tab="${esc(t.key)}">${esc(t.label)}</button>`;
    }).join('');
}

function renderKpis(p) {
    const l = p.lifetime;
    const lo = p.loyalty;
    const inactive = l.daysInactive == null ? null
        : l.daysInactive === 0 ? 'today'
            : l.daysInactive === 1 ? 'yesterday'
                : `${num(l.daysInactive)} days ago`;
    const cards = [
        { n: num(l.paidCount), c: 'Paid orders', s: l.excludedCount ? `${num(l.excludedCount)} not paid` : null },
        { n: money(l.lifetimeSpend), c: 'Lifetime spend', s: 'Paid orders only' },
        { n: money(l.aov), c: 'Average order', s: null },
        { n: num(lo.points), c: 'Points to spend', s: lo.valueRs ? `${money(lo.valueRs)} value` : null },
        { n: l.lastVisitAt ? agoLabel(l.lastVisitAt, p.now).replace(' ago', '') : '—', c: 'Last visit', s: inactive },
        { n: num(p.discounts.ordersWith), c: 'Discounted orders', s: p.discounts.total ? `${money(p.discounts.total)} saved` : null },
    ];
    return `<div class="cp-kpis">${cards.map((c) => `<div class="cp-kpi">
        <span class="cp-kpi-num">${esc(c.n)}</span>
        <span class="cp-kpi-cap">${esc(c.c)}</span>
        ${c.s ? `<span class="cp-kpi-sub">${esc(c.s)}</span>` : ''}
    </div>`).join('')}</div>`;
}

function renderSegment(p) {
    const seg = RFM_SEGMENTS[p.rfm.segment] || RFM_SEGMENTS.new;
    const r = p.rfm;
    const expected = r.expectedGapDays ? `Usually visits every ~${r.expectedGapDays} days` : 'No visit rhythm yet';
    const yardstick = r.baseSource === 'restaurant'
        ? `compared with this outlet's median guest (${num(r.baseCustomers)} paying customers)`
        : 'compared with absolute visit and spend bands';
    const since = r.daysInactive == null ? '—'
        : r.daysInactive === 0 ? 'today'
            : r.daysInactive === 1 ? 'yesterday'
                : `${num(r.daysInactive)} days since last visit`;
    const windowRows = [
        ['Recency', r.r, since],
        ['Frequency', r.f, `${num(r.actualVisits)} visit${r.actualVisits === 1 ? '' : 's'} in ${num(r.windowDays)} days`],
        ['Monetary', r.m, `${money(r.actualSpend)} of an expected ${money(r.expectedSpend)}`],
    ];
    const body = `
    <div class="cp-seg-top">
        ${chip(seg.label, seg.tone)}
        <span class="cp-seg-score">${esc(String(r.score))}/5</span>
    </div>
    <p class="cp-seg-blurb">${esc(seg.blurb)}</p>
    <div class="cp-scores">${windowRows.map((row) => `<div class="cp-score-row">
        <span class="cp-score-name">${esc(row[0])}</span>
        ${scoreDots(row[1])}
        <span class="cp-score-note">${esc(row[2])}</span>
    </div>`).join('')}</div>
    <p class="cp-note-line">${esc(expected)} · Churn risk: <strong>${esc(r.risk)}</strong></p>
    <p class="cp-note-line">Frequency and spend ${esc(yardstick)}.</p>`;
    return card('Segment & churn', body, 'RFM');
}

function renderChannels(p) {
    if (!p.channels.length) return card('Where they order', emptyState('No paid orders yet.'));
    const bar = p.channels.map((c) => `<span class="cp-seg cp-seg-${esc(c.key.toLowerCase().replace(/[^a-z]+/g, '-'))}" style="width:${Math.max(3, c.pct)}%" title="${esc(c.key)} · ${num(c.pct)}%"></span>`).join('');
    const legend = p.channels.map((c) => `<div class="cp-legend-row">
        <span class="cp-legend-dot cp-seg-${esc(c.key.toLowerCase().replace(/[^a-z]+/g, '-'))}"></span>
        <span class="cp-legend-name">${esc(c.key)}</span>
        <span class="cp-legend-num">${num(c.count)} order${c.count === 1 ? '' : 's'}</span>
        <span class="cp-legend-val">${money(c.spend)}</span>
    </div>`).join('');
    return card('Where they order', `<div class="cp-mixbar">${bar}</div><div class="cp-legend">${legend}</div>`, `${num(p.channels.reduce((s, c) => s + c.count, 0))} paid orders`);
}

function renderFavourites(p) {
    if (!p.favourites.length) return card('Favourites', emptyState('No paid items yet.'));
    const body = `<ol class="cp-fav-list">${p.favourites.map((f) => `<li>
        <span class="cp-fav-name">${esc(f.name)}</span>
        ${f.sizes.length ? `<span class="cp-fav-size">${esc(f.sizes.join(' · '))}</span>` : ''}
        <span class="cp-fav-qty">${num(f.qty)}×</span>
        <span class="cp-fav-val">${money(f.spend)}</span>
    </li>`).join('')}</ol>`;
    return card('Favourites', body, `${num(p.favourites.length)} top item${p.favourites.length === 1 ? '' : 's'}`);
}

function renderRhythm(p) {
    const r = p.rhythm;
    if (!r.counted) return card('Visit rhythm', emptyState('No paid orders yet.'));
    const partRows = DAY_PARTS.filter((k) => r.parts[k] > 0).map((k) => `<div class="cp-legend-row">
        <span class="cp-legend-name">${esc(k)}</span>
        <span class="cp-bar"><span class="cp-bar-fill" style="width:${Math.max(4, Math.round((r.parts[k] / r.counted) * 100))}%"></span></span>
        <span class="cp-legend-num">${num(r.parts[k])}</span>
    </div>`).join('');
    const dayRows = WEEKDAYS.filter((k) => r.days[k] > 0).sort((a, b) => r.days[b] - r.days[a]).slice(0, 3).map((k) => `<span class="cp-mini-chip">${esc(k)} · ${num(r.days[k])}</span>`).join('');
    const body = `
    <div class="cp-rhythm-head">
        <div><span class="cp-rhythm-cap">Most often</span><span class="cp-rhythm-val">${esc(r.preferredPart || '—')}</span></div>
        <div><span class="cp-rhythm-cap">Favourite day</span><span class="cp-rhythm-val">${esc(r.preferredDay || '—')}</span></div>
    </div>
    <div class="cp-legend">${partRows}</div>
    <div class="cp-mini-chips">${dayRows}</div>`;
    return card('Visit rhythm', body, 'Times in IST');
}

function renderConsent(p) {
    const c = p.consent;
    const body = `<div class="cp-consent">
        ${chip(c.label, c.tone)}
        <span class="cp-consent-detail">${esc(c.detail)}</span>
        ${c.source ? `<span class="cp-consent-src">via ${esc(c.source)}</span>` : ''}
    </div>`;
    return card('Marketing consent', body);
}

function renderCompleteness(p) {
    const c = p.completeness;
    const body = `<div class="cp-fields">${c.fields.map((f) => `<span class="cp-field${f.ok ? ' is-ok' : ''}">
        <i data-lucide="${f.ok ? 'check' : 'minus'}"></i>${esc(f.label)}
    </span>`).join('')}</div>
    <p class="cp-note-line">${c.filled} of ${c.total} details on file (${c.pct}%).</p>`;
    return card('Details on file', body, `${c.pct}% complete`);
}

function renderActivity(p) {
    const chat = p.chat;
    const fb = p.feedbacks;
    const chatBody = chat
        ? `<div class="cp-chat">
            <div class="cp-chat-top">${chat.lastDir === 'customer' ? chip('From customer', 'neutral') : chip('From us', 'neutral')}${Number(chat.unread) > 0 ? chip(`${num(chat.unread)} unread`, 'warn') : ''}</div>
            <p class="cp-chat-text">${esc(chat.lastText || '—')}</p>
            <p class="cp-note-line">${esc(agoLabel(chat.lastTs, p.now))}</p>
        </div>`
        : emptyState('No WhatsApp conversation.');
    const fbBody = fb.length
        ? `<ul class="cp-fb-list">${fb.map((f) => `<li>
            <span class="cp-fb-stars">${'★'.repeat(Math.max(0, Math.min(5, Number(f.rating) || 0)))}${'☆'.repeat(Math.max(0, 5 - (Number(f.rating) || 0)))}</span>
            <span class="cp-fb-text">${esc(f.comment || f.reason || '—')}</span>
            <span class="cp-fb-when">${esc(fmtDate(f.timestamp))}</span>
        </li>`).join('')}</ul>`
        : emptyState('No ratings left.');
    return card('Recent conversation', chatBody) + card('Ratings & feedback', fbBody, fb.length ? `${fb.length}` : null);
}

function renderOverview(p) {
    return [
        renderKpis(p),
        '<div class="cp-grid">',
        renderSegment(p),
        renderChannels(p),
        renderFavourites(p),
        renderRhythm(p),
        renderConsent(p),
        renderCompleteness(p),
        '</div>',
        renderActivity(p),
    ].join('');
}

function renderOrders(p) {
    if (!p.orders.length) return emptyState('No orders recorded for this customer.');
    const rows = p.orders.map((o) => {
        const meta = statusMeta(o.status);
        const paid = isPaidOrder(o, p.calc.isBilledOrder);
        const items = itemsOf(o);
        const summary = items.map((it) => {
            const q = Number(it.qty || it.quantity || 1) || 0;
            const size = it.size && it.size !== 'Default' ? ` (${it.size})` : '';
            const addon = it.addon && it.addon !== 'None' && it.addon !== '' ? ` + ${it.addon}` : '';
            return `${q > 1 ? q + ' × ' : ''}${it.name || 'Item'}${size}${addon}`;
        }).join(' · ');
        const tender = o.loyaltyTender && Number(o.loyaltyTender.amount) > 0
            ? ` · −${money(o.loyaltyTender.amount)} points` : '';
        const due = o.totalDue != null ? ` · Payable ${money(o.totalDue)}` : '';
        const disc = Number(o.discount) > 0 ? ` · −${money(o.discount)} discount` : '';
        return `<button type="button" class="cp-order${paid ? '' : ' is-unpaid'}" data-cp-order="${esc(o.orderId || '')}">
            <div class="cp-order-top">
                <span class="cp-order-id">${esc(o.orderId || 'Order')}</span>
                ${chip(meta.label, meta.tone)}
                <span class="cp-order-total">${money(o.total)}</span>
            </div>
            <div class="cp-order-when">${esc(fmtDateTime(o.createdAt))} · ${esc(channelOf(o))}</div>
            ${summary ? `<div class="cp-order-items">${esc(summary)}</div>` : ''}
            <div class="cp-order-money">${esc(`Subtotal ${money(o.subtotal != null ? o.subtotal : o.total)}${disc}${tender}${due}`)}</div>
        </button>`;
    }).join('');
    const paid = p.lifetime.paidCount;
    return `<div class="cp-order-list">${rows}</div>
        <p class="cp-note-line">${num(paid)} of ${num(p.lifetime.totalOrders)} orders were paid${p.lifetime.excludedCount ? ` · ${num(p.lifetime.excludedCount)} cancelled, refunded or unpaid are excluded from spend` : ''}.</p>`;
}

function renderLoyalty(p) {
    const lo = p.loyalty;
    const next = lo.nextTier;
    const tierBody = `
    <div class="cp-loyalty-top">
        <div><span class="cp-loyalty-cap">Points to spend</span><span class="cp-loyalty-num">${num(lo.points)}</span><span class="cp-loyalty-sub">${money(lo.valueRs)} at ${money(lo.redeemPaise / 100)} a point</span></div>
        <div><span class="cp-loyalty-cap">Lifetime points</span><span class="cp-loyalty-num">${num(lo.lifetimePoints)}</span><span class="cp-loyalty-sub">${esc(lo.tierLabel)}${lo.rank != null ? ` · rank #${num(lo.rank)}` : ''}</span></div>
    </div>
    ${next ? `<div class="cp-tier-progress">
        <div class="cp-tier-bar"><span class="cp-tier-fill" style="width:${next.pct}%"></span></div>
        <p class="cp-note-line">${num(next.needed)} more lifetime points to reach ${esc(next.label)}.</p>
    </div>` : '<p class="cp-note-line">Top tier reached.</p>'}
    ${lo.lastAdjustment ? `<p class="cp-note-line">Last adjustment ${Number(lo.lastAdjustment.delta) > 0 ? '+' : ''}${num(lo.lastAdjustment.delta)} points — ${esc(lo.lastAdjustment.reason || 'no reason given')}</p>` : ''}`;
    const adj = lo.adjustments.length
        ? `<ul class="cp-list">${lo.adjustments.map((a) => `<li>
            <span class="cp-list-delta${Number(a.delta) >= 0 ? ' is-plus' : ' is-minus'}">${Number(a.delta) > 0 ? '+' : ''}${num(a.delta)}</span>
            <span class="cp-list-main">${esc(a.reason || '—')}</span>
            <span class="cp-list-when">${esc(fmtDate(a.createdAt))}</span>
        </li>`).join('')}</ul>`
        : emptyState('No manual point adjustments.');
    const rew = lo.rewards.length
        ? `<ul class="cp-list">${lo.rewards.map((r) => `<li>
            <span class="cp-list-main">${esc(r.label || r.rewardId || 'Reward')}</span>
            <span class="cp-list-sub">${num(r.cost)} pts</span>
            <span class="cp-list-when">${esc(r.redeemedAt ? fmtDate(r.redeemedAt) : fmtDate(r.createdAt))}</span>
        </li>`).join('')}</ul>`
        : emptyState('No rewards redeemed.');
    return card('Points & tier', tierBody, lo.tierLabel)
        + card('Manual adjustments', adj, lo.adjustedTotal ? `Net ${num(lo.adjustedTotal)}` : null)
        + card('Rewards redeemed', rew, `${num(lo.rewards.length)}`);
}

function renderDiscounts(p) {
    const d = p.discounts;
    const head = `<div class="cp-loyalty-top">
        <div><span class="cp-loyalty-cap">Total saved</span><span class="cp-loyalty-num">${money(d.total)}</span><span class="cp-loyalty-sub">across ${num(d.ordersWith)} paid order${d.ordersWith === 1 ? '' : 's'}</span></div>
        <div><span class="cp-loyalty-cap">Of spend</span><span class="cp-loyalty-num">${num(d.reliancePct)}%</span><span class="cp-loyalty-sub">${money(d.gross)} before discount</span></div>
    </div>`;
    const offers = d.byOffer.length
        ? `<ul class="cp-list">${d.byOffer.map((o) => `<li>
            <span class="cp-list-main">${esc(o.label)}</span>
            <span class="cp-list-sub">${num(o.count)} use${o.count === 1 ? '' : 's'}</span>
            <span class="cp-list-val">${money(o.amount)}</span>
        </li>`).join('')}</ul>`
        : emptyState('No coupon or offer usage recorded.');
    const usage = (p.usageRows || []).length
        ? `<ul class="cp-list">${p.usageRows.map((u) => `<li>
            <span class="cp-list-main">${esc(u.discountLabel || u.discountId || 'Offer')}</span>
            <span class="cp-list-sub">${esc(u.orderId || '')}</span>
            <span class="cp-list-val">${money(u.amountGiven)}</span>
        </li>`).join('')}</ul>`
        : emptyState('No usage rows.');
    return card('Discount reliance', head, `${num(d.offers)} offer${d.offers === 1 ? '' : 's'}`)
        + card('Offers used', offers)
        + card('Usage history', usage);
}

function renderNotes(p) {
    const tagChips = p.tags.length
        ? p.tags.map((t) => `<span class="cp-tag">${esc(t)}<button type="button" class="cp-tag-x" data-cp-tag-remove="${esc(t)}" aria-label="Remove tag ${esc(t)}"><i data-lucide="x"></i></button></span>`).join('')
        : '<span class="cp-empty-inline">No tags yet.</span>';
    const notes = p.notes.length
        ? `<ul class="cp-note-list">${p.notes.map((n) => `<li>
            <p class="cp-note-text">${esc(n.text)}</p>
            <p class="cp-note-meta">${esc(n.byName || n.by || 'Staff')} · ${esc(fmtDateTime(n.at))}
                <button type="button" class="cp-note-del" data-cp-note-del="${esc(n.id)}" aria-label="Delete this note"><i data-lucide="trash-2"></i></button>
            </p>
        </li>`).join('')}</ul>`
        : emptyState('No notes yet. Notes are private to your team.');
    const form = `<form class="cp-note-form" data-cp-note-form>
        <label class="cp-label" for="cpNoteText">Add a note</label>
        <textarea id="cpNoteText" class="cp-textarea" rows="3" maxlength="500" placeholder="Allergies, preferences, anything the team should know…"></textarea>
        <div class="cp-note-form-foot">
            <span class="cp-note-hint">Private to staff · max 500 characters</span>
            <button type="submit" class="cp-btn cp-btn-primary">Save note</button>
        </div>
    </form>`;
    const tagForm = `<form class="cp-tag-form" data-cp-tag-form>
        <label class="cp-label" for="cpTagInput">Tags</label>
        <div class="cp-tag-row">
            <input id="cpTagInput" class="cp-input" type="text" maxlength="24" placeholder="VIP, Jain, Regular…" autocomplete="off">
            <button type="submit" class="cp-btn cp-btn-ghost">Add</button>
        </div>
        <div class="cp-tags">${tagChips}</div>
    </form>`;
    return card('Tags', tagForm) + card('Notes', form + notes, p.notes.length ? `${p.notes.length}` : null);
}

/** The body of the active tab. */
export function renderBody(p, tab) {
    switch (tab) {
        case 'orders': return renderOrders(p);
        case 'loyalty': return renderLoyalty(p);
        case 'discounts': return renderDiscounts(p);
        case 'notes': return renderNotes(p);
        default: return renderOverview(p);
    }
}

// --------------------------------------------------------------------- CSS

export const CUSTOMER_PROFILE_CSS = `
.cp-drawer{background:linear-gradient(180deg,#f7f8fb 0%,#ffffff 22%);}
.cp-shell{display:flex;flex-direction:column;flex:1;min-height:0;}
.cp-close{position:absolute;top:14px;right:16px;z-index:3;width:36px;height:36px;border-radius:11px;border:1px solid rgba(20,26,34,.12);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#4e5968;}
.cp-close:hover{border-color:#e84908;color:#e84908;}
.cp-close svg{width:17px;height:17px;}
.cp-loading{padding:40px 20px;text-align:center;color:#8a95a3;font-size:13.5px;}
.cp-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:18px 64px 14px 22px;background:rgba(255,255,255,.82);border-bottom:1px solid rgba(20,26,34,.08);}
.cp-head-main{display:flex;gap:14px;align-items:center;min-width:0;flex:1 1 320px;}
.cp-avatar{width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#fff;background:linear-gradient(135deg,#e84908,#b83806);flex:none;}
.cp-head-id{min-width:0;}
.cp-name{margin:0;font-size:20px;font-weight:700;color:#141a22;line-height:1.25;overflow-wrap:anywhere;}
.cp-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:13px;color:#4e5968;}
.cp-sub-dim{color:#7a8798;font-size:12px;}
.cp-phone{font-weight:600;color:#2b3442;}
.cp-head-actions{display:flex;gap:8px;flex-wrap:wrap;}
.cp-act{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:12px;border:1px solid rgba(20,26,34,.12);background:#fff;color:#2b3442;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;min-height:40px;}
.cp-act:hover{border-color:#e84908;color:#e84908;}
.cp-act svg{width:15px;height:15px;}
.cp-tabs{display:flex;gap:4px;padding:10px 22px;background:rgba(255,255,255,.82);border-bottom:1px solid rgba(20,26,34,.08);overflow-x:auto;scrollbar-width:none;}
.cp-tabs::-webkit-scrollbar{display:none;}
.cp-tab{flex:none;padding:9px 15px;border-radius:12px;border:0;background:transparent;color:#4e5968;font-size:13.5px;font-weight:600;cursor:pointer;min-height:40px;}
.cp-tab:hover{background:rgba(20,26,34,.05);color:#141a22;}
.cp-tab[aria-selected="true"]{background:#fff;color:#141a22;box-shadow:0 2px 10px rgba(52,44,120,.14);}
.cp-body{flex:1;min-height:0;overflow-y:auto;padding:18px 22px 40px;-webkit-overflow-scrolling:touch;}
.cp-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:16px;}
.cp-kpi{padding:13px 14px;border-radius:16px;background:rgba(255,255,255,.76);border:1px solid rgba(20,26,34,.06);min-width:0;}
.cp-kpi-num{display:block;font-size:19px;font-weight:750;color:#141a22;line-height:1.2;overflow-wrap:anywhere;}
.cp-kpi-cap{display:block;margin-top:3px;font-size:11.5px;color:#5b6775;letter-spacing:.01em;}
.cp-kpi-sub{display:block;margin-top:2px;font-size:11px;color:#8a95a3;}
.cp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;}
.cp-card{padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.82);border:1px solid rgba(20,26,34,.06);margin-bottom:14px;}
.cp-grid .cp-card{margin-bottom:0;}
.cp-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;}
.cp-card-title{margin:0;font-size:14px;font-weight:700;color:#141a22;}
.cp-card-sub{font-size:11.5px;color:#8a95a3;}
.cp-empty{margin:0;color:#8a95a3;font-size:13px;}
.cp-empty-inline{font-size:12.5px;color:#8a95a3;}
.cp-note-line{margin:8px 0 0;font-size:12px;color:#6b7686;}
.cp-chip{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:650;letter-spacing:.02em;background:#eef1f5;color:#48525f;white-space:nowrap;}
.cp-chip-ok{background:#e3f4ea;color:#146c43;}
.cp-chip-good{background:#e4eefb;color:#1b4f9c;}
.cp-chip-warn{background:#fdf0d8;color:#8a5a00;}
.cp-chip-bad{background:#fde8e6;color:#a5231b;}
.cp-chip-neutral{background:#eef1f5;color:#48525f;}
.cp-chip-bronze{background:#f8eadf;color:#8f5324;}
.cp-chip-silver{background:#e8ecf2;color:#46515f;}
.cp-chip-gold{background:#fbf0c8;color:#7d5a00;}
.cp-seg-top{display:flex;align-items:center;gap:10px;}
.cp-seg-score{margin-left:auto;font-size:12px;color:#8a95a3;font-weight:600;}
.cp-seg-blurb{margin:8px 0 12px;font-size:13px;color:#4e5968;}
.cp-scores{display:flex;flex-direction:column;gap:8px;}
.cp-score-row{display:grid;grid-template-columns:78px auto 1fr;gap:10px;align-items:center;font-size:12px;color:#5b6775;}
.cp-score-name{font-weight:600;color:#38424f;}
.cp-dots{display:inline-flex;gap:3px;}
.cp-dot-score{width:8px;height:8px;border-radius:50%;background:#dfe4ea;}
.cp-dot-score.is-on{background:#e84908;}
.cp-score-note{text-align:right;}
.cp-mixbar{display:flex;height:12px;border-radius:999px;overflow:hidden;background:#eef1f5;margin-bottom:12px;}
.cp-seg{display:block;height:100%;}
.cp-seg-qr-menu{background:#e84908;}
.cp-seg-whatsapp{background:#1f9d63;}
.cp-seg-customer-app{background:#3b6fd4;}
.cp-seg-counter{background:#7a5af5;}
.cp-seg-other{background:#9aa5b1;}
.cp-legend{display:flex;flex-direction:column;gap:7px;}
.cp-legend-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:9px;align-items:center;font-size:12.5px;color:#4e5968;}
.cp-legend-dot{width:9px;height:9px;border-radius:50%;}
.cp-legend-name{color:#38424f;font-weight:600;}
.cp-legend-num{color:#7a8798;}
.cp-legend-val{font-weight:650;color:#141a22;}
.cp-bar{height:8px;border-radius:999px;background:#eef1f5;overflow:hidden;min-width:40px;}
.cp-bar-fill{display:block;height:100%;background:#e84908;border-radius:999px;}
.cp-fav-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}
.cp-fav-list li{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;font-size:13px;}
.cp-fav-name{font-weight:600;color:#2b3442;overflow-wrap:anywhere;}
.cp-fav-size{grid-column:1;font-size:11px;color:#8a95a3;}
.cp-fav-qty{font-weight:700;color:#e84908;}
.cp-fav-val{color:#141a22;font-weight:600;}
.cp-rhythm-head{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
.cp-rhythm-cap{display:block;font-size:11px;color:#8a95a3;}
.cp-rhythm-val{display:block;font-size:15px;font-weight:700;color:#141a22;margin-top:2px;}
.cp-mini-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}
.cp-mini-chip{padding:3px 9px;border-radius:999px;background:#f2f4f7;color:#4e5968;font-size:11.5px;}
.cp-consent{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.cp-consent-detail{font-size:12.5px;color:#4e5968;flex:1 1 200px;}
.cp-consent-src{font-size:11.5px;color:#8a95a3;}
.cp-fields{display:flex;flex-wrap:wrap;gap:7px;}
.cp-field{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;background:#f2f4f7;color:#8a95a3;font-size:12px;}
.cp-field.is-ok{background:#e3f4ea;color:#146c43;}
.cp-field svg{width:12px;height:12px;}
.cp-chat-top{display:flex;gap:7px;margin-bottom:7px;}
.cp-chat-text{margin:0;font-size:13px;color:#2b3442;}
.cp-fb-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;}
.cp-fb-list li{display:flex;flex-direction:column;gap:2px;}
.cp-fb-stars{color:#e0a500;font-size:12px;letter-spacing:1px;}
.cp-fb-text{font-size:13px;color:#2b3442;}
.cp-fb-when{font-size:11px;color:#8a95a3;}
.cp-order-list{display:flex;flex-direction:column;gap:9px;}
.cp-order{display:block;width:100%;text-align:left;padding:12px 14px;border-radius:15px;border:1px solid rgba(20,26,34,.08);background:#fff;cursor:pointer;font:inherit;color:inherit;}
.cp-order:hover{border-color:#e84908;box-shadow:0 4px 14px rgba(232,73,8,.10);}
.cp-order.is-unpaid{background:#fafbfc;}
.cp-order-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.cp-order-id{font-weight:700;font-size:13.5px;color:#141a22;}
.cp-order-total{margin-left:auto;font-weight:750;color:#141a22;}
.cp-order-when{margin-top:3px;font-size:11.5px;color:#8a95a3;}
.cp-order-items{margin-top:6px;font-size:12.5px;color:#4e5968;}
.cp-order-money{margin-top:4px;font-size:11.5px;color:#7a8798;}
.cp-loyalty-top{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.cp-loyalty-cap{display:block;font-size:11px;color:#8a95a3;}
.cp-loyalty-num{display:block;font-size:24px;font-weight:750;color:#141a22;line-height:1.15;}
.cp-loyalty-sub{display:block;font-size:11.5px;color:#7a8798;margin-top:2px;}
.cp-tier-progress{margin-top:14px;}
.cp-tier-bar{height:9px;border-radius:999px;background:#eef1f5;overflow:hidden;}
.cp-tier-fill{display:block;height:100%;background:linear-gradient(90deg,#e84908,#f2a33c);border-radius:999px;}
.cp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;}
.cp-list li{display:grid;grid-template-columns:auto 1fr auto auto;gap:9px;align-items:center;font-size:13px;}
.cp-list-delta{font-weight:750;color:#146c43;}
.cp-list-delta.is-minus{color:#a5231b;}
.cp-list-main{color:#2b3442;font-weight:600;overflow-wrap:anywhere;}
.cp-list-sub{font-size:11.5px;color:#8a95a3;}
.cp-list-val{font-weight:650;color:#141a22;}
.cp-list-when{font-size:11px;color:#8a95a3;}
.cp-note-form{margin-bottom:14px;}
.cp-label{display:block;font-size:12px;font-weight:600;color:#4e5968;margin-bottom:6px;}
.cp-textarea{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(20,26,34,.14);font:inherit;font-size:13.5px;resize:vertical;background:#fff;color:#141a22;}
.cp-textarea:focus{outline:2px solid rgba(232,73,8,.35);outline-offset:1px;border-color:#e84908;}
.cp-note-form-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;flex-wrap:wrap;}
.cp-note-hint{font-size:11px;color:#8a95a3;}
.cp-btn{padding:8px 15px;border-radius:11px;font-size:13px;font-weight:650;cursor:pointer;border:1px solid transparent;min-height:38px;}
.cp-btn-primary{background:#e84908;color:#fff;}
.cp-btn-primary:hover{background:#c83f05;}
.cp-btn-ghost{background:#fff;border-color:rgba(20,26,34,.14);color:#2b3442;}
.cp-btn-ghost:hover{border-color:#e84908;color:#e84908;}
.cp-tag-form{margin-bottom:4px;}
.cp-tag-row{display:flex;gap:8px;}
.cp-input{flex:1;min-width:0;padding:8px 12px;border-radius:11px;border:1px solid rgba(20,26,34,.14);font:inherit;font-size:13.5px;}
.cp-input:focus{outline:2px solid rgba(232,73,8,.35);outline-offset:1px;border-color:#e84908;}
.cp-tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;}
.cp-tag{display:inline-flex;align-items:center;gap:5px;padding:4px 6px 4px 11px;border-radius:999px;background:#eef1f5;color:#38424f;font-size:12px;font-weight:600;}
.cp-tag-x{border:0;background:transparent;padding:2px;cursor:pointer;color:#7a8798;display:inline-flex;}
.cp-tag-x:hover{color:#a5231b;}
.cp-tag-x svg{width:12px;height:12px;}
.cp-note-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;}
.cp-note-list li{padding:10px 12px;border-radius:13px;background:#f7f8fa;}
.cp-note-text{margin:0;font-size:13px;color:#2b3442;white-space:pre-wrap;overflow-wrap:anywhere;}
.cp-note-meta{margin:5px 0 0;font-size:11px;color:#8a95a3;display:flex;align-items:center;gap:6px;}
.cp-note-del{margin-left:auto;border:0;background:transparent;color:#9aa5b1;cursor:pointer;padding:3px;display:inline-flex;border-radius:7px;}
.cp-note-del:hover{color:#a5231b;background:#fde8e6;}
.cp-note-del svg{width:13px;height:13px;}
@media (max-width:900px){
  .cp-kpis{grid-template-columns:repeat(3,minmax(0,1fr));}
  .cp-grid{grid-template-columns:minmax(0,1fr);}
}
@media (max-width:560px){
  .cp-head{padding:14px 54px 12px 14px;gap:10px;}
  .cp-tabs{padding:8px 14px;}
  .cp-body{padding:14px 14px 34px;}
  .cp-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;}
  .cp-kpi{padding:11px 12px;}
  .cp-kpi-num{font-size:17px;}
  .cp-card{padding:14px 14px;border-radius:16px;}
  .cp-score-row{grid-template-columns:66px auto 1fr;gap:8px;font-size:11.5px;}
  .cp-score-note{text-align:left;}
  .cp-head-actions{width:100%;}
  .cp-act{flex:1 1 auto;justify-content:center;}
  .cp-act span{display:none;}
  .cp-act svg{width:17px;height:17px;}
  .cp-list li{grid-template-columns:auto 1fr auto;}
  .cp-list-when{display:none;}
}
`;
