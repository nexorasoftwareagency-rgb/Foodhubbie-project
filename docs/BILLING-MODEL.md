# BILLING MODEL — WhatsApp usage paid by the platform

> **Decision recorded 2026-11-01:** each restaurant owns its own WABA, but **WhatsApp Business
> Platform usage is charged to FoodHubbie's main Facebook account**, not to each restaurant.
>
> **Revenue side decided 2026-11-01:** percentage plan — Foodhubbie-App Orders (Customer App) 2% · WhatsApp bot 3%
> · POS + QR menu 1% (replaces the flat ₹1–5 per-order model). See §1.
>
> This document records the model, the constraint that makes it non-trivial, and what must change
> in code and operations.

---

## 1. The two money flows (only one is implemented today)

| Flow | Direction | Where it lives | Status |
|---|---|---|---|
| **Restaurant → FoodHubbie** | revenue | `shared/cost-math.js`, `shared/billing-defaults.js`, Supreme → Usage & Payments | ✅ implemented |
| **FoodHubbie → Meta** | **cost** | *nowhere* | ❌ **not modelled** |

Current revenue rates — **percentage plan, in force since 2026-11-01** (`shared/cost-math.js` `PERCENT_RATES`):

| Plan / channel | Rate | Covers |
|---|---|---|
| **Foodhubbie-App Orders (Customer App)** | **2%** of order value | Delivery-app orders **plus every status notification sent to the customer on the app** |
| **WhatsApp bot ordering** | **3%** of order value | Orders placed through the WhatsApp bot |
| **POS counter** | **1%** of order value | Walk-in / counter billing |
| **QR menu** | **1%** of order value | Dine-in table ordering |
| Unclassified / legacy orders | 3% | `other`, unknown source strings |
| Promo (marketing) message | ₹1 per message | Promo tokens |
| Setup | **None** — wallet top-up only | Onboarding |
| Min first top-up | ₹1,000 (₹1,500 with WhatsApp) | Wallet |
| Free promo tokens | 15 | Welcome pack |

Cancelled and refunded orders are never billed.

**Promo tokens are prepaid.** A purchased or granted token pays for one already-sent
marketing message, so the wallet bills only the sends the prepaid balance did **not**
cover (`shared/cost-math.js promoSendUsage`, consumed tokens applied oldest-send-first).
Self-test sends are never billed and never consume a token. Buying a token pack is
therefore not double-charged: the pack is the prepayment, the wallet sees ₹0 for the
sends it covers.

**Superseded model:** the flat ₹2 QR / ₹1 POS / ₹5 WhatsApp per-order rates and the
`commission_1pct` option are **legacy modes only** — they stay readable so old rows still compute,
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

Meta's own documentation: *"Clients that you onboard through Embedded Signup must be granted access to your line of credit… You are the 'Bill To Party' for all businesses sharing your credit line."* And for Tech Providers: *"your onboarded business customers must add a payment method to their WhatsApp business account."*

**So "charged from my main Facebook account" is not achievable as a Tech Provider.** It requires one of three configurations:

| Option | How | Verdict |
|---|---|---|
| **S1 — Solution Partner + shared credit line** | Apply to Meta's Solution Partner program → get a credit line → share it with each client WABA (`POST /{credit-line-id}` with `waba_id` + `waba_currency=INR`) | ✅ Only fully-supported "we pay" model. **Meta sends you one aggregated invoice; you are liable for 100% of client spend.** |
| **S2 — Platform payment method on the client's WABA** | Restaurant shares its WABA with FoodHubbie's business portfolio with finance/admin access; you add your card (or UPI mandate — India accounts can fund via Billing Hub, confirm in your own Billing Hub → Payment methods) in WhatsApp Manager → Account settings → Payment | ⚠️ Works for a handful of friendly clients, but **the restaurant can remove or replace your payment method at any time**, and Meta's Tech Provider docs assume the opposite. Fragile at scale. |
| **S3 — Each restaurant pays Meta** | Restaurant adds its own card | ❌ Contradicts the decision. |

**Recommended:** pursue **S1**. Until the Solution Partner application is approved, run **S2** for the first handful of restaurants, with a signed agreement that they will not change the payment method.

