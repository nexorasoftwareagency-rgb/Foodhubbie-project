// Shared push-inbox pruning (CommonJS for bot + bot-control-api).
// The customer inbox (pushInbox/{phone}) is written by the promo API and by
// the order-status bot. Without a cap it grows forever and every read
// (customer app + admin support) pays for the whole history.
//
// Single source of truth: both writers call prunePushInbox() so the cap and
// the "newest wins" rule can never drift apart.

const DEFAULT_CAP = 50;

/**
 * Keep only the `cap` newest entries of a pushInbox/{phone} node.
 * Oldest-first by sentAt, ties broken by key so the result is deterministic.
 * @param {object} ref firebase-admin Reference for pushInbox/{phone}
 * @param {number} cap max entries to keep
 * @returns {Promise<number>} how many entries were removed
 */
async function prunePushInbox(ref, cap = DEFAULT_CAP) {
    try {
        const snap = await ref.once('value');
        const data = snap && typeof snap.val === 'function' ? snap.val() : null;
        if (!data || typeof data !== 'object') return 0;
        const keys = Object.keys(data);
        if (keys.length <= cap) return 0;

        const oldestFirst = keys.slice().sort((a, b) => {
            const ta = Number(data[a] && data[a].sentAt) || 0;
            const tb = Number(data[b] && data[b].sentAt) || 0;
            return ta === tb ? a.localeCompare(b) : ta - tb;
        });

        const stale = oldestFirst.slice(0, keys.length - cap);
        const updates = {};
        for (const key of stale) updates[key] = null; // null removes the child
        await ref.update(updates);
        return stale.length;
    } catch (e) {
        // Never let housekeeping break the actual notification.
        console.warn('[pushInbox] prune failed:', e.message);
        return 0;
    }
}

module.exports = { prunePushInbox, DEFAULT_CAP };
