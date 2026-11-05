# Plan — Customer App Onboarding, Identity and Notifications

**Status:** APPROVED / IMPLEMENTED — see `docs/PROGRESS-CUSTOMER-APP-ONBOARDING.md` for current verification
**Date:** 2026-10-20
**Scope:** customer QR menu (`menu/index.html`), delivery webview (`menu/delivery.html`), menu JS/CSS, Realtime Database rules, `bot-control-api`, Admin Promotions > App Notifications
**Companion tracker:** `docs/PROGRESS-CUSTOMER-APP-ONBOARDING.md`
**Related prior plan:** `Fixes-and-Changes/foodhubbie-pwa-build-progress/PWA-COMPLETION-PLAN.md`

---

## 1. What this plan delivers

A Zomato/Swiggy-style start experience for the customer app, without turning it into a login-walled app:

1. First run shows a short, skippable onboarding sequence: value pages -> name + mobile -> notification permission -> install (when useful) -> location (delivery only).
2. The mobile number becomes the customer's access key. No OTP and no Firebase Auth for the customer, for now. Name, phone and consent are stored locally and in a phone-keyed profile node.
3. Promotions is restructured into three sub-tabs: **Offers**, **Notifications**, **Account**.
4. The notification path is connected end to end:
   Admin Promotions > App Notifications -> `POST /tenant-api/notify` -> FCM data-only -> customer service worker -> notification click deep link -> in-app Notifications tab.
5. Order updates (Placed / Ready / Delivered / rider assigned) also reach the customer app through FCM and the same inbox, in addition to WhatsApp.
6. The existing QR/table flow keeps working. Onboarding never blocks food ordering; it can be skipped and re-opened from Account.

This is a plan, not an implementation. Nothing below is deployed by this document.

---

## 2. Decisions that need sign-off

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | Promotions sub-tabs | `Offers` / `Notifications` / `Account` | Matches the request (notification as its own sub-tab) and gives install, identity and permissions a permanent home. |
| D2 | Is onboarding blocking? | No. Skippable, plus "Skip for now" on every step. | Dine-in ordering must not require a name or phone. Zomato/Swiggy gate checkout, not browsing; our table flow already identifies the table. |
| D3 | Is phone mandatory? | Only to enable notifications, recover a profile on a new device, or use Account. Not to order. | Lowest friction; keeps the QR promise. |
| D4 | Location | Delivery only. Reuse the existing location dialog. Never ask on dine-in. | Dine-in has no delivery fee or address. Asking there trains users to deny permissions. |
| D5 | Marketing consent | Default OFF. Order updates default ON. | Consent must be explicit; transactional order messages are expected after opt-in to notifications. |
| D6 | Where the app profile lives | `businesses/{bid}/outlets/{oid}/customers/{phone}/app` | Reuses the existing customer directory, keeps the bot's flat customer fields untouched, and lets rules validate the outlet path. |
| D7 | Notification inbox | Server-persisted `pushInbox/{phone}/{pushId}` | A Notifications tab that only shows alerts received while the app is open is not credible. Server fan-out is small at restaurant volume. |
| D8 | Cross-device order history by phone | Phase 6, not this pass | Requires a phone-keyed order index and a decision on delivery-order visibility. Only QR orders are publicly readable today. |
| D9 | OTP | Later. Copy must never imply the number is verified. | Adding OTP now duplicates WhatsApp's verified number and adds SMS cost. Treat phone as an identifier, not authentication. |
| D10 | Bottom nav label | Keep `Promos` for this pass. Optionally rename to `Offers` later. | Avoid changing navigation semantics in the same release as the sub-tabs. |

If any of D1-D7 changes, update the affected phase before implementation.

---

## 3. Source audit — what already exists

### 3.1 Documents and plans found

| Document | What it says | Status |
|----------|--------------|--------|
| `Fixes-and-Changes/foodhubbie-pwa-build-progress/PWA-COMPLETION-PLAN.md` | Phases 1-5 complete: HTML wiring, Promotions cards, phone prompt, FCM subscription, Admin App Notifications tab, `/tenant-api/notify`. Real-device checks still open. | Implemented, partially verified |
| `Fixes-and-Changes/foodhubbie-pwa-build-progress/PWA-BUILD-STATUS-AND-GUIDE.md` | Confirmed decisions: constant FoodHubbie branding, one restaurant per installed instance, one global phone identity, no OTP, FCM. | Implemented |
| `docs/PLAN-FEATURES-SUBTAB.md` | Existing sub-tab pattern in Admin Settings. Useful for the segmented-control pattern only; not the customer plan. | Implemented |
| `docs/FINAL-END-TO-END-FLOW.md` | Overall order/session lifecycle. | Reference |
| `docs/FOODHUBBIE-AUDIT-REPORT.md` | Audit findings, including the `menu/shared` hosting constraint and outlet resolution sync. | Reference |
| `docs/WHATSAPP-ONBOARDING-FULL-FLOW.md` | WhatsApp bot onboarding, not the customer app. | Reference |
| `PENDING_WORK.md`, `Pending-Work.md` | Outstanding-work lists. No customer-onboarding plan inside. | Reference |
| `Competitor/COMPARISON.md`, `Competitor/GAP-LIST.md`, `Competitor/profiles/aggregators.md` | Positioning against aggregators: "we are selling the exit from them". No start-flow comparison existed. | Reference |
| `PROJECT_LEDGER.md` entries `20260715-025004-e40a`, `20261014-180319-b6a0`, `20261020-150200-9c7d` | PWA shell, notification endpoint/E2E, and the current push/install P0 fixes. | Implemented |

