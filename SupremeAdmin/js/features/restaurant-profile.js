import { registerAction, navigate } from '/js/main.js';
import { subscribe, isReadOnly } from '/js/data-store.js';
import { refreshIcons, escapeHtml, statusPillHtml, statusLabel, formatDate, formatAge, formatUptime, renderOnboardingStepper, formatMemory, transportLabel, renderUptimeSparkline, showToast, showConfirm } from '/js/utils.js';
import { scopeStats, inr, currentYm, monthLabel, recordPaymentModal, printReceipt } from '/js/billing-shared.js';
import { renderBotUsage } from './templates/bot-usage.js';
import { renderBillingCard } from './templates/billing-card.js';
import { detailValues, renderDetailView, renderDetailForm } from './templates/details.js';
import { renderAdminCreds, renderAdminForm } from './templates/admin-creds.js';
import { loadWaTemplates, registerWaTemplateView, waTemplatesLoadedFor, waTemplatesHtml, waLibrary } from './templates/wa-templates.js';
import { loadQuota } from './templates/quota.js';

const mainEl = document.getElementById('app-main');
let currentBid = null;
let currentOid = null;
let lastRaw = null;
let currentOutletCreds = null;
// Inline-editing state for the admin-credentials card. Kept in module
// state (not the DOM) so the 30s re-render tick doesn't wipe a half-typed
// form — the card renders from this when set, plain values otherwise.
let adminEdit = null; // { email, pass }
// Same idea for the Business & store details card — the edit form keeps its
// typed values here so the live re-render tick never resets a half-filled
// form. `detailEdit` holds the draft; null means read-only view.
let detailEdit = null; // { businessName, contactPhone, contactEmail, plan, outletName, storeName, entityName, address, gstin, fssai, tagline, shopOpenTime, shopCloseTime, instagram, facebook, googleReviewLink, notifyPhone }
let quotaFetchedFor = null; // `${bid}/${oid}` — fetch quota once per profile visit
let quotaHtml = null; // cached quota content to survive re-render ticks
let collapsedSections = new Set(); // collapsible section ids the user has closed — survives re-render ticks
let pairModalOpen = false; // live QR modal state
let pairUnsubscribe = null; // stop the QR listener when the modal closes
let currentTab = 'overview'; // 'overview' | 'analytics' — in-page tab rail state
// Draft for the Billing card inputs (token qty/price, setup status) — same
// idea as detailEdit: survives the live re-render ticks so a half-typed
// grant form isn't wiped by an incoming botStatus/usage update.
let billingDraft = null; // { qty, priceRs, setup }

function reRenderProfile() {
  const biz = lastRaw?.[currentBid];
  const outlet = biz?.outlets?.[currentOid];
  if (biz && outlet) renderProfile(currentBid, currentOid, biz, outlet);
}

export function render(bid, oid, tab) {
  currentBid = bid;
  currentOid = oid;
  currentTab = tab === 'analytics' ? 'analytics' : 'overview';
  adminEdit = null;
  detailEdit = null;
  billingDraft = null; // scoped to this navigation — must not leak onto another outlet's card
  quotaFetchedFor = null;
  quotaHtml = null;
  collapsedSections.clear();
  closePairModal();

  mainEl.innerHTML = `
    <button class="btn btn-ghost btn-sm" data-action="navigate" data-href="#restaurants" style="margin-bottom:16px">
      <svg data-lucide="arrow-left"></svg> All restaurants
    </button>
    <div id="profile-content"><div class="skeleton" style="height:280px;border-radius:14px"></div></div>
  `;
  refreshIcons(mainEl);

  // Reuses the app-wide live listener (data-store.js) rather than opening
  // a second one scoped to this outlet — the same snapshot that feeds the
  // restaurant list and fleet grid already contains this outlet's
  // botStatus (incl. history for the sparkline), so this page updates
  // in real time with zero extra reads.
  const unsubscribe = subscribe((raw) => {
    lastRaw = raw;
    const biz = raw[bid];
    const outlet = biz?.outlets?.[oid];
    if (!biz || !outlet) {
      document.getElementById('profile-content').innerHTML = `<div class="glass-card table-empty">This restaurant/outlet could not be found.</div>`;
      return;
    }
    renderProfile(bid, oid, biz, outlet);
    // loadQuota is a one-off REST call (not realtime), so only fetch on
    // the first subscribe tick — subsequent ticks just re-render the
    // profile from cached data without touching the quota element.
    if (!quotaFetchedFor) loadQuota(bid, oid);
  });

  return unsubscribe;
}

