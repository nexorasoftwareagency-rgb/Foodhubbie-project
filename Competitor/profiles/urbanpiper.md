# UrbanPiper

**Aggregator middleware, not a POS.** Named alongside Petpooja in our own marketing plan.

**Pricing below was read first-hand from `urbanpiper.com` on 2026-09-26 [site].** Everything else
is **[web]** from one research pass the same day - not hands-on. Full price detail across all
vendors: `../PRICING.md`.

---

## Snapshot

| Field | Value | Source |
|-------|-------|--------|
| Type | Order orchestration / aggregator integration layer | [web] appadvisor.in, urbanpiper.com |
| Base | Bengaluru, India | [web] dineopen.com blog |
| Core product | **Hub** - connects delivery platforms to a restaurant's existing POS | **[site]** urbanpiper.com/in/hub |
| Other products | **Prime POS** - **Meraki** (self-branded ordering websites/apps) - **Orderline AI** (AI call handling, reservations, orders) | **[site]** urbanpiper.com |
| Scale claim | "trusted by 40,000+ restaurants globally" - 250+ integrations, 16 countries | **[site]** vendor's own |
| Named customers | Pizza Hut, KFC, Subway, Dunkin, Nando's, Haldiram's, Bikanervala, WOW Momo, Rebel Foods, Curefit, Chaipoint | **[site]** vendor's own |
| Public pricing | **No - "depends on scale and order volumes... contact us"**; `/pricing` returns **404** | **[site]** read 2026-09-26 |
| Named by us? | **Yes** - planned comparison blog post | **[repo]** `MARKETING_SEO_AI_OPTIMIZATION.md:148` |

---

## What it does

**[web]**

- Pulls orders from Swiggy, Zomato, Uber Eats, Talabat and others onto **one screen**
- Pushes them into the restaurant's **existing** POS in real time
- One-click menu updates across all channels; real-time stock sync across outlets
- Handles order accept / reject / cancel workflows
- Central reporting dashboard

**What it explicitly cannot do** (per a third-party review, [web] dineopen.com):

> process a payment, print a GST bill, manage inventory, run a KOT workflow, or report your daily
> sales. It has no billing engine. You cannot run a cloud kitchen on UrbanPiper alone.

So: **middleware first, POS second.** Most customers run it alongside a POS.

---

## Pricing

**No public rate card - confirmed first-hand [site], 2026-09-26.**

- `/pricing` on their own domain returns **404**.
- `/hub` FAQ: *"The pricing of Hub depends on the scale of your business and your order volumes.
  To know the specific pricing for your restaurant, contact us here."*
- `/meraki` carries the same FAQ verbatim.
- Their **own 2022 blog** says *"UrbanPiper's Prime is priced at 10,000 INR"* - **[site]** but four
  years stale and with no billing period. **Do not quote.**

**Third-party figures - conflicting, retained for the spread [web]:**

| Estimate | Figure | Source |
|----------|--------|--------|
| Published price | None - "Quote on request" | appadvisor.in |
| Directory figure | INR 2,000/mo | appadvisor.in (the article itself says prices are not published - **self-contradictory**) |
| Monthly per outlet | INR 3,500 - 6,500 | forkcast.in |
| Setup fee | INR 15,000 - 30,000 | forkcast.in |
| KOT printer + drawer | INR 14,000 - 22,000 | forkcast.in |
| Monthly (cloud kitchen) | INR 3,000 - 6,000 | dineopen.com |
| vs Petpooja | Petpooja "usually cost 1k or 2k more per month" | Reddit |

> **Unresolved:** INR 2,000 vs 3,000-6,000 vs 3,500-6,500 per month. Treat the real number as
> **[UNKNOWN]** until a quote is obtained. Aggregator integrations may carry a **per-channel fee**
> (forkcast). Full conflict table: `../PRICING.md` §3.

---

## Reputation signals

**[web]**

- forkcast: aggregator menu sync rated **Best-in-class** (beat Petpooja and Posist on that row)
- forkcast: loyalty/CRM *Strong*, P&L/analytics *Mid*, multi-outlet console *Mid*
- forkcast: **remote-only support**, "quick" but no field visits
- Reddit: *"more flexible pricing - if you're able to connect with a good sales manager, you can
  negotiate better deals"*
- Reviewer verdict (appadvisor): strongest when you are **aggregator-heavy** and add dine-in
  later; weaker fit if you are a single outlet with one POS integration

---

## Where it overlaps with us

| Capability | UrbanPiper | FoodHubbie | Tag |
|------------|------------|------------|-----|
| Aggregator order aggregation (Zomato/Swiggy) | **Core strength** | **No** | [web] vs [repo] |
| Cross-channel menu sync | Yes | Not applicable (we do not integrate aggregators) | [web] vs [repo] |
| Own-channel online ordering | Meraki (separate product) | Yes - QR menu, WhatsApp bot | [web] vs [repo] |
| POS / billing | Prime (separate product) | Yes - built in | [web] vs [repo] |
| WhatsApp ordering | Not listed | **Yes - core** | [web] absent vs [repo] |
| Rider dispatch + settlement | Not listed | **Yes - core** | [web] absent vs [repo] |
| Kitchen display | Not listed as a Hub feature | Yes | [web] vs [repo] |

**UrbanPiper solves a problem we deliberately do not have.** We are not aggregator-first: our
ordering channels are QR, table and WhatsApp, all owned by the restaurant. The strategic question
is whether that omission is a gap or a stance - see `../EVALUATION.md`.

---

## What this means for us

**[assessment]**

- **Not a direct competitor today.** It bolts onto a POS; we *are* the POS plus ordering plus
  delivery. A restaurant buying UrbanPiper already owns a billing system.
- **The real threat is positional:** if a prospect frames the decision as "how do I get Zomato and
  Swiggy orders into one screen", we are not in the shortlist at all.
- **We should not try to out-middleware them.** Aggregator sync means API partnerships, per-channel
  fees and enterprise integration work - wrong battle for our price point.
- **Our counter-position:** own your customer and your delivery. QR + WhatsApp + your own riders =
  no aggregator commission, no middleware subscription, customer data stays with you.

---

## Verification gaps

- [ ] Never opened or demoed. All features are vendor or reviewer claims.
- [x] **Pricing - confirmed NO public rate card** **[site]**, 2026-09-26 (`/pricing` 404, FAQ says
      "contact us"). The third-party figure spread remains **[UNKNOWN]** - a quote is the only way.
- [ ] Per-channel fee structure **[UNKNOWN]** in detail.
- [x] "40,000+ restaurants" - now confirmed as **their own claim on their own site** **[site]**,
      still not independently verified.
