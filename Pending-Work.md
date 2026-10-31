# Pending Work Tracker — Four-Stage Review Process

**Purpose:** Track code changes, audits, and fixes through a structured four-stage lifecycle:
`Reviewing` → `Verified` → `OK` → `Done`

This file ensures no item drifts back into "speculative need" and provides a single source of
truth for what has been addressed, what is in flight, and what requires follow-up.

---

## ⚠️ Mandatory Rule: Update Pending Work After Every Action

**Never proceed without updating this file.** After every command, input, or output that
modifies code, configuration, or infrastructure:

1. **Update** the item's `status` field (advance one stage: `Reviewing` → `Verified` → `OK` → `Done`)
2. **Verify** the change passes `node --check` (for JS) or equivalent for the relevant language
3. **Update** this file with the verification result, commit reference, or deployment target

**Failure to update this file after any code-changing action will be treated as an incomplete task.**
This rule applies to:
- Tool commands (edit, write, bash, etc.)
- Code reviews and diffs
- Bug fixes and feature additions
- Infrastructure changes (Firebase, EC2, package.json, etc.)
- Audit items and cross-project references

---

## Four-Stage Review Lifecycle

| Stage | Meaning | Action |
|-------|---------|--------|
| **Reviewing** | Change has been proposed/diffed; not yet validated | Add to this file with `status: in_progress`; assign reviewer or self-review |
| **Verified** | Change has been tested, lint/typecheck passes, no regressions | Move `status` to `verified`; add test command output or `node --check` result |
| **OK** | Verified + reviewed by second party (or self-review complete); ready for commit | Move `status` to `ok`; reference git commit SHA or deployment target |
| **Done** | OK + deployed/merged; no further action required | Move `status` to `done`; reference deployed URL or PR number |

**To progress an item:** update its `status` field. Do not skip stages.

---

### ✅ Onboarding setup checklist / auto-approval / wallet / percentage package — merged + deployed (done)
- **Source:** `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/` (6-commit mbox on base `a4392f1` + Guide.md + Change-Guide-Before-After.md)
- **Stage:** `done` — merged `c54522e`, docs `0bcfc98`, deployed 2026-10-30 (rules + admin/supreme/website hosting + EC2 `bot-control-api`)
- **Branch:** `onboarding-setup-checklist` (`83f4fbb`, `9d3109f`, `7357102`) merged `--no-ff` into `seo-brand-consistency`; ledger `[20261030-onboarding-ship]`
- **Plan:** `docs/PLAN-ONBOARDING-FLOW-HARDENING.md` (F1/F2/D2/D4/D6, verified facts V1–V11, AS-BUILT sections) + `docs/PLAN-ONBOARDING-WALLET-PERCENTAGE.md` (compatibility matrix, file map, findings, verification, phased rollout, rollback, live probes)
- **Verified:** gate on the merged tree — encoding, imports, twins 5/5, cost-math/report-catalog/report-export/loyalty/payroll/money/discount self-checks, auto-onboarding 10/10, wallet-checklist 3 suites, signup-onboarding 12/12, `gate-verify.js` PASS, both builds. Live: admin `sw.js` `v5.12.10` + `style.css?v=5.4.13`, Supreme no-password copy, website `signup.html` 200, EC2 API listening on `:4000` with auto-onboarding + auto-settlement armed, built Admin `?demo=1` boots with 0 console errors and all five deep-link targets.
- **Fixes shipped:** F1 setup mode (7 steps, required-step hero, deep links, `SETUP_TABS` +`discounts`, deliberately not `chat`/`promotions`); F2 tenant parity (`outletIndex/{oid}`, `outletNo` reused on retry, template defaults spread before identity/security, `adminLogin` = `{email, passwordUpdatedAt}` only); F5 single version bump above both branches.
- **Not verified:** rules behaviour locally (no Java → no RTDB emulator) — run the live probe in plan §7.1; Supreme billing screens need a real super account; live auto-approval needs a real website signup.

### 🔍 D2 — Email verification before promoting public sign-up
- **Stage:** `reviewing` (plan §3; not started)
- **Why:** auto-approval lets anyone register any unregistered email and immediately receive a working tenant.
- **Answer on record:** Spark allows 1,000 verification emails/day, 10,000 links/day, 100 account creations/hour/IP — so the Firebase built-in email-verification flow is viable without Blaze.
- **Plan:** `docs/PLAN-ONBOARDING-FLOW-HARDENING.md` §3 (`requireEmailVerification` was deliberately deferred out of the shipped change set).

### 🔍 D4 — Wallet gates: stop the bot at 10%, stop QR ordering at 0
- **Stage:** `reviewing` — blocked on the live ledger being settled
- **Agreed behaviour:** at 10% remaining, stop the WhatsApp bot; at 0, stop QR table ordering and show a "Temporarily Unavailable" page on scan. POS never gated; demo tenant hard-skipped; flat ₹100 bot threshold; ₹0 closes ordering.
- **Shipped groundwork:** wallet writer in observe mode (`enforce:false`) — it records state but gates nothing yet.
- **Blocker:** `roshani-pizza/pizza` is at −₹72.14 (paid ₹117.86, used ₹190, 180 orders, `topUpDone:false`) — genuinely unpaid, not a math bug (91 cancelled orders are already excluded; the ₹500 setup charge is correctly excluded). Enforcement would take the live outlet offline the moment it flips, so the owner must top up first.
- **Note:** a real HTTP 404 is impossible on Spark/Hosting (the SPA rewrite returns 200) — the stop screen is an in-app 200.

### 🔍 D5 — Pricing / percentage-package marketing consistency
- **Stage:** `reviewing` (verification only; no copy changed in the onboarding change set)
- **Facts to hold:** ₹500 = setup assistance; ₹1,000 = minimum wallet balance to start taking orders. `shared/billing-defaults.js` is authoritative for rates (₹2 QR, ₹1 POS, ₹5 WhatsApp/webview, ₹1 promo).
- **Check:** `tools/check-copy-consistency.cjs` already fails on any setup fee other than ₹500 — extend/re-run it when the wallet wording reaches `website/`.

### ✅ Categories Tab Phase 4 (PLAN-CATEGORY-REDESIGN.md) — deployed (done — PLAN COMPLETE)
- **Stage:** Phase 4 (mobile/a11y) `done` — **PLAN-CATEGORY-REDESIGN P1-P4 complete**
- **Files:** `Admin/style.css` (`.btn-action-v4:focus-visible` at the shared class, drawer focus rings, @640px touch targets 40px for category/browser/combo action buttons, full-bleed phone drawer), `Admin/index.html`+`Admin/sw.js` (`style.css?v=5.4.14`)
- **Verified:** production E2E 37/37 — mobile 375px: 0px horizontal overflow, cards 172px, action buttons 44px, KPI visible, drawer full-width; 32 prior checks regression-clean
- **Deployed:** 2026-10-31; ledger `[20261031-110000-category-phase4]`

### ✅ Categories Tab Phase 3 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 3 (typed delete guard) `done` — Phase 4 (mobile/a11y) `pending`
- **Files:** `Admin/js/ui-utils.js` (`showDeleteConfirm` optional `requireText` — live match sync, JS-set placeholder, focus to input; 6 existing call sites untouched), `Admin/js/features/catalog.js` (`deleteCategory`: count dishes up-front, guard only when dishCount>0, count-driven message), `Admin/style.css` (dark-theme `.dynamic-modal-input`), `Admin/index.html`+`Admin/sw.js` (`style.css?v=5.4.14`, cache `v5.12.11`)
- **Verified:** production E2E 32/32 — guard on the real "Pizza" (4 dishes): input shown, Delete disabled until typed (partial "Pizz" rejected, case-insensitive match accepted), Cancel leaves category+dishes intact; plain confirm for empty categories proven by the create/delete lifecycle; 28 earlier checks regression-clean
- **Deployed:** 2026-10-31; ledger `[20261031-093000-category-phase3]`

