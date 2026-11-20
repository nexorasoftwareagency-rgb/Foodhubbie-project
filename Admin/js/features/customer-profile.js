// ============================================================================
// CUSTOMER PROFILE 360 — CONTROLLER
//
// Owns the drawer: fetches the rows, hands them to the pure view layer and
// wires the events. The Customers tab opens it with openCustomerProfile().
//
// Data sources (all admin-readable, all outlet-scoped):
//   customers/{phone}            identity, app profile, loyalty, rewards, notes, tags
//   orders                       the customer's order history
//   loyalty/rankings/{phone}     tier + rank
//   loyalty/config               tier thresholds + point value
//   loyalty/adjustments          manual point changes
//   discountsUsage               which offers this customer used
//   chatMeta/{phone}             last WhatsApp exchange
//   feedbacks                    ratings left by this customer
//   bot/promotions/optout/{ph}   STOP opt-out marker
//
// Staff notes and tags live under customers/{phone}/notes and
// customers/{phone}/tags. Both inherit the `customers` admin write grant and
// have NO shallower read grant, so they stay private to the dashboard — the
// customer app cannot read them.
// ============================================================================

import { Outlet, get, set, update, remove, auth } from '../firebase.js';
import { escapeHtml, showToast, showConfirm } from '../utils.js';
import { logger } from '../utils/logger.js';
import { state } from '../state.js';
import { isBilledOrder } from '../../shared/cost-math.js';
import { tierForPoints } from '../../shared/loyalty-math.js';
import {
    buildProfile, renderHead, renderTabs, renderBody, normalizePhone,
    computeBase, CUSTOMER_PROFILE_CSS,
} from './customer-profile-view.js';

const CALC = { isBilledOrder, tierForPoints };

let _open = false;
let _tab = 'overview';
let _profile = null;
let _cssInjected = false;

// discountsUsage grows with every redemption and has no phone index, so the
// whole node is read. One read a minute is plenty for a human-paced page.
const _usageCache = { at: 0, rows: [] };
const USAGE_TTL_MS = 60000;

function _injectCss() {
    if (_cssInjected) return;
    _cssInjected = true;
    const style = document.createElement('style');
    style.id = 'custProfStyle';
    style.textContent = CUSTOMER_PROFILE_CSS;
    document.head.appendChild(style);
}

async function _usageRows() {
    if (Date.now() - _usageCache.at < USAGE_TTL_MS) return _usageCache.rows;
    const snap = await get(Outlet.ref('discountsUsage'));
    const rows = [];
    snap.forEach((c) => {
        const v = c.val();
        if (v && typeof v === 'object') rows.push({ id: c.key, ...v });
    });
    _usageCache.at = Date.now();
    _usageCache.rows = rows;
    return rows;
}

function _icons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try { window.lucide.createIcons(); } catch (_) { /* icons are cosmetic */ }
    }
}

function _drawer() {
    return document.getElementById('customerProfileDrawer');
}

function _render() {
    if (!_profile) return;
    const head = document.getElementById('customerProfileHead');
    const tabs = document.getElementById('customerProfileTabs');
    const body = document.getElementById('customerProfileBody');
    if (!head || !tabs || !body) return;
    head.innerHTML = renderHead(_profile);
    tabs.innerHTML = renderTabs(_tab);
    body.innerHTML = renderBody(_profile, _tab);
    body.scrollTop = 0;
    _icons();
}

function _show() {
    const drawer = _drawer();
    const overlay = document.getElementById('customerProfileOverlay');
    if (drawer) drawer.classList.add('active');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    _open = true;
    history.pushState({ action: 'closeDrawer', targetId: 'customerProfileDrawer' }, '', window.location.hash);
    window.removeEventListener('popstate', window._custProfPopstate);
    window._custProfPopstate = () => closeCustomerProfile();
    window.addEventListener('popstate', window._custProfPopstate);
}

export function closeCustomerProfile() {
    const drawer = _drawer();
    const overlay = document.getElementById('customerProfileOverlay');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    if (_open) document.body.style.overflow = '';
    _open = false;
    window.removeEventListener('popstate', window._custProfPopstate);
    window._custProfPopstate = null;
}

/**
 * Open the profile for one phone.
 * `orders` may be passed in (the Customers tab already downloaded the whole
 * node) to avoid a second read.
 */
