/**
 * Menu/js/delivery.js
 * Delivery storefront — same catalog/cart/customize/promotions UX as the
 * dine-in QR app (menu/js/app.js), minus table/session concepts, plus
 * delivery-specific fields (address + location) and a direct order write
 * (menu/js/delivery-order.js) instead of a table-session attach.
 */
import { outletRef, get, set as fbSet, OUTLET } from './firebase.js';
import { Cart, addLine, setQty, clearCart, lineCount, subtotal as cartSubtotal, isEmpty as cartIsEmpty, restoreCart } from './cart.js';
import * as UI from './ui.js';
import { haptic } from './ui.js';
import { validateCoupon } from './discount.js';
import { placeDeliveryOrder } from './delivery-order.js';
import { calculateDistance, getFeeFromSlabs } from './geo.js';

const M = {
    categories: [], dishes: [],
    activeCategory: 'all',
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
        restoreCart();
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
            if (ageMs > 60 * 60 * 1000) {
                _showTokenError('This link has expired. Please ask for a new link from the bot.');
                return;
            }
            M._tokenValid = true;
        }

        // Show location banner on boot — don't call requestLocationPermission()
        // directly here because mobile browsers block geolocation requests
        // not triggered by a user gesture.
        if (!M.location) {
            showLocationBanner('Location access is needed to deliver to you and calculate the delivery fee.');
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
    const [catSnap, dishSnap] = await Promise.all([get(outletRef('categories')), get(outletRef('dishes'))]);
    M.categories = Object.entries(catSnap.val() || {}).map(([id, c]) => ({ id, ...c }));
    M.dishes = Object.entries(dishSnap.val() || {}).filter(([, d]) => d.stock !== false).map(([id, d]) => ({ id, ...d }));
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
function requestLocationPermission() {
    if (!navigator.geolocation) {
        showLocationBanner("Location isn't supported on this device — you can still type your address, but delivery fee can't be calculated automatically.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            M.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            hideLocationBanner();
            closeLocDialog();
            updatePlaceOrderAvailability();
            ensureDeliveryFee();
        },
        (err) => {
            console.warn('[Location] Permission denied or error:', err.message);
            const statusEl = document.getElementById('locDialogStatus');
            if (statusEl) statusEl.textContent = 'Location access denied. You can still order by entering your address manually.';
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
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
    }
}

function closeLocDialog() {
    const overlay = document.getElementById('locDialogOverlay');
    if (overlay) overlay.classList.remove('open');
}

// Dialog button handlers
document.getElementById('btnLocGrant')?.addEventListener('click', () => {
    const statusEl = document.getElementById('locDialogStatus');
    if (statusEl) statusEl.textContent = 'Requesting location...';
    requestLocationPermission();
});

document.getElementById('btnLocSkip')?.addEventListener('click', () => {
    closeLocDialog();
    // Focus on address field so user can type manually
    const addressField = document.getElementById('checkoutAddress');
    if (addressField) addressField.focus();
    UI.showToast('Enter your delivery address manually', 'info');
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
}

// ---------------------------------------------------------------
// Place Order — direct write (menu/js/delivery-order.js), no chat handoff
// ---------------------------------------------------------------
document.getElementById('btnPlaceOrder')?.addEventListener('click', async (e) => {
    if (M._placing) return;
    if (cartIsEmpty()) { UI.showToast('Your cart is empty', 'error'); return; }
    // If no location, button onclick already opens dialog — just bail
    if (!M.location) return;
    // Block if token is invalid/used
    if (M.token && !M._tokenValid) { UI.showToast('This link is no longer valid. Ask the bot for a new one.', 'error'); return; }

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
            sessionId: M.sessionId,
            source: M.source,
            botPhone: M.botPhone,
            webviewToken: M.token,
        });

        clearCart();
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

boot();
