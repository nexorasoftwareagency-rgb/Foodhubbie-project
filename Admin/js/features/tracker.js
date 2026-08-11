/**
 * ROSHANI ERP | LIVE RIDER TRACKER MODULE
 * Leaflet map + rider sidebar with named markers, per-rider info, and status legend.
 */

import { db, ref, onValue } from '../firebase.js';
import { escapeHtml } from '../utils.js';
import { loadLucide } from '../ui.js';

let leafletLoaded = false;

async function loadLeaflet() {
    if (leafletLoaded) return;
    await Promise.all([
        import('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
        new Promise(resolve => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.crossOrigin = 'anonymous';
            link.onload = resolve;
            document.head.appendChild(link);
        })
    ]);
    leafletLoaded = true;
    // Fix Leaflet marker images
    if (window.L) {
        delete window.L.Icon.Default.prototype._getIconUrl;
        window.L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
        });
    }
}

let adminTrackerMap = null;
let riderMarkersMap = new Map();
let riderRoutesMap = new Map();
let riderLocationUnsub = null;
let mapInitTimeout = null;
let _allRiders = {};
let _lastUpdateTime = null;
let _lastUpdateTimer = null;
let _sidebarCollapsed = false;

function avatarSvg(name) {
    const initial = encodeURIComponent((name || 'R').charAt(0).toUpperCase());
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%23E84908'/%3E%3Ctext x='20' y='26' font-size='18' fill='white' text-anchor='middle' font-family='sans-serif'%3E${initial}%3C/text%3E%3C/svg%3E`;
}

function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const RIDER_STALE_MS = 5 * 60 * 1000;

function isFresh(r) {
    if (!r) return false;
    if (r.status !== "Online") return false;
    const ts = r.lastSeen || r.location?.ts || 0;
    return ts && (Date.now() - ts) < RIDER_STALE_MS;
}

function isOnline(r) {
    return isFresh(r) && r.location && r.location.lat && r.location.lng;
}

function displayStatus(r) {
    if (!isFresh(r)) return { label: "Offline", cls: "offline" };
    if (r.currentOrder) return { label: "On Delivery", cls: "on-delivery" };
    return { label: "Online", cls: "online" };
}

function markerIcon(r) {
    const { cls } = displayStatus(r);
    return L.divIcon({
        className: 'rider-marker-wrap',
        html: `<div class="rider-marker-pill rider-marker-${cls}" title="${escapeHtml(r.name || 'Rider')}">
            <span class="rider-marker-dot"></span>
            <span class="rider-marker-name">${escapeHtml((r.name || 'Rider').split(' ')[0])}</span>
        </div>`,
        iconSize: [70, 28],
        iconAnchor: [35, 14]
    });
}

function buildPopup(r) {
    const { label, cls } = displayStatus(r);
    const lastSeen = r.location && r.location.ts ? formatTime(r.location.ts) : 'Recently';
    const phone = r.phone ? `<a href="tel:${escapeHtml(r.phone)}" class="tracker-popup-link">📞 ${escapeHtml(r.phone)}</a>` : '';
    const orderId = r.currentOrder ? `<span class="tracker-popup-link tracker-popup-link-static">📦 Order #${escapeHtml(String(r.currentOrder).slice(-5))}</span>` : '';
    const maps = (r.location && r.location.lat) ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${r.location.lat},${r.location.lng}" target="_blank" rel="noopener" class="tracker-popup-link">🧭 Directions</a>` : '';
    const profileImg = r.profilePhoto || r.photoUrl || avatarSvg(r.name);

    return `
        <div class="tracker-popup">
            <div class="tracker-popup-head">
                <img src="${profileImg}" class="tracker-popup-avatar" alt="" onerror="this.style.display='none'">
                <div class="tracker-popup-id">
                    <span class="tracker-popup-name">${escapeHtml(r.name || 'Rider')}</span>
                    <span class="rider-status-pill-v4 ${cls}"><span class="rider-dot-v4"></span>${label}</span>
                </div>
            </div>
            <div class="tracker-popup-body">
                ${phone}
                ${orderId}
                ${maps}
            </div>
            <div class="tracker-popup-foot">
                🕒 Last seen ${lastSeen}
            </div>
        </div>
    `;
}

