/**
 * Demo pages — Catalogue group: Menu, Categories, Combos, Menu Browser, Inventory.
 *
 * Editing dishes, categories, combos and stock is simulated against demo state
 * (Category C). Publishing, image uploads and supplier/compliance operations are
 * restricted (Category D).
 */

import {
    money, num, esc, badge, kpiStrip, panel, sectionTitle, table, emptyState,
    searchBar, select, tabs, rankBars, progress, field, input, textarea, toggle,
    restrictedBtn, noteBar, simulatedTag, toast,
} from './ui-kit.js';
import * as store from './store.js';
import { downloadCsv } from './pages-operations.js';

const menuUi = { q: '', category: 'All', addOpen: false, editId: null };

export function renderMenu(root, ctx) {
    const d = store.getData();
    const dishes = Object.values(d.dishes);
    const categories = ['All', ...d.categories.map(c => c.name)];
    const q = menuUi.q.trim().toLowerCase();
    const list = dishes.filter(x => (menuUi.category === 'All' || x.category === menuUi.category)
        && (!q || `${x.name} ${x.category} ${x.desc}`.toLowerCase().includes(q)));
    const editing = menuUi.editId ? d.dishes[menuUi.editId] : null;

    const addForm = `
        <div class="demo-form-panel">
            <div class="demo-form-grid">
                ${field('Dish name', input('newDishName', '', { placeholder: 'e.g. Marinara' }))}
                ${field('Category', select('newDishCat', d.categories.map(c => c.name), d.categories[0]?.name, 'Category'))}
                ${field('Price (₹)', input('newDishPrice', '', { type: 'number', attrs: 'min="0" step="1"' }))}
                ${field('Prep minutes', input('newDishPrep', '10', { type: 'number', attrs: 'min="1" step="1"' }))}
            </div>
            ${field('Description', textarea('newDishDesc', '', { rows: 2, placeholder: 'Shown on the QR menu' }))}
            <div class="demo-row-gap mt-14">
                <button type="button" class="btn-primary btn-small" id="btnNewDishSave"><i data-lucide="plus" class="icon-14"></i> Add dish (demo)</button>
                <button type="button" class="btn-secondary btn-small" id="btnNewDishCancel">Cancel</button>
            </div>
        </div>`;

    const editForm = editing ? `
        <div class="demo-form-panel">
            <h4 class="mb-14">Editing <b>${esc(editing.name)}</b> ${simulatedTag('demo edit')}</h4>
            <div class="demo-form-grid">
                ${field('Dish name', input('editDishName', editing.name))}
                ${field('Category', select('editDishCat', d.categories.map(c => c.name), editing.category, 'Category'))}
                ${field('Price (₹)', input('editDishPrice', editing.price, { type: 'number', attrs: 'min="0"' }))}
                ${field('Description', input('editDishDesc', editing.desc))}
            </div>
            <div class="demo-row-gap mt-14">
                <button type="button" class="btn-primary btn-small" id="btnEditDishSave">Save changes (demo)</button>
                <button type="button" class="btn-secondary btn-small" id="btnEditDishCancel">Cancel</button>
            </div>
        </div>` : '';

    root.innerHTML = `
        ${kpiStrip([
        { value: num(dishes.length), label: 'Dishes', delta: `${d.categories.length} categories`, primary: true },
        { value: num(dishes.filter(x => x.available).length), label: 'Live on Menu', delta: `${dishes.filter(x => !x.available).length} hidden` },
        { value: money(Math.round(dishes.reduce((s, x) => s + x.price, 0) / Math.max(1, dishes.length))), label: 'Average Price', delta: 'demo catalogue' },
        { value: num(dishes.filter(x => x.veg).length), label: 'Vegetarian', delta: `${dishes.filter(x => !x.veg).length} non-veg` },
    ])}
        ${panel('Menu catalogue', `
            <div class="demo-toolbar">
                ${searchBar('menuSearch', 'Search dishes…', menuUi.q)}
                ${select('menuCatFilter', categories, menuUi.category, 'Filter by category')}
                <button type="button" class="btn-primary btn-small" id="btnMenuAdd"><i data-lucide="plus" class="icon-14"></i> Add dish</button>
                <button type="button" class="btn-secondary btn-small" id="btnMenuCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                ${restrictedBtn('Upload dish photo', 'Menu images are stored in the live Firebase Storage bucket')}
            </div>
            ${tabs(categories.map(c => ({ id: c, label: c })), menuUi.category, 'demo-chip demo-chip--sm')}
            ${menuUi.addOpen ? addForm : ''}
            ${editForm}
            ${table({
        columns: ['Dish', 'Category', 'Price', 'Type', 'Prep', 'On menu', 'Actions'],
        rows: list.map(x => [
            `<b>${esc(x.name)}</b><br><span class="text-muted-small">${esc(x.desc)}</span>`,
            esc(x.category),
            money(x.price),
            x.veg ? badge('Veg', 'ok') : badge('Non-veg', 'bad'),
            `${x.prep} min`,
            `<label class="demo-inline-toggle"><input type="checkbox" data-dish-toggle="${esc(x.id)}" ${x.available ? 'checked' : ''} aria-label="Show ${esc(x.name)} on menu"><span></span></label>`,
            `<div class="demo-row-gap">
                <button type="button" class="btn-text-primary-sm" data-dish-edit="${esc(x.id)}">Edit</button>
                <button type="button" class="btn-text-primary-sm" data-dish-del="${esc(x.id)}">Delete</button>
             </div>`,
        ]),
        empty: 'No dishes match this filter.',
    })}`, '', { icon: 'utensils' })}
        ${noteBar('Dish edits, availability toggles and deletions are applied to demo state only — the live QR menu is untouched.', 'info')}`;

    root.querySelector('#menuSearch')?.addEventListener('input', (e) => { menuUi.q = e.target.value; ctx.rerender({ keepFocus: '#menuSearch' }); });
    root.querySelector('#menuCatFilter')?.addEventListener('change', (e) => { menuUi.category = e.target.value; ctx.rerender(); });
    root.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => { menuUi.category = b.getAttribute('data-chip'); ctx.rerender(); }));
    root.querySelector('#btnMenuAdd')?.addEventListener('click', () => { menuUi.addOpen = !menuUi.addOpen; menuUi.editId = null; ctx.rerender({ keepFocus: '#newDishName' }); });
    root.querySelector('#btnNewDishCancel')?.addEventListener('click', () => { menuUi.addOpen = false; ctx.rerender(); });
    root.querySelector('#btnNewDishSave')?.addEventListener('click', () => {
        const name = root.querySelector('#newDishName').value.trim();
        const price = Number(root.querySelector('#newDishPrice').value);
        if (!name || !(price > 0)) { toast('Enter a dish name and a price above zero', 'error'); return; }
        store.addDish({
            name,
            category: root.querySelector('#newDishCat').value,
            price,
            prep: Number(root.querySelector('#newDishPrep').value) || 10,
            desc: root.querySelector('#newDishDesc').value.trim(),
            veg: true,
        });
        menuUi.addOpen = false;
        toast(`"${name}" added to demo menu`);
        ctx.rerender();
    });
    root.querySelectorAll('[data-dish-toggle]').forEach(cb => cb.addEventListener('change', () => {
        store.setDishAvailable(cb.getAttribute('data-dish-toggle'), cb.checked);
        toast('Availability updated in demo state', 'info');
    }));
    root.querySelectorAll('[data-dish-edit]').forEach(b => b.addEventListener('click', () => {
        menuUi.editId = b.getAttribute('data-dish-edit'); menuUi.addOpen = false; ctx.rerender();
    }));
    root.querySelector('#btnEditDishCancel')?.addEventListener('click', () => { menuUi.editId = null; ctx.rerender(); });
    root.querySelector('#btnEditDishSave')?.addEventListener('click', () => {
        const dish = d.dishes[menuUi.editId];
        if (!dish) return;
        dish.name = root.querySelector('#editDishName').value.trim() || dish.name;
        dish.category = root.querySelector('#editDishCat').value;
        dish.price = Number(root.querySelector('#editDishPrice').value) || dish.price;
        dish.desc = root.querySelector('#editDishDesc').value.trim();
        store.commit();
        menuUi.editId = null;
        toast('Dish updated in demo state');
        ctx.rerender();
    });
    root.querySelectorAll('[data-dish-del]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-dish-del');
        const name = d.dishes[id]?.name || 'Dish';
        store.deleteDish(id);
        toast(`"${name}" removed from demo menu`, 'info');
        ctx.rerender();
    }));
    root.querySelector('#btnMenuCsv')?.addEventListener('click', () => {
        downloadCsv('demo-menu.csv', ['Dish', 'Category', 'Price', 'Type', 'Description'],
            dishes.map(x => [x.name, x.category, x.price, x.veg ? 'Veg' : 'Non-veg', x.desc]));
        toast('Menu CSV exported');
    });
}