### 3.2 Code that already exists

| Area | File | Current behavior |
|------|------|------------------|
| Install prompt | `menu/js/pwa-install.js` | Captures `beforeinstallprompt`, Chromium install card, iOS Add-to-Home-Screen card. |
| Phone capture | `menu/js/pwa-install.js` | `fh_customer_phone`, 10-digit Indian mobile validation, native `prompt()` from the notify card. |
| Push subscription | `menu/js/pwa-install.js` | Registers FCM worker at scope `firebase-messaging-sw/`, gets token, writes `pushSubscriptions/{safeToken}` with `phone/outlet/business/platform/updatedAt`. |
| Promotions screen | `menu/js/app.js:1160` | Install / iOS / notify cards plus `promotionsLinksContainer`. Notify card hides Enable if any phone is stored. |
| Promotions markup | `menu/index.html:475`, `menu/delivery.html:224` | Same three cards, no sub-tabs, no profile UI. |
| Push rules | `database.rules.json:137` | Anonymous create of a subscription is allowed with token/outlet/platform/updatedAt and optional 10-digit phone. Admin read/send only. |
| Background push | `menu/firebase-messaging-sw.js` | Data-only handler, title/body from data, tag `promo-*`, deep link `?o=&b=`. No order route, no campaign grouping. |
| FCM send (promo) | `bot-control-api/server.js:963-1026` | `POST /tenant-api/notify`, outlet-scoped, data-only multicast, test mode. Web push click link points at the **Admin** origin (bug). No audience filter. |
| Admin UI | `Admin/js/features/promotions.js`, `Admin/index.html:4725+` | App Notifications tab: subscriber count, title/body, test mode, send. No offer-consent filter, no inbox, no preview. |
| Order push (bot) | `bot/index.js` | Rider and admin FCM exist. No customer FCM on order status. |
| Customer data | `menu/js/order.js`, `menu/js/session.js` | QR order excludes phone PII; phone goes to `tableSessionsContact/{sessionId}`. `guests/{phone}/orders/{orderId}` is used as a QR order index. |
| Profile data | `database.rules.json:178`, `:207`, `:227` | Outlet-scoped `profiles` (admin read; anonymous write when `lastOutlet` matches), `customers` (admin/rider only), `guests` (anonymous QR index writes). |
| Admin customers | `Admin/js/features/customers.js` | Reads outlet `customers` and orders; keyed by phone. |
| Bot customer writes | `bot/index.js:1843` | Delivery webview order writes `customers/{phone}` with name/address/location/orderCount/totalSpent. `promotionalConsent: true` is silently set. |

### 3.3 What is missing

- No first-run onboarding.
- No name capture and no profile screen.
- Phone is stored only in `localStorage`; there is no phone-keyed app profile.
- No notification preferences, no unsubscribe, no permission state UI.
- No notification inbox; no in-app foreground handler.
- No deep link from a notification into Notifications or Tracking.
- Promo click link points to Admin, not the customer menu.
- No transactional customer FCM for order status.
- No "switch number" / "clear this device" path.
- No Zomato/Swiggy start-flow comparison document (this plan adds one).

---

## 4. Competitor start-flow comparison

> Based on the public consumer flows as of 2025-26. Both apps change frequently and vary by city, OS and A/B bucket. This comparison is about structure, not pixel copying.

### 4.1 Stage by stage

| Stage | Zomato | Swiggy | FoodHubbie today | Target |
|-------|--------|--------|------------------|--------|
| Launch | Brand splash; location is the first real decision | Brand splash; location is the first real decision | Boots directly to table welcome / menu | Keep the fast boot. Add onboarding only on a genuinely new browser. |
| Location | Asks for location with a rationale, offers "Use current location" and manual address; delivery is impossible without it | Same: location first, permission or address, then restaurants | Delivery page opens a location dialog on load; dine-in never asks | Delivery only, after identity, reusing the existing dialog. Manual address always available. |
| Identity | Phone number -> OTP; some surfaces allow browsing before login | Phone -> OTP or Google; browsing allowed, login required at checkout | No identity; phone prompt only when enabling notifications | Name + mobile, no OTP; skippable; never required to order. |
| Name | Optional profile field, often requested after OTP | Name captured during profile setup | None | One field on the identity page; used for greetings and order contact. |
| Permissions | Location mandatory; notifications requested contextually with an in-app explanation | Location mandatory; notifications contextual, often at first order | Notification permission requested directly from the Enable button; location on delivery load | Priming screen before each OS dialog; one ask per screen; status always visible in Account. |
| Install | App-store install first | App-store install first | Browser install prompt / iOS instructions hidden in Promos | A dedicated install step (optional on Android, install-first for iOS notifications) and a permanent Account row. |
| Home | Offers, categories, restaurants, repeat-order shortcuts | Offers, categories, restaurants, tracking | Menu, cart, tracking, history, promos | Keep the existing five tabs. Add Offers/Notifications/Account inside Promos. |
| Account | Profile, addresses, orders, support, settings | Profile, addresses, orders, support, settings | None | Account sub-tab: identity, install, permission states, notification prefs, clear data. |
| Re-engagement | Push + email + offers | Push + offers | WhatsApp only; customer FCM was just unblocked | Offers + order updates via FCM, mirrored into the in-app Notifications tab. |

