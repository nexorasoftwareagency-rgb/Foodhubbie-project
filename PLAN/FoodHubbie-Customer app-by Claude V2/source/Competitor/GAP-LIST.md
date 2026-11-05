# Servkro Competitor Gap List - Status Tracker

**The most valuable file in this folder.** These are the gaps a competitor review said FoodHubbie
had, compared against Servkro. We fixed what we could identify; the rest is lost.

---

## Provenance warning

The list is **not stored in the repo**. `PROJECT_LEDGER.md:134` records this directly:

> Scope: the "Ceiling/PIN" item from the Servkro gap list. The numbered list itself is not in the
> repo - the only back-reference is `PROJECT_LEDGER.md:123`

Searches run 2026-09-26:

| Check | Result |
|-------|--------|
| Files mentioning "Servkro" | 1 - `PROJECT_LEDGER.md` only |
| `git log --all -S'Servkro'` | 3 commits: `9f59b12`, `9e0bff7`, `d17f2de` (fix commits citing the list) |
| Deleted files named `*gap*` / `*compet*` / `*servkro*` | none |
| Branches | `main` only - no other history to search |
| Web search for "Servkro" | no relevant result (search engine) - **but the site was supplied directly:** `https://servkro.com/` |

**Servkro's product is now resolved** - see `profiles/servkro.md`. The *list* is still missing.
Everything below was reconstructed from ledger entries that fixed items *out of* the list. It is
a recovery, not the original.


---

## Two numberings, one list?

The ledger uses two different phrasings for what is almost certainly the same numbering:

| Ledger line | Phrasing |
|-------------|----------|
| `PROJECT_LEDGER.md:191` | "P0-3 and P0-4 from the **Servkro competitor gap list**" |
| `PROJECT_LEDGER.md:174` | "gaps 1-4 and 11 from the **post-P0-3/P0-4 review**" |
| `PROJECT_LEDGER.md:155` | "gap item #9 from the **post-fix review**" |
| `PROJECT_LEDGER.md:117` | "the numbered **Servkro list, items 5-8 and 10**, is not in the repo" |

Line 117 is the tell: it claims items 5-8 and 10 are missing from the repo, which only makes
sense if items 1-4, 9 and 11 *are* recoverable - and they are, under the other two phrasings.

**Assumption (flagged, not proven):** one list, two names. If the original surfaces, re-check.

---

## Status: every item we can name

Legend: **DONE** shipped and verified - **OPEN** named but not done - **LOST** cannot be recovered

### Named severity items (P0 = critical)

| ID | Gap | Status | Commit | Evidence |
|----|-----|--------|--------|----------|
| **P0-3** | Category discounts never fired in **any** of the 3 engines. `discount.categoryIds` held push keys while every cart carried category *names*, so `_cartHasCategory` returned false 100% of the time. | **DONE** | `9f59b12` | `PROJECT_LEDGER.md:193` |
| **P0-4** | A `channel:'pos'` discount never applied to table bills. Table billing passes `channel:'table'`; `discountAllowsChannel` only matched `all`/exact/`both`. | **DONE** | `9f59b12` | `PROJECT_LEDGER.md:194` |

### Named feature items

| ID | Gap | Status | Commit | Evidence |
|----|-----|--------|--------|----------|
| **Ceiling/PIN** | No authorisation limit on human-entered discounts. Staff could discount any amount silently. Added: ceiling as **% of bill**, manager PIN gating manual discounts at settlement. | **DONE** | `9e0bff7` | `PROJECT_LEDGER.md:134` |
| **void-PIN** | Voiding a bill reversed money on one OK click. Added: **same manager PIN, required on every void, no threshold**. | **DONE** | `d17f2de` | `PROJECT_LEDGER.md:117` |
| **User manual** | No documentation for the ceiling/PIN/void-PIN feature. 251-line manual written, 28 strings machine-checked against source. | **DONE** | `0cba776` | `PROJECT_LEDGER.md:100` |
| **Manual reachability** | The manual was markdown in `docs/`, which no hosting target serves - it 404'd for any real user. Added a build step rendering it to `dist/manual.html`. | **DONE** | `9a37f10` | `PROJECT_LEDGER.md:87` |

> **Superseded:** the manual's sidebar entry (`#menu-manual`, added in `9a37f10`) was **removed on
> 2026-09-26 at the user's request**. Access is now `Settings -> Features -> "Read the full
> manual"`. Deployed that day. The gap (manual unreachable) is still closed - only the entry
> point moved. `Admin/js/main.js`'s `openManual` handler was deleted with it.

### Numbered items

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| **1-4** | Discount reports: `channelCounts` carried `whatsapp` and `manual` keys **no code ever writes**, while every bot QR/delivery redemption fell into "Other". Plus PurgeCSS never saw the runtime-built `.channel-*` chip classes, so they shipped with no background or colour. | **DONE** | `PROJECT_LEDGER.md:174` (fixed as one change - the ledger does not break out which number was which defect) |
| **5** | - | **LOST** | Not in repo, not in git history (`PROJECT_LEDGER.md:117`) |
| **6** | - | **LOST** | " |
| **7** | - | **LOST** | " |
| **8** | - | **LOST** | " |
| **9** | Channel editor could not author `table` (the largest live writer of `channel:'table'`), offered a dead `whatsapp` option nobody can ever trigger, and mislabelled the webview channel. | **DONE** | `PROJECT_LEDGER.md:155` |
| **10** | - | **LOST** | `PROJECT_LEDGER.md:117` |
| **11** | Shipped as part of the same fix as items 1-4 (reports channel split + `channel-` safelist). | **DONE** | `PROJECT_LEDGER.md:174` |

---

## Where we now stand against what they actually ship **[live]**

