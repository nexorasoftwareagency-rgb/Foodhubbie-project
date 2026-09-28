# Evaluation

Our read on the competitive position. **[assessment]** throughout - interpretation, not data.
Underlying data lives in `COMPARISON.md` and `profiles/`.

---

## 1. Where we actually sit

We are **not** a like-for-like competitor to Petpooja or UrbanPiper. We are a different bundle:

```
Petpooja   = POS (+ add-ons for QR, KDS, website)
UrbanPiper = aggregator middleware (needs a POS)
Servkro    = QR-first CRM & POS, commission-priced, deliberately narrow
FoodHubbie = POS + QR ordering + WhatsApp bot + rider fleet + ERP   <- broadest bundle
```

**Servkro is the closest structural match**: browser-based, no hardware, QR-first, four-part
split (Guest / Counter / Kitchen / Reports) - see `profiles/servkro.md`. The gap-list framing
tells us we were **weak on discount governance and reporting**; all named items are now closed.
The *unverified* risk is the five lost items - now narrowed by their published feature list.

---

## 2. Strengths

| # | Strength | Evidence |
|---|----------|----------|
| S1 | **WhatsApp ordering is core, not an add-on** | [repo] bot is a first-class subsystem with its own state machine, engine and tests |
| S2 | **Own rider fleet** - dispatch, live tracking, OTP, wallet, commission, auto settlement | [repo] `README.md` Rider Portal sections |
| S3 | **QR table ordering bundled** | [repo] `menu/` app, `tables.js` |
| S4 | **Per-order pricing: INR 1/customer or INR 750/mo**, break-even at 750 orders | [repo] `PRICING_AND_TERMS.md:26-29` |
| S5 | **Zero hardware lock-in** - PWA, any browser, no terminal | [repo] build targets are all web |
| S6 | **Hard multi-tenancy** - `businesses/{bid}/outlets/{oid}` isolation across rules, bot, menu, admin, rider | [repo] 17-GATE refactor, `PROJECT_LEDGER.md:271` |
| S7 | **Discount governance now complete** - ceiling, PIN, void PIN, audit trail, user manual | [repo] 11/11 gap items, see `GAP-LIST.md` |
| S8 | **Independent reviews already done** - 10-agent audit, security-rules fixes, accessibility pass | [repo] `FOODHUBBIE-AUDIT-REPORT.md`, AGENTS.md |

---

## 3. Weaknesses

| # | Weakness | Severity | Evidence |
|---|----------|----------|----------|
| W1 | **No aggregator integration** (Zomato/Swiggy). Delivery-heavy prospects never shortlist us. | High | [repo] no integration code; [web] both competitors have it |
| W2 | **Client-side security only.** Firebase Spark = no Cloud Functions, so ceilings/PINs are audit controls, not enforcement. Devtools bypasses them. | High | [repo] `PROJECT_LEDGER.md` Ceiling/PIN security-honesty note |
| W3 | **No published market proof** - no G2 rating, no customer count, no case studies shipped | Medium | absence of any such artefact in repo |
| W4 | **No physical support footprint** | Medium | [web] Petpooja reaches Tier-2 outlets in person |
| W5 | **Five Servkro gap items unknown** (5, 6, 7, 8, 10). Servkro's feature list now gives *candidates* but not the original text. | Medium | [repo] `PROJECT_LEDGER.md:117`; candidates in `GAP-LIST.md` |
| W6 | **`channel:'both'` mislabelled** - behaves as `pos`, WhatsApp branch never evaluates | Low | [repo] `PROJECT_LEDGER.md:162`, flagged open |
| W7 | **No live E2E against real RTDB** for the newest money-path work (PIN gates) | Low-Med | [repo] recorded as open risk in Ceiling/PIN + void-PIN entries |
| W8 | **No offline POS mode.** Competitors market offline billing; our PWA is not a billing offline mode. | Medium | [repo] no offline billing path |
| W9 | **No expenses module** - Servkro ships recurring/categories/attachments; we have 0 matches | Medium | verified 2026-09-26, see section 7 |
| W10 | **No shift / cash-drawer reconciliation** - Servkro ships it; we have 0 matches | Medium | verified 2026-09-26, see section 7 |
| W11 | **No loyalty points wallet, no happy hour, no gamified coupons** | Medium | verified 2026-09-26, see section 7 |
| W12 | **No guest web push** - Servkro pushes offers to a guest's notification bar; we only have FCM for rider/admin | Low-Med | verified 2026-09-26, see section 7 |
| W13 | **No private negative-feedback handling** - Servkro protects reputation; our feedback tab does not | Low | verified 2026-09-26, see section 7 |

