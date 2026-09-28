import { Outlet, auth, serverTimestamp, ref, db, get, set, push, update, runTransaction, query, orderByKey, endAt } from './firebase.js';
import { pushKeyFor, AUDIT_RETENTION_MS } from './log-prune.js';
import { state } from './state.js';
import { needsPinApproval } from './features/discount-evaluator.js';

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

// Unified order ID → display string. Callers add "#".
// DDMMYY-N and OUTLET-DDMMYY-N pass through; legacy YYYYMMDD-NNNN is rewritten to DDMMYY-N;
// push-keys fall back to last-6 upper. Same logic lives in bot/utils.js,
// menu/js/order.js, SupremeAdmin/js/utils.js, rider-app/src/lib/utils.ts.
export function formatOrderId(o) {
  const id = typeof o === 'string' ? o : (o && (o.orderId || o.id)) || '';
  if (!id) return 'N/A';
  if (/^(?:.+-)?\d{6}-\d+$/.test(id)) return id;
    const m = String(id).match(/^(\d{4})(\d{2})(\d{2})-(\d+)$/);
    if (m) return `${m[3]}${m[2]}${m[1].slice(2)}-${Number(m[4])}`;
    return String(id).slice(-6).toUpperCase();
}

import { showToast, showConfirm, showPinPrompt } from './ui-utils.js';
export { showToast, showConfirm, showPinPrompt };

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

    const orderId = o.orderId || o.id || (o.key ? formatOrderId(o.key) : "ORD-N/A");
    
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
        discountLabel: o.discountLabel || '',
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

// P3-8 #2: root logs/audit grows unbounded (4k entries ≈ 67% of all RTDB nodes).
// Age-based prune, at most once per browser per day, fire-and-forget from init.
// ponytail: root audit only — outlet walkouts (single entry) and riderErrors
// (rider-write-only rule) don't meaningfully grow; revisit if that changes.
export async function pruneOldLogs() {
    try {
        if (Date.now() - Number(localStorage.getItem('auditPrunedAt') || 0) < 864e5) return;
        localStorage.setItem('auditPrunedAt', String(Date.now()));
        const auditRef = Outlet.ref('logs/audit');
        const snap = await get(query(auditRef, orderByKey(), endAt(pushKeyFor(Date.now() - AUDIT_RETENTION_MS))));
        if (!snap.exists()) return;
        const upd = {};
        snap.forEach((child) => { upd[child.key] = null; });
        const n = Object.keys(upd).length;
        if (!n) return;
        await update(auditRef, upd);
        console.log(`[Prune] audit: removed ${n} entries older than ${AUDIT_RETENTION_MS / 864e5}d`);
    } catch (e) {
        console.warn('[Prune] audit prune failed:', e?.message || e);
    }
};

// ── Manager PIN gates: manual-discount approval ceiling + payment void ──

/**
 * SHA-256 hex of a PIN — what gets stored at settings/Security/pinHash so
 * the DB never holds a readable credential.
 * ponytail: a short numeric PIN hash is still brute-forceable by anyone who
 * can read it, so this is leak-hygiene, not a security boundary. Real
 * enforcement needs a server; Spark plan means no Cloud Functions here.
 * Returns null when crypto.subtle is unavailable (non-secure context) so
 * callers can decide whether to fail open instead of throwing.
 */
