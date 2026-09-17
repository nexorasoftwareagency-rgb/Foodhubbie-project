import { Outlet, onValue } from '../firebase.js';
import { escapeHtml } from '../utils.js';
import { state } from '../state.js';
import { loadLucide } from '../ui.js';

let _categoriesUnsub = null;
let _dishesUnsub = null;
let _selectedCat = null;
let _dishFilter = '';
let _catFilter = '';
let _viewMode = 'grid';

export function initMenuBrowser() {
    _wireSearchInputs();
    _wireButtons();
    _wireViewToggle();
    _loadCategories();
    _loadDishes();
}

export function cleanupMenuBrowser() {
    if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
    if (_dishesUnsub) { _dishesUnsub(); _dishesUnsub = null; }
    _selectedCat = null;
    _dishFilter = '';
    _catFilter = '';
}

export function filterBrowserDishes(val) {
    _dishFilter = (val || '').toLowerCase();
    _renderDishes();
}

export function filterBrowserCategories(val) {
    _catFilter = (val || '').toLowerCase();
    _renderCategorySidebar();
}

function _loadCategories() {
    const container = document.getElementById('browserCategoryList');
    if (!container) return;
    container.innerHTML = '';

    _categoriesUnsub = onValue(Outlet.ref('categories'), snap => {
        const cats = [];
        snap.forEach(child => {
            cats.push({ id: child.key, ...child.val() });
        });
        cats.sort((a, b) => ((a.order ?? a.sort) || 0) - ((b.order ?? b.sort) || 0));
        state.categories = cats;
        _renderCategorySidebar();
    });
}

function _loadDishes() {
    const grid = document.getElementById('browserDishGrid');
    if (!grid) return;

    _dishesUnsub = onValue(Outlet.ref('dishes'), snap => {
        const dishes = [];
        snap.forEach(child => {
            dishes.push({ id: child.key, ...child.val() });
        });
        dishes.sort((a, b) => ((a.order ?? b.sort) || 0) - ((b.order ?? b.sort) || 0));
        state.dishes = dishes;
        _renderDishes();
    });
}

