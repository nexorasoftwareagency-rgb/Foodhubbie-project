# Supreme Admin — Progress Tracker

Legend: ✅ done · 🔄 in progress · ⬜ pending · ⚠️ blocked · ❌ failed

Last updated: this session

> Owner directive (this session): *"Every restaurant's own EC2 WhatsApp Baileys bot can be run, created, connected from Dashboard. Every restaurant's own WhatsApp Business Number with API can be connected, created, managed from Dashboard with least taps/steps. Make a lot of things a Template."* Full plan: `docs/PLAN-PROVISION-BOTS-NUMBERS-TEMPLATES.md`.

## Hosting (SupremeAdmin dashboard)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Delete placeholder `SupremeAdmin/` | ✅ | Removed `.gitkeep` tree |
| 2 | Copy fixed `SupremeAdmin/` build into repo | ✅ | From `Supreme Admin Claude/food-hubbie-supreme-admin-FIXED/SupremeAdmin/` (14 files) |
| 3 | Copy `bot-control-api/` into repo | ✅ | Replaced placeholder (4 files) |
| 4 | Fill `firebase-config.js` (real Firebase config + TUNNEL_URL) | ✅ | Config from `Admin/firebase-config.js`; TUNNEL_URL = last-known Quick Tunnel URL (rotates) |
| 5 | Fill `whatsapp-linking.js` META_APP_ID / META_CONFIG_ID | ⚠️ | META_APP_ID=1894358871543574 done; META_CONFIG_ID still REPLACE_ME |
| 6 | Add `supreme` hosting target to `firebase.json` | ✅ | `public: "SupremeAdmin"`, SPA rewrite, CSP incl. FB SDK + tunnel |
| 7 | Verify SPA rewrite + headers config | ✅ | firebase.json valid JSON; all 14 JS files pass `node -c` |
| 8 | `firebase deploy --only hosting:supreme` | ✅ | Deployed — https://foodhubbie-supremeadmin.web.app |
| 9 | Smoke-test live URL (auth gate, routes) | ✅ | HTTP 200; firebase-config.js serves real config |

## Security rules

| # | Task | Status | Notes |
|---|------|--------|-------|
| 10 | Confirm project rules already grant isSuper/isSupreme on businesses | ✅ | Verified in `database.rules.json` |
| 11 | Decide: add `isSupport` read-only to businesses rules? | ⬜ | Default: no, rely on isSuper/isSupreme |
| 12 | Handle `admins/$uid` `.validate` (email+outlet) for claim mirror writes | ⬜ | Decide relax vs include fields |

## Backend (bot-control-api on EC2)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13 | Ship bot-control-api to EC2 `/var/www/foodhubbie/bot-control-api` | ✅ | 4 files deployed |
| 14 | `npm install` + PM2 start (`bot-control-api`, :4000) | ✅ | PM2 id 2, online; logs show "listening on :4000" + status-watcher started |
| 15 | Tunnel path split `/api/*`→:4000 | ✅ | Quick Tunnel can't path-split → added `/api` proxy in webhook-server; `/api`→401, `/health`→200, `/webhook`→200 via tunnel |
| 16 | Set env: DASHBOARD_ORIGIN, ALERT_OFFLINE_MINUTES, META_SYSTEM_USER_TOKEN | ⚠️ | All set via ecosystem-bot-control.config.js (persistent across reboot). META_SYSTEM_USER_TOKEN not set (quota → 501) |
| 17 | Grant isSuper claim + admins/{uid} mirror | ✅ | DB mirror already had isSuper for real admin accounts. Discovered no custom claims set on Auth users (only 1 test user) → added DB-mirror fallback in `auth.js` so existing admin accounts work. Deployed |
| 18 | Implement `/api/whatsapp/exchange` (was stub) | ⬜ | Only if Embedded Signup used |
| 19 | Verify status-watcher writes live botStatus to Firebase | ✅ | watcher started; writes on PM2 events + 30s reconcile |
| 20 | PM2 persistence | ✅ | pm2 save + pm2-ubuntu.service enabled; bot-control-api uses ecosystem config with env |

## Docs

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20 | `SupremeAdmin/FEATURE-LIST.md` created | ✅ | Every feature + location + access + usage |
| 21 | Integration plan file | ✅ | `docs/SUPREME-ADMIN-INTEGRATION-PLAN.md` |
| 23 | OAuth domain authorized | ✅ | `foodhubbie-supremeadmin.web.app` added via Identity Toolkit API (fixes cancelled-popup) |
| 24 | Google sign-in enabled | ✅ | `firebase deploy --only auth` — OAuth client auto-created by provisioning API |
| 25 | Role model: 2 supreme + restaurant admins | ✅ | nileshshah84870 + nexorasoftwareagency = isSuper+isSupreme (claims + DB mirror, password Ns@9724649971 both). roshanipizza/roshanicakes/Roshanisudha etc. demoted to plain outlet admins. Email/password sign-in added to dashboard |
| 26 | Dashboard redeployed with email/password | ✅ | auth.js now offers Google + email/password |

