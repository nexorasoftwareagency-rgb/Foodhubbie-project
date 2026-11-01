# BILLING MODEL â€” WhatsApp usage paid by the platform

> **Decision recorded 2026-11-01:** each restaurant owns its own WABA, but **WhatsApp Business
> Platform usage is charged to FoodHubbie's main Facebook account**, not to each restaurant.
>
> **Revenue side decided 2026-11-01:** percentage plan â€” Foodhubbie-App Orders 3% Â· WhatsApp bot 3%
> Â· POS + QR menu 1% (replaces the flat â‚¹1â€“5 per-order model). See Â§1.
>
> This document records the model, the constraint that makes it non-trivial, and what must change
> in code and operations.

---

## 1. The two money flows (only one is implemented today)

| Flow | Direction | Where it lives | Status |
|---|---|---|---|
| **Restaurant â†’ FoodHubbie** | revenue | `shared/cost-math.js`, `shared/billing-defaults.js`, Supreme â†’ Usage & Payments | âœ… implemented |
| **FoodHubbie â†’ Meta** | **cost** | *nowhere* | âŒ **not modelled** |

Current revenue rates â€” **percentage plan, in force since 2026-11-01** (`shared/cost-math.js` `PERCENT_RATES`):

| Plan / channel | Rate | Covers |
|---|---|---|
| **Foodhubbie-App Orders** | **3%** of order value | Delivery-app orders **plus every status notification sent to the customer on the app** |
| **WhatsApp bot ordering** | **3%** of order value | Orders placed through the WhatsApp bot |
| **POS counter** | **1%** of order value | Walk-in / counter billing |
| **QR menu** | **1%** of order value | Dine-in table ordering |
| Unclassified / legacy orders | 3% | `other`, unknown source strings |
| Promo (marketing) message | â‚¹1 per message | Promo tokens |
| Setup | â‚¹500 one-time, non-refundable | Onboarding |
| Min first top-up | â‚¹1,000 | Wallet |
| Free promo tokens | 15 | Welcome pack |

Cancelled and refunded orders are never billed.

**Superseded model:** the flat â‚¹2 QR / â‚¹1 POS / â‚¹5 WhatsApp per-order rates and the
`commission_1pct` option are **legacy modes only** â€” they stay readable so old rows still compute,
but every outlet is migrated to `percentage` (`tools/seed-billing-defaults.cjs`, `--apply`).
`normalizeMode()` now defaults to `percentage`, so a row with no mode bills on the percentage plan.

> Note: switching a live outlet from `per_order` to `percentage` **re-prices its whole order history**
> in the wallet/usage figure, because `computeCostIndex` runs over all orders, not just new ones.
> Balance changes on migration; announce it before running `--apply` on a paying tenant.

Nothing in the codebase records what Meta charges us per message. So today **true margin per outlet is unknown.**

---

## 2. The constraint: Tech Provider cannot pay for a client's WABA

Meta's partner tiers differ on exactly this point:

| Capability | Solution Partner | **Tech Provider** | Tech Partner |
|---|---|---|---|
| Has a credit line | **Yes** | **No** | No |
| Client bypasses payment-method collection | **Yes** | **No** | No |
| Bills clients directly for API usage | **Yes** | **No** | No |

Meta's own documentation: *"Clients that you onboard through Embedded Signup must be granted access to your line of creditâ€¦ You are the 'Bill To Party' for all businesses sharing your credit line."* And for Tech Providers: *"your onboarded business customers must add a payment method to their WhatsApp business account."*

**So "charged from my main Facebook account" is not achievable as a Tech Provider.** It requires one of three configurations:

| Option | How | Verdict |
|---|---|---|
| **S1 â€” Solution Partner + shared credit line** | Apply to Meta's Solution Partner program â†’ get a credit line â†’ share it with each client WABA (`POST /{credit-line-id}` with `waba_id` + `waba_currency=INR`) | âœ… Only fully-supported "we pay" model. **Meta sends you one aggregated invoice; you are liable for 100% of client spend.** |
| **S2 â€” Platform payment method on the client's WABA** | Restaurant shares its WABA with FoodHubbie's business portfolio with finance/admin access; you add your card (or UPI mandate â€” India accounts can fund via Billing Hub, confirm in your own Billing Hub â†’ Payment methods) in WhatsApp Manager â†’ Account settings â†’ Payment | âš ï¸ Works for a handful of friendly clients, but **the restaurant can remove or replace your payment method at any time**, and Meta's Tech Provider docs assume the opposite. Fragile at scale. |
| **S3 â€” Each restaurant pays Meta** | Restaurant adds its own card | âŒ Contradicts the decision. |

**Recommended:** pursue **S1**. Until the Solution Partner application is approved, run **S2** for the first handful of restaurants, with a signed agreement that they will not change the payment method.

