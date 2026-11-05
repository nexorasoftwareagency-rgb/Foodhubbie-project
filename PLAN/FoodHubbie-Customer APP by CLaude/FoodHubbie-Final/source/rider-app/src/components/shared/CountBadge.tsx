// === src/components/shared/CountBadge.tsx ===
import { cn } from "@/lib/utils";

export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-destructive text-white text-[9px] font-extrabold min-w-[15px] h-[15px] px-1",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
