/**
 * Shared helpers used by every feature module.
 * Loaded as a plain (non-module) script so it's available as globals
 * before main.js's dynamic imports run.
 */

// ---- escaping --------------------------------------------------------
// Never trust Firebase-sourced strings (restaurant names, phone numbers,
// contact emails, etc.) to be safe for innerHTML.
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- icons -------------------------------------------------------------
function refreshIcons(root) {
  if (window.lucide) window.lucide.createIcons({ root: root || document });
}

// ---- toast ---------------------------------------------------------------
function showToast(message, type) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  const icon = type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle-2' : 'info';
  el.innerHTML = `<svg data-lucide="${icon}" style="width:15px;height:15px;flex:none"></svg><span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  refreshIcons(root);
  // Cap visible toasts — a rapid bulk action shouldn't bury the corner in
  // notifications. Oldest dismissed first (same idea as Admin's _toastQueue).
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(() => el.remove(), 200);
  }, 3400);
}

// ---- confirm (non-native, reuses the shared .modal pattern) --------------
function showConfirm({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal open" id="confirm-modal">
        <div class="modal-content" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="confirm-title">${escapeHtml(title)}</div>
          <div class="confirm-body">${escapeHtml(body)}</div>
          <div class="confirm-actions">
            <button class="btn btn-ghost" data-confirm="cancel">Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="ok">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const modal = document.getElementById('confirm-modal');
    const okBtn = modal.querySelector('[data-confirm="ok"]');
    if (okBtn) okBtn.focus(); // move keyboard focus into the dialog, not left on the trigger
    const cleanup = (result) => {
      modal.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { root.innerHTML = ''; }, 180);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      }
    };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => {
      const action = e.target.closest('[data-confirm]')?.dataset.confirm;
      if (action === 'ok') cleanup(true);
      else if (action === 'cancel' || e.target === modal) cleanup(false);
    });
  });
}

// ---- drawer helpers --------------------------------------------------
function openDrawer(html) {
  const root = document.getElementById('drawer-root');
  root.innerHTML = `
    <div class="drawer-overlay" id="active-drawer">
      <div class="drawer-content">
        <button class="drawer-close" data-action="close-drawer" aria-label="Close"><svg data-lucide="x"></svg></button>
        ${html}
      </div>
    </div>`;
  refreshIcons(root);
  requestAnimationFrame(() => document.getElementById('active-drawer').classList.add('open'));
}
function closeDrawer() {
  const el = document.getElementById('active-drawer');
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => { document.getElementById('drawer-root').innerHTML = ''; }, 180);
}

// ---- formatting --------------------------------------------------------
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function formatMemory(mb) {
  if (!mb && mb !== 0) return '—';
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
function statusLabel(status) {
  return { online: 'Online', degraded: 'Degraded', offline: 'Offline', errored: 'Errored', unknown: 'Unknown' }[status] || 'Unknown';
}
function statusClass(status) {
  if (status === 'online') return 'online';
  if (status === 'degraded') return 'degraded';
  if (status === 'offline' || status === 'errored') return 'offline';
  return 'unknown';
}
function statusPillHtml(status) {
  const cls = statusClass(status);
  return `<span class="status-pill ${cls}"><span class="pulse-dot"></span>${statusLabel(status)}</span>`;
}

// ---- CSV export ------------------------------------------------------
// columns: [{ key, label }]. Values are read off each row by `key` and
// CSV-escaped (quotes doubled, wrapped in quotes if they contain a
// comma/quote/newline).
function exportCsv(filename, columns, rows) {
  const escapeCell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Formula-injection guard: a cell starting with =, +, -, or @ executes
    // as a formula when opened in Excel/Sheets. Values here are Firebase-
    // sourced (restaurant names, contact fields) and could theoretically
    // be attacker-controlled by anyone with restaurant-admin write access,
    // so neutralize rather than trust them.
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => escapeCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- status sparkline ---------------------------------------------------
// Renders a 24h "uptime bar" (status-page style) from a capped history
// array [{ status, at }, ...] (chronological). Buckets into `hours`
// equal segments and carries the last-known status forward into any
// bucket with no event — gaps read as "still whatever it was."
function renderUptimeSparkline(history, hours = 24) {
  const now = Date.now();
  const bucketMs = (hours * 3600 * 1000) / hours; // 1h per bucket by default
  // botStatus.history is written via push() server-side, so Firebase hands
  // it back as a {pushId: {status,at}} map, not an array — normalize either
  // shape to a plain array here so every caller can just pass what it got.
  const list = Array.isArray(history) ? history : Object.values(history || {});
  const events = list.slice().sort((a, b) => a.at - b.at);

  const buckets = [];
  for (let i = hours - 1; i >= 0; i--) {
    const bucketEnd = now - i * bucketMs;
    // last event at or before this bucket's end
    let status = 'unknown';
    for (const e of events) {
      if (e.at <= bucketEnd) status = e.status;
      else break;
    }
    buckets.push(status);
  }

  const w = 240, h = 22, gap = 2;
  const barW = (w - gap * (hours - 1)) / hours;
  const colorVar = (s) => ({
    online: 'var(--status-online)',
    degraded: 'var(--status-degraded)',
    offline: 'var(--status-offline)',
    errored: 'var(--status-offline)',
  }[s] || 'var(--status-unknown)');

  const bars = buckets.map((s, i) => {
    const x = i * (barW + gap);
    return `<rect x="${x.toFixed(1)}" y="2" width="${barW.toFixed(1)}" height="${h - 4}" rx="1.5" fill="${colorVar(s)}" opacity="${s === 'unknown' ? 0.35 : 0.9}" />`;
  }).join('');

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-label="Status over last ${hours}h">${bars}</svg>`;
}

