// === src/hooks/useAvailableOrders.ts ===
import { useEffect, useMemo, useState } from "react";
import { useRiderContext } from "@/contexts/RiderContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { subscribeAvailableOrders } from "@/services/orderService";
import { logRiderError } from "@/services/auditService";
import { useAuth } from "@/hooks/useAuth";
import { getDistanceKm } from "@/lib/utils";
import type { AvailableOrder } from "@/types";

export function useAvailableOrders() {
  const { user } = useAuth();
  const { outlets, outletsLoading } = useRiderContext();
  const { location } = useLocationContext();
  const [orders, setOrders] = useState<AvailableOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (outletsLoading || outlets.length === 0) return;
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeAvailableOrders(
      outlets,
      (list) => {
        setOrders(list);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
        if (user?.uid) logRiderError(user.uid, "subscribeAvailableOrders", err);
      }
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets, outletsLoading, retryTick]);

  const sorted = useMemo(() => {
    if (!location) return orders;
    return [...orders]
      .map((o) => ({
        ...o,
        distance: o.outletLat && o.outletLng ? getDistanceKm(location.lat, location.lng, o.outletLat, o.outletLng) : undefined,
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [orders, location]);

  return { orders: sorted, loading: loading || outletsLoading, error, retry: () => setRetryTick((t) => t + 1) };
}
