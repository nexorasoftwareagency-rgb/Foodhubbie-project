import { Outlet, db, ref, get, query, orderByChild, startAt, endAt } from '../firebase.js';
import { ui } from '../ui.js';
import { showToast, formatDate, getISTDateString } from '../utils.js';
import { loadJSPDF } from './printing.js';
import { initMobileAnalyticsUI, renderMobileAnalytics, cleanupMobileAnalytics } from './analytics-mobile.js';

let salesData = [];
let prevPeriodData = [];
let _isLoading = false;
let _currentOutletFilter = 'current';
let _chartJSPromise = null;

async function loadChartJS() {
    if (_chartJSPromise) return _chartJSPromise;
    _chartJSPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm').then(m => {
        const C = m.Chart;
        if (C && C.register && m.CategoryScale) {
            C.register(m.CategoryScale, m.LinearScale, m.LineElement, m.PointElement, m.LineController, m.ArcElement, m.DoughnutController, m.Tooltip, m.Legend, m.Filler);
        }
        window.Chart = C;
        return m;
    }).catch(e => { _chartJSPromise = null; throw e; });
    await _chartJSPromise;
}

export function setOutletFilter(value) {
    if (!value) value = 'current';
    if (_currentOutletFilter === value) return;
    _currentOutletFilter = value;
    if (salesData.length > 0) renderFromCache();
}

export async function loadReports() {
    await loadChartJS();

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const fromVal = getISTDateString(yesterday);
    const toVal = getISTDateString(today);

    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    if (fromEl) { fromEl.value = fromVal; fromEl.addEventListener('change', generateCustomReport); }
    if (toEl) { toEl.value = toVal; toEl.addEventListener('change', generateCustomReport); }

    const outletEl = document.getElementById('reportOutletFilter');
    if (outletEl) outletEl.value = _currentOutletFilter;

    console.log(`[Reports] Initializing with default range: ${fromVal} to ${toVal}`);
    initMobileAnalyticsUI(generateCustomReport);
    generateCustomReport();
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
            const ordersRef = outletFilter === 'current' ? Outlet.ref('orders') : ref(db, `${outlet}/orders`);
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
                const ordersRef = outletFilter === 'current' ? Outlet.ref('orders') : ref(db, `${outlet}/orders`);
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
}

export function downloadExcel() {
    const filtered = _filteredForExport();
    if (filtered.length === 0) { ui.showToast('No data to export.', 'info'); return; }

    showToast('Generating Excel...', 'info');

    const data = filtered.map(o => ({
        Date: formatDate(o.createdAt),
        'Order ID': o.orderId || o.id,
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

    doc.setFontSize(20);
    doc.text('Sales Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);

    const from = document.getElementById('reportFrom')?.value || '';
    const to = document.getElementById('reportTo')?.value || '';
    doc.text(`Period: ${from} to ${to}`, 14, 30);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 42);

    const tableData = filtered.map(o => [
        formatDate(o.createdAt),
        o.customerName || 'Guest',
        (o.outlet || 'pizza').toUpperCase(),
        o.type || o.orderType || 'Online',
        o.paymentMethod || 'COD',
        `Rs.${o.total}`,
        o.itemsStr || ''
    ]);

    doc.autoTable({
        startY: 48,
        head: [['Date', 'Customer', 'Outlet', 'Order Type', 'Payment', 'Total', 'Items']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [6, 95, 70] },
        columnStyles: { 5: { cellWidth: 50 } }
    });
    doc.save(`Sales_Report_${from}_to_${to}.pdf`);
}

function _filteredForExport() {
    // Always exports everything in the selected date range, matching
    // the new Detailed Sales Data table exactly (all statuses).
    return salesData;
}
