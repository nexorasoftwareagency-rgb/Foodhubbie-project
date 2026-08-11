/**
 * ROSHANI ERP | ANALYTICS UNIFIED VIEW  (Admin/js/features/analytics-mobile.js)
 * ============================================================================
 * Renders the redesigned Analytics layout (KPI cards with sparklines, Sales
 * Overview chart, Top Highlights, Payment Method donut, and a custom
 * Detailed Sales Data table) — at every screen size, not just mobile. File
 * name still says "mobile" because this started as a mobile-only build
 * before being extended to replace the desktop layout too; renaming would
 * mean updating cross-references across every file in this delivery for no
 * functional benefit.
 *
 * This is a COMPANION module to analytics.js — it does not fetch its own
 * order data; analytics.js calls renderMobileAnalytics() at the end of its
 * existing renderFromCache(), passing the same salesData / prevPeriodData
 * arrays it already fetched. The only NEW fetch here is `pizza/customers`
 * (needed for New vs Repeat Customer counts), done once per report
 * generation, mirroring the exact pattern already used in customers.js's
 * loadCustomers().
 *
 * NOTHING FROM THE OLD DESKTOP LAYOUT SURVIVES UNCHANGED except the data
 * itself. The old KPI rows, Payment Breakdown row, comparison bar, Revenue
 * Trends chart, and Order Type Distribution chart are all hidden (see
 * analytics-mobile.css) — #reportsMobileView shows at every width. The old
 * Detailed Sales Data table (Tabulator) is also hidden and fully replaced:
 * this file's _renderDataTable() renders a plain HTML <table>, not
 * Tabulator, inside a horizontally-scrolling wrapper.
 *
 * BUSINESS-LOGIC DEFINITIONS — see Guide.md for the full reasoning, briefly:
 *   New Customer    = a customer (by phone, from the `pizza/customers` node)
 *                      whose `registeredAt` falls inside the selected date range.
 *   Repeat Customer  = a customer who placed an order in the selected range
 *                      AND whose `registeredAt` is BEFORE the range start —
 *                      i.e. an existing customer who came back, not a new one.
 *   Delivered/Cancelled/Pending = computed from the SAME unfiltered order set
 *                      analytics.js already fetches (salesData), using the
 *                      same status strings orders.js's STATUS_MAPPING
 *                      already treats as canonical.
 * ============================================================================
 */
import { Outlet, tenantRef, get, ref, db, push, set, serverTimestamp } from '../firebase.js';
import { escapeHtml, showToast } from '../utils.js';

let sparkRevenue = null, sparkOrders = null, sparkAvg = null, sparkNewCust = null;
let overviewChart = null, paymentDonut = null;
let _customersCache = null, _customersFetchFailed = false;
let _reportSummary = null;
let _reportSending = false;

const PALETTE = {
    revenue: '#E84908',
    orders: '#2563eb',
    avgOrder: '#9333ea',
    newCust: '#d97706'
};

function fmtMoney(n) {
    const v = Number(n || 0);
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}
function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
function formatDateTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
        + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function deltaOf(cur, prev) {
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
}

async function fetchCustomers() {
    const snap = await get(Outlet.ref('customers'));
    const map = {};
    snap.forEach(child => { map[child.key] = child.val() || {}; });
    return map;
}

