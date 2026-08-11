// === public/firebase-messaging-sw.js ===
// Handles push notifications while the app is closed/backgrounded.
// NOTE: the live roshani-pizza-bot repo doesn't currently ship this file, so FCM
// push may not be wired up server-side yet — included here so the client half is
// ready the moment it is, without blocking anything if it stays unused.
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDcx-SN5eak8PAs-8NtTGelJ_sICr5yb7Y",
  authDomain: "prashant-pizza-e86e4.firebaseapp.com",
  databaseURL: "https://prashant-pizza-e86e4-default-rtdb.firebaseio.com",
  projectId: "prashant-pizza-e86e4",
  storageBucket: "prashant-pizza-e86e4.firebasestorage.app",
  messagingSenderId: "857471482885",
  appId: "1:857471482885:web:9eb8bbb90c77c588fbb06c",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Roshani Rider";
  const options = {
    body: payload?.notification?.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload?.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/dashboard");
    })
  );
});
