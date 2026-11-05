// Pure riderStats update for one delivery (money path — keep pure & tested via
// scripts/check-delivery-stats.ts).
// deliveredOrders doubles as an idempotency map {orderIdSanitized: timestamp}.
// Flags older than TTL are pruned on every write so the map stays bounded —
// it previously grew one boolean key per delivery, forever. Legacy `true`
// values are undatable, so they are treated as stale and dropped.

export type RiderStatsNode = {
  totalOrders?: number;
  totalEarnings?: number;
  deliveredOrders?: Record<string, number | boolean>;
};

export const FLAG_TTL_MS = 24 * 60 * 60 * 1000;

export function applyDeliveryStat(
  current: RiderStatsNode | null,
  flagKey: string,
  deliveryFee: number,
  now: number
): RiderStatsNode {
  if (current?.deliveredOrders?.[flagKey]) return current; // already counted
  const deliveredOrders: Record<string, number> = {};
  for (const [k, v] of Object.entries(current?.deliveredOrders || {})) {
    if (typeof v === "number" && v >= now - FLAG_TTL_MS) deliveredOrders[k] = v;
  }
  deliveredOrders[flagKey] = now;
  if (!current) return { totalOrders: 1, totalEarnings: deliveryFee, deliveredOrders };
  return {
    ...current,
    totalOrders: (current.totalOrders || 0) + 1,
    totalEarnings: (current.totalEarnings || 0) + deliveryFee,
    deliveredOrders,
  };
}
