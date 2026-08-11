/**
 * Menu/js/ui.js
 * Pure rendering helpers — no Firebase calls live here. app.js calls these
 * functions and wires their button events.
 */

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmtMoney(n) { return '₹' + Number(n || 0).toFixed(0); }

/**
 * Tactile feedback for touch interactions. Feature-detected — silently
 * does nothing on browsers without the Vibration API (notably iOS Safari).
 * @param {number|number[]} pattern - ms, or [on, off, on...] pattern
 */
export function haptic(pattern = 15) {
    try {
        if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) { /* no-op */ }
}

let _audioCtx = null;

// Prime AudioContext on first user gesture (browser autoplay policy requires this)
// Firebase callbacks are non-gesture, so AudioContext created there stays suspended.
document.addEventListener('click', () => {
    if (!_audioCtx) {
        try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    }
    if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}, { once: true });

function _notifySound() {
    try {
        const ctx = _audioCtx;
        if (!ctx || ctx.state !== 'running') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    } catch (_) {}
}

export function updateGreeting(name) {
    const el = document.getElementById('menuGreeting');
    if (!el) return;
    if (name) {
        el.textContent = `Hello, ${esc(name)}`;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

const BOTTOM_NAV_SCREENS = {
    screenMenu: 'screenMenu', screenCart: 'screenCart', screenTracking: 'screenTracking',
    screenHistory: 'screenHistory', screenPromotions: 'screenPromotions'
};

const _screenStack = [];
let _skipPushState = false;
const _bootQuery = window.location.search;

export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    window.scrollTo(0, 0);

    // Clean up tracking timer when navigating away from tracking screen
    if (id !== 'screenTracking') clearTrackingTimer();

    const nav = document.getElementById('bottomNav');
    if (!nav) return;
    const isBottomNavScreen = id in BOTTOM_NAV_SCREENS;
    nav.classList.toggle('hidden', !isBottomNavScreen);
    nav.querySelectorAll('.bottom-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bottomTab === id);
    });

    // Push screen history for browser back button support (interstitial only)
    if (!_skipPushState && id !== 'screenWelcome' && id !== 'screenChooseGroup') {
        _screenStack.push(id);
        history.pushState({ screen: id }, '', window.location.pathname + _bootQuery + '#');
    }
    _skipPushState = false;
}

export function handlePopState() {
    _skipPushState = true;
    _screenStack.pop();
    const prev = _screenStack[_screenStack.length - 1];
    if (prev) showScreen(prev);
}

export function getPreviousScreen() {
    return _screenStack.length > 1 ? _screenStack[_screenStack.length - 2] : null;
}

const _toastQueue = [];
let _toastShowing = false;

function _showNextToast() {
    if (_toastQueue.length === 0) { _toastShowing = false; return; }
    _toastShowing = true;
    const entry = _toastQueue.shift();
    const msg = typeof entry === 'string' ? entry : entry.msg;
    const type = typeof entry === 'string' ? 'info' : (entry.type || 'info');
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    if (type === 'success' || type === 'error') _notifySound();
    if (type === 'error') haptic([30, 40, 30]);
    else if (type === 'success') haptic([10, 30, 10]);
    clearTimeout(t.__hideTimer);
    t.__hideTimer = setTimeout(() => {
        t.classList.remove('show');
        setTimeout(_showNextToast, 200);
    }, 2000);
}

export function showToast(msg, type) {
    _toastQueue.push({ msg, type: type || 'info' });
    if (!_toastShowing) _showNextToast();
}

export function updateCartBadges(count) {
    ['menuCartCount', 'customizeCartCount'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = String(count);
        el.classList.toggle('hidden', count === 0);
    });
    const bottomBadge = document.getElementById('bottomNavCartCount');
    if (bottomBadge) {
        bottomBadge.textContent = String(count);
        bottomBadge.classList.toggle('hidden', count === 0);
    }
}

export function updateCartBar(count, total) {
    const bar = document.getElementById('menuCartBar');
    if (!bar) return;
    bar.classList.toggle('hidden', count === 0);
    const countEl = document.getElementById('menuCartBarCount');
    const totalEl = document.getElementById('menuCartBarTotal');
    if (countEl) countEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
    if (totalEl) totalEl.textContent = fmtMoney(total);
}

