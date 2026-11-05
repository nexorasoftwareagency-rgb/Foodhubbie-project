# Competitor Pricing & Market Landscape

Every price we could verify, who publishes and who hides, and what the long tail looks like.

**All figures dated 2026-09-26.** Nothing here ships to the website - see `README.md`.

Tags: **[site]** = vendor's own page - **[live]** = observed running - **[web]** = third party -
**[repo]** = ours - **[UNKNOWN]** = not known, not guessed.

---

## 1. The headline: only one of the big four publishes

| Vendor | Publishes a rate card? | Reading |
|--------|------------------------|---------|
| **Servkro** | **Yes - fully** **[site]** | No monthly fee, no setup, 2% QR, INR 0 counter. The most transparent in the set. |
| **Petpooja** | **Yes** **[site]** | Full tier table on `petpooja.com/poss/pricing`, but **billing period is not stated on the page** (resolved below). Flagged *"indicative and subject to change"*. |
| **UrbanPiper** | **No** **[site]** | `/hub` and `/meraki` FAQ both say pricing *"depends on the scale of your business and your order volumes... contact us"*. `/pricing` is a 404. |
| **Restroworks (Posist)** | **No** **[site]** | `/pricing` exists but shows **zero numbers** - only "Get an estimate" and three pricing *factors* (software requirements, size/terminals, hardware). |
| **DotPe / Rista** | **No** **[site]** | DotPe is commission/"pay as you go", quoted per organisation. `ristaapps.com` shows no rupee grid on the pages read. |

**[assessment]** Three of the five largest Indian restaurant platforms hide their price. That is
the single most usable fact in this file: **price transparency is a differentiator we already
hold**, alongside Servkro.

---

## 2. Verified first-party pricing

### Servkro **[site] + [live]**

| | |
|---|---|
| Monthly fee | **INR 0** |
| Setup fee | **INR 0** |
| QR table orders | **2% flat** of the order |
| Counter orders | **INR 0** |
| Features + support | **INR 0** |
| Optional plans | lower the commission for a fixed fee - **rates unpublished** **[UNKNOWN]** |
| Live demo configured rate | **0%** **[live]** - so the headline 2% and the configured rate are separate values |

Wallet mechanics **[site]**: prepaid wallet (UPI/card/bank), **GST invoice per top-up**,
commission charged **on bill settle not order**, **refunded proportionally on cancel/refund**.

**Fee pass-through** **[live]** `/app/payments`: the restaurant chooses absorb-or-forward -
*"Add the fee to the guest's bill. On: it appears as its own line the guest can see. Off: you
absorb it and the guest never knows there is one."* The rate itself is not editable by the
restaurant. See `MARKET-CONTEXT.md` for what this does to our crossover argument.

### Petpooja **[site]** - `petpooja.com/poss/pricing`, read 2026-09-26

| Plan group | Tier | Price (ex tax) |
|------------|------|----------------|
| **Base** | Base | **INR 12,000** |
| Operations Manager | Growth | INR 20,000 |
| Operations Manager | Scale | INR 30,000 |
| Marketing Manager | Core | INR 20,000 |
| Marketing Manager | Growth | INR 30,000 |
| Marketing Manager | Scale | INR 40,000 |

Footer on the page: *"Exclusive of applicable taxes. Plans and offerings are indicative and
subject to change."*

**Base includes:** Cloud Billing - Customized Reporting (Dynamic Reports) - Inventory - Menu
Management - **90+ Reports** - **Food Aggregators Integrations** - Unlimited Users & Terminals -
Purchase Manager (Hyperpure, Swiggy Assure, DeliverIT) - Smart-Stock Manager - **AI Agent
(unlimited queries)** - Installation & Training (online) - Support 24x7 (online).

**Operations Manager adds** (Growth -> Scale): Captain App - Token Management -
**Zomato/Swiggy Reconciliation** - Tally - **Scan & QR Order** - Waiter Calling - **Kitchen
Display System** - API Integration - SAP/ERP - Call Centre; then *Scale only*: Table Reservation
Manager, Kiosk Software, E-Invoice (1,000 credits), 2 installation visits.

