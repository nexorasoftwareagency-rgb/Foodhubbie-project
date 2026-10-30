# PLAN — Onboarding setup checklist, auto-approval, wallet & percentage package

> Source change set: `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/` (Guide.md, Change-Guide-Before-After.md, foodhubbie-onboarding.patch).
> Patch base: `a4392f1` (`main`). Reviewed against this tree at `df45d29` (`seo-brand-consistency`).
> **Status: REVIEWED + VERIFIED LOCALLY. Not merged, not deployed, no live data touched.**
> The adapted series lives on the local branch `onboarding-setup-checklist` (7 commits, `4c32061..b4a301a`), built in the throwaway worktree `%TEMP%\opencode\onboarding-wt`.

---

## 1. What the change set does

| Area | Behaviour |
|---|---|
| `website/signup.html` | Inline per-field validation, one request per page visit (a retry re-uses the request and re-sends only the password step), form locks after success, success box hidden until success, correct copy (dashboard created automatically + ₹1,000 minimum wallet). |
| `bot-control-api/server.js` | Approval logic extracted to `approveOnboardingRequest()`; the manual endpoint keeps its contract. New watcher auto-approves **fresh** website sign-ups: creates the Auth user, `admins/{uid}` and the outlet with `locked: true`, notifies Supreme via `inquiries`, retries while the browser's password write lands, rejects duplicate emails, caps at `AUTO_APPROVE_MAX_PER_HOUR` (20), kill switch `ONBOARDING_AUTO_APPROVE=off`, and only requests younger than 15 minutes are eligible (so a restart never mass-approves a backlog). |
| `database.rules.json` | While `outlets/{oid}/locked == true`, writes to `orders/*`, `tableSessions/*` and `tableRequests/*` are refused except for `isSuper` / `isSupreme`. Server-side enforcement of the lock, not just a browser gate. |
| Admin app | "Setup mode" instead of a dead screen: allowed tabs (dashboard, menu, categories, combos, menu browser, tables, inventory, settings, costs, notifications), slim persistent banner, dismissible top-up popup, auto-reload when unlocked. New dashboard setup checklist (derived from existing data, never writes) and a low-balance banner. Cost tab gains a **Wallet** sub-tab (balance, topped up, used, charges, how to top up, top-up history). |
| `shared/cost-math.js` | `MIN_TOPUP = 1000`, `LOW_BALANCE_RATIO = 0.25`, `computeWallet()`, `walletLevel()`, and the `percentage` billing mode (`PERCENT_RATES` 1% everything / 2% WhatsApp, `percentOf`, `rateLabel`, `normalizeMode`). Pure, self-checked. |
| Supreme Admin | Per-restaurant package switch (flat / percentage / WhatsApp-1%), low/empty wallet chips + KPI, and a hint after a payment brings a locked restaurant to the minimum. |

Scale: **22 files, +3335 / −130**. Of that, production code + rules is **+719 / −130**, tests **+248**, and **2,274 lines are the two guide documents** (`GUIDEs/`).

---

## 2. Compatibility with this tree — result: compatible, with three adaptations

The patch is a **stacked series**, so `git apply --check` on the whole mbox is not a valid test (it reports a false failure at `Admin/js/ui.js:112`). `git am -3` applies it.

| # | Divergence in our tree | What happens | Resolution (already applied on the branch) |
|---|---|---|---|
| 1 | `Admin/js/ui.js` has the riders boot-race guard (`if (!isRidersSubscribed()) lr({ withStats: false })`) added after the patch's base | Patch 1 fails to apply flat | `git am -3` auto-merges; the guard is preserved and the two dashboard hooks (`wallet-alert`, `setup-checklist`) are appended after `renderOrders`. |
| 2 | `database.rules.json` has moved a long way: outlet-scoped riders, QR/webview source branches, 25 `isDemo` grants, `tableSessionsContact` | Patch 2 conflicts on `orders/$orderId` | Resolved by keeping **our** `.read` and **our** `.write` expression, and prefixing the patch's lock clause to `.write` only. The patch's stale root-`riders` assumptions never enter the file. Verified: JSON parses, `isDemo` count unchanged (25), `orders` read untouched. |
| 3 | Tests assume LF and force-click viewport-edge elements | `auto-onboarding.check.cjs` failed with `app is not defined`; `signup-onboarding.check.mjs` timed out | Both were **test brittleness, not incompatibility** — fixed on the branch (commit `b4a301a`). See §5. |