// ----------------------------------------------------------------- Categories

const catUi = { name: '' };

export function renderCategories(root, ctx) {
    const d = store.getData();
    const dishes = Object.values(d.dishes);

    root.innerHTML = `
        ${panel('Menu categories', `
            <div class="demo-toolbar">
                ${input('newCatName', catUi.name, { placeholder: 'New category name' })}
                <button type="button" class="btn-primary btn-small" id="btnAddCategory"><i data-lucide="plus" class="icon-14"></i> Add category (demo)</button>
            </div>
            <div class="demo-card-grid">
                ${d.categories.map(c => {
        const count = dishes.filter(x => x.category === c.name).length;
        return `<article class="demo-cat-card">
                        <div class="demo-row-between">
                            <h4 class="demo-cat-card__title"><i data-lucide="${esc(c.icon || 'folder')}" class="icon-16"></i> ${esc(c.name)}</h4>
                            ${badge(c.visible ? 'Visible' : 'Hidden', c.visible ? 'ok' : 'muted')}
                        </div>
                        <p class="text-muted-small">${esc(c.desc)}</p>
                        <div class="demo-cat-card__meta">
                            <span>${count} dish(es)</span><span>Order #${c.order}</span>
                        </div>
                        <div class="demo-row-gap">
                            <button type="button" class="btn-text-primary-sm" data-cat-toggle="${esc(c.id)}">${c.visible ? 'Hide' : 'Show'}</button>
                            <button type="button" class="btn-text-primary-sm" data-cat-del="${esc(c.id)}">Delete</button>
                        </div>
                    </article>`;
    }).join('')}
            </div>`, '', { icon: 'folder-tree' })}
        ${noteBar('Categories added here live only in demo memory. The real catalogue is untouched.', 'info')}`;

    root.querySelector('#btnAddCategory')?.addEventListener('click', () => {
        const name = root.querySelector('#newCatName').value.trim();
        if (!name) { toast('Enter a category name', 'error'); return; }
        store.addCategory(name);
        toast(`Category "${name}" added (demo)`);
        ctx.rerender();
    });
    root.querySelectorAll('[data-cat-toggle]').forEach(b => b.addEventListener('click', () => {
        const c = d.categories.find(x => x.id === b.getAttribute('data-cat-toggle'));
        if (c) { c.visible = !c.visible; store.commit(); ctx.rerender(); }
    }));
    root.querySelectorAll('[data-cat-del]').forEach(b => b.addEventListener('click', () => {
        store.deleteCategory(b.getAttribute('data-cat-del'));
        toast('Category removed from demo', 'info');
        ctx.rerender();
    }));
}

