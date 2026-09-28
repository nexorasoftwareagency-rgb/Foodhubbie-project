# Servkro

**Primary competitor. The source of our gap list. Resolved 2026-09-26.**

Sources: `https://servkro.com/`, `https://servkro.com/legal/about`, the guest demo at
`https://servkro.com/servkro-demo/R9VUNW4U97`, and **the full staff app at `https://servkro.com/app`**
(no sign-in wall), all read 2026-09-26.

Tags: **[site]** = their own marketing copy - **[live]** = observed running in a browser -
**[repo]** = our codebase - **[UNKNOWN]** = still unknown.

---

## Company

| Field | Value | Tag |
|-------|-------|-----|
| Operator | Servkro | [site] |
| Registered address | **JAIPUR**, India | [site] |
| Contact | +91 797601 6321 | [site] |
| Copyright | (c) 2026 Servkro. "Product by Servkro - JAIPUR" | [site] |
| About page last updated | 17 September 2026 | [site] |
| Stack | Next.js (evident from `/_next/image` asset URLs) | [live] |
| Founded / headcount / funding | **[UNKNOWN]** | - |
| Customer count | *"Join hundreds of restaurants already using Servkro"* - unverified marketing claim | [site] |

---

## Positioning

| | |
|---|---|
| **Tagline** | "Less Chaos. More Customers. One Platform." |
| **Self-description** | "All-in-One Restaurant CRM & POS" |
| **Elevator pitch** | "Servkro brings your guest experience, staff, kitchen, billing and business reports together" |
| **Structure** | Four parts: **Guest** (Scan & Order) - **Counter** (Billing & Payments) - **Kitchen** (Preparation) - **Reports** (Your Business) |
| **Runs on** | "a browser on the phones, tablets and computers a restaurant already has" |
| **Target segments** | Cafes, Restaurants, Bakeries, Cloud kitchens, Food courts, QSR chains |

> **Structurally almost identical to us.** Browser-based, no hardware lock-in, QR-first,
> four-part split. This is a direct competitor, not an adjacent one. **[site] vs [repo]**

---

## Pricing - their headline weapon

**[site]** `https://servkro.com/` and `/legal/about`

| | |
|---|---|
| **Monthly fee** | **None** (standard plan) |
| **Setup fee** | **None** |
| **QR table orders** | **2% flat** of the order |
| **Counter orders** | **INR 0** |
| **All features** | **INR 0** |
| **Setup & support** | **INR 0** |
| **Optional plans** | Monthly/yearly plans that lower the commission for a fixed fee (rates not published in the copy read) |

### Prepaid wallet mechanics - unusually transparent, note every detail

- Top up via **UPI, card or bank transfer**
- **GST invoice for every top-up**
- Commission is charged **when the bill is settled, not when the order is placed**
- **Cancel or refund? Commission returns** - proportionally for partial refunds

> This pricing model is the single most aggressive thing in the competitive set. Compare:
> Petpooja Base **INR 12,000 ex-tax**, UrbanPiper quoted **INR 3,500-6,500/mo** (third-party),
> **FoodHubbie INR 1/customer or INR 750/mo**. See `../MARKET-CONTEXT.md`.
>
> **Our exposure:** a restaurant doing 500 QR orders/month at INR 300 average pays Servkro
> INR 3,000 commission vs our INR 500 flat - but at 500 *low-value* orders the arithmetic
> flips. Their model costs them nothing when the restaurant is quiet; ours does too. The real
> difference is that **their revenue scales with order value and ours does not.**

---

## Features - control panel

**[site]** from the "Your Control. Your Business." section.

**Every row below was later confirmed by opening the staff app** - see the **Staff app** section
below. The "We have it?" column is **[repo]**.

