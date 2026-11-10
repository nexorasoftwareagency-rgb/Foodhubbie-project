# Customer APP — Sub-tab 3: App Visibility

**Status:** Planning  
**File:** `Admin/js/features/customer-app.js` (pane 3)  
**Route:** `tab-customer-app` → sub-tab `visibility` (`caPaneVisibility`)

---

## 1. Purpose & Use Cases

**Purpose:** Let the restaurant owner control exactly what customers can see and do in their app — dishes, categories, and features. This is the "menu curation" layer of the customer app.

**Primary use cases:**

| # | Use Case | Who | When |
|---|----------|-----|------|
| 1 | Hide an out-of-stock dish from app | Staff | Item ran out, don't disappoint customers |
| 2 | Show a dish back on app | Staff | Item restocked |
| 3 | Hide an entire category | Owner | Seasonal category (e.g., "Winter Soups" in summer) |
| 4 | Enable/disable online ordering | Owner | Kitchen closed, only dine-in today |
| 5 | Enable/disable table booking | Owner | No table manager today |
| 6 | Enable/disable Promo Page | Owner | No active coupons this week |
| 7 | Enable/disable loyalty | Owner | Running a promo instead of loyalty |
| 8 | See at a glance how many dishes are hidden | Owner | Monthly menu audit |
| 9 | Bulk hide/show multiple dishes | Staff | Large inventory change |
| 10 | Reorder dishes/categories in app display | Owner | Featured items first |

---

## 2. Current UI (What Exists)

| Element | ID | Status |
|---------|----|--------|
| Total dishes stat | `visTotalDishes` | ✅ |
| Visible dishes stat | `visVisibleDishes` | ✅ |
| Total categories stat | `visTotalCategories` | ✅ |
| Visible categories stat | `visVisibleCategories` | ✅ |
| Empty state | `caVisEmpty` | ✅ |
| Refresh button | `btnVisibilityRefresh` | ✅ |
| Dish list | `visDishList` | ✅ (name, price, visible toggle) |
| Category list | `visCategoryList` | ✅ (name, visible toggle) |
| Feature toggles | `visFeature*` | ✅ (onlineOrdering, tableBooking, promoPage, loyalty) |
| Toggle per dish/category | `input[data-id][data-type]` | ✅ |

**Data source:** `Outlet.ref('menu/dishes')`, `Outlet.ref('menu/categories')`, `Outlet.ref('settings/Store')`

---

## 3. Gaps & UX Problems

| # | Problem | Impact |
|---|---------|--------|
| 1 | No search | Can't find a dish among 50+ items |
| 2 | No filter | Can't show only hidden items |
| 3 | No bulk actions | Toggle one at a time |
| 4 | No reordering | Can't control display order in app |
| 5 | No out-of-stock indicator | Can't see which dishes are unavailable |
| 6 | No dish count per category | Don't know category size |
| 7 | No featured/hero marking | Can't mark "Chef's Special" |
| 8 | No section grouping | All dishes in one flat list |
| 9 | No app preview | Don't know how it looks to customer |
| 10 | No "hide unavailable" auto-toggle | Must manually hide out-of-stock |
| 11 | No dish image | Can't identify dishes visually |
| 12 | No category sort order | Can't reorder categories |
| 13 | No "select all visible/hidden" | Tedious cleanup |

---

## 4. Planned Enhancements

### 4.1 Search & Filter
- Search by dish/category name
- Filter: All / Visible / Hidden / Out of stock / Low stock
- Filter: By category (for dishes)

### 4.2 Bulk Actions
- Checkbox per item + select all
- Bulk: Show on App / Hide from App / Mark featured / Unmark featured
- Bulk toolbar appears on selection

### 4.3 Reordering
- Drag handles on dish/category rows
- Save order to `sortOrder` field
- Visual indication of current position (#1, #2, #3…)

### 4.4 Stock Indicators
- Show stock level next to dish name (e.g., "12 left", "Out of stock")
- Color coding: green (ok), yellow (low < 5), red (out)
- "Hide out-of-stock" bulk action

### 4.5 Category Enhancements
- Show dish count per category (e.g., "Pizzas · 8 items")
- Category reordering
- Category toggle hides/shows all dishes inside

### 4.6 Featured / Hero
- Mark dishes as "Featured" (shows with star badge in app)
- Max 6 featured dishes (enforced with warning)
- Featured dishes appear at top of app menu

### 4.7 App Preview
- "Preview Menu on App" button — opens mock customer menu view
- Shows visible/hidden state, categories, featured items
- Toggle mobile/desktop view

### 4.8 Feature Configuration Detail
- Online ordering: link to delivery fee/setup
- Table booking: link to tables configuration
- Promo Page: link to Promo Page Offers sub-tab
- Loyalty: link to Loyalty tab

### 4.9 Keyboard Shortcuts
- `Space` on row → Toggle visibility
- `F` → Toggle featured
- `/` → Focus search
- `A` → Select all / deselect all

---

## 5. Data Model Changes

### Extended: `menu/dishes/{id}`
```
+ visible (bool) — already exists
+ sortOrder (int) — new, default 999
+ featured (bool) — new
+ stock (int) — new (if not already tracked elsewhere)
+ lowStockThreshold (int) — new, default 5
```

### Extended: `menu/categories/{id}`
```
+ visible (bool) — already exists
+ sortOrder (int) — new
+ dishCount (int) — computed, denormalized
```

---

## 6. Implementation Tasks

### Frontend (customer-app.js pane 3)

1. **Search input** above dish/category lists
2. **Filter chips** — All / Visible / Hidden / Out of stock / By category
3. **Sort dropdown** — Name, Price, Stock, Sort Order
4. **Bulk selection** + bulk toolbar (Show/Hide/Feature/Unfeature)
5. **Drag reorder handles** on rows
6. **Stock badges** — color-coded stock levels
7. **Featured stars** — per-dish featured toggle
8. **Category dish counts** — show count next to category name
9. **"Hide all out-of-stock"** quick action
10. **"Show all"** quick action
11. **Preview menu button** — opens customer menu mock
12. **Feature configuration cards** — richer descriptions with links

### Styles (style.css)

- `.ca-visibility-row--selected` — selection highlight
- `.stock-badge` — green/yellow/red stock indicators
- `.featured-badge` — star icon
- `.sort-handle` — drag handle styling
- `.category-count` — dish count badge
- `.bulk-toolbar-visibility` — floating actions bar

---

## 7. Acceptance Criteria

- [ ] Can search dishes/categories by name
- [ ] Can filter by visible/hidden/out-of-stock
- [ ] Can toggle single item visibility with toast
- [ ] Can bulk select and bulk show/hide
- [ ] Can reorder dishes/categories via drag
- [ ] Can mark dishes as featured (max 6)
- [ ] Can see stock levels with color coding
- [ ] Can see dish count per category
- [ ] Can preview how menu looks to customer
- [ ] Can toggle features with description
- [ ] 0 console errors
- [ ] Mobile: lists usable on 360px width

---

## 8. Files to Modify

| File | Change |
|------|--------|
| `Admin/js/features/customer-app.js` | Pane 3: search, filter, sort, bulk, reorder, stock badges, featured, preview |
| `Admin/index.html` | Add search, filter chips, bulk toolbar, preview modal |
| `Admin/style.css` | New styles for stock badges, featured, drag handles, bulk toolbar |
| `shared/discount-rules.js` | No change |
