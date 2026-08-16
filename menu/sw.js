const CACHE_NAME = 'menu-shell-v12';
const ASSETS = [
  './index.html',
  './delivery.html',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/session.js',
  './js/order.js',
  './js/firebase.js',
  './js/discount.js',
  './js/cart.js',
  './js/delivery.js',
  './js/delivery-order.js',
  './js/geo.js',
  './manifest.json',
  './sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of ASSETS) {
        try { await cache.add(url); } catch (e) { console.warn('[SW] Failed to cache:', url); }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  if (new URL(event.request.url).origin !== location.origin) return; // ponytail: app-shell caching only — CDN (gstatic) is out of CSP connect-src
  if (event.request.url.includes('firebaseio.com')) return;
  if (event.request.url.includes('identitytoolkit.googleapis.com')) return;
  if (event.request.url.includes('securetoken.googleapis.com')) return;

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
