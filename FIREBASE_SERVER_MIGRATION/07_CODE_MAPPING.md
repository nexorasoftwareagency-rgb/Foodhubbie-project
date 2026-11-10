# Code Mapping - EC2 to Firebase Functions

## Overview

This document maps every current EC2 server-side file to its Firebase Functions equivalent.

---

## Bot Control API (`bot-control-api/`)

### Current Structure
```
bot-control-api/
├── server.js              # Express HTTP API
├── wallet-watch.js        # Wallet gate publisher (60s)
├── status-watcher.js      # PM2 status → RTDB
├── orchestrator.js        # Auto-start Meta bots
├── meta-cost-publisher.js # Meta credit balance (5min)
├── whatsapp-graph.js      # Meta Graph API wrapper
├── pm2-client.js          # PM2 connection
└── package.json
```

### Firebase Functions Mapping

| Current File | Function Type | New Location | Notes |
|--------------|---------------|--------------|-------|
| `server.js` (REST endpoints) | **Callable + HTTPS** | `functions/src/api/` | Split by domain |
| `wallet-watch.js` | **Scheduled (adaptive)** | `functions/src/scheduled/walletGateCheck.ts` | 77% fewer invocations |
| `status-watcher.js` | **DELETE** | — | No PM2 in serverless |
| `orchestrator.js` | **DELETE** | — | No PM2 workers to manage |
| `meta-cost-publisher.js` | **Scheduled** | `functions/src/scheduled/metaCostPublisher.ts` | Same schedule |
| `whatsapp-graph.js` | **Shared Library** | `functions/src/shared/whatsapp/metaApi.ts` | Used by workers |
| `pm2-client.js` | **DELETE** | — | Not needed |

### API Endpoint Mapping

| Current Route | Method | New Function | Auth |
|---------------|--------|--------------|------|
| `/api/bot/status/:bid/:oid` | GET | `botControl({action: 'status', bid, oid})` | Supreme |
| `/api/bot/status-all` | GET | `botControl({action: 'statusAll'})` | Supreme |
| `/api/bot/restart/:bid/:oid` | POST | `botControl({action: 'restart', bid, oid})` | Supreme |
| `/api/bot/wallet-gate/:bid/:oid` | POST | `walletGatePublish({bid, oid})` | Supreme |
| `/api/bot/transport/:bid/:oid` | POST | `transportSwitch({bid, oid, transport})` | Supreme |
| `/api/bot/rescan/:bid/:oid` | POST | `transportSwitch({bid, oid, transport: 'baileys', rescan: true})` | Supreme |
| `/api/admin/update-password` | POST | `passwordReset({bid, oid, email, newPassword})` | Supreme |
| `/tenant-api/notify` | POST | `sendAppNotification({...})` | Tenant Admin |
| `/api/whatsapp/quota/:bid/:oid` | GET | `getWhatsAppQuota({bid, oid})` | Supreme |

---

## Bot Worker (`bot/`)

### Current Structure
```
bot/
├── index.js               # Main entry (Baileys + Meta)
├── transport.js           # Transport abstraction
├── utils.js               # Shared utilities
├── firebase.js            # RTDB helpers
├── promotions.js          # Promo campaigns
├── reports.js             # Daily/weekly/monthly reports
├── rider.js               # Rider notifications
├── notification-caps.js   # Push notification limits
├── wallet-gate.js         # Wallet gate reader
├── order-pricing.js       # Order total verification
├── redeem.js              # Loyalty redemption
├── payment-sync.js        # Payment verification
├── discount-engine.js     # Discount evaluation
├── chat-log.js            # Chat logging
├── backup-sessions.js     # Session backup
├── backfill-analytics.js  # Analytics backfill
├── send-pacer.js          # Rate limiting
├── p38-measure.js         # Performance measurement
├── p38-payload.js         # Payload analysis
├── whatsapp-send.js       # Baileys send helpers
├── verify-onboarding-rules.js
├── helpers/
│   └── outlet-resolution.js
└── tests/
```

