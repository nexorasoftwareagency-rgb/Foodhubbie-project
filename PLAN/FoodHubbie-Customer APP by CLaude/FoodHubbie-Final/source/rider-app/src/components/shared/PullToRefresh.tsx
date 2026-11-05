// === src/components/shared/PullToRefresh.tsx ===
// Real touch-driven pull-to-refresh: tracks vertical drag distance while the
// scroll container is at scrollTop 0, rubber-bands the pull, rotates an arrow
// indicator, and flips to a spinner past the release threshold.
import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 68;
const MAX_PULL = 110;

export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void> | void; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const draggingRef = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    if (refreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    draggingRef.current = true;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!draggingRef.current || startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Rubber-band damping so it feels resistive past the threshold.
    const damped = Math.min(MAX_PULL, delta / 1.8);
    setPull(damped);
  }

  async function onTouchEnd() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    startY.current = null;

    if (pull >= THRESHOLD) {
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }

  const rotation = Math.min(180, (pull / THRESHOLD) * 180);
  const showIndicator = pull > 4 || refreshing;

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative h-full overflow-y-auto"
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: showIndicator ? Math.max(pull, refreshing ? 40 : 0) : 0 }}
      >
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-full bg-card shadow-[var(--shadow-card)] text-primary",
            refreshing && "animate-none"
          )}
        >
          {refreshing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowDown size={16} style={{ transform: `rotate(${rotation}deg)`, transition: "transform 0.1s linear" }} />
          )}
        </div>
      </div>
      <div
        style={{
          transform: !refreshing && pull > 0 ? `translateY(${pull * 0.4}px)` : undefined,
          transition: draggingRef.current ? "none" : "transform 0.2s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
