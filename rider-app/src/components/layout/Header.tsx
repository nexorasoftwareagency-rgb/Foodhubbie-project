// === src/components/layout/Header.tsx ===
import { useState } from "react";
import { Menu, Bell, RefreshCw } from "lucide-react";
import { useRiderContext } from "@/contexts/RiderContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { useNotifications } from "@/hooks/useNotifications";
import { useRefreshAction } from "@/hooks/useRefreshAction";
import { StatusPill } from "@/components/shared/StatusPill";
import { CountBadge } from "@/components/shared/CountBadge";

export function Header({ onMenuClick, onNotifClick }: { onMenuClick: () => void; onNotifClick: () => void }) {
  const { isOnline, toggleOnline } = useRiderContext();
  const { locationError } = useLocationContext();
  const { unreadCount } = useNotifications();
  const refresh = useRefreshAction();
  const [spinning, setSpinning] = useState(false);

  async function handleRefresh() {
    setSpinning(true);
    await refresh();
    setSpinning(false);
  }

  return (
    <header className="flex flex-col sticky top-0 z-20 bg-card border-b border-border">
      <div className="flex items-center gap-2.5 px-3.5" style={{ height: "var(--header-height)" }}>
        <button
          onClick={onMenuClick}
          className="flex size-9 items-center justify-center rounded-[10px] bg-muted text-foreground active:bg-border"
        >
          <Menu size={18} />
        </button>

        <div className="flex-1 min-w-0">
          <b className="block text-[13px] font-extrabold tracking-tight truncate">ROSHANI</b>
          <span className="block text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
            Pizza &amp; Cake Rider
          </span>
        </div>

        <button
          onClick={handleRefresh}
          className="flex size-9 items-center justify-center rounded-[10px] bg-muted text-foreground active:bg-border"
        >
          <RefreshCw size={16} className={spinning ? "animate-spin" : ""} />
        </button>

        <button
          onClick={onNotifClick}
          className="relative flex size-9 items-center justify-center rounded-[10px] bg-muted text-foreground active:bg-border"
        >
          <Bell size={16} />
          {unreadCount > 0 && <CountBadge count={unreadCount} className="absolute -top-1 -right-1" />}
        </button>

        <StatusPill status={isOnline ? "Online" : "Offline"} onClick={toggleOnline} />
      </div>

      {isOnline && locationError === "denied" && (
        <div className="flex items-center gap-1.5 bg-[#FEF0F0] text-[#B91C1C] text-[10.5px] font-bold px-3.5 py-1.5">
          📍 Location permission denied — enable it in your browser to accept orders.
        </div>
      )}
    </header>
  );
}