function dayKey(ts) {
    return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
function dayLabel(key, spanDays) {
    const d = new Date(key + 'T00:00:00');
    if (spanDays <= 7) return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function buildAdaptiveSeries(orders, rangeFrom, rangeTo) {
    const spanDays = Math.max(1, Math.round((new Date(rangeTo) - new Date(rangeFrom)) / 86400000) + 1);
    if (spanDays <= 31) {
        const daily = buildDailySeries(orders, o => Number(o.total || 0));
        return { ...daily, spanDays, granularity: 'day' };
    }
    const buckets = {};
    const rangeStart = new Date(rangeFrom).getTime();
    orders.forEach(o => {
        const _ms = v => typeof v === 'string' ? new Date(v).getTime() : (v || 0);
        const weekIdx = Math.floor((_ms(o.createdAt) - rangeStart) / (7 * 86400000));
        const weekStartKey = dayKey(rangeStart + weekIdx * 7 * 86400000);
        buckets[weekStartKey] = (buckets[weekStartKey] || 0) + Number(o.total || 0);
    });
    const keys = Object.keys(buckets).sort();
    return { keys, values: keys.map(k => buckets[k]), spanDays, granularity: 'week' };
}
function buildDailySeries(orders, valueFn) {
    const buckets = {};
    orders.forEach(o => {
        const k = dayKey(o.createdAt);
        buckets[k] = (buckets[k] || 0) + valueFn(o);
    });
    const keys = Object.keys(buckets).sort();
    return { keys, values: keys.map(k => buckets[k]) };
}
function buildDailyCountSeries(orders) {
    return buildDailySeries(orders, () => 1);
}

export async function renderMobileAnalytics(salesData, prevPeriodData) {
    const root = document.getElementById('reportsMobileView');
    if (!root) return;
    updateMobileDateRangeText();

    const delivered = salesData.filter(o => o.status === 'Delivered' || o.status === 'Served');
    const cancelled = salesData.filter(o => (o.status || '').toLowerCase() === 'cancelled');
    const pending = salesData.filter(o => o.status !== 'Delivered' && o.status !== 'Served' && (o.status || '').toLowerCase() !== 'cancelled');

    const curRev = delivered.reduce((s, o) => s + Number(o.total || 0), 0);
    const curOrd = delivered.length;
    const curAvg = curOrd > 0 ? curRev / curOrd : 0;

    const prevDelivered = (prevPeriodData || []).filter(o => o.status === 'Delivered' || o.status === 'Served');
    const prevRev = prevDelivered.reduce((s, o) => s + Number(o.total || 0), 0);
    const prevOrd = prevDelivered.length;
    const prevAvg = prevOrd > 0 ? prevRev / prevOrd : 0;

    if (!_customersCache) {
        try { _customersCache = await fetchCustomers(); _customersFetchFailed = false; } catch (e) { _customersCache = {}; _customersFetchFailed = true; console.error('[AnalyticsMobile] customers fetch failed', e); }
    }
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    const rangeFrom = fromEl?.value || dayKey(Date.now() - 7 * 86400000);
    const rangeTo = toEl?.value || dayKey(Date.now());

    const phonesInRange = new Set(delivered.map(o => o.phone).filter(Boolean));
    let newCustCount = 0, repeatCustCount = 0;
    phonesInRange.forEach(phone => {
        const c = _customersCache[phone];
        const registeredDate = c?.registeredAt ? dayKey(c.registeredAt) : null;
        if (registeredDate && registeredDate >= rangeFrom && registeredDate <= rangeTo) newCustCount++;
        else if (registeredDate && registeredDate < rangeFrom) repeatCustCount++;
    });
    const prevPhonesInRange = new Set(prevDelivered.map(o => o.phone).filter(Boolean));
    const periodMs = new Date(rangeTo).getTime() - new Date(rangeFrom).getTime();
    const pFromKey = dayKey(new Date(rangeFrom).getTime() - periodMs - 86400000);
    const pToKey = dayKey(new Date(rangeFrom).getTime() - 86400000);
    let prevNewCustCount = 0, prevRepeatCustCount = 0;
    prevPhonesInRange.forEach(phone => {
        const c = _customersCache[phone];
        const registeredDate = c?.registeredAt ? dayKey(c.registeredAt) : null;
        if (registeredDate && registeredDate >= pFromKey && registeredDate <= pToKey) prevNewCustCount++;
        else if (registeredDate && registeredDate < pFromKey) prevRepeatCustCount++;
    });

    _setKpi('mobKpiRevenue', fmtMoney(curRev), deltaOf(curRev, prevRev));
    _setKpi('mobKpiOrders', String(curOrd), deltaOf(curOrd, prevOrd));
    _setKpi('mobKpiAvgOrder', fmtMoney(Math.round(curAvg)), deltaOf(curAvg, prevAvg));
    _setKpi('mobKpiNewCust', _customersFetchFailed ? '\u2014' : String(newCustCount), _customersFetchFailed ? null : deltaOf(newCustCount, prevNewCustCount));

    const revSeries = buildDailySeries(delivered, o => Number(o.total || 0));
    const ordSeries = buildDailyCountSeries(delivered);
    const avgSeries = { keys: revSeries.keys, values: revSeries.values.map((v, i) => ordSeries.values[i] ? v / ordSeries.values[i] : 0) };
    const newCustByDay = {};
    revSeries.keys.forEach(k => { newCustByDay[k] = 0; });
    const firstOrderByPhone = {};
    delivered.forEach(o => {
        if (!o.phone) return;
        const _ms = v => typeof v === 'string' ? new Date(v).getTime() : (v || 0);
        const ot = _ms(o.createdAt);
        if (!firstOrderByPhone[o.phone] || ot < firstOrderByPhone[o.phone]) {
            firstOrderByPhone[o.phone] = ot;
        }
    });
    Object.entries(firstOrderByPhone).forEach(([phone, firstTs]) => {
        const c = _customersCache[phone];
        const registeredDate = c?.registeredAt ? dayKey(c.registeredAt) : null;
        if (registeredDate && registeredDate >= rangeFrom && registeredDate <= rangeTo) {
            const orderDay = dayKey(firstTs);
            if (newCustByDay[orderDay] !== undefined) newCustByDay[orderDay]++;
        }
    });
    const newCustSeries = revSeries.keys.map(k => newCustByDay[k] || 0);
    _drawSparkline('sparkRevenue', revSeries.values, PALETTE.revenue, s => sparkRevenue = s, sparkRevenue);
    _drawSparkline('sparkOrders', ordSeries.values, PALETTE.orders, s => sparkOrders = s, sparkOrders);
    _drawSparkline('sparkAvgOrder', avgSeries.values, PALETTE.avgOrder, s => sparkAvg = s, sparkAvg);
    _drawSparkline('sparkNewCust', newCustSeries, PALETTE.newCust, s => sparkNewCust = s, sparkNewCust);

    _renderOverviewChart(buildAdaptiveSeries(delivered, rangeFrom, rangeTo), curRev, deltaOf(curRev, prevRev));

    const totalForPct = salesData.length || 1;
    _setHighlight('mobHlDelivered', delivered.length, ((delivered.length / totalForPct) * 100).toFixed(1) + '%', true);
    _setHighlight('mobHlCancelled', cancelled.length, ((cancelled.length / totalForPct) * 100).toFixed(1) + '%', false);
    _setHighlight('mobHlPending', pending.length, ((pending.length / totalForPct) * 100).toFixed(1) + '%', null);
    const repeatDeltaPct = deltaOf(repeatCustCount, prevRepeatCustCount);
    _setHighlight('mobHlRepeat', repeatCustCount, repeatDeltaPct === null ? '\u2014' : pct(repeatDeltaPct), repeatDeltaPct === null ? null : repeatDeltaPct >= 0);

    const paymentTotals = { cash: 0, upi: 0, cod: 0 };
    delivered.forEach(o => {
        const pm = (o.paymentMethod || 'cod').toLowerCase();
        const bucket = pm === 'upi' ? 'upi' : (pm === 'cash' ? 'cash' : 'cod');
        paymentTotals[bucket] += Number(o.total || 0);
    });
    _renderPaymentDonut(paymentTotals, curRev);

    _renderDataTable(salesData);

    _reportSummary = {
        curRev,
        curOrd,
        curAvg,
        delivered: delivered.length,
        cancelled: cancelled.length,
        pending: pending.length,
        newCust: _customersFetchFailed ? null : newCustCount,
        repeatCust: _customersFetchFailed ? null : repeatCustCount,
        paymentTotals,
        rangeFrom,
        rangeTo
    };

    root.classList.remove('reports-mobile-loading');
}

let _tableSortField = 'createdAt', _tableSortDir = 'desc', _tableData = [];

function _badgeType(type) {
    const t = type || 'Online';
    const cls = t.toLowerCase().replace(/[- ]/g, '');
    return `<span class="mob-badge mob-badge-type-${cls}">${escapeHtml(t)}</span>`;
}
function _badgePayment(pm) {
    const p = (pm || 'COD');
    const cls = p.toLowerCase() === 'upi' ? 'upi' : (p.toLowerCase() === 'cash' ? 'cash' : 'cod');
    return `<span class="mob-badge mob-badge-pay-${cls}">${escapeHtml(p)}</span>`;
}
function _badgeStatus(status) {
    const s = status || 'Placed';
    const low = s.toLowerCase();
    const cls = (s === 'Delivered' || s === 'Served') ? 'delivered' : low === 'cancelled' ? 'cancelled' : 'pending';
    return `<span class="mob-badge mob-badge-status-${cls}">${escapeHtml(s)}</span>`;
}

function _renderDataTable(orders) {
    const tbody = document.getElementById('mobDataTableBody');
    const countEl = document.getElementById('mobTableCount');
    if (!tbody) return;
    _tableData = orders || [];
    if (countEl) countEl.textContent = `${_tableData.length} order${_tableData.length === 1 ? '' : 's'}`;

    const sorted = [..._tableData].sort((a, b) => {
        let av = a[_tableSortField], bv = b[_tableSortField];
        if (_tableSortField === 'total') { av = Number(av || 0); bv = Number(bv || 0); }
        else { av = String(av || ''); bv = String(bv || ''); }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _tableSortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="mob-table-empty">No orders found for this range.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(o => {
        const itemsShort = o.itemsStr || 'No items';
        const itemsTrunc = itemsShort.length > 40 ? itemsShort.slice(0, 40) + '\u2026' : itemsShort;
        return `<tr>
            <td>
                <div class="mob-td-strong">${formatDateTime(o.createdAt)}</div>
                <div class="mob-td-sub">#${escapeHtml(String(o.orderId || o.id || '').slice(-5).toUpperCase())}</div>
            </td>
            <td>
                <div class="mob-td-strong">${escapeHtml(o.customerName || 'Guest')}</div>
                <div class="mob-td-sub">${escapeHtml(o.phone || '')}</div>
            </td>
            <td>${_badgeStatus(o.status)}</td>
            <td>${_badgeType(o.type)}</td>
            <td>${_badgePayment(o.paymentMethod)}</td>
            <td><span class="mob-outlet-chip">${escapeHtml((o.outlet || 'pizza').toUpperCase())}</span></td>
            <td><span class="mob-td-items" title="${escapeHtml(itemsShort)}">${escapeHtml(itemsTrunc)}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">\u20B9${Number(o.total || 0).toLocaleString('en-IN')}</span></td>
        </tr>`;
    }).join('');
}

function _setKpi(prefix, value, deltaPct) {
    const valEl = document.getElementById(prefix + 'Val');
    const trendEl = document.getElementById(prefix + 'Trend');
    if (valEl) valEl.textContent = value;
    if (trendEl) {
        if (deltaPct === null || !isFinite(deltaPct)) {
            trendEl.innerHTML = `<span class="mob-trend-flat">\u2014 vs Previous Period</span>`;
        } else {
            const up = deltaPct >= 0;
            trendEl.innerHTML = `<span class="mob-trend ${up ? 'up' : 'down'}">${up ? '\u2191' : '\u2193'} ${Math.abs(deltaPct).toFixed(1)}%</span> <span class="mob-trend-sub">vs Previous Period</span>`;
        }
    }
}

function _setHighlight(id, value, subPct, isPositive) {
    const valEl = document.getElementById(id + 'Val');
    const pctEl = document.getElementById(id + 'Pct');
    if (valEl) valEl.textContent = value;
    if (pctEl) {
        pctEl.textContent = subPct;
        pctEl.className = 'mob-highlight-pct' + (isPositive === true ? ' mob-pct-good' : isPositive === false ? ' mob-pct-bad' : '');
    }
}

function _drawSparkline(canvasId, values, color, setter, existing) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (existing) { existing.destroy(); }
    const ctx = canvas.getContext('2d');
    try {
        const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: values.map((_, i) => i),
            datasets: [{
                data: values.length ? values : [0, 0],
                borderColor: color,
                backgroundColor: color + '22',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: { x: { display: false }, y: { display: false } },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            elements: { line: { capBezierPoints: true } }
        }
    });
    setter(chart);
    } catch (e) { console.warn('[AnalyticsMobile] sparkline failed:', e); }
}

function _renderOverviewChart(series, totalVal, deltaPct) {
    const canvas = document.getElementById('mobOverviewChart');
    const totalEl = document.getElementById('mobOverviewTotal');
    const trendEl = document.getElementById('mobOverviewTrend');
    if (totalEl) totalEl.textContent = fmtMoney(totalVal);
    if (trendEl && deltaPct !== null && isFinite(deltaPct)) {
        const up = deltaPct >= 0;
        trendEl.innerHTML = `<span class="mob-trend ${up ? 'up' : 'down'}">${up ? '\u2191' : '\u2193'} ${Math.abs(deltaPct).toFixed(1)}%</span> <span class="mob-trend-sub">vs Previous Period</span>`;
    }
    if (!canvas || typeof Chart === 'undefined') return;
    if (overviewChart) overviewChart.destroy();
    const labels = series.keys.map(k => dayLabel(k, series.spanDays));
    const values = series.values;
    const peakIdx = values.length ? values.indexOf(Math.max(...values)) : -1;

    try {
    overviewChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['\u2014'],
            datasets: [{
                data: values.length ? values : [0],
                borderColor: PALETTE.revenue,
                backgroundColor: (ctx) => {
                    const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
                    g.addColorStop(0, PALETTE.revenue + '80');
                    g.addColorStop(0.6, PALETTE.revenue + '20');
                    g.addColorStop(1, PALETTE.revenue + '02');
                    return g;
                },
                borderWidth: 3,
                pointRadius: values.map((_, i) => i === peakIdx ? 6 : 4),
                pointBackgroundColor: values.map((_, i) => i === peakIdx ? PALETTE.revenue : '#fff'),
                pointBorderColor: PALETTE.revenue,
                pointBorderWidth: 2,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(15,23,42,.06)' }, ticks: { callback: v => '\u20B9' + (v >= 1000 ? (v / 1000) + 'K' : v), font: { size: 10 }, color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, color: '#64748b', maxTicksLimit: 8, autoSkip: true } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#fdba74',
                    bodyColor: '#fff',
                    padding: 10,
                    cornerRadius: 10,
                    displayColors: false,
                    callbacks: {
                        title: (items) => fmtMoney(items[0].parsed.y),
                        label: (item) => item.label
                    }
                }
            }
        }
    });
    } catch (e) { console.warn('[AnalyticsMobile] overview chart failed:', e); }
}