// ---------------------------------------------------------------------- Combos

export function renderCombos(root, ctx) {
    const d = store.getData();
    root.innerHTML = `
        ${panel('Combo offers', `<div class="demo-card-grid">${d.combos.map(cb => {
        const items = cb.items.map(([id, qty]) => `${qty}× ${d.dishes[id]?.name || id}`).join(' · ');
        const save = Math.round(((cb.original - cb.price) / cb.original) * 100);
        return `<article class="demo-combo-card">
                    <div class="demo-row-between">
                        <h4>${esc(cb.name)}</h4>
                        ${badge(cb.active ? 'Active' : 'Disabled', cb.active ? 'ok' : 'muted')}
                    </div>
                    <p class="text-muted-small">${esc(items)}</p>
                    <div class="demo-combo-card__price">
                        <b>${money(cb.price)}</b><s>${money(cb.original)}</s><span class="demo-badge" data-tone="ok">${save}% off</span>
                    </div>
                    <div class="demo-cat-card__meta"><span>${cb.window}</span><span>${cb.redeemed}/${cb.cap} redeemed</span></div>
                    ${progress(cb.redeemed, cb.cap, cb.redeemed / cb.cap > 0.8 ? 'warn' : 'ok')}
                    <div class="demo-row-gap">
                        <button type="button" class="btn-text-primary-sm" data-combo-toggle="${esc(cb.id)}">${cb.active ? 'Disable' : 'Enable'}</button>
                        ${restrictedBtn('Edit & publish', 'Combo changes go to the live customer menu')}
                    </div>
                </article>`;
    }).join('')}</div>`, '', { icon: 'tag' })}
        ${noteBar('Enable/disable is simulated. Creating or publishing a combo is restricted so the live QR menu cannot change from the demo.', 'info')}`;

    root.querySelectorAll('[data-combo-toggle]').forEach(b => b.addEventListener('click', () => {
        const cb = d.combos.find(x => x.id === b.getAttribute('data-combo-toggle'));
        if (cb) { cb.active = !cb.active; store.commit(); ctx.rerender(); toast('Combo state updated (demo)', 'info'); }
    }));
}

