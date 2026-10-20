// === public/firebase-messaging-sw.js ===
// Background push for the rider app. Registered by notificationService.ts with
// scope "/firebase-messaging-sw/" so the app-shell worker (/sw.js, scope "/")
// keeps its caching and the two never replace each other.
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

// The bot sends data-only messages, so the title/body live in `data` — a
// notification payload would make the SDK auto-display its own untagged popup
// and then call this handler, producing duplicates.
messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const title = data.title || payload?.notification?.title || "FoodHubbie Rider";
  const body = data.body || payload?.notification?.body || "";
  const tag = data.orderId ? `order-${data.orderId}-${data.type || "update"}` : `rider-${Date.now()}`;
  return self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
    requireInteraction: data.type === "rider_assigned",
    tag,
    renotify: data.type === "rider_assigned",
    data: {
      orderId: data.orderId || "",
      type: data.type || "",
      url: data.url || (data.type === "rider_assigned" || data.type === "status_change" ? "/active" : "/dashboard"),
    },
  });
});

function targetUrl(data) {
  const path = data.url || "/dashboard";
  try {
    return new URL(path, self.location.origin).href;
  } catch {
    return `${self.location.origin}/dashboard`;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = targetUrl(data);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          if (client.navigate && client.url !== url) {
            return client.navigate(url).then(() => ("focus" in client ? client.focus() : undefined)).catch(() => {});
          }
          return "focus" in client ? client.focus() : undefined;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
