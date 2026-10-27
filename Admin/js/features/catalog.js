import { Outlet, BUSINESS_ID, db, uploadImage, deleteImage, ref, get, set, update, remove, push, onValue, child } from '../firebase.js';
import { showToast, escapeHtml, logAudit, getSkeletonRows, getSkeletonDivs, previewImage } from '../utils.js';
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
                        <span class="sub" style="font-size:10px;">${subParts.join(' · ')}</span>
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
            btn.innerHTML = '🚀 Add Category';
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
                            <span class="dish-price-val">₹${escapeHtml(String(price))}</span>
                        </div>
                    `).join("")}
                </div>`;
            } else {
                sizesHtml = `
                <div class="dish-pricing-box flex-between">
                    <span style="font-size:12px; color:var(--text-muted)">Standard</span>
                    <span class="dish-price-val" style="font-size:15px;">₹${escapeHtml(String(d.price || 0))}</span>
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
        logAudit('Category Edit', `Updated "${cat.name}" → "${name}"`, 'Catalog');
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
            console.log("🚀 Starting Image Migration...");
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
    tbody.innerHTML = getSkeletonDivs(4);
    _combosUnsub = onValue(Outlet.ref('combos'), async snap => {
        const combos = [];
        snap.forEach(ch => { combos.push({ id: ch.key, ...ch.val() }); });
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
            <div class="browser-dish-card combo-card" data-combo-id="${c.id}">
                <div class="browser-dish-select"><input type="checkbox" class="combo-row-select" data-id="${c.id}"></div>
                <div class="browser-dish-img">
                    <img src="${escapeHtml(c.image || 'https://placehold.co/200/orange/white?text=Combo')}" alt="${escapeHtml(c.name || 'Combo')}">
                    <div class="browser-dish-stock ${statusClass}">${statusLabel}</div>
                    ${disc ? `<div class="combo-disc-chip">${escapeHtml(disc)}</div>` : ''}
                </div>
                <div class="browser-dish-info">
                    <div class="browser-dish-name" title="${escapeHtml(c.name || 'Unnamed Combo')}">${escapeHtml(c.name || 'Unnamed Combo')}</div>
                    <div class="browser-dish-category" title="${escapeHtml(itemsTxt)}">${escapeHtml(itemsTxt)}</div>
                    <div class="browser-dish-pricing">
                        <span class="browser-price-chip combo-price-orig"><s>₹${orig}</s></span>
                        <span class="browser-price-chip combo-price-final">₹${price}</span>
                    </div>
                    <div class="browser-dish-category combo-meta" style="font-size:11px;">${fmt(c.startAt)} → ${fmt(c.endAt)} · ${escapeHtml(capText)}</div>
                    <div class="browser-dish-actions">
                        <label class="toggle-switch combo-toggle" title="${disabled ? 'Enable combo' : 'Pause combo'}">
                            <input type="checkbox" data-action="toggleCombo" data-id="${c.id}" ${disabled ? '' : 'checked'} onchange="window.__toggleCombo('${c.id}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                        <button class="btn-action-v4" data-action="editCombo" data-id="${c.id}" title="Edit Combo"><i data-lucide="edit-3" style="width:14px;"></i></button>
                        <button class="btn-action-v4 danger" data-action="deleteCombo" data-id="${c.id}" title="Delete Combo"><i data-lucide="trash-2" style="width:14px;"></i></button>
                    </div>
                </div>
            </div>`;
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
        loadCombos();
    } catch (e) {
        console.error('[Combos] Toggle failed:', e);
        showToast('Failed to update combo status', 'error');
    }
};

window.__bulkToggleCombos = async (enable) => {
    const selected = document.querySelectorAll('#comboListBody .combo-row-select:checked');
    if (selected.length === 0) return;
    try {
        await Promise.all(Array.from(selected).map(el =>
            update(Outlet.ref(`combos/${el.dataset.id}`), {
                disabled: !enable,
                disabledAt: !enable ? Date.now() : null,
                disabledBy: !enable ? (window.currentUserId || 'admin') : null
            })
        ));
        showToast(`${enable ? 'Enabled' : 'Paused'} ${selected.length} combo${selected.length > 1 ? 's' : ''}`, 'success');
        loadCombos();
    } catch (e) {
        console.error('[Combos] Bulk toggle failed:', e);
        showToast('Failed to update combos', 'error');
    }
};

window.__bulkDeleteCombos = async () => {
    const selected = document.querySelectorAll('#comboListBody .combo-row-select:checked');
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} combo${selected.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
        await Promise.all(Array.from(selected).map(el =>
            remove(Outlet.ref(`combos/${el.dataset.id}`))
        ));
        showToast(`Deleted ${selected.length} combo${selected.length > 1 ? 's' : ''}`, 'success');
        loadCombos();
    } catch (e) {
        console.error('[Combos] Bulk delete failed:', e);
        showToast('Failed to delete combos', 'error');
    }
};

let _selectedComboIds = new Set();

