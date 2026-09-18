/**
 * FoodHubbie ERP | CHAT MODULE (Admin/js/features/chat.js)
 * ============================================================================
 * WhatsApp-style conversation viewer for customer<->bot chats.
 *
 * Data:  businesses/{bid}/outlets/{oid}/chats/{customerId}/
 *          meta/     { name, phone, lastTs, lastText, lastDir, unread }
 *          messages/{msgId} { from: 'customer'|'bot', text, ts, type }
 * Written by the bot (bot/chat-log.js). This module is read-only + reply:
 * replies go through the EXISTING `bot/commands` channel
 * (action: SEND_GENERIC_MESSAGE) — no new send path (see bot/index.js:301).
 *
 * conventions: lazy-load via mod('chat'), loadChat()/cleanupChat() exported
 * (switchTab in ui.js), badge in sidebar = total unread across threads.
 * ============================================================================
 */

import { Outlet, onValue, update, push, set, serverTimestamp } from '../firebase.js';
import { escapeHtml } from '../utils.js';
import { showToast } from '../ui-utils.js';
import { loadLucide } from '../ui.js';

// ---------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------
let _listener = null;
let _listenerOutlet = null;
let _chatData = {};              // customerId -> { meta, messages: {id: msg} }
let _selectedCustomerId = null;
let _renderedThreadId = null;
let _searchTerm = '';
let _wired = false;
let _blockedMenusWired = false;
let _usageUnsub = null;         // bot/usage listener
let _usageData = null;          // today's usage snapshot

function _chatRef(sub) { return Outlet.ref(`chats${sub ? '/' + sub : ''}`); }

function _istDay(ts) {
    if (!ts) return '';
    const d = new Date(ts + 5.5 * 3600000);
    return d.toISOString().split('T')[0];
}