// ---------------------------------------------------------------- Menu Browser

const browserUi = { category: 'Pizzas' };

export function renderMenuBrowser(root, ctx) {
    const d = store.getData();
    const cats = d.categories.map(c => c.name);
    const dishes = Object.values(d.dishes).filter(x => x.category === browserUi.category);
    const qrBase = 'https://demo.foodhubbie.example/menu?b=demo&o=demo';

    root.innerHTML = `
        <div class="demo-split">
            <aside class="demo-split__nav">
                ${panel('Categories', `<ul class="demo-navlist">${cats.map(c => `
                    <li><button type="button" class="demo-navlist__btn${c === browserUi.category ? ' is-active' : ''}" data-browser-cat="${esc(c)}">
                        <span>${esc(c)}</span><span class="demo-chip__count">${Object.values(d.dishes).filter(x => x.category === c).length}</span>
                    </button></li>`).join('')}</ul>`, '', { icon: 'folder-tree' })}
            </aside>
            <div class="demo-split__main">
                ${panel(`${browserUi.category} — quick setup`,
        `<div class="demo-card-grid">${dishes.map(x => `
                    <article class="demo-dish-card">
                        <div class="demo-row-between"><h4>${esc(x.name)}</h4>${x.veg ? badge('Veg', 'ok') : badge('Non-veg', 'bad')}</div>
                        <p class="text-muted-small">${esc(x.desc)}</p>
                        <div class="demo-row-between"><b>${money(x.price)}</b><span class="text-muted-small">${x.prep} min</span></div>
                        <button type="button" class="btn-secondary btn-small" data-browser-toggle="${esc(x.id)}">${x.available ? 'Hide from menu' : 'Add to menu'}</button>
                    </article>`).join('') || emptyState('utensils', 'No dishes', 'This demo category is empty.')}</div>`,
        '<button type="button" class="btn-text-primary-sm" data-go="menu">Open full menu</button>', { icon: 'layout-grid' })}
                ${panel('Customer menu link', `
                    <div class="demo-kv">
                        <span>Demo QR link</span><b>${esc(qrBase)}&table=T2</b>
                        <span>Status</span><b>${badge('Simulated', 'warn')}</b>
                    </div>
                    ${noteBar('This link is a label, not a working endpoint. Opening or regenerating a live QR link is restricted in the demo.', 'warn')}`, restrictedBtn('Publish QR link', 'Publishing QR links changes the live customer menu'), { icon: 'qr-code' })}
            </div>
        </div>`;

    root.querySelectorAll('[data-browser-cat]').forEach(b => b.addEventListener('click', () => { browserUi.category = b.getAttribute('data-browser-cat'); ctx.rerender(); }));
    root.querySelectorAll('[data-browser-toggle]').forEach(b => b.addEventListener('click', () => {
        const id = b.getAttribute('data-browser-toggle');
        const dish = d.dishes[id];
        if (dish) { store.setDishAvailable(id, !dish.available); toast('Demo menu updated', 'info'); ctx.rerender(); }
    }));
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => ctx.go(b.getAttribute('data-go'))));
}

// ------------------------------------------------------------------- Inventory

const invUi = { q: '', onlyLow: false };