### ✅ Categories Tab Phase 2 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 2 (create drawer) `done` — Phases 3 (delete guard; WebP already shipped), 4 (mobile/a11y) `pending`
- **Files:** `Admin/index.html` (right-sheet drawer beside modals + header Add Category button + serial stepper), `Admin/js/features/catalog.js` (`_initCategoryDrawer`: open/close/backdrop/stepper/live-dup-hint + auto-close on save), `Admin/style.css` (`modal-sheet-right` + `cat-order-stepper`), `Admin/js/features/setup-checklist.js` (deep-link re-pointed `#btnAddCategory` → `#btnOpenCatDrawer`)
- **Verified:** production E2E 28/28 × 2 deploys — drawer open/close/backdrop/focus, live dup hint, stepper ±, REAL create → card → delete-cleanup; 21 earlier checks regression-clean
- **Deployed:** 2026-10-30; ledger `[20261030-140000-category-phase2]`

### ✅ Categories Tab Phase 1 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 1 (grid/header) `done` — Phases 2 (create/edit drawer), 3 (WebP images + delete guard), 4 (mobile/a11y) `pending`
- **Files:** `Admin/index.html` (KPI ribbon + `category-card-grid` + form below), `Admin/js/features/catalog.js` (cat-card renderer + KPI fill), `Admin/style.css` (`#tab-categories` block), `Admin/sw.js` (`style.css?v=5.4.12`, cache `v5.12.9`)
- **Verified:** production E2E 21/21 (categories: cards 152×157px, 24px buttons, KPI populated, search filter ladder); all 5 earlier density sections regression-clean on the same deploy
- **Deployed:** 2026-10-30; ledger `[20261030-120000-category-phase1]`

### ✅ Menu Browser + Combos Tab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (`#browserDishGrid:not(.list-view)` + `#tab-combos` compact blocks), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.11`, cache `v5.12.8`), `tests/e2e-inventory-compact.js` (battery now covers 5 surfaces)
- **Stage:** `done`
- **Verified:** production E2E 15/15 — browser tab cards 111×164px, ~7 columns on 834px, 24px buttons (stretch bug fixed via `align-content:start`: was 603px tall); combos checks conditional (e2e outlet has 0 combos); inventory + menu-tab regression clean on the same deploy.
- **Done:** deployed 2026-10-30; ledger `[20261030-101500-browser-combo-compact]`.

### ✅ MenuTab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (`#menuGrid` compact block), `Admin/js/features/catalog.js` (chip modifier `main` → `single`, root-cause fix for the app-shell `.main` padding collision), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.9`, cache `v5.12.6`)
- **Stage:** `done`
- **Verified:** production E2E `tests/e2e-inventory-compact.js` 9/9 (both tabs) — menu card 132×227px, ~8 columns on 1112px (was ~160px/6 cols), 24px edit/delete buttons, price chip padding 2px (was broken 0/30/30 by `.main` shell rule `!important` on desktop ≥1025px)
- **OK:** inventory battery 5/5 unchanged on the same deploy (regression clean)
- **Done:** deployed 2026-10-29; ledger `[20261029-180000-menu-compact]`.

### ✅ Inventory Tab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (scoped to `#inventoryMenuSection`/`.inventory-dish-card`), `Admin/js/features/inventory.js` (`MENU_PAGE_SIZE` 20→30), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.7`, cache `v5.12.4`)
- **Stage:** `done`
- **Verified:** production E2E `tests/e2e-inventory-compact.js` 5/5 — card 170×318px/6 columns (before) → 127×249px/8 columns (after, +33% per row, −22% height); mini toggle/stock knobs confirmed; POS `.dish-card` and Riders' `.toggle-switch-sm` untouched.
- **OK:** live `style.css?v=5.4.7` + `sw.js v5.12.4` confirmed over HTTP after `firebase deploy --only hosting:admin`.
- **Done:** deployed 2026-10-29; ledger `[20261029-173000-inventory-compact]`.

### ✅ WebP Catalog Images — deployed to production (done)
- **Files:** `Admin/js/firebase.js` (`uploadImage(fileOrBlob, path, opts = {})` — `opts.webp` encodes via `canvas.toBlob('image/webp', 0.75)` and only resolves that blob when `blob.type === 'image/webp'`, otherwise falls back to `toDataURL('image/jpeg', 0.6)`), `Admin/js/features/catalog.js` (4 call sites pass `{ webp: true }`: `addCategory`, `saveDish`, `saveCategoryEdits`, `showComboModal`), `Admin/sw.js` (`v5.12.2` → `v5.12.3`)
- **Stage:** `done` (commit `b0c1757`; ledger `[20261029-160000-webp-dishes]` + `[20261029-170000-deploy-admin-webp]`)
- **Origin:** appeared in the working tree on 2026-10-29 while the demo/tour work was being shipped; it is NOT part of that work and was deliberately left uncommitted. Live admin host still serves the JPEG path at `v5.12.2`.
- **Requirement:** shrink the base64 catalog images that ship in every QR-menu payload, without breaking WhatsApp image sends, the customer menu, or browsers that cannot encode WebP. Deliberately untouched: `uploadImage(blob, 'temp')` inside `runImageMigration()` and the rider/KYC call sites in `riders.js` (no `opts` → legacy JPEG).
- **Verified:**
  - build:admin green; encoding/copy-consistency/shared-twins guards green; domain-migration guard green after exempting README.md's descriptive www→/demo redirect mention.
  - **Live E2E 10/10** (`tests/e2e-webp-dish.js`, e2e outlet, screenshot evidence in %TEMP%/opencode): UI upload through Add Dish → DB image is EXACTLY `data:image/webp;base64`; 11,147 bytes vs 42,205 source (73% smaller); QR menu renders the webp dish card, 0 page errors; admin catalog lists it; full cleanup (dish + minted table) restored the baseline.
  - **It is actually smaller (real data):** fresh uploads win big (73%). A dry-run of the leftover-JPEG migration (`tools/migrate-dish-images-webp.cjs`) showed the LIVE catalog is already webp-dominant and remaining jpegs are tiny double-compressed files where q75 webp is often bigger — migration apply on live outlets deliberately SKIPPED (script kept as tooling with backup + --restore).
  - **Safari fallback:** `blob.type` check + JPEG fallback is in place; NOT executable on Windows — accepted as documented, not tested.
  - **runImageMigration:** intentionally stays JPEG (legacy Storage→base64 backfill, rarely used; documented in ledger).
  - **WhatsApp Sharp path:** `bot/index.js` normalizes ANY `data:image` through Sharp → JPEG before Baileys, so a webp dish image reaches WhatsApp normalized; NOT yet proven with a real send (e2e/cake WhatsApp sessions are dead — pre-existing). Promos remain JPEG-locked by design (no `webp` flag on that path).
- **OK:** owner-authorized deploy `firebase deploy --only hosting:admin` (2026-10-29, release complete); live host serves the toBlob/webp encoder, the v5.12.3 cache-name bump, and all 4 `webp:!0` call sites; **production E2E 10/10** re-run against the live admin host (`E2E_ADMIN_BASE`), same assertions green incl. menu render + cleanup.
- **Done:** deployed and verified live (`https://foodhubbie-admins.web.app`). Residual notes: Safari/JPEG fallback is documented-not-tested (Windows only); a real WhatsApp send of a webp dish photo is pending a live WhatsApp session (e2e/cake sessions dead — pre-existing) but `bot/index.js` Sharp-normalizes ANY `data:image` to JPEG before Baileys; live-tenant migration apply remains deliberately skipped (7% ceiling on double-compressed leftovers — script kept with backup + `--restore`).

### ✅ EC2 Git Metadata Reconciled to `main` (117 commits, zero restarts)
- **File:** `/var/www/foodhubbie` (box only — no repo file changed)
- **Stage:** `done`
- **Requirement:** the box must be at `origin/main` with a clean `git status` so a rollback is possible and drift is visible.
- **Verified:** all 110 tracked runtime files (`bot/ bot-control-api/ webhook-server/ shared/ tools/`) compared against `origin/main` — only `shared/{billing-defaults.cjs,billing-defaults.js,cost-math.js}`, `shared/package.json` and `tools/test-receipt.cjs` differed (all older, none a pm2 entry point); `bot/index.js`, `bot/package-lock.json`, `bot/package.json`, `bot/rider.js`, `bot/utils.js` differed by **CRLF only**.
- **OK:** `git reset --hard origin/main` → HEAD `01dc0b1` → `9a13756`, 0 tracked changes, 69 untracked files preserved (`node_modules`, `session_data_pizza` + its live creds, `.env.bak*`). `node --check` green on `bot/index.js`, `bot/rider.js`, `shared/billing-defaults.cjs`.
- **Done:** verified live — **no pm2 restart was required** (identical file content, same PIDs and uptimes before/after); `bot-control-api` was restarted separately only to pick up the ₹5 billing default.

