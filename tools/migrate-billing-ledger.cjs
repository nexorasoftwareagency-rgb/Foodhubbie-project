/**
 * migrate-billing-ledger.cjs — one-time live migration (2026-11-05):
 * move the money ledger from businesses/{bid}/outlets/{oid}/billing to the
 * platform-level `walletBilling/{bid}/{oid}` node.
 *
 * Why: RTDB grants are OR'd, not overridden. `businesses/$bid/.write` is
 * granted to the tenant (and cascades to every descendant), so the deeper
 * `.write: isSuper || isSupreme` on `outlets/{oid}/billing` was decoration —
 * a live probe proved an owner could write billing/*. Relocation is the only
 * real fix: `walletBilling` has no tenant-writable ancestor.
 *
 * Rules for the new node: read = super/supreme/own business (Admin Costs tab
 * still works), write = super/supreme only.
 *
 * Usage:
 *   node tools/migrate-billing-ledger.cjs                 # dry run (default)
 *   node tools/migrate-billing-ledger.cjs --apply         # copy + verify
 *   node tools/migrate-billing-ledger.cjs --apply --prune # + delete legacy billing
 *
 * Backup: every --apply run first copies the source nodes to
 *   backup/billing-ledger-migration-<ISO>/{bid}/{oid}
 * so a bad run can be restored with one Admin SDK copy.
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
/** Key-order-independent JSON so a read-back compares by value, not by insertion order. */
function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
}

async function main() {
    const bizSnap = await db.ref('businesses').get();
    const businesses = bizSnap.val() || {};

    const plan = { moves: [], errors: [] };
    for (const [bid, biz] of Object.entries(businesses)) {
        for (const [oid, outlet] of Object.entries((biz && biz.outlets) || {})) {
            const legacy = outlet && outlet.billing;
            if (!legacy) continue;
            const to = `walletBilling/${bid}/${oid}`;
            plan.moves.push({
                from: `businesses/${bid}/outlets/${oid}/billing`,
                to,
                record: strip(legacy),
            });
        }
    }

    // Also report targets that already exist (a re-run, or a fresh onboarding
    // under the new path) so nothing is silently overwritten.
    for (const p of plan.moves) {
        const existing = (await db.ref(p.to).get()).val();
        if (existing != null) {
            if (stable(existing) !== stable(p.record)) {
                p.conflict = true;
                plan.errors.push(`${p.to} already exists and DIFFERS — legacy data will NOT overwrite it`);
            } else {
                p.alreadyMigrated = true;
            }
        }
    }

    console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${PRUNE ? ' + prune legacy' : ''}`);
    console.log(`billing ledgers found: ${plan.moves.length}`);
    for (const p of plan.moves) {
        const tag = p.conflict ? 'CONFLICT' : p.alreadyMigrated ? 'already' : 'move';
        console.log(`  [${tag}] ${p.from} -> ${p.to}`);
    }
    if (plan.errors.length) {
        console.log('\nWARNINGS:');
        for (const e of plan.errors) console.log('  ' + e);
    }

    if (!plan.moves.length) {
        console.log('\nNothing to migrate — no outlet carries a legacy billing node.');
        if (PRUNE) console.log('Nothing to prune.');
        process.exit(0);
    }
    if (!APPLY) {
        console.log('\nDry run only — pass --apply to write.');
        process.exit(0);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupBase = `backup/billing-ledger-migration-${stamp}`;
    const updates = {};
    const written = [];

    for (const p of plan.moves) {
        if (p.conflict) continue; // never clobber a live ledger
        updates[`${backupBase}/${p.to}`] = p.record;
        if (!p.alreadyMigrated) updates[p.to] = p.record;
        written.push(p);
    }

    console.log(`\nWriting ${Object.keys(updates).length} nodes (backup: ${backupBase}) ...`);
    await db.ref().update(updates);

    // Verify every planned target reads back exactly as the plan.
    let failures = 0;
    for (const p of written) {
        const got = (await db.ref(p.to).get()).val();
        if (stable(got) !== stable(p.record)) {
            failures++;
            console.error(`  MISMATCH ${p.to}`);
        }
    }
    console.log(`verify: ${written.length - failures}/${written.length} OK`);
    if (failures) {
        console.error('\nVerification failed — legacy nodes were NOT pruned. Restore from the backup above if needed.');
        process.exit(1);
    }

    if (PRUNE) {
        console.log('\nPruning legacy businesses/*/outlets/*/billing ...');
        let pruned = 0;
        for (const p of written) {
            await db.ref(p.from).remove();
            pruned++;
        }
        console.log(`legacy nodes removed: ${pruned}`);
    } else {
        console.log('\nLegacy nodes left in place. Re-run with --apply --prune once the apps are deployed and verified.');
    }
    console.log('\nMigration complete.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
