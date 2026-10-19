import { Outlet, BUSINESS_ID, db, uploadImage, deleteImage, ref, get, set, update, remove, push, onValue, child } from '../firebase.js';
import { showToast, escapeHtml, logAudit, getSkeletonRows, previewImage } from '../utils.js';
import { state } from '../state.js';
import { requireAdminReauth } from '../auth.js';
import { showConfirm, showDeleteConfirm } from '../ui-utils.js';
import { loadLucide } from '../ui.js';
import { mirrorToMenuBank } from '../../shared/menu-bank.js';
import { comboPriceTotal, isComboActive } from '../../shared/combo-math.js';

const _bankSource = () => ({ bid: BUSINESS_ID(), oid: Outlet.current });

let _categoriesUnsub = null;
let _dishesUnsub = null;

export function loadCategories() {
    cleanupCatalog();
    // Show skeleton while data loads
    const catContainer = document.getElementById('categoryList');
    if (catContainer) catContainer.innerHTML = getSkeletonRows(5, 1);
    console.log("[Catalog] Loading categories...");
    _categoriesUnsub = onValue(Outlet.ref('categories'), snap => {
        console.log(`[Catalog] Received ${Object.keys(snap.val() || {}).length} categories`);
        state.categories = [];
        const container = document.getElementById('categoryList');
        if (!container) return;
        container.innerHTML = "";

        const cats = [];
        snap.forEach(child => {
            cats.push({ id: child.key, ...child.val() });
        });

        // Support both 'order' (new) and 'sort' (legacy) fields
cats.sort((a, b) => ((a.order ?? a.sort) || 0) - ((b.order ?? b.sort) || 0));
        state.categories = cats;

        // Count dishes per category
        const dishCounts = {};
        if (state.dishes) {
            state.dishes.forEach(d => {
                const cat = d.category || 'Uncategorized';
                dishCounts[cat] = (dishCounts[cat] || 0) + 1;
            });
        }

        cats.forEach(cat => {
            const div = document.createElement('div');
            div.className = "premium-row-v4 p-10 flex-row flex-center flex-gap-10 br-12";
            div.style.border = "1px solid rgba(0,0,0,0.02)";

            const addonCount = cat.addons ? Object.keys(cat.addons).length : 0;
            const dishCount = dishCounts[cat.name] || 0;
            const subParts = [`Serial: ${cat.order || 0}`];
            if (dishCount > 0) subParts.push(`${dishCount} dish${dishCount !== 1 ? 'es' : ''}`);
            if (addonCount > 0) subParts.push(`${addonCount} addon${addonCount !== 1 ? 's' : ''}`);

            div.innerHTML = `
                <div class="identity-chip-v4" style="flex: 1;">
                    <img src="${cat.image || 'https://placehold.co/100/orange/white?text=Category'}" class="identity-avatar-v4" style="width:40px; height:40px;">
                    <div class="identity-info-v4">
                        <span class="name" style="font-size:13px;">${escapeHtml(cat.name)}</span>
                        <span class="sub" style="font-size:10px;">${subParts.join(' Â· ')}</span>
                    </div>
                </div>
                <div class="action-group-v4">
                    <button data-action="editCategory" data-id="${cat.id}" class="btn-action-v4" title="Edit Category" aria-label="Edit Category">
                         <i data-lucide="pencil" style="width:12px;"></i>
                    </button>
                    <button data-action="deleteCategory" data-id="${cat.id}" class="btn-action-v4 danger" title="Delete Category" aria-label="Delete Category">
                         <i data-lucide="trash-2" style="width:12px;"></i>
                    </button>
                </div>
            `;
            container.appendChild(div);
        });
        if (window.lucide) window.lucide.createIcons({ root: container });
        updateActiveDishModalCategories();
    });
}

/**
 * Get categories from state (used by tables.js for discount evaluation)
 * @returns {Array} Array of category objects
 */
export function getCategories() {
    return state.categories || [];
}

let isProcessingCategory = false;
export async function addCategory() {
    if (isProcessingCategory) return;
    const nameInput = document.getElementById('newCatName');
    const name = nameInput.value.trim();
    if (!name) return showToast('Enter category name', 'warning');

    // Check for duplicate name
    const existingCats = state.categories || [];
    if (existingCats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        return showToast('A category with this name already exists', 'warning');
    }

    const fileInput = document.getElementById('catFile');
    const previewImg = document.getElementById('catPreview');
    let imageUrl = "";

    try {
        isProcessingCategory = true;
        const btn = document.getElementById('btnAddCategory');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-sm"></span> Processing...';
        }

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            imageUrl = await uploadImage(file, `categories/${Date.now()}_${file.name}`);
        }

        const addons = {};
        document.querySelectorAll('#categoryAddonsList .addon-row-small').forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs[0].value && inputs[1].value) {
                addons[inputs[0].value] = Number(inputs[1].value);
            }
        });

        const orderInput = document.getElementById('newCatOrder');
        const order = parseInt(orderInput?.value) || 0;

        await push(Outlet.ref('categories'), {
            name: name,
            image: imageUrl,
            order: order,
            outlet: (window.currentOutlet || 'pizza').toLowerCase(),
            addons: Object.keys(addons).length > 0 ? addons : null
        });

        await mirrorToMenuBank(db, ref, set, 'categories', {
            name: name,
            image: imageUrl,
            order: order,
            outlet: (window.currentOutlet || 'pizza').toLowerCase(),
            addons: Object.keys(addons).length > 0 ? addons : null
        }, _bankSource());

        const addonsList = document.getElementById('categoryAddonsList');
        if (addonsList) addonsList.innerHTML = "";

        nameInput.value = "";
        if (orderInput) orderInput.value = "";
        fileInput.value = "";
        if (previewImg) previewImg.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='100%25' height='100%25' fill='%23eee'/%3E%3C/svg%3E";
        showToast('Category added successfully!', 'success');
        logAudit("Catalog", `Added Category: ${name}`, "Global");
    } catch (err) {
        console.error(err);
        showToast('Operation failed: ' + err.message, 'error');
    } finally {
        isProcessingCategory = false;
        const btn = document.getElementById('btnAddCategory');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'ðŸš€ Add Category';
        }
    }
}

export async function deleteCategory(id) {
    const catSnap = await get(Outlet.ref('categories/' + id));
    const category = catSnap.val();
    if (!category) return showToast("Category not found", "error");

    const catName = category.name;
    if (!(await showDeleteConfirm(`${catName} and ALL associated dishes`, "Delete this category and ALL associated dishes? This cannot be undone."))) return;

    try {
            const catImage = category.image;

            const dishesSnap = await get(Outlet.ref('dishes'));
            const dishes = dishesSnap.val() || {};

            const updates = {};
            updates[`categories/${id}`] = null;

            const imagesToDelete = [];
            if (catImage) imagesToDelete.push(catImage);

            Object.keys(dishes).forEach(dishId => {
                if (dishes[dishId].category === catName) {
                    updates[`dishes/${dishId}`] = null;
                    if (dishes[dishId].image) {
                        imagesToDelete.push(dishes[dishId].image);
                    }
                }
            });

            await Outlet.multiUpdate(updates);

            imagesToDelete.forEach(img => {
                deleteImage(img).catch(err => console.warn("[Catalog] Image deletion failed:", img, err));
            });

            logAudit("Catalog", `Deleted Category and associated dishes: ${catName}`, id);
            showToast(`Category "${catName}" and all its items deleted.`, 'success');
        } catch (err) {
            console.error("[Catalog] Delete failed:", err);
            showToast("Operation failed: " + err.message, "error");
        }
}


