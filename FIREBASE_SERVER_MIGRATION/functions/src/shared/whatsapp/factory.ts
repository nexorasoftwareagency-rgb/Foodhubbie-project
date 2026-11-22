/**
 * Batch 23m — the Functions-side WhatsApp runtime.
 *
 * The product logic is NOT here. It lives in three socket-free bot modules,
 * copied byte-for-byte into `lib/vendor/` by `scripts/copy-vendor.cjs`:
 *
 *   bot/inbound-flow.js   the inbound state machine (START -> AWAITING_ORDER_INTENT
 *                         -> WEBVIEW), opt-out/opt-in, auto-rejection, strikes +
 *                         freeze, rate limit, dedupe, webview token minting.
 *   bot/whatsapp-send.js  the pure `fetch` Graph senders.
 *   bot/meta-cost.js      the send-cost recorder + spend guard.
 *   bot/chat-log-core.js  the Admin Chat tab writer.
 *
 * This file only supplies what a request-scoped runtime must add:
 *
 *   - a sock-shaped transport (the flow calls `sendMessage`/`sendButton`/`user`)
 *     built over `whatsapp-send.js`, because `bot/transport.js` hard-requires
 *     `./firebase`, `./whatsapp-send` and `./helpers/outlet-resolution` and its
 *     `start()` attaches an RTDB listener + a Redis subscriber;
 *   - the tenant, pinned from the AVENUE PATH (`businesses/{bid}/outlets/{oid}`
 *     of the message being handled), never from a reverse-index guess — the e2e
 *     business holds an outlet literally named `pizza`;
 *   - the per-tenant credentials from the outlet's own `whatsapp` node plus the
 *     platform system-user token.
 *
 * `WA_PERMANENT_TOKEN` is bound as an env var by the function's `secrets` list,
 * so no Secret Manager round-trip happens per message.
 */

import * as path from 'path';
import { getDB } from '../firebase/admin';

