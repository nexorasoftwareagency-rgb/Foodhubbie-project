/**
 * menu/js/customer.js
 *
 * Customer identity, first-run onboarding, app notifications, and the
 * Promotions sub-tabs (Offers / Notifications / Account).
 *
 * Identity is deliberately phone-only and unverified: it exists so a
 * returning customer can be greeted and so this device can receive order
 * updates/offers. Ordering never depends on it and every step is skippable.
 * The FCM token itself is never stored in localStorage - it only lives in
 * the outlet's pushSubscriptions record (see pwa-install.js).
 */
import { outletRef, get, set, push, update, onValue, ensureAnonAuth, OUTLET, BUSINESS_ID } from './firebase.js';
import * as UI from './ui.js';
import { esc, buildInstagramUrl, buildWhatsappUrl } from './ui.js';
import { couponStatus, discountAllowsChannel } from '../shared/discount-rules.js';
import {
    isIOS, isStandalone, isInstalled, canShowNativeInstallPrompt, promptInstall,
    getStoredPhone, savePhone, subscribeToNotifications,
    updateSubscriptionMeta, unsubscribeFromNotifications,
    getNotificationPermission, onForegroundMessage
} from './pwa-install.js';

const PROFILE_KEY = 'fh_customer_profile';
const PREFS_KEY = 'fh_notif_prefs_v1';
const ONBOARDED_KEY = 'fh_onboarded_v1';
const CONSENT_VERSION = 1;

const DEFAULT_PREFS = { offers: false, orderUpdates: true };

let _mode = 'dine-in';
let _profile = null;
let _prefs = { ...DEFAULT_PREFS };
let _inbox = [];
let _activeTab = 'offers';
let _tabsBound = false;
let _inboxBound = false;
let _filterChipsBound = false;
let _activeFilter = 'all';
let _foregroundUnsub = null;
let _onboardingBound = false;
let _steps = [];
let _stepIndex = 0;
let _draft = { name: '', phone: '' };
let _orders = [];
let _ratings = {};
let _ratingsDocBound = false;
let _ratingPending = { orderId: null, rating: null };
let _loyaltyConfig = null;   // { earnRatePaisePerPoint, tiers, rewards }
let _loyalty = null;         // { lifetimePoints, totalSpent, orderCount, tier, ... }
let _customerRank = null;    // customer's rank in outlet leaderboard
let _initialized = false;

function readJSON(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

function normalizePhone(raw) {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    return /^[6-9]\d{9}$/.test(digits.slice(-10)) ? digits.slice(-10) : '';
}

function validName(raw) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    return name.length >= 2 && name.length <= 60 ? name : '';
}

function defaultConsent(prefs = DEFAULT_PREFS) {
    return { offers: prefs.offers === true, orderUpdates: prefs.orderUpdates !== false, version: CONSENT_VERSION };
}

function readPrefs() {
    const stored = readJSON(PREFS_KEY);
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_PREFS };
    return {
        offers: stored.offers === true,
        orderUpdates: stored.orderUpdates !== false
    };
}

function readProfile() {
    const stored = readJSON(PROFILE_KEY);
    if (stored && normalizePhone(stored.phone)) {
        return {
            v: 1,
            name: validName(stored.name),
            phone: normalizePhone(stored.phone),
            consent: stored.consent || defaultConsent(_prefs),
            createdAt: Number(stored.createdAt) || Date.now(),
            updatedAt: Number(stored.updatedAt) || Date.now(),
            source: stored.source || 'local'
        };
    }
    const legacyPhone = normalizePhone(getStoredPhone());
    if (!legacyPhone) return null;
    return {
        v: 1,
        name: '',
        phone: legacyPhone,
        consent: defaultConsent(_prefs),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'legacy'
    };
}

function persistProfile(profile) {
    _profile = profile;
    writeJSON(PROFILE_KEY, profile);
    if (profile?.phone) savePhone(profile.phone);
    return profile;
}

function syncProfile(profile) {
    if (!profile?.phone || !profile?.name) return Promise.resolve(false);
    const path = `customers/${profile.phone}/app`;
    const write = async () => {
        if ((await ensureDeviceAccess(profile.phone)) === 'taken') return false;
        let existing = null;
        try {
            const snap = await get(outletRef(path));
            existing = snap.val();
        } catch (e) { /* rules may not be deployed yet */ }
        const now = Date.now();
        const payload = {
            name: profile.name,
            phone: profile.phone,
            consent: defaultConsent(_prefs),
            consentVersion: CONSENT_VERSION,
            source: profile.source || 'app',
            createdAt: Number(existing?.createdAt) || profile.createdAt || now,
            updatedAt: now
        };
        await set(outletRef(path), payload);
        return true;
    };
    return write().catch(() => {
        // One retry: a transient cold-start write failure should not lose the
        // profile forever, but a hard rules error must stay quiet.
        return new Promise(resolve => setTimeout(resolve, 2500))
            .then(write)
            .catch(() => false);
    });
}

function saveIdentity(name, phone, { source = 'app', sync = true } = {}) {
    const cleanName = validName(name);
    const cleanPhone = normalizePhone(phone);
    if (!cleanName) return { ok: false, error: 'Enter your name (2-60 characters).' };
    if (!cleanPhone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };

    const now = Date.now();
    const profile = persistProfile({
        v: 1,
        name: cleanName,
        phone: cleanPhone,
        consent: defaultConsent(_prefs),
        createdAt: _profile?.createdAt || now,
        updatedAt: now,
        source
    });
    if (sync) {
        syncProfile(profile);
        updateSubscriptionMeta({
            name: cleanName,
            phone: cleanPhone,
            prefs: _prefs,
            appMode: _mode
        }).catch(() => {});
    }
    return { ok: true, profile };
}

function setPrefs(partial, { sync = true } = {}) {
    _prefs = { ..._prefs, ...partial };
    writeJSON(PREFS_KEY, _prefs);
    if (sync && _profile?.phone) {
        _profile = persistProfile({ ..._profile, consent: defaultConsent(_prefs), updatedAt: Date.now() });
        syncProfile(_profile);
        updateSubscriptionMeta({
            name: _profile.name,
            phone: _profile.phone,
            prefs: _prefs,
            appMode: _mode
        }).catch(() => {});
    }
    return _prefs;
}

// ---------------------------------------------------------------
// Phone privacy without OTP: "first phone to use a number owns it".
// Typing a number is not proof it is yours, so the customer's data
// (profile, orders, loyalty, rewards, delivery code) is readable only by
// devices registered under customers/{phone}/devices/{uid}. The first device
// registers itself; another phone joins with an 8-digit code made on the
// first one (Account > Link another phone), or the restaurant resets the lock.
// States: 'owner' | 'taken' (another device owns it) | 'error' (rules not
// deployed yet / offline: behave as before, nothing is lost).
// ---------------------------------------------------------------
let _access = { phone: null, state: 'unknown', pending: null };

export function getAccessState() { return _access.state; }

export function ensureDeviceAccess(phone) {
    const p = normalizePhone(phone);
    if (!p) return Promise.resolve('error');
    if (_access.phone === p && _access.pending) return _access.pending;
    const rec = { phone: p, state: 'unknown', pending: null };
    _access = rec;
    rec.pending = (async () => {
        let state = 'error';
        try {
            const user = await ensureAnonAuth();
            const mine = outletRef(`customers/${p}/devices/${user.uid}`);
            let registered = null;
            try { registered = (await get(mine)).exists(); } catch (e) { registered = null; } // old rules: no devices node
            if (registered === true) state = 'owner';
            else if (registered === false) {
                try { await set(mine, { at: Date.now() }); state = 'owner'; } catch (e) { state = 'taken'; }
            }
        } catch (e) { state = 'error'; }
        rec.state = state;
        if (_initialized) { try { renderAccount(); } catch (e) { /* DOM not ready */ } }
        return state;
    })();
    return rec.pending;
}

// Owner device: make a short-lived code to add another phone.
export async function createLinkCode() {
    const p = _profile?.phone;
    if (!p || (await ensureDeviceAccess(p)) !== 'owner') throw new Error('not-owner');
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String(buf[0] % 100000000).padStart(8, '0');
    const exp = Date.now() + 10 * 60 * 1000;
    await set(outletRef(`customers/${p}/link`), { code, exp });
    return { code, exp };
}

// New device: prove you hold the other phone by typing its code.
export async function linkThisDevice(phone, code) {
    const p = normalizePhone(phone);
    const c = String(code || '').replace(/\D/g, '');
    if (!p) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
    if (c.length !== 8) return { ok: false, error: 'Enter the 8-digit code shown on your other phone.' };
    try {
        const user = await ensureAnonAuth();
        await set(outletRef(`customers/${p}/devices/${user.uid}`), { at: Date.now(), code: c });
    } catch (e) {
        return { ok: false, error: 'That code is wrong or has expired. Make a new one on your other phone.' };
    }
    _access = { phone: p, state: 'owner', pending: Promise.resolve('owner') };
    set(outletRef(`customers/${p}/link`), null).catch(() => {});
    if (_profile?.phone === p) { hydrateProfile(); loadCustomerData().catch(() => {}); }
    if (_initialized) { try { renderAccount(); } catch (e) { /* DOM not ready */ } }
    return { ok: true };
}

function lockedPanelHtml() {
    return `<div class="account-empty">This number is already set up on another phone, so your orders and points are hidden here. Open the <strong>Account</strong> tab and enter the 8-digit link code from your other phone, or ask the restaurant to reset it.</div>`;
}

function accessCardHtml() {
    if (!_profile?.phone) return '';
    if (_access.state === 'taken') {
        return `<div class="account-card access-card" id="accessCard">
            <div class="access-title">This number is already set up on another phone</div>
            <p class="access-text">To keep your orders and points private, they are shown only on a phone you have linked. On your other phone open <strong>Account &rarr; Link another phone</strong> and type the 8-digit code here. Lost that phone? Ask the restaurant to reset it.</p>
            <input class="onb-input" id="linkCodeInput" type="tel" inputmode="numeric" maxlength="8" placeholder="8-digit code" autocomplete="one-time-code">
            <button type="button" class="account-save" id="btnLinkDevice">Link this phone</button>
        </div>`;
    }
    if (_access.state === 'owner') {
        return `<div class="account-card access-card" id="accessCard">
            <div class="access-title">Use this number on another phone</div>
            <p class="access-text">Make a code, then type it on the other phone. It works once, for 10 minutes.</p>
            <div id="linkCodeOut" class="access-code hidden" aria-live="polite"></div>
            <button type="button" class="account-save" id="btnMakeLinkCode">Link another phone</button>
        </div>`;
    }
    return '';
}

function bindAccessCard() {
    document.getElementById('btnLinkDevice')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const res = await linkThisDevice(_profile?.phone, document.getElementById('linkCodeInput')?.value);
        btn.disabled = false;
        if (!res.ok) return UI.showToast(res.error, 'error');
        UI.showToast('Phone linked. Your orders and points are back.', 'success');
    });
    document.getElementById('btnMakeLinkCode')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            const { code } = await createLinkCode();
            const out = document.getElementById('linkCodeOut');
            if (out) { out.textContent = code.replace(/(\d{4})(\d{4})/, '$1 $2'); out.classList.remove('hidden'); }
        } catch (err) {
            UI.showToast('Could not make a code. Check your connection and try again.', 'error');
        }
        btn.disabled = false;
    });
}

