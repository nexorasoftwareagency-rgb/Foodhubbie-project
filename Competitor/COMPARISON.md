# Feature Comparison

**FoodHubbie vs Servkro vs Petpooja vs UrbanPiper**

Internal only. Do not reproduce on the website - see `README.md`.

---

## Reading this table

| Tag | Meaning |
|-----|---------|
| **[repo]** | Verified in this codebase. Authoritative. |
| **[site]** | Competitor's own marketing copy, read 2026-09-26. |
| **[live]** | Observed running in a browser (Servkro guest demo). |
| **[web]** | Third-party claim, 2026-09-26. Not tested. |
| **[UNKNOWN]** | We do not know. Not guessed. |
| `-` | Does not apply to this product type. |

**Servkro** is now sourced from its own site and a live demo - `profiles/servkro.md`.
**Petpooja / UrbanPiper** are third-party and vendor claims only - never hands-on.

---

## Core capabilities

| Capability | FoodHubbie | Servkro | Petpooja | UrbanPiper |
|------------|-----------|---------|----------|------------|
| Product type | Full ERP: POS + ordering + delivery | All-in-one restaurant CRM & POS **[site]** | Full POS **[web]** | Middleware (+ separate POS) **[web]** |
| Billing / GST invoicing | Yes **[repo]** | Yes **[site]** | Yes **[web]** | **No** - "has no billing engine" **[web]** |
| Walk-in / takeaway POS | Yes **[repo]** | Yes - counter **[site]** | Yes **[web]** | Via Prime, separate **[web]** |
| Dine-in table management | Yes **[repo]** | Yes - move/merge/manage **[site]** | Yes **[web]** | No **[web]** |
| KOT / KDS | Yes **[repo]** | Kitchen screen **[site]** | Yes, add-on **[web]** | Not listed **[web]** |
| Captain / waiter call | Via table flows **[repo]** | "Call staff" + call waiter **[live]** | Add-on **[web]** | Not listed **[web]** |
| QR table ordering | Yes - core **[repo]** | Yes - core **[live]** | Add-on **[web]** | Not listed **[web]** |
| Inventory / recipe costing | Yes **[repo]** | Not advertised **[site]** | Add-on **[web]** | No **[web]** |
| **Expenses tracking** | **NO** - 0 matches **[repo]** | **Yes** **[live]** `/app/expenses`: standing costs (recurring), categories, photo/PDF slips up to 10 MB behind an expiring link, monthly report | [UNKNOWN] | No **[web]** |
| **Shift & cash drawer** | **NO** - 0 matches **[repo]** | **Yes** **[live]** `/app/shift`: opening float, cash in/out, **blind count** - expected total withheld until you submit; takings hidden while a shift is open | [UNKNOWN] | No **[web]** |
| Analytics / reports | Yes **[repo]** | **Yes** **[live]** `/app/reports`: Sales / Dishes / **Channel & staff** / GST summary / Discounts / **Voids & cancels** / **Wallet & fees** / Tables, CSV export per block | 80+ reports **[web]** | Central dashboard **[web]** |
| **Security posture audit** | **NO** **[repo]** | **Yes** **[live]** `/app/security`: severity-bucketed findings + a "what this could not check" block | [UNKNOWN] | N/A **[web]** |
| **Exception queue on dashboard** | Partial - KDS/table policing **[repo]** | **Yes** **[live]** `/app`: "4 things need attention" - stale bills, unsent baskets, table call-outs, each one-click actionable | [UNKNOWN] | N/A **[web]** |
| Multi-outlet | Yes - core **[repo]** | **[UNKNOWN]** - `Settings > Integrations` not yet opened | Yes **[web]** | Yes **[web]** |
| Multi-business / multi-tenant | Yes - hard isolation **[repo]** | **[UNKNOWN]** - same | Not advertised **[web]** | Multi-brand yes **[web]** |

---

## Ordering channels

| Channel | FoodHubbie | Servkro | Petpooja | UrbanPiper |
|---------|-----------|---------|----------|------------|
| WhatsApp ordering bot | **Yes - core** **[repo]** | **Not present** **[site]** | Not listed **[web]** | No **[web]** |
| WhatsApp campaigns / broadcasts | Yes (Meta API pass-through) **[repo]** | Not present **[site]** | Not listed **[web]** | No **[web]** |
| Own website / branded app | QR menu + PWA **[repo]** | Guest PWA + "Get app" **[live]** | Add-on **[web]** | Meraki **[web]** |
| **Zomato / Swiggy aggregator sync** | **No** **[repo]** | **Yes** **[live]** `/app/channels`: per-channel 30-day Orders / What customers paid / Commission / Your payout; **invoice isolation** - aggregator orders *"never take one of your invoice numbers"* | Yes **[web]** | **Core strength** **[web]** |
| **Off-premise / takeaway QR** | **NO** **[repo]** - QR is table-bound | **Yes** **[live]** `/app/virtual-qr`: named codes per location, **prepay mandatory and non-switchable** | [UNKNOWN] | Yes **[web]** |
| Cross-channel menu sync | Not applicable **[repo]** | [UNKNOWN] | Not advertised **[web]** | Yes **[web]** |
| Guest web push (marketing) | **NO** **[repo]** | **Yes** **[live]** - Send notification tab + guest permission prompt | [UNKNOWN] | No **[web]** |

