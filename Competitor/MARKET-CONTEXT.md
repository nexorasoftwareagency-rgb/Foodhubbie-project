# Market Context

Pricing, positioning, SEO plan and the publication rules that constrain all of it.

---

## 1. Our pricing **[repo]**

Source: `PRICING_AND_TERMS.md:21-76`

### Base plan - Restaurant Operations Core

| Model | Price | Best for |
|-------|-------|----------|
| Per-customer | **INR 1 / customer** (orders placed) | New/growing, < 750 orders/mo |
| Fixed monthly | **INR 750/mo** after a 3-month intro at INR 500/mo | Established, > 750 orders/mo |

**Break-even: 750 orders/month.** Restaurant picks a model at signup; can switch monthly.

Included: POS (walk-in, dine-in, takeaway) - QR table ordering (unlimited tables) - table
management with groups/splits/billing/KOT/KDS - inventory basics, tax/GST, service charges -
staff accounts (cashier, captain, kitchen, manager) - analytics (sales, items, categories, lost
sales) - stock alerts and wastage - customer database (walk-in + QR + WhatsApp) - reports
(daily/weekly/monthly, CSV/PDF) - multi-language - multi-outlet (per-outlet pricing).

### Premium plan - WhatsApp Automation Suite

**INR 1,250/month + Meta WhatsApp API rates (pass-through, no markup)**

| Component | Pricing |
|-----------|---------|
| WhatsApp ordering bot | Included |
| Promotional campaigns | Meta API rates, pass-through |
| Rider delivery app | Included |
| Campaign manager (templates, scheduling, targeting, ROI) | Included |
| Advanced analytics (cohort, LTV, retention, lost sales, rider performance) | Included |

Meta rate bands (India, indicative, change quarterly): Utility ~INR 0.50-0.80 - Authentication
~INR 0.50-0.80 - Marketing ~INR 1.50-2.50 - Service ~INR 0.50.

### Rider economics

Rider app free for the restaurant's own team. Delivery charges configured per outlet as slabs;
restaurant decides absorb / split / pass on. Rider payout per order, per km, fixed daily or
hybrid. Automatic commission tracking; weekly/monthly settlement auto-generated; rider app shows
earnings.

---

## 2. Competitor pricing

**Full research - first-party verification, the billing-period inference, the third-party conflict
tables, the long-tail vendor landscape and market-size figures - lives in `PRICING.md`.** This
section is the summary; do not cite from here.

Verified 2026-09-26:

| Vendor | Published? | Figure | Confidence |
|--------|-----------|--------|------------|
| **Servkro** | **Yes - fully** | **No monthly fee, no setup, 2% QR, INR 0 counter, all features + support INR 0** | **High** - their site, read first-hand [site] |
| **Petpooja** | Yes, "indicative" | Base **INR 12,000** ex-tax; tiers INR 20k / 30k / 40k | **Medium-high** - read first-hand [site]; **period inferred annual** (6 signals), not vendor-stated |
| **UrbanPiper** | **No** - `/pricing` is a **404** | quote only | **High confidence that there is no public price** [site] |
| **Restroworks / Posist** | **No** - page has zero numbers | estimate only | **High confidence that there is no public price** [site] |
| **DotPe / Rista** | **No** | commission, quoted per org | [site] |

> **The old "sources disagree 2-4x" flag is resolved.** Petpooja's rate card is
> **per outlet per year ex-GST** - so "INR 1,500-3,500/month" third-party claims were the higher
> tiers, or annual figures divided wrongly. Evidence chain: `PRICING.md` §2.
>
> **Headline:** three of the five largest Indian restaurant platforms publish no price at all.
> Transparency is a differentiator Servkro and we already hold. **[assessment]**

### Servkro's wallet mechanics - read these before pricing anything **[site]**

- Prepaid wallet topped up by **UPI, card or bank transfer**, **GST invoice per top-up**
- Commission charged **when the bill is settled, not when the order is placed**
- **Cancel or refund returns the commission**, proportionally for partial refunds
- Optional monthly/yearly plans lower the commission for a fixed fee (rates unpublished)