// Direct-mode sign-in: phone is the key, name is optional (greeting only).
// No OTP by owner decision. The server-side profile node requires a 2+ char
// name, so a blank name is stored as 'Guest'.
export function signInWithPhone(name, phone) {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
    const typed = String(name || '').trim();
    if (typed && !validName(typed)) return { ok: false, error: 'Name must be 2-60 characters (or leave it empty).' };
    const res = saveIdentity(typed || 'Guest', cleanPhone, { source: 'signin' });
    if (res.ok) markOnboarded();
    return res;
}

export function isSignedIn() {
    return !!_profile?.phone;
}

export function getProfile() {
    return _profile ? { ..._profile, prefs: { ..._prefs } } : null;
}

// Called from both checkout flows so a customer who skipped onboarding still
// becomes greeter/notification-ready the first time they place an order.
export function rememberIdentity(name, phone) {
    const cleanName = validName(name);
    const cleanPhone = normalizePhone(phone);
    if (!cleanName || !cleanPhone) return;
    if (_profile?.name === cleanName && _profile?.phone === cleanPhone) return;
    saveIdentity(cleanName, cleanPhone, { source: 'checkout' });
}

async function hydrateProfile() {
    if (!_profile?.phone) return;
    if ((await ensureDeviceAccess(_profile.phone)) === 'taken') { try { renderAccount(); } catch (e) { /* DOM not ready */ } return; }
    try {
        const snap = await get(outletRef(`customers/${_profile.phone}/app`));
        const server = snap.val();
        if (!server || typeof server !== 'object') return;

        const serverName = validName(server.name);
        const localIsNewer = Number(_profile.updatedAt || 0) >= Number(server.updatedAt || 0);
        if (serverName && (!_profile.name || !localIsNewer)) {
            _profile = persistProfile({ ..._profile, name: serverName, updatedAt: Number(server.updatedAt) || Date.now() });
            UI.updateGreeting(_profile.name);
        }
        if (!readJSON(PREFS_KEY) && server.consent) {
            _prefs = {
                offers: server.consent.offers === true,
                orderUpdates: server.consent.orderUpdates !== false
            };
            writeJSON(PREFS_KEY, _prefs);
        }
        renderAccount();
    } catch (e) { /* anonymous read may be unavailable until rules deploy */ }
}

function hasIdentity() {
    return !!_profile?.phone;
}

function hasCompletedOnboarding() {
    try {
        if (localStorage.getItem(ONBOARDED_KEY) === '1') return true;
    } catch (e) { /* ignore */ }
    return hasIdentity();
}

function markOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------

function icon(name) {
    const paths = {
        user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8C10 8 8 6.5 8 4.5S9.5 2 12 4c2.5-2 4-1.5 4 .5S14 8 12 8Z"/>',
        pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
        install: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

function ensureOnboardingDOM() {
    if (document.getElementById('onbOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'onbOverlay';
    overlay.className = 'onb-overlay hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onbTitle');
    overlay.innerHTML = `
        <div class="onb-sheet">
            <div class="onb-top">
                <div class="onb-progress" id="onbProgress" aria-hidden="true"></div>
                <button type="button" class="onb-skip" id="onbSkip">Skip</button>
            </div>
            <div class="onb-icon" id="onbIcon" aria-hidden="true"></div>
            <h2 class="onb-title" id="onbTitle"></h2>
            <p class="onb-desc" id="onbDesc"></p>
            <div class="onb-content" id="onbContent"></div>
            <button type="button" class="onb-primary" id="onbPrimary"></button>
            <button type="button" class="onb-secondary" id="onbSecondary"></button>
        </div>`;
    document.body.appendChild(overlay);
    if (_onboardingBound) return;

    _onboardingBound = true;
    document.getElementById('onbSkip')?.addEventListener('click', finishOnboarding);
    document.getElementById('onbSecondary')?.addEventListener('click', () => {
        const step = _steps[_stepIndex];
        if (step === 'welcome') return finishOnboarding();
        nextStep();
    });
    document.getElementById('onbPrimary')?.addEventListener('click', handlePrimary);
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finishOnboarding(); }
    });
    document.addEventListener('focusin', (e) => {
        if (!overlay.classList.contains('hidden') && !overlay.contains(e.target)) {
            document.getElementById('onbPrimary')?.focus();
        }
    });
}

function buildSteps() {
    const steps = [];
    if (!hasIdentity()) steps.push('welcome');
    if (!hasIdentity() || !_profile?.name) steps.push('identity');
    const iosNeedsInstall = isIOS() && !isStandalone();
    if (iosNeedsInstall) steps.push('install');
    if (!iosNeedsInstall) steps.push('notifications');
    if (_mode === 'delivery' && needsLocation()) steps.push('location');
    return steps;
}

function needsLocation() {
    const banner = document.getElementById('locationBanner');
    return !!banner && !banner.classList.contains('hidden');
}

export function maybeStartOnboarding({ mode = 'dine-in', force = false } = {}) {
    _mode = mode;
    if (!force && hasCompletedOnboarding()) return false;
    if (!force) {
        const active = document.querySelector('.screen.active')?.id || '';
        if (!['screenWelcome', 'screenMenu', 'screenPromotions'].includes(active)) return false;
    }
    _draft = { name: _profile?.name || '', phone: _profile?.phone || '' };
    _steps = buildSteps();
    if (_steps.length === 0) {
        markOnboarded();
        return false;
    }
    _stepIndex = 0;
    ensureOnboardingDOM();
    const overlay = document.getElementById('onbOverlay');
    overlay?.classList.remove('hidden');
    document.body.classList.add('onb-open');
    renderOnboardingStep();
    return true;
}

function finishOnboarding() {
    markOnboarded();
    document.getElementById('onbOverlay')?.classList.add('hidden');
    document.body.classList.remove('onb-open');
    renderAccount();
}

function nextStep() {
    if (_stepIndex >= _steps.length - 1) return finishOnboarding();
    _stepIndex += 1;
    renderOnboardingStep();
}

const ONB_COPY = {
    welcome: {
        icon: 'spark',
        title: 'Welcome',
        desc: 'Faster ordering, live order updates, and offers from your favourite kitchen. This takes 20 seconds, and you can skip any step.',
        primary: 'Continue',
        secondary: 'Skip for now'
    },
    identity: {
        icon: 'user',
        title: 'Make it yours',
        desc: 'Your name lets us greet you, and your mobile number lets us send order updates. No OTP needed.',
        primary: 'Save & continue',
        secondary: 'Not now'
    },
    install: {
        icon: 'install',
        title: 'Add to Home Screen',
        desc: 'On iPhone, tap Share, then Add to Home Screen. Installed apps can receive order notifications.',
        primary: 'Continue',
        secondary: 'Later'
    },
    notifications: {
        icon: 'bell',
        title: 'Stay in the loop',
        desc: 'Get a notification when your order is confirmed, ready, out for delivery, and delivered.',
        primary: 'Enable notifications',
        secondary: 'Not now'
    },
    location: {
        icon: 'pin',
        title: 'Enable location',
        desc: 'Location is only used for delivery: it lets us calculate the delivery fee and get your order to the right address.',
        primary: 'Enable location',
        secondary: 'Later'
    }
};

function renderOnboardingStep() {
    const step = _steps[_stepIndex];
    const copy = ONB_COPY[step];
    const overlay = document.getElementById('onbOverlay');
    if (!overlay || !copy) return finishOnboarding();

    const brand = document.querySelector('#screenWelcome .welcome-brand')?.textContent?.trim()
        || document.querySelector('.topbar-logo')?.textContent?.trim()
        || 'your favourite kitchen';
    document.getElementById('onbTitle').textContent = step === 'welcome' ? `Welcome to ${brand}` : copy.title;
    document.getElementById('onbDesc').textContent = copy.desc;
    document.getElementById('onbIcon').innerHTML = icon(copy.icon);
    document.getElementById('onbPrimary').textContent = copy.primary;
    const secondary = document.getElementById('onbSecondary');
    secondary.textContent = copy.secondary;
    secondary.classList.toggle('hidden', step === 'location' || step === 'install');

    document.getElementById('onbProgress').innerHTML = _steps.map((s, i) =>
        `<span class="onb-dot ${i < _stepIndex ? 'done' : i === _stepIndex ? 'active' : ''}"></span>`
    ).join('');

    const content = document.getElementById('onbContent');
    if (step === 'identity') {
        content.innerHTML = `
            <label class="onb-label" for="onbName">Your name</label>
            <input class="onb-input" id="onbName" type="text" autocomplete="name" maxlength="60" placeholder="e.g. Rohan" value="${esc(_draft.name)}">
            <label class="onb-label" for="onbPhone">Mobile number</label>
            <div class="onb-phone">
                <span>+91</span>
                <input class="onb-input" id="onbPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="98765 43210" value="${esc(_draft.phone)}">
            </div>
            <p class="onb-hint">Only for order updates and offers. You can still order without it.</p>`;
        document.getElementById('onbName')?.addEventListener('input', (e) => { _draft.name = e.target.value; });
        document.getElementById('onbPhone')?.addEventListener('input', (e) => { _draft.phone = e.target.value.replace(/\D/g, '').slice(0, 10); });
    } else if (step === 'notifications') {
        content.innerHTML = `
            <label class="onb-check">
                <input type="checkbox" id="onbOffers" ${_prefs.offers ? 'checked' : ''}>
                <span>Also send me offers and new menu updates</span>
            </label>
            <p class="onb-hint">Order updates are on by default. You can change both anytime in Account.</p>`;
    } else if (step === 'install') {
        content.innerHTML = `<div class="onb-steps"><span>1. Tap the Share icon in Safari</span><span>2. Choose Add to Home Screen</span><span>3. Open FoodHubbie from your Home Screen</span></div>`;
    } else if (step === 'location') {
        content.innerHTML = `<div class="onb-steps"><span>Required only for delivery orders.</span><span>Used to calculate distance and delivery fee.</span></div>`;
    } else {
        content.innerHTML = '';
    }

    const focusTarget = step === 'identity' ? document.getElementById('onbName') : document.getElementById('onbPrimary');
    setTimeout(() => focusTarget?.focus(), 30);
}

async function handlePrimary() {
    const step = _steps[_stepIndex];
    const primary = document.getElementById('onbPrimary');
    if (step === 'identity') {
        _draft.name = document.getElementById('onbName')?.value || '';
        _draft.phone = document.getElementById('onbPhone')?.value || '';
        const saved = saveIdentity(_draft.name, _draft.phone, { source: 'onboarding' });
        if (!saved.ok) {
            UI.showToast(saved.error, 'error');
            document.getElementById(document.getElementById('onbName')?.value?.trim() ? 'onbPhone' : 'onbName')?.focus();
            return;
        }
        UI.updateGreeting(saved.profile.name);
        nextStep();
        return;
    }
    if (step === 'notifications') {
        if (!hasIdentity()) {
            const identityIndex = _steps.indexOf('identity');
            if (identityIndex >= 0) { _stepIndex = identityIndex; renderOnboardingStep(); }
            UI.showToast('Add your mobile number first.', 'error');
            return;
        }
        const offers = document.getElementById('onbOffers')?.checked === true;
        primary.disabled = true;
        primary.textContent = 'Enabling...';
        const result = await subscribeToNotifications({
            name: _profile.name,
            phone: _profile.phone,
            prefs: { offers, orderUpdates: true },
            appMode: _mode
        });
        primary.disabled = false;
        setPrefs({ offers, orderUpdates: result.ok });
        if (result.ok) UI.showToast('Notifications enabled.', 'success');
        nextStep();
        return;
    }
    if (step === 'location') {
        finishOnboarding();
        const locOverlay = document.getElementById('locDialogOverlay');
        if (locOverlay) {
            locOverlay.classList.add('open');
        } else {
            document.querySelector('#locationBanner .loc-banner-btn')?.click();
        }
        return;
    }
    nextStep();
}

