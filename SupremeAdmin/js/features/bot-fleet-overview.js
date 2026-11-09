import { navigate, registerAction } from '/js/main.js';
import { statStrip, chips, keepFocus } from '/js/table-tools.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';
import { exportCsv, exportXlsx, refreshIcons, isStale, escapeHtml, formatUptime, statusPillHtml, transportBadgeHtml, formatMemory, formatAge, transportLabel, showToast, showConfirm, renderUptimeSparkline } from '/js/utils.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let currentFilteredRows = [];
let selected = new Set();
let chip = 'all';          // 'all' | 'down' | 'degraded' | 'online'
let sortBy = 'problems';   // 'problems' | 'name' | 'uptime' | 'updated'
const RANK = { errored: 0, offline: 1, degraded: 2, unknown: 3, online: 4 };
const isDown = (b) => b.botStatus === 'offline' || b.botStatus === 'errored';

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>WhatsApp Agent Management</h1>
        <div class="panel-sub">Every WhatsApp bot agent, platform-wide <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
      <div class="panel-header-actions">
        <button class="btn btn-ghost" data-action="export-fleet-csv">
          <svg data-lucide="download"></svg> Export CSV
        </button>
      </div>
    </div>

    <div id="fleet-summary"><div class="skeleton" style="height:58px;margin-bottom:12px"></div></div>

    <div class="toolbar">
      <div class="search-input-wrap">
        <svg data-lucide="search"></svg>
        <input type="text" id="fleet-search" placeholder="Search restaurant or outlet…" aria-label="Search agents" />
      </div>
      <div id="fleet-chips"></div>
      <span class="grow"></span>
      ${isReadOnly() ? '' : '<label class="chip" style="cursor:pointer"><input type="checkbox" id="fleet-select-all" style="margin:0"> Select all shown</label>'}
      <select class="text-input" id="fleet-sort" aria-label="Sort agents">
        <option value="problems">Problems first</option>
        <option value="name">Name A–Z</option>
        <option value="uptime">Longest uptime</option>
        <option value="updated">Recently updated</option>
      </select>
    </div>
    <div class="result-count" id="fleet-count" aria-live="polite"></div>

    <div class="bulk-actions-bar" id="bulk-bar" style="display:none">
      <span class="bulk-count" id="bulk-count">0 selected</span>
      <button class="btn btn-ghost btn-sm" data-action="bulk-clear">Clear</button>
      <button class="btn btn-primary btn-sm" data-action="bulk-restart">
        <svg data-lucide="rotate-cw"></svg> Restart selected
      </button>
    </div>

    <div class="fleet-grid" id="fleet-grid">
      ${Array.from({ length: 6 }).map(() => '<div class="skeleton" style="height:150px;border-radius:14px"></div>').join('')}
    </div>
  `;
  refreshIcons(mainEl);

  selected = new Set();
  document.getElementById('fleet-search').addEventListener('input', renderFromCache);
  document.getElementById('fleet-sort').value = sortBy;
  document.getElementById('fleet-sort').addEventListener('change', (e) => { sortBy = e.target.value; renderFromCache(); });
  document.getElementById('fleet-select-all')?.addEventListener('change', (e) => {
    currentFilteredRows.forEach((b) => { const k = `${b.bid}/${b.oid}`; if (e.target.checked) selected.add(k); else selected.delete(k); });
    renderFromCache();
  });
  registerAction('fl-chip', (btn) => { chip = btn.dataset.chip; renderFromCache(); keepFocus(`[data-action="fl-chip"][data-chip="${chip}"]`); });
  registerAction('export-fleet-csv', () => exportFleetCsv());
  registerAction('go-onboard', () => navigate('restaurants/onboard'));
  registerAction('bulk-clear', () => { selected.clear(); renderFromCache(); });
  registerAction('bulk-restart', () => bulkRestart());

  // Live listener via the shared data store — replaces the previous
  // 15s poll of /api/bot/status-all entirely. The Bot Control API is
  // now only called for mutating actions (restart/stop), not status.
  const unsubscribe = subscribe(() => {
    allRows = flattenOutlets();
    renderFromCache();
  });

  // Relative-time labels + stale dim need a periodic re-render even when
  // no status writes arrive (listener only fires on writes).
  const tick = setInterval(renderFromCache, 30000);

  return () => { unsubscribe(); clearInterval(tick); };
}

function renderFromCache() {
  if (!document.getElementById('fleet-grid')) return; // route already changed
  const q = (document.getElementById('fleet-search')?.value || '').trim().toLowerCase();
  const base = q ? allRows.filter((b) => b.outletName.toLowerCase().includes(q) || b.businessName.toLowerCase().includes(q)) : allRows;
  const test = { all: () => true, down: isDown, degraded: (b) => b.botStatus === 'degraded', online: (b) => b.botStatus === 'online', nodata: (b) => !isDown(b) && b.botStatus !== 'online' && b.botStatus !== 'degraded' }[chip] || (() => true);
  const filtered = base.filter(test).slice().sort((a, b) => {
    if (sortBy === 'name') return a.outletName.localeCompare(b.outletName);
    if (sortBy === 'uptime') return (b.uptime || 0) - (a.uptime || 0);
    if (sortBy === 'updated') return (b.updatedAt || 0) - (a.updatedAt || 0);
    return (RANK[a.botStatus] ?? 3) - (RANK[b.botStatus] ?? 3) || a.outletName.localeCompare(b.outletName);
  });

  renderSummary(allRows, base);
  currentFilteredRows = filtered;
  const cnt = document.getElementById('fleet-count');
  if (cnt) cnt.textContent = `Showing ${filtered.length} of ${allRows.length}`;
  const all = document.getElementById('fleet-select-all');
  if (all) all.checked = filtered.length > 0 && filtered.every((b) => selected.has(`${b.bid}/${b.oid}`));
  renderGrid(filtered);
  renderBulkBar();
}

function renderSummary(fleet, base) {
  const n = (rows, f) => rows.filter(f).length;
  const online = n(fleet, (b) => b.botStatus === 'online');
  const degraded = n(fleet, (b) => b.botStatus === 'degraded');
  const down = n(fleet, isDown);
  const nodata = n(fleet, (b) => !isDown(b) && b.botStatus !== 'online' && b.botStatus !== 'degraded');
  document.getElementById('fleet-summary').innerHTML = statStrip([
    { label: 'Online', value: online, sub: `of ${fleet.length}`, tone: 'good', action: 'fl-chip', data: { chip: 'online' }, active: chip === 'online' },
    { label: 'Degraded', value: degraded, tone: degraded ? 'warn' : '', action: 'fl-chip', data: { chip: 'degraded' }, active: chip === 'degraded' },
    { label: 'Down', value: down, tone: down ? 'bad' : 'good', action: 'fl-chip', data: { chip: 'down' }, active: chip === 'down' },
    { label: 'No status yet', value: nodata, sub: 'not set up / no data', action: 'fl-chip', data: { chip: 'nodata' }, active: chip === 'nodata' },
  ], 'fleet-stats');
  document.getElementById('fleet-chips').innerHTML = chips({
    action: 'fl-chip', active: chip, label: 'Status',
    items: [
      { id: 'all', label: 'All', count: base.length },
      { id: 'down', label: 'Down', count: n(base, isDown), tone: 'bad' },
      { id: 'degraded', label: 'Degraded', count: n(base, (b) => b.botStatus === 'degraded') },
      { id: 'online', label: 'Online', count: n(base, (b) => b.botStatus === 'online') },
      { id: 'nodata', label: 'No status', count: n(base, (b) => !isDown(b) && b.botStatus !== 'online' && b.botStatus !== 'degraded') },
    ],
  });
}

function renderGrid(fleet) {
  const grid = document.getElementById('fleet-grid');
  if (!fleet.length) {
    const platformEmpty = allRows.length === 0;
    grid.innerHTML = `<div class="glass-card table-empty" style="grid-column:1/-1">${platformEmpty ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <span>No WhatsApp agents yet — add a restaurant to create its first bot.</span>
          ${isReadOnly() ? '' : `<button class="btn btn-primary" data-action="go-onboard"><svg data-lucide="plus"></svg> Add a restaurant</button>`}
        </div>` : 'No agents match these filters. Clear the search or pick “All”.'}</div>`;
    refreshIcons(grid);
    return;
  }
  grid.innerHTML = fleet.map((b) => {
    const key = `${b.bid}/${b.oid}`;
    const canSelect = !isReadOnly();
    const stale = isStale(b.updatedAt);
    return `
    <div class="glass-card fleet-card ${canSelect ? 'selectable' : ''} ${stale ? 'row-stale' : ''}" data-bid="${escapeHtml(b.bid)}" data-oid="${escapeHtml(b.oid)}" title="${stale ? 'Last status update was over 5 minutes ago — the bot may be unresponsive.' : ''}">
      ${canSelect ? `<input type="checkbox" class="fleet-card-select" data-fleet-select="${escapeHtml(key)}" ${selected.has(key) ? 'checked' : ''} />` : ''}
      <div class="row-link" data-action="view-profile" data-bid="${escapeHtml(b.bid)}" data-oid="${escapeHtml(b.oid)}">
        <div class="fleet-card-top">
          <div>
            <div class="fleet-outlet-name">${escapeHtml(b.outletName)}</div>
            <div class="fleet-biz-name">${escapeHtml(b.businessName)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${statusPillHtml(b.botStatus)}
            ${transportBadgeHtml(b.transport)}
          </div>
        </div>
        <div class="fleet-metrics">
          <div><div class="fleet-metric-label">Uptime</div><div class="fleet-metric-value">${formatUptime(b.uptime)}</div></div>
          <div><div class="fleet-metric-label">Memory</div><div class="fleet-metric-value">${formatMemory(b.memory)}</div></div>
          <div><div class="fleet-metric-label">Last update</div><div class="fleet-metric-value">${formatAge(b.updatedAt)}</div></div>
        </div>
        <div class="sparkline-wrap">
          <div class="sparkline-label">Last 24h</div>
          ${renderUptimeSparkline(b.history)}
        </div>
      </div>
    </div>
  `; }).join('');
  refreshIcons(grid);

  grid.querySelectorAll('[data-fleet-select]').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation()); // don't trigger row navigation
    cb.addEventListener('change', (e) => {
      const key = e.target.dataset.fleetSelect;
      if (e.target.checked) selected.add(key); else selected.delete(key);
      renderBulkBar();
    });
  });
}

