// === src/components/modals/SettlementModal.tsx ===
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSettlements } from "@/hooks/useSettlements";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { History } from "lucide-react";

export function SettlementModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settlements, loading } = useSettlements();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="pt-4">
          <DialogTitle>Settlement History</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 max-h-[340px] overflow-y-auto">
          {loading ? (
            <LoadingSpinner label="Loading..." />
          ) : settlements.length === 0 ? (
            <EmptyState icon={<History />} title="No settlements yet" description="Cash settlements by your admin will show up here." />
          ) : (
            settlements.map((s) => (
              <div key={s.id} className="py-2.5 border-b border-border/70 last:border-0">
                <div className="flex justify-between text-[12.5px] font-bold">
                  <span>Settled by Admin &mdash; {s.settledByAdmin}</span>
                  <span>{formatCurrency(s.amountCollected)}</span>
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">
                  {s.ordersClearedCount} orders cleared &middot; {formatDate(s.timestamp)}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
