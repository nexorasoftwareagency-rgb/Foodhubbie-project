/**
 * Demo pages — People group: Riders, Customers, Loyalty, WhatsApp, Feedback.
 *
 * Browsing, searching and filtering are fully interactive (Category A).
 * Anything that would message a person, move money or change an account is
 * restricted (Category D) — the pages stay open and readable.
 */

import {
    money, num, esc, badge, statusBadge, kpiStrip, panel, sectionTitle, table,
    emptyState, searchBar, select, tabs, progress, drawerShell, field, input,
    restrictedBtn, noteBar, simulatedTag, toast, refreshedIcons, dateTimeOf,
} from './ui-kit.js';
import * as store from './store.js';
import { downloadCsv, closeDrawer } from './pages-operations.js';

// ---------------------------------------------------------------------- Riders

const riderUi = { q: '', status: 'All' };

export function renderRiders(root, ctx) {
    const d = store.getData();
    const q = riderUi.q.trim().toLowerCase();
    const statuses = ['All', 'Online', 'On delivery', 'Offline'];
    const list = d.riders.filter(r => (riderUi.status === 'All' || r.status === riderUi.status)
        && (!q || `${r.name} ${r.zone} ${r.phone}`.toLowerCase().includes(q)));
    const active = d.riders.filter(r => r.status !== 'Offline');

    root.innerHTML = `
        ${kpiStrip([
        { value: `${active.length}/${d.riders.length}`, label: 'Riders Available', delta: 'live demo roster', primary: true },
        { value: num(d.riders.reduce((s, r) => s + r.deliveries, 0)), label: 'Deliveries Today', delta: 'completed in demo' },
        { value: money(d.riders.reduce((s, r) => s + r.wallet, 0)), label: 'Wallet Balance', delta: 'unsettled earnings' },
        { value: (d.riders.reduce((s, r) => s + r.rating, 0) / d.riders.length).toFixed(1) + ' ★', label: 'Average Rating', delta: 'customer feedback' },
    ])}
        ${panel('Delivery riders', `
            <div class="demo-toolbar">
                ${searchBar('riderSearch', 'Search rider, zone or phone…', riderUi.q)}
                ${select('riderStatus', statuses, riderUi.status, 'Filter by status')}
                ${restrictedBtn('Add rider', 'Rider accounts are created in the live dashboard')}
                ${restrictedBtn('Settle wallets', 'Wallet settlement moves real money')}
            </div>
            ${table({
        columns: ['Rider', 'Status', 'Zone', 'Vehicle', 'Deliveries', 'Rating', 'Wallet', 'Actions'],
        rows: list.map(r => [
            `<b>${esc(r.name)}</b><br><span class="text-muted-small">${esc(r.phone)}</span>`,
            badge(r.status),
            esc(r.zone),
            `<span class="text-muted-small">${esc(r.vehicle)}</span>`,
            num(r.deliveries),
            `${r.rating} ★`,
            money(r.wallet),
            `<button type="button" class="btn-text-primary-sm" data-rider-view="${esc(r.id)}">View</button>`,
        ]),
        empty: 'No riders match this filter.',
    })}`, '', { icon: 'bike' })}
        ${noteBar('Rider wallets, password resets, account edits and settlements are all held back in demo mode.', 'info')}`;

    root.querySelector('#riderSearch')?.addEventListener('input', (e) => { riderUi.q = e.target.value; ctx.rerender({ keepFocus: '#riderSearch' }); });
    root.querySelector('#riderStatus')?.addEventListener('change', (e) => { riderUi.status = e.target.value; ctx.rerender(); });
    root.querySelectorAll('[data-rider-view]').forEach(b => b.addEventListener('click', () => {
        const r = d.riders.find(x => x.id === b.getAttribute('data-rider-view'));
        const trips = d.orders.filter(o => o.riderId === r.id);
        const body = `<div class="demo-stack">
            <div class="demo-kv">
                <span>Status</span><b>${badge(r.status)}</b>
                <span>Zone</span><b>${esc(r.zone)}</b>
                <span>Vehicle</span><b>${esc(r.vehicle)}</b>
                <span>Phone</span><b>${esc(r.phone)}</b>
                <span>Wallet</span><b>${money(r.wallet)}</b>
            </div>
            ${trips.length ? table({
            columns: ['Order', 'Customer', 'Total', 'Status'],
            rows: trips.map(o => [`<b>#${esc(o.orderId)}</b>`, esc(o.customerName), money(o.total), statusBadge(o.status)]),
        }) : emptyState('bike', 'No trips in demo data', 'This rider has no assigned demo orders.')}
        </div>`;
        document.body.insertAdjacentHTML('beforeend', drawerShell('demoRiderDrawer', r.name, body,
            restrictedBtn('Reset password', 'Password resets affect the live account') + restrictedBtn('Edit rider', 'Rider records belong to the live dashboard')));
        const drawer = document.getElementById('demoRiderDrawer');
        drawer.classList.add('is-open');
        drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });
        refreshedIcons();
    }));
}

// ------------------------------------------------------------------- Customers

const custUi = { q: '' };

export function renderCustomers(root, ctx) {
    const d = store.getData();
    const q = custUi.q.trim().toLowerCase();
    const list = d.customers.filter(c => !q || `${c.name} ${c.phone} ${c.tier}`.toLowerCase().includes(q));

    root.innerHTML = `
        ${kpiStrip([
        { value: num(d.customers.length), label: 'Customers', delta: 'demo CRM', primary: true },
        { value: money(d.customers.reduce((s, c) => s + c.spend, 0)), label: 'Lifetime Spend', delta: 'across demo orders' },
        { value: num(d.customers.reduce((s, c) => s + c.orders, 0)), label: 'Total Orders', delta: 'all channels' },
        { value: num(d.customers.filter(c => c.tier === 'Gold').length), label: 'Gold Tier', delta: 'loyalty programme' },
    ])}
        ${panel('Customer records', `
            <div class="demo-toolbar">
                ${searchBar('customerSearch', 'Search name, phone or tier…', custUi.q)}
                <button type="button" class="btn-secondary btn-small" id="btnCustCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                ${restrictedBtn('Export PDF', 'PDF export runs in the live app only')}
                ${restrictedBtn('Create customer', 'Customer records are written to the live database')}
            </div>
            ${table({
        columns: ['Customer', 'Phone', 'Tier', 'Orders', 'Spend', 'Points', 'Last order', 'Actions'],
        rows: list.map(c => [
            `<div class="demo-row-gap"><span class="demo-avatar">${esc(c.name.charAt(0))}</span><b>${esc(c.name)}</b></div>`,
            esc(c.phone),
            badge(c.tier, c.tier === 'Gold' ? 'warn' : c.tier === 'Silver' ? 'info' : 'muted'),
            num(c.orders),
            money(c.spend),
            num(c.points),
            esc(c.last),
            `<button type="button" class="btn-text-primary-sm" data-cust-view="${esc(c.id)}">Profile</button>`,
        ]),
        empty: 'No customers match this search.',
    })}`, '', { icon: 'users' })}
        ${noteBar('Phone numbers in this dataset are fictional. Nothing here maps to a real person.', 'warn')}`;

    root.querySelector('#customerSearch')?.addEventListener('input', (e) => { custUi.q = e.target.value; ctx.rerender({ keepFocus: '#customerSearch' }); });
    root.querySelector('#btnCustCsv')?.addEventListener('click', () => {
        downloadCsv('demo-customers.csv', ['Name', 'Phone', 'Tier', 'Orders', 'Spend', 'Points', 'Last order'],
            d.customers.map(c => [c.name, c.phone, c.tier, c.orders, c.spend, c.points, c.last]));
        toast('Customer CSV exported (demo data)');
    });
    root.querySelectorAll('[data-cust-view]').forEach(b => b.addEventListener('click', () => {
        const c = d.customers.find(x => x.id === b.getAttribute('data-cust-view'));
        const orders = d.orders.filter(o => o.phone === c.phone);
        const body = `<div class="demo-stack">
            <div class="demo-kv">
                <span>Tier</span><b>${badge(c.tier)}</b>
                <span>Phone</span><b>${esc(c.phone)}</b>
                <span>Lifetime spend</span><b>${money(c.spend)}</b>
                <span>Loyalty points</span><b>${num(c.points)}</b>
            </div>
            ${orders.length ? table({ columns: ['Order', 'When', 'Total', 'Status'], rows: orders.map(o => [`<b>#${esc(o.orderId)}</b>`, esc(dateTimeOf(o.createdAt)), money(o.total), statusBadge(o.status)]) })
            : emptyState('receipt', 'No recent demo orders', 'This customer has no orders inside the demo window.')}
        </div>`;
        document.body.insertAdjacentHTML('beforeend', drawerShell('demoCustomerDrawer', c.name, body,
            restrictedBtn('Message on WhatsApp', 'Sending WhatsApp messages is disabled in the demo') + restrictedBtn('Reset password', 'Account changes affect the live customer')));
        const drawer = document.getElementById('demoCustomerDrawer');
        drawer.classList.add('is-open');
        drawer.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) closeDrawer(); });
        refreshedIcons();
    }));
}

// -------------------------------------------------------------------- Loyalty

export function renderLoyalty(root, ctx) {
    const d = store.getData();
    const L = d.settings.loyalty;
    const members = d.customers.slice().sort((a, b) => b.points - a.points);

    root.innerHTML = `
        ${kpiStrip([
        { value: num(members.reduce((s, m) => s + m.points, 0)), label: 'Points Outstanding', delta: 'demo ledger', primary: true },
        { value: money(Math.round(members.reduce((s, m) => s + m.points, 0) * (L.redeemValuePaisePerPoint / 100))), label: 'Redemption Liability', delta: `${money(L.redeemValuePaisePerPoint / 100)} per point` },
        { value: `${L.earnRate * 100}%`, label: 'Earn Rate', delta: 'on net subtotal' },
        { value: num(members.filter(m => m.tier === 'Gold').length), label: 'Gold Members', delta: `${L.tiers[L.tiers.length - 1].min}+ points` },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Loyalty members', table({
        columns: ['Member', 'Tier', 'Points', 'Redeemable', 'Spend'],
        rows: members.map(m => [
            `<b>${esc(m.name)}</b><br><span class="text-muted-small">${esc(m.phone)}</span>`,
            badge(m.tier, m.tier === 'Gold' ? 'warn' : m.tier === 'Silver' ? 'info' : 'muted'),
            num(m.points),
            money(Math.round(m.points * (L.redeemValuePaisePerPoint / 100))),
            money(m.spend),
        ]),
    }), restrictedBtn('Adjust points', 'Point adjustments write to the live loyalty ledger'), { icon: 'award' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Programme settings', `
                    <div class="demo-kv">
                        <span>Earn rate</span><b>${L.earnRate * 100}% of net subtotal</b>
                        <span>Redeem value</span><b>${money(L.redeemValuePaisePerPoint / 100)} / point</b>
                        <span>Min spend after redemption</span><b>${money(L.minSpendAfterRedemption)}</b>
                        <span>Dine-in earning</span><b>${L.dineInEarnEnabled ? 'Enabled' : 'Disabled'}</b>
                        <span>Clawback on cancel</span><b>${L.clawbackEnabled ? 'Enabled' : 'Disabled'}</b>
                    </div>
                    <h4 class="mt-16 mb-8">Tiers</h4>
                    <div class="demo-list">${L.tiers.map(t => `
                        <div class="demo-list__row">
                            <div class="demo-list__main"><b>${esc(t.name)}</b><span class="text-muted-small">from ${t.min} points</span></div>
                            <div class="demo-list__value">${badge(t.name, t.name === 'Gold' ? 'warn' : t.name === 'Silver' ? 'info' : 'muted')}</div>
                        </div>`).join('')}</div>
                    <div class="mt-16">${restrictedBtn('Save loyalty settings', 'Saving settings changes the live programme', { cls: 'btn-primary' })}</div>`, '', { icon: 'settings' })}
            </div>
        </div>
        ${noteBar('Earning is calculated on <b>subtotal − discount</b>; tax, service charge and delivery fees never earn points. Settings above are read-only in the demo.', 'info')}`;
}

// --------------------------------------------------------------------- WhatsApp

const chatUi = { id: 'ch1', draft: '' };

export function renderChat(root, ctx) {
    const d = store.getData();
    const chat = d.chats.find(c => c.id === chatUi.id) || d.chats[0];

    root.innerHTML = `
        <div class="demo-split demo-split--chat">
            <aside class="demo-split__nav">
                ${panel('Conversations', `<ul class="demo-navlist">${d.chats.map(c => `
                    <li><button type="button" class="demo-navlist__btn demo-chatlist${c.id === chat.id ? ' is-active' : ''}" data-chat="${esc(c.id)}">
                        <span class="demo-avatar">${esc(c.name.charAt(0))}</span>
                        <span class="demo-chatlist__main"><b>${esc(c.name)}</b><span class="text-muted-small">${esc(c.messages[c.messages.length - 1].text.slice(0, 38))}…</span></span>
                        ${c.unread ? `<span class="demo-chip__count">${c.unread}</span>` : ''}
                    </button></li>`).join('')}</ul>`, restrictedBtn('Start new chat', 'Starting a chat sends a real WhatsApp message'), { icon: 'message-circle' })}
            </aside>
            <div class="demo-split__main">
                ${panel(`${chat.name} · ${chat.phone}`,
        `<div class="demo-chat" id="demoChatThread">
            ${chat.messages.map(m => `<div class="demo-chat__bubble" data-from="${esc(m.from)}">
                <p>${esc(m.text)}</p><span>${esc(m.at)}</span>
            </div>`).join('')}
        </div>
        <div class="demo-chat__composer">
            ${input('demoChatDraft', chatUi.draft, { placeholder: 'Write a reply… (sending is disabled in the demo)' })}
            <button type="button" class="btn-primary btn-small" data-demo-restricted="Sending WhatsApp messages">Send</button>
        </div>
        ${noteBar('This transcript is synthetic. The composer is wired to the demo restriction handler — it never contacts WhatsApp.', 'warn', 'shield-alert')}`,
        restrictedBtn('Open in WhatsApp', 'Opening WhatsApp would contact a real number'), { icon: 'message-circle' })}
            </div>
        </div>`;

    root.querySelectorAll('[data-chat]').forEach(b => b.addEventListener('click', () => { chatUi.id = b.getAttribute('data-chat'); ctx.rerender(); }));
    const thread = root.querySelector('#demoChatThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
}

// -------------------------------------------------------------------- Feedback

const fbUi = { rating: 'All' };

export function renderFeedback(root, ctx) {
    const d = store.getData();
    const ratings = ['All', '5', '4', '3', '2', '1'];
    const list = d.feedback.filter(f => fbUi.rating === 'All' || String(f.rating) === fbUi.rating);
    const avg = (d.feedback.reduce((s, f) => s + f.rating, 0) / d.feedback.length).toFixed(1);
    const dist = [5, 4, 3, 2, 1].map(r => ({ label: `${r} ★`, value: d.feedback.filter(f => f.rating === r).length }));

    root.innerHTML = `
        ${kpiStrip([
        { value: `${avg} ★`, label: 'Average Rating', delta: `${d.feedback.length} reviews`, primary: true },
        { value: num(d.feedback.filter(f => f.rating === 5).length), label: '5-Star Reviews', delta: 'happy guests' },
        { value: num(d.feedback.filter(f => f.rating <= 3).length), label: 'Needs Attention', delta: 'reply recommended' },
        { value: `${Math.round((d.feedback.filter(f => f.rating >= 4).length / d.feedback.length) * 100)}%`, label: 'Positive', delta: '4★ and above' },
    ])}
        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Customer reviews', `
                    ${tabs(ratings.map(r => ({ id: r, label: r === 'All' ? 'All ratings' : `${r} ★` })), fbUi.rating, 'demo-chip demo-chip--sm')}
                    <div class="demo-review-list">
                        ${list.length ? list.map(f => `
                            <article class="demo-review">
                                <div class="demo-row-between">
                                    <div><b>${esc(f.customer)}</b> <span class="text-muted-small">#${esc(f.orderId)}</span></div>
                                    <span class="demo-stars" aria-label="${f.rating} out of 5">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span>
                                </div>
                                <p>${esc(f.comment)}</p>
                                <div class="demo-row-between">
                                    <span class="text-muted-small">${esc(f.at)}</span>
                                    ${restrictedBtn('Reply', 'Replies are sent over the live WhatsApp channel', { cls: 'btn-secondary' })}
                                </div>
                            </article>`).join('') : emptyState('star', 'No reviews', 'No demo reviews with this rating.')}
                    </div>`, '', { icon: 'star' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Rating distribution', `<div class="demo-list">${dist.map(x => `
                    <div class="demo-list__row">
                        <div class="demo-list__main"><b>${esc(x.label)}</b></div>
                        <div class="demo-list__value">${progress(x.value, d.feedback.length, 'ok')} ${x.value}</div>
                    </div>`).join('')}</div>`, '', { icon: 'bar-chart-3' })}
            </div>
        </div>`;
    root.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { fbUi.rating = b.getAttribute('data-chip'); ctx.rerender(); }));
}