function _renderPaymentDonut(totals, grandTotal) {
    const canvas = document.getElementById('mobPaymentDonut');
    const centerTotalEl = document.getElementById('mobDonutCenterTotal');
    if (centerTotalEl) centerTotalEl.textContent = fmtMoney(grandTotal);

    const entries = [
        { key: 'upi', label: 'UPI Payments', color: PALETTE.revenue },
        { key: 'cash', label: 'Cash Payments', color: '#15803d' },
        { key: 'cod', label: 'COD Payments', color: '#2563eb' }
    ];
    const sum = totals.upi + totals.cash + totals.cod || 1;
    const legendEl = document.getElementById('mobPaymentLegend');
    if (legendEl) {
        legendEl.innerHTML = entries.map(e => {
            const val = totals[e.key] || 0;
            const p = Math.round((val / sum) * 100);
            return `<div class="mob-legend-row">
                <span class="mob-legend-dot" style="background:${e.color}"></span>
                <span class="mob-legend-label">${escapeHtml(e.label)}</span>
                <span class="mob-legend-val">${fmtMoney(val)}</span>
                <span class="mob-legend-pct" style="background:${e.color}">${p}%</span>
            </div>`;
        }).join('');
    }
    if (!canvas || typeof Chart === 'undefined') return;
    if (paymentDonut) paymentDonut.destroy();
    try {
    paymentDonut = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: entries.map(e => e.label),
            datasets: [{ data: entries.map(e => totals[e.key] || 0), backgroundColor: entries.map(e => e.color), borderWidth: 3, borderColor: '#fff' }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '72%',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => fmtMoney(item.parsed) } } }
        }
    });
    } catch (e) { console.warn('[AnalyticsMobile] payment donut failed:', e); }
}

