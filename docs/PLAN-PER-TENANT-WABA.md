# PLAN — One WABA per Restaurant (tenant-owned WhatsApp)

> Decision recorded **2026-11-01**: each restaurant owns its own WhatsApp Business Account (WABA),
> its own phone number, and its own Meta billing. The platform never becomes a BSP middleman.
>
> Supersedes the "Path B / platform-managed number" assumption in earlier plans.

---

## 1. What this decision means

| | Today | After |
|---|---|---|
| WABA | one platform WABA `2589174454849821` ("Test WhatsApp Business Account") | **one WABA per restaurant**, owned by that restaurant's Meta business |
| Number | one platform test number `+1 555-661-9086` | **each restaurant's real number**, in their WABA |
| Token | one `META_SYSTEM_USER_TOKEN` shared by every outlet | **one token per outlet**, minted by Embedded Signup |
| Who pays Meta | you | **the restaurant** (their WABA, their card) |
| Onboarding | Supreme adds the number (Path B) | restaurant completes **Embedded Signup** with their own Facebook/Meta business |
| Number limits | shared `TIER_250` across all tenants | **per-WABA tier** — one restaurant's volume never throttles another |

This is the correct long-term model. It also has three consequences that change the timeline.

### Consequence A — Path B stops being the launch path

`SupremeAdmin` → "Connect a number" (Path B) adds a number to **your** WABA. That is exactly what you just ruled out. It stays in the product as an **internal/test** tool only.

### Consequence B — Tech Provider status and App Review are now mandatory

Path A (Embedded Signup) is the only way a restaurant grants your app access to *their* WABA, and Meta requires:

1. Business verification — **already done** ✅ (`verification_status: verified`)
2. **Tech Provider** onboarding + access verification
3. **App Review** → Advanced Access for `whatsapp_business_messaging` + `whatsapp_business_management`
4. App published (**Live**)

The "3–5 days, no App Review" fast path I described last message **no longer applies**. Realistic: **3–4 weeks**, calendar-bound by Meta.

### Consequence C — The token architecture must be rebuilt

Verified in code today:

| File | Line | What it does |
|---|---|---|
| `bot-control-api/whatsapp-graph.js` | `13-15` | `token()` returns **one global** `META_SYSTEM_USER_TOKEN` for every Graph call |
| `bot-control-api/whatsapp-graph.js` | `45` | `listWabas()` short-circuits to `process.env.WABA_ID` — always the platform WABA |
| `bot-control-api/orchestrator.js` | `52` | injects the **platform** `WA_PERMANENT_TOKEN` into every bot worker |
| `bot/index.js` | `2045` | `const accessToken = process.env.WA_PERMANENT_TOKEN` |
| `bot/transport.js` | `43` | `createMetaTransport({ outlet, phoneNumberId, accessToken, … })` |

Every outbound message from every restaurant would be sent with **your** token against **your** WABA. With one WABA per restaurant that is wrong on all three counts (token, WABA, phone number).

---

### Consequence D — Billing: the platform pays Meta, but only as a Solution Partner

Decided 2026-11-01: WhatsApp usage is charged to FoodHubbie's main Facebook account, not to each
restaurant. **Meta's Tech Provider tier cannot do this** — a Tech Provider's clients must add their
own payment method. "We pay" requires **Solution Partner status + a shared credit line** (platform
becomes Bill To Party and is liable for 100% of client spend), or the platform's own card on each
client WABA (fragile). This is a parallel long-lead track. Full detail, liability controls and the
per-message cost model: **`docs/BILLING-MODEL.md`**.

---

## 2. Target architecture

```
Restaurant's Meta Business
  └── WABA  (owned by restaurant, their card on file)
        ├── phone number  → phoneNumberId
        └── templates     → provisioned from our starter library at onboarding

        │  Embedded Signup (v4) → code
        ▼
POST /api/whatsapp/exchange        (bot-control-api, app secret server-side)
        │  → business token (long-lived, Tech Provider)
        ▼
businesses/{bid}/outlets/{oid}/waAuth   ← SECRET, read: isSuper/isSupreme only
businesses/{bid}/outlets/{oid}/whatsapp ← non-secret: wabaId, phoneNumberId, name, status
phoneNumberIndex/{phoneNumberId}        ← { businessId, outletId }  (webhook routing)
        │
        ▼
orchestrator injects WA_TOKEN_REF at worker spawn → bot reads waAuth via Admin SDK
```

### Token storage rule

**Never** put a WABA token in a client-readable node. `businesses/{bid}` read cascades to outlet admins, so a token under `outlet.whatsapp` would be readable by that restaurant's staff.

- Secrets → `businesses/{bid}/outlets/{oid}/waAuth`, rule `.read: isSuper || isSupreme` (same shape as the existing write-only `onboardingSecrets` pattern).
- Bot workers and `bot-control-api` use the Admin SDK, which bypasses rules — they can read it.
- Supreme UI never receives the token, only `{ connected: true, verifiedName, quality, tier }`.

