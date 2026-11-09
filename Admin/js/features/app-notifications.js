/**
 * FoodHubbie ERP | APP NOTIFICATIONS MODULE
 * Standalone top-level tab: "App Notifications"
 * Sends push notifications (FCM) to customers who installed the restaurant's app.
 *
 * The rules below mirror bot-control-api /tenant-api/notify, so the screen can
 * never promise a delivery the server will refuse:
 *  - order  -> transactional: ONE customer, ignores the offers opt-in, never
 *              paused by quiet hours.
 *  - promo / loyalty / system -> marketing: only customers with offers on,
 *              suppressed 21:00-09:00 IST, max 3 per customer per IST day.
 *  - test mode -> the signed-in admin's own device token only.
 */

import { db, auth, Outlet, BUSINESS_ID, ref, get } from '../firebase.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { formatDate } from '../utils.js';
import { loadLucide } from '../ui.js';
import { logger } from '../utils/logger.js';
import { appLink } from '../../shared/app-link.js';

const $ = (id) => document.getElementById(id);

// type -> label + lucide icon + accent colour + the honest one-line rule
const TYPE_INFO = {
    promo:   { label: 'Offer / Promo', icon: 'tag',       color: '#7b1fa2', hint: 'Only customers who kept offers on. Paused 9 PM-9 AM IST, max 3 a day.' },
    loyalty: { label: 'Loyalty',       icon: 'gem',       color: '#1a73e8', hint: 'Points and rewards. Same limits as offers.' },
    system:  { label: 'Store update',  icon: 'megaphone', color: '#475569', hint: 'Hours, closures, new menu. Same limits as offers.' },
    order:   { label: 'Order update',  icon: 'receipt',   color: '#e84908', hint: 'Goes to one customer. Order updates ignore the offer opt-in and are never paused.' },
};

let _subs = [];        // [{ key, phone, name, offers, updatedAt }]
let _wired = false;    // listeners are bound once - loadTabData re-runs on every visit
let _loaded = false;   // subscriber snapshot has landed at least once
let _loadError = false;
let _sending = false;
let _deviceReady = false;
let _iconType = '';    // last type whose preview icon was rendered

export function loadAppNotifications() {
    logger.info('APP-NOTIF', 'Loading App Notifications tab…');
    _wireOnce();
    _renderAppLink();
    _checkDevice();
    _loadPushSubscriptions();
    _syncUi();
}

export function cleanupAppNotifications() {
    // Listeners live on the persistent pane; only transient state resets here.
    _sending = false;
}

/* ============ WIRING (once) ============ */

function _wireOnce() {
    if (_wired) return;
    _wired = true;

    $('btnSendPushNotif')?.addEventListener('click', _sendPushNotification);
    $('btnRefreshPushSubs')?.addEventListener('click', () => _loadPushSubscriptions(true));
    $('btnCopyPushAppLink')?.addEventListener('click', _copyAppLink);

    $('pushNotifTitle')?.addEventListener('input', () => {
        _updateCount('pushNotifTitle', 'pushTitleCount', 100);
        _updatePreviewText();
    });
    $('pushNotifBody')?.addEventListener('input', () => {
        _updateCount('pushNotifBody', 'pushBodyCount', 300);
        _updatePreviewText();
    });

    document.querySelectorAll('input[name="pushNotifType"]').forEach(rb => {
        rb.addEventListener('change', _onTypeChange);
    });
    document.querySelectorAll('input[name="pushAudience"]').forEach(rb => {
        rb.addEventListener('change', _syncUi);
    });

    $('pushNotifPhone')?.addEventListener('input', () => {
        const el = $('pushNotifPhone');
        if (el) el.value = el.value.replace(/\D/g, '').slice(0, 10);
        _syncUi();
    });
    $('pushNotifTestMode')?.addEventListener('change', _syncUi);

    document.querySelectorAll('.tpl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.tpl || 'promo';
            const radio = document.querySelector(`input[name="pushNotifType"][value="${type}"]`);
            if (radio) { radio.checked = true; _onTypeChange(); }
            if ($('pushNotifTitle')) $('pushNotifTitle').value = btn.dataset.title || '';
            if ($('pushNotifBody')) $('pushNotifBody').value = btn.dataset.body || '';
            _updateCount('pushNotifTitle', 'pushTitleCount', 100);
            _updateCount('pushNotifBody', 'pushBodyCount', 300);
            _updatePreviewText();
            _syncUi();
        });
    });
}

