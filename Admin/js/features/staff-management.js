import { state } from '../state.js';
import { BUSINESS_ID, db, Outlet, ref, get, set, update, push, remove, onValue, off, query, orderByChild, equalTo, runTransaction } from '../firebase.js';
import { auth, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, getSecondaryAuth } from '../firebase.js';
import { logAudit, showToast, showConfirm, hashPin, hashEmail, escapeHtml, showPinModal, capitalize, formatRelativeTime, logStaffChange, showPinPrompt } from '../utils.js';
import { loadLucide, getRoles, roleLevel, TAB_DEFS, DEFAULT_ROLES } from '../ui.js';

// --- STATE ---
let _staffListCache = [];
let _staffUnsub = null;
let _staffTableState = 'idle'; // 'idle' | 'loading' | 'error' | 'ready'

export function setStaffTableState(state) {
    _staffTableState = state;
    renderStaffTable();
}

// Global retry handler for error state
window.staffManagementRetry = () => loadStaffList();

// Two-page layout inside the section: Staff | Roles & Access
function showSmPage(page) {
    document.querySelectorAll('[data-sm-pane]').forEach(el => { el.style.display = el.dataset.smPane === page ? '' : 'none'; });
    document.querySelectorAll('.sm-subtab').forEach(b => {
        const on = b.dataset.smPage === page;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
}
document.querySelectorAll('.sm-subtab').forEach(b => { b.onclick = () => showSmPage(b.dataset.smPage); });

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
    setStaffTableState('loading');
    try {
        const snap = await get(Outlet.ref('staff'));
        const staff = [];
        if (snap.exists()) {
            snap.forEach(child => { staff.push({ uid: child.key, ...child.val() }); });
        }
        _staffListCache = staff.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        setStaffTableState('ready');
        return _staffListCache;
    } catch (e) {
        console.error('[StaffManagement] Load failed:', e);
        showToast('Failed to load staff list', 'error');
        setStaffTableState('error');
        return [];
    }
}

export async function createStaffAccount({ email, displayName, role, initialPassword }) {
    console.log('[StaffManagement] Creating staff account:', email, role);
    
    // Validate role against this outlet's role definitions
    if (!getRoles()[role]) {
        throw new Error('Invalid role');
    }
    // Nobody may create a role above their own level (manager → owner = escalation)
    if (roleLevel(state.adminData?.role) < roleLevel(role)) {
        throw new Error('You cannot create an account with a role higher than your own');
    }
    
    // Validate email format
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        throw new Error('Invalid email address');
    }
    
    // 1. Create Firebase Auth user on the SECONDARY auth instance — creating on
    // the primary would sign the new staff in, hijacking the owner's session so
    // every write below runs as the unprovisioned new user and gets denied.
    let userCred;
    const _sa = getSecondaryAuth();
    if (!_sa) throw new Error('Account creation service unavailable. Refresh and retry.');
    try {
        userCred = await createUserWithEmailAndPassword(_sa, normalizedEmail, initialPassword);
        await signOut(_sa);
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

    // Provision the login node first — dashboard entry, role→tab gating and
    // outlet rules all read admins/{uid}
    await set(ref(db, `admins/${uid}`), {
        email: normalizedEmail,
        outlet: Outlet.current,
        name: displayName.trim(),
        role,
        fcmToken: ''
    });
    
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
    // Cannot assign a role above your own level (peer allowed)
    if (updates.role && roleLevel(actorRole) < roleLevel(updates.role)) {
        throw new Error('You cannot assign a role higher than your own');
    }
    
    // Discount ceiling validation (owner-only field, but validate anyway)
    if (updates.discountCeilingPct !== undefined) {
        const ceiling = Math.max(0, Math.min(100, parseInt(updates.discountCeilingPct) || 0));
        updates.discountCeilingPct = ceiling;
    }
    // Auto-zero ceiling when role changed to waiter (waiters cannot apply manual discounts)
    if (updates.role === 'waiter') {
        updates.discountCeilingPct = 0;
    }
    
    await update(Outlet.staff(uid), updates);
    // Keep the login node's role in sync — dashboard gating and rules read admins/{uid}
    if (updates.role && updates.role !== oldVal.role) {
        await update(ref(db, `admins/${uid}`), { role: updates.role })
            .catch(e => console.warn('[StaffManagement] admins role sync failed:', e));
    }
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
    
    // Generate 4-digit temp PIN (crypto-secure)
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const tempPin = String(1000 + (arr[0] % 9000));
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

    // Pane header count chip
    const countEl = document.getElementById('smStaffCount');
    if (countEl && _staffTableState === 'ready') {
        const total = _staffListCache.length;
        const active = _staffListCache.filter(s => s.isActive).length;
        countEl.textContent = total ? `${total} team member${total === 1 ? '' : 's'} · ${active} active` : 'No staff yet';
    }
    
    // Loading state
    if (_staffTableState === 'loading') {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center p-30">
                    <div class="flex-center flex-gap-12">
                        <i data-lucide="loader" class="icon-20 spin-icon text-primary"></i>
                        <span class="text-muted">Loading staff...</span>
                    </div>
                </td>
            </tr>
        `;
        refreshIcons(tbody);
        return;
    }
    
    // Error state
    if (_staffTableState === 'error') {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center p-30">
                    <div class="flex-col flex-center flex-gap-8">
                        <i data-lucide="alert-circle" class="icon-24 text-error"></i>
                        <span class="text-error">Failed to load staff list</span>
                        <button class="btn-secondary btn-small" onclick="window.staffManagementRetry?.()">
                            <i data-lucide="refresh-cw" class="icon-14"></i> Retry
                        </button>
                    </div>
                </td>
            </tr>
        `;
        refreshIcons(tbody);
        return;
    }
    
    if (_staffListCache.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted p-30">No staff members yet. Click "Add Staff" to create an account.</td>
            </tr>
        `;
        return;
    }
    
    // Group staff by role
    const rolesOrder = ['owner', 'manager', 'cashier', 'waiter'];
    const roles = getRoles();
    const staffByRole = {};
    for (const staff of _staffListCache) {
        const roleKey = staff.role || 'cashier';
        if (!staffByRole[roleKey]) staffByRole[roleKey] = [];
        staffByRole[roleKey].push(staff);
    }
    
    // Build rows grouped by role with role header
    const rows = [];
    for (const roleKey of rolesOrder) {
        const roleDef = roles[roleKey];
        if (!roleDef) continue;
        const staffList = staffByRole[roleKey] || [];
        
        // Role header row
        const hasSettingsAccess = roleDef.tabs?.includes('settings');
        rows.push(`
            <tr class="role-header-row" style="background:var(--bg-subtle);">
                <td colspan="7" style="padding:12px 16px;">
                    <div class="flex-row flex-center flex-gap-12" style="flex-wrap:wrap;align-items:center;">
                        <span class="badge ${roleBadgeClass(roleKey)}" style="font-size:12px;">${capitalize(roleKey)}</span>
                        <span class="text-muted-small">${staffList.length} staff</span>
                        ${hasSettingsAccess ? '<span class="badge warning" style="font-size:11px;"><i data-lucide="shield" class="icon-10"></i> Settings Access</span>' : ''}
                        <span class="text-muted-small" style="margin-left:auto;">Level: ${roleDef.level}</span>
                    </div>
                    <div class="role-tabs-preview" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                        ${roleDef.tabs?.map(t => `<span class="tab-chip" style="background:var(--bg-elevated);border:1px solid var(--border-color);padding:2px 8px;border-radius:4px;font-size:11px;">${escapeHtml(t)}</span>`).join('') || ''}
                    </div>
                </td>
            </tr>
        `);
        
        if (staffList.length === 0) {
            rows.push(`
                <tr class="role-empty-row" style="background:var(--bg-subtle);">
                    <td colspan="7" class="text-center text-muted p-20" style="font-size:12px;">No ${capitalize(roleKey)}s yet</td>
                </tr>
            `);
        } else {
            for (const staff of staffList) {
                const pinStatus = staff.counterPinHash ? 
                    '<span class="badge success">SET</span>' : 
                    '<span class="badge warning">NOT SET</span>';
                const ceilingDisplay = staff.discountCeilingPct > 0 ? 
                    `${staff.discountCeilingPct}%` : 
                    '<span class="text-muted">Inherit</span>';
                const lastSignedIn = staff.lastSignedIn ? 
                    formatRelativeTime(staff.lastSignedIn) : 
                    '<span class="text-muted">Never</span>';
                const statusBadge = staff.isActive ? 
                    '<span class="badge success">Active</span>' : 
                    '<span class="badge danger">Disabled</span>';
                
                // Credentials display (email only, password shown once on creation)
                const credentialsHtml = `
                    <div class="staff-credentials" style="font-size:12px;line-height:1.6;">
                        <div><strong>Email:</strong> ${escapeHtml(staff.email)}</div>
                        <div><strong>UID:</strong> <code style="background:var(--bg-elevated);padding:1px 4px;border-radius:3px;">${staff.uid}</code></div>
                    </div>
                `;
                
                const actions = canManage ? `
                    <div class="flex-row flex-gap-4">
                        <button class="btn-icon-secondary btn-edit-staff" data-uid="${staff.uid}" title="Edit">
                            <i data-lucide="edit-2" class="icon-14"></i>
                        </button>
                        <button class="btn-icon-secondary btn-reset-pin" data-uid="${staff.uid}" title="Reset Counter PIN">
                            <i data-lucide="key" class="icon-14"></i>
                        </button>
                        <button class="btn-icon-secondary btn-send-password-reset" data-uid="${staff.uid}" data-email="${escapeHtml(staff.email)}" data-name="${escapeHtml(staff.displayName)}" title="Send Password Reset Email">
                            <i data-lucide="mail" class="icon-14"></i>
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
                
                rows.push(`
                    <tr data-uid="${staff.uid}" class="staff-row" style="border-top:1px solid var(--border-color);">
                        <td style="padding:12px 16px;min-width:180px;">
                            <div style="font-weight:500;">${escapeHtml(staff.displayName)}</div>
                            ${credentialsHtml}
                        </td>
                        <td style="padding:12px 16px;text-align:center;">
                            <span class="badge ${roleBadgeClass(staff.role)}">${capitalize(staff.role)}</span>
                        </td>
                        <td style="padding:12px 16px;text-align:center;">${pinStatus}</td>
                        <td style="padding:12px 16px;text-align:center;">${ceilingDisplay}</td>
                        <td style="padding:12px 16px;">${lastSignedIn}</td>
                        <td style="padding:12px 16px;text-align:center;">${statusBadge}</td>
                        <td style="padding:12px 16px;text-align:center;">${actions}</td>
                    </tr>
                `);
            }
        }
    }
    
    tbody.innerHTML = rows.join('');
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
    
    // Send Password Reset Email
    tbody.querySelectorAll('.btn-send-password-reset').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const email = btn.dataset.email;
            const name = btn.dataset.name;
            if (!await showConfirm('Send Password Reset Email?', `A password reset link will be sent to ${name} (${email}).`)) return;
            try {
                await sendPasswordResetEmail(auth, email);
                showToast(`Password reset email sent to ${email}`, 'success');
                await logStaffChange('password_reset_email', uid, null, { email }, 'Owner sent password reset email');
            } catch (e) {
                console.error('[StaffManagement] Password reset email failed:', e);
                const friendly = {
                    'auth/user-not-found': 'User not found in Auth',
                    'auth/invalid-email': 'Invalid email address',
                    'auth/too-many-requests': 'Too many requests. Try again later.'
                }[e.code] || e.message;
                showToast(friendly, 'error');
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
    
    // Build visual matrix
    const tabIds = TAB_DEFS.map(t => t[0]);
    const tabLabels = Object.fromEntries(TAB_DEFS);
    
    el.innerHTML = `
        <div class="roles-matrix" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                    <tr style="background:var(--bg-subtle);position:sticky;top:0;z-index:1;">
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid var(--border-color);min-width:180px;">Role</th>
                        <th style="padding:8px 12px;text-align:center;border-bottom:2px solid var(--border-color);min-width:60px;">Level</th>
                        ${tabIds.map(id => `
                            <th style="padding:8px 6px;text-align:center;border-bottom:2px solid var(--border-color);border-left:1px solid var(--border-color);min-width:36px;white-space:nowrap;" title="${escapeHtml(tabLabels[id])}">
                                <span style="display:inline-block;transform:rotate(-45deg);transform-origin:left top;width:80px;text-align:left;font-size:11px;">${escapeHtml(tabLabels[id])}</span>
                            </th>
                        `).join('')}
                        <th style="padding:8px 12px;text-align:center;border-bottom:2px solid var(--border-color);border-left:1px solid var(--border-color);min-width:100px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(roles).map(([key, r]) => {
                        const tabs = Array.isArray(r.tabs) ? r.tabs : [];
                        const isSystem = !!DEFAULT_ROLES[key];
                        const hasSettings = tabs.includes('settings');
                        return `
                            <tr style="border-bottom:1px solid var(--border-color);">
                                <td style="padding:10px 12px;border-right:1px solid var(--border-color);">
                                    <div style="font-weight:500;">${escapeHtml(r.name || capitalize(key))}</div>
                                    <div class="text-muted-small">${isSystem ? 'Default' : 'Custom'} · Level ${Number(r.level) ?? 0}</div>
                                    ${hasSettings ? '<span class="badge warning" style="font-size:10px;margin-top:4px;display:inline-block;"><i data-lucide="shield" class="icon-8"></i> Settings</span>' : ''}
                                </td>
                                <td style="padding:10px 12px;text-align:center;border-right:1px solid var(--border-color);">${Number(r.level) ?? 0}</td>
                                ${tabIds.map(id => `
                                    <td style="padding:6px;text-align:center;border-left:1px solid var(--border-color);">
                                        ${tabs.includes(id) ? 
                                            '<i data-lucide="check" class="icon-14 text-success" style="width:14px;height:14px;"></i>' : 
                                            '<i data-lucide="x" class="icon-14 text-muted" style="width:14px;height:14px;"></i>'
                                        }
                                    </td>
                                `).join('')}
                                <td style="padding:10px 12px;text-align:center;border-left:1px solid var(--border-color);">
                                    <div class="flex-row flex-center flex-gap-4" style="justify-content:center;">
                                        <button class="btn-icon-secondary btn-edit-role" data-role="${escapeHtml(key)}" title="Edit Role">
                                            <i data-lucide="edit-2" class="icon-14"></i>
                                        </button>
                                        ${isSystem ? '' : `
                                            <button class="btn-icon-danger btn-delete-role" data-role="${escapeHtml(key)}" title="Delete Role">
                                                <i data-lucide="trash-2" class="icon-14"></i>
                                            </button>
                                        `}
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    refreshIcons(el);
    
    // Attach listeners
    el.querySelectorAll('.btn-edit-role').forEach(btn => {
        btn.onclick = () => openRoleModal(btn.dataset.role);
    });
    el.querySelectorAll('.btn-delete-role').forEach(btn => {
        btn.onclick = () => { _roleEditKey = btn.dataset.role; deleteRole(); };
    });
}

