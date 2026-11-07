import { state } from '../state.js';
import { escapeHtml, playNotificationSound, formatOrderId, stopContinuousSound, syncAppBadge } from '../utils.js';

/**
 * SHOW ALERT
 * Displays a non-intrusive alert box at the top of the screen.
 * NOTE: Shares #alertContainer with showToast (ui-utils.js). They are visually
 * distinct via .alert-box vs .toast classes; do not collapse the two systems.
 */
export function showAlert(data, type = 'info') {
    const container = document.getElementById('alertContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `alert-box ${type}`;

    if (typeof data === 'string') {
        div.innerHTML = `
            <div class="alert-content">
                <div class="alert-title">${type === "success" ? "✔️" : "ℹ️"} Message</div>
                <div class="alert-sub">${escapeHtml(data)}</div>
            </div>
        `;
        div.onclick = () => div.remove();
    } else {
        const order = data;
        const orderKey = order.orderId || order.id || '----';
        const outletIcon = '🏪';
        
        // Calculate item count from any format (cart, items, or single item)
        const cartItems = order.cart ? (Array.isArray(order.cart) ? order.cart : Object.values(order.cart)) : null;
        const itemsList = cartItems || (order.items ? (Array.isArray(order.items) ? order.items : Object.values(order.items)) : []);
        const itemCount = itemsList.length || (order.item ? 1 : 0);

        div.innerHTML = `
            <div class="alert-content" data-action="switchTab" data-tab="orders">
                <div class="alert-title">${outletIcon} New Order #${escapeHtml(formatOrderId(order.orderId || orderKey))}</div>
                <div class="alert-sub">₹${escapeHtml(order.total)} • ${itemCount} item(s)</div>
            </div>
            <button class="alert-print-btn" data-action="printReceiptById" data-id="${escapeHtml(orderKey)}">🖨️ Print</button>
        `;
        
        // The click delegation in main.js will handle the data-actions.
        // We just need to ensure the alert-box itself is removed.
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.alert-print-btn')) {
                div.remove();
            }
        });
    }

    container.appendChild(div);
    setTimeout(() => { if (div.parentElement) div.remove(); }, 10000); 
}

/**
 * ADD NOTIFICATION
 * Adds a notification to the in-app notification list and triggers sound/OS alerts.
 */
export function addNotification(title, sub, type = 'info', outlet = null, orderKey = null) {
    const notif = {
        id: Date.now(),
        title,
        sub,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type,
        outlet: outlet || state.currentOutlet
    };

    state.notifications.unshift(notif);
    if (state.notifications.length > 50) state.notifications.pop();

    if (state.currentActiveTab !== 'notifications') {
        state.isNotificationPending = true;
    }

    updateNotificationUI();

    if (type === 'new' || type === 'delivered') {
        playNotificationSound();
        // Map in-app type vocabulary (new/delivered) to the SW's color keys
        showNativeNotification(title, sub, orderKey, { type: type === 'new' ? 'new_order' : 'delivered' });
    }
}

/**
 * UPDATE NOTIFICATION UI
 */
export function updateNotificationUI() {
    const badge = document.getElementById('notifBadge');
    const sideBadge = document.getElementById('sidebar-notif-count');
    const list = document.getElementById('notificationList');
    const fullList = document.getElementById('fullNotificationList');

    if (state.notifications.length > 0) {
        if (badge) {
            badge.classList.remove('hidden');
            badge.innerText = `+${state.notifications.length > 9 ? '9' : state.notifications.length}`;
            badge.classList.toggle('pending', state.isNotificationPending);
        }
        if (sideBadge) {
            sideBadge.classList.toggle('hidden', !state.isNotificationPending);
            sideBadge.innerText = state.notifications.length;
        }
    } else {
        if (badge) badge.classList.add('hidden');
        if (sideBadge) sideBadge.classList.add('hidden');
    }

    const emptyHtml = `
        <div class="notif-empty-state">
            <div class="notif-empty-icon">🔔</div>
            <h3>No notifications</h3>
            <p>All caught up — no new alerts.</p>
        </div>
    `;

    if (list) {
        list.innerHTML = state.notifications.length === 0 ? emptyHtml : state.notifications.slice(0, 10).map(n => renderNotifItem(n)).join('');
    }

    if (fullList) {
        fullList.innerHTML = state.notifications.length === 0 ? emptyHtml : state.notifications.map(n => renderNotifItem(n, true)).join('');
    }
}

export function updateNotificationSettingsUI() {
    const statusText = document.getElementById('notifPermissionText');
    const btn = document.getElementById('btnEnableNotif');
    if (!statusText || !btn) return;

    if (!("Notification" in window)) {
        statusText.innerText = "Unsupported Browser";
        btn.disabled = true;
        return;
    }

    if (Notification.permission === "granted") {
        statusText.innerText = "Permission: Active ✔️ ";
        btn.innerHTML = '<span>Enabled</span>';
        btn.classList.replace('btn-primary', 'btn-secondary');
        btn.disabled = true;
    } else if (Notification.permission === "denied") {
        statusText.innerText = "Permission: Blocked ❌";
        btn.innerText = "Blocked in Settings";
        btn.disabled = true;
    } else {
        statusText.innerText = "Permission: Required 🔔";
    }
}

export function testNotification() {
    playNotificationSound();
    if (Notification.permission !== "granted") {
        requestNotificationPermission();
    } else {
        showNativeNotification("Test Alert Successful", "New orders will appear exactly like this!");
    }
}

export function clearAllNotifications() {
    state.notifications = [];
    state.isNotificationPending = false;
    state.unacknowledgedOrders.clear();
    syncAppBadge();
    stopContinuousSound();
    updateNotificationUI();
}