function _onTypeChange() {
    // Order updates are transactional: they can only go to one customer.
    if (_currentType() === 'order') {
        const one = document.querySelector('input[name="pushAudience"][value="one"]');
        if (one) one.checked = true;
        $('pushNotifPhone')?.focus();
    }
    _syncUi();
}

/* ============ SUBSCRIBERS ============ */

async function _loadPushSubscriptions(manual = false) {
    try {
        const snap = await get(Outlet.ref('pushSubscriptions'));
        const raw = snap.val() || {};
        _subs = Object.entries(raw).map(([key, s]) => {
            const phone = String(s?.phone || '').replace(/\D/g, '').slice(-10);
            return {
                key,
                phone: /^[6-9]\d{9}$/.test(phone) ? phone : '',
                name: String(s?.name || ''),
                // Mirrors the server: a record without prefs predates consent.
                offers: !s?.prefs || s.prefs.offers === true,
                updatedAt: Number(s?.updatedAt || 0),
            };
        });
        _loadError = false;
        _renderSubs();
        if (manual) {
            const n = _subs.length;
            showToast(`${n} subscriber${n === 1 ? '' : 's'} loaded`, 'success');
        }
    } catch (e) {
        console.error('[Push] Failed to load subscriptions:', e);
        _loadError = true;
        if ($('pushSubCount')) $('pushSubCount').textContent = '—';
        if ($('pushOffersReach')) $('pushOffersReach').textContent = '—';
        if ($('pushSubUpdated')) $('pushSubUpdated').textContent = '—';
        if (manual) showToast('Could not load subscribers', 'error');
    }
    _loaded = true;
    _syncUi();
}

function _renderSubs() {
    const total = _subs.length;
    const offers = _subs.filter(s => s.offers).length;
    const latest = _subs.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);

    if ($('pushSubCount')) $('pushSubCount').textContent = String(total);
    if ($('pushOffersReach')) $('pushOffersReach').textContent = String(offers);
    if ($('pushSubUpdated')) $('pushSubUpdated').textContent = latest ? formatDate(latest) : '—';

    $('pushEmptyState')?.classList.toggle('hidden', total > 0);

    const dl = $('pushSubPhones');
    if (dl) {
        dl.innerHTML = '';
        _subs.filter(s => s.phone)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 25)
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.phone;
                opt.label = s.name || s.phone;
                dl.appendChild(opt);
            });
    }
}

async function _checkDevice() {
    const uid = auth.currentUser?.uid;
    _deviceReady = false;
    if (uid) {
        try {
            const snap = await get(ref(db, `admins/${uid}/fcmToken`));
            _deviceReady = !!snap.val();
        } catch { /* offline or denied -> treat as not ready */ }
    }
    _syncUi();
}

function _renderAppLink() {
    const el = $('pushAppLink');
    if (!el) return;
    const link = appLink(BUSINESS_ID(), Outlet.current);
    el.value = link || '';
    el.placeholder = link ? '' : 'Business or outlet id missing';
    const btn = $('btnCopyPushAppLink');
    if (btn) btn.disabled = !link;
}

async function _copyAppLink() {
    const el = $('pushAppLink');
    if (!el?.value) return;
    try {
        await navigator.clipboard.writeText(el.value);
        showToast('App link copied', 'success');
    } catch {
        el.select();
        try {
            document.execCommand('copy');
            showToast('App link copied', 'success');
        } catch {
            showToast('Copy failed - select the link and copy manually', 'error');
        }
    }
}

