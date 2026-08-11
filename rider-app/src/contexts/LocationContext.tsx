// === src/contexts/LocationContext.tsx ===
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useRiderContext } from "@/contexts/RiderContext";
import { startLocationTracking, type GeoErrorReason, type LocationTrackerHandle } from "@/services/locationService";
import { logRiderError } from "@/services/auditService";
import { toast } from "@/hooks/use-toast";
import type { RiderLocation } from "@/types";

type LocationContextValue = {
  location: RiderLocation | null;
  locationError: GeoErrorReason | null;
};

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext();
  const { isOnline } = useRiderContext();
  const [location, setLocation] = useState<RiderLocation | null>(null);
  const [locationError, setLocationError] = useState<GeoErrorReason | null>(null);
  const handleRef = useRef<LocationTrackerHandle | null>(null);
  const warnedRef = useRef(false);

  // GPS watch itself starts/stops with the rider's Online toggle (battery-friendly —
  // per PRD §7.17, not just gating the Firebase sync while leaving the sensor running).
  useEffect(() => {
    if (!user?.uid || !isOnline) {
      handleRef.current?.stop();
      handleRef.current = null;
      return;
    }

    handleRef.current = startLocationTracking(
      user.uid,
      () => true, // tracker only runs at all while isOnline, so always sync when active
      (loc) => {
        setLocation(loc);
        setLocationError(null);
      },
      (reason) => {
        setLocationError(reason);
        if (!warnedRef.current) {
          warnedRef.current = true;
          logRiderError(user.uid, "geolocation", new Error(reason));
          if (reason === "denied") {
            toast.error("Location access denied", {
              description: "Enable location permission to go Online and accept orders.",
            });
          }
        }
      }
    );

    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, [user?.uid, isOnline]);

  return <LocationContext.Provider value={{ location, locationError }}>{children}</LocationContext.Provider>;
}

export function useLocationContext(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocationContext must be used within LocationProvider");
  return ctx;
}
