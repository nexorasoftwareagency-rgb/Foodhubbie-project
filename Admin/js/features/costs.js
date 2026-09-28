/**
 * FoodHubbie ERP | COSTS TAB (Admin/js/features/costs.js)
 * ============================================================================
 * Live "cost of running the software" index for the current month:
 *   - every new order (onChildAdded) is identified by source and priced:
 *       QR ₹2 · POS counter ₹1 · webview_delivery (WhatsApp flow) ₹3 · other ₹2
 *       (commission_1pct mode → 1% of order total instead, Official pack)
 *   - cancelled/refunded orders are excluded from billing
 *   - promo token balance KPI + promo usage cost = sent tokens × ₹0.86 (campaigns totalSent)
 *
 * Data: businesses/{bid}/outlets/{oid}/orders/{id}   (existing)
 *       businesses/{bid}/outlets/{oid}/billing/*     (seeded, rules-gated)
 *       businesses/{bid}/outlets/{oid}/bot/promotions/campaigns (existing)
 * Pure math lives in ../../shared/cost-math.js (node-runnable self-check).
 * ============================================================================
 */
import { Outlet, onValue, onChildAdded, onChildChanged, query, orderByChild, startAt } from '../firebase.js';
import { DEFAULT_RATES, PROMO_RATE, sourceOf, feeOf, computeCostIndex } from '../../shared/cost-math.js';

let _unsubs = [];
let _orders = {};
let _billing = null;      // null = not seeded yet, false = read denied
let _campaigns = null;
let _lastIndex = 0;
let _renderTimer = null;
let _subtabsWired = false;

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

function _render() {
    const rates = _rates();
    const mode = _mode();
    const idx = computeCostIndex(_orders, rates, mode);

    _setText('costMonthLabel', new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));

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
            <td style="text-align:right;">${mode === 'commission_1pct' && src === 'webview_delivery' ? '1% of order' : _inr(rates[src] ?? rates.other)}</td>
            <td style="text-align:right;">${v.orders}</td>
            <td style="text-align:right;padding-right:8px;font-weight:700;">${_inr(v.cost)}</td>
        </tr>`).join('') : '<tr><td colspan="4" style="color:#64748b;padding:8px;">No orders yet this month</td></tr>';
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
            const setupStatus = setup.status || 'refundable';
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
                            <div class="cost-detail-value">${setupStatus === 'non_refundable' ? 'Non-refundable (Official)' : 'Refundable (Baileys)'}</div>
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
            return `<tr style="opacity:${excluded ? 0.55 : 1}">
                <td style="padding:6px 8px;">#${o.orderId || id}${excluded ? ' <span style="color:#ef4444;">(excluded)</span>' : ''}</td>
                <td><span style="background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;">${_label(src)}</span></td>
                <td style="text-align:right;">${_inr(o.total)}</td>
                <td style="text-align:right;padding-right:8px;font-weight:700;">${fee === null ? '—' : _inr(fee)}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="4" style="color:#64748b;padding:8px;">No orders yet this month</td></tr>';
    }
}

export function loadCosts() {
    cleanupCosts();
    _wireSubtabs();
    _orders = {}; _billing = null; _campaigns = null; _lastIndex = 0;

    const q = query(Outlet.ref('orders'), orderByChild('createdAt'), startAt(_monthPrefix()));
    _unsubs.push(onChildAdded(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
    _unsubs.push(onChildChanged(q, s => { _orders[s.key] = s.val(); _scheduleRender(); }));
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
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
}
