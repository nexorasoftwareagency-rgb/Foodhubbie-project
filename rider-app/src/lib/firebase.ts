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
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85",
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
