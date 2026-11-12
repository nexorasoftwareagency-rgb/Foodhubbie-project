#!/usr/bin/env node
/**
 * Self-check for the platform-health decision table (batch 23a).
 *
 *   node scripts/health-selfcheck.cjs
 *
 * Runs against the COMPILED module (`lib/shared/health/evaluate.js`), so it also
 * proves the build emitted it. `npm run build` first.
 */
const path = require('path');
const { evaluateHealth, STALE_AFTER_MS, REPEAT_NOTIFY_MS } = require(path.join(
    __dirname, '..', 'lib', 'shared', 'health', 'evaluate.js'
));

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (detail ? ' :: ' + detail : '')); }
};

const NOW = Date.parse('2026-11-12T09:04:00Z');
const LIVE = { state: 'healthy', since: NOW - 86400000, lastNotifiedAt: 0 };

// The real outage: 33 outlets froze between 20:03:15 and 20:03:24 IST on 11 Nov.
const frozen = (n, ageMs) => Array.from({ length: n }, (_, i) => ({
    bid: 'biz-' + i, oid: 'out-' + i, status: 'online', updatedAt: NOW - ageMs,
}));

// 1. healthy: fresh heartbeat + API 401
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 30000), apiOk: true, previous: LIVE });
    ok(r.state === 'healthy', 'fresh heartbeat + api 401 -> healthy', r.state);
    ok(r.notify === null, 'healthy -> no notification', JSON.stringify(r.notify));
    ok(r.stale.length === 0, 'healthy -> no stale outlets');
}

// 2. the actual incident: everything stale, API unreachable
{
    const ageMin = 782;
    const prev = { state: 'healthy', since: NOW - 86400000, lastNotifiedAt: 0 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, ageMin * 60000), apiOk: false, previous: prev });
    ok(r.state === 'down', '33 stale + api down -> down', r.state);
    ok(r.newestAgeMin === ageMin, 'reports the real heartbeat age', String(r.newestAgeMin));
    ok(r.notify && r.notify.kind === 'down' && r.notify.repeat === false, 'transition notifies once', JSON.stringify(r.notify));
    ok(r.since === NOW, 'since resets on transition', String(r.since));
    ok(r.stale.length === 10, 'stale list capped at 10', String(r.stale.length));
    ok(r.reasons.length === 2, 'both reasons recorded', r.reasons.join(' / '));
}

// 3. still down: hourly nudge, not every 5 minutes
{
    const prev = { state: 'down', since: NOW - 3600000, lastNotifiedAt: NOW - 10 * 60000 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 600000), apiOk: false, previous: prev });
    ok(r.notify === null, 'down + notified 10 min ago -> silent', JSON.stringify(r.notify));

    const prev2 = { state: 'down', since: NOW - 7200000, lastNotifiedAt: NOW - REPEAT_NOTIFY_MS };
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, 600000), apiOk: false, previous: prev2 });
    ok(r2.notify && r2.notify.repeat === true, 'down + 60 min since last -> repeat', JSON.stringify(r2.notify));
    ok(r2.since === prev2.since, 'since preserved while state unchanged');
}

// 4. recovery
{
    const prev = { state: 'down', since: NOW - 3600000, lastNotifiedAt: NOW - 600000 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 15000), apiOk: true, previous: prev });
    ok(r.state === 'healthy' && r.notify && r.notify.kind === 'recovered', 'down -> healthy notifies recovered', JSON.stringify(r.notify));
}

// 5. partial: DB fresh but API dead  (degraded, not down)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 20000), apiOk: false, previous: LIVE });
    ok(r.state === 'degraded', 'fresh DB + dead api -> degraded', r.state);
}

// 6. partial: API alive but DB writer frozen (degraded, not down)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 10 * 60000), apiOk: true, previous: LIVE });
    ok(r.state === 'degraded', 'stale DB + live api -> degraded', r.state);
    ok(r.reasons[0].indexOf('no botStatus write') === 0, 'reason names the heartbeat');
}

// 7. a handful of stale outlets must NOT fail the platform (one tenant stopped)
{
    const outlets = frozen(30, 20000).concat(frozen(3, 60 * 60000));
    const r = evaluateHealth({ now: NOW, outlets, apiOk: true, previous: LIVE });
    ok(r.state === 'healthy', '3 of 33 stale -> still healthy', r.state);
    ok(r.stale.length === 3, 'but they are listed', String(r.stale.length));
}

// 8. first ever run, no previous state, and it is healthy -> no notification
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 20000), apiOk: true, previous: null });
    ok(r.state === 'healthy' && r.notify === null, 'first run healthy -> silent');
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, 900000), apiOk: false, previous: null });
    ok(r2.notify && r2.notify.kind === 'down', 'first run broken -> notify', JSON.stringify(r2.notify));
}

// 9. no data at all (empty outletIndex / fresh project)  -> down, never healthy
{
    const r = evaluateHealth({ now: NOW, outlets: [], apiOk: false, previous: null });
    ok(r.state === 'down', 'no outlets + no api -> down', r.state);
    ok(r.newestHeartbeatAt === null && r.newestAgeMin === null, 'null heartbeat reported honestly');
}

// 10. exactly at the threshold is still healthy (30 s writer, 5 min budget)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, STALE_AFTER_MS), apiOk: true, previous: LIVE });
    ok(r.state === 'healthy', 'heartbeat exactly at STALE_AFTER_MS -> healthy', r.state);
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, STALE_AFTER_MS + 1000), apiOk: true, previous: LIVE });
    ok(r2.state === 'degraded', 'one second over -> degraded', r2.state);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