export async function openCustomerProfile(phone, opts = {}) {
    const clean = normalizePhone(phone);
    if (!clean) {
        showToast('That customer has no usable phone number.', 'error');
        return;
    }
    _injectCss();

    const drawer = _drawer();
    const body = document.getElementById('customerProfileBody');
    if (!drawer || !body) return;

    _tab = 'overview';
    body.innerHTML = '<div class="cp-loading">Loading customer profile…</div>';

    try {
        const [custSnap, rankSnap, cfgSnap, chatSnap, optOutSnap, feedbackSnap, adjSnap, usageRows, orders] = await Promise.all([
            get(Outlet.ref(`customers/${clean}`)),
            get(Outlet.ref(`loyalty/rankings/${clean}`)),
            get(Outlet.ref('loyalty/config')),
            get(Outlet.ref(`chatMeta/${clean}`)),
            get(Outlet.ref(`bot/promotions/optout/${clean}`)),
            get(Outlet.ref('feedbacks')),
            get(Outlet.ref('loyalty/adjustments')),
            _usageRows(),
            opts.orders ? Promise.resolve(opts.orders) : get(Outlet.ref('orders')).then((s) => {
                const arr = [];
                s.forEach((c) => { const v = c.val(); if (v) arr.push({ ...v, _id: c.key }); });
                return arr;
            }),
        ]);

        const orderList = (opts.orders || []).map((o) => (o && o._id ? o : { ...o, _id: o && o.orderId }));

        const customer = custSnap.exists() ? custSnap.val() : null;
        const adjustments = [];
        adjSnap.forEach((c) => { const v = c.val(); if (v) adjustments.push({ id: c.key, ...v }); });
        const feedbacks = [];
        feedbackSnap.forEach((c) => { const v = c.val(); if (v) feedbacks.push({ id: c.key, ...v }); });

        const myUsage = usageRows.filter((u) => normalizePhone(u.customerPhone || u.phone) === clean);

        // The outlet's own customer base — the yardstick frequency and spend
        // are scored against (see computeBase in the view layer).
        const base = computeBase(orderList, Date.now(), isBilledOrder);

        _profile = buildProfile({
            phone: clean,
            customer,
            orders: orderList,
            ranking: rankSnap.exists() ? rankSnap.val() : null,
            loyaltyConfig: cfgSnap.exists() ? cfgSnap.val() : null,
            adjustments,
            usageRows: myUsage,
            chat: chatSnap.exists() ? chatSnap.val() : null,
            feedbacks,
            rewards: (customer && customer.rewards) || {},
            optOut: optOutSnap.exists(),
            base,
            storeName: state.storeName,
            now: Date.now(),
        }, CALC);
        _profile.usageRows = myUsage;

        _render();
        _show();
        logger.info('CUSTOMERS', 'Opened customer profile', { phone: clean });
    } catch (e) {
        console.error('[CustomerProfile] load failed:', e);
        body.innerHTML = '<div class="cp-loading">Could not load this customer. Check your connection and try again.</div>';
    }
}

// ------------------------------------------------------------------ actions

async function _saveNote(text) {
    const phone = _profile && _profile.phone;
    if (!phone) return;
    const clean = text.trim();
    if (!clean) { showToast('Write something before saving the note.', 'error'); return; }
    const uid = (auth && auth.currentUser && auth.currentUser.uid) || '';
    const byName = (state.adminData && (state.adminData.name || state.adminData.email)) || 'Staff';
    const id = `${Date.now()}_${uid || 'staff'}`;
    try {
        await set(Outlet.ref(`customers/${phone}/notes/${id}`), {
            text: clean.slice(0, 500), by: uid, byName: String(byName).slice(0, 60), at: Date.now(),
        });
        _profile.notes.unshift({ id, text: clean.slice(0, 500), by: uid, byName: String(byName).slice(0, 60), at: Date.now() });
        _profile.customer.notes = _profile.customer.notes || {};
        _profile.customer.notes[id] = _profile.notes[0];
        showToast('Note saved.', 'success');
        _render();
    } catch (e) {
        console.error('[CustomerProfile] note save failed:', e);
        showToast('Could not save the note.', 'error');
    }
}

