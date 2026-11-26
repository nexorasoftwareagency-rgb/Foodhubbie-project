/**
 * promotionSweep — onSchedule('* * * * *') (batch 23q: campaigns leave the socket)
 *
 * The per-minute dispatcher. It reads ONE small node — the dispatch index
 * `meta/promotionsActive` — and runs at most one bounded slice per entry.
 *
 * ## Why an index instead of a query
 *
 * The obvious implementation queries every outlet's `bot/promotions/campaigns`
 * for `status == 'running'` once a minute. At 50 outlets that is 50 indexed
 * queries per minute, ~14 MB/day of pure framing before a single campaign runs
 * (batch 14 measured 34 `.get()`s = 6.5 KB of payload billed as 29 KB), and it
 * would still miss a `scheduled` campaign that just became due. The index is
 * written only when a campaign's STATUS changes (3-5 times per campaign, see
 * `promotionRelay.ts`) and is empty when nothing is running, so an idle
 * platform costs ~0 bytes per tick.
 *
 * ## What this file does NOT do
 *
 *   - It does not lease. `runSlice()` takes the real per-outlet serialiser at
 *     `bot/promotions/lease` (90 s TTL, renewed before every send) inside the
 *     engine. A second lock here would be a second source of truth and could
 *     only ever disagree with the one that protects the sends.
 *   - It does not send. Every rule (kill switch, prepaid tokens, opt-out,
 *     consent, freeze, quiet hours, warm-up ladder, pacing, circuit breaker)
 *     lives in `bot/promotions-engine.js`, copied byte-for-byte into the
 *     bundle, so the bot and the cloud cannot drift.
 *   - It does not delete a campaign. `runSlice` owns every status transition.
 *
 * ## Budget
 *
 * An event-driven Function dies at 540 s, so a campaign is sliced: the engine
 * stops starting a send it cannot finish inside `budgetMs`. One entry gets the
 * whole configured budget; several due entries share the remaining wall clock
 * evenly, and anything left over waits for the next tick (the index entry
 * persists, so nothing is lost). The 60-120 s batch pause becomes the
 * inter-slice gap: it costs zero function time.
 *
 * ## Daily housekeeping
 *
 * `expireOldPromoLogs()` reads the whole `bot/promotions/logs` node once per
 * outlet, so it runs behind a 24 h claim (`meta/promotionsSweep/lastExpiryAt`)
 * — never per minute. The claim is taken by a SEEDED transaction: an admin-SDK
 * transaction hands the first attempt `null` even for an existing node
 * (proven live in batch 23g), so `cur` alone would claim on every tick.
 *
 * Config flag: `config/promotionsRelay/enabled === true` (absent = no-op, the
 * bot keeps campaigns). `sliceBudgetMs` / `batchSize` are ops knobs and are
 * clamped by the engine (30 000-480 000 / 1-30). Demo tenant hard-skipped.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getDB, initializeAdmin } from '../shared/firebase/admin';
import { makePromotionEngine } from '../shared/promotions/factory';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/promotionsRelay';
const INDEX_ROOT = 'meta/promotionsActive';
const SWEEP_ROOT = 'meta/promotionsSweep';

/** 30-day log/campaign TTL is housekeeping: once a day is plenty. */
const EXPIRY_EVERY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SLICE_BUDGET_MS = 480_000;
const DEFAULT_BATCH_SIZE = 30;
/**
 * The function is allowed 540 s. Everything except the last slice must fit in
 * the remainder: boot, the index read, the daily expiry pass and the summary
 * writes. 460 s leaves ~80 s of headroom for a slow database.
 */
const WORK_DEADLINE_MS = 460_000;
/** `runSlice` clamps to this floor, so never allocate below it. */
const MIN_SLICE_MS = 30_000;

/** A status the sweep must stop dispatching for. `paused` is the owner's to act on. */
const DROP_STATUSES = ['done', 'stopped', 'aborted', 'expired', 'paused', 'skipped'];

interface ActiveEntry {
  bid: string;
  oid: string;
  campaignId: string;
}

