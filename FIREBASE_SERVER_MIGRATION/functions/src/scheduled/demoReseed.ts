/**
 * Nightly demo reseed as a scheduled Function (batch 23j).
 *
 * The public demo (`https://foodhubbie-admins.web.app/demo`) is the real Admin
 * dashboard signed in as the demo tenant, so it must never go stale or show a
 * broken wallet. That was a cron job on the EC2 box (`/home/ubuntu/demo-seed/`,
 * `30 21 * * *` UTC = 03:00 IST) — and the box has been offline since
 * 2026-11-11, so the demo has been frozen in time ever since.
 *
 * It was ALSO broken independently of the box: the seeder read its fixtures from
 * `Admin/js/demo/demo-data.js`, a file the KDS review (`afd9e11`) deleted as an
 * orphan, so every run died with ENOENT. Batch 23j fixes the root cause instead
 * of restoring a dead file: the static content lives in `tools/demo-fixtures.cjs`
 * and everything that BUILDS the tenant is `tools/demo-seed-core.cjs`, vendored
 * into this bundle so the CLI and this function run the same bytes.
 *
 * ## What it writes (and what it must never write)
 *
 *   1. the demo Auth user (create once, then keep password/display name in sync)
 *   2. `businesses/foodhubbie-demo`            — everything except `orders` in one `set`, then orders in chunks (trigger budget)
 *   3. `walletBilling/foodhubbie-demo/demo`    — money lives at the server-only root
 *   4. `admins/{uid}`                          — the demo admin mirror (`isDemo`)
 *   5. `outletIndex/demo`                      — REMOVED, always
 *   6. `meta/demoReseed/last`                  — the run summary
 *
 * `outletIndex/demo` must not exist: it is the QR/menu resolver, so a seeded
 * entry would let a real customer order from the public sandbox. And the demo
 * outlet must never carry a `whatsapp` node — `bot-control-api` spawns a worker
 * for any outlet that has one. Neither is written by the builder; both are
 * asserted here and guarded by `tests/demo-reseed.check.cjs`.
 *
 * ## Idempotency: a 20 h claim on `meta/demoReseed/last.at`
 *
 * Taken with a transaction BEFORE the work, like the rider settlement's day
 * claim, so two invocations cannot both reseed. Two differences:
 *
 *   - The window is 20 h (`< 24 h`) so a manual re-run the next morning is
 *     still possible, but a retry/duplicate a few minutes later is not.
 *   - The claim is a timestamp, not a day string, so it also throttles a
 *     `jobs:run` fired by hand.
 *
 * Unlike 23e–23h there is no bot counterpart to hand ownership to, so no
 * feature flag exists: this job only touches the demo tenant, and the box's own
 * cron copy is broken at HEAD (it reads the deleted `demo-data.js`), which is
 * why nothing double-seeds while the box is down. If the box ever returns, its
 * `demo-seed/` copy must be removed — recorded in the batch doc.
 *
 * Schedule: `0 3 * * *` Asia/Kolkata — the same wall clock as the box cron, and
 * the quietest hour for the demo (a visitor at 03:00 IST is a crawler).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, getAuth } from '../shared/firebase/admin';
import {
  buildDemoTenant,
  demoDbUrl,
  DEMO_BID,
  DEMO_OID,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_NAME,
} from '../shared/demo/factory';
import type { DemoSeedStats } from '../shared/demo/factory';

initializeAdmin().catch((err: Error) => {
  logger.error('[DemoReseed] Admin init failed', { error: err.message });
});

/** The claim + the summary live in the same node: `at` is the claim. */
const CLAIM_PATH = 'meta/demoReseed/last';
/** 20 h, not 24 h: a daily schedule always clears it, a retry never does. */
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * RTDB refuses a write that would trigger more than **500 Cloud Functions v2 in
 * one region**. Every seeded order fans out to ~10 of ours: 3 `created` handlers
 * on the order node (push relay admin, order finalizer, shadow) and 5 `written`
 * handlers on `status` (push customer, cancel compensation, loyalty status,
 * rider status, legacy status-change) plus `paymentStatus` and `riderId`. A
 * whole-tenant `set()` of 353 orders is therefore ~3,500 events and the database
 * rejected it with `TOO_MANY_TRIGGERS` on the very first live run.
 *
 * **Deleting counts too.** Omitting `orders` from the parent `set()` does not
 * avoid the fan-out: RTDB fires the `status` triggers with `after = null` for
 * every removed order, so the second live run was rejected the same way. Both
 * directions must be chunked.
 *
 * So one pass is three phases, every `orders` write bounded by this constant:
 * chunk-delete yesterday's orders, one atomic `set` for everything else, then
 * chunk-create the new orders. 25 x ~10 = ~250 events, half the cap, which
 * leaves room for two more triggers on the order node before this needs tuning.
 */
