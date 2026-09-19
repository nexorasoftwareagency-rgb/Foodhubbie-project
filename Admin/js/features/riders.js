import { db, auth, getSecondaryAuth, isSecondaryAuthAvailable, Outlet, serverTimestamp, ref, get, set, push, update, runTransaction, remove, query, orderByChild, equalTo, onValue, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword } from '../firebase.js';
import { state } from '../state.js';
import { showDeleteConfirm } from '../ui-utils.js';
import { showToast, haptic, escapeHtml, standardizeAuthError, logAudit, showConfirm, addRiderNotification, getSkeletonRows } from '../utils.js';

import { loadLucide } from '../ui.js';

import { uploadImage } from '../firebase.js';
import { populateRiderSelect } from './rider-analytics.js';
let _ridersUnsub = null;
let _statsUnsub = null;
let _riderData = [];
let _riderSortField = 'name', _riderSortDir = 'asc';

export function loadRiders() {
    cleanupRiders();
    const ridersTbody = document.getElementById('riderDataTableBody');
    if (ridersTbody) ridersTbody.innerHTML = getSkeletonRows(5, 6);

    const ridersRef = ref(db, "riders");
    const statsRef = Outlet.ref("riderStats");

    _statsUnsub = onValue(statsRef, s => {
        state.riderStatsData = s.val() || {};
        if (state.ridersList.length > 0) renderRiders();
    });

    _ridersUnsub = onValue(ridersRef, snapshot => {
        const data = snapshot.val();
        state.ridersList = [];
        if (data) {
            Object.keys(data).forEach(key => {
                state.ridersList.push({ id: key, ...data[key] });
            });
        }
        renderRiders();
        populateRiderSelect();
        if (state.currentActiveTab === 'live' || state.currentActiveTab === 'orders') {
            import('./orders.js').then(m => m.renderOrders(state.lastOrdersSnap));
        }
    });

    const toggleEl = document.getElementById('showAllRidersToggle');
    if (toggleEl && !toggleEl.dataset.listenerAttached) {
        toggleEl.dataset.listenerAttached = '1';
        toggleEl.addEventListener('change', (e) => {
            state.showAllRiders = e.target.checked;
            const textEl = document.getElementById('riderToggleText');
            if (textEl) textEl.innerText = e.target.checked ? 'All' : 'Online';
            renderRiders();
        });
    }
}

export function cleanupRiders() {
    if (_ridersUnsub) { _ridersUnsub(); _ridersUnsub = null; }
    if (_statsUnsub) { _statsUnsub(); _statsUnsub = null; }
}

function _riderProfileImg(r) {
    const url = r.photoUrl || r.profilePhoto || '';
    if (url) return `<img src="${escapeHtml(url)}" class="rider-table-avatar" alt="" onerror="this.style.display='none'">`;
    const initial = (r.name || '?').charAt(0).toUpperCase();
    return `<span class="rider-table-initial">${escapeHtml(initial)}</span>`;
}