### 4.2 What we copy, and what we deliberately do not

Copy:
- Location-first for delivery, not for dine-in.
- One decision per screen; a visible reason before every OS permission dialog.
- "Skip" and back are always available; a denied permission never blocks the core task.
- Phone as the personalisation key: orders, offers, addresses, support.
- A permanent account/settings surface where permission state can be fixed later.
- Contextual permission asks, not a wall of prompts at launch.

Do not copy:
- OTP at this stage. It adds SMS cost and another failure path; WhatsApp already verifies numbers for the bot.
- Mandatory login before browsing. Our QR flow must stay zero-friction.
- App-store install. We use PWA install with an iOS instruction fallback.
- Fake urgency, pre-ticked marketing consent, or permission prompts without context.

### 4.3 Where FoodHubbie is structurally different

- **Table identity already exists.** A QR customer is already attached to a table and session; asking for location or a full account before showing the menu would be a regression.
- **One install per restaurant.** The manifest keeps a separate installed instance per outlet. Identity is global; the subscription and inbox are outlet-scoped.
- **WhatsApp is the primary channel.** App notifications complement WhatsApp; they do not replace it. Every order update can arrive twice, which is why Account needs per-channel preferences.
- **No app store.** Install and notification permission are browser capabilities with different rules on iOS and Android; the flow must branch by capability, not by brand.

---

## 5. Target customer experience

### 5.1 First run (new browser, no profile)

Sequence is capability-driven. The numbered steps below are the default Android/Chromium path.

| Step | Screen | Purpose | Primary action | Secondary | Notes |
|------|--------|---------|----------------|-----------|-------|
| 0 | Existing boot | Restore table session / outlet | — | — | `session.js` already restores `fh_last_table:<outlet>` and rewrites `?t=`. |
| 1 | Welcome 1/3 | Explain the app in one line | `Continue` | `Skip` | Real food photograph from the outlet; no stock illustration. |
| 2 | Welcome 2/3 | Live order tracking | `Continue` | `Skip` | Shows a compact tracking mock built from the real status steps. |
| 3 | Welcome 3/3 | Offers and updates, on your terms | `Continue` | `Skip` | Sets up the notification ask; does not trigger an OS dialog yet. |
| 4 | Identity | Name + mobile | `Continue` | `Skip for now` | No OTP. Copy says "number is your ID", never "verified". |
| 5 | Notifications | Why and what | `Allow notifications` | `Not now` | The OS dialog is triggered only inside this tap. |
| 6 | Install | Add to Home Screen | `Install` | `Not now` | Chromium native prompt; iOS Share instructions. On iOS this step runs **before** notifications. |
| 7 | Location (delivery only) | Delivery fee and address accuracy | `Use my location` | `Enter address instead` | Reuses the existing delivery dialog; skipped entirely on dine-in. |
| 8 | Done | Return to menu | `Start ordering` | — | No extra interstitial; close the overlay. |

Rules for the sequence:
- Show only on a new browser (`fh_onboarded_v1` absent). A stored `fh_customer_phone` from the old flow counts as identity-complete: skip step 4, and mark onboarding complete after migrating it.
- Never start onboarding on `screenInvalid`, `screenDisabled`, `screenSessionExpired`, or while a checkout is in progress.
- A notification deep link (`?screen=notifications` or `?order=`) is remembered; after onboarding, land on that target instead of the menu.
- Back and Skip preserve whatever has already been saved.
- The overlay traps focus, restores focus on close, and respects `prefers-reduced-motion`.
- The overlay must not block the boot error state or the offline banner.

### 5.2 Identity page

Fields:
- Name: 2-60 characters after trim. Allow Latin and Devanagari; do not restrict to English letters.
- Mobile: `+91` prefix, `inputmode="numeric"`, `autocomplete="tel-national"`, max 10 digits; reuse `savePhone` validation (`/^[6-9]\d{9}$/`).
- Consent: "Send me offers and updates" checkbox, **unchecked by default**; small print that order updates are sent when notifications are enabled.
- No password, no OTP, no email.

Behavior:
- Inline validation under each field; no toast-only errors.
- Save to localStorage immediately, then sync the server profile fire-and-forget with one retry. A failed sync must not block the flow.
- If a push token already exists, update its `phone`/`name` after the profile is saved.
- Update the greeting (`UI.updateGreeting`) without a reload.
- If the stored phone differs from the entered phone, treat it as a number switch: update local profile, server app node, and the existing push subscription; never leave the old phone on the token.

### 5.3 Notification permission

- Explain the value in one short list: order ready, rider assigned, occasional offers.
- `Notification.requestPermission()` must run synchronously from the button click. Do not call it on page load.
- Store two preferences separately from the OS permission:
  - `orderUpdates` (default true)
  - `offers` (default follows the identity checkbox, otherwise false)
