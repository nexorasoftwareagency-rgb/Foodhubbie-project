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
import { loadLucide, canEditTab, canDeleteTab, roleLabel } from '../ui.js';
import { logger } from '../utils/logger.js';
import { appLink } from '../../shared/app-link.js';
import { couponStatus, discountAllowsChannel } from '../../shared/discount-rules.js';
import { logChange, loadAuditLog } from './audit-trail.js';

const $ = (id) => document.getElementById(id);

let _wired = false;
let _subTab = 'notification'; // 'notification' | 'offers' | 'visibility' | 'settings'
let _offersListener = null;
let _visibilityListener = null;

// P5: Audit trail state
let _auditLogListener = null;

// P5: Keyboard shortcut state
let _keyboardWired = false;

// P2: Promo Page Offers state
let _offersSearchQuery = '';
let _offersFilter = 'all'; // 'all' | 'on-page' | 'off-page' | 'valid' | 'expired' | 'disabled' | 'archived'
let _offersSort = 'updated'; // 'updated' | 'name' | 'value' | 'expiry' | 'usage'
let _selectedOffers = new Set(); // Set of offer ids
let _allOffersCache = []; // cached full offer list from RTDB listener

// P3: App Visibility state
let _visSearchQuery = '';
let _visFilter = 'all'; // 'all' | 'visible' | 'hidden' | 'out-of-stock' | 'low-stock'
let _visSort = 'name'; // 'name' | 'price' | 'stock' | 'sortOrder'
let _visFilterType = 'all'; // 'all' | 'dish' | 'category'
let _selectedVis = new Set(); // Set of visibility item ids {type:id}
let _allDishesCache = []; // cached dishes from RTDB
let _allCategoriesCache = []; // cached categories from RTDB
let _featuredDishIds = new Set(); // dishes marked featured

// P4: App Settings state
let _settingsDirty = false; // unsaved changes flag
let _settingsOriginal = {}; // original values for dirty detection
let _settingsSaveTimer = null; // debounce timer for per-field save
let _settingsErrors = {}; // field -> error message map

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

    // P3: Visibility search & filter
    $('visSearch')?.addEventListener('input', (e) => {
        _visSearchQuery = e.target.value;
        _renderVisibilityLists();
    });
    document.querySelectorAll('input[name="visFilter"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _visFilter = e.target.value;
            _renderVisibilityLists();
        });
    });
    document.querySelectorAll('input[name="visSort"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _visSort = e.target.value;
            _renderVisibilityLists();
        });
    });
    document.querySelectorAll('input[name="visFilterType"]').forEach(rb => {
        rb.addEventListener('change', (e) => {
            _visFilterType = e.target.value;
            _renderVisibilityLists();
        });
    });

    // P3: Visibility bulk toolbar actions
    $('btnVisBulkShow')?.addEventListener('click', () => _bulkVisSetVisible(true));
    $('btnVisBulkHide')?.addEventListener('click', () => _bulkVisSetVisible(false));
    $('btnVisBulkFeature')?.addEventListener('click', () => _bulkVisSetFeatured(true));
    $('btnVisBulkUnfeature')?.addEventListener('click', () => _bulkVisSetFeatured(false));
    $('btnVisBulkHideOOS')?.addEventListener('click', _bulkVisHideOutOfStock);
    $('btnVisBulkShowAll')?.addEventListener('click', _bulkVisShowAll);
    $('btnVisBulkSelectAll')?.addEventListener('click', _toggleVisSelectAll);
    $('btnVisBulkCancel')?.addEventListener('click', _clearVisSelection);

    // P3: Preview modal close
    $('btnVisPreviewClose')?.addEventListener('click', _closeVisPreview);

    // P5: Audit log modal close
    $('btnAuditLogClose')?.addEventListener('click', () => _closeModal('auditLogModal'));
    $('btnAuditLogClose2')?.addEventListener('click', () => _closeModal('auditLogModal'));

    // App Settings actions
    $('btnSaveAppSettings')?.addEventListener('click', _saveAppSettings);
    $('btnSaveAppSettingsBottom')?.addEventListener('click', _saveAppSettings);
    $('btnResetAppSettings')?.addEventListener('click', _resetAppSettings);

    // P4: App Settings - dirty tracking + debounced per-field save
    const settingsFields = [
        'caSettingStoreName', 'caSettingStoreAddress', 'caSettingStorePhone',
        'caSettingWhatsAppNumber', 'caSettingGoogleReviewLink', 'caSettingWelcomeMessage',
        'caSettingDeliveryFee', 'caSettingMinOrder',
        'caSettingDineIn', 'caSettingDelivery', 'caSettingPickup', 'caSettingLoyalty'
    ];
    settingsFields.forEach(id => {
        const el = $(id);
        if (!el) return;
        const event = el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(event, () => {
            _markSettingsDirty(id);
            _debounceSaveSettings();
        });
    });

    // P4: Ctrl+S to save settings
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            const pane = $('caPaneSettings');
            if (!pane || pane.classList.contains('hidden')) return;
            e.preventDefault();
            _saveAppSettings();
        }
    });

    // P5: Global keyboard shortcuts across all sub-tabs
    document.addEventListener('keydown', (e) => {
        // Only handle when Customer APP tab is visible
        const pane = $('caPaneSettings')?.closest('.tab-content');
        if (!pane || pane.classList.contains('hidden')) return;

        // 1-4: Switch sub-tabs
        if (e.key >= '1' && e.key <= '4' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const target = e.target;
            const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
            if (isInput) return;
            const subMap = { '1': 'notification', '2': 'offers', '3': 'visibility', '4': 'settings' };
            const sub = subMap[e.key];
            if (sub && canAccessTab(sub)) {
                e.preventDefault();
                _switchSubTab(sub);
            }
        }
        // Ctrl+Shift+A: Open audit log viewer
        if (e.ctrlKey && e.shiftKey && e.key === 'A') {
            e.preventDefault();
            _openAuditLog();
        }
        // Escape: Close any open modal/panel
        if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
            _closeAllModals();
        }
    });

    // P4: Beforeunload warning for unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (_settingsDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

