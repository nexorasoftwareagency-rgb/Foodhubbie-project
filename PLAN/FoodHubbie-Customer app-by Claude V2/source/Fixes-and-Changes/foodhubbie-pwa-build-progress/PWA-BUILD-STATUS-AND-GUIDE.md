# PWA / Manifest / Notifications Build — Status, Reasoning & Continuation Guide

> **Repo:** `Foodhubbie-project`, mainly `menu/` (customer QR ordering app), plus a small Admin + server piece still to come.
> This document captures everything built so far, the reasoning behind every non-obvious decision, and the exact remaining steps — so this can be picked up and finished in a later session without re-deriving anything.

---

## How this fits the overall plan

This is the **foundational piece** of Points 4 & 5 from the original plan (install prompt + phone identity + restaurant-scoped push notifications). Per that plan's own build sequence, this had to come *before* anything else in Points 4/5, because without it, an installed app has no reliable way to remember which restaurant it belongs to — which would make "install this restaurant's app" and "notify only this restaurant's customers" both unreliable from day one.

**Confirmed design decisions this build implements** (all confirmed by Nilesh in earlier turns, not assumed):
- Outer branding: constant **"FoodHubbie"** on every install (name, icon, theme color) — never per-restaurant branding on the icon itself.
- Each installed instance is **dedicated to one restaurant internally** — correct menu, correct notifications, correct ordering scope, achieved via a unique `start_url`/`id` per outlet baked into the manifest.
- A customer installing multiple restaurants' instances is fine and expected — they stay fully separate, never merged.
- Phone identity: **Option A — no OTP verification.** Captured once, stored locally, reused across every restaurant (one identity, not per-restaurant).
- Push delivery: **Firebase Cloud Messaging (FCM)** — reusing the exact pattern already proven working in `Admin/js/fcm-init.js`, not raw Web Push.

---

## ✅ What's built and verified (3 files, ready to deploy)

Every file below was syntax-checked (`node --check`, including proper ESM validation via a `.mjs` copy where relevant) and, where the logic was pure enough to test without real browser APIs, functionally verified with actual test inputs — not just read and assumed correct.

### 1. `menu/js/dynamic-manifest.js` — NEW FILE

**What it does:** Replaces the static `manifest.json` link with one generated client-side, per outlet, at page load.

**The critical discovery that shaped this file:** I initially planned a relative path (`../Admin/icon-erp-logo.jpeg`) to reuse the existing FoodHubbie logo for consistent branding. Before committing to that, I checked `firebase.json`'s hosting config directly — **`menu` and `Admin` are deployed as separate Firebase Hosting sites/origins**, not sibling folders under one domain. A relative or even root-absolute path between them would have silently failed to load the icon. The fix: embed the actual logo as a base64 data URI instead. I verified this is safe by checking the `menu` site's CSP headers, which already include `manifest-src 'self' blob:` and `img-src ... data: ...` — meaning this exact technique was already anticipated in the hosting config, not something I'm introducing against the grain.

