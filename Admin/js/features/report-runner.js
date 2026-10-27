/**
 * FoodHubbie ERP | REPORT RUNNER  (Admin/js/features/report-runner.js)
 * ============================================================================
 * Phase 4 (OrderRestro port §5): the catalog-driven generic report page.
 * Lives in the third analytics subtab ("Reports") inside #reportsRunnerPanel.
 *
 * The UI renders shared/report-catalog.js's REPORT_CATALOG (never hardcodes
 * report names), fetches only the data each report's `req` lists, and renders
 * whatever runReport() returns through ONE generic table. Money stays a raw
 * number until this renderer (or the Phase 5 exporters) formats it.
 *
 * Permission gate — ponytail: tab-based roles, so "revenue-bearing" means
 * manager+ (roleLevel >= 1, super/supreme bypass). Upgrade to per-report
 * claims only when a real role needs finer granularity.
 */

import { Outlet, get, query, orderByChild, startAt, endAt } from '../firebase.js';
import { state } from '../state.js';
import { showToast, getISTDateString } from '../utils.js';
import { roleLevel } from '../ui.js';
import { REPORT_CATALOG, REPORT_GROUPS, getReport, runReport } from '../../shared/report-catalog.js';

let _bound = false;
let _autoRan = false;
let _activeGroup = null;
let _activeKey = null;
let _rawCache = null;  // { from, to, orders, contacts?, dishes?, staff?, attendance? }
let _lastRun = null;   // { key, from, to, result } — what CSV/print export

const _el = (id) => document.getElementById(id);
const _canRevenue = () => !!(state.adminData?.isSuper || roleLevel(state.adminData?.role) >= 1);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function _defaultRange() {
    const to = getISTDateString(Date.now());
    const from = getISTDateString(Date.now() - 29 * 86400000); // last 30 days incl. today
    return { from, to };
}

// Groups the current role may see: revenue-bearing groups need manager+.
const _visibleGroups = () => {
    const can = _canRevenue();
    return REPORT_GROUPS.filter(g => can || !REPORT_CATALOG.some(r => r.group === g && r.revenue));
};

export function mount() {
    if (!_el('rrGroups')) return;
    if (!_bound) {
        _bound = true;
        const { from, to } = _defaultRange();
        _el('rrFrom').value = from;
        _el('rrTo').value = to;
        _activeGroup = _visibleGroups()[0] || null;
        _bind();
    }
    _renderGroups();
    _renderReportList();
    if (!_autoRan && _activeKey) {
        _autoRan = true;
        _generate();
    }
}

// Listeners bind once to persistent elements; unmount just marks state.
export function unmount() { /* kept mounted: state survives tab flips */ }

function _bind() {
    _el('btnRrGenerate')?.addEventListener('click', _generate);
    _el('btnRrCsv')?.addEventListener('click', _exportCsv);
    _el('btnRrPrint')?.addEventListener('click', _print);
    _el('btnRrRetry')?.addEventListener('click', _generate);
}

function _renderGroups() {
    const wrap = _el('rrGroups');
    const groups = _visibleGroups();
    if (!_activeGroup || !groups.includes(_activeGroup)) _activeGroup = groups[0] || null;
    wrap.innerHTML = groups.map(g =>
        `<button class="rr-group-pill ${g === _activeGroup ? 'active' : ''}" data-group="${esc(g)}">${esc(g)}</button>`
    ).join('');
    wrap.querySelectorAll('.rr-group-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeGroup = btn.dataset.group;
            _activeKey = null; // force re-pick inside the new group
            _renderGroups();
            _renderReportList();
        });
    });
}

function _renderReportList() {
    const list = _el('rrReportList');
    const items = REPORT_CATALOG.filter(r => r.group === _activeGroup);
    if (!_activeKey || !items.some(r => r.key === _activeKey)) _activeKey = items[0]?.key || null;
    const can = _canRevenue();
    list.innerHTML = items.map(r => {
        const lock = (r.revenue && !can) ? ' <i data-lucide="lock" class="icon-12 rr-lock"></i>' : '';
        return `<button class="rr-report-item ${r.key === _activeKey ? 'active' : ''}" data-key="${esc(r.key)}" role="option">${esc(r.title)}${lock}</button>`;
    }).join('');
    list.querySelectorAll('.rr-report-item').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeKey = btn.dataset.key;
            _renderReportList();
            _generate();
        });
    });
    try { window.lucide?.createIcons(); } catch (_) {}
}

async function _generate() {
    const report = getReport(_activeKey);
    if (!report) { showToast('Pick a report first', 'warning'); return; }
    const from = _el('rrFrom').value;
    const to = _el('rrTo').value;
    if (!from || !to) { showToast('Select both start and end dates', 'warning'); return; }
    if (from > to) { showToast('Start date must be on or before end date', 'warning'); return; } // ISO strings compare correctly

    _showSkeleton();
    try {
        const data = await _fetchData(from, to, report);
        const result = runReport(report.key, data);
        if (!result) throw new Error('Unknown report');
        _lastRun = { key: report.key, from, to, result };
        _renderResult(report, result, from, to);
    } catch (e) {
        console.error('[ReportRunner]', e);
        _showError(e?.message || String(e));
    }
}

