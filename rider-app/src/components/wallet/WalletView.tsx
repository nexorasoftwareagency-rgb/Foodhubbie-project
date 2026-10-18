// === src/components/wallet/WalletView.tsx ===
import { useMemo, useState } from "react";
import { History, ScrollText } from "lucide-react";
import { useRiderContext } from "@/contexts/RiderContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { useSettlements } from "@/hooks/useSettlements";
import { EarningsHero } from "@/components/wallet/EarningsHero";
import { OutletBreakdownCards } from "@/components/wallet/OutletBreakdownCards";
import { HistoryCard } from "@/components/orders/HistoryCard";
import { GlassCard } from "@/components/shared/GlassCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SettlementModal } from "@/components/modals/SettlementModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { acknowledgeSettlement } from "@/services/walletService";

export function WalletView() {
  const { user } = useAuthContext();
  const { stats, statsByOutlet } = useRiderContext();
  const { history, loading, error, retry } = useOrderHistory();
  const { settlements } = useSettlements();
  const [settleOpen, setSettleOpen] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [ackLoading, setAckLoading] = useState<string | null>(null);
  const [ackPending, setAckPending] = useState<{ id: string; amount: number } | null>(null);

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

  async function handleAcknowledge() {
    if (!ackPending || !user?.uid) return;
    setAckLoading(ackPending.id);
    try {
      await acknowledgeSettlement({ uid: user.uid, settlementId: ackPending.id });
      setAckOpen(false);
      setAckPending(null);
    } catch {
      toast.error("Could not confirm settlement. Try again.");
    } finally {
      setAckLoading(null);
    }
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

      <div className="mt-4">
        <Button variant="outline" size="block" className="mt-1" onClick={() => setSettleOpen(true)}>
          <History size={15} /> View Settlement History
        </Button>

        {settlements.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Settlements to Confirm</p>
            {settlements.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-[10px] bg-muted border border-border/60">
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold">{s.settledByAdmin}</span>
                  <span className="text-[11px] text-muted-foreground">{s.ordersClearedCount} orders</span>
                </div>
                <div className="text-right">
                  <div className="text-[12px] font-bold">{formatCurrency(s.amountCollected)}</div>
                  <button
                    onClick={() => setAckPending({ id: s.id, amount: s.amountCollected })}
                    disabled={ackLoading === s.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-bold text-primary border border-primary/30 hover:bg-primary/5 disabled:opacity-40"
                  >
                    Confirm Received
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {settlements.length > 0 && (
          <p className="text-center text-[10.5px] text-muted-foreground mt-2.5">
            Last settled: {formatCurrency(settlements[0].amountCollected)}
          </p>
        )}
      </div>

      <SettlementModal open={settleOpen} onOpenChange={setSettleOpen} />

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Settlement</DialogTitle>
            <DialogDescription>
              Confirm you received ₹{ackPending?.amount?.toFixed(0) ?? "0"} in cash from your admin.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4">
            <Button onClick={handleAcknowledge} disabled={ackLoading === ackPending?.id} className="w-full">
              {ackLoading === ackPending?.id ? "Confirming..." : "I Received the Cash"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
