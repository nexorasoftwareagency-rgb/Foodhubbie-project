#!/usr/bin/env node
/**
 * Batch 13 + 15 — move base64 media out of the Realtime Database into Cloud Storage.
 *
 *   node tools/migrate-media-to-storage.cjs                 # dry run, WHOLE estate
 *   node tools/migrate-media-to-storage.cjs --apply         # migrate everything
 *   node tools/migrate-media-to-storage.cjs --bid X --oid Y # narrow to one outlet
 *   node tools/migrate-media-to-storage.cjs --menu-bank     # only menuBank
 *   node tools/migrate-media-to-storage.cjs --verify        # acceptance gate
 *   node tools/migrate-media-to-storage.cjs --restore backup/media-<iso>.json
 *
 * Dry-run by default. Scans every image-bearing branch of every outlet plus the
 * platform-root `menuBank` for strings starting with `data:image/`, uploads each
 * one byte-for-byte (no re-encode: a payment QR must stay scannable, a PNG must
 * keep its alpha), and rewrites the field to the object's download-token URL.
 *
 * Idempotent: values that are already URLs are skipped, so a second run is a
 * no-op. Identical payloads are deduplicated by sha256 across the WHOLE run, so
 * the same dish photo in three tenants and `menuBank` costs one object.
 *
 * Inline SVG (`data:image/svg+xml;charset=utf-8,…`) is NOT migrated: it is text,
 * it is a few KB, and `tools/seed-demo-tenant.cjs` regenerates it nightly. It is
 * counted and reported so the number is never mistaken for base64.
 *
 * Objects:
 *   tenant   -> outlets/{bid}/{oid}/migrated/{branch}/...   (tenant-scoped, so
 *               POST /tenant-api/delete-image can remove it)
 *   menuBank -> platform/menuBank/{branch}/...
 * Reads use per-object download tokens (storage.rules stays deny-all), the same
 * mechanism every live upload uses.
 *
 * A backup of every value it replaces is written before the first write.
 * `--restore` still accepts the v1 files written by the batch-13 run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const admin = require(path.join(ROOT, 'bot/node_modules/firebase-admin'));
const sa = require(path.join(ROOT, 'bot/service-account.json'));

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'foodhubbie-10.firebasestorage.app';

// Branches the apps can write images into. A whole-outlet read would drag in
// every order and session, so the scan is scoped to these. `riders` is included
// because rider KYC photos are written as `profilePhoto`/`aadharPhoto` and the
// Admin Riders tab holds a live listener on the whole node.
const BRANCHES = ['settings', 'dishes', 'categories', 'combos', 'riders'];

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const MENU_BANK_ONLY = args.includes('--menu-bank');
const RESTORE = argOf('restore', null);
const BID = argOf('bid', null);
const OID = argOf('oid', null);

const app = admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: DATABASE_URL,
  storageBucket: BUCKET,
});
const db = app.database();
const bucket = admin.storage().bucket(BUCKET);

// ------------------------------------------------------------------ scanning

function walk(node, prefix, out) {
  if (typeof node === 'string') {
    if (node) out.push({ path: prefix, value: node });
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}/${k}` : k, out);
}

/** walk() returns every string; media work only cares about embedded images. */
const isDataImage = (v) => typeof v === 'string' && v.startsWith('data:image/');

function kindOf(v) {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) return 'base64';
  if (v.startsWith('data:image/svg+xml')) return 'svg';
  return 'other';
}

function parseDataUri(value) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(value);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  return { mime, ext: EXT[mime], buf: Buffer.from(m[2], 'base64') };
}

/** Every outlet that could hold an image, as { bid, oid } (one tree read). */
async function discoverOutlets() {
  if (BID && OID) return [{ bid: BID, oid: OID }];
  const businesses = (await db.ref('businesses').get()).val() || {};
  const out = [];
  for (const [bid, biz] of Object.entries(businesses)) {
    for (const oid of Object.keys((biz && biz.outlets) || {})) out.push({ bid, oid });
  }
  return out;
}

/** All image hits across the selected scopes, each tagged with its RTDB ref. */
async function scanEstate() {
  const items = [];
  const svg = [];
  const unsupported = [];

  const outlets = MENU_BANK_ONLY ? [] : await discoverOutlets();
  for (const { bid, oid } of outlets) {
    const ref = `businesses/${bid}/outlets/${oid}`;
    const snaps = await Promise.all(BRANCHES.map((b) => db.ref(`${ref}/${b}`).get()));
    const hits = [];
    BRANCHES.forEach((b, i) => walk(snaps[i].val(), b, hits));
    for (const h of hits) {
      if (!isDataImage(h.value)) continue;
      const kind = kindOf(h.value);
      if (kind === 'svg') { svg.push({ ref, path: h.path, bytes: Buffer.byteLength(h.value, 'utf8') }); continue; }
      if (kind !== 'base64') { unsupported.push({ ref, path: h.path }); continue; }
      items.push({ ref, path: h.path, value: h.value, tenant: `${bid}/${oid}`, scope: 'outlet' });
    }
  }

  if (!MENU_BANK_ONLY || MENU_BANK_ONLY) {
    if (!BID && !OID) {
      const hits = [];
      walk((await db.ref('menuBank').get()).val(), '', hits);
      for (const h of hits) {
        if (!isDataImage(h.value)) continue;
        const kind = kindOf(h.value);
        if (kind === 'svg') { svg.push({ ref: 'menuBank', path: h.path, bytes: Buffer.byteLength(h.value, 'utf8') }); continue; }
        if (kind !== 'base64') { unsupported.push({ ref: 'menuBank', path: h.path }); continue; }
        items.push({ ref: 'menuBank', path: h.path, value: h.value, tenant: '(platform)', scope: 'menuBank' });
      }
    }
  }

  return { items, svg, unsupported };
}

