# PLAN — Promoting FoodHubbie SaaS

Status: draft for execution. Owner: founder. Scope: getting the first 5 paying outlets, then a repeatable channel mix.
Constraint that shapes everything: **we cannot buy our way in** — no ad budget yet, no case studies, no reviews. First 30 days are sold by hand.

Canonical facts (must match the site, `shared/billing-defaults.js`, and the backlink kit):
- Flat per-order pricing, ₹1–5 per order; **₹500 one-time setup**; ₹1 per promotional message.
- No commission on sales, no monthly lock-in, no hardware.
- QR table ordering, KDS, POS, rider app with OTP handoff, WhatsApp ordering on the official API, inventory, reports, multi-outlet.
- WhatsApp: +91 97246 49971 · site https://foodhubbie.in

---

## Phase 0 — Fix the shopfront (2 days, before any outreach)

| # | Task | Why | Done when |
|---|------|-----|-----------|
| 0.1 | ~~Resolve the ₹3 vs ₹5 WhatsApp rate~~ | Done 2026-10-21: owner confirmed **₹5 final**. `billing-defaults.js/.cjs` and `cost-math.js` now carry `WA: 5` and `webview_delivery: 5`; commission mode still 1% | Site, kit and code all say ₹5 |
| 0.2 | Enable GA4 in Firebase console | Without it every channel decision is a guess | Realtime shows our own visit |
| 0.3 | UTM convention | `?utm_source=walkin\|whatsapp\|gbp\|reel&utm_medium=...&utm_campaign=launch` — record in a sheet | Signups attributable to a source |
| 0.4 | Google Business Profile | Local pack is the cheapest restaurant-software lead source in India | Profile verified, 5 photos, link to site |
| 0.5 | 60-second demo video | A restaurant owner will not read 21 pages; they will watch one video on a phone | Screen recording: QR order → KDS → bill, real timings |
| 0.6 | WhatsApp Business profile + catalogue | The number is the funnel; it must look like a business, not a personal chat | Description, hours, 4 catalogue items |
| 0.7 | Demo outlet is presentable | `/demo`-style walkthrough on the test outlet with demo menu, no real customer names | Screenshots and demo link shared with prospects |

**Anti-pattern, do not do:** bulk-blasting restaurant numbers from the FoodHubbie WhatsApp. Promotional sending is hard-blocked on Baileys for exactly this reason, cold lists have no consent, and a restricted number kills the only channel we have. Outreach is 1:1, manual, ≤20/day, and stops the moment someone says no.

---

## Phase 1 — Week 1: 30 named targets, sold in person

The buyer is the owner standing behind the counter at 4 pm. Walk in, ask for two minutes, show the QR demo on their own table.

| Day | Activity | Volume | Output |
|-----|----------|--------|--------|
| Mon | Build the list: 30 outlets within 8 km (pizzerias, cafes, cloud kitchens), name + owner + number + why them | 30 | Sheet with a status column |
| Tue–Thu | Walk-in visits with phone demo | 10/day | 3 demos booked, 1 trial started |
| Wed | WhatsApp follow-up to everyone visited (personal, references their outlet) | 10/day | Replies |
| Fri | Second visits to the "not now" list, offer a table QR trial for the weekend | 8 | 1–2 weekend trials |
| Sat | Sit with the trial outlet during service, fix what breaks | — | First live QR order at a customer outlet |

Targets for week 1: **3 trials started, 1 paying outlet.**

Success is not "signed up" — it is the first real QR order at their table with their menu. A trial that never takes an order is a churn statistic.

---

## Phase 2 — Weeks 2–3: proof, then repeat

| # | Task | Detail |
|---|------|--------|
| 2.1 | Case study #1 | One page: their outlet, before (paper/phone), after (orders, average bill, time saved), one quote, one screenshot. Publish at `/use-cases` and link from the homepage. |
| 2.2 | Before/after reel | 20 seconds: paper KOT vs the KDS updating. Post on Instagram + YouTube Shorts; pin to WhatsApp status. |
| 2.3 | Listing pack | Execute `docs/BACKLINK-KIT.md` (GBP → JustDial → IndiaMART), one accurate profile each, no directory spam |
| 2.4 | Referral offer | ₹500 setup waived for an outlet introduced by a paying customer (cheapest CAC we have) |
| 2.5 | Follow-up cadence | Day 0 demo → Day 2 "here is your QR" → Day 7 "first order free of charge" → Day 14 close or archive. No drip forever. |
| 2.6 | Objection sheet | Keep a running list of the 10 real objections and the answer that worked. This becomes sales copy, not a brainstorm. |

Targets for weeks 2–3: **8 trials, 2 more paying outlets, 1 published case study.**

---

## Phase 3 — Week 4+: paid and content, only after proof exists

| Channel | Budget | Why now and not earlier |
|---------|--------|--------------------------|
| Google Search ads | ₹300/day cap | High intent ("restaurant pos software india"). Needs a case study on the landing page to convert; before that it burns money. |
| Instagram/Meta ads | ₹200/day, one reel, one audience | Only after the reel proves organic engagement |
| SEO cluster | ₹0 | 21 pages already live; keep adding one page a month from real search queries in GSC |
| Partners | ₹0 | Delivery-only kitchens, packaging suppliers, POS hardware shops — they already talk to our buyer daily |

Stop rule: any channel that spends ₹5,000 without producing a demo gets paused and the money moves to walk-ins.

---

## Existing users and trials (the in-product campaign)

This is the only place the app's own Promotions feature belongs:

1. **Trial day 3** — WhatsApp service message: "your QR is live, here is your table link" (transactional, always allowed).
2. **Trial day 10** — one campaign to trial users who gave consent: the upgrade offer with the exact per-order math for their month.
3. **Push notification** — free re-engagement, same message, no cost, no consent risk beyond the app install.
4. Never promo-message a number that has not opted in, and honour STOP the moment it arrives.

---

## Measurement

| Metric | Where | Week-1 target | Day-30 target |
|--------|-------|---------------|---------------|
| Visits / demos | Sheet + GA4 UTM | 30 visits, 3 demos | 100 visits, 10 demos |
| Trials started | Supreme Admin | 3 | 10 |
| First QR order in trial | Admin orders | 1 | 7 |
| Paying outlets | Payments ledger | 1 | 5 |
| CAC | spend ÷ paying | ₹0 (time only) | < ₹2,000 |
| Churn | Payments | — | 0 in first month |

Definition of done for this plan: **5 paying outlets, 1 case study live, 2 channels with a measured conversion rate.** Then this document gets replaced by a channel budget, not extended.

---

## Open questions for the owner

1. ~~Which WhatsApp rate is final~~ — ₹5, confirmed and applied in code.
2. Trial length and what it includes (today the site says "free trial" without a number — pick 14 days).
3. Is ₹500 setup waivable as a launch offer for the first 10 outlets? It is the easiest objection to remove and the cheapest discount to give.
4. Who sits with the trial outlet on Saturday? Without that, Phase 1 stalls at "signed up".