/**
 * DISHES (MENU)
 */

export function loadMenu() {
    const grid = document.getElementById("menuGrid");
    if (!grid) return;

    // Only clean up the dishes listener, NOT categories
    if (_dishesUnsub) { _dishesUnsub(); _dishesUnsub = null; }
    if (_combosUnsub) { _combosUnsub(); _combosUnsub = null; }
    // Show skeleton while data loads
    grid.innerHTML = Array.from({ length: 6 }, () =>
        '<div class="skeleton-dish-card" style="animation: skeleton-pulse 1.2s ease-in-out infinite alternate;"></div>'
    ).join('');
    console.log("[Catalog] Loading menu...");
    _dishesUnsub = onValue(Outlet.ref(`dishes`), async snap => {
        grid.innerHTML = "";
        const dishes = [];
        snap.forEach(child => {
            dishes.push({ id: child.key, ...child.val() });
        });

        // Sort by order field
        // Support both 'order' (new) and 'sort' (legacy) fields
dishes.sort((a, b) => ((a.order ?? a.sort) || 0) - ((b.order ?? b.sort) || 0));
        state.dishes = dishes;

        dishes.forEach(async d => {
            const dishId = d.id;
            let sizesHtml = "";
            if (d.sizes) {
                sizesHtml = `
                <div class="dish-pricing-box">
                    <div style="font-size:9px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:5px; letter-spacing:0.5px;">Sizes & Pricing</div>
                    ${Object.entries(d.sizes).map(([size, price]) => `
                        <div class="dish-price-row">
                            <span style="color:var(--text-main)">${escapeHtml(size)}</span>
                            <span class="dish-price-val">â‚¹${escapeHtml(String(price))}</span>
                        </div>
                    `).join("")}
                </div>`;
            } else {
                sizesHtml = `
                <div class="dish-pricing-box flex-between">
                    <span style="font-size:12px; color:var(--text-muted)">Standard</span>
                    <span class="dish-price-val" style="font-size:15px;">â‚¹${escapeHtml(String(d.price || 0))}</span>
                </div>`;
            }

            const card = document.createElement('div');
            card.className = 'dish-card premium-shadow-v4';
            card.innerHTML = `
                <div class="dish-img-container">
                    <img src="${d.image || 'https://placehold.co/150/orange/white?text=Dish'}" alt="${escapeHtml(d.name)}">
                    <div class="stock-badge ${d.stock ? 'available' : 'out'}">
                        ${d.stock ? '✅ Available' : '❌ Out of Stock'}
                    </div>
                    <div class="dish-category-badge">${escapeHtml(d.category || 'General')}</div>
                </div>
                <div class="dish-info">
                    <h4 class="mb-8">${escapeHtml(d.name)}</h4>
                    
                    <div class="dish-pricing-v4 mb-15">
                        ${d.sizes ? Object.entries(d.sizes).map(([size, price]) => `
<div class="price-chip-v4">
                                    <span class="size">${escapeHtml(size)}</span>
                                    <span class="price">₹${escapeHtml(String(price))}</span>
                                </div>
                        `).join("") : `
<div class="price-chip-v4 main">
                                    <span class="size">Price</span>
                                    <span class="price">₹${escapeHtml(String(d.price || 0))}</span>
                                </div>
                        `}
                    </div>

                    <div class="flex-row justify-between flex-center pt-12 border-t-ghost">
                        <div class="action-group-v4">
                            <button class="btn-action-v4" data-action="editDish" data-id="${dishId}" title="Edit Dish" aria-label="Edit Dish">
                                <i data-lucide="edit-3" style="width:14px;"></i>
                            </button>
                            <button class="btn-action-v4 danger" data-action="deleteDish" data-id="${dishId}" title="Delete Dish" aria-label="Delete Dish">
                                <i data-lucide="trash-2" style="width:14px;"></i>
                            </button>
                        </div>
                        <div class="notif-time-badge-premium fs-10" style="padding:4px 8px;">
                            ID: ${dishId.slice(-4).toUpperCase()}
                        </div>
                    </div>
                </div>`;

            await loadLucide();
            window.lucide.createIcons({ root: card });
            grid.appendChild(card);
        });

        if (Object.keys(snap.val() || {}).length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No dishes yet. Click + Add Dish to get started.</div>';
        }
    });
}

let isProcessingDish = false;
export async function saveDish() {
    if (isProcessingDish) return;
    if (!window.currentOutlet || window.currentOutlet === 'null' || window.currentOutlet === 'undefined') {
        return showToast("Error: Current outlet context is missing. Please refresh or select an outlet first.", "error");
    }

    const name = document.getElementById('dishName').value;
    const cat = document.getElementById('dishCategory').value;
    const basePrice = document.getElementById('dishPriceBase').value;
    let image = document.getElementById('dishImage').value;

    document.querySelectorAll('#dishModal .form-input').forEach(el => el.classList.remove('error', 'valid'));
    if (!name) document.getElementById('dishName').classList.add('error');
    else document.getElementById('dishName').classList.add('valid');
    if (!cat) document.getElementById('dishCategory').classList.add('error');
    else document.getElementById('dishCategory').classList.add('valid');
    if (!name || !cat) return showToast("Please fill Name and Category", "warning");

    const file = document.getElementById('dishFile').files[0];
    const statusLabel = document.getElementById('uploadStatus');
    const saveBtn = document.querySelector('#dishModal .btn-primary');

    try {
        isProcessingDish = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.dataset.originalText = saveBtn.innerText;
            saveBtn.innerHTML = '<span class="spinner-sm"></span> Saving...';
        }
        if (file) {
            if (statusLabel) statusLabel.classList.remove('hidden');
            let oldImageUrl = null;
            if (state.editingDishId) {
                const snap = await get(Outlet.ref(`dishes/${state.editingDishId}`));
                oldImageUrl = snap.val()?.image;
            }
            image = await uploadImage(file, `dishes/${Date.now()}_${file.name}`);
            if (oldImageUrl && image !== oldImageUrl) {
                await deleteImage(oldImageUrl);
            }
            if (statusLabel) statusLabel.classList.add('hidden');
        }

        const sizes = {};
        document.querySelectorAll('.size-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs[0].value && inputs[1].value) {
                sizes[inputs[0].value] = Number(inputs[1].value);
            }
        });

        const addons = {};
        document.querySelectorAll('.addon-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs[0].value && inputs[1].value) {
                addons[inputs[0].value] = Number(inputs[1].value);
            }
        });

        const order = parseInt(document.getElementById('dishOrder')?.value) || 0;

        const data = {
            name,
            category: cat,
            price: Number(basePrice) || 0,
            image,
            stock: true,
            order: order,
            sizes: Object.keys(sizes).length > 0 ? sizes : null,
            addons: Object.keys(addons).length > 0 ? addons : null,
            veg: document.getElementById('dishVeg').value !== 'nonveg'
        };

        const dishesRef = Outlet.ref('dishes');
        if (state.editingDishId) {
            await update(child(dishesRef, state.editingDishId), data);
            logAudit("Catalog", `Updated Dish: ${name}`, state.editingDishId);
        } else {
            const newRef = await push(dishesRef, data);
            logAudit("Catalog", `Added New Dish: ${name}`, newRef.key);
        }

        await mirrorToMenuBank(db, ref, set, 'dishes', data, _bankSource());

        hideDishModal();
        loadMenu();
    } catch (e) {
        showToast("Error: " + e.message, "error");
        if (statusLabel) statusLabel.classList.add('hidden');
    } finally {
        isProcessingDish = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = saveBtn.dataset.originalText || "Save Dish";
        }
    }
}

