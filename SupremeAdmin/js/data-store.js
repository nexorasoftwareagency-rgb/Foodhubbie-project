/**
 * Single source of live data for the whole app.
 *
 * Keeps ONE `.on('value')' listener on `businesses` for the entire
 * session — every feature module subscribes here instead of attaching
 * its own Firebase listener. This is what makes bot status "real-time"
 * (improvement: Orchestrator/status-watcher writes to
 * businesses/{bid}/outlets/{oid}/botStatus on every state change; this
 * store's existing listener picks it up for free, no polling).
 *
 * botStatus is expected to look like:
 *   { status, uptime, memory, updatedAt, history: [{status, at}, ...] }
 * (history capped server-side to the last ~48 entries — see
 * bot-control-api/status-watcher.js). Because it's nested under the
 * outlet, the sparkline needs no separate read either.
 */

let raw = {};              // last snapshot of the `businesses` node
let ready = false;
let started = false;
let dbRef = null;
const subscribers = new Set();

function start() {
  if (started) return;
  started = true;
  dbRef = firebase.database().ref('businesses');
  dbRef.on('value', (snap) => {
    raw = snap.val() || {};
    ready = true;
    subscribers.forEach((fn) => fn(raw));
  }, (err) => {
    console.error('data-store: businesses listener error', err);
    showToast('Lost the live connection — reconnecting…', 'error');
  });
}

// Called once from a feature module's render(); returns an unsubscribe
// function to call from that module's cleanup (route change).
export function subscribe(fn) {
  start();
  subscribers.add(fn);
  if (ready) fn(raw); // fire immediately with whatever we already have
  return () => subscribers.delete(fn);
}

export function getRawBusinesses() {
  return raw;
}

// Flattens businesses -> outlets into the row shape every table/grid
// feature wants. Single place so filters/CSV/search/sparklines all agree
// on field names.
export function flattenOutlets() {
  const rows = [];
  Object.entries(raw).forEach(([bid, biz]) => {
    Object.entries(biz.outlets || {}).forEach(([oid, outlet]) => {
      const bot = outlet.botStatus || {};
      const transport = outlet.bot?.transport || outlet.transport || 'baileys'; // mirrors bot/transport.js getTransportMode default
      // Display names live under settings/Store/storeName in the real DB,
      // not on the business/outlet nodes — fall back across all three so
      // the dashboard never shows "Unnamed" for a real store.
      const store = (outlet.settings && outlet.settings.Store) || {};
      const bizName = biz.name || store.entityName || biz.businessName || store.storeName || 'Unnamed business';
      const outletName = outlet.name || store.storeName || outlet.outletName || bizName;
      rows.push({
        bid, oid,
        outletName,
        businessName: bizName,
        plan: biz.plan || 'starter',
        contact: outlet.contactPhone || biz.contactPhone || store.whatsappNumber || outlet.contactEmail || '—',
        whatsappStatus: outlet.whatsapp?.status || 'not connected',
        phoneNumberId: outlet.whatsapp?.phoneNumberId || null,
        transport,
        provisioned: !!outlet.bot?.provisionedAt,
        healthPort: outlet.bot?.healthPort || null,
        botStatus: bot.status || 'unknown',
        updatedAt: bot.updatedAt || null,
        uptime: bot.uptime || 0,
        memory: bot.memory || 0,
        history: bot.history ? Object.values(bot.history) : [],
      });
    });
  });
  return rows.sort((a, b) => a.outletName.localeCompare(b.outletName));
}

// ---- session / role ----------------------------------------------------
// 'super' = full read/write access. 'support' = read-only (view-only claim
// for junior staff — see auth.js). Action buttons across features check
// isReadOnly() and hide/disable themselves accordingly; the Bot Control
// API independently enforces this server-side, so this is UX only, not
// the security boundary.
let role = null;
export function setRole(r) { role = r; }
export function getRole() { return role; }
export function isReadOnly() { return role === 'support'; }