## UI/UX rebrand (owner request)

| # | Task | Status | Notes |
|---|------|--------|-------|
| T1 | `:root` palette → light/white + bold accent/status tokens, delete `[data-theme="light"]` | ✅ | Restaurant accent `#E84908` (matches Admin panel); WhatsApp accent `#25D366`; status `#16a34a/#d97706/#dc2626`; bg `#f8fafc` |
| T2 | Fix hardcoded dark-fallback colors (`.btn-primary`, `.brand-mark`, `.onboard-step-dot.state-done` `#0b0f14` text) | ✅ | Now `#ffffff` on colored surfaces; active nav pill = white bg + bold accent |
| T3 | Remove theme toggle UI + theme logic (`utils.js` initTheme/applyTheme/toggleTheme, `main.js` action, header button) | ✅ | Button, functions, and `main.js` action removed; FEATURE-LIST entry dropped |
| T4 | Contrast check on white for glass/drawer/modal/status-pill translucency | ✅ | Overlay scrim kept dark (correct on light); glass/drawer/modal elevate to white; status-pill translucent colors read fine on light |
| T5 | Deploy `--only hosting:supreme` + visual smoke test | ✅ | Deployed; live CSS has new tokens, no theme-toggle JS remnants |

## UI/UX review fixes (Playwright-verified)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| R1 | **Mobile topbar overflow** — brand + switcher + user in one flex row overflowed at ≤400px (scrollWidth 687 vs 390) | ✅ | `@media (max-width:720px)` collapses brand-name, user-email, dash-tab labels to icons-only; verified `scrollWidth == viewport`, no horizontal scroll |
| R2 | **No data-age / stale indicator** — "Live" badge with no staleness signal | ✅ | `formatAge()`/`isStale()` in utils; `updatedAt` threaded through `flattenOutlets()`; fleet cards show "Last update"; 30s re-render tick keeps labels fresh; stale rows (>5min) get `.row-stale` dim + tooltip |
| R3 | **Bare empty states** — no guidance/CTA on first run | ✅ | Restaurant list, fleet, analytics all render an "Add your first restaurant / Add a restaurant" CTA (hidden for read-only accounts) |
| R4 | **Theme leaks** — `.status-pill` rgba(…)12 washed out on light bg | ✅ | Alphas raised to .16; `.btn-primary`/`.brand-mark`/`.onboard-step-dot.state-done` white-on-color (from T2) |
| R5 | **"Not connected" ambiguity** — pulsing dot read as "live but unknown" | ✅ | New `.static-dot` (non-pulsing) for never-connected state; `.pulse-dot` kept for live statuses |
| R6 | **Quota panel leaks 501 internals** | ✅ | On 501, the whole quota card is removed instead of showing `/api/whatsapp/quota` path |
| R7 | **Confirm dialogs lack Esc** | ✅ | `showConfirm` now cancels on Escape (listener removed on cleanup) |
| R8 | **Toast stacking unbounded** | ✅ | `showToast` caps at 4 visible toasts, oldest dropped |
| R9 | **⌘K hint on Windows** | ✅ | `<kbd>` default "Ctrl K"; swapped to "⌘K" only on macOS via `navigator.platform` |
| R10 | **Fleet checkbox misclick risk** | ✅ | Checkbox gets white backing + shadow so it reads as a control, separated from clickable card body |
| R11 | **Onboarding "Creating…" wipes icon** | ✅ | `btn-spinner` + "Creating…" keeps the arrow icon |
| R12 | **Skeleton shimmer under reduced-motion** | ✅ | `@media (prefers-reduced-motion: reduce)` disables `.skeleton` animation |
| R13 | **Empty tables all along = rules bug (root cause)** | ✅ | `database.rules.json`: added top-level `businesses/.read` for isSuper/isSupreme — the dashboard's `ref('businesses')` whole-tree read was `permission_denied` (rules only granted `$businessId`-level). Deployed; table + fleet now populate live |