export async function deleteDish(dishId) {
    const snap = await get(Outlet.ref(`dishes/${dishId}`));
    const d = snap.val();
    const dishName = d?.name || "Unknown";

    if (!(await showDeleteConfirm(dishName))) return;

    try {
        const img = d?.image;
        if (img) await deleteImage(img);
        await remove(Outlet.ref(`dishes/${dishId}`));
        logAudit("Catalog", `Deleted Dish: ${dishName}`, dishId);
        showToast('Dish deleted', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}


/**
 * MODALS & UI
 */

export async function showDishModal(dishId = null) {
    resetDishValidation();
    state.editingDishId = dishId;
    const modal = document.getElementById('dishModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('active', 'flex');
    }

    if (state.categories.length === 0) loadCategories();
    else updateActiveDishModalCategories();

    const titleEl = document.getElementById('dishModalTitle');
    if (titleEl) titleEl.innerText = dishId ? 'Edit Dish' : 'Add New Dish';

    const statusLabel = document.getElementById('uploadStatus');
    if (statusLabel) statusLabel.classList.add('hidden');

    if (!dishId) {
        document.getElementById('dishName').value = '';
        document.getElementById('dishCategory').value = '';
        document.getElementById('dishPriceBase').value = '';
        document.getElementById('dishImage').value = '';
        document.getElementById('dishPreview').src = "https://placehold.co/100";
        document.getElementById('dishOrder').value = '';
        document.getElementById('dishVeg').value = 'veg';
        document.getElementById('sizesContainer').innerHTML = '';
        document.getElementById('addonsContainer').innerHTML = '';
    } else {
        const snap = await get(Outlet.ref(`dishes/${dishId}`));
        const d = snap.val();
        if (d) {
            document.getElementById('dishName').value = d.name || '';
            const select = document.getElementById('dishCategory');
            const catValue = d.category || '';
            
            if (catValue && !Array.from(select.options).some(opt => opt.value === catValue)) {
                const opt = document.createElement('option');
                opt.value = catValue;
                opt.innerText = catValue;
                select.appendChild(opt);
            }
            select.value = catValue;
            document.getElementById('dishPriceBase').value = d.price || '';
            document.getElementById('dishOrder').value = d.order || '';
            document.getElementById('dishImage').value = d.image || '';
            document.getElementById('dishPreview').src = d.image || "https://placehold.co/100";
            document.getElementById('dishVeg').value = d.veg === false ? 'nonveg' : 'veg';

            const sizesContainer = document.getElementById('sizesContainer');
            sizesContainer.innerHTML = '';
            if (d.sizes) {
                Object.entries(d.sizes).forEach(([name, price]) => {
                    addSizeField(name, price);
                });
            }

            const addonsContainer = document.getElementById('addonsContainer');
            addonsContainer.innerHTML = '';
            if (d.addons) {
                Object.entries(d.addons).forEach(([name, price]) => {
                    addDishAddonField(name, price);
                });
            }
        }
    }
}

export function hideDishModal() {
    const modal = document.getElementById('dishModal');
    if (modal) {
        modal.classList.remove('active', 'flex');
        modal.classList.add('hidden');
    }
    document.querySelectorAll('#dishModal .form-input').forEach(el => el.classList.remove('error', 'valid'));
    state.editingDishId = null;
    const fileInput = document.getElementById('dishFile');
    if (fileInput) fileInput.value = '';
}

export function showAddDishChoice() {
    const overlay = document.createElement('div');
    overlay.className = 'dynamic-modal-overlay';
    overlay.innerHTML = `
        <div class="dynamic-modal-box" style="max-width: 400px;">
            <div class="dynamic-modal-icon" style="font-size: 48px;">🍽️</div>
            <h3 class="dynamic-modal-title">Add Menu Item</h3>
            <p class="dynamic-modal-text">How would you like to add a new dish?</p>
            <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 24px;">
                <button class="btn-primary btn-choice" data-choice="self" style="justify-content: center; padding: 16px; font-size: 15px;">
                    <i data-lucide="edit-3" class="icon-20" style="margin-right: 10px;"></i>
                    <span>Add by yourself</span>
                    <span style="font-size: 11px; font-weight: 400; opacity: 0.8; margin-left: auto;">Create from scratch</span>
                </button>
                <button class="btn-secondary btn-choice" data-choice="bank" style="justify-content: center; padding: 16px; font-size: 15px;">
                    <i data-lucide="library" class="icon-20" style="margin-right: 10px;"></i>
                    <span>Browse menu items</span>
                    <span style="font-size: 11px; font-weight: 400; opacity: 0.8; margin-left: auto;">Pick from shared Menu Bank</span>
                </button>
            </div>
            <button class="btn-cancel" style="margin-top: 16px; width: 100%;" data-choice="cancel">Cancel</button>
        </div>`;
    document.body.appendChild(overlay);
    
    // Animate in
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    
    overlay.querySelectorAll('.btn-choice').forEach(btn => {
        btn.onclick = async () => {
            const choice = btn.dataset.choice;
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
            
            if (choice === 'self') {
                showDishModal();
            } else if (choice === 'bank') {
                const { openMenuBankBrowser } = await import('./menu-bank.js');
                openMenuBankBrowser();
            }
        };
    });
    
    overlay.querySelector('[data-choice="cancel"]').onclick = () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
    };
    
    overlay.onclick = (e) => { if (e.target === overlay) overlay.querySelector('[data-choice="cancel"]').click(); };
    
    // Load Lucide icons for the new buttons
    if (window.lucide) window.lucide.createIcons({ root: overlay });
}

export function resetDishValidation() {
    document.querySelectorAll('#dishModal .form-input').forEach(el => el.classList.remove('error', 'valid'));
}

export function updateActiveDishModalCategories() {
    const select = document.getElementById('dishCategory');
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">Choose Category...</option>';
    
    state.categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.name;
        option.innerText = cat.name;
        if (cat.name === currentVal) option.selected = true;
        select.appendChild(option);
    });
}

