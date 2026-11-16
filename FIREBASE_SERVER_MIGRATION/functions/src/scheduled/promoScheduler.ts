/**
 * promoScheduler — Scheduled Cloud Function (batch: EC2 retirement)
 *
 * Picks up scheduled WhatsApp promotional campaigns whose runAt is due and
 * enqueues send tasks to the sendOutboundMessage task queue. Replaces the EC2
 * bot's pickupScheduledPromotions() heartbeat (bot/index.js:2141) and the
 * runPromotionCampaign loop (bot/promotions.js:314).
 *
 * Runs every 5 minutes (Asia/Kolkata), maxInstances: 1.
 *
 * Config flag: config/promoScheduler/enabled === true (default false = no-op)
 * Demo tenant (foodhubbie-demo) is hard-skipped.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { enqueueTask } from '../shared/utils/taskQueue';
import { getISTDateInfo } from '../shared/utils/dates';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/promoScheduler/enabled';

// Ported from bot/promotions.js constants
const PROMO_DAILY_LIMIT = 300;
const PROMO_WARMUP_DAILY_LIMITS = [20, 40, 60, 100, 150, 200, 250];
const PROMO_SCHEDULE_MISSED_GRACE_MS = 15 * 60 * 1000; // 15 min

export const promoScheduler = onSchedule(
  {
    schedule: 'every 5 minutes',
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

    // Read outlet index (small read: ~40 outlets max)
    const indexSnap = await db.ref('outletIndex').once('value');
    const index = indexSnap.val() || {};

    let outletsProcessed = 0;
    let campaignsDue = 0;
    let campaignsSkipped = 0;
    let tasksEnqueued = 0;

    for (const [oid, meta] of Object.entries(index)) {
      const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
      if (!bid || bid === DEMO_BUSINESS_ID) continue;

      outletsProcessed++;

      try {
        // Check kill switch
        const killSwitchSnap = await db.ref(
          `businesses/${bid}/outlets/${oid}/bot/promotions/killSwitch`,
        ).once('value');
        if (killSwitchSnap.val() === true) {
          campaignsSkipped++;
          continue;
        }

        // Read campaigns for this outlet
        const campaignsSnap = await db.ref(
          `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns`,
        ).once('value');
        const campaigns = campaignsSnap.val() || {};

        for (const [campaignId, campaign] of Object.entries(campaigns)) {
          const c = campaign as any;
          if (!c || c.status !== 'scheduled') continue;

          const runAt = Number(c.runAt || 0);
          if (!runAt || runAt > now + PROMO_SCHEDULE_MISSED_GRACE_MS) continue;

          // Campaign is due — mark as running
          campaignsDue++;

          // Compute daily limit (warm-up schedule)
          let safeDailyLimit = PROMO_DAILY_LIMIT;
          try {
            const pairSnap = await db.ref(`bot/pair/${oid}`).once('value');
            const firstLinkedAt = Number(pairSnap.val()?.firstLinkedAt || 0);
            if (firstLinkedAt > 0) {
              const daysSinceLink = Math.floor((now - firstLinkedAt) / 86400000);
              const warmIdx = Math.min(daysSinceLink, PROMO_WARMUP_DAILY_LIMITS.length - 1);
              safeDailyLimit = PROMO_WARMUP_DAILY_LIMITS[warmIdx];
            }
          } catch {
            // use default PROMO_DAILY_LIMIT
          }

          // Check daily counter
          let dailySentToday = 0;
          try {
            const dailySnap = await db.ref(
              `businesses/${bid}/outlets/${oid}/bot/promotions/dailyCount/${todayStr}`,
            ).once('value');
            dailySentToday = Number(dailySnap.val() || 0);
          } catch {
            dailySentToday = 0;
          }

          if (dailySentToday >= safeDailyLimit) {
            await db.ref(
              `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}/status`,
            ).set('paused');
            await db.ref(
              `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}/pauseReason`,
            ).set('daily-limit');
            campaignsSkipped++;
            continue;
          }

          // Get recipients
          const recipients: string[] = Array.isArray(c.recipients) ? c.recipients : [];
          if (recipients.length === 0) {
            await db.ref(
              `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}/status`,
            ).set('stopped');
            await db.ref(
              `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}/pauseReason`,
            ).set('no-recipients-on-resume');
            campaignsSkipped++;
            continue;
          }

          // Mark campaign as running (transaction to avoid double-pickup)
          const campaignRef = db.ref(
            `businesses/${bid}/outlets/${oid}/bot/promotions/campaigns/${campaignId}`,
          );
          const claim = await campaignRef.child('status').transaction((cur: string | null) =>
            cur === 'scheduled' ? 'running' : undefined,
          );
          if (!claim.committed) {
            // Another invocation picked it up
            campaignsSkipped++;
            continue;
          }

          // Enqueue send tasks for each recipient (batch, with small stagger)
          const correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          const waTemplateName = c.waTemplateName || c.templateName || 'promo_hinglish_offer';

          for (let i = 0; i < recipients.length; i++) {
            const phone = String(recipients[i]).replace(/[^0-9]/g, '').slice(-10);
            if (!/^[6-9]\d{9}$/.test(phone)) continue;

            const jid = `${phone}@s.whatsapp.net`;

            // Stagger sends by ~1s to avoid burst
            const delaySeconds = i % 10 === 0 ? Math.floor(i / 10) * 1 : 0;

            await enqueueTask(
              'sendOutboundMessage',
              {
                to: jid,
                outlet: oid,
                businessId: bid,
                type: 'template',
                template: {
                  name: waTemplateName,
                  language: 'en',
                  components: [
                    { type: 'BODY', parameters: [{ type: 'text', text: String(c.body || '') }] },
                  ],
                },
                correlationId,
                campaignId,
                waTemplateName,
                isTest: c.isTest === true,
              },
              { delaySeconds },
            );
            tasksEnqueued++;
          }

          // Update campaign stats
          await campaignRef.child('status').set('completed');
          await campaignRef.child('startedAt').set(now);
          await campaignRef.child('totalSent').set(recipients.length);
          await campaignRef.child('totalFailed').set(0);
          await campaignRef.child('lastHeartbeat').set(now);

          campaignsDue++;
        }
      } catch (err) {
        logger.error(`[PromoScheduler] Outlet ${oid} error`, {
          error: (err as Error).message,
        });
        campaignsSkipped++;
      }
    }

    logger.info('[PromoScheduler] Pass complete', {
      outletsProcessed,
      campaignsDue,
      campaignsSkipped,
      tasksEnqueued,
    });
  },
);
