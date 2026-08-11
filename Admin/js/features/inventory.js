import { db, auth, Outlet, serverTimestamp, get, set, update, remove, push, onValue, runTransaction } from '../firebase.js';
import { state } from '../state.js';
import { showDeleteConfirm, showConfirm } from '../ui-utils.js';
import { logAudit, showToast, escapeHtml, getSkeletonRows } from '../utils.js';
import { pushLog, maybeNotifyLowStock } from './inventory-extras.js';
import { t, localize } from '../l10n.js';
import { loadLucide } from '../ui.js';

let inventoryListener = null;
let _invData = [];
let _invSearch = '';
let _invSortField = 'name', _invSortDir = 'asc';
let _menuPage = 1;
let _menuAllRows = [];
const MENU_PAGE_SIZE = 20;

export function initInventory() {
    console.log("[Inventory] Initializing Simplified Module...");
    const btnShowAdd = document.getElementById('btnShowAddInventory');
    const btnSave = document.getElementById('btnSaveInventory');
    const modal = document.getElementById('inventoryModal');
    const closeBtn = modal?.querySelector('.close-btn');

    if (btnShowAdd) btnShowAdd.onclick = () => { resetInvModal(); modal.classList.add('active'); };
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');
    if (btnSave) btnSave.onclick = saveInventoryItem;

    localize(document.getElementById('tab-inventory'));
    initInventoryToggles();
    attachInventoryShortcuts();
}

export function loadInventory() {
    if (!state.currentOutlet) return;
    cleanupInventory();

    const tbody = document.getElementById('inventoryTableBody');
    if (tbody) tbody.innerHTML = getSkeletonRows(5, 5);

    if (_togglesBound && _togglesOutlet !== state.currentOutlet) refreshInventoryTogglesForOutlet();
    _togglesOutlet = state.currentOutlet;

    const invRef = Outlet.ref('inventory');
    inventoryListener = onValue(invRef, (snapshot) => {
        renderInventoryTable(snapshot.val());
        updateInventoryKPIs(snapshot.val());
    }, (error) => {
        console.error("[Inventory] Load Error:", error);
        showToast("Failed to load inventory", "error");
    });

    updateMenuVisibility();
}

export function refreshInventoryTogglesForOutlet() {
    const toggleAvail = document.getElementById('toggleAvailability');
    const toggleStock = document.getElementById('toggleStockTracking');
    const availInfo = document.getElementById('availabilityInfo');
    const stockInfo = document.getElementById('stockTrackingInfo');
    if (!toggleAvail || !toggleStock) return;
    hydrateToggles(toggleAvail, toggleStock).then(() => {
        updateInfoPanel(toggleAvail, availInfo);
        updateInfoPanel(toggleStock, stockInfo);
        updateMenuVisibility();
    });
}

export function cleanupInventory() {
    if (inventoryListener) { inventoryListener(); inventoryListener = null; }
    document.removeEventListener('keydown', _invKeyHandler);
    _shortcutsAttached = false;
    cleanupInventoryToggles();
}

function cleanupInventoryToggles() {
    _togglesBound = false;
    if (_toggleWriteTimer) { clearTimeout(_toggleWriteTimer); _toggleWriteTimer = null; }
}

let _shortcutsAttached = false;
function attachInventoryShortcuts() {
    if (_shortcutsAttached) return;
    _shortcutsAttached = true;
    document.addEventListener('keydown', _invKeyHandler);
}

function _invKeyHandler(e) {
    const tab = document.getElementById('tab-inventory');
    if (!tab || tab.classList.contains('hidden')) return;
    const tag = (e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') {
        const modal = document.getElementById('inventoryModal');
        if (modal && !modal.classList.contains('active')) {
            e.preventDefault(); resetInvModal(); modal.classList.add('active');
            setTimeout(() => document.getElementById('invItemName')?.focus(), 50);
        }
    } else if (e.key === '?') {
        e.preventDefault();
        showToast(t('inv.shortcutsHelp', '📦 Shortcuts: n = Add Item, ? = Help'), 'info');
    }
}

