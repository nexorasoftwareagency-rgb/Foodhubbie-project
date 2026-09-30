import { Outlet, tenantRef, db, ref, get, query, orderByChild, startAt, endAt } from '../firebase.js';
import { state } from '../state.js';
import { ui, getRoles } from '../ui.js';
import { showToast, formatDate, getISTDateString, formatOrderId, _loadChartJS } from '../utils.js';
import { loadJSPDF, reportHead, reportKpis, reportSection, reportContinued, reportFoot } from './printing.js';
import { initMobileAnalyticsUI, renderMobileAnalytics, cleanupMobileAnalytics } from './analytics-mobile.js';

let salesData = [];
let prevPeriodData = [];
let _isLoading = false;
let _currentOutletFilter = 'current';

/** Small claim line: "By {Role} — {Name}" for the logged-in operator. */
const _claimText = () => {
    const rd = state.adminData || {};
    const name = rd.name || rd.email || '';
    if (!name) return '';
    const k = String(rd.role || '').toLowerCase().trim();
    const label = rd.isSuper ? rd.role : (getRoles()[k]?.name || rd.role || 'Staff');
    return `By ${label} — ${name}`;
};

export function setOutletFilter(value) {
    if (!value) value = 'current';
    if (_currentOutletFilter === value) return;
    _currentOutletFilter = value;
    if (salesData.length > 0) renderFromCache();
}

export async function loadReports() {
    await _loadChartJS();

    const toVal = getISTDateString(new Date());
    const fromVal = toVal;

    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    if (fromEl) { fromEl.value = fromVal; fromEl.addEventListener('change', generateCustomReport); }
    if (toEl) { toEl.value = toVal; toEl.addEventListener('change', generateCustomReport); }

    const outletEl = document.getElementById('reportOutletFilter');
    if (outletEl) outletEl.value = _currentOutletFilter;

    console.log(`[Reports] Initializing with default range: ${fromVal} to ${toVal}`);
    const claimEl = document.getElementById('reportClaimLine');
    if (claimEl) claimEl.textContent = _claimText();
    initMobileAnalyticsUI(generateCustomReport);
    generateCustomReport();

    // Analytics sub-tab switching (Revenue | WhatsApp Bot)
    _initAnalyticsSubtabs();
}

