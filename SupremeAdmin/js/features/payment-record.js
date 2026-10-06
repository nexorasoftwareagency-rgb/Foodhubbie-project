/**
 * Payment Record Page — #payments/{bid}/{oid}
 * All-time / Monthly / Yearly / Custom scope over the same money math
 * (billing-shared): KPI totals, monthly breakdown, full transaction
 * ledger with running balance, printable receipts, and the two write
 * actions (record payment / add charge) — the same actions the profile's
 * Billing card exposes, writing to the identical billing node.
 */
import { registerAction } from '/js/main.js';
import { subscribe, getRawBusinesses, isReadOnly } from '/js/data-store.js';
import { refreshIcons, escapeHtml, formatDate, showConfirm, showToast } from '/js/utils.js';
import {
  scopeStats, monthlyRows, ledgerRows, inr, currentYm, monthLabel, scopeLabel,
  monthStartMs, monthEndMs, recordPaymentModal, addChargeModal, printReceipt,
} from '/js/billing-shared.js';
import { PROMO_RATE } from '/shared/cost-math.js';

const mainEl = document.getElementById('app-main');
let state = null; // {bid, oid, scope, ym, year, from, to, outlet, ledger}

export function render(bid, oid) {
  state = {
    bid, oid, outlet: null, name: '',
    scope: { k: 'all' },
    ym: currentYm(),
    year: Number(currentYm().slice(0, 4)),
    from: '', to: '',
    ledger: [],
  };

  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <button class="btn btn-ghost btn-sm" data-action="navigate" data-href="payments" style="margin-bottom:8px">← All restaurants</button>
        <h1 id="pr-title"><span class="skeleton" style="width:220px;height:28px;display:inline-block"></span></h1>
        <div class="panel-sub" id="pr-sub"></div>
      </div>
      <div class="panel-header-actions" id="pr-actions">
        ${isReadOnly() ? '' : `
          <button class="btn btn-ghost" data-action="pr-add-charge"><svg data-lucide="plus-circle"></svg> Add charge</button>
          <button class="btn btn-primary" data-action="pr-record-payment"><svg data-lucide="indian-rupee"></svg> Record payment</button>`}
      </div>
    </div>

    <div class="table-kpi-grid" id="pr-kpis"></div>

    <div class="glass-card" style="margin:16px 0;padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm pr-scope" data-action="pr-scope" data-scope="all">All time</button>
      <button class="btn btn-ghost btn-sm pr-scope" data-action="pr-scope" data-scope="month">Monthly</button>
      <input class="text-input pr-pick" id="pr-month" type="month" value="${state.ym}" style="max-width:160px;display:none" />
      <button class="btn btn-ghost btn-sm pr-scope" data-action="pr-scope" data-scope="year">Yearly</button>
      <select class="text-input pr-pick" id="pr-year" style="max-width:110px;display:none"></select>
      <button class="btn btn-ghost btn-sm pr-scope" data-action="pr-scope" data-scope="range">Custom</button>
      <input class="text-input pr-pick" id="pr-from" type="date" style="max-width:155px;display:none" />
      <span class="pr-pick" id="pr-range-sep" style="display:none;color:var(--text-secondary,#64748b)">→</span>
      <input class="text-input pr-pick" id="pr-to" type="date" style="max-width:155px;display:none" />
      <span style="font-size:12.5px;color:var(--text-secondary,#64748b)" id="pr-scope-label"></span>
    </div>

    <div class="glass-card" style="margin-bottom:16px;overflow-x:auto">
      <div style="padding:14px 16px 0;font-weight:700;font-size:14px">Cost breakdown <span style="font-weight:500;color:var(--text-secondary,#64748b)" id="pr-cost-scope"></span></div>
      <table class="data-table" id="pr-cost">
        <thead><tr><th>Component</th><th style="text-align:right">Count</th><th>Rate</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="glass-card" style="margin-bottom:16px;overflow-x:auto">
      <div style="padding:14px 16px 0;font-weight:700;font-size:14px">Monthly breakdown</div>
      <table class="data-table" id="pr-breakdown">
        <thead><tr><th>Month</th><th style="text-align:right">Orders</th><th style="text-align:right">Usage</th><th style="text-align:right">Charges</th><th style="text-align:right">Paid</th><th style="text-align:right">Due</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <div class="glass-card" style="overflow-x:auto">
      <div style="padding:14px 16px 0;font-weight:700;font-size:14px">Transactions</div>
      <table class="data-table" id="pr-ledger">
        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Receipt</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance after</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);
  wireControls();
  applyScopeVisibility();

  registerAction('pr-scope', (btn) => setScope(btn.dataset.scope));
  registerAction('pr-record-payment', onRecordPayment);
  registerAction('pr-add-charge', onAddCharge);
  registerAction('pr-receipt', (btn) => onReceipt(Number(btn.dataset.idx)));

  // Data arrives async (hard refresh lands here before the first snapshot) —
  // render the shell immediately and fill on the first value that has the outlet.
  const unsubscribe = subscribe((raw) => {
    const o = raw?.[bid]?.outlets?.[oid];
    if (!o) {
      if (Object.keys(raw).length) renderNotFound();
      return; // no snapshot yet — keep waiting
    }
    state.outlet = o;
    state.name = outletName(o, bid);
    const title = document.getElementById('pr-title');
    if (title) title.textContent = state.name;
    renderAll();
  });
  return unsubscribe;
}

