// === src/components/modals/PaymentSheet.tsx ===
import { useState } from "react";
import { Banknote, Smartphone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/lib/utils";

export function PaymentSheet({
  open,
  onOpenChange,
  total,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  onConfirm: (method: "CASH" | "UPI") => void;
  loading?: boolean;
}) {
  const [method, setMethod] = useState<"CASH" | "UPI">("CASH");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Collect Payment</SheetTitle>
        </SheetHeader>
        <div className="px-5 pt-1 text-center">
          <div className="text-[11px] font-semibold text-muted-foreground">Total to collect</div>
          <div className="text-[30px] font-black mt-1 mb-5">{formatCurrency(total)}</div>
          <div className="flex gap-3 mb-2">
            <button
              onClick={() => setMethod("CASH")}
              className={cn(
                "flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 py-4.5 transition-colors",
                method === "CASH" ? "border-primary bg-[var(--primary-light)]" : "border-border"
              )}
            >
              <Banknote size={22} className="text-[#10B981]" />
              <span className="text-[12px] font-bold">CASH</span>
            </button>
            <button
              onClick={() => setMethod("UPI")}
              className={cn(
                "flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 py-4.5 transition-colors",
                method === "UPI" ? "border-primary bg-[var(--primary-light)]" : "border-border"
              )}
            >
              <Smartphone size={22} className="text-[#3B82F6]" />
              <span className="text-[12px] font-bold">UPI</span>
            </button>
          </div>
        </div>
        <SheetFooter>
          <Button size="block" onClick={() => onConfirm(method)} disabled={loading}>
            {loading ? "Confirming..." : "CONFIRM PAYMENT COLLECTED"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
