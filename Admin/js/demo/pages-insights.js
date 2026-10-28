/**
 * Demo pages — Insights group: Analytics/Reports, Rider Insights, Feedback is in
 * pages-people.js, Live Tracking, Notifications, Payments, Expenses, Costs, plus
 * the Marketing pages (Promotions, Discounts).
 *
 * Reports run through the REAL shared/report-catalog.js, so the demo numbers use
 * the same aggregation, IST bucketing and revenue basis (Delivered|Served) as the
 * live report runner. CSV export goes through shared/report-export.js.
 */

import {
    money, num, esc, badge, statusBadge, kpiStrip, panel, sectionTitle, table,
    emptyState, searchBar, select, tabs, barChart, rankBars, progress, field,
    input, textarea, restrictedBtn, noteBar, simulatedTag, toast, dateTimeOf,
    minutesAgo, timeOf,
} from './ui-kit.js';
import * as store from './store.js';
import { downloadCsv } from './pages-operations.js';
import { REPORT_CATALOG, REPORT_GROUPS, runReport } from '../../shared/report-catalog.js';
import { computeCostIndex } from '../../shared/cost-math.js';

// -------------------------------------------------------------------- Reports

const reportUi = { key: 'sales-summary', group: 'Sales' };

export function renderReports(root, ctx) {
    const d = store.getData();
    // Shape matches what the live report runner feeds shared/report-catalog.js.
    const reportData = {
        orders: d.orders,
        contacts: Object.fromEntries(d.chats.map(c => [c.id, { customerPhone: c.phone }])),
        dishes: d.dishes,
        attendance: d.attendance,
        staff: d.staff,
    };
    const groups = REPORT_GROUPS;
    const inGroup = REPORT_CATALOG.filter(r => r.group === reportUi.group);
    if (!inGroup.some(r => r.key === reportUi.key) && inGroup.length) reportUi.key = inGroup[0].key;
    const result = runReport(reportUi.key, reportData);
    const meta = REPORT_CATALOG.find(r => r.key === reportUi.key) || { title: 'Report' };

    const fmt = (cell, type) => {
        if (cell === null || cell === undefined || cell === '') return '<span class="text-muted-small">—</span>';
        if (type === 'money') return money(cell);
        if (type === 'num') return num(cell);
        return esc(cell);
    };

    root.innerHTML = `
        ${panel('Analytics & reports', `
            <div class="demo-toolbar">
                ${tabs(groups.map(g => ({ id: g, label: g })), reportUi.group, 'demo-chip demo-chip--sm')}
            </div>
            <div class="demo-toolbar">
                ${tabs(inGroup.map(r => ({ id: r.key, label: r.title })), reportUi.key, 'demo-chip demo-chip--sm')}
                <span class="demo-spacer"></span>
                <button type="button" class="btn-secondary btn-small" id="btnReportCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                ${restrictedBtn('Export Excel / PDF', 'Excel and PDF export use the live report pipeline')}
            </div>
            ${result
            ? table({
                columns: result.columns,
                rows: result.rows.map(r => r.map((cell, i) => fmt(cell, result.colTypes[i]))),
                empty: 'This report has no rows for the demo dataset.',
            })
            : emptyState('file-x', 'Report unavailable', 'This report needs a data feed the demo does not simulate.')}
            <p class="text-muted-small mt-14">${result ? `${result.rows.length} row(s)` : ''} · Revenue basis: <b>Delivered + Served</b> orders only, matching the live report runner.</p>
        `, '', { icon: 'bar-chart-3' })}

        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Revenue trend (7 days)', barChart(store.salesByDay(7).map(x => ({ label: x.label, value: x.revenue })), { height: 170, ariaLabel: 'Revenue trend' }), '', { icon: 'trending-up' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Top sellers', rankBars(store.topItems(6).map(i => ({ label: i.name, value: i.revenue }))), '', { icon: 'utensils' })}
            </div>
        </div>
        ${noteBar('Reports above are computed by the same module the live app uses (<code>shared/report-catalog.js</code>) over demo orders. Nothing is fetched from production.', 'info')}`;

    root.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-chip');
        if (groups.includes(id)) { reportUi.group = id; reportUi.key = (REPORT_CATALOG.find(r => r.group === id) || {}).key || reportUi.key; }
        else reportUi.key = id;
        ctx.rerender();
    }));
    root.querySelector('#btnReportCsv')?.addEventListener('click', () => {
        if (!result) { toast('Nothing to export for this report', 'error'); return; }
        downloadCsv(`demo-${reportUi.key}.csv`, result.columns, result.rows);
        toast(`"${meta.title}" exported from demo data`);
    });
}