- If permission is `denied`, show the browser-specific recovery steps and keep "Open settings" guidance; never re-prompt on every visit.
- On iOS, if not standalone, show "Install first" and a link back to the install step. Safari will not grant web push outside an installed PWA.
- If the user later changes permission in browser settings, Account reads `Notification.permission` on render and shows the true state.

### 5.4 Install

- Chromium: use the deferred `beforeinstallprompt` via `promptInstall()`. If unavailable, show a short browser-menu hint rather than a dead button.
- iOS: Share -> Add to Home Screen instructions with the real icons.
- Installed: show "Installed" plus a check, no button.
- Do not show the install card on the Offers pane; it belongs in Account and in the onboarding install step.

### 5.5 Location

- Dine-in: no location ask anywhere.
- Delivery: keep the existing dialogue and fee logic. Onboarding only sequences it after identity; if the user skips, checkout still re-offers it.
- A denied location must fall back to manual address and an estimated fee, as the delivery page already does.
- Never store precise coordinates in the publicly readable profile.

### 5.6 Promotions restructure

Header: `Offers & Account` (or keep `Stay Connected`; final copy in section 9).

Segmented control directly below the topbar:

```
[ Offers ] [ Notifications ] [ Account ]
```

`role="tablist"`, `aria-selected`, left/right arrow keys, Home/End; panes use `role="tabpanel"`.

**Offers pane**
- Existing `promotionsLinksContainer` content (website, reviews, social links).
- Existing promo/discount surfaces that are not identity-related.
- Empty state if the outlet configured no links.
- No install card, no notify card, no permission controls.

**Notifications pane**
- Permission state card:
  - `Not enabled` -> Enable button + value bullets.
  - `Enabled` -> "Notifications are on" + preference toggles (Order updates, Offers).
  - `Blocked` -> recovery steps; no dead Enable button.
  - `Install required` (iOS) -> install-first card.
- Recent alerts list from `pushInbox/{phone}` (newest 20), each with title, body, relative time, and a route:
  - offer -> Offers pane
  - order update -> Tracking for that order
- Empty state: "No alerts yet. Order updates and offers will appear here."
- A small "Why am I seeing this?" note linking to the Account privacy text.

**Account pane**
- Identity card: initial avatar, name, masked phone (`98XXXXXX21`), "Edit" opens the identity form prefilled.
- Install row: status + action.
- Location row (delivery only): status + "Enable" / "Open settings" guidance.
- Notification preferences row: same toggles as Notifications, kept in sync.
- Orders row: "This visit" (existing history) for now; cross-device history is Phase 6.
- "Switch number" and "Clear this device" actions with confirmation. Clear removes local keys; server data stays until a deletion request (or a later delete flow).
- Privacy note: "Your mobile number is your ID in this app. It is not verified. Anyone using this device can see this profile. We never show your number publicly."
- App version / installed state for support.

### 5.7 Returning users

- Onboarding is skipped.
- Promotions opens on Offers by default.
- If a notification deep link requested Notifications, open that pane.
- If the profile name exists, the welcome screen greets the customer by name.
- If the profile exists but notification permission is missing, show one inline card in Notifications; do not reopen onboarding.
- If local profile is missing but the server profile exists, the Identity page can recover the name after the phone is entered. No OTP, by design.

---

## 6. Data model

### 6.1 Local storage

| Key | Value | Notes |
|-----|-------|-------|
| `fh_customer_phone` | `"9876543210"` | Legacy key; keep for compatibility with `pwa-install.js`. |
| `fh_customer_profile` | `{ v:1, name, phone, createdAt, updatedAt, consent:{offers,orderUpdates,version}, lastOutlet, lastBusiness, source }` | New source of truth for UI. |
| `fh_onboarded_v1` | `"1"` | Set only after the user finishes or skips the sequence. |
| `fh_notif_prefs_v1` | `{ orderUpdates:true, offers:false }` | Mirror of server prefs; used before a phone exists. |
| `fh_last_table:<outlet>` | table token | Existing session restore, unchanged. |

Do not store the FCM token in localStorage. It is already the key of the subscription record and is re-derived on demand.

### 6.2 Realtime Database

All paths are outlet-scoped, matching the existing customer data layout.

```
businesses/{bid}/outlets/{oid}/customers/{phone}/app
  v: 1
  name: "Nilesh"
  phone: "9876543210"
  createdAt: 1760000000000
  updatedAt: 1760000000000
  lastOutlet: "pizza"
  lastBusiness: "roshani-pizza"
  source: "qr" | "delivery"
  consent:
    offers: false
    orderUpdates: true
    version: 1

businesses/{bid}/outlets/{oid}/pushSubscriptions/{safeToken}
  token, phone, name, outlet, business, platform, updatedAt
  prefs: { offers: false, orderUpdates: true }

businesses/{bid}/outlets/{oid}/pushInbox/{phone}/{pushId}
  title, body, sentAt, kind: "offer" | "order", campaignId?, orderId?, icon?
```

Constraints:
- `customers/$phone` itself stays admin/rider-write; only the `app` child is customer-writable. The bot's flat fields (`orderCount`, `totalSpent`, `address`, `location`, etc.) must not be overwritten by the app.
- Do not put address, coordinates, order totals or payment data in `app`, `pushSubscriptions` or `pushInbox`.
- The phone key is the access key for `app` and `pushInbox`. This is an accepted trade-off, not authentication.

