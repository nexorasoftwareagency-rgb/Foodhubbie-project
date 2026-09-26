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
import { showToast, showConfirm, showDeleteConfirm } from '../ui-utils.js';
import { printOrderReceipt } from './printing.js';
import { haptic, escapeHtml, playNotificationSound, logAudit, formatOrderId, gateManualDiscountPin, gateManagerPin } from '../utils.js';
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
                return { name, phone, registeredAt: Date.now(), orderCount: 1, totalSpent: total, lastSeen: Date.now(), lastAddress: tableLabel };
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
            <span class="live-order-id">#${escapeHtml(formatOrderId(o.orderId || o.id))}</span>
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
}

// ---------------------------------------------------------------------
// RENDER: Kitchen Display System (KDS) — 3-column grid: Confirm | Preparing | Ready
// ---------------------------------------------------------------------
function _elapsedLabel(createdAt) {
    const diff = Math.max(0, Date.now() - _ms(createdAt));
    return `${Math.floor(diff / 60000)}:${_pad2(Math.floor((diff % 60000) / 1000))}`;
}

/** Build item lines with size for kitchen card */
function _kdsItemLines(o) {
    return Object.values(o.items || {}).map(it => {
        const size = it.size && it.size !== 'Regular' ? ` (${escapeHtml(it.size)})` : '';
        const addons = it.addons && it.addons.length ? ` + ${escapeHtml(it.addons.join(', '))}` : '';
        return `<div class="kitchen-item-line">${it.qty || 1} × ${escapeHtml(it.name || 'Item')}${size}${addons}</div>`;
    }).join('');
}

/** Source badge for kitchen card */
function _sourceBadge(o) {
    const isOnline = o.type === 'Online' || o.source === 'webview_delivery';
    const isDineIn = o.type === 'Dine-in' || o.source === 'QR';
    const isPOS = o.type === 'Walk-in' || o.source === 'POS';
    if (isOnline) return '<span class="source-badge source-online">ONLINE</span>';
    if (isDineIn) {
        const t = _tables[o.tableId];
        const tNum = t ? escapeHtml(t.number) : (o.table || '--');
        return `<span class="source-badge source-dinein">TABLE ${tNum}</span>`;
    }
    if (isPOS) return '<span class="source-badge source-pos">POS</span>';
    return '<span class="source-badge">—</span>';
}

/** Kitchen card for an order — rectangular box with items + one-click action */
function _kitchenCard(o) {
    const st = o.status || 'Placed';
    const orderId = escapeHtml(formatOrderId(o.orderId || o.id));
    const elapsed = _elapsedLabel(o.createdAt);
    const timeStr = new Date(o.createdAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const itemsHtml = _kdsItemLines(o);
    const sourceHtml = _sourceBadge(o);

    // Determine action button based on current status
    let actionBtn = '';
    if (st === 'Placed') {
        actionBtn = `<button class="kitchen-btn kitchen-btn-confirm" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Confirmed">
            <i data-lucide="check" class="icon-14"></i> MARK CONFIRM
        </button>`;
    } else if (st === 'Confirmed' || st === 'Preparing') {
        actionBtn = `<button class="kitchen-btn kitchen-btn-preparing" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Ready">
            <i data-lucide="chef-hat" class="icon-14"></i> MARK READY
        </button>`;
    } else if (st === 'Ready') {
        actionBtn = `<button class="kitchen-btn kitchen-btn-ready" data-action="advanceTableOrder" data-id="${escapeHtml(o.id)}" data-next="Served">
            <i data-lucide="check-check" class="icon-14"></i> MARK SERVED
        </button>`;
    }

    // Urgency classes based on elapsed time
    const mins = Math.floor((Date.now() - _ms(o.createdAt)) / 60000);
    const urgentCls = mins >= 15 ? 'kitchen-card-urgent' : (mins >= 8 ? 'kitchen-card-warn' : '');

    return `
    <div class="kitchen-card ${urgentCls}" data-order-id="${escapeHtml(o.id)}" data-status="${st}">
        <div class="kitchen-card-header">
            <span class="kitchen-order-id">#${orderId}</span>
            ${sourceHtml}
        </div>
        <div class="kitchen-card-items">${itemsHtml}</div>
        <div class="kitchen-card-footer">
            <span class="kitchen-elapsed" data-created-at="${_ms(o.createdAt)}">${elapsed}</span>
            <span class="kitchen-time">${timeStr}</span>
        </div>
        <div class="kitchen-card-action">${actionBtn}</div>
    </div>`;
}

/** Render all three columns as responsive grids (3 cards per row) */
function _renderKDS() {
    const newCol = document.getElementById('kdsColumnNew');
    const prepCol = document.getElementById('kdsColumnPreparing');
    const readyCol = document.getElementById('kdsColumnReady');
    if (!newCol || !prepCol || !readyCol) return;

    // Get all active orders, prioritize: Online first, then by createdAt desc (newest first)
    const allOrders = _dineInOrders().sort((a, b) => {
        const aOnline = a.type === 'Online' || a.source === 'webview_delivery';
        const bOnline = b.type === 'Online' || b.source === 'webview_delivery';
        if (aOnline !== bOnline) return aOnline ? -1 : 1; // Online first
        return _ms(b.createdAt) - _ms(a.createdAt); // Newest first
    });

    const groups = { New: [], Confirmed: [], Ready: [] };
    allOrders.forEach(o => {
        const st = o.status || 'Placed';
        if (st === 'Placed') groups.New.push(o);
        else if (st === 'Confirmed' || st === 'Preparing') groups.Confirmed.push(o);
        else if (st === 'Ready') groups.Ready.push(o);
    });

    const fill = (col, list, emptyMsg) => {
        col.innerHTML = list.length
            ? `<div class="kitchen-grid">${list.map(_kitchenCard).join('')}</div>`
            : `<p class="text-muted-small kds-empty">${emptyMsg}</p>`;
    };
    fill(newCol, groups.New, 'No orders to confirm');
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
            // Auto-record walkout if there were unpaid served orders
            if (linkedTable) {
                checkAndRecordWalkout(linkedTable.id, id).catch(() => {});
            }
        }
    }
}

