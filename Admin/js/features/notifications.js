import { state } from '../state.js';
import { escapeHtml, playNotificationSound } from '../utils.js';

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
        const outletIcon = order.outlet === 'cake' ? '🎂' : '🍕';
        
        // Calculate item count from any format (cart, items, or single item)
        const cartItems = order.cart ? (Array.isArray(order.cart) ? order.cart : Object.values(order.cart)) : null;
        const itemsList = cartItems || (order.items ? (Array.isArray(order.items) ? order.items : Object.values(order.items)) : []);
        const itemCount = itemsList.length || (order.item ? 1 : 0);

        div.innerHTML = `
            <div class="alert-content" data-action="switchTab" data-tab="orders">
                <div class="alert-title">${outletIcon} New Order #${escapeHtml(orderKey.slice(-5))}</div>
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
export function addNotification(title, sub, type = 'info', outlet = null) {
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
        showNativeNotification(title, sub);
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

    const emptyHtml = '<div class="empty-notif" style="padding:40px; text-align:center; color:#94a3b8; font-size:14px;">No new notifications</div>';

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

function renderNotifItem(n, isFull = false) {
    const outletIcon = n.outlet === 'cake' ? '🎂' : '🍕';
    const typeClass = n.type || 'info';
    
    return `
        <div class="notification-item-v4 ${typeClass} ${isFull ? 'notif-item-full' : ''} p-15 mb-10 br-16">
            <div class="identity-chip-v4 mb-8">
                <div class="kpi-icon-box glass sm" style="width:28px; height:28px; font-size:12px;">
                    <span>${outletIcon}</span>
                </div>
                <div class="identity-info-v4">
                    <span class="name font-700 fs-14">${escapeHtml(n.title)}</span>
                    <span class="sub fs-11">${escapeHtml(n.time)}</span>
                </div>
            </div>
            <div class="notif-sub-v4 fs-13 color-text-muted pl-35">
                ${escapeHtml(n.sub)}
            </div>
        </div>
    `;
}

/**
 * NATIVE OS NOTIFICATIONS
 */
export function showNativeNotification(title, body) {
    if (Notification.permission !== "granted") return;

    const options = {
        body,
        icon: 'icon-erp-logo.jpeg',
        badge: 'icon-erp-logo.jpeg',
        vibrate: [200, 100, 200],
        tag: `order-${Date.now()}`,
        requireInteraction: true
    };

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options);
        });
    } else {
        new Notification(title, options);
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
            rows.forEach(r => { if (r.innerText.includes(orderId.slice(-5))) row = r; });
        }
        if (row) {
            row.classList.add('highlight');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => row.classList.remove('highlight'), 5000);
        }
    }, 120);
}