> Servkro and Petpooja both integrate aggregators; UrbanPiper's whole product *is* that. **We do
> not, and our own website rules forbid implying we do.** This is the clearest hole in our lineup.

---

## Guest experience **[live]** (Servkro demo, 2026-09-26)

| Capability | FoodHubbie | Servkro |
|------------|-----------|---------|
| Accountless ordering (no signup) | Yes **[repo]** | Yes - orders scoped to *this phone + this table scan* **[live]** |
| Real-time order tracking | Yes **[repo]** | Yes **[live]** |
| Modifier options + kitchen note | Yes **[repo]** | "options, a kitchen note or more than one" **[live]** |
| Veg / non-veg badges | Yes **[repo]** | Yes **[live]** |
| PWA install + table memory | Yes **[repo]** | Yes - *"opens straight to your table next time"* **[live]** |
| Loyalty points | Partial - promotions only **[repo]** | **Yes** **[live]** `/app/offers` has a **Loyalty points** tab, plus Coupon codes and **Test an offer** |
| **Gamified rewards (mini games)** | **NO** **[repo]** | **Yes** **[live]** - Games tab; guest Account: *"Win one on the games"* |
| **Happy hour** | **NO** - 0 matches **[repo]** | Guest copy says *"Deals and happy hours"* **[live]**; no dedicated happy-hour config tab observed **[site]** |
| **Private negative-feedback handling** | **NO** **[repo]** | **Yes** **[live]** `/app/feedback`: rating <=3 *never* shown the Google link, 4-5 offered it; inbox *"worst first within the newest"* |
| Guest feedback / rating | Yes - `tab-feedback` **[repo]** | **Yes** **[live]** - ratings over time, reply, mark-dealt-with, date-range filters |
| Call waiter | Yes **[repo]** | Yes **[live]** |

---

## Delivery

| Capability | FoodHubbie | Servkro | Petpooja | UrbanPiper |
|------------|-----------|---------|----------|------------|
| Own rider app | **Yes** **[repo]** | **Not present** **[site]** | Not listed **[web]** | No **[web]** |
| Dispatch + live tracking | Yes **[repo]** | Not present | Not listed | No |
| OTP delivery confirmation | Yes **[repo]** | Not present | Not listed | No |
| Rider wallet / earnings | Yes **[repo]** | Not present | Not listed | No |
| Commission + settlement | Yes, auto weekly/monthly **[repo]** | Not present | Not listed | No |
| Delivery fee slabs | Yes, per outlet **[repo]** | Not present | Not listed | No |

> **Biggest asymmetry in our favour.** None of the three competitors appear to ship a rider
> product. Servkro handles *aggregator* delivery reporting only; it does not run your own fleet.

---

## Controls & governance - where our gap list came from

| Capability | FoodHubbie (now) | Servkro | Petpooja | UrbanPiper |
|------------|------------------|---------|----------|------------|
| Discount ceiling | **Yes** - % of bill, **per-outlet** `9e0bff7` **[repo]** | **Yes - per-person**, and **owner-only to configure**: *"a manager who could raise the ceiling they are asked to approve against would not be limited by it at all"* **[live]** `/app/staff` | [UNKNOWN] | N/A **[web]** |
| Manager PIN on manual discount | **Yes** - `9e0bff7` **[repo]** | **Yes** - *"past it, the till asks for a manager's PIN and records both names"* **[live]** | [UNKNOWN] | N/A |
| Manager PIN on void | **Yes** - `d17f2de` **[repo]** | **Yes** - Security page names unattributed *"discounts and voids"* as the failure **[live]** | [UNKNOWN] | N/A |
| Audit trail for approvals | **Yes** - `logs/audit`, uid recorded **[repo]** | **Yes - immutable**: *"Written by the system, and not editable from anywhere"*; two names recorded on override **[live]** | [UNKNOWN] | N/A |
| **Security posture audit page** | **NO** **[repo]** | **Yes** **[live]** `/app/security` - severity buckets, plain-English fixes, admits what it could not check | [UNKNOWN] | N/A |
| Staff roles & permissions | Yes **[repo]** | **Yes** **[live]** - Role column, `Set PIN`, `Edit`, `New password` | Yes **[web]** | N/A |
| Per-feature toggles | **Yes** - Features sub-tab **[repo]** | [UNKNOWN] | [UNKNOWN] | N/A |
| User manual shipped | **Yes** - `dist/manual.html` **[repo]** | [UNKNOWN] - `Help & tickets` at `/app/support` not opened | [UNKNOWN] | N/A |

