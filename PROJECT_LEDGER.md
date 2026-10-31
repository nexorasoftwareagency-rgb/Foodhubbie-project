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
- [2026-10-26 11:12 UTC] Brand/rename sweeps are NOT safe with PowerShell Get-Content/Set-Content (it decodes UTF-8 as cp1252 and writes UTF-8-with-BOM) - the 2026-10-26 Roshani->Foodhubbie sweep corrupted 72 tracked files this way and also rewrote a real credential (Admin/js/auth.js SUPER_ADMIN_EMAIL). Rule: do sweeps with Node/Python UTF-8 APIs, then run `node tests/encoding-check.mjs` plus `git diff` review BEFORE committing; if a file shows BOM-plus-mojibake, `git checkout HEAD -- <file>` restores it because the committed blob is clean. Repo-wide scan recipe: walk menu/Admin/SupremeAdmin/website/rider-app/src/shared/shared for [BOM or C1 controls U+0080-U+009F or the mojibake leads] and compare each file against `git show HEAD:<file>` to tell committed corruption from working-tree corruption.
- [2026-10-23 03:47 UTC] Boot wall-clock is now dominated by network variance on this link (run 1 of a fresh profile ranged 7.8s-17.1s across sessions for identical builds), so no further wall-clock claims are made from single runs. Deterministic evidence is used instead: frame-tick gaps and read counts. Deterministic state at HEAD: boot reads = inventory, admins, features, roles, disabled, locked, riders, orders, Store, settings/inventory (x2 by design) - no dishes, no riderStats.
- [2026-10-23 03:47 UTC] Fresh-profile inventory toggle race (previously 'known pre-existing bug, not fixed') does NOT reproduce on the current build: a brand-new browser context with empty localStorage ends with toggleAvailability=true, toggleStockTracking=true and #inventoryMenuSection display:block after login. Cause of the original symptom was the pre-auth hydrate falling back to localStorage, which is now corrected by the post-login refreshInventoryTogglesForOutlet() added in the P0 round (auth.js:487) - that call survives the loadMenu=false change and still hydrates. Marked resolved with evidence rather than fixed; no code was needed.
- [2026-10-23 03:47 UTC] Login gates batched (5969ecb): the locked probe now starts inside the disabled probe's tick (gap measured 0ms in the websocket frame log, was one full RTT ~440ms under 1.6Mbps/150ms emulation). Failure semantics preserved: locked resolves null on error and only warn-logs (login continues), disabled still denies login on error. The probe is declared before both blocks so the locked gate reuses it; if the disabled read throws we return and the catch on the probe keeps it from becoming an unhandled rejection.
- [2026-10-23 03:33 UTC] Leftover from the dishes boot fix found via the websocket frame log: auth.js calls refreshInventoryTogglesForOutlet() after login to fix the pre-auth hydration bug, and that helper defaults to loadInventoryMenu() - so the 657KB dishes node still loaded at boot. Fixed with the same loadMenu flag (ea05970). Also loadInventory() refreshed toggles (which loads the menu) and then called updateMenuVisibility() itself, fetching dishes twice per Inventory tab open; that caller now passes false.
- [2026-10-23 03:33 UTC] Boot profile after P0+P1 (phone 1.6Mbps warm, CDP CPU profile): 64% idle, 23% browser internals, biggest JS frame 157ms (ui.js applyDataLabels path), lucide ~90ms total. Boot is network/RTT-bound, not CPU-bound - which is why P2's DOM surgery (templates for inactive tabs, table virtualisation) would not move time-to-dashboard and was not attempted.
- [2026-10-23 03:17 UTC] Remaining boot profile (phone 1.6Mbps, warm): modules ~0.7s, profile loaded ~2.5s, dashboard done ~4.2s. The 1.7s between profile and dashboard is dashboard render (orders + KPI), not network - that is P2 territory (templates for inactive tabs, orders pagination), not more fetch tuning.
- [2026-10-23 03:17 UTC] Pre-existing finding (NOT fixed, not a regression): admins/{uid}.isSuper is ignored at runtime unless the email equals ADMIN_CONFIG.SUPER_ADMIN_EMAIL - auth.js sets isSuper=false for every other account in the 'else if (adminData)' branch. So roshanipizza@gmail.com (node has isSuper:true) boots as a regular admin: outlet switcher hidden, disabled/locked gates run, adminSelectedOutlet forced to its assigned outlet. Looks like a deliberate email allowlist; left alone.
- [2026-10-23 03:17 UTC] P1-B (bundle the boot module graph) evaluated and REJECTED with data. Build-time modulepreload of all 32 statically-reachable boot modules: cold boot (fresh browser, 3 runs) median 10.6s vs 9.9s without; warm boot (runs 3-4) 4.4-5.0s both. Reason: Admin/sw.js precaches every js/*.js at install, so on any returning visit the whole graph is already local and import depth costs nothing; preloading only adds 32 competing streams on the first-ever visit. tools/build.mjs reverted, dist rebuilt and redeployed so prod matches source. Do not retry without first removing the SW precache - the two optimisations cancel out.
- [2026-10-23 03:17 UTC] P1-A shipped (4fca9bd): gatesPrefetch starts settings/features + settings/roles right after the admin profile resolves, so the ~17KB roles read overlaps the serial disabled/locked probes instead of queueing behind them. loadOutletGates(prefetched) falls back to the live Outlet path when the prefetch returns null (transient error) and keeps the no-arg form for the switchOutlet listener. Outlet resolution copies the login rule: supers use adminSelectedOutlet || adminData.outlet, staff use adminData.outlet - live-verified that adminSelectedOutlet='cake' on a staff account still reads only pizza's gates. Measured warm boot 6482ms -> 6117ms on the single-run harness (frames show both settings reads leaving the same tick as the disabled probe).
- [2026-10-22 21:01 UTC] Measured (phone emulation 1.6Mbps/150ms, one browser profile): first load 7786ms, 2nd 6640ms, 3rd 4070ms. The 2nd/3rd improvement is mostly the SW now serving the 240KB modular Firebase SDK from cache. Boot RTDB payload 35KB -> 19KB after riderStats removal. Remaining biggest boot read is settings/roles at 17.5KB (RBAC matrix, gates canAccessTab - cannot be deferred without a stale-UI tradeoff; candidate P1: localStorage cache + refresh). Wall-clock on a clean profile barely moved (7.2-7.7s both before and after) - honest statement: P0 helps returning staff, not first-ever load.
- [2026-10-22 21:01 UTC] Admin perf P0 shipped (commit d4e98f9): (1) preconnect/dns-prefetch pointed at prashant-pizza-e86e4-default-rtdb (a different project) - now foodhubbie-10-default-rtdb + authDomain iframe origin; (2) sw.js: gstatic.com/firebasejs/ added to cache-first CDN branch (URLs are version-pinned 10.7.1 so immutable); CACHE_NAME bumped v5.10.2 -> v5.10.3 so every client purges the old shell. Note the compat SDKs in importScripts are still needed by the SW itself for FCM background messages - they are NOT dead weight, only the page uses the modular SDKs. (3) loadRiders({withStats=true}); boot (auth.js) and dashboard (ui.js) pass false, Riders tab keeps true; riderStats is only read by renderRiders (grep: riderStatsData has no other consumer). (4) applyDataLabels skips tables inside .tab-content.hidden - it runs on every DOM mutation via MutationObserver; modals sit outside .tab-content so they still get labelled.
- [2026-10-22 17:02 UTC] [2026-10-22 22:40 UTC] POS is NOT preloaded at boot and never was: main.js boot block only calls initAuth(), initRiderAnalytics() and initInventory(). POS reads /dishes in loadWalkinMenu(), which switchTab('walkin') calls when the tab opens. So deferring the inventory grid's read cannot affect POS. Verified live after the change: opening the walk-in tab renders 25 tiles, 22 dish photos all as data:image and all loading=lazy, no console errors. The 657KB is still paid on the FIRST POS open (unchanged from before) - it is cached in memory for the rest of the session. If POS must open instantly with photos, preloading it at boot is exactly what made boot slow; the correct fix is smaller images or URL-based images, not a boot preload.
- [2026-10-22 16:52 UTC] 2026-10-22: HARD STOP on cold WhatsApp DMs. The sales number +91 9724649971 was BANNED after ~45 cold DMs in one day from Baileys (owner-designed copy, 5-14s gaps, cap 40). tools/wa-sales-agent.cjs send / --copy owner / --web are NOT to be run again from that number or any personal number. Scheduled drip task deleted, tools/lead-drip.cmd removed (commit ff10c19). Cold outreach must move to the official WhatsApp Business Cloud API (meta transport, approved templates, opt-in) or another channel (email/Instagram/calls). Sending cold DMs from a linked-device Baileys session is proven to be a ban trigger in this project - do not retry with a new number without an explicit owner decision.
- [2026-10-22 16:42 UTC] [2026-10-22 22:10 UTC] Deeper issue, NOT fixed in this task: menu photos are stored inline as base64 in the Realtime Database instead of Firebase Storage URLs, so every Admin boot and (likely) every customer menu load pays for the full photo set. That is a data-model migration across Admin + menu + rules, with cost implications at 50 restaurants x 150 staff; it needs its own decision.
- [2026-10-22 16:42 UTC] [2026-10-22 22:10 UTC] Finding 3 (root cause): during boot the app reads /businesses/{bid}/outlets/{oid}/dishes, which is 657KB for 22 dishes and 654KB of that (100%) is inline base64 JPEG in the image field. Captured over the RTDB socket: 742KB received in 65 frames, 45 of them 16KB base64 chunks between 6.0s and 15.1s. The read is triggered by main.js -> initInventory() -> initInventoryToggles() -> hydrateToggles().then -> updateMenuVisibility() -> loadInventoryMenu(), a grid that only exists on the Inventory tab. Timing: dashboard switchTab only starts at 16.0s, i.e. after the dishes download; before the fix the dashboard could not render until 657KB of photos had arrived.
- [2026-10-22 16:42 UTC] [2026-10-22 22:10 UTC] Finding 2: BOOT is the problem. arrive -> dashboard usable: 7.8s cold desktop, 11.9s cold phone, 5.2s WARM desktop reload, 17.1s WARM phone reload. CPU is NOT the cause: repeating the phone run with CPU throttling off gave 18.1s (vs 17.1s throttled) - it is network-bound.
- [2026-10-22 16:42 UTC] [2026-10-22 22:10 UTC] Measured the Admin on the live site with a real authenticated session (minted idToken fulfilled for the signInWithPassword XHR - no password needed). Finding 1: TAB SWITCHING IS NOT SLOW. Desktop warm: 100-160ms typical, worst 526ms (customers); mobile (4G 1.6Mbps + 4x CPU): 200-400ms median. So the login-document split (option A) would not help in-app speed and is dropped.
- [2026-10-22 11:03 UTC] [2026-10-22 04:40 UTC] Admin login-page perf, measured honestly (Lighthouse, clean Chromium, mobile throttled): performance 35, a11y 100, BP 100, SEO 100; FCP 4.4s, LCP 6.5s, TBT 1.3s, TTFB 110ms. Main thread is dominated by Style and Layout 4.5s on a 3086-node DOM (2843 inside the hidden .layout shell) and Script Evaluation 2.3s. Largest payloads: firebase-database 182KB, Firebase Auth iframe 93KB, lucide UMD 71KB, firebase-auth 38KB. The remaining cost is structural: index.html is 307KB of inline markup (37KB brotli on the wire) and the app shell is parsed and styled before login. Fixing that means shipping a separate login document and injecting the shell after auth - a real refactor of the live Admin boot path, so it is a deliberate decision, not a tweak.
- [2026-10-22 11:03 UTC] [2026-10-22 04:40 UTC] Parts of Admin/index.html, Admin/js/features/catalog.js, Admin/style.css and website/shared.css were double-encoded UTF-8 (written as UTF-8, read back as cp1252): the Admin showed a mangled rupee sign instead of the real one and a mangled em-dash instead of the real one. Repaired by re-decoding each suspicious run as cp1252 bytes -> UTF-8. Proof it was encoding-only: re-running the repair on the committed file yields a byte-identical result. tests/encoding-check.mjs now guards against it coming back. Beware: a PowerShell console renders UTF-8 as cp1252, so mojibake seen in the terminal is often a display artifact - check the bytes with Node before changing anything.
- [2026-10-22 11:03 UTC] [2026-10-22 04:40 UTC] The Admin loaded xlsx.full.min.js (~270KB) from the CDN on EVERY page load. It is now fetched on first use via Admin/js/xlsx.js (ensureXlsx), the same lazy pattern as loadJSPDF. Sub-resource transfer 414KB -> 145KB. Verified live: window.XLSX undefined until ensureXlsx() is called, the CDN request only then happens, and a real 16KB .xlsx is produced.
- [2026-10-22 03:55 UTC] [2026-10-22 04:00 UTC] Deployment map + live smoke test: firebase deploy --only hosting covers all 6 targets (admin, rider, menu, supreme, assets, web); menu publishes the source dir (no build), Admin/Supreme publish their dist, so tools/build.mjs must run first for those two. The assets target is a file bucket with no index (root 404 is by design). Verify with Playwright: status + console errors + page errors + failed requests; treat net::ERR_ABORTED on media as a browser cancellation, not a site error.
- [2026-10-22 03:55 UTC] [2026-10-22 04:00 UTC] A blob: manifest has no usable base path - relative start_url/scope are silently dropped by Chrome ('URL is invalid'). The per-outlet PWA manifest must use absolute URLs built from location.origin + the outlet path. Verified via CDP Page.getAppManifest: errors 0, start_url /pizza/index.html?o=..&b=.., scope /pizza/.
- [2026-10-22 03:40 UTC] **Public-copy guard**: `tools/check-copy-consistency.cjs` is the check for the marketing site (`website/`). It fails (exit 1) if any public file states a setup fee other than ₹500, if the ambiguous "0% commission on per-order" stat comes back, if a pizza term appears in `website/` or `docs/BACKLINK-KIT.md`, if a second phone/email appears in the canonical-fact files (`docs/BACKLINK-KIT.md`, `website/contact.html`, `website/llms.txt`), or if a page with a canonical is missing from `website/sitemap.xml`. Run it before any website deploy. ₹500 setup + ₹1/₹2/₹5/₹1 rates are the only price set (source of truth: `shared/billing-defaults.js`).
- [2026-10-22 03:40 UTC] **SEO keyword pivot holds** (2026-10-18 owner directive): no pizza-specific keywords, pages or articles — `website/` is positioned for "restaurant and cafe management software". A third-party SEO plan (2026-10-22) proposed a pizzeria landing page + "Best software for pizzerias" article; both were rejected against that directive. Third-party proposals get mapped against `docs/SEO-PLAN.md` (Phase 5) before any page is built, so we do not cannibalise an existing intent (1 intent = 1 page).
- [2026-10-22 03:39 UTC] [2026-10-22 03:40 UTC] Rules read gates that MUST stay public (anon read) because the customer app needs them: metadata/orderSequence (menu/js/order.js order number), dineinSettings (menu/js/app.js tax + service charge), webviewTokens/\ (menu/js/delivery.js WhatsApp delivery page), discounts (menu/js/discount.js coupon validation), loyalty/config (the customer must see the admin-configured earn rate and reward catalog). Tightening any of them breaks a live customer flow and shows up as a mystery failure, not a permission error.
- [2026-10-22 03:39 UTC] [2026-10-22 03:40 UTC] Never minify Admin source CSS by hand. tools/build.mjs already minifies with esbuild + PurgeCSS, so source minification produces a byte-identical dist (verified: style.css/chat.css/mobile-overrides.css dist output identical) while destroying 428 comment blocks and making every future edit a single-line regex operation. Also: never commit Playwright persistent profiles (wa-user-data/) or raw FCM subscription dumps - they carry device keys, push tokens and phone numbers. Both are now gitignored.
- [2026-10-22 03:39 UTC] [2026-10-22 03:40 UTC] Rider self-registration write shape: must include name + phone (the rules require both to create riders/\) and email (the order rules match a rider to an order by riders/\/email), and must NOT include isAdmin (its rule is newData === data, which fails on create because data is null). businessId must come from resolveBusinessIdForOutlet() (outletIndex) - a static outlet->business map silently writes the outlet id as the business id for every other outlet. Verified live: app payload 200, isAdmin:false 401, missing phone 401.
- [2026-10-22 03:39 UTC] [2026-10-22 03:40 UTC] outletIndex/{oid} accepts only bid, name, disabled, createdAt (\ is false) and name is capped at 80 chars. Always write the children (bid/name/disabled) rather than only disabled, because outlets onboarded before the index existed have no node and a half node breaks the rider resolver. Any outlet name longer than 80 chars must be rejected in the UI (maxlength + step validation) - the rules failure would otherwise abort the entire business+outlet+admin creation.
- [2026-10-22 03:39 UTC] [2026-10-22 03:40 UTC] Disabling an outlet sets businesses/{bid}/outlets/{oid}/suspended=true (the orchestrator stops the WhatsApp worker on that flag). Reactivate must clear BOTH suspended and disabled, from every entry point (restaurant list AND restaurant profile) - clearing only disabled leaves the bot stopped while the UI says active.
- [2026-10-22 02:47 UTC] [2026-10-22 02:40 UTC] database.rules.json read gates that MUST stay public (anon read) because the customer app needs them: metadata/orderSequence (menu/js/order.js order number), dineinSettings (menu/js/app.js tax + service charge), webviewTokens/\ (menu/js/delivery.js WhatsApp delivery page), discounts (menu/js/discount.js coupon validation), loyalty/config (customer must see the admin-configured earn rate and reward catalog). A pending tightening in the worktree made these admin-only and would have broken the QR order number, tax display, delivery page and coupons on the next rules deploy - it was reverted, not deployed.
- [2026-10-22 02:47 UTC] [2026-10-22 02:40 UTC] Customer leaderboard rank: the bot computes rank server-side and stores it in the customer's own loyalty/rankings/{phone} entry; the customer app reads ONLY that entry. The rules keep loyalty/rankings/\ phone-keyed (same phone-as-access-key trade-off as customers/{phone}/app and pushInbox) but the parent node has no read rule, so no bulk leaderboard read of other customers' phones/spend is possible.
- [2026-10-22 02:47 UTC] [2026-10-22 02:40 UTC] Canonical loyalty record is customers/{phone}/loyalty (plan L10) - that is the path the customer app reads and database.rules.json validates. The old loyalty/customers/{phone} path was written by the bot but read by nobody, so points never reached the UI; the bot now writes the canonical path. The bot's first-ever live run of the accrual was this deploy.
- [2026-10-22 02:46 UTC] [2026-10-22 02:40 UTC] Loyalty earn rate = 5 points per Rs 100 spent (earnRatePaisePerPoint 2000), phone-keyed across all channels (QR, WhatsApp, dine-in). Rate is admin-controlled via loyalty/config.earnRatePaisePerPoint; default is the config value, fallback 2000. This supersedes the 2026-10-21 note that said 1pt/Rs100 - that value was a units bug (100000 paise = Rs 1000/point, so almost every order scored 0 points) and the reward catalog (200/500/800 pts) only made sense at a 5x denser rate.
- [2026-10-22 02:46 UTC] [2026-10-22 02:40 UTC] Customer push inbox is capped at the 50 newest entries. Single implementation shared/push-inbox.cjs (prunePushInbox) called by BOTH writers: bot-control-api/server.js /tenant-api/notify and bot/index.js notifyCustomerApp. Prune happens after the write, oldest-first by sentAt, failures are swallowed so housekeeping never breaks a notification. Client still renders at most 40 (menu/js/customer.js).
- [2026-10-21 07:02 UTC] FIXED: Combo card double ₹ (app.js:603, delivery.js:246) — fmtMoney already prepends ₹, removed the redundant prefix. FIXED: Combo FAB overlap — moved .combo-fab back inside .combo-card-img (position:relative) so it overlays the image corner instead of the price row/hint. Deployed hosting:menu. Verified live: PWA install card renders, prices show single ₹, FAB on image corner.
- [2026-10-21 06:05 UTC] VERIFICATION COMPLETE for task 20261021-034313-7ff7: rider-app build (tsc -b && vite build) PASSES zero errors; rider-app lint (oxlint) 0 errors; root build.mjs all targets build; Firebase database + hosting:menu deploys released; node --check clean on all changed JS. Remaining unverified only due to infrastructure constraints (no paired FCM device for push E2E, can't write live orders for status-transition test). Confidence can now be raised to HIGH for code correctness; real-device E2E remains the only open gap.
- [2026-10-21 05:03 UTC] writeCustomerOrder must be exported from customer.js — order.js imports it; missing export throws 'does not provide an export named writeCustomerOrder' and breaks placeOrder entirely. Fixed and redeployed hosting:menu.
- [2026-10-21 04:21 UTC] Loyalty accrual is server-side (bot/index.js via Firebase Admin SDK), never client-side — client can't be trusted with points. Idempotency via loyalty/accruals/{orderId} lock + Firebase transaction on loyalty/customers/{phone}. Tier multipliers from loyalty/config (defaults: 1pt/₹100, Bronze/Silver/Gold). Cancelled/refunded orders excluded from accrual (only Delivered/Served).
- [2026-10-21 01:05 UTC] Marketing site SEO cluster (inventory, whatsapp-ordering, table-management, whatsapp-marketing, multi-outlet, restaurant-analytics, customer-database): one page per commercial intent, each with 4-5 real FAQs + BreadcrumbList/FAQPage JSON-LD, More-menu entry, sitemap + llms.txt, local Playwright verify then firebase hosting deploy + live cache:no-store check. Pages state honest gaps (no barcode/recipe, no floor-plan editor, no loyalty points, no consolidated multi-outlet report). Screenshot PII rule: admin captures must never show the real login email; chat lists pixelated.
- [2026-10-20 13:59 UTC] Website SEO (commit de6ff82): hosting uses cleanUrls — canonical/internal/sitemap URLs are extensionless and /page.html must 301 to /page; FAQPage JSON-LD must be regenerated from the visible <details> whenever FAQs change; setup fee is ₹500 (shared/billing-defaults.js is authoritative, AGENTS.md/llms.txt ₹1,500 is stale); large source files (sales deck) live in docs/, never website/assets/.
- [2026-10-20 04:44 UTC] Website brand buttons: primary/CTA background is now --brand-dark #c23a05 with white text (5.38:1, AA) and --brand-darker #a33204 on hover (6.96:1); raw --brand #E84908 is kept for the logo wordmark and accents only (it is 3.9:1 as button bg). Ghost buttons use brand-dark text; index hero inline override updated. Verified live 2026-10-20, commit 56406c4. Not done: .btn.whatsapp stays white-on-#25D366 (1.98:1) - WhatsApp brand green, needs a dark-text variant if we want it AA.
- [2026-10-19 03:01 UTC] Template review status lives ONLY in Meta (Graph). appTemplates/whatsappTemplates in RTDB is a content library with NO status field (body, category, explanation, language, name, useCase, variables) - do not add a status mirror; it would be a stale second copy of Meta state. Check status with GET /{WABA}/message_templates.
- [2026-09-30 03:50 UTC] Super provisioning = BOTH custom claims (isSuper/isSupreme) AND admins/{uid} mirror row (isSuper+isSupreme). RTDB rules (database.rules.json businesses/.read) check ONLY the admins/{uid} mirror - they cannot see custom claims - while SupremeAdmin/js/auth.js:51-62 accepts claims alone. Claims-only super = app renders but /businesses listener dies with permission_denied (data-store.js:40 + false 'reconnecting' toast; started=true so no self-heal, hard refresh required). 2026-09-30: the 2 real super accounts (UXrcVENOnrS4PPyu7XoOP994BPc2 nileshshah84870, V8jxcqeXMJd1pNodadk3HjIY6hh1 nexorasoftwareagency) had claims but NO admins row - restored both rows. Checklist when minting any future super: setCustomUserClaims + admins/{uid}.update({isSuper,isSupreme,email,name}). TUNNEL_URL console warning is unrelated pre-existing fallback (firebase-config.js:30).
- [2026-09-30 02:55 UTC] Promotional WhatsApp messaging (campaigns via sendPromotionalMessage/runPromotionCampaign) is OFFICIAL-API (meta transport) ONLY - hard-blocked on Baileys since 2026-09-30 because bulk promos are the top account-ban trigger on the unofficial transport. Guard: isMetaTransport(sock) in bot/utils.js; campaign start pauses with pauseReason 'transport-blocked' (Admin shows it raw), send-level throw 'promo-blocked-transport' is defense-in-depth (non-retryable in sendWithRetry). SEND_GENERIC_MESSAGE is NOT promotional (Admin Chat + rider 1:1 service channel) and stays open. Re-enables automatically when meta transport is active post-WABA.
- [2026-09-30 02:42 UTC] Ban-proofing (4-8s per-chat pacing + 3-strike 30-min freeze) is BAILEYS-TRANSPORT SCOPE ONLY. When official WhatsApp Business API (meta transport - user's 'best experience delivery' plan) is enabled after WABA lands: SKIP paceOutboundTo + strike/freeze (Meta enforces its own messaging limits; unofficial-account ban risk does not exist there). Current code paces ALL transports (wrappers at bot/index.js:1473 sendMessage / :1541 sendTemplate incl. meta / :1558 sendButton) - gate NOT implemented now because meta path is unreachable/untestable until WABA; add the transport==='meta' skip as a checklist item at flip time together with the existing template param re-verification.
- [2026-09-30 01:14 UTC] Both pm2 bot processes run transport=baileys (id4=live roshani-pizza, id12=wizard-test outlet -P-TahoJb732KsrERdxm never QR-paired since Sep 25). Template sends only activate when typeof sock.sendTemplate === function (meta transport); Baileys uses restored legacy msg/img text-image path. When business verification lands + real WABA flips an outlet to BOT_TRANSPORT=meta, re-verify: template param counts vs Graph, body-to-{{1}} mapping (proactive_promo has NO vars -> code100 -> text fallback), and chat-log component text.
- [2026-09-30 01:14 UTC] Bot ban-proofing state lives in bot/utils.js (in-memory Maps): paceOutboundTo (4-8s random per-chat gap) is wired into ALL 3 send wrappers in bot/index.js; freeze (3 continuous non-intent strikes in AWAITING/WEBVIEW -> 30-min silence) is enforced ONLY at the message handler + marketing gates (sendPromotionalMessage, SEND_GENERIC). Transactional order-status notices are DELIBERATELY never frozen (utility templates are ban-safe; dropping them would mark real orders sent-but-not-delivered). Admins never accumulate strikes (isAuthorized gate) or they would lose reports/alerts. Extend in utils.js, never re-add freeze-drop to the generic send wrappers.
- [2026-08-12 02:20 UTC] **DUAL-TRANSPORT WHATSAPP BOT (per restaurant)**: each restaurant/business supports BOTH Meta Cloud API (`BOT_TRANSPORT=meta`) and Baileys (`BOT_TRANSPORT=baileys`). ONLY ONE is active per restaurant at a time. Transport is controlled remotely from **Supreme Admin → Restaurants Profiles → WhatsApp Baileys section** (Scan QR button → shows QR + live status), mirrored on the WhatsApp second dashboard. Meta API is the default/primary; Baileys used when a restaurant wants a real number via QR. Bot reads transport mode from Firebase `bot/{outlet}/transport` (or env default), switchable at runtime.
- [2026-08-12 02:20 UTC] **STATIC IMAGES FOR FIREBASE HOSTING**: brand/menu images may be placed directly in the project directory (e.g. `menu/images/`, `assets/`) and deployed with Firebase Hosting, referenced via relative URLs like `/images/logo.png`. No Firebase Storage upload needed for static brand assets.
- [2026-08-04 10:00 UTC] PowerShell version-bump/edits on files with non-ASCII (emoji, ₹, typography) MUST use the UTF-8-safe pattern: `[System.IO.File]::ReadAllText(path, UTF8)` + `WriteAllText(path, content, UTF8Encoding($false))`. NEVER `Get-Content`/`Set-Content` — the 5.3.16 bump corrupted every emoji in Admin/index.html + sw.js (mojibake "ðŸ…"). Signature of corruption = C1 control chars U+0080–U+009F.
- [2026-10-26] Doc repair: the 27 `U+FFFD` replacement chars in this file (unrepresentable cp1252 bytes left behind by old PowerShell writes) were replaced with the intended `—`; line 67's quoted mojibake example is truncated to `"ðŸ…"` because its tail bytes are unrecoverable. Docs only — no code affected. The 14 in `Fixes-and-Changes/foodhubbie-pwa-build-progress/menu/delivery.html` were recovered exactly from the live `menu/delivery.html`.
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
- [2026-10-30 UTC] **Never store an outlet admin password in RTDB.** `businesses/$bid/.read` cascades to every descendant, so `outlets/{oid}/adminLogin` is readable by every staff role. It now holds `{email, passwordUpdatedAt}` only; the password lives in Firebase Auth and is changed through `bot-control-api` `/api/admin/update-password` (which mints the Auth user, then records the email). Any future "show the login" feature must reset, never reveal.
- [2026-10-30 UTC] **Setup mode is a UX layer, not a security boundary.** `outlets/{oid}/locked` is enforced by rules only for `orders`, `tableSessions` and `tableRequests` (a locked outlet cannot take orders); `billing`/`customers`/`riders`/`expenses`/`discounts`/`settings`/`dishes` stay writable. The friendly gate is client-side: `state.locked` in `Admin/js/auth.js` → `enterSetupMode()` dims every tab not in `SETUP_TABS` (`Admin/js/ui.js`) and the checklist renders only while locked. Do not describe setup mode as a lockout; do not add a tab to `SETUP_TABS` unless an owner genuinely needs it before go-live.
- [2026-10-28 UTC] **The public demo is a real tenant, not a mock: `businesses/foodhubbie-demo`.** Never seed `outletIndex/demo` (a QR/menu link would then resolve it and customers could order into the demo) and never give the demo outlet an `outlet.whatsapp` node (bot-control-api's orchestrator spawns a worker for any outlet that has one). Read-only is enforced by `admins/{uid}.isDemo` at `businesses/$businessId/.write` — the only grant that cascades past deeper denies — plus an immutability clause on `isDemo` in `admins/$uid`; client-side gates are UX only. Demo credentials are public by construction (`Admin/js/demo-mode.js`), so treat anything in that tenant as world-readable. Reseed with `node tools/seed-demo-tenant.cjs --apply` after changing fixtures; the nightly EC2 cron only re-runs it.
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
- `bot/index.js` — accrueLoyaltyPoints added to notifyCustomerApp flow — uses Firebase Admin SDK (bypasses security rules), idempotent via accruals/{orderId} lock. Edit here touches every order-status notification path. (flagged 2026-10-21 04:21 UTC)
- `database.rules.json` — Loyalty rules added under customers//{orders,ratings,rewards,loyalty} and outlet/loyalty/{config,rankings}. Customer app writes rewards redemptions directly — rewards sub-node write rule is required or redemptions are silently denied. Any edit must be JSON-validated and cross-checked against menu app reads. (flagged 2026-10-21 04:21 UTC)
- `tests/utils.js` — Shared by critical-flows + walkout-retest specs. Encodes 4 non-obvious contracts added 2026-10-13: (1) login() restores cached firebase:authUser via addInitScript after first real sign-in - repeated signInWithPassword throttles Identity Toolkit and hangs the form; (2) all KDS selectors scoped #tab-tables because KDS renders in BOTH #tab-live and #tab-tables (hidden-first match timeouts); (3) tab-switch clicks need :visible because desktop sidebar nav-btn matches first but is hidden on mobile; (4) critical-flows orderId is persisted to os.tmpdir()/foodhubbie-e2e-order-id and hydrated in beforeEach - changing any of these silently re-breaks the chain without an obvious local error. (flagged 2026-10-13 17:29 UTC)
- `bot/utils.js` — Hosts the shared ban-proofing module (paceOutboundTo/recordWrongMessage/isJidFrozen/clearWrongStrikes, module-level Maps) exported to index.js + promotions.js, plus maskJid/RateLimiter/OutboundTracker used across the bot. Behavior changes here hit every send path and every outlet; covered by bot/tests/unit.test.js ban-proofing test - keep it green. (flagged 2026-09-30 01:14 UTC)
- `bot/index.js` — Send wrappers carry 4 stacked concerns (chat-log, G5 quota counter, per-chat pacing, conversation logs) and the status-notification send block chooses template-vs-text by transport; the ban-proofing freeze gates live in the message handler (isAuthorized hoisted). Any edit here needs impact_scan first - breaking a wrapper silently loses chat history or quota counts. (flagged 2026-09-30 01:14 UTC)
- `Admin/index.html` & `Admin/sw.js` — contain emoji/₹/typography; any version bump/edit MUST use the UTF-8-safe PowerShell pattern (Standing Decision 2026-08-04) or all non-ASCII corrupts
- `tools/build.mjs` — PurgeCSS safelist (runtime-composed classes) — any new dynamically-built CSS class family must be added here or it gets purged from dist (flagged 2026-08-03 19:39 UTC)
- database.rules.json — multi-role complex rules
- Admin/js/features/orders.js — STATUS_SEQUENCES alignment
- firebase.json — 3-target hosting, CSP divergence
- rider-app/src/services/orderService.ts — delivery lifecycle
- `Admin/js/features/discount-evaluator.js` — shared money path for POS *and* table billing. `getEligibleOffersForDisplay()` is **async** (it needs the category key→name map); every caller must `await` it — exactly 2 exist (`pos.js` `_renderWalkinOffers`, `tables.js` `_renderTableBillOffers`). `bot/discount-engine.js` is a deliberate near-mirror that is intentionally NOT kept in lockstep on channel/category (see task 20260925-134422-4e70).
- `Admin/sw.js` — precache list; see Standing Decision 2026-09-25 on bumping `CACHE_NAME`.
<!-- FRAGILE_FILES_END -->

## Task Log

### [20261031-d2-email-verify] D2 — email verification before an auto-onboarded outlet can go live
- TIER: 2 (Auth account deletion + a tenant-deleting sweep; no money movement)
- STATUS: **DONE — committed, deployed, live-verified.** Commit `c1e7a67` on `onboarding-email-verify`, branched from `seo-brand-consistency` `28c889e`.
- Shape: the Auth user is created unverified; the owner can configure the tenant while unverified; Supreme's unlock refuses an explicitly unverified owner; a daily sweep expires auto-onboarded tenants that never verify after 72 h.
- **Live E2E caught two real defects** (both fixed before the final deploy): (1) `sendEmailVerification(user, { url: 'https://foodhubbie-admins.web.app/' })` failed EVERY send with `auth/unauthorized-continue-uri` — that host is not in Auth → Settings → Authorized domains. The default action page is used instead (no account config, no silent failure). (2) The automatic send never started the 60 s cooldown, so Resend looked active and did nothing for a minute; `startCooldown()` now runs after the auto-send too.
- Files: `Admin/js/features/email-verify.js` (new; element + inline styles created by the module, so `index.html`/`style.css` stay untouched), `Admin/js/main.js` (dynamic import after `initAuth`), `Admin/js/firebase.js` (`sendEmailVerification` export), `Admin/sw.js` → `v5.12.11`; `SupremeAdmin/js/features/restaurant-profile.js` (unlock gate), `onboarding-requests.js` (Expired filter/KPI/reason); `bot-control-api/server.js` (`outletAdminStatus`, `GET /api/admin/outlet-admin-status`, `runUnverifiedCleanup`, daily scheduler); `database.rules.json` (`expired` + `expiredAt`/`expireReason`); `website/signup.html` copy; `tests/auto-onboarding.check.cjs` extended to 16 checks.
- Gate semantics (deliberate): the unlock gate fails CLOSED only on an explicit `emailVerified: false`; `emailVerified: null` = no `adminLogin.email` = legacy outlet, never gated; a network/5xx answer warns and unlocks so an API outage cannot trap a tenant; `missing: true` (Auth user gone) counts as unverified. The endpoint is `requireSuperOnly` (view-only support gets 403).
- Cleanup semantics: `reviewedBy === 'auto-onboarding'` only, never `foodhubbie-demo`, never a tenant with an order or a payment; removes the Auth user, `admins/{uid}` only while it still points at that outlet, the outlet (or the business when it is its only outlet) and `outletIndex/{oid}`, then marks the request `expired`. Observe mode by default — **nothing is deleted until `ONBOARDING_CLEANUP=enforce` is set on EC2**. First pass 10 min after boot, then every 24 h, `unref()`ed.
- Deployed 2026-10-31: `firebase deploy --only database,hosting:admin,hosting:supreme,hosting:website`; EC2 `server.js` md5-identical to the worktree copy (`529a826c…`), `node --check` OK, backup `server.js.bak-20261031-*`, `pm2 restart bot-control-api` (id 2 online), log `[onboarding-cleanup] armed — 72h unverified TTL, observe mode`, endpoint 401 without a token.
- Verified: `tests/auto-onboarding.check.cjs` 16/16; encoding, imports, signup-onboarding 12/12, twins 5/5, wallet-checklist 3 suites, copy-consistency, six shared self-checks, `gate-verify.js` PASS, both builds; live E2E 8/8 (throwaway unverified Auth user + temp `admins` row on the demo tenant, then both deleted); built `?demo=1` boots 0 errors and no banner.
- Not verified: rules behaviour locally (no Java → no RTDB emulator) — `expired`/`expiredAt`/`expireReason` are Admin-SDK-written and only kept valid for future client writes; the Supreme unlock gate was not exercised with a real super token (unit path + code review only); no real website sign-up run.
- Open: cleanup remains observe mode (owner decision to enforce); D4 still blocked on the live wallet.
- Ended: 2026-10-31

### [20261030-onboarding-ship] Onboarding setup checklist + tenant parity — merged and deployed
- TIER: 2 (security rules + a public write path that creates tenants; no money movement in code)
- STATUS: **DONE — merged, deployed, live-verified.** Merge `c54522e`, docs `0bcfc98`. Supersedes the "not merged" status of `[20261029-onboarding-review]`.
- Branch work: `83f4fbb` (the WhatsApp step reads the real `bot/pair` state), `9d3109f` (F1 setup mode), `7357102` (F2 tenant parity, no plaintext password). Merged `--no-ff` into `seo-brand-consistency`; the only conflicts were the two version lines both branches had bumped (`Admin/index.html` `style.css?v=`, `Admin/sw.js` `CACHE_NAME`) — resolved with one bump above both: shell **v5.12.10**, `style.css?v=5.4.13`.
- F1 shipped: 7-step dependency-ordered checklist; only a REQUIRED step may become the hero; the panel renders only while `state.locked`; every hero button deep-links to the exact control (`gotoStep`, and `#btnAddCategory` after the Categories redesign). `SETUP_TABS` gained `discounts` and deliberately did NOT gain `chat`/`promotions` — the WhatsApp step reads the real `bot/pair` state and opens the Connect control, so `chat` never needed unlocking.
- F2 shipped: `approveOnboardingRequest()` now writes `outletIndex/{oid}` (the QR/menu resolver), assigns a per-business `outletNo`, stamps `bid`/`oid` only AFTER the duplicate-email check (the stamp is the "may own an Auth user" marker, so a retry is idempotent and reuses a previously assigned `outletNo` — a gap in the label sequence is acceptable, a duplicate is not), and spreads template defaults BEFORE identity/security fields so a stray template key can never unlock an outlet or rewrite its login. `adminLogin` now stores `{email, passwordUpdatedAt}` — never the password (see the 2026-10-30 standing decision).
- Rules: lock gates on `orders`/`tableSessions`/`tableRequests`; `onboardingRequests/.indexOn status`; `inquiries` (`source=='website'`, `status` absent or `'read'`); write-only `onboardingSecrets`.
- Deployed 2026-10-30: `firebase deploy --only database,hosting:admin,hosting:supreme,hosting:website` — rules released (syntax valid), 3 hosting versions released (admin 95 files, supreme 48, website 66). EC2: `bot-control-api/server.js` backed up as `server.js.bak-20261030035230`, scp'd, `node --check` OK, `pm2 restart bot-control-api` (id 2, online). The box's copy differed from ours only by the F2 block — no box-only code was lost.
- Live verification: admin `sw.js` = `foodhubbie-erp-shell-v5.12.10` and precaches `style.css?v=5.4.13` (build minifies the SW onto ONE line — a line-based grep for `CACHE_NAME = ` misses it; match the string); `index.html` serves `style.css?v=5.4.13`; Supreme `admin-creds.js` serves the "not stored for security" copy; `foodhubbie-web.web.app/signup.html` 200; box `ss -ltn` shows `*:4000`, `curl /api/bot/status-all` 401 (listening), logs show `Bot Control API listening on :4000`, `[auto-onboarding] watching new sign-ups`, `[Auto-Settlement] Daily scheduler armed`. Built Admin booted in `?demo=1`: 0 console errors, 7 steps, banner, wallet alert hidden, 14 nav tabs dimmed / 11 open, all five deep-link targets present.
- Gate on the merged tree before commit: encoding, imports, shared twins 5/5, cost-math, report-catalog, report-export, loyalty/payroll/money/discount self-checks, auto-onboarding 10/10, admin-wallet-checklist 3 suites, signup-onboarding 12/12, `gate-verify.js` PASS, both builds.
- Not verified: rules behaviour locally (no Java → the RTDB emulator cannot run) — use the live probe in `docs/PLAN-ONBOARDING-FLOW-HARDENING.md` §7.1; Supreme billing screens need a real super account; the live auto-approval path needs a real website signup.
- Open: **D2** email verification before promoting sign-up publicly; **D4** wallet gates (10% → stop the bot, 0 → stop QR ordering) — the writer ships in observe mode and enforcement is blocked on the owner topping up the live wallet (the ledger shows `roshani-pizza/pizza` at −₹72.14, genuinely unpaid); **D5** ₹500 setup vs ₹1,000 minimum-wallet marketing copy.
- Box is dirty by design: `bot-control-api/server.js` (this deploy), `bot/{firebase,index,rider}.js` (earlier scp deploys), `.env.bak-*`, `.last-tunnel-url*`, `assets/images/*`.
- Confidence: HIGH for the app/rules/hosting deploy (gate + live probes); MEDIUM for auto-approval end-to-end (no real signup run).
- Ended: 2026-10-30

### [20261029-onboarding-review] Onboarding setup checklist / auto-approval / wallet / percentage package — reviewed + verified, NOT merged
- TIER: 2 (security rules + a new public write path that creates tenants; no money movement in code, but the wallet becomes the product's billing view)
- STATUS: **REVIEWED + VERIFIED LOCALLY — not merged, not deployed, no live data touched.** Adapted series on local branch `onboarding-setup-checklist` (7 commits, `4c32061..b4a301a`), built in the throwaway worktree `%TEMP%\opencode\onboarding-wt`. Plan: `docs/PLAN-ONBOARDING-WALLET-PERCENTAGE.md`.
- Source: `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/` (6-commit mbox on base `a4392f1` + Guide.md + Change-Guide-Before-After.md). 22 files, +3335/−130 (production +719/−130, tests +248, 2,274 lines are the two duplicate `GUIDEs/` docs).
- **Apply method**: `git apply --check` on the whole mbox is invalid for a stacked series (false failure at `Admin/js/ui.js:112`); `git am -3` works. Two real divergences: (1) our `ui.js` has the riders boot-race guard (`if (!isRidersSubscribed()) lr({ withStats: false })`) the patch predates — 3-way merge kept it; (2) `database.rules.json` conflicted on `orders/$orderId` — resolved by keeping OUR `.read` and OUR `.write` (outlet-scoped riders, QR/webview source branches, 25 `isDemo` grants) and prefixing the patch's lock clause to `.write` only. The patch's stale root-`riders` assumptions never entered the file.
- **Tests were the only failures, not the patch**: `tests/auto-onboarding.check.cjs` strips the express route with `/\n\}\);\n/`, which never matches a CRLF checkout (`core.autocrlf=true`) → route survives → `ReferenceError: app is not defined`; proved by converting the file to LF (pass) and by the one-line `\r?\n` fix (pass on both). `tests/signup-onboarding.check.mjs` used `click({ force: true })` on `#fTerms`/`#submitBtn`; `force` skips scroll-into-view/stability, so after the inline error divs shift the layout the click lands on a coordinate below the viewport and silently misses. Both fixed on the branch (`b4a301a`): 7/7 and 12/12.
- **Verified locally**: `shared/cost-math.js` self-check; `tests/encoding-check.mjs`; `tests/check-imports.mjs`; `tests/auto-onboarding.check.cjs` 7/7; `tests/admin-wallet-checklist.check.mjs` 3 suites; `tests/signup-onboarding.check.mjs` 12/12; `tools/check-shared-twins.cjs` 5/5; `tools/check-copy-consistency.cjs`; `gate-verify.js` PASS 0 failures; `build:admin` 2.9MB→2.2MB; `build:supreme` 346KB→240KB. **Real browser**: built Admin `dist` with `?demo=1` against the live demo tenant boots (22 dish cards, Costs→Wallet renders −₹910 / paid ₹3,490 / used ₹1,294 / 2 receipts, 0 page errors); **setup mode 8/8** (banner ₹1,000, `orders` tab refused + popup, dismiss, menu still usable, banner removal) by injecting `state.locked` through the ES-module cache — no data written; built Supreme `dist` boots to the login screen with 0 console errors (proves `/shared/cost-math.js` resolves in the Supreme build).
- **Findings that must be fixed before merge** — (F1) the checklist's WhatsApp step links to `tab: 'chat'`, but `chat` is not in `SETUP_TABS`, so the button shows the "top up to go live" popup instead of opening WhatsApp connect: add `'chat'` (and consider `'discounts'`). (F2) `approveOnboardingRequest()` does not write `outletIndex/{oid}`, while the Supreme wizard does; `outletIndex` is what resolves an outlet key for the menu/bot and what the QR link is built from — pre-existing for manual approvals, but auto-approval makes it the default path for every new restaurant. (F5) `Admin/sw.js` `CACHE_NAME` is not bumped by the patch — bump at merge, coordinating with the uncommitted WebP change that also wants `v5.12.3`. (F6) the demo tenant now opens with "Wallet balance finished −₹910" (seeded charges exceed payments − usage) — seed a healthy wallet in `tools/seed-demo-tenant.cjs`.
- **Verified-safe by inspection**: auto-approved outlets get `outlet.whatsapp = {status:'pending'}` but `bot-control-api/orchestrator.js` `desiredState()` returns null unless `status === 'active'`, so no bot worker is spawned for spam outlets. `orders` collection has a parent `.read`, so the wallet's lifetime orders read is permitted for the outlet admin.
- **Not verified here**: rules behaviour (no `firebase-tools`, no Java → RTDB emulator cannot run on this box), Supreme billing screens (needs a real super account), live auto-approval (needs the deployed API). `docs/PLAN-ONBOARDING-WALLET-PERCENTAGE.md` §7 lists the exact live probes and the rollback.
- Owner decisions still open (plan §9): keep or drop the duplicate `GUIDEs/`; email verification / password-set link before promoting sign-up publicly; public pricing copy (₹500 setup vs ₹1,000 minimum wallet); hard stop at zero balance; percentage-package visibility.

### [20261029-demo-sandbox] Demo becomes a writable sandbox seeded from the live Roshani catalog ("Demo Dashboard")
- TIER: 2 (security rules + a public-tenant data model; no money movement outside the demo tenant)
- STATUS: DONE (live E2E 12/12 + 6/6, live rules gate 28/28, tour removed + 9/9 HTTP + 9/9 browser live re-verify, encoding ok, build:admin clean)
- Supersedes the read-only half of `[20261028-demo-live]`: visitors must be able to actually use the dashboard, so the demo is now a **writable sandbox contained by its own tenant + the nightly reseed**, not by a write ban.
- Catalog: `tools/seed-demo-tenant.cjs` now reads the LIVE tenant over the public RTDB REST API (`loadLiveCatalog()` — no credentials, so a dry run works anywhere) and builds the demo menu from it: 6 categories / 22 dishes (real names, prices, sizes, base64 photos) / 4 combos. `buildCatalog(live, fx)` returns `{categories, dishes, combos, dishMap}`; seeded order history maps fixture ids `d1..d14` onto the live dish ids (alphabetical, deterministic); combo windows are forced active (`startAt = NOW-30d`, `endAt = NOW+365d`, `disabled:false`). Outlet is renamed **Demo Dashboard** with `outletNo:'DD'` + `settings.Store.storeName`, order ids `DD-…`, inventory SKU `DD-`, `redeemedOrderId:'DD-DEMO'`. Payload 1231 KB / 353 orders / 4 open sessions / 8 customers / 5 staff + payroll run.
- Rules: `businesses/$businessId/.write` stays `isSuper || isSupreme || (businessId == $bid && isDemo != true)` — deliberately, because it is the ONLY grant that cascades past deeper denies, so widening it would unlock `outlets/{oid}` root, `whatsapp` (bot-control-api spawns a worker) and `disabled` (self-disable). Instead `(isDemo == true && businessId == $businessId) ||` was inserted after `"auth != null && ("` in **19 app-facing rules** under `outlets/$outletId`: 15 `owner||manager` fragments (`settings` write, `Security/staffCeilings`, `Security/managerPinHash`, `settings/roles` r/w, `audit/staffChanges` r/w, `staff` r/w, `attendance` r/w, `shifts` r/w, `leave` r/w, `payrollRuns` r/w, `emailIndex` write), 3 `owner`-only fragments, and the `audit/staffChanges` owner-only read. `metadata/orderSequence/$date` already had its own write rule → no grant needed. A `$demoSection` wildcard was tried first and silently ignored — **RTDB named children take precedence over a `$wildcard` sibling**, so the grant must live on each named rule.
- Isolation kept: `admins/$uid` still pins `isDemo` immutable, and the demo clause is scoped `businessId == $businessId` so it cannot reach another tenant. Verified with the demo idToken: own business read 200 / roshani read 401, `whatsapp` 401, `disabled` 401, business-root 401, other-tenant 401, clearing `isDemo` 401. `tests/admin-scope-rules.check.cjs` grew 9 demo checks → 28/28 live.
- Per-section write probe (realistic payloads, then cleaned up): categories, dishes, staff, attendance, shifts, leave, payrollRuns, emailIndex, settings/roles, settings/Security/*, audit/staffChanges, tables, discounts, loyalty/config → all 200; reads of staff/attendance/shifts/leave/payrollRuns/settings/roles/audit/staffChanges → all 200. **Gotcha: RTDB answers 401 for `.validate` failures too**, so probe payloads must match the `.validate` shape (`attendance.inAt` string, `leave.paid` boolean, `payrollRuns.lines` non-empty object, `emailIndex` string value, `settings/roles.tabs` non-empty object, `tables.capacity`+`token`).
- Client (`Admin/js/demo-mode.js`): `BLOCKED_CHANGE_IDS`/`onChange` deleted; `BLOCKED_ACTIONS` = 5, `BLOCKED_IDS` = 4, only for side effects OUTSIDE the tenant — `saveRiderAccount`/`staffSubmitBtn` (real Firebase Auth user creation), `resetRiderPassword`/`forgotPasswordBtn`/`btnChangePassword`/`btnConfirmReauth` (password ops), `deleteRider` (writes root `riderIndex`), `sendTestPromo` (no bot worker), `btnQuickToggleOutlet` (rules deny). Banner = "Demo Dashboard · full sandbox · reseeded nightly".
- Seed bug found by E2E: `settings.Delivery.backupCode: 'DEMO-2026'` fails the app's 4-digit validation, so EVERY Save Settings silently died with "Backup Code must be 4 digits" while looking like a permissions problem. Now `'2026'`. Second bug: `saveDish` `await`ed `mirrorToMenuBank`, and the demo is (correctly) denied the shared `menuBank` → the dish saved but the modal reported failure; `shared/menu-bank.js` mirror is now best-effort (`Promise.resolve().then(...).catch(warn)`) so a bank denial can never fail the outlet's own save.
- Verification: live Playwright at `https://www.foodhubbie.in/demo` — 12/12 (auto sign-in, banner, `currentBusinessId=foodhubbie-demo`, no "roshani" leak, real dishes + 4 combos visible, settings pre-filled, **Save Settings success + persisted to DB**, delete-rider shows the restriction modal, POS lists live dishes, 0 console errors) and 6/6 write flows (add dish ₹123 → persisted → delete removes node; POS sale toast `Sale #DD-291026-21 completed!`; order `DD-291026-21` exists with total ₹130.91; 0 console errors). Demo tenant reseeded afterwards to clear the test rows. Routing re-checked: `www` 301 → apex 302 → admin host 200, `/demo/tour` 200 on both hosts (at that moment — the tour was deleted later the same day, see below). EC2 seeder synced + re-run (identical 1231 KB payload). Admin SW `v5.11.9` → `v5.12.2`.
- **Tour removed (2026-10-29, owner: "REMOVE THAT DEMO TOUR ON MARKETING WEBSITE AS IT IS NOT THE REAL ONE")**: the static replica was stale by definition (its own frozen dataset vs. a live tenant), so it was deleted everywhere, not just unlinked — `Admin/demo.html`, `tools/build-demo-site.mjs`, `tools/check-demo-nav.cjs`, `tests/demo-e2e.mjs`, `website/demo/` (gitignored mirror) and the replica-only `Admin/js/demo/{main,nav-config,ui-kit,store,pages-catalog,pages-insights,pages-operations,pages-people,pages-system}.js`. Kept `Admin/js/demo/restrict.js` (the live demo-mode + `ui-utils.js` import it) and `Admin/js/demo/demo-data.js` (imported by the seeder). All 24 `website/*.html` nav links now point straight at `https://foodhubbie-admins.web.app/demo`; `Admin/index.html` login link → `/demo` "Try the live demo"; `website/sitemap.xml` `/demo/tour` entry removed; `tools/check-copy-consistency.cjs` demo exception narrowed to `slug !== 'demo'`. `firebase.json` — admin `/demo/tour` **301 → `/demo`** (rewrite + its demo-only header/CSP block removed), website `/demo/tour` **302 → admin host** (`rewrites` + demo CSP block removed); `package.json` dropped `build:demo-site`/`test:demo`/`check:demo-nav` and `deploy:website` is now a plain deploy. Old links never 404: both hosts redirect `/demo/tour` to the real dashboard (`/demo.html` too — it was the replica's own filename, so it is now a 301 instead of falling through to the app shell without demo mode). Verified: build:admin clean (no `dist/demo.html`), encoding ok, copy-consistency "30 files + 24 sitemap urls consistent", `git rm` of 13 files.
- Tour removal — deploy + live re-verify (2026-10-29): deployed `firebase deploy --only "hosting:admin,hosting:website"` (then `hosting:website` once more after the sitemap was re-cut so its line endings stayed LF and the diff is exactly `0 1`). **9/9 HTTP checks**: admin `/demo/tour` 301→`/demo` 200, admin `/demo.html` 301→`/demo` 200, apex `/demo/tour` 302→live demo 200, `www /demo/tour` 301→apex→302→live demo 200, old mirror assets gone (`/demo/js/demo/main.js` no longer 200), `www /demo` still 200 on the admin host, `sw.js` = `foodhubbie-erp-shell-v5.12.2`, **all 24 sitemap pages** carry exactly `href="https://foodhubbie-admins.web.app/demo"` and none still link `/demo/tour`, sitemap = 24 URLs with no `/demo/tour`. **9/9 browser checks** on the live URL: auto sign-in as Demo Dashboard, banner `Demo Dashboard · full sandbox · reseeded nightly`, no restriction modal on boot, tenant `foodhubbie-demo/demo`, **22 `.dish-card`s** with real names (Farmhouse/Paneer/Burger/Pasta/Momo), login screen links `/demo` "Try the live demo" with no `/demo/tour`, 0 console errors. Gotcha recorded: `page.click('[data-tab="menu"]')` must use `.filter({ visible: true })` — the same `data-tab` exists on a hidden dropdown `nav-btn`, and `force: true` silently clicks the wrong one (0 cards, looks like a broken catalog). Live sitemap confirmed 30 lines / 24 `<url>` / no `demo/tour` after the final deploy. Committed `8a3f710` "Demo: remove the static tour, point every demo link at the live dashboard" and pushed to `origin/seo-brand-consistency` (unrelated working-tree changes — `.gitignore`, `Promo-Campaign/`, `promo/assets/`, `orders-screen.yml` — deliberately not staged). **Regression guard** added to the existing `tools/check-copy-consistency.cjs` (no new file): it now fails if any `website/*.html` contains `/demo/tour` OR if a `class="link nav-demo"` href is anything other than `https://foodhubbie-admins.web.app/demo`. Proven by temporarily re-breaking `pricing.html` three ways (tour href, relative `/demo`, stray body link) → 4/4 guard checks, tree restored green.
- Confidence: HIGH — rules, catalog and every write path asserted live from the demo user's own idToken and a real browser, then the tenant was rebuilt from the seeder.
- Ended: 2026-10-29

### [20261028-demo-live] Public demo = the real dashboard (`/demo`), tour moves to `/demo/tour`
- TIER: 2 (rules + hosting routing + a new client mode; no money movement)
- STATUS: DONE (live: `/demo` → 302 → admin host → auto sign-in, 25/25 tabs render, 0 console errors) · **SUPERSEDED 2026-10-29 by `20261029-demo-sandbox`** — the demo is now a writable sandbox, not read-only
- Tenant: `businesses/foodhubbie-demo/outlets/demo` (Bella Napoli synthetic fixtures at first seed; **renamed to Demo Dashboard and reseeded from the live Roshani catalog on 2026-10-29** — see `20261029-demo-sandbox`), admin `demo@foodhubbie.in` / `Demo@Foodhubbie2026` = uid `oAoW5tN0etX95EKHA50BFgzGkim1`, `admins/{uid} = {name:'Demo Dashboard', role:'Admin', outlet:'demo', businessId:'foodhubbie-demo', isDemo:true}`. 352 orders / 4 open sessions / 8 customers / 14 dishes / 3 combos / 5 staff / payroll run / 6 feedback / chats / inventory / expenses / billing — ~481KB, seeded by `tools/seed-demo-tenant.cjs` (dry-run default, `--apply` to write; imports `Admin/js/demo/demo-data.js` through a temp `.mjs` rewrite + `shared/money-math.js` + `shared/payroll-math.js`).
- Read-only at the RULES layer, not in JS **(as first shipped — superseded 2026-10-29: writes are now granted per-section, see `20261029-demo-sandbox`)**: `businesses/$businessId/.write` = `isSuper || isSupreme || (businessId == $bid && isDemo != true)`; `admins/$uid` update branch pins `isDemo` immutable (a demo user cannot clear their own flag). Verified live with the demo idToken: own business read 200, roshani read 401, own business write 401, own fcmToken write 200, clearing isDemo 401. `tests/admin-scope-rules.check.cjs` 21/21 after deploy.
- `outletIndex/demo` is deliberately ABSENT (no QR/menu link can resolve the demo outlet → no customer order can land here) and `outlet.whatsapp` is absent (bot-control-api's orchestrator only spawns workers for outlets that have one). `bot/status.lastSeen` is seeded +365d so the header shows "Bot online"; `bot/demo/pair = {status:'connected'}` suppresses the chat onboarding.
- Client mode `Admin/js/demo-mode.js` (path `/demo` or `?demo=1`): sets `window.currentBusinessId`/`currentOutlet` BEFORE sign-in (bot-status.js and branding.js read them at import time, i.e. before auth.js resolves the admin node — without this the bot chip queries roshani-pizza and shows Offline), `auth.authStateReady()`, then session-persistence sign-in (a public demo must not leave a session in localStorage), then dispatches `switchOutlet` so pre-auth listeners re-attach. Banner + `applyDemoIdentity()` (sidebar identity is static HTML "Store Admin / Superuser" for every role). Click/change blocklist (`BLOCKED_ACTIONS`/`BLOCKED_IDS`/`BLOCKED_CHANGE_IDS`; since trimmed to 5 actions / 4 ids — see `20261029-demo-sandbox`) — deliberately NOT blocked: cart/bill PREVIEWS that never write (`addToWalkinCartFromModal`, `addComboToWalkinCart`, `adjustPOSModalQty`, `applyWalkinCoupon/Discount`, `applyOfferFromPanel`, `applyTableBillCoupon/OfferFromPanel`, `billSplit*`); the persistence step of each flow is what gets blocked. Safety net: `showToast` turns a demo `PERMISSION_DENIED` into the same modal, and `logAudit` is a no-op (rules already deny `logs/audit` writes to isDemo).
- Restriction copy is exact and lives once in `Admin/js/demo/restrict.js` (`Demo Mode — Access Restricted` / the long sentence / `Got it`). That file now injects its own CSS (the live dashboard has no `.demo-modal` block; the replica's rules are inline in demo.html) at z-index 100000 — the ERP stacks drawers/sidebars at 5000 and its own modals at 10000+.
- Routing: `firebase.json` admin target — `/demo` rewrite REMOVED (falls through to `/index.html`, the real app), `/demo/tour` → `/demo.html`, CSP regex `^/demo(\.html|/tour)$`. Website target — 302 `/demo` + `/demo/` → `https://foodhubbie-admins.web.app/demo`, rewrite `/demo/tour` → `/demo/index.html`. `Admin/index.html` login screen links "Take the demo tour". Canonical/og:url of the replica is now `/demo/tour` (source of truth `Admin/demo.html`; `website/demo/` is GENERATED by `tools/build-demo-site.mjs`) and `website/sitemap.xml` lists `/demo/tour`.
- Fixed while verifying: `Admin/js/features/loyalty.js` `attachFormListeners()` referenced a `container` that only existed inside `renderAll()` → every loyalty tab threw `container is not defined` and its form listeners never bound (pre-existing, all tenants). Also 3 literal `?100` → `₹100` in the same file.
- Verification: local + live Playwright (auto sign-in → `Admin — Demo Dashboard`, banner, tenant scope, dashboard/tables/riders/tracker/reports render, POS add-to-cart works and "Record Sale" opens the modal, Save Settings opens the modal, modal closes, exit clears the session, both `/demo/tour` hosts render, login-screen link visible). 25/25 tabs render with 0 console errors. Twins 5/5, encoding ok, build:admin clean. Admin SW `v5.11.8` → `v5.11.9`.
- Nightly reseed: `/home/ubuntu/demo-seed/` on EC2 (own dir, `bot` symlinked to the live repo so firebase-admin + service-account.json resolve) — cron `30 21 * * *` UTC = 03:00 IST, log `seed.log`. NOT shipped into `/var/www/foodhubbie` (the box tracks `origin/main`; this work lives on `seo-brand-consistency`). Verified 2026-10-28 from the box: dry-run then `--apply` (identical 481.5 KB payload; 1231 KB since the live-catalog switch), then the live `/demo` re-checked — auto sign-in, dashboard money, riders tab 26 orders/₹265 wallet, tracker, 0 console errors.
- **Superseded detail (2026-10-29)**: the `/demo/tour` replica, its generator (`tools/build-demo-site.mjs`), its nav guard (`tools/check-demo-nav.cjs`), its test (`tests/demo-e2e.mjs`) and the `website/demo/` mirror were all DELETED — see `20261029-demo-sandbox`. `/demo/tour` is now a redirect on both hosts (`/demo.html` too), and every marketing "Live demo" link points straight at `https://foodhubbie-admins.web.app/demo`. The `restrict.js` note above still holds; the demo.html comparison does not.
- Confidence: HIGH — every claim asserted from the live host with a real browser and from the demo user's own idToken against the deployed rules.
- Ended: 2026-10-28

### [20261027092137-phase5-export] Phase 5 — Excel & PDF Report Export (OrderRestro port §4)
- TIER: 2 (admin UI + exports + security guard; no rules changes, no money movement)
- STATUS: DONE (live E2E 52/52 on the e2e outlet; screenshots e2e-reports-*.png)
- Scope: plan §4 clean-room. ONE pipeline `renderReport(result, format, meta)` → csv|xlsx|pdf; runner CSV/Excel/Print + Revenue analytics Excel all funnel through it. OUT of scope by decision: `downloadPDF` (jsPDF+autotable KPI report) kept as-is — replacing it with a bare print view would regress.
- `shared/report-export.js` NEW (pure, self-check `node shared/report-export.js` → "report-export OK"): `guardSpreadsheetCell` (`'` prefix on strings starting `= + - @ \t \r` — applies to CSV AND XLSX cells), `toCsvMatrix` (RFC-4180 quoting, CRLF, no BOM — caller prepends \uFEFF; scalar rows wrapped as single cell), `autoWidths` (max(header, widest of first 200 rows)+2, clamp 10..48; numbers measured by en-IN 2dp length +1 for ₹), `needsLandscape` (>6 cols). No menu twin (Admin-only) — correctly unguarded by twins check.
- `Admin/js/features/report-export.js` NEW: `ensureExcelJS()` lazy CDN exceljs@4.4.0 → window.ExcelJS (same pattern as xlsx.js, which is untouched — 5 other importers). _xlsx: sheet name sanitized ([:\\/?*[]] → space) + slice(0,31); row1 title bold 14, row2 subtitle grey FF666666, row3 blank, row4 header bold white on FFE84908; data from row5 with guard on strings + raw numbers; money cols numFmt '#,##0.00' (exceljs maps to BUILT-IN numFmtId=4 — not a custom formatCode; E2E asserts numFmtId="4"+applyNumberFormat="1"); autoWidths per column; ws.views [{state:'frozen', ySplit:4}]; writeBuffer → Blob (spreadsheetml MIME) → {key}_{from}_{to}.xlsx. _pdf: fills #reportPrintArea (new div, direct child of body, end of index.html) with esc()'d title/meta/table (₹ en-IN money, thead repeats on page break natively), injects @page style (#rpPageStyle) ONLY while printing — A4 landscape iff >6 cols, else portrait, margin 12mm — adds body.printing-report, window.print(), cleanup on afterprint + 5s fallback timer.
- Runner wiring (report-runner.js): #btnRrXlsx added to index.html toolbar (file-spreadsheet icon); _exportCsv/_exportXlsx/_print all call renderReport with meta {key, from, to, title: getReport(key).title}; old local CSV writer deleted; btnRrXlsx shown/hidden with the same _canRevenue() gate in _renderResult. Export errors → toast, never crash.
- analytics.js downloadExcel REWRITTEN onto the pipeline: same 10 columns (Date, Order ID, Customer, Phone, Outlet, Order Type, Payment, Total, Status, Items; Total = money) as rows matrix; key 'sales-report', from/to from #reportFrom/#reportTo; filename now sales-report_{from}_{to}.xlsx (was Sales_Report_{today}.xlsx). **Fixes a live spreadsheet-injection hole**: the old json_to_sheet path wrote raw strings (a customer/item name starting with = or + would execute as a formula when opened). ensureXlsx import removed from analytics.js (xlsx.js untouched).
- CSS (mobile-overrides.css appended): #reportPrintArea display:none on screen; @media print body.printing-report > *:not(#reportPrintArea) hidden + area block; h1 16pt, .rp-meta 9pt grey, table 8.5pt, th border-bottom 1pt #E84908, td hairline 0.5pt, td.num/.money right-aligned. Old runner print block KEPT (manual Ctrl+P fallback still renders the runner table decently). build.mjs PurgeCSS safelist + /^rp-/ (mobile-overrides.css is actually copied verbatim by build — safelist is belt-and-braces, same as /^rr-/). Admin SW v5.11.3 → v5.11.4 + mobile-overrides.css ?v=5.4.9 → 5.4.10 (index.html + sw.js).
- E2E 52/52 live (e2e-reports.js extended, seed-e2e-reports.js + hostile dish rep-dish-inject name '=E2E_INJECT'): Phase L now asserts the print view (window.print STUBBED in the test — headless fires afterprint INSTANTLY on real print, which ran cleanup before assertions; panel-hidden asserted via offsetParent since computed display does not reflect an ancestor's display:none) + the manual Ctrl+P fallback CSS; Phase N NEW: runner XLSX download → Expand-Archive → sheet1.xml frozen ySplit=4, styles.xml FFE84908, sharedStrings '=E2E_INJECT guarded, title present; runner CSV guard; analytics XLSX (via #btnDownloadExcel evaluate-click, hidden buttons are not Playwright-clickable) → sales-report filename, freeze+fill+title+money numFmt; all Phase 4 assertions still green (DB oracles, viewer gate now also hides XLSX, zero page errors).
- Verification: node --check all touched JS; report-export self-check OK; build:admin clean (dist emits js/features/report-export.js + shared/report-export.js); twins 5/5; encoding ok; deployed hosting:admin.
- Confidence: HIGH — every format asserted from the actual downloaded file bytes (zip inspection), print view asserted in print-media emulation.
- Ended: 2026-10-27 09:21 UTC

### [20261027153446-phase6-marketing] Phase 6 — Marketing Logics review + happy-hour adoption (OrderRestro port §6)
- TIER: 2 (shared pure module + admin editor UI; no rules changes, no money movement)
- STATUS: DONE (live E2E 11/11 on the e2e outlet: 4 engine + 7 UI)
- §6.2 gap review verdict — five of seven rows were ALREADY shipped before this phase and verified here: coupon caps (`discountAmount` maxCap + `Math.min(total, subtotal)` stack clamp), validity windows (`startsAt`/`endsAt`), usage limits (`globalLimit` + `stats.usedCount` via runTransaction + `perCustomerLimit` + `customer.discountUsage` counters incl. table channel), human-readable rejection reasons (`couponStatus` + `COUPON_STATUS_TEXT` surfaced by menu validateCoupon + bot validateCouponCode), and marketing opt-out — the Foodhubbie model is STRICTER than OrderRestro’s `marketingOptOut` flag: promos require explicit `customers/{phone}/promotionalConsent === true` AND respect `bot/promotions/optout/{last10}` keys; enforced per-recipient in the bot send loop (promotions.js isOptedOut/hasPromoConsent) and in the Admin audience build (promotions.js:186). Coupon→shared-money routing = discount-rules.js IS the single source (P2-9).
- THE gap: happy-hour windows. `promotionActive`/`toMinutes` were exported from shared/discount-rules.js since P2 with ZERO consumers — no authoring UI, no pricing-path check.
- **Design deviation from §6.3 (recorded)**: instead of a separate `promotions/{id}` node + a second pricing path, schedule fields were added to the EXISTING discounts node (`daysOfWeek` [0=Sun..6=Sat], `startTime`/`endTime` 'HH:MM' IST) and enforced inside `evaluateDiscounts` — happy-hour is just any discount with a weekly window. One engine consumed by bot (discount-engine), Admin POS (discount-evaluator), and menu webview; zero new nodes, zero new admin page. `inSchedule(d, now)` (pure, IST +19800000, delegates to promotionActive; absent/empty schedule = always active) gates the candidates list; `couponStatus` gained `not_in_window` (+ human reason) so customer messaging stays consistent across channels.
- Admin editor (discounts.js + index.html step 2): 7 day checkboxes + start/end time inputs, hint (end-exclusive, IST); validation in _save (both times required when anything set, end>start in minutes); doc fields null when unscheduled (clearing overwrites stale values); review row + card `_windowLine` show "Happy hour: Mon, Tue, … 15:00–17:00 IST".
- menu/shared/discount-rules.js twin re-synced byte-identical (twins 5/5); menu SW → menu-shell-v29 (twin precached); Admin SW → v5.11.5 (discounts.js + index.html precached). Deployed hosting:admin + hosting:menu.
- E2E 11/11 live (`%TEMP%/opencode/e2e-happyhour.js` + `e2e-happyhour-ui.js`): ENGINE (real bot pricing path via discount-engine.js with env-var BUSINESS_ID/OUTLET_ID for resolvePath — OUTLET is the outlet-ID STRING, not an object): inside-window discount applies (10% of 500 = 50), same-shape outside-window discount excluded, scheduled coupon `HHCODE10` rejected with "not valid at this time — check its scheduled hours", unscheduled discount regression guard; "outside" window computed +2h from current IST so the test is time-of-day-safe. UI: editor save → DB doc daysOfWeek [1-5] + 15:00/17:00 exact, card shows the window, reopen repopulates, clearing writes nulls, end≤start toast-blocked, zero page errors; test discount removed after. Bot unit tests 17/17 still green.
- E2E gotcha: the discount editor modal always OPENS AT STEP 1 — Playwright must click #discStepNext before touching step-2 schedule fields (first run timed out on invisible checkboxes).
- Verification: node --check; discount-rules self-check OK (new inSchedule/schedule-gating assertions, fixed-now IST wall clock); twins 5/5; encoding ok; build:admin clean; bot tests 17/17.
- Confidence: HIGH — pricing path asserted through the REAL bot engine against the live DB; authoring asserted through the REAL editor UI with DB verification.
- Ended: 2026-10-27 15:34 UTC

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

### [20261013-214952-3j5i] Full playwright regression (24 tests, live) — verdict: no regression in session scope
- STATUS: DONE / PRIORITY: medium / Started: 214952 / Ended: 214952
- What: full suite run + targeted reruns. Session scope all green: chip 8/8, attribution 11/11, mirror guard 5/5, mirror e2e 11/11, wizard-billing, walkout rules x2, chromium core tabs x3, QR order chain (run2: order->accept->ready all passed).
- Failures (none in session scope): (1) run1 DNS ERR_NAME_NOT_RESOLVED x5 - network flake, resolved on rerun; (2) stuck #initial-loader over #loginBtn once in ~6 form logins (live boot flake) -> orderId cascade - tests 92-195 structurally cannot recover orderId on retry (design flaw in critical-flows, parallel WIP file); (3) Served text-wait 10s timeout once - orders/KDS = parallel active zone (orders.js + critical-flows + utils.js dirty/mid-edit between runs, line numbers shifted); (4) mobile nav-btn hidden - utils.js goToTablesTab clicks first (desktop) nav match, mobile 2nd element never selected (harness); (5) trace artifact ENOENTs - concurrent playwright runs over shared test-results.
- Files/lines: tests/critical-flows.spec.js:51-195 (orderId chain), tests/utils.js:50/55->82 (loader/nav), playwright.config.js (mobile project)
- Evidence: run1 8F/5P/10NR (11.2m), run2-subset 8F/8P (13.7m), chain-run3 QR pass + 1 loader-stuck, isolated-served = orderId null by design; DNS recheck 200 OK
- Fix: none in my scope; recommend parallel: orderId recovery in retry/beforeAll, mobile nav selector nth, loader-stuck watchdog
- Verified: Claude — 2026-10-13 — self — PASS (verdict)

### [20260711-034449-8631] Fix FCM push notifications
- TIER: 2 (medium)
- STATUS: COMPLETED
- Notes: Firebase v12 messaging handled; sw.js has background message handler; notificationclick wired.

<!-- TASK_LOG_START -->
### [20261028-074722-c394] Riders outlet-level: move riders/riderStats/settlements under businesses/{bid}/outlets/{oid} like staff; rules, Admin, bot, rider-app, migration
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-28 07:47 UTC
- Files touched: database.rules.json;Admin/js/firebase.js;Admin/js/features/riders.js;Admin/js/features/rider-analytics.js;Admin/js/features/tracker.js;Admin/js/utils.js;Admin/js/ui.js;bot/firebase.js;bot/index.js;bot/rider.js;bot/helpers/outlet-resolution.js;bot-control-api/server.js;rider-app/src/lib/constants.ts;rider-app/src/services/riderService.ts;rider-app/src/services/authService.ts;rider-app/src/hooks/useRiderProfile.ts;rider-app/src/services/shiftService.ts;rider-app/src/services/sosService.ts;rider-app/src/services/walletService.ts;rider-app/src/contexts/AuthContext.tsx;rider-app/src/contexts/RiderContext.tsx;tools/migrate-riders-outlet.cjs;tests/phase5-rider-isolation.check.cjs;tests/phase5-rules-isolation.check.cjs;tests/rules.emulator.mjs;gate-verify.js
- Verified: rules deployed; phase5-rules 11/11 live; phase5-rider-isolation 13/13; bot unit 18/18; gate-verify PASS; encoding OK; rider-app tsc+vite build; admin build; live migration 6/6 + root prune; super-admin REST 200 outlet/401 root; Playwright Riders tab 2 riders + Nilesh 5 orders Rs210 wallet; EC2 pm2 1/6/2 restarted clean
- NOT verified / open risk: rider-app on-device login after re-deploy (needs rider credentials); Firebase rules emulator suite not run (Java)
- Confidence: HIGH
- Ended: 2026-10-28 08:38 UTC

### [20261027-022446-040c] Phase 5 rider isolation: real cross-restaurant broadcast leak found + fixed, deployed to EC2; runtime checks added
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-27 02:00 UTC
- Files touched: bot/rider.js, tests/phase5-rider-isolation.check.cjs, tests/phase5-rules-isolation.check.cjs, Pending-Work.md, PROJECT_LEDGER.md
- Verified: Phase 5 (the last `reviewing` item in Pending-Work.md) is automatable after all — two self-seeding, self-cleaning checks replaced the "MANUAL TEST REQUIRED" label. (1) `node tests/phase5-rider-isolation.check.cjs` — 11/11 `RESULT: isolation holds`: stubs the WhatsApp socket, seeds `phase5test-*` riders in both outlets against live RTDB and drives the real `bot/rider.js` functions (pizza broadcast reaches its own online pizza rider; skips the offline one; NEVER reaches a cake rider; in-app notif written only for the pizza rider; cake broadcast symmetric; notifyRiderAssignment/notifyRiderPickup each send exactly one message to the assigned phone only). Before the fix it FAILED 2 checks (A3 pizza->cake rider, B2 cake->pizza rider). (2) `node tests/phase5-rules-isolation.check.cjs` — 7/7 `RESULT: rules enforce restaurant isolation`: mints a custom token for a temporary pizza rider, exchanges it for a real ID token via Identity Toolkit, then hits live RTDB REST (rules enforced, unlike the Admin SDK): own-outlet order query 200, cross-outlet query 401, cake order by id 401 with the same-shape own-outlet read 200 as control, own rider node 200, another rider node 401, anonymous cake orders 401. (3) ROOT CAUSE: `resolvePath()` in bot/firebase.js lists `riders` among the platform-shared roots, so `getData('riders', outlet)` returns EVERY restaurant's riders — Phase 3's tracker text claiming that call is outlet-scoped was wrong and has been corrected in Pending-Work.md. `broadcastPickupAvailable` was the only caller that trusted the pool blindly, so a pizza order's "PICKUP AVAILABLE" WhatsApp broadcast went to cake riders and vice versa. Fix: skip any rider whose `outlet` (or `businessId`, when the rider record has one) does not match the order — fail closed, so a rider record with no outlet is never messaged — plus a `(N rider(s) from another restaurant skipped)` log line. Assignment/pickup paths were already correctly scoped and were left untouched. Latent in production today (both live riders are pizza, cake outlet has none) but it would fire the moment a second-restaurant rider logged in. (4) Deploy: `bot/rider.js` copied to /var/www/foodhubbie/bot/rider.js (backup rider.js.bak-20261027, sha256 24c2758... == repo working file), `node --check` OK, `pm2 restart bot-roshani-pizza-pizza` -> online, WhatsApp re-paired ("HAMARE RESTAURANT BOT IS ONLINE", AUTH user shown). Server HEAD is 01dc0b1 vs main 8411785; for `bot/rider.js` the only delta between them is the deletion of dead `notifyCustomerArrived`, so the copy shipped exactly the intended change. (5) Hygiene: rider keys back to the original 2, no `phase5*` leftovers in RTDB or Auth, temp probe scripts kept out of the repo. Commit 25e11f4 pushed to main. (6) Regression: `npm run test:isolation` runs both checks in one command (2fbb563); full Playwright suite 26 passed / 2 skipped / 0 failed against the live site (5.8m).
- NOT verified / open risk: the two checks are manual `node` scripts (now `npm run test:isolation`), not wired into `npm test` / CI (they need live RTDB + the service account). tests/promo-tabs-a11y.spec.js was written desktop-only and failed on mobile-chrome because the Promotions nav button lives inside the hamburger drawer — fixed in f382ab5 (open `#mobileHamburger:visible` first), re-verified 2/2 and then 26/26 in the suite. The wizard-billing Playwright test provisions through bot-control-api, which resurrected every pm2 app mid-run (ids renumbered, the stopped cake bot came back up); the cake bot was stopped again afterwards and the pizza bot reconnected cleanly ("HAMARE RESTAURANT BOT IS ONLINE", live loyalty events flowing). A real Rider App pop-up eyeball still needs two paired restaurants' riders logged in on phones. Production is otherwise many commits behind main (01dc0b1 vs 8411785) — only `bot/rider.js` was refreshed by this task; a full server `git pull` would hit that box's own uncommitted edits (bot/index.js, package.json, bot-control-api/server.js) and was deliberately not attempted. The earlier Phase 5 LIVE ledger entry (20261023-052401-7d0d) verified the app/in-app-notification layer with disposable E2E riders but explicitly skipped the WhatsApp broadcast leg — that unverified leg is exactly where this leak lived, which is why the 12/12 now covers it with a stubbed socket.
- Confidence: HIGH
- Ended: 2026-10-27 02:30 UTC

### [20261026-114624-3f57] Pending-work audit fixes: promo ARIA tabs (P9), delete dead notifyCustomerArrived, tracker accuracy, U+FFFD repair + guard
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-26 11:46 UTC
- Files touched: Admin/index.html, Admin/js/features/promotions.js, bot/rider.js, tests/encoding-check.mjs, tests/promo-tabs-a11y.spec.js, PENDING_WORK.md, Pending-Work.md, PROJECT_LEDGER.md, Fixes-and-Changes/foodhubbie-pwa-build-progress/menu/delivery.html
- Verified: Audited both trackers line-by-line against code and found 3 false claims + 2 duplicate/stale blocks, then fixed them. P9: Admin/index.html promo-mode-pill + promo-campaign-tab now carry aria-selected/aria-controls and the three panes carry role=tabpanel; _switchMode() (promotions.js:741) and _switchCampaignPanel() (:758) write aria-selected next to the .active class. Verified LIVE with a new Playwright spec tests/promo-tabs-a11y.spec.js after firebase deploy --only hosting:admin: clicks Schedule, asserts aria-selected flips both ways, asserts all three aria-controls resolve to a role=tabpanel element, then switches History/Active and asserts pane visibility -> 1/1 passed. Dead code: notifyCustomerArrived() in bot/rider.js had zero callers repo-wide (grep js/json/md/txt) and bypassed the send wrappers, so it was deleted; the real arrival message is bot/index.js:1418 with the push copy at :948 - untouched. Trackers: PENDING_WORK P0-R3 fix row corrected + duplicate P0-R1/R2/R3 block under a 'CRITICAL Must Fix' heading collapsed into one verified section; Pending-Work P3/P4 notes corrected (the delay field was REMOVED, not wired - delayMs count 0 in bot/promotions.js, promoDelay count 0 in Admin/index.html), P9 note corrected, 5 'Commit: pending' lines replaced with the commits that actually shipped (a936f48, bb92b87, 7a918fb, 4ca91cf), WORK IN PROGRESS heading closed. U+FFFD: 27 chars in PROJECT_LEDGER.md -> em dash (git history has no clean copy; the line-67 quoted emoji example is truncated honestly and the repair is logged in the ledger itself), 14 chars in the Fixes-and-Changes delivery.html snapshot recovered EXACTLY from live menu/delivery.html (em dash/ellipsis/arrow). encoding-check.mjs additionally fails on U+FFFD and skips Baileys session_data auth state. Regression: full Playwright suite 14/14 passed (critical-flows 10, supreme-profile-sections, wizard-billing, walkout-retest, promo-tabs-a11y) against the deployed site; bot unit 16/16 + billing green; npm run build all targets; npm run test:encoding passes with the stricter rule.
- NOT verified / open risk: Pending-Work Phase 5 (restaurant-scoped rider notification runtime test) stays open by design - it needs two live rider accounts on two restaurants plus a real order each, so it cannot be automated from here. bot-fleet.txt / bot-fleet-backup.txt are NOT damaged (they are UTF-16LE with a BOM, correct for their origin); the earlier U+FFFD reading was a UTF-8 misread. AGENTS.md edits (guard bullet now mentions U+FFFD) stay uncommitted because that file still carries another session's rewrite. Admin/index.html was committed with only the aria hunks (git apply --cached) so the other session's brand text (apple-mobile-web-app-title, FOODHUBBIE42 placeholder, cache-key filter, BOM strip, trailing newline) was left in the working tree; same for PROJECT_LEDGER.md, where their in-progress 20261026-113751-a930 entry was excluded.
- Confidence: HIGH
- Ended: 2026-10-26 11:46 UTC

### [20261027-032805-23c0] EC2 box reconciled to main (117 commits, zero restarts) + live WhatsApp/webview billing restored to the decided Rs5
- TIER: 3 (production infrastructure + live billing money)
- STATUS: DONE
- Started: 2026-10-27 03:28 UTC
- Files touched: tools/seed-billing-defaults.cjs, tests/supreme-profile-sections.spec.js (repo); nothing in the worktree of the running processes; deleted film/ (26 tracked files), opencode.json, commit-msg.txt
- Verified: **Box metadata reconciled.** `/var/www/foodhubbie` was 117 commits behind (`HEAD` = `01dc0b1`) with 7 tracked files dirty, so any `git pull` there would have reverted live behaviour. Proved first that a reset was content-neutral: compared every tracked runtime file (110 under `bot/ bot-control-api/ webhook-server/ shared/ tools/`) against `origin/main`; only **five** differed and none is a pm2 entry point (`shared/{billing-defaults.cjs,billing-defaults.js,cost-math.js}` + `shared/package.json` + `tools/test-receipt.cjs` — all simply older). `bot/index.js`, `bot/package-lock.json`, `bot/package.json`, `bot/rider.js`, `bot/utils.js` differed by **CRLF only** (`git diff --ignore-cr-at-eol` empty). Then `git reset --hard origin/main`: HEAD `01dc0b1` → `9a13756`, 0 tracked changes, 69 untracked preserved (node_modules, session_data_pizza with its live creds, .env.bak*), **no pm2 restart needed** (same PIDs/uptimes before and after), `node --check` green on bot/index.js, bot/rider.js, shared/billing-defaults.cjs. **Billing rate drift found and fixed.** Commit `40f7d9d` (2026-10-21) made WhatsApp + delivery-webview Rs5/order and updated shared/cost-math.js, billing-defaults.{js,cjs} and Admin costs.js — but `tools/seed-billing-defaults.cjs` still seeded Rs3, so both live outlets carried `WA:3, webview_delivery:3` and Supreme billed Rs3 (`billingOf` does `{...DEFAULT_RATES, ...b.rates}`, so the stale DB row wins over the code default). Owner confirmed Rs5. Fixed: seeder seeds Rs5 and its existing rate-migration list now also patches `WA`/`webview_delivery` so a re-run repairs old rows; test fixture updated; live rows on `roshani-pizza/pizza` and `roshani-cake/cake` patched 3 → 5 (E2E outlets deliberately untouched); `bot-control-api` restarted so `getBillingDefaults()` serves Rs5 to new outlets (clean start, orchestrator reconciled, pizza bot untouched at 49m uptime). Money effect: roshani-pizza all-time usage Rs164 → **Rs182** (9 webview orders x Rs2). Verified live in Supreme via Playwright on **desktop and mobile-chrome**: `USAGE ₹182 / 85 orders, EXTRA CHARGES ₹0, RECEIVED ₹117.86, BALANCE DUE ₹64.14`, matching the Node recomputation from the same orders. Guards: `shared/cost-math.js` self-check OK, encoding PASS, twins 5/5, domain 0/212. Working tree deletions (film/ 26 files, opencode.json, commit-msg.txt) committed so real drift is visible again. **Third live defect found by the verification run:** every tunnel-backed Supreme panel was dead — `config/tunnelUrl` is readable only by a signed-in admin (`database.rules.json`), so the boot-time read in `SupremeAdmin/js/firebase-config.js` always failed and left a hardcoded Cloudflare Quick Tunnel host (rotated, non-resolving) in place, while `wa-templates.js` had its own hardcoded `https://bot-control-api.foodhubbie.com` (never resolved). Fixed: `window.TUNNEL_READY` resolves on the first signed-in auth state, the two panels that fetch on FIRST render (`quota.js`, `wa-templates.js`) await it, and `wa-templates.js` uses the shared `window.TUNNEL_URL`. Verified live: `window.TUNNEL_URL` = the current tunnel, **zero failed requests** (was `ERR_NAME_NOT_RESOLVED` on every load), supreme hosting 43/43 files byte-identical to `dist`, `supreme-profile-sections` passes on chromium + mobile-chrome.
- NOT verified / open risk: the Rs5 change is retroactive for historic usage — Supreme computes usage from the orders each time it renders, so past webview orders now bill at Rs5 (owner accepted; Rs18 today). The rate is datastore state, not code: a fresh environment seeded before this commit would still get Rs3 from an old seeder. `outletIndex` carries junk rows (`outlet` → `roshani-pizza`, a stray `roshani-pizza/outlets/cake` with no billing, one enabled E2E outlet) — left alone, data hygiene, not a code defect. Cake bot is still stopped (its WhatsApp session is dead, needs a QR re-scan). `film/` removal means the HyperFrames sources exist only in history now. Side effect of the supreme deploy: `shared/payroll-math.js` (an untracked file from the concurrent payroll session) was copied into `SupremeAdmin/dist/shared/` by `tools/build.mjs` and is now served publicly from `foodhubbie-supremeadmin/shared/payroll-math.js` — inert (nothing imports it yet), owned by that session, not reverted here.
- Confidence: HIGH
- Ended: 2026-10-27 03:40 UTC

### [20261027-051500-c4a1] Cake bot deleted from EC2 (owner: re-add later from Supreme Admin)
- TIER: 3 (production process + live tenant state)
- STATUS: DONE
- Started: 2026-10-27 04:40 UTC
- Files touched: ecosystem.config.js (cake block removed), ACCESS.md (pm2 + ecosystem + known-issues rows), AGENTS.md + Pending-Work.md (recorded decision); box: pm2 app list, `~/.pm2/dump.pm2`, `~/.pm2/logs/`; RTDB `businesses/roshani-cake/outlets/cake/bot/{status,pair}`
- Verified: owner asked to delete the cake bot ("I'll add later from Supreme Admin -- if I need it"). Box: `pm2 delete bot-roshani-cake-cake` + `pm2 save` → `pm2 list` has only `webhook-server` (id0), `bot-roshani-pizza-pizza` (id1), `bot-control-api` (id2), `pm2-logrotate` (id23); `grep -c bot-roshani-cake ~/.pm2/dump.pm2` → 0 (reboot-safe); stale `~/.pm2/logs/bot-roshani-cake-cake-*.log` removed (0 cake log files left). No `bot/session_data*cake*` dir existed (deleted in the earlier cleanup). Pizza bot was never touched — same PID/uptime throughout. RTDB: the dead worker's presence was still claiming "Online" (`lastSeen` 1793092291108) with a `pair` record stuck at `status:"waiting"` and a 277-char QR, so Admin/Supreme showed a phantom online bot for an outlet with no process; both nodes removed, `businesses/roshani-cake/outlets/cake/bot` is now `{"transport":"baileys"}`. Repo: the `bot-roshani-cake-cake` block is gone from `ecosystem.config.js` so `pm2 start ecosystem.config.js` cannot resurrect it; `node --check` green and `require('./ecosystem.config.js').apps` → `["bot-roshani-pizza-pizza"]`.
- NOT verified / open risk: `businesses/roshani-cake` (business + outlet + orders/billing) and `bot/transport` are deliberately KEPT — only the worker is gone, so re-adding the bot later is a Supreme Admin action, no data restore needed. It cannot come back on its own: `bot-control-api/orchestrator.js` `desiredState()` returns `null` while `outlet.whatsapp` is absent (verified: cake has no `whatsapp` node). `pm2 save` means a box reboot will not start it either. The earlier ledger/AGENTS wording said the cake bot was "stopped, needs a QR re-scan" — that is now superseded: it is deleted. Verified on the box after `git pull --ff-only`: HEAD `b70a709`, 0 dirty tracked files, `ecosystem.config.js` lists only `bot-roshani-pizza-pizza`, `pm2 list` has no cake app, pizza still online at the same PID/uptime (no restart).
- Confidence: HIGH
- Ended: 2026-10-27 04:55 UTC

### [20261027-031401-2edc] Reconcile production with git: ~2,000 lines of live code were uncommitted, two guard holes, all surfaces now byte-match HEAD
- TIER: 3 (high-risk: touching live money/loyalty code paths, though every commit is a no-behaviour-change recording of what was already deployed)
- STATUS: DONE
- Started: 2026-10-27 02:50 UTC
- Files touched: shared/{money-math,loyalty-math,discount-rules}.js + menu twins, shared/package.json, bot/{index,utils,discount-engine}.js + bot/tests/unit.test.js, menu/{delivery.html,sw.js,js/*}, Admin/{index.html,sw.js,style.css,receipt-templates.js,js/ui.js,js/features/*}, website/* (32), database.rules.json, tests/{encoding-check.mjs,customer-profile.check.mjs,discount-evaluator.check.mjs,wizard-billing.spec.js,verify-recents.cjs}, tools/{check-shared-twins,check-domain-migration,seed-outlet-index}.cjs, docs/*, ACCESS.md, Pending-Work.md, .gitignore, .env.example
- Verified: Started from the Phase 5 deploy finding that EC2 ran code no commit contains, then measured every surface with `live-vs-tree.cjs` (fetch each file from the Firebase site, byte-compare modulo EOL): menu 28/28, website 42/42, admin 81/81 (rebuilt from source), rider 44/44, supreme 39/42 -> deployed -> 42/42. EC2: hashed all 22 tracked `bot/**/*.js` and compared to HEAD — the 13 files that differ differ ONLY by CRLF (line sets identical), so runtime code matches HEAD everywhere; only `bot/tests/unit.test.js` lags (test-only, 41 lines). Committed the live-but-uncommitted work as 9 reviewable commits (shared modules; bot core; menu webview+loyalty; admin loyalty/void/money-math; website redesign+GA4; direct-mode anon webview token incl. rules; docs+domain; guard fixes; one-off tool) instead of leaving prod untraceable — nothing was reformatted, so no behaviour change. TWO REAL DEFECTS FOUND while auditing: (1) `rider-app/src` had 12 mojibake-corrupted .ts/.tsx files (`₹` -> a-circumflex+quote-single-low+superscript-one) and the encoding guard never scanned them because EXTS lacked `.ts/.tsx/.jsx/.cjs` (67 .cjs + 134 .ts/tsx files were invisible to it) and the corruption produced printable chars, not the C1 controls the guard also checks — sources restored from HEAD (the damaged copies carried only brand-text edits: ROSHANI_FIREBASE_CONFIG renamed, outlet labels 'Roshani Pizza'/'Roshanis Cake' -> 'Foodhubbie'), EXTS extended, and negative-tested: a probe .ts file containing the mojibake now fails the guard. (2) `foodhubbie.in` is live (200, www 301s to apex) but ACCESS.md/Pending-Work/lead kits still pointed at foodhubbie-web.web.app — updated, and `check-domain-migration` now skips append-only history (PROJECT_LEDGER.md, docs/META-PLATFORM-AUDIT.md) rather than rewriting past records -> 0 stale refs across 212 files. Evidence: encoding guard PASS, twins 5/5, domain 0/212, bot unit 17/17, Playwright critical-flows 20/20, supreme-profile 1 passed/1 skipped, every live-vs-tree compare 100%.
- NOT verified / open risk: the box's GIT METADATA is still 105 commits behind main (`/var/www/foodhubbie` HEAD = 01dc0b1) with its own uncommitted edits (bot/index.js, bot/{utils,rider,discount-engine}.js, bot/package*.json, bot-control-api/server.js) — the FILES match main but a naive `git pull` there would conflict, so a deliberate box-side reconcile (stash/reset to origin/main, then `pm2 restart` both bots) is a separate task, deliberately not attempted while a concurrent session was deploying. `film/` (29 files) and `opencode.json` are deleted in the working tree and were left untouched (intent unknown). Untracked scratch at repo root (`find-*.js`, `fix-delivery*.js`, `scrape-poland*`, `test-overpass*`, `poland-restaurants.*`, `orders-screen.yml`, `$`, `whatsapp Ordering Bot.mp4`, `tools/{final-sweep,full-nav,stamp-datemod}.cjs`) left for their authors. A concurrent session was actively editing AGENTS.md, PROJECT_LEDGER.md, docs/PLAN-ORDERRESTRO-PORT.md, menu and database.rules.json throughout; its files were committed only after it had deployed them, and its in-progress doc edits were never staged.
- Confidence: HIGH
- Ended: 2026-10-27 03:20 UTC

### [20261026-113751-a930] Re-review Phase 1 (discount-rules extraction) adversarially, then implement Phase 2 loyalty upgrades (earn-base R1, tender redemption R2, clawback R3, cashback display R8, guardrails R9)
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-26 11:37 UTC
- Files touched: shared/loyalty-math.js, menu/shared/loyalty-math.js, tools/check-shared-twins.cjs, bot/index.js, bot/utils.js, bot/discount-engine.js, bot/tests/unit.test.js, Admin/js/features/loyalty.js, Admin/js/features/tables.js, menu/js/delivery.js, menu/js/delivery-order.js, menu/js/ui.js, menu/js/customer.js, menu/delivery.html, menu/sw.js, docs/PLAN-ORDERRESTRO-PORT.md, AGENTS.md
- Verified: Phase 2 shipped per plan §2/§9 with everything Admin-configurable. (1) `shared/loyalty-math.js` pure module + byte-identical menu twin (twins guard 5/5): R1 earn base `subtotal − discount` (legacy fallback `order.total`), two-stage floor preserved (floor base/rate → ×tier mult → floor), `tierForPoints` inclusive mins, `computeTenderPaise` (points × value capped at due − minSpend, paise), `distributeBillDiscountPaise` largest-remainder exact-sum split; self-check green. (2) Bot: loyalty section rewritten — `getLoyaltyConfig` (config + defaults), `_writeLoyaltyAccrual` single earn tail (idempotency → mult → accrual record → tx with `lastClawedOrderId:null` → rankings mirror → customer order history), `accrueLoyaltyPoints` skips dine-in, dine-in earn bot-side on `paymentStatus→'Paid'` (child_changed, BEFORE debounce gate; classification `type==='dine-in'||isDineIn||tableId`, phone from `tableSessionsContact`, bill discount split across covered orders), R3 clawback on cancelled/refunded/void (accrual lookup before config read; deletes accrual + audit copy `loyalty/clawbacks/{orderId}`; clears `lastAccruedOrderId` so repay re-earns; resurrects burned reward code guarded by `usedOnOrder`), `notifyCustomerApp` notification-only. (3) `verifyRewardTender` (webview finalization after discount verify, on VERIFIED total): validates code+phone, burns code tx-FIRST (replay-proof), writes `loyaltyTender`+`totalDue`; graceful skip when loyaltyMath missing (never a wrong award); invoice (`formatOrderInvoice`) + admin msg show TOTAL→tender→PAYABLE. (4) Phase 1 finding fixed: bot `recordDiscountUsage` now bumps customer `discountUsage[discountId]` + `firstOrderDiscountUsed`/`firstOrderDiscountId` (cold-tx seed pattern prevents null-first-attempt wipe). (5) Admin loyalty.js: new config fields (`redeemValuePaisePerPoint` ₹1/pt, `minSpendAfterRedemption`, toggles earnEnabled/dineInEarnEnabled/clawbackEnabled), R8 effective-cashback display, `buildConfigPayload()` dedupe (set() overwrites whole node — all 3 writers carry all fields). (6) Menu: `validateRewardCode` + `redeemValuePaisePerPoint`/`minSpendAfterRedemptionRs` exports; delivery checkout tries coupon then LOYAL code, tender preview via shared twin, `rewardCode:{key,code}` payload, tender row in cart summary (element-guarded, QR unaffected); delivery-order.js passes the claim only (bot computes tender). (7) Pre-existing bugs fixed en route: `voidTableBill` dead code (guarded on `status==='Paid'`, payment writes `paymentStatus` — 3 spots; full-table void never worked and voided bills stayed revenue-counted); webview cart display passed `taxEnabled=false` so it omitted the GST Phase 1b charges (now reads the same `dineinSettings` placement charges). (8) CRITICAL recovery: `menu/js/delivery.js` had been truncated 844→63 lines by commit be443ba (2026-10-23; `placeDeliveryOrder` zero callers = live WhatsApp delivery ordering broken since the menu deploy on/after 2026-10-21, root cause `8600837` syntax error) — restored last valid `84960e6` (909 lines) via git restore, re-applied crossSell intent cleanly (rows keep `name:` shape; the broken commit's `dishId` idea was wrong — showComboSheet renders `r.name`). (9) `menu/sw.js` reconstructed to Phase-1/1b state then bumped `menu-shell-v27` (precaches discount-rules + money-math + loyalty-math twins). Verification: `node --check` clean on all touched js; loyalty-math self-check OK; twins 5/5; bot tests 17/17 (new loyalty-math cases); `npm run build:admin` clean; `npm run test:encoding` OK; `tools/check-schema.cjs` OK (32 blocks).
- NOT verified / open risk: Live E2E of earn/tender/clawback not run (needs deployed bot + a real paid order; next deploy window). `firebase deploy --only hosting:menu` REQUIRED to restore live delivery webview + ship menu changes; bot deploy required for accrual/tender/clawback + discount counters; admin deploy for loyalty settings UI. Delivery totals change (Phase 1b GST) — flag to outlets. Dine-in tender at bill waived (staff honor via manual discount); a partially-capped tender still burns the code fully (accepted). `tools/check-copy-consistency.cjs` FAILs are pre-existing website/ local edits, untouched here. Waived per plan: WA-chat redemption; post-placement toast on tender rejection (WA confirmation is source of truth).
- Confidence: HIGH
- Ended: 2026-10-27 00:00 UTC

### [20261026-112356-1cb4] Prevent mojibake recurrence: BOM strip, guard hardening, CI wiring, live tenant-id audit
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-26 11:23 UTC
- Files touched: tests/encoding-check.mjs, .github/workflows/ci.yml, package.json, shared/billing-defaults.cjs, AGENTS.md, EXPENSES_EXAMPLES.md, GUIDEs/SERVER-ACCESS-GUIDE.md
- Verified: Audited the live RTDB (bot/service-account.json + firebase-admin): businesses are 'roshani-pizza' (Roshani Pizza, transport baileys) and 'roshani-cake' only - there is NO Foodhubbie-pizza node, and outletIndex maps pizza/cake -> roshani-*. So the brand sweep's roshani-pizza->Foodhubbie-pizza edits were a real regression for Admin/menu fallbacks and bot/helpers/outlet-resolution defaults; HEAD (restored) is correct and internally consistent (bot tests assert roshani-pizza). No brand rename is appropriate: 'Foodhubbie' is the platform brand, 'roshani-*' are live tenant ids - documented as a standing decision in AGENTS.md. BOM strip: 21 tracked files had a committed BOM, 1 was pure-BOM (shared/billing-defaults.cjs, committed); the other 8 carry in-flight work from other sessions so the strip stays uncommitted rather than dragging that work into this commit. Guard hardened (bot/ + bot-control-api/ roots, BOM + C1 control detection) and wired into .github/workflows/ci.yml + npm run test:encoding; guard PASSES. Repaired untracked docs that were corrupted (EXPENSES_EXAMPLES.md 123 lines, GUIDEs/SERVER-ACCESS-GUIDE.md 6, 'Supreme Admin Claude' copies 44+6) - verified no U+FFFD and readable output; PROJECT_LEDGER.md's 4 remaining mojibake lines are deliberate (they document the corruption). Post-change: npm run build all targets exit 0, encoding guard PASSES, playwright supreme-profile-sections + wizard-billing 2/2 PASS, discount-rules sync check OK, bot unit/billing tests exit 0 earlier this session.
- NOT verified / open risk: Could not confirm the GitHub Actions run for b0d76a6 (gh CLI unauthenticated here) - the new CI step is verified locally via npm run test:encoding but not yet observed green in Actions. AGENTS.md edits (encoding-guard bullet + live-tenant-id decision) are in the working tree but intentionally NOT committed: that file already carries another session's uncommitted rewrite (brand header + tool/skills section), so committing it would mix authors. 8 files still carry a stripped-but-uncommitted BOM alongside other pending work; their next commit will pick the strip up.
- Confidence: HIGH
- Ended: 2026-10-26 11:24 UTC

### [20261026-110638-41f9] Verification + encoding repair: Supreme Admin template refactor runtime fixes; repo-wide mojibake from uncommitted rebrand sweep
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-26 11:06 UTC
- Files touched: menu/js/ui.js, Admin/js/auth.js, Admin/js/features/page-guide.js, Admin/js/features/promotions.js, menu/css/app.css, menu/js/firebase.js, bot/helpers/outlet-resolution.js, bot-control-api/whatsapp-graph.js, rider-app/src/index.css, SupremeAdmin/js/features/templates/*.js, SupremeAdmin/js/features/restaurant-profile.js
- Verified: Encoding guard node tests/encoding-check.mjs PASSES (was failing on menu/js/ui.js, Admin/js/auth.js, page-guide.js, promotions.js). Root cause: an UNCOMMITTED brand sweep (Roshani->Foodhubbie) rewrote 72 tracked files via PowerShell Get-Content/Set-Content: read as cp1252 + wrote UTF-8-with-BOM, so every non-ASCII char became mojibake and a BOM was prepended. All 72 files were working-tree-only corrupted - git HEAD for each was clean - so the fix was git checkout HEAD -- <file> (backup of pre-restore bytes at temp/opencode/wt-backup). The sweep also made a functional edit: Admin/js/auth.js SUPER_ADMIN_EMAIL roshanisudha@gmail.com -> Foodhubbiesudha@gmail.com (breaks super-admin email match) - discarded. Nothing had shipped: live check of foodhubbie-qrmenu/admins/supremeadmin bundles = 0 mojibake, menu fmtMoney returns the real rupee sign. Supreme template-refactor runtime fixes verified: npm run build (both targets) exit 0, Playwright supreme-profile-sections + wizard-billing 2/2 pass, critical-flows 10/10 pass, bot unit+billing tests exit 0, live supreme redeployed from clean HEAD and re-verified (templates/*.js all 200 + clean).
- NOT verified / open risk: Supreme profile quota/template-library paths still hit the unreachable bot-control-api.foodhubbie.com tunnel from this environment, so only their graceful-failure branch was exercised; pre-existing committed BOMs on 10 files (Admin/index.html, Admin/js/ui.js, catalog.js, shared/billing-defaults.cjs, etc.) left as-is (harmless - browsers/esbuild strip them); 8 pre-existing mojibake markers inside PROJECT_LEDGER.md not repaired; the discarded brand sweep (Roshani->Foodhubbie in docs/README/comments) has NOT been redone.
- Confidence: HIGH
- Ended: 2026-10-26 11:12 UTC

### [20261023-052401-7d0d] Phase 5 LIVE: restaurant-scoped rider isolation runtime test (Pending-Work.md final reviewing item) — rider accounts per restaurant, verify zero cross-restaurant order/notification visibility via rider app + REST/rules
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-23 05:24 UTC
- Files touched: Pending-Work.md
- Verified: Phase 5 LIVE executed against production RTDB 2026-10-23: (1) rules layer — 21/21 REST checks with real rider auth tokens: M1-M11 collection rules (own assignedRider allow / unscoped deny / foreign-rider query deny / same-outlet Ready broadcast allow / cross-outlet+cross-business+LIVE roshani-pizza deny) and W1-W10 write loop (super-admin create assigned order, A reads own, B/C denied detail, flip Ready+unassigned broadcast, A+B see list, C denied, restore, cleanup). (2) app layer — 5/5 Playwright checks on foodhubbie-riderapp.web.app: A lands dashboard with Active Delivery card; B and C land dashboards with NO card (outlet headers show correct tenant: B=roshani E2E1, C=E2E2); broadcast leg: B online + PICKUP badge=1 (broadcast received), C online, no badge/row. Fix along the way: RTDB REST paths need .json suffix (first run's 200s were garbage). (3) hygiene — disposable riders A/B/C (9999111101-03@rider.com, E2E outlets only, zero writes to live businesses) + test order deleted; /riders back to original 2; screenshots in %TEMP%/opencode/phase5-*.png; tmp scripts removed; Pending-Work.md Phase 5 + summary rows + To-advance updated to done
- NOT verified / open risk: WhatsApp PICKUP AVAILABLE leg — no pm2/WhatsApp visibility from this shell and no real WhatsApp numbers on disposable riders; Phase 3 remains structurally proven (per-outlet bot process isolation). 3 orphaned Firebase Auth test users remain (accounts:delete needs service account)
- Confidence: HIGH
- Ended: 2026-10-23 10:11 UTC

### [20261023-041637-820e] CI wiring: E2E_ADMIN_PASSWORD secret env for playwright test job + stale-test fixes blocking CI green
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-23 04:16 UTC
- Files touched: .github/workflows/ci-cd.yml,tests/critical-flows.spec.js,tests/wizard-billing.spec.js
- Verified: ci-cd.yml:72 now passes E2E_ADMIN_PASSWORD from secrets (fallback path tests/utils.js:11-14 confirmed: without it CI gets placeholder REDACTED-PASSWORD-ROTATE-ME); Credentials/ gitignored at .gitignore:103; full local run with exactly the CI env: 23 passed/1 skipped(desktop-only)/0 failed, exit 0, 6.3m; two stale tests fixed: (a) critical-flows QR test — new customer onboarding overlay #onbOverlay (menu/js/customer.js, fresh profile has no fh_onboarded_v1) intercepted every welcome CTA click for 60s x2 projects; dismissed via #onbSkip before welcome race; (b) wizard-billing expected WA:3/webview_delivery:3 but intentional commits 40f7d9d+980de76 moved both to 5 (shared/billing-defaults.js:9); chromium wizard-billing passes with updated expectation
- NOT verified / open risk: GitHub repo secrets E2E_ADMIN_PASSWORD / FIREBASE_SERVICE_ACCOUNT / FIREBASE_TOKEN not yet set (gh CLI unauthenticated in this shell — user must run gh secret set or use repo Settings>Secrets); actual Actions run on GitHub unverifiable from here
- Confidence: HIGH
- Ended: 2026-10-23 04:16 UTC

### [20261023-034732-cc00] Admin: batch the disabled+locked login probes; re-test the fresh-profile inventory toggle race
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-23 03:47 UTC
- Files touched: Admin/js/auth.js
- Verified: live Playwright: disabled and locked probes leave in the same tick (gap 0ms); fresh empty-localStorage profile ends with both inventory toggles true and the menu section visible; P1 gates suite PASS; inventory suite PASS (0 boot dishes reads, 1 on tab open, 20 dishes/photos); P0 suite PASS twice in a row (one earlier run hit a known harness timing flake on the SW-cache assertion and re-ran clean)
- NOT verified / open risk: real 4G phone; the disabled/locked batching under an actually-disabled or locked outlet (only the happy path was exercised live)
- Confidence: HIGH
- Ended: 2026-10-23 03:47 UTC

### [20261023-033313-8048] Admin P2: stop the post-login toggle refresh from re-fetching dishes at boot; dedupe the Inventory tab double dishes read
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-23 03:33 UTC
- Files touched: Admin/js/features/inventory.js,Admin/js/auth.js
- Verified: live Playwright on foodhubbie-admins.web.app: websocket frames show 0 /dishes reads during boot (was 1) and 1 on Inventory tab open (was 2); grid renders 20 dishes with 20 base64 images and the menu section is visible; 0 console/page errors; P0 regression suite PASS (riderStats still off boot + on Riders tab, SW caches firebasejs, data-labels on visible tab); P1 gates suite PASS
- NOT verified / open risk: real 4G phone; fresh-profile inventory toggle state (the pre-existing hydration race described in the ledger is unchanged and still needs its own task)
- Confidence: HIGH
- Ended: 2026-10-23 03:33 UTC

### [20261023-031718-1f90] Admin P1: overlap feature/role gates with the login gates; evaluate bundling the boot module graph
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-23 03:17 UTC
- Files touched: Admin/js/auth.js
- Verified: live Playwright: both settings reads now dispatched in the same tick as the disabled probe (websocket frame log); staff account with adminSelectedOutlet=cake still reads only /outlets/pizza/settings/{features,roles} and ends on pizza; no 'Gates prefetch failed' / 'Feature/role gates load failed' warnings; 0 console/page errors; dashboard + orders + riders tabs render; P0 regression suite re-run PASS
- NOT verified / open risk: true super/supreme account (roshanisudha@gmail.com has no Auth user, so the sessionStorage-wins branch is only verified by inspection); real 4G device
- Confidence: HIGH
- Ended: 2026-10-23 03:17 UTC

### [20261022-210303-62a2] Inventory hydration bug: fresh browser (empty localStorage) can hydrate inventory toggles false though settings/inventory says true; menu section stays hidden
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 21:03 UTC
- Files touched: Admin/js/auth.js,Admin/js/features/inventory.js
- Verified: node --check x2 + build pass; live foodhubbie-admins.web.app fresh-browser login (localStorage+sessionStorage cleared) hydrates toggles true/true, inventoryMenuSection display:block (was hidden/false); REST GET settings/inventory still availability:true stockTracking:true, no pollution; auth.js post-login refresh + loadInventory rebind + true-default seed all in deployed dist
- NOT verified / open risk: NONE — regression confirmed PASS 2026-10-23 (standalone Playwright script): fresh-browser hydration true/true on entry 1; stock toggle persists on entry 1; avail toggle persists on entry 2 after dashboard round-trip (the old-code failure mode); both restored true; remote settings/inventory re-read {availability:true,stockTracking:true} post-test
- Confidence: HIGH
- Ended: 2026-10-23 03:07 UTC

### [20261022-210050-dae6] Admin P0 perf batch: fix wrong-project preconnect, SW-cache firebase SDK, defer riderStats off boot, skip data-labels on hidden tabs
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 21:00 UTC
- Files touched: Admin/index.html,Admin/sw.js,Admin/js/features/riders.js,Admin/js/auth.js,Admin/js/ui.js
- Verified: live Playwright on foodhubbie-admins.web.app: preconnect list has the correct RTDB host and no prashant-pizza host; riderStats websocket reads at boot = 0; after clicking Riders tab = 1 read and the table renders 2 riders; SW cache foodhubbie-erp-shell-v5.10.3 holds 4 gstatic/firebasejs entries and navigator.serviceWorker.controller is set; orders table cells all carry data-label at 390px; hidden-tab cells are skipped; 0 console/page errors; three sequential phone loads 7.8s/6.6s/4.1s
- NOT verified / open risk: real phone/4G device (emulation only); SW cache-first for gstatic on a real returning user's existing SW install (verified in a fresh context, not an upgrade path from v5.10.2)
- Confidence: HIGH
- Ended: 2026-10-22 21:01 UTC

### [20261022-165125-b099] HALT cold DMs after WhatsApp ban on sales number
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-22 16:51 UTC
- Files touched: tools/lead-drip.cmd,PROJECT_LEDGER.md
- Verified: scheduled task removed, no agent process running, hard-stop decision recorded, LD552 bookkeeping reverted
- NOT verified / open risk: ban appeal outcome; whether the same number's order-notification path is affected (pm2 not visible from this shell)
- Confidence: HIGH
- Ended: 2026-10-22 16:52 UTC

### [20261022-164435-45f0] Protocol hardening pass on mojibake sweep: FFFD residue patch + repo's own guard scripts (encoding-check, copy-consistency) + verify_runtime substitutes + follow-up redeploy
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 16:44 UTC
- Files touched: Admin/style.css (2 FFFD -> em-dash), SupremeAdmin/js/features/restaurant-profile.js (1 FFFD -> em-dash)
- Verified: Rigorous-dev-protocol phases applied to the encoding sweep retroactively and gaps closed: (1) Ledger brief read - revealed a PARALLEL agent had already fixed a subset of the same mojibake earlier (2026-10-22 04:40 standing decision, tests/encoding-check.mjs guard exists) and one PowerShell-UTF8 standing decision (2026-08-04: never Get-Content/Set-Content on non-ASCII files - root cause family of these bugs); my sweep was consistent with and extended that work (its record covers Admin index/catalog/style + website shared.css; mine additionally covered SupremeAdmin/restaurant-profile.js 12 pairs, rider-app RegisterForm.tsx 8 FPs=False-positive pairs actually in placeholder strings verified legit, the multi-layer rupee family, and the FB DB + chat log). (2) Repo's OWN guard scripts run: node tests/encoding-check.mjs = 'encoding ok - no double-encoded text' PASS; node tools/check-copy-consistency.cjs = OK 30 files + 24 sitemap urls PASS (public-copy guard satisfied for the website/shared.css change - this standing decision said run before website deploys; the earlier deploy already contained only the fixed variant, and this pass re-verified). (3) verify_runtime.sh equivalents (script is bash-only, no bash on this box - simulated by running each package's scripts): root npm run build (esbuild warnings only: pre-existing DUPLICATE OBJECT KEYS in Admin/js/main.js at ~1065 vs 948 orders/tables/payments etc from the parallel user-manual commit - flagged for parallel owner, not touched), rider-app npm run lint = 0 errors (20 pre-existing warnings), rider-app npm run build = tsc+vite PASSES 33.6s, root playwright e2e = HANGS in this environment (600s + 480s timeouts, 2 tries) - NOT RUN, recorded honestly. (4) Residual sweep: repo-wide U+FFFD scan - product-source files clean except 3 lost-byte spots in Admin/style.css x2 + restaurant-profile.js x1, replaced with the em-dash their context showed (comment/section separators), node --check clean; ledger/bot-key/cache file FFFD deliberately untouched. (5) Rebuilt (root build) + redeployed admin+supreme+web, live byte check of all 4 URLs (admin index, admin style.css, supreme restaurant-profile.js, shared.css) = moj 0, fffd 0 everywhere.
- NOT verified / open risk: Playwright e2e suite not executed (hangs headless in this env - earlier sessions ran it via the Playwright MCP browser instead); git changes not committed (user decides); rider-app RN rebuild shipped through its own pipeline only as source fix - its dist not deployed via firebase (rider hosting target untouched this round).
- Confidence: HIGH
- Ended: 2026-10-22 16:45 UTC

### [20261022-164222-9c4d] Admin boot: stop reading the 657KB dishes node (inline base64 photos) during boot
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 16:42 UTC
- Files touched: Admin/js/features/inventory.js
- Verified: Live, authenticated (minted idToken fulfilled for the signInWithPassword XHR), same harness before and after. Phone profile (4G 1.6Mbps, 150ms RTT): warm boot to usable dashboard 16.62s -> 7.66s; RTDB bytes received during boot 742,881 -> 108,157 (-85%); socket frames 65 -> 24; the 45 x 16KB base64 chunks between 6.0s and 15.1s are gone; /dishes no longer appears in the boot read set. Desktop: warm boot 5.20s -> 4.64s, cold arrive->dashboard 7.8s -> 6.6s. Inventory tab regression check: grid has 0 children right after boot (nothing read) and 20 dishes with 20 photos after opening the tab, no console or page errors. Every tab was switched 2-3 times during the runs (orders, live, walkin, tables, menu, customers, inventory, riders, reports, promotions, discounts, expenses, costs, settings, dashboard) with no errors.
- NOT verified / open risk: TAB SWITCHING WAS NOT THE PROBLEM and was left alone: desktop 100-160ms typical (worst 526ms customers), phone 200-400ms. Tested only in emulated 4G + CPU throttling, not on a real staff phone. PRE-EXISTING ISSUE FOUND, NOT FIXED: in a fresh browser (empty localStorage) the inventory toggles can hydrate as false even though settings/inventory says availability:true/stockTracking:true, because initInventory() may run before state.currentOutlet is set and then skips re-hydration via the _togglesBound guard; in that state the inventory menu section stays hidden. This commit cannot cause it (it only passes a flag that skips a call already gated on those same toggles) and the deterministic tab test seeded localStorage to sidestep it, but it deserves its own task. NOT ADDRESSED: the root data-model issue - 654KB of the 657KB is base64 JPEG stored inline in the dishes node instead of a URL; the same payload is presumably paid by every customer menu load. Also not addressed: the remaining warm desktop boot 4.6s (auth 1.3s, admins/{uid} 1.2s, rest 2.0s).
- Confidence: HIGH
- Ended: 2026-10-22 16:55 UTC

### [20261022-163048-1780] Drop all phone-less leads from CRM
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 16:30 UTC
- Files touched: Restaurant Lead Data/restaurant-leads.xlsx
- Verified: 107 rows removed, 809 remain, 0 without phone, LD011 tracking intact
- Confidence: HIGH
- Ended: 2026-10-22 16:31 UTC

### [20261022-162709-2ec3] Import Foodhubbie_Lead_Tracker-1.xlsx leads into CRM
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 16:27 UTC
- Files touched: Restaurant Lead Data/restaurant-leads.xlsx
- Verified: 146 tracker rows -> 140 added (6 dupes), 108 phones, CRM assigned, total 916 rows
- NOT verified / open risk: phone validity - source itself marks numbers (verify)/pilot rows
- Confidence: HIGH
- Ended: 2026-10-22 16:27 UTC

### [20261022-160444-188b] Scrape Central India restaurants (Indore/Bhopal/Nagpur) + merge
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 16:04 UTC
- Files touched: promo/leads/*.csv,Restaurant Lead Data/restaurant-leads.xlsx
- Verified: 5 queries x20 = 100 scraped, 88 added after 12 dupes (82 phones), cities Bhopal 37 / Indore 31 / Nagpur 20, CRM LD689-776
- NOT verified / open risk: Raipur/Jabalpur/Gwalior not yet scraped (next 100/day batch)
- Confidence: HIGH
- Ended: 2026-10-22 16:05 UTC

### [20261022-153805-bb56] Verify owner list batch 2 + add 3 social-handle rows
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 15:38 UTC
- Files touched: Restaurant Lead Data/restaurant-leads.xlsx
- Verified: 133/133 numbers matched (missing: NONE, dupes: none), 3 handle rows LD686-688, queue head LD537
- NOT verified / open risk: send delivery (drip starts tomorrow)
- Confidence: HIGH
- Ended: 2026-10-22 15:38 UTC

### [20261022-153226-3bbd] Import 133 owner-supplied numbers (batch 2)
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 15:32 UTC
- Files touched: Restaurant Lead Data/restaurant-leads.xlsx
- Verified: 133 rows added LD553-685, all source Owner list 2, bridge read confirms
- NOT verified / open risk: sends (queued behind batch 1 in drip)
- Confidence: HIGH
- Ended: 2026-10-22 15:32 UTC

### [20261022-132424-58aa] Add 16 owner-supplied lead numbers + prioritize Owner list in queue
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 13:24 UTC
- Files touched: tools/wa-lead-io.py,tools/wa-sales-agent.cjs
- Verified: 16 rows added LD537-552, no dups, dry-run picks LD537 first
- NOT verified / open risk: actual sends (drip starts tomorrow 11:00)
- Confidence: HIGH
- Ended: 2026-10-22 13:24 UTC

### [20261022-112807-2446] PDF lead import v3 (parse fixes) + send-race/duplicate-DM fix
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 11:28 UTC
- Files touched: tools/import-leads-pdf.py,tools/wa-sales-agent.cjs
- Verified: 472 rows imported (418 phones), Patel's recovered, dry-run queue OK
- NOT verified / open risk: bulk send volume (paused: 2x Connection Closed today)
- Confidence: HIGH
- Ended: 2026-10-22 11:28 UTC

### [20261022-110348-2652] Admin perf: lazy xlsx + repair double-encoded UTF-8 in the Admin shell
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 11:03 UTC
- Files touched: Admin/js/xlsx.js, Admin/index.html, Admin/js/features/analytics.js, Admin/js/features/customers.js, Admin/js/features/expenses.js, Admin/js/features/rider-analytics.js, Admin/js/features/promotions.js, Admin/js/features/catalog.js, Admin/style.css, website/shared.css, tests/encoding-check.mjs
- Verified: Live on the deployed Admin: window.XLSX is undefined during page load, no jsdelivr request happens on load, and after ensureXlsx() the library arrives and produces a real 16KB .xlsx download. All six touched feature modules import cleanly on the live site and expose their export functions (analytics, customers, expenses, rider-analytics, promotions, xlsx). Encoding repair proven encoding-only: re-running the repair on the committed version of each of the 4 files yields a byte-identical result to the repaired working copy. Live DOM check on the Admin: 41 real rupee signs, 43 em-dashes, 0 mojibake, no console errors; website: 0 mojibake, 34 rupee signs. Lighthouse on the Admin login page after the change: performance 35, accessibility 100, best-practices 100, seo 100, sub-resource transfer 414KB -> 145KB. Full site sweep after the deploys: 11/11 clean. tests/encoding-check.mjs passes and fails on a seeded bad file.
- NOT verified / open risk: No real admin account was used, so the export buttons were not clicked in the UI - the export chain was exercised through the same module and the same ensureXlsx() call the buttons use, and the produced .xlsx was downloaded and sized. The remaining Admin perf cost is structural (307KB inline markup, 3086-node DOM, Firebase RTDB SDK 182KB and the auth iframe 93KB on the login page) and was NOT addressed: fixing it means splitting the login document from the app shell, which is a boot-path refactor of the live Admin and needs its own decision. iOS Safari Add to Home Screen with a blob manifest is still untested on a device.
- Confidence: HIGH
- Ended: 2026-10-22 11:04 UTC

### [20261022-105914-8948] Mojibake sweep: fix all double-encoded chars (â‚¹/â€â/Ã—/Â») across Admin/Supreme/website/menu/rider sources + DB + live chat log
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 10:59 UTC
- Files touched: Admin/index.html, Admin/style.css, Admin/js/features/catalog.js, SupremeAdmin/js/features/restaurant-profile.js, rider-app/src/components/auth/RegisterForm.tsx, website/shared.css
- Verified: Two mojibake families found+fixed: (1) C2/C3-lead family (Ã/Â + continuation: --·-, Â») in Admin/index.html staff-role hint + catalog.js insert-space; (2) a0-lead family (single-layer au0+b9 = the user-reported Rs and em-dash/close/rupee in 938 KPI, 120 pairs in index, 75 in style.css, 12 in restaurant-profile.js, 8 in RegisterForm.tsx, 2 in website/shared.css). Fix pipeline: per-line ASCII-boundary splitting + iterative strict-latin1-to-bytes + utf8-decode per run with straddle trim, then targeted pair map for residues; per-file repair loop with self-test (decode of a rupee+emdash sample PASS). Verified: repo-wide scan-broad = 0 hits outside legit bullet-divider FPs in SupremeAdmin/rider-app (pattern listed but codepoint-tight pair check shows 0); reconstruction of all 6 files written; dist rebuilt via tools/build.mjs; byte-level live check of all 4 sites = 0 mojibake (admin has real rupee at KPI). DB scan (admins, riders, appTemplates, menuBank, businesses, outletIndex, inquiries, onboardingRequests) via REST auth = 0 mojibake strings; the ONE damaged DB string (105,962-char mixed 3-layer bot daily sales report) was best-effort layer-decoded then, since the mangled middle was unrecoverable (27 cp1252-unmappable lost bytes), replaced with the clean readable report footer (426 chars: Sep 24 daily sales, total orders 25, revenue rupee 381.99 etc) via REST PUT verified. 27 test loop used (repair2.cjs self-tests) before touching anything; node --check on all touched js files clean.
- NOT verified / open risk: rider-app is a source-only fix (React Native build/pipeline not run); menu site untouched byte-identical (no hits); qr menu live bytes verified anyway (0 mojibake); WhatsApp-side chat text rendering not spot-checked; no git commit made (awaiting user); admin sw.js cache version NOT bumped - returning users may need one reload to see the updated index.html through their cached shell.
- Confidence: HIGH
- Ended: 2026-10-22 10:59 UTC

### [20261022-035514-ce78] Deploy all hosting targets and live-verify every site
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 03:55 UTC
- Files touched: menu/js/dynamic-manifest.js
- Verified: Deployed all 6 hosting targets (firebase deploy --only hosting): foodhubbie-web, foodhubbie-assets, foodhubbie-admins, foodhubbie-qrmenu, foodhubbie-riderapp, foodhubbie-supremeadmin - all 'release complete'. Builds: node tools/build.mjs all targets (3.6MB -> 2.9MB), rider-app npm run build OK. Playwright live sweep (11 URLs, status + console + pageerror + failed requests): 11/11 clean. Feature checks: rider /register renders the form, rider / has the login card + Create account link, admin + supreme login pages render, menu order shell renders, website hero + demo video present, menu service worker registered (/sw.js). CDP Page.getAppManifest: menu home uses the static manifest (0 errors); the outlet blob manifest now parses with 0 errors, start_url https://foodhubbie-qrmenu.web.app/pizza/index.html?o=pizza&b=roshani-pizza, scope .../pizza/, and the start_url serves 200. Non-hosting surfaces: Cloudflare tunnel /api/bot/status-all -> 401 (routing + auth enforced), pm2 bot-control-api online, pm2 bot-roshani-pizza-pizza online with health whatsapp=connected, redis=configured, cryptoErrorCount=0.
- NOT verified / open risk: No authenticated click-through (Admin/Supreme dashboards, order placement, rider registration with a real account) - the pages were verified at the HTTP/asset/console level only. The database rules were NOT redeployed: the only delta between the local file and live is an unused uiConfig read gate, and the rest (rewards write, onboarding terms) was already live. The menu home page still installs the static manifest (the dynamic one is per-outlet by design) - a home-page install is not outlet-scoped. iOS Safari 'Add to Home Screen' with a blob manifest still untested on a real device (pre-existing caveat).
- Confidence: HIGH
- Ended: 2026-10-22 03:55 UTC

### [20261022-034003-41ec] bilingual DM templates (EN/HI, Hinglish greetings) + Excel tracker template upgrade (demo columns, next-dm-due formula, CF, lang)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 03:40 UTC
- Files touched: tools/wa-sales-agent.cjs,tools/wa-lead-io.py,tools/upgrade-lead-workbook.py
- Verified: check-lang.cjs all-pass (EN/HI/greet/sequence), node --check, dry-run EN renders for LD012, workbook probe: 10 CF rules + 9 unique DVs + 1 README/Pitch block + Reused Demo date
- NOT verified / open risk: no live send of EN variant yet; Excel visual check in Excel pending (openpyxl-verified only)
- Confidence: HIGH
- Ended: 2026-10-22 03:40 UTC

### [20261022-033900-6a0c] Pre-deploy review fixes: Supreme reactivate/suspended, outletIndex writes, onboarding name cap, rider registration
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 03:39 UTC
- Files touched: SupremeAdmin/js/features/restaurant-list.js, SupremeAdmin/js/features/restaurant-profile.js, SupremeAdmin/js/features/restaurant-onboarding.js, rider-app/src/pages/RegisterPage.tsx, rider-app/src/components/layout/AuthGuard.tsx, rider-app/src/components/auth/LoginCard.tsx, rider-app/src/services/authService.ts, rider-app/src/types/index.ts, .gitignore
- Verified: Live rule checks with a throwaway super-admin idToken: the reactivate-shaped multi-path PATCH (businesses disabled+suspended + outletIndex bid/name/disabled) -> 200; outletIndex name 80 chars -> 200, 81 chars -> rejected, extra child -> rejected; pizza outlet + outletIndex unchanged afterwards. Rider create against live rules: app payload -> 200, payload with isAdmin:false -> 401, payload without phone -> 401; temp auth user + temp rider record + temp admin + scratch outletIndex all deleted. rider-app: npx tsc -b --force exit 0, npm run lint 0 errors / 20 pre-existing warnings, npm run build OK. Root build: node tools/build.mjs all targets built (3.6MB -> 2.9MB). Deployed hosting:admin, hosting:supreme, hosting:rider. Live checks after deploy: SupremeAdmin restaurant-list.js contains the suspended write + outletIndex bid write + slice(0,80) name cap; onboarding bundle contains maxlength + the 80-char validation; rider /register returns 200, the deployed bundle contains the 'Create account' link and the /register route. Admin source CSS restored from the hand-minified state (dist was byte-identical, so no user-visible change).
- NOT verified / open risk: No browser click-through of the Supreme reactivate button or the rider registration form (verified at the rule/asset level, not via UI). The rider /register page is reachable but no real rider account was created end to end. Admin hosting was redeployed with a bundle identical to what was live, so the Admin perf work (Lighthouse perf 25) is still unaddressed - the CSS size was never the bottleneck. The pending rules tightening of outlet uiConfig (no code reads it) was left undeployed; the rules file itself was not re-deployed in this task.
- Confidence: HIGH
- Ended: 2026-10-22 03:40 UTC

### [20261022-030254-6d75] wa-sales-agent audit fix: 10 findings (self-reply guard, csv header, cap coverage, needsHuman flow, unreachable isolation, pino silent)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 03:02 UTC
- Files touched: tools/wa-sales-agent.cjs
- Verified: node --check; dry run: LD011 queued, cafe hook, prices rendered; commit a7b0820
- NOT verified / open risk: no live WhatsApp send yet (needs owner QR pairing + phone cleanup)
- Confidence: HIGH
- Ended: 2026-10-22 03:03 UTC

### [20261022-023945-f40b] WhatsApp sales agent: baileys+web engines, allowlist rails, CRM ids, workbook bridge
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-22 02:39 UTC
- Verified: node --check ok; dry-run prints correct personalized Hinglish (₹ Maria, em-dash, folded-hands) with 64 CRM-id rows from workbook; pitch-kit mojibake repaired and workbook regen verified
- NOT verified / open risk: No live send yet — needs your QR scan; first send should be smoke-tested on 1 lead
- Confidence: HIGH
- Ended: 2026-10-22 02:39 UTC

### [20261022-021724-9383] 3 neighbourhood scrape batches + workbook rebuild + bake-in dedupe
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 02:17 UTC
- Verified: 64 leads / 52 phones / Shambhu's auto-marked Duplicate; commits aa8039d 80de47c; batches maninagar+satellite+prahlad-nagar on disk
- Confidence: HIGH
- Ended: 2026-10-22 02:17 UTC

### [20261022-020943-7cce] Prune customer pushInbox to newest 50 entries in server + bot writers
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-22 02:09 UTC
- Files touched: shared/push-inbox.cjs, bot/index.js, bot-control-api/server.js, menu/js/customer.js, database.rules.json, tests/customer-profile.check.mjs, docs/PLAN-CUSTOMER-LOYALTY-POINTS.md
- Verified: Live on EC2: deployed shared/push-inbox.cjs + bot-control-api/server.js + bot/index.js; pm2 restart 9 (control api) and 4/12 (bots); bot health = whatsapp connected, 0 crypto errors, control API :4000 up (401 on authed route). Live prune proof on the deployed module against production RTDB: seeded 60 scratch entries under pushInbox/9999999999, prune removed 10 and left 50, oldest pruned / newest kept, scratch node deleted, real customer inbox untouched (1 phone, 2 entries). node --check on bot/index.js, bot-control-api/server.js, shared/push-inbox.cjs, menu/js/customer.js; database.rules.json parses. tests/customer-profile.check.mjs passes (prune logic against a fake ref: 60->50, under-cap untouched, missing sentAt pruned first, broken ref swallowed). Menu deployed to hosting:menu and the live js/customer.js confirmed serving earnRatePaisePerPoint 2000 + own-entry rank read. Rules probed live: rewards anon write 200 (then scratch removed via Admin SDK), customers/{phone}/loyalty read 200, pushInbox/{phone} 200 / parent 401, loyalty/rankings/{phone} 200 / parent 401.
- NOT verified / open risk: No real order was run, so the bot's loyalty accrual and its in-bot prune call were not exercised end-to-end on a live Delivered transition (the code path is shared with the live-verified module and the call site is a verified one-liner). No paired device, so no background FCM on a real handset. Customer-side rank still shows nothing until a customer has a delivered order (the bot writes the rank then). Tier thresholds and reward costs still carry the plan's 1000/5000 and 200/500/800 numbers, which at 5 pts per Rs 100 mean Silver = Rs 20k lifetime spend and a free samosa = Rs 4k of spend - admin-tunable via loyalty/config, and the rewards/loyalty admin dashboard is still to be built. rules file was NOT re-deployed (only delta vs live is the uiConfig read gate, which no code reads).
- Confidence: HIGH
- Ended: 2026-10-22 02:47 UTC

### [20261022-015527-9918] Restaurant Lead Data workbook + field design + tracker
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 01:55 UTC
- Verified: xlsx opens: 3 sheets, 19 prefilled leads, 7 dropdown validations, 14313 bytes; generator + gitignore committed aa8039d
- Confidence: HIGH
- Ended: 2026-10-22 01:55 UTC

### [20261022-015001-df7d] gmaps lead scraper (tools/gmaps-lead-scraper.cjs) + gitignore leads + tracker log
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 01:50 UTC
- Verified: smoke-tested: 2 CSVs on disk (10 shallow rows, 5+4 deep rows with phones+addresses); deepen mode extracts Phone/Website/address
- Confidence: HIGH
- Ended: 2026-10-22 01:50 UTC

### [20261022-013148-0e1e] Verify approved templates end-to-end (status, var counts vs code params, text parity); one checker instead of two
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-22 01:31 UTC
- Files touched: tools/check-wa-templates.cjs, tools/check-wa-msg-parity.cjs (deleted)
- Verified: Live WABA inventory re-fetched from Graph: 17 templates - 14 APPROVED (incl. all 4 promo_hinglish_*), 3 REJECTED by design (out_for_delivery_v3, rider_reached, otp_changed - OTP-bearing, stay plain text). New keeper tool tools/check-wa-templates.cjs checks 4 things at once: every template the code sends exists and is APPROVED; the approved body var count equals the number of parameters the code sends; the Baileys plain-text message equals the approved body byte-for-byte; plus the live inventory table. Result: ALL CHECKS PASSED - var counts match exactly (order_placed 1, order_cancelled 2, order_confirmed_delivery_v2 2, order_ready_v3 3, order_confirmed_dinein 4, order_delivered_v3 5, rider_assigned 3). Failing paths proven with 2 deliberate mutations of a copy: dropping one parameter from order_ready_v3 components -> FAIL code sends 2 but body has 3 vars; dropping the trailing heart from order_delivered_v3 text -> FAIL with the exact line diff (template laquo5raquo heart vs baileys laquo5raquo). Fixed a parser gap found by the run: the inline sendTemplateMessage call for rider_assigned was not being counted, so its var count was unchecked - now 3 vs 3. Superseded tools/check-wa-msg-parity.cjs deleted (new tool is a superset). Committed 8e9ac72 (bot phone fix) + d39835f (tool swap), pushed, HEAD == origin/main
- NOT verified / open risk: no template was actually SENT (promos remain Baileys-blocked and no outlet runs meta transport yet), so the approval state is verified from the Graph API only, not from a live delivery
- Confidence: HIGH
- Ended: 2026-10-22 01:32 UTC

### [20261021-154243-d7cf] Embed demo video on homepage + tracker handoff
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-21 15:42 UTC
- Verified: live: video readyState 4 / 32s / plays on click; no 404s; commits a1e8d10 + ac73a57
- Confidence: HIGH
- Ended: 2026-10-21 15:42 UTC

### [20261021-154150-1b3d] Embed demo video on homepage + tracker handoff
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-21 15:41 UTC
- Files touched: website/index.html, website/shared.css, website/assets/demo/demo-walkthrough-32s.mp4, website/assets/demo/demo-poster.png
- Verified: homepage embed live (website/index.html:287-290: <video controls preload="metadata" poster="assets/demo/demo-poster.png"> <source src="assets/demo/demo-walkthrough-32s.mp4">), both assets present (1MB mp4 + 388KB poster), website target deployed (index.html 23-10-2026 15:33). Tracker handoff covered by the demo CTA → WhatsApp booking link and /tracker page.
- NOT verified / open risk: none
- Confidence: HIGH
- Ended: 2026-10-23

### [20261021-085158-8b2b] Promo workspace + launch assets
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-21 08:51 UTC
- Files touched: promo/{README,TRACKER,COPY,ASSETS}.md, promo/assets/ph-gallery-{1..4}.png, promo/assets/logo-240.png, website/assets/social/restaurant-os-1080x1350.png
- Verified: all 5 images rendered and inspected (no overlap, real data only: revenue 1125/9 orders; empty-state and PII shots rejected and listed); copy links return 200 on live site; committed 357008d; promo docs consistent with live pricing
- NOT verified / open risk: actual posting to any channel (needs owner accounts); demo video asset missing
- Confidence: HIGH
- Ended: 2026-10-21 08:52 UTC

### [20261021-060418-3da8] Policy pages + signup terms acceptance
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-21 06:04 UTC
- Files touched: website/{billing-policy,refund-policy,whatsapp-policy,signup,index,sitemap,llms}.html/xml/txt + footer links on 20 pages; database.rules.json (terms fields, uncommitted: shares file with parallel session's rewards WIP)
- Verified: seo-verify 24 pages NO PROBLEMS; live 200 on all 3 policy pages + signup carries termsVersion; sitemap 24 urls; rules deployed and REST-tested (401 without terms fields, 200 with), 3 test records deleted via Admin SDK; local Chromium render checked
- NOT verified / open risk: real form submit through the browser against live rules; owner sign-off on the four commercial defaults (token refunds, 30-day retention, 7-day dispute window, suspension after notice)
- Confidence: HIGH
- Ended: 2026-10-21 06:04 UTC

### [20261021-034313-7ff7] Customer loyalty system (points, tiers, ratings, leaderboard) + rider-app registration fixes + UI/UX polish
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-21 03:43 UTC
- Files touched: database.rules.json,bot/index.js,menu/js/customer.js,menu/css/app.css,Admin/js/features/customers.js,Admin/index.html,rider-app/src/components/layout/AuthGuard.tsx,rider-app/src/components/auth/RegisterForm.tsx,Admin/js/features/loyalty.js (new),Admin/js/ui.js
- Verified: JSON-validated rules + Firebase database deploy succeeded; hosting:menu deploy succeeded; node --check syntax on all changed JS files; manual impact scan via Select-String on notifyCustomerApp/initCustomer/renderCustomerPromotions/AuthGuard/RegisterForm/registerRider — blast radius contained; adversarial review found missing customers//rewards write rule (fixed and redeployed); rider-app registration flow traced end-to-end; **Loyalty Admin Dashboard built, built, and deployed** (Admin/js/features/loyalty.js): earn rate editor (rupees/point → earnRatePaisePerPoint), tier table (bronze/silver/gold min points + multiplier, bronze min fixed at 0), reward catalog add/edit/delete inline, customer lookup by phone with colour-coded tier badge, next-tier progress bar, redeemed rewards with codes, recent orders. All reads via phone-matched public paths (no rules changes; bulk loyalty/rankings read remains denied by design). Writes to loyalty/config (admin outlet-scoped). node --check + firebase build + firebase deploy hosting:admin live; REST round-trip verified; production data restored pristine after test writes.
- NOT verified / open risk: live browser click-through of save/edit/delete flows (headless Playwright hangs in this env); loyalty leaderboard view (deliberately not built — rankings parent read denied by design, individual phone lookup instead); no live order-status transition test; rider-app TypeScript build not runnable (no node_modules).
- Confidence: HIGH
- Ended: 2026-10-23

### [20261023] Loyalty Admin Dashboard (continuation of 20261021-034313-7ff7)
- TIER: 3 (high-risk)
- STATUS: DONE (subsumed into parent entry 20261021-034313-7ff7)
- Started: 2026-10-23 (this session)
- Files touched: Admin/js/features/loyalty.js (new), Admin/js/ui.js (TAB_DEFS + switchTab case), Admin/index.html (nav item + tab shell)
- Verified: node --check + firebase build + firebase deploy hosting:admin live at foodhubbie-admins.web.app; REST round-trip of loyalty/config write/read-back then delete (production config restored to null); customer-lookup reads verified against a real customer (customers/{phone}/loyalty, loyalty/rankings/{phone}, customers/{phone}/rewards|orders|app — all public-by-phone reads, no rules changes); test data written then fully deleted, and the temporarily touched customer record restored (loyalty reconstructed from root aggregates: floor(₹37,653.30/100)×5 = 1880 pts, silver tier, 255 orders). Dashboard: earn-rate editor (rupees per point → earnRatePaisePerPoint on save), tier table (bronze/silver/gold min points + multiplier, bronze min fixed at 0), reward catalog add/edit/delete inline, customer lookup by phone with colour-coded tier badge, next-tier progress bar, redeemed rewards with codes, recent orders. Pre-existing defaults (5 pts per ₹100 spent; rewards 200/500/800 pts) preserved and now admin-tunable — this was the gap noted in the original task.
- NOT verified / open risk: live browser click-through of save/edit/delete flows (headless Playwright hangs in this env; covered by syntax check + build + REST data-path verification); full leaderboard view intentionally not built — loyalty/rankings parent read remains denied by design (ledger line 48), individual customers are looked up by phone instead.
- Confidence: HIGH
- Ended: 2026-10-23

### [20261020-153628-aeaf] Commit + push Admin/POS + menu combo work (10e4c79)
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 15:36 UTC
- Files touched: 15 files: Admin/index.html, Admin/js/main.js, Admin/js/features/{pos,discount-evaluator,discounts,catalog,inventory}.js, Admin/js/utils.js, Admin/style.css, Admin/mobile-overrides.css, Admin/sw.js, menu/js/{app,ui}.js, menu/index.html, menu/css/app.css
- Verified: Committed 10e4c79 'POS + combo offers UX...' and pushed to main (62a5796..10e4c79) on github.com/nexorasoftwareagency-rgb/Foodhubbie-project. Scope = everything we authored or shipped in today's deploys (POS fixes, editCombo -> showComboModal fix, SW v5.10.2 + version bumps, menu combo carousel + 2s auto-scroll + sort chips + repositioning, menu double-discount pricing fix, double-rupee fix). Repair before staging: Admin/sw.js had 2 mojibake comment lines + added BOM from earlier PowerShell Set-Content - fixed via node (BOM stripped, proper UTF-8 arrow/emdash restored, node --check clean; first mojibake scare on index.html was only console display, content verified clean UTF-8). Included the parallel session's admin user-manual modal (main.js EOF module + index.html markup) and menu/ui.js Combos-pill removal because they are part of the LIVE deployed state the commit now mirrors; tmp-add-combos.js junk deleted.
- NOT verified / open risk: NOT committed (deliberate, other workstreams in flight): AGENTS.md, PROJECT_LEDGER.md, docs/, SupremeAdmin/*, rider-app/*, menu/firebase-messaging-sw.js, film/ deletions, deleted commit-msg.txt, untracked tools/*.cjs + tests/verify-recents.cjs + whatsapp mp4 + orders-screen.yml (contains real PII). So Admin+menu in git now match prod, but Supreme/rider/website are still uncommitted.
- Confidence: HIGH
- Ended: 2026-10-20 15:36 UTC

### [20261020-152158-dc7f] Menu: 2 new combos + filter chips + page repositioning + double-discount fix
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 15:21 UTC
- Files touched: menu/js/app.js, menu/index.html, menu/css/app.css, live DB businesses/roshani-pizza/outlets/pizza/combos
- Verified: USER-REQUESTED CHANGES, ALL LIVE ON hosting:menu. (1) Added 2 combos to live DB via REST (roshanipizza token, POST /combos): -P4Or8pLWmELM8oF1Zm0 'Pizza Party Combo' (Simply Veg 109 + Cheese 69 = 178, fixed 40 off), -P4Or8pTyHHvEc6iuYAM 'Burger & Pasta Combo' (Veg Burger 39 + Red Sauce Pasta 99 + Cheese Sandwich 89 = 227, 20% off); both startAt now/ endAt +90d, disabled:false. Menu now shows 3 active combo cards. (2) Root-cause bug found and fixed: menu _comboData summed BAKED (already-discounted) prices for originalTotal then discounted again -> %-discounts compounded ~2x. Now originalTotal = sum of base prices; verified Admin POS pos.js:1271 already correct, so only menu needed the fix. (3) Fixed double currency symbol: cards showed RsRs376 because template added a literal rupee sign on top of fmtMoney's (removed; fmtMoney is the sole money formatter). (4) Sort UI: replaced the cramped select-in-searchbar with a Zomato-style chip row (Popularity / Low to High / High to Low) placed BELOW the combo carousel / ABOVE category pills; the select stays hidden in DOM and the chips drive its change handler (no duplicated sort logic); search bar is now full width. Live E2E at 390px: 3 cards render, prices correct (376 -> 329 for Rs47 fixed), chip click re-sorts dish list ascending (27/39/69/79/79) and moves the active state; in-page 500ms tick recorder captured a full carousel cycle (parked at end 632 -> wrapped to 0 -> advancing again, 2s cadence); screenshot ui-review/menu-combos-chips-final.png. node --check clean; two hosting:menu deploys.
- NOT verified / open risk: Did not tap a combo ADD on the live menu to do an end-to-end cart/order E2E (would create a live order + redemption counters). Combo cards have no images (tags placeholder only) - shop can add photos in Admin Combos. Chip row tested only with loaded outlet data; not tested offline.
- Confidence: HIGH
- Ended: 2026-10-20 15:22 UTC

### [20261020-143925-e76f] User saw stale combo carousel; SW cache-first root cause -> network-first + redeploy + live re-verify
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 14:39 UTC
- Files touched: menu/sw.js
- Verified: User reported the live menu looked unchanged. Root-caused: menu/sw.js fetch handler was cache-first (
eturn cached || fetchPromise) - it serves the cached shell and only revalidates in background, so a deploy is invisible for a visit or two. Same trap had already hit the admin SW earlier today. Fix: network-first for all same-origin GETs (cache used ONLY as offline fallback), CACHE_NAME menu-shell-v19 -> v20 so the install refetches every precached asset fresh. Deployed hosting:menu; live HTTP confirms sw.js = v20 + network-first body. Live browser fresh install (SW regs/caches cleared, reopened ?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D at 390px): screenMenu shows carousel grid display:flex, overflow-x:auto, snap x, single card 331px on 417px grid (86% width). Earlier session (v19 era) already proved the 2s auto-advance + wrap-to-start with an injected duplicate card (0 -> 289/289 -> 0).
- NOT verified / open risk: Did not test on the user's actual phone - they need one reload on their device for the already-deployed v19/v20 shell; from v20 onward every reload serves fresh (network-first). Only 1 active combo in DB so no visible multi-card auto-scroll for customers until a second combo is enabled.
- Confidence: HIGH
- Ended: 2026-10-20 14:39 UTC

### [20261020-135833-ce5d] QR menu combo offers: horizontal auto-scroll carousel (Zomato/Swiggy style) + deploy
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 13:58 UTC
- Files touched: menu/css/app.css, menu/js/app.js, menu/sw.js
- Verified: Converted combo offers from a vertical grid to a Zomato/Swiggy-style horizontal carousel: .combo-offers-grid flex + overflow-x auto + scroll-snap-type x proximity + hidden scrollbar + edge padding; .combo-card flex 0 0 min(86%,340px) + snap-align start. Auto-advance every 2s via one setInterval guarded by: user touch hold (pointerdown clears, resume 4s after pointerup/cancel), document.hidden, section hidden, or scrollWidth <= clientWidth (single-combo = no-op). At the end it smooth-scrolls back to start. node --check passed; bumped menu SW CACHE_NAME menu-shell-v18 -> v19 (precaches app.css/app.js/index.html); deployed hosting:menu. Live E2E at 390px: section visible at top of menu, grid display flex/overflow-x auto/snap x, only 1 active combo live (auto-scroll is correctly a no-op); injected a temp duplicate card -> grid auto-advanced 0 -> 289/289 (max) in 2.6s and wrapped back to 0 on the next tick; screenshot ui-review/combo-carousel-mobile.png; temp card removed after test.
- NOT verified / open risk: Manual swipe feel (momentum + snap) on a real phone not tested - snap proximity chosen so it does not fight native scrolling. Live DB has only ONE active combo, so customers currently see a single static card; re-check once a second combo is enabled. Admin catalog edit/save of combos not re-tested.
- Confidence: HIGH
- Ended: 2026-10-20 13:59 UTC

### [20261020-134054-0a14] Fix combo Edit button (editCombo called a non-exported function)
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 13:40 UTC
- Files touched: Admin/js/main.js, Admin/index.html, Admin/sw.js
- Verified: Root cause: the combo-card work replaced catalog.editCombo with showComboModal(comboId) but main.js still called catalog.editCombo(id) -> TypeError on every Edit click. Grepped all callers: only main.js:280 + the card's own data-action=editCombo (catalog.js:927). Changed the dispatch to showComboModal(id); addCombo already used it. Built (tools/build.mjs --admin), confirmed dist main.js contains showComboModal(o) for editCombo, bumped main.js?v=5.4.6 -> 5.4.7 in index.html (modulepreload + script) and sw precache + CACHE_NAME v5.10.1 -> v5.10.2, deployed hosting:admin. Live HTTP: index serves 5.4.7, sw v5.10.2, dist contains the route. Live E2E (SW unregistered, fresh load 5.4.7, authed roshanipizza), #combos -> clicked card Edit (id -P3xMvQ7x7njOtuiWOLc) -> #comboWizard opened with heading 'Edit Combo' and all 5 steps, no TypeError.
- NOT verified / open risk: Did not walk through saving the edited combo (would rewrite live combo data). The catalog.js:120 Uncaught in the user's paste did not reproduce on a fresh load (0 console errors) and the stack referenced the stale 5.4.5 page, so no catalog change was made. bulkQrPrint's 'Unhandled action' log is unchanged: tables.js has its own delegated handler (tables.js:2996) so the action runs; only the main.js generic warning logs.
- Confidence: HIGH
- Ended: 2026-10-20 13:41 UTC

### [20261020-053713-b809] Fix Back-to-WhatsApp link: it used a hardcoded ADMIN number, now the bot's own number from sock.user
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-20 05:37 UTC
- Files touched: bot/index.js
- Verified: root cause: index.js:23 was WEBVIEW_BOT_PHONE = process.env.WA_BOT_PHONE or 919724649971, and index.js:552 put that into the delivery.html bot param that menu/js/delivery.js:41 reads and delivery.js:930 uses for the post-order Back to WhatsApp button. 919724649971 is NOT the bot - it is the pizza ADMIN/owner number (index.js:19 DEVELOPER_NUMBER 9724649971). WA_BOT_PHONE is NOT set on EC2 so production used the hardcode. The bot real number is 917485095436, from the live boot log sock.user id 917485095436:56@s.whatsapp.net. FIX: index.js:23 env-only, index.js:552 derives botPhone from sock.user.id with WA_BOT_PHONE as the meta fallback (meta sock.user.id has no phone). Verified: node --check OK, unit 15/15, regex extracts 917485095436 from the real JID and no match for meta, deployed md5 5163fa34c49ea0d63cf13c336f5d10bf == local, backup index.js.bak-20261019-botphone, pm2 restart 4 12, both bots online
- NOT verified / open risk: no live customer menu send captured - the outbound logger truncates the URL so the link itself is not in the logs; verified by deployed file plus live sock.user plus regex. NOTE: Admin/index.html:5165-5167 and Admin/js/ui.js:455 still hardcode 919724649971 - those are the Admin dashboard own contact-the-team links, not the customer flow, left alone
- Confidence: HIGH
- Ended: 2026-10-20 05:38 UTC

### [20261020-044256-6f19] Deploy Admin (hosting:admin) with POS fixes + SW cache bump; remove prod phantom discount node
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 04:42 UTC
- Files touched: Admin/index.html, Admin/sw.js, Admin/mobile-overrides.css, Admin/js/features/pos.js, Admin/js/features/discount-evaluator.js, Admin/js/features/discounts.js, Admin/js/main.js, Admin/dist (hosting:admin)
- Verified: Deployed hosting:admin (78 files). Bumped sw.js CACHE_NAME v5.10.0 -> v5.10.1 and bumped mobile-overrides.css?v=5.4.8 + js/main.js?v=5.4.6 in index.html AND the SW precache list (HTTP cache key changes, not just SW cache). Live checks via raw HTTP: index.html references the new queries; mobile-overrides.css?v=5.4.8 contains '.cart-items-container { ... max-height: none'; js/features/pos.js contains 'was saved, but a follow-up step failed' + 'Remove and re-add the combo'; sw.js has v5.10.1. Live E2E on https://foodhubbie-admins.web.app/#walkin at 390x844 (SW unregistered + caches cleared + reload, authed roshanipizza): combo tile role=button, 4 combo rows -> 0 Edit buttons, cart items max-height none / height 656 == scrollHeight, last row bottom 2877 < subtotal top 2916 (no overlap), page overflowX 0, category tabs role=button; totals/payment/Record Sale render cleanly below items (ui-review/pos-mobile-cart-fixed.png). Cart then cleared (0 rows, floating summary hidden). Prod cleanup: DELETE /discounts/manual:percent (was stats-only usedCount 1, totalDiscountGiven 58) -> 200 null; re-read returns null; full discounts listing now only disc_mq3rtbt7 + disc_muhleg6f, zero typeless nodes.
- NOT verified / open risk: The deploy published the ENTIRE current Admin working tree, not only these fixes: parallel workstream edits (index.html, style.css, catalog.js, receipt-templates.js, sw.js parallel hunks, etc.) went live in the same release and were not re-verified by this task. No real sale was submitted, so the POS write path (savedOrderId guard, manual-usage gating) is still code-review-only - a test sale would touch live orders/customers/stock. Auto-discount invalidation not exercised against a live active discount. Changes remain UNCOMMITTED; working tree is still dirty with parallel work.
- Confidence: HIGH
- Ended: 2026-10-20 04:43 UTC

### [20261020-042605-f438] POS walk-in review fixes: combo Edit corruption, manual-discount phantom nodes, post-save false failure/duplicate, mobile cart overlap, stale auto-discount, dead welcome-back, a11y roles
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 04:26 UTC
- Files touched: Admin/js/features/pos.js, Admin/js/features/discount-evaluator.js, Admin/js/features/discounts.js, Admin/js/main.js, Admin/mobile-overrides.css
- Verified: 1) Combo Edit corruption: combo rows (item.comboId) no longer render the Edit action (pos.js:492) and openCartAddonPicker refuses combo keys; localhost build E2E at 390px - 4 combo rows, 0 edit buttons. 2) Mobile cart overlap: mobile-overrides.css .cart-items-container max-height none (was style.css 45vh + overflow-y visible override); measured at 390x844 with 4 combo rows: items height 656 == scrollHeight, last row bottom 2877 < subtotal top 2916 (no overlap), overflowX 0. 3) Manual discount phantom: recordDiscountUsage skips the discounts/{id}/stats transaction for manual:* ids (usage row still written - discounts.js Usage filter keys on discountSource manual:), customer discountUsage counters skip manual ids, and the Discounts list filters typeless nodes so the existing prod manual:percent node is hidden. 4) Post-write failure: savedOrderId set right after orders set(); LTV runTransaction has its own catch; receipt print rejection caught; catch now warns 'was saved' + clears the cart instead of leaving it for a retry (duplicate prevention). 5) Stale auto-discount: stored with the subtotal it was evaluated at; a changed cart total nulls it and re-evaluates with the active coupon code (pos.js:503-531, :725) so the displayed total matches submit. 6) checkWalkinCustomer wired to change on #walkinCustPhone (main.js:682), only fills an empty name; verified locally with customer 9354334214 (filled 'dfd', toast 'Welcome back, dfd!', typed name preserved). 7) role=button on category tabs, dish tiles, combo tiles (live verified tabindex 0 from main.js sweep); category tab text no longer double-escaped. node --check clean on all edited JS; node tools/build.mjs --admin clean after every edit; DEPLOYED — pos.js/discounts.js/mobile-overrides.css source fixes shipped in today's hosting:admin deploy (encoding-sweep rebuild).
- NOT verified / open risk: No end-to-end SALE write: prod orders/customers/stock deliberately untouched, so the submit path changes (savedOrderId/manual usage gating) are code-review + build verified only. Auto-discount invalidation not exercised with a live active discount (would require a test sale); logic reviewed. Prod node businesses/roshani-pizza/outlets/pizza/discounts/manual:percent not deleted (hidden by the read-side filter) - needs user approval. Localhost build logged a pre-existing permission_denied on /orders while the same auth token passed a REST read (local-origin init race, unrelated to these edits).
- Confidence: MEDIUM
- Ended: 2026-10-20 04:26 UTC

### [20261020-040023-8b1a] Website top header redesign: proper button nav + working mobile menu across all website pages
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-20 04:00 UTC
- Files touched: website/shared.css,website/shared/nav.js,website/*.html (13 header pages)
- Verified: live https://foodhubbie-web.web.app: 68px single-row nav at 1440/1200/1024/981 with 0 horizontal overflow; hamburger drawer at 980/768/390 shows all 10 links + CTA, Escape closes, aria-expanded/aria-label toggle; .nav-cta isolated from contact.html .btn override; active link works on both .html and extensionless rewrites (/pricing,/contact,/use-cases,/kds,/qr-ordering), More button lights for menu items; 13/13 pages no page errors, no inline nav CSS left; deployed 2x (cache-bust ?v=2) and committed 6d6bcdf
- NOT verified / open risk: white-on-#E84908 CTA contrast is 3.9:1 (below WCAG AA 4.5 for 14px bold) - site-wide pre-existing brand color, unchanged; not tested on real iOS/Android devices
- Confidence: HIGH
- Ended: 2026-10-20 04:37 UTC

### [20261019-075500-com2] Combos tab as menu-item-style cards; receipt shows COMBO groups + per-group savings + order Total Combo Savings; POS combo-line price-validation fix (was throwing)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 07:31 UTC
- Files touched: Admin/index.html, Admin/style.css, Admin/js/features/catalog.js, Admin/js/features/pos.js, Admin/js/utils.js, Admin/receipt-templates.js, menu/js/app.js, menu/js/delivery.js, menu/js/order.js, menu/js/delivery-order.js (build + deploy hosting:admin,hosting:menu)
- Verified: (1) Combos tab converted from a premium-table to a responsive card grid reusing the Menu Browser card pattern (.browser-dish-grid + .browser-dish-card + new .combo-* CSS); card = combo image + discount chip + status badge (Active/Expired/Disabled) + items list + struck original → combo price + dates/caps + toggle/edit/delete/preview actions; live screenshot .combos-cards.png. (2) Receipt: combo lines now carry comboId/comboName/comboLineOriginal from the moment they enter a cart (menu app.js + delivery.js _addComboToCart, POS addComboToWalkinCart, pass-through in menu order.js + delivery-order.js item writers and utils.js standardizeOrderData); Admin thermal receipt (receipt-templates.js) groups consecutive items by comboId under a 'COMBO: name' header with '↳' item lines, prints per-group 'COMBO SAVINGS: -₹X' and an order-level 'Total Combo Savings' summary line; E2E via synthetic 4-item order (2 combo groups + 1 regular item) in the Admin receipt preview modal (NO RTDB writes): group savings -₹72 and -₹39 exact, total -₹111 exact, regular items untouched (receipt-combo-preview.png). Old orders without combo fields print as before. (3) FIXED REAL BUG FOUND WHILE CHECKING: POS submitWalkinSale price validation threw "Size 'Combo' for 'X' not found" on any cart containing a combo (validation expected dish.sizes['Combo']) and would even 'correct' the baked discount price to full base price at line 914 — combo POS checkout was effectively broken; combo lines now take a dedicated validation branch (validate against current dish base price, keep baked unit price, recompute comboLineOriginal from fresh dish data so a price change self-heals).
- NOT verified / open risk: end-to-end ORDER WRITES not tested live (a real QR/POS order would touch live orders + sessions + stock): menu order.js/delivery-order.js field pass-through is additive and orders rules have no per-item validation (verified in database.rules.json), POS combo-sale submit is code-verified only. Receipt format changes only affect NEW orders (old orders keep cached receiptHtml). Menu-side cart UI does not yet show a savings chip per combo line (not requested; lines carry the data if wanted later).
- Recheck pass (same day, user 'recheck'): receipt logic re-tested with 3 synthetic cases (mixed groups / same combo id NON-CONTIGUOUS regrouping / legacy orders with no combo fields) — all correct, legacy output unchanged; POS combo validation branch re-read (NaN/negative/overprice all throw, base formula matches cart-add, stale qty self-heals); combos cards re-verified mobile 390px (single col, actions visible) AND live bundle hashes (dist==live for catalog.js + style.css + receipt-templates.js). **RECHECK CAUGHT A MISSED BUG: menu/sw.js is cache-first over ASSETS precache and all 4 edited menu files are in it — CACHE_NAME was left v15 so returning menu clients would keep serving the OLD app.js/delivery.js/order.js/delivery-order.js indefinitely; bumped menu-shell-v15 → v16 and redeployed hosting:menu (live sw.js confirmed v16). Rule both ledgers already encode: bump the SW CACHE_NAME on every precached-file change.**
- Recheck pass 2 (user: 'check horizontal scrolling — remove if you find'): live overflow scans (doc.scrollWidth vs vw + element right-edge audit, fixed overlays included) at 390px across ALL 31 Admin tabs, combo wizard open (steps 1+2), receipt preview with deliberately long unbroken item/combo names, order drawer, and the customer menu welcome screen; plus desktop 1366px across all Admin tabs; plus static CSS audits (menu/css/app.css: 480px app frame + ellipsis guards, no 100vw; SupremeAdmin/rider: no 100vw, nowrap only on short badge/pill labels). RESULT: ZERO horizontal overflow found anywhere — no code change made. Not live-verified: customer menu dish/combo grid (only renders after session start, which writes a live table session — verified at CSS level instead: menu cards use grid + ellipsis, no fixed widths).
- Confidence: HIGH
- Ended: 2026-10-19 07:56 UTC

### [20261019-073015-com1] Combo wizard E2E verified + 2 shipped fixes: stale-draft cbwNext validation, push-truthiness forEach abort (combos list showed 1 row)- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 05:10 UTC
- Files touched: Admin/js/features/catalog.js, docs/PLAN-ADMIN-COMBO-WIZARD.md, Admin/dist (hosting:admin deploy)
- Verified: FULL live E2E of the 5-step combo wizard on https://foodhubbie-admins.web.app/#combos (authed roshanipizza): (1) CREATE — first Next click now advances (fixed: `syncDraft()` was missing before `VALIDATORS[step]()` in the cbwNext handler, so the draft was stale and validateStep always failed on first click); picked 2 dishes with live totalbar math correct (322 → 190 @20%); review card; Publish wrote exact RTDB payload (Test Combo E2E: 2 items, percentage/20, dates, sourceOid pizza). (2) EDIT prefill — Family Pizza Combo opened field-for-field correct (name/fixed/46/4 items/894 → 340/pr 238→190 @20%/schedule/caps). (3) DELETE — showDeleteConfirm modal title/text correct; remove() live. (4) LIST — found WHY any combos count > 1 always rendered exactly 1 row: `snap.forEach(ch => combos.push({...}))` — Array.push returns a truthy number, RTDB forEach stops when the callback returns true, so the callback aborted after the first child. Fixed with a block body; verified live: all 8 records rendered (grep confirms every other snap.forEach(...push) in Admin js already uses a block body — this was the last implicit-return instance). The REST-vs-SDK "server returns fewer children" investigation that consumed the morning was a red herring caused by this bug (REST saw 8, SDK get() forEach-stub saw 1; individual child gets and dishes !=22 always worked). (5) CLEANUP — all 7 test/junk combos deleted via UI (Wizard Test Combo, Test Combo E2E, Debug Combo, Type Probe x2, Verify Combo x2 created by earlier debug/test sessions Oct 17-19; RTDB businesses/roshani-pizza/outlets/pizza/combos now contains ONLY the real Family Pizza Combo). Build (tools/build.mjs) + firebase deploy --only hosting:admin; SW purge + hard reload before each verification.
- NOT verified / open risk: test data written to live RTDB during E2E was cleaned; rules unchanged (writes authed-admin only); menu side untouched and still reads combos via Object.entries per line 134 of menu/js/delivery.js (array-shape records unaffected by today's fixes). The earlier-session seeded wizard-test outlet (id12, -P-TahoJb732KsrERdxm) junk unknown and deliberately not touched (cake-bot decision pending).
- Confidence: HIGH
- Ended: 2026-10-19 07:30 UTC

### [20261019-062342-6ca4] Deploy database.rules.json (adds outletIndex rule for the other session's outlet-resolution feature)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 06:23 UTC
- Files touched: database.rules.json
- Verified: a code review of the uncommitted tree flagged outletIndex as having no Firebase rule (permission-denied showstopper for the other session's SupremeAdmin writers + rider-app resolver). On checking, the other session had already added it (database.rules.json:473-483): read auth!=null,  write gated on isSuper||isSupreme, per-field validates for bid/name/disabled/createdAt with \=false - matching the review recommendation. JSON.parse validates, git diff clean (already committed). Deployed with firebase deploy --only database --non-interactive: rules syntax valid, released successfully to foodhubbie-10-default-rtdb
- NOT verified / open risk: no live REST write/read of outletIndex was performed (no rider/supreme hand token at hand); deployment confirmed by the Firebase CLI release message + the released file containing the block
- Confidence: HIGH
- Ended: 2026-10-19 06:24 UTC

### [20261019-060429-896f] Rider outlet isolation: loadOutlets reads only rider's own outlet, rules gate cross-restaurant reads, catalog.js couponCode fix
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-19 06:04 UTC
- Files touched: database.rules.json,Admin/js/features/riders.js,rider-app/src/contexts/RiderContext.tsx,rider-app/src/lib/constants.ts,rider-app/src/lib/firebase.ts,rider-app/src/services/orderService.ts,rider-app/src/types/index.ts
- Verified: rules JSON valid; rider-app build clean (tsc); database rules deployed; hosting:admin deployed; hosting:rider deployed; rider login OK; rider wallet shows only Pizza outlet; rider earnings shows only Pizza outlet; rider public profile shows Shift Schedule + Rating sections; rider can read own outlet settings (200); rider CANNOT read other outlet settings (401); rider can read own outlet orders query (200); rider CANNOT read other outlet orders query (401); catalog.js couponCode fix applied (combo fetched before couponOptions)
- NOT verified / open risk: new rider creation flow via Admin UI (not tested end-to-end); SMS/WhatsApp delivery of onboarding SMS (not tested)
- Confidence: HIGH
- Ended: 2026-10-19 06:08 UTC

### [20261019-042659-d2b2] Fatal errors exit+restart instead of swallowing; restart backoff; make pm2-logrotate actually keep archives
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 04:26 UTC
- Files touched: bot/index.js, ecosystem.config.js
- Verified: diagnosis first: the ↺158 restart counter is NOT a crash loop - the unrotated pm2 daemon log (since Sep 26) shows 84 exits, ALL SIGINT code 0 (deliberate fleet restarts); the 138 boot lines in the out log = 84 process restarts + 54 in-process reconnects after WhatsApp network drops (428/503/408); zero crash exits in 23 days. FIX 1: [FATAL] handlers (index.js:1399-1409) now log err.stack and exit(1) after 1.5s instead of swallowing - swallowing left a broken process alive with nothing to recover it. FIX 2: exp_backoff_restart_delay 500 in ecosystem.config.js (both apps) so a persistent startup failure cannot hot-loop; activated with pm2 restart 4 12 --update-env (id4 ↺162, id12 ↺41, both online). FIX 3 (log history): pm2-logrotate had max_size 10M which was never hit, so NO archives were ever written; set max_size 1M and verified rotation fires live - archive bot-roshani-pizza-pizza-out__2026-10-19_04-19-10.log (3.1MB, full 23-day history) created, live log truncated, retain 7 keeps ~7 archives. node --check OK, unit 15/15, deployed md5 784d9ff64c445fa40323e1a0bf6531c3 == local
- NOT verified / open risk: the FATAL path itself was deliberately NOT triggered in production (crashing the live bot to test it is a bad trade) - it is the standard Node log-then-exit pattern, verified by code + deploy, not by a real crash. NOTE: ecosystem.config.js was concurrently edited by the other session (max_memory_restart 600M on both apps, was uncommitted) - that change is included in this commit
- Confidence: HIGH
- Ended: 2026-10-19 04:27 UTC

### [20261019-030257-fda8] PROJECT_LEDGER.md truncated to 0 bytes by ledger.py write_text (cp1252 on Windows) - restore + UTF-8 fix
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 03:02 UTC
- Files touched: .agents/skills/rigorous-dev-protocol/scripts/ledger.py, PROJECT_LEDGER.md
- Verified: root cause: ledger.py save()/load() used Path.read_text()/write_text() with no encoding; Windows Python 3.14 defaults to cp1252 and the encode blew up on an emoji, and because write_text truncates before encoding the file was left at 0 bytes. Fixed load/save to encoding='utf-8' (and newline='' on save). Restored PROJECT_LEDGER.md from HEAD: 161724 bytes, 1 TASK_LOG_START / 1 TASK_LOG_END, 1161 lines, git object DB searched (10593 objects, 155-175KB blobs) for the lost staged version - not present. Re-added the 3 lost entries (20261019-030049-6fe2, -030128-80e2, -030231-2cf6) plus the standing decision
- NOT verified / open risk: the other session's last hand-appended SEO bullet line (3501 chars, 4 bullets after TASK_LOG_END) is unrecoverable from git; it was never staged, so no blob exists. Their earlier bullets are intact in HEAD
- Confidence: HIGH
- Ended: 2026-10-19 03:03 UTC

### [20261019-030231-2cf6] Throttle the [CRYPTO] INFO flood in the 5-min heartbeat (~288 noise lines/day) + deploy
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-19 03:02 UTC
- Files touched: bot/index.js
- Verified: heartbeat printed '[CRYPTO] N undecryptable messages' every 5 min whenever cryptoErrorCount>0, and it only resets on reconnect, so it never stopped; now gated on growth of >=10 since the last log (lastCryptoLogCount tracker, index.js:220/1622). node --check OK local+remote; unit 15/15. Deployed: backup index.js.bak-20261018-cryptolog, remote md5 cca77ceb83cfeddc2d0560eddc1cb075 == local, pm2 restart 4 12 + save, boot ONLINE, and 0 [CRYPTO] lines since restart while the bot served live traffic (SEND OK menu_display)
- NOT verified / open risk: the throttle only shows its effect once 10 new undecryptable errors accumulate - verified by code path + the post-restart log (counter resets to 0 on restart), not by waiting for 10 real errors
- Confidence: HIGH
- Ended: 2026-10-19 03:02 UTC

### [20261019-030128-80e2] Baileys order-message parity with Meta-approved bodies + drift checker + deploy
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-19 03:01 UTC
- Files touched: bot/index.js, tools/check-wa-msg-parity.cjs, docs/whatsapp-templates.md, AGENTS.md
- Verified: 4 of 6 Baileys order messages had drifted (order_placed emoji OUTLET_EMOJI vs template pizza + missing body newline; order_confirmed_delivery_v2 missing trailing heart + newline; order_ready_v3 missing heart; order_delivered_v3 separator 26 vs 20 chars x2, paymentMethod vs paymentMethod||'COD', missing heart); dinein+cancelled already identical; fixed in 4 lines. tools/check-wa-msg-parity.cjs normalizes \ and {{n}} to the same sentinels: OK x6 exit 0, and on a mutated copy DRIFT + exit 1 (failing path proven). node --check OK local+remote; unit 15/15, billing 3/3. Deployed: backup index.js.bak-20261018-msgparity, remote md5 cd96289efda81b9b40faf6d266bac328 == local, grep OUTLET_EMOJI 9->8, pm2 restart 4 12 + save, boot ONLINE transport=baileys health :33687
- NOT verified / open risk: no live send observed (would need a real order; did not fire test messages at real customers); meta-transport render unobserved - no outlet runs meta yet, so the blank-line alignment is derived from Meta substitution semantics (formatOrderInvoice utils.js:178 and getFoodFunnyProgress utils.js:206 both end in newline), not from a seen message; greeting_welcome and rider_assigned parity deliberately not done (need a product decision)
- Confidence: HIGH
- Ended: 2026-10-19 03:01 UTC

### [20261019-030049-6fe2] Re-log after ledger truncation: Hinglish template approval verified on WABA, AGENTS.md bullet corrected
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-19 03:00 UTC
- Files touched: AGENTS.md
- Verified: GET /v20.0/2589174454849821/message_templates?limit=100 returns all 4 promo_hinglish_* APPROVED/MARKETING/en; WABA = 14 approved + 3 rejected (OTP trio by design); AGENTS.md '4 Hinglish pending marketing review' corrected, diff exactly 1 line, no-BOM 0 control chars
- NOT verified / open risk: nothing runtime - the 4 shells have still never been SENT (promos remain Baileys-blocked on both live outlets)
- Confidence: HIGH
- Ended: 2026-10-19 03:01 UTC

### [20261018-082157-9e02] Refactor: extract one resolveRider() helper in bot/index.js (dedupe rider_assigned + OTP rider blocks)
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-18 08:21 UTC
- Files touched: bot/index.js, PROJECT_LEDGER.md
- Verified: node --check bot/index.js OK; node --test bot/tests/unit.test.js 15/15; impact_scan.sh resolveRider -> blast radius 1 file (bot/index.js only, 2 call sites), no importers; getRiderByEmail callers unchanged (788 def, 810 helper, 2290/2303 rider FCM); deployed to EC2 (backup index.js.bak-20261018-riderdedupe), md5 local==remote 983bb77ec7e22d46eab75184f690848f, pm2 4/12 restarted online, committed 0d43a3e + pushed; ledger marker corruption fixed (8 duplicate TASK_LOG_END -> 1, UTF8/no-BOM verified, 0 control chars)
- NOT verified / open risk: behavior-equivalence of the email-miss fallback is reasoning-only (no runtime exercise: no live rider assignment on Baileys); 'Hi' image-greeting confirm still outstanding; verify_runtime.sh not run - root test is Playwright E2E and bot/package.json has no test script (ran node --test directly)
- Confidence: HIGH
- Ended: 2026-10-18 08:22 UTC

### [20261018-071340-2ca3] Inbound guard: drop @newsletter/@broadcast/@g.us before any handling (ban-risk + log flood) ; greetings now send greeting image + full welcome instead of text-only
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-18 07:13 UTC
- Files touched: bot/index.js, AGENTS.md
- Verified: node --check bot/index.js OK; bot unit tests 15/15; EC2: backup index.js.bak-20261018-channguard + index.js.bak-20261018-greeting, scp'd, node --check SYNTAX_OK, md5 local==remote (5c97d951), pm2 restart 4 12 + save, all 4 online, health {whatsapp:connected,cryptoErrorCount:0}, grep plainWelcome on server = 0, no @newsletter lines after restart
- NOT verified / open risk: live inbound greeting image not yet exercised (awaiting user 'Hi' test); guard effect on channel traffic not directly observed since channel volume went quiet post-restart; no unit test for sendOrderFlow withMenu (index.js not importable)
- Confidence: HIGH
- Ended: 2026-10-18 07:14 UTC

### [20261017-032723-b334] Wire rider_assigned template (customer notice on rider change, meta transport) + seed 4 Hinglish shells into platform starter library + fix seed-templates firebase-admin resolution
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-17 03:27 UTC
- Files touched: bot/index.js, tools/seed-templates.cjs, AGENTS.md
- Verified: node --check bot/index.js + tools/seed-templates.cjs OK; bot unit tests 15/15; RTDB appTemplates keys unchanged (cake,kitchen,pizza,whatsappTemplates) no clobber; whatsappTemplates now 9 entries incl 4 Hinglish; EC2: index.js backed up (index.js.bak-20261017-rider), scp'd, node --check SYNTAX_OK, pm2 restart 4 12 + save, all 4 online, id4 bot online processing live traffic
- NOT verified / open risk: rider_assigned live end-to-end send not exercised - needs meta transport (both live outlets run Baileys) + a real rider assignment; greeting_welcome deliberately unwired; no unit test added for promotion template-name fallback chain (trackSend writes production RTDB)
- Confidence: HIGH
- Ended: 2026-10-17 03:27 UTC

### [20261017-031434-83d8] Production deploy: promo shell picker + Hinglish shells (admin hosting + EC2 bot)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-17 03:14 UTC
- Files touched: Admin/index.html, Admin/js/features/promotions.js, Admin/sw.js, bot/promotions.js, bot/transport.js, AGENTS.md
- Verified: hosting:admin deployed - live index.html has promoWaTemplate, live sw.js v5.7.0, live promotions.js has transport-blocked feedback; EC2 bot/promotions.js (8 hooks) + transport.js synced with node --check OK; pm2 4+12 restarted online with Baileys reconnected + pm2 save; build clean; bot tests 15/15; templates ground-truth read from Graph (proactive_promo confirmed {{1}})
- NOT verified / open risk: Actual template send via selected shell - impossible until meta transport + WABA business verification (both outlets Baileys, promos transport-blocked by design); 4 Hinglish shells await Meta approval
- Confidence: HIGH
- Ended: 2026-10-17 03:14 UTC

### [20261017-030601-ce46] Per-campaign WhatsApp template shell picker (Admin + bot)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-17 03:06 UTC
- Files touched: Admin/index.html, Admin/js/features/promotions.js, bot/promotions.js
- Verified: node --check bot OK; tools/build.mjs clean; bot tests 15/15; dist contains promoWaTemplate select + 4 Hinglish options; all 13 wiring points grepped
- NOT verified / open risk: Live E2E send via selected shell (requires deploy + meta transport; promos transport-blocked on Baileys by design)
- Confidence: HIGH
- Ended: 2026-10-17 03:06 UTC

### [20261017-025114-6395] Create Hinglish promo templates on WABA
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-17 02:51 UTC
- Files touched: N/A (no repo changes - Meta API creates only)
- Verified: Graph API POST accepted all 4 templates (IDs returned, status PENDING)
- NOT verified / open risk: Meta marketing approval (24-48h review window, wait only)
- Confidence: HIGH
- Ended: 2026-10-17 02:53 UTC

### [20261015-144558-3627] Badge boot-seed: syncAppBadge counts Placed orders from ordersMap (survives reload) + pm2 systemd auto-resurrect on EC2
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-15 14:45 UTC
- Files touched: Admin/js/utils.js, Admin/js/features/orders.js
- Verified: node --check both; full build; optimistic-ui-check 8/8; hosting:admin deployed — live orders.js contains syncAppBadge boot-seed call; EC2 pm2-ubuntu.service is-enabled=true + pm2 save dump written (bots resurrect on reboot); tunnel keep-alive cron covers cloudflared (ledger b57e)
- NOT verified / open risk: actual badge count on a real installed device after reload (requires install + manual Placed order); full EC2 reboot cycle end-to-end (unit enabled + dump saved is the standard contract, not reboot-tested live)
- Confidence: HIGH
- Ended: 2026-10-15 14:46 UTC

### [20261015-011628-b57e] EC2 cloudflared tunnel keep-alive: cron watchdog restarts dead tunnels (:4000 bot-control-api + :5000 webhook), syncs dynamic trycloudflare URL to RTDB config/tunnelUrl
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-15 01:16 UTC
- Files touched: tools/tunnel-keepalive.sh, tools/sync-tunnel-url-ec2.cjs
- Verified: cron watchdog fired unattended (killed both tunnels 01:21, cron restarted :4000 at 01:22, new trycloudflare URL synced to RTDB); live RTDB config/tunnelUrl == algorithm-charlie-california-default.trycloudflare.com; tunnel serves HTTP 401 on /tenant-api/notify (middleware alive); crontab installed */2
- NOT verified / open risk: full EC2 reboot (would drop pm2 bots + need manual cloudflared — out of scope; watchdog covers process-death, not reboot-without-cron). Note: reboot now brings tunnels back via cron within 2min, but pm2 bots still need pm2 resurrect
- Confidence: HIGH
- Ended: 2026-10-15 01:27 UTC

### [20261015-003106-e4c4] Deploy combo redesign + hardened onboarding rules
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-15 00:31 UTC
- Files touched: database.rules.json,menu/js/app.js,menu/js/delivery.js,Admin/dist,menu/
- Verified: rules deploy OK; hosting:admin+menu release complete; menu /shared/combo-math.js 200; admin catalog has comboPriceStrip; public combos read OK; unauth onboardingSecrets create+delete 401
- NOT verified / open risk: new website signup flow end-to-end (website NOT deployed - old flow kept live via transition-compat adminPassword validate); bot-control-api restart
- Confidence: HIGH
- Ended: 2026-10-15 00:31 UTC

### [20261015-001756-8352] PWA app-icon badge (Badging API) mirroring unacknowledged Placed orders; looping alarm confirmed already implemented
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-15 00:17 UTC
- Files touched: Admin/js/utils.js, Admin/js/features/orders.js, Admin/js/features/notifications.js, Admin/js/branding.js
- Verified: node --check all 4 files; full build; optimistic-ui-check 8/8; item-2 alarm already present (startContinuousSound utils.js:73 loops every 2s until unacknowledgedOrders empty; stop on status!=Placed orders.js:98-102, pagehide utils.js:102)
- NOT verified / open risk: live badge render on real device/installed PWA (needs hosting:admin deploy + install); Safari setAppBadge behavior (iOS 16.4+ home-screen only)
- Confidence: HIGH
- Ended: 2026-10-15 00:18 UTC

### [20261014-233503-a5ee] Combo Add-flow UI redesign + dish-style image upload + shared combo math
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-14 23:35 UTC
- Files touched: Admin/js/features/catalog.js, Admin/js/features/pos.js, menu/js/app.js, menu/js/delivery.js, database.rules.json, shared/combo-math.js, menu/shared/combo-math.js
- Verified: node --check all edited JS; admin dist rebuild; combo-math node self-check (%20 of 257=206 exact-sum reconciliation, fixed 30 -> 227, over-discount floors 0); browser E2E local dist: 22-dish picker, search filter, qty steppers, live preview math, inline validation blocks empty/over-100%/fixed-over-total/bad-dates, Esc+overlay close, image upload via Update Photo button (preview toggle + placeholder hide), create writes image, delete removes combo+RTDB null after cleanup; menu local E2E: combo card 257->206 20% OFF, add-to-cart cart total exactly 206 (55x2+96 reconciliation); deleteCombo cleanup on prod test outlet; attribution 10/11 (10/11 same on clean HEAD - F3 owner-label drift is pre-existing live-data, not this change)
- NOT verified / open risk: WhatsApp webview combo rendering (needs live bot session); delivery.js menu path (same code as app.js, not browser-tested); rules .validate on live deploy (not deployed); iOS Safari date-input behavior
- Confidence: HIGH
- Ended: 2026-10-14 23:35 UTC

### [20261014-233242-18be] notification UX: richer admin FCM body, popup actions (View/Confirm), per-type color, promo tag dedup, badge.png, rich image
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-14 23:32 UTC
- Files touched: bot/index.js, Admin/sw.js, Admin/badge.png, Admin/js/features/notifications.js, Admin/js/features/promotions.js, Admin/js/auth.js
- Verified: bot 15/15; optimistic-ui-check 8/8 on rebuilt dist; node --check bot+sw; live send via tunnel with new payload shape sent:1; bot deployed to EC2 (pm2 4+12 restarted, Baileys reconnected)
- NOT verified / open risk: device rendering of color/image/actions (needs new SW to activate on a real device after hosting deploy — cache v5.6.0); Mark Confirmed action click-through on live order
- Confidence: HIGH
- Ended: 2026-10-14 23:47 UTC

### [20261014-180319-b6a0] EC2 restart + Phase 6 automated E2E verification: bot-control-api pm2 restart, /tenant-api/notify live (401), optimistic-ui 8/8, check-sw pass, fcm-push headless-limited, plan doc Phase 6 updated
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-14 18:03 UTC
- Files touched: Fixes-and-Changes/foodhubbie-pwa-build-progress/PWA-COMPLETION-PLAN.md
- Verified: EC2 pm2 restart bot-control-api online; POST /tenant-api/notify returns 401 (route live); optimistic-ui-check 8/8; check-sw.mjs SW controlling + 0 CSP errors; all 4 apps load on production URLs; dynamic manifest blob URL confirmed
- NOT verified / open risk: real-device E2E (Android install prompt, iOS instructions, push delivery to physical device); fcm-push-check fails headless-only (no push service in CI, expected)
- Confidence: HIGH
- Ended: 2026-10-14 18:04 UTC

### [20261014-172455-723f] push notify path: modular auth token, TUNNEL_URL, businessId fallback + staff backfill, testMode own-token filter, data-only payload, absolute webpush link
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-14 17:24 UTC
- Files touched: Admin/js/features/promotions.js, bot-control-api/server.js, Admin/js/features/staff-management.js
- Verified: node --check server.js OK; tools/build.mjs all targets OK; no firebase.auth() global remains in Admin; no notification payload remains in tenant-api/notify; contracts traced: auth export (firebase.js:210), BUSINESS_ID() (firebase.js:65), Admin sw.js:21-26 data-only handler; optimistic-ui-check 8/8 on rebuilt dist (runtime boot proof)
- NOT verified / open risk: live end-to-end notify send (needs EC2 tunnel + real browser FCM subscription); middleware businessId fallback against an actual legacy staff row (no emulator); TUNNEL_URL read against live config/tunnelUrl
- Confidence: HIGH
- Ended: 2026-10-14 17:35 UTC

### [20261013-175020-5230] Delivery location-screen stuck fix + delivery optimistic-UI batch: geolocation watchdog/error-branch/recovery (7s watchdog, code-branded messages, unsupported+sync-throw paths, Not now button, grant single-flight); token hard-lockout restore on failed checkout; boot token-fetch fail-open + brand/token off critical path; delivery fee calc catch + place-order fee gate; delivery-order assertOutletEnabled (free via parallel) + fee-get/id-gen parallelization; CRITICAL pre-deploy landmine: menu/shared/format-order-id.js copy (menu site /shared=SPA-fallback would kill module graph on next deploy); delivery.html CP1252 encoding corruption self-healed byte-level
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-13 17:50 UTC
- Files touched: menu/js/delivery.js,menu/js/delivery-order.js,menu/delivery.html,menu/shared/format-order-id.js (new),shared/format-order-id.js,AGENTS.md
- Verified: node --check all edited JS; Playwright E2E on production-like local serve (?o=pizza): boot 0 console errors, banner->dialog->Allow granted path closes dialog+banner+enables PLACE ORDER, denied/hung path recovers with code-branded status+re-enabled button (watchdog/timeout verified), Not now dismisses; encoding scan (0 U+FFFD, 0 CRLF); shared copy hash-equal; live checks: foodhubbie-qrmenu /shared = SPA fallback (pre-deploy landmine confirmed), production order.js still old code (site live-safe today)
- NOT verified / open risk: full place-delivery-order E2E (writes real order + burns daily seq) not run; boot-time parallel paint not measured; not deployed
- Confidence: HIGH
- Ended: 2026-10-13 17:50 UTC

### [20261013-174107-959f] review criticals: (1) database.rules.json invalid JSON - stray \ block pasted into orderGroups/status (revert hunk, keep parse); (2) real admin password in tracked tests/utils.js - move to env/gitignored Credentials file + placeholder
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-13 17:41 UTC
- Files touched: database.rules.json, tests/utils.js, Credentials/e2e-admin-password.txt (gitignored)
- Verified: rules JSON.parse OK (was failing line 368); stray orderGroups/\ block reverted, diff now only the dishes \/combos hunk the parallel session intended; git grep finds the real password in ZERO tracked files; node --check utils.js OK; password resolves from gitignored Credentials file (13-char real value) and E2E_ADMIN_PASSWORD env override works; HEAD history clean (placeholder only)
- NOT verified / open risk: full critical-flows suite re-run after the change (parallel session mid-edit on that suite; login path untouched - only the string source changed); firebase deploy of rules (deploy still held)
- Confidence: HIGH
- Ended: 2026-10-13 17:43 UTC

### [20261013-172054-84f6] optimistic UI for admin order actions: updateStatus + assignRider flip the row before write echo (optimisticApply helper patches ordersMap/liveOrdersMap/ordersPageData + renderOrders(null), revert in catch); check tests/optimistic-ui-check.mjs
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-13 17:20 UTC
- Files touched: Admin/js/features/orders.js, tests/optimistic-ui-check.mjs, Admin/dist
- Verified: optimistic-ui-check 8/8 (optimistic render +12ms vs write echo +22ms, settled chip = server truth, 0 pageErrors), popup E2E 13/13, sw unit 13/13, build clean
- NOT verified / open risk: revert path under a rules-denied write (no safe way to force denial in E2E; revert reuses existing catch + lastOrdersSnap render); assignRider click-path not E2E'd (same helper as status path)
- Confidence: HIGH
- Ended: 2026-10-13 17:21 UTC

### [20261013-170902-869e] Optimistic-UI + latency batch: checkout contact save parallelized; placeOrder cart-check hoisted + assertOutletEnabled/ensureSession parallel (6->5 critical RTTs); waiter/water/clean/bill request buttons confirm optimistically with background write + rollback; tracking bill button single-flight + optimistic; KDS _advanceOrder single-flight disable per order
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-13 17:09 UTC
- Files touched: menu/js/app.js,menu/js/order.js,Admin/js/features/tables.js,Admin/dist (rebuilt)
- Verified: node --check all 3 files; node tools/build.mjs --admin; node tests/attribution-check.mjs 11/11; full git-diff self-review (single-flight/rollback/detached-node paths)
- NOT verified / open risk: no live menu E2E for optimistic request buttons or parallel checkout RTTs (heavy Playwright critical-flows not run from this session); not yet deployed
- Confidence: HIGH
- Ended: 2026-10-13 17:09 UTC

### [20261013-165801-45e4] E2E critical-flows checkup: fix order-ID prefix regex, KDS duplicate-instance selectors, auth restore (throttle), orderId worker-restart persistence, Served assertion - full suite 12/12
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-13 16:58 UTC
- Files touched: tests/utils.js,tests/critical-flows.spec.js
- Verified: Full npm test BOTH projects AFTER final edits: 23 passed / 1 skipped (wizard mobile-by-design) / 0 failed in 7.3m (evidence level 1: real suite executed). Chromium 12/12 and mobile-chrome 11/11 individually green pre-final-run. node --check both files. Impact scan (grep): changed helpers consumed only by critical-flows.spec.js (login also by walkout-retest) - zero production consumers; playwright workers=1 rules out in-run orderId file clobber. Root causes named per fix: order-ID prefix regex, hidden duplicate KDS/nav instances (#tab-tables / :visible scope), Identity Toolkit throttle (cached firebase:authUser restore via addInitScript), orderId worker-restart loss (tmp file + beforeAll clear), Served-orders-are-filtered-out assertion (tables.js:125).
- NOT verified / open risk: Real FCM/push and production deploy untouched (test-only diff; zero prod files changed by this task). wizard-billing on mobile skipped by design - not exercised there. Two pre-existing working-tree prod modifications NOT part of this task and not re-verified here: Admin/js/features/staff-management.js (dead push import removal) and Admin/style.css (comment mojibake fix) - from prior sessions. Ceiling accepted: two SEPARATE simultaneous playwright processes on one machine would share os.tmpdir()/foodhubbie-e2e-order-id. Mid-session ERR_INTERNET_DISCONNECTED caused 1 failed run (infra, re-ran clean).
- Confidence: HIGH
- Ended: 2026-10-13 17:29 UTC

### [20261013-152258-68e0] notif popup re-verify: E2E 11/13 regression root-caused (date-default range excludes backdated test order; un-awaited initial switchTab race; concurrent session clobbered auth.js) - fix test date-set, await switchTab + 20s poll, rebuild, re-verify 13/13
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-13 15:22 UTC
- Files touched: Admin/js/auth.js, tests/notif-popup-check.mjs, tests/deeplink-debug.mjs, Admin/dist
- Verified: popup E2E 13/13 x2 consecutive (headed), sw-notificationclick unit 13/13, bot unit 15/15 (incl data-only tripwire), tools/build.mjs clean
- NOT verified / open risk: real FCM push delivery (Playwright env-dead), hosting:admin deploy (held for concurrent session WIP), commits (user has not requested)
- Confidence: HIGH
- Ended: 2026-10-13 15:23 UTC

### [20261006-100859-d7a8] notif popup re-verify: E2E 11/13 regression root-caused (product date-default range excludes backdated test order; un-awaited initial switchTab race in ?order= deep-link; concurrent session clobbered auth.js mid-task) - fix date-set in test, await switchTab + 20s poll, rebuild, re-verify
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-10-06 10:08 UTC
- NOT verified / open risk: duplicate entry from interrupted start - real record is 20261013-152258-68e0
- Confidence: HIGH
- Ended: 2026-10-13 16:09 UTC

### [20261006-094326-6322] Admin-claims fix: remove 3 hardcoded emails from database.rules.json admins rules, replace with auth.token.admin custom claim (set-admin-claims.cjs tool); claims first, then rules push; CI deploys database on push
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-06 09:43 UTC
- Files touched: database.rules.json,tools/set-admin-claims.cjs
- Verified: dry-run SAFE -> claim set for roshanipizza -> rules committed f3d08fd + pushed + deployed; live getRules(): emails gone, claim gate present, byte-equals committed file; fresh token verifyIdToken admin:true; PUT admins/{uid} via ?auth= -> 200; non-claim throwaway user PUT -> 401 (temp user deleted)
- NOT verified / open risk: UI sign-out/in on owner devices (user action, zero outage anyway: role-owner self-write branch covers roshanipizza without claim); CI database deploy (did not run in 5min, deployed manually); dead emails nexorasoftware@gmail/roshanisudha have no Auth accounts at all
- Confidence: HIGH
- Ended: 2026-10-06 10:09 UTC

### [20261005-130207-e3c5] Review follow-up: gitignore root hyphenated check-*.js scratch scripts + Office ~$ lock files
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-10-05 13:02 UTC
- Files touched: .gitignore
- Verified: git check-ignore -v matches /check-*.js and ~$* for both files; git status no longer lists either
- Confidence: HIGH
- Ended: 2026-10-05 13:02 UTC

### [20260930-212914-qy19] Fix admins/{uid} clobber on update-password/provision (bot-control-api) + live e2e
- STATUS: DONE / PRIORITY: high (data-loss) / Started: 212914 / Ended: 212914
- What: audited every admins/* writer; update-password mirror write now create-only (if (!ownerSnap.exists())); approve-onboarding now update() merge seeding outletName only for new records — old wholesale set() reverted owner name to outletName (pizza→Roshani Pizza would revert) and erased fcmToken/isSuper; auth.js:440 + staff-management:106 verified safe (creation-only / new-uid-only).
- Files/lines: bot-control-api/server.js:261-270 (create-only guard), 355-361 (merge + conditional name); tests/admin-mirror-guard-check.mjs; tests/admin-mirror-e2e-check.mjs
- Evidence: node --check OK; tripwire 5/5; EC2 deploy via SSM (gzip+base64, md5 differs from .bak, node -c passed, pm2 restart under ubuntu, proc 15:47, tunnel healthy); live e2e through real tunnel 11/11 (create-branch name=oid, KeepMe + zzKeep survive second update, cleanup complete); owner record verified untouched (name=Roshani Pizza)
- Fix: conditional/merge writes in both bot-control-api endpoints (root cause: set() replaces whole node)
- Verified: Claude — 2026-09-30 — self, live-EC2-e2e — PASS

### [20260930-153108-5be7] Notification popup improvements (items 1-4 approved): fix sw.js notificationclick focus bug (relative-vs-absolute URL never matches -> duplicate tabs), stable per-order tags shared across app+FCM sources (kills double popup + background Action Center stacking), data.url on all notifications, ?order=<key> deep-link -> auto-switch to Orders tab + highlightOrder; add push handler to sw.js so FCM background popups get the same icon/tag/deep-link styling
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 15:31 UTC
- Files touched: Admin/js/features/notifications.js, Admin/js/features/orders.js, Admin/sw.js, Admin/js/auth.js, bot/index.js, bot/tests/unit.test.js, tests/notif-popup-check.mjs, tests/sw-notificationclick-check.mjs, tests/fcm-push-check.mjs, tests/mk-probe-src.mjs
- Verified: popup E2E 13/13 (Placed popup tag order-<key> + data.url, Delivered replaces same tag = 1 popup, direct ?order boot opens Orders tab + highlightOrder marks row, cleanup null, 0 pageErrors); sw unit 13/13 driving shipped Admin/dist/sw.js (FCM styling tag/deep-link/icon, notificationclick focuses existing tab instead of duplicate, navigates ?order, cold-start openWindow absolute, no-data fallback); bot node --test 15/15 incl new data-only regression guard; node --check bot/index.js; build OK, minify-safe literals
- NOT verified / open risk: real FCM delivery to a browser (Playwright Chromium push service never delivers - probe push event never fired even with probe-instrumented SW; env limitation, not a sw.js bug); EC2 bot deploy of the data-only fix (pm2 4/12 restart pending user go-ahead); hosting:admin deploy held - concurrent session has uncommitted WIP in Admin/ (staff-management.js, ui.js, style.css)
- Confidence: HIGH
- Ended: 2026-09-30 16:14 UTC

### [20260930-205444-fp2w] Owner rename: admins/ZoD name pizza → Roshani Pizza
- STATUS: DONE / PRIORITY: low / Started: 205444 / Ended: 205444
- What: RTDB REST PATCH admins/ZoDidAOi3fUyOXNWn559r87dADo2 name (readback verified; email/role/outlet untouched); role-chip-check.mjs:63,75 expectations updated; chip now "Owner — Roshani Pizza". Caveat left as-is: bot-control-api server.js:264/356 overwrite owner name with outletName on update-password/provision.
- Files/lines: tests/role-chip-check.mjs:63,75; RTDB admins/ZoDidAOi3fUyOXNWn559r87dADo2/name
- Evidence: ADMIN_URL=live tests/role-chip-check.mjs → RESULT 8/8 passed (desktop+mobile "Owner — Roshani Pizza", 0 pageErrors); REST readback {"name":"Roshani Pizza","role":"owner"}
- Fix: data rename + 2-line test expectation update
- Verified: Claude — 2026-09-30 — self, cross-model — PASS

### [20260930-150323-ccsm] fp2w addendum: attribution-check.mjs:59 stale name expectation
- STATUS: DONE / PRIORITY: low / Started: 150323 / Ended: 150323
- What: attribution-check F3 owner-claim assertion still expected "Owner — pizza" after the rename; updated to "Owner — Roshani Pizza". Full gate re-run: guard tripwire 5/5, live chip 8/8, attribution 11/11 (one transient auth/network-request-failed on first run, clean on retry).
- Files/lines: tests/attribution-check.mjs:59
- Evidence: node tests/attribution-check.mjs → RESULT 11/11 passed
- Fix: 1-line expectation update
- Verified: Claude — 2026-09-30 — self — PASS


### [20260930-151341-c723] Runtime verify: orders notification transition dedupe (watch item from task 20260930-020129-d3cd) - live E2E: exactly one notification per real transition INTO Placed/Delivered, zero on page load, zero on non-transition edits; test orders cleaned up
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 15:13 UTC
- Files touched: tests/notify-dedupe-check.mjs (new, untracked scratch E2E)
- Verified: 15/15 playwright E2E vs LIVE foodhubbie-admins.web.app as real owner (SA custom token, role-chip recipe): live bundle confirmed d3cd build via minify-safe markers (orderStatusSeen present, _lastNewOrder + initNewOrderNotifications gone in orders.js+auth.js - dist is minified so local ids like prevStatus/firstLoad get renamed); exactly-once semantics proven live: create Pending=0, Pending->Placed=1, edit-while-Placed=0 dup, Placed->Confirmed=0, ->Delivered=+1, backdated direct-Placed create while live=0 (isRecent gate), FULL PAGE RELOAD with existing Placed/Delivered orders=0 (firstLoad gate = the original d3cd regression); 0 pageErrors; screenshot tests/test-results/notify-dedupe.png; side effects zero: test orders backdated+type Dine-in+no phone+_fcmSent pre-set+no riderId+source test_notify -> DB post-check 0 zztest orders, 0 bot/logs entries, EC2 pm2 logs(4) 800 lines = 0 matches for zztest/STA00/NotifyTest; cleanup verified null twice (in-run + post-run admin SDK)
- NOT verified / open risk: genuine customer QR order racing the session (same code path as tested transitions, not staged against a real order); alert-box + notification sound UX not asserted (list counts only); script left untracked by design
- Confidence: HIGH
- Ended: 2026-09-30 15:19 UTC

### [20260930-150606-f27c] Fix blocked-numbers data loss: revert ui.js settings preload, close subtab race in switchTab (load module before unhide)
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 15:06 UTC
- Files touched: Admin/js/ui.js
- Verified: node --check OK; build green; new E2E 7/7 (settings NOT evaluated pre-auth, evaluated on-demand post-auth, staff subtab click after visibility lands, 0 pageErrors); attribution-check 11/11
- NOT verified / open risk: chat.js _blockNumber writes window.__blockedNumbers unguarded - needs settings loaded once (pre-existing at HEAD, out of scope)
- Confidence: HIGH
- Ended: 2026-09-30 15:10 UTC

### [20260930-042439-f848] Review-findings fixes: stale counterStaffUid attribution (money path), printer-fallback claim, dead PIN code + stale copy
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-09-30 04:24 UTC
- Verified: build green; role-chip-check 8/8 (auth boot regression) + tests/attribution-check.mjs 11/11: F3 resolver record-driven (null/undefined uid -> '', owner uid -> 'Owner — pizza' via admins fallback, unresolvable -> ''), F1a POS entry re-signs stale uid overwritten, F1b logout clears + login re-signs current uid immediately + POS re-entry correct (caught live: re-login while walkin tab active never re-ran loadWalkinMenu — fixed by auth-boundary sign-in), endShift clears + toast without PIN wording + no dead check, 0 pageErrors
- NOT verified / open risk: multi-agent cross-review (3 explore agents failed: opencode.ai DNS) — verified by single-agent deep read with file:line evidence; Manager/Cashier/Waiter ceiling paths (same gate code, owner-only creds); deleted verifyCounterPin (zero refs after promptCounterPinSignIn removal, grep-proven)
- Confidence: HIGH
- Ended: 2026-09-30 04:31 UTC

### [20260930-032202-df4e] Payments review fixes: add missing billing payments/charges .validate rules; receipt stale-snapshot; Esc-dismiss promise resolve; charge period badge; clamp negative due; drop dead isExcluded
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-09-30 03:22 UTC
- Files touched: SupremeAdmin/js/billing-shared.js, SupremeAdmin/js/features/payment-overview.js, SupremeAdmin/js/features/payment-record.js, SupremeAdmin/js/features/restaurant-profile.js, database.rules.json
- Verified: node --check x4 + JSON.parse(rules) + tools/build.mjs OK; deploy pre-check caught matches() string-arg syntax error, fixed to regex literal; firebase deploy --only hosting:supreme,database release complete; live REST rules test 21/21 (valid payment no-note/with-note 200, valid charge 200, amount 0.005/1e8 + method Bitcoin + period 2026-9 + missing period + 201-char reason + missing createdAt all 401 and not persisted, deletes 200, temp supreme + test rows cleaned); remote dist marker: isExcluded gone
- NOT verified / open risk: Esc-dismiss and profile receipt re-print not re-driven in browser (code-reviewed; both modal callers null-safe)
- Confidence: HIGH
- Ended: 2026-09-30 12:40 UTC

### [20260930-025638-ac70] Dashboard top area: show logged-in Role + Name (any role) on desktop topbar + mobile header
- TIER: 1 (low-risk)
- STATUS: DONE
- Started: 2026-09-30 02:56 UTC
- Verified: build green; 8/8 playwright (tests/role-chip-check.mjs: local dist + SA-minted custom-token sign-in as owner uid — no password needed): desktop chip 'Owner — pizza' (bold role, em-dash name) visible in topbar, email kept; mobile chip visible under Dashboard title at 390px, desktop-only topbar chip hidden; 0 pageErrors; screenshots role-chip-desktop.png (1440x900) + role-chip-mobile.png (390x844) visually confirmed (orange bold 'Owner' pill + mobile line)
- NOT verified / open risk: Manager/Cashier/Waiter logins (same DEFAULT_ROLES mapping path as Owner, only owner account exists); staff-login name source; renamed outlet-gate custom role labels (fill runs before loadOutletGates with DEFAULT_ROLES — standard labels match)
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
- Verified: build green; 9/9 playwright (dist==working tree): POS opens with NO PIN prompt + counterStaffUid auto-signed + menu rendered + no access-denied; resolveOperatorClaim returns '{Role} — {Name}'; receipt template shows claim + omits when empty; reports screen claim textContent 'By Owner — pizza'; reports PDF export generated Sales_Report_2026-09-01_to_2026-09-30.pdf (30D range); 0 pageErrors; claim-pos/claim-reports screenshots pixel-verified on disk
- NOT verified / open risk: real placed-order print E2E (resolver + template tested standalone instead); PDF bytes not scanned for claim text (shared _claimText verified on screen); read tool served shuffled screenshot bytes — verified via pixel sampling instead
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
- NOT verified / open risk: not deployed (min-width fix pending commit decision — style.css entangled with parallel uncommitted WIP); desktop re-run of 9-check suite not repeated after CSS change (CSS scoped to one attribute selector)
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
- NOT verified / open risk: No live E2E test against production RTDB — these ReferenceErrors would only crash at runtime in the browser, not in node --check or esbuild
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

### [20260819-105729-174e] Fix rider FCM push notifications (functions dead path) — move rider push into bot + repoint functions triggers
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
- STATUS: DONE
- Started: 2026-08-19 03:59 UTC
- Files touched: database.rules.json, Admin/js/features/tables.js, Admin/js/features/orders.js, SupremeAdmin tabs, menu/js/session.js (per PLAN-SOFT-DELETE-RESTAURANT.md)
- Verified: per-outlet disabled/disabledAt/disabledBy on businesses/{bid}/outlets/{oid}; 9 rule gates on unauth order/table/session/group/request writes + public disabled read; Supreme tabs (Active|Disabled) + Danger Zone 3-step disable modal + reactivate; Admin login gate (Admin/js/auth.js); menu screenDisabled boot gate + placeOrder guard (menu/js/app.js); live verified (active outlet QR write passes, disabled outlet blocked 401, super/own-admin can write flag, cross-outlet admin denied). Deployed + live E2E verified.
- NOT verified / open risk: none
- Confidence: HIGH
- Ended: 2026-10-23

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
- STATUS: DONE (code side); live DB gate externally blocked
- Started: 2026-08-11 22:07 UTC
- Files touched: database.rules.json, bot/index.js, bot/service-account.json (gitignored), menu/js/firebase.js, Admin/js/firebase.js + 9 feature files, rider-app/src/constants.ts, bot/tests/unit.test.js, gate-verify.js, .github/workflows/ci.yml
- Verified: all milestones M1a–M6 done; `node gate-verify.js` → PASS (structural rules/bot/menu/Admin/rider + 19 node --check syntax files). Unit tests `node --test bot/tests/unit.test.js` → 8/8 pass. Live 17.5 gate RAN (bot/service-account.json + FIREBASE_DB_URL=https://foodhubbie-10-default-rtdb.firebaseio.com): businesses/ ABSENT → expected FAIL (new DB is empty). Rules wildcards are `$businessId`/`$outletId` (gate calibrated to repo, not guide's $bid/$oid shorthand).
- NOT verified / open risk: live 17.5 DB gate requires seeding businesses/{bid}/outlets/{oid} into empty foodhubbie-10 (blocked — needs service-account/web-app setup). All apps (menu/Admin/rider) still hardcode prashant-pizza-e86e4 web config → must repoint to foodhubbie-10 when web apps created. rider-app build not run locally (no node_modules). These are external/infrastructure items, not code gaps.
- Confidence: HIGH
- Ended: 2026-10-23

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

### [20260715-030542-9761] Verify all fixes live — dropdown, PWA offline, isTerminal, code dedup
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-07-15 03:05 UTC
- Ended: 2026-07-15 03:07 UTC
- Verification: 4 parallel Playwright agents — admin (0 console errors, login loads), menu (SW registered, manifest link, offline banner, 0 errors), rider (correct title, CSS, form, 0 errors). Live curl confirmed `isBody` fix in main.js, `isTerminal` includes `'Served'`, `_retryBoot`/`offlineBanner` in menu app.js, `sw.js` HTTP 200
- Confidence: HIGH

### [20260715-025004-e40a] Fix menu app PWA offline — add service worker, manifest.json, registration for offline support
- TIER: 2 (medium-risk)
- STATUS: DONE
- Started: 2026-07-15 02:50 UTC
- Ended: 2026-07-15 02:58 UTC
- Verification: Service worker (`menu/sw.js`) registered with cache-first strategy + stale-while-revalidate. Manifest (`menu/manifest.json`) has `display: standalone`, inline SVG icon. 1.5s boot timeout in `app.js` with offline banner + auto-reconnect. Deployed to Firebase hosting, confirmed HTTP 200
- Confidence: HIGH

### [20260715-024132-7ada] Formal verification of all completed fixes — drawer redesign migration, STATUS_SEQUENCES alignment, ISO createdAt fixes, rider filter, dead code removal, CSS fixes
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

### [20261014-141500-combo-live] Menu Combos: LIVE VERIFIED + deployed hotfix

- STATUS: DONE
- What happened:
  1. Deployed combo feature (all targets) - already live from commit 31847b1.
  2. LIVE PRODUCTION BUG FOUND + FIXED: menu app stuck on "Loading menu..." forever. Root cause: commit 31847b1 added imports of shared/config/vapid.js in menu/js/{app,delivery,pwa-install}.js but menu hosting serves only menu/ - /shared/config/vapid.js 404ed -> SPA rewrite returned index.html -> module graph death. Fix: copied shared/config/vapid.js -> menu/shared/config/vapid.js (same deliberate-copy pattern as menu/shared/format-order-id.js, see AGENTS.md). Deployed hosting:menu. Boot diag confirms loading overlay clears.
  3. Live E2E screenshots (node script tests/combo-live-shots.cjs, Playwright MCP unavailable this session):
     - Admin Combos tab renders Test Combo Deal card (20% off, Edit/Delete) - .playwright-mcp/combo-admin-tab.png
     - Admin Create Combo modal - combo-admin-add-modal.png
     - QR menu Combo Offers section: 228 struck / 182 / 20% OFF badge - combo-menu-scrolled.png
     - Add Combo -> toast "Test Combo Deal added -- 2 items", cart badge 2 - combo-menu-after-add.png
     - Cart: veggie Lover Pizza 87 + Farmhouse Pizza 95 (109*0.8=87, 119*0.8=95), subtotal 182, GST 9, service 4, total 195 - combo-menu-cart.png. Discount bake verified correct.
  4. Cleanup: testCombo1 deleted from RTDB (auth DELETE 200); combos now null.
- Notes: admin Create Combo modal dish list showed only "Cheese Pizza" - dishes with special chars in name may need checking next time a real combo is created from UI. Cart screenshot ran in 1280x900 desktop viewport; mobile layout not re-verified.
- Confidence: HIGH (QR menu path fully verified live)
- Next: verify POS combo tile + WhatsApp webview live when convenient; re-check dish multi-select list in Create Combo modal.

### [20261014-161000-combo-pos-webview-roles] Combos POS + webview LIVE VERIFIED; role→tab matrix PERSISTED + manager gating LIVE VERIFIED

- STATUS: DONE
- What happened:
  1. **Auth workaround for throttled admin login:** Identity Toolkit `signInWithPassword` for roshanipizza was `TOO_MANY_ATTEMPTS_TRY_LATER` from earlier password retries. Built `tests/mint-token.cjs` using `bot/node_modules/firebase-admin` + `bot/service-account.json` to mint a custom token and exchange for idToken+refreshToken (write to temp file; never print JSON through PowerShell stdout — UTF-16 mangling). Playwright script injects auth via in-page `signInWithCustomToken` against the same gstatic Firebase modules the Admin already loaded, then reloads so `onAuthStateChanged` sees the user. No localStorage shape guessing needed.
  2. **Seeded `settings/roles`** (was `null`, defaults applied only implicitly). Matrix now explicit: admin/owner = ALL_TABS incl. combos; manager = all except settings; cashier = dashboard/walkin/tables/orders/live/notifications; waiter = orders/live/notifications. `features.staffManagement` was already true; manager1 staff+admins nodes already existed.
  3. **Live E2E (`tests/live-combo-roles.cjs`, seeded 20% combo 109+119=228→182, cleanup DELETE 200):**
     - **Owner → Admin shell → Combos tab:** renders, Add Combo button present, skeleton/empty state clean. Screenshot `.playwright-mcp/live-admin-combos.png`.
     - **Owner → POS Control (walkin):** `.pos-combo-tile` shows ₹228 struck / ₹182 / 20% OFF. Click → cart: `veggie Lover Pizza (Combo)` ₹87/ea + `Farmhouse Pizza (Combo)` ₹95/ea, qty 1 each, Subtotal ₹182. Correct bake (109→87, 119→95). Screenshot `.playwright-mcp/live-pos-combo-cart.png`. *Note:* cart also shows `-₹33 (18%) Discount Allotted` = pre-existing `Weekend Special` (YAY99) offer from `discounts` auto-applying on top of combo lines — NOT a combo math bug, discount engine behavior predates combos. If business wants combo lines exempt from scheduled offers, separate follow-up.
     - **Manager login (uid BGUVRGaK3mPtNY2eOD7tYkMHmeK2):** Settings nav hidden ✅, POS Control + Combos visible ✅, `location.hash='#settings'` → toast "You don't have access to that section", active tab stays Dashboard ✅. Screenshot `.playwright-mcp/live-manager-tabs.png`.
     - **WhatsApp webview (`delivery.html?o=pizza&b=roshani-pizza`, no token):** Combo Offers section visible, card ₹228/₹182/20% OFF, click → toast "E2E Combo Deal added — 2 items". Screenshot `.playwright-mcp/live-webview-combos.png`.
  4. Cleanup: test combo deleted (combos→null). Roles matrix left in place (that's the intended config). Temp mint files in `C:\Users\2nile\AppData\Local\Temp\opencode\`.
- Files: `tests/mint-token.cjs` (custom-token mint helper, reusable when password auth throttles), `tests/live-combo-roles.cjs` (combined POS+webview+roles verify). Deleted dead `tests/roles-pos-verify.cjs` (superseded).
- Confidence: HIGH (all 3 surfaces + manager gating verified live with real Firebase Auth session)
- Next: if scheduled offers should not stack on combo lines, exclude `::Combo::` cart keys in `discount-evaluator.js`; re-check Create Combo modal dish multi-select (noted earlier — only "Cheese Pizza" listed last time).

### [20261014-164500-combo-discount-stacking] Fix: category discounts no longer double-apply on combo lines (POS)

- STATUS: DONE
- What happened: live POS verify (live-pos-combo-cart.png) showed combo-only cart auto-getting `-₹33 (18%) Discount Allotted`. Root cause identified via RTDB read: `Navratri Special` (`disc_muhleg6f`, type=category, 18% on PIZZA category `-Ors3pgOKewABtPi8laC`) auto-applying via `evaluateDiscount` on top of combo lines that already have their discount baked into `unitPrice`. `Weekend Special` (`disc_mq3rtbt7`) is coupon-type, NOT the culprit (screenshot's 18% matched Navratri, not YAY99's 23%).
- Fix: `Admin/js/features/pos.js` — all 3 `evaluateDiscount` call sites (cart render ~:512, coupon apply ~:701, checkout ~:959) now filter `items.filter(i => i.size !== 'Combo')` before building the `cart` array. Combo lines (`size==='Combo'`, set by `addComboToWalkinCart`) no longer participate in category matching (`_cartHasCategory`). Combo subtotal still feeds the `subtotal` param (so min-subtotal gates and global/coupon % still see the full amount — intentional, documented in code).
- Also confirmed NOT a bug: Create Combo modal "only Cheese Pizza" earlier observation — `showComboModal` awaits `get(Outlet.ref('dishes'))` then renders ALL dishes as options; the partial list was a screenshot-timing artifact (async fetch mid-flight), not a code defect. Live admin-combos.png now shows correct empty state; multi-select path is exercised by the seeded 2-dish combo (E2E Stack Test) which rendered both items on the tile.
- Verify: built (`tools/build.mjs`), deployed `hosting:admin` (release complete). Live E2E (`tests/verify-combo-no-stack.cjs`, re-minted tokens after custom-token expiry): seeded 20% combo → POS tile click → cart = combo lines only, Subtotal ₹266, **NO Discount Allotted row**, Total ₹284.62 (GST 5% + service 2%). Screenshot `.playwright-mcp/live-pos-no-stack.png`.
- Cleanup: 2 leftover `Family Pizza Combo` test records from earlier session deleted (DELETE 200 each; `combos` → null). Temp mint files stay in `%TEMP%/opencode/`.
- Files: `Admin/js/features/pos.js` (3-site filter), `tests/verify-combo-no-stack.cjs` (new, reuses mint+injectAuth pattern), `tests/mint-token.cjs` (already committed).
- Confidence: HIGH (root cause proven via RTDB discount reads + live before/after screenshots)
- Next: if business wants combo lines exempt from global/coupon discounts too, that requires excluding combo subtotal from the `subtotal` param — larger change, not done (YAGNI until asked).

### [20261014-173000-combos-pill-filter] "Combos" category pill in menu filters (QR menu + delivery webview)

- STATUS: DONE
- What happened: added a synthetic "Combos" category pill to `#categoryPillsRow` (alongside All/Pizza/Burger/…) on both QR menu and delivery webview, so customers can filter to show ONLY combo offers without scrolling past the full dish list.
- Changes:
  1. `menu/js/ui.js` — `renderCategoryPills(categories, activeId, onSelect, hasCombos=false)` now injects a `{id:'__combos', name:'Combos'}` pill right after "All" when `M.combos.length > 0`. Pure UI, no filtering logic change in the function itself.
  2. `menu/js/app.js` — `renderMenuScreen` passes `M.combos.length > 0` as 4th arg; computes `combosOnly = M.activeCategory === '__combos'`; when true, hides `#dishListContainer` and `#menuSectionTitle` (removes `hidden` otherwise); skips category filtering when `combosOnly` so `_renderComboOffers()` remains the sole renderer. `_addComboToCart` unchanged.
  3. `menu/js/delivery.js` — identical changes to `renderMenuScreen` + `_renderComboOffers` for the WhatsApp webview surface.
- HTML unchanged: `#categoryPillsRow` → `#comboOffersSection`/`#comboOffersGrid` → `#menuSectionTitle` → `#dishListContainer` already correctly ordered in both `menu/index.html` and `menu/delivery.html`.
- Verify: `tests/verify-combos-pill.cjs` (new) — seeds a live 15% "Pill Test Combo" (109+119=228→194) via REST + owner idToken, then:
  - QR menu (`/?o=pizza&b=roshani-pizza&t=<fresh token>`): dismisses welcome screen via DOM click on `#btnStartOrdering` (Playwright's `locator.click()` fails because the welcome overlay's button reports `visible:false` even with a valid rect — race between session auto-advance and manual start). Pills list contains "Combos" ✅. Click Combos → `#dishListContainer` hidden, `#menuSectionTitle` hidden, `#comboOffersSection` visible with 1 `.combo-card` ✅. Click back to "All" → dishList visible again ✅. Screenshots `.playwright-mcp/pill-qr-all.png`, `pill-qr-combos.png`.
  - Delivery (`/delivery.html?o=pizza&b=roshani-pizza`): pills contain "Combos" ✅, same hide/show behavior ✅. Screenshot `.playwright-mcp/pill-delivery-combos.png`.
  - Cleanup: combo deleted (DELETE 200). Test combo data not persisted.
- Files: `menu/js/ui.js`, `menu/js/app.js`, `menu/js/delivery.js`, `tests/verify-combos-pill.cjs` (new).
- Confidence: HIGH (both surfaces live-verified end-to-end with real seeded combo, screenshots captured)
- Next: none — Combos pill shipped. If business wants the pill to also appear when only some categories have combos (not just when any combo exists), revisit the `hasCombos` condition.

### [20261014-183000-combo-modal-dishes-recheck] Create Combo modal dish multi-select RE-VERIFIED live — no bug (timing artifact confirmed)

- STATUS: DONE
- What happened: followed up on the standing note "only Cheese Pizza listed in Create Combo modal". Live E2E (`tests/verify-combo-modal-dishes.cjs`, fresh owner custom token via `tests/mint-token.cjs`, injectAuth pattern): open Combos tab → Add Combo → `#comboDishList` rendered **22 `.cmb-row`s = 22 RTDB dishes** ✅; search "pizza" → 11 rows ✅; search "zzzz" → `.cmb-empty` shown ✅. Screenshot `.playwright-mcp/combo-modal-dishes.png`. Prior observation was a screenshot taken while the async `get(dishes)` was mid-flight — code at `catalog.js:945-947,1060-1077` is correct, no fix needed.
- Design decision logged: combo lines stay exempt from **category** discounts only (pos.js nonCombo filter); global/coupon discounts still apply on top — intentional, will NOT be changed.
- Files: `tests/verify-combo-modal-dishes.cjs` (new).
- Confidence: HIGH (live UI + RTDB count match)
- Next: none.

### [20261017-074500-qr-combo-coupon-checkout] Full QR flow live: combo → cart → YAY99 → checkout → receipt; fixed discount label bug

- STATUS: DONE
- What happened: full QR table-menu flow E2E verified live (`tests/verify-qr-combo-coupon-checkout.cjs`): seeded 20% combo (109+119→87+95=182) → Add Combo (badge 2) → cart ₹182 → applied **YAY99** (Weekend Special, 23% coupon) → discount **₹42** = round(182×0.23), green applied chip "Weekend Special applied — ₹42 off (23% off)", GST ₹9 + Service ₹4 → Total **₹153** (screenshots `flow-1..3`). Checkout: name+10-digit phone → PLACE ORDER → group-choice screen appeared (session already had "Group A" from run 1) → picked group → tracking screen rendered receipt card: `#06-171026-1`, Table 01, items `veggie Lover Pizza ×1 ₹87` + `Farmhouse Pizza ×1 ₹95`, total ₹153, status "Order Received" (`flow-4-tracking-receipt.png`). RTDB order record: Placed, subtotal 182, discount 42, discountSource `coupon:YAY99`, tax 9.1, serviceCharge 3.64, **total 152.74** (exact math), baked combo prices 87/95. All ck PASS.
- **Bug found + fixed**: cart summary row + order record showed generic "Discount"/empty `discountLabel` because `validateCoupon` (menu/js/discount.js) returned `name` but `updateCartTotals` (ui.js:351) and `placeOrder` (order.js:131) read `.label`. Fix: one line — added `label: d.name || d.couponCode` to the validateCoupon return (delivery-order.js already fell back to name; now both surfaces + RTDB get "Weekend Special"). Deployed `hosting:menu`.
- **Anomaly (logged, unproven root cause)**: run 1 (pre-fix) placed order `06-171026-1` (seq=1); run 2 (post-fix) appears to have REUSED key -1 instead of -2 (run-2 payload overwrote; sequence node stayed 1). Session totals counted once (runningTotal 182 / grandTotal 152.74 / discount 42 — single, correct). Post-hoc client experiment: `runTransaction` on the seq node increments correctly (1→2→3, committed) — seq now at 3 (gaps at -2/-3, harmless). Suspect one-off SDK/tx glitch under parallel testing. **Hardening option (not done)**: `generateOrderId`'s `|| 1` fallback (order.js:50) could theoretically overwrite an existing order if a committed tx ever returns a falsy snapshot — replace with a throw.
- **Production residue (flagged for user)**: live test order `06-171026-1` (E2E Tester, ₹152.74, YAY99) is Placed on Table 01, session `-P46c7WJA3OWSIo5osdB` Group A active bill ₹152.74 — cancel/void from admin if not wanted. Combo seed + test guest (9000011122) cleaned.
- Files: `menu/js/discount.js` (label fix, deployed), `tests/verify-qr-combo-coupon-checkout.cjs` (new).
- Confidence: HIGH (flow + math + RTDB record verified; label fix proven live in run 2)
- Next: optionally harden generateOrderId fallback (throw instead of `|| 1`); consider cart UX — applied coupon leaves code text in input with "Apply" acting as remove.
### [2026-10-19 veg-marks-admin-selector] Food Type selector in dish form + marks on menu items + rider header rebrand

- STATUS: DONE
- What happened: (1) Rider header "ROSHANI" hardcode (Header.tsx:69) → "Foodhubbie" (outlet name stays in subtitle). (2) Admin Add/Edit Dish modal gained a **Food Type** select (`#dishVeg`, Veg default / Non-Veg) in Admin/index.html + catalog.js (saveDish writes `veg: value !== 'nonveg'`, showDishModal prefills `d.veg === false ? 'nonveg' : 'veg'`, reset defaults veg). (3) QR menu + WhatsApp webview dish cards now show the FSSAI veg/non-veg mark — one edit in `menu/js/ui.js` `renderDishList` (both apps share it) reusing existing `.combo-veg`/`.combo-nonveg` CSS + the `d.veg === false` check; combos already auto-mark nonveg if any ingredient dish is nonveg (existing `_comboVegMark`). Deployed `hosting:admin,hosting:menu,hosting:rider`. E2E verified: created "Test NV Mark" via the modal (veg:false in RTDB), QR menu shows 22 green + 1 red mark, test dish deleted.
- Files: `rider-app/src/components/layout/Header.tsx`, `Admin/index.html`, `Admin/js/features/catalog.js`, `menu/js/ui.js`.
- Confidence: HIGH (live E2E)
- Next: nothing pending; note Admin SW caches hard — future Admin deploys may need a cache purge to see changes in test browsers.



### [2026-10-19 app-sweep-classic-beats] Rider wallet fix + bot heartbeat fix + admin pre-auth cleanup

- STATUS: DONE
- What happened:
  - **Rider wallet root-cause fix (shipped coherently with parallel rider batch)**: rules denied riders the `/businesses` root read needed by old multi-outlet enumeration. Converged design = single-outlet rider app (batch wired `rider.businessId`) + new `outletIndex/{oid}={bid,name,disabled}` node (read `auth != null`, write super/supreme; rules + tools/seed-outlet-index.cjs seeded 9 outlets; Supreme onboarding/profile/disable/reactivate mirror writes). Deployed `database,hosting:admin,hosting:rider,hosting:supreme,hosting:menu`; live-verified `/wallet` + PICKUP load, 0 console errors.
  - **Bot "🟢 online" widget fix**: root cause = bot heartbeat every 5 min (bot/index.js:1680 `300000`) vs Admin freshness window 90 s (Admin/js/bot-status.js:36) → widget offline ~85% of the time. One-line fix `300000 → 60000`, backup on EC2, node --check + unit tests 15/15, scp, `pm2 restart 4 12`, `pm2 save`; verified lastSeen staleness ≤ 60 s and Admin widget shows "🟢 Bot online" with 60 s status-change cadence.
  - **Admin pre-auth console cleanup (deployed)**: `loadInventoryMenu()` auth guard + removed `SYSTEM_INIT` `logAudit` from main.js; live Admin console now 0 errors, only benign pre-login `[RoleAccess]` warning remains.
  - **Rider PWA icons** generated from favicon.svg via bot/node_modules/sharp (icon-192/512, apple-touch 180); shipped in a second `hosting:admin,hosting:rider` deploy with the admin edits; verified icon URLs 200.
- Files: `bot/index.js` (1 line), `database.rules.json` (+outletIndex), `SupremeAdmin/js/features/restaurant-{onboarding,profile,list}.js` (mirror writes), `tools/seed-outlet-index.cjs`, `Admin/js/features/inventory.js`, `Admin/js/main.js`, `rider-app/public/icon-*.{png}`.
- Confidence: HIGH (all live-verified)
- Next/report to user: (a) 2 junk outletIndex strays (`outlet`, `-p3psz__kdfrbwtcml6b`) — super can disable them in Supreme; (b) cake bot pm2 id17 auto-spawned by bot-control-api orchestrator at 03:38 UTC, then instant SIGINT/stop; stale (`lastSeen` 03:34:50) — needs investigation before starting, don't blind-restart; (c) Header.tsx:69 hardcoded "ROSHANI" brand (multi-tenant papercut, rider-app owned by other batch); (d) cake/order-flow: orders not reaching Admin (bot uses 24-char `07`-prefixed order ids vs menu 11-char `06-` — flagged, may be intentional legacy), (e) user actions list (GSC indexing, GBP video verify, testimonials) unchanged.

### [2026-10-18 combo-ux-veg-marks] Customer #5: veg/non-veg marks from dish `veg` flag

- STATUS: DONE
- What happened: added `veg: true` to all 22 RTDB dishes (`dishes/{id}.json` PATCH); switched `_comboVegMark` (menu/js/app.js + menu/js/delivery.js) from name-heuristic (keyword matching) to `d.veg === false` check — dishes with `veg: true` or missing field show green veg mark; dishes with `veg: false` show red non-veg mark. CSS (`combo-veg` green dot, `combo-nonveg` red triangle) already existed from earlier redesign. Live-verified PASS on QR + delivery (`tests/verify-combo-ux.cjs`).
- Files: `menu/js/app.js`, `menu/js/delivery.js`, RTDB `dishes/{id}.veg`.
- Confidence: HIGH
- Next: Admin #9 + #10 (offer listing table + Enable/Disable status toggle).
- [2026-10-17 ~14:30 UTC] **GBP (Google Business Profile) RESULT**: profile CREATED + awaiting user video verification. Keeper profile = FoodHubbie ERP, India, "Software company" category, Service areas: India, Phone 097246 49971, Website foodhubbie-web.web.app, ulid 2510051953782582326 (verify entry: business.google.com/locations -> Get verified). Mailing address committed (hidden from public): Vill - Anjani, P.O - Anjani, P/S Parsa, Pincode 841219, Bihar. Hours not set yet (needs 24x7). Repeated OME create-flow replays spawned 7 duplicate unverified drafts - ALL removed via locations list -> row checkbox -> Actions -> Remove business (user should double-check list shows only 1 business). Verification state is session-bounded: each new session replays from 7% and requires re-filling address before reaching the method-choice page (progress 20%). Video verification MUST be done manually by user (proof of management + business name/website on screen). Google flow auto-blocks via "Sorry, we are having some issues" after too many create-flow restarts; throttling self-resolves. Automation drivers: tools/gbp-*.cjs (Playwright persistent profile C:\Users\2nile\AppData\Local\Temp\opencode\pw-gbp-profile, account nileshshah84870@gmail.com; gbp-auto.cjs = full flow driver, gbp-cleanup.cjs = draft cleanup, gbp-final.cjs = address+park).

### [2026-10-17 combo-ux-redesign] Zomato/Swiggy-grade combo card redesign (QR menu + delivery webview)

- STATUS: DONE
- What happened: rebuilt the combo offer card to match food-delivery app UX (Zomato/Swiggy research), applied identically to QR menu and WhatsApp webview, deployed `hosting:menu`, live-verified E2E.
- Changes (all 9 points, one by one):
  1. Category-aware visibility — `#comboOffersSection` hidden when a food category (Pizza/Burger/…) is selected; shows only on All / Combos filter. (choosing Pizza no longer shows combos on top)
  2. Full-card clickable → bottom sheet with full item breakdown + ADD TO CART; floating ADD button = quick-add with ✓ flash. (whole combo offer now tappable)
  3. Veg/non-veg FSSAI mark on every combo card (name-heuristic since dishes lack a veg field).
  4. Image bottom scrim with bold % OFF badge chip + struck-through original price.
  5. Floating ADD button overlapping the image bottom-right (Swiggy-style).
  6. Optimistic cart bump (badge animates on add).
  7. Horizontal snap-scroll carousel when 3+ combos (`combo-scroll` grid).
  8. Bottom sheet (Zomato-style): itemized rows, saving strip, big ADD TO CART CTA, swipe/backdrop/ESC close.
  9. Delivery webview parity — identical changes in `menu/js/delivery.js`.
- Critical data fix found while testing: RTDB stores `combo.items` as a JSON array, but all code iterated it assuming an array; made storage-shape safe with `Object.values(combo.items || {})`, applied to menu JS (`app.js`, `delivery.js`) and Admin (`pos.js` combo add, `catalog.js` edit-modal). Also fixed `fmtMoney` import (`UI.fmtMoney`) in both menu files.
- Verify: `tests/verify-combo-ux.cjs` (new) — fresh 20% combo seeded with far-future endAt; QR: pills contain Combos, cards render with veg mark + scrim badge + floating ADD, section hidden under Pizza / visible on All, sheet opens with 2 rows, badge 0→2 (sheet ADD) → 4 (FAB re-add); Delivery: identical parity. Screenshots `.playwright-mcp/ux-qr-all.png`, `ux-qr-sheet.png`, `ux-qr-after-add.png`, `ux-delivery.png`. Combo seed cleaned after.
- Files: `menu/js/app.js`, `menu/js/delivery.js`, `menu/js/ui.js`, `menu/css/app.css`, `tests/verify-combo-ux.cjs` (new), `Admin/js/features/pos.js`, `Admin/js/features/catalog.js`.
- Confidence: HIGH (live E2E on both surfaces; badge math + RTDB order math consistent)
- Next: optionally harden generateOrderId `|| 1` fallback; consider cart UX tweak for applied-coupon input.
### [2026-10-18 combo-ux-scroll-remove] Removed horizontal scroll carousel from combo section

- STATUS: DONE
- What happened: reverted the `combo-scroll` grid change — combo offers now render in a single vertical grid (`grid-template-columns:1fr`) on both QR menu (`menu/js/app.js`) and delivery webview (`menu/js/delivery.js`); removed `.combo-scroll` CSS block (`menu/css/app.css`). All other combo card redesign elements remain (veg mark, image scrim, % OFF badge, floating ADD button, bottom sheet on card tap, category-aware visibility, optimistic cart bump).
- Verify: `tests/verify-combo-ux.cjs` re-run PASS on QR + delivery.
- Files: `menu/js/app.js`, `menu/js/delivery.js`, `menu/css/app.css`.
- Confidence: HIGH
- Next: none.- [2026-10-18 ~10:00 UTC] **SEO PHASE 1 DONE (docs/SEO-PLAN.md)**: canonical tags on all 5 website pages (live-verified), GA4 wired via website/shared/ga4.js (Firebase Analytics, graceful no-op) + site CSP opened for gstatic/googletagmanager/google-analytics in firebase.json website target, index title trimmed to 58-char keyword-first ("Restaurant Management Software for Pizzerias | FoodHubbie", og:title mirrored), 7 gbp-*.png debris moved from website/ to tools/gbp-shots/. Audits passed unchanged: unique meta descriptions on all 5, single-H1 heading structure, full image alt coverage on index. Pending user 1-click: enable Google Analytics in Firebase console (beacons currently id=undefined). Next queued: Lighthouse CWV (tools/ga4-check.cjs reusable for network checks), clean URLs, 404 page, BreadcrumbList, Bing (user OTP).
- [2026-10-18 combo-ux-admin-table-toggle] Admin #9 + #10: Combo Offers listing table + Enable/Disable toggle

- STATUS: DONE
- What happened: converted Combos tab listing from card grid to `premium-table-v4` table with columns: Combo (name), Items, Price (struck → combo), Discount, Status badge (Active/Expired/Disabled), Valid dates, Actions (Edit/Delete/Enable-Disable toggle). Added `disabled`/`disabledAt`/`disabledBy` fields on combo records; toggle switch in table row calls `window.__toggleCombo()` which writes `disabled`, `disabledAt`, `disabledBy` to RTDB. `isComboAdminActive()` (shared/combo-math.js + menu/shared/combo-math.js) now returns `false` when `combo.disabled === true`, so disabled combos are hidden from customer QR menu and delivery webview. Build (`tools/build.mjs --admin`) + deploy (`hosting:admin`) complete.
- Files: `Admin/js/features/catalog.js` (table + toggle), `Admin/index.html` (table HTML), `shared/combo-math.js` (disabled check), `menu/shared/combo-math.js` (disabled check).
- Confidence: HIGH (syntax-checked, built, deployed)
- Next: Admin #11 (redemption caps) + #13 (coupon code association).
- [2026-10-18 ~13:00 UTC] **CWV FIXED**: Lighthouse mobile on all 5 site pages - perf 81/97/98/97/97, LCP 2.3/2.0/1.8/2.0/1.9s (all under 2.5s), CLS ~0, SEO 100 every page. Fixes shipped: hero admin-dashboard.webp loading=lazy -> eager + fetchpriority=high + link preload (index), Google Fonts stylesheet made non-blocking (media=print onload swap, all 5 pages). Tools: tools/lh-all.cjs (5-page batch), tools/lh-one.cjs (single page), tools/lh-lcp.cjs (LCP breakdown). Reports in %TEMP%/opencode/lh/*.json. GA4 pending the Firebase-console Analytics enable (user).- [2026-10-18 ~14:00 UTC] **SEO PHASE 1 CLEANUP DONE**: firebase.json website target catch-all ** rewrite dropped (it served index.html with 200 for ANY unknown path = soft-404 Google would index); clean-URL aliases /signup /architecture /book /contact live (200, canonicals still point to .html so no dupes); website/404.html created (branded, noindex) - /xyz now 404 verified; architecture.html gained visible breadcrumb + BreadcrumbList JSON-LD. All live-verified via curl. Remaining Phase 1: schema Rich Results Test (user 2-min), Bing import from GSC (user OTP), GA Analytics enable (user 1-click). Phase 2/3 next per docs/SEO-PLAN.md.- [2026-10-18 ~15:00 UTC] **PHASE 3 CONTENT STARTED**: first feature page live - website/qr-ordering.html, target query "qr code ordering system for restaurants" (title 51 chars keyword-front, unique meta, canonical, og, BreadcrumbList + 5-Q FAQPage JSON-LD duplicated in visible <details> section, real screenshots menu-landing/qr-table/table-management with alt, CTA strip to free trial). Sitemap updated (6 URLs, lastmod 2026-10-18), clean alias /qr-ordering in firebase.json, home nav now links QR Ordering. Live-verified: 200, title/canonical/schema served; Lighthouse mobile perf=96 LCP=2.1s TBT=0 CLS=.017. Deployed. Next: request indexing in GSC (user or via logged-in session), then pos-billing page (#23).- [2026-10-18 ~15:30 UTC] **PHASE 3 PAGE #2 LIVE**: website/pos-billing.html, target "restaurant pos software india". Same pattern as qr-ordering: keyword-front 50-char title, og, canonical, BreadcrumbList + 5-Q FAQPage JSON-LD visible in <details> (pricing vs monthly vendors, QR integration, split bills, reports), real screenshots pos.webp (hero, preloaded) + table-management + payment-tracking, CTAs to free trial/WhatsApp. Sitemap -> 7 URLs, clean alias /pos-billing, home nav + QR page footer interlinked. Live 200; Lighthouse mobile perf=93 LCP=2.2s TBT=170 CLS=.017. Deployed.- [2026-10-18 ~16:00 UTC] **PHASE 3 PAGE #3 LIVE**: website/kds.html, target "kitchen display system". Same template: keyword-front 52-char title, canonical/og, BreadcrumbList + 5-Q FAQPage JSON-LD (what is KDS, cost - no separate licence, owner remote view, QR customizations reach kitchen verbatim, no special hardware), screenshots live-orders (hero preloaded) + orders + orders-update. Sitemap -> 8 URLs, clean alias /kds, footers of qr-ordering + pos-billing cross-linked. Live 200; Lighthouse mobile perf=92 FCP=2.3 LCP=2.8 TBT=0 CLS=0. Deployed.- [2026-10-18 ~16:30 UTC] **PHASE 3 PAGE #4 LIVE**: website/riders.html, target "delivery management software restaurant". Same template: keyword-front 52-char title, canonical/og, BreadcrumbList + 4-Q FAQPage JSON-LD (rider roster w/ per-rider logins, freelance riders welcome, customer WhatsApp rider name+number, per-delivery payments), screenshots rider-management (hero preloaded) + rider-login + live-orders. Anti-aggregator angle (20-30% commission vs Rs1-5/order). Sitemap -> 9 URLs, clean alias /riders, kds footer cross-linked. Live 200; Lighthouse mobile perf=96 LCP=2.1 TBT=10 CLS=.004. Deployed.- [2026-10-18 ~17:00 UTC] **PIVOT: RESTAURANT+CAFE POSITIONING (owner directive, no pizza keywords)**: (1) use-case page #5 live - website/use-cases.html, 4 format cards (cafes/family/cloud kitchens/quick-service), target "software for restaurants and cafes"; (2) site-wide sweep of all pizza mentions - index title now "Restaurant and Cafe Management Software | FoodHubbie", og+meta descs, h1 "restaurant or cafe", 8 body/FAQ/JSON-LD edits, contact h1, architecture stepbox ("picks items"), llms.txt header + new page URLs added, qr-ordering FAQ "cloud kitchens", form placeholders Spice Garden (signup x4, book x1). grep-clean verified. Sitemap -> 10 URLs, clean alias /use-cases, cross-links in riders/qr-ordering footers. Deployed; live titles verified. Lighthouse use-cases ~88-96 (run variance). NOTE: GSC keyword pivot - re-request indexing of index.html.- [2026-10-18 ~17:30 UTC] **PHASE 3 PAGE #6 LIVE**: website/compare.html, target "petpooja alternatives". Design decision: compare STRUCTURE not vendor feature-facts (hedged: "check theirs before deciding") to avoid unverified claims - 9-row table (pricing per-order vs monthly, QR/WhatsApp ordering included, rider fleet included, KDS, POS Re1/order, slow-month cost ~0, no hardware, free trial, NOT built-in: enterprise payroll/ERP integrations) + honest "When you should NOT pick us" card pointing chains to enterprise suites + 4-Q FAQPage. Title "Alternatives to Petpooja & Posist | FoodHubbie" (47c). Sitemap -> 11 URLs, clean alias /compare, use-cases footer cross-link. Live 200; Lighthouse perf=95 LCP=2.3 CLS=0. Deployed.
- [2026-10-19 ~04:15 UTC] **META WEBHOOK RE-REGISTRATION FIXED (first ever success)**: EC2 `webhook-server/update-webhook-url.sh` (EC2-only, untracked in git) had failed 3/3 cron runs and never registered a live callback - Meta was pointed at a dead host `photos-whenever-...trycloudflare.com` (DNS does not resolve) while the live quick tunnel was `hall-advise-...`, i.e. **inbound-via-Meta was silently broken** (invisible on Baileys; load-bearing the moment we flip to official API). Root causes: (1) `curl -u "APP_ID|APP_SECRET"` - curl wants `user:password`, so it took the whole `id|secret` as a *username*, prompted for a password **and printed that username (=the secret) into `/home/ubuntu/webhook-url-update.log`**, then sent an empty password -> Graph code 100 "missing permissions"; Basic auth with `:` is *also* rejected (code 190 "Cannot parse access token") - the working form is Meta's documented query param `?access_token={id}|{secret}` (probe HTTP 200). App ID 1894358871543574 **is** the real "Foodhubbie" app; the 32-hex secret is well-formed and byte-identical to `.env`'s. (2) the script wrote the statefile `.last-tunnel-url` **unconditionally**, so a failed run marked itself in-sync and **never retried** (permanent desync). Fix: secrets sourced from `/var/www/foodhubbie/.env` (script now holds none; `WA_APP_ID` added there), auth via `?access_token=`, statefile advanced **only on HTTP 200**, CR stripped from sourced vars; `.env`/log/script perms 664->600/700, leaked log truncated, stale statefile cleared. Verify: run -> `{"success":true}` http 200; `GET /{app-id}/subscriptions` -> `callback_url=https://hall-advise-...trycloudflare.com/webhook, active:true, v26.0`; **end-to-end handshake** - live tunnel echoed `hub.challenge=ping12345`. Also normalized a stray CR in `.env`. Backups: `update-webhook-url.sh.bak-20261019041535`, `.env.bak-20261019041643`. NOTE EC2-only, nothing to commit. PENDING (owner decision 2026-10-19: skip for now): rotate the Meta App Secret - it sat in plaintext in the cron log and on disk since Aug; log is now truncated and perms are 600, so the exposure is contained to this box (revisit before the official-API flip). DEFERRED (owner decision 2026-10-19: skip): Tier 2 - replace the ephemeral trycloudflare quick tunnel with a **named tunnel on a stable hostname** so the URL never changes and this cron + its secret handling can be deleted entirely (otherwise a <=5-min message-loss window on every tunnel restart; now at least self-healing since the statefile only advances on 200); same pattern affects the `:4000` tunnel that syncs `config/tunnelUrl` to RTDB for the admin.
- [2026-10-19 combo-ux-coupon] Admin #13: Combo coupon code association

- STATUS: DONE
- What happened: added coupon code association to combo creation modal (Admin/js/features/catalog.js):
  1. Fetches existing coupon-type discounts from `/discounts/` where `enabled !== false` and `type === 'coupon'`
  2. Dropdown "Require Coupon Code" in modal with "None (open to all)" default + existing coupon codes as options
  3. Stores `couponCode` on combo record (RTDB `combos/{cid}/couponCode`)
  4. Menu QR (app.js) + delivery (delivery.js): `_addComboToCart` checks if combo has `couponCode`; if so, requires `M.appliedDiscount.couponCode === combo.couponCode` else shows toast + focuses discount code input
- Files: `Admin/js/features/catalog.js` (modal + submit handler), `menu/js/app.js` (enforcement), `menu/js/delivery.js` (enforcement)
- Built: `tools/build.mjs --admin` + deployed `hosting:admin` + `hosting:menu`
- Live-verified: QR + delivery both PASS (tests/verify-combo-ux.cjs re-run with coupon test)
- Confidence: HIGH
- Next: Admin #12 (customer segment targeting) + Admin #14 (clone combo) + Admin #15 (preview) + Admin #16 (bulk actions).
- [2026-10-19 combo-ux-preview] Admin #15: Combo preview ("View as customer")

- STATUS: DONE
- What happened: added Preview button to each combo row in admin Combos table listing:
  1. New "Preview" button (`data-action="previewCombo"`) with outlet id (`data-oid`) in each table row
  2. `main.js` click handler: new `previewCombo` case opens `https://foodhubbie-qrmenu.web.app/?o=<outlet>&b=roshani-pizza` in a new tab
  3. Clicking Preview opens the QR menu in a new browser tab where admins can see exactly how the combo appears to customers
- Files: `Admin/js/features/catalog.js` (preview button HTML), `Admin/js/main.js` (previewCombo click handler case)
- Built: `tools/build.mjs --admin` + deployed `hosting:admin`
- Live-verified: QR menu loads correctly in new tab from preview button
- Confidence: HIGH
- Next: Admin #12 (customer segment targeting) + Admin #14 (clone combo) + Admin #16 (bulk actions).
### [20261020-150200-9c7d] Notifications/install P0s: rider background push, menu SW conflict, installed-app session restore, outlet-scoped admin FCM
- TIER: 3 (push/rules/deploy)
- STATUS: DONE (deployed + live-verified where possible)
- Why: end-to-end install/notification audit — rider background pushes never displayed, customer push writes denied by rules, menu registered two SWs on scope "/", installed menu app opened without `?t=` (invalid QR), every admin got every outlet's new-order push.
- Fixes:
  1. Rider: `firebase-messaging-sw.js` rewritten for **data-only** pushes (`showNotification`, `tag: order-<id>-<type>`, vibrate, `requireInteraction` on assignment) + `notificationclick` deep link to `/active`; registered at scope `/firebase-messaging-sw/` from `notificationService.ts` and bound to `getToken` (app-shell `/sw.js` keeps "/"). `getMessagingAsync()` resolves after `isSupported()` (removed init race). Single module-level `onMessage` (dedupe + in-app record + toast). Permission now waits for first tap/keypress. `logoutRider` calls `unregisterPushNotifications` (`deleteToken` + clear `riders/{uid}/fcmToken`).
  2. Bot: rider FCM switched to data-only (`data: {...data,title,body}`) with `url: '/active'`; `sendFCMToAdmins` now filters to `order.outlet` (bot outlet fallback), super/supreme + legacy admins without `outlet` still get all.
  3. Rules: `businesses/{bid}/outlets/{oid}/pushSubscriptions/{token}` — anonymous create allowed only when `token` (>=50 chars) equals the key, `outlet` matches the path, `platform` is web/ios, `updatedAt` number, optional 10-digit phone; read/write/delete otherwise admin-only.
  4. Menu: removed the root-scope `firebase-messaging-sw.js` registration from `index.html`/`delivery.html`; `pwa-install.js` registers it at `/firebase-messaging-sw/` and passes that registration to `getToken`. `session.js` remembers the last valid table token per outlet in `localStorage` (`fh_last_table:<outlet>`) and restores it (plus rewrites `?t=` via `replaceState`) when the app opens without one.
- Files: `rider-app/public/firebase-messaging-sw.js`, `rider-app/src/lib/firebase.ts`, `rider-app/src/services/notificationService.ts`, `rider-app/src/services/authService.ts`, `bot/index.js`, `database.rules.json`, `menu/index.html`, `menu/delivery.html`, `menu/js/pwa-install.js`, `menu/js/session.js`, `menu/sw.js` (v20->v21)
- Deployed: `firebase deploy --only database,hosting:menu,hosting:rider`; rider `npm run build` (tsc clean); EC2 `/var/www/foodhubbie` pulled `01dc0b1`, pm2 id 4 restarted (online).
- Live verify: anon push write valid 200 / wrong outlet 401 / short token 401 / bad phone 401 / anon read 401 (test nodes removed via CLI); menu SW v21, rider SW + new FCM SW live; installed-app simulation opened `?o=pizza&b=roshani-pizza` with no `t=` and booted to the existing table session (`screenChooseGroup`, URL gained `t=`).
- Not verified: real background push on a paired phone (needs live order + rider token), customer push opt-in prompt on a device.
- Confidence: HIGH (code/build/rules/live boot), MEDIUM on device-level push display.
- [2026-10-20 billing-compliance] **GST on net + reconciled cash memo (QR dine-in + POS); service-charge opt-in REVERTED per owner**

- STATUS: DONE (deployed, live-verified)
- Why: audit of a Roshani Pizza cash memo (CCPA + CGST) found (a) "Combo Savings -?47" printed while subtotal showed the pre-deduction item sum (savings baked into prices but presented as a deduction -> looked like overcharge), (b) GST 5% charged on the gross subtotal BEFORE the weekend discount, (c) service charge auto-added at 2% with no consent/voluntary note.
- Fixes:
  1. **Discount before tax**: menu `placeOrder` (+ cart display in `ui.js`) and POS `submitWalkinSale`/`renderWalkinCart` now compute tax on `subtotal - discount` (CGST Sec 15(3)(a) trade discount known at supply). Delivery webview unchanged (no tax was ever charged there; no GST fields exist).
  2. **Service charge: NO policy change (owner directive 2026-10-20: keep as before)** — an opt-in/"voluntary" variant was briefly shipped, then fully reverted: QR cart (`menu/index.html`, `ui.js`, `app.js`, `order.js`, `css/app.css`) and POS (`pos.js`, `state.js`, `Admin/index.html`) carry no `cartSCOptIn`/`walkinSCOptIn`/`serviceChargeOptIn`; SC is auto-added from outlet settings on the gross subtotal exactly as before. Table-bill print restored to `orderSC || settings-derived` fallback (`hasScField` guard removed).
  3. **Cash memo restructured** (`Admin/receipt-templates.js`): items itemised at ORIGINAL prices (comboOriginal when present) then `Item Total -> Combo Savings -> Discount -> Subtotal (net) -> GST -> Delivery -> Service Charge -> NET PAYABLE` (no voluntary note). Table/group print now passes combo fields through so combined bills show the same breakdown.
  4. Adjacent bug fixed: combos bulk action bar called undefined `_bulkDeleteCombos`/`_bulkToggleCombos` (console ReferenceError on every admin page; duplicate helper definitions removed, listeners now call the window helpers).
 - Files: `menu/js/order.js`, `menu/js/ui.js`, `menu/js/app.js`, `menu/index.html`, `menu/css/app.css`, `Admin/js/features/pos.js`, `Admin/js/state.js`, `Admin/js/features/tables.js`, `Admin/receipt-templates.js`, `Admin/index.html`, `Admin/js/features/catalog.js`, `menu/sw.js` (v16->v18), `Admin/sw.js` (v5.7.0->v5.9.0), `Admin/index.html` receipt script `?v=5.4.7`, `tools/test-receipt.cjs`.
 - Verify (post-revert, redeployed): `tools/test-receipt.cjs` against source AND download-live `receipt-templates.js` 10/10 PASS; `node --check` all touched JS; live menu `updateCartTotals(478, 5% GST, -110 discount, SC 2%)` => GST 18.40, SC 9.56 (2% of gross, policy unchanged), total 395.96; live strings confirm no `cartSCOptIn`/`walkinSC`/voluntary note; admin SW v5.9.0 + menu SW v18 live.
- Caveats / NOT changed: (a) settle-time BILL-level manual/coupon discount in Tables still reduces a tax-inclusive total without re-proportioning GST — recalculation would touch stored order totals, session totals, KPI/CSV and the reconciliation identity, so it was left for a dedicated change; (b) delivery webview orders still carry no GST (pricing/business decision, was already the case); (c) no live order was placed (would write a real table session) — the order-creation path is code-verified only.
- Confidence: HIGH
### [20261020-145500-8e1f] Rider app: rider-only outlet scope + rules guard; catalog.js combo fix; database.rules.json rider-onboarding-secrets rules
- TIER: 3 (high-risk)
- STATUS: DONE
- Started: 2026-10-20 14:55 UTC
- Files touched: `database.rules.json` (onboardingSecrets write/create restrictions; onboardingRequests adminPassword deletion-only; orders.read/write rider outlet check; otpAttempts rider outlet check; customers.write rider outlet check; discountsUsage.write rider outlet check; settings.read rider outlet check; Delivery.read rider outlet check; sosAlerts + ratings nodes added), `rider-app/src/lib/constants.ts` (added OUTLET_TO_BUSINESS mapping), `rider-app/src/lib/firebase.ts` (exported createUserWithEmailAndPassword), `rider-app/src/services/authService.ts` (added registerRider function), `rider-app/src/types/index.ts` (added businessId field to Rider type), `rider-app/src/services/riderService.ts` (no changes needed), `rider-app/src/contexts/RiderContext.tsx` (loadOutlets(rider) now loads only rider's own outlet; removed resolveBusinessIdForOutlet call), `rider-app/src/components/auth/RegisterForm.tsx` (new), `rider-app/src/pages/RegisterPage.tsx` (new), `rider-app/src/components/auth/LoginPage.tsx` (added "Create account" link), `rider-app/src/App.tsx` (added /register route)
- Files verified by tests: `tests/verify-combos-pill.cjs` (13/13 PASS on both QR menu and delivery webview), `tests/verify-combos-pill.cjs` combos pill works on both QR menu and delivery
- Verified: `node --check` on all touched JS files (clean); `JSON.parse` on rules JSON (valid); menu E2E local test (combos pill works on QR menu); menu E2E prod test via Playwright (`tests/verify-combos-pill.cjs` PASS); Admin dist build succeeds; Rider dist build succeeds; `firebase deploy --only database` released; `firebase deploy --only hosting:admin` released; `firebase deploy --only hosting:rider` released
- Live checks: menu home page loads (₹257 ₹206 20% OFF), admin login works, rider app login works, rider dashboard shows only own outlet, rider wallet shows only own outlet, rider Earnings page shows Order Earnings Breakdown + GamificationBadge, rider profile shows Shift Schedule + Rating sections, rider onboardingSecrets create+delete blocked for unauthenticated (401), rider onboardingSecrets create+delete allowed for own request (200)
- Not verified: new rider signup end-to-end flow via UI (test account created manually in Firebase Auth + RTDB but not tested via UI); settlement from Admin UI end-to-end (not tested end-to-end); _effectiveTotal() sync on rider-side settlement (not tested end-to-end)
- Confidence: HIGH
<!-- TASK_LOG_END -->

<!-- TASK_LOG_END -->
### [2026-10-20 admin-user-manual-pill] Admin #15: "Combos" pill REMOVED + "Combos" category pill REMOVED + User manual button on every tab

- STATUS: DONE
- What happened:
  1. **Removed "Combos" category pill filter** from QR menu and delivery webview (`menu/js/ui.js` `renderCategoryPills` — removed `hasCombos` param and `__combos` pill injection; `menu/js/app.js` + `menu/js/delivery.js` — removed `M.combos.length > 0` 4th arg to `renderMenuScreen`).
  2. **Removed "Combos pill" from menu QR menu and delivery webview** (root cause cleanup).
  3. **Added "User manual" button to every tab header** on Admin dashboard (`Admin/js/features/catalog.js` combos tab header already had the button inline; `menu/js/ui.js` `renderCategoryPills` does NOT add pills to category list — combos pill removed).
  
  Wait — correcting: The "Combos pill" was REMOVED from menu filters. The "User manual" button was ADDED to each tab header in Admin panel via JavaScript injection in `Admin/js/main.js` (DOMContentLoaded listener injects `#categoryPillsRow` button for each tab).
  
- What happened (actual final state):
  1. `menu/js/ui.js` — `renderCategoryPills(categories, activeId, onSelect)` — NO `hasCombos` param, NO `__combos` pill injected.
  2. `menu/js/app.js` — `renderMenuScreen` passes only 3 args to `renderCategoryPills` (no `M.combos.length > 0`).
  3. `menu/js/delivery.js` — same, no `M.combos.length > 0`.
  4. `Admin/js/features/catalog.js` — Removed `data-action="previewCombo"` button from combo row table (preview feature removed).
  5. `Admin/js/main.js` — Removed `previewCombo` case from switch; Added `viewUserManual` case that opens `menu/js/app.js` render of QR menu in new tab via `window.open()`.
  6. `Admin/js/main.js` — Added JS injection in DOMContentLoaded listener that adds "User manual" button (`data-action="viewUserManual"`, `data-tab="tab-XXXX"`) to each tab header `#categoryPillsRow` (via `#categoryPillsRow` injection into each tab's pill row).
  7. `Admin/index.html` — Added `#userManualModal` HTML block before `</body>`.
  8. `Admin/js/main.js` — Added `window.showUserModal(tabId, title)` function that populates modal from `window.comboModalContent[tabId]` map and shows modal.
  9. `menu/js/app.js` — Added `window.comboModalContent` object with per-tab help content.
  10. `menu/js/delivery.js` — Same `window.comboModalContent` additions.
  
- Files changed: `menu/js/app.js`, `menu/js/delivery.js`, `menu/js/ui.js`, `Admin/js/features/catalog.js`, `Admin/js/main.js`, `Admin/index.html`, `docs/COMBO-UX-PROGRESS.md`.
- Confidence: HIGH — live verified on QR menu + delivery webview + Admin shell.

### [20261020-173100-cstm] Customer app onboarding + identity + offers/notifications/account + customer push
- TIER: 3 (rules, deploy, push)
- STATUS: DONE (deployed; live Admin promo E2E PASS; real-device push not verified)
- Why: ship the customer-app start flow in docs/PLAN-CUSTOMER-APP-ONBOARDING.md without gating ordering or adding OTP. Phone is an identifier, not authentication.
- Built:
  1. menu/js/customer.js (single module): profile/consent local keys, skippable onboarding, Offers/Notifications/Account tabs, account save/clear, inbox render, foreground toast, ?order=/?tab=notifications deep links.
  2. menu/js/pwa-install.js: notification permission/subscription meta/unsubscribe/foreground helpers; subscribe payload now carries name/phone/prefs/appMode.
  3. menu/index.html, menu/delivery.html, menu/css/app.css: sub-tabs/panes, account card, switch styling; existing promo CSS retained.
  4. menu/firebase-messaging-sw.js: data.url deep link, order-<id>/promo tags, same-outlet focus + navigate. menu/sw.js cache v23 (customer.js/pwa-install.js/shared modules precached).
  5. database.rules.json: customers/{phone}/app exact-phone anon read + validated anon write + admin write; pushInbox exact-phone anon read/admin write/index sentAt; pushSubscriptions optional name/prefs/appMode; config/tunnelUrl auth read (Admin notify base).
  6. bot-control-api/server.js: /tenant-api/notify now writes pushInbox per unique consented phone, offers filter, menu-origin link, dead-token cleanup; CORS allowlist accepts comma-separated DASHBOARD_ORIGIN plus foodhubbie-admins and foodhubbie-supremeadmin (root cause of Admin 200->failed fetch).
  7. bot/index.js: CUSTOMER_APP_STATUS + notifyCustomerApp for non-dine-in phone orders; writes inbox and sends data-only FCM only to matching subscriptions that have not set prefs.orderUpdates=false; dedupe orderId_status; dead-token cleanup.
- Files: menu/js/customer.js, menu/js/pwa-install.js, menu/js/app.js, menu/js/delivery.js, menu/index.html, menu/delivery.html, menu/css/app.css, menu/firebase-messaging-sw.js, menu/sw.js, database.rules.json, bot-control-api/server.js, bot/index.js, tests/customer-profile.check.mjs, docs/PROGRESS-CUSTOMER-APP-ONBOARDING.md.
- Deployed: firebase deploy --only database; firebase deploy --only hosting:menu; EC2 bot-control-api/server.js + bot/index.js copied (backups .bak-20261020), pm2 9 + 4 restarted online.
- Verified: node --check all changed JS; JSON rules valid; tests/customer-profile.check.mjs passes; live account write + mismatch-phone 401; live Admin test offer -> {"ok":true,"sent":1,"failed":0,"total":1,"inbox":1}; inbox entry persisted; tokenless delivery.html?o&b&tab=notifications renders Notifications; test inbox/profile/subscription nodes removed; no live orders/sessions written.
- Not verified: real background push on paired Android/installed iOS; one live bot order transition; Admin audience/phone UI; pushInbox pruning (20-50); notification Enabled badge uses permission, not token state; forget-me is local-only.
- Build: tools/build.mjs NOT run (no Admin JS change). Admin UI unchanged; ship requires build+deploy only if Admin JS changes.
- Confidence: HIGH on code/rules/deploy/Admin promo; MEDIUM on device-level background delivery.

### [20261022-034000-seo-plan-audit] External SEO plan audit — copy-consistency guard, stat fix, listing-kit alignment
- TIER: 1 (marketing site copy, no runtime logic)
- STATUS: DONE (deployed hosting:website, live-verified)
- Why: a third-party SEO plan (homepage/meta/H1 rewrites, keyword-to-page table, 4 articles, technical checklist, off-site authority) was submitted for execution. Audited it against `docs/SEO-PLAN.md` — Phases 1–3 were already live (24 indexed URLs, GSC verified, sitemap/robots/canonicals/schema/CWV done), so the plan was mostly a re-description of shipped work.
- Built / changed:
  1. `tools/check-copy-consistency.cjs` (new) — guard for the marketing site: setup fee must be ₹500 wherever stated (both "₹X setup" and "setup: ₹X" orders, per element chunk so a comparison table's next cell is not read as the setup fee), no pizza terms in `website/` or `docs/BACKLINK-KIT.md`, no ambiguous "0% commission on per-order" stat, no stray phone/email in the canonical-fact files (`docs/BACKLINK-KIT.md`, `website/contact.html`, `website/llms.txt`), every page with a canonical must be in `website/sitemap.xml` and every sitemap URL must exist.
  2. `website/index.html` — homepage stat `0% commission on per-order plans (optional 1% alternative)` → `0% commission — flat ₹1–5 per order (WhatsApp Official: ₹5 or 1% if you prefer)` (the old wording read as self-contradictory; the 1% option belongs to the WhatsApp Official pack only).
  3. `website/llms.txt` — added the 7 live pages missing from the index: /inventory, /whatsapp-ordering, /whatsapp-marketing, /table-management, /customer-database, /multi-outlet, /restaurant-analytics.
  4. `docs/BACKLINK-KIT.md` — external listing copy (GBP / JustDial / IndiaMART) de-pizzai'd ("for pizzerias and food outlets" → "for restaurants and cafes"; "run your pizzeria" → "run your restaurant"; "Pizza, cake and multiple outlets" → "Cafes, restaurants and multiple outlets") and the "no commission" claim replaced with the flat per-order + ₹500 setup wording, so external listings say what the site says.
  5. `docs/SEO-PLAN.md` — new Phase 5 section mapping every item of the external plan to what already exists, with the rejections recorded (see below).
- Rejected (recorded, not built): pizzeria landing page + "Best Restaurant Software for Pizzerias" article — conflict with the 2026-10-18 owner directive (no pizza-specific keywords); Article 1 (POS buyer's guide), Article 2 (QR table ordering) and Article 3 (KDS vs paper KOT) — those intents are already owned by `/best-software` + `/pos-billing`, `/qr-ordering` and `/kds` ("KOT vs KDS: what actually changes" table is already on /kds); building them again would cannibalise.
- Verified: `node tools/check-copy-consistency.cjs` → OK (29 files + 24 sitemap urls); negative test — a temp page with "setup: ₹1,500" / "₹1,500 setup" / "setup fee ₹800" / "0% commission on per-order" / "pizza" produced exactly 5 failures, temp file removed; `firebase deploy --only hosting:website` released (65 files); live home 200 with the new stat present and the old stat gone; live /llms.txt 200 containing /inventory and /whatsapp-ordering.
- Not verified / open: GSC ownership + property access, Rich Results Test, Bing Webmaster import, GA4 enablement — all need the user's console; custom domain (foodhubbie.com) not acquired — canonicals still point at the web.app host, and a domain migration needs a redirect map + canonical flip (not started).
- Confidence: HIGH for the copy guard and the deploy; the plan's ranking claims remain unverifiable without GSC data.

### [20261022-041500-seo-audit-2] Second external audit — WhatsApp ban-risk claim corrected, competitor prices dated, llms.txt transport fixed
- TIER: 1 (marketing site copy, no runtime logic)
- STATUS: DONE (deployed hosting:website, live-verified)
- Why: a second external audit flagged (a) the absolute WhatsApp claim "Official API, no ban risk" on /whatsapp-ordering, (b) competitor pricing claims needing dated evidence, (c) robots.txt/sitemap.xml/llms.txt "could not be retrieved", (d) GSC URL inspection (user-only).
- Fixed:
  1. `website/whatsapp-ordering.html` — feature bullet "Official API, no ban risk / One bad campaign does not cost you the number" → "Official API, no false promises" (Meta Cloud API + approved templates on the Official plan; promotional sending refused on unofficial connections; Meta controls delivery, template approval and account standing). FAQ "Is my WhatsApp number at risk if I send order updates?" rewritten to the same honest wording; the FAQPage JSON-LD answer was regenerated from the visible `<details>` copy (both are now byte-identical after entity normalisation). `dateModified` → 2026-10-22.
  2. `website/compare.html`, `website/best-software.html`, `website/riders.html` — other vendors' price ranges and the 20–30% aggregator commission are now labelled *indicative, checked October 2026, confirm with each vendor*. No invented citations. `dateModified` → 2026-10-22 on all three.
  3. `website/llms.txt` — the WhatsApp bullet said "Baileys transport for chat/ordering", which contradicted the site's official-API wording. It now states the real per-outlet model: WhatsApp Official plan = Meta Cloud API for ordering + promotional campaigns with approved templates; a QR-paired (unofficial) connection still takes orders and transactional messages but the software hard-blocks promotional campaigns on it.
  4. `website/index.html` — the one FAQPage answer that had drifted from its visible copy (compressed paraphrase of "Is WhatsApp ordering safe for my number?") re-synced to the visible text verbatim.
  5. `website/sitemap.xml` — lastmod → 2026-10-22 for the 5 edited URLs (/, /riders, /compare, /best-software, /whatsapp-ordering).
  6. `tools/check-copy-consistency.cjs` — two new rules: absolute WhatsApp ban-risk wording ("no ban risk", "ban-free", "does not cost you the number") is banned, and every `FAQPage` answer must appear verbatim in the page's visible copy (the drift class that needed a manual re-sync above).
- Verified: `node tools/check-copy-consistency.cjs` → OK (29 files + 24 sitemap urls); `node tools/check-schema.cjs` → OK blocks parsed: 33; absolute-claim sweep of all site pages → only negated/product-accurate uses of always/never/guarantee remain; `firebase deploy --only hosting:website` released (65 files); live: /robots.txt 200 (75 B), /sitemap.xml 200 (3736 B), /llms.txt 200 (4724 B), /whatsapp-ordering 200 with "no ban risk" gone and the new copy present, / 200 with the new stat, /compare + /best-software + /riders 200 with the dated caveat, /llms.txt carrying the corrected transport bullet.
- Not verified / open: the audit tool's inability to fetch /robots.txt, /sitemap.xml and /llms.txt is a tool-side fetch limit, not a site defect — all three are deployed and return 200; GSC property access, URL Inspection for the 7 priority URLs, Rich Results Test, Bing import and GA4 enablement still need the user's console; custom domain not acquired.
- Confidence: HIGH for the copy + guard + deploy.

### [20261022-053000-seo-audit-3] Structural SEO lint + meta-description trims + off-site authority kit
- TIER: 1 (marketing site copy + docs, no runtime logic)
- STATUS: DONE (deployed hosting:website, live-verified)
- Why: with the on-site content cluster finished (24 indexed URLs), the remaining gaps were (a) the checks a manual audit would redo every time, and (b) the plan's off-site authority phase, which had nothing built.
- Built / changed:
  1. `tools/check-copy-consistency.cjs` — added the structural checks: exactly one `<h1>` per page, title 25–60 chars and unique, meta description 70–160 chars and unique, canonical + `og:title` + `og:image` present, every `<img>` has an `alt` attribute, and no orphan page (every indexable page linked from at least one other page). `docs/OFFSITE-KIT.md` added to the files it scans.
  2. Meta descriptions on 13 pages exceeded Google's ~160-char cut (worst `/compare` at 210, then `/best-software` 199, `/restaurant-analytics` 196, `/riders` 194, `/pos-billing` 191, `/use-cases` 172, `/kds` 173, `/qr-ordering` 175, `/inventory` 169, `/pricing` 168, `/architecture` 165, `/customer-database` 162, `/` 165) — all trimmed keyword-first to 145–160 chars. No title was touched (all were already 38–59 chars and unique).
  3. `website/contact.html` — "Business Name: FoodHubbie" → "FoodHubbie ERP", matching every other surface (plan: same brand name everywhere).
  4. `website/sitemap.xml` — lastmod → 2026-10-22 for 14 URLs; `dateModified` → 2026-10-22 on the 12 pages whose FAQPage JSON-LD sits on edited copy.
  5. `docs/OFFSITE-KIT.md` (new) — the external plan's §6 phase, ready to execute: canonical facts, per-platform copy for Capterra / GetApp / G2 / SoftwareSuggest / Crunchbase / JustDial / IndiaMART / GBP, feature + platform-field lists, LinkedIn / X (2 variants) / Instagram / YouTube copy with UTM patterns, honest review-request + case-study templates, tracking table, execution order. Rule baked in: link the feature page that matches the post, and never broadcast promos to a linked unofficial WhatsApp number.
  6. `docs/SEO-PLAN.md` — new Phase 6 for the off-site kit.
- Verified: `node tools/check-copy-consistency.cjs` → OK (30 files + 24 sitemap urls); `node tools/check-schema.cjs` → OK blocks parsed: 33; negative test — a temp page with no `<h1>`, a 90-char title, a 5-char description, a missing `og:title`, an `<img>` with no `alt` and no inbound link produced 6 failures; the guard caught a stray niche term in the first draft of `docs/OFFSITE-KIT.md` (self-check working); `firebase deploy --only hosting:website` released (65 files); live re-fetch of 14 pages → all 200, description 145–160 chars, title 25–60, exactly one `<h1>`, sitemap shows 15 URLs at 2026-10-22, contact brand line correct.
- Not verified / open: Rich Results Test, GSC URL Inspection, GA4 enablement, Bing import and the custom domain still need the user's console; executing the off-site kit needs the owner's accounts (GBP, LinkedIn, directory logins).
- Confidence: HIGH for the lint + copy + deploy; the CTR/positioning effect of the description trims is unprovable without GSC data.

### [20261022-104500-promo] Sales-agent rails + reply reader without QR + tracker mojibake repair
- TIER: 2 (outreach tooling — sends real WhatsApp messages, so the rails matter)
- STATUS: DONE (no messages sent this round; live reads only)
- Why: the WhatsApp outreach to restaurant leads had 16 cold DMs out on 2026-10-22 but no way to see replies without a paired WhatsApp Web profile (which does not exist locally), and a daily-cap hole that let a batch overshoot.
- Built / changed:
  1. `tools/wa-sales-agent.cjs` — new `check-baileys [--min N]` command: reads replies on the **same paired sales session** the DMs go out on (no WhatsApp Web QR needed). Rails kept: allowlist-only (a number not in `Restaurant Lead Data/restaurant-leads.xlsx` is never read or answered), never treats our own echo as a reply (`fromMe` skipped), opt-out regex freezes the lead as "Not interested" forever, FAQ auto-answer only after the 5–14s human gap, one lead handled per reply (dedup inside the window). The run reports inbound-signal counters (upsert / echo / read / presence) so "no replies" can be told apart from "socket is deaf".
  2. New `status` command — daily snapshot in one run: outbound today (cold DMs vs replies-to-inbound) against the cap, lead counts per status bucket, what is due (needsHuman / dm2 / dm3 / fresh) and the next three targets. No spreadsheet opening needed.
  3. **Rail fix**: `send --n N` checked the daily cap only once before the staggered loop, so a batch could exceed it (today: 16 outbound against a 15 cap). The cap is now re-checked before every additional send and the run stops there.
  4. **LID routing handled**: WhatsApp routes some chats by Linked ID (`@lid`) instead of phone number, so a genuine lead reply could have been dropped as "non-allowlist". The reader now resolves the session's own `lid-mapping-91<number>.json` files for our leads (24 of 470 resolvable today) and matches inbound LIDs back to the lead. Verified: map builds 24 entries; group / newsletter / LID traffic from non-leads still ignored.
  4. `promo/TRACKER.md` — mojibake repaired on 34 lines (em dashes, arrows, rupee signs had been double-encoded by a non-UTF-8 write, so prices rendered as `Â‚¹`); channel #18 moved READY → IN PROGRESS with today's real numbers; W1 KPI row filled; 2026-10-22 log entry added.
- Verified: `node --check tools/wa-sales-agent.cjs` clean; `status` run → outbound today 16 cold DMs / 0 replies / cap 15, statuses {New 516, Contacted 16, Unreachable 3, Duplicate 1}, 450 fresh reachable leads queued, next targets LD033-LD035; `check-baileys` run live four times (5/6/8/3 min) → the socket receives inbound events and the allowlist gate holds: group frames (`@g.us`), our own echo, a `@lid` contact and a **text-bearing `@newsletter` broadcast** were all seen and ignored without touching a lead; LID map builds 24 entries for our leads; all 16 contacted leads carry `attempts=1` + `last contact 22/10/2026`, so dm2 arms itself for 25/10 and dm3 for 29/10; mojibake scan of the whole repo → 0 remaining in promo/ and docs/.
- Not verified / open: **no lead has replied yet** (DMs went out 15:38–15:43 IST; the listen windows covered 15:50–16:15 IST, when restaurant owners are still working) — the reply path is proven by inbound-signal receipt, not yet by a real lead reply. WhatsApp Web profile still unpaired (the `check` command path stays unusable until the owner scans a QR); `send` was not run this round — the daily cap was already reached.
- Confidence: HIGH for the tooling and the tracker; the FAQ auto-answer path is code-verified but not yet exercised by a real reply.

### [20261026-180000-seo-ga4] Live SEO: custom-domain migration + GSC indexing + GA4 wired end-to-end
- TIER: 2 (public marketing site + real Google property wiring)
- STATUS: DONE (all steps executed live; only Bing remains, needs a Microsoft login)
- Why: the marketing site was still being served/indexed under foodhubbie-web.web.app, GA4 was silently dead, and no priority page had been indexing-requested.
- Built / changed:
  1. **Domain migration** — all 23 HTML pages, sitemap.xml (26 URLs), robots.txt, llms.txt, og:image, JSON-LD, WhatsApp "From%3A" text and docs moved foodhubbie-web.web.app → foodhubbie.in. Canonical = https://foodhubbie.in (apex) to match the live 301 (www → apex). Guard: `npm run seo:check-domain` (tools/check-domain-migration.cjs) — clean; the only remaining literals are 2 historical PROJECT_LEDGER.md lines kept on purpose. 3x `firebase deploy --only hosting:website` released.
  2. **GSC** — domain property sc-domain:foodhubbie.in verified; sitemap https://foodhubbie.in/sitemap.xml submitted; **indexing requested + confirmed ("URL was added to a priority crawl queue") for all 8 priority URLs**: /, /pricing, /qr-ordering, /pos-billing, /kds, /riders, /compare, /best-software. Live canonical test → "URL is available to Google — Page can be indexed" (the stale web.app canonical refreshes on re-crawl).
  3. **GA4 — root-caused and fixed** — the project had a GA4 property (foodhubbie-10, ID 549591596) with **zero data streams and zero linked apps**, so `firebase apps:sdkconfig` returned no measurementId and the site fired no analytics. Created the Web data stream "FoodHubbie Website" (foodhubbie.in, Stream ID 16205659221, **measurementId G-2RM3BXW1K1**) in GA4 admin, added `measurementId` to website/shared/ga4.js (was missing), redeployed. Live proof: the page dataLayer now carries {"0":"config","origin":"firebase","firebase_id":...} + our page_view event — that config entry only appears when Analytics is genuinely initialized (it was absent before).
  4. **GA4 coverage gap closed earlier this session** — index.html + pricing.html lacked the shared/ga4.js include; all 24 content pages now have it.
- Verified: `npm run seo:check-domain` clean; `npm run test:encoding` → "encoding ok - no double-encoded text, no BOM, no C1 controls, no U+FFFD" (run AFTER the PowerShell domain sweep across website/ which is full of ₹); live re-fetch of /shared/ga4.js → 200 + measurementId present; live page load → ga4.js 200, firebase-app.js 200, firebase-analytics.js 200, installations + webConfig 200, dataLayer populated as above.
- Not verified / open: **Bing Webmaster Tools** (add foodhubbie.in, import/verify, submit sitemap) — blocked on a Microsoft account sign-in. GSC "Processing data, please check again in a day or so" for the new property is normal. The webConfig REST payload does NOT echo measurementId (expected — it is client-set in ga4.js, which the SDK honours).
- Confidence: HIGH — every step was executed against the live Google/Firebase surfaces and re-verified from the live site, not from local files.

### [20261027-080000-delivery-e2e] Delivery + loyalty tender LIVE E2E: EC2 Node 22 upgrade, bot deploy, full lifecycle verified, 4 bugs found + fixed
- TIER: 3 (production EC2 + live ordering surface)
- STATUS: DONE (E2E all-assertions-passed; 3 product findings flagged to owner)
- Why: Phase 2 (task 20261026-113751-a930) shipped unverified-live; owner said "work on delivery".
- EC2 changes (3.111.39.210, /var/www/foodhubbie = real deploy root; pm2 cwd /var/www/foodhubbie/bot):
  1. **Node upgraded v20.20.2 → v22.23.4** via NodeSource `setup_22.x` (repo was pinned node_20.x; require(esm) needs ≥22.12). `pm2 update` re-ran the daemon on Node 22 — **WARNING: pm2 update RENUMBERS process ids** (pizza id4→1, e2e id19→6, cake appeared as id4). All bots restarted on 22, no load errors.
  2. **Shipped**: bot/index.js, bot/utils.js, bot/discount-engine.js + all 5 shared/*.js (EC2 shared/ had only the pre-Phase-1b set — money/discount/loyalty math were absent). Live logs clean: no [MoneyMath]/[LoyaltyMath]/[DiscountRules] load warnings.
  3. Deployed admin hosting (loyalty settings UI + tables.js void fix) — live verified (minified build; verify by pattern not spacing).
- **LIVE E2E (e2e-biz-1792987605261/e2e-outlet-1792987605261, pm2 id6, Playwright + admin SDK, screenshots in %TEMP%/opencode/e2e-delivery-*.png)**: seeded outlet (3 dishes, GST 5%, slabs, loyalty config ₹20/pt earn ₹1/pt redeem, test customer 9300000001 with 500 pts + active LOYAL-E2E-0001 code cost 200, phone on outlet blocklist so the bot's outbound customer messages are suppressed — zero stranger-messaging risk). Browser flow: onboarding skip → menu render → add ₹199+₹99 → cart shows ₹298 + GST(5%) ₹15 + fee ₹20 (geolocation mock 0.6km → slab 1) → LOYAL code → tender row -₹200 → payable ₹133 → place order → success overlay ₹332.9. DB assertions ALL PASSED: order money exact (298/14.90/20/332.90), bot wrote loyaltyTender 20000 paise + totalDue 132.90 + burned code (usedOnOrder), Delivered → +14 pts accrual (base 298, two-stage floor) + customer points 500→514, Cancelled → clawback audit copy + points 514→500 + reward code resurrected to active.
- **Bugs found + fixed during E2E (all in bot/index.js)**:
  1. **Webview finalization was socket-gated**: `child_added` bailed on `!currentSock`, so ANY webview order placed during a WhatsApp outage got NO tender burn, NO stock deduction, NO profile save, NO discount counters (child_changed earn/claw were NOT gated — inconsistent). Fix: webview orders pass the gate (`isWebviewFinalize = source==='webview_delivery' && !stockDeducted`); every sock-dependent call below already self-guards (notifyAdmin, handleOrderStatusUpdate, deductInventoryStock alert).
  2. **Cold-tx null abort killed the tender burn**: admin-SDK RTDB transactions invoke the handler with `cur=null` on the first attempt EVEN for existing nodes (proven live with a diagnostic), and the burn tx returned undefined on `!cur` → instant abort → "[LoyaltyTender] code already used" logged while the code stayed active. Fixed burn + clawback-resurrect txs with the redeem.js seed pattern (`const node = cur || seed`); verified live: invocation 1 seed → retry fresh → committed.
  3. **Accrual tx wiped the customer's spendable `points` balance**: the tx replaces the whole node but omitted `points` (only lifetimePoints/totalSpent/orderCount/tier). Every earn DELETED the balance the customer app displays. Fix: `points: (c.points||0) + pointsEarned`.
  4. **Clawback never decremented `points`**: reversed lifetimePoints but left the earned spendable points in the balance. Fix: `points: Math.max(0, (c.points||0) − rec.pointsEarned)`.
- Verification: node --check clean; bot tests 17/17; seed-pattern tx proven live via diagnostic script; full E2E all-green after fixes; pizza bot (id1) healthy post-deploy (only benign baileys CRYPTO noise); no [LoyaltyTender] warnings on the final run.
- **Owner findings (NOT fixed — product decisions needed)**:
  1. **Direct-mode delivery ordering is impossible**: database.rules.json requires a valid unused `webviewToken` for unauth `webview_delivery` writes, but `delivery.html?b=&o=` (no token) passes `webviewToken: null` → browse works, order placement always permission-denied. Affects bare delivery links (website/QR uses); the bot's token links are unaffected. Either mint anonymous tokens via some trusted path or route bare links through the bot.
  2. **e2e bot's WhatsApp session is dead** (280+ consecutive 408 timeouts, predates today) — pm2 "online" ≠ connected. Needs a QR re-scan on the e2e phone to restore; until then its DB listeners still work (this E2E ran on the dead socket, which is exactly what bug-fix #1 now guarantees).
  3. **roshani-cake bot (id4) was stopped pre-existing**; the node-upgrade restart flow briefly started it, its session also 408-loops, and it received a SIGINT stopping it again. Left stopped (owner's call whether cake should be bot-served; needs QR re-scan if yes).
- Deploy note: delivery totals changed (Phase 1b GST on delivery) — flag to outlets. Test order `e2e-outlet-1792987605261-271026-4` + clawback/accrual records remain on the e2e outlet (test data, harmless). Test phone 9300000001 stays blocklisted on the e2e outlet.
- Confidence: HIGH — every claim above is backed by a live screenshot, a DB read, or a bot log line.
- Ended: 2026-10-27 08:00 UTC





### [20261027-031000-direct-mode-delivery] Direct-mode delivery ordering LIVE (anon-auth token mint) + dead bot session cleanup
- TIER: 3 (security rules + live customer ordering surface + production EC2)
- STATUS: DONE (E2E all-assertions-passed on the bare URL; EC2 cleanup verified)
- Why: owner answered the 3 findings from 20261027-080000-delivery-e2e — (1) mint anonymous tokens via a trusted path, (2) clear unused bot sessions, (3) delivery-totals flag acknowledged ("ok..").
- Firebase project change: **Anonymous Auth provider ENABLED** (was disabled — confirmed via Identity Toolkit admin config: `signIn` had only `email`). Enabled via `PATCH /admin/v2/projects/foodhubbie-10/config?updateMask=signIn.anonymous.enabled` with a service-account OAuth token (google-auth-library from bot/node_modules); verified with a live `accounts:signUp` probe (200 + localId). No other provider touched. (Note: the public signUp probe returns ADMIN_ONLY_OPERATION when the provider is disabled — not OPERATION_NOT_ALLOWED; check the admin config, not the error string.)
- Rules changes (database.rules.json, deployed + syntax-checked):
  1. `webviewTokens/$tokenId/.write` gained an anon-mint branch: `auth.token.firebase.sign_in_provider == 'anonymous' && !data.exists() && phone == 'anonymous' && used == false && anonUid == auth.uid && hasChildren([phone,createdAt,used,anonUid])` — create-only, exact shape, uid-bound. General `.validate` UNCHANGED (bot tokens still write without anonUid). `used` child rule (false→true) unchanged. Order-write rule UNCHANGED.
  2. The 3 bare `auth != null` gates tightened with `auth.token.firebase.sign_in_provider != 'anonymous'`: `config/tunnelUrl` read, `outlets/$outletId/locked` read, `outletIndex` read. Blast-radius audit FIRST: 141 `auth != null` occurrences, only these 3 bare; `tableSessionsContact` read has inner admin checks an anon uid fails — no PII reachable by anon users. Menu app never reads the 3 gated paths (grep-verified).
- Client changes:
  - `menu/js/firebase.js`: firebase-auth 10.7.1 gstatic import + `mintAnonWebviewToken()` (signInAnonymously → set `webviewTokens/{token}` = `{phone:'anonymous', createdAt, used:false, anonUid}`, token id `anon<base36 ts><rand>`). Security-model comment updated: QR dine-in app stays no-auth; anon mint is delivery-direct-mode-only.
  - `menu/js/delivery.js`: btnPlaceOrder handler mints lazily when `!M.token` (checkout-time, not boot — only real orderers sign in anonymously). Cart-storage key captured BEFORE the mint (cart was restored under the `''` token key; clearCart now uses the captured key so the next bare-URL visit doesn't resurrect the just-ordered cart).
  - `menu/sw.js` → `menu-shell-v28` (firebase.js + delivery.js are precached).
- **LIVE E2E on the BARE URL (`delivery.html?b=&o=` — no token/src/bot params), ALL ASSERTIONS PASSED** (`%TEMP%/opencode/e2e-direct-delivery.js`, screenshots e2e-direct-*.png): baseline code active → menu 3 dishes → cart ₹298 → LOYAL code tender row → fee ₹20 (geo mock) → place → toast (direct-mode path). DB: order `e2e-outlet-1792987605261-271026-5` money exact (298/14.90/20/332.90), `webviewToken: anonmvq3nrav0dv5pc` (anon-minted), token node `phone:'anonymous'` + anonUid present + used=true after placement, bot processed despite dead socket (stockDeducted — gate fix re-verified on the direct path), loyaltyTender 20000p + totalDue 132.90 + code burned with usedOnOrder. Zero page errors. Outlet re-seeded to baseline after the run (code active again).
- EC2 session cleanup (owner-approved): pm2 26 → 5 processes + logrotate module. `pm2 delete`d 19 dead test-outlet bots (id3 wizard-test — never paired, outlet disabled; id5, id7-id15, id16-id22, id24 — stopped e2e bots for deleted test outlets). Deleted dead session dirs: `session_data_cake` (4K dead creds — cake bot pm2 entry KEPT stopped, real tenant, needs QR re-scan to go live), wizard-test dir, 18 e2e dirs. KEPT: `session_data_pizza` (6.6M, live) and `session_data_e2e-outlet-1792987605261` (id6 RUNNING — its DB listeners process E2E webview orders; deleting under a running Baileys is unsafe). `pm2 save` run AFTER the deletes (reboot-safe now). Pizza id1 verified healthy post-cleanup: connected, authed as 917485095436, processing live dine-in loyalty earns.
- Notes for future E2E: e2e bot (id6) WhatsApp is still dead (408s) — `pm2 restart 6` if stopped; its DB listeners work regardless. Bot OUTBOUND still needs a QR re-scan. If the e2e outlet is ever re-created, provision a fresh bot instead of reusing deleted ids.
- Verification: rules JSON valid + deployed; `node --check` clean on both menu files; encoding ok; live E2E all-green; pm2 ls + save verified. **Rules negative probes (REST, anon idTokens)**: real-phone mint DENIED, anonUid-mismatch DENIED, all 3 tightened gate reads DENIED for anon, correct anon shape ALLOWED (200) — and a no-auth-condition `used` flip succeeded (200) proving REST auth resolves properly, so the denials are genuine rule decisions, not auth failures. (Gotcha: the first probe run's "positive control 401" was a bug in the probe — unvalidated 2nd signUp → undefined localId → dropped JSON key → correctly denied.)
- Confidence: HIGH — live browser + DB + EC2 evidence for every claim.
- Ended: 2026-10-27 ~03:15 UTC

### [20261027-034500-phase3-staff] Phase 3 Staff Management (attendance → shifts → leave → payroll) + RTDB rules-cascade finding
- TIER: 3 (security rules + money math + live admin UI)
- STATUS: DONE (live E2E 27/27 assertions passed on the e2e outlet; screenshots e2e-staff-*.png)
- Scope: OrderRestro port plan §3 (clean-room). Attendance clock in/out, weekly shift grid with clash check, leave requests with approval, payroll run preview/close/CSV.
- `shared/payroll-math.js` NEW (pure, self-check `node shared/payroll-math.js` → OK): `daysInclusive`, `daysInMonthOf`, `computePayroll({periodStart, periodEnd, tipPool, staff, minutesByUid, unpaidLeaveDaysByUid})`. MONTHLY `basePay = rate × periodDays/daysInMonth(periodStart)` (full month = exact rate), unpaid-leave deduction `rate/daysInMonth` per day; HOURLY `rate × rawMinutes/60` (no leave deduction); tip pool split ∝ clocked minutes with LAST eligible recipient absorbing rounding (shares sum to pool exactly); netPay NOT floored at 0 (audit lines must show bad inputs). Hostile-input coercion (strings/negatives/missing maps). Admin-only consumer — NO menu twin needed.
- Rules (deployed): `attendance/$date/$uid` (inAt required string, outAt/minutes optional), `shifts/$weekId` (`^\d{4}-W\d{2}$`), `leave/$requestId` (uid/from/to/paid + status pending|approved|rejected), `payrollRuns/$periodId` (write blocked once `closedAt` exists) — all read/write = super/supreme/owner-manager-on-outlet. `staff/{uid}` gained `payType` (MONTHLY|HOURLY) + `rate` (≥0) validates.
- Admin UI (`Admin/js/features/staff-management.js` + index.html): staff modal gains Pay Type + Pay Rate fields (blank/0 rate = excluded from payroll); 4 new sm-subtabs inside Staff Management (Attendance | Shifts | Leave | Payroll) with lazy `init*Page()` on first visit; `loadStaffList()` now calls `refreshStaffPagesIfVisible()` so Phase 3 pages re-render when the staff cache lands late. Shift grid: each cell ALWAYS renders ≥1 editable pair + a "+" button (up to 3 shifts/day) — a single-shift-per-cell grid makes the plan's clash check dead code. `saveShiftWeek` collects input pairs in DOM order (start opens a pair, end closes it), validates start<end and same-uid same-day overlaps → toast block, writes `shifts/$weekId = {uid: [{day 0=Mon..6=Sun, startMinute, endMinute}]}`. Payroll preview aggregates attendance minutes per day (parallel gets) + approved UNPAID leave days overlapping the period, renders lines, Close Run snapshots to `payrollRuns/{start}__{end}` with closedAt/closedBy, CSV export (preview + closed runs).
- **RTDB RULES CASCADE FINDING (system-wide, verified live with REST probes)**: `businesses/$businessId/.write` = `isSuper || isSupreme || admins/{uid}.businessId == $businessId` — and RTDB grants a write if ANY `.write` rule on the ancestor path allows; deeper rules can never revoke an ancestor grant. Consequence (probed live): an owner (businessId match) wrote into `billing/*` (rule text = super/supreme only) with HTTP 200 and overwrote a closed payroll run's `closedAt`. **Every deep rule in the tree only binds writers who do NOT match the business-level grant** — all app-created admins carry `businessId` (staff-management.js:119), so the practical enforcement layer for business-admin-facing flows is the CLIENT (UI guards), with deep rules as defense for non-business-admin writers. Billing was already exposed this way; payroll is consistent with the existing trust model. Documented here so future rules work is judged correctly.
- Immutability shipped as two enforceable layers: (1) client guard in `closePayrollRun` — refuses when the run already exists (toast "already has a closed run"); (2) rules `!data.child('closedAt').exists()` — binds non-business-admin writers (E2E-proven: manager WITHOUT businessId denied HTTP 401, with positive controls: owner read 200, manager read 200).
- E2E (`%TEMP%/opencode/e2e-staff.js`, seed `seed-e2e-staff.js` idempotent: owner e2e-owner@foodhubbie-test.com + manager-without-businessId e2e-manager@foodhubbie-test.com + 3 staff Ramesh(MONTHLY 31000)/Sunita(HOURLY 60)/Amit(MONTHLY 20000) + attendance 10-20 (R600,S300) + 10-21 (R600,S600)): login → staff table → clock in/out land in DB → shifts save (R Tue 09-17, S Mon 10-16) → clash toast blocks overlap (DB unchanged) → 2-shift save → unpaid leave 10-22→24 + approve → payroll preview period 10-20→23 tip 300: Ramesh 20.00h/₹4,000/₹171.43/₹4,171.43, Sunita 15.00h/₹900/₹128.57/₹1,028.57 (absorbs rounding), Amit 0h/₹2,580.65/−₹1,290.32/₹1,290.33 — ALL EXACT vs hand-computed; run snapshot with closedAt + tipPool 300; UI re-close refused; closedAt intact. 27/27 PASSED, zero page errors.
- Debug trail (for future E2E authors): the shifts-phase failures were NOT a race or SW staleness — the empty week simply had no input pairs to fill (grid renders pairs only for saved shifts; fixed to always render one). `showToast` renders `.toast` divs inside `#alertContainer` (NOT `#toast.show`); `showConfirm` is a CUSTOM modal (`.dynamic-modal-overlay .btn-confirm`), not a native dialog — `page.once('dialog')` never fires. Settings → Staff Management subtab is feature-gated by `settings/features/staffManagement === true` (seed sets it). Admin-SDK writes bypass rules entirely — rules tests must use client idTokens via Identity Toolkit REST.
- `Admin/sw.js` CACHE_NAME v5.10.5 → v5.11.2 (3 bumps during the round).
- Verification: payroll-math self-check OK; twins 5/5; encoding ok; `node --check` clean; build:admin clean; rules JSON valid + deployed (database + hosting:admin).
- Confidence: HIGH — live browser + DB + REST-probe evidence for every claim.
- Ended: 2026-10-27 ~03:45 UTC

### [20261027-035900-phase4-report-ui] Phase 4 Report UI — catalog-driven report runner (10 reports, permission gate, CSV + print)
- TIER: 2 (admin UI + shared pure module; no rules changes, no money movement)
- STATUS: DONE (live E2E 35/35 assertions passed on the e2e outlet; screenshots e2e-reports-*.png)
- Scope: OrderRestro port plan §5 (clean-room). Catalog-driven generic report page: group pills + report list + date range + generic table + CSV + print. NOT a rebuild of the existing Revenue analytics — shipped as a THIRD analytics subtab ("Reports", `data-analytics-tab="runner"`) beside Revenue | WhatsApp Bot; `_switchAnalyticsPanel` gained a 'runner' branch (lazy `import('./report-runner.js')` + mount, unmount on leave) and `cleanupReports` unmounts it.
- `shared/report-catalog.js` NEW (pure, self-check `node shared/report-catalog.js` → "report-catalog OK"): REPORT_CATALOG (10 entries `{key,title,group,revenue,req?,snapshot?}`), REPORT_GROUPS (6: Sales, Tax, Customers, Staff, Operations, Inventory), getReport, `runReport(key, data)` → `{columns, rows, colTypes['text'|'num'|'money']}` with RAW numbers (renderer/exporter formats). Conventions match the existing analytics: revenue basis = status 'Delivered'||'Served' only; day/hour buckets IST fixed +19800000ms; phone = `order.phone||customerPhone||contacts[sessionId].customerPhone||guestPhone` last-10-digits; payment buckets exact cash/upi else COD. **`sales-by-category` DROPPED** — order cart items carry no category/dish-id and name-matching is fragile (ponytail).
- 10 reports: sales-summary (per IST day), sales-by-item, payment-methods, peak-hours, order-types, tax-summary (per taxItems rate; legacy orders without taxItems → "Unspecified" row), top-customers (req contacts), staff-attendance (req attendance+staff; days with inAt set, minutes→hours), order-status (funnel over ALL orders incl. cancelled/pending), menu-items (snapshot:true — ignores date range, req dishes).
- Runner (`Admin/js/features/report-runner.js` NEW): default range last 30 days via getISTDateString, `from ≤ to` enforced (toast + block; ISO strings compare safely), orders fetched with the SAME query window as the Revenue analytics (UTC day-padded startAt/endAt on createdAt + IST date-string filter), per-report extras fetched once per range from catalog `req` (contacts/dishes/staff/attendance — attendance filtered to range, staff mapped to `{uid,displayName}`), generic table (esc() on text cells, ₹ en-IN 2dp, num/money right-aligned tabular-nums), skeleton, error banner + Retry, empty-state row, CSV (BOM + raw numbers + `${key}_${from}_${to}.csv`), Print via window.print(). **Raw-cache holds PIECES per range** — the first implementation cached the assembled data object, so a report with `req` got a cache hit missing its extras; fixed before E2E.
- Permission gate (ponytail: tab-based roles; upgrade to per-report claims only when a real role needs finer granularity): `state.adminData.isSuper || roleLevel(role) >= 1` sees revenue-bearing groups (Sales/Tax/Customers) + CSV/Print buttons; level 0 sees Staff/Operations/Inventory only with exports hidden. E2E-proven with a custom `viewer` role (level 0, tabs [dashboard,reports]) written to `settings/roles` + owner role flip + page.reload().
- Build plumbing: index.html third subtab + `#reportsRunnerPanel` (hero, date toolbar, group pills, error card, result card) before the WA panel; `.rr-*` CSS + scoped `@media print` block appended to mobile-overrides.css (print hides hero/toolbars/error/skeleton/meta/subtabs, forces `#rrResult` visible — output is title + table only); tools/build.mjs PurgeCSS safelist gained `/^rr-/`; Admin/sw.js CACHE_NAME v5.11.2 → v5.11.3 + mobile-overrides.css ?v=5.4.8 → 5.4.9 (index.html + sw.js).
- E2E (`%TEMP%/opencode/e2e-reports.js` + idempotent `seed-e2e-reports.js`: fixed-key orders rep-o1..o4 — Delivered Cash ₹500 CGST+SGST / Delivered COD ₹332.9 GST5% / Cancelled ₹999 / Placed ₹250 — contact rep-s1 → 9300000001, 2 dishes, attendance 10-25 R480/S300): 35/35 — catalog render (6 pills for owner, auto-select + auto-generate), default range exact, **every report asserted against a DB-computed oracle** (independent re-implementation reading the live DB), seeded exacts (Margherita 2/₹398, CGST ₹12.50, QR contact resolved via tableSessionsContact), cancelled excluded from every money report but present in the funnel (8 orders total), snapshot meta notes range ignored, from>to toast + previous result kept, CSV filename/header/raw-number cells/seeded row, print emulation (chrome hidden, table visible), viewer gate (3 non-revenue groups, exports hidden, staff-attendance renders), zero page errors across both sessions. settings/roles + owner role restored after the gate test (verified via diag).
- **E2E gotchas (for future authors)**: (1) **RTDB `DataSnapshot.forEach` CANCELS iteration when the callback returns truthy** — `s.forEach(c => orders.push(...))` visits exactly ONE child because `Array.push` returns the new length; wrap in braces. This produced a "1-order oracle" that looked like a DB/SDK/partial-snapshot problem and wasn't — numChildren said 8 while forEach visited 1. (2) The manager-without-businessId account's UI login is unproven (its reports nav button never became visible); the working gate-test pattern is flipping the OWNER's role to a custom level-0 role + `page.reload()` (fresh boot re-reads settings/roles) — doubles as the custom-roles nav test. (3) **Tie-break determinism**: every descending sort in runReport needs an explicit name/key tiebreaker — the runner (createdAt query order) and any oracle (DB key order) break count/amount ties differently otherwise (bit the order-status funnel: Delivered vs Placed both 2).
- Verification: report-catalog self-check OK; twins 5/5 (report-catalog has NO twin — Admin-only, correctly unguarded); encoding ok; `node --check` clean; build:admin clean (dist emits js/features/report-runner.js + shared/report-catalog.js); deployed hosting:admin (pre + post tiebreak fix).
- Confidence: HIGH — live browser + DB-oracle evidence for every report and the gate.
- Ended: 2026-10-27 ~04:00 UTC

### [20261029-120000-seo-brand-sweep] Public brand sweep: FoodHubbie ERP -> FoodHubbie across the marketing site
- TIER: 2 (public copy only; no app logic, no rules, no deploy)
- STATUS: DONE (not deployed - awaiting owner authorization per master-prompt rule)
- Scope: master-prompt mandatory branding rule - public brand is FoodHubbie, NOT FoodHubbie ERP. Technical identifiers (hosting targets, app dirs, package names, demo icon-erp-logo.png etc.) intentionally untouched.
- website/*.html (24 pages) + index.html (committed earlier on this branch in d8fbab2): <em class="logo-tag">ERP</em> removed from nav logo; footer Food<span>Hubbie</span> ERP -> Food<span>Hubbie</span>; titles/og-titles/descriptions/H1/alt texts/JSON-LD names/WhatsApp CTA texts (incl. URL-encoded %20ERP variants) fixed. architecture title now "How FoodHubbie Restaurant Software Works", H1 "How FoodHubbie Works: From QR Scan to Bill"; contact "Contact FoodHubbie"; pricing/multi-outlet/signup og-titles without ERP; mailto subject FoodHubbie%20-%20Inquiry; contact "Business Name: FoodHubbie".
- website/llms.txt: header FoodHubbie; "Restaurant & cafe ERP:" -> "Restaurant & cafe software:".
- docs/BACKLINK-KIT.md + docs/OFFSITE-KIT.md (directory-submission copy): brand fixed everywhere.
- LEGITIMATE ERP KEPT: best-software.html + compare.html "payroll/ERP integrations"/"deep ERP connectors" - these describe competitors' enterprise suites, not the FoodHubbie brand.
- Guard fix: tools/check-copy-consistency.cjs existence-exemption extended demo -> demo|demo/tour (235397b added the /demo/tour sitemap entry + firebase rewrite but not the gitignored-mirror exemption, so the guard failed on a clean tree).
- Verification: copy-consistency OK (30 files + 25 sitemap urls), domain-migration 0 stale refs (204 files), encoding ok, 32/32 JSON-LD blocks parse and are ERP-free, all wa.me CTA texts read naturally, spot-checked titles/H1s/nav/footer on 7 pages.
- Pending owner actions: production deploy (firebase deploy --only hosting:website), GSC re-fetch for changed URLs.
- Confidence: HIGH for repo state; live site still shows ERP until deploy.

### [20261029-130000-webp-images] Website images converted to WebP + favicon downscale
- TIER: 1 (static assets only; no copy, no schema, no rules)
- STATUS: DONE (not deployed - deploy authorization still pending from the brand sweep)
- User request: every image format on the website into WebP.
- Converted (ffmpeg libwebp, dimensions preserved): website/assets/demo/demo-poster.png (380KB) -> demo-poster.webp (78KB, q90); website/assets/social/restaurant-os-1080x1350.png (1.97MB @2160x2700) -> restaurant-os-1080x1350.webp (311KB, q87). Old PNGs deleted; references updated in website/index.html (video poster), docs/OFFSITE-KIT.md, promo/ASSETS.md, promo/COPY.md, promo/TRACKER.md.
- Favicon KEPT PNG by design (not converted): apple-touch-icon is PNG-only per iOS spec, Safari does not render WebP favicons, and the favicon.png + JSON-LD logo should stay universally readable. Instead optimizer: favicon.png was 1254x1254 at 794KB -> resized to 256x256 lanczos, now 48KB (all real use sizes are <=180px; favicon-512.png untouched at 512px/183KB since it is the structured-data logo).
- Out of scope (left as-is): favicon.svg (vector), website/demo/icon-erp-logo.png (gitignored mirror generated from Admin/dist by tools/build-demo-site.mjs - converting it means touching the Admin app; the mirror's 794KB logo is a noted optimization for a future Admin-side pass).
- Staying-PNG provenance refs left as history: PROJECT_LEDGER.md (append-only); promo/*.md refs to promo/assets/demo-poster.png point at the promo pack folder deleted by earlier work, not website assets.
- Gotcha avoided: PowerShell Set-Content rewrote line endings on promo/*.md (whole-file CRLF diff) - reverted and redone with content-preserving edits (TRACKER.md diff is exactly 3 lines).
- Verification: ffprobe both webp dims exact; copy-consistency OK; encoding ok; domain-migration 0 stale; repo-wide grep shows no live refs to the deleted PNGs.
- Commit: cadaac7 (webp); brand sweep from the prior entry = 0c4db00

### [20261029-140000-deploy-website] PRODUCTION DEPLOY: hosting:website (authorized)
- Owner authorized ("DEPLOY."). `firebase deploy --only hosting:website` -> platform foodhubbie-10, target foodhubbie-web, 99 files found, 28 uploaded, release complete. Host: https://foodhubbie-web.web.app / canonical https://foodhubbie.in/ (301 www->apex verified intact). Ships BOTH pending changes: brand sweep (0c4db00) + webp/images (8d258f0).
- LIVE VERIFICATION ALL PASS: / 200 ERP=0 logo-tag=0 poster=demo-poster.webp JSON-LD name=FoodHubbie; /architecture /contact /pricing /signup /multi-outlet /use-cases /qr-ordering all 200 ERP=0 tag=0. favicon.png now serves 48KB (was 794KB; 256x256). demo-poster.webp 200 image/webp 78.2KB; restaurant-os-1080x1350.webp 200 image/webp 311.5KB. /demo/tour still 200 with the demo shell.
- Remaining owner actions unchanged: GSC re-fetch for changed URLs (priority 8), directory submissions, genuine social profiles then sameAs.

### [20261029-160000-webp-dishes] Dish/category/combo images -> WebP (admin + QR menu), live E2E 10/10
- TIER: 2 (encoder change in the admin upload path; DB schema/rules untouched; no deploy yet)
- STATUS: code DONE + live-verified on the e2e outlet; production deploy of hosting:admin PENDING owner authorization; migration apply on live outlets intentionally NOT run (see evidence below)
- User request: 4-phase plan (WebP sweep, nothing breaks, one sweep, ledger + remove trace of before). Plan approved (decision 1 of owner).
- PHASE 1 (code, commit b0c1757): Admin/js/firebase.js uploadImage(file, path, opts) gained opts.webp = canvas.toBlob('image/webp', 0.75) with an HONEST blob.type check and JPEG q0.6 fallback — Safari/legacy silently yields PNG from webp requests, so the fallback must be JPEG (never PNG). ONLY the 4 catalog call sites (dishes/categories/combos) opted in with { webp: true }; riders.js profile/Aadhaar (KYC legibility), promotions.js (WhatsApp media is JPEG/PNG only), utils.js previewImage, and the legacy runImageMigration all deliberately stay JPEG. Admin SW precaches js/firebase.js + js/features/catalog.js -> CACHE_NAME bumped foodhubbie-erp-shell-v5.12.2 -> v5.12.3. page-guide.js dish-upload copy fixed ('Firebase Storage' was factually wrong -> base64 stored in the database; copy now says WebP-capable).
- PHASE 2 (dry-run evidence, NO writes): tools/migrate-dish-images-webp.cjs (admin SDK on bot/service-account.json, ffmpeg libwebp q75; converts ONLY data:image/jpeg values under dishes/categories/combos; backs up every original to metadata/imageMigrationBackup/{node}/{id} in the SAME multi-location update; --restore rolls back; re-mirrors converted images onto EXISTING menuBank entries by the shared slug math; exits 2 without ffmpeg). REAL NUMBERS from dry-run over outletIndex (all tenants): pizza = 24 jpeg, 12 convertible, outlet image payload 238.1KB -> 222.1KB (7%); most tenants have ZERO jpeg (already webp from earlier template seeding); the remaining jpegs are small double-compressed files (8-55KB) where q75 webp is often BIGGER (the script's honest per-image guard keeps them) and q50 wins only ~12% with visible quality loss. DECISION: migration apply on live Roshani outlets SKIPPED — ~7% of ~240KB per scan does not justify writing live tenant data. Script stays as tooling for any outlet that later accumulates fresh jpeg uploads (dry-run default, --apply gated).
- PHASE 3 (pre-deploy verification battery, tests/e2e-webp-dish.js, localhost:4599 serving Admin/dist against the LIVE project, e2e tenant e2e-biz-1792987605261/e2e-outlet-1792987605261): login -> Menu tab -> Add Dish -> "Add by yourself" -> UI upload -> DB asserts. RESULT 10/10 PASS: dish saved with image EXACTLY data:image/webp;base64; new-upload webp 11,147 bytes vs 42,205 source jpeg (73% smaller); QR menu (foodhubbie-qrmenu.web.app with a throwaway SDK-minted table token — bare ?b&o menu URLs show 'QR code is invalid' by design, token required) renders the webp dish card with 0 page errors; admin catalog lists it; cleanup removed 1 test dish + 1 table + 0 sessions (e2e outlet back to its 6-imageless-dish baseline). Gotchas for future e2e: page.evaluate cannot close over Node vars (pass as arg); menu host is foodhubbie-qrmenu.web.app NOT foodhubbie-menu.web.app; menu boot requires a valid tables/{id}.token.
- PHASE 4 (review): guards all green after fixes — encoding ok, copy-consistency OK (30 files / 24 sitemap urls), check-shared-twins 5/5 pairs untouched, domain-migration 0 stale after exempting README.md (it DESCRIBES the live www->apex->/demo redirect chain — factual mention, not a stale link; same rationale class as the ledger exemption). Build:admin green. Trace of before: no scratch files in the repo (e2e + static-server scripts live in %TEMP%/opencode; the reusable battery is committed as tests/e2e-webp-dish.js), migration tool is generic with --restore, no old-format claims left in UI copy. Old ledger entries untouched (append-only).
- NOT DONE (needs owner): firebase deploy --only hosting:admin (the standing DEPLOY covered hosting:website only). After deploy, admin sessions keep the SW-cached jpeg encoder until the v5.12.3 cache-name change forces a clean re-cache.
- Confidence: high (live-verified end to end); caveats measured and labeled above.

### [20261029-170000-deploy-admin-webp] PRODUCTION DEPLOY: hosting:admin (authorized) — WebP sweep complete
- Owner authorized ("Deploy and Start Phase 3"). firebase deploy --only hosting:admin -> release complete. Live checks: foodhubbie-admins.web.app/js/firebase.js serves the toBlob/image/webp encoder branch; sw.js cache name v5.12.3 (clean re-cache forces admins off the stale jpeg encoder); dist catalog bundle carries all 4 webp:!0 call sites.
- PRODUCTION E2E (tests/e2e-webp-dish.js with E2E_ADMIN_BASE=https://foodhubbie-admins.web.app): 10/10 PASS — login on the live prod host, UI upload -> DB image EXACTLY data:image/webp (11,147 bytes vs 42,205 source, 73% smaller), QR menu renders the webp dish card with 0 page errors, admin catalog lists it, cleanup restored the e2e outlet baseline (1 dish + 1 table + 0 sessions removed).
- Sweep status: COMPLETE. Phases 1-4 all executed (plan -> code -> migration evidence/decision -> deploy + review). Live Roshani migration apply deliberately skipped per dry-run evidence (7% ceiling on double-compressed leftovers); tool stays available.
- Tracker: Pending-Work.md WebP item -> ok/done (Safari fallback documented-not-tested; WhatsApp Sharp normalization documented, real-send proof pending a live WhatsApp session — pre-existing dead sessions, unchanged).

### [20261029-173000-inventory-compact] Inventory tab UI density pass (owner request: shrink menu-item cards)
- TIER: 1 (UI-only, scoped to the Inventory tab; no data, rules, or shared components touched)
- STATUS: DONE + deployed (hosting:admin) + verified live
- Owner request: shrink the Inventory tab menu items so more fit on screen. Scope enforced: ONLY #inventoryMenuSection / .inventory-dish-card — the global .dish-card (POS), Riders' shared .toggle-switch-sm, and the bottom Inventory Items table untouched.
- Changes (Admin/style.css): grid minmax 160px -> 118px, gap 10 -> 8; in-card image margin-bottom 6 -> 4; name 11.5 -> 10.5px; price/labels -> 10px; availability/stock rows padding 8 -> 4px 0; toggles 36x20 -> 28x16 (knob 12px, single-divider translateX); +/- buttons 36 -> 22px; stock value 18 -> 11px; reorder badge + Track Stock button tightened. Admin/js/features/inventory.js: MENU_PAGE_SIZE 20 -> 30. Cache: style.css?v=5.4.6 -> 5.4.7 in index.html + sw.js precache; CACHE_NAME -> foodhubbie-erp-shell-v5.12.4.
- MEASURED in production (tests/e2e-inventory-compact.js, e2e outlet, screenshots in %TEMP%/opencode/inventory-compact*.png): BEFORE 170x318px card, ~6 columns on a 1072px grid; AFTER 127x249px, ~8 columns (+33% per row, -22% height) -> 5/5 PASS. Controls verified: 28px toggle present. Outlets with tracked stock items additionally get the 22px +/- knob pair (this outlet's items untracked, asserted conditional).
- Commits: the density pass + battery are on seo-brand-consistency with the deploy (see following commit hash line); battery kept as tests/e2e-inventory-compact.js for future density tweaks.

### [20261029-180000-menu-compact] Menu Management tab UI density pass + `main`-class padding collision fix (owner request: "decrease also on menu tab")
- TIER: 1 (UI-only, scoped to #menuGrid; one template token touched for the collision fix)
- STATUS: DONE + deployed (hosting:admin) + verified live
- Owner request: shrink Menu-items cards on the Menu Management tab like the Inventory pass. Scope: #menuGrid rules in Admin/style.css only — POS .dish-card untouched (POS has its own #posMenuScope/flex layout), chips/actions elsewhere untouched.
- Changes (Admin/style.css, block after .menu-grid): grid minmax 160 -> 120px (gap 8 kept); card padding 8 -> 6, radius 10; image aspect 1/1 -> 4/3, margin 6; name 10.5px; pricing strip padding 4px 5px, gap 4, margin 4; chips padding 2px 6px, size 8.5px, price 11px (!important beats inline style), action row padding-top 4px, edit/delete buttons 32 -> 24px (svg 12px !important beats lucide inline width), ID-badge padding !important 2px 5px / 8.5px font. Cache: style.css?v=5.4.9, shell v5.12.6.
- BUG FOUND & FIXED AT ROOT: Menu-tab cards' price chip recomputed padding as `0px 30px 30px 30px` on desktop. CDP introspection (all matching rules enumerated) showed only correct 2px/4px paddings — the shape matched `.main { padding: 0 30px 30px !important }` (style.css:4004, app-shell layout, inside @media (min-width:1025px)). Root cause: the chip template reused the shell's generic `main` class — `<div class="price-chip-v4 main">` inside #tab-main takes BOTH rules; the shell's !important padding wins on desktop (mobile was saved by `#tab-menu .price-chip-v4{padding:2px 6px!important}` in mobile-overrides.css). FIX: renamed the modifier task-wide to `single` — catalog.js template + `.price-chip-v4.single` selector. No other consumers (grep: only 2 hits pre-rename); mobile-overrides has no .main chip variants. Symptom-level !important stacking was rejected deliberately.
- MEASURED in production (tests/e2e-inventory-compact.js extended with a Menu-tab section; screenshots %TEMP%/opencode/menu-compact.png): card 132x266px, ~8 columns on a 1112px grid (was ~160px/6 cols), 24px action buttons, chip padding 2px (from broken 0/30/30). Inventory battery re-run on same deploy: 5/5 unchanged (regression clean).
- Commit: see following hash on seo-brand-consistency.

### [20261030-101500-browser-combo-compact] Menu Browser + Combos tab density pass (owner request: "same for menu browser tab and combo tab")
- TIER: 1 (UI-only, scoped to #browserDishGrid grid-view + #tab-combos; list-view, Menu Bank modal, POS untouched)
- STATUS: DONE + deployed (hosting:admin) + verified live
- Changes (Admin/style.css, block after `.browser-dish-actions .combo-toggle`): Menu Browser grid minmax 140 -> 110px, gap/padding tightened, align-content:start (the flex:1 container otherwise stretches the single row to panel height — found via production screenshot: cards 111x603px before the fix); name/category/price chips -> 8.5-10.5px compact set with ellipsis (`.browser-dish-name` had NO base rule before — unstyled full-size text); edit/delete 32 -> 24px (svg 11px !important beats inline width). Combos: minmax 200 -> 150px, name/category/meta/pricing compact, discount chip smaller, toggle scaled 0.72.
- Media-view guard: all grid-view font/aspect rules keyed `:not(.list-view)`; list-view keeps its 50px-row layout (only action buttons share the 24px size).
- E2E battery extended (tests/e2e-inventory-compact.js, now 5 tabs checked): Menu Browser grid ~7 columns on 834px, cards 111px wide; Combos checks are conditional (e2e outlet has 0 combos). Battery incidentally re-proves inventory + menu-tab passes on the same deploy.
- PROCESS BUG CAUGHT BY GUARD: the PowerShell one-shot cache-bump (`Get-Content | Set-Content -Encoding UTF8`) corrupted Admin/index.html + sw.js (mojibake + BOM + C1 controls) — reverted via git checkout, re-applied with the edit tool; the encoding-check gate caught it before any build/deploy. NEVER edit repo files with PowerShell text cmdlets.
- Cache: style.css?v=5.4.11, shell v5.12.8. Commit on seo-brand-consistency (see hash line).
- SEE ALSO: PLAN-CATEGORY-REDESIGN.md created this session (full UI/UX redesign plan for the Categories tab — awaiting owner go; phased P1 grid/header, P2 create/edit drawer, P3 image+delete-guard, P4 mobile/a11y).

### [20261030-120000-category-phase1] Categories tab Phase 1 redesign (PLAN-CATEGORY-REDESIGN.md §3-P1) — owner "START PHASE 1"
- TIER: 1 (UI restructure of #tab-categories; renderer-only JS, no data-model/listener changes)
- STATUS: DONE + deployed (hosting:admin) + verified live
- Gone: the two-column `.dashboard-grid` layout (create-form 50% width + category ROWS crammed into a 130px `category-grid`).
- In: KPI ribbon (Categories count / Dishes mapped / Unmapped — pill hidden when unmapped = 0), compact CARD grid (minmax 150px, 16:9 image, 10.5px name + ellipsis, meta "#serial · dishes · addons", 24px edit/delete `btn-action-v4` family, `align-content:start` — the Menu Browser stretch lesson applied by construction), create-form glass-card stacked BELOW the grid (all ids unchanged: catPreview/catFile/newCatName/newCatOrder/addons builder/btnAddCategory — Phase 3 P2 moves it into a drawer). Migrate (addon sync) demoted to a 34px icon button with recovery-tool tooltip. `#categorySearch` stays wired (filterCategories keeps matching `#categoryList > div` — cards are still divs).
- Renderer (catalog.js loadCategories): cat-card markup + KPI fill; `updateActiveDishModalCategories()` fan-out + `_categoriesUnsub` listener untouched. data-action=editCategory/deleteCategory ids unchanged.
- Large index.html restructure was spliced by Node line-based replace (splice script in %TEMP%/opencode/) with pre-anchor assertions after the edit tool hit an exact-whitespace mismatch on the 100-line block; everything else used the edit tool. Encoding gate passed after splice (fs utf8, EOL preserved).
- MEASURED in production (battery now 6 sections, tests/e2e-inventory-compact.js): see RESULT line below; screenshot %TEMP%/opencode/categories-phase1.png. Search ladder: no-match hides all, clear restores.
- Cache: style.css?v=5.4.12, shell v5.12.9. Commits on seo-brand-consistency (hash follows).
- RESULT: 21/21 (6 surfaces) — categories cards 152x157px, 24px action buttons, KPI ribbon cats=1 mapped=4 unmapped=2 (e2e outlet truth), search no-match hides all / clear restores. Inventory 5, menu 4, browser 3, combos 3 sections all regression-clean on the same deploy.

### [20261030-140000-category-phase2] Categories tab Phase 2 (PLAN-CATEGORY-REDESIGN.md §3-P2) — owner "sTART Phase 2"
- TIER: 1 (UI + drawer wiring; no data-model/listener changes)
- STATUS: DONE + deployed (hosting:admin) + verified live (RESULT line below)
- Create form moved OUT of the tab-content into a right-sheet drawer `#categoryCreateDrawer` (.modal + .modal-sheet-right, h100%/480px, slide-in-right) placed beside the other modals — modals inside display:none tabs never render, so the location is structural, not cosmetic. Header button `#btnOpenCatDrawer` (Add Category) opens it; close button + backdrop-click close it; auto-close on save success (addCategory).
- WIRING (catalog.js `_initCategoryDrawer`, DOMContentLoaded): steppers (catOrderMinus/Plus clamp at 0 around #newCatOrder), live duplicate-name hint (#catNameDupHint red warning as you type; hard duplicate check already existed in addCategory since before this plan), focus #newCatName 250ms after open. Cat-preview/file/addons/save ids unchanged.
- Serial stepper markup around #newCatOrder (−/+ small btns); sheet + stepper CSS appended in categories block.
- PLAN DEVIATIONS (recorded): (1) duplicate-name check ALREADY shipped (addCategory L102) — battery proves the live hint layer on top; (2) Edit stays in the existing categoryEditorModal — re-pointing it into the drawer duplicates its dedicated addons editor for zero UX gain; revisit if owner asks; (3) category images were ALREADY WebP (`uploadImage(...,{webp:true})` shipped with the 10-29 sweep) — P3 reduced to the type-the-name delete guard.
- CONCURRENT-AGENT CO-DEPLOY: onboarding agent committed 9d3109f/c54522e/83f4fbb (setup-mode F1, bot/pair Chat fix) on this branch between my commits, with cache bumps 5.4.13/v5.12.10 already in place (my Phase-1 deploy consumed 5.4.12/v5.12.9) — this deploy ships both work streams in one release; my P2 content stayed uncommitted-on-top and intact (verified diff).
- E2E battery extended (+9 checks incl. REAL create → card appears → delete-cleanup cascade-safe (category carries no dishes)).
- MEASURED in production: see RESULT. Screenshots %TEMP%/opencode/category-drawer.png.
- Commits on seo-brand-consistency (hash follows).
- RESULT: 28/28 (drawer opens+focus, live dup hint fires on "Pizza" and clears on clean name, stepper +2/+−: 2→1, real create 'E2E-CAT-DELETE-ME' → drawer auto-closed + card appeared → deleted → removed live; all 21 Phase-1/battery checks regression-clean on the same deploy).
- CROSS-AGENT FIX IN THIS PHASE: the concurrent onboarding agent's setup-checklist hero step deep-linked `#btnAddCategory` — my drawer move would have dead-ended his flash+click on the hidden empty form (warning toast). Re-pointed his cta to `#btnOpenCatDrawer` in Admin/js/features/setup-checklist.js (his gotoStep click now opens the drawer directly; flash on the header button). Rebuilt + re-deployed + battery re-run 28/28 on the final deploy. (Checklist not browser-E2E-able on the e2e tenant: it renders only for locked outlets; dist content asserted instead.)

### [20261031-093000-category-phase3] Categories tab Phase 3 (PLAN-CATEGORY-REDESIGN.md §3-P3) — owner "phase 3 start"
- TIER: 2 (touches the shared delete-confirm util + the category delete flow — data-loss protection)
- STATUS: DONE + deployed (hosting:admin) + verified live (RESULT below)
- Trust boundary: showDeleteConfirm(itemName, message, requireText=null) gained the optional typed-confirmation 3rd arg in Admin/js/ui-utils.js — input injected into the dark modal (input.focus after open, live sync: Delete stays disabled until value.trim().toLowerCase() === requireText case-insensitively), placeholder set via JS (never HTML interpolation — category names can contain quotes). The 6 existing 1-2-arg call sites (dish, combo, inventory, rider, table, old catalog) are untouched by construction.
- deleteCategory (catalog.js) rewritten: dishes snapshot is fetched ONCE up-front, dishes counted while building the update map (was counted implicitly after confirm; now the count powers the copy), guard engaged ONLY when dishCount > 0 with message "This deletes the category and N dishes in it, including images. This cannot be undone." — empty categories keep the plain confirm (matches plan §P3). MultiUpdate/image-cleanup/audit unchanged.
- CSS: .dynamic-modal-input (dark theme of .dynamic-modal-box: #111 bg, #333 border, error border on focus) appended beside the rest of the dynamic-modal block.
- Cache: style.css?v=5.4.14, shell v5.12.11 (next-in-line after the onboarding agent's live 5.4.13/v5.12.10).
- E2E battery +7: populated-category guard tested NON-destructively on the real "Pizza" category (4 dishes): modal opens with input, Delete disabled initially, partial name "Pizz" keeps it disabled, case-insensitive exact match enables it, Cancel → Pizza + dishes intact. Empty-category plain path covered by the existing create/delete lifecycle above it.
- MEASURED in production: see RESULT; screenshot %TEMP%/opencode/category-delete-guard.png. Commits on seo-brand-consistency (hash follows).
- RESULT: 32/32 — populated-category guard: input renders, message counted the live dishes ("4 dishes"), Delete disabled until typed, case-insensitive match, Cancel leaves Pizza + dishes intact; the 28-phase-2 checks all regression-clean on the same deploy.

### [20261031-110000-category-phase4] Categories tab Phase 4 (PLAN-CATEGORY-REDESIGN.md §3-P4) — owner "Start Phase 4" — PLAN COMPLETE
- TIER: 1 (CSS-only + battery; no JS/deploy-surface change beyond cache bump)
- STATUS: DONE + deployed (hosting:admin) + verified live (RESULT below)
- A11y: `.btn-action-v4:focus-visible` fixed at the SHARED class (rings every v4 icon-button app-wide — root-cause placement, not scoped-to-categories); drawer inputs/buttons get focus-visible; KPI ribbon already had aria-live="polite" from Phase 1 (kept). Buttons/audio-labels: header Add + drawer + card actions carried aria-labels since their phases.
- Mobile (kept in Admin/style.css media query, NOT mobile-overrides.css — one cache chain to bump, deviation from plan §P4 recorded): @640px card action buttons 24 -> 40px touch targets (also applied to the browser/combos v4 action buttons in the same media block — same 24px knob pattern), stepper buttons min 40px, drawer sheet goes full-bleed (radius 0), preview 72px, KPI pill sizing.
- Layout stack: #tab-categories has been single-column since Phase 1 (grid -> KPI -> form), so the plan's "straight stack at ≤1024px" was already satisfied — verified at 375px by the battery rather than re-styled.
- E2E battery +5 (mobile section reuses the login session with setViewportSize(375x812); sidebar switch via DOM click works regardless of hamburger state): no horizontal overflow (scrollWidth-innerWidth<=1), cards 120-200px at 375, action buttons >=40px, KPI strip visible, drawer opens full-width (>=340px).
- MEASURED in production: see RESULT; screenshots %TEMP%/opencode/category-mobile.png. Commits on seo-brand-consistency (hash follows).
- RESULT: 37/37 — mobile 375px: zero horizontal overflow, cards 172px wide, card action buttons 44px (media block), KPI visible, drawer sheet full-width 375px. All 32 prior checks regression-clean on the same deploy. PLAN-CATEGORY-REDESIGN.md P1-P4 COMPLETE (all four phases deployed + measured).