// ------------------------------------------------------------- Rider insights

export function renderRiderAnalytics(root, ctx) {
    const d = store.getData();
    const rows = d.riders.map(r => {
        const trips = d.orders.filter(o => o.riderId === r.id && store.isCompleted(o));
        return {
            rider: r,
            trips: trips.length,
            revenue: trips.reduce((s, o) => s + o.total, 0),
            avg: trips.length ? trips.reduce((s, o) => s + o.total, 0) / trips.length : 0,
        };
    }).sort((a, b) => b.trips - a.trips);

    root.innerHTML = `
        ${kpiStrip([
        { value: num(rows.reduce((s, r) => s + r.trips, 0)), label: 'Completed Trips', delta: 'demo history', primary: true },
        { value: money(rows.reduce((s, r) => s + r.revenue, 0)), label: 'Delivered Revenue', delta: 'completed orders' },
        { value: money(Math.round(rows.reduce((s, r) => s + r.rider.wallet, 0))), label: 'Wallets Owed', delta: 'payout pending' },
        { value: (rows.reduce((s, r) => s + r.rider.rating, 0) / rows.length).toFixed(1) + ' ★', label: 'Avg Rating', delta: 'customer feedback' },
    ])}
        ${panel('Rider performance', table({
        columns: ['Rider', 'Status', 'Zone', 'Trips', 'Revenue', 'Avg order', 'Rating', 'Wallet'],
        rows: rows.map(r => [
            `<b>${esc(r.rider.name)}</b><br><span class="text-muted-small">${esc(r.rider.vehicle)}</span>`,
            badge(r.rider.status),
            esc(r.rider.zone),
            num(r.trips),
            money(r.revenue),
            money(Math.round(r.avg)),
            `${r.rider.rating} ★`,
            money(r.rider.wallet),
        ]),
    }), restrictedBtn('Pay out wallets', 'Rider payouts move real money'), { icon: 'trending-up' })}
        ${panel('Trips per rider', rankBars(rows.map(r => ({ label: r.rider.name, value: r.trips })), { valueFmt: (v) => `${v} trips` }), '', { icon: 'bike' })}
        ${noteBar('Rider performance is aggregated from demo orders assigned to each rider — the same grouping the live rider analytics screen performs.', 'info')}`;
}

// ---------------------------------------------------------------- Live tracker

export function renderLiveTracker(root, ctx) {
    const d = store.getData();
    const active = store.liveOrders().filter(o => o.type === 'delivery');
    const zones = [...new Set(d.riders.map(r => r.zone))];

    root.innerHTML = `
        <div class="demo-row-between mb-16">
            ${sectionTitle('Live delivery tracking', 'map-pin')}
            ${simulatedTag('Map data is illustrative')}
        </div>
        <div class="demo-split">
            <div class="demo-split__main">
                ${panel('Delivery map (demo)', `
                    <div class="demo-map" role="img" aria-label="Illustrative delivery map">
                        <div class="demo-map__grid"></div>
                        ${active.map((o, i) => `<span class="demo-map__pin" style="left:${18 + i * 22}%;top:${30 + (i % 3) * 18}%" title="${esc(o.orderId)}">
                            <i data-lucide="map-pin"></i><b>${esc((o.riderName || 'Unassigned').split(' ')[0])}</b>
                        </span>`).join('')}
                        <span class="demo-map__label">Bandra West · Khar · Santacruz (demo zones)</span>
                    </div>
                    ${noteBar('No map provider is contacted. Pins are positioned from demo zone names only.', 'info')}`, '', { icon: 'map' })}
            </div>
            <aside class="demo-split__nav">
                ${panel('In transit', active.length ? `<div class="demo-list">${active.map(o => `
                    <div class="demo-list__row">
                        <div class="demo-list__main">
                            <b>#${esc(o.orderId)}</b>
                            <span class="text-muted-small">${esc(o.riderName || 'Unassigned')} · ${esc(o.address)}</span>
                        </div>
                        <div class="demo-list__value">${statusBadge(o.status)}<span class="text-muted-small">${minutesAgo(o.createdAt, d.now)}</span></div>
                    </div>`).join('')}</div>` : emptyState('map-pin', 'No deliveries in transit', 'All demo deliveries are completed.'), '', { icon: 'truck' })}
                ${panel('Zones covered', `<div class="demo-list">${zones.map(z => `
                    <div class="demo-list__row">
                        <div class="demo-list__main"><b>${esc(z)}</b><span class="text-muted-small">${d.riders.filter(r => r.zone === z).length} rider(s)</span></div>
                        <div class="demo-list__value">${badge('Demo', 'muted')}</div>
                    </div>`).join('')}</div>`, restrictedBtn('Open live GPS', 'Live GPS requires the production rider apps'), { icon: 'navigation' })}
            </aside>
        </div>`;
}

