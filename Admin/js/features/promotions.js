/**
 * ROSHANI ERP | PROMOTIONS MODULE
 * Composer, recipient picker, control panel, live progress, kill switch.
 * Features: greeting prefix, menu footer attachment, Excel/CSV import,
 * image preview, dashboard-level enable toggle, manual phone fallback.
 */

import {
    db, Outlet, tenantRef, ref, get, onValue, set, update, remove, push, runTransaction,
    query, orderByChild, equalTo, limitToLast, serverTimestamp,
    isConnected, onConnectionChange
} from '../firebase.js';
import { state } from '../state.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { haptic, escapeHtml, formatDate } from '../utils.js';
import { renderPromotionsGuide } from './promotions-guide.js';
import { logger } from '../utils/logger.js';
import { loadLucide } from '../ui.js';

const PROMO_MAX_PER_CAMPAIGN = 300;
const PHONE_HINTS = ['whatsapp', 'phone', 'mobile', 'number', 'cell', 'contact', 'tel', 'msisdn'];

let _campaignListener = null;
let _killSwitchListener = null;
let _botStatusListener = null;
let _enabledListener = null;
let _recipientsCache = [];
let _uploadFile = null;
let _mediaDataUrl = null;
let _mediaFile = null;
let _menuImageDataUrl = null;
let _activeMode = 'now';
let _killSwitchLocal = false;
let _promoEnabledLocal = true;
let _botOnline = true;
let _allCampaignsSnap = {};
let _lastRecipientsCount = 0;
let _connUnsub = null;

function _outlet() { return state.currentOutlet || 'pizza'; }
function _ref(path) { return Outlet.ref(path); }
function _promoRef(sub) { return tenantRef(_outlet(), `bot/promotions/${sub}`); }
function _cleanPhone(p) { return String(p || '').replace(/\D/g, '').slice(-10); }

/* ============ SPREADSHEET PARSING (CSV + XLSX) ============ */

function _findPhoneColumn(headers) {
    const norm = headers.map(h => String(h || '').trim().toLowerCase());
    for (let i = 0; i < norm.length; i++) {
        for (const hint of PHONE_HINTS) {
            if (norm[i] === hint || norm[i].includes(hint)) return i;
        }
    }
    return -1;
}

function _parseCsvText(text) {
    const out = [];
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return out;
    const first = lines[0];
    const hasHeader = /[a-zA-Z]/.test(first);
    let phoneCol = 0;
    let startIdx = 0;
    if (hasHeader) {
        const headers = first.split(',').map(h => h.trim());
        const idx = _findPhoneColumn(headers);
        if (idx >= 0) { phoneCol = idx; startIdx = 1; }
    }
    for (let i = startIdx; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const phone = _cleanPhone(cells[phoneCol]);
        if (phone.length >= 10) out.push(phone);
    }
    return Array.from(new Set(out));
}

