import { state } from '../state.js';
import { db, Outlet, ref, get, update, set } from '../firebase.js';
import { logAudit, showToast, getSkeletonRows } from '../utils.js';
import { loadLucide } from '../ui.js';

// --- STATE & UTILS ---
const SETTINGS_PATHS = {
    STORE: "settings/Store",
    DELIVERY: "settings/Delivery",
    BOT: "settings/Bot",
    DISPLAY: "settings/Display"
};

function validateCoords(lat, lng) {
    const l = parseFloat(lat);
    const n = parseFloat(lng);
    if (isNaN(l) || l < -90 || l > 90) return { valid: false, msg: "Invalid Latitude (-90 to 90)" };
    if (isNaN(n) || n < -180 || n > 180) return { valid: false, msg: "Invalid Longitude (-180 to 180)" };
    return { valid: true };
}

/**
 * Validates Indian Phone Format (91XXXXXXXXXX)
 */
function validatePhone(phone, label) {
    if (!phone) return true; // Optional fields
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length === 10) return { valid: true, value: "91" + clean };
    if (clean.length !== 12 || !clean.startsWith('91')) {
        return { valid: false, msg: `${label} must be 10 digits or 12 digits starting with 91` };
    }
    return { valid: true, value: clean };
}

/**
 * Validates GSTIN (15 characters)
 */
function validateGSTIN(gst) {
    if (!gst) return true;
    const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!regex.test(gst)) return { valid: false, msg: "Invalid GSTIN Format" };
    return { valid: true };
}

/**
 * Validates FSSAI (14 digits)
 */
function validateFSSAI(fssai) {
    if (!fssai) return true;
    if (!/^[0-9]{14}$/.test(fssai)) return { valid: false, msg: "FSSAI must be exactly 14 digits" };
    return { valid: true };
}

/**
 * Validates Backup/Access Code (4 digits)
 */
function validateBackupCode(code) {
    if (!/^[0-9]{4}$/.test(code)) return { valid: false, msg: "Backup Code must be 4 digits" };
    return { valid: true };
}

/**
 * Validates a generic URL field — optional, but if present must look like a URL.
 */
