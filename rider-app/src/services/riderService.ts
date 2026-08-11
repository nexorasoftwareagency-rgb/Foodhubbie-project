// === src/services/riderService.ts ===
import { db, ref, get, update, onValue, off, serverTimestamp } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import type { Rider, RiderStatus } from "@/types";

export function subscribeRiderProfile(
  uid: string,
  callback: (rider: Rider | null) => void,
  onError?: (err: Error) => void
) {
  const riderRef = ref(db, dbPaths.rider(uid));
  const handler = onValue(
    riderRef,
    (snap) => {
      const val = snap.val();
      callback(val ? ({ uid, ...val } as Rider) : null);
    },
    (err) => onError?.(err as unknown as Error)
  );
  return () => off(riderRef, "value", handler);
}

export async function getRiderProfile(uid: string): Promise<Rider | null> {
  const snap = await get(ref(db, dbPaths.rider(uid)));
  const val = snap.val();
  return val ? ({ uid, ...val } as Rider) : null;
}

export async function setRiderStatus(uid: string, status: RiderStatus): Promise<void> {
  await update(ref(db, dbPaths.rider(uid)), {
    status,
    lastSeen: serverTimestamp(),
  });
}

export type ProfileEditableFields = Partial<
  Pick<Rider, "name" | "fatherName" | "age" | "qualification" | "phone" | "address" | "profilePhoto">
>;

export async function updateRiderProfile(uid: string, fields: ProfileEditableFields): Promise<void> {
  await update(ref(db, dbPaths.rider(uid)), fields);
}

export async function updateFcmToken(uid: string, token: string): Promise<void> {
  await update(ref(db, dbPaths.rider(uid)), { fcmToken: token });
}
