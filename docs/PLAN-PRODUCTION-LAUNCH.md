# PLAN — Production Launch: Supreme Control Plane · Meta/WABA · EC2

> Status: **PLANNING** (2026-10-31). Evidence read from source at this commit.
> Owner go required before any Meta console change, DNS change, or EC2 reboot.
> Secret **values** are never written in this file. They are referenced by path only.

---

## 0. Scope and honesty boundary

This plan covers **getting to a paying, live restaurant** — not adding product features.

What I verified directly: the repository (Supreme Admin UI, `bot-control-api`, `webhook-server`, `bot/transport`, `firebase.json`, rules, env **names**, git tracking, local credential store).

What I cannot do from here, and what therefore needs the owner:

| Not available to me | Consequence |
|---|---|
| A logged-in `business.facebook.com` / `developers.facebook.com` session | Verification, App Review, Tech Provider, WABA/number steps must be clicked by the owner (I give exact click paths) |
| AWS console / IAM session | Security-group, billing, snapshot changes stay owner-side |
| A decision to run live EC2 commands | SSH key + `.env` exist locally, so I *can* run read-only checks **on explicit go** — I will not touch production unprompted |

Everything else (code, scripts, verification harnesses, runbooks) I can build and run.

---

## 1. What is already built (verified in code, not assumed)

| Subsystem | Where | State |
|---|---|---|
| Supreme shell + nav | `SupremeAdmin/index.html` | 6 tabs: **Restaurants · Analytics · Notifications · Onboarding · Bot Fleet · Usage & Payments** |
| Feature modules | `SupremeAdmin/js/features/` | 13 modules: onboarding wizard, restaurant list/profile, analytics, payment overview/record, bot fleet overview, whatsapp link/manage, onboarding requests, notifications, command palette |
| Bot provisioning | `bot-control-api/server.js:746` `POST /api/bot/provision/:bid/:oid` | Implemented (+ `stop` 715, `delete` 797, `restart` 233) |
| Transport switch + QR rescan | `server.js:250`, `:279` | Implemented, E2E-verified previously |
| WhatsApp Path B (platform-managed number) | `server.js:861–986` | list WABAs, list/add number, request-code, verify-code, register (2FA pin), deregister — all implemented |
| WhatsApp Path A (Embedded Signup) | `server.js:992` `POST /api/whatsapp/exchange` | Implemented server-side (oauth code → token → debug_token → WABA → number → save). **Client still uses Embedded Signup v3** — see G3 |
| WABA management API | `bot-control-api/whatsapp-graph.js` | list WABAs (with `business_management` fallback), numbers, templates, quota, deregister |
| Webhook receiver | `webhook-server/index.js` | Verifies `X-Hub-Signature-256` (when `META_APP_SECRET` set), routes by `phoneNumberIndex/{pnid}`, publishes to Redis `bot-inbox:{bid}:{oid}` |
| Bot runtime | `bot/` | Two transports (baileys / meta), 17 templates on the WABA (14 approved), pacing + strike + promo block on baileys |
| Billing / usage | `SupremeAdmin/js/billing-shared.js`, `shared/cost-math.js` | Per-order cost math + manual payment ledger (`payment-record.js`). **No gateway.** |
| Multi-tenant data | `database.rules.json` | Tenant-scoped `businesses/{bid}/outlets/{oid}/…`, demo sandbox grants, PII split to `tableSessionsContact` |
| Hosting | `firebase.json` | 6 targets live: admin, rider, menu, supreme, assets, website (`foodhubbie.in`) |

**Conclusion:** the platform is functionally complete for one-to-many restaurants. What blocks production is **not features** — it is six external gates.

---

## 2. The six go-live gates

Ordered by dependency. G1 → G2 → G3 → G4 can run in parallel with G5.

### G1 — Meta Business Verification (BLOCKER, human-only)

