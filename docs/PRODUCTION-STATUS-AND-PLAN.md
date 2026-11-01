# PRODUCTION LAUNCH — Verified Status + Plan (v2)

> Verified live on **2026-11-01** via Graph API v20.0 (system-user token), RTDB Admin SDK, and SSH to EC2.
> Secret **values** are not stored here. They are referenced by path.
> Supersedes §2–§5 of the v1 draft.

---

## 1. Verified live status

### Meta / WhatsApp

| Object | ID | Live value |
|---|---|---|
| Business portfolio | `1544720177433286` | **Foodhubbie** — `verification_status: verified` ✅ |
| Meta app | `1894358871543574` | **Foodhubbie** — no privacy-policy URL, no app domains, no category set |
| System user | `122104851129433261` | `foodhubbiebot` |
| Token | `WA_PERMANENT_TOKEN` | **valid**, `type: SYSTEM_USER`, `expires_at: 0` (never) |
| Token scopes | — | `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`, `manage_app_solution`, `whatsapp_business_manage_events`, `public_profile` |
| WABA | `2589174454849821` | **Test WhatsApp Business Account**, `ownership_type: SELF`, `account_review_status: APPROVED`, currency INR |
| Phone number | `1211796118690392` | `+1 555-661-9086`, **`code_verification_status: NOT_VERIFIED`**, `TIER_250`, quality `GREEN`, `is_official_business_account: false` |
| Embedded Signup config | `1624840945941910` | exists; client uses **v3** (`sessionInfoVersion: '3'`) |
| Webhook | — | **active**, `https://hall-advise-thinking-growth.trycloudflare.com/webhook`, object `whatsapp_business_account`, field `messages` (v26.0) |
| Subscribed app | — | Foodhubbie app is subscribed to the WABA ✅ |

**Templates — 17 total, 14 APPROVED, 3 REJECTED**

| Approved (14) | Rejected (3) |
|---|---|
| `order_placed` UTIL · `order_confirmed_dinein` UTIL · `order_confirmed_delivery_v2` UTIL · `order_ready_v3` UTIL · `order_delivered_v3` UTIL · `order_cancelled` UTIL · `rider_assigned` UTIL · `hello_world` UTIL (en_US) · `greeting_welcome` MKT · `proactive_promo` MKT · `promo_hinglish_offer` MKT · `promo_hinglish_discount` MKT · `promo_hinglish_festive` MKT · `promo_hinglish_winback` MKT | `otp_changed` · `out_for_delivery_v3` · `rider_reached` — all OTP-class, rejected as UTILITY |

### Infrastructure

| Item | Live value |
|---|---|
| EC2 | `3.111.39.210`, t3.small, Ubuntu 24.04, **Node v22.23.4** |
| RAM | 1907 MB total, **1009 MB used**, 897 MB available, 2 GB swap |
| Disk | 29 GB, 6.6 GB used (24%), 22 GB free |
| UFW | **inactive** (security-group only) |
| Listening | `*:4000`, `*:5000` only — no 80/443, **no nginx/caddy** |
| PM2 | `bot-control-api` ✓, `webhook-server` ✓, `bot-roshani-pizza-pizza` ✓, `bot-e2e-*` ×6 (**5 stopped**), `pm2-logrotate` ✓ |
| Tunnels | 2 quick tunnels: `:5000` → `hall-advise-thinking-growth…` (**alive**), `:4000` → `algorithm-charlie-california-default…` (**alive**) |
| Cron | tunnel keepalive **/2 min**, Meta webhook re-register **/5 min**, demo reseed 03:00 IST |
| EC2 git tree | **DIRTY** — `bot-control-api/server.js`, `bot/firebase.js`, `bot/index.js`, `bot/rider.js` modified vs `a4392f1` |

### Tenants (live RTDB)

19 outlets total. Only these are real:

| Outlet | Transport | WhatsApp |
|---|---|---|
| `roshani-pizza/pizza` — Roshani Pizza | **baileys** | `active`, phoneNumberId `1211796118690392` (the **test** number) |
| `roshani-cake/cake` — Roshani Cakes | baileys | none (no bot worker) |
| `foodhubbie-demo/demo` — Demo Dashboard | — | none |
| `Apex-Anjani` | — | `pending` |
| 15 others | — | **E2E junk / blank-named / disabled** — should be purged |

Stale entries found: `phoneNumberIndex/123456789` → a deleted E2E outlet.

---

## 2. Correction to my earlier report

I flagged three competing tunnel hostnames as an outage. **That was wrong** — verified afterwards:

- `:4000` tunnel (`algorithm-charlie-california-default…`) — **alive**, returns `401 Missing bearer token` on `/api/bot/status-all` (correct auth behaviour). This is what `config/tunnelUrl` holds, so Supreme works.
- `:5000` tunnel (`hall-advise-thinking-growth…`) — **alive**, returns `403` on `/webhook` (correct).
- `photos-whenever-specifics-internationally…` — **dead**, but it is only the *hardcoded fallback* in `SupremeAdmin/js/firebase-config.js:23`, overridden at runtime by `config/tunnelUrl`.

