/**
 * Demo pages — Operations group: Dashboard, Orders, Kitchen (KDS), POS, Tables.
 *
 * Everything renders from the in-memory demo store. Status changes, stock moves
 * and POS sales are simulated locally (Category C); printing, QR publishing,
 * WhatsApp sends and refunds are restricted (Category D).
 */

import {
    money, num, esc, timeOf, dateTimeOf, minutesAgo, badge, statusBadge, typeBadge,
    kpiStrip, panel, sectionTitle, table, emptyState, searchBar, select, tabs,
    barChart, rankBars, progress, drawerShell, field, input, restrictedBtn, noteBar,
    simulatedTag, toast, refreshedIcons,
} from './ui-kit.js';
import { restrict } from './restrict.js';
import * as store from './store.js';
import { computeOrderTotals } from '../../shared/money-math.js';
import { toCsvMatrix, guardSpreadsheetCell } from '../../shared/report-export.js';

// ---------------------------------------------------------------- shared bits

export function downloadCsv(filename, columns, rows) {
    const matrix = toCsvMatrix(columns, rows.map(r => r.map(guardSpreadsheetCell)));
    const blob = new Blob(['\uFEFF' + matrix], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function moneyRows(order) {
    const rows = [
        ['Subtotal', money(order.subtotal)],
        ['Discount', order.discount ? `− ${money(order.discount)}` : '—'],
        ['Taxable value', money(order.taxable ?? order.subtotal)],
        ...(order.taxItems || []).map(t => [`${t.name || 'Tax'} @ ${t.rate}%`, money(t.amount)]),
    ];
    if (order.serviceCharge) rows.push(['Service charge (5%)', money(order.serviceCharge)]);
    if (order.deliveryFee) rows.push(['Delivery fee', money(order.deliveryFee)]);
    return rows;
}

export function openOrderDrawer(orderId, onDone) {
    const order = store.getData().orders.find(o => o.id === orderId || o.orderId === orderId);
    if (!order) return;
    const items = (order.items || []).map(it => `<tr>
        <td>${esc(it.name)}</td>
        <td style="text-align:center">${it.qty}</td>
        <td style="text-align:right">${money(it.price)}</td>
        <td style="text-align:right">${money(it.price * it.qty)}</td>
    </tr>`).join('');

    const canAdvance = !['Delivered', 'Served', 'Cancelled'].includes(order.status);
    const body = `
        <div class="demo-stack">
            <div class="demo-row-between">
                <div>
                    <div class="demo-strong">#${esc(order.orderId)}</div>
                    <div class="text-muted-small">${esc(dateTimeOf(order.createdAt))} · ${minutesAgo(order.createdAt, store.getData().now)}</div>
                </div>
                <div class="demo-row-gap">${typeBadge(order.type)}${statusBadge(order.status)}</div>
            </div>
            <div class="demo-kv">
                <span>Customer</span><b>${esc(order.customerName)}</b>
                <span>Phone</span><b>${order.phone ? esc(order.phone) : '—'}</b>
                ${order.tableId ? `<span>Table</span><b>${esc(order.tableId)}</b>` : ''}
                ${order.riderName ? `<span>Rider</span><b>${esc(order.riderName)}</b>` : ''}
                ${order.address ? `<span>Address</span><b>${esc(order.address)}</b>` : ''}
                <span>Payment</span><b>${esc(order.paymentMethod)} · ${esc(order.paymentStatus)}</b>
                ${order.discountCode ? `<span>Coupon</span><b>${esc(order.discountCode)}</b>` : ''}
            </div>
            <div class="table-responsive">
                <table class="premium-table-v4 demo-table">
                    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead>
                    <tbody>${items}</tbody>
                </table>
            </div>
            <div class="demo-totals">
                ${moneyRows(order).map(([k, v]) => `<div class="demo-totals__row"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}
                <div class="demo-totals__row demo-totals__row--grand"><span>Total</span><b>${money(order.total)}</b></div>
            </div>
            ${order.note ? noteBar(esc(order.note), 'warn', 'message-square') : ''}
            ${simulatedTag('Status and payment buttons below only change demo data')}
        </div>`;

    const actions = `
        ${canAdvance ? `<button type="button" class="btn-primary btn-small" data-order-advance="${esc(order.id)}"><i data-lucide="arrow-right-circle" class="icon-14"></i> Advance status (simulated)</button>` : ''}
        ${order.paymentStatus !== 'Paid' && order.status !== 'Cancelled' ? `<button type="button" class="btn-secondary btn-small" data-order-paid="${esc(order.id)}"><i data-lucide="banknote" class="icon-14"></i> Mark paid (simulated)</button>` : ''}
        ${restrictedBtn('Print receipt', 'Receipt printing uses the live print bridge')}
        ${order.status !== 'Cancelled' ? `<button type="button" class="btn-secondary btn-small" data-order-cancel="${esc(order.id)}"><i data-lucide="x-circle" class="icon-14"></i> Cancel (simulated)</button>` : ''}
    `;

    closeDrawer();
    document.body.insertAdjacentHTML('beforeend', drawerShell('demoOrderDrawer', `Order #${order.orderId}`, body, actions));
    const drawer = document.getElementById('demoOrderDrawer');
    drawer.classList.add('is-open');
    document.body.classList.add('demo-drawer-open');
    refreshedIcons();

    drawer.addEventListener('click', (e) => {
        if (e.target.closest('[data-drawer-close]')) return closeDrawer();
        const adv = e.target.closest('[data-order-advance]');
        if (adv) {
            store.advanceOrder(adv.getAttribute('data-order-advance'));
            toast('Order status updated in demo state');
            closeDrawer();
            onDone && onDone();
            return;
        }
        const paid = e.target.closest('[data-order-paid]');
        if (paid) {
            store.markOrderPaid(paid.getAttribute('data-order-paid'));
            toast('Marked paid (demo only)');
            closeDrawer();
            onDone && onDone();
            return;
        }
        const cancel = e.target.closest('[data-order-cancel]');
        if (cancel) {
            store.setOrderStatus(cancel.getAttribute('data-order-cancel'), 'Cancelled');
            toast('Order cancelled in demo state', 'info');
            closeDrawer();
            onDone && onDone();
        }
    });
}

export function closeDrawer() {
    const d = document.getElementById('demoOrderDrawer');
    if (d) d.remove();
    document.getElementById('demoTableDrawer')?.remove();
    document.body.classList.remove('demo-drawer-open');
}

// ------------------------------------------------------------------ Dashboard

const ORDER_COLUMNS = [
    { label: 'Order' }, { label: 'Customer' }, { label: 'Type' }, { label: 'Items' },
    { label: 'Total', align: 'right' }, { label: 'Payment' }, { label: 'Status' }, { label: 'Placed' },
];

function orderRow(o) {
    return [
        `<b>#${esc(o.orderId)}</b>`,
        `<span>${esc(o.customerName)}</span><br><span class="text-muted-small">${esc(o.phone || '—')}</span>`,
        typeBadge(o.type),
        `${num((o.items || []).reduce((s, i) => s + i.qty, 0))} item(s)`,
        `<b>${money(o.total)}</b>`,
        `${badge(o.paymentStatus)}<br><span class="text-muted-small">${esc(o.paymentMethod)}</span>`,
        statusBadge(o.status),
        `<span class="text-muted-small">${esc(timeOf(o.createdAt))}</span>`,
    ];
}

function openOrdersTable(list, limit) {
    const rows = list.slice(0, limit).map(orderRow);
    return table({ columns: ORDER_COLUMNS, rows, empty: 'No orders in the demo dataset yet.' });
}

export function renderDashboard(root, ctx) {
    const d = store.getData();
    const k = store.kpis();
    const days = store.salesByDay(7);
    const priority = store.liveOrders().filter(o => ['Placed', 'Pending', 'Confirmed', 'Preparing'].includes(o.status));
    const delta = k.yesterdayRevenue
        ? `${k.revenue >= k.yesterdayRevenue ? '▲' : '▼'} ${Math.abs(Math.round(((k.revenue - k.yesterdayRevenue) / k.yesterdayRevenue) * 100))}% vs yesterday`
        : 'First day of demo data';

    root.innerHTML = `
        ${noteBar('This is a <b>live demo</b> of the FoodHubbie ERP running on synthetic data. Nothing you do here reaches a real restaurant, WhatsApp number or payment provider.', 'info', 'flask-conical')}
        ${kpiStrip([
            { value: money(k.revenue), label: "Today's Sales", delta, primary: true },
            { value: num(k.liveCount), label: 'Live Orders', delta: `${k.completedCount} completed today` },
            { value: num(k.inProgress), label: 'In Progress', delta: k.inProgress ? 'action required' : 'all clear' },
            { value: `${k.ridersOnline}/${k.ridersTotal}`, label: 'Riders Online', delta: `${money(k.avgOrder)} avg order` },
        ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Revenue — last 7 days', barChart(days.map(x => ({ label: x.label, value: x.revenue })), { ariaLabel: 'Revenue for the last seven days' }), '', { icon: 'bar-chart-3' })}
                <div class="mt-24">
                    ${panel('Priority orders (action required)',
        priority.length
            ? `<div class="demo-priority">${priority.map(o => `
                                <button type="button" class="demo-priority__item" data-open-order="${esc(o.id)}">
                                    <span class="demo-priority__dot" data-status="${esc(o.status)}"></span>
                                    <span class="demo-priority__main">
                                        <b>#${esc(o.orderId)}</b> · ${esc(o.customerName)}
                                        <span class="text-muted-small">${esc(o.items.map(i => `${i.qty}× ${i.name}`).join(', '))}</span>
                                    </span>
                                    <span class="demo-priority__meta">${statusBadge(o.status)}<span class="text-muted-small">${minutesAgo(o.createdAt, d.now)}</span></span>
                                </button>`).join('')}</div>`
            : emptyState('check-circle', 'No pending orders', 'Everything on the demo board is served.'),
        '<button type="button" class="btn-text-primary-sm" data-go="orders">View all</button>', { icon: 'alert-circle' })}
                </div>
                <div class="mt-24">
                    ${panel('Recent order history', openOrdersTable(d.orders, 8), '<button type="button" class="btn-text-primary-sm" data-go="orders">Open Orders</button>', { icon: 'history' })}
                </div>
            </div>
            <div class="dashboard-sidebar">
                ${panel('Top spenders', `<div class="demo-list">${store.topCustomers(5).map(c => `
                    <div class="demo-list__row">
                        <div class="demo-avatar">${esc(c.name.charAt(0))}</div>
                        <div class="demo-list__main"><b>${esc(c.name)}</b><span class="text-muted-small">${esc(c.phone)}</span></div>
                        <div class="demo-list__value">${money(c.spend)}<span class="text-muted-small">${c.orders} orders</span></div>
                    </div>`).join('')}</div>`, '', { icon: 'crown' })}
                ${panel('Top selling items', rankBars(store.topItems(5).map(i => ({ label: i.name, value: i.revenue })), { ariaLabel: 'Top selling items by revenue' }), '', { icon: 'trending-up' })}
                ${panel('Rider status', `<div class="demo-list">${d.riders.map(r => `
                    <div class="demo-list__row">
                        <div class="demo-avatar">${esc(r.name.charAt(0))}</div>
                        <div class="demo-list__main"><b>${esc(r.name)}</b><span class="text-muted-small">${esc(r.zone)} · ${esc(r.vehicle)}</span></div>
                        <div class="demo-list__value">${badge(r.status)}<span class="text-muted-small">${money(r.wallet)} wallet</span></div>
                    </div>`).join('')}</div>`, '', { icon: 'bike' })}
                ${store.lowStock().length ? panel('Low stock alerts', `<div class="demo-list">${store.lowStock().map(i => `
                    <div class="demo-list__row">
                        <div class="demo-list__main"><b>${esc(i.name)}</b><span class="text-muted-small">min ${i.min} ${esc(i.unit)}</span></div>
                        <div class="demo-list__value"><b>${i.stock}</b> ${esc(i.unit)}</div>
                    </div>`).join('')}</div>`, '<button type="button" class="btn-text-primary-sm" data-go="inventory">Inventory</button>', { icon: 'package' }) : ''}
            </div>
        </div>`;

    root.querySelectorAll('[data-open-order]').forEach(btn => btn.addEventListener('click', () => {
        openOrderDrawer(btn.getAttribute('data-open-order'), () => ctx.rerender());
    }));
    root.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => ctx.go(btn.getAttribute('data-go'))));
}