/* ============ STATE HELPERS ============ */

function _currentType() {
    return document.querySelector('input[name="pushNotifType"]:checked')?.value || 'promo';
}

function _currentAudience() {
    return document.querySelector('input[name="pushAudience"]:checked')?.value || 'all';
}

function _phone() {
    return ($('pushNotifPhone')?.value || '').replace(/\D/g, '').slice(0, 10);
}

function _isQuietHours() {
    const now = new Date();
    const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
    return istHour >= 21 || istHour < 9;
}

/**
 * Single decision table for "can this go out, and to how many".
 * @returns {{ok:boolean, count:number, reason:string, note?:string}}
 */
function _evaluate() {
    const type = _currentType();
    const aud = _currentAudience();
    const phone = _phone();
    const total = _subs.length;
    const offers = _subs.filter(s => s.offers).length;
    const testMode = !!$('pushNotifTestMode')?.checked;

    if (_sending) return { ok: false, count: 0, reason: 'Sending…' };
    if (!_loaded) return { ok: false, count: 0, reason: 'Checking subscribers…' };
    if (_loadError) return { ok: false, count: 0, reason: 'Subscribers could not be loaded.', note: 'Press Refresh to try again.' };

    if (testMode) {
        return _deviceReady
            ? { ok: true, count: 1, reason: '' }
            : { ok: false, count: 0, reason: 'No push token on your admin account yet.', note: 'Enable notifications from the bell prompt, then reload this page.' };
    }

    if (total === 0) return { ok: false, count: 0, reason: 'No subscribers yet.', note: 'Share your app link so customers can enable notifications.' };

    if (aud === 'one') {
        if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, count: 0, reason: 'Enter a 10-digit mobile number.' };
        const sub = _subs.find(s => s.phone === phone);
        if (!sub) return { ok: false, count: 0, reason: 'This number has no app notifications enabled.', note: 'Only customers who allowed notifications can receive a push.' };
        if (type !== 'order' && !sub.offers) return { ok: false, count: 0, reason: 'This customer turned offers off.', note: 'Send an Order update instead, or pick another customer.' };
        return { ok: true, count: 1, reason: '' };
    }

    // Broadcast - never allowed for transactional order updates.
    if (type === 'order') return { ok: false, count: 0, reason: 'Order updates go to one customer.' };
    if (offers === 0) return { ok: false, count: 0, reason: `0 of ${total} subscribers kept offers on.`, note: 'Customers can turn offers back on in the app.' };
    if (_isQuietHours()) return { ok: false, count: 0, reason: 'Offers pause 9 PM-9 AM IST.', note: 'Send after 9:00 AM, or use an Order update for one customer.' };
    return { ok: true, count: offers, reason: '' };
}

/* ============ RENDER ============ */

