/**
 * FoodHubbie ERP | APP NOTIFICATIONS MODULE (sub-module of Customer APP)
 * Handles push notification sending inside the Customer APP tab's
 * "App Notification" pane.
 *
 * Exports individual functions so customer-app.js can drive the UI:
 *  - initPushUI()      — wire events + load subscribers/history/device
 *  - loadPushSubscriptions() — refresh subscriber stats
 *  - loadHistory()     — refresh send history
 *  - checkDevice()     — check admin FCM token for test mode
 *  - renderAppLink()   — render the customer app link
 *
 * The rules below mirror bot-control-api /tenant-api/notify:
 *  - order  -> transactional: ONE customer, ignores offers opt-in, never
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
import { logChange } from './audit-trail.js';
// The notify endpoint has a second caller now (the Customers notification
// checklist), so the URL, the bearer token, the server-anchored IST clock and
// the POST itself live in notify-client.js instead of being copied.
import {
    syncServerClock, istHour, isQuietHours, adminAuthToken, notifyBase, sendNotify,
} from './notify-client.js';

const $ = (id) => document.getElementById(id);

// type -> label + lucide icon + accent colour + the honest one-line rule
const TYPE_INFO = {
    promo:   { label: 'Offer / Promo', icon: 'tag',       color: '#7b1fa2', hint: 'Only customers who kept offers on. Paused 9 PM-9 AM IST, max 3 a day.' },
    loyalty: { label: 'Loyalty',       icon: 'gem',       color: '#1a73e8', hint: 'Points and rewards. Same limits as offers.' },
    system:  { label: 'Store update',  icon: 'megaphone', color: '#475569', hint: 'Hours, closures, new menu. Same limits as offers.' },
    order:   { label: 'Order update',  icon: 'receipt',   color: '#e84908', hint: 'Goes to one customer. Order updates ignore the offer opt-in and are never paused.' },
};

let _subs = [];        // [{ key, phone, name, offers, hasToken, updatedAt }]
let _wired = false;    // listeners are bound once
let _loaded = false;   // subscriber snapshot has landed at least once
let _loadError = false;
let _sending = false;
let _deviceReady = false;
let _iconType = '';    // last type whose preview icon was rendered
let _history = [];     // recent accepted sends, newest first (server-capped at 20)
let _searchQuery = ''; // subscriber search text
let _subFilter = 'all'; // 'all' | 'offers' | 'no-offers' | 'recent'
let _draftKey = '';    // localStorage key for this outlet's draft
let _undoTimer = null; // undo-after-send timer
let _undoEntry = null; // { key, title, body, type, audience, phone, at }
let _templates = [];   // custom templates [{ id, name, title, body, type, createdAt, updatedAt }]

/**
 * Initialise the push notification UI inside the Customer APP notification pane.
 * Call this from customer-app.js when the "App Notification" sub-tab is shown.
 */
export async function initPushUI() {
    logger.info('APP-NOTIF', 'Initialising push notification UI…');
    _wireOnce();
    renderAppLink();
    await syncServerClock();
    await checkDevice();
    await loadPushSubscriptions();
    await loadHistory();
    _loadDraft();
    _loadTemplates();
    _wireKeyboard();
    _syncUi();
}

export function cleanupPushUI() {
    _sending = false;
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
}

/* ============ WIRING (once) ============ */