// ---------------------------------------------------------------
// Promotions tabs
// ---------------------------------------------------------------

function promoTabFromQuery() {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return ['offers', 'notifications', 'account'].includes(tab) ? tab : '';
}

function bindPromoTabs() {
    if (_tabsBound) return;
    const nav = document.querySelector('.promo-tabs');
    if (!nav) return;
    _tabsBound = true;
    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-promo-tab]');
        if (btn) setPromoTab(btn.dataset.promoTab);
    });
}

function setPromoTab(tab) {
    _activeTab = ['offers', 'notifications', 'account'].includes(tab) ? tab : 'offers';
    document.querySelectorAll('.promo-tab').forEach(btn => {
        const active = btn.dataset.promoTab === _activeTab;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
        btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    document.querySelectorAll('.promo-pane').forEach(pane => pane.classList.add('hidden'));
    document.getElementById(`promoPane${_activeTab[0].toUpperCase()}${_activeTab.slice(1)}`)?.classList.remove('hidden');
    if (_activeTab === 'notifications') markInboxSeen();
}

function seenKey() {
    return `fh_inbox_seen_${OUTLET}_${_profile?.phone || 'guest'}`;
}

function markInboxSeen() {
    try { localStorage.setItem(seenKey(), String(Date.now())); } catch (e) { /* ignore */ }
    document.getElementById('promoTabDot')?.classList.add('hidden');
}

function updateUnreadDot() {
    let seen = 0;
    try { seen = Number(localStorage.getItem(seenKey())) || 0; } catch (e) { /* ignore */ }
    const unread = _inbox.some(item => Number(item.sentAt) > seen);
    document.getElementById('promoTabDot')?.classList.toggle('hidden', !unread);
}

function notificationIcon(type) {
    if (type === 'order') return icon('bell');
    if (type === 'loyalty') return icon('spark');
    return icon('gift');
}

function formatDateHeader(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= today) return 'Today';
    if (d >= yesterday) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function itemHtml(item) {
    const when = formatWhen(item.sentAt);
    const orderId = item.orderId || '';
    const url = item.url || '';
    const unread = !item.readAt ? ' notif-unread' : '';
    const isOrder = item.type === 'order';
    return `<li class="notif-item${unread}" data-notif-id="${esc(item.id || '')}" data-order-id="${esc(orderId)}" data-url="${esc(url)}" data-type="${esc(item.type)}">
        <div class="notif-card ${isOrder ? 'notif-order' : ''}" role="button" tabindex="0">
            <span class="notif-icon">${notificationIcon(item.type)}</span>
            <div class="notif-body flex-1 min-w-0">
                <span class="notif-title">${esc(item.title || 'Update')}</span>
                <span class="notif-text">${esc(item.body || '')}</span>
            </div>
            <div class="notif-actions">
                <span class="notif-time">${esc(when)}</span>
                <button type="button" class="notif-delete" aria-label="Delete notification" data-notif-id="${esc(item.id || '')}">✕</button>
            </div>
        </div>
    </li>`;
}

function formatWhen(ts) {
    const value = Number(ts) || 0;
    if (!value) return '';
    const diff = Date.now() - value;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function renderInboxes() {
    const notifList = document.getElementById('notificationInboxList');
    const notifEmpty = document.getElementById('notificationEmpty');
    const notifHeader = document.getElementById('notificationInboxHeader');
    const notifActions = document.getElementById('notificationInboxActions');
    if (!notifList) return;

    let filtered = _inbox;
    if (_activeFilter === 'order') {
        filtered = _inbox.filter(item => item.type === 'order');
    } else if (_activeFilter === 'promo') {
        filtered = _inbox.filter(item => item.type === 'promo' || item.type === 'offer');
    }

    const unreadCount = filtered.filter(i => !i.readAt).length;

    // Show/hide header + actions based on filter
    if (notifHeader) notifHeader.style.display = filtered.length ? 'flex' : 'none';
    if (notifActions) notifActions.style.display = filtered.length ? 'flex' : 'none';
    const unreadBadge = document.getElementById('notificationUnreadBadge');
    if (unreadBadge) {
        unreadBadge.textContent = unreadCount;
        unreadBadge.style.display = unreadCount ? 'inline-flex' : 'none';
    }

    if (filtered.length === 0) {
        notifList.innerHTML = `<div class="notif-empty" role="status" aria-live="polite">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 16px; display:block; opacity:0.4;"><rect x="3" y="3" width="7" height="7"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M21 3v4a2 2 0 0 0-2 2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z"/></svg>
            <div class="promo-empty-title">No notifications yet</div>
            <div class="promo-empty-sub">Order updates and special offers will appear here.</div>
        </div>`;
        bindInboxClicks();
        updateUnreadDot();
        return;
    }

    // Build HTML with date group headers
    let html = '';
    let lastDate = null;
    for (const item of filtered) {
        const dateKey = formatDateHeader(item.sentAt);
        if (dateKey !== lastDate) {
            lastDate = dateKey;
            html += `<li class="notif-date-header">${esc(dateKey)}</li>`;
        }
        html += itemHtml(item);
    }
    notifList.innerHTML = html;

    bindInboxClicks();
    updateUnreadDot();
}

/** Mark all visible (filtered) notifications as read. */
async function markAllRead() {
    const filtered = _inbox.filter(i => !i.readAt);
    if (!filtered.length) return;
    const updates = {};
    for (const item of filtered) {
        updates[`pushInbox/${_profile.phone}/${item.id}/readAt`] = Date.now();
    }
    try {
        await update(outletRef(''), updates);
    } catch (e) { /* best-effort */ }
    _inbox = _inbox.map(i => (!i.readAt && filtered.includes(i)) ? { ...i, readAt: Date.now() } : i);
    renderInboxes();
}

/** Delete a single notification from RTDB and UI. */
async function deleteNotification(notifId) {
    if (!notifId) return;
    try {
        await update(outletRef(''), { [`pushInbox/${_profile.phone}/${notifId}`]: null });
    } catch (e) { /* best-effort */ }
    _inbox = _inbox.filter(i => i.id !== notifId);
    renderInboxes();
}

/* ---------- Promo code apply ---------- */
// Look up a coupon code in the Firebase-loaded offers cache.
// Returns the discount doc or null. Lazily loads discounts if the cache is empty.
async function getOfferByCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    if (!_offersCache || _offersCache.length === 0) {
        try {
            const snap = await get(outletRef('discounts'));
            const all = snap.val() || {};
            _offersCache = Object.entries(all)
                .filter(([, d]) => d && d.type === 'coupon' && d.couponCode && d.enabled !== false)
                .map(([id, d]) => ({ id, ...d }));
            _offersFetchedAt = Date.now();
        } catch (e) {
            console.error('[Promo] Failed to load discounts for code check:', e);
            _offersCache = [];
        }
    }
    return _offersCache.find(d => String(d.couponCode).toUpperCase() === normalized) || null;
}

document.getElementById('btnApplyPromoCode')?.addEventListener('click', async () => {
    const input = document.getElementById('promoCodeInput');
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (!code) {
        UI.showToast('Please enter a promo code', 'error');
        return;
    }
    // Validate against real Firebase discounts (client-side check; server re-verifies at checkout)
    const offer = await getOfferByCode(code);
    if (offer && couponStatus(offer, Date.now()) === 'valid' && discountAllowsChannel(offer, 'website') && offer.promoPage === true) {
        UI.showToast(`Code "${code}" saved. It will be used at checkout.`, 'success');
        input.value = '';
        // Store applied code in prefs for checkout to pick up
        try {
            const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            prefs.appliedPromoCode = code;
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch (e) { /* ignore */ }
        renderActiveOffers();
    } else {
        UI.showToast('Invalid or expired promo code', 'error');
    }
});

function bindInboxClicks() {
    if (_inboxBound) return;
    _inboxBound = true;
    document.querySelectorAll('.notif-inbox').forEach(list => {
        list.addEventListener('click', async (e) => {
            const card = e.target.closest('.notif-card');
            const deleteBtn = e.target.closest('.notif-delete');
            if (!card && !deleteBtn) return;

            // Delete button takes priority
            if (deleteBtn) {
                e.stopPropagation();
                const notifId = deleteBtn.getAttribute('data-notif-id');
                await deleteNotification(notifId);
                return;
            }

            const orderId = card.dataset.orderId;
            const url = card.dataset.url;
            const notifId = card.dataset.notifId;

            // Mark as read on click
            if (notifId && !card.classList.contains('notif-unread')) {
                // already read
            } else if (notifId) {
                try {
                    await update(outletRef(''), { [`pushInbox/${_profile.phone}/${notifId}/readAt`]: Date.now() });
                } catch { /* best-effort */ }
                card.classList.remove('notif-unread');
                updateUnreadDot();
            }

            if (orderId) {
                window.dispatchEvent(new CustomEvent('fh:open-order', { detail: { orderId } }));
            } else if (url) {
                window.location.href = url;
            }
        });
    });

    // Mark all as read button
    const markAllReadBtn = document.getElementById('btnMarkAllRead');
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await markAllRead();
        });
    }

    // Delete all button
    const deleteAllBtn = document.getElementById('btnDeleteAllRead');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const confirmed = await showConfirm('Delete all notifications? This cannot be undone.', 'Clear notifications');
            if (!confirmed) return;
            const ids = _inbox.map(i => i.id);
            for (const id of ids) {
                await update(outletRef(''), { [`pushInbox/${_profile.phone}/${id}`]: null }).catch(() => {});
            }
            _inbox = [];
            renderInboxes();
        });
    }

    // Bind filter chips
    bindFilterChips();
}

function bindFilterChips() {
    if (_filterChipsBound) return;
    _filterChipsBound = true;
    const filterContainer = document.querySelector('.promo-filter[role="tablist"]');
    if (!filterContainer) return;

    filterContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.promo-filter-chip[role="tab"]');
        if (chip) setFilterChip(chip.dataset.filter, chip);
    });

    // Keyboard navigation for filter chips
    filterContainer.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();

        const chips = filterContainer.querySelectorAll('.promo-filter-chip[role="tab"]');
        if (chips.length === 0) return;

        const currentIndex = Array.from(chips).indexOf(document.activeElement);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;
        switch (e.key) {
            case 'ArrowRight':
                nextIndex = (currentIndex + 1) % chips.length;
                break;
            case 'ArrowLeft':
                nextIndex = (currentIndex - 1 + chips.length) % chips.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = chips.length - 1;
                break;
        }

        if (nextIndex !== currentIndex) {
            chips[nextIndex].focus();
            chips[nextIndex].click();
        }
    });
}

