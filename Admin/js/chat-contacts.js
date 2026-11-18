/**
 * chat-contacts.js — WhatsApp-style CONTACT MANAGEMENT for the Admin Chat tab.
 * ============================================================================
 * One owner for the three pieces of per-customer state the Chat tab needs and
 * the bot must agree with:
 *
 *   1. BLOCK LIST  → outlets/{oid}/settings/Bot/blockedNumbers
 *   2. LABELS      → outlets/{oid}/chatLabels/{labelId}      (max 20, like WhatsApp Business)
 *   3. THREAD STATE→ outlets/{oid}/chatState/{customerId}    { labels: [...], archived: bool }
 *
 * WHY A SEPARATE `chatState` NODE
 * The bot writes `chatMeta/{id}` with .set() (bot/chat-log.js) — a FULL
 * overwrite of the six meta fields. Anything the Admin stores inside chatMeta
 * is therefore wiped by the next inbound message. Per-thread Admin state has
 * to live outside chatMeta or it cannot survive a conversation.
 *
 * WHY THE BLOCK LIST IS NORMALISED TO DIGITS
 * The bot matches a sender with isBlockedJid() (bot/utils.js): it strips the
 * JID to digits and compares with `phone.endsWith(blockedEntry)`. The Chat
 * tab used to store the raw JID ("919725xxx@s.whatsapp.net") — which the bot
 * NEVER matches, so blocking a customer from the Chat tab silently did
 * nothing. The Settings tab stores bare digits, which is what the bot
 * honours. One canonical form now: digits only.
 *
 * WHY THIS IS A SEPARATE MODULE
 * `Admin/js/features/settings.js` is LAZILY imported (only when the Settings
 * tab opens), but the Chat tab read its block list through
 * `window.__blockedNumbers`. Until the admin visited Settings at least once,
 * that global was undefined → Block Contact threw a TypeError and did
 * nothing, and the Blocked Contacts modal was always empty. This module is
 * imported by the Chat tab directly, so the Chat tab owns its own data.
 * ============================================================================
 */

import { Outlet, get, set, update, remove, onValue, serverTimestamp } from './firebase.js';
import { MAX_LABELS, normalizePhone, labelId, stripLabelFromState } from './chat-contacts-math.js';

export { MAX_LABELS, normalizePhone, labelId };

/** Palette for auto-assigned label colours (admin can still rename a label). */
export const LABEL_COLORS = [
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
];

// ---------------------------------------------------------------------------
// Block list
// ---------------------------------------------------------------------------
const _block = { list: [], outlet: null, unsub: null, listeners: new Set() };

export const blockedContacts = {
    /** Canonical digits of every blocked contact. */
    get list() { return _block.list; },

    /** Is this contact blocked? Accepts a JID, a phone, anything. */
    isBlocked(raw) {
        const d = normalizePhone(raw);
        return !!d && _block.list.includes(d);
    },

    /** Subscribe to block-list changes (returns an unsubscribe fn). */
    subscribe(fn) {
        _block.listeners.add(fn);
        ensureSubscriptions();
        try { fn(_block.list); } catch (e) { console.error('[ChatContacts] block listener threw', e); }
        return () => _block.listeners.delete(fn);
    },

    /** Block a contact. Returns true when the list changed. */
    async block(raw) {
        const d = normalizePhone(raw);
        if (!d) return false;
        if (_block.list.includes(d)) return false;
        const next = [..._block.list, d];
        await set(Outlet.ref('settings/Bot/blockedNumbers'), next);
        _applyBlock(next);
        return true;
    },

    /** Unblock a contact. Returns true when the list changed. */
    async unblock(raw) {
        const d = normalizePhone(raw);
        const idx = _block.list.indexOf(d);
        if (idx === -1) return false;
        const next = _block.list.filter(x => x !== d);
        await set(Outlet.ref('settings/Bot/blockedNumbers'), next.length ? next : null);
        _applyBlock(next);
        return true;
    },
};

