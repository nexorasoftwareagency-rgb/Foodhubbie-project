================================================================================
FOODHUBIE — EC2 → CLOUD FUNCTIONS MIGRATION PLAN
WhatsApp Bot (Meta Cloud API) Retirement of EC2 Server
================================================================================

Project: Foodhubbie ERP
Location: D:\Foodhubbie Project
Plan dir: D:\Foodhubbie Project\PLAN\
Date: 2026-11-16
Status: DRAFT — ready for review before implementation

--------------------------------------------------------------------------------
1. EXECUTIVE SUMMARY
--------------------------------------------------------------------------------

Objective: Retire the EC2 server (i-0c7f49065b1581542, 3.111.39.210) for the
WhatsApp business logic by porting the remaining EC2-only bot functions to
Firebase Cloud Functions (v2, us-central1), using Meta Cloud API (official) as
the sole WhatsApp transport.

Current state:
- EC2 box went dark 2026-11-11 20:03 IST and has not recovered.
- api.foodhubbie.in is unreachable (TCP connect failed, ping timed out).
- The EC2 pizza WhatsApp bot (Baileys socket) is offline — inbound WhatsApp
  messages cannot be received or sent.
- 34 Cloud Functions are already deployed and handle: order finalization,
  loyalty earn/clawback/redeem, order/customer/rider pushes, wallet gate
  publisher, media upload, onboarding, app notifications, daily settlement,
  demo reseed, platform health, meta cost publishing.
- All four config feature flags (orderFinalizer, loyaltyRelay, riderRelay,
  pushRelay) are ON — cloud owns the money and push logic.
- What remains on EC2: the WhatsApp socket layer itself (receive inbound, send
  outbound via Baileys), promo campaign scheduler, admin WhatsApp alerts,
  daily WhatsApp reports, ban-proofing strikes, rate limiting.

Target state:
- Zero EC2 dependence for WhatsApp business logic.
- Meta Cloud API is the only WhatsApp transport (webhook → Cloud Function
  → RTDB trigger → task queue → Graph API).
- Cloud Functions v2 handle: inbound message processing, outbound message
  sending, promo scheduling, admin WhatsApp alerts, daily reports.
- EC2 can be shut down; only Firebase Hosting + Cloud Functions + RTDB +
  Cloud Storage remain.

Approach: Port 6 socket-free functions from bot/index.js, bot/promotions.js,
bot/transport.js, bot/utils.js into Cloud Functions (triggers, task queues,
scheduled). Use RTDB-native session state instead of Redis. Reuse the existing
sendOutboundMessage task queue (already has real Graph API code). Wire via
config/*/enabled flags for safe cutover and rollback.

--------------------------------------------------------------------------------
2. CURRENT STATE INVENTORY
--------------------------------------------------------------------------------

2.1 Cloud Functions already DEPLOYED (34 v2, us-central1)

HTTPS endpoints (always reachable):
  whatsappWebhook        POST/GET — Meta webhook, validates signature, queues to webhookInbox
  tenantMedia            POST /tenant-api/upload, /delete-image, GET /health
  tenantNotify           POST /tenant-api/notify (app pushes)
  tenantOnboarding       POST /api/admin/approve-onboarding, GET status, POST update-password
  botControl             onCall — status/restart/transport/rescan (placeholder: writes intent flags only)
  qrMenuOrder / qrMenuPayment / getWhatsAppQuota / transportSwitch — deployed

Task Queue:
  processInboundMessage  STUB — replies "will be available soon" (needs real logic)
  sendOutboundMessage    REAL — sendWhatsAppMessage/Image/UrlButton/Template via Graph API v20.0

Scheduled (cron):
  platformHealth         every 5 min — probes api.foodhubbie.in, pushes PLATFORM DOWN
  metaCostPublisher      every 15 min — publishes Meta credit balance to walletBilling
  walletGateReconcile    hourly — rebuilds armed outlets' fee index
  dailySettlement        23:00 IST — rider settlement records
  demoReseed             03:00 IST — public demo reseed
  onboardingWatcher      every 2 min — website signup auto-approval + 72h cleanup

RTDB Triggers (gated by config/*/enabled flags — all ON):
  pushRelay:             onOrderPushAdmin, onOrderPushCustomer, onLoyaltyTierUp
  orderFinalizer:        onWebOrderPlaced, onOrderCancelledCompensate
  loyaltyRelay:          onOrderLoyaltyStatus, onOrderLoyaltyPayment, onRedeemRequest
  riderRelay:            onRiderAssigned, onRiderStatus
  walletGate:            onOrderBillingChange, onWalletLedgerChange, onWalletGateTouched
  Shadow (dry-run only): onWebOrderPlacedShadow, onWebOrderFinalizedShadow
  Legacy:                onOrderStatusChange