function setFilterChip(filter, chip) {
    _activeFilter = filter;
    const filterContainer = document.querySelector('.promo-filter[role="tablist"]');
    if (!filterContainer) return;

    filterContainer.querySelectorAll('.promo-filter-chip[role="tab"]').forEach(c => {
        const active = c.dataset.filter === _activeFilter;
        c.classList.toggle('active', active);
        c.setAttribute('aria-selected', String(active));
        c.setAttribute('tabindex', active ? '0' : '-1');
    });

    // Update the inbox tabpanel's aria-labelledby
    const inboxList = document.getElementById('notificationInboxList');
    if (inboxList) {
        inboxList.setAttribute('aria-labelledby', chip.id);
    }

    renderInboxes();
}

async function loadInbox() {
    if (!hasIdentity()) {
        _inbox = [];
        renderInboxes();
        return;
    }
    try {
        const snap = await get(outletRef(`pushInbox/${_profile.phone}`));
        const value = snap.val() || {};
        _inbox = Object.entries(value)
            .map(([id, item]) => ({ id, ...(item || {}) }))
            .sort((a, b) => (Number(b.sentAt) || 0) - (Number(a.sentAt) || 0))
            .slice(0, 40);
        // Mark all loaded items as read (user has opened the inbox)
        const unreadIds = _inbox.filter(i => !i.readAt).map(i => i.id);
        if (unreadIds.length) {
            await markInboxRead(unreadIds);
            _inbox = _inbox.map(i => unreadIds.includes(i.id) ? { ...i, readAt: Date.now() } : i);
        }
    } catch (e) {
        _inbox = [];
    }
    renderInboxes();
}

/** Mark specific inbox items as read in RTDB (best-effort, never blocks UI). */
async function markInboxRead(ids) {
    const updates = {};
    for (const id of ids) {
        updates[`pushInbox/${_profile.phone}/${id}/readAt`] = Date.now();
    }
    try {
        await update(outletRef(''), updates);
    } catch (e) { /* best-effort only */ }
}

// ---------------------------------------------------------------
// Promotions cards + account
// ---------------------------------------------------------------

function renderPwaCards() {
    const installCard = document.getElementById('pwaInstallCard');
    const iosCard = document.getElementById('pwaIosCard');
    const notifyCard = document.getElementById('pwaNotifyCard');
    const installBtn = document.getElementById('btnPwaInstall');
    const notifyBtn = document.getElementById('btnPwaNotify');

    installCard?.classList.add('hidden');
    iosCard?.classList.add('hidden');
    notifyCard?.classList.add('hidden');

    if (!isIOS() && !isInstalled() && canShowNativeInstallPrompt() && installCard && installBtn) {
        installCard.classList.remove('hidden');
        installBtn.onclick = async () => {
            const outcome = await promptInstall();
            if (outcome === 'accepted') {
                UI.showToast('App installed.', 'success');
                installCard.classList.add('hidden');
                renderAccount();
            }
        };
    }

    if (isIOS() && !isStandalone() && iosCard) {
        iosCard.classList.remove('hidden');
    }

    const notificationsAvailable = isIOS() ? isStandalone() : true;
    if (!notificationsAvailable || !notifyCard || !notifyBtn) return;

    notifyCard.classList.remove('hidden');
    notifyCard.classList.add('sent');
    const permission = getNotificationPermission();
    const statusEl = notifyCard.querySelector('.pwa-card-sub');
    notifyBtn.style.display = '';

    if (permission === 'granted') {
        notifyBtn.style.display = 'none';
        if (statusEl) statusEl.textContent = 'Notifications are on for this device. Manage them in Account.';
    } else if (permission === 'denied') {
        notifyBtn.style.display = 'none';
        if (statusEl) statusEl.textContent = 'Notifications are blocked in your browser settings. Allow them, then reload.';
    } else {
        notifyCard.classList.remove('sent');
        if (statusEl) statusEl.textContent = 'Receive order status alerts and offers from this kitchen.';
        notifyBtn.onclick = async () => {
            if (!hasIdentity()) {
                setPromoTab('account');
                UI.showToast('Add your mobile number first.', 'error');
                document.getElementById('acctPhone')?.focus();
                return;
            }
            notifyBtn.disabled = true;
            notifyBtn.textContent = 'Enabling...';
            const result = await subscribeToNotifications({
                name: _profile.name,
                phone: _profile.phone,
                prefs: _prefs,
                appMode: _mode
            });
            notifyBtn.disabled = false;
            notifyBtn.textContent = 'Enable';
            if (result.ok) {
                setPrefs({ orderUpdates: true });
                UI.showToast('Notifications enabled.', 'success');
                renderPwaCards();
                renderAccount();
            } else {
                UI.showToast(result.error || 'Could not enable notifications.', 'error');
            }
        };
    }
}

// Installing from any surface (Android prompt, features page) must drop the
// install entry points here too - display-mode only flips on the next launch.
window.addEventListener('appinstalled', () => {
    renderPwaCards();
    if (document.getElementById('screenPromotions')?.classList.contains('active')) renderAccount();
});

let _confirmOverlay = null;
export function showConfirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
        if (_confirmOverlay) _confirmOverlay.remove();
        const overlay = document.createElement('div');
        overlay.className = 'fh-confirm-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);';
        const box = document.createElement('div');
        box.style.cssText = 'background:var(--card,#fff);color:var(--text,#0f172a);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:20px;min-width:280px;max-width:90vw;box-shadow:0 20px 40px rgba(15,23,42,.2);';
        overlay.appendChild(box);
        box.innerHTML = `<h3 style="margin:0 0 8px;font-size:15px;font-weight:800;">${esc(title)}</h3><p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:var(--text-sub,#64748b);">${esc(message)}</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="fh-confirm-cancel" style="padding:8px 16px;border-radius:10px;border:1px solid var(--border,#e2e8f0);background:transparent;color:var(--text,#0f172a);font-weight:700;cursor:pointer;">Cancel</button><button class="fh-confirm-ok" style="padding:8px 16px;border-radius:10px;border:none;background:var(--primary,#E84908);color:#fff;font-weight:700;cursor:pointer;">Forget everything</button></div>`;
        document.body.appendChild(overlay);
        _confirmOverlay = overlay;
        const cleanup = (val) => {
            overlay.style.transition = 'opacity .2s ease';
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); _confirmOverlay = null; resolve(val); }, 200);
        };
        box.querySelector('.fh-confirm-ok').onclick = () => cleanup(true);
        box.querySelector('.fh-confirm-cancel').onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
}

function renderAccount() {
    renderTabPanels();
    const card = document.getElementById('accountProfileCard');
    if (!card) return;

    const name = _profile?.name || '';
    const phone = _profile?.phone || '';
    const permission = getNotificationPermission();
    const initial = (name || 'G').charAt(0).toUpperCase();
    const installAvailable = !isInstalled() && (isIOS() || canShowNativeInstallPrompt());

    card.innerHTML = `
        <div class="account-card">
            <div class="account-avatar" aria-hidden="true">${esc(initial)}</div>
            <div class="account-id">
                <div class="account-name">${esc(name || 'Add your name')}</div>
                <div class="account-phone">${phone ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : 'No mobile number saved'}</div>
            </div>
        </div>
        <div class="account-form">
            <label class="onb-label" for="acctName">Name</label>
            <input class="onb-input" id="acctName" type="text" autocomplete="name" maxlength="60" placeholder="e.g. Rohan" value="${esc(name)}">
            <span class="acct-input-error" id="acctNameError"></span>
            <label class="onb-label" for="acctPhone">Mobile number</label>
            <div class="onb-phone">
                <span>+91</span>
                <input class="onb-input" id="acctPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="98765 43210" value="${esc(phone)}">
            </div>
            <span class="acct-input-error" id="acctPhoneError"></span>
            <button type="button" class="account-save" id="btnAcctSave">Save details</button>
        </div>
        <div class="account-card account-prefs">
            <label class="account-toggle">
                <span><strong>Order updates</strong><small>Confirmed, ready, out for delivery, delivered.</small></span>
                <input type="checkbox" id="acctUpdates" ${_prefs.orderUpdates && permission === 'granted' ? 'checked' : ''} ${permission === 'denied' ? 'disabled' : ''}>
            </label>
            <label class="account-toggle">
                <span><strong>Offers &amp; new menu</strong><small>Occasional deals and new dishes.</small></span>
                <input type="checkbox" id="acctOffers" ${_prefs.offers ? 'checked' : ''}>
            </label>
            <div class="account-status">${permission === 'granted' ? 'Notifications are on for this device.' : permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notifications are off for this device.'}</div>
        </div>
        ${installAvailable ? `<button type="button" class="account-install" id="btnAcctInstall">${isIOS() ? 'How to install this app' : 'Install this app'}</button>` : ''}
        <button type="button" class="account-clear" id="btnAcctClear">Forget me on this device</button>
        <p class="account-note">Your number is used for order updates and offers only. It is never shown publicly.</p>
        ${accessCardHtml()}
    `;

    bindAccountRatings();
    bindAccessCard();

    document.getElementById('btnAcctSave')?.addEventListener('click', async () => {
        const newName = document.getElementById('acctName')?.value || '';
        const newPhone = document.getElementById('acctPhone')?.value || '';
        const currentPhone = _profile?.phone || '';

        // Phone change warning: moving to a different number re-assigns points/orders.
        if (newPhone && newPhone.replace(/\D/g, '') !== currentPhone) {
            const confirmed = await showConfirm(
                'Changing your phone number will move your order history, loyalty points, ' +
                'and rank to the new number on this device. Any orders already placed ' +
                'under your old number will stay at that number on the restaurant side. ' +
                'Make sure you can receive messages on the new number before continuing.',
                'Change phone number?'
            );
            if (!confirmed) return;
        }

        const saveBtn = document.getElementById('btnAcctSave');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        // Clear previous inline errors
        const nameErrEl = document.getElementById('acctNameError');
        const phoneErrEl = document.getElementById('acctPhoneError');
        if (nameErrEl) nameErrEl.textContent = '';
        if (phoneErrEl) phoneErrEl.textContent = '';

        const saved = saveIdentity(
            newName,
            newPhone,
            { source: 'account' }
        );
        if (!saved.ok) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save details';
            // Show inline error under the relevant field
            const err = saved.error || '';
            const nameEl = document.getElementById('acctName');
            const phoneEl = document.getElementById('acctPhone');
            if (err.toLowerCase().includes('phone') || err.toLowerCase().includes('number')) {
                if (phoneErrEl) phoneErrEl.textContent = err;
                phoneEl?.focus();
            } else {
                if (nameErrEl) nameErrEl.textContent = err;
                nameEl?.focus();
            }
            return;
        }
        UI.updateGreeting(saved.profile.name);
        UI.showToast('Details saved.', 'success');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save details';
        renderAccount();
    });

    // Clear inline errors when user types
    const nameInput = document.getElementById('acctName');
    const phoneInput = document.getElementById('acctPhone');
    nameInput?.addEventListener('input', () => {
        const el = document.getElementById('acctNameError');
        if (el) el.textContent = '';
    });
    phoneInput?.addEventListener('input', (e) => {
        const el = document.getElementById('acctPhoneError');
        if (el) el.textContent = '';
        // Auto-format as XXXXX XXXXX
        const raw = e.target.value.replace(/\D/g, '');
        if (raw.length > 5) {
            e.target.value = raw.slice(0, 5) + ' ' + raw.slice(5, 10);
        } else {
            e.target.value = raw;
        }
    });

    document.getElementById('acctOffers')?.addEventListener('change', (e) => {
        setPrefs({ offers: e.target.checked });
        UI.showToast(e.target.checked ? 'Offers turned on.' : 'Offers turned off.', 'success');
    });

    document.getElementById('acctUpdates')?.addEventListener('change', async (e) => {
        const cb = e.target;
        if (!cb.checked) {
            setPrefs({ orderUpdates: false });
            return;
        }
        if (!hasIdentity()) {
            cb.checked = false;
            return UI.showToast('Save your mobile number first.', 'error');
        }
        cb.disabled = true;
        const result = await subscribeToNotifications({
            name: _profile.name,
            phone: _profile.phone,
            prefs: { ..._prefs, orderUpdates: true },
            appMode: _mode
        });
        cb.disabled = false;
        if (result.ok) {
            setPrefs({ orderUpdates: true });
            UI.showToast('Order updates enabled.', 'success');
        } else {
            cb.checked = false;
            UI.showToast(result.error || 'Could not enable notifications.', 'error');
        }
        renderAccount();
        renderPwaCards();
    });

    document.getElementById('btnAcctInstall')?.addEventListener('click', async () => {
        if (isIOS()) return UI.showToast('Tap Share, then Add to Home Screen.', 'success');
        const btn = document.getElementById('btnAcctInstall');
        btn.disabled = true;
        btn.textContent = 'Installing…';
        const outcome = await promptInstall();
        btn.disabled = false;
        btn.textContent = isIOS() ? 'How to install this app' : 'Install this app';
        if (outcome === 'accepted') UI.showToast('App installed.', 'success');
    });

    document.getElementById('btnAcctClear')?.addEventListener('click', async () => {
        const confirmed = await showConfirm(
            'This will permanently delete from this device: your name and phone number, ' +
            'your notification settings, your order history, your loyalty points and rank, ' +
            'and the link between this phone and your number. Orders placed at restaurants ' +
            'will remain in their records, but you will no longer see them here. ' +
            'This cannot be undone.',
            'Forget me on this device'
        );
        if (!confirmed) return;
        const clearBtn = document.getElementById('btnAcctClear');
        clearBtn.disabled = true;
        clearBtn.textContent = 'Forgetting…';
        await unsubscribeFromNotifications();
        try {
            localStorage.removeItem(PROFILE_KEY);
            localStorage.removeItem(PREFS_KEY);
            localStorage.removeItem(ONBOARDED_KEY);
            localStorage.removeItem(`fh_customer_phone`);
        } catch (e) { /* ignore */ }
        _profile = null;
        _prefs = { ...DEFAULT_PREFS };
        _inbox = [];
        if (_foregroundUnsub) { _foregroundUnsub(); _foregroundUnsub = null; }
        renderAccount();
        renderInboxes();
        renderPwaCards();
        UI.showToast('This device has been forgotten.', 'success');
    });
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------

