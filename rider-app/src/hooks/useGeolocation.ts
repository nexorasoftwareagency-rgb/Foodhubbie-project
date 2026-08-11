// === src/hooks/useGeolocation.ts ===
import { useCallback, useState } from "react";
import { getCurrentPositionOnce } from "@/services/locationService";

/** One-off geolocation reads — e.g. confirming rider position right before an action button is pressed. */
export function useGeolocation() {
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestPosition = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pos = await getCurrentPositionOnce();
      setPosition(pos);
      return pos;
    } catch (err: any) {
      const message =
        err?.code === 1
          ? "Location permission denied. Enable location access to continue."
          : err?.code === 2
            ? "Location unavailable. Check your GPS/network signal."
            : "Could not get your location. Try again.";
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { position, error, loading, requestPosition };
}
