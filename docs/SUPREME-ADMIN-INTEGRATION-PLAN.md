# Supreme Admin — Integration Plan

Target: wire the fixed Supreme Admin build (from `Supreme Admin Claude/food-hubbie-supreme-admin-FIXED`) into this repo, link it to the existing `supreme` hosting target, deploy, and document every feature.

Source of truth: `Supreme Admin Claude/food-hubbie-supreme-admin-FIXED/SupremeAdmin/` (14 files, includes the 5 fixes from `fixes.patch`). Backend: `.../bot-control-api/` (Express + PM2 control + status watcher for EC2).

## 1. Current state (verified)

| Item | State |
|------|-------|
| `SupremeAdmin/` in repo | Empty placeholder (`.gitkeep`, empty `css/`, `js/features/`) |
| `.firebaserc` | Target `supreme` → hosting site `foodhubbie-supremeadmin` already mapped ✅ |
| `firebase.json` | Hosting entries: admin, rider, menu, assets. **No `supreme` entry** ❌ |
| `database.rules.json` | Project rules already grant `isSuper`/`isSupreme` read+write on `businesses` ✅ (bundle's minimal rules file must NOT replace it) |
| Firebase config | Real values in `Admin/firebase-config.js` (project `foodhubbie-10`) |
| Meta config | `.env` has `WA_PERMANENT_TOKEN`, `WA_VERIFY_TOKEN`, `WEBHOOK_PORT=5000`, `BOT_CONTROL_PORT=4000` |
| EC2 | `pizza-bot` + `webhook-server` running. No `bot-control-api` yet |
| Tunnel | Per bundle README: existing Cloudflare Tunnel should path-split `/api/*`→:4000, `/webhook*`→:5000 |

## 2. Access model (from bundle README + auth.js)

- `isSuper` → full access (onboard, restart, stop, reconnect, bulk).
- `isSupport` → read-only (views both dashboards, all mutating actions hidden).
- Neither claim → "Not authorized" screen.
- Security boundary is server-side: `bot-control-api` enforces `requireSuperOnly` on mutating routes; client hiding is UX only.
- Claims set out-of-band via Admin SDK + mirrored into `admins/{uid}`.

> ⚠️ Existing project rules at `admins/$uid/.validate` require `['email','outlet']` on every write. Writing `{isSuper:true}` alone will fail validation. Claim writes must include `email` + `outlet` too (or the rule needs relaxing — decide in step 6).

## 3. Work items

### A. Files into repo (done in this session)
1. Delete placeholder `SupremeAdmin/` (keep `.gitkeep`? No — replaced entirely).
2. Copy `SupremeAdmin/` (fixed build) → repo `SupremeAdmin/`.
3. Copy `bot-control-api/` → repo `bot-control-api/` (replacing its placeholder).

### B. Wire config
4. `SupremeAdmin/js/firebase-config.js`: fill `FIREBASE_CONFIG` from `Admin/firebase-config.js`; set `TUNNEL_URL` (real tunnel domain).
5. `SupremeAdmin/js/features/whatsapp-linking.js`: set `META_APP_ID`, `META_CONFIG_ID` (need real values — from Meta dashboard / credentials; if unavailable, leave `REPLACE_ME` + document).

### C. Hosting
6. Add `supreme` hosting entry to `firebase.json` (`public: "SupremeAdmin"`, SPA rewrite, security headers matching `admin` pattern).
7. Deploy: `firebase deploy --only hosting:supreme`.

### D. Security rules (decision, NOT blind merge)
8. Do **not** replace project `database.rules.json` with bundle's minimal version (would clobber all audited order/table/QR rules).
9. If `isSupport` read-only role is wanted: add read-only access on `businesses` for `isSupport` in existing rules + relax `admins/$uid` validate. Otherwise rely on existing `isSuper`/`isSupreme` access.

### E. Backend on EC2 (separate deploy, optional for hosting step)
10. Ship `bot-control-api/` to EC2, `npm install`, run under PM2 (`bot-control-api`, port 4000).
11. Configure tunnel path split + env (`FIREBASE_DATABASE_URL`, `DASHBOARD_ORIGIN`, `ALERT_OFFLINE_MINUTES`, `SLACK_ALERT_WEBHOOK_URL`, `META_SYSTEM_USER_TOKEN`).
12. Implement `/api/whatsapp/exchange` (stub 501 currently) if Embedded Signup is used.
13. Grant `isSuper` claim + `admins/{uid}` mirror for the owner account.

### F. Docs
14. `SupremeAdmin/FEATURE-LIST.md` — every feature, dashboard location, access level, usage.
15. Update this plan + progress tracker as work proceeds.

## 4. Risks / gotchas
- TUNNEL_URL unknown → dashboard restart/stop/quota calls dead until set. Hosting itself works without it.
- META_APP_ID / META_CONFIG_ID unknown → WhatsApp Embedded Signup won't open until filled.
- `admins/$uid` `.validate` blocks claim-mirror writes missing email/outlet.
- Bundle rules file must never replace project rules wholesale.
- Dashboard uses ES modules + root-relative `/js/...` imports → must be served from hosting root (public dir = `SupremeAdmin/`), matches `admin` pattern.
- CSP in hosting must allow `connect.facebook.net` + `https://*.cloudflaretunnel.com` if Embedded Signup is used.

## 5. UI/UX rebrand (owner request, this session)

Owner wants the Supreme Admin dashboard to match the **main Admin panel's look** (light/white, vibrant orange) instead of the dark ops-console aesthetic that shipped with the fixed build, with the WhatsApp dashboard in full WhatsApp-green.

### Theme model (target)
| Dashboard | Accent | Background |
|-----------|--------|------------|
| Restaurant Management | `#E84908` vibrant orange (matches Admin panel) | White / light slate (`#f8fafc`) |
| WhatsApp Agents | `#25D366` official WhatsApp green | White / light slate, bold colors |

- **Remove darkness entirely**: `:root` becomes light-only; `[data-theme="light"]` block deleted; theme toggle removed (no dark mode).
- **Bold the colors**: status colors saturated for light bg (`#16a34a` green, `#d97706` amber, `#dc2626` red).
- `.theme-restaurant` / `.theme-agent` local `--accent` override mechanism stays — every `var(--accent)` component reskins automatically.

### Work items
| # | Task | Status |
|---|------|--------|
| T1 | Swap `:root` palette → light/white + bold accent/status tokens, delete `[data-theme="light"]` | ✅ |
| T2 | Fix hardcoded dark-fallback colors (`#0b0f14` text on `.btn-primary`, `.brand-mark`, `.onboard-step-dot.state-done`) | ✅ |
| T3 | Remove theme toggle UI + `initTheme`/`applyTheme`/`toggleTheme` in `utils.js` + `main.js` action | ✅ |
| T4 | Check glass/drawer/modal/status-pill translucency contrast on white | ✅ |
| T5 | Deploy `firebase deploy --only hosting:supreme` + visual smoke test | ✅ |

### UI/UX review fixes (this session, Playwright-verified)
All 12 review findings fixed + 1 root-cause data bug:

| # | Fix | Verified |
|---|-----|----------|
| 1 | Mobile topbar: `@media (max-width:720px)` collapses brand-name / email / tab labels to icons | scrollWidth 687→390, no overflow |
| 2 | Data-age: `formatAge()`/`isStale()` + `updatedAt` in `flattenOutlets()`, fleet "Last update", 30s tick, stale rows dim `.row-stale` | Live rows show "just now", stale class applied |
| 3 | Empty-state CTAs (restaurants/fleet/analytics) for super accounts | CTA button renders on empty data |
| 4 | Status-pill alphas raised .12→.16 for light bg | Visual |
| 5 | "Not connected" uses non-pulsing `.static-dot` | HTML confirmed |
| 6 | Quota 501 hides whole card instead of leaking path | Card removed |
| 7 | `showConfirm` Esc-to-cancel | Listener added/removed |
| 8 | Toast cap at 4 visible | `while (children > 4)` drop oldest |
| 9 | ⌘K → Ctrl K on non-Mac | `navigator.platform` check in `startApp` |
| 10 | Fleet checkbox white backing + shadow | Visual |
| 11 | Onboarding "Creating…" keeps icon via `.btn-spinner` | Visual |
| 12 | Skeleton stops under `prefers-reduced-motion` | Media query |
| 13 | **Root cause**: `businesses/.read` missing at top level → whole-tree read `permission_denied`, tables always empty | Added isSuper/isSupreme `.read` on `businesses`; deployed; table + fleet now populate |

## 6. Data ID / permissions / WhatsApp naming audit (owner request, this session)

Verified against a live service-account dump of `businesses` (`roshani-cake`, `roshani-pizza`), all rules, all JS reads:

| # | Finding | Decision / Fix | Status |
|---|---------|----------------|--------|
| A1 | Display names live at `settings/Store/storeName`, not `outlet.name`/`biz.name` | Fall back across all three in `flattenOutlets()` + profile + analytics so real names always show | ✅ deployed |
| A2 | Pizza outlet's `settings/Store/storeName` was empty `""` (its menu site reads the same path) | Backfilled `storeName = "Roshani Pizza"` (matches `roshani-pizza` + cake outlet's reference) | ✅ |
| A3 | "Official WhatsApp" (Meta Cloud API) vs "Baileys / WhatsApp Web (QR)" were indistinguishable | `transport` threaded through rows; `transportLabel()`/`transportBadgeHtml()`; list column "Official · Connected/Not connected" + badge; profile split into "Official WhatsApp" + "Bot channel"; eyebrow "WhatsApp — Official API & Bot Channel" | ✅ deployed |
| A4 | Missing `transport` displayed "Not configured" but bot defaults to `'baileys'` | Default `'baileys'` in dashboard (mirrors `getTransportMode()`) → live outlets show "WhatsApp Web (QR)" | ✅ deployed |
| A5 | Supreme CSP lacked `apis.google.com` → Google sign-in popup would be blocked | Added to `script-src` + `frame-src` in `firebase.json` | ✅ |
| A6 | `fonts.gstatic.com woff2 404` | Google CDN purge of a stale cached CSS2 ref — transient, not a code bug (verified live) | ✅ no fix needed |
| A7 | `apis.google.com ERR_NAME_NOT_RESOLVED` | Environment DNS in owner's browser; email/password path works | ⚠️ env |
| A8 | Both outlets `botStatus=unknown` (uptime 0) | status-watcher matches PM2 `bot-{bid}-{oid}` but EC2 runs legacy `pizza-bot` → no match. SSH blocked (SG only allows `117.96.22.39`, current IP `182.70.180.227`) | ⚠️ blocked |
| A9 | Full page audit | Playwright: 2 rows, 2 fleet cards, profile/analytics/onboarding OK, no "Unnamed", badges correct, quota 501 handled | ✅ |