export function initCustomer({ mode = 'dine-in' } = {}) {
    _mode = mode;
    if (!_initialized) {
        _prefs = readPrefs();
        _profile = readProfile();
        _initialized = true;
        ensureOnboardingDOM();
        bindPromoTabs();

        _foregroundUnsub = onForegroundMessage((payload) => {
            const data = payload.data || {};
            if (data.title || data.body) {
                UI.showToast(`${data.title || 'Update'}${data.body ? `: ${data.body}` : ''}`, 'success');
            }
            loadInbox();
        });
        hydrateProfile();
        if (_profile?.name) UI.updateGreeting(_profile.name);
    }
    return getProfile();
}

export function openNotificationsTab() {
    setPromoTab('notifications');
}

// ---------------------------------------------------------------
// Customer order history, loyalty and ratings
// ---------------------------------------------------------------

function customerStats() {
    const orders = _orders || [];
    const valid = orders.filter(o => o && o.status !== 'Cancelled' && o.status !== 'Refunded');
    const totalSpent = valid.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const points = loyaltyPoints();
    const tier = _loyalty && _loyalty.tier ? _loyalty.tier : currentTier();
    return { orders: orders.length, totalSpent, points, tier };
}

async function loadCustomerData() {
    if (!hasIdentity()) {
        _orders = [];
        _ratings = {};
        _loyalty = null;
        _customerRank = null;
        renderAccount();
        return;
    }
    // Every read below is device-bound (rules: auth.uid must be registered in
    // customers/{phone}/devices). A cold boot can land here — e.g. a deep link
    // straight to the Loyalty tab — before Firebase restores the anonymous
    // session, which denied the reads and showed 0 points (Redeem disabled)
    // until the tab was reopened. Wait for auth instead of trusting the race.
    try { await ensureAnonAuth(); } catch (e) { /* reads below fail soft */ }
    // The same race exists for a FIRST sign-in: syncProfile registers this
    // device without awaiting it, so join that (memoized) registration too or
    // orders/ratings/loyalty read as empty until the tab is reopened.
    await ensureDeviceAccess(_profile.phone);
    try {
        await loadLoyaltyConfig();
        await loadCustomerLoyalty();
        await computeCustomerRank();
        const [oSnap, rSnap] = await Promise.all([
            get(outletRef(`customers/${_profile.phone}/orders`)),
            get(outletRef(`customers/${_profile.phone}/ratings`))
        ]);
        const ordersRaw = oSnap.val() || {};
        _orders = Object.entries(ordersRaw)
            .map(([id, o]) => (o ? { id, ...o } : null))
            .filter(Boolean)
            .sort((a, b) => (Number(b.createdAt || 0) || 0) - (Number(a.createdAt || 0) || 0))
            .slice(0, 50);
        _ratings = rSnap.val() || {};
    } catch (e) {
        _orders = [];
        _ratings = {};
    }
    renderAccount();
}

// ── Loyalty config / customer record / rank ──────────────────────

const TIER_ORDER = ['bronze', 'silver', 'gold'];

const TIER_DISPLAY = {
    bronze: { label: 'Bronze', color: '#8a6d3b', bg: 'rgba(138,109,59,.12)', icon: '🥉' },
    silver: { label: 'Silver', color: '#a8a8a8', bg: 'rgba(168,168,168,.12)', icon: '🥈' },
    gold:   { label: 'Gold',   color: '#c5a005', bg: 'rgba(197,160,5,.12)', icon: '🥇' }
};

export async function loadLoyaltyConfig() {
    try {
        const snap = await get(outletRef('loyalty/config'));
        _loyaltyConfig = snap && snap.exists() ? snap.val() : null;
    } catch (e) {
        _loyaltyConfig = null;
    }
    if (!_loyaltyConfig) {
        _loyaltyConfig = {
            // Same default as the bot (bot/index.js): 5000 paise per point
            // = 1 point per ₹50 spent (~2% back). Admin can override via loyalty/config.
            earnRatePaisePerPoint: 5000,
            tiers: {
                bronze: { min: 0, label: 'Bronze', multiplier: 1 },
                silver: { min: 1000, label: 'Silver', multiplier: 1.25 },
                gold:   { min: 5000, label: 'Gold',   multiplier: 1.5 }
            },
            rewards: [
                { id: 'free-samosa', label: 'Free Samosa', cost: 200, type: 'item' },
                { id: '10pct-off',   label: '10% Off Next Order', cost: 500, type: 'discount' },
                { id: 'free-dessert',label: 'Free Dessert', cost: 800, type: 'item' }
            ]
        };
    }
}

async function loadCustomerLoyalty() {
    if (!hasIdentity()) { _loyalty = null; return; }
    try {
        const snap = await get(outletRef(`customers/${_profile.phone}/loyalty`));
        _loyalty = snap && snap.exists() ? snap.val() : null;
    } catch (e) {
        _loyalty = null;
    }
}

async function computeCustomerRank() {
    if (!hasIdentity() || !_loyaltyConfig) { _customerRank = null; return; }
    try {
        // Read ONLY our own entry — the leaderboard holds other customers'
        // phones and spend, so the rules never allow a bulk read. The bot
        // stores our rank in our own record.
        const snap = await get(outletRef(`loyalty/rankings/${_profile.phone}`));
        const mine = snap && snap.exists() ? snap.val() : null;
        _customerRank = mine && Number.isFinite(Number(mine.rank)) ? Number(mine.rank) : null;
    } catch (e) {
        _customerRank = null;
    }
}

function tierDisplay(tier) {
    return TIER_DISPLAY[tier] || TIER_DISPLAY.bronze;
}

function currentTier() {
    if (_loyalty && _loyalty.tier) return _loyalty.tier;
    if (_loyaltyConfig && _loyaltyConfig.tiers) {
        const pts = (_loyalty && _loyalty.lifetimePoints) || 0;
        let t = 'bronze';
        for (const name of TIER_ORDER) {
            const td = _loyaltyConfig.tiers[name];
            if (td && pts >= (td.min || 0)) t = name;
        }
        return t;
    }
    return 'bronze';
}

function loyaltyPoints() {
    if (!_loyalty) return 0;
    const lifetime = Number(_loyalty.lifetimePoints) || 0;
    const spent = Number(_loyalty.pointsSpent) || 0;
    // Same inactivity rule as the bot: lapsed points show as 0.
    const days = Number(_loyaltyConfig && _loyaltyConfig.expiryDays) || 0;
    const last = Number(_loyalty.lastOrderAt) || 0;
    if (days > 0 && last > 0 && Date.now() - last > days * 86400000) return 0;
    return Math.max(0, lifetime - spent);
}

function pointsToNextTier() {
    const tier = currentTier();
    const tiers = (_loyaltyConfig && _loyaltyConfig.tiers) || {};
    let next = null;
    for (const name of TIER_ORDER) {
        const td = tiers[name];
        if (td && td.min > (tiers[tier]?.min || 0)) { next = td; break; }
    }
    if (!next) return { reached: true, points: 0, needed: 0, pct: 100 };
    const pts = loyaltyPoints();
    const needed = next.min - pts;
    const curMin = tiers[tier]?.min || 0;
    const range = next.min - curMin;
    const pct = range > 0 ? Math.min(100, Math.floor(((pts - curMin) / range) * 100)) : 100;
    return { reached: false, points: Math.max(0, needed), needed: Math.max(0, needed), pct };
}

export function getLoyalty() {
    return {
        config: _loyaltyConfig ? { ..._loyaltyConfig } : null,
        loyalty: _loyalty ? { ..._loyalty } : null,
        rank: _customerRank,
        tier: currentTier(),
        points: loyaltyPoints(),
        nextTier: pointsToNextTier()
    };
}

// ── Reward-code redemption (R2, delivery checkout tender) ───────────────
// The customer app can READ its own issued codes (rules: read by phone) but
// can never write them — the bot validates + burns the code server-side when
// the order lands. This only gates the UI: finds an ACTIVE code matching the
// typed text and returns what the checkout needs. Null = not usable.
export async function validateRewardCode(code, phone) {
    const clean = String(code || '').trim().toUpperCase();
    const p = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!clean || !/^[6-9]\d{9}$/.test(p)) return null;
    try {
        const snap = await get(outletRef(`customers/${p}/rewards`));
        const rewards = (snap && snap.exists() && snap.val()) || {};
        for (const [key, r] of Object.entries(rewards)) {
            if (r && r.status === 'active' && String(r.code || '').toUpperCase() === clean) {
                return { key, rewardId: r.rewardId || '', label: r.label || '', cost: Number(r.cost) || 0, code: r.code };
            }
        }
    } catch (e) { /* read failure → treat as no code; bot re-validates anyway */ }
    return null;
}