// Orders use the same query window as the Revenue analytics (UTC day padding
// around the range, then an IST date-string filter). Extras come from the
// catalog's `req` and are fetched once per range, then reused by later reports
// (the cache holds raw pieces — a report must never inherit a previous
// report's half-filled data object).
async function _fetchData(from, to, report) {
    if (!_rawCache || _rawCache.from !== from || _rawCache.to !== to) {
        _rawCache = { from, to, orders: await _fetchOrders(from, to) };
    }
    const c = _rawCache;
    const need = new Set(report.req || []);
    if (need.has('contacts') && !c.contacts) c.contacts = await get(Outlet.ref('tableSessionsContact')).then(s => s.val() || {}).catch(() => ({}));
    if (need.has('dishes') && !c.dishes) c.dishes = await get(Outlet.ref('dishes')).then(s => s.val() || {}).catch(() => ({}));
    if (need.has('staff') && !c.staff) c.staff = await get(Outlet.ref('staff')).then(s => {
        const v = s.val() || {};
        return Object.entries(v).map(([uid, st]) => ({ uid, displayName: st?.displayName || '' }));
    }).catch(() => []);
    if (need.has('attendance') && !c.attendance) {
        const raw = await get(Outlet.ref('attendance')).then(s => s.val() || {}).catch(() => ({}));
        const filtered = {};
        for (const [d, day] of Object.entries(raw)) if (d >= from && d <= to) filtered[d] = day;
        c.attendance = filtered;
    }
    const data = { orders: c.orders };
    if (c.contacts) data.contacts = c.contacts;
    if (c.dishes) data.dishes = c.dishes;
    if (c.staff) data.staff = c.staff;
    if (c.attendance) data.attendance = c.attendance;
    return data;
}

async function _fetchOrders(from, to) {
    const dFrom = new Date(from); dFrom.setDate(dFrom.getDate() - 1);
    const dTo = new Date(to); dTo.setDate(dTo.getDate() + 1);
    const qStart = `${dFrom.toISOString().split('T')[0]}T00:00:00.000Z`;
    const qEnd = `${dTo.toISOString().split('T')[0]}T23:59:59.999Z`;

    const ordersSnap = await get(query(Outlet.ref('orders'), orderByChild('createdAt'), startAt(qStart), endAt(qEnd)));
    const orders = [];
    ordersSnap.forEach(child => {
        const o = child.val();
        if (!o) return;
        const ds = getISTDateString(o.createdAt);
        if (ds >= from && ds <= to) orders.push({ id: child.key, ...o });
    });
    return orders;
}

function _renderResult(report, result, from, to) {
    const { columns, rows, colTypes } = result;
    _el('rrResultTitle').textContent = report.title;
    _el('rrTableHead').innerHTML = '<tr>' + columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';

    const body = _el('rrTableBody');
    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center;padding:24px;color:var(--text-secondary,#64748b);">No data for this range</td></tr>`;
    } else {
        body.innerHTML = rows.map(r => '<tr>' + r.map((v, i) => {
            const t = colTypes[i] || 'text';
            const cls = t === 'num' ? ' class="num"' : (t === 'money' ? ' class="money"' : '');
            const txt = v == null ? '\u2014' : (t === 'money' ? fmtMoney(v) : esc(v));
            return `<td${cls}>${txt}</td>`;
        }).join('') + '</tr>').join('');
    }

    _el('rrResultMeta').textContent = report.snapshot
        ? `${rows.length} rows \u00B7 current menu snapshot (date range not applied)`
        : `${rows.length} rows \u00B7 ${from} \u2192 ${to}`;

    // Export buttons follow the same gate as revenue groups (manager+).
    const can = _canRevenue();
    _el('btnRrCsv').style.display = can ? '' : 'none';
    _el('btnRrPrint').style.display = can ? '' : 'none';

    _el('rrSkeleton').style.display = 'none';
    _el('rrError').style.display = 'none';
    _el('rrResult').style.display = 'block';
}

function _showSkeleton() {
    _el('rrSkeleton').style.display = '';
    _el('rrResult').style.display = 'none';
    _el('rrError').style.display = 'none';
}

function _showError(msg) {
    _el('rrErrorMsg').textContent = msg;
    _el('rrError').style.display = '';
    _el('rrSkeleton').style.display = 'none';
    _el('rrResult').style.display = 'none';
}

function _exportCsv() {
    if (!_lastRun) { showToast('Generate a report first', 'warning'); return; }
    const { key, from, to, result } = _lastRun;
    const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [result.columns.map(cell).join(','), ...result.rows.map(r => r.map(cell).join(','))];
    // BOM so Excel opens ₹ correctly
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${key}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function _print() {
    if (!_lastRun) { showToast('Generate a report first', 'warning'); return; }
    window.print(); // @media print CSS strips the chrome; the table is the page
}