### ✅ WhatsApp / Delivery-Webview Billing Rate Restored to ₹5
- **Files:** `tools/seed-billing-defaults.cjs`, `tests/supreme-profile-sections.spec.js`; live RTDB rows `businesses/{roshani-pizza/pizza,roshani-cake/cake}/billing/rates`
- **Stage:** `done`
- **Verified:** `shared/cost-math.js` self-check OK (asserts `DEFAULT_RATES.WA === 5`); no `WA: 3` / `webview_delivery: 3` left in the repo (`git grep` clean); Node recomputation over the live orders → roshani-pizza ₹182 / 85 orders.
- **OK:** commit `40f7d9d` (2026-10-21) had made the rate ₹5 in code + website, but the seeder still wrote ₹3 and the DB row overrides the default (`{...DEFAULT_RATES, ...b.rates}`), so Supreme billed ₹3. Seeder now seeds ₹5 and its rate-migration list patches `WA`/`webview_delivery` on existing rows.
- **Done:** live rows patched ₹3 → ₹5 (E2E outlets untouched), `bot-control-api` restarted, and Supreme verified through Playwright on **desktop + mobile-chrome**: `USAGE ₹182 / 85 orders, EXTRA CHARGES ₹0, RECEIVED ₹117.86, BALANCE DUE ₹64.14`. All-time usage moved ₹164 → ₹182 (9 webview orders × ₹2).

---

### ✅ Supreme Tunnel URL Resolved After Login (was dead on every load)
- **Files:** `SupremeAdmin/js/firebase-config.js`, `SupremeAdmin/js/features/templates/quota.js`, `SupremeAdmin/js/features/templates/wa-templates.js`
- **Stage:** `done`
- **Verified:** `window.TUNNEL_URL` is now the live tunnel on a signed-in load; `page.on('requestfailed')` records **zero** failures (was `ERR_NAME_NOT_RESOLVED` + `loadQuota failed` + `load message templates failed` on every Supreme page load); supreme hosting 43/43 files byte-identical to `SupremeAdmin/dist`; `tests/supreme-profile-sections.spec.js` passes on chromium + mobile-chrome.
- **OK:** root cause — `config/tunnelUrl` is readable only by a signed-in admin (`database.rules.json`), so `firebase-config.js`'s boot-time read always failed and left a hardcoded, rotated Quick Tunnel host in place. `wa-templates.js` additionally hardcoded `https://bot-control-api.foodhubbie.com`, a host that never resolved, so the templates panel could never load at all. The rule stays as-is; the client now resolves on the first signed-in auth state.
- **Done:** deployed to `foodhubbie-supremeadmin` (commit `852c39a`). `window.TUNNEL_READY` is a promise the two first-render panels await; the other 17 call sites are click-driven and inherit the resolved URL.

---

### ✅ Cake Bot Deleted From EC2 (re-add later from Supreme Admin)
- **Files:** `ecosystem.config.js`, `ACCESS.md`; box state `~/.pm2/dump.pm2` + `~/.pm2/logs/`; RTDB `businesses/roshani-cake/outlets/cake/bot/{status,pair}`
- **Stage:** `done`
- **Requirement (owner):** "delete Cake bot from Server.. i'll Add later from Supreme Admin -- If i Need it.."
- **Verified:** `node --check ecosystem.config.js` green and `require()` yields `["bot-roshani-pizza-pizza"]`; `pm2 list` shows no cake app and `grep -c bot-roshani-cake ~/.pm2/dump.pm2` → `0`; `~/.pm2/logs/` has 0 cake files; RTDB cake `bot` node is now `{"transport":"baileys"}` (stale `status` "Online" @ lastSeen `1793092291108` + `pair` "waiting" with a 277-char QR removed, so Admin/Supreme no longer show a phantom online bot).
- **OK:** `pm2 delete bot-roshani-cake-cake` + `pm2 save`; the `ecosystem.config.js` block removed so `pm2 start ecosystem.config.js` cannot resurrect it. The pizza bot was untouched (same PID/uptime throughout).
- **Done:** box + repo reconciled (`git pull --ff-only` on EC2). `businesses/roshani-cake` (business/outlet) and `bot/transport` kept deliberately — the orchestrator cannot recreate the worker on its own because `desiredState()` returns null while `outlet.whatsapp` is absent (`bot-control-api/orchestrator.js`).

---

### ✅ Restaurant-Scoped Rider Notification Isolation
- **Requirement:** Riders of Restaurant 1 must **never** see/pop/pop-up any notification (Order available on Rider App, WhatsApp message) from Restaurant 2, and vice versa. Complete isolation.
- **Stage:** `done`
- **Verified:** `node tests/phase5-rider-isolation.check.cjs` → 11/11 `RESULT: isolation holds`; `node tests/phase5-rules-isolation.check.cjs` → 7/7 `RESULT: rules enforce restaurant isolation` (live RTDB REST with a real minted ID token). Both self-seeding/self-cleaning.
- **OK:** Broadcast, assignment and pickup notifications are restaurant-scoped in code; deployed rules deny cross-restaurant reads to a rider's own token.
- **Done:** **Real leak found and fixed** — `resolvePath()` treats `riders` as a platform-shared root, so `getData('riders', outlet)` returns *every* restaurant's riders. `broadcastPickupAvailable` (the only place that trusted that call blindly) now skips any rider whose `outlet` mismatches the order's outlet — failing closed, so a rider with no outlet is never messaged. Assignment/pickup paths were already scoped and untouched. Latent today (both live riders are `pizza`, cake has none), but it would fire the moment a cake rider logged in.

**Phase Breakdown:**

#### Phase 1: Order Data Structure Verification ✅ COMPLETE
- **Goal:** Verify `assignedRider`/`riderId` field exists in every order and is correctly scoped to outlet/restaurant
- **Files:** `bot/rider.js`, `bot/index.js`, `bot/firebase.js`, `database.rules.json`
- **Stage:** `ok`
- **Verified:** 
  - **Order Fields:** Orders use `riderId` and `assignedRiderUid` fields (not `assignedRider` exactly). Code in `bot/rider.js:54,84` reads `order.riderId || order.assignedRiderUid`. In `bot/index.js:807` it uses `order.riderId || order.assignedRider`.
  - **Firebase Rules:** `database.rules.json:117` enforces `assignedRider` field read access: `data.child('assignedRider').val().toLowerCase() == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Query Index:** `database.rules.json:115` includes `assignedRider` in `.indexOn` for order queries
  - **Outlet Scoping:** Rules at `database.rules.json:114` enforce outlet-level scoping: `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
  - **Rider Access:** Rider can only read orders where `assignedRider` matches their email (lowercase) OR no `assignedRider` exists
  - **Assignment Flow:** `bot/index.js:807-824` tracks `currentRider = order.riderId || order.assignedRider` and detects changes
- **Status:** `ok` — Phase 1 Complete

