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

    const root = document.getElementById('tab-customers');
    if (!root) return;
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'custExportExcel') downloadCustomerExcel();
        if (btn.dataset.action === 'custExportPDF') downloadCustomerPDF();
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

    doc.setFontSize(20);
    doc.text('Customer Database', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    doc.text(`Total customers: ${_filteredData.length}`, 14, 36);

    const tableData = _filteredData.map(c => [
        c.name || 'Anonymous',
        c.displayPhone || '',
        c.address || '',
        String(c.orderCount || 0),
        `Rs.${c.ltv || 0}`
    ]);

    doc.autoTable({
        startY: 42,
        head: [['Customer', 'Phone', 'Address', 'Orders', 'Total Value']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [232, 73, 8] },
        columnStyles: { 4: { cellWidth: 50 } }
    });
    doc.save(`Customers_${new Date().toISOString().split('T')[0]}.pdf`);
}
