/**
 * PIN / passcode hashing — PBKDF2-HMAC-SHA256.
 *
 * Why not SHA-256: a 4-digit PIN has 10,000 possible values, so a plain
 * fast hash is a lookup table, not a credential store (OWASP forbids raw
 * SHA-256 for passwords). PBKDF2 with a per-credential random salt and
 * 600,000 iterations (OWASP 2026 floor for PBKDF2-HMAC-SHA256) makes an
 * offline sweep cost ~an hour per core instead of milliseconds.
 *
 * Stored format (RTDB-key safe — no `. # $ / [ ]`; `:` `-` `_` are legal):
 *     pbkdf2:600000:<salt base64url>:<derived key base64url>
 *
 * Parameters travel with the hash, so raising the work factor later does
 * not need a migration: verify() reads the iteration count it is given.
 * `verifyPin()` also accepts the legacy bare 64-char SHA-256 hex written
 * before this release and reports `legacy: true` so callers can upgrade.
 *
 * ponytail: this is leak-hygiene, not a security boundary — a client-side
 * gate cannot stop someone who can already write to the tenant. Real
 * enforcement needs a server; Spark plan means no Cloud Functions here.
 */

const PREFIX = 'pbkdf2';
const ITERATIONS = 600000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const MAX_ITERATIONS = 5000000; // guard against a hostile stored value
const LEGACY_HEX = /^[0-9a-f]{64}$/i;

const textEncoder = new TextEncoder();

const subtle = () => globalThis.crypto?.subtle || null;

function toB64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

/** Constant-time byte comparison — never short-circuit on the first mismatch. */
function timingSafeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * Derive bytes for a PIN. Exported for the runnable check so a fixed salt
 * can be used; production callers use hashPin().
 * Returns null when WebCrypto is unavailable (non-secure context).
 */
export async function derivePin(pin, saltBytes, iterations = ITERATIONS) {
    const s = subtle();
    if (!s) return null;
    const key = await s.importKey('raw', textEncoder.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await s.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
        key,
        KEY_BITS,
    );
    return new Uint8Array(bits);
}

/** Hash a PIN into the self-describing storage format. Null = no WebCrypto. */
export async function hashPin(pin) {
    const s = subtle();
    if (!s) return null;
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await derivePin(pin, salt, ITERATIONS);
    if (!derived) return null;
    return `${PREFIX}:${ITERATIONS}:${toB64Url(salt)}:${toB64Url(derived)}`;
}

/**
 * Verify a PIN against a stored value.
 * Resolves { ok, legacy } — `legacy: true` means the stored record was a
 * bare SHA-256 hex and the caller may re-hash it with hashPin().
 * Never throws: a malformed record is simply "no match".
 */
export async function verifyPin(pin, stored) {
    if (!stored || typeof stored !== 'string') return { ok: false, legacy: false };

    if (stored.startsWith(`${PREFIX}:`)) {
        const parts = stored.split(':');
        if (parts.length !== 4) return { ok: false, legacy: false };
        const [, iterStr, saltStr, hashStr] = parts;
        const iterations = Number.parseInt(iterStr, 10);
        if (!Number.isFinite(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
            return { ok: false, legacy: false };
        }
        try {
            const derived = await derivePin(pin, fromB64Url(saltStr), iterations);
            if (!derived) return { ok: false, legacy: false };
            return { ok: timingSafeEqual(derived, fromB64Url(hashStr)), legacy: false };
        } catch {
            return { ok: false, legacy: false };
        }
    }

    // Legacy record written by the old hashPin(): unsalted SHA-256 hex.
    if (LEGACY_HEX.test(stored)) {
        const s = subtle();
        if (!s) return { ok: false, legacy: true };
        const digest = await s.digest('SHA-256', textEncoder.encode(String(pin)));
        const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        return { ok: hex === stored.toLowerCase(), legacy: true };
    }

    return { ok: false, legacy: false };
}

export const PIN_ITERATIONS = ITERATIONS;
