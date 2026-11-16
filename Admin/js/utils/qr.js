/**
 * QR helpers — one implementation, shared by the table-QR card and the Customer App QR card.
 *
 * qrcodejs is already loaded by Admin/index.html; this module only waits for it and
 * falls back to the CDN copy the table-QR feature has always used.
 *
 * The QR pattern itself is always dark-on-light: a tinted pattern loses contrast and
 * stops scanning. Brand colour belongs on the card around the code, never inside it.
 */

export function ensureQrLib() {
    if (window.QRCode) return Promise.resolve(true);
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => resolve(!!window.QRCode);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

/** Build a QR code and return it as a PNG data URI (or null when the library is unavailable). */
export async function qrDataUri(text, size = 220, colorDark = '#1a1a1a') {
    if (!text) return null;
    const ok = await ensureQrLib();
    if (!ok || !window.QRCode) return null;
    try {
        const holder = document.createElement('div');
        new window.QRCode(holder, {
            text,
            width: size,
            height: size,
            colorDark,
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.M,
        });
        const img = holder.querySelector('img');
        const canvas = holder.querySelector('canvas');
        return img?.src || canvas?.toDataURL('image/png') || null;
    } catch (e) {
        console.error('[QR] Could not build the QR code:', e);
        return null;
    }
}