// --------------------------------------------------------------------- Orders

const ordersUi = { q: '', status: 'All', page: 1, perPage: 8 };

export function renderOrders(root, ctx) {
    const all = store.getData().orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const statuses = ['All', 'Placed', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Served', 'Cancelled'];
    const counts = statuses.reduce((acc, s) => {
        acc[s] = s === 'All' ? all.length : all.filter(o => o.status === s).length;
        return acc;
    }, {});

    const q = ordersUi.q.trim().toLowerCase();
    const filtered = all.filter(o => {
        const okStatus = ordersUi.status === 'All' || o.status === ordersUi.status;
        const okQ = !q || [o.orderId, o.customerName, o.phone, o.paymentMethod].join(' ').toLowerCase().includes(q);
        return okStatus && okQ;
    });
    const pages = Math.max(1, Math.ceil(filtered.length / ordersUi.perPage));
    if (ordersUi.page > pages) ordersUi.page = pages;
    const slice = filtered.slice((ordersUi.page - 1) * ordersUi.perPage, ordersUi.page * ordersUi.perPage);

    root.innerHTML = `
        ${panel('Order management', `
            <div class="demo-toolbar">
                ${searchBar('demoOrderSearch', 'Search order #, customer, phone…', ordersUi.q)}
                ${select('demoOrderStatus', statuses.map(s => ({ value: s, label: `${s} (${counts[s]})` })), ordersUi.status, 'Filter by status')}
                <button type="button" class="btn-secondary btn-small" id="btnDemoOrdersCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                ${restrictedBtn('Send WhatsApp update', 'Sending WhatsApp messages is disabled in the demo')}
            </div>
            ${tabs(statuses.slice(0, 6).map(s => ({ id: s, label: s, count: counts[s] })), ordersUi.status, 'demo-chip demo-chip--sm')}
            ${table({
            columns: ORDER_COLUMNS.concat([{ label: 'Actions' }]),
            rows: slice.map(o => orderRow(o).concat([`<button type="button" class="btn-text-primary-sm" data-open-order="${esc(o.id)}">Open</button>`])),
            empty: 'No orders match this filter.',
        })}
            <div class="demo-pager">
                <span class="text-muted-small">${filtered.length} order(s) · page ${ordersUi.page} of ${pages}</span>
                <div class="demo-row-gap">
                    <button type="button" class="btn-secondary btn-small" id="btnOrdersPrev" ${ordersUi.page === 1 ? 'disabled' : ''}>Previous</button>
                    <button type="button" class="btn-secondary btn-small" id="btnOrdersNext" ${ordersUi.page === pages ? 'disabled' : ''}>Next</button>
                </div>
            </div>`, '', { icon: 'shopping-cart' })}
        ${noteBar('Order history, filters, search and the order drawer are fully interactive. Changes stay in demo memory and reset with <b>Reset demo data</b>.', 'info')}`;

    const search = root.querySelector('#demoOrderSearch');
    search?.addEventListener('input', (e) => { ordersUi.q = e.target.value; ordersUi.page = 1; ctx.rerender({ keepFocus: '#demoOrderSearch' }); });
    root.querySelector('#demoOrderStatus')?.addEventListener('change', (e) => { ordersUi.status = e.target.value; ordersUi.page = 1; ctx.rerender(); });
    root.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { ordersUi.status = b.getAttribute('data-chip'); ordersUi.page = 1; ctx.rerender(); }));
    root.querySelector('#btnOrdersPrev')?.addEventListener('click', () => { ordersUi.page = Math.max(1, ordersUi.page - 1); ctx.rerender(); });
    root.querySelector('#btnOrdersNext')?.addEventListener('click', () => { ordersUi.page = Math.min(pages, ordersUi.page + 1); ctx.rerender(); });
    root.querySelectorAll('[data-open-order]').forEach(b => b.addEventListener('click', () => openOrderDrawer(b.getAttribute('data-open-order'), () => ctx.rerender())));
    root.querySelector('#btnDemoOrdersCsv')?.addEventListener('click', () => {
        downloadCsv(`demo-orders-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Order', 'Type', 'Status', 'Payment', 'Customer', 'Phone', 'Subtotal', 'Discount', 'Tax', 'Total', 'Placed'],
            all.map(o => [o.orderId, o.type, o.status, o.paymentMethod, o.customerName, o.phone, o.subtotal, o.discount, o.tax, o.total, o.createdAt]));
        toast('CSV exported from demo data');
    });
}

// -------------------------------------------------------------------- Kitchen

const KDS_COLUMNS = [
    { id: 'incoming', label: 'New', statuses: ['Placed', 'Pending', 'Confirmed'] },
    { id: 'preparing', label: 'Preparing', statuses: ['Preparing'] },
    { id: 'ready', label: 'Ready to serve', statuses: ['Cooked', 'Ready'] },
    { id: 'out', label: 'On the way', statuses: ['Out for Delivery', 'Reached Drop Location'] },
];

export function renderKitchen(root, ctx) {
    const live = store.liveOrders();
    const elapsed = (o) => minutesAgo(o.createdAt, store.getData().now);

    root.innerHTML = `
        <div class="demo-row-between mb-16">
            ${sectionTitle('Kitchen Display System', 'chef-hat')}
            <div class="demo-row-gap">${simulatedTag('Advancing tickets is simulated')}
                <button type="button" class="btn-secondary btn-small" id="btnKdsRefresh"><i data-lucide="refresh-cw" class="icon-14"></i> Refresh</button>
                ${restrictedBtn('Print KOT', 'Kitchen printers belong to the live restaurant')}
            </div>
        </div>
        <div class="demo-kds">
            ${KDS_COLUMNS.map(col => {
        const items = live.filter(o => col.statuses.includes(o.status));
        return `<section class="demo-kds__col">
                    <header class="demo-kds__head">
                        <span class="demo-kds__title">${esc(col.label)}</span>
                        <span class="demo-kds__count">${items.length}</span>
                    </header>
                    <div class="demo-kds__body">
                        ${items.length ? items.map(o => `
                            <article class="demo-kds__card">
                                <div class="demo-row-between">
                                    <b>#${esc(o.orderId)}</b>
                                    <span class="demo-badge" data-tone="${o.type === 'delivery' ? 'ok' : 'info'}">${esc(o.type === 'dine-in' ? (o.tableId || 'Dine-in') : o.type === 'delivery' ? 'Delivery' : 'Takeaway')}</span>
                                </div>
                                <div class="text-muted-small">${esc(o.customerName)} · ${esc(elapsed(o))}</div>
                                <ul class="demo-kds__items">${o.items.map(i => `<li>${i.qty}× ${esc(i.name)}</li>`).join('')}</ul>
                                <div class="demo-row-between">
                                    <span class="text-muted-small">${money(o.total)}</span>
                                    <button type="button" class="btn-primary btn-small" data-kds-advance="${esc(o.id)}">${['Ready', 'Cooked'].includes(o.status) ? 'Serve / dispatch' : 'Advance'}</button>
                                </div>
                            </article>`).join('') : `<p class="text-muted-small demo-kds__empty">Column clear</p>`}
                    </div>
                </section>`;
    }).join('')}
        </div>
        ${noteBar('KDS tickets come from the same demo orders as the Orders screen — advancing here updates them everywhere in the demo (and nowhere else).', 'info')}`;

    root.querySelectorAll('[data-kds-advance]').forEach(b => b.addEventListener('click', () => {
        store.advanceOrder(b.getAttribute('data-kds-advance'));
        toast('Ticket advanced (demo)');
        ctx.rerender();
    }));
    root.querySelector('#btnKdsRefresh')?.addEventListener('click', () => { ctx.rerender(); toast('Refreshed demo tickets', 'info'); });
}

// ------------------------------------------------------------------------ POS

const posUi = { cart: [], q: '', category: 'All', payment: 'Cash' };

function posCartTotals() {
    const d = store.getData();
    const lines = posUi.cart.map(c => ({ ...c, price: d.dishes[c.id].price }));
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    return {
        lines,
        ...computeOrderTotals({
            subtotal,
            taxRates: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
            serviceChargeEnabled: false,
        }),
    };
}

export function renderPos(root, ctx) {
    const d = store.getData();
    const dishes = Object.values(d.dishes);
    const categories = ['All', ...d.categories.map(c => c.name)];
    const q = posUi.q.trim().toLowerCase();
    const list = dishes.filter(x => (posUi.category === 'All' || x.category === posUi.category)
        && (!q || `${x.name} ${x.category}`.toLowerCase().includes(q)));
    const totals = posCartTotals();

    root.innerHTML = `
        <div class="demo-pos">
            <div class="demo-pos__menu">
                ${panel('Point of sale', `
                    <div class="demo-toolbar">${searchBar('posSearch', 'Search the demo menu…', posUi.q)}</div>
                    ${tabs(categories.map(c => ({ id: c, label: c })), posUi.category, 'demo-chip demo-chip--sm')}
                    <div class="demo-dish-grid">
                        ${list.map(x => `
                            <button type="button" class="demo-dish" data-pos-add="${esc(x.id)}" ${x.available ? '' : 'disabled aria-disabled="true"'}>
                                <span class="demo-dish__name">${esc(x.name)}</span>
                                <span class="demo-dish__meta">${esc(x.category)} · ${x.veg ? 'Veg' : 'Non-veg'}</span>
                                <span class="demo-dish__price">${money(x.price)}</span>
                                ${x.available ? '' : '<span class="demo-dish__off">Out of stock</span>'}
                            </button>`).join('')}
                    </div>`, '', { icon: 'monitor' })}
            </div>
            <aside class="demo-pos__cart">
                ${panel('Current sale', totals.lines.length ? `
                    <div class="demo-cart">
                        ${totals.lines.map(l => `
                            <div class="demo-cart__row">
                                <div class="demo-cart__main"><b>${esc(l.name)}</b><span class="text-muted-small">${money(l.price)} each</span></div>
                                <div class="demo-cart__qty">
                                    <button type="button" class="demo-icon-btn" data-pos-minus="${esc(l.id)}" aria-label="Decrease">−</button>
                                    <span>${l.qty}</span>
                                    <button type="button" class="demo-icon-btn" data-pos-plus="${esc(l.id)}" aria-label="Increase">+</button>
                                </div>
                                <b class="demo-cart__amt">${money(l.price * l.qty)}</b>
                            </div>`).join('')}
                    </div>
                    <div class="demo-totals">
                        <div class="demo-totals__row"><span>Subtotal</span><b>${money(totals.subtotal)}</b></div>
                        <div class="demo-totals__row"><span>CGST 2.5%</span><b>${money(totals.taxItems[0]?.amount || 0)}</b></div>
                        <div class="demo-totals__row"><span>SGST 2.5%</span><b>${money(totals.taxItems[1]?.amount || 0)}</b></div>
                        <div class="demo-totals__row demo-totals__row--grand"><span>Total</span><b>${money(totals.total)}</b></div>
                    </div>
                    ${field('Payment method', select('posPayment', ['Cash', 'UPI', 'Card'], posUi.payment, 'Payment method'))}
                    <div class="demo-row-gap mt-14">
                        <button type="button" class="btn-primary" id="btnPosCheckout"><i data-lucide="check-circle" class="icon-16"></i> Complete sale (simulated)</button>
                        <button type="button" class="btn-secondary" id="btnPosClear">Clear</button>
                    </div>
                    ${restrictedBtn('Send receipt on WhatsApp', 'WhatsApp sending is disabled in the demo', { cls: 'btn-secondary' })}
                ` : emptyState('shopping-basket', 'Cart is empty', 'Pick items from the demo menu to build a sale.'), '', { icon: 'receipt' })}
                ${noteBar('Taxes use the real <code>shared/money-math.js</code>. The sale is added to demo Orders only.', 'info')}
            </aside>
        </div>`;

    const rerenderKeep = (sel) => ctx.rerender({ keepFocus: sel });
    root.querySelector('#posSearch')?.addEventListener('input', (e) => { posUi.q = e.target.value; rerenderKeep('#posSearch'); });
    root.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { posUi.category = b.getAttribute('data-chip'); ctx.rerender(); }));
    root.querySelectorAll('[data-pos-add]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-pos-add');
        const hit = posUi.cart.find(c => c.id === id);
        if (hit) hit.qty += 1; else posUi.cart.push({ id, qty: 1 });
        ctx.rerender();
    }));
    root.querySelectorAll('[data-pos-plus]').forEach(b => b.addEventListener('click', () => {
        const hit = posUi.cart.find(c => c.id === b.getAttribute('data-pos-plus'));
        if (hit) hit.qty += 1;
        ctx.rerender();
    }));
    root.querySelectorAll('[data-pos-minus]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-pos-minus');
        const hit = posUi.cart.find(c => c.id === id);
        if (hit) { hit.qty -= 1; if (hit.qty <= 0) posUi.cart = posUi.cart.filter(c => c.id !== id); }
        ctx.rerender();
    }));
    root.querySelector('#posPayment')?.addEventListener('change', (e) => { posUi.payment = e.target.value; });
    root.querySelector('#btnPosClear')?.addEventListener('click', () => { posUi.cart = []; ctx.rerender(); toast('Cart cleared', 'info'); });
    root.querySelector('#btnPosCheckout')?.addEventListener('click', () => {
        if (!posUi.cart.length) return;
        const now = new Date();
        const seq = String(store.getData().orders.length + 1).padStart(2, '0');
        const dk = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(2)}`;
        store.addOrder({
            id: `${dk}-${seq}`,
            orderId: `BN-${dk}-${seq}`,
            type: 'pos',
            source: 'POS',
            status: 'Served',
            paymentStatus: 'Paid',
            paymentMethod: posUi.payment,
            customerName: 'Walk-in guest',
            phone: '',
            address: '',
            tableId: null,
            sessionId: null,
            riderId: null,
            riderName: '',
            items: totals.lines.map(l => ({ id: l.id, name: l.name, qty: l.qty, price: l.price })),
            subtotal: totals.subtotal,
            discount: 0,
            discountCode: '',
            taxable: totals.taxable,
            taxItems: totals.taxItems,
            tax: totals.tax,
            serviceCharge: totals.serviceCharge,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            createdAt: now.toISOString(),
            note: 'Simulated POS sale (demo)',
        });
        posUi.cart = [];
        toast(`Sale of ${money(totals.total)} recorded in demo data`);
        ctx.rerender();
    });
}