export function addSizeField(name = "", price = "") {
    const container = document.getElementById('sizesContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = "size-row flex-row flex-gap-10 mb-8";
    div.innerHTML = `
        <input placeholder="Size (e.g. Small)" value="${escapeHtml(name)}" class="form-input mb-0" style="flex:2">
        <input type="number" placeholder="Price" value="${escapeHtml(String(price))}" class="form-input mb-0" style="flex:1">
        <button data-action="removeParent" class="btn-text-danger" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:18px;">✕</button>
    `;
    container.appendChild(div);
}

function _addAddonField(containerId, cls, name = "", price = "") {
    const container = document.getElementById(containerId);
    if (!container) return;
    const div = document.createElement('div');
    div.className = cls + " flex-row flex-gap-10 mb-8";
    div.innerHTML = `
        <input placeholder="Addon Name" value="${escapeHtml(name)}" class="form-input mb-0" style="flex:2">
        <input type="number" placeholder="Price" value="${escapeHtml(String(price))}" class="form-input mb-0" style="flex:1">
        <button data-action="removeParent" class="btn-text-danger">✕</button>
    `;
    container.appendChild(div);
}

export function addDishAddonField(name = "", price = "") {
    _addAddonField('addonsContainer', 'addon-row', name, price);
}

export function addCategoryAddonField(name = "", price = "") {
    _addAddonField('categoryAddonsList', 'addon-row-small', name, price);
}

export function addCategoryEditAddonField(name = "", price = "") {
    _addAddonField('catEditAddonsList', 'addon-row-small', name, price);
}

/**
 * CLEANUP CATALOG LISTENERS
 */
export function cleanupCatalog() {
    console.log("[Catalog] Detaching listeners...");
    if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
    if (_dishesUnsub) { _dishesUnsub(); _dishesUnsub = null; }
    if (_combosUnsub) { _combosUnsub(); _combosUnsub = null; }
}

export const toggleDishAvailable = (id, available) => update(Outlet.ref(`dishes/${id}`), { stock: available });
export const editDish = (id) => showDishModal(id);
let _editingCatId = null;

export const editCategory = async (id) => {
    const cat = state.categories?.find(c => c.id === id);
    if (!cat) return showToast("Category not found", "error");
    _editingCatId = id;

    document.getElementById('categoryEditorTitle').textContent = `Edit: ${cat.name}`;
    document.getElementById('catEditName').value = cat.name || '';
    document.getElementById('catEditOrder').value = cat.order || 0;
    document.getElementById('catEditPreview').src = cat.image || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23f1f5f9\' width=\'100\' height=\'100\' rx=\'8\'/%3E%3Ctext x=\'50\' y=\'55\' text-anchor=\'middle\' fill=\'%2394a3b8\' font-size=\'10\' font-family=\'sans-serif\'%3ECategory%3C/text%3E%3C/svg%3E';

    const addonsList = document.getElementById('catEditAddonsList');
    addonsList.innerHTML = '';
    if (cat.addons) {
        Object.entries(cat.addons).forEach(([name, price]) => {
            addCategoryEditAddonField(name, price);
        });
    }

    document.getElementById('categoryEditorModal').classList.add('active');
};

export function hideCategoryModal() {
    const modal = document.getElementById('categoryEditorModal');
    if (modal) {
        modal.classList.remove('active', 'flex');
        modal.classList.add('hidden');
    }
    _editingCatId = null;
    const fileInput = document.getElementById('catEditFile');
    if (fileInput) fileInput.value = '';
}

export async function saveCategoryEdits() {
    const id = _editingCatId;
    if (!id) return showToast('No category selected', 'error');
    const cat = state.categories?.find(c => c.id === id);
    if (!cat) return showToast('Category not found', 'error');

    const name = document.getElementById('catEditName').value.trim();
    const order = parseInt(document.getElementById('catEditOrder').value) || 0;
    const fileInput = document.getElementById('catEditFile');

    if (!name) return showToast('Category name is required', 'warning');

    const existingCats = state.categories || [];
    if (existingCats.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
        return showToast('A category with this name already exists', 'warning');
    }

    let imageUrl = cat.image;
    if (fileInput.files && fileInput.files[0]) {
        try {
            imageUrl = await uploadImage(fileInput.files[0], `categories/${id}_${Date.now()}_${fileInput.files[0].name}`);
        } catch (e) {
            console.error('[Catalog] Image upload failed:', e);
            return showToast('Failed to upload image', 'error');
        }
    }

    const addonRows = document.querySelectorAll('#catEditAddonsList .addon-row-small');
    const addons = {};
    addonRows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const aName = inputs[0]?.value.trim();
        const aPrice = parseFloat(inputs[1]?.value) || 0;
        if (aName) addons[aName] = aPrice;
    });

    try {
        const payload = { name, order, image: imageUrl };
        if (Object.keys(addons).length > 0) payload.addons = addons;
        await update(Outlet.ref(`categories/${id}`), payload);
        logAudit('Category Edit', `Updated "${cat.name}" â†’ "${name}"`, 'Catalog');
        await mirrorToMenuBank(db, ref, set, 'categories', { ...cat, ...payload }, _bankSource());
        showToast('Category updated!', 'success');
        document.getElementById('categoryEditorModal').classList.remove('active');
        _editingCatId = null;
        fileInput.value = '';
    } catch (e) {
        console.error('[Catalog] Category save failed:', e);
        showToast('Failed to save category', 'error');
    }
}

export function filterMenu(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const cards = document.querySelectorAll('#menuGrid .dish-card');
    
    cards.forEach(card => {
        if (!term) {
            card.style.display = '';
            return;
        }
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(term) ? '' : 'none';
    });
}

export function filterCategories(searchTerm) {
    const term = (searchTerm || '').toLowerCase().trim();
    const items = document.querySelectorAll('#categoryList > div');
    
    items.forEach(item => {
        if (!term) {
            item.style.display = '';
            return;
        }
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(term) ? '' : 'none';
    });
}

/**
 * MIGRATION TOOLS
 */
export async function migrateAddonsToCategories() {
    requireAdminReauth(async () => {
        if (!(await showConfirm("CRITICAL: This will move all dish-level addons to their parent categories. Proceed?", "Migration Confirmation"))) return;
        try {
            console.log("Starting add-on migration...");
            const dishesSnap = await get(Outlet.ref(`dishes`));
            const categoriesSnap = await get(Outlet.ref('categories'));

            const dishes = dishesSnap.val() || {};
            const categoriesData = categoriesSnap.val() || {};

            const categoryAddons = {};

            // Note: If dishes structure is scoped by outlet, this loop works. 
            // If it's already scoped by Outlet.ref, dishes is a record of dishes.
            Object.keys(dishes).forEach(key => {
                const dish = dishes[key];
                if (dish && typeof dish === 'object' && dish.category && dish.addons) {
                    if (!categoryAddons[dish.category]) categoryAddons[dish.category] = {};
                    Object.entries(dish.addons).forEach(([name, price]) => {
                        categoryAddons[dish.category][name] = price;
                    });
                }
            });

            const updates = {};
            Object.entries(categoriesData).forEach(([catId, cat]) => {
                if (categoryAddons[cat.name]) {
                    updates[`categories/${catId}/addons`] = categoryAddons[cat.name];
                }
            });

            if (Object.keys(updates).length > 0) {
                await Outlet.multiUpdate(updates);
                logAudit("Maintenance", "Migrated Dish Add-ons to Categories", "Global");
                showToast("Success: Add-ons migrated to categories!", "success");
            } else {
                showToast("No add-ons found to migrate.", "info");
            }
        } catch (e) {
            showToast("Migration failed: " + e.message, "error");
        }
    });
}

