/**
 * Platform health decision table + the copy that goes with it (batch 23a) -
 * PURE, no Firebase imports.
 *
 * The 2026-11-11 outage was invisible for 13 hours because nothing watched the
 * box from outside it: `botStatus` stopped being written and only a human
 * noticed. This module turns the signals into one verdict:
 *
 *   1. `botStatus.updatedAt` - `bot-control-api` rewrites it for every outlet
 *      every 30 s. A stale newest value means the host (or that process) is gone.
 *   2. `GET https://api.foodhubbie.in/api/bot/status-all` -> 401 - proves the
 *      HTTP edge actually answers, not just that a process wrote to RTDB.
 *
 * Both are needed: a healthy DB writer with a dead API is a different outage
 * than a dead host, and reporting the wrong one sends the operator to the wrong
 * place. Kept dependency-free so `scripts/health-selfcheck.cjs` can run it
 * straight out of `lib/`.
 *
 * ## What this module is NOT allowed to claim
 *
 * Both signals live on the **WhatsApp socket host**. They say nothing about
 * Cloud Functions - and the cloud half cannot be "down" while this function is
 * running: if it executes, order finalization, loyalty, pushes, media,
 * onboarding, settlement and the wallet gate are all executing too. The old
 * verdict called this "the platform" and told the owner that order
 * finalization and the API endpoints were offline while order finalization was
 * demonstrably online - a false alarm that ran for 7 days.
 *
 * So the states name their subject (`socket-healthy` / `socket-degraded` /
 * `socket-down`) and the copy says what is down AND what is still up. The
 * third state, `capability-gap`, covers the one way the cloud can genuinely be
 * missing a capability: the relay flag that hands that capability to the cloud
 * is off, so the bot owns it - and the bot is the thing that is down.
 */

/**
 * The subject of this health check: the WhatsApp socket host and its control
 * plane. NOT the platform.
 */
export type HealthState = 'socket-healthy' | 'socket-degraded' | 'socket-down' | 'capability-gap';

/**
 * The relay flags that decide who owns a capability. `enabled === true` means
 * the CLOUD owns it (and keeps owning it while the box is dead); anything else
 * means the BOT owns it - so with the box down, nothing runs it.
 */
export const RELAY_FLAGS: ReadonlyArray<{ flag: string; capability: string }> = [
    { flag: 'pushRelay', capability: 'push notifications' },
    { flag: 'orderFinalizer', capability: 'order finalization' },
    { flag: 'loyaltyRelay', capability: 'loyalty earn/clawback' },
    { flag: 'riderRelay', capability: 'rider alerts' },
];

export interface OutletBeat {
    bid: string;
    oid: string;
    /** last `botStatus.status` (`online` / `offline` / `unknown`), informational */
    status: string;
    /** last `botStatus.updatedAt` in ms, or null when never written */
    updatedAt: number | null;
}

export interface PreviousHealth {
    /** a plain string: pre-2026-11-19 rows carry the old 'healthy'/'down' names */
    state: string;
    /** when the current state began (ms) */
    since: number;
    /** last time a notification was sent for this state (ms) */
    lastNotifiedAt: number;
}

export interface HealthReport {
    state: HealthState;
    since: number;
    reasons: string[];
    total: number;
    newestHeartbeatAt: number | null;
    newestAgeMin: number | null;
    stale: Array<{ bid: string; oid: string; status: string; ageMin: number | null }>;
    apiOk: boolean;
    /** relay flags that are NOT `enabled: true` (the bot owns those) */
    relayOff: string[];
    /** capabilities nobody is running (only possible while the socket is down) */
    uncovered: string[];
    notify: null | { kind: 'down' | 'degraded' | 'recovered'; repeat: boolean };
}

/**
 * The control API writes one outlet at a time, 30 s per full pass, so 5 minutes
 * is ten missed passes - long enough to ignore a deploy restart, short enough
 * that the 13-hour blind spot cannot happen again.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** While still broken, re-notify at most once per hour (phone-friendly). */
export const REPEAT_NOTIFY_MS = 60 * 60 * 1000;

/**
 * The one sentence that must never be wrong: what the owner still has while
 * WhatsApp is down. Order finalization, loyalty, stock, media, onboarding,
 * settlement, the wallet gate and every push path run on Cloud Functions.
 */
const STILL_UP =
    'Ordering, payments, loyalty, stock, app notifications and the dashboard are unaffected';

function ageMinutes(now: number, ts: number | null): number | null {
    if (!ts || !Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((now - ts) / 60000));
}

