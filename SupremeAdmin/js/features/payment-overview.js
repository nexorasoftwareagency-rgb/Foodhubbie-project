/**
 * Payment Management — the list tab.
 * One direct table of every restaurant (incl. disabled — money is still
 * owed): plan, all-time orders/usage/paid/due + per-plan due rollup.
 * Usage math = shared/cost-math via billing-shared.scopeStats, so the ₹
 * numbers here match the Admin Costs tab and the profile Billing card.
 */
import { navigate, registerAction } from '/js/main.js';
import { subscribe, flattenOutlets, getRawBusinesses } from '/js/data-store.js';
import { refreshIcons, escapeHtml, debounce } from '/js/utils.js';
import { sortRows, nextSort, sortHeader, statStrip, chips, keepFocus } from '/js/table-tools.js';
import { scopeStats, inr, currentYm, monthLabel } from '/js/billing-shared.js';
import { walletLevel } from '/shared/cost-math.js';

const mainEl = document.getElementById('app-main');
let allRows = [];
let sort = { key: 'due', dir: 'desc' };
let planChip = 'all';   // 'all' | plan name (set by the due-by-plan chips)
let statusChip = 'all'; // 'all' | 'owing' | 'settled' | 'lowwallet'
const COLS = {
  name: (r) => r.outletName, business: (r) => r.businessName, plan: (r) => r.plan,
  orders: (r) => r.orders, usage: (r) => r.usage, paid: (r) => r.paid, due: (r) => r.due,
};

export function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Usage &amp; Payments</h1>
        <div class="panel-sub">Usage and pending payment per restaurant <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
    </div>

    <div id="pay-kpis"><div class="skeleton" style="height:58px;margin-bottom:12px"></div></div>

    <div class="toolbar">
      <div class="search-input-wrap">
        <svg data-lucide="search"></svg>
        <input type="text" id="pay-search" placeholder="Search restaurant or outlet…" aria-label="Search payments" />
      </div>
      <div id="pay-status-chips"></div>
      <span class="grow"></span>
      <select class="text-input" id="pay-plan-filter" aria-label="Plan">
        <option value="all">All plans</option>
        <option value="starter">Starter</option>
        <option value="growth">Growth</option>
        <option value="enterprise">Enterprise</option>
      </select>
    </div>
    <div id="pay-plan-strip" class="toolbar" style="display:none"></div>
    <div class="result-count" id="pay-filter-count" aria-live="polite"></div>

    <div class="glass-card table-card">
      <table class="data-table" id="pay-table">
        <thead id="pay-thead"></thead>
        <tbody id="pay-tbody">
          <tr><td colspan="8" class="table-empty"><span class="skeleton" style="width:200px;height:16px;display:inline-block"></span></td></tr>
        </tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  document.getElementById('pay-plan-filter').addEventListener('change', (e) => { planChip = e.target.value; renderAll(); });
  document.getElementById('pay-search').addEventListener('input', debounce(renderAll, 120));
  registerAction('open-payment-record', (btn) => navigate(`payments/${btn.dataset.bid}/${btn.dataset.oid}`));
  registerAction('pay-sort', (btn) => {
    const key = btn.dataset.key;
    sort = nextSort(sort, key, btn.dataset.numeric === '1');
    renderAll();
    keepFocus(`[data-action="pay-sort"][data-key="${key}"]`);
  });
  registerAction('pay-status', (btn) => { statusChip = btn.dataset.chip; renderAll(); keepFocus(`[data-action="pay-status"][data-chip="${statusChip}"]`); });
  registerAction('pay-plan', (btn) => {
    planChip = planChip === btn.dataset.plan ? 'all' : btn.dataset.plan;
    renderAll();
    // Clearing the plan filter removes the chip you just pressed — land on the select.
    keepFocus(planChip === 'all' ? '#pay-plan-filter' : `[data-action="pay-plan"][data-plan="${planChip}"]`);
  });

  const unsubscribe = subscribe(() => {
    allRows = buildRows();
    renderAll();
  });
  return unsubscribe;
}

function renderAll() {
  if (!document.getElementById('pay-tbody')) return; // route already changed
  const sel = document.getElementById('pay-plan-filter');
  if (sel && sel.value !== planChip) sel.value = planChip;
  renderKpis();
  renderPlanStrip();
  renderTable();
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
        level: walletLevel({ paid: all.paid, used: all.usage, charges: all.charges }), locked: outlet.locked === true,
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
  const lowWallets = allRows.filter((r) => r.level === 'low' || r.level === 'empty').length;
  const monthUsage = Math.round(allRows.reduce((s, r) => s + r.monthUsage, 0) * 100) / 100;
  const monthPaid = Math.round(allRows.reduce((s, r) => s + r.monthPaid, 0) * 100) / 100;
  document.getElementById('pay-kpis').innerHTML = statStrip([
    { label: 'Outstanding (all time)', value: inr(outstanding), sub: `${owing} owing`, tone: outstanding > 0 ? 'bad' : 'good', action: 'pay-status', data: { chip: 'owing' }, active: statusChip === 'owing' },
    { label: `Usage · ${monthLabel(ym)}`, value: inr(monthUsage) },
    { label: `Collected · ${monthLabel(ym)}`, value: inr(monthPaid), tone: monthPaid > 0 ? 'good' : '' },
    { label: 'Low / empty wallets', value: lowWallets, sub: '≤25% left', tone: lowWallets ? 'warn' : '', action: 'pay-status', data: { chip: 'lowwallet' }, active: statusChip === 'lowwallet' },
    { label: 'Restaurants', value: allRows.length, sub: `${allRows.filter((r) => r.disabled).length} disabled`, action: 'pay-status', data: { chip: 'all' }, active: statusChip === 'all' },
  ], 'pay-stats');
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
  strip.innerHTML = `<span style="font-size:12px;font-weight:600;color:var(--text-secondary)">Due by plan</span><div class="chip-row">` +
    [...byPlan.entries()].sort((a, b) => b[1].due - a[1].due).map(([plan, p]) =>
      `<button type="button" class="chip ${planChip === plan ? 'active' : ''}" data-action="pay-plan" data-plan="${escapeHtml(plan)}" aria-pressed="${planChip === plan}">
        ${escapeHtml(label(plan))} <span class="chip-count">${p.owing}/${p.count} owing</span> <b class="${p.due > 0.009 ? 'amt-due' : 'amt-ok'}">${inr(Math.round(p.due * 100) / 100)}</b>
      </button>`).join('') + `</div>`;
}