### 6.3 Rules sketch (to be implemented exactly in `database.rules.json`)

Under `businesses/$businessId/outlets/$outletId/customers/$phone`:

```json
"app": {
  ".read": "true",
  ".write": "(root.child('businesses').child($businessId).child('outlets').child($outletId).child('disabled').val() != true) && (((!data.exists() || data.child('phone').val() == $phone) && newData.exists() && newData.hasChildren(['v','name','phone','createdAt','updatedAt','consent']) && newData.child('v').val() == 1 && newData.child('name').isString() && newData.child('name').val().length >= 2 && newData.child('name').val().length <= 60 && newData.child('phone').val() == $phone && newData.child('phone').val().matches(/^[6-9][0-9]{9}$/) && newData.child('createdAt').isNumber() && newData.child('updatedAt').isNumber() && newData.child('consent').child('offers').isBoolean() && newData.child('consent').child('orderUpdates').isBoolean() && newData.child('consent').child('version').val() == 1 && (!newData.child('lastOutlet').exists() || newData.child('lastOutlet').isString()) && (!newData.child('lastBusiness').exists() || newData.child('lastBusiness').isString())) || (newData.val() == null)) || (auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true || root.child('admins').child(auth.uid).child('outlet').val() == $outletId))"
}
```

Notes:
- A delete (`newData.val() == null`) is allowed with the same phone-keyed access so "Clear my profile" can work later. If this is not wanted, remove that branch and make deletion support-only.
- `createdAt` must be preserved on update; validate `newData.child('createdAt').val() == data.child('createdAt').val()` when `data.exists()` if we want strictness.
- Do not allow a client to change the key's phone to another number.

Extend `pushSubscriptions/$tokenKey`:
- Optional `name`: string, 2-60.
- Optional `prefs`: object with boolean `offers` and `orderUpdates`.
- Keep the existing `token == $tokenKey`, outlet, platform and updatedAt checks.
- Optional `phone` stays 10 digits, now starting 6-9 to match the app validator (currently the rule allows any 10 digits; align it).

Add `pushInbox` under the outlet:

```json
"pushInbox": {
  ".read": "auth != null && (super/supreme/outlet admin)",
  ".indexOn": ["sentAt"],
  "$phone": {
    ".read": "true",
    "$pushId": {
      ".write": "auth != null && (super/supreme/outlet admin)",
      ".validate": "newData.hasChildren(['title','body','sentAt','kind']) && newData.child('title').isString() && newData.child('title').val().length <= 100 && newData.child('body').isString() && newData.child('body').val().length <= 300 && newData.child('sentAt').isNumber() && (newData.child('kind').val() == 'offer' || newData.child('kind').val() == 'order') && (!newData.child('orderId').exists() || newData.child('orderId').isString())"
    }
  }
}
```

The parent `.read` for admins is for support/debug; the child `.read: true` is the phone-keyed customer read. Verify with REST that reading `/pushInbox` as anon is denied while `/pushInbox/9876543210` is allowed.

### 6.4 Threat model and privacy

- **No OTP means the phone is an identifier, not proof of ownership.** Anyone who knows a number can read that number's app profile and notification inbox. Keep those nodes free of sensitive data.
- **Enumeration is possible** by trying numbers. The rules cannot rate-limit. Mitigate with minimal data, short retention, no address/location/order values in public nodes, and monitoring. If abuse appears, move reads behind the bot API with a signed token.
- **Shared devices:** provide Switch number / Clear this device. Do not cache sensitive data beyond the profile.
- **Notification content** can contain an order ID but never a phone, address, OTP or payment detail.
- **Consent:** offers default off; order updates default on only after notification opt-in. A visible toggle in Account is the opt-out.
- **Bot's silent `promotionalConsent: true`** on delivery webview orders must be reviewed. The app should send explicit consent, and the bot should stop defaulting that field for app-originated profiles. Treat as a Phase 4 task.
- **Deletion:** for now, "Clear this device" removes local data. A server deletion request is manual/support-only until a dedicated flow exists.

---

## 7. Notification end-to-end design

### 7.1 Promotional notification (Admin -> customer)

1. Admin opens Promotions > App Notifications.
2. Admin selects audience (`All subscribers` or `Offers opted in` only; order updates are not sent from this form), enters title/body, sees a preview, optionally test mode.
3. Admin JS calls `POST {notifyBase}/tenant-api/notify` with the Firebase ID token and `{ title, body, audience, data }`.
4. `requireTenantAdmin` verifies the admin and resolves `businessId`/`outlet`.
5. Server loads `pushSubscriptions` for the outlet, filters by `audience` and `prefs.offers`, dedupes tokens, and sends a data-only FCM multicast.
6. Server writes one `pushInbox/{phone}/{pushId}` entry per unique phone with `kind:"offer"` and a `sentAt` timestamp. Tokens without a phone are sent but get no inbox entry.
7. FCM service worker shows the OS notification with `tag: push-{campaignId}` and `data.url` pointing to the customer menu with `?o=&b=&screen=notifications`.
8. Tapping the notification focuses an existing same-outlet tab or opens the URL; the app opens Promos > Notifications.
9. The Notifications pane reads `pushInbox/{phone}` by the stored phone and renders the list.

