#!/usr/bin/env node
/**
 * Order status alert guard (EC2 retirement batch).
 *
 *   node tests/order-status-alert.check.cjs
 *
 * `onOrderStatusAlert` (RTDB trigger) sends WhatsApp "NEW ORDER" alerts to
 * outlet admins when status flips to Placed for the first time. Replaces the
 * EC2 bot's socket-only alertAdminFinalizedWebOrder (bot/index.js:1184).
 *
 * Pins:
 *   - Demo tenant (foodhubbie-demo) hard-skipped.
 *   - Config flag gate: config/orderStatusAlert/enabled === true.
 *   - Only first 'Placed' status (dedupe via orders/{orderId}/_adminWaNotified).
 *   - QR orders do NOT get admin WhatsApp alerts.
 *   - Listens on status LEAF only (payment mirror/KOT stamp can't trigger).
 *   - Correct RTDB ref: businesses/{bid}/outlets/{oid}/orders/{orderId}/status
 *   - No whole `businesses` tree reads.
 *
 * Static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderStatusAlert.ts';
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
// 2. Config flag gate
// ---------------------------------------------------------------------------
ok('Config flag gate: config/orderStatusAlert/enabled', /orderStatusAlert\/enabled/.test(stripped));

// ---------------------------------------------------------------------------
// 3. Status leaf trigger (not whole order node)
// ---------------------------------------------------------------------------
ok('RTDB ref: orders/{orderId}/status (status leaf)',
   /orders\/\{orderId\}\/status/.test(src));

// ---------------------------------------------------------------------------
// 4. onValueWritten event type
// ---------------------------------------------------------------------------
ok('onValueWritten event type', /onValueWritten/.test(stripped));

// ---------------------------------------------------------------------------
// 5. Only first 'Placed' status
// ---------------------------------------------------------------------------
ok('Only first Placed status triggers', /statusAfter !== 'placed'/.test(stripped) || /statusAfter === 'placed'/.test(stripped));

// ---------------------------------------------------------------------------
// 6. QR orders excluded
// ---------------------------------------------------------------------------
ok('QR orders excluded from alert', /source === 'QR'/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Dedupe: _adminWaNotified
// ---------------------------------------------------------------------------
ok('Dedupe: _adminWaNotified flag', /_adminWaNotified/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Admin JIDs resolved (outlet match + isSuper/isSupreme)
// ---------------------------------------------------------------------------
ok('Admin JIDs: outlet match + isSuper/isSupreme', /isSuper/.test(stripped) && /isSupreme/.test(stripped));

// ---------------------------------------------------------------------------
// 9. Outbound via sendOutboundMessage task queue
// ---------------------------------------------------------------------------
ok('Outbound via enqueueTask sendOutboundMessage', /enqueueTask\('sendOutboundMessage'/.test(stripped));

// ---------------------------------------------------------------------------
// 10. No whole `businesses` tree reads
// ---------------------------------------------------------------------------
ok('No db.ref("businesses") whole-tree read',
   !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 11. Exported from index.ts
// ---------------------------------------------------------------------------
const indexSrc = read(INDEX);
ok('Exported from functions/src/index.ts',
   /onOrderStatusAlert/.test(indexSrc) && /from '.\/triggers\/orderStatusAlert'/.test(indexSrc));

console.log(`\norder-status-alert guard ${pass}/11 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
