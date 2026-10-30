/**
 * FoodHubbie ERP | SETUP CHECKLIST  (Admin/js/features/setup-checklist.js)
 *
 * Dashboard panel shown while the outlet is LOCKED ("setup mode").
 * It leads with the ONE step that unblocks go-live and links straight to the
 * control that performs it — no dead ends, no buttons that only open a paywall.
 *
 * Progress is DERIVED from data that already exists (store profile, categories,
 * dishes, tables, WhatsApp link, wallet, orders), so there is no new schema,
 * nothing to save, and it resumes correctly after refresh or re-login.
 * Read-only: it never writes.
 *
 * Locked-outlet WhatsApp connection is done by the FoodHubbie team (Supreme Admin),
 * so that step hands off to support instead of linking to a tab the owner cannot use.
 */
import { state } from '../state.js';
import { Outlet, get, query, limitToLast } from '../firebase.js';
import { canAccessTab, switchTab, supportWa } from '../ui.js';
import { computeWallet, MIN_TOPUP } from '../../shared/cost-math.js';

const PANEL_ID = 'setupChecklist';
const WALLET_AMOUNT = `\u20B9${MIN_TOPUP.toLocaleString('en-IN')}`;
const WA_CONNECTED = ['active', 'connected'];

async function exists(path) {
    try {
        const snap = await get(query(Outlet.ref(path), limitToLast(1)));
        return snap.exists();
    } catch (_) {
        return null; // unknown (offline / no permission) — never claim done or not done
    }
}

async function collectTasks() {
    const [storeSnap, hasCategories, hasDishes, hasTables, hasOrders, waSnap, billingSnap] = await Promise.all([
        get(Outlet.ref('settings/Store')).catch(() => null),
        exists('categories'),
        exists('dishes'),
        exists('tables'),
        exists('orders'),
        get(Outlet.ref('whatsapp/status')).catch(() => null),
        get(Outlet.ref('billing')).catch(() => null),
    ]);
    // A brand-new outlet simply has no Store node yet — that is "not done", not "unknown".
    // `null` is reserved for a read that actually failed.
    const store = storeSnap ? (storeSnap.exists() ? storeSnap.val() : {}) : null;
    const waStatus = waSnap && waSnap.exists() ? String(waSnap.val()) : '';
    // null = could not read billing (never claim done / not done)
    const topUpDone = billingSnap ? computeWallet({ billing: billingSnap.val() || {} }).topUpDone : null;
    const waConnected = waSnap ? WA_CONNECTED.includes(waStatus) : null;

    const tasks = [
        { id: 'profile', required: true, done: store ? !!(store.storeName && store.address) : null,
          title: 'Add your restaurant name and address',
          hint: 'Shown on bills and on your customer menu.',
          cta: { label: 'Open settings', tab: 'settings', subtab: 'general', focus: '#settingStoreName' } },

        { id: 'category', required: true, done: hasCategories,
          title: 'Create a menu category',
          hint: 'Every dish lives inside a category — start with one like "Pizza" or "Starters".',
          cta: { label: 'Add a category', tab: 'categories', open: '#btnAddCategory' } },

        { id: 'menu', required: true, done: hasDishes,
          title: 'Add your first dish',
          hint: 'Customers cannot order until your menu has at least one dish.',
          cta: { label: 'Add a dish', tab: 'menu', open: '#btnAddDishChoice' } },

        { id: 'tables', required: false, done: hasTables,
          title: 'Add tables for QR ordering',
          hint: 'Skip this if you only take delivery or takeaway orders.',
          cta: { label: 'Add a table', tab: 'tables', open: '[data-action="openAddTable"]' } },

        { id: 'whatsapp', required: false, done: waConnected,
          title: 'Connect WhatsApp ordering',
          hint: waConnected
              ? 'WhatsApp ordering is connected.'
              : waStatus === 'pending'
                  ? "We're setting up your WhatsApp number — we'll message you the moment it is ready."
                  : 'Optional. Our team connects WhatsApp for you so customers can order from a chat.',
          cta: waStatus === 'pending' || waConnected ? null : { label: 'Ask us to connect it', support: 'connect' } },

        { id: 'topup', required: true, done: topUpDone,
          title: `Add ${WALLET_AMOUNT} to your wallet`,
          hint: topUpDone
              ? "Payment received — we're switching your restaurant live now."
              : "This is your order balance, not a fee: it pays for the orders you take. Pay by UPI or bank transfer and we'll add it.",
          cta: { label: 'Contact us to top up', support: 'topup' },
          secondary: { label: 'See wallet', tab: 'costs' } },

        { id: 'order', required: false, done: hasOrders, needsLive: true,
          title: 'Take your first order',
          hint: hasOrders === true
              ? 'First order taken — you are ready for customers.'
              : 'Available once you are live — use Walk-in billing to bill a table.',
          cta: { label: 'Open billing', tab: 'walkin' } },
    ];
    return { tasks, outletLabel: (store && store.storeName) || 'my restaurant' };
}

// A step is actionable when it still needs doing AND this role can reach its target.
// `needsLive` steps (take your first order) stay disabled until the outlet is unlocked.
const canGo = (t) => t.done !== true && !(t.needsLive && state.locked) && !!t.cta
    && (!!t.cta.support || (!!t.cta.tab && canAccessTab(t.cta.tab)));

function openSupport(kind, outletLabel) {
    const text = kind === 'connect'
        ? `Hi FoodHubbie Team! I want to connect WhatsApp ordering for ${outletLabel}.`
        : `Hi FoodHubbie Team! I want to top up my wallet (minimum ${WALLET_AMOUNT}) for ${outletLabel} and go live.`;
    window.open(supportWa(text), '_blank', 'noopener');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(selector, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const el = document.querySelector(selector);
        if (el) return el;
        await sleep(100);
    }
    return null;
}

