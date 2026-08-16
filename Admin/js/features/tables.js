/**
 * FoodHubbie ERP | TABLE MANAGEMENT MODULE  (Admin/js/features/tables.js)
 * ============================================================================
 * Implements the session-based Dine-In architecture:
 *   pizza/tables          — floor plan, status, capacity, secure token
 *   pizza/tableSessions   — one session = one running bill, holds an array
 *                            of orderIds; multiple orders roll into ONE total
 *   pizza/orders           — UNCHANGED existing node. Dine-in orders get
 *                            extra fields: type, source, table, tableId,
 *                            tableToken, sessionId. No parallel orders system.
 *
 * Matches "Decision #2": orders reuse the EXISTING /orders node for Online,
 * Walk-in POS, and QR Dine-In. This module never writes a competing
 * dineinOrders/qrOrders node.
 *
 * COMPATIBILITY NOTE on type string: this codebase's STATUS_SEQUENCES
 * already defines  'Dine-in': ["Confirmed", "Ready", "Delivered"]  in
 * orders.js. The architecture doc specifies type:"DineIn" (no hyphen).
 * To avoid breaking the EXISTING getStatusOptions()/STATUS_SEQUENCES
 * lookup (keyed on the literal string 'Dine-in'), this module writes
 * type:"Dine-in" — identical spelling to the pre-existing constant —
 * while adding source:"QR" to distinguish QR-originated orders from a
 * counter/POS dine-in entry. This is the ONLY deviation from the literal
 * spec text, made specifically so orders.js's status pipeline keeps
 * working without modification. See "Compatibility Notes" in the
 * Commands & Guidance document.
 * ============================================================================
 */

import { Outlet, BUSINESS_ID, ref, get, onValue, set, update, remove, push, runTransaction, isConnected, onConnectionChange } from '../firebase.js';
import { state } from '../state.js';
import { showToast, showConfirm, showDeleteConfirm, showPaymentPicker } from '../ui-utils.js';
import { printOrderReceipt } from './printing.js';
import { haptic, escapeHtml, playNotificationSound } from '../utils.js';
import { loadLucide } from '../ui.js';

// ---------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------
let _tablesListener = null;
let _sessionsListener = null;
let _ordersListener = null;
let _requestsListener = null;
let _connUnsub = null;
let _ordersListenerAttached = false;
let _kdsTickInterval = null;
let _policeInterval = null;

let _tables = {};
let _sessions = {};
let _orders = {};
let _tableRequests = {};
let _seenRequestIds = null;
let _drawerTableId = null;
let _qrModalOpening = false; // guard against double-fire from #tab-tables + main.js

function _tblRef(sub) { return Outlet.ref(`tables${sub ? '/' + sub : ''}`); }
function _ms(v) { return typeof v === 'number' ? v : new Date(v || 0).getTime(); }
function _sessRef(sub) { return Outlet.ref(`tableSessions${sub ? '/' + sub : ''}`); }
function _ordersRef(sub) { return Outlet.ref(`orders${sub ? '/' + sub : ''}`); }
function _settingsRef(sub) { return Outlet.ref(`dineinSettings${sub ? '/' + sub : ''}`); }
function _reqRef(sub) { return Outlet.ref(`tableRequests${sub ? '/' + sub : ''}`); }
function _pad2(n) { return String(n).padStart(2, '0'); }

// Secure token generator — NEVER a sequential/guessable value (Decision #6)
function _secureToken() {
    const bytes = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(36)).join('').slice(0, 16).toUpperCase();
}

// ---------------------------------------------------------------------
// STATUS META
// ---------------------------------------------------------------------
const TABLE_STATUS_META = {
    free:     { label: 'Free',     icon: 'check-circle', cls: 'table-status-free' },
    occupied: { label: 'Occupied', icon: 'users',         cls: 'table-status-occupied' },
    billing:  { label: 'Billing',  icon: 'receipt',       cls: 'table-status-billing' },
    disabled: { label: 'Disabled', icon: 'ban',           cls: 'table-status-disabled' }
};
function _statusMeta(status) { return TABLE_STATUS_META[status] || TABLE_STATUS_META.free; }

// ---------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------
function _sessionForTable(tableId) {
    const t = _tables[tableId];
    if (!t?.currentSession) return null;
    return _sessions[t.currentSession] || null;
}

/** Compute session total from individual non-cancelled orders (avoids inflated sess.grandTotal). */
function _effectiveTotal(sess) {
    if (!sess?.orders && !sess?.orderGroups) return 0;
    const orderIds = new Set([...(sess.orders || [])]);
    if (sess.orderGroups) {
        Object.values(sess.orderGroups).forEach(g => (g.orders || []).forEach(oid => orderIds.add(oid)));
    }
    const orders = Array.from(orderIds).map(oid => _orders[oid]).filter(Boolean);
    return orders.reduce((sum, o) => o.status !== 'Cancelled' ? sum + Number(o.total || 0) : sum, 0);
}

function _ordersForSession(sessionId) {
    const sess = _sessions[sessionId];
    if (!sess?.orders) return [];
    return sess.orders.map(oid => ({ id: oid, ...(_orders[oid] || {}) })).filter(o => o.id);
}

function _orderGroupsForSession(sessionId) {
    const sess = _sessions[sessionId];
    if (!sess?.orderGroups) return [];
    return Object.entries(sess.orderGroups).map(([id, g]) => ({ id, ...g }));
}

function _ordersForGroup(sessionId, groupId) {
    const sess = _sessions[sessionId];
    if (!sess?.orderGroups?.[groupId]?.orders) return [];
    return sess.orderGroups[groupId].orders.map(oid => ({ id: oid, ...(_orders[oid] || {}) })).filter(o => o.id);
}

function _dineInOrders() {
    return Object.entries(_orders)
        .map(([id, o]) => ({ id, ...o }))
        .filter(o => o.type === 'Dine-in' && o.status !== 'Delivered' && o.status !== 'Cancelled' && o.status !== 'Served' && o.status !== 'Pending')
        .sort((a, b) => _ms(b.createdAt) - _ms(a.createdAt));
}

const _customerSyncedOrderIds = new Set();

function _syncCustomersFromOrders(orders) {
    Object.entries(orders).forEach(([id, o]) => {
        if (_customerSyncedOrderIds.has(id)) return;
        if (o.type !== 'Dine-in' || o.source !== 'QR') return;
        const phone = String(o.customerPhone || '').replace(/[^\d]/g, '');
        if (phone.length < 10) {
            // Phone no longer stored on order (moved to tableSessionsContact for PII safety)
            // Try async lookup from the restricted path — fire-and-forget to avoid blocking.
            if (o.sessionId) {
                get(Outlet.ref(`tableSessionsContact/${o.sessionId}`)).then(snap => {
                    const contact = snap.val();
                    if (!contact) return;
                    const cp = String(contact.customerPhone || contact.guestPhone || '').replace(/[^\d]/g, '');
                    if (cp.length < 10) return;
                    _customerSyncedOrderIds.add(id);
                    _syncCustomerFromOrder({ ...o, customerPhone: cp, id });
                }).catch(() => {});
            }
            return;
        }
        _customerSyncedOrderIds.add(id);
        _syncCustomerFromOrder({ ...o, customerPhone: phone, id });
    });
}

async function _syncCustomerFromOrder(o) {
    const phone = o.customerPhone;
    const name = (o.customerName || '').trim();
    const total = Number(o.total || 0);
    const tableLabel = `QR Dine-In — Table ${o.table || ''}`.trim();
    const custRef = Outlet.ref(`customers/${phone}`);
    try {
        await runTransaction(custRef, (c) => {
            if (!c) {
                return { name, phone, orderCount: 1, totalSpent: total, lastSeen: Date.now(), lastAddress: tableLabel };
            }
            return {
                ...c,
                name: name || c.name,
                address: c.address || 'Walk-in',
                mapsLink: c.mapsLink || '',
                promotionalConsent: c.promotionalConsent !== undefined ? c.promotionalConsent : true,
                orderCount: (c.orderCount || 0) + 1,
                totalSpent: (c.totalSpent || 0) + total,
                lastSeen: Date.now(),
                lastAddress: tableLabel
            };
        });
    } catch (e) {
        console.warn('[Tables] Customer sync failed for order', o.id, e?.message || e);
    }
}

function _sessionElapsedMinutes(sess) {
    if (!sess?.openedAt) return 0;
    return Math.floor((Date.now() - sess.openedAt) / 60000);
}

const REQUEST_TYPE_META = {
    waiter: { label: 'Call Waiter', icon: 'bell' },
    water: { label: 'Request Water', icon: 'glass-water' },
    bill: { label: 'Request Bill', icon: 'receipt' },
    clean: { label: 'Clean Table', icon: 'sparkles' }
};

function _pendingRequests() {
    return Object.entries(_tableRequests)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => r.status !== 'resolved')
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function _requestChip(r) {
    const meta = REQUEST_TYPE_META[r.type] || { label: r.type || 'Request', icon: 'bell' };
    const mins = Math.max(0, Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000));
    return `
    <div class="table-request-chip" data-id="${escapeHtml(r.id)}">
        <i data-lucide="${meta.icon}" class="icon-14"></i>
        <span class="table-request-text"><strong>Table ${escapeHtml(r.tableNumber || '')}</strong> · ${escapeHtml(meta.label)} · ${mins} min ago</span>
        <button class="btn-text btn-small" data-action="resolveTableRequest" data-id="${escapeHtml(r.id)}">Resolve</button>
    </div>`;
}

