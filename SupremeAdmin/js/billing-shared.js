/**
 * Payment Management — shared money math, modals, receipt.
 * Single source used by payment-overview (tab), payment-record (page) and the
 * profile Billing card, so the same ₹ numbers appear in all three.
 *
 * Usage math mirrors the Admin Costs tab exactly: shared/cost-math.js with the
 * same rates/mode from billing config, Cancelled/Refunded excluded, promo
 * sends at PROMO_RATE. Scope = time window over createdAt (ISO string or ms).
 * Months are Asia/Kolkata calendar months.
 */
import { DEFAULT_RATES, PROMO_RATE, computeCostIndex } from '/shared/cost-math.js';
import { escapeHtml, showToast } from '/js/utils.js';

const IST = '+05:30';

// ---- time / scope -------------------------------------------------------
export const currentYm = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());

export function ymOf(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date(ts));
}

export function monthStartMs(ym) { return Date.parse(`${ym}-01T00:00:00${IST}`); }
export function monthEndMs(ym) {
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return Date.parse(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00${IST}`);
}

export function tsOf(x) {
  const c = x && x.createdAt;
  if (typeof c === 'number') return c;
  const t = Date.parse(c);
  return isNaN(t) ? 0 : t;
}

// scope: {k:'all'} | {k:'month', ym} | {k:'year', year} | {k:'range', from, to}
export function inScope(ts, scope) {
  if (!scope || scope.k === 'all') return true;
  if (scope.k === 'month') return ts >= monthStartMs(scope.ym) && ts < monthEndMs(scope.ym);
  if (scope.k === 'year') return ts >= Date.parse(`${scope.year}-01-01T00:00:00${IST}`) && ts < Date.parse(`${Number(scope.year) + 1}-01-01T00:00:00${IST}`);
  return ts >= scope.from && ts <= scope.to;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function scopeLabel(scope) {
  if (!scope || scope.k === 'all') return 'All time';
  if (scope.k === 'month') return monthLabel(scope.ym);
  if (scope.k === 'year') return String(scope.year);
  const f = new Date(scope.from), t = new Date(scope.to);
  const d = (x) => x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  return `${d(f)} → ${d(t)}`;
}

export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const list = (obj) => (obj ? Object.entries(obj).map(([id, v]) => ({ id, ...(v || {}) })) : []);
const ordersOf = (o) => list(o.orders);

function billingOf(outlet) {
  const b = outlet.billing || {};
  return {
    rates: { ...DEFAULT_RATES, ...(b.rates || {}) },
    mode: b.mode === 'commission_1pct' ? 'commission_1pct' : 'per_order',
    raw: b,
  };
}

/** Full usage/paid/due stats for an outlet within a scope. */
export function scopeStats(outlet, scope) {
  const { rates, mode } = billingOf(outlet);
  const orders = {};
  let promo = 0, promoTokens = 0;
  for (const o of ordersOf(outlet)) if (inScope(tsOf(o), scope)) orders[o.id] = o;
  for (const c of list(outlet.bot?.promotions?.campaigns)) {
    if (inScope(tsOf(c), scope)) {
      const sent = Number(c.totalSent || 0);
      promoTokens += sent;
      promo += sent * PROMO_RATE;
    }
  }
  const idx = computeCostIndex(orders, rates, mode);
  let charges = 0;
  for (const c of list(outlet.billing?.charges)) if (inScope(tsOf(c), scope)) charges += Number(c.amount || 0);
  let paid = 0;
  for (const p of list(outlet.billing?.payments)) if (inScope(tsOf(p), scope)) paid += Number(p.amount || 0);
  const usage = Math.round((idx.total + promo) * 100) / 100;
  charges = Math.round(charges * 100) / 100;
  paid = Math.round(paid * 100) / 100;
  return { orders: idx.count, orderFees: idx.total, promo: Math.round(promo * 100) / 100, promoTokens, usage, charges, paid, due: Math.round((usage + charges - paid) * 100) / 100, bySource: idx.bySource, rates, mode };
}

/** Per-month rows (desc) for the Monthly/Yearly breakdown. One pass, bucketed by IST month. */
export function monthlyRows(outlet) {
  const { rates, mode } = billingOf(outlet);
  const buckets = new Map(); // ym -> {orders:{}, promo, charges, paid}
  const bucket = (ts) => {
    const ym = ymOf(ts);
    let b = buckets.get(ym);
    if (!b) buckets.set(ym, (b = { orders: {}, promo: 0, charges: 0, paid: 0 }));
    return b;
  };
  for (const o of ordersOf(outlet)) bucket(tsOf(o)).orders[o.id] = o;
  for (const c of list(outlet.bot?.promotions?.campaigns)) bucket(tsOf(c)).promo += Number(c.totalSent || 0) * PROMO_RATE;
  for (const c of list(outlet.billing?.charges)) bucket(tsOf(c)).charges += Number(c.amount || 0);
  for (const p of list(outlet.billing?.payments)) bucket(tsOf(p)).paid += Number(p.amount || 0);
  return [...buckets.entries()]
    .map(([ym, b]) => {
      const idx = computeCostIndex(b.orders, rates, mode);
      const usage = Math.round((idx.total + b.promo) * 100) / 100;
      const charges = Math.round(b.charges * 100) / 100;
      const paid = Math.round(b.paid * 100) / 100;
      return { ym, orders: idx.count, usage, charges, paid, due: Math.round((usage + charges - paid) * 100) / 100 };
    })
    .filter((r) => r.orders || r.usage || r.charges || r.paid) // drop empty buckets (e.g. epoch createdAt garbage)
    .sort((a, b) => (a.ym < b.ym ? 1 : -1));
}

export function yearlyRows(rows) {
  const byYear = new Map();
  for (const r of rows) {
    const y = r.ym.slice(0, 4);
    let a = byYear.get(y);
    if (!a) byYear.set(y, (a = { ym: y, orders: 0, usage: 0, charges: 0, paid: 0, due: 0 }));
    a.orders += r.orders;
    a.usage = Math.round((a.usage + r.usage) * 100) / 100;
    a.charges = Math.round((a.charges + r.charges) * 100) / 100;
    a.paid = Math.round((a.paid + r.paid) * 100) / 100;
  }
  for (const a of byYear.values()) a.due = Math.round((a.usage + a.charges - a.paid) * 100) / 100;
  return [...byYear.values()].sort((a, b) => (a.ym < b.ym ? 1 : -1));
}

/** Payments + charges in scope, oldest first, with running balance after each row. */
export function ledgerRows(outlet, scope) {
  const s = scopeStats(outlet, scope);
  const rows = [];
  let cumCharges = 0, cumPaid = 0;
  for (const c of list(outlet.billing?.charges)) {
    if (inScope(tsOf(c), scope)) rows.push({ ts: tsOf(c), kind: 'charge', amount: Number(c.amount || 0), desc: c.reason || 'Charge', period: c.period || '', id: c.id });
  }
  for (const p of list(outlet.billing?.payments)) {
    if (inScope(tsOf(p), scope)) rows.push({ ts: tsOf(p), kind: 'payment', amount: Number(p.amount || 0), desc: p.method || 'Payment', note: p.note || '', receiptNo: p.receiptNo || '', period: p.period || '', id: p.id, method: p.method, createdBy: p.createdBy || '' });
  }
  rows.sort((a, b) => a.ts - b.ts);
  for (const r of rows) {
    if (r.kind === 'charge') cumCharges += r.amount;
    else cumPaid += r.amount;
    r.balance = Math.round((s.usage + cumCharges - cumPaid) * 100) / 100;
  }
  return rows.reverse(); // newest first for display; balance still "after this row"
}

// ---- modals -------------------------------------------------------------
function mountModal(id, html, onDismiss) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal open" id="${id}">${html}</div>`;
  const modal = document.getElementById(id);
  const close = () => {
    modal.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { if (root.firstChild === modal || document.getElementById(id) === modal) root.innerHTML = ''; }, 180);
  };
  // every dismiss path must resolve the caller's promise — Esc/backdrop used to
  // close silently and hang `await recordPaymentModal(...)` forever
  const dismiss = () => { close(); onDismiss?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });
  return { modal, close };
}

