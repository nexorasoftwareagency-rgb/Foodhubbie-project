#!/usr/bin/env node
/**
 * Daily rider settlement guard (batch 23i).
 *
 *   node tests/daily-settlement.check.cjs
 *
 * The job itself is a scheduled Cloud Function, so this guard pins the wiring
 * that makes it correct — the cron, the one shared day claim, the cheap
 * enumeration, the hard-skips and the record shape the Admin dashboard and the
 * rider app already read. Behaviour on real data was proven live (`26/26`,
 * `%TEMP%/opencode/e2e-23i-daily-settlement.cjs`); this file is what stops a
 * future edit from quietly changing money-adjacent behaviour.
 *
 * Static only — no network, no credentials, no build step.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FN = 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailySettlement.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';
const CONTROL_API = 'bot-control-api/server.js';
const RIDER_APP = 'rider-app/src/services/walletService.ts';

const src = read(FN);
// Strip comments first: the header documents the bug ("the control API did
// ref('businesses').get()"), and a source pin must scan code, not prose.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fn = stripComments(src);
const index = read(INDEX);
const controlApi = read(CONTROL_API);

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

// ---------------------------------------------------------------------------
// 1. The schedule
// ---------------------------------------------------------------------------
ok('scheduled at 23:00 IST every day', /schedule:\s*'0 23 \* \* \*'/.test(fn));
ok('runs in Asia/Kolkata (not the box\'s UTC 23:00 = 04:30 IST)',
    /timeZone:\s*'Asia\/Kolkata'/.test(fn));
ok('single instance, so two passes cannot race the claim', /maxInstances:\s*1/.test(fn));
ok('has FIREBASE_DATABASE_URL bound', /secrets:\s*\['FIREBASE_DATABASE_URL'\]/.test(fn));
ok('bounded runtime', /timeoutSeconds:\s*120/.test(fn));

// ---------------------------------------------------------------------------
// 2. Enumeration: riderIndex only. The whole `businesses` tree is the exact
//    egress bug the platform already paid for three times (batch 11/14/15).
// ---------------------------------------------------------------------------
ok('enumerates the riderIndex registry', /const RIDER_INDEX = 'riderIndex'/.test(fn));
ok('never reads the whole businesses tree (the batch 11/14/15 egress bug)',
    !/ref\(\s*['"`]businesses['"`]\s*\)/.test(fn));
ok('reads only per-rider leaves', /riders\/\$\{uid\}/.test(fn) && /riderStats\/\$\{uid\}/.test(fn)
    && /settlements\/\$\{uid\}/.test(fn));
ok('a stale index entry (no rider record) is skipped',
    /\.exists\(\)/.test(fn) && /skipped\.noRider/.test(fn));

// ---------------------------------------------------------------------------
// 3. The day claim — ONE shared path with the control API, taken BEFORE the
//    work (at-most-once: a crash loses a day, it never double-pays), and taken
//    with a transaction so a retry cannot re-run.
// ---------------------------------------------------------------------------
ok('uses the control API\'s own day claim', /meta\/dailySettlementLastRun/.test(fn));
ok('the control API still reads the same path',
    /SETTLEMENT_LAST_RUN_PATH = 'meta\/dailySettlementLastRun'/.test(controlApi));
ok('the claim is a transaction, not read-then-set',
    /ref\(LAST_RUN_PATH\)\.transaction\(/.test(fn));
ok('both sides key the day by UTC date (so the box and the cloud cannot both settle)',
    /toISOString\(\)\.slice\(0, 10\)/.test(fn) && /toISOString\(\)\.slice\(0, 10\)/.test(controlApi));
ok('the stamp aborts when today is already stamped',
    /if \(cur === day\) return undefined/.test(fn));
ok('an early return happens BEFORE any rider work',
    /if \(!\(await claimDay[\s\S]{0,400}return summary;/.test(fn));

// ---------------------------------------------------------------------------
// 4. Never settle the demo tenant
// ---------------------------------------------------------------------------
ok('demo tenant hard-skipped', /const DEMO_BID = 'foodhubbie-demo'/.test(fn) && /bid === DEMO_BID/.test(fn));

// ---------------------------------------------------------------------------
// 5. The record — byte-compatible with what the Admin dashboard writes and the
//    rider app reads (walletService sorts by `timestamp`, ack writes `riderAck`).
// ---------------------------------------------------------------------------
ok('record carries amountCollected', /amountCollected: pendingCash/.test(fn));
ok('record is tagged as the daily auto-settlement', /source: 'daily-auto-settlement'/.test(fn));
ok('record names the cron in settledByAdmin', /settledByAdmin: 'Auto-Settlement \(Daily Cron\)'/.test(fn));
ok('record keeps the pre-existing ordersClearedCount semantics (all-time totalOrders)',
    /ordersClearedCount: Number\(stats\.totalOrders\) \|\| 0/.test(fn));
ok('riderAck starts empty (RTDB stores no nulls, so it is absent until the rider confirms)',
    /riderAck: null/.test(fn));
ok('the rider app still reads settlements/{uid} and writes riderAck',
    /settlements:/.test(read('rider-app/src/lib/constants.ts')) &&
    /settlementAck:/.test(read('rider-app/src/lib/constants.ts')) &&
    /dbPaths\.settlements\(uid\)/.test(read(RIDER_APP)));
ok('one record per rider per pass, push-keyed like the manual flow',
    /settlements\/\$\{uid\}`\)\.push\(record\)/.test(fn));

// ---------------------------------------------------------------------------
// 6. The money rule itself
// ---------------------------------------------------------------------------
ok('pending cash = max(0, earned - already settled)',
    /Math\.max\(0, totalEarnings - settledTotal\)/.test(fn));
ok('a rider with nothing pending is skipped',
    /if \(pendingCash <= 0\)/.test(fn));
ok('earnings and settled totals are coerced to numbers (RTDB may hand back strings)',
    /Number\(stats\.totalEarnings\) \|\| 0/.test(fn) && /Number\(s && s\.amountCollected\) \|\| 0/.test(fn));
ok('no money is moved — nothing writes riderStats/riders/payment nodes',
    !/riderStats\/\$\{uid\}`\)\.(set|update|transaction)\(/.test(fn) &&
    !/riders\/\$\{uid\}`\)\.(set|update|transaction)\(/.test(fn) &&
    !/payment|walletBilling/.test(fn));

// ---------------------------------------------------------------------------
// 7. Deployed, socket-free, and honest about its own run
// ---------------------------------------------------------------------------
ok('exported from the functions entry point', /export \{ dailySettlement \}/.test(index));
ok('does not touch the WhatsApp worker', !/baileys|bot\/index|bot\/firebase/i.test(fn));
ok('writes a support-visible summary of the last pass', /meta\/dailySettlement\/last/.test(fn));

console.log(`\n${pass} passed, ${process.exitCode ? 1 : 0} failed`);
