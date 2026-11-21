/**
 * WHATSAPP BOT TRANSPORT LAYER
 * Two interchangeable transports behind the same Baileys-style `sock` interface:
 *  - 'baileys' : WhatsApp Web (real phone number, QR pairing)
 *  - 'meta'    : Meta WhatsApp Cloud API (webhook receive via the RTDB
 *                `webhookInbox` queue, or Redis pub/sub from the EC2
 *                webhook-server until that is retired; send via Graph API)
 * ONLY ONE transport is active per outlet at a time. Mode is set in Firebase
 * `bot/{outlet}/transport` (Supreme Admin control) or env BOT_TRANSPORT.
 */
const { formatJid } = require('./utils');
const waSend = require('./whatsapp-send');
const { db, getData, resolvePath } = require('./firebase');
const { resolveBusinessIdFor } = require('./helpers/outlet-resolution');
const { createMetaCost } = require('./meta-cost');

async function getTransportMode(outlet) {
  const remote = await getData('bot/transport', outlet).catch(() => null);
  return remote || process.env.BOT_TRANSPORT || 'baileys';
}

async function getPhoneNumberId(outlet) {
  const stored = await getData('bot/phoneNumberId', outlet).catch(() => null);
  if (stored) return stored;
  // Fallback: reverse-lookup phoneNumberIndex for this business/outlet
  const snap = await db.ref('phoneNumberIndex').once('value').catch(() => null);
  const index = snap?.val() || {};
  for (const [phoneNumberId, routing] of Object.entries(index)) {
    if (routing.businessId === resolveBusinessIdFor(outlet) && routing.outletId === outlet) {
      return phoneNumberId;
    }
  }
  return process.env.PHONE_NUMBER_ID || null;
}

function toPlainPhone(jid) {
  if (!jid) return null;
  return String(jid).split('@')[0];
}

// --- Meta cost (S1 shared credit liability) ---
// The recorder + spend guard live once in `bot/meta-cost.js` (socket-free, also
// vendored into Cloud Functions). The old in-file recorder called
// `resolveBusinessIdFor(outlet)` from module scope, where `outlet` does not
// exist: it threw on its first line inside its own catch and never wrote a
// single usage row. One implementation, two runners.

/**
 * Meta Cloud API transport. Returns an object shaped like a Baileys `sock` so
 * the rest of bot/index.js works unchanged: sendMessage, ev.on, readMessages,
 * sendPresenceUpdate, user, ws.
 */
