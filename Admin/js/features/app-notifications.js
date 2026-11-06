/**
 * FoodHubbie ERP | APP NOTIFICATIONS MODULE
 * Standalone top-level tab: "App Notifications"
 * Sends push notifications (FCM) to customers who installed the restaurant's app.
 * Previously lived as a sub-tab inside Promotions; now its own top-level tab.
 */

import { db, auth, Outlet, ref, get } from '../firebase.js';
import { state } from '../state.js';
import { showToast } from '../ui-utils.js';
import { formatDate } from '../utils.js';
import { loadLucide } from '../ui.js';
import { logger } from '../utils/logger.js';

let _subCountEl, _subUpdatedEl, _sendBtn, _titleInput, _bodyInput, _testModeCb;

export function loadAppNotifications() {
    logger.info('APP-NOTIF', 'Loading App Notifications tab…');

    _subCountEl = document.getElementById('pushSubCount');
    _subUpdatedEl = document.getElementById('pushSubUpdated');
    _sendBtn = document.getElementById('btnSendPushNotif');
    _titleInput = document.getElementById('pushNotifTitle');
    _bodyInput = document.getElementById('pushNotifBody');
    _testModeCb = document.getElementById('pushNotifTestMode');

    _loadPushSubscriptions();

    _sendBtn?.addEventListener('click', _sendPushNotification);
    document.getElementById('btnRefreshPushSubs')?.addEventListener('click', _loadPushSubscriptions);
}

export function cleanupAppNotifications() {
    _subCountEl = _subUpdatedEl = _sendBtn = _titleInput = _bodyInput = _testModeCb = null;
}

/* ============ PUSH NOTIFICATIONS ============ */

async function _loadPushSubscriptions() {
    if (!_subCountEl) return;

    try {
        const snap = await get(Outlet.ref('pushSubscriptions'));
        const subs = snap.val() || {};
        const count = Object.keys(subs).length;
        _subCountEl.textContent = count;
        if (_subUpdatedEl) {
            const latest = Object.values(subs)
                .map(s => s.updatedAt || 0)
                .reduce((a, b) => Math.max(a, b), 0);
            _subUpdatedEl.textContent = latest ? formatDate(latest) : '—';
        }
        if (_sendBtn) _sendBtn.disabled = count === 0;
    } catch (e) {
        console.error('[Push] Failed to load subscriptions:', e);
        _subCountEl.textContent = 'Error';
        if (_sendBtn) _sendBtn.disabled = true;
    }
}

async function _sendPushNotification() {
    const title = _titleInput?.value?.trim();
    const body = _bodyInput?.value?.trim();
    const testMode = _testModeCb?.checked;

    if (!title || !body) {
        showToast('Title and message are required', 'warning');
        return;
    }

    const outlet = state.currentOutlet || 'pizza';
    const businessId = window.currentBusinessId || 'roshani-pizza';

    _sendBtn.disabled = true;
    _sendBtn.innerHTML = '<i data-lucide="loader"></i> <span>Sending…</span>';
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: _sendBtn.parentNode });

    try {
        const token = await _getAdminAuthToken();
        if (!token) throw new Error('Not authenticated');

        const url = `${await _notifyBase()}/tenant-api/notify`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ title, body, data: { testMode: testMode ? 'true' : 'false', type: 'promo' } })
        });

        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Send failed');

        showToast(`Notification sent to ${result.sent} device${result.sent !== 1 ? 's' : ''}${result.failed ? ` (${result.failed} failed)` : ''}`, 'success');
        _titleInput.value = '';
        _bodyInput.value = '';
        _loadPushSubscriptions();
    } catch (e) {
        console.error('[Push] Send failed:', e);
        showToast(e.message || 'Failed to send notification', 'error');
    } finally {
        _sendBtn.disabled = false;
        _sendBtn.innerHTML = '<i data-lucide="send"></i> <span>Send Notification</span>';
        await loadLucide();
        if (window.lucide) window.lucide.createIcons({ root: _sendBtn.parentNode });
    }
}

function _getAdminAuthToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

// ponytail: single consumer — cache on window; promote to shared config when a second caller appears
async function _notifyBase() {
    if (window.TUNNEL_URL) return window.TUNNEL_URL;
    try {
        const snap = await get(ref(db, 'config/tunnelUrl'));
        const url = snap.val();
        if (url) window.TUNNEL_URL = url;
    } catch { /* fall through → hosting origin 404 with honest error */ }
    return window.TUNNEL_URL || '';
}