async function _parseSpreadsheet(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(_parseCsvText(String(e.target.result || '')));
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
    if (ext !== 'xlsx' && ext !== 'xls') {
        throw new Error('Unsupported file type. Use .xlsx, .xls, or .csv');
    }
    if (typeof window.XLSX === 'undefined') {
        throw new Error('Excel library not loaded — check that xlsx.full.min.js is included');
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = window.XLSX.read(data, { type: 'array' });
                const firstSheet = wb.SheetNames[0];
                if (!firstSheet) return resolve([]);
                const sheet = wb.Sheets[firstSheet];
                const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
                if (!rows.length) return resolve([]);
                let phoneCol = 0;
                let startIdx = 0;
                const firstRow = rows[0].map(c => String(c || '').trim());
                const idx = _findPhoneColumn(firstRow);
                if (idx >= 0) { phoneCol = idx; startIdx = 1; }
                const out = [];
                for (let i = startIdx; i < rows.length; i++) {
                    const phone = _cleanPhone(rows[i][phoneCol]);
                    if (phone.length >= 10) out.push(phone);
                }
                resolve(Array.from(new Set(out)));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

/* ============ PHONE RESOLUTION ============ */

async function _resolveTestPhone() {
    const manual = _cleanPhone(document.getElementById('promoTestPhone')?.value);
    if (manual.length === 10) return manual;
    const override = sessionStorage.getItem('adminOverridePhone');
    if (override && _cleanPhone(override).length === 10) return _cleanPhone(override);
    try {
        const uid = (
            window.currentAdmin?.uid
            || sessionStorage.getItem('adminUid')
            || localStorage.getItem('adminUid')
        );
        if (uid) {
            const snap = await get(_ref(`admins/${uid}/phone`));
            if (snap.exists()) {
                const p = _cleanPhone(snap.val());
                if (p.length === 10) return p;
            }
        }
    } catch (_) {}
    const input = window.prompt(
        'Could not resolve your phone number automatically.\n\nEnter your WhatsApp number (10 digits) to receive the test message:',
        ''
    );
    if (input) {
        const p = _cleanPhone(input);
        if (p.length === 10) {
            sessionStorage.setItem('adminOverridePhone', p);
            return p;
        }
    }
    return null;
}

/* ============ RECIPIENT BUILDER ============ */

async function _buildRecipients() {
    const filter = document.getElementById('promoRecipientFilter')?.value || 'all_customers';
    let phones = [];

    if (filter === 'upload') {
        phones = _recipientsCache.slice();
    } else {
        let customers = null;
        try {
            const snap = await get(_ref('customers'));
            customers = snap.exists() ? snap.val() : null;
        } catch (e) {
            console.error('[Promo] Could not read customers:', e?.message || e);
            showToast('Permission denied reading customers. Apply the updated database rules, or use the Excel/CSV upload option.', 'error', 6000);
        }
        if (customers) {
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            for (const [phone, c] of Object.entries(customers)) {
                if (!c) continue;
                if (c.promotionalConsent !== true) continue;
                if (filter === 'recent_30d') {
                    if (!c.lastOrderDate) continue;
                    if (new Date(c.lastOrderDate).getTime() < cutoff) continue;
                }
                phones.push(phone);
            }
        }
        try {
            const optoutSnap = await get(_promoRef('optout'));
            if (optoutSnap.exists()) {
                const blocked = new Set(Object.keys(optoutSnap.val()));
                phones = phones.filter(p => !blocked.has(_cleanPhone(p)));
            }
        } catch (_) {}
    }

    phones = Array.from(new Set(phones.map(_cleanPhone))).filter(Boolean);
    if (phones.length > PROMO_MAX_PER_CAMPAIGN) phones = phones.slice(0, PROMO_MAX_PER_CAMPAIGN);
    return phones;
}

function _updateRecipientCount(n) {
    const el = document.getElementById('promoRecipientCount');
    const cap = document.getElementById('promoRecipientCap');
    if (el) el.textContent = String(n);
    if (cap) { cap.classList.toggle('hidden', n < PROMO_MAX_PER_CAMPAIGN); cap.textContent = `Capped at ${PROMO_MAX_PER_CAMPAIGN}`; }
    _lastRecipientsCount = n;
    _refreshLaunchButton();
}

function _refreshLaunchButton() {
    const btn = document.getElementById('btnPromoLaunch');
    if (!btn) return;
    const hasText = (document.getElementById('promoTemplate')?.value || '').trim().length > 0;
    const hasRecipients = _lastRecipientsCount > 0;
    const banner = document.getElementById('promotionsOfflineBanner');
    const botOnline = banner ? banner.classList.contains('hidden') : true;
    const promoEnabled = !!_promoEnabledLocal;
    btn.disabled = !(hasText && hasRecipients && botOnline && promoEnabled);
}

function _setOfflineBanner(offline) {
    const banner = document.getElementById('promotionsOfflineBanner');
    if (!banner) return;
    banner.classList.toggle('hidden', !offline);
    _refreshLaunchButton();
}

/* ============ KILL SWITCH + DASHBOARD WIDGET ============ */

async function _setKillSwitchUi(on) {
    const btn = document.getElementById('btnPromoKillAll');
    if (!btn) return;
    _killSwitchLocal = !!on;
    btn.disabled = !on && !_anyActive();
    btn.classList.toggle('btn-danger', true);
    btn.classList.toggle('btn-warning', !!on);
    btn.innerHTML = on
        ? `<i data-lucide="octagon"></i> <span>EMERGENCY STOP ENGAGED — click to release</span>`
        : `<i data-lucide="octagon"></i> <span>EMERGENCY STOP ALL</span>`;
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: btn.parentNode });
}

function _setPromoEnabledUi(enabled) {
    _promoEnabledLocal = !!enabled;
    const widget = document.getElementById('promoKillWidget');
    const toggle = document.getElementById('promoKillWidgetToggle');
    const status = document.getElementById('promoKillWidgetStatus');
    const slider = toggle?.nextElementSibling;
    if (!widget || !toggle) return;
    toggle.checked = !!enabled;
    if (slider) slider.style.background = enabled ? '#22c55e' : '#94a3b8';
    if (status) {
        status.textContent = enabled
            ? 'Sending is ON — all campaigns running normally.'
            : 'Sending is OFF — all outgoing promo messages are blocked.';
        status.classList.toggle('text-danger', !enabled);
    }
    _refreshLaunchButton();
}

function _anyActive() {
    if (!_allCampaignsSnap) return false;
    return Object.values(_allCampaignsSnap).some(c => c.status === 'running' || c.status === 'scheduled' || c.status === 'paused');
}

/* ============ RTDB LISTENERS ============ */