export function updateRunningBillStrip(session, groupOrders, groupTotal) {
    const strip = document.getElementById('runningBillStrip');
    if (!strip) return;
    const orderIds = groupOrders || session?.orders || [];
    const hasOrders = orderIds.length > 0 && session?.status !== 'closed';
    strip.classList.toggle('hidden', !hasOrders);
    if (hasOrders) {
        const countEl = document.getElementById('runningBillOrderCount');
        const amountEl = document.getElementById('runningBillAmount');
        const label = groupOrders && session?.orderGroups ? ' in your group' : ' this session';
        if (countEl) countEl.textContent = `${orderIds.length} order${orderIds.length !== 1 ? 's' : ''}${label}`;
        const displayTotal = groupTotal != null ? groupTotal : (session.grandTotal || session.runningTotal || 0);
        if (amountEl) amountEl.textContent = fmtMoney(displayTotal);
    }
}

export function renderCategoryPills(categories, activeId, onSelect) {
    const row = document.getElementById('categoryPillsRow');
    if (!row) return;
    const pills = [{ id: 'all', name: 'All' }, ...categories];
    row.innerHTML = pills.map(c => `
        <button class="category-pill ${activeId === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    row.querySelectorAll('.category-pill').forEach(btn => btn.addEventListener('click', () => onSelect(btn.dataset.cat)));
}

export function renderDishList(dishes, { searchTerm, activeCategoryName }, onOpenDish) {
    const list = document.getElementById('dishListContainer');
    const title = document.getElementById('menuSectionTitle');
    if (!list || !title) return;

    title.textContent = searchTerm ? `Results for "${searchTerm}"` : (activeCategoryName || 'Popular Items');

    if (dishes.length === 0) {
        list.textContent = '';
        list.insertAdjacentHTML('beforeend', '<div class="empty-cart">No dishes found.</div>');
        return;
    }
    list.textContent = '';
    list.insertAdjacentHTML('beforeend', dishes.map(d => `
        <div class="dish-card" data-dish-id="${esc(d.id)}">
            <div class="dish-visual">
                <img src="${esc(d.image || '')}" alt="${esc(d.name)}" loading="lazy" onerror="this.style.visibility='hidden'">
                <div class="dish-overlay"><span class="price-chip">${fmtMoney(d.price)}</span></div>
            </div>
            <div class="dish-content">
                <div class="dish-card-name">${esc(d.name)}</div>
                <div class="dish-card-category">${esc(d.category || '')}</div>
            </div>
        </div>`).join(''));

    list.querySelectorAll('.dish-card').forEach(card => card.addEventListener('click', () => onOpenDish(card.dataset.dishId)));
}

export function renderSizeOptions(sizes, selectedLabel, onSelect) {
    const wrap = document.getElementById('sizeOptionsRow');
    if (!wrap) return;
    const sizeSection = document.getElementById('sizeSection');
    if (sizeSection) sizeSection.style.display = sizes.length > 1 ? '' : 'none';
    wrap.innerHTML = sizes.map((s, i) => `
        <button class="size-opt ${s.label === selectedLabel ? 'selected' : ''}" data-size-idx="${i}">
            <div class="size-opt-label">${esc(s.label)}</div>
            <div class="size-opt-price">${fmtMoney(s.price)}</div>
        </button>`).join('');
    wrap.querySelectorAll('.size-opt').forEach(btn => btn.addEventListener('click', () => onSelect(Number(btn.dataset.sizeIdx))));
}

export function renderAddonRows(addons, selectedIdxs, onToggle) {
    const wrap = document.getElementById('addonRows');
    if (!wrap) return;
    const addonSection = document.getElementById('addonSection');
    if (addonSection) addonSection.style.display = addons.length ? '' : 'none';
    wrap.innerHTML = addons.map((a, i) => {
        const checked = selectedIdxs.includes(i);
        return `<div class="addon-row" data-addon-idx="${i}">
            <div class="addon-label"><span class="addon-checkbox ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span><span>${esc(a.name)}</span></div>
            <span class="addon-price">+${fmtMoney(a.price)}</span>
        </div>`;
    }).join('');
    wrap.querySelectorAll('.addon-row').forEach(row => row.addEventListener('click', () => onToggle(Number(row.dataset.addonIdx))));
}

export function renderCartList(lines, { onStep }) {
    const list = document.getElementById('cartListContainer');
    const summaryWrap = document.getElementById('cartSummaryWrap');
    const checkoutWrap = document.getElementById('checkoutFieldsWrap');
    if (!list) return;
    const entries = Object.entries(lines);

    if (entries.length === 0) {
        list.innerHTML = '<div class="empty-cart">Your cart is empty.<br>Add some delicious items!</div>';
        if (summaryWrap) summaryWrap.style.display = 'none';
        if (checkoutWrap) checkoutWrap.classList.add('hidden');
        return;
    }
    if (summaryWrap) summaryWrap.style.display = '';
    if (checkoutWrap) checkoutWrap.classList.remove('hidden');

    list.innerHTML = entries.map(([id, l]) => `
        <div class="cart-item-row" data-line-id="${esc(id)}">
            <img class="cart-item-img" src="${esc(l.img || '')}" alt="" onerror="this.style.visibility='hidden'">
            <div class="cart-item-info">
                <div class="cart-item-name">${esc(l.name)}</div>
                <div class="cart-item-variant">${esc(l.size)}${(l.addons || []).length ? ' · ' + esc((l.addons || []).join(', ')) : ''}</div>
            </div>
            <div class="qty-stepper"><button class="qty-btn" data-step="-1">−</button><span class="qty-val">${l.qty}</span><button class="qty-btn" data-step="1">+</button></div>
            <span class="cart-item-price">${fmtMoney(l.unitPrice * l.qty)}</span>
        </div>`).join('');

    list.querySelectorAll('.cart-item-row').forEach(row => {
        const id = row.dataset.lineId;
        row.querySelectorAll('.qty-btn').forEach(btn => btn.addEventListener('click', () => onStep(id, Number(btn.dataset.step))));
    });
}

export function updateCartTotals(subtotal, taxPercent, taxName, taxEnabled, serviceChargeEnabled, serviceChargeName, serviceChargeRate, discount = null, taxRates) {
    const rates = (taxRates && Array.isArray(taxRates) && taxRates.length > 0) ? taxRates : (taxEnabled !== false ? [{ name: taxName || 'Tax', rate: taxPercent || 5 }] : []);
    const taxItems = rates.map(r => ({ name: r.name, rate: r.rate, amount: Math.round(subtotal * (r.rate / 100) * 100) / 100 }));
    const tax = taxItems.reduce((s, t) => s + t.amount, 0);
    const scEnabled = serviceChargeEnabled === true;
    const scRate = typeof serviceChargeRate === 'number' ? serviceChargeRate : 0;
    const sc = scEnabled ? Math.round(subtotal * (scRate / 100) * 100) / 100 : 0;

    const el = (id) => document.getElementById(id);
    if (el('cartSubtotal')) el('cartSubtotal').textContent = fmtMoney(subtotal);

    // Tax rows
    const taxRows = document.getElementById('cartTaxRows');
    if (taxRows) {
        taxRows.innerHTML = taxItems.map(t => `<div class="cart-summary-row"><span>${esc(t.name)} (${t.rate}%)</span><span>${fmtMoney(t.amount)}</span></div>`).join('');
        taxRows.classList.toggle('hidden', taxItems.length === 0);
    }

    // Service charge row
    const scRow = document.getElementById('cartServiceChargeRow');
    if (scRow) scRow.classList.toggle('hidden', !scEnabled);
    if (el('cartServiceChargeName')) el('cartServiceChargeName').textContent = serviceChargeName || 'Service Charge';
    if (el('cartServiceChargePct')) el('cartServiceChargePct').textContent = String(scRate);
    if (el('cartServiceCharge')) el('cartServiceCharge').textContent = fmtMoney(sc);

    // Discount row
    const discountRow = document.getElementById('cartDiscountRow');
    const discountAmount = discount && discount.amount > 0 ? Math.min(discount.amount, subtotal + tax + sc) : 0;
    if (discountRow) discountRow.classList.toggle('hidden', discountAmount <= 0);
    if (el('cartDiscountLabel')) {
        const pctInfo = discount?.mode === 'percent' && discount?.value ? ` (${discount.value}% off)` : '';
        el('cartDiscountLabel').textContent = (discount?.label || 'Discount') + pctInfo;
    }
    if (el('cartDiscount')) el('cartDiscount').textContent = '-' + fmtMoney(discountAmount);

    if (el('cartTotal')) el('cartTotal').textContent = fmtMoney(subtotal + tax + sc - discountAmount);
    return { tax, serviceCharge: sc, discount: discountAmount, total: subtotal + tax + sc - discountAmount };
}

export function updateSessionNoteInCart(session, groupOrders, groupTotal) {
    const note = document.getElementById('cartSessionNote');
    if (!note) return;
    const orderIds = groupOrders || session?.orders || [];
    const hasOrders = orderIds.length > 0;
    note.classList.toggle('hidden', !hasOrders);
    if (hasOrders) {
        const total = groupTotal != null ? groupTotal : (session.grandTotal || session.runningTotal || 0);
        const label = groupOrders && session?.orderGroups ? ' in your group' : ' this session';
        note.textContent = `This will be added to your running bill (currently ${fmtMoney(total)} across ${orderIds.length} order${orderIds.length !== 1 ? 's' : ''}${label}).`;
    }
}

const DINE_IN_STEPS = [
    { key: 'Placed', label: 'Order Received' },
    { key: 'Confirmed', label: 'Preparing' },
    { key: 'Ready', label: 'Ready To Serve' },
    { key: 'Served', label: 'Served' }
];
function dineInStepIndex(status) {
    const map = { Placed: 0, Confirmed: 1, Preparing: 1, Ready: 2, Served: 3, Delivered: 3 };
    return map[status] ?? 0;
}

// Inline stroke icons (Feather/Lucide-style paths, matching the SVG
// convention already used throughout index.html — viewBox 0 0 24 24,
// stroke=currentColor, stroke-width=2) keyed by tracker step index.
const TRACKING_ICONS = [
    /* 0 Placed     */ '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    /* 1 Preparing  */ '<path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>',
    /* 2 Ready      */ '<path d="M18 8A6 6 0 0 0 6 8c0 3.09-.78 5.3-1.66 6.74A1 1 0 0 0 5.2 16h13.6a1 1 0 0 0 .87-1.26C18.78 13.3 18 11.09 18 8"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    /* 3 Delivered  */ '<path d="M20 6L9 17l-5-5"/>'
];
const TRACKING_CANCELLED_ICON = '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>';
const TRACKING_HEADLINES = [
    { label: 'Order Received',     sub: "We've got it — sending it to the kitchen now." },
    { label: 'Preparing Your Order', sub: 'Our kitchen is cooking it up right now.' },
    { label: 'Ready To Serve',     sub: 'Your order is ready and heading to your table.' },
    { label: 'Order Served',       sub: 'Enjoy your meal! Tap "Request Bill" below when ready to pay.' }
];

// ---- Elapsed-time ticker for the hero card ----
// Module-level (not per-order) so a single 1s interval is reused across
// re-renders instead of leaking a new setInterval every time the order
// snapshot updates. `renderTracking()` just refreshes `_trackMeta`.
export function clearTrackingTimer() {
    if (_trackClockHandle) { clearInterval(_trackClockHandle); _trackClockHandle = null; }
}
let _trackClockHandle = null;
let _trackMeta = null; // { createdAt, status }

function _fmtElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
}
function _tickTrackClock() {
    if (!_trackMeta) return;
    const el = document.getElementById('trackingElapsedTime');
    if (!el) return;
    // order.createdAt is written by order.js as an ISO 8601 string
    // (new Date().toISOString()) — the Date constructor parses that
    // directly, no epoch-ms assumption needed.
    const startMs = new Date(_trackMeta.createdAt).getTime();
    el.textContent = isNaN(startMs) ? '--:--' : _fmtElapsed(Date.now() - startMs);
}

export function renderTracking(orderId, order, tableNumber) {
    const orderIdEl = document.getElementById('trackingOrderId');
    const tableLabelEl = document.getElementById('trackingTableLabel');
    const container = document.getElementById('trackerStepsContainer');
    if (!container) return;
    if (orderIdEl) orderIdEl.textContent = `#RP-T${String(tableNumber).padStart(2, '0')}-${String(orderId).slice(-3).toUpperCase()}`;
    if (tableLabelEl) tableLabelEl.textContent = `Table ${String(tableNumber).padStart(2, '0')}`;

    const status = order.status || 'Placed';
    const isCancelled = status === 'Cancelled';
    const isDelivered = status === 'Served' || status === 'Delivered';
    const currentIdx = dineInStepIndex(status);

    // ---- Detailed timeline (same DINE_IN_STEPS contract as before) ----
    container.innerHTML = DINE_IN_STEPS.map((step, i) => {
        const cls = i < currentIdx ? 'done' : (i === currentIdx && !isCancelled ? 'active' : '');
        const time = i <= currentIdx ? new Date(order.updatedAt || order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const dotContent = i < currentIdx ? '✓' : (i + 1);
        return `<div class="tracker-step ${cls}"><div class="tracker-dot">${dotContent}</div><div><div class="tracker-label">${esc(step.label)}</div><div class="tracker-time">${time}</div></div></div>`;
    }).join('');

    // ---- Hero status card ----
    const heroCard = document.getElementById('trackingHeroCard');
    const iconWrap = document.getElementById('trackingStatusIconWrap');
    const iconEl = document.getElementById('trackingStatusIcon');
    const labelEl = document.getElementById('trackingStatusLabel');
    const subEl = document.getElementById('trackingStatusSub');

    if (heroCard) heroCard.classList.toggle('hero-cancelled', isCancelled);
    if (iconWrap) iconWrap.classList.toggle('pulsing', !isCancelled && !isDelivered);
    if (iconEl) iconEl.innerHTML = isCancelled ? TRACKING_CANCELLED_ICON : TRACKING_ICONS[currentIdx];
    if (labelEl) labelEl.textContent = isCancelled ? 'Order Cancelled' : TRACKING_HEADLINES[currentIdx].label;
    if (subEl) subEl.textContent = isCancelled ? 'Please speak to a staff member for help.' : TRACKING_HEADLINES[currentIdx].sub;

    // Pending Payment Status Card (green card above the hero card)
    const paymentPending = isDelivered && order.paymentStatus !== 'Paid';
    if (paymentPending) {
        const trackingBody = document.querySelector('.tracking-body');
        if (trackingBody) {
            let pendingCard = document.querySelector('.pending-payment-card');
            if (!pendingCard) {
                pendingCard = document.createElement('div');
                pendingCard.className = 'pending-payment-card';
                pendingCard.innerHTML = '<div class="pending-payment-content"><span class="pending-payment-text">Pending Payment</span></div>';
                trackingBody.insertBefore(pendingCard, trackingBody.firstChild);
            }
        }
    } else {
        const existingCard = document.querySelector('.pending-payment-card');
        if (existingCard) existingCard.remove();
    }

    // Segmented progress bar — "current" segment uses --status-active
    const track = document.getElementById('trackingProgressTrack');
    if (track) {
        track.innerHTML = DINE_IN_STEPS.map((_, i) => {
            let cls = 'progress-seg';
            if (isCancelled) cls += ' seg-cancelled';
            else if (i < currentIdx || (i === currentIdx && isDelivered)) cls += ' seg-done';
            else if (i === currentIdx) cls += ' seg-current';
            return `<div class="${cls}"></div>`;
        }).join('');
    }

    // Elapsed timer — starts once, ticks every second off module state
    _trackMeta = { createdAt: order.createdAt, status };
    _tickTrackClock();
    if (!_trackClockHandle) _trackClockHandle = setInterval(_tickTrackClock, 1000);
    const elapsedRow = document.getElementById('trackingElapsedRow');
    if (elapsedRow) elapsedRow.classList.toggle('hidden', isDelivered || isCancelled);

    // Show estimate only while order is in progress (not delivered/cancelled)
    const estimateEl = document.getElementById('trackingEstimate');
    if (estimateEl) estimateEl.classList.toggle('hidden', isDelivered || isCancelled);

    // ---- "Your Order" itemized card (NEW) ----
    // Always visible — reads order.items straight off the same order
    // object app.js's watchOrder() already passes in, no extra reads.
    const itemsList = document.getElementById('trackingOrderItemsList');
    const itemsCountEl = document.getElementById('trackingOrderItemsCount');
    const itemsTotalEl = document.getElementById('trackingOrderItemsTotal');
    if (itemsList) {
        const items = Object.values(order.items || {});
        const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 1), 0);
        if (itemsCountEl) itemsCountEl.textContent = `${totalQty} item${totalQty !== 1 ? 's' : ''}`;
        itemsList.innerHTML = items.map(it => {
            const addonsLine = (it.addons && it.addons.length) ? `<div class="oi-row-addons">+ ${esc(it.addons.join(', '))}</div>` : '';
            const noteLine = it.instructions ? `<div class="oi-row-note">"${esc(it.instructions)}"</div>` : '';
            return `<div class="oi-row">
                <span class="oi-row-name">${esc(it.name || 'Item')}</span>
                <span class="oi-row-qty">×${it.qty || 1}</span>
                <span class="oi-row-price">${fmtMoney((it.price || 0) * (it.qty || 1))}</span>
                ${addonsLine}${noteLine}
            </div>`;
        }).join('') || '<p class="text-muted-small">No items on this order.</p>';
        if (itemsTotalEl) itemsTotalEl.textContent = fmtMoney(order.total || 0);
    }

    // Secondary confirmation card — only shown for terminal states now
    // (Delivered / Cancelled). For in-progress statuses the hero
    // headline + sub already say this, so showing it twice was
    // redundant and has been dropped in this redesign.
    const thanksCard = document.getElementById('trackingThanksCard');
    if (thanksCard) {
        if (isDelivered) {
            thanksCard.classList.remove('hidden');
            thanksCard.innerHTML = '<strong>Order served!</strong><p style="font-size:12px;color:var(--text-sub);margin-top:4px;">Enjoy your meal. Tap "Request Bill" below when ready to pay.</p>';
        } else if (isCancelled) {
            thanksCard.classList.remove('hidden');
            thanksCard.innerHTML = '<strong style="color:var(--error);">Order cancelled</strong><p style="font-size:12px;color:var(--text-sub);margin-top:4px;">Please speak to a staff member.</p>';
        } else {
            thanksCard.classList.add('hidden');
        }
    }
}

