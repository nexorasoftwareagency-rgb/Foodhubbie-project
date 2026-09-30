import { auth, db, Outlet, EmailAuthProvider, ref, get, onValue, onAuthStateChanged, signInWithEmailAndPassword, signOut, reauthenticateWithCredential, serverTimestamp, set, push, BUSINESS_BY_OUTLET } from './firebase.js';
import { state } from './state.js';
import { showToast, logAudit } from './utils.js';
import * as ui from './ui.js';
import { initRealtimeListeners } from './features/orders.js';
import { loadRiders } from './features/riders.js';
import { updateBranding } from './branding.js';
import { setupAdminFCM } from './fcm-init.js';
import { setupCapacitorFCM } from './capacitor-fcm.js';

const ADMIN_CONFIG = {
    SUPREME_ADMIN_EMAIL: "nexorasoftware@gmail.com",
    SUPER_ADMIN_EMAIL: "roshanisudha@gmail.com"
};

let _disabledUnsub = null;

function cleanupSession() {
    if (_disabledUnsub) { _disabledUnsub(); _disabledUnsub = null; }
}


export function initAuth() {
    console.log("[Auth] Initializing State Listener...");

    // Setup login form listener
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const emailEl = document.getElementById("loginEmail");
            const passEl = document.getElementById("loginPassword");
            if (emailEl && passEl) {
                doLogin(emailEl.value.trim(), passEl.value);
            } else {
                console.warn("[Auth] Login form fields missing!");
            }
        };
    }

    // Forgot password handler
    const forgotBtn = document.getElementById("forgotPasswordBtn");
    if (forgotBtn) {
        forgotBtn.onclick = async () => {
            const email = prompt("Enter your registered email to reset password:");
            if (!email || !email.includes("@")) {
                showToast("Please enter a valid email address.", "warning");
                return;
            }
            try {
                forgotBtn.disabled = true;
                forgotBtn.innerHTML = '<span>Sending...</span> <div class="btn-stitch-v4"></div>';
                await sendPasswordResetEmail(auth, email.trim());
                showToast("Password reset email sent! Check your inbox.", "success");
            } catch (e) {
                console.error("[Auth] Password reset failed:", e);
                const friendly = {
                    'auth/user-not-found': 'No account found with this email',
                    'auth/invalid-email': 'Invalid email address',
                    'auth/too-many-requests': 'Too many requests. Please try again later.'
                }[e.code] || 'Failed to send reset email. Please try again.';
                showToast(friendly, "error");
            } finally {
                forgotBtn.disabled = false;
                forgotBtn.innerHTML = '<i data-lucide="key" class="icon-14"></i> <span>Forgot Password?</span>';
            }
        };
    }

    // Add diagnostic button to login form (Gated for non-production/debug only)
    const isDebuggable = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || localStorage.getItem('DEBUG_MODE') === 'true';
    const loginCard = document.querySelector('.login-card-v4');
    if (loginCard && isDebuggable && !document.getElementById('diagnosticBtn')) {
        const diagBtn = document.createElement('button');
        diagBtn.id = 'diagnosticBtn';
        diagBtn.type = 'button';
        diagBtn.innerText = '🔍 Run Diagnostics';
        diagBtn.style.cssText = 'margin-top: 20px; background: rgba(15,23,42,0.04); color: #64748b; border: 1px solid rgba(15,23,42,0.12); padding: 10px 20px; border-radius: 12px; cursor: pointer; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; transition: all 0.3s;';
        diagBtn.onmouseover = () => diagBtn.style.background = 'rgba(15,23,42,0.08)';
        diagBtn.onmouseout = () => diagBtn.style.background = 'rgba(15,23,42,0.04)';
        diagBtn.onclick = () => {
            if (window.diagnoseDatabase) {
                window.diagnoseDatabase();
            } else {
                console.log("Diagnostic function not loaded yet");
            }
        };
        loginCard.appendChild(diagBtn);
    }

    onAuthStateChanged(auth, async (user) => {
        console.log("[Auth] State change detected:", user ? `Logged in as ${user.email}` : "Logged out");
        if (!user) {
            state.adminData = null;
            const overlay = document.getElementById("authOverlay");
            const layout = document.querySelector(".layout");
            const loginBtn = document.getElementById("loginBtn");
            
            if (overlay) overlay.classList.remove('hidden');
            if (layout) layout.classList.add('hidden');
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<span>Access Dashboard</span> <div class="btn-stitch-v4"></div>';
                loginBtn.classList.remove('loading');
            }
            sessionStorage.removeItem('adminIsLoggedIn');
            window.hideLoader?.();
            return;
        }

        console.log("[Auth] State Change:", user.email, "Verified:", user.emailVerified);
        
        let adminData = null;
        let adminNodeExists = false;
        try {
            // Ensure global paths are used for system-wide nodes
            const adminSnap = await Promise.race([
                get(ref(db, `admins/${user.uid}`)),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000))
            ]);
            if (adminSnap.exists()) {
                adminNodeExists = true;
                const rawVal = adminSnap.val();
                const sanitized = { id: rawVal.id || user.uid, email: rawVal.email, role: rawVal.role, outlet: rawVal.outlet };
                console.log("[Auth] Admin snapshot (sanitized):", sanitized);
            }
            
            adminData = adminSnap.val();
            
            // --- Tiered Access Logic Injection ---
            const email = user.email.toLowerCase();

            if (email === ADMIN_CONFIG.SUPREME_ADMIN_EMAIL) {
                console.log("[Auth] Supreme Admin Detected");
                if (!adminData) adminData = { name: "Supreme Admin", email: ADMIN_CONFIG.SUPREME_ADMIN_EMAIL };
                adminData.isSuper = true;
                adminData.isSupreme = true;
                adminData.role = "Supreme Admin";
                // Supreme admin can access any outlet, default to pizza if none set
                if (!adminData.outlet) adminData.outlet = "pizza"; 
            } else if (email === ADMIN_CONFIG.SUPER_ADMIN_EMAIL) {
                console.log("[Auth] Super Admin Detected");
                if (!adminData) adminData = { name: "Super Admin", email: ADMIN_CONFIG.SUPER_ADMIN_EMAIL };
                adminData.isSuper = true;
                adminData.role = "Super Admin";
                // Super admin can access pizza and cake
            } else if (adminData) {
                // Regular Admin: Enforce outlet isolation
                adminData.isSuper = false;
                adminData.isSupreme = false;
                
                // Fix: If admin node exists but has no role, bootstrap from staff records
                if (!adminData.role) {
                    console.log("[Auth] Admin node missing role, attempting staff bootstrap...");
                    for (const [oid, bid] of Object.entries(BUSINESS_BY_OUTLET)) {
                        try {
                            const staffSnap = await get(ref(db, `businesses/${bid}/outlets/${oid}/staff/${user.uid}`));
                            const rec = staffSnap.val();
                            if (staffSnap.exists() && rec.role) {
                                adminData.role = rec.role;
                                adminData.outlet = oid;
                                adminData.name = rec.displayName || user.email;
                                console.log("[Auth] Bootstrapped missing role from staff:", adminData.role, "outlet:", oid);
                                
                                // Write role back to admin node so fcmToken and future writes work
                                await update(ref(db, `admins/${user.uid}`), { email: user.email, role: rec.role, outlet: oid })
                                    .catch(e => console.warn("[Auth] Failed to write bootstrapped role:", e));
                                break;
                            }
                        } catch (probeErr) {
                            console.warn("[Auth] Staff probe failed for outlet:", oid, probeErr?.message || probeErr);
                        }
                    }
                }
            }

            if (!adminData) {
                // Staff without an admins/{uid} node (accounts created before
                // login provisioning): find their outlet staff record and
                // bootstrap adminData — the node is created further down.
                for (const [oid, bid] of Object.entries(BUSINESS_BY_OUTLET)) {
                    try {
                        const staffSnap = await get(ref(db, `businesses/${bid}/outlets/${oid}/staff/${user.uid}`));
                        const rec = staffSnap.val();
                        if (staffSnap.exists() && rec.role) {
                            adminData = {
                                email: user.email,
                                outlet: oid,
                                name: rec.displayName || user.email,
                                role: rec.role,
                                uid: user.uid,
                                isSuper: false,
                                isSupreme: false
                            };
                            console.log("[Auth] Bootstrapped staff profile from outlet", oid, "role:", rec.role);
                            break;
                        }
                    } catch (probeErr) {
                        console.warn("[Auth] Staff probe failed for outlet:", oid, probeErr?.message || probeErr);
                    }
                }
            }

            if (!adminData) {
                console.error("[Auth] Access Denied: No profile found for UID", user.uid);
                throw new Error("ACCESS_DENIED");
            }
            console.log("[Auth] Profile loaded successfully:", adminData.name, "(Outlet:", adminData.outlet, ")");
        } catch (e) {
            console.error("[Auth] Admin Profile Fetch Error:", e);
            // Check custom claims for emergency super admin access
            try {
                const token = await user.getIdTokenResult(true);
                if (token.claims.admin) {
                    console.log("[Auth] Emergency Super Admin Access Granted via Claims");
                    adminData = { email: user.email, isSuper: true, name: "Super Admin", outlet: "pizza" };
                }
            } catch (claimsErr) {
                console.error("[Auth] Claims Check Failed:", claimsErr);
            }
        }

        if (!adminData) {
            console.error("[Auth] No admin data found after profile fetch and claims check.");
            showAccessDenied('ACCESS DENIED', 'No administrative profile found for this account.');
            setTimeout(() => signOut(auth), 3000);
            return;
        }

        // --- Disabled-outlet gate ---
        // Staff (non-super/non-supreme) of a disabled outlet are denied
        // login. Super/Supreme admins stay allowed so they can reactivate.
        if (!adminData.isSuper && !adminData.isSupreme && adminData.outlet) {
            const oid = String(adminData.outlet).toLowerCase();
            const bid = adminData.businessId || BUSINESS_BY_OUTLET[oid];
            if (!bid) {
                console.error("[Auth] Access Denied: Unknown outlet mapping for", oid);
                showAccessDenied('ACCESS DENIED', 'Invalid outlet configuration. Please contact support.');
                setTimeout(() => signOut(auth), 3000);
                return;
            }
            try {
                const disabledSnap = await Promise.race([
                    get(ref(db, `businesses/${bid}/outlets/${oid}/disabled`)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000))
                ]);
                if (disabledSnap.exists() && disabledSnap.val() === true) {
                    console.warn("[Auth] Access Denied: restaurant disabled", user.email);
                    showAccessDenied('ACCESS DENIED', 'This restaurant is currently disabled. Please contact the platform owner to reactivate it.');
                    setTimeout(() => signOut(auth), 3000);
                    return;
                }
            } catch (e) {
                console.warn("[Auth] Disabled check failed, denying login:", e?.message || e);
                showAccessDenied('ACCESS DENIED', 'Unable to verify outlet status. Please try again or contact support.');
                setTimeout(() => signOut(auth), 3000);
                return;
            }
        }

        // --- Locked-outlet gate ---
        // Locked outlets allow login but block all mutating actions.
        // The admin sees a locked screen until Supreme Admin unlocks.
        if (!adminData.isSuper && !adminData.isSupreme && adminData.outlet) {
            const oid = String(adminData.outlet).toLowerCase();
            const bid = adminData.businessId || BUSINESS_BY_OUTLET[oid];
            if (bid) {
                try {
                    const lockedSnap = await Promise.race([
                        get(ref(db, `businesses/${bid}/outlets/${oid}/locked`)),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000))
                    ]);
                    if (lockedSnap.exists() && lockedSnap.val() === true) {
                        state.locked = true;
                        import('./ui.js').then(u => u.showLockedScreen());
                    }
                } catch (e) {
                    console.warn("[Auth] Locked check failed:", e?.message || e);
                }
            }
        }

        // --- Realtime disabled listener ---
        // If the outlet gets disabled while admin is logged in, force sign-out immediately
        let _disabledUnsub = null;
        
        // Keep reference to prevent esbuild dead-code elimination
        // Using a simple function reference that esbuild can't prove is unused
        const _keepDisabledUnsubRef = () => _disabledUnsub;
        if (typeof window !== 'undefined') {
            // Use a unique property name to avoid conflicts
            window.__disabledUnsubRef = _keepDisabledUnsubRef;
        }
        
        if (!adminData.isSuper && !adminData.isSupreme && adminData.outlet) {
            const oid = String(adminData.outlet).toLowerCase();
            const bid = adminData.businessId || BUSINESS_BY_OUTLET[oid];
            if (bid) {
                _disabledUnsub = onValue(ref(db, `businesses/${bid}/outlets/${oid}/disabled`), (snap) => {
                    if (snap.exists() && snap.val() === true) {
                        console.warn("[Auth] Outlet disabled in realtime, signing out:", user.email);
                        showAccessDenied('ACCESS DENIED', 'This restaurant has been disabled. You have been signed out.');
                        signOut(auth);
                    }
                });
            }
        }

        // --- Realtime locked listener ---
        // If the outlet gets unlocked while admin is logged in, clear the lock
        let _lockedUnsub = null;
        if (typeof window !== 'undefined') {
            window.__lockedUnsubRef = () => _lockedUnsub;
        }
        if (!adminData.isSuper && !adminData.isSupreme && adminData.outlet) {
            const oid = String(adminData.outlet).toLowerCase();
            const bid = adminData.businessId || BUSINESS_BY_OUTLET[oid];
            if (bid) {
                _lockedUnsub = onValue(ref(db, `businesses/${bid}/outlets/${oid}/locked`), (snap) => {
                    if (snap.exists() && snap.val() === true) {
                        state.locked = true;
                    } else {
                        state.locked = false;
                        // If the locked screen is showing, reload to clear it
                        const lockedEl = document.getElementById('locked-screen');
                        if (lockedEl) window.location.reload();
                    }
                });
            }
        }

        // ponytail: clear seamless-mode on logout so login screen shows
    document.documentElement.classList.remove('seamless-mode');

        // Initialize Session
        // uid must survive onto state.adminData — staff creation (createdBy),
        // logStaffChange (actorUid) and self-guards all read it.
        adminData.uid = adminData.uid || user.uid;
        state.adminData = adminData;
        if (adminData.businessId) window.currentBusinessId = adminData.businessId;
        sessionStorage.setItem('adminIsLoggedIn', 'true');
        logAudit('LOGIN_SUCCESS', { email: user.email });
        if (sessionStorage.getItem('PENDING_LOGIN_AUDIT') === 'true') {
            logAudit('LOGIN_ATTEMPT_SUCCESS', { email: user.email });
            sessionStorage.removeItem('PENDING_LOGIN_AUDIT');
        }
        const savedOutlet = sessionStorage.getItem('adminSelectedOutlet') || adminData.outlet || 'pizza';
        window.currentOutlet = savedOutlet.toLowerCase();
        state.currentOutlet = window.currentOutlet;

        // Handle Multi-Outlet Logic (Supreme/Super Admin)
        if (adminData.isSuper || adminData.isSupreme) {
            const switcher = document.getElementById('outletSwitcher');
            const switcherMobile = document.getElementById('outletSwitcherMobile');
            
            // Build options dynamically from available outlets
            let outletOptionsHtml = '';
            const outlets = Object.keys(BUSINESS_BY_OUTLET);
            outlets.forEach(oid => {
                outletOptionsHtml += `<option value="${oid}">🏪 ${oid.charAt(0).toUpperCase() + oid.slice(1)} ERP</option>`;
            });
            if (!outletOptionsHtml) {
                outletOptionsHtml = `<option value="pizza">🏪 Pizza ERP</option>`;
            }
            
            // Future-proofing for Supreme Admin
            if (adminData.isSupreme) {
                // For now only pizza and cake exist, but Supreme Admin is flagged for future expansion
                console.log("[Auth] Supreme Admin: All future outlets enabled.");
            }

            if (switcher) {
                switcher.classList.remove('hidden');
                switcher.innerHTML = outletOptionsHtml;
                switcher.value = window.currentOutlet;
            }
            if (switcherMobile) {
                switcherMobile.classList.remove('hidden');
                switcherMobile.innerHTML = outletOptionsHtml;
                switcherMobile.value = window.currentOutlet;
            }
        } else {
            // Ensure switcher is hidden for regular admins
            const switcher = document.getElementById('outletSwitcher');
            const switcherMobile = document.getElementById('outletSwitcherMobile');
            if (switcher) switcher.classList.add('hidden');
            if (switcherMobile) switcherMobile.classList.add('hidden');
            
            // Force assigned outlet if they try to bypass via sessionStorage
            if (adminData.outlet && window.currentOutlet !== adminData.outlet) {
                console.warn("[Auth] Unauthorized outlet access attempt. Resetting to:", adminData.outlet);
                window.currentOutlet = adminData.outlet;
                state.currentOutlet = adminData.outlet;
                sessionStorage.setItem('adminSelectedOutlet', adminData.outlet);
            }
        }


        // Show UI
        const authOverlay = document.getElementById("authOverlay");
        const layout = document.querySelector(".layout");
        if (authOverlay) authOverlay.classList.add('hidden');
        if (layout) {
            layout.classList.remove('hidden');
            layout.classList.add('flex');
        }

        const emailDisplay = document.getElementById("userEmailDisplay");
        if (emailDisplay) emailDisplay.innerText = user.email;

        // Ensure admin node exists with required fields (email, outlet) for FCM token storage
        if (!adminNodeExists && adminData) {
            const adminNode = {
                email: user.email,
                outlet: adminData.outlet || 'pizza',
                name: adminData.name || adminData.email || user.email,
                role: adminData.role || 'Admin',
                fcmToken: ''
            };
            if (adminData.isSuper) adminNode.isSuper = true;
            if (adminData.isSupreme) adminNode.isSupreme = true;
            set(ref(db, `admins/${user.uid}`), adminNode).catch(e => console.warn('[Auth] Failed to create admin node:', e));
        }

        // Load per-outlet gates at boot — feature flags (gated nav, discount
        // PIN) and the role→tab matrix. Re-run on outlet switch so neither
        // goes stale when a super admin changes outlet.
        const loadOutletGates = async () => {
            try {
                const [featSnap, rolesSnap] = await Promise.all([
                    get(Outlet.ref('settings/features')),
                    get(Outlet.ref('settings/roles'))
                ]);
                const f = featSnap.val() || {};
                state.features.discountApproval = f.discountApproval === true;
                state.features.expense = f.expense === true;
                state.roles = rolesSnap.val() || null;
            } catch (e) {
                console.warn('[Auth] Feature/role gates load failed:', e);
            }
        };
        await loadOutletGates();

        // Start Features
        updateBranding();
        loadRiders();
        initRealtimeListeners();
        setupCapacitorFCM(user.uid);
        setupAdminFCM(user.uid);
        if (!document._switchOutletListenerBound) {
            document.addEventListener('switchOutlet', () => {
                loadOutletGates(); // feature flags + role matrix follow the new outlet
            });
            document._switchOutletListenerBound = true;
        }

        // Initial Tab Navigation (Respect Hash or Default to Dashboard)
        const initialTab = window.location.hash.replace('#', '') || 'dashboard';
        ui.switchTab(initialTab, true);
        window.hideLoader?.();
    });
}