function renderProfile(bid, oid, biz, outlet) {
  const wa = outlet.whatsapp || {};
  const connected = wa.status === 'active';
  const bot = outlet.botStatus || { status: 'unknown', uptime: 0, memory: 0, history: [] };
  const fullyOnboarded = connected && bot.status === 'online';
  const readOnly = isReadOnly();
  const transport = outlet.bot?.transport || outlet.transport || 'baileys'; // mirrors bot/transport.js getTransportMode default
  const pair = outlet.bot?.pair || {};
  const pairStatusHtml = pair.status === 'connected'
    ? `<span style="color:var(--status-online,#16a34a)">Connected</span>`
    : pair.status === 'logged_out'
      ? `<span style="color:var(--status-offline,#f87171)">Logged out — scan a new QR</span>`
      : pair.status === 'waiting'
        ? `<span style="color:var(--status-degraded,#d97706)">Waiting for QR…</span>`
        : null;
  const store = (outlet.settings && outlet.settings.Store) || {};
  const outletName = outlet.name || store.storeName || 'Unnamed outlet';
  const bizName = biz.name || store.entityName || biz.businessName || store.storeName || 'Unnamed business';
  const contact = outlet.contactPhone || biz.contactPhone || store.whatsappNumber || '—';
  const creds = outlet.adminLogin || {};
  currentOutletCreds = creds;

  document.getElementById('profile-content').innerHTML = `
    ${outlet.disabled === true ? `
    <div class="glass-card" style="border:1px solid var(--status-offline,#f87171);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <svg data-lucide="pause-circle" style="width:18px;height:18px;color:var(--status-offline,#f87171);flex:none"></svg>
        <div style="flex:1;min-width:200px">
          <strong>Restaurant disabled</strong>
          <div style="color:var(--text-secondary);font-size:12.5px;margin-top:2px">Disabled ${formatDate(outlet.disabledAt)} — ordering, dine-in, staff login, and the WhatsApp bot are all paused. All data is preserved.</div>
        </div>
      </div>
    </div>` : ''}
    <div class="panel-header">
      <div>
        <h1>${escapeHtml(outletName)}</h1>
        <div class="panel-sub">${escapeHtml(bizName)} · ${escapeHtml(contact)} <span class="live-badge"><span class="pulse-dot"></span>Live</span></div>
      </div>
      <div class="panel-header-actions">
        ${currentTab === 'overview'
          ? `<button class="btn btn-ghost btn-sm" data-action="profile-tab" data-tab="analytics">
              <svg data-lucide="bar-chart-3"></svg> View analytics
            </button>`
          : ''}
        ${statusPillHtml(bot.status)}
      </div>
    </div>

    <div class="profile-tabs" role="tablist" aria-label="Profile sections">
      <button class="profile-tab${currentTab === 'overview' ? ' active' : ''}" role="tab" aria-selected="${currentTab === 'overview'}" aria-controls="tabpanel-overview" id="tab-overview" data-action="profile-tab" data-tab="overview">
        <svg data-lucide="layout-grid"></svg> Overview
      </button>
      <button class="profile-tab${currentTab === 'analytics' ? ' active' : ''}" role="tab" aria-selected="${currentTab === 'analytics'}" aria-controls="tabpanel-analytics" id="tab-analytics" data-action="profile-tab" data-tab="analytics">
        <svg data-lucide="bar-chart-3"></svg> Analytics
      </button>
    </div>

    ${currentTab === 'analytics'
      ? `<div id="pa-root" role="tabpanel" aria-labelledby="tab-analytics"><div class="skeleton" style="height:320px;border-radius:14px"></div></div>`
      : `
    ${fullyOnboarded ? '' : renderOnboardingStepper({
      businessCreated: true,
      outletCreated: true,
      whatsappLinked: connected,
      botOnline: bot.status === 'online',
    })}

    <div class="glass-card" style="font-size:13px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="display:block"><svg data-lucide="store" style="width:14px;height:14px;vertical-align:-2px"></svg> Business &amp; store details</strong>
        ${readOnly ? '' : `<button class="btn btn-ghost btn-sm" data-action="${detailEdit ? 'cancel-detail-edit' : 'edit-detail'}">${detailEdit ? 'Cancel' : 'Edit'}</button>`}
      </div>
      ${detailEdit ? renderDetailForm(detailEdit) : renderDetailView(bid, oid, biz, outlet)}
    </div>

    <div class="glass-card" style="font-size:13px;margin-bottom:16px">
      <strong style="display:block;margin-bottom:10px">Platform IDs</strong>
      <div style="color:var(--text-secondary);line-height:2">
        <div>Business ID: <span class="mono">${escapeHtml(bid)}</span></div>
        <div>Outlet ID: <span class="mono">${escapeHtml(oid)}</span></div>
        <div>Created: ${formatDate(biz.createdAt || outlet.createdAt)}</div>
      </div>
    </div>

    ${renderBillingCard(outlet, readOnly, bid, oid, biz, collapsedSections, billingDraft)}

    <div class="glass-card" style="font-size:13px;margin-bottom:16px;border:1px solid ${outlet.disabled === true ? 'var(--status-online,#16a34a)' : 'var(--glass-border,#2a2f3a)'}">
      <strong style="display:block;margin-bottom:6px;color:${outlet.disabled === true ? 'var(--status-online,#16a34a)' : 'var(--status-offline,#f87171)'}">
        <svg data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></svg> ${outlet.disabled === true ? 'Restaurant status' : 'Danger Zone'}
      </strong>
      ${outlet.disabled === true
        ? `<div style="color:var(--text-secondary);margin-bottom:12px">This restaurant is currently disabled. Reactivating restores QR ordering, dine-in, staff login, and the WhatsApp bot immediately.</div>
           <button class="btn btn-primary" data-action="reactivate-outlet" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : ''}">
             <svg data-lucide="play"></svg> Reactivate restaurant
           </button>`
        : `<div style="color:var(--text-secondary);margin-bottom:12px">Disabling pauses everything for this outlet — QR/menu ordering, dine-in sessions, staff login, and the WhatsApp bot. No data is deleted and it can be reactivated anytime.</div>
           <button class="btn btn-danger" data-action="disable-outlet" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : ''}">
              <svg data-lucide="pause-circle"></svg> Disable restaurant
            </button>`}
      ${outlet.locked === true
        ? `<div style="color:var(--status-degraded,#d97706);margin-bottom:12px">This restaurant is locked — the admin can log in but cannot use any features until unlocked.</div>
           <button class="btn btn-primary" data-action="unlock-outlet" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : ''}">
              <svg data-lucide="lock-open"></svg> Unlock access
            </button>` : ''}
    </div>

    <div class="glass-card accent-edge" style="margin-bottom:16px">
      <div class="collapsible-header${collapsedSections.has('admin-login-body') ? ' collapsed' : ''}" data-action="toggle-section" data-target="admin-login-body" role="button" tabindex="0" aria-expanded="${!collapsedSections.has('admin-login-body')}" aria-controls="admin-login-body" style="margin-bottom:10px">
        <strong style="display:block"><svg data-lucide="key-round" style="width:14px;height:14px;vertical-align:-2px"></svg> Admin login</strong>
        <div style="display:flex;align-items:center;gap:6px">
          ${readOnly ? '' : `<button class="btn btn-ghost btn-sm" data-action="${adminEdit ? 'cancel-admin-edit' : 'edit-admin-login'}">${adminEdit ? 'Cancel' : 'Update password'}</button>`}
          <svg data-lucide="chevron-down" class="chevron-icon" style="width:14px;height:14px;color:var(--text-tertiary)"></svg>
        </div>
      </div>
      <div class="collapsible-body${collapsedSections.has('admin-login-body') ? ' collapsed' : ''}" id="admin-login-body">
        ${adminEdit ? renderAdminForm(adminEdit) : renderAdminCreds(creds)}
      </div>
    </div>

    <!-- WhatsApp Agent Management scope: locally overrides --accent to
         WhatsApp green so this section reads as belonging to that
         dashboard, even though the rest of the profile stays orange. -->
    <div class="theme-agent">
      <div class="collapsible-header section-eyebrow${collapsedSections.has('whatsapp-body') ? ' collapsed' : ''}" data-action="toggle-section" data-target="whatsapp-body" role="button" tabindex="0" aria-expanded="${!collapsedSections.has('whatsapp-body')}" aria-controls="whatsapp-body" style="margin-bottom:0">
        <div><svg data-lucide="message-circle"></svg> WhatsApp — Official API &amp; Bot Channel</div>
        <svg data-lucide="chevron-down" class="chevron-icon" style="width:14px;height:14px;color:var(--accent)"></svg>
      </div>
      <div class="collapsible-body${collapsedSections.has('whatsapp-body') ? ' collapsed' : ''}" id="whatsapp-body">

      <div class="table-kpi-grid">
        <div class="glass-card kpi-tile ${bot.status === 'online' ? 'accent-online' : bot.status === 'offline' || bot.status === 'errored' ? 'accent-offline' : ''}">
          <div class="kpi-label"><svg data-lucide="activity" style="width:13px;height:13px"></svg> Agent status</div>
          <div class="kpi-value">${statusLabel(bot.status)}</div>
        </div>
        <div class="glass-card kpi-tile">
          <div class="kpi-label"><svg data-lucide="clock" style="width:13px;height:13px"></svg> Uptime</div>
          <div class="kpi-value mono">${formatUptime(bot.uptime)}</div>
        </div>
        <div class="glass-card kpi-tile">
          <div class="kpi-label"><svg data-lucide="cpu" style="width:13px;height:13px"></svg> Memory</div>
          <div class="kpi-value mono">${formatMemory(bot.memory)}</div>
        </div>
        <div class="glass-card kpi-tile">
          <div class="kpi-label"><svg data-lucide="message-circle" style="width:13px;height:13px"></svg> Official WhatsApp</div>
          <div class="kpi-value" style="font-size:16px">${connected ? escapeHtml(wa.displayPhoneNumber || 'Connected') : 'Not connected'}</div>
          ${connected && wa.verifiedName ? `<div class="kpi-label" style="margin-top:2px">${escapeHtml(wa.verifiedName)}</div>` : ''}
        </div>
        <div class="glass-card kpi-tile">
          <div class="kpi-label"><svg data-lucide="smartphone" style="width:13px;height:13px"></svg> Bot channel</div>
          <div class="kpi-value" style="font-size:16px">${transportLabel(transport)}</div>
        </div>
      </div>

      <div class="glass-card accent-edge" style="margin-bottom:16px">
        <div class="sparkline-label">Status over last 24h</div>
        ${renderUptimeSparkline(bot.history)}
      </div>

      <div class="glass-card accent-edge" id="quota-card" style="margin-bottom:16px">
        <strong style="display:block;margin-bottom:8px">WhatsApp messaging quota</strong>
        <div id="quota-content" style="color:var(--text-secondary);font-size:13px">${quotaHtml || (connected ? 'Checking quota…' : 'Connect the Official WhatsApp API to see messaging quota.')}</div>
      </div>

      <div id="whatsapp-manage"></div>

      <div class="glass-card accent-edge" style="margin-bottom:16px">
        <div class="collapsible-header${collapsedSections.has('wa-usage-body') ? ' collapsed' : ''}" data-action="toggle-section" data-target="wa-usage-body" role="button" tabindex="0" aria-expanded="${!collapsedSections.has('wa-usage-body')}" aria-controls="wa-usage-body" style="margin-bottom:0">
          <strong style="display:block"><svg data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></svg> WhatsApp Bot Usage</strong>
          <svg data-lucide="chevron-down" class="chevron-icon" style="width:14px;height:14px;color:var(--accent)"></svg>
        </div>
        <div class="collapsible-body${collapsedSections.has('wa-usage-body') ? ' collapsed' : ''}" id="wa-usage-body">
          <div id="wa-usage-content" style="color:var(--text-secondary);font-size:13px">${renderBotUsage(outlet.bot?.usage, transport)}</div>
        </div>
      </div>

      ${connected ? `
      <div class="glass-card accent-edge" id="wa-templates-card" style="margin-bottom:16px">
        <strong style="display:block;margin-bottom:8px">Message templates</strong>
        <div id="wa-templates-content" style="color:var(--text-secondary);font-size:13px">${waTemplatesHtml || 'Loading template library…'}</div>
      </div>` : ''}

      <div class="glass-card accent-edge">
        <strong style="display:block;margin-bottom:14px">Manage agent</strong>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${bot.status === 'unknown'
            ? `<button class="btn btn-primary" data-action="provision-bot" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : 'Create the bot worker on EC2 and connect WhatsApp Web'}">
                <svg data-lucide="play"></svg> Start bot worker
              </button>`
            : `<button class="btn btn-ghost" data-action="restart-bot" ${readOnly || bot.status === 'unknown' ? 'disabled' : ''} title="${readOnly ? 'View-only account' : ''}">
                <svg data-lucide="rotate-cw"></svg> Restart
              </button>`}
          <button class="btn btn-danger" data-action="stop-bot" ${readOnly || (bot.status !== 'online' && bot.status !== 'degraded') ? 'disabled' : ''} title="${readOnly ? 'View-only account' : ''}">
            <svg data-lucide="x-octagon"></svg> Stop
          </button>
          ${bot.status !== 'unknown'
            ? `<button class="btn btn-ghost" data-action="decommission-bot" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : 'Remove the bot worker from EC2 and delete its session'}">
                <svg data-lucide="trash-2"></svg> Decommission
              </button>`
            : ''}
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">
          ${bot.status === 'unknown'
            ? 'No bot worker running for this outlet. Start it to create the EC2 worker, then scan the WhatsApp Web QR.'
            : `<span class="mono">bot-${escapeHtml(bid)}-${escapeHtml(oid)}</span>${outlet.bot?.healthPort ? ` · health :${outlet.bot.healthPort}` : ''}`}
        </div>
        <div style="margin-top:16px;font-size:12px;color:var(--text-secondary)">Bot channel</div>
        <div class="transport-toggle">
          <button class="transport-option ${transport === 'meta' ? 'active' : ''}" data-action="switch-transport" data-transport="meta" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : 'Switch to the Official WhatsApp API'}">
            <span class="dot"></span> Official API
          </button>
          <button class="transport-option ${transport === 'baileys' ? 'active' : ''}" data-action="switch-transport" data-transport="baileys" ${readOnly ? 'disabled' : ''} title="${readOnly ? 'View-only account' : 'Switch to WhatsApp Web (QR pairing)'}">
            <span class="dot"></span> WhatsApp Web (QR)
          </button>
        </div>
        <div class="transport-current-label">
          Currently using: <span class="mono">${transportLabel(transport)}</span>
          ${transport === 'baileys' && bot.status !== 'unknown'
            ? `<button class="btn btn-ghost btn-sm" data-action="${pair.status === 'connected' ? 'rescan-baileys' : 'scan-baileys'}" ${readOnly ? 'disabled' : ''} style="margin-left:8px" title="${readOnly ? 'View-only account' : pair.status === 'connected' ? 'Discard the saved session and scan a fresh QR' : 'Show the QR to pair this restaurant\'s WhatsApp'}">
                <svg data-lucide="qr-code"></svg> ${pair.status === 'connected' ? 'Re-scan QR' : 'Scan QR'}
              </button>`
            : ''}
        </div>
        <div style="margin-top:12px;font-size:12.5px;color:var(--text-secondary);line-height:1.9">
          <div>Official API phone number ID: <span class="mono">${escapeHtml(wa.phoneNumberId || '— not linked')}</span></div>
          ${connected && wa.displayPhoneNumber ? `<div>Connected WhatsApp number: <span class="mono">${escapeHtml(wa.displayPhoneNumber)}</span></div>` : ''}
          ${transport === 'baileys' && pairStatusHtml ? `<div>Pairing: ${pairStatusHtml}</div>` : ''}
        </div>
      </div>
    </div>
    </div><!-- /collapsible-body whatsapp -->
    `}
  `;
  refreshIcons(document.getElementById('profile-content'));

  // Keep the Billing card inputs' values in module state across live
  // re-renders (render restores them via value= below).
  document.querySelectorAll('[data-billing-draft]').forEach((el) => {
    el.addEventListener('input', () => {
      billingDraft = { ...(billingDraft || {}), [el.dataset.billingDraft]: el.value };
    });
  });

  // Mount the WhatsApp number wizard (plan G4) after the DOM for the section
  // exists. State lives in the module so the 30s re-render keeps any active
  // wizard step; we just hand it the latest connected state.
  if (currentTab === 'analytics') {
    import('/js/features/profile-analytics.js').then((m) => m.mount(bid, oid))
      .catch((err) => console.error('profile-analytics mount failed', err));
    return;
  }

  import('/js/features/whatsapp-manage.js').then((m) => {
    m.registerActions();
    m.mount(bid, oid, outlet.whatsapp);
  }).catch((err) => console.error('whatsapp-manage mount failed', err));

  if (connected) loadWaTemplates(bid, oid);
}

