/**
 * menu/js/app-checkout.js
 * Checkout of the dedicated restaurant app (no table, no WhatsApp link).
 * Two ways to receive the order: DELIVERY (address + location, fee from the
 * outlet's distance slabs) or PICKUP (collect at the restaurant, no fee).
 *
 * The order is written straight to {outlet}/orders with source 'APP' (rules:
 * anonymous auth, appUid == auth.uid, status Placed, payment Pending). After
 * that the bot finalizes it exactly like a webview order (discount re-check,
 * reward tender, stock, customer profile) and the customer follows every
 * status in the Orders tab + push notifications. Payment is collected by the
 * restaurant (cash / UPI at delivery or pickup) — there is no online gateway.
 */
import { outletRef, get, set, ensureAnonAuth, OUTLET, BUSINESS_ID } from './firebase.js';
import { Cart, clearCart, subtotal as cartSubtotal, isEmpty as cartIsEmpty } from './cart.js';
import * as UI from './ui.js';
import { validateCoupon } from './discount.js';
import { getProfile, rememberIdentity, writeCustomerOrder, validateRewardCode, redeemValuePaisePerPoint, minSpendAfterRedemptionRs, maxRedeemPercentOfOrder } from './customer.js';
import { calculateDistance, getFeeFromSlabs } from './geo.js';
import { generateOrderId } from './order.js';
import { assertOutletEnabled } from './session.js';
import { computeOrderTotals, round2 } from '../shared/money-math.js';
import { computeTenderPaise } from '../shared/loyalty-math.js';

const S = {
    mode: 'delivery',          // 'delivery' | 'pickup'
    location: null,            // { lat, lng }
    slabs: null,               // settings/Delivery/slabs
    store: null,               // settings/Store
    dine: null,                // dineinSettings (tax)
    discount: null,            // validated coupon
    reward: null,              // { key, code, label, points, amount }
    placing: false,
    ready: false,
    onPlaced: null,
};

const $ = (id) => document.getElementById(id);

// ── pure helpers (exported for tests) ─────────────────────────────
export function taxRatesFrom(dine) {
    const d = dine || {};
    const enabled = d.taxEnabled !== false;
    if (Array.isArray(d.taxRates) && d.taxRates.length > 0) return d.taxRates;
    return enabled ? [{ name: d.taxName || 'GST', rate: typeof d.taxPercent === 'number' ? d.taxPercent : 5 }] : [];
}

export function deliveryFeeFor(location, store, slabs) {
    if (!location) return 0;
    const s = store || {};
    const outlet = {
        lat: parseFloat(s.lat ?? (OUTLET === 'cake' ? 25.887472 : 25.887944)),
        lng: parseFloat(s.lng ?? (OUTLET === 'cake' ? 85.026861 : 85.026194)),
    };
    const dist = calculateDistance(location.lat, location.lng, outlet.lat, outlet.lng);
    return { fee: getFeeFromSlabs(dist, Array.isArray(slabs) ? slabs : []), distanceKm: round2(dist) };
}

export function computeCheckout({ subtotal, mode, discount, rewardPoints, fee, dine, redeemPaise = 100, minSpendRs = 0, maxRedeemPct = 0 }) {
    const rates = taxRatesFrom(dine);
    const deliveryFee = mode === 'delivery' ? (Number(fee) || 0) : 0;
    const t = computeOrderTotals({ subtotal, discount: discount && discount.amount > 0 ? discount.amount : 0, taxRates: rates, serviceChargeEnabled: false, deliveryFee });
    let tender = 0;
    if (rewardPoints > 0) {
        // Same R10 cap the bot applies (maxRedeemPercentOfOrder of the pre-tax
        // order value) so the previewed "To pay" always equals the final bill.
        const capBasePaise = Math.round(Math.max(0, t.subtotal - t.discount) * 100);
        tender = round2(computeTenderPaise({
            points: rewardPoints, redeemValuePaisePerPoint: redeemPaise,
            totalDuePaise: Math.round(t.total * 100), minSpendAfterRedemptionPaise: Math.round(minSpendRs * 100),
            subtotalPaise: capBasePaise, maxRedeemPercentOfOrder: maxRedeemPct,
        }) / 100);
    }
    return { ...t, tender, payable: round2(Math.max(0, t.total - tender)) };
}

