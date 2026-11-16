================================================================================
FOODHUBIE — EC2 → CLOUD FUNCTIONS MIGRATION
FUNCTION SPECIFICATIONS (PLAN/FUNCTION-SPECS.md)
================================================================================

This document contains the detailed TypeScript function signatures, input/output
contracts, RTDB path matrices, and logic flows for all 6 new Cloud Functions
plus 3 shared modules needed to retire the EC2 WhatsApp bot.

================================================================================
1. onWebhookInboxMessage — RTDB Trigger
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/triggers/webhookInbox.ts
Type: RTDB onValueWritten
Ref: businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
Region: us-central1
Memory: 256MiB
Timeout: 60s
Secrets: FIREBASE_DATABASE_URL

INPUT (event):
  event.params.bid        string  — business id
  event.params.oid        string  — outlet id
  event.params.pushId     string  — RTDB push key
  event.data.after.val()  object  — { message, receivedAt, source: 'meta-webhook' }
  event.data.before.val() — null for new entries

CONFIG FLAG:
  config/webhookInbox/enabled === true (default false = no-op)

LOGIC FLOW:
  1. If bid === 'foodhubbie-demo' → return (hard skip)
  2. If config/webhookInbox/enabled !== true → return (no-op)
  3. If before exists → return (ignore updates/deletes)
  4. Read after.val() → { message, receivedAt, source }
  5. If !message → delete entry, return
  6. age = Date.now() - receivedAt; if age > 30 min → delete entry, return (stale)
  7. Normalize message:
       - isText = !!message.text?.body
       - isLocation = message.type === 'location' || !!message.location
       - if !isText && !isLocation → delete entry, return
       - jid = last10 digits of message.from + '@s.whatsapp.net'
       - text = message.text.body || ''
       - pushName = message.pushName || ''
  8. Enqueue Cloud Task to processInboundMessage with payload:
       { bid, oid, jid, text, pushName, message, receivedAt, source }
  9. Delete the webhookInbox entry (after.taskEnqueued, not after processing —
     at-most-once: if function crashes after enqueue but before delete, the
     entry is reprocessed; processInboundMessage must be idempotent via
     processed message ID dedupe)
  10. Log: [WebhookInbox] drained {pushId} for {bid}/{oid}

RTDB PATHS READ:
  businesses/{bid}/outlets/{oid}/webhookInbox/{pushId} (trigger itself)
  config/webhookInbox/enabled (flag)

RTDB PATHS WRITTEN:
  businesses/{bid}/outlets/{oid}/webhookInbox/{pushId} → delete (after enqueue)

ERROR HANDLING:
  - Task enqueue failure → log error, do NOT delete entry (retry on next trigger)
  - Invalid jid → log warning, delete entry (cannot route)
  - Any uncaught error → log, do not delete entry (retry)

IDENTICAL TO EC2:
  - bot/transport.js createMetaTransport start() RTDB inbox listener
  - bot/transport.js dispatchInbound() message normalization
  - Max inbox age 30 min (MAX_INBOX_AGE_MS)

================================================================================
2. processInboundMessage — Task Queue (REPLACE STUB)
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/processInboundMessage.ts
Type: Cloud Tasks onTaskDispatched
Task name: processInboundMessage
Region: us-central1
Memory: 256MiB
Timeout: 60s
Secrets: FIREBASE_DATABASE_URL, WA_PERMANENT_TOKEN

INPUT (task payload):
  bid         string  — business id
  oid         string  — outlet id
  jid         string  — WhatsApp JID (@s.whatsapp.net)
  text        string  — message text
  pushName    string  — sender display name
  message     object  — raw Meta message object
  receivedAt  number  — timestamp
  source      string  — 'meta-webhook'

