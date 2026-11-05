// === src/components/shared/ErrorState.tsx ===
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title = "Something went wrong",
  description = "Please check your connection and try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]">
        <AlertTriangle size={22} />
      </div>
      <p className="text-[13.5px] font-bold text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px] mb-4">{description}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw size={14} /> Try Again
        </Button>
      )}
    </div>
  );
}
