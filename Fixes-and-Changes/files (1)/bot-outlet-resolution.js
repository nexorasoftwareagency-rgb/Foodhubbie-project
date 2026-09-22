/**
 * outlet-resolution.js — THE pivot point for the multi-tenant refactor.
 *
 * Every tenant-scoped read/write in the stack resolves through one of these
 * helpers, so `businesses/{bid}/outlets/{oid}` is guaranteed to read and
 * write a matching path across bot, menu, Admin and rider-app.
 *
 * Shared nodes (admins, riders, settlements, riderStats, logs, migrationStatus)
 * intentionally stay at root — they are platform-level, not tenant-level.
 *
 * When BUSINESS_ID / OUTLET_ID env vars are present (orchestrator sets them,
 * see MASTER-DEPLOYMENT-GUIDE Section 10), they win. Otherwise we fall back
 * to OUTLET (legacy single-outlet driver) for a per-outlet default.
 */
'use strict';

// Legacy map for backward compatibility with existing QR codes (no ?b= param)
// New outlets MUST pass BUSINESS_ID env var or ?b= in URL
// SYNC WARNING: an identical copy of this map lives in menu/js/firebase.js
// (browser ESM, can't share a CommonJS require() with this file). If you
// add an outlet here, add it there too — see docs/FOODHUBBIE-AUDIT-REPORT.md §4.2.
const DEFAULT_BUSINESS_ID = 'roshani-pizza';
const BUSINESS_BY_OUTLET = { pizza: 'roshani-pizza', cake: 'roshani-cake' };

// In-memory reverse index for O(1) outlet -> businessId lookup
// Populated at startup via initializeOutletBusinessIndex
const outletToBusinessIdCache = new Map();

function resolveBusinessId() {
    return resolveBusinessIdFor(resolveOutletId());
}

function resolveOutletId() {
    return process.env.OUTLET_ID || process.env.OUTLET || 'pizza';
}

/**
 * Build a multi-tenant path string.
 * @param {string} businessId
 * @param {string} outletId
 * @param {...string} rest path segments under the outlet
 * @returns {string} businesses/{bid}/outlets/{oid}/rest...
 */
function outletPath(businessId, outletId, ...rest) {
    const bid = businessId || resolveBusinessId();
    const oid = outletId || resolveOutletId();
    const tail = rest.filter(Boolean).join('/');
    return `businesses/${bid}/outlets/${oid}${tail ? `/${tail}` : ''}`;
}

/**
 * @param {object} scope `{ businessId, outletId }` — optional, overrides env.
 * @param {...string} rest path segments under the outlet
 */
function resolvePath(scope, ...rest) {
    const outletId = scope?.outletId || resolveOutletId();
    const businessId = scope?.businessId || resolveBusinessIdFor(outletId);
    return outletPath(businessId, outletId, ...rest);
}

/** businessId for an outlet — env wins, else reverse index, else legacy map, else throw. */
function resolveBusinessIdFor(outletId) {
    // 1. Explicit env var (orchestrator sets per-instance)
    if (process.env.BUSINESS_ID) return process.env.BUSINESS_ID;
    // 2. Reverse index (O(1) - populated at startup)
    if (outletToBusinessIdCache.has(outletId)) return outletToBusinessIdCache.get(outletId);
    // 3. Legacy map (for backward compat with existing QR codes)
    if (BUSINESS_BY_OUTLET[outletId]) return BUSINESS_BY_OUTLET[outletId];
    // 4. Default for original pizza outlet
    if (outletId === 'pizza') return DEFAULT_BUSINESS_ID;
    // 5. Fallback (should not happen for new outlets with env var)
    console.warn(`[outlet-resolution] No businessId found for outlet: ${outletId}, using default`);
    return DEFAULT_BUSINESS_ID;
}

/** Initialize reverse index from Firebase — call once at startup */
async function initializeOutletBusinessIndex(db) {
    const businessesSnap = await db.ref('businesses').once('value');
    const businesses = businessesSnap.val() || {};
    for (const [bid, business] of Object.entries(businesses)) {
        const outlets = business.outlets || {};
        for (const [oid] of Object.entries(outlets)) {
            if (!outletToBusinessIdCache.has(oid)) {
                outletToBusinessIdCache.set(oid, bid);
            }
        }
    }
    console.log(`[outlet-resolution] Initialized reverse index with ${outletToBusinessIdCache.size} outlets`);
}

module.exports = {
    DEFAULT_BUSINESS_ID,
    resolveBusinessId,
    resolveBusinessIdFor,
    resolveOutletId,
    outletPath,
    resolvePath,
    initializeOutletBusinessIndex
};