**Marketing Manager adds** (Core -> Growth -> Scale): CRM + Loyalty - Virtual Wallet - Feedback
App/QR - **Reputation Management** - E-Bill - AI Marketing Agent - **WABA** (4,000 / 8,000 /
10,000 credits); then *Growth*: My Website/OOW, Digital Display; then *Scale*: Meta Ads or 2
influencers.

Also on the page **[site]**: **1,50,000+ clients served globally** - **40% of online orders
processed on Zomato & Swiggy** - 24/7 on-call & on-site support. Company: **Prayosha Food
Services Pvt. Ltd.**, Ahmedabad. Sold in India, UAE, Singapore, Malaysia, Thailand, South
Africa, US, Canada (separate rate cards per country).

> **QR and KDS are NOT in Petpooja's Base plan.** Scan & QR Order and Kitchen Display System both
> start at the **Operations Manager Growth** tier (INR 20,000). That is a direct, citable fact for
> anyone comparing QR pricing.

#### The billing period - resolved by inference, not by the vendor

Petpooja's page does **not** say whether INR 12,000 is monthly or annual. The evidence that it is
**annual, per outlet, ex-GST**:

| Evidence | Source | Tag |
|----------|--------|-----|
| Rate card has an **Annually / Monthly** toggle; *"Monthly price, billed annually"* | Google's index of `petpooja.com/poss/pricing` | **[site]** |
| *"Petpooja Price starts at Rs 10,000/- per year"*; Core **INR 10,000 Yearly**, Growth **INR 20,000 Yearly**, `Outlet: 1, Yearly: 1` | Techjockey (reseller listing) | [web] |
| *"Starts at approximately INR 12,000 per year"* | chuk.in | [web] |
| *"INR 9,000-15,000 per year"* | restrofi.com | [web] |
| *"Rs 10,000-15,000/year"* | zendikt.com | [web] |
| *"Sold as a low flat annual licence per outlet, not a monthly fee per terminal"* | Softwr, 31 Aug 2026 | [web] |
| Brochure: `Rs. 20,000* (*Price Exclusive of GST)` alongside `Rs. 10,000* / Rs. 20,000* / Rs. 30,000*` | Petpooja PDF brochure | [site] |

**[assessment]** Six independent signals agree. **Read INR 12,000 as per-outlet-per-year (≈ INR
1,000/mo), ex-GST.** This is an inference, not a vendor statement - confirm in writing before
modeling. If true, it **explains the 2-4x "conflict" that `MARKET-CONTEXT.md` used to flag**:
third parties quoting "INR 1,500-3,500/month" are describing the INR 20k-40k tiers, or annual
figures divided wrongly.

### Restroworks (Posist) **[site]**

`restroworks.com/pricing` publishes **no figures**. It states three factors only: software
requirements (POS, Inventory, Kitchen Suite, Insights, CX Suite, integrations), size and
terminals, hardware requirements. Every path leads to `contact/`.

Worth noting for positioning: their `/compare/` pages are **Restroworks vs NCR, Oracle Micros,
PAR Brink, LS Retail, Toast, Revel, CrunchTime, QSR Automations, Xenial, Qu POS** - i.e. they
position against **global enterprise POS**, not against Petpooja, UrbanPiper or us. There is no
Restroworks-vs-Petpooja page.

### UrbanPiper **[site]**

No pricing anywhere on the marketing site. `/pricing` -> **404**. `/hub` and `/meraki` each carry
the same FAQ: *"The pricing of Hub depends on the scale of your business and your order volumes.
To know the specific pricing for your restaurant, contact us here."*

Their **own blog (2022)** does say: *"UrbanPiper's Prime is priced at 10,000 INR"* - **[site]**
but four years stale and with no period stated. Do not use.

### DotPe / Rista **[site]**

DotPe = commission-based ("Pay as you go"), quoted per organisation. Rista = their full POS
(billing, menu, inventory, marketing/CRM, reports, reservations, digital bills via WhatsApp,
2-way aggregator integrations, ONDC). Neither publishes a rupee grid on the pages read.

