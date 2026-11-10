import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, onValue, onChildAdded, onChildChanged, set, update, remove, push, runTransaction, query, orderByChild, orderByKey, equalTo, limitToLast, startAt, endAt, endBefore, serverTimestamp, child, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut, EmailAuthProvider, sendPasswordResetEmail, sendEmailVerification, createUserWithEmailAndPassword, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { showToast } from './ui-utils.js';

const firebaseConfig = window.firebaseConfig;
if (!firebaseConfig) {
    throw new Error("Firebase configuration (window.firebaseConfig) is missing. Check firebase-config.js.");
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(e => console.warn('[Auth] Persistence error:', e));

// ponytail: App Check removed — admin panel is auth-gated, reCAPTCHA added 776KB waste
let _fbConnected = false;
const _connWatchers = [];

const connectedRef = ref(db, '.info/connected');
onValue(connectedRef, (snap) => {
    const connected = snap.val() === true;
    _fbConnected = connected;
    const indicator = document.getElementById('syncStatus');
    if (indicator) {
        if (connected) {
            indicator.classList.remove('disconnected', 'connecting');
            indicator.classList.add('connected');
            indicator.title = "Firebase: Connected";
        } else {
            indicator.classList.remove('connected', 'connecting');
            indicator.classList.add('disconnected');
            indicator.title = "Firebase: Disconnected - Check Network";
        }
    }
    if (typeof updateConnectionIndicator === 'function') {
        updateConnectionIndicator(connected);
    }
    if (!connected) {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!isLocal) {
            console.warn('[Firebase] Lost connection - data may not sync. Retrying...');
        }
    } else {
        console.log('[Firebase] Connection restored.');
    }
    _connWatchers.slice().forEach(fn => { try { fn(connected); } catch (e) { console.error('[FB] conn watcher error', e); } });
});

export function isConnected() {
    return _fbConnected;
}

export function onConnectionChange(fn) {
    _connWatchers.push(fn);
    return () => {
        const i = _connWatchers.indexOf(fn);
        if (i >= 0) _connWatchers.splice(i, 1);
    };
}

// Two restaurants = two businesses, each with one outlet.
export const BUSINESS_BY_OUTLET = { pizza: 'roshani-pizza', cake: 'roshani-cake' };
export const BUSINESS_ID = () => {
    const explicit = (window.currentBusinessId || '').toLowerCase().trim();
    if (explicit) return explicit;
    return BUSINESS_BY_OUTLET[Outlet.current] || 'roshani-pizza';
};

// Tenant-scoped ref: businesses/{bid}/outlets/{outlet}/{path}
export function tenantRef(outlet, path) {
    const oid = (outlet || 'pizza').toLowerCase().trim() || 'pizza';
    const cleanPath = (path || '').replace(/^\/+/, '');
    return ref(db, `businesses/${BUSINESS_ID()}/outlets/${oid}${cleanPath ? `/${cleanPath}` : ''}`);
}

// Tenant-scoped path string (for multi-path update objects).
export function tenantPath(outlet, path) {
    const oid = (outlet || 'pizza').toLowerCase().trim() || 'pizza';
    const cleanPath = (path || '').replace(/^\/+/, '');
    return `businesses/${BUSINESS_ID()}/outlets/${oid}${cleanPath ? `/${cleanPath}` : ''}`;
}

// Money ledger ref: walletBilling/{bid}/{oid} — a ROOT node on purpose.
// businesses/{bid}/.write is granted to the tenant, and an ancestor grant
// cannot be denied deeper down, so money must live outside that subtree.
// Read = super/supreme/own business; write = super/supreme only.
export function billingRef(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    return ref(db, `walletBilling/${BUSINESS_ID()}/${Outlet.current}${cleanPath ? `/${cleanPath}` : ''}`);
}

export function billingPath(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    return `walletBilling/${BUSINESS_ID()}/${Outlet.current}${cleanPath ? `/${cleanPath}` : ''}`;
}

export const Outlet = {
    get current() {
        let outlet = window.currentOutlet || sessionStorage.getItem('adminSelectedOutlet') || 'pizza';
        outlet = outlet.toLowerCase().trim();
        if (!outlet) outlet = 'pizza';
        return outlet;
    },
    ref(path) {
        if (!path) return ref(db);
        // Platform-level nodes that remain at root (NOT tenant-scoped)
        const globalPaths = ['admins', 'logs', 'migrationStatus', 'menuBank'];
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        const firstSegment = cleanPath.split('/')[0];
        if (globalPaths.includes(firstSegment)) {
            return ref(db, cleanPath);
        }
        return tenantRef(this.current, cleanPath);
    },
    // New tenant-scoped refs for staff & audit
    staff(uid) { return ref(db, `businesses/${BUSINESS_ID()}/outlets/${this.current}/staff/${uid}`); },
    staffCeilings(uid) { return ref(db, `businesses/${BUSINESS_ID()}/outlets/${this.current}/settings/Security/staffCeilings/${uid}`); },
    managerPinHash() { return ref(db, `businesses/${BUSINESS_ID()}/outlets/${this.current}/settings/Security/managerPinHash`); },
    staffChanges() { return ref(db, `businesses/${BUSINESS_ID()}/outlets/${this.current}/audit/staffChanges`); },
    discountApprovals() { return ref(db, `businesses/${BUSINESS_ID()}/outlets/${this.current}/audit/discountApprovals`); },
    multiUpdate(updates) {
        return update(tenantRef(this.current), updates);
    }
};

