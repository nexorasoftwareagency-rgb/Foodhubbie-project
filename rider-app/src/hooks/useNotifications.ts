// === src/hooks/useNotifications.ts ===
import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { subscribeNotifications, markNotificationRead, clearAllNotifications } from "@/services/notificationService";
import { logRiderError } from "@/services/auditService";
import type { RiderNotification } from "@/types";

export function useNotifications() {
  const { user } = useAuthContext();
  const [notifications, setNotifications] = useState<Array<RiderNotification & { id: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    const unsubscribe = subscribeNotifications(
      user.uid,
      (list) => {
        setNotifications(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        logRiderError(user.uid, "subscribeNotifications", err);
      }
    );
    return unsubscribe;
  }, [user?.uid]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markRead = async (id: string) => {
    if (!user?.uid) return;
    await markNotificationRead(user.uid, id);
  };

  const clearAll = async () => {
    if (!user?.uid) return;
    await clearAllNotifications(user.uid);
  };

  return { notifications, unreadCount, loading, markRead, clearAll };
}