### Price positioning

```
            commission-based              subscription-based
            (scales with volume)          (flat)
                 |                            |
  Servkro 2% QR  |                            |
  no cap         |        FoodHubbie          |
                 |        INR 1/order ->      |
                 |        capped at 750/mo    |   Petpooja 12,000/yr+
                 |                            |   UrbanPiper 3.5-6.5k/mo
  free at zero   |                            |   Posist 5.5-12k/mo
  volume         |                            |   (both [web] estimates)
```

**Reading:**

- **Servkro is free until you take a QR order**, then 2% forever with no cap. Best at low volume
  and low order values; worst at high volume and high order values.
- **FoodHubbie** also costs little at low volume (INR 1/order) but **caps** at INR 750/mo, so it
  becomes the cheapest option once volume grows. **[repo]**
- **Petpooja / UrbanPiper / Posist** are flat subscriptions - predictable, but you pay whether you
  are busy or not, plus setup fees Servkro and we do not charge. Petpooja's figure is
  **per year** **[site]**; UrbanPiper's and Posist's are **third-party monthly estimates** [web].

> **Our commercial argument, stated precisely:** against Servkro, show the crossover - at what
> monthly QR GMV does 2% exceed INR 750? *(Answer: INR 37,500 of QR GMV. Below that Servkro is
> cheaper; above it we are.)* Against Petpooja, lead with zero setup and no terminal purchase.
>
> **[assessment]** built from **[site]** + **[repo]** figures. The crossover arithmetic is ours.

### The crossover argument has a hole in it - fee pass-through **[live]**

Found 2026-09-26 on `https://servkro.com/app/payments`. Servkro's commission can be **forwarded
to the diner**:

> *"Add the fee to the guest's bill - On: it appears as its own line the guest can see. Off: you
> absorb it and the guest never knows there is one."* Plus a custom label for the line.

And the rate itself is their decision, not the restaurant's:

> *"The rate itself is set by Servkro and cannot be edited here - a restaurant that could set its
> own rate would be writing its own bill."*

**Why this matters:**

| | If the restaurant absorbs | If it forwards |
|---|---|---|
| **Servkro's real cost to the operator** | 2% of QR GMV | **INR 0** |
| **The INR 37,500 crossover** | holds | **does not apply** - the diner pays it |
| **Our INR 1/customer** | we still bill the operator | we have no pass-through equivalent |

- **[assessment]** Our comparison table implicitly assumes the operator bears their 2%. If a
  restaurant forwards the fee, Servkro's cost-to-operator is **zero at every volume**, and the
  crossover argument collapses for that configuration. We do not currently offer a guest-visible
  platform-fee line at all (building one was declined 2026-09-27).
- **[live]** The demo's own rate reads **0%**, so the headline 2% and the configured rate are
  separate values. Treat 2% as **[site]** marketing, not as a verified live rate.
- **[assessment]** Correct response is not to drop the crossover argument - it still holds for
  any operator who absorbs the fee, and absorbing is the common choice when the alternative is a
  visible surcharge at checkout. But **state the assumption**: *"if you absorb their 2%"*.

---

## 3. Positioning statements we already own **[repo]**

| Source | Statement |
|--------|-----------|
| `MARKETING_SEO_AI_OPTIMIZATION.md:114` | Blog: *"WhatsApp Ordering vs Zomato/Swiggy: Why Restaurants Are Switching"* |
| `MARKETING_SEO_AI_OPTIMIZATION.md:140` | Keyword: *"in-house delivery vs Swiggy"* |
| `MARKETING_SEO_AI_OPTIMIZATION.md:148` | Blog: *"Restaurant POS Comparison: FoodHubbie vs Petpooja vs UrbanPiper"* |
| `PRICING_AND_TERMS.md:11-17` | "FoodHubbie is a complete Restaurant ERP platform" |
| `website/Improvements/Rider improvements Section.md.txt:9` | Do NOT promote Swiggy/Zomato as integrated |

