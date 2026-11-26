/**
 * onPromotionStatus — RTDB Trigger (batch 23q: campaigns leave the socket)
 *
 * The promotions engine is now cloud-owned. Three moving parts:
 *
 *   1. THIS FILE  `onPromotionStatus` — keeps a tiny dispatch index so the
 *                 per-minute sweep never has to query every outlet's campaigns
 *                 node (that query is the batch-11/14/15 egress bug class).
 *   2. `botCommands.ts`  SEND_PROMOTION — deletes the command and runs slice 1,
 *                        so a campaign the owner just launched starts in seconds.
 *   3. `promotionSweep.ts`  onSchedule('* * * * *') — runs one slice per due
 *                        entry and owns the daily 30-day expiry.
 *
 * ## Why a leaf listener on `status`
 *
 * The runner writes `currentIndex`/`totalSent`/`lastHeartbeat`/`nextSliceAt` on
 * every send. A listener on the whole campaign node would fire ~300 times per
 * campaign and re-read the document each time. A campaign only changes status
 * 3-5 times in its life (running -> done/paused), which is exactly when the
 * index needs to know.
 *
 * ## The index
 *
 *   meta/promotionsActive/{bid}/{oid}/{campaignId} = { status, runAt, at }
 *
 * Admin-SDK only — no rules grant, nothing client-readable. Terminal and paused
 * campaigns are REMOVED: a paused campaign is the owner's to act on and must
 * never be auto-resumed (the engine refuses it too). Re-launching or resuming
 * writes `status: 'running'` again, which re-creates the entry.
 *
 * This trigger does NOT run a slice. Slice 1 belongs to `onBotCommand` (launch)
 * and every later slice to the sweep; a third caller would only race the
 * campaign lease for the same work.
 *
 * Config flag: `config/promotionsRelay/enabled === true` (absent = no-op, the
 * bot keeps the job). Demo tenant hard-skipped.
 */
import { onValueWritten } from 'firebase-functions/v2/database';
import { getDB, initializeAdmin } from '../shared/firebase/admin';
import { PROMO_RULES } from '../shared/promotions/factory';

const RELAY_FLAG = 'config/promotionsRelay';
const INDEX_ROOT = 'meta/promotionsActive';
/** The public demo: its 03:00 IST reseed must never page a real customer. */
const DEMO_BUSINESS_ID = 'foodhubbie-demo';

/** Never leave an entry behind for a campaign that will not run by itself. */
function shouldIndex(status: string): boolean {
  if (!status) return false;
  if (status === 'paused') return false;
  return !PROMO_RULES.TERMINAL_STATUSES.includes(status);
}

export const onPromotionStatus = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{campaignId}/status',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async (event) => {
    const { bid, oid, campaignId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    await initializeAdmin();

    // Only an explicit true enables the cloud path; every other state (absent,
    // false, unreadable) leaves the bot owning campaigns.
    try {
      const snap = await getDB().ref(RELAY_FLAG).once('value');
      const { enabled } = (snap && snap.val()) || {};
      if (!(enabled === true)) return;
    } catch {
      return;
    }

    const db = getDB();
    const after = event.data && event.data.after && event.data.after.val();
    const status = String(after || '');
    const entryPath = `${INDEX_ROOT}/${bid}/${oid}/${campaignId}`;

    if (!shouldIndex(status)) {
      await db.ref(entryPath).remove().catch(() => {});
      return;
    }

    // `runAt` is what a scheduled campaign waits for; one leaf read on a
    // transition only (never per send).
    let runAt = 0;
    try {
      const runAtSnap = await db
        .ref(`businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}/runAt`)
        .once('value');
      runAt = Number(runAtSnap.val()) || 0;
    } catch {
      // the sweep treats a missing runAt as "due now", which the engine gates
    }

    await db
      .ref(entryPath)
      .set({ status, runAt: runAt || null, at: Date.now() })
      .catch(() => {});
  },
);