---

## 4. Opportunities

| # | Opportunity | Why now |
|---|-------------|---------|
| O1 | **Own the anti-aggregator story.** Commission "often exceeds the software bill" [web] is a number we can lead with. | Our SEO plan already has the post queued: *"WhatsApp Ordering vs Zomato/Swiggy"* (`MARKETING_SEO_AI_OPTIMIZATION.md:114`) |
| O2 | **Per-order pricing is disruptive** vs flat competitor floors - Petpooja from **INR 12,000/yr** ex-tax **[site]**, Servkro **2% forever with no cap** **[site]** | Under-750-order restaurants are underserved |
| O3 | **WhatsApp + delivery in one subscription** - neither competitor advertises both | Bundle gap |
| O4 | **Publish the comparison** as a blog post, as already planned | `MARKETING_SEO_AI_OPTIMIZATION.md:148` plans *"FoodHubbie vs Petpooja vs UrbanPiper"* |
| O5 | **Close W5** by recovering the original Servkro list | One conversation with the review's commissioner |
| O6 | **Close W2** by moving money-path gates server-side if/when we leave Spark | Highest-value architectural upgrade available |
| O7 | **Lead with price transparency.** Only Servkro and Petpooja publish a rate card; **UrbanPiper, Restroworks and DotPe publish nothing** **[site]**. *"Here is the price, no demo call required"* is an objection-handler neither of them can copy | Verified first-hand 2026-09-26 - `PRICING.md` §1 |
| O8 | **Lead with tiering against Petpooja.** Their **QR ordering and KDS are not in the Base plan** - both start at INR 20,000 **[site]**. Ours are in the base product | Argument survives even if the annual inference is wrong |

---

## 5. Threats

| # | Threat | Likelihood |
|---|--------|------------|
| T1 | **Petpooja is the default.** "A clear majority of owners I know use it" [web] - we are the challenger in every deal. | High |
| T2 | **Aggregator framing.** If the buying question is "sync Zomato/Swiggy", we are absent from the shortlist. | High |
| T3 | **UrbanPiper/Meraki bundles own-channel ordering** - our strongest surface, sold by a 40,000-restaurant vendor **[site]** | Medium |
| T4 | **Price anchoring.** Petpooja and Servkro publish rate cards; our per-order model needs explaining. (UrbanPiper and Restroworks do not publish - that helps us.) | Medium |
| T5 | **Lost gap items hide a real defect.** Items 5-8, 10 could contain something still broken. | Low-Med, unquantifiable |
| T6 | **Rules on our own site** prevent us from responding publicly to comparisons | Certain - deliberate |

---

## 6. Verdict

**[assessment]**

- **Against Servkro (primary):** they are tighter, cheaper and better at the *headline*. We are
  broader and own the parts they do not have - WhatsApp, riders, multi-tenant depth. They win on
  **price clarity and operational modules** (expenses, shift drawer, loyalty games); we win on
  **breadth and owned delivery**. Do not fight them on price - our flat-cap beats their 2% as
  order values grow, and their model costs us nothing to match at low volume. Fight on *what the
  platform does*.
- **Against Petpooja:** we win on bundle (WhatsApp + riders), price model and hardware freedom;
  we lose on trust signals, support footprint and aggregator integration. Position as *the
  complete delivery-owned stack*, not as a cheaper POS.
- **Against UrbanPiper:** we are not substitutable - it needs a POS we already are. Do not chase.
  Counter with *own your channel, skip the middleware*.
