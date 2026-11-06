// === src/pages/NotificationsPage.tsx ===
import { useState, useEffect } from "react";
import { Bell, CheckCircle2, AlertTriangle } from "lucide-react";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { ClearAllButton } from "@/components/notifications/ClearAllButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

export function NotificationsPage() {
  const { user } = useAuthContext();
  const { notifications, loading, markRead, clearAll, unreadCount } = useNotifications();
  const [filter, setFilter] = useState<"all" | "order" | "promo">("all");

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "order") return n.type === "order";
    if (filter === "promo") return n.type !== "order";
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[20px] font-extrabold">Notifications</h2>
          <div className="flex items-center gap-2">
            <ClearAllButton
              onClick={clearAll}
              disabled={notifications.length === 0}
            />
          </div>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-0.5">
          Stay updated on your orders and promotions
        </div>
      </div>

      {/* Filter chips */}
      <div className="promo-filter px-3.5 pb-2">
        <button
          type="button"
          className={`promo-filter-chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`promo-filter-chip ${filter === "order" ? "active" : ""}`}
          onClick={() => setFilter("order")}
        >
          Orders
        </button>
        <button
          type="button"
          className={`promo-filter-chip ${filter === "promo" ? "active" : ""}`}
          onClick={() => setFilter("promo")}
        >
          Offers
        </button>
      </div>

      {/* Notifications list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && filteredNotifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <Bell size={48} className="text-muted-foreground/20 mb-3" />
            <p className="text-[13.5px] font-bold text-foreground">No notifications yet</p>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Order updates and special offers will appear here.
            </p>
          </div>
        )}

        {!loading && filteredNotifications.length > 0 && (
          <div className="notif-inbox">
            {filteredNotifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={{ ...n, id: n.id }}
                onClick={() => {
                  if (!n.read) {
                    markRead(n.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}