**Why:** Tech Provider status, Advanced Access, higher messaging tiers and a real WABA all require a verified business.

**Evidence it is unfinished:** `docs/META-PLATFORM-AUDIT.md` §"Business verification — started 2026-09-29 (IN PROGRESS, blocked on Website)". The original blocker was that Meta rejects `*.web.app`. **That blocker is now gone** — `foodhubbie.in` is live.

**Steps (business.facebook.com):**
1. Business settings → **Security Centre** → *Verify your business* → Start.
2. Country **India**, type **Sole proprietorship**.
3. Enter details **exactly** as on the Udyam certificate (mismatch = rejection):
   - Enterprise: `FOODHUBBIE`
   - Udyam: `UDYAM-BR-31-0042040`
   - Owner: `Shah Nilesh Rakesh`
   - Address: `Parsa, Parsa Bazar, Patna–Parsa–Siwan Highway, Chapra, Saran, Bihar 841219`
   - Phone: `+91 97246 49971` (OTP target)
   - Email: `nileshshah84870@gmail.com`
   - NIC: `56101 — Restaurants without bars`
4. **Website: `https://foodhubbie.in`** (custom domain — this is the fix; never `*.web.app`).
5. Upload the Udyam PDF. Expect 1–5 business days.

**Acceptance:** Business settings shows a green **Verified** badge on the portfolio `1544720177433286`.

---

### G2 — App Live + App Review (Advanced Access) + Tech Provider

**Why:** In Development mode the app only serves users with an app role, and webhooks only deliver test events — i.e. **no real restaurant can connect**. `docs/WHATSAPP-ONBOARDING-FULL-FLOW.md` §2.5 records: *"App Foodhubbie — Unpublished … webhooks deliver only test events."*

**Steps (developers.facebook.com → app `1894358871543574`):**
1. Confirm G1 is green.
2. **App Review → Permissions and features** → request **Advanced Access** for:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
3. App Review submission requires **two screen recordings**:
   - a message sent from the app and received in WhatsApp;
   - a template created and sent.
   Plus a written description of how each asset is used.
4. **Use cases → Customize → WhatsApp → Tech Provider onboarding** → complete access verification, then *Become a Tech Provider*.
5. Flip the app to **Live**.

**Acceptance:** App dashboard shows *Live*; both permissions show **Advanced Access**; Tech Provider onboarding shows **Verified**.

> Note: Meta gates Advanced Access behind Tech Provider status and vice-versa. Submit App Review **after** G1, and complete the Tech Provider "Access verification" step the same day — the two are interlocked, and a stale verification banner can silently block Embedded Signup.

---

### G3 — Embedded Signup v3 → v4 (DEADLINE ALREADY PASSED)

**Why this is urgent:** `SupremeAdmin/js/features/whatsapp-linking.js:44` sets `sessionInfoVersion: '3'` — that is **Embedded Signup v3**. Meta's current documentation (updated 2026-07-24) states:

> *"Embedded Signup v2 and v3 will be deprecated on October 15, 2026 … Migrate your integration to v4 before that date."*

Today is 2026-10-31. **Path A (restaurant connects its own Meta account) is past the deprecation date.** It may still function for app-role accounts during a grace window, but it cannot be the production path as written.

**Options, in order of effort:**

| Option | Work | Risk |
|---|---|---|
| **A. Keep Path B as the launch path** (recommended for first tenants) | Zero code. Platform-managed WABA + numbers, managed from Supreme. Already implemented end-to-end. | Every tenant's number sits on one WABA → shared limits, and the tenant does not "own" their number |
| **B. Migrate Path A to v4** | Rewrite `launchWhatsAppSignup` + `handleFbResponse` for the v4 message-event API (`WA_EMBEDDED_SIGNUP` postMessage), re-test exchange | 1–3 dev days, needs a live app to test |
| **C. Ship both** — B for tenants who want their own WABA, A-v4 later | A now, v4 after first paying tenant | — |