// ----------------------------------------------------------------- uploading

function objectPathFor(it, relPath, ext) {
  if (it.scope === 'menuBank') return `platform/menuBank/${relPath}.${ext}`;
  const [bid, oid] = it.tenant.split('/');
  return `outlets/${bid}/${oid}/migrated/${relPath}.${ext}`;
}

async function upload(filePath, buf, mime) {
  const token = crypto.randomUUID();
  await bucket.file(filePath).save(buf, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

// ------------------------------------------------------------------ restore

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  // v1 (batch 13): { base, fields: { 'dishes/x/image': value } }
  // v2 (batch 15): { items: [{ ref, path, value }] }
  const rows = backup.items
    || Object.entries(backup.fields || {}).map(([p, value]) => ({ ref: backup.base, path: p, value }));
  if (!rows.length) return console.log('nothing to restore');

  console.log(`restoring ${rows.length} value(s) from ${file}`);
  const byParent = new Map();
  for (const r of rows) {
    const parent = `${r.ref}/${r.path.split('/').slice(0, -1).join('/')}`;
    const key = r.path.split('/').pop();
    if (!byParent.has(parent)) byParent.set(parent, {});
    byParent.get(parent)[key] = r.value;
  }
  for (const [parent, upd] of byParent) {
    await db.ref(parent).update(upd);
    console.log('  restored', parent, `(${Object.keys(upd).length} field(s))`);
  }
  console.log('done');
}

// ------------------------------------------------------------------- verify

async function verifyUrls(urls) {
  let ok = 0;
  const bad = [];
  for (const { url, bytes } of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) { bad.push({ url, why: `HTTP ${resp.status}` }); continue; }
      const got = Buffer.from(await resp.arrayBuffer());
      if (bytes != null && got.length !== bytes) { bad.push({ url, why: `${got.length} B != ${bytes} B` }); continue; }
      ok++;
    } catch (err) {
      bad.push({ url, why: err.message });
    }
  }
  return { ok, bad };
}

