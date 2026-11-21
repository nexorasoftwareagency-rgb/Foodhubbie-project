/**
 * onWebhookInboxMessage — RTDB Trigger (batch 23m: inbound WhatsApp on Functions)
 *
 * Drains the queue `whatsappWebhook` writes to:
 *   businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
 *
 * Until this batch the drain enqueued a Cloud Task for `processInboundMessage`,
 * which is a DIFFERENT PRODUCT (text menu, `order <dish>`, text cart, COD/UPI)
 * and could not charge GST, apply the delivery slab fee, redeem a reward or
 * deduct stock. This trigger now calls the real handler directly:
 * `bot/inbound-flow.js` (vendored byte-for-byte into `lib/vendor/`), the same
 * module the WhatsApp bot runs, wired by `shared/whatsapp/factory.ts`.
 *
 * No Cloud Tasks: `shared/utils/taskQueue.ts` falls back to
 * `PROJECT_ID = 'foodhubbie-prod'` when the env var is absent, which is the
 * wrong project, so every enqueue would target a host that does not exist.
 *
 * Ordering of the guard rails (each one is load-bearing):
 *   1. `config/webhookInbox/enabled === true` — absent/false/no-op keeps the
 *      EC2 bot as the only inbound consumer while the flip is prepared.
 *   2. demo tenant hard-skipped (the nightly reseed writes fake data).
 *   3. only NEW entries (`after` present, `before` absent).
 *   4. stale entries (>30 min) dropped: Meta retries for ~7 days, and a
 *      six-hour-old "menu" tap has no value.
 *   5. the entry is deleted AFTER handling. A crash between handling and the
 *      delete causes a re-delivery, which the flow's own `bot/processed/{day}`
 *      dedupe absorbs — at-most-once per Meta message id.
 */

import { onValueWritten } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import { makeInboundFlow } from '../shared/whatsapp/factory';

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const MAX_INBOX_AGE_MS = 30 * 60 * 1000; // drop entries older than 30 min
const RELAY_FLAG = 'config/webhookInbox/enabled';

/**
 * Pull the customer's words out of a Cloud API message.
 *
 * Cloud API names differ from Baileys: a template quick reply arrives as
 * `type: 'button'` + `button.text`, and an interactive reply as
 * `type: 'interactive'` + `interactive.button_reply.title` (or `list_reply`).
 * Without this fallback the "Unsubscribe" button on the `promo_cta_*` templates
 * is a no-op — the tap carries no `text.body`, so the opt-out handler is
 * skipped and the customer stays subscribed (the exact bug fixed on the bot
 * side 2026-11-08).
 */
function extractText(message: any): string {
  if (!message) return '';
  if (message.text?.body) return String(message.text.body).trim();
  const reply =
    message.button?.text ||
    message.button?.payload ||
    message.interactive?.button_reply?.title ||
    message.interactive?.button_reply?.id ||
    message.interactive?.list_reply?.title ||
    message.interactive?.list_reply?.id ||
    '';
  return String(reply).trim();
}

export const onWebhookInboxMessage = onValueWritten(
  {
    ref: 'businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async (event) => {
    const { bid, oid, pushId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    const after = event.data.after.val();
    const before = event.data.before.val();
    if (!after || before) return; // only new entries

    const entryRef = event.data.after.ref;
    const drop = () => entryRef.remove().catch(() => {});

    // Admin must be initialized before ANY `getDB()` call — `getDB()` throws
    // "Admin SDK not initialized" on a cold start, which inside the flag gate
    // would be swallowed and leave the entry unprocessed for ever (nothing
    // retries a missed trigger).
    await initializeAdmin();

    // 1. Config flag gate — unreadable means "stay off".
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return; // leave the entry for the flip
    } catch {
      return;
    }

    const { message, receivedAt, profileName } = after || {};

    // 2. Nothing to answer.
    if (!message) return drop();

    // 3. Stale entry.
    const age = Date.now() - Number(receivedAt || 0);
    if (age > MAX_INBOX_AGE_MS) {
      logger.warn('[WebhookInbox] Dropped stale entry', {
        bid, oid, pushId, ageMin: Math.round(age / 60000),
      });
      return drop();
    }

    // 4. Not a message we answer (reactions, media-only, sticker, …). The flow
    //    speaks text; a media message would otherwise produce a greeting.
    const text = extractText(message);
    const from = String(message.from || '').replace(/[^0-9]/g, '');
    if (!from) {
      logger.warn('[WebhookInbox] Invalid sender, dropping entry', { bid, oid, pushId });
      return drop();
    }
    if (!text) return drop();

    // 5. Hand it to the real product.
    try {
      const { flow } = await makeInboundFlow(bid, oid, {
        log: (...args: any[]) => logger.info('[Inbound]', ...args),
      });
      const result = await flow.handleInbound({
        // The RAW number, country code included. The old drain sliced the last
        // 10 digits, which dropped the country code before the flow could see it.
        from,
        id: message.id ? String(message.id) : '',
        text,
        pushName: String(profileName || ''),
      });
      logger.info('[WebhookInbox] Handled', {
        bid, oid, pushId, sender: maskPhone(from), reason: result.reason, step: result.step,
      });
    } catch (err: any) {
      // A tenant with no `whatsapp` node (or a missing token) must not retry
      // forever: the entry is unanswerable, so drop it and say why once.
      logger.error('[WebhookInbox] Handler failed — entry dropped', {
        bid, oid, pushId, error: (err && err.message) || String(err),
      });
    }

    // 6. Delete after handling; a crash above re-delivers and the flow dedupes.
    return drop();
  },
);

/** Mask a phone number for logs. */
function maskPhone(digits: string): string {
  if (!digits || digits.length <= 4) return '****';
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}