LOGIC FLOW (ported from bot/index.js messages.upsert handler):

  1. If bid === 'foodhubbie-demo' → return
  2. Message ID dedupe:
       msgId = message.id || random
       if getProcessedStatus(msgId) → return (already processed)
       saveProcessedStatus(msgId, {ts: Date.now()})
  3. Non-conversational JID filter:
       if jid matches @newsletter|@broadcast|@g.us → return (skip channels/groups)
  4. Blocklist check:
       phone = digits-only(jid).slice(-10)
       if blockedNumbers contains phone → return (silently ignore)
     blockedNumbers loaded from RTDB settings/Bot/blockedNumbers/{oid} (cached 5 min)
  5. PROMOTIONAL OPT-OUT / OPT-IN (runs before state machine):
       optOutKey = phone
       if text matches /^(stop|unsubscribe|opt[\s-]?out)$/i:
           write bot/promotions/optout/{optOutKey}/{oid} = {jid, optedOutAt}
           send text: "You've been unsubscribed from promotional messages. Reply START to opt back in."
           return
       if text matches /^start$/i:
           if optout exists → update reOptInAt, send welcome-back text, return
       if text matches rejection pattern AND no existing session:
           write optout with reason:'auto-rejection-reply'
           send polite decline text
           return
  6. BAN-PROOFING (strike tracking):
       strikes = read bot/strikes/{jid}/{oid} (count + lastStrikeAt)
       if isJidFrozen(strikes) → return (30-min silence, no processing)
       Note: admins (isSuper/isSupreme/developer) never strike
  7. Session management (RTDB-native, replaces Redis):
       session = read bot/sessions/{jid}/{oid}
       if !session → create default {step:'START', cart:[], pushName, phone, ...}
       session.lastActivity = Date.now()
       session.msgCount++
     Rate limit check:
       if now - session.lastReset > 60s → reset msgCount=0, lastReset=now
       session.msgCount++ → save session
  8. ADMIN COMMANDS (if text starts with '!' and sender is admin):
       !report / !sales → queue daily report (send to admin via sendOutboundMessage)
       !status → send bot status text
       (other commands as in EC2 bot/index.js admin block)
  9. STATE MACHINE (order flow):
       switch session.step:
         START → greeting + menu + order CTA
         MENU_BROWSING → handle dish selection
         CART_REVIEW → handle cart actions
         CHECKOUT → handle delivery/pickup details
         PAYMENT → handle payment method
         etc.
     (Port the full EC2 state machine from bot/index.js:2576-2601+)
  10. CHAT LOGGING:
        logChatMessage({outlet: oid, jid, msgId, from:'customer', text, name: pushName})
        (write to chats/{phone} and chatMeta/{phone} per batch-19 pattern)
  11. Save session to RTDB bot/sessions/{jid}/{oid}
  12. Log: [IN] {jid}: "{text}"

OUTBOND SENDS (from within processInboundMessage):
  All outbound messages go through Cloud Task enqueue to sendOutboundMessage:
    enqueueTask('sendOutboundMessage', {
      to: jid, outlet: oid, businessId: bid,
      type: 'text'|'template'|'image'|'button',
      text: ..., template: {...}, image: {...},
      correlationId: generateCorrelationId()
    })

RTDB PATHS READ:
  config/webhookInbox/enabled
  bot/sessions/{jid}/{oid}
  settings/Bot/blockedNumbers/{oid}
  bot/promotions/optout/{phone}/{oid}
  bot/strikes/{jid}/{oid}
  admins/{uid} (for admin command check)
  businesses/{bid}/outlets/{oid}/settings/Store (store name)

RTDB PATHS WRITTEN:
  bot/sessions/{jid}/{oid} (session state)
  bot/promotions/optout/{phone}/{oid} (opt-out)
  bot/strikes/{jid}/{oid} (strike count)
  chats/{phone}/{msgId} (chat log)
  chatMeta/{phone} (chat meta mirror)
  bot/processedMessages/{msgId} (dedupe, TTL 24h)

SHARED MODULES USED:
  shared/session.ts — getSession/saveSession (RTDB)
  shared/rateLimit.ts — paceOutboundTo replacement
  shared/strikeTracker.ts — isJidFrozen, recordWrongMessage, clearWrongStrikes
  shared/push-inbox.cjs — prunePushInbox (vendored)

IDENTICAL TO EC2:
  - bot/index.js messages.upsert handler (lines 2382-2601)
  - bot/utils.js: paceOutboundTo, isJidFrozen, recordWrongMessage, clearWrongStrikes
  - bot/promotions.js opt-out logic

================================================================================
3. onOrderStatusAlert — RTDB Trigger (NEW)
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderStatusAlert.ts
Type: RTDB onValueWritten
Ref: businesses/{bid}/outlets/{oid}/orders/{orderId}/status
Region: us-central1
Memory: 256MiB
Timeout: 60s
Secrets: FIREBASE_DATABASE_URL

INPUT (event):
  event.params.bid, oid, orderId
  event.data.after.val()  string  — new status (e.g. 'Placed')
  event.data.before.val() string  — previous status

CONFIG FLAG:
  config/orderStatusAlert/enabled === true (default false)