function _syncUi() {
    if (!$('btnSendPushNotif')) return;

    _syncTypeChips();
    _updatePreviewText();

    const aud = _currentAudience();
    const testMode = !!$('pushNotifTestMode')?.checked;
    const ev = _evaluate();

    $('pushPhoneWrap')?.classList.toggle('hidden', aud !== 'one');

    // "All subscribers" is impossible for a transactional order update.
    const allRadio = document.querySelector('input[name="pushAudience"][value="all"]');
    if (allRadio) allRadio.disabled = _currentType() === 'order';
    document.querySelectorAll('.push-aud').forEach(l => {
        l.classList.toggle('active', l.dataset.aud === aud);
    });

    const reach = $('pushReachLine');
    if (reach) {
        const total = _subs.length;
        reach.textContent = testMode
            ? (_deviceReady ? 'Test sends go to the device registered to your admin account.' : 'No push token on your admin account yet.')
            : (ev.reason || `Will reach ${ev.count} of ${total} subscriber${total === 1 ? '' : 's'}.`);
        reach.classList.toggle('is-warn', !ev.ok);
    }

    const pf = $('pushPreflight');
    if (pf) {
        if (!ev.ok && ev.reason) {
            pf.textContent = '';
            const strong = document.createElement('strong');
            strong.textContent = ev.reason;
            pf.appendChild(strong);
            if (ev.note) {
                const span = document.createElement('span');
                span.textContent = ev.note;
                pf.appendChild(span);
            }
            pf.classList.remove('hidden');
        } else {
            pf.textContent = '';
            pf.classList.add('hidden');
        }
    }

    const btn = $('btnSendPushNotif');
    if (btn) btn.disabled = _sending || !ev.ok;

    const label = $('pushSendLabel');
    if (label) {
        label.textContent = _sending ? 'Sending…'
            : testMode ? 'Send test to my device'
                : aud === 'one' ? `Send to ${_phone() || 'customer'}`
                    : `Send to ${ev.count} subscriber${ev.count === 1 ? '' : 's'}`;
    }

    const testHint = $('pushTestHint');
    if (testHint) {
        testHint.textContent = _deviceReady
            ? 'Test sends go to the device registered to your admin account.'
            : 'No push token on your admin account yet - enable notifications from the bell prompt, then reload.';
    }

    const phoneHint = $('pushPhoneHint');
    if (phoneHint) {
        const withPhone = _subs.filter(s => s.phone).length;
        phoneHint.textContent = withPhone
            ? `${withPhone} subscriber${withPhone === 1 ? '' : 's'} with a number on file - start typing to pick one.`
            : 'No subscriber has a number on file yet.';
    }
}

function _syncTypeChips() {
    const type = _currentType();
    const info = TYPE_INFO[type] || TYPE_INFO.promo;

    document.querySelectorAll('.push-type').forEach(l => {
        l.classList.toggle('active', l.dataset.type === type);
    });

    if ($('pushTypeHint')) $('pushTypeHint').textContent = info.hint;

    const badge = $('pushPreviewType');
    if (badge) {
        badge.textContent = info.label;
        badge.style.color = info.color;
        badge.style.backgroundColor = info.color + '15';
    }

    if (_iconType !== type) {
        _iconType = type;
        const tile = $('pushPreviewIcon');
        if (tile) {
            tile.innerHTML = `<i data-lucide="${info.icon}"></i>`;
            tile.style.color = info.color;
            tile.style.backgroundColor = info.color + '14';
            loadLucide()
                .then(() => window.lucide?.createIcons({ root: tile }))
                .catch(() => { /* CDN blocked - text fallback is fine */ });
        }
    }
}

function _updatePreviewText() {
    const title = $('pushNotifTitle')?.value || '';
    const body = $('pushNotifBody')?.value || '';
    if ($('pushPreviewTitle')) $('pushPreviewTitle').textContent = title || '20% off today only';
    if ($('pushPreviewBody')) $('pushPreviewBody').textContent = body || 'Use code PIZZA20 in the app. Valid till 11 PM.';
}

function _updateCount(inputId, countId, max) {
    const input = $(inputId);
    const countEl = $(countId);
    if (!input || !countEl) return;
    if (input.value.length > max) input.value = input.value.slice(0, max);
    const len = input.value.length;
    countEl.textContent = `${len}/${max}`;
    countEl.style.color = len >= max ? 'var(--error)' : 'var(--text-tertiary)';
}

const TONE_CLASS = { ok: 'is-ok', warn: 'is-warn', error: 'is-error' };

function _showResult(tone, text) {
    const el = $('pushSendResult');
    if (!el) return;
    // Literal class names on purpose: PurgeCSS reads the source text, so
    // 'is-' + tone would be stripped out of style.css and the panel would
    // render as plain unstyled text.
    el.className = `push-result ${TONE_CLASS[tone] || TONE_CLASS.error}`;
    el.textContent = text;
}