const uid = () => (typeof firebase !== 'undefined' && firebase.auth()?.currentUser?.uid) || '';

export function recordPaymentModal({ bid, oid, due = 0 }) {
  return new Promise((resolve) => {
    const period = currentYm();
    const suggested = due > 0 ? due : '';
    const { modal, close } = mountModal('pay-modal', `
      <div class="modal-content" role="dialog" aria-modal="true" aria-label="Record payment">
        <div class="confirm-title">Record payment</div>
        <div class="confirm-body">
          <label class="field-label" for="pm-amount">Amount received (₹)</label>
          <input class="text-input" id="pm-amount" type="number" min="0.01" max="10000000" step="0.01" value="${suggested}" placeholder="e.g. 500" style="margin-bottom:12px" />
          <label class="field-label" for="pm-method">Method</label>
          <select class="text-input" id="pm-method" style="margin-bottom:12px">
            <option value="UPI">UPI</option><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank">Bank transfer</option>
          </select>
          <label class="field-label" for="pm-period">For period</label>
          <input class="text-input" id="pm-period" type="month" value="${period}" style="margin-bottom:12px" />
          <label class="field-label" for="pm-note">Note (optional)</label>
          <input class="text-input" id="pm-note" type="text" maxlength="500" placeholder="e.g. UPI to 98xxxxxx" />
        </div>
        <div class="confirm-actions">
          <button class="btn btn-ghost" data-pay="cancel">Cancel</button>
          <button class="btn btn-primary" data-pay="ok">Record payment</button>
        </div>
      </div>`, () => resolve(null));
    modal.querySelector('#pm-amount').focus();
    const done = (val) => { close(); resolve(val); };
    modal.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-pay]')?.dataset.pay;
      if (act === 'cancel') return done(null);
      if (act !== 'ok') return;
      const amount = Number(modal.querySelector('#pm-amount').value);
      const method = modal.querySelector('#pm-method').value;
      const per = modal.querySelector('#pm-period').value;
      const note = modal.querySelector('#pm-note').value.trim();
      if (!(amount > 0)) return showToast('Enter a valid amount.', 'error');
      if (!/^\d{4}-\d{2}$/.test(per)) return showToast('Pick a period (YYYY-MM).', 'error');
      const okBtn = modal.querySelector('[data-pay="ok"]');
      okBtn.disabled = true; // guard: a second click before set() resolves would push a duplicate payment row
      try {
        const ref = firebase.database().ref(`businesses/${bid}/outlets/${oid}/billing/payments`).push();
        const now = Date.now();
        const d = new Date(now);
        const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const receiptNo = `RCP-${ymd}-${(ref.key || 'xxx').slice(-3).toUpperCase()}`;
        await ref.set({ amount, method, period: per, note: note || null, receiptNo, createdAt: now, createdBy: uid() });
        showToast(`Payment of ${inr(amount)} recorded.`, 'success');
        done({ amount, method, period: per, note, receiptNo, createdAt: now, id: ref.key });
      } catch (err) {
        okBtn.disabled = false;
        console.error('record payment failed', err);
        showToast('Could not save the payment — try again.', 'error');
      }
    });
  });
}

