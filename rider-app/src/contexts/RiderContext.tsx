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
import { resolveBusinessIdForOutlet, outletBusinessIdCache } from "@/lib/constants";

type RiderContextValue = {
  rider: Rider | null;
  riderLoading: boolean;
  riderError: Error | null;
  isOnline: boolean;
  toggleOnline: () => Promise<void>;
  /** Combined totals across the rider's assigned outlet. */
  stats: RiderStats;
  /** Per-outlet breakdown — only includes the rider's assigned outlet. */
  statsByOutlet: Record<OutletId, RiderStats>;
  /** Only the rider's assigned outlet. */
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
    // Pre-populate cache so tenantPath() works synchronously
    resolveBusinessIdForOutlet(outlet).then(bid => {
      console.log('[RiderContext] Cached businessId for', outlet, ':', bid);
    }).catch(err => {
      console.error('[RiderContext] Failed to resolve businessId:', err);
    });
  }, [user?.uid, rider?.outlet]);

  // Subscribe to rider stats for the rider's assigned outlet only
  useEffect(() => {
    if (!user?.uid || !rider?.outlet) return;
    const outlet = rider.outlet;
    const unsub = subscribeRiderStats(outlet, user.uid, (s) => setStatsByOutlet((prev) => ({ ...prev, [outlet]: s })));
    return () => { unsub(); };
  }, [user?.uid, rider?.outlet]);

  // Load only the rider's assigned outlet
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setOutletsLoading(true);
    setOutletsError(null);
    loadOutlets()
      .then((list) => {
        if (!cancelled && rider?.outlet) {
          const filtered = list.filter(o => o.id === rider.outlet);
          setOutlets(filtered);
        } else if (!cancelled) {
          setOutlets([]);
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
  }, [user?.uid, rider?.outlet, retryTick]);

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

  // Aggregate stats across the rider's assigned outlet(s)
  const assignedOutlets = Object.keys(statsByOutlet) as OutletId[];
  const stats: RiderStats = assignedOutlets.reduce(
    (acc, oid) => ({
      totalOrders: acc.totalOrders + (statsByOutlet[oid]?.totalOrders || 0),
      totalEarnings: acc.totalEarnings + (statsByOutlet[oid]?.totalEarnings || 0),
    }),
    { totalOrders: 0, totalEarnings: 0 }
  );

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