export async function runImageMigration() {
    requireAdminReauth(async () => {
        if (!(await showConfirm("This will convert images to Base64 text. This process might take a minute. Proceed?", "Image Migration"))) return;

        try {
            console.log("ðŸš€ Starting Image Migration...");
            const updates = {};

            async function convertUrlToDataUri(url) {
                if (!url || !url.includes("firebasestorage.googleapis.com")) return url;
                try {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    return await uploadImage(blob, "temp");
                } catch (err) {
                    console.error("Failed to convert image:", url, err);
                    return url;
                }
            }

            const dishesSnap = await get(Outlet.ref('dishes'));
            const dishesData = dishesSnap.val();
            if (dishesData) {
                for (const id in dishesData) {
                    if (dishesData[id].image && dishesData[id].image.includes("firebasestorage")) {
                        console.log("Migrating Dish:", dishesData[id].name);
                        const b64 = await convertUrlToDataUri(dishesData[id].image);
                        updates[`dishes/${id}/image`] = b64;
                    }
                }
            }

            const catsSnap = await get(Outlet.ref('categories'));
            const catsData = catsSnap.val();
            if (catsData) {
                for (const id in catsData) {
                    if (catsData[id].image && catsData[id].image.includes("firebasestorage")) {
                        console.log("Migrating Category:", catsData[id].name);
                        const b64 = await convertUrlToDataUri(catsData[id].image);
                        updates[`categories/${id}/image`] = b64;
                    }
                }
            }

            if (Object.keys(updates).length > 0) {
                await Outlet.multiUpdate(updates);
                logAudit("Maintenance", "Converted legacy images to DataURIs", "Global");
                showToast("Success: All images migrated!", "success");
                location.reload();
            } else {
                showToast("No legacy images found.", "info");
            }
        } catch (err) {
            console.error("Migration Failed:", err);
            showToast("Critical Error: Migration failed.", "error");
        }
    });
}

// ---------------- Combo Offers (RTDB: outlets/{oid}/combos/{cid}) ----------------
let _combosUnsub = null;

