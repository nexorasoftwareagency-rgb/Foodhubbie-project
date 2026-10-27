import { state } from '../state.js';
import { BUSINESS_ID, db, Outlet, ref, get, set, update, push, remove, onValue, query, orderByChild, equalTo, runTransaction } from '../firebase.js';
import { auth, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, getSecondaryAuth } from '../firebase.js';
import { logAudit, showToast, showConfirm, hashPin, hashEmail, escapeHtml, showPinModal, capitalize, formatRelativeTime, logStaffChange, showPinPrompt } from '../utils.js';
import { loadLucide, getRoles, roleLevel, TAB_DEFS, DEFAULT_ROLES } from '../ui.js';
import { computePayroll, round2 as payRound2 } from '../../shared/payroll-math.js';

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
// (Phase 3 added: attendance / shifts / leave / payroll pages)
function showSmPage(page) {
    document.querySelectorAll('[data-sm-pane]').forEach(el => { el.style.display = el.dataset.smPane === page ? '' : 'none'; });
    document.querySelectorAll('.sm-subtab').forEach(b => {
        const on = b.dataset.smPage === page;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Lazy-load page data on first visit (idempotent)
    if (page === 'attendance') initAttendancePage();
    if (page === 'shifts') initShiftsPage();
    if (page === 'leave') initLeavePage();
    if (page === 'payroll') initPayrollPage();
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
        // Phase 3 pages render from this cache — refresh any that are on screen
        // so they don't stay stuck on "No staff yet" when the list lands late.
        refreshStaffPagesIfVisible();
        return _staffListCache;
    } catch (e) {
        console.error('[StaffManagement] Load failed:', e);
        showToast('Failed to load staff list', 'error');
        setStaffTableState('error');
        return [];
    }
}

export async function createStaffAccount({ email, displayName, role, initialPassword, payType, rate }) {
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
        businessId: BUSINESS_ID(),
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
        payType: payType || 'MONTHLY',
        rate: rate ?? null, // null = excluded from payroll until a rate is set
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
                <td colspan="6" class="text-center p-30">
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
                <td colspan="6" class="text-center p-30">
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
                <td colspan="6" class="text-center text-muted p-30">No staff members yet. Click "Add Staff" to create an account.</td>
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
    
    // Only groups that have staff render — custom roles included, empty groups skipped
    const orderedRoleKeys = [
        ...rolesOrder.filter(k => staffByRole[k]),
        ...Object.keys(staffByRole).filter(k => !rolesOrder.includes(k)),
    ];

    // Build rows grouped by role with a compact role header
    const rows = [];
    for (const roleKey of orderedRoleKeys) {
        const roleDef = roles[roleKey];
        const staffList = staffByRole[roleKey];
        
        // Role header row
        const hasSettingsAccess = roleDef?.tabs?.includes('settings');
        rows.push(`
            <tr class="role-header-row" style="background:var(--bg-subtle);">
                <td colspan="6" style="padding:10px 16px;">
                    <div class="flex-row flex-center flex-gap-12" style="flex-wrap:wrap;align-items:center;">
                        <span class="badge ${roleBadgeClass(roleKey)}" style="font-size:12px;">${capitalize(roleKey)}</span>
                        <span class="text-muted-small">${staffList.length} staff</span>
                        ${hasSettingsAccess ? '<span class="badge warning" style="font-size:11px;"><i data-lucide="shield" class="icon-10"></i> Settings Access</span>' : ''}
                        <span class="text-muted-small" style="margin-left:auto;">${roleDef ? `Level: ${roleDef.level}` : ''}</span>
                    </div>
                </td>
            </tr>
        `);
        
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
                            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(staff.email)}</div>
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
        document.getElementById('staffPayType').value = 'MONTHLY';
        document.getElementById('staffRate').value = '';
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
        document.getElementById('staffPayType').value = staff.payType || 'MONTHLY';
        document.getElementById('staffRate').value = staff.rate ?? '';
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
    
    el.innerHTML = Object.entries(roles).map(([key, r]) => {
        const tabs = Array.isArray(r.tabs) ? r.tabs : [];
        const isSystem = !!DEFAULT_ROLES[key];
        const hasSettings = tabs.includes('settings');
        return `
            <div class="role-card">
                <div class="role-card-head">
                    <div class="role-card-title">
                        <span class="badge ${roleBadgeClass(key)}" style="font-size:12px;">${escapeHtml(r.name || capitalize(key))}</span>
                        <span class="role-card-meta">${isSystem ? 'Default' : 'Custom'} · Level ${Number(r.level) ?? 0}</span>
                        ${hasSettings ? '<span class="badge warning" style="font-size:11px;"><i data-lucide="shield" class="icon-10"></i> Settings</span>' : ''}
                    </div>
                    <div class="flex-row flex-gap-4">
                        <button class="btn-icon-secondary btn-edit-role" data-role="${escapeHtml(key)}" title="Edit Role">
                            <i data-lucide="edit-2" class="icon-14"></i>
                        </button>
                        ${isSystem ? '' : `
                            <button class="btn-icon-danger btn-delete-role" data-role="${escapeHtml(key)}" title="Delete Role">
                                <i data-lucide="trash-2" class="icon-14"></i>
                            </button>
                        `}
                    </div>
                </div>
                <div class="role-card-chips">
                    <span class="rc-count">${tabs.length}/${tabIds.length} tabs</span>
                    ${tabs.map(t => `<span class="sm-tab-chip">${escapeHtml(tabLabels[t] || t)}</span>`).join('')}
                </div>
            </div>
        `;
    }).join('');
    
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
    
    // Toggle chips (grid layout declared inline on #roleTabsList in index.html)
    document.getElementById('roleTabsList').innerHTML = tabIds.map(id => `
        <label class="rt-chip${tabs.includes(id) ? ' on' : ''}">
            <input type="checkbox" value="${escapeHtml(id)}" ${tabs.includes(id) ? 'checked' : ''} hidden>
            <i data-lucide="check" class="icon-12"></i>
            <span>${escapeHtml(tabLabels[id])}</span>
        </label>
    `).join('');
    refreshIcons(document.getElementById('roleTabsList'));
    
    // Select All / None handlers — assigned (not addEventListener) so reopening
    // never stacks listeners; chips re-sync whenever checkbox state changes.
    const tabsList = document.getElementById('roleTabsList');
    const syncTabLabels = () => tabsList.querySelectorAll('.rt-chip').forEach(chip => {
        const cb = chip.querySelector('input');
        if (cb) chip.classList.toggle('on', cb.checked);
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
    const payType = document.getElementById('staffPayType').value === 'HOURLY' ? 'HOURLY' : 'MONTHLY';
    const rateRaw = parseFloat(document.getElementById('staffRate').value);
    const rate = (!isNaN(rateRaw) && rateRaw > 0) ? rateRaw : null; // blank/0 = not on payroll
    
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
            await updateStaff(uid, { displayName, role, discountCeilingPct: ceilingPct, payType, rate });
            showToast('Staff updated', 'success');
        } else {
            // Create new
            const result = await createStaffAccount({ email, displayName, role, initialPassword, payType, rate });
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

// ============================================================
// PHASE 3: ATTENDANCE / SHIFTS / LEAVE / PAYROLL
// Data model (all under the outlet):
//   attendance/{YYYY-MM-DD}/{uid} = { inAt, outAt?, minutes? }
//   shifts/{YYYY-Www}             = { uid: [{day 0=Mon..6=Sun, startMinute, endMinute, station?}] }
//   leave/{requestId}             = { uid, from, to, paid, status: pending|approved|rejected }
//   payrollRuns/{periodId}        = { periodStart, periodEnd, tipPool, lines, closedAt, closedBy }
// Payroll math lives in shared/payroll-math.js (pure, self-checked).
// ============================================================

const DAY_MS = 86400000;
// LOCAL calendar day → 'YYYY-MM-DD' (attendance days are business-local)
const ymdLocal = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmtRs = (n) => `₹${payRound2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtHM = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const fmtHrs = (mins) => mins == null ? '—' : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
const staffName = (uid) => _staffListCache.find(s => s.uid === uid)?.displayName || uid.slice(0, 8);
const payrollStaff = () => _staffListCache.filter(s => s.isActive !== false && s.payType && Number(s.rate) > 0)
    .map(s => ({ uid: s.uid, payType: s.payType, rate: Number(s.rate) }));

// Re-render Phase 3 pages that are currently on screen (cache landed late)
function refreshStaffPagesIfVisible() {
    const paneVisible = (name) => {
        const el = document.querySelector(`[data-sm-pane="${name}"]`);
        return el && el.style.display !== 'none';
    };
    if (paneVisible('attendance')) { renderAttendanceToday(); loadAttendanceHistory(); }
    if (paneVisible('shifts')) loadShiftWeek();
}

// '2026-W44' → UTC ms of that ISO week's Monday (Jan 4 is always in W01)
function weekStartMs(weekId) {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || '');
    if (!m) return null;
    const jan4 = new Date(Date.UTC(+m[1], 0, 4));
    const dow = jan4.getUTCDay() || 7; // Mon=1..Sun=7
    const mondayW1 = Date.UTC(+m[1], 0, 4 - dow + 1);
    return mondayW1 + ((+m[2] - 1) * 7 * DAY_MS);
}
const hmToMinutes = (hm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
    if (!m) return null;
    const v = (+m[1]) * 60 + (+m[2]);
    return (v >= 0 && v < 1440) ? v : null;
};

// --- ATTENDANCE ------------------------------------------------------------
let _attInitialized = false;

function initAttendancePage() {
    document.getElementById('attDateLabel').textContent =
        `Today — ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`;
    document.getElementById('btnAttRefresh').onclick = () => { renderAttendanceToday(); loadAttendanceHistory(); };
    if (!_attInitialized) {
        _attInitialized = true;
        renderAttendanceToday();
        loadAttendanceHistory();
    }
}

async function renderAttendanceToday() {
    const list = document.getElementById('attTodayList');
    const today = ymdLocal(new Date());
    let att = {};
    try {
        const snap = await get(Outlet.ref(`attendance/${today}`));
        att = snap.val() || {};
    } catch (e) { console.warn('[Staff] attendance read failed', e); }

    const staff = _staffListCache.filter(s => s.isActive !== false);
    if (!staff.length) { list.innerHTML = '<p class="text-muted-small p-20 text-center">No staff yet.</p>'; return; }
    list.innerHTML = staff.map(s => {
        const a = att[s.uid] || {};
        const status = a.inAt && a.outAt
            ? `<span class="text-muted-small">Out ${fmtHM(a.outAt)} · ${fmtHrs(a.minutes)}</span>`
            : a.inAt
                ? '<span style="color:var(--success,#16a34a);font-weight:600;">● Clocked in ' + fmtHM(a.inAt) + '</span>'
                : '<span class="text-muted-small">Not clocked in</span>';
        const btn = !a.inAt
            ? `<button class="btn-primary" data-att="in" data-uid="${escapeHtml(s.uid)}"><i data-lucide="log-in" class="icon-14"></i> Clock In</button>`
            : !a.outAt
                ? `<button class="btn-primary" data-att="out" data-uid="${escapeHtml(s.uid)}"><i data-lucide="log-out" class="icon-14"></i> Clock Out</button>`
                : `<button class="btn-secondary" data-att="in" data-uid="${escapeHtml(s.uid)}" disabled>Done</button>`;
        return `<div class="glass-card p-12 mb-8" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <div><strong>${escapeHtml(s.displayName)}</strong> <span class="text-muted-small">(${escapeHtml(capitalize(s.role || ''))})</span><br>${status}</div>
            <div>${btn}</div>
        </div>`;
    }).join('');
    refreshIcons(list);

    list.querySelectorAll('[data-att]').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid, dir = btn.dataset.att;
            const path = Outlet.ref(`attendance/${today}/${uid}`);
            try {
                if (dir === 'in') {
                    await set(path, { inAt: new Date().toISOString(), outAt: null, minutes: null });
                    showToast(`${staffName(uid)} clocked in`, 'success');
                } else {
                    const snap = await get(path);
                    const a = snap.val() || {};
                    if (!a.inAt) return showToast('No clock-in recorded for today', 'error');
                    const outAt = new Date().toISOString();
                    const minutes = Math.max(0, Math.round((new Date(outAt) - new Date(a.inAt)) / 60000));
                    await update(path, { outAt, minutes });
                    showToast(`${staffName(uid)} clocked out — ${fmtHrs(minutes)}`, 'success');
                }
                renderAttendanceToday();
                loadAttendanceHistory();
            } catch (e) {
                showToast(e.message || 'Attendance write failed', 'error');
            }
        };
    });
}

async function loadAttendanceHistory() {
    const body = document.getElementById('attHistoryBody');
    const today = new Date();
    const dates = Array.from({ length: 7 }, (_, i) => ymdLocal(new Date(today.getTime() - i * DAY_MS)));
    const snaps = await Promise.all(dates.map(d => get(Outlet.ref(`attendance/${d}`)).catch(() => null)));
    const rows = [];
    dates.forEach((d, i) => {
        const dayAtt = (snaps[i] && snaps[i].val()) || {};
        for (const [uid, a] of Object.entries(dayAtt)) {
            rows.push({ d, uid, a });
        }
    });
    rows.sort((x, y) => y.d.localeCompare(x.d) || String(x.uid).localeCompare(String(y.uid)));
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-20">No attendance in the last 7 days.</td></tr>'; return; }
    body.innerHTML = rows.map(r => `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);">${escapeHtml(staffName(r.uid))}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(r.d)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${fmtHM(r.a.inAt)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${fmtHM(r.a.outAt)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${fmtHrs(r.a.minutes)}</td>
    </tr>`).join('');
}

// --- SHIFTS ----------------------------------------------------------------
const SHIFT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let _shiftsInitialized = false;

function initShiftsPage() {
    const weekInput = document.getElementById('shiftWeek');
    if (!weekInput.value) {
        // Default: current ISO week (input type=week value format 'YYYY-Www')
        const now = new Date();
        const jan4 = new Date(now.getFullYear(), 0, 4);
        const dow = jan4.getDay() || 7;
        const week = Math.ceil((((now - jan4) / DAY_MS) + dow) / 7);
        weekInput.value = `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    weekInput.onchange = loadShiftWeek;
    document.getElementById('btnShiftSave').onclick = saveShiftWeek;
    if (!_shiftsInitialized) { _shiftsInitialized = true; loadShiftWeek(); }
}

function renderShiftGrid(weekData) {
    const head = document.getElementById('shiftGridHead');
    const body = document.getElementById('shiftGridBody');
    const startMs = weekStartMs(weekInputValue());
    head.innerHTML = `<th style="padding:10px 14px;text-align:left;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border-color);">Staff</th>` +
        SHIFT_DAYS.map((d, i) => {
            const dt = startMs != null ? new Date(startMs + i * DAY_MS) : null;
            const label = dt ? `${d} ${dt.getUTCDate()}/${dt.getUTCMonth() + 1}` : d;
            return `<th style="padding:10px 6px;text-align:center;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border-color);white-space:nowrap;">${label}</th>`;
        }).join('');

    const staff = _staffListCache.filter(s => s.isActive !== false);
    if (!staff.length) { body.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-20">No staff yet.</td></tr>'; return; }
    const t = (mins) => mins == null ? '' : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const pairHtml = (uid, day, sh) => `<div style="margin-bottom:4px;white-space:nowrap;">
        <input type="time" data-shift-uid="${escapeHtml(uid)}" data-shift-day="${day}" data-shift-field="start" value="${escapeHtml(t(sh.startMinute))}" style="width:84px;" aria-label="start">
        <input type="time" data-shift-uid="${escapeHtml(uid)}" data-shift-day="${day}" data-shift-field="end" value="${escapeHtml(t(sh.endMinute))}" style="width:84px;" aria-label="end">
    </div>`;
    body.innerHTML = staff.map(s => {
        const cells = SHIFT_DAYS.map((_, day) => {
            const shifts = (weekData[s.uid] || []).filter(x => x && x.day === day);
            // Always render ≥1 editable pair — an empty cell must still be
            // fillable, and "+" stacks up to 3 shifts/day (clash check needs 2+).
            const shown = shifts.length ? shifts.slice(0, 3) : [{}];
            return `<td style="padding:6px 4px;border-bottom:1px solid var(--border-color);text-align:center;" data-cell-uid="${escapeHtml(s.uid)}" data-cell-day="${day}">
                ${shown.map(sh => pairHtml(s.uid, day, sh)).join('')}
                ${shifts.length < 3 ? `<button type="button" class="btn-secondary" data-shift-add data-uid="${escapeHtml(s.uid)}" data-day="${day}" style="padding:2px 8px;font-size:12px;" title="Add another shift">+</button>` : ''}
            </td>`;
        }).join('');
        return `<tr><td style="padding:10px 14px;border-bottom:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(s.displayName)}</td>${cells}</tr>`;
    }).join('');
    // "+" appends another (empty) shift pair to that cell — makes double-booking
    // possible so the clash check has something to catch.
    body.querySelectorAll('[data-shift-add]').forEach(btn => {
        btn.onclick = () => {
            const cell = btn.closest('td');
            if (cell.querySelectorAll('[data-shift-field="start"]').length >= 3) return;
            btn.insertAdjacentHTML('beforebegin', pairHtml(btn.dataset.uid, btn.dataset.day, {}));
        };
    });
}

const weekInputValue = () => document.getElementById('shiftWeek').value;

async function loadShiftWeek() {
    const body = document.getElementById('shiftGridBody');
    body.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-20">Loading...</td></tr>';
    try {
        const snap = await get(Outlet.ref(`shifts/${weekInputValue()}`));
        renderShiftGrid(snap.val() || {});
    } catch (e) {
        body.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-20">Could not load shifts.</td></tr>';
    }
}

async function saveShiftWeek() {
    const weekId = weekInputValue();
    if (!weekStartMs(weekId)) return showToast('Pick a valid week', 'error');
    // Collect inputs in DOM order → per-uid/day list of {start,end} pairs.
    // Each 'start' input begins a new pair; its 'end' attaches to it.
    const perUid = {};
    document.querySelectorAll('[data-shift-uid]').forEach(inp => {
        const uid = inp.dataset.shiftUid, day = +inp.dataset.shiftDay;
        perUid[uid] = perUid[uid] || {};
        perUid[uid][day] = perUid[uid][day] || [];
        const pairs = perUid[uid][day];
        if (inp.dataset.shiftField === 'start') {
            pairs.push({ start: hmToMinutes(inp.value), end: null });
        } else if (pairs.length && pairs[pairs.length - 1].end == null) {
            pairs[pairs.length - 1].end = hmToMinutes(inp.value);
        }
    });
    const out = {};
    for (const [uid, days] of Object.entries(perUid)) {
        const arr = [];
        for (const [day, pairs] of Object.entries(days)) {
            for (const f of pairs) {
                const both = f.start != null && f.end != null;
                if (!both && (f.start != null || f.end != null)) {
                    return showToast(`${staffName(uid)} ${SHIFT_DAYS[day]}: fill both start and end (or leave both blank)`, 'error');
                }
                if (both) {
                    if (f.end <= f.start) return showToast(`${staffName(uid)} ${SHIFT_DAYS[day]}: end must be after start`, 'error');
                    arr.push({ day: +day, startMinute: f.start, endMinute: f.end });
                }
            }
        }
        if (arr.length) out[uid] = arr;
    }
    // Clash check: same uid, same day, overlapping [start, end) ranges
    for (const [uid, arr] of Object.entries(out)) {
        for (const d of new Set(arr.map(s => s.day))) {
            const same = arr.filter(s => s.day === d).sort((a, b) => a.startMinute - b.startMinute);
            for (let i = 1; i < same.length; i++) {
                if (same[i].startMinute < same[i - 1].endMinute) {
                    return showToast(`Clash: ${staffName(uid)} is double-booked on ${SHIFT_DAYS[d]}`, 'error');
                }
            }
        }
    }
    try {
        await set(Outlet.ref(`shifts/${weekId}`), out);
        showToast('Shift week saved', 'success');
    } catch (e) {
        showToast(e.message || 'Shift save failed', 'error');
    }
}

// --- LEAVE -----------------------------------------------------------------
let _leaveUnsub = null;
let _leaveCache = {};
let _leaveInitialized = false;

function initLeavePage() {
    document.getElementById('btnLeaveAdd').onclick = () => {
        const form = document.getElementById('leaveAddForm');
        const show = form.style.display === 'none';
        form.style.display = show ? '' : 'none';
        if (show) {
            const sel = document.getElementById('leaveStaff');
            sel.innerHTML = _staffListCache.filter(s => s.isActive !== false)
                .map(s => `<option value="${escapeHtml(s.uid)}">${escapeHtml(s.displayName)}</option>`).join('');
            document.getElementById('leaveFrom').value = ymdLocal(new Date());
            document.getElementById('leaveTo').value = ymdLocal(new Date());
        }
    };
    document.getElementById('btnLeaveSubmit').onclick = submitLeaveRequest;
    if (!_leaveInitialized) {
        _leaveInitialized = true;
        _leaveUnsub = onValue(Outlet.ref('leave'), (snap) => {
            _leaveCache = snap.val() || {};
            renderLeaveTable();
        }, (e) => {
            console.warn('[Staff] leave listener failed', e);
            document.getElementById('leaveTableBody').innerHTML = '<tr><td colspan="6" class="text-center text-muted p-20">Could not load leave requests.</td></tr>';
        });
    }
}

function renderLeaveTable() {
    const body = document.getElementById('leaveTableBody');
    const rows = Object.entries(_leaveCache).sort((a, b) => String(b[1].from || '').localeCompare(String(a[1].from || '')));
    if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="text-center text-muted p-20">No leave requests.</td></tr>'; return; }
    const badge = (status) => status === 'approved' ? '<span style="color:var(--success,#16a34a);font-weight:600;">approved</span>'
        : status === 'rejected' ? '<span style="color:var(--danger,#dc2626);font-weight:600;">rejected</span>'
        : '<span style="color:var(--warning,#d97706);font-weight:600;">pending</span>';
    body.innerHTML = rows.map(([id, l]) => `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);">${escapeHtml(staffName(l.uid))}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(l.from)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(l.to)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${l.paid ? 'Paid' : 'Unpaid'}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${badge(l.status)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;white-space:nowrap;">
            ${l.status === 'pending' ? `
            <button class="btn-primary" data-leave-approve="${escapeHtml(id)}" style="padding:6px 10px;">Approve</button>
            <button class="btn-secondary" data-leave-reject="${escapeHtml(id)}" style="padding:6px 10px;">Reject</button>` : '—'}
        </td>
    </tr>`).join('');
    refreshIcons(body);

    body.querySelectorAll('[data-leave-approve]').forEach(b => { b.onclick = () => setLeaveStatus(b.dataset.leaveApprove, 'approved'); });
    body.querySelectorAll('[data-leave-reject]').forEach(b => { b.onclick = () => setLeaveStatus(b.dataset.leaveReject, 'rejected'); });
}

async function setLeaveStatus(id, status) {
    try {
        await update(Outlet.ref(`leave/${id}`), { status, decidedAt: new Date().toISOString(), decidedBy: state.adminData?.uid });
        showToast(`Leave ${status}`, 'success');
    } catch (e) {
        showToast(e.message || 'Leave update failed', 'error');
    }
}

async function submitLeaveRequest() {
    const uid = document.getElementById('leaveStaff').value;
    const from = document.getElementById('leaveFrom').value;
    const to = document.getElementById('leaveTo').value;
    const paid = document.getElementById('leavePaid').checked;
    if (!uid) return showToast('Pick a staff member', 'error');
    if (!from || !to) return showToast('Pick from/to dates', 'error');
    if (to < from) return showToast('"To" must be on or after "From"', 'error');
    try {
        await push(Outlet.ref('leave'), {
            uid, from, to, paid, status: 'pending',
            createdAt: new Date().toISOString(),
            createdBy: state.adminData?.uid,
        });
        document.getElementById('leaveAddForm').style.display = 'none';
        showToast('Leave request saved', 'success');
    } catch (e) {
        showToast(e.message || 'Leave save failed', 'error');
    }
}

// Approved UNPAID leave days overlapping [periodStart, periodEnd] → { uid: days }
async function unpaidLeaveDaysInPeriod(periodStart, periodEnd) {
    const out = {};
    for (const l of Object.values(_leaveCache)) {
        if (l.status !== 'approved' || l.paid) continue;
        const from = l.from > periodStart ? l.from : periodStart;
        const to = l.to < periodEnd ? l.to : periodEnd;
        if (to < from) continue; // no overlap with the period
        const days = daysInclusiveLocal(from, to);
        out[l.uid] = (out[l.uid] || 0) + days;
    }
    return out;
}

// Local inclusive day count for YYYY-MM-DD strings (mirror of payroll-math daysInclusive)
function daysInclusiveLocal(start, end) {
    const p = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    const a = p(start), b = p(end);
    if (a == null || b == null) return 0;
    return Math.max(0, Math.round((b - a) / DAY_MS) + 1);
}

// --- PAYROLL ---------------------------------------------------------------
let _payPreview = null; // last previewed { periodStart, periodEnd, tipPool, lines }
let _payRunsInitialized = false;

function initPayrollPage() {
    const startInp = document.getElementById('payPeriodStart');
    const endInp = document.getElementById('payPeriodEnd');
    if (!startInp.value) {
        const now = new Date();
        startInp.value = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
        endInp.value = ymdLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    }
    document.getElementById('btnPayPreview').onclick = previewPayroll;
    document.getElementById('btnPayClose').onclick = closePayrollRun;
    document.getElementById('btnPayCsv').onclick = exportPayrollCsv;
    if (!_payRunsInitialized) {
        _payRunsInitialized = true;
        onValue(Outlet.ref('payrollRuns'), (snap) => renderPayrollRuns(snap.val() || {}), (e) => {
            console.warn('[Staff] payrollRuns listener failed', e);
        });
    }
}

async function previewPayroll() {
    const periodStart = document.getElementById('payPeriodStart').value;
    const periodEnd = document.getElementById('payPeriodEnd').value;
    const tipPool = parseFloat(document.getElementById('payTipPool').value) || 0;
    if (!periodStart || !periodEnd) return showToast('Pick both period dates', 'error');
    if (periodEnd < periodStart) return showToast('Period end must be on or after start', 'error');
    const staff = payrollStaff();
    if (!staff.length) {
        document.getElementById('payPreviewBody').innerHTML = '<tr><td colspan="7" class="text-center text-muted p-20">No staff configured for payroll — set Pay Type + Rate in each staff profile.</td></tr>';
        document.getElementById('payPreviewNote').textContent = '';
        _payPreview = null;
        return;
    }
    // Clocked minutes per uid across the period (one get per day — parallel)
    const dates = [];
    for (let t = new Date(periodStart + 'T00:00:00'); t <= new Date(periodEnd + 'T00:00:00'); t = new Date(t.getTime() + DAY_MS)) {
        dates.push(ymdLocal(t));
    }
    const snaps = await Promise.all(dates.map(d => get(Outlet.ref(`attendance/${d}`)).catch(() => null)));
    const minutesByUid = {};
    snaps.forEach((s, i) => {
        const dayAtt = (s && s.val()) || {};
        for (const [uid, a] of Object.entries(dayAtt)) {
            if (a && a.minutes != null) minutesByUid[uid] = (minutesByUid[uid] || 0) + a.minutes;
        }
    });
    const unpaidDays = await unpaidLeaveDaysInPeriod(periodStart, periodEnd);
    const lines = computePayroll({ periodStart, periodEnd, tipPool, staff, minutesByUid, unpaidLeaveDaysByUid: unpaidDays });
    _payPreview = { periodStart, periodEnd, tipPool, lines };

    const nameOf = (uid) => staffName(uid);
    document.getElementById('payPreviewBody').innerHTML = lines.map(l => `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);">${escapeHtml(nameOf(l.userId))}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${l.payType === 'HOURLY' ? 'Hourly' : 'Monthly'}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:center;">${l.hoursWorked.toFixed(2)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:right;">${fmtRs(l.basePay)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:right;">${fmtRs(l.tipShare)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:right;">${l.unpaidLeaveDeduction ? '−' + fmtRs(l.unpaidLeaveDeduction) : '—'}</td>
        <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);text-align:right;font-weight:700;">${fmtRs(l.netPay)}</td>
    </tr>`).join('');
    const unconfigured = _staffListCache.filter(s => s.isActive !== false && !(s.payType && Number(s.rate) > 0)).length;
    document.getElementById('payPreviewNote').textContent =
        `${dates.length} days · ${lines.length} staff on payroll` + (unconfigured ? ` · ${unconfigured} staff without pay config excluded` : '');
    document.getElementById('btnPayClose').style.display = '';
    document.getElementById('btnPayCsv').style.display = '';
    refreshIcons(document.getElementById('payPreviewBody'));
}

async function closePayrollRun() {
    if (!_payPreview) return;
    const periodId = `${_payPreview.periodStart}__${_payPreview.periodEnd}`;
    // Client-side immutability guard. The rules-level guard (closedAt write
    // gate) cannot bind business admins — the businesses/$bid .write grant
    // cascades over deeper denies (verified live 2026-10-27) — so the UI
    // refuses to touch an existing run itself.
    try {
        const existing = await get(Outlet.ref(`payrollRuns/${periodId}`));
        if (existing.exists()) {
            return showToast('This period already has a closed run — closed runs are immutable.', 'error');
        }
    } catch (e) { /* read failure → let the write attempt surface any problem */ }
    const ok = await showConfirm(`Close payroll run ${_payPreview.periodStart} → ${_payPreview.periodEnd}? A closed run is an immutable snapshot.`);
    if (!ok) return;
    try {
        await set(Outlet.ref(`payrollRuns/${periodId}`), {
            periodStart: _payPreview.periodStart,
            periodEnd: _payPreview.periodEnd,
            tipPool: _payPreview.tipPool,
            lines: _payPreview.lines,
            closedAt: new Date().toISOString(),
            closedBy: state.adminData?.uid,
        });
        showToast('Payroll run closed (immutable snapshot)', 'success');
        _payPreview = null;
        document.getElementById('btnPayClose').style.display = 'none';
        document.getElementById('btnPayCsv').style.display = 'none';
    } catch (e) {
        showToast(e.message?.includes('Permission') ? 'Run already closed (immutable)' : (e.message || 'Close failed'), 'error');
    }
}

function payrollCsv(run) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Staff', 'PayType', 'HoursWorked', 'BasePay', 'TipShare', 'UnpaidLeaveDeduction', 'NetPay'].join(',');
    const rows = Object.values(run.lines || {}).map(l =>
        [esc(staffName(l.userId)), l.payType, l.hoursWorked, l.basePay, l.tipShare, l.unpaidLeaveDeduction, l.netPay].join(','));
    return [head, ...rows].join('\n');
}

function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function exportPayrollCsv() {
    if (!_payPreview) return;
    downloadCsv(`payroll-${_payPreview.periodStart}_${_payPreview.periodEnd}.csv`, payrollCsv(_payPreview));
}

function renderPayrollRuns(runs) {
    const list = document.getElementById('payRunsList');
    const entries = Object.entries(runs).sort((a, b) => String(b[1].closedAt || '').localeCompare(String(a[1].closedAt || '')));
    if (!entries.length) { list.innerHTML = 'No closed runs yet.'; return; }
    list.innerHTML = entries.map(([id, r]) => {
        const lines = Object.values(r.lines || {});
        const totalNet = lines.reduce((s, l) => s + (l.netPay || 0), 0);
        return `<div class="glass-card p-12 mb-8" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <div><strong>${escapeHtml(r.periodStart)} → ${escapeHtml(r.periodEnd)}</strong>
            <span class="text-muted-small">· ${lines.length} staff · tips ${fmtRs(r.tipPool || 0)} · closed ${r.closedAt ? new Date(r.closedAt).toLocaleDateString('en-IN') : '—'}</span><br>
            <strong>Total net: ${fmtRs(totalNet)}</strong></div>
            <button class="btn-secondary" data-run-csv="${escapeHtml(id)}"><i data-lucide="download" class="icon-14"></i> CSV</button>
        </div>`;
    }).join('');
    refreshIcons(list);
    list.querySelectorAll('[data-run-csv]').forEach(b => {
        b.onclick = () => {
            const r = runs[b.dataset.runCsv];
            downloadCsv(`payroll-${r.periodStart}_${r.periodEnd}.csv`, payrollCsv(r));
        };
    });
}