function flash(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { el.scrollIntoView(); }
    el.classList.add('setup-flash');
    setTimeout(() => el.classList.remove('setup-flash'), 2200);
}

// Deep-link: switch tab, land on the right subtab, then open or focus the exact control.
async function gotoStep(task, outletLabel) {
    const c = task.cta;
    if (!c) return;
    if (c.support) return openSupport(c.support, outletLabel);
    if (!c.tab || !canAccessTab(c.tab)) return;
    await switchTab(c.tab);
    if (c.subtab) {
        document.querySelector(`[data-subtab="${c.subtab}"]`)?.click();
        await sleep(120);
    }
    if (c.open) {
        const el = await waitFor(c.open);
        if (el) { flash(el); el.click(); }
    } else if (c.focus) {
        const el = await waitFor(c.focus);
        if (el) { flash(el); el.focus(); }
    }
}

function heroActions(task) {
    const out = [];
    if (canGo(task)) {
        out.push(`<button type="button" class="btn btn-primary btn-sm" data-setup-goto="${task.id}">${task.cta.label}</button>`);
    }
    const s = task.secondary;
    if (s && s.tab && canAccessTab(s.tab)) {
        out.push(`<button type="button" class="btn btn-secondary btn-sm" data-setup-goto="${task.id}" data-setup-secondary="1">${s.label}</button>`);
    }
    return out.join('');
}

function render(el, tasks, outletLabel) {
    const done = tasks.filter(t => t.done === true).length;
    // Only a REQUIRED step can be "the one thing blocking go-live". Optional steps stay in
    // the list but never take over the hero, otherwise "Everything is set up" and a
    // highlighted "next step" appear at the same time.
    const next = tasks.find(t => t.required && t.done === false) || null;
    const allRequiredDone = tasks.every(t => !t.required || t.done === true);
    // Goal met = full bar, even when optional extras are still open.
    const pct = allRequiredDone ? 100 : Math.round((done / tasks.length) * 100);
    const progressLabel = allRequiredDone && done < tasks.length
        ? 'All required steps done'
        : `${done} of ${tasks.length} done`;

    const hero = next
        ? `<div class="setup-hero">
               <div class="setup-hero__eyebrow">Next step</div>
               <div class="setup-hero__title">${next.title}</div>
               <p class="setup-hero__hint">${next.hint}</p>
               <div class="setup-hero__actions">${heroActions(next)}</div>
               ${canGo(next) ? '' : '<p class="setup-hero__blocked">Ask the restaurant owner to complete this step.</p>'}
           </div>`
        : allRequiredDone
            ? `<div class="setup-hero setup-hero--done">
                   <div class="setup-hero__title">Everything is set up</div>
                   <p class="setup-hero__hint">We're switching your restaurant live — this page unlocks on its own as soon as it's done.</p>
               </div>`
            : `<div class="setup-hero">
                   <div class="setup-hero__title">Some steps could not be checked</div>
                   <p class="setup-hero__hint">Your connection dropped while loading the checklist. Tap any step below, or refresh the page.</p>
               </div>`;

    const rows = tasks.map(t => {
        const mark = t.done === true ? 'done' : t.done === false ? 'todo' : 'unknown';
        const locked = t.needsLive === true && t.done !== true && state.locked;
        const tag = locked ? ' <span class="setup-step__tag">after go-live</span>'
            : (!t.required && t.done !== true) ? ' <span class="setup-step__tag">optional</span>'
                : '';
        const disabled = canGo(t) ? '' : ' disabled';
        const isNext = next && next.id === t.id ? ' aria-current="step"' : '';
        const cls = `setup-step${t.done === true ? ' is-done' : ''}${locked ? ' is-locked' : ''}`;
        return `<li><button type="button" class="${cls}" data-setup-goto="${t.id}"${disabled}${isNext}>
            <span class="setup-step__mark" data-state="${mark}" aria-hidden="true"></span>
            <span class="setup-step__body">
                <span class="setup-step__title">${t.title}${tag}</span>
                <span class="setup-step__hint">${t.hint}</span>
            </span>
        </button></li>`;
    }).join('');

    el.innerHTML = `
        ${hero}
        <div class="setup-progress">
            <span class="setup-progress__label">${progressLabel}</span>
            <span class="setup-progress__bar" role="progressbar" aria-label="Setup progress"
                  aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                <span class="setup-progress__fill" style="width:${pct}%"></span>
            </span>
        </div>
        <ul class="setup-steps">${rows}</ul>`;

    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
    el.querySelectorAll('[data-setup-goto]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const task = byId[btn.dataset.setupGoto];
            if (!task) return;
            if (e.currentTarget.dataset.setupSecondary && task.secondary) {
                const s = task.secondary;
                if (s.tab && canAccessTab(s.tab)) switchTab(s.tab);
                return;
            }
            gotoStep(task, outletLabel);
        });
    });
}

export async function loadSetupChecklist() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    // Setup mode only. On a live outlet the wallet alert owns balance messaging —
    // a "add ₹1,000" prompt on a restaurant that is already taking orders is wrong.
    if (!state.locked) { el.style.display = 'none'; return; }
    // Whoever can edit the menu sets the restaurant up; cashiers and waiters never see it.
    if (!canAccessTab('menu')) { el.style.display = 'none'; return; }
    try {
        const { tasks, outletLabel } = await collectTasks();
        render(el, tasks, outletLabel);
        el.style.display = '';
    } catch (e) {
        console.warn('[SetupChecklist] failed:', e);
        el.style.display = 'none';
    }
}
