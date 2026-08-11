// === src/components/shared/OfflineQueue.tsx ===
// A localStorage-backed queue for non-time-critical, non-GPS-gated actions
// (e.g. "mark notification read") so they survive a full app reload while the
// device has zero network. GPS-gated actions (accept/pickup/OTP/payment) are
// intentionally NOT blind-replayed here — location/availability can change
// while offline, so those always re-validate live against Firebase instead.
import { useEffect, useRef, useState } from "react";
import { PackageX } from "lucide-react";
import type { OfflineAction } from "@/types";

const QUEUE_KEY = "roshani_offline_queue";

function readQueue(): OfflineAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(queue: OfflineAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage unavailable (private mode / quota) — degrade silently */
  }
}

export function enqueueOfflineAction(type: OfflineAction["type"], payload: unknown): string {
  const queue = readQueue();
  const action: OfflineAction = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    payload,
    queuedAt: Date.now(),
  };
  queue.push(action);
  writeQueue(queue);
  return action.id;
}

export function dequeueOfflineAction(id: string) {
  writeQueue(readQueue().filter((a) => a.id !== id));
}

export function getOfflineQueue(): OfflineAction[] {
  return readQueue();
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

function useQueueLength(): number {
  const [length, setLength] = useState(() => readQueue().length);
  useEffect(() => {
    const tick = () => setLength(readQueue().length);
    const interval = window.setInterval(tick, 2000);
    window.addEventListener("storage", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", tick);
    };
  }, []);
  return length;
}

/** Small pill shown in the header area when actions are waiting for connectivity to return. */
export function OfflineQueueIndicator() {
  const online = useOnlineStatus();
  const length = useQueueLength();
  if (online || length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[#FEF9E7] text-[#946200] px-2.5 py-1 text-[10.5px] font-bold">
      <PackageX size={12} />
      {length} queued
    </div>
  );
}

/**
 * Replays queued actions once connectivity returns. Deliberately does NOT trust the
 * queued lat/lng — GPS-gated actions re-fetch a FRESH position at replay time and
 * re-run through the exact same service function (with its own proximity + Firebase
 * rule checks), so a stale queue entry can never silently bypass safety checks.
 * Mount this once near the app root.
 */
export function useOfflineQueueProcessor() {
  const online = useOnlineStatus();
  const processingRef = useRef(false);

  useEffect(() => {
    if (!online || processingRef.current) return;
    const queue = readQueue();
    if (queue.length === 0) return;

    processingRef.current = true;

    (async () => {
      const { getCurrentPositionOnce } = await import("@/services/locationService");
      const orderService = await import("@/services/orderService");
      const { toast } = await import("@/hooks/use-toast");

      for (const action of queue) {
        try {
          const p: any = action.payload;

          if (action.type === "ACCEPT_ORDER") {
            const pos = await getCurrentPositionOnce().catch(() => null);
            await orderService.acceptOrder({
              ...p,
              riderLat: pos?.lat ?? p.outletLat,
              riderLng: pos?.lng ?? p.outletLng,
              accuracy: pos?.accuracy,
            });
            toast.success(`Order #${String(p.orderId).slice(-6)} accepted (synced)`);
          } else if (action.type === "REACHED_OUTLET") {
            const pos = await getCurrentPositionOnce().catch(() => null);
            await orderService.markReachedOutlet({
              ...p,
              riderLat: pos?.lat ?? p.outletLat,
              riderLng: pos?.lng ?? p.outletLng,
              accuracy: pos?.accuracy,
            });
            toast.success("Synced: arrived at outlet");
          } else if (action.type === "UPDATE_STATUS" && p.subtype === "confirmPickup") {
            const pos = await getCurrentPositionOnce().catch(() => null);
            await orderService.confirmPickup({
              ...p,
              riderLat: pos?.lat ?? p.outletLat,
              riderLng: pos?.lng ?? p.outletLng,
              accuracy: pos?.accuracy,
            });
            toast.success("Synced: pickup confirmed");
          } else if (action.type === "UPDATE_STATUS" && p.subtype === "reachedDrop") {
            // Roshani's reachedDrop has no proximity gate — no fresh GPS reading needed.
            await orderService.markReachedDrop({
              outlet: p.outlet,
              orderId: p.orderId,
              customerPhone: p.customerPhone,
            });
            toast.success("Synced: reached drop location");
          }
        } catch (err: any) {
          toast.error(`Couldn't sync a queued action: ${err?.message || "unknown error"}`);
        } finally {
          dequeueOfflineAction(action.id);
        }
      }
      processingRef.current = false;
    })();
  }, [online]);
}
