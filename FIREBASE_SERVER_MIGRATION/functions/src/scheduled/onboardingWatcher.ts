/**
 * Website signup auto-approval + 72 h unverified cleanup (batch 23d-4).
 *
 * Ports the two background jobs that lived inside bot-control-api/server.js:
 * `startAutoApproval()` (approve fresh website sign-ups without a human) and
 * `runUnverifiedCleanup()` (delete an auto-onboarded tenant whose owner never
 * verified the admin email after 72 h).
 *
 * The control API held an RTDB `child_added` listener in a long-lived process.
 * A Cloud Function has no process between invocations, and an RTDB trigger
 * would NOT replay a request written while the function was cold or failing,
 * so this polls `status == 'pending'` every 2 minutes. A request waits at most
 * one tick, and is only read while it is still pending.
 *
 * Ported guards (same behaviour as the control API):
 *   - `source === 'website'` only;
 *   - fresh sign-ups only (`|now - createdAt| <= 15 min`) - everything older,
 *     including the backlog that queued while the box was down, stays pending
 *     for manual review;
 *   - hourly cap, default 20, over-cap requests left pending + one notification;
 *   - duplicate login email (409 `already exists`) -> `rejected` with
 *     `This login email is already registered.` (never touches the Auth user);
 *   - 422 (signup account missing/rotated) -> leave pending, retry next tick;
 *   - any other failure -> leave pending + one "needs manual review" inquiry.
 *
 * New here, because there is no process state to hold them: the cap window, an
 * in-flight claim, and the "already notified" markers live in RTDB under
 * `meta/onboardingAuto/**`. They are deliberately NOT written onto the request
 * row: `onboardingRequests/$reqId/$other` is `.validate:false`, so an extra
 * field would make every later Supreme client write (reject/approve) invalid.
 *
 * The 72 h cleanup ships in OBSERVE mode. It reports candidates and deletes
 * nothing until `meta/onboardingAuto/cleanupEnforce` is `true` (or the deploy
 * sets `ONBOARDING_CLEANUP=enforce`). Only tenants created by this watcher
 * (`reviewedBy === 'auto-onboarding'`) with no order and no payment are ever
 * candidates, and it runs at most once per 24 h (gate: `cleanupAt`).
 *
 * `enabled: false` is a TOTAL kill switch: the pass approves nothing and the
 * cleanup does not run either. Use `maxPerHour: 0` to pause only the approvals.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, getAuth } from '../shared/firebase/admin';
import { approveOnboardingRequest } from '../api/tenantOnboarding';
import { HttpError } from '../shared/http/tenant';

initializeAdmin().catch((err: Error) => {
  logger.error('[OnboardingWatcher] Admin init failed', { error: err.message });
});

const HOUR_MS = 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 24 * HOUR_MS;
const MAX_AGE_MS = 15 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const UNVERIFIED_TTL_MS = 72 * HOUR_MS;
const DEFAULT_MAX_PER_HOUR = 20;
const DEMO_BID = 'foodhubbie-demo';
const ROOT = 'meta/onboardingAuto';
const CLEANUP_ENFORCE_ENV = String(process.env.ONBOARDING_CLEANUP || '').toLowerCase() === 'enforce';

type CleanupSummary = { ran: boolean; enforce: boolean; candidates: number; deleted: number };

export type WatcherSummary = {
  at: number;
  enabled: boolean;
  cap: number;
  pending: number;
  approved: string[];
  rejected: string[];
  overCap: string[];
  skipped: number;
  failed: Array<{ key: string; error: string }>;
  cleanup: CleanupSummary | null;
};

/**
 * One Supreme-visible notification, shaped exactly like the control API's
 * `notifySupreme`: the `inquiries/$id` rule forbids extra fields
 * (`$other:false`), caps name 80 / message 2000 / store 80 and needs a phone
 * of 5-15 chars, so a bad phone becomes the placeholder the UI already knows.
 * Non-fatal: a failed notification must never fail the signup.
 */
