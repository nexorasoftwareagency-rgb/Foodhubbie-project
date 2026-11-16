/**
 * onWebhookInboxMessage — RTDB Trigger (batch: EC2 retirement)
 *
 * Drains the webhookInbox queue that `whatsappWebhook` (HTTPS function)
 * writes to. Meta delivers inbound WhatsApp messages to the webhook, which
 * validates the signature and enqueues each message under:
 *   businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
 *
 * This trigger fires on each new entry, normalizes the message, and
 * enqueues a task to processInboundMessage for full handling (opt-out,
 * session, rate limit, order flow, chat logging, outbound sends).
 *
 * The entry is deleted after the task is enqueued (not after processing),
 * so a crash between enqueue and processing causes a re-delivery —
 * processInboundMessage is idempotent via processed-message dedupe.
 *
 * Config flag: config/webhookInbox/enabled === true (default false = no-op)
 * Demo tenant (foodhubbie-demo) is hard-skipped.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { enqueueTask } from '../shared/utils/taskQueue';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const MAX_INBOX_AGE_MS = 30 * 60 * 1000; // drop entries older than 30 min
const RELAY_FLAG = 'config/webhookInbox/enabled';

export const onWebhookInboxMessage = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL'],
  },
  async (event) => {
    const { bid, oid, pushId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    const after = event.data.after.val();
    const before = event.data.before.val();
    if (!after || before) return; // only new entries

    // Config flag gate
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return; // no-op while flag is off
    } catch {
      return; // unreadable flag → stay off
    }

    const { message, receivedAt, source } = after || {};

    // Drop entries without a usable message
    if (!message) {
      await event.data.after.ref.remove().catch(() => {});
      return;
    }

    // Drop stale entries (>30 min old)
    const age = Date.now() - Number(receivedAt || 0);
    if (age > MAX_INBOX_AGE_MS) {
      logger.warn('[WebhookInbox] Dropped stale entry', {
        bid, oid, pushId, ageMin: Math.round(age / 60000),
      });
      await event.data.after.ref.remove().catch(() => {});
      return;
    }

    // Normalize Meta message → common shape
    const isText = !!message.text?.body;
    const isLocation = message.type === 'location' || !!message.location;
    if (!isText && !isLocation) {
      await event.data.after.ref.remove().catch(() => {});
      return;
    }

    const from = String(message.from || '').replace(/[^0-9]/g, '').slice(-10);
    const jid = `${from}@s.whatsapp.net`;
    const text = isText ? String(message.text.body) : '';
    const pushName = String(message.pushName || '');

    if (!jid || jid === '@s.whatsapp.net') {
      logger.warn('[WebhookInbox] Invalid JID, dropping entry', { bid, oid, pushId, from });
      await event.data.after.ref.remove().catch(() => {});
      return;
    }

    // Enqueue task for full processing
    await enqueueTask('processInboundMessage', {
      bid,
      oid,
      jid,
      text,
      pushName,
      message,
      receivedAt,
      source: source || 'meta-webhook',
    });

    // Delete entry after successful enqueue (at-most-once: reprocessing
    // on crash is safe because processInboundMessage dedupes by msgId)
    await event.data.after.ref.remove().catch(() => {});

    logger.info('[WebhookInbox] Drained entry', {
      bid, oid, pushId, jid: maskJid(jid), ageMin: Math.round(age / 60000),
    });
  },
);

/**
 * Mask a JID for logging.
 */
function maskJid(jid: string): string {
  if (!jid || !jid.includes('@')) return jid || 'unknown';
  const [phone, domain] = jid.split('@');
  if (phone.length <= 4) return `****@${domain}`;
  return `${phone.substring(0, 2)}****${phone.slice(-4)}@${domain}`;
}