function _tickKDS() {
    document.querySelectorAll('.kitchen-elapsed').forEach(el => {
        const created = Number(el.getAttribute('data-created-at')) || Date.now();
        el.textContent = _elapsedLabel(created);
        const mins = Math.floor((Date.now() - created) / 60000);
        const card = el.closest('.kitchen-card');
        if (card) {
            card.classList.toggle('kitchen-card-warn', mins >= 8 && mins < 15);
            card.classList.toggle('kitchen-card-urgent', mins >= 15);
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
            <span>#${escapeHtml(formatOrderId(o.orderId || o.id))}</span>
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
                btns.push(`<button class="btn-action-orange btn-small" data-action="makePaymentForGroup" data-id="${escapeHtml(t.id)}" data-group-id="${escapeHtml(g.id)}"><i data-lucide="receipt" class="icon-14"></i> View Bill ${escapeHtml(g.label)}</button>`);
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
        const unpaidServed = activeOrders.filter(o => o.status === 'Served' && o.paymentStatus !== 'Paid');
        if (unpaidServed.length > 0) {
            const sessId = sess.sessionId || sess.currentSession;
            btns.push(`<button class="btn-text text-warning btn-small" data-action="recordWalkout" data-id="${escapeHtml(t.id)}" data-session-id="${escapeHtml(sessId)}"><i data-lucide="user-x" class="icon-14"></i> Record Walkout</button>`);
        }
    } else {
        btns.push(`<button class="btn-action-orange btn-small" data-action="makePaymentForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="receipt" class="icon-14"></i> View Bill</button>`);
        btns.push(`<button class="btn-action-green btn-small" data-action="closeSessionForTable" data-id="${escapeHtml(t.id)}"><i data-lucide="check-check" class="icon-14"></i> Close Table (Paid)</button>`);
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
 }

let _renderAllRafId = null;
async function _renderAll() {
    if (_renderAllRafId) return;
    _renderAllRafId = requestAnimationFrame(async () => {
        _renderAllRafId = null;
        _renderKpis();
        _renderFloorGrid();
        _renderLiveOrdersList();
        _renderKDS();
        await _renderTableDrawer();
        await _renderRequestsBanner();
        try { await loadLucide(); } catch (_) {}
        if (window.lucide) window.lucide.createIcons();
    });
}

function _flushRenderAll() {
    if (_renderAllRafId) {
        cancelAnimationFrame(_renderAllRafId);
        _renderAllRafId = null;
    }
    _renderKpis();
    _renderFloorGrid();
    _renderLiveOrdersList();
    _renderKDS();
    _renderTableDrawer();
    _renderRequestsBanner();
    loadLucide().then(() => { if (window.lucide) window.lucide.createIcons(); });
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
        if (_drawerTableId === id) { _drawerTableId = null; _flushRenderAll(); }
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
    _flushRenderAll();
    haptic(10);
}
function _closeTableDrawer() {
    _drawerTableId = null;
    _flushRenderAll();
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
// - Table billing passes channel:'table' to the evaluator, and
//   discountAllowsChannel() maps a 'pos'-scoped discount onto it — a
//   POS-only offer covers bills settled at the terminal. Usage is recorded
//   as channel:'table', but the discount editor can't author a 'table'
//   value and discountsReports.js buckets those rows under "Other". If you
//   want table-billing redemptions tracked separately from walk-in in the
//   P&L reports, that's the place to start.
//
// - Category discounts work here: _billCart() supplies the cart, and order
//   items that carry no category (QR orders are written with name/qty/price
//   only) are backfilled from the dish list cached when the bill opened.
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
let _billDine = {};         // dineinSettings cache for tax/SC labels on invoice
let _billContact = {};      // tableSessionsContact cache (customerName/customerPhone)
let _billDishCategory = {}; // dish name → category name (QR order items carry no category)
let _billReviewConnUnsub = null; // connection change unsubscribe for bill review modal
let _billSplitActive = false;
let _billSplitMethod = 'Cash'; // which method the primary input controls

// Persist/load split method preference
const SPLIT_METHOD_KEY = 'foodhubbie_split_method';
function _saveSplitMethod(method) {
    try { sessionStorage.setItem(SPLIT_METHOD_KEY, method); } catch (_) {}
}
function _loadSplitMethod() {
    try { return sessionStorage.getItem(SPLIT_METHOD_KEY) || 'Cash'; } catch (_) { return 'Cash'; }
}

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
        discountLabel = 'Manual Discount';
    } else if (_billManualDiscountPct > 0) {
        discountValue = Math.round((subtotal * _billManualDiscountPct) / 100);
        discountSource = MANUAL_DISCOUNT_SOURCES.PERCENT;
        discountId = 'manual:percent';
        discountLabel = 'Manual Discount';
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

// Complete price breakdown for the invoice — derived from the active orders
// (order-time truth: taxItems/serviceCharge are baked into each o.total),
// with dineinSettings only as label/fallback for legacy orders.
// Identity: food + tax + sc − orderDiscount === Σ o.total (console.warn if not).
function _billBreakdown(activeOrders) {
    let food = 0, tax = 0, sc = 0, orderDiscount = 0;
    let scName = '', scRate = 0;
    const taxMap = new Map();
    const labels = new Set();
    activeOrders.forEach(o => {
        food += Number(o.subtotal || 0);
        tax += Number(o.tax || 0);
        sc += Number(o.serviceCharge || 0);
        orderDiscount += Number(o.discount || 0);
        if (o.discountLabel) labels.add(o.discountLabel);
        if (o.serviceChargeName && !scName) { scName = o.serviceChargeName; scRate = Number(o.serviceChargeRate || 0); }
        (Array.isArray(o.taxItems) ? o.taxItems : []).forEach(ti => {
            const k = `${ti.name}|${ti.rate}`;
            const cur = taxMap.get(k) || { name: ti.name, rate: ti.rate, amount: 0 };
            cur.amount += Number(ti.amount || 0);
            taxMap.set(k, cur);
        });
    });
    // Legacy orders missing subtotal → derive from item lines
    if (food === 0 && activeOrders.length) {
        activeOrders.forEach(o => Object.values(o.items || {}).forEach(it => {
            food += Number(it.qty || 1) * Number(it.price || 0);
        }));
    }
    let taxRows = Array.from(taxMap.values());
    if (!taxRows.length && food > 0 && tax > 0) {
        const d = _billDine || {};
        const rates = (d.taxRates && d.taxRates.length) ? d.taxRates
            : (d.taxEnabled !== false ? [{ name: d.taxName || 'Tax', rate: typeof d.taxRate === 'number' ? d.taxRate : 5 }] : []);
        taxRows = rates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(food * (r.rate / 100) * 100) / 100 })).filter(r => r.amount > 0);
    }
    if (!scName && sc > 0) {
        scName = (_billDine || {}).serviceChargeName || 'Service Charge';
        scRate = Number((_billDine || {}).serviceChargeRate || 0);
    }
    const ordersTotal = activeOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    if (activeOrders.length && Math.abs(food + tax + sc - orderDiscount - ordersTotal) > 1) {
        console.warn('[Bill] breakdown identity mismatch', { food, tax, sc, orderDiscount, ordersTotal });
    }
    return { food, taxRows, sc, scName, scRate, orderDiscount, orderLabels: Array.from(labels), ordersTotal };
}

export async function openTableBillReview(tableId, groupId = null) {
    _billTableId = tableId;
    _billGroupId = groupId || null;
    _billManualDiscount = 0;
    _billManualDiscountPct = 0;
    _billAutoDiscount = null;
    _billCouponCode = null;
    _billDine = {};
    _billContact = {};
    _billSplitActive = false;
    _billSplitMethod = _loadSplitMethod();
    _clearTableBillCouponUI();
    document.getElementById('tableBillOffersPanel')?.classList.add('hidden');

    // Cache dine settings + customer contact for the invoice breakdown (awaited so first render is complete)
    const _sid = _sessionForTable(tableId)?.sessionId || _tables[tableId]?.currentSession;
    const [_dineSnap, _contactSnap, _dishesSnap] = await Promise.all([
        get(_settingsRef()).catch(() => null),
        _sid ? get(Outlet.ref(`tableSessionsContact/${_sid}`)).catch(() => null) : Promise.resolve(null),
        get(Outlet.ref('dishes')).catch(() => null)
    ]);
    if (_dineSnap?.exists()) _billDine = _dineSnap.val() || {};
    if (_contactSnap?.exists()) _billContact = _contactSnap.val() || {};
    // QR order items are written with {name, qty, price} only — no category —
    // so category discounts couldn't see them. Build the dish→category lookup
    // used by _billCart to backfill. Works for already-placed orders too.
    _billDishCategory = {};
    if (_dishesSnap?.exists()) {
        Object.values(_dishesSnap.val() || {}).forEach(d => {
            if (d && d.name) _billDishCategory[d.name] = d.category || '';
        });
    }

    // Reset split section
    document.getElementById('billSplitSection')?.classList.add('hidden');
    document.getElementById('billSplitToggle')?.classList.remove('active');

    // Reset payment method buttons
    document.querySelectorAll('.bill-pay-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === 'Cash');
    });

    // Reset discount inputs
    const amtInput = document.getElementById('tableBillDiscountAmt');
    if (amtInput) amtInput.value = 0;
    const pctInput = document.getElementById('tableBillDiscountPct');
    if (pctInput) pctInput.value = 0;

    _renderTableBillReview();
    document.getElementById('tableBillReviewModal')?.classList.add('active');
    loadLucide();

    // Offline banner handling for bill review modal
    if (!_billReviewConnUnsub) {
        _billReviewConnUnsub = onConnectionChange((online) => {
            const banner = document.getElementById('tableBillOfflineBanner');
            const proceedBtn = document.getElementById('billConfirmBtn');
            if (banner) banner.classList.toggle('hidden', online);
            if (proceedBtn) proceedBtn.disabled = !online;
        });
    }
    // Initial state
    const isOnline = isConnected();
    const banner = document.getElementById('tableBillOfflineBanner');
    const proceedBtn = document.getElementById('billConfirmBtn');
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
    const sess = _sessionForTable(_billTableId);
    const subtotal = _billSubtotal();
    const { discountValue, discountLabel, discountSource } = _billComputedDiscount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountValue);

    // Title
    const title = document.getElementById('tableBillReviewTitle');
    if (title) {
        const groupLabel = _billGroupId ? (sess?.orderGroups?.[_billGroupId]?.label || 'Group') : null;
        title.textContent = groupLabel ? `Table ${t.number} — ${groupLabel}` : `Table ${t.number} — Payment`;
    }

    // === LEFT: Invoice ===
    const tableLabel = document.getElementById('billInvoiceTableLabel');
    if (tableLabel) {
        const base = _billGroupId ? `Table ${t.number} — ${sess?.orderGroups?.[_billGroupId]?.label || 'Group'}` : `Table ${t.number}`;
        tableLabel.textContent = _billContact.customerName ? `${base} · ${_billContact.customerName}` : base;
    }
    const dateEl = document.getElementById('billInvoiceDate');
    if (dateEl) {
        let d = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        if (_billContact.customerPhone) d += ` · ${_billContact.customerPhone}`;
        dateEl.textContent = d;
    }

    // Items
    const orders = _billGroupId
        ? _ordersForGroup(sess.sessionId, _billGroupId)
        : _ordersForSession(sess.sessionId || t.currentSession);
    const activeOrders = orders.filter(o => o.status !== 'Cancelled');
    const itemsEl = document.getElementById('billInvoiceItems');
    if (itemsEl) {
        const itemRows = [];
        activeOrders.forEach(o => {
            Object.values(o.items || {}).forEach(it => {
                const qty = Number(it.qty || 1);
                const price = Number(it.price || 0);
                const lineTotal = qty * price;
                const meta = [it.size, it.addon].filter(Boolean).join(' · ');
                itemRows.push(`<div class="bill-invoice-item">
                    <div class="bill-invoice-item-name">
                        <span class="bill-invoice-item-qty">${qty}×</span>
                        <span class="bill-invoice-item-name-text">${escapeHtml(it.name || 'Item')}</span>
                        ${meta ? `<div class="bill-invoice-item-meta">${escapeHtml(meta)}</div>` : ''}
                    </div>
                    <span class="bill-invoice-item-price">₹${lineTotal.toLocaleString('en-IN')}</span>
                </div>`);
            });
        });
        itemsEl.innerHTML = itemRows.length ? itemRows.join('') : '<p class="text-muted-small" style="padding:16px;text-align:center;">No items</p>';
    }

    // Summary — complete breakdown: food → taxes → SC → order discounts → bill discount → total
    const summaryEl = document.getElementById('billInvoiceSummary');
    if (summaryEl) {
        const bd = _billBreakdown(activeOrders);
        const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
        const rows = [];
        rows.push(`<div class="bill-invoice-summary-row"><span>Subtotal (${activeOrders.length} order${activeOrders.length !== 1 ? 's' : ''})</span><span>${money(bd.food)}</span></div>`);
        bd.taxRows.forEach(tr => rows.push(`<div class="bill-invoice-summary-row"><span>${escapeHtml(tr.name)} (${tr.rate}%)</span><span>${money(tr.amount)}</span></div>`));
        if (bd.sc > 0) rows.push(`<div class="bill-invoice-summary-row"><span>${escapeHtml(bd.scName || 'Service Charge')}${bd.scRate ? ` (${bd.scRate}%)` : ''}</span><span>${money(bd.sc)}</span></div>`);
        if (bd.orderDiscount > 0) rows.push(`<div class="bill-invoice-summary-row" style="color:#059669;"><span>Discount${bd.orderLabels.length ? ` (${escapeHtml(bd.orderLabels.join(', '))})` : ''}</span><span>-${money(bd.orderDiscount)}</span></div>`);
        if (discountValue > 0) {
            let dl = discountLabel || (String(discountSource || '').startsWith('manual:') ? 'Manual Discount' : 'Discount');
            if (_billCouponCode) dl = `${dl} (${_billCouponCode})`;
            rows.push(`<div class="bill-invoice-summary-row" style="color:#059669;"><span>${escapeHtml(dl)}</span><span>-${money(discountValue)}</span></div>`);
        }
        rows.push(`<div class="bill-invoice-summary-row total"><span>Total</span><span>${money(finalTotal)}</span></div>`);
        summaryEl.innerHTML = rows.join('');
    }

    // === RIGHT: Payment panel ===
    // Total
    const totalEl = document.getElementById('billTotalAmount');
    if (totalEl) totalEl.textContent = `₹${finalTotal.toLocaleString('en-IN')}`;

    // Reset split state
    _billSplitActive = false;
    // Don't reset _billSplitMethod — keep user's preference
    const splitSection = document.getElementById('billSplitSection');
    if (splitSection) splitSection.classList.add('hidden');
    const splitToggle = document.getElementById('billSplitToggle');
    if (splitToggle) splitToggle.classList.remove('active');

    // Reset payment method buttons
    document.querySelectorAll('.bill-pay-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.method === _billSplitMethod);
    });

    // Update summary — mirror the complete breakdown from the left panel
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const bd = _billBreakdown(activeOrders);
    setText('billSummarySubtotal', `₹${bd.food.toLocaleString('en-IN')}`);
    const taxWrap = document.getElementById('billSummaryTaxRows');
    if (taxWrap) {
        taxWrap.innerHTML = bd.taxRows.map(tr =>
            `<div class="bill-summary-row"><span>${escapeHtml(tr.name)} (${tr.rate}%)</span><span>₹${Number(tr.amount).toLocaleString('en-IN')}</span></div>`
        ).join('');
    }
    const scRow = document.getElementById('billSummarySCRow');
    if (scRow) {
        scRow.classList.toggle('hidden', !(bd.sc > 0));
        setText('billSummarySCLabel', `${bd.scName || 'Service Charge'}${bd.scRate ? ` (${bd.scRate}%)` : ''}`);
        setText('billSummarySCVal', `₹${bd.sc.toLocaleString('en-IN')}`);
    }
    const odRow = document.getElementById('billSummaryOrderDiscRow');
    if (odRow) {
        odRow.classList.toggle('hidden', !(bd.orderDiscount > 0));
        setText('billSummaryOrderDiscLabel', bd.orderLabels.length ? `Discount (${bd.orderLabels.join(', ')})` : 'Order Discounts');
        setText('billSummaryOrderDiscVal', `-₹${bd.orderDiscount.toLocaleString('en-IN')}`);
    }
    const discRow = document.getElementById('billSummaryDiscountRow');
    if (discountValue > 0) {
        discRow?.classList.remove('hidden');
        let dl = discountLabel || (String(discountSource || '').startsWith('manual:') ? 'Manual Discount' : 'Discount');
        if (_billCouponCode) dl = `${dl} (${_billCouponCode})`;
        setText('billSummaryDiscountLabel', dl);
        setText('billSummaryDiscountVal', `-₹${discountValue.toLocaleString('en-IN')}`);
    } else {
        discRow?.classList.add('hidden');
    }
    setText('billSummaryTotal', `₹${finalTotal.toLocaleString('en-IN')}`);
}

