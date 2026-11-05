// === src/components/earnings/GamificationBadge.tsx ===
import { useMemo } from "react";
import { Flame, Trophy, Zap, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiderOrder } from "@/types";

const BADGES = [
  { id: "first_delivery", label: "First Delivery", icon: <Trophy size={16} className="text-[#F59E0B]"/>, threshold: 1, desc: "Complete your first delivery" },
  { id: "five_deliveries", label: "Rising Star", icon: <Flame size={16} className="text-[#F59E0B]"/>, threshold: 5, desc: "Complete 5 deliveries" },
  { id: "ten_deliveries", label: "Pro Rider", icon: <Trophy size={16} className="text-[#10B981]"/>, threshold: 10, desc: "Complete 10 deliveries" },
  { id: "twenty_deliveries", label: "Delivery Master", icon: <Zap size={16} className="text-[#3B82F6]"/>, threshold: 20, desc: "Complete 20 deliveries" },
] as const;

export function GamificationBadge({ orders }: { orders: RiderOrder[] }) {
  const totalOrders = orders.length;
  const todayOrders = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return orders.filter((o) => (o.deliveredAt || 0) >= d.getTime()).length;
  }, [orders]);

  // Simple streak: count consecutive days with at least one delivery
  const streak = useMemo(() => {
    const byDay = new Set<string>();
    orders.forEach((o) => {
      const d = new Date(o.deliveredAt || 0);
      d.setHours(0, 0, 0, 0);
      byDay.add(d.toISOString());
    });
    const days = Array.from(byDay).sort().reverse();
    let streak = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < days.length; i++) {
      const day = new Date(days[i]);
      const expected = new Date(today); expected.setDate(today.getDate() - i);
      if (day.getTime() === expected.getTime()) streak++;
      else break;
    }
    return streak;
  }, [orders]);

  const unlocked = BADGES.filter((b) => totalOrders >= b.threshold);
  const next = BADGES.find((b) => totalOrders < b.threshold);

  return (
    <div className="rounded-[14px] bg-card border border-border/70 p-3 mb-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Trophy size={14} className="text-[#F59E0B]" />
        <b className="text-[12px] font-extrabold uppercase tracking-wide text-muted-foreground">Achievements</b>
      </div>

      <div className="grid grid-cols-2 gap-1.5 mb-3">
        <div className="flex items-center gap-2 px-2 py-2 rounded-[8px] bg-muted/50">
          <Flame size={14} className="text-[#F59E0B]" />
          <div>
            <div className="text-[11px] font-bold">Streak</div>
            <div className="text-[10px] text-muted-foreground">{streak} day{streak !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-2 py-2 rounded-[8px] bg-muted/50">
          <Clock size={14} className="text-[#3B82F6]" />
          <div>
            <div className="text-[11px] font-bold">Today</div>
            <div className="text-[10px] text-muted-foreground">{todayOrders} orders</div>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {BADGES.map((badge) => {
          const isUnlocked = unlocked.includes(badge);
          return (
            <div key={badge.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-[8px] border border-transparent hover:border-border/40 transition-colors">
              <div className="flex items-center gap-2">
                <span className={cn("size-5", isUnlocked ? "text-[#F59E0B] fill-[#F59E0B]" : "text-border/40")}>
                  {badge.icon}
                </span>
                <div>
                  <span className={cn("text-[11px] font-bold", isUnlocked ? "text-[#111827]" : "text-muted-foreground/50")}>
                    {badge.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground/50">{badge.desc}</span>
                </div>
              </div>
              {isUnlocked ? (
                <span className="text-[9px] font-bold text-[#10B981]">Unlocked</span>
              ) : next && next.id === badge.id ? (
                <span className="text-[9px] font-bold text-[#F59E0B]">{totalOrders}/{badge.threshold}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
