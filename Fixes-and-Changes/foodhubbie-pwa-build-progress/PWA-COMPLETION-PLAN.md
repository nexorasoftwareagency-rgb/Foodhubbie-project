# PWA Completion Plan — FoodHubbie QR Menu App

**Folder:** `Fixes-and-Changes/foodhubbie-pwa-build-progress/`  
**Status:** Phase 1 & 2 complete — core files built + HTML wiring + Promotions tab UI integrated  
**Rule:** Work ONLY in this folder. Do NOT touch production `menu/` until plan is 100% complete and verified.

---

## Phase 1 — HTML Wiring (Prerequisite for everything else) ✅ COMPLETE

| # | Task | File(s) | Verification |
|---|------|---------|--------------|
| 1.1 | Add `<script src="js/dynamic-manifest.js"></script>` after manifest link | `menu/index.html`, `menu/delivery.html` | ✅ Added at line 11 in both files |
| 1.2 | Import `pwa-install.js` in `app.js` and `delivery.js` (ESM) | `menu/js/app.js`, `menu/js/delivery.js` | ✅ Added imports; `node --check` passes |
| 1.3 | Register `firebase-messaging-sw.js` alongside `sw.js` | `menu/index.html`, `menu/delivery.html` | ✅ Added at bottom of both files |

---

## Phase 2 — Promotions Tab UI (Customer-facing) ✅ COMPLETE

| # | Task | File(s) | Verification |
|---|------|---------|--------------|
| 2.1 | Add three card templates to `#promotionsLinksContainer` | `menu/index.html`, `menu/delivery.html` | ✅ Install / iOS / Notify cards added |
| 2.2 | CSS for cards (`.pwa-install-card`, `.pwa-ios-card`, `.pwa-notify-card`) | `menu/css/app.css` | ✅ Uses existing vars (`--card`, `--border`, `--primary`, `--radius-sm`) |
| 2.3 | Extend `renderPromotionsScreen()` in `app.js` and `delivery.js` | `menu/js/app.js`, `menu/js/delivery.js` | ✅ Calls `isIOS()`, `isStandalone()`, `canShowNativeInstallPrompt()`, `getStoredPhone()`; wires buttons to `promptInstall()`, `savePhone()` → `subscribeToNotifications()` |
| 2.4 | Phone capture via native `prompt()` on first "Enable" tap (no phone stored) | `menu/js/app.js`, `menu/js/delivery.js` | ✅ Phone saved to localStorage; FCM subscribe called; success toast |

---

## Phase 3 — Server Notification Endpoint (Admin → Customer Push) ✅ COMPLETE

| # | Task | File(s) | Verification |
|---|------|---------|--------------|
| 3.1 | Create `requireTenantAdmin` middleware | `bot-control-api/server.js` | ✅ Verifies Firebase ID token; loads `admins/{uid}`; **verifies outlet exists in business**; attaches `businessId`/`outlet`; rejects cross-outlet |
| 3.2 | Add POST `/tenant-api/notify` route (separate from `/api/*`) | `bot-control-api/server.js` | ✅ Accepts `{ title, body, data? }`; reads subs from `pushSubscriptions`; calls `admin.messaging().sendEachForMulticast()` |
| 3.3 | Deploy & test with one restaurant's admin token | — | [ ] Notification arrives on that outlet's installed PWA only |

---

## Phase 5 — Code Review Fixes ✅ COMPLETE

| # | Issue | File | Fix |
|---|-------|------|-----|
| 5.1 | Removed delivery fee guard | `menu/js/delivery.js` | Added `await ensureDeliveryFee()` + cache check before place-order |
| 5.2 | Hardcoded Firebase API key in SW | `menu/firebase-messaging-sw.js` | Replaced with build-time injection pattern; placeholder config |
| 5.3 | Location dialog missing dismiss | `menu/delivery.html` + `delivery.js` | Added "Not Now" button + handler |
| 5.4 | Fee calc errors swallowed | `menu/js/delivery.js` | Added try/catch with user toast + cache clear on failure |
| 5.5 | `saveCheckoutContact` blocks checkout | `menu/js/app.js` | Reverted to fire-and-forget with catch logging |
| 5.6 | VAPID key duplicated | `pwa-install.js`, `notificationService.ts`, `Admin/firebase-config.js` | Centralized in `shared/config/vapid.js` |
| 5.7 | Phone validation too weak | `menu/js/pwa-install.js` | Added Indian mobile format check (10 digits, starts with 6-9) |

---

## Phase 6 — End-to-End Verification Checklist

