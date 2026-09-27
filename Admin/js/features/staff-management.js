import { state } from '../state.js';
import { BUSINESS_ID, db, Outlet, ref, get, set, update, push, remove, onValue, off, query, orderByChild, equalTo, runTransaction } from '../firebase.js';
import { auth, createUserWithEmailAndPassword, sendPasswordResetEmail } from '../firebase.js';
import { logAudit, showToast, showConfirm, hashPin, hashEmail, escapeHtml, showPinModal, capitalize, formatRelativeTime, logStaffChange, showPinPrompt } from '../utils.js';
import { loadLucide, getRoles, roleLevel, TAB_DEFS, DEFAULT_ROLES } from '../ui.js';

// --- STATE ---
let _staffListCache = [];
let _staffUnsub = null;
const refreshIcons = (root) => loadLucide().then(() => window.lucide?.createIcons({ root }));

// --- ROLE HIERARCHY ---
// Levels come from the outlet's role records (ui.js: DEFAULT_ROLES or
// settings/roles); supreme/super are email-derived fixed tiers.
function canEditRole(actorRole, targetRole) {
    return roleLevel(actorRole) > roleLevel(targetRole);
}

function canViewStaffManagement() {
    return roleLevel(state.adminData?.role) >= 1; // manager and above
}

// --- CORE FUNCTIONS ---

export async function loadStaffList() {
    console.log('[StaffManagement] Loading staff list...');
    try {
        const snap = await get(Outlet.ref('staff'));
        const staff = [];
        if (snap.exists()) {
            snap.forEach(child => staff.push({ uid: child.key, ...child.val() }));
        }
        _staffListCache = staff.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        return _staffListCache;
    } catch (e) {
        console.error('[StaffManagement] Load failed:', e);
        showToast('Failed to load staff list', 'error');
        return [];
    }
}

export async function createStaffAccount({ email, displayName, role, initialPassword }) {
    console.log('[StaffManagement] Creating staff account:', email, role);
    
    // Validate role against this outlet's role definitions
    if (!getRoles()[role]) {
        throw new Error('Invalid role');
    }
    
    // Validate email format
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        throw new Error('Invalid email address');
    }
    
    // 1. Create Firebase Auth user
    let userCred;
    try {
        userCred = await createUserWithEmailAndPassword(auth, normalizedEmail, initialPassword);
    } catch (e) {
        const friendly = {
            'auth/email-already-in-use': 'This email is already registered',
            'auth/invalid-email': 'Invalid email address',
            'auth/weak-password': 'Password too weak (min 6 chars)',
            'auth/operation-not-allowed': 'Email/password auth not enabled'
        }[e.code] || e.message;
        throw new Error(friendly);
    }
    const uid = userCred.user.uid;
    
    // 2. Send password reset email (staff sets own password)
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (e) {
        console.warn('[StaffManagement] Password reset email failed:', e);
        // Don't fail the whole operation - staff can use "Forgot password" later
    }
    
    // 3. Write staff record
    const staffData = {
        uid,
        email: normalizedEmail,
        displayName: displayName.trim(),
        role,
        isActive: true,
        discountCeilingPct: 0, // 0 = inherit outlet ceiling
        counterPinHash: null,
        createdAt: new Date().toISOString(),
        createdBy: state.adminData?.uid,
        passwordSetAt: null,
        lastSignedIn: null
    };
    
    await set(Outlet.staff(uid), staffData);
    
    // 4. Write email index for uniqueness enforcement using transaction
    // The rule validates !data.exists() - transaction retries if email taken
    const emailHash = await hashEmail(normalizedEmail);
    const emailIndexRef = ref(db, `businesses/${BUSINESS_ID()}/outlets/${Outlet.current}/emailIndex/${emailHash}`);
    await runTransaction(emailIndexRef, (currentData) => {
        if (currentData === null || currentData === undefined) {
            return uid;
        }
        throw new Error('Email already registered');
    });
    
    // 5. Audit log
    await logStaffChange('staff_create', uid, null, staffData, `Created ${role} account`);
    
    // 6. Refresh local cache
    _staffListCache.push({ uid, ...staffData });
    _staffListCache.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    
    return { uid, tempPassword: initialPassword };
}