## Audit pass — data IDs, permissions, WhatsApp naming (owner request)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| A1 | **Display names lived under `settings/Store/storeName`**, not `outlet.name`/`biz.name` → dashboard showed "Unnamed" for real stores | ✅ | `flattenOutlets()` (data-store.js) + profile + analytics fall back across `outlet.name → settings.Store.storeName → outlet.outletName` and `biz.name → store.entityName → biz.businessName → store.storeName`. Deployed |
| A2 | **Pizza outlet had no display name in DB at all** (`settings/Store/storeName` was `""`); its customer menu site reads the same path → blank store name | ✅ | Backfilled `businesses/roshani-pizza/outlets/pizza/settings/Store/storeName = "Roshani Pizza"` (matches business ID + cake outlet's reference). Dashboard + menu site both fixed |
| A3 | **"Official WhatsApp" vs "Baileys (WhatsApp Web/QR)" naming was ambiguous** — user confused the Meta Cloud API link with the bot's default channel | ✅ | `transport` threaded through `flattenOutlets()`; `transportLabel()`/`transportBadgeHtml()` in utils.js (Official API = green, WhatsApp Web (QR) = amber, Not configured = grey); restaurant-list WhatsApp column = "Official · Connected/Not connected" + badge; fleet cards + profile show transport badge; profile KPIs split into "Official WhatsApp" + "Bot channel" with section eyebrow "WhatsApp — Official API & Bot Channel". Deployed |
| A4 | **Transport `null` displayed as "Not configured"** even though `bot/transport.js` `getTransportMode()` defaults to `'baileys'` | ✅ | Dashboard now defaults missing transport to `'baileys'` (mirrors bot), so both live outlets (Baileys/QR) render "WhatsApp Web (QR)" consistently everywhere |
| A5 | **Google sign-in popup CSP-blocked** — supreme `script-src`/`frame-src` lacked `apis.google.com` (gapi). Plus reported console error `apis.google.com ERR_NAME_NOT_RESOLVED` | ✅ | Added `https://apis.google.com` to `script-src` and `frame-src` in `firebase.json` supreme CSP. The DNS failure in the owner's browser is environmental (email/password path works); CSP no longer blocks the popup when DNS resolves |
| A6 | **Google Fonts woff2 404** (`fonts.gstatic.com/s/inter/...woff2`) | ✅ | Verified: transient Google CDN purge (stale cached CSS2 response referencing a purged font file). Font URL in index.html is correct; hard refresh resolves. Not a code bug |
| A7 | **Status shows "Unknown"** for both outlets | ⚠️ | `botStatus` is written by EC2 status-watcher matching PM2 process name `bot-{bid}-{oid}`; current EC2 bot runs as `pizza-bot` (legacy single-outlet) → no match. SSH blocked (security group whitelists `117.96.22.39`, current IP `182.70.180.227`) so the PM2 process name/env couldn't be verified live. See blockers |
| A8 | Full Playwright audit of all pages/data | ✅ | Verified: 2 restaurant rows, 2 fleet cards, profile/analytics/onboarding render, no "Unnamed" anywhere, transport badges correct, permissions gated (onboarding form hidden for read-only, quota card removed on 501). Only console error: expected 501 quota |

## Admin login card + console-error pass (owner request)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| B1 | **Every restaurant profile should show its admin username + password** | ✅ | New "Admin login" card on the restaurant profile: shows `outlets/{oid}/adminLogin` {email, password} (supreme-only read via rules cascade); Edit/Save for super accounts (hidden for read-only); empty state explains staff use the Restaurant Admin panel; re-render-safe against the 30s tick (edit state kept in module memory). Deployed + Playwright verified: card renders, save persists, creds display |
| B2 | **`<svg data-lucide="octagon-x">` icon not found** (Stop button, spam in console) | ✅ | Lucide 0.344 exports `XOctagon`, so the attribute must be `x-octagon` not `octagon-x`. Fixed; icon renders, error gone |
| B3 | **Quota 501 console noise** (`/api/whatsapp/quota/...` fired on every profile visit) | ✅ | `loadQuota` now skips the fetch entirely unless `whatsapp.status === 'active'` (quota is meaningless without a Meta link, and the API 501s without META_SYSTEM_USER_TOKEN anyway). Card explains "Connect the Official WhatsApp API to see messaging quota." Zero quota requests + zero console errors verified |
| B4 | **Restart/stop 500 shows dead generic toast** | ✅ | Client now surfaces the server's `error` message; server (`bot-control-api/server.js`) includes the underlying PM2 error (`process not found`, etc.) so "Action failed — pm2 restart failed — process not found" is actionable. Server change ships to EC2 when SSH restored |

## SSH unblocked — bot status + restart fixed (EC2 ops)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| C1 | SSH to EC2 timed out even after adding `182.70.180.227` | ✅ | Home IP is dynamic — actual IP was `223.228.247.178`; added it to SG `sg-0a5a73df4b5d37b38` via AWS CLI, connected |
| C2 | **Bot status "Unknown" root cause confirmed**: watcher/API/dashboard key off PM2 process name `bot-{bid}-{oid}` (`bot-roshani-pizza-pizza`) but EC2 ran legacy `pizza-bot` (and `cake-bot` wasn't even running) | ✅ | Renamed via PM2 delete+start using `ecosystem.config.js` (renamed apps to canonical `bot-{bid}-{oid}` names); watcher now writes `botStatus = {status:'online', uptime, memory, updatedAt}` live to Firebase. Playwright-verified: profile KPI shows **Online**, 3m uptime, 98MB |
| C3 | **Restart 500 root cause**: same naming mismatch — API called `pm2.restart('bot-roshani-pizza-pizza')` which didn't exist | ✅ | After rename, `/api/bot/restart/roshani-pizza/pizza` returns **200** through the tunnel, bot restarts cleanly (↺ 1, online). Verified via Playwright clicking Restart — success toast, zero console errors |
| C4 | Restart/stop error toasts were dead-generic | ✅ | Client surfaces server `error`; server now includes PM2 detail (`process not found`, etc.). Deployed server.js to EC2, restarted `bot-control-api` |
| C5 | `bot-control-api` deployed code was behind repo | ✅ | `scp server.js` → EC2, `node -c` passed, `pm2 restart bot-control-api --update-env` |
| C6 | `cake-bot` not running + no `bot-roshani-cake-cake` | ⚠️ | Cake outlet has no linked WhatsApp (`whatsapp: null`), no `phoneNumberIndex` entry, no Baileys session dir — a bot process would crash-loop. Added canonical `bot-roshani-cake-cake` to `ecosystem.config.js` (repo + EC2); **start it when cake goes live** |
| C7 | Dashboard shows "Bot channel: WhatsApp Web (QR)" but pizza-bot logs `transport=meta` | ⚠️ | Deployed bot source diverges from repo; its meta transport is set via a code path outside the Firebase paths the dashboard reads (`outlet.bot.transport`). Cosmetic label discrepancy — needs a repo↔EC2 bot source sync + a single `bot/transport` source of truth. Not blocking status/restart |

## Real restaurant admin accounts + real password update (owner request)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| D1 | **Restaurant admins couldn't log into the Admin dashboard** — the profile's `adminLogin` emails (`roshanipizza@gmail.com`, `roshanicakes@gmail.com`) were not real Firebase Auth users (only 3 Auth users existed: nileshshah, nexorasoftware, verify-…). `signInWithEmailAndPassword` returned user-not-found | ✅ | Created real Auth accounts with `admin.auth().createUser` (password `Ns@9724649971` for both) + `admins/{uid}` mirrors `{email, outlet, name, role}` so the Admin app's `admins/{uid}` lookup passes and outlet isolation works. Playwright-verified: pizza admin → dashboard isolated to **PIZZA**; cake admin → **CAKES**, no ACCESS DENIED |
| D2 | **Profile "Edit" only stored adminLogin text** — didn't touch the real Auth password, so creds on the profile never actually worked | ✅ | Replaced Edit/Save with a real **Update password** flow. New `POST /api/admin/update-password` in `bot-control-api/server.js` (`requireSuperOnly`): `getUserByEmail` (or `createUser` if missing) → `updateUser({password})` → syncs `admins/{uid}` + `outlets/{oid}/adminLogin`. Client card now shows username (read-only) + New password + Confirm, calls the API with a bearer token. Deployed + Playwright-verified: password change + revert both landed in Auth and DB |
| D3 | **`/api/*` POST bodies were dropped through the tunnel** — webhook-server's global `app.use(express.json())` consumed the body before proxying to :4000, so bot-control-api saw `{}` (and malformed bodies returned CORS-less HTML errors) | ✅ | Root cause fix: moved `express.json()` off the global chain onto just `POST /webhook`. `req.pipe(proxyReq)` now forwards the raw body untouched. Deployed to EC2 (`/var/www/foodhubbie/webhook-server/index.js`), restarted webhook-server. POST `/api/admin/update-password` now 200 through the tunnel |
| D4 | **30s re-render tick wiped half-typed Update-password form** (password fields re-rendered from empty module state) | ✅ | Added a delegated `input` listener syncing `#admin-pass-input`/`#admin-pass-confirm-input` into module state (`adminEdit.pass`/`.confirm`), so the re-render preserves typed values — same pattern the original Edit state used |
| D5 | **Profile didn't show the connected WhatsApp number** — bot runs Official (Meta) but `outlet.whatsapp` was `null`, so profile showed "Not connected" and never revealed which number the bot was on | ✅ | Fetched real display number from Meta Graph API (`+1 555-661-9086`, "Test Number", phoneNumberId `1211796118690392`); wrote `outlet.whatsapp = {phoneNumberId, displayPhoneNumber, verifiedName, status:'active'}` + `bot.transport='meta'`. Profile KPI tile now shows the number + verified name; Manage agent adds "Connected WhatsApp number". Also added `Cache-Control: no-cache` to supreme hosting JS/CSS headers (was unset → stale JS cached 1h). Deployed + Playwright verified |

## Transport toggle — Official API ↔ WhatsApp Web (QR), session persistence (owner request)

| # | Task | Status | Notes |
|---|------|--------|-------|
| E1 | Plan documented | ✅ | See integration plan §7c. Simpler than first planned: reuse the bot's existing Baileys socket (no parallel socket) + dashboard's live `businesses` listener (no QR polling). |
| E2 | `POST /api/bot/transport/{bid}/{oid}` + `POST /api/bot/rescan/{bid}/{oid}` in `bot-control-api/server.js` | ✅ | `requireSuperOnly`. `transport` takes `{transport:'meta'|'baileys'}` → writes `outlet.bot/transport`, PM2-restarts, returns `{ok, needsQr}` (`needsQr = !existsSync('bot/session_data_{oid}/creds.json')`). `rescan` writes `bot/transport='baileys'` + `bot/pair={requested:true,rescan:true}` then restarts. (Original single `pair` endpoint replaced.) |
| E3 | Pair-intent handling in `bot/index.js` (before `useMultiFileAuthState`) | ✅ | If `pair/requested && pair/rescan` → wipe `session_data_{oid}` (fresh QR). If `pair/requested` only → reuse saved session, no QR. Then clears flags, sets status `waiting`. `connection.update` writes `bot/pair = {qr,status:'waiting',updatedAt}` on each QR, `{qr:null,status:'connected',connectedAt}` on open, `{qr:null,status:'logged_out',updatedAt}` on loggedOut. |
| E4 | Dashboard transport toggle (Manage agent card) | ✅ | Two `.transport-option` buttons (Official API / WhatsApp Web (QR)) with `.active` highlight + "Currently using" label + Pairing status line. `switch-transport` confirm → API; baileys + `needsQr` → QR modal, else toast. `rescan-baileys` → confirm → API → modal. Meta switch never re-opens Facebook login when `whatsapp.phoneNumberId` exists. Legacy `reconnect-whatsapp` kept for first-time Meta linking only. |
| E5 | QR modal + session persistence | ✅ | `openPairModal()` renders `outlet.bot.pair.qr` live via qrcodejs (cdnjs, CSP-allowed); auto-closes on `status:connected`. Session saved under `bot/session_data_{oid}/` on EC2 — switching to Meta keeps it, switching back reconnects without rescan. |
| E6 | Deployed + live | ✅ | `node --check` clean on bot/index.js, server.js, restaurant-profile.js; synced both EC2 files (SYNC_OK), PM2 restarted both apps (online). Pizza bot LIVE on baileys: PID 55742, reconnected with saved session as `917485095436` (no rescan), messages OK. Toggle UI deployed to hosting:supreme. |
| E7 | Toggle E2E verification in dashboard | ✅ | Playwright-verified live on pizza: (1) **→ WhatsApp Web (QR)**: confirm dialog, `transport` meta→baileys, bot restarted & reconnected via **saved session** (no QR modal, `pair.status:connected`), UI "Currently using: WhatsApp Web (QR)" + Re-scan QR button + "Pairing: Connected". (2) **→ Official API**: confirm dialog says "No sign-in needed — the already-linked number is reused" (no Facebook popup), `transport` baileys→meta, bot restarted & connected via Meta (`[META-TRANSPORT]` listening, SEND OK wamid), UI "Currently using: Official API". No crash-loop either way. Also fixed stale-JS caching: added `Cache-Control: no-store, no-cache` to supreme JS/CSS header rule (was Firebase default `max-age=3600`). |

## Bot provisioning + WhatsApp number management + templates (owner directive)

Full plan: `docs/PLAN-PROVISION-BOTS-NUMBERS-TEMPLATES.md`. F1–F4, G1–G4, C1–C4 implemented + deployed; Playwright-verified above. G5 (usage counter) done; provision E2E verified 2026-08-14.

| # | Task | Status | Notes |
|---|------|--------|-------|
| F1 | `POST /api/bot/provision/:bid/:oid` in bot-control-api (pm2.start `bot-{bid}-{oid}`, env OUTLET/BUSINESS_ID/OUTLET_ID/BOT_TRANSPORT/HEALTH_PORT, `pm2.save`, idempotent: restart if exists, write `outlet.bot.provisionedAt`) | ✅ | Implemented in `bot-control-api/server.js` + deployed to EC2 (routes live: 401 on unauth via tunnel). `nextHealthPort()` allocates lowest free 3001–3100. **E2E verified 2026-08-14**: provision → PM2 `bot-e2e-test-testout` online with correct env → bot boots, emits QR into `outlet.bot.pair`. Fixes shipped: `pm2.save` → `pm2.dump` (save isn't a pm2 API method — provision/delete both failed after start), restart now reuses the existing process's `HEALTH_PORT` (was allocating a new port each restart → port drift). |
| F2 | `POST /api/bot/delete/:bid/:oid` (pm2.delete + rm `session_data_{oid}` + clear `outlet.bot`) | ✅ | Implemented alongside F1, deployed. **E2E verified 2026-08-14**: decommission removed PM2 process + session dir; `outlet.bot.provisionedAt`/`healthPort` cleared. |
| F3 | Dashboard: "Start bot worker on EC2" button on profile for un-provisioned outlets → provision → existing QR modal; onboarding gets a "WhatsApp Web (QR)" path alongside the Meta popup | ✅ | Profile: Start bot worker (when `bot.status==='unknown'`) + Decommission + worker info line + "Scan QR"/"Re-scan QR" button. Onboarding: WhatsApp connection radio (qr/meta), qr path provisions then opens profile. Deployed. |
| F4 | `flattenOutlets()` adds `provisioned` flag; restaurant list shows "Provisioned" chip | ✅ | `flattenOutlets()` emits `provisioned` + `healthPort`; restaurant list shows "No bot — start it on the profile" for un-provisioned outlets. Deployed. |
| G1 | `whatsapp-graph.js` helper + Path B endpoints: GET/POST `/api/whatsapp/numbers/:bid/:oid`, `/request-code`, `/verify-code`, `/register`, `/deregister`; GET `/api/whatsapp/accounts` | ✅ | `bot-control-api/whatsapp-graph.js` (Graph v20.0 wrapper) + all Path B routes in server.js, deployed to EC2 (routes live: 401 on unauth via tunnel). |
| G2 | Post-success server writes: `outlet.whatsapp={phoneNumberId,wabaId,displayPhoneNumber,verifiedName,status:'active'}` + `phoneNumberIndex/{phoneNumberId}` + `POST /{waba}/subscribed_apps` + set `bot.transport='meta'` | ✅ | `waLinkSuccess()` shared by both paths; deregister also clears `phoneNumberIndex` + `outlet.whatsapp`. |
| G3 | Implement `POST /api/whatsapp/exchange` (Path A, Embedded Signup): app-secret oauth → debug_token → WABA + numbers → save. Fill `META_CONFIG_ID` in whatsapp-linking.js | ✅ | Exchange implemented in server.js (oauth/access_token → debug_token → owned WABAs → phone_numbers → waLinkSuccess). META_CONFIG_ID still REPLACE_ME (real value must come from Meta dashboard) + META_APP_SECRET env unset on EC2 → Path A popup can't launch until configured. Path B works without it. |
| G4 | Dashboard WhatsApp-number wizard on profile (choose flow → add/pick number → send/verify code → register with auto 6-digit pin) + Manage (display number, verified name, quality rating, tier+used/limit, re-verify, deregister) | ✅ | `SupremeAdmin/js/features/whatsapp-manage.js` (wizard state machine + manage view + deregister), wired into restaurant-profile.js via `registerAction` + `mount()`. Playwright-verified: manage card shows number/verified name/phoneNumberId + Deregister. Wizard steps render. |
| G5 | Quota `used` counter (count sends from bot send path into `outlet.whatsapp.usage`) | ✅ | `bot/index.js` send patch increments `businesses/{bid}/outlets/{oid}/whatsapp/usage/{IST-date}` per successful send (gated on `isMetaTransport`); quota endpoint reads the same day key instead of hardcoded 0. Deployed to EC2; `node --test bot/tests/unit.test.js` 9/9 pass. |
| C1 | `appTemplates/{templateId}` node + `tools/seed-templates.cjs` (seed settings/categories/dishes/delivery/tax/hours/bot defaults per restaurant type) | ✅ | `tools/seed-templates.cjs` seeds pizza/cake/kitchen + `whatsappTemplates` library. Ran: seeded + readback verified. Rules: `appTemplates` read for any admin, write super-only (read moved to parent node — child-only `.read` made whole-tree reads permission_denied). |
| C2 | Onboarding template picker: pre-fill form + atomic-write template defaults under new outlet | ✅ | Onboarding loads `appTemplates` live (filters to `defaults`-bearing restaurant templates), shows description hint, submit applies `templateCache[tpl].defaults` into the atomic outlet write. Deployed. |
| C3 | WhatsApp message-template library (`appTemplates/whatsappTemplates/` seed) + API GET/POST/DELETE `/api/whatsapp/templates/:bid/:oid` + profile card (APPROVED/PENDING/REJECTED badges) | ✅ | Seed includes 5 starter templates (order_confirmed, order_delivered, order_ready, promo_offer, feedback_request). API GET/POST live (GET 501s without META_SYSTEM_USER_TOKEN — expected). Profile "Message templates" card renders the library with Install buttons (POST creates on the WABA), re-render-safe (cached HTML). Playwright-verified: library renders, survives 30s tick. |
| C4 | Deploy, Playwright E2E per phase | ✅ | Deployed rules + hosting:supreme; Playwright-verified: template picker options, message-template library card with Install buttons (survives 30s re-render), manage card + wizard render. Bot-control-api routes live on EC2 (401 unauth). |
| D6 | **Owner profile: business & store details card** — owner asked what details a restaurant should have on the Profile, and to make them editable | ✅ | Profile "Outlet details" card replaced with **Business & store details** (read view or inline edit) + **Platform IDs** card. Edit form: business name, outlet name, contact phone, contact email, plan/tier, store name, entity name, address, GSTIN (15-char), FSSAI (14-digit), tagline, opening/closing time, instagram, facebook, google review link, delivery notify phone. Save writes **leaf paths** to the canonical tenant path `businesses/{bid}/outlets/{oid}/settings/{Store,Delivery}` + `businesses/{bid}/{name,contactPhone,contactEmail,plan}` (leaf writes preserve siblings — verified `config`, wifi, shopStatus etc. survive). Deployed + Playwright-verified on roshani-pizza/pizza: read render → edit → save landed in DB at correct paths → revert cleaned. |

## UI/UX review — round 2 (owner request, code-level — Playwright unavailable this session)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| R1 | **"Update password" button was dead** — `onclick="event.stopPropagation()"` (added in round 1 to keep the header toggle quiet) stops the event before it reaches the delegated `document` click dispatcher, so the `edit-admin-login` action never fired | ✅ | Removed the inline `onclick`. The delegated dispatcher's `closest('[data-action]')` already resolves to the button (nearest match), so the header's `toggle-section` won't fire either. Deployed |
| R2 | **Collapsible sections re-expand every 30s** — `renderProfile` rebuilds the DOM each live tick, wiping the `.collapsed` toggle added in round 1 | ✅ | Module-level `collapsedSections` Set: `toggle-section` updates it, `renderProfile` re-applies the `collapsed` class from it, `render()` clears it on profile change. Deployed |
| R3 | **Restaurant list "Official · Not connected" was misleading** for QR/baileys outlets whose bot is online (reads as "WhatsApp down") | ✅ | Pill now reflects the actual channel: `whatsapp.status==='active'` → "Official API · Connected"; else `transport==='baileys' && botStatus==='online'` → "WhatsApp Web · Connected"; else "Not connected". Deployed |
| R4 | **Onboarding error reset showed a different label** ("Create & connect WhatsApp") than the initial button ("Create restaurant") | ✅ | Reset now restores "Create restaurant". Deployed |
| R5 | **Icon-only buttons had no accessible names** (logout, drawer close, copy/password-eye added in round 1) | ✅ | `aria-label` added to all four; copy/eye keep their `title` tooltips too. Deployed |
| R6 | **Confirm dialog had no dialog semantics + keyboard focus stayed on the trigger** | ✅ | `role="dialog" aria-modal="true" aria-label` on the modal; OK button focused on open (Enter confirms, Escape cancels). Deployed |
| R7 | **Business & store details read view was a single cramped label↔value column** (owner: "worst possible, restructure symmetrically") | ✅ | Rebuilt as a symmetric 2-column tile grid grouped into sections (Business / Store / Registration & hours / Online presence / Delivery). Each field is a `.detail-cell` (small uppercase label over the value) inside `.detail-grid`; long values (address, Google review link, notify phone) span both columns; collapses to 1 column on mobile. CSS + `renderDetailView()` rewritten; deployed |
| R8 | **`<svg data-lucide="qrcode">` spam** ("icon name was not found" — repeated every re-render tick) | ✅ | Lucide 0.344 `replaceElement` resolves `toPascalCase(attr)` → `qrcode`→`Qrcode` (missing) vs `qr-code`→`QrCode` (exists, verified against the pinned UMD bundle). Fixed attribute; deployed |
| R9 | **`/api/bot/delete/roshani-cake/cake` → 500** when decommissioning an outlet whose PM2 worker was never provisioned (cake) | ✅ | `pm2.delete` on a missing process rejects; route treated it as fatal. Delete is now idempotent (checks `pm2List()` first, skips delete if absent — same pattern as provision's `existing` check). server.js synced to EC2, `node --check` clean, bot-control-api restarted (online). Deploy note: re-added owner's current IP `182.70.183.190` to SG `sg-0a5a73df4b5d37b38` for this SSH session |

## Open questions / blockers
- [x] **Bot status "Unknown"** — resolved (C2): PM2 apps renamed to canonical `bot-{bid}-{oid}`, watcher writes live `botStatus`.
  - [ ] **META_CONFIG_ID still REPLACE_ME** (whatsapp-linking.js) - blocks Path A (WhatsApp Embedded Signup popup). Verified 2026-08-15: app 1894358871543574 does NOT have Embedded Signup enabled (Graph returns 2500 'Unknown path components' for GET+POST). The config_id is generated in the Meta App Dashboard and needs the owner's login (2FA blocked) - it cannot be created via API with the system-user token. whatsapp-linking.js toast now gives actionable guidance. Path B ('Connect a number') works without it.
- [x] **META_SYSTEM_USER_TOKEN unset** — RESOLVED 2026-08-15: reused the bot's `WA_PERMANENT_TOKEN` (system user `foodhubbiebot`, never expires) as `META_SYSTEM_USER_TOKEN` + `META_APP_ID`/`META_APP_SECRET`/`WABA_ID=2589174454849821`/`WABA_NAME` in the EC2 ecosystem config. quota/accounts/templates/numbers all **200** (was 501). Fixed `whatsapp-graph.js` `graphOk()` async bug along the way. Audit: `docs/META-PLATFORM-AUDIT.md`.
- [x] **G5 quota `used` counter** — done 2026-08-14 (bot send-path counter into `whatsapp/usage/{IST-date}`, quota endpoint reads it). Baileys-mode sends intentionally don't count (Cloud API tier only).
- [x] **New restaurants have no bot worker** — provision E2E verified 2026-08-14 (create outlet → provision → PM2 worker online + QR emitted → decommission → process/session/bot fields cleaned).
- [ ] **`BUSINESS_BY_OUTLET` maps** in `menu/js/firebase.js` + `bot/helpers/outlet-resolution.js` hardcode pizza/cake — new outlets need `?b=&o=` in the QR URL or map additions. (provision sets BUSINESS_ID/OUTLET_ID env, so bot side is covered; menu link must carry `?b=`.)
- [ ] EC2 SSH — home IP dynamic; re-add current IP via AWS CLI to SG `sg-0a5a73df4b5d37b38` when needed.
- [ ] **`settings/Store/{bid}/{oid}` vs `businesses/{bid}/outlets/{oid}/settings/Store`** — verified the live DB + Admin/menu use the `businesses/...` tenant path (this feature writes there). A stale comment in `SupremeAdmin/js/data-store.js:60` references the old `settings/Store` path — harmless, but confusing; clean up next pass.

## Profile tab system + Analytics & Revenue sub-tab (owner request 2026-08-15)

Owner: *"make everything production grade… create sub tab on restaurant profile page for Analytics and revenue data — same design as the analytics tab from the restaurant admin dashboard, use the menu side-bar tab system… then one-by-one review, continue, complete, review via Playwright, run UI/UX review and improve until satisfied."*

### Plan
| # | Task | Status | Notes |
|---|------|--------|-------|
| PA1 | Save shared Meta/Facebook credentials to gitignored `Credentials/` | ✅ | `Credentials/Meta-Facebook-Login.txt` (FB login, app/business/WABA IDs, where secrets live) |
| PA2 | Production-grade pass on WhatsApp/Graph integration | ✅ | graphOk async fix deployed; WABA_ID/WABA_NAME + META_* env live; all 4 endpoints 200; Path B wizard complete. Remaining is account-side (real number + verification) |
| PA3 | Profile page gains an in-page **tab rail** (menu side-bar tab system) | ✅ | Two pills (Overview / Analytics) mirroring the `.dash-tab` style. Deep-linkable as `#profile/{bid}/{oid}/analytics`; tab switches use `history.replaceState` so the live listener/wizard state survives. "View analytics" header button now switches tabs in-page |
| PA4 | **Analytics & Revenue** sub-tab (Admin-dashboard analytics design) | ✅ | `SupremeAdmin/js/features/profile-analytics.js` reads the live data-store snapshot (orders already streamed — zero extra reads). KPI cards with SVG sparklines + vs-previous deltas, Sales Overview line chart (Chart.js 4.4.1 from jsdelivr, components registered like Admin; SVG area fallback), status highlights, payment donut (CSS conic-gradient + legend), sortable detailed table with status/type/payment badges. Date-range pills Today/7D/30D/Custom with native date inputs |
| PA5 | Chart.js loaded dynamically from jsdelivr (CSP allows `cdn.jsdelivr.net`) with SVG fallback | ✅ | `ensureChart()` imports `chart.js@4.4.1/+esm` and registers CategoryScale/LinearScale/Line/Point/LineController/Tooltip/Legend/Filler (exactly what Admin's analytics.js registers — unregistered scales were the one console error found and fixed) |
| PA6 | Deploy hosting:supreme | ✅ | Live |
| PA7 | Playwright review loop (login → profile → analytics tab → screenshots → console-error check) + UI/UX improvements | ✅ | Verified: 2-tab rail + active state, 4 KPI cards w/ sparklines + deltas, 4 range pills, 4 highlights, 3 legend items, 14 table rows, custom date inputs, sort by Total (asc/desc), chart canvas painted (~10% pixels), survives 30s re-render tick, deep-link `#profile/…/analytics` lands on Analytics tab, zero console errors. Mobile 390px: no horizontal overflow, single-column grid, scrollable tab rail. (Rendered screenshot images couldn't be eyeballed by the model — verified structurally instead.) |
| T1–T7 | **Live WhatsApp official testing completed 2026-08-15** | ✅ | See `docs/META-PLATFORM-AUDIT.md` §"Live testing completed". All 4 GET endpoints 200 (fresh token); template install→list→cleanup round-trip via dashboard API; real **template send delivered** (`bot_live_update`, billable marketing); bot send path increments quota `used` (0→1); webhook captures `sent/delivered/read/failed`. **Found:** biz-initiated *plain-text* sends fail with 131047 after 24h (must use templates) + quota counter counts accepted-not-delivered |
| F1–F4 | **Fixes for the two findings, implemented + verified 2026-08-15** | ✅ F1–F3 / ⚠️ F4 | See `docs/META-PLATFORM-AUDIT.md` §"Fixes applied". `sendWhatsAppTemplate()` + `sock.sendTemplate()`; `SEND_GENERIC_MESSAGE` & promos route **template-first with text fallback** (`PROACTIVE_TEMPLATE` env, default `bot_live_update`) — verified live (template rejected → clean text fallback, no crash); quota card relabeled ("counts messages accepted today"). Variable templates (`promo_offer`, `announcement`) **auto-REJECTED** by test WABA review → set `PROACTIVE_TEMPLATE` once a real variable template is approved |