### 7.2 Transactional order notification (bot -> customer)

1. A status transition occurs (Placed, Ready, Delivered, rider assigned).
2. Bot resolves the customer phone:
   - Delivery: `order.phone` / order contact fields.
   - QR dine-in: `tableSessionsContact/{sessionId}.guestPhone` or `customerPhone`.
3. Bot loads the outlet's `pushSubscriptions` and selects tokens whose `phone` matches and whose `prefs.orderUpdates` is not false.
4. Bot sends a data-only FCM with `{ title, body, kind:'order', orderId, screen:'tracking' }` and writes a `pushInbox` entry.
5. SW shows the notification; tap opens Tracking for that order (or the current tracking screen and highlights it).
6. WhatsApp still sends its existing message. No suppression in this pass.

Guardrails:
- Do not send customer FCM for cancelled orders unless the customer needs the cancellation notice.
- Cap to one app push per order status transition; dedupe by `orderId + status` in bot memory.
- Skip if no matching subscription; never fail the order transition because push failed.
- Do not log phone numbers or tokens in bot logs.

### 7.3 Foreground behavior

- `onMessage` in the menu app shows a compact in-app banner (not a second OS notification) with "View" and "Dismiss".
- It also refreshes the Notifications pane if it is open, and increments the bottom-nav badge.
- Data-only messages in the foreground are not displayed by the FCM SDK; the app owns the banner.

### 7.4 Click routing

Define one route contract used by both the service worker and the app:

| Data | Destination |
|------|-------------|
| `screen=notifications` | Promos > Notifications |
| `screen=tracking&orderId=...` | Tracking for that order |
| `screen=offers` | Promos > Offers |
| no route | Menu home |

Use query params on the existing menu origin so the installed instance keeps its `?o=&b=` identity.

### 7.5 Failure handling

- Invalid/expired tokens: remove the subscription record if FCM returns `messaging/registration-token-not-registered` (server has admin access). Log the count, not the token.
- No subscribers: return a clear message; Admin shows "No subscribers yet".
- Permission denied: Notifications pane shows recovery, not a dead button.
- No phone on a subscription: send works, inbox does not; Account prompts the customer to add a number.
- Offline: FCM queues where possible; the inbox read retries on reconnect. The existing connection banner remains.

---

## 8. Implementation map

### 8.1 Menu app

| File | Change |
|------|--------|
| `menu/js/onboarding.js` (new) | Overlay renderer and step machine; local profile get/save/migrate; server sync; permission helpers; Account/Notifications renderers; deep-link handoff. Keep it dependency-free and import only existing menu modules. |
| `menu/js/pwa-install.js` | Add `getNotificationPermission()`, `getNotificationState()`, `subscribeToNotifications({name, prefs})`, `unsubscribeFromNotifications()`, `getCurrentToken()`, `initForegroundMessages(onPayload)`. Keep the existing exports working. Move no install logic. |
| `menu/js/app.js` | Call `maybeStartOnboarding({mode:'dine-in'})` after boot/UI ready; replace `renderPromotionsScreen` with `renderPromotions()` that renders the active pane; update greeting from profile; handle `?screen=` / `?order=` deep links; show foreground banner and nav badge. |
| `menu/js/delivery.js` | Same onboarding hook with `mode:'delivery'`; sequence the existing location dialog after identity; keep the current fee logic untouched. |
| `menu/js/ui.js` | Only if needed for a shared empty-state or badge helper. Reuse existing `showToast`, `showScreen`, `renderHistoryList`; do not add a second component system. |
| `menu/index.html` | Add the three sub-tab buttons and three panes around the existing cards/links; move install, iOS and notify cards into the Account pane. Keep the existing IDs to avoid breaking `app.js` event wiring during the transition. |
| `menu/delivery.html` | Same markup changes. |
| `menu/css/app.css` | `.promo-subtabs`, `.promo-pane`, `.account-*`, `.notif-*`, `.ob-*` styles using existing tokens (`--primary`, `--card`, `--border`, `--text`, `--text-sub`, `--radius`). Flat surfaces, no new gradients, 44px minimum tap targets, visible focus. |
| `menu/firebase-messaging-sw.js` | Use `data.url` when present; default route per kind; `tag` from `campaignId`/`orderId`; icons; do not duplicate notifications for the same campaign. |
| `menu/sw.js` | Bump `CACHE_NAME` to `menu-shell-v22` when any precached menu file changes. |
| `menu/dynamic-manifest.js` | No change. |
| `menu/js/session.js` | Optional: default the checkout name/phone from the profile. Do not change PII paths or the session lifecycle. |
| `menu/js/order.js` | No change in Phase 1. Phase 6 may add a phone-keyed history index; do not put the phone in the public order payload. |

### 8.2 Rules and server

| File | Change |
|------|--------|
| `database.rules.json` | Add `customers/$phone/app`; extend `pushSubscriptions` optional fields; add `pushInbox`; keep all existing gates. JSON must parse before deploy. |
| `bot-control-api/server.js` | `/tenant-api/notify`: audience filter, menu-origin link, inbox fan-out, invalid-token cleanup, input length caps. Add `MENU_WEB_ORIGIN` env with a safe default. |
| `bot/index.js` | Add customer order-status FCM + inbox writes; resolve phone from order/session; dedupe per order/status; never block the order path. |
| `bot/firebase.js` | Only if a helper is needed for outlet-scoped reads; reuse existing `resolvePath`/`getData`. |
| `Admin/js/features/promotions.js` | Read subscriber and offer-consent counts; send `audience`; show preview and result; keep test mode. |
| `Admin/index.html` | Audience select, character counters, preview block, subscriber/offer counts. |
| `SupremeAdmin` | No change. |
| `Admin/sw.js` | No change unless the Admin notification payload shape changes. It does not own customer notifications. |

