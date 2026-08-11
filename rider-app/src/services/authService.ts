// === src/services/authService.ts ===
import {
  auth,
  db,
  ref,
  update,
  onDisconnect,
  serverTimestamp,
  signInWithEmailAndPassword,
  firebaseSignOut,
  onAuthStateChanged,
} from "@/lib/firebase";
import type { User } from "firebase/auth";
import { dbPaths } from "@/lib/constants";

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