So today it works. The risk is real but **latent**: every tunnel restart changes the hostname, the keepalive cron re-syncs within 2 minutes, the Meta webhook within 5. Worst case = **~5 minutes of dropped inbound WhatsApp messages**, silently.

---

## 3. What is actually blocking production

Only three things. App Review is **not** one of them for your own restaurants.

### Blocker 1 — You are on a **test** WABA with a **test** number

`+1 555-661-9086` is Meta's shared test number. It cannot be shown as your business, cannot be verified, and is capped at `TIER_250`. Every template and webhook test so far ran against it.

### Blocker 2 — The app is not Live (and is not configured for review)

`privacy_policy_url` is unset, `app_domains` is unset, `terms_of_service_url` is a placeholder (`facebook.com`), category is unset. Until those are filled, the app cannot be published — and an unpublished app's webhooks only deliver test events.

### Blocker 3 — The bot barely uses templates

Verified call sites: **only `rider_assigned`** is sent as a template (`bot/index.js:1568`), plus proactive commands (`index.js:455`) and promos (`promotions.js:60`). Every other status change is **plain text**:

| Message | Current | On Baileys | On Cloud API |
|---|---|---|---|
| Order placed / confirmed / ready / delivered / cancelled | plain text | ✅ | ⚠️ only inside the 24 h window |
| Delivery OTP (`out for delivery`, `reached drop`) | plain text **by design** (`index.js:1673`) | ✅ | ⚠️ only inside 24 h |
| `rider_assigned` | template ✅ | ✅ | ✅ |

**The killer case:** QR dine-in customers never message the bot, so **no 24 h window ever opens**. Every status message to them is business-initiated → on Cloud API it *must* be a template. Today it would fail with `131047`, silently.

---

## 4. The decision you are stuck on — resolved

You do **not** need App Review / Tech Provider to run **your own** restaurants.

| Goal | What Meta requires | Timeline |
|---|---|---|
| **A. Roshani Pizza + Cakes on the official API** (own business, own WABA) | Real WABA under your verified portfolio → real number verified + registered → app **Live** (privacy URL + domains + category). **No App Review.** | **~3–5 days** |
| **B. Onboard *other* restaurants' numbers** (SaaS) | Tech Provider status + App Review (Advanced Access, 2 videos) + Embedded Signup **v4** | **2–4 weeks** |

**Recommendation:** do **A now** (it removes Baileys from your own outlets inside the 30-day window), then **B** in parallel, because B is calendar-bound by Meta.

Do **not** do B first — it would leave your own outlets on Baileys past the deadline for no benefit.

> **DECIDED 2026-11-01 — one WABA per restaurant.** The owner chose model **B** as the permanent
> architecture. That supersedes the "A first" recommendation above: Tech Provider + App Review +
> Embedded Signup v4 become mandatory, the per-tenant token refactor is required, and the realistic
> timeline is **3–4 weeks**, not 3–5 days.
> See **`docs/PLAN-PER-TENANT-WABA.md`** for the architecture, the 6 code changes, and the
> system-user-token configuration fix. **This section's timeline no longer applies.**

---

## 5. Track A — own restaurants on Cloud API (this week)

Order matters; each step depends on the previous.

1. **Business settings → WhatsApp accounts → Add** → create WABA `Foodhubbie` under portfolio `1544720177433286`.
2. **Add a real number** — a number not currently active on the WhatsApp consumer app (deregister it there first). Verify by SMS/voice → `code_verification_status: VERIFIED`.
3. **Register** with a 6-digit 2FA PIN. Store the PIN — never displayed again.
4. **Add a payment method** to the WABA (India billing).
5. **App settings → Basic**: privacy `https://foodhubbie.in/privacy`, terms `https://foodhubbie.in/terms`, app domains `foodhubbie.in`, category *Business*, then **publish (Live)**.
6. **EC2 config**: set `WABA_ID` / `WABA_NAME` to the new WABA in `ecosystem-bot-control.config.js`; `pm2 restart bot-control-api --update-env`.
7. **Supreme → Restaurant → Connect a number (Path B)** → select the new WABA → attach the number. This writes `outlets/{oid}/whatsapp`, `phoneNumberIndex/{pnid}`, subscribes the app, and flips transport to `meta`.
8. **Restart the outlet's bot worker** and confirm `botStatus` = online + `transport: meta`.
9. **Wire the templates** (see §6) — this is the actual engineering work.
10. **E2E**: QR order → status events → OTP → delivered, with the customer having *never* messaged the bot.

**Acceptance:** a QR dine-in order receives every status message on a customer who never opened WhatsApp with the bot.

---

## 6. Template coverage work (the real engineering)