> Eligibility note: Solution Partner status is a Meta Business Partner program decision (not a self-serve toggle) and typically requires business verification, a live app, and volume history. Treat the application as a **parallel long-lead track**, not something to start the week you launch.

---

## 3. Liability — record this clearly

Under S1 the **Bill To Party is liable**. That means:

- Every marketing blast a restaurant sends is billed to **your** credit line.
- A compromised or careless tenant can run your bill up until the credit line limit is hit.
- When the limit is hit, **all** tenants sharing the line fail with `131042` (payment / credit line issue) — one bad tenant can take down every restaurant.

**Non-negotiable controls:**

1. **Per-tenant spend cap** enforced in code before every send (daily + monthly), not just in Meta.
2. **Alerting** at 50% / 80% / 100% of each tenant's cap, to the owner.
3. **Promotions stay opt-in per tenant** and are the first thing throttled.
4. **Credit-line headroom monitor** — alert the owner when the shared line is above 70% used.

---

## 4. What is billable, for *our* traffic — as of 2026-10-01

Meta changed this twice. **Anything written before 2026-10-01 that says "messages inside the 24 h
window are free" is now wrong.**

| Message type | Charged since 2026-10-01? |
|---|---|
| Customer messages the bot | inbound — never charged |
| Our **non-template** reply inside an open window (service) | **charged**, but only after the first **1,000 service messages per month, per phone number** |
| Utility template **inside** an open window | **charged** — free until 2026-09-30, this is the change |
| Utility template **outside** any window | charged |
| Marketing template (promos) | charged, highest rate |
| Authentication template | charged |
| Anything delivered inside a **Free Entry Point** window (user arrived from a Click-to-WhatsApp ad, Android/iOS only, up to 7 days) | **free** (Meta Business Agent messages excepted) |

Source: <https://developers.facebook.com/docs/whatsapp/pricing> → *Effective October 1, 2026*.
The 1,000 free service messages reset monthly, do not roll over, and are per **business phone
number** — not per WABA and not per business portfolio. Without a payment method on the Messaging
account, service messages stop being delivered once the free tier is used up.

### The consequence specific to FoodHubbie

`bot/transport.js` sends customer notifications as **templates** (`order_placed`, `order_ready_v3`,
`order_delivered_v3`, `order_cancelled`, `rider_assigned`). Templates get **no free tier**, so each
one is charged whether or not a window is open:

- **QR / POS dine-in** — the customer never messages the bot → 3–5 charged utility templates per order.
- **WhatsApp ordering** — the open window *used to* make those same templates free. It no longer does.
  That channel is now only marginally cheaper: its replies are non-template service messages, which
  are free up to 1,000/month and charged after.

### Does the 3 % / 1 % plan still cover it?

For order notifications, yes, with a wide margin — order value dominates message count:

| Order | Revenue at 1 % (QR) | Revenue at 3 % (app / WA) | Utility messages that break even at ₹0.115 each |
|---|---|---|---|
| ₹150 | ₹1.50 | ₹4.50 | 13 / 39 |
| ₹300 | ₹3.00 | ₹9.00 | 26 / 78 |
| ₹800 | ₹8.00 | ₹24.00 | 69 / 208 |

The exposure is therefore **not** order notifications. It is:

1. **Chatty flows.** A bot conversation is 10–40 service messages. A tenant that chats all day burns
   the 1,000 free tier by mid-month and then pays per bubble against 1 % of a small dine-in order.
2. **Marketing.** Promo is priced ₹1/message and India's marketing rate is in the same range, so promo
   margin is thin by design (₹1 price vs ₹0.8631 Meta cost).
3. **Fan-out.** Reminders, `131047` re-sends, and retry loops multiply sends per order.

Pull the actual India rates from the **INR rate card** before publishing any margin number:
<https://developers.facebook.com/docs/whatsapp/pricing#rate-cards-and-volume-tiers>. Do **not**
hardcode them in `shared/cost-math.js` — classify, measure, reconcile monthly (§6).

## 4. Message cost model — precise India rate (recorded 2026-11-01)

Per Meta IN rate card (verified 2026-11-01 by user / Meta docs):