async function _deleteNote(id) {
    const phone = _profile && _profile.phone;
    const noteId = String(id || '').trim();
    if (!phone || !noteId) return;
    try {
        await remove(Outlet.ref(`customers/${phone}/notes/${noteId}`));
        _profile.notes = _profile.notes.filter((n) => n.id !== noteId);
        if (_profile.customer.notes) delete _profile.customer.notes[noteId];
        showToast('Note deleted.', 'success');
        _render();
    } catch (e) {
        console.error('[CustomerProfile] note delete failed:', e);
        showToast('Could not delete the note.', 'error');
    }
}

async function _saveTags(tags) {
    const phone = _profile && _profile.phone;
    if (!phone) return;
    const clean = [];
    for (const t of tags) {
        const s = String(t || '').trim().slice(0, 24);
        if (s && !clean.some((x) => x.toLowerCase() === s.toLowerCase())) clean.push(s);
    }
    try {
        await update(Outlet.ref(`customers/${phone}`), { tags: clean });
        _profile.tags = clean;
        _profile.customer.tags = clean;
        showToast('Tags updated.', 'success');
        _render();
    } catch (e) {
        console.error('[CustomerProfile] tag save failed:', e);
        showToast('Could not update the tags.', 'error');
    }
}

async function _openOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id) return;
    const order = (_profile && _profile.orders || []).find((o) => (o._id || o.orderId) === id);
    if (!order) { showToast('Order not found.', 'error'); return; }
    // The order drawer reads state.ordersMap; the Orders tab may never have
    // been opened, so seed the row before handing it over.
    if (state.ordersMap) state.ordersMap.set(id, order);
    closeCustomerProfile();
    try {
        const mod = await import('./orders.js');
        await mod.openOrderDrawer(id);
    } catch (e) {
        console.error('[CustomerProfile] open order failed:', e);
        showToast('Could not open that order.', 'error');
    }
}

// ------------------------------------------------------------------- wiring

let _wired = false;

export function initCustomerProfile() {
    if (_wired) return;
    _wired = true;
    _injectCss();

    const drawer = _drawer();
    const overlay = document.getElementById('customerProfileOverlay');
    if (overlay) overlay.addEventListener('click', () => closeCustomerProfile());
    const closeBtn = document.getElementById('customerProfileClose');
    if (closeBtn) closeBtn.addEventListener('click', () => closeCustomerProfile());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _open) closeCustomerProfile();
    });

    const root = document.getElementById('customerProfileRoot');
    if (!root) return;

    root.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-cp-tab]');
        if (tabBtn) {
            _tab = tabBtn.getAttribute('data-cp-tab') || 'overview';
            _render();
            return;
        }
        const orderBtn = e.target.closest('[data-cp-order]');
        if (orderBtn) {
            _openOrder(orderBtn.getAttribute('data-cp-order'));
            return;
        }
        const tagRemove = e.target.closest('[data-cp-tag-remove]');
        if (tagRemove) {
            const tag = tagRemove.getAttribute('data-cp-tag-remove');
            _saveTags((_profile ? _profile.tags : []).filter((t) => t !== tag));
            return;
        }
        const noteDel = e.target.closest('[data-cp-note-del]');
        if (noteDel) {
            _deleteNote(noteDel.getAttribute('data-cp-note-del'));
            return;
        }
        const act = e.target.closest('[data-cp]');
        if (act && act.getAttribute('data-cp') === 'copy-phone' && _profile) {
            const text = _profile.phone;
            const done = () => showToast('Phone number copied.', 'success');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => showToast('Could not copy the number.', 'error'));
            } else {
                showToast('Could not copy the number.', 'error');
            }
        }
    });

    root.addEventListener('submit', async (e) => {
        const form = e.target;
        e.preventDefault();
        if (form.matches('[data-cp-note-form]')) {
            const ta = form.querySelector('#cpNoteText');
            const text = ta ? ta.value : '';
            if (!text.trim()) { showToast('Write something before saving the note.', 'error'); return; }
            await _saveNote(text);
            if (ta) ta.value = '';
        } else if (form.matches('[data-cp-tag-form]')) {
            const input = form.querySelector('#cpTagInput');
            const value = input ? input.value.trim() : '';
            if (!value) { showToast('Type a tag first.', 'error'); return; }
            await _saveTags([...((_profile && _profile.tags) || []), value]);
            if (input) input.value = '';
        }
    });
}
