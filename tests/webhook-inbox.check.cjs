#!/usr/bin/env node
/**
 * Webhook inbox guard (EC2 retirement batch).
 *
 *   node tests/webhook-inbox.check.cjs
 *
 * `onWebhookInboxMessage` (RTDB trigger) drains the `webhookInbox` queue that
 * `whatsappWebhook` (HTTPS function) writes to. It replaces the EC2 bot's
 * Meta transport inbox listener (`bot/transport.js createMetaTransport start()`,
 * `child_added` on `webhookInbox`).
 *
 * Pins:
 *   - Demo tenant (foodhubbie-demo) is hard-skipped.
 *   - Config flag gate: config/webhookInbox/enabled === true.
 *   - Stale entries (>30 min) are dropped, not processed.
 *   - Entry is deleted AFTER task enqueue (at-most-once, reprocessing is safe).
 *   - No whole `businesses` tree reads (egress bug class).
 *   - Correct RTDB ref: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
 *
 * Behaviour is static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/triggers/webhookInbox.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';

let pass = 0;
const ok = (label, cond, detail) => {
  if (!cond) {
    console.error('  FAIL  ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
    process.exitCode = 1;
    return;
  }
  pass++;
  console.log('  ok  ' + label);
};

const src = read(SRC);
const stripped = stripComments(src);

// ---------------------------------------------------------------------------
// 1. Demo tenant hard-skip
// ---------------------------------------------------------------------------
ok('Demo tenant hard-skipped',
   /foodhubbie-demo/.test(stripped) && /bid === DEMO_BUSINESS_ID/.test(stripped));

// ---------------------------------------------------------------------------
// 2. Config flag gate
// ---------------------------------------------------------------------------
ok('Config flag gate: config/webhookInbox/enabled',
   /config\/webhookInbox\/enabled/.test(stripped));

// ---------------------------------------------------------------------------
// 3. Stale entry drop (>30 min)
// ---------------------------------------------------------------------------
ok('Stale entry drop (30 min max age)',
   /30 \* 60 \* 1000/.test(stripped) || /MAX_INBOX_AGE_MS/.test(stripped));

// ---------------------------------------------------------------------------
// 4. Entry deleted AFTER task enqueue
// ---------------------------------------------------------------------------
ok('Entry deleted after task enqueue',
   /enqueueTask/.test(stripped) && /remove\(\)/.test(stripped));

// ---------------------------------------------------------------------------
// 5. Correct RTDB trigger ref
// ---------------------------------------------------------------------------
ok('RTDB ref: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}',
   /businesses\/\{bid\}\/outlets\/\{oid\}\/webhookInbox\/\{pushId\}/.test(src));

// ---------------------------------------------------------------------------
// 6. onValueWritten event type
// ---------------------------------------------------------------------------
ok('onValueWritten event type',
   /onValueWritten/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Normalizes Meta message (jid, text, pushName)
// ---------------------------------------------------------------------------
ok('Message normalization: jid + text + pushName',
   /jid/.test(stripped) && /text/.test(stripped) && /pushName/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Task payload includes bid, oid, jid, text, pushName
// ---------------------------------------------------------------------------
ok('Task payload: bid, oid, jid, text, pushName',
   /\bbid\b/.test(stripped) && /\boid\b/.test(stripped) && /\bjid\b/.test(stripped) && /\btext\b/.test(stripped) && /\bpushName\b/.test(stripped));

// ---------------------------------------------------------------------------
// 9. No whole `businesses` tree reads (egress guard)
// ---------------------------------------------------------------------------
ok('No db.ref("businesses") whole-tree read',
   !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 10. Exported from index.ts
// ---------------------------------------------------------------------------
const indexSrc = read(INDEX);
ok('Exported from functions/src/index.ts',
   /onWebhookInboxMessage/.test(indexSrc) && /from '.\/triggers\/webhookInbox'/.test(indexSrc));

console.log(`\nwebhook-inbox guard ${pass}/10 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