| # | Change | File | Why |
|---|---|---|---|
| 1 | Send `order_placed` template on order confirmation | `bot/index.js` status listener | outside-window delivery |
| 2 | Send `order_ready_v3` / `order_delivered_v3` / `order_cancelled` templates | same | same |
| 3 | Keep `order_confirmed_dinein` / `order_confirmed_delivery_v2` wired | same | already approved, unused |
| 4 | **OTP**: create an **AUTHENTICATION**-category template with a copy-code button (`otp_changed` / `out_for_delivery_v3` / `rider_reached` were rejected as *UTILITY*) | Meta console + `bot/index.js` | OTP outside 24 h is otherwise undeliverable |
| 5 | Fallback rule: on `131047`, retry once as template, then log | `bot/transport.js` / send wrapper | prevents silent loss |
| 6 | Add webhook fields `message_template_status_update`, `phone_number_quality_update`, `account_update` | `webhook-server/update-webhook-url.sh` | currently only `messages` — you cannot see rejections live |

**Note:** #4 is the only genuinely blocked item — Meta's authentication-template review is separate and can take days. Until then, OTP delivery outside the window stays plain-text-only, which is exactly why Baileys still exists.

---

## 7. Track B — SaaS onboarding (weeks 2–4)

1. **Tech Provider onboarding** — App Dashboard → Use cases → WhatsApp → *Tech Provider onboarding* (business already verified ✅).
2. **App Review** — Advanced Access for `whatsapp_business_messaging` + `whatsapp_business_management`. Two recordings: (a) message sent from app → received in WhatsApp, (b) template created + sent. Plus written justification.
3. **Embedded Signup v3 → v4** — `SupremeAdmin/js/features/whatsapp-linking.js:44` sends `sessionInfoVersion: '3'`; v3 was deprecated **2026-10-15**. v4 uses the `WA_EMBEDDED_SIGNUP` postMessage event instead of `sessionInfoVersion`.
4. **Per-tenant WABA or shared?** For SaaS, per-tenant WABA (Path A) is the only model where the restaurant owns its number.

---

## 8. Infra hardening (2 days, do in parallel)

| Fix | Why | Effort |
|---|---|---|
| `api.foodhubbie.in` → Caddy/nginx + certbot → `127.0.0.1:5000` | kills both quick tunnels; webhook URL becomes permanent | 2 h |
| Close SG ports 3000/8080; enable UFW (`22,80,443` only) | currently UFW inactive, 4000/5000 bind `*` | 30 min |
| Set `TUNNEL_URL` default in `firebase-config.js` to `https://api.foodhubbie.in` | removes the dead hardcoded fallback | 5 min |
| Remove both keepalive crons after cutover | no longer needed | 5 min |
| Nightly RTDB export → GCS + one restore drill | no backups today | 2 h |
| Purge 15 junk tenants + `bot-e2e-*` pm2 apps + `phoneNumberIndex/123456789` | Supreme shows clutter; one stale routing entry | 1 h |
| Reconcile EC2 dirty tree → commit or reset | live code ≠ git (`4 files modified`) | 1 h |
| Secrets → AWS SSM Parameter Store | all secrets live on one laptop | half day |
| Blaze plan before 2nd busy outlet | Spark caps RTDB at 100 concurrent connections | 10 min |

---

## 9. Credentials — found and verified

| Secret | Location | Tracked in git? | State |
|---|---|---|---|
| Firebase Admin SDK key | `Credentials/foodhubbie-10-firebase-adminsdk-*.json`, `bot/service-account.json`, EC2 `/var/www/foodhubbie/bot/` | ❌ no | ✅ working |
| EC2 SSH key | `foodhubbie-key.pem` | ❌ no | ✅ working |
| AWS IAM keys | `Credentials/nilesh-admin_accessKeys.csv` | ❌ no | not tested |
| Meta system-user token | `Credentials/WA_PERMANENT_TOKEN_NEW.txt`, EC2 `.env`, pm2 env | ❌ no | ✅ **valid, never expires** |
| Meta app secret | `Credentials/Wa app secret.txt` (format `WA_APP_SECRET = <32 hex>`), EC2 `META_APP_SECRET` | ❌ no | ✅ working |
| WhatsApp verify token | EC2 `.env` `WA_VERIFY_TOKEN` | ❌ no | ✅ working (webhook verified) |
| E2E admin password | `Credentials/e2e-admin-password.txt` | ❌ no | — |

`git ls-files` confirms **none** of the above are committed. `.env.example` is stale — it documents 3 of the 14 env vars EC2 actually uses.

---

## 10. Timeline

| Week | Track A (own outlets) | Track B (SaaS) | Infra |
|---|---|---|---|
| 1 | Real WABA, real number, app Live, switch pizza to meta | — | `api.foodhubbie.in`, close ports |
| 2 | Template coverage + OTP authentication template | Tech Provider onboarding | backups + restore drill |
| 3 | Cake outlet migrated, Baileys workers stopped | App Review submission | SSM secrets, purge junk |
| 4 | Baileys code removal | ES v4 migration | Blaze, monitoring |

**Baileys deadline:** 2026-12-01. Everything in Track A must be done by then.

---

## 11. Decisions needed

1. **Which real number** goes on the official WABA first? (Roshani Pizza's, presumably.)
2. **Per-tenant WABA or one platform WABA?** Decides the whole SaaS model.
3. **Billing**: manual invoice for first tenants, or Razorpay now?
4. **Who runs the Meta console steps** — you, or do you want me to drive the browser with you?