function _renderRiderTable(data) {
    const tbody = document.getElementById('riderDataTableBody');
    if (!tbody) return;

    _riderData = data || [];

    const sorted = [..._riderData].sort((a, b) => {
        let av = a[_riderSortField], bv = b[_riderSortField];
        if (_riderSortField === '_avgRating' || _riderSortField === 'orders') {
            av = Number(av ?? (
                _riderSortField === 'orders' ? (a._stats?.totalOrders ?? 0) : 0
            ));
            bv = Number(bv ?? (
                _riderSortField === 'orders' ? (b._stats?.totalOrders ?? 0) : 0
            ));
        } else if (_riderSortField === '_displayStatus') {
            const w = { 'Online': 0, 'On Delivery': 1, 'Offline': 2 };
            av = w[av] ?? 2; bv = w[bv] ?? 2;
        } else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _riderSortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="mob-table-empty">No riders found.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(r => {
        const stats = r._stats || {};
        const maskedPhone = r.phone ? '******' + escapeHtml(r.phone.slice(-4)) : 'N/A';
        const status = r._displayStatus || 'Offline';
        const statusLow = status.toLowerCase().replace(/\s+/g, '-');
        const rating = r._avgRating;
        const pct = Math.min(100, (rating || 0) * 20);
        const ratingLabel = rating ? rating.toFixed(1) + '\u2605' : '\u2014';
        const orders = parseInt(stats.totalOrders || 0);
        const earnings = stats.totalEarnings || 0;

        return `<tr>
            <td>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${_riderProfileImg(r)}
                    <div>
                        <div class="mob-td-strong">${escapeHtml(r.name || 'Unnamed')}</div>
                        <div class="mob-td-sub">\uD83D\uDCF1 ${maskedPhone}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="mob-td-strong" style="font-size:12px;">${escapeHtml(r.email || '')}</div>
                <div class="mob-td-sub">Credential Email</div>
            </td>
            <td><span class="rider-status-dot ${statusLow}"></span> ${escapeHtml(status)}</td>
            <td>
                <div style="display:flex;gap:16px;">
                    <div style="text-align:center;"><div class="mob-td-strong">${orders}</div><div class="mob-td-sub">Orders</div></div>
                    <div style="text-align:center;"><div class="mob-td-strong" style="color:#16a34a;">\u20B9${earnings.toLocaleString('en-IN')}</div><div class="mob-td-sub">Wallet</div></div>
                </div>
            </td>
            <td>
                <div style="min-width:80px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:2px;"><span class="mob-td-sub">Success</span><span style="font-size:11px;font-weight:700;">${ratingLabel}</span></div>
                    <div style="height:4px;background:var(--mob-border);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:#4472C4;border-radius:2px;"></div></div>
                </div>
            </td>
            <td class="mob-th-right">
                <div class="rider-action-btns">
                    <button class="rider-act-btn" data-action="settleRider" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name)}" title="Settle Wallet">\uD83D\uDCB0</button>
                    <button class="rider-act-btn rider-act-edit" data-action="editRider" data-id="${escapeHtml(r.id)}" title="Edit">\u270F\uFE0F</button>
                    <button class="rider-act-btn" data-action="resetRiderPassword" data-email="${escapeHtml(r.email || '')}" title="Reset Password">\uD83D\uDD11</button>
                    <button class="rider-act-btn rider-act-del" data-action="deleteRider" data-id="${escapeHtml(r.id)}" title="Delete">\uD83D\uDDD1\uFE0F</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function _initRiderTable() {
    const table = document.getElementById('riderDataTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const sortEl = table.querySelector(`th[data-sort="${_riderSortField}"]`);
    if (sortEl) sortEl.classList.add(`mob-sort-${_riderSortDir}`);

    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_riderSortField === field) {
                _riderSortDir = _riderSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _riderSortField = field;
                _riderSortDir = 'asc';
            }
            table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_riderSortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderRiderTable(_riderData);
        });
    });

    // Delegate action clicks from tbody
    document.getElementById('riderDataTableBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'settleRider') settleRiderWallet(btn.dataset.id, btn.dataset.name);
        else if (action === 'editRider') editRider(btn.dataset.id);
        else if (action === 'resetRiderPassword') resetRiderPassword(btn.dataset.email);
        else if (action === 'deleteRider') deleteRider(btn.dataset.id);
    });
}

export async function renderRiders(searchTerm = "") {
    const activeDashboard = document.getElementById('riderStatusList');
    const statOnline = document.getElementById('rider-stat-online');
    const statBusy = document.getElementById('rider-stat-busy');
    const statOffline = document.getElementById('rider-stat-offline');
    const statEarnings = document.getElementById('rider-stat-earnings');

    if (activeDashboard) activeDashboard.innerHTML = "";

    let onlineCount = 0, busyCount = 0, offlineCount = 0, totalEarnings = 0;

    const RIDER_STALE_MS = 5 * 60 * 1000;
    const isFresh = (r) => {
        if (!r || r.status !== "Online") return false;
        const ts = r.lastSeen || r.location?.ts || 0;
        return ts && (Date.now() - ts) < RIDER_STALE_MS;
    };

    const riders = [];
    state.ridersList.forEach(async r => {
        const stats = state.riderStatsData[r.id] || { totalOrders: 0, avgDeliveryTime: 0, totalEarnings: 0 };
        totalEarnings += (stats.totalEarnings || 0);

        let displayStatus = isFresh(r) ? "Online" : (r.status || "Offline");
        if (displayStatus === "Online" && r.currentOrder) displayStatus = "On Delivery";

        if (displayStatus === "Online") onlineCount++;
        else if (displayStatus === "On Delivery") busyCount++;
        else offlineCount++;

        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            const matches = (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q) || (r.phone || "").includes(q);
            if (!matches) return;
        }

        riders.push({ ...r, _displayStatus: displayStatus, _stats: stats, _avgRating: stats.avgRating || null });

        // Dashboard cards
        if (activeDashboard) {
            if (!state.showAllRiders && displayStatus === "Offline") return;
            const profileImg = r.photoUrl || r.profilePhoto || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%23E84908'/%3E%3Ctext x='20' y='26' font-size='18' fill='white' text-anchor='middle'%3E" + encodeURIComponent((r.name || '?').charAt(0).toUpperCase()) + "%3C/text%3E%3C/svg%3E";
            const card = document.createElement('div');
            card.className = `rider-status-card-v4 ${displayStatus.toLowerCase().replace(/\s+/g, '-')} premium-shadow-v4`;
            if (state.showAllRiders && displayStatus === "Offline") card.classList.add('greyed-out');
            card.innerHTML = `
                <div class="identity-chip-v4 mb-15">
                    <img src="${escapeHtml(profileImg)}" class="identity-avatar-v4" alt="${escapeHtml(r.name || 'Rider')}">
                    <div class="identity-info-v4">
                        <span class="name">${escapeHtml(r.name || 'Rider')}</span>
                        <div class="rider-status-pill-v4 ${displayStatus.toLowerCase().replace(/\s+/g, '-')}">
                            <span class="rider-dot-v4"></span>
                            <span>${escapeHtml(displayStatus)}</span>
                        </div>
                    </div>
                </div>
                ${displayStatus === 'On Delivery' && r.currentOrder ? `<div class="active-task-v4"><i data-lucide="package" style="width:12px;"></i><span>Order #${escapeHtml(String(r.currentOrder).slice(-5))}</span></div>` : `<div class="idle-state-v4 text-muted-small"><i data-lucide="clock" style="width:12px;"></i><span>Waiting for orders...</span></div>`}
            `;
            activeDashboard.appendChild(card);
            await loadLucide();
            if (window.lucide) window.lucide.createIcons({ root: card });
        }
    });

    if (!document.getElementById('riderDataTable')?.dataset.wired) _initRiderTable();
    _renderRiderTable(riders);

    if (statOnline) statOnline.innerText = onlineCount;
    if (statBusy) statBusy.innerText = busyCount;
    if (statOffline) statOffline.innerText = offlineCount;
    if (statEarnings) statEarnings.innerText = "₹" + totalEarnings.toLocaleString();

    const manageTab = document.getElementById('management-tab-container');
    await loadLucide();
    if (window.lucide) {
        if (manageTab) window.lucide.createIcons({ root: manageTab });
        else window.lucide.createIcons({ root: document.getElementById('tab-riders') || document.body });
    }
}

export function showRiderModal() {
    state.isEditRiderMode = false;
    state.currentEditingRiderId = null;
    document.getElementById('riderModalTitle').innerText = "Add New Rider";
    document.getElementById('saveRiderBtn').innerText = "Create Account";
    document.getElementById('riderEmail').disabled = false;
    document.getElementById('riderPassHint').classList.add('hidden');
    document.getElementById('riderPassLabel').innerText = "Secret Access Code (Password)";
    const fields = ['riderName', 'riderEmail', 'riderPhone', 'riderFatherName', 'riderAge', 'riderAadharNo', 'riderQual', 'riderAddress', 'riderPass'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 150 150'%3E%3Crect width='100%25' height='100%25' fill='%23eee'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='12' fill='%23999%3ENo Photo%3C/text%3E%3C/svg%3E";
    const profilePreview = document.getElementById('riderProfilePreview');
    const aadharPreview = document.getElementById('aadharPreview');
    if (profilePreview) profilePreview.src = placeholder;
    if (aadharPreview) aadharPreview.src = placeholder;
    const photoUrl = document.getElementById('riderPhotoUrl');
    const aadharUrl = document.getElementById('aadharUrl');
    if (photoUrl) photoUrl.value = "";
    if (aadharUrl) aadharUrl.value = "";
    document.getElementById('riderModal').classList.add('active');
}

export function editRider(id) {
    const r = state.ridersList.find(x => x.id === id);
    if (!r) return;
    state.isEditRiderMode = true;
    state.currentEditingRiderId = id;
    document.getElementById('riderModalTitle').innerText = "Edit Rider Details";
    document.getElementById('saveRiderBtn').innerText = "Update Rider";
    document.getElementById('riderEmail').disabled = true;
    document.getElementById('riderPassHint').classList.remove('hidden');
    document.getElementById('riderPassLabel').innerText = "Update Password (Optional)";
    document.getElementById('riderName').value = r.name || "";
    document.getElementById('riderEmail').value = r.email || "";
    document.getElementById('riderPhone').value = r.phone || "";
    document.getElementById('riderFatherName').value = r.fatherName || "";
    document.getElementById('riderAge').value = r.age || "";
    document.getElementById('riderAadharNo').value = r.aadharNo || "";
    document.getElementById('riderQual').value = r.qualification || "";
    document.getElementById('riderAddress').value = r.address || "";
    document.getElementById('riderPass').value = "";
    const SVG_PLACEHOLDER = "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23ccc%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%223%22%20y%3D%223%22%20width%3D%2218%22%20height%3D%2218%22%20rx%3D%222%22%20ry%3D%222%22%3E%3C%2Frect%3E%3Cline%20x1%3D%223%22%20y1%3D%2221%22%20x2%3D%2221%22%20y2%3D%223%22%3E%3C%2Fline%3E%3C%2Fsvg%3E";
    document.getElementById('riderProfilePreview').src = r.profilePhoto || SVG_PLACEHOLDER;
    document.getElementById('riderPhotoUrl').value = r.profilePhoto || "";
    document.getElementById('aadharPreview').src = r.aadharPhoto || SVG_PLACEHOLDER;
    document.getElementById('aadharUrl').value = r.aadharPhoto || "";
    document.getElementById('riderModal').classList.add('active');
}

export function hideRiderModal() {
    const modal = document.getElementById('riderModal');
    if (modal) modal.classList.remove('active');
}

export async function saveRiderAccount() {
    const name = document.getElementById('riderName').value.trim();
    let email = document.getElementById('riderEmail').value.trim().toLowerCase();
    const phone = document.getElementById('riderPhone').value.trim();
    let pass = document.getElementById('riderPass').value;
    if (!email) { showToast("Please provide a valid email address.", "error"); return; }
    if (!state.isEditRiderMode && !pass) {
        pass = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
        showPasswordModal(pass);
    }
    const fatherName = document.getElementById('riderFatherName').value.trim();
    const age = document.getElementById('riderAge').value;
    const aadharNo = document.getElementById('riderAadharNo').value.trim();
    const qualification = document.getElementById('riderQual').value.trim();
    const address = document.getElementById('riderAddress').value.trim();
    let profilePhoto = document.getElementById('riderPhotoUrl').value;
    let aadharPhoto = document.getElementById('aadharUrl').value;
    if (!name || !email || (!state.isEditRiderMode && !pass)) { showToast("Name, Email, and Password are required.", "error"); return; }
    if (phone && !/^\d{10}$/.test(phone)) { closePasswordModal(); showToast("Invalid Phone Number! Must be 10 digits.", "error"); return; }
    if (!/^\d{12}$/.test(aadharNo)) { closePasswordModal(); showToast("Invalid Aadhar Number! It must be exactly 12 digits.", "error"); return; }

    const profileFile = document.getElementById('riderPhotoInput').files[0];
    const aadharFile = document.getElementById('aadharPhotoInput').files[0];
    const statusLabel = document.getElementById('uploadStatusRider');

    try {
        if (profileFile || aadharFile) { if (statusLabel) statusLabel.classList.remove('hidden'); }
        if (profileFile) profilePhoto = await uploadImage(profileFile, `riders/profile_${Date.now()}`);
        if (aadharFile) aadharPhoto = await uploadImage(aadharFile, `riders/aadhar_${Date.now()}`);
        if (statusLabel) statusLabel.classList.add('hidden');

        if (state.isEditRiderMode) {
            const riderId = state.currentEditingRiderId;
            await update(ref(db, `riders/${riderId}`), { name, phone, fatherName, age, aadharNo, qualification, address, profilePhoto, aadharPhoto, updatedAt: Date.now() });
            logAudit("Riders", `Updated Rider: ${name}`, riderId);
            showToast("Rider updated successfully!", "success");
            hideRiderModal();
        } else {
            if (!isSecondaryAuthAvailable()) { closePasswordModal(); showToast("Secondary Auth Service unavailable.", "error"); return; }
            const _sa = getSecondaryAuth();
            const userCredential = await createUserWithEmailAndPassword(_sa, email, pass);
            const uid = userCredential.user.uid;
            await set(ref(db, `riders/${uid}`), { uid, name, email, phone, fatherName, age, aadharNo, qualification, address, profilePhoto, aadharPhoto, status: "Offline", createdAt: Date.now() });
            await signOut(_sa);
            logAudit("Riders", `Created New Rider: ${name}`, uid);
            closePasswordModal();
            showToast("Rider account created successfully!", "success");
            hideRiderModal();
        }
    } catch (error) {
        console.error("Rider Save Error:", error);
        closePasswordModal();
        showToast(standardizeAuthError(error), "error");
        if (statusLabel) statusLabel.classList.add('hidden');
    }
}

export async function deleteRider(id) {
    const snap = await get(ref(db, `riders/${id}`));
    const riderName = snap.val()?.name || "Unknown";
    if (!(await showDeleteConfirm(riderName))) return;
    haptic();
    try {
        await remove(ref(db, `riders/${id}`));
        logAudit("Riders", `Deleted Rider: ${riderName}`, id);
        showToast("Rider removed successfully.", "success");
    } catch (error) { showToast("Failed to delete rider.", "error"); }
}

export async function resetRiderPassword(email) {
    if (!(await showConfirm(`Send password reset email to ${email}?`))) return;
    haptic();
    try {
        await sendPasswordResetEmail(auth, email);
        logAudit("Riders", `Sent Password Reset: ${email}`, "Global");
        showToast("Reset link sent to rider email.", "success");
    } catch (error) { showToast(standardizeAuthError(error), "error"); }
}

export function toggleRiderPass() {
    const passInput = document.getElementById('riderPass');
    if (passInput) passInput.type = passInput.type === 'password' ? 'text' : 'password';
}

export async function settleRiderWallet(riderId, riderName, customTimeLimit = null) {
    showToast("Calculating pending cash...", "info");
    haptic();
    try {
        const timeLimit = customTimeLimit || (Date.now() - (48 * 60 * 60 * 1000));
        let pendingCash = 0;
        let ordersToSettle = [];
        const outlets = ['pizza', 'cake'];
        for (const outlet of outlets) {
            const snap = await get(query(ref(db, `${outlet}/orders`), orderByChild('riderId'), equalTo(riderId)));
            if (snap.exists()) {
                snap.forEach(child => {
                    const o = child.val();
                    const rawTime = o.createdAt || o.timestamp || o.assignedAt || 0;
                    const orderTime = typeof rawTime === 'string' ? new Date(rawTime).getTime() : rawTime;
                    const isCash = (o.paymentMethod || "").toUpperCase() === "CASH";
                    const status = (o.status || "").toLowerCase();
                    if (orderTime >= timeLimit && isCash && status === "delivered" && !o.settled) {
                        pendingCash += Number(o.total || 0);
                        ordersToSettle.push({ outlet, id: child.key });
                    }
                });
            }
        }
        if (pendingCash === 0) { showToast(`No pending cash to settle for ${riderName}.`, "info"); return; }
        if (!(await showConfirm(`Confirm collection of ₹${pendingCash} from ${riderName}?`))) return;

        const updates = {};
        ordersToSettle.forEach(o => { updates[`${o.outlet}/orders/${o.id}/settled`] = true; });
        const settlementId = "SETTLE_" + Date.now();
        updates[`settlements/${riderId}/${settlementId}`] = { timestamp: Date.now(), amountCollected: pendingCash, settledByAdmin: auth.currentUser?.email || "Admin", ordersClearedCount: ordersToSettle.length };
        await update(ref(db), updates);
        logAudit("Riders", `Settled Wallet for ${riderName}: ₹${pendingCash}`, riderId);
        showToast(`Successfully settled ₹${pendingCash} for ${riderName}.`, "success");

        try {
            addRiderNotification(riderId, "Settlement Complete", `Settled ₹${pendingCash} for ${ordersToSettle.length} orders.`, "settlement");
            const rider = state.ridersList.find(r => r.id === riderId);
            const rawPhone = rider?.phone || "";
            const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
            if (cleanPhone && cleanPhone.length === 10) {
                const message = `Hello ${riderName}! 🌟\n\nYour cash settlement has been completed successfully.\n\n💰 *Total Collected:* ₹${pendingCash}\n📦 *Orders Cleared:* ${ordersToSettle.length}\n✅ *Status:* Settled\n\nThank you for your hard work! 🙏`;
                const botOutlet = ordersToSettle[0]?.outlet || 'pizza';
                const cmdRef = push(ref(db, `bot/${botOutlet}/commands`));
                await set(cmdRef, { action: "SEND_GENERIC_MESSAGE", phone: cleanPhone, message, timestamp: serverTimestamp() });
            }
        } catch (notifError) { console.warn("[Riders] Post-settlement notification failed:", notifError); }
    } catch (error) { console.error("Settlement Error:", error); showToast("Failed to settle wallet.", "error"); }
}

let _passwordModal = null;
let _passwordModalTimer = null;

function showPasswordModal(password) {
    if (_passwordModal) closePasswordModal();
    const overlay = document.createElement('div');
    overlay.id = 'passwordRevealOverlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;`;
    overlay.innerHTML = `<div style="background:#1c1c1c;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);position:relative;">
        <button id="closePasswordModalBtn" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#666;font-size:22px;cursor:pointer;padding:4px;line-height:1;">✕</button>
        <h3 style="color:#fff;margin:0 0 8px;font-size:20px;font-weight:700;">New Rider Credentials</h3>
        <p style="color:#f87171;font-size:13px;margin:0 0 20px;font-weight:600;">⚠️ This password will not be shown again.</p>
        <div style="background:#0d0d0d;border:1px solid #333;border-radius:12px;padding:16px;margin-bottom:12px;">
            <div id="passwordDisplay" style="font-family:'Courier New',monospace;font-size:24px;letter-spacing:2px;color:#fff;word-break:break-all;user-select:all;">${'•'.repeat(password.length)}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;">
            <button id="toggleRevealBtn" style="flex:1;padding:10px;border-radius:10px;border:1px solid #333;background:#262626;color:#ccc;cursor:pointer;font-size:13px;font-weight:600;">👁️ Reveal</button>
            <button id="copyPasswordBtn" style="flex:1;padding:10px;border-radius:10px;border:none;background:var(--primary,#3b82f6);color:#fff;cursor:pointer;font-size:13px;font-weight:700;">📋 Copy</button>
        </div>
        <div id="copyStatus" style="font-size:12px;color:#6b7280;min-height:18px;"></div>
    </div>`;
    document.body.appendChild(overlay);
    _passwordModal = overlay;
    const passwordDisplay = overlay.querySelector('#passwordDisplay');
    const toggleBtn = overlay.querySelector('#toggleRevealBtn');
    const copyBtn = overlay.querySelector('#copyPasswordBtn');
    const copyStatus = overlay.querySelector('#copyStatus');
    let isRevealed = false;
    toggleBtn.onclick = () => { isRevealed = !isRevealed; passwordDisplay.textContent = isRevealed ? password : '•'.repeat(password.length); toggleBtn.textContent = isRevealed ? '🙈 Hide' : '👁️ Reveal'; };
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(password); copyStatus.textContent = '✅ Copied! Auto-clearing in 30s…'; copyStatus.style.color = '#34d399'; clearTimeout(_passwordModalTimer); _passwordModalTimer = setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); _passwordModalTimer = null; }, 30000); } catch { copyStatus.textContent = '❌ Copy failed.'; copyStatus.style.color = '#f87171'; } };
    overlay.querySelector('#closePasswordModalBtn').onclick = () => closePasswordModal();
    overlay.onclick = (e) => { if (e.target === overlay) closePasswordModal(); };
}

function closePasswordModal() { if (_passwordModal) { _passwordModal.remove(); _passwordModal = null; } }
