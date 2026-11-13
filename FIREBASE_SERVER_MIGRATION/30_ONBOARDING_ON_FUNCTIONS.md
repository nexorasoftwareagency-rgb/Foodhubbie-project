# 30 - Supreme onboarding + owner password moved off EC2 (batch 23d-3)

Date: 2026-11-13. Follows 23d-2 (App Notifications) in
`29_NOTIFY_ON_FUNCTIONS.md`. The box is still down
(`23_BOX_OFFLINE_INCIDENT.md`, `node tools/check-box-live.cjs` exit 1), so this
batch moves the routes that block **creating a new tenant**.

## 1. Why these routes, and why third

The `onboarding` surface is three routes in `bot-control-api/server.js`:

| route | caller | what breaks while the box is down |
|---|---|---|
| `POST /api/admin/approve-onboarding` | Supreme → Onboarding → Approve | a website signup can never become an outlet; the Approve button just fails |
| `GET /api/admin/outlet-admin-status` | Supreme → restaurant profile → Unlock | the D2 email-verification gate cannot be read, so Unlock must either refuse everything or bypass the gate |
| `POST /api/admin/update-password` | Supreme → onboarding wizard + profile ("Set owner password") | no owner password can be created or reset |

Unlike the WhatsApp/quota/template routes these need **no Meta token and no
socket** - only RTDB + Firebase Auth, both reachable from Functions. That makes
them the last routes on the "a paying tenant can actually be created" path, so
they go before Track A (`24_WHATSAPP_OFF_EC2_DEPENDENCY.md`).

Deliberately **not** in this batch: bot provision/restart and exchange (need
pm2), `wallet-watch` (batch 14 decision: live listeners, not a 1-min poll), and
the WhatsApp read routes (need a live tenant token to prove parity).

## 2. The contract, kept byte-compatible

`functions/src/api/tenantOnboarding.ts`, mounted under `/tenant-api`-style
routing with a `GET /health` probe. Identity is the **Supreme** account
(`admins/{uid}.isSuper === true`, or `isSupport` for read-only), not a tenant
admin - these routes act across tenants:

| behaviour | same as control API |
|---|---|
| auth | `Bearer <ID token>` → 401 `Missing bearer token` / `Invalid or expired token`; not a Supreme row → 403 `Not a Supreme Admin`; unreadable `admins` row → 500 `Could not verify admin status` |
| mutations | `isSupport` (view-only) → 403 `View-only account — this action requires full Supreme Admin access.` |
| `GET /api/admin/outlet-admin-status?bid&oid` | `{email, emailVerified}`; no `adminLogin.email` (legacy outlet) → `{email:null,emailVerified:null}` and is **never gated**; Auth user gone → `{email, emailVerified:false, missing:true}`; otherwise `{email, emailVerified, uid, disabled}`; missing params → 400 `bid and oid are required` |
| `POST /api/admin/approve-onboarding` | body `{reqKey, businessName, outletName, contactPhone, contactEmail, adminEmail, adminName?, plan?, template?, whatsappConnect?}`; 400 `reqKey, businessName, outletName, adminEmail are required` |
| approval, `authUid` request | adopt the browser-created Auth user; email changed → 422 `The admin email cannot be changed after the signup account was created.`; account missing → 422 `The dashboard account recorded on this request no longer exists — ask the applicant to submit the form again.`; email mismatch → 422 `The dashboard account does not match the admin email on this request.` |
| approval, legacy request | replay `onboardingSecrets/{key}.password` or inline `adminPassword` into Auth, then burn both - **one release only**, exactly the control API's legacy branch |
| approval, refusals | unknown request → 404 `Onboarding request not found`; not pending → 409 `Request already approved` |
| approval, writes | `businesses/{bid}` + `outlets/{oid}` (locked, `adminLogin` = email only, template defaults spread **before** identity/security), owner mirror on `admins/{uid}`, wallet defaults on the **server-only** `walletBilling/{bid}/{oid}`, `outletIndex/{oid}`, template `menuBank` mirror, request stamped `reviewedBy` |
| approval, retry | an already-stamped request keeps its `bid`/`oid`; the outlet number is reused from the existing outlet, so a retry does not burn another counter slot (a gap in the sequence is fine, a duplicate is not) |
| approval, response | `{ok:true, uid, email, bid, oid, loginUrl:'https://app.foodhubbie.in'}` |
| `POST /api/admin/update-password` | `{bid, oid, email, newPassword}`; 400 `bid, oid, email, and newPassword are required`, `Password must be at least 6 characters`; creates the Auth user when absent, otherwise updates it; writes `adminLogin` `{email, passwordUpdatedAt}` **only**, creates the owner `admins` mirror only when missing; `{ok:true, uid}` |
| body | JSON, 100 KB cap (`Request body is too large`) |

The shared helpers live in `functions/src/shared/http/tenant.ts`
(`supremeFromToken`, `requireSuperRole`, on top of 23d-2's
`tenantFromToken`/`readJsonBody`/`routeOf`), so the Supreme gate cannot drift
between the onboarding routes and anything added later.

