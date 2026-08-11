import { Outlet, get, update } from '../firebase.js';
import { showToast, logAudit, escapeHtml, formatDate, haptic, getSkeletonRows } from '../utils.js';
import { showBulkDeleteConfirm } from '../ui-utils.js';

let _allLostSales = [];
let _outletFilter = 'all';
let _sortField = 'cancelledAt';
let _sortDir = 'desc';

export async function loadLostSales() {
    const tbody = document.getElementById('lostSalesTableBody');
    const revenueBadge = document.querySelector('#lostSalesTotalRevenue span');
    const countBadge = document.getElementById('lostSalesCount');
    if (!tbody) return;

    tbody.innerHTML = getSkeletonRows(5, 9);

    try {
        const lostRef = Outlet.ref('logs/lostSales');
        const snap = await get(lostRef);
        const data = snap.val();

        _allLostSales = data ? Object.entries(data).map(([id, r]) => {
            const rawItems = r.cart || (Array.isArray(r.items) ? r.items : Object.values(r.items || {}));
            const items = rawItems.length ? rawItems : (r.item ? [{ name: r.item, size: r.size }] : []);
            const itemsStr = items.map(i => {
                const qty = i.quantity || 1;
                const price = i.total || (i.unitPrice || 0) * qty;
                return `${i.name || i.item}(${i.size || '-'}) x${qty} ₹${price}`;
            }).join(', ');
            return { _id: id, id, ...r, itemsStr };
        }) : [];

        _allLostSales.sort((a, b) => {
            const tsA = a.cancelledAt ? new Date(a.cancelledAt).getTime() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
            const tsB = b.cancelledAt ? new Date(b.cancelledAt).getTime() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
            return tsB - tsA;
        });

        _renderLostSales(revenueBadge, countBadge);
    } catch (e) {
        console.error('Load Lost Sales Error:', e);
        tbody.innerHTML = `<tr><td colspan="9" class="mob-table-empty">⚠️ Error loading data</td></tr>`;
    }
}

function _initLostTable() {
    const table = document.getElementById('lostSalesTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const filter = document.getElementById('lostSalesOutletFilter');
    if (filter) filter.addEventListener('change', (e) => {
        _outletFilter = e.target.value;
        _renderLostSales();
    });

    const sortEl = table.querySelector(`th[data-sort="${_sortField}"]`);
    if (sortEl) sortEl.classList.add(`mob-sort-${_sortDir}`);

    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_sortField === field) {
                _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _sortField = field;
                _sortDir = field === 'subtotal' || field === 'deliveryFee' || field === 'discount' || field === 'total' ? 'desc' : 'asc';
            }
            table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_sortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderLostSales();
        });
    });
}

function _renderLostSales(revenueBadge, countBadge) {
    const tbody = document.getElementById('lostSalesTableBody');
    if (!tbody) return;

    const filtered = _outletFilter === 'all'
        ? _allLostSales
        : _allLostSales.filter(r => (r.outlet || 'pizza') === _outletFilter);

    let totalLost = 0;
    filtered.forEach(r => { totalLost += (r.total || 0); });

    const rev = revenueBadge || document.querySelector('#lostSalesTotalRevenue span');
    const cnt = countBadge || document.getElementById('lostSalesCount');
    if (rev) rev.innerText = `₹${totalLost.toLocaleString()}`;
    if (cnt) cnt.innerText = String(filtered.length);

    const countEl = document.getElementById('lostSalesTableCount');
    if (countEl) countEl.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;

    _initLostTable();

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="mob-table-empty">🛍️ No lost sales found!</td></tr>`;
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        let av = a[_sortField], bv = b[_sortField];
        if (_sortField === 'subtotal' || _sortField === 'deliveryFee' || _sortField === 'discount' || _sortField === 'total') {
            av = Number(av || 0); bv = Number(bv || 0);
        } else {
            av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase();
        }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _sortDir === 'asc' ? cmp : -cmp;
    });

    tbody.innerHTML = sorted.map(r => {
        const ts = r.cancelledAt || r.timestamp || '';
        const display = ts ? formatDate(ts) : '—';
        const idTail = (r._id || '').slice(-6);
        const addr = r.address || '—';
        const addrTrunc = addr.length > 25 ? addr.substring(0, 25) + '…' : addr;
        const phoneRaw = r.phone || '';
        const cleanPhone = phoneRaw.replace(/\D/g, '').slice(-10);
        const phoneHtml = cleanPhone && cleanPhone.length >= 10
            ? `<a href="https://wa.me/91${cleanPhone}" target="_blank" rel="noopener" class="mob-td-link">📱 ${escapeHtml(phoneRaw)}</a>`
            : '<span class="mob-td-sub">—</span>';
        const outlet = (r.outlet || 'pizza').toUpperCase();
        const outletEmoji = outlet === 'CAKE' ? '🎂' : '🍕';
        const itemsStr = r.itemsStr || '—';
        const itemsTrunc = itemsStr.length > 35 ? itemsStr.substring(0, 35) + '…' : itemsStr;
        const subtotal = `₹${r.subtotal || 0}`;
        const delivery = r.deliveryFee ? `₹${r.deliveryFee}` : '<span class="mob-td-sub">—</span>';
        const discount = r.discount ? `<span style="color:#4472C4;">-₹${r.discount}${r.discountLabel ? ` (${escapeHtml(r.discountLabel)})` : ''}</span>` : '<span class="mob-td-sub">—</span>';
        const totalVal = parseInt(r.total) || 0;
        const valClass = totalVal >= 500 ? 'cell-value-high' : totalVal >= 200 ? 'cell-value-mid' : 'cell-value-low';
        return `<tr>
            <td>
                <div class="mob-td-strong">${escapeHtml(display)}</div>
                <div class="mob-td-sub">...${escapeHtml(idTail)}</div>
            </td>
            <td>
                <div class="mob-td-strong">${escapeHtml(r.customerName || 'Guest')}</div>
                <div class="mob-td-sub" title="${escapeHtml(addr)}">📍 ${escapeHtml(addrTrunc)}</div>
            </td>
            <td>${phoneHtml}</td>
            <td><span class="mob-td-sub">${outletEmoji} ${escapeHtml(outlet)}</span></td>
            <td><span class="mob-td-sub" title="${escapeHtml(itemsStr)}">${escapeHtml(itemsTrunc)}</span></td>
            <td class="mob-td-total">${subtotal}</td>
            <td>${delivery}</td>
            <td>${discount}</td>
            <td class="${valClass}" style="text-align:right;">₹${totalVal.toLocaleString()}</td>
        </tr>`;
    }).join('');
}

export async function clearLostSales() {
    if (!(await showBulkDeleteConfirm('Lost Sales'))) return;
    haptic(20);
    try {
        const outlet = (window.currentOutlet || 'pizza').toLowerCase();
        const lostSnap = await get(Outlet.ref('logs/lostSales'));
        const updates = {};
        lostSnap.forEach(child => {
            const record = child.val();
            if ((record.outlet || 'pizza') === outlet) {
                updates[child.key] = null;
            }
        });
        if (Object.keys(updates).length > 0) {
            await update(Outlet.ref('logs/lostSales'), updates);
        }
        _allLostSales = [];
        logAudit('Maintenance', `Cleared Lost Sales Logs for ${outlet}`, outlet);
        showToast('Logs cleared successfully', 'success');
        loadLostSales();
    } catch (e) {
        console.error('Clear Logs Error:', e);
        showToast('Failed to clear logs', 'error');
    }
}