### Firebase Functions Mapping

| Current File | Function Type | New Location | Notes |
|--------------|---------------|--------------|-------|
| `index.js` (Baileys) | **DELETE** | — | No Baileys in Functions |
| `index.js` (Meta receive) | **HTTPS** | `functions/src/api/whatsappWebhook.ts` | Webhook entry |
| `transport.js` (Meta send) | **Task Queue** | `functions/src/taskqueue/sendOutboundMessage.ts` | Async send |
| `utils.js` | **Shared Library** | `functions/src/shared/utils/` | Split by domain |
| `firebase.js` | **Shared Library** | `functions/src/shared/firebase/` | Admin SDK singleton |
| `promotions.js` | **Task Queue + Scheduled** | `functions/src/taskqueue/runPromoCampaign.ts` + `functions/src/scheduled/promoScheduler.ts` | Split |
| `reports.js` | **Scheduled** | `functions/src/scheduled/reports.ts` | Same logic |
| `rider.js` | **Task Queue + Trigger** | `functions/src/taskqueue/notifyRider.ts` + `functions/src/triggers/onRiderAssign.ts` | |
| `notification-caps.js` | **Shared Library** | `functions/src/shared/notifications/caps.ts` | |
| `wallet-gate.js` | **DELETE** | — | Replaced by scheduled writer |
| `order-pricing.js` | **Shared Library** | `functions/src/shared/orders/pricing.ts` | |
| `redeem.js` | **Task Queue** | `functions/src/taskqueue/processRedeem.ts` | |
| `payment-sync.js` | **Task Queue + Trigger** | `functions/src/taskqueue/verifyPayment.ts` + `functions/src/triggers/onOrderPaymentChange.ts` | |
| `discount-engine.js` | **Shared Library** | `functions/src/shared/orders/discounts.ts` | Port from shared/discount-rules |
| `chat-log.js` | **DELETE** | — | Not needed for Meta API |
| `backup-sessions.js` | **DELETE** | — | No Baileys sessions |
| `backfill-analytics.js` | **DELETE** | — | One-time script |
| `send-pacer.js` | **Shared Library** | `functions/src/shared/utils/rateLimiter.ts` | |
| `p38-*.js` | **DELETE** | — | Debug tools |
| `whatsapp-send.js` | **DELETE** | — | Baileys only |
| `verify-onboarding-rules.js` | **Callable** | `functions/src/api/onboardingApprove.ts` | |
| `helpers/outlet-resolution.js` | **Shared Library** | `functions/src/shared/firebase/paths.ts` | |

### Message Processing Flow Mapping

```
EC2 (bot/index.js)                          Firebase Functions
─────────────────────────                   ──────────────────
Baileys socket.on('message')     →          HTTPS webhookWebhook
  │                                           │
  ├─ Parse message                    →       ├─ Verify signature
  ├─ Load session                     →       ├─ Parse + enqueue
  ├─ Route to handler                 →       │    (processInboundMessage)
  ├─ Execute logic                    →       │
  ├─ Send reply via sock.sendMessage  →       │    Task Queue
  └─ Update RTDB                      →       │    sendOutboundMessage
                                              │         │
                                              │         ▼
                                              │    Meta Graph API
                                              │         │
                                              │         ▼
                                              │    Update RTDB
                                              ▼
```

---

## Shared Libraries (`shared/`)

### Current Structure
```
shared/
├── money-math.js           # Order totals
├── loyalty-math.js         # Loyalty calculations
├── cost-math.js            # Billing/wallet
├── discount-rules.js       # Discount engine
├── format-order-id.js      # Order ID formatting
├── app-link.js             # Customer app links
├── app-update.js           # Update popup
├── billing-defaults.cjs    # Plan defaults
├── push-inbox.cjs          # Push notification inbox
├── meta-cost-math.cjs      # Meta cost rates
├── geo/
│   └── geo.js              # Distance/fee calculation
├── config/
│   └── vapid.js            # FCM VAPID key
└── menu-bank.js            # Menu sharing
```

