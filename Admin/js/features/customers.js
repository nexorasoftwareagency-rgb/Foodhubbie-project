// ============================================================================
// CUSTOMER DATABASE — CONTROLLER
//
// Owns the Customers tab: downloads the rows ONCE (the Customer Profile and
// the exports reuse the same snapshot), hands them to the pure view layer and
// wires the events.
//
// Data sources (all admin-readable, all outlet-scoped):
//   customers               the master list of guests
//   orders                  the order history (paid basis is applied in the view)
//   loyalty/rankings        tier + rank
//   loyalty/config          tier thresholds, so the tier matches the profile
//   bot/promotions/optout   STOP opt-out markers (marketing consent)
// ============================================================================

import { Outlet, get, remove, billingRef } from '../firebase.js';
import { showToast } from '../utils.js';
import { logger } from '../utils/logger.js';
import { state } from '../state.js';
import { loadJSPDF, reportHead, reportKpis, reportSection, reportContinued, reportFoot } from './printing.js';
import { ensureXlsx } from '../xlsx.js';
// The shared helpers are INJECTED into the pure layer — never copied.
import { isBilledOrder } from '../../shared/cost-math.js';
import { tierForPoints } from '../../shared/loyalty-math.js';
import {
    buildCustomerRows, filterRows, sortRows, computeKpiTiles, computeChipCounts,
    renderKpis, renderFilters, renderRow, renderEmpty, renderPager, renderBatchBar,
    renderSkeleton, SEGMENT_CHIPS, AUDIENCE_CHIPS, CUSTOMER_DASHBOARD_CSS,
} from './customers-view.js';
import { evaluateBatch } from './notify-eligibility.js';

const CALC = { isBilledOrder, tierForPoints };
const PAGE_SIZE = 50;
const DENSITY_KEY = 'fh:custDensity';

let _rows = [];
let _thresholds = {};
let _filteredData = [];
let _sortField = 'ltv', _sortDir = 'desc';
let _searchTerm = '';
let _segment = 'all';
let _audiences = [];
let _limit = PAGE_SIZE;
let _density = false;
let _cssInjected = false;
let _loaded = false;
// The whole orders node is already downloaded for the table, so the Customer
// Profile reuses it instead of paying for a second read.
let _orderSnapshot = [];
// The notification checklist selection. A Set of phone numbers, so it survives
// paging, filtering and sorting.
let _selected = new Set();
// The notification context (device tokens, consent gates, promo state). It is
// read ONCE, lazily, the first time a guest is selected - a list that is only
// browsed never pays for it.
let _notifyCtx = null;

function _injectCss() {
    if (_cssInjected) return;
    _cssInjected = true;
    const style = document.createElement('style');
    style.id = 'custDashStyle';
    style.textContent = CUSTOMER_DASHBOARD_CSS;
    document.head.appendChild(style);
}

function fmtMoney(n) {
    const v = Number(n || 0);
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}

// Open the Customer Profile 360 for one phone. The feature module is loaded
// on demand - a customer list that is only browsed never pays for it.
async function _openProfile(phone) {
    if (!phone) return;
    try {
        const mod = await import('./customer-profile.js');
        mod.initCustomerProfile();
        await mod.openCustomerProfile(phone, { orders: _orderSnapshot });
    } catch (err) {
        logger.warn('CUSTOMERS', 'open profile failed', err);
        showToast('Could not open the customer profile.', 'error');
    }
}

/** Which KPI tile matches the CURRENT filter (the tile shows the active state). */
function _activeKpiKey() {
    if (_segment === 'all' && _audiences.length === 0) return 'guests';
    if (_segment === 'all' && _audiences.length === 1 && _audiences[0] === 'active-30d') return 'active30';
    if (_segment === 'all' && _audiences.length === 1 && _audiences[0] === 'new-30d') return 'new30';
    if (_segment === 'at-risk' && _audiences.length === 0) return 'atrisk';
    if (_segment === 'lapsed' && _audiences.length === 0) return 'lapsed';
    if (_segment === 'champions' && _audiences.length === 0) return 'champions';
    return null;
}

// ------------------------------------------------------- notification context

/**
 * The facts the notification checklist needs: who has an app device, and
 * whether this outlet can send WhatsApp messages at all.
 *
 * Every read is best-effort. A value we could not read stays `undefined`, and
 * an unknown value never blocks a channel (the server and the bot re-check
 * everything before a message leaves) - but a value we DID read and know is
 * off is reported honestly.
 */