export function applyQuickRange(preset, regenerateFn) {
    const to = new Date();
    const from = new Date();
    if (preset === 'today') { /* from = to, same day */ }
    else if (preset === '7d') from.setDate(to.getDate() - 6);
    else if (preset === '30d') from.setDate(to.getDate() - 29);
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    if (fromEl) fromEl.value = from.toISOString().split('T')[0];
    if (toEl) toEl.value = to.toISOString().split('T')[0];
    document.querySelectorAll('.mob-range-pill').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    if (typeof regenerateFn === 'function') regenerateFn();
}

export function cleanupMobileAnalytics() {
    [sparkRevenue, sparkOrders, sparkAvg, sparkNewCust, overviewChart, paymentDonut].forEach(c => { try { c?.destroy(); } catch (e) {} });
    sparkRevenue = sparkOrders = sparkAvg = sparkNewCust = overviewChart = paymentDonut = null;
    _customersCache = null;
    _customersFetchFailed = false;
}

export function initMobileAnalyticsUI(regenerateFn) {
    const root = document.getElementById('reportsMobileView');
    if (!root || root.dataset.wired) return;
    root.dataset.wired = '1';

    const datesHost = document.getElementById('mobInlineDates');
    const filtersHost = document.getElementById('mobInlineFilters');
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    const outletEl = document.getElementById('reportOutletFilter');
    if (datesHost && fromEl && toEl) { datesHost.appendChild(fromEl); datesHost.appendChild(toEl); }
    if (filtersHost && outletEl) { filtersHost.appendChild(outletEl); }

    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        let handled = false;
        switch (btn.dataset.action) {
            case 'mobToggleCustomDates':
                datesHost?.classList.toggle('hidden');
                filtersHost?.classList.add('hidden');
                handled = true;
                break;
            case 'mobToggleFilters':
                filtersHost?.classList.toggle('hidden');
                datesHost?.classList.add('hidden');
                handled = true;
                break;
            case 'mobExportExcel':
                document.getElementById('btnDownloadExcel')?.click();
                handled = true;
                break;
            case 'mobExportPDF':
                document.getElementById('btnDownloadPDF')?.click();
                handled = true;
                break;
            case 'mobSendToAdmin':
                _sendReportToAdmin();
                handled = true;
                break;
        }
        if (handled) e.stopPropagation();
    });

    root.querySelectorAll('.mob-range-pill[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.preset === 'custom') return;
            applyQuickRange(btn.dataset.preset, regenerateFn);
        });
    });

    document.querySelectorAll('#mobDataTable th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_tableSortField === field) {
                _tableSortDir = _tableSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _tableSortField = field;
                _tableSortDir = field === 'total' || field === 'createdAt' ? 'desc' : 'asc';
            }
            document.querySelectorAll('#mobDataTable th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_tableSortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderDataTable(_tableData);
        });
    });

    import('../state.js').then(({ state }) => {
        const nameEl = document.getElementById('mobOutletName');
        if (nameEl) nameEl.textContent = (state.currentOutlet || 'pizza').toUpperCase();
    }).catch(() => {});
}

