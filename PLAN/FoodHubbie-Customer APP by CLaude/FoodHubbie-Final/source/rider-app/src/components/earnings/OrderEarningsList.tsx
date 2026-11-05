// === src/components/earnings/OrderEarningsList.tsx ===
import { Clock, DollarSign, Tag, Phone } from "lucide-react";
import { formatCurrency, formatDate, formatOrderId } from "@/lib/utils";
import { getOutletMeta } from "@/lib/constants";
import type { RiderOrder } from "@/types";

const todayStart = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

export function OrderEarningsList({
  orders,
  unsettled,
}: {
  orders: RiderOrder[];
  unsettled: number;
}) {
  const todayOrders = orders.filter((o) => (o.deliveredAt || 0) >= todayStart);
  const todayTotal = todayOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-2 mb-1">
        <h3 className="text-[12px] font-extrabold uppercase tracking-wide text-muted-foreground">Order Earnings Breakdown</h3>
        <span className="text-[11px] font-bold text-[#10B981]">{formatCurrency(todayTotal)} today</span>
      </div>

      {orders.length === 0 ? (
        <div className="px-3 py-8 text-center text-muted-foreground text-[12px]">
          <Clock size={20} className="mx-auto mb-2 opacity-40" />
          <p>No completed deliveries yet</p>
        </div>
      ) : (
        orders.map((order) => {
          const meta = getOutletMeta(order.outlet || "pizza");
          const isToday = (order.deliveredAt || 0) >= todayStart;
          return (
            <div key={order.id} className="flex items-center justify-between px-3 py-2.5 rounded-[10px] border border-border/60 bg-card hover:bg-muted/30 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--primary-light)] text-primary text-[10px] font-extrabold">
                    {meta.icon}
                  </span>
                  <span className="text-[11px] font-bold text-truncate">{order.customerName || "Customer"}</span>
                  {isToday && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#10B981]/10 text-[#10B981] text-[9px] font-bold">
                      Today
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Tag size={12} className="mr-0.5" />
                  <span>#{formatOrderId(order.id)}</span>
                  <span className="px-1">·</span>
                  <span>{formatDate(order.deliveredAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-right">
                <div className="text-[11px] font-bold">
                  {formatCurrency(order.deliveryFee || 0)}
                </div>
                <div className="text-[9.5px] text-muted-foreground">
                  {order.paymentMethod || "CASH"}
                </div>
              </div>
              <button
                className="flex size-6 shrink-0 items-center justify-center rounded-[7px] text-primary/60 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                title="Call customer"
              >
                <Phone size={14} />
              </button>
            </div>
          );
        })
      )}

      {unsettled > 0 && (
        <div className="mt-2 px-3 py-2 rounded-[10px] bg-[#FEF3C7]/50 border border-[#FDE68A]/40">
          <div className="flex justify-between items-center">
            <div className="text-[10.5px] font-bold text-[#92400E] flex items-center gap-1">
              <DollarSign size={12} className="mr-1" />
              Awaiting Settlement
            </div>
            <div className="text-[12px] font-black text-[#92400E]">{formatCurrency(unsettled)}</div>
          </div>
          <div className="text-[9px] text-[#92400E] mt-1">
            Confirm receipt from your admin to mark as settled.
          </div>
        </div>
      )}
    </div>
  );
}
