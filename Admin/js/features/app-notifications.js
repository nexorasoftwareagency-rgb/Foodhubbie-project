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

// UI element refs
let _subCountEl, _subUpdatedEl, _sendBtn, _titleInput, _bodyInput, _testModeCb;
let _quietEl, _previewTitleEl, _previewBodyEl, _previewTypeEl;

// Notification type -> label + icon + color
const TYPE_INFO = {
    order:    { label: 'Order Update',   icon: '🛒', color: '#e84908' },
    promo:    { label: 'Promo / Offer',  icon: '🎉', color: '#7b1fa2' },
    loyalty:  { label: 'Loyalty',        icon: '💎', color: '#1a73e8' },
    system:   { label: 'System',         icon: '⚙️', color: '#6c757d' },
};

export function loadAppNotifications() {
    logger.info('APP-NOTIF', 'Loading App Notifications tab…');

    _subCountEl      = document.getElementById('pushSubCount');
    _subUpdatedEl    = document.getElementById('pushSubUpdated');
    _quietEl         = document.getElementById('pushQuietHours');
    _sendBtn         = document.getElementById('btnSendPushNotif');
    _titleInput      = document.getElementById('pushNotifTitle');
    _bodyInput       = document.getElementById('pushNotifBody');
    _testModeCb      = document.getElementById('pushNotifTestMode');
    _previewTitleEl  = document.getElementById('pushPreviewTitle');
    _previewBodyEl   = document.getElementById('pushPreviewBody');
    _previewTypeEl   = document.getElementById('pushPreviewType');

    _loadPushSubscriptions();

    _sendBtn?.addEventListener('click', _sendPushNotification);
    document.getElementById('btnRefreshPushSubs')?.addEventListener('click', _loadPushSubscriptions);

    // Character counters + live preview
    _titleInput?.addEventListener('input', () => {
        _updateCharCount(_titleInput, document.getElementById('pushTitleCount'), 100);
        _updatePreview();
    });
    _bodyInput?.addEventListener('input', () => {
        _updateCharCount(_bodyInput, document.getElementById('pushBodyCount'), 300);
        _updatePreview();
    });

    // Notification type change -> update preview type badge
    document.querySelectorAll('input[name="pushNotifType"]').forEach(rb => {
        rb.addEventListener('change', _updatePreview);
    });

    // Template preset buttons
    document.querySelectorAll('.tpl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const title = btn.getAttribute('data-title') || '';
            const body  = btn.getAttribute('data-body')  || '';
            const type  = btn.getAttribute('data-tpl')   || 'promo';
            _titleInput.value = title;
            _bodyInput.value  = body;
            document.querySelector(`input[name="pushNotifType"][value="${type}"]`).checked = true;
            _updateCharCount(_titleInput, document.getElementById('pushTitleCount'), 100);
            _updateCharCount(_bodyInput, document.getElementById('pushBodyCount'), 300);
            _updatePreview();
        });
    });

    // Quiet hours check on load
    _updateQuietHoursIndicator();
}

export function cleanupAppNotifications() {
    _subCountEl = _subUpdatedEl = _quietEl = _sendBtn = _titleInput = _bodyInput = _testModeCb = null;
    _previewTitleEl = _previewBodyEl = _previewTypeEl = null;
}

/* ============ QUIET HOURS ============ */

function _updateQuietHoursIndicator() {
    if (!_quietEl) return;
    const now = new Date();
    // IST = UTC + 5:30
    const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
    const inQuiet = istHour >= 21 || istHour < 9;
    if (_quietEl) _quietEl.style.display = inQuiet ? '' : 'none';
}

/* ============ CHAR COUNTER + PREVIEW ============ */

function _updateCharCount(input, countEl, max) {
    if (!input || !countEl) return;
    const len = input.value.length;
    countEl.textContent = `${len}/${max}`;
    countEl.style.color = len > max ? 'var(--error)' : 'var(--text-tertiary)';
    if (len > max) input.value = input.value.slice(0, max);
}

function _updatePreview() {
    if (!_previewTitleEl || !_previewBodyEl || !_previewTypeEl) return;
    const title = _titleInput?.value || 'Special Offer!';
    const body  = _bodyInput?.value  || '20% off all pizzas today only!';
    const type  = document.querySelector('input[name="pushNotifType"]:checked')?.value || 'order';
    const info  = TYPE_INFO[type] || TYPE_INFO.order;

    _previewTitleEl.textContent = title || 'Special Offer!';
    _previewBodyEl.textContent  = body || '20% off all pizzas today only!';
    _previewTypeEl.textContent  = info.label;
    _previewTypeEl.style.color  = info.color;
    _previewTypeEl.style.backgroundColor = info.color + '15';
}

/* ============ PUSH SUBSCRIPTIONS ============ */

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

/* ============ SEND NOTIFICATION ============ */

async function _sendPushNotification() {
    const title = _titleInput?.value?.trim();
    const body  = _bodyInput?.value?.trim();
    const testMode = _testModeCb?.checked;
    const type = document.querySelector('input[name="pushNotifType"]:checked')?.value || 'order';

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
            body: JSON.stringify({
                title,
                body,
                data: {
                    testMode: testMode ? 'true' : 'false',
                    type,
                    typeLabel: TYPE_INFO[type]?.label || type,
                }
            })
        });

        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Send failed');

        const sent   = result.sent ?? 0;
        const failed = result.failed ?? 0;
        showToast(
            `Notification sent to ${sent} device${sent !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`,
            'success'
        );
        _titleInput.value = '';
        _bodyInput.value  = '';
        _updateCharCount(_titleInput, document.getElementById('pushTitleCount'), 100);
        _updateCharCount(_bodyInput, document.getElementById('pushBodyCount'), 300);
        _updatePreview();
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
