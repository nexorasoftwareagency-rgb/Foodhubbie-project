// === public/firebase-messaging-sw.js ===
// Handles push notifications while the app is closed/backgrounded.
// NOTE: the live roshani-pizza-bot repo doesn't currently ship this file, so FCM
// push may not be wired up server-side yet — included here so the client half is
// ready the moment it is, without blocking anything if it stays unused.
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "FoodHubbie Rider";
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
