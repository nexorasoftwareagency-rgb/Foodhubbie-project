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
import { showToast, showConfirm, showDeleteConfirm, showPaymentPicker, showSplitPaymentPicker } from '../ui-utils.js';
import { printOrderReceipt } from './printing.js';
import { haptic, escapeHtml, playNotificationSound } from '../utils.js';
import { loadLucide } from '../ui.js';
import { evaluateDiscount, recordDiscountUsage, getAllDiscounts, getEligibleOffersForDisplay } from './discount-evaluator.js';

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
            const tableOrderCount = (sess.orders || []).length;
            const mins = _sessionElapsedMinutes(sess);
            metaLine = `<div class="table-card-bill">₹${_effectiveTotal(sess).toLocaleString('en-IN')}</div>
                     <div class="table-card-meta-row">${orderCount} Order${orderCount !== 1 ? 's' : ''} · ${mins} min</div>`;
        }
    }
    const disabledSuffix = t.status === 'disabled' ? ' (Disabled)' : '';
    return `
    <button type="button" class="table-grid-card ${meta.cls}" data-action="openTableDrawer" data-id="${escapeHtml(t.id)}" title="Table ${escapeHtml(t.number)} — ${meta.label}${disabledSuffix}">
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
            // Check for walkout before canceling — log unpaid served orders as walkouts
            await checkAndRecordWalkout(linkedTable?.id, id);
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
        // Walkout button for served but unpaid orders
        const unpaidServed = activeOrders.filter(o => o.status === 'Served' && o.paymentStatus !== 'Paid');
        if (unpaidServed.length > 0) {
            btns.push(`<button class="btn-text text-warning btn-small" data-action="recordWalkout" data-id="${escapeHtml(t.id)}"><i data-lucide="user-x" class="icon-14"></i> Record Walkout</button>`);
        }
    } else {
        btns.push(`<button class="btn-action-green btn-small" data-action="closeSessionForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="check-check" class="icon-14"></i> Close Table (Paid)</button>`);
        // Void payment button for paid tables
        const hasPaidOrders = ordersAll.some(o => o.paymentStatus === 'Paid');
        if (hasPaidOrders) {
            btns.push(`<button class="btn-text text-warning btn-small" data-action="voidTableBill" data-id="${escapeHtml(t.id)}"><i data-lucide="rotate-ccw" class="icon-14"></i> Void Payment</button>`);
        }
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

    openTableBillReview(tableId, null);
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
    openTableBillReview(tableId, groupId);
}

// ---------------------------------------------------------------------
// Table Bill Payment — coupon / discount review, applied at bill-settle
// time. "You ran a promotion, so we came" → staff opens the Active
// Offers panel, applies the code, THEN picks a payment method.
//
// Design decisions worth knowing if you extend this:
//
// - A table bill can cover MANY orders (a whole session, or one billing
//   group within a split session). There is no single "order" a
//   table-level discount belongs to, so it's stored on the SESSION (or
//   orderGroup) document itself — subtotal/discount/discountId/
//   discountLabel/discountSource/paidAmount — the same shape a real
//   receipt uses (item prices unchanged, discount shown as a bill-level
//   line), rather than retroactively rewriting each order's stored total.
//
// - tableAnalytics.totalRevenue is credited with paidAmount (post-
//   discount), not the gross subtotal — it should reflect money actually
//   collected.
//
// - Channel is 'pos' for table billing (same bucket as Walk-in), not a
//   new channel value — the discount editor's Channel field only has
//   three options (WhatsApp / POS / Both) and introducing a fourth would
//   touch the editor UI, the evaluator, and the reports channel-split.
//   If you want table-billing redemptions tracked separately from
//   walk-in in the P&L reports later, that's the place to start.
//
// - Category-type discounts may not correctly auto-evaluate here: order
//   records in this session don't carry category IDs the way a live POS
//   cart does, so `cart` is passed empty. Coupon, storewide, and
//   first-order discounts are unaffected — only category-scoped
//   discounts are the gap, and it's a real one, not silently patched.
//
// - The discount-usage audit log's "view order" link expects a real
//   order id, not a session id (a table bill isn't one). We record
//   usage against one representative order from the bill (the first one
//   that has a customerPhone, or just the first order) — clicking
//   through later shows a real, relevant order, not the whole bill, but
//   that's honest given the existing link only understands orders.
//
// - Customer discountUsage / firstOrderDiscountUsed are bumped here (so
//   a coupon can't be reused across POS, WhatsApp, and table billing
//   past its per-customer limit) — but orderCount/totalSpent/lastSeen
//   are deliberately NOT touched. Those are already maintained wherever
//   the individual dine-in orders were first created; bumping them again
//   at bill-settle time would double-count revenue and visit counts.
// ---------------------------------------------------------------------

