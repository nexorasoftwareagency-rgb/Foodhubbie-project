# BACKEND ARCHITECTURE — EC2 retained, deliberately scoped

**Status:** design approved 2026-11-17. Supersedes `PLAN/EC2-RETIREMENT-PLAN.md`,
`PLAN/FUNCTION-SPECS.md`, `PLAN/RTDB-PATH-MAPPING.md`, `PLAN/TEST-SUITE.md`.

**Audience:** (1) the owner deciding, (2) the engineer provisioning the new box,
(3) the next agent debugging at 2 a.m. Section 5 is the executable runbook;
sections 3 and 9 are the ones to read before touching anything.

---

## 0. How to use this document

| If you want to... | Read |
|---|---|
| understand *why* the box still exists | 1 |
| know who owns a capability | 3.2 |
| know who writes a database path | 3.3 |
| build a new server from zero | 5 |
| deploy code | 6 |
| find out why something broke | 8 |
| delete the leftover migration scaffolding | 9 |
| know what happens next, in order | 10 |
| argue about cost | 11 |

Anything in this document that contradicts a `FIREBASE_SERVER_MIGRATION/` batch
doc is a deliberate change of direction and is recorded in section 1.4.

---

## 1. Decision

### 1.1 What changed

The 2026-11 plan was to retire EC2 entirely and run the whole backend on Cloud
Functions. That goal is **dropped**. The box is retained permanently.

It is **not** retained as the primary backend. It is retained as a single-purpose
host for the one thing that cannot be done serverlessly at acceptable cost: a
long-lived WhatsApp socket.

### 1.2 The boundary rule

> **EC2 owns the WhatsApp transport. Cloud Functions own every database effect.**

Two corollaries, both enforceable in review:

1. **No cloud code whose only job is to tell EC2 to send a WhatsApp message.**
   If a cloud function exists to make the box speak, it is in the wrong place.
   The box already holds the socket; it can watch the database itself for free.
2. **No EC2 code that writes money, loyalty, stock, payment or push state.**
   Those writes must survive the box being dead. If a line of bot code mutates
   one of those, it belongs in a trigger.

Everything else follows mechanically from those two sentences.

### 1.3 Why this shape (and not the two obvious alternatives)

**Alternative A — retire EC2, move the socket to the official Meta WhatsApp
Business API.** Rejected on cost and on tenancy. Per the 2026-11-01 decision the
platform pays Meta usage and each restaurant owns its own WABA, so per-message
charges land on us. At Meta's India rate card (`shared/meta-cost-math.js`,
₹0.86–1.15 per billable message) a single active outlet sending ~5,000
service messages/month costs roughly ₹500/month after the 1,000 free tier; three
to four active outlets exceed the entire EC2 bill. It also requires per-tenant
WABA onboarding, template approval for every message shape, and 24-hour window
bookkeeping. The socket does all of that for a flat fee.

**Alternative B — keep the box as-is, everything on it.** Rejected because the
2026-11-11 outage proved the failure mode: with the box down, delivered orders
earned no loyalty points, cancelled orders kept them, burned reward codes were
never returned, stock never moved, riders were never told, and app notifications
went silent. Every one of those is a pure database effect that has no business
depending on a single VM's uptime.

**What was actually built (2026-11-12 → 2026-11-16, batches 23a–23l)** is
Alternative C: move every database effect to Functions, leave only the socket.
That work is done and live.

### 1.4 The empirical argument

The box has been **down since 2026-11-11 20:03 IST** — six days at the time of
writing. During that window, on live production:

- browser (APP/webview) orders were re-priced from the catalog, re-taxed,
  discount-revalidated, reward-burned, stock-deducted and mirrored to the
  customer (batch 23f, flag `orderFinalizer`);
- delivered orders earned points, cancellations clawed them back, dine-in bills
  credited on payment, and app rewards redeemed with no OTP (batch 23g,
  `loyaltyRelay`);
- order, customer and tier-up pushes were sent (23e, `pushRelay`);
- rider assignment / ready / cancelled pushes were sent (23h, `riderRelay`);
- the nightly rider settlement ran (23i) and the demo tenant reseeded (23j);
- website signups were auto-approved and 72 h-unverified tenants cleaned up
  (23d-4, `onboardingWatcher`);
- media uploads and app notifications worked (23d-1/2);
- the wallet gate kept publishing (23l) and `balancePaise` kept refreshing
  (cloud `metaCostPublisher`).

What stopped is exactly the socket: no WhatsApp replies, no promo campaigns, no
daily WhatsApp reports, no WhatsApp "NEW ORDER" text, no customer status
messages, no `rider_assigned` template.

That is the split working as designed, proven by an unplanned six-day load test
rather than by a diagram.

### 1.5 Consequences you must accept

- The box is a **single point of failure for WhatsApp conversation only**. That
  is now a documented, bounded blast radius (section 8, F1).
- The box is **disposable**. Everything it needs is in git plus three runtime
  files (section 4.6). It can be rebuilt in about 90 minutes from section 5.
- The box is **not** a money path. If it dies mid-order, the money is still
  correct.

---

## 2. Current state (verified 2026-11-17)

### 2.1 Deployed Cloud Functions — 34 v2, us-central1, nodejs22

Keep 23:

```
whatsappWebhook              https           Meta inbound ingress (signature-verified)
tenantMedia                  https           POST /tenant-api/upload, /delete-image
tenantNotify                 https           POST /tenant-api/notify
tenantOnboarding             https           approve-onboarding, outlet-admin-status, update-password
onWebOrderPlaced             rtdb create     orders/{orderId}
onOrderCancelledCompensate   rtdb write      orders/{orderId}/status
onOrderLoyaltyStatus         rtdb write      orders/{orderId}/status
onOrderLoyaltyPayment        rtdb write      orders/{orderId}/paymentStatus
onOrderPushAdmin             rtdb create     orders/{orderId}
onOrderPushCustomer          rtdb write      orders/{orderId}/status
onLoyaltyTierUp              rtdb write      customers/{phone}/loyalty
onRedeemRequest              rtdb create     bot/redeemQueue/{reqId}
onRiderAssigned              rtdb write      orders/{orderId}/riderId
onRiderStatus                rtdb write      orders/{orderId}/status
onOrderBillingChange         rtdb write      orders/{orderId}
onWalletLedgerChange         rtdb write      walletBilling/{bid}/{oid}
onWalletGateTouched          rtdb write      outlets/{oid}/walletGate
walletGateReconcile          schedule        hourly, :07 Asia/Kolkata
metaCostPublisher            schedule        every 15 min
platformHealth               schedule        out-of-band liveness alert
onboardingWatcher            schedule        every 2 min
dailySettlement              schedule        23:00 Asia/Kolkata
demoReseed                   schedule        03:00 Asia/Kolkata
```

Delete 11 (section 9.4 has the exact command):

```
botControl                   callable   dead - writes restartRequested, nothing reads it
transportSwitch              callable   dead - zero client callers
qrMenuOrder                  https      dead - superseded by the menu writing orders directly
qrMenuPayment                https      dead - same
getWhatsAppQuota             callable   dead - Supreme reads the EC2 route
onboardingApprove            https      dead - predates hardening, superseded by tenantOnboarding
onOrderStatusChange          rtdb       redundant - stamps placedAt/confirmedAt nobody reads
onWebOrderPlacedShadow       rtdb       redundant - migration scaffolding, nothing reads migrationShadow
onWebOrderFinalizedShadow    rtdb       redundant - same
processInboundMessage        taskqueue  WRONG - see 2.2
sendOutboundMessage          taskqueue  WRONG - see 2.2
```

`metaCostPublisher` is deliberately **not** in that list: the cloud copy is the
single `balancePaise` writer (the EC2 copy is what gets deleted, section 9.3).

Delete 4 that exist in source but were **never deployed** (section 9.1):

```
onWebhookInboxMessage  triggers/webhookInbox.ts      DANGEROUS if ever deployed
onOrderStatusAlert     triggers/orderStatusAlert.ts  WhatsApp-only, wrong side of the rule
promoScheduler         scheduled/promoScheduler.ts   WhatsApp-only, wrong side of the rule
dailyReports           scheduled/dailyReports.ts     WhatsApp-only, wrong side of the rule
```

### 2.2 Why `processInboundMessage` / `sendOutboundMessage` must never ship

These two were the original plan's answer to "run the bot without a socket". They
are not a partial implementation of the real bot; they are a different, wrong
program:

| | real bot (`bot/index.js`) | `processInboundMessage` |
|---|---|---|
| price source | catalog + `bot/order-pricing.js` | cart lines priced at `price: 0` |
| order source tag | `WA` handled by the bot's own flow | writes `source:'WA'` |
| finalizer | `bot/order-finalizer.js` (`WEB_ORDER_SOURCES = ['webview_delivery','APP']`) | **ignored by the finalizer**, so never re-priced |
| cart machine | the real state machine (`AWAITING`, `WEBVIEW`, `START`, …) | invented, does not exist |
| opt-out path | `businesses/{bid}/outlets/{oid}/bot/promotions/optout/{last10}` | root `bot/promotions/optout/{phone}/{oid}` |
| transport | Baileys socket | `taskQueue` -> `foodhubbie-prod` fallback, no queues exist, no OIDC token |

Shipping them would create a second, silently-broken ordering path that writes
orders the money pipeline deliberately skips. They are deleted, not fixed.

`webhookInbox.ts` is worse: it **deletes inbox entries after enqueueing a task**.
If it were deployed while the bot is running, it would race the bot's own
`child_added` drain and silently steal inbound messages. It must be deleted
before anyone runs `firebase deploy --only functions`.

### 2.3 EC2 process inventory (last known good state, 2026-11-11)

pm2 apps:

| app | script | notes |
|---|---|---|
| `bot-roshani-pizza-pizza` | `bot/index.js` | from `ecosystem.config.js`, `OUTLET=pizza`, `BUSINESS_ID=roshani-pizza` |
| `bot-control-api` | `bot-control-api/server.js` | started manually, not in `ecosystem.config.js` |
| `bot-{bid}-{oid}` | `bot/index.js` | spawned by the orchestrator for outlets with `whatsapp.status === 'active'` |

