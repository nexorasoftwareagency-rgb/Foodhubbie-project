/**
 * Platform health watch (batch 23a) - scheduled every 5 minutes.
 *
 * Runs OUTSIDE the EC2 box on purpose: the 2026-11-11 outage lasted 13 hours
 * because every signal we had was written by the host that died. This function
 * reads those signals from managed infrastructure, writes a single
 * `platformHealth/state` node, and pushes the platform super admins only when
 * the verdict changes (plus one nudge per hour while it stays broken).
 *
 * Signals (see `shared/health/evaluate.ts`):
 *   - newest `botStatus.updatedAt` across every outlet in `outletIndex`
 *     (bot-control-api rewrites it every 30 s per outlet);
 *   - `GET https://api.foodhubbie.in/api/bot/status-all` must answer 401.
 *
 * Cost: 288 invocations/day, ~66 tiny RTDB leaf reads per pass - far inside the
 * free tier. It never reads the `businesses` tree (batch-10 lesson).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, getMessaging } from '../shared/firebase/admin';
import {
    evaluateHealth,
    STALE_AFTER_MS,
    type HealthState,
    type OutletBeat,
    type PreviousHealth,
} from '../shared/health/evaluate';

const https = require('https');

initializeAdmin().catch((err: Error) => {
    logger.error('[PlatformHealth] Admin init failed', { error: err.message });
});

const API_URL = 'https://api.foodhubbie.in/api/bot/status-all';
const API_TIMEOUT_MS = 8000;
const ADMIN_APP = 'https://foodhubbie-admins.web.app/';
const DEAD_TOKEN_CODES = [
    'messaging/registration-token-not-registered',
    'messaging/mismatched-credential',
    'messaging/third-party-auth-error',
];

/** true when the API answers 401 (alive and token-gated). */
function probeApi(): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
            if (settled) return;
            settled = true;
            resolve(v);
        };
        const req = https.get(API_URL, (res: any) => {
            res.resume();
            done(res.statusCode === 401);
        });
        req.setTimeout(API_TIMEOUT_MS, () => {
            req.destroy();
            done(false);
        });
        req.on('error', () => done(false));
    });
}

/** Two leaf reads per outlet; never the whole `botStatus` node (it carries history). */
async function readBeats(db: any): Promise<OutletBeat[]> {
    const index = (await db.ref('outletIndex').once('value')).val() || {};
    const entries = Object.entries(index).filter(([, meta]: [string, any]) => meta && meta.bid);
    return Promise.all(
        entries.map(async ([oid, meta]: [string, any]) => {
            const base = `businesses/${meta.bid}/outlets/${oid}/botStatus`;
            const [updatedAt, status] = await Promise.all([
                db.ref(`${base}/updatedAt`).once('value'),
                db.ref(`${base}/status`).once('value'),
            ]);
            const ts = Number(updatedAt.val());
            return {
                bid: String(meta.bid),
                oid: String(oid),
                status: String(status.val() || ''),
                updatedAt: Number.isFinite(ts) && ts > 0 ? ts : null,
            };
        })
    );
}

function bodyFor(kind: 'down' | 'degraded' | 'recovered', report: any): string {
    const mins = report.newestAgeMin;
    if (kind === 'recovered') {
        return mins === null
            ? 'The platform is writing heartbeats again.'
            : `Heartbeats are back (${mins} min old). Order finalization and api.foodhubbie.in are online.`;
    }
    if (kind === 'down') {
        return mins === null
            ? 'No platform heartbeat at all and api.foodhubbie.in is unreachable.'
            : `No heartbeat for ${mins} min and api.foodhubbie.in is unreachable. Bots, order finalization and API endpoints are offline.`;
    }
    return mins !== null && mins > 5
        ? `Heartbeat is ${mins} min old - the box may have stopped writing.`
        : 'api.foodhubbie.in is not answering, but the heartbeat is fresh.';
}