/* eslint-disable @typescript-eslint/no-var-requires */
const VENDOR = path.join(__dirname, '../../vendor');
const { createInboundFlow } = require(path.join(VENDOR, 'bot/inbound-flow.js'));
const { createMetaCost } = require(path.join(VENDOR, 'bot/meta-cost.js'));
const { createChatLog } = require(path.join(VENDOR, 'bot/chat-log-core.js'));
const waSend = require(path.join(VENDOR, 'bot/whatsapp-send.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

/** The customer app / delivery webview host. Same default the bot ships. */
const WEBVIEW_HOST = 'https://menu.foodhubbie.in';
/** The platform developer number — never struck, exempt from the promo freeze. */
const DEVELOPER_NUMBER = '9724649971';

type Log = (...args: any[]) => void;

export interface MetaTransportOptions {
  bid: string;
  oid: string;
  phoneNumberId: string;
  accessToken: string;
  log?: Log;
}

/**
 * A `sock`-shaped object over the Cloud API. Only the members the inbound flow
 * (and the future promo scheduler) actually call are implemented; `ev.on` is a
 * collector because nothing on Functions pushes into it.
 *
 * Send behaviour is deliberately identical to `bot/transport.js`:
 *   - text loses nothing, image falls back to text when the URL is not http(s);
 *   - a URL button falls back to `body + url` text so a Meta rejection never
 *     leaves the customer with silence;
 *   - a template maps `body` to the single `{{1}}` BODY parameter and bills
 *     MARKETING by name.
 */
export function makeMetaTransport(o: MetaTransportOptions) {
  const { bid, oid, phoneNumberId, accessToken } = o;
  const log: Log = o.log || ((...a: any[]) => console.warn(...a));
  const db = getDB();
  const cost = createMetaCost({ db, bid, oid, log });
  const events: Record<string, Function> = {};

  /** `9197...@s.whatsapp.net` -> `9197...`; the Graph API takes digits only. */
  const toPlainPhone = (jid: any) => String(jid || '').split('@')[0] || null;

  const sock = {
    // meta:<id> is an id, not a phone number — `bot/inbound-flow.js` regexes a
    // Baileys `<phone>:<device>@s.whatsapp.net` and falls back to the configured
    // bot number, which is what "Back to WhatsApp" in the webview needs.
    user: { id: `meta:${phoneNumberId}` },
    ws: { isOpen: true, isClosed: false, isClosing: false },
    ev: {
      on(event: string, cb: Function) {
        events[event] = cb;
      },
    },

    async sendMessage(jid: any, content: any = {}) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      const text = content.text ?? content.caption ?? '';
      if (await cost.guard(to)) return { key: { id: 'blocked' }, blocked: true };
      const imageUrl =
        typeof content.image === 'string' && content.image.startsWith('http')
          ? content.image
          : content.image && content.image.url;
      if (imageUrl) {
        const result = await waSend.sendWhatsAppImage(phoneNumberId, accessToken, to, imageUrl, text);
        cost.record('utility').catch(() => {});
        return result;
      }
      if (content.image) {
        // Raw buffer/base64 cannot be sent over the Cloud API (it needs a hosted
        // URL). Since batch 15 every live image IS a Storage URL, so this is a
        // degraded-input path only — say the words instead of dropping them.
        log('[META] image skipped (not a URL); sending text fallback');
      }
      const result = await waSend.sendWhatsAppMessage(phoneNumberId, accessToken, to, text);
      cost.record('utility').catch(() => {});
      return result;
    },

    async sendButton(jid: any, opts: any) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      if (await cost.guard(to)) return { key: { id: 'blocked' }, blocked: true };
      try {
        const result = await waSend.sendWhatsAppUrlButton(phoneNumberId, accessToken, to, opts);
        cost.record('utility').catch(() => {});
        return result;
      } catch (e: any) {
        log(`[META] button send failed (${e && e.message}); text fallback`);
        const result = await waSend.sendWhatsAppMessage(
          phoneNumberId,
          accessToken,
          to,
          `${opts.body}\n------------------------\n${opts.url}`,
        );
        cost.record('utility').catch(() => {});
        return result;
      }
    },

    async sendTemplate(jid: any, opts: any = {}) {
      const to = toPlainPhone(jid);
      if (!to) throw new Error(`Invalid JID: ${jid}`);
      let components = opts.components;
      if ((!components || !components.length) && opts.body) {
        components = [{ type: 'BODY', parameters: [{ type: 'text', text: String(opts.body) }] }];
      }
      const category = cost.categoryForTemplate(opts.name, opts.templateCategory);
      if (await cost.guard(to, category)) return { key: { id: 'blocked' }, blocked: true };
      const result = await waSend.sendWhatsAppTemplate(phoneNumberId, accessToken, to, {
        name: opts.name,
        language: opts.language || 'en',
        components,
      });
      cost.record(category).catch(() => {});
      return result;
    },

    /* The Cloud API has no read receipts and no typing indicator. */
    async readMessages() {},
    async sendPresenceUpdate() {},
  };

  return sock;
}

/**
 * Resolve ONE tenant's Cloud API credentials from its own `whatsapp` node.
 * Throws when the outlet has no number connected or the platform token is
 * missing — a half-configured tenant must never send from another's number.
 */
async function tenantCredentials(bid: string, oid: string) {
  const db = getDB();
  const waSnap = await db.ref(`businesses/${bid}/outlets/${oid}/whatsapp`).once('value');
  const wa = (waSnap && waSnap.val()) || {};
  const phoneNumberId = String(wa.phoneNumberId || '').trim();
  const accessToken = String(process.env.WA_PERMANENT_TOKEN || '').trim();
  if (!phoneNumberId) throw new Error(`whatsapp number not connected for ${bid}/${oid}`);
  if (!accessToken) throw new Error('WA_PERMANENT_TOKEN is not set');
  return { wa, phoneNumberId, accessToken };
}

export interface TenantTransportOptions {
  log?: Log;
}

/**
 * The tenant's Cloud API transport for OUTBOUND-ONLY callers (the admin
 * "new order" alert and the daily report). Same validation as the inbound
 * path, no state machine.
 */
