// ============================================================================
// NOTIFY CLIENT — the ONE place that talks to the push endpoint
//
// Two callers now exist (the Customer APP push tab and the Customers
// notification checklist), so the URL resolution, the bearer token, the
// server-anchored IST clock and the POST itself live here instead of being
// copied. The Customer APP tab imports these; the checklist imports these.
//
// Batch 23d-2: the send route lives on Cloud Functions (`tenantNotify`).
// `config/notifyUrl` is the switch; when it is absent (or the function is
// deleted) the dashboard falls back to the control API on `config/tunnelUrl`,
// exactly as before.
//
// Quiet hours belong to the SERVER (functions/src/shared/notify/caps.ts:
// 21:00-09:00 IST, promo/offer only). The browser clock can be wrong - a
// device 12 hours out would silently block a morning send or let a night send
// through - so the IST hour is anchored to the Firebase Auth token's issued-at
// claim, which is the server's own clock. The device clock is only the
// fallback (no token yet).
// ============================================================================

import { auth, db, ref, get } from '../firebase.js';

const IST_OFFSET_MS = 5 * 3600000 + 30 * 60000;
let _clockSkewMs = 0;

/** Anchor the local clock to the server's (via the ID token's `iat`). */
export async function syncServerClock() {
    try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const part = String(token || '').split('.')[1];
        if (!part) return;
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
        const payload = JSON.parse(atob(padded));
        if (Number.isFinite(payload.iat)) _clockSkewMs = payload.iat * 1000 - Date.now();
    } catch (e) {
        // Keep the device clock - the server is the authority in any case.
    }
}

/** The current IST hour (0-23), anchored to the server clock when known. */
export function istHour() {
    return new Date(Date.now() + _clockSkewMs + IST_OFFSET_MS).getUTCHours();
}

/** True during the marketing quiet window (21:00-09:00 IST). */
export function isQuietHours() {
    const h = istHour();
    return h >= 21 || h < 9;
}

/** The admin's Firebase ID token - the caller proves WHO is sending. */
export function adminAuthToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

// ponytail: single consumer - cache on window; promote to shared config when a second caller appears
export async function notifyBase() {
    if (window.NOTIFY_URL) return window.NOTIFY_URL;
    try {
        const snap = await get(ref(db, 'config/notifyUrl'));
        const url = snap.val();
        if (url) {
            window.NOTIFY_URL = url;
            return url;
        }
    } catch { /* fall through to the legacy control API */ }
    if (window.TUNNEL_URL) return window.TUNNEL_URL;
    try {
        const snap = await get(ref(db, 'config/tunnelUrl'));
        const url = snap.val();
        if (url) {
            window.TUNNEL_URL = url;
            return url;
        }
    } catch { /* no configured endpoint */ }
    throw new Error('No notification service is configured for this outlet.');
}

/**
 * POST one notification batch. Throws with a human message on failure.
 * @returns {Promise<{ok:boolean, sent:number, failed:number, total:number, inbox:number}>}
 */
export async function sendNotify(payload) {
    const token = await adminAuthToken();
    if (!token) throw new Error('Not authenticated');
    const url = `${await notifyBase()}/tenant-api/notify`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload || {})
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.error || `Send failed (${resp.status})`);
    return result;
}