export function toggleNotificationSheet(show) {
    const sheet = document.getElementById('notificationSheet');
    const overlay = document.getElementById('notificationOverlay');
    if (!sheet || !overlay) return;

    if (show === false || sheet.classList.contains('active')) {
        sheet.classList.remove('active');
        overlay.classList.remove('active');
    } else {
        sheet.classList.add('active');
        overlay.classList.add('active');
        // Don't auto-clear pending — sound continues until order is confirmed
        updateNotificationUI();
        
        // Push state so back button closes the sheet
        history.pushState({ action: 'closeUI', target: 'notifications' }, "", window.location.hash);
    }
}

// Listen for browser back button to close notification sheet
window.addEventListener('popstate', (e) => {
    if (e.state?.action === 'closeUI' && e.state?.target === 'notifications') {
        toggleNotificationSheet(false);
    }
});

const NOTIF_ICONS = {
    new_order: '🛒',
    delivered: '✅',
    served: '🍽️',
    ready: '📦',
    info: 'ℹ️',
    promo: '🎁',
    cancelled: '❌',
    refunded: '💰',
};

function notifIcon(type) {
    return NOTIF_ICONS[type] || NOTIF_ICONS.info;
}

function notifColorClass(type) {
    const map = {
        new_order: 'new',
        delivered: 'delivered',
        served: 'delivered',
        ready: 'ready',
        info: 'info',
        promo: 'promo',
        cancelled: 'cancelled',
        refunded: 'refunded',
    };
    return map[type] || 'info';
}

function renderNotifItem(n, isFull = false) {
    const type = n.type || 'info';
    const colorClass = notifColorClass(type);
    const icon = notifIcon(type);
    const readClass = n.read ? 'notif-read' : 'notif-unread';
    
    return `
        <div class="notification-item-v4 ${colorClass} ${isFull ? 'notif-item-full' : ''} ${readClass} notification-card"
             data-notif-id="${escapeHtml(String(n.id || ''))}"
             data-notif-type="${escapeHtml(type)}"
             tabindex="0"
             role="button"
             aria-label="${escapeHtml(n.title)}. ${escapeHtml(n.sub || '')}"
             aria-checked="${n.read ? 'true' : 'false'}">
            <div class="notif-card-icon ${colorClass}">
                <span class="notif-card-icon-emoji">${icon}</span>
            </div>
            <div class="notif-card-body">
                <div class="notif-card-header flex justify-between items-baseline mb-6">
                    <h4 class="notif-card-title ${colorClass}">${escapeHtml(n.title)}</h4>
                    <span class="notif-card-time">${escapeHtml(n.time || '')}</span>
                </div>
                <div class="notif-card-text">${escapeHtml(n.sub || '')}</div>
            </div>
            ${!n.read ? `<div class="notif-card-dot"></div>` : ''}
        </div>
    `;
}

/**
 * NATIVE OS NOTIFICATIONS
 */
export function showNativeNotification(title, body, orderKey = null, meta = {}) {
    if (Notification.permission !== "granted") return;

    const NOTIF_COLORS = { new_order: '#d93025', delivered: '#188038', served: '#188038', ready: '#f9ab00', info: '#1a73e8', promo: '#7b1fa2' };
    const type = meta.type || 'info';
    const options = {
        body,
        icon: 'icon-erp-logo.jpeg',
        badge: 'badge.png',
        color: NOTIF_COLORS[type],
        vibrate: [200, 100, 200],
        // Stable per-order tag shared with sw.js onBackgroundMessage
        // (order-<RTDB key>): Chrome REPLACES the FCM popup with the app's
        // Placed/Delivered update for the same order instead of stacking
        // two popups, and repeated statuses never pile up in Action Center.
        // Promos use a fixed tag so blasts replace instead of piling up.
        tag: orderKey ? `order-${orderKey}` : (type === 'promo' ? 'promo-latest' : `alert-${Date.now()}`),
        requireInteraction: true,
        data: { url: orderKey ? `./index.html?order=${encodeURIComponent(orderKey)}` : './index.html', orderId: orderKey || '' }
    };
    if (meta.image) options.image = meta.image;
    if (orderKey) {
        options.actions = [
            { action: 'view', title: 'View Order' },
            { action: 'confirm', title: 'Mark Confirmed' }
        ];
    }

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options).catch(e => console.warn('Notification failed:', e));
        }).catch(e => console.warn('Notification failed:', e));
    } else {
        try {
            new Notification(title, options);
        } catch (e) {
            console.warn('Notification failed:', e);
        }
    }
}

export async function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    updateNotificationSettingsUI();
    if (permission === "granted") {
        showNativeNotification("Notifications Enabled", "You will now receive order alerts.");
    }
}

export function highlightOrder(orderId) {
    setTimeout(() => {
        let row = document.getElementById(`row-${orderId}`);
        if (!row) {
            const rows = document.querySelectorAll('tr');
            rows.forEach(r => { if (r.innerText.includes(formatOrderId(orderId))) row = r; });
        }
        if (row) {
            row.classList.add('highlight');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => row.classList.remove('highlight'), 5000);
        }
    }, 120);
}

/**
 * Bind click delegation for Admin notification cards.
 * Clicking a card marks it as read and refreshes the badge/sheet.
 */
function bindNotificationCardClicks() {
    document.body.addEventListener('click', (e) => {
        const card = e.target.closest('.notification-card');
        if (!card) return;
        const notifId = card.getAttribute('data-notif-id');
        if (!notifId) return;
        const notif = state.notifications.find(n => String(n.id) === notifId);
        if (notif && !notif.read) {
            notif.read = true;
            updateNotificationUI();
        }
    });
}

// Initialise click delegation once at module load.
bindNotificationCardClicks();
