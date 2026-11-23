/**
 * WhatsApp Webhook (HTTPS Function) — faithful port of webhook-server/index.js
 *
 * EXACT replica of the EC2 webhook-server behavior:
 *   - GET  : hub.mode/hub.verify_token/hub.challenge verification (WA_VERIFY_TOKEN)
 *   - POST : responds 200 FIRST, then processes async
 *       1. X-Hub-Signature-256 verified over req.rawBody with META_APP_SECRET
 *       2. message_template_status_update → persist to businesses/{bid}/outlets/{oid}/whatsapp/templates
 *       3. statuses → logged only
 *       4. smb_message_echoes (coexistence) → Admin Chat thread, from:'app' — NEVER the inbox
 *       5. phoneNumberIndex/{phoneNumberId} → RTDB webhookInbox under the outlet
 *       6. coexistence (origin.type === 'business_app') → record on the outlet's whatsapp/coexistence
 *
 * Coexistence (batch 23p): with the number on the WhatsApp Business App AND the
 * Cloud API, a message the restaurant sends from the phone comes back as
 * `message_echoes` — not as a customer message. It must reach the Admin Chat
 * thread (so the dashboard does not show the customer as unanswered and the
 * operator does not reply twice) and must NEVER reach `webhookInbox`, or the
 * bot would run its inbound state machine on the business's own number.
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
import { makeTenantChatLog } from '../shared/whatsapp/factory';

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
 * Enqueue onto the outlet's webhookInbox. The `onWebhookInboxMessage` trigger
 * drains it and deletes each entry after handling it, so a Functions outage
 * leaves a bounded backlog instead of dropping messages.
 *
 * `profileName` is the sender's WhatsApp display name (`contacts[].profile.name`);
 * it never rides on the message itself, and the greeting uses it ("Namaste Ravi
 * ji"), so it is captured here rather than looked up per trigger.
 */
async function enqueueInbox(bid: string, oid: string, message: any, profileName?: string): Promise<void> {
  const db = getDB();
  await db.ref(`businesses/${bid}/outlets/${oid}/webhookInbox`).push({
    message,
    receivedAt: Date.now(),
    source: 'meta-webhook',
    ...(profileName ? { profileName } : {}),
  });
  logger.info('[Webhook] Queued to webhookInbox', { bid, oid, messageId: message?.id });
}

/**
 * Record that the number is on the WhatsApp Business App AND the Cloud API.
 * Read by the Supreme WhatsApp card. An echo is the definitive proof; an
 * inbound message carrying `origin.type === 'business_app'` is the weaker one.
 * Best-effort: never fails the webhook.
 */
function recordCoexistence(bid: string, oid: string): void {
  getDB()
    .ref(`businesses/${bid}/outlets/${oid}/whatsapp/coexistence`)
    .update({ mode: 'business_app', lastSeenAt: Date.now() })
    .catch((err: any) => logger.warn('[COEXISTENCE] record failed', { error: err.message }));
}

/**
 * Readable text of a business-app echo, for the Admin Chat thread only.
 * Same fallbacks as the inbound extractor: a WhatsApp message does not always
 * carry `text.body` — a photo carries a caption, a template quick reply carries
 * `button.text`, an interactive reply carries `interactive.{button,list}_reply`.
 * Anything else becomes `<media>` inside the chat log.
 */