async function _ensureNotifyCtx() {
    if (_notifyCtx) return _notifyCtx;
    const ctx = {
        subscriptions: {},
        promoEnabled: undefined,
        killSwitch: undefined,
        transport: undefined,
        tokenBalance: undefined,
        storeName: state.storeName || '',
    };
    // Each read is independent: one unreadable node must not blank the others.
    // `null` means "the read failed" (unknown), a real snapshot means known.
    const safe = (p) => p.then((s) => s).catch(() => null);
    const [subsSnap, enabledSnap, killSnap, transportSnap, tokenSnap] = await Promise.all([
        safe(get(Outlet.ref('pushSubscriptions'))),
        safe(get(Outlet.ref('bot/promotions/enabled'))),
        safe(get(Outlet.ref('bot/promotions/killSwitch'))),
        safe(get(Outlet.ref('bot/transport'))),
        safe(get(billingRef('tokens/balance'))),
    ]);

    if (subsSnap) {
        const subs = subsSnap.exists() ? (subsSnap.val() || {}) : {};
        for (const s of Object.values(subs)) {
            if (!s) continue;
            const phone = String(s.phone || '').replace(/\D/g, '').slice(-10);
            if (!/^[6-9]\d{9}$/.test(phone)) continue;
            const cur = ctx.subscriptions[phone] || { hasToken: false, offers: true };
            if (s.token) cur.hasToken = true;
            // The server treats a subscription with no prefs as opted in.
            if (s.prefs && s.prefs.offers === false) cur.offers = false;
            ctx.subscriptions[phone] = cur;
        }
    }
    // The bot reads an absent `enabled` node as ENABLED, so absent = on.
    if (enabledSnap) ctx.promoEnabled = enabledSnap.exists() ? enabledSnap.val() !== false : true;
    if (killSnap) ctx.killSwitch = killSnap.exists() ? killSnap.val() === true : false;
    // An absent transport node means no WhatsApp connection at all.
    if (transportSnap) ctx.transport = transportSnap.exists() ? String(transportSnap.val() || '') : '';
    if (tokenSnap) ctx.tokenBalance = tokenSnap.exists() ? Number(tokenSnap.val() || 0) : 0;

    ctx.storeName = state.storeName || ctx.storeName || '';
    _notifyCtx = ctx;
    return _notifyCtx;
}

/** The rows the selection currently points at (in table order). */
function _selectedRows() {
    return _rows.filter((r) => _selected.has(r.phone));
}

/** Open the shared composer for the selected guests. */
async function _openComposer() {
    const rows = _selectedRows();
    if (!rows.length) { showToast('Select at least one guest first.', 'info'); return; }
    try {
        const ctx = await _ensureNotifyCtx();
        const mod = await import('./notify-composer.js');
        await mod.openNotifyComposer({ rows, ctx });
    } catch (err) {
        logger.warn('CUSTOMERS', 'composer failed to open', err);
        showToast('Could not open the message composer.', 'error');
    }
}

/** Render the contextual action bar (selection + honest reach counts). */
function _renderBatchBar() {
    const host = document.getElementById('custBatchBar');
    if (!host) return;
    if (!_selected.size) { host.innerHTML = ''; return; }
    const rows = _selectedRows();
    const reach = evaluateBatch(rows, _notifyCtx || {});
    const matching = _filteredData.length;
    // The selection survives a filter change, so "all matching" is judged
    // against the MATCHING guests only - a guest selected under an older
    // filter must not make the link look like it is already done.
    const matchingPhones = new Set(_filteredData.map((r) => r.phone));
    const selectedMatching = rows.filter((r) => matchingPhones.has(r.phone)).length;
    host.innerHTML = renderBatchBar({
        selected: _selected.size,
        matching,
        pushReach: reach.push.reachable,
        waReach: reach.wa.reachable,
        canSelectAll: matching > selectedMatching,
        allMatchingSelected: matching > 0 && selectedMatching >= matching,
    });
}

function _icons() {
    if (typeof lucide !== 'undefined') {
        try { lucide.createIcons(); } catch (_) { /* icons are cosmetic */ }
    }
}

