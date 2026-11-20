// ============================================================================
// CUSTOMER DATABASE — PURE VIEW LAYER
//
// The Customers tab used to be a spreadsheet: one search box, six columns and a
// sum of EVERY order ever placed (cancelled, refunded and walkout included),
// while the Customer Profile beside it showed only the money actually paid.
// The same guest could therefore show two different "Value" figures.
//
// This module is the fix. It is PURE (no Firebase, no DOM, no clock of its
// own - `now` is injected) so node can exercise it straight from the source
// tree, and it reuses the Customer Profile's maths so the list and the profile
// can never disagree again:
//
//   paid basis -> isPaidOrder (shared/cost-math.js isBilledOrder + payment
//                 status + terminal status; a walkout is eaten-but-unpaid)
//   segments   -> computeRfm against the guest's OWN rhythm and the outlet's
//                 own base (computeBase)
//   next step  -> nextBestAction (the same line the profile shows)
//   consent    -> consentState (mirrors bot/promotions.js hasPromoConsent)
//
// What it adds on top of the profile: the orientation a LIST needs - KPI
// tiles, segment + audience filters, a searchable blob, duplicate detection
// and a pager.
//
// NOTE: this module imports ONLY from ./customer-profile-view.js (same folder,
// pure). It must never import ../../shared/* — that path only resolves inside
// the built dist, which would make the module un-importable from node.
// ============================================================================

import {
    normalizePhone, toTs, num, money, esc, agoLabel,
    isPaidOrder, computeRfm, computeBase, computeLifetime, computeChannels,
    computeFavourites, computeDiscounts, consentState, nextBestAction,
} from './customer-profile-view.js';

const DAY = 86400000;

// ------------------------------------------------------------------ helpers

function orderTs(o) {
    return toTs(o && o.createdAt) ?? toTs(o && o.timestamp) ?? 0;
}

function orderPhone(o) {
    return normalizePhone((o && (o.customerPhone || o.phone)) || '');
}

/** A comparison key for "is this the same person / the same address?". */
function dupKey(s, minLen) {
    const k = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return k.length >= minLen ? k : '';
}

function percentile(values, p) {
    const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!s.length) return 0;
    const idx = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)));
    return s[idx];
}

// ------------------------------------------------------------------- filters

/**
 * SEGMENT chips — single select. Every guest lands in at least one of them:
 * a guest with no paid orders is "No orders yet", one with a single order is
 * "One-time", and everyone else is scored by RFM.
 */
export const SEGMENT_CHIPS = [
    { key: 'all', label: 'All guests', tone: 'neutral', match: () => true },
    {
        key: 'champions', label: 'Champions', tone: 'gold',
        match: (r) => r.rfm.segment === 'champion' || r.rfm.segment === 'loyal',
    },
    {
        key: 'promising', label: 'Promising', tone: 'good',
        match: (r) => r.rfm.segment === 'promising' || r.rfm.segment === 'potential',
    },
    {
        key: 'at-risk', label: 'At risk', tone: 'warn',
        match: (r) => ['at-risk', 'attention', 'dormant'].includes(r.rfm.segment),
    },
    {
        key: 'lapsed', label: 'Lapsed', tone: 'bad',
        match: (r) => r.rfm.lapsed === true,
    },
    {
        key: 'new', label: 'No orders yet', tone: 'neutral',
        match: (r) => r.lifetime.paidCount === 0,
    },
    {
        key: 'one-time', label: 'One-time', tone: 'neutral',
        match: (r) => r.lifetime.paidCount === 1,
    },
];

/**
 * AUDIENCE chips — multi select, AND-combined with the segment. These are the
 * behavioural rules a restaurant CRM is built on ("who spends above the
 * average", "who has not come back", "who may we message").
 */
export const AUDIENCE_CHIPS = [
    { key: 'top-spenders', label: 'Top spenders', tone: 'gold' },
    { key: 'frequent', label: 'Frequent', tone: 'blue' },
    { key: 'discount-reliant', label: 'Discount-reliant', tone: 'amber' },
    { key: 'promo-reachable', label: 'Promo-reachable', tone: 'green' },
    { key: 'active-30d', label: 'Active 30d', tone: 'neutral' },
    { key: 'new-30d', label: 'New 30d', tone: 'neutral' },
];

export function matchSegment(row, key) {
    const chip = SEGMENT_CHIPS.find((c) => c.key === key) || SEGMENT_CHIPS[0];
    return !!chip.match(row);
}

/**
 * @param thresholds { hasBase, spendMedian, visitsMedian, spendCut, visitCut }
 *   When the outlet has fewer than three paying customers there is no base to
 *   compare against, so absolute bands are used instead (top quartile of the
 *   guests' own spend, two visits a month).
 */
export function matchAudience(row, key, thresholds = {}) {
    switch (key) {
        case 'top-spenders':
            return thresholds.hasBase
                ? row.rfm.monthlySpend > (Number(thresholds.spendMedian) || 0)
                : row.lifetime.lifetimeSpend >= (Number(thresholds.spendCut) || 0);
        case 'frequent':
            return thresholds.hasBase
                ? row.rfm.visitsPerMonth > (Number(thresholds.visitsMedian) || 0)
                : row.rfm.visitsPerMonth >= (Number(thresholds.visitCut) || 2);
        case 'discount-reliant':
            return row.discounts.reliancePct >= 30;
        case 'promo-reachable':
            return row.consent.state === 'opted-in';
        case 'active-30d':
            return row.lifetime.paidCount > 0 && row.lifetime.daysInactive !== null
                && row.lifetime.daysInactive <= 30;
        case 'new-30d':
            return !!row.joinedTs && (row.now - row.joinedTs) <= 30 * DAY;
        default:
            return true;
    }
}

// --------------------------------------------------------------------- rows

/**
 * Build one row per customer record.
 *
 * @param input { customers:[{phone,data}], orders:[], rankings:{},
 *                optOutPhones:[], loyaltyConfig, now, storeName }
 * @param calc  { isBilledOrder, tierForPoints } — the shared helpers, injected
 *               so this module never keeps a private copy of the maths.
 */
