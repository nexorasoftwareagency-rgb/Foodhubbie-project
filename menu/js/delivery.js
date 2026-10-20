/**
 * Menu/js/delivery.js
 * Delivery storefront — same catalog/cart/customize/promotions UX as the
 * dine-in QR app (menu/js/app.js), minus table/session concepts, plus
 * delivery-specific fields (address + location) and a direct order write
 * (menu/js/delivery-order.js) instead of a table-session attach.
 */
import { outletRef, get, set as fbSet, OUTLET, update, runTransaction } from './firebase.js';
import { Cart, addLine, setQty, clearCart, lineCount, subtotal as cartSubtotal, isEmpty as cartIsEmpty, restoreCart, getWebviewStorageKey } from './cart.js';
import * as UI from './ui.js';
import { haptic } from './ui.js';
import { esc } from './ui.js';
import { comboPriceTotal, bakeComboUnitPrices, isComboActive } from '../../shared/combo-math.js';
import { validateCoupon } from './discount.js';
import { placeDeliveryOrder } from './delivery-order.js';
import { calculateDistance, getFeeFromSlabs } from './geo.js';
import { initCustomer, maybeStartOnboarding, renderCustomerPromotions, rememberIdentity, getProfile, openNotificationsTab } from './customer.js';

const M = {
    categories: [], dishes: [], combos: [],
    activeCategory: 'all',
    sortKey: 'popularity',
    draftDish: null, draftSize: null, draftAddons: [], draftQty: 1,
    appliedDiscount: null,
    location: null,          // { lat, lng } — set once geolocation permission is granted
    _placing: false,
    // URL params — set from ?session=X&src=wa&bot=918921737&token=abc123
    sessionId: '',
    source: 'direct',
    botPhone: '',
    token: '',
    _tokenValid: false,
};

// Parse URL params on load
(function parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    M.sessionId = params.get('session') || '';
    M.source = params.get('src') || 'direct';
    M.botPhone = params.get('bot') || '';
    M.token = params.get('token') || '';
})();

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
async function boot() {
    try {
        // Restore cart scoped to this webview token (isolated from QR and other webview links)
        const webviewKey = getWebviewStorageKey(M.token);
        restoreCart(webviewKey);
        try {
            const nameSnap = await get(outletRef('settings/Store/storeName'));
            if (nameSnap.exists()) UI.applyBrand(nameSnap.val());
        } catch (_) { /* non-critical — keep static brand on failure */ }
        await loadMenu();
        UI.showScreen('screenMenu');
        document.getElementById('bottomNav')?.classList.remove('hidden');
        wireBottomNav();
        refreshCartUi();

        // Validate one-time token
        if (M.token) {
            const tokenSnap = await get(outletRef(`webviewTokens/${M.token}`));
            const tokenData = tokenSnap.val();
            if (!tokenData) {
                _showTokenError('This link is invalid or expired. Please ask for a new link from the bot.');
                return;
            }
            if (tokenData.used) {
                _showTokenError('This link has already been used. Please ask for a new link from the bot.');
                return;
            }
            const ageMs = Date.now() - new Date(tokenData.createdAt).getTime();
            // Match bot's WEBVIEW_TOKEN_REUSE_MS (30 min) — token not reused after this,
            // and client should enforce same window for consistency.
            if (ageMs > 30 * 60 * 1000) {
                _showTokenError('This link has expired. Please ask for a new link from the bot.');
                return;
            }
            M._tokenValid = true;
        }

        initCustomer({ mode: 'delivery' });
        const profile = getProfile();
        if (profile) {
            const nameInput = document.getElementById('checkoutName');
            const phoneInput = document.getElementById('checkoutPhone');
            if (nameInput && !nameInput.value) nameInput.value = profile.name || '';
            if (phoneInput && !phoneInput.value) phoneInput.value = profile.phone || '';
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') === 'notifications' || params.get('order')) {
            openNotificationsTab();
            UI.showScreen('screenPromotions');
            renderPromotionsScreen();
        }
        if (!params.get('order') && params.get('tab') !== 'notifications') {
            maybeStartOnboarding({ mode: 'delivery' });
        }
    } catch (e) {
        console.error('[Delivery] boot failed', e);
        UI.showToast('Could not load the menu — please retry.', 'error');
    } finally {
        document.getElementById('loadingOverlay')?.classList.add('hidden');
    }
}