function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  if (selected.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('bulk-count').textContent = `${selected.size} selected`;
}

async function bulkRestart() {
  const keys = Array.from(selected);
  if (!keys.length) return;
  const ok = await showConfirm({
    title: `Restart ${keys.length} bot${keys.length > 1 ? 's' : ''}?`,
    body: 'Each selected restaurant will briefly stop receiving WhatsApp orders while its bot restarts.',
    confirmLabel: 'Restart all',
    danger: true,
  });
  if (!ok) return;

  const token = await firebase.auth().currentUser.getIdToken();
  const results = await Promise.allSettled(keys.map((key) => {
    const [bid, oid] = key.split('/');
    return fetch(`${TUNNEL_URL}/api/bot/restart/${bid}/${oid}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then((res) => { if (!res.ok) throw new Error(String(res.status)); });
  }));

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - succeeded;
  showToast(
    failed ? `${succeeded} restarted, ${failed} failed — check bot-control-api logs.` : `${succeeded} bots restarted.`,
    failed ? 'error' : 'success'
  );
  selected.clear();
  renderFromCache(); // live listener will also bring the real status in shortly
}

function exportFleetCsv() {
  exportCsv('bot-fleet', [
    { key: 'outletName', label: 'Outlet' },
    { key: 'businessName', label: 'Business' },
    { key: 'botStatus', label: 'Status' },
    { key: 'uptime', label: 'Uptime (s)' },
    { key: 'memory', label: 'Memory (MB)' },
    { key: 'bid', label: 'Business ID' },
    { key: 'oid', label: 'Outlet ID' },
  ], currentFilteredRows); // whatever's currently on screen, not the unfiltered full set
}

registerAction('view-profile', (btn) => navigate(`profile/${btn.dataset.bid}/${btn.dataset.oid}`));