The control-api process hosts **four** subsystems in one Node process: the HTTP
API, the pm2 orchestrator (`startOrchestrator`), the status watcher
(`startStatusWatcher`), and (until section 9.3) the meta cost publisher.

Listeners bound:

| port | process | exposure |
|---|---|---|
| 4000 | `bot-control-api` (`BOT_CONTROL_PORT`) | must be loopback-only behind Caddy |
| 3001+ | each bot (`HEALTH_PORT`, `GET /health`) | **binds `0.0.0.0`** - security group must not open 3000-3100 |
| 5000 | `webhook-server` (`WEBHOOK_PORT`) | deleted in M3 |

### 2.4 EC2 route table — 25 routes, keep 19

Keep (all `/api/bot/*` and `/api/whatsapp/*`):

```
GET  /api/bot/status/:bid/:oid
GET  /api/bot/status-all
POST /api/bot/restart/:bid/:oid        requireSuperOnly
POST /api/bot/transport/:bid/:oid      requireSuperOnly
POST /api/bot/rescan/:bid/:oid         requireSuperOnly
POST /api/bot/stop/:bid/:oid           requireSuperOnly
POST /api/bot/provision/:bid/:oid      requireSuperOnly
POST /api/bot/delete/:bid/:oid         requireSuperOnly
GET  /api/whatsapp/accounts/:bid/:oid
GET  /api/whatsapp/numbers/:bid/:oid
POST /api/whatsapp/numbers/:bid/:oid                    requireSuperOnly
POST /api/whatsapp/numbers/:bid/:oid/:pnid/request-code  requireSuperOnly
POST /api/whatsapp/numbers/:bid/:oid/:pnid/verify-code   requireSuperOnly
POST /api/whatsapp/numbers/:bid/:oid/:pnid/register      requireSuperOnly
POST /api/whatsapp/numbers/:bid/:oid/:pnid/deregister    requireSuperOnly
POST /api/whatsapp/exchange            requireSuperOnly
GET  /api/whatsapp/quota/:bid/:oid
GET  /api/whatsapp/templates/:bid/:oid
POST /api/whatsapp/templates/:bid/:oid requireSuperOnly
```

Delete (moved to `tenantOnboarding` / `tenantMedia` / `tenantNotify`):

```
POST /api/admin/update-password
POST /api/admin/approve-onboarding
GET  /api/admin/outlet-admin-status
POST /tenant-api/upload
POST /tenant-api/delete-image
POST /tenant-api/notify
```

The `/api/whatsapp/*` family is the **one deliberate non-socket exception** on
the box. It is the provisioning control plane for the socket host itself: it
shares the host's Meta env secrets, it talks to the Graph API on behalf of the
WABA that this box will run, and moving it to Functions would mean duplicating
`META_SYSTEM_USER_TOKEN` into a second runtime for no benefit. Documented here
so it does not look like drift later.

### 2.5 Bot listeners — 7, and what each is after the migration

| # | listener | purpose | after M2 |
|---|---|---|---|
| 1 | `bot/commands` `child_added` | admin chat replies, promo commands, restarts | stays (socket work) |
| 2 | `orders` `child_changed` | status notifications, `rider_assigned`, finalization fallback, compensation | shrinks to socket-only |
| 3 | `orders` `child_added` | new-order WhatsApp alert, missed-order catch-up | shrinks to socket-only |
| 4 | `blocklist` `value` | hot-reload the blocked-number set | stays (socket work) |
| 5 | `orders` `child_added` (FCM watcher) | admin FCM alert | **redundant** while `pushRelay` is on |
| 6 | `orders` `child_changed` (FCM watcher) | rider FCM | **redundant** while `riderRelay` is on |
| 7 | `bot/redeemQueue` `child_added` | reward redemption | **redundant** while `loyaltyRelay` is on |

Four listeners on `orders` is pure egress overhead. Listener 5/6 are registered
unconditionally at connect time even though both relays are ON, so they wake on
every order write and immediately return. Section 9.5 gates them.

### 2.6 Live config flags (RTDB `/config`, 2026-11-17)

```json
{
  "adminUrl":   "https://us-central1-foodhubbie-10.cloudfunctions.net/tenantOnboarding",
  "mediaUrl":   "https://us-central1-foodhubbie-10.cloudfunctions.net/tenantMedia",
  "notifyUrl":  "https://us-central1-foodhubbie-10.cloudfunctions.net/tenantNotify",
  "tunnelUrl":  "https://api.foodhubbie.in",
  "pushRelay":       { "enabled": true, "by": "batch-23e" },
  "orderFinalizer":  { "enabled": true, "by": "batch-23f" },
  "loyaltyRelay":    { "enabled": true, "by": "batch-23g" },
  "riderRelay":      { "enabled": true, "by": "batch-23h" }
}
```

Absent flags mean OFF, not ON. Every relay resolves to "the bot does it" unless
the value is literally `true`. That is deliberate: a failed read can never cause
double sends.

### 2.7 The box itself

| fact | value |
|---|---|
| instance | `i-0c7f49065b1581542`, ap-south-1, public IP `3.111.39.210` (ephemeral) |
| state | stopped since 2026-11-11 20:03 IST |
| DNS | `api.foodhubbie.in` is a plain GoDaddy **A record** to that IP, no proxy |
| TLS | **no nginx/caddy** on the old box (recorded 2026-11-01); the API listened on `*:4000` |
| node | v22.23.4 (`require(esm)` needs >= 22.12) |
| branch | `server`, full tree, never `git clean`ed |

Two facts here are the reason section 5 exists in this much detail:

1. The IP is ephemeral. A stop/start changes it, which silently breaks
   `api.foodhubbie.in`, `platformHealth`'s probe, and seven CSP `connect-src`
   entries. **An Elastic IP is mandatory**, not an optimisation.
2. There is no evidence a TLS proxy ever existed, yet `platformHealth` requires
   `GET https://api.foodhubbie.in/api/bot/status-all` to answer 401. Either the
   probe was failing for months or something undocumented fronted it. Treat
   Caddy as a build requirement with an explicit gate (Phase 9, gates 13-14), not as an
   assumption.

---

## 3. Target architecture

### 3.1 Diagram

```
                            Meta / WhatsApp
                                   |
              +--------------------+--------------------+
              |                                         |
     [ Baileys socket ]                     [ Meta Cloud API webhook ]
              |                                         |
              |                              POST /whatsappWebhook  (Function)
              |                                         |
              |                              businesses/{bid}/outlets/{oid}/webhookInbox
              |                                         |
              |                              drained by bot/transport.js (child_added)
              |                                         |
              +----------------->  bot/index.js  <-------+
                                        |
        +-------------------------------+-------------------------------+
        |                               |                               |
   WhatsApp sends                RTDB reads/writes              pm2 / health
   (the only thing               (socket work only)            (status-watcher)
    only EC2 can do)                      |
                                          v
                                   Firebase RTDB
                                          |
        +-------------------+-------------+-------------+-------------------+
        |                   |                           |                   |
  orderFinalizer      loyaltyRelay                 pushRelay          walletGate
  (money/stock)       (points/rewards)             (FCM)              (order stop)
        |                   |                           |                   |
        +-------------------+-------------+-------------+-------------------+
                                          |
                                  Cloud Functions
                                          |
                       +------------------+------------------+
                       |                  |                  |
                tenantMedia        tenantOnboarding     tenantNotify
                (uploads)          (approve/password)   (app push)
```

Read it as: the box sits at the **edge** of the system, not in the middle. It
converts a socket into database events. Everything downstream of the database is
serverless.

### 3.2 Responsibility matrix

| Capability | Owner | Trigger / entry | If EC2 is down | If Functions are down |
|---|---|---|---|---|
| WhatsApp inbound (Baileys) | EC2 | socket event | no replies | unaffected |
| WhatsApp outbound (Baileys) | EC2 | any | nothing is sent | unaffected |
| WhatsApp inbound (Meta transport) | Function -> RTDB -> EC2 | `whatsappWebhook` | inbox grows, drains on boot | Meta retries then drops |
| WhatsApp Graph provisioning | EC2 | `/api/whatsapp/*` | cannot add/verify numbers | unaffected |
| pm2 process control | EC2 | `/api/bot/*` | cannot restart a worker | unaffected |
| Bot liveness status | EC2 | `status-watcher`, 30 s | frozen at last value | unaffected |
| Web/app order finalization | Function | `onWebOrderPlaced` | **works** | order stays `Placed`, unverified |
| Cancel compensation | Function | `onOrderCancelledCompensate` | **works** | stock/reward not restored |
| Loyalty earn / clawback | Function | `onOrderLoyaltyStatus`, `onOrderLoyaltyPayment` | **works** | no points |
| Reward redemption | Function | `onRedeemRequest` | **works** | request queues |
| Order / customer / tier push | Function | `onOrderPushAdmin`, `onOrderPushCustomer`, `onLoyaltyTierUp` | **works** | no push |
| Rider push | Function | `onRiderAssigned`, `onRiderStatus` | **works** | no rider alert |
| Wallet gate publish | Function | `onOrderBillingChange`, `onWalletLedgerChange`, `onWalletGateTouched`, hourly reconcile | **works** | gate stale <= 1 h |
| Meta wallet balance | Function | `metaCostPublisher`, 15 min | **works** | balance stale |
| Media upload / delete | Function | `tenantMedia` | **works** | uploads fail |
| App notifications | Function | `tenantNotify` | **works** | sends fail |
| Onboarding approve / password | Function | `tenantOnboarding` | **works** | Supreme blocked |
| Signup auto-approve + cleanup | Function | `onboardingWatcher`, 2 min | **works** | signups stall |
| Daily rider settlement | Function | `dailySettlement`, 23:00 IST | **works** | no settlement row |
| Demo reseed | Function | `demoReseed`, 03:00 IST | **works** | demo goes stale |
| Out-of-band health alert | Function | `platformHealth` | detects the outage | no alert |
| WhatsApp promo campaigns | EC2 | `bot/commands` + scheduler | **blocked** | unaffected |
| Daily WhatsApp reports | EC2 | `reportInterval` | **no reports** | unaffected |
| Admin chat reply | EC2 | `bot/commands` | queues | unaffected |
| WhatsApp "NEW ORDER" alert | EC2 | order listener | **none** | unaffected |
| Customer status message + OTP | EC2 | order listener | **none** | unaffected |
| `rider_assigned` template | EC2 | order listener | **none** | unaffected |
| QR discount verification (M2) | Function | order create, `source:QR` | **works after M2** | skipped |
| Customer payment mirror (M2) | Function | order status leaf | **works after M2** | stale |

