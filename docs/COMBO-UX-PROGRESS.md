# Combo UX Progress Tracker

Based on comparison of our system vs Domino's & Swiggy (customer menu + admin management).

## Status Key
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[-]` Deferred / skipped

---

## Customer Menu (QR menu + delivery webview)

| # | Suggestion | Source | Status | Notes |
|---|---|---|---|---|
| 1 | **Promoted offers section on home**: Show "Combo Offers / Today's Deals" directly under top bar / above category pills, always visible (not hidden when a category is selected). | Domino's EDV / Swiggy "Offers for you" | `[x]` | Done — moved #comboOffersSection above #categoryPillsRow in index.html + delivery.html; removed category-based hide in _renderComboOffers (app.js + delivery.js). Live-verified PASS on QR + delivery. |
| 2 | Make every offer tappable → bottom sheet with item breakdown + ADD TO CART (done in prior redesign) | Domino's read-only offer fix | `[x]` | Implemented + verified |
| 3 | Sticky Add during scroll — price + ADD fixed at bottom of card detail | Swiggy / Turumburum | `[ ]` | |
| 4 | Cross-sell on combo detail — "Add a drink for ₹49" / side upsell chips in bottom sheet | Domino's cross-sell blocks | `[ ]` | |
| 5 | Explicit veg/non-veg marks — store `veg` flag on dish, render green-dot / red-triangle square | Swiggy mandatory mark | `[x]` | Done — added `veg: true` to all 22 RTDB dishes; switched `_comboVegMark` (app.js + delivery.js) from name-heuristic to `d.veg === false` check. Live-verified PASS. |
| 6 | Compact cards + fixed/sticky category pills at top during scroll | Turumburum fixed filters | `[ ]` | |
| 7 | Sort by popularity / price dropdown | Domino's case study | `[x]` | Done — sort dropdown added to category pills row on QR menu + delivery webview; sort applied to dish list (combos unaffected); sort state persisted in M.sortKey |
| 8 | Recent searches / favorites / repeat order blocks | Domino's repeat order | `[ ]` | |

---

## Admin Management (Combos tab)

| # | Suggestion | Source | Status | Notes |
|---|---|---|---|---|
| 9 | Offer listing table — name, code, discount, dates, status badge, redemptions, discount given, last used | Industry standard | `[x]` | Done — converted card grid to `premium-table-v4` table with combo name, items, price, discount, status badge (Active/Expired/Disabled), valid dates, and Edit/Delete/Enable-Disable toggle actions. |
| 10 | Status toggle (Enable/Disable) per offer with pause reason; draft vs live | Industry standard | `[x]` | Done — added `disabled`/`disabledAt`/`disabledBy` fields on combo records; toggle switch in table; `isComboActive()` now checks `combo.disabled` first so disabled combos are hidden from customer QR menu and delivery webview. |
| 11 | Redemption caps — max total, per-customer, per-day | Industry standard | `[x]` | Done — added 3 cap fields to combo modal (maxRedemptions, perCustomerLimit, perDayLimit); stored on combo records; enforcement in _addComboToCart (menu/js/app.js + delivery.js) using Firebase transactions; admin listing table shows current/total cap usage. `isComboActive()` also checks `combo.disabled`. |
| 12 | Customer segment targeting — new customers / all / specific outlets | Industry standard | `[ ]` | |
| 13 | Coupon code association — link combo to coupon code (YAY99-style) redeemable at checkout | Industry standard | `[x]` | Done — added coupon code dropdown to combo modal (fetches existing coupon-type discounts from /discounts/); stores `couponCode` on combo record; menu QR + delivery enforce coupon at add-to-cart time (shows toast + focuses discount input if code not applied). |
| 14 | Clone combo — duplicate existing combo with new dates | Industry standard | `[ ]` | |
| 15 | Preview — "View as customer" link opening QR menu filtered to combo | Industry standard | `[x]` | Done — added "Preview" button to each combo row in admin table; opens QR menu in new tab at `https://foodhubbie-qrmenu.web.app/?o=<outlet>&b=roshani-pizza`. Added `previewCombo` case in main.js click handler. |
| 16 | Bulk actions — select multiple → enable/disable/delete | Industry standard | `[ ]` | |

---

## Recommended rollout order (ponytail)
1. Customer #1 (promoted home section) — now
2. Customer #5 (veg marks from dish data)
3. Admin #9 + #10 (listing table + status toggle)
4. Admin #11 + #13 (caps + coupon linking)
5. Remaining customer + admin items as needed

---

## Completed (this session)
- Combo card redesign (veggie mark, scrim badge, floating ADD, bottom sheet, category-aware visibility, delivery parity) — done, live-verified
- Coupon label fix (Weekend Special shown on cart + RTDB order record) — done
- Full QR combo+coupon+checkout flow — live-verified
- Horizontal scroll carousel removed (per user request) — done, live-verified