let _billTableId = null;
let _billGroupId = null;     // null = whole-table payment; set = one split-bill group
let _billManualDiscount = 0;
let _billManualDiscountPct = 0;
let _billAutoDiscount = null; // evaluateDiscount() result: { discount, amount, label, source }
let _billCouponCode = null;
let _billReviewConnUnsub = null; // connection change unsubscribe for bill review modal

function _billSubtotal() {
    const t = _tables[_billTableId];
    const sess = _sessionForTable(_billTableId);
    if (!t || !sess) return 0;
    const orders = _billGroupId
        ? _ordersForGroup(sess.sessionId, _billGroupId)
        : _ordersForSession(sess.sessionId || t.currentSession);
    return orders.filter(o => o.status !== 'Cancelled').reduce((sum, o) => sum + Number(o.total || 0), 0);
}

function _billCustomerPhoneAndOrderId() {
    const t = _tables[_billTableId];
    const sess = _sessionForTable(_billTableId);
    if (!t || !sess) return { phone: null, orderId: null };
    const orders = (_billGroupId
        ? _ordersForGroup(sess.sessionId, _billGroupId)
        : _ordersForSession(sess.sessionId || t.currentSession)
    ).filter(o => o.status !== 'Cancelled');
    const withPhone = orders.find(o => o.customerPhone);
    return { phone: withPhone?.customerPhone || null, orderId: (withPhone || orders[0])?.id || null };
}

function _billComputedDiscount(subtotal) {
    let discountValue = 0, discountLabel = null, discountId = null, discountSource = 'none', discountGlobalLimit = null;
    // Manual discounts (flat Rs / %) now get synthetic IDs so they participate in audit trail
    // and per-customer limits. They use 'manual:flat' / 'manual:percent' sources.
    // perCustomerLimit is enforced via customer.discountUsage['manual:flat'] counter.
    // globalLimit is NOT enforced for manual discounts (unlimited by design).
    if (_billManualDiscount > 0) {
        discountValue = _billManualDiscount;
        discountSource = MANUAL_DISCOUNT_SOURCES.FLAT;
        discountId = 'manual:flat';
    } else if (_billManualDiscountPct > 0) {
        discountValue = Math.round((subtotal * _billManualDiscountPct) / 100);
        discountSource = MANUAL_DISCOUNT_SOURCES.PERCENT;
        discountId = 'manual:percent';
    } else if (_billAutoDiscount && _billAutoDiscount.amount > 0) {
        discountValue = _billAutoDiscount.amount;
        discountId = _billAutoDiscount.discount.id;
        discountLabel = _billAutoDiscount.label;
        discountSource = _billAutoDiscount.source;
        discountGlobalLimit = _billAutoDiscount.discount.globalLimit;
    }
discountValue = Math.max(0, Math.min(Math.round(discountValue), subtotal));
    return { discountValue, discountLabel, discountId, discountSource, discountGlobalLimit };
}

export async function openTableBillReview(tableId, groupId = null) {
    _billTableId = tableId;
    _billGroupId = groupId || null;
    _billManualDiscount = 0;
    _billManualDiscountPct = 0;
    _billAutoDiscount = null;
    _billCouponCode = null;
    _clearTableBillCouponUI();
    document.getElementById('tableBillOffersPanel')?.classList.add('hidden');

    const amtInput = document.getElementById('tableBillDiscountAmt');
    if (amtInput) {
        amtInput.value = 0;
        if (!amtInput.dataset.listener) {
            amtInput.dataset.listener = '1';
            amtInput.addEventListener('input', (e) => setTableBillDiscount(parseFloat(e.target.value) || 0));
        }
    }
    const pctInput = document.getElementById('tableBillDiscountPct');
    if (pctInput) {
        pctInput.value = 0;
        if (!pctInput.dataset.listener) {
            pctInput.dataset.listener = '1';
            pctInput.addEventListener('input', (e) => setTableBillDiscountPct(parseFloat(e.target.value) || 0));
        }
    }

    _renderTableBillReview();
    document.getElementById('tableBillReviewModal')?.classList.add('active');
    loadLucide();

    // Offline banner handling for bill review modal
    if (!_billReviewConnUnsub) {
        _billReviewConnUnsub = onConnectionChange((online) => {
            const banner = document.getElementById('tableBillOfflineBanner');
            const proceedBtn = document.querySelector('[data-action="confirmTableBillPayment"]');
            if (banner) banner.classList.toggle('hidden', online);
            if (proceedBtn) proceedBtn.disabled = !online;
        });
    }
    // Initial state
    const isOnline = isConnected();
    const banner = document.getElementById('tableBillOfflineBanner');
    const proceedBtn = document.querySelector('[data-action="confirmTableBillPayment"]');
    if (banner) banner.classList.toggle('hidden', isOnline);
    if (proceedBtn) proceedBtn.disabled = !isOnline;

    // Retry button in offline banner
    const retryBtn = document.getElementById('tableBillRetryConnection');
    if (retryBtn && !retryBtn.dataset.listener) {
        retryBtn.dataset.listener = '1';
        retryBtn._handler = () => {
            if (isConnected()) {
                proceedBtn.disabled = false;
                banner?.classList.add('hidden');
            } else {
                showToast('Still offline. Please check your connection.', 'warning');
            }
        };
        retryBtn.addEventListener('click', retryBtn._handler);
    }
}

