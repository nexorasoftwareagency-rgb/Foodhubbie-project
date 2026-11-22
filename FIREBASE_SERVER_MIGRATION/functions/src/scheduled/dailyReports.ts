/**
 * dailyReports — the outlet's end-of-day WhatsApp sales summary.
 *
 * Parity port of the bot's `sendDailyReport` (`bot/reports.js`) driven by the
 * heartbeat at `bot/index.js:2120`: 21:30 IST, plus a 01:30 IST catch-up for
 * YESTERDAY when the 21:30 pass never happened. Both lived in the Baileys
 * worker's `setInterval`, so with the box down the owner has not received a
 * report since 2026-11-11. Batch 23n moves the same summary onto the Cloud API.
 *
 * ONE function, two cron minutes (`30 1,21 * * *` Asia/Kolkata): at 01:30 the
 * target date is yesterday, at 21:30 it is today. A per-outlet claim
 * (`meta/dailyReports/last/{bid}/{oid}`) makes the pair idempotent — the
 * catch-up never re-sends a report the evening pass already delivered, and a
 * manual re-run of the job cannot bill twice for the same day.
 *
 * DEVIATIONS FROM THE BOT (deliberate, recorded):
 *  - Sales are counted with the shared `isBilledOrder` rule (the predicate Admin
 *    Costs and Supreme bill with), so a cancelled/refunded order is never
 *    reported as revenue. The bot summed `total` for Delivered/Confirmed/Paid,
 *    which counted a refunded bill as sales.
 *  - Orders are read with the indexed `createdAt` range query instead of
 *    downloading the whole `orders` node (batches 19/20 egress rule). Note the
 *    stored field is an ISO STRING, so the range bounds are ISO strings too.
 *  - An outlet with zero orders in the day is SKIPPED (logged, not sent): a
 *    "no sales" WhatsApp message is a billable utility message that tells the
 *    owner nothing the dashboard does not already show.
 *  - Weekly/monthly reports are NOT scheduled. In the bot those two senders
 *    were reachable only through the `bot/commands` listener
 *    (`SEND_WEEKLY_REPORT` / `SEND_MONTHLY_REPORT`) and nothing in Admin ever
 *    wrote those actions — `weeklyReportSent`/`monthlyReportSent` were declared
 *    and reset but never set. Porting a schedule for a message nobody has ever
 *    received would be a new product, not a parity port.
 *
 * Config flag: config/dailyReports/enabled === true (absent = no-op, the bot
 * keeps the job). Demo tenant hard-skipped.
 */

import * as path from 'path';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { getISTDateInfo, addISTDays } from '../shared/utils/dates';
import { makeTenantTransport, tenantAlertRecipients } from '../shared/whatsapp/factory';