/* ============ P5: KEYBOARD SHORTCUTS & MODAL MANAGEMENT ============ */

let _openModals = []; // stack of modal IDs currently open

function _openModal(modalId) {
    const modal = $(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        _openModals.push(modalId);
    }
}

function _closeModal(modalId) {
    const modal = $(modalId);
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
    _openModals = _openModals.filter(id => id !== modalId);
}

function _closeAllModals() {
    _openModals.slice().forEach(id => _closeModal(id));
}

/**
 * Open the audit log viewer modal.
 */
async function _openAuditLog() {
    const modal = $('auditLogModal');
    const wrap = $('auditLogList');
    if (!modal || !wrap) return;

    _openModal('auditLogModal');
    wrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">Loading audit log…</div>';

    const entries = await loadAuditLog(100);
    if (entries.length === 0) {
        wrap.innerHTML = '<div style="padding:24px;color:var(--text-tertiary);text-align:center;">No audit activity yet.</div>';
    } else {
        wrap.innerHTML = entries.map(e => {
            const at = formatDate(e.at || 0);
            const actionLabel = {
                create: 'Created', update: 'Updated', delete: 'Deleted',
                archive: 'Archived', restore: 'Restored', toggle: 'Toggled',
                reorder: 'Reordered', feature: 'Featured', unfeature: 'Unfeatured'
            }[e.action] || e.action;
            return `
                <div class="audit-row" style="padding:8px 12px;border-bottom:1px solid var(--border,#eef0f3);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:600;color:var(--text-primary);">${_escHtml(e.target)} ${actionLabel}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${e.targetId ? `ID: ${_escHtml(e.targetId)}` : ''}</div>
                    </div>
                    <div style="font-size:11px;color:var(--text-tertiary);text-align:right;line-height:1.4;">
                        <div>${at}</div>
                        <div>${_escHtml(e.byName || e.by)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function _escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Role gating helper: disable or hide edit/delete actions based on role.
 * Call this after rendering any sub-tab content.
 */
function _applyRoleGating(tabId) {
    const canEdit = canEditTab(tabId);
    const canDelete = canDeleteTab(tabId);
    const role = roleLabel();

    // Show role badge in sub-tab header
    const roleBadge = $('roleBadge');
    if (roleBadge) {
        roleBadge.textContent = `Role: ${role}`;
        roleBadge.style.display = '';
    }

    // Disable edit controls if no edit permission
    if (!canEdit) {
        document.querySelectorAll('[data-action="edit"], .icon-btn[data-edit-id], [data-action="save"], .btn-primary[id*="Save"]').forEach(el => {
            el.disabled = true;
            el.title = `${role} cannot edit ${tabId}`;
        });
    }
    // Disable delete controls if no delete permission
    if (!canDelete) {
        document.querySelectorAll('[data-action="delete"], [data-action="archive"], .icon-btn[data-delete-id], .icon-btn[data-archive-id]').forEach(el => {
            el.disabled = true;
            el.title = `${role} cannot delete ${tabId}`;
        });
    }
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
        _applyRoleGating('notification');
    } else if (sub === 'offers') {
        // Reset P2 state when entering offers tab
        _offersSearchQuery = '';
        _offersFilter = 'all';
        _offersSort = 'updated';
        _selectedOffers.clear();
        const searchInput = $('promoOffersSearch');
        if (searchInput) searchInput.value = '';
        _loadPromoOffers();
        _applyRoleGating('offers');
    } else if (sub === 'visibility') {
        // Reset P3 state when entering visibility tab
        _visSearchQuery = '';
        _visFilter = 'all';
        _visSort = 'name';
        _visFilterType = 'all';
        _selectedVis.clear();
        const searchInput = $('visSearch');
        if (searchInput) searchInput.value = '';
        _loadVisibility();
        _applyRoleGating('visibility');
    } else if (sub === 'settings') {
        // Reset P4 state when entering settings tab
        _settingsDirty = false;
        _settingsErrors = {};
        _settingsSaveTimer = null;
        const saveBtn = $('btnSaveAppSettings');
        const saveBtnBottom = $('btnSaveAppSettingsBottom');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Save Settings'; }
        if (saveBtnBottom) { saveBtnBottom.disabled = true; saveBtnBottom.textContent = 'Save All App Settings'; }
        _clearAllSettingsErrors();
        _loadAppSettings();
        _applyRoleGating('settings');
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

async function _togglePromoPage(id, showOnPage) {
    try {
        const oldVal = { promoPage: _allOffersCache.find(d => d.id === id)?.promoPage };
        await update(Outlet.ref(`discounts/${id}`), { promoPage: showOnPage === true, updatedAt: Date.now() });
        await logChange(showOnPage ? 'toggle' : 'toggle', 'discounts', id, oldVal, { promoPage: showOnPage === true });
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
        await Promise.all(ids.map(id =>
            logChange('toggle', 'discounts', id, { promoPage: _allOffersCache.find(d => d.id === id)?.promoPage }, { promoPage: showOnPage === true })
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
        await Promise.all(ids.map(id =>
            logChange('toggle', 'discounts', id, { enabled: _allOffersCache.find(d => d.id === id)?.enabled }, { enabled })
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
        await Promise.all(ids.map(id =>
            logChange('archive', 'discounts', id, { archived: _allOffersCache.find(d => d.id === id)?.archived }, { archived: true })
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
        await Promise.all(ids.map(id =>
            logChange('delete', 'discounts', id, _allOffersCache.find(d => d.id === id), null)
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
        const oldOffer = _allOffersCache.find(d => d.id === _quickEditId) || {};
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
        await logChange('update', 'discounts', _quickEditId, oldOffer, updates);
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
        const oldVal = { archived: _allOffersCache.find(d => d.id === id)?.archived };
        await update(Outlet.ref(`discounts/${id}`), { archived: true, updatedAt: Date.now() });
        await logChange('archive', 'discounts', id, oldVal, { archived: true });
        showToast('Offer archived', 'success');
    } catch (e) {
        showToast('Archive failed: ' + (e?.message || e), 'error');
    }
}

/** Restore an archived offer. */
async function _restoreOffer(id) {
    try {
        const oldVal = { archived: _allOffersCache.find(d => d.id === id)?.archived };
        await update(Outlet.ref(`discounts/${id}`), { archived: false, updatedAt: Date.now() });
        await logChange('restore', 'discounts', id, oldVal, { archived: false });
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
        const oldVal = _allOffersCache.find(d => d.id === id);
        await update(Outlet.ref(`discounts/${id}`), null);
        await logChange('delete', 'discounts', id, oldVal, null);
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
        const newKey = OfferPushKey();
        await update(Outlet.ref('discounts'), { [newKey]: dupe });
        await logChange('create', 'discounts', newKey, null, dupe);
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
    try {
        const [dishSnap, catSnap] = await Promise.all([
            get(Outlet.ref('menu/dishes')),
            get(Outlet.ref('menu/categories'))
        ]);
        const dishes = dishSnap.val() || {};
        const cats = catSnap.val() || {};
        _allDishesCache = Object.entries(dishes).filter(([, d]) => d).map(([id, d]) => ({ id, ...d }));
        _allCategoriesCache = Object.entries(cats).filter(([, c]) => c).map(([id, c]) => ({ id, ...c }));
        _loadVisibilityStats(_allDishesCache, _allCategoriesCache);
        _renderVisibilityLists();
        _loadVisibilityFeatures();
    } catch (e) {
        console.error('[Customer APP] Visibility load error:', e);
        $('visDishList')?.innerHTML && ($('visDishList').innerHTML = '<div style="padding:16px;color:var(--error);">Could not load dishes.</div>');
        $('visCategoryList')?.innerHTML && ($('visCategoryList').innerHTML = '<div style="padding:16px;color:var(--error);">Could not load categories.</div>');
    }
}

async function _loadVisibilityStats(dishes = _allDishesCache, cats = _allCategoriesCache) {
    try {
        const dishList = dishes.filter(Boolean);
        const catList = cats.filter(Boolean);
        const visDishes = dishList.filter(d => d.visible !== false).length;
        const visCats = catList.filter(c => c.visible !== false).length;
        const featuredCount = dishList.filter(d => d.featured === true).length;
        const lowStockCount = dishList.filter(d => d.stock != null && d.stock > 0 && d.stock <= (d.lowStockThreshold || 5)).length;
        const outOfStockCount = dishList.filter(d => d.stock == 0).length;

        if ($('visTotalDishes')) $('visTotalDishes').textContent = String(dishList.length);
        if ($('visVisibleDishes')) $('visVisibleDishes').textContent = String(visDishes);
        if ($('visTotalCategories')) $('visTotalCategories').textContent = String(catList.length);
        if ($('visVisibleCategories')) $('visVisibleCategories').textContent = String(visCats);
        if ($('visFeaturedCount')) $('visFeaturedCount').textContent = String(featuredCount);
        if ($('visLowStockCount')) $('visLowStockCount').textContent = String(lowStockCount);
        if ($('visOutOfStockCount')) $('visOutOfStockCount').textContent = String(outOfStockCount);

        $('caVisEmpty')?.classList.toggle('hidden', dishList.length > 0 || catList.length > 0);
    } catch (e) {
        console.error('[Customer APP] Visibility stats error:', e);
    }
}

/* ============ P3: VISIBILITY RENDER ============ */

/** Apply search + filter + sort to visibility items. */
function _processVisibilityItems() {
    const q = _visSearchQuery.toLowerCase();
    const now = Date.now();

    const items = [];

    // Dishes
    if (_visFilterType === 'all' || _visFilterType === 'dish') {
        for (const d of _allDishesCache) {
            const matchText = !q || String(d.name || '').toLowerCase().includes(q);
            if (!matchText) continue;
            const visible = d.visible !== false;
            const stock = d.stock != null ? d.stock : 0;
            const lowThreshold = d.lowStockThreshold || 5;
            const isOOS = stock === 0;
            const isLowStock = stock > 0 && stock <= lowThreshold;

            if (_visFilter === 'visible' && !visible) continue;
            if (_visFilter === 'hidden' && visible) continue;
            if (_visFilter === 'out-of-stock' && !isOOS) continue;
            if (_visFilter === 'low-stock' && !isLowStock) continue;

            items.push({
                id: `dish:${d.id}`,
                type: 'dish',
                name: d.name || 'Unnamed Dish',
                visible,
                price: d.price != null ? `₹${d.price}` : '—',
                stock,
                lowThreshold,
                isOOS,
                isLowStock,
                featured: d.featured === true,
                sortOrder: d.sortOrder ?? 999,
                updatedAt: d.updatedAt || 0,
                categoryId: d.categoryId,
            });
        }
    }

    // Categories
    if (_visFilterType === 'all' || _visFilterType === 'category') {
        for (const c of _allCategoriesCache) {
            const matchText = !q || String(c.name || '').toLowerCase().includes(q);
            if (!matchText) continue;
            const visible = c.visible !== false;

            if (_visFilter === 'visible' && !visible) continue;
            if (_visFilter === 'hidden' && visible) continue;
            // out-of-stock / low-stock don't apply to categories

            // Count dishes in this category
            const catDishCount = _allDishesCache.filter(d => d.categoryId === c.id).length;

            items.push({
                id: `category:${c.id}`,
                type: 'category',
                name: c.name || 'Unnamed Category',
                visible,
                dishCount: catDishCount,
                sortOrder: c.sortOrder ?? 999,
                updatedAt: c.updatedAt || 0,
            });
        }
    }

    // Sort
    if (_visSort === 'name') items.sort((a, b) => String(a.name || '').localeCompare(b.name || ''));
    else if (_visSort === 'price') items.sort((a, b) => {
        const pa = a.price ? Number(a.price.replace(/[^0-9.]/g, '')) : 0;
        const pb = b.price ? Number(b.price.replace(/[^0-9.]/g, '')) : 0;
        return pb - pa;
    });
    else if (_visSort === 'stock') items.sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0));
    else if (_visSort === 'sortOrder') items.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
    else items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return items;
}

function _renderVisibilityLists() {
    const dishWrap = $('visDishList');
    const catWrap = $('visCategoryList');
    const bulkToolbar = $('visBulkToolbar');
    const bulkCount = $('visBulkSelectCount');
    const selectAllBtn = $('visBtnBulkSelectAll');

    if (!dishWrap || !catWrap) return;

    const items = _processVisibilityItems();
    const dishItems = items.filter(i => i.type === 'dish');
    const catItems = items.filter(i => i.type === 'category');

    // Render dishes
    if (dishItems.length === 0) {
        dishWrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">No matching dishes.</div>';
    } else {
        dishWrap.innerHTML = dishItems.map(d => {
            const visible = d.visible !== false;
            const isSelected = _selectedVis.has(d.id);
            const stockBadge = d.isOOS ? 'out-of-stock' : (d.isLowStock ? 'low-stock' : 'in-stock');
            const stockText = d.isOOS ? 'Out of stock' : (d.isLowStock ? `Low (${d.stock})` : `Stock ${d.stock}`);
            const featuredBadge = d.featured ? ' ★ Featured' : '';
            return `
                <div class="vis-row ${isSelected ? 'selected' : ''}" data-vis-id="${d.id}">
                    <label class="vis-row__select" style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} data-vis-id="${d.id}" style="appearance:none;width:18px;height:18px;border:2px solid var(--border,#e5e7eb);border-radius:4px;cursor:pointer;${isSelected ? 'background:var(--primary,#E84908);border-color:var(--primary,#E84908)' : ''}">
                    </label>
                    <div class="vis-row__info" style="flex:1;min-width:0;cursor:pointer;">
                        <div class="vis-row__name">${_escHtml(d.name)}${d.featured ? ' <span class="vis-row__featured">★</span>' : ''}</div>
                        <div class="vis-row__meta">${d.price} · ${stockText}${featuredBadge}</div>
                    </div>
                    <span class="vis-row__badge vis-row__badge--${stockBadge}" title="${stockText}">
                        ${d.isOOS ? '●' : d.isLowStock ? '▲' : '●'}
                    </span>
                    <span class="vis-row__status ${visible ? 'valid' : 'disabled'}">${visible ? 'Visible' : 'Hidden'}</span>
                    <label class="vis-row__toggle" title="${visible ? 'Hide dish from app' : 'Show dish on app'}">
                        <input type="checkbox" ${visible ? 'checked' : ''} data-vis-id="${d.id}" data-vis-type="dish">
                    </label>
                </div>
            `;
        }).join('');
    }

    // Render categories
    if (catItems.length === 0) {
        catWrap.innerHTML = '<div style="padding:16px;color:var(--text-tertiary);">No matching categories.</div>';
    } else {
        catWrap.innerHTML = catItems.map(c => {
            const visible = c.visible !== false;
            const isSelected = _selectedVis.has(c.id);
            return `
                <div class="vis-row ${isSelected ? 'selected' : ''}" data-vis-id="${c.id}">
                    <label class="vis-row__select" style="display:flex;align-items:center;gap:8px;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} data-vis-id="${c.id}" style="appearance:none;width:18px;height:18px;border:2px solid var(--border,#e5e7eb);border-radius:4px;cursor:pointer;${isSelected ? 'background:var(--primary,#E84908);border-color:var(--primary,#E84908)' : ''}">
                    </label>
                    <div class="vis-row__info" style="flex:1;min-width:0;cursor:pointer;">
                        <div class="vis-row__name">${_escHtml(c.name)}</div>
                        <div class="vis-row__meta">${c.dishCount} dish${c.dishCount !== 1 ? 's' : ''} · ${visible ? 'Visible on App' : 'Hidden from App'}</div>
                    </div>
                    <span class="vis-row__badge vis-row__badge--category">${c.dishCount}</span>
                    <span class="vis-row__status ${visible ? 'valid' : 'disabled'}">${visible ? 'Visible' : 'Hidden'}</span>
                    <label class="vis-row__toggle" title="${visible ? 'Hide category from app' : 'Show category on app'}">
                        <input type="checkbox" ${visible ? 'checked' : ''} data-vis-id="${c.id}" data-vis-type="category">
                    </label>
                </div>
            `;
        }).join('');
    }

    // Update bulk toolbar
    if (bulkToolbar) {
        if (_selectedVis.size === 0) {
            bulkToolbar.classList.add('hidden');
        } else {
            bulkToolbar.classList.remove('hidden');
            if (bulkCount) bulkCount.textContent = String(_selectedVis.size);
            if (selectAllBtn) {
                const visibleCount = items.length;
                selectAllBtn.textContent = _selectedVis.size === visibleCount && visibleCount > 0 ? 'Deselect all' : 'Select all';
            }
        }
    }

    // Event delegation
    dishWrap.replaceWith(dishWrap.cloneNode(true));
    catWrap.replaceWith(catWrap.cloneNode(true));
    const newDishWrap = $('visDishList');
    const newCatWrap = $('visCategoryList');

    const handleVisClick = (e, wrap) => {
        const row = e.target.closest('.vis-row');
        if (!row) return;
        const id = row.dataset.visId;
        const type = row.querySelector('input[data-vis-type]')?.dataset.visType || (id.startsWith('dish:') ? 'dish' : 'category');

        // Selection checkbox
        if (e.target.matches('input[data-vis-id]') && e.target.closest('.vis-row__select')) {
            _toggleVisSelect(id);
            return;
        }

        // Visibility toggle checkbox
        if (e.target.matches('input[data-vis-type]') && !e.target.closest('.vis-row__select')) {
            const checked = e.target.checked;
            const realId = id.replace(/^(dish|category):/, '');
            _toggleVisItem(type, realId, checked);
            return;
        }

        // Row click -> toggle visibility
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
            const realId = id.replace(/^(dish|category):/, '');
            const currentCheckbox = row.querySelector('input[data-vis-type]');
            const newChecked = !currentCheckbox.checked;
            _toggleVisItem(type, realId, newChecked);
        }
    };

    newDishWrap.addEventListener('click', (e) => handleVisClick(e, newDishWrap));
    newCatWrap.addEventListener('click', (e) => handleVisClick(e, newCatWrap));

    // Rebind visibility toggle checkboxes
    [newDishWrap, newCatWrap].forEach(wrap => {
        wrap.querySelectorAll('input[data-vis-type]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.dataset.visId;
                const type = cb.dataset.visType;
                const realId = id.replace(/^(dish|category):/, '');
                _toggleVisItem(type, realId, cb.checked);
            });
        });
    });
}

function _toggleVisSelect(id) {
    if (_selectedVis.has(id)) _selectedVis.delete(id);
    else _selectedVis.add(id);
    _renderVisibilityLists();
}

function _toggleVisSelectAll() {
    const items = _processVisibilityItems();
    if (_selectedVis.size === items.length && items.length > 0) {
        _selectedVis.clear();
    } else {
        items.forEach(i => _selectedVis.add(i.id));
    }
    _renderVisibilityLists();
}

function _clearVisSelection() {
    _selectedVis.clear();
    _renderVisibilityLists();
}

async function _toggleVisItem(type, id, visible) {
    try {
        const path = type === 'dish' ? `menu/dishes/${id}` : `menu/categories/${id}`;
        const oldVal = type === 'dish'
            ? { visible: _allDishesCache.find(d => d.id === id)?.visible }
            : { visible: _allCategoriesCache.find(c => c.id === id)?.visible };
        await update(Outlet.ref(path), { visible: visible === true, updatedAt: Date.now() });
        await logChange('toggle', type === 'dish' ? 'dishes' : 'categories', id, oldVal, { visible: visible === true });
        // Refresh caches
        _loadVisibility();
    } catch (e) {
        showToast('Update failed: ' + (e?.message || e), 'error');
        _renderVisibilityLists();
    }
}

async function _bulkVisSetVisible(visible) {
    const ids = Array.from(_selectedVis);
    if (ids.length === 0) return;
    try {
        await Promise.all(ids.map(id => {
            const [type, realId] = id.split(':');
            const path = type === 'dish' ? `menu/dishes/${realId}` : `menu/categories/${realId}`;
            return update(Outlet.ref(path), { visible: visible === true, updatedAt: Date.now() });
        }));
        await Promise.all(ids.map(id => {
            const [type, realId] = id.split(':');
            const oldVal = type === 'dish'
                ? { visible: _allDishesCache.find(d => d.id === realId)?.visible }
                : { visible: _allCategoriesCache.find(c => c.id === realId)?.visible };
            return logChange('toggle', type === 'dish' ? 'dishes' : 'categories', realId, oldVal, { visible: visible === true });
        }));
        showToast(`${ids.length} item${ids.length === 1 ? '' : 's'} ${visible ? 'shown' : 'hidden'} on app`, 'success');
        _clearVisSelection();
    } catch (e) {
        showToast('Bulk update failed: ' + (e?.message || e), 'error');
    }
}

async function _bulkVisSetFeatured(featured) {
    const dishIds = Array.from(_selectedVis).filter(id => id.startsWith('dish:'));
    if (dishIds.length === 0) {
        showToast('No dishes selected to mark featured.', 'warning');
        return;
    }
    // Enforce max 6 featured
    const currentFeatured = _allDishesCache.filter(d => d.featured === true).length;
    const toAdd = dishIds.filter(id => {
        const realId = id.replace(/^dish:/, '');
        return !_allDishesCache.find(d => d.id === realId)?.featured;
    }).length;
    if (currentFeatured + toAdd > 6) {
        showToast('Maximum 6 featured dishes allowed.', 'warning');
        return;
    }
    try {
        await Promise.all(dishIds.map(id => {
            const realId = id.replace(/^dish:/, '');
            return update(Outlet.ref(`menu/dishes/${realId}`), { featured: featured === true, updatedAt: Date.now() });
        }));
        await Promise.all(dishIds.map(id => {
            const realId = id.replace(/^dish:/, '');
            return logChange('feature', 'dishes', realId, { featured: _allDishesCache.find(d => d.id === realId)?.featured }, { featured: featured === true });
        }));
        showToast(`${dishIds.length} dish${dishIds.length === 1 ? '' : 'es'} ${featured ? 'featured' : 'unfeatured'}`, 'success');
        _clearVisSelection();
    } catch (e) {
        showToast('Feature update failed: ' + (e?.message || e), 'error');
    }
}

async function _bulkVisHideOutOfStock() {
    const oosDishes = _allDishesCache.filter(d => d.stock === 0 && d.visible !== false);
    if (oosDishes.length === 0) {
        showToast('No out-of-stock dishes to hide.', 'info');
        return;
    }
    try {
        await Promise.all(oosDishes.map(d =>
            update(Outlet.ref(`menu/dishes/${d.id}`), { visible: false, updatedAt: Date.now() })
        ));
        await Promise.all(oosDishes.map(d =>
            logChange('toggle', 'dishes', d.id, { visible: true }, { visible: false })
        ));
        showToast(`${oosDishes.length} out-of-stock dish${oosDishes.length === 1 ? '' : 'es'} hidden`, 'success');
        _loadVisibility();
    } catch (e) {
        showToast('Hide failed: ' + (e?.message || e), 'error');
    }
}

async function _bulkVisShowAll() {
    const hiddenItems = _processVisibilityItems().filter(i => !i.visible);
    if (hiddenItems.length === 0) {
        showToast('No hidden items to show.', 'info');
        return;
    }
    try {
        await Promise.all(hiddenItems.map(i => {
            const [type, realId] = i.id.split(':');
            const path = type === 'dish' ? `menu/dishes/${realId}` : `menu/categories/${realId}`;
            return update(Outlet.ref(path), { visible: true, updatedAt: Date.now() });
        }));
        await Promise.all(hiddenItems.map(i => {
            const [type, realId] = i.id.split(':');
            return logChange('toggle', type === 'dish' ? 'dishes' : 'categories', realId, { visible: false }, { visible: true });
        }));
        showToast(`${hiddenItems.length} item${hiddenItems.length === 1 ? '' : 's'} shown on app`, 'success');
        _clearVisSelection();
    } catch (e) {
        showToast('Show all failed: ' + (e?.message || e), 'error');
    }
}

/* ============ P3: VISIBILITY PREVIEW ============ */

function _openVisPreview() {
    const modal = $('visPreviewModal');
    const wrap = $('visPreviewList');
    if (!modal || !wrap) return;

    const now = Date.now();
    const visibleDishes = _allDishesCache.filter(d => d.visible !== false && d.featured === true);
    const visibleCategories = _allCategoriesCache.filter(c => c.visible !== false);
    const features = (_allDishesCache.length > 0) ? {} : {};

    if (visibleDishes.length === 0 && visibleCategories.length === 0) {
        wrap.innerHTML = '<div style="padding:24px;color:var(--text-tertiary);text-align:center;">No visible items to preview.</div>';
    } else {
        let html = '';
        if (visibleCategories.length > 0) {
            html += '<div style="font-weight:600;margin-bottom:8px;">Categories</div>';
            html += visibleCategories.map(c => `
                <div style="padding:8px 12px;border-bottom:1px solid var(--border,#e5e7eb);">
                    ${_escHtml(c.name)} (${_allDishesCache.filter(d => d.categoryId === c.id && d.visible !== false).length} dishes)
                </div>
            `).join('');
        }
        if (visibleDishes.length > 0) {
            html += '<div style="font-weight:600;margin-top:12px;margin-bottom:8px;">Featured Dishes</div>';
            html += visibleDishes.map(d => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border,#e5e7eb);">
                    <span class="vis-row__badge vis-row__badge--in-stock" style="font-size:10px;">★</span>
                    <div style="flex:1;min-width:0;">
                        <div class="vis-row__name" style="font-size:13px;">${_escHtml(d.name)}</div>
                        <div class="vis-row__meta" style="font-size:11px;">${d.price != null ? `₹${d.price}` : '—'}</div>
                    </div>
                </div>
            `).join('');
        }
        wrap.innerHTML = html;
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
}

function _closeVisPreview() {
    const modal = $('visPreviewModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
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

/* ============ PANE 4: APP SETTINGS ============ */

async function _loadAppSettings() {
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        const store = snap.val() || {};
        const features = store.appFeatures || {};

        // Store originals for dirty tracking
        _settingsOriginal = {
            storeName: store.storeName || '',
            address: store.address || '',
            phone: store.phone || '',
            whatsappNumber: store.whatsappNumber || '',
            googleReviewLink: store.googleReviewLink || '',
            appWelcomeMessage: store.appWelcomeMessage || '',
            deliveryFee: store.deliveryFee != null ? store.deliveryFee : '',
            minOrder: store.minOrder != null ? store.minOrder : '',
            dineInEnabled: store.dineInEnabled !== false,
            deliveryEnabled: store.deliveryEnabled !== false,
            pickupEnabled: store.pickupEnabled !== false,
            loyaltyEnabled: store.loyaltyEnabled === true,
            appFeatures: store.appFeatures || {},
            businessHours: store.businessHours || {},
            timezone: store.timezone || 'Asia/Kolkata',
            gstRate: store.gstRate != null ? store.gstRate : 5,
            taxOnDeliveryFee: store.taxOnDeliveryFee === true,
            themeColor: store.themeColor || '#E84908',
            logoUrl: store.logoUrl || ''
        };
        _settingsDirty = false;

        const fields = {
            caSettingStoreName: _settingsOriginal.storeName,
            caSettingStoreAddress: _settingsOriginal.address,
            caSettingStorePhone: _settingsOriginal.phone,
            caSettingWhatsAppNumber: _settingsOriginal.whatsappNumber,
            caSettingGoogleReviewLink: _settingsOriginal.googleReviewLink,
            caSettingWelcomeMessage: _settingsOriginal.appWelcomeMessage,
            caSettingDeliveryFee: _settingsOriginal.deliveryFee,
            caSettingMinOrder: _settingsOriginal.minOrder,
            caSettingDineIn: _settingsOriginal.dineInEnabled,
            caSettingDelivery: _settingsOriginal.deliveryEnabled,
            caSettingPickup: _settingsOriginal.pickupEnabled,
            caSettingLoyalty: _settingsOriginal.loyaltyEnabled
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = $(id);
            if (!el) return;
            if (el.type === 'checkbox') el.checked = val === true;
            else el.value = val;
        });

        // New P4 fields
        $('caSettingTimezone')?.value && ($('caSettingTimezone').value = _settingsOriginal.timezone);
        $('caSettingGSTRate')?.value && ($('caSettingGSTRate').value = String(_settingsOriginal.gstRate));
        $('caSettingTaxOnDeliveryFee')?.checked && ($('caSettingTaxOnDeliveryFee').checked = _settingsOriginal.taxOnDeliveryFee === true);
        $('caSettingThemeColor')?.value && ($('caSettingThemeColor').value = _settingsOriginal.themeColor);
        $('caSettingLogoUrl')?.value && ($('caSettingLogoUrl').value = _settingsOriginal.logoUrl);

        // Business hours grid
        _renderBusinessHours(_settingsOriginal.businessHours);

        // Update save button state
        const saveBtn = $('btnSaveAppSettings');
        const saveBtnBottom = $('btnSaveAppSettingsBottom');
        if (saveBtn) saveBtn.disabled = true;
        if (saveBtnBottom) saveBtnBottom.disabled = true;
        _updateSettingsDirtyUI();

    } catch (e) {
        console.error('[Customer APP] Load settings error:', e);
        showToast('Could not load app settings', 'error');
    }
}

async function _saveAppSettings() {
    try {
        // Validate all fields first
        const errors = _validateSettings();
        _settingsErrors = errors;
        _renderSettingsErrors();
        if (Object.keys(errors).length > 0) {
            showToast('Please fix the errors above before saving.', 'warning');
            return;
        }

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
            appFeatures: {
                onlineOrdering: $('caSettingDineIn')?.checked === true, // keep in sync
                tableBooking: $('caSettingTableBooking')?.checked === true,
                promoPage: $('caSettingPromoPage')?.checked === true,
                loyalty: $('caSettingLoyalty')?.checked === true
            },
            timezone: $('caSettingTimezone')?.value || 'Asia/Kolkata',
            gstRate: $('caSettingGSTRate')?.value ? Number($('caSettingGSTRate').value) : 5,
            taxOnDeliveryFee: $('caSettingTaxOnDeliveryFee')?.checked === true,
            themeColor: $('caSettingThemeColor')?.value || '#E84908',
            logoUrl: $('caSettingLogoUrl')?.value || '',
            businessHours: _collectBusinessHours(),
            updatedAt: Date.now()
        };
        await update(Outlet.ref('settings/Store'), store);
        await logChange('update', 'settings/Store', 'Store', _settingsOriginal, store);
        _settingsDirty = false;
        _settingsOriginal = { ...store };
        _settingsErrors = {};
        _renderSettingsErrors();
        _updateSettingsDirtyUI();
        showToast('App settings saved', 'success');
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
    }
}

