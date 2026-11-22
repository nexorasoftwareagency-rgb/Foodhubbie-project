# 44 — Order alerts + daily reports move to the Cloud API (batch 23n)

Commit `0724be7`. Deployed: `onOrderStatusAlert`, `dailyReports`. Deleted: `promoScheduler`,
`shared/orders/handlers.ts`.
**Both new functions ship flag-off (`config/orderStatusAlert`, `config/dailyReports` absent), so live
behaviour is unchanged.**

## 1. What this batch finished

After 23m the inbound leg ran on Functions, but two outbound WhatsApp paths still needed the EC2
socket: the "NEW ORDER" alert to the restaurant and the 09:30 / 21:30 daily report. With the box down
a tenant got no order alert and no report. Both are pure Admin SDK + a Graph call — no socket — so
they moved like 23e / 23f / 23g.

`promoScheduler` was in the same "not yet deployed" list and was **deleted instead of ported** (§4).

## 2. `onOrderStatusAlert` — 138 lines

```
onValueWritten  businesses/{bid}/outlets/{oid}/orders/{orderId}/stockDeducted
```

### 2.1 Why the `stockDeducted` leaf and not `status`

`stockDeducted` is written by the order finalizer **once**, after re-pricing, tax re-derivation, the
discount re-check, reward burn and stock deduction. Three things follow:

- A **payment mirror**, a **KOT stamp** or a **`_fcmSent`** marker cannot wake the sender, because
  none of them touches that leaf. Listening on `status` would have fired the alert on every delivery
  transition.
- The body always carries **corrected money**. The customer's browser writes the claim; the price a
  tenant is told about is the one the finalizer computed.
- `after.val() !== true` early-returns for every other write, including the false→true→false churn a
  replay produces.

### 2.2 The rest of the guard chain

| Guard | Reason |
|---|---|
| demo tenant hard-skip | the nightly reseed writes 363 orders; the admin audience matches every `isSuper`, so leaving it unskipped would page the owner's real phone every night |
| `config/orderStatusAlert/enabled === true` | checked **after** `initializeAdmin()`, so the gate read is legal on a cold start |
| `WEB_ORDER_SOURCES = ['webview_delivery','APP']` | QR/POS/Dine-in orders are the tenant's own screen; only browser-written orders need the alert |
| `order._adminWaNotified === true` | idempotency across replays *and* across a bot/cloud overlap |
| **transport built BEFORE the claim** | a tenant with no `whatsapp` node must not burn `_adminWaNotified` — the alert would be lost for ever. Proven live (phase B). |
| `_adminWaNotified` claim by cold-tx-seeded transaction | two concurrent invocations cannot both send |
| per-recipient send with masked failure logs | one bad recipient must not abort the others, and a phone number must not be logged in full |

Body = the bot's `notifyAdmin('NEW')` **verbatim**: `buildNewOrderMessage(order, orderId)` renders the
item lines **with size**, the total, the loyalty tender / payable split when a reward was used, and
`⚠️ CHECK PRICES` when the finalizer flagged a price mismatch.

## 3. `dailyReports` — 226 lines

```
onSchedule('30 1,21 * * *', { timeZone: 'Asia/Kolkata', maxInstances: 1,
                             secrets: ['FIREBASE_DATABASE_URL','WA_PERMANENT_TOKEN'] })
```

### 3.1 The 01:30 run is the catch-up

`isCatchUp = ist.hour === 1` → `addISTDays(now, -1)`. So the 21:30 run reports today and the 01:30 run
re-attempts yesterday — a tenant whose 21:30 send failed is retried six hours later instead of
waiting a day. `maxInstances: 1` keeps two passes from interleaving.

### 3.2 `orders.createdAt` is an ISO string

Live-verified: `createdAt` is `"2026-11-22T06:30:00.000Z"`, **not** a timestamp. Any
`orderByChild('createdAt')` range query must therefore use **ISO string** bounds
(`istDayBounds()` → `startIso` / `endIso`), and `Number(o.createdAt)` is `NaN`. This is a real trap:
the `.indexOn` declaration was already correct, so a numeric bound would look right and silently
return zero rows. Proven live with a control query — 3 of 4 seeded orders, the 5-day-old one excluded.

### 3.3 Revenue basis and the claim

- `costMath.isBilledOrder(o)` — cancelled, refunded and abandoned `Pending` orders never count as
  sales. Live-proven with a cancelled ₹999 order inside the day: reported revenue stayed `333.00`.
- The per-outlet claim `meta/dailyReports/last/{bid}/{oid}` is written **only when `sent > 0`**.
  A total send failure must be retried by the next run, never marked "sent".
- A claim already holding the target date short-circuits to `skippedAlreadySent` and is **not**
  rewritten (live-proven).
- `skippedNoOrders` when `orderCount === 0` — the pass does not claim, so an outlet that trades later
  that day still gets its 21:30 report.
