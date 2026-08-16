/**
 * Hash router + lazy feature loader + the single delegated data-action
 * dispatcher for the whole app (mirrors the Admin panel's ui.js pattern:
 * one listener, not one addEventListener per button).
 *
 * Routes:
 *   #restaurants                 → restaurant-list.js
 *   #restaurants/onboard         → restaurant-onboarding.js (isSuper only)
 *   #profile/{bid}/{oid}         → restaurant-profile.js
 *   #agents                      → bot-fleet-overview.js
 *   #analytics                   → restaurant-analytics.js (platform-wide)
 *   #analytics/{bid}/{oid}       → restaurant-analytics.js (single outlet)
 *
 * A route's render() may return a cleanup function (e.g. a data-store
 * unsubscribe) — handleRoute calls the previous page's cleanup before
 * loading the next one, so live listeners don't stack across navigation.
 */

import { isReadOnly } from '/js/data-store.js';

const moduleCache = new Map();

async function mod(path) {
  if (!moduleCache.has(path)) {
    moduleCache.set(path, import(path));
  }
  return moduleCache.get(path);
}

const routes = [
  { test: (h) => h === '' || h === 'restaurants', dashboard: 'restaurant', load: () => mod('/js/features/restaurant-list.js').then((m) => m.render()) },
  { test: (h) => h === 'restaurants/onboard', dashboard: 'restaurant', load: () => mod('/js/features/restaurant-onboarding.js').then((m) => m.render()) },
  { test: (h) => h.startsWith('profile/'), dashboard: 'restaurant', load: (h) => {
      const [, bid, oid, tab] = h.split('/');
      return mod('/js/features/restaurant-profile.js').then((m) => m.render(bid, oid, tab));
    } },
  { test: (h) => h === 'agents', dashboard: 'agent', load: () => mod('/js/features/bot-fleet-overview.js').then((m) => m.render()) },
  { test: (h) => h === 'analytics', dashboard: 'restaurant', load: () => mod('/js/features/restaurant-analytics.js').then((m) => m.render()) },
  { test: (h) => h.startsWith('analytics/'), dashboard: 'restaurant', load: (h) => {
      const [, bid, oid] = h.split('/');
      return mod('/js/features/restaurant-analytics.js').then((m) => m.render(bid, oid));
    } },
];

// Home route for each dashboard — used by the switcher when jumping
// straight to "Restaurant Management" or "WhatsApp Agents".
const DASHBOARD_HOME = { restaurant: 'restaurants', agent: 'agents' };

const mainEl = document.getElementById('app-main');
const subnavEl = document.getElementById('app-subnav');
let currentCleanup = null;

async function handleRoute() {
  if (currentCleanup) {
    try { currentCleanup(); } catch (err) { console.error('Route cleanup failed', err); }
    currentCleanup = null;
  }

  const hash = location.hash.replace(/^#/, '');

  // Read-only (support-claim) accounts never see the onboarding form —
  // it's the one route that's pure mutation with no view-only version.
  if (hash === 'restaurants/onboard' && isReadOnly()) {
    showToast("Your account is view-only — you can't add restaurants.", 'error');
    navigate('restaurants');
    return;
  }

  const topLevel = hash.split('/')[0] || 'restaurants';
  const match = routes.find((r) => r.test(hash));
  const dashboard = match ? match.dashboard : 'restaurant';

  setActiveDashboard(dashboard);
  updateActiveNav(topLevel);

  mainEl.innerHTML = `<div class="skeleton" style="height:220px;border-radius:14px"></div>`;
  try {
    if (match) {
      const cleanup = await match.load(hash);
      if (typeof cleanup === 'function') currentCleanup = cleanup;
    } else {
      renderNotFound();
    }
  } catch (err) {
    console.error('Route render failed', err);
    mainEl.innerHTML = `<div class="glass-card table-empty">Something went wrong loading this page. Check the console for details.</div>`;
  }
}

// Reskins the content area + sub-nav to the active dashboard's theme
// (Restaurant Management = orange, WhatsApp Agents = WhatsApp green) and
// updates the switcher's pressed state.
function setActiveDashboard(dashboard) {
  mainEl.classList.remove('theme-restaurant', 'theme-agent');
  mainEl.classList.add(`theme-${dashboard}`);
  subnavEl.classList.remove('theme-restaurant', 'theme-agent');
  subnavEl.classList.add(`theme-${dashboard}`);

  document.querySelectorAll('.subnav-group').forEach((g) => {
    g.classList.toggle('active', g.dataset.group === dashboard);
  });
  document.querySelectorAll('.dash-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.dashboard === dashboard);
  });
}

function updateActiveNav(topLevel) {
  document.querySelectorAll('#app-subnav .nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === topLevel);
  });
}

function renderNotFound() {
  mainEl.innerHTML = `<div class="glass-card table-empty">Page not found.</div>`;
}

function navigate(hash) {
  location.hash = hash;
}

// ---- global delegated dispatcher -----------------------------------------
// Feature modules register handlers here instead of attaching their own
// per-button listeners. A handler receives (btn, event).
const actionHandlers = new Map();
function registerAction(name, fn) { actionHandlers.set(name, fn); }

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  // built-in app-shell actions
  if (action === 'logout') { firebase.auth().signOut(); return; }
  if (action === 'close-drawer') { closeDrawer(); return; }
  if (action === 'navigate') { navigate(btn.dataset.href); return; }
  if (action === 'switch-dashboard') { navigate(DASHBOARD_HOME[btn.dataset.dashboard]); return; }
  if (action === 'open-command-palette') { openCommandPalette(); return; }

  const handler = actionHandlers.get(action);
  if (handler) handler(btn, e);
});

// ---- command palette (⌘K / Ctrl+K) ---------------------------------------
function openCommandPalette() {
  mod('/js/features/command-palette.js').then((m) => m.open());
}

document.addEventListener('keydown', (e) => {
  const key = e.key ? e.key.toLowerCase() : '';
  if ((e.metaKey || e.ctrlKey) && key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
});

export function startApp() {
  // The ⌘K hint should only read as ⌘ on macOS — swap it for Windows/Linux.
  const kbd = document.getElementById('cp-kbd');
  if (kbd && !/Mac/i.test(navigator.platform)) kbd.textContent = 'Ctrl K';
  window.addEventListener('hashchange', handleRoute);
  window.__fhSupreme = { navigate, registerAction, mod }; // exposed for feature modules loaded as classic scripts, if ever needed
  handleRoute();
}

export { navigate, registerAction };
