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
import { outletRef, get, set, OUTLET, BUSINESS_ID } from './firebase.js';
import * as UI from './ui.js';
import { esc } from './ui.js';
import {
    isIOS, isStandalone, canShowNativeInstallPrompt, promptInstall,
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
let _foregroundUnsub = null;
let _onboardingBound = false;
let _steps = [];
let _stepIndex = 0;
let _draft = { name: '', phone: '' };
let _orders = [];
let _ratings = {};
let _ratingsDocBound = false;
let _ratingPending = { orderId: null, rating: null };
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
    if (type === 'location') return icon('pin');
    return icon('gift');
}

function itemHtml(item) {
    const when = formatWhen(item.sentAt);
    const orderId = item.orderId || '';
    const url = item.url || '';
    return `<button type="button" class="notif-card ${item.type === 'order' ? 'notif-order' : ''}" data-order-id="${esc(orderId)}" data-url="${esc(url)}">
        <span class="notif-icon">${notificationIcon(item.type)}</span>
        <span class="notif-body">
            <span class="notif-title">${esc(item.title || 'Update')}</span>
            <span class="notif-text">${esc(item.body || '')}</span>
            <span class="notif-time">${esc(when)}</span>
        </span>
    </button>`;
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
    const offerList = document.getElementById('offersInboxList');
    const notifList = document.getElementById('notificationInboxList');
    const offers = _inbox.filter(item => item.type !== 'order');
    if (offerList) {
        offerList.classList.toggle('hidden', offers.length === 0);
        offerList.innerHTML = offers.map(itemHtml).join('');
    }
    if (notifList) {
        notifList.innerHTML = _inbox.length
            ? _inbox.map(itemHtml).join('')
            : `<div class="notif-empty">No updates yet. Order something delicious and we'll keep you posted.</div>`;
    }
    bindInboxClicks();
    updateUnreadDot();
}