function _wireOnce() {
    if (_wired) return;
    _wired = true;

    $('btnSendPushNotif')?.addEventListener('click', _sendPushNotification);
    // Refresh subscriber count is wired from customer-app.js on #caRefreshSubs.
    $('btnCopyPushAppLink')?.addEventListener('click', _copyAppLink);
    $('btnDownloadQr')?.addEventListener('click', _downloadQr);

    $('pushNotifTitle')?.addEventListener('input', () => {
        _updateCount('pushNotifTitle', 'pushTitleCount', 100);
        _updatePreviewText();
        _syncUi();
        _saveDraft();
    });
    $('pushNotifBody')?.addEventListener('input', () => {
        _updateCount('pushNotifBody', 'pushBodyCount', 300);
        _updatePreviewText();
        _syncUi();
        _saveDraft();
    });

    document.querySelectorAll('input[name="pushNotifType"]').forEach(rb => {
        rb.addEventListener('change', () => { _onTypeChange(); _saveDraft(); });
    });
    document.querySelectorAll('input[name="pushAudience"]').forEach(rb => {
        rb.addEventListener('change', () => { _syncUi(); _saveDraft(); });
    });

    $('pushNotifPhone')?.addEventListener('input', () => {
        const el = $('pushNotifPhone');
        if (el) el.value = el.value.replace(/\D/g, '').slice(0, 10);
        _syncUi();
        _saveDraft();
    });
    $('pushNotifTestMode')?.addEventListener('change', () => { _syncUi(); _saveDraft(); });

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

    $('btnManageTemplates')?.addEventListener('click', _openTemplatesModal);

    // Subscriber search & filter
    $('pushSubSearch')?.addEventListener('input', (e) => {
        _searchQuery = e.target.value;
        _renderSubscribersList();
        _syncUi();
    });
    document.querySelectorAll('input[name="pushSubFilter"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _subFilter = e.target.value;
            _renderSubscribersList();
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

/* ============ SUBSCRIBER SEARCH & FILTER ============ */

/** Filter subscribers by search text and filter chip. */
function _filterSubs() {
    const q = _searchQuery.toLowerCase();
    return _subs.filter(s => {
        const matchText = !q || String(s.name || '').toLowerCase().includes(q) || String(s.phone || '').includes(q);
        if (!matchText) return false;
        if (_subFilter === 'offers') return s.offers === true;
        if (_subFilter === 'no-offers') return s.offers === false;
        if (_subFilter === 'recent') {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            return s.updatedAt >= thirtyDaysAgo;
        }
        return true;
    });
}

/** Render the subscriber list (used by the datalist and a future list panel). */
function _renderSubscribersList() {
    const dl = $('pushSubPhones');
    if (!dl) return;
    dl.innerHTML = '';
    const filtered = _filterSubs();
    filtered
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 50)
        .forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.phone;
            opt.label = s.name || s.phone;
            dl.appendChild(opt);
        });
}

/* ============ DRAFTS (auto-save to localStorage) ============ */

function _draftStorageKey() {
    const bid = BUSINESS_ID();
    const oid = Outlet.current;
    return `fh:pushDraft:${bid}:${oid}`;
}

function _saveDraft() {
    const title = $('pushNotifTitle')?.value || '';
    const body = $('pushNotifBody')?.value || '';
    const type = _currentType();
    const aud = _currentAudience();
    const phone = _phone();
    const testMode = !!$('pushNotifTestMode')?.checked;
    const draft = { title, body, type, audience: aud, phone, testMode, updatedAt: Date.now() };
    try {
        localStorage.setItem(_draftStorageKey(), JSON.stringify(draft));
    } catch { /* localStorage unavailable - silently skip */ }
}

function _loadDraft() {
    try {
        const raw = localStorage.getItem(_draftStorageKey());
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d || typeof d !== 'object') return;
        if ($('pushNotifTitle') && d.title !== undefined) $('pushNotifTitle').value = d.title;
        if ($('pushNotifBody') && d.body !== undefined) $('pushNotifBody').value = d.body;
        if ($('pushNotifTestMode') && d.testMode !== undefined) $('pushNotifTestMode').checked = d.testMode === true;
        const typeRadio = document.querySelector(`input[name="pushNotifType"][value="${d.type}"]`);
        if (typeRadio) typeRadio.checked = true;
        const audRadio = document.querySelector(`input[name="pushAudience"][value="${d.audience || 'all'}"]`);
        if (audRadio) audRadio.checked = true;
        if ($('pushNotifPhone') && d.phone) $('pushNotifPhone').value = d.phone;
        _onTypeChange();
        _updateCount('pushNotifTitle', 'pushTitleCount', 100);
        _updateCount('pushNotifBody', 'pushBodyCount', 300);
        _updatePreviewText();
        _syncUi();
    } catch { /* corrupt draft - ignore */ }
}

function _clearDraft() {
    try { localStorage.removeItem(_draftStorageKey()); } catch { /* ignore */ }
}

/* ============ TEMPLATES LIBRARY (localStorage + RTDB later) ============ */

function _templatesStorageKey() {
    const bid = BUSINESS_ID();
    const oid = Outlet.current;
    return `fh:pushTemplates:${bid}:${oid}`;
}