> **This whole section exists because a Servkro gap review said we were missing it.** Every row
> we now pass was an item on `../GAP-LIST.md`. We have closed 11/11 named items.
>
> **But read the Servkro column carefully. [assessment]** Where we overlap, their version is
> *better specified*: per-person rather than per-outlet ceilings, owner-only configuration
> (ours is not role-gated), two names recorded on override, and a whole page that audits for
> missing PINs. We built the gate; they built the gate *and the argument for it*. Our Ceiling/PIN
> is not `DONE` in the sense that matters - it is DONE as a feature, and behind as a control.

---

## Commercial model

| | FoodHubbie | **Servkro** | Petpooja | UrbanPiper |
|---|-----------|------------|----------|------------|
| Model | Per-order **or** flat **[repo]** | **Commission on QR only** **[site]** | Subscription tiers **[site]** | Quote only - publishes nothing **[site]** |
| Monthly fee | INR 750 (after 3-mo intro @ 500) **[repo]** | **INR 0** **[site]** | Base INR 12,000 ex-tax **per year** (inferred) **[site]** | No public figure - `/pricing` = 404 **[site]**; 3rd-party claims INR 3,500-6,500/mo [web] |
| Per-order charge | INR 1/customer **[repo]** | **2% of QR orders** **[site]**; live demo rate shows **0%** **[live]** | None | Per-channel fees possible **[web]** |
| **Who ultimately pays the commission** | The restaurant **[repo]** | **Either** - absorb it, or **forward it to the diner as a visible bill line** with a custom name **[live]** `/app/payments` | The restaurant **[web]** | The restaurant **[web]** |
| Fee rate editable by restaurant | N/A - it is our price **[repo]** | **No** - *"set by Servkro and cannot be edited here - a restaurant that could set its own rate would be writing its own bill"* **[live]** | N/A | N/A |
| Counter orders | Covered by plan **[repo]** | **INR 0** **[site]** | Covered | N/A |
| Setup fee | **INR 0** **[repo]** | **INR 0** **[site]** | INR 8,000-15,000 **[web]** | INR 15,000-30,000 **[web]** |
| All features / support | Included **[repo]** | **INR 0** **[site]** | **Tier-gated** **[site]** - **QR ordering and KDS are NOT in Base**; both start at INR 20,000 | [UNKNOWN] |
| Payment mechanics | Monthly billing **[repo]** | **Prepaid wallet** - UPI/card/bank, GST invoice per top-up, charged **on bill settle not order**, commission **refunded proportionally on cancel/refund** **[site]** | [UNKNOWN] | [UNKNOWN] |
| Hardware | Any browser/PWA **[repo]** | "phones, tablets and computers a restaurant already has" **[site]** | iOS/Win/Android **[web]** | Printer + drawer INR 14-22k **[web]** |

### Price curve - this matters

```
FoodHubbie : INR 1 per order, capped by a flat option       <- cost falls as you grow past 750
Servkro    : 2% of every QR order, forever, no cap           <- cost rises with order value
Petpooja   : INR 12,000+ per YEAR per outlet                 <- cost independent of volume
UrbanPiper : no public price; claims say 3,500-6,500/mo + possible channel fees
```

**Servkro is cheapest at low volume and most expensive at high volume.** We sit between: cheap
at low volume (INR 1/order) but capped (INR 750 flat). **[assessment]**, from published rates
**[site] [repo] [web]**.

Full pricing research - first-party verification, the resolved Petpooja billing-period question,
the third-party conflict tables and the long-tail vendor landscape: **`PRICING.md`**.

---

## Honest summary of where we lose

**[assessment]**

1. **Aggregator integration** - Servkro ships Zomato/Swiggy separate reports; Petpooja and
   UrbanPiper too. We do not. Biggest single hole.
2. **Price headline clarity** - Servkro's "No monthly fee, 2% QR, 0% counter" beats our
   break-even explanation.
3. **Expenses and Shift/Cash Drawer** - they ship both; we ship neither (verified 0 matches).
4. **Loyalty depth** - points, happy hour, **games that award coupons**. We have promotions only.
5. **Guest web push** - they can push offers to a guest's notification bar. We cannot.
6. **Private negative-feedback handling** - a reputation feature we lack entirely.
7. **Support footprint** - Petpooja reaches Tier-2 outlets in person **[web]**.
8. **Market proof** - Petpooja 4.7/5 from 281 G2 reviews **[web]**; Servkro claims "hundreds of
   restaurants" **[site]**; we have neither.

---

## Honest summary of where we win

**[assessment]**

1. **WhatsApp-native ordering** - core product. Servkro has none; not advertised by Petpooja.
2. **Own rider fleet** - dispatch, tracking, OTP, wallet, auto settlement, fee slabs. **No
   competitor in this set offers it.**
3. **Multi-outlet + hard multi-tenant isolation** - none advertise it.
4. **Analytics depth** - cohort, LTV, retention, lost sales, rider performance **[repo]**.
5. **Scale of platform** - 20 admin tabs, inventory, KDS, live tracker, chat, bot fleet,
   Supreme Admin. Servkro presents four parts.
6. **Price at scale** - flat-cap beats 2% once order values grow.
7. **All 11 named gap items closed** - see `GAP-LIST.md`.
