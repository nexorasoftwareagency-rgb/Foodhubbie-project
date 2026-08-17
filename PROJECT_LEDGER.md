# Project Ledger — Prasant Pizza ERP

This file is the persistent memory for this project. Read Standing Decisions and
Fragile Files before starting ANY task.

## Standing Decisions

- **New Rider React app** (`rider-app/`) replaces old `rider-old/` PWA. Old PWA deleted.
  Rollback via `git checkout 24ab5a1^ -- rider-old/` if needed.
- **No Cloud Functions** (Spark plan) — all logic runs client-side or in Firebase rules.
- **PII segregation**: phone numbers go to `tableSessionsContact` (auth-gated), not `tableSessions`.
- **`_effectiveTotal(sess)`** replaces direct `sess.grandTotal` reads everywhere (table card, drawer, CSV, KPI).
- **`equalTo(null)`** (not `equalTo("")`) for unassigned rider queries — `assignedRider` is absent/null, not empty string.
- **Firebase v12**: `enableIndexedDbPersistence` removed — offline persistence is now automatic. No action needed.

<!-- STANDING_DECISIONS_START -->
- [2026-08-12 02:20 UTC] **DUAL-TRANSPORT WHATSAPP BOT (per restaurant)**: each restaurant/business supports BOTH Meta Cloud API (`BOT_TRANSPORT=meta`) and Baileys (`BOT_TRANSPORT=baileys`). ONLY ONE is active per restaurant at a time. Transport is controlled remotely from **Supreme Admin → Restaurants Profiles → WhatsApp Baileys section** (Scan QR button → shows QR + live status), mirrored on the WhatsApp second dashboard. Meta API is the default/primary; Baileys used when a restaurant wants a real number via QR. Bot reads transport mode from Firebase `bot/{outlet}/transport` (or env default), switchable at runtime.
- [2026-08-12 02:20 UTC] **STATIC IMAGES FOR FIREBASE HOSTING**: brand/menu images may be placed directly in the project directory (e.g. `menu/images/`, `assets/`) and deployed with Firebase Hosting, referenced via relative URLs like `/images/logo.png`. No Firebase Storage upload needed for static brand assets.
- [2026-08-04 10:00 UTC] PowerShell version-bump/edits on files with non-ASCII (emoji, ₹, typography) MUST use the UTF-8-safe pattern: `[System.IO.File]::ReadAllText(path, UTF8)` + `WriteAllText(path, content, UTF8Encoding($false))`. NEVER `Get-Content`/`Set-Content` — the 5.3.16 bump corrupted every emoji in Admin/index.html + sw.js (mojibake "ðŸ�½ï¸�"). Signature of corruption = C1 control chars U+0080–U+009F.
- [2026-08-04 10:00 UTC] ALL tables now use `mob-data-table` (payments, feedback, inventory, lost-sales). Tabulator CDN + `Admin/js/tabulator-setup.js` removed. New/rewritten tables must reuse the mob-data-table pattern, never reintroduce Tabulator.
- [2026-08-03 19:39 UTC] Runtime-composed CSS classes (built as \mob-badge-pay-*\/\mob-badge-status-*\ in JS) MUST be safelisted in tools/build.mjs PurgeCSS config, or PurgeCSS strips them from dist. Root cause of invisible payment badges. Add any new runtime-composed class family to the /^mob-/ (or matching) safelist regex.
- Rider app: `rider-app/` is the new production target (old `rider-old/` deleted)
- PII in `tableSessionsContact` only
- `_effectiveTotal()` canonical
- `equalTo(null)` canonical
- Firebase v12 auto-persistence
<!-- STANDING_DECISIONS_END -->

## Fragile Files

- **`database.rules.json`** (312 lines): Complex rules for multi-outlet, multi-role access.
  Any edit must be JSON-validated and cross-checked against admin, rider, and menu apps.
  `bot/$outletId/commands` validate rule must handle `push()`-generated keys.
- **`Admin/js/features/orders.js`**: `STATUS_SEQUENCES` and `STATUS_MAPPING` must stay in
  sync with rider status pipeline (12 statuses total).