export function buildCustomerRows(input, calc) {
    if (!calc || typeof calc.isBilledOrder !== 'function') {
        throw new Error('customers-view: calc.isBilledOrder is required');
    }
    const {
        customers = [], orders = [], rankings = {}, optOutPhones = [],
        loyaltyConfig = null, now = Date.now(), storeName = '',
    } = input || {};

    const optOut = new Set((optOutPhones || []).map((p) => normalizePhone(p)).filter(Boolean));

    // One pass over the orders, grouped by the phone that placed them.
    const byPhone = new Map();
    for (const o of (orders || [])) {
        if (!o) continue;
        const ph = orderPhone(o);
        if (!ph) continue;
        let e = byPhone.get(ph);
        if (!e) { e = { all: [], paid: [] }; byPhone.set(ph, e); }
        e.all.push(o);
        if (isPaidOrder(o, calc.isBilledOrder)) e.paid.push(o);
    }

    const base = computeBase(orders, now, calc.isBilledOrder);
    const tiers = (loyaltyConfig && loyaltyConfig.tiers) || null;

    const rows = [];
    for (const entry of (customers || [])) {
        const phone = normalizePhone(entry && entry.phone);
        if (!phone) continue;
        const c = (entry && entry.data) || {};
        const app = c.app || null;
        const bucket = byPhone.get(phone) || { all: [], paid: [] };

        const lifetime = computeLifetime(bucket.all, now, calc.isBilledOrder);
        const rfm = computeRfm(bucket.all, now, calc.isBilledOrder, { base });
        const channels = computeChannels(bucket.all, calc.isBilledOrder);
        const favourites = computeFavourites(bucket.all, calc.isBilledOrder, 3);
        const discounts = computeDiscounts(bucket.all, [], calc.isBilledOrder);
        const consent = consentState(c, app, optOut.has(phone));

        const ranking = (rankings && rankings[phone]) || null;
        const loy = c.loyalty || {};
        const lifetimePoints = Number(
            loy.lifetimePoints != null ? loy.lifetimePoints : (ranking && ranking.lifetimePoints) || 0,
        ) || 0;
        const tier = tiers && typeof calc.tierForPoints === 'function'
            ? calc.tierForPoints(lifetimePoints, tiers)
            : String(loy.tier || (ranking && ranking.tier) || 'bronze');
        const points = Math.max(0, Number(loy.points) || 0);

        const name = String(c.name || (app && app.name) || '').trim() || 'Anonymous guest';
        const joinedTs = toTs(c.registeredAt) || toTs(app && app.registeredAt) || null;

        const lastPaid = bucket.paid.slice().sort((a, b) => orderTs(b) - orderTs(a))[0] || null;
        const topChannel = channels[0] || null;

        const action = nextBestAction({
            rfm, name, storeName,
            lifetime: { paidCount: lifetime.paidCount },
            loyalty: { rank: ranking && ranking.rank != null ? ranking.rank : null },
        });

        const row = {
            phone,
            name,
            displayPhone: phone,
            joinedTs,
            joined: joinedTs ? new Date(joinedTs).toLocaleDateString('en-IN') : 'Unknown',
            address: c.address || '',
            locationLink: c.locationLink || '',
            email: String(c.email || (app && app.email) || ''),
            orderCount: lifetime.paidCount,
            orderTotal: lifetime.totalOrders,
            lifetime,
            ltv: lifetime.lifetimeSpend,
            aov: lifetime.aov,
            lastVisitTs: lifetime.lastVisitAt,
            lastVisit: lifetime.lastVisitAt ? agoLabel(lifetime.lastVisitAt, now) : 'Never',
            firstVisitTs: lifetime.firstVisitAt,
            daysInactive: lifetime.daysInactive,
            channel: topChannel ? topChannel.key : null,
            channelCount: topChannel ? topChannel.count : 0,
            favourite: favourites[0] ? favourites[0].name : '',
            favourites,
            rfm,
            discounts,
            channels,
            consent,
            action,
            loyalty: {
                tier,
                points,
                lifetimePoints,
                rank: ranking && ranking.rank != null ? ranking.rank : null,
            },
            lastOrderId: lastPaid ? String(lastPaid._id || lastPaid.orderId || '') : '',
            now,
        };

        // The search blob: everything a staff member might type to find this
        // guest (name, number, address, the dish they order, the order id, the
        // segment they sit in).
        row.searchBlob = [
            row.name, row.phone, row.address, row.email, row.favourite,
            row.lastOrderId, row.action.title, row.action.segment,
            rfm.segment, consent.label,
            ...favourites.map((f) => f.name),
        ].filter(Boolean).join(' ').toLowerCase();

        rows.push(row);
    }

    // Possible duplicates: the SAME NAME on two phone numbers. A shared
    // ADDRESS alone is NOT a duplicate - family members, an office and every
    // walk-in of one restaurant share an address, so flagging on it would
    // badge every row (and say nothing). The address only sharpens the badge
    // when the name already matches.
    const byName = new Map();
    for (const r of rows) {
        const nk = dupKey(r.name, 3);
        if (!nk) continue;
        if (!byName.has(nk)) byName.set(nk, []);
        byName.get(nk).push(r);
    }
    for (const [key, group] of byName) {
        if (group.length < 2) continue;
        const addrs = new Set(group.map((r) => dupKey(r.address, 8)));
        const onlyAddr = [...addrs][0] || '';
        const sameAddr = addrs.size === 1 && onlyAddr !== '';
        for (const r of group) {
            r.duplicate = { kind: sameAddr ? 'both' : 'name', count: group.length, key };
        }
    }

    const thresholds = {
        hasBase: base.customers >= 3 && base.visitsMedian > 0 && base.spendMedian > 0,
        spendMedian: base.spendMedian,
        visitsMedian: base.visitsMedian,
        spendCut: percentile(rows.map((r) => r.ltv), 0.75),
        visitCut: 2,
    };

    return { rows, base, thresholds };
}

// ------------------------------------------------------------------ filters

/** Apply the segment, the audience chips and the search term. */
export function filterRows(rows, state = {}) {
    const { segment = 'all', audiences = [], term = '' } = state;
    const thresholds = state.thresholds || {};
    const t = String(term || '').trim().toLowerCase();
    return rows.filter((r) => {
        if (!matchSegment(r, segment)) return false;
        for (const a of audiences || []) {
            if (!matchAudience(r, a, thresholds)) return false;
        }
        if (t && !r.searchBlob.includes(t)) return false;
        return true;
    });
}

/** Sort a copy of the rows. Unknown fields leave the order untouched. */
export function sortRows(rows, field, dir) {
    const list = [...(rows || [])];
    if (!field) return list;
    const dirMul = dir === 'asc' ? 1 : -1;
    const val = (r) => {
        switch (field) {
            case 'name': return String(r.name || '').toLowerCase();
            case 'displayPhone': return r.phone || '';
            case 'address': return String(r.address || '').toLowerCase();
            case 'lastVisit': return r.lastVisitTs || 0;
            case 'orderCount': return Number(r.orderCount || 0);
            case 'ltv': return Number(r.ltv || 0);
            case 'loyaltyPoints': return Number(r.loyalty.lifetimePoints || 0);
            case 'segment': return String(r.rfm.segment || '');
            default: return null;
        }
    };
    list.sort((a, b) => {
        const x = val(a); const y = val(b);
        if (x === null || y === null) return 0;
        if (x === y) return 0;
        return (x > y ? 1 : -1) * dirMul;
    });
    return list;
}

/** The six orientation tiles. Each one is also a filter. */
export function computeKpiTiles(rows, thresholds = {}) {
    const count = (fn) => rows.filter(fn).length;
    return [
        { key: 'guests', label: 'Guests', value: rows.length, tone: 'neutral' },
        { key: 'active30', label: 'Active 30d', tone: 'green', value: count((r) => matchAudience(r, 'active-30d', thresholds)) },
        { key: 'atrisk', label: 'At risk', tone: 'amber', value: count((r) => matchSegment(r, 'at-risk')) },
        { key: 'lapsed', label: 'Lapsed', tone: 'red', value: count((r) => matchSegment(r, 'lapsed')) },
        { key: 'champions', label: 'Champions', tone: 'blue', value: count((r) => matchSegment(r, 'champions')) },
        { key: 'new30', label: 'New 30d', tone: 'neutral', value: count((r) => matchAudience(r, 'new-30d', thresholds)) },
    ];
}

