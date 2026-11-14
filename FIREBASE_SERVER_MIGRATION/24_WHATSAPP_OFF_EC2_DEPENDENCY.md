# 24 — If the WhatsApp feature is switched off, is EC2 still needed?

Status: **decision pending (owner).** Written 2026-11-12 during the box outage
(`23_BOX_OFFLINE_INCIDENT.md`), from the actual code, not from memory.

## 1. Short answer

**No — WhatsApp is not what keeps the box alive.** Turning WhatsApp off removes
the *socket* and ~20 endpoints, but the same box also runs four things the
Customer App and the Admin dashboard need today:

1. **order finalization for APP / webview orders** — `bot/index.js`
   `ordersRef.on('child_added' / 'child_changed')`: server-side re-pricing
   (`order-pricing.js`), discount re-validation (`discount-engine.js`), reward
   tender burn / resurrect (`redeem.js`), stock deduction + restore, customer
   profile mirror;
2. **loyalty** — earn on `paymentStatus → Paid`, clawback, tier-up;
3. **push** — `notifyCustomerApp`, `notifyTierUp`, `sendFCMToAdmins`,
   `sendFCMToRider` (app order status, rider assignment, admin order alerts);
4. **small HTTP + cron jobs** in `bot-control-api` that are not WhatsApp:
   `/tenant-api/upload` + `/tenant-api/delete-image` (Admin photo changes — the
   Storage bucket is deny-all by design), `/tenant-api/notify` (App
   Notifications), `/api/admin/outlet-admin-status` (Supreme's email-verified
   unlock gate), `/api/admin/approve-onboarding`, the 60 s wallet-gate publisher
   (`wallet-watch.js`) and the daily unverified-tenant cleanup.
   Plus the nightly demo reseed cron.

Nothing in that list needs a phone number. `shouldFinalizeWebOrder()` has no
socket dependency at all — proven live in the 2026-10-27 E2E, where web orders
were finalized while the WhatsApp socket was dead.

So: **stop WhatsApp → keep the box (or replace it). Delete the box → APP orders
are never finalized, loyalty stops, push stops, photo uploads break.**

## 2. What actually is WhatsApp-only

| on the box | WhatsApp-only? |
|---|---|
| Baileys socket / pairing / QR re-scan (`bot/session_data_*`) | yes |
| template sends, promo campaigns, opt-out, pacing, strike/freeze ban-proofing | yes |
| `/api/whatsapp/*` (accounts, numbers, templates, quota, exchange) | yes |
| `/api/bot/*` (provision, restart, rescan, stop, delete, transport) | yes |
| `whatsapp.status` / `bot.pair` driven orchestration | yes |
| Admin Chat tab, Promotions tab, WhatsApp quota card | yes (become dead UI) |
| billing plan **WhatsApp 3 %**, ₹1 promo token, ₹1,500 min top-up with WhatsApp | yes (billing simplifies to App 2 % / QR+POS 1 %) |

## 3. Options

### A. Keep the box, switch WhatsApp off (cheapest to do, no saving)
Stop + delete the pizza bot worker and the `bot.pair` node so the orchestrator
never respawns it, keep one **DB-only** worker running the order engine. Needs a
~10-line `BOT_TRANSPORT=none` guard so the worker does not spend its life
reconnecting a socket that will never pair (today it "works" with a dead socket —
that is exactly what the e2e worker does — but it logs 408s and burns CPU).
**Cost stays ~₹1,400–1,600/month** (t3.small + EBS). Removes ban risk, Meta
template maintenance, the 24 h WhatsApp window and the platform-paid Meta spend,
then leaves you paying for a box that runs four small jobs.

### B. Move the four jobs to Firebase Functions (2nd gen), delete EC2 — recommended
This is the migration track already written down; WhatsApp off makes it much
smaller because the hardest part of the bot (Baileys state machine, templates,
pacing) simply disappears.

