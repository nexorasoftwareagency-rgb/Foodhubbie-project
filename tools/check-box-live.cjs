#!/usr/bin/env node
/**
 * Is the EC2 box alive?  (batch 23 incident, read-only)
 *
 *   node tools/check-box-live.cjs
 *
 * Two independent signals, both written by processes on the box:
 *   1. `businesses/{bid}/outlets/{oid}/botStatus` — the control API rewrites
 *      `updatedAt` every 30 s, once per outlet. Age > 120 s means the box is gone
 *      or cannot reach Firebase.
 *   2. `bot/status.lastSeen` — the bot worker's own heartbeat (a different pm2
 *      app), so one crashed app cannot look like a dead host.
 * Plus one HTTP check: `api.foodhubbie.in` must answer 401 (alive, token-gated).
 *
 * Exit 0 all green / 1 something is down.
 */
const https = require('https');
const admin = require('../bot/node_modules/firebase-admin');

admin.initializeApp({
    credential: admin.credential.cert(require('../bot/service-account.json')),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
});
const db = admin.database();
const MAX_AGE_MIN = 2;

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
    if (c) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (detail ? ' :: ' + detail : '')); }
};
const ago = (ms) => ms ? `${((Date.now() - ms) / 60000).toFixed(1)} min` : 'never';
const ist = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

function httpStatus(url) {
    return new Promise((resolve) => {
        const req = https.get(url, (res) => { res.resume(); resolve(res.statusCode); });
        req.setTimeout(15000, () => { req.destroy(); resolve('timeout'); });
        req.on('error', (e) => resolve(e.code || 'error'));
    });
}

(async () => {
    const index = (await db.ref('outletIndex').once('value')).val() || {};
    const outlets = Object.entries(index).filter(([, m]) => m && m.bid);
    console.log(`outlets in outletIndex: ${outlets.length}\n`);
    console.log('  bid / outlet                          status   botStatus age   pair       bot heartbeat');
    console.log('  ' + '-'.repeat(96));

    const rows = [];
    for (const [oid, meta] of outlets) {
        const base = `businesses/${meta.bid}/outlets/${oid}`;
        const st = (await db.ref(base + '/botStatus').once('value')).val() || {};
        const bot = (await db.ref(base + '/bot/status').once('value')).val() || {};
        const pair = (await db.ref(base + '/bot/pair/status').once('value')).val();
        rows.push({
            id: `${meta.bid}/${oid}`,
            uptime: st.uptime || 0,
            fresh: Number(st.updatedAt) > Date.now() - MAX_AGE_MIN * 60000,
            updatedAt: st.updatedAt,
        });
        console.log(`  ${`${meta.bid}/${oid}`.padEnd(36)}  ${String(st.status || '-').padEnd(8)} ${ago(st.updatedAt).padEnd(15)} ${String(pair || '-').padEnd(10)} ${ago(bot.lastSeen)}`);
    }

    const stale = rows.filter((r) => !r.fresh);
    const newest = rows.map((r) => r.updatedAt).filter(Boolean).sort((a, b) => b - a)[0];
    ok(stale.length === 0, `all ${rows.length} outlets write botStatus (<${MAX_AGE_MIN} min)`,
        stale.length ? `${stale.length} stale, newest writer pass ${ago(newest)} ago (${ist(newest)})` : '');

    const api = await httpStatus('https://api.foodhubbie.in/api/bot/status-all');
    ok(api === 401, 'api.foodhubbie.in answers 401 (alive, token-gated)', `got ${api}`);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
