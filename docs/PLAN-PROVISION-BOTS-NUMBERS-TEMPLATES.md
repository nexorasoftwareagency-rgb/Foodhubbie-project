# Plan — Provision Bots, WhatsApp Numbers, Templates (from the Dashboard)

Owner request: *"Every restaurant's own EC2 WhatsApp Baileys bot can be run, created, connected from Dashboard. Every restaurant's own WhatsApp Business Number with API can be connected, created, managed from Dashboard with the least taps/steps. Make a lot of things a Template."*

This is a **research-backed plan** — what exists, what's missing, the exact endpoints/data/UI to build, and the order. No code yet (marked in progress tracker as planned).

---

## 0. What exists today (verified by reading the code)

| Piece | Where | State |
|-------|-------|-------|
| Add Restaurant form | `SupremeAdmin/js/features/restaurant-onboarding.js` | ✅ Writes `businesses/{bid}` + `outlets/{oid}` atomically, `whatsapp.status='pending'` |
| Meta Embedded Signup | `SupremeAdmin/js/features/whatsapp-linking.js` | ⚠️ `META_CONFIG_ID='REPLACE_ME'` → popup can't launch |
| Code exchange | `POST /api/whatsapp/exchange` (`bot-control-api/server.js:283`) | ⚠️ 501 stub, needs `META_APP_SECRET` |
| Transport toggle meta↔baileys | `POST /api/bot/transport/:bid/:oid` + `rescan` | ✅ E2E-verified, session persists in `bot/session_data_{oid}/` |
| Bot QR pairing | `bot/index.js` pair-intent + `bot/pair` node + dashboard QR modal | ✅ works once a PM2 process exists |
| PM2 control | `bot-control-api/server.js` restart/stop/status (name `bot-{bid}-{oid}`) | ✅ acts on **existing** processes only |
| Live bot status | `status-watcher.js` → `botStatus` in Firebase | ✅ any `bot-{bid}-{oid}` process gets status for free |
| Bot workers | `ecosystem.config.js` | ⚠️ hardcoded pizza/cake only — **no way to add a new restaurant's bot** |
| WhatsApp quota | `GET /api/whatsapp/quota` | ⚠️ needs `META_SYSTEM_USER_TOKEN` (unset → 501) |
| Payments | — | ❌ `plan` is a label only; order payments are Cash/UPI/COD display; no gateway, no billing |
| Customer menu | `menu/` single hosting target | ✅ already multi-tenant via `?b=&o=` URL |

