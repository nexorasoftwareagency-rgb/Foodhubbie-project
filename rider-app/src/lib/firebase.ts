// === src/lib/firebase.ts ===
// Firebase init for the ROSHANI project — a separate Firebase project from
// FoodHubbie. Roshani's rider portal also runs Firebase App Check (reCAPTCHA v3),
// which FoodHubbie's rider app does not use — replicated here for parity with
// the real, deployed Roshani rider portal.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
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
import { getMessaging, getToken, onMessage, isSupported, type Messaging } from "firebase/messaging";

// Real config from rider/js/firebase.js — the Roshani rider portal intentionally
// runs on its own Firebase project, independent from the Roshani Admin project.
const ROSHANI_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDcx-SN5eak8PAs-8NtTGelJ_sICr5yb7Y",
  authDomain: "prashant-pizza-e86e4.firebaseapp.com",
  databaseURL: "https://prashant-pizza-e86e4-default-rtdb.firebaseio.com",
  projectId: "prashant-pizza-e86e4",
  storageBucket: "prashant-pizza-e86e4.firebasestorage.app",
  messagingSenderId: "857471482885",
  appId: "1:857471482885:web:9eb8bbb90c77c588fbb06c",
};

const RECAPTCHA_V3_SITE_KEY = "6LeAlcwsAAAAAH4F3p5aCNvyPlhC3BRHOXTdDEGK";

const app: FirebaseApp = initializeApp(ROSHANI_FIREBASE_CONFIG);

if (typeof window !== "undefined") {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.log("[App Check] Activated for Roshani Rider Portal");
  } catch (err) {
    console.warn("[App Check] Failed to initialize — continuing without it", err);
  }
}

const db: Database = getDatabase(app);
const auth: Auth = getAuth(app);


const storage: FirebaseStorage = getStorage(app);

let messaging: Messaging | null = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) messaging = getMessaging(app);
    })
    .catch(() => {
      messaging = null;
    });
}

export function getMessagingInstance(): Messaging | null {
  return messaging;
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
  firebaseSignOut,
  onAuthStateChanged,
  storageRef,
  uploadBytes,
  getDownloadURL,
  getToken,
  onMessage,
};

export default app;
