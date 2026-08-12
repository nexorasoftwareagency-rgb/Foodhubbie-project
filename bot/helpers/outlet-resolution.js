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

// Two restaurants = two businesses, each with one outlet.
const DEFAULT_BUSINESS_ID = 'roshani-pizza';
const BUSINESS_BY_OUTLET = { pizza: 'roshani-pizza', cake: 'roshani-cake' };

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

/** businessId for an outlet — env wins, else the per-outlet map. */
function resolveBusinessIdFor(outletId) {
    if (process.env.BUSINESS_ID) return process.env.BUSINESS_ID;
    return BUSINESS_BY_OUTLET[outletId] || DEFAULT_BUSINESS_ID;
}

async function getOutlet(db, businessId, outletId) {
    const ref = db.ref(outletPath(businessId, outletId));
    const snap = await ref.once('value');
    return snap.exists() ? snap.val() : null;
}

async function listOutlets(db, businessId) {
    const ref = db.ref(`businesses/${businessId || resolveBusinessId()}/outlets`);
    const snap = await ref.once('value');
    return snap.exists() ? snap.val() : {};
}

async function addOutlet(db, businessId, outletId, data) {
    const ref = db.ref(outletPath(businessId, outletId));
    await ref.set(data);
    return true;
}

async function updateOutlet(db, businessId, outletId, patch) {
    const ref = db.ref(outletPath(businessId, outletId));
    await ref.update(patch);
    return true;
}

module.exports = {
    DEFAULT_BUSINESS_ID,
    resolveBusinessId,
    resolveBusinessIdFor,
    resolveOutletId,
    outletPath,
    resolvePath,
    getOutlet,
    listOutlets,
    addOutlet,
    updateOutlet
};