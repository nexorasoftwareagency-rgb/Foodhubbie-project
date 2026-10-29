/**
 * FoodHubbie Demo — live-dashboard mode for www.foodhubbie.in/demo.
 *
 * `/demo` serves this same Admin app, but:
 *   1. it signs the visitor into the synthetic `foodhubbie-demo` tenant
 *      (`demo@foodhubbie.in`, profile name "Demo Dashboard"), and
 *   2. it lets them actually use the product: every write lands in the demo
 *      tenant, which is reseeded nightly.
 *
 * Only actions with a side effect OUTSIDE that tenant stay blocked — creating
 * real Firebase Auth users, sending WhatsApp/reset messages, changing the demo
 * account password, or disabling the outlet itself.
 *
 * The old static marketing replica (/demo/tour) was removed on 2026-10-29:
 * every demo link now points at this live sandbox.
 */

import { auth, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from './firebase.js';
import { restrict, initRestrictDelegation } from './demo/restrict.js';

export const DEMO_EMAIL = 'demo@foodhubbie.in';
export const DEMO_PASSWORD = 'Demo@Foodhubbie2026';
export const DEMO_PROFILE_NAME = 'Demo Dashboard';

const DEMO_PATH = '/demo';

/** True when this page load is the live demo dashboard. */
export function isDemoLocation() {
    const path = location.pathname.replace(/\/+$/, '');
    if (path === DEMO_PATH) return true;
    // Local/E2E escape hatch: /Admin/index.html?demo=1
    return new URLSearchParams(location.search).get('demo') === '1';
}

// ---------------------------------------------------------------------------
// The demo is a full sandbox: everything below writes only inside
// businesses/foodhubbie-demo, which the nightly reseed replaces. What stays
// blocked is anything with a side effect OUTSIDE that tenant.
// ---------------------------------------------------------------------------
const BLOCKED_ACTIONS = new Set([
    // Creates a real Firebase Auth user (staff + rider logins).
    'saveRiderAccount', 'staffSubmitBtn',
    // Sends a real password-reset email.
    'resetRiderPassword',
    // Deletes riders/{uid} AND root riderIndex/{uid}; root writes are denied,
    // so the flow would half-succeed.
    'deleteRider',
    // WhatsApp send command; the demo outlet has no bot worker, so it can only
    // end in a "no response" timeout.
    'sendTestPromo',
]);

// Buttons that persist/send but carry no data-action.
const BLOCKED_IDS = new Set([
    'btnChangePassword',   // would break the public demo account for everyone
    'btnConfirmReauth',
    'forgotPasswordBtn',   // password-reset email for the demo account
    'btnQuickToggleOutlet',// outlets/{oid}/disabled is denied by rules
]);

const CSS = `
#demoModeBanner{position:fixed;left:16px;bottom:16px;z-index:9000;display:flex;align-items:center;gap:10px;
  max-width:min(430px,calc(100vw - 32px));padding:9px 10px 9px 13px;border-radius:14px;
  background:rgba(15,23,42,.93);color:#f8fafc;box-shadow:0 18px 44px -22px rgba(15,23,42,.95);
  font-family:inherit;font-size:12px;line-height:1.35;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
#demoModeBanner .dmb-dot{width:7px;height:7px;border-radius:50%;background:#34d399;
  box-shadow:0 0 0 3px rgba(52,211,153,.22);flex:0 0 auto}
#demoModeBanner .dmb-text{flex:1 1 auto;min-width:0}
#demoModeBanner .dmb-text b{display:block;font-size:12px;font-weight:700;letter-spacing:.01em}
#demoModeBanner .dmb-text span{display:block;color:#94a3b8;font-size:11px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
#demoModeBanner .dmb-exit{flex:0 0 auto;border:1px solid rgba(248,250,252,.22);
  background:rgba(248,250,252,.08);color:#f8fafc;font:inherit;font-size:11.5px;font-weight:600;
  padding:6px 10px;border-radius:9px;cursor:pointer}
#demoModeBanner .dmb-exit:hover{background:rgba(248,250,252,.18)}
#demoModeBanner .dmb-exit:focus-visible{outline:2px solid #f8fafc;outline-offset:2px}
@media (max-width:768px){#demoModeBanner{left:10px;right:10px;
  bottom:calc(74px + env(safe-area-inset-bottom,0px));max-width:none}}
`;

function injectStyles() {
    if (document.getElementById('demoModeStyles')) return;
    const style = document.createElement('style');
    style.id = 'demoModeStyles';
    style.textContent = CSS;
    document.head.appendChild(style);
}

function renderBanner() {
    if (document.getElementById('demoModeBanner')) return;
    const el = document.createElement('div');
    el.id = 'demoModeBanner';
    el.setAttribute('role', 'status');
    el.innerHTML = `
        <span class="dmb-dot" aria-hidden="true"></span>
        <div class="dmb-text">
            <b>Demo mode</b>
            <span>Demo Dashboard · full sandbox · reseeded nightly</span>
        </div>
        <button type="button" class="dmb-exit" id="demoExitBtn" data-demo-allow="1">Exit demo</button>`;
    document.body.appendChild(el);
    document.getElementById('demoExitBtn').addEventListener('click', async () => {
        try { await signOut(auth); } catch (_) { /* already gone */ }
        location.href = '/';
    });
}

/** Human label for the modal's "Blocked: …" line. */
function labelFor(el) {
    const raw = el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 48);
}