export function closeTableBillReview() {
    document.getElementById('tableBillReviewModal')?.classList.remove('active');
    _billTableId = null;
    _billGroupId = null;
    if (_billReviewConnUnsub) {
        _billReviewConnUnsub();
        _billReviewConnUnsub = null;
    }
    // Cleanup retry button listener
    const retryBtn = document.getElementById('tableBillRetryConnection');
    if (retryBtn) {
        retryBtn.removeEventListener('click', retryBtn._handler);
        delete retryBtn.dataset.listener;
        delete retryBtn._handler;
    }
}

function _renderTableBillReview() {
    const t = _tables[_billTableId];
    if (!t) return;
    const subtotal = _billSubtotal();
    const { discountValue, discountLabel } = _billComputedDiscount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountValue);

    const title = document.getElementById('tableBillReviewTitle');
    if (title) {
        const sess = _sessionForTable(_billTableId);
        const groupLabel = _billGroupId ? (sess?.orderGroups?.[_billGroupId]?.label || 'Group') : null;
        title.textContent = groupLabel ? `Table ${t.number} — ${groupLabel}` : `Table ${t.number} — Bill`;
    }

    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('tableBillSubtotal', `₹${subtotal.toLocaleString('en-IN')}`);
    const discRow = document.getElementById('tableBillDiscountRow');
    if (discountValue > 0) {
        discRow?.classList.remove('hidden');
        setText('tableBillDiscountVal', discountLabel ? `-₹${discountValue.toLocaleString('en-IN')} (${discountLabel})` : `-₹${discountValue.toLocaleString('en-IN')}`);
    } else {
        discRow?.classList.add('hidden');
    }
    setText('tableBillTotal', `₹${finalTotal.toLocaleString('en-IN')}`);
}

function _clearTableBillCouponUI() {
    const input = document.getElementById('tableBillCouponCode');
    const hint = document.getElementById('tableBillCouponHint');
    const clear = document.getElementById('tableBillCouponClearBtn');
    if (input) input.value = '';
    if (hint) hint.classList.add('hidden');
    if (clear) clear.classList.add('hidden');
}

// Manual discount sources — explicitly unlimited (no per-customer / global limits)
// These are created inline during bill review and don't have a discountId
const MANUAL_DISCOUNT_SOURCES = {
    FLAT: 'manual:flat',
    PERCENT: 'manual:percent',
};

export function setTableBillDiscount(amt) {
    _billManualDiscount = Math.max(0, Number(amt) || 0);
    _billManualDiscountPct = 0;
    if (_billManualDiscount > 0) {
        _billAutoDiscount = null; _billCouponCode = null; _clearTableBillCouponUI();
        const pctInput = document.getElementById('tableBillDiscountPct');
        if (pctInput) pctInput.value = 0;
    }
    _renderTableBillReview();
}

export function setTableBillDiscountPct(pct) {
    _billManualDiscountPct = Math.max(0, Math.min(100, Number(pct) || 0));
    _billManualDiscount = 0;
    if (_billManualDiscountPct > 0) {
        _billAutoDiscount = null; _billCouponCode = null; _clearTableBillCouponUI();
        const amtInput = document.getElementById('tableBillDiscountAmt');
        if (amtInput) amtInput.value = 0;
    }
    _renderTableBillReview();
}

// Build cart from session/group orders for discount evaluation (needed for category-type discounts)
function _billCart() {
    const t = _tables[_billTableId];
    const sess = _sessionForTable(_billTableId);
    if (!t || !sess) return [];
    const orders = _billGroupId
        ? _ordersForGroup(sess.sessionId, _billGroupId)
        : _ordersForSession(sess.sessionId || t.currentSession);
    const cart = [];
    orders.filter(o => o.status !== 'Cancelled').forEach(o => {
        Object.values(o.items || {}).forEach(it => {
            const qty = Number(it.qty || 1);
            for (let i = 0; i < qty; i++) {
                cart.push({
                    name: it.name || 'Item',
                    price: Number(it.price || 0),
                    category: it.category || '',
                    categoryId: it.categoryId || '',
                    size: it.size || '',
                    addon: it.addon || ''
                });
            }
        });
    });
    return cart;
}

