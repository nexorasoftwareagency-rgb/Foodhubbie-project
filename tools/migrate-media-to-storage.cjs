#!/usr/bin/env node
/**
 * Batch 13 — move base64 media out of the Realtime Database into Cloud Storage.
 *
 *   node tools/migrate-media-to-storage.cjs --bid roshani-pizza --oid pizza
 *   node tools/migrate-media-to-storage.cjs --bid roshani-pizza --oid pizza --apply
 *   node tools/migrate-media-to-storage.cjs --restore backup/media-<iso>.json
 *
 * Dry-run by default. Scans the outlet branches that can hold images for any
 * string starting with `data:image/`, uploads each one byte-for-byte (no
 * re-encode: a payment QR must stay scannable, a PNG must keep its alpha),
 * and rewrites the field to the object's download-token URL.
 *
 * Idempotent: values that are already URLs are skipped, so a second run is a
 * no-op. Identical payloads are deduplicated by sha256, so the five identical
 * bot status images cost one object instead of five.
 *
 * A backup of every value it replaces is written before the first write.
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

// Branches the Admin UI can write images into. A whole-outlet read would drag in
// every order and session, so the scan is scoped to these.
const BRANCHES = ['settings', 'dishes', 'categories', 'combos'];

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const RESTORE = argOf('restore', null);
const BID = argOf('bid', 'roshani-pizza');
const OID = argOf('oid', 'pizza');

const app = admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: DATABASE_URL,
  storageBucket: BUCKET,
});
const db = app.database();
const bucket = admin.storage().bucket(BUCKET);

function walk(node, prefix, out) {
  if (typeof node === 'string') return;
  for (const [k, v] of Object.entries(node || {})) {
    const p = prefix ? `${prefix}/${k}` : k;
    if (typeof v === 'string') {
      if (v.startsWith('data:image/')) out.push({ path: p, value: v });
    } else if (v && typeof v === 'object') {
      walk(v, p, out);
    }
  }
}

function parseDataUri(value) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(value);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  return { mime, ext: EXT[mime], buf: Buffer.from(m[2], 'base64') };
}

async function upload(relPath, buf, mime, ext) {
  const token = crypto.randomUUID();
  const filePath = `outlets/${BID}/${OID}/migrated/${relPath}.${ext}`;
  await bucket.file(filePath).save(buf, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  return {
    filePath,
    url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`,
  };
}

async function restore(file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Object.entries(backup.fields || {});
  if (!rows.length) return console.log('nothing to restore');
  console.log(`restoring ${rows.length} value(s) from ${file}`);
  const byParent = new Map();
  for (const [p, value] of rows) {
    const parent = p.split('/').slice(0, -1).join('/');
    const key = p.split('/').pop();
    if (!byParent.has(parent)) byParent.set(parent, {});
    byParent.get(parent)[key] = value;
  }
  for (const [parent, upd] of byParent) {
    await db.ref(`${backup.base}/${parent}`).update(upd);
    console.log('  restored', parent, `(${Object.keys(upd).length} field(s))`);
  }
  console.log('done');
}

(async () => {
  if (RESTORE) { await restore(RESTORE); process.exit(0); }

  const base = `businesses/${BID}/outlets/${OID}`;
  console.log(`outlet  ${BID}/${OID}`);
  console.log(`bucket  ${BUCKET}`);
  console.log(`mode    ${APPLY ? 'APPLY' : 'dry-run (pass --apply to write)'}\n`);

  const snaps = await Promise.all(BRANCHES.map((b) => db.ref(`${base}/${b}`).get()));
  const items = [];
  BRANCHES.forEach((b, i) => walk(snaps[i].val(), b, items));

  if (!items.length) {
    console.log('No base64 images left in ' + BRANCHES.join(', ') + ' — nothing to do.');
    process.exit(0);
  }

  let totalBytes = 0;
  const byHash = new Map();
  for (const it of items) {
    const parsed = parseDataUri(it.value);
    if (!parsed || !parsed.ext) {
      console.log(`SKIP ${it.path} — unsupported data URI`);
      continue;
    }
    it.parsed = parsed;
    it.bytes = parsed.buf.length;
    it.hash = crypto.createHash('sha256').update(parsed.buf).digest('hex');
    totalBytes += it.bytes;
    if (!byHash.has(it.hash)) byHash.set(it.hash, it);
  }

  console.log(`${items.length} image field(s), ${(totalBytes / 1048576).toFixed(2)} MB, ` +
    `${byHash.size} unique payload(s)\n`);

  if (!APPLY) {
    for (const it of items) {
      console.log(
        it.path.padEnd(46),
        String(it.bytes).padStart(8), 'B',
        `-> migrated/${it.path}.${it.parsed.ext}`
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
    `media-${BID}-${OID}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  const backup = { base, at: new Date().toISOString(), fields: {} };
  for (const it of items) backup.fields[it.path] = it.value;
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  console.log(`backup -> ${backupFile}\n`);

  const urlByHash = new Map();
  for (const [hash, it] of byHash) {
    const { url, filePath } = await upload(it.path, it.parsed.buf, it.parsed.mime, it.parsed.ext);
    urlByHash.set(hash, url);
    console.log('UP', filePath, `(${it.bytes} B)`);
  }

  const byParent = new Map();
  for (const it of items) {
    const parent = it.path.split('/').slice(0, -1).join('/');
    const key = it.path.split('/').pop();
    if (!byParent.has(parent)) byParent.set(parent, {});
    byParent.get(parent)[key] = urlByHash.get(it.hash);
  }
  for (const [parent, upd] of byParent) {
    await db.ref(`${base}/${parent}`).update(upd);
    console.log('RTDB', parent, `(${Object.keys(upd).length} field(s))`);
  }

  // confirm
  const after = await Promise.all(BRANCHES.map((b) => db.ref(`${base}/${b}`).get()));
  let afterBytes = 0;
  for (const s of after) afterBytes += Buffer.byteLength(JSON.stringify(s.val() || {}), 'utf8');
  console.log(`\ndone. ${items.length} field(s) migrated, ${(totalBytes / 1048576).toFixed(2)} MB removed.`);
  console.log(`branches now ${(afterBytes / 1024).toFixed(1)} KB.`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
