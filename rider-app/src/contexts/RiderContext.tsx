// === src/contexts/RiderContext.tsx ===
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useRiderProfile } from "@/hooks/useRiderProfile";
import { setRiderStatus } from "@/services/riderService";
import { loadOutlets, subscribeRiderStats, type OutletInfo } from "@/services/orderService";
import { logRiderError } from "@/services/auditService";
import { toast } from "@/hooks/use-toast";
import type { Rider, RiderStats } from "@/types";
import type { OutletId } from "@/lib/constants";

type RiderContextValue = {
  rider: Rider | null;
  riderLoading: boolean;
  riderError: Error | null;
  isOnline: boolean;
  toggleOnline: () => Promise<void>;
  /** Combined totals across both outlets. */
  stats: RiderStats;
  /** Per-outlet breakdown — used on the Earnings page. */
  statsByOutlet: Record<OutletId, RiderStats>;
  outlets: OutletInfo[];
  outletsLoading: boolean;
  outletsError: Error | null;
  retryOutlets: () => void;
};

const RiderContext = createContext<RiderContextValue | undefined>(undefined);

const EMPTY_STATS: RiderStats = { totalOrders: 0, totalEarnings: 0 };

export function RiderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const { rider, loading: riderLoading, error: riderError } = useRiderProfile(user?.uid);
  const [statsByOutlet, setStatsByOutlet] = useState<Record<OutletId, RiderStats>>({
    pizza: EMPTY_STATS,
    cake: EMPTY_STATS,
  });
  const [outlets, setOutlets] = useState<OutletInfo[]>([]);
  const [outletsLoading, setOutletsLoading] = useState(true);
  const [outletsError, setOutletsError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const unsubPizza = subscribeRiderStats("pizza", user.uid, (s) => setStatsByOutlet((prev) => ({ ...prev, pizza: s })));
    const unsubCake = subscribeRiderStats("cake", user.uid, (s) => setStatsByOutlet((prev) => ({ ...prev, cake: s })));
    return () => {
      unsubPizza();
      unsubCake();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setOutletsLoading(true);
    setOutletsError(null);
    loadOutlets()
      .then((list) => {
        if (!cancelled) setOutlets(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setOutletsError(err);
        logRiderError(user.uid, "loadOutlets", err);
        toast.error("Could not load outlet info. Pull to refresh.");
      })
      .finally(() => {
        if (!cancelled) setOutletsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, retryTick]);

  const isOnline = rider?.status === "Online";

  const toggleOnline = async () => {
    if (!user?.uid || toggling) return;
    setToggling(true);
    const next = isOnline ? "Offline" : "Online";
    try {
      await setRiderStatus(user.uid, next);
      toast[next === "Online" ? "success" : "warning"](next === "Online" ? "You are Online" : "You are Offline", {
        description:
          next === "Online" ? "GPS tracking started. New orders will ping you." : "You will not receive new order pings.",
      });
    } catch (err) {
      logRiderError(user.uid, "toggleOnline", err);
      toast.error("Could not update your status. Check your connection.");
    } finally {
      setToggling(false);
    }
  };

  const stats: RiderStats = {
    totalOrders: (statsByOutlet.pizza?.totalOrders || 0) + (statsByOutlet.cake?.totalOrders || 0),
    totalEarnings: (statsByOutlet.pizza?.totalEarnings || 0) + (statsByOutlet.cake?.totalEarnings || 0),
  };

  return (
    <RiderContext.Provider
      value={{
        rider,
        riderLoading,
        riderError,
        isOnline,
        toggleOnline,
        stats,
        statsByOutlet,
        outlets,
        outletsLoading,
        outletsError,
        retryOutlets: () => setRetryTick((t) => t + 1),
      }}
    >
      {children}
    </RiderContext.Provider>
  );
}

export function useRiderContext(): RiderContextValue {
  const ctx = useContext(RiderContext);
  if (!ctx) throw new Error("useRiderContext must be used within RiderProvider");
  return ctx;
}
