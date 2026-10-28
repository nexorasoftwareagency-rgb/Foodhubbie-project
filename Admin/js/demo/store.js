/**
 * FoodHubbie Demo — in-memory store + selectors.
 *
 * The ONLY state container for the demo. Nothing is written to a network, a
 * cookie or a database: mutations touch this object and re-render. Reloading
 * the page (or "Reset demo data") restores the pristine fixture set.
 */

import { buildDemoState } from './demo-data.js';
import { round2 } from '../../shared/money-math.js';
import { computeCostIndex, DEFAULT_RATES } from '../../shared/cost-math.js';

const COMPLETED = new Set(['Delivered', 'Served']);

let data = buildDemoState();
const listeners = new Set();

export function getData() { return data; }

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function commit() {
    for (const fn of listeners) fn(data);
}

export function resetDemo() {
    data = buildDemoState();
    commit();
}

// --- Selectors --------------------------------------------------------------

export const isCompleted = (o) => !!o && COMPLETED.has(o.status);

export function completedOrders(list) {
    return (list || data.orders).filter(isCompleted);
}

export function revenueOf(list) {
    return round2((list || []).reduce((s, o) => s + (Number(o.total) || 0), 0));
}

export function isSameDay(iso, ref = new Date(data.now)) {
    const d = new Date(iso);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

export function todayOrders(list) {
    return (list || data.orders).filter(o => isSameDay(o.createdAt));
}

export function liveOrders(list) {
    const live = new Set(['Pending', 'Placed', 'Confirmed', 'Preparing', 'Cooked', 'Ready', 'Out for Delivery', 'Reached Drop Location']);
    return (list || data.orders).filter(o => live.has(o.status));
}

export function kpis() {
    const today = todayOrders();
    const done = completedOrders(today);
    const yesterday = data.orders.filter(o => {
        const d = new Date(o.createdAt);
        const y = new Date(data.now - 86400000);
        return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate() && isCompleted(o);
    });
    const live = liveOrders();
    return {
        revenue: revenueOf(done),
        yesterdayRevenue: revenueOf(yesterday),
        completedCount: done.length,
        liveCount: live.length,
        inProgress: today.filter(o => ['Preparing', 'Confirmed', 'Placed', 'Pending'].includes(o.status)).length,
        ridersOnline: data.riders.filter(r => r.status === 'Online' || r.status === 'On delivery').length,
        ridersTotal: data.riders.length,
        avgOrder: done.length ? round2(revenueOf(done) / done.length) : 0,
    };
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Last N days (oldest → newest) of completed revenue. */
export function salesByDay(days = 7) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const ref = new Date(data.now - i * 86400000);
        const list = data.orders.filter(o => isSameDay(o.createdAt, ref) && isCompleted(o));
        out.push({
            label: i === 0 ? 'Today' : DAY_LABEL[ref.getDay()],
            date: ref,
            revenue: revenueOf(list),
            orders: list.length,
        });
    }
    return out;
}

export function peakHours() {
    const buckets = Array.from({ length: 24 }, () => 0);
    for (const o of completedOrders()) {
        const h = new Date(o.createdAt).getHours();
        buckets[h] = round2(buckets[h] + (Number(o.total) || 0));
    }
    return buckets;
}