| Feature | Detail | We have it? |
|---------|--------|-------------|
| Menu & Categories | Photos, prices, veg/non-veg, **86 item** (mark out-of-stock) | **Yes** **[repo]** `tab-menu`, `tab-categories` |
| Tables & Areas | "Move, merge, manage" | **Yes** **[repo]** `tab-tables` (groups, splits) |
| Offers & Loyalty | **Points, coupons, happy hour** | **Partial** **[repo]** - `tab-promotions`, loyalty template in `promotions-templates.js`; **no happy-hour primitive, no points wallet** |
| **Staff & Permissions** | **Logins, PINs, roles, discounts** | **Yes - as of this month** **[repo]** - this is exactly the Ceiling/PIN + void-PIN gap |
| **Shift & Cash Drawer** | "Reconcile with expected" | **NO** **[repo]** - zero matches for `cashDrawer`/`shift`/reconcile in our code |
| **Expenses** | Recurring, categories, attachments | **NO** **[repo]** - zero matches for `expense` |
| Guests & Reports | Sales, staff, payments, GST & more | **Yes** **[repo]** `tab-reports`, `tab-payments`, `tab-customers` |
| **Delivery Apps** | **Zomato & Swiggy (separate reports)** | **NO** **[repo]** - our only Zomato/Swiggy mentions are code comments using them as UX examples |

### Guest-facing features **[site]**

- Scan QR, browse menu with photos/prices/availability - **no app, no signup**
- Track order in real time
- **Call a waiter**
- **Earn points, get offers & play mini games**
- Leave feedback - *"we handle negative reviews privately"*
- Veg/non-veg badges, item options, kitchen notes

---

## Live demo observations **[live]**

URL: `https://servkro.com/servkro-demo/R9VUNW4U97` (read 2026-09-26)

Banner: *"DEMO - a sample restaurant. Nothing here is real: do not pay anyone."*

**Context:** "Servkro Demo Cafe", **table "T5 - Main Floor"**, `Call staff` button in the header.

**Navigation (bottom):** `Menu` - `Orders` - `Rewards` - `Account` - `Get app`

| Observed | Detail |
|----------|--------|
| PWA install prompt | *"Keep this on your phone - Add it to your home screen and it opens straight to your table next time."* |
| **Web push offers** | *"Get offers from Servkro Demo Cafe on your phone. Deals and happy hours, straight to your notification bar. Turn it off any time."* with `Turn on` / `Not now` |
| Menu sections | Hot Drinks, Cold Drinks, Breakfast, Main Course, Snacks, Desserts |
| Sample prices | Masala Chai INR 40 - Filter Coffee INR 50 - Cappuccino INR 120 - Cold Coffee INR 130 - Masala Dosa INR 110 - Chicken Biryani INR 280 - Paneer Butter Masala INR 240 |
| Item affordances | `options, a kitchen note or more than one` - i.e. modifiers + free-text note + quantity |
| **Rewards tab** | Empty in demo: *"Offers and games appear here when the restaurant has one on. Worth a look next time."* |
| **Account tab** | **"Your coupons"** - *"Win one on the games, and it will appear here with its code."* And **"Orders from this visit"** - *"orders sent from this phone since you scanned the code on your table"* |

### What the demo proves

1. **Accountless guest identity.** Orders are scoped to *this phone + this table scan*, not to a
   created account. Same philosophy as our QR menu **[repo]** - neither of us forces signup.
2. **Gamified coupon acquisition.** You *win* coupons by playing games, then they land in Account.
   This is a retention loop we do not have.
3. **Web push for offers.** Native browser push, permission-opt-in, per-restaurant. **We do not
   have this** - we use FCM for the rider/admin apps, not marketing push to guests.
4. **PWA with table memory** - install prompt promises it "opens straight to your table next time".
5. **The staff side IS publicly reachable** - `https://servkro.com/app` (a 307 from `/app`).
   It loads fully signed in as "Demo Owner / Owner" with **no sign-in wall**. Resolves this
   profile's biggest unknown; see the next section.

---

## Staff app - observed **[live]**

URL: `https://servkro.com/app`, read 2026-09-26. Page title **"Today - Servkro"**.
Demo banner: *"You are exploring a sample restaurant."* + `Open the guest menu`
(`/servkro-demo/M5BAG3DWUJ` - a **different token** than the one we were given) +
`Create your own restaurant` (`/demo/exit`).

Header carries date/time, **AQI 17 Good (Jaipur)** and **Wallet balance INR 100.00**.