// ---------------------------------------------------------------------
// Smart Split Payment
// ---------------------------------------------------------------------
function _getBillFinalTotal() {
    const subtotal = _billSubtotal();
    const { discountValue } = _billComputedDiscount(subtotal);
    return Math.max(0, subtotal - discountValue);
}

function _renderSplitInputs() {
    const total = _getBillFinalTotal();
    const primaryInput = document.getElementById('billSplitPrimaryAmt');
    const secondaryInput = document.getElementById('billSplitSecondaryAmt');
    const primaryLabel = document.getElementById('billSplitPrimaryLabel');
    const secondaryLabel = document.getElementById('billSplitSecondaryLabel');
    const remainingEl = document.getElementById('billSplitRemaining');
    if (!primaryInput || !secondaryInput) return;

    const primary = _billSplitMethod;
    const secondary = primary === 'Cash' ? 'UPI' : 'Cash';
    if (primaryLabel) primaryLabel.textContent = primary;
    if (secondaryLabel) secondaryLabel.textContent = secondary;

    const primaryAmt = Number(primaryInput.value) || 0;
    const secondaryAmt = Math.max(0, total - primaryAmt);
    secondaryInput.value = secondaryAmt;
    if (remainingEl) {
        const remaining = total - primaryAmt - secondaryAmt;
        remainingEl.textContent = remaining === 0 ? 'Full amount covered' : `₹${remaining.toLocaleString('en-IN')} remaining`;
        remainingEl.style.color = remaining === 0 ? '#16a34a' : '#ef4444';
    }
}

