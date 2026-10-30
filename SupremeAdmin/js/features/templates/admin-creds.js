/**
 * Admin credentials templates (view + inline edit)
 *
 * The password is NEVER stored in the database — `adminLogin` inherits
 * businesses/{bid}/.read, which every staff role of the tenant can read.
 * It lives in Firebase Auth only; "Update password" sets it there.
 */

import { escapeHtml } from '/js/utils.js';

const ADMIN_APP_URL = 'https://foodhubbie-admins.web.app';

function copyBtn(text, label) {
  return `<button class="btn btn-ghost btn-sm" data-action="copy-credential" data-copy="${escapeHtml(text)}" title="Copy ${label}" aria-label="Copy ${label}" style="padding:3px 6px;min-width:0"><svg data-lucide="copy" style="width:12px;height:12px"></svg></button>`;
}

export function renderAdminCreds(creds) {
  if (!creds.email) {
    return `<div style="color:var(--text-secondary)">No admin email on record for this outlet. The email is set when the restaurant is created in Supreme Admin → Add Restaurant; for an older outlet it has to be recorded before a password can be set.</div>
      <div style="margin-top:6px"><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`;
  }

  const rows = [];
  rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-secondary)">Username:</span> <span class="mono">${escapeHtml(creds.email)}</span>${copyBtn(creds.email, 'username')}</div>`);
  rows.push(`<div><span style="color:var(--text-secondary)">Password:</span> not stored for security — use <strong>Update password</strong> to set a new one.</div>`);
  rows.push(`<div><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`);
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
