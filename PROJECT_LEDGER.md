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
- **WhatsApp validate rule** has known `.validate` path mismatch with `push()` — PRODUCTION_ISSUES.md #1.

<!-- STANDING_DECISIONS_START -->
- [2026-08-04 10:00 UTC] PowerShell version-bump/edits on files with non-ASCII (emoji, ₹, typography) MUST use the UTF-8-safe pattern: `[System.IO.File]::ReadAllText(path, UTF8)` + `WriteAllText(path, content, UTF8Encoding($false))`. NEVER `Get-Content`/`Set-Content` — the 5.3.16 bump corrupted every emoji in Admin/index.html + sw.js (mojibake "ðŸ�½ï¸�"). Signature of corruption = C1 control chars U+0080–U+009F.
- [2026-08-04 10:00 UTC] ALL tables now use `mob-data-table` (payments, feedback, inventory, lost-sales). Tabulator CDN + `Admin/js/tabulator-setup.js` removed. New/rewritten tables must reuse the mob-data-table pattern, never reintroduce Tabulator.
- [2026-08-03 19:39 UTC] Runtime-composed CSS classes (built as \mob-badge-pay-*\/\mob-badge-status-*\ in JS) MUST be safelisted in tools/build.mjs PurgeCSS config, or PurgeCSS strips them from dist. Root cause of invisible payment badges. Add any new runtime-composed class family to the /^mob-/ (or matching) safelist regex.
- Rider app: `rider-app/` is the new production target (old `rider-old/` deleted)
- PII in `tableSessionsContact` only
- `_effectiveTotal()` canonical
- `equalTo(null)` canonical
- Firebase v12 auto-persistence
- WhatsApp `.validate` needs fixing (see PRODUCTION_ISSUES.md)
<!-- STANDING_DECISIONS_END -->

## Fragile Files

- **`database.rules.json`** (312 lines): Complex rules for multi-outlet, multi-role access.
  Any edit must be JSON-validated and cross-checked against admin, rider, and menu apps.
  `bot/$outletId/commands` validate rule must handle `push()`-generated keys.
- **`Admin/js/features/orders.js`**: `STATUS_SEQUENCES` and `STATUS_MAPPING` must stay in
  sync with rider status pipeline (12 statuses total).
- **`firebase.json`**: 3 hosting targets (admin, rider, menu); rider CSP differs from admin.
  Rider CSP img-src currently has `http://*` — needs to match admin's `https://*`.
- **`rider-app/src/services/orderService.ts`**: Core delivery lifecycle. `resendOtp` has
  known non-atomic write bug. `assertProximity` now has GPS accuracy guard.
- **`rider-app/src/services/whatsappService.ts`**: `.validate` in database rules blocks all
  pushes. Fix both sides in sync.

<!-- FRAGILE_FILES_START -->
- `Admin/index.html` & `Admin/sw.js` — contain emoji/₹/typography; any version bump/edit MUST use the UTF-8-safe PowerShell pattern (Standing Decision 2026-08-04) or all non-ASCII corrupts
- `tools/build.mjs` � PurgeCSS safelist (runtime-composed classes) � any new dynamically-built CSS class family must be added here or it gets purged from dist (flagged 2026-08-03 19:39 UTC)
- database.rules.json — multi-role complex rules
- Admin/js/features/orders.js — STATUS_SEQUENCES alignment
- firebase.json — 3-target hosting, CSP divergence
- rider-app/src/services/orderService.ts — delivery lifecycle
- rider-app/src/services/whatsappService.ts — validate rule mismatch
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