function buildSidebarCard(r, id) {
    const { label, cls } = displayStatus(r);
    const initial = escapeHtml((r.name || 'R').charAt(0).toUpperCase());
    const profileImg = r.profilePhoto || r.photoUrl || avatarSvg(r.name);
    const lastSeen = r.location && r.location.ts ? formatTime(r.location.ts) : '—';
    const orderInfo = r.currentOrder
        ? `<div class="tracker-card-order">📦 Order #${escapeHtml(String(r.currentOrder).slice(-5))}</div>`
        : '';
    return `
        <div class="tracker-card tracker-card-${cls}" data-rider-id="${id}" ${r.location ? 'role="button" tabindex="0"' : ''} data-action="locate-rider">
            <div class="tracker-card-avatar">
                <img src="${profileImg}" alt="" onerror="this.style.display='none'">
                <span class="tracker-card-dot tracker-card-dot-${cls}"></span>
            </div>
            <div class="tracker-card-body">
                <div class="tracker-card-name">${escapeHtml(r.name || 'Rider')}</div>
                <div class="tracker-card-meta">
                    <span class="rider-status-pill-v4 ${cls}"><span class="rider-dot-v4"></span>${label}</span>
                    <span class="tracker-card-time">${lastSeen}</span>
                </div>
                ${orderInfo}
            </div>
            ${r.location ? '<i data-lucide="crosshair" class="tracker-card-locate"></i>' : ''}
        </div>
    `;
}

function buildMobileChip(r, id) {
    const { label, cls } = displayStatus(r);
    const initial = escapeHtml((r.name || 'R').charAt(0).toUpperCase());
    return `
        <button class="tracker-chip tracker-chip-${cls}" data-rider-id="${id}" data-action="locate-rider">
            <span class="tracker-chip-dot"></span>
            <span class="tracker-chip-avatar">${initial}</span>
            <span class="tracker-chip-name">${escapeHtml((r.name || 'Rider').split(' ')[0])}</span>
            <span class="tracker-chip-status">${label}</span>
        </button>
    `;
}

function updateStats(allRiders) {
    let online = 0, delivery = 0, offline = 0;
    Object.values(allRiders).forEach(r => {
        if (!r) return;
        if (isFresh(r)) {
            if (r.currentOrder) delivery++;
            else online++;
        } else {
            offline++;
        }
    });
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('trackerOnlineCount', online);
    el('trackerDeliveryCount', delivery);
    el('trackerOfflineCount', offline);
}

async function renderSidebar(allRiders) {
    const onlineList = document.getElementById('trackerOnlineList');
    const offlineList = document.getElementById('trackerOfflineList');
    const chips = document.getElementById('trackerMobileChips');
    if (!onlineList || !offlineList) return;

    const onlineRiders = [];
    const offlineRiders = [];
    Object.entries(allRiders).forEach(([id, r]) => {
        if (!r) return;
        if (isFresh(r)) onlineRiders.push([id, r]);
        else offlineRiders.push([id, r]);
    });

    onlineRiders.sort((a, b) => {
        const aD = a[1].currentOrder ? 1 : 0;
        const bD = b[1].currentOrder ? 1 : 0;
        if (aD !== bD) return bD - aD;
        return (a[1].name || '').localeCompare(b[1].name || '');
    });
    offlineRiders.sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

    onlineList.innerHTML = onlineRiders.length
        ? onlineRiders.map(([id, r]) => buildSidebarCard(r, id)).join('')
        : '<div class="tracker-empty">No riders online right now.</div>';

    offlineList.innerHTML = offlineRiders.length
        ? offlineRiders.map(([id, r]) => buildSidebarCard(r, id)).join('')
        : '<div class="tracker-empty">No offline riders.</div>';

    if (chips) {
        chips.innerHTML = onlineRiders.length
            ? onlineRiders.map(([id, r]) => buildMobileChip(r, id)).join('')
            : '<div class="tracker-chip-empty">No riders online</div>';
    }

    await loadLucide();
    if (window.lucide) window.lucide.createIcons();
}