**Acceptance for A:** a brand-new outlet gets a working number through Supreme **without** the Facebook popup.
**Acceptance for B:** popup completes, `phoneNumberIndex` written, inbound message routed, on a *live* app.

---

### G4 — Real WABA + verified, registered number

**Why:** the only number today is Meta's **test** number on a **test** WABA.

**Evidence:** WABA `2589174454849821` ("Test WhatsApp Business Account"), number `1211796118690392` = `+1 555-661-9086`, `code_verification_status: NOT_VERIFIED`, `messaging_limit_tier: TIER_250` (`docs/META-PLATFORM-AUDIT.md`).

**Steps:**
1. Business settings → **WhatsApp accounts → Add** → create a real WABA under the verified portfolio.
2. Add the restaurant's real number (must not be active on the WhatsApp consumer app — deregister it there first).
3. Verify by SMS/voice → `code_verification_status: VERIFIED`.
4. **Register** with a 6-digit 2FA PIN (Supreme Path B does this; store the PIN — do **not** display it again).
5. Prefer a number with no prior WhatsApp history; a freshly ported number can take hours to propagate.
6. Update EC2 env `WABA_ID` / `WABA_NAME`; restart `bot-control-api`.
7. Add a payment method to the WABA (required for Tech Provider-onboarded businesses).

**Tier ladder:** `TIER_250` → `TIER_1K` → `TIER_10K` → `TIER_100K` → unlimited, based on volume + quality. First tenants start at 250 business-initiated conversations/day — enough for order notifications, not for blasts.

**Acceptance:** `GET /api/whatsapp/numbers/{bid}/{oid}` returns the real number with `code_verification_status: VERIFIED`; a live order notification is delivered; `GET /api/whatsapp/quota` reports the real tier.

---

### G5 — Kill the Cloudflare Quick Tunnel (TOP INFRA BLOCKER)

**Why:** the entire Supreme control plane points at an **ephemeral** tunnel hostname.

**Evidence:**
- `SupremeAdmin/js/firebase-config.js:23` — default `TUNNEL_URL = 'https://photos-whenever-specifics-internationally.trycloudflare.com'`
- 11 call sites in Supreme use `${TUNNEL_URL}/api/...` (restart, provision, stop, templates, exchange, password, onboarding approve)
- `webhook-server/index.js:28` comment: *"The Cloudflare Quick Tunnel only routes to a single local port"*
- `firebase.json` CSP allow-lists `https://*.cloudflaretunnel.com`

A Quick Tunnel gets a **new random hostname every restart**. The code mitigates by reading `config/tunnelUrl` from RTDB, but that only works if the tunnel-updater cron is alive — and the updater script is **not in the repo** (`webhook-server/` contains only `index.js`, `package.json`, `seed-phone-index.cjs`).

**Fix (recommended):**
1. Point `api.foodhubbie.in` (A record) at `3.111.39.210`.
2. Install Caddy (auto-TLS, 2-line config) or nginx + certbot on EC2, reverse-proxying `https://api.foodhubbie.in` → `127.0.0.1:5000`.
3. Open **443 only** in the security group; close 3000 and 8080.
4. Meta webhook callback URL → `https://api.foodhubbie.in/webhook`.
5. Supreme `firebase-config.js` default `TUNNEL_URL` → `https://api.foodhubbie.in`; keep the `config/tunnelUrl` override as a kill-switch but stop depending on it.
6. Delete the tunnel-updater cron; add `POST /{waba}/subscribed_apps` verification to the deploy checklist.

**Acceptance:** restart EC2 → Supreme still controls the fleet and inbound WhatsApp messages still route, with **no manual URL change**.

---

### G6 — Infra, secrets, cost and commercial readiness