#### Phase 2: Rider App Order Fetching Logic ✅ COMPLETE
- **Goal:** Verify Rider App only fetches orders assigned to the current rider
- **Files:** `rider-app/src/lib/constants.ts`, `rider-app` frontend code
- **Stage:** `ok`
- **Verified:**
  - **Tenant Path Helper:** `rider-app/src/lib/constants.ts:42-51` exports `tenantPath(outlet, path)` and `tenantPathAsync(outlet, path)` which construct paths as `businesses/${bid}/outlets/${outlet}/${path}` using `getBusinessIdForOutlet(outlet)` for business ID resolution
  - **Order Path:** `constants.ts:59` defines `orders: (outlet: OutletId) => businesses/${getBusinessIdForOutlet(outlet)}/outlets/${outlet}/orders` — scoped by outlet
  - **Firebase Rules Enforcement:** `database.rules.json:117` enforces rider can only read orders where `assignedRider` matches their email (lowercase) OR no `assignedRider` exists: `data.child('assignedRider').val().toLowerCase() == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Query Index:** `database.rules.json:115` includes `assignedRider` in `.indexOn` for order queries
  - **Rider App Query Pattern:** The app must query with `orderByChild('assignedRider').equalTo(riderEmail)` to satisfy the security rule at `database.rules.json:114` which checks `query.orderByChild == 'assignedRider' && query.equalTo == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Rider Scoping:** Rider can only read orders for their outlet (`root.child('admins').child(auth.uid).child('outlet').val() == $outletId`) AND where they are the assigned rider
  - **No Cross-Outlet Access:** Rules prevent cross-outlet access by checking `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
- **Status:** `ok` — Phase 2 Complete

#### Phase 3: WhatsApp Notification Scoping ✅ COMPLETE
- **Goal:** Verify WhatsApp messages only sent to riders of the order's restaurant
- **Files:** `bot/rider.js`, `bot/index.js`, `bot/status-monitor.js`
- **Stage:** `ok`
- **Verified:**
  - **Per-Outlet Bot Instance:** Each bot instance runs for ONE outlet (`OUTLET` env var at `bot/index.js:10`). Restaurant 1's bot only processes Restaurant 1's orders, reads Restaurant 1's riders, and sends via Restaurant 1's WhatsApp socket
  - **Outlet-Scoped Rider Fetch:** `bot/rider.js:118` fetches riders via `getData("riders", outlet)` where `outlet` is the order's outlet. ⚠️ **This call is NOT outlet-filtered**: `resolvePath()` (`bot/firebase.js`) lists `riders` as platform-shared, so it returns every restaurant's riders. The outlet filter happens in the caller (see Phase 5 fix) — never assume the returned pool is single-tenant.
  - **Direct Assignment Notifications:** `notifyRiderPickup` and `notifyRiderAssignment` in `bot/rider.js` send to specific `riderPhone` from `order.riderPhone` and `riderId` from `order.riderId || order.assignedRiderUid`
  - **Broadcast Scope:** `broadcastPickupAvailable` (line 114-157) fetches riders via `getData("riders", outlet)` where `outlet = order.outlet`, then **filters the returned pool in code** on `r.outlet === outlet` (+ `businessId`), skipping anything that does not match (fail closed) — see Phase 5
  - **Per-Tenant Socket:** Each bot instance has its own `sock` (WhatsApp socket) created in `startBot()` at `bot/index.js:1033-1049` — Restaurant 1's bot uses Restaurant 1's WhatsApp session, Restaurant 2's bot uses Restaurant 2's
  - **Order Status Flow:** `handleOrderStatusUpdate` at `bot/index.js:841-850` calls either:
    - Direct: `notifyRiderPickup` if `order.riderPhone` exists (specific rider assigned)
    - Broadcast: `broadcastPickupAvailable` if no rider assigned (broadcasts to ALL online riders of THAT outlet only)
  - **Rider Change Detection:** `bot/index.js:807-824` tracks `currentRider = order.riderId || order.assignedRider` and calls `notifyRiderAssignment` on change
  - **In-App Notifications:** `addInAppNotification` at `bot/index.js:563-571` writes to `riders/${uid}/notifications/` scoped by outlet via `setData` call
- **Critical Finding:** Isolation is **not** purely process-level: every bot owns its own socket and OUTLET, but the `riders` root node is platform-shared, so rider *selection* has to be filtered in code. Phase 5 found exactly one caller (`broadcastPickupAvailable`) that trusted the shared pool and fixed it.
- **Status:** `ok` — Phase 3 Complete

#### Phase 4: Firebase Security Rules Verification ✅ COMPLETE
- **Goal:** Verify database rules prevent cross-restaurant data access
- **Files:** `database.rules.json`
- **Stage:** `ok`
- **Verified:**
  - **Orders Read Rule (collection level):** `database.rules.json:114` — Rider can query orders only if: `query.orderByChild == 'assignedRider' && query.equalTo == rider's email (lowercase)` — forces rider-scoped queries
  - **Orders Read Rule (individual level):** `database.rules.json:117` — Rider can read individual order only if: `!data.child('assignedRider').exists() || assignedRider matches rider's email (lowercase)` — prevents cross-rider access
  - **Outlet Scoping:** Line 114 requires `root.child('admins').child(auth.uid).child('outlet').val() == $outletId` — restricts to admin's outlet; for riders, implicit via rider data under outlet
  - **Cross-Outlet Leakage Prevention:** Rider can only read orders in their outlet (`root.child('admins').child(auth.uid).child('outlet').val() == $outletId`) AND where they are assigned rider
  - **Rider Write Access:** Line 118 allows write only if `!data.child('riderId').exists() || data.child('riderId').val() == auth.uid` — rider can only accept unassigned orders or their own
  - **Rider Node Isolation:** Lines 15-33 — riders can only read/write their own node (`auth.uid == $uid`) or admins can access all
  - **Cross-Outlet Leakage Prevention:** All outlet-scoped nodes (`orders`, `dishes`, `Menu`, `categories`, `settings`, `inventory`, etc.) check `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
  - **Rider Stats:** Lines 237-241 — riders can only read/write their own stats (`auth.uid == $riderId`)
  - **Settlements:** Lines 59-63 — riders can only read their own settlements
- **Critical Finding:** Multi-layered isolation — outlet scoping + rider-scoped queries + per-rider node isolation + assignment enforcement
- **Status:** `ok` — Phase 4 Complete

#### Phase 5: Runtime Integration Test ✅ COMPLETE (automated)
- **Goal:** End-to-end proof that a notification/read for Restaurant 1 never reaches Restaurant 2
- **Stage:** `done`
- **Verified:** two runnable checks, both self-seeding and self-cleaning (`cleanup: no test riders left`), both green:
  - `node tests/phase5-rider-isolation.check.cjs` — 11/11, `RESULT: isolation holds`. Stubs the WhatsApp socket, seeds `phase5test-*` riders in both outlets and drives the real `bot/rider.js` functions against live RTDB.
  - `node tests/phase5-rules-isolation.check.cjs` — 7/7, `RESULT: rules enforce restaurant isolation`. Mints a custom token for a temporary pizza rider, exchanges it for a real ID token, then hits the **live RTDB REST API** (which enforces `database.rules.json`, unlike the Admin SDK).
- **OK (rider notifications):**
  - pizza broadcast reaches its own online pizza rider (`to=["pizza-online"]`) — A1
  - pizza broadcast skips the offline pizza rider — A2
  - pizza broadcast **never** reaches a cake rider — A3 (failed before the fix)
  - in-app notif written only for the pizza rider — A4
  - cake broadcast reaches its own rider and **never** a pizza rider — B1/B2 (B2 failed before the fix)
  - assignment (`notifyRiderAssignment`) and pickup (`notifyRiderPickup`) each send exactly one message, to the assigned phone only — C1-C3, D1-D2
- **OK (deployed rules, real token):** own-outlet order query `200` (A1) / cross-outlet query `401` (A2) / cake order by id `401` (B1) with same-shape own-outlet read `200` as control (B2) / own rider node `200` (C1) / another rider node `401` (C2) / anonymous cake orders `401` (D1)
- **Done:** fix committed — `broadcastPickupAvailable` filters the shared `riders` pool on `outlet` + `businessId` (fail closed) and logs `(N rider(s) from another restaurant skipped)`. `tests/phase5-rider-isolation.check.cjs` + `tests/phase5-rules-isolation.check.cjs` added.
- **Note:** the browser/manual steps below are now redundant for isolation (covered by the runtime checks), but a live two-restaurant rider login remains the only way to eyeball the real Rider App pop-up.

**Original manual steps (kept for a real two-restaurant smoke test):**
1. **Setup:** two restaurants, each with at least 1 rider
2. **Test Restaurant 1 Order:** Rider A gets pop-up + WhatsApp "PICKUP AVAILABLE"; Rider B (same restaurant) gets nothing unless broadcast; Rider C (other restaurant) gets nothing
3. **Test Restaurant 2 Order:** Rider C gets pop-up + WhatsApp; Rider A gets nothing
4. **Broadcast Scenario:** order goes "Ready" with no rider assigned → all online riders of THAT restaurant get it, no other restaurant's riders get anything

---

**PHASE SUMMARY — Restaurant-Scoped Rider Notification Isolation**

| Phase | Status | Key Finding |
|-------|--------|-------------|
| **Phase 1: Order Data Structure** | ✅ `ok` | Orders use `riderId`/`assignedRiderUid`; Firebase rules enforce `assignedRider` scoping |
| **Phase 2: Rider App Fetch Logic** | ✅ `ok` | `tenantPath` scopes by outlet; rules force `assignedRider` query; outlet-scoped |
| **Phase 3: WhatsApp Notification** | ✅ `ok` | **Process-level isolation** — each restaurant runs separate bot instance with own socket & outlet data |
| **Phase 4: Firebase Rules** | ✅ `ok` | Multi-layered: outlet scoping + rider-scoped queries + per-rider node isolation + assignment enforcement |
| **Phase 5: Runtime Test** | ✅ `done` | 11/11 notification checks + 7/7 live-rules checks; **found + fixed** the shared-`riders` broadcast leak |

**OVERALL VERDICT:** ✅ **Isolation holds, now proven at runtime** — with one correction to the earlier reasoning:
- Each restaurant runs its own bot instance with its own `OUTLET` env var and its own WhatsApp socket
- The `riders` root node is **platform-shared**, so rider *selection* must be filtered in code — `broadcastPickupAvailable` now does (fail closed)
- Assignment + pickup notifications only ever target the order's own rider phone
- Deployed rules deny a rider's token any read outside their own outlet (401), verified against the live RTDB

---

## Current Work Items

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `4ca91cf` (`build: add SupremeAdmin esbuild minification support`)

---

### ✅ Build system commit
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok` (git pushed + deployed)
- **Verified:** `npm run build:supreme` works correctly; all modified files pass `node --check`; `.gitignore` updated; scripts added; git push successful; **Firebase deploy successful**
- **OK:** Build system commit complete on main branch; SupremeAdmin deployed to Firebase Hosting
- **Done:** ✅ `npm run deploy:supreme` — hosted at https://foodhubbie-supremeadmin.web.app