function _showTokenError(msg) {
    document.getElementById('loadingOverlay')?.classList.add('hidden');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('bottomNav')?.classList.add('hidden');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
    overlay.innerHTML = `
        <div style="font-size:64px;margin-bottom:16px;">🔗</div>
        <h2 style="font-size:20px;font-weight:800;margin:0 0 8px;color:#1a1a1a;">Link Unavailable</h2>
        <p style="font-size:14px;color:#666;margin:0 0 24px;max-width:300px;">${msg}</p>
        ${M.botPhone ? `<a href="https://wa.me/${M.botPhone.replace(/\D/g, '')}?text=${encodeURIComponent('hii')}" style="display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;font-size:15px;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Chat with Bot
        </a>` : ''}
    `;
    document.body.appendChild(overlay);
}

function wireBottomNav() {
    document.querySelectorAll('#bottomNav .bottom-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.bottomTab;
            if (target === 'screenCart') openCart();
            else if (target === 'screenPromotions') renderPromotionsScreen();
            UI.showScreen(target);
        });
    });
}

async function loadMenu() {
    const [catSnap, dishSnap, comboSnap] = await Promise.all([
        get(outletRef('categories')), get(outletRef('dishes')), get(outletRef('combos'))
    ]);
    M.categories = Object.entries(catSnap.val() || {}).map(([id, c]) => ({ id, ...c }));
    M.dishes = Object.entries(dishSnap.val() || {}).filter(([, d]) => d.stock !== false).map(([id, d]) => ({ id, ...d }));
    const now = Date.now();
    M.combos = Object.entries(comboSnap.val() || {})
        .filter(([, c]) => isComboActive(c, now))
        .map(([id, c]) => ({ id, ...c }));
    renderMenuScreen();
    renderRecentSearches();
}

function renderMenuScreen(searchTerm) {
    UI.renderCategoryPills(M.categories, M.activeCategory, (catId) => {
        M.activeCategory = catId;
        const input = document.getElementById('dishSearchInput');
        if (input) input.value = '';
        renderMenuScreen();
    });

    const combosOnly = M.activeCategory === '__combos';
    _renderComboOffers();

    let dishes = M.dishes;
    if (M.activeCategory !== 'all' && !combosOnly) {
        const activeCat = M.categories.find(c => c.id === M.activeCategory);
        if (activeCat) dishes = dishes.filter(d => d.category === activeCat.name);
    }
    if (searchTerm) dishes = dishes.filter(d => (d.name || '').toLowerCase().includes(searchTerm.toLowerCase()));

    if (M.sortKey === 'price-asc') {
        dishes = [...dishes].sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (M.sortKey === 'price-desc') {
        dishes = [...dishes].sort((a, b) => (b.price || 0) - (a.price || 0));
    }

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
        UI.showComboSheet({
            name: combo.name,
            discLabel: cd.disc,
            saving: cd.saving,
            price: cd.comboPrice,
            rows: cd.entries.map((e, i) => ({ name: e.dish.name, qty: e.qty, unitPrice: cd.prices[i] }))
        }, () => _addComboToCart(combo.id));
        });
    }
}

async function _addComboToCart(comboId) {
    const combo = M.combos.find(c => c.id === comboId);
    if (!combo) return;
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
        const ref = outletRef(`combos/${combo.id}/currentRedemptions`);
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
        const customerId = M.sessionId || 'default';
        const ref = outletRef(`combos/${combo.id}/redemptionsByCustomer/${customerId}`);
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
        const ref = outletRef(`combos/${combo.id}/redemptionsByDay/${today}`);
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
        refreshCartUi();
    } else {
        UI.showToast('Combo dishes unavailable');
    }
}

let _searchTimer;
document.getElementById('dishSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(_searchTimer);
    const val = e.target.value.trim();
    _searchTimer = setTimeout(() => renderMenuScreen(val), 150);
});
document.getElementById('menuSortSelect')?.addEventListener('change', (e) => {
    M.sortKey = e.target.value;
    renderMenuScreen(document.getElementById('dishSearchInput').value.trim());
});

