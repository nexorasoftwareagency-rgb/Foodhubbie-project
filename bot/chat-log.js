'use strict';
/**
 * chat-log.js — WhatsApp conversation persistence for the Admin Chat tab.
 *
 * Writes every customer<->bot message under `chats/{customerId}/{meta,messages}`
 * (tenant-scoped via resolvePath). Best-effort ONLY: never throws, never blocks
 * the order flow — mirrors the G5 quota counter pattern (bot/index.js:1039).
 *
 * thread key = last-10-digits of the sender JID, same convention as
 * customers/{cleanPhone} and the promo opt-out keys, so a Baileys JID
 * (9197...@s.whatsapp.net) and a Meta `from` (9197...) map to one thread.
 * Caveat: last-10-digits drops the country code — a +1 and +91 customer
 * with the same local number would share a thread. Matches the existing
 * customers/{cleanPhone} convention; revisit only if non-IN numbers appear.
 */

const { db, resolvePath } = require('./firebase');

/** Last-10-digits thread key for a JID. */
function customerIdFromJid(jid) {
    if (!jid) return null;
    const digits = String(jid).replace(/[^0-9]/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Persist one message + bump the thread meta.
 * @param {object} o { outlet, jid, msgId, from: 'customer'|'bot', text, name? }
 */
async function logChatMessage(o) {
    try {
        const { outlet, jid, msgId, from, text, name } = o;
        if (!jid || !msgId || !from) return;
        const customerId = customerIdFromJid(jid);
        if (!customerId) return;
        const ts = Date.now();
        const cleanText = (text || '').trim() || '<media>';
        const base = resolvePath(`chats/${customerId}`, outlet);
        // Message record (idempotent by msgId).
        await db.ref(`${base}/messages/${msgId}`).set({
            from, text: cleanText, ts, type: 'text'
        });
        // Thread meta — unread only counts customer->bot messages.
        await db.ref(`${base}/meta`).transaction((cur) => {
            const meta = cur || {};
            const next = {
                name: name || meta.name || '',
                phone: jid,
                lastTs: ts,
                lastText: cleanText,
                lastDir: from,
                unread: (meta.unread || 0) + (from === 'customer' ? 1 : 0)
            };
            return next;
        });
    } catch (err) {
        // Best-effort — chat persistence must never break the order flow.
        console.warn(`[CHAT-LOG] write failed (best-effort): ${err.message || err}`);
    }
}

module.exports = { logChatMessage, customerIdFromJid };