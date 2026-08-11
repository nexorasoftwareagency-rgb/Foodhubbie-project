import { state } from './state.js';
import { initRealtimeListeners, cleanupOrders } from './features/orders.js';
import { cleanupCatalog } from './features/catalog.js';
import { cleanupRiders } from './features/riders.js';
import { cleanupInventory } from './features/inventory.js';
import { cleanupFeedbacks } from './features/feedback.js';
import { cleanupLiveRiderTracker } from './features/tracker.js';
import { cleanupRiderAnalytics } from './features/rider-analytics.js';
import * as ui from './ui.js';

export function clearStateForOutletSwitch() {
    console.log("[State] Clearing state for outlet isolation...");
    cleanupCatalog();
    cleanupRiders();
    cleanupInventory();
    cleanupOrders();
    cleanupFeedbacks();
    cleanupLiveRiderTracker();
    cleanupRiderAnalytics();

    state.categories = [];
    state.allWalkinDishes = [];
    state.ordersMap.clear();
    state.liveOrdersMap.clear();
    state.lastOrdersSnap = null;
    state.lastDishesSnap = null;
    state.ridersList = [];
    state.riderStatsData = {};
    state.notifications = [];
    state.unacknowledgedOrders.clear();

    const containers = [
        'categoryList', 'menuGrid', 'walkinDishGrid', 'walkinCategoryTabs',
        'ordersTable', 'ordersTableFull', 'liveOrdersTable', 'ridersTable'
    ];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
}

export function updateBranding() {
    const badge = document.getElementById('outletBadge');
    const mobBadge = document.getElementById('mobileOutletBadge');
    const sidebarBrand = document.getElementById('sidebarBrandText');

    const label = state.currentOutlet === 'cake' ? 'CAKES' : 'PIZZA';
    if (badge) badge.innerText = label;
    if (mobBadge) mobBadge.innerText = label;
    if (sidebarBrand) sidebarBrand.innerText = 'ROSHANI ERP';

    document.title = 'Roshani ERP | Admin Dashboard';

    const isPizza = state.currentOutlet !== 'cake';
    const ridersMenu = document.getElementById("menu-riders");
    if (ridersMenu) {
        const isSuper = state.adminData && state.adminData.isSuper;
        ridersMenu.classList.toggle('hidden', !(isPizza || isSuper));
    }
}

export function switchOutlet(val) {
    const isAdmin = state.adminData;
    const canSwitch = isAdmin && (isAdmin.isSuper || isAdmin.isSupreme);

    if (!canSwitch && isAdmin && isAdmin.outlet !== val) {
        console.error("[Security] Unauthorized switch attempt blocked:", val);
        import('./utils.js').then(u => u.showToast("Unauthorized: Access restricted to your assigned outlet", "error"));

        const desktopSwitcher = document.getElementById('outletSwitcher');
        const mobileSwitcher = document.getElementById('outletSwitcherMobile');
        if (desktopSwitcher) desktopSwitcher.value = state.currentOutlet;
        if (mobileSwitcher) mobileSwitcher.value = state.currentOutlet;
        return;
    }

    clearStateForOutletSwitch();
    sessionStorage.setItem('adminSelectedOutlet', val);
    state.currentOutlet = val;
    window.currentOutlet = val;

    const desktopSwitcher = document.getElementById('outletSwitcher');
    const mobileSwitcher = document.getElementById('outletSwitcherMobile');
    if (desktopSwitcher && desktopSwitcher.value !== val) desktopSwitcher.value = val;
    if (mobileSwitcher && mobileSwitcher.value !== val) mobileSwitcher.value = val;

    updateBranding();
    initRealtimeListeners();

    const activeTabId = document.querySelector('.nav-links li.active')?.id.replace('menu-', '') || 'dashboard';
    ui.switchTab(activeTabId);

    console.log("[Branding] Admin switched outlet to:", val);

    document.dispatchEvent(new CustomEvent('switchOutlet', { detail: { outlet: val } }));
}

export function openOutletInNewTab() {
    const brand = state.currentOutlet === 'cake' ? 'pizza' : 'cake';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('brand', brand);
    window.open(url.toString(), '_blank');
}
