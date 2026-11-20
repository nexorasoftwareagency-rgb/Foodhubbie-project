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
    const segChips = SEGMENT_CHIPS.map((chip) => `
        <button type="button" class="cust-chip" data-cust-segment="${esc(chip.key)}"
            aria-pressed="${segment === chip.key ? 'true' : 'false'}">${esc(chip.label)}
            <span class="cust-chip-count">${esc(num(counts.segments[chip.key] || 0))}</span></button>`).join('');
    const audChips = AUDIENCE_CHIPS.map((chip) => `
        <button type="button" class="cust-chip" data-cust-audience="${esc(chip.key)}"
            aria-pressed="${audiences.has(chip.key) ? 'true' : 'false'}">${esc(chip.label)}
            <span class="cust-chip-count">${esc(num(counts.audiences[chip.key] || 0))}</span></button>`).join('');
    return `
        <div class="cust-filter-row">
            <span class="cust-filter-label">Segment</span>
            <div class="cust-chips" role="group" aria-label="Filter by segment">${segChips}</div>
        </div>
        <div class="cust-filter-row">
            <span class="cust-filter-label">Audience</span>
            <div class="cust-chips" role="group" aria-label="Filter by audience">${audChips}</div>
        </div>`;
}

/** One table row. The header in index.html must have the same 9 columns. */
export function renderRow(r) {
    const phone = r.phone || '';
    const canOpen = /^\d{10}$/.test(phone);
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
    const rowProfile = canOpen ? ` data-cust-profile="${esc(phone)}" title="Open the full customer profile"` : '';
    return `<tr class="cp-row"${rowProfile}>
        <td class="cust-col-cust">
            <div class="mob-cust-name">
                <span class="mob-cust-avatar" aria-hidden="true">${esc(initialsOf(r.name))}</span>
                <div class="cust-cust-id">
                    <div class="mob-td-strong"><button type="button" class="btn-text mob-td-strong" data-cust-profile="${esc(phone)}" title="Open the full customer profile">${esc(r.name)}</button></div>
                    <div class="mob-td-sub cust-joined">Joined ${esc(r.joined)}${dup ? ' · ' + dup : ''}</div>
                    <div class="mob-td-sub cust-last-mobile">Last visit ${esc(r.lastVisit)}</div>
                </div>
                ${canOpen ? '<i data-lucide="chevron-right" class="mob-row-go" aria-hidden="true"></i>' : ''}
            </div>
        </td>
        <td class="cust-col-phone">${waLink}${canOpen ? `<div><button type="button" class="mob-reset-lock" data-reset-lock="${esc(phone)}" title="Use when the customer lost or changed their phone: the next phone to open the app with this number becomes the owner.">Reset phone lock</button></div>` : ''}</td>
        <td class="cust-col-addr"><span class="mob-addr-text" title="${esc(r.address)}">${esc(addr)}</span>${mapLink}</td>
        <td class="cust-col-last">
            <span class="cust-last">${esc(r.lastVisit)}</span>
            ${r.channel ? `<div class="mob-td-sub">${esc(r.channel)}</div>` : ''}
        </td>
        <td class="mob-th-center cust-col-orders"><span class="mob-order-count">${esc(num(r.orderCount))}</span><div class="mob-td-sub">paid</div></td>
        <td class="mob-th-right cust-col-value"><span class="mob-td-total">${esc(money(r.ltv))}</span></td>
        <td class="mob-th-center cust-col-loyalty">${pill(r.loyalty.tier.charAt(0).toUpperCase() + r.loyalty.tier.slice(1), r.loyalty.tier === 'gold' ? 'gold' : r.loyalty.tier === 'silver' ? 'neutral' : 'bronze')}<div class="mob-td-sub" title="${esc(num(r.loyalty.points))} points to spend${r.loyalty.lifetimePoints ? ` · ${esc(num(r.loyalty.lifetimePoints))} lifetime points` : ''}">${esc(num(r.loyalty.points))} pts</div></td>
        <td class="cust-col-segment">${pill(r.action.segment, r.action.tone)}<div class="cust-reach cust-reach-${esc(reach.tone)}" title="${esc(r.consent.detail || '')}">${esc(reach.label)}</div></td>
        <td class="cust-col-action"><span class="cust-action cust-action-${esc(r.action.tone)}" title="${esc(r.action.title + (r.action.sub ? ' — ' + r.action.sub : ''))}">${esc(r.action.short || r.action.title)}</span></td>
    </tr>`;
}

