import { Outlet, db, ref, get, push, set } from '../firebase.js';
import { showToast, escapeHtml } from '../utils.js';
import { showConfirm } from '../ui-utils.js';
import { slugify } from '../../shared/menu-bank.js';

const BANK = (path) => ref(db, `menuBank/${path}`);

let _categories = [];
let _dishes = [];
let _cart = new Map(); // bank dish key -> bank dish

export function openMenuBankBrowser() {
    const overlay = document.createElement('div');
    overlay.id = 'menuBankOverlay';
    overlay.className = 'dynamic-modal-overlay';
    overlay.innerHTML = `
        <div class="dynamic-modal-box menubank-box">
            <div class="menubank-head">
                <h3 class="dynamic-modal-title">Menu Bank</h3>
                <button class="btn-close-bank" aria-label="Close">✕</button>
            </div>
            <input type="text" class="menubank-search" placeholder="Search dishes..." aria-label="Search menu bank">
            <div class="menubank-cats"></div>
            <div class="menubank-grid"></div>
            <div class="menubank-footer">
                <button class="btn-cancel">Cancel</button>
                <button class="btn-cart" disabled>View Cart (0)</button>
                <button class="btn-getmenu" disabled>Get Menu</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const grid = overlay.querySelector('.menubank-grid');
    const catsEl = overlay.querySelector('.menubank-cats');
    const searchEl = overlay.querySelector('.menubank-search');
    const cartBtn = overlay.querySelector('.btn-cart');
    const getBtn = overlay.querySelector('.btn-getmenu');
    let activeCat = '';

    const refresh = () => {
        const term = searchEl.value.trim().toLowerCase();
        const rows = Object.values(_dishes).filter(d => {
            const inCat = !activeCat || d.category === activeCat;
            const inTerm = !term || (d.name || '').toLowerCase().includes(term);
            return inCat && inTerm;
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        grid.innerHTML = rows.map(d => {
            const key = slugify(`${d.name}-${d.category || 'other'}`);
            const inCart = _cart.has(key);
            const sizeHints = d.sizes ? Object.keys(d.sizes).join(' / ') : null;
            const price = d.sizes ? Math.min(...Object.values(d.sizes)) : d.price;
            return `
                <div class="menubank-card">
                    <img src="${escapeHtml(d.image || 'https://placehold.co/100')}" alt="">
                    <div class="menubank-card-body">
                        <div class="menubank-card-name">${escapeHtml(d.name)}</div>
                        <div class="menubank-card-sub">${escapeHtml(d.category || 'Other')}${sizeHints ? ' · ' + escapeHtml(sizeHints) : ''}</div>
                        <div class="menubank-card-price">₹${price}</div>
                    </div>
                    <button class="menubank-add ${inCart ? 'added' : ''}" data-key="${key}" data-cat="${escapeHtml(d.category || 'Other')}">
                        ${inCart ? '✓ Added' : '+ Add'}
                    </button>
                </div>`;
        }).join('') || '<div class="menubank-empty">No dishes found in the bank.</div>';
        renderCats();
        updateFooter();
    };

    const renderCats = () => {
        const counts = {};
        Object.values(_dishes).forEach(d => {
            const c = d.category || 'Other';
            counts[c] = (counts[c] || 0) + 1;
        });
        const names = [...new Set([...Object.values(_categories).map(c => c.name), ...Object.keys(counts)])];
        catsEl.innerHTML = `<button class="menubank-cat ${!activeCat ? 'active' : ''}" data-cat="">All</button>` +
            names.map(c => `<button class="menubank-cat ${activeCat === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)} (${counts[c] || 0})</button>`).join('');
    };

    const updateFooter = () => {
        const n = _cart.size;
        cartBtn.disabled = n === 0;
        getBtn.disabled = n === 0;
        cartBtn.textContent = `View Cart (${n})`;
    };

    grid.addEventListener('click', e => {
        const btn = e.target.closest('.menubank-add');
        if (!btn) return;
        const key = btn.dataset.key;
        if (_cart.has(key)) _cart.delete(key);
        else {
            const dish = Object.values(_dishes).find(d => slugify(`${d.name}-${d.category || 'other'}`) === key);
            if (dish) _cart.set(key, dish);
        }
        refresh();
    });

    catsEl.addEventListener('click', e => {
        const b = e.target.closest('.menubank-cat');
        if (!b) return;
        activeCat = b.dataset.cat;
        refresh();
    });

    searchEl.addEventListener('input', refresh);

    overlay.querySelector('.btn-cancel').onclick = () => close();
    overlay.querySelector('.btn-close-bank').onclick = () => close();
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    cartBtn.onclick = () => showCart(overlay);

    getBtn.onclick = async () => {
        if (_cart.size === 0) return showToast('Select at least one dish', 'warning');
        if (!(await showConfirm(`Copy ${_cart.size} dish(es) + their categories into this outlet's menu?`, 'Get Menu'))) return;
        await getMenu(overlay);
    };

    function close() {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
        _cart.clear();
    }

    loadBank().then(() => refresh()).catch(err => {
        console.error('[MenuBank] load failed', err);
        grid.innerHTML = `<div class="menubank-empty">Failed to load menu bank: ${escapeHtml(err.message)}</div>`;
    });
}