export function addChargeModal({ bid, oid }) {
  return new Promise((resolve) => {
    const period = currentYm();
    const { modal, close } = mountModal('charge-modal', `
      <div class="modal-content" role="dialog" aria-modal="true" aria-label="Add charge">
        <div class="confirm-title">Add charge</div>
        <div class="confirm-body">
          <label class="field-label" for="ch-amount">Amount (₹)</label>
          <input class="text-input" id="ch-amount" type="number" min="0.01" max="10000000" step="0.01" placeholder="e.g. 200" style="margin-bottom:12px" />
          <label class="field-label" for="ch-reason">Reason</label>
          <input class="text-input" id="ch-reason" type="text" maxlength="200" placeholder="e.g. Banner design" style="margin-bottom:12px" />
          <label class="field-label" for="ch-period">For period</label>
          <input class="text-input" id="ch-period" type="month" value="${period}" />
        </div>
        <div class="confirm-actions">
          <button class="btn btn-ghost" data-ch="cancel">Cancel</button>
          <button class="btn btn-primary" data-ch="ok">Add charge</button>
        </div>
      </div>`, () => resolve(null));
    modal.querySelector('#ch-amount').focus();
    const done = (val) => { close(); resolve(val); };
    modal.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-ch]')?.dataset.ch;
      if (act === 'cancel') return done(null);
      if (act !== 'ok') return;
      const amount = Number(modal.querySelector('#ch-amount').value);
      const reason = modal.querySelector('#ch-reason').value.trim();
      const per = modal.querySelector('#ch-period').value;
      if (!(amount > 0)) return showToast('Enter a valid amount.', 'error');
      if (!reason) return showToast('Reason is required.', 'error');
      if (!/^\d{4}-\d{2}$/.test(per)) return showToast('Pick a period (YYYY-MM).', 'error');
      const okBtn = modal.querySelector('[data-ch="ok"]');
      okBtn.disabled = true; // guard: a second click before set() resolves would push a duplicate charge row
      try {
        const ref = firebase.database().ref(`businesses/${bid}/outlets/${oid}/billing/charges`).push();
        await ref.set({ amount, reason, period: per, createdAt: Date.now(), createdBy: uid() });
        showToast(`Charge of ${inr(amount)} added.`, 'success');
        done({ amount, reason, period: per, id: ref.key });
      } catch (err) {
        okBtn.disabled = false;
        console.error('add charge failed', err);
        showToast('Could not save the charge — try again.', 'error');
      }
    });
  });
}

