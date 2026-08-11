// === src/components/orders/HistoryCard.tsx ===
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { RiderOrder } from "@/types";

export function HistoryCard({ order }: { order: RiderOrder & { outletName: string; outletIcon: string } }) {
  return (
    <div className="rounded-[16px] bg-card border border-border/70 shadow-[var(--shadow-card)] p-3.5 mb-2.5">
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[15px]">{order.outletIcon}</span>
          <div>
            <div className="text-[13px] font-extrabold">{order.outletName}</div>
            <div className="text-[10.5px] font-semibold text-muted-foreground/80 mt-0.5">#{order.id.slice(-8)}</div>
          </div>
        </div>
        <Badge variant="success">Delivered</Badge>
      </div>
      <div className="text-[11px] text-muted-foreground mb-2">{formatDate(order.deliveredAt)}</div>
      <div className="flex items-center justify-between pt-2 border-t border-border/70">
        <span className="text-[10.5px] font-semibold text-muted-foreground">{order.paymentMethod || "CASH"}</span>
        <span className="text-[13.5px] font-extrabold text-[#10B981]">+{formatCurrency(order.deliveryFee)}</span>
      </div>
    </div>
  );
}