// Message-template library lives at appTemplates/whatsappTemplates/templates

registerAction('install-wa-template', async (btn) => {
  const { key, name, category, language } = btn.dataset;
  const ok = await showConfirm({
    title: `Install "${name}"?`,
    body: 'Creates this template on the outlet\'s WhatsApp Business Account. It enters PENDING review before it can be sent to customers.',
    confirmLabel: 'Install template',
  });
  if (!ok) return;
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/whatsapp/templates/${currentBid}/${currentOid}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, language, body: btn.dataset.body || '', variables: (waLibrary[key] || {}).variables || {} }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || String(res.status));
    showToast(`Template "${name}" created — pending Meta review.`, 'success');
    document.getElementById('wa-templates-card')?.remove();
  } catch (err) {
    showToast(`Could not install template: ${err.message}`, 'error');
  }
});

const ADMIN_APP_URL = 'https://foodhubbie-admins.web.app';



// Quota is not part of the realtime `businesses` tree (Meta doesn't push
// it to us), so it's a one-off REST call to the Bot Control API rather
// than something the live listener covers. Safe to fail quietly — this
// is a nice-to-have panel, not core status.

async function callBotControlApi(action, bid, oid) {
  const res = await callBotControlApiRaw(action, bid, oid);
  if (!res) return;
  if (res.ok) {
    showToast(`Bot ${action} succeeded.`, 'success');
    // no manual refetch needed — the live listener will reflect the
    // new status as soon as the watcher writes it
  } else if (res.status === 403) {
    showToast("Your account doesn't have permission to do that.", 'error');
  } else {
    // Surface the real server error (e.g. "process not found" when the
    // PM2 process name doesn't match) instead of a dead generic message.
    let detail = '';
    try { const body = await res.json(); detail = body.error || ''; } catch (_) {}
    showToast(`Action failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
}

// Low-level variant: returns the raw Response so callers can branch on it
// (the pair flow opens a live QR modal on success instead of a toast).
async function callBotControlApiRaw(action, bid, oid, body) {
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    return await fetch(`${TUNNEL_URL}/api/bot/${action}/${bid}/${oid}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    console.error(`callBotControlApi(${action}) failed`, err);
    showToast('Action failed — check your connection to the Bot Control API.', 'error');
    return null;
  }
}

// Keep the inline-edited password fields in module state as the user
// types, so the 30s re-render tick doesn't wipe a half-typed form.
document.addEventListener('input', (e) => {
  if (e.target.id === 'admin-pass-input') adminEdit.pass = e.target.value;
  if (e.target.id === 'admin-pass-confirm-input') adminEdit.confirm = e.target.value;
  const key = e.target.dataset?.detail;
  if (key && detailEdit) detailEdit[key] = e.target.value;
});

registerAction('edit-admin-login', () => {
  const creds = currentOutletCreds || {};
  adminEdit = { email: creds.email || '', pass: '', confirm: '' };
  reRenderProfile();
});

registerAction('cancel-admin-edit', () => {
  adminEdit = null;
  reRenderProfile();
});

registerAction('save-admin-login', async () => {
  const email = document.getElementById('admin-email-input')?.value.trim() || '';
  const pass = document.getElementById('admin-pass-input')?.value || '';
  const confirm = document.getElementById('admin-pass-confirm-input')?.value || '';
  if (!email) return showToast('No admin email stored for this outlet.', 'error');
  if (!pass) return showToast('Enter a new password.', 'error');
  if (pass.length < 6) return showToast('Password must be at least 6 characters.', 'error');
  if (pass !== confirm) return showToast('Passwords do not match.', 'error');
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/admin/update-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bid: currentBid, oid: currentOid, email, newPassword: pass }),
    });
    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = body.error || ''; } catch (_) {}
      return showToast(`Password update failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
    }
    adminEdit = null;
    showToast('Password updated on Firebase Auth.', 'success');
    reRenderProfile();
  } catch (err) {
    console.error('update admin password failed', err);
    showToast('Could not update password — check your connection to the Bot Control API.', 'error');
  }
});

registerAction('copy-credential', async (btn) => {
  const text = btn.dataset.copy;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard.', 'success');
  } catch (_) {
    showToast('Could not copy — select and copy manually.', 'error');
  }
});

registerAction('toggle-password-visibility', (btn) => {
  const card = btn.closest('.glass-card') || btn.closest('[id]') || document;
  const span = card.querySelector('.admin-pass-masked');
  if (!span) return;
  const raw = span.dataset.raw;
  if (!raw) return;
  const isHidden = span.textContent === '••••••••';
  span.textContent = isHidden ? raw : '••••••••';
  span.style.letterSpacing = isHidden ? 'normal' : '2px';
  // swap eye icon
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('data-lucide', isHidden ? 'eye-off' : 'eye');
  refreshIcons(btn);
});

registerAction('toggle-section', (btn) => {
  const targetId = btn.dataset.target;
  if (!targetId) return;
  const body = document.getElementById(targetId);
  if (!body) return;
  const closing = !body.classList.contains('collapsed');
  if (closing) collapsedSections.add(targetId);
  else collapsedSections.delete(targetId);
  body.classList.toggle('collapsed');
  btn.classList.toggle('collapsed');
});

registerAction('profile-tab', (btn) => {
  const tab = btn.dataset.tab;
  if (tab === currentTab) return;
  currentTab = tab;
  // replaceState keeps the URL honest for deep-linking/refresh without
  // tearing down the live listener or wizard state.
  history.replaceState(null, '', `#profile/${encodeURIComponent(currentBid)}/${encodeURIComponent(currentOid)}/${tab}`);
  reRenderProfile();
});

