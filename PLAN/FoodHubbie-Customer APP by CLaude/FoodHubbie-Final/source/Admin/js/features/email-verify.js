/**
 * FoodHubbie ERP | EMAIL VERIFICATION BANNER  (Admin/js/features/email-verify.js)
 *
 * D2: a website sign-up gets a real Firebase Auth account the moment the tenant is
 * created, but nobody has proved the owner owns that inbox. Until they click the
 * link Firebase emailed them, the outlet can be configured (menu, tables, settings)
 * while Supreme refuses to unlock it — so a squatted address never becomes a live
 * restaurant.
 *
 * This banner is the owner's side of that contract: send once automatically,
 * resend (60s throttle), check again. Self-contained: the element and its few
 * styles are created here, so index.html/style.css stay untouched.
 */
import { auth, db, get, ref, onAuthStateChanged, sendEmailVerification } from '../firebase.js';
import { showToast } from '../ui-utils.js';

const PANEL_ID = 'emailVerifyBanner';
const COOLDOWN_MS = 60 * 1000;
const LS_PREFIX = 'fh:emailVerifySent:';

let _el = null;
let _sentAt = 0;
let _tick = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const readSentAt = (uid) => {
    try { return Number(localStorage.getItem(LS_PREFIX + uid) || 0) || 0; } catch { return 0; }
};
const writeSentAt = (uid, at) => {
    try { localStorage.setItem(LS_PREFIX + uid, String(at)); } catch { /* private mode: banner still works, just re-sends */ }
};

function ensureEl() {
    if (_el && document.body.contains(_el)) return _el;
    const host = document.getElementById('tab-dashboard');
    if (!host) return null;
    _el = document.createElement('div');
    _el.id = PANEL_ID;
    _el.className = 'panel mt-8 mb-16';
    _el.setAttribute('role', 'status');
    _el.style.cssText = 'display:none;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-radius:10px;border-left:4px solid #2563eb;';
    host.insertBefore(_el, host.firstChild);
    return _el;
}

function stopTick() {
    if (_tick) { clearInterval(_tick); _tick = null; }
}

function renderResendButton(btn) {
    if (!btn) return;
    const wait = Math.max(0, COOLDOWN_MS - (Date.now() - _sentAt));
    btn.disabled = wait > 0;
    btn.textContent = wait > 0 ? `Resend in ${Math.ceil(wait / 1000)}s` : 'Resend link';
}

function startCooldown() {
    stopTick();
    const btn = _el && _el.querySelector('[data-ev-resend]');
    if (!btn) return;
    renderResendButton(btn);
    if (Math.max(0, COOLDOWN_MS - (Date.now() - _sentAt)) === 0) return;
    _tick = setInterval(() => {
        renderResendButton(btn);
        if (Math.max(0, COOLDOWN_MS - (Date.now() - _sentAt)) === 0) stopTick();
    }, 1000);
}

function hide() {
    stopTick();
    if (_el) _el.style.display = 'none';
}

async function send(user) {
    try {
        // No continue URL: Firebase's default action page always works. A custom
        // `url` needs the domain in Auth → Settings → Authorized domains, and a
        // missing entry fails the whole send with auth/unauthorized-continue-uri.
        await sendEmailVerification(user);
        _sentAt = Date.now();
        writeSentAt(user.uid, _sentAt);
        return true;
    } catch (err) {
        console.warn('[EmailVerify] send failed:', err && (err.code || err.message));
        showToast(
            err && err.code === 'auth/too-many-requests'
                ? 'Too many attempts — wait a minute and try again.'
                : 'Could not send the verification email. Try again in a minute.',
            'error'
        );
        return false;
    }
}

async function resend(user) {
    if (Date.now() - _sentAt < COOLDOWN_MS) return;
    const ok = await send(user);
    if (ok) showToast('Verification email sent — check your inbox and spam folder.', 'success');
    startCooldown();
}

async function checkAgain(user) {
    try {
        await user.reload();
        if (auth.currentUser && auth.currentUser.emailVerified) {
            hide();
            showToast('Email verified — you are all set.', 'success');
            window.dispatchEvent(new CustomEvent('fh:email-verified'));
            return;
        }
        showToast('Not verified yet — open the link in your inbox first.', 'warning');
    } catch (err) {
        console.warn('[EmailVerify] reload failed:', err && err.message);
        showToast('Could not check right now — try again.', 'error');
    }
}

function render(user) {
    const el = ensureEl();
    if (!el) return;
    const email = esc(user.email || 'your email');
    el.innerHTML = `<div><strong>Verify your email to go live</strong>
        <div class="text-muted-small">We sent a verification link to <strong>${email}</strong>. Check your inbox and spam folder, then click the link. You can set up your menu and tables meanwhile — the restaurant can't be unlocked until the email is verified.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-primary btn-sm" data-ev-resend>Resend link</button>
            <button type="button" class="btn-secondary btn-sm" data-ev-check>Check again</button>
        </div>`;
    el.style.display = 'flex';
    el.querySelector('[data-ev-resend]')?.addEventListener('click', () => resend(user));
    el.querySelector('[data-ev-check]')?.addEventListener('click', () => checkAgain(user));
    startCooldown();
}

export function initEmailVerification() {
    if (window.__demoMode === true) return; // the demo account is never gated
    onAuthStateChanged(auth, async (user) => {
        if (!user || user.emailVerified) { hide(); return; }
        // Supers and the demo account are not restaurant owners.
        try {
            const row = (await get(ref(db, `admins/${user.uid}`))).val() || {};
            if (row.isSuper === true || row.isSupreme === true || row.isDemo === true) { hide(); return; }
        } catch { /* rules/network: fall through and show the banner */ }
        _sentAt = readSentAt(user.uid);
        render(user);
        // First login on this device: send once. Later logins rely on Resend so a
        // reload loop can never burn the daily verification-email quota.
        if (!_sentAt) send(user).then((ok) => {
            if (ok) {
                showToast('Verification email sent — check your inbox and spam folder.', 'success');
                startCooldown();
            }
        });
    });
}