function _renderCustomerTable() {
    const tbody = document.getElementById('customerDataTableBody');
    const countEl = document.getElementById('custTableCount');
    if (!tbody) return;

    // Counts are measured over the SEARCH-matched guests, so a chip always
    // says how many guests it would give you.
    const searched = filterRows(_rows, { segment: 'all', audiences: [], term: _searchTerm, thresholds: _thresholds });
    const counts = computeChipCounts(searched, _thresholds);
    const tiles = computeKpiTiles(searched, _thresholds);

    const filtered = filterRows(_rows, {
        segment: _segment, audiences: _audiences, term: _searchTerm, thresholds: _thresholds,
    });
    const sorted = sortRows(filtered, _sortField, _sortDir);
    _filteredData = sorted;

    const shown = Math.min(_limit, sorted.length);
    const visible = sorted.slice(0, shown);

    const kpiHost = document.getElementById('custKpis');
    if (kpiHost) kpiHost.innerHTML = renderKpis(tiles, { kpi: _activeKpiKey() });
    const filterHost = document.getElementById('custFilters');
    if (filterHost) {
        filterHost.innerHTML = renderFilters(counts, { segment: _segment, audiences: _audiences });
    }

    if (countEl) countEl.textContent = `${sorted.length} guest${sorted.length === 1 ? '' : 's'}`;

    if (!visible.length) {
        if (!_rows.length) {
            tbody.innerHTML = renderEmpty('empty-db');
        } else {
            // Offer the biggest segment as a way out of an empty filter.
            let suggestion = null;
            for (const chip of SEGMENT_CHIPS) {
                if (chip.key === 'all') continue;
                const c = counts.segments[chip.key] || 0;
                if (c > 0 && (!suggestion || c > suggestion.count)) suggestion = { label: chip.label, count: c };
            }
            tbody.innerHTML = renderEmpty('no-match', { term: _searchTerm, suggestion });
        }
    } else {
        tbody.innerHTML = visible.map((r) => renderRow(r, { selected: _selected.has(r.phone) })).join('');
    }

    // The header checkbox: checked when every visible row is selected,
    // indeterminate when only some are. It never selects guests off-screen -
    // that is the explicit "Select all N matching guests" link.
    const allBox = document.getElementById('custSelectAll');
    if (allBox) {
        const selectable = visible.filter((r) => /^\d{10}$/.test(r.phone || ''));
        const selectedVisible = selectable.filter((r) => _selected.has(r.phone)).length;
        allBox.checked = selectable.length > 0 && selectedVisible === selectable.length;
        allBox.indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
        allBox.disabled = selectable.length === 0;
    }

    _renderBatchBar();

    const pager = document.getElementById('custPager');
    if (pager) pager.innerHTML = renderPager(shown, sorted.length, PAGE_SIZE);

    // The row click handler lives on the tbody (which survives re-renders).
    if (!tbody.dataset.lockWired) {
        tbody.dataset.lockWired = '1';
        tbody.addEventListener('change', async (e) => {
            const box = e.target.closest('[data-cust-select]');
            if (!box) return;
            const ph = box.dataset.custSelect;
            if (!ph) return;
            if (box.checked) _selected.add(ph);
            else _selected.delete(ph);
            await _ensureNotifyCtx();
            _renderCustomerTable();
        });
        tbody.addEventListener('click', async (e) => {
            // 1. Links do their own thing (WhatsApp, MAP) - never open the profile.
            if (e.target.closest('a')) return;

            // 2. "Reset phone lock" is its own action.
            const resetBtn = e.target.closest('[data-reset-lock]');
            if (resetBtn) {
                const ph = resetBtn.dataset.resetLock;
                if (!window.confirm(`Reset the phone lock for ${ph}?\n\nThe customer's phone(s) will be forgotten. The NEXT phone that opens the app with this number becomes the owner, so only do this when the customer asks (lost or new phone).`)) return;
                resetBtn.disabled = true;
                try {
                    await remove(Outlet.ref(`customers/${ph}/devices`));
                    await remove(Outlet.ref(`customers/${ph}/link`));
                    showToast('Phone lock reset. Ask the customer to open the app now.', 'success');
                } catch (err) {
                    logger.warn('CUSTOMERS', 'reset lock failed', err);
                    showToast('Could not reset the lock.', 'error');
                }
                resetBtn.disabled = false;
                return;
            }

            // 3. "Clear filters" from the empty state.
            const clearBtn = e.target.closest('[data-cust-clear]');
            if (clearBtn) {
                _segment = 'all';
                _audiences = [];
                _searchTerm = '';
                const searchEl = document.getElementById('customerSearch');
                if (searchEl) searchEl.value = '';
                _limit = PAGE_SIZE;
                _renderCustomerTable();
                return;
            }

            // 4. The customer NAME button or ANYWHERE in the row -> the profile.
            //    A control that is NOT the profile target (a future button in the
            //    row) keeps its own click.
            const clicked = e.target.closest('a, button, input, select, textarea, label');
            const target = e.target.closest('[data-cust-profile]');
            if (!target || (clicked && clicked !== target)) return;
            const ph = target.dataset.custProfile;
            if (!ph) return;

            // A drag that selected text is not a click.
            const sel = window.getSelection ? String(window.getSelection() || '') : '';
            if (sel.trim()) return;

            await _openProfile(ph);
        });
    }

    _icons();
}

