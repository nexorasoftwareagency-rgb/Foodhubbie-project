/**
 * FoodHubbie | APP UPDATE WATCHER  (shared/app-update.js)
 *
 * Every deployed site publishes its own /version.json, stamped at deploy time by
 * tools/stamp-version.cjs (firebase.json predeploy hook). This module polls that
 * file and, when the published version differs from the one this browser last
 * acknowledged, shows a non-blocking "Update app" card. It never reloads on its
 * own — the customer/clerk decides.
 *
 * Why a poll and not just the service worker: Supreme and the website have no
 * SW, and Admin's SW is stale-while-revalidate, so a waiting worker is not a
 * reliable deploy signal. version.json is the one file that is always fresh
 * (no-store fetch + SW bypass — see Admin/sw.js, menu/sw.js, rider-app/public/sw.js).
 *
 * Self-starting and dependency-free: import it once from each site entry point.
 * Twins (byte-identical, guarded by tools/check-shared-twins.cjs):
 *   menu/shared/app-update.js        (menu hosting cannot reach /shared)
 *   website/shared/app-update.js     (website hosting serves website/ only)
 *   rider-app/public/app-update.js   (Vite copies public/ to dist verbatim)
 */

const POLL_MS = 60 * 1000;
const FIRST_CHECK_MS = 15 * 1000;
const KEY_ACK = 'fh:appVersion:ack';   // version this browser last updated to
const KEY_LATER = 'fh:appVersion:later'; // version the user said "Later" to

const Z = 2147483000;
const ACCENT = '#e84908';

const state = { started: false, showing: false, el: null, ack: '', later: '' };

// ---------------------------------------------------------------- storage
function read(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}
function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

// ---------------------------------------------------------------- version
// version.json carries the authority (site + label); this map is only the
// fallback if the file is missing (site not yet redeployed with the stamper).
function siteLabel(host) {
    const h = String(host || '').toLowerCase();
    if (h.includes('supreme')) return 'FoodHubbie Supreme';
    if (h.includes('admin')) return 'FoodHubbie Admin';
    if (h.includes('rider')) return 'FoodHubbie Rider';
    if (h.includes('menu') || h.includes('qrmenu')) return 'FoodHubbie Menu';
    return 'FoodHubbie';
}

