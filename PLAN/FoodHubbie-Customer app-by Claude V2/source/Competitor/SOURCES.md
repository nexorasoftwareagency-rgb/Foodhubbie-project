# Sources

Every claim in this folder, traced. Updated 2026-09-26.

**Rule:** if a statement is not here, it is an `[assessment]` (opinion) or it should be deleted.

---

## Tag legend

| Tag | Meaning | Confidence |
|-----|---------|------------|
| `[repo]` | A file in this repository | High - re-checkable offline |
| `[site]` | A competitor's own marketing copy | Medium - their claims about themselves |
| `[live]` | Observed running in a browser | High for that moment, single snapshot |
| `[web]` | Third-party page | Low-Medium - second-hand, may drift |
| `[assessment]` | Our interpretation | Opinion, not data |

---

## 1. The gap list (repository)

| Claim | Source |
|-------|--------|
| Servkro gap list exists; P0-3 and P0-4 are on it | `PROJECT_LEDGER.md:191` |
| Ceiling/PIN is an item on the Servkro gap list | `PROJECT_LEDGER.md:134` |
| The numbered list is not in the repo | `PROJECT_LEDGER.md:134` |
| Items 5-8 and 10 not in the repo | `PROJECT_LEDGER.md:117` |
| void-PIN is the second half of the Ceiling/PIN pair | `PROJECT_LEDGER.md:117` |
| Gap item #9 = channel editor (`table`, dead `whatsapp`, webview relabel) | `PROJECT_LEDGER.md:155` |
| Gaps 1-4 and 11 = reports channel split + PurgeCSS `channel-` safelist | `PROJECT_LEDGER.md:174` |
| P0-3 root cause: push keys vs cart names, `_cartHasCategory` always false | `PROJECT_LEDGER.md:193` |
| P0-4 root cause: `channel:'table'` vs `discountAllowsChannel` | `PROJECT_LEDGER.md:194` |
| Fix commits | `9f59b12` (P0-3/P0-4), `9e0bff7` (Ceiling/PIN), `d17f2de` (void-PIN) |
| `channel:'both'` behaves as `pos` - flagged open | `PROJECT_LEDGER.md:162` |
| Residual stale comment `bot/index.js:1599` - open | `PROJECT_LEDGER.md:163` |
| User manual written | `PROJECT_LEDGER.md:100`, commit `0cba776` |
| Manual rendered to `dist/manual.html` | `PROJECT_LEDGER.md:87`, commit `9a37f10` |
| Client-side-only enforcement (Spark, no Cloud Functions) | `PROJECT_LEDGER.md` Ceiling/PIN entry |
| `git log --all -S'Servkro'` = 3 commits | run 2026-09-26 |
| `git log --all --diff-filter=D` = no gap/competitor files | run 2026-09-26 |
| Branches = `main` only | `git branch -a` |

---

## 2. Our own facts (repository)

| Claim | Source |
|-------|--------|
| Pricing: INR 1/customer, INR 750/mo, break-even 750 orders | `PRICING_AND_TERMS.md:26-29` |
| Premium: INR 1,250/mo + Meta API pass-through | `PRICING_AND_TERMS.md:47-65` |
| Included feature list (POS, QR, tables, inventory, reports, multi-outlet) | `PRICING_AND_TERMS.md:31-42` |
| Advanced analytics: cohort, LTV, retention, lost sales, rider performance | `PRICING_AND_TERMS.md:55` |
| Rider economics: free app, slabs, payout, settlement | `PRICING_AND_TERMS.md:69-76` |
| Platform scope: "complete Restaurant ERP platform" | `PRICING_AND_TERMS.md:11-17` |
| 20 admin tabs | `Admin/index.html` `id="tab-*"` (grep 2026-09-26) |
| Multi-tenant `businesses/{bid}/outlets/{oid}` refactor | `PROJECT_LEDGER.md:271` |
| SEO keyword table incl. "in-house delivery vs Swiggy" | `MARKETING_SEO_AI_OPTIMIZATION.md:140` |
| Blog plan: "WhatsApp Ordering vs Zomato/Swiggy" | `MARKETING_SEO_AI_OPTIMIZATION.md:114` |
| Blog plan: "FoodHubbie vs Petpooja vs UrbanPiper" | `MARKETING_SEO_AI_OPTIMIZATION.md:148` |
| Marketing risk register incl. AI pricing hallucination | `MARKETING_SEO_AI_OPTIMIZATION.md:322` |
| Core POS keywords + volumes | `MARKETING_SEO_AI_OPTIMIZATION.md` (keyword table) |