function _attachCampaignListener() {
    if (_campaignListener) { _campaignListener(); _campaignListener = null; }
    if (_killSwitchListener) { _killSwitchListener(); _killSwitchListener = null; }
    if (_botStatusListener) { _botStatusListener(); _botStatusListener = null; }
    if (_enabledListener) { _enabledListener(); _enabledListener = null; }

    const _promoErr = (ctx) => (err) => {
        console.error(`[Promo] ${ctx} read error:`, err);
        const el = document.getElementById('promoCampaignList');
        if (el) el.innerHTML = '<div class="offline-placeholder"><div class="offline-icon">⚠️</div><h4>Permission denied</h4><p>Could not load campaign data. Try refreshing the page.</p></div>';
    };
    _campaignListener = onValue(_promoRef('campaigns'), (snap) => {
        const val = snap.val() || {};
        _allCampaignsSnap = val;
        _renderActivePane();
        _renderHistoryPane();
    }, _promoErr('campaigns'));
    _killSwitchListener = onValue(_promoRef('killSwitch'), (snap) => {
        _setKillSwitchUi(snap.val() === true);
    }, _promoErr('killSwitch'));
    // Bot status is now tracked by Admin/js/bot-status.js which dispatches
    // 'botStatusChange' events. We listen for that event here.
    window._botStatusEventHandler = (e) => {
        _botOnline = e.detail.online;
        _setOfflineBanner(!_botOnline);
    };
    window.addEventListener('botStatusChange', window._botStatusEventHandler);
    // Seed initial state from global (set by bot-status.js before this tab loads)
    if (window._botOnline !== undefined) {
        _botOnline = window._botOnline;
        _setOfflineBanner(!_botOnline);
    }
    _enabledListener = onValue(_promoRef('enabled'), (snap) => {
        // null = enabled by default, false = disabled
        _setPromoEnabledUi(snap.val() !== false);
    }, _promoErr('enabled'));
}

export function cleanupPromotions() {
    logger.info('PROMO', 'Cleaning up Promotions listeners…');
    if (_campaignListener) { _campaignListener(); _campaignListener = null; }
    if (_killSwitchListener) { _killSwitchListener(); _killSwitchListener = null; }
    if (window._botStatusEventHandler) {
        window.removeEventListener('botStatusChange', window._botStatusEventHandler);
        window._botStatusEventHandler = null;
    }
    if (_enabledListener) { _enabledListener(); _enabledListener = null; }
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
}

/* ============ RENDERERS ============ */

async function _renderActivePane() {
    const container = document.getElementById('promoCampaignList');
    if (!container) return;
    const list = Object.entries(_allCampaignsSnap)
        .map(([id, c]) => ({ id, ...c }))
        .filter(c => c.status === 'running' || c.status === 'scheduled' || c.status === 'paused')
        .sort((a, b) => (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0));

    if (list.length === 0) {
        container.innerHTML = `<p class="text-muted-small">No campaigns yet. Compose your first one above.</p>`;
        _setKillSwitchUi(_killSwitchLocal);
        return;
    }

    container.innerHTML = list.map(c => {
        const pct = c.recipients && c.recipients.length ? Math.min(100, Math.round((c.currentIndex || 0) / c.recipients.length * 100)) : 0;
        return `
        <div class="promo-campaign-card" data-cid="${escapeHtml(c.id)}">
            <div class="flex-between flex-center flex-wrap-mobile">
                <div>
                    <strong>${escapeHtml(c.id)}</strong>
                    <span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
                    ${c.runAt ? `<span class="text-muted-small">scheduled ${escapeHtml(formatDate(c.runAt))}</span>` : ''}
                    ${c.menuText ? `<span class="text-muted-small" title="Has menu footer">• 🍴 menu</span>` : ''}
                </div>
                <div class="flex-row flex-gap-6">
                    <button class="btn-text" data-action="clonePromoCampaign" data-id="${escapeHtml(c.id)}" title="Clone">
                        <i data-lucide="copy"></i>
                    </button>
                    ${c.status === 'running' || c.status === 'paused' ? `<button class="btn-text text-danger" data-action="stopPromoCampaign" data-id="${escapeHtml(c.id)}" title="Stop"><i data-lucide="stop-circle"></i></button>` : ''}
                </div>
            </div>
            <div class="mt-8">
                <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
                <div class="flex-between mt-4">
                    <span class="text-muted-small">${c.currentIndex || 0} / ${c.recipients ? c.recipients.length : '?'} • sent ${c.totalSent || 0} • failed ${c.totalFailed || 0}</span>
                    <span class="text-muted-small">${escapeHtml(formatDate(c.lastHeartbeat || c.startedAt))}</span>
                </div>
            </div>
        </div>`;
    }).join('');
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: container });
    _setKillSwitchUi(_killSwitchLocal);
}

async function _renderHistoryPane() {
    const container = document.getElementById('promoHistoryList');
    if (!container) return;
    const list = Object.entries(_allCampaignsSnap)
        .map(([id, c]) => ({ id, ...c }))
        .filter(c => ['done', 'expired', 'stopped', 'aborted'].includes(c.status))
        .sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));

    if (list.length === 0) {
        container.innerHTML = `<p class="text-muted-small">Past campaigns will appear here once completed.</p>`;
        return;
    }
    container.innerHTML = list.map(c => `
        <div class="promo-campaign-card">
            <div class="flex-between flex-center flex-wrap-mobile">
                <div>
                    <strong>${escapeHtml(c.id)}</strong>
                    <span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
                    ${c.reason ? `<span class="text-muted-small">${escapeHtml(c.reason)}</span>` : ''}
                </div>
                <div class="flex-row flex-gap-6">
                    <button class="btn-text" data-action="clonePromoCampaign" data-id="${escapeHtml(c.id)}" title="Clone">
                        <i data-lucide="copy"></i>
                    </button>
                    <button class="btn-text" data-action="exportPromoLog" data-id="${escapeHtml(c.id)}" title="Export log">
                        <i data-lucide="download"></i>
                    </button>
                </div>
            </div>
            <div class="text-muted-small mt-4">sent ${c.totalSent || 0} • failed ${c.totalFailed || 0} • completed ${escapeHtml(formatDate(c.completedAt || c.startedAt))}</div>
        </div>
    `).join('');
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/* ============ PREVIEW (with image) ============ */