/** The skeleton rows shown while the database loads (Carbon: rows, not a spinner). */
export function renderSkeleton(rows = 6) {
    let out = '';
    for (let i = 0; i < rows; i++) {
        out += `<tr class="cust-skel-row"><td colspan="9">
            <span class="cust-skel" style="width:${28 + (i % 3) * 9}%"></span>
            <span class="cust-skel cust-skel-sm" style="width:${14 + (i % 4) * 7}%"></span>
        </td></tr>`;
    }
    return out;
}

/** The empty states: an empty database and an empty filter result. */
export function renderEmpty(kind, ctx = {}) {
    if (kind === 'empty-db') {
        return `<tr><td colspan="9" class="cust-empty">
            <p class="cust-empty-title">No customer records yet</p>
            <p class="cust-empty-sub">A guest appears here as soon as they order through the QR menu, the customer app or WhatsApp. Share your Customer App link or print a table QR to get started.</p>
        </td></tr>`;
    }
    const suggestion = ctx.suggestion
        ? ` Try <strong>${esc(ctx.suggestion.label)}</strong> (${esc(num(ctx.suggestion.count))}) instead.`
        : '';
    const what = ctx.term ? ` matching “${esc(ctx.term)}”` : '';
    return `<tr><td colspan="9" class="cust-empty">
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
#tab-customers .cust-col-phone { width: 12%; }
#tab-customers .cust-col-addr { width: 10%; }
#tab-customers .cust-col-last { width: 9%; }
#tab-customers .cust-col-orders { width: 6%; }
#tab-customers .cust-col-value { width: 11%; }
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
    #tab-customers .cust-col-cust { width: 24%; }
    #tab-customers .cust-col-value { width: 12%; }
}

@media (max-width: 640px) {
    #tab-customers .cust-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    #tab-customers .cust-kpi { min-height: 52px; padding: 8px 10px; }
    #tab-customers .cust-kpi-val { font-size: 19px; }
    /* One SCROLLING row per chip group - the table has to stay reachable. */
    #tab-customers .cust-filter-row { flex-direction: row; align-items: center; gap: 8px; }
    #tab-customers .cust-filter-label { padding-top: 0; flex: 0 0 auto; }
    #tab-customers .cust-chips { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; -webkit-overflow-scrolling: touch; }
    /* Five columns on a phone: identity, phone, value, segment, next step.
       Address / loyalty / orders / last visit live in the profile, and the
       last visit moves under the customer name. */
    #tab-customers .cust-col-addr, #tab-customers .cust-col-loyalty,
    #tab-customers .cust-col-orders, #tab-customers .cust-col-last { display: none; }
    #tab-customers .mob-data-table { min-width: 620px; }
    #tab-customers .cust-col-cust { width: 32%; }
    #tab-customers .cust-col-phone { width: 20%; }
    #tab-customers .cust-col-value { width: 18%; }
    #tab-customers .cust-col-segment { width: 15%; }
    #tab-customers .cust-col-action { width: 15%; }
    #tab-customers .mob-cust-avatar { display: none; }
    #tab-customers .cust-joined { display: none; }
    #tab-customers .cust-last-mobile { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tab-customers .cust-tool-btn { min-height: 44px; }
    /* The customer cell stays pinned while the other columns scroll. */
    #tab-customers .cust-col-cust { position: sticky; left: 0; z-index: 2; background: #fff; box-shadow: 1px 0 0 var(--mob-border); }
    #tab-customers thead .cust-col-cust { z-index: 3; }
    #tab-customers .mob-data-table tbody tr:hover .cust-col-cust { background: var(--mob-bg); }
    /* The toolbar wraps: search on its own line, the tools under it. */
    #tab-customers .mob-section-head-row { flex-wrap: wrap; gap: 10px; }
    #tab-customers .cust-toolbar { margin-left: 0 !important; width: 100%; flex-wrap: wrap; }
    #tab-customers #customerSearch { flex: 1 1 100%; max-width: none !important; }
}`;
