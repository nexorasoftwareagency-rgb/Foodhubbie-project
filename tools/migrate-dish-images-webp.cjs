/**
 * migrate-dish-images-webp.cjs — one-time live migration (2026-10-29):
 * re-encode every existing base64 JPEG photo in `dishes`, `categories`,
 * `combos` to WebP (quality 75, same as the Admin canvas encoder) and
 * re-mirror the converted images to menuBank entries for the same outlet.
 *
 * Scope is hard-coded on purpose:
 *   CONVERT : `data:image/jpeg;base64,...` values under
 *             businesses/{bid}/outlets/{oid}/{dishes,categories,combos}/<id>/image
 *   SKIP    : data:image/webp (already done), data:image/png (kept: transparency),
 *             remote URLs, and — never touched — promotions/**, riders/**,
 *             tableSessions/**, outlet.whatsapp. menuBank is re-mirrored,
 *             never converted.
 *
 * Rollback: before writing, the original value of every converted image is
 * copied to businesses/{bid}/outlets/{oid}/metadata/imageMigrationBackup/
 * {node}/{dishId} in the SAME multi-location update — a bad run is undone with
 * `node tools/migrate-dish-images-webp.cjs --restore --bid B --outlet O`.
 *
 * Writes are ONE single multi-location update per tenant (all converted images
 * + all backups + the version marker together) so an outlet can never be left
 * with a converted image and no backup. menuBank mirrors are a second,
 * narrowly-scoped update (image + updatedAt on EXISTING bank entries only).
 *
 * Usage:
 *   node tools/migrate-dish-images-webp.cjs                      # dry run, ALL indexed outlets
 *   node tools/migrate-dish-images-webp.cjs --bid B --outlet O   # dry run, one tenant
 *   node tools/migrate-dish-images-webp.cjs --apply [--bid B --outlet O]
 *   node tools/migrate-dish-images-webp.cjs --restore --bid B --outlet O
 */
'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const admin = require(path.join(__dirname, '..', 'bot', 'node_modules', 'firebase-admin'));

const DB_URL = process.env.FIREBASE_DB_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const SA = process.env.FIREBASE_SA || path.join(__dirname, '..', 'bot', 'service-account.json');

const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore');
const argFor = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
};
const ONLY_BID = argFor('--bid');
const ONLY_OUTLET = argFor('--outlet');

const WEBP_QUALITY = '75';
const NODES = ['dishes', 'categories', 'combos'];

admin.initializeApp({ credential: admin.credential.cert(require(SA)), databaseURL: DB_URL });
const db = admin.database();

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const slugify = (name) => (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)) || 'item';