Everything else applies untouched. The patch does **not** touch any file the working tree currently has uncommitted (`.gitignore`, `Promo-Campaign/`, `promo/assets/`, `orders-screen.yml`, the WebP change in `Admin/js/firebase.js`, `Admin/js/features/catalog.js`, `Admin/sw.js`), so merging the branch will not disturb in-progress work.

### Patch assumptions that are now stale (and were correctly discarded)

- `database.rules.json`: root `riders` paths (we moved them outlet-level on 2026-10-28).
- `Admin/js/ui.js`: pre-riders-guard context.
- `shared/cost-math.js` header comment still says WhatsApp ₹5/order — correct for `per_order`, and the new `percentage` mode is additive.

---

## 3. Where each change lands

| File | Lines | Why there |
|---|---|---|
| `shared/cost-math.js` | +76 | Single source of truth for billing math — the wallet and percentage mode must live beside `feeOf`/`computeCostIndex`, or Admin and Supreme will drift. Consumed by `Admin/js/features/{costs,setup-checklist,wallet-alert}.js` (`../../shared/cost-math.js`) and `SupremeAdmin/js/{billing-shared,features/*}.js` (`/shared/cost-math.js`). No menu twin (menu never bills). |
| `bot-control-api/server.js` | +104/−12 | The only place that can create Auth users + outlets with the Admin SDK. |
| `database.rules.json` | +4/−3 | Lock enforcement must be server-side. |
| `Admin/js/ui.js` | +54/−12 | Owns `switchTab`, tab gating and the locked screen. `SETUP_TABS` is the single list of setup-safe tabs. |
| `Admin/js/auth.js` | +5/−4 | Already owned `state.locked`; now calls `enterSetupMode()` and reloads only when a locked session is unlocked. |
| `Admin/js/main.js` | +4/−2 | Global click gate: blocks actions only on operations tabs. |
| `Admin/index.html` | +46/−1 | Two dashboard containers + the Wallet sub-tab markup. |
| `Admin/js/features/setup-checklist.js` (new) | +110 | Read-only, derives progress from existing nodes; no schema change. |
| `Admin/js/features/wallet-alert.js` (new) | +62 | Dashboard banner; skips the heavy orders read when the outlet never topped up. |
| `Admin/js/features/costs.js` | +73/−7 | Owns the Cost tab; wallet is a new sub-tab of it, not a new page. |
| `SupremeAdmin/js/billing-shared.js` | +14/−2 | Shared Supreme billing math + the payment modal. |
| `SupremeAdmin/js/features/{payment-overview,payment-record,restaurant-profile,templates/billing-card}.js` | +30/−19 | Package switch, chips, rate labels, unlock reminder. |
| `website/signup.html` | +137/−68 | The public form. |
| `docs/ONBOARDING-AUDIT.md` (new) | +94 | Findings, decisions, known limits, deployment order. |
| `tests/*.check.{cjs,mjs}` (new) | +248 | Three runnable checks (see §5). |
| `GUIDEs/Guide.md`, `GUIDEs/Change-Guide-Before-After.md` | +2274 | **Duplicates** of the two documents already in `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/`. Recommend dropping them from the merge (see §9, D1). |

---

## 4. Findings from this review

Severity: **P1** = must fix before the feature is usable/safe, **P2** = should fix soon, **P3** = note.