const ORDERS_PER_WRITE = 25;

/**
 * Replace the tenant. `orders` is the only section with a trigger fan-out, so
 * both removing the old ones and writing the new ones happens in chunks while
 * the rest of the tenant is replaced atomically.
 */
async function writeTenant(
  db: ReturnType<typeof getDB>,
  business: Record<string, any>
): Promise<{ orders: number; orderWrites: number }> {
  const outlet: Record<string, any> = { ...((business.outlets || {})[DEMO_OID] || {}) };
  const orderMap: Record<string, any> = outlet.orders || {};
  delete outlet.orders;

  const ordersRef = db.ref(`businesses/${DEMO_BID}/outlets/${DEMO_OID}/orders`);

  // 1. Remove yesterday's orders in chunks — a bulk delete fans out exactly like
  //    a bulk write, so it must not ride along on the parent `set` below.
  const existing = Object.keys((await ordersRef.once('value')).val() || {});
  for (let i = 0; i < existing.length; i += ORDERS_PER_WRITE) {
    const patch: Record<string, null> = {};
    for (const key of existing.slice(i, i + ORDERS_PER_WRITE)) patch[key] = null;
    await ordersRef.update(patch);
  }

  // 2. Everything else, atomically. `orders` is already empty, so this deletes
  //    nothing under it and the only events are the 8 customer `loyalty` writes.
  await db
    .ref(`businesses/${DEMO_BID}`)
    .set({ ...business, outlets: { ...business.outlets, [DEMO_OID]: outlet } });

  // 3. The new orders, in chunks.
  const keys = Object.keys(orderMap);
  for (let i = 0; i < keys.length; i += ORDERS_PER_WRITE) {
    const patch: Record<string, any> = {};
    for (const key of keys.slice(i, i + ORDERS_PER_WRITE)) patch[key] = orderMap[key];
    await ordersRef.update(patch);
  }
  return { orders: keys.length, orderWrites: Math.ceil(keys.length / ORDERS_PER_WRITE) };
}

export interface DemoReseedSummary {
  at: number;
  ran: boolean;
  /** Why this invocation did nothing (`recent`), when it did nothing. */
  reason?: string;
  day?: string;
  uid?: string;
  authUser?: 'created' | 'updated';
  ms?: number;
  stats?: DemoSeedStats;
  /** How many chunked writes the order fan-out was split into (§ the cap). */
  orderWrites?: number;
  /** Set when the run threw; the demo keeps yesterday's data in that case. */
  error?: string;
}

/**
 * Take the pass. A transaction, not read-then-set, so a retry cannot win twice.
 *
 * RTDB hands the callback a cold `null` on the first (local) pass even for an
 * existing node, then re-runs it with the server value on a CAS mismatch — so
 * this callback must return the claim for `null` and only abort when the
 * SERVER value is recent. Returning `undefined` on the cold pass would abort
 * the whole transaction without ever consulting the database.
 */
async function claimPass(db: ReturnType<typeof getDB>, now: number): Promise<boolean> {
  const res = await db.ref(CLAIM_PATH).transaction((cur) => {
    const at = cur && typeof cur === 'object' ? Number(cur.at) || 0 : 0;
    if (at && now - at < MIN_INTERVAL_MS) return undefined; // already seeded recently
    return { at, by: 'cloud', state: 'running', startedAt: now };
  });
  return res.committed === true;
}