async function _loadTemplates() {
    try {
        const raw = localStorage.getItem(_templatesStorageKey());
        if (!raw) { _templates = []; return; }
        _templates = JSON.parse(raw);
        if (!Array.isArray(_templates)) _templates = [];
    } catch { _templates = []; }
}

function _saveTemplates() {
    try {
        localStorage.setItem(_templatesStorageKey(), JSON.stringify(_templates));
    } catch { /* ignore */ }
}

function _insertTemplate(tmpl) {
    if ($('pushNotifTitle')) $('pushNotifTitle').value = tmpl.title || '';
    if ($('pushNotifBody')) $('pushNotifBody').value = tmpl.body || '';
    const typeRadio = document.querySelector(`input[name="pushNotifType"][value="${tmpl.type || 'promo'}"]`);
    if (typeRadio) { typeRadio.checked = true; _onTypeChange(); }
    _updateCount('pushNotifTitle', 'pushTitleCount', 100);
    _updateCount('pushNotifBody', 'pushBodyCount', 300);
    _updatePreviewText();
    _syncUi();
}

async function _saveTemplate(name, title, body, type) {
    const now = Date.now();
    const tmpl = {
        id: 'tpl_' + now + '_' + Math.random().toString(36).slice(2, 7),
        name: name || 'Untitled',
        title: title || '',
        body: body || '',
        type: type || 'promo',
        createdAt: now,
        updatedAt: now,
    };
    _templates.push(tmpl);
    _saveTemplates();
    return tmpl;
}

async function _deleteTemplate(id) {
    _templates = _templates.filter(t => t.id !== id);
    _saveTemplates();
}