/** Counts for every chip, measured over the SEARCH-matched guests. */
export function computeChipCounts(rows, thresholds = {}) {
    const segments = {};
    for (const chip of SEGMENT_CHIPS) {
        segments[chip.key] = rows.filter((r) => chip.match(r)).length;
    }
    const audiences = {};
    for (const chip of AUDIENCE_CHIPS) {
        audiences[chip.key] = rows.filter((r) => matchAudience(r, chip.key, thresholds)).length;
    }
    return { segments, audiences };
}

// ------------------------------------------------------------------- markup

const REACH = {
    'opted-in': { label: 'Promo OK', tone: 'ok' },
    'opted-out': { label: 'Opted out', tone: 'bad' },
    'not-set': { label: 'No consent', tone: 'warn' },
};

function pill(label, tone) {
    return `<span class="cust-pill cust-pill-${esc(tone || 'neutral')}">${esc(label)}</span>`;
}

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/**
 * The phone list-control bar.
 *
 * The column headers used to become a scrolling strip of sort CHIPS on a
 * phone: it wrapped to two rows, truncated mid-word ("Last…", "Orde…"),
 * scrolled sideways and - being sticky INSIDE the table - floated over the
 * first card. On a phone a header row is the wrong shape for a header.
 *
 * So the phone gets ONE purpose-built control row instead:
 *   [ Select all ]  [ Sort ▾ (native picker) ]  [ Filters (n) ▾ ]
 * The sort is a native <select> (the OS picker, full keyboard support, one
 * option per field AND direction), and the filter chips move into a sheet
 * that only opens when it is asked for.
 */
export const SORT_OPTIONS = [
    { value: 'name:asc', field: 'name', dir: 'asc', label: 'Customer A-Z' },
    { value: 'name:desc', field: 'name', dir: 'desc', label: 'Customer Z-A' },
    { value: 'lastVisit:desc', field: 'lastVisit', dir: 'desc', label: 'Newest visit' },
    { value: 'lastVisit:asc', field: 'lastVisit', dir: 'asc', label: 'Oldest visit' },
    { value: 'orderCount:desc', field: 'orderCount', dir: 'desc', label: 'Most orders' },
    { value: 'orderCount:asc', field: 'orderCount', dir: 'asc', label: 'Fewest orders' },
    { value: 'ltv:desc', field: 'ltv', dir: 'desc', label: 'High value' },
    { value: 'ltv:asc', field: 'ltv', dir: 'asc', label: 'Low value' },
    { value: 'loyaltyPoints:desc', field: 'loyaltyPoints', dir: 'desc', label: 'Most points' },
    { value: 'loyaltyPoints:asc', field: 'loyaltyPoints', dir: 'asc', label: 'Fewest points' },
    { value: 'segment:asc', field: 'segment', dir: 'asc', label: 'Segment A-Z' },
    { value: 'segment:desc', field: 'segment', dir: 'desc', label: 'Segment Z-A' },
    { value: 'displayPhone:asc', field: 'displayPhone', dir: 'asc', label: 'Phone A-Z' },
    { value: 'displayPhone:desc', field: 'displayPhone', dir: 'desc', label: 'Phone Z-A' },
    { value: 'address:asc', field: 'address', dir: 'asc', label: 'Address A-Z' },
    { value: 'address:desc', field: 'address', dir: 'desc', label: 'Address Z-A' },
];

