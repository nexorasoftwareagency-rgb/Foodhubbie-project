// === src/components/modals/SuccessOverlay.tsx ===
import { useEffect } from "react";
import { Check } from "lucide-react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { CONFETTI_COLORS } from "@/lib/constants";

export function SuccessOverlay({
  open,
  orderId,
  earnedAmount,
  onClose,
}: {
  open: boolean;
  orderId: string;
  earnedAmount: number;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const duration = 1500;
    const end = Date.now() + duration;
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 65,
        origin: { x: 0, y: 0.6 },
        colors: CONFETTI_COLORS,
        zIndex: 9999,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 65,
        origin: { x: 1, y: 0.6 },
        colors: CONFETTI_COLORS,
        zIndex: 9999,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-white/98">
      <div className="flex size-[90px] items-center justify-center rounded-full bg-[#10B981] mb-5 animate-in zoom-in duration-300">
        <Check size={42} strokeWidth={3} className="text-white" />
      </div>
      <h2 className="text-[21px] font-black text-center">Delivery Completed!</h2>
      <p className="text-[13px] text-muted-foreground text-center mt-1.5">
        Great job &mdash; order #{orderId.slice(-8)} delivered
      </p>
      <div className="text-[26px] font-black text-[#10B981] mt-3.5">+{formatCurrency(earnedAmount)}</div>
      <Button className="mt-6" size="lg" variant="default" onClick={onClose}>
        Back to Dashboard
      </Button>
    </div>
  );
}
