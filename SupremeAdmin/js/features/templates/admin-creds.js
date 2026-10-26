/**
 * Admin credentials templates (view + inline edit)
 */

import { escapeHtml } from '/js/utils.js';

const ADMIN_APP_URL = 'https://foodhubbie-admins.web.app';

function copyBtn(text, label) {
  return `<button class="btn btn-ghost btn-sm" data-action="copy-credential" data-copy="${escapeHtml(text)}" title="Copy ${label}" aria-label="Copy ${label}" style="padding:3px 6px;min-width:0"><svg data-lucide="copy" style="width:12px;height:12px"></svg></button>`;
}

const eyeToggle = `<button class="btn btn-ghost btn-sm" data-action="toggle-password-visibility" title="Show / hide password" aria-label="Show / hide password" style="padding:3px 6px;min-width:0"><svg data-lucide="eye" style="width:12px;height:12px"></svg></button>`;

export function renderAdminCreds(creds) {
  if (!creds.email && !creds.password) {
    return `<div style="color:var(--text-secondary)">No admin login stored yet — this restaurant's staff sign in to the Restaurant Admin panel with email + password. Add it here so it's on record.</div>
      <div style="margin-top:6px"><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`;
  }

  const rows = [];
  if (creds.email) rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-secondary)">Username:</span> <span class="mono">${escapeHtml(creds.email)}</span>${copyBtn(creds.email, 'username')}</div>`);
  if (creds.password) rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-secondary)">Password:</span> <span class="mono admin-pass-masked" data-raw="${escapeHtml(creds.password)}" style="letter-spacing:2px">••••••••</span>${eyeToggle}${copyBtn(creds.password, 'password')}</div>`);
  rows.push(`<div><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`);
  if (!rows.length) return '';
  return `<div style="color:var(--text-primary);line-height:2">${rows.join('')}</div>`;
}

export function renderAdminForm(state) {
  return `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:12px;color:var(--text-secondary)">This updates the real Firebase Auth password for the restaurant's admin account — the same credentials staff use to sign in at the Admin app. Username stays as stored.</div>
      <input type="text" id="admin-email-input" class="text-input" placeholder="Username / email" value="${escapeHtml(state.email || '')}" autocomplete="off" disabled style="opacity:0.6" />
      <input type="password" id="admin-pass-input" class="text-input" placeholder="New password" autocomplete="new-password" value="${escapeHtml(state.pass || '')}" />
      <input type="password" id="admin-pass-confirm-input" class="text-input" placeholder="Confirm new password" autocomplete="new-password" value="${escapeHtml(state.confirm || '')}" />
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" data-action="save-admin-login">Update password</button>
        <span style="font-size:12px;color:var(--text-secondary);align-self:center">Applied to Firebase Auth, not just stored text.</span>
      </div>
      <div style="font-size:12px;color:var(--text-secondary)">Staff sign in at <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>
    </div>`;
}