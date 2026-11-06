// Runnable check for Admin/js/pin-crypto.js — the PBKDF2 PIN hasher.
// Node treats Admin/js/*.js as CJS (no "type":"module"), so the module is
// copied to a temp .mjs and imported. No network, no Firebase.
// Run: node tests/pin-crypto.check.mjs
import assert from 'assert';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createHash } from 'crypto';

const src = readFileSync('Admin/js/pin-crypto.js', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'pin-crypto-'));
const modPath = join(dir, 'pin-crypto.mjs');
writeFileSync(modPath, src, 'utf8');
const { hashPin, verifyPin, derivePin, PIN_ITERATIONS } = await import(pathToFileURL(modPath).href);

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); console.log('PASS ' + msg); };

// ---- 1. format + RTDB key safety ------------------------------------------
const stored = await hashPin('4711');
ok(typeof stored === 'string' && stored.startsWith('pbkdf2:'), 'hash is self-describing');
const [alg, iterStr, salt, hash] = stored.split(':');
ok(alg === 'pbkdf2', 'algorithm recorded with the hash');
ok(Number(iterStr) === 600000 && iterStr === String(PIN_ITERATIONS), 'OWASP floor: 600,000 PBKDF2-HMAC-SHA256 iterations');
ok(!/[.#$/[\]]/.test(stored), 'no character forbidden in a Realtime Database key');
ok(salt.length >= 20 && hash.length === 43, '16-byte salt + 256-bit derived key (base64url)');

// ---- 2. salting -----------------------------------------------------------
const another = await hashPin('4711');
ok(stored !== another, 'the same PIN hashes differently every time (per-PIN salt)');
ok((await verifyPin('4711', another)).ok, 'a freshly salted hash still verifies');

// ---- 3. verification ------------------------------------------------------
const good = await verifyPin('4711', stored);
ok(good.ok === true && good.legacy === false, 'correct PIN verifies');
const bad = await verifyPin('4712', stored);
ok(bad.ok === false, 'wrong PIN is rejected');
ok((await verifyPin('', stored)).ok === false, 'empty PIN is rejected');
ok((await verifyPin('4711', 'garbage')).ok === false, 'malformed record never verifies');
ok((await verifyPin('4711', null)).ok === false, 'missing record never verifies');
ok((await verifyPin('4711', 'pbkdf2:999999999:aaaa:bbbb')).ok === false, 'absurd iteration count is refused');

// ---- 4. fixed-salt determinism (what a future migration would rely on) ----
const fixedSalt = new Uint8Array(16).fill(7);
const d1 = await derivePin('1234', fixedSalt, 2000);
const d2 = await derivePin('1234', fixedSalt, 2000);
const d3 = await derivePin('1234', new Uint8Array(16).fill(8), 2000);
ok(Buffer.from(d1).equals(Buffer.from(d2)), 'same PIN + same salt + same cost = same bytes');
ok(!Buffer.from(d1).equals(Buffer.from(d3)), 'a different salt changes the derived key');

// ---- 5. legacy SHA-256 records still work + are flagged for upgrade ------
const legacy = createHash('sha256').update('4711').digest('hex');
const old = await verifyPin('4711', legacy);
ok(old.ok === true && old.legacy === true, 'a pre-PBKDF2 SHA-256 record still verifies and is flagged for upgrade');
ok((await verifyPin('9999', legacy)).ok === false, 'a wrong PIN against a legacy record is rejected');

// ---- 6. cost sanity -------------------------------------------------------
const t0 = Date.now();
await hashPin('600k');
const ms = Date.now() - t0;
ok(ms < 5000, `one hash at ${PIN_ITERATIONS} iterations completed in ${ms}ms (browser budget)`);

console.log(`\npin-crypto OK — ${n} checks passed`);