// ------------------------------------------------------------- Notifications

export function renderNotifications(root, ctx) {
    const d = store.getData();
    const unread = d.notifications.filter(n => !n.read).length;
    const ICON = { order: 'shopping-cart', bill: 'receipt', stock: 'package', feedback: 'star', system: 'info' };

    root.innerHTML = `
        ${kpiStrip([
        { value: num(d.notifications.length), label: 'Notifications', delta: `${unread} unread`, primary: true },
        { value: num(d.notifications.filter(n => n.type === 'order').length), label: 'Order Alerts', delta: 'demo activity' },
        { value: num(d.notifications.filter(n => n.type === 'stock').length), label: 'Stock Alerts', delta: 'inventory watch' },
        { value: num(d.notifications.filter(n => n.type === 'bill').length), label: 'Bill Requests', delta: 'dine-in' },
    ])}
        ${panel('Notification centre', `
            <div class="demo-toolbar">
                <button type="button" class="btn-secondary btn-small" id="btnNotifRead"><i data-lucide="check-check" class="icon-14"></i> Mark all read (demo)</button>
                ${restrictedBtn('Notification settings', 'Notification preferences are saved to the live account')}
            </div>
            <div class="demo-notifs">
                ${d.notifications.map(n => `
                    <article class="demo-notif${n.read ? '' : ' is-unread'}">
                        <span class="demo-notif__icon"><i data-lucide="${ICON[n.type] || 'bell'}"></i></span>
                        <div class="demo-notif__main">
                            <b>${esc(n.title)}</b>
                            <span class="text-muted-small">${esc(n.body)}</span>
                        </div>
                        <span class="text-muted-small">${esc(n.at)}</span>
                    </article>`).join('')}
            </div>`, '', { icon: 'bell' })}
        ${noteBar('Notifications are generated by demo activity (order status changes, stock moves, bill requests). No push service is contacted.', 'info')}`;

    root.querySelector('#btnNotifRead')?.addEventListener('click', () => {
        store.markAllNotificationsRead();
        toast('All demo notifications marked read');
        ctx.rerender();
    });
}

// ------------------------------------------------------------------- Payments

const payUi = { method: 'All', q: '' };

