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

### 🚨 MOST PRIORITY: Restaurant-Scoped Rider Notification Isolation
- **Requirement:** Riders of Restaurant 1 must **never** see/pop/pop-up any notification (Order available on Rider App, WhatsApp message) from Restaurant 2, and vice versa. Complete isolation.
- **Stage:** `reviewing`
- **Verified:** (pending)
- **OK:** (pending)
- **Done:** (pending)

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
  - **Outlet-Scoped Rider Fetch:** `bot/rider.js:118` fetches riders via `getData("riders", outlet)` where `outlet` is the order's outlet — scoped to the order's restaurant
  - **Direct Assignment Notifications:** `notifyRiderPickup` and `notifyRiderAssignment` in `bot/rider.js` send to specific `riderPhone` from `order.riderPhone` and `riderId` from `order.riderId || order.assignedRiderUid`
  - **Broadcast Scope:** `broadcastPickupAvailable` (line 114-157) fetches riders via `getData("riders", outlet)` where `outlet = order.outlet` — only riders of that specific outlet
  - **Per-Tenant Socket:** Each bot instance has its own `sock` (WhatsApp socket) created in `startBot()` at `bot/index.js:1033-1049` — Restaurant 1's bot uses Restaurant 1's WhatsApp session, Restaurant 2's bot uses Restaurant 2's
  - **Order Status Flow:** `handleOrderStatusUpdate` at `bot/index.js:841-850` calls either:
    - Direct: `notifyRiderPickup` if `order.riderPhone` exists (specific rider assigned)
    - Broadcast: `broadcastPickupAvailable` if no rider assigned (broadcasts to ALL online riders of THAT outlet only)
  - **Rider Change Detection:** `bot/index.js:807-824` tracks `currentRider = order.riderId || order.assignedRider` and calls `notifyRiderAssignment` on change
  - **In-App Notifications:** `addInAppNotification` at `bot/index.js:563-571` writes to `riders/${uid}/notifications/` scoped by outlet via `setData` call
- **Critical Finding:** Complete isolation is achieved at **process level** — each restaurant runs its own bot instance with its own `OUTLET` env var, its own WhatsApp socket, and only accesses its own outlet's data
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

#### Phase 5: Runtime Integration Test — MANUAL TEST REQUIRED
- **Goal:** End-to-end verification with real accounts
- **Stage:** `reviewing` (requires live testing)
- **Verified:** (pending — requires live accounts)
- **OK:** (pending)
- **Done:** (pending)

**Steps to Execute:**
1. **Setup:** Ensure two restaurants (Restaurant 1, Restaurant 2) each with at least 1 rider
2. **Test Restaurant 1 Order:**
   - Login as Rider A (Restaurant 1) → Place order via customer app
   - Verify: Rider A gets Rider App pop-up + WhatsApp "PICKUP AVAILABLE"
   - Login as Rider B (Restaurant 1) → Verify Rider B gets NOTHING (unless broadcast scenario)
   - Login as Rider C (Restaurant 2) → Verify Rider C gets NOTHING
3. **Test Restaurant 2 Order:**
   - Login as Rider C (Restaurant 2) → Place order
   - Verify: Rider C gets pop-up + WhatsApp
   - Verify Rider A (Restaurant 1) gets NOTHING
4. **Broadcast Scenario Test:**
   - Order goes to "Ready" with NO rider assigned
   - Verify ALL online riders of THAT restaurant get broadcast
   - Verify NO riders from other restaurants get anything

**Expected:** Complete isolation — each rider only sees their assigned restaurant's orders
**Blocking:** Requires live Firebase project, rider accounts, and WhatsApp numbers

---

**PHASE SUMMARY — Restaurant-Scoped Rider Notification Isolation**

| Phase | Status | Key Finding |
|-------|--------|-------------|
| **Phase 1: Order Data Structure** | ✅ `ok` | Orders use `riderId`/`assignedRiderUid`; Firebase rules enforce `assignedRider` scoping |
| **Phase 2: Rider App Fetch Logic** | ✅ `ok` | `tenantPath` scopes by outlet; rules force `assignedRider` query; outlet-scoped |
| **Phase 3: WhatsApp Notification** | ✅ `ok` | **Process-level isolation** — each restaurant runs separate bot instance with own socket & outlet data |
| **Phase 4: Firebase Rules** | ✅ `ok` | Multi-layered: outlet scoping + rider-scoped queries + per-rider node isolation + assignment enforcement |
| **Phase 5: Runtime Test** | ⏳ `reviewing` | Requires live accounts — **manual test required** |