export async function updateStaff(uid, updates) {
    console.log('[StaffManagement] Updating staff:', uid, updates);
    
    const oldSnap = await get(Outlet.staff(uid));
    if (!oldSnap.exists()) throw new Error('Staff not found');
    const oldVal = oldSnap.val();
    
    // Role gating
    const actorRole = state.adminData?.role?.toLowerCase();
    const targetRole = oldVal?.role;
    if (!canEditRole(actorRole, targetRole)) {
        throw new Error('Insufficient privileges to edit this staff member');
    }
    
    // Prevent self-demotion for owners
    if (uid === state.adminData?.uid && updates.role && updates.role !== 'owner') {
        throw new Error('You cannot change your own owner role');
    }
    
    // Role change validation
    if (updates.role && !getRoles()[updates.role]) {
        throw new Error('Invalid role');
    }
    
    // Discount ceiling validation (owner-only field, but validate anyway)
    if (updates.discountCeilingPct !== undefined) {
        const ceiling = Math.max(0, Math.min(100, parseInt(updates.discountCeilingPct) || 0));
        updates.discountCeilingPct = ceiling;
    }
    
    await update(Outlet.staff(uid), updates);
    await logStaffChange('staff_update', uid, oldVal, updates, 'Updated staff profile');
    
    // Refresh cache
    const idx = _staffListCache.findIndex(s => s.uid === uid);
    if (idx !== -1) {
        _staffListCache[idx] = { ..._staffListCache[idx], ...updates };
    }
}

export async function resetCounterPin(uid) {
    console.log('[StaffManagement] Resetting counter PIN for:', uid);
    
    const oldSnap = await get(Outlet.staff(uid));
    if (!oldSnap.exists()) throw new Error('Staff not found');
    const oldHash = oldSnap.val().counterPinHash;
    
    // Generate 4-digit temp PIN
    const tempPin = String(Math.floor(1000 + Math.random() * 9000));
    const hash = await hashPin(tempPin);
    if (!hash) return showToast('PIN hashing unavailable — app must run over HTTPS.', 'error');
    
    // Update staff record and maintain reverse index (remove old, add new)
    const updates = {};
    updates[`staff/${uid}/counterPinHash`] = hash;
    updates[`counterPinIndex/${hash}`] = uid;
    if (oldHash) {
        updates[`counterPinIndex/${oldHash}`] = null;
    }
    await update(ref(db, `businesses/${BUSINESS_ID()}/outlets/${Outlet.current}`), updates);
    
    await logStaffChange('pin_reset', uid, { counterPinHash: oldHash }, { counterPinHash: hash }, 'Counter PIN reset by owner');
    
    // Refresh cache
    const idx = _staffListCache.findIndex(s => s.uid === uid);
    if (idx !== -1) _staffListCache[idx].counterPinHash = hash;
    
    return tempPin; // Return once for owner to share
}

export async function disableStaff(uid) {
    console.log('[StaffManagement] Disabling staff:', uid);
    
    if (uid === state.adminData?.uid) throw new Error('You cannot disable your own account');
    
    const oldSnap = await get(Outlet.staff(uid));
    if (!oldSnap.exists()) throw new Error('Staff not found');
    
    await update(Outlet.staff(uid), { isActive: false });
    await logStaffChange('staff_disable', uid, { isActive: true }, { isActive: false }, 'Account disabled by owner');
    
    const idx = _staffListCache.findIndex(s => s.uid === uid);
    if (idx !== -1) _staffListCache[idx].isActive = false;
}

export async function enableStaff(uid) {
    console.log('[StaffManagement] Enabling staff:', uid);
    
    await update(Outlet.staff(uid), { isActive: true });
    await logStaffChange('staff_enable', uid, { isActive: false }, { isActive: true }, 'Account re-enabled by owner');
    
    const idx = _staffListCache.findIndex(s => s.uid === uid);
    if (idx !== -1) _staffListCache[idx].isActive = true;
}