function renderTable() {
  const q = (document.getElementById('pay-search')?.value || '').trim().toLowerCase();
  const base = allRows.filter((r) =>
    (planChip === 'all' || r.plan === planChip) &&
    (!q || r.outletName.toLowerCase().includes(q) || r.businessName.toLowerCase().includes(q)));
  const stest = {
    all: () => true, owing: (r) => r.due > 0.009, settled: (r) => r.due <= 0.009,
    lowwallet: (r) => r.level === 'low' || r.level === 'empty',
  }[statusChip] || (() => true);
  const rows = sortRows(base.filter(stest), sort, COLS);

  document.getElementById('pay-status-chips').innerHTML = chips({
    action: 'pay-status', active: statusChip, label: 'Payment status',
    items: [
      { id: 'all', label: 'All', count: base.length },
      { id: 'owing', label: 'Owing', count: base.filter((r) => r.due > 0.009).length, tone: 'bad' },
      { id: 'settled', label: 'Settled', count: base.filter((r) => r.due <= 0.009).length },
      { id: 'lowwallet', label: 'Low wallet', count: base.filter((r) => r.level === 'low' || r.level === 'empty').length },
    ],
  });
  document.getElementById('pay-thead').innerHTML = `<tr>
    ${sortHeader({ action: 'pay-sort', key: 'name', label: 'Outlet', sort })}
    ${sortHeader({ action: 'pay-sort', key: 'business', label: 'Business', sort, cls: 'col-sec' })}
    ${sortHeader({ action: 'pay-sort', key: 'plan', label: 'Plan', sort, cls: 'col-sec' })}
    ${sortHeader({ action: 'pay-sort', key: 'orders', label: 'Orders', sort, numeric: true, cls: 'col-sec' })}
    ${sortHeader({ action: 'pay-sort', key: 'usage', label: 'Usage', sort, numeric: true, cls: 'col-sec' })}
    ${sortHeader({ action: 'pay-sort', key: 'paid', label: 'Paid', sort, numeric: true, cls: 'col-sec' })}
    ${sortHeader({ action: 'pay-sort', key: 'due', label: 'Due', sort, numeric: true })}
    <th scope="col" class="col-chev"></th></tr>`;
  const count = document.getElementById('pay-filter-count');
  if (count) count.textContent = `Showing ${rows.length} of ${allRows.length}`;

  const tbody = document.getElementById('pay-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${allRows.length ? 'No restaurants match these filters. Clear the search or pick “All”.' : 'No restaurants yet — add one from Restaurant Management.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr class="row-link ${r.disabled ? 'row-stale' : ''}" data-action="open-payment-record" data-bid="${escapeHtml(r.bid)}" data-oid="${escapeHtml(r.oid)}" role="button" tabindex="0" aria-label="Open payment record for ${escapeHtml(r.outletName)}">
      <td><span class="cell-strong">${escapeHtml(r.outletName)}</span>${r.disabled ? ' <span class="transport-badge unknown">disabled</span>' : ''}${r.locked ? ' <span class="transport-badge unknown">locked</span>' : ''}${r.level === 'empty' ? ' <span class="transport-badge" style="color:var(--status-offline,#dc2626)">wallet empty</span>' : r.level === 'low' ? ' <span class="transport-badge" style="color:var(--status-degraded,#d97706)">low balance</span>' : ''}<span class="sub">${escapeHtml(r.businessName)} · <span style="text-transform:capitalize">${escapeHtml(r.plan)}</span> · ${r.orders} orders · paid ${inr(r.paid)}</span></td>
      <td class="col-sec">${escapeHtml(r.businessName)}</td>
      <td class="col-sec"><span class="transport-badge" style="color:var(--accent-payment);background:var(--accent-payment-soft)">${escapeHtml(r.plan)}</span></td>
      <td class="col-sec num">${r.orders}</td>
      <td class="col-sec num">${inr(r.usage)}</td>
      <td class="col-sec num">${inr(r.paid)}</td>
      <td class="num ${r.due > 0.009 ? 'amt-due' : 'amt-ok'}">${r.due > 0.009 ? inr(r.due) : 'Settled'}</td>
      <td class="col-chev" style="text-align:right"><svg data-lucide="chevron-right" style="width:15px;height:15px;color:var(--text-tertiary)"></svg></td>
    </tr>`).join('');
  refreshIcons(tbody);
}