// --------------------------------------------------------------------- Tables

export function renderTables(root, ctx) {
    const states = store.tableState();
    const d = store.getData();
    const occupied = states.filter(s => s.status !== 'available');
    const free = states.length - occupied.length;
    const dineRevenue = store.revenueOf(store.todayOrders().filter(o => o.type === 'dine-in' && store.isCompleted(o)));

    const card = (t) => `
        <button type="button" class="demo-table-card" data-table="${esc(t.id)}" data-state="${esc(t.status)}">
            <span class="demo-table-card__top">
                <b>${esc(t.label)}</b>
                ${badge(t.status === 'available' ? 'Free' : t.status === 'bill' ? 'Bill requested' : 'Occupied',
            t.status === 'available' ? 'ok' : t.status === 'bill' ? 'warn' : 'info')}
            </span>
            <span class="demo-table-card__meta">${t.seats} seats · ${esc(t.zone)}</span>
            ${t.session
            ? `<span class="demo-table-card__guest">${esc(t.session.guestName)}</span>
                   <span class="demo-table-card__meta">${t.orders.length} order(s) · ${t.session.openedMinsAgo}m open</span>
                   <span class="demo-table-card__total">${money(t.total)}</span>`
            : `<span class="demo-table-card__empty">Tap to open a session</span>`}
        </button>`;

    root.innerHTML = `
        ${kpiStrip([
        { value: `${occupied.length}/${states.length}`, label: 'Tables Occupied', delta: `${free} free`, primary: true },
        { value: num(occupied.filter(t => t.status === 'bill').length), label: 'Bills Requested', delta: 'waiting to settle' },
        { value: money(occupied.reduce((s, t) => s + t.total, 0)), label: 'Open Table Value', delta: 'unsettled (demo)' },
        { value: money(dineRevenue), label: 'Dine-in Sales Today', delta: 'completed only' },
    ])}
        ${panel('Floor plan', `<div class="demo-table-grid">${states.map(card).join('')}</div>`,
        `<button type="button" class="btn-secondary btn-small" id="btnTableAdd"><i data-lucide="plus" class="icon-14"></i> Add table</button>`, { icon: 'layout-grid' })}
        ${noteBar('Opening a session, requesting a bill and settling a table all run against demo state. Publishing a real QR code or printing a bill is restricted.', 'info')}`;

    root.querySelectorAll('[data-table]').forEach(b => b.addEventListener('click', () => openTableDrawer(b.getAttribute('data-table'), () => ctx.rerender())));
    root.querySelector('#btnTableAdd')?.addEventListener('click', () => {
        const id = `T${d.tables.length + 1}`;
        d.tables.push({ id, label: `Table ${d.tables.length + 1}`, seats: 4, zone: 'Main' });
        store.commit();
        toast(`Table ${id} added to demo floor plan`);
        ctx.rerender();
    });
}

