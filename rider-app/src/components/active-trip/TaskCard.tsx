// === src/components/active-trip/TaskCard.tsx ===
import { MapPin } from "lucide-react";
import { StepProgress } from "@/components/dashboard/StepProgress";
import { BillingSummary } from "@/components/active-trip/BillingSummary";
import { ItemChecklist } from "@/components/active-trip/ItemChecklist";
import { ActionButtons } from "@/components/active-trip/ActionButtons";
import { SlideToAction } from "@/components/active-trip/SlideToAction";
import { cn } from "@/lib/utils";
import type { ActiveOrder } from "@/hooks/useActiveOrder";

export function TaskCard({
  order,
  step,
  targetLabel,
  targetAddress,
  distanceKm,
  proximityOk,
  sliderLabel,
  sliderLocked,
  sliderLoading,
  onSlideComplete,
  onReopenOtp,
  contactPhone,
  destLat,
  destLng,
}: {
  order: ActiveOrder;
  step: number;
  targetLabel: string;
  targetAddress: string;
  distanceKm: number | null;
  proximityOk: boolean;
  sliderLabel: string;
  sliderLocked: boolean;
  sliderLoading: boolean;
  onSlideComplete: () => void | Promise<void>;
  onReopenOtp: () => void;
  contactPhone?: string;
  destLat: number;
  destLng: number;
}) {
  return (
    <div className="glass-surface rounded-[20px] shadow-[var(--shadow-premium)] p-4 mb-3.5">
      <div className="flex gap-1.5 mb-3.5">
        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground">
          #{order.id.slice(-8)}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground">
          {order.outletName}
        </span>
      </div>

      <StepProgress step={step} />

      <div className="flex items-start gap-2.5 rounded-[12px] bg-muted p-2.5 my-3.5">
        <div className="flex size-7.5 shrink-0 items-center justify-center rounded-[9px] bg-[var(--primary-light)] text-primary">
          <MapPin size={15} />
        </div>
        <div className="min-w-0">
          <b className="block text-[12px]">{targetLabel}</b>
          <span className="block text-[11px] text-muted-foreground leading-relaxed">{targetAddress}</span>
          {distanceKm !== null && (
            <span
              className={cn(
                "block text-[10.5px] font-bold mt-1",
                proximityOk ? "text-[#10B981]" : "text-destructive"
              )}
            >
              {proximityOk ? "\u2713" : "\u26A0"} {distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`} away
            </span>
          )}
        </div>
      </div>

      <ItemChecklist items={order.items} />
      <BillingSummary order={order} />
      <ActionButtons phone={contactPhone} destLat={destLat} destLng={destLng} />

      {!sliderLocked ? (
        <SlideToAction label={sliderLabel} onComplete={onSlideComplete} loading={sliderLoading} />
      ) : (
        <button
          onClick={onReopenOtp}
          className="w-full rounded-[14px] bg-primary py-4 text-[13px] font-extrabold text-white shadow-[0_8px_20px_var(--primary-glow)] animate-soft-pulse"
        >
          ENTER DELIVERY OTP
        </button>
      )}
    </div>
  );
}