function _openTemplatesModal() {
    const existing = $('pushTemplatesModal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.id = 'pushTemplatesModal';
    modal.className = 'dynamic-modal-overlay active';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Notification Templates');
    modal.innerHTML = `
        <div class="dynamic-modal-box" style="max-width:640px;">
            <div class="dynamic-modal-header">
                <h3 class="dynamic-modal-title">Notification Templates</h3>
                <button class="btn-close" onclick="this.closest('.dynamic-modal-overlay').remove()">&times;</button>
            </div>
            <div class="dynamic-modal-body" style="padding:16px;">
                <div class="form-group mt-8">
                    <label class="text-muted-small">Template Name</label>
                    <input type="text" id="tplName" class="search-input-group" placeholder="e.g. Weekend Promo">
                </div>
                <div class="form-group mt-8">
                    <label class="text-muted-small">Title</label>
                    <input type="text" id="tplTitle" class="search-input-group" placeholder="Notification title">
                </div>
                <div class="form-group mt-8">
                    <label class="text-muted-small">Message</label>
                    <textarea id="tplBody" rows="3" class="search-input-group" placeholder="Notification message"></textarea>
                </div>
                <div class="form-group mt-8">
                    <label class="text-muted-small">Type</label>
                    <div class="flex-row flex-gap-8" role="radiogroup">
                        <label class="chip chip--radio"><input type="radio" name="tplType" value="promo" checked> Offer / Promo</label>
                        <label class="chip chip--radio"><input type="radio" name="tplType" value="loyalty"> Loyalty</label>
                        <label class="chip chip--radio"><input type="radio" name="tplType" value="system"> Store Update</label>
                        <label class="chip chip--radio"><input type="radio" name="tplType" value="order"> Order Update</label>
                    </div>
                </div>
                <div id="tplList" style="margin-top:16px; max-height:300px; overflow-y:auto; border:1px solid var(--border,#e5e7eb); border-radius:8px;">
                    ${_renderTemplatesList()}
                </div>
            </div>
            <div class="dynamic-modal-actions" style="display:flex; gap:8px; justify-content:flex-end;">
                <button class="btn-secondary" id="tplCancel">Cancel</button>
                <button class="btn-primary" id="tplSave">Save Template</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    $('tplCancel')?.addEventListener('click', () => modal.remove());
    $('tplSave')?.addEventListener('click', () => {
        const name = $('tplName')?.value || '';
        const title = $('tplTitle')?.value || '';
        const body = $('tplBody')?.value || '';
        const type = document.querySelector('input[name="tplType"]:checked')?.value || 'promo';
        if (!title || !body) { showToast('Title and message are required', 'warning'); return; }
        _saveTemplate(name, title, body, type);
        $('tplList').innerHTML = _renderTemplatesList();
        $('tplName').value = ''; $('tplTitle').value = ''; $('tplBody').value = '';
        showToast('Template saved', 'success');
    });

    // Delegate delete/insert clicks on template rows
    modal.querySelectorAll('[data-tpl-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.tplAction;
            const id = btn.dataset.tplId;
            if (action === 'delete') { _deleteTemplate(id); $('tplList').innerHTML = _renderTemplatesList(); }
            else if (action === 'insert') {
                const tmpl = _templates.find(t => t.id === id);
                if (tmpl) { _insertTemplate(tmpl); modal.remove(); }
            }
        });
    });
}

function _renderTemplatesList() {
    if (_templates.length === 0) {
        return '<div style="padding:16px;color:var(--text-tertiary);">No custom templates yet. Create one below.</div>';
    }
    return _templates.map(t => `
        <div style="padding:10px 12px; border-bottom:1px solid var(--border,#eef0f3); display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div style="flex:1; min-width:0;">
                <div style="font-weight:600; color:var(--text-primary);">${_escHtml(t.name)}</div>
                <div style="font-size:12px; color:var(--text-tertiary);">${_escHtml(t.title || '')}</div>
                <div style="font-size:11px; color:var(--text-tertiary);">${t.type} • ${new Date(t.updatedAt).toLocaleDateString()}</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
                <button class="btn-secondary" style="font-size:11px; padding:4px 8px;" data-tpl-action="insert" data-tpl-id="${t.id}">Use</button>
                <button class="btn-secondary" style="font-size:11px; padding:4px 8px; color:var(--error);" data-tpl-action="delete" data-tpl-id="${t.id}">Delete</button>
            </div>
        </div>
    `).join('');
}

/* ============ AFTER A SEND ============ */

/**
 * A delivered push cannot be pulled back: FCM has no recall, and the send
 * history (`notifyLog`) is written by the server and READ-ONLY for the
 * client (database.rules.json grants no client write). The old "Mark as
 * recalled" button therefore did nothing at all - it promised a recall the
 * platform cannot perform. This offers the honest alternative: flag the
 * send in the Activity trail so the team has a record of it.
 */
function _scheduleUndo(entry) {
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    _undoEntry = entry;
    const el = $('pushSendResult');
    if (el) {
        el.className = 'push-result is-ok';
        el.textContent = 'Sent. ';
        const flagBtn = document.createElement('button');
        flagBtn.className = 'btn-secondary btn-sm';
        flagBtn.textContent = 'Flag as sent in error';
        flagBtn.style.marginLeft = '8px';
        flagBtn.onclick = () => _flagSendError();
        el.appendChild(flagBtn);
    }
    _undoTimer = setTimeout(() => {
        _undoTimer = null;
        _undoEntry = null;
        if (el) el.textContent = 'Sent.';
    }, 5000);
}

async function _flagSendError() {
    if (!_undoEntry) return;
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    const entry = _undoEntry;
    _undoEntry = null;
    await logChange(
        'recall',
        'push notification',
        entry.title || '',
        { type: entry.type, audience: entry.audience, phone: entry.phone, sentAt: entry.at },
        { flagged: true }
    );
    const el = $('pushSendResult');
    if (el) {
        el.className = 'push-result is-warn';
        el.textContent = 'Flagged in the activity trail. A push that was already delivered cannot be pulled back.';
    }
    showToast('Flagged in the activity trail', 'info');
    _syncUi();
}

/* ============ KEYBOARD SHORTCUTS ============ */

function _wireKeyboard() {
    document.addEventListener('keydown', (e) => {
        // Only handle when the notification pane is visible
        const pane = $('caPaneNotification');
        if (!pane || pane.classList.contains('hidden')) return;

        // Ctrl+Enter -> Send
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            const btn = $('btnSendPushNotif');
            if (btn && !btn.disabled) _sendPushNotification();
        }
        // Ctrl+. -> Toggle test mode
        if (e.ctrlKey && e.key === '.') {
            e.preventDefault();
            const cb = $('pushNotifTestMode');
            if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        }
        // Escape -> Clear composer
        if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            const target = e.target;
            const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
            if (!isInput) {
                const title = $('pushNotifTitle');
                const body = $('pushNotifBody');
                if (title && title.value) { title.value = ''; _updateCount('pushNotifTitle', 'pushTitleCount', 100); }
                if (body && body.value) { body.value = ''; _updateCount('pushNotifBody', 'pushBodyCount', 300); }
                if (title || body) { _updatePreviewText(); _syncUi(); }
            }
        }
    });
}

/* ============ SUBSCRIBERS ============ */

export async function loadPushSubscriptions(manual = false) {
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
                // The server only pushes to records that carry a token
                // (tenantNotify: entries.map(e => e.token).filter(Boolean)),
                // so a record without one is a subscriber whose device cannot
                // be reached - it must not be counted as reachable.
                hasToken: !!s?.token,
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
    // "Offers reachable" = subscribers who kept offers on AND have a device
    // token on file - the server can push to nobody else.
    const reach = _reachable('promo').length;
    const latest = _subs.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0);

    if ($('pushSubCount')) $('pushSubCount').textContent = String(total);
    if ($('pushOffersReach')) $('pushOffersReach').textContent = String(reach);
    if ($('pushSubUpdated')) $('pushSubUpdated').textContent = latest ? formatDate(latest) : '—';

    // Native tooltips carry the "what exactly is this number" answer without
    // adding another line of copy to the pane.
    const subCard = $('pushSubCount')?.closest('.stat-card');
    if (subCard) subCard.title = 'Subscription records in this outlet. A record can lose its device token.';
    const reachCard = $('pushOffersReach')?.closest('.stat-card');
    if (reachCard) reachCard.title = 'Subscribers who kept offers on AND have a device token on file.';

    $('pushEmptyState')?.classList.toggle('hidden', total > 0);

    const filtered = _filterSubs();
    const dl = $('pushSubPhones');
    if (dl) {
        dl.innerHTML = '';
        filtered
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 50)
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.phone;
                opt.label = s.name || s.phone;
                dl.appendChild(opt);
            });
    }

    // Show filter count if filtering
    const countEl = $('pushSubFilterCount');
    if (countEl) {
        if (_searchQuery || _subFilter !== 'all') {
            countEl.textContent = `${filtered.length} of ${total} subscriber${total === 1 ? '' : 's'} matched`;
        } else {
            countEl.textContent = '';
        }
    }

    // Show/hide the subs section based on whether there are subscribers
    const subsSection = $('pushSubsSection');
    if (subsSection) {
        subsSection.style.display = total > 0 ? '' : 'none';
    }
}

/* ============ SEND HISTORY ============ */

export async function loadHistory() {
    try {
        const snap = await get(Outlet.ref('notifyLog'));
        const raw = snap.val() || {};
        _history = Object.entries(raw)
            .map(([key, h]) => ({ key, ...h }))
            .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
            .slice(0, 20);
        _renderHistory();
    } catch (e) {
        // Informational only - never block the composer on history.
        console.error('[Push] Failed to load send history:', e);
    }
}

function _renderHistory() {
    const wrap = $('pushHistory');
    const list = $('pushHistoryList');
    if (!wrap || !list) return;
    wrap.classList.toggle('hidden', _history.length === 0);
    list.textContent = '';
    _history.forEach(h => {
        const info = TYPE_INFO[h.type] || TYPE_INFO.promo;
        const row = document.createElement('div');
        row.className = 'push-hist__row';

        const head = document.createElement('div');
        head.className = 'push-hist__head';

        const time = document.createElement('span');
        time.className = 'push-hist__time';
        time.textContent = formatDate(Number(h.at) || 0);

        const type = document.createElement('span');
        type.className = 'push-hist__type';
        type.textContent = info.label;

        head.append(time, type);

        if (h.test === true) {
            const badge = document.createElement('span');
            badge.className = 'push-hist__badge';
            badge.textContent = 'TEST';
            head.appendChild(badge);
        }

        const aud = document.createElement('span');
        aud.className = 'push-hist__aud';
        aud.textContent = h.audience === 'test' ? 'My device'
            : h.audience === 'phone' ? (h.phone ? `One · ${h.phone}` : 'One customer')
                : 'All subscribers';
        head.appendChild(aud);

        const res = document.createElement('span');
        res.className = 'push-hist__res';
        const bits = [`${Number(h.sent) || 0} sent`];
        if (Number(h.failed)) bits.push(`${h.failed} failed`);
        if (Number(h.inbox)) bits.push(`${h.inbox} in-app`);
        res.textContent = bits.join(' · ');
        head.appendChild(res);

        const title = document.createElement('div');
        title.className = 'push-hist__title';
        title.textContent = String(h.title || '');

        row.append(head, title);
        list.appendChild(row);
    });
}

export async function checkDevice() {
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

export function renderAppLink() {
    const el = $('pushAppLink');
    if (!el) return;
    const link = appLink(BUSINESS_ID(), Outlet.current);
    el.value = link || '';
    el.placeholder = link ? '' : 'Business or outlet id missing';
    const btn = $('btnCopyPushAppLink');
    if (btn) btn.disabled = !link;
    _renderQrCode(link || '');
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

function _renderQrCode(link) {
    const canvas = $('pushQrCanvas');
    if (!canvas || !link) return;
    canvas.width = 200;
    canvas.height = 200;
    canvas.getContext('2d').clearRect(0, 0, 200, 200);
    try {
        new QRCode(canvas, {
            text: link,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });
    } catch (e) {
        console.warn('[Push] QRCode render failed:', e);
    }
}

function _downloadQr() {
    const canvas = $('pushQrCanvas');
    const linkEl = $('pushAppLink');
    if (!canvas || !linkEl?.value) return;
    const link = linkEl.value;
    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `foodhubbie-app-qr-${BUSINESS_ID()}-${Outlet.current}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('QR code downloaded', 'success');
    }, 'image/png');
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

