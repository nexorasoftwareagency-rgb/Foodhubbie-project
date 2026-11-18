/**
 * FoodHubbie ERP | CHAT MODULE (Admin/js/features/chat.js)
 * ============================================================================
 * WhatsApp-style conversation viewer for customer<->bot chats.
 *
 * Data:  businesses/{bid}/outlets/{oid}/chatMeta/{customerId}/   <- LIST reads only this
 *          { name, phone, lastTs, lastText, lastDir, unread }
 *        businesses/{bid}/outlets/{oid}/chats/{customerId}/
 *          meta/     same shape (dual-written; still read by cached older shells)
 *          messages/{msgId} { from: 'customer'|'bot', text, ts, type }
 * Written by the bot (bot/chat-log.js). This module is read-only + reply:
 * replies go through the EXISTING `bot/commands` channel
 * (action: SEND_GENERIC_MESSAGE) — no new send path (see bot/index.js:301).
 *
 * NEVER listen to `chats` for the thread list: a query there returns every
 * message body with each row (measured 267 KB vs 9 KB of meta on a live outlet).
 * Message bodies are bound for the ONE open thread in _bindThreadMessages().
 *
 * conventions: lazy-load via mod('chat'), loadChat()/cleanupChat() exported
 * (switchTab in ui.js), badge in sidebar = total unread across threads.
 * ============================================================================
 */

import { Outlet, query, orderByChild, limitToLast, onValue, update, push, set, serverTimestamp } from '../firebase.js';
import { escapeHtml } from '../utils.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { loadLucide } from '../ui.js';
import { blockedContacts, chatLabels, chatState, normalizePhone, ensureSubscriptions } from '../chat-contacts.js';
import { replyWindow, windowLabel } from '../chat-contacts-math.js';

// ---------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------
let _listener = null;
let _listenerOutlet = null;
let _limit = 50;               // how many threads the list query pulls
let _chatData = {};              // customerId -> { meta, messages: {id: msg} } (messages only for the open thread)
let _selectedCustomerId = null;
let _renderedThreadId = null;
let _searchTerm = '';
let _filter = 'all';             // 'all' | 'unread' | 'archived'
let _labelFilter = null;         // label id, or null for no label filter
let _wired = false;
let _blockedMenusWired = false;
let _usageUnsub = null;         // bot/usage listener
let _usageData = null;          // today's usage snapshot
let _threadUnsub = null;        // messages listener for the ONE open thread
let _threadBoundId = null;
let _windowConfirmArmed = false; // admin already acknowledged the closed-window warning
let _contactSubsWired = false;   // the contact module's listeners are bound once

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
// Bot liveness (heartbeat truth)
// ---------------------------------------------------------------------
// A reply sent from here is only a COMMAND in bot/commands — the worker
// picks it up and sends it. The Admin must never claim it was delivered.
// Liveness comes from the global heartbeat listener (Admin/js/bot-status.js):
// the worker rewrites bot/status every 60s, so a stale lastSeen means the
// worker is gone and the command will sit in the queue.
function _botLiveness() {
    const online = window._botOnline === true;
    const lastSeen = Number(window._botLastSeen || 0);
    return { online, lastSeen, known: lastSeen > 0 };
}