export async function makeTenantTransport(bid: string, oid: string, opts: TenantTransportOptions = {}) {
  const log: Log = opts.log || ((...a: any[]) => console.log(...a));
  const { wa, phoneNumberId, accessToken } = await tenantCredentials(bid, oid);
  return { transport: makeMetaTransport({ bid, oid, phoneNumberId, accessToken, log }), whatsapp: wa };
}

/**
 * Who a platform WhatsApp alert goes to, in the bot's own order
 * (`bot/index.js getReportRecipients`): the developer number first, then the
 * outlet's own report contact — `settings/Delivery/reportPhone`, falling back
 * to `settings/Store.phone` (live pizza has neither `phone`; it keeps the
 * number in `whatsappNumber`). Digits only, deduped, and the developer entry
 * survives even when the store has no contact on file.
 */
export async function tenantAlertRecipients(bid: string, oid: string): Promise<string[]> {
  const db = getDB();
  const [storeSnap, deliverySnap] = await Promise.all([
    db.ref(`businesses/${bid}/outlets/${oid}/settings/Store`).once('value').catch(() => null),
    db.ref(`businesses/${bid}/outlets/${oid}/settings/Delivery`).once('value').catch(() => null),
  ]);
  const store = (storeSnap && storeSnap.val()) || {};
  const delivery = (deliverySnap && deliverySnap.val()) || {};
  const digits = (v: any) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length >= 10 && d.length <= 15 ? d : '';
  };
  const out: string[] = [];
  const push = (v: any) => {
    const d = digits(v);
    if (d && !out.includes(d)) out.push(d);
  };
  push(DEVELOPER_NUMBER);
  push(delivery.reportPhone);
  push(store.phone);
  push(store.whatsappNumber);
  return out;
}

export interface InboundFlowOptions {
  log?: Log;
  now?: () => number;
}

/**
 * Build the inbound flow for ONE tenant. Throws when the outlet has no WhatsApp
 * number connected (`whatsapp` node absent/incomplete) or the platform token is
 * missing — the caller drops the message and logs; a half-configured tenant must
 * never send from the wrong number.
 */
export async function makeInboundFlow(bid: string, oid: string, opts: InboundFlowOptions = {}) {
  const db = getDB();
  const log: Log = opts.log || ((...a: any[]) => console.log(...a));
  /**
   * Same rule as `bot/firebase.js resolvePath`: the four platform-level nodes
   * stay at the root, everything else is tenant-scoped. Get this wrong and the
   * greeting reads a profile that does not exist (or writes a webview token to a
   * phantom node) while every other check still passes.
   */
  const ROOT_NODES = ['admins', 'migrationStatus', 'logs', 'phoneNumberIndex'];
  const resolvePath = (p: string) => {
    const clean = String(p || '');
    const root = clean.split('/')[0];
    if (root === 'businesses' || ROOT_NODES.includes(root)) return clean;
    return `businesses/${bid}/outlets/${oid}/${clean}`;
  };

  const [creds, storeSnap] = await Promise.all([
    tenantCredentials(bid, oid),
    db.ref(resolvePath('settings/Store')).once('value').catch(() => null),
  ]);
  const { wa, phoneNumberId, accessToken } = creds;
  const store = (storeSnap && storeSnap.val()) || {};

  const transport = makeMetaTransport({ bid, oid, phoneNumberId, accessToken, log });
  const chatLog = createChatLog({ db, resolvePath, now: opts.now, log });

  const flow = createInboundFlow({
    db,
    resolvePath,
    outlet: oid,
    businessId: bid,
    transport,
    outletName: String(store.storeName || store.name || ''),
    webviewHost: WEBVIEW_HOST,
    // `displayPhoneNumber` is `+91 74850 95436`; the flow strips non-digits.
    botPhone: String(wa.displayPhoneNumber || ''),
    developerNumber: DEVELOPER_NUMBER,
    chatLog: chatLog.logChatMessage,
    now: opts.now,
    log,
  });

  return { flow, transport, chatLog, whatsapp: wa };
}
