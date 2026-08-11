import { haptic } from './utils.js';
import { showToast, showConfirm } from './ui-utils.js';
import { state } from './state.js';
import { toggleNotificationSheet, updateNotificationUI, updateNotificationSettingsUI } from './features/notifications.js';

const _modCache = {};
function mod(name) {
    if (!_modCache[name]) _modCache[name] = import(`./features/${name}.js`);
    return _modCache[name];
}

let _lucidePromise = null;
export async function loadLucide() {
    if (window.lucide) return window.lucide;
    if (!_lucidePromise) {
        _lucidePromise = import('https://unpkg.com/lucide@0.344.0/dist/umd/lucide.min.js')
            .then(() => window.lucide)
            .catch(() => { _lucidePromise = null; throw new Error('Failed to load Lucide'); });
    }
    return _lucidePromise;
}



export const toggleSidebar = () => {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar) return;

    haptic(15);

    if (window.innerWidth > 1024) {
        document.body.classList.toggle('sidebar-collapsed');
    } else {
        const isActive = sidebar.classList.toggle('active');
        document.body.classList.toggle('sidebar-active', isActive);
        if (overlay) overlay.classList.toggle('active', isActive);
        
        if (isActive) {
            history.pushState({ action: 'closeUI', target: 'sidebar' }, "", window.location.hash);
        }
    }
};

export const closeSidebar = () => {
    const sidebar = document.getElementById('sidebarNav');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('sidebar-active');
};