function bindInboxClicks() {
    if (_inboxBound) return;
    _inboxBound = true;
    document.querySelectorAll('.notif-inbox').forEach(list => {
        list.addEventListener('click', (e) => {
            const card = e.target.closest('.notif-card');
            if (!card) return;
            const orderId = card.dataset.orderId;
            const url = card.dataset.url;
            if (orderId) {
                window.dispatchEvent(new CustomEvent('fh:open-order', { detail: { orderId } }));
            } else if (url) {
                window.location.href = url;
            }
        });
    });
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
    } catch (e) {
        _inbox = [];
    }
    renderInboxes();
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

    if (!isIOS() && !isStandalone() && canShowNativeInstallPrompt() && installCard && installBtn) {
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

function renderAccount() {
    const card = document.getElementById('accountProfileCard');
    if (!card) return;

    const name = _profile?.name || '';
    const phone = _profile?.phone || '';
    const permission = getNotificationPermission();
    const initial = (name || 'G').charAt(0).toUpperCase();
    const installAvailable = !isStandalone() && (isIOS() || canShowNativeInstallPrompt());

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
            <label class="onb-label" for="acctPhone">Mobile number</label>
            <div class="onb-phone">
                <span>+91</span>
                <input class="onb-input" id="acctPhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="98765 43210" value="${esc(phone)}">
            </div>
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
        ${renderCustomerStatsAndHistory()}
    `;

    bindAccountRatings();

    document.getElementById('btnAcctSave')?.addEventListener('click', () => {
        const saved = saveIdentity(
            document.getElementById('acctName')?.value || '',
            document.getElementById('acctPhone')?.value || '',
            { source: 'account' }
        );
        if (!saved.ok) return UI.showToast(saved.error, 'error');
        UI.updateGreeting(saved.profile.name);
        UI.showToast('Details saved.', 'success');
        renderAccount();
    });

    document.getElementById('acctOffers')?.addEventListener('change', (e) => {
        setPrefs({ offers: e.target.checked });
        UI.showToast(e.target.checked ? 'Offers turned on.' : 'Offers turned off.', 'success');
    });

    document.getElementById('acctUpdates')?.addEventListener('change', async (e) => {
        if (!e.target.checked) {
            setPrefs({ orderUpdates: false });
            return;
        }
        if (!hasIdentity()) {
            e.target.checked = false;
            return UI.showToast('Save your mobile number first.', 'error');
        }
        const result = await subscribeToNotifications({
            name: _profile.name,
            phone: _profile.phone,
            prefs: { ..._prefs, orderUpdates: true },
            appMode: _mode
        });
        if (result.ok) {
            setPrefs({ orderUpdates: true });
            UI.showToast('Order updates enabled.', 'success');
        } else {
            e.target.checked = false;
            UI.showToast(result.error || 'Could not enable notifications.', 'error');
        }
        renderAccount();
        renderPwaCards();
    });

    document.getElementById('btnAcctInstall')?.addEventListener('click', async () => {
        if (isIOS()) return UI.showToast('Tap Share, then Add to Home Screen.', 'success');
        const outcome = await promptInstall();
        if (outcome === 'accepted') UI.showToast('App installed.', 'success');
    });

    document.getElementById('btnAcctClear')?.addEventListener('click', async () => {
        if (!window.confirm('Forget your name, number, and notification settings on this device?')) return;
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
    const points = Math.floor(totalSpent / 100); // 1 loyalty point per ₹100 spent
    return { orders: orders.length, totalSpent, points };
}

async function loadCustomerData() {
    if (!hasIdentity()) {
        _orders = [];
        _ratings = {};
        renderAccount();
        return;
    }
    try {
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

function ratingStarsHtml(order) {
    const orderId = String(order.id || '');
    const rated = _ratings[orderId];
    if (rated) return `<span class="rating-chip">Rated ★${rated.rating}</span>`;
    if (!canRateOrder(order)) return '';
    return `<div class="rating-stars" data-order-id="${esc(orderId)}">${[5, 4, 3, 2, 1].map(n => `<button type="button" class="rating-star" data-rating="${n}" aria-label="Rate ${n} stars">${n === 5 ? '★' : '☆'}</button>`).join('')}</div><button type="button" class="rating-save" data-order-id="${esc(orderId)}" style="display:none">Save</button>`;
}

function bindAccountRatings() {
    if (_ratingsDocBound) return;
    _ratingsDocBound = true;
    document.addEventListener('click', async (e) => {
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
    });
}

function renderCustomerStatsAndHistory() {
    const stats = customerStats();
    if (!hasIdentity()) {
        return `<div class="account-empty">Save your mobile number to see order history, loyalty points and ratings for this kitchen.</div>`;
    }
    if (stats.orders === 0) {
        return `<div class="account-empty">No orders yet. Order from the menu to build your history.</div>`;
    }
    const rows = _orders.map((order) => {
        const statusKey = String(order.status || 'Placed').toLowerCase();
        const rated = _ratings[String(order.id)];
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
            <div class="account-order-actions">
                ${ratingStarsHtml(order)}
            </div>
        </div>`;
    }).join('');
    return `
    <div class="account-stats">
        <div class="stat"><div class="stat-value">${UI.fmtMoney(stats.totalSpent)}</div><div class="stat-label">Total spent</div></div>
        <div class="stat"><div class="stat-value">${stats.orders}</div><div class="stat-label">Orders</div></div>
        <div class="stat"><div class="stat-value">${stats.points}</div><div class="stat-label">Loyalty points</div></div>
    </div>
    <div class="account-section">
        <div class="account-section-head">Your Orders at this kitchen <span class="account-section-count">(${stats.orders})</span></div>
        <div id="accountOrdersList" class="account-orders">${rows}</div>
    </div>`;
}

export async function renderCustomerPromotions(store, mode = 'dine-in') {
    _mode = mode;
    bindPromoTabs();
    renderPwaCards();
    renderAccount();
    loadInbox();
    const queryTab = promoTabFromQuery();
    setPromoTab(queryTab || _activeTab);
    await loadCustomerData();
}