/**
 * Quiet hours belong to the SERVER (functions/src/shared/notify/caps.ts:
 * 21:00-09:00 IST, promo/offer only) and the IST hour is anchored to the
 * server clock in notify-client.js.
 *
 * Marketing types pause at night for EVERY audience: the server runs the
 * cap/quiet-hours check per recipient (notifyType = 'promo'), including
 * single-customer sends. Only transactional order updates pass.
 */
function _quietBlocked(type) {
    return type !== 'order' && isQuietHours();
}

/**
 * The subscribers the server can ACTUALLY reach for a type.
 *
 * The server pushes to `entries.map(e => e.token).filter(Boolean)`
 * (functions/src/api/tenantNotify.ts), so a subscription record without a
 * device token is a subscriber whose phone cannot be reached - counting it
 * would promise a push that never lands. Marketing types additionally need
 * the customer's offers preference ON (the server filters the same way).
 */
function _reachable(type) {
    const marketing = type !== 'order';
    return _subs.filter(s => s.hasToken && (!marketing || s.offers));
}

/** Why nobody can be reached: either no device token at all, or offers off. */
function _noReach(total) {
    const withToken = _subs.filter(s => s.hasToken).length;
    if (withToken === 0) return { ok: false, count: 0, reason: `0 of ${total} subscribers have a device token on file.`, note: 'A subscriber only gets a token after allowing notifications in the app.' };
    return { ok: false, count: 0, reason: `0 of ${total} subscribers kept offers on.`, note: 'Customers can turn offers back on in the app.' };
}