export async function setStaffCeiling(uid, ceilingPct) {
    console.log('[StaffManagement] Setting ceiling for:', uid, ceilingPct);
    
    const ceiling = Math.max(0, Math.min(100, parseInt(ceilingPct) || 0));
    
    // Write to both places: denormalized on staff record + explicit override node
    const updates = {};
    updates[`staff/${uid}/discountCeilingPct`] = ceiling;
    if (ceiling > 0) {
        updates[`settings/Security/staffCeilings/${uid}`] = {
            ceilingPct: ceiling,
            updatedAt: new Date().toISOString(),
            updatedBy: state.adminData?.uid
        };
    } else {
        // Ceiling 0 = inherit, remove explicit override
        updates[`settings/Security/staffCeilings/${uid}`] = null;
    }
    
    await update(ref(db, `businesses/${BUSINESS_ID()}/outlets/${Outlet.current}`), updates);
    await logStaffChange('ceiling_update', uid, null, { ceilingPct: ceiling }, `Discount ceiling set to ${ceiling}%`);
    
    // Refresh cache
    const idx = _staffListCache.findIndex(s => s.uid === uid);
    if (idx !== -1) _staffListCache[idx].discountCeilingPct = ceiling;
}

// --- UI RENDERING ---

export function renderStaffTable() {
    const tbody = document.getElementById('staffTableBody');
    if (!tbody) return;
    
    const canManage = canViewStaffManagement();
    
    if (_staffListCache.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted p-30">No staff members yet. Click "Add Staff" to create an account.</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = _staffListCache.map(staff => {
        const pinStatus = staff.counterPinHash ? 
            '<span class="badge success">SET</span>' : 
            '<span class="badge warning">NOT SET</span>';
        const ceilingDisplay = staff.discountCeilingPct > 0 ? 
            `${staff.discountCeilingPct}%` : 
            '<span class="text-muted">Inherit (outlet)</span>';
        const lastSignedIn = staff.lastSignedIn ? 
            formatRelativeTime(staff.lastSignedIn) : 
            '<span class="text-muted">Never</span>';
        const statusBadge = staff.isActive ? 
            '<span class="badge success">Active</span>' : 
            '<span class="badge danger">Disabled</span>';
        
        const actions = canManage ? `
            <div class="flex-row flex-gap-4">
                <button class="btn-icon-secondary btn-edit-staff" data-uid="${staff.uid}" title="Edit">
                    <i data-lucide="edit-2" class="icon-14"></i>
                </button>
                <button class="btn-icon-secondary btn-reset-pin" data-uid="${staff.uid}" title="Reset Counter PIN">
                    <i data-lucide="key" class="icon-14"></i>
                </button>
                ${staff.isActive ? 
                    `<button class="btn-icon-danger btn-disable-staff" data-uid="${staff.uid}" title="Disable Account">
                        <i data-lucide="user-x" class="icon-14"></i>
                    </button>` :
                    `<button class="btn-icon-success btn-enable-staff" data-uid="${staff.uid}" title="Enable Account">
                        <i data-lucide="user-check" class="icon-14"></i>
                    </button>`
                }
            </div>
        ` : '<span class="text-muted-small">View only</span>';
        
        return `
            <tr data-uid="${staff.uid}">
                <td>${escapeHtml(staff.displayName)}</td>
                <td><span class="badge ${roleBadgeClass(staff.role)}">${capitalize(staff.role)}</span></td>
                <td>${pinStatus}</td>
                <td>${ceilingDisplay}</td>
                <td>${lastSignedIn}</td>
                <td>${statusBadge}</td>
                <td>${actions}</td>
            </tr>
        `;
    }).join('');
    
    refreshIcons(tbody);
    attachRowListeners();
}

function roleBadgeClass(role) {
    switch (role) {
        case 'owner': return 'info';
        case 'manager': return 'primary';
        case 'cashier': return 'secondary';
        case 'waiter': return 'ghost';
        default: return 'ghost';
    }
}