// ---- relative time / staleness -------------------------------------------
// "5m ago" style labels + a staleness check used to dim rows whose last
// bot-status update is old. Firebase ServerValue.TIMESTAMP is ms.
function formatDate(ts) {
  if (!ts) return '—';
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatAge(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function isStale(ts, maxMs = 5 * 60 * 1000) {
  return !!ts && Date.now() - ts > maxMs;
}

// ---- transport naming -----------------------------------------------------
// Two distinct WhatsApp concepts on this platform, deliberately kept apart:
//   1. OFFICIAL WhatsApp = Meta Cloud API (Embedded Signup, phoneNumberId).
//      Controlled from this dashboard via whatsapp-linking.js.
//   2. WhatsApp Web / QR = Baileys transport (the legacy/default bot channel).
// Naming stays explicit in the UI so the two can never be confused.
function transportLabel(transport) {
  if (transport === 'meta') return 'Official API';
  if (transport === 'baileys') return 'WhatsApp Web (QR)';
  return 'Not configured';
}
function transportBadgeHtml(transport) {
  const label = transportLabel(transport);
  const cls = transport === 'meta' ? 'online' : transport === 'baileys' ? 'degraded' : 'unknown';
  return `<span class="transport-badge ${cls}">${escapeHtml(label)}</span>`;
}

// ---- onboarding stepper --------------------------------------------------
// Steps 1–2 (business/outlet) read in Restaurant-orange; steps 3–4
// (WhatsApp/bot) read in WhatsApp-green — a small visual handoff between
// the two dashboards, same idea as the profile page's .theme-agent scope.
function renderOnboardingStepper({ businessCreated, outletCreated, whatsappLinked, botOnline }) {
  const steps = [
    { label: 'Business created', done: businessCreated, theme: 'restaurant' },
    { label: 'Outlet created', done: outletCreated, theme: 'restaurant' },
    { label: 'WhatsApp linked', done: whatsappLinked, theme: 'agent' },
    { label: 'Bot online', done: botOnline, theme: 'agent' },
  ];
  let reachedPending = false;
  return `
    <div class="onboard-stepper">
      ${steps.map((s, i) => {
        const isCurrent = !s.done && !reachedPending;
        if (isCurrent) reachedPending = true;
        const state = s.done ? 'done' : isCurrent ? 'current' : 'pending';
        return `
          <div class="onboard-step theme-${s.theme} state-${state}">
            <div class="onboard-step-dot">${s.done ? '<svg data-lucide="check"></svg>' : i + 1}</div>
            <div class="onboard-step-label">${escapeHtml(s.label)}</div>
          </div>
          ${i < steps.length - 1 ? '<div class="onboard-step-line"></div>' : ''}
        `;
      }).join('')}
    </div>`;
}

// ---- misc ------------------------------------------------------------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