2.2 Still on EC2 (bot/index.js, transport.js, promotions.js, utils.js, etc.)

These cannot run without the EC2 process:

  A. Inbound WhatsApp receive
     - bot/transport.js createMetaTransport: RTDB webhookInbox listener (child_added)
       dispatches messages to bot's message processor. No cloud equivalent drains
       webhookInbox — messages pile up unprocessed.
     - bot/index.js messages.upsert handler (line 2382): full message pipeline
       (opt-out, session, rate limit, order flow, chat logging).

  B. Outbound WhatsApp send
     - bot/whatsapp-send.js: Graph API caller — but nothing enqueues tasks to
       sendOutboundMessage task queue. The webhook writes to webhookInbox (for
       EC2 bot), not to the task queue.
     - bot/index.js patched sendMessage/sendTemplate — socket-dependent.

  C. Promo campaign scheduler
     - bot/index.js:2141 promo.pickupScheduledPromotions(currentSock, ...) —
       60s heartbeat picks up due campaigns.
     - bot/promotions.js: runPromotionCampaign, resumeStuckPromotions,
       expireOldPromoLogs — socket-dependent (sock param for sending).

  D. Admin WhatsApp alerts ("NEW ORDER")
     - bot/index.js handleOrderStatusUpdate → alertAdminFinalizedWebOrder —
       sends via sock.sendMessage (socket-only).

  E. Daily WhatsApp reports
     - bot/reports.js sendDailyReport/Weekly/Monthly — sends via sock.sendMessage.
     - bot/index.js:2108 sendDailyReportSafely — 21:30 IST heartbeat.

  F. Ban-proofing & rate limiting
     - bot/utils.js: paceOutboundTo (4-8s gap), isJidFrozen, recordWrongMessage,
       clearWrongStrikes (3-strike → 30min silence).
     - bot/index.js: in-memory consecutiveSendFailures ban detection.

  G. Session state
     - bot/index.js getSession/saveSession — Redis-backed (redisClient) + in-memory.
     - session_data_{OUTLET}/ filesystem for Baileys creds.

  H. Bot-control API (EC2 routes not migrated)
     - bot-control-api/server.js: /api/bot/* control routes (mostly placeholder
       intent flags now), /api/images/convert-batch (deleted, not ported),
       /api/whatsapp/quota (migrated to getWhatsAppQuota CF).

2.3 Config feature flags (RTDB) — all currently TRUE

  config/orderFinalizer/enabled   → cloud owns web order finalization
  config/loyaltyRelay/enabled     → cloud owns loyalty earn/clawback/redeem
  config/riderRelay/enabled       → cloud owns rider pushes
  config/pushRelay/enabled        → cloud owns order/customer/loyalty pushes

These flags enable safe cutover: any flag = false reverts to EC2 bot behavior.

--------------------------------------------------------------------------------
3. GAP ANALYSIS — WHAT NEEDS CLOUD REPLACEMENTS
--------------------------------------------------------------------------------

Gap | EC2 function | Cloud replacement needed | Priority
----|-------------|-------------------------|---------
G1  | Inbound WhatsApp receive (webhookInbox drain + message processing) | RTDB trigger on webhookInbox + task queue processInboundMessage | P0 — blocks all WhatsApp
G2  | Outbound WhatsApp send | Task queue sendOutboundMessage (exists, needs callers) | P0 — blocks all WhatsApp
G3  | Promo campaign scheduler | Scheduled function promoScheduler | P1 — promo sends blocked
G4  | Admin WhatsApp "NEW ORDER" alert | RTDB trigger on orders/status → task queue send | P2 — admin visibility
G5  | Daily WhatsApp reports | Scheduled function dailyReports | P3 — admin convenience
G6  | Ban-proofing strikes (3-strike freeze) | RTDB-based per-sender strike tracking in processInboundMessage | P2 — anti-ban
G7  | Rate limiting (paceOutboundTo) | RTDB-based per-sender counters or Cloud Tasks rate limits | P2 — anti-ban
G8  | Session state (getSession/saveSession) | RTDB-native bot/sessions/{jid} node | P1 — conversation state

Already covered (no gap):
- Order finalization, loyalty, pushes, wallet gate, media, onboarding, app
  notifications — all in Cloud Functions with flags ON.

--------------------------------------------------------------------------------
4. TARGET ARCHITECTURE (CLOUD-ONLY)
--------------------------------------------------------------------------------

Meta WhatsApp Cloud API
        │ (webhook POST)
        ▼
Firebase Cloud Function: whatsappWebhook (HTTPS, deployed)
        │ validates signature, enqueues to RTDB
        ▼
RTDB: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
        │
        ▼
Firebase Cloud Function: onWebhookInboxMessage (RTDB trigger, NEW)
        │ normalizes message, enqueues task
        ▼
Cloud Tasks: processInboundMessage (task queue, replace stub)
        │ full message pipeline (opt-out, session, order flow, etc.)
        │ may enqueue outbound sends
        ▼
Cloud Tasks: sendOutboundMessage (task queue, deployed, real Graph API code)
        │ POST to graph.facebook.com/v20.0/{phoneNumberId}/messages
        ▼
WhatsApp customer

Session state: RTDB bot/sessions/{jid} (replaces Redis)
Rate limiting: RTDB bot/rateLimits/{jid} counters (replaces in-memory paceOutboundTo)
Strike tracking: RTDB bot/strikes/{jid} (replaces in-memory isJidFrozen)

Admin alerts & reports:
RTDB orders/{orderId}/status ──► RTDB trigger onOrderStatusAlert (NEW) ──►
  Cloud Tasks sendOutboundMessage (WhatsApp "NEW ORDER" text to admin)

Scheduled: dailyReports (NEW) at 21:30 IST ──► Cloud Tasks sendOutboundMessage
Scheduled: promoScheduler (NEW) every 5 min ──► Cloud Tasks sendOutboundMessage

--------------------------------------------------------------------------------
5. NEW CLOUD FUNCTIONS TO CREATE
--------------------------------------------------------------------------------

5.1 onWebhookInboxMessage (RTDB trigger)
  File: functions/src/triggers/webhookInbox.ts
  Ref: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
  Event: onValueWritten (after only, new entries)
  Logic:
    - Skip demo tenant (foodhubbie-demo)
    - Read after.val(), drop if before exists (ignore updates)
    - Drop entries older than 30 min (stale)
    - Normalize Meta message → jid, text, pushName, message type (text/location)
    - Enqueue task to processInboundMessage with {bid, oid, jid, text, pushName, message, receivedAt}
    - Delete the webhookInbox entry after successful enqueue (at-most-once: delete after task enqueued, not after processing)
    - Secrets: FIREBASE_DATABASE_URL

5.2 processInboundMessage (Task Queue, REPLACE STUB)
  File: functions/src/taskqueue/processInboundMessage.ts
  Currently a stub (returns "will be available soon"). Replace with full pipeline ported from bot/index.js messages.upsert handler:
    - Opt-out / opt-in (STOP/START/unsubscribe/opt-out)
    - Rejection-reply auto-opt-out ("who is this", "not interested", etc.)
    - Ban-proofing: read strike count from RTDB bot/strikes/{jid}; 3 non-intent
      messages in AWAITING/WEBVIEW state → 30-min silence; admins never strike
    - Session management: RTDB bot/sessions/{jid} get/save (replace Redis)
    - Rate limiting: RTDB bot/rateLimits/{jid} counter with 4-8s gap (replace paceOutboundTo)
    - Admin commands (!report, !status, etc.) — WhatsApp-only; reports via email/in-app instead of WhatsApp where socket unavailable
    - Order flow: menu browse, cart, checkout, payment verification
    - Chat logging: write to chats/{customerId} and chatMeta/{customerId} (batch 19 pattern)
    - Secrets: FIREBASE_DATABASE_URL, WA_PERMANENT_TOKEN (for any direct sends)

5.3 sendOutboundMessage (Task Queue — EXISTS, verify completeness)
  File: functions/src/taskqueue/sendOutboundMessage.ts
  Already has real Graph API code (sendWhatsAppMessage/Image/UrlButton/Template).
  Verify: retry on 429/5xx, rate limiter per outlet (800 tokens/sec), cost recording
  via recordMetaCost. No changes needed unless gaps found.

5.4 onOrderStatusAlert (RTDB trigger, NEW)
  File: functions/src/triggers/orderStatusAlert.ts
  Ref: businesses/{bid}/outlets/{oid}/orders/{orderId}/status
  Event: onValueWritten (status leaf only)
  Logic:
    - Skip demo tenant
    - Skip if before === after (no status change)
    - Read full order, check source !== 'QR' (QR orders don't get admin WhatsApp alert)
    - If new status is 'Placed' (first time), send WhatsApp "NEW ORDER" text to
      outlet admin JIDs via Cloud Tasks sendOutboundMessage
    - Dedupe: check orders/{orderId}/_adminWaNotified flag before sending
    - Secrets: FIREBASE_DATABASE_URL

5.5 promoScheduler (Scheduled, NEW)
  File: functions/src/scheduled/promoScheduler.ts
  Schedule: every 5 minutes, Asia/Kolkata
  Logic:
    - Read outletIndex, for each outlet (skip demo):
      - Read bot/promotions/campaigns/{oid}
      - Find campaigns with runAt <= now and status === 'scheduled'
      - For each due campaign, enqueue send tasks to sendOutboundMessage
      - Update campaign status to 'running' / 'completed'
    - Respect daily caps (PROMO_DAILY_LIMIT = 300), warmup limits
    - Skip outlets with killSwitch=true
    - Secrets: FIREBASE_DATABASE_URL, WA_PERMANENT_TOKEN

5.6 dailyReports (Scheduled, NEW)
  File: functions/src/scheduled/dailyReports.ts
  Schedule: 21:30 IST daily (Asia/Kolkata)
  Logic:
    - Read outletIndex, for each outlet (skip demo):
      - Query orders created today, compute totals (sales, tax, discount, count)
      - Format report text
      - Send via Cloud Tasks sendOutboundMessage to admin JIDs
    - Also weekly (Sunday) and monthly (1st) variants
    - Secrets: FIREBASE_DATABASE_URL

--------------------------------------------------------------------------------
6. RTDB PATH MAPPINGS (NEW & MODIFIED)
--------------------------------------------------------------------------------

New paths (Cloud Functions only):
  bot/sessions/{jid}                    Session state (replaces Redis)
  bot/rateLimits/{jid}                  Per-sender rate limit counter
  bot/strikes/{jid}                     Ban-proofing strike count + last strike time
  bot/optout/{phone}                    Opt-out registry (already exists via bot/promotions/optout)
  orders/{orderId}/_adminWaNotified     Dedupe flag for admin WhatsApp alerts

Modified paths (existing, used by new functions):
  businesses/{bid}/outlets/{oid}/webhookInbox/{pushId} — written by whatsappWebhook, consumed by onWebhookInboxMessage
  businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{id} — read by promoScheduler
  businesses/{bid}/outlets/{oid}/orders/{orderId}/status — triggers onOrderStatusAlert

Paths used read-only (no change):
  businesses/{bid}/outlets/{oid}/settings/Store — store name, branding
  businesses/{bid}/outlets/{oid}/settings/Delivery — delivery slabs, fee
  businesses/{bid}/outlets/{oid}/dishes — catalog for pricing
  businesses/{bid}/outlets/{oid}/customers/{phone} — customer profile, consent
  businesses/{bid}/outlets/{oid}/pushSubscriptions — FCM tokens for pushes
  admins/{uid} — admin JIDs, isSuper, isSupreme, outlet, fcmToken
  outletIndex/{oid} — outlet → business mapping

--------------------------------------------------------------------------------
7. MIGRATION SEQUENCE & CUTOVER PLAN
--------------------------------------------------------------------------------

Phase 0 — Preparation (no traffic impact)
  □ Create PLAN/ folder with this document + sub-plans
  □ Write tests/guards for each new function (mutation self-tests)
  □ Verify functions:list count baseline (currently 34 v2)
  □ Snapshot RTDB before any changes (firebase database:dump or console export)

Phase 1 — Deploy new functions (flags OFF, no behavior change)
  □ Create functions/src/triggers/webhookInbox.ts
  □ Create functions/src/triggers/orderStatusAlert.ts
  □ Create functions/src/scheduled/promoScheduler.ts
  □ Create functions/src/scheduled/dailyReports.ts
  □ Replace functions/src/taskqueue/processInboundMessage.ts stub with real logic
  □ Add config flag defaults (config/webhookInbox/enabled, config/promoScheduler/enabled,
    config/dailyReports/enabled, config/orderStatusAlert/enabled) — all default false
  □ npm run build (copy-vendor + tsc)
  □ firebase deploy --only functions
  □ Verify functions:list increases from 34 to ~40
  □ Verify no RTDB writes occur (flags OFF = no-ops)

Phase 2 — Cut inbound webhook drain (flag ON)
  □ Set config/webhookInbox/enabled = true in RTDB
  □ Verify webhookInbox entries are drained (entries deleted after processing)
  □ Verify processInboundMessage tasks execute (check Cloud Tasks logs)
  □ Send test WhatsApp message to outlet number → response received

Phase 3 — Cut outbound sends (no separate flag — uses existing sendOutboundMessage)
  □ Verify sendOutboundMessage task queue processes outbound tasks
  □ Verify Graph API calls succeed (200 responses, message IDs returned)
  □ Verify cost recording (metaUsage updated in walletBilling)

Phase 4 — Cut admin alerts (flag ON)
  □ Set config/orderStatusAlert/enabled = true
  □ Place test order → admin receives WhatsApp "NEW ORDER" text
  □ Verify _adminWaNotified dedupe prevents duplicates

Phase 5 — Cut promo scheduler (flag ON)
  □ Set config/promoScheduler/enabled = true
  □ Create test campaign with runAt in near future → message sent at runAt
  □ Verify campaign status transitions scheduled → running → completed

Phase 6 — Cut daily reports (flag ON)
  □ Set config/dailyReports/enabled = true
  □ Verify 21:30 IST report fires (or test via manual trigger)
  □ Verify report content is accurate

Phase 7 — Retire EC2
  □ pm2 stop bot-foodhubbie-pizza-pizza (and any other bot workers)
  □ pm2 delete bot-foodhubbie-pizza-pizza
  □ Verify api.foodhubbie.in no longer needed (all traffic via Cloud Functions URLs)
  □ Verify WhatsApp inbound/outbound works end-to-end without EC2
  □ EC2 instance can be stopped/terminated (save snapshot first)

Phase 8 — Cleanup (after 1 week stable)
  □ Remove bot-control-api/server.js EC2-only routes no longer needed
  □ Remove bot/index.js, bot/transport.js, bot/whatsapp-send.js from repo (optional — keep for reference)
  □ Update AGENTS.md with EC2 retirement record

--------------------------------------------------------------------------------
8. ROLLBACK PLAN
--------------------------------------------------------------------------------

Each config flag is a kill switch:
  config/webhookInbox/enabled = false   → webhookInbox stops draining (messages queue up, safe)
  config/orderStatusAlert/enabled = false → no admin WhatsApp alerts
  config/promoScheduler/enabled = false → no promo campaigns
  config/dailyReports/enabled = false   → no daily reports

Full rollback:
  □ firebase functions:delete <new functions> (or revert deploy)
  □ Set all new flags to false
  □ Re-start EC2 bot (pm2 start) if needed for Baileys fallback
  □ RTDB data (sessions, rateLimits, strikes) can be left — harmless

Data safety:
  □ All new functions use RTDB transactions with cold-tx seeding (cur || seed pattern)
  □ All writes are idempotent (dedupe keys: _adminWaNotified, optout, campaign status)
  □ No function deletes customer data; only its own bookkeeping nodes

--------------------------------------------------------------------------------
9. TESTING STRATEGY
--------------------------------------------------------------------------------

9.1 Unit guards (self-checks, run with `node`):
  tests/webhook-inbox.check.cjs — trigger logic, entry filtering, staleness
  tests/process-inbound.check.cjs — opt-out, strike counting, session get/save
  tests/order-status-alert.check.cjs — status change detection, dedupe
  tests/promo-scheduler.check.cjs — due campaign selection, cap enforcement
  tests/daily-reports.check.cjs — report computation, formatting

9.2 CI steps (add to .github/workflows/ci.yml):
  test:webhook-inbox, test:process-inbound, test:order-status-alert,
  test:promo-scheduler, test:daily-reports

9.3 Live E2E (on e2e outlet, real WhatsApp number):
  □ E2E-1: Inbound text → cloud processes → response sent via Graph API
  □ E2E-2: STOP message → optout recorded → no more promos to that number
  □ E2E-3: Place order → admin gets WhatsApp "NEW ORDER" alert
  □ E2E-4: Campaign scheduled → sent at runAt → status updated
  □ E2E-5: Daily report at 21:30 → admin receives WhatsApp report
  □ E2E-6: 3 non-intent messages → 30-min strike silence (4th message blocked)
  □ E2E-7: EC2 stopped → all above still work (prove EC2 independence)

9.4 Mutation self-tests:
  Each guard includes a "revert to EC2 behavior" mutation test that must fail
  when the cloud function is bypassed (proving the guard actually tests the cloud path).

--------------------------------------------------------------------------------
10. FILE INVENTORY
--------------------------------------------------------------------------------

CREATE:
  PLAN/EC2-RETIREMENT-PLAN.md              (this document)
  PLAN/FUNCTION-SPECS.md                   (detailed function specs)
  PLAN/RTDB-PATH-MAPPING.md                (complete path → function matrix)
  PLAN/TEST-SUITE.md                       (test cases and expected results)
  FIREBASE_SERVER_MIGRATION/functions/src/triggers/webhookInbox.ts
  FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderStatusAlert.ts
  FIREBASE_SERVER_MIGRATION/functions/src/scheduled/promoScheduler.ts
  FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailyReports.ts
  FIREBASE_SERVER_MIGRATION/functions/src/shared/session.ts            (RTDB session get/save)
  FIREBASE_SERVER_MIGRATION/functions/src/shared/rateLimit.ts          (RTDB rate limiter)
  FIREBASE_SERVER_MIGRATION/functions/src/shared/strikeTracker.ts      (3-strike ban proofing)

MODIFY:
  FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/processInboundMessage.ts  (replace stub)
  FIREBASE_SERVER_MIGRATION/functions/src/index.ts                          (add new exports)
  .github/workflows/ci.yml                                                (add test steps)
  package.json                                                            (add test scripts)
  AGENTS.md                                                               (record EC2 retirement plan)

DELETE (after Phase 7 stable, optional):
  bot/index.js, bot/transport.js, bot/whatsapp-send.js, bot/promotions.js
  bot-control-api/server.js (EC2-only routes), bot-control-api/orchestrator.js,
  bot-control-api/status-watcher.js

--------------------------------------------------------------------------------
11. RISK ANALYSIS
--------------------------------------------------------------------------------

Risk | Likelihood | Impact | Mitigation
-----|------------|--------|-----------
Message loss during cutover | Medium | High | webhookInbox entries deleted only after task enqueued; stale entries >30min dropped
Duplicate sends | Low | Medium | Dedupe keys (_adminWaNotified, campaign status, optout) + cold-tx claims
Rate limit bursts | Medium | Medium | RTDB per-sender counters with 4-8s min gap; Cloud Tasks queue concurrency limits
Demo tenant spam | Low | Medium | All new functions hard-skip foodhubbie-demo
Secret exposure | Low | High | All secrets via Secret Manager (secrets.ts); no hardcoded tokens
RTDB cost increase | Medium | Low | New triggers read small leaf nodes; no whole-tree reads (batch-11 lesson)
EC2 termination breaks DNS | Medium | Medium | api.foodhubbie.in is ephemeral IP — move to Cloud Functions URL before terminating EC2

--------------------------------------------------------------------------------
12. SUCCESS CRITERIA (EXIT CONDITIONS)
--------------------------------------------------------------------------------

□ All 6 new Cloud Functions deployed and listed in functions:list
□ All config flags ON and verified via live E2E
□ Inbound WhatsApp message → response received (Graph API 200)
□ Outbound WhatsApp message sent via Cloud Tasks (not EC2 socket)
□ Promo campaign scheduled → sent at runAt
□ Admin receives WhatsApp "NEW ORDER" alert on order placement
□ Daily report sent at 21:30 IST
□ EC2 pm2 bot workers stopped without breaking WhatsApp flow
□ All unit guards pass (100%)
□ All CI steps pass
□ No RTDB whole-tree reads by new functions (egress guard)
□ AGENTS.md updated with EC2 retirement record

--------------------------------------------------------------------------------
13. APPENDIX — FUNCTION SIGNATURES (DETAILED)
--------------------------------------------------------------------------------

See PLAN/FUNCTION-SPECS.md for complete TypeScript signatures, input/output
contracts, and RTDB path matrices for each new function.

--------------------------------------------------------------------------------
END OF PLAN
--------------------------------------------------------------------------------