function renderNotFound() {
  mainEl.innerHTML = `<div class="glass-card table-empty">
    Restaurant not found. <button class="btn btn-ghost btn-sm" data-action="navigate" data-href="payments">← Back to payments</button>
  </div>`;
}

function outletName(outlet, bid) {
  const store = (outlet.settings && outlet.settings.Store) || {};
  return outlet.name || store.storeName || outlet.outletName || outlet.businessName || bid;
}

function wireControls() {
  document.getElementById('pr-month').addEventListener('change', (e) => {
    if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
    state.ym = e.target.value;
    setScope('month');
  });
  document.getElementById('pr-year').addEventListener('change', () => setScope('year'));
  document.getElementById('pr-from').addEventListener('change', onRangeChange);
  document.getElementById('pr-to').addEventListener('change', onRangeChange);
}

function onRangeChange() {
  const from = document.getElementById('pr-from').value;
  const to = document.getElementById('pr-to').value;
  if (from && to && from <= to) setScope('range');
}

function setScope(kind) {
  if (kind === 'all') state.scope = { k: 'all' };
  else if (kind === 'month') state.scope = { k: 'month', ym: document.getElementById('pr-month').value || currentYm() };
  else if (kind === 'year') state.scope = { k: 'year', year: Number(document.getElementById('pr-year').value) || state.year };
  else {
    const from = document.getElementById('pr-from').value;
    const to = document.getElementById('pr-to').value;
    if (!from || !to || from > to) {
      // reveal the inputs first — they start hidden, so validating before
      // showing them makes Custom a dead end (can never fill an empty range)
      applyScopeVisibility('range');
      showToast('Pick a valid from → to range.', 'error');
      return;
    }
    state.scope = { k: 'range', from: Date.parse(`${from}T00:00:00+05:30`), to: Date.parse(`${to}T23:59:59+05:30`) };
  }
  applyScopeVisibility();
  renderAll();
}

function applyScopeVisibility(kind = state.scope.k) {
  document.querySelectorAll('.pr-scope').forEach((b) => {
    const on = b.dataset.scope === kind;
    b.style.borderColor = on ? 'var(--accent)' : '';
    b.style.color = on ? 'var(--accent)' : '';
    b.style.background = on ? 'var(--accent-soft)' : '';
  });
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('pr-month', kind === 'month');
  show('pr-year', kind === 'year');
  show('pr-from', kind === 'range');
  show('pr-to', kind === 'range');
  show('pr-range-sep', kind === 'range');
}

