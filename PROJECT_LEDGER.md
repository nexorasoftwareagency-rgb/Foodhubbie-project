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
- [2026-09-30 03:50 UTC] Super provisioning = BOTH custom claims (isSuper/isSupreme) AND admins/{uid} mirror row (isSuper+isSupreme). RTDB rules (database.rules.json businesses/.read) check ONLY the admins/{uid} mirror - they cannot see custom claims - while SupremeAdmin/js/auth.js:51-62 accepts claims alone. Claims-only super = app renders but /businesses listener dies with permission_denied (data-store.js:40 + false 'reconnecting' toast; started=true so no self-heal, hard refresh required). 2026-09-30: the 2 real super accounts (UXrcVENOnrS4PPyu7XoOP994BPc2 nileshshah84870, V8jxcqeXMJd1pNodadk3HjIY6hh1 nexorasoftwareagency) had claims but NO admins row - restored both rows. Checklist when minting any future super: setCustomUserClaims + admins/{uid}.update({isSuper,isSupreme,email,name}). TUNNEL_URL console warning is unrelated pre-existing fallback (firebase-config.js:30).
- [2026-09-30 02:55 UTC] Promotional WhatsApp messaging (campaigns via sendPromotionalMessage/runPromotionCampaign) is OFFICIAL-API (meta transport) ONLY - hard-blocked on Baileys since 2026-09-30 because bulk promos are the top account-ban trigger on the unofficial transport. Guard: isMetaTransport(sock) in bot/utils.js; campaign start pauses with pauseReason 'transport-blocked' (Admin shows it raw), send-level throw 'promo-blocked-transport' is defense-in-depth (non-retryable in sendWithRetry). SEND_GENERIC_MESSAGE is NOT promotional (Admin Chat + rider 1:1 service channel) and stays open. Re-enables automatically when meta transport is active post-WABA.
- [2026-09-30 02:42 UTC] Ban-proofing (4-8s per-chat pacing + 3-strike 30-min freeze) is BAILEYS-TRANSPORT SCOPE ONLY. When official WhatsApp Business API (meta transport - user's 'best experience delivery' plan) is enabled after WABA lands: SKIP paceOutboundTo + strike/freeze (Meta enforces its own messaging limits; unofficial-account ban risk does not exist there). Current code paces ALL transports (wrappers at bot/index.js:1473 sendMessage / :1541 sendTemplate incl. meta / :1558 sendButton) - gate NOT implemented now because meta path is unreachable/untestable until WABA; add the transport==='meta' skip as a checklist item at flip time together with the existing template param re-verification.
- [2026-09-30 01:14 UTC] Both pm2 bot processes run transport=baileys (id4=live roshani-pizza, id12=wizard-test outlet -P-TahoJb732KsrERdxm never QR-paired since Sep 25). Template sends only activate when typeof sock.sendTemplate === function (meta transport); Baileys uses restored legacy msg/img text-image path. When business verification lands + real WABA flips an outlet to BOT_TRANSPORT=meta, re-verify: template param counts vs Graph, body-to-{{1}} mapping (proactive_promo has NO vars -> code100 -> text fallback), and chat-log component text.
- [2026-09-30 01:14 UTC] Bot ban-proofing state lives in bot/utils.js (in-memory Maps): paceOutboundTo (4-8s random per-chat gap) is wired into ALL 3 send wrappers in bot/index.js; freeze (3 continuous non-intent strikes in AWAITING/WEBVIEW -> 30-min silence) is enforced ONLY at the message handler + marketing gates (sendPromotionalMessage, SEND_GENERIC). Transactional order-status notices are DELIBERATELY never frozen (utility templates are ban-safe; dropping them would mark real orders sent-but-not-delivered). Admins never accumulate strikes (isAuthorized gate) or they would lose reports/alerts. Extend in utils.js, never re-add freeze-drop to the generic send wrappers.
- [2026-08-12 02:20 UTC] **DUAL-TRANSPORT WHATSAPP BOT (per restaurant)**: each restaurant/business supports BOTH Meta Cloud API (`BOT_TRANSPORT=meta`) and Baileys (`BOT_TRANSPORT=baileys`). ONLY ONE is active per restaurant at a time. Transport is controlled remotely from **Supreme Admin → Restaurants Profiles → WhatsApp Baileys section** (Scan QR button → shows QR + live status), mirrored on the WhatsApp second dashboard. Meta API is the default/primary; Baileys used when a restaurant wants a real number via QR. Bot reads transport mode from Firebase `bot/{outlet}/transport` (or env default), switchable at runtime.
- [2026-08-12 02:20 UTC] **STATIC IMAGES FOR FIREBASE HOSTING**: brand/menu images may be placed directly in the project directory (e.g. `menu/images/`, `assets/`) and deployed with Firebase Hosting, referenced via relative URLs like `/images/logo.png`. No Firebase Storage upload needed for static brand assets.
- [2026-08-04 10:00 UTC] PowerShell version-bump/edits on files with non-ASCII (emoji, ₹, typography) MUST use the UTF-8-safe pattern: `[System.IO.File]::ReadAllText(path, UTF8)` + `WriteAllText(path, content, UTF8Encoding($false))`. NEVER `Get-Content`/`Set-Content` — the 5.3.16 bump corrupted every emoji in Admin/index.html + sw.js (mojibake "ðŸ�½ï¸�"). Signature of corruption = C1 control chars U+0080–U+009F.
- [2026-08-04 10:00 UTC] ALL tables now use `mob-data-table` (payments, feedback, inventory, lost-sales). Tabulator CDN + `Admin/js/tabulator-setup.js` removed. New/rewritten tables must reuse the mob-data-table pattern, never reintroduce Tabulator.
- [2026-08-03 19:39 UTC] Runtime-composed CSS classes (built as \mob-badge-pay-*\/\mob-badge-status-*\ in JS) MUST be safelisted in tools/build.mjs PurgeCSS config, or PurgeCSS strips them from dist. Root cause of invisible payment badges. Add any new runtime-composed class family to the /^mob-/ (or matching) safelist regex.
- [2026-09-25] **LOST SALES FEATURE REMOVED** — Complete removal of "Lost Sales" tab from Admin Dashboard. Deleted `Admin/js/features/lost-sales.js`, removed sidebar nav (`data-tab="lostSales"`), tab content (`#tab-lostSales`), `loadLostSales()` call in `ui.js`, `btnClearLostSales` listener in `main.js`, mobile CSS styles, DB rules (`logs/lostSales` + `outlets/$oid/lostSales`), page guide entries, and documentation references. Feature no longer exists in codebase.
- Rider app: `rider-app/` is the new production target (old `rider-old/` deleted)
- PII in `tableSessionsContact` only
- `_effectiveTotal()` canonical
- `equalTo(null)` canonical
- Firebase v12 auto-persistence
- [2026-09-25 13:44 UTC] **Discount category matching is KEY→NAME**: `discount.categoryIds` are Firebase push keys (`catalog.js` uses `push()`), but carts carry category **names** (POS stores `dish.category`) or **nothing at all** (QR order items are `{name,qty,price,addons,instructions}`). Any category matcher must resolve keys through `getAllCategories()` in `discount-evaluator.js` — comparing keys against names returns false silently, with no error anywhere.
- [2026-09-25 13:44 UTC] **`channel:'pos'` also covers `channel:'table'`** (`discountAllowsChannel`, one additive clause). Table bills settle through the POS terminal. The editor's `<select id="discChannel">` could not author a `table` value until 2026-09-25 15:16 (added; dead `whatsapp` option removed in the same pass — `website` keeps its **value**, only the label changed, so no data migration and no evaluator change was needed). Reports split closed 2026-09-25: `channelCounts` = pos/table/webview/other — the `whatsapp` and `manual` buckets were deleted because no code writes them, and `webview` (the bot's QR/delivery channel, written as `channel:"webview"` at `bot/index.js:1686`) had been hiding in "Other". `.channel-*` chip colors also need `/^channel-/` in the `tools/build.mjs` PurgeCSS safelist or every modifier is stripped from dist (only `channel-chip` survives, because that literal is the only one that appears in source).
- [2026-09-25 13:44 UTC] **Bump `Admin/sw.js` `CACHE_NAME` whenever any file in `ASSETS_TO_CACHE` changes.** The `js/features/*` entries carry no `?v=` query and the fetch handler is stale-while-revalidate, so a stale/new module pair (e.g. a sync export + a caller that now `await`s it) can serve together until the cache name forces a clean re-cache.
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
- `bot/utils.js` � Hosts the shared ban-proofing module (paceOutboundTo/recordWrongMessage/isJidFrozen/clearWrongStrikes, module-level Maps) exported to index.js + promotions.js, plus maskJid/RateLimiter/OutboundTracker used across the bot. Behavior changes here hit every send path and every outlet; covered by bot/tests/unit.test.js ban-proofing test - keep it green. (flagged 2026-09-30 01:14 UTC)
- `bot/index.js` � Send wrappers carry 4 stacked concerns (chat-log, G5 quota counter, per-chat pacing, conversation logs) and the status-notification send block chooses template-vs-text by transport; the ban-proofing freeze gates live in the message handler (isAuthorized hoisted). Any edit here needs impact_scan first - breaking a wrapper silently loses chat history or quota counts. (flagged 2026-09-30 01:14 UTC)
- `Admin/index.html` & `Admin/sw.js` — contain emoji/₹/typography; any version bump/edit MUST use the UTF-8-safe PowerShell pattern (Standing Decision 2026-08-04) or all non-ASCII corrupts
- `tools/build.mjs` � PurgeCSS safelist (runtime-composed classes) � any new dynamically-built CSS class family must be added here or it gets purged from dist (flagged 2026-08-03 19:39 UTC)
- database.rules.json — multi-role complex rules
- Admin/js/features/orders.js — STATUS_SEQUENCES alignment
- firebase.json — 3-target hosting, CSP divergence
- rider-app/src/services/orderService.ts — delivery lifecycle
- `Admin/js/features/discount-evaluator.js` — shared money path for POS *and* table billing. `getEligibleOffersForDisplay()` is **async** (it needs the category key→name map); every caller must `await` it — exactly 2 exist (`pos.js` `_renderWalkinOffers`, `tables.js` `_renderTableBillOffers`). `bot/discount-engine.js` is a deliberate near-mirror that is intentionally NOT kept in lockstep on channel/category (see task 20260925-134422-4e70).
- `Admin/sw.js` — precache list; see Standing Decision 2026-09-25 on bumping `CACHE_NAME`.
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
### [20260930-042439-f848] Review-findings fixes: stale counterStaffUid attribution (money path), printer-fallback claim, dead PIN code + stale copy
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 04:24 UTC
- Verified: build green; role-chip-check 8/8 (auth boot regression) + tests/attribution-check.mjs 11/11: F3 resolver record-driven (null/undefined uid -> '', owner uid -> 'Owner � pizza' via admins fallback, unresolvable -> ''), F1a POS entry re-signs stale uid overwritten, F1b logout clears + login re-signs current uid immediately + POS re-entry correct (caught live: re-login while walkin tab active never re-ran loadWalkinMenu � fixed by auth-boundary sign-in), endShift clears + toast without PIN wording + no dead check, 0 pageErrors
- NOT verified / open risk: multi-agent cross-review (3 explore agents failed: opencode.ai DNS) � verified by single-agent deep read with file:line evidence; Manager/Cashier/Waiter ceiling paths (same gate code, owner-only creds); deleted verifyCounterPin (zero refs after promptCounterPinSignIn removal, grep-proven)
- Confidence: HIGH
- Ended: 2026-09-30 04:31 UTC

