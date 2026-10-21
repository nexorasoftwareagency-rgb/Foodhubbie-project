/**
 * menu/js/pwa-install.js
 *
 * Phone identity capture, install prompting (Chrome/Android + iOS manual
 * fallback), and FCM push-notification opt-in for the customer-facing QR
 * ordering app. All three are deliberately bundled in one module since the
 * UI (Promotions tab) offers them as one connected flow, and iOS requires
 * install to happen before notifications can work at all.
 *
 * Design decisions this file implements (confirmed, not assumed):
 *   - Phone identity: Option A, no OTP verification. Captured once, reused
 *     from localStorage from then on. Global across every restaurant the
 *     customer visits — it's one login, not per-restaurant.
 *   - Install: outer branding is constant "FoodHubbie" on every install
 *     (see dynamic-manifest.js); this file only drives *when* to prompt,
 *     the manifest itself is what makes each install correctly scoped.
 *   - Push: FCM, reusing the exact getToken()/serviceWorkerRegistration
 *     pattern already proven in Admin/js/fcm-init.js. Subscriptions are
 *     tagged with this outlet's identity, keyed by a sanitized version of
 *     the FCM token itself — so re-subscribing on a later visit UPDATES
 *     the same record instead of creating a duplicate (closing the
 *     duplicate-subscription risk flagged in the earlier audit, the same
 *     failure class this codebase has hit twice before on the WhatsApp
 *     side).
 */

import { getMessaging, getToken, onMessage, deleteToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import { app, outletRef, set, update, OUTLET, BUSINESS_ID } from './firebase.js';
import { VAPID_PUBLIC_KEY } from '../../shared/config/vapid.js';

const PHONE_STORAGE_KEY = 'fh_customer_phone';

let deferredInstallPrompt = null;
let messagingInstance = null;
// Background push uses its own worker. Registering it at "/" would replace the
// app-shell worker (sw.js) — two workers cannot share a scope — so it gets the
// dedicated "/firebase-messaging-sw/" scope and getToken is bound to it.
const FCM_SW_URL = 'firebase-messaging-sw.js';
const FCM_SW_SCOPE = 'firebase-messaging-sw/';
let fcmRegistration = null;

function getFcmRegistration() {
    if (!fcmRegistration) {
        fcmRegistration = navigator.serviceWorker
            .register(FCM_SW_URL, { scope: FCM_SW_SCOPE })
            .catch((e) => {
                console.warn('[PWA] FCM SW registration failed:', e?.message || e);
                return null;
            });
    }
    return fcmRegistration;
}

function getMessagingInstance() {
    if (!messagingInstance) {
        try {
            messagingInstance = getMessaging(app);
        } catch (e) {
            console.warn('[PWA] FCM not available in this browser:', e?.message || e);
            return null;
        }
    }
    return messagingInstance;
}

// ── Platform detection ──────────────────────────────────────────────────

export function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
});

export function canShowNativeInstallPrompt() {
    return !!deferredInstallPrompt;
}

export async function promptInstall() {
    if (!deferredInstallPrompt) return 'unavailable';
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return choice.outcome;
}

// ── Phone identity (Option A — no verification) ─────────────────────────

export function getStoredPhone() {
    try {
        return localStorage.getItem(PHONE_STORAGE_KEY) || '';
    } catch (e) {
        return '';
    }
}

export function savePhone(rawPhone) {
    const cleaned = (rawPhone || '').replace(/[^\d]/g, '');
    // Basic Indian mobile validation: 10 digits, starts with 6-9
    if (cleaned.length !== 10 || !/^[6-9]\d{9}$/.test(cleaned)) {
        return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };
    }
    try {
        localStorage.setItem(PHONE_STORAGE_KEY, cleaned);
    } catch (e) {
        console.warn('[PWA] Could not persist phone to localStorage:', e?.message || e);
    }
    return { ok: true, phone: cleaned };
}

// ── Push notification subscription ──────────────────────────────────────

function safeKeyFromToken(token) {
    return token.replace(/[.#$\[\]/]/g, '_');
}

export function getNotificationPermission() {
    try {
        return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    } catch (e) {
        return 'unsupported';
    }
}

function subscriptionPayload(token, { name, phone, prefs, appMode } = {}) {
    const cleanPhone = (phone || getStoredPhone() || '').replace(/[^\d]/g, '').slice(-10);
    const payload = {
        token,
        phone: /^[6-9]\d{9}$/.test(cleanPhone) ? cleanPhone : null,
        outlet: OUTLET,
        business: BUSINESS_ID,
        platform: isIOS() ? 'ios' : 'web',
        appMode: appMode === 'delivery' ? 'delivery' : 'dine-in',
        updatedAt: Date.now()
    };
    if (name) payload.name = String(name).trim().slice(0, 60);
    if (prefs) {
        payload.prefs = {
            offers: prefs.offers === true,
            orderUpdates: prefs.orderUpdates !== false
        };
    }
    return payload;
}

export async function subscribeToNotifications({ name, phone, prefs, appMode } = {}) {
    if (VAPID_PUBLIC_KEY === 'PASTE_VAPID_PUBLIC_KEY_HERE') {
        console.error('[PWA] VAPID_PUBLIC_KEY is not set — push notifications cannot work until it is. See the comment at the top of pwa-install.js for where to get it.');
        return { ok: false, error: 'Notifications are not configured yet.' };
    }

    const messaging = getMessagingInstance();
    if (!messaging) return { ok: false, error: 'Push notifications are not supported in this browser.' };

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return { ok: false, error: 'Notification permission was not granted.' };
        }

        const swRegistration = await getFcmRegistration();
        if (!swRegistration) return { ok: false, error: 'Notifications could not start on this browser.' };
        const token = await getToken(messaging, {
            vapidKey: VAPID_PUBLIC_KEY,
            serviceWorkerRegistration: swRegistration
        });

        if (!token) return { ok: false, error: 'Could not get a push token from this browser.' };

        const key = safeKeyFromToken(token);
        await set(outletRef(`pushSubscriptions/${key}`), subscriptionPayload(token, { name, phone, prefs, appMode }));

        return { ok: true, token };
    } catch (e) {
        console.error('[PWA] subscribeToNotifications failed:', e?.message || e);
        return { ok: false, error: 'Something went wrong enabling notifications.' };
    }
}

// Used when the profile/preferences change after opt-in: re-derive this
// device's token (never persisted in localStorage) and patch the same record.
export async function updateSubscriptionMeta(meta = {}) {
    if (getNotificationPermission() !== 'granted') return { ok: false };
    const messaging = getMessagingInstance();
    if (!messaging) return { ok: false };
    try {
        const swRegistration = await getFcmRegistration();
        if (!swRegistration) return { ok: false };
        const token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: swRegistration });
        if (!token) return { ok: false };
        const key = safeKeyFromToken(token);
        await update(outletRef(`pushSubscriptions/${key}`), subscriptionPayload(token, meta));
        return { ok: true };
    } catch (e) {
        console.warn('[PWA] updateSubscriptionMeta failed:', e?.message || e);
        return { ok: false };
    }
}

export async function unsubscribeFromNotifications() {
    const messaging = getMessagingInstance();
    if (messaging) {
        try { await deleteToken(messaging); } catch (e) { /* already gone */ }
    }
    return { ok: true };
}

export function onForegroundMessage(callback) {
    const messaging = getMessagingInstance();
    if (!messaging || typeof onMessage !== 'function') return () => {};
    try {
        return onMessage(messaging, callback);
    } catch (e) {
        return () => {};
    }
}