function openTableDrawer(tableId, onDone) {
    const t = store.tableState().find(x => x.id === tableId);
    if (!t) return;
    const canSettle = t.session && (t.total > 0 || t.status === 'bill');

    const body = `
        <div class="demo-stack">
            <div class="demo-row-between">
                <div><div class="demo-strong">${esc(t.label)}</div><div class="text-muted-small">${t.seats} seats · ${esc(t.zone)}</div></div>
                ${badge(t.status === 'available' ? 'Free' : t.status === 'bill' ? 'Bill requested' : 'Occupied', t.status === 'available' ? 'ok' : t.status === 'bill' ? 'warn' : 'info')}
            </div>
            ${t.session ? `
                <div class="demo-kv">
                    <span>Guest</span><b>${esc(t.session.guestName)}</b>
                    <span>Phone</span><b>${t.session.phone ? esc(t.session.phone) : '— (walk-in)'}</b>
                    <span>Open for</span><b>${t.session.openedMinsAgo} minutes</b>
                    <span>Session total</span><b>${money(t.total)}</b>
                </div>
                ${t.orders.length ? table({
        columns: ['Order', 'Items', 'Total', 'Payment', 'Status'],
        rows: t.orders.map(o => [`<b>#${esc(o.orderId)}</b>`, o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(', '), money(o.total), badge(o.paymentStatus), statusBadge(o.status)]),
    }) : emptyState('receipt', 'No orders yet', 'Guest session is open but nothing ordered.')}
            ` : emptyState('armchair', 'Table is free', 'Open a new demo session to explore the dine-in flow.')}
            ${simulatedTag('Session changes are simulated')}
        </div>`;

    const actions = `
        ${!t.session ? `<button type="button" class="btn-primary btn-small" data-tbl-open="${esc(t.id)}">Open session (simulated)</button>` : ''}
        ${t.session && t.status !== 'bill' ? `<button type="button" class="btn-secondary btn-small" data-tbl-bill="${esc(t.id)}">Request bill (simulated)</button>` : ''}
        ${canSettle ? `<button type="button" class="btn-secondary btn-small" data-tbl-settle="${esc(t.id)}">Settle & free table (simulated)</button>` : ''}
        ${t.session ? `<button type="button" class="btn-secondary btn-small" data-tbl-close="${esc(t.id)}">Close session (simulated)</button>` : ''}
        ${restrictedBtn('View / publish QR', 'Publishing a table QR code changes the live menu link')}
        ${restrictedBtn('Print bill', 'Bill printing uses the live print bridge')}
    `;

    closeDrawer();
    document.body.insertAdjacentHTML('beforeend', drawerShell('demoTableDrawer', t.label, body, actions));
    const drawer = document.getElementById('demoTableDrawer');
    drawer.classList.add('is-open');
    document.body.classList.add('demo-drawer-open');
    refreshedIcons();

    drawer.addEventListener('click', (e) => {
        if (e.target.closest('[data-drawer-close]')) return closeDrawer();
        const open = e.target.closest('[data-tbl-open]');
        if (open) { store.seedTableSession(open.getAttribute('data-tbl-open')); closeDrawer(); onDone(); toast('Demo session opened'); return; }
        const bill = e.target.closest('[data-tbl-bill]');
        if (bill) { store.requestBill(bill.getAttribute('data-tbl-bill')); closeDrawer(); onDone(); toast('Bill requested (demo)'); return; }
        const settle = e.target.closest('[data-tbl-settle]');
        if (settle) { store.settleTable(settle.getAttribute('data-tbl-settle')); closeDrawer(); onDone(); toast('Table settled in demo data'); return; }
        const close = e.target.closest('[data-tbl-close]');
        if (close) { store.closeTableSession(close.getAttribute('data-tbl-close')); closeDrawer(); onDone(); toast('Session closed (demo)', 'info'); }
    });
}