export function renderPayments(root, ctx) {
    const all = store.paymentsList();
    const methods = ['All', 'Cash', 'UPI', 'Card', 'COD'];
    const q = payUi.q.trim().toLowerCase();
    const list = all.filter(o => (payUi.method === 'All' || o.paymentMethod === payUi.method)
        && (!q || `${o.orderId} ${o.customerName}`.toLowerCase().includes(q)));
    const total = list.reduce((s, o) => s + o.total, 0);
    const byMethod = methods.slice(1).map(m => ({
        label: m,
        value: all.filter(o => o.paymentMethod === m).reduce((s, o) => s + o.total, 0),
    }));

    root.innerHTML = `
        ${kpiStrip([
        { value: money(store.revenueOf(all)), label: 'Collected (demo)', delta: `${all.length} paid orders`, primary: true },
        { value: money(store.revenueOf(store.todayOrders(all))), label: 'Collected Today', delta: 'demo session' },
        { value: num(all.filter(o => o.paymentStatus === 'Pending').length), label: 'Pending Payment', delta: 'unsettled' },
        { value: money(Math.round(store.revenueOf(all) / Math.max(1, all.length))), label: 'Average Ticket', delta: 'paid orders only' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Transactions', `
                    <div class="demo-toolbar">
                        ${searchBar('paySearch', 'Search order or customer…', payUi.q)}
                        ${select('payMethod', methods, payUi.method, 'Filter by method')}
                        <button type="button" class="btn-secondary btn-small" id="btnPayCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                    </div>
                    ${table({
            columns: ['Order', 'Customer', 'Method', 'Amount', 'Status', 'Paid at'],
            rows: list.slice(0, 40).map(o => [
                `<b>#${esc(o.orderId)}</b>`,
                esc(o.customerName),
                badge(o.paymentMethod, 'info'),
                money(o.total),
                badge(o.paymentStatus),
                `<span class="text-muted-small">${esc(dateTimeOf(o.createdAt))}</span>`,
            ]),
            empty: 'No payments match this filter.',
        })}
                    <p class="text-muted-small mt-14">Showing ${Math.min(40, list.length)} of ${list.length} · ${money(total)}</p>`, '', { icon: 'wallet' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Split by method', rankBars(byMethod), '', { icon: 'pie-chart' })}
                ${panel('Settlement actions', `
                    <p class="text-muted-small mb-14">Payments in the demo are read-only. Charges, refunds and payouts always run inside the live, authenticated dashboard.</p>
                    ${restrictedBtn('Record payment', 'Payments move real money', { cls: 'btn-primary' })}
                    ${restrictedBtn('Issue refund', 'Refunds move real money')}
                    ${restrictedBtn('Connect payment provider', 'Payment credentials belong to the live account')}`, '', { icon: 'shield-alert' })}
            </div>
        </div>
        ${noteBar('Amounts come from demo orders and follow the same tax/service-charge maths as the live ERP. No payment provider is called.', 'warn')}`;

    root.querySelector('#paySearch')?.addEventListener('input', (e) => { payUi.q = e.target.value; ctx.rerender({ keepFocus: '#paySearch' }); });
    root.querySelector('#payMethod')?.addEventListener('change', (e) => { payUi.method = e.target.value; ctx.rerender(); });
    root.querySelector('#btnPayCsv')?.addEventListener('click', () => {
        downloadCsv('demo-payments.csv', ['Order', 'Customer', 'Method', 'Amount', 'Status', 'Created'],
            list.map(o => [o.orderId, o.customerName, o.paymentMethod, o.total, o.paymentStatus, o.createdAt]));
        toast('Payments CSV exported');
    });
}

// ------------------------------------------------------------------- Expenses

