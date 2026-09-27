import { state } from '../state.js';
import { BUSINESS_ID, db, Outlet, ref, get, update, query, orderByChild, equalTo } from '../firebase.js';
import { logAudit, showToast, showConfirm, hashPin, showPinModal, capitalize, formatRelativeTime, switchToStaffManagementTab, showPinPrompt, logStaffChange } from '../utils.js';
import { loadLucide } from '../ui.js';

const refreshIcons = (root) => loadLucide().then(() => window.lucide?.createIcons({ root }));

// --- SEVERITY ORDER ---
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// --- MAIN EXPORT ---

export async function runSecurityAudit() {
    console.log('[SecurityAudit] Running security posture checks...');
    const findings = [];
    
    try {
        // 1. Staff with no Counter PIN
        await checkMissingCounterPin(findings);
        
        // 2. No approval PIN configured (managerPinHash)
        await checkMissingApprovalPin(findings);
        
        // 3. Staff with ceiling = 0 (inherit) but role allows discounts
        await checkZeroCeilingOnDiscountRoles(findings);
        
        // 4. Inactive staff still active (lastSignedIn > 90 days)
        await checkStaleActiveStaff(findings);
        
        // 5. Multiple owners for same outlet
        await checkMultipleOwners(findings);
        
        // 6. Discount Approval feature ON but no ceiling set
        await checkFeatureOnNoCeiling(findings);
        
        // 7. Staff with Counter PIN but no discount ceiling set
        await checkPinNoCeiling(findings);
        
    } catch (e) {
        console.error('[SecurityAudit] Check failed:', e);
        findings.push({
            id: 'audit-error',
            severity: 'high',
            title: 'Security audit encountered an error',
            detail: 'Some checks could not complete. Check console for details.',
            fix: null
        });
    }
    
    // Sort by severity
    findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    
    return findings;
}

export function renderSecurityAudit(findings, containerId = 'auditFindingsList') {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (findings.length === 0) {
        container.innerHTML = `
            <div class="audit-empty-state">
                <i data-lucide="shield-check" class="icon-48 text-success"></i>
                <h4>All checks passed</h4>
                <p class="text-muted">No security issues detected at this time.</p>
            </div>
        `;
        refreshIcons(container);
        updateSummaryCounts(findings);
        return;
    }
    
    container.innerHTML = findings.map(f => `
        <div class="audit-finding ${f.severity}" data-id="${f.id}">
            <div class="audit-finding-header">
                <span class="audit-severity-badge ${f.severity}">${f.severity.toUpperCase()}</span>
                <h5 class="audit-finding-title">${f.title}</h5>
            </div>
            <p class="audit-finding-detail">${f.detail}</p>
            ${f.fix ? `
                <div class="audit-finding-actions">
                    <button class="btn-primary btn-small audit-fix-btn" data-fix="${f.fix}" data-target="${f.fixTarget || ''}">
                        <i data-lucide="${f.fixIcon || 'wrench'}" class="icon-12"></i> ${f.fixLabel || 'Fix'}
                    </button>
                </div>
            ` : ''}
        </div>
    `).join('');
    
    refreshIcons(container);
    updateSummaryCounts(findings);
    attachFixListeners();
}

function updateSummaryCounts(findings) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(f => counts[f.severity]++);
    const elCritical = document.getElementById('auditCritical');
    const elHigh = document.getElementById('auditHigh');
    const elMedium = document.getElementById('auditMedium');
    const elLow = document.getElementById('auditLow');
    if (elCritical) elCritical.textContent = counts.critical;
    if (elHigh) elHigh.textContent = counts.high;
    if (elMedium) elMedium.textContent = counts.medium;
    if (elLow) elLow.textContent = counts.low;
}

function attachFixListeners() {
    document.querySelectorAll('.audit-fix-btn').forEach(btn => {
        btn.onclick = async () => {
            const fix = btn.dataset.fix;
            const target = btn.dataset.target;
            await runFix(fix, target, btn);
        };
    });
}

