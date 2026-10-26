/**
 * Billing card template - renders billing info, rates, tokens, grants
 */

import { escapeHtml } from '/js/utils.js';
import { scopeStats, inr, currentYm, monthLabel, recordPaymentModal, printReceipt } from '../../billing-shared.js';

export function renderBillingCard(outlet, readOnly, bid, oid, biz, collapsedSections, billingDraft) {
  const b = outlet.billing || null;
  const collapsed = collapsedSections.has('billing-body');
  const ro = readOnly ? 'disabled' : '';
  const roTitle = readOnly ? 'View-only account' : '';
  const header = `
    <div class="collapsible-header${collapsed ? ' collapsed' : ''}" data-action="toggle-section" data-target="billing-body" role="button" tabindex="0" aria-expanded="${!collapsed}" aria-controls="billing-body" style="margin-bottom:10px">
      <strong style="display:block"><svg data-lucide="wallet" style="width:14px;height:14px;vertical-align:-2px"></svg> Billing & promo tokens</strong>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:12px;color:var(--text-secondary)">${b ? `${b.tokens?.balance ?? 0} tokens` : 'Not seeded'}</span>
        <svg data-lucide="chevron-down" class="chevron-icon" style="width:14px;height:14px;color:var(--text-tertiary)"></svg>
      </div>`;

  if (!b) {
    return `<div class="glass-card" style="font-size:13px;margin-bottom:16px">${header}
      <div class="collapsible-body${collapsed ? ' collapsed' : ''}" id="billing-body" style="color:var(--text-secondary)">Billing not set up yet — run <span class="mono">tools/seed-billing-defaults.cjs</span>.</div>
    </div>`;
  }

  const mode = b.mode === 'commission_1pct' ? 'commission_1pct' : 'per_order';
  const rates = b.rates || {};
  const bal = b.tokens?.balance ?? 0;
  const setupStatus = billingDraft?.setup ?? b.setup?.status ?? 'non_refundable';
  const w = b.tokenPacks?.welcome;
  const ym = currentYm();
  const month = scopeStats(outlet, { k: 'month', ym });
  const all = scopeStats(outlet, { k: 'all' });

  return `<div class="glass-card" style="font-size:13px;margin-bottom:16px">
    ${header}
    <div class="collapsible-body${collapsed ? ' collapsed' : ''}" id="billing-body">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px">
        <div class="detail-cell"><div class="detail-label">Pricing mode</div><div class="detail-value">${mode === 'commission_1pct' ? '1% of sales' : 'Per order'}</div></div>
        <div class="detail-cell"><div class="detail-label">Setup fee</div><div class="detail-value">₹${b.setup?.amount ?? 500} · ${escapeHtml(String(b.setup?.status || '—'))}</div></div>
        <div class="detail-cell"><div class="detail-label">Promo token balance</div><div class="detail-value mono">${bal}</div></div>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Rates: QR ₹${rates.QR ?? 2} · POS ₹${rates.POS ?? 1} · Delivery ₹${rates.webview_delivery ?? 3} · WhatsApp ₹${rates.WA ?? 3} · other ₹${rates.other ?? 2} · promo ₹${rates.promo ?? 1}/token${w ? ` · welcome pack: ${w.qty} free` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px;padding:10px 12px;background:var(--bg-elevated-2,#eef2f7);border:1px solid var(--glass-border,rgba(15,23,42,.10));border-radius:10px">
        <div class="detail-cell"><div class="detail-label">Usage · ${monthLabel(ym)}</div><div class="detail-value">${inr(month.usage)} <span style="font-size:11px;color:var(--text-tertiary)">${month.orders} orders</span></div></div>
        <div class="detail-cell"><div class="detail-label">Received · ${monthLabel(ym)}</div><div class="detail-value">${inr(month.paid)}</div></div>
        <div class="detail-cell"><div class="detail-label">All-time due</div><div class="detail-value" style="font-weight:800;color:${all.due > 0.009 ? 'var(--status-offline,#dc2626)' : 'var(--status-online,#16a34a)'}">${all.due > 0.009 ? inr(all.due) : 'Settled'}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" data-action="navigate" data-href="payments/${escapeHtml(bid)}/${escapeHtml(oid)}">Payment record →</button>
        ${readOnly ? '' : `<button class="btn btn-primary btn-sm" data-action="profile-record-payment" title="${roTitle}">
          <svg data-lucide="indian-rupee" style="width:13px;height:13px"></svg> Record payment
        </button>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-action="billing-toggle-mode" ${ro} title="${mode === 'per_order' ? 'Charge WhatsApp delivery orders at 1% of order value instead of the flat rate' : 'Go back to flat per-order rates'}">
          ${mode === 'per_order' ? 'Switch to 1% of sales' : 'Switch to per-order'}
        </button>
        <select id="billingSetupStatus" class="text-input" style="width:auto" data-billing-draft="setup" ${ro}>
          ${['non_refundable', 'refundable', 'paid', 'adjusted', 'refunded'].map((s) => `<option value="${s}" ${setupStatus === s ? 'selected' : ''}>Setup: ${s}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" data-action="billing-save-setup" ${ro} title="${roTitle}">Save setup</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <input id="billingGrantQty" type="number" min="1" max="10000" class="text-input" style="width:110px" placeholder="Tokens" value="${escapeHtml(billingDraft?.qty ?? '')}" data-billing-draft="qty" ${ro}>
        <input id="billingGrantPrice" type="number" min="0" step="0.01" class="text-input" style="width:130px" placeholder="₹ received (0 = free)" value="${escapeHtml(billingDraft?.priceRs ?? '')}" data-billing-draft="priceRs" ${ro}>
        <button class="btn btn-primary btn-sm" data-action="billing-grant-tokens" ${ro} title="${roTitle}">
          <svg data-lucide="gift" style="width:13px;height:13px"></svg> Grant tokens
        </button>
        <span style="font-size:11.5px;color:var(--text-tertiary)">List value ₹${rates.promo ?? 1} each — charged to campaigns on send.</span>
      </div>
    </div>
  </div>`;
}