> Eligibility note: Solution Partner status is a Meta Business Partner program decision (not a self-serve toggle) and typically requires business verification, a live app, and volume history. Treat the application as a **parallel long-lead track**, not something to start the week you launch.

---

## 3. Liability â€” record this clearly

Under S1 the **Bill To Party is liable**. That means:

- Every marketing blast a restaurant sends is billed to **your** credit line.
- A compromised or careless tenant can run your bill up until the credit line limit is hit.
- When the limit is hit, **all** tenants sharing the line fail with `131042` (payment / credit line issue) â€” one bad tenant can take down every restaurant.

**Non-negotiable controls:**

1. **Per-tenant spend cap** enforced in code before every send (daily + monthly), not just in Meta.
2. **Alerting** at 50% / 80% / 100% of each tenant's cap, to the owner.
3. **Promotions stay opt-in per tenant** and are the first thing throttled.
4. **Credit-line headroom monitor** â€” alert the owner when the shared line is above 70% used.

---

## 4. What is billable, for *our* traffic â€” as of 2026-10-01

Meta changed this twice. **Anything written before 2026-10-01 that says "messages inside the 24 h
window are free" is now wrong.**

| Message type | Charged since 2026-10-01? |
|---|---|
| Customer messages the bot | inbound â€” never charged |
| Our **non-template** reply inside an open window (service) | **charged**, but only after the first **1,000 service messages per month, per phone number** |
| Utility template **inside** an open window | **charged** â€” free until 2026-09-30, this is the change |
| Utility template **outside** any window | charged |
| Marketing template (promos) | charged, highest rate |
| Authentication template | charged |
| Anything delivered inside a **Free Entry Point** window (user arrived from a Click-to-WhatsApp ad, Android/iOS only, up to 7 days) | **free** (Meta Business Agent messages excepted) |

Source: <https://developers.facebook.com/docs/whatsapp/pricing> â†’ *Effective October 1, 2026*.
The 1,000 free service messages reset monthly, do not roll over, and are per **business phone
number** â€” not per WABA and not per business portfolio. Without a payment method on the Messaging
account, service messages stop being delivered once the free tier is used up.

### The consequence specific to FoodHubbie

`bot/transport.js` sends customer notifications as **templates** (`order_placed`, `order_ready_v3`,
`order_delivered_v3`, `order_cancelled`, `rider_assigned`). Templates get **no free tier**, so each
one is charged whether or not a window is open:

- **QR / POS dine-in** â€” the customer never messages the bot â†’ 3â€“5 charged utility templates per order.
- **WhatsApp ordering** â€” the open window *used to* make those same templates free. It no longer does.
  That channel is now only marginally cheaper: its replies are non-template service messages, which
  are free up to 1,000/month and charged after.

### Does the 3 % / 1 % plan still cover it?

For order notifications, yes, with a wide margin â€” order value dominates message count:

| Order | Revenue at 1 % (QR) | Revenue at 3 % (app / WA) | Utility messages that break even at â‚¹0.15 each |
|---|---|---|---|
| â‚¹150 | â‚¹1.50 | â‚¹4.50 | 10 / 30 |
| â‚¹300 | â‚¹3.00 | â‚¹9.00 | 20 / 60 |
| â‚¹800 | â‚¹8.00 | â‚¹24.00 | 53 / 160 |

The exposure is therefore **not** order notifications. It is:

1. **Chatty flows.** A bot conversation is 10â€“40 service messages. A tenant that chats all day burns
   the 1,000 free tier by mid-month and then pays per bubble against 1 % of a small dine-in order.
2. **Marketing.** Promo is priced â‚¹1/message and India's marketing rate is in the same range, so promo
   margin is near zero until the real rate is confirmed.
3. **Fan-out.** Reminders, `131047` re-sends, and retry loops multiply sends per order.

Pull the actual India rates from the **INR rate card** before publishing any margin number:
<https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers>. Do **not**
hardcode them in `shared/cost-math.js` â€” classify, measure, reconcile monthly (Â§6).

## 4. Message cost model â€” precise India rate (recorded 2026-11-01)

Per Meta IN rate card (verified 2026-11-01 by user / Meta docs):

| Message category | India list rate | +18% GST delivered | Notes |
|---|---|---|---|
| **Utility (status templates)** | â‚¹0.115 / msg | **â‚¹0.1357 / delivered msg** | Per-delivery billing only; charged inside open 24h window since 2026-10-01; 1,000 service msgs/mo free then service rate applies |
| Marketing (promo / greeting-marketing) | ~â‚¹2.00 / msg | ~â‚¹2.36 / msg | Old `greeting_welcome` was this â€” kept unwired; new greeting is UTILITY (Â§1 METHOD doc) |
| Authentication (OTP) | ~â‚¹1.50 / msg | ~â‚¹1.77 / msg | Only if resubmitted; currently plain text (rejected as UTILITY) |

