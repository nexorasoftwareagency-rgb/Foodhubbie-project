'use strict';
/**
 * backfill-chat-index.cjs — one-time (and idempotent) build of the flat
 * `chatMeta/{customerId}` mirror from each thread's existing `chats/{id}/meta`.
 *
 * Why: the Admin Chat tab and the WhatsApp analytics card need one small row per
 * thread. Querying `chats` drags every message body with it — measured live at
 * 9.4 KB of meta vs 257.1 KB of messages across 24 threads (96 % waste). The bot
 * now writes `chatMeta` on every message (bot/chat-log.js), but threads that
 * existed before that change have no mirror row and would vanish from the list.
 *
 *   node tools/backfill-chat-index.cjs                # dry-run (default)
 *   node tools/backfill-chat-index.cjs --apply        # write the mirror
 *   node tools/backfill-chat-index.cjs --bid X --oid Y  # one outlet only
 *
 * Idempotent: re-running rewrites the same values. Safe to run before or after
 * the bot deploy; it never touches `chats` itself.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const admin = require(path.join(ROOT, 'bot/node_modules/firebase-admin'));
const sa = require(path.join(ROOT, 'bot/service-account.json'));

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const ONLY_BID = argOf('bid', null);
const ONLY_OID = argOf('oid', null);

const app = admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: DATABASE_URL });
const db = app.database();

const bytes = (v) => (v == null ? 0 : Buffer.byteLength(JSON.stringify(v)));
// RTDB returns child keys alphabetically, so any equality check on a row must be
// order-insensitive or every already-correct row looks different.
const canon = (v) => JSON.stringify(Object.keys(v || {}).sort().map((k) => [k, v[k]]));

/**
 * Normalise a stored thread meta into the shape `database.rules.json` validates
 * for chatMeta/$customerId: all six keys present, lastTs and unread numeric.
 * A meta written by an older bot build can be missing fields; a mirror row that
 * fails validation would be rejected (and the thread would silently disappear
 * from the Admin list), so fill the gaps with the same defaults chat-log.js uses.
 */
function normalizeMeta(meta) {
  const m = meta || {};
  return {
    name: typeof m.name === 'string' ? m.name : '',
    phone: m.phone || '',
    lastTs: Number.isFinite(Number(m.lastTs)) ? Number(m.lastTs) : 0,
    lastText: typeof m.lastText === 'string' && m.lastText ? m.lastText : '<media>',
    lastDir: m.lastDir === 'bot' ? 'bot' : 'customer',
    unread: Number.isFinite(Number(m.unread)) ? Number(m.unread) : 0,
  };
}

async function main() {
  console.log(`\nchatMeta backfill — ${APPLY ? 'APPLY' : 'dry-run (pass --apply to write)'}`);
  console.log(`  database ${DATABASE_URL}\n`);

  const bizSnap = await db.ref('businesses').once('value');
  const businesses = bizSnap.val() || {};

  const plan = [];
  let threadBytes = 0;
  let mirrorBytes = 0;

  for (const [bid, biz] of Object.entries(businesses)) {
    if (ONLY_BID && bid !== ONLY_BID) continue;
    const outlets = biz?.outlets || {};
    for (const [oid, outlet] of Object.entries(outlets)) {
      if (ONLY_OID && oid !== ONLY_OID) continue;
      const chats = outlet?.chats || {};
      const ids = Object.keys(chats);
      if (!ids.length) continue;

      const existing = (await db.ref(`businesses/${bid}/outlets/${oid}/chatMeta`).once('value')).val() || {};
      let added = 0;
      let updated = 0;
      let same = 0;

      for (const id of ids) {
        const meta = chats[id]?.meta;
        if (!meta) {
          console.log(`    ! ${bid}/${oid}/${id}: no meta — skipped (cannot list a thread without one)`);
          continue;
        }
        const row = normalizeMeta(meta);
        const prev = existing[id];
        const writes = canon(prev) !== canon(row);
        plan.push({ bid, oid, id, row });
        threadBytes += bytes(meta);
        mirrorBytes += bytes(row);
        if (!prev) added++;
        else if (writes) updated++;
        else same++;
      }

      console.log(`  ${bid}/${oid}: ${ids.length} threads → ${added} new, ${updated} changed, ${same} already correct`);
    }
  }

  if (!plan.length) {
    console.log('\n  Nothing to do.\n');
    return;
  }

  console.log(`\n  ${plan.length} thread(s) to mirror`);
  console.log(`  nested meta ${(threadBytes / 1024).toFixed(1)} KB  →  flat rows ${(mirrorBytes / 1024).toFixed(1)} KB`);

  if (!APPLY) {
    console.log('\n  Dry run only. Re-run with --apply to write.\n');
    return;
  }

  let written = 0;
  for (const p of plan) {
    // set() per row, not one big update: a single huge multi-path write would be
    // rejected above 256 MB and this stays trivially resumable if it is stopped.
    await db.ref(`businesses/${p.bid}/outlets/${p.oid}/chatMeta/${p.id}`).set(p.row);
    written++;
    if (written % 25 === 0) console.log(`    … ${written}/${plan.length}`);
  }
  console.log(`\n  Wrote ${written} mirror row(s).\n`);

  // Verify by reading back what the Admin list will query.
  let verified = 0;
  for (const p of plan) {
    const snap = await db.ref(`businesses/${p.bid}/outlets/${p.oid}/chatMeta/${p.id}`).once('value');
    if (canon(snap.val()) === canon(p.row)) verified++;
  }
  console.log(`  Verified ${verified}/${plan.length} row(s) read back exactly.\n`);
  if (verified !== plan.length) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    console.error('ERR', e.message || e);
    process.exit(1);
  });