Everything in the "If EC2 is down" column that says **works** is the return on
the 23a-23l work. Everything that says none/blocked is a WhatsApp message, which
is the only thing a socket can produce.

### 3.3 Data ownership — one writer per path

This table is the anti-duplication contract. If two components write the same
path, one of them is a bug.

| RTDB path | sole writer | readers |
|---|---|---|
| `orders/{id}` money fields (`subtotal`, `tax*`, `total`, `discount*`, `deliveryFee`) | `onWebOrderPlaced` (Functions) | Admin, bot, invoices |
| `orders/{id}/status`, `paymentStatus` | Admin UI, rider app, bot (chat flow) | everything |
| `orders/{id}/finalizeClaim`, `stockDeducted`, `inventoryDeducted`, `discountUsageRecorded`, `discountUsageReversed`, `stockRestored` | `orderFinalizer` (Functions) | finalizer, compensator |
| `orders/{id}/_fcmSent` | `onOrderPushAdmin` | push relay |
| `orders/{id}/_adminWaNotified` | bot (`alertAdminFinalizedWebOrder`) | bot |
| `customers/{phone}/loyalty` | `loyaltyRelay` (Functions) | Admin, app |
| `loyalty/accruals`, `loyalty/clawbacks`, `loyalty/rankings` | `loyaltyRelay` | Admin |
| `bot/redeemQueue/{key}` -> `rewards/{code}` | `onRedeemRequest` | app |
| `bot/redeemClaims/{key}` | bot + Functions (shared claim tx) | both |
| `pushInbox/{phone}` | `pushRelay` + `tenantNotify` | app |
| `notifyLog` | `tenantNotify` | Admin (read-only) |
| `walletBilling/{bid}/{oid}/balancePaise` | `metaCostPublisher` (Functions) | Admin, Supreme, bot cost guard |
| `walletBilling/{bid}/{oid}/metaUsage` | bot `recordMetaCost` (EC2) | publisher |
| `walletBilling/{bid}/{oid}/payments`, `charges` | Supreme (client, super-only rules) | Admin, Supreme |
| `meta/walletWatch/{bid}/{oid}` | `walletGate` (Functions) | reconcile |
| `outlets/{oid}/walletGate` | `walletGate` (Functions) - the **only** writer | menu, app, bot |
| `outlets/{oid}/botStatus` | `status-watcher` (EC2) | Admin, `platformHealth` |
| `outlets/{oid}/bot/pair`, `bot/status` | bot (EC2) | Admin chat tab |
| `outlets/{oid}/bot/promotions/*` | bot (EC2) | Admin |
| `outlets/{oid}/chats`, `chatMeta` | bot `chat-log.js` (EC2) | Admin chat |
| `meta/dailySettlementLastRun`, `meta/dailySettlement/last` | `dailySettlement` (Functions) | ops |
| `meta/demoReseed/last` | `demoReseed` (Functions) | ops |
| `meta/onboardingAuto/**` | `onboardingWatcher` (Functions) | ops |
| `onboardingRequests/{id}` | website signup (client) + `tenantOnboarding`/`onboardingWatcher` | Supreme |
| `webhookInbox/{pushId}` | `whatsappWebhook` (write) / bot (delete) | bot |
| `outletIndex/{oid}` | `tenantOnboarding`, `onboardingWatcher` | everyone |

Note the two intentional split-writers: `bot/redeemClaims` (a shared transaction
claim so a flag flip cannot double-spend) and `webhookInbox` (a queue: producer
and consumer are different processes by definition).

### 3.4 The relay flags and exactly-once

Four flags decide who does the work. All are ON today.

| flag | cloud side | bot side |
|---|---|---|
| `config/pushRelay` | `onOrderPushAdmin`, `onOrderPushCustomer`, `onLoyaltyTierUp` | `sendFCMToAdmins`, `notifyCustomerApp`, `notifyTierUp` early-return |
| `config/orderFinalizer` | `onWebOrderPlaced`, `onOrderCancelledCompensate` | finalize + both compensations skipped |
| `config/loyaltyRelay` | `onOrderLoyaltyStatus`, `onOrderLoyaltyPayment`, `onRedeemRequest` | `processLoyalty` + redeem listener skipped |
| `config/riderRelay` | `onRiderAssigned`, `onRiderStatus` | inline rider FCM branch skipped |

Semantics that must not be changed:

- **Only `true` enables either side.** Absent, `false`, or a failed read leaves
  the bot in charge and the triggers inert. This is why a network blip cannot
  cause a double send.
- **Dedupe is a database claim, not a promise.** `_fcmSent`, `finalizeClaim`,
  `stockDeducted`, `stockRestored`, `discountUsageRecorded`,
  `discountUsageReversed`, `_riderFcm/*`, `bot/redeemClaims/*`, and the
  `{orderId}_{status}` inbox key. A duplicate invocation loses the claim and
  exits; a crash loses at most one send.
- **The bot caches the flag for 30 s** (`isOrderFinalizerRelayEnabled`,
  `isLoyaltyRelayEnabled`, `isRiderRelayEnabled`); `isPushRelayEnabled` reads
  fresh. Flipping a flag OFF therefore takes up to 30 s to reach the bot, and
  flipping it back ON requires no restart.
- **Except** the FCM watcher listeners, which are registered at connect time.
  Gating them (9.5) makes that explicit: after M3, flipping `pushRelay` off
  requires a bot restart.

### 3.5 What stays on EC2, and the reason each one is there

| stays | reason |
|---|---|
| `bot/index.js` socket + handler | a Baileys socket is a stateful long-lived connection; Cloud Functions are request-scoped |
| `bot/transport.js` | speaks Baileys, drains `webhookInbox` for the Meta path |
| `bot/promotions.js` | pacing (4-8 s per chat), quiet hours, opt-out, freeze - all socket-shaped; campaigns are the top ban trigger and need to be slowed, which a per-invocation runtime cannot do |
| `bot/reports.js` + `reportInterval` | sends WhatsApp messages on a schedule |
| `bot/utils.js` send wrappers | `paceOutboundTo`, strike/freeze, template fallback |
| `bot/chat-log.js` | writes the chat mirror from its own send/receive snapshot |
| `bot-control-api/server.js` `/api/bot/*` | pm2 control - only the host running pm2 can do this |
| `bot-control-api/orchestrator.js` | starts/stops pm2 workers |
| `bot-control-api/status-watcher.js` | reads pm2 state to write `botStatus` |
| `bot-control-api/whatsapp-graph.js` + `/api/whatsapp/*` | provisioning control plane, shares the host's Meta secrets |

### 3.6 What leaves EC2, and why it was there

| leaves | moved to | batch |
|---|---|---|
| order finalization | `onWebOrderPlaced` | 23f |
| cancel compensation | `onOrderCancelledCompensate` | 23f |
| loyalty earn / clawback / dine-in settle | `onOrderLoyaltyStatus`, `onOrderLoyaltyPayment` | 23g |
| reward redemption | `onRedeemRequest` | 23g |
| order / customer / tier push | `pushRelay` | 23e |
| rider push | `riderRelay` | 23h |
| media upload / delete | `tenantMedia` | 23d-1 |
| app notifications | `tenantNotify` | 23d-2 |
| onboarding approve / status / password | `tenantOnboarding` | 23d-3 |
| signup auto-approve + 72 h cleanup | `onboardingWatcher` | 23d-4 |
| daily settlement | `dailySettlement` | 23i |
| demo reseed | `demoReseed` | 23j |
| wallet gate | `walletGate*` | 23l |
| Meta wallet balance | `metaCostPublisher` (cloud) | 23l |
| QR discount verification | *pending M2* | - |
| customer payment mirror | *pending M2* | - |

---

## 4. EC2 design

### 4.1 Process topology

