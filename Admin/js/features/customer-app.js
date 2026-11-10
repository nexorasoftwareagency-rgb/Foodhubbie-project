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

// P2: Promo Page Offers state
let _offersSearchQuery = '';
let _offersFilter = 'all'; // 'all' | 'on-page' | 'off-page' | 'valid' | 'expired' | 'disabled' | 'archived'
let _offersSort = 'updated'; // 'updated' | 'name' | 'value' | 'expiry' | 'usage'
let _selectedOffers = new Set(); // Set of offer ids
let _allOffersCache = []; // cached full offer list from RTDB listener

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

    // P2: Promo offers search & filter
    $('promoOffersSearch')?.addEventListener('input', (e) => {
        _offersSearchQuery = e.target.value;
        _renderPromoOffers(_allOffersCache);
    });
    document.querySelectorAll('input[name="promoOffersFilter"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _offersFilter = e.target.value;
            _renderPromoOffers(_allOffersCache);
        });
    });
    document.querySelectorAll('input[name="promoOffersSort"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _offersSort = e.target.value;
            _renderPromoOffers(_allOffersCache);
        });
    });

    // P2: Bulk toolbar actions
    $('btnBulkShowOnPage')?.addEventListener('click', () => _bulkSetPromoPage(true));
    $('btnBulkHideFromPage')?.addEventListener('click', () => _bulkSetPromoPage(false));
    $('btnBulkEnable')?.addEventListener('click', () => _bulkSetEnabled(true));
    $('btnBulkDisable')?.addEventListener('click', () => _bulkSetEnabled(false));
    $('btnBulkArchive')?.addEventListener('click', () => _bulkArchive());
    $('btnBulkDelete')?.addEventListener('click', () => _bulkDelete());
    $('btnBulkSelectAll')?.addEventListener('click', _toggleSelectAll);
    $('btnBulkCancel')?.addEventListener('click', _clearSelection);

    // P2: Quick edit panel close
    $('btnQuickEditCancel')?.addEventListener('click', _closeQuickEdit);
    $('btnQuickEditSave')?.addEventListener('click', _saveQuickEdit);

    // P2: Preview modal close
    $('btnPreviewClose')?.addEventListener('click', _closePreview);

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
        // Reset P2 state when entering offers tab
        _offersSearchQuery = '';
        _offersFilter = 'all';
        _offersSort = 'updated';
        _selectedOffers.clear();
        const searchInput = $('promoOffersSearch');
        if (searchInput) searchInput.value = '';
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
            _allOffersCache = offers;
            _offersSearchQuery = '';
            _offersFilter = 'all';
            _offersSort = 'updated';
            _selectedOffers.clear();
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
    const bulkToolbar = $('bulkToolbar');
    if (!wrap) return;

    const now = Date.now();
    const processed = _processOffers(offers);
    const total = processed.length;
    const onPage = processed.filter(d => d.promoPage === true).length;
    const valid = processed.filter(d => couponStatus(d, now) === 'valid').length;

    if (totalEl) totalEl.textContent = String(total);
    if (onPageEl) onPageEl.textContent = String(onPage);
    if (validEl) validEl.textContent = String(valid);

    if (total === 0) {
        wrap.innerHTML = '';
        empty?.classList.remove('hidden');
        if (bulkToolbar) bulkToolbar.classList.add('hidden');
        _selectedOffers.clear();
        return;
    }
    empty?.classList.add('hidden');

    wrap.innerHTML = processed.map(d => {
        const status = couponStatus(d, now);
        const showOnPage = d.promoPage === true;
        const channelOk = discountAllowsChannel(d, 'website');
        const archived = d.archived === true;
        const statusLabel = {
            valid: 'Valid', disabled: 'Disabled', not_started: 'Not started',
            expired: 'Expired', not_in_window: 'Not in window'
        }[status] || status;
        const valueTxt = d.mode === 'percent' ? `${d.value}% off` : `₹${Number(d.value || 0)} off`;
        const minTxt = d.minSubtotal ? ` min ₹${d.minSubtotal}` : '';
        const globalTxt = d.globalLimit ? ` cap ${d.stats?.usedCount || 0}/${d.globalLimit}` : '';
        const usedTxt = d.stats?.usedCount ? ` · ${d.stats.usedCount} used` : '';
        const isSelected = _selectedOffers.has(d.id);
        return `
            <div class="promo-offer-row ${isSelected ? 'selected' : ''} ${archived ? 'archived' : ''}" role="button" tabindex="0" aria-label="${_escHtml(d.name || d.couponCode)}, ${valueTxt}, ${statusLabel}" data-offer-id="${d.id}">
                <label class="promo-offer__select" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-sel-id="${d.id}" style="appearance:none;width:18px;height:18px;border:2px solid var(--border,#e5e7eb);border-radius:4px;cursor:pointer;${isSelected ? 'background:var(--primary,#E84908);border-color:var(--primary,#E84908)' : ''}">
                    <span style="font-size:11px;color:var(--text-tertiary);">${archived ? 'Archived' : channelOk ? '' : 'Not on website'}</span>
                </label>
                <div class="promo-offer__info" style="flex:1;min-width:0;cursor:pointer;">
                    <div class="promo-offer__name">${_escHtml(d.name || d.couponCode)}</div>
                    <div class="promo-offer__code">${_escHtml(d.couponCode)}</div>
                    <div class="promo-offer__meta">${valueTxt}${minTxt}${globalTxt}${usedTxt} · ${_escHtml(statusLabel)}${channelOk ? '' : ' (not on website)'}</div>
                </div>
                <span class="promo-offer__status ${status}">${statusLabel}</span>
                <label class="promo-offer__toggle" title="${showOnPage ? 'Hide from Promo Page' : 'Show on Promo Page'}">
                    <input type="checkbox" ${showOnPage ? 'checked' : ''} data-pp-id="${d.id}" ${!channelOk || archived ? 'disabled' : ''}>
                </label>
                <div class="promo-offer__actions" style="display:flex;gap:4px;">
                    <button class="icon-btn" title="Edit" data-edit-id="${d.id}"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button>
                    <button class="icon-btn" title="${archived ? 'Restore' : 'Archive'}" data-archive-id="${d.id}" data-archived="${archived}"><i data-lucide="${archived ? 'rotate-ccw' : 'archive'}" style="width:14px;height:14px;"></i></button>
                    <button class="icon-btn" title="Delete" data-delete-id="${d.id}"><i data-lucide="trash-2" style="width:14px;height:14px;color:var(--error,#dc2626);"></i></button>
                    <button class="icon-btn" title="Duplicate" data-dup-id="${d.id}"><i data-lucide="copy" style="width:14px;height:14px;"></i></button>
                </div>
            </div>
        `;
    }).join('');

    // Event delegation for all clicks within the offer list
    wrap.replaceWith(wrap.cloneNode(true));
    const newWrap = $('promoOffersList');
    newWrap.addEventListener('click', (e) => {
        const row = e.target.closest('.promo-offer-row');
        if (!row) return;

        const id = row.dataset.offerId;

        // Selection checkbox
        if (e.target.matches('input[data-sel-id]')) {
            _toggleSelectOffer(id);
            return;
        }

        // Promo page toggle checkbox
        if (e.target.matches('input[data-pp-id]')) {
            _togglePromoPage(id, e.target.checked);
            return;
        }

        // Edit button
        if (e.target.closest('button[data-edit-id]')) {
            _openQuickEdit(id);
            return;
        }

        // Archive/restore button
        const archiveBtn = e.target.closest('button[data-archive-id]');
        if (archiveBtn) {
            const archived = archiveBtn.dataset.archived === 'true';
            archived ? _restoreOffer(id) : _archiveOffer(id);
            return;
        }

        // Delete button
        if (e.target.closest('button[data-delete-id]')) {
            _deleteOffer(id);
            return;
        }

        // Duplicate button
        if (e.target.closest('button[data-dup-id]')) {
            _duplicateOffer(id);
            return;
        }

        // Row click (not on any button/checkbox) -> quick edit
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !e.target.closest('.promo-offer__toggle')) {
            _openQuickEdit(id);
        }
    });

    // Rebind toggle checkboxes (promoPage) - needed because cloneNode loses listeners
    newWrap.querySelectorAll('input[data-pp-id]').forEach(cb => {
        const id = cb.dataset.ppId;
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            _togglePromoPage(id, cb.checked);
        });
    });
}

