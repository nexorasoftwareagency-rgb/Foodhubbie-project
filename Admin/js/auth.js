import { auth, db, Outlet, EmailAuthProvider, ref, get, onAuthStateChanged, signInWithEmailAndPassword, signOut, onChildAdded, reauthenticateWithCredential, serverTimestamp, set, push } from './firebase.js';
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

function cleanupSession() {
    if (_newOrderUnsub) { _newOrderUnsub(); _newOrderUnsub = null; }
    _lastNewOrder = '';
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

    // Add diagnostic button to login form (Gated for non-production/debug only)
    const isDebuggable = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || localStorage.getItem('DEBUG_MODE') === 'true';
    const loginCard = document.querySelector('.login-card-v4');
    if (loginCard && isDebuggable && !document.getElementById('diagnosticBtn')) {
        const diagBtn = document.createElement('button');
        diagBtn.id = 'diagnosticBtn';
        diagBtn.type = 'button';
        diagBtn.innerText = '🔍 Run Diagnostics';
        diagBtn.style.cssText = 'margin-top: 20px; background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 12px; cursor: pointer; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; transition: all 0.3s;';
        diagBtn.onmouseover = () => diagBtn.style.background = 'rgba(255,255,255,0.1)';
        diagBtn.onmouseout = () => diagBtn.style.background = 'rgba(255,255,255,0.05)';
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
            const loginBtn = document.querySelector("#loginForm button");
            
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
            showToast("ACCESS DENIED: Unauthorized Account", "error");
            
            const overlay = document.getElementById("authOverlay");
            if (overlay) {
                overlay.innerHTML = ''; // Clear previous content
                const modal = document.createElement('div');
                modal.className = 'auth-modal';
                
                const title = document.createElement('h2');
                title.className = 'text-danger';
                title.textContent = 'ACCESS DENIED';
                
                const msg = document.createElement('p');
                msg.textContent = 'No administrative profile found for this account.';
                
                const retryBtn = document.createElement('button');
                retryBtn.className = 'btn-primary mt-20';
                retryBtn.textContent = 'Try Another Account';
                retryBtn.addEventListener('click', () => location.reload());
                
                modal.append(title, msg, retryBtn);
                overlay.appendChild(modal);
            }
            
setTimeout(() => signOut(auth), 3000);
        return;
    }

    // ponytail: clear seamless-mode on logout so login screen shows
    document.documentElement.classList.remove('seamless-mode');

        // Initialize Session
        state.adminData = adminData;
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
            
            // Build options based on access level
            let outletOptionsHtml = `
                <option value="pizza">🍕 Pizza ERP</option>
                <option value="cake">🎂 Cakes ERP</option>
            `;
            
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

        // Start Features
        updateBranding();
        loadRiders();
        initRealtimeListeners();
        setupCapacitorFCM(user.uid);
        setupAdminFCM(user.uid);
        initNewOrderNotifications();
        if (!document._switchOutletListenerBound) {
            document.addEventListener('switchOutlet', () => {
                initNewOrderNotifications();
            });
            document._switchOutletListenerBound = true;
        }

        // Initial Tab Navigation (Respect Hash or Default to Dashboard)
        const initialTab = window.location.hash.replace('#', '') || 'dashboard';
        ui.switchTab(initialTab, true);
        window.hideLoader?.();
    });
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
    cleanupSession();
    signOut(auth);
}

// Track last notified order ID to avoid duplicate browser notifications
let _lastNewOrder = '';
let _newOrderUnsub = null;

function initNewOrderNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
    // Cleanup previous listener if any
    if (_newOrderUnsub) { _newOrderUnsub(); _newOrderUnsub = null; }
    const outlet = window.currentOutlet || 'pizza';
    const r = ref(db, `${outlet}/orders`);
    let initial = true;
    _newOrderUnsub = onChildAdded(r, (snap) => {
        if (initial) { initial = false; return; }
        const order = snap.val();
        if (!order || order.orderId === _lastNewOrder) return;
        const status = (order.status || '').toLowerCase();
        if (status !== 'placed') return;
        _lastNewOrder = order.orderId;
        if (Notification.permission === 'granted') {
            const n = new Notification('\uD83D\uDD04 New Order Received!', {
                body: `#${order.orderId?.slice(-5) || snap.key?.slice(-5)} — ${order.customerName || 'Customer'} — ₹${order.total || 0}`,
                icon: '/icon-erp-logo.jpeg',
                tag: `order-${snap.key}`
            });
            n.onclick = () => { window.focus(); ui.switchTab('orders'); n.close(); };
        }
    });
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
