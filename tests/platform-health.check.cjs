#!/usr/bin/env node
/**
 * Platform-health truth guard (2026-11-19).
 *
 *   node tests/platform-health.check.cjs
 *
 * `platformHealth` is the only thing that tells the owner the WhatsApp socket
 * host is gone. On 2026-11-19 it was found telling the owner a LIE: the push
 * said order finalization and the API endpoints were offline while order
 * finalization was demonstrably online on Cloud Functions, and the alert was
 * not even being DELIVERED (the owner's only super-admin token carried a dead
 * token stamp, and a 24 h mute on that stamp silenced the whole channel).
 *
 * Two things are pinned here:
 *
 *   1. the VERDICT names its subject (`socket-down`, not "platform down") and
 *      the COPY says what is down AND what still works;
 *   2. the DELIVERY cannot go silently mute again - a dead token is recorded,
 *      not excluded, and a token that works clears its own stamp.
 *
 * Static only - no network, no credentials, no build step. The behavioural
 * half (the compiled decision table + the real copy) runs too when the
 * functions bundle has been built (`npm --prefix FIREBASE_SERVER_MIGRATION/functions
 * run build`); CI runs that build, so the behavioural checks are real there.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

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

const FN = 'FIREBASE_SERVER_MIGRATION/functions/src/scheduled/platformHealth.ts';
const EVAL = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/health/evaluate.ts';
const SELFCHECK = 'FIREBASE_SERVER_MIGRATION/functions/scripts/health-selfcheck.cjs';
const ADMIN_FCM = 'Admin/js/fcm-init.js';

const fn = read(FN);
const evaluate = read(EVAL);
const selfCheck = read(SELFCHECK);
const adminFcm = read(ADMIN_FCM);

// ---------------------------------------------------------------------------
// 1. The verdict names its subject
// ---------------------------------------------------------------------------
ok('the health state is about the socket, not "the platform"',
    /export type HealthState = 'socket-healthy' \| 'socket-degraded' \| 'socket-down' \| 'capability-gap';/.test(evaluate),
    evaluate.match(/export type HealthState[^\n]*/) || []);
ok('the old catch-all state names are gone',
    !/HealthState = 'healthy'/.test(evaluate) && !/HealthState = 'healthy' \| 'degraded' \| 'down'/.test(evaluate));
ok('the relay flags are the single source of "who owns what"',
    /RELAY_FLAGS/.test(evaluate) &&
    ['pushRelay', 'orderFinalizer', 'loyaltyRelay', 'riderRelay'].every((f) => evaluate.includes(`flag: '${f}'`)));
ok('a capability nobody runs is its own state (cloud relay off + socket down)',
    /capability-gap/.test(evaluate) && /uncovered/.test(evaluate));
