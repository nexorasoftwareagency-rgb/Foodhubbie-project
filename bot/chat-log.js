'use strict';
/**
 * chat-log.js — WhatsApp conversation persistence for the Admin Chat tab.
 *
 * The writer itself is `bot/chat-log-core.js` (socket-free, shared byte-for-byte
 * with Cloud Functions since the inbound handler moved there). This file only
 * binds the bot process's own database handle, which is NOT vendorable
 * (`./firebase` loads a service-account file).
 *
 * Writes every customer<->bot message under `chats/{customerId}/{meta,messages}`
 * (tenant-scoped via resolvePath) plus the flat `chatMeta/{customerId}` mirror.
 * Best-effort ONLY: never throws, never blocks the order flow.
 */

const { db, resolvePath } = require('./firebase');
const { createChatLog, customerIdFromJid } = require('./chat-log-core');

/** @param {object} o { outlet, jid, msgId, from: 'customer'|'bot', text, name? } */
function logChatMessage(o) {
  const outlet = (o && o.outlet) || 'pizza';
  return createChatLog({
    db,
    resolvePath: (p) => resolvePath(p, outlet),
    log: (...a) => console.warn(...a),
  }).logChatMessage(o);
}

module.exports = { logChatMessage, customerIdFromJid };