export async function _preview() {
    const template = (document.getElementById('promoTemplate')?.value || '').trim();
    const greeting = !!document.getElementById('promoGreeting')?.checked;
    const attachMenu = !!document.getElementById('promoAttachMenu')?.checked;
    const menuText = (document.getElementById('promoMenuText')?.value || '').trim();
    const closingMsg = (document.getElementById('promoClosingMsg')?.value || '').trim();
    const sendStop = !!document.getElementById('promoSendStopMsg')?.checked;
    if (!template) { showToast('Nothing to preview', 'warning'); return; }
    const storeSnap = await get(_ref('settings/Store'));
    const store = storeSnap.exists() ? storeSnap.val() : {};
    const sampleName = 'Aarav';
    const tokens = {
        '{storeName}': store.storeName || 'Roshani Pizza',
        '{name}': sampleName,
        '{phone}': '9876543210',
        '{lastOrderDate}': '15 Jun 2026',
    };
    let body = template;
    for (const [k, v] of Object.entries(tokens)) body = body.split(k).join(v);
    if (greeting) body = `Hi ${sampleName},\n\n${body}`;
    if (attachMenu && menuText) body += '\n\n' + menuText;
    if (closingMsg) body += '\n\n' + closingMsg;
    if (sendStop) body += '\n\n_Reply STOP to unsubscribe._';

    // Build a custom preview modal so we can render an image
    let modal = document.getElementById('promoPreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'promoPreviewModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header">
                    <h3>Preview</h3>
                    <button class="modal-close" data-action="closePromoPreview" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body" id="promoPreviewBody"></div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-action="closePromoPreview">Close</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('[data-action="closePromoPreview"]')) {
                modal.classList.remove('active');
            }
        });
    }
    const bodyEl = document.getElementById('promoPreviewBody');
    const attachMenuImg = !!document.getElementById('promoAttachMenuImage')?.checked;
    bodyEl.innerHTML = `
        ${_mediaDataUrl ? `<div style="margin-bottom:12px;"><img src="${escapeHtml(_mediaDataUrl)}" alt="Attached media" style="max-width:100%; border-radius:8px; display:block;"></div>` : ''}
        <div style="white-space:pre-wrap; background:#0b1220; color:#e5e7eb; padding:12px; border-radius:8px; font-family:monospace; font-size:13px;">${escapeHtml(body)}</div>
        ${sendStop ? '' : '<div class="text-muted-small mt-8" style="font-size:11px;">ℹ️ STOP footer is OFF — no opt-out message will be sent.</div>'}
        ${attachMenuImg && _menuImageDataUrl ? `
            <div style="margin-top:12px; padding-top:12px; border-top:1px dashed #cbd5e1;">
                <div class="text-muted-small" style="margin-bottom:6px;">— menu image sent with your message —</div>
                <div><img src="${escapeHtml(_menuImageDataUrl)}" alt="Menu image" style="max-width:100%; max-height:120px; border-radius:8px;"></div>
            </div>
        ` : ''}
    `;
    modal.classList.add('active');
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: modal });
}

/* ============ CAMPAIGN ACTIONS ============ */

