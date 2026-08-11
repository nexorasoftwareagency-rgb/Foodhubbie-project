// === src/hooks/useActiveOrder.ts ===
import { useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useRiderContext } from "@/contexts/RiderContext";
import { subscribeActiveOrders, type ActiveOrderRow } from "@/services/orderService";
import { logRiderError } from "@/services/auditService";
import { getDeliveryStep } from "@/lib/utils";

export type ActiveOrder = ActiveOrderRow;

export function useActiveOrder() {
  const { user } = useAuthContext();
  const { outlets, outletsLoading } = useRiderContext();
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!user?.email || outletsLoading || outlets.length === 0) return;
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeActiveOrders(
      outlets,
      user.email,
      (list) => {
        const withSteps = list
          .map((o) => ({ ...o, step: getDeliveryStep(o) }))
          .sort((a, b) => (a.acceptedAt || 0) - (b.acceptedAt || 0));
        setActiveOrders(withSteps as ActiveOrder[]);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
        if (user?.uid) logRiderError(user.uid, "subscribeActiveOrders", err);
      }
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, outlets, outletsLoading, retryTick]);

  return {
    activeOrder: activeOrders[0] || null,
    secondaryOrders: activeOrders.slice(1),
    allActiveOrders: activeOrders,
    loading: loading || outletsLoading,
    error,
    retry: () => setRetryTick((t) => t + 1),
    hasMultipleStops: activeOrders.length >= 2,
  };
}