export const switchTab = async (tabId, skipHistory = false) => {
    if (state.currentActiveTab === tabId) {
        window.__adminLogger?.info('NAV', `Tab already active: ${tabId}`);
        return;
    }

    // --- PHASE 3: DIRTY STATE TRACKING ---
    if (state.settingsDirty && state.currentActiveTab === 'settings') {
        const discard = await showConfirm(
            'You have unsaved changes in Settings. Do you want to discard them?',
            'Unsaved Changes'
        );
        
        if (!discard) {
            document.querySelectorAll('.sidebar li, .bottom-nav .nav-item').forEach(el => {
                el.classList.remove('active');
                if (el.id === `menu-${state.currentActiveTab}` || el.getAttribute('data-tab') === state.currentActiveTab) {
                    el.classList.add('active');
                }
            });
            return;
        }
        state.settingsDirty = false;
    }

    const previousTab = state.currentActiveTab;
    state.currentActiveTab = tabId;
    window.__adminLogger?.nav('TAB', `Switching: ${previousTab || '(none)'} → ${tabId}`);

    // Reset orders pagination when leaving the orders tab
    if (previousTab === 'orders' && tabId !== 'orders') {
        state.ordersPageData = [];
        state.ordersPageCursor = null;
        state.ordersPageLoading = false;
        state.hasMoreOrders = true;
    }

    if (!skipHistory) {
        history.pushState({ tabId }, "", `#${tabId}`);
    }

    closeSidebar();
    
    // Close other mobile drawers
    const orderDrawer = document.getElementById('orderDrawer');
    const orderOverlay = document.getElementById('orderDrawerOverlay');
    if (orderDrawer) orderDrawer.classList.remove('active');
    if (orderOverlay) orderOverlay.classList.remove('active');
    
    window.__tables?.closeDrawer?.();
    
    toggleNotificationSheet(false);

    if (tabId === 'notifications') {
        state.isNotificationPending = false;
        updateNotificationUI();
    }

    if (tabId === 'settings') {
        updateNotificationSettingsUI();
    }

    const body = document.body;
    const posTab = document.getElementById('tab-walkin');

    // Handle POS (Walk-in) Fullscreen on Mobile
    const mobileHeader = document.getElementById('mobileAppHeader');
    if (tabId === 'walkin') {
        if (window.innerWidth < 768) {
            body.classList.add('pos-immersion-active');
            if (mobileHeader) mobileHeader.style.setProperty('display', 'none', 'important');
        }
        if (posTab) posTab.classList.add('pos-fullscreen');

        if (!document.getElementById('posExitBtn') && posTab) {
            const backBtn = document.createElement('button');
            backBtn.id = 'posExitBtn';
            backBtn.className = 'pos-back-btn mobile-only';
            backBtn.innerHTML = '<i data-lucide="chevron-left"></i>';
            backBtn.onclick = (e) => {
                e.stopPropagation();
                switchTab('dashboard');
            };
            posTab.prepend(backBtn);
            await loadLucide();
            window.lucide.createIcons({ root: posTab });
        }
    } else {
        body.classList.remove('pos-immersion-active');
        if (mobileHeader) mobileHeader.style.display = '';
        if (posTab) posTab.classList.remove('pos-fullscreen');
    }

    // Handle Reports Fullscreen/Immersive
    if (tabId === 'reports') {
        body.classList.add('reports-immersive');
    } else {
        body.classList.remove('reports-immersive');
    }

    // Update Sidebar Navigation Active State
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    const mainItem = document.getElementById(`menu-${tabId}`);
    if (mainItem) mainItem.classList.add('active');

    // Update Mobile Bottom Nav & Header Title
    const mobileTitle = document.getElementById('mobileTabTitle');
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
            if (mobileTitle) {
                const label = item.querySelector('span');
                if (label) mobileTitle.textContent = label.textContent;
            }
        }
    });

    // Switch Content Tabs
    document.querySelectorAll('.tab-content').forEach(div => {
        div.classList.add('hidden');
    });

    const target = document.getElementById(`tab-${tabId}`);
    console.log(`[SWITCH] target=${!!target}, id=tab-${tabId}`);
    if (target) {
        target.classList.remove('hidden');
        const _targetDisplay = getComputedStyle(target).display;
        const _targetHeight = target.offsetHeight;
        console.log(`[SWITCH] removed hidden, classes="${target.className}", display=${_targetDisplay}, height=${_targetHeight}`);

        const mainEl = document.querySelector('.main');
        if (mainEl) mainEl.scrollTop = 0;
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;

        // --- PHASE 3.25: PARALLEL CLEANUP (error-isolated) ---
        const cleanupTasks = [];
        if (tabId !== 'catalog' && tabId !== 'categories') cleanupTasks.push(mod('catalog').then(m => m.cleanupCatalog?.()));
        if (tabId !== 'riders' && tabId !== 'dashboard' && tabId !== 'live') cleanupTasks.push(mod('riders').then(m => m.cleanupRiders?.()));
        if (tabId !== 'feedback') cleanupTasks.push(mod('feedback').then(m => m.cleanupFeedbacks?.()));
        if (tabId !== 'liveTracker') cleanupTasks.push(mod('tracker').then(m => { m.stopRiderLocationListener?.(); m.cleanupLiveRiderTracker?.(); }));
        if (tabId !== 'inventory') cleanupTasks.push(mod('inventory').then(m => m.cleanupInventory?.()));
        if (tabId !== 'reports') cleanupTasks.push(mod('analytics').then(m => m.cleanupReports?.()));
        if (tabId !== 'promotions') cleanupTasks.push(mod('promotions').then(m => m.cleanupPromotions?.()));
        if (tabId !== 'discounts') cleanupTasks.push(mod('discounts').then(m => m.cleanupDiscounts?.()));
        if (tabId !== 'discounts') cleanupTasks.push(mod('discountsReports').then(m => m.closeDiscountsReports?.()));
        if (tabId !== 'tables') cleanupTasks.push(mod('tables').then(m => m.cleanupTables?.()));
        await Promise.allSettled(cleanupTasks);
        console.log(`[SWITCH] cleanup done for ${tabId}`);

        // --- PHASE 3.25: DATA REFRESH ---
        window.__adminLogger?.data('TAB', `Loading data for: ${tabId}`);
        try {
            switch (tabId) {
                case 'dashboard':
                case 'orders':
                case 'live': {
                    const [{ loadRiders: lr }, { renderOrders, loadOrdersPage }] = await Promise.all([
                        mod('riders'), mod('orders')
                    ]);
                    lr();
                    renderOrders(state.lastOrdersSnap);
                    if (tabId === 'orders') loadOrdersPage(true);
                    break;
                }
                case 'liveTracker': {
                    const { initLiveRiderTracker } = await mod('tracker');
                    initLiveRiderTracker();
                    break;
                }
                case 'catalog':
                case 'categories':
                case 'menu': {
                    const { loadCategories, loadMenu } = await mod('catalog');
                    loadCategories();
                    loadMenu();
                    break;
                }
                case 'riders': {
                    const { loadRiders } = await mod('riders');
                    loadRiders();
                    break;
                }
                case 'feedback': {
                    const { loadFeedbacks } = await mod('feedback');
                    loadFeedbacks();
                    break;
                }
                case 'walkin': {
                    const { loadWalkinMenu } = await mod('pos');
                    loadWalkinMenu();
                    break;
                }
                case 'settings': {
                    const { loadStoreSettings } = await mod('settings');
                    loadStoreSettings();
                    break;
                }
                case 'customers': {
                    const { loadCustomers } = await mod('customers');
                    loadCustomers();
                    break;
                }
                case 'reports': {
                    const { loadReports } = await mod('analytics');
                    loadReports();
                    break;
                }
                case 'lostSales': {
                    const { loadLostSales } = await mod('lost-sales');
                    loadLostSales();
                    break;
                }
                case 'inventory': {
                    const { loadInventory } = await mod('inventory');
                    loadInventory();
                    break;
                }
                case 'riderAnalytics': {
                    const { initRiderAnalytics } = await mod('rider-analytics');
                    initRiderAnalytics();
                    break;
                }
                case 'payments': { const { renderOrders } = await mod('orders'); renderOrders(state.lastOrdersSnap); break; }
                case 'promotions': {
                    const { loadPromotions } = await mod('promotions');
                    loadPromotions();
                    break;
                }
                case 'discounts': {
                    const { loadDiscounts } = await mod('discounts');
                    loadDiscounts();
                    break;
                }
                case 'tables': {
                    const { loadTableManagement } = await mod('tables');
                    loadTableManagement();
                    break;
                }
            }
        } catch (loadErr) {
            window.__adminLogger?.error('TAB', `Load error for ${tabId}: ${loadErr.message}`, loadErr);
        }

        await loadLucide();
        window.lucide.createIcons({ root: target });

        applyDataLabels();

        console.log(`[SWITCH] DONE: tab=${tabId}, height=${target.offsetHeight}, childCount=${target.children.length}`);
        window.__adminLogger?.success('TAB', `Tab loaded: ${tabId}`);
    } else {
        window.__adminLogger?.warn('TAB', `Tab target not found: tab-${tabId}`);
    }
};