async function _launchCampaign() {
    const template = (document.getElementById('promoTemplate')?.value || '').trim();
    if (!template) { showToast('Please write a message first', 'warning'); return; }
    const recipients = await _buildRecipients();
    if (recipients.length === 0) { showToast('No eligible recipients found', 'warning'); return; }
    if (!_promoEnabledLocal) {
        const ok = await showConfirm('Promotional sending is currently OFF (dashboard toggle). Enable it and continue?', 'Sending disabled');
        if (!ok) return;
        await set(_promoRef('enabled'), true);
    }

    const delaySec = Math.max(1, Math.min(30, Number(document.getElementById('promoDelay')?.value) || 2));
    const generateCoupons = !!document.getElementById('promoGenerateCoupons')?.checked;
    const greeting = !!document.getElementById('promoGreeting')?.checked;
    const attachMenu = !!document.getElementById('promoAttachMenu')?.checked;
    const menuText = attachMenu ? (document.getElementById('promoMenuText')?.value || '').trim() : '';
    if (attachMenu && !menuText) {
        showToast('Menu footer is empty — turning off menu attachment', 'warning');
    }
    const attachMenuImg = !!document.getElementById('promoAttachMenuImage')?.checked;
    const closingMsg = (document.getElementById('promoClosingMsg')?.value || '').trim();
    const sendStop = !!document.getElementById('promoSendStopMsg')?.checked;
    const mode = _activeMode;
    const runAt = mode === 'schedule'
        ? new Date(document.getElementById('promoRunAt')?.value || '').getTime()
        : null;
    if (mode === 'schedule' && (!runAt || isNaN(runAt))) {
        showToast('Please pick a valid date/time', 'warning'); return;
    }
    const quietStart = Number(document.getElementById('promoQuietStart')?.value);
    const quietEnd = Number(document.getElementById('promoQuietEnd')?.value);
    const quietHours = (mode === 'schedule' && !isNaN(quietStart) && !isNaN(quietEnd))
        ? { start: quietStart, end: quietEnd } : null;

    const campaignId = 'c_' + Date.now().toString(36);
    const campaignDoc = {
        id: campaignId,
        status: mode === 'schedule' ? 'scheduled' : 'running',
        template, mediaUrl: _mediaDataUrl || null,
        greeting, menuText: menuText || null,
        menuImageUrl: _menuImageDataUrl || null,
        closingMessage: closingMsg || null,
        sendStopMsg: sendStop,
        recipients, delayMs: delaySec * 1000, generateCoupons,
        runAt, quietHours, requestedBy: window.currentAdmin?.uid || 'admin',
        createdAt: new Date().toISOString(),
    };
    if (mode !== 'schedule') campaignDoc.startedAt = Date.now();

    const confirm = await showConfirm(
        `Send to ${recipients.length} recipients${mode === 'schedule' ? ` at ${formatDate(runAt)}` : ' now'}${attachMenu && menuText ? ' (+ menu footer)' : ''}?`,
        'Confirm campaign'
    );
    if (!confirm) return;
    haptic(20);

    await set(_promoRef(`campaigns/${campaignId}`), campaignDoc);

    if (mode === 'schedule') {
        showToast(`Scheduled ${campaignId} for ${formatDate(runAt)}`, 'success');
    } else {
        const cmdRef = push(tenantRef(_outlet(), 'bot/commands'));
        await set(cmdRef, {
            action: 'SEND_PROMOTION',
            campaignId,
            template, mediaUrl: _mediaDataUrl || null,
            greeting, menuText: menuText || null,
            menuImageUrl: _menuImageDataUrl || null,
            closingMessage: closingMsg || null,
            sendStopMsg: sendStop,
            recipients, delayMs: delaySec * 1000, generateCoupons,
            quietHours, requestedBy: campaignDoc.requestedBy
        });
        showToast(`Campaign ${campaignId} launched`, 'success');
    }
    _switchMode('active');
}

export async function _sendTest() {
    const btns = [...document.querySelectorAll('[data-action="sendTestPromo"]')];
    btns.forEach(b => b.disabled = true);
    try {
    const template = (document.getElementById('promoTemplate')?.value || '').trim();
    if (!template) { showToast('Write a template first', 'warning'); return; }
    const phone = await _resolveTestPhone();
    if (!phone) { showToast('Could not resolve test phone number', 'error'); return; }
    const delaySec = Math.max(1, Math.min(30, Number(document.getElementById('promoDelay')?.value) || 2));
    const greeting = !!document.getElementById('promoGreeting')?.checked;
    const attachMenu = !!document.getElementById('promoAttachMenu')?.checked;
    const menuText = attachMenu ? (document.getElementById('promoMenuText')?.value || '').trim() : '';
    const attachMenuImg = !!document.getElementById('promoAttachMenuImage')?.checked;
    const closingMsg = (document.getElementById('promoClosingMsg')?.value || '').trim();
    const sendStop = !!document.getElementById('promoSendStopMsg')?.checked;
    const campaignId = 'test_' + Date.now().toString(36);
    const cmdRef = push(tenantRef(_outlet(), 'bot/commands'));
    await set(cmdRef, {
        action: 'SEND_PROMOTION',
        campaignId,
        template, mediaUrl: _mediaDataUrl || null,
        greeting, menuText: menuText || null,
        menuImageUrl: (attachMenuImg && _menuImageDataUrl) ? _menuImageDataUrl : null,
        closingMessage: closingMsg || null,
        sendStopMsg: sendStop,
        recipients: [phone],
        delayMs: delaySec * 1000,
        generateCoupons: false,
        quietHours: null,
        requestedBy: 'self-test',
        isTest: true
    });
    const toastId = Date.now() + Math.random();
    showToast(`⏳ Test message queued — waiting for bot reply...`, 'info', 10000, toastId);
    // Watch the log entry for this test campaign + phone for up to 10 seconds
    const logRef = tenantRef(_outlet(), `bot/promotions/logs/${campaignId}/${phone}`);
    let listener = null;
    let settled = false;
    const cleanup = () => {
        if (listener) { listener(); listener = null; }
        settled = true;
    };
    listener = onValue(logRef, (snap) => {
        if (settled) return;
        const log = snap.val();
        if (!log) return;
        cleanup();
        if (log.status === 'sent') {
            window.__updateToast?.(toastId, `✅ Test sent to ${phone}`, 'success');
        } else if (log.status === 'failed') {
            window.__updateToast?.(toastId, `❌ Test failed: ${log.error || 'unknown error'}`, 'error');
        } else if (log.status === 'skipped') {
            window.__updateToast?.(toastId, `ℹ️ Test skipped: ${log.reason || 'unknown'}`, 'warning');
        } else {
            window.__updateToast?.(toastId, `ℹ️ ${log.status} — check bot logs`, 'info');
        }
    }, (err) => {
        if (settled) return;
        cleanup();
        window.__updateToast?.(toastId, `⚠️ Could not watch test result: ${err.message}`, 'warning');
    });
    // Timeout after 10 seconds
    setTimeout(() => {
        if (settled) return;
        cleanup();
        window.__updateToast?.(toastId, `⏳ No response from bot in 10s — check bot.out.log`, 'warning');
    }, 10000);
} finally { btns.forEach(b => b.disabled = false); }
}

