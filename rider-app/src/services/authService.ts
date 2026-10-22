// === src/services/authService.ts ===
import {
  auth,
  db,
  ref,
  set,
  update,
  onDisconnect,
  serverTimestamp,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  firebaseSignOut,
  onAuthStateChanged,
} from "@/lib/firebase";
import type { User } from "firebase/auth";
import { dbPaths, resolveBusinessIdForOutlet, type OutletId } from "@/lib/constants";
import type { Rider } from "@/types";

/** Riders authenticate with {10-digit phone}@rider.com, matching auth.js exactly. */
export function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (/^\d{10}$/.test(trimmed)) return `${trimmed}@rider.com`;
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return last10.length === 10 ? `${last10}@rider.com` : trimmed;
}

export type AuthErrorInfo = { code: string; message: string };

function mapAuthError(err: any): AuthErrorInfo {
  const code = err?.code || "auth/unknown";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return { code, message: "Incorrect mobile number or password." };
    case "auth/too-many-requests":
      return { code, message: "Too many failed attempts. Try again later." };
    case "auth/network-request-failed":
      return { code, message: "Network error. Check internet connection." };
    default:
      return { code, message: "Authentication failed. Check credentials." };
  }
}

export async function loginRider(identifier: string, password: string): Promise<User> {
  const email = normalizeIdentifier(identifier);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    try {
      localStorage.setItem("isLoggedIn", "true");
    } catch {
      /* ignore storage errors (private mode) */
    }
    return cred.user;
  } catch (err: any) {
    throw mapAuthError(err);
  }
}

/** Register a new rider account via Firebase Auth + write rider profile to RTDB.
 *  The rider record lands in the correct outlet tree via businessId. Returns
  *  the created User. */
export async function registerRider(params: {
  identifier: string;
  password: string;
  name: string;
  outlet: OutletId;
}): Promise<User> {
  const email = normalizeIdentifier(params.identifier);
  if (!email) throw new Error("Invalid email or phone number");

  // The rules require name + phone to create a rider record, and the order
  // rules match riders by their email — so both must be in the payload.
  const digits = params.identifier.replace(/\D/g, "");
  const phone = digits.length >= 10 ? digits.slice(-10) : "";
  if (!phone) throw new Error("A 10-digit mobile number is required to register.");

  const cred = await createUserWithEmailAndPassword(auth, email, params.password);
  const { user } = cred;

  // Resolve businessId from outlet (outletIndex, platform-maintained).
  // A static map would write the outlet id as the business id for every
  // outlet it doesn't know, sending the rider record to a dead tree.
  const outletId = params.outlet;
  const businessId = await resolveBusinessIdForOutlet(outletId);

  const riderPayload: Partial<Rider> = {
    uid: user.uid,
    name: params.name || "",
    phone,
    email: user.email ?? email,
    outlet: outletId,
    businessId,
    status: "Offline",
    lastSeen: Date.now(),
    createdAt: Date.now(),
    // NOTE: isAdmin is intentionally NOT written here. The rules validate it as
    // "newData === data", and on create data is null — writing false would be
    // rejected. The Admin sets it later.
  };

  try {
    await set(ref(db, dbPaths.rider(user.uid)), riderPayload);
  } catch (err) {
    // Rollback: attempt to delete the auth user if profile write fails.
    // Client SDK cannot delete users directly; this is best-effort only.
    try {
      await firebaseSignOut(auth);
    } catch {}
    throw err;
  }

  try {
    localStorage.setItem("isLoggedIn", "true");
  } catch {
    /* ignore storage errors (private mode) */
  }
  return user;
}

export async function logoutRider(uid?: string): Promise<void> {
  try {
    if (uid) {
      await update(ref(db, dbPaths.rider(uid)), {
        status: "Offline",
        lastSeen: serverTimestamp(),
      });
    }
  } catch {
    /* best-effort — proceed with sign out regardless */
  }
  // Drop this device's push subscription first (still authenticated, so the
  // rider can clear their own fcmToken), otherwise the next rider on the same
  // phone would receive the previous rider's order alerts.
  try {
    const { unregisterPushNotifications } = await import("./notificationService");
    await unregisterPushNotifications(uid);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("rider_authenticated");
    localStorage.removeItem("activeOrderId");
    localStorage.removeItem("activeOrderData");
  } catch {
    /* ignore */
  }
  await firebaseSignOut(auth);
}

export function armDisconnectHandlers(uid: string) {
  const riderRef = ref(db, dbPaths.rider(uid));
  onDisconnect(riderRef).update({
    status: "Offline",
    lastSeen: serverTimestamp(),
  });
  const locRef = ref(db, dbPaths.riderLocation(uid));
  onDisconnect(locRef).update({
    signalLost: true,
    lastSeen: serverTimestamp(),
  });
}

export function subscribeAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export function wasPreviouslyLoggedIn(): boolean {
  try {
    return localStorage.getItem("isLoggedIn") === "true";
  } catch {
    return false;
  }
}
