// === src/components/orders/DemandIndicator.tsx ===
import { useMemo } from "react";
import { Flame, MapPin } from "lucide-react";
import type { AvailableOrder } from "@/types";

export function DemandIndicator({ orders }: { orders: AvailableOrder[] }) {
  const byOutlet = useMemo(() => {
    const counts: Record<string, { count: number; totalFee: number }> = {};
    orders.forEach((o) => {
      if (!counts[o.outlet]) counts[o.outlet] = { count: 0, totalFee: 0 };
      counts[o.outlet].count += 1;
      counts[o.outlet].totalFee += o.deliveryFee || 0;
    });
    return Object.entries(counts).sort((a, b) => b[1].count - a[1].count);
  }, [orders]);

  if (byOutlet.length === 0) return null;

  const maxCount = Math.max(...byOutlet.map(([, v]) => v.count));

  return (
    <div className="rounded-[14px] bg-card border border-border/70 p-3 mb-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Flame size={14} className="text-[#EF4444]" />
        <b className="text-[12px] font-extrabold uppercase tracking-wide text-muted-foreground">Demand by Outlet</b>
      </div>
      <div className="space-y-1.5">
        {byOutlet.map(([outletId, data]) => {
          const intensity = Math.round((data.count / maxCount) * 100);
          return (
            <div key={outletId} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin size={10} className="text-[#EF4444]/60" />
                <span className="text-[11px] font-semibold">{outletId.charAt(0).toUpperCase() + outletId.slice(1)} Outlet</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-[120px] rounded-full bg-border/40 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, #F59E0B ${intensity}%, #E5E7EB ${intensity}%)`,
                      width: `${Math.min(intensity, 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[11px] font-bold text-[#EF4444]">{data.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
