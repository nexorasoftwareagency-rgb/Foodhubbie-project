// === src/components/modals/PingModal.tsx ===
// Full-screen new-order alert with a 30s countdown. Mounted once at the app shell
// level so it fires no matter which tab the rider is looking at. Watches both
// fixed outlets (pizza + cake) simultaneously via useAvailableOrders.
import { useEffect, useRef, useState } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { MapPin, Navigation2 } from "lucide-react";
import { useRiderContext } from "@/contexts/RiderContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { useAuth } from "@/hooks/useAuth";
import { useAvailableOrders } from "@/hooks/useAvailableOrders";
import { useActiveOrder } from "@/hooks/useActiveOrder";
import { useAlertSound } from "@/components/shared/AudioPlayer";
import { acceptOrder, OrderTakenError, ProximityError } from "@/services/orderService";
import { enqueueOfflineAction } from "@/components/shared/OfflineQueue";
import { logRiderError } from "@/services/auditService";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, haptic } from "@/lib/utils";
import { PROXIMITY, PING_COUNTDOWN_SECONDS } from "@/lib/constants";
import type { AvailableOrder } from "@/types";

const RING_CIRCUMFERENCE = 2 * Math.PI * 42;

export function PingModal() {
  const { isOnline, rider } = useRiderContext();
  const { user } = useAuth();
  const { location } = useLocationContext();
  const { orders } = useAvailableOrders();
  const { activeOrder } = useActiveOrder();
  const playAlert = useAlertSound();
  const [, navigate] = useWouterLocation();

  const [queue, setQueue] = useState<AvailableOrder[]>([]);
  const [current, setCurrent] = useState<AvailableOrder | null>(null);
  const [seconds, setSeconds] = useState(PING_COUNTDOWN_SECONDS);
  const [accepting, setAccepting] = useState(false);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const ignoredIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      orders.forEach((o) => seenIdsRef.current.add(o.id));
      initializedRef.current = true;
      return;
    }
    if (!isOnline || activeOrder) return;

    const evaluable = orders.filter((o) => o.distance !== undefined);
    const fresh = evaluable.filter(
      (o) => !seenIdsRef.current.has(o.id) && !ignoredIdsRef.current.has(o.id) && o.distance! <= PROXIMITY.PICKUP_RADIUS_KM
    );
    if (fresh.length > 0) {
      fresh.forEach((o) => seenIdsRef.current.add(o.id));
      setQueue((q) => [...q, ...fresh]);
    }
    evaluable.forEach((o) => seenIdsRef.current.add(o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, isOnline, activeOrder]);

  useEffect(() => {
    if (!current && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setSeconds(PING_COUNTDOWN_SECONDS);
      playAlert();
      haptic([100, 50, 100, 50, 200]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    if (seconds <= 0) {
      handleSkip(true);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, seconds]);

  function handleSkip(auto?: boolean) {
    if (current) ignoredIdsRef.current.add(current.id);
    setCurrent(null);
    if (!auto) toast.info("Task skipped");
  }

  async function handleAccept() {
    if (!current || !user?.uid || !user.email || accepting) return;
    setAccepting(true);
    const payload = {
      outlet: current.outlet,
      orderId: current.id,
      riderEmail: user.email,
      riderUid: user.uid,
      riderPhone: rider?.phone || "",
      riderName: rider?.name || "Your rider",
      outletLat: current.outletLat,
      outletLng: current.outletLng,
      customerPhone: (current as any).phone || (current as any).customerPhone,
    };

    if (!navigator.onLine) {
      enqueueOfflineAction("ACCEPT_ORDER", payload);
      toast.warning("You're offline", { description: "This order will be accepted automatically once you're back online." });
      setCurrent(null);
      setAccepting(false);
      return;
    }

    try {
      const riderLat = location?.lat ?? current.outletLat;
      const riderLng = location?.lng ?? current.outletLng;
      await acceptOrder({ ...payload, riderLat, riderLng, accuracy: location?.accuracy });
      toast.success("Order Accepted!", { description: "Head to the outlet to pick it up." });
      setCurrent(null);
      navigate("/active");
    } catch (err) {
      if (err instanceof OrderTakenError) {
        toast.error("Order already taken", { description: "Another rider accepted this order first." });
      } else if (err instanceof ProximityError) {
        toast.error("Too far from outlet", { description: err.message });
      } else {
        toast.error("Could not accept order", { description: "Please try again." });
        if (user?.uid) logRiderError(user.uid, "pingModal.acceptOrder", err);
      }
      setCurrent(null);
    } finally {
      setAccepting(false);
    }
  }

  if (!current) return null;

  const dashOffset = RING_CIRCUMFERENCE * (1 - seconds / PING_COUNTDOWN_SECONDS);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center px-6 py-8 bg-gradient-to-b from-[#0F1720] to-[#1a0f08]">
      <div className="relative mb-4 size-24">
        <svg width="96" height="96" className="-rotate-90">
          <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
          <circle
            cx="48"
            cy="48"
            r="42"
            fill="none"
            stroke="#E84908"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-black text-white">{seconds}</div>
      </div>

      <h2 className="text-xl font-extrabold text-white text-center">Incoming Order</h2>
      <p className="text-[12.5px] font-bold text-[#FFA366] uppercase tracking-wide mt-0.5">
        {current.outletIcon} {current.outletName}
      </p>

      <div className="w-full max-w-[300px] rounded-[18px] bg-white/[0.07] border border-white/[0.14] backdrop-blur-md p-4 my-5">
        <div className="flex justify-between py-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-white/60">Order ID</span>
          <span className="text-[13px] font-bold text-white">#{current.id.slice(-8)}</span>
        </div>
        <div className="flex justify-between py-2 border-t border-white/10">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-white/60 flex items-center gap-1">
            <MapPin size={11} /> Deliver To
          </span>
          <span className="text-[13px] font-bold text-white text-right max-w-[180px] truncate">
            {current.address.split(",")[0]}
          </span>
        </div>
        {current.distance !== undefined && (
          <div className="flex justify-between py-2 border-t border-white/10">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-white/60 flex items-center gap-1">
              <Navigation2 size={11} /> Distance
            </span>
            <span className="text-[13px] font-bold text-white">{current.distance.toFixed(1)} km away</span>
          </div>
        )}
      </div>

      <div className="text-center mb-5">
        <div className="text-2xl font-black text-[#22C55E]">{formatCurrency(current.deliveryFee)}</div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/60 mt-0.5">Estimated Earning</div>
      </div>

      <div className="w-full max-w-[300px] flex flex-col gap-2.5">
        <button
          onClick={handleAccept}
          disabled={accepting}
          className="rounded-[14px] bg-primary py-4 text-[14px] font-extrabold text-white shadow-[0_10px_26px_var(--primary-glow)] disabled:opacity-60"
        >
          {accepting ? "Accepting..." : "ACCEPT TASK"}
        </button>
        <button
          onClick={() => handleSkip(false)}
          disabled={accepting}
          className="rounded-[14px] border border-white/20 py-3 text-[12.5px] font-bold text-white/60"
        >
          SKIP THIS TASK
        </button>
      </div>
    </div>
  );
}
