# Final End-to-End Flow

How the FoodHubbie ERP actually moves a brand-new restaurant from "fill a form" to "taking WhatsApp orders" — what works today, what is stubbed, and the exact gaps to close. Written from a full read of the code, not from the UI's copy.

---

## 1. The architecture in one picture

```
Supreme Admin (firebase hosting: supreme)          bot-control-api (EC2 :4000, via tunnel)
  ├─ Add Restaurant form                            ├─ /api/bot/transport|restart|stop|rescan
  ├─ Restaurant Profile (toggle meta↔baileys)       ├─ /api/whatsapp/exchange   → 501 STUB
  └─ WhatsApp quota card                            └─ /api/whatsapp/quota      → 501 unless token
                                                          │
Firebase RTDB  ←→  bot worker (PM2, EC2)                webhook-server (EC2 :5000)
 businesses/{bid}/outlets/{oid}                     Bot in 'meta' mode subscribes to Redis
   ├─ settings, dishes, categories, tables          bot-inbox:{bid}:{oid}; sends via Graph API
   ├─ orders, tableSessions, guests
   ├─ whatsapp {status, phoneNumberId, wabaId}      Bot in 'baileys' mode = normal WA Web QR
   └─ bot {transport, pair, phoneNumberId}
 phoneNumberIndex (root) — maps phoneNumberId → bid/oid
```

---

## 2. Adding a new restaurant (what actually happens)

### Step A — Add Restaurant form (`SupremeAdmin/js/features/restaurant-onboarding.js`)
Fields: business name, outlet name, contact phone, contact email, plan (Starter/Growth/Enterprise).

Submit writes **one atomic multi-path update** (`db.ref().update({...})`):
- `businesses/{bid}` = `{ name, contactPhone, contactEmail, plan, createdAt }` — bid is a **Firebase push key** (`-Oxxxxxxxx`), not a slug.
- `businesses/{bid}/outlets/{oid}` = `{ name, contactPhone, createdAt, whatsapp: { status: 'pending' } }` — oid is also a push key.

Then it calls `launchWhatsAppSignup(bid, oid)` → Meta Embedded Signup popup.

**Reality check:** this step is the **only fully-working part** of onboarding. The business/outlet records land in Firebase correctly.

### Step B — Connect WhatsApp (Meta Embedded Signup)
`whatsapp-linking.js` loads the Facebook JS SDK, calls `FB.login({ config_id: META_CONFIG_ID, ... })`.

On success it POSTs the auth code to `/api/whatsapp/exchange` and, on a 2xx, writes `outlets/{oid}/whatsapp = { phoneNumberId, wabaId, status: 'active', connectedAt }`.

**Reality check — this is blocked, not working:**
- `META_CONFIG_ID = 'REPLACE_ME'` in `whatsapp-linking.js:18` → the signup popup cannot launch. Must be a real WhatsApp Embedded Signup config ID from Meta.
- `/api/whatsapp/exchange` in `bot-control-api/server.js:283` is a **501 stub** ("not yet implemented", needs `META_APP_SECRET` code exchange via Graph API `v20.0/oauth/access_token` + `whatsapp_business_management` scopes).
- So even if the popup launched, the number never gets saved to `whatsapp.status='active'`.

### Step C — "The Orchestrator starts the bot worker within ~5s" (from the UI copy)
**This does not exist.** Nothing in the repo watches Firebase for new `outlets/{oid}` and provisions a PM2 bot. Evidence:
- `ecosystem.config.js` hardcodes exactly two apps: `bot-roshani-pizza-pizza` (OUTLET=pizza) and `bot-roshani-cake-cake` (OUTLET=cake). No dynamic apps.
- `bot-control-api` routes only act on **existing** processes: `processName(bid, oid) = 'bot-{bid}-{oid}'` then `pm2.restart(...)`. A `pm2 restart` of a process that doesn't exist fails — it does not create it.
- No `pm2.start`, no provisioning route, no watcher loop that detects new outlets.
- `startStatusWatcher` only writes status for processes already in PM2's list.