/** Create the demo owner once, then keep it usable (password, name, verified). */
async function ensureDemoUser(now: number): Promise<{ uid: string; authUser: 'created' | 'updated' }> {
  const auth = getAuth();
  try {
    const user = await auth.getUserByEmail(DEMO_EMAIL);
    await auth.updateUser(user.uid, {
      password: DEMO_PASSWORD,
      displayName: DEMO_NAME,
      emailVerified: true,
      disabled: false,
    });
    return { uid: user.uid, authUser: 'updated' };
  } catch (e: any) {
    if (e && e.code !== 'auth/user-not-found') throw e;
    const user = await auth.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      displayName: DEMO_NAME,
      emailVerified: true,
    });
    logger.info('[DemoReseed] demo Auth user created', { uid: user.uid, at: now });
    return { uid: user.uid, authUser: 'created' };
  }
}

/**
 * One pass. Exported so the live E2E runs the exact deployed bytes against the
 * real database (the scheduled wrapper adds nothing but the logger).
 */
export async function runDemoReseed(
  db: ReturnType<typeof getDB> = getDB(),
  now: number = Date.now()
): Promise<DemoReseedSummary> {
  const started = Date.now();

  if (!(await claimPass(db, now))) {
    logger.info('[DemoReseed] seeded < 20 h ago — nothing to do');
    return { at: now, ran: false, reason: 'recent' };
  }

  try {
    const { business, billing, stats } = await buildDemoTenant({ now, dbUrl: demoDbUrl() });
    logger.info('[DemoReseed] tenant built', { ...stats });

    const { uid, authUser } = await ensureDemoUser(now);

    // Whole-node replace: the demo tenant has no live writers by design.
    // `orders` is written in chunks so the trigger fan-out stays under the
    // 500-events-per-write cap (see ORDERS_PER_WRITE).
    const { orders: writtenOrders, orderWrites } = await writeTenant(db, business);
    if (writtenOrders !== stats.orders) {
      throw new Error(`demoReseed: wrote ${writtenOrders} orders, built ${stats.orders}`);
    }
    // Money lives at the ROOT (server-owned) — never inside the tenant subtree.
    await db.ref(`walletBilling/${DEMO_BID}/${DEMO_OID}`).set(billing);
    await db.ref(`admins/${uid}`).set({
      uid,
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      displayName: DEMO_NAME,
      role: 'Admin',
      outlet: DEMO_OID,
      businessId: DEMO_BID,
      isDemo: true,
      isActive: true,
      fcmToken: '',
      createdAt: now,
    });
    // The demo outlet must never be resolvable from a QR/menu link.
    await db.ref(`outletIndex/${DEMO_OID}`).remove();

    const summary: DemoReseedSummary = {
      at: Date.now(),
      ran: true,
      day: new Date(now).toISOString().slice(0, 10),
      uid,
      authUser,
      ms: Date.now() - started,
      stats,
      orderWrites,
    };
    await db.ref(CLAIM_PATH).set(summary);
    logger.info('[DemoReseed] pass complete', {
      uid,
      orders: stats.orders,
      orderWrites,
      payloadKB: Math.round(stats.payloadBytes / 1024),
      ms: summary.ms,
    });
    return summary;
  } catch (err: any) {
    const message = String((err && (err.message || err)) || 'unknown error').slice(0, 500);
    logger.error('[DemoReseed] pass failed', { error: message });
    // Keep the claim (a failure must not become a retry loop) but leave a
    // readable record so support can see WHY the demo is stale.
    await db
      .ref(CLAIM_PATH)
      .set({ at: Date.now(), ran: false, reason: 'error', error: message, day: new Date(now).toISOString().slice(0, 10) })
      .catch(() => undefined);
    throw err;
  }
}

export const demoReseed = onSchedule(
  {
    schedule: '0 3 * * *',
    // Same wall clock as the box cron (`30 21 * * *` UTC), for the demo's
    // quietest hour.
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 300,
    // Two concurrent passes must never race the claim against each other.
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async () => {
    await initializeAdmin();
    const summary = await runDemoReseed();
    logger.info('[DemoReseed] scheduled pass done', {
      ran: summary.ran,
      reason: summary.reason,
    });
  }
);
