/**
 * migrate-riders-outlet.cjs — one-time live migration (2026-10-28):
 * move `riders`, `riderStats`, `settlements` from platform root to
 * businesses/{bid}/outlets/{oid}/ (staff pattern) and backfill `riderIndex`.
 *
 * Why: rider data used to be a global root node, so any admin (including a
 * future demo account) could read every tenant's riders. Outlet scoping fixes
 * that structurally, exactly like staff/attendance/payroll.
 *
 * The rider app cannot read `businesses` (rules gate it to admins), so
 * `riderIndex/{uid} = { bid, outlet }` is its bootstrap pointer.
 *
 * Usage:
 *   node tools/migrate-riders-outlet.cjs                 # dry run (default)
 *   node tools/migrate-riders-outlet.cjs --apply         # write + verify
 *   node tools/migrate-riders-outlet.cjs --apply --prune # + delete root nodes
 *
 * Backup: every run with --apply first copies the root nodes to
 *   backup/riders-outlet-migration-<ISO>/{riders,riderStats,settlements}
 * so a bad run can be restored with a single Admin SDK copy.
 */
'use strict';
const path = require('node:path');
const admin = require('../bot/node_modules/firebase-admin');

const SA = process.env.FIREBASE_SA || path.join(__dirname, '..', 'Credentials', 'foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json');
const DB_URL = process.env.FIREBASE_DB_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';

const APPLY = process.argv.includes('--apply');
const PRUNE = process.argv.includes('--prune');

admin.initializeApp({ credential: admin.credential.cert(require(SA)), databaseURL: DB_URL });
const db = admin.database();

const strip = (o) => JSON.parse(JSON.stringify(o));

async function main() {
    const [ridersSnap, statsSnap, settleSnap, indexSnap] = await Promise.all([
        db.ref('riders').get(),
        db.ref('riderStats').get(),
        db.ref('settlements').get(),
        db.ref('outletIndex').get(),
    ]);
    const riders = ridersSnap.val() || {};
    const riderStats = statsSnap.val() || {};
    const settlements = settleSnap.val() || {};
    const outletIndex = indexSnap.val() || {};

    const plan = { riders: [], stats: [], settlements: [], errors: [] };
    const scope = {}; // uid -> { bid, outlet }

    for (const [uid, rider] of Object.entries(riders)) {
        const r = rider || {};
        const outlet = r.outlet;
        const bid = r.businessId || (outlet && outletIndex[outlet] && outletIndex[outlet].bid);
        if (!outlet || !bid) {
            plan.errors.push(`rider ${uid} (${r.name || '?'}): missing outlet/businessId — skipped`);
            continue;
        }
        scope[uid] = { bid, outlet };
        plan.riders.push({
            uid,
            from: `riders/${uid}`,
            to: `businesses/${bid}/outlets/${outlet}/riders/${uid}`,
            index: `riderIndex/${uid}`,
            record: { ...strip(r), outlet, businessId: bid },
        });
    }

    for (const [uid, stats] of Object.entries(riderStats)) {
        if (!scope[uid]) { plan.errors.push(`riderStats/${uid}: no matching rider — skipped`); continue; }
        plan.stats.push({
            from: `riderStats/${uid}`,
            to: `businesses/${scope[uid].bid}/outlets/${scope[uid].outlet}/riderStats/${uid}`,
            record: strip(stats),
        });
    }

    for (const [uid, list] of Object.entries(settlements)) {
        if (!scope[uid]) { plan.errors.push(`settlements/${uid}: no matching rider — skipped`); continue; }
        plan.settlements.push({
            from: `settlements/${uid}`,
            to: `businesses/${scope[uid].bid}/outlets/${scope[uid].outlet}/settlements/${uid}`,
            record: strip(list),
        });
    }

    console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${PRUNE ? ' + prune root' : ''}`);
    console.log(`riders: ${plan.riders.length}  riderStats: ${plan.stats.length}  settlements: ${plan.settlements.length}`);
    for (const p of plan.riders) console.log(`  ${p.from} -> ${p.to}`);
    for (const p of plan.stats) console.log(`  ${p.from} -> ${p.to}`);
    for (const p of plan.settlements) console.log(`  ${p.from} -> ${p.to}`);
    if (plan.errors.length) {
        console.log('\nWARNINGS:');
        for (const e of plan.errors) console.log('  ' + e);
    }

    if (!APPLY) {
        console.log('\nDry run only — pass --apply to write.');
        process.exit(0);
    }
    if (plan.riders.length === 0) {
        console.log('\nNothing to migrate (root riders is empty) — aborting.');
        process.exit(0);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupBase = `backup/riders-outlet-migration-${stamp}`;
    const updates = {};

    // Backup first (Admin SDK bypasses rules; this node is not app-readable).
    if (ridersSnap.exists()) updates[`${backupBase}/riders`] = strip(riders);
    if (statsSnap.exists()) updates[`${backupBase}/riderStats`] = strip(riderStats);
    if (settleSnap.exists()) updates[`${backupBase}/settlements`] = strip(settlements);

    for (const p of plan.riders) {
        updates[p.to] = p.record;
        updates[p.index] = { bid: scope[p.uid].bid, outlet: scope[p.uid].outlet };
    }
    for (const p of plan.stats) updates[p.to] = p.record;
    for (const p of plan.settlements) updates[p.to] = p.record;

    console.log(`\nWriting ${Object.keys(updates).length} nodes (backup: ${backupBase}) ...`);
    await db.ref().update(updates);

    // Verify: every record reads back exactly as planned.
    const checks = [...plan.riders, ...plan.stats, ...plan.settlements];
    let failures = 0;
    for (const p of checks) {
        const got = (await db.ref(p.to).get()).val();
        const want = p.record;
        if (JSON.stringify(got) !== JSON.stringify(want)) {
            failures++;
            console.error(`  MISMATCH ${p.to}`);
        }
    }
    for (const p of plan.riders) {
        const got = (await db.ref(p.index).get()).val();
        if (!got || got.bid !== scope[p.uid].bid || got.outlet !== scope[p.uid].outlet) {
            failures++;
            console.error(`  INDEX MISMATCH ${p.index}`);
        }
    }
    console.log(`verify: ${checks.length + plan.riders.length - failures}/${checks.length + plan.riders.length} OK`);
    if (failures) {
        console.error('\nVerification failed — root nodes were NOT pruned. Restore from the backup above if needed.');
        process.exit(1);
    }

    if (PRUNE) {
        console.log('\nPruning root riders / riderStats / settlements ...');
        await db.ref('riders').remove();
        await db.ref('riderStats').remove();
        await db.ref('settlements').remove();
        console.log('root nodes removed.');
    } else {
        console.log('\nRoot nodes left in place. Re-run with --apply --prune once the apps are deployed and verified.');
    }
    console.log('\nMigration complete.');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