function validateOptionalUrl(url, label) {
    if (!url) return true;
    try {
        const v = url.match(/^https?:\/\//i) ? url : `https://${url}`;
        new URL(v);
        return { valid: true };
    } catch {
        return { valid: false, msg: `${label} doesn't look like a valid URL` };
    }
}

const val = (id) => document.getElementById(id)?.value ?? '';
const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
const setChecked = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
const isChecked = (id) => document.getElementById(id)?.checked ?? false;
const refreshIcons = (root) => loadLucide().then(() => window.lucide?.createIcons({ root }));

// --- CORE FUNCTIONS ---

export async function loadStoreSettings() {
    console.log("[Settings] Loading all store settings...");

    // Show skeleton while data loads
    const feeSlabsTbody = document.getElementById('feeSlabsTable');
    if (feeSlabsTbody) feeSlabsTbody.innerHTML = getSkeletonRows(3, 4);

    try {
        const [storeSnap, delSnap, botSnap, dispSnap] = await Promise.all([
            get(Outlet.ref(SETTINGS_PATHS.STORE)),
            get(Outlet.ref(SETTINGS_PATHS.DELIVERY)),
            get(Outlet.ref(SETTINGS_PATHS.BOT)),
            get(Outlet.ref(SETTINGS_PATHS.DISPLAY))
        ]);

        const store = storeSnap.val();
        const del = delSnap.val();
        const bot = botSnap.val();
        const disp = dispSnap.val();

        // 1. Store Info
        const s = store || {};
        setVal('settingEntityName', s.entityName || '');
        setVal('settingStoreName', s.storeName || '');
        setVal('settingStoreAddress', s.address || '');
        setVal('settingGSTIN', s.gstin || '');
        setVal('settingFSSAI', s.fssai || '');
        setVal('settingTagline', s.tagline || '');
        setVal('settingPoweredBy', s.poweredBy || 'Powered by Roshani ERP');
        setVal('settingOpenTime', s.shopOpenTime || '10:00');
        setVal('settingCloseTime', s.shopCloseTime || '23:00');
        setVal('settingShopStatus', s.shopStatus || 'AUTO');
        setVal('settingWifiName', s.wifiName || '');
        setVal('settingWifiPass', s.wifiPass || '');
        setVal('settingInstagram', s.instagram || '');
        setVal('settingFacebook', s.facebook || '');
        setVal('settingGoogleReviewLink', s.googleReviewLink || '');
        setVal('settingWhatsappNumber', s.whatsappNumber || '');
        setVal('settingReviewUrl', s.reviewUrl || '');
        setVal('settingCustomerMenuBgImage', s.customerMenuBgImage || '');
        setVal('settingLat', s.lat || '25.887444');
        setVal('settingLng', s.lng || '85.026889');
        const coordsEl = document.getElementById('displayCoords');
        if (coordsEl) coordsEl.innerText = `${s.lat || '25.887444'}, ${s.lng || '85.026889'}`;

        // 2. Delivery & Security
        const d = del || {};
        setVal('settingDevPhone', d.developerPhone || '');
        setVal('settingReportPhone', d.reportPhone || '');
        setVal('settingAdminPhone', d.notifyPhone || '');
        setVal('settingDeliveryBackupCode', d.backupCode || '');
        renderFeeSlabs(d.slabs || []);

        // 2b. Dine-In Settings (tax, service charge, QR ordering base URL)
        const dineSnap = await get(Outlet.ref('dineinSettings'));
        const dine = dineSnap.val() || {};
        setChecked('dineinTaxEnabled', dine.taxEnabled !== false);
        // Migrate legacy single tax to taxRates array
        let taxRates = dine.taxRates;
        if (!taxRates || !Array.isArray(taxRates) || taxRates.length === 0) {
            taxRates = dine.taxEnabled !== false ? [{ name: dine.taxName || 'GST', rate: typeof dine.taxRate === 'number' ? dine.taxRate : 5 }] : [];
        }
        _renderTaxRates(taxRates);
        setChecked('dineinServiceChargeEnabled', dine.serviceChargeEnabled === true);
        setVal('dineinServiceChargeName', dine.serviceChargeName || 'Service Charge');
        setVal('dineinServiceChargeRate', typeof dine.serviceChargeRate === 'number' ? dine.serviceChargeRate : 10);
        setVal('settingQrBaseUrl', dine.qrBaseUrl || '');

        // 3. Bot Aesthetics & Marketing
        const b = bot || {};
        const botPreviews = {
            'botImgConfirmedPreview': b.imgConfirmed,
            'botImgReadyPreview': b.imgReady,
            'botImgOutPreview': b.imgOut,
            'botImgDeliveredPreview': b.imgDelivered,
            'botImgFeedbackPreview': b.imgFeedback,
            'greetingImgPreview': b.greetingImage,
            'menuImgPreview': b.menuImage
        };
        for (const [id, url] of Object.entries(botPreviews)) {
            if (url) {
                const el = document.getElementById(id);
                if (el) el.src = url;
                if (id === 'greetingImgPreview') setVal('settingGreetingUrl', url);
                if (id === 'menuImgPreview') setVal('settingMenuUrl', url);
            }
        }

        // 4. Social & Promotions
        setVal('settingFeedbackReason1', b.reason1 || 'Delicious Taste');
        setVal('settingFeedbackReason2', b.reason2 || 'Fast Delivery');
        setVal('settingFeedbackReason3', b.reason3 || 'Premium Packaging');

        // 5. Visibility Controls
        const vi = disp || {};
        const checks = [
            'checkShowStoreName', 'checkShowAddress', 'checkShowGSTIN', 'checkShowFSSAI', 'checkShowTagline',
            'checkShowPoweredBy', 'checkShowQR', 'checkShowWifiInfo', 'checkShowSocial', 'checkShowFeedbackQR'
        ];
        checks.forEach(id => setChecked(id, vi[id] !== false));

        // 6. Payment QR
        if (s.paymentQR) {
            setVal('settingQRUrl', s.paymentQR);
            const qrEl = document.getElementById('qrPreview');
            if (qrEl) qrEl.src = s.paymentQR;
        }

        // 7. Today's Offers
        _renderOffers(dine.offers || []);

        if (window.updateOutletStatusIndicator) window.updateOutletStatusIndicator(s.shopStatus || 'AUTO');
        
        state.settingsDirty = false;
        console.log("[Settings] All data populated.");
    } catch (e) {
        console.error("[Settings] Load Error:", e);
        showToast("Failed to load settings", "error");
    }
}

export async function saveStoreSettings() {
    console.log("[Settings] Preparing to save...");
    
    // 1. Validation
    const lat = val('settingLat');
    const lng = val('settingLng');
    const vCoord = validateCoords(lat, lng);
    if (!vCoord.valid) return showToast(vCoord.msg, "error");

    const gstinVal = val('settingGSTIN').trim();
    const vGst = validateGSTIN(gstinVal);
    if (vGst !== true && !vGst.valid) return showToast(vGst.msg, "error");

    const fssaiVal = val('settingFSSAI').trim();
    const vFssai = validateFSSAI(fssaiVal);
    if (vFssai !== true && !vFssai.valid) return showToast(vFssai.msg, "error");

    const backupCode = val('settingDeliveryBackupCode').trim();
    if (backupCode) {
        const vBackup = validateBackupCode(backupCode);
        if (!vBackup.valid) return showToast(vBackup.msg, "error");
    }

    const qrBaseUrlVal = val('settingQrBaseUrl').trim();
    const vQrBase = validateOptionalUrl(qrBaseUrlVal, "QR Ordering Base URL");
    if (vQrBase !== true && !vQrBase.valid) return showToast(vQrBase.msg, "error");

    const phones = [
        { id: 'settingDevPhone', label: "Developer Phone" },
        { id: 'settingReportPhone', label: "Report Phone" },
        { id: 'settingAdminPhone', label: "Admin Notification Phone" }
    ];

    for (const p of phones) {
        const input = document.getElementById(p.id);
        const v = validatePhone(input.value, p.label);
        if (v !== true && !v.valid) return showToast(v.msg, "error");
        if (v.value) input.value = v.value; // Auto-prefix 91
    }

    const saveBtn = document.getElementById('btnSaveSettings');
    const saveBtnOriginalHTML = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-lucide="loader" class="icon-16 spin-icon"></i> Saving...';
        await refreshIcons(saveBtn);
    }

    try {
        // 2. Collect Data
        const storeData = {
            entityName: val('settingEntityName'),
            storeName: val('settingStoreName'),
            address: val('settingStoreAddress'),
            gstin: val('settingGSTIN'),
            fssai: val('settingFSSAI'),
            tagline: val('settingTagline'),
            poweredBy: val('settingPoweredBy'),
            shopOpenTime: val('settingOpenTime'),
            shopCloseTime: val('settingCloseTime'),
            shopStatus: val('settingShopStatus'),
            wifiName: val('settingWifiName'),
            wifiPass: val('settingWifiPass'),
            instagram: val('settingInstagram'),
            facebook: val('settingFacebook'),
            googleReviewLink: val('settingGoogleReviewLink'),
            whatsappNumber: val('settingWhatsappNumber'),
            reviewUrl: val('settingReviewUrl'),
            customerMenuBgImage: val('settingCustomerMenuBgImage'),
            lat, lng,
            paymentQR: val('settingQRUrl'),
            updatedAt: new Date().toISOString()
        };

        const deliveryData = {
            developerPhone: val('settingDevPhone'),
            reportPhone: val('settingReportPhone'),
            notifyPhone: val('settingAdminPhone'),
            backupCode: val('settingDeliveryBackupCode'),
            slabs: getSlabsFromTable()
        };

        const botData = {
            imgConfirmed: document.getElementById('botImgConfirmedPreview')?.src || '',
            imgReady: document.getElementById('botImgReadyPreview')?.src || '',
            imgOut: document.getElementById('botImgOutPreview')?.src || '',
            imgDelivered: document.getElementById('botImgDeliveredPreview')?.src || '',
            imgFeedback: document.getElementById('botImgFeedbackPreview')?.src || '',
            greetingImage: val('settingGreetingUrl'),
            menuImage: val('settingMenuUrl'),
            reason1: val('settingFeedbackReason1'),
            reason2: val('settingFeedbackReason2'),
            reason3: val('settingFeedbackReason3')
        };

        const displayData = {};
        const checks = [
            'checkShowStoreName', 'checkShowAddress', 'checkShowGSTIN', 'checkShowFSSAI', 'checkShowTagline',
            'checkShowPoweredBy', 'checkShowQR', 'checkShowWifiInfo', 'checkShowSocial', 'checkShowFeedbackQR'
        ];
        checks.forEach(id => { displayData[id] = isChecked(id); });

        // 3. Atomic multi-path update
        const updates = {};
        updates[`${Outlet.current}/settings/Store`] = storeData;
        updates[`${Outlet.current}/settings/Delivery`] = deliveryData;
        updates[`${Outlet.current}/settings/Bot`] = botData;
        updates[`${Outlet.current}/settings/Display`] = displayData;
        const taxRates = _readTaxRates();
        updates[`${Outlet.current}/dineinSettings`] = {
            qrBaseUrl: val('settingQrBaseUrl'),
            taxEnabled: isChecked('dineinTaxEnabled'),
            taxName: taxRates.length > 0 ? taxRates.map(t => t.name).join(' + ') : 'GST',
            taxRate: taxRates.reduce((s, t) => s + (parseFloat(t.rate) || 0), 0),
            taxRates,
            serviceChargeEnabled: isChecked('dineinServiceChargeEnabled'),
            serviceChargeName: val('dineinServiceChargeName').trim() || 'Service Charge',
            serviceChargeRate: parseFloat(val('dineinServiceChargeRate')) || 0,
            offers: _readOffersFromDOM().filter(o => o.title)
        };
        await update(ref(db), updates);

        showToast("Settings saved successfully!", "success");
        state.settingsDirty = false;
        logAudit("Settings", "Updated Store Settings", "Global");
        document.getElementById('displayCoords').innerText = `${lat}, ${lng}`;
        if (window.updateOutletStatusIndicator) window.updateOutletStatusIndicator(storeData.shopStatus);

    } catch (e) {
        console.error("[Settings] Save Error:", e);
        showToast("Critical failure while saving settings", "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = saveBtnOriginalHTML;
            await refreshIcons(saveBtn);
        }
    }
}

