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
 * NOTE: the bot runs on EC2. This function cannot reach its Redis (port 8443 is
 * not exposed and Redis has no password), so it enqueues each routed message
 * under `businesses/{bid}/outlets/{oid}/webhookInbox`; the bot's meta transport
 * drains that queue with a child_added listener. See bot/transport.js start().
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import crypto from 'crypto';
import { initializeAdmin, getDB } from '../shared/firebase/admin';

initializeAdmin().catch(err => {
  logger.error('[Webhook] Admin init failed', { error: err.message });
});

function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the bytes Meta actually sent.
 * `req.rawBody` is populated by the Functions runtime; re-serializing req.body
 * changes key order/whitespace and fails verification on real traffic.
 */
function signatureMatches(appSecret: string, rawBody: Buffer, header: string): boolean {
  const provided = String(header || '').trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  return safeCompare(Buffer.from(provided, 'hex'), expected);
}

/**
 * Enqueue onto the outlet's webhookInbox. The bot's meta transport drains it
 * with a child_added listener and deletes each entry after dispatching, so a
 * bot outage leaves a bounded backlog instead of dropping messages.
 */
async function enqueueInbox(bid: string, oid: string, message: any): Promise<void> {
  const db = getDB();
  await db.ref(`businesses/${bid}/outlets/${oid}/webhookInbox`).push({
    message,
    receivedAt: Date.now(),
    source: 'meta-webhook',
  });
  logger.info('[Webhook] Queued to webhookInbox', { bid, oid, messageId: message?.id });
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
  secrets: ['WA_VERIFY_TOKEN', 'META_APP_SECRET', 'FIREBASE_DATABASE_URL'],
  labels: { 'critical-path': 'true' },
}, async (req, res) => {
  // ---------- GET: webhook verification ----------
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = (process.env.WA_VERIFY_TOKEN || '').trim();

    if (!verifyToken) {
      logger.error('[Webhook] WA_VERIFY_TOKEN is not set — cannot verify Meta');
      res.sendStatus(500);
      return;
    }

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
    const appSecret = (process.env.META_APP_SECRET || '').trim();
    if (!appSecret) {
      logger.error('[Webhook] META_APP_SECRET not set — dropping payload');
      return;
    }

    // Signature verification on the RAW body (exactly what Meta signed).
    const rawBody: Buffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body), 'utf8');
    if (!Buffer.isBuffer(req.rawBody)) {
      logger.warn('[Webhook] req.rawBody missing — falling back to re-serialized body');
    }

    if (!signatureMatches(appSecret, rawBody, String(req.headers['x-hub-signature-256'] || ''))) {
      logger.warn('[Webhook] Signature mismatch — dropping');
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

    // ---------- Enqueue for the bot (RTDB webhookInbox) ----------
    await enqueueInbox(bid, oid, message);
  } catch (err: any) {
    logger.error('[Webhook] Processing error', { error: err.message, stack: err.stack });
  }
});

export default whatsappWebhook;
