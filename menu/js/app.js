/**
 * Menu/js/app.js
 * Wires together firebase.js, session.js, cart.js, order.js, ui.js.
 * This is the only file with top-level event listener registration.
 */
import { outletRef, get, onValue, push, set, OUTLET, isConnected, update, runTransaction } from './firebase.js';
import { initSession, ensureSession, Session, saveCheckoutContact, cleanupSession, touchSession, createOrderGroup, getCurrentGroupOrders, assertOutletEnabled } from './session.js';
import { Cart, addLine, setQty, clearCart, lineCount, subtotal as cartSubtotal, isEmpty as cartIsEmpty, restoreCart, getQRStorageKey } from './cart.js';
import { placeOrder } from './order.js';
import { validateCoupon } from './discount.js';
import * as UI from './ui.js';
import { haptic } from './ui.js';
import { esc } from './ui.js';
import { comboPriceTotal, bakeComboUnitPrices, isComboActive } from '../../shared/combo-math.js';
import { isIOS, isStandalone, canShowNativeInstallPrompt, promptInstall, getStoredPhone, savePhone, subscribeToNotifications } from './pwa-install.js';
import { VAPID_PUBLIC_KEY } from '../../shared/config/vapid.js';

// ---------------------------------------------------------------
// Module state for menu browsing
// ---------------------------------------------------------------
const M = {
    categories: [], dishes: [], combos: [],
    activeCategory: 'all',
    draftDish: null, draftSize: null, draftAddons: [], draftQty: 1,
    _savedDraft: null, // preserved draft when group choice interrupts customization
    taxEnabled: true, taxName: 'GST', taxPercent: 5, taxRates: [{ name: 'GST', rate: 5 }],
    serviceChargeEnabled: false, serviceChargeName: 'Service Charge', serviceChargeRate: 0,
    ordersCache: {},     // local cache of orders belonging to this session, for the bill summary
    _orderListeners: new Map(), // dedup map: orderId -> unsubscribe fn
    currentOrderId: null,
    _orderUnsub: null,
    guestCount: 1,
    _guestCountDirty: false,
    _placing: false,
    appliedDiscount: null,  // { discountId, name, couponCode, amount, ... }
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
async function _allOrdersServed() {
    const groupOrders = getCurrentGroupOrders();
    if (groupOrders.length === 0) return true;
    await Promise.all(groupOrders.map(async oid => {
        if (!M.ordersCache[oid]) {
            try { const snap = await get(outletRef(`orders/${oid}`)); M.ordersCache[oid] = snap.val(); } catch (_) {}
        }
    }));
    return groupOrders.every(oid => {
        const o = M.ordersCache[oid];
        return o && (o.status === 'Cancelled' || o.status === 'Served' || o.status === 'Delivered');
    });
}

function _groupTotalForBill() {
    const groupOrders = getCurrentGroupOrders();
    let total = 0;
    groupOrders.forEach(oid => {
        const o = M.ordersCache[oid];
        if (o && o.status !== 'Cancelled') total += Number(o.total || 0);
    });
    return total;
}

// ---------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------
let _bootReady = false;
let _bootWatchdog = null;

// Token genuinely doesn't match any table on this outlet — a data/config
// problem, NOT a network problem. Shows the already-built #screenInvalid
// screen instead of the misleading offline banner.
function _showInvalidToken() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('offlineBanner').classList.remove('visible');
    UI.showScreen('screenInvalid');
}

// Real timeout / thrown error / a later step hanging — an actual
// connectivity problem. Shows the offline banner with a working retry.
function _showConnectionIssue() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('offlineBanner').classList.add('visible');
    UI.showScreen('screenWelcome');
    window.addEventListener('online', _retryBoot, { once: true });
}

