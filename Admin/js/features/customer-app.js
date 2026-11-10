/**
 * FoodHubbie ERP | CUSTOMER APP MODULE
 * Standalone top-level tab: "Customer APP"
 * Controls everything customers see and do in the restaurant's app:
 *  - App Notification      -> push notifications (delegates to app-notifications.js)
 *  - Promo Page Offers     -> which coupon discounts appear on the customer Promo Page
 *  - App Visibility        -> what dishes/categories/features are visible in the app
 *  - App Settings          -> store identity, contact, ordering behavior, fees
 */

import { db, auth, Outlet, BUSINESS_ID, ref, get, onValue, set, update } from '../firebase.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { formatDate } from '../utils.js';
import { loadLucide } from '../ui.js';
import { logger } from '../utils/logger.js';
import { appLink } from '../../shared/app-link.js';
import { couponStatus, discountAllowsChannel } from '../../shared/discount-rules.js';

const $ = (id) => document.getElementById(id);

let _wired = false;
let _subTab = 'notification'; // 'notification' | 'offers' | 'visibility' | 'settings'
let _offersListener = null;
let _visibilityListener = null;

/* ============ MAIN ENTRY ============ */

export function loadCustomerApp() {
    logger.info('CUSTOMER-APP', 'Loading Customer APP tab…');
    _wireOnce();
    _renderAppLink();
    _switchSubTab(_subTab);
}

export function cleanupCustomerApp() {
    if (_offersListener) { _offersListener(); _offersListener = null; }
    if (_visibilityListener) { _visibilityListener(); _visibilityListener = null; }
}

/* ============ WIRING (once) ============ */

function _wireOnce() {
    if (_wired) return;
    _wired = true;

    // Sub-tab switching
    $('caSubTabNotification')?.addEventListener('click', () => _switchSubTab('notification'));
    $('caSubTabOffers')?.addEventListener('click', () => _switchSubTab('offers'));
    $('caSubTabVisibility')?.addEventListener('click', () => _switchSubTab('visibility'));
    $('caSubTabSettings')?.addEventListener('click', () => _switchSubTab('settings'));

    // Refresh subscriber count
    $('caRefreshSubs')?.addEventListener('click', () => _loadPushSubscriptions(true));

    // Promo offers actions
    $('btnPromoOffersNew')?.addEventListener('click', _openDiscountsTab);
    $('btnPromoOffersEmptyNew')?.addEventListener('click', _openDiscountsTab);

    // Visibility actions
    $('btnVisibilityRefresh')?.addEventListener('click', _loadVisibility);

    // App Settings actions
    $('btnSaveAppSettings')?.addEventListener('click', _saveAppSettings);
    $('btnSaveAppSettingsBottom')?.addEventListener('click', _saveAppSettings);
    $('btnResetAppSettings')?.addEventListener('click', _resetAppSettings);
}

/* ============ SUB-TAB SWITCHING ============ */

function _switchSubTab(sub) {
    _subTab = sub;

    // Update tab buttons
    document.querySelectorAll('.ca-sub-tab').forEach(btn => {
        const active = btn.dataset.sub === sub;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
    });

    // Update panes
    document.querySelectorAll('.ca-pane').forEach(pane => {
        pane.classList.toggle('hidden', true);
    });
    const activePane = $(`caPane${sub.charAt(0).toUpperCase() + sub.slice(1)}`);
    if (activePane) activePane.classList.toggle('hidden', false);

    // Load sub-tab content
    if (sub === 'notification') {
        _loadNotificationPane();
    } else if (sub === 'offers') {
        _loadPromoOffers();
    } else if (sub === 'visibility') {
        _loadVisibility();
    } else if (sub === 'settings') {
        _loadAppSettings();
    }
}

/* ============ PANE 1: APP NOTIFICATION (delegates to app-notifications.js) ============ */

async function _loadNotificationPane() {
    try {
        const mod = await import('./app-notifications.js');
        await mod.initPushUI();
    } catch (e) {
        console.error('[Customer APP] Failed to load app-notifications module:', e);
    }
}

function _renderAppLink() {
    const el = $('pushAppLink');
    if (!el) return;
    const link = appLink(BUSINESS_ID(), Outlet.current);
    el.value = link || '';
    el.placeholder = link ? '' : 'Business or outlet id missing';
    const btn = $('btnCopyPushAppLink');
    if (btn) btn.disabled = !link;
}

