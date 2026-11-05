// === src/lib/firebase.ts ===
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  runTransaction,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  onValue,
  off,
  serverTimestamp,
  onDisconnect,
  type Database,
} from "firebase/database";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
} from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from "firebase/storage";
import { getMessaging, getToken, onMessage, deleteToken, isSupported, type Messaging } from "firebase/messaging";

// Real config from rider/js/firebase.js — the Roshani rider portal intentionally
// runs on its own Firebase project, independent from the Roshani Admin project.
const ROSHANI_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85",
};

const app: FirebaseApp = initializeApp(ROSHANI_FIREBASE_CONFIG);

const db: Database = getDatabase(app);
const auth: Auth = getAuth(app);


const storage: FirebaseStorage = getStorage(app);

let messaging: Messaging | null = null;
// Resolves once isSupported() settles, so callers never race the async probe
// (previously a token request on first auth could see null and silently bail).
let messagingPromise: Promise<Messaging | null> | null = null;
if (typeof window !== "undefined") {
  messagingPromise = isSupported()
    .then((supported) => (supported ? getMessaging(app) : null))
    .catch(() => null)
    .then((m) => {
      messaging = m;
      return m;
    });
}

export function getMessagingInstance(): Messaging | null {
  return messaging;
}

export async function getMessagingAsync(): Promise<Messaging | null> {
  return messagingPromise ? messagingPromise : null;
}

// Corrects for client device clock drift/manipulation using Firebase's own
// server-vs-client offset feed. Used anywhere a rate limit or lockout window
// is enforced (e.g. OTP attempt blocking) so a wrong or deliberately changed
// device clock can't bypass or falsely trigger those limits. This is a
// client-side mitigation only — the authoritative enforcement still belongs
// in Security Rules / a Cloud Function if OTP abuse becomes a real concern.
let serverTimeOffsetMs = 0;
let serverTimeOffsetReady = false;
let serverTimeOffsetResolve: () => void = () => {};
const serverTimeOffsetPromise = new Promise<void>((resolve) => {
    serverTimeOffsetResolve = resolve;
});

if (typeof window !== "undefined") {
    // Prime the offset with a one-time get() to avoid race condition
    get(ref(db, ".info/serverTimeOffset")).then((snap) => {
        const val = snap.val();
        if (typeof val === "number") {
            serverTimeOffsetMs = val;
        }
        serverTimeOffsetReady = true;
        serverTimeOffsetResolve();
    }).catch(() => {
        serverTimeOffsetReady = true;
        serverTimeOffsetResolve();
    });

    // Keep listening for updates
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
        const val = snap.val();
        if (typeof val === "number") serverTimeOffsetMs = val;
    });
}

/** Wait for server time offset to be ready (resolves immediately if already ready) */
export async function waitForServerTimeOffset(): Promise<void> {
    if (serverTimeOffsetReady) return;
    await serverTimeOffsetPromise;
}

/** Best-effort server-corrected "now", falling back to Date.now() before the
 *  offset has loaded (offset starts at 0, so this is identical to Date.now()
 *  until the first `.info/serverTimeOffset` snapshot arrives). */
export function serverNow(): number {
    if (!serverTimeOffsetReady) {
        console.warn("[serverNow] called before serverTimeOffset ready — using local time");
    }
    return Date.now() + serverTimeOffsetMs;
}
export {
  app,
  db,
  auth,
  storage,
  ROSHANI_FIREBASE_CONFIG,
  ref,
  get,
  set,
  update,
  remove,
  push,
  runTransaction,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  onValue,
  off,
  serverTimestamp,
  onDisconnect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  firebaseSignOut,
  onAuthStateChanged,
  storageRef,
  uploadBytes,
  getDownloadURL,
  getToken,
  onMessage,
  deleteToken,
};

export default app;
