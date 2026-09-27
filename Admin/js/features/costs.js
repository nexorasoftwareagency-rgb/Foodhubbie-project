/**
 * FoodHubbie ERP | COSTS TAB (Admin/js/features/costs.js)
 * ============================================================================
 * Live "cost of running the software" index for the current month:
 *   - every new order (onChildAdded) is identified by source and priced:
 *       QR ₹2 · POS ₹2 · webview_delivery (WhatsApp flow) ₹3 · other ₹2
 *       (commission_1pct mode → 1% of order total instead, Official pack)
 *   - cancelled/refunded orders are excluded from billing
 *   - prepaid WhatsApp Official promo tokens (balance + welcome pack) and
 *     promo usage cost = sent tokens × ₹0.86 (campaigns totalSent)
 *
 * Data: businesses/{bid}/outlets/{oid}/orders/{id}   (existing)
 *       businesses/{bid}/outlets/{oid}/billing/*     (seeded, rules-gated)
 *       businesses/{bid}/outlets/{oid}/bot/promotions/campaigns (existing)
 * Pure math lives in ./cost-math.js (node-runnable self-check).
 * ============================================================================
 */
import { Outlet, onValue, onChildAdded, onChildChanged, query, orderByChild, startAt, ref, db, BUSINESS_ID } from '../firebase.js';
import { DEFAULT_RATES, PROMO_RATE, sourceOf, feeOf, computeCostIndex } from './cost-math.js';

let _unsubs = [];
let _orders = {};
let _billing = null;      // null = not seeded yet, false = read denied
let _campaigns = null;
let _biz = null;          // businesses/{bid} — plan lives here
let _lastIndex = 0;
let _renderTimer = null;