---

## 3. Third-party claims - conflicting, kept rather than averaged

Every one of these disagrees with at least one other. Retained so the spread itself is visible.

### Monthly figures (all [web])

| Vendor | Claims found | Spread |
|--------|--------------|--------|
| **Petpooja** | 1,500-3,500 (forkcast) - 1,000+ (dineopen) - ~1,200 (billfeeds) - 3,000-12,000 (dineopen blog) - 1,500/2,500-3,000 (posible) - 6,000-30,000 (codingclave) | **6x** |
| **UrbanPiper** | 2,000 (appadvisor) - 3,500-6,500 (forkcast) - 2,000-3,000 (restrofi) | **3x** |
| **Restroworks/Posist** | 5,500-12,000 (forkcast) - 2,000-5,000 (dineopen) - 2,500-5,000 (restrofi) - ~2,000 (billfeeds) - 2,000-5,000+ (dinehere) | **5x** |

### Setup / one-time (all [web])

| Vendor | Setup fee | KOT printer + drawer |
|--------|-----------|----------------------|
| Petpooja | 8,000-15,000 | 12,000-20,000 |
| UrbanPiper | 15,000-30,000 | 14,000-22,000 |
| Posist | 30,000-80,000 | 18,000-30,000 |

### Commission models (all [web])

| Vendor | Claim |
|--------|-------|
| DotPe | "no fixed fee", commission **1-3%** (billfeeds) / **2-5%** (platera) / "2-3% on online orders" (restrofi) |
| Petpooja | "1.5-2% transaction fees" (dineopen, orgnyz) - **not stated on their own pricing page** |
| Servkro | **2% QR** **[site]** - the only first-party commission figure in the set |

> **Warning:** several of these "research" sources are **the vendors' own comparison pages** -
> billfeeds, swaadbyte, dineopen, platera, posible and orgnyz all publish comparisons that feature
> themselves. Treat them as marketing with a citation, not as independent data.

---

## 4. The rest of the market

Discovered while sweeping for "all competitors", 2026-09-26. Not profiled in depth - recorded so
we know they exist.

### Directly adjacent to us (QR / ordering layer)

| Vendor | Model | Price signal | Note |
|--------|-------|--------------|------|
| **DotPe / Rista** | Commission | none published **[site]** | Google-backed, Bengaluru, since 2018. QR-first, expanded into POS via Rista. The closest analogue to our QR story. |
| **SlickPOS** | Subscription | not published **[web]** | Cloud POS, native aggregator integration. |
| **LimeTray** | Subscription | not published **[web]** | POS + own online ordering channel. |
| **Rista** | Quote | conflicting (₹1,500/mo **[web]** vs no public grid **[site]**) | Often listed as its own vendor rather than DotPe's product. |
| **Restrofi** | Freemium | Free / 999 / 2,499 per month **[web, self-published]** | QR + KDS + analytics, zero commission. |
| **Posible** | Annual | 7,999 / 14,999 per year **[web, self-published]** | WhatsApp marketing included; publishes a Petpooja comparison. |
| **SwaadByte** | Annual | 599 / 1,999 / 8,999 per month **[web, self-published]** | Publishes its own pricing *and* its own UrbanPiper/DotPe comparisons. |
| **Platera** | Flat | 999/month **[web, self-published]** | Voice ordering; publishes a DotPe comparison. |
| **Bill Feeds** | Flat | 999 / 1,999 / 3,499 per month **[web, self-published]** | Publishes a DotPe comparison. |
| **TMBill** | Flat | 999/month **[web]** | Simple single-outlet billing only. |
| **LithosPOS** | Flat | ~1,600/month **[web]** | Budget cloud POS. |
| **DineOpen** | Flat | 300/month **[web, self-published]** | Publishes Petpooja/Posist comparisons. |
| **Orgnyz** | Free | free **[web, self-published]** | Publishes its own "best POS" list. |

### Larger / different shape (not our segment)