## 7b. Admin login card + console-error pass (owner request, this session)

| # | Finding | Decision / Fix | Status |
|---|---------|----------------|--------|
| B1 | **Every restaurant profile must show its admin username + password** | New "Admin login" glass-card on profile (super-visible, hidden for read-only): renders `outlets/{oid}/adminLogin` {email, password}; Edit/Save writes it; edit state kept in module memory so the 30s re-render tick can't wipe a half-typed form. Owner chose **UI-only — no account creation**: credentials are recorded/displayed manually, Firebase Auth accounts are NOT auto-created | ✅ deployed + Playwright verified |
| B2 | `<svg data-lucide="octagon-x">` not found (Stop button console spam) | lucide 0.344 exports `XOctagon` → attribute must be `x-octagon`. Fixed | ✅ deployed |
| B3 | `/api/whatsapp/quota` 501 on every profile visit | `loadQuota` now skips entirely unless `whatsapp.status === 'active'` (quota is meaningless without a Meta link and the API 501s without `META_SYSTEM_USER_TOKEN`). Card shows "Connect the Official WhatsApp API…" | ✅ deployed |
| B4 | Restart/stop 500 → generic toast | Client surfaces server `error`; server includes PM2 error detail (`process not found`, etc.) — actionable "Action failed — pm2 restart failed — process not found". Server change deploys to EC2 when SSH restored | ✅ client / ⚠️ server pending |

