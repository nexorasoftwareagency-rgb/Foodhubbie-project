// === src/hooks/useEarnings.ts ===
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { useRiderContext } from "@/contexts/RiderContext";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Roshani has no ledger with timestamps (verified — completeDelivery only writes
 *  riderStats). "Today" and "this week" are derived directly from delivered orders'
 *  real deliveredAt timestamps instead — equally accurate, just a different source. */
export function useEarnings() {
  const { history, loading } = useOrderHistory();
  const { isOnline, statsByOutlet, stats } = useRiderContext();

  const [onlineSeconds, setOnlineSeconds] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOnline) {
      intervalRef.current = window.setInterval(() => setOnlineSeconds((s) => s + 1), 1000);
    } else if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [isOnline]);

  const todayOrders = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return history.filter((o) => (o.deliveredAt || 0) >= d.getTime());
  }, [history]);
  const todayTotal = useMemo(() => todayOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0), [todayOrders]);
  const todayOrderCount = todayOrders.length;

  const weekly = useMemo(() => {
    const days: { d: string; date: string; v: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const total = history
        .filter((o) => (o.deliveredAt || 0) >= date.getTime() && (o.deliveredAt || 0) < nextDate.getTime())
        .reduce((s, o) => s + (o.deliveryFee || 0), 0);
      days.push({ d: DAY_LABELS[date.getDay()], date: date.toISOString(), v: total });
    }
    return days;
  }, [history]);

  const weeklyTotal = useMemo(() => weekly.reduce((s, d) => s + d.v, 0), [weekly]);

  const byOutlet = useMemo(
    () => [
      { outlet: "Pizza", total: statsByOutlet.pizza?.totalEarnings || 0, orders: statsByOutlet.pizza?.totalOrders || 0 },
      { outlet: "Cake", total: statsByOutlet.cake?.totalEarnings || 0, orders: statsByOutlet.cake?.totalOrders || 0 },
    ],
    [statsByOutlet]
  );

  return {
    loading,
    todayTotal,
    todayOrderCount,
    weekly,
    weeklyTotal,
    byOutlet,
    onlineHoursSession: Math.round((onlineSeconds / 3600) * 10) / 10,
    totalOrders: stats.totalOrders,
    totalEarnings: stats.totalEarnings,
  };
}