function renderAll() {
  const s = state.outlet;
  const scope = state.scope;
  const stats = scopeStats(s, scope);

  const sub = document.getElementById('pr-sub');
  if (sub) sub.textContent = `${scopeLabel(scope)} scope`;

  document.getElementById('pr-kpis').innerHTML = `
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="receipt-text" style="width:13px;height:13px"></svg> Usage</div>
      <div class="kpi-value">${inr(stats.usage)} <small>${stats.orders} orders</small></div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label"><svg data-lucide="plus-circle" style="width:13px;height:13px"></svg> Extra charges</div>
      <div class="kpi-value">${inr(stats.charges)}</div>
    </div>
    <div class="glass-card kpi-tile ${stats.paid > 0 ? 'accent-online' : ''}">
      <div class="kpi-label"><svg data-lucide="indian-rupee" style="width:13px;height:13px"></svg> Received</div>
      <div class="kpi-value">${inr(stats.paid)}</div>
    </div>
    <div class="glass-card kpi-tile ${stats.due > 0.009 ? 'accent-offline' : ''}">
      <div class="kpi-label"><svg data-lucide="scale" style="width:13px;height:13px"></svg> Balance due</div>
      <div class="kpi-value">${inr(Math.max(stats.due, 0))}${stats.due <= 0.009 ? ' <small>settled</small>' : ''}</div>
    </div>
  `;
  refreshIcons(document.getElementById('pr-kpis'));

  const scopeLabelEl = document.getElementById('pr-scope-label');
  if (scopeLabelEl) scopeLabelEl.textContent = scopeLabel(scope);

  renderYearOptions();
  renderCost(stats);
  renderBreakdown();
  renderLedger();
}

const SRC_LABEL = {
  QR: 'QR table orders',
  POS: 'POS orders',
  webview_delivery: 'Webview delivery',
  WA: 'WhatsApp orders',
  other: 'Other orders',
};

function renderCost(stats) {
  const tbody = document.querySelector('#pr-cost tbody');
  if (!tbody) return;
  const el = document.getElementById('pr-cost-scope');
  if (el) el.textContent = `· ${scopeLabel(state.scope)}`;
  const rows = [];
  for (const [src, b] of Object.entries(stats.bySource || {})) {
    if (!b.orders) continue;
    const rate = src === 'webview_delivery' && stats.mode === 'commission_1pct'
      ? '1% of sales'
      : `₹${stats.rates[src] ?? stats.rates.other}/order`;
    rows.push({ label: SRC_LABEL[src] || src, count: String(b.orders), rate, amount: b.cost });
  }
  if (stats.promo > 0) rows.push({ label: 'Promo messages', count: String(stats.promoTokens), rate: `₹${PROMO_RATE} each`, amount: stats.promo });
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No billable activity in this scope.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.label)}</strong></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${r.count}</td>
      <td style="color:var(--text-secondary,#64748b)">${escapeHtml(r.rate)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600">${inr(r.amount)}</td>
    </tr>`).join('') + `
    <tr style="font-weight:800;border-top:2px solid var(--glass-border,rgba(15,23,42,.10))">
      <td>Total usage</td>
      <td style="text-align:right">${stats.orders}</td>
      <td></td>
      <td style="text-align:right">${inr(stats.usage)}</td>
    </tr>`;
}

function renderYearOptions() {
  const sel = document.getElementById('pr-year');
  if (!sel) return;
  const years = [...new Set(monthlyRows(state.outlet).map((r) => r.ym.slice(0, 4)))].sort().reverse();
  if (!years.includes(String(state.year))) years.unshift(String(state.year));
  const wanted = String(state.scope.k === 'year' ? state.scope.year : state.year);
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === wanted ? 'selected' : ''}>${y}</option>`).join('');
}

function breakdownRows() {
  const rows = monthlyRows(state.outlet);
  const sc = state.scope;
  if (sc.k === 'month') return rows.filter((r) => r.ym === sc.ym);
  if (sc.k === 'year') return rows.filter((r) => r.ym.startsWith(`${sc.year}-`));
  if (sc.k === 'range') return rows.filter((r) => monthStartMs(r.ym) <= sc.to && monthEndMs(r.ym) > sc.from);
  return rows;
}