/** The phone control row: select-all, the sort picker and the filter button. */
export function renderListBar(state = {}) {
    const {
        sortField = 'ltv', sortDir = 'desc', segment = 'all', audiences = [],
    } = state;
    const active = (segment && segment !== 'all' ? 1 : 0) + (audiences || []).length;
    const opts = SORT_OPTIONS.map((o) => `<option value="${esc(o.value)}"${o.field === sortField && o.dir === sortDir ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    return `
        <div class="cust-listbar-inner">
            <label class="cust-lb-all">
                <input type="checkbox" id="custSelectAllMobile" aria-label="Select the guests shown on this page" title="Select the guests shown on this page">
                <span class="cust-lb-all-text"><span class="cust-lb-all-full">Select all</span><span class="cust-lb-all-short">All</span></span>
            </label>
            <label class="cust-lb-sort">
                <select id="custSortSelect" aria-label="Sort the guests">${opts}</select>
                <i data-lucide="chevron-down" class="cust-lb-chevron" aria-hidden="true"></i>
            </label>
            <button type="button" id="custFiltersBtn" class="cust-lb-btn" aria-expanded="false" aria-controls="custFilters">
                <span>Filters</span>${active ? `<span class="cust-lb-badge">${esc(String(active))}</span>` : ''}
            </button>
        </div>`;
}

export function renderKpis(tiles, active) {
    return tiles.map((t) => `
        <button type="button" class="cust-kpi" data-cust-kpi="${esc(t.key)}"
            aria-pressed="${active && active.kpi === t.key ? 'true' : 'false'}"
            title="${esc(t.label)} — filter the list">
            <span class="cust-kpi-val">${esc(num(t.value))}</span>
            <span class="cust-kpi-label">${esc(t.label)}</span>
        </button>`).join('');
}

export function renderFilters(counts, state = {}) {
    const segment = state.segment || 'all';
    const audiences = new Set(state.audiences || []);
    const matching = Number(state.matching || 0);
    const segChips = SEGMENT_CHIPS.map((chip) => `
        <button type="button" class="cust-chip" data-cust-segment="${esc(chip.key)}"
            aria-pressed="${segment === chip.key ? 'true' : 'false'}">${esc(chip.label)}
            <span class="cust-chip-count">${esc(num(counts.segments[chip.key] || 0))}</span></button>`).join('');
    const audChips = AUDIENCE_CHIPS.map((chip) => `
        <button type="button" class="cust-chip" data-cust-audience="${esc(chip.key)}"
            aria-pressed="${audiences.has(chip.key) ? 'true' : 'false'}">${esc(chip.label)}
            <span class="cust-chip-count">${esc(num(counts.audiences[chip.key] || 0))}</span></button>`).join('');
    // The sheet chrome is MOBILE only (the desktop shows the chip rows inline).
    return `
        <div class="cust-sheet-head">
            <span class="cust-sheet-title">Filters</span>
            <button type="button" class="cust-sheet-close" data-cust-filters-close aria-label="Close the filters">
                <i data-lucide="x" class="icon-18" aria-hidden="true"></i>
            </button>
        </div>
        <div class="cust-filter-row">
            <span class="cust-filter-label">Segment</span>
            <div class="cust-chips" role="group" aria-label="Filter by segment">${segChips}</div>
        </div>
        <div class="cust-filter-row">
            <span class="cust-filter-label">Audience</span>
            <div class="cust-chips" role="group" aria-label="Filter by audience">${audChips}</div>
        </div>
        <div class="cust-sheet-foot">
            <button type="button" class="cust-tool-btn" data-cust-filters-clear>Clear all</button>
            <button type="button" class="btn-primary cust-sheet-apply" data-cust-filters-close>Show ${esc(num(matching))} guest${matching === 1 ? '' : 's'}</button>
        </div>`;
}

/** One table row. The header in index.html must have the same 10 columns. */
export function renderRow(r, opts = {}) {
    const phone = r.phone || '';
    const canOpen = /^\d{10}$/.test(phone);
    const selected = !!opts.selected && canOpen;
    const sel = `<td class="cust-col-sel">
        <input type="checkbox" class="cust-sel-box" data-cust-select="${esc(phone)}"
            ${selected ? 'checked' : ''} ${canOpen ? '' : 'disabled'}
            aria-label="Select ${esc(r.name || 'guest')}${canOpen ? '' : ' (no usable phone number)'}">
    </td>`;
    const waLink = canOpen
        ? `<a href="https://wa.me/91${esc(phone)}" target="_blank" rel="noopener" class="mob-wa-link"><i data-lucide="message-circle" style="width:12px;height:12px;"></i> ${esc(r.displayPhone)}</a>`
        : `<span class="mob-td-sub">${esc(r.displayPhone || '—')}</span>`;
    // The address cell is narrow, so show the LOCALITY (the part before the
    // first comma) rather than a mid-word cut; the tooltip carries the rest.
    let addr = String(r.address || '').trim();
    if (!addr) addr = 'Counter sale / guest';
    else if (addr.length > 22) {
        const locality = addr.split(',')[0].trim();
        addr = locality.length >= 5 ? locality : addr.substring(0, 22) + '…';
    }
    const mapLink = r.locationLink
        ? ` <a href="${esc(r.locationLink)}" target="_blank" rel="noopener" class="mob-map-link">MAP</a>`
        : '';
    const dup = r.duplicate
        ? `<span class="cust-dup" title="${r.duplicate.count} customer records share the name “${esc(r.name)}”${r.duplicate.kind === 'both' ? ' and the same address' : ''}. Open one and check before you merge anything.">Possible duplicate</span>`
        : '';
    const reach = REACH[r.consent.state] || REACH['not-set'];
    const tierLabel = r.loyalty.tier.charAt(0).toUpperCase() + r.loyalty.tier.slice(1);
    // On a phone the table becomes a stack of CARDS, and the card has to carry
    // the facts the folded columns would have shown: the last visit, the paid
    // order count and the loyalty tier. One line, straight under the name.
    const mobMeta = `<div class="cust-mob-meta"><span class="cust-last-mobile">Last visit ${esc(r.lastVisit)}</span> · ${esc(num(r.orderCount))} orders · ${esc(tierLabel)}</div>`;
    const rowProfile = canOpen ? ` data-cust-profile="${esc(phone)}" title="Open the full customer profile"` : '';
    return `<tr class="cp-row${selected ? ' cust-row-selected' : ''}"${rowProfile}>
        ${sel}
        <td class="cust-col-cust">
            <div class="mob-cust-name">
                <span class="mob-cust-avatar" aria-hidden="true">${esc(initialsOf(r.name))}</span>
                <div class="cust-cust-id">
                    <div class="mob-td-strong"><button type="button" class="btn-text mob-td-strong" data-cust-profile="${esc(phone)}" title="Open the full customer profile">${esc(r.name)}</button></div>
                    <div class="mob-td-sub cust-joined">Joined ${esc(r.joined)}${dup ? ' · ' + dup : ''}</div>
                    ${mobMeta}
                </div>
                ${canOpen ? '<i data-lucide="chevron-right" class="mob-row-go" aria-hidden="true"></i>' : ''}
            </div>
        </td>
        <td class="cust-col-phone"><div class="cust-phone-line">${waLink}${canOpen ? `<button type="button" class="mob-reset-lock" data-reset-lock="${esc(phone)}" title="Use when the customer lost or changed their phone: the next phone to open the app with this number becomes the owner.">Reset phone lock</button>` : ''}</div></td>
        <td class="cust-col-addr"><span class="mob-addr-text" title="${esc(r.address)}">${esc(addr)}</span>${mapLink}</td>
        <td class="cust-col-last">
            <span class="cust-last">${esc(r.lastVisit)}</span>
            ${r.channel ? `<div class="mob-td-sub">${esc(r.channel)}</div>` : ''}
        </td>
        <td class="mob-th-center cust-col-orders"><span class="mob-order-count">${esc(num(r.orderCount))}</span><div class="mob-td-sub">paid</div></td>
        <td class="mob-th-right cust-col-value"><span class="mob-td-total">${esc(money(r.ltv))}</span></td>
        <td class="mob-th-center cust-col-loyalty">${pill(tierLabel, r.loyalty.tier === 'gold' ? 'gold' : r.loyalty.tier === 'silver' ? 'neutral' : 'bronze')}<div class="mob-td-sub" title="${esc(num(r.loyalty.points))} points to spend${r.loyalty.lifetimePoints ? ` · ${esc(num(r.loyalty.lifetimePoints))} lifetime points` : ''}">${esc(num(r.loyalty.points))} pts</div></td>
        <td class="cust-col-segment">${pill(r.action.segment, r.action.tone)}<div class="cust-reach cust-reach-${esc(reach.tone)}" title="${esc(r.consent.detail || '')}">${esc(reach.label)}</div></td>
        <td class="cust-col-action"><span class="cust-action cust-action-${esc(r.action.tone)}" title="${esc(r.action.title + (r.action.sub ? ' — ' + r.action.sub : ''))}">${esc(r.action.short || r.action.title)}</span></td>
    </tr>`;
}

/** The skeleton rows shown while the database loads (Carbon: rows, not a spinner). */
export function renderSkeleton(rows = 6) {
    let out = '';
    for (let i = 0; i < rows; i++) {
        out += `<tr class="cust-skel-row"><td colspan="10">
            <span class="cust-skel" style="width:${28 + (i % 3) * 9}%"></span>
            <span class="cust-skel cust-skel-sm" style="width:${14 + (i % 4) * 7}%"></span>
        </td></tr>`;
    }
    return out;
}

/** The empty states: an empty database and an empty filter result. */
export function renderEmpty(kind, ctx = {}) {
    if (kind === 'empty-db') {
        return `<tr><td colspan="10" class="cust-empty">
            <p class="cust-empty-title">No customer records yet</p>
            <p class="cust-empty-sub">A guest appears here as soon as they order through the QR menu, the customer app or WhatsApp. Share your Customer App link or print a table QR to get started.</p>
        </td></tr>`;
    }
    const suggestion = ctx.suggestion
        ? ` Try <strong>${esc(ctx.suggestion.label)}</strong> (${esc(num(ctx.suggestion.count))}) instead.`
        : '';
    const what = ctx.term ? ` matching “${esc(ctx.term)}”` : '';
    return `<tr><td colspan="10" class="cust-empty">
        <p class="cust-empty-title">No guest${esc(what)}</p>
        <p class="cust-empty-sub">Nothing in the customer database matches this filter.${suggestion}</p>
        <button type="button" class="cust-tool-btn" data-cust-clear="1">Clear filters</button>
    </td></tr>`;
}

/** The pager: "Showing 50 of 248" + a load-more button. */
export function renderPager(shown, total, limit) {
    if (!total) return '';
    const more = total - shown;
    return `
        <span class="cust-pager-text">Showing ${esc(num(shown))} of ${esc(num(total))} guest${total === 1 ? '' : 's'}</span>
        ${more > 0 ? `<button type="button" class="cust-tool-btn" id="custLoadMore">Load ${esc(num(Math.min(limit, more)))} more</button>` : ''}`;
}

/**
 * The contextual action bar. It appears the moment a guest is selected and
 * stays put while the table scrolls - "what now?" must be one glance, not a
 * hunt (bulk-action UX: the bar belongs next to the selection).
 *
 * The reach counts are honest UPPER BOUNDS computed from the same rules the
 * server and the bot enforce (notify-eligibility.js).
 */
export function renderBatchBar(s = {}) {
    const {
        selected = 0, matching = 0, pushReach = 0, waReach = 0,
        allMatchingSelected = false, canSelectAll = false,
    } = s;
    if (!selected) return '';
    const allLine = allMatchingSelected
        ? `<span class="cust-batch-all-note">All ${esc(num(matching))} matching guest${matching === 1 ? '' : 's'} selected</span>`
        : (canSelectAll
            ? `<button type="button" class="cust-batch-all-btn" data-cust-select-all-matching title="Select all ${esc(num(matching))} matching guest${matching === 1 ? '' : 's'}">Select all ${esc(num(matching))}<span class="cust-phone-hide"> matching guest${matching === 1 ? '' : 's'}</span></button>`
            : '');
    return `
        <div class="cust-batch-bar" role="region" aria-label="Actions for the selected guests">
            <div class="cust-batch-left">
                <span class="cust-batch-count" role="status" aria-live="polite">${esc(num(selected))} guest${selected === 1 ? '' : 's'} selected</span>
                <span class="cust-batch-matching cust-phone-hide">${esc(num(matching))} matching</span>
                ${allLine}
            </div>
            <div class="cust-batch-reach">
                <span title="Guests with an app device and offers on">Up to ${esc(num(pushReach))} can get a push</span>
                <span title="Guests who opted in, are not opted out, and the outlet can send to">Up to ${esc(num(waReach))} can get WhatsApp</span>
            </div>
            <div class="cust-batch-actions">
                <button type="button" class="btn-primary cust-batch-btn" data-cust-notify="push" title="Send an app notification to the selected guests"><span class="cust-phone-hide">Send app notification</span><span class="cust-phone-only">App push</span></button>
                <button type="button" class="btn-secondary cust-batch-btn" data-cust-notify="wa" title="Send a WhatsApp message to the selected guests"><span class="cust-phone-hide">Send WhatsApp message</span><span class="cust-phone-only">WhatsApp</span></button>
                <button type="button" class="cust-tool-btn" data-cust-clear-selection title="Clear the selection">Clear<span class="cust-phone-hide"> selection</span></button>
            </div>
        </div>`;
}

// ---------------------------------------------------------------------- CSS

export const CUSTOMER_DASHBOARD_CSS = `
#tab-customers .cust-kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
    margin: 4px 18px 14px;
}
#tab-customers .cust-kpi {
    appearance: none;
    border: 1px solid var(--mob-border);
    background: #fff;
    border-radius: 12px;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 58px;
    transition: border-color .15s ease, background-color .15s ease;
}
#tab-customers .cust-kpi:hover { border-color: #cbd5e1; background: var(--mob-bg); }
#tab-customers .cust-kpi:focus-visible { outline: 2px solid var(--mob-blue); outline-offset: 2px; }
#tab-customers .cust-kpi[aria-pressed="true"] { background: var(--mob-ink); border-color: var(--mob-ink); }
#tab-customers .cust-kpi[aria-pressed="true"] .cust-kpi-val,
#tab-customers .cust-kpi[aria-pressed="true"] .cust-kpi-label { color: #fff; }
#tab-customers .cust-kpi-val { font-size: 22px; font-weight: 900; color: var(--mob-ink); line-height: 1.1; letter-spacing: -0.02em; }
#tab-customers .cust-kpi-label { font-size: 12px; font-weight: 700; color: var(--mob-sub); }