export const hashPin = async (pin) => {
    if (!globalThis.crypto?.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(pin)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Shared manager-PIN prompt: reads settings/Security and asks until the PIN
 * matches or the operator gives up.
 * Resolves false ONLY when the operator cancels or stops retrying a wrong
 * PIN. Every other path fails open — an unreadable or half-configured
 * security node must never block the action it is guarding.
 */
export async function gateManagerPin({ message, auditAction, auditDetails = {} }) {
    // Feature off (Settings > Features) — explicit short-circuit, not a fail-open path.
    if (!(state.features && state.features.discountApproval)) return true;

    let sec;
    try {
        sec = (await get(Outlet.ref('settings/Security'))).val() || {};
    } catch (e) {
        console.warn('[Security] approval settings unreadable:', e?.message || e);
        return true;
    }
    if (!sec.pinHash) {
        showToast('Manager PIN is required for this action but none is set — configure it in Settings.', 'warning', 5000);
        return true;
    }
    for (;;) {
        const pin = await showPinPrompt(message);
        if (!pin) return false;
        const hash = await hashPin(pin);
        if (hash === null) { console.warn('[Security] PIN hashing unavailable — failing open'); return true; }
        if (hash === sec.pinHash) {
            logAudit(auditAction, auditDetails);
            return true;
        }
        showToast('Incorrect manager PIN. Try again.', 'error', 3000, 'pin-err');
    }
}

/**
 * Settlement gate for MANUAL discounts: above the configured % ceiling it
 * demands a manager PIN. Callers `await` this before writing payment.
 * Resolves false ONLY when the operator cancels or mistypes the PIN;
 * every other path fails open.
 * Uses per-person ceiling from staff record, with outlet-level fallback.
 */
export async function gateManualDiscountPin({ discountValue, subtotal, discountId, staffUid }) {
    if (discountId !== 'manual:flat' && discountId !== 'manual:percent') return true;
    if (!(state.features && state.features.discountApproval)) return true;

    let sec;
    try {
        sec = (await get(Outlet.ref('settings/Security'))).val() || {};
    } catch (e) {
        console.warn('[Discounts] approval settings unreadable:', e?.message || e);
        return true;
    }
    
    // GET PER-PERSON CEILING
    const effectiveCeiling = await getEffectiveCeiling(staffUid || state.adminData?.uid);
    if (!needsPinApproval(discountValue, subtotal, effectiveCeiling)) return true;

    const pct = ((Number(discountValue) / subtotal) * 100).toFixed(1);
    return gateManagerPin({
        message: `This ${pct}% discount is above the ${effectiveCeiling}% approval ceiling.`,
        auditAction: 'discount.pin.approved',
        auditDetails: {
            discountValue: Math.round(discountValue),
            subtotal: Math.round(subtotal),
            ceilingPct: effectiveCeiling
        }
    });
}

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

// Shared Chart.js loader (analytics + expenses). CDN ESM build; CSP allows cdn.jsdelivr.net.
let _chartJSPromise = null;
export async function _loadChartJS() {
    if (_chartJSPromise) return _chartJSPromise;
    _chartJSPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm').then(m => {
        const C = m.Chart;
        if (C && C.register && m.CategoryScale) {
            C.register(m.CategoryScale, m.LinearScale, m.LineElement, m.PointElement, m.BarElement, m.LineController,
                m.BarController, m.ArcElement, m.DoughnutController, m.Tooltip, m.Legend, m.Filler);
        }
        window.Chart = C;
        return m;
    }).catch(e => { _chartJSPromise = null; throw e; });
    await _chartJSPromise;
}

// ─── Counter PIN Shift Sign-In ───

/**
 * Verifies a 4-digit Counter PIN against staff records using reverse index.
 * Returns staff UID on success, null on failure/cancel.
 */
export async function verifyCounterPin(enteredPin) {
    if (!enteredPin || enteredPin.length < 4) return null;
    
    const hash = await hashPin(enteredPin);
    if (!hash) return null;
    
    try {
        // Use reverse index: counterPinIndex/{hash} -> staffUid
        // This avoids reading all staff records and prevents timing attacks
        const indexRef = Outlet.ref(`counterPinIndex/${hash}`);
        const indexSnap = await get(indexRef);
        if (!indexSnap.exists()) return null;
        
        const staffUid = indexSnap.val();
        
        // Verify the staff member is still active and PIN hasn't changed
        const staffSnap = await get(Outlet.staff(staffUid));
        if (!staffSnap.exists()) return null;
        
        const staff = staffSnap.val();
        if (staff.isActive === false || staff.counterPinHash !== hash) return null;
        
        return staffUid;
    } catch (e) {
        console.error('[Utils] Counter PIN verification failed:', e);
        return null;
    }
}

/**
 * Prompts for Counter PIN to start a shift.
 * Returns staff UID on success, null on cancel.
 */
export async function promptCounterPinSignIn() {
    // Fail-open when no Counter PIN exists at all: the prompt would be
    // impossible to satisfy and hard-lock the POS (network error → prompt anyway).
    try {
        if (!(await get(Outlet.ref('counterPinIndex'))).exists()) {
            console.warn('[Utils] No Counter PIN registered for this outlet — skipping shift sign-in');
            return true;
        }
    } catch (e) {
        console.warn('[Utils] counterPinIndex check failed, prompting anyway', e);
    }

    const pin = await showPinPrompt('Enter your 4-digit Counter PIN to start your shift', 'Shift Sign-In');
    if (!pin) return null;
    
    const staffUid = await verifyCounterPin(pin);
    if (!staffUid) {
        showToast('Invalid Counter PIN', 'error');
        return null;
    }
    
    // Store in session for this shift
    sessionStorage.setItem('counterStaffUid', staffUid);
    
    // Update lastSignedIn timestamp
    try {
        await update(Outlet.staff(staffUid), { lastSignedIn: new Date().toISOString() });
    } catch (e) {
        console.warn('[Utils] Failed to update lastSignedIn:', e);
    }
    
    showToast('Shift started', 'success');
    return staffUid;
}

/**
 * Clears the counter staff session (end of shift / logout)
 */
