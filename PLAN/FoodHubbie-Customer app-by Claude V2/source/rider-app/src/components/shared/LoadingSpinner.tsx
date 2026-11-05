// === src/components/shared/LoadingSpinner.tsx ===
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingSpinner({
  label,
  size = 20,
  className,
  fullscreen = false,
}: {
  label?: string;
  size?: number;
  className?: string;
  fullscreen?: boolean;
}) {
  const content = (
    <div className={cn("flex flex-col items-center justify-center gap-2 text-muted-foreground", className)}>
      <Loader2 size={size} className="animate-spin text-primary" />
      {label && <p className="text-xs font-medium">{label}</p>}
    </div>
  );

  if (!fullscreen) return content;

  return <div className="flex min-h-[50vh] w-full items-center justify-center">{content}</div>;
}