function attachRowListeners() {
    const tbody = document.getElementById('staffTableBody');
    if (!tbody) return;
    
    // Edit
    tbody.querySelectorAll('.btn-edit-staff').forEach(btn => {
        btn.onclick = () => openEditModal(btn.dataset.uid);
    });
    
    // Reset PIN
    tbody.querySelectorAll('.btn-reset-pin').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            if (!await showConfirm('Reset Counter PIN?', 'A new 4-digit PIN will be generated. Share it with the staff member securely.')) return;
            try {
                const tempPin = await resetCounterPin(uid);
                showPinModal(`New Counter PIN for ${_staffListCache.find(s => s.uid === uid)?.displayName}:`, tempPin);
                renderStaffTable();
            } catch (e) {
                showToast(e.message || 'Failed to reset PIN', 'error');
            }
        };
    });
    
    // Disable
    tbody.querySelectorAll('.btn-disable-staff').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const staff = _staffListCache.find(s => s.uid === uid);
            if (!await showConfirm('Disable Account?', `${staff.displayName} will not be able to sign in.`)) return;
            try {
                await disableStaff(uid);
                renderStaffTable();
                showToast('Account disabled', 'success');
            } catch (e) {
                showToast(e.message || 'Failed to disable', 'error');
            }
        };
    });
    
    // Enable
    tbody.querySelectorAll('.btn-enable-staff').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            try {
                await enableStaff(uid);
                renderStaffTable();
                showToast('Account enabled', 'success');
            } catch (e) {
                showToast(e.message || 'Failed to enable', 'error');
            }
        };
    });
}

// --- MODALS ---

let _staffModalResolve = null;
let _roleEditKey = null; // role key being edited in the roles modal (null = new)

// Populate the role dropdown from this outlet's role definitions.
function fillRoleSelect(selected) {
    const sel = document.getElementById('staffRole');
    sel.innerHTML = Object.entries(getRoles())
        .map(([key, r]) => `<option value="${escapeHtml(key)}">${escapeHtml(r.name || capitalize(key))}</option>`)
        .join('');
    if (selected && getRoles()[selected]) sel.value = selected;
}

export function openAddModal() {
    return new Promise((resolve) => {
        _staffModalResolve = resolve;
        const modal = document.getElementById('staffModal');
        const form = document.getElementById('staffForm');
        const title = document.getElementById('staffModalTitle');
        
        // Reset form
        form.reset();
        fillRoleSelect();
        document.getElementById('staffEditUid').value = '';
        document.getElementById('staffEmail').disabled = false;
        document.getElementById('staffInitialPasswordGroup').style.display = '';
        document.getElementById('staffCeilingGroup').style.display = 'none'; // Ceiling set after creation
        title.innerText = 'Add Staff Member';
        document.getElementById('staffSubmitBtn').innerText = 'Create Account';
        
        // Role change handler for ceiling field
        const roleSelect = document.getElementById('staffRole');
        roleSelect.onchange = () => {
            document.getElementById('staffCeilingGroup').style.display = roleSelect.value === 'waiter' ? 'none' : '';
        };
        
        modal.classList.remove('hidden');
        modal.classList.add('active');
        setTimeout(() => document.getElementById('staffEmail').focus(), 100);
    });
}

export function openEditModal(uid) {
    return new Promise((resolve) => {
        _staffModalResolve = resolve;
        const staff = _staffListCache.find(s => s.uid === uid);
        if (!staff) return showToast('Staff not found', 'error');
        
        const modal = document.getElementById('staffModal');
        const form = document.getElementById('staffForm');
        const title = document.getElementById('staffModalTitle');
        
        form.reset();
        document.getElementById('staffEditUid').value = uid;
        document.getElementById('staffEmail').value = staff.email;
        document.getElementById('staffEmail').disabled = true; // Email cannot change
        document.getElementById('staffName').value = staff.displayName;
        fillRoleSelect(staff.role);
        document.getElementById('staffCeilingPct').value = staff.discountCeilingPct || 0;
        document.getElementById('staffInitialPasswordGroup').style.display = 'none'; // No password change here
        document.getElementById('staffCeilingGroup').style.display = staff.role === 'waiter' ? 'none' : '';
        title.innerText = 'Edit Staff Member';
        document.getElementById('staffSubmitBtn').innerText = 'Save Changes';
        
        const roleSelect = document.getElementById('staffRole');
        roleSelect.onchange = () => {
            document.getElementById('staffCeilingGroup').style.display = roleSelect.value === 'waiter' ? 'none' : '';
        };
        
        modal.classList.remove('hidden');
        modal.classList.add('active');
        setTimeout(() => document.getElementById('staffName').focus(), 100);
    });
}