export function renderExpenses(root, ctx) {
    const d = store.getData();
    const total = d.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const pending = d.expenses.filter(e => e.status === 'Pending');
    const byCat = d.expenseCategories.map(c => ({
        label: c,
        value: d.expenses.filter(e => e.category === c).reduce((s, e) => s + Number(e.amount), 0),
    }));

    root.innerHTML = `
        ${kpiStrip([
        { value: money(total), label: 'Total Expenses', delta: 'demo ledger', primary: true },
        { value: money(pending.reduce((s, e) => s + Number(e.amount), 0)), label: 'Pending Approval', delta: `${pending.length} entries` },
        { value: num(d.expenses.length), label: 'Entries', delta: 'last 7 days' },
        { value: money(Math.round(total / Math.max(1, d.expenses.length))), label: 'Avg Entry', delta: 'per voucher' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Expense ledger', `
                    <div class="demo-toolbar">
                        <button type="button" class="btn-primary btn-small" id="btnExpenseAdd"><i data-lucide="plus" class="icon-14"></i> Add expense (demo)</button>
                        <button type="button" class="btn-secondary btn-small" id="btnExpenseCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                        ${restrictedBtn('Attach receipt', 'Receipts upload to the live storage bucket')}
                    </div>
                    <div id="expenseFormHost"></div>
                    ${table({
            columns: ['Date', 'Category', 'Vendor', 'Method', 'Amount', 'Status', 'Actions'],
            rows: d.expenses.map(e => [
                esc(e.date),
                esc(e.category),
                `<b>${esc(e.vendor)}</b><br><span class="text-muted-small">${esc(e.note)}</span>`,
                esc(e.method),
                money(e.amount),
                badge(e.status),
                `<div class="demo-row-gap">
                    ${e.status === 'Pending' ? `<button type="button" class="btn-text-primary-sm" data-exp-approve="${esc(e.id)}">Approve</button>` : ''}
                    <button type="button" class="btn-text-primary-sm" data-exp-del="${esc(e.id)}">Delete</button>
                 </div>`,
            ]),
            empty: 'No demo expenses recorded.',
        })}`, '', { icon: 'dollar-sign' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('By category', rankBars(byCat), '', { icon: 'pie-chart' })}
                ${panel('Financial controls', `
                    <p class="text-muted-small mb-14">Vouchers added here are demo-only. Approving spending, exporting to accounting or paying a vendor happens in the live dashboard.</p>
                    ${restrictedBtn('Push to accounting', 'Accounting sync uses live credentials', { cls: 'btn-primary' })}
                    ${restrictedBtn('Pay vendor', 'Vendor payments move real money')}`, '', { icon: 'shield-alert' })}
            </div>
        </div>
        ${noteBar('Add, approve and delete below are simulated on demo state only.', 'info')}`;

    root.querySelector('#btnExpenseAdd')?.addEventListener('click', () => {
        const host = root.querySelector('#expenseFormHost');
        if (host.dataset.open === '1') { host.innerHTML = ''; host.dataset.open = '0'; return; }
        host.dataset.open = '1';
        host.innerHTML = `<div class="demo-form-panel">
            <div class="demo-form-grid">
                ${field('Vendor', input('expVendor', '', { placeholder: 'e.g. Dairyline Foods' }))}
                ${field('Category', select('expCat', d.expenseCategories, d.expenseCategories[0], 'Category'))}
                ${field('Amount (₹)', input('expAmount', '', { type: 'number', attrs: 'min="0" step="1"' }))}
                ${field('Method', select('expMethod', ['Cash', 'UPI', 'Card', 'Netbanking', 'Bank'], 'UPI', 'Method'))}
            </div>
            <div class="demo-row-gap mt-14">
                <button type="button" class="btn-primary btn-small" id="btnExpenseSave">Save (demo)</button>
                <button type="button" class="btn-secondary btn-small" id="btnExpenseCancel">Cancel</button>
            </div>
        </div>`;
        host.querySelector('#btnExpenseCancel')?.addEventListener('click', () => { host.innerHTML = ''; host.dataset.open = '0'; });
        host.querySelector('#btnExpenseSave')?.addEventListener('click', () => {
            const vendor = host.querySelector('#expVendor').value.trim();
            const amount = Number(host.querySelector('#expAmount').value);
            if (!vendor || !(amount > 0)) { toast('Enter a vendor and an amount above zero', 'error'); return; }
            store.addExpense({
                vendor,
                category: host.querySelector('#expCat').value,
                amount,
                method: host.querySelector('#expMethod').value,
            });
            toast('Expense added to demo ledger');
            ctx.rerender();
        });
    });
    root.querySelectorAll('[data-exp-approve]').forEach(b => b.addEventListener('click', () => {
        store.setExpenseStatus(b.getAttribute('data-exp-approve'), 'Approved');
        toast('Approved in demo state');
        ctx.rerender();
    }));
    root.querySelectorAll('[data-exp-del]').forEach(b => b.addEventListener('click', () => {
        store.deleteExpense(b.getAttribute('data-exp-del'));
        toast('Expense removed from demo ledger', 'info');
        ctx.rerender();
    }));
    root.querySelector('#btnExpenseCsv')?.addEventListener('click', () => {
        downloadCsv('demo-expenses.csv', ['Date', 'Category', 'Vendor', 'Method', 'Amount', 'Status', 'Note'],
            d.expenses.map(e => [e.date, e.category, e.vendor, e.method, e.amount, e.status, e.note]));
        toast('Expenses CSV exported');
    });
}

// ---------------------------------------------------------------------- Costs

