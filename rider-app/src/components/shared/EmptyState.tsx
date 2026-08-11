// === src/components/shared/EmptyState.tsx ===
import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-6 text-muted-foreground", className)}>
      {icon && <div className="mb-3 text-4xl opacity-50">{icon}</div>}
      <p className="text-[13.5px] font-bold text-foreground/80 mb-1">{title}</p>
      {description && <p className="text-xs leading-relaxed max-w-[240px]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