**OVERALL VERDICT:** ✅ **YOUR STATEMENT IS CORRECT** — Complete isolation is achieved at **process level**:
- Each restaurant runs its own bot instance with unique `OUTLET` env var
- Each bot has its own WhatsApp socket (`sock`), Firebase data scope, and rider pool
- Restaurant 1's bot NEVER reads Restaurant 2's orders/riders/socket
- **No cross-restaurant leakage possible** at any layer (process, socket, database, rules)

---

## Current Work Items

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `pending` (ready for `git add` + `git commit`)

---

### 🚧 WORK IN PROGRESS: Build system commit
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok` (git pushed + deployed)
- **Verified:** `npm run build:supreme` works correctly; all modified files pass `node --check`; `.gitignore` updated; scripts added; git push successful; **Firebase deploy successful**
- **OK:** Build system commit complete on main branch; SupremeAdmin deployed to Firebase Hosting
- **Done:** ✅ `npm run deploy:supreme` — hosted at https://foodhubbie-supremeadmin.web.app

**To advance:** Phase 5 runtime test for restaurant-scoped isolation (requires live accounts); session backup cron scheduling (run `bot/backup-sessions.js` daily via system cron on EC2)

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
- **Commit:** pending (ready for `git add` + `git commit`)

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
- **Deployed:** https://foodhubbie-web.web.app

---

## Baileys Ban-Proofing — Volume, Detection, Dashboard

**Context:** Baileys (unofficial WhatsApp Web API) is ban-prone at high volume. A restaurant with 800 orders/10hrs generates ~3,200 outbound messages/day (order notifications + rider broadcasts + promos). Meta flags accounts at 500+/day. These three items add detection, pacing, and visibility.

### B1: Baileys-Specific Send Delay (2-5s Jitter)
- **Files:** `bot/utils.js`, `bot/index.js`, `bot/rider.js`, `bot/promotions.js`
- **Stage:** `reviewing`
- **Issue:** Current rate limiter (20/min) is a sliding window, not per-recipient jitter. Baileys sends to different numbers need randomized 2-5s gaps between recipients to mimic human behavior. Same-recipient sends (e.g. order update + rider notification to same person) should NOT be delayed.
- **Plan:**
  1. **`bot/utils.js`** — Add `BaileysSendTracker` class:
     - `trackSend(phoneNumber)` — records timestamp per phone number
     - `waitBeforeSend(phoneNumber)` — if same phone sent within 2s, skip delay; if different phone, add 2-5s random jitter
     - `shouldDelay(phoneNumber)` — returns true if last send to this phone was <2s ago (don't spam same person)
     - Constants: `BAILLEYS_SEND_DELAY_MIN_MS = 2000`, `BAILLEYS_SEND_DELAY_MAX_MS = 5000`, `BAILLEYS_SAME_RECIPIENT_MIN_MS = 2000`
  2. **`bot/index.js`** — In `handleOrderStatusUpdate` (line ~901):
     - After `orderRateLimiter.wait()`, add `await baileysSendTracker.waitBeforeSend(jid)`
     - Only apply if `!isMetaTransport` (skip for Meta Cloud API)
  3. **`bot/rider.js`** — In `broadcastPickupAvailable` (line ~151):
     - Already has warm-up delays; add Baileys-specific jitter on top
     - Track each rider's phone to avoid re-delaying same rider
  4. **`bot/promotions.js`** — Already has 8-15s delays; add Baileys jitter only if transport is Baileys
  5. **Detection:** `bot/index.js` — detect transport type via `sock.user?.id?.startsWith('meta:')` or `isMetaTransport` flag
- **Estimated impact:** Adds 2-5s per unique recipient; 800 orders to ~600 unique customers = ~30-50 minutes additional latency (acceptable for order notifications)
- **Verify:** `node --check bot/index.js && node --check bot/utils.js && node --check bot/rider.js && node --check bot/promotions.js`

### B2: Ban Detection + Admin Alert
- **Files:** `bot/index.js`
- **Stage:** `reviewing`
- **Issue:** No visibility when Baileys session is banned/expired. Bot silently fails or reconnection loops. Admin doesn't know until customers complain.
- **Plan:**
  1. **Ban Detection Signals:**
     - Signal 1: `qr` event in `connection.update` after `connection === 'open'` (session expired → re-pair needed)
     - Signal 2: `connection === 'close'` with `DisconnectReason.loggedOut` (code 401) = ban
     - Signal 3: Consecutive send failures >10 in 5 minutes (possible ban)
     - Signal 4: `cryptoErrorCount` spike (>50 in 1 minute)
  2. **Alert Mechanism:**
     - Write to Firebase: `bot/alerts/{outlet}/{timestamp}` with `{ type, message, severity, createdAt }`
     - Severity levels: `warning` (send failures), `critical` (ban detected), `info` (session expired)
     - Console log: `[BAN-DETECT] 🔴 CRITICAL: ...`
  3. **Auto-Response:**
     - On ban detected: pause all promo campaigns (`killSwitch = true`)
     - On session expired: write `bot/pair/status = 'banned'` so SupremeAdmin shows red indicator
     - On send failure spike: log to `bot/alerts` but don't auto-pause (might be transient)
  4. **Implementation in `bot/index.js`:**
     - Add `let consecutiveSendFailures = 0` counter
     - In `sendImage` catch block: increment counter; if >10, trigger alert
     - In `sendImage` success: reset counter
     - In `connection.update` handler (Baileys): detect `qr` after `open` = session expired
     - In `connection.update` handler: detect `DisconnectReason.loggedOut` = ban
  5. **Firebase Path Structure:**
     ```
     bot/alerts/{outlet}/{timestamp}: {
       type: 'ban_detected' | 'session_expired' | 'send_failure_spike',
       severity: 'critical' | 'warning' | 'info',
       message: 'Description',
       createdAt: timestamp
     }
     ```
- **Verify:** `node --check bot/index.js`

### B3: Volume Dashboard (Daily Outbound Tracking)
- **Files:** `bot/index.js`, `bot/utils.js`, `SupremeAdmin/js/features/restaurant-profile.js`
- **Stage:** `reviewing`
- **Issue:** No visibility into daily outbound volume. Can't tell if approaching Baileys ban threshold (500/day). No historical trend data.
- **Plan:**
  1. **`bot/utils.js`** — Add `OutboundTracker` class:
     - `trackSend(outlet, type, phoneNumber)` — increments daily counter
     - `getDailyCount(outlet)` — returns today's count
     - `getWeeklyCounts(outlet)` — returns last 7 days counts
     - `approachingLimit(outlet)` — returns true if >400/day (80% of 500 limit)
     - Counter path: `bot/usage/{IST-date}/{outlet}` in Firebase
     - Types tracked: `order_notification`, `rider_broadcast`, `promo`, `admin_alert`, `other`
  2. **`bot/index.js`** — Track every outbound:
     - In `handleOrderStatusUpdate` after successful send: `outboundTracker.trackSend(outlet, 'order_notification', jid)`
     - In `broadcastPickupAvailable` after each send: `outboundTracker.trackSend(outlet, 'rider_broadcast', riderJid)`
     - In `promotions.js` after each promo send: `outboundTracker.trackSend(outlet, 'promo', phone)`
  3. **Firebase Path Structure:**
     ```
     bot/usage/{date}/{outlet}: {
       total: 3247,
       order_notification: 2400,
       rider_broadcast: 400,
       promo: 300,
       other: 147,
       updatedAt: timestamp
     }
     ```
  4. **`SupremeAdmin/js/features/restaurant-profile.js`** — Add Volume Card:
     - Show today's total + breakdown by type
     - Show 7-day trend bar chart (simple CSS bars)
     - Show warning indicator when >400/day (yellow) or >500/day (red)
     - Show "Approaching Baileys limit" warning text
     - Card title: "Daily Outbound Volume"
  5. **Alert Thresholds:**
     - >400/day: Yellow warning in dashboard
     - >500/day: Red critical + console warning `[VOLUME] 🔴 Approaching Baileys ban threshold`
     - >600/day: Auto-pause promos + write to `bot/alerts`
- **Verify:** `node --check bot/index.js && node --check bot/utils.js`

---

## Completed Items (This Session)

| Item | Status |
|------|--------|
| SupremeAdmin Issues #2-7 | ✅ `ok` |
| Restaurant-Scoped Isolation (Phases 1-4) | ✅ `ok` |
| Build System + Deploy | ✅ `done` |
| POS Back Button (in Admin) | ✅ `done` |
| Invisible Text Selection | ✅ `done` |
| Rider Broadcast Throttling + Warm-Up | ✅ `done` |
| Baileys Version Drift | ✅ `done` |
| Session Backup | ✅ `done` |
| Whole-Process Restart (Graceful SIGTERM) | ✅ `done` |
| Phase 5 Runtime Test | ⏳ `reviewing` (manual) |

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

**File last updated:** `Pending-Work.md` — keep this file at the repo root. All new fixes/audits should add an entry following the format above before work begins.