| Message category | India list rate | Delivered (GST included) | Notes |
|---|---|---|---|
| **Utility (status templates)** | **₹0.115 / delivered msg** | No extra GST — Meta's list price already includes 18% | Per-delivery billing; charged inside open 24h window since 2026-10-01; 1,000 service msgs/mo free, then ₹0.115 |
| Marketing (promo / greeting-marketing) | **₹0.8631 / delivered msg** | Highest rate; `proactive_promo` and all `promo_hinglish_*` shells billed at this exact amount |
| Authentication (OTP) | **₹0.115 / delivered msg** | Only if resubmitted via template; currently plain text by design |

Per WhatsApp bot order (~4–5 utility templates: place + ready + rider-optional + delivered; OTP text messages are free inside the 24h window after the 1,000/month cap): **~₹0.575 / order** (dine-in); worst case with a rider-change message adds another ₹0.115 = ~₹0.69. At ₹300 order (3% = ₹9 revenue) = wide positive; at ₹100 order (3% = ₹3) = still positive. Only orders below ~₹20–25 (5–6 messages) approach break-even.

The published Meta India rates already include 18% GST in their list price, so no extra mark-up is applied. Pure formula in `shared/meta-cost-math.js`:
```
messageCostPaise = sum(messages[cat] * metaRatePaise[cat]);   // no × 1.18 — Meta's INR list prices already include GST
```

**Greeting / Welcome → NOT marketing.** Per user 2026-11-01: greeting uses `Button` URL ("Order Now") linking to `menu/index.html?outlet={{1}}&source=wa`; submitted as new `greeting_order_link` UTILITY template with zero promo language (see `whatsapp-templates.md` §1; `METHOD...` §2). Old `greeting_welcome` (MARKETING) stays unwired.

Per-tenant cap: `messageCaps` enforced before send (`shared/meta-cost-math.js` `canSend`). Wallet threshold: `metaSpendThresholdPaise` (default ₹100); bot stops when balance < threshold. Cancelled orders: message cost stays (Meta delivers); revenue excluded (`_effectiveTotal`).

Full method + draft + self-service tab + integration: `docs/METHOD-WHATSAPP-SELF-SERVICE-AND-ORDER-COST.md`; template catalog: `docs/whatsapp-templates.md`; config + v4 setup: `docs/PLAN-PER-TENANT-WABA.md` §5.1.

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

- `classifySend({ templateCategory, windowOpen })` → `'free' | 'marketing' | 'utility' | 'authentication'`
- `estimateCostPaise(sends, rateTable)` — table loaded from config, **never hardcoded** (Meta changes rates)
- `marginPerOrder({ revenuePaise, metaCostPaise })`

Then extend `computeWallet()` in `shared/cost-math.js` to subtract `metaCostPaise` into a **gross-margin** figure (keep it separate from the customer-facing wallet — restaurants must never see Meta cost line items).

**Instrumentation point:** every outbound send already passes through `bot/transport.js` (`sendMessage`, `sendTemplate`, `sendButton`) and `bot/whatsapp-send.js`. Emit one `billing/metaUsage` increment per billable send there — a single choke point, not scattered call sites.

---

## 6. Operational checklist (monthly)

1. Export the Meta aggregated invoice.
2. Reconcile invoice total vs `platform/metaSpend/{YYYY-MM}.estimatedCostPaise`; investigate >10% drift.
3. Publish per-tenant cost into `billing/metaCost` (internal only).
4. Review margin per outlet: `revenue − metaCost`. Flag any outlet below target.
5. Confirm the credit line has headroom for the next month's peak.
6. Re-check Meta's rate table for India — rates change without notice.

---

## 7. Solution Partner deep-research (recorded 2026-11-01)

See docs/BILLING-MODEL.md section 7 (replaced with full S1 deep-research) for eligibility, docs, debit/UPI/card verification, timeline, liability comparison, open items.

---

## 8. Related documents

- `docs/PLAN-PER-TENANT-WABA.md` — the one-WABA-per-restaurant architecture (a prerequisite for this billing model)
- `docs/PRODUCTION-STATUS-AND-PLAN.md` — live Meta/EC2 status
- `shared/cost-math.js` — revenue side, implemented
- `SupremeAdmin/js/billing-shared.js` — per-restaurant usage/due ledger