export function loadCombos() {
    if (_combosUnsub) { _combosUnsub(); _combosUnsub = null; }
    const tbody = document.getElementById('comboListBody');
    const empty = document.getElementById('noCombosMsg');
    if (!tbody) return;
    tbody.innerHTML = getSkeletonRows(3, 7);
    _combosUnsub = onValue(Outlet.ref('combos'), async snap => {
        const combos = [];
        snap.forEach(ch => combos.push({ id: ch.key, ...ch.val() }));
        if (combos.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        let dishInfo = {};
        try {
            const dishesSnap = await get(Outlet.ref('dishes'));
            dishesSnap.forEach(ch => {
                const d = ch.val();
                dishInfo[ch.key] = { name: d?.name || ch.key, price: Number(d?.price ?? (d?.sizes ? Object.values(d.sizes)[0] : 0)) || 0 };
            });
        } catch (_) {}
        tbody.innerHTML = combos.map(c => {
            const active = isComboActive(c);
            const disabled = c.disabled === true;
            const itemsTxt = (c.items || []).map(it => `${dishInfo[it.dishId]?.name || it.dishId} x${it.qty}`).join(', ');
            const disc = c.discountType === 'percentage' ? `${c.discountValue}% off` : `₹${c.discountValue} off`;
            const orig = (c.items || []).reduce((s, it) => s + ((dishInfo[it.dishId]?.price ?? Number(it.price)) || 0) * (it.qty || 1), 0);
            const price = comboPriceTotal(orig, c.discountType, c.discountValue);
            const fmt = ms => ms ? new Date(ms).toLocaleDateString() : '—';
            const statusLabel = disabled ? 'Disabled' : (active ? 'Active' : 'Expired');
            const statusClass = disabled ? 'disabled' : (active ? 'available' : 'out');
            const maxRed = c.maxRedemptions || 0;
            const perCust = c.perCustomerLimit || 0;
            const perDay = c.perDayLimit || 0;
            const used = c.currentRedemptions || 0;
            const capText = [
                maxRed > 0 ? `Total: ${used}/${maxRed}` : 'Total: ∞',
                perCust > 0 ? `Cust: 0/${perCust}` : 'Cust: ∞',
                perDay > 0 ? `Day: 0/${perDay}` : 'Day: ∞'
            ].join(' · ');
            return `
            <tr class="glass-card p-20">
                <td>
                    <div style="font-weight:800;">${escapeHtml(c.name || 'Unnamed Combo')}</div>
                </td>
                <td style="font-size:13px;color:var(--text-secondary);">${escapeHtml(itemsTxt)}</td>
                <td style="font-weight:700;">₹${orig} → ₹${price}</td>
                <td style="font-weight:700;color:var(--text-secondary);">${escapeHtml(disc)}</td>
                <td style="font-size:12px;color:var(--text-secondary);">${capText}</td>
                <td>
                    <span class="stock-badge ${statusClass}">${statusLabel}</span>
                </td>
                <td style="font-size:12px;color:var(--text-secondary);">${fmt(c.startAt)} → ${fmt(c.endAt)}</td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" data-action="toggleCombo" data-id="${c.id}" ${disabled ? '' : 'checked'} onchange="window.__toggleCombo('${c.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="btn-secondary btn-small" data-action="editCombo" data-id="${c.id}"><i data-lucide="edit-3" class="icon-14"></i></button>
                    <button class="btn-secondary btn-small" data-action="deleteCombo" data-id="${c.id}"><i data-lucide="trash-2" class="icon-14"></i></button>
                </td>
            </tr>`;
        }).join('');
        loadLucide().then(() => window.lucide?.createIcons({ root: tbody }));
    });
}

window.__toggleCombo = async (id, enabled) => {
    try {
        await update(Outlet.ref(`combos/${id}`), {
            disabled: !enabled,
            disabledAt: !enabled ? Date.now() : null,
            disabledBy: !enabled ? (window.currentUserId || 'admin') : null
        });
        showToast(`${!enabled ? 'Paused' : 'Activated'} combo`, 'success');
    } catch (e) {
        console.error('[Combos] Toggle failed:', e);
        showToast('Failed to update combo status', 'error');
    }
};

export const editCombo = (id) => showComboModal(id);

export async function deleteCombo(id) {
    const comboSnap = await get(Outlet.ref(`combos/${id}`));
    const val = comboSnap.val();
    const name = val?.name || 'this combo';
    if (!(await showDeleteConfirm(name, "Delete this combo? This cannot be undone."))) return;
    try {
        await remove(Outlet.ref(`combos/${id}`));
        if (val?.image) deleteImage(val.image).catch(err => console.warn("[Combos] Image deletion failed:", err));
        logAudit("Catalog", `Deleted Combo: ${name}`, id);
        showToast("Combo deleted", "success");
    } catch (err) {
        console.error("[Combos] Delete failed:", err);
        showToast("Failed to delete combo.", "error");
    }
}

const _dishPrice = d => Number(d?.price ?? (d?.sizes ? Object.values(d.sizes)[0] : 0)) || 0;
const _parseLocalDate = (v, endOfDay) => {
    const [y, m, d] = String(v || '').split('-').map(Number);
    if (!y || !m || !d) return NaN;
    return new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
};
const _toInputDate = ms => {
    const d = ms ? new Date(ms) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function showComboModal(comboId = null) {
    if (!window.currentOutlet || window.currentOutlet === 'null' || window.currentOutlet === 'undefined') {
        return showToast("Error: Current outlet context is missing. Please refresh or select an outlet first.", "error");
    }
    document.getElementById('comboModal')?.remove();

    const dishesSnap = await get(Outlet.ref('dishes'));
    const dishes = [];
    dishesSnap.forEach(ch => { const v = ch.val(); if (v) dishes.push({ id: ch.key, ...v }); });

    // Fetch existing coupon codes for the association dropdown
    const couponDiscountsSnap = await get(Outlet.ref('discounts'));
    const couponOptions = [];
    couponDiscountsSnap.forEach(ch => {
        const d = ch.val();
        if (d && d.type === 'coupon' && d.enabled !== false && d.couponCode) {
            couponOptions.push(`<option value="${escapeHtml(d.couponCode)}"${combo?.couponCode === d.couponCode ? ' selected' : ''}>${escapeHtml(d.couponCode)} — ${escapeHtml(d.name || d.couponCode)}</option>`);
        }
    });

    let combo = null;
    if (comboId) {
        const snap = await get(Outlet.ref(`combos/${comboId}`));
        combo = snap.exists() ? snap.val() : null;
    }

    const sel = new Map();
    Object.values(combo?.items || {}).forEach(it => sel.set(it.dishId, Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 20)));

    const today = _toInputDate(Date.now());
    const in30 = _toInputDate(Date.now() + 30 * 86400000);

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal active" id="comboModal" role="dialog" aria-modal="true" aria-label="${comboId ? 'Edit Combo' : 'Create Combo'}">
        <div class="modal-content glass-card" style="max-width:640px;">
            <div class="modal-header">
                <h2 class="modal-title">${comboId ? 'Edit Combo' : 'Create Combo'}</h2>
                <button class="close-btn" id="comboModalClose" aria-label="Close" title="Close"><i data-lucide="x" class="icon-18"></i></button>
            </div>
            <form id="comboForm" novalidate>
                <style>
                    #comboDishList { max-height: 280px; overflow: auto; border: 1px solid var(--card-border, #e5e7eb); border-radius: 12px; }
                    .cmb-sec { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-sub, #888); margin: 20px 0 10px; }
                    .cmb-media { display: flex; gap: 16px; align-items: flex-start; }
                    .cmb-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
                    .cmb-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--card-border, #f0f0f0); transition: background 150ms ease; }
                    .cmb-row:last-child { border-bottom: none; }
                    .cmb-row.on { background: rgba(34, 197, 94, 0.08); }
                    .cmb-row label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px; }
                    .cmb-row .cmb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .cmb-row .cmb-price { color: var(--text-sub, #666); font-size: 13px; font-weight: 600; flex-shrink: 0; }
                    .cmb-qty { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
                    .cmb-qty button { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--card-border, #ddd); background: var(--surface, #fff); font-weight: 700; cursor: pointer; line-height: 1; font-size: 16px; transition: all 150ms ease; }
                    .cmb-qty button:hover { background: var(--primary-light, #fef0e8); border-color: var(--primary, #E84908); }
                    .cmb-qty button:focus-visible { outline: 2px solid var(--primary, #E84908); outline-offset: 2px; }
                    .cmb-qty span { min-width: 24px; text-align: center; font-size: 14px; font-weight: 700; }
                    .cmb-qty.off { opacity: 0.4; pointer-events: none; }
                    #comboPriceStrip { margin-top: 12px; padding: 12px 16px; border-radius: 12px; background: linear-gradient(135deg, var(--primary-light, #fef0e8) 0%, var(--primary-lighter, rgba(232,73,8,0.08)) 100%); border: 1px solid var(--primary-light, #ffe0c2); font-size: 14px; font-weight: 600; color: var(--primary-dark, #c43d00); }
                    .cmb-err { color: var(--error, #d32f2f); font-size: 12px; margin-top: 6px; display: none; animation: errFade 200ms ease; }
                    .cmb-err.show { display: block; }
                    .cmb-empty { padding: 24px; text-align: center; color: var(--text-sub, #888); font-size: 14px; }
                    @keyframes errFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                    .form-row label { display: block; font-size: 12px; font-weight: 600; color: var(--text-main, #333); margin-bottom: 6px; }
                </style>
                <div class="cmb-media">
                    <div class="modal-media-upload img-placeholder" id="comboPreviewWrap" style="width:128px;height:128px;flex-shrink:0;border-radius:16px;overflow:hidden;">
                        <div class="cmb-img-empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;background:linear-gradient(135deg,var(--neutral-50,#f8fafc) 0%,var(--neutral-100,#f1f5f9) 100%);">
                            <i data-lucide="image" class="icon-36" style="color:var(--neutral-400,#94a3b8);"></i>
                            <span style="font-size:12px;color:var(--neutral-500,#64748b);">No image</span>
                        </div>
                        <img id="comboPreview" class="modal-img-preview hidden" alt="Combo preview" style="width:100%;height:100%;object-fit:cover;">
                        <div class="modal-img-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 200ms ease;">
                            <input type="file" id="comboFile" accept="image/*" class="hidden" title="Upload combo photo">
                            <button type="button" id="btnUpdateComboPhoto" class="btn-secondary update-photo-btn" style="color:#fff;border-color:rgba(255,255,255,0.5);">Update Photo</button>
                        </div>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <div class="cmb-sec" style="margin-top:0;">Details</div>
                        <label for="comboName" class="visually-hidden">Combo Name</label>
                        <input type="text" id="comboName" class="form-input" maxlength="50" placeholder="e.g. Family Pizza Deal" value="${escapeHtml(combo?.name || '')}" aria-describedby="errName comboNameHint">
                        <small id="comboNameHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Descriptive name customers will see</small>
                        <div class="cmb-err" id="errName" role="alert" aria-live="polite">Enter a combo name</div>
                        <small id="comboUploadStatus" class="hidden upload-status-text" style="display:block;margin-top:6px;text-align:left;color:var(--primary);font-size:12px;">Uploading...</small>
                    </div>
                </div>
                <div class="cmb-sec">Dishes</div>
                <label for="comboDishSearch" class="visually-hidden">Search dishes</label>
                <input type="text" id="comboDishSearch" class="form-input" placeholder="Search dishes..." autocomplete="off" style="margin-bottom:10px;" aria-describedby="dishSearchHint">
                <small id="dishSearchHint" class="form-hint" style="display:block;margin-bottom:8px;color:var(--text-sub);font-size:12px;">Type to filter, click checkbox or +/- to add</small>
                <div id="comboDishList" role="listbox" aria-multiselectable="true" aria-label="Available dishes"></div>
                <div class="cmb-err" id="errDishes" role="alert" aria-live="polite">Select at least one dish</div>
                <div id="comboPriceStrip" aria-live="polite" aria-atomic="true"></div>
                <div class="cmb-sec">Discount & Schedule</div>
                <div class="cmb-grid2">
                    <div class="form-row" style="margin:0;">
                        <label for="comboDiscountType">Discount Type</label>
                        <select id="comboDiscountType" class="form-input" aria-describedby="discountTypeHint">
                            <option value="percentage" ${combo?.discountType !== 'fixed' ? 'selected' : ''}>Percentage (%) off</option>
                            <option value="fixed" ${combo?.discountType === 'fixed' ? 'selected' : ''}>Fixed Amount (₹) off</option>
                        </select>
                        <small id="discountTypeHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Percentage applies to each dish total</small>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label for="comboDiscountValue">Discount Value</label>
                        <input type="number" id="comboDiscountValue" class="form-input" min="0" step="1" value="${combo?.discountValue ?? 20}" aria-describedby="errDiscount discountValueHint">
                        <small id="discountValueHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0-100 for percentage, up to total for fixed</small>
                        <div class="cmb-err" id="errDiscount" role="alert" aria-live="polite">Enter a valid discount</div>
                    </div>
                </div>
                <div class="cmb-grid2">
                    <div class="form-row" style="margin:0;">
                        <label for="comboStartAt">Active From</label>
                        <input type="date" id="comboStartAt" class="form-input" value="${combo ? _toInputDate(combo.startAt) : today}" aria-describedby="errDates">
                        <div class="cmb-err" id="errDates" role="alert" aria-live="polite">End date must be after start date</div>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label for="comboEndAt">Active Until</label>
                        <input type="date" id="comboEndAt" class="form-input" value="${combo ? _toInputDate(combo.endAt) : in30}" aria-describedby="errDates">
                    </div>
                </div>
                <div class="cmb-sec">Redemption Caps</div>
                <div class="cmb-grid2">
                    <div class="form-row" style="margin:0;">
                        <label for="comboMaxRedemptions">Max Total Redemptions</label>
                        <input type="number" id="comboMaxRedemptions" class="form-input" min="0" step="1" value="${combo?.maxRedemptions ?? 0}" aria-describedby="maxRedemptionsHint">
                        <small id="maxRedemptionsHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label for="comboPerCustomerLimit">Max Per Customer</label>
                        <input type="number" id="comboPerCustomerLimit" class="form-input" min="0" step="1" value="${combo?.perCustomerLimit ?? 0}" aria-describedby="perCustomerHint">
                        <small id="perCustomerHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label for="comboPerDayLimit">Max Per Day</label>
                        <input type="number" id="comboPerDayLimit" class="form-input" min="0" step="1" value="${combo?.perDayLimit ?? 0}" aria-describedby="perDayHint">
                        <small id="perDayHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                </div>
                <div class="cmb-sec">Coupon Code (Optional)</div>
                <div class="cmb-grid2">
                    <div class="form-row" style="margin:0;">
                        <label for="comboCouponCode">Require Coupon Code</label>
                        <select id="comboCouponCode" class="form-input" aria-describedby="couponHint">
                            <option value="">None (open to all)</option>
                            ${couponOptions || ''}
                        </select>
                        <small id="couponHint" class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Customers must enter this code at checkout to redeem the combo</small>
                    </div>
                </div>
                <div class="modal-footer">
                </div>
            </form>
        </div>
    </div>`);
    loadLucide().then(() => window.lucide?.createIcons({ root: document.getElementById('comboModal') }));

    const modal = document.getElementById('comboModal');
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    let focusableElements = [];
    let firstFocusable = null;
    let lastFocusable = null;

    const updateFocusables = () => {
        focusableElements = Array.from(modal.querySelectorAll(focusableSelector)).filter(el => !el.disabled && el.offsetParent !== null);
        firstFocusable = focusableElements[0];
        lastFocusable = focusableElements[focusableElements.length - 1];
    };

    const trapFocus = (e) => {
        if (e.key !== 'Tab') return;
        updateFocusables();
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable?.focus();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable?.focus();
            }
        }
    };

    const onEsc = e => { if (e.key === 'Escape') close(); };
    const close = () => {
        document.removeEventListener('keydown', onEsc);
        document.removeEventListener('keydown', trapFocus);
        modal.classList.remove('active');
        modal.classList.add('closing');
        setTimeout(() => modal.remove(), prefersReduced ? 0 : 200);
    };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('keydown', trapFocus);
    document.getElementById('comboModalClose').addEventListener('click', close);
    document.getElementById('comboCancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    if (!prefersReduced) {
        modal.querySelector('.modal-content').style.animation = 'modalSlideIn .3s cubic-bezier(.4,0,.2,1)';
    }

    updateFocusables();
    firstFocusable?.focus();

    const listEl = document.getElementById('comboDishList');
    const valInput = document.getElementById('comboDiscountValue');
    const typeSel = document.getElementById('comboDiscountType');

    function renderDishRows(filter = '') {
        const q = filter.trim().toLowerCase();
        const rows = dishes.filter(d => !q || (d.name || '').toLowerCase().includes(q));
        if (!rows.length) { listEl.innerHTML = `<div class="cmb-empty">No dishes found</div>`; return; }
        listEl.innerHTML = rows.map(d => {
            const on = sel.has(d.id);
            const qty = sel.get(d.id) || 1;
            return `
            <div class="cmb-row ${on ? 'on' : ''}" data-id="${d.id}" role="option" aria-selected="${on}" tabindex="0">
                <label><input type="checkbox" data-act="toggle" ${on ? 'checked' : ''} aria-label="Include ${escapeHtml(d.name)}"> <span class="cmb-name">${escapeHtml(d.name)}</span></label>
                <span class="cmb-price">₹${_dishPrice(d)}</span>
                <div class="cmb-qty ${on ? '' : 'off'}" role="group" aria-label="${on ? 'Quantity' : 'Add to combo'}">
                    <button type="button" data-act="dec" aria-label="Decrease quantity of ${escapeHtml(d.name)}" ${on ? '' : 'disabled'}>−</button>
                    <span aria-live="polite">${qty}</span>
                    <button type="button" data-act="inc" aria-label="Increase quantity of ${escapeHtml(d.name)}" ${on ? '' : 'disabled'}>+</button>
                </div>
            </div>`;
        }).join('');
        updatePreview();
    }

    function selectedEntries() {
        return dishes.filter(d => sel.has(d.id)).map(d => ({ base: _dishPrice(d), qty: sel.get(d.id) }));
    }

    function updatePreview() {
        const el = document.getElementById('comboPriceStrip');
        const entries = selectedEntries();
        if (!entries.length) { el.textContent = ''; return; }
        const type = typeSel.value;
        const value = parseFloat(valInput.value) || 0;
        const original = entries.reduce((s, e) => s + e.base * e.qty, 0);
        const price = comboPriceTotal(original, type, value);
        const disc = type === 'percentage' ? `${Math.min(value, 100)}% off` : `₹${value} off`;
        el.textContent = `Original ₹${original} → Combo ₹${price}  ·  You save ₹${original - price} (${disc})`;
    }

    listEl.addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        e.preventDefault();
        const id = btn.closest('.cmb-row').dataset.id;
        if (!sel.has(id)) sel.set(id, 1);
        const next = (sel.get(id) || 1) + (btn.dataset.act === 'inc' ? 1 : -1);
        if (next < 1) sel.delete(id);
        else if (next > 20) showToast("Max 20 per dish", "warning");
        else sel.set(id, next);
        renderDishRows(document.getElementById('comboDishSearch').value);
    });
    listEl.addEventListener('keydown', e => {
        if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) return;
        const rows = Array.from(listEl.querySelectorAll('.cmb-row'));
        const currentIndex = rows.findIndex(r => r === document.activeElement || r.contains(document.activeElement));
        if (currentIndex === -1) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = rows[(currentIndex + 1) % rows.length];
            next.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = rows[(currentIndex - 1 + rows.length) % rows.length];
            prev.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            const row = rows[currentIndex];
            const checkbox = row.querySelector('input[type="checkbox"]');
            if (checkbox) {
                e.preventDefault();
                checkbox.click();
            }
        }
    });
    listEl.addEventListener('change', e => {
        if (e.target.dataset.act !== 'toggle') return;
        const id = e.target.closest('.cmb-row').dataset.id;
        if (e.target.checked) sel.set(id, 1); else sel.delete(id);
        renderDishRows(document.getElementById('comboDishSearch').value);
    });
    document.getElementById('comboDishSearch').addEventListener('input', e => renderDishRows(e.target.value));
    valInput.addEventListener('input', updatePreview);
    typeSel.addEventListener('change', () => {
        valInput.max = typeSel.value === 'percentage' ? '100' : '';
        updatePreview();
    });
    valInput.max = combo?.discountType === 'fixed' ? '' : '100';
    renderDishRows();

    const fileInput = document.getElementById('comboFile');
    document.getElementById('btnUpdateComboPhoto').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (!fileInput.files[0]) return;
        previewImage(fileInput, 'comboPreview');
        document.getElementById('comboPreviewWrap').classList.remove('img-placeholder');
        document.getElementById('comboPreview').classList.remove('hidden');
        document.querySelector('#comboPreviewWrap .cmb-img-empty')?.style.setProperty('display', 'none');
    });
    if (combo?.image) {
        document.getElementById('comboPreviewWrap').classList.remove('img-placeholder');
        const img = document.getElementById('comboPreview');
        img.src = combo.image;
        img.classList.remove('hidden');
        document.querySelector('#comboPreviewWrap .cmb-img-empty')?.style.setProperty('display', 'none');
    }

    const showErr = (id, msg) => { const el = document.getElementById(id); if (msg) el.textContent = msg; el.classList.add('show'); };
    const clearErrs = () => modal.querySelectorAll('.cmb-err').forEach(el => el.classList.remove('show'));

    let comboSaving = false;
    document.getElementById('comboForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (comboSaving) return;
        clearErrs();
        const name = document.getElementById('comboName').value.trim();
        const type = typeSel.value;
        const value = parseFloat(valInput.value);
        const startAt = _parseLocalDate(document.getElementById('comboStartAt').value, false);
        const endAt = _parseLocalDate(document.getElementById('comboEndAt').value, true);
        const entries = selectedEntries();
        const original = entries.reduce((s, x) => s + x.base * x.qty, 0);
        const maxRedemptions = parseInt(document.getElementById('comboMaxRedemptions').value) || 0;
        const perCustomerLimit = parseInt(document.getElementById('comboPerCustomerLimit').value) || 0;
        const perDayLimit = parseInt(document.getElementById('comboPerDayLimit').value) || 0;
        const couponCode = document.getElementById('comboCouponCode')?.value.trim() || null;

        let ok = true;
        if (!name) { showErr('errName', 'Enter a combo name'); document.getElementById('comboName').focus(); ok = false; }
        if (!entries.length) { showErr('errDishes', 'Select at least one dish'); document.getElementById('comboDishSearch').focus(); ok = false; }
        if (!(value >= 0) || (type === 'percentage' && value > 100) || (type === 'fixed' && entries.length && value > original)) {
            showErr('errDiscount', type === 'percentage' ? 'Percentage must be 0–100' : `Fixed amount can't exceed ₹${original}`);
            valInput.focus(); ok = false;
        }
        if (!startAt || !endAt || !(endAt > startAt)) { showErr('errDates', 'End date must be after start date'); document.getElementById('comboStartAt').focus(); ok = false; }
        if (maxRedemptions < 0 || perCustomerLimit < 0 || perDayLimit < 0) {
            showErr('errDiscount', 'Redemption caps cannot be negative'); ok = false;
        }
        if (!ok) return;

        const items = dishes.filter(d => sel.has(d.id)).map(d => ({
            dishId: d.id, qty: sel.get(d.id), price: _dishPrice(d)
        }));

        const file = fileInput.files[0];
        const statusEl = document.getElementById('comboUploadStatus');
        const saveBtn = document.querySelector('#comboForm .btn-primary');

        try {
            comboSaving = true;
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<span class="spinner-sm"></span> Saving...';
            }
            let image = combo?.image || null;
            if (file) {
                statusEl.classList.remove('hidden');
                image = await uploadImage(file, `combos/${Date.now()}_${file.name}`);
                if (combo?.image && image !== combo.image) {
                    deleteImage(combo.image).catch(err => console.warn("[Combos] Old image deletion failed:", err));
                }
                statusEl.classList.add('hidden');
            }

            const payload = {
                name, items, discountType: type, discountValue: value, startAt, endAt,
                image,
                maxRedemptions: maxRedemptions > 0 ? maxRedemptions : null,
                perCustomerLimit: perCustomerLimit > 0 ? perCustomerLimit : null,
                perDayLimit: perDayLimit > 0 ? perDayLimit : null,
                couponCode,
                sourceOid: Outlet.current,
                updatedAt: Date.now()
            };

            if (comboId) {
                await update(Outlet.ref(`combos/${comboId}`), payload);
                logAudit("Catalog", `Updated Combo: ${name}`, comboId);
                showToast("Combo updated!", "success");
            } else {
                await set(push(Outlet.ref('combos')), { ...payload, createdAt: Date.now() });
                logAudit("Catalog", `Added Combo: ${name}`, Outlet.current);
                showToast("Combo created!", "success");
            }
            close();
        } catch (err) {
            console.error("[Combos] Save failed:", err);
            showToast("Failed to save combo: " + err.message, "error");
            if (statusEl) statusEl.classList.add('hidden');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = `${comboId ? 'Update' : 'Create'} Combo`; }
        } finally {
            comboSaving = false;
        }
    });
}