- **`firebase.json`**: 3 hosting targets (admin, rider, menu); rider CSP img-src is `https://*` (http:// removed 2026-07).
- **`rider-app/src/services/orderService.ts`**: Core delivery lifecycle. `assertProximity` has GPS accuracy guard.

<!-- FRAGILE_FILES_START -->
- `Admin/index.html` & `Admin/sw.js` — contain emoji/₹/typography; any version bump/edit MUST use the UTF-8-safe PowerShell pattern (Standing Decision 2026-08-04) or all non-ASCII corrupts
- `tools/build.mjs` � PurgeCSS safelist (runtime-composed classes) � any new dynamically-built CSS class family must be added here or it gets purged from dist (flagged 2026-08-03 19:39 UTC)
- database.rules.json — multi-role complex rules
- Admin/js/features/orders.js — STATUS_SEQUENCES alignment
- firebase.json — 3-target hosting, CSP divergence
- rider-app/src/services/orderService.ts — delivery lifecycle
<!-- FRAGILE_FILES_END -->

## Task Log

### [20260714-120000-001] Production readiness audit — rider-app
- TIER: 3 (production data, security rules, auth)
- STATUS: COMPLETED
- Started: 2026-07-14 12:00 UTC
- Agent A: Firebase & Services — found 1 critical, 1 high, 2 medium, 3 low
- Agent B: UI Components — found 1 critical, 3 high, 6 medium, 7 low
- Agent C: Config & Build — found 4 critical (config), 3 high, 3 medium
- Report: `rider-app/PRODUCTION_ISSUES.md` (22 total issues, 40+ items passed)
- Outcome: Conditional pass — 12 critical+high items must be fixed before production deploy
- Confidence: High (3 independent agents, full file coverage, cross-referenced against real database rules)

### [20260714-100000-001] Rider app Phase 1-3 implementation
- TIER: 3 (production deployment)
- STATUS: COMPLETED
- Started: 2026-07-14 10:00 UTC
- Phase 1: All 13 bug fixes applied (equalTo null, isAdmin block, STATUS_SEQUENCES, persistence, todayStart, push notifications, onDisconnect cancel, double write combine, ghost window 48h, NaN guard, SHARED_NODES cleanup, GPS accuracy guard, haversine clamp)
- Phase 2: Source extracted to rider-app/, assets copied (.well-known, sounds/alert.mp3)
- Phase 3: firebase.json public → rider-app/dist, deploy scripts added, build passes clean
- Outcome: All items delivered, ready for production deploy after issue fixes
- Confidence: High

### [20260711-034449-8631] Fix FCM push notifications
- TIER: 2 (medium)
- STATUS: COMPLETED
- Notes: Firebase v12 messaging handled; sw.js has background message handler; notificationclick wired.

<!-- TASK_LOG_START -->
### [20260817-153659-927d] H5: deploy chat history tab + coexistence (rules, hosting:admin+supreme, bot EC2, webhook-server EC2)
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-08-17 15:36 UTC
- Files touched: database.rules.json,bot/index.js,bot/chat-log.js,bot/promotions.js,bot/rider.js,webhook-server/index.js,Admin/js/features/chat.js,SupremeAdmin/js/features/whatsapp-manage.js
- Verified: rules released; admin+supreme hosting live; 5 EC2 files md5-identical to local, node --check clean, pm2 online no crash; end-to-end logChatMessage write landed in RTDB at chats/9712345678 then removed; hosting /js/features/chat.js + /js/features/whatsapp-manage.js 200; err-log errors predate deploy (mtime 14:13 < restart 15:27)
- NOT verified / open risk: real inbound WABA message end-to-end UI render in browser (no Playwright; structural wiring mirrors verified patterns)
- Confidence: HIGH
- Ended: 2026-08-17 15:37 UTC

### [20260812-011800-8f2d] fix: delivery webview boot + token-gated order write + geolocation policy
- TIER: 3 (high-risk — security rules + prod deploy)
- STATUS: DONE (live-verified end-to-end in clean browser)
- Started: 2026-08-12 01:18 UTC
- Root causes fixed:
  1. OUTLET resolution in menu/js/firebase.js:58 used `pathParts[0]` (boot crashed with `outlets/delivery.html/categories` for URL `/delivery.html`). Now `?o=` param wins, then path slug, then 'pizza'; `?b=` overrides business id.
  2. menu/sw.js served stale cached firebase.js (cache v7) → bump v8 + pre-cache delivery assets. Deployed; fresh-context boot verified (dishes render, 0 boot errors).
  3. `webviewTokens` had NO rule → inherited auth-gated read → `Permission denied` at boot. Added token-keyed read (bearer secret), admin write, guarded `used` false→true flip.
  4. `settings/Delivery` read in delivery fee calc was auth-gated → anonymous `Permission denied`. Now client reads `settings/Delivery/slabs` only; rules expose just `slabs` publicly (reportPhone/backupCode stay PII-protected).
  5. Orders anonymous-create rule only allowed `source == 'QR'` → delivery orders blocked. Added `webview_delivery` create gated on a valid, unused webviewToken in the payload (order carries `webviewToken`).
  6. Hosting `Permissions-Policy: geolocation=()` blocked delivery location in real browsers → `geolocation=(self)` across all hosting targets.
  7. bot/index.js generated `/pizza/delivery.html` URLs → now `?b=${resolveBusinessIdFor(OUTLET)}&o=${OUTLET}` so links resolve for ANY restaurant/business (generic multi-tenant).
- Verification: `node gate-verify.js` + `node --test bot/tests/unit.test.js` 8/8 pass. Live E2E via Playwright (fresh incognito context, geolocation granted): delivery.html?o=pizza booted clean, dish added to cart, order placed (₹129, status Placed, source webview_delivery), token marked used:true, order landed in `businesses/roshani-pizza/outlets/pizza/orders`. Security negative test: REST write with a nonexistent token → Permission denied (401). Test data cleaned up.
- Deployed: database rules, hosting:menu (foodhubbie-qrmenu.web.app). bot not deployed (code + tests only).
- Files: menu/js/firebase.js, menu/js/delivery.js, menu/js/delivery-order.js, menu/sw.js, database.rules.json, firebase.json, bot/index.js

### [20260811-220728-3a13] 17-GATE: multi-tenant refactor businesses/{bid}/outlets/{oid} across rules, bot, menu, Admin, rider + gate-verify + tests + CI
- TIER: 3 (high-risk)
- STATUS: IN PROGRESS (code done; live DB gate blocked on service account)
- Started: 2026-08-11 22:07 UTC
- Milestones: M1a outlet-resolution.js pivot module (done); M1b rules restructure (done, validated 24698B, 12 top nodes); M2 bot migrate (done, all node --check + grep-verified); M3 menu firebase.js (done, ?b= BUSINESS_ID); M4 Admin firebase.js tenantRef/tenantPath + 9 feature files (done); M5 rider-app constants.ts dbPaths (done); M6 gate-verify.js + bot/tests + ci.yml (done, gate PASS 0 fail / 1 warn).
- Verification: `node gate-verify.js` → PASS (structural rules/bot/menu/Admin/rider + 19 node --check syntax files). Unit tests `node --test bot/tests/unit.test.js` → 8/8 pass. Live 17.5 gate RAN (bot/service-account.json + FIREBASE_DB_URL=https://foodhubbie-10-default-rtdb.firebaseio.com): businesses/ ABSENT → expected FAIL (new DB is empty). Rules wildcards are `$businessId`/`$outletId` (gate calibrated to repo, not guide's $bid/$oid shorthand).
- Credentials (2026-08-11): service account foodhubbie-10 placed at bot/service-account.json (gitignored); .env created (0 placeholders, WA_PERMANENT_TOKEN + WA_APP_SECRET + WA_VERIFY_TOKEN=05af5e0291daed08d3ace69e45138af5); DB verified reachable via v1beta Management API (instance ACTIVE). foodhubbie-10 has NO web apps registered yet.
- OPEN: live 17.5 DB gate requires seeding businesses/{bid}/outlets/{oid} into foodhubbie-10 (empty). All apps (menu/Admin/rider) still hardcode prashant-pizza-e86e4 web config → must repoint to foodhubbie-10 when web apps created. rider-app build not run locally (no node_modules).

### [20260804-110500-9d32] Fix dashboard FOUC (plain HTML flash) — render-blocking CSS + version cache sync (v5.3.18)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-04 11:00 UTC
- Files touched: Admin/index.html, Admin/sw.js
- Verified: Root cause = non-render-blocking CSS (`rel="preload" as="style" onload` + `media="print" onload` async pattern) guaranteed an unstyled first paint; `.layout.hidden` and seamless-mode `#initial-loader{display:none}` left it uncovered. Fix A: replaced async links with plain render-blocking `<link rel="stylesheet">`. Fix C: synced stale ADMIN_VERSION (was 5.3.6 → banner never fired), versioned ASSETS_TO_CACHE to match ?v= URLs (style.css/mobile-overrides.css/branding/firebase-config/receipt-templates/js/main.js), updated SW comment, bumped v5.3.18. Live verified: render-blocking links present, no preload/print pattern for app CSS, no 5.3.17 leftovers, sw CACHE_NAME v5.3.18 + versioned assets, 0 C1 chars. First paint now waits for CSS (SW-cached ~0ms warm) instead of showing unstyled HTML.
- NOT verified / open risk: On cold cache-miss first paint now blocks on CSS (expected, standard behavior); browser-level visual check not run (no Playwright).
- Confidence: HIGH
- Ended: 2026-08-04 11:05 UTC

### [20260804-100500-6f21] Fix emoji mojibake (v5.3.16 bump) + replace all remaining Tabulator tables (Inventory, Lost Sales)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-04 09:50 UTC
- Files touched: Admin/index.html, Admin/sw.js, Admin/js/features/inventory.js, Admin/js/features/lost-sales.js, Admin/js/features/feedback.js, Admin/js/features/rider-analytics.js, Admin/mobile-overrides.css, Admin/js/tabulator-setup.js (deleted)
- Verified: Mojibake root-caused to Set-Content re-encoding during 5.3.16 bump. index.html/sw.js restored via git checkout, feedback block + version bump re-applied with UTF-8-safe pattern. Repo-wide scan: 0 C1 controls + 0 mojibake leaders in all source text files. Built clean dist (text scan clean). Deployed v5.3.17; live fetch verified 0 C1 chars, 0 Tabulator refs, invDataTable/lostSalesTable/feedbackTable/payDataTable present, inventoryPagination/feedbackPagination gone, mob-badge-rating-* + mob-sort-* + cell-value-* + grid-stock-* survived PurgeCSS. inventory.js & lost-sales.js rewritten as sortable mob-data-table; data-action/data-id/data-val/data-name contract with main.js dispatcher preserved (adjustStock, editInventoryItem, deleteInventoryItem, viewStockHistory, clearLostSales).
- NOT verified / open risk: Browser-level render of Inventory/Lost Sales rows with real data not run this session (no Playwright); DOM wiring mirrors verified payments/feedback pattern.
- Confidence: HIGH
- Ended: 2026-08-04 10:05 UTC

### [20260804-075040-3c38] Replace Feedback tab Tabulator with payments-style mob-data-table
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-04 07:50 UTC
- Files touched: Admin/js/features/feedback.js, Admin/index.html, Admin/mobile-overrides.css, Admin/js/features/rider-analytics.js, Admin/sw.js
- Verified: Build clean (esbuild+PurgeCSS). Live assets v5.3.16 fetched: index.html has #feedbackTable/#feedbackCount, no feedbackPagination; feedback.js has zero Tabulator refs + mob-badge-rating + mob-td-strong; css has rating-high/mid/low; rider-analytics.js zero Tabulator. Sortable mob-data-table mirrors verified payments.js pattern.
- NOT verified / open risk: Browser-level render of rows with real feedback records not run this session (no Playwright); structural/DOM-triggering path is identical to verified payments table.
- Confidence: HIGH
- Ended: 2026-08-04 07:50 UTC

### [20260803-194131-38c7] Update PROJECT_LEDGER + README (payments fix docs)
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-08-03 19:41 UTC
- Files touched: PROJECT_LEDGER.md, README.md
- Verified: Ledger: closed 20260803-192722-2941 as done/high, recorded standing decision (PurgeCSS safelist for runtime-composed classes) + fragile file tools/build.mjs. README: rewrote Analytics/Reports (mobile-first mob-* UI, analytics-mobile.js) and Payments (mob-data-table, badges, renderPayments) sections to match verified live DOM.
- NOT verified / open risk: None
- Confidence: HIGH
- Ended: 2026-08-03 19:41 UTC

### [20260803-192722-2941] Reverify payments tab mob-* CSS variable fix
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-03 19:27 UTC
- Files touched: Admin/mobile-overrides.css, Admin/index.html, Admin/sw.js, tools/build.mjs
- Verified: Live-verified on roshani-sudha-admin.web.app/#payments: --mob-* vars now resolve on :root (card border #e2e8f0, thead dark bg + white text, totals/sublabels correct). PurgeCSS safelist /^mob-/ added so runtime-composed badge classes survive build. Badges render colored live: pay-cash rgb(21,128,61), status-cancelled rgb(220,38,38), white text. v5.3.15 cache-bust deployed. 0 console errors.
- NOT verified / open risk: None
- Confidence: HIGH
- Ended: 2026-08-03 19:39 UTC

### [20260718-040027-a044] Discount tab mobile CSS/UI/UX responsive fixes
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-07-18 04:00 UTC
- Files touched: Admin/mobile-overrides.css
- Verified: All 14 CSS blocks verified against actual DOM. 691 balanced braces. No selector conflicts. Deployed live confirmed.
- NOT verified / open risk: None
- Confidence: HIGH
- Ended: 2026-07-18 04:00 UTC

### [20260715-031827-4301] Clean up CLAUDE/ and Skill Set/ dirs (review findings)
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-07-15 03:18 UTC
- Confidence: HIGH
- Ended: 2026-07-15 03:20 UTC

### [20260715-030542-9761] Verify all fixes live � dropdown, PWA offline, isTerminal, code dedup
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-07-15 03:05 UTC
- Ended: 2026-07-15 03:07 UTC
- Verification: 4 parallel Playwright agents — admin (0 console errors, login loads), menu (SW registered, manifest link, offline banner, 0 errors), rider (correct title, CSS, form, 0 errors). Live curl confirmed `isBody` fix in main.js, `isTerminal` includes `'Served'`, `_retryBoot`/`offlineBanner` in menu app.js, `sw.js` HTTP 200
- Confidence: HIGH

### [20260715-025004-e40a] Fix menu app PWA offline � add service worker, manifest.json, registration for offline support
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-07-15 02:50 UTC
- Ended: 2026-07-15 02:58 UTC
- Verification: Service worker (`menu/sw.js`) registered with cache-first strategy + stale-while-revalidate. Manifest (`menu/manifest.json`) has `display: standalone`, inline SVG icon. 1.5s boot timeout in `app.js` with offline banner + auto-reconnect. Deployed to Firebase hosting, confirmed HTTP 200
- Confidence: HIGH

### [20260715-024132-7ada] Formal verification of all completed fixes � drawer redesign migration, STATUS_SEQUENCES alignment, ISO createdAt fixes, rider filter, dead code removal, CSS fixes
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-07-15 02:41 UTC
- Ended: 2026-07-15 02:43 UTC
- Verification: 15 checks passed per Rigorous Dev Protocol Tier 2 — TypeScript build (`tsc -b`) clean, Vite build clean, oxlint passes, grep confirmed no `.drawer-scroll-body`/`.drawer-header-v4`/`.drawer-section`/`.drawer-action-bar`/`.drawer-summary-panel` remain. `STATUS_SEQUENCES` 9-step confirmed (includes `Arriving at Restaurant`/`Arrived at Restaurant`). `DRAWER_ONLINE_PHASES` includes `Arriving` phase. Dead `shared/order-status.js` deleted. `.history-status-served` uses indigo
- Confidence: HIGH

### [20260714-120000-001] Production readiness audit — rider-app
- TIER: 3
- STATUS: COMPLETED
- Findings: rider-app/PRODUCTION_ISSUES.md — 3 critical, 9 high, 10 medium, 40+ pass

### [20260714-100000-001] Rider app Phase 1-3 implementation
- TIER: 3
- STATUS: COMPLETED

### [20260711-034449-8631] Fix FCM push notifications
- TIER: 2
- STATUS: COMPLETED
<!-- TASK_LOG_END -->