### Firebase Functions Mapping

| Current File | New Location | Notes |
|--------------|--------------|-------|
| `money-math.js` | `functions/src/shared/orders/pricing.ts` | Direct port, TypeScript |
| `loyalty-math.js` | `functions/src/shared/loyalty/earn.ts` + `redeem.ts` | Direct port |
| `cost-math.js` | `functions/src/shared/wallet/compute.ts` + `gate.ts` | Direct port |
| `discount-rules.js` | `functions/src/shared/orders/discounts.ts` | Direct port |
| `format-order-id.js` | `functions/src/shared/utils/format.ts` | Merged |
| `app-link.js` | `functions/src/shared/utils/links.ts` | Merged |
| `app-update.js` | **DELETE** | Client-side only |
| `billing-defaults.cjs` | `functions/src/shared/config/billing.ts` | ESM conversion |
| `push-inbox.cjs` | `functions/src/shared/notifications/inbox.ts` | ESM conversion |
| `meta-cost-math.cjs` | `functions/src/shared/whatsapp/metaCost.ts` | ESM conversion |
| `geo/geo.js` | `functions/src/shared/orders/geo.ts` | Direct port |
| `config/vapid.js` | `functions/src/shared/config/vapid.ts` | Direct port |
| `menu-bank.js` | **DELETE** | Not used in Functions |

---

## Admin Dashboard (`Admin/js/`)

### Current API Calls → New Callable Functions

| Current Call | New Function |
|--------------|--------------|
| `GET /api/bot/status/:bid/:oid` | `botControl({action: 'status', bid, oid})` |
| `GET /api/bot/status-all` | `botControl({action: 'statusAll'})` |
| `POST /api/bot/restart/:bid/:oid` | `botControl({action: 'restart', bid, oid})` |
| `POST /api/bot/wallet-gate/:bid/:oid` | `walletGatePublish({bid, oid})` |
| `POST /api/bot/transport/:bid/:oid` | `transportSwitch({bid, oid, transport})` |
| `POST /api/bot/rescan/:bid/:oid` | `transportSwitch({bid, oid, transport: 'baileys', rescan: true})` |
| `POST /api/admin/update-password` | `passwordReset({bid, oid, email, newPassword})` |
| `POST /tenant-api/notify` | `sendAppNotification({title, body, data, target})` |
| `GET /api/whatsapp/quota/:bid/:oid` | `getWhatsAppQuota({bid, oid})` |

### Client-Side Migration

```typescript
// Admin/js/firebase.js - OLD
export async function restartBot(bid, oid) {
  const res = await fetch(`/api/bot/restart/${bid}/${oid}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

// Admin/js/firebase.js - NEW
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const botControl = httpsCallable(functions, 'botControl');

