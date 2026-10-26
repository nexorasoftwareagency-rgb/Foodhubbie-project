/**
 * WhatsApp template library rendering
 * Message-template library lives at appTemplates/whatsappTemplates/templates
 * (seeded by tools/seed-templates.cjs). Render the list once per profile
 * visit; each row has an Install button that POSTs to the Bot Control API
 * to create the template on the outlet's WABA. Marked ⬅ if it already exists
 * on the WABA (matched by name).
 */

import { escapeHtml } from '/js/utils.js';
import { isReadOnly } from '/js/data-store.js';

export let waTemplatesLoadedFor = null;
export let waTemplatesHtml = null;
export let waLibrary = {};

const TUNNEL_URL = 'https://bot-control-api.foodhubbie.com';

export async function loadWaTemplates(bid, oid) {
  const el = document.getElementById('wa-templates-content');
  if (!el) return;
  if (waTemplatesLoadedFor === `${bid}/${oid}`) {
    // Re-render tick already loaded this outlet's templates — re-inject the
    // cached HTML instead of refetching (a fetch could also 501 without a
    // META_SYSTEM_USER_TOKEN, and flipping between states on every 30s tick
    // is flickery).
    if (waTemplatesHtml) el.innerHTML = waTemplatesHtml;
    return;
  }
  waTemplatesLoadedFor = `${bid}/${oid}`;
  try {
    const snap = await firebase.database().ref('appTemplates/whatsappTemplates/templates').once('value');
    const library = snap.val() || {};
    waLibrary = library;
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/whatsapp/templates/${bid}/${oid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const existing = new Set();
    if (res.status === 501) {
      el.innerHTML = 'Connect the Meta System User Token on the server to manage templates.';
      waTemplatesHtml = el.innerHTML;
      return;
    }
    if (res.ok) {
      const { templates } = await res.json();
      (templates || []).forEach((t) => existing.add(t.name));
    }
    const rows = Object.entries(library).map(([key, tpl]) => {
      const installed = existing.has(tpl.name);
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border,#2a2f3a)">
          <div style="cursor:pointer" data-action="view-wa-template" data-key="${escapeHtml(key)}" title="View template details">
            <div style="color:var(--text-primary)"><span class="mono">${escapeHtml(tpl.name)}</span> <span style="font-size:11px;color:var(--text-secondary)">(${escapeHtml(tpl.category)} · ${escapeHtml(tpl.language)})</span></div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${escapeHtml(tpl.body)}</div>
          </div>
          ${installed
            ? `<span style="font-size:12px;color:var(--success,#22c55e)">Installed</span>`
            : `<button class="btn btn-ghost btn-sm" data-action="install-wa-template" data-key="${escapeHtml(key)}" data-name="${escapeHtml(tpl.name)}" data-category="${escapeHtml(tpl.category)}" data-language="${escapeHtml(tpl.language || 'en')}" data-body="${escapeHtml(tpl.body)}" ${isReadOnly() ? 'disabled' : ''} title="${isReadOnly() ? 'View-only account' : 'Create this template on the outlet\'s WABA'}">Install</button>`}
        </div>`;
    }).join('');
    el.innerHTML = rows || `<div style="color:var(--text-secondary)">No templates in the library yet — seed with tools/seed-templates.cjs.</div>`;
    waTemplatesHtml = el.innerHTML;
  } catch (err) {
    console.error('load message templates failed', err);
    el.innerHTML = `<div style="color:var(--text-secondary)">Could not load the template library.</div>`;
    waTemplatesHtml = el.innerHTML;
  }
}

// Clicking a template name/body opens a detail panel: all stored fields, the
// real message text with a sample-filled WhatsApp preview, explanation, and
// use cases. Pure render — reads the already-fetched library from state.
export function registerWaTemplateView() {
  registerAction('view-wa-template', (btn) => {
    const tpl = waLibrary[btn.dataset.key];
    if (!tpl) return showToast('Template not found.', 'error');
    const sample = (label) => `<span style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:4px">${escapeHtml(label)}</span>`;
    const fill = (body, vars) => (body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
      const label = (vars || {})[`{{${n}}}`] || `value ${n}`;
      return sample(label);
    });
    const vars = tpl.variables || {};
    const varRows = Object.entries(vars).map(([k, label]) => `
      <tr>
        <td class="mono" style="padding:4px 8px;color:var(--text-secondary)">${escapeHtml(k)}</td>
        <td style="padding:4px 8px">${escapeHtml(label)}</td>
      </tr>`).join('');
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal open" id="wa-template-modal">
        <div class="modal-content" style="max-width:480px">
          <div class="confirm-title">Template: <span class="mono">${escapeHtml(tpl.name)}</span></div>
          <div class="confirm-body">
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;margin-bottom:14px">
              <span style="color:var(--text-secondary)">Category</span><span>${escapeHtml(tpl.category)}</span>
              <span style="color:var(--text-secondary)">Language</span><span class="mono">${escapeHtml(tpl.language || 'en')}</span>
            </div>

            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">What it says</div>
            <div style="background:var(--surface,#1b1f27);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:10px;font-size:13px;line-height:1.5;margin-bottom:6px">${escapeHtml(tpl.body)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Preview (with sample values)</div>
            <div style="background:#e5ddd5;border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.5;color:#111;max-width:320px">${fill(tpl.body, vars)}</div>

            ${varRows ? `
              <div style="font-size:12px;color:var(--text-secondary);margin:14px 0 6px">Variables</div>
              <table style="border-collapse:collapse;width:100%;font-size:12px"><tbody>${varRows}</tbody></table>` : ''}

          ${tpl.explanation ? `<div style="font-size:12px;color:var(--text-secondary);margin:14px 0 6px">What it's for</div><div style="font-size:13px;line-height:1.5">${escapeHtml(tpl.explanation)}</div>` : ''}
          ${tpl.useCase ? `<div style="font-size:12px;color:var(--text-secondary);margin:14px 0 6px">When to send it</div><div style="font-size:13px;line-height:1.5">${escapeHtml(tpl.useCase)}</div>` : ''}
        </div>
        <div class="confirm-actions">
          <button class="btn btn-ghost" id="wa-template-close">Close</button>
        </div>
      </div>
      </div>`;
    document.getElementById('wa-template-close').addEventListener('click', () => {
      const modal = document.getElementById('wa-template-modal');
      if (!modal) return;
      modal.classList.remove('open');
      setTimeout(() => { document.getElementById('modal-root').innerHTML = ''; }, 180);
    });
  });
}

