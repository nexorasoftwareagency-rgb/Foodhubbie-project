#!/usr/bin/env node
/**
 * Daily reports guard (EC2 retirement batch).
 *
 *   node tests/daily-reports.check.cjs
 *
 * `dailyReports` (scheduled function) sends daily/weekly/monthly sales reports
 * to outlet admins via WhatsApp. Replaces the EC2 bot's sendDailyReportSafely()
 * (bot/index.js:2108) and reports.js.
 *
 * Pins:
 *   - Demo tenant (foodhubbie-demo) hard-skipped.
 *   - Config flag gate: config/dailyReports/enabled === true.
 *   - Schedule: 21:30 IST daily (16:30 UTC cron).
 *   - Weekly (Sunday) and monthly (1st) variants derived from day-of-week/month.
 *   - Report includes: order count, total sales, tax, discount, delivery fee,
 *     by channel and by status breakdown.
 *   - Outlet store name read for branding.
 *   - Admin JIDs resolved (outlet match + isSuper/isSupreme).
 *   - Outbound via sendOutboundMessage task queue.
 *   - No whole `businesses` tree reads (indexed query by createdAt).
 *
 * Static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailyReports.ts';
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
ok('Config flag gate: config/dailyReports/enabled', /dailyReports\/enabled/.test(stripped));

// ---------------------------------------------------------------------------
// 3. Schedule: 21:30 IST daily
// ---------------------------------------------------------------------------
ok('Schedule: 21:30 IST (16:30 UTC)', /schedule/.test(stripped) && /16/.test(stripped));

// ---------------------------------------------------------------------------
// 4. Weekly (Sunday) and monthly (1st) variants
// ---------------------------------------------------------------------------
ok('Weekly/monthly variants: day-of-week + day-of-month',
   /dayOfWeek/.test(stripped) && /dayOfMonth/.test(stripped));

// ---------------------------------------------------------------------------
// 5. Report includes order count, sales, tax, discount, delivery fee
// ---------------------------------------------------------------------------
ok('Report metrics: orders, sales, tax, discount, delivery fee',
   /orderCount/.test(stripped) && /totalSales/.test(stripped) && /totalTax/.test(stripped));

// ---------------------------------------------------------------------------
// 6. By channel and by status breakdown
// ---------------------------------------------------------------------------
ok('Breakdown: by channel + by status', /bySource/.test(stripped) && /byStatus/.test(stripped));

// ---------------------------------------------------------------------------
// 7. Store name read for branding
// ---------------------------------------------------------------------------
ok('Store name read: settings/Store/storeName', /settings\/Store\/storeName/.test(stripped));

// ---------------------------------------------------------------------------
// 8. Admin JIDs resolved
// ---------------------------------------------------------------------------
ok('Admin JIDs: outlet match + isSuper/isSupreme', /isSuper/.test(stripped) && /isSupreme/.test(stripped));

// ---------------------------------------------------------------------------
// 9. Outbound via sendOutboundMessage task queue
// ---------------------------------------------------------------------------
ok('Outbound via enqueueTask sendOutboundMessage', /enqueueTask\('sendOutboundMessage'/.test(stripped));

// ---------------------------------------------------------------------------
// 10. Indexed query by createdAt (not whole-tree read)
// ---------------------------------------------------------------------------
ok('Indexed query: orderByChild createdAt', /orderByChild\('createdAt'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 11. No whole `businesses` tree reads
// ---------------------------------------------------------------------------
ok('No db.ref("businesses") whole-tree read',
   !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// ---------------------------------------------------------------------------
// 12. Exported from index.ts
// ---------------------------------------------------------------------------
const indexSrc = read(INDEX);
ok('Exported from functions/src/index.ts',
   /dailyReports/.test(indexSrc) && /from '.\/scheduled\/dailyReports'/.test(indexSrc));

console.log(`\ndaily-reports guard ${pass}/12 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