export function renderCosts(root, ctx) {
    const d = store.getData();
    const ci = computeCostIndex(
        Object.fromEntries(d.orders.map(o => [o.orderId, o])),
        d.billing.rates,
        d.billing.mode,
    );
    const rates = d.billing.rates;
    const orderCount = ci.count;

    root.innerHTML = `
        ${kpiStrip([
        { value: money(ci.total), label: 'Usage Cost (demo)', delta: `${orderCount} billable orders`, primary: true },
        { value: money(Math.round(ci.total / Math.max(1, orderCount))), label: 'Avg per Order', delta: 'blended' },
        { value: money(d.billing.setup.amount), label: 'One-time Setup', delta: d.billing.setup.status.replace('_', ' ') },
        { value: d.billing.plan, label: 'Plan', delta: d.billing.mode === 'commission_1pct' ? '1% commission mode' : 'per-order mode' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Charge breakdown by channel', table({
        columns: ['Channel', 'Rate', 'Orders', 'Amount'],
        rows: [
            ['QR table ordering', money(rates.QR), num(ci.bySource.QR?.orders || 0), money(ci.bySource.QR?.cost || 0)],
            ['POS / walk-in', money(rates.POS), num(ci.bySource.POS?.orders || 0), money(ci.bySource.POS?.cost || 0)],
            ['WhatsApp orders', money(rates.WA), num(ci.bySource.WA?.orders || 0), money(ci.bySource.WA?.cost || 0)],
            ['Delivery web menu', money(rates.webview_delivery), num(ci.bySource.webview_delivery?.orders || 0), money(ci.bySource.webview_delivery?.cost || 0)],
            ['Other', money(rates.other), num(ci.bySource.other?.orders || 0), money(ci.bySource.other?.cost || 0)],
        ],
    }), '', { icon: 'calculator' })}
                ${panel('Billing history', table({
        columns: ['Date', 'Type', 'Amount', 'Method', 'Note'],
        rows: [
            ...d.billing.payments.map(p => [esc(p.date), badge('Payment', 'ok'), money(p.amount), esc(p.method), esc(p.note)]),
            ...d.billing.charges.map(c => [esc(c.date), badge('Charge', 'warn'), money(c.amount), '—', esc(c.note)]),
        ],
    }), restrictedBtn('Download invoice', 'Invoices are issued by the live billing service'), { icon: 'receipt' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Costs by channel', rankBars(['QR', 'POS', 'WA', 'webview_delivery', 'other'].map(k => ({
        label: k === 'webview_delivery' ? 'Web menu' : k,
        value: ci.bySource[k]?.cost || 0,
    }))), '', { icon: 'bar-chart-3' })}
                ${panel('Billing controls', `
                    <p class="text-muted-small mb-14">Rates shown are demo values calculated with <code>shared/cost-math.js</code>. Changing a rate or paying an invoice is restricted.</p>
                    ${restrictedBtn('Change plan', 'Plan changes alter live billing', { cls: 'btn-primary' })}
                    ${restrictedBtn('Pay invoice', 'Invoice payment moves real money')}
                    ${restrictedBtn('Top up promo tokens', 'Promo tokens are paid messaging credits')}`, '', { icon: 'shield-alert' })}
            </div>
        </div>
        ${noteBar('Cancelled and refunded orders are never billed — that exclusion comes from the shared cost module, not the demo.', 'info')}`;
}

// ----------------------------------------------------------------- Promotions

const promoUi = { draft: '', shell: 'promo_hinglish_offer', audience: 'All customers' };

