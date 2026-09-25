// === src/hooks/useProximity.ts ===
// Reusable proximity logic for delivery steps.
// Returns distanceKm and proximityOk for a given target location.
// Gated by step: only checks proximity for step < 2 (at outlet).

import { useMemo } from "react";
import { useLocationContext } from "@/contexts/LocationContext";
import { getDistanceKm } from "@/lib/utils";
import { PROXIMITY } from "@/lib/constants";
import type { ActiveOrder } from "@/hooks/useActiveOrder";

interface ProximityResult {
  distanceKm: number | null;
  proximityOk: boolean;
  gated: boolean;
}

export function useProximity(order: ActiveOrder): ProximityResult {
  const { location } = useLocationContext();

  return useMemo(() => {
    const step = order.step;
    const gated = step < 2; // Only gate proximity for steps at outlet (0=Arriving, 1=Arrived)

    const target = gated
      ? { lat: order.outletLat, lng: order.outletLng }
      : { lat: order.lat, lng: order.lng };

    const distanceKm = gated && location
      ? getDistanceKm(location.lat, location.lng, target.lat, target.lng)
      : null;

    const proximityOk = distanceKm === null || distanceKm <= PROXIMITY.PICKUP_RADIUS_KM;

    return { distanceKm, proximityOk, gated };
  }, [order.step, order.outletLat, order.outletLng, order.lat, order.lng, location]);
}