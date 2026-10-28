// === src/services/riderService.ts ===
import { db, ref, get, update, onValue, serverTimestamp } from "@/lib/firebase";
import { dbPaths, outletBusinessIdCache, setRiderOutlet, type OutletId } from "@/lib/constants";
import type { Rider, RiderStatus } from "@/types";

/** Resolve which outlet tree this rider lives in.
 *  `riderIndex/{uid}` is a platform-maintained pointer ({bid, outlet}) written at
 *  rider creation and by the 2026-10-28 migration — riders cannot read the
 *  businesses tree, so the index is their only bootstrap path.
 *  Cached per uid: AuthContext and useRiderProfile both resolve on login, and
 *  the pointer only changes if an admin re-creates the rider. */
const scopeCache = new Map<string, { bid: string; outlet: OutletId }>();

export async function resolveRiderScope(uid: string): Promise<{ bid: string; outlet: OutletId }> {
  const cached = scopeCache.get(uid);
  if (cached) {
    outletBusinessIdCache.set(cached.outlet, cached.bid);
    setRiderOutlet(cached.outlet);
    return cached;
  }
  const snap = await get(ref(db, `riderIndex/${uid}`));
  const entry = (snap.val() || {}) as { bid?: string; outlet?: string };
  if (!entry.bid || !entry.outlet) {
    throw new Error("Rider profile index missing — ask your outlet admin to re-save your rider record.");
  }
  const scope = { bid: entry.bid, outlet: entry.outlet };
  scopeCache.set(uid, scope);
  outletBusinessIdCache.set(entry.outlet, entry.bid);
  setRiderOutlet(entry.outlet);
  return scope;
}

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
  return handler;
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