export function filterCustomers(searchTerm) {
    _searchTerm = (searchTerm || '').trim();
    _limit = PAGE_SIZE;
    // Typing before the database arrived must not wipe the loading skeleton.
    if (!_loaded) return;
    _renderCustomerTable();
}

export async function loadCustomers() {
    const tbody = document.getElementById('customerDataTableBody');
    if (!tbody) {
        logger.warn('CUSTOMERS', 'Customers table not found, skipping load');
        return;
    }

    _injectCss();
    initCustomerDashboard();
    _loaded = false;
    tbody.innerHTML = renderSkeleton(6);
    logger.info('CUSTOMERS', 'Loading customers from Firebase...');

    try {
        const [custSnap, orderSnap, loySnap, cfgSnap, optOutSnap] = await Promise.all([
            get(Outlet.ref("customers")),
            get(Outlet.ref("orders")),
            get(Outlet.ref("loyalty/rankings")),
            get(Outlet.ref("loyalty/config")),
            get(Outlet.ref("bot/promotions/optout")),
        ]);
        const orders = [];
        orderSnap.forEach(o => { const v = o.val(); if (v) orders.push({ ...v, _id: o.key }); });
        _orderSnapshot = orders;

        const loyalty = {};
        loySnap.forEach(l => { loyalty[l.key] = l.val(); });

        const customers = [];
        custSnap.forEach(child => {
            const c = child.val();
            if (!c) return;
            customers.push({ phone: child.key, data: c });
        });

        const optOutPhones = [];
        optOutSnap.forEach(child => { optOutPhones.push(child.key); });

        const built = buildCustomerRows({
            customers,
            orders,
            rankings: loyalty,
            optOutPhones,
            loyaltyConfig: cfgSnap.exists() ? cfgSnap.val() : null,
            now: Date.now(),
            storeName: state.storeName || '',
        }, CALC);
        _rows = built.rows;
        _thresholds = built.thresholds;
        _loaded = true;

        _renderCustomerTable();
        initCustomerTable();

        logger.success('CUSTOMERS', `Loaded ${_rows.length} customers`);
    } catch (e) {
        console.error('[Customers] Load error:', e);
        tbody.innerHTML = `<tr><td colspan="9" class="cust-empty"><p class="cust-empty-title">Could not load the customer database</p><p class="cust-empty-sub">Check your connection and try again.</p></td></tr>`;
    }
}

export function initCustomerTable() {
    const table = document.getElementById('customerDataTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const ths = table.querySelectorAll('th[data-sort]');
    ths.forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_sortField === field) {
                _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _sortField = field;
                _sortDir = (field === 'orderCount' || field === 'ltv' || field === 'lastVisit') ? 'desc' : 'asc';
            }
            ths.forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_sortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderCustomerTable();
        });
    });
}