/**
 * Shows the ACCESS DENIED overlay used for unauthorized accounts and
 * disabled-outlet logins. Sign-out happens separately in the caller.
 */
function showAccessDenied(title, message) {
    showToast("ACCESS DENIED", "error");
    const overlay = document.getElementById("authOverlay");
    if (!overlay) return;
    overlay.innerHTML = ''; // Clear previous content
    const modal = document.createElement('div');
    modal.className = 'auth-modal';

    const titleEl = document.createElement('h2');
    titleEl.className = 'text-danger';
    titleEl.textContent = title;

    const msg = document.createElement('p');
    msg.textContent = message;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-primary mt-20';
    retryBtn.textContent = 'Try Another Account';
    retryBtn.addEventListener('click', () => location.reload());

    modal.append(titleEl, msg, retryBtn);
    overlay.appendChild(modal);
}

export async function reauthenticateAdmin(password) {
    const user = auth.currentUser;
    if (!user) throw new Error("No user logged in.");
    const credential = EmailAuthProvider.credential(user.email, password);
    return reauthenticateWithCredential(user, credential);
}

export function requireAdminReauth(onSuccess) {
    const modal = document.getElementById('reauthModal');
    const passInput = document.getElementById('reauthPassword');
    const confirmBtn = document.getElementById('btnConfirmReauth');

    if (!modal || !passInput || !confirmBtn) {
        console.error("[Auth] Critical: Reauth components missing. Aborting operation for security.");
        showToast("Security Error: Reauthentication system unavailable", "error");
        return;
    }

    modal.classList.remove('hidden');
    modal.classList.add('active');
    passInput.value = "";
    passInput.focus();

    const form = document.getElementById('reauthForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const pass = passInput.value;
        if (!pass) return showToast("Enter password", "warning");
        try {
            confirmBtn.disabled = true;
            confirmBtn.innerText = "Verifying...";
            await reauthenticateAdmin(pass);
            modal.classList.add('hidden');
            onSuccess();
        } catch (e) {
            showToast("Invalid password", "error");
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerText = "Verify & Proceed";
        }
    };
}