async function _sendReportToAdmin() {
    if (_reportSending) { showToast('Already sending a report, please wait.', 'info'); return; }
    if (!_reportSummary) { showToast('No report loaded. Generate the report first.', 'info'); return; }

    const s = _reportSummary;
    const span = (s.rangeFrom === s.rangeTo) ? s.rangeFrom : `${s.rangeFrom} → ${s.rangeTo}`;
    const lines = [
        `📊 *SALES REPORT* — ${(window.currentOutlet || 'pizza').toUpperCase()}`,
        ``,
        `📅 *Period:* ${span}`,
        ``,
        `💰 *Total Revenue:* ${fmtMoney(s.curRev)}`,
        `📦 *Total Orders:* ${s.curOrd}`,
        `🧾 *Avg. Order Value:* ${fmtMoney(Math.round(s.curAvg))}`,
        `🆕 *New Customers:* ${s.newCust === null ? '—' : s.newCust}`,
        `🔁 *Repeat Customers:* ${s.repeatCust === null ? '—' : s.repeatCust}`,
        ``,
        `┌─ *Order Status*`,
        `│ ✅ Delivered: ${s.delivered}`,
        `│ ❌ Cancelled: ${s.cancelled}`,
        `│ ⏳ Pending: ${s.pending}`,
        `└──────────────`,
        ``,
        `💳 *Payment Split:*`,
        `   💵 Cash: ${fmtMoney(s.paymentTotals.cash)}`,
        `   📱 UPI: ${fmtMoney(s.paymentTotals.upi)}`,
        `   🚚 COD: ${fmtMoney(s.paymentTotals.cod)}`,
        ``,
        `_Sent automatically by ${(window.currentOutlet || 'pizza').toUpperCase()} Bot_`
    ];

    _reportSending = true;
    try {
        const phone = await _resolveAdminPhone();
        if (!phone) { showToast('No admin phone in store settings.', 'error'); return; }

        const outlet = window.currentOutlet || 'pizza';
        const cmdRef = push(tenantRef(outlet, 'bot/commands'));
        await set(cmdRef, { action: "SEND_GENERIC_MESSAGE", phone, message: lines.join('\n'), timestamp: serverTimestamp() });
        showToast('Report sent to admin via bot.', 'success');
    } catch (e) {
        console.error('[AnalyticsMobile] Bot send failed:', e);
        showToast('Failed to queue bot message.', 'error');
    } finally {
        _reportSending = false;
    }
}

async function _resolveAdminPhone() {
    try {
        const store = await get(Outlet.ref('settings/Store'));
        const delivery = await get(Outlet.ref('settings/Delivery'));
        const raw = (store.exists() && (store.val().phone || store.val().whatsappNumber)) ||
            (delivery.exists() && (delivery.val().notifyPhone || delivery.val().reportPhone));
        return String(raw || '').replace(/[^0-9]/g, '').slice(-10);
    } catch (e) {
        console.error('[AnalyticsMobile] Admin phone resolve failed:', e);
        return '';
    }
}

export function updateMobileDateRangeText() {
    const el = document.getElementById('mobDateRangeText');
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    if (!el || !fromEl?.value || !toEl?.value) return;
    const from = new Date(fromEl.value + 'T00:00:00');
    const to = new Date(toEl.value + 'T23:59:59');
    const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    el.textContent = `${fmt(from)} \u2013 ${fmt(to)}`;
}