/* ============ P4: SETTINGS VALIDATION & DIRTY TRACKING ============ */

function _markSettingsDirty(fieldId) {
    _settingsDirty = true;
    _updateSettingsDirtyUI();
}

function _debounceSaveSettings() {
    if (_settingsSaveTimer) clearTimeout(_settingsSaveTimer);
    _settingsSaveTimer = setTimeout(() => {
        if (_settingsDirty) {
            _saveAppSettings();
        }
    }, 500);
}

function _validateSettings() {
    const errors = {};

    // Store name - required
    const storeName = ($('caSettingStoreName')?.value || '').trim();
    if (!storeName) errors.caSettingStoreName = 'Store name is required';

    // Phone - 10 digit Indian mobile
    const phone = ($('caSettingStorePhone')?.value || '').replace(/\D/g, '');
    if (phone && !/^[6-9]\d{9}$/.test(phone)) errors.caSettingStorePhone = 'Enter a valid 10-digit mobile number';

    // WhatsApp - 10 digit if provided
    const wa = ($('caSettingWhatsAppNumber')?.value || '').replace(/\D/g, '');
    if (wa && !/^[6-9]\d{9}$/.test(wa)) errors.caSettingWhatsAppNumber = 'Enter a valid 10-digit mobile number';

    // Google Review Link - valid URL if provided
    const reviewLink = ($('caSettingGoogleReviewLink')?.value || '').trim();
    if (reviewLink) {
        try { new URL(reviewLink); } catch { errors.caSettingGoogleReviewLink = 'Enter a valid URL'; }
    }

    // Delivery fee - non-negative number
    const deliveryFee = $('caSettingDeliveryFee')?.value;
    if (deliveryFee !== '' && deliveryFee !== null) {
        const df = Number(deliveryFee);
        if (isNaN(df) || df < 0) errors.caSettingDeliveryFee = 'Delivery fee must be a non-negative number';
    }

    // Min order - non-negative number
    const minOrder = $('caSettingMinOrder')?.value;
    if (minOrder !== '' && minOrder !== null) {
        const mo = Number(minOrder);
        if (isNaN(mo) || mo < 0) errors.caSettingMinOrder = 'Minimum order must be a non-negative number';
    }

    // GST rate - 0 to 28
    const gstRate = $('caSettingGSTRate')?.value;
    if (gstRate !== '' && gstRate !== null) {
        const gr = Number(gstRate);
        if (isNaN(gr) || gr < 0 || gr > 28) errors.caSettingGSTRate = 'GST rate must be between 0 and 28';
    }

    return errors;
}