#tab-customers .cust-filters { margin: 0 18px 14px; display: flex; flex-direction: column; gap: 8px; }
/* The list-control bar and the filter SHEET are PHONE-only. On a desktop the
   column headers sort the table and the chips sit inline, so both are hidden
   there (the phone rules below turn them on). */
#tab-customers .cust-toolbar { display: flex; gap: 8px; align-items: center; margin-left: auto; }
#tab-customers .cust-listbar,
#tab-customers .cust-sheet-head,
#tab-customers .cust-sheet-foot,
#tab-customers .cust-filters-scrim { display: none; }
/* The short phone labels for the action bar ("App push" / "WhatsApp"). */
#tab-customers .cust-phone-only { display: none; }
#tab-customers .cust-filter-row { display: flex; align-items: flex-start; gap: 10px; }
#tab-customers .cust-filter-label { font-size: 11.5px; font-weight: 800; color: var(--mob-sub); padding-top: 6px; min-width: 58px; }
#tab-customers .cust-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#tab-customers .cust-chip {
    appearance: none;
    flex: 0 0 auto;
    white-space: nowrap;
    border: 1px solid var(--mob-border);
    background: #fff;
    color: var(--mob-ink);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
#tab-customers .cust-chip:hover { background: var(--mob-bg); border-color: #cbd5e1; }
#tab-customers .cust-chip:focus-visible { outline: 2px solid var(--mob-blue); outline-offset: 2px; }
#tab-customers .cust-chip[aria-pressed="true"] { background: var(--mob-ink); border-color: var(--mob-ink); color: #fff; }
#tab-customers .cust-chip-count { font-size: 11px; font-weight: 800; opacity: .72; }

#tab-customers .cust-pill {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
}
#tab-customers .cust-pill-ok, #tab-customers .cust-pill-good { background: var(--mob-green-light); color: var(--mob-green); }
#tab-customers .cust-pill-warn, #tab-customers .cust-pill-amber { background: var(--mob-amber-light); color: #b45309; }
#tab-customers .cust-pill-bad, #tab-customers .cust-pill-red { background: var(--mob-red-light); color: var(--mob-red); }
#tab-customers .cust-pill-blue { background: var(--mob-blue-light); color: var(--mob-blue); }
#tab-customers .cust-pill-gold { background: #fef3c7; color: #92610a; }
#tab-customers .cust-pill-bronze { background: #f3e8df; color: #92610a; }
#tab-customers .cust-pill-neutral { background: var(--mob-bg); color: var(--mob-sub); }

#tab-customers .cust-reach { font-size: 11px; font-weight: 700; margin-top: 3px; }
#tab-customers .cust-reach-ok { color: var(--mob-green); }
#tab-customers .cust-reach-warn { color: #b45309; }
#tab-customers .cust-reach-bad { color: var(--mob-red); }
#tab-customers .cust-action { font-size: 12px; font-weight: 700; color: var(--mob-ink); display: inline-block; max-width: 190px; }
/* "Reset phone lock" is a repair link, not a button - it must not eat a
   44px tap target in the middle of a dense table row. */
#tab-customers .mob-reset-lock {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    margin: 3px 0 0;
    min-height: 0;
    min-width: 0;
    border-radius: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--mob-sub);
    text-decoration: underline;
    cursor: pointer;
    white-space: nowrap;
}
#tab-customers .mob-reset-lock:hover { color: var(--mob-blue); }
#tab-customers .cust-action-warn { color: #b45309; }
#tab-customers .cust-action-bad { color: var(--mob-red); }
#tab-customers .cust-action-ok { color: var(--mob-green); }
#tab-customers .cust-action-good { color: var(--mob-blue); }
#tab-customers .cust-last { font-size: 13px; font-weight: 700; color: var(--mob-ink); }
#tab-customers .cust-dup { color: #b45309; font-weight: 800; }
#tab-customers .cust-cust-id { min-width: 0; }
/* The phone line (WhatsApp link + the repair link) stacks on a desktop row and
   runs as ONE line on a phone card. */
