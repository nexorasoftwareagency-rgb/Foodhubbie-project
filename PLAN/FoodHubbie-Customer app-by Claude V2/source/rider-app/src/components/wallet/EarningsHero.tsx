// === src/components/wallet/EarningsHero.tsx ===
import { formatCurrency } from "@/lib/utils";

export function EarningsHero({
  totalEarnings,
  today,
  unsettled,
}: {
  totalEarnings: number;
  today: number;
  unsettled: number;
}) {
  return (
    <div className="rounded-[20px] p-5 bg-gradient-to-br from-[#1E293B] to-[#0F172A] text-white shadow-[0_8px_32px_rgba(0,0,0,0.08)] mb-4">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-white/60">Total Lifetime Earnings</div>
      <div className="text-[30px] font-black mt-1.5 mb-3.5">{formatCurrency(totalEarnings, { decimals: true })}</div>
      <div className="flex gap-5 border-t border-white/10 pt-3">
        <div>
          <div className="text-[10px] text-white/55 font-semibold">Today</div>
          <div className="text-[15px] font-extrabold mt-0.5">{formatCurrency(today)}</div>
        </div>
        <div>
          <div className="text-[10px] text-white/55 font-semibold">Awaiting Settlement</div>
          <div className="text-[15px] font-extrabold mt-0.5">{formatCurrency(unsettled)}</div>
        </div>
      </div>
    </div>
  );
}