async function boot() {
    // Diagnostic line — if this ever fails again, check the console for
    // exactly which outlet + token were checked, and whether Firebase
    // was actually connected at that moment.
    const _tokenAttempted = new URLSearchParams(window.location.search).get('t');
    console.log('[Boot] outlet =', OUTLET, '| token =', _tokenAttempted, '| firebase connected =', isConnected());

    // Watchdog: if boot() doesn't finish within 15s for ANY reason
    // (e.g. loadMenu()/ensureSession() hanging on a bad connection —
    // none of those calls have their own timeout), don't leave the
    // user staring at the spinner forever.
    _bootWatchdog = setTimeout(() => {
        if (!_bootReady) {
            console.warn('[Boot] Watchdog fired — boot did not complete in time.');
            _showConnectionIssue();
        }
    }, 15000);

    try {
        const result = await Promise.race([
            initSession().catch((e) => ({ ok: false, reason: 'error', error: e })),
            new Promise(resolve => setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 8000))
        ]);

        if (!result.ok) {
            console.warn('[Boot] initSession failed — reason:', result.reason, result.error || '');
            if (result.reason === 'invalid-token') {
                _showInvalidToken();
            } else {
                _showConnectionIssue();
            }
            return;
        }

        // Restaurant-disabled gate: if this outlet is disabled, the whole
        // ordering app is blocked regardless of token validity. The rules
        // also deny all unauth writes, so this screen is defense-in-depth
        // plus a clear message instead of a silent permission error.
        try {
            await assertOutletEnabled();
        } catch (e) {
            if (e.code === 'OUTLET_DISABLED') {
                document.getElementById('loadingOverlay').style.display = 'none';
                document.getElementById('offlineBanner').classList.remove('visible');
                UI.showScreen('screenDisabled');
                clearTimeout(_bootWatchdog);
                return;
            }
            console.warn('[Boot] Disabled check failed (proceeding):', e?.message || e);
        }

        // Register event listeners immediately after session init
        // so the first session:updated event from watchSession() is captured
        window.addEventListener('session:updated', (e) => onSessionUpdated(e.detail));
        window.addEventListener('cart:changed', onCartChanged);

        const t = Session.table;
        document.getElementById('welcomeTableNum').textContent = String(t.number).padStart(2, '0');
        document.querySelectorAll('#menuTableChip').forEach(el => el.textContent = `TABLE ${String(t.number).padStart(2, '0')}`);
        document.getElementById('cartHeaderTitle').textContent = `Your Cart (Table ${String(t.number).padStart(2, '0')})`;

        // Branding + dine-in settings (tax %, etc.) — non-critical, use defaults on failure
        let brandName = '', dineSettings = {};
        try {
            const [brandSnap, dineSettingsSnap] = await Promise.all([
                get(outletRef('settings/Store/storeName')),
                get(outletRef('dineinSettings'))
            ]);
            if (brandSnap.exists()) brandName = brandSnap.val();
            dineSettings = dineSettingsSnap.val() || {};
        } catch (e) {
            console.warn('[Boot] Settings fetch failed, using defaults:', e?.message || e);
        }
        if (brandName) UI.applyBrand(brandName);
        M.taxEnabled = dineSettings.taxEnabled !== false;
        M.taxName = dineSettings.taxName || 'GST';
        M.taxPercent = typeof dineSettings.taxRate === 'number' ? dineSettings.taxRate : 5;
        M.taxRates = (dineSettings.taxRates && Array.isArray(dineSettings.taxRates) && dineSettings.taxRates.length > 0) ? dineSettings.taxRates : (M.taxEnabled ? [{ name: M.taxName, rate: M.taxPercent }] : []);
        M.serviceChargeEnabled = dineSettings.serviceChargeEnabled === true;
        M.serviceChargeName = dineSettings.serviceChargeName || 'Service Charge';
        M.serviceChargeRate = typeof dineSettings.serviceChargeRate === 'number' ? dineSettings.serviceChargeRate : 0;

        // Render today's offers on welcome screen
        const offersRaw = dineSettings.offers;
        const offers = Array.isArray(offersRaw) ? offersRaw : (offersRaw ? Object.values(offersRaw) : []);
        if (offers.length > 0) {
            const offersEl = document.getElementById('welcomeOffers');
            offersEl.innerHTML = offers.slice(0, 3).map(o => `
                <div class="welcome-offer-card">
                    <div class="welcome-offer-title">${UI.esc(o.title || '')}</div>
                    ${o.description ? `<div class="welcome-offer-desc">${UI.esc(o.description)}</div>` : ''}
                    ${o.code ? `<span class="welcome-offer-code">${UI.esc(o.code)}</span>` : ''}
                </div>`).join('');
            offersEl.classList.remove('hidden');
        }

        const bgSnap = await get(outletRef('settings/Store/customerMenuBgImage'));
        if (bgSnap.exists() && bgSnap.val()) {
            const welcomeEl = document.getElementById('screenWelcome');
            const img = new Image();
            img.onload = () => {
                welcomeEl.style.backgroundImage = `url('${bgSnap.val()}')`;
                welcomeEl.classList.add('has-photo');
            };
            img.src = bgSnap.val();
        }

        await loadMenu();

        // Auto-rejoin: if this table already has an active session, create/join
        // it immediately so returning users see their orders without delay.
        // Token validation already set Session.table. If currentSession exists,
        // ensureSession() will find it and restore the user's group context.
        if (Session.table?.currentSession) {
            const sessResult = await ensureSession();
            const qrKey = getQRStorageKey(); // sessionId now available after ensureSession()
            if (sessResult.isNewSession) {
                clearCart(qrKey); // old expired session's cart has no place in the new one
            } else {
                // Joining an existing session — restore the cart for this session
                restoreCart(qrKey);
            }
            if (sessResult.ok) {
                _bootReady = true;
                if (sessResult.groupChoiceNeeded) {
                    renderGroupChoiceScreen();
                    UI.showScreen('screenChooseGroup');
                    document.getElementById('loadingOverlay').style.display = 'none';
                    return;
                }
                const groupOrders = getCurrentGroupOrders();
                if (groupOrders.length > 0) {
                    const lastOrderId = groupOrders[groupOrders.length - 1];
                    watchOrder(lastOrderId);
                    UI.showScreen('screenTracking');
                    document.getElementById('loadingOverlay').style.display = 'none';
                    return;
                }
                // Session active but no orders — go straight to menu, not welcome
                document.getElementById('loadingOverlay').style.display = 'none';
                UI.showScreen('screenMenu');
                return;
            }
        }

        // No existing session — first visit, start with empty cart
        clearCart();
        document.getElementById('loadingOverlay').style.display = 'none';
        UI.showScreen('screenWelcome');
        _bootReady = true;
    } catch (e) {
        console.error('[Boot] Unexpected error:', e);
        _showConnectionIssue();
    } finally {
        clearTimeout(_bootWatchdog);
    }
}

async function _retryBoot() {
    if (_bootReady) return;
    document.getElementById('offlineBanner').classList.remove('visible');
    document.getElementById('loadingOverlay').style.display = '';
    await boot();
}

// Manual retry button inside the offline banner (see index.html change) —
// covers the common real-world case where the device was never actually
// marked offline by the OS, so the 'online' event above never fires.
document.getElementById('btnRetryConnection')?.addEventListener('click', () => {
    haptic(10);
    _retryBoot();
});

// ---------------------------------------------------------------
// GROUP CHOICE (Multi-Bill)
// ---------------------------------------------------------------
function renderGroupChoiceScreen() {
    const groups = Session.session?.orderGroups || {};
    const list = document.getElementById('existingGroupsList');
    const section = document.getElementById('joinGroupSection');
    const entries = Object.entries(groups).filter(([, g]) => g.status === 'active');
    if (entries.length > 0) {
        section.classList.remove('hidden');
        list.innerHTML = entries.map(([id, g]) => {
            const orderCount = (g.orders || []).length;
            return `<div class="group-card" data-group-id="${id}" tabindex="0" role="button" aria-label="Join ${UI.esc(g.label)}">
                <div>
                    <div class="group-card-label">${UI.esc(g.label)}</div>
                    <div class="group-card-sub">${orderCount} order${orderCount !== 1 ? 's' : ''}</div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
            </div>`;
        }).join('');
        list.querySelectorAll('.group-card').forEach(card => {
            card.addEventListener('click', () => selectGroup(card.dataset.groupId));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectGroup(card.dataset.groupId);
                }
            });
        });
    } else {
        section.classList.add('hidden');
        list.innerHTML = '<p style="font-size:12px;color:var(--text-sub);margin:12px 0 8px;">No joinable groups at the moment.</p>';
    }
}