### Navigation - the whole product in five groups

| Group | Pages |
|-------|-------|
| **Today** | Dashboard `/app` - Tables `/app/tables` - Live orders `/app/orders` - Billing `/app/billing` - Kitchen `/kitchen` |
| **Menu & QR** | Menu `/app/menu` - QR codes `/app/qr` - **Virtual QR codes** `/app/virtual-qr` - Offers & loyalty `/app/offers` |
| **Money** | Payments `/app/payments` - Wallet `/app/wallet` - Invoices `/app/invoices` - **Shift & cash** `/app/shift` - **Expenses** `/app/expenses` - Reports `/app/reports` |
| **Customers** | Guests `/app/guests` - **Feedback** `/app/feedback` - **Delivery apps** `/app/channels` |
| **Setup** | Table setup - **Staff** `/app/staff` - Settings - **Security** `/app/security` - **Help & tickets** `/app/support` |

### Dashboard - an exception queue, not a widget wall

- **"4 things need attention / 3 unresolved"** - each an actionable row with its own buttons:
  *"T5 is calling for water - Waiting 796 min. Tap Attended once someone has gone over."*
  (Delete / Attended); *"Bill #5 has been open 30h 46m - T4 - INR 173.00 still unsettled"*
  (Deal with it); *"T2 has an unfinished basket - Nothing has been sent to the kitchen.
  **It looks free from here and is not.**"*
- KPIs: Sales today / Covers / Average bill, with a *"Little settled by now yesterday"* nudge.
- `Through the day` (Today vs Yesterday), `Open and parked bills`, `Selling today`.
- **The floor**: `2/8 in use - 2 with an unsent basket`, tiles T1-T8 showing
  Reserved / Unfinished basket / Free with amount and age.

> **[assessment]** The "needs attention" queue is a product-shaped answer to the same class of
> problem our KDS/table session policing solves. Their framing - *"it looks free from here and
> is not"* - is better copy than anything we ship.

### Security - an automated posture audit

H1 *"Security - Everything still open, worst first, with what to do about each one."*
Counters: Outstanding **3** / Critical 0 / High 0 / Medium and low 3. Three live findings:

| Finding | Their copy | Severity |
|---------|-----------|----------|
| **Staff with no counter PIN** | *"1 member(s) of staff cannot identify themselves at the till, so **their discounts and voids are recorded against whoever signed the tablet in this morning**."* Fix: *"Set a PIN for each of them so **the audit trail names the person who actually did it**."* | Medium |
| **Accounts that have never been used** | *"An unused live account is a way in that no one would miss."* | Medium |
| **No GSTIN on file** | *"An invoice number is permanent and gapless, so the ones already issued cannot be reprinted with it added later."* | Medium |

It also ships a **"What this page could not check"** block admitting it could not read
session records, with the rationale: *"Reported rather than quietly skipped. A security page
that under-reports because of its own database connection is worse than one that admits what
it could not see."* Footer: `Checked 26 Sept 2026, 5:54 am - this installation is running in
production mode.`

> **[assessment]** This is the single most impressive page in the competitive set. We ship
> PIN *gates*; they ship a **PIN posture auditor** that explains the audit-trail consequence in
> operator language. Same gap, better framing.

### Staff - per-person ceilings with separation of duties

Table columns: **Name / Role / Counter PIN / Discount ceiling / Last signed in / Actions**
(Actions = `Set PIN`, `Edit`, `New password`).

- **Discount ceilings**: *"The most each person can take off a bill on their own. **Past it, the
  till asks for a manager's PIN and records both names.**"*
- **Role-gated configuration**: *"Only an owner can set these. A manager who could raise the
  ceiling they are asked to approve against would not be limited by it at all, which is why the
  control is not on their screen."*
- **Activity**: *"What staff have done that is worth a record. **Written by the system, and not
  editable from anywhere.**"* (empty in demo)

> **[assessment]** **Closer than we realized to our Ceiling/PIN build - and stricter.** Theirs
> is a **per-person** ceiling (ours is per-outlet), **owner-only to configure**, with a
> two-name audit record on override. We do not role-gate ceiling editing. **[repo]**

### Delivery apps - per-channel P&L with invoice isolation

Tabbed **Zomato / Swiggy**, *"Orders from Zomato and Swiggy, what each one keeps, and what
they pay you. **Servkro charges nothing on a delivery order.**"*

- 30-day card: `Orders` / `What customers paid` (*"before anybody's cut"*) / `Zomato commission`
  (*"theirs, not ours"*) / `Your payout` (*"Servkro took Rs 0"*)
- **Connect Zomato** - self-serve instructions for their partner team: POST to
  `https://servkro.com/api/channels/zomato/webhook` with token in the `X-Servkro-Token` header;
  body is order id + total in paise + items. **Idempotent**: *"A retry of the same order id
  updates it instead of making a second one."* Fields: outlet name, their outlet id,
  **Zomato commission %** (placeholder `22` - entered by hand, not pulled from their API).