export function toggleBillSplit() {
    _billSplitActive = !_billSplitActive;
    const section = document.getElementById('billSplitSection');
    const toggle = document.getElementById('billSplitToggle');
    if (section) section.classList.toggle('hidden', !_billSplitActive);
    if (toggle) toggle.classList.toggle('active', _billSplitActive);

    if (_billSplitActive) {
        const total = _getBillFinalTotal();
        const primaryInput = document.getElementById('billSplitPrimaryAmt');
        if (primaryInput) primaryInput.value = total;
        _renderSplitInputs();
    }
}

export function adjustBillSplit(target, delta) {
    const total = _getBillFinalTotal();
    const primaryInput = document.getElementById('billSplitPrimaryAmt');
    if (!primaryInput) return;

    let current = Number(primaryInput.value) || 0;
    current = Math.max(0, Math.min(total, current + delta));
    primaryInput.value = current;
    _renderSplitInputs();
}

export function onBillSplitInput() {
    const total = _getBillFinalTotal();
    const primaryInput = document.getElementById('billSplitPrimaryAmt');
    if (!primaryInput) return;
    let val = Number(primaryInput.value) || 0;
    val = Math.max(0, Math.min(total, val));
    primaryInput.value = val;
    _renderSplitInputs();
}

function _collectPaymentEntries() {
    const total = _getBillFinalTotal();
    if (!_billSplitActive) {
        // Full payment — default to Cash
        const activeBtn = document.querySelector('.bill-pay-btn.active');
        const method = activeBtn?.dataset?.method || 'Cash';
        return [{ method, amount: total }];
    }
    // Split payment
    const primaryInput = document.getElementById('billSplitPrimaryAmt');
    const primaryAmt = Number(primaryInput?.value) || 0;
    const secondaryAmt = total - primaryAmt;
    const entries = [];
    if (primaryAmt > 0) entries.push({ method: _billSplitMethod, amount: primaryAmt });
    if (secondaryAmt > 0) entries.push({ method: _billSplitMethod === 'Cash' ? 'UPI' : 'Cash', amount: secondaryAmt });
    return entries;
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
                    category: it.category || _dishCategoryFor(it.name),
                    categoryId: it.categoryId || '',
                    size: it.size || '',
                    addon: it.addon || ''
                });
            }
        });
    });
    return cart;
}

// POS-origin order items already carry `category`; QR-origin ones don't.
// Resolve via the dish list cached when the bill opened. The QR menu
// appends " (Large)" to the display name, so strip one trailing group
// when the exact name misses.
function _dishCategoryFor(name) {
    if (!name || !_billDishCategory) return '';
    const exact = _billDishCategory[name];
    if (exact != null) return exact;
    const stripped = name.replace(/\s*\([^)]*\)$/, '');
    return stripped === name ? '' : (_billDishCategory[stripped] || '');
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
    if (!panel) return;
    const opening = panel.classList.contains('hidden');
    if (!opening) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
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
    const list = await getEligibleOffersForDisplay(all, { channel: 'table', cart, includeNonMatchingCategories: true });

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
            const cat = (state.categories || []).find(c => c.id === id);
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
    applyTableBillCoupon();
}

