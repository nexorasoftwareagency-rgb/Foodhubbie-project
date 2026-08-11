/**
 * ROSHANI ERP | GLOBAL STATE
 * Reactive state management for the application.
 */

export const state = {
    adminData: null,
    currentOutlet: 'pizza',
    categories: [],
    dishes: [],
    allWalkinDishes: [],
    activeWalkinCategory: 'All',
    walkinCart: {},
    walkinPayMethod: 'Cash',
    isEditRiderMode: false,
    currentEditingRiderId: null,
    editingDishId: null,
    lastOrdersSnap: null,
    lastDishesSnap: null,
    ordersMap: new Map(),
    liveOrdersMap: new Map(), // Dedicated map for ongoing/recent orders

    // Orders tab pagination
    ordersPageData: [],
    ordersPageCursor: null,
    ordersLoadedKeys: new Set(),
    hasMoreOrders: true,
    ordersPageLoading: false,

    notifications: [],
    isNotificationPending: false,
    deferredPrompt: null,
    ridersList: [],
    riderStatsData: {},
    walkinDiscount: 0,
    walkinDiscountPct: 0,
    walkinAutoDiscount: null,  // { discount, amount, label, source } | null
    walkinCouponCode: null,    // user-entered coupon code (string) | null
    currentPOSModalDish: null,
    currentPOSModalQty: 1,
    currentPOSModalSize: null,
    currentPOSModalAddons: {},
    currentActiveTab: 'dashboard',
    editingCartKey: null,

    settingsDirty: false,      // Tracks unsaved changes in settings form
    showAllRiders: false,      // Toggle: show all riders in sidebar (including offline)

    // Continuous notification sound
    unacknowledgedOrders: new Set(),  // Order IDs with sound playing
    continuousSoundInterval: null,     // setInterval ID for continuous sound

    // Promotions tab
    promotions: {
        activeMode: 'now',             // 'now' | 'schedule' | 'active' | 'history'
        csvRecipients: [],             // parsed from uploaded CSV
        mediaDataUrl: null,            // attached image data URL
        killSwitchEngaged: false,
    },
};
