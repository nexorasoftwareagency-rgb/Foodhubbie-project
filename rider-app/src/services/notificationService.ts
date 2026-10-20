// === src/services/notificationService.ts ===
import { db, ref, get, push, update, remove, getMessagingAsync, getToken, deleteToken, onMessage } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import { subscribeCollection } from "./subscribeCollection";
import type { RiderNotification } from "@/types";
import { updateFcmToken } from "@/services/riderService";
import { toast } from "@/hooks/use-toast";

// VAPID key for FCM web push — same key used across all apps
// Generated from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = 'BFHbCr_SScii8rW4StcVhhRvcN188KrtMS0UzKEOtoInLE6w_xzixmjX2rNaXnPcHIH-ged1CjjFjtpJbQeKJoA';

// Background pushes are handled by a dedicated SW at /firebase-messaging-sw/ so the
// app-shell SW (/sw.js) keeps its fetch/offline caching — two workers at "/" would
// replace each other. getToken is bound to that registration explicitly.
const FCM_SW_URL = "/firebase-messaging-sw.js";
const FCM_SW_SCOPE = "/firebase-messaging-sw/";
let _fcmRegistration: Promise<ServiceWorkerRegistration | null> | null = null;
let _onMessageBound = false;
let _lastForegroundKey = "";

function getFcmRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!_fcmRegistration) {
    _fcmRegistration = navigator.serviceWorker
      .register(FCM_SW_URL, { scope: FCM_SW_SCOPE })
      .catch(() => null);
  }
  return _fcmRegistration;
}

export function subscribeNotifications(
  uid: string,
  callback: (notifs: Array<RiderNotification & { id: string }>) => void,
  onError?: (err: Error) => void
) {
  return subscribeCollection<RiderNotification>(
    dbPaths.riderNotifs(uid),
    (list) => {
      const sorted = list
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      callback(sorted as Array<RiderNotification & { id: string }>);
    },
    onError
  );
}

export async function markNotificationRead(uid: string, notifId: string): Promise<void> {
  const notifPath = dbPaths.riderNotifs(uid);
  await update(ref(db, `${notifPath}/${notifId}`), { read: true });
}

export async function clearAllNotifications(uid: string): Promise<void> {
  const notifPath = dbPaths.riderNotifs(uid);
  await remove(ref(db, notifPath));
}

/** Writes a real in-app notification record — used both for locally-detected events
 *  and for foreground FCM pushes, so "Foreground messages create an in-app notification"
 *  is an actual write, not just a console.log. */
export async function createLocalNotification(
  uid: string,
  notif: { title: string; body: string; type?: "info" | "success" | "warning"; icon?: string }
): Promise<void> {
  const notifPath = dbPaths.riderNotifs(uid);
  await push(ref(db, notifPath), {
    title: notif.title,
    body: notif.body,
    type: notif.type || "info",
    icon: notif.icon || "bell",
    read: false,
    timestamp: Date.now(),
  });
}

/** Chrome ignores permission prompts fired on page load (no user gesture), so
 *  wait for the rider's first tap/keypress before asking. */
function requestPermissionOnGesture(): Promise<boolean> {
  if (Notification.permission === "granted") return Promise.resolve(true);
  if (Notification.permission === "denied") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const done = () => {
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("keydown", done);
      Notification.requestPermission().then((p) => resolve(p === "granted")).catch(() => resolve(false));
    };
    window.addEventListener("pointerdown", done, { once: true });
    window.addEventListener("keydown", done, { once: true });
  });
}

/** Registers for push notifications and stores the FCM token on the rider profile. Fails silently if unsupported/denied. */
export async function registerPushNotifications(uid: string): Promise<void> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (!(await requestPermissionOnGesture())) return;

    const messaging = await getMessagingAsync();
    if (!messaging) return;

    const registration = await getFcmRegistration();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      ...(registration ? { serviceWorkerRegistration: registration } : {}),
    }).catch(() => null);

    if (token) {
      await updateFcmToken(uid, token);
    }

    // Bind exactly once per page session — AuthContext re-runs on every auth event.
    if (_onMessageBound) return;
    _onMessageBound = true;
    onMessage(messaging, (payload) => {
      const data = payload?.data || {};
      const title = data.title || payload?.notification?.title || "FoodHubbie Rider";
      const body = data.body || payload?.notification?.body || "";
      // De-dupe: an order update can arrive twice if the sender retries.
      const key = `${data.orderId || ""}|${data.type || ""}|${title}`;
      if (key === _lastForegroundKey) return;
      _lastForegroundKey = key;
      // Foreground pushes don't show a native OS notification by themselves —
      // surface them as both an in-app record (so they persist in the bell menu)
      // and an immediate toast, matching background behavior.
      createLocalNotification(uid, { title, body, type: "info" }).catch(() => {});
      toast.info(title, { description: body });
    });
  } catch {
    // Push notifications are an enhancement, never block the core delivery flow.
  }
}

/** Removes this device's push subscription so a signed-out phone stops receiving
 *  the previous rider's order alerts. Best-effort. */
export async function unregisterPushNotifications(uid?: string): Promise<void> {
  try {
    const messaging = await getMessagingAsync();
    const registration = await getFcmRegistration();
    if (messaging && registration) {
      await deleteToken(messaging).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  try {
    if (uid) await remove(ref(db, `${dbPaths.rider(uid)}/fcmToken`));
  } catch {
    /* ignore — rules may already have revoked access after sign-out */
  }
}

export async function getUnreadCount(uid: string): Promise<number> {
  const notifPath = dbPaths.riderNotifs(uid);
  const snap = await get(ref(db, notifPath));
  const val = snap.val() || {};
  return Object.values(val).filter((n: any) => !n.read).length;
}