registerAction('edit-detail', () => {
  const biz = lastRaw?.[currentBid];
  const outlet = biz?.outlets?.[currentOid];
  if (!biz || !outlet) return;
  detailEdit = detailValues(currentBid, currentOid, biz, outlet);
  reRenderProfile();
});

registerAction('cancel-detail-edit', () => {
  detailEdit = null;
  reRenderProfile();
});

registerAction('save-detail', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  if (!detailEdit) return;
  const d = detailEdit;
  const clean = (s) => (typeof s === 'string' ? s.trim() : '');
  if (!clean(d.businessName) || !clean(d.outletName) || !clean(d.contactPhone)) {
    return showToast('Business name, outlet name, and contact phone are required.', 'error');
  }
  if (clean(d.gstin) && !/^[0-9A-Z]{15}$/.test(clean(d.gstin))) {
    return showToast('GSTIN must be exactly 15 characters.', 'error');
  }
  if (clean(d.fssai) && !/^\d{14}$/.test(clean(d.fssai))) {
    return showToast('FSSAI must be exactly 14 digits.', 'error');
  }
  try {
    const bid = currentBid, oid = currentOid;
    const store = d.storeName || d.entityName || d.address || d.gstin || d.fssai || d.tagline || d.shopOpenTime || d.shopCloseTime || d.instagram || d.facebook || d.googleReviewLink
      ? {
          [`businesses/${bid}/outlets/${oid}/settings/Store/storeName`]: clean(d.storeName),
          [`businesses/${bid}/outlets/${oid}/settings/Store/entityName`]: clean(d.entityName),
          [`businesses/${bid}/outlets/${oid}/settings/Store/address`]: clean(d.address),
          [`businesses/${bid}/outlets/${oid}/settings/Store/gstin`]: clean(d.gstin),
          [`businesses/${bid}/outlets/${oid}/settings/Store/fssai`]: clean(d.fssai),
          [`businesses/${bid}/outlets/${oid}/settings/Store/tagline`]: clean(d.tagline),
          [`businesses/${bid}/outlets/${oid}/settings/Store/shopOpenTime`]: d.shopOpenTime || '10:00',
          [`businesses/${bid}/outlets/${oid}/settings/Store/shopCloseTime`]: d.shopCloseTime || '23:00',
          [`businesses/${bid}/outlets/${oid}/settings/Store/instagram`]: clean(d.instagram),
          [`businesses/${bid}/outlets/${oid}/settings/Store/facebook`]: clean(d.facebook),
          [`businesses/${bid}/outlets/${oid}/settings/Store/googleReviewLink`]: clean(d.googleReviewLink),
        }
      : {};
    const updates = {
      [`businesses/${bid}/name`]: clean(d.businessName),
      [`businesses/${bid}/contactPhone`]: clean(d.contactPhone),
      [`businesses/${bid}/contactEmail`]: clean(d.contactEmail) || null,
      [`businesses/${bid}/plan`]: d.plan || 'starter',
      [`businesses/${bid}/outlets/${oid}/name`]: clean(d.outletName),
      [`businesses/${bid}/outlets/${oid}/contactPhone`]: clean(d.contactPhone),
      [`businesses/${bid}/outlets/${oid}/settings/Delivery/notifyPhone`]: clean(d.notifyPhone),
      [`outletIndex/${oid}/name`]: clean(d.outletName),
      ...store,
    };
    await firebase.database().ref().update(updates);
    detailEdit = null;
    showToast('Details saved.', 'success');
  } catch (err) {
    console.error('save details failed', err);
    showToast('Could not save details — check the console.', 'error');
  }
});

