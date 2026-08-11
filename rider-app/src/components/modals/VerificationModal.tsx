// === src/components/modals/VerificationModal.tsx ===
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrderItem } from "@/types";

export function VerificationModal({
  open,
  onOpenChange,
  items,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OrderItem[];
  onConfirm: () => void;
  loading?: boolean;
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (open) setChecked({});
  }, [open]);

  const allChecked = items.every((_, i) => checked[i]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Verify Items</SheetTitle>
          <SheetDescription>Check every item against the bill before you pick up the bag.</SheetDescription>
        </SheetHeader>
        <div className="px-5 pb-2 max-h-[280px] overflow-y-auto">
          {items.map((item, i) => (
            <div
              key={i}
              onClick={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
              className="flex items-center gap-2.5 py-2.5 border-b border-border/70 last:border-0 cursor-pointer"
            >
              <div
                className={cn(
                  "flex size-[19px] shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors",
                  checked[i] ? "bg-[#10B981] border-[#10B981] text-white" : "border-border"
                )}
              >
                {checked[i] && <Check size={12} strokeWidth={3} />}
              </div>
              <span className="flex-1 text-[12.5px]">{item.name}</span>
              <span className="text-[11.5px] font-bold text-muted-foreground">&times;{item.quantity}</span>
            </div>
          ))}
        </div>
        <SheetFooter>
          <Button size="block" disabled={!allChecked || loading} onClick={onConfirm}>
            {loading ? "Confirming..." : allChecked ? "ORDER PICKED UP" : `Check all ${items.length} items to continue`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
