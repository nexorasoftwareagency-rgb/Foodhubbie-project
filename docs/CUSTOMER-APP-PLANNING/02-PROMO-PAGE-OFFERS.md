# Customer APP — Sub-tab 2: Promo Page Offers

**Status:** Planning  
**File:** `Admin/js/features/customer-app.js` (pane 2)  
**Route:** `tab-customer-app` → sub-tab `offers` (`caPaneOffers`)

---

## 1. Purpose & Use Cases

**Purpose:** Let the restaurant owner control which coupon discounts appear on the customer-facing Promo Page in the app. This turns the app's Promo Page into a curated storefront of active offers.

**Primary use cases:**

| # | Use Case | Who | When |
|---|----------|-----|------|
| 1 | See all coupon discounts with status | Owner | Weekly review of active offers |
| 2 | Toggle a coupon on/off the Promo Page | Owner | When a promo starts/ends |
| 3 | Create a new coupon discount | Owner | Launching a new campaign |
| 4 | Edit an existing coupon (value, dates, cap) | Owner | Adjusting an active campaign |
| 5 | See which coupons are valid right now | Owner | Before a weekend rush |
| 6 | Bulk show/hide multiple coupons | Owner | Seasonal change (e.g., summer → winter) |
| 7 | Preview how a coupon looks on the Promo Page | Owner | Before publishing |
| 8 | See redemption stats (how many times used) | Owner | Measuring campaign ROI |
| 9 | Archive/retire an old coupon | Owner | Campaign ended, keep for reference |
| 10 | Duplicate a coupon | Owner | Creating similar offer with small changes |

---

## 2. Current UI (What Exists)

| Element | ID | Status |
|---------|----|--------|
| Total coupons stat | `promoOffersTotal` | ✅ |
| Showing on Promo Page stat | `promoOffersOnPage` | ✅ |
| Valid now stat | `promoOffersValid` | ✅ |
| Empty state | `promoOffersEmpty` | ✅ |
| New Coupon button | `btnPromoOffersNew` | ✅ (navigates to Discounts tab) |
| Empty-state Create Coupon button | `btnPromoOffersEmptyNew` | ✅ (navigates to Discounts tab) |
| Offer list container | `promoOffersList` | ✅ |
| Offer rows (name, code, value, status, toggle) | `.promo-offer-row` | ✅ |
| Promo Page toggle checkbox | `input[data-id]` | ✅ |

**Data source:** `Outlet.ref('discounts')` — real-time listener

---

## 3. Gaps & UX Problems

| # | Problem | Impact |
|---|---------|--------|
| 1 | No search/filter | Can't find a specific coupon among many |
| 2 | No sort options | Fixed by updatedAt only |
| 3 | No bulk actions | Must toggle each coupon individually |
| 4 | No inline edit | Must navigate to Discounts tab to change value/dates |
| 5 | No preview of customer view | Don't know how it looks on Promo Page |
| 6 | No redemption stats | Don't know if coupon is being used |
| 7 | No expiry/start date picker | Must go to Discounts tab |
| 8 | No channel management | Can't see which channels (website/table/POS) apply |
| 9 | No archive/soft-delete | Can't hide old coupons without deleting |
| 10 | No duplicate action | Must recreate from scratch |
| 11 | No min/max discount config inline | Max cap not visible/editable |
| 12 | No "Select all" toggle | Tedious for many coupons |
| 13 | Empty state CTA navigates away | Leaves current context entirely |
| 14 | No per-coupon last used date | Don't know when it was last redeemed |

---

## 4. Planned Enhancements

### 4.1 Search, Filter, Sort
- Search by coupon code, name, or discount value
- Filter: All / On Promo Page / Not on Page / Valid / Expired / Disabled
- Sort: Name (A-Z), Value (high-low), Expiry (soonest first), Usage (most used), Updated (newest first)

### 4.2 Inline Quick Edit
- Click a row to open a slide-over panel
- Edit: name, value, mode, min subtotal, max cap, start/end dates, channel
- Inline toggle for `promoPage` (already exists, keep)
- Save with confirmation toast

### 4.3 Bulk Actions
- Checkbox per row + "Select all"
- Bulk: Show on Promo Page / Hide from Promo Page / Enable / Disable / Archive
- Bulk toolbar appears when 1+ selected