/**
 * Single decision table for "can this go out, and to how many".
 * `count` is an UPPER BOUND: the server suppresses anyone who already had
 * 3 marketing pushes today, so the real number can be lower.
 * @returns {{ok:boolean, count:number, reason:string, note?:string}}
 */
function _evaluate() {
    const type = _currentType();
    const aud = _currentAudience();
    const phone = _phone();
    const total = _subs.length;
    const testMode = !!$('pushNotifTestMode')?.checked;

    if (_sending) return { ok: false, count: 0, reason: 'Sending…' };
    // A test send only needs the admin's own device token - never gate it on
    // the subscriber list (a failed subscriptions read must not block a test).
    if (testMode) {
        return _deviceReady
            ? { ok: true, count: 1, reason: '', note: 'Test sends go only to your own device and ignore quiet hours and the daily limit.' }
            : { ok: false, count: 0, reason: 'No push token on your admin account yet.', note: 'Enable notifications from the bell prompt, then reload this page.' };
    }
    if (!_loaded) return { ok: false, count: 0, reason: 'Checking subscribers…' };
    if (_loadError) return { ok: false, count: 0, reason: 'Subscribers could not be loaded.', note: 'Press Refresh to try again.' };

    if (total === 0) return { ok: false, count: 0, reason: 'No subscribers yet.', note: 'Share your app link so customers can enable notifications.' };

    if (aud === 'one') {
        if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, count: 0, reason: 'Enter a 10-digit mobile number.' };
        // One phone can have several subscription records (one per device).
        const matches = _subs.filter(s => s.phone === phone);
        if (matches.length === 0) return { ok: false, count: 0, reason: 'This number has no app notifications enabled.', note: 'Only customers who allowed notifications can receive a push.' };
        const devices = matches.filter(s => s.hasToken).length;
        if (devices === 0) return { ok: false, count: 0, reason: 'This customer has no push token on file.', note: 'Their device registered without notifications, or the token has expired. Ask them to re-enable notifications in the app.' };
        if (type !== 'order' && !matches.some(s => s.offers)) return { ok: false, count: 0, reason: 'This customer turned offers off.', note: 'Send an Order update instead, or pick another customer.' };
        if (_quietBlocked(type)) return { ok: false, count: 0, reason: 'Offers pause 9 PM-9 AM IST.', note: 'Send after 9:00 AM - transactional Order updates are never paused.' };
        return {
            ok: true,
            count: devices,
            reason: '',
            note: type === 'order'
                ? 'Order updates ignore the offer opt-in and are never paused.'
                : 'This customer can get up to 3 offer pushes a day - the server skips anyone who already had 3 today.',
        };
    }

    // Broadcast - never allowed for transactional order updates.
    if (type === 'order') return { ok: false, count: 0, reason: 'Order updates go to one customer.' };
    const reach = _reachable(type).length;
    if (reach === 0) return _noReach(total);
    if (_quietBlocked(type)) return { ok: false, count: 0, reason: 'Offers pause 9 PM-9 AM IST.', note: 'Send after 9:00 AM, or use an Order update for one customer.' };
    return {
        ok: true,
        count: reach,
        reason: '',
        note: 'Each customer can receive up to 3 offer pushes a day - the server skips anyone who already had 3 today.',
    };
}