### Negative results (we verified we LACK these)

All run 2026-09-26 across `*.js`, `*.ts`, `*.tsx`, `*.html`, `*.json`, excluding
`node_modules`, `.git`, `dist`, `Fixes-and-Changes`:

| Search | Result |
|--------|--------|
| `expense` | **0 files** |
| `happy hour` | **0 files** |
| `private.*review` / `hide.*feedback` / `negative review` | **0 files** |
| `cashDrawer` / `cash drawer` / `shiftStart` / `startShift` / `reconcile` | only `bot-control-api/*` PM2 noise - **no restaurant feature** |
| `zomato` / `swiggy` | 3 hits, all **comments** using them as UX examples (`delivery.html` x2, `SlideToAction.tsx:2`) - **no integration** |
| `mini game` / `spin the wheel` / `scratch` | no gamification feature |
| Admin tab list | categories, chat, customers, dashboard, discounts, feedback, inventory, live, liveTracker, menu, notifications, orders, payments, promotions, reports, riderAnalytics, riders, settings, tables, walkin |

---

## 3. Servkro (their site + live demo)

**Read 2026-09-26.**

| Claim | Source |
|-------|--------|
| Tagline, "All-in-One Restaurant CRM & POS" | https://servkro.com/ **[site]** |
| No monthly fee, 2% QR orders, INR 0 counter | https://servkro.com/ **[site]** |
| Prepaid wallet: UPI/card/bank, GST invoice, charge on settle, proportional refund | https://servkro.com/ **[site]** |
| Optional plans lower commission for a fixed fee | https://servkro.com/ **[site]** |
| Four parts: Guest / Counter / Kitchen / Reports | https://servkro.com/ **[site]** |
| Target segments (cafes, bakeries, cloud kitchens, food courts, QSR) | https://servkro.com/ **[site]** |
| Feature list: Menu, Tables, Offers & Loyalty, Staff & Permissions, Shift & Cash Drawer, Expenses, Guests & Reports, Delivery Apps | https://servkro.com/ **[site]** |
| "86 item", veg/non-veg, move/merge/manage tables | https://servkro.com/ **[site]** |
| "we handle negative reviews privately" | https://servkro.com/ **[site]** |
| "Join hundreds of restaurants" | https://servkro.com/ **[site]** |
| Operator Servkro, registered JAIPUR, +91 797601 6321 | https://servkro.com/legal/about **[site]** |
| About last updated 17 September 2026 | https://servkro.com/legal/about **[site]** |
| No setup fee / no monthly fee on standard plan; commission from prepaid wallet | https://servkro.com/legal/about **[site]** |
| Browser on the devices a restaurant already has | https://servkro.com/legal/about **[site]** |
| Next.js | `/_next/image` asset URLs **[live]** |
| **Guest demo:** table T5 - Main Floor, Call staff, DEMO banner | https://servkro.com/servkro-demo/R9VUNW4U97 **[live]** |
| Bottom nav: Menu / Orders / Rewards / Account / Get app | same **[live]** |
| PWA install prompt with table memory | same **[live]** |
| Web push offers prompt | same **[live]** |
| Menu sections + sample prices | same **[live]** |
| Rewards empty state: "Offers and games appear here" | same **[live]** |
| Account: coupons won in games; "Orders from this visit" accountless scoping | same **[live]** |
| No public staff/counter demo link on the homepage | grepped homepage HTML for `demo\|counter\|staff\|admin` hrefs - **none**. *Superseded: see below* |
| demo URL fetch via plain HTTP | **failed** (transport error); worked only in a real browser |

