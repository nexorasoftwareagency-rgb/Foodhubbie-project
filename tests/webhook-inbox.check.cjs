#!/usr/bin/env node
/**
 * Webhook inbox guard (EC2 retirement batch, rewritten in batch 23m).
 *
 *   node tests/webhook-inbox.check.cjs
 *
 * `onWebhookInboxMessage` (RTDB trigger) drains the `webhookInbox` queue that
 * `whatsappWebhook` (HTTPS function) writes to.
 *
 * Batch 23m replaced the drain's body: it used to enqueue a Cloud Task for
 * `processInboundMessage`, which is a DIFFERENT PRODUCT (text menu, text cart,
 * COD) and could never charge GST, apply the delivery fee, redeem a reward or
 * deduct stock. It now calls the real handler directly — `bot/inbound-flow.js`,
 * vendored byte-for-byte into `lib/vendor/` — the same module the WhatsApp bot
 * runs.
 *
 * Pins:
 *   - Demo tenant (foodhubbie-demo) is hard-skipped.
 *   - Config flag gate: config/webhookInbox/enabled === true.
 *   - Stale entries (>30 min) are dropped, not processed.
 *   - Only NEW entries are handled (`before` absent).
 *   - The real flow is called: `makeInboundFlow` + `handleInbound`.
 *   - NO Cloud Tasks and NO `processInboundMessage` (dead-end product, and
 *     `taskQueue.ts` targets the wrong project).
 *   - The RAW sender is passed through (country code intact — the old drain
 *     sliced the last 10 digits).
 *   - Button / interactive replies are read as text (the Unsubscribe quick
 *     reply carries no `text.body`; without this the opt-out is a no-op).
 *   - The entry is deleted AFTER handling (a crash re-delivers and the flow's
 *     `bot/processed/{day}` dedupe absorbs it).
 *   - No whole `businesses` tree reads (egress bug class).
 *   - Correct RTDB ref + the platform token secret.
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
const FACTORY = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/whatsapp/factory.ts';
const VENDOR = 'FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs';

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
   /30 \* 60 \* 1000/.test(stripped) && /MAX_INBOX_AGE_MS/.test(stripped));

// ---------------------------------------------------------------------------
// 4. Only NEW entries
// ---------------------------------------------------------------------------
ok('Only new entries handled (before must be absent)',
   /event\.data\.before\.val\(\)/.test(stripped) && /if \(!after \|\| before\) return/.test(stripped));

// ---------------------------------------------------------------------------
// 5. Calls the REAL handler, not the dead text-menu product
// ---------------------------------------------------------------------------
ok('Calls the real flow: makeInboundFlow + handleInbound',
   /makeInboundFlow/.test(stripped) && /\.handleInbound\(/.test(stripped));
ok('No Cloud Tasks enqueue (taskQueue targets the wrong project)',
   !/enqueueTask/.test(stripped) && !/enqueueInboxTask/.test(stripped));
ok('processInboundMessage is never invoked',
   !/processInboundMessage/.test(stripped));

// ---------------------------------------------------------------------------
// 6. Raw sender passed through (country code intact)
// ---------------------------------------------------------------------------
ok('Raw sender passed through, no last-10 slice before the flow',
   /message\.from/.test(stripped) && !/slice\(-10\)/.test(stripped) && !/from10/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Button / interactive reply text extraction (Unsubscribe quick reply)
// ---------------------------------------------------------------------------
ok('Quick replies read as text (button + interactive)',
   /button_reply/.test(stripped) && /message\.button/.test(stripped) && /list_reply/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Entry deleted AFTER handling
// ---------------------------------------------------------------------------
const dropCalls = (stripped.match(/drop\(\)/g) || []).length;
ok('Entry deleted after handling (drop() after the try/catch)',
   dropCalls >= 2 && /Handled/.test(stripped) && /return drop\(\);/.test(stripped));

// ---------------------------------------------------------------------------
// 9. Correct RTDB trigger ref + platform token
// ---------------------------------------------------------------------------
ok('RTDB ref: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}',
   /businesses\/\{bid\}\/outlets\/\{oid\}\/webhookInbox\/\{pushId\}/.test(src));
ok('onValueWritten event type', /onValueWritten/.test(stripped));
ok('WA_PERMANENT_TOKEN bound as a secret', /WA_PERMANENT_TOKEN/.test(src));

// ---------------------------------------------------------------------------
// 10. No whole `businesses` tree reads (egress guard)
// ---------------------------------------------------------------------------
ok('No db.ref("businesses") whole-tree read',
   !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 11. The factory pins the tenant from the event path and uses the vendored flow
// ---------------------------------------------------------------------------
const factory = read(FACTORY);
ok('Factory resolves the tenant from the path (bid/oid arguments)',
   /businesses\/\$\{bid\}\/outlets\/\$\{oid\}/.test(factory) &&
   /createInboundFlow\(/.test(factory) && /createMetaCost\(/.test(factory));
ok('Factory refuses a tenant with no WhatsApp number / token',
   /whatsapp number not connected/.test(factory) && /WA_PERMANENT_TOKEN is not set/.test(factory));

// ---------------------------------------------------------------------------
// 12. The modules are vendored (a stale copy would answer with old copy)
// ---------------------------------------------------------------------------
const vendor = read(VENDOR);
for (const mod of ['bot/inbound-flow.js', 'bot/whatsapp-send.js', 'bot/meta-cost.js', 'bot/chat-log-core.js']) {
  ok('Vendored: ' + mod, vendor.includes("'" + mod + "'"));
}

// ---------------------------------------------------------------------------
// 13. Exported from index.ts
// ---------------------------------------------------------------------------
const indexSrc = read(INDEX);
ok('Exported from functions/src/index.ts',
   /onWebhookInboxMessage/.test(indexSrc) && /from '.\/triggers\/webhookInbox'/.test(indexSrc));

console.log(`\nwebhook-inbox guard ${pass}/${pass + (process.exitCode ? 1 : 0)} passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