**The two hard blockers** to "add a restaurant and it works":
1. No **bot provisioning** — a new restaurant has Firebase records but no PM2 worker (the UI's "Orchestrator starts the bot within ~5s" does not exist in code).
2. **Meta linking is stubbed** — no config ID, no exchange, so no restaurant can connect an Official WhatsApp number.

---

## 1. Feature A — Provision each restaurant's Baileys bot from the dashboard

### Design
A new `POST /api/bot/provision/:bid/:oid` in `bot-control-api/server.js` that `pm2.start`s a fresh `bot-{bid}-{oid}` worker on EC2. Once running, everything downstream already works: `status-watcher` writes live `botStatus`, the bot emits `bot/pair` QR, the dashboard QR modal pairs it, the transport toggle switches it.

### Endpoint spec
```
POST /api/bot/provision/:bid/:oid        (requireSuperOnly)
  → pm2.start({
      name: 'bot-{bid}-{oid}',
      cwd: path to bot/,
      script: 'bot/index.js',
      env: {
        OUTLET: oid,
        BUSINESS_ID: bid,
        OUTLET_ID: oid,
        BOT_TRANSPORT: 'baileys',
        HEALTH_PORT: <allocated>,   // next free port in 3001..3100
      },
    })
  → pm2.save()                         // survive reboot
  → write businesses/{bid}/outlets/{oid}/bot = {
      transport: 'baileys', provisionedAt, provisionedBy }
  → res.json({ ok: true, name: 'bot-{bid}-{oid}' })
```
- **HEALTH_PORT allocation**: scan `pm2.list()` envs of existing `bot-*` apps, pick lowest free port ≥3001 (pizza=3001, cake=3002 already used). Fallback `3001 + outletIndex`.
- **Idempotent**: if a process already exists, `pm2.restart` instead of `start` (never duplicate).
- **Errors surface** to the toast (`provision failed — <pm2 detail>`), same pattern as restart/stop (see B4/E-gap fixes).

### Companion endpoints
- `POST /api/bot/delete/:bid/:oid` (requireSuperOnly) → `pm2.delete` + remove `bot/session_data_{oid}/` + clear `outlet.bot`. For decommissioning.
- `GET /api/bot/provisioned/:bid/:oid` → whether process exists (drives the button state; could be inferred from `botStatus` instead — prefer that, fewer round-trips).

### Dashboard
- **Onboarding**: after the form succeeds, offer **"Connect WhatsApp now"** with two paths: *Official API (Meta popup)* or *WhatsApp Web (QR — Baileys)*. Choosing QR → call `provision` → open existing QR modal. Choosing Meta → existing Embedded Signup (once unblocked).
- **Profile**: an un-provisioned outlet (no `botStatus`, no `bot.provisionedAt`) shows a **"Start bot worker on EC2"** button → provision → QR modal. Provisioned-but-offline shows Restart (existing). Add a "Decommission" (danger) action next to Stop.
- **Fleet/restaurant list**: add a "Provisioned" chip; KPI "Needs attention" already covers offline.

### Files touched
`bot-control-api/server.js`, `SupremeAdmin/js/features/restaurant-onboarding.js`, `SupremeAdmin/js/features/restaurant-profile.js`, `SupremeAdmin/js/data-store.js` (add `provisioned` flag to `flattenOutlets`), `SupremeAdmin/FEATURE-LIST.md`.

### What it deliberately does NOT do (YAGNI)
- No auto-orchestrator watching Firebase and spawning bots (the old UI copy). A dashboard tap is fewer moving parts than a background provisioner, and there are no CRUD races — skip the watcher until there are dozens of restaurants and provisioning becomes one-off friction. Mark with `// ponytail:` when skipped.

---

## 2. Feature B — Connect / create / manage each restaurant's Official WhatsApp number from the dashboard

### Meta facts that shape this (researched)
- A number lives in a **WABA** (WhatsApp Business Account). You send/receive + templates through the WABA.
- Phone numbers are **real numbers you own** — there is no "generate a random number" API. "Create" = add an owned number to a WABA, then **verify** (SMS/voice code) then **register** (2FA pin). (Dev "test numbers" are the exception.)
- Key endpoints (Graph API `v20+`):
  - `GET /{waba-id}/phone_numbers` — list numbers
  - `POST /{waba-id}/phone_numbers` — add number (`verified_name`, `display_phone_number`)
  - `POST /{phone_number_id}/request_code` — send SMS/voice verification
  - `POST /{phone_number_id}/verify_code` — submit code
  - `POST /{phone_number_id}/register` — register + set 6-digit 2FA pin (`messaging_product`, `pin`) — **required within 14 days of Embedded Signup**
  - `POST /{waba-id}/subscribed_apps` — wire webhooks for that WABA
  - `GET /{waba-id}` / `GET /{business-id}/owned_whatsapp_business_accounts` — find WABAs
  - `GET /{phone_number_id}?fields=messaging_limit_tier,quality_rating,display_phone_number` — quota/quality
- Scopes needed on the token: `whatsapp_business_management`, `whatsapp_business_messaging`.
- **Two viable connection paths**:
  - **Path A — Embedded Signup (per-restaurant WABA)**: the restaurant's own Meta Business owns the WABA. Popup → exchange `code` server-side → save `{wabaId, phoneNumberId}`. This is what `whatsapp-linking.js` already attempts. Best for "each restaurant owns its number."
  - **Path B — Platform system-user API (least taps)**: platform holds `META_SYSTEM_USER_TOKEN` (or a partner token) with `whatsapp_business_management`. Dashboard lists WABAs/numbers, adds, verifies, registers — **zero Meta popups**, pure API. Best for "platform manages numbers for many restaurants" and for the "Manage from Dashboard with least taps" ask.
- Plan: implement **both**, Path B as the primary (least taps), Path A as the restaurant-owns flow. Both write the same `outlet.whatsapp` + `phoneNumberIndex` records.

### Endpoint spec (all `requireSuperOnly` except GETs)
```
# Path B — pure API management
GET  /api/whatsapp/accounts/:bid/:oid        → list WABAs (system-user token)
GET  /api/whatsapp/numbers/:bid/:oid         → list numbers on the outlet's WABA
POST /api/whatsapp/numbers/:bid/:oid         → add number {verified_name, display_phone_number}
POST /api/whatsapp/numbers/:bid/:oid/:pnid/request-code   → {method:'sms'|'voice', language}
POST /api/whatsapp/numbers/:bid/:oid/:pnid/verify-code    → {code}
POST /api/whatsapp/numbers/:bid/:oid/:pnid/register       → {pin} (6-digit 2FA)
POST /api/whatsapp/numbers/:bid/:oid/:pnid/deregister     → remove from Cloud API

# Path A — Embedded Signup exchange (replace 501 stub)
POST /api/whatsapp/exchange :bid/:oid {code} → app-secret oauth exchange → debug_token
                                               → WABA + phone numbers → save records

# Shared post-success (both paths), server-side
  → write businesses/{bid}/outlets/{oid}/whatsapp = {
      phoneNumberId, wabaId, displayPhoneNumber, verifiedName, status:'active', connectedAt }
  → write phoneNumberIndex/{phoneNumberId} = { businessId, outletId }   // webhook routing
  → POST /{waba-id}/subscribed_apps (subscribe once per wabaId)
  → set outlet.bot.transport = 'meta' (bot now uses this number)
```
Also: `GET /api/whatsapp/quota` (exists) — enable real `used` by counting sends from the bot's send path into a `botStatus`/`outlet.whatsapp.usage` counter (currently always 0).

### Dashboard — a WhatsApp-number wizard (profile page)
A "Connect Official WhatsApp number" card with a stepper (reuses the onboarding-stepper look):
1. **Choose flow** — "Use platform-managed number" (Path B, no popup) OR "Connect Meta account" (Path A, popup).
2. Path B: pick an existing number on the WABA **or add one** (verified_name + display number) → tap "Send code" (SMS/voice) → enter code → "Register" (auto-generate a 6-digit pin, store it in `outlet.whatsapp.pin` — do NOT show after save).
3. Done → `whatsapp.status='active'`, number shown on profile KPI, transport auto-switched to meta.
4. Manage section: display number, verified name, quality rating, messaging tier + used/limit, "Re-verify", "Deregister".

### Files touched
`bot-control-api/server.js` (+ a `whatsapp-graph.js` helper for the Graph calls), `SupremeAdmin/js/features/whatsapp-linking.js` (fill `META_CONFIG_ID` + route both paths), `SupremeAdmin/js/features/restaurant-profile.js` (wizard card), `SupremeAdmin/js/utils.js` (quality/tier labels), env `.env` (add `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_APP_ID`, optional default `WABA_ID`).

---

## 3. Feature C — Templates ("make a lot of things a Template")

Two template systems, both designed to cut the taps when adding a restaurant.

### C1. Restaurant onboarding templates (seed settings + catalog + bot defaults)
Currently onboarding writes only name/phone/email/plan. A **template** additionally seeds the outlet's `settings`, categories, dishes, delivery slabs, tax, hours, and bot defaults — so a new Pizza outlet starts configured like a Pizza outlet with one click.

- **Storage**: `businesses` is per-tenant; templates are platform-level → put them under a root node **`appTemplates/{templateId}`** (super-readable, mirror the `phoneNumberIndex` pattern). Seeded by a `tools/seed-templates.cjs` script (matches existing `tools/seed-phone-index.cjs`).
- **Template shape**:
  ```
  appTemplates/pizza-restaurant = {
    name: 'Pizza restaurant',
    defaults: {
      settings: { Store: {...}, Delivery: {slabs, ...}, tax, serviceCharge, hours },
      categories: [...], dishes: [...] or a category skeleton,
      bot: { transport:'baileys' },
    },
  }
  ```
- **Onboarding UI**: a "Start from template" picker (Pizza / Cake / Cloud Kitchen / Custom) next to the plan dropdown. Selecting one pre-fills the form and, on submit, also writes the template's `defaults` under the new outlet (same atomic update). Admin can add/edit templates via a small `#templates` admin view (or seed script only — start with seed script, add UI only if asked).

### C2. WhatsApp message-template library (Meta)
For promotional/broadcast messages outside the 24h customer-service window, Meta requires **pre-approved message templates**. Give each restaurant a ready starter set + the ability to manage them.
- **Seed**: a starter library (order-confirmed, order-delivered, promo-offer, feedback-request) as Meta template JSON under `appTemplates/whatsappTemplates/`.
- **API**: `GET /api/whatsapp/templates/:bid/:oid` (list on the WABA), `POST /api/whatsapp/templates/:bid/:oid` (create from the library / custom), `DELETE .../:templateName` (requires Graph `template` object path). `requireSuperOnly` for mutations.
- **Dashboard**: "Message templates" card on the profile → list approved/pending, "Create from library", status badges (APPROVED/PENDING/REJECTED).
- **Bot send**: bot's promo/marketing sends (`promotions.js`) check for a template name on the WABA before a template send; plain text continues inside the 24h window. (Note: template sends use the phone's WABA, not the Baileys socket — only relevant on `transport='meta'`.)