function renderBreakdown() {
  const tbody = document.querySelector('#pr-breakdown tbody');
  if (!tbody) return;
  const rows = breakdownRows();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No usage in this scope.</td></tr>`;
    return;
  }
  const sum = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${monthLabel(r.ym)}</strong></td>
      <td style="text-align:right">${r.orders}</td>
      <td style="text-align:right">${inr(r.usage)}</td>
      <td style="text-align:right">${inr(r.charges)}</td>
      <td style="text-align:right">${inr(r.paid)}</td>
      <td style="text-align:right;font-weight:700;color:${r.due > 0.009 ? 'var(--status-offline,#dc2626)' : 'var(--status-online,#16a34a)'}">${inr(Math.max(r.due, 0))}</td>
    </tr>`).join('') + `
    <tr style="font-weight:800;border-top:2px solid var(--glass-border,rgba(15,23,42,.10))">
      <td>Total</td>
      <td style="text-align:right">${sum('orders')}</td>
      <td style="text-align:right">${inr(sum('usage'))}</td>
      <td style="text-align:right">${inr(sum('charges'))}</td>
      <td style="text-align:right">${inr(sum('paid'))}</td>
      <td style="text-align:right">${inr(Math.max(sum('due'), 0))}</td>
    </tr>`;
}

function renderLedger() {
  const tbody = document.querySelector('#pr-ledger tbody');
  if (!tbody) return;
  const rows = ledgerRows(state.outlet, state.scope);
  state.ledger = rows;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No payments or charges in this scope.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const isPay = r.kind === 'payment';
    const when = r.ts
      ? `${formatDate(r.ts)}, ${new Date(r.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
      : '—';
    const details = isPay
      ? `<strong>${escapeHtml(r.method || 'Payment')}</strong>${r.note ? ` · ${escapeHtml(r.note)}` : ''}${r.period ? ` <span class="transport-badge" style="color:var(--text-secondary,#64748b)">${escapeHtml(r.period)}</span>` : ''}`
      : `${escapeHtml(r.desc)}${r.period ? ` <span class="transport-badge" style="color:var(--text-secondary,#64748b)">${escapeHtml(r.period)}</span>` : ''}`;
    return `
      <tr>
        <td style="white-space:nowrap">${escapeHtml(when)}</td>
        <td><span class="transport-badge" style="color:${isPay ? 'var(--status-online,#16a34a)' : 'var(--status-degraded,#d97706)'};background:${isPay ? 'rgba(22,163,74,.08)' : 'rgba(217,119,6,.08)'}">${isPay ? 'Payment' : 'Charge'}</span></td>
        <td>${details}</td>
        <td style="white-space:nowrap">${r.receiptNo ? `${escapeHtml(r.receiptNo)} <button class="btn btn-ghost btn-sm" data-action="pr-receipt" data-idx="${i}">Print</button>` : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${isPay ? 'var(--status-online,#16a34a)' : 'var(--status-offline,#dc2626)'}">${isPay ? '' : '+'}${inr(r.amount)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${inr(r.balance)}</td>
      </tr>`;
  }).join('');
}

async function onRecordPayment() {
  if (!state) return;
  const due = scopeStats(state.outlet, { k: 'all' }).due;
  const payment = await recordPaymentModal({ bid: state.bid, oid: state.oid, due: due > 0 ? due : 0 });
  if (!payment) return;
  const receipt = await showConfirm({
    title: 'Payment recorded',
    body: `Receipt ${payment.receiptNo} for ${inr(payment.amount)}. Create the printable receipt now?`,
    confirmLabel: 'Create receipt',
  });
  if (receipt) printPaymentReceipt(payment);
}

function printPaymentReceipt(payment) {
  printReceipt({
    businessName: businessName(state.outlet, state.bid),
    outletName: state.name,
    payment,
    stats: scopeStats(state.outlet, { k: 'all' }),
  });
}

async function onAddCharge() {
  if (!state) return;
  await addChargeModal({ bid: state.bid, oid: state.oid });
}

function onReceipt(idx) {
  const row = state.ledger[idx];
  if (!row || row.kind !== 'payment') return;
  printPaymentReceipt(row);
}

function businessName(outlet, bid) {
  const store = (outlet.settings && outlet.settings.Store) || {};
  return getRawBusinesses()[bid]?.name || store.entityName || outlet.businessName || bid;
}
