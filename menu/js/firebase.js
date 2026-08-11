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
 * This file intentionally does NOT use Firebase Auth. Access control is
 * enforced entirely by Realtime Database Security Rules, not by a login
 * wall, since customers must never need to sign in to order food.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getDatabase, ref, get, onValue, set, push, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Paste the SAME config values used in Admin/firebase-config.js.
// This is safe to expose publicly — Firebase config is not a secret,
// access control lives in the Security Rules, not in this object.
const firebaseConfig = {
    apiKey: "AIzaSyDcx-SN5eak8PAs-8NtTGelJ_sICr5yb7Y",
    authDomain: "prashant-pizza-e86e4.firebaseapp.com",
    databaseURL: "https://prashant-pizza-e86e4-default-rtdb.firebaseio.com",
    projectId: "prashant-pizza-e86e4",
    storageBucket: "prashant-pizza-e86e4.firebasestorage.app",
    messagingSenderId: "857471482885",
    appId: "1:857471482885:web:9eb8bbb90c77c588fbb06c"
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
//   https://menu.roshani.com/pizza/?t=7YH8K2P4X9F6M2A&b=roshani
// OUTLET = first path segment; BUSINESS_ID = `b` query param
// (defaults to 'roshani'). If your deployment serves a single
// outlet from a fixed subdomain, hardcode OUTLET instead.
// ---------------------------------------------------------------
const pathParts = window.location.pathname.split('/').filter(Boolean);
export const OUTLET = pathParts[0] || 'pizza';
export const BUSINESS_ID = new URLSearchParams(window.location.search).get('b') || 'roshani';

export function outletRef(path) {
    return ref(db, `businesses/${BUSINESS_ID}/outlets/${OUTLET}/${path}`);
}

export { ref, get, onValue, set, push, update, runTransaction };
