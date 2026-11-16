/**
 * dailyReports — Scheduled Cloud Function (batch: EC2 retirement)
 *
 * Sends daily/weekly/monthly sales reports to outlet admins via WhatsApp.
 * Replaces the EC2 bot's sendDailyReportSafely() heartbeat
 * (bot/index.js:2108) and reports.js.
 *
 * Runs at 21:30 IST daily (Asia/Kolkata), with weekly (Sunday) and monthly
 * (1st) variants derived from the same cron by checking day-of-week/day-of-month.
 * maxInstances: 1 to prevent overlapping runs.
 *
 * Config flag: config/dailyReports/enabled === true (default false = no-op)
 * Demo tenant (foodhubbie-demo) is hard-skipped.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { enqueueTask } from '../shared/utils/taskQueue';
import { getISTDateInfo, getISTStartOfDay, addISTDays, getISOWeekKey } from '../shared/utils/dates';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/dailyReports/enabled';

export const dailyReports = onSchedule(
  {
    schedule: '30 16 * * *', // 21:30 IST = 16:30 UTC
    timeZone: 'Asia/Kolkata',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
    maxInstances: 1,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async () => {
    // Config flag gate
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return;
    } catch {
      return;
    }

    initializeAdmin().catch(() => {});
    const db = getDB();
    const now = Date.now();
    const ist = getISTDateInfo(new Date(now));
    const todayStr = ist.dateStr;
    const dayOfWeek = ist.dayOfWeek; // 0=Sunday
    const dayOfMonth = ist.dayOfMonth;

    // Determine report type
    let reportType: 'daily' | 'weekly' | 'monthly' = 'daily';
    let periodStart: number;
    let periodLabel: string;

    if (dayOfMonth === 1) {
      reportType = 'monthly';
      periodStart = getISTStartOfDay(addISTDays(new Date(now), -30)).getTime();
      periodLabel = `${ist.monthKey}`;
    } else if (dayOfWeek === 0) {
      // Sunday — weekly
      reportType = 'weekly';
      periodStart = getISTStartOfDay(addISTDays(new Date(now), -7)).getTime();
      const weekKey = getISOWeekKey(new Date(now));
      periodLabel = `Week ${weekKey}`;
    } else {
      reportType = 'daily';
      periodStart = getISTStartOfDay(new Date(now)).getTime();
      periodLabel = todayStr;
    }

    // Read outlet index (small read: ~40 outlets max)
    const indexSnap = await db.ref('outletIndex').once('value');
    const index = indexSnap.val() || {};

    let outletsProcessed = 0;
    let reportsSent = 0;

    for (const [oid, meta] of Object.entries(index)) {
      const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
      if (!bid || bid === DEMO_BUSINESS_ID) continue;

      outletsProcessed++;

      try {
        // Read orders created in the report period (indexed query by createdAt)
        const ordersSnap = await db.ref(`businesses/${bid}/outlets/${oid}/orders`)
          .orderByChild('createdAt')
          .startAt(periodStart)
          .endAt(now)
          .once('value');
        const orders = ordersSnap.val() || {};

        // Compute totals
        let orderCount = 0;
        let totalSales = 0;
        let totalTax = 0;
        let totalDiscount = 0;
        let totalDeliveryFee = 0;
        const bySource: Record<string, number> = {};
        const byStatus: Record<string, number> = {};

        for (const [orderId, order] of Object.entries(orders)) {
          const o = order as any;
          if (!o || !o.createdAt) continue;
          const createdAt = Number(o.createdAt);
          if (createdAt < periodStart || createdAt > now) continue;

          orderCount++;
          totalSales += Number(o.total || 0);
          totalTax += Number(o.tax || 0);
          totalDiscount += Number(o.discount || 0);
          totalDeliveryFee += Number(o.deliveryFee || 0);

          const src = o.source || 'other';
          bySource[src] = (bySource[src] || 0) + 1;

          const st = String(o.status || 'Placed').toLowerCase();
          byStatus[st] = (byStatus[st] || 0) + 1;
        }

        // Read store name for branding
        let storeName = oid;
        try {
          const storeSnap = await db.ref(`businesses/${bid}/outlets/${oid}/settings/Store/storeName`).once('value');
          if (storeSnap.exists()) storeName = String(storeSnap.val());
        } catch {
          // use oid as fallback
        }

        // Format report text
        const sourceLine = Object.entries(bySource)
          .map(([s, c]) => `  ${s}: ${c}`)
          .join('\n') || '  none';
        const statusLine = Object.entries(byStatus)
          .map(([s, c]) => `  ${s}: ${c}`)
          .join('\n') || '  none';

        const emoji = reportType === 'daily' ? '📊' : reportType === 'weekly' ? '📈' : '🗓️';

        const body =
          `${emoji} *${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report*\n` +
          `*${storeName}* — ${periodLabel}\n\n` +
          `Orders: ${orderCount}\n` +
          `Sales: ₹${totalSales.toFixed(2)}\n` +
          `Tax: ₹${totalTax.toFixed(2)}\n` +
          `Discount: ₹${totalDiscount.toFixed(2)}\n` +
          `Delivery Fee: ₹${totalDeliveryFee.toFixed(2)}\n\n` +
          `*By Channel:*\n${sourceLine}\n\n` +
          `*By Status:*\n${statusLine}`;

        // Get admin JIDs for this outlet
        const adminsSnap = await db.ref('admins').once('value');
        const admins = adminsSnap.val() || {};
        const adminEntries = Object.entries(admins)
          .filter(([, a]: any) => !!a && !!a.whatsappJid)
          .filter(
            ([, a]: any) =>
              a.isSuper === true ||
              a.isSupreme === true ||
              !a.outlet ||
              String(a.outlet) === oid,
          )
          .map(([, a]: any) => ({ waJid: a.whatsappJid, name: a.name || a.email || a.uid }));

        if (adminEntries.length === 0) continue;

        const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

        // Enqueue outbound WhatsApp text to each admin
        await Promise.all(
          adminEntries.map((entry) => {
            if (!entry.waJid) return Promise.resolve();
            return enqueueTask('sendOutboundMessage', {
              to: entry.waJid,
              outlet: oid,
              businessId: bid,
              type: 'text',
              text: body,
              correlationId,
              _logChat: true,
            });
          }),
        );

        reportsSent += adminEntries.length;

        logger.info('[DailyReports] Report queued', {
          bid, oid, storeName, reportType, periodLabel,
          orderCount, totalSales: totalSales.toFixed(2), recipients: adminEntries.length,
        });
      } catch (err) {
        logger.error(`[DailyReports] Outlet ${oid} error`, {
          error: (err as Error).message,
        });
      }
    }

    logger.info('[DailyReports] Pass complete', {
      outletsProcessed, reportsSent, reportType, periodLabel,
    });
  },
);