async function selectGroup(groupId) {
    if (!groupId || !Session.session?.orderGroups?.[groupId]) return;
    Session.currentGroupId = groupId;
    sessionStorage.setItem(`_pizza_group_${Session.sessionId}`, groupId);
    document.getElementById('loadingOverlay').style.display = '';
    try {
        if (M._savedDraft) {
            const d = M._savedDraft;
            await loadMenu();
            openCustomize(d.dish.id);
            M.draftSize = d.size;
            M.draftAddons = d.addons;
            M.draftQty = d.qty;
            renderCustomizeSections();
            M._savedDraft = null;
            if (d.instructions) {
                document.getElementById('specialInstructions').value = d.instructions;
            }
            return;
        }
        await loadMenu();
        const groupOrders = getCurrentGroupOrders();
        if (groupOrders.length > 0) {
            const lastOrderId = groupOrders[groupOrders.length - 1];
            watchOrder(lastOrderId);
            UI.showScreen('screenTracking');
        } else {
            UI.showScreen('screenMenu');
        }
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

let _groupClicking = false;
document.getElementById('btnStartOwnGroup')?.addEventListener('click', async () => {
    if (_groupClicking) return;
    _groupClicking = true;
    const btn = document.getElementById('btnStartOwnGroup');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
        const groupId = await createOrderGroup();
        if (!groupId) {
            UI.showToast('Could not create group. Please try again.');
            return;
        }
        // New group = fresh cart for this group
        clearCart(getQRStorageKey());
        document.getElementById('loadingOverlay').style.display = '';
        await loadMenu();
        UI.showScreen('screenMenu');
    } catch (e) {
        console.error('[GroupCreate]', e);
        UI.showToast('Could not create group. Please try again.');
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
        _groupClicking = false;
        btn.disabled = false;
        btn.textContent = 'Start My Own Bill';
    }
});

function onSessionUpdated(session) {
    if (session.status === 'expired' || session.status === 'closed') {
        // Session ended (expired or closed by admin) — clear cart and show expired screen
        cleanupSession();
        UI.showScreen('screenSessionExpired');
        return;
    }
    // If group choice screen is active, refresh the group list in real-time
    if (document.getElementById('screenChooseGroup')?.classList.contains('active')) {
        renderGroupChoiceScreen();
    }
    const groupOrders = getCurrentGroupOrders();
    // Show billing-status indicator on tracking screen
    const gStatus = Session.currentGroupId ? session.orderGroups?.[Session.currentGroupId]?.status : null;
    const isBilling = session.status === 'billing' || gStatus === 'billing' || gStatus === 'paid';
    const billingBanner = document.getElementById('billingStatusBanner');
    if (billingBanner) {
        billingBanner.classList.toggle('hidden', !isBilling);
        if (isBilling) {
            const text = gStatus === 'paid' ? '✓ Bill Paid' : '⏳ Bill Requested — Awaiting Staff';
            billingBanner.textContent = text;
        }
    }
    UI.updateRunningBillStrip(session, groupOrders, _groupTotalForBill());
    UI.updateSessionNoteInCart(session, groupOrders, _groupTotalForBill());
    // Show greeting when customer name is known
    if (session.customerName) {
        UI.updateGreeting(session.customerName);
        // Pre-fill checkout fields from session data
        const nameInput = document.getElementById('checkoutName');
        const phoneInput = document.getElementById('checkoutPhone');
        if (nameInput && !nameInput.value) nameInput.value = session.customerName;
        if (phoneInput && !phoneInput.value) phoneInput.value = session.customerPhone || '';
    }
    // Pre-fill guest count from session (only if user hasn't manually changed it)
    if (!M._guestCountDirty && session.guestCount && session.guestCount > 0) {
        M.guestCount = session.guestCount;
        const gcEl = document.getElementById('guestCountVal');
        if (gcEl) gcEl.textContent = String(M.guestCount);
    }
    // Pre-fill special note from session
    const noteInput = document.getElementById('checkoutNote');
    if (noteInput && session.specialNote && !noteInput.value) noteInput.value = session.specialNote;
    // Keep local orders cache fresh for the bill summary (filtered by current group)
    // Dedup: avoid registering multiple onValue listeners for the same orderId.
    // Permanent listener (not onlyOnce) so _allOrdersServed(), _groupTotalForBill(),
    // and history screen always see the latest order status.
    const tracked = new Set(groupOrders);
    // Unsubscribe stale listeners for orders no longer in this group
    M._orderListeners.forEach((unsub, oid) => {
        if (!tracked.has(oid)) { unsub(); M._orderListeners.delete(oid); delete M.ordersCache[oid]; }
    });
    groupOrders.forEach(oid => {
        if (!M._orderListeners.has(oid)) {
            const unsub = onValue(outletRef(`orders/${oid}`), (snap) => {
                const prev = M.ordersCache[oid];
                M.ordersCache[oid] = snap.val();
                const newStatus = M.ordersCache[oid]?.status;
                if (prev && prev.status && prev.status !== newStatus && ['Confirmed','Preparing','Ready','Served'].includes(newStatus)) {
                    const labels = { Confirmed: 'Order Confirmed', Preparing: 'Order being prepared', Ready: 'Order Ready', Served: 'Order Served' };
                    UI.showToast(labels[newStatus] || `Order ${newStatus}`, 'success');
                }
                UI.renderSessionBillCard(session, M.ordersCache, M.taxName, M.taxPercent, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.taxRates, groupOrders);
            });
            M._orderListeners.set(oid, unsub);
        } else if (!M.ordersCache[oid]) {
            // Listener exists but cache not yet populated — fetch once to fill gap
            get(outletRef(`orders/${oid}`)).then(snap => { M.ordersCache[oid] = snap.val(); UI.renderSessionBillCard(session, M.ordersCache, M.taxName, M.taxPercent, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.taxRates, groupOrders); }).catch(() => {});
        }
    });
    UI.renderSessionBillCard(session, M.ordersCache, M.taxName, M.taxPercent, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.taxRates, groupOrders);
}

function onCartChanged() {
    UI.updateCartBadges(lineCount());
    UI.updateCartBar(lineCount(), cartSubtotal());
    if (document.getElementById('screenCart')?.classList.contains('active')) renderCartScreen();
}

// ---------------------------------------------------------------
// MENU
// ---------------------------------------------------------------
async function loadMenu() {
    const [catSnap, dishSnap, comboSnap] = await Promise.all([
        get(outletRef('categories')), get(outletRef('dishes')), get(outletRef('combos'))
    ]);
    M.categories = Object.entries(catSnap.val() || {}).map(([id, c]) => ({ id, ...c }));
    M.dishes = Object.entries(dishSnap.val() || {}).filter(([, d]) => d.stock !== false).map(([id, d]) => ({ id, ...d }));
    const now = Date.now();
    M.combos = Object.entries(comboSnap.val() || {})
        .filter(([, c]) => isComboActive(c, now) && _comboVisibleForCustomer(c))
        .map(([id, c]) => ({ id, ...c }));
    renderMenuScreen();
}

function renderMenuScreen(searchTerm) {
    UI.renderCategoryPills(M.categories, M.activeCategory, (catId) => {     M.activeCategory = catId; document.getElementById('dishSearchInput').value = ''; renderMenuScreen(); }, M.combos.length > 0);

    const combosOnly = M.activeCategory === '__combos';
    _renderComboOffers();

    let dishes = M.dishes;
    if (M.activeCategory !== 'all' && !combosOnly) {
        const activeCat = M.categories.find(c => c.id === M.activeCategory);
        if (activeCat) dishes = dishes.filter(d => d.category === activeCat.name);
    }
    if (searchTerm) dishes = dishes.filter(d => (d.name || '').toLowerCase().includes(searchTerm.toLowerCase()));

    // Hide dish list when "Combos" filter is active
    const dishList = document.getElementById('dishListContainer');
    const dishTitle = document.getElementById('menuSectionTitle');
    if (combosOnly) {
        if (dishList) dishList.classList.add('hidden');
        if (dishTitle) dishTitle.classList.add('hidden');
        return;
    }
    if (dishList) dishList.classList.remove('hidden');
    if (dishTitle) dishTitle.classList.remove('hidden');

    const activeCategoryName = M.activeCategory === 'all' ? 'Popular Items' : (M.categories.find(c => c.id === M.activeCategory)?.name || 'Items');
    if (dishTitle) dishTitle.textContent = activeCategoryName;
    UI.renderDishList(dishes, { searchTerm, activeCategoryName }, openCustomize);
}

function _comboVegMark(c) {
    const items = c.items || [];
    for (const it of items) {
        const d = M.dishes.find(x => x.id === it.dishId);
        if (d && d.veg === false) return 'combo-nonveg';
    }
    return 'combo-veg';
}

function _comboVisibleForCustomer(c) {
    const segment = c.customerSegment || 'all';
    if (segment === 'all') return true;
    const session = Session.session || {};
    const orderCount = (session.orders || []).length;
    if (segment === 'new') return orderCount === 0;
    if (segment === 'returning') return orderCount > 0;
    return true;
}
function _comboData(c) {
    const entries = Object.values(c.items || {}).map(it => {
        const d = M.dishes.find(x => x.id === it.dishId);
        return { dish: d, base: d ? Number(d.price ?? (d.sizes ? Object.values(d.sizes)[0] : 0)) : 0, qty: it.qty || 1 };
    }).filter(e => e.dish);
    const prices = bakeComboUnitPrices(entries.map(e => ({ base: e.base, qty: e.qty })), c.discountType, c.discountValue);
    const disc = c.discountType === 'percentage' ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`;
    const originalTotal = entries.reduce((s, e, i) => s + prices[i], 0);
    const comboPrice = comboPriceTotal(originalTotal, c.discountType, c.discountValue);
    return { entries, prices, disc, originalTotal, comboPrice, saving: originalTotal - comboPrice };
}

function _renderComboOffers() {
    const section = document.getElementById('comboOffersSection');
    const grid = document.getElementById('comboOffersGrid');
    if (!section || !grid) return;
    const combos = (M.combos || []).filter(c => isComboActive(c, Date.now()));
    if (!combos.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    grid.className = 'combo-offers-grid';
    grid.innerHTML = combos.map(c => {
        const d = _comboData(c);
        const dishNames = d.entries.map(e => `${e.dish.name} x${e.qty}`).join(', ');
        return `
        <div class="combo-card" data-combo-id="${c.id}">
            <div class="combo-card-img">
                <div class="combo-img-frame">${c.image ? `<img src="${c.image}" alt="${esc(c.name)}">` : `<div class="combo-placeholder">🏷️</div>`}</div>
                <div class="combo-img-scrim"></div>
                <span class="combo-img-off">${d.disc}</span>
                <span class="${_comboVegMark(c)}" aria-label="${_comboVegMark(c) === 'combo-veg' ? 'Veg' : 'Non-Veg'}"></span>
                <button class="combo-fab" data-action="addCombo" data-id="${c.id}">ADD</button>
            </div>
            <div class="combo-card-body">
                <div class="combo-card-title">${esc(c.name)}</div>
                <div class="combo-card-items">${esc(dishNames)}</div>
                <div class="combo-card-price-row">
                    <span class="combo-card-orig">₹${UI.fmtMoney(d.originalTotal)}</span>
                    <span class="combo-card-price">₹${UI.fmtMoney(d.comboPrice)}</span>
                    <span class="combo-card-disc">${d.disc}</span>
                    <span class="combo-card-hint">Tap for details ›</span>
                </div>
            </div>
        </div>`;
    }).join('');
    if (!grid._cbListener) {
        grid._cbListener = true;
        grid.addEventListener('click', e => {
        const fab = e.target.closest('.combo-fab');
        if (fab) {
            fab.classList.add('combo-fab-added'); fab.textContent = '✓';
            setTimeout(() => { fab.classList.remove('combo-fab-added'); fab.textContent = 'ADD'; }, 700);
            _addComboToCart(fab.getAttribute('data-id'));
            return;
        }
        const card = e.target.closest('.combo-card');
        if (!card) return;
        const combo = combos.find(c => c.id === card.getAttribute('data-combo-id'));
        if (!combo) return;
        const cd = _comboData(combo);
        const comboDishIds = new Set(cd.entries.map(e => e.dish.id));
        const crossSell = M.dishes
            .filter(d => !comboDishIds.has(d.id))
            .slice(0, 2)
            .map(d => {
                const p = d.price != null ? d.price : (d.sizes ? Object.values(d.sizes)[0] : 0);
                return { id: d.id, name: d.name, price: p || 0 };
            });
        UI.showComboSheet({
            name: combo.name,
            discLabel: cd.disc,
            saving: cd.saving,
            price: cd.comboPrice,
            rows: cd.entries.map((e, i) => ({ name: e.dish.name, qty: e.qty, unitPrice: cd.prices[i] })),
            crossSell
        }, () => _addComboToCart(combo.id));
        });
    }
}

async function _addComboToCart(comboId) {
    const combo = M.combos.find(c => c.id === comboId);
    if (!combo) return;
    if (Session.session?.status === 'expired') { UI.showScreen('screenSessionExpired'); return; }
    const gStatus = Session.session?.orderGroups?.[Session.currentGroupId]?.status;
    if (gStatus === 'billing' || gStatus === 'paid' || Session.session?.status === 'billing') {
        UI.showToast('Cannot add items — bill already requested for this group');
        return;
    }
    const now = Date.now();
    if (!isComboActive(combo, now)) {
        UI.showToast('This combo is no longer active');
        return;
    }

    // --- Coupon code enforcement ---
    if (combo.couponCode) {
        const applied = M.appliedDiscount;
        if (!applied || applied.couponCode !== combo.couponCode) {
            UI.showToast(`This combo requires coupon code: ${combo.couponCode}. Enter it at checkout first.`);
            const input = document.getElementById('discountCodeInput');
            if (input) { input.focus(); input.select(); }
            return;
        }
    }

    // --- Redemption cap enforcement ---
    const maxRedemptions = combo.maxRedemptions || 0;
    if (maxRedemptions > 0) {
        const current = combo.currentRedemptions || 0;
        if (current >= maxRedemptions) {
            UI.showToast('Combo limit reached — no more available');
            return;
        }
        const ref = Outlet.ref(`combos/${combo.id}/currentRedemptions`);
        const result = await runTransaction(ref, (val) => {
            const next = (val || 0) + 1;
            if (next > maxRedemptions) return null;
            return next;
        });
        if (!result.committed) {
            UI.showToast('Combo limit reached — no more available');
            return;
        }
    }

    const perCustomerLimit = combo.perCustomerLimit || 0;
    if (perCustomerLimit > 0) {
        const customerId = Session.sessionId || Session.tableId || 'default';
        const ref = Outlet.ref(`combos/${combo.id}/redemptionsByCustomer/${customerId}`);
        const result = await runTransaction(ref, (val) => {
            const next = (val || 0) + 1;
            if (next > perCustomerLimit) return null;
            return next;
        });
        if (!result.committed) {
            UI.showToast('You have reached your limit for this combo');
            return;
        }
    }

    const perDayLimit = combo.perDayLimit || 0;
    if (perDayLimit > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const ref = Outlet.ref(`combos/${combo.id}/redemptionsByDay/${today}`);
        const result = await runTransaction(ref, (val) => {
            const next = (val || 0) + 1;
            if (next > perDayLimit) return null;
            return next;
        });
        if (!result.committed) {
            UI.showToast('Daily limit reached for this combo');
            return;
        }
    }

    touchSession();
    const items = Object.values(combo.items || {});
    const entries = [];
    items.forEach(it => {
        const dish = M.dishes.find(d => d.id === it.dishId);
        if (!dish) return;
        const base = Number(dish.price ?? (dish.sizes ? Object.values(dish.sizes)[0] : 0)) || 0;
        entries.push({ dish, base, qty: it.qty || 1 });
    });
    const prices = bakeComboUnitPrices(entries.map(e => ({ base: e.base, qty: e.qty })), combo.discountType, combo.discountValue);
    let added = 0;
    entries.forEach((e, i) => {
        addLine({
            dishId: e.dish.id, name: e.dish.name, img: e.dish.image,
            size: 'Regular', addons: [], instructions: '',
            qty: e.qty, unitPrice: prices[i],
            comboId: combo.id, comboName: combo.name, comboLineOriginal: Math.round(e.base * e.qty * 100) / 100
        });
        added += e.qty;
    });
    if (added > 0) {
        clearDiscountIfCartChanged();
        UI.showToast(`${combo.name} added — ${added} item${added > 1 ? 's' : ''}`);
    } else {
        UI.showToast('Combo dishes unavailable');
    }
}

let _searchTimer;
document.getElementById('dishSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(_searchTimer);
    touchSession();
    const val = e.target.value.trim();
    _searchTimer = setTimeout(() => renderMenuScreen(val), 150);
});

// ---------------------------------------------------------------
// CUSTOMIZATION
// ---------------------------------------------------------------
function _normalizeSizes(sizes, defaultPrice) {
    if (!sizes) return [{ label: 'Regular', price: defaultPrice }];
    if (Array.isArray(sizes)) return sizes;
    return Object.entries(sizes).map(([label, price]) => ({ label, price: typeof price === 'number' ? price : (price.price || defaultPrice) }));
}

function openCustomize(dishId) {
    if (Session.session?.status === 'expired') { UI.showScreen('screenSessionExpired'); return; }
    const gStatus = Session.session?.orderGroups?.[Session.currentGroupId]?.status;
    if (gStatus === 'billing' || gStatus === 'paid' || Session.session?.status === 'billing') {
        UI.showToast('Cannot add items — bill already requested for this group');
        return;
    }
    const dish = M.dishes.find(d => d.id === dishId);
    if (!dish) return;
    touchSession();
    M.draftDish = dish;
    const sizes = _normalizeSizes(dish.sizes, dish.price);
    M.draftSize = sizes[0];
    M.draftAddons = [];
    M.draftQty = 1;

    const heroImg = document.getElementById('customHeroImg');
    heroImg.src = dish.image || '';
    heroImg.onerror = () => { heroImg.style.display = 'none'; };
    heroImg.alt = dish.name || 'Dish image';
    document.getElementById('customDishName').textContent = dish.name;
    const descEl = document.getElementById('customDishDesc');
    if (descEl) {
        descEl.textContent = dish.description || '';
        descEl.style.display = dish.description ? '' : 'none';
    }
    document.getElementById('draftQtyVal').textContent = '1';
    renderCustomizeSections();
    document.getElementById('specialInstructions').value = '';
    UI.showScreen('screenCustomize');
}

function renderCustomizeSections() {
    const dish = M.draftDish;
    const sizes = _normalizeSizes(dish.sizes, dish.price);
    UI.renderSizeOptions(sizes, M.draftSize.label, (idx) => { haptic(12); M.draftSize = sizes[idx]; renderCustomizeSections(); updateCustomizePrice(); });
    UI.renderAddonRows(dish.addons || [], M.draftAddons, (idx) => {
        haptic(12);
        const pos = M.draftAddons.indexOf(idx);
        if (pos >= 0) M.draftAddons.splice(pos, 1); else M.draftAddons.push(idx);
        renderCustomizeSections();
        updateCustomizePrice();
    });
    updateCustomizePrice();
}

function draftUnitPrice() {
    const addonsTotal = M.draftAddons.reduce((sum, idx) => sum + (M.draftDish.addons[idx]?.price || 0), 0);
    return M.draftSize.price + addonsTotal;
}
function updateCustomizePrice() {
    const unit = draftUnitPrice();
    document.getElementById('customBasePrice').textContent = UI.fmtMoney(unit);
    document.getElementById('addToOrderLabel').textContent = `ADD TO ORDER ${UI.fmtMoney(unit * M.draftQty)}`;
}

document.getElementById('btnDraftQtyMinus')?.addEventListener('click', () => { haptic(10); M.draftQty = Math.max(1, M.draftQty - 1); document.getElementById('draftQtyVal').textContent = String(M.draftQty); updateCustomizePrice(); });
document.getElementById('btnDraftQtyPlus')?.addEventListener('click', () => { haptic(10); M.draftQty += 1; document.getElementById('draftQtyVal').textContent = String(M.draftQty); updateCustomizePrice(); });

document.getElementById('btnAddToOrder')?.addEventListener('click', async () => {
    haptic([15, 40, 15]);
    const btn = document.getElementById('btnAddToOrder');
    btn.disabled = true;
    try {
        // Reject if group/session is already in billing state
        const gStatus = Session.session?.orderGroups?.[Session.currentGroupId]?.status;
        if (gStatus === 'billing' || gStatus === 'paid' || Session.session?.status === 'billing') {
            UI.showToast('Cannot add items — bill already requested for this group');
            return;
        }
        const sessResult = await ensureSession();
        if (!sessResult.ok) {
            UI.showToast('Could not start session. Please scan the QR code again.');
            return;
        }
        if (sessResult.groupChoiceNeeded) {
            // Save draft so it can be restored after group selection
            if (M.draftDish) {
                M._savedDraft = {
                    dish: M.draftDish, size: M.draftSize, addons: M.draftAddons,
                    qty: M.draftQty, instructions: document.getElementById('specialInstructions')?.value?.trim() || ''
                };
            }
            renderGroupChoiceScreen();
            UI.showScreen('screenChooseGroup');
            return;
        }
        touchSession();
        const addonNames = M.draftAddons.map(i => M.draftDish.addons[i]?.name).filter(Boolean);
        addLine({
            dishId: M.draftDish.id, name: M.draftDish.name, img: M.draftDish.image,
            size: M.draftSize.label, addons: addonNames,
            instructions: document.getElementById('specialInstructions').value.trim(),
            qty: M.draftQty, unitPrice: draftUnitPrice()
        });
        clearDiscountIfCartChanged();
        UI.showToast(`${M.draftDish.name} added to cart`);
        UI.showScreen('screenMenu');
    } finally {
        btn.disabled = false;
    }
});

// ---------------------------------------------------------------
// DISCOUNT CODE
// ---------------------------------------------------------------
function _refreshDiscountInput() {
    if (M.appliedDiscount) {
        UI.showAppliedDiscount(M.appliedDiscount.name || M.appliedDiscount.couponCode, M.appliedDiscount.amount, M.appliedDiscount.mode, M.appliedDiscount.value);
    } else {
        UI.resetDiscountInput();
    }
}

function _clearDiscount() {
    M.appliedDiscount = null;
    UI.resetDiscountInput();
    UI.updateCartTotals(cartSubtotal(), M.taxPercent, M.taxName, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, null, M.taxRates);
}

function clearDiscountIfCartChanged() {
    if (M.appliedDiscount) _clearDiscount();
}

document.getElementById('btnApplyDiscount')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnApplyDiscount');
    const input = document.getElementById('discountCodeInput');
    if (!input) return;
    haptic(10);

    // If already applied, remove
    if (M.appliedDiscount) {
        _clearDiscount();
        return;
    }

    const code = input.value.trim();
    if (!code) { UI.showDiscountMsg('Please enter a code', 'error'); return; }

    UI.setDiscountInputLoading(true);
    try {
        const result = await validateCoupon(code, cartSubtotal());
        if (!result) {
            UI.showDiscountMsg('Invalid or expired discount code', 'error');
            UI.setDiscountInputLoading(false);
            return;
        }
        M.appliedDiscount = result;
        UI.updateCartTotals(cartSubtotal(), M.taxPercent, M.taxName, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.appliedDiscount, M.taxRates);
        UI.showAppliedDiscount(result.name || result.couponCode, result.amount, result.mode, result.value);
        UI.setDiscountInputLoading(false);
        haptic([10, 30, 10]);
    } catch (e) {
        console.error('[Discount]', e);
        UI.showDiscountMsg('Could not verify code. Try again.', 'error');
        UI.setDiscountInputLoading(false);
    }
});

// ---------------------------------------------------------------
// CART / CHECKOUT
// ---------------------------------------------------------------
function renderCartScreen() {
    UI.renderCartList(Cart.lines, { onStep: (id, delta) => {
        haptic(10);
        const newQty = (Cart.lines[id]?.qty || 0) + delta;
        if (newQty <= 0 && !confirm('Remove this item from your cart?')) return;
        setQty(id, newQty);
        clearDiscountIfCartChanged();
    } });
    UI.updateCartTotals(cartSubtotal(), M.taxPercent, M.taxName, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.appliedDiscount, M.taxRates);
    UI.updateSessionNoteInCart(Session.session, getCurrentGroupOrders(), _groupTotalForBill());
    _refreshDiscountInput();
}

['btnOpenCartFromMenu', 'btnOpenCartFromCustomize', 'btnViewCartBar'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => { renderCartScreen(); UI.showScreen('screenCart'); });
});
document.getElementById('btnBackFromCart')?.addEventListener('click', () => UI.showScreen('screenMenu'));
document.getElementById('cartSCOptIn')?.addEventListener('change', () => {
    UI.updateCartTotals(cartSubtotal(), M.taxPercent, M.taxName, M.taxEnabled, M.serviceChargeEnabled, M.serviceChargeName, M.serviceChargeRate, M.appliedDiscount, M.taxRates);
});document.getElementById('btnBackFromCustomize')?.addEventListener('click', () => UI.showScreen('screenMenu'));

// Guest count stepper
document.getElementById('btnGuestMinus')?.addEventListener('click', () => { haptic(10); M.guestCount = Math.max(1, M.guestCount - 1); M._guestCountDirty = true; document.getElementById('guestCountVal').textContent = String(M.guestCount); });
document.getElementById('btnGuestPlus')?.addEventListener('click', () => { haptic(10); M.guestCount = Math.min(20, M.guestCount + 1); M._guestCountDirty = true; document.getElementById('guestCountVal').textContent = String(M.guestCount); });

// Keyboard Enter on checkout fields triggers Place Order
['checkoutName', 'checkoutPhone', 'checkoutNote'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnPlaceOrder')?.click(); }
    });
});

document.getElementById('btnPlaceOrder')?.addEventListener('click', async () => {
    if (M._placing) return;
    if (cartIsEmpty()) { UI.showToast('Your cart is empty'); return; }
    M._placing = true;
    const btn = document.getElementById('btnPlaceOrder');
    btn.disabled = true;
    btn.textContent = 'Placing order…';
    const gStatus = Session.session?.orderGroups?.[Session.currentGroupId]?.status;
    if (gStatus === 'billing' || gStatus === 'paid' || Session.session?.status === 'billing') {
        UI.showToast('Cannot place order — bill already requested for this group');
        M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER';
        return;
    }
    const sessResult = await ensureSession();
    if (!sessResult.ok) { M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER'; UI.showToast('Could not start session. Please scan the QR code again.'); return; }
    if (sessResult.groupChoiceNeeded) { M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER'; renderGroupChoiceScreen(); UI.showScreen('screenChooseGroup'); return; }
    if (Session.session?.status === 'expired') {
        M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER';
        UI.showScreen('screenSessionExpired');
        return;
    }
    haptic([20, 50, 20]);
    const nameEl = document.getElementById('checkoutName');
    const phoneEl = document.getElementById('checkoutPhone');
    const name = nameEl?.value.trim();
    const phone = phoneEl?.value.trim();
    [nameEl, phoneEl].forEach(el => el?.classList.remove('input-error'));
    if (!name) { nameEl?.classList.add('input-error'); UI.showToast('Please enter your name'); nameEl?.focus(); M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER'; return; }
    if (!phone || !/^\d{10}$/.test(phone)) { phoneEl?.classList.add('input-error'); UI.showToast('Please enter a valid 10-digit mobile number'); phoneEl?.focus(); M._placing = false; btn.disabled = false; btn.textContent = 'PLACE ORDER'; return; }

    try {
        const note = document.getElementById('checkoutNote')?.value.trim() || '';
        // Fire-and-forget: contact save is important but shouldn't block order
        saveCheckoutContact(name, phone, M.guestCount, note).catch(e => console.warn('[PlaceOrder] saveCheckoutContact failed:', e?.message || e));

        const { orderId } = await placeOrder({ taxPercent: M.taxPercent, taxEnabled: M.taxEnabled, taxRates: M.taxRates, serviceChargeEnabled: M.serviceChargeEnabled, applyServiceCharge: document.getElementById('cartSCOptIn')?.checked === true, serviceChargeRate: M.serviceChargeRate, customerName: name, customerPhone: phone, discount: M.appliedDiscount });
        M.appliedDiscount = null;
        watchOrder(orderId);
        UI.showScreen('screenTracking');
    } catch (e) {
        console.error('[PlaceOrder]', e);
        UI.showToast(e?.message || 'Could not place order. Please try again.');
    } finally {
        M._placing = false;
        btn.disabled = false;
        btn.textContent = 'PLACE ORDER';
    }
});

// ---------------------------------------------------------------
// ORDER TRACKING
// ---------------------------------------------------------------
function watchOrder(orderId) {
    if (M._orderUnsub) M._orderUnsub();
    M.currentOrderId = orderId;
    M._orderUnsub = onValue(outletRef(`orders/${orderId}`), (snap) => {
        const order = snap.val();
        if (!order) return;
        UI.renderTracking(orderId, order, Session.table.number);
    });
}

document.getElementById('btnMenuFromTracking')?.addEventListener('click', () => UI.showScreen('screenMenu'));
document.getElementById('btnOrderMore')?.addEventListener('click', () => UI.showScreen('screenMenu'));
document.getElementById('btnGotoCallWaiter')?.addEventListener('click', () => UI.showScreen('screenWaiter'));
document.getElementById('btnStartOrdering')?.addEventListener('click', () => UI.showScreen('screenMenu'));
document.getElementById('btnRequestBillFromTracking')?.addEventListener('click', async () => {
    haptic(20);
    if (Session.session?.status === 'expired') { UI.showScreen('screenSessionExpired'); return; }
    if (await _allOrdersServed()) {
        try {
            await set(push(outletRef('tableRequests')), {
                tableId: Session.tableId, tableNumber: Session.table.number,
                type: 'bill', status: 'pending', createdAt: Date.now()
            });
            UI.showToast('Bill requested — our team will process it shortly', 'success');
        } catch (e) {
            UI.showToast('Could not request bill. Please try again.', 'error');
        }
    } else {
        UI.showToast('Please wait until all orders are served before requesting the bill.', 'error');
    }
});

document.getElementById('btnBackToMenuFromBill')?.addEventListener('click', () => {
    UI.showScreen(UI.getPreviousScreen() || 'screenMenu');
});

// ---------------------------------------------------------------
// CALL WAITER
// ---------------------------------------------------------------
document.getElementById('btnBackFromWaiter')?.addEventListener('click', () => UI.showScreen('screenTracking'));
document.querySelectorAll('[data-request]').forEach(btn => {
    btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        haptic(15);
        touchSession();
        const type = btn.dataset.request;
        const labels = { waiter: 'Waiter called', water: 'Water requested', bill: 'Bill requested', clean: 'Table cleaning requested' };
        UI.setRequestSending(btn);
        try {
            if (type === 'bill') {
                if (!(await _allOrdersServed())) { UI.showToast('Please wait until all orders are served before requesting the bill.', 'error'); UI.resetRequestCard(btn); return; }
                await set(push(outletRef('tableRequests')), {
                    tableId: Session.tableId, tableNumber: Session.table.number,
                    type: 'bill', status: 'pending', createdAt: Date.now()
                });
                UI.setRequestSent(btn);
                haptic([10, 30, 10]);
                UI.showToast('Bill requested — our team will process it shortly', 'success');
                return;
            } else {
                await set(push(outletRef('tableRequests')), {
                    tableId: Session.tableId, tableNumber: Session.table.number,
                    type, status: 'pending', createdAt: Date.now()
                });
            }
            UI.setRequestSent(btn);
            haptic([10, 30, 10]);
            UI.showToast(labels[type] || 'Request sent', 'success');
        } catch (e) {
            UI.resetRequestCard(btn);
            UI.showToast('Could not send request. Please try again.', 'error');
        }
    });
});

// ---------------------------------------------------------------
// BOTTOM NAVIGATION (Menu / Cart / Status / History / Promos)
// ---------------------------------------------------------------
document.querySelectorAll('#bottomNav .bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        haptic(10);
        touchSession();
        const target = btn.dataset.bottomTab;
        if (target === 'screenCart') renderCartScreen();
        if (target === 'screenTracking') renderTrackingOrEmptyState();
        if (target === 'screenHistory') renderHistoryScreen();
        if (target === 'screenPromotions') renderPromotionsScreen();
        UI.showScreen(target);
    });
});
document.getElementById('btnCancelGroupChoice')?.addEventListener('click', () => {
    M._savedDraft = null;
    UI.showScreen('screenMenu');
});

function renderTrackingOrEmptyState() {
    if (M.currentOrderId) return;
    const groupOrders = getCurrentGroupOrders();
    const hasGroupOrders = groupOrders.length > 0;
    if (hasGroupOrders) {
        const lastOrderId = groupOrders[groupOrders.length - 1];
        watchOrder(lastOrderId);
        return;
    }
    document.getElementById('trackingOrderId').textContent = '';
    document.getElementById('trackingTableLabel').textContent = 'No orders yet';
    document.getElementById('trackerStepsContainer').innerHTML = `<div class="history-empty">Nothing to track yet.<br>Place an order from the menu first.</div>`;
    document.getElementById('trackingThanksCard').innerHTML = '';
    document.getElementById('sessionBillCard')?.classList.add('hidden');
}

function renderHistoryScreen() {
    const orderIds = getCurrentGroupOrders();
    // Cache is live (permanent onValue listeners in onSessionUpdated), so this
    // always reflects current status. The fallback fetch below handles the edge
    // case where a listener hasn't fired yet.
    UI.renderHistoryList(orderIds, M.ordersCache);
    const missing = orderIds.filter(oid => !M.ordersCache[oid]);
    if (missing.length > 0) {
        Promise.all(missing.map(oid => get(outletRef(`orders/${oid}`)).then(snap => { M.ordersCache[oid] = snap.val(); })))
            .then(() => UI.renderHistoryList(orderIds, M.ordersCache))
            .catch(() => {});
    }
}

let _storeSettingsCache = null;
async function renderPromotionsScreen() {
    if (!_storeSettingsCache) {
        const snap = await get(outletRef('settings/Store'));
        _storeSettingsCache = snap.val() || {};
    }
    UI.renderPromotionsLinks(_storeSettingsCache);

    // ── PWA Install / iOS / Notify Cards ────────────────────────────
    const installCard = document.getElementById('pwaInstallCard');
    const iosCard = document.getElementById('pwaIosCard');
    const notifyCard = document.getElementById('pwaNotifyCard');
    const installBtn = document.getElementById('btnPwaInstall');
    const notifyBtn = document.getElementById('btnPwaNotify');

    // Reset all
    installCard?.classList.add('hidden');
    iosCard?.classList.add('hidden');
    notifyCard?.classList.add('hidden');

    // Install card (Chromium only, when beforeinstallprompt is available)
    if (!isIOS() && canShowNativeInstallPrompt() && installCard && installBtn) {
        installCard.classList.remove('hidden');
        installBtn.onclick = async () => {
            haptic(15);
            const outcome = await promptInstall();
            if (outcome === 'accepted') {
                UI.showToast('App installed!', 'success');
                installCard.classList.add('hidden');
            }
        };
    }

    // iOS instructions card (iOS only, not yet standalone)
    if (isIOS() && !isStandalone() && iosCard) {
        iosCard.classList.remove('hidden');
    }

    // Notify card (all platforms)
    // On iOS, only show if already standalone (push requires install-first)
    // On Chromium, show regardless of install state
    const showNotify = isIOS() ? isStandalone() : true;
    if (showNotify && notifyCard && notifyBtn) {
        notifyCard.classList.remove('hidden');
        const phone = getStoredPhone();
        const alreadySubscribed = phone !== ''; // if phone exists, assume subscribed
        if (alreadySubscribed) {
            notifyCard.classList.add('sent');
            notifyBtn.style.display = 'none';
        }
        notifyBtn.onclick = async () => {
            haptic(15);
            let phone = getStoredPhone();
            if (!phone) {
                // First time: ask for phone via native prompt
                const input = prompt('Enter your mobile number for order updates:');
                if (!input) return;
                const saved = savePhone(input);
                if (!saved.ok) {
                    UI.showToast(saved.error, 'error');
                    return;
                }
                phone = saved.phone;
            }
            notifyBtn.disabled = true;
            notifyBtn.textContent = 'Enabling…';
            const result = await subscribeToNotifications();
            if (result.ok) {
                UI.showToast('Notifications enabled!', 'success');
                notifyCard.classList.add('sent');
                notifyBtn.style.display = 'none';
            } else {
                UI.showToast(result.error || 'Could not enable notifications', 'error');
                notifyBtn.disabled = false;
                notifyBtn.textContent = 'Enable';
            }
        };
    }
}

// Cleanup Firebase listeners on page unload
function _cleanupOrderListeners() {
    M._orderListeners.forEach((unsub) => unsub());
    M._orderListeners.clear();
    M.ordersCache = {};
}
document.getElementById('discountCodeInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btnApplyDiscount')?.click(); }
});

window.addEventListener('beforeunload', () => { cleanupSession(); _cleanupOrderListeners(); });
window.addEventListener('pagehide', () => { cleanupSession(); _cleanupOrderListeners(); });
window.addEventListener('popstate', UI.handlePopState);

// Boot
boot().catch(err => {
    console.error('[Boot]', err);
    if (!_bootReady) _showConnectionIssue();
});