| today | target |
|---|---|
| `ordersRef.on('child_added'/'child_changed')` in `bot/index.js` | `onValueCreated` / `onValueUpdated` RTDB triggers importing the **same** `order-pricing.js`, `discount-engine.js`, `redeem.js`, `loyalty-math.js` (already standalone CJS) |
| `notifyCustomerApp` / `sendFCMToAdmins` / `sendFCMToRider` / `notifyTierUp` | called from those triggers (same functions, moved) |
| `/tenant-api/upload`, `/delete-image`, `/notify` | one https function group (Admin SDK + verified ID token — the logic already is tenant-scoped) |
| `/api/admin/outlet-admin-status`, `/approve-onboarding` | https callable functions |
| `wallet-watch.js` 60 s loop | scheduled function `every 1 minutes` (43,200 invocations/month — inside the 2 M free tier) |
| unverified-tenant cleanup | scheduled daily function |
| demo seeder cron | scheduled weekly/daily function, or keep it on any machine |

Cost: **≈ ₹0 at current volume** (RTDB trigger invocations for ~350 orders/month;
the free tier is 2 M/month). Removes the whole failure class that just cost 13 h:
no host to die silently, no ephemeral IP, no Elastic IP, no SSH, managed uptime.
**Blaze is required** (already effectively in use).

Risk: the order-finalization path is money code — re-pricing, discount record /
release, tender burn / resurrect, stock. It must be ported with the same live
E2E discipline as batches 1b/4/5 (`order-pricing`, `stock-restore`,
`discount-release`, `loyalty`), roughly 2–3 batches. Leave the box running as a
fallback until the Functions path is proven, then delete it.

### C. Keep an always-on worker somewhere cheaper
Cloud Run with `min-instances=1` ≈ the same ₹1,200/month as t3.small, and RTDB
listeners need the container awake, so it buys nothing. A cheaper VPS is the same
work. Only worth it if Blaze/Functions is not acceptable for some reason.

## 4. Recommendation

1. **Today, regardless of the WhatsApp decision:** start the box, attach an
   **Elastic IP**, and add an external "box silent for 10 min" alert. The outage
   was invisible for 13 h — that is the actual bug.
2. **Decide WhatsApp on/off commercially first** (it also removes the 3 % plan and
   the ₹1 promo revenue line). It does not change the answer to the EC2 question.
3. **If WhatsApp goes off, do not stop at option A.** Port the order engine to
   Functions (B) and delete the box; otherwise you keep paying ~₹1,500/month and
   keep the same silent-outage risk for a worker that does four small jobs.

## 5. What I would do next (if approved)

Batch 23a: uptime alert + Elastic IP checklist (30 min, no code).
Batch 23b: extract the order-finalization path from `bot/index.js` into a module
with no socket dependency, prove it against the current worker (no behavior
change, live E2E on APP order + cancel).
Batch 23c: deploy it as v2 RTDB triggers, shadow-run them disabled, then flip and
watch one real order.
Batch 23d: move the four HTTP endpoints + two scheduled jobs, delete the box.

## 6. As built (2026-11-13): what actually moved, and why the WhatsApp routes did not

The plan above is being executed while the box is down. Status:

| batch | moved | record |
|---|---|---|
| 23a | `platformHealth` scheduled watchdog + hourly owner push | `25_PLATFORM_HEALTH_ALERT.md` |
| 23b | order finalization extracted from `bot/index.js` (socket-free) | `26_ORDER_FINALIZER_EXTRACTION.md` |
| 23c | `discount-engine-core` + two **shadow** RTDB triggers (compare only, write nothing) | `27_ORDER_FINALIZER_SHADOW_TRIGGER.md` |
| 23d-1 | `POST /tenant-api/upload`, `POST /tenant-api/delete-image` | `28_MEDIA_ENDPOINTS_ON_FUNCTIONS.md` |
| 23d-2 | `POST /tenant-api/notify` | `29_NOTIFY_ON_FUNCTIONS.md` |
| 23d-3 | `POST /api/admin/approve-onboarding`, `GET /api/admin/outlet-admin-status`, `POST /api/admin/update-password` | `30_ONBOARDING_ON_FUNCTIONS.md` |
| 23d-4 | website signup auto-approval + 72 h unverified cleanup (scheduled) | `31_ONBOARDING_WATCHER.md` |
| 23e | `sendFCMToAdmins`, `notifyCustomerApp`, `notifyTierUp` as RTDB triggers behind one kill flag | `33_PUSH_RELAY.md` |
| 23f | **the real** web/app order finalizer + cancel compensations (reward, discount usage, stock) | `34_ORDER_FINALIZER.md` |