// Active rewards this device can spend at checkout. Reads are device-bound
// (customers/{phone}/devices/{auth.uid}), so a phone typed into someone else's
// checkout returns nothing. Used by the app checkout as one-tap tender chips —
// the customer never types a code.
export async function listActiveRewards(phone) {
    const p = normalizePhone(phone);
    if (!p) return [];
    try {
        const snap = await get(outletRef(`customers/${p}/rewards`));
        const rewards = (snap && snap.exists() && snap.val()) || {};
        return Object.entries(rewards)
            .filter(([, r]) => r && r.status === 'active' && String(r.code || ''))
            .map(([key, r]) => ({
                key,
                code: String(r.code),
                rewardId: r.rewardId || '',
                label: r.label || 'Loyalty reward',
                cost: Number(r.cost) || 0
            }));
    } catch (e) { return []; }
}

// Configured redemption value of one point, in PAISE (R2). Same default the
// bot applies when loyalty/config lacks the field: ₹1 per point.
export function redeemValuePaisePerPoint() {
    const v = Number(_loyaltyConfig && _loyaltyConfig.redeemValuePaisePerPoint);
    return Number.isFinite(v) && v > 0 ? v : 100;
}

// R9: minimum spend AFTER redemption (₹) — 0 disables the floor.
export function minSpendAfterRedemptionRs() {
    return Number(_loyaltyConfig && _loyaltyConfig.minSpendAfterRedemption) || 0;
}

// R10: Zomato-style per-order cap — tender can never exceed this % of the
// order's subtotal. 0/absent = no cap (pre-R10 behavior).
export function maxRedeemPercentOfOrder() {
    const v = Number(_loyaltyConfig && _loyaltyConfig.maxRedeemPercentOfOrder);
    return Number.isFinite(v) && v > 0 ? v : 0;
}

export async function saveOrderRating(orderId, rating, comment = '') {
    if (!hasIdentity() || !orderId) return false;
    const cleanRating = Number(rating);
    if (!cleanRating || cleanRating < 1 || cleanRating > 5) return false;
    try {
        await set(outletRef(`customers/${_profile.phone}/ratings/${String(orderId)}`), {
            rating: cleanRating,
            orderId: String(orderId),
            outlet: OUTLET,
            business: BUSINESS_ID,
            comment: String(comment || '').slice(0, 500),
            createdAt: Date.now()
        });
        _ratings = _ratings || {};
        _ratings[String(orderId)] = { rating: cleanRating, comment: String(comment || ''), createdAt: Date.now() };
        return true;
    } catch (e) {
        return false;
    }
}

// Writes a placed order to the customer's own order history so it appears in
// the Account tab and feeds lifetime points / total spent. Fire-and-forget
// from order.js — must never reject the caller.
export async function writeCustomerOrder(order) {
    if (!order || !order.customerPhone || !order.orderId || !order.outlet) return false;
    const phone = String(order.customerPhone);
    try {
        if ((await ensureDeviceAccess(phone)) === 'taken') return false; // not this phone's number
        await set(outletRef(`customers/${phone}/orders/${String(order.orderId)}`), {
            orderId: String(order.orderId),
            outlet: order.outlet,
            business: order.business,
            customerPhone: phone,
            customerName: order.customerName || '',
            status: order.status || 'Placed',
            total: Number(order.total || 0),
            createdAt: Number(order.createdAt || Date.now()),
            source: order.source || 'QR',
            table: order.table || '',
            tableId: order.tableId || '',
            sessionId: order.sessionId || '',
            orderGroupId: order.orderGroupId || '',
            paymentStatus: order.paymentStatus || 'Pending',
            itemCount: order.itemCount || 0,
            itemsSummary: order.itemsSummary || [],
            ...(order.orderMode ? { orderMode: String(order.orderMode) } : {})
        });
        return true;
    } catch (e) {
        return false;
    }
}

// Resolves with the reward record once `pred(record)` is true. The bot writes
// 'rejected' or the final active record with the server-minted code.
function waitForReward(phone, reqKey, pred, ms = 15000) {
    return new Promise((resolve, reject) => {
        const r = outletRef(`customers/${phone}/rewards/${reqKey}`);
        let stop = null;
        const timer = setTimeout(() => { if (stop) stop(); reject(new Error('timeout')); }, ms);
        stop = onValue(r, (snap) => {
            if (!snap.exists()) return;
            const v = snap.val();
            if (!pred(v)) return;
            clearTimeout(timer);
            if (stop) stop();
            resolve(v);
        }, () => {
            clearTimeout(timer);
            if (stop) stop();
            reject(new Error('read failed'));
        });
    });
}

function orderItemNames(order) {
    const items = order.itemsSummary || [];
    if (!items.length) return `${order.itemCount || 0} item${order.itemCount !== 1 ? 's' : ''}`;
    return items.slice(0, 3).map(it => `${it.qty || 1}× ${esc(it.name || 'Item')}`).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '');
}

