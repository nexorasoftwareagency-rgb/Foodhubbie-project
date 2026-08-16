/**
 * Two access levels, both gated by custom claims (set out-of-band via the
 * Firebase Admin SDK):
 *   - `isSuper`   → full access, including restart/stop/reconnect/onboard.
 *   - `isSupport` → read-only: can view both dashboards, no mutating
 *                   actions. For looping in junior/support staff without
 *                   giving them the ability to take a restaurant's bot
 *                   down. e.g. `admin.auth().setCustomUserClaims(uid,
 *                   { isSupport: true })`.
 * Anyone with neither claim sees the "not authorized" screen. The Bot
 * Control API enforces isSuper-only on every mutating route independently
 * — the client-side hiding of buttons below is UX, not the security
 * boundary.
 *
 * No page in #app-shell renders until this resolves.
 */

import { setRole } from '/js/data-store.js';

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');

renderSignIn();

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
renderSignIn();

    return;
  }

  renderChecking();

  let claims;
  try {
    // force refresh so a claim set moments ago (e.g. just promoted to
    // super-admin) is picked up without requiring a manual re-login
    const tokenResult = await user.getIdTokenResult(true);
    claims = tokenResult.claims;
  } catch (err) {
    console.error('Failed to read auth token claims', err);
    renderDenied(user, 'Could not verify your access level. Try signing in again.');
    return;
  }

  // This project authorizes via the admins/{uid} mirror (matches the main
  // Admin panel + bot-control-api). Custom claims may be unset for accounts
  // that never had them applied — fall back to the DB mirror so existing
  // admin accounts work without a manual claim-set step.
  if (claims?.isSuper !== true && claims?.isSupport !== true) {
    try {
      const snap = await firebase.database().ref(`admins/${user.uid}`).once('value');
      const dbAdmin = snap.val() || {};
      if (dbAdmin.isSuper === true) claims = { isSuper: true };
      else if (dbAdmin.isSupport === true) claims = { isSupport: true };
    } catch (err) {
      console.error('Failed to read admins/{uid} mirror', err);
    }
  }

  if (claims && claims.isSuper === true) {
    setRole('super');
    renderApp(user, 'super');
  } else if (claims && claims.isSupport === true) {
    setRole('support');
    renderApp(user, 'support');
  } else {
    renderDenied(user, "Your account doesn't have Supreme Admin access.");
  }
});

function renderSignIn() {
  appShell.style.display = 'none';
  authScreen.innerHTML = `
    <div class="auth-card glass-card">
      <div class="brand-mark">FH</div>
      <h1>Food-Hubbie Supreme Admin</h1>
      <p>Internal platform tool. Sign in with your Food-Hubbie / Nexora staff account.</p>
      <button class="btn btn-primary" id="google-signin-btn">
        <svg data-lucide="log-in" style="width:15px;height:15px"></svg>
        Sign in with Google
      </button>
      <div class="auth-divider"><span>or</span></div>
      <form id="email-signin-form" class="auth-form">
        <input type="email" id="email-input" placeholder="Email" autocomplete="email" required />
        <input type="password" id="password-input" placeholder="Password" autocomplete="current-password" required />
        <button type="submit" class="btn btn-ghost">Sign in with password</button>
      </form>
    </div>`;
  refreshIcons(authScreen);
  document.getElementById('google-signin-btn').addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.error('Sign-in failed', err);
      showToastIfReady('Sign-in failed — please try again.', 'error');
    }
  });
  document.getElementById('email-signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email-input').value.trim();
    const pass = document.getElementById('password-input').value;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await firebase.auth().signInWithEmailAndPassword(email, pass);
    } catch (err) {
      console.error('Sign-in failed', err);
      showToastIfReady('Sign-in failed — please try again.', 'error');
      btn.disabled = false;
    }
  });
}

function renderChecking() {
  appShell.style.display = 'none';
  authScreen.innerHTML = `
    <div class="auth-card glass-card">
      <div class="brand-mark">FH</div>
      <p style="margin-top:8px">Checking access…</p>
    </div>`;
}

function renderDenied(user, message) {
  appShell.style.display = 'none';
  authScreen.innerHTML = `
    <div class="auth-card glass-card auth-denied">
      <svg data-lucide="shield-alert"></svg>
      <h1>Not authorized</h1>
      <p>${escapeHtml(message)}</p>
      <button class="btn btn-ghost" id="signout-btn">Sign out</button>
    </div>`;
  refreshIcons(authScreen);
  document.getElementById('signout-btn').addEventListener('click', () => firebase.auth().signOut());
}

function renderApp(user, role) {
  // #auth-screen keeps min-height:100vh from its sign-in styling — hiding
  // the element (not just clearing innerHTML) is what removes that empty
  // full-height block; otherwise the app shell + topbar get pushed a whole
  // viewport down ("vacant header / structure imbalance").
  authScreen.style.display = 'none';
  authScreen.innerHTML = '';
  appShell.style.display = 'block';
  document.getElementById('current-user-email').textContent = user.email || '';
  if (role === 'support') {
    const badge = document.createElement('span');
    badge.className = 'role-badge';
    badge.textContent = 'View only';
    document.getElementById('app-user').prepend(badge);
  }
  refreshIcons(document.getElementById('app-shell'));
  // Hand off to the router now that access is confirmed.
  import('/js/main.js').then((mod) => mod.startApp());
}

function showToastIfReady(msg, type) {
  if (window.showToast) showToast(msg, type);
  else alert(msg);
}