**Verified:**
- `node --check` passes.
- Functionally tested with mocked browser APIs: `start_url`/`id` correctly built as `./index.html?o=cake&b=roshani-cake` from URL params, **with the session token (`?t=`) confirmed NOT leaked into it** — important, since the installed icon should represent an ongoing relationship with the restaurant, not one table visit.
- Icon embedding verified **byte-for-byte identical** to the source file via SHA-256 hash comparison (encode → decode → compare).
- Tested the "no `?o=` in URL at all" case (e.g., a bare bookmark) — correctly leaves the static `manifest.json` in place rather than guessing.
- Tested `?o=` present without `?b=` — correctly still produces a valid, outlet-scoped `start_url` without needing to duplicate the `BUSINESS_BY_OUTLET` resolution map a third time (the app's own existing boot logic resolves the full business ID when it actually loads).

**One corrected inaccuracy along the way:** the existing `Admin/manifest.json` claims its icon is `512x512`; the actual file is `208x200` (confirmed via `file`/`identify`). My new manifest declares the true size.

**Not yet verified:** iOS Safari's handling of a Blob-based manifest during "Add to Home Screen" — this needs a real device test once deployed. Flagged in the file's own header comment so it isn't forgotten.

### 2. `menu/firebase-messaging-sw.js` — NEW FILE

**What it does:** The service worker FCM requires for background push notifications. Pattern copied directly from the already-working `Admin/firebase-messaging-sw.js`.

**The one deliberate deviation from the Admin version, and why:** Admin's version always deep-links to the same fixed URL — fine, since Admin only ever represents one thing. This version **must** carry the outlet/business identity from the notification's own payload data, not from the browser's local state. Reasoning verified against the earlier audit finding: a customer subscribed to more than one restaurant could tap a notification from Restaurant A while Restaurant B is the most recently visited one locally — the click must still land on A's menu.

**Verified:**
- `node --check` passes.
- The URL-building logic (`?o=`/`?b=` construction from payload data) tested in isolation — correctly handles outlet+business present, outlet only, neither present, and values containing special characters requiring URL-encoding.
- Notification click handler reuses an already-open tab only if it's for the *same* outlet the notification was for — never reuses a tab open for a different restaurant just because the app happens to be open.

### 3. `menu/js/pwa-install.js` — NEW FILE

**What it does:** The orchestration module — platform detection (iOS vs. Chromium), install prompting, phone capture, and FCM subscription.

**Key design decisions inside this file:**
- **`beforeinstallprompt` is captured and deferred**, not auto-triggered — lets the Promotions tab UI decide exactly when to show the install option, rather than the browser's own default heuristic.
- **`isIOS()`/`isStandalone()`** are exported separately so the UI layer (still to build) can decide which card to show — native install button (Chromium) vs. manual "Add to Home Screen" instructions (iOS, where `beforeinstallprompt` never fires at all).
- **Phone validation** strips all non-digit characters first (handles `+91`, spaces, dashes gracefully), then requires at least 10 digits — tested with multiple real-world input formats.
- **The duplicate-subscription guard:** this is the one piece I was most deliberate about, given this exact codebase has hit the "double-registration" failure class twice before on the WhatsApp side (the Baileys listener bug and the Meta/Baileys dual-process conflict from earlier in this review). Instead of using Firebase's auto-generated push IDs for each subscription, the FCM token itself (sanitized for Firebase's key-character restrictions) becomes the record's key — so re-subscribing on a later visit **updates** the existing record instead of creating a duplicate. Verified the sanitizer correctly strips the actual Firebase-forbidden characters (`.`, `#`, `$`, `[`, `]`, `/`) while correctly leaving valid characters like `:` untouched (confirmed `:` is not actually in Firebase's restricted set, rather than assuming).
- **The VAPID key is a clearly-marked placeholder** (`PASTE_VAPID_PUBLIC_KEY_HERE`), per your instruction to leave that for your agent to handle. Until it's set, `subscribeToNotifications()` fails loudly with a specific console error rather than silently doing nothing — so it's obvious what's missing when someone tests this, not a mystery bug.

**Verified:**
- `node --check` passes, including proper ESM validation.
- Phone validation and token-sanitization logic both functionally tested with real inputs, not just read.
- Confirmed all imports (`app`, `outletRef`, `set`, `OUTLET`, `BUSINESS_ID`) are actually exported from `menu/js/firebase.js` as expected, by reading that file directly rather than assuming the API shape.

---

## 🟡 What's designed but not yet built

I was actively building these when this status was requested — the design decisions below are final, just not yet written as verified file content.

### 4. Promotions tab HTML — install card, iOS instructions card, notify card

Location confirmed: `menu/index.html`, inside `#screenPromotions`, above the existing `#promotionsLinksContainer`. Three cards, shown/hidden based on `pwa-install.js`'s exported state functions:
- **Install card** (Chromium only — hidden on iOS): "Install the FoodHubbie App" + an Install button calling `promptInstall()`.
- **iOS instructions card** (iOS only, not yet installed): "Add to Home Screen" with Share-icon-then-"Add to Home Screen" instructions, since `beforeinstallprompt` never fires there.
- **Notify card**: "Get Offers & Updates" + an Enable button. On iOS, only shown *after* `isStandalone()` is true (push requires install-first there); on Chromium, can show independently of install.

