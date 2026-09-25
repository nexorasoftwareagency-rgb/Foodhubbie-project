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
import { resolveBusinessIdForOutlet } from "@/lib/constants";

type RiderContextValue = {
  rider: Rider | null;
  riderLoading: boolean;
  riderError: Error | null;
  isOnline: boolean;
  toggleOnline: () => Promise<void>;
  /** Combined totals across all outlets (global rider stats). */
  stats: RiderStats;
  /** Per-outlet breakdown — mirrored from global stats for UI compatibility. */
  statsByOutlet: Record<OutletId, RiderStats>;
  /** All outlets the rider can access. */
  outlets: OutletInfo[];
  outletsLoading: boolean;
  outletsError: Error | null;
  retryOutlets: () => void;
};

const RiderContext = createContext<RiderContextValue | undefined>(undefined);

export function RiderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const { rider, loading: riderLoading, error: riderError } = useRiderProfile(user?.uid);
  const [statsByOutlet, setStatsByOutlet] = useState<Record<OutletId, RiderStats>>({} as Record<OutletId, RiderStats>);
  const [outlets, setOutlets] = useState<OutletInfo[]>([]);
  const [outletsLoading, setOutletsLoading] = useState(true);
  const [outletsError, setOutletsError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [toggling, setToggling] = useState(false);

  // Initialize outlet -> businessId cache at app boot
  useEffect(() => {
    if (!user?.uid || !rider?.outlet) return;
    const outlet = rider.outlet;
    // Pre-populate cache so async path helpers work without extra round-trips
    resolveBusinessIdForOutlet(outlet).then(bid => {
      console.log('[RiderContext] Cached businessId for', outlet, ':', bid);
    }).catch(err => {
      console.error('[RiderContext] Failed to resolve businessId:', err);
    });
  }, [user?.uid, rider?.outlet]);

// Subscribe to global rider stats (single node for all outlets)
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeRiderStats(user.uid, (globalStats) => {
      // Mirror global stats to all known outlets for UI compatibility
      setStatsByOutlet((prev) => {
        const next = { ...prev };
        outlets.forEach((o) => { next[o.id] = globalStats; });
        return next;
      });
    });
    return () => { unsub(); };
  }, [user?.uid, outlets]);

  // Load all outlets the rider can access (for cross-outlet delivery)
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setOutletsLoading(true);
    setOutletsError(null);
    loadOutlets()
      .then((list) => {
        if (!cancelled) {
          setOutlets(list);
        }
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
    return () => { cancelled = true; };
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

  // Aggregate stats from global rider stats (same for all outlets)
  // Find first outlet that has stats (more robust than assuming outlets[0])
  const stats: RiderStats = outlets.find(o => statsByOutlet[o.id]) 
    ? statsByOutlet[outlets.find(o => statsByOutlet[o.id])!.id] 
    : { totalOrders: 0, totalEarnings: 0 };

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
