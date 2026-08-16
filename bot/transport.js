/**
 * WHATSAPP BOT TRANSPORT LAYER
 * Two interchangeable transports behind the same Baileys-style `sock` interface:
 *  - 'baileys' : WhatsApp Web (real phone number, QR pairing)
 *  - 'meta'    : Meta WhatsApp Cloud API (webhook receive via Redis, send via Graph API)
 * ONLY ONE transport is active per outlet at a time. Mode is set in Firebase
 * `bot/{outlet}/transport` (Supreme Admin control) or env BOT_TRANSPORT.
 */
const { formatJid } = require('./utils');
const waSend = require('./whatsapp-send');
const { db, getData, resolvePath } = require('./firebase');
const { resolveBusinessIdFor } = require('./helpers/outlet-resolution');

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

/**
 * Meta Cloud API transport. Returns an object shaped like a Baileys `sock` so
 * the rest of bot/index.js works unchanged: sendMessage, ev.on, readMessages,
 * sendPresenceUpdate, user, ws.
 */
function createMetaTransport({ outlet, phoneNumberId, accessToken, redisUrl }) {
  const events = {};
  let subscriber;
  let started = false;

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
      if (content.image && typeof content.image === 'string' && content.image.startsWith('http')) {
        return waSend.sendWhatsAppImage(phoneNumberId, accessToken, to, content.image, text);
      }
      if (content.image && content.image.url) {
        return waSend.sendWhatsAppImage(phoneNumberId, accessToken, to, content.image.url, text);
      }
      if (content.image) {
        // Raw buffer/base64 cannot be sent via Meta API (needs hosted URL) — fall back to text
        console.warn(`[META-TRANSPORT] Image skipped (not a URL) for ${jid}; sending text fallback`);
      }
      return waSend.sendWhatsAppMessage(phoneNumberId, accessToken, to, text);
    },
    // Interactive URL button (replaces plain links in chat). Falls back to plain text if Meta rejects.
    async sendButton(jid, opts) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      try {
        return await waSend.sendWhatsAppUrlButton(phoneNumberId, accessToken, to, opts);
      } catch (e) {
        console.warn(`[META-TRANSPORT] Button send failed for ${jid}: ${e.message}; sending text fallback`);
        return waSend.sendWhatsAppMessage(phoneNumberId, accessToken, to, `${opts.body}\n------------------------\n${opts.url}`);
      }
    },
    // Approved-template send (the only kind of biz-initiated message Meta
    // delivers outside the 24h customer-service window).
    async sendTemplate(jid, opts = {}) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      return waSend.sendWhatsAppTemplate(phoneNumberId, accessToken, to, opts);
    },
    async readMessages() { /* no-op: Meta API has no read receipts */ },
    async sendPresenceUpdate() { /* no-op: Meta API has no typing indicator */ },
    async start() {
      if (started) return sock;
      started = true;
      const redis = require('redis');
      subscriber = redis.createClient({ url: redisUrl });
      const businessId = resolveBusinessIdFor(outlet);
      const channel = `bot-inbox:${businessId}:${outlet}`;
      await subscriber.connect();
      await subscriber.subscribe(channel, async (raw) => {
        try {
          const msg = JSON.parse(raw);
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
            console.log(`[META-TRANSPORT] Inbound location on ${channel} from ${msg.from}: ${loc.latitude},${loc.longitude}`);
          } else {
            message = { conversation: String(msg.text.body) };
            console.log(`[META-TRANSPORT] Inbound on ${channel} from ${msg.from}: "${String(msg.text.body).slice(0, 60)}"`);
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
      });
      console.log(`[META-TRANSPORT] Listening on Redis ${channel}`);
      if (events['connection.update']) events['connection.update']({ connection: 'open' });
      return sock;
    },
    async stop() {
      if (subscriber) { try { await subscriber.quit(); } catch (_) {} subscriber = null; }
      started = false;
    }
  };
  return sock;
}

module.exports = { createMetaTransport, getTransportMode, getPhoneNumberId };