function _updateBulkActionBar() {
    const bar = document.getElementById('comboBulkActionBar');
    const countEl = document.getElementById('comboBulkCount');
    const count = document.querySelectorAll('#comboListBody .combo-row-select:checked').length;
    if (count === 0) {
        bar.classList.add('hidden');
        _selectedComboIds.clear();
    } else {
        bar.classList.remove('hidden');
        countEl.textContent = `${count} selected`;
    }
}

function _initBulkActions() {
    const bar = document.getElementById('comboBulkActionBar');
    if (!bar) return;

    // Select all / deselect all
    document.getElementById('btnBulkEnable')?.addEventListener('click', () => window.__bulkToggleCombos(true));
    document.getElementById('btnBulkDisable')?.addEventListener('click', () => window.__bulkToggleCombos(false));
    document.getElementById('btnBulkDelete')?.addEventListener('click', () => window.__bulkDeleteCombos());
    document.getElementById('btnBulkCancel')?.addEventListener('click', () => {
        document.querySelectorAll('#comboListBody .combo-row-select').forEach(cb => cb.checked = false);
        _updateBulkActionBar();
    });

    // Row selection
    document.getElementById('comboListBody')?.addEventListener('change', e => {
        if (e.target.matches('.combo-row-select')) {
            _updateBulkActionBar();
        }
    });
}

window.__bulkToggleCombos = async (enable) => {
    const selected = document.querySelectorAll('#comboListBody .combo-row-select:checked');
    if (selected.length === 0) return;
    try {
        await Promise.all(Array.from(selected).map(el =>
            update(Outlet.ref(`combos/${el.dataset.id}`), {
                disabled: !enable,
                disabledAt: !enable ? Date.now() : null,
                disabledBy: !enable ? (window.currentUserId || 'admin') : null
            })
        ));
        showToast(`${enable ? 'Enabled' : 'Paused'} ${selected.length} combo${selected.length > 1 ? 's' : ''}`, 'success');
        loadCombos();
    } catch (e) {
        console.error('[Combos] Bulk toggle failed:', e);
        showToast('Failed to update combos', 'error');
    }
};

