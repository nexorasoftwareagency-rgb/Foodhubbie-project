const admin = require('firebase-admin');

// =============================
// FIREBASE CONFIG
// =============================
const FIREBASE_URL = "https://foodhubbie-10-default-rtdb.firebaseio.com";

// Try to load service account from file
try {
    const fs = require('fs');
    const path = require('path');
    const serviceAccountPath = path.join(__dirname, 'service-account.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: FIREBASE_URL
            });
        }
    } else {
        // No service account file - use default
        if (!admin.apps.length) {
            admin.initializeApp({
                databaseURL: FIREBASE_URL
            });
        }
    }
} catch (e) {
    console.log("Firebase init:", e.message);
    if (!admin.apps.length) {
        admin.initializeApp({
            databaseURL: FIREBASE_URL
        });
    }
}

const db = admin.database();

/**
 * Resolves a database path under the multi-tenant hierarchy.
 * @param {string} path - The relative tenant path (e.g. 'orders', 'bot/commands').
 * @param {string} [outlet='pizza'] - The outlet ID.
 */
function resolvePath(path, outlet = 'pizza') {
    if (!path) return '';

    // Platform-level nodes that remain at root (NOT tenant-scoped)
    const shared = ['admins', 'riders', 'riderStats', 'migrationStatus', 'logs', 'settlements', 'phoneNumberIndex'];
    const rootNode = path.split('/')[0];

    // Already multi-tenant absolute or platform node — return as is
    if (rootNode === 'businesses' || shared.includes(rootNode)) return path;

    // Tenant-scoped: businesses/{bid}/outlets/{oid}/{path}
    const { outletPath, resolveBusinessIdFor } = require('./helpers/outlet-resolution');
    return outletPath(resolveBusinessIdFor(outlet), outlet, path);
}

// =============================
// CACHE LAYER
// =============================
const _cache = new Map();
const DEFAULT_TTL = 30000; // 30 seconds default cache
const SETTINGS_TTL = 300000; // 5 minutes for settings/categories

function getTTL(path) {
    if (path.includes('settings') || path.includes('categories') || path.includes('dishes')) {
        return SETTINGS_TTL;
    }
    return DEFAULT_TTL;
}

async function getData(path, outlet = 'pizza') {
    const resolved = resolvePath(path, outlet);
    const now = Date.now();

    if (_cache.has(resolved)) {
        const cached = _cache.get(resolved);
        if (now < cached.expiry) {
            return cached.data;
        }
    }

    try {
        const snap = await db.ref(resolved).once('value');
        const data = snap.val();
        _cache.set(resolved, { 
            data, 
            expiry: now + getTTL(resolved) 
        });
        return data;
    } catch (err) {
        console.error("GET ERROR:", err, "Path:", path);
        return null;
    }
}

function stripUndefined(obj) {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripUndefined);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        out[k] = v === undefined ? null : stripUndefined(v);
    }
    return out;
}

async function setData(path, data, outlet = 'pizza') {
    try {
        const resolved = resolvePath(path, outlet);
        _cache.delete(resolved);
        await db.ref(resolved).set(stripUndefined(data));
        return true;
    } catch (err) {
        console.error("SET ERROR:", err, "Path:", path);
        return false;
    }
}
async function updateData(path, data, outlet = 'pizza') {
    try {
        const resolved = resolvePath(path, outlet);
        _cache.delete(resolved);
        await db.ref(resolved).update(stripUndefined(data));
    } catch (err) {
        console.error("UPDATE ERROR:", err, "Path:", path);
    }
}

async function pushData(path, data, outlet = 'pizza') {
    try {
        const resolved = resolvePath(path, outlet);
        _cache.delete(resolved);
        await db.ref(resolved).push(stripUndefined(data));
    } catch (err) {
        console.error("PUSH ERROR:", err, "Path:", path);
    }
}
async function deleteData(path, outlet = 'pizza') {
    try {
        const resolved = resolvePath(path, outlet);
        _cache.delete(resolved); // Invalidate cache
        await db.ref(resolved).remove();
    } catch (err) {
        console.error("DELETE ERROR:", err, "Path:", path);
    }
}

async function getUserProfile(jid, outlet = 'pizza') {
    const cleanJid = jid.replace(/[^0-9]/g, '');
    const path = `profiles/${cleanJid}`;
    return getData(path, outlet);
}

async function saveUserProfile(jid, data, outlet = 'pizza') {
    const cleanJid = jid.replace(/[^0-9]/g, '');
    const path = `profiles/${cleanJid}`;
    _cache.delete(resolvePath(path, outlet));
    return updateData(path, data, outlet);
}

// =============================
// EXPORT
// =============================
module.exports = {
    db,
    resolvePath,
    getData,
    setData,
    updateData,
    deleteData,
    pushData,
    getUserProfile,
    saveUserProfile,
    stripUndefined
};