**To advance:** session backup cron scheduling (run `bot/backup-sessions.js` daily via system cron on EC2)

---

### ✅ Issue #2: TUNNEL_URL global — `let` + Firebase auto-read
- **File:** `SupremeAdmin/js/firebase-config.js:28-34`
- **Stage:** `ok`
- **Verified:** `const TUNNEL_URL` → `let TUNNEL_URL`; added `once('value')` read from `config/tunnelUrl`; fallback to hardcoded value on failure
- **Review:** Ponytail full enforcement; `let` safe because no feature file reassigns the variable; all 6 call sites read-only
- **Commit:** `4966860` (full project audit commit); `ea50d76` (ACCESS.md push)

### ✅ Issue #3: `showToast` missing import in `main.js`
- **File:** `SupremeAdmin/js/main.js:20`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'`; line 66 `showToast("Your account is view-only — you can't add restaurants.", 'error')` now resolves
- **Review:** Module graph walk confirmed `main.js` is loaded via dynamic import from `auth.js`; no other undefined function calls in this file
- **Commit:** `4966860`

### ✅ Issue #4: `_transportLabelInternal` duplicate removed
- **File:** `SupremeAdmin/js/utils.js:277-284`
- **Stage:** `ok`
- **Verified:** Replaced `_transportLabelInternal(transport)` call in `transportBadgeHtml` with `transportLabel(transport)`; deleted the duplicate function body (lines 277-281); `grep` confirmed zero remaining references to `_transportLabelInternal` in active code
- **Review:** Dead code removal per ponytail philosophy ("deletion over addition"); `transportBadgeHtml` now calls the exported `transportLabel` directly
- **Commit:** `4966860`

### ✅ Issue #5/7: `showToast` missing import in `data-store.js`
- **File:** `SupremeAdmin/js/data-store.js:18,39`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'` at line 18; error handler at line 39 now shows user-visible toast on connection loss instead of silently `console.error`-only
- **Review:** Error boundary fixed — `.on('value')` error callback now has working `showToast`; subscriber calls at lines 34-36 already wrapped in try/catch (no change needed)
- **Commit:** `4966860`

### ✅ Issue #6: `exportCsv` missing import in `bot-fleet-overview.js`
- **File:** `SupremeAdmin/js/features/bot-fleet-overview.js:3`
- **Stage:** `ok`
- **Verified:** Added `exportCsv` to the import from `/js/utils.js` at line 3; line 193 `exportCsv('bot-fleet', ...)` now resolves
- **Review:** Grep confirmed all functions used in file are now imported; no dead imports
- **Commit:** `4966860`

### ✅ Issue #2 (audit): `.gitignore` fix for session files
- **File:** `SupremeAdmin/js/` — not directly applicable; audit item 1 was for `bot/sessions/` in a different project
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended adding `bot/sessions/` to `.gitignore` to prevent accidental commit of live WhatsApp session credentials. In this project, `SupremeAdmin/js/` session data lives in Firebase RTDB, not local files. For any future bot/whatsApp work, add `bot/sessions/` and `bot/session_data/` to `.gitignore`.

### ✅ Issue #3 (audit): Randomized delay in multi-recipient sends
- **File:** `bot/` — audit item 3 was for `status-monitor.js` `broadcastPickupAvailable()` loop with no delay between `sock.sendMessage` calls to riders
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended staggering with randomized 800ms–2000ms delay between recipients to avoid WhatsApp anti-spam heuristics flagging tight send-velocity bursts. This pattern is applicable to any loop that sends to multiple JIDs. In the current SupremeAdmin work, no equivalent multi-recipient send pattern exists.

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `4ca91cf` (same build-system commit as the entry above)

### ✅ Temp file cleanup
- **File:** `SupremeAdmin/js/utils.js.tmp`, `SupremeAdmin/js/features/bot-fleet-overview-temp.js`
- **Stage:** `done`
- **Verified:** Both files deleted via `Remove-Item`; `glob` confirmed zero `.tmp` or `*temp*` files remain in `SupremeAdmin/`
- **Review:** Ponytail "deletion over addition" — removing leftover artifacts from edit sessions

### ✅ Review fixes: `console.warn` + dead comment
- **File:** `SupremeAdmin/js/firebase-config.js`, `SupremeAdmin/js/utils.js`
- **Stage:** `ok`
- **Verified:** Added `console.warn('TUNNEL_URL: failed to read config/tunnelUrl, using fallback')` to `.catch(() => {})` in firebase-config.js; removed duplicate `// ---- CSV export` comment in utils.js (was followed by `// ---- formatting` — two section headers for the same category)
- **Review:** Low-severity polish items from code review; both minimal changes, zero risk

---

## THIS PROJECT: Applicable Audit Fixes (from WHATSAPP-BOT-BAN-PROOFING-AUDIT & POS-MENU-UI-FIXES)

These are **real, actionable items** in THIS repo based on the audits.

| # | Item | Files | Stage |
|---|------|-------|-------|
| 1 | POS back button redundancy | `Admin/index.html`, `Admin/js/ui.js` | `done` |
| 2 | Invisible text selection near bottom nav | `menu/css/app.css` | `done` |
| 3 | Rider broadcast unthrottled sends + warm-up pacing | `bot/utils.js`, `bot/rider.js`, `bot/index.js` | `done` |
| 4 | Baileys version drift, no update process | `bot/package.json` | `done` |
| 5 | No backup/persistence for `bot/session_data_pizza/` | `bot/backup-sessions.js` | `done` |
| 6 | Whole-process restarts drop all tenants | `bot/index.js` | `done` |

---