window.__bulkDeleteCombos = async () => {
    const selected = document.querySelectorAll('#comboListBody .combo-row-select:checked');
    if (selected.length === 0) return;
    if (!confirm(`Delete ${selected.length} combo${selected.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
        await Promise.all(Array.from(selected).map(el =>
            remove(Outlet.ref(`combos/${el.dataset.id}`))
        ));
        showToast(`Deleted ${selected.length} combo${selected.length > 1 ? 's' : ''}`, 'success');
        loadCombos();
    } catch (e) {
        console.error('[Combos] Bulk delete failed:', e);
        showToast('Failed to delete combos', 'error');
    }
};

document.addEventListener('DOMContentLoaded', _initBulkActions);

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

// "Add Combo" 5-step full-page wizard (docs/PLAN-ADMIN-COMBO-WIZARD.md).
// Same export name as before so main.js addCombo + editCombo callers stay untouched.
// Same RTDB payload as the old single modal — no rules/menu changes.
const _CBW_STEPS = ['Basics', 'Choose Items', 'Set Price', 'Schedule & Limits', 'Review'];

export async function showComboModal(comboId = null) {
    if (!window.currentOutlet || window.currentOutlet === 'null' || window.currentOutlet === 'undefined') {
        return showToast("Error: Current outlet context is missing. Please refresh or select an outlet first.", "error");
    }
    document.getElementById('comboWizard')?.remove();

    const dishesSnap = await get(Outlet.ref('dishes'));
    const dishes = [];
    dishesSnap.forEach(ch => { const v = ch.val(); if (v) dishes.push({ id: ch.key, ...v }); });
    dishes.sort((a, b) => (parseInt(a.order) || 9999) - (parseInt(b.order) || 9999) || String(a.name).localeCompare(b.name));

    let combo = null;
    if (comboId) {
        const snap = await get(Outlet.ref(`combos/${comboId}`));
        combo = snap.exists() ? snap.val() : null;
    }

    const couponDiscountsSnap = await get(Outlet.ref('discounts'));
    const couponOptions = [];
    couponDiscountsSnap.forEach(ch => {
        const d = ch.val();
        if (d && d.type === 'coupon' && d.enabled !== false && d.couponCode) {
            couponOptions.push(`<option value="${escapeHtml(d.couponCode)}"${combo?.couponCode === d.couponCode ? ' selected' : ''}>${escapeHtml(d.couponCode)} — ${escapeHtml(d.name || d.couponCode)}</option>`);
        }
    });

    // draft lives as a plain object + selected-items map; back-nav keeps everything
    const draft = {
        name: combo?.name || '',
        discountType: combo?.discountType !== 'fixed' ? 'percentage' : 'fixed',
        discountValue: combo?.discountValue ?? 20,
        startAt: combo ? _toInputDate(combo.startAt) : _toInputDate(Date.now()),
        endAt: combo ? _toInputDate(combo.endAt) : _toInputDate(Date.now() + 30 * 86400000),
        maxRedemptions: combo?.maxRedemptions ?? 0,
        perCustomerLimit: combo?.perCustomerLimit ?? 0,
        perDayLimit: combo?.perDayLimit ?? 0,
        couponCode: combo?.couponCode || '',
        customerSegment: combo?.customerSegment || 'all',
        image: combo?.image || null,
        file: null
    };
    const sel = new Map(Object.values(combo?.items || {}).map(it => [
        it.dishId, Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 20)
    ]));

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.body.insertAdjacentHTML('beforeend', `
    <style>
        #comboWizard { position: fixed; inset: 0; z-index: 8600; background: var(--neutral-50, #f5f7fb); display: flex; flex-direction: column; overflow: auto; }
        .cbw-head { display: flex; align-items: center; gap: 14px; padding: 14px 26px; background: var(--surface, #fff); border-bottom: 1px solid var(--card-border, #e5e7eb); position: sticky; top: 0; z-index: 5; }
        .cbw-head h2 { margin: 0; font-size: 17px; font-weight: 800; color: var(--text-main, #1e293b); }
        .cbw-head small { color: var(--text-sub, #64748b); font-size: 12px; font-weight: 600; }
        .cbw-stepper { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
        .cbw-step { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--text-sub, #64748b); background: var(--neutral-100, #f1f5f9); border: 1px solid transparent; cursor: default; }
        .cbw-step.on { background: var(--primary, #E84908); color: #fff; }
        .cbw-step.done { background: rgba(34, 197, 94, 0.12); color: var(--success, #16a34a); cursor: pointer; }
        .cbw-step.locked::before { content: '·'; font-weight: 900; margin-right: 2px; }
        .cbw-step.done::before { content: '✓'; font-weight: 900; margin-right: 2px; }
        .cbw-body { flex: 1; width: 100%; max-width: 880px; margin: 0 auto; padding: 22px 26px 90px; }
        .cbw-section { display: none; }
        .cbw-section.on { display: block; }
        .cbw-sec-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-sub, #888); margin: 6px 0 12px; }
        .cbw-foot { position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px; padding: 14px 26px; background: var(--surface, #fff); border-top: 1px solid var(--card-border, #e5e7eb); }
        .cbw-foot .cbw-spacer { flex: 1; }
        .cbw-draft-hint { font-size: 12px; color: var(--text-sub, #888); font-weight: 600; }
        /* step 1: full-menu image grid */
        .cbw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
        .cbw-card { border: 2px solid var(--card-border, #e5e7eb); border-radius: 14px; background: var(--surface, #fff); overflow: hidden; cursor: pointer; transition: border-color 120ms ease, box-shadow 120ms ease; position: relative; }
        .cbw-card.on { border-color: var(--primary, #E84908); box-shadow: 0 0 0 3px rgba(232, 73, 8, 0.14); }
        .cbw-card .cbw-thumb { position: relative; aspect-ratio: 4 / 3; background: var(--neutral-100, #f1f5f9); }
        .cbw-card .cbw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cbw-card .cbw-ph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 30px; color: var(--neutral-400, #94a3b8); }
        .cbw-card .cbw-qty-badge { position: absolute; top: 8px; right: 8px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--primary, #E84908); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .cbw-card-body { padding: 10px 12px 12px; }
        .cbw-card-name { font-size: 13px; font-weight: 700; color: var(--text-main, #1e293b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cbw-card-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; }
        .cbw-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-sub, #94a3b8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cbw-price { font-size: 13px; font-weight: 800; color: var(--primary-dark, #c43d00); flex-shrink: 0; }
        .cbw-stepperbar { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
        .cbw-stepperbar button { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--card-border, #ddd); background: var(--surface, #fff); font-weight: 700; cursor: pointer; line-height: 1; font-size: 15px; }
        .cbw-stepperbar button:hover:not(:disabled) { background: var(--primary-light, #fef0e8); border-color: var(--primary, #E84908); }
        .cbw-stepperbar button:disabled { opacity: 0.35; cursor: not-allowed; }
        .cbw-stepperbar span { min-width: 26px; text-align: center; font-size: 14px; font-weight: 800; }
        .cbw-norm { display: inline-block; padding: 4px 12px; border-radius: 999px; background: var(--primary-light, #fef0e8); color: var(--primary-dark, #c43d00); font-size: 12px; font-weight: 700; }
        .cbw-norm.off { background: var(--neutral-100, #f1f5f9); color: var(--text-sub, #64748b); }
        .cbw-totalbar { position: sticky; bottom: 64px; display: flex; gap: 10px; align-items: center; padding: 10px 16px; border-radius: 12px; background: rgba(20, 22, 25, 0.92); color: #fff; font-size: 14px; font-weight: 700; z-index: 3; }
        .cbw-totalbar .cbw-save-chip { color: #4ade80; }
        /* step 2: price card */
        .cbw-pricecard { border-radius: 18px; padding: 26px; background: linear-gradient(135deg, var(--primary-light, #fef0e8) 0%, var(--primary-lighter, rgba(232,73,8,0.08)) 100%); border: 1px solid var(--primary-light, #ffe0c2); text-align: center; margin-bottom: 18px; }
        .cbw-pricecard .cbw-orig { font-size: 14px; color: var(--text-sub, #64748b); text-decoration: line-through; font-weight: 600; }
        .cbw-pricecard .cbw-combo { font-size: 40px; font-weight: 900; color: var(--primary-dark, #c43d00); line-height: 1.1; margin: 4px 0; }
        .cbw-pricecard .cbw-save { display: inline-block; padding: 6px 16px; border-radius: 999px; background: rgba(34, 197, 94, 0.15); color: var(--success, #16a34a); font-size: 14px; font-weight: 800; }
        .cbw-review { border: 1px solid var(--card-border, #e5e7eb); border-radius: 16px; background: var(--surface, #fff); overflow: hidden; max-width: 460px; }
        .cbw-review-img { aspect-ratio: 16 / 7; background: var(--neutral-100, #f1f5f9); position: relative; }
        .cbw-review-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cbw-review-img .cbw-ph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 42px; color: var(--neutral-400, #94a3b8); }
        .cbw-review-body { padding: 16px 18px 18px; }
        .cbw-review-name { font-size: 17px; font-weight: 800; color: var(--text-main, #1e293b); }
        .cbw-review-items { margin: 10px 0 0; padding: 0; list-style: none; }
        .cbw-review-items li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 13px; color: var(--text-main, #333); border-bottom: 1px dashed var(--neutral-200, #eee); }
        .cbw-review-items li:last-child { border-bottom: none; }
        .cbw-review-price-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-weight: 800; }
        .cbw-review-price-row .cbw-orig { color: var(--text-sub, #64748b); text-decoration: line-through; font-size: 13px; font-weight: 600; }
        .cbw-review-price-row .cbw-combo { color: var(--primary-dark, #c43d00); font-size: 20px; }
        .cbw-review-facts { margin-top: 12px; font-size: 12px; color: var(--text-sub, #64748b); line-height: 1.7; }
        .cbw-err { color: var(--error, #d32f2f); font-size: 12px; margin-top: 6px; display: none; }
        .cbw-err.show { display: block; }
        @media (max-width: 640px) {
            .cbw-head { padding: 10px 14px; flex-wrap: wrap; }
            .cbw-stepper { width: 100%; margin-left: 0; }
            .cbw-body { padding: 16px 14px 110px; }
            .cbw-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        }
    </style>
    <div id="comboWizard" role="dialog" aria-modal="true" aria-label="${comboId ? 'Edit Combo' : 'Create Combo'}">
        <div class="cbw-head">
            <button type="button" class="btn-secondary btn-small" id="cbwClose" aria-label="Close"><i data-lucide="arrow-left" class="icon-16"></i> Back to Combos</button>
            <h2>${comboId ? 'Edit Combo' : 'Create Combo'}</h2>
            <div class="cbw-stepper">${_CBW_STEPS.map((label, i) => `
                <span class="cbw-step ${i === 0 ? 'on' : 'locked'}" data-step="${i}" ${i === 0 ? '' : 'tabindex="-1"'}>${i + 1}. ${label}</span>`).join('')}
            </div>
        </div>
        <div class="cbw-body">

            <section class="cbw-section on" data-step="0" aria-label="Step 1: Basics">
                <div class="cbw-sec-title">Basics</div>
                <div class="cmb-media" style="display:flex;gap:16px;align-items:flex-start;">
                    <div class="modal-media-upload img-placeholder" id="cbwPreviewWrap" style="width:128px;height:128px;flex-shrink:0;border-radius:16px;overflow:hidden;position:relative;">
                        <div class="cbw-img-empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;background:linear-gradient(135deg,var(--neutral-50,#f8fafc) 0%,var(--neutral-100,#f1f5f9) 100%);">
                            <i data-lucide="image" class="icon-36" style="color:var(--neutral-400,#94a3b8);"></i>
                            <span style="font-size:12px;color:var(--neutral-500,#64748b);">No image</span>
                        </div>
                        <img id="cbwPreview" class="modal-img-preview hidden" alt="Combo preview" style="width:100%;height:100%;object-fit:cover;">
                        <div class="modal-img-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 200ms ease;">
                            <input type="file" id="cbwFile" accept="image/*" class="hidden" title="Upload combo photo">
                            <button type="button" id="cbwPickPhoto" class="btn-secondary update-photo-btn" style="color:#fff;border-color:rgba(255,255,255,0.5);">Update Photo</button>
                        </div>
                    </div>
                    <div style="flex:1;min-width:0;">
                        <label class="form-label" for="cbwName">Combo Name</label>
                        <input type="text" id="cbwName" class="form-input" maxlength="50" placeholder="e.g. Family Pizza Deal" value="${escapeHtml(draft.name)}">
                        <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Descriptive name customers will see</small>
                    </div>
                </div>
            </section>

            <section class="cbw-section" data-step="1" aria-label="Step 2: Choose Items">
                <div class="cbw-sec-title">Choose Items — full menu</div>
                <input type="text" id="cbwDishSearch" class="form-input" placeholder="Search dishes..." autocomplete="off" style="margin-bottom:12px;">
                <div class="cbw-grid" id="cbwDishGrid" role="listbox" aria-multiselectable="true" aria-label="All menu items"></div>
                <div class="cbw-err" id="cbwErrDishes" role="alert">Select at least one dish</div>
                <div class="cbw-totalbar" id="cbwItemsBar" aria-live="polite"></div>
            </section>

            <section class="cbw-section" data-step="2" aria-label="Step 3: Set Price">
                <div class="cbw-sec-title">Set Price</div>
                <div class="cbw-pricecard">
                    <div class="cbw-orig" id="cbwOriginal">—</div>
                    <div class="cbw-combo" id="cbwComboPrice">—</div>
                    <div class="cbw-save" id="cbwSaveChip">—</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwDiscountType">Discount Type</label>
                        <select id="cbwDiscountType" class="form-input">
                            <option value="percentage">Percentage (%) off</option>
                            <option value="fixed">Fixed Amount (₹) off</option>
                        </select>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwDiscountValue">Discount Value</label>
                        <input type="number" id="cbwDiscountValue" class="form-input" min="0" step="1">
                        <div class="cbw-err" id="cbwErrDiscount" role="alert">Enter a valid discount</div>
                    </div>
                </div>
            </section>

            <section class="cbw-section" data-step="3" aria-label="Step 4: Schedule and Limits">
                <div class="cbw-sec-title">Schedule & Limits</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwStartAt">Active From</label>
                        <input type="date" id="cbwStartAt" class="form-input">
                        <div class="cbw-err" id="cbwErrDates" role="alert">End date must be after start date</div>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwEndAt">Active Until</label>
                        <input type="date" id="cbwEndAt" class="form-input">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwMaxRedemptions">Max Total Redemptions</label>
                        <input type="number" id="cbwMaxRedemptions" class="form-input" min="0" step="1">
                        <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwPerCustomerLimit">Max Per Customer</label>
                        <input type="number" id="cbwPerCustomerLimit" class="form-input" min="0" step="1">
                        <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                    <div class="form-row" style="margin:0;">
                        <label class="form-label" for="cbwPerDayLimit">Max Per Day</label>
                        <input type="number" id="cbwPerDayLimit" class="form-input" min="0" step="1">
                        <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">0 = unlimited</small>
                    </div>
                </div>
                <div class="cbw-sec-title" style="margin-top:18px;">Coupon Code (Optional)</div>
                <div class="form-row" style="margin:0;max-width:420px;">
                    <select id="cbwCouponCode" class="form-input">
                        <option value="">None (open to all)</option>
                        ${couponOptions || ''}
                    </select>
                    <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Customers must enter this code at checkout to redeem the combo</small>
                </div>
                <div class="cbw-sec-title" style="margin-top:18px;">Customer Segment</div>
                <div class="form-row" style="margin:0;">
                    <select id="cbwCustomerSegment" class="form-input">
                        <option value="all">All customers</option>
                        <option value="new">New customers only</option>
                        <option value="returning">Returning customers only</option>
                    </select>
                    <small class="form-hint" style="display:block;margin-top:4px;color:var(--text-sub);font-size:12px;">Show this combo only to customers matching the selected segment</small>
                </div>
            </section>

            <section class="cbw-section" data-step="4" aria-label="Step 5: Review and Publish">
                <div class="cbw-sec-title">Review — this is what customers see</div>
                <div class="cbw-review" id="cbwReviewCard"></div>
            </section>

        </div>
        <div class="cbw-foot">
            <span class="cbw-draft-hint" id="cbwDraftHint"></span>
            <span class="cbw-spacer"></span>
            <button type="button" class="btn-secondary" id="cbwBack">← Back</button>
            <button type="button" class="btn-primary" id="cbwNext">Next →</button>
        </div>
    </div>`);

    const root = document.getElementById('comboWizard');

    // ---- state sync (two-way between DOM and draft on step transitions) ----
    const $ = id => document.getElementById(id);
    const syncDraft = () => {
        draft.name = $('cbwName').value.trim();
        draft.discountType = $('cbwDiscountType').value;
        draft.discountValue = parseFloat($('cbwDiscountValue').value);
        draft.startAt = $('cbwStartAt').value;
        draft.endAt = $('cbwEndAt').value;
        draft.maxRedemptions = parseInt($('cbwMaxRedemptions').value) || 0;
        draft.perCustomerLimit = parseInt($('cbwPerCustomerLimit').value) || 0;
        draft.perDayLimit = parseInt($('cbwPerDayLimit').value) || 0;
        draft.couponCode = $('cbwCouponCode')?.value.trim() || null;
        draft.customerSegment = $('cbwCustomerSegment')?.value || 'all';
    };

    // hydrate edited combo / current draft into the controls
    $('cbwName').value = draft.name;
    $('cbwDiscountType').value = draft.discountType;
    $('cbwDiscountValue').value = draft.discountValue;
    $('cbwDiscountValue').max = draft.discountType === 'percentage' ? '100' : '';
    $('cbwStartAt').value = draft.startAt;
    $('cbwEndAt').value = draft.endAt;
    $('cbwMaxRedemptions').value = draft.maxRedemptions;
    $('cbwPerCustomerLimit').value = draft.perCustomerLimit;
    $('cbwPerDayLimit').value = draft.perDayLimit;
    $('cbwCouponCode').value = draft.couponCode || '';
    $('cbwCustomerSegment').value = draft.customerSegment || 'all';
    if (draft.image) {
        $('cbwPreview').src = draft.image;
        $('cbwPreview').classList.remove('hidden');
        $('cbwPreviewWrap').classList.remove('img-placeholder');
        root.querySelector('.cbw-img-empty')?.style.setProperty('display', 'none');
    }

    // ---- step navigation ----
    let step = 0;
    let maxVisited = 0;
    const originalTotal = () => [...sel.keys()].reduce((sum, id) => {
        const d = dishes.find(x => x.id === id);
        return sum + (_dishPrice(d) * sel.get(id));
    }, 0);

    const VALIDATORS = [
        () => draft.name.trim() ? '' : 'Enter a combo name',
        () => sel.size ? '' : 'Select at least one dish',
        () => {
            const v = parseFloat($('cbwDiscountValue').value);
            const orig = originalTotal();
            if (!(v >= 0)) return 'Enter a valid discount';
            if (draft.discountType === 'percentage' && v > 100) return 'Percentage must be 0–100';
            if (draft.discountType === 'fixed' && orig > 0 && v > orig) return `Fixed amount can't exceed ₹${orig}`;
            return '';
        },
        () => {
            const s = _parseLocalDate($('cbwStartAt').value, false);
            const e = _parseLocalDate($('cbwEndAt').value, true);
            if (!s || !e || !(e > s)) return 'End date must be after start date';
            if ($('cbwMaxRedemptions').value.startsWith('-') || $('cbwPerCustomerLimit').value.startsWith('-') || $('cbwPerDayLimit').value.startsWith('-')) return 'Redemption caps cannot be negative';
            return '';
        },
        () => ''
    ];

    const focusFor = [ 'cbwName', 'cbwDishSearch', 'cbwDiscountValue', 'cbwStartAt', null ];

    const fmt = n => `₹${Number(n).toLocaleString('en-IN')}`;

    const renderItemsStep = () => {
        const q = ($('cbwDishSearch').value || '').trim().toLowerCase();
        const rows = dishes.filter(d => !q || String(d.name).toLowerCase().includes(q) || String(d.category || '').toLowerCase().includes(q));
        const grid = $('cbwDishGrid');
        if (!rows.length) { grid.innerHTML = `<div class="cbw-empty" style="padding:24px;text-align:center;color:var(--text-sub,#888);grid-column:1/-1;">No dishes match your search</div>`; }
        else grid.innerHTML = rows.map(d => {
            const on = sel.has(d.id);
            const qty = sel.get(d.id) || 1;
            const img = d.image ? `<img src="${escapeHtml(d.image)}" alt="${escapeHtml(d.name)}" loading="lazy" onerror="this.remove()">` : `<div class="cbw-ph">🍽️</div>`;
            return `
            <div class="cbw-card ${on ? 'on' : ''}" data-id="${d.id}" role="option" aria-selected="${on}" tabindex="0">
                <div class="cbw-thumb">${img}${on ? `<span class="cbw-qty-badge">${qty}</span>` : ''}</div>
                <div class="cbw-card-body">
                    <div class="cbw-card-name">${escapeHtml(d.name)}</div>
                    <div class="cbw-card-meta"><span class="cbw-cat">${escapeHtml(d.category || 'Untagged')}</span><span class="cbw-price">${fmt(_dishPrice(d))}</span></div>
                    <div class="cbw-stepperbar">
                        <button type="button" data-act="dec" aria-label="Decrease quantity of ${escapeHtml(d.name)}" ${on ? '' : 'disabled'}>−</button>
                        <span aria-live="polite">${on ? qty : 0}</span>
                        <button type="button" data-act="inc" aria-label="Increase quantity of ${escapeHtml(d.name)}">+</button>
                        <span class="cbw-norm ${on ? '' : 'off'}" style="font-size:10px;padding:3px 9px;">${on ? 'Added' : 'Add'}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
        const n = sel.size;
        const orig = originalTotal();
        const comboPrice = comboPriceTotal(orig, draft.discountType, draft.discountValue);
        $('cbwItemsBar').innerHTML = n
            ? `<span>${n} item${n > 1 ? 's' : ''} selected</span><span>·</span><span>Original ${fmt(orig)}</span><span class="cbw-save-chip">Combo ${fmt(comboPrice)}</span>`
            : `<span style="opacity:0.75;">Nothing selected yet — tap menu items to include them</span>`;
    };

    const renderPriceStep = () => {
        syncDraft();
        const orig = originalTotal();
        const v = parseFloat($('cbwDiscountValue').value) || 0;
        const price = comboPriceTotal(orig, draft.discountType, v);
        $('cbwOriginal').textContent = `Original ${fmt(orig)}`;
        $('cbwComboPrice').textContent = `Combo ${fmt(price)}`;
        const disc = draft.discountType === 'percentage' ? `${Math.min(v, 100)}% off` : `${fmt(v)} off`;
        $('cbwSaveChip').textContent = orig ? `Customer saves ${fmt(orig - price)} (${disc})` : 'Select dishes first';
        $('cbwDiscountValue').max = draft.discountType === 'percentage' ? '100' : '';
    };

    const renderReviewStep = () => {
        syncDraft();
        const orig = originalTotal();
        const price = comboPriceTotal(orig, draft.discountType, draft.discountValue);
        const card = $('cbwReviewCard');
        card.innerHTML = `
            <div class="cbw-review-img">${draft.image ? `<img src="${escapeHtml(draft.image)}" alt="" onerror="this.remove();this.closest('.cbw-review-img').insertAdjacentHTML('beforeend','<div class=&quot;cbw-ph&quot;>🏷️</div>');">` : `<div class="cbw-ph">🏷️</div>`}</div>
            <div class="cbw-review-body">
                <div class="cbw-review-name">${escapeHtml(draft.name || 'Unnamed combo')}</div>
                <ul class="cbw-review-items">${[...sel.keys()].map(id => {
                    const d = dishes.find(x => x.id === id);
                    if (!d) return '';
                    return `<li><span>${escapeHtml(d.name)} × ${sel.get(id)}</span><span>${fmt(_dishPrice(d) * sel.get(id))}</span></li>`;
                }).join('')}</ul>
                <div class="cbw-review-price-row">
                    <span class="cbw-orig">${fmt(orig)}</span>
                    <span class="cbw-combo">${fmt(price)}</span>
                    <span class="cbw-save">${draft.discountType === 'percentage' ? `${Math.min(draft.discountValue, 100)}% off` : `${fmt(draft.discountValue)} off`}</span>
                </div>
                <div class="cbw-review-facts">
                    📅 ${draft.startAt || 'today'} → ${draft.endAt || 'plus 30 days'}<br>
                    🎟️ Caps: ${draft.maxRedemptions ? `${draft.maxRedemptions} total` : 'unlimited total'} · ${draft.perCustomerLimit ? `${draft.perCustomerLimit}/customer` : 'unlimited/customer'} · ${draft.perDayLimit ? `${draft.perDayLimit}/day` : 'unlimited/day'}<br>
                    ${draft.couponCode ? `🔒 Requires coupon <b>${escapeHtml(draft.couponCode)}</b>` : '🔓 No coupon required'}
                </div>
            </div>`;
    };

    const renderers = [null, renderItemsStep, renderPriceStep, null, renderReviewStep];

    const goStep = (n) => {
        syncDraft();
        step = n;
        maxVisited = Math.max(maxVisited, n);
        root.querySelectorAll('.cbw-section').forEach(sec => sec.classList.toggle('on', Number(sec.dataset.step) === n));
        root.querySelectorAll('.cbw-step').forEach(s => {
            const i = Number(s.dataset.step);
            s.classList.toggle('on', i === n);
            s.classList.toggle('done', i < n);
            s.classList.toggle('locked', i > n && i > maxVisited);
            s.tabindex = i <= maxVisited ? 0 : -1;
        });
        if (renderers[n]) renderers[n]();
        $('cbwBack').style.visibility = n === 0 ? 'hidden' : 'visible';
        $('cbwNext').textContent = n === 4 ? (comboId ? 'Save Changes' : 'Publish Combo') : 'Next →';
        $('cbwDraftHint').textContent = `Step ${n + 1} of 5 — ${_CBW_STEPS[n]}`;
        root.querySelectorAll('.cbw-err').forEach(el => el.classList.remove('show'));
        const first = root.querySelector(`.cbw-section[data-step="${n}"] input, .cbw-section[data-step="${n}"] select`);
        first?.focus({ preventScroll: true });
        root.scrollTo({ top: 0 });
    };

    root.querySelector('.cbw-stepper').addEventListener('click', e => {
        const chip = e.target.closest('.cbw-step');
        if (!chip) return;
        const i = Number(chip.dataset.step);
        if (i <= maxVisited && i !== step) goStep(i);
    });

    const validateStep = (n) => {
        syncDraft();
        const err = VALIDATORS[n]();
        if (!err) return true;
        showToast(err, 'warning');
        const id = focusFor[n];
        if (id) $(id)?.focus({ preventScroll: true });
        return false;
    };

    $('cbwBack').addEventListener('click', () => { if (step > 0) goStep(step - 1); });
    $('cbwNext').addEventListener('click', () => {
        syncDraft();
        if (step < 4) {
            const currentErr = VALIDATORS[step]();
            if (currentErr) return validateStep(step);
            goStep(step + 1);
        } else {
            publish();
        }
    });

    // ---- step 0: image ----
    const fileInput = $('cbwFile');
    $('cbwPickPhoto').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (!fileInput.files[0]) return;
        draft.file = fileInput.files[0];
        previewImage(fileInput, 'cbwPreview');
        $('cbwPreviewWrap').classList.remove('img-placeholder');
        $('cbwPreview').classList.remove('hidden');
        root.querySelector('.cbw-img-empty')?.style.setProperty('display', 'none');
    });

    // ---- step 1: dish picker ----
    $('cbwDishSearch').addEventListener('input', renderItemsStep);
    $('cbwDishGrid').addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        const card = e.target.closest('.cbw-card');
        if (!card) return;
        const id = card.dataset.id;
        if (btn) {
            e.preventDefault();
            if (!sel.has(id)) sel.set(id, 1);
            const next = (sel.get(id) || 1) + (btn.dataset.act === 'inc' ? 1 : -1);
            if (next < 1) sel.delete(id);
            else if (next > 20) { showToast('Max 20 per dish', 'warning'); return; }
            else sel.set(id, next);
        } else {
            e.preventDefault();
            if (sel.has(id)) sel.delete(id); else sel.set(id, 1);
        }
        renderItemsStep();
    });
    $('cbwDishGrid').addEventListener('keydown', e => {
        if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) return;
        const cards = Array.from($('cbwDishGrid').querySelectorAll('.cbw-card'));
        const i = cards.findIndex(r => r === document.activeElement || r.contains(document.activeElement));
        if (i === -1) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); cards[(i + 1) % cards.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length].focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); cards[i].click(); }
    });

    // ---- step 2/3: live recompute + draft sync ----
    $('cbwDiscountValue').addEventListener('input', () => {
        const type = $('cbwDiscountType').value;
        if (type === 'percentage' && parseFloat($('cbwDiscountValue').value) > 100) $('cbwDiscountValue').value = 100;
        renderPriceStep();
    });
    $('cbwDiscountType').addEventListener('change', () => {
        if ($('cbwDiscountType').value === 'percentage' && parseFloat($('cbwDiscountValue').value) > 100) $('cbwDiscountValue').value = 100;
        renderPriceStep();
    });

    // ---- publish (same payload + save path as the old modal) ----
    let comboSaving = false;
    async function publish() {
        syncDraft();
        // re-validate everything; land on the first failing step
        for (let n = 0; n < 4; n++) {
            const err = VALIDATORS[n]();
            if (err) {
                goStep(n);
                showToast(err, 'warning');
                $(focusFor[n])?.focus({ preventScroll: true });
                return;
            }
        }
        if (comboSaving) return;
        const items = dishes.filter(d => sel.has(d.id)).map(d => ({ dishId: d.id, qty: sel.get(d.id), price: _dishPrice(d) }));
        const saveBtn = $('cbwNext');
        try {
            comboSaving = true;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-sm"></span> Saving...';
            let image = combo?.image || null;
            if (draft.file) {
                image = await uploadImage(draft.file, `combos/${Date.now()}_${draft.file.name}`);
                if (combo?.image && image !== combo.image) deleteImage(combo.image).catch(err => console.warn('[Combos] Old image deletion failed:', err));
            }
            const payload = {
                name: draft.name,
                items,
                discountType: draft.discountType,
                discountValue: parseFloat($('cbwDiscountValue').value) || 0,
                startAt: _parseLocalDate(draft.startAt, false),
                endAt: _parseLocalDate(draft.endAt, true),
                image,
                maxRedemptions: draft.maxRedemptions > 0 ? draft.maxRedemptions : null,
                perCustomerLimit: draft.perCustomerLimit > 0 ? draft.perCustomerLimit : null,
                perDayLimit: draft.perDayLimit > 0 ? draft.perDayLimit : null,
                couponCode: draft.couponCode,
                customerSegment: draft.customerSegment || 'all',
                sourceOid: Outlet.current,
                updatedAt: Date.now()
            };
            if (comboId) {
                await update(Outlet.ref(`combos/${comboId}`), payload);
                logAudit('Catalog', `Updated Combo: ${draft.name}`, comboId);
                showToast('Combo updated!', 'success');
            } else {
                await set(push(Outlet.ref('combos')), { ...payload, createdAt: Date.now() });
                logAudit('Catalog', `Added Combo: ${draft.name}`, Outlet.current);
                showToast('Combo created!', 'success');
            }
            close();
        } catch (err) {
            console.error('[Combos] Save failed:', err);
            showToast('Failed to save combo: ' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = comboId ? 'Save Changes' : 'Publish Combo';
        } finally {
            comboSaving = false;
        }
    }

    // ---- close + guards ----
    let touched = false;
    root.addEventListener('input', () => { touched = true; }, { capture: true });
    root.addEventListener('click', e => { if (e.target.closest('.cbw-card') || e.target.closest('[data-act]')) touched = true; });

    const onEsc = e => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onEsc);
    $('cbwClose').addEventListener('click', requestClose);

    async function requestClose() {
        syncDraft();
        const dirty = touched || (!comboId && (draft.name?.trim() || sel.size));
        if (dirty) {
            const ok = await showConfirm('Discard this combo draft? Your changes are not saved yet.', 'Discard changes?');
            if (!ok) return;
        }
        close();
    }

    function close() {
        document.removeEventListener('keydown', onEsc);
        root.style.opacity = '0';
        root.style.transition = 'opacity .2s ease';
        setTimeout(() => root.remove(), prefersReduced ? 0 : 200);
    }

    loadLucide().then(() => window.lucide?.createIcons({ root }));
    renderItemsStep();
    goStep(0);
}
