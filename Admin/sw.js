// Fail-fast if not on HTTPS
if (self.location.protocol !== 'https:' && self.location.hostname !== 'localhost' && self.location.hostname !== '127.0.0.1') {
  throw new Error('Service Worker requires HTTPS');
}

// Firebase FCM background messaging
importScripts(
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js'
);
firebase.initializeApp({
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85"
});
firebase.messaging().onBackgroundMessage((payload) => {
  const data = payload.data || {};
  self.registration.showNotification(
    data.title || payload.notification?.title || 'New Order Alert',
    {
      body: data.body || payload.notification?.body || 'Open dashboard to view details.',
      icon: './icon-erp-logo.jpeg',
      badge: './icon-erp-logo.jpeg',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      tag: `order-${data.orderId || Date.now()}`,
      data: { url: './index.html' }
    }
  );
});

// This SW handles caching, navigation, and offline support only.

const CACHE_NAME = 'foodhubbie-erp-shell-v5.4.0';
const ASSETS_TO_CACHE = [
  './index.html',
  './style.css?v=5.3.29',
  './mobile-overrides.css?v=5.3.29',
  './branding.js?v=5.3.29',
  './firebase-config.js?v=5.3.29',
  './receipt-templates.js?v=5.3.29',
  './manifest.json',
  './icon-erp-logo.jpeg',
  './sw.js',
  './firebase-messaging-sw.js',
  './js/main.js?v=5.3.29',
  './js/auth.js',
  './js/firebase.js',
  './js/state.js',
  './js/ui.js',
  './js/ui-utils.js',
  './js/utils.js',
  './js/pwa.js',
  './js/gestures.js',
  './js/features/orders.js',
  './js/features/riders.js',
  './js/features/catalog.js',
  './js/features/customers.js',
  './js/features/analytics.js',
  './js/features/analytics-mobile.js',
  './js/features/lost-sales.js',
  './js/features/pos.js',
  './js/features/settings.js',
  './js/features/tracker.js',
  './js/features/feedback.js',
  './js/features/notifications.js',
  './js/fcm-init.js',
  './js/features/printing.js',
  './js/features/rider-analytics.js',
  './js/features/inventory.js',
  './js/features/discounts.js',
  './js/features/discount-evaluator.js',
  './js/features/discountsReports.js',
  './js/features/promotions.js',
  './js/features/promotions-guide.js',
  './assets/sounds/alert.mp3'
];

// 1. Install Event: Cache UI Assets (per-asset resilience)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS_TO_CACHE) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('[SW] Failed to cache:', url);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event
//   - CDN assets (unpkg, cdn.jsdelivr, cdnjs): Cache-First (offline-friendly)
//   - Firebase RTDB / Auth: bypass (always live)
//   - All other GETs (our own app code: index.html, JS, CSS, JSON, etc.):
//       Network-Only. We deliberately do NOT consult the cache for app code,
//       because a stale cache can serve old modules that reference renamed
//       files (e.g. discounts-reports.js -> discountsReports.js) and break
//       dynamic imports. The app already requires auth + Firebase, so it
//       can't function offline anyway.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  // Skip Firebase Realtime Database calls (must be live)
  if (event.request.url.includes('firebaseio.com')) return;
  // Skip Firebase Auth calls
  if (event.request.url.includes('identitytoolkit.googleapis.com')) return;
  if (event.request.url.includes('securetoken.googleapis.com')) return;

  // Cache-First for immutable CDN assets (faster load, works offline)
  const isCDN = event.request.url.includes('unpkg.com') ||
                event.request.url.includes('cdn.jsdelivr.net') ||
                event.request.url.includes('cdnjs.cloudflare.com');

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
        if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate for our own app code (HTML, JS, CSS, etc.).
  // All files are versioned (?v=5.3.29) so new deploy = new cache entry.
  // Cache-first: serve instantly, then update cache from network in background.
  // This avoids re-downloading on every page load (~0ms for cached files).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Notification click: open admin dashboard
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './index.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    for (const c of clientList) {
      if (c.url === url && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