registerAction('restart-bot', () => callBotControlApi('restart', currentBid, currentOid));

// Create the PM2 bot worker on EC2 for this outlet (idempotent), then open
// the live QR modal — the bot's first boot has no saved Baileys session, so
// it will emit a fresh QR to scan right away.
registerAction('provision-bot', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const ok = await showConfirm({
    title: 'Start bot worker on EC2?',
    body: 'Creates the bot process for this restaurant on the server (no SSH needed), then shows a WhatsApp Web QR to scan. The restaurant can start taking orders once scanned.',
    confirmLabel: 'Start bot worker',
  });
  if (!ok) return;
  const res = await callBotControlApiRaw('provision', currentBid, currentOid);
  if (!res) return;
  if (!res.ok) {
    let detail = '';
    try { const r = await res.json(); detail = r.error || ''; } catch (_) {}
    return showToast(`Start failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
  showToast('Bot worker created on EC2 — scanning for a QR…', 'success');
  pairModalOpen = true;
  openPairModal(currentBid, currentOid);
});

// Decommission: stop + delete the PM2 worker and remove its Baileys session.
registerAction('decommission-bot', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const ok = await showConfirm({
    title: 'Decommission this bot?',
    body: 'Stops and removes the bot worker from EC2 and deletes its saved WhatsApp session. The restaurant will stop receiving WhatsApp orders. Firebase data (menu, orders) is kept.',
    confirmLabel: 'Decommission bot',
    danger: true,
  });
  if (!ok) return;
  const res = await callBotControlApiRaw('delete', currentBid, currentOid);
  if (!res) return;
  if (!res.ok) {
    let detail = '';
    try { const r = await res.json(); detail = r.error || ''; } catch (_) {}
    return showToast(`Decommission failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
  showToast('Bot worker decommissioned.', 'success');
});

function closePairModal() {
  pairModalOpen = false;
  pairUnsubscribe?.();
  pairUnsubscribe = null;
  const modal = document.getElementById('pair-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => { document.getElementById('modal-root').innerHTML = ''; }, 180);
  }
}

// Live QR modal. The outlet's `bot.pair` node is written by the bot itself
// (qr/status/connectedAt), and the app-wide listener already streams it — so
// the modal just renders whatever the listener delivers, no polling.
function openPairModal(bid, oid) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal open" id="pair-modal">
      <div class="modal-content">
        <div class="confirm-title">Pair WhatsApp (QR)</div>
        <div class="confirm-body" id="pair-status" style="margin-bottom:14px">Contacting bot…</div>
        <div id="pair-qr" style="display:flex;justify-content:center;background:#fff;padding:12px;border-radius:12px;margin-bottom:14px">
          <span style="color:#888">waiting for QR…</span>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-ghost" id="pair-cancel">Close</button>
        </div>
      </div>
    </div>`;
  document.getElementById('pair-cancel').addEventListener('click', closePairModal);

  const update = (raw) => {
    const pair = raw?.[bid]?.outlets?.[oid]?.bot?.pair;
    const qrEl = document.getElementById('pair-qr');
    const statusEl = document.getElementById('pair-status');
    if (!qrEl || !statusEl) return; // modal closed / navigated away
    if (pair?.status === 'connected') {
      statusEl.innerHTML = `Connected! Bot is online via WhatsApp Web.`;
      qrEl.innerHTML = '';
      setTimeout(closePairModal, 1500);
      return;
    }
    if (pair?.qr) {
      statusEl.innerHTML = 'Open WhatsApp on the restaurant\'s phone → <b>Linked devices</b> → <b>Link a device</b> and scan. The QR refreshes every ~30s until you scan it.';
      qrEl.innerHTML = '';
      try {
        // qrcodejs renders a <canvas>; white bg keeps the pattern crisp.
        new QRCode(qrEl, { text: pair.qr, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
      } catch (err) {
        qrEl.textContent = 'Could not render QR.';
        console.error('QR render failed', err);
      }
    } else if (pair?.status === 'waiting') {
      statusEl.innerHTML = 'Bot is starting up — scanning for a QR…';
    } else {
      statusEl.innerHTML = 'No QR yet — bot may still be restarting. This usually takes a few seconds.';
    }
  };
  update(lastRaw);
  pairUnsubscribe = subscribe(update);
}

registerAction('stop-bot', async () => {
  const ok = await showConfirm({
    title: 'Stop this bot?',
    body: 'This restaurant will stop receiving WhatsApp orders immediately. This has real customer-facing consequences.',
    confirmLabel: 'Stop bot',
    danger: true,
  });
  if (ok) callBotControlApi('stop', currentBid, currentOid);
});

// ---- Disable / Reactivate (soft-delete) -----------------------------------
// 3-step typed-confirm modal: Warning → type outlet name + acknowledge →
// red confirm. Follows the showBulkDeleteConfirm typed-confirm pattern.
function openDisableModal(bid, oid, outletName) {
  const root = document.getElementById('modal-root');
  let step = 1;
  let typed = '';
  let acknowledged = false;
  const expected = (outletName || '').trim().toLowerCase();

  const render = () => {
    const canConfirm = step === 3 && typed === expected && acknowledged;
    root.innerHTML = `
      <div class="modal open" id="disable-modal">
        <div class="modal-content" style="max-width:460px">
          <div class="confirm-title"><svg data-lucide="alert-triangle" style="width:16px;height:16px;vertical-align:-3px"></svg> Disable "${escapeHtml(outletName)}"</div>
          <div class="confirm-body">
            <div style="display:flex;gap:6px;margin-bottom:14px">
              ${[1,2,3].map(n => `<span style="flex:1;height:4px;border-radius:2px;background:${step >= n ? 'var(--status-offline,#f87171)' : 'var(--glass-border,#2a2f3a)'}"></span>`).join('')}
            </div>
            ${step === 1 ? `
              <div style="font-size:13.5px;line-height:1.7;color:var(--text-primary)">
                <p style="margin:0 0 10px">Disabling this restaurant will <b>immediately pause</b>:</p>
                <ul style="margin:0 0 12px;padding-left:18px;line-height:1.9">
                  <li>QR / webview menu ordering</li>
                  <li>Dine-in table sessions &amp; requests</li>
                  <li>Staff login to the Admin dashboard</li>
                  <li>The WhatsApp ordering bot</li>
                </ul>
                <p style="margin:0 0 4px;color:var(--text-secondary)"><b style="color:var(--status-online,#16a34a)">No data is deleted.</b> Menu, orders, and settings are all preserved. This can be undone anytime by reactivating.</p>
              </div>
              <div class="confirm-actions" style="margin-top:16px">
                <button class="btn btn-ghost" id="disable-step-back">Cancel</button>
                <button class="btn btn-danger" id="disable-step-next">Continue</button>
              </div>` : step === 2 ? `
              <div style="font-size:13.5px;line-height:1.7">
                <p style="margin:0 0 12px">To confirm, type the outlet name <b>${escapeHtml(outletName)}</b> below, and acknowledge that no data will be deleted.</p>
                <input type="text" id="disable-typed" class="text-input" placeholder="Type the outlet name" value="${escapeHtml(typed)}" style="width:100%;margin-bottom:10px" autocomplete="off" />
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                  <input type="checkbox" id="disable-ack" ${acknowledged ? 'checked' : ''} />
                  I understand no data is deleted and this can be undone.
                </label>
              </div>
              <div class="confirm-actions" style="margin-top:16px">
                <button class="btn btn-ghost" id="disable-step-back">Back</button>
                <button class="btn btn-danger" id="disable-step-next" disabled>Continue</button>
              </div>` : `
              <div style="font-size:13.5px;line-height:1.7">
                <p style="margin:0 0 8px"><b>Final step.</b> Pressing the red button disables this restaurant immediately:</p>
                <ul style="margin:0 0 12px;padding-left:18px;line-height:1.9;color:var(--text-secondary)">
                  <li>Orders / dine-in / login / bot stop</li>
                  <li>Data stays intact — reactivatable anytime</li>
                </ul>
              </div>
              <div class="confirm-actions" style="margin-top:16px">
                <button class="btn btn-ghost" id="disable-step-back">Back</button>
                <button class="btn btn-danger" id="disable-step-confirm" ${canConfirm ? '' : 'disabled'}>Disable restaurant</button>
              </div>`}
          </div>
        </div>
      </div>`;
    refreshIcons(root);
    root.querySelector('#disable-step-back').addEventListener('click', () => {
      if (step === 1) closeDisableModal();
      else { step--; render(); }
    });
    const next = root.querySelector('#disable-step-next');
    if (next) next.addEventListener('click', () => { step++; render(); });
    const typedEl = root.querySelector('#disable-typed');
    if (typedEl) typedEl.addEventListener('input', (e) => {
      typed = e.target.value.trim().toLowerCase();
      const nxt = root.querySelector('#disable-step-next');
      if (nxt) nxt.disabled = typed !== expected || !acknowledged;
    });
    const ackEl = root.querySelector('#disable-ack');
    if (ackEl) ackEl.addEventListener('change', (e) => {
      acknowledged = e.target.checked;
      const nxt = root.querySelector('#disable-step-next');
      if (nxt) nxt.disabled = typed !== expected || !acknowledged;
    });
    const confirmBtn = root.querySelector('#disable-step-confirm');
    if (confirmBtn) confirmBtn.addEventListener('click', () => doDisableOutlet(bid, oid));
  };
  render();
}

function closeDisableModal() {
  const modal = document.getElementById('disable-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => { document.getElementById('modal-root').innerHTML = ''; }, 180);
  }
}

async function doDisableOutlet(bid, oid) {
  try {
    const user = firebase.auth().currentUser;
    await firebase.database().ref().update({
      [`businesses/${bid}/outlets/${oid}/disabled`]: true,
      [`businesses/${bid}/outlets/${oid}/disabledAt`]: firebase.database.ServerValue.TIMESTAMP,
      [`businesses/${bid}/outlets/${oid}/disabledBy`]: user?.uid || 'unknown',
      [`businesses/${bid}/outlets/${oid}/suspended`]: true, // orchestrator stops the worker
      [`outletIndex/${oid}/disabled`]: true,
    });
    closeDisableModal();
    // Best-effort worker stop — the flag takes effect even if this fails.
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${TUNNEL_URL}/api/bot/stop/${bid}/${oid}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) showToast("Your account doesn't have permission to stop the bot.", 'error');
      else if (!res.ok && res.status !== 404) showToast('Restaurant disabled — bot stop returned ' + res.status + ', retry stop later.', 'warning');
    } catch (e) {
      console.warn('bot stop after disable failed', e);
      showToast('Restaurant disabled — bot stop failed, retry stop later.', 'warning');
    }
    showToast('Restaurant disabled. All services paused — data intact.', 'success');
  } catch (err) {
    console.error('disable outlet failed', err);
    showToast('Disable failed — check the console.', 'error');
  }
}

registerAction('disable-outlet', () => {
  const outlet = lastRaw?.[currentBid]?.outlets?.[currentOid];
  if (!outlet) return;
  openDisableModal(currentBid, currentOid, outlet.name || outlet.settings?.Store?.storeName || 'this outlet');
});

registerAction('reactivate-outlet', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const outlet = lastRaw?.[currentBid]?.outlets?.[currentOid];
  const name = outlet?.name || outlet?.settings?.Store?.storeName || 'this outlet';
  const ok = await showConfirm({
    title: `Reactivate "${name}"?`,
    body: 'Restores QR ordering, dine-in, staff login, and the WhatsApp bot for this outlet. All data is intact.',
    confirmLabel: 'Reactivate',
  });
  if (!ok) return;
  try {
    const user = firebase.auth().currentUser;
    // outletIndex only accepts bid/name/disabled/createdAt ($other is false),
    // and the node may not exist yet for older outlets — write the children so
    // the index entry is complete instead of a half node.
    const idxName = (name || '').slice(0, 80);
    const updates = {
      [`businesses/${currentBid}/outlets/${currentOid}/disabled`]: false,
      [`businesses/${currentBid}/outlets/${currentOid}/reactivatedAt`]: firebase.database.ServerValue.TIMESTAMP,
      [`businesses/${currentBid}/outlets/${currentOid}/reactivatedBy`]: user?.uid || 'unknown',
      [`businesses/${currentBid}/outlets/${currentOid}/suspended`]: false, // allow the orchestrator to run the worker again
      [`outletIndex/${currentOid}/bid`]: currentBid,
      [`outletIndex/${currentOid}/disabled`]: false,
    };
    if (idxName) updates[`outletIndex/${currentOid}/name`] = idxName;
    await firebase.database().ref().update(updates);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${TUNNEL_URL}/api/bot/restart/${currentBid}/${currentOid}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) showToast("Your account doesn't have permission to restart the bot.", 'error');
      else if (!res.ok && res.status !== 404) showToast('Bot restart returned ' + res.status + ' — retry from the agent card.', 'warning');
    } catch (e) {
      console.warn('bot restart after reactivate failed', e);
      showToast('Restaurant reactivated — bot restart failed, retry from the agent card.', 'warning');
    }
    showToast('Restaurant reactivated.', 'success');
  } catch (err) {
    console.error('reactivate outlet failed', err);
    showToast('Reactivate failed — check the console.', 'error');
  }
});

registerAction('unlock-outlet', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const outlet = lastRaw?.[currentBid]?.outlets?.[currentOid];
  const name = outlet?.name || outlet?.settings?.Store?.storeName || 'this outlet';
  const ok = await showConfirm({
    title: `Unlock "${name}"?`,
    body: 'Grants the restaurant admin full access to all features. They can already log in but are currently locked.',
    confirmLabel: 'Unlock',
  });
  if (!ok) return;
  try {
    await firebase.database().ref(`businesses/${currentBid}/outlets/${currentOid}`).update({
      locked: false,
    });
    showToast('Restaurant unlocked — admin now has full access.', 'success');
  } catch (err) {
    console.error('unlock outlet failed', err);
    showToast('Unlock failed — check the console.', 'error');
  }
});

registerAction('reconnect-whatsapp', async () => {
  const { launchWhatsAppSignup } = await import('/js/features/whatsapp-linking.js');
  launchWhatsAppSignup(currentBid, currentOid, {});
});

// Channel toggle: switch the bot between the Official API and WhatsApp Web.
// No re-login is required — a linked Meta number or a saved Baileys session
// is reused. First-time linking (no number stored yet) still routes through
// the Meta signup flow.
registerAction('switch-transport', async (btn) => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const target = btn.dataset.transport;
  const outlet = lastRaw?.[currentBid]?.outlets?.[currentOid] || {};
  const current = outlet.bot?.transport || outlet.transport || 'baileys';
  if (target === current) return;

  const targetLabel = transportLabel(target);
  if (target === 'meta' && !outlet.whatsapp?.phoneNumberId) {
    // No number linked yet → first-time Meta signup (the only time the
    // Facebook Embedded Signup popup appears).
    return await import('/js/features/whatsapp-linking.js').then(({ launchWhatsAppSignup }) => {
      launchWhatsAppSignup(currentBid, currentOid, {});
    });
  }

  const body = target === 'baileys'
    ? 'Switches the bot to WhatsApp Web (QR). Your saved pairing is reused if one exists — no scan needed. If none, a QR appears to scan once.'
    : 'Switches the bot back to the Official WhatsApp API. No sign-in needed — the already-linked number is reused.';
  const ok = await showConfirm({
    title: `Switch to ${targetLabel}?`,
    body,
    confirmLabel: 'Switch',
  });
  if (!ok) return;

  const res = await callBotControlApiRaw('transport', currentBid, currentOid, { transport: target });
  if (!res) return;
  if (!res.ok) {
    let detail = '';
    try { const r = await res.json(); detail = r.error || ''; } catch (_) {}
    return showToast(`Switch failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
  if (target === 'baileys') {
    let needsQr = true;
    try { const r = await res.json(); needsQr = !!r.needsQr; } catch (_) {}
    if (needsQr) {
      pairModalOpen = true;
      openPairModal(currentBid, currentOid);
    } else {
      showToast('Switched to WhatsApp Web — using the saved session.', 'success');
    }
  } else {
    showToast('Switched to the Official API.', 'success');
  }
});