/** Builds the order record. Pure: everything environmental is passed in. */
export function buildAppOrder({ orderId, mode, cartLines, name, phone, address, location, distanceKm, note, totals, discount, reward, appUid, business, outlet, now = new Date() }) {
    const items = cartLines.map(l => ({
        name: l.name, size: l.size, unitPrice: l.unitPrice,
        addons: (l.addons || []).map((n, i) => ({ name: n, price: (l.addonPrices || [])[i] || 0 })),
        quantity: l.qty, total: round2(l.unitPrice * l.qty), outlet,
        instructions: l.instructions || '',
        ...(l.comboId ? { comboId: l.comboId, comboName: l.comboName, comboLineOriginal: l.comboLineOriginal } : {}),
    }));
    const delivery = mode === 'delivery';
    const o = {
        orderId, outlet, business,
        type: delivery ? 'Online' : 'Pickup',
        orderMode: delivery ? 'delivery' : 'pickup',
        source: 'APP', channel: 'app', appUid,
        customerName: name, phone,
        subtotal: totals.subtotal, deliveryFee: totals.deliveryFee, tax: totals.tax, taxItems: totals.taxItems,
        taxName: (totals.taxItems || []).map(r => r.name).join(' + '),
        total: totals.total,
        status: 'Placed',
        paymentMethod: delivery ? 'COD' : null, paymentStatus: 'Pending',
        createdAt: now.toISOString(),
        assignedRider: null,
        items, stockDeducted: false, note: note || '',
    };
    if (delivery) { o.address = address; o.lat = location.lat; o.lng = location.lng; o.distanceKm = distanceKm; }
    if (totals.discount > 0 && discount) {
        o.discount = totals.discount; o.discountId = discount.discountId || null;
        o.discountLabel = discount.name || discount.couponCode || null;
        o.discountSource = 'coupon:' + (discount.couponCode || '');
        o.discountMode = discount.mode || 'fixed'; o.discountValue = discount.value || 0; o.discountGlobalLimit = discount.maxCap || 0;
    }
    if (reward && reward.key && reward.code) o.rewardCode = { key: String(reward.key), code: String(reward.code) };
    return o;
}

// ── data ──────────────────────────────────────────────────────────
async function loadSettings() {
    const [slabs, store, dine] = await Promise.all([
        get(outletRef('settings/Delivery/slabs')), get(outletRef('settings/Store')), get(outletRef('dineinSettings')),
    ]);
    S.slabs = slabs.val() || []; S.store = store.val() || {}; S.dine = dine.val() || {};
    S.ready = true;
}

function currentFee() {
    if (S.mode !== 'delivery' || !S.location) return { fee: 0, distanceKm: 0 };
    return deliveryFeeFor(S.location, S.store, S.slabs);
}

function currentTotals() {
    const { fee } = currentFee();
    return computeCheckout({
        subtotal: cartSubtotal(), mode: S.mode, discount: S.discount,
        rewardPoints: S.reward ? S.reward.points : 0, fee, dine: S.dine,
        redeemPaise: redeemValuePaisePerPoint(), minSpendRs: minSpendAfterRedemptionRs(),
        maxRedeemPct: maxRedeemPercentOfOrder(),
    });
}

// ── view ──────────────────────────────────────────────────────────
function row(label, value, cls = '') { return `<div class="cart-summary-row ${cls}"><span>${UI.esc(label)}</span><span>${value}</span></div>`; }

