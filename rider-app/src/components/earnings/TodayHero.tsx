// === src/components/earnings/TodayHero.tsx ===
import { formatCurrency } from "@/lib/utils";

export function TodayHero({ total, orders, onlineHours }: { total: number; orders: number; onlineHours: number }) {
  return (
    <div className="rounded-[20px] p-4.5 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-[var(--shadow-premium)] mb-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-wide opacity-90">Today's Earnings</div>
      <div className="text-[28px] font-black mt-1.5 mb-2.5">{formatCurrency(total, { decimals: true })}</div>
      <div className="flex gap-4.5 text-[11.5px] font-bold opacity-95">
        <span>{orders} Orders</span>
        <span>{onlineHours > 0 ? `${onlineHours} hrs online (this session)` : "Not online yet today"}</span>
      </div>
    </div>
  );
}