The older prototype `functions/src/api/onboardingApprove.ts` is **not reused**
(it predates the current hardening: no `authUid` adoption, no duplicate guard,
no `walletBilling` root). It stays exported from `index.ts` untouched, and the
guard asserts this module neither imports nor re-exports it.

## 3. Wiring: a URL key, not a host swap

Same rule as 23d-1/23d-2 - the split is by **path**, driven by RTDB:

* `config/adminUrl` = `https://us-central1-foodhubbie-10.cloudfunctions.net/tenantOnboarding`
  (set live and read back; rule = signed-in non-anonymous, like
  `config/mediaUrl` / `config/notifyUrl`).
* `SupremeAdmin/js/firebase-config.js` resolves `config/tunnelUrl` and
  `config/adminUrl` in one `TUNNEL_READY` promise; `window.TUNNEL_URL` stays the
  control API, `window.ADMIN_API_URL` becomes `adminUrl` when present and falls
  back to the tunnel otherwise. Deleting the function restores the old
  behaviour with no client deploy.
* All 4 call sites await `TUNNEL_READY` then use
  `window.ADMIN_API_URL || TUNNEL_URL`: approve (`onboarding-requests.js`),
  wizard password (`restaurant-onboarding.js`), profile password +
  outlet-admin-status (`restaurant-profile.js`, 2 sites).
* The CORS allowlist is the same 4 dashboards + rider + localhost reused from
  23d-1; the handler strips the leading `/tenantOnboarding` so both
  `/api/...` and `/tenantOnboarding/api/...` resolve, and the preflight answers
  on the sub-path.

## 4. What is deployed

| item | value |
|---|---|
| function | `tenantOnboarding` (us-central1, 256 MiB, 120 s, nodejs22, max 10 instances, secret `FIREBASE_DATABASE_URL`, CORS = dashboards + rider + localhost) |
| rules | `config/adminUrl` read = `auth != null && sign_in_provider != 'anonymous'` |
| dashboard | Supreme hosting rebuilt from a **clean worktree at `958b4bb`**, live `version.json` = `958b4bb.20261113T122907Z` |
| RTDB | `config/adminUrl` set, read back identical |

`functions:list` shows 17 v2 functions. `tenantOnboarding` was created (not
updated), so no live route changed until the client read the new URL key.

## 5. Live verification

### The endpoint itself - 71/71

`%TEMP%/opencode/e2e-23d3-onboarding.cjs` against the deployed URL with real
Firebase Auth + RTDB, throwaway Supreme/support/tenant/admin users, and a
byte-identical restore of every fixture (`meta/outletCounter`, `menuBank`,
`admins`, `onboardingRequests`/`Secrets`, `businesses`, `walletBilling`,
`outletIndex`, Auth users) - cleanup runs in a `finally`, so a failed check
still restores.

| group | proven |
|---|---|
| routing/auth | `/health` 200 `{ok:true,service:'tenant-onboarding'}`; no token 401; junk token 401; plain tenant admin 403 `Not a Supreme Admin`; unknown route 404; wrong method on a known route 405 |
| CORS | `app.foodhubbie.in` echoed on preflight; a foreign origin gets no ACAO |
| D2 status | legacy outlet `null/null`; unverified owner `emailVerified:false` + `uid` + `disabled:false`; view-only Supreme may read; missing Auth user `missing:true`; missing `oid` 400 |
| update-password | view-only 403; missing fields 400; 5-char password 400; first save creates the Auth user and **the login works**; `admins` mirror is owner-scoped to the tenant; `adminLogin` holds email + `passwordUpdatedAt` and **no password**; second save reuses the same uid; the new password works and the old one is dead; `passwordUpdatedAt` bumps; an existing `admins` row is not clobbered |
| approve (authUid) | view-only 403; missing fields 400 and no tenant created; success returns the **existing** uid + `loginUrl`; business name/plan/contact; outlet locked + WhatsApp pending + plan features; email-only `adminLogin`; `outletNo` from the counter; wallet defaults (percentage, setup ₹0, caps, 15 tokens) on `walletBilling` and **no** tenant-writable `billing`; `outletIndex`; owner `admins` mirror; request approved + stamped + inline password cleared; the signup password still signs in; second approve 409 |
| approve refusals | email change 422; missing account 422; Auth email mismatch 422; unknown request 404; refusals never stamp `bid` |
| legacy replay | stored secret replayed into Auth; secret node burned; inline password burned; `outletNo` incremented exactly once |
| retry | already-stamped request keeps `bid`/`oid`; assigned `outletNo` reused; counter untouched |
| template | template data spread into the outlet but identity/security win; `menuBank` mirrors every template category **and** dish with the new tenant as `sourceBid`/`sourceOid` |

### The deployed dashboard - 28/28