export function renderInventory(root, ctx) {
    const d = store.getData();
    const q = invUi.q.trim().toLowerCase();
    const list = d.inventory.filter(i => (!invUi.onlyLow || Number(i.stock) <= Number(i.min))
        && (!q || `${i.name} ${i.supplier}`.toLowerCase().includes(q)));
    const stockValue = d.inventory.reduce((s, i) => s + Number(i.stock) * Number(i.cost), 0);

    root.innerHTML = `
        ${kpiStrip([
        { value: num(d.inventory.length), label: 'Tracked Items', delta: `${d.suppliers.length} suppliers`, primary: true },
        { value: num(store.lowStock().length), label: 'Low Stock', delta: store.lowStock().length ? 'reorder recommended' : 'all healthy' },
        { value: money(Math.round(stockValue)), label: 'Stock Value', delta: 'at cost price' },
        { value: num(d.purchases.length), label: 'Open Purchases', delta: `${d.purchases.filter(p => p.status !== 'Received').length} pending` },
    ])}
        ${panel('Stock levels', `
            <div class="demo-toolbar">
                ${searchBar('invSearch', 'Search items or suppliers…', invUi.q)}
                <label class="demo-check"><input type="checkbox" id="invOnlyLow" ${invUi.onlyLow ? 'checked' : ''}> Low stock only</label>
                <button type="button" class="btn-secondary btn-small" id="btnInvCsv"><i data-lucide="download" class="icon-14"></i> Export CSV</button>
                ${restrictedBtn('Import CSV', 'Bulk imports write to the live inventory records')}
            </div>
            ${table({
        columns: ['Item', 'Supplier', 'Stock', 'Level', 'Min', 'Unit cost', 'Actions'],
        rows: list.map(i => {
            const low = Number(i.stock) <= Number(i.min);
            return [
                `<b>${esc(i.name)}</b>${low ? ' ' + badge('Low', 'warn') : ''}`,
                esc(i.supplier),
                `<b>${i.stock}</b> ${esc(i.unit)}`,
                progress(i.stock, Math.max(Number(i.min) * 2, Number(i.stock)), low ? 'warn' : 'ok'),
                `${i.min} ${esc(i.unit)}`,
                money(i.cost),
                `<div class="demo-row-gap">
                    <button type="button" class="btn-secondary btn-small" data-inv-adj="${esc(i.id)}" data-delta="-1">−1</button>
                    <button type="button" class="btn-secondary btn-small" data-inv-adj="${esc(i.id)}" data-delta="1">+1</button>
                    <button type="button" class="btn-text-primary-sm" data-inv-history="${esc(i.name)}">History</button>
                 </div>`,
            ];
        }),
        empty: 'No inventory items match this filter.',
    })}`, '', { icon: 'package' })}

        <div class="dashboard-grid">
            <div class="dashboard-main">
                ${panel('Purchases', table({
        columns: ['Supplier', 'Date', 'Items', 'Amount', 'Status'],
        rows: d.purchases.map(p => [esc(p.supplier), esc(p.date), String(p.items), money(p.amount), badge(p.status)]),
    }), restrictedBtn('Record purchase', 'Purchases create payable records in the live ledger'), { icon: 'truck' })}
            </div>
            <div class="dashboard-sidebar">
                ${panel('Suppliers', `<div class="demo-list">${d.suppliers.map(s => `
                    <div class="demo-list__row">
                        <div class="demo-avatar">${esc(s.name.charAt(0))}</div>
                        <div class="demo-list__main"><b>${esc(s.name)}</b><span class="text-muted-small">${esc(s.terms)} · ${esc(s.contact)}</span></div>
                        <div class="demo-list__value">${s.outstanding ? money(s.outstanding) : badge('Settled', 'ok')}</div>
                    </div>`).join('')}</div>`, restrictedBtn('Add supplier', 'Suppliers are managed in the live books'), { icon: 'users' })}
            </div>
        </div>
        ${noteBar('Stock adjustments, stock history and CSV export are real demo features. Supplier and purchase operations are restricted.', 'info')}`;

    root.querySelector('#invSearch')?.addEventListener('input', (e) => { invUi.q = e.target.value; ctx.rerender({ keepFocus: '#invSearch' }); });
    root.querySelector('#invOnlyLow')?.addEventListener('change', (e) => { invUi.onlyLow = e.target.checked; ctx.rerender(); });
    root.querySelectorAll('[data-inv-adj]').forEach(b => b.addEventListener('click', () => {
        store.adjustStock(b.getAttribute('data-inv-adj'), Number(b.getAttribute('data-delta')));
        ctx.rerender();
    }));
    root.querySelectorAll('[data-inv-history]').forEach(b => b.addEventListener('click', () => {
        const name = b.getAttribute('data-inv-history');
        const moves = store.getData().stockMovements.filter(m => m.item === name);
        const body = moves.length
            ? table({ columns: ['When', 'Change', 'Reason'], rows: moves.map(m => [esc(m.at), `${m.delta > 0 ? '+' : ''}${m.delta}`, esc(m.reason)]) })
            : emptyState('history', 'No movements yet', 'Adjust stock to create a demo movement entry.');
        const host = root.querySelector('#invHistoryHost');
        if (host) { host.innerHTML = body; host.scrollIntoView({ block: 'nearest' }); }
    }));
    root.querySelector('#btnInvCsv')?.addEventListener('click', () => {
        downloadCsv('demo-inventory.csv', ['Item', 'Unit', 'Stock', 'Min', 'Unit cost', 'Supplier'],
            d.inventory.map(i => [i.name, i.unit, i.stock, i.min, i.cost, i.supplier]));
        toast('Inventory CSV exported');
    });

    const host = document.createElement('div');
    host.id = 'invHistoryHost';
    host.className = 'mt-24';
    root.appendChild(host);
}