Phone capture: decided to use a simple native `prompt()` dialog rather than a custom modal, the first time someone taps "Enable" with no phone already stored — consistent with the "no sign-up, just a phone number" low-friction intent, and avoids building an entire modal UI for a one-time, low-stakes input.

### 5. CSS for the three cards

Not yet written. Will follow the existing visual language already confirmed from earlier work in this session (`--card`, `--border`, `--primary`, `--radius-sm` variables, consistent with the empty-state and group-choice-card styling already shipped).

### 6. Wiring in `menu/js/app.js`

`renderPromotionsScreen()` (confirmed location: line 845) needs extending to: call the `pwa-install.js` state functions, decide which of the three cards to show, and wire their button clicks to `promptInstall()` / phone-prompt-then-`subscribeToNotifications()`.

### 7. Script registration in `index.html` and `delivery.html`

Two things needed in both files:
- A `<script type="module" src="js/pwa-install.js">` tag (or import it from `app.js`/`delivery.js`, which are already loaded as modules — likely the cleaner option, avoiding a second script tag).
- Service worker registration for `firebase-messaging-sw.js`, alongside the existing `sw.js` registration (confirmed both already use `navigator.serviceWorker.register('sw.js')` at `index.html:498` and `delivery.html:262` — the new registration needs to coexist with this, not replace it).

### 8. Server-side notification send endpoint

**Important finding from investigation, not yet acted on:** the existing `bot-control-api/server.js` applies `requireAuth` globally to all `/api/*` routes, and that middleware **only allows `isSuper`/`isSupport` claims** (SupremeAdmin-only — confirmed by reading the middleware directly). A regular tenant restaurant admin would be rejected outright. This means the new "send notification" endpoint **cannot** simply live under the existing `/api/*` prefix — it needs its own route prefix and a new `requireTenantAdmin`-style middleware that:
- Verifies the Firebase ID token (same as `requireAuth` does).
- Looks up `admins/{uid}` and confirms the record exists (any admin, not just super).
- Attaches that admin's own `businessId`/`outlet` to the request, and the route handler restricts the notification send to only that admin's own outlet — never letting one restaurant's admin send to another's subscribers.

Confirmed `firebase-admin`'s messaging capability (`admin.messaging().sendEachForMulticast`) is already a proven, working pattern in this exact codebase (`bot/index.js`, used for rider-app push) — so the sending mechanism itself is low-risk to replicate; the new piece is purely the auth/routing layer.

### 9. Admin-side "App Notifications" tab

Not yet started. New sub-tab inside Admin's existing Promotions feature — reads `businesses/{bid}/outlets/{oid}/pushSubscriptions/*`, lets the restaurant write a title/message, calls the new server endpoint from #8.

---

## What I need from you before finishing #8/#9

Nothing new beyond what's already flagged — the VAPID key is confirmed as "your agent will handle it later," already reflected as a placeholder in `pwa-install.js`. Everything else in the remaining list is buildable without further input from you; I'll continue straight down this list in a follow-up session.

---

## Deploy notes for the 3 completed files, once applied

1. Add `menu/js/dynamic-manifest.js` and `menu/firebase-messaging-sw.js` as new files (exact content in this zip).
2. Add `menu/js/pwa-install.js` as a new file.
3. **Not yet done, needed to actually activate file #1:** add `<script src="js/dynamic-manifest.js"></script>` right after the existing `<link rel="manifest" href="manifest.json">` line in both `index.html` and `delivery.html` — this one small wiring step is the only thing standing between "file exists" and "file actually runs." I'd intended to include this in the HTML-wiring pass (item #7 above) alongside the pwa-install.js script tag and SW registration, so it's grouped with the rest of the HTML changes rather than half-applied now.