| Item | Current state | Required |
|---|---|---|
| SSH access | SG port 22 pinned to a **dynamic home IP** (`ACCESS.md`) | SSM Session Manager, or a bastion, or at minimum a documented re-add runbook |
| Open ports | 3000, 8080 open to `0.0.0.0/0` | Close both; 443 only |
| TLS | none on EC2 (tunnel terminates TLS) | Caddy/nginx + certbot (part of G5) |
| Backups | none documented | Daily RTDB export to GCS + weekly EC2 AMI/snapshot; **test a restore** |
| Secrets | all in `Credentials/`, `.env`, `service-account.json` on one Windows machine + EC2 disk; gitignored ✅ | Move to AWS SSM Parameter Store (SecureString) or GCP Secret Manager; rotate the Firebase SA key, the EC2 key pair, and the WhatsApp token once, at cutover |
| Logs | pm2 logs; logrotate added previously | Verify rotation + a 30-day retention policy |
| Monitoring | `status-watcher.js` writes bot status; no external alerting | Uptime check on `api./app./menu.` + alert to the owner's phone/email; pm2 `max_memory_restart` already set (400M) |
| Capacity | **one t3.small** (2 vCPU / 2 GB), one pm2 worker per outlet | t3.small comfortably runs ~3–5 Baileys workers. Beyond that: t3.medium, or move META-transport outlets to a serverless sender (no worker needed) |
| Firebase plan | Spark caps RTDB at 100 concurrent connections | **Blaze required** before the second busy restaurant (`PLAN/P3-8-FIREBASE-FREE-PLAN-5-COUNCIL-VERDICT.md`) |
| Redis | optional in code, **effectively required** for meta transport — `webhook-server/index.js:125` drops messages when `REDIS_URL` is unset | Keep Redis local + `appendonly yes`, or move to ElastiCache once multi-tenant |
| Billing | `plan` is a label; payments are recorded manually | Decide: (a) manual invoicing for the first 10 tenants, or (b) Razorpay subscriptions. **Do not sell a plan that cannot be enforced.** |
| Legal | none in repo | Merchant terms, privacy policy (already on the website?), DPA for restaurant data, and WhatsApp Business Solution Terms acceptance |

---

## 3. Supreme Admin control map (what the owner can actually do today)

| Tab | Action | Endpoint | Works now? |
|---|---|---|---|
| Onboarding | Add restaurant (5-step wizard) | client-side write + `/api/bot/provision` | ✅ |
| Onboarding | Approve website signup | `/api/admin/approve-onboarding` | ✅ (needs G5 URL) |
| Restaurants | Open profile, edit, disable/reactivate | RTDB + rules | ✅ |
| Restaurants | Start / stop / restart / delete bot worker | `/api/bot/{provision,stop,restart,delete}` | ✅ |
| Restaurants | Switch meta ↔ baileys, rescan QR | `/api/bot/{transport,rescan}` | ✅ |
| Restaurants | Connect official number (Path B wizard) | `/api/whatsapp/numbers/*` | ✅ (needs G4) |
| Restaurants | Connect via Meta popup (Path A) | `/api/whatsapp/exchange` | ⚠️ v3 deprecated → G3 |
| Restaurants | Templates list / create | `/api/whatsapp/templates` | ✅ (needs token) |
| Restaurants | Quota + quality | `/api/whatsapp/quota` | ✅ (needs token + linked number) |
| Bot Fleet | Live status of every worker | `/api/bot/status-all` + `botStatus` | ✅ |
| Usage & Payments | Per-restaurant usage/due, record payment, receipt | `billing-shared.js` | ✅ (manual) |
| Analytics | Platform-wide revenue/orders | RTDB reads | ✅ |
| Notifications | Owner broadcast to admins | RTDB + FCM | ✅ |
| — | **Subscription billing / dunning** | — | ❌ not built |
| — | **Restaurant-facing self-serve number purchase** | — | ❌ not built |

---

## 4. Credentials registry (redacted — value locations only)

> Nothing below prints a secret. Treat every path as *sensitive*.