| Vendor | Price signal | Note |
|--------|--------------|------|
| **eZee BurrP** | 3,500-6,000/month **[web]** | Hotel & resort F&B, PMS-integrated. |
| **Gofrugal** | quote **[site]** | Billing + inventory emphasis. |
| **Zomato / Swiggy partner** | commission set in partner agreement **[site]** | Channels, not software. |
| **Toast, Square, Lightspeed, TouchBistro** | USD pricing | **Negligible India presence** **[web]** - no GST/UPI/Zomato-Swiggy native support. |

**[assessment]** The long tail is crowded at **INR 300-2,500/month flat**, and nearly all of them
are competing on *"we are cheaper than Petpooja"*. **Not one of them leads with WhatsApp ordering
or own-rider dispatch.** That is still the open ground `MARKET-CONTEXT.md` identified.

---

## 5. Market size and share **[web]**

| Claim | Figure | Source |
|-------|--------|--------|
| Active restaurants in India, 2026 | **~7.5 lakh** (NRAI estimate, excludes street vendors/dhabas) | codingclave |
| Using any digital POS | **~18%** = ~1.35 lakh | codingclave |
| Petpooja paying customers | ~60,000 (late 2025) = ~45% of the POS-using subset | codingclave |
| Petpooja customers, their own claim | **1,50,000+ globally** **[site]** vs **1,00,000+ outlets** **[site blog]** vs 50,000-60,000 [web] | **numbers disagree; do not pick one** |
| Restroworks/Posist | 12,000-15,000 (codingclave) / 25,000+ globally (orgnyz) | disagree |
| UrbanPiper | **40,000+ restaurants globally** **[site]** | first-party |
| Top-3 share (Petpooja + UrbanPiper + Posist) | **~85% of organised Indian POS** | forkcast |
| Market value | USD 254M (2024) -> USD 848M (2030), CAGR 22.8% | Petpooja's own blog **[site]** |

> **The headline opportunity:** if ~82% of 7.5 lakh restaurants still have no digital POS, the
> market is not a share fight between us and Petpooja yet - it is an adoption fight. **[assessment]**

---

## 6. What this means for our pricing **[assessment]**

Our numbers are in `MARKET-CONTEXT.md` §1 (`PRICING_AND_TERMS.md:21-76`): **INR 1/customer or
INR 750/month**, Premium INR 1,250/month + Meta rates.

1. **Against Petpooja, lead with the tiering.** Their QR ordering and KDS are **not in the Base
   plan** - both start at INR 20,000/year. Our QR table ordering and KDS are in the base product.
   That is a cleaner argument than raw price, because it is about what you actually get.
2. **Against UrbanPiper and Restroworks, lead with transparency.** They publish nothing. Servkro
   and we do. *"Here is the price, no demo call required"* is a real objection-handler.
3. **Against Servkro, keep the crossover** but **state the assumption** - see the fee
   pass-through section in `MARKET-CONTEXT.md`. Their 2% can be forwarded to the diner, in which
   case it costs the operator nothing at any volume.
4. **The INR 300-2,500/month long tail is the real pressure at the bottom.** None of them have
   WhatsApp or riders. If we are ever pressured on price, compete on those, not by cutting the
   INR 750.
5. **Do not quote any [web] figure publicly.** Three of the five largest vendors do not publish,
   and the third-party numbers disagree by 3-6x. Any number we publish can be shown to be wrong.

---

## 7. Still unknown

- [ ] Petpooja billing period **confirmed in writing** - strong inference, not vendor-stated.
- [ ] Petpooja monthly-billing price (the page shows an Annually/Monthly toggle; only one state read).
- [ ] UrbanPiper's actual rates - **quote only**.
- [ ] Restroworks' actual rates - **estimate only**.
- [ ] DotPe commission rate - negotiated per organisation; third parties say 1-5%.
- [ ] Servkro's optional plan tiers - unpublished.
- [ ] Hardware costs for any vendor except third-party estimates.
- [ ] Whether Petpooja's "1,50,000+" and their blog's "1,00,000+" are the same population.
