// === src/components/wallet/WalletView.tsx ===
import { useMemo, useState } from "react";
import { History, ScrollText } from "lucide-react";
import { useRiderContext } from "@/contexts/RiderContext";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { useSettlements } from "@/hooks/useSettlements";
import { EarningsHero } from "@/components/wallet/EarningsHero";
import { OutletBreakdownCards } from "@/components/wallet/OutletBreakdownCards";
import { HistoryCard } from "@/components/orders/HistoryCard";
import { GlassCard } from "@/components/shared/GlassCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { SettlementModal } from "@/components/modals/SettlementModal";
import { formatCurrency } from "@/lib/utils";

export function WalletView() {
  const { stats, statsByOutlet } = useRiderContext();
  const { history, loading, error, retry } = useOrderHistory();
  const { settlements } = useSettlements();
  const [settleOpen, setSettleOpen] = useState(false);

  const todayTotal = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return history.filter((o) => (o.deliveredAt || 0) >= start.getTime()).reduce((s, o) => s + (o.deliveryFee || 0), 0);
  }, [history]);

  // Roshani has no ledger with a running balance — "awaiting settlement" is derived
  // honestly from real data: lifetime earnings minus everything an admin has already
  // settled with the rider.
  const unsettled = useMemo(() => {
    const settledTotal = settlements.reduce((s, x) => s + (x.amountCollected || 0), 0);
    return Math.max(0, stats.totalEarnings - settledTotal);
  }, [settlements, stats.totalEarnings]);

  if (loading) return <LoadingSpinner fullscreen label="Loading your earnings..." />;
  if (error) {
    return <ErrorState title="Couldn't load your earnings" description="Check your connection and try again." onRetry={retry} />;
  }

  return (
    <div className="px-3.5 pt-4 pb-6">
      <EarningsHero totalEarnings={stats.totalEarnings} today={todayTotal} unsettled={unsettled} />
      <OutletBreakdownCards statsByOutlet={statsByOutlet} />

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13.5px] font-extrabold flex items-center gap-1.5">
          <ScrollText size={15} /> Recent Deliveries
        </h3>
      </div>

      {history.length === 0 ? (
        <GlassCard>
          <EmptyState icon={<ScrollText />} title="No deliveries yet" description="Completed deliveries will appear here." />
        </GlassCard>
      ) : (
        history.slice(0, 8).map((o) => <HistoryCard key={o.id} order={o} />)
      )}

      <Button variant="outline" size="block" className="mt-1" onClick={() => setSettleOpen(true)}>
        <History size={15} /> View Settlement History
      </Button>

      {settlements.length > 0 && (
        <p className="text-center text-[10.5px] text-muted-foreground mt-2.5">
          Last settled: {formatCurrency(settlements[0].amountCollected)}
        </p>
      )}

      <SettlementModal open={settleOpen} onOpenChange={setSettleOpen} />
    </div>
  );
}