async function _renderRequestsBanner() {
    const banner = document.getElementById('tableRequestsBanner');
    const pending = _pendingRequests();

    if (banner) {
        if (pending.length === 0) {
            banner.classList.add('hidden');
            banner.innerHTML = '';
        } else {
            banner.classList.remove('hidden');
            banner.innerHTML = pending.map(_requestChip).join('');
            await loadLucide();
            if (window.lucide) window.lucide.createIcons({ root: banner });
        }
    }

    const kpiEl = document.getElementById('tblKpiRequests');
    if (kpiEl) kpiEl.textContent = String(pending.length);
    const kpiCard = document.getElementById('tblKpiRequestsCard');
    if (kpiCard) kpiCard.classList.toggle('table-kpi-card-alert', pending.length > 0);

    const sidebarBadge = document.getElementById('badge-tables');
    if (sidebarBadge) {
        sidebarBadge.textContent = String(pending.length);
        sidebarBadge.classList.toggle('hidden', pending.length === 0);
    }
}

async function _resolveTableRequest(reqId) {
    try {
        await update(_reqRef(reqId), { status: 'resolved', resolvedAt: Date.now() });
        showToast('Request resolved', 'success');
        haptic(15);
    } catch (e) {
        showToast('Could not resolve request: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// RENDER: KPI cards
// ---------------------------------------------------------------------
function _renderKpis() {
    const tables = Object.values(_tables);
    const counts = { free: 0, occupied: 0, billing: 0, disabled: 0 };
    tables.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

    const activeSessions = Object.entries(_sessions).filter(([id, s]) => {
        if (s.status === 'closed' || s.status === 'expired') return false;
        const linkedTable = Object.values(_tables).find(t => t.currentSession === id);
        return !!linkedTable;
    });
    const totalGuests = activeSessions.reduce((s, [id, sess]) => s + (sess.guestCount || 0), 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const revenueToday = Object.entries(_sessions).reduce((sum, [id, sess]) => {
        const linkedTable = Object.values(_tables).find(t => t.currentSession === id);
        const activeToday = linkedTable && sess.openedAt && sess.openedAt >= todayMs && sess.status !== 'closed';
        const paidToday = sess.paidAt && sess.paidAt >= todayMs;
        if (activeToday || paidToday) {
            return sum + (_effectiveTotal(sess) || sess.grandTotal || 0);
        }
        return sum;
    }, 0);

    const avgMins = activeSessions.length
        ? Math.round(activeSessions.reduce((s, [id, sess]) => s + _sessionElapsedMinutes(sess), 0) / activeSessions.length)
        : 0;

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    setText('tblKpiFree', counts.free);
    setText('tblKpiOccupied', counts.occupied);
    setText('tblKpiBilling', counts.billing);
    setText('tblKpiSessions', activeSessions.length);
    setText('tblKpiGuests', totalGuests);
    setText('tblKpiRevenue', '₹' + revenueToday.toLocaleString('en-IN'));
    setText('tblKpiAvgTime', avgMins + ' min');
}

// ---------------------------------------------------------------------
// RENDER: Floor grid
// ---------------------------------------------------------------------
function _tableCard(t) {
    const meta = _statusMeta(t.status);
    const sess = _sessionForTable(t.id);
    let metaLine = '';
    if (sess && t.status !== 'free' && sess.status !== 'closed') {
        if (sess.status === 'expired') {
            metaLine = `<div class="table-card-expired-badge">⏰ Expired</div>`;
        } else {
            const orderCount = (sess.orders || []).length;
            const mins = _sessionElapsedMinutes(sess);
            metaLine = `<div class="table-card-bill">₹${_effectiveTotal(sess).toLocaleString('en-IN')}</div>
                     <div class="table-card-meta-row">${orderCount} Order${orderCount !== 1 ? 's' : ''} · ${mins} min</div>`;
        }
    }
    const disabledAttr = t.status === 'disabled' ? 'disabled' : '';
    const disabledSuffix = t.status === 'disabled' ? ' (Disabled)' : '';
    return `
    <button type="button" class="table-grid-card ${meta.cls}" data-action="openTableDrawer" data-id="${escapeHtml(t.id)}" ${disabledAttr} title="Table ${escapeHtml(t.number)} — ${meta.label}${disabledSuffix}">
        <div class="table-card-top">
            <span class="table-card-number">${escapeHtml(t.number)}</span>
        </div>
        <div class="table-card-seats">${t.capacity || 0} Seats</div>
        <span class="table-card-status-pill"><i data-lucide="${meta.icon}" class="icon-12"></i> ${meta.label}</span>
        ${metaLine}
    </button>`;
}

async function _renderFloorGrid() {
    const grid = document.getElementById('tableManagementGrid');
    if (!grid) return;
    const tables = Object.values(_tables).sort((a, b) => Number(a.number) - Number(b.number));

    if (tables.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i data-lucide="layout-grid" class="icon-32 text-muted"></i><p>No tables yet. Click "Add Table" to create your first one.</p></div>`;
    } else {
        grid.innerHTML = tables.map(_tableCard).join('');
    }
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: grid });
}

// ---------------------------------------------------------------------
// RENDER: Live Orders (Dine-In) panel
// ---------------------------------------------------------------------
function _statusPillClass(status) {
    const map = { Placed: 'badge-pending', Confirmed: 'badge-pending', Preparing: 'badge-pending', Ready: 'badge-ready', Served: 'badge-ready', Delivered: 'badge-delivery' };
    return map[status] || 'badge-pending';
}

function _orderListRow(o) {
    const t = _tables[o.tableId];
    const tNum = t ? escapeHtml(t.number) : (o.table || '--');
    const itemsLine = Object.values(o.items || {}).slice(0, 2).map(it => `${it.qty || 1} × ${escapeHtml(it.name || 'Item')}`).join(', ');
    const isNew = (Date.now() - _ms(o.createdAt)) < 120000;
    return `
    <div class="live-order-row" data-action="openTableDrawerByOrder" data-order-id="${escapeHtml(o.id)}">
        <div class="live-order-row-main">
            <span class="live-order-table-chip">Table ${tNum}</span>
            <span class="live-order-id">#${escapeHtml(String(o.id).slice(-6).toUpperCase())}</span>
            <span class="live-order-time">${new Date(o.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="live-order-row-items">${itemsLine || 'No items'}</div>
        <span class="badge ${_statusPillClass(o.status)}">${isNew ? 'NEW' : escapeHtml(o.status || 'Placed')}</span>
    </div>`;
}

async function _renderLiveOrdersList() {
    const list = document.getElementById('tableLiveOrdersList');
    const countEl = document.getElementById('tableLiveOrdersCount');
    if (!list) return;
    const orders = _dineInOrders();
    if (countEl) countEl.textContent = String(orders.length);
    list.innerHTML = orders.length
        ? orders.map(_orderListRow).join('')
        : `<p class="text-muted-small">No active dine-in orders right now.</p>`;
    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: list });
}

// ---------------------------------------------------------------------
// RENDER: Kitchen Display System (KDS)
// ---------------------------------------------------------------------
function _elapsedLabel(createdAt) {
    const diff = Math.max(0, Date.now() - _ms(createdAt));
    return `${Math.floor(diff / 60000)}:${_pad2(Math.floor((diff % 60000) / 1000))}`;
}

function _kdsCard(o) {
    const t = _tables[o.tableId];
    const tNum = t ? escapeHtml(t.number) : (o.table || '--');
    const itemsLines = Object.values(o.items || {}).map(it => `<div class="kds-item-line">${it.qty || 1} × ${escapeHtml(it.name || 'Item')}</div>`).join('');
    const mins = Math.floor((Date.now() - _ms(o.createdAt)) / 60000);
    const urgentCls = mins >= 15 ? 'kds-card-urgent' : (mins >= 8 ? 'kds-card-warn' : '');
    const st = o.status || 'Placed';
    // Look up group label from session data
    let groupLabel = '';
    if (o.orderGroupId && o.sessionId && _sessions[o.sessionId]?.orderGroups?.[o.orderGroupId]) {
        groupLabel = _sessions[o.sessionId].orderGroups[o.orderGroupId].label || '';
    }
    let actionBtn = '';
    if (st === 'Placed') {
        actionBtn = `<button class="kds-btn kds-btn-accept" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Confirmed">Accept</button>`;
    } else if (st === 'Confirmed' || st === 'Preparing') {
        actionBtn = `<button class="kds-btn kds-btn-ready" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Ready">Mark Ready</button>`;
    } else if (st === 'Ready') {
        actionBtn = `<button class="kds-btn kds-btn-serve" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Served">Serve</button>`;
    }
    return `
    <div class="kds-card ${urgentCls}" data-order-id="${escapeHtml(o.id)}">
        <div class="kds-card-top">
            <span class="kds-card-table">Table ${tNum}${groupLabel ? ` <span class="kds-card-group">· ${escapeHtml(groupLabel)}</span>` : ''}</span>
            <span class="kds-card-id">#${escapeHtml(String(o.id).slice(-6).toUpperCase())}</span>
        </div>
        <div class="kds-card-items">${itemsLines}</div>
        <div class="kds-card-actions">${actionBtn}</div>
        <div class="kds-card-footer">
            <span class="kds-elapsed" data-created-at="${_ms(o.createdAt)}">${_elapsedLabel(o.createdAt)}</span>
            <span class="kds-time-label">${new Date(o.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    </div>`;
}

function _renderKDS() {
    const newCol = document.getElementById('kdsColumnNew');
    const prepCol = document.getElementById('kdsColumnPreparing');
    const readyCol = document.getElementById('kdsColumnReady');
    if (!newCol || !prepCol || !readyCol) return;

    const groups = { New: [], Confirmed: [], Ready: [] };
    _dineInOrders().forEach(o => {
        const st = o.status || 'Placed';
        if (st === 'Placed') groups.New.push(o);
        else if (st === 'Confirmed' || st === 'Preparing') groups.Confirmed.push(o);
        else if (st === 'Ready') groups.Ready.push(o);
    });
    const fill = (col, list, emptyMsg) => { col.innerHTML = list.length ? list.map(_kdsCard).join('') : `<p class="text-muted-small kds-empty">${emptyMsg}</p>`; };
    fill(newCol, groups.New, 'No new orders');
    fill(prepCol, groups.Confirmed, 'Nothing preparing');
    fill(readyCol, groups.Ready, 'Nothing ready');

    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = String(n); };
    setCount('kdsCountNew', groups.New.length);
    setCount('kdsCountPreparing', groups.Confirmed.length);
    setCount('kdsCountReady', groups.Ready.length);
}

async function _policeExpiredSessions() {
    const now = Date.now();
    for (const [id, s] of Object.entries(_sessions)) {
        if (s.status === 'active' && s.expiresAt && now > s.expiresAt) {
            // Re-read session from Firebase to beat the heartbeat race:
            // customer's touchSession() may have extended expiresAt after our
            // cached copy was written.
            let fresh;
            try {
                const snap = await get(_sessRef(id));
                fresh = snap.val();
                if (!fresh || fresh.status !== 'active') continue;
                if (fresh.expiresAt && now <= fresh.expiresAt) continue;
            } catch (e) {
                console.warn('[Police] Read failed for', id, e?.message || e);
                continue;
            }
            // Collect all order IDs from the FRESH read, not the stale cache —
            // orders attached between cache update and police run must be cancelled too
            const orderIds = new Set([...(fresh.orders || [])]);
            const paidOrderIds = new Set();
            if (fresh.orderGroups) {
                Object.values(fresh.orderGroups).forEach(g => {
                    (g.orders || []).forEach(oid => orderIds.add(oid));
                    if (g.status === 'paid') (g.orders || []).forEach(oid => paidOrderIds.add(oid));
                });
            }
            // Cancel all pending orders so kitchen doesn't prepare phantom orders
            orderIds.forEach(oid => {
                if (paidOrderIds.has(oid)) return;
                update(_ordersRef(oid), { status: 'Cancelled', cancelledReason: 'Session expired', updatedAt: now }).catch(() => {});
            });
            // Mark session as expired with empty orders arrays
            const sessUpdate = { status: 'expired', expiredAt: now, orders: [] };
            if (fresh.orderGroups) {
                Object.keys(fresh.orderGroups).forEach(gid => { sessUpdate[`orderGroups/${gid}/orders`] = []; });
            }
            update(_sessRef(id), sessUpdate).catch(() => {});
            // Free the table pointer so new scans can create fresh sessions
            const linkedTable = Object.values(_tables).find(t => t.currentSession === id);
            if (linkedTable) {
                update(_tblRef(linkedTable.id), { status: 'free', currentSession: null, updatedAt: now }).catch(() => {});
            }
        }
    }
}

function _tickKDS() {
    document.querySelectorAll('.kds-elapsed').forEach(el => {
        const created = Number(el.getAttribute('data-created-at')) || Date.now();
        el.textContent = _elapsedLabel(created);
        const mins = Math.floor((Date.now() - created) / 60000);
        const card = el.closest('.kds-card');
        if (card) {
            card.classList.toggle('kds-card-warn', mins >= 8 && mins < 15);
            card.classList.toggle('kds-card-urgent', mins >= 15);
        }
    });
    if (_drawerTableId) _renderDrawerSessionMeta();
}

// ---------------------------------------------------------------------
// RENDER: Table Drawer (right-side slide-over panel)
// ---------------------------------------------------------------------
function _renderDrawerSessionMeta() {
    const t = _tables[_drawerTableId];
    const sess = t ? _sessionForTable(t.id) : null;
    const runEl = document.getElementById('tableDrawerRunningTime');
    if (runEl && sess) runEl.textContent = _sessionElapsedMinutes(sess) + ' min';
}

function _orderActionButtons(o) {
    if (!o) return '';
    const id = escapeHtml(o.id);
    if (o.status === 'Placed' || !o.status) {
        return `<button class="btn-action-blue btn-small" data-action="advanceTableOrder" data-id="${id}" data-next="Confirmed">
                    <i data-lucide="check" class="icon-12"></i> Accept Order
                </button>
                <button class="btn-text text-danger btn-small" data-action="advanceTableOrder" data-id="${id}" data-next="Cancelled">Cancel</button>`;
    }
    if (o.status === 'Confirmed' || o.status === 'Preparing') {
        return `<button class="btn-action-orange btn-small" data-action="advanceTableOrder" data-id="${id}" data-next="Ready">
                    <i data-lucide="chef-hat" class="icon-12"></i> Mark Ready
                </button>
                <button class="btn-text text-danger btn-small" data-action="advanceTableOrder" data-id="${id}" data-next="Cancelled">Cancel</button>`;
    }
    if (o.status === 'Ready') {
        return `<button class="btn-action-green btn-small" data-action="advanceTableOrder" data-id="${id}" data-next="Served">
                    <i data-lucide="check-check" class="icon-12"></i> Mark Served
                </button>`;
    }
    return '';
}

function _orderCardInDrawer(o, borderColor) {
    if (!o) return '';
    const items = Object.values(o.items || {});
    const itemLines = items.map(it => `<div class="order-details-item-row"><span>${it.qty || 1} × ${escapeHtml(it.name || 'Item')}</span><span>₹${Number((it.price || 0) * (it.qty || 1)).toFixed(0)}</span></div>`).join('');
    const bdrStyle = borderColor ? `border-left:4px solid ${borderColor};` : '';
    return `
    <div class="drawer-order-block" style="${bdrStyle}">
        <div class="drawer-order-block-head">
            <span>#${escapeHtml(String(o.id).slice(-6).toUpperCase())}</span>
            <span class="badge ${_statusPillClass(o.status)}">${escapeHtml(o.status || 'Placed')}</span>
        </div>
        ${itemLines}
        <div class="drawer-order-actions">${_orderActionButtons(o)}</div>
        <button class="btn-text btn-small drawer-order-jump" data-action="jumpToOrderInOrdersTab" data-id="${escapeHtml(o.id)}">
            <i data-lucide="external-link" class="icon-12"></i> Open in Orders tab
        </button>
    </div>`;
}

async function _renderTableDrawer() {
    const drawer = document.getElementById('tableDrawer');
    const overlay = document.getElementById('tableDrawerOverlay');
    if (!drawer) return;

    if (!_drawerTableId || !_tables[_drawerTableId]) {
        drawer.classList.remove('active');
        overlay?.classList.remove('active');
        return;
    }

    const t = _tables[_drawerTableId];
    const meta = _statusMeta(t.status);
    const sess = _sessionForTable(t.id);

    drawer.classList.add('active');
    overlay?.classList.add('active');

    document.getElementById('tableDrawerTitle').textContent = `Table ${t.number}`;
    const statusBadge = document.getElementById('tableDrawerStatusBadge');
    statusBadge.textContent = meta.label;
    statusBadge.className = `table-drawer-status-badge ${meta.cls}`;
    document.getElementById('tableDrawerSessionState').textContent = sess ? (sess.status === 'billing' ? 'Billing requested' : sess.status === 'expired' ? 'Session expired' : 'Session active') : 'No active session';

    document.getElementById('tableDrawerCapacity').textContent = t.capacity || '—';
    document.getElementById('tableDrawerSessionStarted').textContent = sess?.openedAt
        ? new Date(sess.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '—';
    document.getElementById('tableDrawerRunningTime').textContent = sess ? _sessionElapsedMinutes(sess) + ' min' : '—';

    const ordersWrap = document.getElementById('tableDrawerOrders');
    const totalWrap = document.getElementById('tableDrawerTotalCard');
    const actionsWrap = document.getElementById('tableDrawerActions');

    if (!sess) {
        ordersWrap.innerHTML = `<p class="text-muted-small">No active session for this table.</p>`;
        totalWrap.innerHTML = '';
        actionsWrap.innerHTML = `
            <button class="btn-secondary btn-small" data-action="openTableQr" data-id="${escapeHtml(t.id)}"><i data-lucide="qr-code" class="icon-14"></i> View / Print QR</button>
            <button class="btn-secondary btn-small" data-action="editTable" data-id="${escapeHtml(t.id)}"><i data-lucide="pencil" class="icon-14"></i> Edit Table</button>
            ${t.status === 'disabled'
                ? `<button class="btn-action-green btn-small" data-action="enableTable" data-id="${escapeHtml(t.id)}"><i data-lucide="check" class="icon-14"></i> Enable Table</button>`
                : `<button class="btn-text text-danger btn-small" data-action="disableTable" data-id="${escapeHtml(t.id)}"><i data-lucide="ban" class="icon-14"></i> Disable Table</button>`}
            <button class="btn-text text-danger btn-small" data-action="deleteTable" data-id="${escapeHtml(t.id)}"><i data-lucide="trash-2" class="icon-14"></i> Delete Table</button>`;
        await loadLucide();
        if (window.lucide) window.lucide.createIcons({ root: drawer });
        return;
    }

    const sessionId = sess.sessionId || t.currentSession;
    const groups = _orderGroupsForSession(sessionId);
    const ordersAll = _ordersForSession(sessionId);

    // Group-wise order display with colored headers and borders
    const groupColors = ['#2d7d46', '#2b6c9e', '#7d5a2b', '#6d3d7d'];
    const groupBorders = ['rgba(45,125,70,.25)', 'rgba(43,108,158,.25)', 'rgba(125,90,43,.25)', 'rgba(109,61,125,.25)'];
    let groupSections = groups.map((g, i) => {
        const gOrders = _ordersForGroup(sessionId, g.id);
        if (!gOrders.length) return '';
        const bg = groupColors[i % groupColors.length];
        const bdr = groupBorders[i % groupBorders.length];
        return `<div class="order-group-section" style="border:2px solid ${bg};border-radius:8px;padding:8px;margin-bottom:12px;">
            <div class="order-group-header" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:4px;margin-bottom:8px;background:${bg};color:#fff;">
                <span style="font-weight:600;font-size:.85rem;">${escapeHtml(g.label)}</span>
                <span style="opacity:.8;font-size:.75rem;">${gOrders.length} order${gOrders.length !== 1 ? 's' : ''} · ${g.status || 'active'}</span>
            </div>
            ${gOrders.map(o => _orderCardInDrawer(o, bdr)).join('')}
        </div>`;
    }).join('');
    const groupedOids = new Set(groups.flatMap(g => (sess.orderGroups?.[g.id]?.orders) || []));
    const ungrouped = ordersAll.filter(o => !groupedOids.has(o.id));
    if (ungrouped.length) {
        groupSections += `<div class="order-group-section" style="border:2px solid #4a4a4a;border-radius:8px;padding:8px;margin-bottom:12px;">
            <div class="order-group-header" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-radius:4px;margin-bottom:8px;background:#4a4a4a;color:#fff;">
                <span style="font-weight:600;font-size:.85rem;">Other Orders</span>
                <span style="opacity:.8;font-size:.75rem;">${ungrouped.length}</span>
            </div>
            ${ungrouped.map(_orderCardInDrawer).join('')}
        </div>`;
    }
    ordersWrap.innerHTML = `<h5 class="text-muted-small mb-8" style="margin:0;">Orders (${ordersAll.length})</h5>
        ${groupSections || '<p class="text-muted-small">No orders yet.</p>'}`;

    // Compute total from all non-cancelled orders
    const runningTotal = _effectiveTotal(sess);
    totalWrap.innerHTML = `
        <div class="table-drawer-total-card">
            <div><span class="table-drawer-total-label">Current Total</span><div class="text-muted-small">${ordersAll.length} Order${ordersAll.length !== 1 ? 's' : ''} · Pending Payment</div></div>
            <span class="table-drawer-total-amount">₹${Number(runningTotal).toLocaleString('en-IN')}</span>
        </div>`;

    const btns = [];
    const activeOrders = ordersAll.filter(o => o.status !== 'Cancelled');
    const allServed = activeOrders.length > 0 && activeOrders.every(o => o.status === 'Served' || o.status === 'Delivered');
    const allGroupsPaid = groups.length > 0 && groups.every(g => g.status === 'paid');

    if (sess.status === 'expired') {
        btns.push(`<button class="btn-action-green btn-small" data-action="closeExpiredSession" data-id="${escapeHtml(t.id)}"><i data-lucide="check-check" class="icon-14"></i> Close & Free Table</button>`);
    } else if (groups.length > 1) {
        // Multi-bill mode: per-group actions
        groups.forEach(g => {
            if (g.status === 'active') {
                btns.push(`<button class="btn-action-orange btn-small" data-action="requestBillForGroup" data-id="${escapeHtml(t.id)}" data-group-id="${escapeHtml(g.id)}"><i data-lucide="receipt" class="icon-14"></i> Bill ${escapeHtml(g.label)}</button>`);
            } else if (g.status === 'billing') {
                btns.push(`<button class="btn-action-green btn-small" data-action="makePaymentForGroup" data-id="${escapeHtml(t.id)}" data-group-id="${escapeHtml(g.id)}"><i data-lucide="wallet" class="icon-14"></i> Mark ${escapeHtml(g.label)} Paid</button>`);
            }
        });
        if (allGroupsPaid) {
            btns.push(`<button class="btn-action-green btn-small" data-action="closeSessionForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="check-check" class="icon-14"></i> Close Table (All Paid)</button>`);
        }
    } else if (sess.status !== 'billing') {
        btns.push(`<button class="btn-action-orange btn-small" data-action="requestBillForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="receipt" class="icon-14"></i> Generate Bill</button>`);
        if (allServed) {
            btns.push(`<button class="btn-action-green btn-small" data-action="makePaymentForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="wallet" class="icon-14"></i> Make Payment</button>`);
        }
    } else {
        btns.push(`<button class="btn-action-green btn-small" data-action="closeSessionForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="check-check" class="icon-14"></i> Close Table (Paid)</button>`);
    }
    btns.push(`<button class="btn-secondary btn-small" data-action="printTableKOT" data-id="${escapeHtml(t.id)}"><i data-lucide="printer" class="icon-14"></i> Print KOT</button>`);
    if (groups.length > 1) {
        groups.forEach(g => {
            btns.push(`<button class="btn-secondary btn-small" data-action="printBillForGroup" data-id="${escapeHtml(t.id)}" data-group-id="${escapeHtml(g.id)}"><i data-lucide="receipt-text" class="icon-14"></i> Print ${escapeHtml(g.label)}</button>`);
        });
        btns.push(`<button class="btn-secondary btn-small" data-action="printSessionBill" data-id="${escapeHtml(t.id)}"><i data-lucide="printer" class="icon-14"></i> Print All Bills</button>`);
    } else {
        btns.push(`<button class="btn-secondary btn-small" data-action="printSessionBill" data-id="${escapeHtml(t.id)}"><i data-lucide="receipt-text" class="icon-14"></i> Print Bill</button>`);
    }
    btns.push(`<button class="btn-secondary btn-small" data-action="openTableQr" data-id="${escapeHtml(t.id)}"><i data-lucide="qr-code" class="icon-14"></i> View QR</button>`);
    btns.push(`<button class="btn-text text-danger btn-small" data-action="cancelSessionForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="x-circle" class="icon-14"></i> Cancel / Free Table</button>`);
    actionsWrap.innerHTML = btns.join('');

    await loadLucide();
    if (window.lucide) window.lucide.createIcons({ root: drawer });
}

function _renderAll() {
    _renderKpis();
    _renderFloorGrid();
    _renderLiveOrdersList();
    _renderKDS();
    _renderTableDrawer();
    _renderRequestsBanner();
}

// ---------------------------------------------------------------------
// ACTIONS — Table CRUD
// ---------------------------------------------------------------------
let _editingTableId = null;

function _openTableEditor(id) {
    _editingTableId = id || null;
    const t = id ? _tables[id] : null;
    document.getElementById('tableEditorTitle').textContent = t ? 'Edit Table' : 'Add Table';
    const el = (eid, val) => { const e = document.getElementById(eid); if (e != null) e.value = val ?? ''; };
    el('tblNumber', t?.number ?? _pad2(Object.keys(_tables).length + 1));
    el('tblCapacity', t?.capacity ?? 4);
    document.getElementById('tableEditorModal')?.classList.add('active');
}
function _closeTableEditor() {
    document.getElementById('tableEditorModal')?.classList.remove('active');
    _editingTableId = null;
}

async function _saveTable() {
    const number = String(document.getElementById('tblNumber')?.value || '').trim();
    const capacity = Number(document.getElementById('tblCapacity')?.value) || 2;
    if (!number) { showToast('Please enter a table number', 'warning'); return; }

    const duplicate = Object.entries(_tables).find(([id, t]) => t.number === number && id !== _editingTableId);
    if (duplicate) { showToast(`Table ${number} already exists`, 'warning'); return; }

    try {
        if (_editingTableId) {
            await update(_tblRef(_editingTableId), { number, capacity, updatedAt: Date.now() });
            showToast('Table updated', 'success');
        } else {
            const newRef = push(_tblRef());
            const token = _secureToken();
            await set(newRef, {
                id: newRef.key, number, capacity, status: 'free', active: true,
                token, currentSession: null, createdAt: Date.now(), updatedAt: Date.now()
            });
            showToast(`Table ${number} created`, 'success');
        }
        haptic(20);
        _closeTableEditor();
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
    }
}

async function _deleteTable(id) {
    const t = _tables[id];
    if (!t) return;
    if (t.currentSession) { showToast('Cannot delete a table with an active session', 'warning'); return; }
    const ok = await showDeleteConfirm(`Table ${t.number}`, 'This will permanently remove the table and invalidate its QR code.');
    if (!ok) return;
    try {
        await remove(_tblRef(id));
        if (_drawerTableId === id) { _drawerTableId = null; _renderTableDrawer(); }
        showToast('Table deleted', 'success');
    } catch (e) {
        showToast('Delete failed', 'error');
    }
}

async function _setTableEnabled(id, enabled) {
    try {
        await update(_tblRef(id), { status: enabled ? 'free' : 'disabled', active: enabled, updatedAt: Date.now() });
        showToast(enabled ? 'Table enabled' : 'Table disabled', 'success');
    } catch (e) {
        showToast('Update failed', 'error');
    }
}

function _openTableDrawer(id) {
    if (_drawerTableId === id && document.getElementById('tableDrawer')?.classList.contains('active')) return;
    _drawerTableId = id;
    _renderTableDrawer();
    haptic(10);
}
function _closeTableDrawer() {
    _drawerTableId = null;
    _renderTableDrawer();
}
function _openTableDrawerByOrder(orderId) {
    const o = _orders[orderId];
    if (o?.tableId) _openTableDrawer(o.tableId);
}

// ---------------------------------------------------------------------
// ACTIONS — Session lifecycle (Decision #4: session-based billing)
// ---------------------------------------------------------------------
async function _requestBillForTable(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;

    const orders = _ordersForSession(sess.sessionId || t.currentSession);
    const activeOrders = orders.filter(o => o.status !== 'Cancelled');
    const allServed = activeOrders.length > 0 && activeOrders.every(o => o.status === 'Served' || o.status === 'Delivered');
    if (!allServed) {
        showToast('All orders must be served before generating bill', 'warning');
        return;
    }

    try {
        await update(_sessRef(sess.sessionId), { status: 'billing' });
        await update(_tblRef(tableId), { status: 'billing', updatedAt: Date.now() });
        showToast('Bill generated — table marked for billing', 'success');
        haptic(20);
    } catch (e) {
        showToast('Failed to generate bill: ' + (e?.message || e), 'error');
    }
}

async function _closeSessionForTable(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;
    const groups = _orderGroupsForSession(sess.sessionId || t.currentSession);
    const nonEmptyGroups = groups.filter(g => (sess.orderGroups?.[g.id]?.orders || []).length > 0);
    // If all non-empty groups paid, close without payment picker
    if (nonEmptyGroups.length > 0 && nonEmptyGroups.every(g => g.status === 'paid')) {
        try {
            const now = Date.now();
            await update(_sessRef(sess.sessionId), { status: 'closed', closedAt: now });
            await update(_tblRef(tableId), { status: 'free', currentSession: null, updatedAt: now });
            if (_drawerTableId === tableId) _closeTableDrawer();
            showToast('Table closed — all groups paid', 'success');
            haptic(30);
        } catch (e) {
            showToast('Failed to close table: ' + (e?.message || e), 'error');
        }
        return;
    }
    return _makePaymentForTable(tableId);
}

async function _makePaymentForTable(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;

    // In multi-bill mode, reject if any non-empty group is unpaid (must bill per-group)
    const groups = _orderGroupsForSession(sess.sessionId || t.currentSession);
    const nonEmptyGroups = groups.filter(g => (sess.orderGroups?.[g.id]?.orders || []).length > 0);
    if (nonEmptyGroups.length > 1 && !nonEmptyGroups.every(g => g.status === 'paid')) {
        showToast('Each group must be paid individually before closing the session', 'warning');
        return;
    }

    const orders = _ordersForSession(sess.sessionId || t.currentSession);
    const activeOrders = orders.filter(o => o.status !== 'Cancelled');
    const allServed = activeOrders.length > 0 && activeOrders.every(o => o.status === 'Served' || o.status === 'Delivered');
    if (!allServed) {
        showToast('All orders must be served before payment', 'warning');
        return;
    }

    // Compute total from non-cancelled orders (session-level grandTotal may be inflated)
    const total = activeOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const method = await showPaymentPicker(total);
    if (!method) return;

    const sessRef = _sessRef(sess.sessionId);
    const tblRef = _tblRef(tableId);
    try {
        // Mark all orders as paid first
        for (const o of orders) {
            if (o.id && o.status !== 'Cancelled') {
                await update(_ordersRef(o.id), { paymentMethod: method, paymentStatus: 'Paid', updatedAt: Date.now() });
            }
        }
        // Close session and free table only after all orders are updated
        await update(sessRef, { status: 'closed', closedAt: Date.now(), paymentMethod: method, paidAt: Date.now() });
        await update(tblRef, { status: 'free', currentSession: null, updatedAt: Date.now() });
        await runTransaction(Outlet.ref(`tableAnalytics/${tableId}`), (cur) => {
            cur = cur || { totalOrders: 0, totalRevenue: 0, avgSessionTime: 0, occupancyRate: 0 };
            const orderCount = (sess.orders || []).length;
            const mins = _sessionElapsedMinutes(sess);
            cur.totalOrders = (cur.totalOrders || 0) + orderCount;
            cur.totalRevenue = (cur.totalRevenue || 0) + total;
            cur.avgSessionTime = cur.avgSessionTime ? Math.round((cur.avgSessionTime + mins) / 2) : mins;
            return cur;
        });
        if (_drawerTableId === tableId) _closeTableDrawer();
        showToast(`Table closed — ₹${total.toLocaleString('en-IN')} via ${method}`, 'success');
        haptic(30);
    } catch (e) {
        // Rollback: try to restore session + table state on failure
        try {
            await update(sessRef, { status: 'billing' });
            await update(tblRef, { status: 'billing', updatedAt: Date.now() });
        } catch (_) {}
        showToast('Payment failed: ' + (e?.message || e), 'error');
    }
}
async function _closeExpiredSession(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;
    const ok = await showConfirm(`Close expired session for Table ${t.number} and free the table?`, 'Close Expired Session');
    if (!ok) return;
    try {
        await update(_sessRef(sess.sessionId), { status: 'closed', closedAt: Date.now() });
        await update(_tblRef(tableId), { status: 'free', currentSession: null, updatedAt: Date.now() });
        if (_drawerTableId === tableId) _closeTableDrawer();
        showToast(`Expired session closed, Table ${t.number} freed`, 'success');
    } catch (e) {
        showToast('Failed: ' + (e?.message || e), 'error');
    }
}

async function _makePaymentForGroup(tableId, groupId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess || !groupId) return;
    const group = sess.orderGroups?.[groupId];
    if (!group || group.status !== 'billing') {
        showToast('Group must be in billing state first', 'warning');
        return;
    }
    const total = _ordersForGroup(sess.sessionId, groupId)
        .filter(o => o.status !== 'Cancelled')
        .reduce((sum, o) => sum + Number(o.total || 0), 0);
    const method = await showPaymentPicker(total);
    if (!method) return;
    try {
        const now = Date.now();
        // Mark group's orders as paid first, then update group status
        const gOrders = sess.orderGroups[groupId].orders || [];
        const results = await Promise.allSettled(gOrders.map(oid => {
            if (_orders[oid] && _orders[oid].status !== 'Cancelled') {
                return update(_ordersRef(oid), { paymentMethod: method, paymentStatus: 'Paid', updatedAt: now });
            }
            return Promise.resolve();
        }));
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            showToast(`${failures.length} order(s) failed to update — group not marked paid`, 'error');
            return;
        }
        await update(_sessRef(`${sess.sessionId}/orderGroups/${groupId}`), { status: 'paid', paidAt: now, paymentMethod: method });
        showToast(`${group.label} paid — ₹${total.toLocaleString('en-IN')} via ${method}`, 'success');
        haptic(30);
    } catch (e) {
        showToast('Failed: ' + (e?.message || e), 'error');
    }
}

async function _requestBillForGroup(tableId, groupId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess || !groupId) return;
    const group = sess.orderGroups?.[groupId];
    if (!group || group.status === 'billing' || group.status === 'paid') {
        showToast('Group is already billed or paid', 'warning');
        return;
    }
    const gOrders = _ordersForGroup(sess.sessionId, groupId);
    const activeGOrders = gOrders.filter(o => o.status !== 'Cancelled');
    const allServed = activeGOrders.length > 0 && activeGOrders.every(o => o.status === 'Served' || o.status === 'Delivered');
    if (!allServed) {
        showToast('All orders in this group must be served before billing', 'warning');
        return;
    }
    try {
        const now = Date.now();
        await update(_sessRef(`${sess.sessionId}/orderGroups/${groupId}`), { status: 'billing', updatedAt: now });
        // Update table status to indicate billing in progress
        await update(_tblRef(tableId), { status: 'billing', updatedAt: now });
        showToast(`Bill generated for group`, 'success');
        haptic(20);
    } catch (e) {
        showToast('Failed: ' + (e?.message || e), 'error');
    }
}

async function _cancelSessionForTable(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t) return;
    const ok = await showConfirm('Cancel this session and free the table? All pending orders will also be cancelled.', 'Cancel Session');
    if (!ok) return;
    try {
        if (sess) {
            // Re-read session from Firebase to beat cache races (same pattern as police)
            let fresh;
            try { const snap = await get(_sessRef(sess.sessionId)); fresh = snap.val(); } catch (_) {}
            const source = fresh || sess;
            // Collect order IDs from both session-level orders array and all order groups
            const orderIds = new Set([...(source.orders || [])]);
            const paidOrderIds = new Set();
            if (source.orderGroups) {
                Object.values(source.orderGroups).forEach(g => {
                    (g.orders || []).forEach(oid => orderIds.add(oid));
                    if (g.status === 'paid') (g.orders || []).forEach(oid => paidOrderIds.add(oid));
                });
            }
            const results = await Promise.allSettled(Array.from(orderIds).map(oid => {
                if (paidOrderIds.has(oid)) return Promise.resolve();
                const o = _orders[oid];
                if (o && o.status !== 'Cancelled') {
                    return update(_ordersRef(oid), { status: 'Cancelled', updatedAt: Date.now() });
                }
                return Promise.resolve();
            }));
            const failures = results.filter(r => r.status === 'rejected');
            if (failures.length > 0) {
                console.warn(`[cancelSession] ${failures.length} order cancellation(s) failed`, failures.map(f => f.reason));
            }
            // Session-level aggregates (runningTotal, grandTotal, etc.) intentionally
            // NOT adjusted here — they are write-only sinks in the current architecture.
            // Every display/billing path uses _effectiveTotal() which reads from
            // individual non-cancelled order records, so the stored aggregates are
            // never consumed. Keeping them inflated avoids race conditions from
            // non-atomic deduction writes.
            const sessUpdate = {
                status: 'closed', closedAt: Date.now(),
                orders: []
            };
            if (sess.orderGroups) {
                Object.keys(sess.orderGroups).forEach(gid => { sessUpdate[`orderGroups/${gid}/orders`] = []; });
            }
            await update(_sessRef(sess.sessionId), sessUpdate);
        }
        await update(_tblRef(tableId), { status: 'free', currentSession: null, updatedAt: Date.now() });
        if (_drawerTableId === tableId) _closeTableDrawer();
        showToast('Session cancelled, table freed', 'success');
    } catch (e) {
        showToast('Failed: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// ACTIONS — Order status advance (writes the SAME /orders node)
// ---------------------------------------------------------------------
async function _advanceOrder(orderId, nextStatus) {
    try {
        const valid = {
            'Placed': ['Confirmed', 'Cancelled'],
            'Confirmed': ['Ready', 'Cancelled'],
            'Preparing': ['Ready', 'Cancelled'],
            'Ready': ['Served', 'Delivered', 'Cancelled'],
            'Served': [], 'Delivered': [], 'Cancelled': []
        };
        let orderData, tableId;
        const result = await runTransaction(_ordersRef(orderId), (current) => {
            if (!current) return;
            const o = current; // ponytail: runTransaction gives raw value, not snapshot
            if (!o) return;
            if (!valid[o.status]?.includes(nextStatus)) {
                return; // abort — transaction won't commit
            }
            orderData = o;
            tableId = o.tableId;
            return { ...o, status: nextStatus, updatedAt: Date.now() };
        });
        if (!orderData) {
            const o = _orders[orderId];
            if (!o) showToast('Order not found', 'error');
            else showToast(`Cannot change status from ${o.status} to ${nextStatus}`, 'warning');
            return;
        }
        if (_orders[orderId]) {
            _orders[orderId] = { ..._orders[orderId], status: nextStatus, updatedAt: Date.now() };
        }
        _renderAll();

        if (nextStatus === 'Confirmed' && tableId) {
            setTimeout(() => _printTableKOT(tableId), 500);
        }

        showToast(`Order moved to ${nextStatus}`, 'success');
        haptic(20);
    } catch (e) {
        showToast('Update failed: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// Cross-tab navigation — opens a specific order on the existing Orders
// tab using its own search box. The current orders.js render does not
// surface a table number in row text, so searching by table would not
// reliably match; the order's own ID (which IS rendered and searchable)
// is used instead. This avoids touching orders.js's render logic.
// ---------------------------------------------------------------------
function _jumpToOrderInOrdersTab(orderId) {
    const shortId = String(orderId).slice(-6);
    // window.switchTab is the global entry point main.js wires to every
    // data-action="switchTab" button; calling it directly here follows
    // the same call path a sidebar click would make.
    if (typeof window.switchTab === 'function') {
        window.switchTab('orders');
    } else {
        document.querySelector('[data-action="switchTab"][data-tab="orders"]')?.click();
    }
    // Give switchTab's lazy module import a moment to resolve and render
    // before touching the search input it creates.
    setTimeout(() => {
        const input = document.getElementById('orderSearch');
        if (input) {
            input.value = shortId;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        }
    }, 350);
}

// ---------------------------------------------------------------------
// KOT printing — lightweight kitchen ticket (printing.js handles the
// customer-facing receipt; KOT is a separate, simpler print job)
// ---------------------------------------------------------------------
function _printTableKOT(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { showToast('No active session to print', 'warning'); return; }
    const orders = _ordersForSession(sess.sessionId || t.currentSession);
    const grouped = {};
    orders.forEach(o => Object.values(o.items || {}).forEach(it => {
        const name = it.name || 'Item';
        grouped[name] = (grouped[name] || 0) + (it.qty || 1);
    }));
    const itemRows = Object.entries(grouped).map(([name, qty]) =>
        `<div class="kot-item-row"><span>${qty} ×</span><span>${escapeHtml(name)}</span></div>`
    ).join('');
    const w = window.open('', '_blank', 'width=380,height=600');
    w.document.write(`<html><head><title>KOT — Table ${escapeHtml(t.number)}</title><style>
        body{font-family:'Courier New',monospace;padding:16px;width:280px;}
        h2{text-align:center;margin-bottom:2px;font-size:18px;}
        .sub{text-align:center;font-size:11px;color:#555;margin-bottom:14px;border-bottom:1px dashed #000;padding-bottom:10px;}
        .kot-item-row{display:flex;gap:8px;font-size:14px;padding:4px 0;border-bottom:1px dotted #ccc;}
        .kot-item-row span:first-child{font-weight:700;min-width:30px;}
        .foot{margin-top:14px;font-size:11px;text-align:center;color:#777;}
        </style></head><body>
        <h2>KOT — TABLE ${escapeHtml(t.number)}</h2>
        <div class="sub">${new Date().toLocaleString('en-IN')} · Session ${escapeHtml(sess.sessionId || '')}</div>
        ${itemRows || '<p>No items</p>'}
        <div class="foot">Kitchen Copy</div>
        <script>window.onload=function(){window.print();};</script></body></html>`);
    w.document.close();
}

async function _printBillForGroup(tableId, groupId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess || !groupId) { showToast('No session for this group', 'warning'); return; }
    const sessionId = sess.sessionId || t.currentSession;
    const groups = _orderGroupsForSession(sessionId);
    const g = groups.find(g => g.id === groupId);
    if (!g) { showToast('Group not found', 'warning'); return; }
    const dineSnap = await get(_settingsRef());
    const dine = dineSnap.val() || {};
    const taxEnabled = dine.taxEnabled !== false;
    const scEnabled = dine.serviceChargeEnabled === true;
    const taxRates = (dine.taxRates && Array.isArray(dine.taxRates) && dine.taxRates.length > 0) ? dine.taxRates : (taxEnabled ? [{ name: dine.taxName || 'Tax', rate: typeof dine.taxRate === 'number' ? dine.taxRate : 5 }] : []);
    const scRate = typeof dine.serviceChargeRate === 'number' ? dine.serviceChargeRate : 0;
    const groupOrders = (g.orders || []).map(oid => ({ id: oid, ...(_orders[oid] || {}) })).filter(o => o.id && o.status !== 'Cancelled');
    if (!groupOrders.length) { showToast('No orders in this group', 'warning'); return; }
    let subtotal = 0;
    const allItems = [];
    groupOrders.forEach(o => {
        Object.values(o.items || {}).forEach(it => {
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            allItems.push({ name: it.name || 'Item', qty, price, size: it.size || '', addon: it.addon || '' });
            subtotal += price * qty;
        });
    });
    const taxItems = taxRates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(subtotal * (r.rate / 100) * 100) / 100 }));
    const tax = taxItems.reduce((s, t) => s + t.amount, 0);
    const serviceCharge = scEnabled ? Math.round(subtotal * (scRate / 100) * 100) / 100 : 0;
    const groupDiscount = groupOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);
    const grandTotalAfterDiscount = subtotal + tax + serviceCharge - groupDiscount;
    await printOrderReceipt({
        orderId: `TABLE-${t.number}-${g.label.replace(/\s/g, '')}`,
        type: 'Dine-in', items: allItems,
        total: grandTotalAfterDiscount, subtotal, tax, taxItems,
        taxName: taxRates.map(r => r.name).join(' + ') || 'Tax',
        serviceCharge,
        serviceChargeName: dine.serviceChargeName || 'Service Charge',
        serviceChargeRate: scRate,
        discount: groupDiscount, deliveryFee: 0,
        tableNo: String(t.number),
        createdAt: sess.openedAt || Date.now(),
        paymentMethod: g.paymentMethod || 'Cash',
        status: 'Delivered',
        customerName: `Table ${t.number} · ${g.label}`
    }, true);
}

async function _printSessionBill(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { showToast('No active session to print', 'warning'); return; }

    const sessionId = sess.sessionId || t.currentSession;
    const groups = _orderGroupsForSession(sessionId);
    const dineSnap = await get(_settingsRef());
    const dine = dineSnap.val() || {};
    const taxEnabled = dine.taxEnabled !== false;
    const scEnabled = dine.serviceChargeEnabled === true;
    const taxRates = (dine.taxRates && Array.isArray(dine.taxRates) && dine.taxRates.length > 0) ? dine.taxRates : (taxEnabled ? [{ name: dine.taxName || 'Tax', rate: typeof dine.taxRate === 'number' ? dine.taxRate : 5 }] : []);
    const scRate = typeof dine.serviceChargeRate === 'number' ? dine.serviceChargeRate : 0;

    if (groups.length > 1) {
        const billableGroups = groups.filter(g => g.status === 'billing' || g.status === 'paid');
        if (!billableGroups.length) { showToast('No billed groups to print', 'warning'); return; }
        for (const g of billableGroups) {
            await _printBillForGroup(tableId, g.id);
        }
        return;
    }

    // Single-bill mode: existing behavior
    const orders = _ordersForSession(sessionId);
    if (!orders.length) { showToast('No orders to bill', 'warning'); return; }

    let subtotal = 0;
    const allItems = [];
    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
        Object.values(o.items || {}).forEach(it => {
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            allItems.push({ name: it.name || 'Item', qty, price, size: it.size || '', addon: it.addon || '' });
            subtotal += price * qty;
        });
    });

    const taxItems = taxRates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(subtotal * (r.rate / 100) * 100) / 100 }));
    const tax = Number(sess.tax ?? 0) || taxItems.reduce((s, t) => s + t.amount, 0);
    const serviceCharge = Number(sess.serviceCharge ?? 0) || (scEnabled ? Math.round(subtotal * (scRate / 100) * 100) / 100 : 0);
    const grandTotal = _effectiveTotal(sess);
    const sessionDiscount = orders.reduce((sum, o) => sum + Number(o.discount || 0), 0);

    const combinedOrder = {
        orderId: `TABLE-${t.number}`,
        type: 'Dine-in',
        items: allItems,
        total: grandTotal, subtotal, tax, taxItems,
        taxName: taxRates.map(r => r.name).join(' + ') || 'Tax',
        serviceCharge,
        serviceChargeName: dine.serviceChargeName || 'Service Charge',
        serviceChargeRate: scRate,
        discount: sessionDiscount, deliveryFee: 0,
        tableNo: String(t.number),
        createdAt: sess.openedAt || Date.now(),
        paymentMethod: sess.paymentMethod || 'Cash',
        status: 'Delivered',
        customerName: `Table ${t.number}`
    };

    await printOrderReceipt(combinedOrder, true);
}