#tab-customers .cust-phone-line { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
/* The phone card's summary line - only ever shown on a phone. */
#tab-customers .cust-mob-meta { display: none; }

#tab-customers .cust-tool-btn {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--mob-border);
    background: #fff;
    color: var(--mob-ink);
    border-radius: 10px;
    padding: 7px 11px;
    font-size: 12.5px;
    font-weight: 800;
    cursor: pointer;
    transition: background-color .15s ease, border-color .15s ease;
}
#tab-customers .cust-tool-btn:hover { background: var(--mob-bg); }
#tab-customers .cust-tool-btn:focus-visible { outline: 2px solid var(--mob-blue); outline-offset: 2px; }
#tab-customers .cust-tool-btn[aria-pressed="true"] { background: var(--mob-ink); border-color: var(--mob-ink); color: #fff; }

#tab-customers .cust-pager { display: flex; align-items: center; gap: 12px; padding: 12px 18px 4px; flex-wrap: wrap; }
#tab-customers .cust-pager-text { font-size: 12.5px; font-weight: 700; color: var(--mob-sub); }

/* ---- selection column + contextual batch bar (notification checklist) ---- */
#tab-customers .cust-col-sel { width: 34px; min-width: 34px; text-align: center; padding-left: 10px !important; padding-right: 6px !important; }
#tab-customers .cust-sel-box {
    width: 18px; height: 18px; min-width: 18px; min-height: 18px;
    accent-color: var(--mob-ink); cursor: pointer; margin: 0; vertical-align: middle;
}
#tab-customers .cust-sel-box:focus-visible { outline: 2px solid var(--mob-blue); outline-offset: 2px; }
#tab-customers .cust-sel-box:disabled { cursor: not-allowed; opacity: .35; }
#tab-customers tr.cust-row-selected .cust-col-cust { background: #f8fafc; }
#tab-customers .cust-batch-bar {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    margin: 0 18px 12px; padding: 10px 12px;
    background: var(--mob-ink); color: #fff; border-radius: 12px;
    position: sticky; top: 0; z-index: 6;
}
#tab-customers .cust-batch-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#tab-customers .cust-batch-count { font-size: 13px; font-weight: 800; }
#tab-customers .cust-batch-matching { font-size: 12px; opacity: .72; }
#tab-customers .cust-batch-all-btn {
    appearance: none; border: 0; background: none; padding: 0;
    color: #fff; font-size: 12px; font-weight: 800; text-decoration: underline;
    cursor: pointer; min-height: 0;
}
#tab-customers .cust-batch-all-note { font-size: 12px; opacity: .72; }
#tab-customers .cust-batch-reach { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; opacity: .82; }
#tab-customers .cust-batch-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
#tab-customers .cust-batch-btn { min-height: 38px; font-size: 12.5px; font-weight: 800; border-radius: 10px; }
#tab-customers .cust-batch-actions .cust-tool-btn { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.3); color: #fff; }
#tab-customers .cust-batch-actions .cust-tool-btn:hover { background: rgba(255,255,255,.2); }
#tab-customers .cust-batch-actions .btn-secondary { background: #fff; color: var(--mob-ink); }
#tab-customers .cust-batch-actions .btn-primary { background: var(--mob-blue); color: #fff; }

#tab-customers .cust-empty { text-align: center; padding: 34px 18px; white-space: normal; }
#tab-customers .cust-empty-title { font-size: 15px; font-weight: 800; color: var(--mob-ink); margin: 0 0 6px; }
#tab-customers .cust-empty-sub { font-size: 13px; color: var(--mob-sub); margin: 0 0 12px; line-height: 1.5; }

