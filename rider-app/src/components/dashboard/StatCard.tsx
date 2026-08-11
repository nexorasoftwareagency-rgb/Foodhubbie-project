// === src/components/dashboard/StatCard.tsx ===
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const GRADIENTS = {
  green: "from-[#10B981] to-[#0B9169]",
  blue: "from-[#3B82F6] to-[#2563EB]",
  orange: "from-[#E84908] to-[#c43d00]",
  gold: "from-[#F59E0B] to-[#D97F06]",
};

export function StatCard({
  color,
  icon,
  value,
  label,
}: {
  color: keyof typeof GRADIENTS;
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className={cn("rounded-[16px] p-3.5 text-white shadow-[var(--shadow-card)] bg-gradient-to-br", GRADIENTS[color])}>
      <div className="opacity-90 mb-2.5">{icon}</div>
      <div className="text-[22px] font-black tracking-tight leading-none">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-90 mt-1">{label}</div>
    </div>
  );
}
