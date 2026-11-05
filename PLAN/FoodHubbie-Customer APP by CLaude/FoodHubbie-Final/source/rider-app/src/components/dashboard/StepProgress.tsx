// === src/components/dashboard/StepProgress.tsx ===
import { Check, Package, Navigation, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Accept", icon: Check },
  { label: "Pickup", icon: Package },
  { label: "Transit", icon: Navigation },
  { label: "Drop", icon: Flag },
];

export function StepProgress({ step }: { step: number }) {
  return (
    <div>
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <div key={s.label} className="flex items-center flex-1 last:flex-none">
              <div
                className={cn(
                  "flex size-[26px] shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-extrabold transition-colors",
                  done && "bg-primary border-primary text-white",
                  active && "bg-white border-primary text-primary shadow-[0_0_0_4px_var(--primary-glow)]",
                  !done && !active && "bg-muted border-muted text-muted-foreground"
                )}
              >
                {done ? <Check size={13} /> : <Icon size={13} />}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("h-[3px] flex-1 mx-0.5", done ? "bg-primary" : "bg-muted")} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {STEPS.map((s) => (
          <span key={s.label} className="w-[26px] text-center text-[9px] font-bold text-muted-foreground">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