// --- Recent searches ---
function _getRecentSearches() {
    try { return JSON.parse(sessionStorage.getItem('recentSearches') || '[]'); } catch (_) { return []; }
}
function _saveRecentSearch(term) {
    if (!term || term.length < 2) return;
    let recent = _getRecentSearches();
    recent = recent.filter(t => t !== term);
    recent.unshift(term);
    if (recent.length > 8) recent.pop();
    try { sessionStorage.setItem('recentSearches', JSON.stringify(recent)); } catch (_) {}
    renderRecentSearches();
}
function renderRecentSearches() {
    const container = document.getElementById('recentSearches');
    if (!container) return;
    const recent = _getRecentSearches();
    if (!recent.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = recent.map(term => `
        <div class="recent-search-chip" data-search-term="${esc(term)}">
            ${esc(term)} <span class="remove" title="Remove">×</span>
        </div>`).join('');
    container.querySelectorAll('.recent-search-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const term = btn.dataset.searchTerm;
            const input = document.getElementById('dishSearchInput');
            if (input) { input.value = term; input.focus(); }
            renderMenuScreen(term);
        });
        btn.querySelector('.remove')?.addEventListener('click', (e) => {
            e.stopPropagation();
            let recent = _getRecentSearches();
            recent = recent.filter(t => t !== btn.dataset.searchTerm);
            try { sessionStorage.setItem('recentSearches', JSON.stringify(recent)); } catch (_) {}
            renderRecentSearches();
        });
    });
}
const _origSearchInput2 = document.getElementById('dishSearchInput');
if (_origSearchInput2) {
    _origSearchInput2.addEventListener('input', () => {
        const val = _origSearchInput2.value.trim();
        if (val) _saveRecentSearch(val);
    });
}

// ---------------------------------------------------------------
// Customize (identical to app.js)
// ---------------------------------------------------------------
function _normalizeSizes(sizes, defaultPrice) {
    if (!sizes) return [{ label: 'Regular', price: defaultPrice }];
    if (Array.isArray(sizes)) return sizes;
    return Object.entries(sizes).map(([label, price]) => ({ label, price: typeof price === 'number' ? price : (price.price || defaultPrice) }));
}

function openCustomize(dishId) {
    const dish = M.dishes.find(d => d.id === dishId);
    if (!dish) return;
    M.draftDish = dish;
    const sizes = _normalizeSizes(dish.sizes, dish.price);
    M.draftSize = sizes[0];
    M.draftAddons = [];
    M.draftQty = 1;

    const heroImg = document.getElementById('customHeroImg');
    if (heroImg && dish.image) heroImg.src = dish.image;
    document.getElementById('customDishName').textContent = dish.name || '';
    const descEl = document.getElementById('customDishDesc');
    if (descEl) {
        descEl.textContent = dish.description || '';
        descEl.style.display = dish.description ? '' : 'none';
    }
    document.getElementById('specialInstructions').value = '';
    renderCustomizeScreen();
    UI.showScreen('screenCustomize');
}

function renderCustomizeScreen() {
    const sizes = _normalizeSizes(M.draftDish.sizes, M.draftDish.price);
    document.getElementById('customBasePrice').textContent = UI.fmtMoney(M.draftSize.price);
    UI.renderSizeOptions(sizes, M.draftSize.label, (idx) => { M.draftSize = sizes[idx]; renderCustomizeScreen(); });
    UI.renderAddonRows(M.draftDish.addons || [], M.draftAddons, (idx) => {
        const pos = M.draftAddons.indexOf(idx);
        if (pos >= 0) M.draftAddons.splice(pos, 1); else M.draftAddons.push(idx);
        renderCustomizeScreen();
    });
    document.getElementById('draftQtyVal').textContent = String(M.draftQty);
}