/* eslint-disable @typescript-eslint/no-var-requires */
const costMath = require(path.join(__dirname, '../vendor/shared/cost-math.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/dailyReports/enabled';
const CLAIM_ROOT = 'meta/dailyReports/last';

/** IST midnight -> {start,end} epoch ms for one `YYYY-MM-DD` day. */
export function istDayBounds(dateStr: string): { start: number; end: number } {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/** `2026-11-21` -> `21 November 2026` (the bot's `toLocaleDateString('en-IN')`). */
function displayDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000+05:30`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function maskPhone(v: string): string {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `${d.slice(0, 2)}****${d.slice(-4)}`;
}

export const dailyReports = onSchedule(
  {
    // 01:30 and 21:30 IST. 21:30 is the bot's own send time; 01:30 is the
    // bot's "if the bot was off at 21:30" catch-up for the previous day.
    schedule: '30 1,21 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async () => {
    await initializeAdmin();

    // Config flag gate — unreadable means "stay off" (the bot keeps the job).
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return;
    } catch {
      return;
    }

    const db = getDB();
    const now = Date.now();
    const ist = getISTDateInfo(new Date(now));

    // 01:30 run = yesterday's report; 21:30 run = today's.
    const isCatchUp = ist.hour === 1;
    const targetDate = isCatchUp
      ? getISTDateInfo(addISTDays(new Date(now), -1)).dateStr
      : ist.dateStr;
    const { start, end } = istDayBounds(targetDate);
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();

    // The canonical real-outlet registry (~40 entries, one small read).
    const indexSnap = await db.ref('outletIndex').once('value');
    const index = indexSnap.val() || {};

    let outletsSeen = 0;
    let skippedNoOrders = 0;
    let skippedAlreadySent = 0;
    let reportsSent = 0;

    for (const [oid, meta] of Object.entries(index)) {
      const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
      if (!bid || bid === DEMO_BUSINESS_ID) continue;
      outletsSeen++;

      try {
        // Idempotency: one report per outlet per target date.
        const claimRef = db.ref(`${CLAIM_ROOT}/${bid}/${oid}`);
        const claimSnap = await claimRef.once('value').catch(() => null);
        const claim = (claimSnap && claimSnap.val()) || {};
        if (claim.dateStr === targetDate) {
          skippedAlreadySent++;
          continue;
        }

        // Indexed range query — never the whole orders node.
        const ordersSnap = await db
          .ref(`businesses/${bid}/outlets/${oid}/orders`)
          .orderByChild('createdAt')
          .startAt(startIso)
          .endAt(endIso)
          .once('value');
        const orders = ordersSnap.val() || {};

        let orderCount = 0;
        let cancelledCount = 0;
        let revenue = 0;
        const byStatus: Record<string, number> = {};

        for (const raw of Object.values(orders)) {
          const o = raw as any;
          if (!o || !o.createdAt) continue;
          const at = Date.parse(o.createdAt);
          if (!Number.isFinite(at) || at < start || at > end) continue;

          orderCount++;
          const st = String(o.status || 'Unknown');
          byStatus[st] = (byStatus[st] || 0) + 1;

          if (!costMath.isBilledOrder(o)) {
            if (st.toLowerCase() === 'cancelled' || st.toLowerCase() === 'refunded') cancelledCount++;
            continue;
          }
          revenue += Number(o.total || 0) || 0;
        }

        if (orderCount === 0) {
          skippedNoOrders++;
          continue;
        }

        let storeName = oid;
        try {
          const storeSnap = await db
            .ref(`businesses/${bid}/outlets/${oid}/settings/Store/storeName`)
            .once('value');
          if (storeSnap.exists()) storeName = String(storeSnap.val());
        } catch {
          // oid is an acceptable name
        }

        const breakdown =
          Object.entries(byStatus)
            .map(([s, c]) => `      ▫️ ${s}: ${c}`)
            .join('\n') || '      ▫️ none';

        const body =
          `📊 *${storeName.toUpperCase()} — DAILY SALES REPORT*\n` +
          `------------------------\n` +
          `📅 Sales Date: *${displayDate(targetDate)}*\n` +
          `----------------------------\n` +
          `   📦 Total Orders: ${orderCount}\n` +
          `   💰 Real Sales: ₹${revenue.toLocaleString('en-IN')}\n` +
          `   📊 Breakdown:\n${breakdown}\n` +
          (cancelledCount
            ? `   ⚠️ Cancelled/Refunded: ${cancelledCount} (not counted in sales)\n`
            : '') +
          `\n------------------------\n` +
          `💵 *TOTAL REVENUE:* ₹${revenue.toLocaleString('en-IN')}\n` +
          `📦 *TOTAL ORDERS:* ${orderCount}\n` +
          `------------------------\n` +
          `_Sent automatically by ${storeName} Bot_`;

        const recipients = await tenantAlertRecipients(bid, oid);
        const { transport } = await makeTenantTransport(bid, oid, { log: () => {} });
        let sent = 0;
        for (const to of recipients) {
          try {
            await transport.sendMessage(to, { text: body });
            sent++;
          } catch (e: any) {
            logger.warn('[DailyReports] send failed', {
              oid,
              to: maskPhone(to),
              error: e && e.message,
            });
          }
        }

        // Claim only after at least one copy left; a total failure must be
        // retried by the next run rather than silently marked "sent".
        if (sent > 0) {
          await claimRef
            .set({ dateStr: targetDate, at: Date.now(), orders: orderCount, revenue, sent, by: 'cloud' })
            .catch(() => {});
        }

        reportsSent += sent;
        logger.info('[DailyReports] Report sent', {
          bid,
          oid,
          storeName,
          targetDate,
          catchUp: isCatchUp,
          orderCount,
          revenue: revenue.toFixed(2),
          recipients: recipients.length,
          sent,
        });
      } catch (err) {
        // A tenant with no number connected throws here — skip it, never fail
        // the whole pass for every other outlet.
        logger.warn(`[DailyReports] Outlet ${oid} skipped`, {
          error: (err as Error).message,
        });
      }
    }

    logger.info('[DailyReports] Pass complete', {
      targetDate,
      catchUp: isCatchUp,
      outletsSeen,
      skippedNoOrders,
      skippedAlreadySent,
      reportsSent,
    });
  },
);