async function runFix(fix, target, btn) {
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="icon-14 spin-icon"></i> Fixing...';
    await refreshIcons(btn);
    
    try {
        switch (fix) {
            case 'setCounterPin':
                await fixSetCounterPin(target);
                break;
            case 'setApprovalPin':
                await fixSetApprovalPin();
                break;
            case 'setCeiling':
                await fixSetCeiling(target);
                break;
            case 'disableStaff':
                await fixDisableStaff(target);
                break;
            case 'demoteExtraOwner':
                await fixDemoteExtraOwner(target);
                break;
            case 'setOutletCeiling':
                await fixSetOutletCeiling();
                break;
            case 'openStaffManagement':
                switchToStaffManagementTab();
                break;
            default:
                throw new Error(`Unknown fix: ${fix}`);
        }
        showToast('Fixed successfully', 'success');
        // Re-run audit after a brief delay
        setTimeout(async () => {
            const findings = await runSecurityAudit();
            renderSecurityAudit(findings);
        }, 500);
    } catch (e) {
        console.error('[SecurityAudit] Fix failed:', e);
        showToast(e.message || 'Fix failed', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        await refreshIcons(btn);
    }
}

// --- INDIVIDUAL CHECKS ---

async function checkMissingCounterPin(findings) {
    const snap = await get(Outlet.ref('staff'));
    if (!snap.exists()) return;
    
    snap.forEach(child => {
        const s = child.val();
        if (s.isActive !== false && !s.counterPinHash) {
            findings.push({
                id: `no-counter-pin-${child.key}`,
                severity: 'medium',
                title: 'Staff missing Counter PIN',
                detail: `${s.displayName} (${capitalize(s.role)}) cannot identify at the till. Their discounts and voids will be attributed to whoever signed in this morning.`,
                fix: 'setCounterPin',
                fixTarget: child.key,
                fixLabel: 'Set PIN',
                fixIcon: 'key'
            });
        }
    });
}

async function checkMissingApprovalPin(findings) {
    const secSnap = await get(Outlet.ref('settings/Security'));
    const sec = secSnap.val() || {};
    if (!sec.managerPinHash && !sec.pinHash) {
        findings.push({
            id: 'no-approval-pin',
            severity: 'critical',
            title: 'No approval PIN configured',
            detail: 'Discount ceiling overrides cannot be approved. Set Manager PIN in Staff Management.',
            fix: 'setApprovalPin',
            fixLabel: 'Set Approval PIN',
            fixIcon: 'lock'
        });
    }
}

async function checkZeroCeilingOnDiscountRoles(findings) {
    const snap = await get(Outlet.ref('staff'));
    if (!snap.exists()) return;
    
    // Check outlet default ceiling
    const outletCeilingSnap = await get(Outlet.ref('settings/Security/discountCeilingPct'));
    const outletCeiling = outletCeilingSnap.exists() ? Number(outletCeilingSnap.val()) || 0 : 0;
    
    snap.forEach(child => {
        const s = child.val();
        if (s.isActive !== false && (s.discountCeilingPct === 0 || s.discountCeilingPct === undefined)) {
            // Only flag if role can apply manual discounts (cashier, manager)
            if (['cashier', 'manager'].includes(s.role)) {
                // If outlet ceiling is also 0, this means unlimited discounts - HIGH severity
                const severity = outletCeiling === 0 ? 'high' : 'medium';
                findings.push({
                    id: `zero-ceiling-${child.key}`,
                    severity,
                    title: outletCeiling === 0 ? 'Staff has UNLIMITED discounts (outlet ceiling also 0%)' : 'Staff inherits outlet ceiling (0%)',
                    detail: `${s.displayName} (${capitalize(s.role)}) has no personal discount ceiling. ${outletCeiling === 0 ? 'Outlet ceiling is also 0% — this means UNLIMITED manual discounts!' : 'They inherit the outlet default. Consider setting a personal limit.'}`,
                    fix: 'setCeiling',
                    fixTarget: child.key,
                    fixLabel: 'Set Ceiling',
                    fixIcon: 'percent'
                });
            }
        }
    });
}

async function checkStaleActiveStaff(findings) {
    const snap = await get(Outlet.ref('staff'));
    if (!snap.exists()) return;
    
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    
    snap.forEach(child => {
        const s = child.val();
        if (s.isActive !== false && s.lastSignedIn) {
            const lastSigned = new Date(s.lastSignedIn).getTime();
            if (lastSigned < ninetyDaysAgo) {
                findings.push({
                    id: `stale-staff-${child.key}`,
                    severity: 'low',
                    title: 'Staff inactive for 90+ days',
                    detail: `${s.displayName} (${capitalize(s.role)}) last signed in ${formatRelativeTime(s.lastSignedIn)}. Consider disabling the account.`,
                    fix: 'disableStaff',
                    fixTarget: child.key,
                    fixLabel: 'Disable',
                    fixIcon: 'user-x'
                });
            }
        }
    });
}

async function checkMultipleOwners(findings) {
    const snap = await get(Outlet.ref('staff'));
    if (!snap.exists()) return;
    
    let ownerCount = 0;
    let ownerUids = [];
    snap.forEach(child => {
        const s = child.val();
        if (s.isActive !== false && s.role === 'owner') {
            ownerCount++;
            ownerUids.push(child.key);
        }
    });
    
    if (ownerCount > 1) {
        findings.push({
            id: 'multiple-owners',
            severity: 'high',
            title: 'Multiple active owners',
            detail: `${ownerCount} staff members have the Owner role. Only one should be Owner; others should be Manager.`,
            fix: 'demoteExtraOwner',
            fixTarget: ownerUids.slice(1).join(','), // all except first
            fixLabel: 'Demote Extras',
            fixIcon: 'user-minus'
        });
    }
}

async function checkFeatureOnNoCeiling(findings) {
    if (state.features?.discountApproval) {
        const secSnap = await get(Outlet.ref('settings/Security'));
        const sec = secSnap.val() || {};
        const hasAnyCeiling = sec.discountCeilingPct > 0 || sec.managerPinHash;
        
        if (!hasAnyCeiling) {
            findings.push({
                id: 'feature-on-no-ceiling',
                severity: 'high',
                title: 'Discount Approval enabled but no ceiling set',
                detail: 'The feature is ON but no approval ceiling or PIN is configured. It will never trigger.',
                fix: 'setOutletCeiling',
                fixLabel: 'Configure Ceiling',
                fixIcon: 'sliders-horizontal'
            });
        }
    }
}

async function checkPinNoCeiling(findings) {
    const snap = await get(Outlet.ref('staff'));
    if (!snap.exists()) return;
    
    snap.forEach(child => {
        const s = child.val();
        // Only flag cashiers and managers who can apply manual discounts
        // Waiters inherit outlet ceiling and don't apply manual discounts
        const discountRoles = ['cashier', 'manager'];
        if (s.isActive !== false && discountRoles.includes(s.role) && s.counterPinHash && (!s.discountCeilingPct || s.discountCeilingPct === 0)) {
            // Has PIN but no personal ceiling - minor hygiene issue
            findings.push({
                id: `pin-no-ceiling-${child.key}`,
                severity: 'low',
                title: 'Staff has Counter PIN but no discount ceiling',
                detail: `${s.displayName} (${capitalize(s.role)}) can sign in at the till but has no personal discount limit. They inherit the outlet ceiling.`,
                fix: 'setCeiling',
                fixTarget: child.key,
                fixLabel: 'Set Ceiling',
                fixIcon: 'percent'
            });
        }
    });
}

// --- FIX ACTIONS ---

async function fixSetCounterPin(uid) {
    // Generate temp PIN and update
    const tempPin = String(Math.floor(1000 + Math.random() * 9000));
    const hash = await hashPin(tempPin);
    if (!hash) return showToast('PIN hashing unavailable — app must run over HTTPS.', 'error');
    
    // Update staff record and maintain reverse index
    const updates = {};
    updates[`staff/${uid}/counterPinHash`] = hash;
    updates[`counterPinIndex/${hash}`] = uid;
    await update(ref(db, `businesses/${BUSINESS_ID()}/outlets/${Outlet.current}`), updates);
    
    await logStaffChange('pin_reset', uid, null, { counterPinHash: hash }, 'Counter PIN set via Security Audit');
    
    // Show PIN to user
    await showPinModal(`Counter PIN for ${(await get(Outlet.staff(uid))).val()?.displayName}:`, tempPin);
}

async function fixSetApprovalPin() {
    // Open Staff Management tab and scroll to Manager PIN field
    switchToStaffManagementTab();
    setTimeout(() => {
        const pinField = document.getElementById('settingManagerPin');
        if (pinField) pinField.focus();
    }, 300);
    showToast('Please set the Manager PIN in the Staff Management tab (field focused above)', 'info', 8000);
}

async function fixSetCeiling(uid) {
    const staffSnap = await get(Outlet.staff(uid));
    const staff = staffSnap.val();
    const currentCeiling = staff?.discountCeilingPct || 0;
    
    const newCeiling = await showCeilingPrompt(
        `Set discount ceiling for ${staff.displayName} (${capitalize(staff.role)})`,
        currentCeiling
    );
    
    if (newCeiling === null) return; // cancelled
    
    const ceiling = Math.max(0, Math.min(100, parseInt(newCeiling) || 0));
    await update(Outlet.staff(uid), { discountCeilingPct: ceiling });
    
    // Also write to staffCeilings if > 0
    if (ceiling > 0) {
        await update(Outlet.ref(`settings/Security/staffCeilings/${uid}`), {
            ceilingPct: ceiling,
            updatedAt: new Date().toISOString(),
            updatedBy: state.adminData?.uid
        });
    } else {
        await update(Outlet.ref(`settings/Security/staffCeilings/${uid}`), null);
    }
    
    await logStaffChange('ceiling_update', uid, { discountCeilingPct: currentCeiling }, { discountCeilingPct: ceiling }, `Ceiling set via Security Audit`);
}

async function fixDisableStaff(uid) {
    if (!await showConfirm('Disable Account?', 'This staff member will not be able to sign in.')) return;
    
    await update(Outlet.staff(uid), { isActive: false });
    await logStaffChange('staff_disable', uid, { isActive: true }, { isActive: false }, 'Disabled via Security Audit');
}

async function fixDemoteExtraOwner(uids) {
    const uidList = uids.split(',').filter(Boolean);
    if (uidList.length === 0) return;
    
    // Fetch details for each owner to show in confirmation
    const { Outlet, get } = await import('../firebase.js');
    const ownerDetails = [];
    for (const uid of uidList) {
        const snap = await get(Outlet.staff(uid));
        if (snap.exists()) {
            const s = snap.val();
            ownerDetails.push({ uid, name: s.displayName || 'Unknown', email: s.email || 'No email' });
        } else {
            ownerDetails.push({ uid, name: 'Unknown', email: 'Unknown' });
        }
    }
    
    // Show detailed confirmation dialog
    const names = ownerDetails.map(o => `${o.name} (${o.email})`).join('\n• ');
    const confirmed = await showConfirm(
        `Demote the following ${ownerDetails.length} owner(s) to Manager role?\n\n• ${names}\n\nThis action cannot be undone.`,
        'Confirm Owner Demotion'
    );
    
    if (!confirmed) return;
    
    for (const uid of uidList) {
        await update(Outlet.staff(uid), { role: 'manager' });
        await logStaffChange('role_change', uid, { role: 'owner' }, { role: 'manager' }, 'Demoted via Security Audit');
    }
    
    showToast(`${ownerDetails.length} owner(s) demoted to Manager`, 'success');
}

async function fixSetOutletCeiling() {
    switchToStaffManagementTab();
    setTimeout(() => {
        const ceilingField = document.getElementById('settingDiscCeilingPct');
        if (ceilingField) ceilingField.focus();
    }, 300);
    showToast('Please set the outlet discount ceiling in the Staff Management tab (field focused above)', 'info', 8000);
}

function showCeilingPrompt(message, currentValue) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';
        overlay.innerHTML = `
            <div class="dynamic-modal-box">
                <h3 class="dynamic-modal-title">Set Discount Ceiling</h3>
                <p class="dynamic-modal-text">${message}</p>
                <input type="number" class="dynamic-modal-input" min="0" max="100" step="1" value="${currentValue || 0}" placeholder="0 = inherit outlet">
                <div class="dynamic-modal-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-confirm">Save</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('.dynamic-modal-input');
        const confirmBtn = overlay.querySelector('.btn-confirm');
        input.focus();
        input.select();
        
        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); resolve(val); }, 200);
        };
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        });
        confirmBtn.onclick = () => cleanup(input.value);
        overlay.querySelector('.btn-cancel').onclick = () => cleanup(null);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    });
}

// --- CLEANUP ---
export function cleanupSecurityAudit() {
    // Any cleanup needed when leaving the tab
}

export async function initSecurityAuditTab() {
    const btn = document.getElementById('btnReRunAudit');
    if (btn) {
        btn.onclick = async () => {
            const findings = await runSecurityAudit();
            renderSecurityAudit(findings);
        };
    }
    
    // Auto-run on first load
    const findings = await runSecurityAudit();
    renderSecurityAudit(findings);
}