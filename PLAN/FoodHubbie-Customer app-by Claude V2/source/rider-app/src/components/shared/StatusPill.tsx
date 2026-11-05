// === src/components/shared/StatusPill.tsx ===
import { cn } from "@/lib/utils";
import type { RiderStatus } from "@/types";

export function StatusPill({
  status,
  onClick,
  loading,
}: {
  status: RiderStatus;
  onClick?: () => void;
  loading?: boolean;
}) {
  const online = status === "Online";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold tracking-wide transition-colors disabled:opacity-60",
        online ? "bg-[#10B981]/12 text-[#0B815A]" : "bg-[#F1F3F5] text-[#7C8798]"
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          online ? "bg-[#10B981] animate-pulse-dot" : "bg-[#7C8798]"
        )}
      />
      {online ? "ONLINE" : "OFFLINE"}
    </button>
  );
}