**Conclusion:** after the form + (blocked) linking, a new restaurant has Firebase records but **no bot worker, no QR session, no message handling**. To go live today you must manually, on EC2:
1. Add a `bot-{bid}-{oid}` app to `ecosystem.config.js` with `OUTLET={oid}`, `BUSINESS_ID={bid}`, `OUTLET_ID={oid}`, plus a health port (pizza=3001, cake=3002 → pick a free one).
2. `pm2 delete ecosystem.config.js && pm2 start ecosystem.config.js` (or start just the new app).
3. The bot reads transport mode from `bot/{oid}/transport` (default baileys) → first boot writes a QR to `bot/{oid}/pair` → scan from the dashboard.

---

## 3. WhatsApp number — the truth about "new number generation"

There is **no number generation**. WhatsApp numbers are real phone numbers that already exist; the platform only **links** one. Two paths:

| | Baileys (WhatsApp Web) | Meta Cloud API (Official) |
|---|---|---|
| Which number | Any existing WhatsApp number the restaurant owns (e.g. the owner's personal or a shop line) | A **WhatsApp Business** number registered in the restaurant's Meta Business Manager (WABA) |
| How it's linked | QR scan via dashboard "Re-scan QR"; session saved on EC2 in `bot/session_data_{oid}/` | Embedded Signup popup (blocked — see §2 Step B) |
| Cost | Free, but the linked phone must keep WhatsApp installed & online | Per-conversation pricing from Meta, needs business verification for high volumes |
| Multi-outlet | One number per outlet bot, each with its own `session_data_{oid}` folder | One WABA phone number per outlet, routed via `phoneNumberIndex` |
| Works today? | ✅ Yes (toggle E2E-verified both directions) | ❌ No (`META_CONFIG_ID` + exchange stub) |

**Key facts:**
- `bot/transport.js getPhoneNumberId()` resolves Meta number from `bot/{oid}/phoneNumberId`, else reverse-lookups root `phoneNumberIndex`, else env `PHONE_NUMBER_ID`. `tools/seed-phone-index.cjs` populates `phoneNumberIndex`.
- `WEBVIEW_BOT_PHONE` (env, default `919724649971`) is the number customers see for delivery webview — a single shared constant, not per-outlet.
- Bot worker resolution: `bot/helpers/outlet-resolution.js` maps `BUSINESS_BY_OUTLET = { pizza, cake }`; any new outlet **must** pass `BUSINESS_ID`/`OUTLET_ID` env (or be added to that map) or it falls back to `roshani-pizza`.
- Customer menu app: `menu/js/firebase.js` reads OUTLET from the URL (`?o=` or first path segment) and BUSINESS_ID from `?b=`. A new restaurant works on the shared menu hosting target (`foodhubbie-qrmenu`) **if** its QR URL carries `?b={bid}&o={oid}` — but the fallback map `BUSINESS_BY_OUTLET` only knows pizza/cake.

**Bottom line for the user:** a new restaurant does NOT get a "generated" WhatsApp number. Either (a) they connect their existing number via Baileys QR today, or (b) once the Meta path is unblocked, they connect a WABA number they register in Meta Business Manager. The dashboard link step is there; the backend to complete it is not.

---

## 4. Payments — what exists and what does not

Three different "payment" concerns, only one of which exists:

### 4a. Customer order payment (exists, display-only)
`Admin/js/features/payments.js` renders how the order was paid — **Cash / UPI / COD badges** on the order. There is **no online payment gateway** (no Razorpay/Stripe/Cashfree anywhere in the repo — confirmed by grep). The menu app only supports dine-in ordering with cash/UPI at the table; delivery webview exists but no UPI intent is wired.

### 4b. Restaurant subscription to FoodHubbie (DOES NOT EXIST)
- The `plan` dropdown (Starter/Growth/Enterprise) is stored as a **plain string** on `businesses/{bid}.plan`.
- Nothing reads it for pricing, gating, or enforcement. No billing, no invoice, no payment collection, no plan limits, no trial expiry.
- The root `settlements` node (shared, from `firebase.js:49`) is **rider dispatch settlements**, not merchant payouts.

**Implication:** if the user wants "Payments" as in *the restaurant pays FoodHubbie a subscription*, that whole system has to be built: plan catalog, billing (gateway), invoice, payment status on the business record, and (optionally) gating of the bot/features by plan.

### 4c. Meta WhatsApp pricing (pass-through)
`/api/whatsapp/quota` reads `messaging_limit_tier` from Graph API and shows a gauge. Requires `META_SYSTEM_USER_TOKEN` env; otherwise it 501s ("not wired up"). `used` is always 0 (no send-log counter).

---

## 5. The end-to-end flow today — honest version

**New restaurant, as it works right now:**
1. ✅ Supreme Admin fills Add Restaurant form → business + outlet + `whatsapp.status='pending'` in Firebase.
2. ❌ Meta Embedded Signup blocked (`META_CONFIG_ID` + 501 exchange).
3. ❌ No orchestrator auto-starts a bot worker (must add PM2 app manually on EC2).
4. ⚠️ Baileys path works **only after** the PM2 app exists; then toggle/QR scan works (this is the one fully-verified path — the pizza/cake bots run this way today).
5. ⚠️ Menu app serves the new restaurant only if the QR URL includes `?b=&o=` (shared hosting site).

**Existing restaurants (pizza, cake) — fully working:**
- Order → Pending → Placed → session attach → KDS → billing → close (all audited, see `SUPREME-ADMIN-PROGRESS.md`).
- Bot toggle meta↔baileys, QR rescan, session persistence, PM2 restart — E2E-verified.
- Rider dispatch, reports, promotions, discounts — live.

---

## 6. Gaps to close for "add a restaurant by filling a form" to actually work

Ordered by criticality:

1. **Bot worker provisioning (hard blocker).** Smallest working version: a `provision` route in bot-control-api that does `pm2.start({ script: 'bot/index.js', name: 'bot-{bid}-{oid}', env: { OUTLET, BUSINESS_ID, OUTLET_ID, HEALTH_PORT } })`, called by an existing "Restart agent" button (or a watcher). Until then every new restaurant needs hands-on EC2.
2. **Meta Embedded Signup completion (blocks the Official-number path).** Set `META_CONFIG_ID`; implement `/api/whatsapp/exchange` (Graph `oauth/access_token` with app secret + code → `whatsapp_business_management` → save phoneNumberId/wabaId); write `phoneNumberIndex`.
3. **Menu/business fallback maps.** `menu/js/firebase.js` and `bot/helpers/outlet-resolution.js` `BUSINESS_BY_OUTLET` maps hardcode pizza/cake. New restaurants must be in the QR URL explicitly (`?b=&o=`) or added to both maps.
4. **Subscription billing** (only if "Payments" means restaurant→platform). Build plan catalog + gateway + invoice + `plan`/`paymentStatus` on the business record. Currently `plan` is a label with no teeth.
5. **Online UPI gateway for customer orders** (optional, separate from 4b).

---

## 7. Recommended minimal path to "new restaurant = just fill the form"

1. Add `provision` to bot-control-api (PM2 `start` with env), plus a "Start agent" action on the profile page (falls back to restart if process exists). ~1 file.
2. Finish Meta exchange (set config ID, implement exchange with app secret). ~1 file + env.
3. Ship the shared `BUSINESS_BY_OUTLET` fix: make the menu read bid/oid purely from URL (already does with `?b=`/`?o=`) and make bot `resolveBusinessIdFor` prefer `process.env.BUSINESS_ID` (already does) — then new outlets only need the env vars in step 1, no code edits.
4. Decide later whether subscription billing (4b) is in scope; it's the only genuinely new system.