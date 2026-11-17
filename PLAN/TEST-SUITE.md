================================================================================
SUPERSEDED 2026-11-17 — DO NOT IMPLEMENT FROM THIS DOCUMENT
================================================================================

The EC2-retirement goal was reversed. EC2 is retained permanently as a scoped
socket host; Cloud Functions own every database effect. Authoritative document:

    PLAN/BACKEND-ARCHITECTURE.md

The guards described here for deleted functions were themselves deleted with
their subjects (`tests/webhook-inbox`, `process-inbound`, `order-status-alert`,
`promo-scheduler`, `daily-reports`). `tests/egress-guard.check.cjs` survives and
still matters. The provisioning gate for a rebuilt box is `tools/verify-box.sh`
(24 gates, `BACKEND-ARCHITECTURE.md` §5 Phase 10).

Kept in the repository because the FIREBASE_SERVER_MIGRATION/ batch records
reference it.

================================================================================
FOODHUBIE — EC2 → CLOUD FUNCTIONS MIGRATION
TEST SUITE (PLAN/TEST-SUITE.md)
================================================================================

Test strategy for retiring EC2 WhatsApp bot. All guards run with `node` (self-checks)
and are wired into CI (.github/workflows/ci.yml) and package.json scripts.

================================================================================
1. UNIT GUARDS (self-checks)
================================================================================

1.1 tests/webhook-inbox.check.cjs
  Purpose: Verify onWebhookInboxMessage trigger logic
  Checks:
    1. Demo tenant hard-skipped (foodhubbie-demo returns early)
    2. Config flag OFF → no-op (no task enqueued, no entry deleted)
    3. Before exists → no-op (ignore updates)
    4. No message → entry deleted, return
    5. Entry older than 30 min → deleted, return (staleness)
    6. Non-text/non-location message → deleted, return
    7. Valid text message → task enqueued with correct payload, entry deleted
    8. Invalid JID → warning logged, entry deleted
    9. Task enqueue failure → entry NOT deleted (retry safety)
    10. RTDB egress guard: no db.ref('businesses').once('value') in source
  Expected: 10/10 pass
  CI: npm run test:webhook-inbox

1.2 tests/process-inbound.check.cjs
  Purpose: Verify processInboundMessage message pipeline
  Checks:
    1. Demo tenant hard-skipped
    2. Message ID dedupe: same msgId processed twice → second is no-op
    3. Non-conversational JID (@newsletter/@broadcast/@g.us) → skipped
    4. Blocked number → silently ignored
    5. STOP message → optout written, unsubscribe text queued, return
    6. START message after opt-out → reOptInAt written, welcome-back text queued, return
    7. Rejection reply + no session → auto-optout, decline text queued, return
    8. Session get/save (RTDB) works — create, read, update
    9. Rate limiting: rapid sends → 4-8s gap enforced (mocked clock)
    10. Strike tracking: 3 non-intent messages → frozen, 4th blocked
    11. Admin never strikes (isSuper bypass)
    12. Admin command !report → report task queued
    13. Chat logging: inbound message written to chats/ + chatMeta/
    14. Outbound enqueue: all sends go to sendOutboundMessage task (not sock.sendMessage)
    15. RTDB egress guard: no whole-tree reads
  Expected: 15/15 pass
  CI: npm run test:process-inbound

1.3 tests/order-status-alert.check.cjs
  Purpose: Verify onOrderStatusAlert trigger
  Checks:
    1. Demo tenant hard-skipped
    2. Config flag OFF → no-op
    3. No status change (before === after) → no-op
    4. QR source orders → no admin alert
    5. First 'Placed' status → admin alert task enqueued, _adminWaNotified set
    6. Duplicate 'Placed' event → deduped (_adminWaNotified already true)
    7. Non-'Placed' status change → no alert (only first Placed)
    8. Admin JIDs resolved correctly (outlet match + isSuper/isSupreme)
    9. RTDB egress guard: no whole-tree reads
  Expected: 9/9 pass
  CI: npm run test:order-status-alert

1.4 tests/promo-scheduler.check.cjs
  Purpose: Verify promoScheduler
  Checks:
    1. Config flag OFF → no-op
    2. Demo tenant skipped
    3. Kill switch outlet → skipped
    4. Campaign not scheduled → skipped
    5. Campaign runAt in future → skipped
    6. Daily cap reached → campaign paused, no sends
    7. Warmup limit enforced
    8. Due campaign → status set to 'running', send tasks enqueued
    9. Opt-out recipients skipped
    10. Campaign completed → status set to 'completed', stats written
    11. Old campaigns (>30d) → expired, inline media stripped
    12. RTDB egress guard: no whole-tree reads
  Expected: 12/12 pass
  CI: npm run test:promo-scheduler