/**
 * LOGOUT
 */
export function userLogout() {
    logAudit('LOGOUT', { email: auth.currentUser?.email });
    // Clean up disabled listener before signOut so we don't trigger it
    if (_disabledUnsub) { _disabledUnsub(); _disabledUnsub = null; }
    cleanupSession();
    signOut(auth);
}

/**
 * LOGIN (Manual trigger)
 */
export async function doLogin(email, pass) {
    const btn = document.getElementById("loginBtn");
    const errEl = document.getElementById("loginError");
    const errMsg = errEl?.querySelector('.error-msg');
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>Verifying Credentials...</span> <div class="btn-stitch-v4"></div>';
            btn.classList.add('loading');
        }
        if (errEl) errEl.classList.add('hidden');
        
        sessionStorage.setItem('PENDING_LOGIN_AUDIT', 'true');
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        console.error("Login Error:", error);
        const friendly = {
            'auth/user-not-found': 'No account found with this email',
            'auth/wrong-password': 'Incorrect password',
            'auth/invalid-credential': 'Invalid email or password',
            'auth/invalid-email': 'Please enter a valid email address',
            'auth/too-many-requests': 'Too many attempts. Please try again later',
            'auth/user-disabled': 'This account has been disabled'
        }[error.code] || 'Login failed. Please try again';
        if (errEl && errMsg) {
            errMsg.innerText = friendly;
            errEl.classList.remove('hidden');
        } else if (errEl) {
            errEl.innerText = friendly;
            errEl.classList.remove('hidden');
        } else {
            showToast(friendly, "error");
        }
        
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>Access Dashboard</span> <div class="btn-stitch-v4"></div>';
            btn.classList.remove('loading');
        }
    }
}