window.diagnoseDatabase = async () => {
    console.log("DATABASE DIAGNOSTIC START");
    console.log("1. App initialized:", !!app);
    console.log("2. Database reference:", !!db);
    console.log("3. Current user:", auth.currentUser?.email || "Not logged in");
    console.log("4. Current outlet:", window.currentOutlet || "Not set");
    console.log("5. Outlet resolved path:", Outlet.ref("orders").toString());
    try {
        const connectedSnap = await get(ref(db, '.info/connected'));
        console.log("6. Connection status:", connectedSnap.val() ? "Connected" : "Disconnected");
    } catch (e) {
        console.error("6. Connection test failed:", e);
    }
    if (auth.currentUser) {
        try {
            const adminSnap = await get(Outlet.ref(`admins/${auth.currentUser.uid}`));
            console.log("7. Admin data exists:", adminSnap.exists());
            console.log("8. Admin data:", adminSnap.val());
        } catch (e) {
            console.error("7. Admin data fetch failed:", e);
        }
    }
    try {
        const ordersRef = Outlet.ref("orders");
        const ordersSnap = await get(query(ordersRef, limitToLast(1)));
        console.log("9. Orders path:", ordersRef.toString());
        console.log("10. Orders accessible:", ordersSnap.exists());
        if (ordersSnap.exists()) {
            console.log("11. Sample order:", Object.keys(ordersSnap.val())[0]);
        }
    } catch (e) {
        console.error("9. Orders fetch failed:", e);
    }
    console.log("DATABASE DIAGNOSTIC COMPLETE");
};

window.forceOutlet = (name) => {
    console.warn(`[Outlet] EMERGENCY OVERRIDE: ${name}`);
    window.currentOutlet = name;
    sessionStorage.setItem('adminSelectedOutlet', name);
    if (window.diagnoseDatabase) window.diagnoseDatabase();
};

// Media writes go through the control API, not the Storage SDK: Storage rules
// cannot read the Realtime Database, and admin identity lives entirely in RTDB
// (root.child('admins')), so a client write would need custom claims this
// project never sets. The API takes bid/oid from the verified ID token.
// ponytail: `bid`/`oid` are kept in the signature for call-site compatibility
// but deliberately ignored — the server decides the tenant.
async function apiBase() {
    if (window.TUNNEL_URL) return window.TUNNEL_URL;
    try {
        const snap = await get(ref(db, 'config/tunnelUrl'));
        const url = snap.val();
        if (url) window.TUNNEL_URL = url;
    } catch { /* fall through — callers report an honest error */ }
    return window.TUNNEL_URL || '';
}

async function apiAuthToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function uploadImage(fileOrBlob, { type, id } = {}) {
    if (!fileOrBlob) return null;
    const token = await apiAuthToken();
    if (!token) throw new Error('Not signed in');
    const base = await apiBase();
    if (!base) throw new Error('Upload service is not configured (config/tunnelUrl missing)');

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.readAsDataURL(fileOrBlob);
    });

    const resp = await fetch(`${base}/tenant-api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ dataUrl, type, id }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || `Upload failed (${resp.status})`);
    return body.url;
}

export async function deleteImage(url) {
    // Legacy rows still hold data: URIs — nothing to delete, and shipping them
    // to the API would be a pointless 100 KB round-trip.
    if (!url || !/^https:\/\//.test(url)) return;
    try {
        const token = await apiAuthToken();
        const base = token ? await apiBase() : '';
        if (!base) return;
        await fetch(`${base}/tenant-api/delete-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ url }),
        });
    } catch (e) {
        console.warn('[Firebase] deleteImage failed:', e.message);
    }
}

let _secondaryAuth, _secondaryAuthAvailable = false;
export function getSecondaryAuth() {
    if (_secondaryAuth) return _secondaryAuth;
    try {
        const secondaryApp = initializeApp(window.firebaseConfig, 'secondary_auth');
        _secondaryAuth = getAuth(secondaryApp);
        _secondaryAuthAvailable = true;
    } catch (e) {
        console.error('Secondary Auth Init Error:', e);
        _secondaryAuthAvailable = false;
    }
    return _secondaryAuth;
}
export function isSecondaryAuthAvailable() { return _secondaryAuthAvailable; }

export {
    db, auth, app,
    ref, get, onValue, onChildAdded, onChildChanged,
    set, update, remove, push, runTransaction,
    query, orderByChild, orderByKey, equalTo, limitToLast, startAt, endAt, endBefore,
    serverTimestamp, child, onDisconnect,
    signInWithEmailAndPassword, signOut,
    setPersistence, browserSessionPersistence,
    onAuthStateChanged, EmailAuthProvider,
    sendPasswordResetEmail, createUserWithEmailAndPassword,
    sendEmailVerification,
    reauthenticateWithCredential, updatePassword
};