#tab-customers .cust-skel { display: block; height: 10px; border-radius: 5px; background: #e8edf3; margin-bottom: 6px; animation: cust-skel-pulse 1.2s ease-in-out infinite; }
#tab-customers .cust-skel-sm { height: 8px; width: 30%; }
@keyframes cust-skel-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { #tab-customers .cust-skel { animation: none; } }

/* The nine columns are FIXED, so the table never grows past the card and the
   Loyalty / Segment / Next-step columns stay visible on a laptop. */
#tab-customers .mob-data-table { min-width: 1040px; table-layout: fixed; width: 100%; }
#tab-customers .mob-data-table thead th,
#tab-customers .mob-data-table tbody td { padding-left: 12px; padding-right: 12px; }
#tab-customers .mob-data-table tbody td { font-size: 13px; overflow: hidden; }
#tab-customers .cust-col-cust { width: 22%; }
#tab-customers .cust-col-phone { width: 11%; }
#tab-customers .cust-col-addr { width: 9%; }
#tab-customers .cust-col-last { width: 8%; }
#tab-customers .cust-col-orders { width: 6%; }
#tab-customers .cust-col-value { width: 10%; }
#tab-customers .cust-col-loyalty { width: 9%; }
#tab-customers .cust-col-segment { width: 9%; }
#tab-customers .cust-col-action { width: 12%; }
#tab-customers .cust-cust-id { min-width: 0; flex: 1; overflow: hidden; }
#tab-customers .cust-cust-id .mob-td-strong,
#tab-customers .cust-cust-id .cust-joined { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tab-customers .cust-cust-id .mob-td-strong button { display: block; width: 100%; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
#tab-customers .mob-addr-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tab-customers .cust-action { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tab-customers .cust-reach { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tab-customers .mob-td-strong { font-size: 13.5px; }
#tab-customers .mob-cust-avatar { font-weight: 800; color: var(--mob-sub); }
/* On a phone the Last visit column folds away and the same fact moves under
   the customer name, so nothing is lost. */
#tab-customers .cust-last-mobile { display: none; }

#tab-customers.cust-dense .mob-data-table thead th { padding: 7px 10px; }
#tab-customers.cust-dense .mob-data-table tbody td { padding: 5px 10px; font-size: 12.5px; }
#tab-customers.cust-dense .mob-cust-avatar { width: 24px; height: 24px; font-size: 11px; }
#tab-customers.cust-dense .mob-td-sub, #tab-customers.cust-dense .cust-joined { display: none; }
#tab-customers.cust-dense .cust-pill { padding: 2px 6px; font-size: 10px; }
#tab-customers.cust-dense .cust-action { font-size: 11.5px; }

/* A laptop (the 220px sidebar leaves ~900px of card) cannot show nine
   columns without clipping the customer name, so the Address column folds
   away first - it is in the profile and on the row's MAP link anyway. */
@media (max-width: 1400px) {
    #tab-customers .cust-col-addr { display: none; }
    #tab-customers .mob-data-table { min-width: 900px; }
    #tab-customers .cust-col-cust { width: 26%; }
    #tab-customers .cust-col-value { width: 12%; }
}

/* ============================================================================
   Customers tab — MOBILE REDESIGN
   The Customers table was a spreadsheet: on a phone the value, the segment and
   the next step all fell off the right edge, the phone number was clipped and
   the contextual action bar was unreachable behind the bottom nav.

   On a phone the table becomes a stack of CARDS:
     - every fact is on the card, nothing scrolls sideways
     - the card is the tap target for the Customer Profile
     - the column headers are GONE: a phone gets ONE control row
       ([ Select all ] [ Sort ] [ Filters ]) instead of a header strip
     - the filter chips live in a SHEET that opens on demand, so two rows of
       chips do not sit above the list
     - the contextual action bar pins to the BOTTOM, above the nav
   ========================================================================= */

@media (max-width: 768px) {

    /* --- the card around the list becomes a flex column, so the contextual
       action bar can sit UNDER the list (where a thumb reaches it). --- */
    #tab-customers .mob-table-card {
        display: flex;
        flex-direction: column;
        padding: 12px 0;
    }
    /* The width is NOT forced to 100%: these children carry their own
       horizontal margins, and a forced width made them overflow the card by
       12px on the right (the KPI tiles and the list were cut off). */
    #tab-customers .mob-table-card > * { flex: none; width: auto; }
    #tab-customers .mob-section-head-row { order: 1; padding: 0 12px; }
    #tab-customers #custKpis { order: 2; }
    #tab-customers #custListBar { order: 3; }
    #tab-customers #custFilters { order: 4; }
    #tab-customers .mob-table-scroll { order: 5; }
    #tab-customers #custPager { order: 6; }
    #tab-customers #custBatchBar { order: 7; }

    /* --- the toolbar: the search on its own line, the tools on ONE row. --- */
    #tab-customers .mob-section-head-row { flex-wrap: wrap; gap: 8px; }
    #tab-customers .mob-section-head-row > h3 { order: 0; flex: 1 0 100%; min-width: 0; }
    #tab-customers .cust-toolbar { display: contents; margin-left: 0; }
    #tab-customers #customerSearch { order: 1; flex: 1 1 0; min-width: 100px; max-width: none !important; min-height: 44px; }
    #tab-customers #custDensityBtn { order: 2; min-height: 44px; min-width: 44px; padding: 8px 10px; }
    #tab-customers .cust-toolbar .mob-export-row { order: 2; margin: 0; flex: 0 0 auto; gap: 6px; }
    #tab-customers .cust-toolbar .mob-export-banner {
        flex: 0 0 auto; padding: 8px 12px; font-size: 12.5px;
        border-radius: 10px; box-shadow: none;
        min-width: 44px; min-height: 44px;
    }
    /* the tool labels are hidden on a phone - the icons carry them */
    #tab-customers .cust-toolbar .cust-phone-hide { display: none; }

    /* --- KPI tiles: smaller, still three across. --- */
    #tab-customers .cust-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 4px 12px 10px; }
    #tab-customers .cust-kpi { min-height: 46px; padding: 6px 8px; border-radius: 10px; }
    #tab-customers .cust-kpi-val { font-size: 18px; }
    #tab-customers .cust-kpi-label { font-size: 10.5px; line-height: 1.25; }

    /* --- the filter chips move into a SHEET. Two scrolling rows of chips
       above the list cost 102px of an 844px screen and read like a third
       chip system; the sheet only takes the screen when it is asked for. --- */
    #tab-customers .cust-filters {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 9300;
        margin: 0;
        padding: 10px 16px calc(16px + env(safe-area-inset-bottom, 0px));
        gap: 10px;
        background: #fff;
        border-radius: 20px 20px 0 0;
        box-shadow: 0 -14px 44px rgba(15, 23, 42, .3);
        transform: translateY(105%);
        visibility: hidden;
        transition: transform .22s ease, visibility 0s linear .22s;
        max-height: 78vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    #tab-customers.cust-filters-open .cust-filters {
        transform: none;
        visibility: visible;
        transition: transform .22s ease, visibility 0s;
    }
    #tab-customers .cust-filters-scrim {
        display: block;
        position: fixed;
        inset: 0;
        z-index: 9200;
        background: rgba(15, 23, 42, .45);
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s ease;
    }
    #tab-customers.cust-filters-open .cust-filters-scrim { opacity: 1; pointer-events: auto; }
    /* The sheet is a MODAL, but it lives inside the tab pane (z-index 20)
       while the bottom nav is z-index 5000 in the same app shell - so the nav
       paints OVER the sheet and swallows the "Clear all" tap. Lift the pane
       above the nav while the sheet is up; the scrim then dims the nav like
       any other modal. */
    #tab-customers.cust-filters-open { z-index: 6000 !important; }
    #tab-customers .cust-sheet-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 2px 0 4px;
    }
    #tab-customers .cust-sheet-title { font-size: 15px; font-weight: 900; color: var(--mob-ink); }
    #tab-customers .cust-sheet-close {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        min-width: 44px;
        min-height: 44px;
        padding: 0;
        border: 1px solid var(--mob-border);
        border-radius: 12px;
        background: #fff;
        color: var(--mob-ink);
        cursor: pointer;
    }
    #tab-customers .cust-sheet-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding-top: 6px;
        border-top: 1px solid var(--mob-border);
    }
    #tab-customers .cust-sheet-apply {
        min-height: 44px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 800;
        padding: 10px 16px;
    }
    #tab-customers .cust-filter-row { flex-direction: column; align-items: stretch; gap: 6px; }
    #tab-customers .cust-filter-label { padding-top: 0; flex: 0 0 auto; min-width: 0; font-size: 11px; }
    #tab-customers .cust-chips {
        flex-wrap: wrap;
        overflow: visible;
        padding-bottom: 0;
        scrollbar-width: thin;
        -webkit-overflow-scrolling: touch;
    }
    #tab-customers .cust-chip { font-size: 12.5px; padding: 8px 12px; min-height: 44px; }

    /* --- the list: a stack of cards, no sideways scroll. --- */
    #tab-customers .mob-table-scroll {
        max-height: none;
        overflow: visible;
        margin: 0 12px;
        border: 1px solid var(--mob-border);
        border-radius: 12px;
        background: #fff;
    }
    #tab-customers .mob-data-table { display: block; min-width: 0; width: 100%; table-layout: auto; }
    #tab-customers .mob-data-table tbody { display: block; }
    #tab-customers .mob-data-table tbody tr {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) auto;
        grid-template-areas:
            "sel name value"
            "sel phone value"
            "sel tags act";
        align-items: start;
        gap: 4px 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--mob-border);
        background: #fff;
    }
    #tab-customers .mob-data-table tbody tr:last-child { border-bottom: none; border-radius: 0 0 11px 11px; }
    #tab-customers .mob-data-table tbody td {
        display: block;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
    }
    /* the empty state and the skeleton span the whole card */
    #tab-customers .mob-data-table tbody td[colspan] { grid-column: 1 / -1; }
    /* a selected card says so */
    #tab-customers .mob-data-table tbody tr.cust-row-selected { background: #f0f9ff; box-shadow: inset 3px 0 0 var(--mob-blue); }

    /* --- the column headers are GONE on a phone. A header row is the wrong
       shape for a header on a 360px screen: it wrapped to two rows, cut
       mid-word ("Last…", "Orde…"), scrolled sideways and - being sticky
       INSIDE the table - floated over the first card.

       Instead the phone gets ONE control row (renderListBar): a select-all
       checkbox, a NATIVE sort picker and a Filters button that opens the
       filter sheet. Sorting keeps a full keyboard + screen-reader story
       because it is a real <select>, and the list starts ~100px higher. --- */
    #tab-customers .mob-data-table thead { display: none; }

    #tab-customers .cust-listbar { display: block; margin: 0 12px 10px; }
    #tab-customers .cust-listbar-inner {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
    }
    #tab-customers .cust-lb-all {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 10px 0 6px;
        border: 1px solid var(--mob-border);
        border-radius: 12px;
        background: #fff;
        color: var(--mob-ink);
        font-size: 12.5px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
    }
    #tab-customers .cust-lb-all input[type="checkbox"] {
        appearance: none;
        -webkit-appearance: none;
        box-sizing: border-box;
        padding: 0 !important;
        width: 24px;
        height: 24px;
        min-width: 24px;
        min-height: 24px;
        margin: 0;
        padding: 0;
        border: 2px solid var(--mob-border);
        border-radius: 7px;
        background: #fff;
        display: inline-grid;
        place-content: center;
        cursor: pointer;
        flex: none;
    }
    #tab-customers .cust-lb-all input[type="checkbox"]::after {
        content: "";
        width: 13px;
        height: 13px;
        transform: scale(0);
        transition: transform .12s ease;
        box-shadow: inset 1em 1em #fff;
        clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
    }
    #tab-customers .cust-lb-all input[type="checkbox"]:checked,
    #tab-customers .cust-lb-all input[type="checkbox"]:indeterminate {
        background: var(--mob-blue);
        border-color: var(--mob-blue);
    }
    #tab-customers .cust-lb-all input[type="checkbox"]:checked::after { transform: scale(1); }
    #tab-customers .cust-lb-all input[type="checkbox"]:indeterminate::after {
        transform: scale(1);
        clip-path: inset(0 0 45% 0);
        background: #fff;
    }
    #tab-customers .cust-lb-all:focus-within,
    #tab-customers .cust-lb-btn:focus-visible,
    #tab-customers .cust-lb-sort select:focus-visible {
        outline: 2px solid var(--mob-blue);
        outline-offset: 2px;
    }
    #tab-customers .cust-lb-all-short { display: none; }
    @media (max-width: 400px) {
        #tab-customers .cust-lb-all-full { display: none; }
        #tab-customers .cust-lb-all-short { display: inline; }
    }
    #tab-customers .cust-lb-sort { position: relative; display: block; min-width: 0; }
    #tab-customers .cust-lb-sort select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        min-height: 44px;
        padding: 8px 34px 8px 12px;
        border: 1px solid var(--mob-border);
        border-radius: 12px;
        background: #fff;
        color: var(--mob-ink);
        font-size: 13px;
        font-weight: 700;
        text-overflow: ellipsis;
    }
    #tab-customers .cust-lb-chevron {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        pointer-events: none;
        color: var(--mob-sub);
    }
    #tab-customers .cust-lb-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 8px 12px;
        border: 1px solid var(--mob-border);
        border-radius: 12px;
        background: #fff;
        color: var(--mob-ink);
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
    }
    #tab-customers .cust-lb-btn[aria-expanded="true"] { border-color: var(--mob-blue); color: var(--mob-blue); }
    #tab-customers .cust-lb-badge {
        display: inline-grid;
        place-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--mob-blue);
        color: #fff;
        font-size: 11px;
        font-weight: 900;
    }

    /* --- where each cell lands on the card. --- */
    #tab-customers .cust-col-sel { grid-area: sel; position: static; width: auto; min-width: 0; padding: 2px 0 0 !important; }
    #tab-customers .cust-sel-box { width: 22px; height: 22px; min-width: 22px; min-height: 22px; }
    #tab-customers .cust-col-cust { grid-area: name; position: static; width: auto; box-shadow: none; }
    #tab-customers .cust-col-phone { grid-area: phone; width: auto; }
    #tab-customers .cust-col-value { grid-area: value; width: auto; text-align: right; align-self: start; }
    #tab-customers .cust-col-segment { grid-area: tags; width: auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    #tab-customers .cust-col-action { grid-area: act; width: auto; text-align: right; align-self: center; }
    /* the select chip in the sort strip keeps its own padding */
    #tab-customers .mob-data-table thead th.cust-col-sel { width: auto; min-width: 0; padding: 4px 8px !important; }
    /* the folded columns stay folded on the card too */
    #tab-customers .mob-data-table tbody .cust-col-addr,
    #tab-customers .mob-data-table tbody .cust-col-last,
    #tab-customers .mob-data-table tbody .cust-col-orders,
    #tab-customers .mob-data-table tbody .cust-col-loyalty { display: none; }

    /* --- the card's typography: nothing is clipped, a long name wraps. --- */
    #tab-customers .mob-cust-avatar { display: none; }
    #tab-customers .cust-joined { display: none; }
    #tab-customers .mob-row-go { display: none; }
    #tab-customers .cust-cust-id .mob-td-strong button { white-space: normal; overflow: visible; }
    #tab-customers .cust-mob-meta { display: block; font-size: 11.5px; line-height: 1.45; color: var(--mob-sub); margin-top: 2px; }
    #tab-customers .cust-last-mobile { display: inline; }
    #tab-customers .cust-phone-line { flex-direction: row; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    #tab-customers .mob-reset-lock { margin: 0; }
    #tab-customers .cust-reach { white-space: normal; overflow: visible; text-overflow: clip; margin-top: 0; }
    #tab-customers .cust-action { white-space: normal; overflow: visible; text-overflow: clip; max-width: 100%; font-size: 12px; }

    /* --- the contextual action bar pins to the BOTTOM, clear of the nav.
       The STICKY box has to be the direct child of the card: a sticky box can
       only travel inside its own parent's box, and the wrapper around the bar
       is exactly as tall as the bar - so the stickiness lives on the wrapper
       and the bar itself is a plain grid inside it. --- */
    #tab-customers #custBatchBar {
        position: sticky;
        top: auto;
        bottom: calc(var(--bottom-nav-height, 65px) + var(--safe-bottom, 0px));
        z-index: 900;
        margin: 8px 12px 0;
    }
    #tab-customers .cust-batch-bar {
        position: static;
        top: auto;
        bottom: auto;
        margin: 0;
        padding: 10px 12px;
        border-radius: 14px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
            "left clear"
            "reach reach"
            "push wa";
        align-items: center;
        gap: 8px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, .25);
    }
    /* the actions row becomes three grid items, so "Clear" can sit next to the
       count instead of taking a whole row of its own */
    #tab-customers .cust-batch-actions { display: contents; }
    #tab-customers .cust-batch-left { grid-area: left; gap: 8px; }
    #tab-customers .cust-batch-reach { grid-area: reach; font-size: 11.5px; gap: 8px; }
    #tab-customers .cust-batch-actions [data-cust-notify="push"] { grid-area: push; }
    #tab-customers .cust-batch-actions [data-cust-notify="wa"] { grid-area: wa; }
    /* "Clear" hugs the right edge of the count row */
    #tab-customers .cust-batch-actions [data-cust-clear-selection] { grid-area: clear; justify-self: end; }
    #tab-customers .cust-batch-btn { min-height: 44px; font-size: 12.5px; width: 100%; }
    #tab-customers .cust-batch-actions .cust-tool-btn { min-height: 36px; padding: 6px 10px; font-size: 12px; }
    #tab-customers .cust-phone-hide { display: none; }
    #tab-customers .cust-phone-only { display: inline; }
    #tab-customers .cust-tool-btn { min-height: 40px; }
    #tab-customers .cust-pager { padding: 10px 12px 4px; }
}`;