### 3a. Servkro **staff app** - `https://servkro.com/app` **[live]**

**Discovered 2026-09-26.** A HEAD/GET probe of candidate paths returned `307` for `/app` and
`200` for `/kitchen`, `/signin`, `/signup`; everything else 404. `/app` loads **with no sign-in
wall**, signed in as "Demo Owner / Owner".

| Claim | Source |
|-------|--------|
| Full nav in 5 groups (Today / Menu & QR / Money / Customers / Setup), 20 pages | `https://servkro.com/app` **[live]** |
| Dashboard exception queue: *"T5 is calling for water - Waiting 796 min"*; *"T2 has an unfinished basket - it looks free from here and is not"*; floor `2/8 in use` | `https://servkro.com/app` **[live]** |
| Header: AQI 17 Good (Jaipur), Wallet balance INR 100.00, Demo Owner / Owner | `https://servkro.com/app` **[live]** |
| Guest menu banner link uses a **different token**: `/servkro-demo/M5BAG3DWUJ` | `https://servkro.com/app` **[live]** |
| Security audit: severity buckets, 3 findings, *"their discounts and voids are recorded against whoever signed the tablet in this morning"*, *"so the audit trail names the person who actually did it"* | `https://servkro.com/app/security` **[live]** |
| "What this page could not check" honesty block; *"Reported rather than quietly skipped"* | `https://servkro.com/app/security` **[live]** |
| Staff table columns: Name / Role / **Counter PIN** / **Discount ceiling** / Last signed in / Actions | `https://servkro.com/app/staff` **[live]** |
| *"Past it, the till asks for a manager's PIN and records both names"* | `https://servkro.com/app/staff` **[live]** |
| *"Only an owner can set these. A manager who could raise the ceiling they are asked to approve against would not be limited by it at all"* | `https://servkro.com/app/staff` **[live]** |
| Activity log: *"Written by the system, and not editable from anywhere"* | `https://servkro.com/app/staff` **[live]** |
| Delivery apps: per-channel 30-day Orders / What customers paid / Commission / Your payout, Zomato + Swiggy tabs | `https://servkro.com/app/channels` **[live]** |
| Zomato webhook: POST `https://servkro.com/api/channels/zomato/webhook`, header `X-Servkro-Token`, idempotent on order id; commission % hand-entered | `https://servkro.com/app/channels` **[live]** |
| *"These never open a bill here and never take one of your invoice numbers"* | `https://servkro.com/app/channels` **[live]** |
| Shift: opening float, blind count, *"What the drawer should hold is not shown here"*, *"Cash takings are hidden while a shift is open"* | `https://servkro.com/app/shift` **[live]** |
| Expenses: standing costs, categories (Electricity/Gas/Groceries/Milk & Dairy/Rent/Repairs/Wages), slips up to 10 MB behind an expiring link | `https://servkro.com/app/expenses` **[live]** |
| Offers tabs incl. **Test an offer**, **Loyalty points**, **Games**, **Send notification** | `https://servkro.com/app/offers` **[live]** |
| Reports tabs: Sales / Dishes / **Channel & staff** / GST summary / Discounts / **Voids & cancels** / **Wallet & fees** / Tables; CSV export per block | `https://servkro.com/app/reports` **[live]** |
| Feedback routing: <=3 never shown the Google link, 4-5 offered it; inbox *"worst first within the newest"* | `https://servkro.com/app/feedback` **[live]** |
| Payments: guest pays merchant UPI directly, guest enters the **UTR**; **platform fee absorb-or-forward toggle** with custom bill line name | `https://servkro.com/app/payments` **[live]** |
| Rate *"set by Servkro and cannot be edited here - a restaurant that could set its own rate would be writing its own bill"*; demo shows **0%** | `https://servkro.com/app/payments` **[live]** |
| Virtual QR: named off-premise codes, prepay mandatory and non-switchable, *"this is what keeps fake orders out"* | `https://servkro.com/app/virtual-qr` **[live]** |
| Guests CRM: visits, lifetime value, points, last visit; *"Visit frequency needs two visits and a gap between them"* | `https://servkro.com/app/guests` **[live]** |
| Settings tabs: Cafe / GST & invoicing / Printing & service / Sounds / Appearance / **Integrations** / Reset cafe | `https://servkro.com/app/settings` **[live]** |

