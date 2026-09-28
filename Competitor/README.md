# Competitor Intelligence

Internal competitive analysis for FoodHubbie / Prasant Pizza ERP.

**This folder is INTERNAL. Read `README.md`'s constraints before copying anything out of it.**

---

## Files

| File | What it holds |
|------|---------------|
| `GAP-LIST.md` | **The Servkro competitor gap list** - status of every item we can name. The single most valuable file here. |
| `profiles/servkro.md` | **Servkro - primary competitor, fully resolved.** Site, pricing, features, the guest demo, **and the full staff app at `/app`** (no sign-in wall) - plus how it maps to our gap list. |
| `profiles/petpooja.md` | Petpooja - POS, named in our own marketing plan. **Rate card read first-hand 2026-09-26; billing period inferred annual.** |
| `profiles/urbanpiper.md` | UrbanPiper - aggregator middleware, named alongside Petpooja. **Confirmed first-hand that they publish no price.** |
| `profiles/aggregators.md` | Zomato / Swiggy - not software competitors, but the market force we position against. |
| `PRICING.md` | **All competitor pricing, verified where possible.** Who publishes, who hides, the resolved Petpooja billing-period conflict, the third-party conflict tables, the long-tail vendor landscape, market size, and what it means for our price. |
| `COMPARISON.md` | Feature matrix: FoodHubbie vs Servkro vs Petpooja vs UrbanPiper. Unknown cells are marked, not guessed. |
| `EVALUATION.md` | Strengths, weaknesses, opportunities, threats - plus section 7: the newly verified gap backlog. |
| `MARKET-CONTEXT.md` | Our pricing, competitor pricing **summary** (detail in `PRICING.md`), SEO plan, and the publication constraints. |
| `SOURCES.md` | Every claim traced to a file:line or a URL. |

---

## Provenance rules

Every factual claim in this folder is tagged:

- **[repo]** - verifiable in this repository. Highest confidence. Cited as `path:line`.
- **[site]** - a competitor's own marketing copy, read 2026-09-26. Their claims, not ours.
- **[live]** - observed running in a browser (the Servkro **guest demo and staff app**). Strong,
  but one snapshot. The staff app is not linked from anywhere - it was found by URL probing.
- **[web]** - third-party claim. Second-hand, may drift. Cited by URL.
- **[UNKNOWN]** - we do not know. Recorded as unknown rather than guessed.

**Do not upgrade a tag.** If you learn something, add a source. Never promote `[site]`/`[web]` to
`[repo]` without a file to point at, and never fill an `[UNKNOWN]` cell from memory.

### Why this matters here

The Servkro gap list is the backbone of this folder, and **the list itself is not in the repo.**
`PROJECT_LEDGER.md:134` says so explicitly:

> The numbered list itself is not in the repo - the only back-reference is `PROJECT_LEDGER.md:123`

Everything we know about Servkro's gaps was recovered by reading ledger entries that *referenced*
the list while fixing items from it. Items 5, 6, 7, 8 and 10 are gone. Do not invent them.

**Servkro the product** is a different matter - it was resolved on 2026-09-26 when the URLs were
supplied directly: `https://servkro.com/`, a live guest demo, and then the **staff app at
`https://servkro.com/app`**, which Servkro does not link to from anywhere. See
`profiles/servkro.md`.

---

## Publication constraints (read before using any of this)

These are hard rules from our own website brief, `website/Improvements/Rider improvements Section.md.txt`:

| Line | Rule |
|------|------|
| :633 | `17. COMPARISON-STYLE VISUAL - WITHOUT NAMING COMPETITORS` |
| :636 | `Do NOT create a competitor comparison table.` |
| :9 | `Do NOT mention or visually promote Swiggy, Zomato, or any third-party delivery marketplace as an integrated feature.` |
| :727 | Banned list includes `Competitor logos` and `Swiggy/Zomato branding` |

There is also an SEO plan that wants the opposite (`MARKETING_SEO_AI_OPTIMIZATION.md:148`
plans a blog post *"Restaurant POS Comparison: FoodHubbie vs Petpooja vs UrbanPiper"*), and a
comment naming a competitor was already stripped from the codebase
(`Fixes-and-Changes/files (1)/FOODHUBBIE-REVIEW-PASS-2-VERIFIED.md:49`, removing `(ZOMATO STYLE)`).

**Resolution:** this folder is internal working material. The comparison table lives *here*,
not on the website. The blog post is a separate, deliberate marketing decision at `:148` - it
does not license a comparison table in the product UI. If in doubt, keep it internal.

---

## Known gaps in this intelligence

1. **Gap list items 5-8 and 10 are unrecoverable** from the repo or its git history. Servkro's
   feature list gives *candidates*, not the original text - see `GAP-LIST.md`.
2. ~~Servkro's staff/counter side was not observed.~~ **RESOLVED 2026-09-26.** No public link
   exists (their homepage HTML has zero `demo|counter|staff|admin` hrefs) - it was located by
   probing 21 candidate paths, which returned `307` for `/app`. That path now loads fully signed
   in as "Demo Owner". Expenses, Shift & Cash Drawer, Staff & Permissions and Delivery Apps are
   all **[live]**, not **[site]**.
3. **Servkro's optional plan tiers and rates are unpublished** - only the 2% / INR 0 headline is
   known. Note their Payments page demo shows a live rate of **0%**, so the headline and the
   configured rate are separate things.
4. **Petpooja and UrbanPiper were third-party only - now partly first-hand.** The vendor pages
   were read directly on 2026-09-26 (`petpooja.com/pricing`, `urbanpiper.com`), which resolved
   the Petpooja billing-period conflict (annual per outlet) and confirmed UrbanPiper publishes
   nothing. **Restroworks and DotPe still have no public price**, and every third-party figure
   below them remains contested - see `PRICING.md` §3. Still never hands-on.
5. **Only Servkro has been evaluated hands-on**, and only in demo mode - both the guest demo and
   the staff app. Treat every other competitor's feature claims as vendor or reviewer marketing,
   not verified fact.
6. **Not yet opened in the staff app:** `Settings > Integrations`, `/app/tables`,
   `/app/orders`, `/app/billing`, `/kitchen`, `/app/menu`, `/app/qr`, `/app/invoices`,
   `/app/support`. `Settings > Integrations` is the obvious next stop - possible home for
   WhatsApp / rider / multi-outlet questions.

## Quick read

Short on time? In order: `GAP-LIST.md` (what we fixed and what is lost), then
`profiles/servkro.md` - specifically the **Staff app** section, which is where the real
comparison lives - then `PRICING.md` (what everyone charges) - then `EVALUATION.md` section 7
(six gaps to consider building - G4, G6, G9, G10 were dropped 2026-09-27).