function _renderSettingsErrors() {
    Object.keys(_settingsErrors).forEach(fieldId => {
        const el = $(fieldId);
        const errorMsg = _settingsErrors[fieldId];
        if (!el) return;

        // Remove existing error
        const existing = el.parentElement?.querySelector('.ca-field-error');
        if (existing) existing.remove();

        // Add error styling
        el.style.borderColor = 'var(--error, #dc2626)';
        el.style.backgroundColor = '#fef2f2';

        // Add error message
        const errEl = document.createElement('div');
        errEl.className = 'ca-field-error';
        errEl.style.color = 'var(--error, #dc2626)';
        errEl.style.fontSize = '11px';
        errEl.style.marginTop = '2px';
        errEl.textContent = errorMsg;
        el.parentElement?.appendChild(errEl);
    });

    // Clear errors for fields without errors
    document.querySelectorAll('.ca-field-error').forEach(el => {
        const fieldId = el.previousElementSibling?.id;
        if (fieldId && !_settingsErrors[fieldId]) {
            el.remove();
            const input = el.previousElementSibling;
            if (input) {
                input.style.borderColor = '';
                input.style.backgroundColor = '';
            }
        }
    });
}

function _clearAllSettingsErrors() {
    document.querySelectorAll('.ca-field-error').forEach(el => el.remove());
    document.querySelectorAll('#caSettingStoreName, #caSettingStorePhone, #caSettingWhatsAppNumber, #caSettingGoogleReviewLink, #caSettingDeliveryFee, #caSettingMinOrder, #caSettingGSTRate').forEach(el => {
        el.style.borderColor = '';
        el.style.backgroundColor = '';
    });
}