**Credentials storage decision:** `businesses/{bid}/outlets/{oid}/adminLogin` — safe spot. Rules cascade: no rule on `adminLogin` → `$businessData` `.read` (isSuper/isSupreme/businessId) → `$businessId` `.write` (isSuper/isSupreme/businessId). `settings/Store` is **world-readable** (customer app reads it unauthenticated) — credentials must NEVER live there.

**Restart 500 root cause (roshani-cake/cake):** expected — no PM2 process named `bot-roshani-cake-cake` exists (EC2 runs legacy `pizza-bot`; watcher matches per-outlet names). Not a frontend bug; resolved properly when SSH is restored and per-outlet processes are created.

**Permissions confirmed:** `isSuper`/`isSupreme` read entire `businesses` tree (now granted top-level); `isSupport` read-only; restaurant accounts = plain outlet admins; `admins/{uid}` + custom claims mirror; API `requireAuth` (claims) + `requireSuperOnly` (mutations).

## 7b. Connected number shown on profile (this session)

- Pizza bot runs Official WhatsApp (Meta, transport `meta`) on phoneNumberId `1211796118690392` → **display phone `+1 555-661-9086` / "Test Number"** (fetched live from Graph API), store WhatsApp `919724649971` (customer-facing).
- DB: wrote `businesses/roshani-pizza/outlets/pizza/whatsapp = {phoneNumberId, displayPhoneNumber, verifiedName, status:'active'}` + `bot.transport='meta'` so the dashboard's existing `outlet.whatsapp.status==='active'` check flips to **Connected**.
- Profile KPI tile now renders the connected number + verified name; Manage agent shows "Connected WhatsApp number". ✅ deployed + Playwright verified.
- Added `Cache-Control: no-cache, no-store, must-revalidate` to the supreme hosting JS/CSS/HTML headers — previously unset (Firebase default `max-age=3600`), which served stale JS for up to an hour after deploys.

