import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let currentFilteredRows = [];

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Restaurant Management</h1>
        <div class="panel-sub">Every restaurant and outlet across the platform <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
      <div class="panel-header-actions">
        <button class="btn btn-ghost" data-action="export-restaurants-csv">
          <svg data-lucide="download"></svg> Export CSV
        </button>
        ${isReadOnly() ? '' : `
          <button class="btn btn-primary" data-action="go-onboard">
            <svg data-lucide="plus"></svg> Add Restaurant
          </button>
        `}
      </div>
    </div>

    <div class="table-kpi-grid" id="restaurant-kpis">
      ${Array.from({ length: 3 }).map(() => '<div class="skeleton" style="height:78px"></div>').join('')}
    </div>

    <div class="filters-row">
      <div class="search-input-wrap">
        <svg data-lucide="search"></svg>
        <input type="text" id="restaurant-search" placeholder="Search by restaurant or outlet name…" />
      </div>
      <select class="text-input" id="plan-filter">
        <option value="all">All plans</option>
        <option value="starter">Starter</option>
        <option value="growth">Growth</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <select class="text-input" id="whatsapp-filter">
        <option value="all">Any WhatsApp status</option>
        <option value="active">Connected</option>
        <option value="not-active">Not connected</option>
      </select>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden">
      <table class="data-table" id="restaurant-table">
        <thead>
          <tr><th>Outlet</th><th>Business</th><th>Plan</th><th>Contact</th><th>WhatsApp</th><th>Bot status</th><th></th></tr>
        </thead>
        <tbody id="restaurant-tbody">
          <tr><td colspan="7"><div class="skeleton" style="height:20px"></div></td></tr>
        </tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  registerAction('go-onboard', () => navigate('restaurants/onboard'));
  registerAction('export-restaurants-csv', () => exportRestaurantsCsv());

  document.getElementById('restaurant-search').addEventListener('input', debounce(applyFilters, 120));
  document.getElementById('plan-filter').addEventListener('change', applyFilters);
  document.getElementById('whatsapp-filter').addEventListener('change', applyFilters);

  // Single live listener, shared across the whole app (see data-store.js) —
  // this page just re-renders whenever it fires. No polling, no one-time get().
  const unsubscribe = subscribe((raw) => {
    allRows = flattenOutlets();
    applyFilters();
  });

  // The live listener only fires on writes — relative-time labels and the
  // stale-row dim need a periodic re-render even when nothing changes.
  const tick = setInterval(applyFilters, 30000);

  return () => { unsubscribe(); clearInterval(tick); };
}

function applyFilters() {
  const q = (document.getElementById('restaurant-search')?.value || '').trim().toLowerCase();
  const plan = document.getElementById('plan-filter')?.value || 'all';
  const wa = document.getElementById('whatsapp-filter')?.value || 'all';

  let rows = allRows;
  if (q) rows = rows.filter((r) => r.outletName.toLowerCase().includes(q) || r.businessName.toLowerCase().includes(q));
  if (plan !== 'all') rows = rows.filter((r) => r.plan === plan);
  if (wa === 'active') rows = rows.filter((r) => r.whatsappStatus === 'active');
  if (wa === 'not-active') rows = rows.filter((r) => r.whatsappStatus !== 'active');

  renderKpis(allRows);
  currentFilteredRows = rows;
  renderRows(rows);
}

function renderKpis(rows) {
  const total = rows.length;
  const connected = rows.filter((r) => r.whatsappStatus === 'active').length;
  const needsAttention = rows.filter((r) => r.botStatus === 'offline' || r.botStatus === 'errored').length;

  document.getElementById('restaurant-kpis').innerHTML = `
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="store" style="width:13px;height:13px"></svg> Total outlets</div>
      <div class="kpi-value">${total}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="message-circle" style="width:13px;height:13px"></svg> WhatsApp connected</div>
      <div class="kpi-value">${connected} <small>/ ${total}</small></div>
    </div>
    <div class="glass-card kpi-tile ${needsAttention ? 'accent-offline' : ''}">
      <div class="kpi-label"><svg data-lucide="alert-triangle" style="width:13px;height:13px"></svg> Needs attention</div>
      <div class="kpi-value">${needsAttention}</div>
    </div>
  `;
  refreshIcons(document.getElementById('restaurant-kpis'));
}

function renderRows(rows) {
  const tbody = document.getElementById('restaurant-tbody');
  if (!rows.length) {
    const platformEmpty = allRows.length === 0;
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty">${platformEmpty ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <span>No restaurants yet — add your first one to get started.</span>
          ${isReadOnly() ? '' : `<button class="btn btn-primary" data-action="go-onboard"><svg data-lucide="plus"></svg> Add your first restaurant</button>`}
        </div>` : 'No restaurants match your filters.'}</div></td></tr>`;
    refreshIcons(tbody);
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const onboarded = r.whatsappStatus === 'active' && r.botStatus === 'online';
    const stale = isStale(r.updatedAt);
    const statusCell = onboarded
      ? `${statusPillHtml(r.botStatus)}<div class="cell-meta">updated ${formatAge(r.updatedAt)}</div>`
      : r.botStatus === 'unknown' && !r.provisioned
        ? `<span class="status-pill unknown"><span class="static-dot"></span>No bot</span><div class="cell-meta">set up on profile</div>`
        : `<span class="onboard-mini" title="Onboarding in progress">${onboardMiniDots(r)}</span>`;
    return `
    <tr class="row-link ${stale ? 'row-stale' : ''}" data-action="open-profile" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" title="${stale ? 'Last status update was over 5 minutes ago — the bot may be unresponsive.' : ''}">
      <td><strong>${escapeHtml(r.outletName)}</strong></td>
      <td>${escapeHtml(r.businessName)}</td>
      <td style="text-transform:capitalize">${escapeHtml(r.plan)}</td>
      <td>${escapeHtml(r.contact)}</td>
      <td>${r.whatsappStatus === 'active'
          ? '<span class="status-pill online"><span class="pulse-dot"></span>Official API · Connected</span>'
          : r.transport === 'baileys' && r.botStatus === 'online'
            ? '<span class="status-pill online"><span class="pulse-dot"></span>WhatsApp Web · Connected</span>'
            : '<span class="status-pill unknown"><span class="static-dot"></span>Not connected</span>'}
        <div class="cell-meta">${transportBadgeHtml(r.transport)}</div>
      </td>
      <td>${statusCell}</td>
      <td style="text-align:right"><svg data-lucide="chevron-right" style="width:15px;height:15px;color:var(--text-tertiary)"></svg></td>
    </tr>
  `; }).join('');
  refreshIcons(tbody);
}

function onboardMiniDots(r) {
  const steps = [true, true, r.whatsappStatus === 'active', r.botStatus === 'online'];
  return steps.map((done) => `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:3px;background:${done ? 'var(--accent-whatsapp)' : 'var(--glass-border)'}"></span>`).join('');
}

function exportRestaurantsCsv() {
  exportCsv('restaurants', [
    { key: 'outletName', label: 'Outlet' },
    { key: 'businessName', label: 'Business' },
    { key: 'plan', label: 'Plan' },
    { key: 'contact', label: 'Contact' },
    { key: 'whatsappStatus', label: 'WhatsApp status' },
    { key: 'botStatus', label: 'Bot status' },
    { key: 'bid', label: 'Business ID' },
    { key: 'oid', label: 'Outlet ID' },
  ], currentFilteredRows); // whatever's currently on screen, not the unfiltered full set
}

registerAction('open-profile', (btn) => {
  navigate(`profile/${btn.dataset.bid}/${btn.dataset.oid}`);
});