function closeStaffModal() {
    const modal = document.getElementById('staffModal');
    modal.classList.add('hidden');
    modal.classList.remove('active');
    if (_staffModalResolve) {
        _staffModalResolve(null);
        _staffModalResolve = null;
    }
}

// --- ROLES EDITOR (per-outlet role → tab access matrix) ---

export function renderRolesList() {
    const el = document.getElementById('rolesList');
    const addBtn = document.getElementById('btnAddRole');
    if (!el) return;
    const allowed = canViewStaffManagement();
    if (addBtn) addBtn.style.display = allowed ? '' : 'none';
    if (!allowed) {
        el.innerHTML = '<p class="text-muted-small">Only managers and above can edit roles.</p>';
        return;
    }
    const roles = getRoles();
    el.innerHTML = Object.entries(roles).map(([key, r]) => {
        const tabs = Array.isArray(r.tabs) ? r.tabs.length : 0;
        const isSystem = !!DEFAULT_ROLES[key];
        return `<div class="flex-between flex-center" style="border:1px solid var(--border-color);border-radius:10px;padding:10px 14px;margin-bottom:8px;gap:10px;">
            <div>
                <strong>${escapeHtml(r.name || capitalize(key))}</strong>
                <span class="text-muted-small"> · level ${Number(r.level) ?? 0} · ${tabs}/${TAB_DEFS.length} tabs${isSystem ? ' · default' : ' · custom'}</span>
            </div>
            <div class="flex-row" style="gap:12px;">
                <button class="btn-text-primary-sm" data-action="editRole" data-role="${escapeHtml(key)}">Edit</button>
                ${isSystem ? '' : `<button class="btn-text-primary-sm" data-action="deleteRole" data-role="${escapeHtml(key)}">Delete</button>`}
            </div>
        </div>`;
    }).join('');
}

function openRoleModal(key) {
    _roleEditKey = key || null;
    const role = key ? getRoles()[key] : null;
    document.getElementById('roleModalTitle').innerText = key ? `Edit Role: ${role?.name || key}` : 'New Role';
    document.getElementById('roleName').value = role?.name || '';
    document.getElementById('roleLevel').value = role?.level ?? 0;
    const tabs = Array.isArray(role?.tabs) ? role.tabs : [];
    document.getElementById('roleTabsList').innerHTML = TAB_DEFS.map(([id, label]) =>
        `<label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" value="${escapeHtml(id)}" ${tabs.includes(id) ? 'checked' : ''}> ${escapeHtml(label)}
        </label>`).join('');
    document.getElementById('roleDeleteBtn').style.display = (key && !DEFAULT_ROLES[key]) ? '' : 'none';
    const modal = document.getElementById('roleModal');
    modal.classList.remove('hidden');
    modal.classList.add('active');
    setTimeout(() => document.getElementById('roleName').focus(), 100);
}

