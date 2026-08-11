// === src/components/modals/NotificationSheet.tsx ===
import { Bell } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { ClearAllButton } from "@/components/notifications/ClearAllButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

export function NotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, loading, markRead, clearAll } = useNotifications();

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#0F1720]/50 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed top-0 right-0 bottom-0 z-41 flex flex-col bg-card shadow-[var(--shadow-premium)] transition-transform duration-300 w-[300px] max-w-[82vw]",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <b className="text-[14.5px] font-extrabold">Notifications</b>
          <div className="flex items-center gap-3.5">
            <ClearAllButton onClick={clearAll} disabled={notifications.length === 0} />
            <button onClick={onClose} className="text-lg leading-none text-muted-foreground">
              &times;
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4">
          {!loading && notifications.length === 0 && (
            <EmptyState icon={<Bell />} title="No notifications yet" description="Updates about settlements, documents, and platform news show up here." />
          )}
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} onClick={() => !n.read && markRead(n.id)} />
          ))}
        </div>
      </aside>
    </>
  );
}