async function _toggleKillSwitch() {
    const refPath = _promoRef('killSwitch');
    const snap = await get(refPath);
    const current = snap.val() === true;
    const next = !current;
    const msg = next
        ? 'This will PAUSE every active campaign before its next send. Continue?'
        : 'Release the global kill switch? Active campaigns will resume on their next send.';
    const ok = await showConfirm(msg, next ? 'Engage kill switch' : 'Release kill switch');
    if (!ok) return;
    await set(refPath, next);
    showToast(next ? 'Kill switch ENGAGED' : 'Kill switch released', next ? 'warning' : 'success');
    haptic(40);
}

async function _togglePromoEnabled(value) {
    await set(_promoRef('enabled'), !!value);
    showToast(value ? 'Promotional sending ENABLED' : 'Promotional sending DISABLED', value ? 'success' : 'warning');
    haptic(20);
}

async function _stopCampaign(id) {
    const ok = await showConfirm(`Stop campaign ${id}? Already-sent messages will not be recalled.`, 'Stop campaign');
    if (!ok) return;
    await update(_promoRef(`campaigns/${id}`), { status: 'stopped', stoppedAt: Date.now() });
}

async function _cloneCampaign(id) {
    const snap = await get(_promoRef(`campaigns/${id}`));
    if (!snap.exists()) return;
    const c = snap.val();
    if (document.getElementById('promoTemplate')) document.getElementById('promoTemplate').value = c.template || '';
    if (document.getElementById('promoGreeting')) document.getElementById('promoGreeting').checked = c.greeting !== false;
    if (document.getElementById('promoAttachMenu')) {
        document.getElementById('promoAttachMenu').checked = !!c.menuText;
        const menuBox = document.getElementById('promoMenuBox');
        if (menuBox) menuBox.classList.toggle('hidden', !c.menuText);
    }
    if (document.getElementById('promoMenuText') && c.menuText) {
        document.getElementById('promoMenuText').value = c.menuText;
    }
    if (document.getElementById('promoDelay')) document.getElementById('promoDelay').value = Math.round((c.delayMs || 2000) / 1000);
    if (document.getElementById('promoGenerateCoupons')) document.getElementById('promoGenerateCoupons').checked = !!c.generateCoupons;
    if (c.mediaUrl) {
        _mediaDataUrl = c.mediaUrl;
        const img = document.getElementById('promoMediaImg');
        if (img) img.src = c.mediaUrl;
        document.getElementById('promoMediaPreview')?.classList.remove('hidden');
    }
    if (document.getElementById('promoClosingMsg') && c.closingMessage) {
        document.getElementById('promoClosingMsg').value = c.closingMessage;
    }
    if (document.getElementById('promoSendStopMsg')) {
        document.getElementById('promoSendStopMsg').checked = c.sendStopMsg !== false;
    }
    if (c.menuImageUrl) {
        _menuImageDataUrl = c.menuImageUrl;
        const img = document.getElementById('promoMenuImageImg');
        if (img) img.src = c.menuImageUrl;
        document.getElementById('promoMenuImagePreview')?.classList.remove('hidden');
        const chk = document.getElementById('promoAttachMenuImage');
        if (chk) { chk.checked = true; document.getElementById('promoMenuImageBox')?.classList.remove('hidden'); }
    }
    _switchMode('now');
    showToast('Cloned into composer', 'success');
}

