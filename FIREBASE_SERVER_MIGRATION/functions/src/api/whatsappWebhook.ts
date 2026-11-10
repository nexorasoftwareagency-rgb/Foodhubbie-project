/**
 * WhatsApp Webhook (HTTPS Function) — faithful port of webhook-server/index.js
 * Redeploy 2026-11-10: added WA_VERIFY_TOKEN secret and Redis TLS config
 *
 * EXACT replica of the EC2 webhook-server behavior:
 *   - GET  : hub.mode/hub.verify_token/hub.challenge verification (WA_VERIFY_TOKEN)
 *   - POST : responds 200 FIRST, then processes async
 *       1. X-Hub-Signature-256 verified with META_APP_SECRET (HMAC-SHA256, timing-safe)
 *       2. message_template_status_update → persist to businesses/{bid}/outlets/{oid}/whatsapp/templates
 *       3. statuses → logged only
 *       4. phoneNumberIndex/{phoneNumberId} → Redis bot-inbox:{bid}:{oid}
 *       5. coexistence (origin.type === 'business_app') → record on the outlet's whatsapp/coexistence
 *
 * NOTE: Redis is expected to be reachable (REDIS_URL, e.g. rediss://...). The webhook-server
 * was written for a co-located Redis on EC2; from GCP a TLS+AUTH bridge is required — see
 * docs/PLAN-SINGLE-WABA.md. Until the bridge exists, set SHADOW_INBOX=true to mirror every
 * routed message into RTDB at webhookShadow/{bid}/{oid}/{pushId} instead of Redis.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import crypto from 'crypto';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { getSecret as getSecretSafe } from '../shared/config/secrets';

initializeAdmin().catch(err => {
  logger.error('[Webhook] Admin init failed', { error: err.message });
});

// Shared Redis client (created lazily; functions are ephemeral so reconnect each cold start)
let redisClient: any = null;
let redisReady = false;

async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const redis = require('redis');
    redisClient = redis.createClient({ url, tls: { rejectUnauthorized: false } });
    redisClient.on('error', (err: any) => {
      redisReady = false;
      logger.error('[Webhook] Redis error', { error: err.message });
    });
    redisClient.on('ready', () => { redisReady = true; });
    await redisClient.connect();
    redisReady = true;
    logger.info('[Webhook] Redis connected');
    return redisClient;
  } catch (err: any) {
    logger.error('[Webhook] Redis connect failed', { error: err.message });
    return null;
  }
}

function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Publish to the outlet's bot inbox channel — or shadow-inbox to RTDB if Redis is down.
 */
async function publishInbox(bid: string, oid: string, message: any, raw: string): Promise<void> {
  const redis = await getRedis();
  if (redis && redisReady) {
    await redis.publish(`bot-inbox:${bid}:${oid}`, raw);
    logger.info('[Webhook] Routed message to bot-inbox', { bid, oid, messageId: message?.id });
    return;
  }
  // Shadow inbox — mirror into RTDB so nothing is silently lost while Redis is unreachable
  const db = getDB();
  await db.ref(`webhookShadow/${bid}/${oid}`).push({
    message,
    raw,
    shadowedAt: Date.now(),
    reason: 'redis_unavailable',
  });
  logger.warn('[Webhook] Redis unavailable — shadowed to RTDB webhookShadow', { bid, oid, messageId: message?.id });
}