function _openDiscountsTab() {
    const btn = document.querySelector('[data-tab="discounts"]');
    if (btn) btn.click();
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

/* ============ P2: PROMO OFFERS FILTER / SORT / SELECT ============ */

/** Apply search + filter + sort to the cached offer list. */
function _processOffers(offers) {
    const q = _offersSearchQuery.toLowerCase();
    let filtered = offers.filter(d => {
        const matchText = !q ||
            String(d.name || '').toLowerCase().includes(q) ||
            String(d.couponCode || '').toLowerCase().includes(q) ||
            String(d.value || '').includes(q);
        if (!matchText) return false;
        const now = Date.now();
        const status = couponStatus(d, now);
        const onPage = d.promoPage === true;
        const archived = d.archived === true;
        if (_offersFilter === 'on-page') return onPage && !archived;
        if (_offersFilter === 'off-page') return !onPage && !archived;
        if (_offersFilter === 'valid') return status === 'valid' && !archived;
        if (_offersFilter === 'expired') return status === 'expired' && !archived;
        if (_offersFilter === 'disabled') return status === 'disabled' && !archived;
        if (_offersFilter === 'archived') return archived;
        return !archived; // 'all' excludes archived by default
    });

    if (_offersSort === 'name') filtered.sort((a, b) => String(a.name || '').localeCompare(b.name || ''));
    else if (_offersSort === 'value') filtered.sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    else if (_offersSort === 'expiry') filtered.sort((a, b) => Number(b.endsAt || 0) - Number(a.endsAt || 0));
    else if (_offersSort === 'usage') filtered.sort((a, b) => Number(b.stats?.usedCount || 0) - Number(a.stats?.usedCount || 0));
    else filtered.sort((a, b) => (Number(b.updatedAt || 0) || 0) - (Number(a.updatedAt || 0) || 0));

    return filtered;
}

/** Toggle selection of a single offer. */
function _toggleSelectOffer(id) {
    if (_selectedOffers.has(id)) _selectedOffers.delete(id);
    else _selectedOffers.add(id);
    _updateBulkToolbar();
    _renderPromoOffers(_allOffersCache);
}

/** Select all visible offers or clear selection. */
function _toggleSelectAll() {
    const visible = _processOffers(_allOffersCache).map(d => d.id);
    if (_selectedOffers.size === visible.length && visible.length > 0) {
        _selectedOffers.clear();
    } else {
        visible.forEach(id => _selectedOffers.add(id));
    }
    _updateBulkToolbar();
    _renderPromoOffers(_allOffersCache);
}

/** Clear all selection. */
function _clearSelection() {
    _selectedOffers.clear();
    _updateBulkToolbar();
    _renderPromoOffers(_allOffersCache);
}

/** Update the bulk toolbar visibility and count. */
function _updateBulkToolbar() {
    const toolbar = $('bulkToolbar');
    const countEl = $('bulkSelectCount');
    const selectAllBtn = $('btnBulkSelectAll');
    if (!toolbar) return;

    if (_selectedOffers.size === 0) {
        toolbar.classList.add('hidden');
        return;
    }
    toolbar.classList.remove('hidden');
    if (countEl) countEl.textContent = String(_selectedOffers.size);

    const visible = _processOffers(_allOffersCache).map(d => d.id);
    if (selectAllBtn) {
        selectAllBtn.textContent = _selectedOffers.size === visible.length && visible.length > 0
            ? 'Deselect all' : 'Select all';
    }
}

/** Bulk: set promoPage flag on selected offers. */
async function _bulkSetPromoPage(showOnPage) {
    const ids = Array.from(_selectedOffers);
    if (ids.length === 0) return;
    try {
        await Promise.all(ids.map(id =>
            update(Outlet.ref(`discounts/${id}`), { promoPage: showOnPage === true, updatedAt: Date.now() })
        ));
        showToast(`${ids.length} offer${ids.length === 1 ? '' : 's'} ${showOnPage ? 'added to' : 'removed from'} Promo Page`, 'success');
        _clearSelection();
    } catch (e) {
        showToast('Bulk update failed: ' + (e?.message || e), 'error');
    }
}

/** Bulk: set enabled flag on selected offers. */
async function _bulkSetEnabled(enabled) {
    const ids = Array.from(_selectedOffers);
    if (ids.length === 0) return;
    try {
        await Promise.all(ids.map(id =>
            update(Outlet.ref(`discounts/${id}`), { enabled: enabled, updatedAt: Date.now() })
        ));
        showToast(`${ids.length} offer${ids.length === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'}`, 'success');
        _clearSelection();
    } catch (e) {
        showToast('Bulk update failed: ' + (e?.message || e), 'error');
    }
}

/** Bulk: archive selected offers. */
async function _bulkArchive() {
    const ids = Array.from(_selectedOffers);
    if (ids.length === 0) return;
    const ok = await showConfirm(`Archive ${ids.length} selected offer${ids.length === 1 ? '' : 's'}?`, 'Archive offers');
    if (!ok) return;
    try {
        await Promise.all(ids.map(id =>
            update(Outlet.ref(`discounts/${id}`), { archived: true, updatedAt: Date.now() })
        ));
        showToast(`${ids.length} offer${ids.length === 1 ? '' : 's'} archived`, 'success');
        _clearSelection();
    } catch (e) {
        showToast('Archive failed: ' + (e?.message || e), 'error');
    }
}

/** Bulk: delete selected offers. */
async function _bulkDelete() {
    const ids = Array.from(_selectedOffers);
    if (ids.length === 0) return;
    const ok = await showConfirm(`Permanently delete ${ids.length} selected offer${ids.length === 1 ? '' : 's'}? This cannot be undone.`, 'Delete offers');
    if (!ok) return;
    try {
        await Promise.all(ids.map(id =>
            update(Outlet.ref(`discounts/${id}`), null)
        ));
        showToast(`${ids.length} offer${ids.length === 1 ? '' : 's'} deleted`, 'success');
        _clearSelection();
    } catch (e) {
        showToast('Delete failed: ' + (e?.message || e), 'error');
    }
}

/* ============ P2: QUICK EDIT PANEL ============ */

let _quickEditId = null;

function _openQuickEdit(id) {
    const offer = _allOffersCache.find(d => d.id === id);
    if (!offer) return;
    _quickEditId = id;

    const panel = $('quickEditPanel');
    const form = $('quickEditForm');
    if (!panel || !form) return;

    // Populate form
    $('qeName')?.value && ($('qeName').value = offer.name || '');
    $('qeCode')?.value && ($('qeCode').value = offer.couponCode || '');
    $('qeValue')?.value && ($('qeValue').value = offer.value || '');
    $('qeMode')?.value && ($('qeMode').value = offer.mode || 'percent');
    $('qeMinSubtotal')?.value && ($('qeMinSubtotal').value = offer.minSubtotal || '');
    $('qeMaxCap')?.value && ($('qeMaxCap').value = offer.maxCap || '');
    $('qeChannel')?.value && ($('qeChannel').value = offer.channel || 'all');
    $('qeStartsAt')?.value && ($('qeStartsAt').value = offer.startsAt ? new Date(offer.startsAt).toISOString().slice(0, 16) : '');
    $('qeEndsAt')?.value && ($('qeEndsAt').value = offer.endsAt ? new Date(offer.endsAt).toISOString().slice(0, 16) : '');
    $('qePromoPage')?.checked && ($('qePromoPage').checked = offer.promoPage === true);

    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
}

function _closeQuickEdit() {
    const panel = $('quickEditPanel');
    if (panel) {
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
    }
    _quickEditId = null;
}

async function _saveQuickEdit() {
    if (!_quickEditId) return;
    const btn = $('btnQuickEditSave');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const updates = {
            name: $('qeName')?.value || undefined,
            couponCode: $('qeCode')?.value || undefined,
            value: $('qeValue')?.value ? Number($('qeValue').value) : undefined,
            mode: $('qeMode')?.value || undefined,
            minSubtotal: $('qeMinSubtotal')?.value ? Number($('qeMinSubtotal').value) : undefined,
            maxCap: $('qeMaxCap')?.value ? Number($('qeMaxCap').value) : undefined,
            channel: $('qeChannel')?.value || undefined,
            promoPage: $('qePromoPage')?.checked === true,
            updatedAt: Date.now(),
        };
        // Handle date fields
        const startsAt = $('qeStartsAt')?.value;
        if (startsAt) updates.startsAt = new Date(startsAt).getTime();
        const endsAt = $('qeEndsAt')?.value;
        if (endsAt) updates.endsAt = new Date(endsAt).getTime();

        // Remove undefined values
        Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

        await update(Outlet.ref(`discounts/${_quickEditId}`), updates);
        showToast('Offer updated', 'success');
        _closeQuickEdit();
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

/** Archive a single offer. */
async function _archiveOffer(id) {
    const ok = await showConfirm('Archive this offer? It will be hidden from the Promo Page.', 'Archive offer');
    if (!ok) return;
    try {
        await update(Outlet.ref(`discounts/${id}`), { archived: true, updatedAt: Date.now() });
        showToast('Offer archived', 'success');
    } catch (e) {
        showToast('Archive failed: ' + (e?.message || e), 'error');
    }
}

/** Restore an archived offer. */
async function _restoreOffer(id) {
    try {
        await update(Outlet.ref(`discounts/${id}`), { archived: false, updatedAt: Date.now() });
        showToast('Offer restored', 'success');
    } catch (e) {
        showToast('Restore failed: ' + (e?.message || e), 'error');
    }
}

/** Delete a single offer. */
async function _deleteOffer(id) {
    const ok = await showConfirm('Permanently delete this offer? This cannot be undone.', 'Delete offer');
    if (!ok) return;
    try {
        await update(Outlet.ref(`discounts/${id}`), null);
        showToast('Offer deleted', 'success');
    } catch (e) {
        showToast('Delete failed: ' + (e?.message || e), 'error');
    }
}

/** Duplicate an offer. */
async function _duplicateOffer(id) {
    const offer = _allOffersCache.find(d => d.id === id);
    if (!offer) return;
    try {
        const now = Date.now();
        const dupe = {
            ...offer,
            id: undefined, // will be set by push
            couponCode: (offer.couponCode || '') + '-COPY',
            name: (offer.name || '') + ' (Copy)',
            createdAt: now,
            updatedAt: now,
            archived: false,
            promoPage: false,
        };
        delete dupe.id;
        const newRef = await update(Outlet.ref('discounts'), { [OfferPushKey()]: dupe });
        // RTDB update doesn't return the key easily; use push instead
        showToast('Offer duplicated', 'success');
    } catch (e) {
        showToast('Duplicate failed: ' + (e?.message || e), 'error');
    }
}

function OfferPushKey() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ============ P2: PREVIEW MODAL ============ */

function _openPreviewModal() {
    const modal = $('promoPreviewModal');
    const wrap = $('promoPreviewList');
    if (!modal || !wrap) return;

    const now = Date.now();
    const visible = _allOffersCache.filter(d => d.promoPage === true && d.archived !== true && couponStatus(d, now) === 'valid');

    if (visible.length === 0) {
        wrap.innerHTML = '<div style="padding:24px;color:var(--text-tertiary);text-align:center;">No offers currently showing on the Promo Page.</div>';
    } else {
        wrap.innerHTML = visible.map(d => {
            const valueTxt = d.mode === 'percent' ? `${d.value}% off` : `₹${Number(d.value || 0)} off`;
            return `
                <div class="preview-offer-card">
                    <div class="preview-offer__badge">${valueTxt}</div>
                    <div class="preview-offer__name">${_escHtml(d.name || d.couponCode)}</div>
                    <div class="preview-offer__code">Code: ${_escHtml(d.couponCode)}</div>
                    ${d.minSubtotal ? `<div class="preview-offer__meta">Min order ₹${d.minSubtotal}</div>` : ''}
                    <button class="preview-offer__btn" type="button">Apply</button>
                </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function _closePreview() {
    const modal = $('promoPreviewModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
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