- **Structural:** the sharpest long-term fix is **W2** (server-side enforcement). Everything else
  is marketing or feature work; that one is architecture.

### Immediate actions

1. Recover the original Servkro gap list (closes W5, informs T5).
2. Decide the aggregator stance explicitly: *not supported* vs *planned*. Today the website rules
   force "not supported"; sales needs a prepared answer either way (closes W1).
3. Add a "why us vs Petpooja" one-pager for the team - internal only until the comparison-post
   decision at `MARKETING_SEO_AI_OPTIMIZATION.md:148` is made (addresses T4).
4. **Triage section 7 below** - six verified gaps Servkro already ships.

---

## 7. Newly verified gaps (Servkro ships, we do not)

**All verified against our codebase on 2026-09-26.** These are *not* the lost gap items 5-8/10 -
we do not know that. They are a fresh backlog produced by reading Servkro's feature list.

**Evidence upgraded 2026-09-26:** the staff app at `https://servkro.com/app` loads with no
sign-in wall. Rows marked **[live]** are now observed running, not read off marketing copy.

**G4, G6, G9, G10 removed 2026-09-27 by decision - will not implement.** Backlog is now
G1, G2, G3, G5, G7, G8.

| # | Gap | Servkro's version | Our verification | Suggest |
|---|-----|-------------------|------------------|---------|
| G1 | **Expenses** | `/app/expenses` - categories, **standing costs** (recurring), photo/PDF slips up to 10 MB behind an expiring link, monthly report **[live]** | `expense` = **0 files** across JS/HTML | Medium - real operator need; feeds real P&L |
| G2 | **Shift & cash drawer** | `/app/shift` - opening float, cash in/out, **blind count**: expected total is withheld until you submit, *"the till will tell you whether it agrees"*; takings hidden while open **[live]** | `cashDrawer`/`shift`/reconcile = **0 restaurant features** (only PM2 noise) | **High** - the blind-count detail is a genuine control we lack entirely |
| G3 | **Loyalty points wallet + happy hour** | `/app/offers` - tabs for Offers / Coupon codes / Loyalty points, **test against a sample bill before publishing**, offers are free-form rules **[live]** | `happy hour` = **0 files**; loyalty = 1 template file | Medium - we have promotions but no wallet |
| G5 | **Guest web push** | `Send notification` tab + guest-side permission prompt *"straight to your notification bar"* **[live]** | FCM exists for rider/admin only, not guest marketing | Medium - cheap to add on web, high re-engagement |
| **G7** | **Virtual QR - off-premise channel** | `/app/virtual-qr` - named codes per location (offices, co-working), orders arrive under that name, **prepay mandatory and cannot be switched off**: *"this is what keeps fake orders out"* **[live]** | no equivalent; our QR story is table-bound | Medium-High - a whole channel we do not serve |
| **G8** | **Security posture audit page** | `/app/security` - outstanding/critical/high counts, findings with severity + plain-English fix, *"so the audit trail names the person who actually did it"*, plus a **"What this page could not check"** honesty block **[live]** | no equivalent page; we ship gates, not an auditor | Medium-High - **cheap to build, high side-by-side impact** |

### Recommendation

**[assessment]** Start with **G2** (shift/cash drawer), then **G8** (security posture audit).

- **G2** is the one operators notice daily and it pairs naturally with our existing `tab-payments`.
  The **blind count** is the part worth copying; a drawer that shows its expected total is a
  drawer that invites fudging.
- **G1** (expenses) is the biggest build; do it after G2 since both feed the same reporting story.
- **G8** is the sleeper pick: small, and it lands directly on the features an evaluator will diff
  against Servkro.
- **G5** (guest push) is cheap on web; **G7** (virtual QR) is a whole channel - schedule it
  separately; **G3** (loyalty wallet) is medium.

**Do not treat these as Servkro gap-list items.** Record them under their own ID and keep
`GAP-LIST.md` items 5-8/10 marked LOST until the original list surfaces.