function echoText(echo: any): string {
  const m = echo || {};
  return String(
    m.text?.body
    || m.image?.caption
    || m.video?.caption
    || m.document?.caption
    || m.button?.text
    || m.interactive?.button_reply?.title
    || m.interactive?.list_reply?.title
    || (m.location ? 'Location shared' : '')
    || '',
  ).trim();
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

    // Cloud Functions pre-creates the default app, so the module-level
    // initializeAdmin() is the normal path — but it is async and the first
    // request of a cold start can arrive before it settles. getDB() throws in
    // that window, which would drop the very first message after every scale-to-
    // zero. Awaiting the (memoized) init before any DB call closes the race.
    await initializeAdmin();

    const entries: any[] = Array.isArray(req.body?.entry) ? req.body.entry : [];
    if (entries.length === 0) {
      logger.warn('[Webhook] No entries in payload');
      return;
    }

    const db = getDB();
    let routed = 0;

    // Meta may batch several entries / changes / messages into one POST (and
    // the EC2 server only ever read [0] of each, silently dropping the rest).
    // Walk them all: a dropped message is a customer the bot never answers.
    for (const entry of entries) {
      const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const item of changes) {
        const change = item?.value;
        if (!change) continue;

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
          continue;
        }

        // ---------- Delivery statuses (log only) ----------
        if (change.statuses) {
          logger.info('[STATUS]', { statuses: change.statuses.map((s: any) => ({ id: s.id, status: s.status })) });
          continue;
        }

        // ---------- Coexistence: staff replies sent from the WhatsApp Business App ----------
        // `smb_message_echoes` carries `value.message_echoes` and an EMPTY
        // `messages` array. These are the restaurant's own outbound messages:
        // log them into the Admin Chat thread (`from:'app'`) and stop here.
        // Enqueuing one would hand the business's own number to the inbound state
        // machine as if a customer had written — the bot would answer itself.
        const messages: any[] = Array.isArray(change.messages) ? change.messages : [];
        const echoes: any[] = Array.isArray(change.message_echoes) ? change.message_echoes : [];
        if (echoes.length > 0) {
          const echoPhoneId = change.metadata?.phone_number_id;
          const echoRouting = echoPhoneId
            ? (await db.ref(`phoneNumberIndex/${echoPhoneId}`).once('value')).val()
            : null;
          if (!echoRouting?.businessId || !echoRouting?.outletId) {
            logger.warn('[ECHO] No routing for phone_number_id', { phoneNumberId: echoPhoneId });
            continue;
          }
          const ebid = echoRouting.businessId;
          const eoid = echoRouting.outletId;

          // An echo is the definitive proof coexistence is ON.
          recordCoexistence(ebid, eoid);

          const chatLog = makeTenantChatLog(ebid, eoid, { log: (...a: any[]) => logger.warn(...a) });
          let logged = 0;
          for (const echo of echoes) {
            // revoke = staff deleted a message on the phone, edit = it changed.
            // Neither is a new message; the thread keeps the original (best-effort
            // tab — WhatsApp itself shows "This message was deleted"). Reactions
            // are not messages either.
            if (echo?.revoke || echo?.edit || echo?.type === 'reaction') continue;
            const to = echo?.to ? String(echo.to) : '';
            if (!to) {
              logger.warn('[ECHO] Missing `to` — cannot thread', { id: echo?.id });
              continue;
            }
            const msgId = echo?.id || `echo_${echo?.timestamp || Date.now()}`;
            await chatLog.logChatMessage({ jid: to, msgId, from: 'app', text: echoText(echo) });
            logged++;
          }
          logger.info('[ECHO] Business-app messages logged', { bid: ebid, oid: eoid, count: logged });
          // Echoes travel in their own change with no `messages` — but if Meta
          // ever batches both, the customer messages below must still be routed.
          if (messages.length === 0) continue;
        }

        const phoneNumberId = change.metadata?.phone_number_id;
        if (!phoneNumberId || messages.length === 0) {
          logger.warn('[Webhook] Missing phoneNumberId or message — nothing to route');
          continue;
        }

        // ---------- Route via phoneNumberIndex ----------
        const routingSnap = await db.ref(`phoneNumberIndex/${phoneNumberId}`).once('value');
        const routing = routingSnap.val();
        if (!routing?.businessId || !routing?.outletId) {
          logger.warn('[Webhook] No routing found for phone_number_id', { phoneNumberId });
          continue;
        }
        const { businessId: bid, outletId: oid } = routing;
        const contacts: any[] = Array.isArray(change.contacts) ? change.contacts : [];

        for (const message of messages) {
          // ---------- Coexistence detection (business_app origin) ----------
          if (message.origin?.type === 'business_app') recordCoexistence(bid, oid);

          // Display name rides on `contacts`, matched to this sender.
          const contact = contacts.find((c) => String(c?.wa_id) === String(message.from)) || contacts[0];
          const profileName = contact?.profile?.name ? String(contact.profile.name) : undefined;

          // ---------- Enqueue for the inbound handler (RTDB webhookInbox) ----------
          await enqueueInbox(bid, oid, message, profileName);
          routed++;
        }
      }
    }

    logger.info('[Webhook] Payload processed', { entries: entries.length, routed });
  } catch (err: any) {
    logger.error('[Webhook] Processing error', { error: err.message, stack: err.stack });
  }
});

export default whatsappWebhook;
