# Aggregators: Zomato, Swiggy (and the delivery marketplaces)

**Not software competitors. Market forces we position against - and are contractually forbidden
from promoting.**

---

## Why they are in this folder

Two reasons, pulling in opposite directions:

1. **They are the framing device for our sales story.** Our own SEO plan pitches us *against*
   them: `"WhatsApp Ordering vs Zomato/Swiggy: Why Restaurants Are Switching"`
   (`MARKETING_SEO_AI_OPTIMIZATION.md:114`) and the keyword
   `"in-house delivery vs Swiggy"` (`:140`).
2. **We are forbidden from featuring them in the product.**
   `website/Improvements/Rider improvements Section.md.txt`:
   - `:9` - `Do NOT mention or visually promote Swiggy, Zomato, or any third-party delivery
     marketplace as an integrated feature.`
   - `:727` - banned list includes `Competitor logos` and `Swiggy/Zomato branding`

---

## What we know

| Fact | Tag | Source |
|------|-----|--------|
| Aggregator commission is a separate, negotiated cost - and is **often larger than the software bill** | [web] | appadvisor.in |
| Commission is not reduced by buying middleware such as UrbanPiper | [web] | appadvisor.in |
| Our marketing positions WhatsApp ordering as the alternative to them | [repo] | `MARKETING_SEO_AI_OPTIMIZATION.md:114` |
| Our rider section must not promote them | [repo] | `website/Improvements/Rider improvements Section.md.txt:9` |
| No comparison table naming them may appear in the website | [repo] | `.../Rider improvements Section.md.txt:633,636` |
| A competitor comment (`ZOMATO STYLE`) was already stripped from code | [repo] | `Fixes-and-Changes/files (1)/FOODHUBBIE-REVIEW-PASS-2-VERIFIED.md:49` |

---

## Strategic read

**[assessment]**

**We are not competing with Zomato and Swiggy - we are selling the exit from them.**

Our pitch, per our own materials: keep the customer relationship, keep the data, keep the margin.
The mechanics behind that pitch:

| Aggregator model | FoodHubbie model |
|------------------|------------------|
| Commission per order, negotiated, typically exceeds the software bill [web] | Fixed: INR 1/customer or INR 750/mo [repo] |
| Customer relationship belongs to the platform | Customer database is ours: walk-in + QR + WhatsApp [repo] |
| Rider network rented | Restaurant's own riders, own payout rules, own settlement [repo] |
| Menu shared across platforms, sync needed | One menu, one source of truth [repo] |
| Middleware often required to make a POS work with them | Not applicable - we own the ordering channel |

**The tension to hold:** our product does *not* integrate with aggregators, and our marketing
must not imply it does. That is a positioning choice, not an oversight - but it must be stated
honestly in sales conversations, because a prospect comparing us to Petpooja (which does integrate)
will ask.

---

## Do-not-do list

Carried forward from the website brief, applies to any competitor material:

- [ ] No comparison table on the website or in product UI
- [ ] No competitor logos
- [ ] No Swiggy / Zomato branding or implied integration
- [ ] No naming them as a feature
- [ ] No fake screenshots or unsupported claims
  (`website/Improvements/Rider improvements Section.md.txt:727-728`)

**This folder is internal.** See `../README.md` for the full constraint set.