async function _loadPushSubscriptions(manual = false) {
    try {
        const snap = await get(Outlet.ref('pushSubscriptions'));
        const raw = snap.val() || {};
        const subs = Object.entries(raw).filter(([, s]) => s && String(s?.phone || '').replace(/\D/g, '').slice(-10).length === 10);
        const offers = subs.filter(([, s]) => !s?.prefs || s.prefs.offers === true);
        const latest = subs.reduce((m, [, s]) => Math.max(m, Number(s?.updatedAt || 0)), 0);

        if ($('pushSubCount')) $('pushSubCount').textContent = String(subs.length);
        if ($('pushOffersReach')) $('pushOffersReach').textContent = String(offers.length);
        if ($('pushSubUpdated')) $('pushSubUpdated').textContent = latest ? formatDate(latest) : '—';

        $('pushEmptyState')?.classList.toggle('hidden', subs.length > 0);
    } catch (e) {
        console.error('[Customer APP] Failed to load subscriptions:', e);
        if ($('pushSubCount')) $('pushSubCount').textContent = '—';
        if ($('pushOffersReach')) $('pushOffersReach').textContent = '—';
        if ($('pushSubUpdated')) $('pushSubUpdated').textContent = '—';
    }
}

/* ============ PANE 2: PROMO PAGE OFFERS ============ */

async function _loadPromoOffers() {
    const wrap = $('promoOffersList');
    if (!wrap) return;
    wrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">Loading offers…</div>';
    if (_offersListener) { _offersListener(); _offersListener = null; }
    try {
        _offersListener = onValue(Outlet.ref('discounts'), (snap) => {
            const all = snap.val() || {};
            const offers = Object.entries(all)
                .filter(([, d]) => d && d.type === 'coupon' && d.couponCode)
                .map(([id, d]) => ({ id, ...d }))
                .sort((a, b) => (Number(b.updatedAt || 0) || 0) - (Number(a.updatedAt || 0) || 0));
            _renderPromoOffers(offers);
        }, (err) => {
            console.error('[Customer APP] Promo offers read error:', err);
            wrap.innerHTML = '<div style="padding:16px;color:var(--error);">Could not load discounts. Try refreshing.</div>';
        });
    } catch (e) {
        console.error('[Customer APP] Promo offers setup error:', e);
        wrap.innerHTML = '<div style="padding:16px;color:var(--error);">Could not load discounts.</div>';
    }
}

function _renderPromoOffers(offers) {
    const wrap = $('promoOffersList');
    const totalEl = $('promoOffersTotal');
    const onPageEl = $('promoOffersOnPage');
    const validEl = $('promoOffersValid');
    const empty = $('promoOffersEmpty');
    if (!wrap) return;

    const now = Date.now();
    const total = offers.length;
    const onPage = offers.filter(d => d.promoPage === true).length;
    const valid = offers.filter(d => couponStatus(d, now) === 'valid').length;

    if (totalEl) totalEl.textContent = String(total);
    if (onPageEl) onPageEl.textContent = String(onPage);
    if (validEl) validEl.textContent = String(valid);

    if (total === 0) {
        wrap.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    wrap.innerHTML = offers.map(d => {
        const status = couponStatus(d, now);
        const showOnPage = d.promoPage === true;
        const channelOk = discountAllowsChannel(d, 'website');
        const statusLabel = {
            valid: 'Valid', disabled: 'Disabled', not_started: 'Not started',
            expired: 'Expired', not_in_window: 'Not in window'
        }[status] || status;
        const valueTxt = d.mode === 'percent' ? `${d.value}% off` : `₹${Number(d.value || 0)} off`;
        const minTxt = d.minSubtotal ? ` min ₹${d.minSubtotal}` : '';
        const globalTxt = d.globalLimit ? ` cap ${d.stats?.usedCount || 0}/${d.globalLimit}` : '';
        return `
            <div class="promo-offer-row" role="button" tabindex="0" aria-label="${_escHtml(d.name || d.couponCode)}, ${valueTxt}, ${statusLabel}">
                <span class="promo-offer__badge">${status === 'valid' ? '✓' : '–'}</span>
                <div class="promo-offer__info">
                    <div class="promo-offer__name">${_escHtml(d.name || d.couponCode)}</div>
                    <div class="promo-offer__code">${_escHtml(d.couponCode)}</div>
                    <div class="promo-offer__meta">${valueTxt}${minTxt}${globalTxt} · ${_escHtml(statusLabel)}${channelOk ? '' : ' (not on website)'}</div>
                </div>
                <span class="promo-offer__status ${status}">${statusLabel}</span>
                <label class="promo-offer__toggle" title="${showOnPage ? 'Hide from Promo Page' : 'Show on Promo Page'}">
                    <input type="checkbox" ${showOnPage ? 'checked' : ''} data-id="${d.id}" ${!channelOk ? 'disabled' : ''}>
                </label>
            </div>
        `;
    }).join('');

    wrap.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
        const id = cb.dataset.id;
        cb.replaceWith(cb.cloneNode(true));
        const newCb = wrap.querySelector(`input[data-id="${id}"]`);
        newCb.addEventListener('change', () => _togglePromoPage(id, newCb.checked));
    });
}

