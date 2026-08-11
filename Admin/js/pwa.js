/**
 * ROSHANI ERP | PWA & SYSTEM
 * Handles service worker, installation prompt, and refresh circuit breaker.
 */

import { showConfirm, showToast } from './ui-utils.js';
import { state } from './state.js';

// 1. REFRESH CIRCUIT BREAKER & COMPLETE REFRESH
export const completeSiteRefresh = async () => {
    const ok = await showConfirm(
        "This will purge all local caches, unregister the app, and reset UI states. You will NOT be logged out. Are you sure?",
        "⚠️ Nuclear Refresh"
    );
    
    if (!ok) return;

    showToast("Initializing Nuclear Refresh...", "warning");
    
    try {
        // 1. Unregister all service workers with timeout
        if ('serviceWorker' in navigator) {
            const swPromise = navigator.serviceWorker.getRegistrations().then(async registrations => {
                for (let registration of registrations) {
                    await registration.unregister();
                }
            });
            await Promise.race([swPromise, new Promise(res => setTimeout(res, 2000))]);
        }

        // 2. Clear App-Specific Caches (Optimized)
        if ('caches' in window) {
            const keys = await caches.keys();
            const appKeys = keys.filter(key => key.includes('roshani-erp') || key.includes('pizza-erp'));
            await Promise.all(appKeys.map(key => caches.delete(key)));
        }

        // 3. Selective Storage Wipe (Preserve Auth)
        sessionStorage.clear();
        Object.keys(localStorage).forEach(key => {
            if (!key.startsWith('firebase:')) {
                localStorage.removeItem(key);
            }
        });
        
        console.log("[PWA] Nuclear Purge Complete.");
        showToast("System Purged. Reloading...", "success");

        // Force a reload with robust cache-busting
        setTimeout(() => {
            const cleanUrl = window.location.origin + window.location.pathname;
            window.location.href = `${cleanUrl}?v=${Date.now()}&sync=${Math.random().toString(36).substring(7)}`;
        }, 1000);

    } catch (err) {
        console.error("Refresh failed:", err);
        window.location.reload();
    }
};

/**
 * DOUBLE-REFRESH DETECTION & AUTO-PURGE
 * Triggers a nuclear purge if the user refreshes twice within 5 seconds.
 */
(async function () {
    const now = Date.now();
    const lastRefresh = parseInt(sessionStorage.getItem('last_refresh_ts') || '0');
    const refreshCount = parseInt(sessionStorage.getItem('refresh_count') || '0');
    const TIME_WINDOW = 5000;

    if (now - lastRefresh < TIME_WINDOW) {
        const newCount = refreshCount + 1;
        sessionStorage.setItem('refresh_count', newCount.toString());

        if (newCount >= 2) {
            console.log("[PWA] Double-refresh detected. Auto-purging caches...");
            if ('caches' in window) {
                try {
                    const keys = await caches.keys();
                    const appKeys = keys.filter(key => key.includes('roshani-erp') || key.includes('pizza-erp'));
                    await Promise.all(appKeys.map(key => caches.delete(key)));
                } catch (e) {
                    console.warn("[PWA] Auto-purge failed:", e);
                }
            }
            sessionStorage.setItem('refresh_count', '0');
            sessionStorage.setItem('last_refresh_ts', '0');
            window.location.reload();
            return;
        }
    } else {
        sessionStorage.setItem('refresh_count', '1');
    }
    sessionStorage.setItem('last_refresh_ts', now.toString());
})();

// Note: Manual pull-to-refresh for Nuclear Refresh has been REMOVED to prevent accidental triggers.
// It can only be triggered via the menu.

// 2. PWA INSTALL LOGIC
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const downloadBtn = document.getElementById('menu-download');
    if (downloadBtn) downloadBtn.classList.remove('hidden');
});

export const installPWA = async () => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) return;

    if (!state.deferredPrompt) {
        if (!isStandalone) {
            showToast("Look for 'Add to Home Screen' in your browser menu.", "info");
        }
        return;
    }

    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const downloadBtn = document.getElementById('menu-download');
        if (downloadBtn) downloadBtn.classList.add('hidden');
    }
    state.deferredPrompt = null;
};

window.addEventListener('appinstalled', () => {
    const downloadBtn = document.getElementById('menu-download');
    if (downloadBtn) downloadBtn.classList.add('hidden');
    state.deferredPrompt = null;
});

// 3. SERVICE WORKER REGISTRATION
const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if ('serviceWorker' in navigator && isSecure) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.info('[PWA] SW registered, scope:', reg.scope);
        }).catch(err => {
            console.error('[PWA] SW registration failed:', err);
            setTimeout(() => {
                navigator.serviceWorker.register('sw.js').catch(e => 
                    console.error('[PWA] SW retry failed:', e)
                );
            }, 2000);
        });

        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        if (isStandalone) {
            const downloadBtn = document.getElementById('menu-download');
            if (downloadBtn) downloadBtn.classList.add('hidden');
        }
    });
}

