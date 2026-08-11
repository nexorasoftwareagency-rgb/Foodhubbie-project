/**
 * PAYMENTS TAB — mob-data-table (plain HTML, no Tabulator)
 * Called from orders.js renderOrders() when activeTab === 'payments'.
 */

import { escapeHtml } from '../utils.js';

let _payData = [];
let _paySortField = 'createdAt', _paySortDir = 'desc';

function _badgePayment(pm) {
    const p = (pm || 'Cash');
    const cls = p.toLowerCase() === 'upi' ? 'upi' : (p.toLowerCase() === 'cash' ? 'cash' : 'cod');
    return `<span class="mob-badge mob-badge-pay-${cls}">${escapeHtml(p)}</span>`;
}

function _badgeStatus(status) {
    const s = status || 'Placed';
    const low = s.toLowerCase();
    const cls = (s === 'Delivered' || s === 'Served') ? 'delivered' : low === 'cancelled' ? 'cancelled' : 'pending';
    return `<span class="mob-badge mob-badge-status-${cls}">${escapeHtml(s)}</span>`;
}

function formatDateTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
        + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function _renderPayTable() {
    const tbody = document.getElementById('payDataTableBody');
    const countEl = document.getElementById('payTableCount');
    if (!tbody) return;

    if (countEl) countEl.textContent = `${_payData.length} payment${_payData.length === 1 ? '' : 's'}`;

    const sorted = [..._payData].sort((a, b) => {
        let av = a[_paySortField], bv = b[_paySortField];
        if (_paySortField === 'total') { av = Number(av || 0); bv = Number(bv || 0); }
        else if (_paySortField === 'createdAt') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
        else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _paySortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="mob-table-empty">No payments found.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(o => {
        const id = o.orderId || (o.id ? o.id.slice(-5).toUpperCase() : 'N/A');
        return `<tr>
            <td>
                <div class="mob-td-strong">${formatDateTime(o.createdAt)}</div>
                <div class="mob-td-sub">#${escapeHtml(id)}</div>
            </td>
            <td>
                <div class="mob-td-strong">${escapeHtml(o.customerName || 'Guest')}</div>
                <div class="mob-td-sub">${escapeHtml(o.phone || '')}</div>
            </td>
            <td>${_badgePayment(o.paymentMethod)}</td>
            <td>${_badgeStatus(o.status)}</td>
            <td><span class="mob-outlet-chip">${escapeHtml((o.outlet || 'pizza').toUpperCase())}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">\u20B9${Number(o.total || 0).toLocaleString('en-IN')}</span></td>
        </tr>`;
    }).join('');
}

function _initPayTable() {
    const table = document.getElementById('payDataTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const sortEl = table.querySelector(`th[data-sort="${_paySortField}"]`);
    if (sortEl) sortEl.classList.add(`mob-sort-${_paySortDir}`);

    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_paySortField === field) {
                _paySortDir = _paySortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _paySortField = field;
                _paySortDir = field === 'total' || field === 'createdAt' ? 'desc' : 'asc';
            }
            table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_paySortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderPayTable();
        });
    });
}

export function renderPayments(orders) {
    _payData = orders || [];
    if (_payData.length > 0 && !document.getElementById('payDataTable')?.dataset.wired) {
        _initPayTable();
    }
    _renderPayTable();
}