### 4.4 Promo Page Preview
- "Preview on App" button opens a mock customer Promo Page
- Shows how coupons appear with images, codes, "Apply" buttons
- Toggle between mobile/desktop view

### 4.5 Redemption Analytics
- Column: "Times used" (from `stats.usedCount`)
- Column: "Total given" (₹ value of discounts given)
- Column: "Last used" (date)
- Column: "Redemption rate" (used / globalLimit)

### 4.6 Coupon Lifecycle Management
- Archive: moves to "Archived" section, not shown on Promo Page
- Restore: bring archived back to active
- Delete: permanent (with confirmation)
- Duplicate: pre-fills edit form with same values, new code

### 4.7 Date Pickers
- Start date / End date inline in quick-edit panel
- Happy-hour-style day-of-week + time window
- Visual indicator: "Active now", "Starts in 2 days", "Expired 3 days ago"

### 4.8 Channel Visibility
- Show which channels each coupon applies to: Website (Promo Page), Table QR, POS Walk-in, WhatsApp
- Toggle channel per coupon in quick-edit

### 4.9 Empty State Improvements
- "Create your first coupon" → opens inline editor (not full navigation)
- Suggest popular coupon types: "20% off first order", "₹100 off ₹500", "Buy 1 Get 1"

### 4.10 Keyboard Shortcuts
- `Ctrl+N` → New coupon
- `/` → Focus search
- `Space` on row → Toggle promoPage
- `A` → Select all / deselect all

---

## 5. Data Model Changes

### Extended: `discounts/{id}`
```
+ stats.usedCount (int) — already exists in some flows
+ stats.totalGiven (paise) — new
+ stats.lastUsedAt (timestamp) — new
+ archived (bool) — new
+ archivedAt (timestamp) — new
+ imageUrl (string) — optional coupon image for Promo Page
+ displayOrder (int) — for custom ordering on Promo Page
```

---

## 6. Implementation Tasks

### Frontend (customer-app.js pane 2 + index.html + style.css)

1. **Search input** above offer list — filters in real-time
2. **Filter chips** — All / On Page / Off Page / Valid / Expired / Disabled / Archived
3. **Sort dropdown** — Name, Value, Expiry, Usage, Updated
4. **Bulk selection** — checkbox per row + select all in header
5. **Bulk toolbar** — appears on selection: Show on Page / Hide from Page / Enable / Disable / Archive / Delete
6. **Quick-edit slide-over** — triggered by clicking row or edit icon
7. **Preview button** — opens customer Promo Page mock in modal
8. **Archive/Restore actions** — per-row and bulk
9. **Duplicate action** — per-row
10. **Delete action** — per-row with confirmation
11. **Date badges** — "Active now", "Starts soon", "Expired"
12. **Redemption columns** — used count, total given, last used
13. **Empty state improvements** — inline "Create coupon" button that opens quick-edit
14. **Keyboard shortcuts** — Ctrl+N, /, Space, A

### Styles (style.css)

- `.promo-offer-row--selected` — highlight selected rows
- `.bulk-toolbar` — floating actions bar
- `.quick-edit-panel` — slide-over from right
- `.promo-preview-modal` — customer Promo Page mock
- `.stat-card--highlight` — for important stats
- `.badge--archived` — archived state styling

---

## 7. Acceptance Criteria

- [ ] Can search coupons by code or name
- [ ] Can filter by on-page / off-page / valid / expired
- [ ] Can toggle single coupon on/off Promo Page with toast
- [ ] Can bulk select and bulk toggle
- [ ] Can quick-edit value, dates, channel without leaving tab
- [ ] Can preview how coupons look on customer Promo Page
- [ ] Can see redemption stats (used count, total given)
- [ ] Can archive and restore coupons
- [ ] Can duplicate a coupon
- [ ] Can delete with confirmation
- [ ] Empty state shows "Create coupon" CTA that opens editor
- [ ] 0 console errors
- [ ] Mobile: list usable on 360px width

---

## 8. Files to Modify

| File | Change |
|------|--------|
| `Admin/js/features/customer-app.js` | Pane 2: search, filter, sort, bulk, quick-edit, preview, archive, duplicate, delete |
| `Admin/index.html` | Add search, filter chips, bulk toolbar, quick-edit panel, preview modal |
| `Admin/style.css` | New styles for bulk toolbar, slide-over panel, preview modal |
| `shared/discount-rules.js` | May need `discountRedemptionStats()` helper (read-only) |