Per WhatsApp bot order (~6 utility templates: place + ready + rider + delivered + cancel flow + greeting link): **~â‚¹0.81 / order** (not rough â‚¹4.80). At â‚¹300 order (3% = â‚¹9) = wide positive; at â‚¹100 (3% = â‚¹3) = still positive. Only very small orders (< â‚¹40 / 6 messages) go negative.

Formula (pure, `shared/meta-cost-math.js`):
```
messageCostPaise = sum(messages[cat] * indiaRate[cat]) * 1.18;   // +18% GST on Meta IN invoice
```

**Greeting / Welcome â†’ NOT marketing.** Per user 2026-11-01: greeting uses `Button` URL ("Order Now") linking to `menu/index.html?outlet={{1}}&source=wa`; submitted as new `greeting_order_link` UTILITY template with zero promo language (see `whatsapp-templates.md` Â§1; `METHOD...` Â§2). Old `greeting_welcome` (MARKETING) stays unwired.

Per-tenant cap: `messageCaps` enforced before send (`shared/meta-cost-math.js` `canSend`). Wallet threshold: `metaSpendThresholdPaise` (default â‚¹100); bot stops when balance < threshold. Cancelled orders: message cost stays (Meta delivers); revenue excluded (`_effectiveTotal`).

Full method + draft + self-service tab + integration: `docs/METHOD-WHATSAPP-SELF-SERVICE-AND-ORDER-COST.md`; template catalog: `docs/whatsapp-templates.md`; config + v4 setup: `docs/PLAN-PER-TENANT-WABA.md` Â§5.1.

---

## 5. Cost model to add to the codebase

Nothing here exists yet. Proposed minimum:

```
businesses/{bid}/outlets/{oid}/billing/metaCost/{YYYY-MM}   = {
  billableMessages: { marketing: n, utility: n, authentication: n },
  estimatedCostPaise: n,
  reconciledAt, source: 'estimate' | 'invoice'
}

platform/metaSpend/{YYYY-MM} = {
  byTenant: { [bid/oid]: { messages, costPaise } },
  invoiceTotalPaise,        // from Meta's aggregated invoice
  creditLineId, headroomPaise
}
```

Pure helper `shared/meta-cost-math.js`:

- `classifySend({ templateCategory, windowOpen })` â†’ `'free' | 'marketing' | 'utility' | 'authentication'`
- `estimateCostPaise(sends, rateTable)` â€” table loaded from config, **never hardcoded** (Meta changes rates)
- `marginPerOrder({ revenuePaise, metaCostPaise })`

Then extend `computeWallet()` in `shared/cost-math.js` to subtract `metaCostPaise` into a **gross-margin** figure (keep it separate from the customer-facing wallet â€” restaurants must never see Meta cost line items).

**Instrumentation point:** every outbound send already passes through `bot/transport.js` (`sendMessage`, `sendTemplate`, `sendButton`) and `bot/whatsapp-send.js`. Emit one `billing/metaUsage` increment per billable send there â€” a single choke point, not scattered call sites.

---

## 6. Operational checklist (monthly)

1. Export the Meta aggregated invoice.
2. Reconcile invoice total vs `platform/metaSpend/{YYYY-MM}.estimatedCostPaise`; investigate >10% drift.
3. Publish per-tenant cost into `billing/metaCost` (internal only).
4. Review margin per outlet: `revenue âˆ’ metaCost`. Flag any outlet below target.
5. Confirm the credit line has headroom for the next month's peak.
6. Re-check Meta's rate table for India â€” rates change without notice.

---

## 7. Decisions still open

1. **Is the 3 % / 1 % inclusive of Meta's per-message cost?** The 2026-11-01 decision says yes (it "covers message cost"). Â§4 shows that holds for order notifications but not for chatty tenants or promos â€” so decide whether heavy-chat outlets need a cap, a fair-use clause, or a separate top-up.
2. **Do we pursue Solution Partner status now** (long lead, ~months), or run S2 for the first N tenants?
3. **Per-tenant monthly spend cap** â€” default value?
4. **Who signs off** on a tenant exceeding their cap â€” automatic block, or owner override?
5. **Does promo stay at â‚¹1/message** now that the marketing rate is confirmed to be in the same range?

---

## 8. Related documents

- `docs/PLAN-PER-TENANT-WABA.md` â€” the one-WABA-per-restaurant architecture (a prerequisite for this billing model)
- `docs/PRODUCTION-STATUS-AND-PLAN.md` â€” live Meta/EC2 status
- `shared/cost-math.js` â€” revenue side, implemented
- `SupremeAdmin/js/billing-shared.js` â€” per-restaurant usage/due ledger