function _updateSettingsDirtyUI() {
    const saveBtn = $('btnSaveAppSettings');
    const saveBtnBottom = $('btnSaveAppSettingsBottom');
    if (!saveBtn || !saveBtnBottom) return;

    if (_settingsDirty) {
        saveBtn.disabled = false;
        saveBtnBottom.disabled = false;
        saveBtn.textContent = 'Save Settings (unsaved)';
        saveBtnBottom.textContent = 'Save All App Settings (unsaved)';
    } else {
        saveBtn.disabled = true;
        saveBtnBottom.disabled = true;
        saveBtn.textContent = 'Save Settings';
        saveBtnBottom.textContent = 'Save All App Settings';
    }
}

function _renderBusinessHours(hours = {}) {
    const grid = $('businessHoursGrid');
    if (!grid) return;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">';
    days.forEach((day, i) => {
        const dayData = hours[day] || { open: '09:00', close: '22:00', closed: false };
        html += `
            <div style="border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:10px;background:var(--bg,#fff);">
                <div style="font-weight:600;font-size:13px;color:var(--text-primary);margin-bottom:6px;">${dayLabels[i]}</div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="font-size:11px;color:var(--text-secondary);margin-right:6px;">Open</label>
                    <input type="time" id="bh_${day}_open" value="${dayData.open || '09:00'}" style="flex:1;font-size:12px;padding:4px;border:1px solid var(--border,#e5e7eb);border-radius:4px;">
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <label style="font-size:11px;color:var(--text-secondary);margin-right:6px;">Close</label>
                    <input type="time" id="bh_${day}_close" value="${dayData.close || '22:00'}" style="flex:1;font-size:12px;padding:4px;border:1px solid var(--border,#e5e7eb);border-radius:4px;">
                </div>
                <div style="margin-top:6px;">
                    <label class="ca-toggle" style="font-size:11px;">
                        <input type="checkbox" id="bh_${day}_closed" ${dayData.closed ? 'checked' : ''}>
                        <span class="ca-toggle-slider"></span>
                        Closed
                    </label>
                </div>
            </div>
        `;
    });
    html += '</div>';
    grid.innerHTML = html;
    // Wire change listeners for dirty tracking
    days.forEach(day => {
        $('bh_' + day + '_open')?.addEventListener('change', () => { _markSettingsDirty('businessHours'); _debounceSaveSettings(); });
        $('bh_' + day + '_close')?.addEventListener('change', () => { _markSettingsDirty('businessHours'); _debounceSaveSettings(); });
        $('bh_' + day + '_closed')?.addEventListener('change', () => { _markSettingsDirty('businessHours'); _debounceSaveSettings(); });
    });
}

function _collectBusinessHours() {
    const hours = {};
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    days.forEach(day => {
        const open = $(`bh_${day}_open`)?.value || '09:00';
        const close = $(`bh_${day}_close`)?.value || '22:00';
        const closed = $(`bh_${day}_closed`)?.checked === false ? false : $(`bh_${day}_closed`)?.checked === true;
        hours[day] = { open, close, closed };
    });
    return hours;
}

function _resetAppSettings() {
    showConfirm('Reset all app settings to defaults? This cannot be undone.', 'Reset App Settings')
        .then(ok => {
            if (!ok) return;
            _settingsDirty = false;
            _settingsErrors = {};
            _renderSettingsErrors();
            _updateSettingsDirtyUI();
            _loadAppSettings();
            showToast('Settings reset to loaded values.', 'info');
        });
}