document.getElementById('btnBackFromCustomize')?.addEventListener('click', () => UI.showScreen('screenMenu'));
document.getElementById('btnOpenCartFromCustomize')?.addEventListener('click', openCart);
document.getElementById('btnDraftQtyMinus')?.addEventListener('click', () => { M.draftQty = Math.max(1, M.draftQty - 1); renderCustomizeScreen(); });
document.getElementById('btnDraftQtyPlus')?.addEventListener('click', () => { M.draftQty = Math.min(50, M.draftQty + 1); renderCustomizeScreen(); });

document.getElementById('btnAddToOrder')?.addEventListener('click', () => {
    const dish = M.draftDish;
    const addonObjs = M.draftAddons.map(i => (dish.addons || [])[i]).filter(Boolean);
    addLine({
        dishId: dish.id,
        name: dish.name,
        img: dish.image || '',
        size: M.draftSize.label,
        addons: addonObjs.map(a => a.name),
        addonPrices: addonObjs.map(a => a.price),
        unitPrice: M.draftSize.price + addonObjs.reduce((s, a) => s + (a.price || 0), 0),
        qty: M.draftQty,
        instructions: document.getElementById('specialInstructions').value.trim(),
    });
    haptic(15);
    UI.showToast(`${dish.name} added to cart`, 'success');
    clearDiscountIfCartChanged();
    refreshCartUi();
    UI.showScreen('screenMenu');
});

// ---------------------------------------------------------------
// Cart (mirrors app.js's cart section, minus tax/service-charge —
// bot/index.js's Online orders never carry tax, only Dine-in does)
// ---------------------------------------------------------------
function refreshCartUi() {
    const count = lineCount();
    UI.updateCartBadges(count);
    UI.updateCartBar(count, cartSubtotal());
    if (document.getElementById('screenCart')?.classList.contains('active')) renderCartScreen();
}

// Delivery fee: same settings → slabs → distance calc as delivery-order.js and
// bot/index.js, so the cart row always matches the final placed order.
let _deliveryFeeCache = null;
let _deliveryFee = 0;
async function ensureDeliveryFee() {
    if (M.location) {
        if (_deliveryFeeCache) {
            _deliveryFee = _deliveryFeeCache;
        } else {
            try {
                const [delSnap, storeSnap] = await Promise.all([
                    get(outletRef('settings/Delivery/slabs')),
                    get(outletRef('settings/Store')),
                ]);
                const delSettings = delSnap.val() || [];
                const storeSettings = storeSnap.val() || {};
                const outletCoords = {
                    lat: parseFloat(storeSettings.lat ?? (OUTLET === 'cake' ? 25.887472 : 25.887944)),
                    lng: parseFloat(storeSettings.lng ?? (OUTLET === 'cake' ? 85.026861 : 85.026194)),
                };
                const dist = calculateDistance(M.location.lat, M.location.lng, outletCoords.lat, outletCoords.lng);
                _deliveryFee = getFeeFromSlabs(dist, delSettings);
                _deliveryFeeCache = _deliveryFee;
            } catch (e) {
                console.error('[Delivery] fee calc failed', e);
                _deliveryFeeCache = null;
                _deliveryFee = 0;
                UI.showToast('Could not calculate delivery fee — check outlet settings', 'error');
            }
        }
    }
    renderCartScreen();
}

function renderCartScreen() {
    UI.renderCartList(Cart.lines, {
        onStep: (lineId, delta) => {
            const line = Cart.lines[lineId];
            if (!line) return;
            setQty(lineId, line.qty + delta);
            clearDiscountIfCartChanged();
            renderCartScreen();
            refreshCartUi();
        }
    });
    UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, [], _deliveryFee);
    updatePlaceOrderAvailability();
}

function openCart() { renderCartScreen(); UI.showScreen('screenCart'); ensureDeliveryFee(); }
document.getElementById('btnOpenCartFromMenu')?.addEventListener('click', openCart);
document.getElementById('btnViewCartBar')?.addEventListener('click', openCart);
document.getElementById('btnBackFromCart')?.addEventListener('click', () => UI.showScreen('screenMenu'));

// ---- Discount code (identical wiring to app.js, reusing discount.js) ----
function _clearDiscount() {
    M.appliedDiscount = null;
    UI.resetDiscountInput();
}
function clearDiscountIfCartChanged() {
    if (M.appliedDiscount) _clearDiscount();
}