## 7c. Baileys (WhatsApp Web / QR) connection flow — plan

**Goal:** let a super admin pair a WhatsApp number with the bot directly from the Supreme Admin dashboard via QR scan — no SSH/terminal.

**Current state:** bot runs on EC2 (PM2 `bot-{bid}-{oid}`); `bot/index.js` uses `printQRInTerminal: true`, so QR only appears in the terminal. Dashboard has no QR UI. `whatsapp-linking.js` only handles the Official (Meta) path.

**Target flow:**
1. Profile "Bot channel" card: "Connect WhatsApp Web (QR)" button (Baileys path), separate from "Reconnect WhatsApp" (Meta path).
2. `POST /api/bot/pair/{bid}/{oid}` → `bot-control-api` tells the bot to enter pairing mode (spawn Baileys socket with `authState` stored under `sessions/{bid}/{oid}/`, `printQRInTerminal: false`).
3. Baileys emits `qr` on `connection.update` — server caches the QR string; `GET /api/bot/pair/{bid}/{oid}/qr` (or long-poll) returns it.
4. Dashboard renders the QR (server-side `qrcode`/`qr-image` package → data URL, or tiny client renderer — prefer existing deps, `qrcode` is small) + "Scan with WhatsApp → Settings → Linked devices" instructions.
5. On `connection.update` status `open`: write `outlet.bot.transport='baileys'`, `outlet.bot.pairedAt`, set online; dashboard stops polling, shows "Connected (WhatsApp Web)".
6. Session authState persisted so PM2 restarts reuse the pairing (no re-scan).

**Files touched:** `bot-control-api/server.js` (pair endpoints), `bot/index.js` (pair-mode flag), `SupremeAdmin/js/features/restaurant-profile.js` + `whatsapp-linking.js` (QR modal + transport wiring), `transportLabel()` in `utils.js` already labels Baileys "WhatsApp Web (QR)".

**Risks:** QR expiry (~60s) → server must re-emit until scanned; single active pairing per outlet; bot must be running (or pair endpoint spawns it). Marked ⬜ pending owner go-ahead.

## 7. Key decisions (this session)

- **"Official WhatsApp" = Meta Cloud API** (`whatsapp-linking.js`, `outlet.whatsapp.*`, transport `'meta'`); **"Baileys / WhatsApp Web (QR)" = the bot's default channel** (`bot/transport`, transport `'baileys'`). UI always labels them distinctly; a single row never mixes the two.
- **Missing `transport` = `'baileys'`** in the dashboard, mirroring `getTransportMode()`'s runtime default — never render "Not configured" for a bot that is actually on WhatsApp Web.
- **Display-name single source:** `settings/Store/storeName` is the canonical name (customer menu app already reads it). Dashboard falls back `outlet.name → store.storeName → outlet.outletName` so it never invents names; DB gaps are backfilled at `settings/Store/storeName`, not on `outlet.name`.
- **Google sign-in CSP:** `https://apis.google.com` added to `script-src` + `frame-src` on the supreme target so the popup isn't CSP-blocked (DNS failure is environmental).
- **Bot status shows "Unknown"** because the EC2 status-watcher matches PM2 names `bot-{bid}-{oid}` but the server ran the legacy `pizza-bot` process. **Fixed 2026-08-13**: `ecosystem.config.js` apps renamed to `bot-roshani-pizza-pizza` / `bot-roshani-cake-cake` (canonical `bot-{bid}-{oid}`), pizza process recreated under that name, watcher now writes live `botStatus` (online/uptime/memory) to Firebase, restart returns 200 through the tunnel. Cake stays unstarted (no WhatsApp/phone routing configured yet).
- **Admin credentials = display + record only, no account creation** (owner decision): stored at `outlets/{oid}/adminLogin`, shown on the profile, editable by supers, invisible to read-only. Restaurant staff accounts still need manual creation in Firebase Auth — the card just records what to hand to staff.
- **Home IP is dynamic**: SSH times out when the ISP changes it. Authoritative process: check `https://api.ipify.org`, add `/32` to SG `sg-0a5a73df4b5d37b38` (AWS CLI command in `GUIDEs/SERVER-ACCESS-GUIDE.md`).
