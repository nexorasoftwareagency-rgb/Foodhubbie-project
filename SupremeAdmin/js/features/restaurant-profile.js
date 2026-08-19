import { registerAction, navigate } from '/js/main.js';
import { subscribe, isReadOnly } from '/js/data-store.js';

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

// ---- Business & store details (read + inline edit) ----------------------
// Reads/writes the exact same paths the Restaurant Admin app's settings page
// uses (settings/Store, settings/Delivery), so edits from the Owner profile
// land in the live store, not a shadow copy. Business-level fields
// (name/plan/contact) live directly under businesses/{bid}.
function detailValues(bid, oid, biz, outlet) {
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

function renderDetailView(bid, oid, biz, outlet) {
  const v = detailValues(bid, oid, biz, outlet);
  const isUrl = (s) => /^https?:\/\//i.test(s);
  const cell = (label, value, { mono = false, span = false } = {}) => {
    if (!value) return '';
    const display = isUrl(value)
      ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" title="${escapeHtml(value)}">${escapeHtml(value.length > 52 ? value.slice(0, 49) + '…' : value)}</a>`
      : `<span${mono ? ' class="mono"' : ''}>${escapeHtml(value)}</span>`;
    return `<div class="detail-cell${span ? ' span-2' : ''}"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${display}</div></div>`;
  };
  const section = (title, cellsHtml) => cellsHtml
    ? `<div class="detail-section-title">${escapeHtml(title)}</div><div class="detail-grid">${cellsHtml}</div>`
    : '';
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

function renderDetailForm(state) {
  const field = (label, name, placeholder, type = 'text') => `
    <label class="field-label">${escapeHtml(label)}</label>
    <input type="${type}" name="${name}" data-detail="${name}" class="text-input" value="${escapeHtml(state[name] || '')}" placeholder="${escapeHtml(placeholder || '')}" ${type === 'time' ? '' : ''} />`;
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>${field('Business name', 'businessName', 'e.g. My Restaurant')}</div>
      <div>${field('Outlet name', 'outletName', 'e.g. Boring Road')}</div>
      <div>${field('Contact phone', 'contactPhone', '+91…')}</div>
      <div>${field('Contact email', 'contactEmail', 'owner@restaurant.com', 'email')}</div>
      <div>
        <label class="field-label">Plan / tier</label>
        <select name="plan" data-detail="plan" class="text-input">
          ${['starter', 'growth', 'enterprise'].map((p) => `<option value="${p}" ${state.plan === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div>${field('Store name', 'storeName', 'e.g. My Restaurant')}</div>
      <div>${field('Entity name', 'entityName', 'e.g. My Restaurant Pvt Ltd')}</div>
      <div>${field('Address', 'address', 'Shop address')}</div>
      <div>${field('GSTIN', 'gstin', '15-char GSTIN')}</div>
      <div>${field('FSSAI', 'fssai', '14-digit FSSAI')}</div>
      <div>${field('Tagline', 'tagline', 'e.g. Jai Hind')}</div>
      <div>
        <label class="field-label">Opening / closing time</label>
        <div style="display:flex;gap:6px">
          <input type="time" name="shopOpenTime" data-detail="shopOpenTime" class="text-input" value="${escapeHtml(state.shopOpenTime || '')}" />
          <input type="time" name="shopCloseTime" data-detail="shopCloseTime" class="text-input" value="${escapeHtml(state.shopCloseTime || '')}" />
        </div>
      </div>
      <div>${field('Instagram', 'instagram', '@handle or URL')}</div>
      <div>${field('Facebook', 'facebook', 'URL')}</div>
      <div>${field('Google review link', 'googleReviewLink', 'URL')}</div>
      <div>${field('Delivery notify phone', 'notifyPhone', 'Rider-order notifications')}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary btn-sm" data-action="save-detail">Save changes</button>
      <span style="font-size:12px;color:var(--text-secondary);align-self:center">Saved live to the restaurant's Firebase record.</span>
    </div>`;
}

// Message-template library lives at appTemplates/whatsappTemplates/templates
// (seeded by tools/seed-templates.cjs). Render the list once per profile
// visit; each row has an Install button that POSTs to the Bot Control API
// to create the template on the outlet's WABA. Marked ⬅ if it already exists
// on the WABA (matched by name).
let waTemplatesLoadedFor = null;
let waTemplatesHtml = null;
let waLibrary = {};
async function loadWaTemplates(bid, oid) {
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

// Clicking a template name/body opens a detail panel: all stored fields, the
// real message text with a sample-filled WhatsApp preview, explanation, and
// use cases. Pure render — reads the already-fetched library from state.
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


const ADMIN_APP_URL = 'https://foodhubbie-admins.web.app';

function renderAdminCreds(creds) {
  if (!creds.email && !creds.password) {
    return `<div style="color:var(--text-secondary)">No admin login stored yet — this restaurant's staff sign in to the Restaurant Admin panel with email + password. Add it here so it's on record.</div>
      <div style="margin-top:6px"><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`;
  }
  const copyBtn = (text, label) => `<button class="btn btn-ghost btn-sm" data-action="copy-credential" data-copy="${escapeHtml(text)}" title="Copy ${label}" aria-label="Copy ${label}" style="padding:3px 6px;min-width:0"><svg data-lucide="copy" style="width:12px;height:12px"></svg></button>`;
  const eyeToggle = `<button class="btn btn-ghost btn-sm" data-action="toggle-password-visibility" title="Show / hide password" aria-label="Show / hide password" style="padding:3px 6px;min-width:0"><svg data-lucide="eye" style="width:12px;height:12px"></svg></button>`;
  const rows = [];
  if (creds.email) rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-secondary)">Username:</span> <span class="mono">${escapeHtml(creds.email)}</span>${copyBtn(creds.email, 'username')}</div>`);
  if (creds.password) rows.push(`<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--text-secondary)">Password:</span> <span class="mono admin-pass-masked" data-raw="${escapeHtml(creds.password)}" style="letter-spacing:2px">••••••••</span>${eyeToggle}${copyBtn(creds.password, 'password')}</div>`);
  rows.push(`<div><span style="color:var(--text-secondary)">Admin app:</span> <a href="${ADMIN_APP_URL}" target="_blank" rel="noopener">${ADMIN_APP_URL}</a></div>`);
  if (!rows.length) return '';
  return `<div style="color:var(--text-primary);line-height:2">${rows.join('')}</div>`;
}

function renderAdminForm(state) {
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

// Quota is not part of the realtime `businesses` tree (Meta doesn't push
// it to us), so it's a one-off REST call to the Bot Control API rather
// than something the live listener covers. Safe to fail quietly — this
// is a nice-to-have panel, not core status.
async function loadQuota(bid, oid) {
  // No WhatsApp linked → nothing to query, and the API 501s without a
  // META_SYSTEM_USER_TOKEN anyway. Skip the call entirely so the console
  // stays clean; the card already explains the state.
  if (quotaFetchedFor === `${bid}/${oid}`) return;
  const rawOutlet = lastRaw?.[bid]?.outlets?.[oid];
  if (rawOutlet?.whatsapp?.status !== 'active') return;
  quotaFetchedFor = `${bid}/${oid}`;
  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/whatsapp/quota/${bid}/${oid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const el = document.getElementById('quota-content');
    if (!el) return; // navigated away before this resolved
    if (res.status === 501) {
      // Feature isn't wired up server-side yet — show a helpful message
      // instead of removing the card, so the owner knows what's needed.
      quotaHtml = 'Connect the Meta System User Token on the server to view messaging quota.';
      el.innerHTML = quotaHtml;
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const { tier, used, limit } = await res.json();
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const bar = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';
    quotaHtml = `
      <div style="display:flex;justify-content:space-between"><span>${escapeHtml(tier || 'Tier')}</span><span class="mono">${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')}</span></div>
      <div class="quota-gauge-track"><div class="quota-gauge-fill ${bar}" style="width:${pct}%"></div></div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-secondary);opacity:.7">Counts messages accepted by WhatsApp today (delivery not guaranteed until an approved template is used for proactive sends).</div>
    `;
    el.innerHTML = quotaHtml;
  } catch (err) {
    console.error('loadQuota failed', err);
    const el = document.getElementById('quota-content');
    if (el) el.textContent = 'Could not load quota right now.';
  }
}

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

// Legacy handler kept so any stale cached page that still renders a
// "reconnect-whatsapp" button doesn't throw — no-op now that the toggle
// owns channel switching.
registerAction('reconnect-whatsapp', async () => {
  const { launchWhatsAppSignup } = await import('/js/features/whatsapp-linking.js');
  launchWhatsAppSignup(currentBid, currentOid, {});
});