function fitMapToRiders(riderEntries) {
    if (!adminTrackerMap) return;
    const bounds = riderEntries
        .filter(([, r]) => r.location && r.location.lat && r.location.lng)
        .map(([, r]) => [r.location.lat, r.location.lng]);
    if (bounds.length === 0) return;
    if (bounds.length === 1) {
        adminTrackerMap.setView(bounds[0], 14, { animate: true });
    } else {
        adminTrackerMap.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 15 });
    }
}

function updateMarkers(riderEntries) {
    if (!adminTrackerMap) return;
    const seen = new Set();

    riderEntries.forEach(([id, r]) => {
        if (!r.location || !r.location.lat || !r.location.lng) return;
        seen.add(id);
        const pos = [r.location.lat, r.location.lng];
        const popup = buildPopup(r);

        if (riderMarkersMap.has(id)) {
            const marker = riderMarkersMap.get(id);
            marker.setLatLng(pos);
            marker.setIcon(markerIcon(r));
            if (marker.getPopup()) marker.getPopup().setContent(popup);
            else marker.bindPopup(popup);
        } else {
            const marker = L.marker(pos, { icon: markerIcon(r) })
                .addTo(adminTrackerMap)
                .bindPopup(popup);
            riderMarkersMap.set(id, marker);
        }
    });

    for (const [id, marker] of riderMarkersMap.entries()) {
        if (!seen.has(id)) {
            adminTrackerMap.removeLayer(marker);
            riderMarkersMap.delete(id);
        }
    }
}

window.trackerLocateRider = function (id) {
    const r = _allRiders[id];
    if (!r || !r.location || !adminTrackerMap) return;
    const pos = [r.location.lat, r.location.lng];
    adminTrackerMap.flyTo(pos, 16, { animate: true, duration: 0.6 });
    const marker = riderMarkersMap.get(id);
    if (marker) marker.openPopup();
    document.querySelectorAll('.tracker-card.is-active, .tracker-chip.is-active').forEach(el => el.classList.remove('is-active'));
    const card = document.querySelector(`.tracker-card[data-rider-id="${id}"]`);
    if (card) card.classList.add('is-active');
    const chip = document.querySelector(`.tracker-chip[data-rider-id="${id}"]`);
    if (chip) chip.classList.add('is-active');
};