| # | Sev | Finding | Recommendation |
|---|---|---|---|
| F1 | **P1** | **The checklist's WhatsApp step is a dead end while locked.** `setup-checklist.js` links the "Connect WhatsApp ordering" step to `tab: 'chat'`, but `chat` is not in `SETUP_TABS`, so clicking "Open" runs `switchTab('chat')` → `showLockedScreen()` ("Top up to go live"). The one step a new restaurant is *supposed* to do during setup shows the paywall instead. | Add `'chat'` to `SETUP_TABS` (connecting WhatsApp is setup, not operations). Consider `'discounts'` too — a new outlet may want to prepare offers before going live. One-line change in `Admin/js/ui.js`. |
| F2 | **P1** | **Auto-created outlets get no `outletIndex` entry.** `approveOnboardingRequest()` writes `businesses/{bid}` + `admins/{uid}` but not `outletIndex/{oid}`, while the Supreme wizard writes `outletIndex/{oid} = {bid, name, createdAt}`. `outletIndex` is what resolves an outlet key for the menu/bot (`resolveBusinessIdFor`) and it is what the QR/menu link is built from. Pre-existing for manual approvals, but auto-approval makes it the default path for every new restaurant. | Add 4 lines to `approveOnboardingRequest()`: `outletIndex/${oid} = { bid, name: outletName, createdAt: now }` in the same multi-path `update()`. Admin SDK bypasses rules; the shape matches `outletIndex/$oid` validation. |
| F3 | P2 | `tests/auto-onboarding.check.cjs` stripped the express route with `/\n\}\);\n/`, which never matches a CRLF checkout (`core.autocrlf=true` on this box) → the route survived → `ReferenceError: app is not defined`. Proved it is the test, not the patch: LF copy passes, and the one-line `\r?\n` fix passes on both. | Fixed on the branch (`b4a301a`). |
| F4 | P2 | `tests/signup-onboarding.check.mjs` used `click({ force: true })` on `#fTerms` and `#submitBtn`. `force` skips the scroll-into-view/stability checks, so after the inline error divs shift the layout the click lands on a coordinate below the viewport and silently misses → the test fails or times out depending on timing. Proved the form itself is fine (a real click toggles the checkbox; a full submit produces POST + PUT + success). | Fixed on the branch: plain `check()` for the checkbox, `form.requestSubmit()` for submits. 12/12. |
| F5 | P2 | **`Admin/sw.js` cache name is not bumped by the patch.** `index.html` and the module graph change; the SW is stale-while-revalidate, so a stale shell can pair with new modules. | Bump `foodhubbie-erp-shell-v5.12.2` → next free version at merge time. **Coordinate with the uncommitted WebP change**, which also wants `v5.12.3`: whichever lands second takes `v5.12.4`. |
| F6 | P2 | **The demo tenant now opens with "Wallet balance finished −₹910".** Seeded `billing.charges` (₹3,106) exceed seeded payments (₹3,490) minus usage (₹1,294). Correct math, terrible first impression of the product on the public demo. | Seed the demo tenant with a healthy wallet (e.g. payments ₹15,000) in `tools/seed-demo-tenant.cjs`; the nightly reseed then keeps it healthy. |
| F7 | P2 | **Wallet reads the outlet's entire order history on every Costs visit** (`get(Outlet.ref('orders'))` in `loadCosts`). Fine for new restaurants; Roshani has years of orders. `wallet-alert.js` caches 5 minutes, `costs.js` does not. | Accept for now (the audit already flags it), or reuse the same 5-minute cache. Long term: a server-maintained balance. |
| F8 | P3 | `GUIDEs/` adds 2,274 lines duplicating the folder the user already has. | Drop from the merge; keep `docs/ONBOARDING-AUDIT.md`. |
| F9 | P3 | `billing-toggle-mode` was replaced by `billing-set-mode` with `data-mode` buttons. `roTitle` is defined in the template, so no `ReferenceError` (checked). Mode switches re-price **past** orders in reports/wallet because fees are computed, not stored. | Already stated in the confirmation copy. Switch at a period boundary. |
| F10 | P3 | `outlet.whatsapp = { status: 'pending' }` is written for every auto-approved outlet. Verified `bot-control-api/orchestrator.js` `desiredState()` returns `null` unless `status === 'active'`, so no bot worker is spawned for spam outlets. | No action; recorded so nobody "fixes" it later. |
| F11 | P3 | The lock is enforced in rules for `orders`, `tableSessions`, `tableRequests` only. Admin-SDK paths (WhatsApp bot, promos, settlement) bypass rules; `tableSessions/{sid}/orders` (the child array) is not gated. | Acceptable: a locked outlet has no active bot. Documented in `docs/ONBOARDING-AUDIT.md` §7. |
| F12 | P3 | `billing-set-mode` buttons use `title="${roTitle}"` — empty for read-write users, so the buttons have no tooltip. | Cosmetic; leave. |

---

## 5. Verification performed (this machine, this tree)

All checks run inside `%TEMP%\opencode\onboarding-wt` (branch `onboarding-setup-checklist`), never in the working tree.

