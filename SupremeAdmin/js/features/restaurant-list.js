import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';
import { exportXlsx, refreshIcons, debounce, isStale, escapeHtml, formatDate, formatAge, statusPillHtml, showConfirm, showToast } from '/js/utils.js';
import { sortRows, nextSort, sortHeader, statStrip, chips, keepFocus } from '/js/table-tools.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let currentFilteredRows = [];
let activeTab = 'active'; // 'active' | 'disabled'
let chip = 'all';         // 'all' | 'attention' | 'notconn' | 'setup'
let sort = { key: 'name', dir: 'asc' };

const STATUS_RANK = { errored: 0, offline: 1, degraded: 2, unknown: 3, online: 4 };
const SORT_COLS = {
  name: (r) => r.outletName,
  business: (r) => r.businessName,
  plan: (r) => r.plan,
  contact: (r) => (r.contact === '—' ? null : r.contact),
  whatsapp: (r) => (waConnected(r) ? 1 : 0),
  status: (r) => STATUS_RANK[r.botStatus] ?? 3,
};

const waConnected = (r) => r.whatsappStatus === 'active' || (r.transport === 'baileys' && r.botStatus === 'online');
const needsAttention = (r) => r.botStatus === 'offline' || r.botStatus === 'errored';
const isSettingUp = (r) => r.botStatus === 'unknown' && r.provisioned;
const CHIP_TEST = {
  all: () => true,
  conn: waConnected,
  attention: needsAttention,
  notconn: (r) => !waConnected(r),
  setup: isSettingUp,
};

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Restaurants</h1>
        <div class="panel-sub">Every restaurant and outlet on the platform <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
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

    <div id="restaurant-kpis"><div class="skeleton" style="height:58px;margin-bottom:12px"></div></div>

    <div class="toolbar">
      <div class="profile-tabs" role="tablist" aria-label="Restaurant status" style="margin:0">
        <button class="profile-tab ${activeTab === 'active' ? 'active' : ''}" data-action="list-tab" data-tab="active" role="tab" aria-selected="${activeTab === 'active'}">Active <span class="chip-count" id="tab-count-active"></span></button>
        <button class="profile-tab ${activeTab === 'disabled' ? 'active' : ''}" data-action="list-tab" data-tab="disabled" role="tab" aria-selected="${activeTab === 'disabled'}">Disabled <span class="chip-count" id="tab-count-disabled"></span></button>
      </div>
      <div class="search-input-wrap">
        <svg data-lucide="search"></svg>
        <input type="text" id="restaurant-search" placeholder="Search restaurant or outlet…" aria-label="Search restaurants" />
      </div>
      <select class="text-input" id="plan-filter" aria-label="Plan">
        <option value="all">All plans</option>
        <option value="starter">Starter</option>
        <option value="growth">Growth</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <div id="restaurant-chips"></div>
    </div>
    <div class="result-count" id="restaurant-count" aria-live="polite"></div>

    <div class="glass-card table-card">
      <table class="data-table" id="restaurant-table">
        <thead id="restaurant-thead"></thead>
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
    chip = 'all';
    applyFilters();
  });
  registerAction('rl-chip', (btn) => { chip = btn.dataset.chip; applyFilters(); keepFocus(`[data-action="rl-chip"][data-chip="${chip}"]`); });
  registerAction('rl-sort', (btn) => {
    const key = btn.dataset.key;
    sort = nextSort(sort, key, btn.dataset.numeric === '1');
    applyFilters();
    keepFocus(`[data-action="rl-sort"][data-key="${key}"]`);
  });

  document.getElementById('restaurant-search').addEventListener('input', debounce(applyFilters, 120));
  document.getElementById('plan-filter').addEventListener('change', applyFilters);

  // Single live listener, shared across the whole app (see data-store.js) —
  // this page just re-renders whenever it fires. No polling, no one-time get().
  // Both tabs load together so the Active / Disabled counts are always real.
  const unsubscribe = subscribe(() => {
    allRows = flattenOutlets({ includeDisabled: true });
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

  // Tab first: Active and Disabled are different lists, not a filter chip.
  const tabRows = allRows.filter((r) => (activeTab === 'disabled' ? r.disabled === true : !r.disabled));
  let base = tabRows;
  if (q) base = base.filter((r) => r.outletName.toLowerCase().includes(q) || r.businessName.toLowerCase().includes(q));
  if (plan !== 'all') base = base.filter((r) => r.plan === plan);

  renderSummary(allRows, base, tabRows);
  currentFilteredRows = sortRows(base.filter(CHIP_TEST[chip] || CHIP_TEST.all), sort, SORT_COLS);
  const cnt = document.getElementById('restaurant-count');
  if (cnt) cnt.textContent = `Showing ${currentFilteredRows.length} of ${tabRows.length}`;
  renderRows(currentFilteredRows);
}

function renderSummary(rows, base, tabRows) {
  const total = tabRows.length;
  const isActive = activeTab === 'active';
  const connected = tabRows.filter(waConnected).length;
  const attention = tabRows.filter(needsAttention).length;
  const setup = tabRows.filter(isSettingUp).length;

  document.getElementById('restaurant-kpis').innerHTML = isActive ? statStrip([
    { label: 'Total outlets', value: total, action: 'rl-chip', data: { chip: 'all' }, active: chip === 'all' },
    { label: 'WhatsApp connected', value: connected, sub: `of ${total}`, action: 'rl-chip', data: { chip: 'conn' }, tone: connected === total && total ? 'good' : '', active: chip === 'conn' },
    { label: 'Needs attention', value: attention, tone: attention ? 'bad' : 'good', action: 'rl-chip', data: { chip: 'attention' }, active: chip === 'attention' },
    { label: 'Setting up', value: setup, action: 'rl-chip', data: { chip: 'setup' }, active: chip === 'setup' },
  ], 'restaurant-stats') : '';

  const chipBox = document.getElementById('restaurant-chips');
  if (chipBox) chipBox.innerHTML = isActive ? chips({
    action: 'rl-chip', active: chip, label: 'Quick filter',
    items: [
      { id: 'all', label: 'All', count: base.length },
      { id: 'attention', label: 'Needs attention', count: base.filter(needsAttention).length, tone: 'bad' },
      { id: 'notconn', label: 'Not connected', count: base.filter(CHIP_TEST.notconn).length },
      { id: 'setup', label: 'Setting up', count: base.filter(isSettingUp).length },
    ],
  }) : '';

  const ca = document.getElementById('tab-count-active'), cd = document.getElementById('tab-count-disabled');
  if (ca) ca.textContent = rows.filter((r) => !r.disabled).length;
  if (cd) cd.textContent = rows.filter((r) => r.disabled).length;
  document.getElementById('restaurant-thead').innerHTML = `<tr>
    ${sortHeader({ action: 'rl-sort', key: 'name', label: 'Outlet', sort })}
    ${sortHeader({ action: 'rl-sort', key: 'business', label: 'Business', sort, cls: 'col-sec' })}
    ${sortHeader({ action: 'rl-sort', key: 'plan', label: 'Plan', sort, cls: 'col-sec' })}
    ${sortHeader({ action: 'rl-sort', key: 'contact', label: 'Contact', sort, cls: 'col-sec' })}
    ${sortHeader({ action: 'rl-sort', key: 'whatsapp', label: 'WhatsApp', sort })}
    ${sortHeader({ action: 'rl-sort', key: 'status', label: isActive ? 'Bot status' : 'Bot', sort })}
    <th scope="col" class="col-chev"></th></tr>`;
}

function renderRows(rows) {
  const tbody = document.getElementById('restaurant-tbody');
  if (!rows.length) {
    const platformEmpty = allRows.every((r) => r.disabled);
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty">${platformEmpty ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <span>No restaurants yet — add your first one to get started.</span>
          ${isReadOnly() ? '' : `<button class="btn btn-primary" data-action="go-onboard"><svg data-lucide="plus"></svg> Add your first restaurant</button>`}
        </div>` : activeTab === 'disabled' ? 'No disabled restaurants.' : 'No restaurants match these filters. Clear the search or pick “All”.'}</div></td></tr>`;
    refreshIcons(tbody);
    return;
  }
  if (activeTab === 'disabled') {
    tbody.innerHTML = rows.map((r) => `
    <tr class="row-disabled" data-action="open-profile" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(r.outletName)} profile">
      <td><span class="cell-strong">${escapeHtml(r.outletName)}</span><span class="sub">${escapeHtml(r.businessName)}</span></td>
      <td class="col-sec">${escapeHtml(r.businessName)}</td>
      <td class="col-sec" style="text-transform:capitalize">${escapeHtml(r.plan)}</td>
      <td class="col-sec">${escapeHtml(r.contact)}</td>
      <td><span class="status-pill offline"><span class="static-dot"></span>Disabled</span><div class="cell-meta">since ${formatDate(r.disabledAt)}</div></td>
      <td><span class="status-pill offline"><span class="static-dot"></span>Stopped</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" data-action="reactivate-outlet" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" data-name="${escapeHtml(r.outletName)}" ${isReadOnly() ? 'disabled' : ''}>
          <svg data-lucide="play"></svg> Reactivate
        </button>
      </td>
    </tr>
  `).join('');
    refreshIcons(tbody);
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const stale = isStale(r.updatedAt);
    const statusCell = r.botStatus !== 'unknown'
      ? `${statusPillHtml(r.botStatus)}<div class="cell-meta">updated ${formatAge(r.updatedAt)}</div>`
      : r.botStatus === 'unknown' && !r.provisioned
        ? `<span class="status-pill unknown"><span class="static-dot"></span>No bot</span><div class="cell-meta">set up on profile</div>`
        : `<span class="onboard-mini" title="Onboarding in progress">${onboardMiniDots(r)}</span>`;
    return `
    <tr class="row-link ${stale ? 'row-stale' : ''}" data-action="open-profile" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(r.outletName)} profile" title="${stale ? 'Last status update was over 5 minutes ago — the bot may be unresponsive.' : ''}">
      <td><span class="cell-strong">${escapeHtml(r.outletName)}</span><span class="sub">${escapeHtml(r.businessName)} · <span style="text-transform:capitalize">${escapeHtml(r.plan)}</span></span></td>
      <td class="col-sec">${escapeHtml(r.businessName)}</td>
      <td class="col-sec" style="text-transform:capitalize">${escapeHtml(r.plan)}</td>
      <td class="col-sec">${escapeHtml(r.contact)}</td>
      <td>${r.whatsappStatus === 'active'
          ? '<span class="status-pill online"><span class="pulse-dot"></span>Official API</span>'
          : r.transport === 'baileys' && r.botStatus === 'online'
            ? '<span class="status-pill online"><span class="pulse-dot"></span>WhatsApp Web</span>'
            : '<span class="status-pill unknown"><span class="static-dot"></span>Not connected</span>'}
      </td>
      <td>${statusCell}</td>
      <td class="col-chev" style="text-align:right"><svg data-lucide="chevron-right" style="width:15px;height:15px;color:var(--text-tertiary)"></svg></td>
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
    // outletIndex only accepts bid/name/disabled/createdAt ($other is false),
    // and the node may not exist yet for older outlets — write the children so
    // the index entry is complete instead of a half node.
    const idxName = (name || '').slice(0, 80);
    const updates = {
      [`businesses/${bid}/outlets/${oid}/disabled`]: false,
      [`businesses/${bid}/outlets/${oid}/reactivatedAt`]: firebase.database.ServerValue.TIMESTAMP,
      [`businesses/${bid}/outlets/${oid}/reactivatedBy`]: user?.uid || 'unknown',
      [`businesses/${bid}/outlets/${oid}/suspended`]: false, // orchestrator.js gates on this — without it the bot stays stopped
      [`outletIndex/${oid}/bid`]: bid,
      [`outletIndex/${oid}/disabled`]: false,
    };
    if (idxName) updates[`outletIndex/${oid}/name`] = idxName;
    await firebase.database().ref().update(updates);
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