function _agoLabel(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'less than a minute';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

// Honest strip above the composer: says whether replies go out now, wait in
// the queue, or (demo) never go out at all.
function _renderBotStatus() {
    const el = document.getElementById('chatBotStatus');
    if (!el) return;
    const { online, lastSeen, known } = _botLiveness();
    if (window.__demoMode === true) {
        el.textContent = 'Sandbox — replies are stored in this demo and never delivered to WhatsApp.';
        el.className = 'chat-bot-status chat-bot-status--info';
        return;
    }
    if (online) {
        el.textContent = '';
        el.className = 'chat-bot-status hidden';
        return;
    }
    el.textContent = known
        ? `Bot offline — last heartbeat ${_agoLabel(Date.now() - lastSeen)} ago. Replies you send are queued and go out when the bot reconnects.`
        : 'Bot status unknown — no heartbeat from the WhatsApp bot yet. Replies you send may be queued until it reconnects.';
    el.className = 'chat-bot-status chat-bot-status--warn';
}

function _updateComposerHint() {
    const input = document.getElementById('chatComposerInput');
    if (!input) return;
    const { online } = _botLiveness();
    const demo = window.__demoMode === true;
    input.placeholder = (!online && !demo)
        ? 'Bot offline — this reply will be queued'
        : 'Type a message';
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

/**
 * The 24h customer-service window of a thread.
 * Derived from the OPEN thread's messages (the only place bodies are loaded):
 * the window opens on a customer message and closes 24h later. A reply from
 * the restaurant does NOT extend it — only the customer can reopen it.
 * The maths lives in chat-contacts-math.js (pure, unit-tested).
 */
function _replyWindow(msgs) {
    return replyWindow(msgs);
}

function _windowLabel(win) {
    return windowLabel(win);
}

/** Label chips (filter row) with the number of threads carrying each label. */
function _renderLabelChips() {
    const box = document.getElementById('chatLabelChips');
    if (!box) return;
    const all = chatLabels.all || {};
    const ids = Object.keys(all);
    if (!ids.length) {
        box.innerHTML = '';
        if (_labelFilter) { _labelFilter = null; }
        return;
    }
    const counts = {};
    for (const [cid] of Object.entries(_chatData)) {
        for (const lid of (chatState.of(cid).labels || [])) counts[lid] = (counts[lid] || 0) + 1;
    }
    box.innerHTML = ids.map(id => {
        const l = all[id] || {};
        const active = _labelFilter === id;
        return `<button class="chat-label-chip${active ? ' active' : ''}" data-label-id="${escapeHtml(id)}" aria-pressed="${active}" title="${escapeHtml(l.name || id)}">
            <span class="chat-label-dot" style="background:${escapeHtml(l.color || '#94a3b8')}"></span>
            ${escapeHtml(l.name || id)}
            <span class="chat-label-chip-count">${counts[id] || 0}</span>
        </button>`;
    }).join('');
}

function _renderThreadList() {
    const listEl = document.getElementById('chatThreadList');
    if (!listEl) return;

    const term = _searchTerm.trim().toLowerCase();
    const threads = Object.entries(_chatData)
        .map(([id, t]) => ({ id, meta: t.meta || {}, state: chatState.of(id) }))
        .filter(t => {
            const archived = t.state.archived === true;
            if (_filter === 'archived') return archived;
            if (archived) return false;                       // archived chats leave the main list
            if (_filter === 'unread' && !(Number(t.meta.unread || 0) > 0)) return false;
            if (_labelFilter && !(t.state.labels || []).includes(_labelFilter)) return false;
            return true;
        })
        .filter(t => !term || _displayName(t.id, t.meta).toLowerCase().includes(term) || String(t.meta.phone || '').includes(term))
        .sort((a, b) => (b.meta.lastTs || 0) - (a.meta.lastTs || 0));

    if (threads.length === 0) {
        listEl.innerHTML = `<div class="chat-list-empty">${term ? 'No chats match your search.' : (_filter === 'archived' ? 'No archived chats.' : (_filter === 'unread' ? 'No unread chats.' : 'No conversations yet. When customers message the WhatsApp bot, their chats appear here.'))}</div>`;
        _renderLabelChips();
        _updateLoadMore();
        return;
    }

    const labels = chatLabels.all || {};
    listEl.innerHTML = threads.map(t => {
        const name = _displayName(t.id, t.meta);
        const meta = t.meta;
        const lastText = meta.lastText || '';
        const lastDir = meta.lastDir === 'bot' ? '➤ ' : '';
        const unread = Number(meta.unread || 0);
        const hue = _avatarHue(t.id);
        const tagHtml = (t.state.labels || []).map(lid => {
            const l = labels[lid] || {};
            return `<span class="chat-thread-label"><span class="chat-label-dot" style="background:${escapeHtml(l.color || '#94a3b8')}"></span>${escapeHtml(l.name || lid)}</span>`;
        }).join('');
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
                ${tagHtml ? `<div class="chat-thread-labels">${tagHtml}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    _renderLabelChips();
    _updateLoadMore();
    _updateBadges();
}

/**
 * The list query pulls the newest N threads. When N is reached there are
 * probably older ones the admin can neither see nor search — say so and
 * offer to pull more (the query limit is raised and the listener re-bound).
 */
function _updateLoadMore() {
    const btn = document.getElementById('chatLoadMore');
    if (!btn) return;
    const reached = Object.keys(_chatData).length >= _limit;
    btn.classList.toggle('hidden', !reached);
    if (reached) btn.textContent = `Load older chats (showing newest ${_limit})`;
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

    // Labels of the open thread
    const labelsEl = document.getElementById('chatThreadLabels');
    if (labelsEl) {
        const all = chatLabels.all || {};
        labelsEl.innerHTML = (chatState.of(_selectedCustomerId).labels || []).map(lid => {
            const l = all[lid] || {};
            return `<span class="chat-thread-label"><span class="chat-label-dot" style="background:${escapeHtml(l.color || '#94a3b8')}"></span>${escapeHtml(l.name || lid)}</span>`;
        }).join('');
    }

    // 24h customer-service window
    // The bodies of a thread are loaded lazily — while they are still in
    // flight the window is UNKNOWN (not "closed"): saying "closed" would be
    // a lie and would block the reply for no reason.
    const bodiesLoaded = t.messages !== undefined;
    const win = _replyWindow(msgs.map(([, m]) => m));
    const winEl = document.getElementById('chatThreadWindow');
    if (winEl) {
        if (!bodiesLoaded) {
            winEl.textContent = '';
            winEl.classList.add('hidden');
            winEl.removeAttribute('title');
        } else {
            winEl.textContent = _windowLabel(win);
            winEl.classList.remove('hidden');
            winEl.classList.toggle('is-closed', !win.open);
            winEl.title = win.unknown
                ? 'No customer message in this thread yet — free-form replies need a customer message to open the 24h window.'
                : (win.open
                    ? 'This customer messaged recently, so a free-form reply is allowed (and is not billed as a service message).'
                    : 'The 24h window has closed. On the official WhatsApp API only approved templates can be sent now — a free-form reply will be charged as a service message.');
        }
    }
    _renderWindowNotice(win, bodiesLoaded);

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
    const { online } = _botLiveness();
    const demo = window.__demoMode === true;
    for (const [msgId, m] of msgs) {
        const day = _dayLabel(m.ts);
        if (day !== lastDay) {
            html += `<div class="chat-day-sep"><span>${escapeHtml(day)}</span></div>`;
            lastDay = day;
        }
        const isBot = m.from === 'bot';
        // A pending bubble is a command that was QUEUED, not a message that
        // was sent — it must never carry the delivered ✓✓ ticks.
        const isPending = m.pending === true;
        const state = isPending
            ? (demo
                ? '<span class="chat-msg-state chat-msg-state--demo">demo — not delivered</span>'
                : `<span class="chat-msg-state ${online ? 'chat-msg-state--sending' : 'chat-msg-state--queued'}">${online ? 'sending…' : 'queued'}</span>`)
            : (isBot ? ' <span class="chat-ticks">✓✓</span>' : '');
        const body = m.type === 'location'
            ? '<i data-lucide="map-pin" class="icon-16"></i> Location shared'
            : (m.text || '<media>');
        html += `<div class="chat-bubble-row ${isBot ? 'out' : 'in'}${isPending ? ' chat-bubble-pending' : ''}">
            <div class="chat-bubble">${escapeHtml(body)}
                <span class="chat-msg-time">${escapeHtml(_timeLabel(m.ts))}${state}</span>
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
// Message bodies load for the OPEN thread only. Attaching this to the thread
// list is what used to make every Admin open cost the whole conversation
// history — keep it scoped to one thread.
function _bindThreadMessages(customerId) {
    if (_threadBoundId === customerId && _threadUnsub) return;
    if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }
    _threadBoundId = customerId;
    if (!customerId) return;
    _threadUnsub = onValue(_chatRef(`${customerId}/messages`), (snap) => {
        const row = _chatData[customerId];
        if (!row) return;
        row.messages = snap.val() || {};
        if (_selectedCustomerId === customerId) _renderThreadView();
    }, () => {});
}

async function _openThread(customerId) {
    _selectedCustomerId = customerId;
    // A closed-window warning belongs to the thread it was raised for.
    _windowConfirmArmed = false;
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) { sendBtn.classList.remove('chat-send-warn'); sendBtn.removeAttribute('title'); }
    // Clear unread (best-effort — read marker). chatMeta is the list's source of
    // truth; chats/{id}/meta is still mirrored for cached older shells.
    if (_chatData[customerId]?.meta?.unread) {
        update(Outlet.ref(`chatMeta/${customerId}`), { unread: 0 }).catch(() => {});
        update(_chatRef(`${customerId}/meta`), { unread: 0 }).catch(() => {});
        _chatData[customerId].meta.unread = 0;
    }
    _bindThreadMessages(customerId);
    _renderThreadList();
    _renderThreadView();
    _updateArchiveBtnText();

    // Mobile: swap list pane for the conversation pane
    const app = document.getElementById('chatApp');
    if (app && window.innerWidth <= 768) app.classList.add('chat-conv-open');
}

/**
 * The strip above the composer. It states the truth about the reply window:
 * outside the 24h window a free-form message is billed as a service message
 * (and rejected outright on the official WhatsApp API), so the admin is told
 * BEFORE sending, not after the money is spent.
 */
function _renderWindowNotice(win, bodiesLoaded = true) {
    const el = document.getElementById('chatWindowNotice');
    if (!el) return;
    if (!_selectedCustomerId || win.open || !bodiesLoaded) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = win.unknown
        ? 'This customer has not messaged yet. On the official WhatsApp API a free-form reply is only allowed after the customer messages you — send an approved template instead.'
        : 'The 24h reply window has closed. A free-form reply is billed as a service message (and rejected on the official WhatsApp API). Send an approved template instead.';
}

/**
 * Cost guard: the first send outside the reply window asks for a deliberate
 * confirmation (the button becomes "Send anyway"), the second one sends.
 */
function _guardClosedWindow(win) {
    if (win.open) return true;
    if (_windowConfirmArmed) { _windowConfirmArmed = false; return true; }
    _windowConfirmArmed = true;
    const btn = document.getElementById('chatSendBtn');
    if (btn) {
        btn.title = 'The 24h reply window is closed — click again to send anyway';
        btn.classList.add('chat-send-warn');
    }
    showToast(win.unknown
        ? 'No customer message in this thread — on the official WhatsApp API only approved templates can be sent. Click send again to send anyway.'
        : 'Reply window closed — this message will be billed as a service message. Click send again to go ahead.',
        'error', 7000);
    return false;
}

async function _sendMessage() {
    const inputEl = document.getElementById('chatComposerInput');
    const text = (inputEl?.value || '').trim();
    if (!text || !_selectedCustomerId) return;
    const meta = _chatData[_selectedCustomerId]?.meta;
    const phone = meta?.phone || `${_selectedCustomerId}@s.whatsapp.net`;
    if (!phone) { showToast('Cannot send — no customer number on this thread.', 'error'); return; }

    const win = _replyWindow(Object.values(_chatData[_selectedCustomerId]?.messages || {}));
    if (!_guardClosedWindow(win)) return;
    // The warning state belongs to one attempt — clear it once the admin
    // went ahead (the button must not stay amber after a normal send).
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) { sendBtn.classList.remove('chat-send-warn'); sendBtn.removeAttribute('title'); }

    const { online } = _botLiveness();
    const demo = window.__demoMode === true;

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
        // It is NOT a delivery receipt: the command only reaches WhatsApp when
        // the worker is alive, so the bubble is marked pending (queued).
        const msgId = 'pending-' + Date.now();
        if (!_chatData[_selectedCustomerId].messages) _chatData[_selectedCustomerId].messages = {};
        _chatData[_selectedCustomerId].messages[msgId] = {
            from: 'bot', text, ts: Date.now(), type: 'text', pending: true
        };
        _renderThreadView();
        if (demo) {
            showToast('Sandbox — reply stored here, not delivered to WhatsApp.', 'info', 4000);
        } else if (!online) {
            showToast('Bot offline — reply queued until it reconnects.', 'info', 5000);
        }
    } catch (e) {
        showToast('Could not send message: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// Wiring (once)
// ---------------------------------------------------------------------
let _lastOnline = null;

// Liveness changed (worker died or came back) → refresh the strip, the
// composer hint and the state of every pending bubble ("sending…" <-> "queued").
function _onBotStatusChange() {
    const { online } = _botLiveness();
    _renderBotStatus();
    _updateComposerHint();
    if (online === _lastOnline) return;
    _lastOnline = online;
    const tab = document.getElementById('tab-chat');
    if (tab && !tab.classList.contains('hidden')) _renderThreadView();
}

function _wire() {
    if (_wired) return;
    _wired = true;
    window.addEventListener('botStatusChange', _onBotStatusChange);
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

    // Filter tabs (All / Unread / Archived)
    document.querySelectorAll('[data-chat-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            _filter = btn.dataset.chatFilter || 'all';
            document.querySelectorAll('[data-chat-filter]').forEach(b => {
                const on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            _renderThreadList();
        });
    });

    // Label filter chips
    document.getElementById('chatLabelChips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-label-id]');
        if (!chip) return;
        const id = chip.dataset.labelId;
        _labelFilter = _labelFilter === id ? null : id;
        _renderThreadList();
    });

    // Load older chats (raise the query limit and re-bind the listener)
    document.getElementById('chatLoadMore')?.addEventListener('click', () => {
        _limit += 50;
        _bindThreadListener(true);
    });

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
    _wireLabelsModal();  // labels: assign to a chat + manage the library
    _checkBotStatus();
    _lastOnline = _botLiveness().online;
    _renderBotStatus();
    _updateComposerHint();

    // Contact management (block list / labels / archive) — one module owns
    // all three, subscribed live so the Chat tab and the Settings tab always
    // agree with each other and with the bot. Subscribed ONCE (the tab is
    // re-entered on every switch) — the module keeps the listeners alive
    // across visits, exactly like the thread-list listener below.
    ensureSubscriptions();
    if (!_contactSubsWired) {
        _contactSubsWired = true;
        blockedContacts.subscribe(() => { _updateBlockBtnText(); _renderBlockedList(); });
        chatLabels.subscribe(() => { _renderLabelChips(); _renderThreadList(); _renderThreadView(); });
        chatState.subscribe(() => { _renderThreadList(); _renderThreadView(); _updateArchiveBtnText(); });
    }

    // Single persistent listener. Keeps the sidebar badge alive across tabs
    // (WhatsApp-like) AND renders the thread list while this tab is visible.
    // Re-bound when the admin switches outlet so it follows the new outlet's
    // chats instead of staying stuck on the first-load outlet.
    _bindThreadListener();

    // Render immediately on (re)entry even though the listener is persistent.
    _renderThreadList();
    _renderThreadView();
    _startUsageListener();
}

/**
 * Bind the thread-list query.
 * The list reads the flat meta mirror, never the threads themselves. One row
 * here is ~400 B with no message bodies, so this is 9.4 KB instead of
 * 267 KB on a live outlet. Bodies load per-thread in _bindThreadMessages().
 * Needs .indexOn ['lastTs'] in database.rules.json.
 *
 * NOTE: Outlet.ref() returns a Reference, which has no .orderByChild — the
 * previous `_chatRef('').orderByChild(...)` threw on every Chat open and
 * left the list permanently empty. Ordering must go through query().
 */
function _bindThreadListener(force = false) {
    const outlet = Outlet.current;
    if (_listener && (_listenerOutlet !== outlet || force)) {
        _listener();
        _listener = null;
    }
    if (_listener) return;
    _listenerOutlet = outlet;
    // The list reads the flat meta mirror, never the threads themselves
    // (see the note above).
    _listener = onValue(query(Outlet.ref('chatMeta'), orderByChild('lastTs'), limitToLast(_limit)), (snap) => {
        const metas = snap.val() || {};
        const next = {};
        for (const [id, meta] of Object.entries(metas)) {
            // Keep any messages already loaded for the open thread.
            next[id] = { meta: meta || {}, messages: _chatData[id]?.messages };
        }
        _chatData = next;
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

// ── WhatsApp bot onboarding ──────────────────────────────────────────
let _pairUnsub = null;
// Per-visit dismissal. The onboarding wall must never be the only door to
// chat history: pair.status reads non-connected for days while the bot is
// stopped or awaiting a QR re-pair, and old conversations stay fully
// readable that whole time. Reset on every loadChat() so a fresh tab visit
// sees onboarding again until the bot connects.
let _onboardingDismissed = false;

function _checkBotStatus() {
    if (_pairUnsub) { _pairUnsub(); _pairUnsub = null; }
    _onboardingDismissed = false; // fresh visit — onboarding gets priority again
    let pair = null;
    let waActive = false;
    const apply = () => {
        const tab = document.getElementById('tab-chat');
        if (!tab) return;
        if ((pair && pair.status === 'connected') || waActive) _hideOnboarding();
        else if (!_onboardingDismissed) _showOnboarding(pair);
    };
    const unsubPair = onValue(Outlet.ref('bot/pair'), (snap) => {
        pair = snap.val();
        apply();
    }, (err) => {
        console.warn('[Chat] pair listener error:', err);
    });
    // Supreme Meta-linked outlets never write bot/pair (transport=meta skips the
    // Baileys pair chain) — also treat outlets/{oid}/whatsapp.status 'active'
    // (written by Embedded Signup linking) as connected.
    const unsubWa = onValue(Outlet.ref('whatsapp/status'), (snap) => {
        waActive = snap.val() === 'active';
        apply();
    }, () => {});
    _pairUnsub = () => { unsubPair(); unsubWa(); };
}

function _showOnboarding(pair) {
    let el = document.getElementById('wa-onboarding');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wa-onboarding';
        el.style.cssText = 'position:absolute;inset:0;z-index:50;background:var(--bg-elevated,#121821);display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:24px;';
        el.innerHTML = `
            <div style="max-width:520px;width:100%;text-align:center">
                <div style="font-size:48px;margin-bottom:12px">📱</div>
                <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Connect Your WhatsApp Bot</h2>
                <p style="color:var(--text-secondary);font-size:14px;margin-bottom:24px">Follow the steps below to link your WhatsApp Business number as a co-existence bot.</p>
                <p style="font-size:12px;color:var(--text-muted,#8b95a5);margin:-14px 0 20px">Your past conversations stay available — <button id="waViewHistory" type="button" style="background:none;border:none;padding:0;font:inherit;font-size:12px;color:var(--text-secondary);text-decoration:underline;cursor:pointer">view chat history</button></p>
                <div style="background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.09));border-radius:14px;padding:20px;margin-bottom:16px">
                    <div style="font-size:13px;font-weight:700;margin-bottom:12px;text-align:left">Step-by-step guide:</div>
                    <div style="text-align:left;font-size:13px;line-height:2;color:var(--text-secondary)">
                        1. Open WhatsApp on your restaurant phone<br>
                        2. Go to <strong>Settings → Linked Devices</strong><br>
                        3. Click <strong>"Link a Device"</strong><br>
                        4. Scan the QR code below with your phone
                    </div>
                </div>
                <div id="wa-qr-container" style="display:flex;justify-content:center;margin-bottom:16px">
                    <div style="width:200px;height:200px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#666;font-size:13px">Loading QR…</div>
                </div>
                <div id="wa-pair-status" style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">Waiting for QR code…</div>
                <div style="background:var(--glass-bg,rgba(255,255,255,.04));border:1px solid var(--glass-border,rgba(255,255,255,.09));border-radius:14px;padding:16px;text-align:left;margin-bottom:16px">
                    <div style="font-size:13px;font-weight:700;margin-bottom:8px">📖 Full Manual</div>
                    <div style="font-size:12px;line-height:1.8;color:var(--text-secondary)">
                        <strong>Requirements:</strong><br>
                        • A WhatsApp Business account (or personal WhatsApp)<br>
                        • An Android or iOS phone with WhatsApp installed<br>
                        • The phone must have an active internet connection<br><br>
                        <strong>Troubleshooting:</strong><br>
                        • QR expired? Refresh this page to get a new one<br>
                        • Number banned? Contact Supreme Admin for a new number<br>
                        • Already linked elsewhere? Unlink from other devices first<br><br>
                        <strong>Need help?</strong> Contact Supreme Admin for assistance.
                    </div>
                </div>
            </div>
        `;
        const chatApp = document.getElementById('chatApp');
        if (chatApp) chatApp.appendChild(el);
        // Escape hatch — never trap chat history behind onboarding.
        el.querySelector('#waViewHistory')?.addEventListener('click', (e) => {
            e.preventDefault();
            _onboardingDismissed = true;
            _hideOnboarding();
        });
    }
    el.style.display = 'flex';
    _renderQR(pair);
}

function _hideOnboarding() {
    const el = document.getElementById('wa-onboarding');
    if (el) el.style.display = 'none';
}

function _renderQR(pair) {
    const container = document.getElementById('wa-qr-container');
    const statusEl = document.getElementById('wa-pair-status');
    if (!container) return;
    if (pair?.qr) {
        container.innerHTML = `<img src="${pair.qr}" alt="WhatsApp QR Code" style="width:200px;height:200px;border-radius:12px" />`;
        if (statusEl) statusEl.textContent = 'Scan this QR code with your phone';
    } else {
        container.innerHTML = `<div style="width:200px;height:200px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#666;font-size:13px">Waiting for QR…</div>`;
        if (statusEl) {
            // The pairing QR is produced by the worker. If the worker is not
            // reporting, the QR will never appear — saying "waiting for QR"
            // would send the admin looking for a code that cannot exist.
            const { online, known } = _botLiveness();
            statusEl.textContent = online
                ? 'Waiting for QR code…'
                : (known
                    ? 'The bot stopped reporting — this QR appears once the WhatsApp host is back.'
                    : 'Waiting for the bot to start — this QR appears once the WhatsApp host is up.');
        }
    }
}

export function cleanupChat() {
    _selectedCustomerId = null;
    _searchTerm = '';
    _filter = 'all';
    _labelFilter = null;
    _windowConfirmArmed = false;
    // Reset the filter tabs so a re-entry starts on "All" (the DOM classes
    // are owned by the markup, not by a re-render).
    document.querySelectorAll('[data-chat-filter]').forEach(b => {
        const on = b.dataset.chatFilter === 'all';
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (_threadUnsub) { _threadUnsub(); _threadUnsub = null; }
    _threadBoundId = null;
    _stopUsageListener();
    const app = document.getElementById('chatApp');
    if (app) app.classList.remove('chat-conv-open');
}

// ── WhatsApp-style blocked contacts (3-dot menu) ─────────────────────
let _currentChatPhone = null; // phone of currently open conversation

// The block list lives in ONE place (Admin/js/chat-contacts.js). It used to
// be read through `window.__blockedNumbers`, a global owned by
// features/settings.js — a LAZILY imported module. Until the admin opened
// the Settings tab at least once, that global was undefined, so "Block
// Contact" threw a TypeError and did nothing and the Blocked Contacts modal
// was always empty. The Chat tab now owns its own data.
function _getBlocked() { return blockedContacts.list; }

async function _blockNumber(phone) {
    try {
        const changed = await blockedContacts.block(phone);
        showToast(changed ? 'Contact blocked — the bot will ignore them now.' : 'Already blocked', changed ? 'success' : 'error');
        _renderBlockedList();
        _updateBlockBtnText();
    } catch (e) {
        console.error('[Chat] block failed', e);
        showToast('Could not block contact: ' + (e?.message || e), 'error');
    }
}

async function _unblockNumber(phone) {
    try {
        const changed = await blockedContacts.unblock(phone);
        if (!changed) return;
        showToast('Contact unblocked', 'success');
        _renderBlockedList();
        _updateBlockBtnText();
    } catch (e) {
        console.error('[Chat] unblock failed', e);
        showToast('Could not unblock contact: ' + (e?.message || e), 'error');
    }
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
            if (normalizePhone(thread.meta?.phone) === num) { name = thread.meta?.name || ''; break; }
        }
        return `<div class="blocked-contact-row">
            <span class="blocked-contact-phone">+${escapeHtml(num)}</span>
            ${name ? `<span class="blocked-contact-label">${escapeHtml(name)}</span>` : ''}
            <button class="blocked-contact-unblock" data-phone="${escapeHtml(num)}">Unblock</button>
        </div>`;
    }).join('');
}

function _updateBlockBtnText() {
    const btn = document.getElementById('btnBlockContact');
    if (!btn || !_currentChatPhone) return;
    const isBlocked = blockedContacts.isBlocked(_currentChatPhone);
    btn.innerHTML = isBlocked
        ? '<i data-lucide="shield-check"></i> Unblock Contact'
        : '<i data-lucide="shield-off"></i> Block Contact';
    btn.classList.toggle('chat-menu-danger', !isBlocked);
    loadLucide(btn);
}

/**
 * The archive menu item says what it WILL do — "Unarchive chat" when the
 * open thread is already archived. A static label made the second click
 * (which unarchives) look like it was archiving again.
 */
function _updateArchiveBtnText() {
    const btn = document.getElementById('btnArchiveChat');
    if (!btn || !_selectedCustomerId) return;
    const archived = chatState.of(_selectedCustomerId).archived === true;
    btn.innerHTML = archived
        ? '<i data-lucide="archive-restore"></i> Unarchive chat'
        : '<i data-lucide="archive"></i> Archive chat';
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
        // The Admin modal pattern is `.modal` + `.active` (style.css) — the
        // old `remove('hidden')` left the modal invisible AND unclickable,
        // so "Blocked Contacts" showed nothing at all.
        const modal = document.getElementById('blockedContactsModal');
        if (modal) { modal.classList.remove('hidden'); modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); }
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
        // The list holds DIGITS (the form the bot matches); the thread carries
        // the raw JID — compare through the shared helper, never with
        // Array.includes on the raw string.
        if (blockedContacts.isBlocked(_currentChatPhone)) {
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

    // Archive / unarchive the open thread
    document.getElementById('btnArchiveChat')?.addEventListener('click', async () => {
        document.getElementById('chatThreadMenuDropdown')?.classList.add('hidden');
        const cid = _selectedCustomerId;
        if (!cid) return;
        const archived = chatState.of(cid).archived === true;
        try {
            await chatState.setArchived(cid, !archived);
            showToast(archived ? 'Chat restored to the list' : 'Chat archived', 'success');
            _renderThreadList();
            _renderThreadView();
            _updateArchiveBtnText();
        } catch (err) {
            console.error('[Chat] archive failed', err);
            showToast('Could not archive chat: ' + (err?.message || err), 'error');
        }
    });

    // Labels for the open thread
    document.getElementById('btnChatLabels')?.addEventListener('click', () => {
        document.getElementById('chatThreadMenuDropdown')?.classList.add('hidden');
        _openLabelsModal(_selectedCustomerId);
    });
    document.getElementById('btnManageLabels')?.addEventListener('click', () => {
        document.getElementById('chatMenuDropdown')?.classList.add('hidden');
        _openLabelsModal(null);
    });

    // Close modal
    document.querySelectorAll('[data-close-modal="blockedContactsModal"]').forEach(el => {
        el.addEventListener('click', () => {
            const m = document.getElementById('blockedContactsModal');
            if (m) { m.classList.remove('active', 'hidden'); m.setAttribute('aria-hidden', 'true'); }
        });
    });
    document.querySelectorAll('[data-close-modal="chatLabelsModal"]').forEach(el => {
        el.addEventListener('click', () => _closeLabelsModal());
    });
}

// ── WhatsApp-style labels (customer lists) ────────────────────────────
// A label is a named group of customers (VIP, complaints, festival orders).
// WhatsApp Business caps a business at 20 labels — same cap here.
let _labelModalCustomerId = null;

function _openLabelsModal(customerId) {
    _labelModalCustomerId = customerId || null;
    const assignWrap = document.getElementById('chatLabelAssignWrap');
    const target = document.getElementById('chatLabelAssignTarget');
    if (assignWrap) assignWrap.classList.toggle('hidden', !customerId);
    if (target && customerId) {
        const meta = _chatData[customerId]?.meta || {};
        target.textContent = _displayName(customerId, meta);
    }
    _renderLabelsModal();
    const modal = document.getElementById('chatLabelsModal');
    // `.modal` + `.active` is the Admin's modal pattern (style.css) — without
    // `active` the modal stays invisible and unclickable.
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); }
}

function _closeLabelsModal() {
    const modal = document.getElementById('chatLabelsModal');
    if (modal) { modal.classList.remove('active', 'hidden'); modal.setAttribute('aria-hidden', 'true'); }
    _labelModalCustomerId = null;
}

function _labelUsageCounts() {
    const counts = {};
    for (const [cid] of Object.entries(_chatData)) {
        for (const lid of (chatState.of(cid).labels || [])) counts[lid] = (counts[lid] || 0) + 1;
    }
    return counts;
}

function _renderLabelsModal() {
    const all = chatLabels.all || {};
    const ids = Object.keys(all);
    const assignList = document.getElementById('chatLabelAssignList');
    if (assignList) {
        const cur = _labelModalCustomerId ? (chatState.of(_labelModalCustomerId).labels || []) : [];
        assignList.innerHTML = ids.length
            ? ids.map(id => {
                const l = all[id] || {};
                return `<label class="chat-label-row">
                    <input type="checkbox" data-assign-label="${escapeHtml(id)}" ${cur.includes(id) ? 'checked' : ''}>
                    <span class="chat-label-dot" style="background:${escapeHtml(l.color || '#94a3b8')}"></span>
                    <span class="chat-label-row-name">${escapeHtml(l.name || id)}</span>
                </label>`;
            }).join('')
            : '<div class="chat-list-empty">No labels yet — create one below.</div>';
    }
    const manageList = document.getElementById('chatLabelManageList');
    if (manageList) {
        const counts = _labelUsageCounts();
        manageList.innerHTML = ids.length
            ? ids.map(id => {
                const l = all[id] || {};
                const n = counts[id] || 0;
                return `<div class="chat-label-row">
                    <span class="chat-label-dot" style="background:${escapeHtml(l.color || '#94a3b8')}"></span>
                    <input class="chat-label-row-input" data-label-name="${escapeHtml(id)}" value="${escapeHtml(l.name || id)}" maxlength="24" aria-label="Label name">
                    <span class="chat-label-row-count">${n} chat${n === 1 ? '' : 's'}</span>
                    <button type="button" class="chat-label-row-delete" data-delete-label="${escapeHtml(id)}" aria-label="Delete label">Delete</button>
                </div>`;
            }).join('')
            : '<div class="chat-list-empty">No labels yet. Create one to group customers.</div>';
    }
}

function _wireLabelsModal() {
    const modal = document.getElementById('chatLabelsModal');
    if (!modal || modal.dataset.wired === '1') return;
    modal.dataset.wired = '1';

    // Assign / unassign a label on the open thread
    modal.addEventListener('change', async (e) => {
        const cb = e.target.closest('[data-assign-label]');
        if (!cb || !_labelModalCustomerId) return;
        try {
            await chatState.toggleLabel(_labelModalCustomerId, cb.dataset.assignLabel);
            _renderLabelsModal();
            _renderThreadList();
            _renderThreadView();
        } catch (err) {
            console.error('[Chat] label assign failed', err);
            showToast('Could not update labels: ' + (err?.message || err), 'error');
        }
    });

    // Rename a label (the name is an editable field — saves on change)
    modal.addEventListener('change', async (e) => {
        const input = e.target.closest('[data-label-name]');
        if (!input) return;
        const id = input.dataset.labelName;
        const name = input.value.trim();
        if (!name) { _renderLabelsModal(); return; }
        try {
            await chatLabels.rename(id, name);
            showToast('Label renamed', 'success');
            _renderLabelsModal();
            _renderThreadList();
            _renderThreadView();
        } catch (err) {
            console.error('[Chat] label rename failed', err);
            showToast('Could not rename label: ' + (err?.message || err), 'error');
            _renderLabelsModal();
        }
    });

    // Delete a label (it is stripped from every thread that carried it)
    modal.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-delete-label]');
        if (del) {
            const id = del.dataset.deleteLabel;
            const l = (chatLabels.all || {})[id] || {};
            const ok = await showConfirm(`Delete the label "${l.name || id}"? It will be removed from every chat.`, 'Delete label');
            if (!ok) return;
            try {
                await chatLabels.remove(id);
                showToast('Label deleted', 'success');
                if (_labelFilter === id) _labelFilter = null;
                _renderLabelsModal();
                _renderThreadList();
                _renderThreadView();
            } catch (err) {
                console.error('[Chat] label delete failed', err);
                showToast('Could not delete label: ' + (err?.message || err), 'error');
            }
            return;
        }
        if (e.target.closest('#btnCreateLabel')) {
            const input = document.getElementById('chatNewLabelInput');
            const name = (input?.value || '').trim();
            if (!name) { showToast('Type a label name first', 'error'); return; }
            try {
                await chatLabels.create(name);
                input.value = '';
                showToast('Label created', 'success');
                _renderLabelsModal();
                _renderThreadList();
            } catch (err) {
                console.error('[Chat] label create failed', err);
                showToast(err?.message || 'Could not create label', 'error');
            }
        }
    });

    document.getElementById('chatNewLabelInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnCreateLabel')?.click(); }
    });
}