'use strict';
/**
 * bot/chat-log-core.js — socket-free WhatsApp conversation persistence.
 *
 * Extracted from `bot/chat-log.js` (batch 23: inbound on Functions) so the
 * WhatsApp bot and Cloud Functions write the Admin Chat tab with the same bytes.
 * `bot/chat-log.js` is now a 15-line binding that supplies `./firebase`, so
 * `bot/index.js` is untouched.
 *
 * Writes every customer<->bot message under `chats/{customerId}/{meta,messages}`
 * and mirrors the thread row to `chatMeta/{customerId}` (the flat node the Admin
 * Chat LIST queries — reading `chats` instead drags every message body along).
 *
 * Best-effort ONLY: never throws, never blocks the order flow.
 *
 * thread key = last-10-digits of the sender JID, same convention as
 * customers/{cleanPhone} and the promo opt-out keys, so a Baileys JID
 * (9197...@s.whatsapp.net) and a Meta `from` (9197...) map to one thread.
 * Caveat: last-10-digits drops the country code — a +1 and +91 customer with the
 * same local number would share a thread. Matches the existing
 * customers/{cleanPhone} convention; revisit only if non-IN numbers appear.
 */

/** Last-10-digits thread key for a JID. */
function customerIdFromJid(jid) {
  if (!jid) return null;
  const digits = String(jid).replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * @param {Object}   o
 * @param {Object}   o.db          firebase-admin Database (`.ref(path)`)
 * @param {Function} o.resolvePath ALREADY tenant-bound: (path) => full path
 * @param {Function}[o.now]        () => ms
 * @param {Function}[o.log]        (...args) => void
 */
function createChatLog({ db, resolvePath, now = () => Date.now(), log = () => {} } = {}) {
  if (!db || typeof db.ref !== 'function') throw new Error('createChatLog: db is required');
  if (typeof resolvePath !== 'function') throw new Error('createChatLog: resolvePath is required');

  /**
   * Persist one message + bump the thread meta.
   * @param {object} o { jid, msgId, from: 'customer'|'bot', text, name? }
   */
  async function logChatMessage(o) {
    try {
      const { jid, msgId, from, text, name } = o || {};
      if (!jid || !msgId || !from) return;
      const customerId = customerIdFromJid(jid);
      if (!customerId) return;
      const ts = now();
      const cleanText = (text || '').trim() || '<media>';
      const base = resolvePath(`chats/${customerId}`);
      // Meta message IDs are `wamid.XXX` — Firebase keys can't contain ".".
      // Replace dots (and other reserved chars) with "_" so the key stays valid.
      const safeMsgId = String(msgId).replace(/[.#$\[\]]/g, '_');
      // Message record (idempotent by msgId).
      await db.ref(`${base}/messages/${safeMsgId}`).set({ from, text: cleanText, ts, type: 'text' });
      // Thread meta — unread only counts customer->bot messages.
      const applied = await db.ref(`${base}/meta`).transaction((cur) => {
        const meta = cur || {};
        return {
          name: name || meta.name || '',
          phone: jid,
          lastTs: ts,
          lastText: cleanText,
          lastDir: from,
          unread: (meta.unread || 0) + (from === 'customer' ? 1 : 0),
        };
      });
      // Flat meta mirror. `chats/{id}/meta` keeps being written for cached
      // older Admin shells; the list itself reads this node.
      const mirrored = applied && applied.snapshot ? applied.snapshot.val() : null;
      if (mirrored) await db.ref(resolvePath(`chatMeta/${customerId}`)).set(mirrored);
    } catch (err) {
      // Best-effort — chat persistence must never break the order flow.
      log(`[CHAT-LOG] write failed (best-effort): ${(err && err.message) || err}`);
    }
  }

  return { logChatMessage };
}

module.exports = { createChatLog, customerIdFromJid };
