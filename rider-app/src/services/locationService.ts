// === src/services/locationService.ts ===
import { db, ref, update, onDisconnect, serverTimestamp } from "@/lib/firebase";
import { dbPaths, LOCATION_SYNC_INTERVAL_MS } from "@/lib/constants";
import type { RiderLocation } from "@/types";

export type GeoErrorReason = "denied" | "unavailable" | "timeout" | "unsupported";

export type LocationTrackerHandle = {
  stop: () => void;
};

/**
 * Starts continuous GPS tracking + a 10s Firebase sync interval (PRD §12.9).
 * Only syncs to Firebase while `isOnline()` returns true at sync time,
 * so going Offline instantly stops broadcasting location without restarting GPS.
 */
export function startLocationTracking(
  uid: string,
  isOnline: () => boolean,
  onUpdate: (loc: RiderLocation) => void,
  onError: (reason: GeoErrorReason) => void
): LocationTrackerHandle {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    onError("unsupported");
    return { stop: () => {} };
  }

  let latest: RiderLocation | null = null;

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      latest = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ts: Date.now(),
      };
      onUpdate(latest);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onError("denied");
      else if (err.code === err.POSITION_UNAVAILABLE) onError("unavailable");
      else onError("timeout");
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  const locRef = ref(db, dbPaths.riderLocation(uid));
  onDisconnect(locRef).update({ signalLost: true, lastSeen: serverTimestamp() });

  const intervalId = window.setInterval(() => {
    if (latest && isOnline()) {
      update(locRef, latest).catch(() => {});
      update(ref(db, dbPaths.rider(uid)), { lastSeen: serverTimestamp() }).catch(() => {});
    }
  }, LOCATION_SYNC_INTERVAL_MS);

  return {
    stop: () => {
      onDisconnect(locRef).cancel();
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(intervalId);
    },
  };
}

/** One-off current position read (e.g. before accepting an order if watch hasn't reported yet) */
export function getCurrentPositionOnce(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Geolocation unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  });
}