### 8.3 Shared

| File | Change |
|------|--------|
| `shared/config/vapid.js` | No change; already used by menu and Admin. |
| `menu/shared/config/vapid.js` | Keep the deliberate copy in sync if the shared file changes. |
| `tools/build.mjs` | No change for menu (served directly). Admin would need `node tools/build.mjs` only if Admin files change. |
| `tests/customer-profile.check.mjs` (new) | Pure assertions for name/phone/consent normalization and local-key migration. One runnable check, no framework. |
| `tests/customer-onboarding.*` | Optional Playwright script for UI states; not a dependency. |

---

## 9. Copy deck (draft)

Use food-specific, literal copy. No fake urgency, no "unlock", no exclamation stacks.

**Welcome 1/3**
- Title: `Your table, your menu`
- Body: `Order from your phone, add notes for the kitchen, and keep the whole table on one bill.`
- CTA: `Continue`

**Welcome 2/3**
- Title: `Know exactly when it is coming`
- Body: `Follow every order from the kitchen to your table. No guessing, no waiting for someone to check.`
- CTA: `Continue`

**Welcome 3/3**
- Title: `Offers, only if you want them`
- Body: `Turn on notifications for order updates and the occasional offer. You can change this any time.`
- CTA: `Continue`

**Identity**
- Title: `What should we call you?`
- Body: `Your mobile number is your ID in the app. No password and no OTP.`
- Labels: `Name`, `Mobile number`
- Consent: `Send me offers and updates`
- CTA: `Continue`
- Secondary: `Skip for now`
- Fine print: `We use your number to show your profile and order updates on this device. It is not verified.`

**Notifications**
- Title: `Stay in the loop`
- Body: `We will only send what you choose.`
- Rows: `Order updates` / `Offers and new menu items`
- CTA: `Allow notifications`
- Secondary: `Not now`
- Denied: `Notifications are blocked in this browser. Open the site settings to allow them.`

**Install**
- Chromium title: `Add FoodHubbie to your home screen`
- Chromium body: `Open your table menu in one tap. It uses less data than the browser tab.`
- iOS title: `Add to Home Screen`
- iOS body: `Tap Share, then Add to Home Screen. Notifications on iPhone need this step first.`

**Location**
- Title: `Where should we deliver?`
- Body: `We use your location to calculate the delivery fee and send the rider to the right place.`
- CTA: `Use my location`
- Secondary: `Enter address instead`
- Denied: `Location is off. You can still enter your address manually.`

**Account**
- Identity: `Your details`
- Install: `App`
- Location: `Delivery location`
- Notifications: `Alerts`
- Privacy: `Your number is your ID in this app. It is not verified. We never show it publicly.`

**Notifications pane**
- Empty: `No alerts yet. Order updates and offers will appear here.`
- Offer row: title + body + `View offer`
- Order row: title + body + `Track order`

---

## 10. Phases and acceptance criteria

### Phase 1 — Identity foundation
- Local profile module with migration from `fh_customer_phone`; name/phone/consent validation; server sync.
- `customers/{phone}/app` rules + REST verification.
- Admin customer list still works; optionally shows `app.name` as a fallback.
- Acceptance: reload keeps profile; invalid phone/name rejected; anon can read/write only the exact phone's `app`; parent read denied; bot fields cannot be overwritten by the app; `node --check` and the profile check pass.

### Phase 2 — Onboarding and permissions
- Overlay step machine, focus trap, skip/back, reduced motion.
- Identity, notifications, install and delivery-location steps.
- Foreground permission state; iOS install-first branch.
- Acceptance: fresh browser shows once; reload does not; skip works; notification dialog only on tap; denied state renders recovery; dine-in never asks location; delivery reuses the existing dialog; no console errors.

### Phase 3 — Promotions sub-tabs and Account
- Three panes with accessible tabs; old cards moved into Account; old links remain in Offers.
- Account shows identity, install, location, notification prefs, clear/switch.
- Acceptance: keyboard and screen-reader behavior; Offers links unchanged; Account state matches actual permission/install state; bottom nav still works; deep links open the right pane.

### Phase 4 — Notification pipeline
- `/tenant-api/notify` audience filter, menu link, inbox, token cleanup.
- Admin audience UI and counts.
- Foreground `onMessage` banner + badge.
- SW deep links.
- Acceptance: an Admin test to a real device arrives; an offer-only send skips non-consenting subscribers; inbox entry appears; click lands in the right pane; invalid token is removed; cross-outlet send denied.

### Phase 5 — Transactional order push
- Bot sends customer FCM on Placed/Ready/Delivered/rider assigned with dedupe.
- Inbox entries with `kind:"order"`.
- Acceptance: one push per transition; no push when no subscription; order flow unaffected by push failure; WhatsApp behavior unchanged.