async function _bumpCustomerDiscountUsage(phone, discountId, discountSource, isVoid) {
    if (!phone || !discountId) return;
    try {
        const isFirstOrderDiscount = discountSource === 'firstOrder' && discountId;
        await runTransaction(Outlet.ref(`customers/${phone}`), (cur) => {
            if (cur === null) return cur;
            if (isFirstOrderDiscount && !isVoid) {
                cur.firstOrderDiscountUsed = Date.now();
                cur.firstOrderDiscountId = discountId;
            }
            cur.discountUsage = cur.discountUsage || {};
            // This function is only ever called from table-billing flows, so
            // every call here IS a table-channel redemption. Bump both the
            // flat/global counter AND the table-specific sub-counter —
            // discount-evaluator.js's per-customer-limit check reads
            // discountUsage.table[discountId] for table channel specifically,
            // but nothing was ever writing to it, making that half of its
            // AND-check permanently a no-op (always read as 0, always under
            // any positive limit). The flat counter alone was carrying the
            // actual enforcement; this makes the table-specific check real.
            cur.discountUsage.table = cur.discountUsage.table || {};
            if (isVoid) {
                cur.discountUsage[discountId] = Math.max(0, (cur.discountUsage[discountId] || 0) - 1);
                cur.discountUsage.table[discountId] = Math.max(0, (cur.discountUsage.table[discountId] || 0) - 1);
            } else {
                cur.discountUsage[discountId] = (cur.discountUsage[discountId] || 0) + 1;
                cur.discountUsage.table[discountId] = (cur.discountUsage.table[discountId] || 0) + 1;
            }
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

    // Approval ceiling: a manual discount above settings/Security/discountCeilingPct
    // needs a manager PIN before any payment is taken.
    if (!await gateManualDiscountPin({ discountValue, subtotal, discountId })) return;

    // Use Firebase connection state (reliable) instead of navigator.onLine
    if (!isConnected()) {
        showToast('You are offline. Please reconnect to process payment.', 'warning');
        return;
    }

    const paymentEntries = _collectPaymentEntries();
    if (!paymentEntries || paymentEntries.length === 0) return;

    const { phone: customerPhone, orderId: representativeOrderId } = _billCustomerPhoneAndOrderId();
    const now = Date.now();

    // Primary payment method (first entry) for order/group records
    const primaryMethod = paymentEntries[0].method;
    const paymentDetails = paymentEntries.map(e => `${e.method} ₹${e.amount}`).join(' + ');

    if (groupId) {
        // GROUP PAYMENT — atomic multi-path update
        const gOrders = sess.orderGroups[groupId]?.orders || [];
        const updates = {};
        gOrders.forEach(oid => {
            if (_orders[oid] && _orders[oid].status !== 'Cancelled') {
                updates[`orders/${oid}/paymentMethod`] = primaryMethod;
                updates[`orders/${oid}/paymentStatus`] = 'Paid';
                updates[`orders/${oid}/updatedAt`] = now;
            }
        });
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/status`] = 'paid';
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paidAt`] = now;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentMethod`] = primaryMethod;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentDetails`] = paymentDetails;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentEntries`] = paymentEntries;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/subtotal`] = subtotal;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discount`] = discountValue;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountId`] = discountId || null;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountLabel`] = discountLabel || null;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountSource`] = discountSource || null;
        updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paidAmount`] = finalTotal;

        try {
            await Outlet.multiUpdate(updates);
            if (discountId && discountValue > 0) {
                await recordDiscountUsage({ discountId, orderId: representativeOrderId, customerPhone, amountGiven: discountValue, channel: 'table', discountLabel, discountSource, globalLimit: discountGlobalLimit });
                await _bumpCustomerDiscountUsage(customerPhone, discountId, discountSource, false);
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
    const orderCount = (sess.orders || []).length;
    const mins = _sessionElapsedMinutes(sess);

    orders.forEach(o => {
        if (o.id && o.status !== 'Cancelled') {
            updates[`orders/${o.id}/paymentMethod`] = primaryMethod;
            updates[`orders/${o.id}/paymentStatus`] = 'Paid';
            updates[`orders/${o.id}/updatedAt`] = now;
        }
    });
    updates[`tableSessions/${sess.sessionId}/status`] = 'closed';
    updates[`tableSessions/${sess.sessionId}/closedAt`] = now;
    updates[`tableSessions/${sess.sessionId}/paymentMethod`] = primaryMethod;
    updates[`tableSessions/${sess.sessionId}/paymentDetails`] = paymentDetails;
    updates[`tableSessions/${sess.sessionId}/paymentEntries`] = paymentEntries;
    updates[`tableSessions/${sess.sessionId}/paidAt`] = now;
    updates[`tableSessions/${sess.sessionId}/subtotal`] = subtotal;
    updates[`tableSessions/${sess.sessionId}/discount`] = discountValue;
    updates[`tableSessions/${sess.sessionId}/discountId`] = discountId || null;
    updates[`tableSessions/${sess.sessionId}/discountLabel`] = discountLabel || null;
    updates[`tableSessions/${sess.sessionId}/discountSource`] = discountSource || null;
    updates[`tableSessions/${sess.sessionId}/paidAmount`] = finalTotal;
    updates[`tables/${tableId}/status`] = 'free';
    updates[`tables/${tableId}/currentSession`] = null;
    updates[`tables/${tableId}/updatedAt`] = now;

    try {
        await Outlet.multiUpdate(updates);
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
                await recordDiscountUsage({ discountId, orderId: representativeOrderId, customerPhone, amountGiven: discountValue, channel: 'table', discountLabel, discountSource, globalLimit: discountGlobalLimit });
            } catch (e) { console.warn('[Tables] recordDiscountUsage failed:', e?.message || e); }
            await _bumpCustomerDiscountUsage(customerPhone, discountId, discountSource, false);
        }
        if (_drawerTableId === tableId) _closeTableDrawer();
        closeTableBillReview();
        showToast(`Table closed — ₹${finalTotal.toLocaleString('en-IN')} via ${paymentDetails}`, 'success');
        haptic(30);
    } catch (e) {
        showToast('Payment failed: ' + (e?.message || e), 'error');
    }
}

// ---------------------------------------------------------------------
// VOID/REFUND — Revert a paid bill back to billing

export async function voidTableBill(tableId, groupId = null) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { showToast('Table or session not found', 'error'); return; }

    const ok = await showConfirm(
        `Void the payment and reopen the ${groupId ? 'group bill' : 'table bill'}? Orders will be reverted to Served status. Discount usage will be reverted. This action cannot be undone.`,
        'Void Payment'
    );
    if (!ok) return;

    // Every void reverses money already taken, so the manager PIN is required
    // unconditionally — no ceiling applies here. Same fail-open rules as the
    // discount gate: only cancel or a wrong PIN aborts.
    if (!await gateManagerPin({
        message: `Authorise voiding this ${groupId ? 'group bill' : 'table bill'}. This cannot be undone.`,
        auditAction: 'void.pin.approved',
        auditDetails: { tableId, groupId: groupId || 'session' }
    })) return;

    try {
        const { phone: customerPhone, orderId: representativeOrderId } = _billCustomerPhoneAndOrderId();
        const now = Date.now();

        // Group void
        if (groupId) {
            const group = sess.orderGroups?.[groupId];
            if (!group || group.status !== 'paid') {
                showToast('Group is not in paid state', 'warning');
                return;
            }
            const groupOrders = (group.orders || []).map(id => _orders[id]).filter(Boolean);
            const updates = {};
            // NOTE: order-level fields (status/paymentStatus/paymentMethod/etc.)
            // are deliberately NOT set here — the per-order runTransaction
            // below is the sole, correct writer for those. A redundant write
            // here previously set paymentStatus to 'Served' (not a valid
            // payment-status value — that belongs in the order's `status`
            // field, never touched by this map at all). Harmless when the
            // transaction after it succeeds (it overwrites this), but left
            // orders in a genuinely inconsistent state on a partial failure
            // between the two writes.
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/status`] = 'billing';
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paidAt`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentMethod`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentDetails`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paymentEntries`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discount`] = 0;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountId`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountLabel`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/discountSource`] = null;
            updates[`tableSessions/${sess.sessionId}/orderGroups/${groupId}/paidAmount`] = 0;

            try {
                await Outlet.multiUpdate(updates);
                // Revert orders to Served
                await Promise.all(groupOrders.map(o => runTransaction(Outlet.ref(`orders/${o.id}`), (cur) => {
                    if (!cur || cur.status !== 'Paid') return cur;
                    return { ...cur, status: 'Served', paymentStatus: 'Unpaid', paymentMethod: null, paymentDetails: null, paymentEntries: null, discount: 0, discountLabel: null, discountId: null, discountSource: null, updatedAt: now };
                })));

                // Revert discount usage
                const g = sess.orderGroups[groupId];
                if (g?.discountId && g.discount > 0) {
                    try {
                        await recordDiscountUsage({ discountId: g.discountId, orderId: representativeOrderId, customerPhone: '', amountGiven: -g.discount, channel: 'table', discountLabel: g.discountLabel, discountSource: g.discountSource, globalLimit: g.discountGlobalLimit, isVoid: true });
                        await _bumpCustomerDiscountUsage(customerPhone, g.discountId, g.discountSource, true);
                    } catch (e) { console.warn('[Tables] recordDiscountUsage void failed:', e?.message || e); }
                }

                if (_drawerTableId === tableId) _closeTableDrawer();
                closeTableBillReview();
                showToast(`${group.label || 'Group'} payment voided — orders reverted to Served`, 'success');
                haptic(30);
            } catch (e) {
                showToast('Failed to void group payment: ' + (e?.message || e), 'error');
            }
            return;
        }

        // Full table void
        const paidOrders = _ordersForSession(sess.sessionId).filter(o => o.id && o.status === 'Paid');
        if (paidOrders.length === 0) {
            showToast('No paid orders to void', 'warning');
            return;
        }
        const tableOrderCount = (sess.orders || []).length;
        const subtotal = _effectiveTotal(sess);
        // P2-8: reverse analytics by what full-table payment actually credited.
        // Group-only sessions never hit tableAnalytics (group pay skips it) — only
        // reverse when paidAmount is set, or legacy closed sessions without it.
        const paidAmt = Number(sess.paidAmount) || 0;
        const analyticsBack = paidAmt > 0 ? paidAmt
            : (sess.status === 'closed' ? Math.max(0, subtotal - Number(sess.discount || 0)) : 0);
        const updates = {};
        // NOTE: same fix as the group-void branch above — order-level
        // fields are written exclusively by the per-order runTransaction
        // below, not here. See that comment for why.
        updates[`tableSessions/${sess.sessionId}/status`] = 'billing';
        updates[`tableSessions/${sess.sessionId}/closedAt`] = null;
        updates[`tableSessions/${sess.sessionId}/paymentMethod`] = null;
        updates[`tableSessions/${sess.sessionId}/paymentDetails`] = null;
        updates[`tableSessions/${sess.sessionId}/paymentEntries`] = null;
        updates[`tableSessions/${sess.sessionId}/paidAt`] = null;
        updates[`tableSessions/${sess.sessionId}/subtotal`] = subtotal;
        updates[`tableSessions/${sess.sessionId}/discount`] = 0;
        updates[`tableSessions/${sess.sessionId}/discountId`] = null;
        updates[`tableSessions/${sess.sessionId}/discountLabel`] = null;
        updates[`tableSessions/${sess.sessionId}/discountSource`] = null;
        updates[`tableSessions/${sess.sessionId}/paidAmount`] = 0;
        updates[`tables/${tableId}/status`] = 'billing';
        updates[`tables/${tableId}/currentSession`] = sess.sessionId;
        updates[`tables/${tableId}/updatedAt`] = now;

        try {
            await Outlet.multiUpdate(updates);
            await Promise.all(paidOrders.map(o => runTransaction(Outlet.ref(`orders/${o.id}`), (cur) => {
                if (!cur || cur.status !== 'Paid') return cur;
                return { ...cur, status: 'Served', paymentStatus: 'Unpaid', paymentMethod: null, paymentDetails: null, paymentEntries: null, discount: 0, discountLabel: null, discountId: null, discountSource: null, updatedAt: now };
            })));
            await runTransaction(Outlet.ref(`tableAnalytics/${tableId}`), (p) => {
                p = p || { totalOrders: 0, totalRevenue: 0, avgSessionTime: 0, occupancyRate: 0 };
                p.totalOrders = Math.max(0, (p.totalOrders || 0) - paidOrders.length);
                p.totalRevenue = Math.max(0, (p.totalRevenue || 0) - analyticsBack);
                return p;
            });

            const discountId = sess.discountId;
            const discountAmt = sess.discount;
            if (discountId && discountAmt > 0) {
                try {
                    await recordDiscountUsage({ discountId: sess.discountId, orderId: representativeOrderId, customerPhone: '', amountGiven: -sess.discount, channel: 'table', discountLabel: sess.discountLabel, discountSource: sess.discountSource, globalLimit: sess.discountGlobalLimit, isVoid: true });
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
// WALKOUT — Record unpaid walkouts

export async function recordWalkout(tableId, sessionId, { reason = 'Walkout', orders = [], subtotal = 0, walkedOutAt = Date.now() } = {}) {
    const t = _tables[tableId];
    if (!t) { showToast('Table not found', 'error'); return; }
    const sessRef = Outlet.ref(`tableSessions/${sessionId}`);

    try {
        const walkoutId = push(Outlet.ref('logs/walkouts')).key;
        const walkoutData = {
            walkoutId, tableId, sessionId, tableNumber: t.number,
            reason, subtotal,
            orders: orders.map(o => ({ id: o.id, total: o.total, status: o.status })),
            walkedOutAt, createdAt: Date.now(),
            recordedBy: window.currentUser?.uid || 'system',
            outlet: Outlet.current
        };

        const updates = {};
        // Outlet-relative paths + multiUpdate (tenantRef): outlet-level logs rules
        // live at businesses/{bid}/outlets/{oid}/logs. Outlet.ref('') returns the
        // ROOT ref and 'logs' is in Outlet's globalPaths — writing there hit
        // root /logs/walkouts which has no write rule (P0-4 PERMISSION_DENIED).
        updates[`logs/walkouts/${walkoutId}`] = walkoutData;
        updates[`tableSessions/${sessionId}/walkout`] = { walkoutId, reason, walkedOutAt };

        await Outlet.multiUpdate(updates);
        showToast(`Walkout recorded for Table ${t.number} (₹${subtotal.toLocaleString()})`, 'warning');
        haptic(20);
        return walkoutId;
    } catch (e) {
        console.error('[Walkout] Record failed:', e);
        showToast('Failed to record walkout: ' + (e?.message || e), 'error');
        return null;
    }
}

export async function checkAndRecordWalkout(tableId, sessionId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) return;

    const unpaidServed = _ordersForSession(sessionId || sess.sessionId)
        .filter(o => o.status === 'Served' || o.status === 'Delivered')
        .filter(o => o.paymentStatus !== 'Paid');

    if (unpaidServed.length === 0) return;

    const subtotal = unpaidServed.reduce((sum, o) => sum + Number(o.total || 0), 0);
    if (subtotal <= 0) return;

    const walkoutId = await recordWalkout(tableId, sessionId || sess.sessionId, {
        reason: 'Session expired with unpaid orders',
        orders: unpaidServed,
        subtotal,
        walkedOutAt: Date.now()
    });

    const now = Date.now();
    const updates = {};
    unpaidServed.forEach(o => {
        if (o.status !== 'Cancelled') {
            // Outlet-relative (multiUpdate prefixes businesses/{bid}/outlets/{oid}/).
            // Old keys `outlets/${Outlet.current}/orders/...` against Outlet.ref('')
            // (root) wrote to /outlets/{outlet}/orders — wrong path entirely.
            updates[`orders/${o.id}/status`] = 'Walkout';
            updates[`orders/${o.id}/paymentStatus`] = 'Walkout';
            updates[`orders/${o.id}/walkoutRecordedAt`] = now;
        }
    });

    await Outlet.multiUpdate(updates);
    return walkoutId;
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
            'Ready': ['Served', 'Cancelled'],
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
    const shortId = formatOrderId(orderId);
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
    let contact = {};
    try { contact = (await get(Outlet.ref(`tableSessionsContact/${sessionId}`))).val() || {}; } catch (_) {}
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
    let orderTax = 0, orderSC = 0, ordersTotal = 0;
    const allItems = [];
    const taxMap = new Map();
    groupOrders.forEach(o => {
        Object.values(o.items || {}).forEach(it => {
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            allItems.push({ name: it.name || 'Item', qty, price, size: it.size || '', addon: it.addon || '' });
            subtotal += price * qty;
        });
        orderTax += Number(o.tax || 0);
        orderSC += Number(o.serviceCharge || 0);
        ordersTotal += Number(o.total || 0);
        (Array.isArray(o.taxItems) ? o.taxItems : []).forEach(ti => {
            const k = `${ti.name}|${ti.rate}`;
            const cur = taxMap.get(k) || { name: ti.name, rate: ti.rate, amount: 0 };
            cur.amount += Number(ti.amount || 0);
            taxMap.set(k, cur);
        });
    });
    // M3: tax rows from order-time taxItems (settings only as legacy fallback)
    let taxItems = Array.from(taxMap.values());
    if (!taxItems.length) taxItems = taxRates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(subtotal * (r.rate / 100) * 100) / 100 }));
    const tax = taxItems.reduce((s, t) => s + t.amount, 0) || orderTax;
    const serviceCharge = orderSC || (scEnabled ? Math.round(subtotal * (scRate / 100) * 100) / 100 : 0);
    const groupDiscount = groupOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);
    // Include bill-level discount from payment modal (stored on group)
    const billDiscount = Number(g.discount || 0);
    const billDiscountLabel = g.discountLabel || null;
    // M1: NET PAYABLE must equal charged amount — paidAmount (post-payment) else Σ order totals − bill discount
    const paidAmount = Number(g.paidAmount || 0);
    const grandTotalAfterDiscount = paidAmount > 0 ? paidAmount : Math.max(0, ordersTotal - billDiscount);
    const scName = groupOrders.find(o => o.serviceChargeName)?.serviceChargeName || dine.serviceChargeName || 'Service Charge';
    const scRateVal = groupOrders.find(o => o.serviceChargeRate)?.serviceChargeRate ?? scRate;
    const discLabels = [...new Set([...groupOrders.map(o => o.discountLabel).filter(Boolean), billDiscount > 0 ? billDiscountLabel : null].filter(Boolean))];
    await printOrderReceipt({
        orderId: `TABLE-${t.number}-${g.label.replace(/\s/g, '')}`,
        type: 'Dine-in', items: allItems,
        total: grandTotalAfterDiscount, subtotal, tax, taxItems,
        taxName: taxItems.map(ti => ti.name).join(' + ') || taxRates.map(r => r.name).join(' + ') || 'Tax',
        serviceCharge,
        serviceChargeName: scName,
        serviceChargeRate: scRateVal,
        discount: groupDiscount + billDiscount, deliveryFee: 0,
        discountLabel: discLabels.length ? discLabels.join(' + ') : undefined,
        tableNo: String(t.number),
        createdAt: sess.openedAt || Date.now(),
        paymentMethod: g.paymentMethod || 'Cash',
        status: 'Delivered',
        customerName: contact.customerName || `Table ${t.number} · ${g.label}`,
        phone: contact.customerPhone || contact.guestPhone || ''
    }, true);
}

