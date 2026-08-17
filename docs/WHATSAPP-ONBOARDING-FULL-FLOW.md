# Restaurant Onboarding → Official WhatsApp Business API — Complete Flow (Explained)

How a brand-new restaurant goes from "fill a form in Supreme Admin" to "taking WhatsApp orders on the **official** Meta WhatsApp Business API" — every step, every click, every piece of data written, every server call, and what must exist on the Meta side for it to work. This version explains the *why* behind every step, not just the what.

Written 2026-08-17, after the Meta App Dashboard was configured and `META_CONFIG_ID = 1624840945941910` was set and deployed. Supersedes the older `FINAL-END-TO-END-FLOW.md` for the WhatsApp parts.

---

## Table of contents
- [0. Core concepts you need before anything makes sense](#0-core-concepts-you-need-before-anything-makes-sense)
- [1. The architecture — every moving part](#1-the-architecture--every-moving-part)
- [2. Meta-side prerequisites (done once, by the platform owner)](#2-meta-side-prerequisites-done-once-by-the-platform-owner)
- [3. Restaurant onboarding — step by step](#3-restaurant-onboarding--step-by-step)
  - [Step 1 — Add Restaurant form](#step-1--add-restaurant-form)
  - [Step 2 — The Embedded Signup popup (Path A)](#step-2--the-embedded-signup-popup-path-a)
  - [Step 3 — Server-side code exchange](#step-3--server-side-code-exchange)
  - [Step 4 — The shared success write](#step-4--the-shared-success-write)
  - [Step 5 — The bot worker comes online](#step-5--the-bot-worker-comes-online)
- [4. Path B — the platform-managed number wizard](#4-path-b--the-platform-managed-number-wizard)
- [5. Webhooks — inbound message routing](#5-webhooks--inbound-message-routing)
- [6. Phone numbers — the full lifecycle](#6-phone-numbers--the-full-lifecycle)
- [7. Sending messages — the Cloud API send path](#7-sending-messages--the-cloud-api-send-path)
- [8. Message templates — proactive / out-of-window sends](#8-message-templates--proactive--out-of-window-sends)
- [9. Payments & money](#9-payments--money)
- [10. The complete checklist](#10-the-complete-checklist)
- [11. Data model recap](#11-data-model-recap)
- [12. Troubleshooting quick reference](#12-troubleshooting-quick-reference)

---

## 0. Core concepts you need before anything makes sense

Meta's WhatsApp ecosystem has a specific vocabulary. Every term below maps to a real object in the Graph API, and the whole onboarding flow is really just: *create these objects, link them together, and point our servers at them.*

### 0.1 The objects

| Term | What it is | Analogy | Graph API access |
|---|---|---|---|
| **Meta App** | The application registered at developers.facebook.com. It is the *credential set* our platform uses to call Graph API on behalf of anyone who grants us permission. | A keycard + permission badge | `{app-id}` in every API call |
| **Business portfolio** (Business Manager) | The umbrella entity that owns the WABA, the ad accounts, the app, etc. | The company HQ | `{business-id}` |
| **WABA** (WhatsApp Business Account) | The container that holds WhatsApp phone numbers and message templates for one business. It is *not* a phone number. | A company's phone line rack | `{waba-id}` |
| **Phone Number** | An actual number (e.g. `+1 555 661 9086`) that is registered on the Cloud API. It has its own **Phone Number ID** (`1211796118690392`). | A single phone line | `{phone-number-id}` |
| **User Access Token** | A short-lived token that lets *one Facebook user's* granted permissions be used. Produced by the Embedded Signup oauth flow. | A borrowed badge | returned by oauth exchange |
| **System User Token** | A long-lived token owned by the *platform's* business portfolio, not by any person. It can act across every WABA/number the portfolio can reach. | A permanent company badge | set as `META_SYSTEM_USER_TOKEN` |
| **Config ID** | A Facebook Login for Business *configuration* — a reusable bundle of { login variation + token type + permissions } that an app can launch an Embedded Signup popup with. | A pre-saved consent form | `1624840945941910` |

### 0.2 Two OAuth realities

**Path A (Embedded Signup)** is an **OAuth flow on the restaurant owner's behalf**. The owner is the one who logs into Facebook inside our popup. The security rule that makes this possible: **the authorization *code* is exchanged for tokens only on our server**, using the app secret. If we exchanged tokens in the browser, the app secret would be exposed — which is why `whatsapp-linking.js` POSTs the code to the Bot Control API and never touches tokens itself.

**Path B (platform-managed)** is **not an OAuth flow at all**. The platform uses its own long-lived system-user token. It can only reach numbers inside WABAs that its portfolio owns or has been granted access to. That's why it's "least taps" — no popup, just direct Graph calls.

### 0.3 Why there are two paths

A pizza shop that already runs WhatsApp on a personal number doesn't want a Meta account and a business verification process. That shop should use **Baileys (QR)** or **Path B** (platform-provided number). A serious restaurant brand that wants a *verified business name, template messaging, and scale* wants its own WABA + number → **Path A**. The product supports all three; the sections below explain when each is the right choice.

---

## 1. The architecture — every moving part

```
SUPREME ADMIN (browser, Firebase Hosting: supreme)
  foodhubbie-supremeadmin.web.app
    ├─ /restaurants/onboard        → Add Restaurant form (restaurant-onboarding.js)
    ├─ /profile/{bid}/{oid}        → Restaurant Profile (restaurant-profile.js)
    │    └─ WhatsApp section        → whatsapp-manage.js (Path A / Path B wizard)
    │    └─ WhatsApp templates card → install library templates on the WABA
    │    └─ Quota card              → messaging limit tier + today's sends
    └─ whatsapp-linking.js          → FB JS SDK → Meta Embedded Signup popup
            │
            │  HTTPS via Cloudflare Quick Tunnel (TUNNEL_URL)
            ▼
BOT CONTROL API (EC2, port 4000) — bot-control-api/server.js
    /api/bot/*            → PM2 process control (provision/restart/stop/delete/transport)
    /api/whatsapp/accounts|numbers|templates|quota
    /api/whatsapp/exchange → Path A: oauth code → tokens → WABA → number
    whatsapp-graph.js      → thin Graph API wrapper (META_SYSTEM_USER_TOKEN)
    status-watcher.js      → PM2 event bus → writes botStatus to Firebase (real-time)

WEBHOOK SERVER (EC2, port 5000) — webhook-server/index.js
    GET/POST /webhook      → Meta pushes inbound messages + status updates here
    proxies /api/* → :4000 (same tunnel, path-based ingress)

BOT WORKER (EC2, PM2, one per outlet) — bot/index.js + transport.js + whatsapp-send.js
    'meta' transport: subscribes Redis bot-inbox:{bid}:{oid}; sends via Graph API
    'baileys' transport: WhatsApp Web QR (non-official, legacy)

FIREBASE RTDB (foodhubbie-10)
    businesses/{bid}/outlets/{oid}/whatsapp   → { phoneNumberId, wabaId, status, ... }
    businesses/{bid}/outlets/{oid}/bot        → { transport, phoneNumberId, healthPort }
    phoneNumberIndex/{phoneNumberId}          → { businessId, outletId }   (webhook routing)
    businesses/{bid}/outlets/{oid}/whatsapp/usage/{IST-date} → daily send counter
```

### Why this split exists

- **Supreme Admin is static hosting.** It cannot hold secrets, so every secret-bearing operation lives on the EC2 box behind the Bot Control API.
- **The Bot Control API owns PM2.** The browser is never allowed to SSH or touch PM2 directly; it asks this API to restart/provision/stop workers.
- **The webhook server owns inbound messages.** Meta requires a *single public HTTPS endpoint* for webhooks. Because Cloudflare Quick Tunnel routes one domain to one local port, the webhook server (port 5000) both handles `/webhook` *and* proxies `/api/*` to the Bot Control API (port 4000).
- **Redis is the message bus.** The webhook server publishes to `bot-inbox:{bid}:{oid}`; the bot worker for that outlet subscribes to that exact channel. This decouples "message arrived" from "which process is listening."

---

## 2. Meta-side prerequisites (done once, by the platform owner)

These are configured in the **Meta App Dashboard** (developers.facebook.com). They must exist before any restaurant can connect the official API. This section is exactly what we clicked through to make Path A work.

### 2.1 The Meta App
- **App**: Foodhubbie — **App ID** `1894358871543574`
- **Use case**: WhatsApp → **Connect on WhatsApp**
- **Business portfolio**: Foodhubbie — **Business ID** `1544720177433286`
- In code: `META_APP_ID` at `SupremeAdmin/js/features/whatsapp-linking.js:17`.

The App ID is the *public* identifier the Facebook JS SDK and the Graph API oauth endpoint use. It is safe to embed in the browser (it's in every page of the dashboard). The **App Secret** is the *private* half — it never leaves the server.

### 2.2 The Embedded Signup configuration (the Config ID)

Created at `developers.facebook.com/apps/1894358871543574/create-login-configuration/`. A Facebook Login for Business configuration bundles three decisions into one reusable ID:

| Setting | Value chosen | Why this value |
|---|---|---|
| **Configuration ID** | `1624840945941910` | generated by Meta at creation |
| Name | "Foodhubbie WhatsApp Config" | internal label only |
| Login variation | **General** | the standard Facebook Login for Business experience (the other option is a simplified experience meant for specific use cases) |
| Access token | **User access token** | restaurant owners connect with their *personal* Facebook account, so each grant is a user-level grant; system-user tokens are only for the platform's own continuous access |
| Permissions | `whatsapp_business_management`, `whatsapp_business_messaging`, `whatsapp_business_manage_events`, `business_management`, `manage_app_solution`, `email` | the owner must grant our app the right to read/manage their WhatsApp assets, read the business they manage, and know their email |

**Permission meanings** (these are the scopes the popup asks the owner to approve):
- `whatsapp_business_management` — read/manage the owner's WABAs, numbers, templates, QR codes, webhook subscriptions. **This is the core scope for Embedded Signup.**
- `whatsapp_business_messaging` — send messages, upload/retrieve media, manage profile, register numbers.
- `whatsapp_business_manage_events` — log conversion events (purchase, add-to-cart…).
- `business_management` — read/write Business Manager API objects.
- `manage_app_solution` — list apps a user can manage (needed when the owner already has apps).
- `email` — read the owner's primary email.

> Meta auto-selects permission *dependencies*. Picking `whatsapp_business_management` pulls in `whatsapp_business_messaging`; the UI showed 6 options selected total when we saved.

Stored in code: `META_CONFIG_ID = '1624840945941910'` at `whatsapp-linking.js:18`. This is what `FB.login({ config_id })` uses to launch the popup.

**Deep navigation to create it (recorded from what we did):**
1. developers.facebook.com → **My Apps** → **Foodhubbie**
2. Left sidebar → **Facebook Login for Business** → **Configurations** (URL: `/apps/1894358871543574/business-login/configurations/`)
3. **Create configuration** → type a name (≤30 chars) → **Next**
4. Login variation: **General** → **Next**
5. Access token: **User access token** → **Next**
6. Permissions: select `whatsapp_business_management` and whatever Meta auto-selects → **Create**
7. Copy the **Configuration ID** from the "has been successfully created" dialog.

### 2.3 A WhatsApp Business Account (WABA) + a phone number

The platform currently holds one **test** setup:
- **WABA ID** `2589174454849821` ("Test WhatsApp Business Account") — in `ecosystem-bot-control.config.js` as `WABA_ID` (fallback when the token can't enumerate).
- **Test number** `+1 555 661 9086` → **Phone Number ID** `1211796118690392` (Meta's free 90-day test number, usable without business verification).

In production each restaurant brings (Path A) or the platform assigns (Path B) a **real** number inside a WABA — see §6 for what that requires.

### 2.4 Server secrets (injected on EC2 only, never in the repo)

| Env var | Where used | Purpose |
|---|---|---|
| `META_APP_ID` | `server.js` `/api/whatsapp/exchange` | oauth `client_id` |
| `META_APP_SECRET` | `server.js` `/api/whatsapp/exchange` | oauth `client_secret` — **Path A cannot complete without it** |
| `META_SYSTEM_USER_TOKEN` | `whatsapp-graph.js` (all Path B calls, quota, templates) | the platform's long-lived token |
| `WA_VERIFY_TOKEN` | `webhook-server/index.js` | webhook verify challenge |
| `WA_PERMANENT_TOKEN` | `bot/index.js:960` | the token the *bot worker* uses to send messages on the Cloud API |
| `WABA_ID` / `WABA_NAME` | `whatsapp-graph.js` | fallback WABA when enumeration fails |
| `REDIS_URL` | webhook-server + bot transport | message bus connection |

Note `META_SYSTEM_USER_TOKEN` (control-plane calls from the API) and `WA_PERMANENT_TOKEN` (data-plane sends from the bot) are conceptually the same kind of token used in two different places — both are platform-owned system-user tokens with `whatsapp_business_management` + `whatsapp_business_messaging` scopes.

### 2.5 Meta-side state (audited 2026-08-17 via live Graph API)

| Item | State | Notes |
|---|---|---|
| System user `foodhubbiebot` token | Working | `whatsapp_business_management` + `whatsapp_business_messaging` both **granted** |
| WABA `2589174454849821` | `account_review_status: APPROVED` | but it's Meta's **test** WABA — holds exactly one test number |
| Test number `+1 555 661 9086` (`1211796118690392`) | `CONNECTED`, quality GREEN | `code_verification_status: NOT_VERIFIED` (cosmetic for test numbers) |
| App `Foodhubbie` | **Unpublished** | embedded signup works only for app-role accounts; webhooks deliver only test events |

The two real gates to production, and their fixes:
- **Real numbers need a real WABA.** Test WABAs reject a second number with `#3 Application does not have the capability` — not a permissions bug. Fix: create a real WABA under a verified Meta Business and register the real number (§6.1).
- **App publish** requires business verification + App Review. Until then, Path A embedded signup only works for users with a role on the app.

---

## 3. Restaurant onboarding — step by step

### Step 1 — Add Restaurant form

**Deep navigation:** login to https://foodhubbie-supremeadmin.web.app → left nav **Restaurants** → **Add Restaurant** (also reachable from the Restaurants list header and the analytics dashboard). Route: `/restaurants/onboard`.

**The form** (`SupremeAdmin/js/features/restaurant-onboarding.js`):

| Form field | Written to | Notes |
|---|---|---|
| Business name | `businesses/{bid}/name` | required |
| Outlet name | `businesses/{bid}/outlets/{oid}/name` | required |
| Contact phone | `businesses/{bid}/contactPhone` + `outlets/{oid}/contactPhone` | required |
| Contact email | `businesses/{bid}/contactEmail` | optional |
| Start from a template | `outlets/{oid}` + the template's `defaults` | picks a starter catalog (dishes/categories/tables) |
| Plan / tier | `businesses/{bid}/plan` | `starter`/`growth`/`enterprise` — **label only, no billing teeth yet** (§9) |
| WhatsApp connection | decides the post-submit branch | **WhatsApp Web (QR)** vs **Official API (Meta)** |

`{bid}` and `{oid}` are **Firebase push keys** (auto-generated IDs like `-Oxxxxxxxxxxxx`), not human-readable slugs. Every later reference to this restaurant uses these two keys.

**The write — one atomic multi-path update.** Two separate `.set()` calls would risk an orphaned business record (business written, outlet write fails → no rollback). A single `db.ref().update({...})` guarantees both land together or neither does:

```
businesses/{bid}                      = { name, contactPhone, contactEmail, plan, createdAt }
businesses/{bid}/outlets/{oid}        = { name, contactPhone, createdAt, whatsapp:{status:'pending'}, ...templateDefaults }
```

`whatsapp.status:'pending'` is the initial state — the dashboard's restaurant list shows a grey "Pending" dot, and the WhatsApp wizard knows nothing is linked yet.

**After the write, the form branches:**

- **QR path** → immediately `POST /api/bot/provision/{bid}/{oid}` (starts the PM2 worker on EC2, idempotent) → navigate to `profile/{bid}/{oid}`, where the "Scan WhatsApp Web QR" flow continues.
- **Meta path** → `launchWhatsAppSignup(bid, oid)` → **the Embedded Signup popup opens** → on success navigates to the profile.

The template dropdown is populated live from `appTemplates/{key}` (seeded by `tools/seed-templates.cjs`); only templates carrying a `defaults` object are pickable on onboarding (the WhatsApp *message template* library is a different shape used later by the profile card and must not appear here).

---

### Step 2 — The Embedded Signup popup (Path A)

**What the owner sees:** a Meta-hosted modal (rendered by the Facebook JS SDK) that asks them to log in with their Facebook account, review the permission list from §2.2, and either pick an existing WhatsApp Business number or let Meta create a WABA + number for them on the spot.

**What happens under the hood** (`whatsapp-linking.js`):

1. `loadFacebookSdk()` injects `<script src="https://connect.facebook.net/en_US/sdk.js">` into the page (once, shared promise — no double-inject). It defines `window.fbAsyncInit` which calls `FB.init({ appId: META_APP_ID, cookie: true, xfbml: false, version: 'v20.0' })`.
2. `window.FB.login(callback, {
      config_id: '1624840945941910',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: '', sessionInfoVersion: '3' }
    })`.
3. Meta runs the Embedded Signup flow in the popup. If the owner has no WABA, the popup's "create" path provisions one automatically.
4. On success the callback receives `response.authResponse.code` — an **authorization code**. Crucially, *this is not a token*. It is a single-use, short-lived string that the **server** will swap for real tokens. The browser never sees an access token, and never sees the app secret.

> `override_default_response_type: true` + `response_type: 'code'` forces the code-only response (not an implicit token), because our `handleFbResponse` is wired to POST `response.authResponse.code` to the server.

**Cancellation handling:** if the owner closes the popup or denies, `response.status` is `'not_authorized'` or `'unknown'`, and the dashboard shows "WhatsApp connection was cancelled or did not complete."

---

### Step 3 — Server-side code exchange (`POST /api/whatsapp/exchange`)

`whatsapp-linking.js` POSTs `{ bid, oid, code }` to `TUNNEL_URL/api/whatsapp/exchange` with the Firebase ID token in `Authorization: Bearer`. The `requireSuperOnly` middleware rejects non-admin callers with 403.

`bot-control-api/server.js:549` then performs the exchange **entirely server-side** — this is the security boundary that keeps the app secret private:

**Call 1 — swap the code for a user token**
```
GET graph.facebook.com/v20.0/oauth/access_token
    ?client_id={META_APP_ID}
    &client_secret={META_APP_SECRET}
    &code={code}
→ { access_token: <userToken> }
```
The code is single-use; reusing it fails. The `client_secret` is our app's private key — this is why the exchange *cannot* happen in the browser.

**Call 2 — inspect the token to find the owner's business**
```
GET graph.facebook.com/v20.0/debug_token
    ?input_token={userToken}
    &access_token={appId}|{appSecret}
→ { data: { granular_scopes: [ { scope: 'whatsapp_business_management', target_id: <businessId> } ], business_id: ... } }
```
`debug_token` tells us which business the owner granted `whatsapp_business_management` for. We prefer the granular scope's `target_id`, falling back to `business_id`.

**Call 3 — find the owner's WABA**
```
GET graph.facebook.com/v20.0/{businessId}/owned_whatsapp_business_accounts?fields=id,name
   (Authorization: Bearer {userToken})
→ { data: [ { id: <wabaId>, name: ... } ] }
```
We take `data[0]` — the owner's first WABA.

**Call 4 — find a number on it**
```
GET graph.facebook.com/v20.0/{wabaId}/phone_numbers?fields=id,display_phone_number,verified_name
   (Authorization: Bearer {userToken})
→ { data: [ { id: <phoneNumberId>, display_phone_number: '+...', verified_name: '...' } ] }
```
We take `data[0]`.

If any hop fails or there's no WABA/number, the route throws `No WABA / phone number found for this Meta account` → 500, and the dashboard toast says "Connected to Meta, but saving the WhatsApp link failed — check the Bot Control API logs."

On success it calls `waLinkSuccess(bid, oid, { phoneNumberId, wabaId, displayPhoneNumber, verifiedName })` — the same shared write both paths converge on (Step 4).

> ⚠️ If `META_APP_SECRET` (or `META_APP_ID`) is not set on EC2, the route returns **501** "META_APP_ID / META_APP_SECRET not configured" — a deliberate "honest not-wired-up" response rather than a misleading crash.

---

### Step 4 — The shared success write (`waLinkSuccess`)

`server.js:390`. Both Path A and Path B land here. This single function makes a number "live" — it writes every record the rest of the stack reads:

| Write | Path | Why |
|---|---|---|
| `outlets/{oid}/whatsapp` = `{ phoneNumberId, wabaId, displayPhoneNumber, verifiedName, status:'active', connectedAt }` | the main record | dashboard UI, quota card, and the manage view all read this |
| `phoneNumberIndex/{phoneNumberId}` = `{ businessId, outletId }` | root index | **webhook routing**: inbound messages find the right outlet by number |
| `outlets/{oid}/bot` update `{ transport:'meta', phoneNumberId }` | bot config | tells the bot worker which transport + which number to use |
| `POST {wabaId}/subscribed_apps` | Graph API call | subscribes our app's webhooks to this WABA so Meta delivers inbound messages to our endpoint |

`phoneNumberIndex` deserves special attention — it is the reverse lookup that makes multi-tenancy work. Meta's webhook payload identifies the sender by `metadata.phone_number_id`, *not* by our business/outlet keys. Without this index we'd have no idea which restaurant a message belongs to. The webhook server (`webhook-server/index.js:68`) does exactly this lookup on every inbound message.

---

### Step 5 — The bot worker comes online

After `transport:'meta'` is written, the orchestrator watcher on the EC2 box notices the change and restarts the PM2 process `bot-{bid}-{oid}` (the worker was originally started by `provision` — the QR path does this at onboarding; the Meta path relies on the watcher). The status watcher (`bot-control-api/status-watcher.js`) listens to PM2's event bus and writes `outlets/{oid}/botStatus` to Firebase on every state change, so the dashboard's Fleet/Profile pages reflect it in real time without polling. The toast the admin saw — "The bot worker should come online within ~5s" — is backed by this chain.

**The bot worker boot** (`bot/index.js:935`):
1. Reads the live store name from Firebase (`settings/Store`) so greetings use the right name.
2. Reads `transport` mode from `bot/transport` (or env `BOT_TRANSPORT`).
3. If `'meta'`: resolves `phoneNumberId` via `bot/phoneNumberId` → else reverse-lookups `phoneNumberIndex` → else env `PHONE_NUMBER_ID`. Creates the meta transport with `accessToken = process.env.WA_PERMANENT_TOKEN` and the Redis URL.
4. Emits `connection.update: { connection: 'open' }` on start → triggers `initFCMWatcher()` and logs "BOT IS ONLINE".
5. On `connection: 'close'` → exponential backoff reconnect (5s → 15s → 45s → capped 120s).

**The meta transport** (`bot/transport.js:43`) is deliberately shaped like a Baileys `sock` so the entire conversation engine in `bot/index.js` works unchanged — that's the cleverness that let the team add official API support without rewriting the bot:
- `ev.on('messages.upsert', cb)` — receives Redis messages.
- `sendMessage(jid, content)` — delegates to `whatsapp-send.js` Graph calls.
- `sendButton(jid, opts)` — interactive CTA URL button, falls back to plain text if Meta rejects.
- `sendTemplate(jid, opts)` — approved-template send.
- `readMessages()` / `sendPresenceUpdate()` — no-ops (Meta has no read receipts / typing indicators).
- `start()` — subscribes to Redis `bot-inbox:{bid}:{oid}`, shapes each inbound message into a Baileys-style upsert, fires `messages.upsert` into the engine.

**Receive path detail:** the Redis subscriber only forwards text (`msg.text.body`) and location messages (`msg.type === 'location'`); images/other types are dropped because the Cloud API sends media as URLs and the existing bot logic expects either text or a location object.

---

## 4. Path B — the platform-managed number wizard (no Meta popup)

Used when the **platform** holds the number (its own WABA / a test number) rather than the restaurant's own account. Rendered by `whatsapp-manage.js` inside the profile's WhatsApp section.

**Deep navigation:** profile → **WhatsApp** section → **Official WhatsApp number** card → **Connect a number**.

This is a 3-step wizard; every call goes to the Bot Control API with the Firebase ID token:

| Step | Button | Endpoint | Data sent | Data received |
|---|---|---|---|---|
| 1 | **Connect a number** | `GET /api/whatsapp/accounts/{bid}/{oid}` | — | `{ wabas: [{ id, name }] }` (enumerated via system-user token) |
| 1 | pick a WABA → **Next** | (in-memory) | — | — |
| 2 | **Use this number** | `GET /api/whatsapp/numbers/{bid}/{oid}` | — | `{ wabaId, numbers: [{ id, display_phone_number, verified_name, quality_rating, messaging_limit_tier, code_verification_status }] }` |
| 2b | **Add a new number** (form) | `POST /api/whatsapp/numbers/{bid}/{oid}` | `{ verified_name, display_phone_number, wabaId }` | `{ wabaId, phoneNumberId }` |
| 3 | **Send SMS code** / **Send voice code** | `POST .../{phoneNumberId}/request-code` | `{ method: 'sms'\|'voice' }` | `{ ok }` |
| 3 | enter 6-digit code → **Verify** | `POST .../{phoneNumberId}/verify-code` | `{ code }` | `{ ok }` |
| 3 | (automatic) | `POST .../{phoneNumberId}/register` | `{ pin, wabaId }` (pin is a client-generated 6-digit number) | `{ phoneNumberId, wabaId, ... }` |

The **register** step maps to Graph `POST {phoneNumberId}/register { messaging_product:'whatsapp', pin }`, which registers the number with the Cloud API and sets its 2FA pin (mandatory; if the pin is lost the number must be deregistered/re-registered). Then the same `waLinkSuccess()` runs, so both paths produce identical state.

**Deregister** (`POST .../deregister`, confirm dialog) → Graph `POST {phoneNumberId}/deregister` stops Cloud API usage, then **deletes** `outlets/{oid}/whatsapp` and `phoneNumberIndex/{phoneNumberId}` (removing webhook routing). The confirm copy explicitly notes the Baileys pairing is unaffected.

**Why the wizard exists:** Embedded Signup always connects *the owner's* account, which is heavyweight (popup, roles, publish state). Path B is the "platform already has a number, just assign it" path — fewer taps, no Meta popup, no app-publish dependency. The trade-off is that the platform token must have access to the target WABA.

---

## 5. Webhooks — inbound message routing

> **Coexistence (WhatsApp Business App + Cloud API on the same number) is app-side onboarding** — no Graph API toggle. `webhook-server` only *detects* it via `message.origin.type` (`business_app`/`update`) and writes `outlet.whatsapp.coexistence`; Supreme Admin shows status + a 3-tap guide + "I've enabled it" record. See `docs/PLAN-CHAT-HISTORY-COEXISTENCE.md`.

Meta calls a URL you configure whenever a message or status change happens on a subscribed object. Our endpoint is `https://photos-whenever-specifics-internationally.trycloudflare.com/webhook` (Cloudflare Quick Tunnel → EC2 :5000), with the `messages` webhook field subscribed.

### 5.1 The verification handshake

When you click **Verify and save** in the Meta dashboard, Meta makes:
```
GET /webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<random>
```
The server (`webhook-server/index.js:43`) checks `token === process.env.WA_VERIFY_TOKEN` and, if it matches, replies with the raw `hub.challenge`. If the token mismatches → 403, and Meta won't save the subscription.

### 5.2 The inbound message path

```
Meta → POST /webhook { entry:[ { changes:[ { value:{ metadata:{phone_number_id}, messages:[...] } } ] } ] }
  1. reply 200 immediately            (never let Meta retry-spam us)
  2. if value.statuses → log + stop   (these are delivery receipts)
  3. phoneNumberId = value.metadata.phone_number_id
  4. message = value.messages[0]
  5. routing = phoneNumberIndex[phoneNumberId]      ← THE multi-tenant lookup
  6. if no routing → warn + stop
  7. redis.publish("bot-inbox:{bid}:{oid}", JSON.stringify(message))
  8. bot worker (meta transport) receives → shapes upsert → conversation engine
```

The `200`-first discipline matters: Meta treats non-2xx as a failure and retries, so a slow downstream failure could cause duplicate processing. We acknowledge instantly, then process asynchronously.

**Why not write to Firebase directly?** The webhook server is a separate process from the bot worker. Publishing to Redis lets whichever bot is listening for that outlet pick it up — the same channel the Baileys path conceptually feeds, so the conversation engine is transport-agnostic.

---

## 6. Phone numbers — the full lifecycle

```
              ┌────────── Path A (Embedded Signup popup)
              │            owner logs into FB → popup provisions/selects
              │            WABA + number → oauth code → server exchange (§3.3)
              ▼
   number added to a WABA
        │  (owner's own WABA, or platform WABA via Path B "Add a number")
        ▼
   ownership verified
        │  SMS or voice 6-digit code → verify_code Graph call (§4)
        ▼
   number registered + 2FA pin set
        │  POST {phoneNumberId}/register   (required within 14 days of
        │  Embedded Signup, or Meta deletes the number)
        ▼
   waLinkSuccess() → whatsapp.status:'active' + phoneNumberIndex + bot transport
        │
        ├─ inbound:  Meta webhook → phoneNumberIndex → Redis → bot worker (§5)
        └─ outbound: bot worker → Graph {phoneNumberId}/messages (§7)
        ▼
   deregister (optional) → stop Cloud API usage, remove records
```

### Production caveats for a real restaurant number
- **Dedicated number:** the Cloud API number should be a number the restaurant controls and ideally one *not* actively running the consumer WhatsApp app. Running the same number on both causes conflicts (both sides receive messages, sessions fight).
- **2FA pin:** mandatory and set at registration. If lost, you must deregister and re-register (which re-verifies ownership).
- **24-hour customer-service window:** the bot can reply freely to customer messages within 24h of the customer's last inbound message. Beyond that window, only **approved templates** can be sent (§8).

### 6.1 Going live: real WABA + business verification (exact steps)

The current WABA (`2589174454849821`) is Meta's **test** WABA — `account_review_status: APPROVED`, holding the single test number `+1 555 661 9086`. Test WABAs can hold **exactly one** test number, which is why "add number" returns `#3 Application does not have the capability`. A real restaurant number needs its own real WABA under a verified Meta Business.

**Who does what.** Meta-side clicks (dashboard login, document upload, OTP, number OTP) are done by the account owner in the browser. Platform-side wiring (env vars, `phoneNumberIndex`, pm2 restart) is done by the agent/ops. The agent cannot log into Meta dashboards.

**Stage 1 — Meta Business Manager + business verification (owner, ~1–7 business days).**
1. `business.facebook.com` → Business Settings → Security Center → **Business Verification**.
2. Upload a document whose legal name matches the Business Manager name **exactly** (top rejection cause in 2026; e.g. GST registration / Udyam cert for Indian businesses). Expired licences are rejected automatically.
3. Verify the business phone/email when prompted. Check the Security Center chat for the decision; resubmit with corrected docs if rejected.
4. Proceed with Stages 2–3 in parallel while verification is pending.

**Stage 2 — create the real WABA (owner, minutes).**
1. Business Manager → WhatsApp Manager → **Add WhatsApp Business Account**.
2. Choose the (verified/verifying) business; this creates a real WABA. Note its **WABA ID** (24-hour support limit: 20 WABAs per business initially).
3. Create the business profile: category, logo, website, hours.

**Stage 3 — add + verify + register the real number (owner, minutes).**
1. **Prepare the number:** must not be active in the consumer WhatsApp/WhatsApp Business app — if it is, delete the account in the app first (Meta "takes over" the number). IVR/auto-attendants must be off. A fresh SIM or the shop line both work.
2. WhatsApp Manager → the new WABA → **Add phone number** → receive **SMS or voice OTP** → enter it. This sets `code_verification_status: VERIFIED`.
3. Set the **display name** (the name customers see — no slogans, no all-caps, must honestly describe the business; reviewed by Meta).
4. Give the agent the new **WABA ID** and **Phone Number ID**.

**Stage 4 — platform wiring (agent, ~5 min — already live-tested machinery).**
1. EC2 `ecosystem-bot-control.config.js` + `.env`: set `WABA_ID` to the new WABA; bot worker's `PHONE_NUMBER_ID`/`WA_PERMANENT_TOKEN` to the new number.
2. `webhook-server/seed-phone-index.cjs`: add `phoneNumberIndex/{phoneNumberId}` → `{ businessId, outletId }`.
3. If using the dashboard wizard (Path B): Supreme Admin → restaurant profile → WhatsApp → add/pick the number → request+verify code → **register** (sets the mandatory 2FA pin). On `status: 'active'`, **the orchestrator auto-starts the worker** (no manual provision).
4. `pm2 restart bot-control-api webhook-server` + the affected worker. Verify `whatsapp.status:'active'`, bot `Online`, `phoneNumberIndex` routed (same checks as the test-number deploy).

**Stage 5 — templates for proactive sends (owner/ops, 24–48h review).**
- Add the proactive templates in WhatsApp Manager (or via the dashboard template wizard → `createTemplate()`). Utility-category templates must not contain promo language and variables like `{{1}}` need surrounding context (2026 rule). Marketing sends need user opt-in.

**Stage 6 — app publish (owner).**
- After the business is verified, run **App Review** for the app's permissions so any restaurant owner can connect via Embedded Signup, not just app-role accounts. This is the last Meta-side gate.

**Key gotchas.** Number must be free of the consumer app; legal name must match docs exactly; the 2FA pin is mandatory at registration and if lost the number must be deregistered/re-registered; the 14-day registration window after Embedded Signup still applies to Path A.

---

## 7. Sending messages — the Cloud API send path

The bot sends through `whatsapp-send.js` → Graph `POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages` with `Authorization: Bearer {WA_PERMANENT_TOKEN}` and `messaging_product: 'whatsapp'`.

### Message types the bot can emit

| Type | Graph `type` | Payload | Used for |
|---|---|---|---|
| Plain text | `text` | `{ text: { body } }` | replies, order chat |
| Image | `image` | `{ image: { link, caption } }` | menu/photo shares — note: **only hosted URLs**, raw buffers can't be sent, so the transport falls back to text |
| CTA URL button | `interactive` (`cta_url`) | `{ interactive: { action: { parameters: { url } } } }` | the delivery webview link; falls back to plain text + link if Graph rejects |
| Template | `template` | `{ template: { name, language, components } }` | proactive/out-of-window sends (§8) |

### The daily-send counter (quota numerator)

Every successful **meta-transport** send increments an atomic counter in Firebase (`bot/index.js:1040`):
```
businesses/{bid}/outlets/{oid}/whatsapp/usage/{IST-date}   (transaction: (count||0)+1)
```
The IST date comes from `getISTDateInfo().dateStr` (UTC+5:30, split at midnight IST) — the same key the quota endpoint uses. This is the *used* numerator; the *limit* comes from `messaging_limit_tier` via Graph. Baileys sends don't count (they don't consume Cloud API tier).

---

## 8. Message templates — proactive / out-of-window sends

### The library
`restaurant-profile.js:400` reads the template library from `appTemplates/whatsappTemplates/templates` (seeded by `tools/seed-templates.cjs`) and lists what already exists on the outlet's WABA via `GET /api/whatsapp/templates/{bid}/{oid}` (which calls `whatsapp-graph.js listTemplates()` → `{wabaId}/message_templates`).

### Installing one
`POST /api/whatsapp/templates/{bid}/{oid}` → `whatsapp-graph.js createTemplate()`:
1. Reads the library template's `variables` map (`{'{{1}}': 'Customer name', ...}`).
2. Fills `example.body_text` with sample values (Priya, My Restaurant, PZ-1234, 20%, PIZZA20, 30 Sep, 30 mins). **Meta rejects templates with variables but no example text.**
3. `POST {wabaId}/message_templates { name, category, language, components }`.
4. The template enters **PENDING** and becomes sendable only after Meta approves it (quality check for spam/abuse).

### Sending one
`sendTemplate()` → `whatsapp-send.js sendWhatsAppTemplate()`:
- Passes `components` **only when the template actually has a `{{1}}` placeholder** — sending `text` to a no-variable template is rejected by Graph (code 100), which callers rely on to fall back to plain text.

---

## 9. Payments & money

Three separate "payment" concerns. **Only one involves real money movement, and that one isn't built.**

### 9a. Meta WhatsApp API pricing (pass-through — read-only)
Meta bills the number owner **per conversation**:
- **Service conversations** — customer-initiated; one billable conversation per 24h window per customer.
- **Utility / authentication / marketing conversations** — template-initiated (biz-initiated); billed per template message.

This is *the restaurant's* bill from Meta, not ours. We surface a **quota card** to keep the restaurant honest: `GET /api/whatsapp/quota/{bid}/{oid}` reads `messaging_limit_tier` (Graph) mapped to a cap (`TIER_1K`=1000, `TIER_10K`=10000, `TIER_100K`=100000, `TIER_UNLIMITED`=1000000), and divides the day's `usage/{date}` counter by it. Requires `META_SYSTEM_USER_TOKEN`; otherwise 501 and the card shows "Connect the Meta System User Token on the server."

### 9b. Restaurant → FoodHubbie subscription (DOES NOT EXIST)
- The **Plan / tier** dropdown writes `businesses/{bid}/plan` (`starter`/`growth`/`enterprise`) — a **plain string label with no teeth**.
- Nothing reads it for pricing, gating, or enforcement. No billing, no gateway, no invoices, no payment-status field, no plan limits, no trial expiry.
- **To build (if "payments" means the restaurant pays us):** plan catalog → payment gateway (Razorpay/Stripe/Cashfree) → invoice records → `plan`/`paymentStatus`/`trialEndsAt` on the business record → optionally enforce feature flags per plan (e.g. template count, bot features, rider dispatch).

### 9c. Customer order payment (display-only)
`Admin/js/features/payments.js` renders how a dine-in order was paid — **Cash / UPI / COD badges** on the order. There is **no online payment gateway** wired into the menu app; the customer pays at the table (cash / scan-UPI) and staff mark it. The `settlements` root node is **rider dispatch settlements**, not merchant payouts.

---

## 10. The complete checklist — from form to live orders

### Meta side (one-time)
- [x] Meta App "Foodhubbie" exists — App ID `1894358871543574`
- [x] Embedded Signup config created — Config ID `1624840945941910` (User token, General, WhatsApp permissions)
- [x] Test WABA `2589174454849821` + test number `+1 555 661 9086` / `1211796118690392`
- [ ] **Business verification** (Security Center, docs matching legal name — §6.1 Stage 1)
- [ ] **Real WABA** under the verified business + real number registered (§6.1 Stage 2–3)
- [ ] **Publish the app** (App Review after business verification) so real restaurant owners can connect, not just app roles

### EC2 / server side (one-time)
- [x] `META_APP_SECRET` set in the bot-control-api env (verified in live process env, 2026-08-17)
- [x] `META_SYSTEM_USER_TOKEN` set (Path B, quota, templates)
- [ ] `WA_PERMANENT_TOKEN` set (bot worker send path)
- [x] `WA_VERIFY_TOKEN` set for the webhook server
- [x] Cloudflare tunnel: `/api/* → :4000`, `/webhook* → :5000`
- [x] Meta dashboard webhook configured: callback URL, verify token, `messages` subscribed
- [x] Orchestrator watcher active (starts/restarts `bot-{bid}-{oid}` on transport change)
- [ ] When a real number is added: update `WABA_ID`/`PHONE_NUMBER_ID` in env + `seed-phone-index.cjs`, restart (§6.1 Stage 4)

### Per restaurant (Supreme Admin UI)
- [ ] Add Restaurant form → business + outlet records land in Firebase
- [ ] **Path A:** Connect a Meta account → Embedded Signup popup → owner signs in → `status:'active'`
  **or Path B:** Connect a number → pick/add → SMS/voice verify → register (2FA pin) → `status:'active'`
- [ ] `phoneNumberIndex` populated (webhook routing works)
- [ ] Bot worker online (`botStatus` = online; bot `transport` = `meta`)
- [ ] Test inbound: message the number → order flow works
- [ ] Test outbound: reply + template send
- [ ] Install the WhatsApp templates the outlet needs (pending Meta approval)
- [ ] Staff admin credentials set (Admin panel login) so the restaurant can run day-to-day

---

## 11. Data model recap — everything written during onboarding

```
businesses/{bid}                          { name, contactPhone, contactEmail, plan, createdAt }
businesses/{bid}/outlets/{oid}            { name, contactPhone, createdAt, whatsapp, ...templates }
businesses/{bid}/outlets/{oid}/whatsapp   { phoneNumberId, wabaId, displayPhoneNumber, verifiedName,
                                            status:'active', connectedAt, usage/{IST-date} }
businesses/{bid}/outlets/{oid}/bot        { transport:'meta'|'baileys', phoneNumberId, healthPort,
                                            provisionedAt, botStatus }
phoneNumberIndex/{phoneNumberId}          { businessId, outletId }
```

---

## 12. Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Popup says signup not set up | `META_CONFIG_ID` reverted to `'REPLACE_ME'` | set the Config ID, rebuild Admin, redeploy supreme |
| "exchange failed" / 501 on connect | `META_APP_SECRET` / `META_APP_ID` not set on EC2 | add to bot-control-api env, `pm2 restart bot-control-api` |
| Popup works but owner isn't an app role and app is unpublished | app not published | App Review → Publish (business verification) |
| Inbound messages never arrive | webhook not subscribed, `phoneNumberIndex` missing, or bot not in `meta` transport | check Meta webhook fields, re-run link, check bot `botStatus` |
| "No WABA found" (Path B step 1) | token can't enumerate, no `WABA_ID` fallback | set `WABA_ID` env |
| Quota card says "connect token" | `META_SYSTEM_USER_TOKEN` not set | set it, restart API |
| Template install rejected | missing example values for variables | library `variables` map must cover every `{{n}}` in the body |
| Template send fails with code 100 | passing body to a no-variable template | `whatsapp-send.js` already guards this — ensure callers don't force `body` |
| Number deleted by Meta | never registered within 14 days of Embedded Signup | register with 2FA pin right after signup |
| Bot shows "OFFLINE" after linking | worker restarted into meta transport but `WA_PERMANENT_TOKEN` missing | set the token, restart the worker |