function render() {
    const isDelivery = S.mode === 'delivery';
    document.querySelectorAll('[data-co-mode]').forEach(b => {
        const on = b.dataset.coMode === S.mode;
        b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
    });
    $('coAddressWrap')?.classList.toggle('hidden', !isDelivery);
    $('coPickupNote')?.classList.toggle('hidden', isDelivery);
    const t = currentTotals();
    if (S.reward) {
        if (t.tender > 0) S.reward.amount = t.tender;
        else { S.reward = null; UI.showToast('Reward no longer applies to this bill', 'error'); }
    }
    let html = row('Item total', UI.fmtMoney(t.subtotal));
    if (t.discount > 0) html += row(S.discount?.name || 'Discount', '-' + UI.fmtMoney(t.discount), 'cart-summary-discount');
    (t.taxItems || []).forEach(x => { if (x.amount > 0) html += row(`${x.name || 'Tax'} (${x.rate}%)`, UI.fmtMoney(x.amount)); });
    if (isDelivery) html += row('Delivery fee', S.location ? UI.fmtMoney(t.deliveryFee) : 'Enable location');
    if (t.tender > 0) html += row(`Loyalty points (${S.reward.points} pts)`, '-' + UI.fmtMoney(t.tender), 'cart-summary-discount');
    html += row(t.tender > 0 ? 'Total' : 'Total', UI.fmtMoney(t.total), 'cart-summary-total');
    if (t.tender > 0) html += row('To pay', UI.fmtMoney(t.payable), 'cart-summary-total');
    $('coLines').innerHTML = html;
    const btn = $('btnCoPlace');
    if (btn && !S.placing) {
        btn.disabled = false;
        btn.textContent = isDelivery && !S.location ? 'SHARE LOCATION TO CONTINUE' : (isDelivery ? 'PLACE DELIVERY ORDER' : 'PLACE PICKUP ORDER');
    }
    $('coPayNote').textContent = isDelivery
        ? 'Pay cash or UPI to the rider when your order arrives.'
        : 'Pay at the counter (cash, UPI or card) when you collect your order.';
}

function setLocStatus(msg, bad = false) {
    const el = $('coLocStatus'); if (!el) return;
    el.textContent = msg; el.classList.toggle('co-error', bad);
}