| Check | Command | Result |
|---|---|---|
| Billing math self-check (wallet, percentage, low balance) | `node shared/cost-math.js` | `cost-math OK` |
| Encoding guard | `node tests/encoding-check.mjs` | ok — no mojibake/BOM/C1/U+FFFD |
| Import graph | `node tests/check-imports.mjs` | All `utils.js` imports resolve |
| Auto-approval logic vs fake Admin SDK | `node tests/auto-onboarding.check.cjs` | **7/7** (was 0/7 before the CRLF fix) |
| Costs wallet / checklist / alert modules vs stubs | `node tests/admin-wallet-checklist.check.mjs` | **3 suites, all pass** (wallet 7, checklist 6, alert 4 assertions groups) |
| Sign-up form vs mocked Firebase REST (real Chromium) | `node tests/signup-onboarding.check.mjs` | **12/12** (was failing before the force-click fix) |
| Shared-twin drift | `node tools/check-shared-twins.cjs` | 5/5 |
| Marketing copy consistency | `node tools/check-copy-consistency.cjs` | 30 files + 24 sitemap urls consistent |
| 17-gate structural verification | `node gate-verify.js` | PASS — 0 failures, 1 warning (live DB gate skipped) |
| Admin build | `node tools/build.mjs --admin` | 2.9 MB → 2.2 MB, exit 0; `dist/js/features/{setup-checklist,wallet-alert}.js` + `dist/shared/cost-math.js` present |
| Supreme build | `node tools/build.mjs --supreme` | 346 KB → 240 KB, exit 0 |
| **Admin app in a real browser** (built `dist`, `?demo=1`, real demo tenant) | Playwright probe | Boots, 22 dish cards, Costs → Wallet renders `−₹910 / paid ₹3,490 / used ₹1,294 / 2 receipts`, 0 page errors (the only console error was my harness blocking the service worker) |
| **Setup mode in a real browser** (state injected through the module cache, no data written) | Playwright probe | **8/8**: banner shows ₹1,000 minimum; `orders` tab refused and popup shown; "Continue setup" dismisses; menu still usable (22 cards); `leaveSetupMode()` removes the banner; 0 page errors |
| Supreme Admin boots with the patch (built `dist`) | Playwright probe | Login screen renders, **0 console errors** (proves `/shared/cost-math.js` resolves in the Supreme build) |
| `database.rules.json` | JSON parse + conflict resolution script asserts the inlined lock clause equals the patch's | valid JSON, clause identical |

### Not verified here (and why)

| Gap | Reason | How to close |
|---|---|---|
| **Rules behaviour** (locked outlet cannot create orders/sessions/requests; unlocked unchanged; Super/Supreme can write; public QR unchanged) | No `firebase-tools`, no Java → RTDB emulator cannot run on this box | `firebase emulators:exec --only database "node tests/rules.emulator.mjs"` on a machine with a JDK, or the live probe in §7. **Do this before deploying rules.** |
| Supreme billing screens (package switch, chips) | Needs a real super account; no local fixture | Manual pass after deploy (Supreme → Payments + a restaurant profile). |
| Live auto-approval end-to-end | Requires a deployed `bot-control-api` | §7 step 4 (throwaway sign-up, then clean up). |
| iOS/Safari | Windows box | Not applicable to this change set. |

---

## 6. Implementation order (when approved)

Phase 0 — pre-flight (5 min)
```bash
git status                     # confirm only the known uncommitted work
git log --oneline -1           # expect df45d29
```

Phase 1 — land the two P1 fixes **on the branch** (recommended before merging)
- F1: add `'chat'` to `SETUP_TABS` in `Admin/js/ui.js` (and decide on `'discounts'`).
- F2: write `outletIndex/{oid}` in `approveOnboardingRequest()`.
- Re-run: `node tests/admin-wallet-checklist.check.mjs`, `node tests/auto-onboarding.check.cjs`, `node gate-verify.js`, `node tools/build.mjs --admin`.

Phase 2 — merge into `seo-brand-consistency` (working tree untouched)
```bash
git merge --no-ff onboarding-setup-checklist      # or: git cherry-pick df45d29..onboarding-setup-checklist
# drop GUIDEs/ if the owner agrees (D1): git rm -r GUIDEs
```
Then bump `Admin/sw.js` cache to the next free version (F5) and run `npm run test:encoding`.

Phase 3 — rules first, then the API
```bash
firebase deploy --only database
# bot-control-api: ship server.js, then
pm2 restart bot-control-api            # env: ONBOARDING_AUTO_APPROVE (default on), AUTO_APPROVE_MAX_PER_HOUR (default 20)
```

Phase 4 — front ends
```bash
npm run build:admin   && firebase deploy --only hosting:admin
npm run build:supreme && firebase deploy --only hosting:supreme
firebase deploy --only hosting:website      # signup.html last
```

Phase 5 — demo tenant wallet top-up (F6) in the seeder, then `node tools/seed-demo-tenant.cjs --apply`.

### Rollback