// ---------------------------------------------------------------------
// QR generation — client-side only, no external API call
// ---------------------------------------------------------------------
let _dineInBaseUrlCache = null;
async function _dineInBaseUrl() {
    if (_dineInBaseUrlCache) return _dineInBaseUrlCache;
    try {
        const snap = await Promise.race([
            get(_settingsRef('qrBaseUrl')),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        _dineInBaseUrlCache = snap.exists() ? snap.val() : 'https://foodhubbie-qrmenu.web.app/';
    } catch {
        _dineInBaseUrlCache = 'https://foodhubbie-qrmenu.web.app/';
    }
    return _dineInBaseUrlCache;
}

let _storeBrandingCache = null;
async function _fetchStoreBranding() {
    if (_storeBrandingCache) return _storeBrandingCache;
    const snap = await get(Outlet.ref('settings/Store'));
    const s = snap.val() || {};
    _storeBrandingCache = {
        storeName: s.storeName || 'Our Restaurant',
        poweredBy: (s.poweredBy || '').trim()
    };
    return _storeBrandingCache;
}

function _qrCardMarkup({ storeName, poweredBy, tableNumber, qrSrc, compact }) {
    const qrSize = compact ? 150 : 220;
    // Defensive: some outlets have "Powered by X" already saved as the
    // poweredBy value itself, which used to render as "Powered by Powered by X".
    const poweredByClean = (poweredBy || '').replace(/^powered\s+by\s+/i, '').trim();
    const footer = poweredByClean
        ? `<div class="qr-divider"></div><div class="qr-footer">Powered by <b>${escapeHtml(poweredByClean)}</b></div>`
        : '';
    return `
    <div class="qr-frame${compact ? ' qr-frame-compact' : ''}">
        <div class="qr-card">
            <div class="qr-header">
                <div class="qr-store-name">🍕 ${escapeHtml(storeName)}</div>
                <div class="qr-tagline">DINE-IN MENU</div>
            </div>
            <div class="qr-body">
                <div class="qr-table-label">TABLE</div>
                <div class="qr-table-number">${escapeHtml(String(tableNumber))}</div>
                <div class="qr-scan-cta">📷 Scan &amp; Crave</div>
                <div class="qr-img-frame">${qrSrc ? `<img src="${qrSrc}" width="${qrSize}" height="${qrSize}">` : '<p style="font-size:11px;color:#c81d11;">QR failed</p>'}</div>
            </div>
            ${footer}
        </div>
    </div>`;
}

const QR_CARD_CSS = `
    .qr-frame{ display:inline-block; background:linear-gradient(135deg,#FFB347,#E84908 55%,#C81D11); border-radius:26px; padding:5px; box-shadow:0 10px 26px rgba(232,73,8,.25); }
    .qr-frame-compact{ border-radius:20px; padding:4px; box-shadow:none; break-inside:avoid; page-break-inside:avoid; }
    .qr-card{ background:#fff; border-radius:22px; overflow:hidden; width:300px; text-align:center; font-family:-apple-system,'Segoe UI',sans-serif; }
    .qr-frame-compact .qr-card{ border-radius:17px; width:230px; }
    .qr-header{ background:linear-gradient(135deg,#FF8A3D,#E84908); color:#fff; padding:16px 14px 14px; }
    .qr-frame-compact .qr-header{ padding:11px 10px 10px; }
    .qr-store-name{ font-size:17px; font-weight:900; letter-spacing:.01em; text-transform:uppercase; line-height:1.2; }
    .qr-frame-compact .qr-store-name{ font-size:13px; }
    .qr-tagline{ font-size:10px; opacity:.92; margin-top:3px; font-weight:700; letter-spacing:.1em; }
    .qr-body{ padding:20px 18px 16px; }
    .qr-frame-compact .qr-body{ padding:13px 12px 10px; }
    .qr-table-label{ font-size:11px; font-weight:800; color:#E84908; letter-spacing:.14em; }
    .qr-table-number{ font-size:40px; font-weight:900; color:#1a1a1a; line-height:1; margin:2px 0 12px; }
    .qr-frame-compact .qr-table-number{ font-size:28px; margin-bottom:8px; }
    .qr-scan-cta{ font-size:12px; font-weight:800; color:#C81D11; margin-bottom:12px; }
    .qr-frame-compact .qr-scan-cta{ font-size:10px; margin-bottom:8px; }
    .qr-img-frame{ display:inline-block; padding:10px; background:#fff7ed; border:3px solid #FFB347; border-radius:14px; }
    .qr-frame-compact .qr-img-frame{ padding:6px; border-radius:11px; border-width:2px; }
    .qr-img-frame img{ display:block; }
    .qr-divider{ border-top:2px dashed #f3cba8; margin:14px 18px 0; }
    .qr-frame-compact .qr-divider{ margin:10px 12px 0; }
    .qr-footer{ padding:10px 14px 16px; font-size:10px; color:#b97a4e; font-weight:600; }
    .qr-frame-compact .qr-footer{ padding:7px 10px 11px; font-size:8px; }
    .qr-footer b{ color:#E84908; }
`;

// Inject QR_CARD_CSS into the admin document itself, once. Without this,
// the branded card can only ever render inside the print popup (which
// builds its own <style> tag) — never in the on-screen preview modal.
let _qrCardCssInjected = false;
function _ensureQrCardCssInPage() {
    if (_qrCardCssInjected) return;
    const style = document.createElement('style');
    style.id = 'qrCardCssShared';
    style.textContent = QR_CARD_CSS;
    document.head.appendChild(style);
    _qrCardCssInjected = true;
}

async function _ensureQrLib() {
    if (window.QRCode) return true;
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

async function _qrDataUri(text, size = 220) {
    const ok = await _ensureQrLib();
    if (!ok || !window.QRCode) return null;
    try {
        const holder = document.createElement('div');
        new window.QRCode(holder, { text, width: size, height: size, colorDark: '#1a1a1a', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
        const img = holder.querySelector('img');
        const canvas = holder.querySelector('canvas');
        return img?.src || canvas?.toDataURL('image/png') || null;
    } catch (e) {
        console.error('[QRDataUri]', e);
        return null;
    }
}

// Secure URL shape — TOKEN ONLY, never a table number (Decision #5/#6)
async function _qrUrlForTable(t) {
    const base = await _dineInBaseUrl();
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}o=${encodeURIComponent(Outlet.current)}&b=${encodeURIComponent(BUSINESS_ID())}&t=${t.token}`;
}

async function _openQrModal(id) {
    if (_qrModalOpening) return;
    _ensureQrCardCssInPage();
    const modal = document.getElementById('tableQrModal');
    const preview = document.getElementById('tableQrCardPreview');
    const titleEl = document.getElementById('tableQrModalTitle');
    const urlEl = document.getElementById('tableQrModalUrl');
    try {
        _qrModalOpening = true;
        const t = _tables[id];
        if (!t) { modal?.classList.remove('active'); return; }

        titleEl.textContent = `Table ${t.number} QR Code`;
        if (preview) preview.innerHTML = `<p class="text-muted-small">Loading…</p>`;
        if (modal) modal.dataset.tableId = id;
        modal?.classList.remove('hidden');
        modal?.classList.add('active');

        const url = await _qrUrlForTable(t);
        urlEl.textContent = url;
        const dataUri = await _qrDataUri(url, 220);
        if (!dataUri) { showToast('QR generation failed — check connection', 'error'); return; }

        // Same markup + same data the print flow uses — this IS what will print.
        const { storeName, poweredBy } = await _fetchStoreBranding();
        if (preview) {
            preview.innerHTML = _qrCardMarkup({ storeName, poweredBy, tableNumber: t.number, qrSrc: dataUri, compact: false });
        }
    } catch (e) {
        showToast('Failed to load QR', 'error');
        modal?.classList.remove('active');
        modal?.classList.add('hidden');
    } finally {
        _qrModalOpening = false;
    }
}
function _closeQrModal() { document.getElementById('tableQrModal')?.classList.remove('active'); }

function _copyQrLink() {
    const url = document.getElementById('tableQrModalUrl')?.textContent;
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied', 'success')).catch(() => showToast('Could not copy link', 'error'));
}

async function _printSingleQr() {
    // Print exactly what's on screen right now — clone the live preview
    // node's HTML rather than re-fetching data and rebuilding the card
    // independently. This is what actually guarantees print === preview:
    // if the on-screen card is ever wrong (stale name, missing branding),
    // print will be wrong the same way, which is honest and debuggable,
    // instead of two code paths silently drifting apart.
    const preview = document.getElementById('tableQrCardPreview');
    const cardHtml = preview?.querySelector('.qr-frame')?.outerHTML;
    if (!cardHtml) { showToast('Nothing to print yet — wait for the QR to load', 'warning'); return; }

    const titleText = document.getElementById('tableQrModalTitle')?.textContent || 'Table QR';
    const { storeName } = await _fetchStoreBranding();

    const w = window.open('', '_blank', 'width=420,height=620');
    if (!w) { showToast('Popup blocked — allow popups for print', 'error'); return; }
    w.document.write(`<html><head><title>${escapeHtml(titleText)} — ${escapeHtml(storeName)}</title><style>
        *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fef3e8;padding:24px;}
        ${QR_CARD_CSS}
        </style></head><body>
        ${cardHtml}
        <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`);
    w.document.close();
}

async function _bulkQrPrint() {
    const tables = Object.values(_tables).filter(t => t.status !== 'disabled').sort((a, b) => Number(a.number) - Number(b.number));
    if (tables.length === 0) { showToast('No tables to print', 'warning'); return; }
    const ok = await showConfirm(`Generate printable QR cards for all ${tables.length} tables?`, 'Bulk QR Print');
    if (!ok) return;

    showToast('Generating QR codes…', 'info');
    const { storeName, poweredBy } = await _fetchStoreBranding();
    const cards = [];
    for (const t of tables) {
        const url = await _qrUrlForTable(t);
        const dataUri = await _qrDataUri(url, 150);
        cards.push({ t, dataUri });
    }
    const w = window.open('', '_blank');
    const cardsHtml = cards.map(({ t, dataUri }) =>
        _qrCardMarkup({ storeName, poweredBy, tableNumber: t.number, qrSrc: dataUri, compact: true })
    ).join('');
    w.document.write(`<html><head><title>Bulk QR Print — ${escapeHtml(storeName)}</title><style>
        *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{font-family:-apple-system,'Segoe UI',sans-serif;background:#fef3e8;padding:20px;}
        .qr-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;justify-items:center;}
        ${QR_CARD_CSS}
        @media print{ body{background:#fff;} }
        </style></head><body><div class="qr-grid">${cardsHtml}</div>
        <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`);
    w.document.close();
}

function _exportTablesCsv() {
    const rows = [['Table', 'Capacity', 'Status', 'Current Session', 'Running Total']];
    Object.values(_tables).sort((a, b) => Number(a.number) - Number(b.number)).forEach(t => {
        const sess = _sessionForTable(t.id);
        rows.push([t.number, t.capacity, t.status, sess?.sessionId || '', sess ? _effectiveTotal(sess) : '']);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tables-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------
// Firebase listeners — exactly 3 listeners total, NEVER one-per-table
// (matches "Performance Architecture" rule in the spec)
// ---------------------------------------------------------------------
function _attachListeners() {
    if (_tablesListener) { _tablesListener(); _tablesListener = null; }
    if (_sessionsListener) { _sessionsListener(); _sessionsListener = null; }
    if (_ordersListener) { _ordersListener(); _ordersListener = null; }
    if (_requestsListener) { _requestsListener(); _requestsListener = null; }

    _tablesListener = onValue(_tblRef(), (snap) => {
        _tables = snap.val() || {};
        _renderAll();
    }, (err) => {
        console.error('[Tables] Read error:', err);
        const grid = document.getElementById('tableManagementGrid');
        if (grid) grid.innerHTML = `<div class="offline-placeholder"><i data-lucide="alert-triangle" class="icon-32"></i><h4>Permission denied</h4><p>Could not load table data.</p></div>`;
    });

    _sessionsListener = onValue(_sessRef(), (snap) => {
        _sessions = snap.val() || {};
        _renderAll();
    }, (err) => {
        console.error('[Tables] Sessions read error:', err);
        document.getElementById('tblKpiRevenue').textContent = '—';
    });

    // Always attach an /orders listener so KDS status updates
    // (advanceTableOrder) immediately trigger a re-render.
    if (state.ordersMap && state.ordersMap.size > 0) {
        _orders = Object.fromEntries(state.ordersMap);
        _syncCustomersFromOrders(_orders);
    }
    if (!_ordersListenerAttached) {
        _ordersListenerAttached = true;
        _ordersListener = onValue(_ordersRef(), (snap) => {
            _orders = snap.val() || {};
            _syncCustomersFromOrders(_orders);
            _renderAll();
        }, (err) => {
            console.error('[Tables] Orders read error:', err);
        });
    }

    _requestsListener = onValue(_reqRef(), (snap) => {
        _tableRequests = snap.val() || {};
        const currentIds = new Set(Object.keys(_tableRequests));

        if (_seenRequestIds !== null) {
            const newOnes = [...currentIds].filter(id => !_seenRequestIds.has(id) && _tableRequests[id]?.status !== 'resolved');
            newOnes.forEach(id => {
                const r = _tableRequests[id];
                const meta = REQUEST_TYPE_META[r.type] || { label: r.type || 'Request' };
                showToast(`Table ${r.tableNumber || ''}: ${meta.label}`, 'info');
            });
            if (newOnes.length) { haptic(25); playNotificationSound(); }
        }
        _seenRequestIds = currentIds;
        _renderAll();
    });
}

export function cleanupTables() {
    if (_tablesListener) { _tablesListener(); _tablesListener = null; }
    if (_sessionsListener) { _sessionsListener(); _sessionsListener = null; }
    if (_ordersListener) { _ordersListener(); _ordersListener = null; _ordersListenerAttached = false; }
    if (_requestsListener) { _requestsListener(); _requestsListener = null; }
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
    if (_kdsTickInterval) { clearInterval(_kdsTickInterval); _kdsTickInterval = null; }
    if (_policeInterval) { clearInterval(_policeInterval); _policeInterval = null; }
    _seenRequestIds = null;
    _customerSyncedOrderIds.clear();
    _closeTableDrawer();
}

export function loadTableManagement() {
    console.log('[Tables] Loading tab…');
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }

    if (isConnected()) {
        _attachListeners();
    } else {
        const grid = document.getElementById('tableManagementGrid');
        if (grid) grid.innerHTML = `<div class="offline-placeholder"><i data-lucide="wifi-off" class="icon-32"></i><h4>Waiting for connection</h4><p>Table data will load automatically when the connection is restored.</p></div>`;
        if (!_connUnsub) _connUnsub = onConnectionChange(function _retryTables(online) {
            if (!online) return;
            if (_connUnsub) { _connUnsub(); _connUnsub = null; }
            cleanupTables();
            loadTableManagement();
        });
    }

    if (!_kdsTickInterval) _kdsTickInterval = setInterval(_tickKDS, 1000);
    if (!_policeInterval) _policeInterval = setInterval(_policeExpiredSessions, 30000);

    const tabRoot = document.getElementById('tab-tables');
    if (tabRoot && !tabRoot.__tablesWired) {
        tabRoot.__tablesWired = true;
        tabRoot.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            switch (action) {
                case 'openTableDrawer': _openTableDrawer(id); break;
                case 'openTableDrawerByOrder': _openTableDrawerByOrder(btn.dataset.orderId); break;
                case 'openAddTable': _openTableEditor(null); break;
                case 'editTable': _openTableEditor(id); break;
                case 'deleteTable': _deleteTable(id); break;
                case 'enableTable': _setTableEnabled(id, true); break;
                case 'disableTable': _setTableEnabled(id, false); break;
                case 'openTableQr': _openQrModal(id); break;
                case 'bulkQrPrint': _bulkQrPrint(); break;
                case 'exportTables': _exportTablesCsv(); break;
                case 'advanceTableOrder': _advanceOrder(id, btn.dataset.next); break;
                case 'requestBillForTable': _requestBillForTable(id); break;
                case 'requestBillForGroup': _requestBillForGroup(id, btn.dataset.groupId); break;
                case 'makePaymentForGroup': _makePaymentForGroup(id, btn.dataset.groupId); break;
                case 'closeSessionForTable': _closeSessionForTable(id); break;
                case 'makePaymentForTable': _makePaymentForTable(id); break;
                case 'cancelSessionForTable': _cancelSessionForTable(id); break;
                case 'closeExpiredSession': _closeExpiredSession(id); break;
                case 'printTableKOT': _printTableKOT(id); break;
                case 'printSessionBill': _printSessionBill(id); break;
                case 'printBillForGroup': _printBillForGroup(id, btn.dataset.groupId); break;
                case 'resolveTableRequest': _resolveTableRequest(btn.dataset.id); break;
                case 'jumpToOrderInOrdersTab': _jumpToOrderInOrdersTab(id); break;
                case 'closeTableDrawer': _closeTableDrawer(); break;
            }
        });
    }

    if (!window.__tablesModalsWired) {
        window.__tablesModalsWired = true;
        document.getElementById('tableEditorSaveBtn')?.addEventListener('click', _saveTable);
        document.getElementById('tableEditorCancelBtn')?.addEventListener('click', _closeTableEditor);
        document.getElementById('tableEditorCloseBtn')?.addEventListener('click', _closeTableEditor);
        document.getElementById('tableQrCloseBtn')?.addEventListener('click', _closeQrModal);
        document.getElementById('tableQrPrintBtn')?.addEventListener('click', _printSingleQr);
        document.getElementById('tableQrCopyLinkBtn')?.addEventListener('click', _copyQrLink);
        document.getElementById('tableDrawerOverlay')?.addEventListener('click', _closeTableDrawer);
        document.getElementById('tableDrawerCloseBtn')?.addEventListener('click', _closeTableDrawer);
    }
}

window.__tables = {
    openEditor: _openTableEditor, closeEditor: _closeTableEditor, save: _saveTable,
    delete: _deleteTable, openDrawer: _openTableDrawer, closeDrawer: _closeTableDrawer,
    openQr: _openQrModal, closeQr: _closeQrModal, bulkPrint: _bulkQrPrint, exportCsv: _exportTablesCsv,
    openDrawerByOrder: _openTableDrawerByOrder, requestBill: _requestBillForTable,
    requestBillForGroup: _requestBillForGroup,
    makePaymentForGroup: _makePaymentForGroup,
    printKOT: _printTableKOT, jumpToOrder: _jumpToOrderInOrdersTab,
    closeSession: _closeSessionForTable, cancelSession: _cancelSessionForTable,
    closeExpiredSession: _closeExpiredSession,
    makePaymentForTable: _makePaymentForTable,
    advanceOrder: _advanceOrder,
    printSessionBill: _printSessionBill,
    printBillForGroup: _printBillForGroup,
    editTable: _openTableEditor, setTableEnabled: _setTableEnabled
};
