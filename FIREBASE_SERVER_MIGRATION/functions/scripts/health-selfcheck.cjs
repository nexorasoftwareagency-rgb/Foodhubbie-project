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
const { evaluateHealth, healthMessage, STALE_AFTER_MS, REPEAT_NOTIFY_MS } = require(path.join(
    __dirname, '..', 'lib', 'shared', 'health', 'evaluate.js'
));

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (detail ? ' :: ' + detail : '')); }
};

const NOW = Date.parse('2026-11-12T09:04:00Z');
const LIVE = { state: 'socket-healthy', since: NOW - 86400000, lastNotifiedAt: 0 };

// The real outage: 33 outlets froze between 20:03:15 and 20:03:24 IST on 11 Nov.
const frozen = (n, ageMs) => Array.from({ length: n }, (_, i) => ({
    bid: 'biz-' + i, oid: 'out-' + i, status: 'online', updatedAt: NOW - ageMs,
}));

// 1. healthy: fresh heartbeat + API 401
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 30000), apiOk: true, previous: LIVE });
    ok(r.state === 'socket-healthy', 'fresh heartbeat + api 401 -> socket-healthy', r.state);
    ok(r.notify === null, 'healthy -> no notification', JSON.stringify(r.notify));
    ok(r.stale.length === 0, 'healthy -> no stale outlets');
}

// 2. the actual incident: everything stale, API unreachable
{
    const ageMin = 782;
    const prev = { state: 'socket-healthy', since: NOW - 86400000, lastNotifiedAt: 0 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, ageMin * 60000), apiOk: false, previous: prev });
    ok(r.state === 'socket-down', '33 stale + api down -> socket-down', r.state);
    ok(r.newestAgeMin === ageMin, 'reports the real heartbeat age', String(r.newestAgeMin));
    ok(r.notify && r.notify.kind === 'down' && r.notify.repeat === false, 'transition notifies once', JSON.stringify(r.notify));
    ok(r.since === NOW, 'since resets on transition', String(r.since));
    ok(r.stale.length === 10, 'stale list capped at 10', String(r.stale.length));
    ok(r.reasons.length === 2, 'both reasons recorded', r.reasons.join(' / '));
}

// 3. still down: hourly nudge, not every 5 minutes
{
    const prev = { state: 'socket-down', since: NOW - 3600000, lastNotifiedAt: NOW - 10 * 60000 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 600000), apiOk: false, previous: prev });
    ok(r.notify === null, 'down + notified 10 min ago -> silent', JSON.stringify(r.notify));

    const prev2 = { state: 'socket-down', since: NOW - 7200000, lastNotifiedAt: NOW - REPEAT_NOTIFY_MS };
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, 600000), apiOk: false, previous: prev2 });
    ok(r2.notify && r2.notify.repeat === true, 'down + 60 min since last -> repeat', JSON.stringify(r2.notify));
    ok(r2.since === prev2.since, 'since preserved while state unchanged');
}

// 4. recovery
{
    const prev = { state: 'socket-down', since: NOW - 3600000, lastNotifiedAt: NOW - 600000 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 15000), apiOk: true, previous: prev });
    ok(r.state === 'socket-healthy' && r.notify && r.notify.kind === 'recovered', 'down -> healthy notifies recovered', JSON.stringify(r.notify));
}

// 5. partial: DB fresh but API dead  (degraded, not down)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 20000), apiOk: false, previous: LIVE });
    ok(r.state === 'socket-degraded', 'fresh DB + dead api -> socket-degraded', r.state);
}

// 6. partial: API alive but DB writer frozen (degraded, not down)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 10 * 60000), apiOk: true, previous: LIVE });
    ok(r.state === 'socket-degraded', 'stale DB + live api -> socket-degraded', r.state);
    ok(r.reasons[0].indexOf('no botStatus write') === 0, 'reason names the heartbeat');
}

// 7. a handful of stale outlets must NOT fail the platform (one tenant stopped)
{
    const outlets = frozen(30, 20000).concat(frozen(3, 60 * 60000));
    const r = evaluateHealth({ now: NOW, outlets, apiOk: true, previous: LIVE });
    ok(r.state === 'socket-healthy', '3 of 33 stale -> still healthy', r.state);
    ok(r.stale.length === 3, 'but they are listed', String(r.stale.length));
}

// 8. first ever run, no previous state, and it is healthy -> no notification
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 20000), apiOk: true, previous: null });
    ok(r.state === 'socket-healthy' && r.notify === null, 'first run healthy -> silent');
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, 900000), apiOk: false, previous: null });
    ok(r2.notify && r2.notify.kind === 'down', 'first run broken -> notify', JSON.stringify(r2.notify));
}

