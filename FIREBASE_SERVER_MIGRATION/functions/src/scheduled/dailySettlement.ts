/**
 * Daily rider settlement as a scheduled Function (batch 23i).
 *
 * Ports `runDailySettlement()` out of `bot-control-api/server.js`, where it ran
 * from a `setInterval` on the EC2 box. The box has been offline since
 * 2026-11-11, so riders have not been settled for days: the admin never got the
 * "review and pay this cash" record, and the rider app never got the entry to
 * "Confirm Received".
 *
 * What the job does (unchanged): for every rider whose collected cash exceeds
 * what has already been settled, create ONE settlement record so the admin can
 * review/pay and the rider can confirm receipt. **No money moves** — it is
 * record-keeping that mirrors the rider app's "Confirm Received" flow.
 *
 * ## Enumeration: `riderIndex`, not the whole `businesses` tree
 *
 * The control API did `ref('businesses').get()` and walked every outlet and
 * every rider record — the exact egress bug class that batch 11 (a 5 MB tree
 * read per reconnect), batch 14 (orchestrator boot) and batch 15 (media) paid
 * for. Riders have been outlet-scoped since 2026-10-28 and every rider write
 * path also stamps `riderIndex/{uid} = { bid, outlet }` (`Admin/js/features/
 * riders.js`, `registerRider`), so the index IS the canonical registry and a
 * pass costs a few KB instead of the whole tree.
 *
 * ## Idempotency: the control API's own day claim
 *
 * `meta/dailySettlementLastRun` holds the UTC date string of the last pass
 * (`new Date().toISOString().slice(0,10)` — intentionally the same convention
 * the control API compares with, so the two cannot both settle a day: whichever
 * runs first stamps it and the other sees `lastRun === today` and returns).
 * The stamp is taken with a transaction BEFORE the work, matching the original
 * at-most-once semantics: a crashed pass loses that day, it cannot double-pay.
 *
 * ## Never settle the demo
 *
 * `foodhubbie-demo` is hard-skipped: the nightly reseed writes seeded riders
 * with seeded earnings and a settlement record there is noise at best.
 *
 * Schedule: `0 23 * * *` Asia/Kolkata (the control API used `23:00 server time`,
 * i.e. 04:30 IST — recorded as a deliberate deviation: the restaurant owner
 * reads the record at close of business, not at 4:30 in the morning).
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';

initializeAdmin().catch((err: Error) => {
  logger.error('[DailySettlement] Admin init failed', { error: err.message });
});

const RIDER_INDEX = 'riderIndex';
const LAST_RUN_PATH = 'meta/dailySettlementLastRun';
const SUMMARY_PATH = 'meta/dailySettlement/last';
const DEMO_BID = 'foodhubbie-demo';

/** Same shape the Admin dashboard and the old cron wrote. */
export type SettlementRecord = {
  amountCollected: number;
  ordersClearedCount: number;
  settledByAdmin: string;
  timestamp: number;
  source: string;
  riderAck: null;
};

export type SettlementSummary = {
  at: number;
  day: string;
  ran: boolean;
  riders: number;
  created: Array<{ uid: string; bid: string; oid: string; amount: number }>;
  skipped: { demo: number; badIndex: number; noRider: number; noPending: number };
};

const emptySummary = (day: string): SettlementSummary => ({
  at: Date.now(),
  day,
  ran: false,
  riders: 0,
  created: [],
  skipped: { demo: 0, badIndex: 0, noRider: 0, noPending: 0 },
});

/**
 * Take the day. `true` = this invocation owns today's pass.
 *
 * A transaction, not read-then-set: two invocations of the same job (a retry,
 * or the control API if the box ever returns) must not both settle. Returning
 * `undefined` aborts, which is how "already stamped" is expressed.
 */
async function claimDay(db: AdminDb, day: string): Promise<boolean> {
  const res = await db.ref(LAST_RUN_PATH).transaction((cur) => {
    if (cur === day) return undefined; // already ran today — abort
    return day;
  });
  return res.committed === true;
}

type AdminDb = ReturnType<typeof getDB>;

/**
 * One pass. Exported so the live E2E can run the exact deployed bytes against
 * the real database on a day override without waiting for 23:00 IST.
 */
export async function runSettlement(
  db: AdminDb = getDB(),
  dayOverride?: string
): Promise<SettlementSummary> {
  const day = dayOverride || new Date().toISOString().slice(0, 10);
  const summary = emptySummary(day);

  if (!(await claimDay(db, day))) {
    logger.info('[DailySettlement] already ran today — nothing to do', { day });
    return summary;
  }
  summary.ran = true;

  const index = ((await db.ref(RIDER_INDEX).once('value')).val() || {}) as Record<
    string,
    { bid?: string; outlet?: string }
  >;

  for (const uid of Object.keys(index).sort()) {
    const entry = index[uid] || {};
    const bid = String(entry.bid || '');
    const oid = String(entry.outlet || '');
    if (!bid || !oid) {
      summary.skipped.badIndex++;
      continue;
    }
    if (bid === DEMO_BID) {
      summary.skipped.demo++;
      continue;
    }
    const base = `businesses/${bid}/outlets/${oid}`;

    // The index can outlive the rider record (a hand-written DB edit); the
    // control API enumerated `riders` directly so it could not.
    if (!(await db.ref(`${base}/riders/${uid}`).once('value')).exists()) {
      summary.skipped.noRider++;
      continue;
    }

    summary.riders++;

    const stats = (await db.ref(`${base}/riderStats/${uid}`).once('value')).val() || {};
    const totalEarnings = Number(stats.totalEarnings) || 0;

    const settlements = ((await db.ref(`${base}/settlements/${uid}`).once('value')).val() ||
      {}) as Record<string, { amountCollected?: number }>;
    const settledTotal = Object.values(settlements).reduce(
      (sum: number, s) => sum + (Number(s && s.amountCollected) || 0),
      0
    );

    const pendingCash = Math.max(0, totalEarnings - settledTotal);
    if (pendingCash <= 0) {
      summary.skipped.noPending++;
      continue;
    }

    const record: SettlementRecord = {
      amountCollected: pendingCash,
      // Pre-existing quirk kept byte-identical: this is the rider's ALL-TIME
      // order count, not the number of orders this settlement clears. The
      // Admin manual flow writes the same field with a real count; changing it
      // here would make the two sources mean different things.
      ordersClearedCount: Number(stats.totalOrders) || 0,
      settledByAdmin: 'Auto-Settlement (Daily Cron)',
      timestamp: Date.now(),
      source: 'daily-auto-settlement',
      // Kept for source fidelity with the control API. RTDB stores no nulls, so
      // this key is absent until the rider taps "Confirm Received" — the same
      // shape every live settlement record has.
      riderAck: null,
    };
    await db.ref(`${base}/settlements/${uid}`).push(record);
    summary.created.push({ uid, bid, oid, amount: pendingCash });
    logger.info('[DailySettlement] settlement created', { uid, bid, oid, pendingCash });
  }

  summary.at = Date.now();
  await db.ref(SUMMARY_PATH).set(summary);
  return summary;
}

export const dailySettlement = onSchedule(
  {
    schedule: '0 23 * * *',
    // The restaurant closes at night IST; the old box ran its interval at
    // "23:00 server time" (UTC), which is 04:30 IST — recorded as a deviation.
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    // Two concurrent passes must never race the day claim against each other.
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async () => {
    await initializeAdmin();
    const summary = await runSettlement();
    logger.info('[DailySettlement] pass complete', summary);
  }
);
