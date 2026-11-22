#!/usr/bin/env node
/**
 * Daily reports guard (batch 23n).
 *
 *   node tests/daily-reports.check.cjs
 *
 * `dailyReports` is the outlet's end-of-day WhatsApp sales summary, moved off
 * the Baileys heartbeat (`bot/index.js:2120` + `bot/reports.js`) onto the Cloud
 * API. One scheduled function, two cron minutes: 21:30 IST for today, 01:30 IST
 * as the bot's own "if it was off at 21:30" catch-up for yesterday.
 *
 * Pins (the old guard described the superseded draft that enqueued a Cloud Task
 * and invented a weekly/monthly schedule nobody ever received):
 *   - Schedule `30 1,21 * * *` Asia/Kolkata; 01:30 targets yesterday.
 *   - Idempotent per outlet per target date via meta/dailyReports/last/{bid}/{oid},
 *     claimed ONLY after at least one copy left the building.
 *   - The indexed orders query uses ISO-STRING bounds: orders.createdAt is an
 *     ISO string (`.validate` requires `.isString()`), so a numeric startAt/endAt
 *     would silently match nothing. This is the regression that guard exists for.
 *   - Sales counted with the shared isBilledOrder rule (cancelled/refunded never
 *     reported as revenue).
 *   - No weekly/monthly senders: in the bot they were reachable only from the
 *     `bot/commands` listener and nothing in Admin ever wrote those actions.
 *   - Tenant transport direct send, no Cloud Task, no global admins scan.
 *   - Demo skipped, flag gated, admin initialised before any DB read.
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
const indexSrc = read(INDEX);

// 1. Schedule + catch-up
ok('Schedule 01:30 + 21:30 IST', /schedule:\s*'30 1,21 \* \* \*'/.test(stripped));
ok("timeZone Asia/Kolkata", /timeZone:\s*'Asia\/Kolkata'/.test(stripped));
ok('01:30 run targets yesterday', /ist\.hour === 1/.test(stripped) && /addISTDays\(new Date\(now\), -1\)/.test(stripped));

// 2. Idempotency
ok('Per-outlet claim: meta/dailyReports/last/{bid}/{oid}',
  /CLAIM_ROOT\s*=\s*'meta\/dailyReports\/last'/.test(stripped) &&
  /\$\{CLAIM_ROOT\}\/\$\{bid\}\/\$\{oid\}/.test(stripped));
ok('Skips when the claim already has the target date', /claim\.dateStr === targetDate/.test(stripped));
{
  const sentAt = stripped.indexOf('sendMessage(');
  const writeAt = stripped.indexOf('.set({ dateStr: targetDate');
  ok('Claim written AFTER sending', sentAt > 0 && writeAt > sentAt, { sentAt, writeAt });
}
ok('Claim only when at least one copy left', /if \(sent > 0\)/.test(stripped));

// 3. THE regression: orders.createdAt is an ISO string
ok('IST day bounds built from the date string', /istDayBounds\(/.test(stripped));
ok('Indexed query uses ISO-string bounds (createdAt is a string)',
  /\.startAt\(startIso\)/.test(stripped) &&
  /\.endAt\(endIso\)/.test(stripped) &&
  /new Date\(start\)\.toISOString\(\)/.test(stripped));
ok('Indexed query: orderByChild createdAt', /orderByChild\('createdAt'\)/.test(stripped));
ok('Parses the stored string, does not Number() it', /Date\.parse\(o\.createdAt\)/.test(stripped));

// 4. Money rule + no invented cadence
ok('Sales use the shared isBilledOrder rule', /costMath\.isBilledOrder\(o\)/.test(stripped));
ok('Calls out cancelled/refunded as not-in-sales', /Cancelled\/Refunded/.test(stripped));
ok('No weekly/monthly senders', !/reportType/.test(stripped) && !/weekly/i.test(stripped) && !/monthly/i.test(stripped));

// 5. Message + branding
ok('Store name read: settings/Store/storeName', /settings\/Store\/storeName/.test(stripped));
ok('Body: daily title + date + totals',
  /DAILY SALES REPORT/.test(stripped) &&
  /TOTAL REVENUE/.test(stripped) &&
  /TOTAL ORDERS/.test(stripped));

// 6. Tenant scoping + send path
ok('Enumerates outletIndex only', /ref\('outletIndex'\)/.test(stripped));
ok('Recipients via tenantAlertRecipients()', /tenantAlertRecipients\(bid, oid\)/.test(stripped));
ok('Direct send over the tenant transport, not a Cloud Task',
  /makeTenantTransport\(bid, oid/.test(stripped) &&
  /transport\.sendMessage\(/.test(stripped) &&
  !/enqueueTask/.test(stripped) &&
  !/sendOutboundMessage/.test(stripped));
ok('Never scans the global admins root',
  !/ref\(['"]admins['"]\)/.test(stripped) && !/isSuper/.test(stripped) && !/isSupreme/.test(stripped));
ok('No whole businesses tree read',
  !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// 7. Gate + runtime contract
ok('Demo tenant hard-skipped', /foodhubbie-demo/.test(stripped));
ok('Config flag gate: config/dailyReports/enabled', /dailyReports\/enabled/.test(stripped));
{
  const initAt = stripped.indexOf('await initializeAdmin()');
  const firstDbAt = stripped.indexOf('getDB()');
  ok('initializeAdmin() before the first getDB()', initAt >= 0 && firstDbAt > initAt, { initAt, firstDbAt });
}
ok('Secrets: FIREBASE_DATABASE_URL + WA_PERMANENT_TOKEN',
  /secrets:\s*\['FIREBASE_DATABASE_URL',\s*'WA_PERMANENT_TOKEN'\]/.test(stripped));
ok('maxInstances: 1 (passes cannot overlap)', /maxInstances:\s*1/.test(stripped));

// 8. Deployed surface
ok('Exported from functions/src/index.ts',
  /dailyReports/.test(indexSrc) && /from '.\/scheduled\/dailyReports'/.test(indexSrc));

console.log(`\ndaily-reports guard ${pass}/27 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