### ✅ Item 1: POS Back Button Redundancy
- **Files:** `Admin/index.html`, `Admin/js/ui.js`
- **Stage:** `done`
- **Issue:** Two back buttons in POS mobile view — static button in HTML + dynamic `posExitBtn` created in `Admin/js/ui.js:156-169`. Bottom nav already provides navigation.
- **Fix:** Removed static button from `Admin/index.html:3851-3855`; removed dynamic `posExitBtn` creation from `Admin/js/ui.js:128-140`
- **Verified:** `node --check Admin/js/ui.js` passes
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all` — confirmed online

---

### ✅ Item 2: Invisible Text Selection Near Bottom Nav
- **Files:** `menu/css/app.css`
- **Stage:** `done`
- **Issue:** `user-select: none` only on `.bottom-nav-item`, so text near bottom nav is selectable on tap-drag → invisible highlights
- **Fix:** Added `-webkit-user-select:none; user-select:none; -webkit-touch-callout:none;` to `body` rule at line 31; re-enabled for `input,textarea` with `-webkit-user-select:text; user-select:text;` at line 34
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all`

---

### ✅ Item 3: Rider Broadcast Throttling + Warm-Up Pacing
- **Files:** `bot/utils.js`, `bot/rider.js`, `bot/index.js`
- **Stage:** `done`
- **Issue:** `broadcastPickupAvailable()` loops riders with zero delay between WhatsApp sends. No warm-up for new numbers.
- **Fix:** Added `sleep()`, `getBroadcastDelayRangeMs()`, warm-up constants (7-day window, 3-5s warm-up, 0.8-1.5s normal) to `bot/utils.js`; imported helpers in `bot/rider.js`, added staggered delay in broadcast loop; added `firstLinkedAt` tracking on first connection in `bot/index.js:1099-1122`
- **Verified:** All `node --check` pass
- **Deployed:** `a0c43fc` + `ff9ac96` → EC2 pull + `pm2 restart all` — confirmed online

---

