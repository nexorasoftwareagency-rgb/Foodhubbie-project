// === src/components/profile/AadharCard.tsx ===
import { useState } from "react";
import { maskAadhar, cn } from "@/lib/utils";

export function AadharCard({ aadharNo, aadharPhoto }: { aadharNo: string; aadharPhoto?: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between py-3.5 border-b border-border/70">
        <span className="text-[11.5px] font-semibold text-muted-foreground">Aadhar No.</span>
        <span className="text-[12.5px] font-bold">{revealed ? aadharNo : maskAadhar(aadharNo)}</span>
      </div>
      <div className="flex items-center justify-between py-3.5">
        <span className="text-[11.5px] font-semibold text-muted-foreground">Aadhar Image</span>
        <button onClick={() => setRevealed((r) => !r)} className="text-[10.5px] font-bold text-primary">
          {revealed ? "HIDE" : "SHOW"}
        </button>
      </div>
      {revealed && (
        <div className={cn("mt-1 h-[110px] rounded-xl overflow-hidden bg-muted flex items-center justify-center")}>
          {aadharPhoto ? (
            <img src={aadharPhoto} alt="Aadhar card" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-muted-foreground">No Aadhar image uploaded</span>
          )}
        </div>
      )}
    </div>
  );
}