function createMetaTransport({ outlet, phoneNumberId, accessToken, redisUrl }) {
  const events = {};
  let subscriber;
  let inboxRef = null;
  let inboxHandler = null;
  let started = false;
  const cost = createMetaCost({
    db,
    bid: resolveBusinessIdFor(outlet),
    oid: outlet,
    log: (...a) => console.warn(...a),
  });

  // An entry older than this is not worth replaying: Meta retries a webhook for
  // ~7 days, and a 6-hour-old "menu" tap has no value. Bounds queue catch-up.
  const MAX_INBOX_AGE_MS = 30 * 60 * 1000;

  /** Normalize a Cloud-API message into the Baileys upsert the bot understands.
   *  Shared by both inbound transports (RTDB queue and Redis pub/sub). */
  function dispatchInbound(msg) {
    try {
      if (!msg || !msg.from) return;
      const isText = !!msg.text?.body;
      const isLocation = msg.type === 'location' || !!msg.location;
      if (!isText && !isLocation) return;
      let message;
      if (isLocation) {
        const loc = msg.location || {};
        message = {
          locationMessage: {
            degreesLatitude: parseFloat(loc.latitude),
            degreesLongitude: parseFloat(loc.longitude)
          }
        };
        console.log(`[META-TRANSPORT] Inbound location from ${msg.from}: ${loc.latitude},${loc.longitude}`);
      } else {
        message = { conversation: String(msg.text.body) };
        console.log(`[META-TRANSPORT] Inbound from ${msg.from}: "${String(msg.text.body).slice(0, 60)}"`);
      }
      const upsert = {
        type: 'notify',
        messages: [{
          key: { remoteJid: formatJid(msg.from), id: msg.id || `${Date.now()}`, fromMe: false },
          message,
          pushName: msg.pushName || ''
        }]
      };
      if (events['messages.upsert']) events['messages.upsert'](upsert);
    } catch (e) {
      console.error('[META-TRANSPORT] Inbound processing error:', e.message);
    }
  }

  const sock = {
    ws: { isOpen: true, isClosed: false, isClosing: false },
    user: { id: `meta:${phoneNumberId}` },
    ev: {
      on(event, cb) {
        events[event] = cb;
      }
    },
    async sendMessage(jid, content = {}, opts) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      const text = content.text ?? content.caption ?? '';
      // Cost guard: stop before sending if caps/wallet block this send.
      if (await cost.guard(to)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
      if (content.image && typeof content.image === 'string' && content.image.startsWith('http')) {
        const result = await waSend.sendWhatsAppImage(phoneNumberId, accessToken, to, content.image, text);
        cost.record('utility').catch(() => {});
        return result;
      }
      if (content.image && content.image.url) {
        const result = await waSend.sendWhatsAppImage(phoneNumberId, accessToken, to, content.image.url, text);
        cost.record('utility').catch(() => {});
        return result;
      }
      if (content.image) {
        // Raw buffer/base64 cannot be sent via Meta API (needs hosted URL) — fall back to text
        console.warn(`[META-TRANSPORT] Image skipped (not a URL) for ${jid}; sending text fallback`);
      }
      const result = waSend.sendWhatsAppMessage(phoneNumberId, accessToken, to, text);
      // Record cost after a successful send — never delays the send itself.
      cost.record('utility').catch(() => {});
      return result;
    },
    // Interactive URL button (replaces plain links in chat). Falls back to plain text if Meta rejects.
    async sendButton(jid, opts) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      if (await cost.guard(to)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
      try {
        const result = await waSend.sendWhatsAppUrlButton(phoneNumberId, accessToken, to, opts);
        cost.record('utility').catch(() => {});
        return result;
      } catch (e) {
        console.warn(`[META-TRANSPORT] Button send failed for ${jid}: ${e.message}; sending text fallback`);
        const result = await waSend.sendWhatsAppMessage(phoneNumberId, accessToken, to, `${opts.body}\n------------------------\n${opts.url}`);
        cost.record('utility').catch(() => {});
        return result;
      }
    },
    // Approved-template send (the only kind of biz-initiated message Meta
    // delivers outside the 24h customer-service window).
    async sendTemplate(jid, opts = {}) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      // opts: { name, language, body?, components? } — callers that only pass
      // `body` (promo/SEND_GENERIC) need it mapped to the template's single
      // {{1}} BODY parameter; otherwise it was silently dropped and the
      // template's static text went out instead of the intended content.
      // A template with no variables rejects the extra parameter with code
      // 100 → caller's existing text fallback kicks in.
      let components = opts.components;
      if ((!components || !components.length) && opts.body) {
        components = [{ type: 'BODY', parameters: [{ type: 'text', text: String(opts.body) }] }];
      }
      // Cost guard: block before sendTemplate / sendMessage. The result carries
      // `blocked: true` so a caller can tell it was dropped (never a silent skip).
      // Marketing templates (by name) classify as MARKETING so paid promo sends
      // bill on the plan rate instead of being misclassified as UTILITY. Callers
      // may still pass opts.templateCategory for template names added after this
      // list is built, otherwise the allowlist is the only arbiter.
      const category = cost.categoryForTemplate(opts.name, opts.templateCategory);
      if (await cost.guard(to, category)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
      const result = await waSend.sendWhatsAppTemplate(phoneNumberId, accessToken, to, {
        name: opts.name,
        language: opts.language || 'en',
        components
      });
      cost.record(category).catch(() => {});
      return result;
    },
    async readMessages() { /* no-op: Meta API has no read receipts */ },
    async sendPresenceUpdate() { /* no-op: Meta API has no typing indicator */ },
    async start() {
      if (started) return sock;
      started = true;

      // ---- Inbound transport 1: RTDB queue (Firebase Functions webhook) ----
      // The function cannot reach Redis on EC2 (port 8443 is not open, and Redis
      // has no password), so it enqueues under the outlet and this listener
      // drains it. Admin-SDK writes bypass rules; nothing is publicly readable.
      try {
        inboxRef = db.ref(resolvePath('webhookInbox', outlet));
        inboxHandler = inboxRef.on('child_added', (snap) => {
          const entry = snap.val() || {};
          try {
            const age = Date.now() - Number(entry.receivedAt || 0);
            if (entry.receivedAt && age > MAX_INBOX_AGE_MS) {
              console.warn(`[META-TRANSPORT] Dropped stale inbox entry (${Math.round(age / 60000)} min old)`);
              return;
            }
            dispatchInbound(entry.message || entry);
          } finally {
            snap.ref.remove().catch(() => { });
          }
        }, (err) => console.error('[META-TRANSPORT] Inbox listener error:', err.message));
        console.log(`[META-TRANSPORT] Listening on RTDB webhookInbox for ${outlet}`);
      } catch (e) {
        console.error('[META-TRANSPORT] Could not attach RTDB inbox:', e.message);
      }

      // ---- Inbound transport 2: Redis pub/sub (EC2 webhook-server, pre-cutover) ----
      if (redisUrl) {
        try {
          const redis = require('redis');
          const businessId = resolveBusinessIdFor(outlet);
          const channel = `bot-inbox:${businessId}:${outlet}`;
          subscriber = redis.createClient({ url: redisUrl });
          await subscriber.connect();
          await subscriber.subscribe(channel, async (raw) => {
            let msg;
            try { msg = JSON.parse(raw); } catch { return; }
            dispatchInbound(msg);
          });
          console.log(`[META-TRANSPORT] Listening on Redis ${channel}`);
        } catch (e) {
          console.warn(`[META-TRANSPORT] Redis subscribe failed (RTDB inbox still active): ${e.message}`);
        }
      }

      if (events['connection.update']) events['connection.update']({ connection: 'open' });
      return sock;
    },
    async stop() {
      if (inboxRef && inboxHandler) {
        try { inboxRef.off('child_added', inboxHandler); } catch (_) { }
        inboxRef = null;
        inboxHandler = null;
      }
      if (subscriber) { try { await subscriber.quit(); } catch (_) {} subscriber = null; }
      started = false;
    }
  };

  return sock;
}

module.exports = { createMetaTransport, getTransportMode, getPhoneNumberId };