async function runVerify() {
  const { items, svg } = await scanEstate();
  const urls = [];
  for (const { bid, oid } of MENU_BANK_ONLY ? [] : await discoverOutlets()) {
    const ref = `businesses/${bid}/outlets/${oid}`;
    const snaps = await Promise.all(BRANCHES.map((b) => db.ref(`${ref}/${b}`).get()));
    const found = [];
    BRANCHES.forEach((b, i) => walk(snaps[i].val(), b, found));
    for (const h of found) {
      if (h.value.startsWith('https://firebasestorage.googleapis.com/')) urls.push({ url: h.value, bytes: null });
    }
  }
  if (!BID && !OID) {
    const found = [];
    walk((await db.ref('menuBank').get()).val(), '', found);
    for (const h of found) {
      if (h.value.startsWith('https://firebasestorage.googleapis.com/')) urls.push({ url: h.value, bytes: null });
    }
  }

  const unique = [...new Map(urls.map((u) => [u.url, u])).values()];
  console.log(`base64 fields left : ${items.length}`);
  console.log(`inline SVG fields  : ${svg.length}  (not migratable — text, regenerated nightly)`);
  console.log(`Storage URLs found : ${urls.length} (${unique.length} unique)`);

  const { ok, bad } = await verifyUrls(unique);
  console.log(`URLs reachable     : ${ok}/${unique.length}`);
  for (const b of bad.slice(0, 10)) console.log(`  BAD ${b.url.slice(0, 90)} — ${b.why}`);

  const pass = items.length === 0 && bad.length === 0;
  console.log('');
  console.log(pass ? 'PASS — no base64 left, every Storage URL serves its bytes' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

// --------------------------------------------------------------------- main

(async () => {
  if (RESTORE) { await restore(RESTORE); process.exit(0); }
  if (VERIFY) { await runVerify(); return; }

  const { items, svg, unsupported } = await scanEstate();

  console.log(`scope   ${BID && OID ? `${BID}/${OID}` : MENU_BANK_ONLY ? 'menuBank only' : 'whole estate (every outlet + menuBank)'}`);
  console.log(`bucket  ${BUCKET}`);
  console.log(`mode    ${APPLY ? 'APPLY' : 'dry-run (pass --apply to write)'}\n`);

  if (svg.length) {
    console.log(`skipping ${svg.length} inline SVG field(s), ${(svg.reduce((a, s) => a + s.bytes, 0) / 1024).toFixed(1)} KB total:`);
    for (const s of svg.slice(0, 6)) console.log(`  SVG ${s.ref}/${s.path}`);
    if (svg.length > 6) console.log(`  … and ${svg.length - 6} more`);
    console.log('');
  }
  if (unsupported.length) {
    console.log(`WARNING ${unsupported.length} data:image field(s) that are neither base64 nor svg:`);
    for (const s of unsupported) console.log(`  ?? ${s.ref}/${s.path}`);
    console.log('');
  }
  if (!items.length) {
    console.log(`No base64 images left in ${BRANCHES.join(', ')}${BID ? '' : ' or menuBank'} — nothing to do.`);
    process.exit(0);
  }

  let totalBytes = 0;
  const byHash = new Map();
  for (const it of items) {
    const parsed = parseDataUri(it.value);
    if (!parsed || !parsed.ext) {
      console.log(`SKIP ${it.ref}/${it.path} — unsupported data URI (${it.value.slice(0, 32)})`);
      continue;
    }
    it.parsed = parsed;
    it.bytes = parsed.buf.length;
    // Dedupe WITHIN a target only. Sharing an object across tenants would make
    // one outlet's "replace dish photo" (deleteImage on the old URL) break
    // another tenant's dish, so the few KB saved is not worth the coupling.
    it.hash = `${it.tenant}|${crypto.createHash('sha256').update(parsed.buf).digest('hex')}`;
    totalBytes += it.bytes;
    if (!byHash.has(it.hash)) byHash.set(it.hash, it);
  }

  console.log(`${items.length} image field(s), ${(totalBytes / 1024).toFixed(1)} KB of payload, ` +
    `${byHash.size} unique payload(s)\n`);

  const byTarget = {};
  for (const it of items) byTarget[it.tenant] = byTarget[it.tenant] || { n: 0, b: 0 };
  for (const it of items) { byTarget[it.tenant].n++; byTarget[it.tenant].b += it.bytes; }
  for (const [t, v] of Object.entries(byTarget).sort((a, b) => b[1].b - a[1].b)) {
    console.log(`  ${t.padEnd(52)} ${String(v.n).padStart(3)} field(s)  ${(v.b / 1024).toFixed(1).padStart(8)} KB`);
  }
  console.log('');

  if (!APPLY) {
    for (const it of items) {
      const rel = it.path;
      console.log(
        `${it.ref}/${it.path}`.slice(0, 78).padEnd(80),
        String(it.bytes).padStart(8), 'B',
        `-> ${objectPathFor(it, rel, it.parsed.ext)}`
      );
    }
    console.log(`\nDry run. ${byHash.size} object(s) would be uploaded, ${items.length} field(s) rewritten.`);
    console.log('Re-run with --apply.');
    process.exit(0);
  }

  const backupDir = path.join(ROOT, 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `media-${BID && OID ? `${BID}-${OID}` : 'estate'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(backupFile, JSON.stringify({
    at: new Date().toISOString(),
    items: items.map((it) => ({ ref: it.ref, path: it.path, value: it.value })),
  }));
  console.log(`backup -> ${backupFile}\n`);

  const urlByHash = new Map();
  for (const [hash, it] of byHash) {
    const filePath = objectPathFor(it, it.path, it.parsed.ext);
    const url = await upload(filePath, it.parsed.buf, it.parsed.mime);
    urlByHash.set(hash, url);
    console.log('UP', filePath, `(${it.bytes} B)`);
  }

  const byParent = new Map();
  for (const it of items) {
    const parent = `${it.ref}/${it.path.split('/').slice(0, -1).join('/')}`;
    const key = it.path.split('/').pop();
    if (!byParent.has(parent)) byParent.set(parent, {});
    byParent.get(parent)[key] = urlByHash.get(it.hash);
  }
  for (const [parent, upd] of byParent) {
    await db.ref(parent).update(upd);
    console.log('RTDB', parent, `(${Object.keys(upd).length} field(s))`);
  }

  // Prove the rewrite: nothing left to migrate, and every new URL serves the
  // exact bytes that used to live in the database.
  const after = await scanEstate();
  console.log(`\nrescan: ${after.items.length} base64 field(s) left`);

  const distinct = [...new Map([...urlByHash.values()].map((u) => [u, u])).keys()];
  const sizeByUrl = new Map();
  for (const it of items) {
    const u = urlByHash.get(it.hash);
    if (!sizeByUrl.has(u)) sizeByUrl.set(u, it.parsed.buf.length);
  }
  const { ok, bad } = await verifyUrls(distinct.map((u) => ({ url: u, bytes: sizeByUrl.get(u) })));
  console.log(`objects verified: ${ok}/${distinct.length} serve their exact bytes`);
  for (const b of bad) console.log(`  BAD ${b.url.slice(0, 90)} — ${b.why}`);

  console.log(`\ndone. ${items.length} field(s) migrated, ${(totalBytes / 1024).toFixed(1)} KB removed from RTDB.`);
  process.exit(after.items.length === 0 && bad.length === 0 ? 0 : 1);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
