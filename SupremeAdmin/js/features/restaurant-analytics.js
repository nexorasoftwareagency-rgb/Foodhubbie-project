/**
 * NOTE: no chart library is bundled here — lightweight inline SVG bars,
 * zero new dependencies (see build notes in the README for why).
 *
 * Supports two modes:
 *   render()          → platform-wide, all outlets combined
 *   render(bid, oid)  → single-outlet drill-down (linked from the
 *                        restaurant profile page's "View analytics")
 */
import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, isReadOnly } from '/js/data-store.js';

const mainEl = document.getElementById('app-main');

export function render(bid, oid) {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Analytics</h1>
        <div class="panel-sub" id="analytics-sub">Orders and revenue</div>
      </div>
      <div class="panel-header-actions">
        <select class="text-input" id="outlet-picker" style="min-width:220px">
          <option value="">Platform-wide (all outlets)</option>
        </select>
      </div>
    </div>
    <div id="analytics-content"><div class="skeleton" style="height:320px;border-radius:14px"></div></div>
  `;
  refreshIcons(mainEl);

  const picker = document.getElementById('outlet-picker');
  picker.addEventListener('change', () => {
    navigate(picker.value ? `analytics/${picker.value}` : 'analytics');
  });
  registerAction('go-onboard', () => navigate('restaurants/onboard'));

  // Live subscription covers two jobs here: populating the outlet
  // picker's options, and (for single-outlet mode) supplying dailyStats
  // as they're written — no separate one-time read needed.
  const unsubscribe = subscribe((raw) => {
    populatePicker(picker, bid, oid);
    if (bid && oid) renderSingleOutlet(raw, bid, oid);
    else renderPlatformWide(raw);
  });

  return unsubscribe;
}

function populatePicker(picker, bid, oid) {
  // Previously skipped rebuilding once populated for the current
  // selection — meant a restaurant onboarded while you're sitting on
  // this page wouldn't show up in the picker until you navigated away
  // and back. Rebuilding a small <select>'s options on every live
  // update is cheap, so just always do it; only real downside is losing
  // an in-progress open dropdown mid-edit, which is a minor, rare
  // trade-off against showing stale data.
  const current = bid && oid ? `${bid}/${oid}` : '';
  const rows = flattenOutlets();
  picker.innerHTML = `<option value="">Platform-wide (all outlets)</option>` +
    rows.map((r) => `<option value="${escapeHtml(r.bid)}/${escapeHtml(r.oid)}" ${current === `${r.bid}/${r.oid}` ? 'selected' : ''}>${escapeHtml(r.outletName)}</option>`).join('');
}

function renderPlatformWide(raw) {
  document.getElementById('analytics-sub').textContent = 'Orders and revenue, platform-wide';
  const totals = {};
  Object.values(raw).forEach((biz) => {
    Object.values(biz.outlets || {}).forEach((outlet) => {
      Object.entries(outlet.dailyStats || {}).forEach(([date, stats]) => {
        totals[date] = totals[date] || { orders: 0, revenue: 0 };
        totals[date].orders += stats.orders || 0;
        totals[date].revenue += stats.revenue || 0;
      });
    });
  });
  renderSeries(seriesFromTotals(totals));
}

function renderSingleOutlet(raw, bid, oid) {
  const biz = raw[bid];
  const outlet = biz?.outlets?.[oid];
  if (!outlet) {
    document.getElementById('analytics-sub').textContent = 'Outlet not found';
    document.getElementById('analytics-content').innerHTML = `<div class="glass-card table-empty">This outlet could not be found.</div>`;
    return;
  }
  const store = (outlet.settings && outlet.settings.Store) || {};
  document.getElementById('analytics-sub').textContent = `${outlet.name || store.storeName || 'Unnamed outlet'} · ${biz.name || store.entityName || biz.businessName || store.storeName || 'Unnamed business'}`;
  const totals = {};
  Object.entries(outlet.dailyStats || {}).forEach(([date, stats]) => {
    totals[date] = { orders: stats.orders || 0, revenue: stats.revenue || 0 };
  });
  renderSeries(seriesFromTotals(totals));
}

function seriesFromTotals(totals) {
  return Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, v]) => ({ date, ...v }));
}

function renderSeries(series) {
  const el = document.getElementById('analytics-content');
  if (!series.length) {
    el.innerHTML = `<div class="glass-card table-empty">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        <span>No order data yet — this fills in as outlets report daily stats.</span>
        ${isReadOnly() ? '' : `<button class="btn btn-primary" data-action="go-onboard"><svg data-lucide="plus"></svg> Add a restaurant</button>`}
      </div>
    </div>`;
    refreshIcons(el);
    return;
  }

  const totalOrders = series.reduce((s, d) => s + d.orders, 0);
  const totalRevenue = series.reduce((s, d) => s + d.revenue, 0);

  el.innerHTML = `
    <div class="table-kpi-grid">
      <div class="glass-card kpi-tile">
        <div class="kpi-label"><svg data-lucide="shopping-bag" style="width:13px;height:13px"></svg> Orders (30d)</div>
        <div class="kpi-value mono">${totalOrders.toLocaleString('en-IN')}</div>
      </div>
      <div class="glass-card kpi-tile">
        <div class="kpi-label"><svg data-lucide="indian-rupee" style="width:13px;height:13px"></svg> Revenue (30d)</div>
        <div class="kpi-value mono">₹${totalRevenue.toLocaleString('en-IN')}</div>
      </div>
    </div>
    <div class="glass-card">
      <strong style="display:block;margin-bottom:14px">Daily orders — last ${series.length} days</strong>
        ${barChart(series.map((d) => d.orders), series.map((d) => d.date))}
    </div>
  `;
  refreshIcons(el);
}

function barChart(values, labels) {
  const max = Math.max(...values, 1);
  const w = 720, h = 120, barW = w / values.length;
  const bars = values.map((v, i) => {
    const bh = Math.max(2, (v / max) * (h - 8));
    const tip = labels && labels[i] ? `${labels[i]}: ${v.toLocaleString('en-IN')}` : `${v.toLocaleString('en-IN')}`;
    return `<rect x="${i * barW + 1}" y="${h - bh}" width="${barW - 2}" height="${bh}" rx="2" fill="var(--accent)" opacity="0.85"><title>${escapeHtml(tip)}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${bars}</svg>`;
}