const _inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const _monthPrefix = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`; };
const _rates = () => ({ ...DEFAULT_RATES, ...(_billing && typeof _billing === 'object' ? _billing.rates || {} : {}) });
const _mode = () => (_billing && typeof _billing === 'object' && _billing.mode === 'commission_1pct') ? 'commission_1pct' : 'per_order';

const LABELS = { QR: 'QR menu', POS: 'POS counter', webview_delivery: 'WhatsApp / webview', WA: 'WhatsApp', other: 'Other' };
const _label = src => LABELS[src] || src;

function _setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
}

function _scheduleRender() {
    if (_renderTimer) return;
    _renderTimer = setTimeout(() => { _renderTimer = null; _render(); }, 120);
}

function _pricingLabel() {
    if (_billing === false) return '—';
    const r = _rates();
    if (_mode() === 'commission_1pct') return `1% of sales (WhatsApp Official pack) + ₹${PROMO_RATE}/promo token`;
    return `₹${r.QR} QR · ₹${r.POS} POS · ₹${r.webview_delivery} WhatsApp per order + ₹${PROMO_RATE}/promo token`;
}

function _render() {
    const rates = _rates();
    const mode = _mode();
    const idx = computeCostIndex(_orders, rates, mode);

    _setText('costMonthLabel', new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));

    // --- active plan + pricing structure ---
    const plan = _biz?.plan;
    _setText('costPlanName', plan ? String(plan)[0].toUpperCase() + String(plan).slice(1) : '—');
    _setText('costPricingStructure', _pricingLabel());

    const idxEl = document.getElementById('costKpiIndex');
    if (idxEl) {
        idxEl.textContent = _inr(idx.total);
        if (idx.total > _lastIndex) {
            idxEl.animate([{ background: 'rgba(22,163,74,.25)' }, { background: 'transparent' }], { duration: 900 });
            _setText('costKpiIndexTrend', `+${_inr(idx.total - _lastIndex)} — updated on new order`);
        } else if (_lastIndex > 0 && idx.total < _lastIndex) {
            _setText('costKpiIndexTrend', `−${_inr(_lastIndex - idx.total)} — order cancelled/excluded`);
        }
        _lastIndex = idx.total;
    }
    _setText('costKpiOrders', String(idx.count));

    // --- cost by source ---
    const bb = document.getElementById('costBreakdownBody');
    if (bb) {
        const rows = Object.entries(idx.bySource);
        bb.innerHTML = rows.length ? rows.map(([src, v]) => `<tr>
            <td style="padding:6px 8px;font-weight:700;">${_label(src)}</td>
            <td>${mode === 'commission_1pct' && src === 'webview_delivery' ? '1% of order' : _inr(rates[src] ?? rates.other)}</td>
            <td>${v.orders}</td>
            <td style="text-align:right;padding-right:8px;font-weight:700;">${_inr(v.cost)}</td>
        </tr>`).join('') : '<tr><td colspan="4" style="color:#94a3b8;padding:8px;">No orders yet this month</td></tr>';
    }

    // --- promo tokens + billing ---
    const rb = document.getElementById('costRatesBody');
    if (_billing === false) {
        _setText('costKpiTokens', '—');
        _setText('costPromoBal', '—');
        _setText('costPromoNote', 'Cannot read billing — deploy database rules');
        _setText('costBillingMode', '—');
        _setText('costSetupStatus', '—');
        if (rb) rb.innerHTML = '';
    } else if (_billing === null) {
        _setText('costKpiTokens', '—');
        _setText('costPromoBal', '—');
        _setText('costPromoNote', 'Billing not set up yet — run tools/seed-billing-defaults.cjs');
        _setText('costBillingMode', 'per order (default)');
        _setText('costSetupStatus', '—');
        if (rb) rb.innerHTML = Object.entries(DEFAULT_RATES).map(([k, v]) => `<tr><td style="padding:4px 8px;">${_label(k)}</td><td>${_inr(v)}</td></tr>`).join('');
    } else {
        const bal = _billing.tokens?.balance;
        const balTxt = (bal === undefined || bal === null) ? '—' : String(bal);
        _setText('costKpiTokens', balTxt);
        _setText('costPromoBal', balTxt);
        const w = _billing.tokenPacks?.welcome;
        _setText('costPromoNote', w ? `Free welcome pack — ${w.qty} tokens` : '');
        if (w && bal === w.qty) _setText('costKpiTokensTrend', 'free welcome pack untouched');
        _setText('costBillingMode', mode === 'commission_1pct' ? '1% of sales (Official pack)' : 'Per order');
        _setText('costSetupStatus', _billing.setup?.status ? String(_billing.setup.status) : '—');
        if (rb) rb.innerHTML = Object.entries(rates).map(([k, v]) => `<tr><td style="padding:4px 8px;">${_label(k)}</td><td>${_inr(v)}</td></tr>`).join('')
            + `<tr><td style="padding:4px 8px;">Promo token (each)</td><td>${_inr(PROMO_RATE)}</td></tr>`;
    }

    // --- promo usage (campaign sends) ---
    let used = 0;
    if (_campaigns) for (const c of Object.values(_campaigns)) used += Number(c?.totalSent || 0);
    _setText('costPromoUsed', String(used));
    _setText('costKpiPromo', _inr(used * PROMO_RATE));
    _setText('costKpiPromoTrend', `${used} token${used === 1 ? '' : 's'} used × ₹${PROMO_RATE}`);

    // --- live feed (latest 20) ---
    const fb = document.getElementById('costFeedBody');
    if (fb) {
        const list = Object.entries(_orders)
            .sort((a, b) => String(b[1]?.createdAt || '').localeCompare(String(a[1]?.createdAt || '')))
            .slice(0, 20);
        fb.innerHTML = list.length ? list.map(([id, o]) => {
            const src = sourceOf(o);
            const excluded = o.status === 'Cancelled' || o.status === 'Refunded';
            const fee = excluded ? null : feeOf(o, rates, mode);
            return `<tr style="opacity:${excluded ? 0.55 : 1}">
                <td style="padding:6px 8px;">#${o.orderId || id}${excluded ? ' <span style="color:#ef4444;">(excluded)</span>' : ''}</td>
                <td><span style="background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;">${_label(src)}</span></td>
                <td>${_inr(o.total)}</td>
                <td style="text-align:right;padding-right:8px;font-weight:700;">${fee === null ? '—' : _inr(fee)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="4" style="color:#94a3b8;padding:8px;">No orders yet this month</td></tr>';
    }
}

export function loadCosts() {
    cleanupCosts();
    _orders = {}; _billing = null; _campaigns = null; _biz = null; _lastIndex = 0;

    const q = query(Outlet.ref('orders'), orderByChild('createdAt'), startAt(_monthPrefix()));
    _unsubs.push(onChildAdded(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
    _unsubs.push(onChildChanged(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
    _unsubs.push(onValue(Outlet.ref('billing'),
        s => { _billing = s.val() || null; _scheduleRender(); },
        () => { _billing = false; _scheduleRender(); }));
    _unsubs.push(onValue(Outlet.ref('bot/promotions/campaigns'),
        s => { _campaigns = s.val(); _scheduleRender(); }, () => {}));
    _unsubs.push(onValue(ref(db, `businesses/${BUSINESS_ID()}`),
        s => { _biz = s.val(); _scheduleRender(); }, () => {}));

    _render();
}

export function cleanupCosts() {
    _unsubs.forEach(u => { try { u(); } catch (e) { /* already unsubscribed */ } });
    _unsubs = [];
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
}
