/**
 * Platform health decision table (batch 23a) - PURE, no Firebase imports.
 *
 * The 2026-11-11 outage was invisible for 13 hours because nothing watched the
 * box from outside it: `botStatus` stopped being written and only a human
 * noticed. This module turns the two independent signals into one verdict:
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
 */

export type HealthState = 'healthy' | 'degraded' | 'down';

export interface OutletBeat {
    bid: string;
    oid: string;
    /** last `botStatus.status` (`online` / `offline` / `unknown`), informational */
    status: string;
    /** last `botStatus.updatedAt` in ms, or null when never written */
    updatedAt: number | null;
}

export interface PreviousHealth {
    state: HealthState;
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
    notify: null | { kind: 'down' | 'degraded' | 'recovered'; repeat: boolean };
}

/**
 * The control API writes one outlet at a time, 30 s per full pass, so 5 minutes
 * is ten missed passes - long enough to ignore a deploy restart, short enough
 * that the 13-hour blind spot cannot happen again.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** While still broken, re-notify at most once an hour (phone-friendly). */
export const REPEAT_NOTIFY_MS = 60 * 60 * 1000;

function ageMinutes(now: number, ts: number | null): number | null {
    if (!ts || !Number.isFinite(ts)) return null;
    return Math.max(0, Math.round((now - ts) / 60000));
}

export function evaluateHealth(input: {
    now: number;
    outlets: OutletBeat[];
    apiOk: boolean;
    previous: PreviousHealth | null;
}): HealthReport {
    const { now, outlets, apiOk, previous } = input;

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

    let state: HealthState;
    if (!hostOk && !apiOk) state = 'down';
    else if (!hostOk || !apiOk) state = 'degraded';
    else state = 'healthy';

    const since = previous && previous.state === state ? previous.since : now;
    const lastNotifiedAt = (previous && previous.lastNotifiedAt) || 0;

    let notify: HealthReport['notify'] = null;
    if (state === 'healthy') {
        // Only a transition matters; a healthy platform never nags.
        if (previous && previous.state !== 'healthy') notify = { kind: 'recovered', repeat: false };
    } else if (!previous || previous.state !== state) {
        notify = { kind: state, repeat: false };
    } else if (now - lastNotifiedAt >= REPEAT_NOTIFY_MS) {
        notify = { kind: state, repeat: true };
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
        notify,
    };
}