function closeRoleModal() {
    const modal = document.getElementById('roleModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('active');
    _roleEditKey = null;
}

async function saveRole() {
    const name = document.getElementById('roleName').value.trim();
    if (!name) return showToast('Role name is required', 'warning');
    const level = parseInt(document.getElementById('roleLevel').value, 10);
    if (Number.isNaN(level)) return showToast('Level must be a number', 'warning');
    const tabs = Array.from(document.querySelectorAll('#roleTabsList input:checked')).map(i => i.value);
    const roles = { ...getRoles() };
    let key = _roleEditKey;
    if (!key) {
        key = name.toLowerCase();
        if (roles[key]) return showToast('A role with that name already exists', 'warning');
    }
    roles[key] = { name, level, tabs };
    try {
        await set(Outlet.ref('settings/roles'), roles);
        state.roles = roles;
        renderRolesList();
        closeRoleModal();
        showToast('Role saved', 'success');
    } catch (e) {
        showToast(e.message || 'Failed to save role', 'error');
    }
}

async function deleteRole() {
    const key = _roleEditKey;
    if (!key || DEFAULT_ROLES[key]) return closeRoleModal();
    const roles = { ...getRoles() };
    const inUse = _staffListCache.filter(s => s.role === key).length;
    const ok = await showConfirm(
        inUse
            ? `"${roles[key]?.name || key}" is assigned to ${inUse} staff member(s). They will fall back to full access. Delete anyway?`
            : `Delete role "${roles[key]?.name || key}"?`,
        'Delete Role'
    );
    if (!ok) return;
    delete roles[key];
    try {
        await set(Outlet.ref('settings/roles'), roles);
        state.roles = roles;
        renderRolesList();
        closeRoleModal();
        showToast('Role deleted', 'success');
    } catch (e) {
        showToast(e.message || 'Failed to delete role', 'error');
    }
}

// Form submit handler
document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'staffForm') return;
    e.preventDefault();
    
    const uid = document.getElementById('staffEditUid').value;
    const email = document.getElementById('staffEmail').value.trim().toLowerCase();
    const displayName = document.getElementById('staffName').value.trim();
    const role = document.getElementById('staffRole').value;
    const ceilingPct = parseInt(document.getElementById('staffCeilingPct').value) || 0;
    const initialPassword = document.getElementById('staffInitialPassword').value;
    
    if (!displayName) return showToast('Name is required', 'warning');
    if (!email) return showToast('Email is required', 'warning');
    if (!uid && !initialPassword) return showToast('Initial password is required', 'warning');
    if (initialPassword && initialPassword.length < 6) return showToast('Password must be at least 6 characters', 'warning');
    
    const submitBtn = document.getElementById('staffSubmitBtn');
    const originalHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader" class="icon-16 spin-icon"></i> Saving...';
    await refreshIcons(submitBtn);
    
    try {
        if (uid) {
            // Edit existing
            await updateStaff(uid, { displayName, role, discountCeilingPct: ceilingPct });
            showToast('Staff updated', 'success');
        } else {
            // Create new
            const result = await createStaffAccount({ email, displayName, role, initialPassword });
            showToast(`Account created! Temporary password: ${result.tempPassword}`, 'success', 8000);
        }
        closeStaffModal();
        renderStaffTable();
    } catch (e) {
        showToast(e.message || 'Operation failed', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        await refreshIcons(submitBtn);
    }
});

// Close modal handlers
document.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'closeStaffModal' || e.target.closest('[data-action="closeStaffModal"]')) {
        closeStaffModal();
    }
    if (e.target.id === 'staffModal') closeStaffModal(); // Click overlay

    if (e.target.dataset.action === 'closeRoleModal' || e.target.closest('[data-action="closeRoleModal"]')) {
        closeRoleModal();
    }
    if (e.target.id === 'roleModal') closeRoleModal(); // Click overlay

    if (e.target.closest('#btnAddRole')) return openRoleModal(null);
    const editBtn = e.target.closest('[data-action="editRole"]');
    if (editBtn) return openRoleModal(editBtn.dataset.role);
    const delBtn = e.target.closest('[data-action="deleteRole"]');
    if (delBtn) { _roleEditKey = delBtn.dataset.role; return deleteRole(); }
    if (e.target.closest('#roleSaveBtn')) return saveRole();
    if (e.target.closest('#roleDeleteBtn')) return deleteRole();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeStaffModal(); closeRoleModal(); }
});

// --- REALTIME LISTENER (optional, for live updates) ---
export function startStaffListener() {
    if (_staffUnsub) return;
    const staffRef = query(Outlet.ref('staff'), orderByChild('displayName'));
    _staffUnsub = onValue(staffRef, (snap) => {
        const staff = [];
        if (snap.exists()) snap.forEach(child => staff.push({ uid: child.key, ...child.val() }));
        _staffListCache = staff;
        renderStaffTable();
    });
}

export function stopStaffListener() {
    if (_staffUnsub) { _staffUnsub(); _staffUnsub = null; }
}

// --- INITIALIZATION ---
document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('#btnAddStaff');
    if (addBtn) openAddModal();
});