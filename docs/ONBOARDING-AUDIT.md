# FoodHubbie Onboarding Audit (2026-10-28)

Audited from the public repo at commit `a4392f1` (`main`). Nothing was run against production. The live pricing page was not reachable from the audit environment, so no price is stated here or hardcoded in code.

## 1. Verified architecture
| Area | Finding |
|---|---|
| Stack | Vanilla-JS ES-module SPAs (Admin, SupremeAdmin, menu), React/Vite rider app, Node WhatsApp bot (Baileys), `bot-control-api` (Express + Firebase Admin SDK) |
| Data / auth | Firebase Realtime Database + Firebase Auth. Tenant path: `businesses/{bid}/outlets/{oid}`. Roles in `admins/{uid}` |
| Hosting | Firebase Hosting targets; build via `tools/build.mjs` (esbuild); bot on EC2/PM2 |
| Tests | Playwright specs in `tests/` (configured against the live admin URL), many `*.check.mjs` scripts, bot unit tests, `gate-verify.js`. CI runs encoding guard, bot unit tests, gate-verify only |
| Not verified | Live behaviour, live DB rules state, deployment credentials, Supreme Admin UI run-through |

## 2. Actual onboarding journey
1. `website/signup.html`: one-page form (business, outlet, phone, emails, admin name, password, plan, WhatsApp option, terms).
2. Browser POSTs `onboardingRequests` (no password) then PUTs password to write-only `onboardingSecrets/{key}`. Both are unauthenticated writes allowed by rules.
3. Supreme Admin reviews in `SupremeAdmin/js/features/onboarding-requests.js` and approves via `POST /api/admin/approve-onboarding` (`bot-control-api/server.js`): creates Auth user, `admins/{uid}`, outlet with `locked: true`, billing defaults; deletes the secret.
4. Owner logs in to Admin. `Admin/js/auth.js` sets `state.locked`; `showLockedScreen()` blocks every non-safe click until Supreme Admin sets `locked: false` (setup fee).
5. Unlocked owner lands on a dashboard with no guidance. No setup checklist existed.

## 3. Findings
| # | Step | Problem (evidence) | Recommendation | Risk | Priority |
|---|---|---|---|---|---|
| 1 | Signup | `.success` "Application received!" had no CSS, so it was visible before submit | Fixed in this branch | Misleading UI | High |
| 2 | Signup | Retry after a failed password save created a second request; success state re-enabled the button after 3s (duplicate requests) | Fixed: one request per visit, retry re-sends only step 2, form locks on success | Duplicate records | High |
| 3 | Signup | Validation used `alert()`; no inline errors, no focus management | Fixed: inline, accessible errors; data preserved on failure | UX | Medium |
| 4 | Signup | No email ownership verification: anyone can apply with someone else's email and a chosen password; approval then creates that Auth user | Add email verification or have the owner set the password via reset link at approval; needs your decision | Account takeover of an unclaimed email | High |
| 5 | Signup | Password sits in `onboardingSecrets` until approval and approval API echoes it back to Supreme Admin | Move to emailed reset link; stop returning the password | Credential exposure | High |
| 6 | Signup rules | Unauthenticated writes with no rate limit / App Check / captcha | Add App Check or a proxy endpoint with rate limiting | Spam, DB bloat | High |
| 7 | Lock | `locked` is enforced only in browser JS. `database.rules.json` restricts writing the flag itself but not writes under the outlet, so a locked owner can write via the SDK/REST | Rules gate on `locked` (needs careful rollout and testing) | Setup-fee bypass | High |
| 8 | Lock | Locked owners cannot touch anything, even settings or menu, while waiting for activation | Business decision: allow read/setup-only access before activation? | Slower time-to-value | Medium |
| 9 | Dashboard | No setup checklist or next action | Implemented (`setup-checklist.js`) | Low | High |
| 10 | Data | Signup collects no address, cuisine or table count; nothing prompts for it later | Checklist now prompts for address, menu, tables | Low | Medium |
| 11 | Tests | Playwright config targets the live production URL; CI runs no onboarding tests | Point E2E at emulator/staging | Prod data risk | Medium |
| 12 | Docs | `PLAN-WEBSITE-ONBOARDING-APPROVAL.md` still says the password is stored on the request | Update doc | Low | Low |

## 4. Changes in this branch (`feat/onboarding-setup-checklist`)
- `website/signup.html`: findings 1-3. Password minimum raised from 6 to 8 on the client (rules still accept 6+).
- `Admin/js/features/setup-checklist.js` (new), `Admin/index.html`, `Admin/js/ui.js`: dashboard checklist, derived from existing data (store profile, dishes, tables, WhatsApp status, orders). Read-only, no schema change, resumes automatically, hides when complete, shows an Activation step while locked, shows unknown (not done) if a read fails, hidden for roles without Settings access.
- `tests/signup-onboarding.check.mjs` (new): mocked-network check, never touches production.

## 5. Test report
| Check | Result |
|---|---|
| `NODE_PATH=$(npm root -g) node tests/signup-onboarding.check.mjs` | Passed (12/12) |
| Checklist module vs stubbed Firebase/DOM (7 cases) | Passed (script not committed) |
| `node tests/encoding-check.mjs` | Passed |
| `node tests/check-imports.mjs` | Passed |
| `node gate-verify.js` | Passed (live DB gate skipped, no credentials) |
| `npm run build:admin` | Blocked: npm registry unreachable in this environment |
| Existing Playwright specs | Not run (target production) |
| Checklist in a real browser against a real outlet | Not run |

## 6. Needs your decision / authorization
1. Findings 4-5: verify email or send reset link instead of storing a chosen password?
2. Finding 7: enforce the lock in database rules?
3. Finding 8: allow setup-only access before activation?
4. Review and push the branch; deploy only after build and a staging check.
