import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import { app, auth, db, ref, update } from './firebase.js';
import { showToast } from '../../shared/dom/modal.js';

let messaging = null;
let fcmInitDone = false;

function getMessagingInstance() {
  if (typeof Capacitor !== 'undefined') return null;
  if (!messaging) {
    try {
      messaging = getMessaging(app);
    } catch (e) {
      console.warn('[FCM] Messaging init failed:', e);
    }
  }
  return messaging;
}

async function storeToken(userId, token) {
  try {
    if (userId) {
      await update(ref(db, `admins/${userId}`), { fcmToken: token });
    }
  } catch (e) {
    console.error('[FCM] Failed to store token:', e);
  }
}

function initFCM() {
  if (fcmInitDone) return;
  const msg = getMessagingInstance();
  if (!msg) return;
  fcmInitDone = true;

  onMessage(msg, (payload) => {
    const data = payload.data || {};
    const title = data.title || payload.notification?.title || 'New Alert';
    const body = data.body || payload.notification?.body || '';
    showToast(`${title}: ${body}`, 'info');
  });
}

initFCM();

// When a new SW takes over, refresh FCM token for the next login
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[FCM] New SW activated, token will refresh on next setup');
  });
}

let _swReg = null;
async function subscribeAndStore(userId) {
  const m = getMessagingInstance();
  if (!m || !userId) return false;
  if ('serviceWorker' in navigator) {
    const reg = _swReg || await navigator.serviceWorker.ready;
    _swReg = reg;
    // Try getToken — works if subscription already exists
    try {
      const token = await getToken(m, { serviceWorkerRegistration: reg });
      if (token) { await storeToken(userId, token); return true; }
    } catch (e) {
      // store error details for debug
      console.warn('[FCM] getToken error:', e?.code, e?.message, e);
    }
  } else {
    try {
      const token = await getToken(m);
      if (token) { await storeToken(userId, token); return true; }
    } catch (e) {
      console.warn('[FCM] getToken error (no SW):', e?.code, e?.message, e);
    }
  }
  return false;
}

export async function setupAdminFCM(userId) {
  if (!('Notification' in window) || !userId) return;
  // Pre-cache SW registration
  if ('serviceWorker' in navigator && !_swReg) {
    navigator.serviceWorker.ready.then(r => { _swReg = r; });
  }
  try {
    const gotToken = await subscribeAndStore(userId);
    if (gotToken) return;
    // register click handler for gesture
    const onClick = () => {
      document.removeEventListener('click', onClick);
      const doSubscribe = () => { subscribeAndStore(userId); };
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(p => {
          if (p === 'granted') doSubscribe();
        });
      } else {
        doSubscribe();
      }
    };
    document.addEventListener('click', onClick, { once: true });
  } catch (e) {
    console.error('[FCM] Setup error:', e);
  }
}

export async function refreshFCMToken(userId) {
  await subscribeAndStore(userId);
}