`%TEMP%/opencode/e2e-23d3-client.cjs` at
`https://foodhubbie-supremeadmin.web.app/` (deployed bundle, real password
sign-in, real CORS):

* sign-in opens the shell; `window.ADMIN_API_URL` **is** the function while
  `window.TUNNEL_URL` is still `https://api.foodhubbie.in` (other routes
  unaffected);
* the seeded signup request renders with Approve; clicking it (with the
  confirm dialog) posts **once** to
  `.../tenantOnboarding/api/admin/approve-onboarding`, **zero** calls to
  `api.foodhubbie.in`, and the tenant is really created (locked, email-only,
  wallet on the root);
* the success dialog reports the outlet; the request leaves the Pending view
  and appears under Approved after the 5 s refresh;
* profile → Access → Unlock posts the status check to the function, shows the
  control API's "hasn't verified their email yet" refusal, and `locked` stays
  `true`;
* 0 page errors, 0 console errors (quota noise filtered);
* full cleanup (tenant, `walletBilling`, `outletIndex`, request, admins rows,
  Auth users) and `meta/outletCounter` restored to its pre-run value.

The first client run failed at the Unlock click. The cause was the harness, not
the product: a successful approval opens a **second** dialog ("Outlet Created"),
and navigating away from it leaves it in `#modal-root`, where it intercepts the
next screen's clicks. A real operator clicks it away. The harness now dismisses
it and asserts no modal is left open before the unlock path.

## 6. Three details the live runs settled

* **`POST /health` answers 404, not 405.** `/health` is not in the function's
  `KNOWN_ROUTES` map, so it falls through to the unknown-route branch; known
  routes still answer 405. `/health` has no control-API equivalent (it is a new
  liveness probe), so this is accepted rather than emulated.
* **The burned `adminPassword` field is absent, not `null`.** RTDB deletes on a
  `null` write, and the rule forbids any non-null value; the control API
  produces the same shape. An assertion for `=== null` reads `undefined` and
  fails - check `!('adminPassword' in request)`.
* **Approving with a template can re-stamp existing `menuBank` entries.** The
  bank is a slug-keyed map, and the pizza template *is* the live pizza menu, so
  `template:'pizza'` overwrites `sourceBid`/`sourceOid`/`updatedAt` on entries
  that already exist. That is the ported behaviour (last write wins), not new
  to this batch; the harness snapshots and restores the bank byte-for-byte.

## 7. Honest limits

* **Not yet the only implementation.** `server.js` keeps its copy until the box
  is back and 23d finishes. While `config/adminUrl` points at the function the
  dashboard uses the function; nothing else calls these routes.
* **No auto-approval yet.** Website signups still need a human Approve click;
  the auto-approve trigger + 72 h unverified cleanup are 23d-4, and they reuse
  `approveOnboardingRequest()` from this module so there is one approval core.
* **The legacy password replay is a one-release branch.** It exists to drain
  pre-cutover requests; once none are pending it should be deleted on both
  sides together.
* **D2 is still an Unlock-time gate.** The function reports
  `emailVerified`; it does not block a tenant from configuring itself, by
  design (a failed verification lookup must not trap a tenant).
* **`meta/outletCounter` is global.** A failed approval that already consumed a
  number leaves a gap in `outletNo` sequence - acceptable (duplicates would not
  be), and the retry path deliberately reuses the stamped number.
* **Approving is a real side effect.** Any harness that approves must restore
  `meta/outletCounter` (and the template `menuBank` entries) itself; the
  endpoint cannot know it is under test.
* Admin SDK `Reference` has `.transaction`, not `.runTransaction`; the approval
  path uses `runTransaction` helpers only where they exist in the vendored
  `admin.ts`, and mutations there are single `update()`/`set()` calls.

## 8. Files

* `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantOnboarding.ts` - the three
  routes + `approveOnboardingRequest()` (the future auto-approval core).
* `FIREBASE_SERVER_MIGRATION/functions/src/shared/http/tenant.ts` -
  `supremeFromToken` / `requireSuperRole` added; all routes share one
  body/route/token layer.
* `FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs` - ships
  `shared/billing-defaults.cjs` (+ load assertion on `getBillingDefaults`).
* `SupremeAdmin/js/firebase-config.js` - `ADMIN_API_URL` = `config/adminUrl` →
  tunnel fallback, resolved inside `TUNNEL_READY`.
* `SupremeAdmin/js/features/{onboarding-requests,restaurant-onboarding,restaurant-profile}.js`
  - the 4 call sites switched to `ADMIN_API_URL`.
* `database.rules.json` - `config/adminUrl` read.
* `tests/functions-source.check.cjs` - 117 checks (was 83), including the
  email-only `adminLogin`, wallet-on-root, `outletIndex`, template-before-identity
  ordering, prototype-not-reused and per-file override assertions.
* Harnesses: `%TEMP%/opencode/e2e-23d3-onboarding.cjs` (71/71),
  `%TEMP%/opencode/e2e-23d3-client.cjs` (28/28).