export async function restartBot(bid, oid) {
  const result = await botControl({ action: 'restart', bid, oid });
  return result.data;
}
```

---

## Supreme Admin (`SupremeAdmin/js/`)

### Current API Calls → New Callable Functions

| Current Call | New Function |
|--------------|--------------|
| Onboarding approval | `onboardingApprove({requestKey, reviewerUid})` |
| Transport switch | `transportSwitch({bid, oid, transport})` |
| Password reset | `passwordReset({bid, oid, email, newPassword})` |
| Wallet gate publish | `walletGatePublish({bid, oid})` |
| WhatsApp quota | `getWhatsAppQuota({bid, oid})` |
| Billing payments | `recordPayment({bid, oid, amount, method, ...})` |
| Template submission | `submitWaTemplates({bid, oid, wabaId, templates})` |

---

## Menu/Customer App (`menu/js/`)

### Current API Calls → New Callable/HTTPS Functions

| Current Call | New Function |
|--------------|--------------|
| Place order (QR) | `qrMenuOrder({bid, oid, cart, sessionId, tableId})` |
| Verify payment | `qrMenuPayment({bid, oid, orderId, paymentId, gateway})` |
| Get wallet gate | **RTDB listener** on `outlets/{oid}/walletGate` |
| FCM token registration | **Callable** `registerFcmToken({token, bid, oid})` |
| Loyalty redeem | **Callable** `redeemReward({bid, oid, rewardCode})` |

---

## Rider App (`rider-app/src/`)

### Current API Calls → New Callable/HTTPS Functions

| Current Call | New Function |
|--------------|--------------|
| Accept order | **Callable** `acceptOrder({bid, oid, orderId, riderId})` |
| Update location | **RTDB write** to `riders/{riderId}/location` |
| Mark delivered | **Callable** `markDelivered({bid, oid, orderId, riderId})` |
| SOS alert | **Callable** `triggerSos({bid, oid, riderId, location})` |

---

## Deleted Code (Not Migrated)

| File/Component | Reason |
|----------------|--------|
| Baileys socket management | Not compatible with Functions |
| PM2 process management | No PM2 in serverless |
| Session file backup (`session_data_*`) | Baileys only |
| Crypto session monitoring | Baileys only |
| Health check HTTP server | Functions have built-in health |
| Ban detection (send failures) | Meta API handles differently |
| Redis session storage (Baileys) | Not needed for Meta API |
| Outbound tracker (Baileys analytics) | Meta provides delivery receipts |
| `p38-measure.js`, `p38-payload.js` | Debug tools |
| `backfill-analytics.js` | One-time script |
| `chat-log.js` | Meta webhook provides message log |
| `whatsapp-send.js` | Baileys only |
| `send-pacer.js` (Baileys) | Meta rate limits different |
| `verify-onboarding-rules.js` logic | Moved to callable |
| `status-watcher.js` | No PM2 |
| `orchestrator.js` | No PM2 workers |

---

## New Code (Firebase Functions Only)

| Component | Purpose |
|-----------|---------|
| `whatsappWebhook.ts` | Meta webhook entry point |
| `processInboundMessage.ts` | Core message routing |
| `sendOutboundMessage.ts` | Meta Graph API sender |
| `walletGateCheck.ts` | Adaptive wallet gate |
| `promoScheduler.ts` | Event-driven promo queueing |
| `runPromoCampaign.ts` | Promo batch sender |
| `onOrderStatusChange.ts` | Order lifecycle triggers |
| `onWalletUpdate.ts` | Wallet gate recompute |
| `onPromoCampaignCreate.ts` | Campaign auto-queue |
| `metaApi.ts` | Graph API client with retry |
| `rateLimiter.ts` | Per-outlet rate limiting |
| `deadLetterQueue.ts` | Failed task handling |
| `metrics.ts` | Custom Cloud Monitoring metrics |

---

## Porting Checklist per File

### `shared/money-math.js` → `shared/orders/pricing.ts`
- [ ] Convert to TypeScript
- [ ] Add JSDoc types
- [ ] Export `computeOrderTotals`, `round2`, `recomputeTaxOnTaxable`
- [ ] Unit tests ported
- [ ] Self-check runs in CI

### `shared/loyalty-math.js` → `shared/loyalty/`
- [ ] Convert to TypeScript
- [ ] Split: `earn.ts`, `redeem.ts`, `tiers.ts`
- [ ] Export all functions
- [ ] Unit tests ported

### `shared/cost-math.js` → `shared/wallet/`
- [ ] Convert to TypeScript
- [ ] Split: `compute.ts`, `gate.ts`, `metaCost.ts`
- [ ] Export all functions
- [ ] Unit tests ported

### `shared/discount-rules.js` → `shared/orders/discounts.ts`
- [ ] Convert to TypeScript
- [ ] Export `evaluateDiscounts`, `couponStatus`, `inSchedule`
- [ ] Unit tests ported

### `bot/transport.js` (Meta parts) → `shared/whatsapp/metaApi.ts`
- [ ] Extract `createMetaTransport` → `MetaApiClient` class
- [ ] Implement `sendTemplate`, `sendText`, `sendImage`
- [ ] Add retry logic with exponential backoff
- [ ] Add rate limiting (Meta limits)
- [ ] Unit tests with mocked fetch

### `bot/promotions.js` → `taskqueue/runPromoCampaign.ts` + `scheduled/promoScheduler.ts`
- [ ] Extract campaign runner logic
- [ ] Remove Baileys-specific code
- [ ] Implement `isMetaTransport` check
- [ ] Add cost guard integration
- [ ] Port opt-out/freeze logic

### `bot/reports.js` → `scheduled/reports.ts`
- [ ] Convert to TypeScript
- [ ] Use Admin SDK for RTDB reads
- [ ] Send via FCM (not WhatsApp)
- [ ] Scheduled trigger config

---

## TypeScript Interfaces (New)

```typescript
// functions/src/shared/types/index.ts