async function notifySupers(db: any, kind: 'down' | 'degraded' | 'recovered', state: HealthState, report: any, repeat: boolean) {
    const admins = (await db.ref('admins').once('value')).val() || {};
    const targets = Object.entries(admins)
        .filter(([, a]: [string, any]) => a && a.isSuper === true && typeof a.fcmToken === 'string' && a.fcmToken.length > 20)
        .filter(([, a]: [string, any]) => !a.fcmTokenInvalidAt || Date.now() - Number(a.fcmTokenInvalidAt) > 24 * 3600 * 1000)
        .map(([uid, a]: [string, any]) => ({ uid, token: a.fcmToken as string }));

    const record: any = {
        at: Date.now(),
        kind,
        repeat: !!repeat,
        state,
        tokens: targets.length,
        sent: 0,
        failed: 0,
    };

    if (!targets.length) {
        logger.warn('[PlatformHealth] No super-admin FCM token - state written, nothing pushed');
        await db.ref('platformHealth/lastNotification').set(record);
        return record;
    }

    const title = state === 'healthy' ? 'Platform back online' : state === 'down' ? 'PLATFORM DOWN' : 'Platform degraded';
    const body = bodyFor(kind, report);

    try {
        const res = await getMessaging().sendEachForMulticast({
            tokens: targets.map((t) => t.token),
            notification: { title, body },
            data: { type: 'platform-health', state, link: ADMIN_APP },
            webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: ADMIN_APP } },
        });
        record.sent = res.successCount;
        record.failed = res.failureCount;
        record.errors = [];
        for (let i = 0; i < res.responses.length; i++) {
            const r: any = res.responses[i];
            if (r.success) continue;
            const code = (r.error && r.error.code) || 'unknown';
            record.errors.push({ uid: targets[i].uid, code });
            if (DEAD_TOKEN_CODES.includes(code)) {
                await db.ref(`admins/${targets[i].uid}/fcmTokenInvalidAt`).set(Date.now()).catch(() => undefined);
            }
        }
    } catch (err: any) {
        record.failed = targets.length;
        record.errors = [{ code: 'send-failed', message: err && err.message }];
        logger.error('[PlatformHealth] FCM send failed', { error: err && err.message });
    }

    await db.ref('platformHealth/lastNotification').set(record);
    await db.ref('platformHealth/state/lastNotifiedAt').set(record.at);
    logger.info('[PlatformHealth] Notified', record);
    return record;
}

/**
 * One pass. Exported so it can be run from a laptop against the real database
 * (`BOT_SA=... node scripts/health-live.cjs --dry-run`) before the schedule is
 * live - the same code path, not a copy.
 */
export async function runPlatformHealthPass(
    db: any,
    opts: { now?: number; dryRun?: boolean } = {}
): Promise<{ report: ReturnType<typeof evaluateHealth>; notification: any | null }> {
    const now = opts.now || Date.now();
    const [outlets, apiOk, previousSnap] = await Promise.all([
        readBeats(db),
        probeApi(),
        db.ref('platformHealth/state').once('value'),
    ]);
    const prevVal = previousSnap.val() || null;
    const previous: PreviousHealth | null =
        prevVal && prevVal.state
            ? {
                  state: prevVal.state,
                  since: Number(prevVal.since) || now,
                  lastNotifiedAt: Number(prevVal.lastNotifiedAt) || 0,
              }
            : null;

    const report = evaluateHealth({ now, outlets, apiOk, previous });
    let notification = null;

    if (!opts.dryRun) {
        await db.ref('platformHealth/state').update({
            state: report.state,
            since: report.since,
            checkedAt: now,
            total: report.total,
            newestHeartbeatAt: report.newestHeartbeatAt,
            newestAgeMin: report.newestAgeMin,
            staleCount: report.stale.length,
            staleOutlets: report.stale,
            apiOk: report.apiOk,
            reasons: report.reasons.join(' | '),
            staleAfterMs: STALE_AFTER_MS,
        });
        if (report.notify) {
            notification = await notifySupers(db, report.notify.kind, report.state, report, report.notify.repeat);
        }
    }

    logger.info('[PlatformHealth] pass', {
        state: report.state,
        total: report.total,
        newestAgeMin: report.newestAgeMin,
        apiOk: report.apiOk,
        notify: report.notify,
        dryRun: !!opts.dryRun,
    });

    return { report, notification };
}

export const platformHealth = onSchedule(
    {
        schedule: 'every 5 minutes',
        timeZone: 'Asia/Kolkata',
        region: 'us-central1',
        memory: '256MiB',
        timeoutSeconds: 60,
        secrets: ['FIREBASE_DATABASE_URL'],
    },
    async () => {
        try {
            await runPlatformHealthPass(getDB());
        } catch (err: any) {
            logger.error('[PlatformHealth] pass failed', { error: err && err.message });
            throw err;
        }
    }
);
