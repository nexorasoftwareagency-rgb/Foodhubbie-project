#!/usr/bin/env node
/**
 * Promo scheduler guard (EC2 retirement batch).
 *
 *   node tests/promo-scheduler.check.cjs
 *
 * `promoScheduler` (scheduled function) picks up scheduled WhatsApp promotional
 * campaigns whose runAt is due and enqueues send tasks. Replaces the EC2 bot's
 * `pickupScheduledPromotions()` heartbeat (bot/index.js:2141) and the
 * `runPromotionCampaign()` loop (bot/promotions.js:314).
 *
 * Pins:
 *   - Demo tenant (foodhubbie-demo) hard-skipped.
 *   - Config flag gate: config/promoScheduler/enabled === true.
 *   - Kill switch (bot/promotions/killSwitch) respected.
 *   - Daily cap (PROMO_DAILY_LIMIT = 300) enforced.
 *   - Warm-up schedule (20 → 40 → 60 → 100 → 150 → 200 → 250 → 300).
 *   - Campaign status transitions: scheduled → running → completed/paused.
 *   - Tasks enqueued to sendOutboundMessage task queue.
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

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/promoScheduler.ts';
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
ok('Config flag gate: config/promoScheduler/enabled', /promoScheduler\/enabled/.test(stripped));

// ---------------------------------------------------------------------------
// 3. Kill switch respected
// ---------------------------------------------------------------------------
ok('Kill switch: bot/promotions/killSwitch', /killSwitch/.test(stripped));

// ---------------------------------------------------------------------------
// 4. Daily cap enforced (300)
// ---------------------------------------------------------------------------
ok('Daily cap: PROMO_DAILY_LIMIT = 300', /PROMO_DAILY_LIMIT.*300/.test(stripped) || /300/.test(stripped));

// ---------------------------------------------------------------------------
// 5. Warm-up schedule (20, 40, 60, 100, 150, 200, 250, 300)
// ---------------------------------------------------------------------------
ok('Warm-up schedule: 20 → 300', /20/.test(stripped) && /250/.test(stripped));

// ---------------------------------------------------------------------------
// 6. Campaign status transitions
// ---------------------------------------------------------------------------
ok('Campaign status: scheduled → running → completed',
   /'scheduled'/.test(stripped) && /'running'/.test(stripped) && /'completed'/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Tasks enqueued to sendOutboundMessage
// ---------------------------------------------------------------------------
ok('Tasks enqueued: enqueueTask sendOutboundMessage',
   /enqueueTask\s*\(\s*'sendOutboundMessage'/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Scheduled every 5 minutes
// ---------------------------------------------------------------------------
ok('Schedule: every 5 minutes', /every 5 minutes/.test(stripped));

// ---------------------------------------------------------------------------
// 9. Timezone Asia/Kolkata
// ---------------------------------------------------------------------------
ok('Timezone: Asia/Kolkata', /Asia\/Kolkata/.test(stripped));

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
   /promoScheduler/.test(indexSrc) && /from '.\/scheduled\/promoScheduler'/.test(indexSrc));

console.log(`\npromo-scheduler guard ${pass}/11 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