// ---- receipt (popup print window — user gesture opens it, zero deps) ----
export function printReceipt({ businessName, outletName, payment, stats }) {
  const w = window.open('', '_blank', 'width=460,height=720');
  if (!w) return showToast('Allow popups to print receipts.', 'error');
  const d = new Date(payment.createdAt ?? payment.ts ?? Date.now());
  const when = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(payment.receiptNo || 'Receipt')}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f1f5f9;margin:0;padding:18px;color:#0f172a}
  .rc{background:#fff;max-width:380px;margin:0 auto;padding:22px;border:1px solid #e2e8f0;border-radius:10px}
  h1{font-size:15px;margin:0;letter-spacing:.4px;text-transform:uppercase}
  .brand{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:14px}
  .no{font-size:12px;font-weight:700;color:#4f46e5}
  .row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px dashed #e2e8f0}
  .row b{font-variant-numeric:tabular-nums}
  .big{font-size:19px;font-weight:800;color:#059669}
  .muted{color:#64748b;font-size:11.5px}
  .tot{display:flex;justify-content:space-between;font-size:14px;font-weight:800;padding-top:10px;border-top:2px solid #0f172a;margin-top:8px}
  .btns{text-align:center;margin-top:16px}
  .btns button{font:inherit;padding:9px 22px;border-radius:8px;border:0;background:#4f46e5;color:#fff;cursor:pointer}
  @media print{ body{background:#fff;padding:0} .btns{display:none} .rc{border:0} }
</style></head><body><div class="rc">
  <div class="brand"><h1>Food-Hubbie</h1><span class="no">${escapeHtml(payment.receiptNo || '')}</span></div>
  <div class="row"><span>Received from</span><b>${escapeHtml(outletName || '—')}</b></div>
  <div class="row"><span>Business</span><b>${escapeHtml(businessName || '—')}</b></div>
  <div class="row"><span>Date &amp; time</span><b>${escapeHtml(when)} IST</b></div>
  <div class="row"><span>Period</span><b>${escapeHtml(payment.period || '—')}</b></div>
  <div class="row"><span>Method</span><b>${escapeHtml(payment.method || '—')}</b></div>
  ${payment.note ? `<div class="row"><span>Note</span><b>${escapeHtml(payment.note)}</b></div>` : ''}
  <div class="row" style="border-bottom:0;padding-top:12px"><span>Amount received</span><b class="big">${inr(payment.amount)}</b></div>
  <div class="row"><span>Usage (all time)</span><b>${inr(stats.usage)}</b></div>
  <div class="row"><span>Extra charges</span><b>${inr(stats.charges)}</b></div>
  <div class="row"><span>Paid to date</span><b>${inr(stats.paid)}</b></div>
  <div class="tot"><span>Balance due</span><span>${inr(stats.due)}</span></div>
  <div class="muted" style="margin-top:10px">Generated ${escapeHtml(when)} IST · Food-Hubbie platform billing · ${escapeHtml(businessName || '')}</div>
  <div class="btns"><button onclick="window.print()">Print / Save PDF</button></div>
</div></body></html>`);
  w.document.close();
}
