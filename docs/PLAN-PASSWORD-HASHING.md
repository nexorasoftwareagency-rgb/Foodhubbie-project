# PLAN — Password & credential hashing, end to end

Status: **approved for implementation 2026-11-06**
Owner request: "enable Hashing - in Passwords.. Everywhere"

---

## 1. Audit — where credentials actually live today

| # | Credential | Where it is stored | Algorithm today | Verdict |
|---|---|---|---|---|
| 1 | Admin / Supreme / staff / rider account passwords | Firebase Auth (Google) | **modified scrypt**, per-user salt + per-project signer key (Firebase docs) | ✅ correct — never re-implement |
| 2 | Restaurant signup password (`website/signup.html`) | `onboardingSecrets/{reqKey}/password` | **PLAINTEXT in RTDB** | ❌ P0 — the only real plaintext password store |
| 3 | Same password, legacy path | `onboardingRequests/{reqKey}/adminPassword` | PLAINTEXT | ❌ P0 (deprecated, 0 rows live) |
| 4 | Approval API response / Supreme modal | HTTP JSON body + DOM | PLAINTEXT echo | ❌ P0 — password re-broadcast after it was already in Auth |
| 5 | Manager approval PIN | `settings/Security/pinHash` | **unsalted SHA-256** (64 hex) | ❌ P1 — 10^4 PINs are instant to brute-force |
| 6 | Per-staff counter PIN | `staff/{uid}/counterPinHash` + `counterPinIndex/{hash}` | **unsalted SHA-256** | ❌ P1 — same weakness |
| 7 | Delivery backup / OTP fallback code | `settings/Delivery/backupCode` | PLAINTEXT | ⚠️ cannot be hashed in this release — see §5 |
| 8 | Demo login | `Admin/js/demo-mode.js`, `tools/seed-demo-tenant.cjs` | PLAINTEXT constant (public demo) | ✅ by design — it is a public sandbox account |
| 9 | Staff / rider initial password | Firebase Auth (`createUserWithEmailAndPassword`) | scrypt | ✅ never persisted; a reset email is also sent |
| 10 | Supreme wizard admin password | browser memory → HTTPS API → Firebase Auth | scrypt | ✅ in transit only, TLS |
| 11 | QR table tokens, webview tokens, delivery OTPs | RTDB | random capability tokens (not passwords) | ✅ out of scope |

Live audit (2026-11-06): `onboardingSecrets` = **0 nodes**, no pending requests, `backupCode` = 2 tenants (`roshani-pizza/pizza` = `9724`, `foodhubbie-demo/demo` = `2026`), manager `pinHash` = none set, 2 legacy staff counter PINs on pizza.

---

## 2. Research — what "hashed" must mean here

- **Firebase Auth already hashes account passwords with a modified scrypt**, a unique salt per account and per-project parameters (`base64_signer_key`, `salt_separator`, `rounds`, `mem_cost`). Re-hashing before `createUser`/`updateUser` would be *wrong*: Firebase would hash the hash and break login. So items 1, 9, 10 are already correct and must be left alone.
- **OWASP Password Storage Cheat Sheet (current):** PBKDF2-HMAC-SHA256 ≥ **600,000** iterations, 16-byte random salt, store the algorithm + parameters with the hash. PBKDF2-HMAC-SHA512 ≥ 220,000. Argon2id is the preferred algorithm, but it is **not available in the browser's WebCrypto API** and this Admin app is a static site with no server round-trip for PIN checks. PBKDF2 through `crypto.subtle` is the correct native choice here.
- **Raw SHA-256/SHA-512/MD5 for passwords is explicitly forbidden** by OWASP — it is a fast hash, and a 4-digit PIN space collapses instantly. That is exactly what `hashPin()` does today.
- **A password that must later be replayed into Firebase Auth cannot be one-way hashed by us.** The only correct answer for the signup secret is to stop storing it at all and let the browser hand it directly to Firebase Auth.
- **Salt + parameters must travel with the hash** so the work factor can be raised later without a flag day.

---

## 3. Design decisions

### D1 — Signup password: create the Auth account in the browser (P0)

`website/signup.html` currently collects the password and `PUT`s it as plaintext to `onboardingSecrets`; the approval API reads it back, hands it to Firebase Auth, re-broadcasts it in the HTTP response and the Supreme modal shows it.

New flow:

1. Browser creates the Firebase Auth user on a **secondary app instance** (`initializeApp(config, 'signup-secondary')` + in-memory persistence) so the signup page never becomes a logged-in admin.
2. The password goes **browser → Firebase Auth over TLS only**. Firebase stores the scrypt hash. It is never written to RTDB.
3. The onboarding request stores `authUid` (a pointer, not a credential).
4. If the email already exists, the page tries `signInWithEmailAndPassword` with the same password. Success = the applicant owns the account (resume/retry); failure = "this email already has a login" inline error.
5. Approval resolves the account by `authUid` (email must match) → falls back to `getUserByEmail` → falls back to the legacy `onboardingSecrets` plaintext (only for requests created before this release) → otherwise a clear 422.
6. The approval response **no longer contains the password**, and the Supreme modal no longer prints it.