function requestLocation() {
    if (!navigator.geolocation) { setLocStatus('Location is not supported on this device.', true); return; }
    setLocStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition((pos) => {
        S.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocStatus('Location shared ✓');
        render();
    }, (err) => {
        setLocStatus(err && err.code === 1 ? 'Location permission was denied. Allow it in your browser settings to order for delivery.' : 'Could not get your location. Try again.', true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

async function applyCode() {
    const input = $('coDiscountInput'); if (!input) return;
    const msg = $('coDiscountMsg');
    const show = (t, bad) => { msg.textContent = t; msg.classList.remove('hidden'); msg.classList.toggle('co-error', !!bad); };
    if (S.discount || S.reward) { S.discount = null; S.reward = null; input.value = ''; input.disabled = false; msg.classList.add('hidden'); $('btnCoApply').textContent = 'Apply'; render(); return; }
    const code = input.value.trim();
    if (!code) { show('Enter a code', true); return; }
    const hit = await validateCoupon(code, cartSubtotal());
    if (hit) {
        S.discount = hit; input.disabled = true; $('btnCoApply').textContent = 'Remove';
        render(); show(`${hit.name || hit.couponCode} applied: -${UI.fmtMoney(hit.amount)}`); return;
    }
    const phone = ($('coPhone').value || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) { show('Enter your mobile number first, then apply a reward code', true); return; }
    const rew = await validateRewardCode(code, phone);
    if (!rew) { show('Invalid or expired code', true); return; }
    S.reward = { key: rew.key, code: rew.code, label: rew.label || 'Loyalty reward', points: rew.cost, amount: 0 };
    const t = currentTotals();
    if (!(t.tender > 0)) { S.reward = null; show('This reward does not apply to this bill', true); return; }
    input.disabled = true; $('btnCoApply').textContent = 'Remove';
    render(); show(`${S.reward.label} applied: -${UI.fmtMoney(t.tender)}`);
}

// ── place order ───────────────────────────────────────────────────
async function placeOrder() {
    if (S.placing) return;
    if (cartIsEmpty()) { UI.showToast('Your cart is empty', 'error'); return; }
    const name = ($('coName').value || '').trim();
    const phone = ($('coPhone').value || '').replace(/\D/g, '').slice(-10);
    const address = ($('coAddress').value || '').trim();
    const note = ($('coNote').value || '').trim();
    if (!name) { UI.showToast('Please enter your name', 'error'); return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { UI.showToast('Please enter a valid 10-digit mobile number', 'error'); return; }
    if (S.mode === 'delivery') {
        if (!S.location) { requestLocation(); return; }
        if (!address) { UI.showToast('Please enter your delivery address', 'error'); return; }
    }
    S.placing = true;
    const btn = $('btnCoPlace'); btn.disabled = true; btn.textContent = 'Placing your order…';
    try {
        await assertOutletEnabled();
        const user = await ensureAnonAuth();
        const orderId = await generateOrderId();
        const { distanceKm } = currentFee();
        const totals = currentTotals();
        const order = buildAppOrder({
            orderId, mode: S.mode, cartLines: Object.values(Cart.lines), name, phone, address,
            location: S.location, distanceKm, note, totals, discount: S.discount, reward: S.reward,
            appUid: user.uid, business: BUSINESS_ID, outlet: OUTLET,
        });
        await set(outletRef(`orders/${orderId}`), order);
        rememberIdentity(name, phone);
        // History entry for the Orders / Payments tabs (the bot keeps it in sync afterwards).
        await writeCustomerOrder({
            orderId, outlet: OUTLET, business: BUSINESS_ID, customerPhone: phone, customerName: name,
            status: 'Placed', total: totals.total, createdAt: Date.now(), source: 'APP', paymentStatus: 'Pending',
            itemCount: order.items.length,
            itemsSummary: order.items.slice(0, 6).map(i => ({ name: i.name, qty: i.quantity })),
            orderMode: order.orderMode,
        });
        clearCart();
        S.discount = null; S.reward = null;
        UI.showToast(`Order placed! Total ${UI.fmtMoney(totals.total)}`, 'success');
        if (S.onPlaced) S.onPlaced(orderId);
    } catch (e) {
        console.error('[AppCheckout] failed', e);
        UI.showToast(e && e.code === 'OUTLET_DISABLED' ? 'This restaurant is not taking orders right now.' : 'Could not place your order — please try again.', 'error');
    } finally {
        S.placing = false;
        render();
    }
}

// ── cancel (customer) ─────────────────────────────────────────────
// Allowed by the rules only for the same device's anonymous uid and only while
// the order is still 'Placed' (before the restaurant confirms it).
export async function cancelAppOrder(orderId) {
    const id = String(orderId || '');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return false;
    await ensureAnonAuth();
    await set(outletRef(`orders/${id}/status`), 'Cancelled');
    const p = getProfile();
    if (p && p.phone) await set(outletRef(`customers/${p.phone}/orders/${id}/status`), 'Cancelled').catch(() => {});
    return true;
}

// ── wiring ────────────────────────────────────────────────────────
let _wired = false;
export async function openCheckout() {
    const p = getProfile();
    if (p) {
        if (!$('coName').value) $('coName').value = p.name && p.name !== 'Guest' ? p.name : '';
        if (!$('coPhone').value) $('coPhone').value = p.phone || '';
    }
    if (!S.ready) { try { await loadSettings(); } catch (e) { console.warn('[AppCheckout] settings failed', e); } }
    S.discount = null; S.reward = null;
    const inp = $('coDiscountInput'); if (inp) { inp.value = ''; inp.disabled = false; }
    $('btnCoApply').textContent = 'Apply'; $('coDiscountMsg')?.classList.add('hidden');
    render();
    UI.showScreen('screenCheckout');
}

export function initAppCheckout({ onPlaced, onBack } = {}) {
    S.onPlaced = onPlaced || null;
    if (_wired) return; _wired = true;
    document.querySelectorAll('[data-co-mode]').forEach(b => b.addEventListener('click', () => { S.mode = b.dataset.coMode === 'pickup' ? 'pickup' : 'delivery'; render(); }));
    $('btnCoLocate')?.addEventListener('click', requestLocation);
    $('btnCoApply')?.addEventListener('click', () => applyCode().catch(() => UI.showToast('Could not check that code', 'error')));
    $('btnCoPlace')?.addEventListener('click', placeOrder);
    $('btnCoBack')?.addEventListener('click', () => { if (onBack) onBack(); });
}