- **Invoice isolation**: *"These never open a bill here and **never take one of your invoice
  numbers** - Zomato raises its own invoice to the customer."*

### Money modules - real depth, not placeholders

| Page | Observed |
|------|----------|
| **Shift & cash** | *"Open with a float, record what goes in and out, and **count the drawer blind at the end**."* - *"What the drawer should hold is **not shown here**. It is worked out when you submit your count, and only then. Count the cash first; the till will tell you whether it agrees."* Also **"Cash takings are hidden while a shift is open."** |
| **Expenses** | Month nav, `Spent in / Biggest category / Standing costs booked / With a slip attached (0 of 0)` - *"A photograph of the bill is what makes a figure defensible."* Tabs: This month / Monthly report / **Standing costs** / Categories / Record. Categories: Electricity, Gas, Groceries, Milk & Dairy, Rent, Repairs, Wages, Other. Attach PDF/photo up to 10 MB, *"kept outside the website and only opened through a link that expires"*. Recurring flag: *"This one comes every month."* |
| **Offers & loyalty** | Tabs: Offers / Coupon codes / Welcome popup / **Send notification** / **Test an offer** / **Loyalty points** / **Games**. *"Write the rules yourself, then **test them against a sample bill before anybody sees them**."* Offers are free-form rules: *"Nothing about it is hard-coded."* |
| **Reports** | Ranges: Today/Yesterday/7d/30d/this month/last month/custom. **Tabs: Sales / Dishes / Channel & staff / GST summary / Discounts / Voids & cancels / Wallet & fees / Tables.** Figures: gross before discounts - discounts and points - net. Charts + **CSV export** per block. Hour-of-day chart with an explicit business-day rule: *"a sale at 1am shows at hour 1 on the previous day's takings."* |
| **Feedback** | **Routing by rating**: *"Rated 3 or below. **Never shown the review link.**"* / *"Rated 4 or 5"* → offered the Google link. Inbox sorted *"worst first within the newest, because that is the one somebody has to act on tonight"*, with `Write a reply` / `Mark it dealt with` and filters (still open / private / sent to Google / has a comment). Rationale: *"the useful next step is you reading it tonight and calling them - not a permanent one-star nobody can do anything about."* |

### Payments and the fee pass-through - important for our pricing comparison

**[live]** `/app/payments`

- *"Guests pay your own UPI straight from their phone. The money goes to your bank, **not through
  Servkro**, so the app cannot see it arrive: the guest enters the **UTR** their UPI app shows."*
  (manual UTR confirmation - they never touch the money)
- Payment timing is a three-way choice: *At the counter* / *Guest chooses* / ***Before the kitchen
  starts - the order waits for payment***.
- **Platform fee block**: *"Your rate: **0% per chargeable order**. The rate itself is set by
  Servkro and **cannot be edited here - a restaurant that could set its own rate would be writing
  its own bill**. What you decide is whether that cost is absorbed or passed on."*
  - Toggle **"Add the fee to the guest's bill"** - *"On: it appears as its own line the guest can
    see. Off: you absorb it and the guest never knows there is one."*
  - Plus a custom label: *"What the line is called - printed on the guest's bill."*

