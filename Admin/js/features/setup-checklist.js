/**
 * FoodHubbie ERP | SETUP CHECKLIST  (Admin/js/features/setup-checklist.js)
 *
 * Dashboard panel that shows a new restaurant what is left to set up.
 * Progress is DERIVED from data that already exists (store profile, dishes,
 * tables, WhatsApp link, orders), so there is no new schema, nothing to save,
 * and it resumes correctly after refresh or re-login. Read-only: it never writes.
 */
import { state } from '../state.js';
import { Outlet, get, query, limitToLast } from '../firebase.js';
import { canAccessTab } from '../ui.js';

const PANEL_ID = 'setupChecklist';

async function exists(path) {
    try {
        const snap = await get(query(Outlet.ref(path), limitToLast(1)));
        return snap.exists();
    } catch (_) {
        return null; // unknown (offline / no permission) — never claim done or not done
    }
}

async function collectTasks() {
    const [storeSnap, hasDishes, hasTables, hasOrders, waSnap] = await Promise.all([
        get(Outlet.ref('settings/Store')).catch(() => null),
        exists('dishes'),
        exists('tables'),
        exists('orders'),
        get(Outlet.ref('whatsapp/status')).catch(() => null),
    ]);
    const store = storeSnap && storeSnap.exists() ? storeSnap.val() : null;
    const waStatus = waSnap && waSnap.exists() ? String(waSnap.val()) : '';

    const tasks = [];
    if (state.locked) {
        tasks.push({
            id: 'activation', required: true, done: false, tab: null,
            title: 'Activate your restaurant',
            hint: 'Your account is waiting for activation by the FoodHubbie team.',
        });
    }
    tasks.push(
        { id: 'profile', required: true, done: store ? !!(store.storeName && store.address) : null, tab: 'settings',
          title: 'Add restaurant name and address', hint: 'Shown on bills and your customer menu.' },
        { id: 'menu', required: true, done: hasDishes, tab: 'menu',
          title: 'Add your first menu item', hint: 'Customers cannot order until there is a dish.' },
        { id: 'tables', required: false, done: hasTables, tab: 'tables',
          title: 'Add tables for QR ordering', hint: 'Skip if you only do delivery or takeaway.' },
        { id: 'whatsapp', required: false, done: waSnap ? ['active', 'connected'].includes(waStatus) : null, tab: 'chat',
          title: 'Connect WhatsApp ordering', hint: 'Optional. Lets customers order on WhatsApp.' },
        { id: 'order', required: false, done: hasOrders, tab: 'walkin',
          title: 'Take your first order', hint: 'Use Walk-in billing to place a real order.' },
    );
    return tasks;
}

function render(el, tasks) {
    const known = tasks.filter(t => t.done !== null);
    const done = known.filter(t => t.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const next = tasks.find(t => t.done === false && t.required) || tasks.find(t => t.done === false);

    const rows = tasks.map(t => {
        const mark = t.done === true ? '✅' : t.done === false ? '⬜' : '⏳';
        const tag = t.required ? '' : ' <span class="text-muted-small">(optional)</span>';
        const canOpen = t.tab && t.done !== true && canAccessTab(t.tab);
        const btn = canOpen
            ? `<button type="button" class="btn-secondary btn-sm" data-action="switchTab" data-tab="${t.tab}">${next && next.id === t.id ? 'Do this next' : 'Open'}</button>`
            : '';
        return `<li style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border,rgba(128,128,128,.2))">
            <div><span aria-hidden="true">${mark}</span> <strong>${t.title}</strong>${tag}
            <div class="text-muted-small">${t.hint}</div></div>${btn}</li>`;
    }).join('');

    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="font-weight:700">Set up your restaurant</div>
            <div class="text-muted-small">${done} of ${tasks.length} done</div>
        </div>
        <div role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
             style="height:8px;border-radius:8px;background:rgba(128,128,128,.2);margin:10px 0 6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:#22c55e"></div>
        </div>
        <ul style="list-style:none;margin:0;padding:0">${rows}</ul>`;
}

export async function loadSetupChecklist() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    // Owners/managers only: staff roles without Settings access don't configure the restaurant.
    if (!canAccessTab('settings')) { el.style.display = 'none'; return; }
    try {
        const tasks = await collectTasks();
        // Hide once everything is confirmed done; keep visible while any status is unknown.
        if (tasks.every(t => t.done === true)) { el.style.display = 'none'; return; }
        render(el, tasks);
        el.style.display = '';
    } catch (e) {
        console.warn('[SetupChecklist] failed:', e);
        el.style.display = 'none';
    }
}
