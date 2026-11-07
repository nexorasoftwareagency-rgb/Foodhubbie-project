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
const { canSend } = require('../shared/meta-cost-math');

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
      // Cost guard: stop before sending if caps/wallet block this send.
      if (await _metaCostGuard(to)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
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
      if (await _metaCostGuard(to)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
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
      const category = (opts.templateCategory || 'utility');
      if (await _metaCostGuard(to, category)) {
        return { key: { id: 'blocked' }, blocked: true };
      }
      return waSend.sendWhatsAppTemplate(phoneNumberId, accessToken, to, {
        name: opts.name,
        language: opts.language || 'en',
        components
      });
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

  // --- Meta cost guard (S1 shared credit liability) ---
  // Armed ONLY when the billing node carries a numeric `balancePaise` snapshot.
  // `walletBilling/{bid}/{oid}` is a payments/charges ledger, not a stored
  // balance, so a missing snapshot must mean "not armed" — reading it as 0
  // would block every send. The emitter that writes balancePaise/metaUsage
  // lands with the S1 shared-credit work.
  // ponytail: one read per outbound message on the meta transport; upgrade to
  // a cached balance when the writer exists.
  async function _metaCostGuard(to, category = 'utility') {
    try {
      const businessId = resolveBusinessIdFor(outlet);
      const path = `walletBilling/${businessId}/${outlet}`;
      const billing = (await db.ref(path).once('value')).val() || {};
      const balancePaise = Number(billing.balancePaise);
      if (!Number.isFinite(balancePaise)) return false;
      const metaUsage = billing.metaUsage || {};
      const messageCaps = billing.messageCaps || { monthlyPaise: 500000 }; // default ₹5,000/mo
      const thresholdPaise = Number(billing.metaSpendThresholdPaise) || 10000;
      const blocked = !canSend({
        metaUsage,
        messageCaps,
        metaSpendThresholdPaise: thresholdPaise,
        currentWalletBalancePaise: balancePaise,
        category
      });
      if (blocked) {
        console.warn(`[META-COST-GUARD] Blocked ${category} to ${to} — balance ${balancePaise}p < ${thresholdPaise}p or cap hit`);
        // Log for admin visibility (never exposed to the customer).
        await db.ref(`${path}/blocked`).push({
          to,
          category,
          walletBalancePaise: balancePaise,
          thresholdPaise,
          metaUsage,
          at: new Date().toISOString()
        }).catch(() => {});
      }
      return blocked;
    } catch (e) {
      // Fails open: never block on cost-guard error
      console.warn('[META-COST-GUARD] Error (fails open):', e.message);
      return false;
    }
  }

  return sock;
}

module.exports = { createMetaTransport, getTransportMode, getPhoneNumberId };