function _initInvTable() {
    const table = document.getElementById('invDataTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const sortEl = table.querySelector(`th[data-sort="${_invSortField}"]`);
    if (sortEl) sortEl.classList.add(`mob-sort-${_invSortDir}`);

    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_invSortField === field) {
                _invSortDir = _invSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _invSortField = field;
                _invSortDir = field === 'stock' || field === 'threshold' || field === 'cost' ? 'desc' : 'asc';
            }
            table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_invSortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderInvTable();
        });
    });
}

function _renderInvTable() {
    const tbody = document.getElementById('inventoryTableBody');
    const countEl = document.getElementById('invTableCount');
    if (!tbody) return;

    let rows = _invData;
    const term = _invSearch.trim().toLowerCase();
    if (term) rows = rows.filter(r => (r.name || '').toLowerCase().includes(term));

    if (countEl) countEl.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;

    const sorted = [...rows].sort((a, b) => {
        let av = a[_invSortField], bv = b[_invSortField];
        if (_invSortField === 'stock' || _invSortField === 'threshold' || _invSortField === 'cost') {
            av = Number(av || 0); bv = Number(bv || 0);
        } else {
            av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase();
        }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _invSortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="mob-table-empty">${term ? 'No items match your search.' : 'No items found. Click "Add Item" to start tracking.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(d => {
        const threshold = d.threshold || 0;
        const stock = parseInt(d.stock, 10) || 0;
        const isLow = stock <= threshold;
        const isReorder = !isLow && stock > threshold && stock <= threshold * 1.5;
        const detailParts = [];
        if (d.sku) detailParts.push(`SKU: ${d.sku}`);
        if (d.unit) detailParts.push(`Unit: ${d.unit}`);
        if (d.supplier) detailParts.push(`Supplier: ${d.supplier}`);
        const title = detailParts.length ? detailParts.join(' · ') : '';
        const badge = isLow
            ? `<span class="stock-status-badge low">${t('inv.lowStockBadge', 'Low Stock')}</span>`
            : isReorder ? `<span class="reorder-badge">${t('inv.reorderSoon', 'Reorder Soon')}</span>` : '';
        const stockColor = stock === 0 ? 'var(--mob-red)' : isLow ? 'var(--mob-amber)' : 'var(--mob-ink)';
        return `<tr>
            <td>
                <div class="mob-td-strong"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(d.name || '—')}</div>
                <div class="mob-td-sub">${detailParts.length ? escapeHtml(title) : ''}${badge}</div>
            </td>
            <td>
                <div class="grid-stock-control">
                    <button class="grid-stock-btn grid-stock-btn-minus" data-action="adjustStock" data-id="${escapeHtml(d.id)}" data-val="-1" title="Decrease">−</button>
                    <span class="grid-stock-value" style="color:${stockColor}">${stock}</span>
                    <button class="grid-stock-btn grid-stock-btn-plus" data-action="adjustStock" data-id="${escapeHtml(d.id)}" data-val="1" title="Increase">+</button>
                </div>
            </td>
            <td><span class="mob-td-sub">Min: ${threshold || 0}</span></td>
            <td>${d.cost ? `<span class="mob-td-total">₹${d.cost}</span>` : '<span class="mob-td-sub">—</span>'}</td>
            <td>
                <div style="display:flex;gap:6px;">
                    <button class="grid-btn grid-btn-outline" data-action="viewStockHistory" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || '')}" title="History">📋</button>
                    <button class="grid-btn grid-btn-primary" data-action="editInventoryItem" data-id="${escapeHtml(d.id)}" title="Edit">✏️</button>
                    <button class="grid-btn grid-btn-danger" data-action="deleteInventoryItem" data-id="${escapeHtml(d.id)}" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderInventoryTable(data) {
    if (!data) { _invData = []; _renderInvTable(); return; }

    const sorted = Object.entries(data).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));
    _invData = sorted.map(([id, item]) => ({ id, ...item }));
    _initInvTable();
    _renderInvTable();
}

export function setInventorySearch(term) {
    _invSearch = term || '';
    _renderInvTable();
}

export async function adjustStock(id, delta) {
    if (!state.currentOutlet || !id) return;
    if (Math.abs(delta) >= 10) {
        const itemSnap = await get(Outlet.ref(`inventory/${id}`));
        const item = itemSnap.val();
        if (!item) return;
        const direction = delta > 0 ? 'increase' : 'decrease';
        const ok = await showConfirm(
            t('inv.confirmLargeMsg', `Apply ${direction} of ${Math.abs(delta)} to ${item.name}? Current: ${item.stock || 0}`),
            t('inv.confirmLarge', 'Confirm Large Adjustment')
        );
        if (!ok) return;
    }

    const itemRef = Outlet.ref(`inventory/${id}/stock`);
    let prevStock = 0, nextStock = 0;
    try {
        const result = await runTransaction(itemRef, (currentStock) => {
            prevStock = currentStock || 0;
            nextStock = Math.max(0, prevStock + delta);
            return nextStock;
        });
        if (result.committed) {
            pushLog({ itemId: id, delta, prevStock, newStock: nextStock, user: auth.currentUser?.email || 'unknown' });
            try {
                const itemSnap = await get(Outlet.ref(`inventory/${id}`));
                const item = itemSnap.val();
                if (item) maybeNotifyLowStock({ itemId: id, itemName: item.name, prevStock, newStock: nextStock, threshold: item.threshold || 0 });
            } catch (_) {}
        }
    } catch (error) {
        console.error("[Inventory] Adjustment Error:", error);
        showToast(t('inv.syncError', '📦 Sync Error'), "error");
    }
}

export async function autoDeductStock(items) {
    if (!state.currentOutlet || !items || items.length === 0) return;
    try {
        const snapshot = await get(Outlet.ref("inventory"));
        const inventory = snapshot.val() || {};
        for (const item of items) {
            const itemName = (item.name || "").toLowerCase();
            let invEntry = null;
            if (item.id) invEntry = Object.entries(inventory).find(([, data]) => data.dishId === item.id) || null;
            if (!invEntry) {
                invEntry = Object.entries(inventory).find(([, data]) => (data.name || "").toLowerCase() === itemName) || null;
                if (invEntry && item.id) {
                    const [matchId, matchData] = invEntry;
                    if (!matchData.dishId) update(Outlet.ref(`inventory/${matchId}`), { dishId: item.id }).catch(() => {});
                }
            }
            if (invEntry) {
                const [id] = invEntry;
                await adjustStock(id, -(item.qty || 1));
            }
        }
    } catch (e) { console.error("[Inventory] Auto-Deduct Error:", e); }
}

async function saveInventoryItem() {
    const name = document.getElementById('invItemName').value.trim();
    const stock = parseFloat(document.getElementById('invItemStock').value) || 0;
    const threshold = parseFloat(document.getElementById('invItemThreshold').value) || 0;
    const sku = document.getElementById('invItemSku').value.trim();
    const unit = document.getElementById('invItemUnit').value || 'each';
    const supplier = document.getElementById('invItemSupplier').value.trim();
    const cost = parseFloat(document.getElementById('invItemCost').value) || 0;
    const id = document.getElementById('inventoryModal').dataset.editId;

    if (!name) { showToast(t('inv.nameRequired', 'Item name is required'), "warning"); return; }

    try {
        const existingSnap = await get(Outlet.ref('inventory'));
        const existing = existingSnap.val() || {};
        const nameLower = name.toLowerCase();
        const skuLower = sku.toLowerCase();

        const dupName = Object.entries(existing).find(([k, v]) => k !== id && (v.name || '').toLowerCase() === nameLower);
        if (dupName) { showToast(t('inv.dupName', '📦 Item name already tracked'), "warning"); return; }
        if (skuLower) {
            const dupSku = Object.entries(existing).find(([k, v]) => k !== id && (v.sku || '').toLowerCase() === skuLower);
            if (dupSku) { showToast(t('inv.dupSku', '📦 SKU already in use'), "warning"); return; }
        }

        const itemData = { name, stock, threshold, sku, unit, supplier, cost, updatedAt: serverTimestamp() };

        if (id) {
            const existingItem = existing[id];
            if (existingItem && !existingItem.dishId) {
                const matchingDish = await findDishByName(existingItem.name);
                if (matchingDish) itemData.dishId = matchingDish;
            }
            await update(Outlet.ref(`inventory/${id}`), itemData);
            showToast(t('inv.updated', '📦 Item Updated'));
        } else {
            const newRef = push(Outlet.ref('inventory'));
            await set(newRef, itemData);
            showToast(t('inv.saved', '📦 Item Added'));
        }
        document.getElementById('inventoryModal').classList.remove('active');
        resetInvModal();
    } catch (error) { showToast(t('inv.saveFailed', '📦 Save Failed'), "error"); }
}

async function findDishByName(dishName) {
    try {
        const snap = await get(Outlet.ref('dishes'));
        const dishes = snap.val() || {};
        const target = (dishName || '').toLowerCase();
        const match = Object.entries(dishes).find(([, d]) => (d.name || '').toLowerCase() === target);
        return match ? match[0] : null;
    } catch (e) { return null; }
}

function resetInvModal() {
    document.getElementById('invModalTitle').innerText = t('inv.modal.newTitle', 'Track New Product');
    document.getElementById('invItemName').value = '';
    document.getElementById('invItemStock').value = '0';
    document.getElementById('invItemThreshold').value = '5';
    document.getElementById('invItemSku').value = '';
    document.getElementById('invItemUnit').value = 'each';
    document.getElementById('invItemSupplier').value = '';
    document.getElementById('invItemCost').value = '';
    delete document.getElementById('inventoryModal').dataset.editId;
}

export async function editInventoryItem(id) {
    const invRef = Outlet.ref(`inventory/${id}`);
    const snapshot = await get(invRef);
    const item = snapshot.val();
    if (!item) return;
    document.getElementById('invModalTitle').innerText = t('inv.modal.editTitle', 'Edit Product Tracking');
    document.getElementById('invItemName').value = item.name;
    document.getElementById('invItemStock').value = item.stock;
    document.getElementById('invItemThreshold').value = item.threshold;
    document.getElementById('invItemSku').value = item.sku || '';
    document.getElementById('invItemUnit').value = item.unit || 'each';
    document.getElementById('invItemSupplier').value = item.supplier || '';
    document.getElementById('invItemCost').value = item.cost || '';
    document.getElementById('inventoryModal').dataset.editId = id;
    document.getElementById('inventoryModal').classList.add('active');
}

export async function deleteInventoryItem(id) {
    if (!(await showDeleteConfirm("this inventory item", "This item will be removed from the inventory list."))) return;
    try {
        await remove(Outlet.ref(`inventory/${id}`));
        showToast(t('inv.removed', '📦 Tracking stopped'));
    } catch (error) { showToast(t('inv.removeFailed', '📦 Failed to remove'), "error"); }
}

function updateInventoryKPIs(data) {
    const totalEl = document.getElementById('invTotalItems');
    const lowEl = document.getElementById('invLowStock');
    if (!data) {
        if (totalEl) totalEl.innerText = '0';
        if (lowEl) lowEl.innerText = '0';
        return;
    }
    const items = Object.values(data);
    const lowCount = items.filter(item => item.stock <= (item.threshold || 0)).length;
    if (totalEl) totalEl.innerText = items.length;
    if (lowEl) lowEl.innerText = lowCount;
}

// ============================================================
// INVENTORY FEATURE TOGGLES & DISH CARD CONTROLS
// ============================================================

let _togglesBound = false;
let _togglesOutlet = null;
let _toggleWriteTimer = null;

export function initInventoryToggles() {
    const toggleAvail = document.getElementById('toggleAvailability');
    const toggleStock = document.getElementById('toggleStockTracking');
    const availInfo = document.getElementById('availabilityInfo');
    const stockInfo = document.getElementById('stockTrackingInfo');
    if (!toggleAvail || !toggleStock) return;
    if (_togglesBound) return;
    _togglesBound = true;

    toggleAvail.addEventListener('change', () => {
        localStorage.setItem('inv_availability', toggleAvail.checked);
        updateInfoPanel(toggleAvail, availInfo);
        updateMenuVisibility();
        scheduleTogglePersist(toggleAvail, toggleStock);
    });
    toggleStock.addEventListener('change', () => {
        localStorage.setItem('inv_stockTracking', toggleStock.checked);
        updateInfoPanel(toggleStock, stockInfo);
        updateMenuVisibility();
        scheduleTogglePersist(toggleAvail, toggleStock);
    });

    hydrateToggles(toggleAvail, toggleStock).then(() => {
        updateInfoPanel(toggleAvail, availInfo);
        updateInfoPanel(toggleStock, stockInfo);
        updateMenuVisibility();
    });
}

async function hydrateToggles(toggleAvail, toggleStock) {
    if (!state.currentOutlet) {
        toggleAvail.checked = localStorage.getItem('inv_availability') === 'true';
        toggleStock.checked = localStorage.getItem('inv_stockTracking') === 'true';
        return;
    }
    try {
        const snap = await get(Outlet.ref('settings/inventory'));
        const remote = snap.val();
        if (remote && (typeof remote.availability === 'boolean' || typeof remote.stockTracking === 'boolean')) {
            toggleAvail.checked = !!remote.availability;
            toggleStock.checked = !!remote.stockTracking;
            localStorage.setItem('inv_availability', toggleAvail.checked);
            localStorage.setItem('inv_stockTracking', toggleStock.checked);
        } else {
            toggleAvail.checked = localStorage.getItem('inv_availability') === 'true';
            toggleStock.checked = localStorage.getItem('inv_stockTracking') === 'true';
            await set(Outlet.ref('settings/inventory'), { availability: toggleAvail.checked, stockTracking: toggleStock.checked });
        }
    } catch (e) {
        toggleAvail.checked = localStorage.getItem('inv_availability') === 'true';
        toggleStock.checked = localStorage.getItem('inv_stockTracking') === 'true';
    }
}

function scheduleTogglePersist(toggleAvail, toggleStock) {
    clearTimeout(_toggleWriteTimer);
    _toggleWriteTimer = setTimeout(() => {
        if (!state.currentOutlet) return;
        set(Outlet.ref('settings/inventory'), { availability: toggleAvail.checked, stockTracking: toggleStock.checked }).catch(err => console.warn('[Inventory] Toggle persist failed', err));
    }, 500);
}

function updateInfoPanel(toggle, infoPanel) {
    if (!infoPanel) return;
    infoPanel.style.display = toggle.checked ? 'none' : 'block';
}

function updateMenuVisibility() {
    const menuSection = document.getElementById('inventoryMenuSection');
    if (!menuSection) return;
    const anyEnabled = document.getElementById('toggleAvailability')?.checked || document.getElementById('toggleStockTracking')?.checked;
    menuSection.style.display = anyEnabled ? 'block' : 'none';
    if (anyEnabled) loadInventoryMenu();
}

export async function loadInventoryMenu() {
    const container = document.getElementById('inventoryMenuGrid');
    if (!container) return;
    const showAvailability = document.getElementById('toggleAvailability')?.checked;
    const showStock = document.getElementById('toggleStockTracking')?.checked;
    container.innerHTML = '<div class="text-center p-20 text-muted">Loading menu...</div>';

    try {
        const [dishesSnap, inventorySnap] = await Promise.all([
            get(Outlet.ref('dishes')),
            get(Outlet.ref('inventory'))
        ]);
        const inventoryMap = {};
        inventorySnap.forEach(child => {
            const inv = child.val();
            inventoryMap[(inv.name || '').toLowerCase()] = { id: child.key, stock: inv.stock || 0, threshold: inv.threshold || 5 };
        });

        if (dishesSnap.size === 0) {
            _menuAllRows = [];
            container.innerHTML = '<div class="text-center p-40 text-muted">No dishes found.</div>';
            return;
        }

        const rows = [];
        dishesSnap.forEach(child => {
            const dish = child.val();
            const dishId = child.key;
            const inv = inventoryMap[(dish.name || '').toLowerCase()];
            let controlsHtml = '';
            let reorderBadge = '';

            if (showAvailability) {
                controlsHtml += `<div class="inventory-avail-row"><span class="avail-label">Available</span><label class="toggle-switch-sm"><input type="checkbox" ${dish.stock !== false ? 'checked' : ''} data-action="toggleDish" data-id="${dishId}"><span class="toggle-slider-sm"></span></label></div>`;
            }
            if (showStock) {
                if (inv) {
                    const threshold = inv.threshold || 0;
                    const isLow = inv.stock <= threshold;
                    const isReorder = !isLow && inv.stock > threshold && inv.stock <= threshold * 1.5;
                    if (isReorder) reorderBadge = '<span class="reorder-badge">Reorder Soon</span>';
                    controlsHtml += `<div class="inventory-stock-row"><span class="stock-label flex-row flex-gap-6 flex-center ${isLow ? 'text-danger' : ''}"><span>Stock: ${inv.stock}</span>${reorderBadge}</span><div class="stock-control-group"><button class="stock-adjust-btn minus" data-inventory-id="${inv.id}" data-delta="-1">−</button><span class="stock-val-display">${inv.stock}</span><button class="stock-adjust-btn plus" data-inventory-id="${inv.id}" data-delta="1">+</button></div></div>`;
                } else {
                    controlsHtml += `<div class="inventory-stock-row"><span class="stock-label text-muted">Not tracked</span><button class="btn-secondary btn-small track-dish-btn" data-dish-id="${dishId}" data-dish-name="${escapeHtml(dish.name)}">+ Track Stock</button></div>`;
                }
            }
            rows.push(`<div class="dish-card inventory-dish-card"><div class="dish-img-container"><img src="${dish.image || 'https://placehold.co/150'}" alt="${escapeHtml(dish.name)}" loading="lazy"></div><div class="dish-info"><h4>${escapeHtml(dish.name)}</h4><span class="dish-price-val">₹${dish.price || 0}</span>${controlsHtml}</div></div>`);
        });

        _menuAllRows = rows;
        _menuPage = 1;
        paintMenuPage();
    } catch (e) {
        console.error('[Inventory] loadInventoryMenu failed:', e);
        container.innerHTML = '<div class="text-center p-40 text-danger">Failed to load menu.</div>';
    }
}

async function paintMenuPage() {
    const container = document.getElementById('inventoryMenuGrid');
    if (!container) return;
    const start = (_menuPage - 1) * MENU_PAGE_SIZE;
    container.innerHTML = _menuAllRows.slice(start, start + MENU_PAGE_SIZE).join('');
    await loadLucide();
    window.lucide.createIcons({ root: container });
    attachInventoryMenuListeners(container);
}

function attachInventoryMenuListeners(container) {
    container.querySelectorAll('.stock-adjust-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const invId = btn.dataset.inventoryId;
            const delta = parseInt(btn.dataset.delta, 10);
            if (invId && delta) { await adjustStock(invId, delta); loadInventoryMenu(); }
        });
    });
    container.querySelectorAll('.track-dish-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const dishName = btn.dataset.dishName;
            const dishId = btn.dataset.dishId;
            if (!dishName) return;
            await push(Outlet.ref('inventory'), { name: dishName, dishId, stock: 0, threshold: 5, updatedAt: serverTimestamp() });
            showToast(t('inv.nowTracking', 'Now tracking stock for ' + dishName), "success");
            loadInventoryMenu();
        });
    });
}
