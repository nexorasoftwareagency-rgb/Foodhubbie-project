// === src/hooks/useOrderHistory.ts ===
import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useRiderContext } from "@/contexts/RiderContext";
import { subscribeOrderHistory } from "@/services/orderService";
import { logRiderError } from "@/services/auditService";
import type { RiderOrder } from "@/types";

export function useOrderHistory() {
  const { user } = useAuthContext();
  const { outlets, outletsLoading } = useRiderContext();
  const [history, setHistory] = useState<Array<RiderOrder & { outletName: string; outletIcon: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!user?.email || outletsLoading || outlets.length === 0) return;
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeOrderHistory(
      outlets,
      user.email,
      (list) => {
        setHistory(list);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
        if (user?.uid) logRiderError(user.uid, "subscribeOrderHistory", err);
      }
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, outlets, outletsLoading, retryTick]);

  const filtered = useMemo(() => {
    if (!search.trim()) return history;
    const q = search.trim().toLowerCase();
    return history.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        (o.orderId || "").toLowerCase().includes(q) ||
        o.outletName.toLowerCase().includes(q) ||
        (o.customerName || "").toLowerCase().includes(q)
    );
  }, [history, search]);

  return { history: filtered, loading: loading || outletsLoading, error, retry: () => setRetryTick((t) => t + 1), search, setSearch };
}
