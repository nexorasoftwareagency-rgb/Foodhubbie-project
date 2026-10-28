#!/usr/bin/env node
/**
 * Backfill `businessId` on legacy `admins/{uid}` nodes.
 *
 * Why: `database.rules.json` scopes every tenant read to
 * `admins.businessId == $businessId` (with an `outletIndex` fallback for
 * legacy nodes). Admins created before the staff/business split have an
 * `outlet` but no `businessId`; supers/supremes are exempt by rule and are
 * deliberately skipped (a pinned businessId would break the outlet switcher).
 *
 * Idempotent: only fills nodes where `businessId` is missing.
 * Dry-run by default; pass --apply to write.
 *
 *   node tools/backfill-admin-business-id.cjs
 *   node tools/backfill-admin-business-id.cjs --apply
 */

const path = require('path');
const admin = require(path.join(__dirname, '..', 'bot', 'node_modules', 'firebase-admin'));
const serviceAccount = require(path.join(__dirname, '..', 'bot', 'service-account.json'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
});

const APPLY = process.argv.includes('--apply');

(async () => {
    const db = admin.database();
    const [adminsSnap, outletIndexSnap] = await Promise.all([
        db.ref('admins').once('value'),
        db.ref('outletIndex').once('value'),
    ]);
    const admins = adminsSnap.val() || {};
    const outletIndex = outletIndexSnap.val() || {};

    // Fallback for outlets missing from outletIndex (e.g. outlets provisioned
    // before the registry existed): find the single business that owns it.
    const businessesSnap = await db.ref('businesses').once('value');
    const businesses = businessesSnap.val() || {};
    const bidByOutlet = {};
    for (const [bid, b] of Object.entries(businesses)) {
        for (const oid of Object.keys((b && b.outlets) || {})) {
            const key = oid.toLowerCase();
            if (bidByOutlet[key] && bidByOutlet[key] !== bid) bidByOutlet[key] = '__ambiguous__';
            else bidByOutlet[key] = bid;
        }
    }

    const plan = [];
    const skipped = [];
    for (const [uid, a] of Object.entries(admins)) {
        if (a.isSuper === true || a.isSupreme === true) { skipped.push([uid, 'super/supreme (exempt)']); continue; }
        if (a.businessId) continue;
        const oid = String(a.outlet || '').toLowerCase().trim();
        const bid = (outletIndex[oid] && outletIndex[oid].bid) || bidByOutlet[oid];
        if (!oid || !bid || bid === '__ambiguous__') { skipped.push([uid, `no resolvable business for outlet "${a.outlet}"`]); continue; }
        plan.push([uid, bid]);
    }

    console.log(`admins: ${Object.keys(admins).length} | to backfill: ${plan.length} | skipped: ${skipped.length}`);
    for (const [uid, bid] of plan) console.log(`  ${uid} -> ${bid}`);
    for (const [uid, why] of skipped) console.log(`  skip ${uid}: ${why}`);

    if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }

    for (const [uid, bid] of plan) {
        await db.ref(`admins/${uid}/businessId`).set(bid);
    }
    console.log(`\nApplied ${plan.length} write(s).`);
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