async function _exportCsv(id) {
    const snap = await get(_promoRef(`logs/${id}`));
    if (!snap.exists()) { showToast('No log found for that campaign', 'warning'); return; }
    const rows = [['phone', 'status', 'sentAt', 'error', 'couponCode', 'reason']];
    const log = snap.val();
    for (const [phone, r] of Object.entries(log)) {
        rows.push([phone, r.status || '', r.sentAt ? new Date(r.sentAt).toISOString() : '', r.error || '', r.couponCode || '', r.reason || '']);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `promo-log-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

async function _switchMode(mode) {
    _activeMode = mode;
    document.querySelectorAll('.promo-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.getElementById('promoComposePane')?.classList.toggle('hidden', mode === 'active' || mode === 'history');
    document.getElementById('promoActivePane')?.classList.toggle('hidden', mode !== 'active');
    document.getElementById('promoHistoryPane')?.classList.toggle('hidden', mode !== 'history');
    document.getElementById('promoScheduleBox')?.classList.toggle('hidden', mode !== 'schedule');
    const btn = document.getElementById('btnPromoLaunch');
    if (btn) {
        btn.innerHTML = mode === 'schedule'
            ? `<i data-lucide="calendar"></i> <span>Schedule campaign</span>`
            : `<i data-lucide="send"></i> <span>Launch campaign</span>`;
        await loadLucide();
        if (window.lucide) window.lucide.createIcons({ root: btn.parentNode });
    }
}

/* ============ BOOT ============ */

export function loadPromotions() {
    logger.info('PROMO', 'Loading promotions tab…');
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
    _setOfflineBanner(false);
    _refreshLaunchButton();

    document.querySelectorAll('.promo-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => _switchMode(tab.dataset.mode));
    });

    const tpl = document.getElementById('promoTemplate');
    const counter = document.getElementById('promoCharCount');
    if (tpl && counter) {
        tpl.addEventListener('input', () => {
            counter.textContent = `${tpl.value.length} / 1500`;
            _refreshLaunchButton();
        });
    }

    // Greeting toggle
    document.getElementById('promoGreeting')?.addEventListener('change', _refreshLaunchButton);

    // Attach-menu toggle
    document.getElementById('promoAttachMenu')?.addEventListener('change', (e) => {
        document.getElementById('promoMenuBox')?.classList.toggle('hidden', !e.target.checked);
        _refreshLaunchButton();
    });

    // Attach-menu-image toggle — loads from settings/Bot/menuImage
    document.getElementById('promoAttachMenuImage')?.addEventListener('change', async (e) => {
        const box = document.getElementById('promoMenuImageBox');
        if (e.target.checked) {
            // Load menu image from settings
            try {
                const snap = await get(Outlet.ref('settings/Bot'));
                const botSettings = snap.val() || {};
                const menuUrl = botSettings.menuImage || '';
                if (menuUrl) {
                    _menuImageDataUrl = menuUrl;
                    const img = document.getElementById('promoMenuImageImg');
                    if (img) img.src = menuUrl;
                    box?.classList.remove('hidden');
                } else {
                    showToast('No menu image found in Settings → Bot Aesthetics. Upload one first.', 'warning');
                    e.target.checked = false;
                    box?.classList.add('hidden');
                }
            } catch (err) {
                console.error('[Promo] Failed to load menu image from settings:', err);
                showToast('Failed to load menu image', 'error');
                e.target.checked = false;
                box?.classList.add('hidden');
            }
        } else {
            _menuImageDataUrl = null;
            box?.classList.add('hidden');
        }
    });

    // Recipient filter
    const filter = document.getElementById('promoRecipientFilter');
    if (filter) {
        filter.addEventListener('change', async () => {
            const csvBox = document.getElementById('promoCsvBox');
            csvBox?.classList.toggle('hidden', filter.value !== 'upload');
            if (filter.value !== 'upload') {
                const list = await _buildRecipients();
                _updateRecipientCount(list.length);
            } else {
                _updateRecipientCount(_recipientsCache.length);
            }
            _refreshLaunchButton();
        });
        _buildRecipients().then(list => _updateRecipientCount(list.length));
    }

    // Image attach (onclick bound in _wireActions; change handler guarded via onchange)
    const mediaInput = document.getElementById('promoMediaInput');
    if (mediaInput && !mediaInput._promoMediaChangeBound) {
        mediaInput._promoMediaChangeBound = true;
        mediaInput.addEventListener('change', () => {
            const file = mediaInput.files?.[0];
            if (!file) return;
            _mediaFile = file;
            const reader = new FileReader();
            reader.onload = e => {
                _mediaDataUrl = e.target.result;
                const img = document.getElementById('promoMediaImg');
                if (img) img.src = _mediaDataUrl;
                document.getElementById('promoMediaPreview')?.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        });
    }

    // Excel/CSV upload
    document.querySelectorAll('[data-action="pickPromoCsv"]').forEach(btn => {
        btn.addEventListener('click', () => document.getElementById('promoCsvInput')?.click());
    });
    const csvInput = document.getElementById('promoCsvInput');
    if (csvInput) {
        csvInput.addEventListener('change', async () => {
            const file = csvInput.files?.[0];
            if (!file) return;
            _uploadFile = file;
            const name = document.getElementById('promoCsvName');
            const count = document.getElementById('promoCsvCount');
            if (name) name.textContent = file.name;
            if (count) count.textContent = '(parsing…)';
            try {
                const list = await _parseSpreadsheet(file);
                _recipientsCache = list;
                if (count) count.textContent = `(${list.length} numbers)`;
                _updateRecipientCount(list.length);
                _refreshLaunchButton();
                showToast(`Loaded ${list.length} numbers from ${file.name}`, 'success');
            } catch (err) {
                if (count) count.textContent = '(parse error)';
                showToast(err.message || 'Failed to parse file', 'error');
            }
        });
    }

    // Dashboard kill-switch widget
    const widgetToggle = document.getElementById('promoKillWidgetToggle');
    if (widgetToggle) {
        widgetToggle.addEventListener('change', (e) => _togglePromoEnabled(e.target.checked));
    }
    // Make the whole widget clickable
    document.getElementById('promoKillWidget')?.addEventListener('click', (e) => {
        if (e.target.closest('label, input, button')) return;
        const t = document.getElementById('promoKillWidgetToggle');
        if (t) {
            t.checked = !t.checked;
            _togglePromoEnabled(t.checked);
        }
    });

    _wireActions();
    _switchMode('now');

    if (isConnected()) {
        _attachCampaignListener();
    } else {
        const el = document.getElementById('promoCampaignList');
        if (el) el.innerHTML = '<div class="offline-placeholder"><div class="offline-icon">📡</div><h4>Waiting for connection</h4><p>Firebase is currently unreachable. Campaign data will load automatically when the connection is restored.</p></div>';
        if (!_connUnsub) _connUnsub = onConnectionChange(function _retryPromo(online) {
            if (!online) return;
            if (_connUnsub) { _connUnsub(); _connUnsub = null; }
            cleanupPromotions();
            loadPromotions();
        });
    }
}

/* ============ SAMPLE TEMPLATE DOWNLOAD ============ */

function _downloadPromoCsv() {
    const rows = [
        ['phone', 'name'],
        ['9876543210', 'Aarav Sharma'],
        ['9123456789', 'Priya Singh']
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sample-template.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function _downloadPromoXlsx() {
    if (typeof window.XLSX === 'undefined') {
        showToast('Excel library not loaded — try downloading the CSV instead', 'warning');
        return;
    }
    const wb = window.XLSX.utils.book_new();
    const data = [
        ['Phone', 'Name'],
        ['9876543210', 'Aarav Sharma'],
        ['9123456789', 'Priya Singh'],
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 12 }, { wch: 20 }];
    window.XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sample-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
}

function _wireActions() {
    document.querySelectorAll('[data-action="openPromotionsGuide"]').forEach(el => {
        el.onclick = () => {
            renderPromotionsGuide(document.getElementById('promotionsGuideBody'));
            document.getElementById('promotionsGuideModal')?.classList.add('active');
        };
    });
    document.querySelectorAll('[data-action="closePromotionsGuide"]').forEach(el => {
        el.onclick = () => document.getElementById('promotionsGuideModal')?.classList.remove('active');
    });
    document.querySelectorAll('[data-action="pickPromoTemplate"]').forEach(el => {
        el.onclick = () => {
            import('./promotions-templates.js').then(m => {
                m.renderTemplatePicker(document.getElementById('promoTemplatePickerBody'));
                document.getElementById('promoTemplatePickerModal')?.classList.add('active');
            });
        };
    });
    const launch = document.getElementById('btnPromoLaunch');
    if (launch) launch.onclick = _launchCampaign;
    // sendTestPromo / previewPromo / closePromoTemplatePicker are dispatched by
    // main.js's delegated [data-action] handler — no direct binding (was double-firing).
    document.querySelectorAll('[data-action="pickPromoMedia"]').forEach(el => {
        el.onclick = () => document.getElementById('promoMediaInput')?.click();
    });
    document.querySelectorAll('[data-action="clearPromoMedia"]').forEach(el => {
        el.onclick = () => {
            _mediaDataUrl = null; _mediaFile = null;
            const img = document.getElementById('promoMediaImg');
            if (img) img.src = '';
            document.getElementById('promoMediaPreview')?.classList.add('hidden');
        };
    });
    const kill = document.getElementById('btnPromoKillAll');
    if (kill) kill.onclick = _toggleKillSwitch;
    document.getElementById('promoActivePane')?.addEventListener('click', (e) => {
        const stop = e.target.closest('[data-action="stopPromoCampaign"]');
        if (stop) _stopCampaign(stop.dataset.id);
        const clone = e.target.closest('[data-action="clonePromoCampaign"]');
        if (clone) _cloneCampaign(clone.dataset.id);
    });
    document.getElementById('promoHistoryPane')?.addEventListener('click', (e) => {
        const exp = e.target.closest('[data-action="exportPromoLog"]');
        if (exp) _exportCsv(exp.dataset.id);
        const clone = e.target.closest('[data-action="clonePromoCampaign"]');
        if (clone) _cloneCampaign(clone.dataset.id);
    });
    document.querySelectorAll('[data-action="exportPromoCSV"]').forEach(el => el.onclick = () => {
        const list = Object.entries(_allCampaignsSnap)
            .map(([id, c]) => ({ id, ...c }))
            .filter(c => ['done', 'stopped', 'expired', 'aborted'].includes(c.status))
            .sort((a, b) => (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0));
        if (list.length === 0) { showToast('No completed campaigns to export', 'warning'); return; }
        _exportCsv(list[0].id);
    });
    document.querySelectorAll('[data-action="downloadPromoCsv"]').forEach(el => el.onclick = _downloadPromoCsv);
    document.querySelectorAll('[data-action="downloadPromoXlsx"]').forEach(el => el.onclick = _downloadPromoXlsx);
}