export function clearCounterStaffSession() {
    sessionStorage.removeItem('counterStaffUid');
}

/**
 * Gets the current counter staff UID (for POS discount ceiling)
 */
export function getCounterStaffUid() {
    return sessionStorage.getItem('counterStaffUid') || null;
}

/**
 * SHA-256 hex of an email — used for emailIndex lookup.
 * Normalizes email to lowercase before hashing.
 * Throws if crypto.subtle is unavailable (requires secure context).
 */
export const hashEmail = async (email) => {
    if (!globalThis.crypto?.subtle) throw new Error('Email hashing requires secure context (HTTPS)');
    const normalized = String(email).toLowerCase().trim();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Audit log for staff changes.
 * Written to outlets/{oid}/audit/staffChanges/{pushId}
 */
export async function logStaffChange(action, targetStaffUid, oldValue, newValue, note = '') {
    const adminData = state.adminData;
    if (!adminData) return;

    try {
        await push(Outlet.ref('audit/staffChanges'), {
            action,
            targetStaffUid,
            oldValue,
            newValue,
            actorUid: adminData.uid,
            actorRole: adminData.role,
            actorName: adminData.name || adminData.email,
            timestamp: serverTimestamp(),
            note
        });
    } catch (e) {
        console.warn('[Utils] staffChanges write failed:', e);
    }
}

/**
 * Shows a modal with a generated PIN that the user can copy.
 * Returns a promise that resolves when the user clicks "Done".
 */
export function showPinModal(message, pin) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';
        overlay.innerHTML = `
            <div class="dynamic-modal-box">
                <h3 class="dynamic-modal-title">Counter PIN Generated</h3>
                <p class="dynamic-modal-text">${message}</p>
                <div class="pin-display" style="font-size:28px;font-weight:700;letter-spacing:8px;font-family:monospace;background:var(--bg-subtle);padding:16px;border-radius:12px;margin:16px 0;text-align:center;color:var(--primary);">${pin}</div>
                <p class="text-secondary-small" style="text-align:center;">Share this securely. It will not be shown again.</p>
                <div class="dynamic-modal-actions">
                    <button class="btn-primary btn-copy-pin"><i data-lucide="copy" class="icon-14"></i> Copy</button>
                    <button class="btn-confirm">Done</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        loadLucide().then(() => window.lucide?.createIcons({ root: overlay }));
        
        overlay.querySelector('.btn-copy-pin').onclick = () => {
            navigator.clipboard.writeText(pin).then(() => showToast('Copied!', 'success'));
        };
        overlay.querySelector('.btn-confirm').onclick = () => {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); resolve(); }, 200);
        };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.style.opacity = '0'; setTimeout(() => { overlay.remove(); resolve(); }, 200); } };
    });
}

/**
 * Capitalizes the first letter of a string.
 */
export function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/**
 * Formats a timestamp as relative time (e.g., "2h ago", "3d ago").
 */
export function formatRelativeTime(isoString) {
    try {
        const date = new Date(isoString);
        const diff = Date.now() - date.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch {
        return 'Unknown';
    }
}

/**
 * Switches to the Staff Management tab in Settings.
 */
export function switchToStaffManagementTab() {
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab && !settingsTab.classList.contains('active')) {
        settingsTab.click();
    }
    setTimeout(() => {
        const subTab = document.querySelector('[data-subtab="staff-management"]');
        if (subTab && !subTab.classList.contains('active')) {
            subTab.click();
        }
    }, 100);
}

/**
 * Gets the effective discount ceiling for a staff member.
 * Priority: 1) per-person ceiling on staff record, 2) explicit override in settings/Security/staffCeilings,
 * 3) legacy outlet-level ceiling from settings/Security/discountCeilingPct.
 * Returns 0 if no ceiling configured (no approval needed).
 */
export async function getEffectiveCeiling(staffUid) {
    if (!staffUid) return 0;
    
    // 1. Try per-person ceiling (denormalized on staff record for fast POS read)
    const staffSnap = await get(Outlet.staff(staffUid));
    if (staffSnap.exists()) {
        const staff = staffSnap.val();
        if (staff.isActive !== false && typeof staff.discountCeilingPct === 'number' && staff.discountCeilingPct > 0) {
            return staff.discountCeilingPct;
        }
    }
    
    // 2. Try explicit override in staffCeilings
    const ceilingSnap = await get(Outlet.ref(`settings/Security/staffCeilings/${staffUid}`));
    if (ceilingSnap.exists()) {
        return ceilingSnap.val().ceilingPct || 0;
    }
    
    // 3. Fallback to outlet-level legacy ceiling
    const secSnap = await get(Outlet.ref('settings/Security'));
    return secSnap.val()?.discountCeilingPct || 0;
}