The staff app at `https://servkro.com/app` was opened on 2026-09-26 (no sign-in wall). For four
of our eleven items this is no longer a comparison against marketing copy:

| Our item | What Servkro ships (observed) | Reading |
|----------|-------------------------------|---------|
| **Ceiling/PIN** (`9e0bff7`) | `/app/staff`: a per-person **Discount ceiling** column. *"Past it, the till asks for a manager's PIN and records both names."* Only an owner may set them - *"a manager who could raise the ceiling they are asked to approve against would not be limited by it at all."* | **We shipped the gate; they shipped the gate plus separation of duties.** Ours is per-outlet, theirs is per-person, and ours is not role-gated against the manager being approved. That last one is a real hole in our design; fixing it (per-person, owner-gated ceilings) was declined 2026-09-27. |
| **void-PIN** (`d17f2de`) | `/app/security`: *"1 member(s) of staff cannot identify themselves at the till, so their discounts and voids are recorded against whoever signed the tablet in this morning."* | **They do not just gate the action - they audit the configuration** and state the audit-trail consequence in operator language. We have no equivalent page - see **G8**. |
| **Items 1-4, 11** (channel reports) | `/app/channels`: per-channel 30-day `Orders / What customers paid / Commission / Your payout`, Zomato and Swiggy tabs, **plus invoice-number isolation** - *"never take one of your invoice numbers."* `/app/reports` has a **Channel & staff** tab and a **Voids & cancels** tab. | **Confirmed, and richer than we assumed.** They keep aggregator orders off the restaurant's gapless invoice sequence - a fiscal detail we never considered. |
| **Item 9** (author `table`) | Their whole pricing model separates **table QR (2%)** from **counter (INR 0)** as first-class concepts, and `/app/virtual-qr` adds a third channel we do not have at all. | They treat channel as structural end to end. We treated it as a dropdown value. |

> **[assessment]** The eleven fixes stand - none of this reopens them. But the shape of the
> remaining gap has changed: it is no longer *missing features*, it is **feature quality and
> control hygiene**. Theirs is more defensible where it overlaps with ours.

---

## Score

| | Count |
|---|---|
| Items identified | **11** (P0-3, P0-4, Ceiling/PIN, void-PIN, manual, reachability, and numbered 1-4, 9, 11) |
| Shipped | **11 / 11** |
| Lost (items 5-8, 10) | **5** |
| Open | 0 |

Every gap we could name has been closed. The risk is entirely in the five we cannot name.

---

## What the five lost items might have been

**Candidates now exist, because Servkro's site is known - and since 2026-09-26, because their
staff app is known too** - `profiles/servkro.md`.

These are no longer advertised-only. Every row below was **observed running** in
`https://servkro.com/app` on 2026-09-26, then checked against our codebase:

| Servkro feature **[live]** | Do we have it? | Verification |
|----------------------------|----------------|--------------|
| **Expenses** `/app/expenses` - standing costs, categories, photo/PDF slips behind an expiring link | **NO** | zero matches for `expense` across our JS/HTML |
| **Shift & cash** `/app/shift` - opening float, **blind count**, takings hidden while open | **NO** | zero matches for `cashDrawer`/`shift`/reconcile (only PM2 orchestrator noise) |
| **Offers & loyalty** `/app/offers` - points, coupon codes, **test-before-publish** | **Partial** | `tab-promotions` + a loyalty template exist; no points wallet, `happy hour` = 0 matches |
| **Games** `/app/offers` Games tab awarding coupons | **NO** | no game/gamification code |
| **Feedback routing** `/app/feedback` - <=3 private (Google link withheld), 4-5 to Google | **NO** | no equivalent in `tab-feedback` |
| **Guest web push** `/app/offers` Send notification + guest permission prompt | **NO** | we have FCM for rider/admin, not marketing push to guests |
| **Virtual QR** `/app/virtual-qr` - off-premise codes, mandatory prepay | **NO** | no equivalent; our QR is table-bound |
| **Delivery apps** `/app/channels` - per-channel P&L, invoice isolation | **NO** | our only Zomato/Swiggy hits are code comments using them as UX examples |

> **This is a candidate list, NOT a recovery.** These six-plus gaps are *real and verified*, and
> they are exactly the kind of thing a Servkro comparison would have flagged - but we have **no
> evidence** they are what items 5-8 and 10 said. The original may have been about discounts,
> reports, receipts or something else entirely.
>
> **Do not close items 5-8/10 on this basis.** Treat the table above as a *separate, now-verified*
> gap backlog - see `EVALUATION.md` section 7.

**Still do not invent item text.** Recover the original list from whoever commissioned the Servkro
review, or re-run a fresh competitor review.

---

## Related, but not on the Servkro list

Work that came out of the same review cycle but is recorded as its own stream:

- **Features sub-tab** (per-feature on/off toggle with attached manual, default OFF on restaurant
  create, hard-refresh popup after save). Not attributed to a gap number in the ledger.
- `channel:'both'` labelled "WhatsApp + POS" but behaves identically to `pos` - flagged, out of
  scope, **still open** (`PROJECT_LEDGER.md:162`).
- Residual stale comment at `bot/index.js:1599` - **still open**, deliberately left because the
  file carries another workstream's in-flight WIP (`PROJECT_LEDGER.md:163`).
- Discounts: a row already saved as `channel:'whatsapp'` still cannot fire - pre-existing, it
  never could (`PROJECT_LEDGER.md:166`).

---

## If the original list surfaces

1. Add it verbatim as `Competitor/GAP-LIST-ORIGINAL.md`.
2. Reconcile numbering against this file - especially whether "post-fix review" and "Servkro
   gap list" really are one list.
3. Check items 5-8 and 10 against what has shipped since; some may already be fixed by accident.
