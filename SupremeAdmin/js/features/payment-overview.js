/**
 * Payment Management — the list tab.
 * One direct table of every restaurant (incl. disabled — money is still
 * owed): plan, all-time orders/usage/paid/due + per-plan due rollup.
 * Usage math = shared/cost-math via billing-shared.scopeStats, so the ₹
 * numbers here match the Admin Costs tab and the profile Billing card.
 */
import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, getRawBusinesses } from '/js/data-store.js';
import { refreshIcons, escapeHtml } from '/js/utils.js';
import { scopeStats, inr, currentYm, monthLabel } from '/js/billing-shared.js';

const mainEl = document.getElementById('app-main');
let allRows = [];

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Payment Management</h1>
        <div class="panel-sub">Usage &amp; pending payment per restaurant <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
    </div>

    <div class="table-kpi-grid" id="pay-kpis">
      ${Array.from({ length: 4 }).map(() => '<div class="glass-card kpi-tile"><div class="kpi-label"><span class="skeleton" style="width:90px;height:13px;display:inline-block"></span></div><div class="kpi-value"><span class="skeleton" style="width:110px;height:24px;display:inline-block"></span></div></div>').join('')}
    </div>

    <div class="glass-card" id="pay-plan-strip" style="margin-bottom:16px;padding:12px 16px;display:none;gap:8px;flex-wrap:wrap"></div>

    <div class="glass-card" style="margin-bottom:16px;padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <select class="text-input" id="pay-plan-filter" style="max-width:170px">
        <option value="all">All plans</option>
        <option value="starter">Starter</option>
        <option value="growth">Growth</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <select class="text-input" id="pay-status-filter" style="max-width:170px">
        <option value="all">All restaurants</option>
        <option value="owing">Owing money</option>
        <option value="settled">Fully settled</option>
      </select>
      <span style="font-size:12.5px;color:var(--text-secondary,#64748b)" id="pay-filter-count"></span>
    </div>

    <div class="glass-card" style="overflow-x:auto">
      <table class="data-table" id="pay-table">
        <thead>
          <tr>
            <th>Outlet</th><th>Business</th><th>Plan</th>
            <th style="text-align:right">Orders</th>
            <th style="text-align:right">Usage (all time)</th>
            <th style="text-align:right">Paid</th>
            <th style="text-align:right">Due</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="pay-tbody">
          <tr><td colspan="8" class="table-empty"><span class="skeleton" style="width:200px;height:16px;display:inline-block"></span></td></tr>
        </tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  document.getElementById('pay-plan-filter').addEventListener('change', renderTable);
  document.getElementById('pay-status-filter').addEventListener('change', renderTable);
  registerAction('open-payment-record', (btn) => navigate(`payments/${btn.dataset.bid}/${btn.dataset.oid}`));

  const unsubscribe = subscribe(() => {
    allRows = buildRows();
    renderKpis();
    renderPlanStrip();
    renderTable();
  });
  return unsubscribe;
}