// Explicit re-pair: discard the saved Baileys session so a fresh QR is shown.
registerAction('rescan-baileys', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const ok = await showConfirm({
    title: 'Re-scan WhatsApp Web QR?',
    body: 'Discards the current WhatsApp Web pairing for this outlet and shows a fresh QR to scan. Use this if the number was changed or the pairing was logged out.',
    confirmLabel: 'Re-scan',
  });
  if (!ok) return;
  const res = await callBotControlApiRaw('rescan', currentBid, currentOid);
  if (!res) return;
  if (!res.ok) {
    let detail = '';
    try { const r = await res.json(); detail = r.error || ''; } catch (_) {}
    return showToast(`Re-scan failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
  pairModalOpen = true;
  openPairModal(currentBid, currentOid);
});

// First-time pairing on a freshly provisioned bot: no saved session exists,
// so this just asks the bot to emit its QR (rescan on an empty dir is a no-op
// wipe — identical behavior, no confirm needed beyond the action).
registerAction('scan-baileys', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const res = await callBotControlApiRaw('rescan', currentBid, currentOid);
  if (!res) return;
  if (!res.ok) {
    let detail = '';
    try { const r = await res.json(); detail = r.error || ''; } catch (_) {}
    return showToast(`Could not get a QR — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
  }
  pairModalOpen = true;
  openPairModal(currentBid, currentOid);
});

