// === src/components/wallet/OutletBreakdownCards.tsx ===
import { formatCurrency } from "@/lib/utils";
import { OUTLETS } from "@/lib/constants";
import type { RiderStats } from "@/types";
import type { OutletId } from "@/lib/constants";

export function OutletBreakdownCards({ statsByOutlet }: { statsByOutlet: Record<OutletId, RiderStats> }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      {OUTLETS.map((o) => {
        const s = statsByOutlet[o.id] || { totalOrders: 0, totalEarnings: 0 };
        return (
          <div key={o.id} className="rounded-[16px] bg-card border border-border/70 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="flex size-8 items-center justify-center rounded-[9px] text-[15px]"
                style={{ background: `${o.color}1A` }}
              >
                {o.icon}
              </span>
              <b className="text-[12.5px] font-extrabold">{o.name}</b>
            </div>
            <div className="text-[17px] font-black" style={{ color: o.color }}>
              {formatCurrency(s.totalEarnings)}
            </div>
            <div className="text-[10.5px] text-muted-foreground font-semibold mt-0.5">{s.totalOrders} orders total</div>
          </div>
        );
      })}
    </div>
  );
}
