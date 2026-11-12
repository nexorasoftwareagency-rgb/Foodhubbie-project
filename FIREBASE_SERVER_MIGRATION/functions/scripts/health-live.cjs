#!/usr/bin/env node
/**
 * Run the REAL platform-health pass from a laptop (batch 23a live check).
 *
 *   node scripts/health-live.cjs            # dry run: compute + print, no writes, no push
 *   node scripts/health-live.cjs --write    # write platformHealth/state (+ push if a transition)
 *
 * Uses the repo service account via GOOGLE_APPLICATION_CREDENTIALS, so it hits
 * the same RTDB the deployed function reads.
 */
const path = require('path');
const fs = require('fs');

const repoBotSa = path.join(__dirname, '..', '..', '..', 'bot', 'service-account.json');
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(repoBotSa)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = repoBotSa;
}
process.env.FIREBASE_DATABASE_URL =
    process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com';

const { initializeAdmin, getDB } = require(path.join(__dirname, '..', 'lib', 'shared', 'firebase', 'admin.js'));
const { runPlatformHealthPass } = require(path.join(__dirname, '..', 'lib', 'scheduled', 'platformHealth.js'));

(async () => {
    await initializeAdmin();
    const write = process.argv.includes('--write');
    const { report, notification } = await runPlatformHealthPass(getDB(), { dryRun: !write });

    console.log('\n=== platform health ===');
    console.log('state              :', report.state);
    console.log('outlets            :', report.total);
    console.log('newest heartbeat   :', report.newestHeartbeatAt ? new Date(report.newestHeartbeatAt).toISOString() : '(none)');
    console.log('newest age         :', report.newestAgeMin === null ? '(never)' : report.newestAgeMin + ' min');
    console.log('api 401            :', report.apiOk);
    console.log('reasons            :', report.reasons.join(' | ') || '-');
    console.log('stale outlets      :', report.stale.length ? report.stale.map((s) => `${s.oid}(${s.ageMin}m,${s.status})`).join(', ') : '-');
    console.log('notify             :', report.notify ? JSON.stringify(report.notify) : 'none');
    if (notification) console.log('notification       :', JSON.stringify(notification));
    console.log('mode               :', write ? 'WRITE' : 'dry run (nothing written, nothing pushed)');
    process.exit(0);
})().catch((e) => {
    console.error('FATAL:', e && e.message);
    process.exit(1);
});