// 9. no data at all (empty outletIndex / fresh project)  -> down, never healthy
{
    const r = evaluateHealth({ now: NOW, outlets: [], apiOk: false, previous: null });
    ok(r.state === 'socket-down', 'no outlets + no api -> socket-down', r.state);
    ok(r.newestHeartbeatAt === null && r.newestAgeMin === null, 'null heartbeat reported honestly');
}

// 10. exactly at the threshold is still healthy (30 s writer, 5 min budget)
{
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, STALE_AFTER_MS), apiOk: true, previous: LIVE });
    ok(r.state === 'socket-healthy', 'heartbeat exactly at STALE_AFTER_MS -> healthy', r.state);
    const r2 = evaluateHealth({ now: NOW, outlets: frozen(33, STALE_AFTER_MS + 1000), apiOk: true, previous: LIVE });
    ok(r2.state === 'socket-degraded', 'one second over -> degraded', r2.state);
}

// 11. a legacy stored state ('down' from before 2026-11-19) is not the same
//     verdict as 'socket-down', so the first pass after deploy sends ONE
//     corrected message instead of staying silent about the misnamed state.
{
    const prev = { state: 'down', since: NOW - 3600000, lastNotifiedAt: NOW - 600000 };
    const r = evaluateHealth({ now: NOW, outlets: frozen(33, 900000), apiOk: false, previous: prev });
    ok(r.state === 'socket-down' && r.notify && r.notify.kind === 'down', 'legacy state -> one corrected push', JSON.stringify(r.notify));
}

// 12. relay flags: with the socket down, a capability whose cloud relay is off
//     is covered by nobody -> capability-gap, not a reassuring "all fine".
{
    const prev = { state: 'socket-down', since: NOW - 3600000, lastNotifiedAt: NOW - 600000 };
    const r = evaluateHealth({
        now: NOW, outlets: frozen(33, 900000), apiOk: false, previous: prev,
        relayOff: ['orderFinalizer'],
    });
    ok(r.state === 'capability-gap', 'socket down + relay off -> capability-gap', r.state);
    ok(r.uncovered.length === 1 && r.uncovered[0] === 'order finalization', 'names the uncovered capability', r.uncovered.join(','));

    // While the socket is UP the bot runs it, so an off flag is not a gap.
    const up = evaluateHealth({
        now: NOW, outlets: frozen(33, 20000), apiOk: true, previous: LIVE,
        relayOff: ['orderFinalizer'],
    });
    ok(up.state === 'socket-healthy' && up.uncovered.length === 0, 'relay off but socket up -> no gap', up.state);
}

// 13. THE COPY. It used to say "Bots, order finalization and API endpoints are
//     offline" while order finalization was demonstrably online - a false alarm
//     that ran for 7 days. These assertions are the regression tripwire.
{
    const facts = { newestAgeMin: 782, apiOk: false, relayOff: [], uncovered: [] };
    const down = healthMessage('down', facts);
    ok(down.title === 'WhatsApp bot offline', 'the title names the subject', down.title);
    ok(/WhatsApp is down/.test(down.body), 'the body says WhatsApp is down');
    ok(/unaffected/.test(down.body), 'the body says what still works');
    ok(!/finalization and API endpoints are offline/.test(down.body), 'it no longer claims the cloud is offline');
    ok(!/PLATFORM DOWN/.test(down.title + down.body), 'it no longer says PLATFORM DOWN');

    const gap = healthMessage('down', {
        newestAgeMin: 782, apiOk: false,
        relayOff: ['orderFinalizer'], uncovered: ['order finalization'],
    });
    ok(/not running/i.test(gap.title + gap.body), 'a capability gap is announced as not running');
    ok(/orderFinalizer/.test(gap.body), 'it names the flag to fix');

    const degradedFresh = healthMessage('degraded', { newestAgeMin: 1, apiOk: false, relayOff: [], uncovered: [] });
    ok(/not answering/.test(degradedFresh.body), 'degraded names the API edge');

    const degradedStale = healthMessage('degraded', { newestAgeMin: 9, apiOk: true, relayOff: [], uncovered: [] });
    ok(/worker may be stopped/.test(degradedStale.body), 'degraded names the worker');

    const recovered = healthMessage('recovered', { newestAgeMin: 1, apiOk: true, relayOff: [], uncovered: [] });
    ok(/never affected/.test(recovered.body), 'recovery says the rest was never affected');
    ok(!/Order finalization and api.foodhubbie.in are online/.test(recovered.body), 'recovery does not credit the cloud');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