function clampInt(v: any, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export const promotionSweep = onSchedule(
  {
    schedule: '* * * * *',
    // A per-minute schedule is timezone-independent; Asia/Kolkata matches the
    // rest of the platform's jobs so every log line reads in IST.
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
    // Two concurrent passes must never race the same campaign's lease.
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async () => {
    const startedAt = Date.now();
    await initializeAdmin();
    const db = getDB();

    // One flag read for the whole tick. Unreadable means "stay off": the bot
    // still owns campaigns, and a failed read must never look like consent.
    let budgetMs = DEFAULT_SLICE_BUDGET_MS;
    let batchSize = DEFAULT_BATCH_SIZE;
    try {
      const flagSnap = await db.ref(RELAY_FLAG).once('value');
      const flag = (flagSnap && flagSnap.val()) || {};
      const armed = flag.enabled === true;
      if (!armed) return;
      budgetMs = clampInt(flag.sliceBudgetMs, MIN_SLICE_MS, DEFAULT_SLICE_BUDGET_MS, DEFAULT_SLICE_BUDGET_MS);
      batchSize = clampInt(flag.batchSize, 1, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE);
    } catch {
      return;
    }

    const remaining = () => WORK_DEADLINE_MS - (Date.now() - startedAt);

    let entries: ActiveEntry[] = [];
    try {
      const indexSnap = await db.ref(INDEX_ROOT).once('value');
      const raw = (indexSnap && indexSnap.val()) || {};
      for (const [bid, outlets] of Object.entries(raw as any)) {
        if (!outlets || typeof outlets !== 'object') continue;
        for (const [oid, campaigns] of Object.entries(outlets as any)) {
          if (!campaigns || typeof campaigns !== 'object') continue;
          for (const campaignId of Object.keys(campaigns as any)) {
            entries.push({ bid, oid, campaignId });
          }
        }
      }
    } catch {
      // The index is unreadable: nothing to dispatch. The daily expiry below
      // still runs, and the next tick retries.
      entries = [];
    }

    let ran = 0;
    let dropped = 0;
    let errors = 0;
    let sent = 0;
    let paused = 0;
    let waiting = 0;

    // One engine per tenant per tick: building it re-reads `whatsapp` and the
    // store copy, so a tenant with two due campaigns must not pay twice.
    const engines = new Map<string, Promise<any>>();
    const engineFor = (bid: string, oid: string) => {
      const key = `${bid}/${oid}`;
      let p = engines.get(key);
      if (!p) {
        p = makePromotionEngine(bid, oid, { log: (...a: any[]) => console.log(...a) });
        engines.set(key, p);
      }
      return p;
    };

    for (let i = 0; i < entries.length; i++) {
      const left = remaining();
      // Below the engine's floor there is no honest slice to start. The entry
      // stays in the index and the next tick picks it up.
      if (left < MIN_SLICE_MS) break;

      const { bid, oid, campaignId } = entries[i];
      if (bid === DEMO_BUSINESS_ID) continue;

      // Share what is left between the entries still to run, capped by the
      // configured budget.
      const share = Math.floor(left / (entries.length - i));
      const sliceBudget = Math.max(MIN_SLICE_MS, Math.min(budgetMs, share));

      try {
        const handle = await engineFor(bid, oid);
        const result = await handle.engine.runSlice({ campaignId }, { budgetMs: sliceBudget, batchSize });
        ran++;
        sent += Number(result && result.sent) || 0;
        if (result && result.status === 'paused') paused++;
        if (result && result.status === 'waiting') waiting++;
        if (result && DROP_STATUSES.includes(String(result.status))) {
          await db.ref(`${INDEX_ROOT}/${bid}/${oid}/${campaignId}`).remove().catch(() => {});
          dropped++;
        }
      } catch (e: any) {
        errors++;
        console.error(`[PROMO-SWEEP] ${bid}/${oid}/${campaignId} failed: ${(e && e.message) || e}`);
      }
    }

    // ---- daily housekeeping ------------------------------------------------
    let swept = 0;
    try {
      swept = await runDailyExpiry(db, Date.now());
    } catch (e: any) {
      console.error(`[PROMO-SWEEP] expiry failed: ${(e && e.message) || e}`);
    }

    // A quiet tick writes no logs: 1,440 lines/day of "nothing to do" is noise
    // that hides the ticks that matter.
    if (entries.length || swept || errors) {
      console.log(
        `[PROMO-SWEEP] entries=${entries.length} ran=${ran} sent=${sent} paused=${paused} ` +
          `waiting=${waiting} dropped=${dropped} errors=${errors} expiryOutlets=${swept}`,
      );
    }
  },
);

/**
 * The 30-day sweep, at most once a day. Returns how many outlets were swept so
 * the summary line can say whether it actually ran.
 */
async function runDailyExpiry(db: any, now: number): Promise<number> {
  const claimRef = db.ref(`${SWEEP_ROOT}/lastExpiryAt`);
  // Seeded read: a cold admin-SDK transaction reports `null` for an existing
  // node, so an unseeded `cur` would claim (and re-sweep) every minute.
  const seedSnap = await claimRef.once('value').catch(() => undefined);
  if (seedSnap === undefined) return 0;
  const seed = Number(seedSnap.val()) || 0;
  if (now - seed < EXPIRY_EVERY_MS) return 0;

  const claim = await claimRef
    .transaction((cur: any) => {
      const last = Number(cur || seed) || 0;
      return now - last >= EXPIRY_EVERY_MS ? now : undefined;
    })
    .catch(() => null);
  if (!claim || !claim.committed) return 0;

  // The canonical real-outlet registry (small, and the same list the daily
  // report and the wallet reconcile use) - never the `businesses` tree.
  const indexSnap = await db.ref('outletIndex').once('value').catch(() => null);
  const index = (indexSnap && indexSnap.val()) || {};

  let swept = 0;
  for (const [oid, meta] of Object.entries(index as any)) {
    const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
    if (!bid || bid === DEMO_BUSINESS_ID) continue;
    try {
      // No transport: expiry only reads and deletes, and a tenant without a
      // number still needs its 30-day-old logs removed.
      const handle = await makePromotionEngine(bid, oid, { skipTransport: true, log: () => {} });
      await handle.engine.expireOldPromoLogs();
      swept++;
    } catch (e: any) {
      console.warn(`[PROMO-SWEEP] expiry ${bid}/${oid}: ${(e && e.message) || e}`);
    }
  }
  return swept;
}