/** JPEG data-URL -> WebP data-URL via ffmpeg libwebp. Returns null on any failure/tiny gain. */
function toWebpDataUrl(dataUrl) {
    const b64 = dataUrl.slice('data:image/jpeg;base64,'.length);
    const raw = Buffer.from(b64, 'base64');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webp-mig-'));
    try {
        const src = path.join(dir, 'in.jpeg');
        const out = path.join(dir, 'out.webp');
        fs.writeFileSync(src, raw);
        const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libwebp', '-quality', WEBP_QUALITY, out], { timeout: 30000 });
        if (r.status !== 0 || !fs.existsSync(out)) {
            console.error(`    ffmpeg failed (status ${r.status}): ${String(r.stderr || '').trim().slice(0, 200)}`);
            return null;
        }
        const next = `data:image/webp;base64,${fs.readFileSync(out).toString('base64')}`;
        // Honest guard: never swap in a WebP that is not actually smaller than the JPEG.
        if (Buffer.byteLength(next) >= Buffer.byteLength(dataUrl)) {
            console.error(`    webp not smaller than jpeg — keeping jpeg (${kb(Buffer.byteLength(dataUrl))})`);
            return null;
        }
        return next;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Enumerate known tenants via outletIndex ({oid: {bid}}), optionally narrowed by --bid/--outlet. */
async function listOutlets() {
    const idx = (await db.ref('outletIndex').get()).val() || {};
    const out = [];
    for (const [oid, v] of Object.entries(idx)) {
        const bid = v && typeof v === 'object' ? v.bid : v;
        if (!bid || typeof bid !== 'string') continue;
        if (ONLY_BID && bid !== ONLY_BID) continue;
        if (ONLY_OUTLET && oid !== ONLY_OUTLET) continue;
        out.push({ bid, oid });
    }
    // An outlet that is deliberately absent from outletIndex (test tenants) can
    // still be targeted by giving BOTH --bid and --outlet.
    if (ONLY_BID && ONLY_OUTLET && !out.some((o) => o.oid === ONLY_OUTLET)) out.push({ bid: ONLY_BID, oid: ONLY_OUTLET });
    return out;
}

async function restoreOneOutlet({ bid, oid }) {
    const backupRef = db.ref(`businesses/${bid}/outlets/${oid}/metadata/imageMigrationBackup`);
    const backup = (await backupRef.get()).val();
    const count = backup ? Object.values(backup).reduce((s, n) => s + Object.keys(n).length, 0) : 0;
    if (!count) { console.log(`  [${oid}] no backup node — nothing to restore`); return; }
    if (!APPLY) { console.log(`  [${oid}] DRY RUN — would restore ${count} images from backup`); return; }
    const updates = {};
    for (const [node, items] of Object.entries(backup)) {
        for (const [id, oldUrl] of Object.entries(items)) updates[`${node}/${id}/image`] = oldUrl;
    }
    await db.ref(`businesses/${bid}/outlets/${oid}`).update(updates);
    console.log(`  [${oid}] RESTORED ${Object.keys(updates).length} images (backup node kept for safety)`);
}

async function migrateOneOutlet({ bid, oid }, bank) {
    const base = `businesses/${bid}/outlets/${oid}`;
    const outlet = (await db.ref(base).get()).val();
    if (!outlet) { console.log(`  [${oid}] outlet node missing/empty — skipped`); return; }

    const tenantUpdates = {};
    const bankMirrors = []; // { relPath under menuBank/, image }
    const stats = Object.fromEntries(NODES.map((n) => [n, { converted: 0, skipped: 0, before: 0, after: 0 }]));

    for (const node of NODES) {
        for (const [id, item] of Object.entries(outlet[node] || {})) {
            const img = item && item.image;
            if (!img || typeof img !== 'string') continue;
            if (img.startsWith('data:image/webp')) { stats[node].skipped++; continue; }
            if (!img.startsWith('data:image/jpeg;base64,')) { stats[node].skipped++; continue; }

            const next = toWebpDataUrl(img);
            if (!next) { stats[node].skipped++; continue; }

            tenantUpdates[`${node}/${id}/image`] = next;
            tenantUpdates[`metadata/imageMigrationBackup/${node}/${id}`] = img;
            stats[node].converted++;
            stats[node].before += Buffer.byteLength(img);
            stats[node].after += Buffer.byteLength(next);

            // Re-mirror onto this outlet's EXISTING bank entry only (slug math = shared/menu-bank.js).
            const key = node === 'categories'
                ? slugify(`${item.name}-${oid}`)
                : slugify(`${item.name}-${item.category || 'other'}-${oid}`);
            const bucket = node === 'categories' ? bank.categories : bank.dishes;
            if (bucket && bucket[key]) {
                bankMirrors.push({ rel: `${node}/${key}`, image: next });
            }
        }
    }

    const totalBefore = NODES.reduce((s, n) => s + stats[n].before, 0);
    const totalAfter = NODES.reduce((s, n) => s + stats[n].after, 0);
    const totalConv = NODES.reduce((s, n) => s + stats[n].converted, 0);
    console.log(`  [${oid}] converted ${totalConv} jpeg images` +
        (totalConv ? `: ${kb(totalBefore)} -> ${kb(totalAfter)} on the outlet node (${Math.round((1 - totalAfter / totalBefore) * 100)}% smaller)` : ''));
    for (const node of NODES) {
        const s = stats[node];
        if (s.before || s.skipped) console.log(`      ${node}: ${s.converted} converted, ${s.skipped} skipped (webp/non-jpeg), ${s.before ? `${kb(s.before)} -> ${kb(s.after)}` : 'no jpeg found'}`);
    }
    if (totalConv) console.log(`      menuBank mirrors due: ${bankMirrors.length}`);

    if (!totalConv) return;
    if (!APPLY) { console.log('      DRY RUN — no writes'); return; }

    tenantUpdates['metadata/imageWebpMigration'] = { at: admin.database.ServerValue.TIMESTAMP, converted: totalConv, by: 'migrate-dish-images-webp' };
    await db.ref(base).update(tenantUpdates);

    if (bankMirrors.length) {
        const bankUpdates = {};
        for (const m of bankMirrors) {
            bankUpdates[`menuBank/${m.rel}/image`] = m.image;
            bankUpdates[`menuBank/${m.rel}/updatedAt`] = admin.database.ServerValue.TIMESTAMP;
        }
        await db.ref().update(bankUpdates);
    }

    // Verify by re-reading the tenant node.
    const vout = (await db.ref(base).get()).val() || {};
    let webp = 0, jpegLeft = 0;
    for (const node of NODES) {
        for (const [, item] of Object.entries(vout[node] || {})) {
            if (!item || !item.image) continue;
            if (item.image.startsWith('data:image/webp')) webp++;
            else if (item.image.startsWith('data:image/jpeg')) jpegLeft++;
        }
    }
    console.log(`  [${oid}] APPLIED (+${bankMirrors.length} menuBank mirror images). Verify: ${webp} webp, ${jpegLeft} jpeg remaining (skipped-by-design stay).`);
}

async function main() {
    console.log(`migrate-dish-images-webp: mode=${RESTORE ? 'RESTORE' : APPLY ? 'APPLY' : 'DRY RUN'}`);
    if (!RESTORE) {
        const ff = spawnSync('ffmpeg', ['-version']);
        if (ff.error || ff.status !== 0) {
            console.error('ERROR: ffmpeg unavailable on this machine — cannot encode webp. Run on the EC2 box or install ffmpeg.');
            process.exit(2);
        }
    }

    const outlets = await listOutlets();
    if (!RESTORE && !outlets.length) { console.error('no outlets matched (outletIndex empty or filter wrong)'); process.exit(2); }
    if (outlets.length) console.log(`outlets: ${outlets.map((o) => `${o.oid}@${o.bid}`).join(', ')}`);

    let bank = { dishes: {}, categories: {} };
    if (!RESTORE) bank = (await db.ref('menuBank').get()).val() || bank;

    for (const o of outlets) {
        if (RESTORE) await restoreOneOutlet(o);
        else await migrateOneOutlet(o, bank);
    }
    console.log('done.');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
