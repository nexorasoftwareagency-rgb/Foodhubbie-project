/**
 * FoodHubbie Demo — application shell.
 *
 * Imports ONLY demo modules and pure shared modules. It never imports
 * Admin/js/firebase.js, never loads the Firebase SDK, and never calls the
 * bot-control API — that is the data-isolation boundary (asserted by
 * tools/check-demo-nav.cjs and exercised by tests/demo-e2e.mjs).
 */

import { NAV_GROUPS, DEMO_ONLY_PAGES, titleFor, iconFor, ALL_TABS } from './nav-config.js';
import { getData, resetDemo } from './store.js';
import { initRestrictDelegation } from './restrict.js';
import { esc, toast, noteBar, panel, restrictedBtn, refreshedIcons, money } from './ui-kit.js';
import {
    renderDashboard, renderOrders, renderKitchen, renderPos, renderTables,
} from './pages-operations.js';
import {
    renderMenu, renderCategories, renderCombos, renderMenuBrowser, renderInventory,
} from './pages-catalog.js';
import {
    renderRiders, renderCustomers, renderLoyalty, renderChat, renderFeedback,
} from './pages-people.js';
import {
    renderReports, renderRiderAnalytics, renderLiveTracker, renderNotifications,
    renderPayments, renderExpenses, renderCosts, renderPromotions, renderDiscounts,
} from './pages-insights.js';
import { renderSettings, renderPlatform } from './pages-system.js';

const ROUTES = {
    dashboard: renderDashboard,
    orders: renderOrders,
    live: renderKitchen,
    walkin: renderPos,
    tables: renderTables,
    promotions: renderPromotions,
    discounts: renderDiscounts,
    menu: renderMenu,
    categories: renderCategories,
    combos: renderCombos,
    'menu-browser': renderMenuBrowser,
    inventory: renderInventory,
    riders: renderRiders,
    customers: renderCustomers,
    loyalty: renderLoyalty,
    chat: renderChat,
    reports: renderReports,
    riderAnalytics: renderRiderAnalytics,
    feedback: renderFeedback,
    liveTracker: renderLiveTracker,
    notifications: renderNotifications,
    payments: renderPayments,
    expenses: renderExpenses,
    costs: renderCosts,
    install: renderInstall,
    settings: renderSettings,
    platform: renderPlatform,
};

const VALID = new Set([...ALL_TABS, ...DEMO_ONLY_PAGES.map(p => p.tab)]);

let currentTab = 'dashboard';