async function pushInquiry(db: any, title: string, message: string, r: any): Promise<void> {
  try {
    const phone = String(r.contactPhone || '').trim();
    await db.ref('inquiries').push({
      name: String(title).slice(0, 80),
      phone: phone.length >= 5 && phone.length <= 15 ? phone : '0000000000',
      type: 'New restaurant signup',
      message: String(message).slice(0, 2000),
      store: String(r.outletName || '').slice(0, 80),
      source: 'website',
      createdAt: Date.now(),
    });
  } catch (e: any) {
    logger.warn('[OnboardingWatcher] inquiry write failed (non-fatal)', { error: e.message });
  }
}

/**
 * Over-cap and failure notices repeat every tick otherwise. One marker per
 * request (never removed - a handful of tiny nodes) makes them exactly once.
 */
async function notifyOnce(
  db: any,
  key: string,
  kind: 'cap' | 'failed',
  title: string,
  message: string,
  r: any
): Promise<void> {
  const marker = db.ref(`${ROOT}/notices/${key}`);
  if ((await marker.get()).exists()) return;
  await marker.set({ at: Date.now(), kind });
  await pushInquiry(db, title, message, r);
}

/**
 * Retry-safe claim: `reference.transaction` re-runs with the server value when
 * the first (local, `null`) ticket loses, so two invocations cannot both enter
 * the approval core. Released in a `finally` on every outcome; the TTL only
 * covers a crashed process.
 */
async function claimRequest(db: any, key: string, now: number): Promise<boolean> {
  const res = await db.ref(`${ROOT}/claims/${key}`).transaction((cur: any) => {
    const at = Number(cur && cur.at ? cur.at : 0);
    if (at && now - at < CLAIM_TTL_MS) return undefined; // someone else is on it
    return { at: now };
  });
  return Boolean(res && res.committed);
}

async function markRequestExpired(db: any, key: string, reason: string): Promise<void> {
  await db
    .ref(`onboardingRequests/${key}`)
    .update({ status: 'expired', expiredAt: Date.now(), expireReason: reason })
    .catch((e: any) => logger.warn('[OnboardingWatcher] mark expired failed (non-fatal)', { error: e.message }));
}

/**
 * Port of `runUnverifiedCleanup`. Observe mode still counts candidates (and
 * still marks a request expired when its tenant is already gone - that is row
 * hygiene, not a delete decision).
 */
async function runCleanup(db: any, cfg: any, now: number): Promise<CleanupSummary> {
  const enforce = CLEANUP_ENFORCE_ENV || cfg.cleanupEnforce === true;
  const last = Number(cfg.cleanupAt || 0);
  if (last && now - last < CLEANUP_EVERY_MS) return { ran: false, enforce, candidates: 0, deleted: 0 };

  const snap = await db.ref('onboardingRequests').orderByChild('status').equalTo('approved').get();
  const requests = Object.entries(snap.val() || {}) as Array<[string, any]>;
  let candidates = 0;
  let deleted = 0;

  for (const [key, r] of requests) {
    if (!r || r.reviewedBy !== 'auto-onboarding' || !r.bid || !r.oid) continue;
    if (r.bid === DEMO_BID) continue;
    const reviewedAt = Number(r.reviewedAt);
    if (!Number.isFinite(reviewedAt) || now - reviewedAt < UNVERIFIED_TTL_MS) continue;

    const base = `businesses/${r.bid}/outlets/${r.oid}`;
    const [orders, payments] = await Promise.all([
      db.ref(`${base}/orders`).limitToFirst(1).get(),
      db.ref(`walletBilling/${r.bid}/${r.oid}/payments`).limitToFirst(1).get(),
    ]);
    // Activity means a real restaurant, even if the owner forgot to verify.
    if (orders.exists() || payments.exists()) continue;

    const outlet = (await db.ref(base).get()).val();
    if (!outlet) {
      await markRequestExpired(db, key, 'Tenant already gone');
      continue;
    }

    const email = (outlet.adminLogin && outlet.adminLogin.email) || r.adminEmail;
    let user: any = null;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch (err: any) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
    if (user && user.emailVerified === true) continue; // verified - keep the tenant

    candidates++;
    if (!enforce) {
      logger.info(
        `[OnboardingWatcher] would delete ${r.bid}/${r.oid} (${email}) - unverified for ${Math.round(
          (now - reviewedAt) / HOUR_MS
        )}h (observe mode)`
      );
      continue;
    }

    if (user) {
      const row = (await db.ref(`admins/${user.uid}`).get()).val() || {};
      // Only remove the mirror while it still belongs to this tenant.
      if (row.outlet === r.oid && row.businessId === r.bid) {
        await db.ref(`admins/${user.uid}`).remove();
      }
      await getAuth().deleteUser(user.uid);
    }
    const outlets = (await db.ref(`businesses/${r.bid}/outlets`).get()).val() || {};
    if (Object.keys(outlets).length <= 1) await db.ref(`businesses/${r.bid}`).remove();
    else await db.ref(base).remove();
    await db.ref(`outletIndex/${r.oid}`).remove();
    await markRequestExpired(db, key, 'Unverified after 72h');
    deleted++;
    logger.info(`[OnboardingWatcher] deleted ${r.bid}/${r.oid} (${email}) - unverified after 72h`);
  }

  if (!enforce) {
    logger.info(
      `[OnboardingWatcher] cleanup ${candidates} candidate(s), 0 deleted (observe mode - set meta/onboardingAuto/cleanupEnforce=true to delete)`
    );
  } else {
    logger.info(`[OnboardingWatcher] cleanup ${candidates} candidate(s), ${deleted} deleted`);
  }
  await db
    .ref(`${ROOT}/cleanupAt`)
    .set(now)
    .catch((e: any) => logger.warn('[OnboardingWatcher] cleanupAt write failed (non-fatal)', { error: e.message }));
  return { ran: true, enforce, candidates, deleted };
}