/* ============ RENDER ============ */

function _syncUi() {
    if (!$('btnSendPushNotif')) return;

    _syncTypeChips();
    _updatePreviewText();

    const aud = _currentAudience();
    const testMode = !!$('pushNotifTestMode')?.checked;
    const ev = _evaluate();
    // A blank composer must not look ready: the button's label promises a
    // recipient count, so gate it on content too (the send path re-checks).
    const contentOk = !!($('pushNotifTitle')?.value || '').trim() && !!($('pushNotifBody')?.value || '').trim();

    $('pushPhoneWrap')?.classList.toggle('hidden', aud !== 'one');

    // "All subscribers" is impossible for a transactional order update.
    const allRadio = document.querySelector('input[name="pushAudience"][value="all"]');
    if (allRadio) allRadio.disabled = _currentType() === 'order';
    document.querySelectorAll('.push-aud').forEach(l => {
        l.classList.toggle('active', l.dataset.aud === aud);
    });

    const reach = $('pushReachLine');
    const reachText = $('pushReachText');
    const reachNote = $('pushReachNote');
    const total = _subs.length;
    if (reach || reachText) {
        let text = '';
        if (testMode) {
            text = _deviceReady
                ? 'Test sends go to the device registered to your admin account.'
                : 'No push token on your admin account yet.';
        } else if (!ev.ok) {
            text = ev.reason || '';
        } else if (aud === 'one') {
            text = `Will reach ${_phone() || 'this customer'} on ${ev.count} device${ev.count === 1 ? '' : 's'}.`;
        } else {
            // "up to" because the server skips anyone who already had 3
            // marketing pushes today - the client cannot know that count.
            text = `Will reach up to ${ev.count} of ${total} subscriber${total === 1 ? '' : 's'}.`;
        }
        if (reachText) reachText.textContent = text;
        else if (reach) reach.textContent = text;
        reach?.classList.toggle('is-warn', !ev.ok);
    }
    // The note is the honest caveat under the headline number. When the send
    // is blocked, the preflight block below already shows reason + note.
    if (reachNote) reachNote.textContent = (ev.ok && ev.note) ? ev.note : '';

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
    if (btn) btn.disabled = _sending || !ev.ok || !contentOk;

    const label = $('pushSendLabel');
    if (label) {
        const base = testMode ? 'Send test to my device'
            : aud === 'one' ? `Send to ${_phone() || 'customer'}`
                : `Send to up to ${ev.count} subscriber${ev.count === 1 ? '' : 's'}`;
        label.textContent = _sending ? 'Sending…'
            : (!ev.ok || contentOk) ? base
                : 'Add title and message';
    }

    const testHint = $('pushTestHint');
    if (testHint) {
        testHint.textContent = _deviceReady
            ? 'Test sends go to the device registered to your admin account, and ignore quiet hours and the daily limit.'
            : 'No push token on your admin account yet - enable notifications from the bell prompt, then reload.';
    }

    const phoneHint = $('pushPhoneHint');
    if (phoneHint) {
        const withPhone = _subs.filter(s => s.phone).length;
        const noToken = _subs.filter(s => !s.hasToken).length;
        const noPhone = _subs.length - withPhone;
        const bits = [withPhone
            ? `${withPhone} subscriber${withPhone === 1 ? '' : 's'} with a number on file - start typing to pick one.`
            : 'No subscriber has a number on file yet.'];
        if (noToken) bits.push(`${noToken} without a device token, so they cannot be reached.`);
        if (noPhone) bits.push(`${noPhone} without a number.`);
        phoneHint.textContent = bits.join(' ');
    }
}