function _renderCategorySidebar() {
    const container = document.getElementById('browserCategoryList');
    if (!container) return;
    container.innerHTML = '';

    const cats = state.categories || [];
    const filtered = _catFilter
        ? cats.filter(c => c.name.toLowerCase().includes(_catFilter))
        : cats;

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No categories found</div>';
        return;
    }

    // "All" item
    const allDiv = document.createElement('div');
    allDiv.className = `browser-category-item${_selectedCat === null ? ' active' : ''}`;
    allDiv.setAttribute('role', 'button');
    allDiv.setAttribute('tabindex', '0');
    allDiv.setAttribute('aria-pressed', _selectedCat === null ? 'true' : 'false');
    allDiv.innerHTML = `
        <div class="cat-thumb" style="background:linear-gradient(135deg,#FFB347,#E84908);display:flex;align-items:center;justify-content:center;">
            <i data-lucide="layout-grid" style="width:18px;height:18px;color:#fff;"></i>
        </div>
        <div class="cat-info">
            <div class="cat-name" title="All Categories">All Categories</div>
            <div class="cat-count">${(state.dishes || []).length} items</div>
        </div>`;
    const selectAll = () => { _selectedCat = null; _renderCategorySidebar(); _renderDishes(); };
    allDiv.addEventListener('click', selectAll);
    allDiv.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAll(); } });
    container.appendChild(allDiv);

    filtered.forEach(cat => {
        const dishCount = (state.dishes || []).filter(d => d.category === cat.name).length;
        const div = document.createElement('div');
        div.className = `browser-category-item${_selectedCat === cat.name ? ' active' : ''}`;
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('aria-pressed', _selectedCat === cat.name ? 'true' : 'false');
        div.innerHTML = `
            <img src="${escapeHtml(cat.image || 'https://placehold.co/100/orange/white?text=C')}" class="cat-thumb">
            <div class="cat-info">
                <div class="cat-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</div>
                <div class="cat-count">${dishCount} item${dishCount !== 1 ? 's' : ''}</div>
            </div>`;
        const select = () => { _selectedCat = cat.name; _renderCategorySidebar(); _renderDishes(); };
        div.addEventListener('click', select);
        div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
        container.appendChild(div);
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
}

function _renderDishes() {
    const grid = document.getElementById('browserDishGrid');
    const label = document.getElementById('browserSelectedCategory');
    const count = document.getElementById('browserDishCount');
    if (!grid) return;

    grid.innerHTML = '';
    let dishes = state.dishes || [];

    // Filter by selected category
    if (_selectedCat) {
        dishes = dishes.filter(d => d.category === _selectedCat);
    }

    // Filter by search
    if (_dishFilter) {
        dishes = dishes.filter(d => {
            const haystack = `${d.name} ${d.category || ''} ${d.description || ''}`.toLowerCase();
            return haystack.includes(_dishFilter);
        });
    }

    // Update header
    if (label) label.textContent = _selectedCat || 'All Categories';
    if (count) count.textContent = `${dishes.length} item${dishes.length !== 1 ? 's' : ''}`;

    if (dishes.length === 0) {
        grid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-muted);">
                <i data-lucide="folder-open" style="width:48px;height:48px;margin:0 auto 16px;opacity:0.5;display:block;"></i>
                <p>${_selectedCat ? 'No dishes in this category' : 'No dishes yet. Click + Add Dish to get started.'}</p>
            </div>`;
        if (window.lucide) window.lucide.createIcons({ root: grid });
        return;
    }

    // Toggle grid/list class
    grid.className = _viewMode === 'list' ? 'browser-dish-grid list-view' : 'browser-dish-grid';

    dishes.forEach(d => {
        const card = document.createElement('div');
        card.className = 'browser-dish-card';
        card.setAttribute('data-dish-id', d.id);
        card.innerHTML = `
            <div class="browser-dish-img">
                <img src="${escapeHtml(d.image || 'https://placehold.co/200/orange/white?text=Dish')}" alt="${escapeHtml(d.name)}">
                <div class="browser-dish-stock ${d.stock ? 'available' : 'out'}">${d.stock ? 'Available' : 'Out of Stock'}</div>
            </div>
            <div class="browser-dish-info">
                <div class="browser-dish-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>
                <div class="browser-dish-category">${escapeHtml(d.category || 'General')}</div>
                <div class="browser-dish-pricing">
                    ${d.sizes
                        ? Object.entries(d.sizes).map(([s, p]) => `<span class="browser-price-chip">${escapeHtml(s)} ₹${escapeHtml(String(p))}</span>`).join('')
                        : `<span class="browser-price-chip">₹${escapeHtml(String(d.price || 0))}</span>`
                    }
                </div>
                <div class="browser-dish-actions">
                    <button class="btn-action-v4" data-action="editDish" data-id="${d.id}" title="Edit Dish"><i data-lucide="edit-3" style="width:14px;"></i></button>
                    <button class="btn-action-v4 danger" data-action="deleteDish" data-id="${d.id}" title="Delete Dish"><i data-lucide="trash-2" style="width:14px;"></i></button>
                </div>
            </div>`;
        grid.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons({ root: grid });
}

function _wireSearchInputs() {
    const dishSearch = document.getElementById('menuBrowserSearch');
    const catSearch = document.getElementById('browserCategorySearch');
    if (dishSearch) {
        dishSearch.addEventListener('input', e => {
            _dishFilter = e.target.value.toLowerCase();
            _renderDishes();
        });
    }
    if (catSearch) {
        catSearch.addEventListener('input', e => {
            _catFilter = e.target.value.toLowerCase();
            _renderCategorySidebar();
        });
    }
}

function _wireButtons() {
    const addCatBtn = document.getElementById('btnAddCategoryFromBrowser');
    const addDishBtn = document.getElementById('btnAddDishFromBrowser');
    const bankBtn = document.getElementById('btnOpenMenuBankFromBrowser');

    if (addCatBtn) {
        addCatBtn.addEventListener('click', async () => {
            const { addCategory } = await import('./catalog.js');
            addCategory();
        });
    }
    if (addDishBtn) {
        addDishBtn.addEventListener('click', async () => {
            const { showDishModal } = await import('./catalog.js');
            showDishModal();
        });
    }
    if (bankBtn) {
        bankBtn.addEventListener('click', async () => {
            const { showAddDishChoice } = await import('./catalog.js');
            showAddDishChoice();
        });
    }
}

function _wireViewToggle() {
    document.querySelectorAll('.browser-view-toggle [data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.browser-view-toggle .btn-icon-v4').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _viewMode = btn.getAttribute('data-view');
            _renderDishes();
        });
    });
}