function showCart(overlay) {
    const list = overlay.querySelector('.menubank-grid');
    const catsEl = overlay.querySelector('.menubank-cats');
    catsEl.style.display = 'none';
    if (_cart.size === 0) {
        overlay.remove();
        openMenuBankBrowser();
        return;
    }
    list.innerHTML = [..._cart.values()].map(d => `
        <div class="menubank-card">
            <img src="${escapeHtml(d.image || 'https://placehold.co/100')}" alt="">
            <div class="menubank-card-body">
                <div class="menubank-card-name">${escapeHtml(d.name)}</div>
                <div class="menubank-card-sub">${escapeHtml(d.category || 'Other')}</div>
                <div class="menubank-card-price">₹${d.sizes ? Math.min(...Object.values(d.sizes)) : d.price}</div>
            </div>
            <button class="menubank-add" data-key="${slugify(`${d.name}-${d.category || 'other'}`)}">Remove</button>
        </div>`).join('') || '<div class="menubank-empty">Cart is empty.</div>';
    list.onclick = (e) => {
        const btn = e.target.closest('.menubank-add');
        if (!btn) return;
        _cart.delete(btn.dataset.key);
        showCart(overlay);
    };
    overlay.querySelector('.btn-cart').textContent = `View Cart (${_cart.size})`;
}

async function loadBank() {
    const [catSnap, dishSnap] = await Promise.all([get(BANK('categories')), get(BANK('dishes'))]);
    _categories = catSnap.exists() ? Object.values(catSnap.val()) : [];
    _dishes = dishSnap.exists() ? Object.values(dishSnap.val()) : [];
}

async function getMenu(overlay) {
    const btn = overlay.querySelector('.btn-getmenu');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Copying...';
    try {
        // Find existing category names in this outlet
        const catSnap = await get(Outlet.ref('categories'));
        const existing = catSnap.exists() ? Object.values(catSnap.val()).map(c => c.name) : [];

        const catByKey = {};
        const updates = [];
        for (const dish of _cart.values()) {
            const catName = dish.category || 'Other';
            if (!existing.includes(catName)) {
                const bankCat = _categories.find(c => c.name === catName);
                const newRef = push(Outlet.ref('categories'));
                updates.push(set(newRef, {
                    name: catName,
                    image: bankCat?.image || '',
                    order: bankCat?.order || 0,
                    outlet: Outlet.current.toLowerCase(),
                    addons: bankCat?.addons || null,
                }));
                existing.push(catName);
            }
            const { sourceBid, sourceOid, updatedAt, ...dishData } = dish;
            updates.push(set(push(Outlet.ref('dishes')), {
                ...dishData,
                category: catName,
                stock: dishData.stock === false ? false : true,
            }));
        }
        await Promise.all(updates);
        showToast(`${_cart.size} dish(es) added to your menu!`, 'success');
        close(overlay);
        const { loadMenu } = await import('./catalog.js');
        loadMenu();
    } catch (e) {
        console.error('[MenuBank] Get Menu failed', e);
        showToast('Failed: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Get Menu';
    }
}

function close(overlay) {
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
    }
    _cart.clear();
}