document.getElementById('btnApplyDiscount')?.addEventListener('click', async () => {
    const input = document.getElementById('discountCodeInput');
    if (!input) return;

    if (M.appliedDiscount) { _clearDiscount(); UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, [], _deliveryFee); return; }

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
        UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, [], _deliveryFee);
        UI.showAppliedDiscount(result.name || result.couponCode, result.amount, result.mode, result.value);
        UI.setDiscountInputLoading(false);
        updatePlaceOrderAvailability();
    } catch (e) {
        console.error('[Discount]', e);
        UI.showDiscountMsg('Could not verify code. Try again.', 'error');
        UI.setDiscountInputLoading(false);
    }
});

// ---------------------------------------------------------------
// Location — requested on page load (real-app pattern), re-offered if
// denied, and the ONLY thing gating "PLACE ORDER".
// ---------------------------------------------------------------
// DIAGNOSTIC — only renders when the URL has ?debug=1 (customers never see it).
function _diag(msg) {
    if (!new URLSearchParams(location.search).has('debug')) return;
    let el = document.getElementById('geoDiag');
    if (!el) {
        el = document.createElement('div');
        el.id = 'geoDiag';
        el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#000;color:#0f0;font:11px/1.45 monospace;padding:8px;border-radius:8px;max-height:45vh;overflow:auto;white-space:pre-wrap;word-break:break-all;';
        document.body.appendChild(el);
    }
    el.textContent += (el.textContent ? '\n' : '') + msg;
    el.scrollTop = el.scrollHeight;
}

function requestLocationPermission() {
    if (!navigator.geolocation) {
        _diag('geo=ABSENT');
        showLocationBanner("Location isn't supported on this device — the delivery fee can't be calculated automatically.");
        return;
    }
    _diag('env geo=1 perm=' + (!!navigator.permissions) + ' iframe=' + (window.top !== window.self) + ' sw=' + (!!(navigator.serviceWorker && navigator.serviceWorker.controller)));
    _diag('ua=' + navigator.userAgent);

    if (navigator.permissions?.query) {
        let qResolved = false;
        navigator.permissions.query({ name: 'geolocation' }).then((status) => {
            qResolved = true;
            _diag('permState=' + status.state);
            if (status.state === 'denied') { showLocationBlockedHelp(); return; }
            _callGetLocation();
        }).catch((e) => { _diag('permQueryErr=' + (e && e.message)); _callGetLocation(); });
        setTimeout(() => { if (!qResolved) { _diag('permQuery STUCK >2s → calling getCurrentPosition anyway'); _callGetLocation(); } }, 2000);
    } else {
        _diag('perm API absent → direct getCurrentPosition');
        _callGetLocation();
    }
}

function _callGetLocation() {
    const t0 = Date.now();
    let settled = false;
    const hb = setInterval(() => { if (!settled) _diag('waiting ' + ((Date.now() - t0) / 1000).toFixed(1) + 's...'); }, 1000);
    setTimeout(() => { if (!settled) _diag('WATCHDOG: 10s no callback from getCurrentPosition'); }, 10000);
    _diag('getCurrentPosition() called');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            settled = true; clearInterval(hb);
            _diag('SUCCESS ' + pos.coords.latitude + ',' + pos.coords.longitude);
            M.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            hideLocationBanner();
            closeLocDialog();
            updatePlaceOrderAvailability();
            ensureDeliveryFee();
        },
        (err) => {
            settled = true; clearInterval(hb);
            _diag('ERROR code=' + err.code + ' msg=' + err.message);
            if (err.code === 1) { showLocationBlockedHelp(); return; }
            const statusEl = document.getElementById('locDialogStatus');
            if (statusEl) statusEl.textContent = 'Could not get your location. Check that Location is ON in phone Settings, then try again.';
        },
        // ponytail: network fix (fast) over GPS (slow) — was enableHighAccuracy:true, timeout:10000
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
    );
}