### [20260930-032202-df4e] Payments review fixes: add missing billing payments/charges .validate rules; receipt stale-snapshot; Esc-dismiss promise resolve; charge period badge; clamp negative due; drop dead isExcluded
- TIER: 3 (high-risk)
- STATUS: IN PROGRESS
- Started: 2026-09-30 03:22 UTC

### [20260930-025638-ac70] Dashboard top area: show logged-in Role + Name (any role) on desktop topbar + mobile header
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-09-30 02:56 UTC
- Verified: build green; 8/8 playwright (tests/role-chip-check.mjs: local dist + SA-minted custom-token sign-in as owner uid � no password needed): desktop chip 'Owner � pizza' (bold role, em-dash name) visible in topbar, email kept; mobile chip visible under Dashboard title at 390px, desktop-only topbar chip hidden; 0 pageErrors; screenshots role-chip-desktop.png (1440x900) + role-chip-mobile.png (390x844) visually confirmed (orange bold 'Owner' pill + mobile line)
- NOT verified / open risk: Manager/Cashier/Waiter logins (same DEFAULT_ROLES mapping path as Owner, only owner account exists); staff-login name source; renamed outlet-gate custom role labels (fill runs before loadOutletGates with DEFAULT_ROLES � standard labels match)
- Confidence: HIGH
- Ended: 2026-09-30 03:30 UTC
- Deployed: commit 27a1d9e pushed; hosting:admin released (this chip + claim task 023514 both live) — post-deploy live E2E: role-chip-check 8/8 + POS no-PIN/reports-claim spot-check 5/5 on foodhubbie-admins.web.app, 0 pageErrors

### [20260930-024936-a0c9] Block promotional messaging on Baileys transport (ban risk) - official meta API only
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 02:49 UTC
- Confidence: HIGH
- Ended: 2026-09-30 02:56 UTC

### [20260930-023514-9455] POS: drop Counter PIN shift prompt (role tab-access auto sign-in); add By {Role} - {Name} claim to receipts + Reports (screen + PDF)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 02:35 UTC
- Verified: build green; 9/9 playwright (dist==working tree): POS opens with NO PIN prompt + counterStaffUid auto-signed + menu rendered + no access-denied; resolveOperatorClaim returns '{Role} � {Name}'; receipt template shows claim + omits when empty; reports screen claim textContent 'By Owner � pizza'; reports PDF export generated Sales_Report_2026-09-01_to_2026-09-30.pdf (30D range); 0 pageErrors; claim-pos/claim-reports screenshots pixel-verified on disk
- NOT verified / open risk: real placed-order print E2E (resolver + template tested standalone instead); PDF bytes not scanned for claim text (shared _claimText verified on screen); read tool served shuffled screenshot bytes � verified via pixel sampling instead
- Confidence: HIGH
- Ended: 2026-09-30 02:52 UTC

### [20260930-021844-1cfc] Redesign Expenses Categories sub-tab: modernize category cards (hero spend, pct badge, thicker bar, icon actions) + toolbar polish; keep DOM contract
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 02:18 UTC
- Files touched: Admin/js/features/expenses.js, Admin/mobile-overrides.css
- Verified: node --check + build OK; Playwright vs built dist: 8 cards, 7 pct badges+bars, 16 icon action buttons, edit-icon opens form with Rent values, Back restores list, search empty-state works, 0 console errors; 2 screenshots inspected; temp admin deleted; server stopped
- NOT verified / open risk: live deploy (not deployed); over/warn card states (no category over budget this month to render); mobile-chome viewport
- Confidence: HIGH
- Ended: 2026-09-30 02:25 UTC

### [20260930-021841-b602] Desktop regression of final merged Staff Mgmt two-page design (post role-card sweep 711d91c)
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-09-30 02:18 UTC
- Verified: 9/9 playwright desktop 1440x900 vs dist==HEAD 711d91c, 0 pageErrors; pill switch both ways + aria-selected, count chip 5/5, 6-col header exact (Name|Counter PIN|Discount Ceiling|Last Signed In|Status|Actions, no Role), role-group headers, 5 role cards + chip clouds; screenshots sm-desktop-{staff,roles}.png reviewed
- NOT verified / open risk: role modal open/save flows not re-run (unchanged code, previously verified); live deploy untouched (already at 711d91c)
- Confidence: HIGH
- Ended: 2026-09-30 02:19 UTC

### [20260930-020129-d3cd] Notification tab review fixes: missing imports crash + duplicate/stale OS notifications
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 02:01 UTC
- Confidence: MEDIUM
- Ended: 2026-09-30 02:12 UTC

### [20260930-013658-9010] Redesign Expense tab Add Expense form: modernize modal (hero amount, category icon tiles, compact grid) preserving DOM contract
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 01:36 UTC
- Files touched: Admin/index.html, Admin/mobile-overrides.css, Admin/js/features/expenses.js
- Verified: node --check OK; build OK; Playwright vs built dist: 8 tiles render, tile click writes select+1 active, select hidden, edit-from-History restores active tile+title/amount/date, 0 console errors; 3 screenshots inspected (hero/tile-active/edit); temp e2e admin deleted (user+mirror gone)
- NOT verified / open risk: live deploy (not deployed); real expense submit write (handler untouched); mobile-chone viewport
- Confidence: HIGH
- Ended: 2026-09-30 01:49 UTC

### [20260930-013331-7616] Mobile viewpoint: verify Staff Mgmt two-pane redesign at iPhone 13 (390px); fix grid min-content propagation
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-09-30 01:33 UTC
- Verified: 8/8 playwright checks iPhone13 390px (dist :8124), 0 pageErrors; screenshots sm-mobile-{staff,staff-scrolled,roles}.png reviewed; root fix [data-settings-section=staff-management]{min-width:0} style.css:2406 (grid item min-width:auto propagated table min-content 937px, masked by body overflow-x hidden); build green
- NOT verified / open risk: not deployed (min-width fix pending commit decision � style.css entangled with parallel uncommitted WIP); desktop re-run of 9-check suite not repeated after CSS change (CSS scoped to one attribute selector)
- Confidence: HIGH
- Ended: 2026-09-30 01:33 UTC

### [20260929-161329-a46b] tests/wizard-billing.spec.js: wizard E2E asserts billing defaults (non_refundable setup, rates, tokens); temp super + cleanup
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-29 16:13 UTC
- Files touched: tests/wizard-billing.spec.js
- Verified: npx playwright test --project=chromium 1 passed (17.7s): wizard created outlet, billing asserted (non_refundable setup, rates exact, tokens 15, no monthlyRate); cleanup verified post-run: business node gone, 0 leftover e2e users/admins
- NOT verified / open risk: runs chromium desktop project only (mobile project skipped by design)
- Confidence: HIGH
- Ended: 2026-09-29 16:15 UTC

### [20260929-160651-f077] Redesign Staff Management settings section: split into two in-page tabs (Staff | Roles & Access), pane-scoped actions, staff count chip
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-29 16:06 UTC
- Confidence: HIGH
- Ended: 2026-09-29 16:19 UTC

### [20260929-135429-0e83] Setup fee 500 -> non-refundable everywhere: copy (website+wizard), billing seeds, costs label de-tie from transport, profile dropdown; sync EC2
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-09-29 13:54 UTC
- Files touched: website/index.html,website/signup.html,shared/billing-defaults.js,shared/billing-defaults.cjs,tools/seed-billing-defaults.cjs,Admin/js/features/costs.js,Admin/sw.js,SupremeAdmin/js/features/restaurant-onboarding.js,SupremeAdmin/js/features/restaurant-profile.js,SupremeAdmin/shared/billing-defaults.js(deleted)
- Verified: 15/15 live hosting checks PASS; DB audit 7/7 non_refundable pre/post; seed migration 7 PATCH lines; EC2 md5 match + pm2 stable + tunnel 401-alive; dist greps correct; node assert .cjs shape; no stale monthlyRate rows existed
- NOT verified / open risk: full wizard E2E restaurant create (no browser MCP this session) - verified statically via built dist: import path + billing:M() + ESM content
- Confidence: HIGH
- Ended: 2026-09-29 14:08 UTC

### [20260929-1015-c9d2] PLAN-WEBSITE-ONBOARDING-APPROVAL verification pass — reject-path rules bug found + fixed
- TIER: 3 (production security rules)
- STATUS: COMPLETED
- Verified all 8 plan steps against code: rules, signup.html + CTAs, approve-onboarding endpoint, #onboarding route + UI, locked gate (auth.js:252/299, state.js:57, ui.js:430, main.js:127 SAFE_ACTIONS), unlock-outlet action (restaurant-profile.js:262/1302), WhatsApp tab rename + `_checkBotStatus()` onboarding card (chat.js:379-470) — all present.
- BUG FOUND (live REST test, `bot/verify-onboarding-rules.js`): **Reject button always 401'd.** `$reqId` `.validate` forced `status == 'pending'` (blocked the status→rejected transition) AND `rejectReason`/`reviewedAt`/`reviewedBy` weren't in the child allowlist (hit `$other: {".validate":"false"}`). Approve worked only because it goes through bot-control-api (Admin SDK bypasses rules). 3/3 client reject writes: 401.
- FIX: `database.rules.json` — `$reqId` validate now allows `status=='pending'` (unauth create) OR `approved`/`rejected` when auth is super/supreme; added child validates for rejectReason (1-500), reviewedAt (number), reviewedBy (≤128), bid/oid (≤64).
- Verified live post-deploy: unauth create 200 ✓, super reject write 200 ✓ (final state shows status/rejectReason/reviewedAt/reviewedBy), super locked write 200 ✓, unauth locked write 401 ✓, unauth read 401 ✓.
- Plan doc status DRAFT → DONE. Cleanup: temp users/requests deleted, stray `locked` test field removed from real outlet.
- Update (same task): EC2 deploy DONE via scp (ACCESS.md pattern) instead of git pull. Found + fixed crash: `server.js:29` required `../../shared/billing-defaults.cjs` (escapes repo — from commit b773eb6), MODULE_NOT_FOUND crash-loop on boot. Fixed to `../shared/`, scp'd server.js + shared/billing-defaults.cjs, pm2 restart, md5 match. Verified through tunnel: POST approve-onboarding 400 (auth, validation reached handler) / 401 (no auth) — was 404 before.