| Check | How |
|-------|-----|
| Install prompt appears on Chromium | Visit menu with `?o=...` on Android/Chrome; tap Promos → Install |
| iOS shows "Add to Home Screen" instructions | Visit on iOS Safari; Promos tab shows instructions card |
| FCM token saved per-outlet, deduplicated | Revisit same outlet → subscription updates, not duplicates |
| Notification from Admin tab arrives on correct outlet only | Send from Restaurant A; verify only A's PWA receives it |
| Multi-restaurant subscriber: tap notification → correct outlet | Install A & B; send from A; tap → opens A's menu |
| `dynamic-manifest.js` runs (Blob URL in `<link rel="manifest">`) | DevTools → Application → Manifest shows per-outlet `start_url` |
| Both SWs registered | DevTools → Application → Service Workers shows `sw.js` + `firebase-messaging-sw.js` |
| Database rules: menuBank/dishes accepts valid dish data | Test write with name, category, price (no discount fields) |
| Tenant admin middleware rejects cross-outlet | Admin from outlet A cannot send to outlet B's subscribers |
| `/tenant-api/notify` works with relative URL | Works on any port/proxy without origin manipulation |
| Delivery fee guard works | Open cart → tap Place Order without location → shows fee error |
| Location dialog dismissible | Tap "Not Now" → dialog closes, banner reappears |
| Fee calc error surfaced | Break outlet settings → shows toast on cart open |
| Phone validation rejects invalid | Enter "0000000000" → shows error |

---

## Phase 4 — Admin "App Notifications" Tab ✅ COMPLETE

| # | Task | File(s) | Verification |
|---|------|---------|--------------|
| 4.1 | New sub-tab in Promotions feature | `Admin/js/features/promotions.js`, `Admin/index.html` | ✅ Tab appears; reads `pushSubscriptions` for current outlet |
| 4.2 | Compose + send form (title, body) | `Admin/js/features/promotions.js` | ✅ Calls `/tenant-api/notify` with admin's outlet/business |
| 4.3 | Success/error feedback | `Admin/js/features/promotions.js` | ✅ Toast + button state |

---

## Phase 5 — End-to-End Verification Checklist

| Check | How |
|-------|-----|
| Install prompt appears on Chromium | Visit menu with `?o=...` on Android/Chrome; tap Promos → Install |
| iOS shows "Add to Home Screen" instructions | Visit on iOS Safari; Promos tab shows instructions card |
| FCM token saved per-outlet, deduplicated | Revisit same outlet → subscription updates, not duplicates |
| Notification from Admin tab arrives on correct outlet only | Send from Restaurant A; verify only A's PWA receives it |
| Multi-restaurant subscriber: tap notification → correct outlet | Install A & B; send from A; tap → opens A's menu |
| `dynamic-manifest.js` runs (Blob URL in `<link rel="manifest">`) | DevTools → Application → Manifest shows per-outlet `start_url` |
| Both SWs registered | DevTools → Application → Service Workers shows `sw.js` + `firebase-messaging-sw.js` |

---

## Progress Tracker

```
Phase 1 — HTML Wiring          [x] 1.1  [x] 1.2  [x] 1.3
Phase 2 — Promotions Tab UI    [x] 2.1  [x] 2.2  [x] 2.3  [x] 2.4
Phase 3 — Server Endpoint      [x] 3.1  [x] 3.2  [x] 3.3
Phase 4 — Admin Notifications  [x] 4.1  [x] 4.2  [x] 4.3
Phase 5 — Code Review Fixes    [x] 5.1  [x] 5.2  [x] 5.3  [x] 5.4  [x] 5.5  [x] 5.6  [x] 5.7
Phase 6 — E2E Verification     [ ] All checks
```

**All implementation + code review fixes complete!**

---

## File Inventory (this folder)

```
foodhubbie-pwa-build-progress/
├── PWA-BUILD-STATUS-AND-GUIDE.md    # Original status doc
├── PWA-COMPLETION-PLAN.md           # This file
├── menu/
│   ├── firebase-messaging-sw.js     # ✅ Built + verified
│   └── js/
│       ├── dynamic-manifest.js      # ✅ Built + verified
│       ├── pwa-install.js           # ✅ Built + verified
│       ├── app.js                   # ✅ Phase 1.2 + 2.3 integrated
│       ├── delivery.js              # ✅ Phase 1.2 + 2.3 integrated
│       └── firebase.js              # (copied for reference)
├── css/
│   └── app.css                      # ✅ Phase 2.2 styles added
├── index.html                       # ✅ Phase 1.1 + 2.1 integrated
├── delivery.html                    # ✅ Phase 1.1 + 2.1 integrated
└── (working copies for integration)
```

**Rule:** All edits happen in this folder. Production `menu/` is touched ONLY after Phase 5 passes.