function openRoleModal(key) {
    _roleEditKey = key || null;
    const role = key ? getRoles()[key] : null;
    document.getElementById('roleModalTitle').innerText = key ? `Edit Role: ${role?.name || key}` : 'New Role';
    document.getElementById('roleName').value = role?.name || '';
    document.getElementById('roleLevel').value = role?.level ?? 0;
    
    const tabs = Array.isArray(role?.tabs) ? role.tabs : [];
    const tabIds = TAB_DEFS.map(t => t[0]);
    const tabLabels = Object.fromEntries(TAB_DEFS);
    
    // Build visual matrix in modal
    document.getElementById('roleTabsList').innerHTML = `
        <div style="overflow-x:auto;max-height:300px;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                    <tr style="background:var(--bg-subtle);">
                        <th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--border-color);min-width:160px;">Tab</th>
                        <th style="padding:6px 8px;text-align:center;border-bottom:1px solid var(--border-color);min-width:60px;border-left:1px solid var(--border-color);">Access</th>
                    </tr>
                </thead>
                <tbody>
                    ${tabIds.map(id => `
                        <tr style="border-bottom:1px solid var(--border-color);">
                            <td style="padding:8px 10px;border-right:1px solid var(--border-color);">
                                ${escapeHtml(tabLabels[id])}
                            </td>
                            <td style="padding:8px 10px;text-align:center;border-left:1px solid var(--border-color);">
                                <label style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;">
                                    <input type="checkbox" value="${escapeHtml(id)}" ${tabs.includes(id) ? 'checked' : ''} style="width:18px;height:18px;">
                                    <span>${tabs.includes(id) ? '✓ Enabled' : '✗ Disabled'}</span>
                                </label>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    // Select All / None handlers — assigned (not addEventListener) so reopening
    // never stacks listeners; labels re-sync whenever checkbox state changes.
    const tabsList = document.getElementById('roleTabsList');
    const syncTabLabels = () => tabsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const span = cb.closest('label')?.querySelector('span');
        if (span) span.textContent = cb.checked ? '✓ Enabled' : '✗ Disabled';
    });
    tabsList.onchange = syncTabLabels;
    const setAllTabs = (checked) => {
        tabsList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
        syncTabLabels();
    };
    const allBtn = document.getElementById('roleSelectAllTabs');
    const noneBtn = document.getElementById('roleSelectNoneTabs');
    if (allBtn) allBtn.onclick = () => setAllTabs(true);
    if (noneBtn) noneBtn.onclick = () => setAllTabs(false);
    
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
    if (level < -1 || level > 100) return showToast('Level must be between -1 and 100', 'warning');
    
    const tabs = Array.from(document.querySelectorAll('#roleTabsList input:checked'))
        .map(i => i.value)
        .filter(t => TAB_DEFS.some(d => d[0] === t)); // Only allow known tabs
    
    if (tabs.length === 0) return showToast('Select at least one allowed tab', 'warning');
    
    const roles = { ...getRoles() };
    let key = _roleEditKey;
    
    // Sanitize key: lowercase, spaces to underscores, alphanumeric + underscore only
    const sanitizeKey = (n) => n.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    
    if (!key) {
        // New role: generate key from sanitized name
        key = sanitizeKey(name);
        if (!key) return showToast('Role name must contain valid characters', 'warning');
        if (roles[key]) return showToast('A role with that name already exists', 'warning');
    } else if (key !== sanitizeKey(name)) {
        // Edit mode: name changed -> create new key, delete old
        const newKey = sanitizeKey(name);
        if (!newKey) return showToast('Role name must contain valid characters', 'warning');
        if (roles[newKey]) return showToast('A role with that name already exists', 'warning');
        // Reassign staff from old key to new key
        const affectedStaff = _staffListCache.filter(s => s.role === key);
        for (const staff of affectedStaff) {
            await update(Outlet.staff(staff.uid), { role: newKey });
            const idx = _staffListCache.findIndex(s => s.uid === staff.uid);
            if (idx !== -1) _staffListCache[idx].role = newKey;
            await logStaffChange('staff_update', staff.uid, { role: key }, { role: newKey }, `Role renamed: ${key} → ${newKey}`);
        }
        delete roles[key];
        key = newKey;
    }
    
    // Check unique level (except for the role being edited)
    const levelTaken = Object.entries(roles).some(([k, r]) => k !== key && r.level === level);
    if (levelTaken) return showToast('Another role already uses this level', 'warning');
    
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
    const affectedStaff = _staffListCache.filter(s => s.role === key);
    const inUse = affectedStaff.length;
    const ok = await showConfirm(
        inUse
            ? `"${roles[key]?.name || key}" is assigned to ${inUse} staff member(s). They will be reassigned to "Cashier". Delete anyway?`
            : `Delete role "${roles[key]?.name || key}"?`,
        'Delete Role'
    );
    if (!ok) return;
    
    // Reassign affected staff to 'cashier' before deleting role
    if (inUse > 0) {
        for (const staff of affectedStaff) {
            await update(Outlet.staff(staff.uid), { role: 'cashier' });
            // Update cache
            const idx = _staffListCache.findIndex(s => s.uid === staff.uid);
            if (idx !== -1) _staffListCache[idx].role = 'cashier';
            await logStaffChange('staff_update', staff.uid, { role: key }, { role: 'cashier' }, `Reassigned due to role deletion: ${key}`);
        }
    }
    
    delete roles[key];
    try {
        await set(Outlet.ref('settings/roles'), roles);
        state.roles = roles;
        renderRolesList();
        renderStaffTable();
        closeRoleModal();
        showToast('Role deleted, affected staff reassigned to Cashier', 'success');
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
        if (snap.exists()) snap.forEach(child => { staff.push({ uid: child.key, ...child.val() }); });
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