export function evaluateHealth(input: {
    now: number;
    outlets: OutletBeat[];
    apiOk: boolean;
    previous: PreviousHealth | null;
    /** relay flags that are not `enabled: true`; the bot owns those */
    relayOff?: string[];
}): HealthReport {
    const { now, outlets, apiOk, previous } = input;
    const relayOff = input.relayOff || [];

    let newestHeartbeatAt: number | null = null;
    for (const o of outlets) {
        if (o.updatedAt && Number.isFinite(o.updatedAt) && (newestHeartbeatAt === null || o.updatedAt > newestHeartbeatAt)) {
            newestHeartbeatAt = o.updatedAt;
        }
    }

    const newestAgeMin = ageMinutes(now, newestHeartbeatAt);
    const hostOk = newestHeartbeatAt !== null && now - newestHeartbeatAt <= STALE_AFTER_MS;

    const stale = outlets
        .filter((o) => !o.updatedAt || now - o.updatedAt > STALE_AFTER_MS)
        .map((o) => ({ bid: o.bid, oid: o.oid, status: o.status, ageMin: ageMinutes(now, o.updatedAt) }))
        .sort((a, b) => (b.ageMin || 0) - (a.ageMin || 0))
        .slice(0, 10);

    const reasons: string[] = [];
    if (!hostOk) {
        reasons.push(
            newestHeartbeatAt === null
                ? 'no outlet has ever written botStatus'
                : `no botStatus write for ${newestAgeMin} min`
        );
    }
    if (!apiOk) reasons.push('api.foodhubbie.in did not answer 401');

    const socketDown = !hostOk && !apiOk;

    // A capability is uncovered only when the socket is down AND its relay flag
    // leaves it with the bot. While the socket is up the bot runs it, so the
    // flag being off is not a problem.
    const uncovered = socketDown
        ? RELAY_FLAGS.filter((f) => relayOff.includes(f.flag)).map((f) => f.capability)
        : [];

    let state: HealthState;
    if (socketDown) state = uncovered.length ? 'capability-gap' : 'socket-down';
    else if (!hostOk || !apiOk) state = 'socket-degraded';
    else state = 'socket-healthy';

    const since = previous && previous.state === state ? previous.since : now;
    const lastNotifiedAt = (previous && previous.lastNotifiedAt) || 0;

    let notify: HealthReport['notify'] = null;
    if (state === 'socket-healthy') {
        // Only a transition matters; a healthy socket never nags.
        if (previous && previous.state !== 'socket-healthy') notify = { kind: 'recovered', repeat: false };
    } else if (!previous || previous.state !== state) {
        notify = { kind: state === 'socket-degraded' ? 'degraded' : 'down', repeat: false };
    } else if (now - lastNotifiedAt >= REPEAT_NOTIFY_MS) {
        notify = { kind: state === 'socket-degraded' ? 'degraded' : 'down', repeat: true };
    }

    return {
        state,
        since,
        reasons,
        total: outlets.length,
        newestHeartbeatAt,
        newestAgeMin,
        stale,
        apiOk,
        relayOff,
        uncovered,
        notify,
    };
}

export interface HealthFacts {
    newestAgeMin: number | null;
    apiOk: boolean;
    relayOff: string[];
    uncovered: string[];
}

/**
 * The push copy. PURE and asserted by `scripts/health-selfcheck.cjs`, because
 * the copy is what the owner actually reads - and the copy is what was wrong:
 * it used to claim that order finalization and the API endpoints were offline
 * while they were running.
 */
export function healthMessage(
    kind: 'down' | 'degraded' | 'recovered' | 'healthy',
    facts: HealthFacts
): { title: string; body: string } {
    const age = facts.newestAgeMin;
    const ageText = age === null ? 'no bot heartbeat has ever been written' : `no bot heartbeat for ${age} min`;
    const caps = facts.uncovered;
    const capList = caps.join(' + ');
    const flagList = facts.relayOff.join(', ');

    if (kind === 'recovered') {
        return {
            title: 'WhatsApp bot back online',
            body:
                `WhatsApp is back - bot heartbeat ${age === null ? 'fresh' : `${age} min old`} and ` +
                `api.foodhubbie.in is answering. The rest of the platform was never affected.`,
        };
    }

    if (kind === 'degraded') {
        if (facts.apiOk) {
            return {
                title: 'WhatsApp bot degraded',
                body:
                    `api.foodhubbie.in is answering but ${ageText} - the WhatsApp worker may be stopped. ` +
                    `Customer messaging is affected; ${STILL_UP}.`,
            };
        }
        return {
            title: 'WhatsApp bot degraded',
            body:
                'The WhatsApp bot is running but api.foodhubbie.in is not answering - the control plane ' +
                `or its TLS proxy needs attention. Customer messaging is unaffected; ${STILL_UP}.`,
        };
    }

    if (kind === 'down' && caps.length) {
        return {
            title: `${capList} not running`,
            body:
                `WhatsApp is down - ${ageText} - AND ${capList} are NOT running: the cloud relay flag ` +
                `(${flagList}) is off, so the bot owned them and the bot is gone. ` +
                `Set ${flagList} to enabled:true, or bring the socket host back.`,
        };
    }

    if (kind === 'down') {
        return {
            title: 'WhatsApp bot offline',
            body:
                `WhatsApp is down - ${ageText} and api.foodhubbie.in is unreachable. ` +
                `${STILL_UP}; only WhatsApp messaging is.`,
        };
    }

    return {
        title: 'WhatsApp bot online',
        body: `WhatsApp is connected and api.foodhubbie.in is answering. ${STILL_UP}.`,
    };
}
