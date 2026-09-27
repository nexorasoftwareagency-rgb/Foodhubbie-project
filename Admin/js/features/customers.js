import { Outlet, get } from '../firebase.js';
import { escapeHtml, showToast } from '../utils.js';
import { logger } from '../utils/logger.js';
import { loadJSPDF } from './printing.js';

let _customerData = [];
let _filteredData = [];
let _sortField = 'ltv', _sortDir = 'desc';
let _searchTerm = '';

function fmtMoney(n) {
    const v = Number(n || 0);
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}

function _renderCustomerTable() {
    const tbody = document.getElementById('customerDataTableBody');
    const countEl = document.getElementById('custTableCount');
    if (!tbody) return;

    let data = _customerData;
    const term = _searchTerm.trim().toLowerCase();
    if (term) {
        data = data.filter(c =>
            (c.name || '').toLowerCase().includes(term) ||
            (c.displayPhone || '').includes(term) ||
            (c.address || '').toLowerCase().includes(term)
        );
    }
    _filteredData = data;

    if (countEl) countEl.textContent = `${data.length} customer${data.length === 1 ? '' : 's'}`;

    const sorted = [...data].sort((a, b) => {
        let av = a[_sortField], bv = b[_sortField];
        if (_sortField === 'orderCount' || _sortField === 'ltv') { av = Number(av || 0); bv = Number(bv || 0); }
        else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _sortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="mob-table-empty">${term ? 'No customers match your search.' : 'No customers found.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(c => {
        const phone = c.phoneClean || '';
        const waLink = phone.length >= 10
            ? `<a href="https://wa.me/91${phone}" target="_blank" rel="noopener" class="mob-wa-link"><i data-lucide="message-circle" style="width:12px;height:12px;"></i> ${escapeHtml(c.displayPhone || '')}</a>`
            : `<span class="mob-td-sub">${escapeHtml(c.displayPhone || '—')}</span>`;
        const addr = c.address || '—';
        const addrFull = c.addressFull || '';
        const mapLink = c.locationLink
            ? ` <a href="${escapeHtml(c.locationLink)}" target="_blank" rel="noopener" class="mob-map-link">MAP</a>`
            : '';
        return `<tr>
            <td>
                <div class="mob-cust-name">
                    <span class="mob-cust-avatar">👤</span>
                    <div>
                        <div class="mob-td-strong">${escapeHtml(c.name || 'Anonymous')}</div>
                        <div class="mob-td-sub">Joined: ${escapeHtml(c.joined || 'N/A')}</div>
                    </div>
                </div>
            </td>
            <td>${waLink}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(addrFull)}">${escapeHtml(addr)}</span>${mapLink}</td>
            <td class="mob-th-center"><span class="mob-order-count">${c.orderCount || 0}</span><div class="mob-td-sub">purchases</div></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(c.ltv || 0)}</span></td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

export function filterCustomers(searchTerm) {
    _searchTerm = (searchTerm || '').trim();
    _renderCustomerTable();
}

export async function loadCustomers() {
    const tbody = document.getElementById('customerDataTableBody');
    if (!tbody) {
        logger.warn('CUSTOMERS', 'Customers table not found, skipping load');
        return;
    }

    tbody.innerHTML = `<tr><td colspan="5" style="padding:40px;text-align:center;color:var(--mob-sub);font-weight:600;">Loading customers...</td></tr>`;
    logger.info('CUSTOMERS', 'Loading customers from Firebase...');

    try {
        const [custSnap, orderSnap] = await Promise.all([
            get(Outlet.ref("customers")),
            get(Outlet.ref("orders"))
        ]);
        const orders = [];
        orderSnap.forEach(o => { orders.push(o.val()); });

        const customers = [];
        custSnap.forEach(child => {
            const c = child.val();
            const phone = child.key;
            const myOrders = orders.filter(o => o.phone === phone);
            const orderCount = myOrders.length;
            const ltv = myOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
            customers.push({
                name: c.name || 'Anonymous',
                joined: c.registeredAt ? new Date(c.registeredAt).toLocaleDateString() : 'N/A',
                displayPhone: phone,
                phoneClean: phone.replace(/\D/g, "").slice(-10),
                address: c.address ? (c.address.length > 30 ? c.address.substring(0, 30) + "..." : c.address) : "Counter Sale / Guest",
                addressFull: c.address || '',
                locationLink: c.locationLink || '',
                orderCount, ltv
            });
        });

        _customerData = customers;
        _renderCustomerTable();

        initCustomerTable();

        logger.success('CUSTOMERS', `Loaded ${customers.length} customers`);
    } catch (e) {
        console.error('[Customers] Load error:', e);
        tbody.innerHTML = `<tr><td colspan="5" style="padding:40px;text-align:center;color:#ef4444;font-weight:600;">⚠️ Error loading customers</td></tr>`;
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
                _sortDir = field === 'orderCount' || field === 'ltv' ? 'desc' : 'asc';
            }
            ths.forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_sortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderCustomerTable();
        });
    });
}

export function downloadCustomerExcel() {
    if (_filteredData.length === 0) { showToast('No customer data to export.', 'info'); return; }
    showToast('Generating Excel...', 'info');

    const data = _filteredData.map(c => ({
        Customer: c.name || 'Anonymous',
        Phone: c.displayPhone || '',
        Address: c.addressFull || c.address || '',
        Orders: c.orderCount || 0,
        'Total Value (₹)': c.ltv || 0
    }));

    if (typeof XLSX !== 'undefined') {
        setTimeout(() => {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Customers');
            XLSX.writeFile(wb, `Customers_${new Date().toISOString().split('T')[0]}.xlsx`);
        }, 50);
    } else {
        showToast('Excel library not loaded.', 'error');
    }
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

    const primary = [232, 73, 8]; // #E84908
    const ink = [15, 23, 42]; // #0F172A
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const M = 14;
    const rs = n => 'Rs.' + Math.round(Number(n || 0)).toLocaleString('en-IN');
    const mix = (a, b, t) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return a;
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
};

    const rows = _filteredData;
    const totalOrders = rows.reduce((s, c) => s + Number(c.orderCount || 0), 0);
    const totalRevenue = rows.reduce((s, c) => s + Number(c.ltv || 0), 0);
    const aov = totalOrders > 0 ? rs(totalRevenue / totalOrders) : '—';

    // Hero band: gradient via interpolated slices + translucent decorative circles
    const heroH = 54, steps = 54;
    const A = [176, 47, 6], B = [232, 73, 8], C = [255, 132, 56];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        doc.setFillColor(...(t < 0.5 ? mix(A, B, t * 2) : mix(B, C, (t - 0.5) * 2)));
        doc.rect(0, heroH * i / steps, pw, heroH / steps + 0.6, 'F');
    }
    doc.setGState(new doc.GState({ opacity: 0.1 }));
    doc.setFillColor(255, 255, 255);
    doc.circle(pw - 26, 14, 28, 'F');
    doc.circle(pw - 74, 47, 13, 'F');
    doc.circle(20, 52, 20, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));

    // FH badge + brand block: FOODHUBBIE eyebrow, restaurant name as headline
    doc.setFillColor(255, 255, 255);
    doc.circle(M + 13, 22, 12.5, 'F');
    doc.setTextColor(...primary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FH', M + 13, 27, { align: 'center' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text('FOODHUBBIE', M + 30, 13.5, { charSpace: 2.2 });
    let nameSize = 21;
    doc.setFontSize(nameSize);
    const nameW = doc.getTextWidth(storeName);
    const nameMax = pw - (M + 30) - M;
    if (nameW > nameMax) nameSize = Math.max(12, nameSize * nameMax / nameW);
    doc.setFontSize(nameSize);
    doc.text(storeName, M + 30, 27);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 220, 205);
    doc.text(`Customer Database Report  ·  Generated ${new Date().toLocaleString('en-IN')}  ·  ${rows.length} customers  ·  Meeting Copy`, M + 30, 35);

    // KPI stat cards overlapping the hero edge
    const cardY = 46, cardH = 26, gap = 6;
    const cardW = (pw - 2 * M - 3 * gap) / 4;
    const kpis = [
        ['TOTAL CUSTOMERS', String(rows.length)],
        ['TOTAL ORDERS', totalOrders.toLocaleString('en-IN')],
        ['TOTAL REVENUE', rs(totalRevenue)],
        ['AVG ORDER VALUE', aov]
    ];
    kpis.forEach(([label, value], i) => {
        const x = M + i * (cardW + gap);
        doc.setFillColor(234, 228, 224);
        doc.roundedRect(x + 0.7, cardY + 0.9, cardW, cardH, 3, 3, 'F');
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, cardY, cardW, cardH, 3, 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(150, 145, 140);
        doc.text(label, x + 5, cardY + 10, { charSpace: 0.3 });
        doc.setFontSize(12);
        doc.setTextColor(...ink);
        doc.text(value, x + 5, cardY + 21);
    });

    // Section label
    doc.setFillColor(...primary);
    doc.rect(M, 85, 3.5, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    doc.text('CUSTOMER DIRECTORY', M + 6, 89.5, { charSpace: 0.5 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 136, 130);
    doc.text(`${rows.length} records`, pw - M, 89.5, { align: 'right' });

    const tableData = rows.map(c => [
        c.name || 'Anonymous',
        c.displayPhone || '',
        c.addressFull || c.address || '—',
        String(c.orderCount || 0),
        rs(c.ltv)
    ]);

    doc.autoTable({
        head: [['Customer', 'Phone', 'Address', 'Orders', 'Total Value']],
        body: tableData,
        foot: [['Grand Total', `${rows.length} customers`, '', String(totalOrders), rs(totalRevenue)]],
        showFoot: 'lastPage',
        rowPageBreak: 'avoid',
        theme: 'grid',
        headStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, lineColor: ink, lineWidth: 0.2 },
        bodyStyles: {
            fontSize: 8, textColor: [30, 41, 59], lineColor: [236, 231, 227], lineWidth: 0.2, valign: 'middle',
            cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 }
        },
        alternateRowStyles: { fillColor: [255, 247, 243] },
        footStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, lineColor: ink, lineWidth: 0.2 },
        columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 30, halign: 'center' },
            2: { cellWidth: 60 },
            3: { cellWidth: 18, halign: 'center' },
            4: { cellWidth: 34, halign: 'right' }
        },
        margin: { top: 26, left: M, right: M, bottom: 18 },
        startY: 96,
        didDrawPage: () => {
            if (doc.internal.getCurrentPageInfo().pageNumber === 1) return;
            doc.setFillColor(255, 249, 246);
            doc.rect(0, 0, pw, 22, 'F');
            doc.setFillColor(...primary);
            doc.rect(0, 0, pw, 2.6, 'F');
            doc.circle(M + 7, 13, 7, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text('FH', M + 7, 16.2, { align: 'center' });
            doc.setTextColor(...ink);
            doc.setFontSize(10);
            doc.text('Customer Database', M + 18, 12);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8.5);
            doc.setTextColor(...primary);
            doc.text(storeName, M + 18, 17.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(140, 136, 130);
            doc.text('Continued', pw - M, 14.5, { align: 'right' });
        },
    });

    // Footer post-pass: Page X of Y on every page
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setDrawColor(236, 231, 227);
        doc.setLineWidth(0.3);
        doc.line(M, ph - 14, pw - M, ph - 14);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 143, 138);
        doc.text(`Powered by FoodHubbie ERP  ·  ${storeName}`, M, ph - 9);
        doc.text(`Page ${p} of ${totalPages}`, pw - M, ph - 9, { align: 'right' });
    }

    doc.setProperties({
        title: `Customer Database - ${storeName}`,
        subject: 'Customer export',
        author: storeName,
        creator: 'FoodHubbie ERP'
    });

    doc.save(`Customers_${new Date().toISOString().split('T')[0]}.pdf`);
}