// ---- Call Waiter screen: optimistic request-state feedback ----
// tableRequests is create-only from this client (no read access), so
// there's no live "acknowledged" status to listen for. Instead each
// request card shows Sending → Sent for a cooldown window, both to
// reassure the guest and to stop accidental double-taps/spam.
const WAITER_COOLDOWN_MS = 30000;
const _waiterTimers = new WeakMap();

export function setRequestSending(btn) {
    if (!btn) return;
    btn.classList.remove('request-sent');
    btn.classList.add('request-sending');
    btn.disabled = true;
}
export function setRequestSent(btn) {
    if (!btn) return;
    btn.classList.remove('request-sending');
    btn.classList.add('request-sent');
    btn.disabled = true;
    clearTimeout(_waiterTimers.get(btn));
    _waiterTimers.set(btn, setTimeout(() => resetRequestCard(btn), WAITER_COOLDOWN_MS));
}
export function resetRequestCard(btn) {
    if (!btn) return;
    clearTimeout(_waiterTimers.get(btn));
    btn.classList.remove('request-sending', 'request-sent');
    btn.disabled = false;
}

export function renderSessionBillCard(session, ordersMap, taxName, taxPercent, taxEnabled, serviceChargeEnabled, serviceChargeName, serviceChargeRate, taxRates, groupOrders) {
    const card = document.getElementById('sessionBillCard');
    if (!card) return;
    const orderIds = (groupOrders || session?.orders || []).filter(oid => {
        const o = ordersMap[oid];
        return !o || o.status !== 'Cancelled';
    });
    card.classList.toggle('hidden', orderIds.length <= 1);
    if (orderIds.length <= 1) return;

    const orderCountEl = document.getElementById('sessionBillOrderCount');
    if (orderCountEl) orderCountEl.textContent = `${orderIds.length} orders`;

    // Order-level summary lines
    const linesWrap = document.getElementById('sessionBillLines');
    if (linesWrap) linesWrap.innerHTML = orderIds.map((oid, i) => {
        const o = ordersMap[oid];
        const itemCount = o ? Object.values(o.items || {}).reduce((s, it) => s + (it.qty || 1), 0) : 0;
        return `<div class="session-bill-line"><span>Order ${i + 1} (${itemCount} item${itemCount !== 1 ? 's' : ''})</span><span>${fmtMoney(o?.total || 0)}</span></div>`;
    }).join('');

    // Itemized details per order
    const itemsWrap = document.getElementById('sessionBillItems');
    if (itemsWrap) itemsWrap.innerHTML = orderIds.map((oid, i) => {
        const o = ordersMap[oid];
        if (!o) return '';
        const items = Object.values(o.items || {});
        if (items.length === 0) return '';
        const itemRows = items.map(it => {
            const name = it.name || 'Item';
            const qty = it.qty || 1;
            const price = it.price || 0;
            return `<div class="session-bill-item"><span class="session-bill-item-name">${esc(name)}</span><span class="session-bill-item-qty">x${qty}</span><span class="session-bill-item-price">${fmtMoney(price * qty)}</span></div>`;
        }).join('');
        return `<div class="session-bill-order-section"><div class="session-bill-order-title">Order ${i + 1}</div>${itemRows}</div>`;
    }).join('');

    // Compute totals from group orders
    let subtotal = 0, totalTax = 0, totalSC = 0, grandTotal = 0;
    orderIds.forEach(oid => {
        const o = ordersMap[oid];
        if (!o) return;
        subtotal += Number(o.subtotal || 0);
        totalTax += Number(o.tax || 0);
        totalSC += Number(o.serviceCharge || 0);
        grandTotal += Number(o.total || 0);
    });

    const tEnabled = taxEnabled !== false;
    const scEnabled = serviceChargeEnabled === true;
    const scRate = typeof serviceChargeRate === 'number' ? serviceChargeRate : 0;
    const rates = (taxRates && Array.isArray(taxRates) && taxRates.length > 0) ? taxRates : (tEnabled ? [{ name: taxName || 'Tax', rate: taxPercent || 5 }] : []);

    const el = (id) => document.getElementById(id);
    if (el('sessionBillSubtotal')) el('sessionBillSubtotal').textContent = fmtMoney(subtotal);

    const taxRows = document.getElementById('sessionBillTaxRows');
    if (taxRows) {
        const combinedLabel = rates.map(r => `${esc(r.name)} (${r.rate}%)`).join(' + ');
        taxRows.innerHTML = `<div class="session-bill-summary-row"><span>${combinedLabel}</span><span>${fmtMoney(totalTax)}</span></div>`;
        taxRows.classList.toggle('hidden', !tEnabled || rates.length === 0);
    }

    const scRow = document.getElementById('sessionBillSCRow');
    if (scRow) scRow.classList.toggle('hidden', !scEnabled);
    if (el('sessionBillSCLabel')) el('sessionBillSCLabel').textContent = `${serviceChargeName || 'Service Charge'} (${scRate}%)`;
    if (el('sessionBillSC')) el('sessionBillSC').textContent = fmtMoney(totalSC);

    if (el('sessionBillTotal')) el('sessionBillTotal').textContent = fmtMoney(grandTotal || session.grandTotal || session.runningTotal || 0);
}