export function topItems(n = 5) {
    const map = new Map();
    for (const o of completedOrders()) {
        for (const it of o.items || []) {
            const b = map.get(it.name) || { qty: 0, revenue: 0 };
            b.qty += it.qty;
            b.revenue = round2(b.revenue + it.qty * it.price);
            map.set(it.name, b);
        }
    }
    return [...map.entries()]
        .map(([name, b]) => ({ name, ...b }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, n);
}

export function topCustomers(n = 5) {
    return [...data.customers].sort((a, b) => b.spend - a.spend).slice(0, n);
}

/** Per-table state derived from the session + its orders. */
export function tableState() {
    return data.tables.map(t => {
        const sess = data.tableSessions[t.id];
        if (!sess) return { ...t, session: null, status: 'available', total: 0, orders: [] };
        const orders = data.orders.filter(o => o.tableId === t.id && o.sessionId === sess.id && o.status !== 'Cancelled');
        return {
            ...t,
            session: sess,
            status: sess.billRequested ? 'bill' : 'occupied',
            total: revenueOf(orders),
            orders,
        };
    });
}

export function paymentsList() {
    return data.orders
        .filter(o => o.paymentStatus === 'Paid')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Software usage cost — the real shared/cost-math.js over the demo orders. */
export function costIndex() {
    const ordersMap = Object.fromEntries(data.orders.map(o => [o.orderId, o]));
    return computeCostIndex(ordersMap, data.billing.rates || DEFAULT_RATES, data.billing.mode);
}

export function lowStock() {
    return data.inventory.filter(i => Number(i.stock) <= Number(i.min));
}

export function last7DayAttendance() {
    return data.attendance;
}

// --- Actions (demo state only) ---------------------------------------------

function findOrder(idOrOrderId) {
    return data.orders.find(o => o.id === idOrOrderId || o.orderId === idOrOrderId);
}

export function setOrderStatus(id, status) {
    const o = findOrder(id);
    if (!o) return false;
    o.status = status;
    if (status === 'Cancelled') o.paymentStatus = 'Pending';
    addNotification('order', `Order #${o.orderId} → ${status}`, `${o.items.length} item(s) · ₹${o.total}`);
    commit();
    return true;
}

export function markOrderPaid(id, method = 'Cash') {
    const o = findOrder(id);
    if (!o) return false;
    o.paymentStatus = 'Paid';
    o.paymentMethod = method;
    commit();
    return true;
}

const KITCHEN_FLOW = ['Placed', 'Confirmed', 'Preparing', 'Cooked', 'Ready', 'Delivered'];

export function advanceOrder(id) {
    const o = findOrder(id);
    if (!o) return false;
    const isDineIn = o.type === 'dine-in';
    const flow = isDineIn ? ['Placed', 'Confirmed', 'Preparing', 'Ready', 'Served'] : KITCHEN_FLOW;
    const i = flow.indexOf(o.status);
    if (i === -1 || i === flow.length - 1) return false;
    return setOrderStatus(id, flow[i + 1]);
}

export function addOrder(order) {
    data.orders.unshift(order);
    addNotification('order', `New order #${order.orderId}`, `${order.items.length} item(s) · ₹${order.total}`);
    commit();
}

export function setDishAvailable(id, available) {
    const d = data.dishes[id];
    if (!d) return;
    d.available = available;
    commit();
}

export function addDish(payload) {
    const id = `d${Object.keys(data.dishes).length + 1}_${Date.now().toString(36).slice(-4)}`;
    data.dishes[id] = {
        id,
        name: payload.name,
        category: payload.category,
        price: Number(payload.price) || 0,
        veg: !!payload.veg,
        desc: payload.desc || '',
        prep: Number(payload.prep) || 10,
        available: true,
        gstRate: 5,
    };
    commit();
    return id;
}

export function deleteDish(id) {
    delete data.dishes[id];
    commit();
}

export function addCategory(name) {
    const id = `c${data.categories.length + 1}_${Date.now().toString(36).slice(-4)}`;
    data.categories.push({ id, name, icon: 'folder', order: data.categories.length + 1, visible: true, desc: 'Added in demo mode' });
    commit();
    return id;
}

export function deleteCategory(id) {
    data.categories = data.categories.filter(c => c.id !== id);
    commit();
}

export function adjustStock(id, delta) {
    const it = data.inventory.find(i => i.id === id);
    if (!it) return;
    it.stock = round2(Math.max(0, Number(it.stock) + Number(delta)));
    data.stockMovements.unshift({
        id: `mv${Date.now()}`,
        item: it.name,
        delta: Number(delta),
        at: 'Just now (demo)',
        reason: 'Manual adjustment (demo)',
    });
    commit();
}

export function addExpense(payload) {
    data.expenses.unshift({
        id: `e${Date.now()}`,
        date: 'Today',
        category: payload.category,
        vendor: payload.vendor,
        amount: Number(payload.amount) || 0,
        method: payload.method || 'Cash',
        status: 'Pending',
        note: payload.note || 'Added in demo mode',
    });
    commit();
}

export function deleteExpense(id) {
    data.expenses = data.expenses.filter(e => e.id !== id);
    commit();
}

export function setExpenseStatus(id, status) {
    const e = data.expenses.find(x => x.id === id);
    if (!e) return;
    e.status = status;
    commit();
}

export function toggleDiscount(id) {
    const d = data.discounts.find(x => x.id === id);
    if (!d) return;
    d.active = !d.active;
    d.window = d.active ? 'Always on' : 'Paused';
    commit();
}

export function addDiscount(payload) {
    data.discounts.unshift({
        id: `ds${Date.now()}`,
        code: payload.code,
        type: payload.type,
        value: Number(payload.value) || 0,
        active: true,
        channel: payload.channel || 'All channels',
        uses: 0,
        cap: Number(payload.cap) || 100,
        minOrder: Number(payload.minOrder) || 0,
        window: 'Always on',
    });
    commit();
}

export function requestBill(tableId) {
    const s = data.tableSessions[tableId];
    if (!s) return;
    s.billRequested = true;
    addNotification('bill', `Bill requested — ${tableId}`, s.guestName);
    commit();
}

export function settleTable(tableId) {
    const sess = data.tableSessions[tableId];
    if (!sess) return;
    for (const o of data.orders) {
        if (o.sessionId === sess.id && o.paymentStatus !== 'Paid' && o.status !== 'Cancelled') {
            o.paymentStatus = 'Paid';
            o.paymentMethod = 'Card';
            if (o.status !== 'Served') o.status = 'Served';
        }
    }
    delete data.tableSessions[tableId];
    addNotification('bill', `${tableId} settled`, 'Session closed — table free');
    commit();
}

export function closeTableSession(tableId) {
    if (!data.tableSessions[tableId]) return;
    delete data.tableSessions[tableId];
    addNotification('system', `${tableId} session closed`, 'Table is free again');
    commit();
}

export function seedTableSession(tableId) {
    if (data.tableSessions[tableId]) return;
    data.tableSessions[tableId] = {
        id: `sess-demo-${Date.now()}`,
        guestName: 'Walk-in guest',
        openedMinsAgo: 0,
        billRequested: false,
        phone: '',
    };
    commit();
}

export function addChatMessage(chatId, text) {
    const chat = data.chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.messages.push({ from: 'restaurant', text, at: 'Now (demo)' });
    chat.unread = 0;
    chat.last = 'Just now';
    commit();
}

export function markAllNotificationsRead() {
    data.notifications.forEach(n => { n.read = true; });
    commit();
}

export function addNotification(type, title, body) {
    data.notifications.unshift({
        id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        type, title, body,
        at: 'Just now (demo)',
        read: false,
    });
    data.notifications = data.notifications.slice(0, 40);
}

export function addAudit(action, detail, actor = 'Demo visitor') {
    data.auditLog.unshift({ at: 'Just now (demo)', actor, action, detail });
    data.auditLog = data.auditLog.slice(0, 50);
}
