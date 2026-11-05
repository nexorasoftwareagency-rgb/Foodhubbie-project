// === src/components/notifications/NotificationItem.tsx ===
import { Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { getRelativeTime, cn } from "@/lib/utils";
import type { RiderNotification } from "@/types";

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle };
const STYLES = {
  info: "bg-[#EAF2FF] text-[#3B82F6]",
  success: "bg-[#E7F7EF] text-[#10B981]",
  warning: "bg-[#FEF6E7] text-[#F59E0B]",
};

export function NotificationItem({
  notification,
  onClick,
}: {
  notification: RiderNotification & { id: string };
  onClick?: () => void;
}) {
  const Icon = ICONS[notification.type] || Info;
  return (
    <div onClick={onClick} className="relative flex gap-2.5 py-3 border-b border-border/70 last:border-0 cursor-pointer">
      <div className={cn("flex size-8.5 shrink-0 items-center justify-center rounded-[10px]", STYLES[notification.type])}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <b className="block text-[12px] font-bold">{notification.title}</b>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{notification.body}</p>
        <span className="block text-[9.5px] text-muted-foreground/70 mt-1">{getRelativeTime(notification.timestamp)}</span>
      </div>
      {!notification.read && <span className="absolute top-3.5 right-0 size-1.5 rounded-full bg-destructive" />}
    </div>
  );
}