---

## 3. Code changes (6 items, ~4–5 dev days)

| # | Change | Files | Detail |
|---|---|---|---|
| 1 | **Per-tenant token resolution** | `bot-control-api/whatsapp-graph.js` | Replace `token()` with `tokenFor(bid, oid)` → read `waAuth.token` via Admin SDK, cache 5 min. Keep the platform token as an explicit `tokenForPlatform()` for internal/test calls only. |
| 2 | **Per-tenant WABA enumeration** | `whatsapp-graph.js:44-69` | `listWabas(bid, oid)` must return the tenant's linked WABA, not `env.WABA_ID`. |
| 3 | **Worker token injection** | `bot-control-api/orchestrator.js:39-70` | Read the tenant token at spawn and pass `WA_ACCESS_TOKEN`; stop passing the platform token. Add a `child_changed` on `waAuth` → restart that worker so a rotated token is picked up. |
| 4 | **Bot reads tenant token** | `bot/index.js:2045`, `bot/transport.js:43` | `accessToken = process.env.WA_ACCESS_TOKEN || <Admin SDK read of waAuth>`; fail loudly if missing instead of silently sending with the wrong token. |
| 5 | **Embedded Signup v4** | `SupremeAdmin/js/features/whatsapp-linking.js` | `sessionInfoVersion: '3'` is **deprecated (2026-10-15)**. v4 uses the `WA_EMBEDDED_SIGNUP` `postMessage` event (FINISH / CANCEL / ERROR) and returns `{ code, waba_id, phone_number_id }` directly — no more guessing the WABA from `debug_token`. Client then POSTs `{ bid, oid, code, wabaId, phoneNumberId }` to `/api/whatsapp/exchange`. |
| 6 | **Starter template provisioning** | `bot-control-api/server.js` + `appTemplates/whatsappTemplates` | After a successful link, create the 14 approved templates on the **tenant's** WABA with the **tenant's** token, then poll `message_template_status_update` webhooks. Until approved, that outlet's notifications fall back to plain text. |

### Also required in `server.js`

- `/api/whatsapp/exchange` → write `waAuth` + `whatsapp` + `phoneNumberIndex`, call `subscribed_apps` **with the tenant token**.
- `/api/whatsapp/numbers/*`, `/templates`, `/quota` → all switch to `tokenFor(bid, oid)`.
- `/api/bot/delete` → delete `waAuth` too.

---

## 4. Webhook — already correct, keep it

`webhook-server/index.js` routes inbound by `phoneNumberIndex/{phoneNumberId}` → `{businessId, outletId}`. That works unchanged for N restaurants.

Two additions:

1. Subscribe to more fields. Today the subscription is `fields: "messages"` only (`update-webhook-url.sh`). Add:
   `messages, message_template_status_update, message_template_quality_update, phone_number_quality_update, account_update`
   — without `message_template_status_update` you cannot see a template get rejected.
2. Consider **coexistence** (`origin.type = 'business_app'`) — already handled at `index.js:109-116`. Keep it.

---

## 5. Critical config finding — your Embedded Signup token type is wrong for this model

`docs/WHATSAPP-ONBOARDING-FULL-FLOW.md` §2.2 records that config `1624840945941910` was created with:
**Access token = "User access token"**.

User access tokens **expire** (~60 days) and require the restaurant owner to re-authenticate. Under one-WABA-per-restaurant, that means every restaurant silently stops sending WhatsApp messages 60 days after onboarding, until they log in again.

**Fix:** create a **new Embedded Signup configuration** of the Tech-Provider / **system-user (business) token** type, and replace `META_CONFIG_ID` in `whatsapp-linking.js:20`. Meta's current documentation is explicit: *"If you are a Tech Provider, you will use business tokens exclusively."*

This is the single highest-consequence detail in the whole migration. A forgotten config ID here costs you a 60-day time bomb per tenant.

### 5.1 It cannot be created or fixed through the API — dashboard only

Verified 2026-11-01: `GET /1624840945941910` returns `code 100 / subcode 33 Unsupported get request`
for **both** the app token and the system-user token. Facebook Login for Business **configuration IDs
are not Graph objects** — there is no public endpoint to read, create, or edit one. It has to be made
by hand in the App Dashboard (about 5 minutes), then the ID is pasted into code.

Click path (v4 — a *product-scoped* config, not the old legacy template):

1. <https://developers.facebook.com/apps/1894358871543574/> — the **Foodhubbie** app.
2. Left nav → **Facebook Login for Business** → **Configurations** → **Create configuration**.
3. **Login variation → Embedded Signup**, then tick the product **Cloud API**. Ticking a product is
   what makes it a **v4** config and auto-selects its permissions.
