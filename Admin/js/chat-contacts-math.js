/**
 * chat-contacts-math.js — the PURE core of the Admin Chat tab's contact
 * management. No Firebase, no DOM: everything here is testable in Node.
 *
 *   normalizePhone  — the canonical form of a phone number. This decides
 *                     whether the bot's isBlockedJid() actually matches, so
 *                     it is security-relevant, not cosmetic.
 *   replyWindow     — WhatsApp's 24h customer-service window, derived from
 *                     the messages of a thread. It is the COST guard: outside
 *                     the window a free-form reply is billed as a service
 *                     message (and rejected on the official WhatsApp API).
 *   labelId         — a label's storage key.
 *
 * The I/O half lives in Admin/js/chat-contacts.js.
 */

/** WhatsApp Business caps a business at 20 labels. */
export const MAX_LABELS = 20;

/** A customer message opens a 24h window for free-form replies. */
export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical phone form: digits only.
 * A 10-digit local number becomes 91XXXXXXXXXX; anything else keeps its
 * digits. This is the form the bot's isBlockedJid() actually matches — it
 * strips the JID to digits and compares with `phone.endsWith(entry)`.
 */
export function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    return d;
}

/**
 * The 24h customer-service window of a thread.
 * The window opens on a CUSTOMER message and closes 24h later. A reply from
 * the restaurant does NOT extend it — only the customer can reopen it.
 * @param {Array<{from:string,ts:number}>} messages
 * @param {number} now
 * @returns {{open:boolean, expiresAt:number, unknown:boolean, lastCustomerTs:number}}
 */
export function replyWindow(messages, now = Date.now()) {
    let lastCustomerTs = 0;
    for (const m of (messages || [])) {
        if (!m) continue;
        if (m.from === 'customer' && Number(m.ts || 0) > lastCustomerTs) lastCustomerTs = Number(m.ts || 0);
    }
    if (!lastCustomerTs) return { open: false, expiresAt: 0, unknown: true, lastCustomerTs: 0 };
    const expiresAt = lastCustomerTs + CUSTOMER_WINDOW_MS;
    return { open: now < expiresAt, expiresAt, unknown: false, lastCustomerTs };
}

/** Short human label for the window badge. */
export function windowLabel(win, now = Date.now()) {
    if (!win || win.unknown) return 'Reply window unknown';
    if (win.open) {
        const left = Math.max(0, win.expiresAt - now);
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        return `Reply window · ${h}h ${m}m left`;
    }
    return 'Reply window closed';
}

/**
 * A label's storage key: lowercase, hyphenated, max 24 chars. Never a
 * customer id or a phone number — labels are a separate namespace.
 */
export function labelId(name, existing) {
    const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'label';
    let id = base;
    let n = 2;
    while (existing && existing[id]) id = `${base}-${n++}`;
    return id;
}

/**
 * Drop one label from every thread that carries it.
 * Pure: returns the threads that need a write, with the label removed.
 * (Deleting a label used to read the thread state from a callback variable
 * that was out of scope in the write loop — a ReferenceError at delete time.
 * The mapping lives here so it is testable and cannot drift.)
 */
export function stripLabelFromState(stateMap, id) {
    const out = {};
    for (const [cid, st] of Object.entries(stateMap || {})) {
        const labels = (st && st.labels) || [];
        if (!labels.includes(id)) continue;
        out[cid] = { ...st, labels: labels.filter(x => x !== id) };
    }
    return out;
}
