/**
 * FoodHubbie ERP | COSTS TAB (Admin/js/features/costs.js)
 * ============================================================================
 * Live "cost of running the software" index for a selectable date range
 * (default: current month; From/To date inputs + This/Last month chips):
 *   - every new order (onChildAdded) is identified by source and priced:
 *       QR ₹2 · POS counter ₹1 · webview_delivery (WhatsApp flow) ₹3 · other ₹2
 *       (commission_1pct mode → 1% of order total instead, Official pack)
 *   - cancelled/refunded orders are excluded from billing
 *   - promo token balance KPI + promo usage cost = sent tokens × ₹1 (campaigns totalSent)
 *
 * Data: businesses/{bid}/outlets/{oid}/orders/{id}   (existing)
 *       businesses/{bid}/outlets/{oid}/billing/*     (seeded, rules-gated)
 *       businesses/{bid}/outlets/{oid}/bot/promotions/campaigns (existing)
 * Pure math lives in ../../shared/cost-math.js (node-runnable self-check).
 * ============================================================================
 */
import { Outlet, onValue, onChildAdded, onChildChanged, query, orderByChild, startAt, endAt } from '../firebase.js';
import { DEFAULT_RATES, PROMO_RATE, sourceOf, feeOf, computeCostIndex } from '../../shared/cost-math.js';

let _unsubs = [];
let _orders = {};
let _billing = null;      // null = not seeded yet, false = read denied
let _campaigns = null;
let _lastIndex = 0;
let _renderTimer = null;
let _subtabsWired = false;
let _rangeWired = false;
let _range = null;           // { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
let _orderUnsubs = [];

function _wireSubtabs() {
    if (_subtabsWired) return;
    _subtabsWired = true;
    document.getElementById('tab-costs')?.addEventListener('click', e => {
        const b = e.target.closest('[data-cost-tab]');
        if (!b) return;
        document.querySelectorAll('#tab-costs .cost-subtab').forEach(x => x.classList.toggle('active', x === b));
        document.querySelectorAll('#tab-costs [data-cost-section]').forEach(el => {
            el.style.display = el.dataset.costSection === b.dataset.costTab ? '' : 'none';
        });
    });
    // initial paint: only the active sub-tab's section shows
    const active = document.querySelector('#tab-costs .cost-subtab.active');
    document.querySelectorAll('#tab-costs [data-cost-section]').forEach(el => {
        el.style.display = active && el.dataset.costSection === active.dataset.costTab ? '' : 'none';
    });
}

function _wireRange() {
    if (_rangeWired) return;
    _rangeWired = true;
    document.getElementById('costDateFrom')?.addEventListener('change', _onDateInput);
    document.getElementById('costDateTo')?.addEventListener('change', _onDateInput);
    document.getElementById('tab-costs')?.addEventListener('click', e => {
        const b = e.target.closest('[data-cost-range]');
        if (!b) return;
        _applyRange(_monthRange(b.dataset.costRange === 'last' ? -1 : 0));
    });
}

function _onDateInput() {
    const from = document.getElementById('costDateFrom')?.value;
    const to = document.getElementById('costDateTo')?.value;
    if (!from || !to) return;
    _applyRange(from <= to ? { from, to } : { from: to, to: from });
}

function _applyRange(r) {
    _range = r;
    const fi = document.getElementById('costDateFrom'), ti = document.getElementById('costDateTo');
    if (fi) fi.value = r.from;
    if (ti) ti.value = r.to;
    const thisR = _monthRange(0), lastR = _monthRange(-1);
    document.querySelectorAll('#tab-costs [data-cost-range]').forEach(b => {
        const m = b.dataset.costRange === 'last' ? lastR : thisR;
        b.classList.toggle('active', r.from === m.from && r.to === m.to);
    });
    _subscribeOrders();
    _scheduleRender();
}

