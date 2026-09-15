import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';
import { exportXlsx, refreshIcons, debounce, isStale, escapeHtml, transportBadgeHtml, formatDate, formatAge, statusPillHtml, showConfirm } from '/js/utils.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let currentFilteredRows = [];
let activeTab = 'active'; // 'active' | 'disabled'

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Restaurant Management</h1>
        <div class="panel-sub">Every restaurant and outlet across the platform <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
      <div class="panel-header-actions">
        <button class="btn btn-ghost" data-action="export-restaurants-xlsx">
          <svg data-lucide="download"></svg> Export Excel
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
      <div class="profile-tabs" role="tablist" aria-label="Restaurant status">
        <button class="profile-tab ${activeTab === 'active' ? 'active' : ''}" data-action="list-tab" data-tab="active" role="tab" aria-selected="${activeTab === 'active'}"><svg data-lucide="check-circle"></svg> Active</button>
        <button class="profile-tab ${activeTab === 'disabled' ? 'active' : ''}" data-action="list-tab" data-tab="disabled" role="tab" aria-selected="${activeTab === 'disabled'}"><svg data-lucide="pause-circle"></svg> Disabled</button>
      </div>
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
          <tr><th scope="col">Outlet</th><th scope="col">Business</th><th scope="col">Plan</th><th scope="col">Contact</th><th scope="col">WhatsApp</th><th scope="col">Bot status</th><th scope="col"></th></tr>
        </thead>
        <tbody id="restaurant-tbody">
          <tr><td colspan="7"><div class="skeleton" style="height:20px"></div></td></tr>
        </tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  registerAction('go-onboard', () => navigate('restaurants/onboard'));
  registerAction('export-restaurants-xlsx', () => exportRestaurantsXlsx());
  registerAction('list-tab', (btn) => {
    activeTab = btn.dataset.tab === 'disabled' ? 'disabled' : 'active';
    allRows = flattenOutlets({ includeDisabled: activeTab === 'disabled' });
    applyFilters();
  });

  document.getElementById('restaurant-search').addEventListener('input', debounce(applyFilters, 120));
  document.getElementById('plan-filter').addEventListener('change', applyFilters);
  document.getElementById('whatsapp-filter').addEventListener('change', applyFilters);

  // Single live listener, shared across the whole app (see data-store.js) —
  // this page just re-renders whenever it fires. No polling, no one-time get().
  const unsubscribe = subscribe((raw) => {
    allRows = flattenOutlets({ includeDisabled: activeTab === 'disabled' });
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
  if (activeTab === 'disabled') rows = rows.filter((r) => r.disabled === true);
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
        </div>` : activeTab === 'disabled' ? 'No disabled restaurants.' : 'No restaurants match your filters.'}</div></td></tr>`;
    refreshIcons(tbody);
    return;
  }
  if (activeTab === 'disabled') {
    tbody.innerHTML = rows.map((r) => `
    <tr class="row-disabled" data-action="open-profile" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(r.outletName)} profile">
      <td><strong>${escapeHtml(r.outletName)}</strong></td>
      <td>${escapeHtml(r.businessName)}</td>
      <td style="text-transform:capitalize">${escapeHtml(r.plan)}</td>
      <td>${escapeHtml(r.contact)}</td>
      <td><span class="status-pill offline"><span class="static-dot"></span>Disabled</span><div class="cell-meta">since ${formatDate(r.disabledAt)}</div></td>
      <td><span class="status-pill offline"><span class="static-dot"></span>Stopped</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" data-action="reactivate-outlet" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" data-name="${escapeHtml(r.outletName)}" ${isReadOnly() ? 'disabled' : ''} title="${isReadOnly() ? 'View-only account' : 'Reactivate this restaurant'}">
          <svg data-lucide="play"></svg> Reactivate
        </button>
      </td>
    </tr>
  `).join('');
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
    <tr class="row-link ${stale ? 'row-stale' : ''}" data-action="open-profile" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(r.outletName)} profile" title="${stale ? 'Last status update was over 5 minutes ago — the bot may be unresponsive.' : ''}">
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

function exportRestaurantsXlsx() {
  exportXlsx('restaurants', [
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

// Reactivate: 1-step confirm (non-destructive) → writes disabled:false with
// audit trail → row returns to the Active tab via the live listener → bot
// worker restarted (or provisioned if it never existed).
registerAction('reactivate-outlet', async (btn) => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const bid = btn.dataset.bid, oid = btn.dataset.oid, name = btn.dataset.name;
  const ok = await showConfirm({
    title: `Reactivate "${name}"?`,
    body: 'Re-enables QR ordering, dine-in, staff login, and the WhatsApp bot for this restaurant. All data is still intact.',
    confirmLabel: 'Reactivate',
  });
  if (!ok) return;
  try {
    const user = firebase.auth().currentUser;
    await firebase.database().ref(`businesses/${bid}/outlets/${oid}`).update({
      disabled: false,
      reactivatedAt: firebase.database.ServerValue.TIMESTAMP,
      reactivatedBy: user?.uid || 'unknown',
    });
    // Best-effort restart; a worker that never existed will be provisioned
    // on the next orchestrator pass. Failure doesn't undo the reactivation.
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${TUNNEL_URL}/api/bot/restart/${bid}/${oid}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) showToast("Your account doesn't have permission to restart the bot.", 'error');
      else if (!res.ok && res.status !== 404) showToast('Bot restart returned ' + res.status + ' — retry restart later.', 'warning');
    } catch (e) {
      console.warn('bot restart after reactivate failed', e);
      showToast('Restaurant reactivated — bot restart failed, retry from profile.', 'warning');
    }
    showToast(`"${name}" is active again.`, 'success');
  } catch (err) {
    console.error('reactivate failed', err);
    showToast('Reactivate failed — check the console.', 'error');
  }
});
