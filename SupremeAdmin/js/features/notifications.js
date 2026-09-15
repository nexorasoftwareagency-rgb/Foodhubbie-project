/**
 * Notifications — inquiries/bookings submitted from the public website
 * (website/book.html writes to the `inquiries` node; this page reads them).
 * Live listener, new/read tracking, WhatsApp reply links, CSV export.
 * Support (read-only) accounts can view but not mark-read.
 */
import { registerAction } from '/js/main.js';
import { isReadOnly } from '/js/data-store.js';
import { exportXlsx, refreshIcons, escapeHtml, debounce, showToast, showConfirm } from '/js/utils.js';

const mainEl = document.getElementById('app-main');
let inquiries = [];
let filter = 'all';
let search = '';
let ref = null;
let onValue = null;

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Notifications</h1>
        <div class="panel-sub">Inquiries &amp; bookings from the FoodHubbie website
          <span class="live-badge"><span class="pulse-dot"></span>Live</span>
        </div>
      </div>
      <div class="panel-header-actions">
        <button class="btn btn-ghost" data-action="export-inquiries-xlsx"><svg data-lucide="download"></svg> Export Excel</button>
      </div>
    </div>

    <div class="table-kpi-grid" id="inquiry-kpis"></div>

    <div class="filters-row">
      <div class="search-input-wrap">
        <svg data-lucide="search"></svg>
        <input type="text" class="text-input" id="inquiry-search" placeholder="Search name, phone, message…" />
      </div>
      <select class="text-input" id="inquiry-filter">
        <option value="all">All</option>
        <option value="new">New</option>
        <option value="read">Read</option>
      </select>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden">
      <table class="data-table" id="inquiry-table">
        <thead>
          <tr>
            <th scope="col">Received</th>
            <th scope="col">Contact</th>
            <th scope="col">Type</th>
            <th scope="col">Message</th>
            <th scope="col">Status</th>
            <th scope="col" style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody id="inquiry-tbody">
          <tr><td colspan="6"><div class="table-empty">Loading notifications…</div></td></tr>
        </tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  registerAction('export-inquiries-xlsx', exportInquiriesXlsx);
  registerAction('mark-inquiry-read', markRead);

  document.getElementById('inquiry-search').addEventListener('input', debounce(() => {
    search = document.getElementById('inquiry-search').value.trim().toLowerCase();
    renderRows();
  }, 150));
  document.getElementById('inquiry-filter').addEventListener('change', () => {
    filter = document.getElementById('inquiry-filter').value;
    renderRows();
  });

  onValue = (snap) => {
    const val = snap.val() || {};
    inquiries = Object.entries(val)
      .map(([id, q]) => ({ id, ...q }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderRows();
  };
  ref = firebase.database().ref('inquiries');
  ref.on('value', onValue);

  const tick = setInterval(renderRows, 30000);
  return () => {
    ref.off('value', onValue);
    clearInterval(tick);
  };
}

function filteredRows() {
  const rows = filter === 'all' ? inquiries : inquiries.filter((q) => (q.status === 'read') === (filter === 'read'));
  if (!search) return rows;
  return rows.filter((q) =>
    (q.name || '').toLowerCase().includes(search) ||
    (q.phone || '').toLowerCase().includes(search) ||
    (q.message || '').toLowerCase().includes(search) ||
    (q.type || '').toLowerCase().includes(search)
  );
}

function renderRows() {
  const rows = filteredRows();
  const newCount = inquiries.filter((q) => q.status !== 'read').length;
  const today = new Date().setHours(0, 0, 0, 0);
  const todayCount = inquiries.filter((q) => (q.createdAt || 0) >= today).length;

  const kpis = document.getElementById('inquiry-kpis');
  if (kpis) kpis.innerHTML = `
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Total inquiries</div>
      <div class="kpi-value">${inquiries.length}</div>
    </div>
    <div class="glass-card kpi-tile accent-online">
      <div class="kpi-label">New / unread</div>
      <div class="kpi-value">${newCount}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Received today</div>
      <div class="kpi-value">${todayCount}</div>
    </div>`;

  const tbody = document.getElementById('inquiry-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="table-empty">No inquiries yet. Bookings submitted from the website appear here.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((q) => {
    const isNew = q.status !== 'read';
    const phoneDigits = String(q.phone || '').replace(/\D/g, '');
    const location = [q.store, q.city].filter(Boolean).join(' · ');
    return `
      <tr${isNew ? ' class="row-link"' : ''}>
        <td><strong>${formatAge(q.createdAt)}</strong><div class="cell-meta">${formatDate(q.createdAt)}</div></td>
        <td>
          <strong>${escapeHtml(q.name || '—')}</strong>
          <div class="cell-meta"><a href="tel:${escapeHtml(q.phone)}">${escapeHtml(q.phone)}</a></div>
          ${location ? `<div class="cell-meta">${escapeHtml(location)}</div>` : ''}
        </td>
        <td><span class="status-pill ${isNew ? 'online' : 'unknown'}"><span class="static-dot"></span>${escapeHtml(q.type || 'Inquiry')}</span></td>
        <td style="max-width:280px"><div class="cell-meta" style="white-space:normal">${escapeHtml(q.message || '')}</div></td>
        <td>${isNew
          ? '<span class="status-pill online"><span class="pulse-dot"></span>New</span>'
          : '<span class="status-pill unknown"><span class="static-dot"></span>Read</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${!isNew || isReadOnly() ? '' : `<button class="btn btn-ghost btn-sm" data-action="mark-inquiry-read" data-id="${escapeHtml(q.id)}"><svg data-lucide="check-check"></svg> Mark read</button>`}
          <a class="btn btn-ghost btn-sm" href="https://wa.me/${phoneDigits}" target="_blank" rel="noopener"><svg data-lucide="message-circle"></svg> Reply</a>
        </td>
      </tr>`;
  }).join('');
  refreshIcons(tbody);
}

async function markRead(btn) {
  const id = btn?.dataset?.id;
  if (!id) return;
  btn.disabled = true;
  try {
    await firebase.database().ref(`inquiries/${id}`).child('status').set('read');
    showToast('Marked as read', 'success');
  } catch (err) {
    console.error('Failed to mark read', err);
    showToast('Could not update inquiry.', 'error');
    btn.disabled = false;
  }
}

function exportInquiriesXlsx() {
  exportXlsx('inquiries', [
    { key: 'createdAt', label: 'Received' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'store', label: 'Restaurant' },
    { key: 'city', label: 'City' },
    { key: 'type', label: 'Type' },
    { key: 'message', label: 'Message' },
    { key: 'status', label: 'Status' },
  ], filteredRows().map((q) => ({
    ...q,
    createdAt: formatDate(q.createdAt),
    status: q.status === 'read' ? 'read' : 'new',
  })));
}