/** Wire the filter chrome once (KPI tiles, chips, density, pager). */
export function initCustomerDashboard() {
    if (!_cssInjected) _injectCss();

    const kpiHost = document.getElementById('custKpis');
    if (kpiHost && !kpiHost.dataset.wired) {
        kpiHost.dataset.wired = '1';
        kpiHost.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-cust-kpi]');
            if (!btn) return;
            const key = btn.dataset.custKpi;
            if (key === 'guests') { _segment = 'all'; _audiences = []; }
            else if (key === 'active30') { _segment = 'all'; _audiences = ['active-30d']; }
            else if (key === 'new30') { _segment = 'all'; _audiences = ['new-30d']; }
            else if (key === 'atrisk') { _segment = 'at-risk'; _audiences = []; }
            else if (key === 'lapsed') { _segment = 'lapsed'; _audiences = []; }
            else if (key === 'champions') { _segment = 'champions'; _audiences = []; }
            _limit = PAGE_SIZE;
            _renderCustomerTable();
        });
    }

    const filterHost = document.getElementById('custFilters');
    if (filterHost && !filterHost.dataset.wired) {
        filterHost.dataset.wired = '1';
        filterHost.addEventListener('click', (e) => {
            const seg = e.target.closest('[data-cust-segment]');
            if (seg) {
                _segment = seg.dataset.custSegment;
                _limit = PAGE_SIZE;
                _renderCustomerTable();
                return;
            }
            const aud = e.target.closest('[data-cust-audience]');
            if (aud) {
                const key = aud.dataset.custAudience;
                if (!AUDIENCE_CHIPS.some((c) => c.key === key)) return;
                _audiences = _audiences.includes(key)
                    ? _audiences.filter((k) => k !== key)
                    : [..._audiences, key];
                _limit = PAGE_SIZE;
                _renderCustomerTable();
            }
        });
    }

    const pager = document.getElementById('custPager');
    if (pager && !pager.dataset.wired) {
        pager.dataset.wired = '1';
        pager.addEventListener('click', (e) => {
            const more = e.target.closest('#custLoadMore');
            if (!more) return;
            _limit += PAGE_SIZE;
            _renderCustomerTable();
        });
    }

    // The notification checklist: the contextual action bar.
    const batchHost = document.getElementById('custBatchBar');
    if (batchHost && !batchHost.dataset.wired) {
        batchHost.dataset.wired = '1';
        batchHost.addEventListener('click', async (e) => {
            const all = e.target.closest('[data-cust-select-all-matching]');
            if (all) {
                for (const r of _filteredData) {
                    if (/^\d{10}$/.test(r.phone || '')) _selected.add(r.phone);
                }
                _renderCustomerTable();
                return;
            }
            const clear = e.target.closest('[data-cust-clear-selection]');
            if (clear) {
                _selected.clear();
                _renderCustomerTable();
                return;
            }
            if (e.target.closest('[data-cust-notify]')) await _openComposer();
        });
    }

    // The header checkbox selects THIS PAGE only. Selecting every matching
    // guest is an explicit, counted action (the "Select all N matching" link).
    const allBox = document.getElementById('custSelectAll');
    if (allBox && !allBox.dataset.wired) {
        allBox.dataset.wired = '1';
        allBox.addEventListener('change', async () => {
            const tbody = document.getElementById('customerDataTableBody');
            const boxes = tbody ? tbody.querySelectorAll('[data-cust-select]:not([disabled])') : [];
            for (const b of boxes) {
                const ph = b.dataset.custSelect;
                if (!ph) continue;
                if (allBox.checked) _selected.add(ph);
                else _selected.delete(ph);
            }
            await _ensureNotifyCtx();
            _renderCustomerTable();
        });
    }

    const densityBtn = document.getElementById('custDensityBtn');    if (densityBtn && !densityBtn.dataset.wired) {
        densityBtn.dataset.wired = '1';
        try { _density = localStorage.getItem(DENSITY_KEY) === 'dense'; } catch (_) { _density = false; }
        const tab = document.getElementById('tab-customers');
        if (tab) tab.classList.toggle('cust-dense', _density);
        densityBtn.setAttribute('aria-pressed', _density ? 'true' : 'false');
        const label = densityBtn.querySelector('span');
        if (label) label.textContent = _density ? 'Comfortable' : 'Compact';
        densityBtn.addEventListener('click', () => {
            _density = !_density;
            const t = document.getElementById('tab-customers');
            if (t) t.classList.toggle('cust-dense', _density);
            densityBtn.setAttribute('aria-pressed', _density ? 'true' : 'false');
            const l = densityBtn.querySelector('span');
            if (l) l.textContent = _density ? 'Comfortable' : 'Compact';
            try { localStorage.setItem(DENSITY_KEY, _density ? 'dense' : 'roomy'); } catch (_) { /* private mode */ }
        });
    }
}