> **[assessment] Pricing implication we missed.** The 2% is not only a cost to the restaurant -
> **it can be forwarded to the diner as a visible bill line.** That reframes the whole price
> comparison: if a competitor passes the fee to the guest, the "2% vs INR 750" arithmetic in
> `../MARKET-CONTEXT.md` understates their advantage at the diner's expense rather than the
> operator's. Also note their demo reports **0%**, so the headline 2% and the live rate are
> configured separately.

### Virtual QR codes - an off-premise channel we do not have **[live]**

`/app/virtual-qr` - *"QR codes for people who are not in the restaurant - a nearby office, a
co-working floor. They order and pay from their phone, and collect."*

- One named code per location (*"Infosys Gate 2"*, *"WeWork 3rd floor"*), handed out there.
- Orders arrive in **Live orders under that name**, each phone on its own bill, packed to collect.
- **Prepayment is mandatory**: *"An order from a virtual QR reaches the kitchen only after it is
  paid and staff have confirmed the payment in Live orders. **This cannot be switched off**: these
  codes travel beyond your restaurant, and this is what keeps fake orders out."*
- Blocked entirely until a UPI ID or UPI QR is saved under Payments.

> **[assessment]** Off-premise takeaway-by-QR with a hard prepay gate. We have no equivalent
> channel; our QR story is table-bound.

---

## How Servkro maps to our gap list

This is the payoff of resolving the profile. **[assessment]**, mapping observed capabilities onto
`../GAP-LIST.md`:

| Our gap item | Servkro equivalent observed | Reading |
|--------------|----------------------------|---------|
| **P0-3 / P0-4** - discounts never fired | Staff table has **Counter PIN** + **Discount ceiling** columns, `Set PIN` action **[live]** | They ship discount + PIN controls as a headline feature. Our review was comparing against this. |
| **Ceiling/PIN** | Per-person ceiling, owner-only to configure, *"past it, the till asks for a manager's PIN and records both names"* **[live]** | **Confirmed capability difference, not an invented one.** Theirs is per-person; ours is per-outlet. |
| **void-PIN** | Security page names voids explicitly: unattributed *"discounts and voids"* **[live]** | They audit for missing PINs and state the audit-trail consequence. We only gate the action. |
| **Items 1-4, 11** - discount reports channel buckets wrong | Dedicated **Delivery apps** page with per-channel 30-day `Orders / What customers paid / Commission / Your payout`, Zomato + Swiggy tabs, **and invoice-number isolation** **[live]** | **Strong match, and better than we assumed.** They not only split channels, they keep aggregator orders off the restaurant's gapless invoice sequence. Our `channelCounts` had dead `whatsapp`/`manual` buckets and buried `webview` under "Other". |
| **Item 9** - channel editor could not author `table` | Their model separates *table QR* vs *counter* at the **pricing** level (2% vs INR 0) **[site]** | They treat channel as a first-class concept end to end. We only got `table` authored in the dropdown this month. |
| **Items 5-8, 10 - LOST** | Now **observed running**, not just claimed: **Expenses** `/app/expenses`, **Shift & cash (blind count)** `/app/shift`, **Loyalty points + Games** `/app/offers`, **Feedback routing (private vs Google)** `/app/feedback`, **web push offers** **[live]** | **Capabilities confirmed; provenance still unknown.** We lack all of them. But *we do not know* these were the lost items - see warning below. |

> **Warning:** the mapping above is *plausible*, not *evidence*. The lost items were written
> before we saw this feature list, and a gap review would plausibly flag expenses or shift
> reconciliation. **Do not close items 5-8/10 on this basis.** Recover the original list.

---

## Competitive read

### Where Servkro beats us **[assessment]**

1. **Pricing clarity.** "No monthly fee, 2% on QR, 0% on counter" is one sentence and instantly
   understood. Our INR 1/customer *or* INR 750/mo needs a break-even explanation.
2. **Zero-cost entry.** No plan, no signup fee, wallet prepay. Our Base plan is also cheap but
   it is still a *plan*.