4. **Access token → System user access token** (the Foodhubbie system user from
   `Credentials/System user Permanent token.txt`). *If the dashboard still offers the legacy
   "…With 60 Expiration Token" template, that is the one to avoid — a user token there is what caused
   the 60-day time bomb.*
5. **Save** → copy the **Configuration ID** (a 16-digit number, different from `1624840945941910`).
6. Paste into `SupremeAdmin/js/features/whatsapp-linking.js:20` → `npm run build:admin` → deploy
   `hosting:admin`.

> **The old config is dead on two counts.** (a) It was created 2026-08-17 with a user access token;
> a ~60-day user token from then expired around **mid-October 2026**. (b) More fundamentally it is a
> **pre-v4** configuration — ES v2/v3 were deprecated **2026-10-15**, and v4 requires a new config with
> products selected. So `1624840945941910` cannot be "kept", whatever happens to the billing decision.

> **Creating the config does not make ES work.** The popup will not launch for a non-partner app, and
> `whatsapp_business_management` returns error `200` on accounts you do not own until App Review grants
> Advanced Access. Both gates are dashboard-only (no API to query them):
> <https://developers.facebook.com/apps/1894358871543574/app-review/permissions/> → *Permissions and
> features* tab.

Also stamp `sessionInfoVersion: '3'` → `'4'` in the same file: ES v2/v3 were deprecated
**2026-10-15**, so the current client is already out of support.

---

## 6. Onboarding flow (what the restaurant sees)

1. Supreme → Add Restaurant (existing 5-step wizard).
2. New final step: **"Connect your WhatsApp"** → `FB.login` with the v4 config.
3. Restaurant logs in with **their own** Facebook account, picks or creates **their** Meta business, picks **their** WABA and number.
4. Popup closes → our server exchanges the code → writes `waAuth`, `whatsapp`, `phoneNumberIndex`, subscribes webhooks.
5. We install 14 starter templates on their WABA (pending approval, typically minutes to hours).
6. Bot worker starts (orchestrator sees `whatsapp.status = 'active'`).
7. Their number must be **verified + registered** with a 2FA PIN within 14 days of signup — the UI must force this.

**Friction to accept:** a restaurant with no Meta Business portfolio must create one inside the popup. Expect 30–50% of small restaurants to need hand-holding. Keep a documented manual fallback (you complete signup on their behalf while screen-sharing) — but it still lands in *their* WABA, not yours.

---

## 7. Sequencing against the Baileys deadline (2026-12-01)

| Days | Work | Meta dependency |
|---|---|---|
| 1–2 | Infra: `api.foodhubbie.in` + Caddy, close 3000/8080, backups | none |
| 1–4 | Code: per-tenant tokens (items 1–4) + test on the existing test WABA | none |
| 3–5 | **Create ES configuration with system-user token type**; verify it issues a business token | console only |
| 4–6 | **ES v4 client rewrite** + exchange endpoint update | needs a live app to test |
| 5 | Submit **Tech Provider** onboarding + **App Review** (2 videos) | **Meta clock starts** |
| 6–10 | Template provisioning + the 6 status templates + OTP authentication template | Meta template review |
| 10–20 | App Review decision; onboard Roshani Pizza's own WABA end-to-end | Meta |
| 20–25 | Onboard Roshani Cakes; run 1 week in parallel with Baileys | — |
| 28–30 | Stop Baileys workers, delete `bot/session_data_*`, remove transport code | — |

**Slack: ~3 days.** If App Review slips past day 20, keep Baileys running for pizza/cake and move the removal date — do not rush production WhatsApp.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| App Review rejected (most common: vague justification, video doesn't show a real send) | Record the two videos against the *real* flow, not a demo; mention template creation explicitly |
| User-token config shipped by accident | Create the system-user config **before** touching `META_CONFIG_ID`; add a startup assertion that the exchanged token has `expires_at: 0` |
| Restaurant's number still on the consumer WhatsApp app | Pre-flight check in the wizard: call `/request_code` and surface the exact error |
| Tenant token leaked to the browser | `waAuth` rule `read: isSuper \|\| isSupreme`; never return it in any API response |
| Template rejection on every new WABA (Meta review is per-WABA) | Provision templates at onboarding + surface status in Supreme; fall back to plain text inside 24 h |
| Per-WABA tier starts at `TIER_250` | Fine for one restaurant; note it in the plan copy so nobody expects blasts on day 1 |

---

## 9. What to build first (I can start today, no Meta access needed)

1. `tokenFor(bid, oid)` + `waAuth` node + rules entry.
2. Orchestrator per-worker token injection + restart-on-rotation.
3. Bot token resolution with a loud failure instead of a silent wrong-token send.
4. Template coverage: the 6 status templates + `131047` retry fallback.

Items 1–3 are pure code and unblock everything. Item 4 is the thing that will actually break on day one of Baileys removal.
