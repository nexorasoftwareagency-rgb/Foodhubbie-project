/**
 * rider-push.js — the ONE rider FCM sender.
 *
 * The rider app registers a device token at `riders/{uid}/fcmToken`, and its
 * own `/sw.js` builds the notification (custom tag/vibrate + deep link). Every
 * payload here is therefore DATA-ONLY: adding a `notification` payload would
 * make the Firebase SDK auto-display an untagged popup AND call our handler.
 *
 * Batch 23h: this logic used to live inline in `bot/index.js` (a
 * `sendFCMToRider` function plus two copies of the email -> uid resolution
 * block). Cloud Functions now owns the pushes (RTDB triggers behind
 * `config/riderRelay/enabled`), so it is socket-free and dependency-injected
 * exactly like `order-finalizer.js` and `loyalty-engine.js`: the vendored copy
 * inside the deployed Functions bundle runs these same bytes, so the copy text
 * and the resolution rules cannot drift between the two senders.
 *
 * Never import Baileys, Redis, `bot/firebase` or `bot/index.js` here.
 */
'use strict';

/** Statuses that mean "the rider should come and collect it". */
const PICKUP_STATUSES = new Set(['ready', 'packed', 'cooked']);

const WHATSAPP_SUFFIXES = ['@s.whatsapp.net', '@g.us', '@broadcast'];

/** A WhatsApp JID is never a rider App user: it has no device token. */
function isWhatsAppJid(id) {
    return WHATSAPP_SUFFIXES.some((s) => String(id || '').includes(s));
}

/**
 * Order status -> rider event. `ready` covers the three pickup statuses the
 * bot always treated as one event; anything else is silent.
 */
function riderStatusEvent(status) {
    const s = String(status || '').toLowerCase();
    if (PICKUP_STATUSES.has(s)) return 'ready';
    if (s === 'cancelled') return 'cancelled';
    return '';
}

/**
 * The exact push copy. `displayId` is produced by `formatOrderId` at the call
 * site (the bot and the Functions bundle each own a copy of that helper), so
 * the two runners cannot format an order id differently.
 */
function riderPushCopy(event, ctx) {
    const display = `Order #${ctx.displayId}`;
    if (event === 'assigned') {
        return {
            title: 'New Order Assigned!',
            body: `${display} for ₹${ctx.total || 0} — Please check the app.`,
            data: { type: 'rider_assigned', url: '/active' },
        };
    }
    if (event === 'ready') {
        return { title: display, body: `${display} is ready for pickup!`, data: { type: 'status_change' } };
    }
    if (event === 'cancelled') {
        return { title: display, body: `${display} has been cancelled.`, data: { type: 'status_change' } };
    }
    return null;
}

/**
 * @param {object} deps
 * @param {object} deps.db                  firebase-admin style database (`.ref`)
 * @param {Function} deps.resolvePath       (path, outlet) -> tenant path
 * @param {Function} deps.getRiderByEmail   (email, outlet) -> rider|null
 * @param {Function} deps.isDeadPushCode    (code) -> boolean
 * @param {object} deps.messaging           FCM handle (`.send`)
 * @param {Function} deps.formatOrderId     (id) -> display id
 * @param {Function} [deps.log]             (message, meta) -> void
 */
function createRiderPush({ db, resolvePath, getRiderByEmail, isDeadPushCode, messaging, formatOrderId, log }) {
    if (!db || typeof resolvePath !== 'function' || typeof getRiderByEmail !== 'function' ||
        typeof isDeadPushCode !== 'function' || !messaging || typeof formatOrderId !== 'function') {
        throw new Error('createRiderPush: missing dependency');
    }
    const warn = typeof log === 'function' ? log : () => {};

    /**
     * `order.riderId` is either a Firebase UID (rider app) or the email the
     * admin picker stored. Emails are resolved to a UID through the outlet's
     * riders node; anything unresolvable is dropped instead of being used as an
     * RTDB key (an email contains `.`, which is not a legal key — the old code
     * threw inside the guarded send on every such assignment).
     */
    async function resolveRiderUid(riderId, outlet) {
        if (!riderId) return '';
        const id = String(riderId);
        if (!id.includes('@')) return id;
        if (isWhatsAppJid(id)) return '';
        const rider = await getRiderByEmail(id, outlet).catch(() => null);
        return (rider && rider.uid) || '';
    }

    /** Read the token and send one data-only push; prune a token FCM rejects. */
    async function send(riderId, payload, outlet) {
        const { title, body, data = {} } = payload || {};
        if (!riderId || isWhatsAppJid(riderId)) return { sent: false, reason: 'not-a-device-rider' };
        const tokenPath = `riders/${riderId}/fcmToken`;
        try {
            const snap = await db.ref(resolvePath(tokenPath, outlet)).once('value');
            const token = snap.val();
            if (!token) return { sent: false, reason: 'no-token', uid: riderId };
            await messaging.send({
                token,
                data: { ...data, title, body },
                android: { priority: 'high' },
                webpush: { headers: { Urgency: 'high' } },
            });
            return { sent: true, uid: riderId };
        } catch (e) {
            warn(`[FCM] sendFCMToRider error (rider ${riderId}): ${e && e.message}`, { riderId, code: e && e.code });
            // A token minted for another sender/VAPID key never recovers — clear
            // it so the rider app re-registers on next open instead of failing
            // forever.
            if (isDeadPushCode(e && e.code)) {
                await db.ref(resolvePath(tokenPath, outlet)).remove().catch(() => {});
                await db.ref(resolvePath(`riders/${riderId}/fcmTokenInvalidAt`, outlet)).set(Date.now()).catch(() => {});
                warn(`[FCM] Removed dead rider token for ${riderId} (${e && e.code}) — re-registers on next app open.`, { riderId });
            }
            return { sent: false, reason: 'fcm-error', uid: riderId, code: (e && e.code) || '' };
        }
    }

    /**
     * Resolve + build copy + send for one order event. The caller owns the
     * "has this event already been pushed" claim (the bot keeps it in memory,
     * the Functions trigger keeps it on the order node).
     */
    async function push({ orderId, order, outlet, event, status }) {
        const riderId = order && order.riderId;
        if (!riderId) return { sent: false, reason: 'no-rider' };
        const uid = await resolveRiderUid(riderId, outlet);
        if (!uid) return { sent: false, reason: 'no-rider-uid' };
        const copy = riderPushCopy(event, {
            displayId: formatOrderId((order && order.orderId) || orderId),
            total: order.total,
        });
        if (!copy) return { sent: false, reason: 'no-copy', uid };
        const data = { orderId, outlet, ...copy.data };
        if (copy.data.type === 'status_change' && status) data.status = status;
        const result = await send(uid, { title: copy.title, body: copy.body, data }, outlet);
        return { ...result, event, title: copy.title, body: copy.body };
    }

    return { resolveRiderUid, send, push };
}

module.exports = {
    createRiderPush,
    riderStatusEvent,
    riderPushCopy,
    isWhatsAppJid,
    PICKUP_STATUSES,
};
