// === src/components/profile/DetailRow.tsx ===
import type { ReactNode } from "react";

export function DetailRow({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-border/70 last:border-0">
      <span className="text-[11.5px] font-semibold text-muted-foreground">{label}</span>
      <span className="text-[12.5px] font-bold text-right flex items-center gap-2">
        {value}
        {action}
      </span>
    </div>
  );
}
