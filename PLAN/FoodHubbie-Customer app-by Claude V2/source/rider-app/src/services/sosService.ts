// === src/services/sosService.ts ===
// Emergency SOS — one-tap alert to the rider's emergency contact with live
// location, logged to Firebase for audit.
import { db, ref, set, push, update } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import type { EmergencyContact } from "@/types";

export type SOSEvent = {
  riderId: string;
  riderName: string;
  riderPhone: string;
  lat: number;
  lng: number;
  accuracy?: number;
  ts: number;
  status: "active" | "resolved";
};

export async function saveEmergencyContact(params: {
  uid: string;
  contact: EmergencyContact;
}): Promise<void> {
  const { uid, contact } = params;
  await update(ref(db, `${dbPaths.rider(uid)}/emergencyContact`), contact);
}

export async function triggerSOS(params: {
  riderId: string;
  riderName: string;
  riderPhone: string;
  lat: number;
  lng: number;
  accuracy?: number;
}): Promise<string> {
  const { riderId, riderName, riderPhone, lat, lng, accuracy } = params;
  const parentRef = ref(db, `sosAlerts/${riderId}`);
  const newRef = push(parentRef);
  await set(newRef, {
    riderId,
    riderName,
    riderPhone,
    lat,
    lng,
    accuracy,
    ts: Date.now(),
    status: "active",
  });
  return newRef.key!;
}

export async function resolveSOS(riderId: string, alertId: string): Promise<void> {
  await update(ref(db, `sosAlerts/${riderId}/${alertId}`), {
    status: "resolved",
    resolvedAt: Date.now(),
  });
}