async function fetchVersion() {
    try {
        const res = await fetch('/version.json?ts=' + Date.now(), {
            cache: 'no-store',
            credentials: 'same-origin',
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || typeof data.version !== 'string' || !data.version) return null;
        return {
            id: (data.site || 'site') + ':' + data.version,
            label: data.label || siteLabel(location.hostname),
        };
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------- popup
const CSS = `
#fh-update{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));
  z-index:${Z};width:min(384px,calc(100vw - 40px));box-sizing:border-box;
  background:#fff;color:#111827;border:1px solid rgba(17,24,39,.09);border-radius:16px;
  padding:16px 18px 14px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 24px 60px -16px rgba(15,23,42,.38),0 2px 8px rgba(15,23,42,.08);
  animation:fh-up .32s cubic-bezier(.22,1,.36,1) both}
#fh-update *{box-sizing:border-box}
#fh-update .fh-row{display:flex;gap:12px;align-items:flex-start}
#fh-update .fh-badge{flex:0 0 auto;width:38px;height:38px;border-radius:11px;
  background:#fff1eb;color:${ACCENT};display:grid;place-items:center}
#fh-update .fh-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:${ACCENT};margin:1px 0 2px}
#fh-update h2{margin:0;font-size:15px;line-height:1.3;font-weight:650;letter-spacing:-.01em;color:#111827}
#fh-update p{margin:5px 0 0;font-size:12.5px;line-height:1.5;color:#5b6472}
#fh-update .fh-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:14px}
#fh-update button{font:inherit;font-size:13px;font-weight:600;border-radius:9px;
  padding:9px 15px;cursor:pointer;transition:background .15s,border-color .15s,transform .06s}
#fh-update button:active{transform:translateY(1px)}
#fh-update .fh-later{background:transparent;border:1px solid transparent;color:#6b7280;padding:9px 12px}
#fh-update .fh-later:hover{background:#f3f4f6;color:#111827}
#fh-update .fh-now{background:${ACCENT};border:1px solid ${ACCENT};color:#fff;
  box-shadow:0 1px 2px rgba(15,23,42,.12)}
#fh-update .fh-now:hover{background:#d13f04;border-color:#d13f04}
#fh-update .fh-now[disabled]{opacity:.7;cursor:default}
#fh-update button:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
@media (max-width:520px){
  #fh-update{right:12px;left:12px;width:auto;bottom:calc(132px + env(safe-area-inset-bottom,0px))}
}
@media (prefers-color-scheme:dark){
  #fh-update{background:#111827;color:#e5edff;border-color:rgba(255,255,255,.1);
    box-shadow:0 24px 60px -16px rgba(0,0,0,.7),0 2px 8px rgba(0,0,0,.4)}
  #fh-update .fh-badge{background:rgba(232,73,8,.18)}
  #fh-update h2{color:#f1f5fd}
  #fh-update p{color:#9aa7ba}
  #fh-update .fh-later{color:#9aa7ba}
  #fh-update .fh-later:hover{background:rgba(255,255,255,.07);color:#f1f5fd}
}
@keyframes fh-up{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#fh-update{animation:none}}
`;

function build(label) {
    const el = document.createElement('div');
    el.id = 'fh-update';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'fh-update-title');
    el.setAttribute('aria-describedby', 'fh-update-body');
    el.innerHTML = `
        <style>${CSS}</style>
        <div class="fh-row">
            <span class="fh-badge" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
                </svg>
            </span>
            <div>
                <div class="fh-eyebrow">Update available</div>
                <h2 id="fh-update-title">A new version of ${label} is ready.</h2>
                <p id="fh-update-body">Reload to get the latest fixes and features. You stay signed in.</p>
            </div>
        </div>
        <div class="fh-actions">
            <button type="button" class="fh-later">Later</button>
            <button type="button" class="fh-now">Update app</button>
        </div>`;
    return el;
}

async function applyUpdate(id) {
    const btn = state.el && state.el.querySelector('.fh-now');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

    // Acknowledged before the reload so the same deploy cannot prompt twice.
    write(KEY_ACK, id);
    write(KEY_LATER, '');

    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(async (reg) => {
                try { if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); } catch (e) { /* noop */ }
                try { await reg.update(); } catch (e) { /* offline */ }
            }));
        }
    } catch (e) { /* no SW support */ }

    // Admin serves app code stale-while-revalidate; a cache is the only way it
    // can hand back the old bundle after a deploy. Clear it, then reload.
    try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) { /* no Cache API */ }

    location.reload();
}

function dismiss() {
    write(KEY_LATER, state.later);
    if (state.el) { state.el.remove(); state.el = null; }
    state.showing = false;
}

function show(version) {
    if (state.showing || document.getElementById('fh-update')) return;
    state.showing = true;
    state.later = version.id;

    const el = build(version.label);
    document.body.appendChild(el);
    state.el = el;

    el.querySelector('.fh-later').addEventListener('click', dismiss);
    el.querySelector('.fh-now').addEventListener('click', () => { applyUpdate(version.id); });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape' && state.showing) {
            document.removeEventListener('keydown', onKey);
            dismiss();
        }
    });

    // Never steal focus from someone mid-typing; announce only when idle.
    if (document.activeElement === document.body || document.activeElement === document.documentElement) {
        el.querySelector('.fh-now').focus({ preventScroll: true });
    }
}

// ---------------------------------------------------------------- watcher
async function check() {
    if (state.showing || document.hidden) return;
    const version = await fetchVersion();
    if (!version || state.showing) return;

    if (!state.ack) {
        // First run on this browser: adopt the current version silently. A
        // brand-new visitor already has the fresh code, so nothing to prompt.
        state.ack = version.id;
        write(KEY_ACK, state.ack);
        return;
    }
    if (version.id === state.ack || version.id === state.later) return;
    show(version);
}

function start() {
    if (state.started) return;
    state.started = true;
    state.ack = read(KEY_ACK);
    state.later = read(KEY_LATER);

    setTimeout(check, FIRST_CHECK_MS);
    setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('online', check);

    // Test hook: drive the watcher from Playwright without waiting a minute.
    window.__fhAppUpdate = { check, isShowing: () => state.showing };
}

start();
