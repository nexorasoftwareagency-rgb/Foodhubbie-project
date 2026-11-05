// === src/components/earnings/SummaryGrid.tsx ===
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/utils";
import { WEEKLY_EARNINGS_TARGET } from "@/lib/constants";

export function SummaryGrid({
  unsettled,
  weeklyTotal,
  onViewSettlements,
}: {
  unsettled: number;
  weeklyTotal: number;
  onViewSettlements: () => void;
}) {
  const pct = Math.min(100, Math.round((weeklyTotal / WEEKLY_EARNINGS_TARGET) * 100));
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <div className="rounded-[14px] bg-card border border-border/70 p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Awaiting Settlement</div>
        <div className="text-[16px] font-extrabold mt-1 mb-2">{formatCurrency(unsettled)}</div>
        <button onClick={onViewSettlements} className="text-[10.5px] font-bold text-primary">
          View History &rarr;
        </button>
      </div>
      <div className="rounded-[14px] bg-card border border-border/70 p-3.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Weekly Target</div>
        <div className="text-[16px] font-extrabold mt-1 mb-2">{pct}%</div>
        <Progress value={pct} indicatorClassName="bg-[#10B981]" />
      </div>
    </div>
  );
}
