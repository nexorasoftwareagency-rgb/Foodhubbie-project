// === src/components/shared/GlassCard.tsx ===
import * as React from "react";
import { cn } from "@/lib/utils";

/** Glassmorphism card wrapper — backdrop-filter: blur(12px) per PRD §5.3 */
export function GlassCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("glass-surface rounded-[16px] p-4 shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}