/**
 * One pass. Exported so it can be run against the real database from a laptop
 * or a harness - the same code path the schedule runs, not a copy. `db` is
 * injected so the caller owns Admin init.
 *
 * There is deliberately no dry-run: an approval is a real tenant, so the only
 * safe rehearsal is `meta/onboardingAuto/enabled:false` (nothing is approved)
 * plus the cleanup's observe mode.
 */
export async function runOnboardingWatcher(
  db: any,
  opts: { now?: number } = {}
): Promise<WatcherSummary> {
  const now = opts.now || Date.now();
  const cfg = (await db.ref(ROOT).get()).val() || {};
  const enabled = cfg.enabled !== false;
  const rawCap = Number(cfg.maxPerHour);
  const cap = Number.isFinite(rawCap) ? Math.max(0, Math.floor(rawCap)) : DEFAULT_MAX_PER_HOUR;

  const summary: WatcherSummary = {
    at: now,
    enabled,
    cap,
    pending: 0,
    approved: [],
    rejected: [],
    overCap: [],
    skipped: 0,
    failed: [],
    cleanup: null,
  };

  // Rolling hour window, exactly like the control API's in-process array.
  const recent: number[] = (Array.isArray(cfg.recent) ? cfg.recent : [])
    .map((t: any) => Number(t))
    .filter((t: number) => Number.isFinite(t) && now - t < HOUR_MS);

  const pendingSnap = await db.ref('onboardingRequests').orderByChild('status').equalTo('pending').get();
  const pending = Object.entries(pendingSnap.val() || {}) as Array<[string, any]>;
  summary.pending = pending.length;

  if (!enabled) {
    summary.skipped = pending.length;
  } else {
    pending.sort((a, b) => Number(a[1] && a[1].createdAt ? a[1].createdAt : 0) - Number(b[1] && b[1].createdAt ? b[1].createdAt : 0));

    for (const [key, r] of pending) {
      if (!r || r.status !== 'pending' || r.source !== 'website') {
        summary.skipped++;
        continue;
      }
      if (Math.abs(now - Number(r.createdAt || 0)) > MAX_AGE_MS) {
        logger.info(`[OnboardingWatcher] ${key} is not a fresh sign-up; left pending for manual review`);
        summary.skipped++;
        continue;
      }
      if (recent.length >= cap) {
        summary.overCap.push(key);
        await notifyOnce(
          db,
          key,
          'cap',
          'Signup needs manual review',
          `Auto-approval hourly cap (${cap}) reached. ${r.businessName} (${r.adminEmail}) is waiting in Onboarding.`,
          r
        );
        continue;
      }
      if (!(await claimRequest(db, key, now))) {
        summary.skipped++;
        continue;
      }

      try {
        const out = await approveOnboardingRequest(key, r, 'auto-onboarding');
        summary.approved.push(key);
        recent.push(Date.now());
        await db
          .ref(`${ROOT}/recent`)
          .set(recent)
          .catch((e: any) => logger.warn('[OnboardingWatcher] cap window write failed (non-fatal)', { error: e.message }));
        await pushInquiry(
          db,
          `New restaurant: ${r.businessName}`,
          `${r.outletName} signed up (${r.adminEmail}) and was created automatically. It is locked until its first wallet top-up (min ₹1,000) is recorded.`,
          r
        );
        logger.info(`[OnboardingWatcher] approved ${key} -> ${out.bid}/${out.oid}`);
      } catch (err: any) {
        const status = err instanceof HttpError ? err.status : 0;
        if (status === 409 && /already exists/.test(String(err.message))) {
          // The login email already owns another account - never adopt it.
          summary.rejected.push(key);
          await db
            .ref(`onboardingRequests/${key}`)
            .update({
              status: 'rejected',
              rejectReason: 'This login email is already registered.',
              reviewedAt: Date.now(),
              reviewedBy: 'auto-onboarding',
            })
            .catch((e: any) => logger.warn('[OnboardingWatcher] reject write failed (non-fatal)', { error: e.message }));
        } else if (status === 422) {
          // Signup account missing/rotated: retry next tick, and leave it in
          // the Pending list for a human once it ages out of the window.
          summary.failed.push({ key, error: err.message });
          logger.warn(`[OnboardingWatcher] ${key} left pending (retry): ${err.message}`);
        } else if (status === 409) {
          // A human (or an earlier tick) already terminalised it.
          summary.skipped++;
        } else {
          summary.failed.push({ key, error: err.message });
          logger.error(`[OnboardingWatcher] ${key} left pending: ${err.message}`);
          await notifyOnce(
            db,
            key,
            'failed',
            'Signup needs manual review',
            `${r.businessName} (${r.adminEmail}) could not be auto-approved: ${err.message}`,
            r
          );
        }
      } finally {
        await db.ref(`${ROOT}/claims/${key}`).remove().catch(() => undefined);
      }
    }
  }

  summary.cleanup = enabled
    ? await runCleanup(db, cfg, now)
    : {
        // The kill switch is total: while `enabled` is false the pass approves
        // nothing AND deletes nothing. `maxPerHour: 0` is the knob that pauses
        // only the approvals.
        ran: false,
        enforce: CLEANUP_ENFORCE_ENV || cfg.cleanupEnforce === true,
        candidates: 0,
        deleted: 0,
      };
  await db
    .ref(`${ROOT}/lastRun`)
    .set(summary)
    .catch((e: any) => logger.warn('[OnboardingWatcher] lastRun write failed (non-fatal)', { error: e.message }));
  logger.info('[OnboardingWatcher] pass', {
    pending: summary.pending,
    approved: summary.approved.length,
    rejected: summary.rejected.length,
    overCap: summary.overCap.length,
    failed: summary.failed.length,
    cleanup: summary.cleanup,
  });
  return summary;
}

export const onboardingWatcher = onSchedule(
  {
    // Every 2 min: the worst-case approval delay is one tick, and a pending
    // request is re-read only until it leaves `pending`. maxInstances 1 keeps
    // the cap window single-writer (the claim transaction is the belt anyway).
    schedule: '*/2 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async () => {
    try {
      await initializeAdmin();
      const summary = await runOnboardingWatcher(getDB());
      logger.info('[OnboardingWatcher] done', {
        approved: summary.approved.length,
        rejected: summary.rejected.length,
        overCap: summary.overCap.length,
        cleanup: summary.cleanup,
      });
    } catch (err: any) {
      logger.error('[OnboardingWatcher] pass failed', { error: err && err.message });
      throw err;
    }
  }
);