3. **Expenses + Shift/Cash Drawer.** Real operational modules we do not ship at all.
4. **Loyalty + gamification.** Points, coupons, happy hour, **mini games that award coupons**.
   We have promotions and a loyalty template but no points wallet, no games.
5. **Web push marketing.** Direct-to-guest offer delivery, permission-based. We have no guest push.
6. **Private negative feedback.** *"we handle negative reviews privately"* is a reputation feature
   we have no equivalent of. Observed as a real routing engine, not a promise.
7. **Aggregator reporting.** Per-channel P&L **plus invoice-number isolation** - aggregator
   orders never consume the restaurant's gapless invoice sequence.
8. **Security posture auditing.** `/app/security` finds missing PINs, stale accounts and a
   missing GSTIN, each with severity and a plain-English fix - and admits what it could not check.
   We have no equivalent page.
9. **Per-person discount ceilings, owner-only to configure.** Ours is per-outlet and not
   role-gated against the manager being approved.
10. **The dashboard exception queue.** Unattended bills, unsent baskets and table call-outs
    surface as a "needs attention" list with one-click resolution.
11. **Blind cash count.** The drawer's expected total is withheld until the count is submitted,
    so the till cannot be reconciled to a fudged figure. That is a genuine cash-control detail
    we have nothing for.

### Where FoodHubbie beats them **[assessment]**

1. **No WhatsApp story.** Not mentioned anywhere on their site. Our core differentiator is
   untouched.
2. **No rider/dispatch product.** No rider app, no OTP dispatch, no wallet, no settlement, no
   delivery fee slabs on their site. For restaurants with own delivery, we are the only option.
3. **No multi-outlet / multi-tenant architecture** advertised. We have hard isolation across
   `businesses/{bid}/outlets/{oid}`.
4. **Server-side enforcement still unknown for both of us.** Their Security page *talks* like an
   auditor, but nothing observed proves their gate is server-side either. We at least *document*
   that ours is client-side accountability control (`PROJECT_LEDGER.md` Ceiling/PIN entry).
5. **Depth in analytics** - cohort, LTV, retention, lost sales, rider performance
   **[repo]** `PRICING_AND_TERMS.md:55`. Their reporting is "sales, staff, payments, GST & more".
6. **Scale of build** - our 20-tab admin, inventory, KDS, live tracker, chat, bot fleet.
   Theirs is presented as four parts.

### The honest headline

**Servkro is a tighter, cheaper, better-marketed version of our QR + counter core, with real
operational modules we lack (expenses, blind-count shift reconciliation, loyalty games) - and
with noticeably more mature control design than the word "simpler" suggests.** Their staff app
ships a security auditor, per-person ceilings with separation of duties, an immutable activity
log and an invoice-isolated channel P&L. We are a broader platform with WhatsApp, riders and
multi-tenant depth they do not appear to have.

They are competing on **price, clarity and control hygiene**. We are competing on **breadth and
owned delivery**.

> **[assessment]** The phrase "cheaper simpler competitor" is now wrong in the important
> direction: they are cheaper *and* their controls are better argued. The gap that would
> embarrass us most in a side-by-side is not expenses - it is that their Security page explains
> why a missing PIN matters and we have no such page.

---

## Open questions

- [x] **Staff/counter demo** - **RESOLVED 2026-09-26**: `https://servkro.com/app` loads with no
      sign-in wall as "Demo Owner / Owner". Everything in the Staff app section above is [live].
- [ ] Their optional plan tiers and rates - **[UNKNOWN]**.
- [ ] Whether they have WhatsApp ordering, riders, or multi-outlet - **[UNKNOWN]**, likely no but
      not verified. `Settings > Integrations` not yet opened - possible home for these.
- [ ] Whether items 5-8 and 10 of our gap list came from the pages above - **[UNKNOWN]**.
      Capabilities now confirmed running; provenance of our original list still unknown.
- [ ] Whether their PIN gate is enforced server-side - **[UNKNOWN]**. The Security page is
      framed as an auditor but nothing observed proves server enforcement.
- [ ] Actual customer count behind "hundreds of restaurants" - **[site]** claim, unverified.
