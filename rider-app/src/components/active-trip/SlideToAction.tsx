// === src/components/active-trip/SlideToAction.tsx ===
// Zomato-style slide-to-action, built with framer-motion drag (PRD §12.14).
import { useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { haptic } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function SlideToAction({
  label,
  onComplete,
  disabled,
  loading,
}: {
  label: string;
  onComplete: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [maxX, setMaxX] = useState(0);
  const [completed, setCompleted] = useState(false);
  const x = useMotionValue(0);
  const fillWidth = useTransform(x, (v) => v + 48);
  const lastHapticStep = useRef(0);

  function handleDragStart() {
    if (trackRef.current) {
      setMaxX(trackRef.current.offsetWidth - 48 - 8);
    }
  }

  function handleDrag() {
    const step = Math.round(x.get() / 60);
    if (step !== lastHapticStep.current) {
      lastHapticStep.current = step;
      haptic(15);
    }
  }

  async function handleDragEnd() {
    if (maxX <= 0) return;
    if (x.get() >= maxX * 0.8) {
      animate(x, maxX, { duration: 0.2 });
      setCompleted(true);
      haptic(40);
      await onComplete();
    } else {
      animate(x, 0, { duration: 0.25 });
    }
  }

  const isDisabled = disabled || loading || completed;

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-14 rounded-full bg-[var(--primary-light)] overflow-hidden mt-1.5",
        isDisabled && "opacity-60"
      )}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#E84908] to-[#FF7A28]"
        style={{ width: fillWidth }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[12px] font-extrabold tracking-wide text-[var(--primary-dark)]">
          {loading ? "Please wait..." : label}
        </span>
      </div>
      {!isDisabled && (
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: maxX }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          style={{ x }}
          className="absolute left-1 top-1 flex size-12 items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(0,0,0,0.18)] text-primary cursor-grab active:cursor-grabbing z-10"
        >
          <ChevronRight size={20} strokeWidth={2.6} />
        </motion.div>
      )}
    </div>
  );
}