export const applyDataLabels = () => {
    const isMobile = window.innerWidth <= 768;
    document.querySelectorAll('table.premium-table-v4, table.mobile-card-table').forEach(table => {
        const headers = [];
        table.querySelectorAll('thead th').forEach(th => {
            headers.push(th.textContent.trim());
        });
        if (headers.length === 0) return;
        table.querySelectorAll('tbody tr').forEach(row => {
            row.querySelectorAll('td').forEach((td, index) => {
                if (index < headers.length) {
                    td.setAttribute('data-label', headers[index]);
                }
            });
        });
        table.classList.toggle('mobile-card-table', isMobile);
    });
};

let _dataLabelTimer = null;
const tableObserver = new MutationObserver(() => {
    if (_dataLabelTimer) cancelAnimationFrame(_dataLabelTimer);
    _dataLabelTimer = requestAnimationFrame(() => { _dataLabelTimer = null; applyDataLabels(); });
});
const observerTarget = document.getElementById('main-content') || document.body;
tableObserver.observe(observerTarget, { childList: true, subtree: true });

export const toggleMobileCart = (state) => import('./features/pos.js').then(m => m.toggleMobileCart(state));

export const ui = {
    showConfirm,
    showToast,
    toggleSidebar,
    closeSidebar,
    switchTab,
    toggleMobileCart
};


// --- INITIAL DATA-LABEL APPLICATION ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDataLabels);
} else {
    applyDataLabels();
}

window.addEventListener('resize', applyDataLabels);

// --- BROWSER HISTORY ORCHESTRATION ---
window.addEventListener('popstate', (event) => {
    const state = event.state;
    
    // 1. Handle UI Component closing (Back button closes drawer/sidebar first)
    if (state && (state.action === 'closeDrawer' || state.action === 'closeUI')) {
        if (state.action === 'closeDrawer') {
            const el = document.getElementById(state.targetId);
            if (el) el.classList.remove('active');
        } else if (state.target === 'sidebar') {
            closeSidebar();
        } else if (state.target === 'notifications') {
            toggleNotificationSheet(false);
        }
        return;
    }

    // 2. Handle Tab Navigation
    if (state && state.tabId) {
        console.log(`[History] Navigating to tab: ${state.tabId}`);
        switchTab(state.tabId, true);
    } else {
        const hash = window.location.hash.replace('#', '');
        if (hash) switchTab(hash, true);
        else switchTab('dashboard', true);
    }
});