function orderTime(order) {
    const value = Number(order.createdAt || 0);
    if (!value) return '';
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function canRateOrder(order) {
    if (!order) return false;
    const status = String(order.status || '').toLowerCase();
    return (status === 'delivered' || status === 'served') && !_ratings[String(order.id)];
}

function starSvg(filled) {
    if (filled) {
        return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
}

function ratingStarsHtml(order) {
    const orderId = String(order.id || '');
    const rated = _ratings[orderId];
    if (rated) return `<span class="rating-chip">Rated ${starSvg(true)} ${rated.rating}</span>`;
    if (!canRateOrder(order)) return '';
    return `<div class="rating-stars" data-order-id="${esc(orderId)}">${[5, 4, 3, 2, 1].map(n => `<button type="button" class="rating-star" data-rating="${n}" aria-label="Rate ${n} stars">${starSvg(false)}</button>`).join('')}</div><button type="button" class="rating-save" data-order-id="${esc(orderId)}" style="display:none">Save</button>`;
}

function bindAccountRatings() {
    if (_ratingsDocBound) return;
    _ratingsDocBound = true;
    document.addEventListener('click', async (e) => {
        const viewBtn = e.target.closest('[data-orders-view]');
        if (viewBtn) {
            _ordersView = viewBtn.dataset.ordersView === 'payments' ? 'payments' : 'orders';
            renderTabPanels();
            return;
        }
        const star = e.target.closest('.rating-star');
        if (star) {
            const card = star.closest('[data-order-id]');
            if (!card) return;
            const orderId = card.dataset.orderId;
            const rating = Number(star.dataset.rating);
            _ratingPending = { orderId, rating };
            document.querySelectorAll('#accountOrdersList .rating-star').forEach((s) => {
                const c = s.closest('[data-order-id]');
                s.classList.toggle('active', c && c.dataset.orderId === orderId && Number(s.dataset.rating) <= rating);
            });
            const saveBtn = card.querySelector('.rating-save');
            if (saveBtn) saveBtn.style.display = '';
            return;
        }
        const saveBtn = e.target.closest('.rating-save');
        if (saveBtn) {
            const orderId = saveBtn.dataset.orderId;
            const rating = _ratingPending.orderId === orderId ? _ratingPending.rating : null;
            if (!rating) return;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            const ok = await saveOrderRating(orderId, rating);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            if (ok) UI.showToast('Rated ' + rating + ' ★', 'success');
            renderAccount();
            return;
        }
        const rewardBtn = e.target.closest('.reward-btn');
        if (rewardBtn) {
            if (rewardBtn.disabled) return;
            const rewardId = rewardBtn.dataset.rewardId;
            const reward = ((_loyaltyConfig && _loyaltyConfig.rewards) || []).find(r => r.id === rewardId);
            if (!reward) return;
            const pts = loyaltyPoints();
            if (pts < reward.cost) { UI.showToast('Not enough points.', 'error'); return; }

            const confirmed = await showConfirm(
                `Spend ${reward.cost} points for "${esc(reward.label)}"?`,
                'Redeem reward'
            );
            if (!confirmed) return;

            rewardBtn.disabled = true;
            rewardBtn.textContent = 'Redeeming…';
            try {
                // This device is registered under customers/{phone}/devices
                // (first phone wins). That binding is the proof the bot accepts,
                // so redemption needs no WhatsApp OTP and no typed code.
                if ((await ensureDeviceAccess(_profile.phone)) !== 'owner') throw new Error('device');
                const user = await ensureAnonAuth();
                const reqRef = push(outletRef('bot/redeemQueue'));
                await set(reqRef, {
                    phone: _profile.phone,
                    rewardId,
                    requestedAt: Date.now(),
                    outlet: OUTLET,
                    appUid: user.uid
                });
                // The bot is the only writer of a redemption (server-minted code,
                // points deducted); the reply lands on this request's own key.
                const rec = await waitForReward(_profile.phone, reqRef.key, v => v.status === 'active' || v.status === 'rejected', 20000);
                if (rec.status === 'rejected') throw new Error('rejected');
                await loadCustomerLoyalty();
                renderAccount();
                // The app applies rewards as checkout chips, so no code is ever
                // shown there. QR / WhatsApp surfaces still print it: dine-in has
                // no reward tender and staff honour it as a manual discount.
                const use = document.body.classList.contains('direct-mode')
                    ? 'use it at checkout'
                    : `code ${rec.code}`;
                UI.showToast(`Redeemed: ${rec.label || reward.label} — ${use}`, 'success');
            } catch (e) {
                UI.showToast(e && e.message === 'timeout'
                    ? 'Still processing — check Account in a minute.'
                    : e && e.message === 'device' ? 'Could not verify this phone. Check your connection and try again.'
                    : 'Redemption failed. Try again.', 'error');
            } finally {
                rewardBtn.disabled = false;
                rewardBtn.textContent = 'Redeem';
            }
            return;
        }
    });
}

function renderLoyaltyStrip() {
    const stats = customerStats();
    const tier = stats.tier;
    const disp = tierDisplay(tier);
    const next = pointsToNextTier();
    const hasIdentity = !!_profile?.phone;

    return `
    <div class="loyalty-strip">
        <div class="loyalty-tier">
            <span class="tier-badge" style="color:${disp.color};border-color:${disp.color}">
                ${disp.icon} ${disp.label}
            </span>
            <span class="tier-points">${stats.points} points</span>
        </div>
        <div class="loyalty-progress">
            <div class="progress-label">${disp.label}${next.reached ? ' — Max tier' : ' → ' + tierDisplay(next.reached ? tier : nextTierName(tier)).label}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${next.pct}%"></div></div>
            <span class="progress-needed">${next.reached ? 'You reached the top tier!' : next.points + ' points to next tier'}</span>
        </div>
        ${_loyaltyConfig ? `<div class="loyalty-earn"><span style="font-size:11px;color:var(--text-tertiary);">Earn 1 point per ₹${(_loyaltyConfig.earnRatePaisePerPoint/100).toFixed(0)} spent</span></div>` : ''}
        <div class="loyalty-stats">
            ${hasIdentity ? `<span>₹${stats.totalSpent} spent</span>` : ''}
            <span>${stats.orders} orders</span>
            ${_customerRank ? `<span>Rank #${_customerRank}</span>` : ''}
        </div>
    </div>`;
}

function nextTierName(current) {
    const idx = TIER_ORDER.indexOf(current);
    if (idx >= 0 && idx < TIER_ORDER.length - 1) return TIER_ORDER[idx + 1];
    return current;
}

function renderRankings() {
    if (!hasIdentity() || _customerRank === null) return '';
    return `
    <div class="rank-achievement">
        <span class="rank-badge">🏆 Rank #${_customerRank}</span>
        <p class="rank-sub">among regular customers at this kitchen</p>
    </div>`;
}

function renderRewards() {
    const rewards = (_loyaltyConfig && _loyaltyConfig.rewards) || [];
    const pts = loyaltyPoints();
    if (!rewards.length) return `
    <div class="account-section">
        <div class="account-section-head">Rewards</div>
        <div class="account-empty">No rewards available yet. Check back soon!</div>
    </div>`;
    const cards = rewards.map(r => {
        const affordable = pts >= r.cost;
        return `
        <div class="reward-card">
            <span class="reward-cost">${r.cost} pts</span>
            <span class="reward-label">${esc(r.label)}</span>
            <span class="reward-type">${esc(r.type || 'item')}</span>
            <button class="reward-btn" ${!affordable ? 'disabled' : ''} data-reward-id="${esc(r.id)}">
                ${affordable ? 'Redeem' : 'Not enough points'}
            </button>
        </div>`;
    }).join('');
    return `
    <div class="account-section">
        <div class="account-section-head">Rewards</div>
        <div class="rewards-grid">${cards}</div>
    </div>`;
}

// Live tracking for the dedicated app: steps differ for delivery and pickup.
const TRACK_DELIVERY = [['Placed', 'Placed'], ['Confirmed', 'Confirmed'], ['Ready', 'Ready'], ['Out for Delivery', 'On the way'], ['Delivered', 'Delivered']];
const TRACK_PICKUP = [['Placed', 'Placed'], ['Confirmed', 'Confirmed'], ['Ready', 'Ready'], ['Served', 'Collected']];
function trackLevel(order) {
    const s = String(order.status || 'Placed');
    if (order.orderMode === 'pickup') return Math.max(0, TRACK_PICKUP.findIndex(([k]) => k === s));
    if (s === 'Picked Up' || s === 'Arriving at Restaurant' || s === 'Arrived at Restaurant') return 2;
    if (s === 'Reached Drop Location') return 3;
    return Math.max(0, TRACK_DELIVERY.findIndex(([k]) => k === s));
}

function trackingHtml(order) {
    if (order.source !== 'APP') return '';
    const status = String(order.status || 'Placed');
    if (status === 'Cancelled') return '<div class="trk-cancelled">This order was cancelled.</div>';
    const steps = order.orderMode === 'pickup' ? TRACK_PICKUP : TRACK_DELIVERY;
    const at = trackLevel(order);
    const dots = steps.map(([, label], i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span></span>${esc(label)}</li>`).join('');
    const live = status === 'Out for Delivery' || status === 'Reached Drop Location';
    const rider = live && order.riderName
        ? `<div class="trk-rider">Your rider: <strong>${esc(order.riderName)}</strong>${order.riderPhone ? ` · <a href="tel:${esc(order.riderPhone)}">${esc(order.riderPhone)}</a>` : ''}</div>` : '';
    const otp = live && order.deliveryOtp
        ? `<div class="trk-otp">Delivery code <strong>${esc(order.deliveryOtp)}</strong><small>Tell this to the rider when your order arrives</small></div>` : '';
    const pickupReady = order.orderMode === 'pickup' && status === 'Ready'
        ? '<div class="trk-otp">Your order is ready — please collect it at the counter.</div>' : '';
    return `<ol class="trk-steps">${dots}</ol>${rider}${otp}${pickupReady}`;
}

function ordersListHtml() {
    const rows = _orders.map((order) => {
        const statusKey = String(order.status || 'Placed').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `
        <div class="account-order-card" data-order-id="${esc(String(order.id))}">
            <div class="account-order-head">
                <span class="account-order-id">Order ${esc(String(order.id))}</span>
                <span class="account-status-pill account-status-${statusKey}">${esc(order.status || 'Placed')}</span>
            </div>
            <div class="account-order-meta">
                <span class="account-order-time">${orderTime(order)}</span>
                <span class="account-order-total">${UI.fmtMoney(order.total || 0)}</span>
            </div>
            <div class="account-order-items">${esc(orderItemNames(order))}</div>
            ${trackingHtml(order)}
            <div class="account-order-actions">
                ${order.source === 'APP' && String(order.status) === 'Placed' ? `<button type="button" class="trk-cancel" data-cancel-order="${esc(String(order.id))}">Cancel order</button>` : ''}
                ${ratingStarsHtml(order)}
            </div>
        </div>`;
    }).join('');
    return rows;
}

// Loyalty card: tier strip, rank, rewards, headline stats.
function renderLoyaltyPanel() {
    if (_access.state === 'taken') return lockedPanelHtml();
    const stats = customerStats();
    if (!hasIdentity()) {
        return `<div class="account-empty">Save your mobile number to see order history, loyalty points and ratings for this kitchen.</div>`;
    }
    return renderLoyaltyStrip() + renderRankings() + renderRewards() + `
    <div class="account-stats">
        <div class="stat"><div class="stat-value">${UI.fmtMoney(stats.totalSpent)}</div><div class="stat-label">Total spent</div></div>
        <div class="stat"><div class="stat-value">${stats.orders}</div><div class="stat-label">Orders</div></div>
        <div class="stat"><div class="stat-value">${stats.points}</div><div class="stat-label">Loyalty points</div></div>
    </div>`;
}

// Order history: every order placed with this phone number at this kitchen.
function renderOrdersPanel() {
    if (_access.state === 'taken') return lockedPanelHtml();
    if (!hasIdentity()) {
        return `<div class="account-empty">Save your mobile number to see your order history for this kitchen.</div>`;
    }
    if (!_orders || _orders.length === 0) {
        return `<div class="account-empty">No orders yet. Order from the menu to build your history.</div>`;
    }
    return `<div class="account-section">
        <div class="account-section-head">Your Orders at this kitchen <span class="account-section-count">(${_orders.length})</span></div>
        <div id="accountOrdersList" class="account-orders">${ordersListHtml()}</div>
    </div>`;
}

function renderCustomerStatsAndHistory() {
    // Dedicated app: Orders and Loyalty have their own tabs; Account stays profile-only.
    if (document.body.classList.contains('direct-mode')) return '';
    return renderLoyaltyPanel() + renderOrdersPanel();
}

// ── Payment history ────────────────────────────────────────────────
// Reads the payment fields the bot mirrors onto customers/{phone}/orders/{id}
// (bot/payment-sync.js). This is a payment record, not a tax invoice.
let _ordersView = 'orders'; // 'orders' | 'payments'

function paymentState(order) {
    const status = String(order.status || '');
    const pay = String(order.paymentStatus || 'Pending');
    if (status === 'Cancelled') return { key: 'void', label: 'No charge' };
    if (pay === 'Refunded' || status === 'Refunded') return { key: 'refunded', label: 'Refunded' };
    if (pay === 'Paid') return { key: 'paid', label: 'Paid' };
    const delivery = String(order.source || '') === 'webview_delivery' || /deliver/i.test(String(order.type || ''));
    return { key: 'pending', label: delivery ? 'Pay on delivery' : 'Payment pending' };
}

function whenText(ms) {
    const v = Number(ms || 0);
    return v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

function renderPaymentsPanel() {
    if (_access.state === 'taken') return lockedPanelHtml();
    if (!hasIdentity()) {
        return `<div class="account-empty">Save your mobile number to see your payment history for this kitchen.</div>`;
    }
    if (!_orders || _orders.length === 0) {
        return `<div class="account-empty">No payments yet. Your payments will appear here after you order.</div>`;
    }
    let paid = 0, pending = 0;
    const rows = _orders.map((o) => {
        const st = paymentState(o);
        const amount = Number(o.total) || 0;
        if (st.key === 'paid') paid += amount;
        if (st.key === 'pending') pending += amount;
        const method = o.paymentMethod ? esc(String(o.paymentMethod)) : '';
        return `
        <details class="pay-row pay-${st.key}" data-order-id="${esc(String(o.id))}">
            <summary>
                <span class="pay-main"><strong>Order ${esc(String(o.id))}</strong><small>${esc(orderTime(o))}</small></span>
                <span class="pay-amt">${UI.fmtMoney(amount)}<small class="pay-pill pay-pill-${st.key}">${esc(st.label)}${st.key === 'paid' && method ? ' · ' + method : ''}</small></span>
            </summary>
            <div class="pay-detail">
                <div><span>Items</span><span>${esc(orderItemNames(o))}</span></div>
                <div><span>Order status</span><span>${esc(o.status || 'Placed')}</span></div>
                <div><span>Payment</span><span>${esc(st.label)}${method ? ' · ' + method : ''}</span></div>
                ${o.paidAt ? `<div><span>Paid on</span><span>${esc(whenText(o.paidAt))}</span></div>` : ''}
                ${o.table ? `<div><span>Table</span><span>${esc(String(o.table))}</span></div>` : ''}
                <div><span>Amount</span><span>${UI.fmtMoney(amount)}</span></div>
            </div>
        </details>`;
    }).join('');
    return `
    <div class="account-stats">
        <div class="stat"><div class="stat-value">${UI.fmtMoney(paid)}</div><div class="stat-label">Paid</div></div>
        <div class="stat"><div class="stat-value">${UI.fmtMoney(pending)}</div><div class="stat-label">To pay</div></div>
    </div>
    <div class="account-section">
        <div class="account-section-head">Payment history</div>
        <div id="paymentsList" class="pay-list">${rows}</div>
        <p class="pay-note">This is a payment record for your reference, not a tax invoice.</p>
    </div>`;
}

// Bottom-tab screens of the dedicated app (direct mode): Orders and Loyalty.
function renderTabPanels() {
    const o = document.getElementById('ordersScreenBody');
    document.querySelectorAll('[data-orders-view]').forEach(b => b.classList.toggle('active', b.dataset.ordersView === _ordersView));
    if (o) o.innerHTML = _ordersView === 'payments' ? renderPaymentsPanel() : renderOrdersPanel();
    const l = document.getElementById('loyaltyScreenBody');
    if (l) l.innerHTML = renderLoyaltyPanel();
}

export async function renderOrdersTab() { await loadCustomerData(); }
export async function renderLoyaltyTab() { await loadCustomerData(); }
export function openAccountTab() { setPromoTab('account'); }

export async function renderCustomerPromotions(store, mode = 'dine-in') {
    _mode = mode;
    bindPromoTabs();
    // Social / URL cards. Owned here (not by each page entry) so no caller can
    // forget it: app.js and delivery.js both funnel through this function.
    UI.renderPromotionsLinks(store);
    renderPromoCards(store);
    renderActiveOffers();
    renderPwaCards();
    renderAccount();
    loadInbox();
    const queryTab = promoTabFromQuery();
    setPromoTab(queryTab || _activeTab);
    await loadCustomerData();
}

/* ---------- Promo cards (active offers customers can use) ---------- */
function renderPromoCards(store) {
    const wrap = document.getElementById('promoCardsContainer');
    if (!wrap) return;
    const s = store || {};

    // Social links as "Connect with us"
    const links = [
        { key: 'google', title: 'Rate us on Google', sub: 'Leave a review — it helps a lot!', url: s.googleReviewLink, cls: 'promo-link-google',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5L18 21l-6-4.4L6 21l2.2-7.1L2 9.4h7.6z"/></svg>' },
        { key: 'instagram', title: 'Follow on Instagram', sub: 'See our latest dishes & offers', url: buildInstagramUrl(s.instagram), cls: 'promo-link-instagram',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>' },
        { key: 'facebook', title: 'Like us on Facebook', sub: 'Stay updated with news & events', url: s.facebook, cls: 'promo-link-facebook',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 2h-3a5 5 0 0 0-5 5v3H6v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>' },
        { key: 'whatsapp', title: 'Chat on WhatsApp', sub: 'Questions or feedback? Message us', url: buildWhatsappUrl(s.whatsappNumber, s.storeName), cls: 'promo-link-whatsapp',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 2.1 17.6L1 23l5.5-1.4A11 11 0 1 0 20.5 3.5zM12 20.9a9 9 0 0 1-4.6-1.3l-.3-.2-3.4.9.9-3.3-.2-.3A9 9 0 1 1 12 20.9z"/></svg>' }
    ].filter(l => l.url);

    const linksHtml = links.length
        ? links.map(l => `
            <a class="promo-link-card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(l.title)} — opens in new window">
                <span class="promo-link-icon ${l.cls}">${l.icon}</span>
                <span class="promo-link-body">
                    <span class="promo-link-title">${esc(l.title)}</span>
                    <span class="promo-link-sub">${esc(l.sub)}</span>
                </span>
                <svg class="promo-link-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
            </a>`).join('')
        : `<div class="promotions-empty">No social links configured yet.</div>`;

    wrap.innerHTML = `
        <div class="promo-section-label">Connect with us</div>
        ${linksHtml}
        <div class="promo-divider"></div>
        <div class="promo-section-label">Active Offers</div>
        <div class="promo-grid" id="activeOffersGrid"></div>
        <div id="promoCodesEmpty" class="promotions-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 16px; display:block; opacity:0.4;"><rect x="3" y="3" width="7" height="7"/><circle cx="12" cy="9" r="2"/></svg>
            <div class="promo-empty-title">No active offers</div>
            <div class="promo-empty-sub">Check back soon for discounts and special deals from this kitchen.</div>
        </div>
    `;

    renderActiveOffers();
}

/* ---------- Active offers (coupon codes customers can use) ---------- */
let _offersCache = null;
let _offersFetchedAt = 0;
const OFFERS_CACHE_TTL_MS = 60_000;

async function renderActiveOffers() {
    const grid = document.getElementById('activeOffersGrid');
    // Static markup calls this #promoCardsEmpty; #promoCodesEmpty was only ever
    // emitted by the (inert) renderPromoCards(), so the empty state used to
    // stay visible underneath a grid that had offers in it.
    const empty = document.getElementById('promoCardsEmpty');
    if (!grid) return;

    // Read currently applied code from prefs
    let appliedCode = '';
    try {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || {});
        appliedCode = prefs.appliedPromoCode || '';
    } catch { /* ignore */ }

    // Fetch real coupon discounts configured by the restaurant admin.
    // Only coupon-type, enabled, valid-now, website-channel, promoPage-flagged
    // discounts appear on the customer Promo Page.
    const now = Date.now();
    let offers = [];
    if (_offersCache && (now - _offersFetchedAt) < OFFERS_CACHE_TTL_MS) {
        offers = _offersCache;
    } else {
        try {
            const snap = await get(outletRef('discounts'));
            const all = snap.val() || {};
            offers = Object.entries(all)
                .filter(([, d]) => d && d.type === 'coupon' && d.couponCode && d.enabled !== false)
                .map(([id, d]) => ({ id, ...d }))
                .filter(d => couponStatus(d, now) === 'valid')
                .filter(d => discountAllowsChannel(d, 'website'))
                .filter(d => d.promoPage === true)
                .sort((a, b) => (Number(b.updatedAt || 0) || 0) - (Number(a.updatedAt || 0) || 0));
            _offersCache = offers;
            _offersFetchedAt = now;
        } catch (e) {
            console.error('[Promo] Failed to load discounts:', e);
            offers = _offersCache || [];
        }
    }

    if (offers.length === 0) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    const cards = offers.map(o => {
        const isApplied = o.couponCode === appliedCode;
        const codeEsc = esc(o.couponCode);
        const titleEsc = esc(o.name || o.couponCode);
        const subtitleEsc = esc(o.subtitle || '');
        const descEsc = esc(o.description || o.desc || '');
        const validEsc = esc(o.valid || '');

        let actionsHtml;
        if (isApplied) {
            actionsHtml = `<button type="button" class="promo-btn-remove" data-code="${codeEsc}" aria-label="Remove ${codeEsc}">Remove</button>`;
        } else {
            actionsHtml = `<button type="button" class="promo-btn-copy" data-code="${codeEsc}">Copy Code</button><button type="button" class="promo-btn-apply" data-code="${codeEsc}">Apply</button>`;
        }

        const badgeHtml = isApplied
            ? `<span class="promo-card-badge applied">${codeEsc}</span><span class="promo-card-badge applied">Applied</span>`
            : `<span class="promo-card-badge promo-card-badge-${o.variant || 'generic'}">${codeEsc}</span>`;
        const urgencyHtml = o.daysLeft && o.daysLeft <= 7
            ? `<span class="promo-card-urgency">${o.daysLeft} days left</span>`
            : '';

        // Value in rupees: points * redeemValuePaisePerPoint / 100. Sample offers
        // carry no cost, and a printed "₹0.00" reads as a broken price — so the
        // amount renders only when there really is one.
        const redeemValuePaise = redeemValuePaisePerPoint();
        const valueRs = o.cost ? (o.cost * redeemValuePaise / 100).toFixed(2) : '';

        return `<div class="promo-card ${isApplied ? 'promo-card--applied' : ''}" role="button" tabindex="0" aria-label="${titleEsc}, ${descEsc}">
            <span class="promo-card-icon">${o.emoji || '🎁'}</span>
            <div class="promo-card-body">
                <div class="promo-card-top">${badgeHtml}</div>
                <div class="promo-card-title">${titleEsc}</div>
                <div class="promo-card-sub">${subtitleEsc}${valueRs ? ` <span class="promo-card-value">₹${valueRs}</span>` : ''}</div>
                <div class="promo-card-terms">${descEsc} · ${validEsc}${urgencyHtml}</div>
            </div>
            <div class="promo-card-actions">${actionsHtml}</div>
        </div>`;
    });

    grid.innerHTML = cards.join('');

    // Render redeemed reward history below active offers
    renderRewardsHistory();

    // #activeOffersGrid survives between renders, so this must bind once —
    // otherwise every re-open stacks another handler and Enter applies the code
    // once per visit.
    if (!grid.dataset.kbdBound) {
        grid.dataset.kbdBound = '1';
        grid.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const card = e.target.closest('.promo-card');
            if (!card) return;
            const applyBtn = card.querySelector('.promo-btn-apply');
            if (applyBtn) applyBtn.click();
        });
    }

    grid.querySelectorAll('.promo-btn-copy').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const code = btn.dataset.code;
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                await navigator.clipboard.writeText(code);
                UI.showToast(`Code "${code}" copied`, 'success');
            } catch (err) {
                UI.showToast('Copy failed', 'error');
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });
    });

    grid.querySelectorAll('.promo-btn-apply').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const code = btn.dataset.code;
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const input = document.getElementById('promoCodeInput');
                if (input) {
                    input.value = code;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                // Stay on promos tab but show the code is ready to apply
                UI.showToast(`Code "${code}" ready to apply at checkout`, 'info');
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });
    });

    grid.querySelectorAll('.promo-btn-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const code = btn.dataset.code;
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const input = document.getElementById('promoCodeInput');
                if (input && input.value === code) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                // Clear applied code from prefs
                try {
                    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || {});
                    prefs.appliedPromoCode = '';
                    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
                } catch { /* ignore */ }
                UI.showToast(`Code "${code}" removed`, 'success');
                renderActiveOffers();
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });
    });
}