function tabFromHash() {
    // Hash only — URL query strings are deliberately ignored so no parameter can
    // select a tenant, outlet or business id.
    const raw = (location.hash || '').replace(/^#\/?/, '').trim();
    return VALID.has(raw) ? raw : 'dashboard';
}

function renderShell() {
    const nav = document.getElementById('demoSidebarNav');
    nav.innerHTML = NAV_GROUPS.map(group => `
        <div class="demo-nav-group">
            <span class="nav-group-label">${esc(group.label)}</span>
            <ul class="nav-list">
                ${group.items.map(item => `
                    <li class="${item.tab === currentTab ? 'active' : ''}${item.logout ? ' logout-item' : ''}">
                        <button type="button" class="nav-btn" data-nav="${esc(item.tab)}" title="${esc(item.title || item.label)}">
                            <i data-lucide="${esc(item.icon)}"></i><span>${esc(item.label)}</span>
                        </button>
                    </li>`).join('')}
            </ul>
        </div>`).join('');
}

function renderTopbar() {
    const title = titleFor(currentTab);
    const heading = document.getElementById('demoTabTitle');
    if (heading) heading.textContent = title;
    document.title = `${title} · FoodHubbie Demo`;
}

function paintClock() {
    const el = document.getElementById('demoClock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function go(tab, { replace = false } = {}) {
    if (!VALID.has(tab)) tab = 'dashboard';
    currentTab = tab;
    const hash = `#/${tab}`;
    if (location.hash !== hash) {
        if (replace) history.replaceState(null, '', hash);
        else history.pushState(null, '', hash);
    }
    closeMobileNav();
    paint();
}

function paint(opts = {}) {
    const root = document.getElementById('demoContent');
    renderShell();
    renderTopbar();
    renderSidebarState();

    const render = ROUTES[currentTab] || renderDashboard;
    try {
        render(root, { go, rerender: (o) => paint(o || {}) });
    } catch (err) {
        console.error('[demo] render failed', err);
        root.innerHTML = panel('Page unavailable',
            noteBar('This demo screen failed to render. Resetting demo data usually fixes it.', 'error', 'alert-triangle'),
            '<button type="button" class="btn-primary btn-small" id="btnDemoRecover">Reset demo data</button>',
            { icon: 'alert-triangle' });
        root.querySelector('#btnDemoRecover')?.addEventListener('click', () => { resetDemo(); paint(); });
    }
    refreshedIcons();

    if (opts.keepFocus) {
        const el = root.querySelector(opts.keepFocus);
        if (el) {
            el.focus();
            if (el.setSelectionRange && typeof el.value === 'string') {
                const end = el.value.length;
                el.setSelectionRange(end, end);
            }
        }
    }
    document.querySelector('.demo-main')?.scrollTo({ top: 0, behavior: 'instant' });
}

function renderSidebarState() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
        const active = btn.getAttribute('data-nav') === currentTab;
        btn.parentElement.classList.toggle('active', active);
        btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
}

function closeMobileNav() {
    document.body.classList.remove('demo-nav-open');
    document.getElementById('demoSidebarOverlay')?.classList.remove('is-open');
}

// ------------------------------------------------------------------- Install

function renderInstall(root) {
    root.innerHTML = `
        ${panel('Get the FoodHubbie app', `
            <p class="text-muted-small">The live dashboard installs as a Progressive Web App on Android, iOS and desktop, with push notifications for new orders.</p>
            <div class="demo-card-grid mt-16">
                <article class="demo-cat-card">
                    <h4 class="demo-cat-card__title"><i data-lucide="android" class="icon-16"></i> Android</h4>
                    <p class="text-muted-small">Open the dashboard in Chrome → menu → “Install app”.</p>
                </article>
                <article class="demo-cat-card">
                    <h4 class="demo-cat-card__title"><i data-lucide="apple" class="icon-16"></i> iOS</h4>
                    <p class="text-muted-small">Safari → Share → “Add to Home Screen”.</p>
                </article>
                <article class="demo-cat-card">
                    <h4 class="demo-cat-card__title"><i data-lucide="monitor" class="icon-16"></i> Desktop</h4>
                    <p class="text-muted-small">Chrome or Edge → install icon in the address bar.</p>
                </article>
            </div>
            <div class="mt-16 demo-row-gap">
                ${restrictedBtn('Install the live app', 'The demo is a public preview — installing targets the authenticated dashboard', { cls: 'btn-primary' })}
                ${restrictedBtn('Send install link', 'Sending a link uses the live messaging channel')}
            </div>`, '', { icon: 'download-cloud' })}
        ${noteBar('Your demo data lives only in this browser tab. There is no account, so there is nothing to install or sign in to.', 'info')}`;
}

// ---------------------------------------------------------------------- boot

function boot() {
    initRestrictDelegation();

    // Sidebar + topbar navigation
    document.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-nav]');
        if (!nav) return;
        const tab = nav.getAttribute('data-nav');
        if (tab === 'logout') {
            toast('Demo Mode — there is no signed-in account to sign out of', 'info');
            return;
        }
        go(tab);
    });

    document.getElementById('btnDemoReset')?.addEventListener('click', () => {
        resetDemo();
        go('dashboard');
        toast('Demo data restored to its initial state');
    });
    document.getElementById('btnDemoMenu')?.addEventListener('click', () => {
        document.body.classList.toggle('demo-nav-open');
        document.getElementById('demoSidebarOverlay')?.classList.toggle('is-open');
    });
    document.getElementById('demoSidebarOverlay')?.addEventListener('click', closeMobileNav);
    document.getElementById('btnDemoNavClose')?.addEventListener('click', closeMobileNav);

    window.addEventListener('hashchange', () => {
        const tab = tabFromHash();
        if (tab !== currentTab) { currentTab = tab; paint(); }
    });

    currentTab = tabFromHash();
    paint();
    paintClock();

    // Keep the "demo data" timestamp honest across long sessions.
    setInterval(paintClock, 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// Exposed for the E2E suite only — never used by app code.
window.__FOODHUBBIE_DEMO__ = {
    get data() { return getData(); },
    go,
    reset: resetDemo,
    tabs: [...VALID],
    outletTotal: () => money(getData().orders.reduce((s, o) => s + o.total, 0)),
};