function _timeNow() {
    try {
        return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

/* ============ SEND ============ */

async function _sendPushNotification() {
    const ev = _evaluate();
    if (!ev.ok) {
        showToast(ev.reason || 'Cannot send yet', 'warning');
        return;
    }

    const title = ($('pushNotifTitle')?.value || '').trim();
    const body = ($('pushNotifBody')?.value || '').trim();
    if (!title || !body) {
        showToast('Title and message are required', 'warning');
        return;
    }

    const type = _currentType();
    const aud = _currentAudience();
    const phone = _phone();
    const testMode = !!$('pushNotifTestMode')?.checked;

    if (!testMode && aud === 'all') {
        const ok = await showConfirm(
            `Send "${title}" to ${ev.count} subscriber${ev.count === 1 ? '' : 's'}? This cannot be undone.`,
            'Send notification'
        );
        if (!ok) return;
    }

    _sending = true;
    _syncUi();
    await loadLucide().catch(() => {});
    if (window.lucide && $('btnSendPushNotif')) {
        window.lucide.createIcons({ root: $('btnSendPushNotif').parentNode });
    }

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
                // type must be top-level: the server defaults an absent type to
                // 'promo', which would filter by offers consent and quiet hours
                // even for a transactional order update.
                type,
                audience: aud === 'one' ? 'phone' : 'all',
                ...(aud === 'one' ? { phone } : {}),
                testMode,
                data: {
                    testMode: testMode ? 'true' : 'false',
                    type,
                    typeLabel: TYPE_INFO[type]?.label || type,
                }
            })
        });

        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(result.error || `Send failed (${resp.status})`);

        const sent = Number(result.sent || 0);
        const failed = Number(result.failed || 0);
        const attempted = Number(result.total || 0);
        const skipped = aud === 'all' && !testMode ? Math.max(0, _subs.length - attempted) : 0;

        if (sent === 0) {
            const why = testMode
                ? 'No push token on this device - enable notifications, then try again.'
                : (result.message || 'No device received it. Subscribers may have notifications turned off.');
            _showResult('warn', why);
            showToast(why, 'warning');
        } else {
            const bits = [`Sent to ${sent} device${sent === 1 ? '' : 's'}`];
            if (failed) bits.push(`${failed} failed`);
            if (skipped > 0) bits.push(`${skipped} skipped (offers off or daily limit)`);
            bits.push(_timeNow());
            _showResult('ok', bits.join(' · '));
            showToast(`Notification sent to ${sent} device${sent === 1 ? '' : 's'}`, 'success');

            if ($('pushNotifTitle')) $('pushNotifTitle').value = '';
            if ($('pushNotifBody')) $('pushNotifBody').value = '';
            _updateCount('pushNotifTitle', 'pushTitleCount', 100);
            _updateCount('pushNotifBody', 'pushBodyCount', 300);
            _updatePreviewText();
        }

        // Dead tokens are pruned server-side, so the count may have changed.
        _loadPushSubscriptions();
    } catch (e) {
        console.error('[Push] Send failed:', e);
        const raw = e?.message || '';
        const msg = /failed to fetch|networkerror|load failed|network request failed/i.test(raw)
            ? 'Could not reach the notification service. Check your connection and try again.'
            : (raw || 'Failed to send notification');
        _showResult('error', msg);
        showToast(msg, 'error');
    } finally {
        _sending = false;
        _syncUi();
        await loadLucide().catch(() => {});
        if (window.lucide && $('btnSendPushNotif')) {
            window.lucide.createIcons({ root: $('btnSendPushNotif').parentNode });
        }
    }
}

function _getAdminAuthToken() {
    return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}

// ponytail: single consumer - cache on window; promote to shared config when a second caller appears
async function _notifyBase() {
    if (window.TUNNEL_URL) return window.TUNNEL_URL;
    try {
        const snap = await get(ref(db, 'config/tunnelUrl'));
        const url = snap.val();
        if (url) window.TUNNEL_URL = url;
    } catch { /* fall through -> hosting origin 404 with honest error */ }
    return window.TUNNEL_URL || '';
}