function buildRows() {
  const ym = currentYm();
  return flattenOutlets({ includeDisabled: true })
    .map((r) => {
      const outlet = getRawBusinesses()[r.bid]?.outlets?.[r.oid];
      if (!outlet) return null;
      const all = scopeStats(outlet, { k: 'all' });
      const month = scopeStats(outlet, { k: 'month', ym });
      return {
        ...r,
        orders: all.orders, usage: all.usage, paid: all.paid, due: all.due,
        monthUsage: month.usage, monthPaid: month.paid,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.due - a.due || a.outletName.localeCompare(b.outletName));
}

function renderKpis() {
  const ym = currentYm();
  const outstanding = Math.round(allRows.reduce((s, r) => s + Math.max(r.due, 0), 0) * 100) / 100;
  const owing = allRows.filter((r) => r.due > 0.009).length;
  const monthUsage = Math.round(allRows.reduce((s, r) => s + r.monthUsage, 0) * 100) / 100;
  const monthPaid = Math.round(allRows.reduce((s, r) => s + r.monthPaid, 0) * 100) / 100;
  document.getElementById('pay-kpis').innerHTML = `
    <div class="glass-card kpi-tile ${outstanding > 0 ? 'accent-offline' : ''}">
      <div class="kpi-label"><svg data-lucide="circle-alert" style="width:13px;height:13px"></svg> Outstanding (all time)</div>
      <div class="kpi-value">${inr(outstanding)} <small>${owing} owing</small></div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="receipt-text" style="width:13px;height:13px"></svg> Usage · ${monthLabel(ym)}</div>
      <div class="kpi-value">${inr(monthUsage)}</div>
    </div>
    <div class="glass-card kpi-tile ${monthPaid > 0 ? 'accent-online' : ''}">
      <div class="kpi-label"><svg data-lucide="indian-rupee" style="width:13px;height:13px"></svg> Collected · ${monthLabel(ym)}</div>
      <div class="kpi-value">${inr(monthPaid)}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="store" style="width:13px;height:13px"></svg> Restaurants</div>
      <div class="kpi-value">${allRows.length} <small>${allRows.filter((r) => r.disabled).length} disabled</small></div>
    </div>
  `;
  refreshIcons(document.getElementById('pay-kpis'));
}

// Per-plan rollup — the "pending payment per plan" answer in one strip.
function renderPlanStrip() {
  const strip = document.getElementById('pay-plan-strip');
  if (!allRows.length) { strip.style.display = 'none'; return; }
  const byPlan = new Map();
  for (const r of allRows) {
    let p = byPlan.get(r.plan);
    if (!p) byPlan.set(r.plan, (p = { count: 0, owing: 0, due: 0 }));
    p.count++;
    if (r.due > 0.009) p.owing++;
    p.due += Math.max(r.due, 0); // credit on one outlet must not shrink another's debt chip
  }
  const label = (p) => p.charAt(0).toUpperCase() + p.slice(1);
  strip.style.display = 'flex';
  strip.innerHTML = `<span style="font-size:12.5px;font-weight:700;color:var(--text-secondary,#64748b);margin-right:4px">DUE BY PLAN</span>` +
    [...byPlan.entries()].sort((a, b) => b[1].due - a[1].due).map(([plan, p]) =>
      `<span style="font-size:12.5px;padding:5px 11px;border-radius:999px;background:var(--bg-elevated-2,#eef2f7);border:1px solid var(--glass-border,rgba(15,23,42,.10))">
        <b>${escapeHtml(label(plan))}</b> · ${p.owing}/${p.count} owing · <b style="color:${p.due > 0.009 ? 'var(--status-offline,#dc2626)' : 'var(--status-online,#16a34a)'}">${inr(Math.round(p.due * 100) / 100)}</b>
      </span>`).join('');
}

function renderTable() {
  const plan = document.getElementById('pay-plan-filter')?.value || 'all';
  const status = document.getElementById('pay-status-filter')?.value || 'all';
  const rows = allRows.filter((r) =>
    (plan === 'all' || r.plan === plan) &&
    (status === 'all' || (status === 'owing' ? r.due > 0.009 : r.due <= 0.009))
  );
  const count = document.getElementById('pay-filter-count');
  if (count) count.textContent = `${rows.length} of ${allRows.length} shown`;

  const tbody = document.getElementById('pay-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${allRows.length ? 'No restaurants match this filter.' : 'No restaurants yet — add one from Restaurant Management.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr class="${r.disabled ? 'row-stale' : ''}">
      <td><strong>${escapeHtml(r.outletName)}</strong>${r.disabled ? ' <span class="transport-badge unknown">disabled</span>' : ''}</td>
      <td>${escapeHtml(r.businessName)}</td>
      <td><span class="transport-badge" style="color:var(--accent-payment);background:var(--accent-payment-soft)">${escapeHtml(r.plan)}</span></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${r.orders}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${inr(r.usage)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${inr(r.paid)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${r.due > 0.009 ? 'var(--status-offline,#dc2626)' : 'var(--status-online,#16a34a)'}">${r.due > 0.009 ? inr(r.due) : 'Settled'}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" data-action="open-payment-record" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}">
          Record <svg data-lucide="chevron-right" style="width:13px;height:13px"></svg>
        </button>
      </td>
    </tr>`).join('');
  refreshIcons(tbody);
}