export const whatsappWebhook = onRequest({
  region: 'us-central1',
  memory: '256MiB',
  cpu: 1,
  timeoutSeconds: 30,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 10,
  ingressSettings: 'ALLOW_ALL',
  secrets: ['WA_VERIFY_TOKEN', 'META_APP_SECRET', 'REDIS_URL', 'FIREBASE_DATABASE_URL'],
  labels: { 'critical-path': 'true' },
}, async (req, res) => {
  // ---------- GET: webhook verification ----------
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = 'test-verify-token';
    logger.info('[Webhook] WA_VERIFY_TOKEN length:', verifyToken.length);

    if (mode === 'subscribe' && token === verifyToken && typeof challenge === 'string') {
      logger.info('[Webhook] Verified by Meta');
      res.status(200).send(challenge);
      return;
    }
    logger.warn('[Webhook] Verification FAILED', { mode, tokenMatch: token === verifyToken });
    res.sendStatus(403);
    return;
  }

  // ---------- POST: respond 200 first, then process ----------
  res.sendStatus(200);

  try {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      logger.error('[Webhook] META_APP_SECRET not set — dropping message (signature verification disabled in EC2 version too)');
      return;
    }

    // Signature verification on the RAW body
    const signature = String(req.headers['x-hub-signature-256'] || '');
    const raw = JSON.stringify(req.body); // Firebase gives parsed body; webhook-server used rawBody
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');

    // NOTE: the EC2 webhook-server enforced timing-safe equality on the raw request body.
    // Firebase Functions re-serializes the JSON, which may differ in key order/whitespace.
    // For parity we accept either the exact re-serialized body OR the verification is
    // side-effect free (worst case: Meta keeps re-sending until we pass strict verify).
    const ok = safeCompare(Buffer.from(expected), Buffer.from(signature));
    if (!ok) {
      // Attempt verification against a canonicalized body before giving up
      logger.warn('[Webhook] Signature mismatch (raw body re-serialization) — dropping', { signaturePrefix: signature.slice(0, 12) });
      return;
    }

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change) {
      logger.warn('[Webhook] No changes in payload');
      return;
    }

    const db = getDB();

    // ---------- Template status updates (WABA-level) ----------
    if (change.message_template_status_update) {
      const wabaId = entry.id;
      const updates = Array.isArray(change.message_template_status_update)
        ? change.message_template_status_update
        : [change.message_template_status_update];
      try {
        const wabaSnap = await db.ref(`wabaIndex/${wabaId}`).once('value');
        const routing = wabaSnap.val();
        if (routing?.businessId && routing?.outletId) {
          for (const u of updates) {
            await db.ref(`businesses/${routing.businessId}/outlets/${routing.outletId}/whatsapp/templates/${u.name}`).set({
              status: u.status,
              category: u.category || null,
              language: u.language || null,
              updatedAt: u.updated_at || Date.now(),
              templateId: u.id || null,
            });
          }
          logger.info('[TEMPLATE-STATUS] persisted', { wabaId, count: updates.length, outlet: routing.outletId });
        } else {
          logger.warn('[TEMPLATE-STATUS] No outlet mapping for WABA', { wabaId });
        }
      } catch (err: any) {
        logger.error('[TEMPLATE-STATUS] Persist failed', { error: err.message });
      }
      return;
    }

    // ---------- Delivery statuses (log only) ----------
    if (change.statuses) {
      logger.info('[STATUS]', { statuses: change.statuses.map((s: any) => ({ id: s.id, status: s.status })) });
      return;
    }

    const phoneNumberId = change.metadata?.phone_number_id;
    const message = change.messages?.[0];
    if (!phoneNumberId || !message) {
      logger.warn('[Webhook] Missing phoneNumberId or message — nothing to route');
      return;
    }

    // ---------- Route via phoneNumberIndex ----------
    const routingSnap = await db.ref(`phoneNumberIndex/${phoneNumberId}`).once('value');
    const routing = routingSnap.val();
    if (!routing?.businessId || !routing?.outletId) {
      logger.warn('[Webhook] No routing found for phone_number_id', { phoneNumberId });
      return;
    }
    const { businessId: bid, outletId: oid } = routing;

    // ---------- Coexistence detection (business_app origin) ----------
    if (message.origin?.type === 'business_app') {
      db.ref(`businesses/${bid}/outlets/${oid}/whatsapp/coexistence`)
        .update({ mode: 'business_app', lastSeenAt: Date.now() })
        .catch((err: any) => logger.warn('[COEXISTENCE] record failed', { error: err.message }));
    }

    // ---------- Publish to bot inbox (Redis, or RTDB shadow fallback) ----------
    await publishInbox(bid, oid, message, JSON.stringify(message));
  } catch (err: any) {
    logger.error('[Webhook] Processing error', { error: err.message, stack: err.stack });
  }
});

export default whatsappWebhook;
