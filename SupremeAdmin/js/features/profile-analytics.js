/**
 * Analytics & Revenue sub-tab for the restaurant profile page.
 *
 * Reuses the live `businesses` snapshot (data-store.js) — the orders are
 * already streamed under businesses/{bid}/outlets/{oid}/orders, so this
 * renders with zero extra reads. Design mirrors the Admin dashboard's
 * analytics: KPI cards with sparklines + vs-previous-period deltas, Sales
 * Overview line chart (Chart.js from jsdelivr when available, inline SVG
 * fallback), order-status highlights, payment-method donut, and a sortable
 * detailed sales table.
 *
 * Business-logic definitions (same as Admin analytics-mobile.js):
 *   Delivered  = status 'Delivered' | 'Served'
 *   Cancelled  = status (case-insensitive) 'cancelled'
 *   Pending    = anything else
 *   New customer  = phone whose EARLIEST order falls inside the range
 *   Repeat customer = phone with an order in range whose earliest order is
 *                     BEFORE the range start
 * Previous period = the same-length window immediately before the range.
 */

import { registerAction } from '/js/main.js';
import { getRawBusinesses } from '/js/data-store.js';

const PALETTE = { revenue: '#E84908', orders: '#2563eb', avgOrder: '#9333ea', newCust: '#d97706' };
const PAY_COLORS = { upi: '#9333ea', cash: '#16a34a', cod: '#d97706' };

// Module state — survives the 30s re-render tick (same pattern as the
// wizard state in whatsapp-manage.js).
let st = null; // { bid, oid, preset, from, to, sortField, sortDir }
let overviewChart = null;
let chartReady = null;

function num(v) { const n = Number(v || 0); return isFinite(n) ? n : 0; }
function fmtMoney(n) {
  const v = num(n);
  return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}