export async function downloadCustomerExcel() {
    if (_filteredData.length === 0) { showToast('No customer data to export.', 'info'); return; }
    showToast('Generating Excel...', 'info');

    const data = _filteredData.map(c => ({
        Customer: c.name || 'Anonymous',
        Phone: c.displayPhone || '',
        Address: c.address || '',
        'Paid Orders': c.orderCount || 0,
        'Total Value (₹)': c.ltv || 0,
        'Last Visit': c.lastVisit || 'Never',
        Segment: c.action.segment || '',
        Loyalty: (c.loyalty.tier || '').toString(),
        'Points to Spend': c.loyalty.points || 0,
        'Promo Reach': c.consent.state || '',
    }));

    let XLSX;
    try {
        XLSX = await ensureXlsx();
    } catch (e) {
        showToast(e.message || 'Excel library not loaded.', 'error');
        return;
    }

    setTimeout(() => {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Customers');
        XLSX.writeFile(wb, `Customers_${new Date().toISOString().split('T')[0]}.xlsx`);
    }, 50);
}

export async function downloadCustomerPDF() {
    await loadJSPDF();
    if (_filteredData.length === 0) { showToast('No customer data to export.', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') { showToast('PDF table plugin not ready.', 'error'); return; }

    showToast('Generating PDF...', 'info');

    let storeName = 'FoodHubbie';
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        if (snap.exists() && snap.val().storeName) storeName = snap.val().storeName;
    } catch (_) {}

    const rs = n => 'Rs.' + Math.round(Number(n || 0)).toLocaleString('en-IN');

    const rows = _filteredData;
    const totalOrders = rows.reduce((s, c) => s + Number(c.orderCount || 0), 0);
    const totalRevenue = rows.reduce((s, c) => s + Number(c.ltv || 0), 0);
    const aov = totalOrders > 0 ? rs(totalRevenue / totalOrders) : '—';

    // Minimal chrome: eyebrow + store name + hairline, neutral KPI cards, ink section label
    const kpiY = reportHead(doc, {
        title: 'Customer Directory',
        subtitle: storeName,
        meta: `Customer database  ·  ${rows.length} customers  ·  Generated ${new Date().toLocaleDateString('en-IN')}`
    });
    const secY = reportKpis(doc, [
        ['TOTAL CUSTOMERS', String(rows.length)],
        ['PAID ORDERS', totalOrders.toLocaleString('en-IN')],
        ['TOTAL REVENUE', rs(totalRevenue)],
        ['AVG ORDER VALUE', aov]
    ], kpiY);
    const startY = reportSection(doc, { label: 'CUSTOMER DIRECTORY', right: `${rows.length} records`, y: secY });

    const tableData = rows.map(c => [
        c.name || 'Anonymous',
        c.displayPhone || '',
        String(c.orderCount || 0),
        rs(c.ltv),
        c.lastVisit || 'Never',
        c.action.segment || '—',
    ]);

    doc.autoTable({
        head: [['Customer', 'Phone', 'Paid orders', 'Total Value', 'Last visit', 'Segment']],
        body: tableData,
        foot: [['Grand Total', `${rows.length} customers`, String(totalOrders), rs(totalRevenue), '', '']],
        showFoot: 'lastPage',
        rowPageBreak: 'avoid',
        theme: 'plain',
        headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8.5 },
        bodyStyles: {
            fontSize: 8, textColor: [30, 41, 59], valign: 'middle',
            cellPadding: { top: 2.4, bottom: 2.4, left: 3, right: 3 }
        },
        alternateRowStyles: { fillColor: [250, 250, 251] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 26, halign: 'center' },
            2: { cellWidth: 20, halign: 'center' },
            3: { cellWidth: 30, halign: 'right' },
            4: { cellWidth: 26 },
            5: { cellWidth: 26 }
        },
        margin: { top: 26, left: 14, right: 14, bottom: 18 },
        startY,
        didDrawPage: () => {
            if (doc.internal.getCurrentPageInfo().pageNumber === 1) return;
            reportContinued(doc, 'Customer Directory', storeName);
        },
    });

    // Footer post-pass: Page X of Y on every page
    reportFoot(doc, storeName);

    doc.setProperties({
        title: `Customer Database - ${storeName}`,
        subject: 'Customer export',
        author: storeName,
        creator: 'FoodHubbie ERP'
    });

    doc.save(`Customers_${new Date().toISOString().split('T')[0]}.pdf`);
}