function showLocationBlockedHelp() {
    const statusEl = document.getElementById('locDialogStatus');
    if (statusEl) {
        statusEl.innerHTML = `
            <div style="text-align:left;font-size:13px;line-height:1.6;">
                <strong>Location is blocked in Chrome for this site.</strong><br><br>
                1. Tap the <strong>&#128274; lock icon</strong> in the address bar above.<br>
                2. Tap <strong>Permissions &rarr; Location</strong>.<br>
                3. Select <strong>Allow</strong>.<br>
                4. Then tap the button below to reload.<br><br>
                Also verify: phone <strong>Settings &rarr; Location</strong> is ON.
            </div>`;
    }
    const grantBtn = document.getElementById('btnLocGrant');
    if (grantBtn) {
        grantBtn.textContent = "I've Allowed It — Reload";
        grantBtn.dataset.reload = '1';
    }
}

function showLocationBanner(text) {
    const el = document.getElementById('locationBanner');
    if (!el) return;
    el.innerHTML = `
        <span class="loc-icon">📍</span>
        <span class="loc-text">
            <strong>Location Required for Delivery</strong>
            ${text}
        </span>
        <button type="button" class="loc-banner-btn">Enable</button>
    `;
    el.querySelector('.loc-banner-btn')?.addEventListener('click', () => openLocDialog());
    el.classList.remove('hidden');
}

function hideLocationBanner() {
    document.getElementById('locationBanner')?.classList.add('hidden');
}

// Location Permission Dialog
function openLocDialog() {
    const overlay = document.getElementById('locDialogOverlay');
    if (overlay) {
        overlay.classList.add('open');
        const statusEl = document.getElementById('locDialogStatus');
        if (statusEl) statusEl.textContent = '';
        // Reset grant button from blocked-help state back to normal
        const grantBtn = document.getElementById('btnLocGrant');
        if (grantBtn) {
            grantBtn.textContent = 'Allow Location Access';
            delete grantBtn.dataset.reload;
        }
    }
}

function closeLocDialog() {
    const overlay = document.getElementById('locDialogOverlay');
    if (overlay) overlay.classList.remove('open');
}

// Dialog button handlers
document.getElementById('btnLocGrant')?.addEventListener('click', (e) => {
    // If showLocationBlockedHelp set the reload flag, reload instead of re-requesting
    if (e.currentTarget.dataset.reload) { location.reload(); return; }
    const statusEl = document.getElementById('locDialogStatus');
    if (statusEl) statusEl.textContent = 'Requesting location...';
    requestLocationPermission();
});

document.getElementById('btnLocDismiss')?.addEventListener('click', () => {
    closeLocDialog();
    // Optionally show banner again if no location
    if (!M.location) {
        showLocationBanner('Location access is needed to deliver to you and calculate the delivery fee.');
    }
});

// Close dialog on overlay click
document.getElementById('locDialogOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'locDialogOverlay') closeLocDialog();
});

function updatePlaceOrderAvailability() {
    const btn = document.getElementById('btnPlaceOrder');
    if (!btn) return;
    if (M.location) {
        btn.disabled = false;
        btn.textContent = 'PLACE ORDER';
        btn.onclick = null; // Use default click handler
    } else {
        btn.disabled = false; // NOT disabled — clicking opens dialog
        btn.textContent = 'ENABLE LOCATION TO ORDER';
        btn.onclick = (e) => { e.preventDefault(); openLocDialog(); };
    }
}

// ---------------------------------------------------------------
// Promotions screen (identical to app.js)
// ---------------------------------------------------------------
let _storeSettingsCache = null;
async function renderPromotionsScreen() {
    if (!_storeSettingsCache) {
        const snap = await get(outletRef('settings/Store'));
        _storeSettingsCache = snap.val() || {};
    }
    UI.renderPromotionsLinks(_storeSettingsCache);
    await renderCustomerPromotions(_storeSettingsCache, 'delivery');
}