// --- end of reactivate-outlet handler ---

// ---- Billing & promo tokens ----------------------------------------------
registerAction('billing-toggle-mode', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const b = lastRaw?.[currentBid]?.outlets?.[currentOid]?.billing;
  if (!b) return showToast('Billing not seeded — run tools/seed-billing-defaults.cjs.', 'error');
  const next = b.mode === 'commission_1pct' ? 'per_order' : 'commission_1pct';
  const ok = await showConfirm({
    title: next === 'commission_1pct' ? 'Switch to 1% of sales?' : 'Switch to per-order billing?',
    body: next === 'commission_1pct'
      ? `WhatsApp delivery orders are billed at 1% of order value instead of the flat ₹${b.rates?.WA ?? 3}. QR, POS and other sources stay per-order.`
      : `Every source goes back to flat per-order rates (QR ₹${b.rates?.QR ?? 2} · POS ₹${b.rates?.POS ?? 1}, WhatsApp delivery ₹${b.rates?.WA ?? 3}).`,
    confirmLabel: 'Switch mode',
  });
  if (!ok) return;
  try {
    await firebase.database().ref(`businesses/${currentBid}/outlets/${currentOid}/billing`).update({ mode: next });
    showToast(`Billing mode → ${next === 'commission_1pct' ? '1% of sales' : 'per order'}.`, 'success');
  } catch (err) {
    console.error('billing mode switch failed', err);
    showToast('Mode switch failed — check the console.', 'error');
  }
});

