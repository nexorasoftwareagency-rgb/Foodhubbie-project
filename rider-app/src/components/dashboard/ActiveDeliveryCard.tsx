// === src/components/dashboard/ActiveDeliveryCard.tsx ===
import { useLocation } from "wouter";
import { StepProgress } from "@/components/dashboard/StepProgress";
import { useActiveOrder } from "@/hooks/useActiveOrder";

export function ActiveDeliveryCard() {
  const { activeOrder } = useActiveOrder();
  const [, navigate] = useLocation();

  if (!activeOrder) return null;

  return (
    <div className="rounded-[20px] p-4 bg-gradient-to-b from-[#FFF7F2] to-white border border-[#FFE1CE] mb-2">
      <div className="flex items-center justify-between mb-3.5">
        <b className="text-[13px] font-extrabold text-[var(--primary-dark)]">
          Active Delivery &middot; #{activeOrder.id.slice(-6)}
        </b>
        <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-extrabold text-white">
          STEP {activeOrder.step + 1}/4
        </span>
      </div>
      <StepProgress step={activeOrder.step} />
      <button
        onClick={() => navigate("/active")}
        className="w-full mt-3.5 rounded-[11px] bg-primary py-2.5 text-[12.5px] font-bold text-white"
      >
        Go to Live Trip &rarr;
      </button>
    </div>
  );
}