function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
function deltaOf(cur, prev) { return prev ? ((cur - prev) / prev) * 100 : null; }
function dayKey(ts) { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
function dayLabel(key, spanDays) {
  const d = new Date(key + 'T00:00:00');
  if (spanDays <= 7) return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
function formatDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function mount(bid, oid) {
  const root = document.getElementById('pa-root');
  if (!root) return;
  if (!st || st.bid !== bid || st.oid !== oid) st = { bid, oid, preset: '30d', from: null, to: null, sortField: 'createdAt', sortDir: 'desc' };

  const raw = getRawBusinesses();
  const biz = raw?.[bid];
  const outlet = biz?.outlets?.[oid];
  if (!outlet) {
    root.innerHTML = `<div class="glass-card table-empty">This outlet could not be found.</div>`;
    return;
  }

  const orders = Object.entries(outlet.orders || {}).map(([key, o]) => ({
    key, createdAt: o.createdAt, total: o.total, status: o.status,
    paymentMethod: o.paymentMethod, type: o.type, customerName: o.customerName,
    phone: o.phone, items: o.items, orderId: o.orderId,
  }));
  const data = compute(orders);
  render(root, bid, oid, data);
}

function compute(orders) {
  const range = resolveRange();
  const { from, to } = range;
  const periodMs = new Date(to).getTime() - new Date(from).getTime();
  const pTo = dayKey(new Date(from).getTime() - 86400000);
  const pFrom = dayKey(new Date(from).getTime() - periodMs - 86400000);

  const inRange = orders.filter((o) => dayKey(o.createdAt) >= from && dayKey(o.createdAt) <= to);
  const prevOrders = orders.filter((o) => dayKey(o.createdAt) >= pFrom && dayKey(o.createdAt) <= pTo);

  const isDelivered = (o) => o.status === 'Delivered' || o.status === 'Served';
  const isCancelled = (o) => (o.status || '').toLowerCase() === 'cancelled';
  const delivered = inRange.filter(isDelivered);
  const cancelled = inRange.filter(isCancelled);
  const pending = inRange.filter((o) => !isDelivered(o) && !isCancelled(o));
  const prevDelivered = prevOrders.filter(isDelivered);

  const curRev = delivered.reduce((s, o) => s + num(o.total), 0);
  const curOrd = delivered.length;
  const curAvg = curOrd ? curRev / curOrd : 0;
  const prevRev = prevDelivered.reduce((s, o) => s + num(o.total), 0);
  const prevOrd = prevDelivered.length;
  const prevAvg = prevOrd ? prevRev / prevOrd : 0;

  // New vs repeat — earliest order per phone across ALL orders.
  const firstByPhone = {};
  orders.forEach((o) => {
    if (!o.phone) return;
    const t = new Date(o.createdAt).getTime() || 0;
    if (!firstByPhone[o.phone] || t < firstByPhone[o.phone]) firstByPhone[o.phone] = t;
  });
  const newCust = countNewCust(delivered, firstByPhone, from, to);
  const prevNewCust = countNewCust(prevDelivered, firstByPhone, pFrom, pTo);
  const repeatCust = countRepeatCust(delivered, firstByPhone, from);
  const prevRepeatCust = countRepeatCust(prevDelivered, firstByPhone, pFrom);

  const series = buildSeries(delivered, from, to);
  const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;

  const totalForPct = inRange.length || 1;
  const paymentTotals = { upi: 0, cash: 0, cod: 0 };
  delivered.forEach((o) => {
    const pm = (o.paymentMethod || 'cod').toLowerCase();
    const b = pm === 'upi' ? 'upi' : pm === 'cash' ? 'cash' : 'cod';
    paymentTotals[b] += num(o.total);
  });

  return {
    range, pFrom, pTo,
    kpis: {
      revenue: { value: curRev, delta: deltaOf(curRev, prevRev), spark: series.rev },
      orders: { value: curOrd, delta: deltaOf(curOrd, prevOrd), spark: series.ord },
      avgOrder: { value: curAvg, delta: deltaOf(curAvg, prevAvg), spark: series.avg },
      newCust: { value: newCust, delta: deltaOf(newCust, prevNewCust), spark: series.newCust },
    },
    highlights: [
      { id: 'delivered', label: 'Delivered', value: delivered.length, sub: (delivered.length / totalForPct * 100).toFixed(1) + '%', tone: 'good' },
      { id: 'cancelled', label: 'Cancelled', value: cancelled.length, sub: (cancelled.length / totalForPct * 100).toFixed(1) + '%', tone: 'bad' },
      { id: 'pending', label: 'Pending', value: pending.length, sub: (pending.length / totalForPct * 100).toFixed(1) + '%', tone: 'warn' },
      { id: 'repeat', label: 'Repeat customers', value: repeatCust, sub: deltaOf(repeatCust, prevRepeatCust) === null ? '—' : pct(deltaOf(repeatCust, prevRepeatCust)), tone: 'info' },
    ],
    paymentTotals,
    paymentTotal: curRev,
    series,
    spanDays,
    rows: inRange,
  };
}

function countNewCust(delivered, firstByPhone, from, to) {
  const seen = new Set();
  delivered.forEach((o) => {
    if (!o.phone) return;
    const k = dayKey(firstByPhone[o.phone]);
    if (k >= from && k <= to) seen.add(o.phone);
  });
  return seen.size;
}

function countRepeatCust(delivered, firstByPhone, from) {
  const seen = new Set();
  delivered.forEach((o) => {
    if (!o.phone) return;
    if (dayKey(firstByPhone[o.phone]) < from) seen.add(o.phone);
  });
  return seen.size;
}

function resolveRange() {
  const today = dayKey(Date.now());
  let from, to;
  if (st.preset === 'custom' && st.from && st.to) {
    from = st.from; to = st.to;
  } else {
    to = today;
    const span = { today: 0, '7d': 6, '30d': 29 }[st.preset] ?? 29;
    from = dayKey(Date.now() - span * 86400000);
  }
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function buildSeries(delivered, from, to) {
  const spanDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  const revByDay = {}, ordByDay = {};
  delivered.forEach((o) => {
    const k = dayKey(o.createdAt);
    revByDay[k] = (revByDay[k] || 0) + num(o.total);
    ordByDay[k] = (ordByDay[k] || 0) + 1;
  });
  const firstByPhone = {};
  const firstOrderDayByPhone = {};
  delivered.forEach((o) => {
    if (!o.phone) return;
    const t = new Date(o.createdAt).getTime() || 0;
    if (!firstByPhone[o.phone] || t < firstByPhone[o.phone]) firstByPhone[o.phone] = t;
  });
  Object.entries(firstByPhone).forEach(([p, t]) => {
    if (dayKey(t) >= from && dayKey(t) <= to) firstOrderDayByPhone[dayKey(t)] = (firstOrderDayByPhone[dayKey(t)] || 0) + 1;
  });

  const start = new Date(from + 'T00:00:00').getTime();
  const keys = [];
  for (let i = 0; i < spanDays; i++) keys.push(dayKey(start + i * 86400000));
  return {
    keys,
    rev: keys.map((k) => revByDay[k] || 0),
    ord: keys.map((k) => ordByDay[k] || 0),
    avg: keys.map((k) => (ordByDay[k] ? (revByDay[k] || 0) / ordByDay[k] : 0)),
    newCust: keys.map((k) => firstOrderDayByPhone[k] || 0),
  };
}

// ---- rendering ---------------------------------------------------------

function render(root, bid, oid, data) {
  const rangeLabel = st.preset === 'custom'
    ? `${data.range.from} → ${data.range.to}`
    : { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }[st.preset];

  root.innerHTML = `
    <div class="pa-range-row">
      ${rangePills()}
      <div class="pa-range-label">${escapeHtml(rangeLabel)}</div>
      ${st.preset === 'custom' ? customDates() : ''}
    </div>

    <div class="pa-kpi-grid">
      ${kpiCard('Revenue', 'indian-rupee', PALETTE.revenue, data.kpis.revenue, fmtMoney)}
      ${kpiCard('Orders', 'shopping-bag', PALETTE.orders, data.kpis.orders, (v) => String(Math.round(v)))}
      ${kpiCard('Avg order value', 'receipt', PALETTE.avgOrder, data.kpis.avgOrder, (v) => fmtMoney(Math.round(v)))}
      ${kpiCard('New customers', 'user-plus', PALETTE.newCust, data.kpis.newCust, (v) => String(v))}
    </div>

    <div class="glass-card pa-card">
      <div class="pa-card-head">
        <strong>Sales Overview</strong>
        <div class="pa-overview-meta">
          <span class="pa-big">${fmtMoney(data.kpis.revenue.value)}</span>
          ${trendHtml(data.kpis.revenue.delta)}
        </div>
      </div>
      <div class="pa-chart-box" id="pa-overview-box">${areaSvg(data.series.rev, PALETTE.revenue, 720, 190)}</div>
    </div>

    <div class="pa-grid-2">
      <div class="glass-card pa-card">
        <div class="pa-card-head"><strong>Highlights</strong></div>
        <div class="pa-hl-grid">
          ${data.highlights.map((h) => `
            <div class="pa-hl-item">
              <div class="pa-hl-label">${h.label}</div>
              <div class="pa-hl-value">${h.value}</div>
              <div class="pa-hl-pct pa-hl-${h.tone}">${h.sub}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="glass-card pa-card">
        <div class="pa-card-head"><strong>Payments</strong></div>
        <div class="pa-donut-wrap">
          ${donutCss(data.paymentTotals, data.paymentTotal)}
          <div class="pa-legend">
            ${['upi', 'cash', 'cod'].map((b) => {
              const amt = data.paymentTotals[b];
              const p = data.paymentTotal ? Math.round((amt / data.paymentTotal) * 100) : 0;
              return `<div class="pa-legend-item">
                <span class="pa-legend-dot" style="background:${PAY_COLORS[b]}"></span>
                <span class="pa-legend-name">${b.toUpperCase()}</span>
                <span class="pa-legend-amt">${fmtMoney(amt)}</span>
                <span class="pa-legend-pct">${p}%</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="glass-card pa-card">
      <div class="pa-card-head">
        <strong>Detailed sales</strong>
        <span class="pa-count" id="pa-table-count"></span>
      </div>
      <div class="pa-table-wrap">
        <table class="pa-table">
          <thead>
            <tr>
              <th data-action="pa-sort" data-field="createdAt">Date ${sortArrow('createdAt')}</th>
              <th>Order</th>
              <th data-action="pa-sort" data-field="customerName">Customer ${sortArrow('customerName')}</th>
              <th data-action="pa-sort" data-field="status">Status ${sortArrow('status')}</th>
              <th>Type</th>
              <th>Payment</th>
              <th data-action="pa-sort" data-field="total" class="pa-th-right">Total ${sortArrow('total')}</th>
            </tr>
          </thead>
          <tbody id="pa-table-body"></tbody>
        </table>
      </div>
    </div>
  `;
  refreshIcons(root);

  renderTable(document.getElementById('pa-table-body'), data.rows);
  document.getElementById('pa-table-count').textContent = `${data.rows.length} order${data.rows.length === 1 ? '' : 's'}`;

  // Bind custom date inputs (native date pickers, no dependency).
  const fromEl = root.querySelector('#pa-from');
  const toEl = root.querySelector('#pa-to');
  if (fromEl) fromEl.addEventListener('change', () => { st.preset = 'custom'; st.from = fromEl.value; st.to = toEl.value; reMount(); });
  if (toEl) toEl.addEventListener('change', () => { st.preset = 'custom'; st.from = fromEl.value; st.to = toEl.value; reMount(); });

  drawOverview(bid, oid);
}

function reMount() {
  if (st) mount(st.bid, st.oid);
}

function rangePills() {
  return ['today', '7d', '30d', 'custom'].map((p) => `
    <button class="pa-range-pill${st.preset === p ? ' active' : ''}" data-action="pa-range" data-preset="${p}">
      ${p === 'today' ? 'Today' : p === '7d' ? '7D' : p === '30d' ? '30D' : 'Custom'}
    </button>`).join('');
}

function customDates() {
  const { from, to } = resolveRange();
  return `<div class="pa-custom-dates">
    <label>From <input type="date" id="pa-from" value="${escapeHtml(from)}"></label>
    <label>To <input type="date" id="pa-to" value="${escapeHtml(to)}"></label>
  </div>`;
}

function kpiCard(label, icon, color, kpi, format) {
  return `
    <div class="glass-card pa-kpi-card" style="--kpi-accent:${color}">
      <div class="pa-kpi-label"><svg data-lucide="${icon}" style="width:13px;height:13px"></svg> ${label}</div>
      <div class="pa-kpi-value">${format(kpi.value)}</div>
      ${trendHtml(kpi.delta)}
      <div class="pa-spark">${sparkSvg(kpi.spark, color)}</div>
    </div>`;
}

function trendHtml(delta) {
  if (delta === null || !isFinite(delta)) return `<span class="pa-trend flat">— vs previous</span>`;
  const up = delta >= 0;
  return `<span class="pa-trend ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)}% <span class="pa-trend-sub">vs previous</span></span>`;
}

function sparkSvg(values, color) {
  if (!values.length) return '';
  const w = 110, h = 30, pad = 2;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) =>
    `${(pad + (i * (w - 2 * pad)) / (values.length - 1 || 1)).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polygon points="${pad},${h - pad} ${pts} ${w - pad},${h - pad}" fill="${color}1f"></polygon>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}

function areaSvg(values, color, w, h) {
  if (!values.length) return `<div class="pa-empty">No data for this range.</div>`;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) =>
    `${((i * w) / (values.length - 1 || 1)).toFixed(1)},${(h - (v / max) * (h - 16)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polygon points="0,${h} ${pts} ${w},${h}" fill="${color}1f"></polygon>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
  </svg>`;
}

function donutCss(totals, total) {
  const segs = ['upi', 'cash', 'cod'].filter((b) => totals[b] > 0);
  if (!segs.length) return `<div class="pa-empty">No payments this range.</div>`;
  let acc = 0;
  const stops = segs.map((b) => {
    const pct = total ? (totals[b] / total) * 100 : 0;
    const from = acc;
    acc += pct;
    return `${PAY_COLORS[b]} ${from}% ${acc}%`;
  }).join(', ');
  const centerPct = segs.length === 1 ? 100 : 62;
  return `<div class="pa-donut-ring">
    <div class="pa-donut" style="background:conic-gradient(${stops})"></div>
    <div class="pa-donut-hole"></div>
  </div>`;
}

function renderTable(tbody, rows) {
  const sorted = [...rows].sort((a, b) => {
    let av = a[st.sortField], bv = b[st.sortField];
    if (st.sortField === 'total') { av = num(av); bv = num(bv); }
    else { av = String(av || ''); bv = String(bv || ''); }
    const cmp = av > bv ? 1 : av < bv ? -1 : 0;
    return st.sortDir === 'asc' ? cmp : -cmp;
  });
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="pa-table-empty">No orders found for this range.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map((o) => {
    const items = o.items;
    const count = Array.isArray(items) ? items.length : Object.keys(items || {}).length;
    return `<tr>
      <td>
        <div class="pa-td-strong">${formatDateTime(o.createdAt)}</div>
        <div class="pa-td-sub">#${escapeHtml(String(o.orderId || o.key || '').slice(-5).toUpperCase())}</div>
      </td>
      <td>${count ? `${count} item${count === 1 ? '' : 's'}` : '—'}</td>
      <td>
        <div class="pa-td-strong">${escapeHtml(o.customerName || 'Guest')}</div>
        ${o.phone ? `<div class="pa-td-sub">${escapeHtml(o.phone)}</div>` : ''}
      </td>
      <td>${badge('status', o.status)}</td>
      <td>${badge('type', o.type)}</td>
      <td>${badge('pay', o.paymentMethod)}</td>
      <td class="pa-th-right pa-td-total">${fmtMoney(o.total)}</td>
    </tr>`;
  }).join('');
}

function badge(kind, value) {
  const v = value || (kind === 'status' ? 'Placed' : kind === 'type' ? 'Online' : 'COD');
  let cls;
  if (kind === 'status') cls = v === 'Delivered' || v === 'Served' ? 'good' : v.toLowerCase() === 'cancelled' ? 'bad' : 'warn';
  else if (kind === 'type') cls = 'type';
  else cls = String(v).toLowerCase() === 'upi' ? 'upi' : String(v).toLowerCase() === 'cash' ? 'cash' : 'cod';
  return `<span class="pa-badge pa-badge-${kind} ${cls}">${escapeHtml(v)}</span>`;
}

function sortArrow(field) {
  if (st.sortField !== field) return '';
  return st.sortDir === 'asc' ? '↑' : '↓';
}

// ---- Chart.js upgrade (jsdelivr, CSP-allowed) --------------------------
function ensureChart() {
  if (window.Chart) return Promise.resolve();
  if (!chartReady) {
    chartReady = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm')
      .then((m) => {
        const C = m.Chart;
        if (C && C.register) {
          C.register(m.CategoryScale, m.LinearScale, m.LineElement, m.PointElement, m.LineController, m.Tooltip, m.Legend, m.Filler);
        }
        window.Chart = C;
      })
      .catch(() => { window.Chart = null; });
  }
  return chartReady;
}

async function drawOverview(bid, oid) {
  await ensureChart();
  if (overviewChart) { overviewChart.destroy(); overviewChart = null; }
  if (!window.Chart || !st || st.bid !== bid || st.oid !== oid) return; // keep SVG fallback
  const box = document.getElementById('pa-overview-box');
  if (!box || box.querySelector('canvas')) return;
  const raw = getRawBusinesses();
  const outlet = raw?.[bid]?.outlets?.[oid];
  if (!outlet) return;
  const orders = Object.values(outlet.orders || {});
  const data = compute(orders);
  const canvas = document.createElement('canvas');
  box.innerHTML = '';
  box.appendChild(canvas);
  const labels = data.series.keys.map((k) => dayLabel(k, data.spanDays));
  const values = data.series.rev;
  const peakIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  overviewChart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['—'],
      datasets: [{
        data: values.length ? values : [0],
        borderColor: PALETTE.revenue,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
          g.addColorStop(0, PALETTE.revenue + '80');
          g.addColorStop(0.6, PALETTE.revenue + '20');
          g.addColorStop(1, PALETTE.revenue + '02');
          return g;
        },
        borderWidth: 3,
        pointRadius: values.map((_, i) => (i === peakIdx ? 6 : 4)),
        pointBackgroundColor: values.map((_, i) => (i === peakIdx ? PALETTE.revenue : '#fff')),
        pointBorderColor: PALETTE.revenue,
        pointBorderWidth: 2,
        tension: 0.35,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 }, color: '#94a3b8' } },
        y: { grid: { color: 'rgba(15,23,42,.06)' }, ticks: { font: { size: 11 }, color: '#94a3b8', callback: (v) => fmtMoney(v).replace('₹', '₹') } },
      },
    },
  });
}

// ---- actions ------------------------------------------------------------
registerAction('pa-range', (btn) => {
  const preset = btn.dataset.preset;
  if (preset === 'custom') { st.preset = 'custom'; }
  else { st.preset = preset; st.from = null; st.to = null; }
  reMount();
});

registerAction('pa-sort', (btn) => {
  const field = btn.dataset.field;
  if (st.sortField === field) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortField = field; st.sortDir = 'asc'; }
  reMount();
});