### ✅ Item 4: Baileys Version Drift
- **Files:** `bot/package.json`
- **Stage:** `done`
- **Issue:** `^6.7.17` pinned, no update process. WhatsApp protocol changes detect outdated clients.
- **Fix:** Pinned exact version `7.0.0-rc13` (removed `^`); added `check:baileys` script for version checking
- **Verified:** `bot/package.json` valid JSON; `node --check bot/index.js` passes
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all`

---

### ✅ Item 5: Session Backup
- **Files:** `bot/backup-sessions.js`, `bot/package.json`
- **Stage:** `done`
- **Issue:** WhatsApp auth credentials only on EC2 local disk. No S3/EBS backup. Instance loss = mass re-link = ban risk.
- **Fix:** Created `bot/backup-sessions.js` (syncs `session_data_*` dirs to S3 via `aws s3 sync --delete --storage-class STANDARD_IA`); added `backup:sessions` script to `bot/package.json`
- **Verified:** Syntax checks pass
- **Deployed:** `a0c43fc` → EC2 pull — ready for cron scheduling

---

### ✅ Item 6: Graceful Shutdown (SIGTERM/SIGINT)
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Issue:** `pm2 restart` sends SIGTERM → abrupt kill → session corruption, no graceful socket close.
- **Fix:** Added SIGTERM/SIGINT handler at `bot/index.js:1099-1122` after `currentSock = sock;`: calls `sock.end(undefined)`, clears intervals, exits after 500ms flush
- **Verified:** `node --check bot/index.js` passes; regression check clean
- **Deployed:** `a0c43fc` + `ff9ac96` → EC2 pull + `pm2 restart all` — confirmed all 6 processes online

---

### ✅ Item 7: TUNNEL_URL not on `window` (SupremeAdmin)
- **Files:** `SupremeAdmin/js/firebase-config.js`
- **Stage:** `done`
- **Issue:** `TUNNEL_URL` declared as `let` in `firebase-config.js` but not attached to `window`. ES modules (e.g. `restaurant-profile.js`) referencing `TUNNEL_URL` got `ReferenceError`.
- **Fix:** Added `window.TUNNEL_URL = TUNNEL_URL` after declaration + after Firebase auto-read update
- **Verified:** Build + deploy successful
- **Deployed:** `ea5b9ef` → Firebase Hosting (`foodhubbie-supremeadmin.web.app`)

---

### ✅ Item 8: `resolveOutletId` not imported in `bot/index.js`
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Issue:** `resolveOutletId()` called at line 2193 but only `resolveBusinessIdFor` and `initializeOutletBusinessIndex` were imported from `./helpers/outlet-resolution`. Caused `[FATAL] Unhandled Rejection: resolveOutletId is not defined` on bot startup → pizza bot crashed.
- **Fix:** Added `resolveOutletId` to the import at line 38
- **Verified:** `node --check bot/index.js` passes
- **Deployed:** `ff9ac96` → EC2 pull + `pm2 restart all` — all 6 processes online, pizza bot connected

---

## Website Upgrade — FoodHubbie Marketing Site

**Goal:** Restructure `website/index.html` from "feature → text → generic image" to "promotional visual → real software proof → benefits → CTA" per `website/Improvements/improvements.md.txt`.

**Assets:**
- `website/assets/generated/` — 6 AI promotional images (admin-dashboard, admin-login, menu-landing, menu-landing-mobile, rider-login, rider-login-mobile)
- `website/assets/REal/` — 25 real software screenshots (Analytics x3, Dashboard, Bulk Messaging, Discount, Inventory, Live Orders, Menu Control, Menu Availability, Orders, Orders Update, Payment Tracking, POS, QR Table, Reports, Rider Management, Settings x6, Table Management, WhatsApp Bot)

**Design Rules (from improvements guide):**
- Do NOT redesign from scratch — improve existing sections
- Keep existing branding (orange accent, white/light bg, dark navy type, rounded cards)
- Keep existing pricing, CTAs, links, navigation
- PROMISE → PRODUCT → PROOF flow for every feature
- No text over screenshots, no orange boxes on screenshots
- Use browser frames, device frames, clean white cards, subtle shadows
- Responsive: 3-col desktop → 2-col tablet → 1-col mobile
- Lazy loading, proper alt text, no stretch/crop

### ✅ W1: Hero Section — Add Ecosystem Strip
- **File:** `website/index.html` (hero section)
- **Stage:** `done`
- **Task:** Added ecosystem strip below dashboard image: Admin → Customer QR Menu → Rider App with connected labels. Added "LIVE / REAL-TIME" indicator with pulse animation.
- **CSS:** Added `.ecosystem-strip`, `.eco-item`, `.eco-arrow`, `.live-dot` styles
- **Deployed:** Pending Firebase deploy

### ✅ W2: "See FoodHubbie in Action" — 5 Feature Cards
- **File:** `website/index.html` (new section after product tour)
- **Stage:** `done`
- **Task:** Added 5 premium feature cards with real screenshots: WhatsApp Ordering, QR Table Ordering, First-Party Delivery, Marketing & Promotions, Real-Time Command Center. Each card: real screenshot → headline → supporting text → CTA link.
- **Deployed:** Pending Firebase deploy

### ✅ W3: WhatsApp Ordering Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Added dedicated section with real WhatsApp campaign screenshot + flow diagram: Customer → WhatsApp → Promotion → Menu → Cart → Order → Dashboard. CTA: "Talk to Us on WhatsApp"
- **Deployed:** Pending Firebase deploy

### ✅ W4: QR Table Ordering Section
- **File:** `website/index.html` (upgraded from Dine-In section)
- **Stage:** `done`
- **Task:** Upgraded Dine-In section with real QR screenshot + process flow diagram: TABLE QR → CUSTOMER ORDER → POS/SYSTEM → KITCHEN → SERVED. Added `id="qr-section"` for navigation.
- **Deployed:** Pending Firebase deploy

### ✅ W5: Delivery Section — Screenshot Sequence
- **File:** `website/index.html` (upgraded Delivery section)
- **Stage:** `done`
- **Task:** Added 3-screenshot sequence: Live Orders (Monitor) → Orders Update (Update) → Orders (Manage). Added `id="delivery-section"` for navigation.
- **Deployed:** Pending Firebase deploy

### ✅ W6: Marketing Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Two-column layout: LEFT = WhatsApp Campaigns, RIGHT = Discount & Coupon Control. Added workflow: Create → Target → Promote → Track. Added `id="marketing-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W7: Command Center Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Large dashboard screenshot in browser frame. Added `id="command-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W8: Analytics Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** 3-screen dashboard showcase: Analytics Overview, Sales & Highlights, Payment Methods. Added `id="analytics-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W9: Menu & Inventory Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** 3-stage layout: Menu Control → Availability & Stock → Inventory Management. Added `id="menu-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W10: POS & Payments Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Split-screen: POS + Payment Tracking. Added `id="pos-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W11: Orders Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Horizontal timeline: Order Received → Preparing → Ready/Delivery with real screenshots. Added `id="orders-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W12: Final CTA Update
- **File:** `website/index.html` (final CTA section)
- **Stage:** `done`
- **Task:** Added ecosystem visual: QR Order → Dashboard → Kitchen → Rider → Customer. Added "FOODHUBBIE ERP" branding + WhatsApp number.
- **Deployed:** Pending Firebase deploy

### ✅ W13: SEO & Alt Text Pass
- **File:** `website/index.html`
- **Stage:** `done`
- **Task:** Updated all image alt text to descriptive: "FoodHubbie ERP [feature] — [description]". Added smooth scrolling CSS.
- **Deployed:** Pending Firebase deploy

### ✅ W14: Responsive Design Pass
- **File:** `website/index.html` (CSS)
- **Stage:** `done`
- **Task:** All new sections use responsive grids: `.feature-promo` (auto-fit minmax 300px), `.screenshot-seq` (3→1 col), `.marketing-grid` (2→1 col), `.analytics-grid` (3→2→1 col), `.menu-inv-grid` (3→1 col), `.pos-pay-grid` (2→1 col). Dashboard screenshots in browser frames scale properly.
- **Deployed:** Pending Firebase deploy

### ✅ W15: Deploy to Firebase Hosting
- **File:** `firebase.json` (website hosting target)
- **Stage:** `done`
- **Task:** Deployed website to `foodhubbie-web.web.app`
- **Deployed:** https://foodhubbie.in

---

## Baileys Ban-Proofing — Volume, Detection, Dashboard

**Context:** Baileys (unofficial WhatsApp Web API) is ban-prone at high volume. A restaurant with 800 orders/10hrs generates ~3,200 outbound messages/day (order notifications + rider broadcasts + promos). Meta flags accounts at 500+/day. These three items add detection, pacing, and visibility.

### ✅ B1: Baileys-Specific Send Delay (2-5s Jitter)
- **Files:** `bot/utils.js`, `bot/index.js`
- **Stage:** `done`
- **Verified:** `node --check bot/utils.js` + `node --check bot/index.js` pass; deployed to EC2; `pm2 restart all` — all 4 processes online
- **Done:** SCP + restart — `BaileysSendTracker` class in utils.js, wired into `sendImage()` in index.js. 2-5s jitter between distinct recipients, no delay for same-recipient sends. Skipped for Meta transport.
- **Commit:** `a936f48` (`feat: Baileys send tracker + ban detection + promo badge fix + message preview CSS`)

### ✅ B2: Ban Detection + Admin Alert
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Verified:** `node --check bot/index.js` pass; deployed to EC2; `pm2 restart all` — all 4 processes online. Ban detection immediately triggered on restart (pizza bot was already in `logged_out` state) — wrote alert to `bot/alerts/pizza/`, auto-paused promotions.
- **Done:** SCP + restart — consecutive send failure tracking (10 failures in 5min = warning alert), session expiry detection (QR after open = banned), `loggedOut` disconnect = critical alert + auto-pause promos. Alerts written to `bot/alerts/{outlet}` in Firebase.
- **Commit:** `bb92b87` (`fix(bot): 5 critical reliability fixes from log analysis patch`)

### ✅ B3: Volume Dashboard (Daily Outbound Tracking)
- **Files:** `bot/index.js`, `bot/utils.js`, `bot/rider.js`, `bot/promotions.js`
- **Stage:** `done`
- **Issue:** No visibility into daily outbound volume. Can't tell if approaching Baileys ban threshold (500/day). No historical trend data.
- **Fix:**
  1. **`bot/utils.js`** — Added `OutboundTracker` class: `trackSend(outlet, type)` increments daily counter via Firebase transaction at `bot/usage/{IST-date}/{outlet}`; types: `order_notification`, `rider_broadcast`, `promo`, `admin_alert`
  2. **`bot/index.js`** — Tracker initialized after imports; wired into `sendImage()` with optional `trackType` param (default `order_notification`); tracking on every successful send (image and text fallback paths)
  3. **`bot/rider.js`** — Tracker initialized; tracking added to `broadcastPickupAvailable()` (rider_broadcast) and `notifyRiderAssignment()` (rider_broadcast)
  4. **`bot/promotions.js`** — Tracker initialized; tracking added to `sendPromotionalMessage()` (promo) and extra menu image send; outlet param threaded through `sendWithRetry()` → `sendPromotionalMessage()`
- **Verified:** `node --check` passes for all 4 files; bot restarted successfully on EC2, online and processing messages
- **Deployed:** SCP'd all files to EC2 `/var/www/foodhubbie/bot/`; `pm2 restart bot-roshani-pizza-pizza` — confirmed online with `outboundTracker` initialized
- **Commit:** `a936f48` (tracker class) + `7a918fb` (`feat(bot): wire OutboundTracker into all send paths for daily usage analytics`)

---

## Completed Items (This Session)

| Item | Status |
|------|--------|
| SupremeAdmin Issues #2-7 | ✅ `ok` |
| Restaurant-Scoped Isolation (Phases 1-5) | ✅ `done` |
| Build System + Deploy | ✅ `done` |
| POS Back Button (in Admin) | ✅ `done` |
| Invisible Text Selection | ✅ `done` |
| Rider Broadcast Throttling + Warm-Up | ✅ `done` |
| Baileys Version Drift | ✅ `done` |
| Session Backup | ✅ `done` |
| Whole-Process Restart (Graceful SIGTERM) | ✅ `done` |
| Daily Outbound Tracking (OutboundTracker) | ✅ `done` |
| Phase 5 Runtime Test | ✅ `done` (11/11 notification + 7/7 rules) |

---

## Item Progress Workflow Example

To mark a new item:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `reviewing`
- **Verified:** (pending)
- **OK:** (pending)
- **Done:** (pending)
```

**To advance:** update `status` field. Example after review:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `ok`
- **Verified:** `node --check path/to/file.js` passes; lint passes
- **OK:** self-review complete
- **Done:** merged to main, deployed
```

---

## Promotions Tab Full Review — 9 Findings (Tier 3)

**Source:** Full static review of promotions UI (`Admin/js/features/promotions.js`), bot engine (`bot/promotions.js`), rules (`database.rules.json`), HTML, CSS.
**Risk tier:** 3 (security rules, multi-tenant PII, live WhatsApp sends)

---

### ✅ P1: Any admin can read any other restaurant's customer list
- **Files:** `database.rules.json` (customers node)
- **Stage:** `done`
- **Verified:** JSON valid, deployed to Firebase RTDB
- **OK:** diff confirms outlet-match clause added, same pattern as orders/feedbacks/discountsUsage
- **Done:** ✅ `firebase deploy --only database`

**Issue:** `customers` node's `.read` rule checks only `admins.exists()` — no outlet scoping. Every other node under `$outletId` scopes with `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`. This is the one exception. Any authenticated admin can read any outlet's customer list (names, phones, order history, promotionalConsent).
**Trace:** `database.rules.json` → `customers` → `.read` — missing outlet match clause vs. siblings (`orders`, `feedbacks`, `discountsUsage`).
**Fix:** Add outlet-match clause to customers `.read` rule.
**Verify:** Compare customers rule against 7 sibling nodes.

---

### ✅ P2: Rider accounts can control promotional campaigns
- **Files:** `database.rules.json` (bot node)
- **Stage:** `done`
- **Verified:** JSON valid, deployed
- **OK:** `.write` added at `bot/promotions` level restricts to admins-only
- **Done:** ✅ `firebase deploy --only database`

**Issue:** `bot` node's `.write` grants `auth != null && (admins.exists() || riders.exists())`. Nothing under `bot/promotions` (campaigns, killSwitch, enabled) narrows to admins-only. A rider account can write directly to `bot/promotions/killSwitch`, `.../enabled`, or push fabricated campaigns.
**Trace:** `database.rules.json` → `bot` → `.write` — permits `riders.exists()`. No children override restrict to admins.
**Fix:** Add `.write` restriction at `bot/promotions` level to admins-only.
**Verify:** Rule diff before/after.

---

### ✅ P3: "Delay between sends" field has zero effect
- **Files:** `bot/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed to EC2
- **OK:** Resolved the other way — the field and its `delayMs` plumbing were **removed** (0 occurrences in `Admin/index.html` and `bot/promotions.js`). The send loop always paces from the bot's own constants. No config surface left to go stale.
- **Done:** ✅ SCP + `pm2 restart bot-roshani-pizza-pizza`