export async function generateCustomReport() {
    if (_isLoading) return;

    const fromInput = document.getElementById('reportFrom');
    const toInput = document.getElementById('reportTo');
    const from = fromInput?.value?.trim() || '';
    const to = toInput?.value?.trim() || '';

    if (!from || !to) {
        ui.showToast('Please select both start and end dates for filtering', 'warning');
        return;
    }

    const fromDateObj = new Date(from);
    const toDateObj = new Date(to);
    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
        ui.showToast('Invalid date format selected', 'error');
        return;
    }
    if (fromDateObj > toDateObj) {
        ui.showToast('Start date must be before end date', 'warning');
        return;
    }

    _isLoading = true;
    try {
        prevPeriodData = [];
        const dFrom = new Date(from); dFrom.setDate(dFrom.getDate() - 1);
        const dTo = new Date(to); dTo.setDate(dTo.getDate() + 1);

        const qStart = `${dFrom.toISOString().split('T')[0]}T00:00:00.000Z`;
        const qEnd = `${dTo.toISOString().split('T')[0]}T23:59:59.999Z`;

        const outletFilter = document.getElementById('reportOutletFilter')?.value || 'current';
        _currentOutletFilter = outletFilter;

        const outletsToFetch = outletFilter === 'current'
            ? [window.currentOutlet || 'pizza']
            : [outletFilter];

        salesData = [];
        for (const outlet of outletsToFetch) {
            const ordersRef = outletFilter === 'current' ? Outlet.ref('orders') : tenantRef(outlet, 'orders');
            const ordersSnap = await get(
                query(ordersRef, orderByChild('createdAt'), startAt(qStart), endAt(qEnd))
            );
            ordersSnap.forEach(child => {
                const o = child.val();
                if (!o) return;
                const dateStr = getISTDateString(o.createdAt);
                if (dateStr >= from && dateStr <= to) {
                    const rawItems = o.cart || o.items || {};
                    const itemsList = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
                    const finalItems = itemsList.length ? itemsList : (o.item ? [{ name: o.item, qty: 1 }] : []);
                    const itemsStr = finalItems.length
                        ? finalItems.map(i => `${i.name || i.item || 'Item'} x${i.qty || i.quantity || 1}`).join(', ')
                        : 'No items';
                    salesData.push({ id: child.key, outlet, ...o, dateStr, itemsStr });
                }
            });
        }

        const _ms = v => typeof v === 'string' ? new Date(v).getTime() : (v || 0);
        salesData.sort((a, b) => _ms(b.createdAt) - _ms(a.createdAt));

        // Always fetch previous-period comparison — mobile KPI cards show
        // "vs Previous Period" unconditionally.
        {
            const rangeMs = new Date(to).getTime() - new Date(from).getTime();
            const prevFrom = new Date(new Date(from).getTime() - rangeMs - 86400000);
            const prevTo = new Date(new Date(from).getTime() - 86400000);
            const pFrom = prevFrom.toISOString().split('T')[0];
            const pTo = prevTo.toISOString().split('T')[0];
            const pdFrom = new Date(pFrom); pdFrom.setDate(pdFrom.getDate() - 1);
            const pdTo = new Date(pTo); pdTo.setDate(pdTo.getDate() + 1);
            const pqStart = `${pdFrom.toISOString().split('T')[0]}T00:00:00.000Z`;
            const pqEnd = `${pdTo.toISOString().split('T')[0]}T23:59:59.999Z`;

            prevPeriodData = [];
            for (const outlet of outletsToFetch) {
                const ordersRef = outletFilter === 'current' ? Outlet.ref('orders') : tenantRef(outlet, 'orders');
                const snap = await get(query(ordersRef, orderByChild('createdAt'), startAt(pqStart), endAt(pqEnd)));
                snap.forEach(child => {
                    const o = child.val();
                    if (!o) return;
                    const dateStr = getISTDateString(o.createdAt);
                    if (dateStr >= pFrom && dateStr <= pTo) {
                        prevPeriodData.push({ id: child.key, outlet, ...o, dateStr });
                    }
                });
            }
        }

        renderFromCache();
    } catch (e) {
        console.error('[Reports] Generation Error:', e);
        showToast('Error generating report', 'error');
    } finally {
        _isLoading = false;
    }
}

function renderFromCache() {
    renderMobileAnalytics(salesData, prevPeriodData).catch(e => console.error('[Reports] renderMobileAnalytics failed:', e));
}

export function cleanupReports() {
    cleanupMobileAnalytics();
    if (_waAnalyticsMod) { _waAnalyticsMod.unmount(); }
    _currentAnalyticsTab = 'revenue';
}