---

## 4. Petpooja + UrbanPiper (third-party)

**One research pass, 2026-09-26. Search API rate-limited afterwards. Never hands-on.**
**Pricing rows superseded by §4a below - the vendor's own pages were read directly the same day.**

| Claim | Source | Tag |
|-------|--------|-----|
| Petpooja pricing tiers (Base INR 12k up to INR 40k) | appadvisor.in/blogs/restaurant-pos-online-ordering-software-india, quoting petpooja.com/pricing | [web] - **superseded by §4a** |
| Petpooja feature list (cloud billing, reports, CRM, KDS, captain app, QR, loyalty) | petpooja.com/poss/pricing | **[site]** - re-read in §4a; the 80+ report count and tier names here were stale |
| Petpooja 4.7/5 from 281 reviews; entry $50/location/mo | g2.com/compare/petpooja-vs-urbanpiper | [web] |
| Petpooja founded Ahmedabad; cloud POS; billing/KOT/inventory/staff/GST | dineopen.com blog | [web] |
| Petpooja setup INR 8-15k, INR 1,500-3,500/mo; UrbanPiper setup 15-30k, 3,500-6,500/mo | forkcast.in/blog/petpooja-vs-urbanpiper-vs-posist | [web] |
| "Petpooja + UrbanPiper + Posist ~85% of organised Indian POS" | forkcast.in | [web] |
| Petpooja largest field-support footprint in India | forkcast.in | [web] |
| Petpooja rated Basic on P&L/analytics; no hotel PMS bridge | forkcast.in | [web] |
| UrbanPiper products: Hub, Prime, Meraki, Orderline AI | appadvisor.in/software/urbanpiper | [web] |
| UrbanPiper 40,000+ restaurants (vendor claim); no public pricing | appadvisor.in/software/urbanpiper | [web] |
| UrbanPiper has no billing engine; not viable standalone | dineopen.com blog | [web] |
| UrbanPiper aggregator sync "Best-in-class" | forkcast.in | [web] |
| Petpooja "most commonly used"; better UI for non-tech staff; costs 1-2k more than UrbanPiper | reddit.com/r/FoodEntrepreneurIndia | [web] |
| Aggregator commission often exceeds the software bill | appadvisor.in | [web] |

**Known conflicts:**

- ~~Petpooja monthly: INR 1,500-3,500 vs INR 5,000-8,000 - 2-4x spread~~ **RESOLVED** - the
  vendor's rate card is **per outlet per year ex-GST**; see §4a.
- UrbanPiper monthly: INR 2,000 vs 3,500-6,500 vs 3,000-6,000 - **still open**; one source says
  "not published" while displaying a figure. The vendor publishes nothing, so it cannot be
  resolved from the open web - only by a quote.

**Source-reliability warning:** several "competitor pricing" sources in this section and §4a are
**the vendors' own comparison pages** (billfeeds, swaadbyte, dineopen, platera, posible, orgnyz
all publish comparisons that feature themselves). Tag them `[web]` and treat them as marketing
with a citation, never as independent data.

---

## 4a. Pricing pass - first-party reads **[site]**, 2026-09-26