ok('the function reads the relay flags and feeds them to the verdict',
    /readRelayOff/.test(fn) && /relayOff/.test(fn) && /evaluateHealth\(\{[^}]*relayOff/.test(fn));

// ---------------------------------------------------------------------------
// 2. The copy tells the truth
// ---------------------------------------------------------------------------
ok('the push copy lives in the pure module (so it can be asserted)',
    /export function healthMessage\(/.test(evaluate) && /healthMessage\(/.test(fn));
ok('the old untested copy helper is gone', !/function bodyFor\(/.test(fn));
ok('the copy says what still works', /unaffected/.test(evaluate));
ok('the copy never claims the cloud is down',
    !/order finalization and API endpoints are offline/i.test(evaluate) &&
    !/Bots, order finalization and API endpoints are offline/i.test(evaluate) &&
    !/order finalization and API endpoints are offline/i.test(fn));
ok('the copy never says PLATFORM DOWN', !/PLATFORM DOWN/.test(evaluate) && !/PLATFORM DOWN/.test(fn));
ok('the state node records that the cloud half is up',
    /cloud: 'up'/.test(fn));

// The self-check is the tripwire - it must keep asserting the copy.
ok('the self-check asserts the copy (regression tripwire)',
    /it no longer claims the cloud is offline/.test(selfCheck) &&
    /the title names the subject/.test(selfCheck) &&
    /a capability gap is announced as not running/.test(selfCheck));
ok('the self-check covers the capability-gap state', /capability-gap/.test(selfCheck));

// ---------------------------------------------------------------------------
// 3. The alert channel cannot go silently mute again
// ---------------------------------------------------------------------------
ok('a dead token is NOT excluded from the alert channel',
    !/\.filter\(\([^\n]*fcmTokenInvalidAt/.test(fn));
ok('a successful send clears the dead-token stamp',
    /fcmTokenInvalidAt`\)\.remove\(\)/.test(fn));
ok('a permanently failed token is still stamped (so it can be traced)',
    /fcmTokenInvalidAt`\)\.set\(/.test(fn));
ok('the dashboard clears its own stale stamp when it stores a token',
    /fcmTokenInvalidAt/.test(adminFcm) && /remove\(ref\(db, `admins\/\$\{userId\}\/fcmTokenInvalidAt`\)\)/.test(adminFcm));
ok('delivery truth is written next to the verdict',
    /alertDelivered/.test(fn) && /alertAttempted/.test(fn) && /no-eligible-token/.test(fn));

// ---------------------------------------------------------------------------
// 4. Cheap-read discipline (batch-10 lesson) is preserved
// ---------------------------------------------------------------------------
ok('never reads the businesses tree', !/ref\('businesses'\)/.test(fn));
ok('never reads the whole botStatus node', !/ref\(`?businesses\/\$\{[^}]+\}\/botStatus`\)/.test(fn));

// ---------------------------------------------------------------------------
// 5. The behavioural half - the REAL compiled decision table + copy
// ---------------------------------------------------------------------------
const compiled = 'FIREBASE_SERVER_MIGRATION/functions/lib/shared/health/evaluate.js';
if (exists(compiled)) {
    const mod = require(path.join(ROOT, compiled));
    const facts = { newestAgeMin: 782, apiOk: false, relayOff: [], uncovered: [] };
    const down = mod.healthMessage('down', facts);
    ok('compiled copy: the title names the subject', down.title === 'WhatsApp bot offline', down.title);
    ok('compiled copy: it says what is down', /WhatsApp is down/.test(down.body), down.body);
    ok('compiled copy: it says what still works', /unaffected/.test(down.body), down.body);
    ok('compiled copy: it does not claim the cloud is offline',
        !/order finalization and API endpoints are offline/i.test(down.body), down.body);
    const gap = mod.healthMessage('down', {
        newestAgeMin: 782, apiOk: false, relayOff: ['orderFinalizer'], uncovered: ['order finalization'],
    });
    ok('compiled copy: a capability gap names the flag to fix', /orderFinalizer/.test(gap.body), gap.body);
    const report = mod.evaluateHealth({
        now: Date.parse('2026-11-19T00:00:00Z'),
        outlets: [{ bid: 'b', oid: 'o', status: 'online', updatedAt: Date.parse('2026-11-18T23:00:00Z') }],
        apiOk: false,
        previous: null,
        relayOff: ['orderFinalizer'],
    });
    ok('compiled verdict: socket down + relay off -> capability-gap', report.state === 'capability-gap', report.state);
    ok('compiled verdict: it names the uncovered capability',
        report.uncovered.length === 1 && report.uncovered[0] === 'order finalization', report.uncovered);
} else {
    console.log('  --  behavioural half skipped (bundle not built: npm --prefix FIREBASE_SERVER_MIGRATION/functions run build)');
}

// ---------------------------------------------------------------------------
// 6. The guard itself is wired into CI + npm
// ---------------------------------------------------------------------------
const pkg = read('package.json');
const ci = read('.github/workflows/ci.yml');
ok('npm script exists', /"test:platform-health":\s*"node tests\/platform-health\.check\.cjs"/.test(pkg));
ok('CI runs the guard', /platform-health\.check\.cjs/.test(ci));
ok('CI also runs the compiled self-check',
    /FIREBASE_SERVER_MIGRATION\/functions[\s\S]{0,200}run test:health/.test(ci) ||
    /run test:health/.test(ci));

console.log(`\n${pass} passed, ${process.exitCode ? 1 : 0} failed`);