### C3. Plan templates (tie-in, not new work)
`plan` (starter/growth/enterprise) already exists as a field. Feature C1 templates may reference a plan; enforcement/gating is deliberately **out of scope** (no billing — see §4). Only the label + default seeding ships.

---

## 4. Payments — what this plan does NOT build (flag)

User asked about payments earlier; it stays a documented gap, not part of this build:
- **Order payments** (Cash/UPI/COD) are display-only today. An online UPI/gateway (Razorpay/Stripe) is a separate feature with its own trust boundary.
- **Restaurant subscription** (restaurant pays FoodHubbie) does not exist at all — `plan` is a label. Requires a real billing system (gateway + invoices + gating). Deliberately skipped until the owner confirms scope.

---

## 5. Build order (dependencies first)

| Phase | Work | Unblocks |
|-------|------|----------|
| **1** | `provision` + `delete` endpoints; dashboard Start-bot button + QR; onboarding QR-path option | "New restaurant's Baileys bot from dashboard" |
| **2** | `whatsapp-graph.js` + Path B endpoints (list/add/verify/register/deregister) + `phoneNumberIndex`/`subscribed_apps` write | Official number management |
| **3** | Fill `META_CONFIG_ID`, implement `/api/whatsapp/exchange` (Path A) | Embedded Signup completes |
| **4** | `appTemplates` node + `seed-templates.cjs` + onboarding template picker; C2 message-template API + card | Templates |
| **5** | Quota `used` counter; decommission flow polish; docs/FEATURE-LIST refresh | — |

Phase 1 alone delivers the headline ask ("run, create, connect each restaurant's Baileys bot from dashboard"). Phases 2–3 deliver "each restaurant's Official number connected/managed from dashboard."

## 6. Risks / gotchas
- **Meta number creation is not "generate a number"** — it's add-an-owned-number + verify + register. Set this expectation in the UI copy.
- **14-day registration window** after Embedded Signup — if a Path-A number isn't registered in time, re-run signup.
- **WABA limits**: 2 registered numbers / 20 WABAs per Meta business initially (limit up to 20 numbers). Platform-managed (Path B) shares one WABA's limits; per-restaurant WABAs (Path A) don't — but each needs its own Meta Business.
- `META_SYSTEM_USER_TOKEN` is a **system user token** (long-lived), not the app token; needs the two `whatsapp_business_*` scopes. It also powers quota (already reads it).
- PM2 `pm2.save` must run after `start` so workers survive reboot (the `bot-control-api` app already uses `pm2-ubuntu.service`).
- Provisioned apps run on the shared EC2 box — watch memory; one worker per outlet is the model, alerting already exists via `status-watcher`.