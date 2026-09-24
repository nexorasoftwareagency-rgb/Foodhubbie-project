/**
 * FoodHubbie ERP | DISCOUNTS MODULE
 * CRUD UI for /discounts/* — global, category, firstOrder, coupon types.
 */

import { Outlet, ref, get, onValue, set, update, remove, push, runTransaction, isConnected, onConnectionChange } from '../firebase.js';
import { state } from '../state.js';
import { showToast, showConfirm } from '../ui-utils.js';
import { haptic, escapeHtml, formatDate, formatOrderId } from '../utils.js';
import { clearDiscountCache } from './discount-evaluator.js';
import { loadLucide } from '../ui.js';

const DISCOUNT_TYPES = ['global', 'category', 'firstOrder', 'coupon'];

function _fmtINR(n) {
    return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

let _listener = null;
let _allDiscountsSnap = {};
let _categoriesSnap = [];
let _editingId = null;
let _connUnsub = null;

function _ref(path) { return Outlet.ref(path); }
function _discRef(sub) { return Outlet.ref(`discounts/${sub}`); }
function _toLocalInputValue(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function _toIsoNoZ(str) { return str ? new Date(str).getTime() : 0; }

function _status(d) {
    const now = Date.now();
    if (d.enabled === false) return 'disabled';
    if (d.startsAt && now < d.startsAt) return 'scheduled';
    if (d.endsAt && d.endsAt > 0 && now > d.endsAt) return 'expired';
    return 'active';
}

function _typeBadge(type) {
    const map = {
        global: ['🌐', 'Global'],
        category: ['🏷️', 'Category'],
        firstOrder: ['✨', 'New Customer'],
        coupon: ['🎟️', 'Coupon']
    };
    const [icon, label] = map[type] || ['?', type];
    return `<span class="discount-type-badge discount-type-${escapeHtml(type)}">${icon} ${escapeHtml(label)}</span>`;
}

function _valueBadge(d) {
    return d.mode === 'percent'
        ? `<strong>${Number(d.value).toFixed(d.value % 1 === 0 ? 0 : 1)}%</strong> off`
        : `<strong>₹${Number(d.value).toFixed(0)}</strong> off`;
}

function _windowLine(d) {
    if (d.type === 'firstOrder') return '<em>Always on for new customers</em>';
    const s = d.startsAt ? formatDate(d.startsAt) : 'now';
    const e = (!d.endsAt || d.endsAt === 0) ? 'no end' : formatDate(d.endsAt);
    return `${s} → ${e}`;
}

function _renderCard(d) {
    const status = _status(d);
    const used = d.stats?.usedCount || 0;
    const given = d.stats?.totalDiscountGiven || 0;
    const lastUsed = d.stats?.lastUsedAt ? formatDate(d.stats.lastUsedAt) : null;

    // Expiry countdown
    let expiryBadge = '';
    if (d.endsAt && d.endsAt > 0) {
        const msLeft = d.endsAt - Date.now();
        if (msLeft > 0) {
            const days = Math.ceil(msLeft / 86400000);
            expiryBadge = `<span class="badge badge-warning">Expires in ${days}d</span>`;
        } else {
            const daysExpired = Math.ceil(-msLeft / 86400000);
            expiryBadge = `<span class="badge badge-danger">Expired ${daysExpired}d ago</span>`;
        }
    }

    // Usage bar (when globalLimit is set)
    let usageBar = '';
    if (d.globalLimit && used > 0) {
        const pct = Math.min(100, Math.round((used / d.globalLimit) * 100));
        usageBar = `<div class="discount-usage-bar"><div style="width:${pct}%;"></div></div>`;
    }

    return `
    <div class="discount-card" data-id="${escapeHtml(d.id)}" data-action="viewDiscountUsage">
        <div class="flex-between flex-center flex-wrap-mobile">
            <div style="flex:1; min-width:200px;">
                <div class="flex-row flex-gap-10 flex-center flex-wrap-mobile">
                    <strong>${escapeHtml(d.name || d.id)}</strong>
                    ${_typeBadge(d.type)}
                    <span class="badge badge-${status}">${escapeHtml(status)}</span>
                    ${d.stackable ? '<span class="badge badge-info">stackable</span>' : ''}
                    ${d.channel && d.channel !== 'all' ? `<span class="badge badge-secondary">${escapeHtml(d.channel === 'whatsapp' ? 'WhatsApp' : d.channel === 'pos' ? 'POS' : d.channel === 'both' ? 'WA+POS' : d.channel)}</span>` : ''}
                    ${expiryBadge}
                </div>
                <div class="text-muted-small mt-4">
                    ${_valueBadge(d)}${d.maxCap ? ` (cap ₹${Number(d.maxCap).toFixed(0)})` : ''}
                    ${d.type === 'coupon' && d.couponCode ? ` · code <code>${escapeHtml(d.couponCode)}</code>` : ''}
                    ${d.type === 'category' && Array.isArray(d.categoryIds) ? ` · ${d.categoryIds.length} categor${d.categoryIds.length === 1 ? 'y' : 'ies'}` : ''}
                </div>
                <div class="text-muted-small">${_windowLine(d)}</div>
                ${used > 0 ? `<div class="text-muted-small mt-4">Used <strong>${used}×</strong> · given <strong>₹${given.toLocaleString('en-IN')}</strong>${d.globalLimit ? ` / ${d.globalLimit} limit` : ''}${lastUsed ? ` · Last: ${lastUsed}` : ''}</div>` : ''}
                ${usageBar}
            </div>
            <div class="flex-row flex-gap-6 flex-center">
                <label class="promo-switch" title="Enable / disable">
                    <input type="checkbox" class="discount-toggle" data-id="${escapeHtml(d.id)}" ${d.enabled !== false ? 'checked' : ''}>
                    <span class="promo-slider" style="${d.enabled !== false ? '' : 'background:#94a3b8;'}"></span>
                </label>
                <button class="btn-text" data-action="editDiscount" data-id="${escapeHtml(d.id)}" title="Edit">
                    <i data-lucide="pencil"></i>
                </button>
                <button class="btn-text text-danger" data-action="deleteDiscount" data-id="${escapeHtml(d.id)}" title="Delete">
                    <i data-lucide="trash-2"></i>
                </button>
                <i data-lucide="chevron-right" class="discount-card-chevron" style="color:#cbd5e1;width:16px;height:16px;"></i>
            </div>
        </div>
    </div>`;
}

async function _renderList() {
    const all = Object.entries(_allDiscountsSnap).map(([id, d]) => ({ id, ...d }));
    const groups = { active: [], scheduled: [], expired: [] };
    for (const d of all) {
        const s = _status(d);
        if (s === 'active') groups.active.push(d);
        else if (s === 'scheduled') groups.scheduled.push(d);
        else groups.expired.push(d);
    }
    const _ms = v => typeof v === 'string' ? new Date(v).getTime() : (v || 0);
    const sorted = arr => arr.sort((a, b) => _ms(b.createdAt) - _ms(a.createdAt));

    const fill = (id, list, emptyMsg) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (list.length === 0) {
            el.innerHTML = `<p class="text-muted-small">${emptyMsg}</p>`;
            return;
        }
        el.innerHTML = sorted(list).map(_renderCard).join('');
    };
    fill('discountListActive',   groups.active,   'No active discounts. Click "New Discount" to create one.');
    fill('discountListScheduled', groups.scheduled, 'No scheduled discounts.');
    fill('discountListExpired',  groups.expired,  'No expired or disabled discounts.');

    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = String(n); };
    set('discountCountActive',    groups.active.length);
    set('discountCountScheduled', groups.scheduled.length);
    set('discountCountExpired',   groups.expired.length);

    await loadLucide();
    window.lucide.createIcons({ root: document.getElementById('tab-discounts') });
}

