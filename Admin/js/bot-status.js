/**
 * FoodHubbie ERP | GLOBAL BOT-STATUS LISTENER
 * Monitors bot/{outlet}/status from Firebase and dispatches a
 * `botStatusChange` custom event so any component can react.
 *
 * LIVENESS, NOT SNAPSHOT: the worker rewrites bot/status every 60s, so a
 * snapshot older than FRESH_MS means the worker is gone. The check ALSO runs
 * on a local ticker — a dead worker never writes again, so an onValue-only
 * check froze the last "Online" snapshot in the client for ever and the
 * dashboard kept claiming a bot that died a week ago was still online.
 */
import { Outlet, BUSINESS_BY_OUTLET, tenantRef, onValue, auth, onAuthStateChanged } from './firebase.js';
import { logger } from './utils/logger.js';

// Must stay above the bot's 60s heartbeat (bot/index.js reportInterval).
const FRESH_MS = 90 * 1000;
// How much clock skew is tolerated before a heartbeat is treated as impossible.
const SKEW_MS = 5 * 60 * 1000;
// How often a frozen heartbeat is re-checked locally (and the tenant the
// listener is bound to is re-checked - see _attachListener).
const TICK_MS = 5000;

if (!window.__botStatusInit) {
  window.__botStatusInit = true;
  logger.info('BOT', 'Initializing bot status listener');

  let _statusListener = null;
  let _currentRef = null;
  let _attachedPath = '';
  let _authed = false;
  let _rawStatus = '';
  let _lastSeen = 0;
  let _online = false;
  let _known = false;

  function _evaluate() {
    return _rawStatus === 'Online' && _lastSeen > 0 && (Date.now() - _lastSeen) < FRESH_MS;
  }

  // force = dispatch even when the boolean did not change (a fresh snapshot
  // refreshes the "last seen N min ago" text). A tick passes false so it only
  // dispatches on an actual ONLINE <-> OFFLINE flip.
  function _setStatus(rawStatus, lastSeen, force) {
    _rawStatus = rawStatus || '';
    let seen = Number(lastSeen || 0);
    // A heartbeat dated in the FUTURE is not a heartbeat: the demo seeder
    // writes one a year ahead (so the sandbox looks alive), and a clock that
    // far ahead is broken. Treat it as "never reported" instead of showing
    // "Bot online" for a bot that does not exist.
    if (seen > Date.now() + SKEW_MS) seen = 0;
    _lastSeen = seen;
    const online = _evaluate();
    const changed = !_known || online !== _online;
    _online = online;
    _known = true;
    window._botOnline = online;
    window._botLastSeen = _lastSeen;
    if (!changed && !force) return;
    window.dispatchEvent(new CustomEvent('botStatusChange', {
      detail: { online, lastSeen: _lastSeen }
    }));
    logger.info('BOT', `Bot status changed: ${online ? 'ONLINE' : 'OFFLINE'} (last seen: ${ _lastSeen ? new Date(_lastSeen).toLocaleTimeString() : 'never'})`);
  }

  function _detachListener() {
    if (typeof _statusListener === 'function') { try { _statusListener(); } catch (e) {} }
    _statusListener = null;
    _currentRef = null;
    _attachedPath = '';
    window.__botStatusPath = '';
  }

  // The tenant path this listener must be bound to.
  //
  // Resolved LAZILY, never at module-eval time: window.currentBusinessId and
  // window.currentOutlet are set by demo-mode.js (before its sign-in) and by
  // auth.js (after the admin node is read) - both AFTER this module has been
  // evaluated. An eager attach therefore bound to the DEFAULT tenant
  // (roshani-pizza/pizza) and the public demo read the pizza bot's heartbeat
  // instead of its own.
  function _resolvedPath() {
    // window.currentOutlet / sessionStorage.adminSelectedOutlet are the
    // "an outlet was actually chosen" signal - Outlet.current alone falls back
    // to 'pizza', which is NOT a choice, and binding to the default tenant
    // would show another restaurant's heartbeat.
    const chosen = String(window.currentOutlet || sessionStorage.getItem('adminSelectedOutlet') || '').trim().toLowerCase();
    if (!chosen) return '';
    const outlet = String(Outlet.current || chosen).trim().toLowerCase();
    const bid = String(window.currentBusinessId || BUSINESS_BY_OUTLET[outlet] || '').trim().toLowerCase();
    if (!bid) return '';
    return `businesses/${bid}/outlets/${outlet}/bot/status`;
  }

  // Attach (or re-attach) to the CURRENT tenant's heartbeat.
  // force = re-attach even when the path is unchanged (an outlet switch can
  // put the same outlet name behind a different business).
  function _attachListener(force) {
    const path = _resolvedPath();
    if (!path) return;
    if (!force && path === _attachedPath) return;
    _detachListener();
    const outlet = Outlet.current;
    try {
      const statusRef = tenantRef(outlet, 'bot/status');
      if (!statusRef || typeof statusRef.toString !== 'function') {
        throw new Error('Outlet.ref returned invalid reference: ' + typeof statusRef);
      }
      _currentRef = statusRef;
      const unsub = onValue(statusRef, (snap) => {
        const val = snap.val() || {};
        _setStatus(val.status, val.lastSeen, true);
      }, (err) => {
        logger.warn('BOT', `Listener error: ${err.message}`);
        _setStatus('', 0, true);
      });
      _statusListener = (typeof unsub === 'function') ? unsub : null;
      _attachedPath = path;
      // Which tenant the heartbeat is bound to - a support question ("whose
      // bot status is this?") must be answerable without a debugger.
      window.__botStatusPath = path;
      logger.info('BOT', `Listening on ${path}`);
    } catch (err) {
      logger.warn('BOT', `Failed to attach listener: ${err.message}`);
      _setStatus('', 0, true);
    }
  }

  // Frozen-heartbeat guard: re-evaluate liveness locally so a dead worker
  // flips every consumer to OFFLINE even though nothing writes to RTDB.
  // The same tick re-checks WHICH tenant we are bound to - the outlet /
  // business can change after this module evaluated (demo-mode, auth.js, an
  // outlet switch), and a stale binding shows the wrong tenant's heartbeat.
  setInterval(() => {
    if (!_authed) return;
    if (_resolvedPath() !== _attachedPath) _attachListener(true);
    if (_known) _setStatus(_rawStatus, _lastSeen, false);
  }, TICK_MS);

  // Bind to the tenant of the SIGNED-IN admin. Before that we have no business
  // id (BUSINESS_ID() would fall back to the default tenant), so attaching
  // early would read - and display - someone else's bot status.
  window._botOnline = false;
  window._botLastSeen = 0;
  onAuthStateChanged(auth, (user) => {
    _authed = !!user;
    if (_authed) {
      _attachListener(true);
    } else {
      _detachListener();
      _setStatus('', 0, true);
    }
  });

  document.addEventListener('switchOutlet', () => {
    logger.info('BOT', 'Outlet switched, reattaching listener');
    setTimeout(() => _attachListener(true), 100);
  });

  // auth.js announces the resolved tenant (business + outlet) once the admin
  // node is read - re-bind immediately instead of waiting for the next tick.
  document.addEventListener('tenantResolved', () => {
    logger.info('BOT', 'Tenant resolved, reattaching listener');
    _attachListener(true);
  });
}