function onBlockedClick(e) {
    const el = e.target.closest('button, a, [role="button"], [data-action], input[type="checkbox"], input[type="radio"]');
    if (!el) return;
    if (el.closest('#demoRestrictModal') || el.closest('#demoModeBanner')) return;
    if (el.hasAttribute('data-demo-allow')) return;

    // The login form itself is allowed (that is how a visitor with a foreign
    // session deliberately switches into the demo); its Forgot-password action
    // is not.
    if (el.closest('#loginForm') && el.id !== 'forgotPasswordBtn') return;

    const actionEl = el.closest('[data-action]');
    const action = actionEl ? actionEl.getAttribute('data-action') : '';
    if (action && !BLOCKED_ACTIONS.has(action)) return;
    if (!action && el.id && !BLOCKED_IDS.has(el.id)) return;
    if (!action && !el.id) return;                               // plain UI button

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    restrict(labelFor(el), el);
}

/**
 * The sidebar identity block is static HTML ("Store Admin" / "Superuser") for
 * every role; in the demo it must read as the demo profile.
 */
function applyDemoIdentity() {
    const nameEl = document.querySelector('.user-info .user-name');
    const roleEl = document.querySelector('.user-info .user-role');
    const initials = document.getElementById('sidebarAvatarInitials');
    if (nameEl) nameEl.textContent = DEMO_PROFILE_NAME;
    if (roleEl) roleEl.textContent = 'Admin';
    if (initials) initials.textContent = 'DD';
}

/**
 * Turn demo mode on for this page load.
 * @returns {Promise<boolean>} true when the live demo is active
 */
export async function initDemoMode() {
    if (!isDemoLocation()) return false;
    window.__demoMode = true;
    document.documentElement.classList.add('demo-mode');

    // The tenant is fixed and known before sign-in. Several modules (bot status,
    // branding) read these at import time, i.e. before auth.js resolves the
    // admin node, so set them now or they would query the default tenant.
    window.currentBusinessId = 'foodhubbie-demo';
    window.currentOutlet = 'demo';

    // A stale outlet from another tenant would point the whole app at the wrong
    // business (auth.js prefers it over adminData.outlet).
    try { sessionStorage.removeItem('adminSelectedOutlet'); } catch (_) {}

    injectStyles();
    renderBanner();
    applyDemoIdentity();
    initRestrictDelegation();
    document.addEventListener('click', onBlockedClick, true);

    const emailEl = document.getElementById('loginEmail');
    const passEl = document.getElementById('loginPassword');
    if (emailEl) emailEl.value = DEMO_EMAIL;
    if (passEl) passEl.value = DEMO_PASSWORD;

    // Wait for Firebase to restore any persisted session before deciding.
    try { await auth.authStateReady(); } catch (_) {}

    if (auth.currentUser && auth.currentUser.email !== DEMO_EMAIL) {
        // Never silently swap a real admin's session for the demo one — make it
        // a deliberate click on the (already prefilled) login form instead.
        showDemoNotice();
        return true;
    }

    if (!auth.currentUser) {
        try {
            // Session persistence, not local: the public demo should not leave a
            // signed-in demo session behind on a shared machine.
            await setPersistence(auth, browserSessionPersistence).catch(() => {});
            await signInWithEmailAndPassword(auth, DEMO_EMAIL, DEMO_PASSWORD);
            // Listeners that attached before sign-in (bot status) are still on a
            // permission-denied ref — tell them to re-read now that we are authed.
            document.dispatchEvent(new CustomEvent('switchOutlet', { detail: { outlet: 'demo' } }));
        } catch (err) {
            console.error('[Demo] sign-in failed:', err?.code || err);
            const errEl = document.getElementById('loginError');
            const errMsg = errEl?.querySelector('.error-msg');
            if (errEl && errMsg) {
                errMsg.textContent = 'Demo sign-in is unavailable right now. Please try again.';
                errEl.classList.remove('hidden');
            }
        }
    }
    return true;
}

function showDemoNotice() {
    const form = document.getElementById('loginForm');
    if (!form || document.getElementById('demoLoginNotice')) return;
    const note = document.createElement('div');
    note.id = 'demoLoginNotice';
    note.style.cssText = 'margin:0 0 14px;padding:10px 12px;border-radius:12px;background:#fff7ed;' +
        'border:1px solid #fed7aa;color:#9a3412;font-size:12px;line-height:1.5;text-align:left';
    note.innerHTML = 'Another account is signed in on this browser. Click <strong>Access Dashboard</strong> ' +
        'to enter the demo — this replaces that session on this device.';
    form.insertBefore(note, form.firstChild);
}