export function renderPromotions(root, ctx) {
    const d = store.getData();
    const shells = [
        { value: 'proactive_promo', label: 'Special Offer (English)' },
        { value: 'promo_hinglish_offer', label: 'Hinglish — Offer' },
        { value: 'promo_hinglish_discount', label: 'Hinglish — Discount' },
        { value: 'promo_hinglish_festive', label: 'Hinglish — Festive' },
        { value: 'promo_hinglish_winback', label: 'Hinglish — Win-back' },
    ];

    root.innerHTML = `
        ${kpiStrip([
        { value: num(d.promotions.length), label: 'Campaigns', delta: `${d.promotions.filter(p => p.status === 'Sent').length} sent`, primary: true },
        { value: num(d.promotions.reduce((s, p) => s + p.recipients, 0)), label: 'Audience Reached', delta: 'demo campaign log' },
        { value: num(d.promotions.reduce((s, p) => s + p.delivered, 0)), label: 'Delivered', delta: 'demo metrics' },
        { value: num(d.bot.wallet.balance), label: 'Promo Tokens', delta: 'not spendable in demo' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Campaigns', table({
        columns: ['Campaign', 'Channel', 'Audience', 'Status', 'Recipients', 'Delivered', 'Template', 'Actions'],
        rows: d.promotions.map(p => [
            `<b>${esc(p.name)}</b><br><span class="text-muted-small">${esc(p.message.slice(0, 60))}…</span>`,
            esc(p.channel),
            esc(p.audience),
            badge(p.status),
            num(p.recipients || 0),
            num(p.delivered || 0),
            `<span class="text-muted-small">${esc(p.shell)}</span>`,
            `<div class="demo-row-gap">
                ${restrictedBtn('Send now', 'Promotional sending is disabled in the demo and on Baileys transport')}
                ${restrictedBtn('Duplicate', 'Cloning a campaign writes to the live promotions node')}
             </div>`,
        ]),
        empty: 'No campaigns yet.',
    }) + `<p class="text-muted-small mt-14">Scheduled: ${esc(d.promotions.find(p => p.status === 'Scheduled')?.sentAt || '—')}</p>`, '', { icon: 'megaphone' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Compose (preview only)', `
                    ${field('Audience', select('promoAudience', ['All customers', 'Idle 30+ days', 'Dessert lovers', 'Gold tier'], promoUi.audience, 'Audience'))}
                    ${field('Message template', select('promoShell', shells, promoUi.shell, 'Template'))}
                    ${field('Message', textarea('promoDraft', promoUi.draft, { rows: 4, placeholder: 'Ek message likhein… (preview only)' }), 'One {{1}} variable is filled by the bot at send time.')}
                    <div class="demo-row-gap mt-14">
                        <button type="button" class="btn-secondary btn-small" id="btnPromoPreview">Preview</button>
                        ${restrictedBtn('Test send to me', 'Test sends consume a real paid template message', { cls: 'btn-primary' })}
                    </div>
                    <div id="promoPreviewHost" class="mt-14"></div>`, '', { icon: 'edit-3' })}
            </div>
        </div>
        ${noteBar('Campaign metrics shown are synthetic. Promotional sending is hard-blocked on the Baileys transport in the live bot as well — this demo never sends anything.', 'warn')}`;

    ['promoAudience', 'promoShell'].forEach(id => root.querySelector(`#${id}`)?.addEventListener('change', (e) => {
        if (id === 'promoAudience') promoUi.audience = e.target.value; else promoUi.shell = e.target.value;
    }));
    root.querySelector('#promoDraft')?.addEventListener('input', (e) => { promoUi.draft = e.target.value; });
    root.querySelector('#btnPromoPreview')?.addEventListener('click', () => {
        const host = root.querySelector('#promoPreviewHost');
        host.innerHTML = `<div class="demo-preview-bubble">
            <span class="demo-preview-bubble__head">WhatsApp preview · ${esc(promoUi.shell)}</span>
            <p>${esc(promoUi.draft || '(empty message)')}</p>
            <span class="demo-preview-bubble__foot">To: ${esc(promoUi.audience)} · not sent</span>
        </div>`;
    });
}

// ------------------------------------------------------------------ Discounts