### [20260928-1405-f8a1] Website onboarding + locked state + WhatsApp tab — Steps 1-7
- TIER: 3 (production security rules + auth gates + new data flows)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 14:05 UTC
- Plan: `docs/PLAN-WEBSITE-ONBOARDING-APPROVAL.md`
- **Step 1 — Rules:** Added `onboardingRequests` node (unauth write with `source: 'website'`, read = isSuper/isSupreme) + `locked` field on outlets (write = isSuper/isSupreme, read = auth). Deployed.
- **Step 2 — Website signup:** Created `website/signup.html` (business/outlet/contact/admin-login/plan/whatsapp form → `onboardingRequests.push()`). Added CTAs from `index.html` + `book.html`. Deployed `hosting:website`.
- **Step 3 — bot-control-api:** Added `/api/admin/approve-onboarding` endpoint — atomic server-side creation (bid/oid, outletNo, Auth user, admins mirror, outlet with `locked: true`, template mirror, request update with `adminPassword: null`). Syntax checked.
- **Step 4 — Supreme Admin onboarding page:** Added `#onboarding` route + `onboarding-requests.js` (list with Pending/Approved/Rejected/All filters, KPIs, View/Approve/Reject actions). Sub-nav link with pending count badge. Built + deployed.
- **Step 5 — Admin app locked state:** `auth.js` — locked check after disabled gate (sets `state.locked = true`, shows locked screen). Realtime `locked` listener (clears on unlock). `state.js` — `locked: false` field. `ui.js` — `showLockedScreen()` overlay. `main.js` — global action interceptor (blocks mutating actions when locked, whitelist: logout/toggleSidebar/switchOutlet/closeOrderDrawer/printReceiptById/chatOnWhatsapp/closeModal/closeDrawer). Built + deployed.
- **Step 6 — Supreme Admin unlock:** `restaurant-profile.js` — "Unlock access" button (visible when `outlet.locked === true`) → sets `locked: false`. Admin app realtime listener picks it up → full access.
- **Step 7 — WhatsApp tab:** Renamed "Chats" → "WhatsApp" in `index.html`. `chat.js` — `_checkBotStatus()` subscribes to `bot/{outlet}/pair`, shows onboarding card with QR pairing + step-by-step guide + manual when bot not connected, hides when connected. Built + deployed.
- Files: `website/signup.html` (new), `database.rules.json`, `bot-control-api/server.js`, `SupremeAdmin/js/main.js`, `SupremeAdmin/index.html`, `SupremeAdmin/js/features/onboarding-requests.js` (new), `SupremeAdmin/js/features/restaurant-profile.js`, `Admin/js/auth.js`, `Admin/js/state.js`, `Admin/js/ui.js`, `Admin/js/main.js`, `Admin/index.html`, `Admin/js/features/chat.js`
- Confidence: HIGH (all builds green, all deploys complete)

### [20260928-1341-d5e6] Code review fixes: IST year, all-time due prefill, negative due clamp
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 13:41 UTC
- Trigger: automated code review of uncommitted changes
- Fixes (payment-record.js): (1) year dropdown uses IST year via `currentYm()` instead of local `getFullYear()`; (2) record-payment prefill uses all-time due (`{k:'all'}`) not scope due — Monthly scope with no month-due but outstanding all-time due now prefills correctly; (3) KPI Balance due clamps negative to 0 (`Math.max(stats.due, 0)`) — overpayment shows "₹0 settled" not "₹-51 settled".
- Verification: `node --check` ✓; `tools/build.mjs --supreme` ✓; deployed `hosting:supreme`. LIVE E2E (temp super minted + deleted): All-time KPI "₹0 settled" ✓; Monthly scope KPI "₹0 settled" (was "₹-51 settled") ✓; year dropdown shows 2026 ✓; record payment modal prefill empty (all-time due = 0, settled) ✓. 0 console errors.
- Note: review also flagged 3 issues in parallel-session code (database.rules.json admins role validation, staff isActive read gate, restaurant-onboarding focus) — not this session's changes, left for parallel session.
- Confidence: HIGH

### [20260928-133518-4382] Redesign Expenses Categories sub-tab: in-page form flow, category cards w/ budget usage, search, empty state
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-28 13:35 UTC
- Files touched: Admin/index.html,Admin/js/features/expenses.js,Admin/js/main.js,Admin/js/ui.js,Admin/js/features/pos.js,Admin/chat.css,Admin/mobile-overrides.css,Admin/sw.js,tests/check-expenses.mjs,tests/check-keyboard.mjs,tests/serve-dist.mjs
- Verified: check-expenses 37/37 exit0; check-keyboard 41/41 exit0; check-sw v5.5.0 controlling + 0 CSP errors; 3 category screenshots (desktop list/form, mobile) visually reviewed; node --check on all edited JS; tools/build.mjs success; prod expenseCategories back to 8 (ZZTest artifact removed via admin SDK)
- NOT verified / open risk: no deploy (dist served live already; user deploys on request); no commit (unrequested); snapshot-server runs (8124) not against live 8123 on final pass
- Confidence: HIGH
- Ended: 2026-09-29 09:22 UTC

### [20260928-1216-b2c4] Payment record page fixes: restore deleted payments, cost breakdown card, date+time, scroll verify
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 12:16 UTC
- Trigger: user reported "only visible receipt of 17 rupees" (₹100 payment missing), "not scrolling seems limited", "Date is missing", "Usage not properly shown — should show Breakdown of Cost, not direct monthly only"
- Root cause: prior session's cleanup deleted ALL 3 E2E payments including the user's own ₹100 (RCP-20260928--GH) — user's real payment, not just test data. Restored both payments (₹100 + ₹17.86) with exact original keys/amounts/receiptNos/timestamps via admin SDK. The ₹25 profile-E2E payment stays deleted (clearly test-only).
- Fixes: (1) `billing-shared.js` scopeStats now returns `rates`, `mode`, `promoTokens` for breakdown rendering; (2) `payment-record.js` new "Cost breakdown" card (component × count × rate → amount, promo row, total = usage) scoped to All/Monthly/Yearly/Custom; (3) ledger Date column now shows date + IST time ("28 Sept 2026, 02:59 pm"); (4) KPI Usage small text cleaned (dropped "+ promo" wrap).
- Verification: `node --check` ✓; `tools/build.mjs --supreme` ✓; deployed `hosting:supreme`. LIVE E2E (temp super minted + deleted): record page All-time — both payments visible (₹17.86 OB5 + ₹100 GH) with dates+times, cost breakdown QR 35×₹2=70 + Webview 7×₹3=21 + POS 12×₹2=24 + Other 1×₹2=2 + Promo 1×₹0.86 = ₹117.86 exact; Monthly scope — breakdown scoped to Sept (QR 18×2=36, Webview 6×3=18, POS 6×2=12, Promo 0.86 = ₹66.86); receipt popup date+time present ("28 Sept 2026, 02:59 pm IST"); scroll verified desktop (880px scrollable, no fixed overlays) + mobile 390×844 (1147px vertical scroll, all 3 tables h-scrollable); overview tab — Outstanding ₹0 settled, Sept usage ₹66.86, collected ₹117.86. 0 console errors. Screenshots: `.playwright-mcp/payment-record-page-v2.png`, `receipt-v2.png`, `payment-record-mobile.png`.
- Confidence: HIGH