export async function applyTableBillCoupon() {
    const input = document.getElementById('tableBillCouponCode');
    const hint = document.getElementById('tableBillCouponHint');
    const clear = document.getElementById('tableBillCouponClearBtn');
    if (!input || !_billTableId) return;
    const code = (input.value || '').trim();
    if (!code) {
        if (hint) { hint.classList.remove('hidden'); hint.textContent = 'Enter a code first.'; }
        return;
    }
    if (_billManualDiscount > 0 || _billManualDiscountPct > 0) {
        if (hint) { hint.classList.remove('hidden'); hint.textContent = 'Clear the manual discount first.'; }
        return;
    }
    const subtotal = _billSubtotal();
    if (subtotal <= 0) {
        if (hint) { hint.classList.remove('hidden'); hint.textContent = 'No billable items on this bill.'; }
        return;
    }

    const { phone } = _billCustomerPhoneAndOrderId();
    let customer = null;
    if (phone) {
        try {
            const snap = await get(Outlet.ref(`customers/${phone}`));
            if (snap.exists()) customer = snap.val();
        } catch (e) { console.warn('[Tables] customer fetch failed:', e?.message || e); }
    }

    try {
        const cart = _billCart();
        const evalResult = await evaluateDiscount({ customer, subtotal, couponCode: code, cart, channel: 'table' });
        if (!evalResult || evalResult.amount <= 0) {
            _billAutoDiscount = null; _billCouponCode = null;
            if (hint) { hint.classList.remove('hidden'); hint.textContent = `❌ Code "${code}" is not valid or doesn't apply to this bill.`; }
            if (clear) clear.classList.add('hidden');
            _renderTableBillReview();
            return;
        }
        _billAutoDiscount = evalResult;
        _billCouponCode = code;
        if (hint) { hint.classList.remove('hidden'); hint.textContent = `✅ Applied: ${evalResult.label} (saved ₹${evalResult.amount.toLocaleString('en-IN')})`; }
        if (clear) clear.classList.remove('hidden');
        _renderTableBillReview();
    } catch (e) {
        console.error('[Tables] applyTableBillCoupon failed:', e);
        if (hint) { hint.classList.remove('hidden'); hint.textContent = 'Error evaluating discount. Try again.'; }
    }
}

export function clearTableBillCoupon() {
    _billAutoDiscount = null;
    _billCouponCode = null;
    _clearTableBillCouponUI();
    _renderTableBillReview();
}

