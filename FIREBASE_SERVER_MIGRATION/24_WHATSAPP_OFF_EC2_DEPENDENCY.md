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
