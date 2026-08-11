/**
 * Menu/js/delivery.js
 * Delivery storefront — same catalog/cart/customize/promotions UX as the
 * dine-in QR app (menu/js/app.js), minus table/session concepts, plus
 * delivery-specific fields (address + location) and a direct order write
 * (menu/js/delivery-order.js) instead of a table-session attach.
 */
import { outletRef, get, OUTLET } from './firebase.js';
import { Cart, addLine, setQty, clearCart, lineCount, subtotal as cartSubtotal, isEmpty as cartIsEmpty, restoreCart } from './cart.js';
import * as UI from './ui.js';
import { haptic } from './ui.js';
import { validateCoupon } from './discount.js';
import { placeDeliveryOrder } from './delivery-order.js';

const M = {
    categories: [], dishes: [],
    activeCategory: 'all',
    draftDish: null, draftSize: null, draftAddons: [], draftQty: 1,
    appliedDiscount: null,
    location: null,          // { lat, lng } — set once geolocation permission is granted
    _placing: false,
};

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
async function boot() {
    try {
        restoreCart();
        requestLocationPermission();       // fire on load, like a real delivery app
        await loadMenu();
        UI.showScreen('screenMenu');
        document.getElementById('bottomNav')?.classList.remove('hidden');
        wireBottomNav();
        refreshCartUi();
    } catch (e) {
        console.error('[Delivery] boot failed', e);
        UI.showToast('Could not load the menu — please retry.', 'error');
    } finally {
        document.getElementById('loadingOverlay')?.classList.add('hidden');
    }
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
    const [catSnap, dishSnap] = await Promise.all([get(outletRef('categories')), get(outletRef('dishes'))]);
    M.categories = Object.entries(catSnap.val() || {}).map(([id, c]) => ({ id, ...c }));
    M.dishes = Object.entries(dishSnap.val() || {}).filter(([, d]) => d.available !== false).map(([id, d]) => ({ id, ...d }));
    renderMenuScreen();
}

function renderMenuScreen(searchTerm) {
    UI.renderCategoryPills(M.categories, M.activeCategory, (catId) => {
        M.activeCategory = catId;
        const input = document.getElementById('dishSearchInput');
        if (input) input.value = '';
        renderMenuScreen();
    });

    let dishes = M.dishes;
    if (M.activeCategory !== 'all') {
        const activeCat = M.categories.find(c => c.id === M.activeCategory);
        if (activeCat) dishes = dishes.filter(d => d.category === activeCat.name);
    }
    if (searchTerm) dishes = dishes.filter(d => (d.name || '').toLowerCase().includes(searchTerm.toLowerCase()));

    const activeCategoryName = M.activeCategory === 'all' ? 'Popular Items' : (M.categories.find(c => c.id === M.activeCategory)?.name || 'Items');
    UI.renderDishList(dishes, { searchTerm, activeCategoryName }, openCustomize);
}

let _searchTimer;
document.getElementById('dishSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(_searchTimer);
    const val = e.target.value.trim();
    _searchTimer = setTimeout(() => renderMenuScreen(val), 150);
});

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
    UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, []);
    updatePlaceOrderAvailability();
}

function openCart() { renderCartScreen(); UI.showScreen('screenCart'); }
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

    if (M.appliedDiscount) { _clearDiscount(); UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, []); return; }

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
        UI.updateCartTotals(cartSubtotal(), 0, '', false, false, '', 0, M.appliedDiscount, []);
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
function requestLocationPermission() {
    if (!navigator.geolocation) { showLocationBanner("Location isn't supported on this device — you can still type your address, but delivery fee can't be calculated automatically."); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            M.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            hideLocationBanner();
            updatePlaceOrderAvailability();
        },
        () => { showLocationBanner('Location access is needed to deliver to you and calculate the delivery fee.'); },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}
function showLocationBanner(text) {
    const el = document.getElementById('locationBanner');
    if (!el) return;
    el.textContent = text + ' ';
    const btn = document.createElement('button');
    btn.textContent = 'Enable Location';
    btn.type = 'button';
    btn.className = 'loc-banner-btn';
    btn.addEventListener('click', requestLocationPermission);
    el.appendChild(btn);
    el.classList.remove('hidden');
}
function hideLocationBanner() {
    document.getElementById('locationBanner')?.classList.add('hidden');
}

function updatePlaceOrderAvailability() {
    const btn = document.getElementById('btnPlaceOrder');
    if (!btn) return;
    btn.disabled = !M.location;
    btn.textContent = M.location ? 'PLACE ORDER' : 'ENABLE LOCATION TO ORDER';
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
}

// ---------------------------------------------------------------
// Place Order — direct write (menu/js/delivery-order.js), no chat handoff
// ---------------------------------------------------------------
document.getElementById('btnPlaceOrder')?.addEventListener('click', async () => {
    if (M._placing) return;
    if (cartIsEmpty()) { UI.showToast('Your cart is empty', 'error'); return; }
    if (!M.location) { requestLocationPermission(); UI.showToast('Please enable location to continue', 'error'); return; }

    const name = document.getElementById('checkoutName').value.trim();
    const phoneRaw = document.getElementById('checkoutPhone').value.trim();
    const address = document.getElementById('checkoutAddress').value.trim();
    const note = document.getElementById('checkoutNote').value.trim();

    if (!name) { UI.showToast('Please enter your name', 'error'); return; }
    const phone = phoneRaw.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) { UI.showToast('Please enter a valid 10-digit mobile number', 'error'); return; }
    if (!address) { UI.showToast('Please enter your delivery address', 'error'); return; }

    M._placing = true;
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
        });

        clearCart();
        M.appliedDiscount = null;
        UI.showToast(`Order placed! Total ₹${total} — check WhatsApp for updates.`, 'success');
        haptic([10, 30, 10]);
        UI.showScreen('screenMenu');
        refreshCartUi();
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
// Connectivity banner
// ---------------------------------------------------------------
document.getElementById('btnRetryConnection')?.addEventListener('click', () => window.location.reload());

boot();