function _escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function _togglePromoPage(id, showOnPage) {
    try {
        await update(Outlet.ref(`discounts/${id}`), { promoPage: showOnPage === true, updatedAt: Date.now() });
        showToast(showOnPage ? 'Added to Promo Page' : 'Removed from Promo Page', 'success');
    } catch (e) {
        showToast('Update failed: ' + (e?.message || e), 'error');
        const cb = document.querySelector(`input[data-id="${id}"]`);
        if (cb) cb.checked = !showOnPage;
    }
}

function _openDiscountsTab() {
    const btn = document.querySelector('[data-tab="discounts"]');
    if (btn) btn.click();
}

/* ============ PANE 3: APP VISIBILITY ============ */

async function _loadVisibility() {
    _loadVisibilityStats();
    _loadVisibilityDishes();
    _loadVisibilityCategories();
    _loadVisibilityFeatures();
}

async function _loadVisibilityStats() {
    try {
        const [dishSnap, catSnap] = await Promise.all([
            get(Outlet.ref('menu/dishes')),
            get(Outlet.ref('menu/categories'))
        ]);
        const dishes = dishSnap.val() || {};
        const cats = catSnap.val() || {};
        const dishList = Object.values(dishes).filter(Boolean);
        const catList = Object.values(cats).filter(Boolean);
        const visDishes = dishList.filter(d => d.visible !== false).length;
        const visCats = catList.filter(c => c.visible !== false).length;

        if ($('visTotalDishes')) $('visTotalDishes').textContent = String(dishList.length);
        if ($('visVisibleDishes')) $('visVisibleDishes').textContent = String(visDishes);
        if ($('visTotalCategories')) $('visTotalCategories').textContent = String(catList.length);
        if ($('visVisibleCategories')) $('visVisibleCategories').textContent = String(visCats);

        $('caVisEmpty')?.classList.toggle('hidden', dishList.length > 0 || catList.length > 0);
    } catch (e) {
        console.error('[Customer APP] Visibility stats error:', e);
    }
}

async function _loadVisibilityDishes() {
    const wrap = $('visDishList');
    if (!wrap) return;
    try {
        const snap = await get(Outlet.ref('menu/dishes'));
        const all = snap.val() || {};
        const entries = Object.entries(all).filter(([, d]) => d);
        if (entries.length === 0) {
            wrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">No dishes found. Add dishes in Menu first.</div>';
            return;
        }
        wrap.innerHTML = entries.map(([id, d]) => {
            const visible = d.visible !== false;
            return `
                <div class="promo-offer-row" role="button" tabindex="0">
                    <span class="promo-offer__badge">${visible ? '✓' : '–'}</span>
                    <div class="promo-offer__info">
                        <div class="promo-offer__name">${_escHtml(d.name || 'Unnamed Dish')}</div>
                        <div class="promo-offer__meta">${_escHtml(d.price != null ? `₹${d.price}` : '—')} · ${visible ? 'Visible on App' : 'Hidden from App'}</div>
                    </div>
                    <span class="promo-offer__status ${visible ? 'valid' : 'disabled'}">${visible ? 'Visible' : 'Hidden'}</span>
                    <label class="promo-offer__toggle" title="${visible ? 'Hide dish from app' : 'Show dish on app'}">
                        <input type="checkbox" ${visible ? 'checked' : ''} data-id="${id}" data-type="dish">
                    </label>
                </div>
            `;
        }).join('');
        _bindVisibilityToggles(wrap, 'dish');
    } catch (e) {
        console.error('[Customer APP] Visibility dishes error:', e);
        wrap.innerHTML = '<div style="padding:16px;color:var(--error);">Could not load dishes.</div>';
    }
}

async function _loadVisibilityCategories() {
    const wrap = $('visCategoryList');
    if (!wrap) return;
    try {
        const snap = await get(Outlet.ref('menu/categories'));
        const all = snap.val() || {};
        const entries = Object.entries(all).filter(([, c]) => c);
        if (entries.length === 0) {
            wrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">No categories found. Add categories in Menu first.</div>';
            return;
        }
        wrap.innerHTML = entries.map(([id, c]) => {
            const visible = c.visible !== false;
            return `
                <div class="promo-offer-row" role="button" tabindex="0">
                    <span class="promo-offer__badge">${visible ? '✓' : '–'}</span>
                    <div class="promo-offer__info">
                        <div class="promo-offer__name">${_escHtml(c.name || 'Unnamed Category')}</div>
                        <div class="promo-offer__meta">${visible ? 'Visible on App' : 'Hidden from App'}</div>
                    </div>
                    <span class="promo-offer__status ${visible ? 'valid' : 'disabled'}">${visible ? 'Visible' : 'Hidden'}</span>
                    <label class="promo-offer__toggle" title="${visible ? 'Hide category from app' : 'Show category on app'}">
                        <input type="checkbox" ${visible ? 'checked' : ''} data-id="${id}" data-type="category">
                    </label>
                </div>
            `;
        }).join('');
        _bindVisibilityToggles(wrap, 'category');
    } catch (e) {
        console.error('[Customer APP] Visibility categories error:', e);
        wrap.innerHTML = '<div style="padding:16px;color:var(--error);">Could not load categories.</div>';
    }
}