/* ============ SEND ============ */
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
    if (_sending) return; // a second tap while the confirm is open must not queue a second send
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
            `Send "${title}" to up to ${ev.count} subscriber${ev.count === 1 ? '' : 's'}? Each customer can get up to 3 offer pushes a day.`,
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
        const result = await sendNotify({
            title,
            body,
            // type must be top-level: the server defaults an absent type to
            // 'promo', which would filter by offers consent and quiet hours
            // even for a transactional order update.
            type,
            // Test mode must not carry an audience: an order-type send forces
            // the one-customer audience, and the server rejects an empty
            // phone before it even reaches the test-mode branch.
            ...(testMode ? {} : {
                audience: aud === 'one' ? 'phone' : 'all',
                ...(aud === 'one' ? { phone } : {}),
            }),
            testMode,
            data: {
                testMode: testMode ? 'true' : 'false',
                type,
                typeLabel: TYPE_INFO[type]?.label || type,
            }
        });

        const sent = Number(result.sent || 0);
        const failed = Number(result.failed || 0);
        const attempted = Number(result.total || 0);
        // The server writes the in-app inbox independently of FCM delivery, so
        // a push no device received can still be visible to the customer.
        const inbox = Number(result.inbox || 0);
        // `total` counts the devices the server actually attempted, i.e. after
        // the daily cap suppressed some recipients. The base is the set the
        // client can see (token + consent), so the difference is what the cap
        // took away.
        const reachBase = _reachable(type).length;
        const skipped = aud === 'all' && !testMode ? Math.max(0, reachBase - attempted) : 0;

        if (sent === 0) {
            const why = testMode
                ? 'No push token on this device - enable notifications, then try again.'
                : (inbox > 0
                    ? `No push delivered, but ${inbox} saved to the in-app inbox - customers will see it in the app.`
                    : (result.message || 'No device received it. Subscribers may have notifications turned off.'));
            _showResult('warn', why);
            showToast(why, 'warning');
        } else {
            const bits = [`Sent to ${sent} device${sent === 1 ? '' : 's'}`];
            if (failed) bits.push(`${failed} failed`);
            if (inbox > 0) bits.push(`${inbox} in-app`);
            if (skipped > 0) bits.push(`${skipped} skipped (daily limit)`);
            bits.push(_timeNow());
            _showResult('ok', bits.join(' · '));
            showToast(`Notification sent to ${sent} device${sent === 1 ? '' : 's'}`, 'success');

            // Clear draft and offer undo for 5 seconds
            _clearDraft();
            _scheduleUndo({ key: result.key, title, body, type, audience: aud, phone, at: Date.now() });

            if ($('pushNotifTitle')) $('pushNotifTitle').value = '';
            if ($('pushNotifBody')) $('pushNotifBody').value = '';
            _updateCount('pushNotifTitle', 'pushTitleCount', 100);
            _updateCount('pushNotifBody', 'pushBodyCount', 300);
            _updatePreviewText();
        }

        // Dead tokens are pruned server-side, so the count may have changed.
        await loadPushSubscriptions();
        await loadHistory();
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

// The notify endpoint (URL, bearer token, server-anchored IST clock and the
// POST itself) lives in notify-client.js - the Customers notification
// checklist is its second caller.

