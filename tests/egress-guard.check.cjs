#!/usr/bin/env node
/**
 * RTDB egress guard (EC2 retirement batch).
 *
 *   node tests/egress-guard.check.cjs
 *
 * The 2026-11-10 RTDB egress incident was caused by `bot/index.js` reading the
 * whole `businesses` tree (5.0 MB) on every Baileys reconnect. Cloud Functions
 * triggers must NEVER read the whole tree — they read single leaf nodes or
 * indexed queries only.
 *
 * Pins for all new EC2-retirement functions:
 *   - webhookInbox.ts: reads config flag + single webhookInbox entry
 *   - orderStatusAlert.ts: reads single order + admins root (small)
 *   - promoScheduler.ts: reads outletIndex + campaigns per outlet
 *   - dailyReports.ts: reads outletIndex + indexed orders query
 *   - processInboundMessage.ts: reads sessions, settings, optout, strikes
 *   - All shared modules (session, rateLimit, strikeTracker): single paths
 *
 * None may contain `db.ref('businesses')` or `ref('businesses')`.
 * None may read `businesses/{bid}` without `{oid}`.
 *
 * Static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = [
  'FIREBASE_SERVER_MIGRATION/functions/src/triggers/webhookInbox.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderStatusAlert.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/promoScheduler.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailyReports.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/processInboundMessage.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/shared/session.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/shared/rateLimit.ts',
  'FIREBASE_SERVER_MIGRATION/functions/src/shared/strikeTracker.ts',
];

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

let allClean = true;

for (const file of FILES) {
  const src = read(file);
  const stripped = stripComments(src);

  // Check for whole-tree businesses read
  const wholeTreeRead =
    /db\.ref\(['"]businesses['"]\)/.test(stripped) ||
    /ref\(['"]businesses['"]\)/.test(stripped) ||
    /getDB\(\)\.ref\(['"]businesses['"]\)/.test(stripped);

  // Check for businesses/{bid} without oid (should always be businesses/{bid}/outlets/{oid})
  const bidOnlyRead =
    /db\.ref\([^)]*businesses\/\{[^}]+\}[^)]*\)/.test(stripped) &&
    !/outlets/.test(stripped);

  if (wholeTreeRead) {
    ok(`${file}: no whole businesses tree read`, false, 'contains db.ref("businesses")');
    allClean = false;
  } else {
    ok(`${file}: no whole businesses tree read`, true);
    pass++; // already counted by ok, adjust
    pass--; // ok() increments, we want to count it once
    // Actually ok() already increments pass, so don't double-count
  }

  if (bidOnlyRead) {
    ok(`${file}: businesses/{bid} always has /outlets/{oid}`, false, 'reads businesses/{bid} without oid');
    allClean = false;
  } else {
    ok(`${file}: businesses/{bid} always has /outlets/{oid}`, true);
    pass--;
  }
}

// ---------------------------------------------------------------------------
// Additional: verify index.ts exports all new functions
// ---------------------------------------------------------------------------
const indexSrc = read('FIREBASE_SERVER_MIGRATION/functions/src/index.ts');
ok('index.ts exports onWebhookInboxMessage', /onWebhookInboxMessage/.test(indexSrc));
ok('index.ts exports onOrderStatusAlert', /onOrderStatusAlert/.test(indexSrc));
ok('index.ts exports promoScheduler', /promoScheduler/.test(indexSrc));
ok('index.ts exports dailyReports', /dailyReports/.test(indexSrc));

console.log(`\negress guard ${pass}/${FILES.length + 4} passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