registerAction('billing-save-setup', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const status = document.getElementById('billingSetupStatus')?.value;
  if (!status) return;
  try {
    await firebase.database().ref(`businesses/${currentBid}/outlets/${currentOid}/billing/setup`).update({ status });
    if (billingDraft) billingDraft.setup = status;
    showToast('Setup status saved.', 'success');
  } catch (err) {
    console.error('billing setup save failed', err);
    showToast('Setup save failed — check the console.', 'error');
  }
});

registerAction('billing-grant-tokens', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const qty = parseInt(document.getElementById('billingGrantQty')?.value, 10);
  const priceRs = parseFloat(document.getElementById('billingGrantPrice')?.value || '0');
  if (!Number.isFinite(qty) || qty < 1 || qty > 10000) return showToast('Enter a token quantity between 1 and 10000.', 'error');
  if (priceRs < 0) return showToast('Price cannot be negative.', 'error');
  const b = lastRaw?.[currentBid]?.outlets?.[currentOid]?.billing;
  const listValue = (qty * (b?.rates?.promo ?? 1)).toFixed(2);
  const ok = await showConfirm({
    title: `Grant ${qty} promo token${qty === 1 ? '' : 's'}?`,
    body: `Adds ${qty} tokens to this outlet's prepaid balance (list value ₹${listValue}).${priceRs > 0 ? ` Sold for ₹${priceRs.toFixed(2)}.` : ' Recorded as a free grant.'}`,
    confirmLabel: 'Grant tokens',
  });
  if (!ok) return;
  try {
    const user = firebase.auth().currentUser;
    const base = `businesses/${currentBid}/outlets/${currentOid}/billing`;
    // History push first, balance transaction last. If anything fails in
    // between, only an orphan history row remains (cosmetic) — never a
    // credited balance with no record, which the "Grant failed" toast could
    // then invite a retry that double-credits. The transaction still keeps
    // simultaneous grants from overwriting each other's increment.
    await firebase.database().ref(`${base}/tokenPacks`).push({
      qty,
      priceRs: Number.isFinite(priceRs) ? priceRs : 0,
      grantedAt: firebase.database.ServerValue.TIMESTAMP,
      grantedBy: user?.uid || 'unknown',
    });
    await firebase.database().ref(`${base}/tokens/balance`).transaction((cur) => (cur || 0) + qty);
    billingDraft = null;
    // Clear the inputs as well — a live tick during the awaits above
    // re-rendered them from the draft, so waiting for the next tick could
    // leave the old qty visible and invite a double-grant.
    const qtyEl = document.getElementById('billingGrantQty');
    const priceEl = document.getElementById('billingGrantPrice');
    if (qtyEl) qtyEl.value = '';
    if (priceEl) priceEl.value = '';
    showToast(`${qty} promo tokens granted.`, 'success');
  } catch (err) {
    console.error('grant tokens failed', err);
    showToast('Grant failed — check the console.', 'error');
  }
});

// ---- Payment Management (profile side) ------------------------------------
// Same modal + receipt as the Payment Management tab and record page — all
// three write businesses/{bid}/outlets/{oid}/billing/payments, so a payment
// recorded here shows up on the tab immediately (one data-store listener).
registerAction('profile-record-payment', async () => {
  if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  const outlet = lastRaw?.[currentBid]?.outlets?.[currentOid];
  if (!outlet) return showToast('Outlet not loaded yet.', 'error');
  const due = scopeStats(outlet, { k: 'all' }).due;
  const payment = await recordPaymentModal({ bid: currentBid, oid: currentOid, due: due > 0 ? due : 0 });
  if (!payment) return;
  const receipt = await showConfirm({
    title: 'Payment recorded',
    body: `Receipt ${payment.receiptNo} for ${inr(payment.amount)}. Create the printable receipt now?`,
    confirmLabel: 'Create receipt',
  });
  if (receipt) {
    // re-read AFTER the write: Firebase snapshots are immutable, the pre-modal
    // refs still miss this payment and the receipt would print the old balance
    const live = lastRaw?.[currentBid];
    const o = live?.outlets?.[currentOid] || outlet;
    const store = (o.settings && o.settings.Store) || {};
    printReceipt({
      businessName: live?.name || store.entityName || '',
      outletName: o.name || store.storeName || currentOid,
      payment,
      stats: scopeStats(o, { k: 'all' }),
    });
  }
});