export async function toggleTableBillOffersPanel() {
    const panel = document.getElementById('tableBillOffersPanel');
    const btn = document.getElementById('tableBillOffersBtn');
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    if (!opening) {
        panel.classList.add('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        return;
    }
    panel.classList.remove('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    panel.innerHTML = '<div class="text-muted-small" style="padding:10px;">Loading offers…</div>';
    await _renderTableBillOffers();
}

async function _renderTableBillOffers() {
    const panel = document.getElementById('tableBillOffersPanel');
    if (!panel) return;

    let all;
    try {
        all = await getAllDiscounts();
    } catch (e) {
        panel.innerHTML = '<div class="text-muted-small" style="padding:10px;">Could not load offers. Try again.</div>';
        return;
    }

    const subtotal = _billSubtotal();
    const cart = _billCart();
    const list = getEligibleOffersForDisplay(all, { channel: 'table', cart, includeNonMatchingCategories: true });

    if (list.length === 0) {
        panel.innerHTML = '<div class="text-muted-small" style="padding:10px;">No active offers right now. <button type="button" data-action="switchTab" data-tab="discounts" class="walkin-offers-manage-link">Manage discounts →</button></div>';
        return;
    }

    panel.innerHTML = list.map(d => {
        const valueLabel = d.mode === 'percent'
            ? `${Number(d.value).toFixed(d.value % 1 === 0 ? 0 : 1)}% off`
            : `₹${Number(d.value).toFixed(0)} off`;
        const capLabel = d.maxCap ? ` (cap ₹${Number(d.maxCap).toFixed(0)})` : '';
        const minLabel = d.minSubtotal ? ` · min ₹${Number(d.minSubtotal).toFixed(0)}` : '';
        const used = d.stats?.usedCount || 0;
        const usedLabel = used > 0 ? ` · used ${used}${d.globalLimit ? `/${d.globalLimit}` : ''}×` : '';
        const categoryMismatch = d.type === 'category' && d._categoryMatches === false;
        const categoryNames = d.categoryIds?.map(id => {
            const cat = _categoriesSnap?.find(c => c.id === id);
            return cat?.name || id;
        }).join(', ') || 'Unknown';

        if (d.type === 'coupon') {
            const meetsMin = !d.minSubtotal || subtotal >= d.minSubtotal;
            const shortfall = meetsMin ? 0 : Math.ceil(d.minSubtotal - subtotal);
            return `
                <div class="walkin-offer-item${meetsMin ? '' : ' walkin-offer-disabled'}">
                    <div class="walkin-offer-info">
                        <div class="walkin-offer-name"><code>${escapeHtml(d.couponCode)}</code> — ${escapeHtml(d.name || '')}</div>
                        <div class="walkin-offer-meta">${valueLabel}${capLabel}${minLabel}${usedLabel}</div>
                    </div>
                    <button type="button" class="chip walkin-offer-apply-btn" data-action="applyTableOfferFromPanel" data-code="${escapeHtml(d.couponCode)}" ${meetsMin ? '' : 'disabled'} title="${meetsMin ? 'Apply this code' : `Add ₹${shortfall} more to qualify`}">
                        ${meetsMin ? 'Apply' : `+₹${shortfall} to use`}
                    </button>
                </div>`;
        }

        const typeLabel = d.type === 'firstOrder' ? 'New customer' : d.type === 'category' ? 'Category' : 'Storewide';
        const mismatchNote = d.type === 'category' && d._categoryMatches === false
            ? `<div class="walkin-offer-mismatch" style="color:#ef4444; font-size:11px; margin-top:4px;">Requires items from: ${categoryNames}</div>`
            : '';

        return `
            <div class="walkin-offer-item walkin-offer-auto${d._categoryMatches === false ? ' walkin-offer-disabled' : ''}">
                <div class="walkin-offer-info">
                    <div class="walkin-offer-name">${escapeHtml(d.name || typeLabel)} <span class="badge badge-info walkin-offer-auto-badge">auto</span></div>
                    <div class="walkin-offer-meta">${valueLabel}${capLabel}${minLabel}${usedLabel} · applies automatically if eligible${mismatchNote}</div>
                </div>
            </div>`;
    }).join('') + '<div class="walkin-offers-manage-row"><button type="button" data-action="switchTab" data-tab="discounts" class="walkin-offers-manage-link">Manage discounts →</button></div>';
}

export function applyTableOfferFromPanel(code) {
    const input = document.getElementById('tableBillCouponCode');
    if (input) input.value = code;
    document.getElementById('tableBillOffersPanel')?.classList.add('hidden');
    document.getElementById('tableBillOffersBtn')?.setAttribute('aria-expanded', 'false');
    applyTableBillCoupon();
}

async function _bumpCustomerDiscountUsage(phone, discountId, discountSource) {
    if (!phone || !discountId) return;
    try {
        const isFirstOrderDiscount = discountSource === 'firstOrder' && discountId;
        await runTransaction(Outlet.ref(`customers/${phone}`), (cur) => {
            if (cur === null) return cur; // no existing customer record — that's owned by order-creation flows, not billing
            if (isFirstOrderDiscount) {
                cur.firstOrderDiscountUsed = Date.now();
                cur.firstOrderDiscountId = discountId;
            }
            cur.discountUsage = cur.discountUsage || {};
            cur.discountUsage[discountId] = (cur.discountUsage[discountId] || 0) + 1;
            return cur;
        });
    } catch (e) {
        console.warn('[Tables] Failed to bump customer discount usage:', e?.message || e);
    }
}

export async function confirmTableBillPayment() {
    const tableId = _billTableId;
    const groupId = _billGroupId;
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { closeTableBillReview(); return; }

    const subtotal = _billSubtotal();
    const { discountValue, discountLabel, discountId, discountSource, discountGlobalLimit } = _billComputedDiscount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountValue);

    // Use Firebase connection state (reliable) instead of navigator.onLine
    if (!isConnected()) {
        showToast('You are offline. Please reconnect to process payment.', 'warning');
        return;
    }

    const paymentEntries = await showSplitPaymentPicker(finalTotal);
    if (!paymentEntries || paymentEntries.length === 0) return;

    const { phone: customerPhone, orderId: representativeOrderId } = _billCustomerPhoneAndOrderId();
    const now = Date.now();
    const outletRef = Outlet.ref('');

    // Primary payment method (first entry) for order/group records
    const primaryMethod = paymentEntries[0].method;
    const paymentDetails = paymentEntries.map(e => `${e.method} ₹${e.amount}`).join(' + ');

    if (groupId) {
        // GROUP PAYMENT — atomic multi-path update
        const gOrders = sess.orderGroups[groupId]?.orders || [];
        const updates = {};
        gOrders.forEach(oid => {
            if (_orders[oid] && _orders[oid].status !== 'Cancelled') {
                updates[`outlets/${OUTLET}/orders/${oid}/paymentMethod`] = primaryMethod;
                updates[`outlets/${OUTLET}/orders/${oid}/paymentStatus`] = 'Paid';
                updates[`outlets/${OUTLET}/orders/${oid}/updatedAt`] = now;
            }
        });
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/status`] = 'paid';
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paidAt`] = now;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentMethod`] = primaryMethod;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentDetails`] = paymentDetails;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentEntries`] = paymentEntries;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/subtotal`] = subtotal;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discount`] = discountValue;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountId`] = discountId || null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountLabel`] = discountLabel || null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountSource`] = discountSource || null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paidAmount`] = finalTotal;

        try {
            await outletRef.update(updates);
            if (discountId && discountValue > 0) {
                await recordDiscountUsage({ discountId, orderId: representativeOrderId, customerPhone, amountGiven: discountValue, channel: 'pos', discountLabel, discountSource, globalLimit: discountGlobalLimit });
                await _bumpCustomerDiscountUsage(customerPhone, discountId, discountSource);
            }
            closeTableBillReview();
            showToast(`${sess.orderGroups[groupId]?.label || 'Group'} paid — ₹${finalTotal.toLocaleString('en-IN')} via ${paymentDetails}`, 'success');
            haptic(30);
        } catch (e) {
            showToast('Failed: ' + (e?.message || e), 'error');
        }
        return;
    }

    // FULL TABLE PAYMENT — atomic multi-path update
    const orders = _ordersForSession(sess.sessionId || t.currentSession);
    const updates = {};
    const tableOrderCount = (sess.orders || []).length;
    const mins = _sessionElapsedMinutes(sess);

    orders.forEach(o => {
        if (o.id && o.status !== 'Cancelled') {
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentMethod`] = primaryMethod;
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentStatus`] = 'Paid';
            updates[`outlets/${OUTLET}/orders/${o.id}/updatedAt`] = now;
        }
    });
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/status`] = 'closed';
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/closedAt`] = now;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentMethod`] = primaryMethod;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentDetails`] = paymentDetails;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentEntries`] = paymentEntries;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paidAt`] = now;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/subtotal`] = subtotal;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discount`] = discountValue;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountId`] = discountId || null;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountLabel`] = discountLabel || null;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountSource`] = discountSource || null;
    updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paidAmount`] = finalTotal;
    updates[`outlets/${OUTLET}/tables/${tableId}/status`] = 'free';
    updates[`outlets/${OUTLET}/tables/${tableId}/currentSession`] = null;
    updates[`outlets/${OUTLET}/tables/${tableId}/updatedAt`] = now;

    try {
        await outletRef.update(updates);
        // Analytics transaction (separate — independent)
        await runTransaction(Outlet.ref(`tableAnalytics/${tableId}`), (cur) => {
            cur = cur || { totalOrders: 0, totalRevenue: 0, avgSessionTime: 0, occupancyRate: 0 };
            cur.totalOrders = (cur.totalOrders || 0) + orderCount;
            cur.totalRevenue = (cur.totalRevenue || 0) + finalTotal;
            cur.avgSessionTime = cur.avgSessionTime ? Math.round((cur.avgSessionTime + mins) / 2) : mins;
            return cur;
        });
        if (discountId && discountValue > 0) {
            try {
                await recordDiscountUsage({ discountId, orderId: representativeOrderId, customerPhone, amountGiven: discountValue, channel: 'pos', discountLabel, discountSource, globalLimit: discountGlobalLimit });
            } catch (e) { console.warn('[Tables] recordDiscountUsage failed:', e?.message || e); }
            await _bumpCustomerDiscountUsage(customerPhone, discountId, discountSource);
        }
        if (_drawerTableId === tableId) _closeTableDrawer();
        closeTableBillReview();
        showToast(`Table closed — ₹${finalTotal.toLocaleString('en-IN')} via ${paymentDetails}`, 'success');
        haptic(30);
    } catch (e) {
        showToast('Payment failed: ' + (e?.message || e), 'error');
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
// VOID/REFUND — Revert a paid bill (group or full table) back to billing
// ---------------------------------------------------------------------
export async function voidTableBill(tableId, groupId = null) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { showToast('Table or session not found', 'error'); return; }

    const ok = await showConfirm(
        `Void the payment and reopen the ${groupId ? 'group bill' : 'table bill'}? 