export function downloadExcel() {
    const filtered = _filteredForExport();
    if (filtered.length === 0) { ui.showToast('No data to export.', 'info'); return; }

    showToast('Generating Excel...', 'info');

    const data = filtered.map(o => ({
        Date: formatDate(o.createdAt),
        'Order ID': formatOrderId(o.orderId || o.id),
        Customer: o.customerName || 'Guest',
        Phone: o.phone || '',
        Outlet: (o.outlet || 'pizza').toUpperCase(),
        'Order Type': o.type || o.orderType || 'Online',
        Payment: o.paymentMethod || 'COD',
        Total: o.total || 0,
        Status: o.status,
        Items: o.itemsStr || ''
    }));

    if (typeof XLSX !== 'undefined') {
        setTimeout(() => {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sales Report');
            XLSX.writeFile(wb, `Sales_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
        }, 50);
    } else {
        ui.showToast('Excel library not loaded.', 'error');
    }
}

export async function downloadPDF() {
    await loadJSPDF();
    const filtered = _filteredForExport();
    if (filtered.length === 0) { ui.showToast('No data available to export. Generate a report first.', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') { ui.showToast('PDF table plugin not ready.', 'error'); return; }

    showToast('Generating PDF...', 'info');

    let storeName = 'FoodHubbie';
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        if (snap.exists() && snap.val().storeName) storeName = snap.val().storeName;
    } catch (_) {}

    const from = document.getElementById('reportFrom')?.value || '';
    const to = document.getElementById('reportTo')?.value || '';

    const rs = n => 'Rs.' + Math.round(Number(n || 0)).toLocaleString('en-IN');

    const totalRevenue = filtered.reduce((s, o) => s + Number(o.total || 0), 0);
    const totalOrders = filtered.length;
    const aov = totalOrders > 0 ? rs(totalRevenue / totalOrders) : '—';
    const uniqCustomers = new Set(filtered.map(o => {
        // For walk-in orders without phone/name, use orderId to distinguish
        if (o.phone) return o.phone;
        if (o.customerName) return o.customerName;
        if (o.orderId) return `walkin:${o.orderId}`;
        if (o.id) return `order:${o.id}`;
        return 'Guest';
    })).size;

    // Minimal chrome: eyebrow + store name + hairline, neutral KPI cards, ink section label
    const kpiY = reportHead(doc, {
        title: 'Sales Report',
        subtitle: storeName,
        meta: `${from} to ${to}  ·  ${totalOrders.toLocaleString('en-IN')} orders  ·  Generated ${new Date().toLocaleDateString('en-IN')}`,
        meta2: _claimText()
    });
    const secY = reportKpis(doc, [
        ['TOTAL REVENUE', rs(totalRevenue)],
        ['TOTAL ORDERS', String(totalOrders)],
        ['AVG ORDER VALUE', aov],
        ['UNIQUE CUSTOMERS', String(uniqCustomers)]
    ], kpiY);
    const startY = reportSection(doc, { label: 'DETAILED SALES DATA', right: `${totalOrders} orders`, y: secY });

    const tableData = filtered.map(o => [
        formatDate(o.createdAt),
        o.customerName || 'Guest',
        (o.outlet || 'pizza').toUpperCase(),
        o.type || o.orderType || 'Online',
        o.paymentMethod || 'COD',
        rs(o.total),
        o.itemsStr || ''
    ]);

    doc.autoTable({
        startY,
        head: [['Date', 'Customer', 'Outlet', 'Order Type', 'Payment', 'Total', 'Items']],
        body: tableData,
        foot: [['Grand Total', `${uniqCustomers} customers`, '', `${totalOrders} orders`, '', rs(totalRevenue), '']],
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
            0: { cellWidth: 26 },
            1: { cellWidth: 28 },
            2: { cellWidth: 16, halign: 'center' },
            3: { cellWidth: 20 },
            4: { cellWidth: 18 },
            5: { cellWidth: 22, halign: 'right' },
            6: { cellWidth: 52 }
        },
        margin: { top: 26, left: 14, right: 14, bottom: 18 },
        didDrawPage: () => {
            if (doc.internal.getCurrentPageInfo().pageNumber === 1) return;
            reportContinued(doc, 'Sales Report', storeName);
        },
    });

    // Footer post-pass: Page X of Y on every page
    reportFoot(doc, storeName);

    doc.setProperties({
        title: `Sales Report - ${storeName}`,
        subject: `Sales report ${from} to ${to}`,
        author: storeName,
        creator: 'FoodHubbie ERP'
    });

    doc.save(`Sales_Report_${from}_to_${to}.pdf`);
}

function _filteredForExport() {
    // Always exports everything in the selected date range, matching
    // the new Detailed Sales Data table exactly (all statuses).
    return salesData;
}

// ── Analytics sub-tab switching ────────────────────────────────────────
let _waAnalyticsMod = null;
let _currentAnalyticsTab = 'revenue';

function _initAnalyticsSubtabs() {
    document.querySelectorAll('.analytics-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.analyticsTab;
            if (tab === _currentAnalyticsTab) return;
            document.querySelectorAll('.analytics-subtab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _currentAnalyticsTab = tab;
            _switchAnalyticsPanel(tab);
        });
    });
}

async function _switchAnalyticsPanel(tab) {
    const revenuePanel = document.getElementById('reportsMobileView');
    const waPanel = document.getElementById('waBotAnalyticsPanel');

    if (tab === 'whatsapp-bot') {
        if (revenuePanel) revenuePanel.classList.add('hidden');
        if (waPanel) {
            waPanel.classList.remove('hidden');
            if (!_waAnalyticsMod) {
                _waAnalyticsMod = await import('./wa-analytics.js');
            }
            _waAnalyticsMod.mount();
        }
    } else {
        if (waPanel) waPanel.classList.add('hidden');
        if (_waAnalyticsMod) { _waAnalyticsMod.unmount(); }
        if (revenuePanel) revenuePanel.classList.remove('hidden');
    }

    // Re-render lucide icons for the newly visible panel
    try { window.lucide?.createIcons(); } catch (_) {}
}
