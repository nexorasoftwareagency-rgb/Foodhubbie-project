# Meta (Facebook/WhatsApp) Platform Audit — Food-Hubbie

Audited 2026-08-15 via Graph API (v20.0) using the bot's existing server-side token + user-provided Business Manager URLs. Secrets are **not** recorded here — they live on EC2 (`/var/www/foodhubbie/.env` + `ecosystem-bot-control.config.js`).

## Accounts / hierarchy

| Item | ID | Name / value | Notes |
|------|-----|-------------|-------|
| Meta App | `1894358871543574` | Food-Hubbie WhatsApp app | Product: WhatsApp Business Messaging (customize mode). App secret set on EC2 |
| Business Manager | `1544720177433286` | **Foodhubbie** | From business.facebook.com URLs (`business_id` param) + Graph `/1544720177433286?fields=name` |
| System user (bot) | `122104851129433261` | `foodhubbiebot` | Token = `WA_PERMANENT_TOKEN` (in root `.env`). Verified via Graph debug_token |
| System user (2nd) | `61592997849004` | name unknown | From `system_users?selected_user_id=61592997849004` URL. Token not captured |
| Owner FB account | — | nileshshah84870@gmail.com | Login verified working (2FA gate) |

## Token (`foodhubbiebot`)

- **type: SYSTEM_USER**, `expires_at: 0` (never expires), `is_valid: true`
- scopes: `whatsapp_business_management`, `whatsapp_business_messaging`, `public_profile`
- length 197, starts `EAA…`
- **Reused as `META_SYSTEM_USER_TOKEN`** in `ecosystem-bot-control.config.js` (EC2) — no new token needed.
- Limitation: no `business_management` scope → cannot enumerate `me/businesses` / WABAs. That's why `WABA_ID` env is required.

## WhatsApp phone number (pizza outlet — the linked test number)

| Field | Value |
|-------|-------|
| phoneNumberId | `1211796118690392` |
| display number | `+1 555-661-9086` |
| verified name | "Test Number" |
| status | `CONNECTED` |
| quality_rating | `GREEN` |
| messaging_limit_tier | `TIER_250` (≈250 biz-initiated conversations/day; quota cap shown as 1000 by dashboard formula) |
| **code_verification_status** | **`NOT_VERIFIED`** ← production gap: number ownership not verified |
| name_status | `AVAILABLE_WITHOUT_REVIEW` |

This is a **Meta test number** (555 prefix). Fine for staging; a real restaurant number must be added + verified before production.

## EC2 config state

`/var/www/foodhubbie/.env` (existing, bot-facing): `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `REDIS_URL`, `WEBHOOK_PORT`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`, `WA_PERMANENT_TOKEN`, `OUTLET`, `BOT_TRANSPORT`.

`/var/www/foodhubbie/ecosystem-bot-control.config.js` (updated, bot-control-api env): added
- `META_SYSTEM_USER_TOKEN` ← WA_PERMANENT_TOKEN value
- `META_APP_ID` = 1894358871543574
- `META_APP_SECRET` ← WA_APP_SECRET value
- `WABA_ID` = **2589174454849821**, `WABA_NAME` = **Test WhatsApp Business Account** (from DEPLOYMENT-PROGRESS.md §5.3)

## WABA + templates

- **WABA** `2589174454849821` "Test WhatsApp Business Account" — `account_review_status: APPROVED`, timezone 1.
- **Numbers on WABA:** `1211796118690392` (+1 555-661-9086, "Test Number") — CONNECTED, quality GREEN, tier TIER_250, `code_verification_status NOT_VERIFIED`.
- **Templates:** `bot_live_update` (MARKETING) **APPROVED**, `hello_world` (UTILITY) **APPROVED**, `roshani_greeting` (MARKETING) **REJECTED**. Greeting flow (bot/index.js:373) sends an image, not a template → rejection doesn't block greetings. `roshani_greeting` can be recreated/retried from the dashboard templates page.
- Webhook resilience: `webhook-server/update-webhook-url.sh` (cron 5 min) re-subscribes the app to the WABA (`object=whatsapp_business_account`) with the fresh tunnel URL whenever it rotates — uses `WA_APP_ID|WA_APP_SECRET` basic auth.

Bot transport (live DB): pizza = **meta**, cake = **baileys** (no linked number).

## Endpoint verification (through the tunnel, super-admin token)

| Endpoint | Before | After | Notes |
|----------|--------|-------|-------|
| `/api/whatsapp/quota/roshani-pizza/pizza` | 501 | **200** `{tier:TIER_250, used:0, limit:1000}` | Token only |
| `/api/whatsapp/accounts/roshani-cake/cake` | 501 | **200** `{wabas:[2589174454849821]}` | Needs `WABA_ID` |
| `/api/whatsapp/templates/roshani-pizza/pizza` | 501 | **200** 3 templates | Needs `WABA_ID` |
| `/api/whatsapp/numbers/roshani-pizza/pizza` | 501 | **200** 1 number | Needs `WABA_ID` |
| `/api/whatsapp/exchange` (Path A) | 501 | configured | Needs `META_CONFIG_ID` in whatsapp-linking.js for the popup |

**Bug fixed en route:** `whatsapp-graph.js` `graphOk()` was not `async` → `.then(...)` on the raw `Response` made `/templates` + `/numbers` 500. Made `graphOk` async; deployed to EC2.

**Data fix:** pizza outlet `whatsapp.wabaId` backfilled to `2589174454849821` (wizard-shaped record), so `/numbers` + `/templates` resolve from the outlet itself too.