Orders will be reverted to Served status. Discount usage will be reverted.
This action cannot be undone.`,
        'Void Payment'
    );
    if (!ok) return;

    try {
        const { phone: customerPhone, orderId: representativeOrderId } = _billCustomerPhoneAndOrderId();
        const now = Date.now();
        const outletRef = Outlet.ref('');
        let groupOrderCount = 0;
        let ordersToRevert = [];

        if (groupId) {
            // GROUP VOID
            const group = sess.orderGroups[groupId];
            if (!group || group.status !== 'paid') {
                showToast('Group is not in paid state', 'warning');
                return;
            }

            const gOrders = group.orders || [];
            const updates = {};

            gOrders.forEach(oid => {
                if (_orders[oid] && _orders[oid].status === 'Paid') {
                    updates[`outlets/${OUTLET}/orders/${oid}/paymentStatus`] = 'Served';
                    updates[`outlets/${OUTLET}/orders/${oid}/paymentMethod`] = null;
                    updates[`outlets/${OUTLET}/orders/${oid}/paymentDetails`] = null;
                    updates[`outlets/${OUTLET}/orders/${oid}/paymentEntries`] = null;
                    updates[`outlets/${OUTLET}/orders/${oid}/updatedAt`] = Date.now();
                }
            });

            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/status`] = 'billing';
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paidAt`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentMethod`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentDetails`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paymentEntries`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discount`] = 0;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountId`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountLabel`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/discountSource`] = null;
            updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/orderGroups/${groupId}/paidAmount`] = 0;

            try {
                await outletRef.update(updates);

                // Revert order statuses via transactions
                await Promise.all(ordersToRevert.map(oid => runTransaction(_ordersRef(oid), (cur) => {
                    if (!cur || cur.status !== 'Paid') return;
                    return { ...cur, status: 'Served', paymentStatus: 'Unpaid', paymentMethod: null, paymentDetails: null, paymentEntries: null, discount: 0, discountLabel: null, discountId: null, discountSource: null, updatedAt: Date.now() };
                })));

                // Revert discount usage if applicable
                const group = sess.orderGroups[groupId];
                if (group?.discountId && group.discount > 0) {
                    await recordDiscountUsage({ discountId: group.discountId, orderId: representativeOrderId, customerPhone: '', amountGiven: -group.discount, channel: 'pos', discountLabel: group.discountLabel, discountSource: group.discountSource, globalLimit: group.discountGlobalLimit, isVoid: true });
                    await _bumpCustomerDiscountUsage(customerPhone, group.discountId, group.discountSource, true);
                }

                closeTableBillReview();
                showToast(`${group.label || 'Group'} payment voided — orders reverted to Served`, 'success');
                haptic(30);
            } catch (e) {
                showToast('Failed to void group payment: ' + (e?.message || e), 'error');
            }
            return;
        }

        // FULL TABLE VOID
        const orders = _ordersForSession(sess.sessionId || t.currentSession);
        const paidOrders = orders.filter(o => o.id && o.status === 'Paid');

        if (paidOrders.length === 0) {
            showToast('No paid orders to void', 'warning');
            return;
        }

        const tableOrderCount = (sess.orders || []).length;
        const mins = _sessionElapsedMinutes(sess);
        const updates = {};

        paidOrders.forEach(o => {
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentStatus`] = 'Served';
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentMethod`] = null;
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentDetails`] = null;
            updates[`outlets/${OUTLET}/orders/${o.id}/paymentEntries`] = null;
            updates[`outlets/${OUTLET}/orders/${o.id}/updatedAt`] = Date.now();
        });

        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/status`] = 'billing';
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/closedAt`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentMethod`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentDetails`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paymentEntries`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paidAt`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/subtotal`] = subtotal;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discount`] = 0;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountId`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountLabel`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/discountSource`] = null;
        updates[`outlets/${OUTLET}/sessions/${sess.sessionId}/paidAmount`] = 0;
        updates[`outlets/${OUTLET}/tables/${tableId}/status`] = 'billing';
        updates[`outlets/${OUTLET}/tables/${tableId}/currentSession`] = sess.sessionId;
        updates[`outlets/${OUTLET}/tables/${tableId}/updatedAt`] = Date.now();

        try {
            await outletRef.update(updates);

            // Revert order statuses via transactions
            await Promise.all(paidOrders.map(o => runTransaction(_ordersRef(o.id), (cur) => {
                if (!cur || cur.status !== 'Paid') return cur;
                return { ...cur, status: 'Served', paymentStatus: 'Unpaid', paymentMethod: null, paymentDetails: null, paymentEntries: null, discount: 0, discountLabel: null, discountId: null, discountSource: null, updatedAt: Date.now() };
            })));

            // Analytics transaction — decrement revenue
            await runTransaction(Outlet.ref(`tableAnalytics/${tableId}`), (cur) => {
                cur = cur || { totalOrders: 0, totalRevenue: 0, avgSessionTime: 0, occupancyRate: 0 };
                cur.totalOrders = Math.max(0, (cur.totalOrders || 0) - paidOrders.length);
                cur.totalRevenue = Math.max(0, (cur.totalRevenue || 0) - _effectiveTotal(sess));
                return cur;
            });

            // Revert discount usage if applicable
            const sessDiscountId = sess.discountId;
            const sessDiscountValue = sess.discount;
            if (sessDiscountId && sessDiscountValue > 0) {
                try {
                    await recordDiscountUsage({ discountId: sess.discountId, orderId: representativeOrderId, customerPhone: '', amountGiven: -sess.discount, channel: 'pos', discountLabel: sess.discountLabel, discountSource: sess.discountSource, globalLimit: sess.discountGlobalLimit, isVoid: true });
                    await _bumpCustomerDiscountUsage(customerPhone, sess.discountId, sess.discountSource, true);
                } catch (e) { console.warn('[Tables] recordDiscountUsage void failed:', e?.message || e); }
            }

            if (_drawerTableId === tableId) _closeTableDrawer();
            closeTableBillReview();
            showToast(`Table payment voided — ${paidOrders.length} order(s) reverted to Served`, 'success');
            haptic(30);
        } catch (e) {
            showToast('Failed to void table payment: ' + (e?.message || e), 'error');
        }
} catch (e) {
            showToast('Failed to void payment: ' + (e?.message || e), 'error');
        }
    }

// ---------------------------------------------------------------------
// WALKOUT AUDIT TRAIL — Track dine-in customers who leave without paying
// ---------------------------------------------------------------------
/**
 * Records a walkout event when a dine-in customer leaves without paying.
 * Called when a session is closed/expired with unpaid orders, or when
 * staff manually marks a walkout.
 * @param {string} tableId - Table ID
 * @param {string} sessionId - Session ID
 * @param {Object} opts - { reason: string, orders: Array, subtotal: number, walkedOutAt: timestamp }
 */
export async function recordWalkout(tableId, sessionId, { reason = 'Walkout', orders = [], subtotal = 0, walkedOutAt = Date.now() }) {
    const t = _tables[tableId];
    if (!t) { showToast('Table not found', 'error'); return; }

    const sessionRef = Outlet.ref(`tableSessions/${sessionId}`);
    try {
        const walkoutId = push(Outlet.ref('logs/walkouts')).key;
        const walkoutData = {
            walkoutId,
            tableId,
            sessionId,
            tableNumber: t.number,
            reason,
            subtotal,
            orders: orders.map(o => ({ id: o.id, total: o.total, status: o.status })),
            walkedOutAt,
            createdAt: Date.now(),
            recordedBy: (window.currentUser?.uid || 'system'),
            outlet: Outlet.current || 'pizza'
        };

        const updates = {};
        updates[`logs/walkouts/${walkoutId}`] = walkoutData;
        // Mark session as walkout
        updates[`tableSessions/${sessionId}/walkout`] = { walkoutId, reason, walkedOutAt };

        await Outlet.ref('').update(updates);
        showToast(`Walkout recorded for Table ${t.number} (₹${subtotal.toLocaleString()})`, 'warning');
        logAudit('Walkout', `Walkout recorded for Table ${t.number}`, Outlet.current);
        return walkoutId;
    } catch (e) {
        console.error('[Walkout] Record failed:', e);
        showToast('Failed to record walkout: ' + (e?.message || e), 'error');
        return null;
    }
}

/**
 * Auto-detect potential walkouts when session expires with unpaid orders.
 * Called by session expiry logic.
 */
export async function checkAndRecordWalkout(tableId, sessionId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;

    // Check if session has unpaid orders that were served/delivered
    const orders = _ordersForSession(sess.sessionId || t.currentSession);
    const unpaidServed = orders.filter(o =>
        o.status === 'Served' || o.status === 'Delivered'
    ).filter(o => o.paymentStatus !== 'Paid');

    if (unpaidServed.length === 0) return;

    const subtotal = unpaidServed.reduce((sum, o) => sum + Number(o.total || 0), 0);
    if (subtotal <= 0) return;

    const walkoutId = await recordWalkout(tableId, sessionId, {
        reason: 'Session expired with unpaid orders',
        orders: unpaidServed,
        subtotal,
        walkedOutAt: Date.now()
    });

    // Mark orders as walkout
    const now = Date.now();
    const updates = {};
    unpaidServed.forEach(o => {
        if (o.status !== 'Cancelled') {
            const updates = { status: 'Walkout', paymentStatus: 'Walkout', walkoutRecordedAt: Date.now() };
            Object.keys(updates).forEach(k => { /* handled below */ });
        }
    });

    await Outlet.ref('').update(updates);
    return walkoutId;
}

// ---------------------------------------------------------------------
// ACTIONS — Order status advance (writes the SAME /orders node)

window.__tables = {
    recordWalkout,
    checkAndRecordWalkout
};