const HISTORY_STATUS_LABEL = { Placed: 'Placed', Confirmed: 'Confirmed', Preparing: 'Preparing', Ready: 'Ready', Delivered: 'Delivered', Cancelled: 'Cancelled' };

export function renderHistoryList(orderIds, ordersMap) {
    const list = document.getElementById('historyListContainer');
    if (!list) return;

    if (!orderIds || orderIds.length === 0) {
        list.innerHTML = `<div class="history-empty">No orders yet this visit.<br>Head to the menu to get started!</div>`;
        return;
    }

    const rows = [...orderIds].reverse().map((oid, i) => {
        const o = ordersMap[oid];
        if (!o) return `<div class="history-order-card"><div class="history-order-items">Loading…</div></div>`;
        const itemCount = Object.keys(o.items || {}).length;
        const itemNames = Object.values(o.items || {}).slice(0, 3).map(it => `${it.qty || 1}× ${esc(it.name || 'Item')}`).join(', ');
        const statusKey = (o.status || 'Placed').toLowerCase();
        const time = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
        <div class="history-order-card">
            <div class="history-order-head">
                <span class="history-order-id">Order ${orderIds.length - i}</span>
                <span class="history-status-pill history-status-${statusKey}">${esc(HISTORY_STATUS_LABEL[o.status] || o.status || 'Placed')}</span>
            </div>
            <div class="history-order-items">${esc(itemNames)}${itemCount > 3 ? ` +${itemCount - 3} more` : ''}</div>
            <div class="history-order-foot">
                <span class="history-order-time">${esc(time)}</span>
                <span class="history-order-total">${fmtMoney(o.total || 0)}</span>
            </div>
        </div>`;
    }).join('');

    list.innerHTML = rows;
}

function buildInstagramUrl(handle) {
    if (!handle) return null;
    if (/^https?:\/\//i.test(handle)) return handle;
    return `https://instagram.com/${handle.replace(/^@/, '').trim()}`;
}
function buildWhatsappUrl(number) {
    if (!number) return null;
    const clean = String(number).replace(/[^\d]/g, '');
    if (!clean) return null;
    return `https://wa.me/${clean}?text=${encodeURIComponent('Hi! I just dined at Roshani Pizza 🍕')}`;
}

export function renderPromotionsLinks(store) {
    const wrap = document.getElementById('promotionsLinksContainer');
    if (!wrap) return;
    const s = store || {};

    const links = [
        { key: 'google', title: 'Rate us on Google', sub: 'Leave a review — it helps a lot!', url: s.googleReviewLink, cls: 'promo-link-google',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5L18 21l-6-4.4L6 21l2.2-7.1L2 9.4h7.6z"/></svg>' },
        { key: 'instagram', title: 'Follow on Instagram', sub: 'See our latest dishes & offers', url: buildInstagramUrl(s.instagram), cls: 'promo-link-instagram',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>' },
        { key: 'facebook', title: 'Like us on Facebook', sub: 'Stay updated with news & events', url: s.facebook, cls: 'promo-link-facebook',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>' },
        { key: 'whatsapp', title: 'Chat on WhatsApp', sub: 'Questions or feedback? Message us', url: buildWhatsappUrl(s.whatsappNumber), cls: 'promo-link-whatsapp',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 2.1 17.6L1 23l5.5-1.4A11 11 0 1 0 20.5 3.5zM12 20.9a9 9 0 0 1-4.6-1.3l-.3-.2-3.4.9.9-3.3-.2-.3A9 9 0 1 1 12 20.9z"/></svg>' }
    ].filter(l => l.url);

    if (links.length === 0) {
        wrap.innerHTML = `<div class="promotions-empty">No promotion links have been set up yet. Check back soon!</div>`;
        return;
    }

    wrap.innerHTML = links.map(l => `
        <a class="promo-link-card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
            <span class="promo-link-icon ${l.cls}">${l.icon}</span>
            <span class="promo-link-body">
                <span class="promo-link-title">${esc(l.title)}</span>
                <span class="promo-link-sub">${esc(l.sub)}</span>
            </span>
            <svg class="promo-link-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </a>`).join('');
}

// --- Discount code UI helpers ---
export function showDiscountMsg(text, type) {
    const el = document.getElementById('discountMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'discount-msg ' + (type === 'success' ? 'discount-success' : 'discount-error');
    el.classList.remove('hidden');
}

export function hideDiscountMsg() {
    const el = document.getElementById('discountMsg');
    if (el) el.classList.add('hidden');
}

export function setDiscountInputLoading(loading) {
    const btn = document.getElementById('btnApplyDiscount');
    const input = document.getElementById('discountCodeInput');
    if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Checking…' : 'Apply'; }
    if (input) input.disabled = loading;
}

export function showAppliedDiscount(label, amount, mode, value) {
    const btn = document.getElementById('btnApplyDiscount');
    const input = document.getElementById('discountCodeInput');
    if (btn) { btn.textContent = 'Remove'; btn.classList.add('discount-applied'); }
    if (input) { input.disabled = true; input.value = label; }
    const pctInfo = mode === 'percent' && value ? ` (${value}% off)` : '';
    showDiscountMsg(`✓ ${label} applied — ${fmtMoney(amount)} off${pctInfo}`, 'success');
}

export function resetDiscountInput() {
    const btn = document.getElementById('btnApplyDiscount');
    const input = document.getElementById('discountCodeInput');
    if (btn) { btn.textContent = 'Apply'; btn.classList.remove('discount-applied'); btn.disabled = false; }
    if (input) { input.disabled = false; input.value = ''; }
    hideDiscountMsg();
}