## Remaining for "final go"

1. **`META_CONFIG_ID`** (optional, Path A popup UX): developers console → app → WhatsApp → Embedded Signup config ID; fill `SupremeAdmin/js/features/whatsapp-linking.js` (`META_CONFIG_ID`). Without it, `WABA_ID` env still covers the token-based routes.
2. **Number verification** (production): current number is `NOT_VERIFIED` + a test number. For go-live, add a real number and complete `code_verification_status` → `VERIFIED` (dashboard wizard supports request/verify code).
3. **Retry `roshani_greeting` template** if greeting-by-template is ever wanted (currently image-based, so non-blocking).

## Live testing completed 2026-08-15 (all through the live Cloud API / tunnel)

| # | Test | Result | Notes |
|---|------|--------|-------|
| T1 | GET `quota` / `accounts` / `templates` / `numbers` via tunnel + fresh super-admin token | ✅ 200 | quota `{tier:TIER_250,used:0→1,limit:1000}`; accounts `[2589174454849821]`; templates 3; numbers 1 (NOT_VERIFIED) |
| T2 | Template **install** via dashboard API `POST /api/whatsapp/templates` | ✅ 200 | `zz_test_order_confirm` created → listed as PENDING → count 3→4 |
| T3 | Template **cleanup** (Graph `DELETE /{waba}/message_templates?name=`) | ✅ 200 | count back to 3. (App has no DELETE route yet — cleanup done via Graph) |
| T4 | Template **send** via Cloud API (`bot_live_update`, MARKETING) → owner number `919724649971` | ✅ 200 + **delivered** | wamid `…MzY1MkNBRUFDM0Y5RkNGQjVFAA==`; webhook logged `sent` → `delivered` (billable, category marketing) |
| T5 | Bot send path → quota `used` counter (`SEND_GENERIC_MESSAGE` command) | ✅ increments 0→1 | counter `whatsapp/usage/2026-08-15=1` — but see T6 finding |
| T6 | Webhook status capture for bot text send | ⚠️ **failed 131047** | `Re-engagement message — >24h since customer last replied`. Plain-text biz-initiated send is *accepted* (200 + wamid) but **not delivered**; counter counted it |
| T7 | Historical bot sends (order-delivery notifications, service category) | ✅ delivered+read | `[SEND OK]` + webhook `sent/delivered/read` — these are within the 24h service window |

**Findings from testing (production gaps):**
1. **Biz-initiated plain-text sends fail after 24h** (131047) — the bot's proactive sends (`SEND_GENERIC_MESSAGE`, promo campaigns, live updates) must use an **APPROVED template** (`bot_live_update`/`hello_world` send fine anytime). Order status notifications are fine (service window).
2. **Quota `used` counts accepted-not-delivered** — the counter incremented for the failed T6 message. Options: reconcile via webhook `failed` status, or relabel `used` as "attempted sends".

## Fixes applied 2026-08-15

| # | Fix | Status |
|---|-----|--------|
| F1 | **Template-send infrastructure**: `sendWhatsAppTemplate()` added to `bot/whatsapp-send.js` (Cloud API `type: template`; BODY component only when a `{{1}}` variable exists — passing `text` to a no-variable template is rejected by Graph `code 100`, which callers rely on to fall back) + `sock.sendTemplate()` on the meta transport (`bot/transport.js`) | ✅ deployed + verified |
| F2 | **Proactive sends route template-first with text fallback**: `SEND_GENERIC_MESSAGE` (`bot/index.js` `initCommandListener`) and promo sends (`bot/promotions.js` `sendPromotionalMessage`, meta detected via `sock.user.id.startsWith('meta:')`) now try `sendTemplate` first, fall back to the legacy text path on error. Template name = `process.env.PROACTIVE_TEMPLATE || 'bot_live_update'`. Verified live: template attempt → Graph `code 100` (bot_live_update has no variable) → clean text fallback → `[SEND OK]`, no crash | ✅ deployed + verified |
| F3 | **Quota card relabel** (`SupremeAdmin/js/features/restaurant-profile.js`): gauge now carries the note *"Counts messages accepted by WhatsApp today (delivery not guaranteed until an approved template is used for proactive sends)"* | ✅ deployed `hosting:supreme` |
| F4 | **Variable template creation attempted** for arbitrary proactive content: `promo_offer` (MARKETING) and `announcement` (UTILITY, `{{1}}`) — **both auto-REJECTED** by this test WABA's review (like `roshani_greeting`); `announcement` also hit "words ratio exceeds limit" on a short body before rejection. Deleted both after. Conclusion: test WABA won't approve free-form variable templates; the `PROACTIVE_TEMPLATE` env knob is the forward path once a real variable template is approved. Approved today: `bot_live_update` (MARKETING), `hello_world` (UTILITY, **en_US** — a send with `en` failed `132001`) | ⚠️ blocked on Meta template review |

**Deployment:** `bot/whatsapp-send.js`, `bot/transport.js`, `bot/index.js`, `bot/promotions.js` → EC2 `/var/www/foodhubbie/bot/` + `pm2 restart bot-roshani-pizza-pizza`; `SupremeAdmin` → `firebase deploy --only hosting:supreme`. **WABA template list now:** `bot_live_update` (APPROVED, MARKETING), `hello_world` (APPROVED, UTILITY), `roshani_greeting` (REJECTED) — `zz_test_order_confirm`, `promo_offer`, `announcement` all deleted via Graph `DELETE`.