**Issue:** `promoDelay` input (1-30s, default 2) is read, sent as `delayMs` in `SEND_PROMOTION` command, destructured in `runPromotionCampaign()` — and never used. The send loop always uses hardcoded `PROMO_MIN_DELAY_MS` (8000) / `PROMO_MAX_DELAY_MS` (15000).
**Trace:** HTML `promoDelay` → `promotions.js:484` → `SEND_PROMOTION` command → `bot/promotions.js:215` destructured → `bot/promotions.js:382` uses `randomBetween(PROMO_MIN_DELAY_MS, PROMO_MAX_DELAY_MS)` ignoring `delayMs`.
**Fix:** Wire `delayMs` into the send loop or remove the UI field.
**Verify:** Trace the variable end-to-end.

---

### ✅ P4: Hint text wrong in three ways
- **Files:** `Admin/index.html`
- **Stage:** `done`
- **Verified:** deployed
- **OK:** The hint died with the field (see P3) — no stale numbers left in the UI. Authoritative pacing, if it ever needs re-surfacing: `PROMO_MIN_DELAY_MS=8000` / `PROMO_MAX_DELAY_MS=15000` per message, `BATCH_MIN_PAUSE_MS=60000` / `BATCH_MAX_PAUSE_MS=120000` pause every 30 sends (`bot/promotions.js`).
- **Done:** ✅ `firebase deploy --only hosting:admin`

**Issue:** `Admin/index.html:4337` says "Default 2s. A 30s pause happens automatically every 50 sends." Actual: per-message delay is random 8-15s, batch pause is 60-120s every 30 sends. Three numbers, all wrong. The guide modal (`promotions-guide.js`) has the correct numbers.
**Trace:** `Admin/index.html` hint text vs. `bot/promotions.js:14-22` constants.
**Fix:** Update hint text to match actual constants.
**Verify:** Compare hint against constants.

---

### ✅ P5: Template count off by one
- **Files:** `promotions-guide.js`
- **Stage:** `done`
- **Verified:** grep confirmed 25 templates
- **OK:** guide updated to "25 pre-built message templates"
- **Done:** ✅ deployed

**Issue:** Guide says "24 pre-built message templates." Actual `TEMPLATES` array has 25 items (8 categories, 3+4+4+3+3+3+2+3).
**Trace:** Count `TEMPLATES` array in `promotions-templates.js`.
**Fix:** Update count to 25.
**Verify:** Count array.

---

### ✅ P6: Campaign documents never cleaned up
- **Files:** `bot/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed
- **OK:** `expireOldPromoLogs` now also cleans completed/stopped/expired campaigns older than 30 days
- **Done:** ✅ SCP + restart

**Issue:** `expireOldPromoLogs()` TTLs `bot/promotions/logs` at 30 days. No equivalent for `bot/promotions/campaigns`. Completed/stopped/expired campaigns accumulate forever, including base64 `mediaUrl` data. The admin dashboard keeps one live `.on('value')` listener on all campaigns — every change re-downloads everything.
**Trace:** `expireOldPromoLogs()` — no campaigns cleanup call.
**Fix:** Add TTL cleanup for campaigns node.
**Verify:** Confirm no existing cleanup.

---

### ✅ P7: state.promotions in state.js is dead
- **Files:** `Admin/js/state.js`
- **Stage:** `done`
- **Verified:** grep confirmed zero references in promotions.js
- **OK:** dead object removed from state
- **Done:** ✅ deployed

**Issue:** `state.promotions` object declared but never read or written by `promotions.js` — module uses its own private variables.
**Trace:** Grep `state.promotions` across repo.
**Fix:** Remove dead state or wire it.
**Verify:** Confirm zero references.

---

### ✅ P8: Two data-action attributes are inert
- **Files:** `Admin/index.html`
- **Stage:** `done`
- **Verified:** grep confirmed no dispatcher case in main.js
- **OK:** removed dead `data-action` from `btnPromoLaunch` and `btnPromoKillAll`
- **Done:** ✅ deployed

**Issue:** `btnPromoLaunch` (`data-action="launchPromoCampaign"`) and `btnPromoKillAll` (`data-action="killAllCampaigns"`) have no case in `main.js`'s delegated dispatcher. They're wired via `.onclick` directly, so nothing double-fires, but the attributes are misleading.
**Trace:** `main.js` dispatcher — grep for action strings.
**Fix:** Remove dead `data-action` attributes.
**Verify:** Confirm no dispatcher case.

---

### ✅ P9: Tab state not exposed to assistive tech
- **Files:** `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed
- **OK:** Implemented 2026-10-26 (an earlier pass had marked this done while `aria-selected` was still missing). `_switchMode()` and `_switchCampaignPanel()` now write `aria-selected` on every `.promo-mode-pill` / `.promo-campaign-tab`; markup carries `aria-selected="true|false"`, `aria-controls` on the campaign tabs + the Schedule pill, and `role="tabpanel"` on the three campaign panes.
- **Done:** ✅ deployed

**Issue:** Mode switcher uses `role="tablist"` / `role="tab"` but `aria-selected` is never toggled in `_switchMode()`, no `role="tabpanel"` / `aria-controls` pairing.
**Trace:** `_switchMode()` — no aria-selected write.
**Fix:** Add aria-selected toggle and aria-controls.
**Verify:** Inspect DOM after mode switch.

---

**File last updated:** 2026-09-18 | `Pending-Work.md` — keep this file at the repo root. All new fixes/audits should add an entry following the format above before work begins.

---

## Admin Dashboard — UI Structure + Promotions UX Review

Source: `admin-structure-and-promotions-ux-review.md`

### ✅ Promo Badge Color Collision (RED)
- **Files:** `Admin/style.css`, `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** Deployed to Firebase (`foodhubbie-admins.web.app`)
- **Issue:** `.badge-scheduled` and `.badge-expired` defined twice — once in Promotions section (amber/red, line 7654) and once in Discounts section (blue/gray, line 7703). Discounts wins by source order, so scheduled campaigns render blue instead of amber, expired renders gray instead of red.
- **Fix:** Namespaced Promotions badges to `.promo-badge-*` in both CSS and promotions.js (2 occurrences at lines 342, 384).
- **Done:** ✅ `firebase deploy --only hosting:admin`

### ✅ Message Preview Inline Styles (YELLOW)
- **Files:** `Admin/style.css`, `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** Deployed to Firebase
- **Issue:** Preview modal hardcoded 6 CSS properties inline (`white-space:pre-wrap; background:#0b1220; ...`). Not dynamic — same every render.
- **Fix:** Extracted to `.promo-message-preview` class in CSS; updated promotions.js line 455.
- **Done:** ✅ `firebase deploy --only hosting:admin`

### 🟢 Noted (no fix needed now)
- **Inline styles drift:** 27 in orders.js, 26 in tables.js, 13 in settings.js — app-wide pattern, not a single-fix item
- **`.promo-switch`/`.promo-slider` naming:** Used generically across features but named after Promotions — future shared component extraction
- **`aria-selected` on mode tabs:** Same fix shape as Menu Browser — `role="tab"` + `aria-selected` toggle