`onboardingSecrets` creation is **disabled in the rules**; only deletion (burn) stays. `adminPassword` is removed from the request schema so a client can no longer write a plaintext password there either.

### D2 — PINs: PBKDF2-SHA256, 600k iterations, per-credential salt (P1)

New `Admin/js/pin-crypto.js`:

- `hashPin(pin)` → `pbkdf2:600000:<salt base64url>:<derived key base64url>`
- `verifyPin(pin, stored)` → `{ ok, legacy }`, accepting the legacy bare-hex SHA-256 value so existing PINs keep working
- Constant-time byte compare; parameters are parsed from the stored string so a future bump needs no migration
- 16-byte salt from `crypto.getRandomValues`

Call sites: `settings.js` (manager PIN write), `staff-management.js` and `security-audit.js` (counter PIN write), `utils.js gateManagerPin` (the only verifier). A successful legacy verify **transparently upgrades** the stored value to PBKDF2.

RTDB key safety: `:` `-` `_` are legal in RTDB keys; `.` `#` `$` `/` `[` `]` are not, so base64url + `:` is used deliberately.

Residual (documented, not fixed): a 4-digit PIN is a weak secret no matter how it is hashed. PBKDF2 at 600k makes an offline sweep of the 10,000-code space cost ~an hour per core instead of milliseconds. Real enforcement still needs a server.

### D3 — Stop echoing the password anywhere (P0)

- Remove `password` from `approveOnboardingRequest()`'s return value and the HTTP response.
- Supreme modal: replace the password line with "The password is the one the owner chose at signup."
- Reject path: drop the now-meaningless `adminPassword: null` write.

### D4 — Reject / expire: no automatic account deletion

The rejection path only changes the request's status. `authUid` is written by an unauthenticated page, so deleting the referenced Auth account would let anyone destroy another person's login (a known uid + email is enough). Orphan accounts from rejected applications are harmless: the applicant still owns the login and can resubmit, and an approved-but-unverified tenant is already cleaned up by `runUnverifiedCleanup` after 72 h.

### D5 — Out of scope, with reasons

- **Rider delivery backup code** (`settings/Delivery/backupCode`): the rider app compares `enteredOtp === backupCode` on the device. Hashing it requires a new rider-app build that hashes the entered code; shipping the hash before the app ships would break the OTP fallback. Documented as a follow-up.
- **Demo password**: public sandbox credential, must remain readable by the client to auto-sign-in.
- **Firebase Auth account passwords**: already scrypt-hashed by Google.
- **QR/webview/delivery tokens**: random capability tokens, not user-chosen passwords.

---

## 4. Implementation steps

1. `Admin/js/pin-crypto.js` — new PBKDF2 module + `tests/pin-crypto.check.cjs`.
2. `Admin/js/utils.js` — re-export `hashPin`, add `verifyPin`, upgrade legacy PINs on success.
3. `Admin/js/features/security-audit.js` — treat `pinHash` as a configured ceiling (dead `managerPinHash` reference).
4. `website/signup-auth.js` — new secondary-app Auth module.
5. `website/signup.html` — create the account first, submit the request with `authUid`, no secrets write.
6. `firebase.json` — add `identitytoolkit.googleapis.com` + `securetoken.googleapis.com` to the website CSP `connect-src`.
7. `bot-control-api/server.js` — resolve `authUid` → existing user → legacy secret; no password in the response; delete the Auth user on reject.
8. `SupremeAdmin/js/features/onboarding-requests.js` — no password display.
9. `database.rules.json` — deny `onboardingSecrets` creation; add `authUid`; remove `adminPassword`.
10. Tests: update `tests/signup-onboarding.check.mjs` and `tests/auto-onboarding.check.cjs`.
11. Docs + ledger + encoding guard.

## 5. Verification

- `node tests/pin-crypto.check.cjs` — format, salt uniqueness, correct/incorrect PIN, legacy SHA-256 acceptance, iteration floor.
- `node tests/auto-onboarding.check.cjs` — approve with `authUid`, with an existing user, with a legacy secret, and the 422 path.
- `node tests/signup-onboarding.check.mjs` — no password ever leaves the page, retry is idempotent, email-in-use is handled.
- Live: rules probe (`onboardingSecrets` write must be 401), a temp signup + approval through the real API with cleanup, manager PIN set → verify → reload, staff counter PIN reset, legacy-hash upgrade proof, Admin build, encoding, twins.
- Deploy: `database`, `hosting:admin`, `hosting:supreme`, `hosting:website`, EC2 `bot-control-api/server.js`.

## 6. Rollback

- PINs: the verifier accepts both formats, so reverting `pin-crypto.js` alone would only strand PBKDF2 values — roll back the whole Admin bundle, not the module.
- Signup: keep the legacy secret branch in the approval API for one release; reverting `signup.html` alone restores the old flow because the rules keep the legacy delete grant (creation would need a one-line rule revert).
- No data migration is required: no rows exist in `onboardingSecrets`, and legacy PINs upgrade in place.
