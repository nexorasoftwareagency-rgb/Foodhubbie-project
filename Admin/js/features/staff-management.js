import { state } from '../state.js';
import { BUSINESS_ID, db, Outlet, ref, get, set, update, push, remove, onValue, off, query, orderByChild, equalTo, runTransaction } from '../firebase.js';
import { auth, createUserWithEmailAndPassword, sendPasswordResetEmail } from '../firebase.js';
import { logAudit, showToast, showConfirm, hashPin, hashEmail, escapeHtml, showPinModal, capitalize, formatRelativeTime, logStaffChange, showPinPrompt } from '../utils.js';
import { loadLucide } from '../ui.js';

// --- STATE ---
let _staffListCache = [];
let _staffUnsub = null;
const refreshIcons = (root) => loadLucide().then(() => window.lucide?.createIcons({ root }));

// --- ROLE HIERARCHY ---
const ROLE_HIERARCHY = {
    'supreme admin': 4,
    'super admin': 3,
    'owner': 2,
    'manager': 1,
    'cashier': 0,
    'waiter': -1
};

function canEditRole(actorRole, targetRole) {
    const a = ROLE_HIERARCHY[actorRole?.toLowerCase()] ?? -99;
    const t = ROLE_HIERARCHY[targetRole?.toLowerCase()] ?? -99;
    return a > t;
}

function canViewStaffManagement() {
    const role = state.adminData?.role?.toLowerCase();
    return ['supreme admin', 'super admin', 'owner', 'manager'].includes(role);
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
    
    // Validate role
    if (!['cashier', 'manager', 'waiter'].includes(role)) {
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
    if (updates.role && !['cashier', 'manager', 'waiter'].includes(updates.role)) {
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

export function openAddModal() {
    return new Promise((resolve) => {
        _staffModalResolve = resolve;
        const modal = document.getElementById('staffModal');
        const form = document.getElementById('staffForm');
        const title = document.getElementById('staffModalTitle');
        
        // Reset form
        form.reset();
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
        document.getElementById('staffRole').value = staff.role;
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
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStaffModal();
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