// --- FEE SLABS LOGIC ---

async function renderFeeSlabs(slabs) {
    const tbody = document.getElementById('feeSlabsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    slabs.forEach((slab, index) => {
        const tr = document.createElement('tr');
        tr.className = 'premium-row-v4';
        tr.innerHTML = `
            <td>
                <div class="flex-row flex-center flex-gap-8">
                    <i data-lucide="map-pin" class="text-muted" style="width:14px;"></i>
                    <input type="number" class="slab-km form-input-small w-80" value="${slab.km}" placeholder="KM">
                    <span class="text-muted-small">km</span>
                </div>
            </td>
            <td>
                <div class="flex-row flex-center flex-gap-8">
                    <span class="text-muted-small">₹</span>
                    <input type="number" class="slab-fee form-input-small w-80" value="${slab.fee}" placeholder="Fee">
                </div>
            </td>
            <td class="text-right">
                <button class="btn-icon-danger" data-action="removeFeeSlab" title="Remove Slab">
                    <i data-lucide="trash-2" style="width:16px;"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    await refreshIcons(tbody);
}

export async function addFeeSlab() {
    const tbody = document.getElementById('feeSlabsTable');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'premium-row-v4';
    tr.innerHTML = `
        <td>
            <div class="flex-row flex-center flex-gap-8">
                <i data-lucide="map-pin" class="text-muted" style="width:14px;"></i>
                <input type="number" class="slab-km form-input-small w-80" value="0" placeholder="KM">
                <span class="text-muted-small">km</span>
            </div>
        </td>
        <td>
            <div class="flex-row flex-center flex-gap-8">
                <span class="text-muted-small">₹</span>
                <input type="number" class="slab-fee form-input-small w-80" value="0" placeholder="Fee">
            </div>
        </td>
        <td class="text-right">
            <button class="btn-icon-danger" data-action="removeFeeSlab" title="Remove Slab">
                <i data-lucide="trash-2" style="width:16px;"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    await refreshIcons(tr);
    state.settingsDirty = true;
}

function getSlabsFromTable() {
    const slabs = [];
    document.querySelectorAll('#feeSlabsTable tr').forEach(tr => {
        const km = parseFloat(tr.querySelector('.slab-km').value);
        const fee = parseFloat(tr.querySelector('.slab-fee').value);
        if (!isNaN(km)) slabs.push({ km, fee: isNaN(fee) ? 0 : fee });
    });
    return slabs.sort((a, b) => a.km - b.km);
}

// --- IMAGE PREVIEWS ---

function previewSettingsImage(inputId, previewId, hiddenId) {
    const file = document.getElementById(inputId).files[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
        showToast("Image too large (>500KB). Please compress.", "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        const previewEl = document.getElementById(previewId);
        if (previewEl) previewEl.src = base64;
        if (hiddenId) {
            const hiddenEl = document.getElementById(hiddenId);
            if (hiddenEl) hiddenEl.value = base64;
        }
    };
    reader.readAsDataURL(file);
}

// --- QUICK ACTIONS ---

export function quickUpdateOutletStatus() {
    const statusEl = document.getElementById('settingShopStatus');
    if (!statusEl) return;
    const newStatus = statusEl.value;

    update(Outlet.ref(SETTINGS_PATHS.STORE), { shopStatus: newStatus })
        .then(() => {
            logAudit("Settings", `Quick Status Update: ${newStatus}`, "Global");
            if (window.updateOutletStatusIndicator) window.updateOutletStatusIndicator(newStatus);
            showStatusAlert(newStatus);
        })
        .catch(e => {
            console.error("Failed to update outlet status:", e);
            showToast("Failed to update status", "error");
        });
}

async function showStatusAlert(newStatus) {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;

    const div = document.createElement('div');
    div.className = 'alert-box info';
    
    const labelMap = {
        'FORCE_OPEN': 'Outlet is now FORCE OPEN',
        'FORCE_CLOSED': 'Outlet is now FORCE CLOSED',
        'AUTO': 'Outlet set to AUTO'
    };
    const iconMap = { 'FORCE_OPEN': 'check-circle', 'FORCE_CLOSED': 'moon', 'AUTO': 'clock' };

    div.innerHTML = `
        <div class="alert-title">
            <i data-lucide="${iconMap[newStatus] || 'zap'}" style="width:18px;"></i>
            <span>${labelMap[newStatus] || 'Status Updated'}</span>
        </div>
        <div class="alert-sub">The WhatsApp bot and ordering system will respect this status immediately.</div>
    `;
    alertContainer.appendChild(div);
    await refreshIcons(div);
    
    setTimeout(() => {
        div.style.animation = 'slideOutPremium 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        setTimeout(() => div.remove(), 500);
    }, 4000);
}

window.updateOutletStatusIndicator = function(status) {
    const pill = document.getElementById('outletStatusPill');
    if (!pill) return;
    const label = { 'FORCE_OPEN': 'OPEN', 'FORCE_CLOSED': 'CLOSED', 'AUTO': 'AUTO' }[status] || 'AUTO';
    pill.textContent = label;
    pill.className = 'outlet-status-pill status-' + (status === 'FORCE_OPEN' ? 'open' : status === 'FORCE_CLOSED' ? 'closed' : 'auto');
};

// --- INITIALIZATION ---
// Bind image uploads for Settings
document.addEventListener('change', (e) => {
    if (e.target.id === 'settingQRFile') previewSettingsImage('settingQRFile', 'qrPreview', 'settingQRUrl');
    else if (e.target.id === 'settingGreetingFile') previewSettingsImage('settingGreetingFile', 'greetingImgPreview', 'settingGreetingUrl');
    else if (e.target.id === 'settingMenuFile') previewSettingsImage('settingMenuFile', 'menuImgPreview', 'settingMenuUrl');
    else if (e.target.id.startsWith('botImg')) {
        const id = e.target.id;
        const previewId = id.replace('File', 'Preview');
        previewSettingsImage(id, previewId);
    } else return;
    state.settingsDirty = true;
});

document.addEventListener('click', (e) => {
    // File upload button triggers
    if (e.target.id === 'btnChangeQR') document.getElementById('settingQRFile').click();
    else if (e.target.id === 'btnChangeGreetingImg') document.getElementById('settingGreetingFile').click();
    else if (e.target.id === 'btnChangeMenuImg') document.getElementById('settingMenuFile').click();

    if (e.target.classList.contains('btn-upload-bot-img')) {
        const targetId = e.target.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) input.click();
    }

    if (e.target.getAttribute('data-action') === 'removeFeeSlab') {
        const row = e.target.closest('tr');
        if (row) { row.remove(); state.settingsDirty = true; }
    }

    // Settings sub-tab switching
    const subBtn = e.target.closest('.settings-subtab');
    if (subBtn) {
        document.querySelectorAll('.settings-subtab').forEach(b => b.classList.remove('active'));
        subBtn.classList.add('active');
        const tab = subBtn.dataset.subtab;
        document.querySelectorAll('[data-settings-section]').forEach(el => {
            el.style.display = el.dataset.settingsSection === tab ? '' : 'none';
        });
    }
});

// Mark settings as dirty on ANY input change within the settings container
document.addEventListener('input', (e) => {
    const settingsTab = document.getElementById('tab-settings');
    if (settingsTab && settingsTab.contains(e.target)) {
        if (!state.settingsDirty) {
            console.log("[Settings] State is now DIRTY");
            state.settingsDirty = true;
        }
    }
});

// Set initial sub-tab state (General visible, Tax & Services hidden)
document.querySelectorAll('[data-settings-section]').forEach(el => {
    el.style.display = el.dataset.settingsSection === 'general' ? '' : 'none';
});

// -------------------------------------------------------------------
// OFFERS MANAGEMENT
// -------------------------------------------------------------------

async function _renderOffers(offers) {
    const arr = Array.isArray(offers) ? offers : (offers && typeof offers === 'object' ? Object.values(offers) : []);
    const list = document.getElementById('offersList');
    const noMsg = document.getElementById('noOffersMsg');
    if (!list) return;

    if (arr.length === 0) {
        list.innerHTML = '';
        if (noMsg) noMsg.classList.remove('hidden');
        return;
    }
    if (noMsg) noMsg.classList.add('hidden');

    list.innerHTML = arr.map((o, i) => `
        <div class="offer-row">
            <div class="offer-row-fields">
                <input type="text" class="offer-title-input form-input-small" data-offer-idx="${i}" value="${(o.title || '').replace(/"/g, '&quot;')}" placeholder="Offer title">
                <input type="text" class="offer-desc-input form-input-small" data-offer-idx="${i}" value="${(o.description || '').replace(/"/g, '&quot;')}" placeholder="Description (optional)">
                <input type="text" class="offer-code-input form-input-small" data-offer-idx="${i}" value="${(o.code || '').replace(/"/g, '&quot;')}" placeholder="Promo code (optional)">
            </div>
            <button type="button" class="btn-icon-danger offer-remove-btn" data-offer-idx="${i}" title="Remove offer">
                <i data-lucide="x" class="icon-14"></i>
            </button>
        </div>`).join('');

    await refreshIcons(list);

    list.querySelectorAll('.offer-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const all = _readOffersFromDOM();
            all.splice(Number(btn.dataset.offerIdx), 1);
            _renderOffers(all);
            state.settingsDirty = true;
        });
    });
}