### Target keywords **[repo]** `MARKETING_SEO_AI_OPTIMIZATION.md:140`

| Feature | Primary | Long-tail |
|---------|---------|-----------|
| QR Ordering | "qr code ordering system" (1,200), "table ordering system" (900) | "contactless dining QR code", "table side ordering" |
| WhatsApp Bot | "whatsapp ordering bot" (700), "whatsapp ordering system" (600) | "whatsapp food ordering", "restaurant whatsapp automation" |
| Delivery Mgmt | "restaurant delivery management" (500), "rider app for restaurants" (400) | "in-house delivery vs Swiggy", "restaurant delivery tracking" |
| Table Mgmt | "restaurant table management" (800), "KOT KDS system" (500) | "table reservation system", "kitchen display system" |
| Multi-outlet | "multi outlet restaurant management" (400) | "manage multiple restaurant locations", "central kitchen management" |
| Core POS | "restaurant POS India" (2,400), "restaurant management system" (1,800) | "best restaurant POS for small..." |

Note: the **Core POS** keywords are the most contested and the ones where Petpooja and UrbanPiper
already rank. Our cheaper, uncontested long-tails (WhatsApp, QR, in-house delivery) are the
winnable ground.

---

## 4. Risks already on the marketing plan **[repo]** `MARKETING_SEO_AI_OPTIMIZATION.md:322`

| Risk | Likelihood | Impact | Mitigation on plan |
|------|-----------|--------|--------------------|
| Competitor outranks us | High | Medium | Continuous content + link building; monitor weekly |
| AI hallucination on pricing | Medium | Medium | Keep `llms.txt` + Schema updated on every deploy |
| Google algorithm update | Medium | High | Diversify traffic (email, direct, referral) |
| Meta WhatsApp API changes | Low | High | Monitor Meta developer blog |
| Core Web Vitals regression | Medium | High | Lighthouse CI, alert on >10% regression |

The **AI hallucination on pricing** row is the reason this folder keeps prices tagged and dated.

---

## 5. Publication constraints **[repo]**

Hard rules from `website/Improvements/Rider improvements Section.md.txt`:

| Line | Rule |
|------|------|
| :9 | Do not mention or visually promote Swiggy, Zomato, or any third-party marketplace as an integrated feature |
| :633 | `COMPARISON-STYLE VISUAL - WITHOUT NAMING COMPETITORS` |
| :636 | `Do NOT create a competitor comparison table.` |
| :727 | Banned: competitor logos, Swiggy/Zomato branding, fake app screens, unsupported claims |
| :728 | Banned: fake customer reviews, overloaded animations |

Also: a `(ZOMATO STYLE)` code comment was deliberately removed
(`Fixes-and-Changes/files (1)/FOODHUBBIE-REVIEW-PASS-2-VERIFIED.md:49`).

### The tension, stated plainly

Our SEO plan wants a **named** comparison post (`:148`). Our website brief bans a **comparison
table** (`:636`). These are compatible only if:

- the comparison lives as **editorial content we commission deliberately**, and
- the **product UI and website pages stay comparison-free**.

This folder satisfies both: it is internal, and nothing here ships to the site.

---

## 6. Data hygiene

- Prices here are **dated 2026-09-26**. Servkro, Petpooja, UrbanPiper and Restroworks pricing
  was read from **their own pages**; everything below them in `PRICING.md` §4 is third-party.
- The `MARKETING_SEO` risk register already flags AI pricing hallucination - keeping provenance
  attached to every figure is the defence.
- **Servkro's headline rate is first-party and clear** (2% QR / INR 0 counter / INR 0 monthly),
  but its **optional plan tiers are unpublished** - do not model those.
- **Petpooja's rate card is first-hand but its billing period is inferred annual, not
  vendor-stated.** Get it in writing before modeling.
- **UrbanPiper, Restroworks and DotPe publish no price at all.** Every figure under their names
  is third-party and they **disagree with each other by 3-6x** (`PRICING.md` §3). Never publish
  a number from this folder without re-checking it on the vendor's own site - and for those three,
  there is nothing to check against.