### [20260928-0947-a7f3] Supreme Payment Management: 3rd tab + per-restaurant record page + profile billing money strip
- TIER: 3 (production security rules + money-bearing writes)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 09:47 UTC
- Plan: `docs/PLAN-SUPREME-PAYMENT-MANAGEMENT.md` (v4, #Verify'd)
- Files touched: `Admin/js/features/cost-math.js` → **moved to `shared/cost-math.js`** (+ `Admin/js/features/costs.js` import `../../shared/*`); `tools/build.mjs` (`supreme.shared:true` so `dist/shared/` emits); `database.rules.json` (`.validate` under `billing/payments/$id` + `billing/charges/$id`: amount number 0.01–1e7, method enum UPI/Cash/Card/Bank, period `/^[0-9]{4}-[0-9]{2}$/`, reason ≤200, note ≤500, receiptNo ≤64, createdAt number, delete allowed); NEW `SupremeAdmin/js/billing-shared.js` (scopeStats/monthlyRows/ledgerRows money math over shared cost-math, recordPaymentModal, addChargeModal, printReceipt popup); NEW `js/features/payment-overview.js` (list tab: KPIs, due-by-plan strip, plan/status filters, per-row Record →); NEW `js/features/payment-record.js` (All time/Monthly/Yearly/Custom scopes, KPI strip, monthly breakdown + totals, transaction ledger w/ running balance + Print receipt); `js/index.html` 3rd `dash-tab dash-payment` + `subnav-group[data-group=payment]`; `js/main.js` routes `#payments` + `#payments/{bid}/{oid}` (`dashboard:'payment'`, DASHBOARD_HOME, theme classes); `css/style.css` indigo `--accent-payment` token trio; `js/features/restaurant-profile.js` Billing card money strip (month usage/received + all-time due) + `Payment record →` + `profile-record-payment` action.
- Verification: `node --check` all new/edited modules; `node shared/cost-math.js` self-check ✓; full `tools/build.mjs` ✓ (both dists got `shared/`); deployed `database` + `hosting:admin` + `hosting:supreme` (2 rule-syntax iterations: `hasOnly` is Firestore-only → dropped; RTDB `matches()` needs `/regex/` literal not quoted string). LIVE E2E (temp super minted via admin SDK, both deleted after): 3rd tab + `#payments` overview real numbers (₹117.86 outstanding, plan strip, filters, 7 rows incl. disabled); record page scopes (All→Monthly ₹66.86/30 orders); **parity vs Admin Costs tab** (30 orders, ₹66 + ₹0.86 promo = ₹66.86 exact); record payment from record page (prefill = live due) and from profile card (₹25) → both wrote `billing/payments`, toast + receipt-offer confirm; receipt popup content verified (date, business, method, all-time balance ₹0); REST QR order `source:'QR'` → usage +₹2 live (55→56 orders, ₹119.86). E2E fixes found & redeployed: modal result missing `createdAt` (Invalid Date on receipt), receipt mixed month-usage with all-paid (−51 → now all-time stats), business name fell to bid, hard-refresh route rendered "not found" before first snapshot (now waits for data), epoch `Jan 1970` zero-bucket row filtered, receipt label "Usage (all time)".
- Cleanup: test order + all 3 E2E payments deleted (prod restored, cost-math recheck 55 orders/₹117.86/₹0 due); both temp super users + `admins/{uid}` entries deleted. Screenshots: `.playwright-mcp/payments-overview.png`, `payment-record-page.png`, `receipt.png`. 0 console errors on final pass (pre-existing identitytoolkit 400 only = deleted-session lookup).
- Confidence: HIGH

### [20260928-1318-ee42f89] Expenses tab + all 5 sub-tabs UI/UX pass
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 13:18 UTC
- Files touched: Admin/index.html (hunk-staged — only my 3 hunks: `mobile-overrides.css?v=5.4.7`, `.expense-filter-dates` group, settings button styles; parallel Costs hunks left uncommitted), Admin/js/features/expenses.js, Admin/mobile-overrides.css, Admin/sw.js (`CACHE_NAME` v5.4.8), tests/check-expenses.mjs
- Fixes: status badges invisible (missing `mob-badge-approved/pending/rejected` variants — white-on-white) + `status || 'pending'` normalize; category list raw lucide names → `<i data-lucide>` + `createIcons({root})`; report tables showed only col 1 (app-wide `min-width:860px` in ~420px cards → scoped `min-width:0` override + compact padding, grid minmax 320→420); Expense Manual `<a>` floated over Save (`width` ignored on inline anchor → `display:block`); Seed button glass-on-white → `.btn-secondary`; mobile subtab strip wraps to 2 rows (Settings was unreachable); history from/to dates fixed-width group stays one line on mobile; category rows single-line + icon; mobile Add Category respects card padding.
- Verification: `node --check` ✓; build ✓ (new classes survived PurgeCSS); local 29/29 `check-expenses` (incl. new 6c reject branch + `openAddModal` retry helper + 6a poll cleanup); deployed `hosting:admin`; LIVE 29/29 + 41/41 keyboard; all 10 subtab shots (5×desktop+mobile) re-taken live and confirmed.
- Confidence: HIGH

### [20260928-1447-1b473c6] Expense modal/drawer scroll lock leak fix — release body overflow on all dismiss paths
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-28 (session)
- Ended: 2026-09-28 14:47 UTC
- Files touched: Admin/js/main.js (Escape fallback + generic close-btn), Admin/js/ui.js (switchTab drawer teardown), Admin/js/gestures.js (swipe-close callback), Admin/sw.js (CACHE_NAME v5.4.9), tests/check-expenses.mjs (2 new regression checks)
- Fixes: leaked `document.body.style.overflow = 'hidden'` when expense modal closed via Escape (else branch bypassed closeExpenseModal); twin leaks in order drawer via switchTab tab-switch and swipe-to-close gesture — all froze scrolling on ALL tabs at ≤1024px where document is the scroller
- Fix: 4 single-line unlocks at shared funnels (not per-modal): Escape fallback, generic .close-btn, switchTab drawer strip, swipe-close — each adds `document.body.style.overflow = ''`; conditional in switchTab (only if drawer was open) avoids clearing a modal's lock on history-back; sw.js CACHE_NAME v5.4.9 forces SW cache refresh since JS is served cache-first from precache
- Verification: `node --check` ✓ ×6; build ✓ (dist has all 4 unlocks + v5.4.9); 2 new regression checks in check-expenses.mjs (lock sets on open, Escape releases); local 31/31 + live 31/31 + keyboard 41/41 (Escape drawer + POS modal paths confirmed unaffected); deployed `hosting:admin` (4 files)
- Confidence: HIGH

### [20260928-053538-867a] Redesign Add Restaurant onboarding as multi-step wizard + plan content
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-28 05:35 UTC
- Ended: 2026-09-28 06:52 UTC
- Verification: `node --check` clean; `tools/build.mjs --supreme` 276.8KB→191.8KB; PurgeCSS kept all new classes (`plan-pick`=10, `obw-grid`/`obw-pair`=2 each incl. media queries). Deployed `hosting:supreme` twice (wizard + `autocomplete="username"` fix). LIVE E2E via Playwright with temp super user (minted via admin SDK `admins/{uid}.isSuper`, deleted after): login → `#restaurants/onboard` → all 5 steps walked — empty-submit toast + focus to `#obw-business`, plan card select (`growth`), password-mismatch block ("Admin passwords do not match."), QR default checked, back-nav FormData fully retained, review summary correct with masked password. 0 console errors (only pre-existing TUNNEL_URL warning). Screenshots in `.playwright-mcp/wizard-review.png` + `wizard-review-step.png`.
- Confidence: HIGH

### [20260927-170537-a2e7] outletNo: platform-wide outlet numbers for order IDs (03-161126-12)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-27 17:05 UTC
- Confidence: HIGH
- Ended: 2026-09-27 17:12 UTC

### [20260927-155631-1800] Order ID format: Outlet-ID + DDMMYY-N (03-161126-12)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-27 15:56 UTC
- Confidence: HIGH
- Ended: 2026-09-27 16:48 UTC

### [20260927-152513-1c44] Fix rider review findings 1-8
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-27 15:25 UTC
- Confidence: HIGH
- Ended: 2026-09-27 15:52 UTC

### [20260927-141302-b923] Self-review of rider-app (full static code review, findings report)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-27 14:13 UTC
- Confidence: HIGH
- Ended: 2026-09-27 14:47 UTC

### [20260927-084756-bba1] Fix runtime ReferenceErrors: expenses.js BUSINESS_ID/db undefined, settings.js EmailAuthProvider/reauthenticateWithCredential undefined, ui.js duplicate resize listener
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-09-27 08:47 UTC
- Files touched: Admin/js/features/expenses.js, Admin/js/features/settings.js, Admin/js/ui.js
- Verified: node --check clean on expenses.js, settings.js, ui.js; Admin build passes; rider-app build passes; database.rules.json valid JSON; dist assertions confirm BUSINESS_ID, EmailAuthProvider, reauthenticateWithCredential, auth all present
- NOT verified / open risk: No live E2E test against production RTDB � these ReferenceErrors would only crash at runtime in the browser, not in node --check or esbuild
- Confidence: HIGH
- Ended: 2026-09-27 08:50 UTC

### [20260926-000000] Competitor pricing research - first-party verification across all vendors
- TIER: 1 (research/documentation only — no code, no rules, no money path; internal folder, never published)
- STATUS: DONE
- Started: 2026-09-26
- Scope: user prompt "Research on Pricing of ALL Competitors and their Features". Deliverable = `Competitor/PRICING.md` plus first-party updates to the existing 10-file competitor folder.
- Trace / constraints found before writing:
  1. Folder is **internal-only** — `website/Improvements/Rider improvements Section.md.txt:9/:633/:636/:727` bans competitor comparison tables and Swiggy/Zomato promotion on the site. Nothing here ships.
  2. Provenance rules require every claim tagged `[repo]/[site]/[live]/[web]/[assessment]/[UNKNOWN]`, and **no tag upgrades without a source**.
  3. Three of five largest vendors publish no price — that became the headline rather than a gap.
- Findings:
  1. **Petpooja billing period resolved.** `petpooja.com/pricing` shows Base INR 12,000 ex-tax but never states the period. Six independent signals (vendor's own Annually/Monthly toggle in the index; Techjockey `Outlet: 1, Yearly: 1`; chuk.in; restrofi; zendikt; Softwr 31 Aug 2026 "flat annual licence per outlet"; vendor brochure "Exclusive of GST") converge on **per outlet per year**. The folder's long-standing "third parties disagree 2-4x" flag is therefore **resolved, not averaged**: the 1,500-3,500/mo claims describe the 20k-40k tiers or annual figures divided wrongly. Still an inference — flagged for written confirmation.
  2. **QR and KDS are not in Petpooja's Base plan** — both start at Operations Manager Growth (INR 20,000) `[site]`. A tiering argument that does not depend on the annual inference.
  3. **UrbanPiper `/pricing` = 404**; Hub and Meraki FAQ both say "contact us". Own 2022 blog quotes Prime at 10,000 INR (stale, no period) — marked do-not-quote.
  4. **Restroworks publishes zero figures** on its pricing page; its `/compare/` pages position it against NCR/Oracle Micros/PAR/Toast, i.e. global enterprise, not Indian SMBs.
  5. **Long tail mapped**: ~15 vendors found; most publish nothing, and most that do publish their own comparison **of themselves** (billfeeds, swaadbyte, dineopen, platera, posible, orgnyz) — flagged as self-published marketing, not independent data.
  6. Market: ~7.5 lakh active restaurants India 2026, ~18% on digital POS (~1.35 lakh) — an adoption fight, not yet a share fight.
- Changes: **new** `Competitor/PRICING.md` (258 lines: first-party matrix, resolved billing-period evidence chain, third-party conflict tables, long-tail landscape, market size, what it means for our price). **Updated** `profiles/petpooja.md` (features re-read first-hand, billing-period section, tiering argument, gaps), `profiles/urbanpiper.md` (first-party no-price confirmation, products/customers), `MARKET-CONTEXT.md` §2 (shrunk to summary + pointer; conflict flag resolved; data hygiene rewritten), `COMPARISON.md` (Commercial model tags `[web]`→`[site]`, price curve corrected to /yr), `EVALUATION.md` (O2 corrected, **new O7 price transparency + O8 tiering**, T3 tag upgraded, T4 qualified), `SOURCES.md` (**new §4a first-party pricing pass**, §4 conflicts partially resolved, 7 collection-log rows), `README.md` (PRICING.md added to Files + Quick read, known-gap 4 rewritten).
- Verification: custom checker `C:\Users\2nile\AppData\Local\Temp\opencode\check_competitor.mjs` walks all 11 files checking U+FFFD/CR encoding, per-block table pipe counts (code spans + fenced blocks stripped), balanced fences, separator rows, and local link resolution → **ALL 11 FILES PASS**. Checker had one false positive on the ASCII positioning diagram in `MARKET-CONTEXT.md` — fixed the checker, not the file.
- Not done: Petpooja period not confirmed *in writing* by the vendor; UrbanPiper/Restroworks/DotPe figures remain quote-only; `Competitor/` still untracked (not committed — awaiting user).

### [20260925-224237-1489] User Manual reachable from the Admin sidebar (icon → dist/manual.html)
- TIER: 2 (build tooling + navigation entry point; no money path, no rules change)
- STATUS: DONE
- Started: 2026-09-25 22:30 UTC
- Scope: user prompt "user manual on Admin Tab.. as an icon.. ? right?" — the manual shipped in `0cba776` was a markdown file in `docs/`, which no deployed app can reach (`firebase.json` admin target serves `Admin/dist` only; no hosting target points at `docs/`). Commit `9a37f10`.
- Trace / constraints found before writing code:
  1. `docs/` is not on any hosting target, so linking to the `.md` would 404 — the content must land in `dist`.
  2. **No markdown library exists anywhere**: `package.json` has only playwright/esbuild/purgecss; no `marked`/`markdown-it`/`remark` in `node_modules`; nothing markdown-shaped in `tools/`, `Admin/js/`, `website/` or `SupremeAdmin/`. Adding one was ruled out (project keeps a minimal dependency set and `allowScripts` is pinned for supply-chain reasons).
  3. `Admin/` ships no secondary HTML (only `index.html`), so there was no existing page to extend.
  4. Firebase CSP on `**/*.html` allows `style-src 'unsafe-inline'` and `https://fonts.googleapis.com`, but `X-Frame-Options: DENY` means the page cannot be iframed into the SPA — it has to open as a top-level document.
- Fixes: `tools/build.mjs` gained a subset markdown renderer (`mdEsc`/`mdInline`/`mdSlug`/`mdToHtml`/`manualPage`, +136 lines) that runs after the shared-copy step, admin target only, and writes `Admin/dist/manual.html` directly into dist — so `docs/MANAGER-PIN-USER-MANUAL.md` stays the single source of truth and regenerates on every build. Covers exactly the constructs that manual uses (verified by inventory: 15 headings, 98 table rows, 3 blockquotes, 3 fenced blocks, 7 bullets, 6 ordered items, 11 hrs, 1 link, 1 h2-anchor). Sidebar gets `#menu-manual` between Settings and Logout with `data-action="openManual"`, and `main.js` handles it with one `window.open('manual.html', '_blank')` case — matching the existing `chatOnWhatsapp` 2-arg pattern. Deliberately **not** added to `ASSETS_TO_CACHE` in `sw.js`: the manual is on-demand, so no cache-name bump is needed.
- Bug caught by verification (real, would have shipped): the bold regex `\*\*([^*]+)\*\*` cannot match `**Admin app → … *Discount Approval* group**` because `[^]*` stops at the nested single star — the paragraph rendered with literal `**` around it. Fixed to `/\*\*([\s\S]+?)\*\*/g` (lazy, per-block so it cannot over-consume). A second reported failure was a **test** bug, not a code bug: the assertion used lowercase `set a ceiling` against source text `Set a ceiling`.
- Verified: 37-check script on the generated page — structure (11 h2 / 3 h3 / 11 tables / 3 blockquotes / 3 `<pre>` / 11 hr / 1 ol / 3 ul), the `#10-limitations-you-must-know` anchor resolves to a real `<h2 id>`, zero leaked markdown (`**`, backtick, `](`, table separators), entity escaping (`&amp;` in h1, `&gt;` in table cell, `&gt;` inside `<pre>`, lone `` `>` `` inside `<code>`), 16 key strings present, `₹` count 31 = source, UTF-8 valid, FFFD 0, tag balance, and nav wiring present in `dist/index.html` + the minified `dist/js/main.js`. Then a **live browser run** over a local static server: page renders with correct title, Inter loads, table/blockquote/code styles correct; the sidebar item exists pre-auth with `lucide-book-open` rendered and ordered `… Download App, Settings, User Manual, Logout`; clicking it opened `http://localhost:8931/manual.html` in a new tab. `node --check` clean on `build.mjs` and `main.js`; check suite **9/9**; `node tools/build.mjs --admin` exit 0 printing `MANUAL: … → dist/manual.html`.
- NOT verified / open risk: no production deploy, so `firebase deploy --only hosting:admin` has not served `manual.html` under the real CSP/HSTS headers; the sidebar click was exercised with the auth overlay forced off (the app's `.layout` is `hidden` until login), not in a logged-in session; the converter is a subset renderer — markdown constructs the manual does not currently use (nested lists, images, reference links, tables with `|` inside code spans) would not render, so add them to `mdToHtml` before using them in the source markdown.
- Confidence: HIGH
- Ended: 2026-09-25 22:45 UTC

### [20260925-221213-7f8c] User manual for the approval-ceiling / manager-PIN / void-PIN feature
- TIER: 1 (documentation only — no source file touched)
- STATUS: DONE
- Started: 2026-09-25 22:12 UTC
- Scope: user request "also add - User Manual for it.. explaining every possible outcome with examples." Deliverable: `docs/MANAGER-PIN-USER-MANUAL.md` (251 lines), committed `0cba776`, covering the two gates shipped in `9e0bff7` (ceiling/PIN) and `d17f2de` (void-PIN). `docs/` was chosen after surveying `docs/`, `GUIDEs/` and the root — `docs/` holds the SCREAMING-KEBAB plan/report docs and is the existing home for feature documentation.
- Contents: configuration and **every save outcome** (clamp to 0–100, blank PIN keeps the existing hash, bad PIN aborts the whole save so the ceiling is not written either); the ceiling formula with worked examples at ceiling 15% / ₹1,000 showing that **exactly-at-ceiling passes** because the test is strictly `>`; a 16-row outcome table for the discount gate and a 6-row table for the void gate, both covering cancel / Esc / overlay-click / empty-Approve; a message-reference table with the exact toast strings; the audit-row schema for `discount.pin.approved` and `void.pin.approved`; the fail-open contract; and a limitations section stating plainly that this is client-side accountability (no Cloud Functions on Spark), that a 4-digit SHA-256 hash is brute-forceable by anyone who can read it, that settings are per outlet, and that both fields must be set together.
- Verification: **28 quoted strings cross-checked verbatim** against `utils.js`, `settings.js`, `pos.js`, `tables.js`, `ui-utils.js` and `index.html` — a script asserted each appears in the named file, and every long quoted string in the manual traces back to source. Strict UTF-8 valid, FFFD 0, U+20B9 present.
- Four errors caught by that check before commit: (a) the three gate toasts use **em dash U+2014**, not ASCII hyphen — a first "correction pass" turned them into hyphens and was wrong, reverted; (b) the manual had written `Max cap (?, optional)` by hand when the label is `Max cap (₹, optional)`; (c) `Processing…` in prose vs the literal `Processing...` at `pos.js:812`; (d) two prompt messages existed in code and were missing from the manual — `This {pct}% discount is above the {ceiling}% approval ceiling.` (`utils.js:270`, pct via `.toFixed(1)`) and `Authorise voiding this {table|group} bill. This cannot be undone.` (`tables.js:1785`).
- Console-mangling hazard (recurring): PowerShell renders U+20B9 / U+2014 / U+2192 / U+2026 as `?` / `-` / `-` / `.`, so console output is never evidence of a file's bytes — a `Select-String` line looked like it proved an ASCII hyphen while the file held an em dash. Node byte dumps were the authority, same as the earlier `?`-vs-`₹` checks on `Admin/index.html`.
- NOT verified / open risk: no live run of the flows the manual describes — it documents behaviour by tracing code, and the gates themselves remain unexercised end-to-end against real RTDB (the same open risk recorded in `d17f2de`).
- Confidence: HIGH for string fidelity (machine-checked), MEDIUM for behavioural completeness (traced, not executed).
- Ended: 2026-09-25 22:16 UTC

### [20260925-215100-c8f2] void-PIN: manager PIN required before any payment void
- TIER: 3 (money reversal path)
- STATUS: DONE
- Started: 2026-09-25 21:51 UTC
- Scope: the "void-PIN" item named alongside Ceiling/PIN in the P0-3/P0-4 scope note ("Ceiling/PIN and void-PIN explicitly out of scope") — the second half of that pair, and the only remaining gap that can be named from the repo (the numbered Servkro list, items 5–8 and 10, is not in the repo). User scoped it before implementation: **same manager PIN, required on every void, no threshold**.
- Trace / root cause:
  1. `voidTableBill` (`tables.js:1770`) is the ONLY void path in Admin — all four callers funnel into it (`main.js:446` delegated action, `tables.js:678` button markup, `:2940` delegated action, `:2989` `window.__tables` export). POS has no void at all. So a single gate covers every void.
  2. It ran `showConfirm` straight into the revert logic: the only authorisation was one OK click, on an action that reverses money already taken.
- Fixes: extracted `gateManagerPin({ message, auditAction, auditDetails })` out of the discount gate — it owns the `settings/Security` read, the fail-open rules, the prompt loop, the SHA-256 compare and the `logAudit` write, so discount and void share one implementation instead of two copies of a loop that would drift. `gateManualDiscountPin` is now ceiling-logic-only and delegates to it. `voidTableBill` gates immediately after the confirm, before entering its `try`.
- Behaviour change to already-shipped code (deliberate): the "ceiling on but no PIN" toast now uses the shared wording ("Manager PIN is required for this action but none is set — configure it in Settings."). Same action — warn and allow — different words. `gateManagerPin` also re-reads `settings/Security` even though the discount gate already read it for the ceiling test: two reads on a path that only runs for an above-ceiling discount or a void, accepted to keep the shared API to a single argument object.
- Fail-open (unchanged, as agreed): only cancel or a wrong PIN aborts. Unreadable settings, no PIN configured, or no `crypto.subtle` → allow with a warning. The PIN is still client-side only — same honesty note as the ceiling entry: Spark plan, no Cloud Functions, so this is an accountability control (`logs/audit` records `void.pin.approved` with `tableId`/`groupId`), not authentication.
- Deliberately NOT changed: the `showConfirm` order — confirm explains the consequence first, PIN authorises it second; the void revert logic itself; POS (no void exists).
- Verified: `node --check` on `utils.js` and `tables.js`; check suite **9/9**; `node tools/build.mjs` exit 0; strict UTF-8 valid with FFFD 0 on both files; dist assertions — `dist/js/utils.js` carries `gateManagerPin` and the `discount.pin.approved` literal, `dist/js/features/tables.js` carries the `void.pin.approved` literal and the `gateManagerPin` call, `dist/sw.js` = `foodhubbie-erp-shell-v5.4.3`.
- NOT verified / open risk: no live-browser E2E against real RTDB — the void PIN prompt is unexercised against a real backend. The refactor of the already-shipped discount gate is covered only by `node --check` + the build, because `utils.js` is not in the check bundle (it has module-scope `document` listeners, so it cannot be).
- Confidence: HIGH
- Ended: 2026-09-25 21:55 UTC

### [20260925-161900-b41e] Manual-discount approval ceiling (% of bill) + manager PIN gate at settlement
- TIER: 3 (money path — gates settlement; security rules change; fail-open by design)
- STATUS: DONE
- Started: 2026-09-25 16:19 UTC
- Scope: the "Ceiling/PIN" item from the Servkro gap list. The numbered list itself is not in the repo — the only back-reference is `PROJECT_LEDGER.md:123` ("Ceiling/PIN and void-PIN explicitly out of scope" of the P0-3/P0-4 work). User scoped it before implementation: **ceiling = % of bill**, **PIN gates manual discounts only**.
- Trace / root cause:
  1. A per-discount ceiling already exists end to end (`#discMaxCap` `Admin/index.html:5572`, load/save `discounts.js:368`/`:423`, clamp `discount-evaluator.js:166`, `bot/discount-engine.js:42`, `menu/js/discount.js:59`, tests `bot/tests/unit.test.js:128`), so "ceiling" cannot mean that.
  2. What is absent is any authorisation limit on HUMAN-entered discounts: `setTableBillDiscount` (`tables.js:1406`) only clamps negatives, `setTableBillDiscountPct` (`:1417`) clamps 0–100, POS `setDiscount`/`setDiscountPct` (`pos.js:601`/`:607`) clamp only. Staff could discount any amount, silently.
  3. Both discount inputs are live `input` listeners (`tables.js:2734`/`:2739`) — they fire per keystroke, so a PIN cannot gate the setter. The gate must sit where `discountValue` is finally computed: `confirmTableBillPayment` (`tables.js:1652`) and `submitWalkinSale` (`pos.js:920`). Every other table payment entry point (`_makePaymentForTable:860`, `_makePaymentForGroup:899`) funnels through `openTableBillReview` into that same function, so one gate covers them all.
  4. No PIN concept existed anywhere (only Meta 2FA and `map-pin` icons). `voidTableBill` (`tables.js:1771`) remains a plain `showConfirm` — void-PIN is a separate gap item.
- Fixes: `needsPinApproval()` — pure, in `discount-evaluator.js`, true only when `ceilingPct > 0 && subtotal > 0 && value/subtotal*100 > ceilingPct`; `showPinPrompt()` — password modal in `ui-utils.js` reusing the existing `.dynamic-modal-*` classes (no new CSS); `gateManualDiscountPin()` in `utils.js` (the one module that already imports firebase + ui-utils, and that `settings.js`/`tables.js`/`pos.js` all already import — so no new import edges and no ESM cycle) reads `settings/Security`, short-circuits unless `discountId` is `manual:flat`/`manual:percent`, then prompts, verifies and calls `logAudit('discount.pin.approved', …)`; new "Discount Approval" group in `Admin/index.html` with `#settingDiscCeilingPct` + `#settingManagerPin`; `settings.js` loads `settings/Security` as a 5th `Promise.all` node and writes it as **two sub-paths** (`Security/discountCeilingPct` always, `Security/pinHash` only when a PIN was typed) — a whole-node write would have wiped the hash whenever the field was left blank, and a parent+child path in one `update()` is rejected by RTDB; `database.rules.json` gains `settings/Security` with `.read` restricted to admins, because the parent `settings/.read` (`:195`) also admits **riders**.
- Fail-open contract (deliberate, not an oversight): the gate returns `false` ONLY when the operator cancels or mistypes the PIN. Unreadable settings, a ceiling configured with no PIN, and `crypto.subtle` being unavailable (non-secure context) all `return true` with a warning — a misconfigured ceiling must never block billing.
- Security honesty (recorded, not fixed): Spark plan means **no Cloud Functions**, so the check runs client-side and anyone with devtools can bypass it. This is an accountability/audit control — `logs/audit` records the approver uid — not authentication. The stored value is a SHA-256 hash rather than the plaintext PIN: leak-hygiene only, since a short numeric hash is still brute-forceable by whoever can read it. Real enforcement needs a server.
- Deliberately NOT changed: auto-applied discounts (they already carry `maxCap`); the live discount inputs and offer preview (`renderWalkinCart:468`); void — listed as its own gap item; `recordDiscountUsage`'s signature (audit goes to `logs/audit` rather than threading `approvedBy` through three functions).
- Shared-file hazard: `database.rules.json` was already dirty from another workstream (their hunks `@@ -48,4`, `@@ -147,4`, `@@ -291`; mine `@@ -218,0 +211,3` — disjoint). Staged via a filtered `git apply --cached` patch keeping only mine; their 3 hunks stay unstaged. Every other touched file was clean before this session, so those are staged whole — but `Admin/index.html` was re-checked for foreign hunks at staging time (it carried exactly one, mine).
- Verified: `node --check` clean on all 7 JS files; `database.rules.json` parses; `node tests/discount-evaluator.check.mjs` → **9/9** (new case covers ceiling-off, exactly-at-ceiling, above-ceiling, zero subtotal and null value); `node tools/build.mjs` exit 0; dist assertions — `dist/index.html` carries both new inputs, `dist/js/utils.js` carries `gateManualDiscountPin`/`hashPin`/`discountCeilingPct`; strict UTF-8 valid on all 10 touched files with FFFD 0; `Admin/sw.js` `CACHE_NAME` bumped `v5.4.1 → v5.4.2`.
- NOT verified / open risk: no live-browser E2E against real RTDB — the PIN prompt, the `settings/Security` read restriction and the sub-path settings write are unexercised against a real backend. `node gate-verify.js` reports **2 failures (`BUSINESS_BY_OUTLET map`, `orders dbPath tenant-scoped`)**; both read `rider-app/src/lib/constants.ts`, which another workstream has modified — they fail independently of these changes and were left alone.
- Incident (recovered): the first `sw.js` bump used `Get-Content | Set-Content -NoNewline`, which collapsed the file to a single line and would have recoded it. Restored with `git checkout -- Admin/sw.js` (183 lines / 6734 bytes / clean) and reapplied through the edit tool. No PowerShell content cmdlets were used on tracked files after that.
- Confidence: HIGH
- Ended: 2026-09-25 16:25 UTC

### [20260925-151619-0a72] Discount channel dropdown: author `table`, drop dead `whatsapp`, relabel webview option
- TIER: 1 (low-risk — authoring UI + display fallbacks; no money path, no rules/schema/evaluator change)
- STATUS: DONE
- Started: 2026-09-25 15:16 UTC
- Scope: gap item #9 from the post-fix review ("add `table` to the channel editor, kill the dead `whatsapp` option, relabel the webview channel"). User chose **relabel only** for webview: value `website` preserved everywhere, zero migration.
- Trace / root cause:
  1. `#discChannel` offered whatsapp/pos/both/website/all with no `table`, even though table billing is the largest live writer of `channel:'table'` usage (`tables.js:1697/1750/1822/1888`) and `discountAllowsChannel` already matched it exactly — the value simply could not be authored.
  2. The `whatsapp` option was dead twice over: no `recordDiscountUsage` caller ever writes `channel:'whatsapp'`, and no `evaluateDiscount`/`getEligibleOffersForDisplay` caller omits `channel`, so the `'whatsapp'` defaults at `discount-evaluator.js:190` and `bot/discount-engine.js:59`/`:179` are unreachable. Authoring it produced a discount that can never fire.
  3. Both editor fallbacks defaulted to that dead value: `discounts.js:379` rendered an unset `channel` as "WhatsApp" while `discountAllowsChannel` treats empty as allow-all (the badge lied); `discounts.js:434` would write `whatsapp` whenever the select was missing.
  4. The badge ternary at `discounts.js:102` had no `table` case (rendered the raw string) and no `website` case.
- Fixes: `Admin/index.html` `#discChannel` → `pos / table / both / website / all` (removed `whatsapp`; `table` = "Table bills only"; `website` relabeled "QR / WhatsApp Webview only"); `discounts.js:379` + `:434` fallbacks `'whatsapp'` → `'all'`; `discounts.js:102` badge gained `table → Table` and `website → Webview`, keeping `whatsapp → WhatsApp` so legacy rows still render; `tests/discount-evaluator.check.mjs` matrix extended with 3 `table`-authoring cases (`table`→table true, `table`→pos false, `table`→website false).
- Deliberately NOT changed: `discountAllowsChannel` (exact match already covers `table`); unreachable `'whatsapp'` defaults at `discount-evaluator.js:190` / `bot/discount-engine.js:59` / `:179`; the `both` label "WhatsApp + POS" — its whatsapp branch never evaluates, so `both` behaves identically to `pos` (flagged, out of scope); reports (`table`/`webview` buckets already shipped).
- Residual stale comment: `bot/index.js:1599` still reads `// channel: 'website' — matches the "Website/App only" option`. Left deliberately — that file carries ~800 lines of another workstream's in-flight WIP (83 insertions, 717 deletions) and line 1599 sits in a clean block (their hunks jump 1139 → 1646). One-line fix, hunk-staged the same way as `Admin/index.html`, if wanted later.
- Shared-file hazard: `Admin/index.html` is dirty from another workstream (their hunks `@@ -600`, `@@ -1872`, `@@ -6152`, `@@ -6162`; mine `@@ -5814,13` — disjoint. HEAD is 6396 lines, their working-copy deletions shift it to 6297, which is why HEAD-relative and worktree-relative line numbers differ). Staged via a filtered `git apply --cached` patch keeping only `@@ -5814,13`; their 4 hunks remain unstaged.
- Verified: strict UTF-8 valid on all 4 touched files (C1-looking bytes are multibyte continuation sequences; FFFD 0 on the 3 source files; ledger FFFD = **8 at HEAD and 8 after → 0 introduced**, all in pre-2026-08 task entries); `node --check` clean on `discounts.js` and the check; `node tests/discount-evaluator.check.mjs` → **8/8, exit 0**; `node tools/build.mjs` exit 0; dist inspected — `dist/index.html` `#discChannel` block = pos/table/both/website/all with the new labels and **no** `value="whatsapp"`; dist `discounts.js` (minified) carries `channel:"all"` at both fallbacks, 0 `||"whatsapp"`, and all three badge branches.
- NOT verified / open risk: no live-browser E2E against real RTDB; a row already saved as `channel:'whatsapp'` still cannot fire (pre-existing — it never could).
- Confidence: HIGH
- Ended: 2026-09-25 15:18 UTC

### [20260925-141500-6c2a] Discount reports channel split, PurgeCSS `channel-` safelist, ledger invalid-byte repair
- TIER: 1 (low-risk — report presentation, build safelist, markdown encoding; no money path, no rules/schema change)
- STATUS: DONE
- Started: 2026-09-25 14:15 UTC
- Scope: gaps 1–4 and 11 from the post-P0-3/P0-4 review, explicitly requested.
- Trace / root cause:
  1. `channelCounts` carried `whatsapp` and `manual` keys that **no code ever writes**. Every `recordDiscountUsage` caller enumerated: `pos.js:983` → `'pos'`, `tables.js:1697/1750/1822/1888` → `'table'`, `bot/index.js:1686` → `"webview"` — nothing else. Those two buckets were provably always 0, while every bot QR/delivery redemption (`webview`) fell into "Other".
  2. `.channel-*` chip modifiers never reach `dist`: they are only ever built at runtime (`channel-${escapeHtml(channel)}` at `discountsReports.js:240/399` and `discounts.js:292`), so PurgeCSS never sees them. The `tools/build.mjs` safelist had `/^discount-/`, `/^report-/` … but no `/^channel-/`, and the only literal `channel-*` in any content file is `channel-chip`. Hence `dist/style.css` held exactly **one** rule and every channel chip shipped with no background and no color — pre-existing for all channels, not just `table`.
- Fixes: `channelCounts` → `{pos,table,webview,other}` and labels → POS/Table/Webview/Other; `/^channel-/` added to the safelist; `.channel-table` + `.channel-webview` added to `Admin/style.css`; `discountsReports.js:6` header comment updated; `PROJECT_LEDGER.md` byte `0x97` (offset 14670) rewritten to `E2 80 94`.
- Data safety: totals preserved — unknown channel values still increment `other`, so `totalCh` and every percentage are unchanged; legacy `whatsapp`/`manual` rows simply re-bucket to "Other". The CSV export carries no channel column, so exports are unaffected.
- Encoding: `PROJECT_LEDGER.md` **failed strict UTF-8** (`Unable to translate bytes [97] at index 14669`) before the fix and passes after; raw `0x97` count now 0. That byte was the cause of phantom diffs on any UTF-8 read/write round-trip of the ledger — the file is now safe for the `edit` tool.
- Shared-file hazard: another process holds unrelated inventory-card edits in `Admin/style.css` (lines 7287–7316, 9463–9614). Staged via a filtered `git apply --cached` patch so only the `@@ -8265` hunk entered the index; their edits remain unstaged. Their working copy was backed up to `%TEMP%\style_theirs_backup.css`.
- Verified: strict UTF-8 valid on all 4 files; `node --check` clean on the JS and on `build.mjs`; `node tests/discount-evaluator.check.mjs` → **8/8, exit 0**; build clean; dist inspected — `dist/style.css` went 1 → 7 `.channel-*` rules, and dist JS contains `{pos:0,table:0,webview:0,other:0}` with 0 `whatsapp` references and 0 `manual:0`.
- NOT verified / open risk: still no live-browser E2E against real RTDB; `Admin/style.css` remains dirty with someone else's work — a later whole-file `git add Admin/style.css` would sweep their inventory edits into a commit.
- Confidence: HIGH
- Ended: 2026-09-25 14:20 UTC

### [20260925-134422-4e70] P0-3/P0-4: category discounts never fired + "POS only" discount never applied to table bills
- TIER: 2 (medium-risk — money path, Admin-only, no rules/schema/deploy-target change)
- STATUS: DONE
- Started: 2026-09-25 13:44 UTC
- Scope: fixes ONLY P0-3 and P0-4 from the Servkro competitor gap list. Ceiling/PIN and void-PIN explicitly out of scope.
- Root causes:
  1. **P0-3** — `discount.categoryIds` are push keys (`catalog.js:129` `push(Outlet.ref('categories'))`) but every cart carries category *names*: POS `walkinCart` stores `dish.category` (`pos.js:349`), QR order items store none (`menu/js/order.js:80-89` writes `{name,qty,price,addons,instructions}`), and `pos.js:647/906` passed `categories: i.categories` which was never set. `_cartHasCategory` therefore returned false **100% of the time, in all three engines** — category discounts were dead in every channel.
  2. **P0-4** — table billing passes `channel:'table'` (`tables.js:1476`, `1529`) while `discountAllowsChannel` only matched `all`/exact/`both`, so a `channel:'pos'` discount returned false. The editor (`Admin/index.html` `#discChannel`) offers only whatsapp/pos/both/website/all. (Stale comment at `tables.js:930` still described the old "channel is 'pos' for table billing" intent; comment at `:937` claimed `cart` was passed empty — both rewritten.)
- Files touched: Admin/js/features/discount-evaluator.js, Admin/js/features/pos.js, Admin/js/features/tables.js, Admin/sw.js, tests/discount-evaluator.check.mjs (new)
- Fix: `getAllCategories()` (30 s cached key→name bridge, cleared by `clearDiscountCache`); `_cartHasCategory(cart, categoryIds, categories)` matches key OR resolved name; `getEligibleOffersForDisplay()` made async (fetches the map once per call); `evaluateDiscount` fetches it **only if a category discount exists in the list** (checkout read count unchanged); `discountAllowsChannel` gained `|| (d.channel==='pos' && channel==='table')`; `pos.js:731` now passes `cart` (panel previously never showed category offers); `openTableBillReview` fetches `dishes` in its existing `Promise.all` and `_billCart` backfills missing `category` via `_dishCategoryFor` (strips the QR menu's `" (Large)"` suffix) — retroactive on already-placed orders; `sw.js` `CACHE_NAME` v5.4.0 → v5.4.1.
- Deliberately NOT touched: `bot/discount-engine.js` (mirror copy) — its only 2 callers pass `channel:'website'`, and the guest menu can only submit `type:'coupon'`, so both fixes are unreachable there. Changing it would let the bot start auto-applying category discounts at QR-order time, which **stack** on staff-applied bill discounts (order-level is baked into `o.total`, bill-level subtracts from Σ `o.total`). `menu/js/discount.js` (coupon-only, gates `all`/`website`) and `SupremeAdmin` (no discount files) also unaffected.
- Verified: `node tests/discount-evaluator.check.mjs` → **8/8, exit 0** (bundles the REAL source with esbuild + a Firebase stub; no re-implementation). **Mutation-tested**: reverting both fixes produced exactly 3 targeted failures / exit 1, then restored to a SHA256-identical file → 8/8 again, proving the check is not vacuous. `node --check` clean on all 4 files. `node tools/build.mjs --admin` clean; inspected the minified dist and confirmed `e.channel==="pos"&&n==="table"`, the `Set` name-matching, `await ve(...)` / `await pn(...)`, and the dish backfill + `/\s*\([^)]*\)$/` helper. Encoding per Standing Decision 2026-08-04: 0 C1 U+0080–009F, 0 U+FFFD, ₹ intact across all 4; `git diff` showed only the intended hunks (no collateral re-encoding). `SupremeAdmin` checked for a parallel copy — none.
- NOT verified / open risk: no live-browser E2E against real RTDB (no Playwright run); `discountsReports.js` still buckets `channel:'table'` usage under "Other" (`channelCounts` = whatsapp/pos/manual/other) — pre-existing, left alone because P0-4 was scoped to channel *matching*, not reports. New check is named `*.check.mjs` on purpose so Playwright's `testDir './tests'` default `*.test.*` matcher does not try to load it.
- Confidence: HIGH
- Ended: 2026-09-25 13:45 UTC

### [20260819-105729-174e] Fix rider FCM push notifications (functions dead path) � move rider push into bot + repoint functions triggers
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-19 10:57 UTC
- Files touched: bot/index.js,functions/index.js
- Verified: node --check bot+functions, 11/11 unit tests, EC2 deploy md5 match, both bots online clean boot
- NOT verified / open risk: OS push not tested with a live device/order
- Confidence: HIGH
- Ended: 2026-08-19 10:59 UTC

### [20260819-035920-83fc] Design + plan restaurant soft-delete/disable flow (3-step confirm, Disabled tab, data preserved, reactivate)
- TIER: 3 (high-risk)
- STATUS: IN PROGRESS
- Started: 2026-08-19 03:59 UTC

### [20260819-032020-84c5] Supreme Admin UI: accessibility (focus-visible, skip-link, ARIA) + P1 (spacing tokens, hardcoded colors, tab ARIA, combobox)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-19 03:20 UTC
- Verified: CSS: focus-visible styles + spacing tokens added. HTML: skip-to-content link + aria-live on toast root. JS: ARIA roles on clickable rows/collapsibles, tab panel aria-controls/tabpanel, command palette combobox ARIA pattern. All syntax checks pass. CSS braces balanced.
- NOT verified / open risk: Browser-level accessibility audit not run (no Playwright). Hardcoded colors intentionally kept (WhatsApp-themed, chart palettes).
- Confidence: HIGH
- Ended: 2026-08-19 03:34 UTC

### [20260819-024710-bebf] EC2 Bot Fleet: restart pm2 processes after crash
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-08-19 02:47 UTC
- Verified: Both bots restarted via pm2 start ecosystem.config.js + pm2 save. bot-roshani-pizza-pizza PID 127807 online, bot-roshani-cake-cake PID 127808 online. Webhook-server (5000) and bot-control-api (4000) confirmed healthy. Port 3001 free, no conflict.
- NOT verified / open risk: Root cause of original pm2 crash not determined (logs showed WhatsApp API errors, not crash). PM2 save ensures auto-restart on reboot.
- Confidence: HIGH
- Ended: 2026-08-19 02:47 UTC

### [20260818-155605-53f7] 17-GATE: complete multi-tenant refactor — seed DB, repoint apps, verify live gate
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-08-18 15:56 UTC
- Verified: Live gate PASS: 0 failures, businesses/padmavati-test/outlets/padmavati found in foodhubbie-10 RTDB, all 8 gate groups pass
- NOT verified / open risk: Baileys still imported (deferred to Section 9, cosmetic warning only)
- Confidence: HIGH
- Ended: 2026-08-18 16:17 UTC

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

### [20260929-000000-0001] WhatsApp Platform Decision — Path B + Co-existence for All + Centralized Billing
- TIER: 3 (strategic decision — defines entire WhatsApp architecture)
- STATUS: DECIDED — Implementation Ready
- Started: 2026-09-29
- Decision: All restaurant numbers registered under Foodhubbie's REAL WABA (Path B); Co-existence enabled for ALL; Meta billing centralized on Foodhubbie account; restaurants billed via Supreme Admin Payment Management
- Key architectural changes:
  - Business Verification required for `1544720177433286` "Foodhubbie" (P0)
  - Create REAL WABA "Foodhubbie Platform" under verified business (P0)
  - Add `business_management` scope to system user `foodhubbiebot` (P0)
  - Update EC2 `WABA_ID` → restart `bot-control-api` (P0)
  - Per-restaurant onboarding via Supreme Admin Path B wizard (already built)
  - Co-existence auto-detected via webhook `origin.type='business_app'` (already built)
  - Billing: Meta → Foodhubbie (centralized); Foodhubbie → Restaurant (per-order/plan via Supreme Admin)
- Files already built & deployed:
  - Path B wizard: `SupremeAdmin/js/features/whatsapp-manage.js`
  - Co-existence detect+guide: `whatsapp-manage.js:149-196`, `webhook-server/index.js:108-115`
  - `waLinkSuccess()`: `bot-control-api/server.js:392-410`
  - Payment Management: `payment-overview.js`, `payment-record.js`, `billing-shared.js`
  - Bot template messaging: `bot/index.js`, `transport.js`, `whatsapp-send.js`
- Full decision doc saved: `Credentials/WHATSAPP-COEXISTENCE-PLATFORM-DECISION.md`
- Confidence: HIGH (all code exists; only Meta-side prerequisites remain)
- Next Actions (P0): Business Verification → Real WABA → System User scope → EC2 config update → test one restaurant

### [20260929-000000-0002] business_management scope granted + token rotated + templates APPROVED
- TIER: 2 (secrets rollout across EC2 + code fallback)
- STATUS: DONE
- Started: 2026-09-29
- How: Playwright (CDP on profile copy — Chrome 136+ blocks CDP on default profile) drove BM System users → Generate-token wizard → app Foodhubbie → expiry Never → permissions incl. `business_management`; token generated manually by owner in wizard, verified by script
- Token: new 204-char SYSTEM_USER token, scopes `business_management` + `whatsapp_business_*` + `manage_app_solution` + `whatsapp_business_manage_events` + `public_profile`; saved `Credentials/WA_PERMANENT_TOKEN_NEW.txt`; old 197-char token still valid (not revoked)
- Code: `whatsapp-graph.js` `listWabas()` — `/me/businesses` returns `data:[]` for system-user tokens (Meta quirk) → fallback `{META_BUSINESS_ID}/owned_whatsapp_business_accounts` (verified returns the WABA); `ecosystem-bot-control.config.js` gains `META_BUSINESS_ID: 1544720177433286` (repo) — runnable check: local listWabas both paths pass
- EC2 rollout: backups `*.bak-20260929`; `.env` `WA_PERMANENT_TOKEN` → new; config env now carries `META_SYSTEM_USER_TOKEN` + `META_APP_ID` + `META_APP_SECRET` + `WA_PERMANENT_TOKEN` + `REDIS_URL` (fixes orchestrator-spawn map reading absent keys); pm2 reload/restart; verified sha256: api META token, bots id4+id12 WA token = NEW; `quota/accounts` probes 401 (alive)
- Templates: **all 9 PENDING → APPROVED** (order_placed, order_confirmed_dinein, order_confirmed_delivery_v2, order_ready_v3, order_delivered_v3, order_cancelled, rider_assigned, greeting_welcome, proactive_promo); OTP trio stays REJECTED (by design, plain text); `PROACTIVE_TEMPLATE` fixed `promo_offer` → `proactive_promo`, `PROACTIVE_LANGUAGE` `en_IN` → `en` (both .env + pm2 env, applied with bot restart — bots ONLINE + re-authed)
- Verification: `node --check` whatsapp-graph ✅; local listWabas enum+fast path ✅; EC2 3-way sha256 (.env=config=running env) ✅; all 4 pm2 processes online ✅
- Confidence: HIGH
- Remaining: Business Verification wizard OPEN in automation Chrome (business.facebook.com → Security Centre → Verify your business): country=India done, business type = Sole proprietorship (user's choice), current step = "Add business details" (phone with IN +91 code — needs code confirmation, + website) → confirm connection → upload documents → Meta review; **user is completing it manually in their browser**. After approval: create real WABA under 1544720177433286 → update `WABA_ID` on EC2 → restart bot-control-api → flip outlet transport to `meta` on real number; old token revocation optional via BM UI

### [20260929-000000-0003] Business Verification started — website blocker documented, domain deferred ~10 days
- TIER: 2 (Meta verification progress + decisions)
- STATUS: IN PROGRESS — paused on Website field
- Started: 2026-09-29
- What happened:
  - Verification wizard started (BM → Security Centre → Verify your business, use case = Meta for Developers): country **India**, business type **Sole proprietorship** chosen by owner; wizard at **Add business details** (phone + website); owner driving it manually in their own browser
  - **Website rejected:** `https://foodhubbie-web.web.app/` → Meta "common website domain" error — shared Firebase Hosting domains (`*.web.app`/`*.firebaseapp.com`) are blacklisted (same class as gmail/yahoo)
  - Decision: **no domain yet — buying in ~10 days**; candidates `foodhubbie.com`/`.in`/`.co` checked via DNS 2026-09-29 → no NS records, likely available. Workaround first: **clear Website → Next** (likely optional); if Next hard-requires it → pause until domain → wire to Firebase Hosting (auto SSL) → enter `https://foodhubbie.com`
  - UDYAM certificate extracted for exact form values (model can't read PDFs → installed `pypdf`, text extracted): FOODHUBBIE / Proprietary / UDYAM-BR-31-0042040 / Parsa, Chapra, Saran, Bihar 841219 / phone 9724649971 / owner Shah Nilesh Rakesh (PAN + bank details deliberately NOT copied into repo docs — PII)
  - Ready for next steps: OTP to 9724649971, UDYAM PDF upload, Meta review ~1–5 days
- Docs written: `docs/META-PLATFORM-AUDIT.md` — new sections *Token rotation + business_management (2026-09-29)*, *Business verification — started 2026-09-29* (canonical form details table + blocker + post-approval sequence), *Templates — mass approval 2026-09-29* (9 approved list, OTP trio rejected by design, PROACTIVE_TEMPLATE fix)
- Verification: user reported form rejection; DNS availability check run; audit doc edited
- Confidence: HIGH
- Next Actions: (1) owner clears Website → Next → OTP + UDYAM upload; (2) ~10 days: buy domain → ping me to wire Firebase Hosting → resume form if website was required; (3) after Meta approval → real WABA → `WABA_ID` → transport `meta`; (4) optional: revoke old 197-char token via BM UI
### [20260929-000000-0004] Fix duplicate ORDER PLACED sends — removed `|| isNew` dedup bypass
- TIER: 2 (bot notification correctness)
- STATUS: DONE
- Started: 2026-09-29
- Symptom (from live `chats/roshani-pizza/8084243031` audit): orders `#gcjhY` + `#1OxVk` (Sep 21) received the identical "ORDER PLACED" invoice twice in the same second (different msgIds = two real WhatsApp sends)
- Root cause analysis (corrected twice during investigation — be honest about this):
  1. First hypothesis (orderRef listener stacking across reconnects) was WRONG: listeners are module-guarded by `firebaseListenersInitialized` (index.js:215/:1600/:1791); cmdRef has its own `.off` at :389
  2. Real cause: `handleOrderStatusUpdate` condition `|| isNew` (index.js:983) — `child_added` calls it with `isNew=true` (:1788), which bypasses the `status already processed` check that `child_changed` respects. When racing `child_changed` (triggered by webview finalization's `stockDeducted` write / FCM watcher's `_fcmSent` write) had already SAVED status after a confirmed send, `child_added` still re-sent. Lock (`_orderStatusLocks`) + post-send-only status writes (added in Sep 19-20 restartEpoch-era fixes) made the bypass redundant and unsafe
- Fix: removed `|| isNew` from the send condition + explanatory comment (bot/index.js:983). Retry path intact: failed sends leave `status` un-advanced → next event re-enters. `isNew` still used for `isDineIn && isNew` (:1041) and logging
- Verification: `node --check` ✅ local+EC2; `node --test tests/unit.test.js` 12/12 ✅ (integration test hangs locally — pre-existing, needs EC2 network; unit suite doesn't cover this function); deployed to EC2 (`bot/index.js.bak-20260929` backup), `pm2 restart 4 12`, both bots ONLINE + re-authed ✅
- Also noted (no action): RTDB `.indexOn` warning only fires for ad-hoc `orderByChild('meta/lastTs')` queries — Admin reads whole `chats` node (chat.js:37, wa-analytics.js:167), existing `meta` `.indexOn:["lastTs"]` (rules:441) covers app needs
- Confidence: HIGH
- Next Actions: none — watch next webview order for single PLACED send
### [20260929-000000-0005] Ban-proofing implemented + template-migration review fixes deployed
- TIER: 2 (bot ban-proofing + notification correctness)
- STATUS: DONE
- Started: 2026-09-29
- What shipped:
  - **(A) Ban-proofing (new, per spec):** (1) random **4–8s per-chat outbound pacing** — `paceOutboundTo()` in `bot/utils.js`, called from all 3 patched send wrappers (`sendMessage`/`sendTemplate`/`sendButton` in index.js); (2) **3 continuous wrong messages → 30-min silent freeze** — `recordWrongMessage()`/`isJidFrozen()`/`clearWrongStrikes()` (utils.js), counted only in `AWAITING_ORDER_INTENT` + `WEBVIEW` C5 branches (non-intent text; `menu`/`order` clears), handler returns early when frozen (after the opt-out block so STOP/START still lands), `proactive_promo`-style marketing (`sendPromotionalMessage`, `SEND_GENERIC_MESSAGE`) drops when frozen
  - **Design decisions (adversarial review caught these mid-build):** transactional order-status notices **keep flowing** during a freeze (approved utility templates = ban-safe; dropping them would mark a real order "sent" when it wasn't) — freeze = chat replies + marketing only; **admins never accumulate strikes** (`isAuthorized` hoisted out of the opt-out try; strike calls gated `!isAuthorized` — otherwise an admin could freeze themselves out of reports/alerts); in-memory state (restart clears) — Redis upgrade path noted in comment
  - **(B) Review fixes on the uncommitted template migration:** **High#1** `transport.js sendTemplate` silently dropped `body` (promo/SEND_GENERIC content replaced by template's static text) → now maps `body` → single `{{1}}` BODY component; `proactive_promo` has **NO variables** (verified via Graph) → code 100 → callers' existing text fallback delivers correct content (outside-24h promo still needs a variable MARKETING template — platform limitation). **High#2** template branch ran unconditionally → Baileys outlets (both bots run `transport=baileys`) hit `sock.sendTemplate is not a function` → restored legacy `msg`/`img` strings for all 5 template statuses (from `git show HEAD:bot/index.js`) + call-site guard `typeof sock.sendTemplate === 'function'` → text/image path on Baileys, templates only on meta. **Med#3** `isDineIn && isNew` → `isDineIn` (template + msg). **Med#4** template param counts verified vs Graph API: order_placed 1 / dinein 4 / delivery 2 / ready 3 / delivered 5 / cancelled 2 = code ✅ (all 9 approved templates fetched via `Credentials/WA_PERMANENT_TOKEN_NEW.txt`). **Low#5** template chat bubbles logged component parameter texts instead of empty
- Tests: `node --test bot/tests/unit.test.js` **13/13** (new `ban-proofing` test: strikes 1-2 reply, 3rd freezes, menu clears, unrelated jid isolated, pacer first-send immediate + second ≥4s) — helpers moved to `bot/utils.js` (exported) so they're testable; `node --check` on index/utils/transport/promotions ✅ local + EC2
- Deploy: backups `/var/www/foodhubbie/bot/*.bak-20260929-2` (index/utils/transport/promotions) → scp (byte-exact sizes) → EC2 `node --check` ✅ → `pm2 restart 4 12` + `pm2 save` → id4 (roshani-pizza, real outlet) startup sequence clean: Command Listener → BLOCKED → **BOT IS ONLINE → [AUTH]** ✅
- Noted (pre-existing, untouched): id12 (`bot--P-Taho...` = wizard-created test business/outlet `-P-TahoJb732KsrERdxm`) has **never had an open WA connection in its log since Sep 25** (no QR pairing ever completed); pm2 "online" ≠ WhatsApp connected. No production outlet affected
- Confidence: HIGH
- Next Actions: (1) watch next live order on pizza → single PLACED + text/image notification path on Baileys; (2) watch `[PACER]`/`[FREEZE]` logs for behavior; (3) when business verification + real WABA land → meta transport flips on and template path activates there; (4) if a variable MARKETING template is wanted for outside-24h promos, submit one with `{{1}}`
### [20260930-000000-0006] Notification review fixes deployed + live E2E (closes d3cd verification gap)
- TIER: 2 (deploy + verification for task 20260930-020129-d3cd)
- STATUS: DONE
- Started: 2026-09-30
- What happened: rebuilt all targets (`tools/build.mjs`), dist marker-grep ✅, deployed `firebase deploy --only hosting:admin,hosting:supreme` (75 + 32 files, release complete). LIVE asset checks all pass: supreme `js/features/notifications.js` serves `formatAge`, admin `js/auth.js` has NO `initNewOrderNotifications`, admin `js/features/orders.js` has `orderStatusSeen`, admin notifs has `stopContinuousSound`
- Live E2E (Playwright; temp super user minted via `bot/service-account.json` + `admins/{uid}.isSuper`, deleted in cleanup): Supreme `#notifications` renders — KPIs (1/1/0) + row showing `20d ago` / `10 Sept 2026` (`formatAge`/`formatDate` = the two functions that crashed the tab) + Mark read / Reply actions. Filter-reset fix proven: search `zzzz` → navigate to Restaurants → return → input `""`, filter `all`, row visible (pre-fix stale module vars kept table empty). Screenshot: `.playwright-mcp/notifications-tab-live.png`. Console: only a transient securetoken 400 at login + pre-existing TUNNEL_URL warning — no errors from the changed code
- NOT verified live (Admin side — no login creds available; `tests/utils.js` password appears redacted): `orderStatusSeen` transition dedupe, clearAllNotifications sound stop, legacy-listener removal. Code-reviewed + build-parse verified only
- Confidence: HIGH (Supreme fix) / MEDIUM (Admin runtime behavior)
- Next Actions: watch the first live QR order after this deploy — Pending→Placed must notify exactly once, and editing an old Placed order must notify zero times; if wrong, inspect `state.orderStatusSeen` seeding in `Admin/js/features/orders.js:67-109`
<!-- TASK_LOG_END -->