```
pm2
 |- bot-control-api           :4000  (loopback)   API + orchestrator + status-watcher
 |- bot-roshani-pizza-pizza   :3001  (loopback)   the live socket worker
 |- bot-{bid}-{oid}           :300N  (loopback)   one per orchestrator-provisioned outlet
`- (nothing else)
```

Three rules:

1. **One pm2 daemon per user.** The 2026-10-27 audit found a two-month-old
   worker under `/root/.pm2` that `ubuntu`'s pm2 could not see. Never start pm2
   with `sudo`.
2. **No process that is not in the diagram.** If a script does not own a socket
   or the pm2 API, it is in the wrong place.
3. **`bot-control-api` must be a pm2 app, not a `nohup`.** Today it is started
   manually, which means `pm2 save` after a manual start is the only thing that
   survives a reboot - and a missed `pm2 save` silently loses the API.

### 4.2 Sizing

| outlets | instance | why |
|---|---|---|
| 1-3 | `t3.small` (2 vCPU burst, 2 GB) | one bot ~350-500 MB, API ~120 MB, OS ~300 MB |
| 4-15 | `t3.medium` (2 vCPU, 4 GB) | ~350-500 MB per bot + headroom for a memory spike |
| > 15 | split by outlet group across boxes | one pm2 daemon is a single failure domain |

Hard requirements regardless of size:

- **30 GB gp3** (node_modules for `bot` + `bot-control-api` is ~400 MB; sessions
  and logs are small; a 2 GB swap file is prudent on `t3.small`).
- `max_memory_restart: '600M'` per bot is already in `ecosystem.config.js`.
  Do not raise it without measuring: the box has 2-4 GB total.

`t4g.small` (Graviton) is ~30 % cheaper and Baileys is pure JS, so it is viable -
but `bot/node_modules` must be rebuilt on the box (no `sharp` any more since
batch 23k, so there is no native dependency that would block it). Treat it as a
cost option to validate, not the default.

### 4.3 Networking

| item | value |
|---|---|
| region | `ap-south-1` (Mumbai) - matches the old box and the user base |
| Elastic IP | **mandatory**, allocated and associated. This is the fix for the stop/start DNS break |
| DNS | `api.foodhubbie.in` A record -> the Elastic IP (GoDaddy) |
| inbound 22 | owner IP only |
| inbound 80 | `0.0.0.0/0` (ACME HTTP-01 + redirect) |
| inbound 443 | `0.0.0.0/0` |
| inbound 3000-3100 | **never**. `healthSrv.listen(HEALTH_PORT)` binds `0.0.0.0` |
| inbound 4000 | **never**. Caddy reaches it over loopback |
| outbound | unrestricted (Meta Graph, Firebase, npm) |

`app.listen(PORT)` in `server.js` binds all interfaces. The security group is
currently the only gate. Section 9.5 changes it to `127.0.0.1`; until then the
group is load-bearing.

### 4.4 Secrets and identity

Three runtime files, all `chmod 600`, all owned by `ubuntu`:

| file | contents | recovery |
|---|---|---|
| `/var/www/foodhubbie/.env` | process env (appendix A) | re-issue from the owner's secret store |
| `/var/www/foodhubbie/bot/service-account.json` | Firebase Admin SDK credentials | generate a new key in the Firebase console |
| `/var/www/foodhubbie/bot/session_data_pizza/` | Baileys credentials (the pairing) | copy from a snapshot, or re-pair by QR |

`bot-control-api/server.js` initialises with
`admin.credential.applicationDefault()`, so `GOOGLE_APPLICATION_CREDENTIALS`
must point at the service account JSON. On the old box this worked because the
variable was set in the environment; on a fresh box it will not be. This is the
single most common way a fresh install half-works (the API starts, then every
Firebase call fails).

**Service account scope.** Do not reuse the default compute service account.
Create a dedicated one with only: Firebase Realtime Database Admin, Storage
Object Admin, Firebase Authentication Admin. The bot writes `walletBilling`,
`meta/*` and `outlets/*`, so database admin is genuinely required - but
project-owner is not.

**Never in the database, never in a client bundle:**
`WA_PERMANENT_TOKEN`, `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`,
`SLACK_ALERT_WEBHOOK_URL`.

### 4.5 pm2 policy

```
pm2 start ecosystem.config.js          # bot(s)
pm2 start bot-control-api/server.js --name bot-control-api
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu   # prints one command; run it
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

- `exp_backoff_restart_delay: 500` on the bot is intentional: a persistent
  startup failure must not hot-loop. The bot also has `[FATAL]`
  exit-on-uncaught-exception handlers.
- `pm2 save` after **every** manual `pm2 start` / `pm2 delete`. A box that
  reboots into an empty pm2 list is the classic post-provision failure.
- Never `pm2 start` a worker by hand to "test something" and leave it running -
  the orchestrator will not know about it and `status-watcher` will report it as
  an outlet that has no `whatsapp` node.

### 4.6 What must survive a rebuild

Only three things. Everything else is git.

1. `.env`
2. `bot/service-account.json`
3. `bot/session_data_<OUTLET>/` (or a fresh QR pairing)

Never run `git clean`. On 2026-11-08 `git sparse-checkout init --cone` deleted
`bot/node_modules`, `bot-control-api/node_modules`, `service-account.json` and
every `session_data_*` on the live box. See `docs/PLAN-SERVER-BRANCH.md`.

---

## 5. Provisioning runbook — from zero

Target: a working box in ~90 minutes, with 24 verification gates.

**If you are provisioning before M3 lands**, three steps differ and are marked
`PRE-M3`. After M3 the runbook is exactly as written.

### Phase 0 — inputs you need before touching AWS

| input | who has it | why |
|---|---|---|
| AWS account access (or an instance + SSH key) | owner | create/associate the Elastic IP |
| GoDaddy DNS access for `foodhubbie.in` | owner | repoint `api.foodhubbie.in` |
| the pizza WhatsApp phone (`917485095436`) | owner/staff | QR pairing needs the physical phone |
| Firebase service account JSON | owner | or generate a new key |
| Meta system-user token + app id/secret | owner | `/api/whatsapp/*` and the Meta transport path |
| Slack webhook URL | owner | offline alerts |

Do not start until all six are in hand. Phase 6 blocks on input 3 (the phone),
Phase 7 on input 4 (the service account), Phase 8 on input 2 (DNS access).

### Phase 1 — instance

1. EC2 -> Launch instance, `ap-south-1`, Ubuntu Server 24.04 LTS, x86_64.
2. Type per 4.2. Storage 30 GB gp3.
3. Security group: 22 (your IP), 80, 443. Nothing else.
4. Launch, then **allocate an Elastic IP and associate it**. Do this before DNS.
5. Note the Elastic IP. Everything downstream uses it.

```bash
ssh -i <key>.pem ubuntu@<elastic-ip>
```

### Phase 2 — OS baseline

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw fail2ban ca-certificates gnupg
sudo timedatectl set-timezone Asia/Kolkata

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Timezone is cosmetic: every business-day decision in the codebase computes IST
explicitly (`getISTDateInfo`, `+19800000`). It only makes `pm2 logs` readable.

Add swap on `t3.small`:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Phase 3 — Node 22 and pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v          # MUST be >= 22.12 - shared/*.js is ESM required from CJS
sudo npm i -g pm2
pm2 -v
```

Node < 22.12 fails at `require('../../shared/discount-rules.js')` with
`ERR_REQUIRE_ESM`, and the bot will start and then throw on the first order.
The old box was upgraded to v22.23.4 for exactly this reason.

### Phase 4 — repository

The path is hardcoded in `tools/server-deploy.sh` (`REPO=/var/www/foodhubbie`).
Use it.

```bash
sudo mkdir -p /var/www && sudo chown ubuntu:ubuntu /var/www
git clone https://github.com/nexorasoftwareagency-rgb/Foodhubbie-project.git /var/www/foodhubbie
cd /var/www/foodhubbie
git checkout -B server origin/server
npm ci --prefix bot
npm ci --prefix bot-control-api
```

`webhook-server` is not installed: it is deleted in M3. `PRE-M3` install it too
(`npm ci --prefix webhook-server`) because `server-deploy.sh` still requires the
path.

The box tracks `server`, and `server` is always an ancestor of `main`. Server
changes are committed on `server`; frontend changes stay on `main`. Guard:
`node tools/check-server-branch.cjs`.

### Phase 5 — secrets

```bash
cd /var/www/foodhubbie
install -m 600 /dev/null .env
nano .env          # contents in appendix A
install -m 600 /path/to/service-account.json bot/service-account.json
```

Required in `.env` for the target state:

```
NODE_ENV=production
OUTLET=pizza
BUSINESS_ID=roshani-pizza
FIREBASE_DATABASE_URL=https://foodhubbie-10-default-rtdb.firebaseio.com
GOOGLE_APPLICATION_CREDENTIALS=/var/www/foodhubbie/bot/service-account.json
BOT_CONTROL_PORT=4000
BOT_TRANSPORT=baileys
DASHBOARD_ORIGIN=https://app.foodhubbie.in,https://supreme.foodhubbie.in
MENU_WEB_ORIGIN=https://menu.foodhubbie.in
SLACK_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
BAILEYS_LOG_LEVEL=warn
WA_PERMANENT_TOKEN=...
META_APP_ID=...
META_APP_SECRET=...
META_SYSTEM_USER_TOKEN=...
```

`BUSINESS_ID` is not optional. Without it the reverse index decides the tenant,
and a test business holding an outlet literally named `pizza` hijacks the live
bot's subscriptions (this happened on 2026-11-03).

**`PRE-M3` only** - the tree still contains four timers that Cloud Functions now
own, so a pre-M3 box must be disarmed through `.env` before first boot. Add:

```
ONBOARDING_AUTO_APPROVE=off     # cloud onboardingWatcher approves signups
DAILY_SETTLEMENT_HOUR=-1        # cloud dailySettlement owns the day claim
# ONBOARDING_CLEANUP stays unset -> observe mode, deletes nothing
```

`-1` never matches `new Date().getHours()`, so the settlement interval is inert.
The fourth timer (the Meta cost publisher) has no env switch and is handled in
Phase 7. Post-M3 all four are deleted and these lines are harmless leftovers.

### Phase 6 — WhatsApp session

**Default: fresh QR pair.** The old box is off; recovering
`session_data_pizza` needs an EBS snapshot mount, and Baileys credential drift
between versions can invalidate it anyway.

```bash
cd /var/www/foodhubbie
pm2 start ecosystem.config.js
pm2 logs bot-roshani-pizza-pizza --lines 60
```

The bot prints a QR (or a pairing code, depending on the Baileys path) into the
log. On the phone that owns the WhatsApp Business number: Settings -> Linked
devices -> Link a device -> scan. The QR expires in ~60 s; `pm2 restart` to get
a fresh one.

Gate: `bot/pair/status` becomes `connected`.

**Alternative: restore the session.** If an EBS snapshot of the old volume is
available, mount it, copy `bot/session_data_pizza/` to the same path, `chmod 700`,
and start the bot. If it does not reach `connected` within two minutes, delete
the directory and pair by QR - do not debug stale credentials.

> Do **not** let a stale `WA_PERMANENT_TOKEN` plus an outlet carrying
> `whatsapp.status='active'` exist together on a fresh boot. The orchestrator
> would provision that outlet with `BOT_TRANSPORT=meta` and it would fail on
> Graph 401. Both live outlets have `whatsapp: null` today, so
> `desiredState()` returns null and nothing is provisioned - but check before
> booting.

### Phase 7 — control API

```bash
cd /var/www/foodhubbie
pm2 start bot-control-api/server.js --name bot-control-api
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# run the command it prints, then:
pm2 save
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

This one process starts the API, the orchestrator and the status watcher.

It loads `/var/www/foodhubbie/.env` itself (`require('dotenv').config(...)` is the
first statement in `server.js`, above every other require, because
`meta-cost-publisher.js` reads its env at module scope). Nothing has to be
exported in the shell that starts pm2 - which matters, because the old box only
worked by accident: its `.env` happened to be ambient, and `applicationDefault()`
throws at boot when `GOOGLE_APPLICATION_CREDENTIALS` is absent. A missing env now
means a boot that fails loudly in `pm2 logs`, not a half-started API.

Gate: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/bot/status-all`
prints `401` (reaching the route at all proves `initializeApp` succeeded).

**`PRE-M3` only** - `bot-control-api/server.js` still calls
`startMetaCostPublisher({ admin })` near the bottom of the file. That publisher
writes `walletBilling/{bid}/{oid}/balancePaise` every 5 minutes for every outlet
in `outletIndex`, and the cloud `metaCostPublisher` already owns that path (every
15 minutes) - two writers break the one-writer contract and re-add the
`outletIndex` egress loop. Comment the call out before starting:

```bash
cd /var/www/foodhubbie
nano bot-control-api/server.js
```

The call spans three lines - comment out all of it, not just the first, or the
file will not parse:

```js
// PRE-M3: the cloud metaCostPublisher is the single balancePaise writer.
// startMetaCostPublisher({ admin }).catch((err) => {
//   console.error('Meta cost publisher failed to start ...', err);
// });
```

```bash
node --check bot-control-api/server.js     # must print nothing
```

`bot/transport.js`'s `_metaCostGuard` then reads whatever the cloud publisher
last wrote, which is the target behaviour anyway. M3 deletes the file.

If `ecosystem.config.js` already declares a `bot-control-api` app (M3 adds it),
Phase 6's `pm2 start ecosystem.config.js` started it for you - check with
`pm2 list` and skip the manual start rather than launching a second copy.

### Phase 8 — DNS cutover

Point the name at the Elastic IP **before** TLS, because Caddy issues the
certificate over HTTP-01 and cannot validate a name that still resolves to the
old (dead) address.

In GoDaddy: `api.foodhubbie.in` A record -> the Elastic IP, TTL 600.

```bash
dig +short api.foodhubbie.in          # must print the Elastic IP
```

If you are cutting over from a still-running old box, lower the TTL to 300 an
hour before, then flip. Verify from a machine that is not the box.

**The window between this flip and Phase 9 is expected.** The old box has been
down since 2026-11-11, so nothing is lost; but `platformHealth` probes
`https://api.foodhubbie.in/api/bot/status-all` every hour and will report the API
as down (and may page the owner) until Phase 9 finishes. If the old box were
still live, you would flip DNS last instead and accept a brief cert-retry delay.

### Phase 9 — TLS reverse proxy

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

`/etc/caddy/Caddyfile`:

```
api.foodhubbie.in {
    encode gzip
    reverse_proxy 127.0.0.1:4000
}
```

```bash
sudo systemctl reload caddy
sleep 15 && curl -sI https://api.foodhubbie.in/api/bot/status-all | head -1   # HTTP/2 401
```

Caddy obtains the certificate automatically over HTTP-01 because Phase 8 already
made the name resolve here. If the first request fails, watch
`journalctl -u caddy -n 50` - a certificate error almost always means DNS has not
propagated yet, not that the Caddyfile is wrong.


### Phase 10 — verification gates

Run all 24. `bash tools/verify-box.sh` automates 1-22 (appendix D). Gates 23 and
24 are manual and are the two that catch real provisioning mistakes.

| # | gate | command | pass |
|---|---|---|---|
| 1 | node version | `node -v` | `v22.12.0` or higher |
| 2 | pm2 present | `pm2 -v` | any version, daemon owned by `ubuntu` |
| 3 | branch + clean tree | `git -C /var/www/foodhubbie rev-parse --abbrev-ref HEAD` | `server` |
| 3b | no hand edits | `git -C /var/www/foodhubbie status --porcelain --untracked-files=no` | empty |
| 4 | bot deps | `node -e "require('/var/www/foodhubbie/bot/node_modules/firebase-admin')"` | no output, exit 0 |
| 5 | service account | `node -e "console.log(JSON.parse(require('fs').readFileSync('/var/www/foodhubbie/bot/service-account.json')).project_id)"` | `foodhubbie-10` |
| 6 | env perms | `stat -c %a /var/www/foodhubbie/.env` | `600` |
| 7 | DB reachable | appendix D `gate_db` | prints the project id |
| 8 | bot online | `pm2 jlist` | `bot-roshani-pizza-pizza` status `online` |
| 9 | tenant pinned | `pm2 logs bot-roshani-pizza-pizza --lines 80 --nostream` | contains `[TENANT] outlet=pizza business=roshani-pizza` |
| 10 | transport | `pm2 logs ... --nostream` | `transport=baileys` |
| 11 | bot health | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health` | `200` |
| 12 | API loopback | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/bot/status-all` | `401` |
| 13 | API via TLS | `curl -s -o /dev/null -w '%{http_code}' https://api.foodhubbie.in/api/bot/status-all` | `401` |
| 14 | certificate | `curl -sI https://api.foodhubbie.in \| head -1` | `HTTP/2 401` or `HTTP/1.1 401` |
| 15 | pairing | RTDB `.../bot/pair/status` | `connected` |
| 16 | socket is real | send a WhatsApp message to the number | a reply arrives |
| 17 | liveness fresh | RTDB `.../botStatus` | `updatedAt` < 2 min old |
| 18 | relay flags | `firebase database:get /config` | all four `enabled: true` |
| 19 | cloud finalizes | place a demo APP order | stock decremented, `stockDeducted: true` |
| 20 | cloud loyalty | mark that order `Delivered` | points credited |
| 21 | platformHealth | RTDB `platformHealth/state` | `checkedAt` fresh, `apiOk: true` |
| 22 | no egress storm | `sudo ss -tnpi` sampled twice, 5 s apart | no process grows by megabytes |
| 23 | deploy script | `bash tools/server-deploy.sh` | ends with `401 = up, auth required` |
| 24 | reboot survival | `sudo reboot`, wait 90 s | gates 8, 11, 12, 13, 15, 17 all still pass |

Gate 24 is not optional. `pm2 save` + `pm2 startup` is the only thing that makes
a box come back after a reboot, and it is the most commonly missed step.

Gate 16 is the only one that proves the socket works. Everything else can be
green with a dead socket, because `bot/pair/status` freezes at `connected` when
the machine loses power - a hard stop writes no disconnect.

### Phase 11 — decommission the old box

1. Confirm 72 hours of green gates 8-22 on the new box.
2. Snapshot the old EBS volume (`snapshot-<date>-pre-decommission`) before
   anything else. It is the only copy of `session_data_pizza` and any
   box-local edits.
3. Stop the old instance. Do not terminate for 30 days.
4. Release its Elastic IP only after the snapshot is verified.

---

## 6. Deploy and rollback

### 6.1 The branch rule

`server` is the only branch the box tracks. It is **always an ancestor of
`main`** - never diverged, never ahead. Server work is committed on `server`,
then merged into `main`. Frontend work stays on `main` and never reaches the box.

```bash
# on the dev machine
git checkout server && git merge --ff-only main && git push origin server
```

Guard: `node tools/check-server-branch.cjs` (`npm run test:server-branch`).

### 6.2 Deploying server code

```bash
# on the box
bash /var/www/foodhubbie/tools/server-deploy.sh
```

It aborts on modified tracked files, fast-forwards, `node --check`s every changed
`.js/.cjs/.mjs`, restarts every running pm2 app whose script lives in the repo
(derived from `pm2 jlist`, so a stopped app is never resurrected), then gates on
`/api/bot/status-all` answering 401.

It never runs `git clean`.

It also does not run `npm ci`: if a deploy changes a `package.json` (it changed
`bot-control-api` on 2026-11-18, when `dotenv` was added), install first or the
restart lands in a crash loop on `Cannot find module`:

```bash
npm ci --prefix bot-control-api     # or --prefix bot
```

**M3 change:** drop `webhook-server/index.js` and `webhook-server/node_modules`
from the runtime sanity gate at line 90. Until then the script refuses to deploy
on a box without them.

### 6.3 Deploying Functions

```bash
cd FIREBASE_SERVER_MIGRATION/functions
npm run build              # copy-vendor.cjs + tsc
cd ../..
firebase deploy --only functions
```

`copy-vendor.cjs` vendors 18 modules from `bot/` and `shared/` and load-checks
them, so a broken vendored module fails the build rather than the deploy.

Never deploy a single function with `--only functions:name` when the change is in
`shared/` - the vendored copies are per-bundle.

### 6.4 Rollback matrix

| symptom | rollback |
|---|---|
| a cloud trigger is double-sending or mispricing | set the flag to `false` in RTDB. The bot takes over within 30 s. No deploy. |
| the bot is misbehaving after a deploy | `git reset --hard <good-sha>` on the box, `pm2 restart all` |
| a Functions deploy broke everything | redeploy the previous git SHA; the RTDB flags are independent |
| the box is unrecoverable | provision from section 5. The cloud half keeps working throughout. |
| DNS is wrong | flip the A record back; TTL 600 means <= 10 min |

The flags are the reason a cloud rollback is a database write, not a deploy.

---

## 7. Observability

### 7.1 What writes health today

| signal | writer | path | cadence |
|---|---|---|---|
| bot liveness | `status-watcher` (EC2) | `outlets/{oid}/botStatus` | 30 s reconcile + pm2 events |
| socket heartbeat | bot | `outlets/{oid}/bot/status` | `reportInterval` |
| pairing state | bot | `outlets/{oid}/bot/pair` | on connect/disconnect |
| out-of-band alert | `platformHealth` (Functions) | `platformHealth/state` + Slack/push | schedule |
| wallet reconcile | `walletGateReconcile` | `meta/walletWatch/reconcile` | hourly |
| settlement | `dailySettlement` | `meta/dailySettlement/last` | 23:00 IST |
| demo reseed | `demoReseed` | `meta/demoReseed/last` | 03:00 IST |
| onboarding | `onboardingWatcher` | `meta/onboardingAuto/lastRun` | 2 min |
| order finalization | `orderFinalizer` | `orders/{id}/finalizeClaim` + `_fcmSent` | per order |
| API liveness | `platformHealth` probe | `GET https://api.foodhubbie.in/api/bot/status-all` = 401 | schedule |

### 7.2 The three queries to run first in any incident

```bash
# 1. Is the box alive and paired?
firebase database:get /businesses/roshani-pizza/outlets/pizza/botStatus
firebase database:get /businesses/roshani-pizza/outlets/pizza/bot/pair

# 2. Did the cloud do its job?
firebase database:get /businesses/roshani-pizza/outlets/pizza/orders/<id>

# 3. What does the platform think?
firebase database:get /platformHealth/state
```

### 7.3 Thresholds

| metric | warn | page |
|---|---|---|
| `botStatus.updatedAt` age | > 5 min | > 15 min |
| `bot/pair.status` | not `connected` | not `connected` for 10 min |
| `bot/alerts` new entries | any `warning` | any `critical` |
| Functions error rate | any sustained 5xx | > 1 % over 15 min |
| RTDB egress | > 200 MB/day | > 1 GB/day |
| `meta/walletWatch/reconcile.errors` | > 0 | > 0 twice |

The egress thresholds exist because of batches 11/14/15: a single accidental
full-tree listener cost ~1.5 GB/day and was invisible until the bill.

### 7.4 Known noise, not incidents

- `loadQuota failed 404` on Supreme outlets with no WhatsApp number.
- `[RoleAccess] Missing/unknown role ""` - fires once pre-auth, self-corrects.
- `[SW] Failed to cache: alert.mp3` - transient during install.

---

## 8. Failure runbooks

### F1 — the box is dead / unreachable

**Detect:** `platformHealth` fires "no heartbeat + api unreachable"; or
`botStatus.updatedAt` stops advancing.

**Blast radius:** WhatsApp conversation only. Orders, money, loyalty, stock,
pushes, media, onboarding, settlement all keep working (section 1.4).

**First action:** confirm the box, not the network.

```bash
aws ec2 describe-instance-status --instance-id <id>
curl -s -o /dev/null -w '%{http_code}\n' https://api.foodhubbie.in/api/bot/status-all
```

**Resolve:** start the instance. If the public IP changed, the Elastic IP is
misconfigured - fix that before DNS. If it will not boot, provision a new box
(section 5); the old one is not worth forensic effort because nothing on it is
authoritative.

**After recovery:** messages received while it was down were queued by Meta and
retried for up to ~24 h; Baileys reconnects and replays its own session. Check
`bot/pair.status` and `botStatus` before declaring victory.

### F2 — WhatsApp session logged out or banned

**Detect:** `bot/alerts` entry `ban_detected` (`DisconnectReason.loggedOut`,
code 401), or `bot/pair.status` != `connected`.

**Cause:** usually a promo burst, a reply to a channel/group, or the number being
reported. The ban-proofing layer (`paceOutboundTo`, `wrongMessage` strikes,
promo hard-block on Baileys) exists to prevent this.

**Resolve:** re-pair by QR with the physical phone. Do **not** loop
`pm2 restart` - repeated failed logins make a ban permanent.

**Then:** check `bot/promotions/killSwitch`. It should be `true` after any ban.

### F3 — Meta webhook is not delivering

Only applies to outlets on `transport=meta`.

**Detect:** `webhookInbox` stays empty while customers say they messaged.

**Check:**
1. Meta app dashboard -> WhatsApp -> Configuration -> callback URL is
   `https://us-central1-foodhubbie-10.cloudfunctions.net/whatsappWebhook` and the
   verify token matches.
2. `phoneNumberIndex/{phoneNumberId}` exists (the webhook routes through it).
3. Function logs for `whatsappWebhook` show signature failures (a wrong
   `META_APP_SECRET` rejects every call).

**Resolve:** the inbox is a durable queue - once delivery resumes, the bot's
`child_added` drain picks everything up. Nothing is lost unless Meta gave up
retrying.

### F4 — duplicate WhatsApp messages / duplicate pushes

**Cause:** almost always a relay flag read as true on one side and false on the
other, or a claim that was not taken.

**Check:**
1. `firebase database:get /config` - is the flag literally `true`?
2. `orders/{id}/_fcmSent` - was the claim taken?
3. `orders/{id}/finalizeClaim` - who owns it, and when?
4. `bot/redeemClaims/{key}` - `by: 'cloud'` or `by: 'bot'`?

**Resolve:** set the flag to `false`, restart the bot, confirm the bot takes
over, then investigate offline. Never leave both sides enabled "temporarily".

### F5 — an order was never finalized

**Detect:** `stockDeducted` absent, `finalizeClaim` present with an old `at`.

**Cause:** the 5-minute claim TTL expired after a crash, or the event was never
delivered (RTDB triggers do not replay).

**Resolve:** delete `orders/{id}/finalizeClaim` and rewrite any order field. The
trigger re-runs and claims again. `stockDeducted === true` short-circuits, so
this is safe to repeat.

### F6 — loyalty points missing

**Check order:** `status` in `delivered|served`? `paymentStatus` `Paid` for
dine-in? `loyalty/accruals/{orderId}` present? `customers/{phone}/loyalty/points`
vs `lifetimePoints` (spendable vs earned - the Admin dashboard shows both).

**Resolve:** rewrite `orders/{id}/status` to the same value. The leaf listener
fires and the accrual is idempotent.

### F7 — push not delivered

**Check:** `pushInbox/{phone}` written? (If yes, the send succeeded and the
device is the problem.) `notifyCaps/{phone}/{type}/{day}` consumed? Token present
and not stamped `fcmTokenInvalidAt`?

**Known:** `messaging/invalid-argument` is deliberately **not** a pruning code
(it also fails whole batches on a bad payload). A token that always returns it
will stay in the list forever - that is intentional.

### F8 — wallet gate stuck

**Check:** `walletBilling/{bid}/{oid}/wallet.enforce` (the only arm switch),
`meta/walletWatch/{bid}/{oid}` (the fee index), `outlets/{oid}/walletGate`.

**Resolve:** corrupt or missing index -> run the hourly reconcile manually by
writing to any armed outlet's order (or wait <= 1 h). Disarm -> gate clears on
the next event.

### F9 — promo campaign stuck

**Check:** `bot/promotions/killSwitch`, `bot/promotions/enabled`,
`bot/transport` (`baileys` -> campaigns are hard-blocked by design),
`campaigns/{id}/pauseReason`.

`transport-blocked` is not a bug: promo campaigns are the top ban trigger and are
refused on Baileys. They only run on `meta`.

### F10 — Functions quota or cold-start storm

**Symptom:** orders finalize slowly, triggers time out.

**Cause:** a listener that fires on every order write (the wallet gate listens on
the whole order node deliberately). At high order volume this is the hot path.

**Resolve:** check the function's invocation graph in the console; if
`onOrderBillingChange` dominates, that is expected (it is the gate's delta unit).
Only optimize if `walletBilling` is actually armed for the outlet - unarmed
outlets return before the transaction.

---

## 9. Deletion list

Everything here is dead, redundant, wrong, or superseded. Each entry names the
evidence so a future reader does not have to re-derive it.

### 9.1 Files to delete

**Whole directories**

| path | evidence |
|---|---|
| `webhook-server/` | replaced by the `whatsappWebhook` Function; `WA_VERIFY_TOKEN` has no other consumer; it is the only reason `server-deploy.sh` requires a `webhook-server/node_modules` path |
| `FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/` | both functions are wrong (2.2); `taskQueue.ts` targets a `foodhubbie-prod` project, has no queues, and sends no OIDC token |
| `FIREBASE_SERVER_MIGRATION/functions/src/shared/orders/` | `handlers.ts` has zero importers; `session.ts` is imported only by it and by `processInboundMessage` |

**Functions source files**

```
src/triggers/webhookInbox.ts          DANGEROUS - deletes inbox entries, races the bot
src/triggers/orderStatusAlert.ts      never deployed; WhatsApp-only
src/triggers/onOrderStatusChange.ts   stamps placedAt/confirmedAt with no readers
src/triggers/orderFinalizerShadow.ts  migration scaffolding; nothing reads migrationShadow
src/api/botControl.ts                 writes restartRequested; nothing reads it
src/api/transportSwitch.ts            zero client callers
src/api/qrMenuOrder.ts                zero client callers
src/api/qrMenuPayment.ts              zero client callers
src/api/getWhatsAppQuota.ts           zero client callers (Supreme reads the EC2 route)
src/api/onboardingApprove.ts          predates hardening; superseded by tenantOnboarding
src/scheduled/promoScheduler.ts       never deployed; WhatsApp-only
src/scheduled/dailyReports.ts         never deployed; WhatsApp-only
src/shared/session.ts                 only used by the deleted taskqueue path
src/shared/strikeTracker.ts           same
src/shared/rateLimit.ts               same
src/shared/wallet/metaCost.ts         only imported by sendOutboundMessage
src/shared/types/index.ts             zero importers
```

**EC2 files**

```
bot-control-api/meta-cost-publisher.js   the cloud metaCostPublisher is the single balancePaise writer
```

**Guards that pin deleted code** (delete with their subjects, and drop their CI
steps + npm scripts):

```
tests/webhook-inbox.check.cjs
tests/process-inbound.check.cjs
tests/order-status-alert.check.cjs
tests/promo-scheduler.check.cjs
tests/daily-reports.check.cjs
```

`tests/egress-guard.check.cjs` stays: it guards the surviving triggers and the
orchestrator's egress discipline.

### 9.2 Exports to remove from `src/index.ts`

`botControl`, `transportSwitch`, `qrMenuOrder`, `qrMenuPayment`,
`getWhatsAppQuota`, `onboardingApprove`, `onOrderStatusChange`,
`onWebOrderPlacedShadow`, `onWebOrderFinalizedShadow`, `processInboundMessage`,
`sendOutboundMessage`, `onWebhookInboxMessage`, `onOrderStatusAlert`,
`promoScheduler`, `dailyReports`.

After the prune `src/index.ts` exports exactly the 23 functions in 2.1.

### 9.3 Timers to remove from `bot-control-api/server.js`

| call site | why |
|---|---|
| `startMetaCostPublisher({ admin })` (line ~1605) | cloud publisher owns `balancePaise` |
| `runDailySettlement()` (line ~1520) | cloud `dailySettlement`; the EC2 copy reads the whole `businesses` tree (the batch-11/14/15 egress bug class) and claims the same `meta/dailySettlementLastRun` UTC day |
| `runUnverifiedCleanup()` | cloud `onboardingWatcher` owns it; two writers race |
| `startAutoApproval()` | cloud `onboardingWatcher` owns it; two writers race |

Also remove the `require('./meta-cost-publisher')` at line 28.

### 9.4 Deployed Functions to delete

```bash
firebase functions:delete \
  botControl transportSwitch qrMenuOrder qrMenuPayment getWhatsAppQuota \
  onboardingApprove onOrderStatusChange onWebOrderPlacedShadow \
  onWebOrderFinalizedShadow processInboundMessage sendOutboundMessage \
  --project foodhubbie-10 --region us-central1 --force
```

`metaCostPublisher` is **not** in that list. The cloud copy is the single writer
of `balancePaise`; the EC2 copy is what gets deleted.

### 9.5 Code changes (not deletions)

| file | change | why |
|---|---|---|
| `bot-control-api/server.js` ~L51 | fail fast with a clear message when `GOOGLE_APPLICATION_CREDENTIALS` is unset (the `.env` load at the top of the file is what supplies it) | `applicationDefault()` throws an opaque error at boot |
| `bot-control-api/server.js` `app.listen` | bind `127.0.0.1` | health/API ports currently bind `0.0.0.0`; the security group is the only gate |
| `ecosystem.config.js` | add the `bot-control-api` app | otherwise a reboot loses the API unless someone remembered `pm2 save` |
| `tools/server-deploy.sh` L90 | drop `webhook-server/index.js` + `webhook-server/node_modules` | the path is being deleted |
| `bot/index.js` `initFCMWatcher()` | call it only when `!isPushRelayEnabled()` | 2 of the 4 `orders` listeners are dead weight while the relay is ON; document that flipping the flag back requires a restart |
| `bot/index.js` `reportInterval` | prune `bot/alerts` and `bot/logs` older than N days | both are unbounded `push`es (20+ alerts on e2e, ~80 log rows on pizza). `botStatus/history` is already capped at 48 by `status-watcher` |
| `bot/index.js` order listeners | move `paymentSync.syncCustomerPayment` + `verifyQrOrderDiscount` to Functions | M2 - the last two DB-only paths on the box |

### 9.6 Do not delete

These look redundant but are load-bearing:

| path | why it stays |
|---|---|
| `bot/transport.js` `webhookInbox` drain | the Meta transport path for outlets on the official API |
| `src/api/whatsappWebhook.ts` | Meta ingress; the only writer of `webhookInbox` |
| `src/shared/wallet/gate.ts` + `src/triggers/walletGate.ts` | the only publisher of `walletGate` |
| `src/scheduled/metaCostPublisher.ts` | the only writer of `balancePaise` |
| `bot/order-finalizer.js`, `bot/loyalty-engine.js`, `bot/rider-push.js` | the source of truth that `copy-vendor.cjs` vendors into Functions; the bot copies are the flag-off fallback |
| `bot/helpers/outlet-resolution.js` | tenant pinning; the `SYNC WARNING` names the menu twin |
| `shared/discount-rules.js` + `menu/shared/` twin | single source of discount math, guarded by `tools/check-shared-twins.cjs` |
| `bot/promotions.js` | promo pacing is socket-shaped by design |
| `tests/egress-guard.check.cjs` | guards the surviving triggers |

---

## 10. Migration phases

Each phase has an exit criterion that can be checked, not asserted.

### M0 — cloud half (DONE, batches 23a-23l)

All relay flags ON, all money paths cloud-owned, proven by a six-day outage.

**Exit (met):** orders, loyalty, pushes, media, onboarding, settlement all
function with the box down.

### M1 — Function surface prune

Delete the 11 deployed + 4 source-only functions, their shared modules, and the
five guards that pin them. Update `src/index.ts`.

**Exit:** `firebase functions:list` shows 23; `npm run build` green;
`node tests/egress-guard.check.cjs` green; a demo APP order still finalizes
(stock decrements, `stockDeducted: true`).

**Risk:** low. Every deleted function has zero live callers or is unreachable
behind a flag. Delete `webhookInbox.ts` **first** - it is the only one that is
actively dangerous.

### M2 — move the last two DB-only bot paths

`paymentSync.syncCustomerPayment` and `verifyQrOrderDiscount` are pure Admin SDK
writes with no socket call. While they live on the box, the box is still a money
path, which contradicts 1.2.

Design, following the 23f pattern exactly:

- `onQrOrderVerify` - `onValueCreated` on `orders/{orderId}`, gate on
  `source === 'QR'`, flag `config/qrVerifyRelay`.
- `onCustomerPaymentMirror` - `onValueWritten` on `orders/{orderId}/status`
  (leaf, so a KOT stamp cannot invoke it), flag `config/paymentMirrorRelay`.
- Both claim a transaction marker before writing, both hard-skip
  `foodhubbie-demo` only where the demo would write 353 orders.
- Ship shadow-first: run cloud + bot, compare, then flip.

**Exit:** a QR order placed on the demo tenant has its discount verified, its
taxes re-derived and its session bill delta applied with the bot **stopped**;
`git grep` shows no `paymentSync` call left in `bot/index.js`.

**If M2 is deferred:** record explicitly that the box is still a money path for
QR dine-in, and that F1's blast radius therefore includes QR discount
verification. Do not defer silently.

### M3 — EC2 prune

Delete `webhook-server/`, `meta-cost-publisher.js`, the four timers, the six
routes; fix the deploy gate; bind loopback; add the control-api to
`ecosystem.config.js`; gate `initFCMWatcher`.

**Exit:** `node --check` on every touched file; `bash tools/server-deploy.sh`
no-op succeeds and ends with the 401 gate; the route table is 15;
`grep -r webhook-server tools/` returns nothing.

### M4 — new box provision + cutover

Run section 5 end to end, all 24 gates, then 72 hours of soak before
decommissioning the old instance.

**Exit:** gates 1-24 green twice, 72 h apart; `platformHealth` reports `api: true`
and a fresh heartbeat; one real WhatsApp order placed and fulfilled end to end.

### Ordering rationale

M1 before M2 because deleting the wrong functions first reduces the surface you
have to reason about. M3 before M4 so the new box is built from a tree that
never contained the deleted code - a fresh box should not need a cleanup pass.

---

## 11. Cost model

All figures are **list-price estimates**. The repo has a hard-won rule about
this: `sent_bytes_count`-derived rupee figures ran ~3x high against the actual
₹469.36 alert (batch 11 §6). Verify against the AWS/Firebase invoice; do not
quote these to the owner as fact.

### 11.1 EC2 (the only fixed cost)

| item | t3.small | t3.medium |
|---|---|---|
| compute, ap-south-1 on-demand | ~$18/mo | ~$37/mo |
| 30 GB gp3 | ~$2.7/mo | ~$2.7/mo |
| public IPv4 (charged since Feb 2024) | ~$3.7/mo | ~$3.7/mo |
| **total** | **~$24/mo (~₹2,000)** | **~$43/mo (~₹3,600)** |

One year reserved or a savings plan cuts compute ~30-40 %. `t4g.small` is a
further ~30 % off compute.

### 11.2 Cloud (variable, currently inside free tiers)

| service | driver | today |
|---|---|---|
| Functions | ~23 functions; the hot path is `onOrderBillingChange` per order write | 2 M invocations/month free tier; at 1,000 orders/day (~10 k order writes/day) it is ~300 k/month -> ₹0 |
| RTDB | ~12 KB/min steady state after batches 11-19 (~17 MB/day) | 10 GB/month free egress; comfortably inside |
| Storage | 65 objects, ~1.3 MB, plus per-upload growth | negligible |
| Hosting | admin shell ~0.55 MB cold after the batch-16 diet | 10 GB/month free |
| Scheduler | 5 jobs (2 min, 15 min, hourly, daily x2) | ~25 k invocations/month -> ₹0 |

### 11.3 The comparison that actually decides it

| option | fixed cost | marginal cost per message | verdict |
|---|---|---|---|
| EC2 + Baileys (this plan) | ~₹2,000-3,600/mo | ₹0 | cheapest above ~2 active outlets |
| Cloud-only + Meta API | ₹0 | ₹0.86-1.15 per billable message after 1,000 free/number/month | ~3-4 active outlets exceed the EC2 bill |
| Fat EC2 (pre-2026-11) | same | ₹0 | same cost, but money paths die with the box |

Worked example, one outlet: 30 orders/day x ~6 messages = 180/day = ~5,400/month.
1,000 free -> 4,400 billable x ₹0.86 = ~₹3,800/month **for one outlet**. The box
costs less than one outlet's Meta bill. That is the whole argument.

### 11.4 What would change the answer

- Meta dropping service-message pricing to zero again -> cloud-only becomes
  viable and the box can be retired for real.
- Tenants insisting on the official API for trust reasons -> each tenant pays
  their own Meta bill, and the box shrinks to a control plane.
- More than ~15 outlets on one box -> split by group; the cost is linear but the
  failure domain is not.

---

## 12. Security

### 12.1 Trust boundaries

1. **Browser -> API.** Every `/api/*` call carries a Firebase ID token;
   `requireAuth` verifies it. Mutating bot operations add `requireSuperOnly`.
   `/tenant-api/*` resolved the tenant from the token, not from the body - those
   routes are now on Functions with the same rule (`tenantFromToken`).
2. **API -> pm2.** `pm2Action(action, processName(bid, oid))` - the process name
   is derived, never taken from the request body. A caller cannot restart an
   arbitrary process.
3. **Box -> Firebase.** The service account. Database admin is genuinely needed;
   project-owner is not (4.4).
4. **Meta -> webhook.** Signature-verified in `whatsappWebhook` with
   `META_APP_SECRET`. A wrong secret rejects every call - which is also the
   first thing to check in F3.

### 12.2 Auth surface on the box

| surface | gate |
|---|---|
| `/api/bot/status*` | any valid admin token |
| `/api/bot/{restart,transport,rescan,stop,provision,delete}` | `requireSuperOnly` |
| `/api/whatsapp/*` reads | any valid admin token |
| `/api/whatsapp/*` writes | `requireSuperOnly` |
| CORS | allowlist: `DASHBOARD_ORIGIN` + the four hardcoded dashboard origins |

`requireSuperOnly` accepts `isSuper` or `isSupport`; support is read-only for
the routes that matter, because every mutating route also checks the role.

### 12.3 Secrets inventory

| secret | where | rotation |
|---|---|---|
| `WA_PERMANENT_TOKEN` | `.env` | Meta system user -> regenerate |
| `META_SYSTEM_USER_TOKEN` | `.env` | same |
| `META_APP_SECRET` | `.env` | Meta app dashboard |
| `SLACK_ALERT_WEBHOOK_URL` | `.env` | Slack |
| service account JSON | `bot/service-account.json` | Firebase console -> new key |
| Baileys creds | `bot/session_data_pizza/` | re-pair |
| `WA_VERIFY_TOKEN` | `.env` | **unused after M3** - delete |

### 12.4 Known gaps and their fixes

| gap | fix | phase |
|---|---|---|
| no TLS on the old box | Caddy (Phase 9) + gate 13/14 | M4 |
| API binds `0.0.0.0` | bind `127.0.0.1` | M3 |
| default compute SA likely reused | dedicated least-privilege SA | M4 |
| `bot/alerts` grows forever | prune in `reportInterval` | M3 |
| stale `WA_PERMANENT_TOKEN` + `whatsapp.status='active'` would provision a meta worker | keep both outlets' `whatsapp` null; check before boot | M4 |
| old box has a plaintext password in an untracked spec (deleted 2026-11-07) | owner-side password rotation still outstanding | owner |

---

## 13. Open owner decisions

| # | decision | options | recommendation |
|---|---|---|---|
| 1 | instance type | t3.small / t3.medium / t4g.small | `t3.medium` if more than 3 outlets are planned within a year, else `t3.small` |
| 2 | old instance disposition | snapshot + stop 30 d / terminate now | snapshot, stop, keep 30 d. It is the only copy of the Baileys session |
| 3 | WhatsApp re-pair | fresh QR / restore session | fresh QR (session drift is a real risk) |
| 4 | M2 timing | now / after the new box soaks | after the box soaks - do not change the QR money path in the same week as the host move |
| 5 | service account | reuse / new dedicated | new dedicated, least privilege |
| 6 | Redis | add / skip | **skip**. `REDIS_URL` is optional and one process owns one outlet, so `localSessionCache`/`localStatusCache` are sufficient |
| 7 | `t4g` (ARM) | try / stay x86 | stay x86 for the first rebuild; revisit when the box is stable |

---

## 14. Appendices

### A. Environment variable reference

All of it lives in one file, `/var/www/foodhubbie/.env` (mode `600`, untracked).
Both processes load it themselves: `bot/index.js` line 5 and
`bot-control-api/server.js` line 28, each with `dotenv`, which never overrides a
variable already present in the environment. `ecosystem.config.js` therefore only
carries the per-process identity (`OUTLET`, `BUSINESS_ID`), not the secrets.

**Required on the box**

| var | consumer | note |
|---|---|---|
| `NODE_ENV` | all | `production` |
| `OUTLET` | bot | the outlet id, e.g. `pizza` |
| `BUSINESS_ID` | bot, orchestrator | **not optional** - see Phase 5 |
| `FIREBASE_DATABASE_URL` | all | `https://foodhubbie-10-default-rtdb.firebaseio.com` |
| `GOOGLE_APPLICATION_CREDENTIALS` | control-api | path to the service account JSON |
| `BOT_CONTROL_PORT` | control-api | default 4000 |
| `BOT_TRANSPORT` | bot, control-api | `baileys` for the live outlet |
| `DASHBOARD_ORIGIN` | control-api | comma-separated CORS allowlist |
| `MENU_WEB_ORIGIN` | control-api | used in order links |
| `SLACK_ALERT_WEBHOOK_URL` | status-watcher | offline alerts |
| `WA_PERMANENT_TOKEN` | bot, orchestrator | Meta path |
| `META_APP_ID`, `META_APP_SECRET` | control-api | Graph + webhook |
| `META_SYSTEM_USER_TOKEN` | control-api | Graph provisioning |

**Optional**

| var | default | note |
|---|---|---|
| `REDIS_URL` | absent -> in-memory | skip (decision 6) |
| `WA_BOT_PHONE` | - | display only |
| `WEBVIEW_DELIVERY_HOST` | `menu.foodhubbie.in` | order links |
| `PROACTIVE_TEMPLATE` | `proactive_promo` | promo shell |
| `PROACTIVE_LANGUAGE` | `en` | Hinglish shells are `en` |
| `BAILEYS_LOG_LEVEL` | `warn` | `debug` is very loud |
| `HEALTH_PORT` | 0 (OS-assigned) | 3001+ for real workers |
| `WABA_ID`, `META_BUSINESS_ID` | - | Graph scoping |
| `FIREBASE_STORAGE_BUCKET` | `foodhubbie-10.firebasestorage.app` | |
| `META_CREDIT_LINE_START_PAISE` | - | Meta budget baseline |
| `ALERT_OFFLINE_MINUTES` | - | status-watcher threshold |
| `SESSION_BACKUP_BUCKET`, `SESSION_BACKUP_PREFIX`, `AWS_*` | - | optional session backup |

**Unused / delete**

| var | status |
|---|---|
| `WA_VERIFY_TOKEN` | only `webhook-server` (deleted in M3) |
| `META_CONFIG_ID` | dead; the embedded-signup config expired ~Oct 2026 |
| `ONBOARDING_AUTO_APPROVE`, `ONBOARDING_CLEANUP`, `AUTO_APPROVE_MAX_PER_HOUR`, `DAILY_SETTLEMENT_HOUR`, `META_COST_PUBLISH_INTERVAL_SEC` | the jobs moved to Functions in 23d-4 / 23i / 23l; the env vars now control nothing |

### B. Port map

| port | owner | exposure |
|---|---|---|
| 22 | sshd | owner IP only |
| 80 | Caddy | public (ACME + redirect) |
| 443 | Caddy | public |
| 4000 | bot-control-api | loopback only |
| 3001-3099 | bots `/health` | loopback only, **binds 0.0.0.0** |
| 5000 | webhook-server | deleted in M3 |

### C. RTDB path -> writer

See 3.3. That table is the contract; this appendix exists only to point at it.

### D. Verification script

`tools/verify-box.sh` automates gates 1-22. Run it on the box:

```bash
bash /var/www/foodhubbie/tools/verify-box.sh
```

It is read-only - it never restarts, writes or repairs anything - prints one
`PASS`/`FAIL`/`MANUAL` line per gate, runs **every** gate (it does not stop at the
first failure, because on a fresh box you want the whole picture), then exits `1`
if any automated gate failed. Gates 23 and 24 (deploy script, reboot survival) are
manual, as are 16/19/20; gate 10 and gate 22 degrade to `MANUAL` when the log or
`ss` is unavailable.

Its database probe is bounded by `NODE_TIMEOUT` (default 60 s) and every gate the
probe owns must report - a probe that hangs or dies half way marks the remaining
gates `FAIL` with the reason instead of leaving them out, so an unreachable
database reads as `timed out after 60s - database unreachable, credentials
hanging, or a wrong FIREBASE_DATABASE_URL` rather than a frozen terminal.

Override `REPO`, `BRANCH`, `BID`, `OID` or `NODE_TIMEOUT` from the environment to
point it at another tree or outlet.

### E. Glossary

| term | meaning |
|---|---|
| relay flag | a `config/*` boolean that decides whether the cloud or the bot owns a capability |
| claim | a transaction-written marker that makes an effect at-most-once across two runtimes |
| shadow | a trigger that computes but writes only a comparison record, used before flipping a flag |
| bot | `bot/index.js`, the Baileys socket worker |
| box | the EC2 instance |
| socket work | anything that can only be done by holding a live WhatsApp connection |

---

## 15. Change log

| date | change |
|---|---|
| 2026-11-17 | document created; EC2 retirement reversed and replaced with the scoped-host model |
| 2026-11-17 | inventory arithmetic corrected against `firebase functions:list` and `bot-control-api/server.js`: 34 deployed = keep **23** + delete **11** (the earlier "keep 22 / delete 12" miscounted `metaCostPublisher` as deleted); 25 routes = keep **19** + delete **6** |
| 2026-11-17 | runbook correctness pass: DNS cutover moved ahead of TLS (Phase 8/9 swapped - HTTP-01 cannot validate a name still pointing at the old address); the three `PRE-M3` deviations are now all marked and actionable, including the four legacy control-API timers that must be disarmed on a pre-M3 box; broken `5.x` cross-references replaced with `Phase N` |
| 2026-11-18 | `bot-control-api/server.js` now loads `/var/www/foodhubbie/.env` itself (first statement, above every require), with `dotenv` added to `bot-control-api/package.json`. The old box only worked because its env happened to be ambient; on a fresh box `applicationDefault()` throws at boot. The same lock refresh dropped the 30 stale `sharp`/`@img` entries left behind when batch 23k removed `sharp` from `package.json`. Phase 7 gained a 401 gate, appendix A states that one `.env` serves both processes, and 6.2 warns that a `package.json` change needs an `npm ci` before the restart |
| 2026-11-18 | `tools/verify-box.sh` hardened after its first end-to-end run: the database probe is bounded by `NODE_TIMEOUT` (a hanging database or credential used to block the script for ever - the one failure a fresh box cannot diagnose), every gate the probe owns is now asserted to have reported (partial output used to drop gates 15/17/18/21 silently), and gate 3b's file count no longer reads `0` for one modified file (`wc -l` after command substitution ate the last newline). Appendix D corrected: the script runs every gate, not just until the first failure. `bash -n` passes and a full run against a non-box tree reports `2 passed, 16 failed, 7 manual`, exit 1 |