function _dayLabel(ts) {
    const day = _istDay(ts);
    if (!day) return '';
    const today = _istDay(Date.now());
    const yesterday = _istDay(Date.now() - 86400000);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _timeLabel(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Deterministic avatar hue from the thread key so a customer keeps one color.
function _avatarHue(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return h;
}

function _initials(name, phone) {
    const n = (name || '').trim();
    if (n) {
        const parts = n.split(/\s+/);
        return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
    }
    // phone is the full JID (9197...@s.whatsapp.net) — use its digits
    const digits = (phone || '').replace(/[^0-9]/g, '');
    return (digits.slice(-2) || '?').toUpperCase();
}

function _displayName(customerId, meta) {
    return (meta?.name && meta.name.trim()) ? meta.name : `+${(meta?.phone || customerId).replace(/[^0-9]/g, '')}`;
}

// ---------------------------------------------------------------------
// Render: thread list (left pane)
// ---------------------------------------------------------------------
function _updateBadges() {
    const totalUnread = Object.values(_chatData).reduce((s, t) => s + Number(t.meta?.unread || 0), 0);
    const badgeEl = document.getElementById('badge-chat');
    if (badgeEl) {
        badgeEl.textContent = String(totalUnread);
        badgeEl.classList.toggle('hidden', totalUnread === 0);
    }
    const headerUnread = document.getElementById('chatTotalUnread');
    if (headerUnread) {
        headerUnread.textContent = `${totalUnread} unread`;
        headerUnread.classList.toggle('hidden', totalUnread === 0);
    }
}

// ---------------------------------------------------------------------
// Daily outbound usage bar
// ---------------------------------------------------------------------
function _istDate(ts) {
    if (!ts) return '';
    return new Date(ts + 5.5 * 3600000).toISOString().split('T')[0];
}

function _renderUsage() {
    const bar = document.getElementById('chatUsageBar');
    if (!bar) return;
    if (!_usageData) { bar.classList.add('hidden'); return; }
    const today = _istDate(Date.now());
    const todayData = _usageData[today] || {};
    const total = todayData.total || 0;
    if (total === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const el = (id) => document.getElementById(id);
    if (el('chatUsageToday')) el('chatUsageToday').textContent = total;
    if (el('chatUsageOrders')) el('chatUsageOrders').textContent = todayData.order_notification || 0;
    if (el('chatUsageRiders')) el('chatUsageRiders').textContent = todayData.rider_broadcast || 0;
    if (el('chatUsagePromos')) el('chatUsagePromos').textContent = todayData.promo || 0;
}

function _startUsageListener() {
    if (_usageUnsub) return;
    _usageUnsub = onValue(Outlet.ref('bot/usage'), (snap) => {
        _usageData = snap.val();
        _renderUsage();
    }, () => {});
}

function _stopUsageListener() {
    if (_usageUnsub) { _usageUnsub(); _usageUnsub = null; }
    _usageData = null;
    const bar = document.getElementById('chatUsageBar');
    if (bar) bar.classList.add('hidden');
}

function _renderThreadList() {
    const listEl = document.getElementById('chatThreadList');
    if (!listEl) return;

    const term = _searchTerm.trim().toLowerCase();
    const threads = Object.entries(_chatData)
        .map(([id, t]) => ({ id, meta: t.meta || {}, hasMsgs: !!t.messages && Object.keys(t.messages).length > 0 }))
        .filter(t => !term || _displayName(t.id, t.meta).toLowerCase().includes(term) || String(t.meta.phone || '').includes(term))
        .sort((a, b) => (b.meta.lastTs || 0) - (a.meta.lastTs || 0));

    if (threads.length === 0) {
        listEl.innerHTML = `<div class="chat-list-empty">${term ? 'No chats match your search.' : 'No conversations yet. When customers message the WhatsApp bot, their chats appear here.'}</div>`;
        return;
    }

    listEl.innerHTML = threads.map(t => {
        const name = _displayName(t.id, t.meta);
        const meta = t.meta;
        const lastText = meta.lastText || '';
        const lastDir = meta.lastDir === 'bot' ? '➤ ' : '';
        const unread = Number(meta.unread || 0);
        const hue = _avatarHue(t.id);
        return `<div class="chat-thread ${t.id === _selectedCustomerId ? 'active' : ''}" data-chat-id="${escapeHtml(t.id)}" role="button" tabindex="0" aria-label="Chat with ${escapeHtml(name)}">
            <span class="chat-avatar" style="--hue:${hue}">${escapeHtml(_initials(meta.name, meta.phone))}</span>
            <div class="chat-thread-body">
                <div class="chat-thread-row">
                    <strong class="chat-thread-name">${escapeHtml(name)}</strong>
                    <span class="chat-thread-time">${escapeHtml(_timeLabel(meta.lastTs))}</span>
                </div>
                <div class="chat-thread-row">
                    <span class="chat-thread-preview">${escapeHtml(lastDir + lastText)}</span>
                    ${unread > 0 ? `<span class="chat-unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    _updateBadges();
}

// ---------------------------------------------------------------------
// Render: conversation (right pane)
// ---------------------------------------------------------------------
function _renderThreadView() {
    const viewEl = document.getElementById('chatThreadView');
    const emptyEl = document.getElementById('chatEmptyState');
    if (!viewEl || !emptyEl) return;

    if (!_selectedCustomerId || !_chatData[_selectedCustomerId]) {
        viewEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');
    viewEl.classList.remove('hidden');

    const t = _chatData[_selectedCustomerId];
    const meta = t.meta || {};
    const name = _displayName(_selectedCustomerId, meta);
    const avatarEl = document.getElementById('chatThreadAvatar');
    if (avatarEl) {
        avatarEl.style.setProperty('--hue', _avatarHue(_selectedCustomerId));
        avatarEl.textContent = _initials(meta.name, meta.phone);
    }
    const nameEl = document.getElementById('chatThreadName');
    if (nameEl) nameEl.textContent = name;
    const phoneEl = document.getElementById('chatThreadPhone');
    if (phoneEl) phoneEl.textContent = '+' + (meta.phone || _selectedCustomerId).replace(/[^0-9]/g, '');
    _currentChatPhone = meta.phone || null; // ponytail: track for block/unblock

    const msgs = Object.entries(t.messages || {}).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    const listEl = document.getElementById('chatMessageList');
    if (!listEl) return;

    // Preserve scroll position across re-renders (the listener re-renders on
    // ANY chats change). Only snap to the newest message when the user is
    // already at/near the bottom — otherwise reading history gets yanked back.
    const threadChanged = _renderedThreadId !== _selectedCustomerId;
    if (threadChanged) listEl.scrollTop = 0;
    const stickToBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
    const prevTop = listEl.scrollTop;

    let html = '';
    let lastDay = null;
    for (const [msgId, m] of msgs) {
        const day = _dayLabel(m.ts);
        if (day !== lastDay) {
            html += `<div class="chat-day-sep"><span>${escapeHtml(day)}</span></div>`;
            lastDay = day;
        }
        const isBot = m.from === 'bot';
        const body = m.type === 'location'
            ? '<i data-lucide="map-pin" class="icon-16"></i> Location shared'
            : (m.text || '<media>');
        html += `<div class="chat-bubble-row ${isBot ? 'out' : 'in'}">
            <div class="chat-bubble">${escapeHtml(body)}
                <span class="chat-msg-time">${escapeHtml(_timeLabel(m.ts))}${isBot ? ' <span class="chat-ticks">✓✓</span>' : ''}</span>
            </div>
        </div>`;
    }
    listEl.innerHTML = html || `<div class="chat-list-empty">No messages in this thread yet.</div>`;

    // Stick to bottom only if we were already there; else keep reading position.
    if (stickToBottom) {
        listEl.scrollTop = listEl.scrollHeight;
    } else {
        listEl.scrollTop = prevTop;
    }
    _renderedThreadId = _selectedCustomerId;
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------
async function _openThread(customerId) {
    _selectedCustomerId = customerId;
    // Clear unread (best-effort — read marker)
    if (_chatData[customerId]?.meta?.unread) {
        update(_chatRef(`${customerId}/meta`), { unread: 0 }).catch(() => {});
        _chatData[customerId].meta.unread = 0;
    }
    _renderThreadList();
    _renderThreadView();

    // Mobile: swap list pane for the conversation pane
    const app = document.getElementById('chatApp');
    if (app && window.innerWidth <= 768) app.classList.add('chat-conv-open');
}

async function _sendMessage() {
    const inputEl = document.getElementById('chatComposerInput');
    const text = (inputEl?.value || '').trim();
    if (!text || !_selectedCustomerId) return;
    const meta = _chatData[_selectedCustomerId]?.meta;
    const phone = meta?.phone || `${_selectedCustomerId}@s.whatsapp.net`;
    if (!phone) { showToast('Cannot send — no customer number on this thread.', 'error'); return; }

    try {
        const cmdRef = push(Outlet.ref('bot/commands'));
        await set(cmdRef, {
            action: 'SEND_GENERIC_MESSAGE',
            phone,
            message: text,
            timestamp: serverTimestamp()
        });
        inputEl.value = '';
        inputEl.style.height = 'auto';
        // Optimistic echo — the bot's outbound hook persists the real record;
        // this local copy renders instantly and is replaced on the next sync.
        const msgId = 'pending-' + Date.now();
        if (!_chatData[_selectedCustomerId].messages) _chatData[_selectedCustomerId].messages = {};
        _chatData[_selectedCustomerId].messages[msgId] = {
            from: 'bot', text, ts: Date.now(), type: 'text'
        };
        _renderThreadView();
    } catch (e) {
        showToast('Could not send message: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// Wiring (once)
// ---------------------------------------------------------------------
function _wire() {
    if (_wired) return;
    _wired = true;
    const app = document.getElementById('chatApp');
    if (!app) return;

    app.addEventListener('click', (e) => {
        const sendBtn = e.target.closest('#chatSendBtn');
        if (sendBtn) { e.preventDefault(); _sendMessage(); return; }
        const backBtn = e.target.closest('#chatBackBtn');
        if (backBtn) { app.classList.remove('chat-conv-open'); return; }
        const thread = e.target.closest('.chat-thread');
        if (thread && thread.dataset.chatId) { _openThread(thread.dataset.chatId); return; }
    });

    app.addEventListener('keydown', (e) => {
        if (e.target.id === 'chatComposerInput' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _sendMessage();
        }
    });

    const searchEl = document.getElementById('chatSearch');
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            _searchTerm = searchEl.value;
            _renderThreadList();
        });
    }

    const composerInput = document.getElementById('chatComposerInput');
    if (composerInput) {
        composerInput.addEventListener('input', () => {
            composerInput.style.height = 'auto';
            composerInput.style.height = Math.min(composerInput.scrollHeight, 120) + 'px';
        });
    }
}

// ---------------------------------------------------------------------
// Load / cleanup
// ---------------------------------------------------------------------
export function loadChat() {
    console.log('[Chat] Loading tab…');
    _wire();
    _wireBlockedMenus(); // ponytail: WhatsApp-style 3-dot menus

    // Single persistent listener. Keeps the sidebar badge alive across tabs
    // (WhatsApp-like) AND renders the thread list while this tab is visible.
    // Re-bound when the admin switches outlet so it follows the new outlet's
    // chats instead of staying stuck on the first-load outlet.
    const outlet = Outlet.current;
    if (_listener && _listenerOutlet !== outlet) {
        _listener();
        _listener = null;
    }
    if (!_listener) {
        _listenerOutlet = outlet;
        _listener = onValue(_chatRef(''), (snap) => {
            _chatData = snap.val() || {};
            _updateBadges();
            const tab = document.getElementById('tab-chat');
            if (tab && !tab.classList.contains('hidden')) {
                _renderThreadList();
                _renderThreadView();
            }
        }, (err) => {
            console.error('[Chat] Listener error:', err);
        });
    }

    // Render immediately on (re)entry even though the listener is persistent.
    _renderThreadList();
    _renderThreadView();
    _startUsageListener();
}

export function cleanupChat() {
    _selectedCustomerId = null;
    _searchTerm = '';
    _stopUsageListener();
    const app = document.getElementById('chatApp');
    if (app) app.classList.remove('chat-conv-open');
}

// ── WhatsApp-style blocked contacts (3-dot menu) ─────────────────────
let _currentChatPhone = null; // phone of currently open conversation

function _getBlocked() { return window.__blockedNumbers?.list || []; }
async function _blockNumber(phone) {
    const list = _getBlocked();
    if (list.includes(phone)) return showToast('Already blocked', 'error');
    list.push(phone);
    window.__blockedNumbers.list = list;
    await window.__blockedNumbers.save();
    showToast('Contact blocked', 'success');
}
async function _unblockNumber(phone) {
    const list = _getBlocked();
    const idx = list.indexOf(phone);
    if (idx === -1) return;
    list.splice(idx, 1);
    window.__blockedNumbers.list = list;
    await window.__blockedNumbers.save();
    showToast('Contact unblocked', 'success');
    _renderBlockedList();
}

function _renderBlockedList() {
    const list = document.getElementById('blockedContactsList');
    const empty = document.getElementById('blockedContactsEmpty');
    if (!list) return;
    const blocked = _getBlocked();
    if (blocked.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = blocked.map(num => {
        // Try to find a name from chat data
        let name = '';
        for (const [, thread] of Object.entries(_chatData)) {
            if (thread.meta?.phone === num) { name = thread.meta?.name || ''; break; }
        }
        return `<div class="blocked-contact-row">
            <span class="blocked-contact-phone">${num}</span>
            ${name ? `<span class="blocked-contact-label">${escapeHtml(name)}</span>` : ''}
            <button class="blocked-contact-unblock" data-phone="${num}">Unblock</button>
        </div>`;
    }).join('');
}

function _updateBlockBtnText() {
    const btn = document.getElementById('btnBlockContact');
    if (!btn || !_currentChatPhone) return;
    const isBlocked = _getBlocked().includes(_currentChatPhone);
    btn.innerHTML = isBlocked
        ? '<i data-lucide="shield-check"></i> Unblock Contact'
        : '<i data-lucide="shield-off"></i> Block Contact';
    btn.classList.toggle('chat-menu-danger', !isBlocked);
    loadLucide(btn);
}

// ── Wire up menu click handlers ───────────────────────────────────────
function _wireBlockedMenus() {
    if (_blockedMenusWired) return;
    _blockedMenusWired = true;

    // Chat list 3-dot → Blocked Contacts
    document.getElementById('chatMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = document.getElementById('chatMenuDropdown');
        if (!dd) return;
        const wasHidden = dd.classList.contains('hidden');
        dd.classList.add('hidden');
        if (wasHidden) {
            const rect = e.currentTarget.getBoundingClientRect();
            dd.style.top = (rect.bottom + 4) + 'px';
            dd.style.right = (window.innerWidth - rect.right) + 'px';
            dd.style.left = 'auto';
            dd.classList.remove('hidden');
        }
    });
    document.getElementById('btnBlockedContacts')?.addEventListener('click', () => {
        document.getElementById('chatMenuDropdown')?.classList.add('hidden');
        _renderBlockedList();
        const modal = document.getElementById('blockedContactsModal');
        if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.chat-menu-wrap')) {
            document.getElementById('chatMenuDropdown')?.classList.add('hidden');
            document.getElementById('chatThreadMenuDropdown')?.classList.add('hidden');
        }
    });

    // Thread 3-dot → Block/Unblock
    document.getElementById('chatThreadMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        _updateBlockBtnText();
        const dd = document.getElementById('chatThreadMenuDropdown');
        if (!dd) return;
        const wasHidden = dd.classList.contains('hidden');
        dd.classList.add('hidden');
        if (wasHidden) {
            const rect = e.currentTarget.getBoundingClientRect();
            dd.style.top = (rect.bottom + 4) + 'px';
            dd.style.right = (window.innerWidth - rect.right) + 'px';
            dd.style.left = 'auto';
            dd.classList.remove('hidden');
        }
    });
    document.getElementById('btnBlockContact')?.addEventListener('click', async () => {
        document.getElementById('chatThreadMenuDropdown')?.classList.add('hidden');
        if (!_currentChatPhone) return;
        const list = _getBlocked();
        if (list.includes(_currentChatPhone)) {
            await _unblockNumber(_currentChatPhone);
        } else {
            await _blockNumber(_currentChatPhone);
        }
        _updateBlockBtnText();
    });

    // Unblock from modal list
    document.getElementById('blockedContactsList')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.blocked-contact-unblock');
        if (btn) await _unblockNumber(btn.dataset.phone);
    });

    // Close modal
    document.querySelectorAll('[data-close-modal="blockedContactsModal"]').forEach(el => {
        el.addEventListener('click', () => {
            const m = document.getElementById('blockedContactsModal');
            if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
        });
    });
}