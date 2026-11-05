/**
 * Business & Store details templates (view + inline edit)
 */

import { escapeHtml } from '/js/utils.js';

// Read/write the exact same paths the Restaurant Admin app's settings page
// uses (settings/Store, settings/Delivery), so edits from the Owner profile
// land in the live store, not a shadow copy. Business-level fields
// (name/plan/contact) live directly under businesses/{bid}.

export function detailValues(bid, oid, biz, outlet) {
  const store = (outlet.settings && outlet.settings.Store) || {};
  const del = (outlet.settings && outlet.settings.Delivery) || {};
  return {
    businessName: biz.name || store.entityName || '',
    contactPhone: outlet.contactPhone || biz.contactPhone || store.whatsappNumber || '',
    contactEmail: biz.contactEmail || '',
    plan: biz.plan || 'starter',
    outletName: outlet.name || store.storeName || '',
    storeName: store.storeName || '',
    entityName: store.entityName || '',
    address: store.address || '',
    gstin: store.gstin || '',
    fssai: store.fssai || '',
    tagline: store.tagline || '',
    shopOpenTime: store.shopOpenTime || '10:00',
    shopCloseTime: store.shopCloseTime || '23:00',
    instagram: store.instagram || '',
    facebook: store.facebook || '',
    googleReviewLink: store.googleReviewLink || store.reviewUrl || '',
    notifyPhone: del.notifyPhone || store.developerPhone || '',
  };
}

function isUrl(s) { return /^https?:\/\//i.test(s); }

function cell(label, value, { mono = false, span = false } = {}) {
  if (!value) return '';
  const display = isUrl(value)
    ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" title="${escapeHtml(value)}">${escapeHtml(value.length > 52 ? value.slice(0, 49) + '…' : value)}</a>`
    : `<span${mono ? ' class="mono"' : ''}>${escapeHtml(value)}</span>`;
  return `<div class="detail-cell${span ? ' span-2' : ''}"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${display}</div></div>`;
}

function section(title, cellsHtml) {
  return cellsHtml
    ? `<div class="detail-section-title">${escapeHtml(title)}</div><div class="detail-grid">${cellsHtml}</div>`
    : '';
}

export function renderDetailView(bid, oid, biz, outlet) {
  const v = detailValues(bid, oid, biz, outlet);
  const hours = v.shopOpenTime && v.shopCloseTime ? `${v.shopOpenTime} – ${v.shopCloseTime}` : '';
  const plan = v.plan ? v.plan[0].toUpperCase() + v.plan.slice(1) : '';

  const html = [
    section('Business',
      cell('Business name', v.businessName) +
      cell('Contact phone', v.contactPhone, { mono: true }) +
      cell('Contact email', v.contactEmail) +
      cell('Plan / tier', plan)),
    section('Store',
      cell('Outlet name', v.outletName) +
      cell('Store name', v.storeName) +
      cell('Entity name', v.entityName) +
      cell('Address', v.address, { span: true })),
    section('Registration & hours',
      cell('GSTIN', v.gstin, { mono: true }) +
      cell('FSSAI', v.fssai, { mono: true }) +
      cell('Opening hours', hours) +
      cell('Tagline', v.tagline)),
    section('Online presence',
      cell('Instagram', v.instagram) +
      cell('Facebook', v.facebook) +
      cell('Google review link', v.googleReviewLink, { span: true })),
    section('Delivery',
      cell('Delivery notify phone', v.notifyPhone, { mono: true, span: true })),
  ].join('');

  return (html || '<div style="color:var(--text-secondary)">No details stored yet.</div>')
    + '<div style="margin-top:14px;font-size:12px;color:var(--text-secondary)">Store-staff can also edit the full settings (delivery slabs, bot images, QR, dine-in) in the Restaurant Admin app.</div>';
}

function field(state, label, name, placeholder, type = 'text') {
  return `
    <label class="field-label">${escapeHtml(label)}</label>
    <input type="${type}" name="${name}" data-detail="${name}" class="text-input" value="${escapeHtml(state[name] || '')}" placeholder="${escapeHtml(placeholder || '')}" ${type === 'time' ? '' : ''} />`;
}

export function renderDetailForm(state) {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${field(state, 'Business name', 'businessName', 'e.g. My Restaurant')}</div>
      <div>${field(state, 'Outlet name', 'outletName', 'e.g. Boring Road')}</div>
      <div>${field(state, 'Contact phone', 'contactPhone', '+91…')}</div>
      <div>${field(state, 'Contact email', 'contactEmail', 'owner@restaurant.com', 'email')}</div>
      <div>
        <label class="field-label">Plan / tier</label>
        <select name="plan" data-detail="plan" class="text-input">
          ${['starter', 'growth', 'enterprise'].map((p) => `<option value="${p}" ${state.plan === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div>${field(state, 'Store name', 'storeName', 'e.g. My Restaurant')}</div>
      <div>${field(state, 'Entity name', 'entityName', 'e.g. My Restaurant Pvt Ltd')}</div>
      <div>${field(state, 'Address', 'address', 'Shop address')}</div>
      <div>${field(state, 'GSTIN', 'gstin', '15-char GSTIN')}</div>
      <div>${field(state, 'FSSAI', 'fssai', '14-digit FSSAI')}</div>
      <div>${field(state, 'Tagline', 'tagline', 'e.g. Jai Hind')}</div>
      <div>
        <label class="field-label">Opening / closing time</label>
        <div style="display:flex;gap:6px">
          <input type="time" name="shopOpenTime" data-detail="shopOpenTime" class="text-input" value="${escapeHtml(state.shopOpenTime || '')}" />
          <input type="time" name="shopCloseTime" data-detail="shopCloseTime" class="text-input" value="${escapeHtml(state.shopCloseTime || '')}" />
        </div>
      </div>
      <div>${field(state, 'Instagram', 'instagram', '@handle or URL')}</div>
      <div>${field(state, 'Facebook', 'facebook', 'URL')}</div>
      <div>${field(state, 'Google review link', 'googleReviewLink', 'URL')}</div>
      <div>${field(state, 'Delivery notify phone', 'notifyPhone', 'Rider-order notifications')}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary btn-sm" data-action="save-detail">Save changes</button>
      <span style="font-size:12px;color:var(--text-secondary);align-self:center">Saved live to the restaurant's Firebase record.</span>
    </div>`;
}
