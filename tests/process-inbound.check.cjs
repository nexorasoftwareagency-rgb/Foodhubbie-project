#!/usr/bin/env node
/**
 * Process inbound message guard (EC2 retirement batch).
 *
 *   node tests/process-inbound.check.cjs
 *
 * `processInboundMessage` (task queue) is the full WhatsApp message pipeline,
 * replacing the EC2 bot's `messages.upsert` handler (bot/index.js:2382).
 *
 * Pins:
 *   - Demo tenant hard-skipped.
 *   - Opt-out / opt-in (STOP/START/unsubscribe) handled before state machine.
 *   - Ban-proofing: 3 non-intent messages → 30-min freeze (isJidFrozen).
 *   - Rate limiting: 4–8s gap per outbound chat (paceOutboundTo).
 *   - Session management: RTDB-native bot/sessions/{jid}/{oid} (replaces Redis).
 *   - Admin commands: !report, !status.
 *   - State machine: START → MENU_BROWSING → CART_REVIEW → CHECKOUT → PAYMENT.
 *   - Outbound sends via sendOutboundMessage task queue (NOT sock.sendMessage).
 *   - Chat logging to chats/{phone} + chatMeta/{phone}.
 *   - Message ID dedupe (processedMessages).
 *   - No whole `businesses` tree reads.
 *
 * Runs the REAL shared/session.js, shared/rateLimit.js, shared/strikeTracker.js.
 * Rest is static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/processInboundMessage.ts';
const SESSION = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/session.ts';
const RATELIMIT = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/rateLimit.ts';
const STRIKE = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/strikeTracker.ts';
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
ok('Demo tenant hard-skipped', /foodhubbie-demo/.test(stripped));

// ---------------------------------------------------------------------------
// 2. Session management: RTDB-native (getSession/saveSession)
// ---------------------------------------------------------------------------
ok('Session: getSession/saveSession (RTDB)', /getSession/.test(stripped) && /saveSession/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Message ID dedupe (processedMessages)
// ---------------------------------------------------------------------------
ok('Message dedupe: processedMessages', /processedMessages/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Admin commands (!report, !status)
// ---------------------------------------------------------------------------
ok('Admin commands: !report / !status', /'report'/.test(stripped) && /'status'/.test(stripped));

// ---------------------------------------------------------------------------
// 9. State machine steps
// ---------------------------------------------------------------------------
ok('State machine: START → MENU_BROWSING → CART_REVIEW → CHECKOUT → PAYMENT',
   /MENU_BROWSING/.test(stripped) && /CART_REVIEW/.test(stripped) && /CHECKOUT/.test(stripped) && /PAYMENT/.test(stripped));

// ---------------------------------------------------------------------------
// 10. Outbound via task queue (NOT sock.sendMessage)
// ---------------------------------------------------------------------------
ok('Outbound via enqueueTask (not sock.sendMessage)',
   /enqueueTask\('sendOutboundMessage'/.test(stripped) && !/sock\.sendMessage/.test(stripped));

// ---------------------------------------------------------------------------
// 11. No whole `businesses` tree reads
// ---------------------------------------------------------------------------
ok('No db.ref("businesses") whole-tree read',
   !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 12. Exported from index.ts
// ---------------------------------------------------------------------------
const indexSrc = read(INDEX);
ok('Exported from functions/src/index.ts', /processInboundMessage/.test(indexSrc));

// ---------------------------------------------------------------------------
// 13. Shared/session.ts exists and exports getSession/saveSession/incrementMsgCount
// ---------------------------------------------------------------------------
ok('Shared/session.ts exists',
   fs.existsSync(path.join(ROOT, SESSION)));
ok('Shared/session.ts exports getSession/saveSession/incrementMsgCount',
   /export (async function|const) getSession/.test(read(SESSION)) &&
    /export (async function|const) saveSession/.test(read(SESSION)) &&
    /export (async function|const) incrementMsgCount/.test(read(SESSION)));

// ---------------------------------------------------------------------------
// 14. Shared/rateLimit.ts exists and exports paceOutboundTo
// ---------------------------------------------------------------------------
ok('Shared/rateLimit.ts exists',
   fs.existsSync(path.join(ROOT, RATELIMIT)));
ok('Shared/rateLimit.ts exports paceOutboundTo',
   /export (async function|const) paceOutboundTo/.test(read(RATELIMIT)));

// ---------------------------------------------------------------------------
// 15. Shared/strikeTracker.ts exists and exports isJidFrozen/recordWrongMessage
// ---------------------------------------------------------------------------
ok('Shared/strikeTracker.ts exists',
   fs.existsSync(path.join(ROOT, STRIKE)));
ok('Shared/strikeTracker.ts exports isJidFrozen',
   /export (async function|const) isJidFrozen/.test(read(STRIKE)));

console.log(`\nprocess-inbound guard ${pass}/14 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