function _applyBlock(rawList) {
    const list = Array.isArray(rawList) ? rawList.map(normalizePhone).filter(Boolean) : [];
    // De-duplicate — a JID and its digits could both be in the legacy list.
    const unique = [...new Set(list)];
    const changed = unique.length !== _block.list.length || unique.some((v, i) => v !== _block.list[i]);
    _block.list = unique;
    if (changed) _block.listeners.forEach(fn => { try { fn(unique); } catch (e) { console.error(e); } });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
const _labels = { all: {}, outlet: null, unsub: null, listeners: new Set() };

export const chatLabels = {
    /** { id: { name, color, createdAt } } */
    get all() { return _labels.all; },
    get count() { return Object.keys(_labels.all).length; },

    subscribe(fn) {
        _labels.listeners.add(fn);
        ensureSubscriptions();
        try { fn(_labels.all); } catch (e) { console.error('[ChatContacts] label listener threw', e); }
        return () => _labels.listeners.delete(fn);
    },

    /** Create a label. Returns its id, or null when the cap is reached. */
    async create(name, color) {
        const clean = String(name || '').trim().slice(0, 24);
        if (!clean) return null;
        if (Object.keys(_labels.all).length >= MAX_LABELS) {
            throw new Error(`You can have up to ${MAX_LABELS} labels.`);
        }
        const id = labelId(clean, _labels.all);
        const doc = {
            name: clean,
            color: color || LABEL_COLORS[Object.keys(_labels.all).length % LABEL_COLORS.length],
            createdAt: serverTimestamp()
        };
        await set(Outlet.ref(`chatLabels/${id}`), doc);
        return id;
    },

    /** Rename a label (and optionally recolour it). */
    async rename(id, name, color) {
        const clean = String(name || '').trim().slice(0, 24);
        if (!id || !clean) return false;
        const patch = { name: clean };
        if (color) patch.color = color;
        await update(Outlet.ref(`chatLabels/${id}`), patch);
        return true;
    },

    /** Delete a label and strip it from every thread that carried it. */
    async remove(id) {
        if (!id) return false;
        // ORDER MATTERS: the rules require an assigned label to still exist in
        // the library (chatState/labels/$labelId → chatLabels/$labelId). The
        // threads must therefore be cleaned BEFORE the library entry goes.
        const affected = stripLabelFromState(_state.all, id);
        for (const [cid, st] of Object.entries(affected)) {
            await update(Outlet.ref(`chatState/${cid}`), { labels: _labelsToMap(st.labels) });
        }
        await remove(Outlet.ref(`chatLabels/${id}`));
        return true;
    },
};

// ---------------------------------------------------------------------------
// Per-thread state (labels + archive)
// ---------------------------------------------------------------------------
const _state = { all: {}, outlet: null, unsub: null, listeners: new Set() };

/**
 * STORAGE SHAPE of a thread's labels: a MAP { labelId: true }, not an array.
 *
 * Why: Realtime Database rules have no array helper (no isArray, no size, no
 * hasOnly) — so an array's length cannot be bounded by the rules at all. With
 * a map, every label id is a rules path and can be validated individually:
 *
 *   chatState/$cid/labels/$labelId → newData.isBoolean()
 *                                     && chatLabels/$labelId.exists()
 *
 * That is a real integrity guarantee (a thread cannot carry a label that does
 * not exist in the library) instead of an unenforceable length check.
 * The in-memory shape stays a plain array — the UI works with a list.
 */
function _labelsToMap(ids) {
    const map = {};
    for (const id of (ids || [])) if (id) map[id] = true;
    return map;
}

/** Read the stored map (or a legacy array) as a list of label ids. */
function _labelsFromMap(raw) {
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (raw && typeof raw === 'object') return Object.keys(raw).filter(k => raw[k]);
    return [];
}

/** Normalise one thread's stored state into the in-memory shape. */
function _normalizeState(raw) {
    const out = {};
    for (const [cid, st] of Object.entries(raw || {})) {
        if (!st || typeof st !== 'object') continue;
        out[cid] = { labels: _labelsFromMap(st.labels), archived: st.archived === true };
    }
    return out;
}

export const chatState = {
    /** { customerId: { labels: string[], archived: boolean } } */
    get all() { return _state.all; },

    /** State of one thread (never null). */
    of(customerId) {
        return _state.all[customerId] || { labels: [], archived: false };
    },

    subscribe(fn) {
        _state.listeners.add(fn);
        ensureSubscriptions();
        try { fn(_state.all); } catch (e) { console.error('[ChatContacts] state listener threw', e); }
        return () => _state.listeners.delete(fn);
    },

    /** Replace the label set of a thread. */
    async setLabels(customerId, labelIds) {
        if (!customerId) return false;
        const labels = [...new Set((labelIds || []).filter(Boolean))].slice(0, MAX_LABELS);
        await set(Outlet.ref(`chatState/${customerId}`), {
            labels: _labelsToMap(labels),
            archived: this.of(customerId).archived === true
        });
        return true;
    },

    /** Toggle the label set of a thread (add/remove one label). */
    async toggleLabel(customerId, labelId) {
        const cur = this.of(customerId).labels || [];
        const next = cur.includes(labelId) ? cur.filter(x => x !== labelId) : [...cur, labelId];
        return this.setLabels(customerId, next);
    },

    /** Archive or unarchive a thread. Archived threads leave the main list. */
    async setArchived(customerId, archived) {
        if (!customerId) return false;
        await set(Outlet.ref(`chatState/${customerId}`), {
            labels: _labelsToMap(this.of(customerId).labels || []),
            archived: archived === true
        });
        return true;
    },
};

// ---------------------------------------------------------------------------
// Subscriptions — one per outlet, re-bound when the admin switches outlet
// ---------------------------------------------------------------------------
function _bindOutlet() {
    const outlet = Outlet.current;
    if (_block.outlet === outlet) return false;
    if (_block.unsub) { _block.unsub(); _block.unsub = null; }
    if (_labels.unsub) { _labels.unsub(); _labels.unsub = null; }
    if (_state.unsub) { _state.unsub(); _state.unsub = null; }
    _block.outlet = outlet;
    _labels.outlet = outlet;
    _state.outlet = outlet;
    _block.list = [];
    _labels.all = {};
    _state.all = {};

    _block.unsub = onValue(Outlet.ref('settings/Bot/blockedNumbers'), (snap) => {
        _applyBlock(snap.val());
    }, () => { _block.list = []; });

    _labels.unsub = onValue(Outlet.ref('chatLabels'), (snap) => {
        _labels.all = snap.val() || {};
        _labels.listeners.forEach(fn => { try { fn(_labels.all); } catch (e) { console.error(e); } });
    }, () => {});

    _state.unsub = onValue(Outlet.ref('chatState'), (snap) => {
        _state.all = _normalizeState(snap.val());
        _state.listeners.forEach(fn => { try { fn(_state.all); } catch (e) { console.error(e); } });
    }, () => {});
    return true;
}

/** Bind (or re-bind) the listeners. Safe to call on every tab visit. */
export function ensureSubscriptions() {
    _bindOutlet();
}

// ---------------------------------------------------------------------------
// One-shot read (used when the caller wants a value without a live listener)
// ---------------------------------------------------------------------------
export async function loadBlockedList() {
    try {
        const snap = await get(Outlet.ref('settings/Bot/blockedNumbers'));
        _applyBlock(snap.val());
    } catch (e) {
        console.warn('[ChatContacts] blocked list read failed', e);
        _applyBlock([]);
    }
    return _block.list;
}

/** Release every listener (tab cleanup). */
export function releaseSubscriptions() {
    if (_block.unsub) { _block.unsub(); _block.unsub = null; }
    if (_labels.unsub) { _labels.unsub(); _labels.unsub = null; }
    if (_state.unsub) { _state.unsub(); _state.unsub = null; }
    _block.listeners.clear();
    _labels.listeners.clear();
    _state.listeners.clear();
    _block.outlet = null;
    _labels.outlet = null;
    _state.outlet = null;
}