async function _printSessionBill(tableId) {
    const t = _tables[tableId];
    const sess = _sessionForTable(tableId);
    if (!t || !sess) { showToast('No active session to print', 'warning'); return; }

    const sessionId = sess.sessionId || t.currentSession;
    let contact = {};
    try { contact = (await get(Outlet.ref(`tableSessionsContact/${sessionId}`))).val() || {}; } catch (_) {}
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
    const activeOrders = orders.filter(o => o.status !== 'Cancelled');

    let subtotal = 0;
    let orderTax = 0, orderSC = 0, orderDiscount = 0;
    const allItems = [];
    const taxMap = new Map();
    activeOrders.forEach(o => {
        Object.values(o.items || {}).forEach(it => {
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            allItems.push({ name: it.name || 'Item', qty, price, size: it.size || '', addon: it.addon || '' });
            subtotal += price * qty;
        });
        orderTax += Number(o.tax || 0);
        orderSC += Number(o.serviceCharge || 0);
        orderDiscount += Number(o.discount || 0);
        (Array.isArray(o.taxItems) ? o.taxItems : []).forEach(ti => {
            const k = `${ti.name}|${ti.rate}`;
            const cur = taxMap.get(k) || { name: ti.name, rate: ti.rate, amount: 0 };
            cur.amount += Number(ti.amount || 0);
            taxMap.set(k, cur);
        });
    });

    // M3: tax rows from order-time taxItems (settings only as legacy fallback)
    let taxItems = Array.from(taxMap.values());
    if (!taxItems.length) taxItems = taxRates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(subtotal * (r.rate / 100) * 100) / 100 }));
    const tax = taxItems.reduce((s, t) => s + t.amount, 0) || orderTax;
    const serviceCharge = orderSC || (scEnabled ? Math.round(subtotal * (scRate / 100) * 100) / 100 : 0);
    // M1: NET PAYABLE must equal charged amount — paidAmount (post-payment) else Σ order totals
    const paidAmount = Number(sess.paidAmount || 0);
    const grandTotal = paidAmount > 0 ? paidAmount : _effectiveTotal(sess);
    // M2: sess.discount is Σ per-order discounts pre-payment but bill-discount post-payment — only count as bill discount once paid
    const billDiscount = paidAmount > 0 ? Number(sess.discount || 0) : 0;
    const billDiscountLabel = paidAmount > 0 ? (sess.discountLabel || null) : null;
    const scName = activeOrders.find(o => o.serviceChargeName)?.serviceChargeName || dine.serviceChargeName || 'Service Charge';
    const scRateVal = activeOrders.find(o => o.serviceChargeRate)?.serviceChargeRate ?? scRate;
    const discLabels = [...new Set([...activeOrders.map(o => o.discountLabel).filter(Boolean), billDiscount > 0 ? billDiscountLabel : null].filter(Boolean))];

    const combinedOrder = {
        orderId: `TABLE-${t.number}`,
        type: 'Dine-in',
        items: allItems,
        total: grandTotal, subtotal, tax, taxItems,
        taxName: taxItems.map(ti => ti.name).join(' + ') || taxRates.map(r => r.name).join(' + ') || 'Tax',
        serviceCharge,
        serviceChargeName: scName,
        serviceChargeRate: scRateVal,
        discount: orderDiscount + billDiscount, deliveryFee: 0,
        discountLabel: discLabels.length ? discLabels.join(' + ') : undefined,
        tableNo: String(t.number),
        createdAt: sess.openedAt || Date.now(),
        paymentMethod: sess.paymentMethod || 'Cash',
        status: 'Delivered',
        customerName: contact.customerName || `Table ${t.number}`,
        phone: contact.customerPhone || contact.guestPhone || ''
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
                <div class="qr-store-name">🏪 ${escapeHtml(storeName)}</div>
                <div class="qr-tagline">DINE-IN MENU</div>
            </div>
            <div class="qr-body">
                <div class="qr-table-label">TABLE</div>
                <div class="qr-table-number">${escapeHtml(String(tableNumber))}</div>
                <div class="qr-scan-cta">📷                 <div class="qr-scan-cta">📷 Scan & Crave</div>
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
    const poweredByClean = (poweredBy || '').replace(/^powered\s+by\s+/i, '').trim();
    const cards = [];
    for (const t of tables) {
        const url = await _qrUrlForTable(t);
        const dataUri = await _qrDataUri(url, 250);
        cards.push({ t, dataUri });
    }
    // 2 BIG cards per A4 landscape page — inline styles, no CSS class conflicts
    const cardHtml = ({ num, src }) => {
        const footer = poweredByClean
            ? `<div style="border-top:2px dashed #f3cba8;margin:12px 20px 0;"></div><div style="padding:8px 20px 14px;font-size:11px;color:#b97a4e;font-weight:600;">Powered by <b style="color:#E84908;">${escapeHtml(poweredByClean)}</b></div>`
            : '';
        return `<div style="display:inline-block;vertical-align:top;width:38%;margin:3%;background:linear-gradient(135deg,#FFB347,#E84908 55%,#C81D11);border-radius:26px;padding:6px;page-break-inside:avoid;">
            <div style="background:#fff;border-radius:22px;overflow:hidden;text-align:center;font-family:-apple-system,'Segoe UI',sans-serif;">
                <div style="background:linear-gradient(135deg,#FF8A3D,#E84908);color:#fff;padding:20px 18px 18px;">
                    <div style="font-size:22px;font-weight:900;text-transform:uppercase;line-height:1.2;">${escapeHtml(storeName)}</div>
                    <div style="font-size:11px;opacity:.92;margin-top:4px;font-weight:700;letter-spacing:.12em;">DINE-IN MENU</div>
                </div>
                <div style="padding:24px 20px 20px;">
                    <div style="font-size:13px;font-weight:800;color:#E84908;letter-spacing:.14em;">TABLE</div>
                    <div style="font-size:52px;font-weight:900;color:#1a1a1a;line-height:1;margin:4px 0 16px;">${escapeHtml(String(num))}</div>
                    <div style="font-size:14px;font-weight:800;color:#C81D11;margin-bottom:16px;">Scan & Crave</div>
                    <div style="display:inline-block;padding:12px;background:#fff7ed;border:3px solid #FFB347;border-radius:16px;">
                        <img src="${src}" width="250" height="250" style="display:block;">
                    </div>
                </div>
                ${footer}
            </div>
        </div>`;
    };
    // Pair cards into rows of 2, page-break between rows
    let rowsHtml = '';
    for (let i = 0; i < cards.length; i += 2) {
        const pair = cards.slice(i, i + 2);
        const rowCards = pair.map(c => cardHtml({ num: c.t.number, src: c.dataUri })).join('');
        const pageBreak = i + 2 < cards.length ? 'page-break-after:always;' : '';
        rowsHtml += `<div style="text-align:center;${pageBreak}">${rowCards}</div>`;
    }
    const w = window.open('', '_blank', 'width=960,height=700');
    w.document.write(`<html><head><title>Bulk QR Print — ${escapeHtml(storeName)}</title><style>
        @page{size:A4 landscape;margin:8mm;}
        *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{font-family:-apple-system,'Segoe UI',sans-serif;background:#fef3e8;}
        @media print{body{background:#fff;}}
        </style></head><body>${rowsHtml}
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

function _wireBillReviewModal() {
    // Wire up payment method buttons (once)
    const methodsWrap = document.getElementById('billPaymentMethods');
    if (methodsWrap && !methodsWrap.dataset.wired) {
        methodsWrap.dataset.wired = '1';
        methodsWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.bill-pay-btn');
            if (!btn) return;
            document.querySelectorAll('.bill-pay-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (_billSplitActive) {
                _billSplitMethod = btn.dataset.method;
                _saveSplitMethod(_billSplitMethod);
                _renderSplitInputs();
            }
        });
    }

    // Wire up split toggle (once)
    const splitToggle = document.getElementById('billSplitToggle');
    if (splitToggle && !splitToggle.dataset.wired) {
        splitToggle.dataset.wired = '1';
        splitToggle.addEventListener('click', () => toggleBillSplit());
    }

    // Wire up split +/- buttons and input (once)
    const splitSection = document.getElementById('billSplitSection');
    if (splitSection && !splitSection.dataset.wired) {
        splitSection.dataset.wired = '1';
        splitSection.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="billSplitMinus"], [data-action="billSplitPlus"]');
            if (!btn) return;
            const delta = btn.dataset.action === 'billSplitPlus' ? 100 : -100;
            adjustBillSplit(btn.dataset.target, delta);
        });
        const primaryInput = document.getElementById('billSplitPrimaryAmt');
        if (primaryInput) primaryInput.addEventListener('input', () => onBillSplitInput());
    }

    // Wire up click-outside-to-close
    const modal = document.getElementById('tableBillReviewModal');
    if (modal && !modal.dataset.outsideWired) {
        modal.dataset.outsideWired = '1';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeTableBillReview();
        });
    }

    // Wire up discount inputs (once)
    const amtInput = document.getElementById('tableBillDiscountAmt');
    if (amtInput && !amtInput.dataset.listener) {
        amtInput.dataset.listener = '1';
        amtInput.addEventListener('input', (e) => setTableBillDiscount(parseFloat(e.target.value) || 0));
    }
    const pctInput = document.getElementById('tableBillDiscountPct');
    if (pctInput && !pctInput.dataset.listener) {
        pctInput.dataset.listener = '1';
        pctInput.addEventListener('input', (e) => setTableBillDiscountPct(parseFloat(e.target.value) || 0));
    }

    // Wire up coupon input
    const couponInput = document.getElementById('tableBillCouponCode');
    if (couponInput && !couponInput.dataset.listener) {
        couponInput.dataset.listener = '1';
        couponInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyTableBillCoupon();
            }
        });
    }

    // Wire up coupon clear button
    const couponClear = document.getElementById('tableBillCouponClearBtn');
    if (couponClear && !couponClear.dataset.listener) {
        couponClear.dataset.listener = '1';
        couponClear.addEventListener('click', clearTableBillCoupon);
    }

    // Wire up offers toggle
    const offersBtn = document.querySelector('.bill-offers-btn');
    if (offersBtn && !offersBtn.dataset.listener) {
        offersBtn.dataset.listener = '1';
        offersBtn.addEventListener('click', toggleTableBillOffersPanel);
    }

    // Wire up confirm button
    const confirmBtn = document.getElementById('billConfirmBtn');
    if (confirmBtn && !confirmBtn.dataset.listener) {
        confirmBtn.dataset.listener = '1';
        confirmBtn.addEventListener('click', confirmTableBillPayment);
    }

    // Wire up retry button
    const retryBtn = document.getElementById('tableBillRetryConnection');
    if (retryBtn && !retryBtn.dataset.listener) {
        retryBtn.dataset.listener = '1';
        retryBtn.addEventListener('click', () => {
            if (isConnected()) {
                confirmBtn.disabled = false;
                document.getElementById('tableBillOfflineBanner')?.classList.add('hidden');
            } else {
                showToast('Still offline. Please check your connection.', 'warning');
            }
        });
    }

    // ===== KEYBOARD SUPPORT FOR SPLIT PAYMENT CONTROLS =====
    // Make all interactive elements focusable
    document.querySelectorAll('.bill-pay-btn, .bill-split-qty-btn, .bill-split-toggle, #billSplitPrimaryAmt')
        .forEach(el => { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); });

    // Payment method buttons: ArrowLeft/Right to switch, Enter/Space to select
    const payBtns = document.querySelectorAll('.bill-pay-btn');
    payBtns.forEach((btn, idx) => {
        if (btn.dataset.kbdWired) return;
        btn.dataset.kbdWired = '1';
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                const next = payBtns[(idx + 1) % payBtns.length];
                next.focus();
                next.click();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = payBtns[(idx - 1 + payBtns.length) % payBtns.length];
                prev.focus();
                prev.click();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.click();
            }
        });
    });

    // Split toggle: Enter/Space to toggle
    const splitToggleBtn = document.getElementById('billSplitToggle');
    if (splitToggleBtn && !splitToggleBtn.dataset.kbdWired) {
        splitToggleBtn.dataset.kbdWired = '1';
        splitToggleBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleBillSplit();
            }
        });
    }

    // Split +/- buttons: ArrowUp/Down for increment/decrement
    const qtyBtns = document.querySelectorAll('.bill-split-qty-btn');
    qtyBtns.forEach(btn => {
        if (btn.dataset.kbdWired) return;
        btn.dataset.kbdWired = '1';
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                const delta = btn.dataset.action === 'billSplitPlus' ? 100 : -100;
                adjustBillSplit(btn.dataset.target, delta);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const delta = btn.dataset.action === 'billSplitPlus' ? -100 : 100;
                adjustBillSplit(btn.dataset.target, delta);
            }
        });
    });

    // Primary amount input: ArrowUp/Down for increment/decrement
    const primaryAmtInput = document.getElementById('billSplitPrimaryAmt');
    if (primaryAmtInput && !primaryAmtInput.dataset.kbdWired) {
        primaryAmtInput.dataset.kbdWired = '1';
        primaryAmtInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                adjustBillSplit('primary', 100);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                adjustBillSplit('primary', -100);
            } else if (e.key === 'Enter') {
                onBillSplitInput();
            }
        });
    }

    // Trap focus in modal (basic)
    if (modal && !modal.dataset.focusTrap) {
        modal.dataset.focusTrap = '1';
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                const focusable = modal.querySelectorAll(
                    'button, input, select, [tabindex]:not([tabindex="-1"])'
                );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            } else if (e.key === 'Escape') {
                closeTableBillReview();
            }
        });
    }
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
                case 'recordWalkout': recordWalkout(id, btn.dataset.sessionId, { reason: 'Walkout', orders: [], subtotal: 0 }); break;
                case 'voidTableBill': voidTableBill(id, btn.dataset.groupId); break;
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
        _wireBillReviewModal();
    }
}

window.__tables = {
    openEditor: _openTableEditor,
    delete: _deleteTable, openDrawer: _openTableDrawer, closeDrawer: _closeTableDrawer,
    openQr: _openQrModal, bulkPrint: _bulkQrPrint, exportCsv: _exportTablesCsv,
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
    resolveTableRequest: _resolveTableRequest,
    setTableEnabled: _setTableEnabled,
    closeBillReview: closeTableBillReview,
    applyBillCoupon: applyTableBillCoupon,
    clearBillCoupon: clearTableBillCoupon,
    toggleBillOffers: toggleTableBillOffersPanel,
    applyBillOfferFromPanel: applyTableOfferFromPanel,
    confirmBillPayment: confirmTableBillPayment,
    recordWalkout,
    checkAndRecordWalkout,
    voidTableBill
};