Batch 23e (2026-11-14) finished the notification surface: **no push depends on
the box any more**. Batch 23f then gave the extracted finalizer authority, so
**no browser-written order depends on it either**: re-pricing, GST + delivery-fee
re-derivation, discount re-validation, reward burn, stock and the cancel-side
compensations all run in the cloud behind `config/orderFinalizer/enabled === true`
(one shared `finalizeClaim` lock keeps the bot from ever double-running it).
What still does depend on the box: loyalty earn/clawback (`processLoyalty`,
batch 23g), the socket-only WhatsApp surface, `wallet-watch`, rider assignment
pushes, the daily settlement and the two cron jobs (demo reseed, onboarding
fallback in `server.js`).

**Decision: the `/api/whatsapp/*` read routes (accounts, numbers, quota,
templates) stay on EC2 and are not ported in 23d.** Not a scope cut — there is
nothing to port *to* right now:

* No outlet in RTDB holds a Meta credential. A full walk of `businesses` on
  2026-11-13 found **`whatsapp` absent on every outlet** (including
  `roshani-pizza/outlets/pizza`, whose stale Meta test-number node described in
  `AGENTS.md` has since been deleted — that owner action is done, so the
  "bot-control-api reprovisions with `BOT_TRANSPORT=meta`" trap is gone), and
  root **`waAuth` is absent**.
* The only Meta token that exists is the platform-level `WA_PERMANENT_TOKEN` in
  `.env` on the box/dev machine — the one `tools/submit-wa-templates.mjs` uses.
  It is **not** per-tenant, and a per-tenant WABA is the stated tenancy model
  (`docs/PLAN-PER-TENANT-WABA.md`). Handing every tenant query the platform token
  would be both wrong and unverifiable.
* Every one of those routes therefore returns its *no-number* branch today
  (`404` / empty list). A Functions port would ship code whose only reachable
  path is the 404 it already returns from the dead box; the client side already
  tolerates it (quota card says "Sending limit not available", the promo picker
  falls back to its 5 seed options).

Live pizza runs **Baileys** (`bot.transport = 'baileys'`, `bot.pair.status =
'connected'`), so the Cloud API routes have no live user even when the box is up.
Revisit this decision when Track A onboards a real tenant WABA
(`docs/PLAN-PER-TENANT-WABA.md`) — at that point quota/templates become
tenant-facing and belong in `tenantOnboarding`'s sibling.

**What legitimately remains on the box** after 23d:

| on the box | why it cannot move yet |
|---|---|
| Baileys worker (`bot/index.js` + session data) | a socket that must stay paired; no Functions equivalent |
| `/api/whatsapp/*`, `/api/bot/*` (provision/restart/stop/delete/rescan/transport) | pm2 + Meta per-tenant credentials |
| `wallet-watch.js` | live-listener design (batch 14); a stateless per-minute function would regress it. **No outlet is armed today**, so nothing breaks while it is down |
| daily settlement, nightly demo reseed | cron jobs; both tolerate a missed run |
| `/api/images/convert-batch` | `sharp`; already **non-fatal** in the onboarding wizard ("failures just mean status updates will use URL fallback") |

Two smaller confirmations from the same probe: the pizza outlet still carries two
junk child nodes (`pizza`, `undefined`) left by an old write, and its three
`pushSubscriptions` entries are the only token-like strings under `businesses`.
Neither is touched here.