| Secret | Kind | Held in | Git-tracked? | Rotation |
|---|---|---|---|---|
| Firebase Admin SDK (service account) | JSON private key | `Credentials/foodhubbie-10-firebase-adminsdk-*.json`, EC2 `/var/www/foodhubbie/bot/service-account.json` | ❌ ignored (verified: `git ls-files` returns nothing) | Rotate at cutover; old key remains valid until deleted in console |
| EC2 SSH key pair | PEM | `foodhubbie-key.pem` (repo root) | ❌ ignored | Replace with SSM Session Manager; retire the key |
| AWS IAM user keys | CSV | `Credentials/nilesh-admin_accessKeys.csv` | ❌ ignored | Rotate; prefer an IAM role + SSO over a long-lived user key |
| Meta system-user token | long-lived token | EC2 `.env` `WA_PERMANENT_TOKEN`, `ecosystem-bot-control.config.js` (injected), `Credentials/WA_PERMANENT_TOKEN_NEW.txt` | ❌ ignored | Rotate via Business settings → System users |
| Meta app secret | app secret | `Credentials/Wa app secret.txt`, EC2 env `META_APP_SECRET` | ❌ ignored | Rotate in App settings → Basic |
| WhatsApp verify token | shared string | `.env` `WA_VERIFY_TOKEN` | ❌ ignored | Free to rotate (also update Meta webhook config) |
| Meta app ID / WABA / phone-number / business IDs | **identifiers, not secrets** | `whatsapp-linking.js:19-20`, `ecosystem-bot-control.config.js` | ✅ committed (fine) | n/a |
| Firebase web config (`apiKey`, etc.) | **public by design** | `Admin/firebase-config.js`, `menu/js/firebase.js` | ✅ committed (fine) | Security comes from rules, not this key |
| E2E admin password | test credential | `Credentials/e2e-admin-password.txt` | ❌ ignored | Rotate |
| GitHub Actions secrets | `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_TOKEN`, `E2E_ADMIN_PASSWORD` | GitHub repo secrets | n/a | Confirm all three exist — `PENDING_WORK.md` notes `E2E_ADMIN_PASSWORD` is a known CI wiring gap |

**Secrets to create (currently missing):** AWS SSM parameters (or Secret Manager) for every row above; a dedicated `META_APP_SECRET_2` during rotation; a Caddy/ACME contact email.

**Env surface (names only):** `.env` currently defines `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `REDIS_URL`, `WA_PERMANENT_TOKEN`, `WA_VERIFY_TOKEN`, `WEBHOOK_PORT`, `BOT_CONTROL_PORT`. `bot-control-api` additionally needs `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `WABA_ID`, `WABA_NAME`, `META_BUSINESS_ID`, `DASHBOARD_ORIGIN`, `ALERT_OFFLINE_MINUTES`. `.env.example` is stale — it documents only 3 of these.

---

## 5. Execution plan (21 days, three parallel tracks)

| Phase | Days | Track A — Meta | Track B — Infra | Track C — Product/Commercial |
|---|---|---|---|---|
| **P0** | 1–2 | Submit business verification (G1) | Snapshot EC2 + export RTDB (baseline) | Choose launch pricing + first 3 design partners |
| **P1** | 3–6 | App Review prep: record the two videos, write the permission justifications | `api.foodhubbie.in` + Caddy + close 3000/8080 (G5) | Manual invoicing sheet + receipt template |
| **P2** | 7–10 | Submit App Review + Tech Provider access verification (G2) | Backups + restore drill + uptime alerts | Blaze enabled; App Check rolled out |
| **P3** | 11–14 | Create real WABA, verify + register the real number (G4) | Secrets → SSM; rotate Firebase SA key + WhatsApp token | Merchant terms + privacy + DPA published |
| **P4** | 15–18 | Decide G3 option; if B, ship v4 migration | t3.medium sizing / Redis persistence | Billing decision: manual vs Razorpay |
| **P5** | 19–21 | First real restaurant end-to-end | Load test: 3 concurrent bots + 1k orders | Go/no-go review against §6 |

