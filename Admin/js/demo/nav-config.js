/**
 * FoodHubbie Demo — navigation definition (single source for the demo shell).
 *
 * The demo MUST mirror the real Admin sidebar. `tools/check-demo-nav.cjs`
 * parses Admin/index.html and fails if this file drifts from it, so a new
 * sidebar item in the live product breaks the build check until the demo is
 * updated too.
 *
 * `DEMO_ONLY_PAGES` are destinations that exist only in the demo (they are
 * linked from the demo banner, never from the sidebar) — kept separate so the
 * sync check stays exact.
 */

// Mirrors Admin/index.html `.nav-list` (groups + items, in order).
export const NAV_GROUPS = [
    {
        label: 'Operations', items: [
            { tab: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', title: 'View Main Dashboard Snapshot' },
            { tab: 'orders', label: 'Orders', icon: 'shopping-cart', title: 'Manage Customer Orders' },
            { tab: 'live', label: 'Kitchen', icon: 'chef-hat', title: 'Monitor Kitchen Operations' },
            { tab: 'walkin', label: 'POS Control', icon: 'monitor', title: 'Open Point of Sale (POS) Interface' },
            { tab: 'tables', label: 'Tables', icon: 'layout-grid', title: 'Manage Dine-In Tables, Sessions, QR Codes & Kitchen Display' },
        ]
    },
    {
        label: 'Marketing', items: [
            { tab: 'promotions', label: 'Promotions', icon: 'megaphone', title: 'Compose & Send Promotional Campaigns' },
            { tab: 'discounts', label: 'Discounts', icon: 'percent', title: 'Schedule & Manage Discounts' },
        ]
    },
    {
        label: 'Catalogue', items: [
            { tab: 'menu', label: 'Menu', icon: 'utensils', title: 'Manage Product Menu and Items' },
            { tab: 'categories', label: 'Categories', icon: 'folder-tree', title: 'Organize Menu Categories' },
            { tab: 'combos', label: 'Combos', icon: 'tag', title: 'Manage Combo Offers' },
            { tab: 'menu-browser', label: 'Menu Browser', icon: 'layout-grid', title: 'Browse Menu by Category — Quick Setup' },
            { tab: 'inventory', label: 'Inventory', icon: 'package', title: 'Manage Stock Levels and Supplies' },
        ]
    },
    {
        label: 'People', items: [
            { tab: 'riders', label: 'Riders', icon: 'bike', title: 'Manage Delivery Staff and Status' },
            { tab: 'customers', label: 'Customers', icon: 'users', title: 'View and Manage Customer Records' },
            { tab: 'loyalty', label: 'Loyalty', icon: 'award', title: 'Configure loyalty points, tiers and rewards' },
            { tab: 'chat', label: 'WhatsApp', icon: 'message-circle', title: 'WhatsApp Conversations with Customers' },
        ]
    },
    {
        label: 'Insights', items: [
            { tab: 'reports', label: 'Analytics', icon: 'bar-chart-3', title: 'View Detailed Business Analytics' },
            { tab: 'riderAnalytics', label: 'Rider Insights', icon: 'trending-up', title: 'Monitor Rider Performance & Earnings' },
            { tab: 'feedback', label: 'Feedback', icon: 'star', title: 'View and Manage Customer Reviews' },
            { tab: 'liveTracker', label: 'Live Tracking', icon: 'map-pin', title: 'Track Live Deliveries on Map' },
            { tab: 'notifications', label: 'Notifications', icon: 'bell', title: 'View Recent System Alerts' },
            { tab: 'payments', label: 'Payments', icon: 'wallet', title: 'View Payment Transactions' },
            { tab: 'expenses', label: 'Expenses', icon: 'dollar-sign', title: 'Track and Manage Business Expenses' },
            { tab: 'costs', label: 'Costs', icon: 'calculator', title: 'Cost of running the software' },
        ]
    },
    {
        label: 'System', items: [
            { tab: 'install', label: 'Download App', icon: 'download-cloud', title: 'Download Portal as App', action: 'installPWA' },
            { tab: 'settings', label: 'Settings', icon: 'settings', title: 'Manage Store & Delivery Configuration' },
            { tab: 'logout', label: 'Logout', icon: 'log-out', title: 'Sign Out of Dashboard', action: 'userLogout', logout: true },
        ]
    },
];

// Pages that exist only inside the demo (linked from the demo banner).
export const DEMO_ONLY_PAGES = [
    { tab: 'platform', label: 'Supreme Admin preview' },
];

// Topbar titles, matching Admin/js/ui.js TAB_DEFS naming.
export const TAB_TITLES = {
    dashboard: 'Dashboard Overview',
    orders: 'Orders Management',
    live: 'Kitchen Display (KDS)',
    walkin: 'POS Control',
    tables: 'Tables & Sessions',
    promotions: 'Promotions',
    discounts: 'Discounts',
    menu: 'Menu Catalogue',
    categories: 'Menu Categories',
    combos: 'Combo Offers',
    'menu-browser': 'Menu Browser',
    inventory: 'Inventory & Stock',
    riders: 'Riders',
    customers: 'Customers',
    loyalty: 'Loyalty Programme',
    chat: 'WhatsApp Chat',
    reports: 'Analytics & Reports',
    riderAnalytics: 'Rider Insights',
    feedback: 'Customer Feedback',
    liveTracker: 'Live Delivery Tracking',
    notifications: 'Notifications',
    payments: 'Payments',
    expenses: 'Expenses',
    costs: 'Software Costs',
    install: 'Get the Mobile App',
    settings: 'Store & Delivery Settings',
    logout: 'End Demo Session',
    platform: 'Supreme Admin — Platform Console',
};

export const ALL_TABS = NAV_GROUPS.flatMap(g => g.items.map(i => i.tab));

export function titleFor(tab) {
    return TAB_TITLES[tab] || 'Dashboard Overview';
}

export function iconFor(tab) {
    for (const g of NAV_GROUPS) {
        const hit = g.items.find(i => i.tab === tab);
        if (hit) return hit.icon;
    }
    return 'circle';
}
