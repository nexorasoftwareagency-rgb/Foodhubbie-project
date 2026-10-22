/**
 * Admin/js/xlsx.js
 *
 * Lazy loader for the SheetJS (xlsx) library.
 *
 * It used to be a deferred <script> in index.html, which meant every single
 * Admin page load pulled ~270KB from the CDN - even for the restaurant staff
 * who never export anything. It is only needed by five export buttons and by
 * the campaign spreadsheet upload, so it is now fetched the first time one of
 * those actually needs it.
 *
 * The library still lands on window.XLSX, so the existing call sites keep
 * working; they just have to await ensureXlsx() first.
 */
const CDN_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

let _pending = null;

export function ensureXlsx() {
    if (typeof window.XLSX !== 'undefined') return Promise.resolve(window.XLSX);
    if (_pending) return _pending;
    _pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CDN_URL;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            if (window.XLSX) resolve(window.XLSX);
            else { _pending = null; reject(new Error('Excel library did not initialise')); }
        };
        script.onerror = () => {
            _pending = null;
            reject(new Error('Excel library failed to load — check your connection'));
        };
        document.head.appendChild(script);
    });
    return _pending;
}