document.getElementById('btnPlaceOrder')?.addEventListener('click', async (e) => {
    if (M._placing) return;
    if (cartIsEmpty()) { UI.showToast('Your cart is empty', 'error'); return; }
    // If no location, button onclick already opens dialog — just bail
    if (!M.location) return;
    // Block if token is invalid/used
    if (M.token && !M._tokenValid) { UI.showToast('This link is no longer valid. Ask the bot for a new one.', 'error'); return; }

    // Ensure delivery fee is calculated before allowing order
    await ensureDeliveryFee();
    if (!_deliveryFeeCache) {
        UI.showToast('Delivery fee not ready — please wait', 'error');
        openCart();
        return;
    }

    const name = document.getElementById('checkoutName').value.trim();
    const phoneRaw = document.getElementById('checkoutPhone').value.trim();
    const address = document.getElementById('checkoutAddress').value.trim();
    const note = document.getElementById('checkoutNote').value.trim();

    if (!name) { UI.showToast('Please enter your name', 'error'); return; }
    const phone = phoneRaw.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) { UI.showToast('Please enter a valid 10-digit mobile number', 'error'); return; }
    if (!address) { UI.showToast('Please enter your delivery address', 'error'); return; }

    M._placing = true;
    rememberIdentity(name, phone);
    // ponytail: invalidate token IMMEDIATELY on click to prevent double-submit race
    // (guard at line 425 checks _tokenValid; doing it here beats any race to the write)
    if (M.token) M._tokenValid = false;
    const btn = document.getElementById('btnPlaceOrder');
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Placing your order…';

    try {
        const { total } = await placeDeliveryOrder({
            cartLines: Object.values(Cart.lines),
            customerName: name,
            customerPhone: phone,
            address,
            location: M.location,
            note,
            discount: M.appliedDiscount,
            sessionId: M.sessionId,
            source: M.source,
            botPhone: M.botPhone,
            webviewToken: M.token,
        });

        // Clear cart scoped to this webview token
        const webviewKey = getWebviewStorageKey(M.token);
        clearCart(webviewKey);
        M.appliedDiscount = null;
        haptic([10, 30, 10]);

        // Mark token as used so this URL can't be reused
        if (M.token) {
            fbSet(outletRef(`webviewTokens/${M.token}/used`), true).catch(() => {});
            M._tokenValid = false;
        }

        // If from WhatsApp (src=wa), show success screen with "Back to WhatsApp" button
        if (M.source === 'wa' && M.botPhone) {
            showOrderSuccess(total, M.botPhone);
        } else {
            UI.showToast(`Order placed! Total ₹${total} — check WhatsApp for updates.`, 'success');
            UI.showScreen('screenMenu');
            refreshCartUi();
        }
    } catch (e) {
        console.error('[Delivery] checkout failed', e);
        UI.showToast(e.message || 'Something went wrong — please try again', 'error');
    } finally {
        btn.disabled = !M.location;
        btn.textContent = M.location ? 'PLACE ORDER' : 'ENABLE LOCATION TO ORDER';
        M._placing = false;
    }
});

// ---------------------------------------------------------------
// Order Success Screen (WhatsApp flow)
// ---------------------------------------------------------------
function showOrderSuccess(total, botPhone) {
    // Hide all screens, show a custom success overlay
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('bottomNav')?.classList.add('hidden');

    const overlay = document.createElement('div');
    overlay.id = 'orderSuccessOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;';
    overlay.innerHTML = `
        <div style="font-size:64px;margin-bottom:16px;">✅</div>
        <h2 style="font-size:22px;font-weight:800;margin:0 0 8px;color:#1a1a1a;">Order Placed!</h2>
        <p style="font-size:15px;color:#666;margin:0 0 4px;">Total: ₹${total}</p>
        <p style="font-size:13px;color:#999;margin:0 0 24px;">Check WhatsApp for updates</p>
        <a href="https://wa.me/${botPhone.replace(/\D/g, '')}?text=${encodeURIComponent('hii')}" 
           style="display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;font-size:16px;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Back to WhatsApp
        </a>
        <p style="font-size:11px;color:#aaa;margin-top:20px;">You'll receive order updates there</p>
    `;
    document.body.appendChild(overlay);
}

// ---------------------------------------------------------------
// Connectivity banner
// ---------------------------------------------------------------
document.getElementById('btnRetryConnection')?.addEventListener('click', () => window.location.reload());

window.addEventListener('fh:open-order', () => {
    openNotificationsTab();
    UI.showScreen('screenPromotions');
    renderPromotionsScreen();
});

boot();