async function _loadVisibilityFeatures() {
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        const store = snap.val() || {};
        const features = store.appFeatures || {};

        const map = {
            visFeatureOnlineOrdering: 'onlineOrdering',
            visFeatureTableBooking: 'tableBooking',
            visFeaturePromoPage: 'promoPage',
            visFeatureLoyalty: 'loyalty'
        };
        Object.entries(map).forEach(([inputId, key]) => {
            const el = $(inputId);
            if (el) el.checked = features[key] !== false;
        });
    } catch (e) {
        console.error('[Customer APP] Visibility features error:', e);
    }
}

function _bindVisibilityToggles(wrap, type) {
    wrap.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
        const id = cb.dataset.id;
        cb.addEventListener('change', async () => {
            try {
                await update(Outlet.ref(`menu/${type === 'dish' ? 'dishes' : 'categories'}/${id}`), {
                    visible: cb.checked === true,
                    updatedAt: Date.now()
                });
                showToast(`${_escHtml(id)} ${cb.checked ? 'shown on' : 'hidden from'} app`, 'success');
                _loadVisibilityStats();
            } catch (e) {
                showToast('Update failed: ' + (e?.message || e), 'error');
                cb.checked = !cb.checked;
            }
        });
    });
}

/* ============ PANE 4: APP SETTINGS ============ */

async function _loadAppSettings() {
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        const store = snap.val() || {};
        const features = store.appFeatures || {};

        const fields = {
            caSettingStoreName: store.storeName || '',
            caSettingStoreAddress: store.address || '',
            caSettingStorePhone: store.phone || '',
            caSettingWhatsAppNumber: store.whatsappNumber || '',
            caSettingGoogleReviewLink: store.googleReviewLink || '',
            caSettingWelcomeMessage: store.appWelcomeMessage || '',
            caSettingDeliveryFee: store.deliveryFee != null ? store.deliveryFee : '',
            caSettingMinOrder: store.minOrder != null ? store.minOrder : '',
            caSettingDineIn: store.dineInEnabled !== false,
            caSettingDelivery: store.deliveryEnabled !== false,
            caSettingPickup: store.pickupEnabled !== false,
            caSettingLoyalty: store.loyaltyEnabled === true
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = $(id);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = val === true;
            else el.value = val;
        });
    } catch (e) {
        console.error('[Customer APP] Load settings error:', e);
        showToast('Could not load app settings', 'error');
    }
}

async function _saveAppSettings() {
    try {
        const store = {
            storeName: $('caSettingStoreName')?.value || '',
            address: $('caSettingStoreAddress')?.value || '',
            phone: $('caSettingStorePhone')?.value || '',
            whatsappNumber: $('caSettingWhatsAppNumber')?.value || '',
            googleReviewLink: $('caSettingGoogleReviewLink')?.value || '',
            appWelcomeMessage: $('caSettingWelcomeMessage')?.value || '',
            deliveryFee: $('caSettingDeliveryFee')?.value ? Number($('caSettingDeliveryFee').value) : undefined,
            minOrder: $('caSettingMinOrder')?.value ? Number($('caSettingMinOrder').value) : undefined,
            dineInEnabled: $('caSettingDineIn')?.checked === true,
            deliveryEnabled: $('caSettingDelivery')?.checked === true,
            pickupEnabled: $('caSettingPickup')?.checked === true,
            loyaltyEnabled: $('caSettingLoyalty')?.checked === true,
            updatedAt: Date.now()
        };
        await update(Outlet.ref('settings/Store'), store);
        showToast('App settings saved', 'success');
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
    }
}

function _resetAppSettings() {
    showConfirm('Reset all app settings to defaults? This cannot be undone.', 'Reset App Settings')
        .then(ok => {
            if (!ok) return;
            // Reset form fields to sensible defaults
            $('caSettingStoreName')?.value && ($('caSettingStoreName').value = '');
            $('caSettingDineIn')?.checked && ($('caSettingDineIn').checked = false);
            $('caSettingDelivery')?.checked && ($('caSettingDelivery').checked = false);
            $('caSettingPickup')?.checked && ($('caSettingPickup').checked = false);
            $('caSettingLoyalty')?.checked && ($('caSettingLoyalty').checked = false);
            showToast('Form reset. Click Save to apply defaults.', 'info');
        });
}
