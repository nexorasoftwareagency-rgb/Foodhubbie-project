// === src/services/notificationService.ts ===
import { db, ref, get, push, update, remove, onValue, off, getMessagingInstance, getToken, onMessage } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import type { RiderNotification } from "@/types";
import { updateFcmToken } from "@/services/riderService";
import { toast } from "@/hooks/use-toast";

const VAPID_KEY = ""; // Set via Firebase console → Project Settings → Cloud Messaging → Web Push certificates

export function subscribeNotifications(
  uid: string,
  callback: (notifs: Array<RiderNotification & { id: string }>) => void,
  onError?: (err: Error) => void
) {
  const notifRef = ref(db, dbPaths.riderNotifs(uid));
  const handler = onValue(
    notifRef,
    (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val)
        .map(([id, n]) => ({ id, ...(n as RiderNotification) }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      callback(list);
    },
    (err) => onError?.(err as unknown as Error)
  );
  return () => off(notifRef, "value", handler);
}

export async function markNotificationRead(uid: string, notifId: string): Promise<void> {
  await update(ref(db, `${dbPaths.riderNotifs(uid)}/${notifId}`), { read: true });
}

export async function clearAllNotifications(uid: string): Promise<void> {
  await remove(ref(db, dbPaths.riderNotifs(uid)));
}

/** Writes a real in-app notification record — used both for locally-detected events
 *  and for foreground FCM pushes, so "Foreground messages create an in-app notification"
 *  is an actual write, not just a console.log. */
export async function createLocalNotification(
  uid: string,
  notif: { title: string; body: string; type?: "info" | "success" | "warning"; icon?: string }
): Promise<void> {
  await push(ref(db, dbPaths.riderNotifs(uid)), {
    title: notif.title,
    body: notif.body,
    type: notif.type || "info",
    icon: notif.icon || "bell",
    read: false,
    timestamp: Date.now(),
  });
}

/** Registers for push notifications and stores the FCM token on the rider profile. Fails silently if unsupported/denied. */
export async function registerPushNotifications(uid: string): Promise<void> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const messaging = getMessagingInstance();
    if (!messaging) return;

    const registration = await navigator.serviceWorker.ready.catch(() => undefined);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: registration,
    }).catch(() => null);

    if (token) {
      await updateFcmToken(uid, token);
    }

    onMessage(messaging, (payload) => {
      const title = payload?.notification?.title || "Roshani Rider";
      const body = payload?.notification?.body || "";
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

export async function getUnreadCount(uid: string): Promise<number> {
  const snap = await get(ref(db, dbPaths.riderNotifs(uid)));
  const val = snap.val() || {};
  return Object.values(val).filter((n: any) => !n.read).length;
}