### Phase 6 — Cross-device history (optional, later)
- Phone-keyed order index; decide delivery-order visibility.
- Acceptance: sign in with phone on a new browser and see past QR orders; no PII exposure in public order nodes.

---

## 11. Test plan

### Static
- `node --check` on every changed menu JS file and `bot-control-api/server.js`.
- JSON parse `database.rules.json`.
- `node tests/customer-profile.check.mjs` (new).
- Build only if Admin/Supreme files change: `node tools/build.mjs`.

### Rules (live REST, `.json` suffix required)
- Anon creates a valid `customers/{phone}/app` -> 200.
- Invalid phone, name too short/long, missing consent, wrong key -> 401.
- Anon reads exact phone `app` -> 200; reads `customers` parent -> 401.
- Anon cannot write `pushSubscriptions` for another outlet -> 401.
- Anon writes optional `name`/`prefs` -> 200; invalid prefs type -> 401.
- Anon reads exact phone `pushInbox` -> 200; anon writes `pushInbox` -> 401; parent read -> 401.
- Clean up every test node; never touch a real phone key (use a reserved test number and delete it).

### Playwright (local/live)
- Fresh context (no storage) -> onboarding appears once.
- Skip -> no onboarding after reload.
- Identity validation -> error under the field, profile saved after valid submit.
- Notifications -> mocked permission granted/denied; UI state changes.
- iOS user-agent -> install-before-notifications branch.
- Delivery mode -> location step present; dine-in -> absent.
- Tabs -> keyboard arrows and `aria-selected`; deep link `?screen=notifications`.
- No live orders or payments; stub network writes where possible.

### Real devices
- Android Chrome: install, notification opt-in, background notification, click deep link, permission revoke/recover.
- iPhone Safari: Add to Home Screen, install-gated notification prompt, notification click.
- Shared device: switch number, clear device, re-enter phone.
- Multi-outlet install: notification from outlet A opens A even if B was last visited.

### Admin
- Send test to own device (test mode) and to a real customer device (non-test).
- Offer-only audience excludes a customer with offers off.
- Counts match `pushSubscriptions` and `pushInbox`.
- Cross-outlet admin blocked.

---

## 12. Deploy and rollback

Order:
1. Rules (`firebase deploy --only database`) after REST tests pass on a staging/test path.
2. Menu hosting (`firebase deploy --only hosting:menu`) with SW bump.
3. `bot-control-api` on EC2 (restart the service) for the notify/inbox changes.
4. `bot` on EC2 for transactional customer push.
5. Admin build + `hosting:admin` for the audience UI.
6. Live smoke test, then update `PROGRESS-CUSTOMER-APP-ONBOARDING.md` and `PROJECT_LEDGER.md`.

Rollback:
- Hosting: redeploy the previous menu build (or revert the commit); the SW cache name changes on the next release.
- Rules: revert `database.rules.json` and redeploy. New nodes are additive; old clients keep working.
- Server/bot: redeploy the previous commit and restart PM2; promo/order paths must not depend on the new inbox for delivery.

Verification gates before calling it done:
- 0 console errors on menu and delivery.
- Rules tests all pass and test nodes are gone.
- A real device receives one promo and one order update; click opens the right screen.
- Admin cross-outlet test returns 401.
- Billing/order totals untouched (no changes in this plan).

---

## 13. Out of scope / later

- OTP or Firebase Auth for customers.
- Wallet, loyalty points, referrals.
- Saved addresses book (delivery currently uses one address per order).
- Cross-device order history (Phase 6).
- In-app chat/support.
- Rich notification actions (Accept/Decline) and quiet hours.
- Per-restaurant identity (identity stays global; subscription/inbox stay outlet-scoped).
- Camera QR scanning inside the app.
- Native app wrappers.

---

## 14. Open questions

1. Do we want `Notifications` as a first-class bottom-nav tab someday, or keep it inside Promos? Recommendation: keep it inside Promos for this pass; revisit if the inbox becomes daily-use.
2. Should the identity page be required before checkout for delivery, where the name/phone are already needed? Recommendation: prefill from the profile but do not block; the checkout form remains the source of truth for that order.
3. Should "offers" consent live on the identity page or only in Notifications? Recommendation: identity checkbox (explicit) mirrored in Notifications; default off.
4. Do we keep the WhatsApp promotional consent behavior as-is? Recommendation: review the bot's silent `promotionalConsent: true`; the app must not imply consent it did not collect.
5. Is a server-side inbox worth the fan-out? Recommendation: yes for a credible Notifications tab; cap at 20-50 entries per phone and prune on write.

---

## 15. Definition of done

- A new customer on Android can: open the QR link, see onboarding, enter name + phone, allow notifications, install the app, order, receive a promo, see it in Notifications, tap it, and land on the right screen.
- The same customer on iPhone can do the same after Add to Home Screen, with notifications gated on install.
- A returning customer never sees onboarding again and can fix a denied permission from Account.
- A dine-in customer can skip everything and still order.
- An admin can send only to offer-consenting subscribers of their own outlet, and see the subscriber count.
- No phone, address, token or order value is exposed on a publicly readable path beyond the accepted phone-keyed profile/inbox.
- Every changed file passes the checks in section 11, and the progress tracker reflects the evidence.