/* Render redeemed reward history */
async function renderRewardsHistory() {
    const panel = document.getElementById('promoHistory');
    if (!panel) return;
    if (!hasIdentity()) {
        panel.innerHTML = '';
        return;
    }
    try {
        // Device-bound read. Sign-in registers this device fire-and-forget
        // (saveIdentity → syncProfile → ensureDeviceAccess), so the first
        // render can beat the registration write and get a PERMISSION_DENIED
        // that never refreshes ("Unable to load reward history." until the
        // pane is re-entered). Join the memoized registration first.
        await ensureDeviceAccess(_profile.phone);
        const snap = await get(outletRef(`customers/${_profile.phone}/rewards`));
        const rewards = (snap && snap.exists() && snap.val()) || {};
        const redeemed = Object.entries(rewards)
            .filter(([, r]) => r && r.status === 'redeemed')
            .map(([key, r]) => ({
                key,
                rewardId: r.rewardId || '',
                label: r.label || 'Loyalty reward',
                cost: Number(r.cost) || 0,
                code: r.code || '',
                redeemedAt: Number(r.redeemedAt || 0)
            }))
            .sort((a, b) => (b.redeemedAt || 0) - (a.redeemedAt || 0));
        if (!redeemed.length) {
            panel.innerHTML = '<div class="promo-empty"><div class="promo-empty-title">No redemptions yet</div><div class="promo-empty-sub">Redeem your first reward to see it here.</div></div>';
            return;
        }
        const rows = redeemed.map(r => {
            const when = formatWhen(r.redeemedAt);
            return '<div class="history-row">' +
                '<span class="history-time">' + esc(when) + '</span>' +
                '<span class="history-detail">' + esc(r.label) + '</span>' +
                '<span class="history-pts">-' + Number(r.cost) + ' pts</span>' +
                '</div>';
        }).join('');
        panel.innerHTML =
            '<div class="promo-section-label">Redeemed rewards</div>' +
            '<div class="promo-history">' + rows + '</div>';
    } catch (e) {
        panel.innerHTML = '<div class="promo-empty">Unable to load reward history.</div>';
    }
}

/* Promo code input keyup handler — validates against real Firebase discounts */
document.getElementById('promoCodeInput')?.addEventListener('input', async (e) => {
    const code = e.target.value.trim().toUpperCase();
    const input = document.getElementById('promoCodeInput');
    const applyBtn = document.getElementById('btnApplyPromoCode');
    if (!code) {
        input.classList.remove('promo-input-error');
        applyBtn?.classList.remove('promo-input-error');
        return;
    }
    const offer = await getOfferByCode(code);
    const isValid = offer && couponStatus(offer, Date.now()) === 'valid' && discountAllowsChannel(offer, 'website') && offer.promoPage === true;
    if (isValid) {
        input.classList.remove('promo-input-error');
        applyBtn?.classList.remove('promo-input-error');
    } else {
        input.classList.add('promo-input-error');
        applyBtn?.classList.add('promo-input-error');
    }
});