document.getElementById('btnAddOffer')?.addEventListener('click', () => {
    const all = _readOffersFromDOM();
    all.push({ title: '', description: '', code: '' });
    _renderOffers(all);
    state.settingsDirty = true;
    const list = document.getElementById('offersList');
    const lastTitle = list?.querySelector('.offer-title-input:last-of-type');
    if (lastTitle) lastTitle.focus();
});

function _readOffersFromDOM() {
    const offers = [];
    document.querySelectorAll('#offersList .offer-row').forEach(row => {
        offers.push({
            title: row.querySelector('.offer-title-input')?.value?.trim() || '',
            description: row.querySelector('.offer-desc-input')?.value?.trim() || '',
            code: row.querySelector('.offer-code-input')?.value?.trim() || ''
        });
    });
    return offers;
}

// --- MULTI-TAX RATES ---
async function _renderTaxRates(rates) {
    const container = document.getElementById('dineinTaxRates');
    if (!container) return;
    const arr = Array.isArray(rates) ? rates : [];
    if (arr.length === 0) {
        container.innerHTML = '<div class="text-muted fs-12 mb-8">No tax rates configured. Tax is disabled or add a rate below.</div>';
        return;
    }
container.innerHTML = arr.map((r, i) => `
        <div class="flex-row flex-center flex-gap-8 mb-8" data-tax-idx="${i}">
            <input type="text" class="form-input mb-0 tax-rate-name" data-idx="${i}" value="${(r.name || '').replace(/"/g, '"')}" placeholder="Name (e.g. CGST)" maxlength="20" style="flex:1;min-width:0;">
            <input type="number" class="form-input mb-0 tax-rate-pct" data-idx="${i}" value="${parseFloat(r.rate) || ''}" placeholder="%" min="0" max="100" step="0.5" style="width:70px;">
            <button type="button" class="btn-icon-danger tax-rate-remove" data-idx="${i}" title="Remove this tax" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:4px;"><i data-lucide="x" class="icon-14"></i></button>
        </div>`).join('');
    await refreshIcons(container);
    container.querySelectorAll('.tax-rate-name, .tax-rate-pct').forEach(el => {
        el.addEventListener('input', () => state.settingsDirty = true);
    });
    container.querySelectorAll('.tax-rate-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.idx);
            const rates = _readTaxRates();
            rates.splice(idx, 1);
            _renderTaxRates(rates);
            state.settingsDirty = true;
        });
    });
}

function _readTaxRates() {
    const container = document.getElementById('dineinTaxRates');
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-tax-idx]')).map(row => ({
        name: row.querySelector('.tax-rate-name')?.value?.trim() || '',
        rate: parseFloat(row.querySelector('.tax-rate-pct')?.value) || 0
    })).filter(r => r.name && r.rate > 0);
}

document.getElementById('btnAddTaxRate')?.addEventListener('click', () => {
    const rates = _readTaxRates();
    rates.push({ name: '', rate: 5 });
    _renderTaxRates(rates);
    state.settingsDirty = true;
    const container = document.getElementById('dineinTaxRates');
    const lastInput = container?.querySelector('.tax-rate-name:last-of-type');
    if (lastInput) lastInput.focus();
});