async function bindUi() {
    const collapseBtn = document.getElementById('btnToggleTrackerSidebar');
    if (collapseBtn && !collapseBtn.dataset.bound) {
        collapseBtn.dataset.bound = '1';
        collapseBtn.addEventListener('click', async () => {
            _sidebarCollapsed = !_sidebarCollapsed;
            const layout = document.querySelector('.tracker-layout');
            const icon = collapseBtn.querySelector('[data-lucide]');
            if (layout) layout.classList.toggle('tracker-layout-collapsed', _sidebarCollapsed);
            if (icon) {
                icon.setAttribute('data-lucide', _sidebarCollapsed ? 'panel-right-open' : 'panel-right-close');
                await loadLucide();
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    const offlineToggle = document.getElementById('btnTrackerShowOffline');
    const offlineSection = document.getElementById('trackerOfflineSection');
    if (offlineToggle && offlineSection && !offlineToggle.dataset.bound) {
        offlineToggle.dataset.bound = '1';
        offlineToggle.addEventListener('click', async () => {
            const expanded = offlineToggle.getAttribute('aria-expanded') === 'true';
            offlineToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            offlineSection.classList.toggle('hidden', expanded);
            const icon = offlineToggle.querySelector('[data-lucide]');
            if (icon) {
                icon.setAttribute('data-lucide', expanded ? 'chevron-down' : 'chevron-up');
                await loadLucide();
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    ['trackerOnlineList', 'trackerOfflineList', 'trackerMobileChips'].forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container && !container.dataset.delegationBound) {
            container.dataset.delegationBound = '1';
            container.addEventListener('click', e => {
                const card = e.target.closest('[data-action="locate-rider"]');
                if (!card) return;
                const riderId = card.dataset.riderId;
                if (riderId) window.trackerLocateRider?.(riderId);
            });
            container.addEventListener('keydown', e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const card = e.target.closest('[data-action="locate-rider"]');
                if (!card) return;
                e.preventDefault();
                const riderId = card.dataset.riderId;
                if (riderId) window.trackerLocateRider?.(riderId);
            });
        }
    });
}

function updateLastUpdated() {
    if (!_lastUpdateTime) return;
    const el = document.getElementById('trackerLastUpdateTime');
    if (!el) return;
    const seconds = Math.max(0, Math.floor((Date.now() - _lastUpdateTime) / 1000));
    if (seconds < 5) el.textContent = 'just now';
    else if (seconds < 60) el.textContent = `${seconds}s ago`;
    else el.textContent = `${Math.floor(seconds / 60)}m ago`;
}

function startLastUpdatedTicker() {
    if (_lastUpdateTimer) clearInterval(_lastUpdateTimer);
    updateLastUpdated();
    _lastUpdateTimer = setInterval(updateLastUpdated, 5000);
}

function stopLastUpdatedTicker() {
    if (_lastUpdateTimer) { clearInterval(_lastUpdateTimer); _lastUpdateTimer = null; }
}

/**
 * INITIALIZE LIVE MAP
 */
export function initLiveRiderTracker() {
    if (mapInitTimeout) clearTimeout(mapInitTimeout);
    mapInitTimeout = setTimeout(async () => {
        mapInitTimeout = null;
        const mapDiv = document.getElementById('adminLiveMap');
        if (!mapDiv) return;

        await loadLeaflet();

        if (adminTrackerMap) {
            try { adminTrackerMap.remove(); } catch (e) { /* ignore */ }
            adminTrackerMap = null;
        }

        if (typeof L === 'undefined') {
            console.error("Leaflet library not found. Map cannot be initialized.");
            mapDiv.innerHTML = '<div class="p-20 text-center">Leaflet Map Library Missing</div>';
            return;
        }

        adminTrackerMap = L.map('adminLiveMap').setView([25.887944, 85.026194], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(adminTrackerMap);

        bindUi();
        if (window.lucide) window.lucide.createIcons();
        startRiderLocationListener();
        startLastUpdatedTicker();

        setTimeout(() => {
            if (adminTrackerMap) adminTrackerMap.invalidateSize();
        }, 200);
    }, 100);
}

export function stopRiderLocationListener() {
    if (mapInitTimeout) { clearTimeout(mapInitTimeout); mapInitTimeout = null; }
    if (riderLocationUnsub) { riderLocationUnsub(); riderLocationUnsub = null; }
    stopLastUpdatedTicker();
}

export function cleanupLiveRiderTracker() {
    console.log("[Performance] Cleaning up Live Rider Tracker...");
    stopRiderLocationListener();
    if (adminTrackerMap) {
        try { adminTrackerMap.remove(); } catch (e) { /* ignore */ }
        adminTrackerMap = null;
    }
    riderMarkersMap.clear();
    riderRoutesMap.clear();
    _allRiders = {};
    _lastUpdateTime = null;
}

function startRiderLocationListener() {
    if (riderLocationUnsub) { riderLocationUnsub(); riderLocationUnsub = null; }

    const ridersRef = ref(db, 'riders');
    riderLocationUnsub = onValue(ridersRef, snap => {
        const all = snap.val() || {};
        _allRiders = all;
        _lastUpdateTime = Date.now();
        updateLastUpdated();

        const entries = Object.entries(all);
        updateStats(all);
        renderSidebar(all);
        updateMarkers(entries);
        fitMapToRiders(entries.filter(([, r]) => isFresh(r) && r.location));
    });
}
