// === src/components/dashboard/PerformanceGrid.tsx ===
import { CheckCircle2, CalendarDays, Wallet, Star } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { formatCurrency } from "@/lib/utils";
import { useEarnings } from "@/hooks/useEarnings";
import { useRiderContext } from "@/contexts/RiderContext";

export function PerformanceGrid() {
  const { todayTotal, todayOrderCount, weekly } = useEarnings();
  const { rider } = useRiderContext();

  // Roshani's schema has no per-order estimatedMinutes field (verified against
  // app.js), so an on-time % can't be honestly computed the way FoodHubbie's can.
  // This week's real earnings total is shown instead — equally useful, not fabricated.
  const weekTotal = weekly.reduce((s, d) => s + d.v, 0);

  return (
    <div className="grid grid-cols-2 gap-2.5 my-4">
      <StatCard color="green" icon={<CheckCircle2 size={18} />} value={String(todayOrderCount)} label="Delivered Today" />
      <StatCard
        color="blue"
        icon={<CalendarDays size={18} />}
        value={weekTotal > 0 ? formatCurrency(weekTotal) : "\u2014"}
        label="This Week"
      />
      <StatCard color="orange" icon={<Wallet size={18} />} value={formatCurrency(todayTotal)} label="Today's Earnings" />
      <StatCard
        color="gold"
        icon={<Star size={18} />}
        value={rider?.rating ? rider.rating.toFixed(1) : "New"}
        label="Rider Rating"
      />
    </div>
  );
}