**Parallelism note:** Track A is calendar-bound by Meta review (1–5 days per submission). Track B can be finished in two working days. Track C must not wait on A — pricing and terms are owner decisions.

---

## 6. Acceptance test matrix (must all pass before "live")

1. **Tenant creation** — new outlet from Supreme; QR menu link resolves; no `outletIndex` entry for demo.
2. **QR order** — scan → cart → coupon → place → writes `Pending` then `Placed`; totals match `shared/money-math.js`.
3. **Kitchen flow** — KDS accept → ready → serve; session attaches; PII lands only in `tableSessionsContact`.
4. **Billing** — generate bill → split payment → close; void reverses analytics; `_effectiveTotal` consistent.
5. **WhatsApp meta** — order placed → template delivered; inbound customer reply routed to the right outlet; 24h-window behaviour correct.
6. **WhatsApp baileys** — provision → QR pair → greeting image → order link; promos correctly blocked.
7. **Delivery** — webview order with anon token; rider assigned → OTP → delivered; loyalty earn; cancel → clawback.
8. **Supreme control** — restart from the dashboard survives an EC2 reboot with **no URL change** (proves G5).
9. **Payment ledger** — record a payment; receipt prints; Admin Costs parity exact.
10. **Security** — disable an outlet → unauth QR write blocked 401; demo outlet cannot write outside its tenant; webhook rejects a bad signature.
11. **Disaster** — restore RTDB from backup into a scratch project and boot the menu against it.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| App Review rejected (weak videos/justification) | Medium | 1–2 week delay | Rehearse the two recordings; keep them under 2 min, show the exact permission surface |
| ES v3 silently breaks before v4 ships | **High** (deadline passed) | Path A unusable | Launch on Path B; treat Path A as beta |
| Tunnel hostname rotates mid-demo | High today | Supreme looks broken | G5 — this is the single highest-ROI fix |
| Baileys number banned | Medium | Tenant loses WhatsApp | Keep promos blocked; move paying tenants to meta transport; never bulk-send on baileys |
| RTDB data loss | Low | Catastrophic | Daily export + tested restore (P2) |
| Shared WABA limits hit (Path B) | Medium at 5+ tenants | New tenant can't onboard | Per-tenant WABA via ES v4, or a second platform WABA |
| Cost surprise (Blaze + WhatsApp per-conversation fees) | Medium | Margin erosion | Per-order billing already modelled; add a monthly cost review |

---

## 8. Decisions only the owner can make

1. **Path A or Path B at launch?** (Recommendation: B, ship A-v4 after the first paying tenant.)
2. **Who owns the WhatsApp number** — the platform or the restaurant? This decides the WABA model, the billing model, and who pays Meta.
3. **Billing**: manual invoice for the first N tenants, or build Razorpay now?
4. **Meta business details** — confirm the Udyam values above are still current before submitting.
5. **Is `foodhubbie.in` the permanent domain?** G1 and G5 both assume yes.
6. **Who holds break-glass access** to AWS, Meta Business, and Firebase? One person is a single point of failure.

---

## 9. Immediate next actions (this week)

1. Snapshot EC2 + export RTDB (30 min, reversible, no downtime).
2. Submit business verification with `https://foodhubbie.in` (15 min + Meta review).
3. Stand up `api.foodhubbie.in` with Caddy (2 h) and close ports 3000/8080.
4. Record the two App Review videos (1 h).
5. Rotate the Meta token + Firebase SA key, move to SSM (half day, do it before onboarding strangers).
6. Pick the first 3 design-partner restaurants and get their real numbers ready.

---

*Prepared from source on 2026-10-31. Re-verify every Meta console path at execution time — Meta reorganises Business settings frequently.*