| Layer | Rollback |
|---|---|
| Rules | Redeploy the previous `database.rules.json` (restores writes for locked outlets). No data migration was done, so nothing else to undo. |
| API | `ONBOARDING_AUTO_APPROVE=off` + restart is the instant kill switch; a full revert of `server.js` restores the manual-only flow. |
| Admin / Supreme / website | Redeploy the previous build (hosting keeps versions). |
| Created outlets | Auto-approved outlets are inert (`locked: true`, no `outletIndex` until F2, no bot). Disable or delete them in Supreme. |

---

## 7. Post-deploy verification (live)

1. **Rules** — with a locked test outlet's admin idToken: order create → 401; table session create → 401; table request → 401; `settings` write → allowed. With a Super token: order create → 200. On an unlocked outlet: QR order → 200 (unchanged).
2. **Auto-approval** — submit the public form with a throwaway address; within ~10 s the Auth user, `admins/{uid}`, `businesses/{bid}/outlets/{oid}` (`locked: true`), `inquiries` notification and `status: approved` + `autoApproved: true` exist; the secret node is gone.
3. **First login** — new admin sees the setup banner, the checklist, can edit the menu/settings, and gets the top-up popup on Orders/POS.
4. **Wallet** — Supreme records ₹1,000 → Admin banner says "Top-up received…"; unlock → page reloads into the full dashboard, banner gone, checklist hides once a first order exists.
5. **Percentage package** — switch a test outlet to `percentage`, place a ₹1,000 WhatsApp order → fee ₹20; ₹1,000 QR → ₹10; cancelled order → ₹0. Confirm Supreme Payments chip and the Wallet "used" match.
6. **Cleanup** — delete the throwaway Auth user, `admins/{uid}`, `businesses/{bid}`, the request and any `outletIndex` entry.

---

## 8. Risk summary

| Risk | Level | Mitigation |
|---|---|---|
| Rules untested before deploy | **High** | §7.1 or the emulator; the change is 3 expressions, revert is one deploy |
| Auto-approval abuse (anyone can register any unregistered email) | **High** (product) | 20/hour cap, 15-minute freshness, locked+inert outlets, Supreme notification. Real fix: email verification or a password-set link (D2) |
| New outlets unusable as a product (no `outletIndex`) | **High** | F2 before merge |
| Setup-mode dead end on the WhatsApp step | Medium | F1 before merge |
| Stale SW shell after deploy | Medium | F5 cache bump |
| Wallet reads all orders | Medium | F7 |
| Past orders re-priced when a package changes | Low | Documented in the confirmation copy |
| Money math drift between Admin/Supreme | Low | One `shared/cost-math.js`, self-checked, no menu twin needed |

---

## 9. Decisions needed from the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Keep the two `GUIDEs/*.md` in the repo? | (a) drop them, keep `docs/ONBOARDING-AUDIT.md`; (b) move them to `docs/`; (c) keep as-is | (a) — the source folder already holds them; 2,274 duplicated lines will rot |
| D2 | Email ownership with auto-approval | (a) accept the risk; (b) require Firebase email verification before the outlet unlocks; (c) send a password-set link instead of storing a chosen password | (b) or (c) before promoting sign-up publicly |
| D3 | Public pricing copy | Website + `PRICING_AND_TERMS.md` still say ₹500 one-time setup, no minimum balance. New flow says ₹1,000 minimum wallet. | Decide the public wording; the code does not hardcode a price |
| D4 | Hard stop at zero balance | Currently a warning only (25% low, 0 empty). | Keep warning-only until a server-maintained balance exists |
| D5 | Percentage package visibility | Not on the website/pricing/`llms.txt`. | Announce after the first outlet runs on it |
| D6 | Setup-mode tab list | Add `chat` (F1); `discounts`? | Add both |

---

## 10. Reference — branch contents

```
b4a301a test(onboarding): make the new checks pass on a Windows (CRLF) checkout   ← added by this review
26249e8 fix(onboarding): auto-approve only fresh sign-ups; index onboardingRequests by status
a41e4b7 docs: before/after change guide with line numbers and effects
1b65d9e docs: integration guide for onboarding, wallet and percentage package
bd62725 feat(billing): percentage package (1% / 2% WhatsApp) and 25% low-balance warning
150b67a feat(onboarding): auto-approval, setup-only lock, wallet top-up step and Cost tab wallet
4c32061 feat(onboarding): setup checklist, signup hardening, audit report
```

Source documents: `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/{Guide.md,Change-Guide-Before-After.md}` — the second one is the authoritative before/after reference (2,062 lines, per-file with old/new code and effect).
