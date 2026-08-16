import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let currentFilteredRows = [];
let selected = new Set();

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
        <div class="glass-card" style="padding:8px 12px;display:flex;gap:14px;font-size:12.5px" id="fleet-summary">
          <span class="skeleton" style="width:80px;height:14px;display:inline-block"></span>
        </div>
      </div>
    </div>

    <div class="glass-card" style="margin-bottom:16px;padding:12px 16px;display:flex;gap:10px;align-items:center">
      <select class="text-input" id="fleet-filter" style="max-width:180px">
        <option value="all">All statuses</option>
        <option value="online">Online</option>
        <option value="degraded">Degraded</option>
        <option value="offline">Offline / errored</option>
      </select>
    </div>

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
  document.getElementById('fleet-filter').addEventListener('change', renderFromCache);
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
  const filter = document.getElementById('fleet-filter')?.value || 'all';
  const filtered = allRows.filter((b) => {
    if (filter === 'all') return true;
    if (filter === 'offline') return b.botStatus === 'offline' || b.botStatus === 'errored';
    return b.botStatus === filter;
  });

  renderSummary(allRows);
  currentFilteredRows = filtered;
  renderGrid(filtered);
  renderBulkBar();
}

function renderSummary(fleet) {
  const counts = { online: 0, degraded: 0, offline: 0 };
  fleet.forEach((b) => {
    if (b.botStatus === 'online') counts.online++;
    else if (b.botStatus === 'degraded') counts.degraded++;
    else counts.offline++;
  });
  document.getElementById('fleet-summary').innerHTML = `
    <span><strong style="color:var(--status-online)">${counts.online}</strong> online</span>
    <span><strong style="color:var(--status-degraded)">${counts.degraded}</strong> degraded</span>
    <span><strong style="color:var(--status-offline)">${counts.offline}</strong> down</span>
  `;
}

function renderGrid(fleet) {
  const grid = document.getElementById('fleet-grid');
  if (!fleet.length) {
    const platformEmpty = allRows.length === 0;
    grid.innerHTML = `<div class="glass-card table-empty" style="grid-column:1/-1">${platformEmpty ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <span>No WhatsApp agents yet — add a restaurant to create its first bot.</span>
          ${isReadOnly() ? '' : `<button class="btn btn-primary" data-action="go-onboard"><svg data-lucide="plus"></svg> Add a restaurant</button>`}
        </div>` : 'No bot agents match this filter.'}</div>`;
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