// Webhook
export interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<MetaMessage>;
        statuses?: Array<MetaStatus>;
      };
      field: 'messages';
    }>;
  }>;
}

export interface MetaMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'order' | 'location';
  text?: { body: string };
  interactive?: MetaInteractive;
  button?: MetaButton;
  order?: MetaOrder;
  location?: MetaLocation;
}

// Task Queue Payloads
export interface ProcessInboundMessagePayload {
  message: MetaMessage;
  outlet: string;
  businessId: string;
  phoneNumberId: string;
}

export interface SendOutboundMessagePayload {
  to: string;
  outlet: string;
  businessId: string;
  type: 'template' | 'text' | 'image' | 'document';
  template?: { name: string; language: string; components: any[] };
  text?: string;
  image?: { url: string; caption?: string };
  document?: { url: string; filename?: string; caption?: string };
}

// Callable Payloads
export interface BotControlPayload {
  action: 'status' | 'statusAll' | 'restart' | 'transport' | 'rescan';
  bid?: string;
  oid?: string;
  transport?: 'meta' | 'baileys';
  rescan?: boolean;
}

export interface OnboardingApprovePayload {
  requestKey: string;
  reviewerUid: string;
}

// RTDB Trigger Context
export interface OrderStatusChangeContext {
  bid: string;
  oid: string;
  orderId: string;
  before: string | null;
  after: string | null;
}
```

---

## Deployment Order

1. **Shared Libraries** (Week 0)
   - `shared/utils/`, `shared/firebase/`, `shared/config/`
   - `shared/orders/pricing.ts`, `shared/loyalty/`, `shared/wallet/`, `shared/orders/discounts.ts`
   - `shared/whatsapp/metaApi.ts`, `shared/whatsapp/metaCost.ts`

2. **Webhook + Task Queues** (Week 1-2)
   - `api/whatsappWebhook.ts`
   - `taskqueue/processInboundMessage.ts`
   - `taskqueue/sendOutboundMessage.ts`

3. **Scheduled Functions** (Week 3)
   - `scheduled/walletGateCheck.ts`
   - `scheduled/metaCostPublisher.ts`
   - `scheduled/reports.ts`
   - `scheduled/promoScheduler.ts`

4. **Callable Functions** (Week 3-4)
   - `api/botControl.ts`
   - `api/onboardingApprove.ts`
   - `api/transportSwitch.ts`
   - `api/passwordReset.ts`
   - `api/walletGatePublish.ts`
   - `api/sendAppNotification.ts`
   - `api/getWhatsAppQuota.ts`
   - `api/qrMenuOrder.ts`
   - `api/qrMenuPayment.ts`

5. **RTDB Triggers** (Week 4)
   - `triggers/onOrderStatusChange.ts`
   - `triggers/onOrderPaymentChange.ts`
   - `triggers/onWalletUpdate.ts`
   - `triggers/onPromoCampaignCreate.ts`
   - `triggers/onCustomerCreate.ts`
   - `triggers/onRiderAssign.ts`

6. **Auth Triggers** (Week 4)
   - `triggers/onUserCreate.ts`
   - `triggers/onUserDelete.ts`