LOGIC FLOW:
  1. If bid === 'foodhubbie-demo' → return
  2. If config/orderStatusAlert/enabled !== true → return
  3. statusAfter = String(after).toLowerCase(); statusBefore = String(before).toLowerCase()
  4. If !statusAfter → return
  5. If before exists && statusAfter === statusBefore → return (no change)
  6. Read full order: businesses/{bid}/outlets/{oid}/orders/{orderId}
  7. If !order → return
  8. If order.source === 'QR' → return (QR orders don't get admin WhatsApp alert)
  9. Dedup check: if order._adminWaNotified === true → return
  10. If statusAfter === 'placed' (first time):
        - Get admin JIDs for this outlet (admins where outlet===oid or isSuper/isSupreme)
        - Compose text: "🆕 New Order #<formatOrderId(orderId)>\n<customer> · <n> items · ₹<total> · <where> · <OUTLET>"
        - Enqueue Cloud Task to sendOutboundMessage for each admin JID
        - Set order._adminWaNotified = true (transaction, cold-tx seeded)
  11. Log: [OrderStatusAlert] admin alert for {orderId} → {statusAfter}

RTDB PATHS READ:
  businesses/{bid}/outlets/{oid}/orders/{orderId}/status (trigger)
  businesses/{bid}/outlets/{oid}/orders/{orderId} (full order)
  config/orderStatusAlert/enabled (flag)
  admins/{uid} (admin JIDs)

RTDB PATHS WRITTEN:
  businesses/{bid}/outlets/{oid}/orders/{orderId}/_adminWaNotified → true

IDENTICAL TO EC2:
  - bot/index.js alertAdminFinalizedWebOrder (line 1184)
  - bot/index.js handleOrderStatusUpdate WhatsApp alert path

================================================================================
4. promoScheduler — Scheduled Function (NEW)
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/scheduled/promoScheduler.ts
Type: onSchedule
Schedule: every 5 minutes, Asia/Kolkata
Region: us-central1
Memory: 256MiB
Timeout: 120s (maxInstances: 1)
Secrets: FIREBASE_DATABASE_URL, WA_PERMANENT_TOKEN

CONFIG FLAG:
  config/promoScheduler/enabled === true (default false)

LOGIC FLOW:
  1. If config/promoScheduler/enabled !== true → return
  2. Read outletIndex → for each {bid, oid}:
       a. If bid === 'foodhubbie-demo' → skip
       b. Read killSwitch from bot/promotions/{oid} → if true → skip
       c. Read campaigns: businesses/{bid}/outlets/{oid}/bot/promotions/campaigns
       d. For each campaign:
            - If status !== 'scheduled' → skip
            - If runAt > now → skip (not due yet)
            - If daily cap reached for today → skip (PROMO_DAILY_LIMIT=300)
            - If warmup limit reached → skip (PROMO_WARMUP_DAILY_LIMITS)
            - Set campaign.status = 'running' (transaction)
            - Get recipient list from campaign.recipients
            - For each recipient phone:
                * Check optout → skip if opted out
                * Check strike/freeze → skip if frozen
                * Enqueue task to sendOutboundMessage with template
                * Increment campaign.stats.sentCount
            - Set campaign.status = 'completed' (or 'paused' if hit limits)
            - Write campaign.stats (sentCount, failedCount, totalCost)
  3. Expire old campaigns (>30 days) — set status='expired', strip inline media
  4. Log: [PromoScheduler] processed {N} campaigns across {M} outlets

RTDB PATHS READ:
  outletIndex
  config/promoScheduler/enabled
  bot/promotions/{oid}/killSwitch
  businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{id}

RTDB PATHS WRITTEN:
  businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{id}/status
  businesses/{bid}/outlets/{oid}/bot/promotions/campaigns/{id}/stats
  bot/promotions/optout/{phone}/{oid} (if recipients opt out during send)

IDENTICAL TO EC2:
  - bot/index.js:2141 promo.pickupScheduledPromotions(currentSock, ...)
  - bot/promotions.js: runPromotionCampaign, resumeStuckPromotions
  - PROMO_DAILY_LIMIT = 300, PROMO_WARMUP_DAILY_LIMITS = [20,40,60,100,150,200,250]

================================================================================
5. dailyReports — Scheduled Function (NEW)
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailyReports.ts
Type: onSchedule
Schedule: 21:30 IST daily (Asia/Kolkata); also weekly Sunday 21:30, monthly 1st 21:30
Region: us-central1
Memory: 256MiB
Timeout: 120s
Secrets: FIREBASE_DATABASE_URL

CONFIG FLAG:
  config/dailyReports/enabled === true (default false)

LOGIC FLOW:
  1. If config/dailyReports/enabled !== true → return
  2. Determine report type by time:
       - 21:30 IST → daily report (today)
       - Sunday 21:30 → weekly report (past 7 days)
       - 1st of month 21:30 → monthly report (past 30 days)
  3. Read outletIndex → for each {bid, oid}:
       a. If bid === 'foodhubbie-demo' → skip
       b. Query orders created in report period:
            businesses/{bid}/outlets/{oid}/orders ordered by createdAt
       c. Compute totals:
            - orderCount, totalSales, totalTax, totalDiscount, totalDeliveryFee
            - by source (APP, WA, QR, POS, other)
            - by status (Placed, Confirmed, Ready, Delivered, Cancelled)
       d. Format report text:
            "📊 Daily Report for <OUTLET_NAME> — <date>\n
             Orders: <n> | Sales: ₹<total>\n
             Top dishes: ...\n
             By channel: APP n, WA n, QR n..."
       e. Get admin JIDs for outlet
       f. Enqueue Cloud Task to sendOutboundMessage for each admin JID
  4. Log: [DailyReports] sent {N} reports

RTDB PATHS READ:
  outletIndex
  config/dailyReports/enabled
  businesses/{bid}/outlets/{oid}/orders (query by createdAt range)
  businesses/{bid}/outlets/{oid}/settings/Store (storeName)
  admins/{uid} (admin JIDs)

RTDB PATHS WRITTEN:
  (none — reports are send-only)

IDENTICAL TO EC2:
  - bot/reports.js sendDailyReport/Weekly/Monthly
  - bot/index.js:2108 sendDailyReportSafely
  - bot/index.js heartbeat (21:30, 1:30, 4:00 IST)

================================================================================
6. sendOutboundMessage — Task Queue (EXISTS — VERIFY)
================================================================================

File: FIREBASE_SERVER_MIGRATION/functions/src/taskqueue/sendOutboundMessage.ts
Type: Cloud Tasks onTaskDispatched (already deployed)
Status: REAL implementation — verify completeness

Already has:
  - sendWhatsAppMessage(phoneNumberId, accessToken, to, text)
  - sendWhatsAppImage(phoneNumberId, accessToken, to, imageUrl, caption)
  - sendWhatsAppUrlButton(phoneNumberId, accessToken, to, {body, url, title, headerImageUrl, footer})
  - sendWhatsAppTemplate(phoneNumberId, accessToken, to, {name, language, components})
  - _postToGraph with retry on 429/5xx (1 retry, Retry-After header)
  - Rate limiter per outlet (800 tokens/sec, refill 1000/sec)
  - recordMetaCost for walletBilling metaUsage tracking

NEEDS VERIFICATION:
  □ Task payload schema matches what processInboundMessage enqueues
  □ Rate limiter keyed by outlet (not global)
  □ Cost recording uses DEFAULT_RATE_TABLE from shared/meta-cost-math
  □ Dead token codes prune FCM tokens (for template sends)
  □ Graph API version v20.0 (matches Meta current)

================================================================================
7. SHARED MODULES (NEW)
================================================================================

7.1 shared/session.ts
  File: functions/src/shared/session.ts
  Exports: getSession(db, resolvePath, jid, oid), saveSession(db, resolvePath, jid, oid, session)
  Path: bot/sessions/{jid}/{oid}
  RTDB-native (no Redis dependency)

7.2 shared/rateLimit.ts
  File: functions/src/shared/rateLimit.ts
  Exports: paceOutboundTo(db, resolvePath, jid, oid) → Promise<void>
  Logic: read bot/rateLimits/{jid}/{oid}, ensure 4-8s gap since last send,
         update counter, return Promise that resolves after required wait
  Path: bot/rateLimits/{jid}/{oid}

7.3 shared/strikeTracker.ts
  File: functions/src/shared/strikeTracker.ts
  Exports: isJidFrozen(strikes), recordWrongMessage(db, resolvePath, jid, oid),
           clearWrongStrikes(db, resolvePath, jid, oid)
  Logic: 3 continuous non-intent messages in AWAITING/WEBVIEW → 30-min silence
  Path: bot/strikes/{jid}/{oid}

================================================================================
8. INDEX.TS EXPORTS TO ADD
================================================================================

Add to FIREBASE_SERVER_MIGRATION/functions/src/index.ts:

  // RTDB Triggers (NEW — EC2 retirement)
  export { onWebhookInboxMessage } from './triggers/webhookInbox';
  export { onOrderStatusAlert } from './triggers/orderStatusAlert';

  // Scheduled (NEW — EC2 retirement)
  export { promoScheduler } from './scheduled/promoScheduler';
  export { dailyReports } from './scheduled/dailyReports';

  // Task Queue (modified — replace stub)
  export { processInboundMessage } from './taskqueue/processInboundMessage';

================================================================================
9. CONFIG FLAG PATHS (RTDB)
================================================================================

  config/webhookInbox/enabled      — gate for webhook inbox drain
  config/orderStatusAlert/enabled  — gate for admin WhatsApp "NEW ORDER" alerts
  config/promoScheduler/enabled    — gate for promo campaign scheduler
  config/dailyReports/enabled      — gate for daily/weekly/monthly reports

All default false → safe deploy, cut in one at a time.

================================================================================
END OF FUNCTION SPECS
================================================================================