1.5 tests/daily-reports.check.cjs
  Purpose: Verify dailyReports
  Checks:
    1. Config flag OFF → no-op
    2. Demo tenant skipped
    3. Daily report (21:30 IST) computes correct totals
    4. Weekly report (Sunday) computes 7-day totals
    5. Monthly report (1st) computes 30-day totals
    6. Report text formatted correctly (orders, sales, by channel)
    7. Admin tasks enqueued for each outlet
    8. RTDB egress guard: no whole-tree reads (indexed query by createdAt)
  Expected: 8/8 pass
  CI: npm run test:daily-reports

1.6 tests/egress-guard.check.cjs
  Purpose: Verify NO function reads whole `businesses` tree
  Checks:
    1. webhookInbox.ts: no db.ref('businesses').once('value')
    2. orderStatusAlert.ts: no whole-tree read
    3. promoScheduler.ts: no whole-tree read
    4. dailyReports.ts: no whole-tree read
    5. processInboundMessage.ts: no whole-tree read
    6. All new shared modules: no whole-tree read
  Expected: 6/6 pass
  CI: npm run test:egress-guard

================================================================================
2. MUTATION SELF-TESTS
================================================================================

Each guard includes a mutation test: point the guard at a reverted copy
(`git show HEAD:<file>`) of the EC2 logic and verify the guard FAILS
(proving it actually tests the cloud path, not the EC2 path).

Example:
  WEBHOOK_FILE=$(git show HEAD:bot/transport.js > /tmp/reverted.js)
  node tests/webhook-inbox.check.cjs --reverted /tmp/reverted.js → must exit 1

================================================================================
3. LIVE E2E (e2e outlet, real WhatsApp number)
================================================================================

File: %TEMP%/opencode/e2e-ec2-retirement.cjs

E2E-1: Inbound WhatsApp message → cloud processes → response sent
  - Send text "menu" to outlet WhatsApp number
  - Verify: webhookInbox entry created → drained → processInboundMessage task runs
  - Verify: response message sent via sendOutboundMessage (Graph API 200)
  - Verify: session saved in bot/sessions/{jid}/{oid}

E2E-2: STOP opt-out
  - Send "STOP" to outlet number
  - Verify: bot/promotions/optout/{phone} written
  - Verify: no further promo messages to that number

E2E-3: Admin "NEW ORDER" alert
  - Place test order (source: APP or webview_delivery)
  - Verify: admin receives WhatsApp text "🆕 New Order #..."
  - Verify: order._adminWaNotified = true
  - Verify: duplicate status change does not send second alert

E2E-4: Promo campaign scheduler
  - Create campaign with runAt in 2 minutes
  - Verify: at runAt, campaign status → 'running', send tasks enqueued
  - Verify: after sends, campaign status → 'completed', stats written

E2E-5: Daily report
  - Wait for 21:30 IST (or trigger manually via Cloud Console)
  - Verify: admin receives WhatsApp report with correct totals

E2E-6: Ban-proofing strikes
  - Send 3 non-intent messages ("who is this", "not interested", "wrong number")
  - Verify: 3rd message triggers 30-min freeze
  - Verify: 4th message within 30 min is blocked (no response)
  - Verify: after 30 min, messages work again

E2E-7: EC2 independence (THE KEY TEST)
  - Ensure EC2 pm2 bot workers are STOPPED
  - Verify: E2E-1 through E2E-6 all still work
  - Verify: api.foodhubbie.in unreachable (or ignored) — all traffic via Cloud Functions
  - Verify: WhatsApp inbound/outbound fully functional without EC2

================================================================================
4. CI INTEGRATION
================================================================================

Add to .github/workflows/ci.yml:

      - name: Webhook inbox guard
        run: node tests/webhook-inbox.check.cjs

      - name: Process inbound message guard
        run: node tests/process-inbound.check.cjs

      - name: Order status alert guard
        run: node tests/order-status-alert.check.cjs

      - name: Promo scheduler guard
        run: node tests/promo-scheduler.check.cjs

      - name: Daily reports guard
        run: node tests/daily-reports.check.cjs

      - name: RTDB egress guard
        run: node tests/egress-guard.check.cjs

Add to package.json scripts:

    "test:webhook-inbox": "node tests/webhook-inbox.check.cjs",
    "test:process-inbound": "node tests/process-inbound.check.cjs",
    "test:order-status-alert": "node tests/order-status-alert.check.cjs",
    "test:promo-scheduler": "node tests/promo-scheduler.check.cjs",
    "test:daily-reports": "node tests/daily-reports.check.cjs",
    "test:egress-guard": "node tests/egress-guard.check.cjs",
    "test:ec2-retirement": "npm run test:webhook-inbox && npm run test:process-inbound && npm run test:order-status-alert && npm run test:promo-scheduler && npm run test:daily-reports && npm run test:egress-guard"

================================================================================
5. EXPECTED FUNCTIONS:LIST COUNT
================================================================================

Before: 34 v2 functions
After:  ~40 v2 functions (+6 new: webhookInbox, orderStatusAlert, promoScheduler, dailyReports + processInboundMessage replace + sendOutboundMessage already exists)

Verify: firebase functions:list → count matches expected

================================================================================
END OF TEST SUITE
================================================================================