Purpose: verify every competitor's price from the vendor itself, and resolve the 2-4x conflicts.

| Claim | Source | Tag |
|-------|--------|-----|
| Servkro: INR 0 monthly, INR 0 setup, 2% QR, INR 0 counter, features + support INR 0 | servkro.com (pricing pages) | **[site]** |
| Servkro wallet: prepaid UPI/card/bank, GST invoice per top-up, commission on settle not order, proportionally refunded | servkro.com | **[site]** |
| Servkro optional plans lower commission for a fixed fee; **rates unpublished** | servkro.com | **[site]** |
| Servkro live demo **configured** commission rate shows **0%** (separate from the headline 2%) | `servkro.com/app/payments` | **[live]** |
| Petpooja rate card: Base INR 12,000; Ops Growth 20k / Scale 30k; Mktg Core 20k / Growth 30k / Scale 40k, ex-tax, "indicative" | petpooja.com/pricing and petpooja.com/poss/pricing | **[site]** |
| Petpooja **QR ordering + KDS are NOT in Base** - both start at Ops Manager Growth (INR 20,000) | petpooja.com/pricing | **[site]** |
| Petpooja page carries an **Annually / Monthly** toggle ("billed annually" / "billed monthly") | Google's index of petpooja.com/poss/pricing | **[site]** |
| Petpooja **1,50,000+ clients**, **40% of online orders on Zomato & Swiggy** | petpooja.com/pricing | **[site]** |
| Petpooja **annual** per-outlet billing, not monthly | Techjockey ("Rs 10,000/- per year", `Outlet: 1, Yearly: 1`); chuk.in (INR 12,000/yr); restrofi (9k-15k/yr); zendikt (10k-15k/yr); Softwr 31 Aug 2026 ("flat annual licence per outlet") | [web] - 5 independent, **convergent** |
| Petpooja brochure price list (10k/20k/30k, "Price Exclusive of GST") | Petpooja PDF brochure | [site] |
| UrbanPiper **no price anywhere**; `/pricing` = **404**; Hub + Meraki FAQ both say "contact us" | urbanpiper.com, urbanpiper.com/in/hub | **[site]** |
| UrbanPiper "Prime is priced at 10,000 INR" | UrbanPiper's own blog, 2022 - **stale, no period. Do not quote** | **[site]** |
| UrbanPiper 40,000+ restaurants, 250+ integrations, 16 countries; Pizza Hut, KFC, Subway, Dunkin, Nando's, Haldiram's, WOW Momo, Rebel Foods | urbanpiper.com | **[site]** |
| Restroworks publishes **zero figures** - only three pricing "factors" + "Get an estimate"; positions vs NCR/Oracle Micros/PAR/LS Retail/Toast | restroworks.com/pricing, restroworks.com/compare/* | **[site]** |
| Restroworks publishes an `/llm-info/` machine-readable page | restroworks.com/llm-info | **[site]** |
| DotPe / Rista publish no rupee grid; DotPe is commission/"pay as you go" quoted per organisation | dotpe.in, ristaapps.com | **[site]** |
| Third-party conflict tables (monthly, setup, commission) for Petpooja / UrbanPiper / Posist | forkcast.in, dineopen.com, billfeeds, restrofi, codingclave, posible.in, swaadbyte.com, platera.com, orgnyz.com, appadvisor.in | [web] |
| Long-tail vendor prices (Restrofi 999/2,499; Posible 7,999/14,999 yr; SwaadByte 599/1,999/8,999; TMBill 999; LithosPOS ~1,600; Bill Feeds 999/1,999/3,499; DineOpen 300; eZee BurrP 3,500-6,000/mo) | each vendor's **own comparison page** unless noted | [web], mostly self-published |
| Market: ~7.5 lakh active restaurants India 2026 (NRAI); ~18% use digital POS (~1.35 lakh); Petpooja ~60k paying; top-3 ~85% of organised POS | codingclave, forkcast | [web] |
| Market size USD 254M (2024) -> USD 848M (2030), CAGR 22.8% | Petpooja's own blog | **[site]** |

---

## 5. Publication constraints (repository)

| Rule | Source |
|------|--------|
| No competitor comparison table | `website/Improvements/Rider improvements Section.md.txt:636` |
| Comparison visual without naming competitors | same file `:633` |
| Do not promote Swiggy/Zomato as an integrated feature | same file `:9` |
| Banned: competitor logos, Swiggy/Zomato branding, fake reviews/screens | same file `:727-728` |
| A `(ZOMATO STYLE)` comment was removed from code | `Fixes-and-Changes/files (1)/FOODHUBBIE-REVIEW-PASS-2-VERIFIED.md:49` |

---

## 6. Collection log

| When | What | Outcome |
|------|------|---------|
| 2026-09-26 | Grep repo for competitor names | Servkro, Petpooja, UrbanPiper, Zomato, Swiggy |
| 2026-09-26 | Git history for `Servkro` / `gap list` / deleted files | only 3 fix commits; list never committed |
| 2026-09-26 | Web search "Servkro restaurant POS India" | no Servkro result |
| 2026-09-26 | Web search Petpooja vs UrbanPiper | full pass succeeded |
| 2026-09-26 | Web search `"Servkro"` | **not run** - API rate limit |
| 2026-09-26 | URLs supplied: `servkro.com` + demo | homepage + About fetched; demo needed a real browser |
| 2026-09-26 | Servkro guest demo walked (Menu / Rewards / Account) | full guest-side observation captured |
| 2026-09-26 | Negative-feature greps against our code | expenses, happy hour, private feedback, shift drawer, aggregator all confirmed absent |
| 2026-09-26 | **URL probe of 21 candidate staff paths** (`/signin` `/dashboard` `/app` `/counter` `/staff` `/kitchen` `/pos` `/t/<tok>/*` `/api/*`) | **`/app` = 307, `/kitchen` = 200, `/signin` `/signup` = 200, rest 404.** Staff side located by probing, not by any link - Servkro publishes no route to it |
| 2026-09-26 | **Staff app walked**: `/app`, `/app/security`, `/app/staff`, `/app/channels`, `/app/expenses`, `/app/shift`, `/app/offers`, `/app/reports`, `/app/feedback`, `/app/virtual-qr`, `/app/payments`, `/app/guests`, `/app/settings` | full observation captured in `profiles/servkro.md` § Staff app; gaps upgraded G1-G6, new G7-G10 (G4/G6/G9/G10 dropped 2026-09-27 - will not implement) |
| 2026-09-26 | `webfetch` of **petpooja.com/pricing** and **petpooja.com/poss/pricing** | full rate card captured first-hand; **billing period absent from the page** |
| 2026-09-26 | Web search for Petpooja billing period + `petpooja.com/poss/pricing` snippet | **Annually/Monthly toggle found in the index**; 5 independent sources say **annual** -> conflict resolved |
| 2026-09-26 | `webfetch` of **urbanpiper.com**, `/in/hub`, `/in/meraki`, **`/pricing`** | `/pricing` = **404**; Hub + Meraki FAQ = "contact us"; customers list captured; own 2022 blog quotes Prime at 10,000 INR (stale) |
| 2026-09-26 | `webfetch` of **restroworks.com/pricing** + `/compare/*` + `/llm-info/` | **zero numbers published**; positions vs NCR/Oracle/PAR/Toast, i.e. enterprise, not Indian SMBs |
| 2026-09-26 | Web search for long-tail Indian POS pricing | 15+ vendors found; most publish nothing, and most that do **publish their own comparison of themselves** - flagged as self-published |
| 2026-09-26 | Wrote **`Competitor/PRICING.md`** | new file: first-party matrix, resolved Petpooja conflict, third-party conflict tables, long-tail landscape, market-size figures, what it means for our pricing |