function _subscribeOrders() {
    _orderUnsubs.forEach(u => { try { u(); } catch (e) { /* already unsubscribed */ } });
    _orderUnsubs = [];
    _orders = {}; _lastIndex = 0;
    // end bound: day + U+F8FF (highest BMP char) = inclusive prefix upper bound
    const q = query(Outlet.ref('orders'), orderByChild('createdAt'), startAt(_range.from), endAt(_range.to + ''));
    _orderUnsubs.push(onChildAdded(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
    _orderUnsubs.push(onChildChanged(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
}

const _inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const _dayStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _monthRange = off => {
    const n = new Date();
    const f = new Date(n.getFullYear(), n.getMonth() + off, 1);
    return { from: _dayStr(f), to: _dayStr(new Date(f.getFullYear(), f.getMonth() + 1, 0)) };
};
const _rangeLabel = () => {
    if (!_range) return '';
    const f = new Date(_range.from + 'T00:00:00'), t = new Date(_range.to + 'T00:00:00');
    if (_range.from.slice(0, 7) === _range.to.slice(0, 7)) return f.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return `${f.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
};
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

function _render() {
    const rates = _rates();
    const mode = _mode();
    const idx = computeCostIndex(_orders, rates, mode);

    _setText('costMonthLabel', _rangeLabel());

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
            <td>${_label(src)}</td>
            <td>${mode === 'commission_1pct' && src === 'webview_delivery' ? '1% of order' : _inr(rates[src] ?? rates.other)}</td>
            <td>${v.orders}</td>
            <td>${_inr(v.cost)}</td>
        </tr>`).join('') : '<tr><td colspan="4">No orders in this range</td></tr>';
    }

    // --- date-wise usage (per-day cost within the range) ---
    const db = document.getElementById('costDayBody');
    if (db) {
        const byDay = {};
        for (const [id, o] of Object.entries(_orders)) {
            const d = String(o?.createdAt || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
            (byDay[d] = byDay[d] || {})[id] = o;
        }
        const days = Object.keys(byDay).sort().reverse();
        db.innerHTML = days.length ? days.map(d => {
            const di = computeCostIndex(byDay[d], rates, mode);
            return `<tr>
                <td>${new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td>${di.count}</td>
                <td>${_inr(di.total)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="3">No orders in this range</td></tr>';
    }

    // --- promo token balance KPI ---
    const bal = _billing && typeof _billing === 'object' ? _billing.tokens?.balance : undefined;
    _setText('costKpiTokens', bal == null ? '—' : String(bal));
    const w = _billing && typeof _billing === 'object' ? _billing.tokenPacks?.welcome : null;
    if (w && bal === w.qty) _setText('costKpiTokensTrend', 'free welcome pack untouched');

    // --- promo usage (campaign sends) ---
    let used = 0;
    if (_campaigns) for (const c of Object.values(_campaigns)) used += Number(c?.totalSent || 0);
    _setText('costPromoUsed', String(used));
    _setText('costKpiPromo', _inr(used * PROMO_RATE));
    _setText('costKpiPromoTrend', `${used} token${used === 1 ? '' : 's'} used × ₹${PROMO_RATE}`);

    // --- billing configuration breakdown (read-only) ---
    const billingDiv = document.getElementById('costBillingBreakdown');
    if (billingDiv) {
        if (!_billing || typeof _billing !== 'object') {
            billingDiv.innerHTML = `
                <div class="mob-card mob-table-card" style="margin-top:12px;">
                    <h4 class="section-card-heading"><i data-lucide="wallet" class="icon-14"></i> Billing configuration</h4>
                    <div style="color:#64748b;padding:8px;">Not seeded — run <code class="mono" style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">tools/seed-billing-defaults.cjs</code> to initialize.</div>
                </div>`;
        } else {
            const b = _billing;
            const rates = _rates();
            const mode = _mode();
            const modeLabel = mode === 'commission_1pct' ? 'WhatsApp Official (1% of order total)' : 'Per-order flat rates';
            const setup = b.setup || {};
            const setupStatus = setup.status || 'non_refundable';
            const tp = b.tokenPacks || {};
            const welcome = tp.welcome || {};
            const bal = b.tokens?.balance ?? 0;
            const totalGranted = (b.tokens?.granted || 0);
            const totalUsed = (b.tokens?.used || 0);

            billingDiv.innerHTML = `
                <div class="cost-billing">
                    <h4 class="section-card-heading"><i data-lucide="wallet" class="icon-14"></i> Billing configuration</h4>
                    <div class="cost-detail-grid">
                        <div>
                            <div class="cost-detail-label">Mode</div>
                            <div class="cost-detail-value">${modeLabel}</div>
                        </div>
                        <div>
                            <div class="cost-detail-label">Setup status</div>
                            <div class="cost-detail-value">${setupStatus === 'non_refundable' ? 'Non-refundable' : setupStatus.charAt(0).toUpperCase() + setupStatus.slice(1)}</div>
                        </div>
                        <div>
                            <div class="cost-detail-label">Token balance</div>
                            <div class="cost-detail-value" style="color:var(--accent,#25D366);">${bal}</div>
                        </div>
                        <div>
                            <div class="cost-detail-label">Granted / used</div>
                            <div class="cost-detail-value">${totalGranted} / ${totalUsed}</div>
                        </div>
                        <div>
                            <div class="cost-detail-label">Welcome pack</div>
                            <div class="cost-detail-value">${welcome.qty ? `${welcome.qty} free${bal === welcome.qty ? ' (unused)' : ''}` : 'Not granted'}</div>
                        </div>
                        <div>
                            <div class="cost-detail-label">Promo rate</div>
                            <div class="cost-detail-value">₹${PROMO_RATE} / token</div>
                        </div>
                    </div>
                    <div style="margin-top:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#64748b;">Per-source rates</div>
                    <div class="cost-rate-chips">
                        ${Object.keys(LABELS).filter(k => k in rates).map(k =>
                            `<span class="cost-rate-chip">${_label(k)}: ${mode === 'commission_1pct' && k === 'webview_delivery' ? '1% of order' : '₹' + rates[k]}</span>`).join('')}
                    </div>
                </div>`;
        }
    }

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
            return `<tr class="${excluded ? 'cost-row-excluded' : ''}">
                <td>#${o.orderId || id}${excluded ? ' <span class="cost-excluded-tag">(excluded)</span>' : ''}</td>
                <td><span class="cost-src-chip">${_label(src)}</span></td>
                <td>${_inr(o.total)}</td>
                <td>${fee === null ? '—' : _inr(fee)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="4">No orders in this range</td></tr>';
    }
}

export function loadCosts() {
    cleanupCosts();
    _wireSubtabs();
    _wireRange();
    _billing = null; _campaigns = null;
    _range = _range || _monthRange(0);
    _applyRange(_range);

    _unsubs.push(onValue(Outlet.ref('billing'),
        s => { _billing = s.val() || null; _scheduleRender(); },
        () => { _billing = false; _scheduleRender(); }));
    _unsubs.push(onValue(Outlet.ref('bot/promotions/campaigns'),
        s => { _campaigns = s.val(); _scheduleRender(); }, () => {}));

    _render();
}

export function cleanupCosts() {
    _unsubs.forEach(u => { try { u(); } catch (e) { /* already unsubscribed */ } });
    _unsubs = [];
    _orderUnsubs.forEach(u => { try { u(); } catch (e) { /* already unsubscribed */ } });
    _orderUnsubs = [];
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
}
