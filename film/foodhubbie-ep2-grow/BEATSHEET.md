# EP2 GROW — beat sheet (28.0 s · 1920×1080 → 4K60) — DESIGN (build after batch2)

Carrier: the **coupon chip** (code pill ₹-chip → broadcast ripple → star).
Graphics needed (all in admin-batch2a/b take list): combos tiles, discounts list,
promotions composer, customers cards, feedback donut, notifications composer.
Fallback if a screenshot misses: DOM chip + caption (never a blank station).

## Story in one line

A combo tile becomes a discount, the discount becomes a coupon code, the code rides
a WhatsApp campaign to 300 customers, they come back as orders, their stars fill the
feedback donut — growth you can audit.

## Stations (banked frames — PII-safe, non-empty only)

| x | station | graphic |
|---|---|---|
| 0 | combos | `shots/combos.png` (Family Pizza Combo ₹386→₹340) |
| 1100 | discounts | `shots/discounts.png` (Navratri + YAY99 + usage stats) |
| 3800 | coupon code | DOM code pill (DIWALI7X typing out) |
| 6400 | campaign | `shots/campaign.png` (composer + Launch + Active/History) |
| 8700 | proof | `shots/discounts.png` reused, zoomed to usage bars (17× · ₹972) |
| 10800 | seal | disc → "GROW" + "Next: EP3 MONEY" |

Dropped vs v1: customers (loading-stuck frame), feedback (empty state), notifications
(empty state), chat threads (real customer phone numbers — PII, never in a public film).

## Beats (mirror EP1 skeleton, same T grid)

1. 0.0 combos macro → 2. seed 1.40 (coupon chip pops) · 3. whip 2.60 → discounts
   list, chip lands on "Weekend Special" 3.10 · 4. rest · 5. code types out 7.40
   (DIWALI7X) → proof zoom 8.40 (usage bars count up: 17× · ₹972) → staccato
   8.9/9.2/9.5 (CREATE→SEND→REDEEM) · 6. campaign composer 11.40 (template + image),
   Launch press 12.05, progress bar fills 11.6–12.6 · 7. proof returns 13.05–13.55
   (usage counters tick up) · 8. rest · 9. gather 20.30–21.05 · 10. fold 22.40 →
   stamp 23.00 → "GROW" + "Next: EP3 MONEY" · 11. tagline 24.0
   "Offers that pay for themselves." · 12. end 24.95 + CTA, still to 28.

## Contract

inFrame: chip [1.35, 22.95]. Same gates as EP1.