- Enumerates **`outletIndex` only** — never the `businesses` tree (the batch-11/14/15 egress bug
  class). Note the consequence found during the E2E: an outlet missing from `outletIndex` is
  correctly invisible, so a test tenant must be registered temporarily to exercise the per-outlet
  body.

## 4. Deleted, not ported

### `promoScheduler`

It ported only the "which campaigns are due" half and handed the recipient list to
`sendOutboundMessage`. The real engine is ~700 lines in `bot/promotions.js`: 4–8 s pacing, opt-out
enforcement, prepaid token accounting, Hinglish template shells, pause reasons, the prepaid/covered
send split. Shipping the stub would have produced a campaign sender that ignores consent and pacing —
the top two ban triggers. Promos are `transport-blocked` on Baileys anyway, so it becomes its own
batch once Meta is the only transport. Do not re-add a stub.
`tests/promo-scheduler.check.cjs` was deleted with it.

### `shared/orders/handlers.ts`

Verified unimported — dead code, deleted.

### Weekly / monthly WhatsApp reports are deliberately NOT scheduled

In the bot they were reachable only through the `bot/commands` listener, and nothing in Admin ever
wrote those actions. Scheduling them would be a new product, not parity.

## 5. Verification

**Guards, 0 failures:** `daily-reports` 27/27 · `order-status-alert` 25/25 · `egress-guard` 20/20 ·
`webhook-inbox` 21/21 · `process-inbound` 14/14 · `functions-source` 198/0 · `order-finalizer` 105/0 ·
`loyalty-engine` 44/0 · `rider-notify` 23/0 · `daily-settlement` 30/0 · `wallet-gate` 61/61 ·
`bot/tests/unit.test.js` ok · twins 8 pairs · encoding ok.

**`functions:list`** → both v2, us-central1, 256 MB, nodejs22;
`firebase-schedule-dailyReports-us-central1` **ENABLED** at `30 1,21 * * *` Asia/Kolkata.

**Live gate probe:** `config/webhookInbox`, `config/orderStatusAlert`, `config/dailyReports` all
`null`; the four relay flags all `enabled: true`; `meta/dailyReports` null; pizza orders with
`_adminWaNotified` = 0; `walletBilling/roshani-pizza/pizza/metaUsage` null. **Both functions are
inert.**

**Live E2E, three harness passes, 24/24, every fixture restored byte-identically** on the e2e tenant
(`e2e-biz-1794093154662` / `e2e-outlet-1794093154662`), synthetic orders created already carrying
`stockDeducted: true` + `_fcmSent: true` so neither the finalizer nor the push relay can interfere:

| Phase | Proof |
|---|---|
| A | flag absent → no claim |
| B | flag on, tenant has **no** `whatsapp` node → **no claim burned** (the transport-before-claim fix) |
| C | flag on + temporary `whatsapp` node → claim written, Graph send attempted |
| D | `stockDeducted` true→false→true replay → claim holds, marker untouched, no second send |
| E | `source:'QR'` → ignored |
| F | `stockDeducted:false` with the finalizer held → ignored |
| G | demo tenant → hard-skipped |
| H | flag removed → silent again |
| I | `dailyReports` flag off → no pass writes a claim |
| J | flag on, real `gcloud scheduler jobs run` → 3 of 4 seeded orders found, revenue `333.00`, store branded, recipients resolved, `sent: 0` → **no claim** |
| K | a claim already holds the date → `skippedAlreadySent: 1`, claim not rewritten |

### Two harness bugs — worth remembering

1. **`stockDeducted:false` is not inert while the finalizer relay is live.** The order is simply an
   unfinalized web order, so the cloud finalizer finalises it seconds later and the alert then fires
   **correctly** (`after === true`). Phase F first failed for that reason. To exercise the
   `after !== true` gate in isolation the order needs a fresh `finalizeClaim` (5-minute hold) — no
   flag has to be touched. **The failure was the harness's, not the function's.**
2. **`outletIndex` is the canonical real-outlet registry** and the e2e tenant is deliberately absent,
   so an unregistered outlet reports `skippedNoOrders` and never reaches the per-outlet body. Register
   it temporarily, then remove it.

## 6. What is still on the box

The `bot/commands` listener. Six client senders queue commands nothing consumes while EC2 is down:

| Caller | Command |
|---|---|
| `Admin/js/features/chat.js:538` | `SEND_GENERIC_MESSAGE` (operator reply) |
| `Admin/js/features/analytics-mobile.js:629` | `SEND_GENERIC_MESSAGE` (send report) |
| `Admin/js/features/riders.js:514` | rider message |
| `Admin/js/features/rider-analytics.js:308` | rider message |
| `Admin/js/features/promotions.js:631/652` + `notify-composer.js:350` | `SEND_PROMOTION` |

A small trigger on `bot/commands/{id}` handling **`SEND_GENERIC_MESSAGE` only** closes the Chat tab and
the Analytics button. Promotions wait for the promotions batch.