export function renderDiscounts(root, ctx) {
    const d = store.getData();
    const active = d.discounts.filter(x => x.active);

    root.innerHTML = `
        ${kpiStrip([
        { value: num(active.length), label: 'Active Coupons', delta: `${d.discounts.length} total`, primary: true },
        { value: num(d.discounts.reduce((s, x) => s + x.uses, 0)), label: 'Redemptions', delta: 'demo usage log' },
        { value: num(d.discounts.reduce((s, x) => s + x.cap, 0)), label: 'Total Cap', delta: 'redemption limit' },
        { value: money(d.orders.filter(o => o.discount).reduce((s, o) => s + o.discount, 0)), label: 'Discount Given', delta: 'on demo orders' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Discount codes', `
                    <div class="demo-toolbar">
                        <button type="button" class="btn-primary btn-small" id="btnDiscountAdd"><i data-lucide="plus" class="icon-14"></i> New coupon (demo)</button>
                        ${restrictedBtn('Publish to menu', 'Publishing writes the coupon to the live customer app')}
                    </div>
                    <div id="discountFormHost"></div>
                    ${table({
            columns: ['Code', 'Type', 'Value', 'Channels', 'Min order', 'Used / Cap', 'Window', 'Active'],
            rows: d.discounts.map(x => [
                `<b>${esc(x.code)}</b>`,
                esc(x.type === 'percent' ? 'Percent' : 'Flat'),
                x.type === 'percent' ? `${x.value}%` : money(x.value),
                esc(x.channel),
                x.minOrder ? money(x.minOrder) : '—',
                `${num(x.uses)} / ${num(x.cap)}<br>${progress(x.uses, x.cap, x.uses / x.cap > 0.8 ? 'warn' : 'ok')}`,
                esc(x.window),
                `<label class="demo-inline-toggle"><input type="checkbox" data-discount-toggle="${esc(x.id)}" ${x.active ? 'checked' : ''} aria-label="Toggle ${esc(x.code)}"><span></span></label>`,
            ]),
            empty: 'No coupons defined.',
        })}`, '', { icon: 'percent' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Redemptions by code', rankBars(d.discounts.map(x => ({ label: x.code, value: x.uses })), { valueFmt: (v) => `${v} uses` }), '', { icon: 'tag' })}
                ${panel('Policy notes', `
                    <div class="demo-kv">
                        <span>Stacking</span><b>Managed by shared/discount-rules.js</b>
                        <span>Approval > ceiling</span><b>${d.settings.features.discountApproval ? 'Required' : 'Off'}</b>
                        <span>Happy hour</span><b>15:00 – 18:00 (HAPPYHOUR)</b>
                    </div>
                    ${noteBar('Toggling a coupon here is simulated. The live evaluator (<code>shared/discount-rules.js</code>) and the QR menu are untouched.', 'info')}`, '', { icon: 'shield' })}
            </div>
        </div>`;

    root.querySelectorAll('[data-discount-toggle]').forEach(cb => cb.addEventListener('change', () => {
        store.toggleDiscount(cb.getAttribute('data-discount-toggle'));
        toast('Coupon state updated in demo', 'info');
        ctx.rerender();
    }));
    root.querySelector('#btnDiscountAdd')?.addEventListener('click', () => {
        const host = root.querySelector('#discountFormHost');
        if (host.dataset.open === '1') { host.innerHTML = ''; host.dataset.open = '0'; return; }
        host.dataset.open = '1';
        host.innerHTML = `<div class="demo-form-panel">
            <div class="demo-form-grid">
                ${field('Coupon code', input('newDiscCode', '', { placeholder: 'e.g. WEEKEND15' }))}
                ${field('Type', select('newDiscType', [{ value: 'percent', label: 'Percent' }, { value: 'flat', label: 'Flat ₹' }], 'percent', 'Type'))}
                ${field('Value', input('newDiscValue', '', { type: 'number', attrs: 'min="0"' }))}
                ${field('Min order (₹)', input('newDiscMin', '0', { type: 'number', attrs: 'min="0"' }))}
                ${field('Cap (uses)', input('newDiscCap', '100', { type: 'number', attrs: 'min="1"' }))}
                ${field('Channels', select('newDiscChannel', ['All channels', 'Delivery', 'Dine-in', 'Takeaway'], 'All channels', 'Channels'))}
            </div>
            <div class="demo-row-gap mt-14">
                <button type="button" class="btn-primary btn-small" id="btnDiscountSave">Create (demo)</button>
                <button type="button" class="btn-secondary btn-small" id="btnDiscountCancel">Cancel</button>
            </div>
        </div>`;
        host.querySelector('#btnDiscountCancel')?.addEventListener('click', () => { host.innerHTML = ''; host.dataset.open = '0'; });
        host.querySelector('#btnDiscountSave')?.addEventListener('click', () => {
            const code = host.querySelector('#newDiscCode').value.trim().toUpperCase();
            const value = Number(host.querySelector('#newDiscValue').value);
            if (!code || !(value > 0)) { toast('Enter a code and a value above zero', 'error'); return; }
            store.addDiscount({
                code,
                type: host.querySelector('#newDiscType').value,
                value,
                minOrder: Number(host.querySelector('#newDiscMin').value) || 0,
                cap: Number(host.querySelector('#newDiscCap').value) || 100,
                channel: host.querySelector('#newDiscChannel').value,
            });
            toast(`Coupon ${code} created in demo`);
            ctx.rerender();
        });
    });
}