function _switchList(mode) {
    document.querySelectorAll('#tab-discounts .promo-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    const map = { active: 'discountListActive', scheduled: 'discountListScheduled', expired: 'discountListExpired', usage: 'discountListUsage' };
    Object.entries(map).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', k !== mode);
    });
    if (mode === 'usage') _renderUsageList();
}

async function _renderUsageList() {
    const el = document.getElementById('discountListUsage');
    if (!el) return;

    try {
        const [discountsSnap, usageSnap] = await Promise.all([
            get(_ref('discounts')),
            get(_ref('discountsUsage'))
        ]);

        const discounts = discountsSnap.val() || {};
        const usage = usageSnap.val() || {};

        const usageEntries = Object.entries(usage).map(([id, u]) => ({
            id,
            discountId: u.discountId,
            discountLabel: u.discountLabel || '',
            orderId: u.orderId,
            customerPhone: u.customerPhone,
            amountGiven: Number(u.amountGiven || 0),
            appliedAt: u.appliedAt,
            channel: u.channel || 'unknown',
            source: u.source || 'auto',
            discountSource: u.discountSource || u.source || ''
        }));

        if (usageEntries.length === 0) {
            el.innerHTML = `
                <div class="discount-usage-empty">
                    <i data-lucide="clipboard-list"></i>
                    <h4>No discount usage yet</h4>
                    <p>Customer allotments will appear here as discounts are redeemed.</p>
                </div>
            `;
            await loadLucide();
            window.lucide.createIcons({ root: el });
            return;
        }

        // Sort by appliedAt descending
        usageEntries.sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));

        // Build customer name cache
        const nameCache = new Map();
        async function getName(phone) {
            if (!phone) return 'Walk-in';
            const clean = String(phone).replace(/\D/g, '').slice(-10);
            if (!clean) return 'Walk-in';
            if (nameCache.has(clean)) return nameCache.get(clean);
            try {
                const snap = await get(Outlet.ref(`customers/${clean}`));
                const name = snap.exists() ? (snap.val()?.name || null) : null;
                nameCache.set(clean, name);
                return name;
            } catch { return 'Walk-in'; }
        }

        // Filter dropdown HTML
        const typeFilterHtml = `
            <select id="usageTypeFilter" class="usage-type-filter" style="padding:6px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; margin-bottom:12px;">
                <option value="all">All Types</option>
                <option value="coupon">Coupon</option>
                <option value="firstOrder">First Order</option>
                <option value="category">Category</option>
                <option value="global">Storewide</option>
                <option value="manual">Manual</option>
            </select>
        `;

        // Filter state
        let currentTypeFilter = 'all';
        let filtered = usageEntries;

        function applyFilter() {
            filtered = currentTypeFilter === 'all'
                ? usageEntries
                : usageEntries.filter(u => u.discountSource === currentTypeFilter || 
                    (currentTypeFilter === 'manual' && u.discountSource?.startsWith('manual:')));
            render();
        }

        async function render() {
            el.innerHTML = `
                <div class="flex-between flex-center mb-16 flex-wrap" style="gap:8px;">
                    <h3 class="panel-title fs-14" style="margin:0;">Usage / Allotments <span class="badge">${usageEntries.length}</span></h3>
                    ${typeFilterHtml}
                </div>
                <div class="discount-usage-table-container" style="max-height:500px; overflow-y:auto;">
                    <table class="discount-usage-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="position:sticky; top:0; background:#f8fafc; z-index:1;">
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Customer</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Phone</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Discount</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Type</th>
                                <th style="text-align:right; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Amount</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Channel</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Order</th>
                                <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Date</th>
                                <th style="text-align:center; padding:8px 10px; border-bottom:1px solid #e2e8f0;">Receipt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map(u => {
                                const d = new Date(u.appliedAt || 0);
                                const dateStr = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                                const channel = String(u.channel || 'other');
                                const amt = Number(u.amountGiven) || 0;
                                const isVoid = amt < 0;
                                const orderLink = u.orderId ? `<span class="usage-log-order-link" data-action="viewOrderFromDiscountUsage" data-id="${escapeHtml(u.orderId)}" style="cursor:pointer; color:#1d4ed8; text-decoration:underline;">#${escapeHtml(formatOrderId(u.orderId))}</span>` : '—';
                                return `
                                    <tr>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;">${escapeHtml(u.customerPhone || 'Walk-in')}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;">${escapeHtml(u.customerPhone || 'Walk-in')}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;">${escapeHtml(u.discountLabel || 'Discount')}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;"><span class="discount-type-badge discount-type-${escapeHtml(u.discountSource || 'auto')}">${escapeHtml(u.discountSource || 'auto')}</span></td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9; text-align:right;${isVoid ? ' color:#16a34a;' : ''}">${isVoid ? `<span class="void-badge">void</span> +₹${Math.abs(amt).toLocaleString('en-IN')}` : _fmtINR(amt)}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;"><span class="channel-chip channel-${escapeHtml(channel)}">${escapeHtml(channel)}</span></td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;">${orderLink}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9;">${escapeHtml(dateStr)}</td>
                                        <td style="padding:8px 10px; border-bottom:1px solid #f1f5f9; text-align:center;">
                                            <button type="button" class="btn-text" data-action="viewReceiptFromUsage" data-order-id="${escapeHtml(u.orderId)}" data-discount-label="${escapeHtml(u.discountLabel)}" data-amount="${u.amountGiven}" title="View Receipt" style="font-size:11px;">
                                                <i data-lucide="receipt"></i> View
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            await loadLucide();
            window.lucide.createIcons({ root: el });

            // Attach filter listener
            const filterEl = document.getElementById('usageTypeFilter');
            if (filterEl) {
                filterEl.addEventListener('change', (e) => {
                    currentTypeFilter = e.target.value;
                    applyFilter();
                });
            }
        }

        render();
    } catch (e) {
        console.error('[Discounts] Usage render failed:', e);
        el.innerHTML = '<div class="offline-placeholder"><div class="offline-icon">⚠️</div><h4>Failed to load usage</h4><p>' + (e?.message || e) + '</p></div>';
    }
}

async function _loadCategories() {
    try {
        const snap = await get(_ref('categories'));
        if (!snap.exists()) { _categoriesSnap = []; return; }
        const val = snap.val();
        _categoriesSnap = Object.entries(val).map(([id, c]) => ({ id, name: c.name || id, ...c }));
    } catch (_) { _categoriesSnap = []; }
}

function _renderCategoryChips(selectedIds = []) {
    const el = document.getElementById('discCategoryList');
    if (!el) return;
    if (_categoriesSnap.length === 0) {
        el.innerHTML = '<p class="text-muted-small">No categories found in the menu.</p>';
        return;
    }
    el.innerHTML = _categoriesSnap.map(c => `
        <button type="button" class="disc-cat-chip ${selectedIds.includes(c.id) ? 'selected' : ''}" data-cat-id="${escapeHtml(c.id)}">
            ${escapeHtml(c.name)}
        </button>
    `).join('');
    // Use event delegation to avoid listener accumulation
    if (!el.dataset.delegationAttached) {
        el.dataset.delegationAttached = '1';
        el.addEventListener('click', (e) => {
            const chip = e.target.closest('.disc-cat-chip');
            if (chip) chip.classList.toggle('selected');
        });
    }
}

function _openEditor(id) {
    _editingId = id || null;
    const d = id ? { id, ..._allDiscountsSnap[id] } : null;
    document.getElementById('discountEditorTitle').textContent = d ? 'Edit Discount' : 'New Discount';

    const el = (id, val) => { const e = document.getElementById(id); if (e != null) e.value = val ?? ''; };
    el('discName', d?.name || '');
    el('discType', d?.type || 'global');
    el('discMode', d?.mode || 'percent');
    el('discValue', d?.value ?? '');
    el('discMaxCap', d?.maxCap ?? '');
    el('discCouponCode', d?.couponCode || '');
    el('discStartsAt', _toLocalInputValue(d?.startsAt));
    el('discEndsAt', _toLocalInputValue(d?.endsAt || 0));
    document.getElementById('discNoEnd').checked = !d?.endsAt;
    el('discMinSubtotal', d?.minSubtotal ?? '');
    el('discExclusiveGroup', d?.exclusiveGroup || '');
    el('discPerCustomerLimit', d?.perCustomerLimit ?? 0);
    el('discGlobalLimit', d?.globalLimit ?? 0);
    document.getElementById('discEnabled').checked = d ? d.enabled !== false : true;
    document.getElementById('discStackable').checked = !!d?.stackable;
    el('discChannel', d?.channel || 'whatsapp');
    _renderCategoryChips(d?.categoryIds || []);
    _applyEditorVisibility();
    document.getElementById('discountEditorModal')?.classList.add('active');
}

function _applyEditorVisibility() {
    const type = document.getElementById('discType')?.value;
    const mode = document.getElementById('discMode')?.value;
    document.getElementById('discCategoryBox').style.display = type === 'category' ? '' : 'none';
    document.getElementById('discCouponBox').style.display   = type === 'coupon'   ? '' : 'none';
    const valHint = document.getElementById('discValueHint');
    if (valHint) valHint.textContent = mode === 'percent' ? '% off subtotal' : '₹ off subtotal';
    const noEnd = document.getElementById('discNoEnd')?.checked;
    const ends = document.getElementById('discEndsAt');
    if (ends) ends.disabled = !!noEnd;
}

function _closeEditor() {
    document.getElementById('discountEditorModal')?.classList.remove('active');
    _editingId = null;
}

async function _save() {
    const name = (document.getElementById('discName')?.value || '').trim();
    if (!name) { showToast('Please enter a name', 'warning'); return; }
    const type = document.getElementById('discType')?.value;
    const mode = document.getElementById('discMode')?.value;
    const value = Number(document.getElementById('discValue')?.value);
    if (!value || value <= 0) { showToast('Please enter a positive value', 'warning'); return; }
    if (mode === 'percent' && value > 100) { showToast('Percent cannot exceed 100', 'warning'); return; }

    const couponCode = (document.getElementById('discCouponCode')?.value || '').trim().toUpperCase();
    if (type === 'coupon' && !couponCode) { showToast('Coupon code is required for coupon type', 'warning'); return; }
    const startsAt = _toIsoNoZ(document.getElementById('discStartsAt')?.value);
    const noEnd    = document.getElementById('discNoEnd')?.checked;
    const endsAt   = noEnd ? 0 : _toIsoNoZ(document.getElementById('discEndsAt')?.value);
    const enabled  = document.getElementById('discEnabled')?.checked;
    const categoryIds = Array.from(document.querySelectorAll('#discCategoryList .disc-cat-chip.selected')).map(c => c.dataset.catId);
    if (type === 'category' && categoryIds.length === 0) { showToast('Pick at least one category', 'warning'); return; }

    const id = _editingId || `disc_${Date.now().toString(36)}`;
    const doc = {
        name, type, mode, value,
        maxCap: Number(document.getElementById('discMaxCap')?.value) || 0,
        minSubtotal: Number(document.getElementById('discMinSubtotal')?.value) || 0,
        categoryIds: type === 'category' ? categoryIds : null,
        couponCode: type === 'coupon' ? couponCode : null,
        stackable: !!document.getElementById('discStackable')?.checked,
        exclusiveGroup: (document.getElementById('discExclusiveGroup')?.value || '').trim() || null,
        perCustomerLimit: Number(document.getElementById('discPerCustomerLimit')?.value) || 0,
        globalLimit: Number(document.getElementById('discGlobalLimit')?.value) || 0,
        startsAt: startsAt || 0,
        endsAt: endsAt || 0,
        enabled,
        channel: (document.getElementById('discChannel')?.value || 'whatsapp'),
        engineVersion: 1,
        updatedAt: Date.now()
    };
    if (!_editingId) { doc.createdAt = new Date().toISOString(); doc.createdBy = window.currentAdmin?.uid || 'admin'; doc.stats = { usedCount: 0, totalDiscountGiven: 0 }; }
    else { doc.id = id; }

    try {
        await update(_discRef(id), doc);
        clearDiscountCache();
        showToast(_editingId ? 'Discount updated' : 'Discount created', 'success');
        haptic(20);
        _closeEditor();
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
    }
}

async function _toggle(id, enabled) {
    try {
        await update(_discRef(id), { enabled, updatedAt: Date.now() });
        clearDiscountCache();
    } catch (e) {
        showToast('Toggle failed', 'error');
    }
}

async function _delete(id) {
    const d = _allDiscountsSnap[id];
    const used = d?.stats?.usedCount || 0;
    const msg = used > 0
        ? `Delete "${d.name || id}"? It has ${used} recorded usage(s) which will remain in the audit log.`
        : `Delete "${d.name || id}"?`;
    const ok = await showConfirm(msg, 'Delete discount');
    if (!ok) return;
    try {
        await remove(_discRef(id));
        clearDiscountCache();
        showToast('Discount deleted', 'success');
    } catch (e) {
        showToast('Delete failed', 'error');
    }
}

function _attachListener() {
    if (_listener) { _listener(); _listener = null; }
    _listener = onValue(_ref('discounts'), (snap) => {
        _allDiscountsSnap = snap.val() || {};
        _renderList();
    }, (err) => {
        console.error('[Discounts] Read error:', err);
        ['discountListActive','discountListScheduled','discountListExpired','discountListUsage'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="offline-placeholder"><div class="offline-icon">⚠️</div><h4>Permission denied</h4><p>Could not load discount data. Try refreshing the page.</p></div>';
        });
    });
}

export function cleanupDiscounts() {
    if (_listener) { _listener(); _listener = null; }
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
}

export function loadDiscounts() {
    console.log('[Discounts] Loading tab…');
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
    _loadCategories();
    _renderList();
    _switchList('active');
    if (isConnected()) {
_attachListener();
        } else {
            ['discountListActive','discountListScheduled','discountListExpired','discountListUsage'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '<div class="offline-placeholder"><div class="offline-icon">📡</div><h4>Waiting for connection</h4><p>Discount data will load automatically when the connection is restored.</p></div>';
            });
        if (!_connUnsub) _connUnsub = onConnectionChange(function _retryDisc(online) {
            if (!online) return;
            if (_connUnsub) { _connUnsub(); _connUnsub = null; }
            cleanupDiscounts();
            loadDiscounts();
        });
    }

    // Tab switching
    const _dc = document.getElementById('tab-discounts');
    if (_dc && !_dc.__discWired) {
        _dc.__discWired = true;
        _dc.addEventListener('click', (e) => {
            const tab = e.target.closest('.promo-mode-tab');
            if (tab) _switchList(tab.dataset.mode);
        });
    }

    // Toggle (event-delegated since cards re-render)
    const list = document.getElementById('tab-discounts');
    if (list && !list.__wired) {
        list.__wired = true;
        list.addEventListener('change', (e) => {
            const tog = e.target.closest('.discount-toggle');
            if (tog) _toggle(tog.dataset.id, tog.checked);
        });
    }

    // Editor field reactivity
    ['discType','discMode','discNoEnd'].forEach(id => { const el = document.getElementById(id); if (el) { el.removeEventListener('change', _applyEditorVisibility); el.addEventListener('change', _applyEditorVisibility); } });
}

window.__discounts = { openEditor: _openEditor, closeEditor: _closeEditor, save: _save, toggle: _toggle, remove: _delete, applyVisibility: _applyEditorVisibility, switchList: _switchList, renderUsageList: _renderUsageList };
