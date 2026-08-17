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
let _searchTerm = '';
let _wired = false;

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

    const msgs = Object.entries(t.messages || {}).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    const listEl = document.getElementById('chatMessageList');
    if (!listEl) return;

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

    // Scrolling follows newest message
    requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
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
}

export function cleanupChat() {
    // The listener stays attached — the sidebar badge must keep counting while
    // the admin works elsewhere. Only per-visit state is reset.
    _selectedCustomerId = null;
    _searchTerm = '';
    const app = document.getElementById('chatApp');
    if (app) app.classList.remove('chat-conv-open');
}