import { Outlet, auth, serverTimestamp, ref, db, get, set, push, update, runTransaction } from './firebase.js';
import { state } from './state.js';

export const haptic = (val = 10) => {
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(val);
    }
};

export const formatDate = (ts) => {
    if (!ts) return "N/A";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ", " + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

// Re-export IST date helper from shared — single source of truth
export { getISTDateString } from '../../shared/format/date.js';

export { escapeHtml } from '../../shared/dom/escape.js';

// Re-export geo utilities from shared — single source of truth
export { calculateDistance } from '../../shared/geo/geo.js';

export const getFeeFromSlabs = (dist, slabs) => {
    if (!slabs || slabs.length === 0) return 0;
    const sorted = [...slabs].sort((a, b) => a.km - b.km);
    for (const s of sorted) {
        if (dist <= s.km) return s.fee;
    }
    return sorted[sorted.length - 1].fee;
};

import { showToast, showConfirm } from './ui-utils.js';
export { showToast, showConfirm };

// ── Audio (pre-created, unlocked on first user interaction) ──
let _alertAudio = null;
let _audioUnlocked = false;

function _ensureAudio() {
    if (!_alertAudio) {
        _alertAudio = new Audio('assets/sounds/alert.mp3');
        _alertAudio.preload = 'auto';
    }
    return _alertAudio;
}

function _unlockAudio() {
    if (_audioUnlocked) return;
    const a = _ensureAudio();
    a.currentTime = 0;
    a.play().then(() => { _audioUnlocked = true; a.pause(); a.currentTime = 0; }).catch(() => {});
}

['click', 'touchstart', 'keydown'].forEach(evt =>
    document.addEventListener(evt, _unlockAudio, { once: false, passive: true })
);

export const playNotificationSound = () => {
    const audio = _ensureAudio();
    audio.currentTime = 0;
    audio.play().catch(e => console.warn('Audio playback failed:', e));
};

let _continuousAudio = null;

export function startContinuousSound() {
    if (state.continuousSoundInterval) return;

    _continuousAudio = _ensureAudio();
    _continuousAudio.currentTime = 0;
    _continuousAudio.play().catch(e => console.warn('Audio failed:', e));

    state.continuousSoundInterval = setInterval(() => {
        if (state.unacknowledgedOrders.size === 0) {
            stopContinuousSound();
            return;
        }
        _continuousAudio.currentTime = 0;
        _continuousAudio.play().catch(e => console.warn('Audio failed:', e));
    }, 2000);
}

export function stopContinuousSound() {
    if (state.continuousSoundInterval) {
        clearInterval(state.continuousSoundInterval);
        state.continuousSoundInterval = null;
    }
    if (_continuousAudio) {
        _continuousAudio.pause();
        _continuousAudio = null;
    }
}

// bfcache: cleanup handled via visibilitychange/pagehide
window.addEventListener('pagehide', () => {
    stopContinuousSound();
});

export const playSuccessSound = () => {
    const audio = _ensureAudio();
    audio.currentTime = 0;
    audio.play().catch(e => console.warn('Audio playback failed:', e));
};

export const standardizeOrderData = (o) => {
    if (!o) return null;

    const orderId = o.orderId || o.id || (o.key ? o.key.slice(-8).toUpperCase() : "ORD-N/A");
    
    // Normalize items from various formats
    let rawItems = [];
    if (Array.isArray(o.cart)) {
        rawItems = o.cart;
    } else if (o.items) {
        rawItems = Array.isArray(o.items) ? o.items : Object.values(o.items);
    } else if (o.item) {
        // Fallback for very old or simplified order objects
        rawItems = [{
            name: o.item,
            size: o.size || 'Regular',
            addon: o.addon || 'None',
            qty: 1,
            price: o.price || o.unitPrice || o.total || 0
        }];
    }

    const items = rawItems.map(i => ({
        name: i.name || i.item || "Unknown Item",
        size: i.size || "",
        quantity: parseInt(i.qty || i.quantity || 1, 10),
        price: parseFloat(i.price || i.unitPrice || i.total || 0),
        addon: i.addon || (i.addons && Array.isArray(i.addons) ? i.addons.map(a => a.name).join(', ') : "")
    }));

    const orderDate = o.createdAt ? new Date(o.createdAt) : new Date();

    return {
        orderId: orderId,
        date: orderDate.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        time: orderDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
        customerName: o.customerName || "Walk-in Customer",
        phone: o.phone || o.whatsappNumber || "",
        address: o.address || "",
        customerNote: o.customerNote || o.note || "",
        items: items,
        subtotal: parseFloat(o.subtotal || o.itemTotal || 0),
        tax: parseFloat(o.tax || 0),
        taxName: o.taxName || '',
        taxItems: o.taxItems,
        serviceCharge: parseFloat(o.serviceCharge || 0),
        serviceChargeName: o.serviceChargeName || '',
        serviceChargeRate: o.serviceChargeRate || undefined,
        discount: parseFloat(o.discount || 0),
        deliveryFee: parseFloat(o.deliveryFee || 0),
        total: parseFloat(o.total || 0),
        paymentMethod: o.paymentMethod || "Cash",
        type: o.type === "Walk-in" ? "Dine-in" : (o.type || "Online Booked"),
        status: o.status || "Placed",
        outlet: o.outlet || (window.currentOutlet ? (window.currentOutlet.charAt(0).toUpperCase() + window.currentOutlet.slice(1)) : "Pizza")
    };
};

export const logAudit = async (action, details = {}) => {
    try {
        const user = auth.currentUser;
        const auditRef = push(Outlet.ref('logs/audit'));
        await set(auditRef, {
            timestamp: serverTimestamp(),
            adminEmail: user ? user.email : 'system',
            uid: user ? user.uid : 'system',
            action,
            details,
            outlet: Outlet.current
        });
    } catch (e) {
        // Silently fail for logAudit to avoid init crashes
        if (e?.code === 'PERMISSION_DENIED' || e?.code === 'permission-denied') {
            console.warn("[Audit] Log forbidden (App Check or Rules):", action);
        } else {
            console.warn("[Audit] Log failed:", action, e?.message || e);
        }
    }
};

export const addRiderNotification = async (uid, title, sub, type = 'info') => {
    if (!uid) return;
    try {
        const notifRef = push(ref(db, `riders/${uid}/notifications`));
        await set(notifRef, {
            id: notifRef.key,
            title,
            body: sub || 'New update available',
            type,
            timestamp: serverTimestamp(),
            read: false,
            icon: type === 'new' ? 'package' : 'bell'
        });
    } catch (e) {
        console.warn("[Rider Notif] Failed:", e);
    }
};

export const standardizeAuthError = (error) => {
    if (!error || !error.code) return "An unexpected error occurred. Please try again.";

    switch (error.code) {
        case 'auth/invalid-email':
            return "The email address is not valid.";
        case 'auth/user-disabled':
            return "This account has been disabled.";
        case 'auth/user-not-found':
        case 'auth/wrong-password':
            return "Incorrect email or password.";
        case 'auth/too-many-requests':
            return "Too many failed attempts. Security lock active. Please wait 15-30 minutes.";
        case 'auth/quota-exceeded':
            return "Login Quota Exceeded (Spark Plan limit). Please wait 60 minutes or contact Firebase support.";
        case 'auth/email-already-in-use':
            return "This email address is already in use.";
        case 'auth/operation-not-allowed':
            return "Operation not allowed. Contact support.";
        case 'auth/weak-password':
            return "The password is too weak.";
        case 'auth/network-request-failed':
            return "Network error. Please check your internet connection or VPN settings.";
        case 'auth/api-key-expired':
            return "System Error: Firebase API Key has expired. Please contact the administrator to renew the API key.";
        default:
            return error.message || "Authentication failed.";
    }
};

export const previewImage = (input, previewId) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = document.getElementById(previewId);
            const hidden = document.getElementById(previewId.replace('Preview', 'Url'));
            if (preview) preview.src = e.target.result;
            if (hidden) hidden.value = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

/**
 * Generates skeleton table rows for loading states.
 * @param {number} count - Number of skeleton rows to generate (default 5)
 * @param {number} colspan - Colspan for the single cell in each row (default 7)
 * @returns {string} HTML string of skeleton rows
 */
export function getSkeletonRows(count = 5, colspan = 7) {
    return Array.from({ length: count }, () =>
        `<tr class="skeleton-row"><td colspan="${colspan}"><div class="skeleton" style="height:44px;width:100%;border-radius:6px;margin:3px 0"></div></td></tr>`
    ).join('');
}

export function getSkeletonDivs(count = 5) {
    return Array.from({ length: count }, () =>
        `<div class="skeleton" style="height:44px;width:100%;border-radius:6px;margin:3px 0"></div>`
    ).join('');
}
