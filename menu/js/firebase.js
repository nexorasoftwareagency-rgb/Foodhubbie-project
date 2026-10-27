/**
 * Menu/js/firebase.js
 * Public, unauthenticated Firebase client for the customer-facing menu app.
 *
 * SECURITY MODEL (see Commands & Guidance doc for the full rules JSON):
 *   - tables: read-only, world-readable (token lookup happens client-side
 *     by scanning for a matching .token field — see session.js)
 *   - tableSessions: create + limited update only (no delete from here)
 *   - orders: create-only (no update/delete from this client — staff-only)
 *   - tableRequests: create-only
 *
 * This file intentionally does NOT use Firebase Auth for the QR dine-in app.
 * Access control is enforced entirely by Realtime Database Security Rules,
 * not by a login wall, since customers must never need to sign in to order food.
 *
 * ONE scoped exception: delivery direct mode (bare delivery.html URL with no
 * bot-issued webview token) mints its own one-time token via Firebase
 * ANONYMOUS Auth at checkout — see mintAnonWebviewToken() below. This is the
 * "trusted path" that lets the orders security rule verify a fresh, unused
 * token without exposing token creation to arbitrary unauthenticated writes.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getDatabase, ref, get, onValue, set, push, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Paste the SAME config values used in Admin/firebase-config.js.
// This is safe to expose publicly — Firebase config is not a secret,
// access control lives in the Security Rules, not in this object.
const firebaseConfig = {
    apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
    authDomain: "foodhubbie-10.firebaseapp.com",
    databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
    projectId: "foodhubbie-10",
    storageBucket: "foodhubbie-10.firebasestorage.app",
    messagingSenderId: "372428105696",
    appId: "1:372428105696:web:a3a979191a5cf94569ed85"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// ---------------------------------------------------------------
// Real connection state — same .info/connected pattern already
// proven in Admin/js/firebase.js. Lets app.js tell "genuinely
// offline" apart from "just a slow first connection" instead of
// guessing off a fixed timer.
// ---------------------------------------------------------------
let _fbConnected = false;
onValue(ref(db, '.info/connected'), (snap) => {
    _fbConnected = snap.val() === true;
});
export function isConnected() {
    return _fbConnected;
}

// ---------------------------------------------------------------
// Tenant resolution — parsed once from the URL:
//   ?o=outletId&b=businessId
// OUTLET = `o` query param or first path segment
// BUSINESS_ID = `b` query param (required for new outlets)
// Legacy outlets fall back to legacy map for backward compat.
// ---------------------------------------------------------------
const pathParts = window.location.pathname.split('/').filter(Boolean);
export const OUTLET = new URLSearchParams(window.location.search).get('o') || pathParts[0] || 'pizza';
// Legacy map for backward compatibility with existing QR codes (no ?b= param)
// New outlets MUST pass `?b=businessId` in the URL
// SYNC WARNING: an identical copy of this map lives in
// bot/helpers/outlet-resolution.js (Node CommonJS, can't share an ESM import
// with this browser file). If you add an outlet here, add it there too —
// see docs/FOODHUBBIE-AUDIT-REPORT.md §4.2.
const BUSINESS_BY_OUTLET = { pizza: 'roshani-pizza', cake: 'roshani-cake' };
export const BUSINESS_ID = new URLSearchParams(window.location.search).get('b') || BUSINESS_BY_OUTLET[OUTLET] || 'roshani-pizza';

export function outletRef(path) {
    return ref(db, `businesses/${BUSINESS_ID}/outlets/${OUTLET}/${path}`);
}

// ---------------------------------------------------------------
// Anonymous webview-token mint — delivery DIRECT mode only.
// A bare delivery.html URL (no ?token= from the bot) cannot pass the
// orders rule gate (webviewTokens/{token}/used == false), so at checkout
// we sign in anonymously and create our own one-time token. The rules
// only allow this exact shape, create-only, tied to the signer's uid:
//   phone == 'anonymous', used == false, anonUid == auth.uid
// Bot-issued tokens (real customer phone) are unaffected — they are
// created by the admin-SDK bot, which bypasses rules.
// Minting happens lazily at checkout (not at boot) so the token is
// always fresh and only actual orderers hit Anonymous Auth.
// ---------------------------------------------------------------
export async function mintAnonWebviewToken() {
    const auth = getAuth(app);
    const cred = await signInAnonymously(auth);
    const token = 'anon' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await set(outletRef(`webviewTokens/${token}`), {
        phone: 'anonymous',
        createdAt: new Date().toISOString(),
        used: false,
        anonUid: cred.user.uid,
    });
    return token;
}

export { ref, get, onValue, set, push, update, runTransaction };
