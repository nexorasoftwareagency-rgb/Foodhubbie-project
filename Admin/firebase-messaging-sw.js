// Firebase Messaging Service Worker
// This file is required by Firebase SDK — it auto-registers from /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85"
});

const fcmMessaging = firebase.messaging();

fcmMessaging.onBackgroundMessage((payload) => {
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
