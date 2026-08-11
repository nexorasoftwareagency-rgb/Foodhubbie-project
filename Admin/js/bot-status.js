/**
 * ROSHANI ERP | GLOBAL BOT-STATUS LISTENER
 * Monitors bot/{outlet}/status from Firebase and dispatches a
 * `botStatusChange` custom event so any component can react.
 */
import { Outlet, onValue } from './firebase.js';
import { logger } from './utils/logger.js';

if (!window.__botStatusInit) {
  window.__botStatusInit = true;
  logger.info('BOT', 'Initializing bot status listener');

  let _statusListener = null;
  let _currentRef = null;

  function _dispatch(online, lastSeen) {
    window._botOnline = online;
    window._botLastSeen = lastSeen;
    window.dispatchEvent(new CustomEvent('botStatusChange', {
      detail: { online, lastSeen }
    }));
    logger.info('BOT', `Bot status changed: ${online ? 'ONLINE' : 'OFFLINE'} (last seen: ${lastSeen ? new Date(lastSeen).toLocaleTimeString() : 'never'})`);
  }

  function _attachListener() {
    if (typeof _statusListener === 'function') { try { _statusListener(); } catch (e) {} _statusListener = null; }
    const outlet = Outlet.current;
    try {
      const statusRef = Outlet.ref(`bot/${outlet}/status`);
      if (!statusRef || typeof statusRef.toString !== 'function') {
        throw new Error('Outlet.ref returned invalid reference: ' + typeof statusRef);
      }
      const unsub = onValue(statusRef, (snap) => {
        const val = snap.val() || {};
        const seen = val.lastSeen || 0;
        const fresh = (Date.now() - seen) < 90 * 1000;
        const online = val.status === 'Online' && fresh;
        _dispatch(online, seen);
      }, (err) => {
        logger.warn('BOT', `Listener error: ${err.message}`);
        _dispatch(false, 0);
      });
      _statusListener = (typeof unsub === 'function') ? unsub : null;
    } catch (err) {
      logger.warn('BOT', `Failed to attach listener: ${err.message}`);
      _dispatch(false, 0);
    }
  }

  _attachListener();

  document.addEventListener('switchOutlet', () => {
    logger.info('BOT', 'Outlet switched, reattaching listener');
    if (_statusListener) { _statusListener(); _statusListener = null; }
    setTimeout(_attachListener, 100);
  });
}
