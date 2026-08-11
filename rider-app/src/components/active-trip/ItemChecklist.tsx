// === src/components/active-trip/ItemChecklist.tsx ===
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderItem } from "@/types";

export function ItemChecklist({ items }: { items: OrderItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-2.5 text-[12.5px] font-bold"
      >
        <span>View Items ({items.length})</span>
        <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mb-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border/70 last:border-0 text-[12.5px]">
              <span>{item.name}</span>
              <span className="font-bold text-muted-foreground">&times;{item.quantity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
