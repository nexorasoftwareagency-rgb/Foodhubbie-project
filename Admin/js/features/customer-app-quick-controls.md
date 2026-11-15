# Customer App Tab — UI Improvement Plan: Quick Controls

## Goal
Replace the "messy" dense-list UI with a clean, dashboard-style **Quick Controls** surface on the Overview tab — the most-used actions (toggle visibility, toggle promo page, feature dish, flip app features, copy app link) are one click away, with no inline styles in JS.

## Problems Found
| # | Issue | Impact |
|---|-------|--------|
| 1 | 6 sub-tabs; every action needs navigation | High cognitive load |
| 2 | Settings pane crams 15+ fields, no grouping | Overwhelming |
| 3 | ~100 inline `style="..."` attributes in JS render functions | Unmaintainable |
| 4 | No quick-toggle surface; actions buried in lists | Extra clicks |
| 5 | Inconsistent save (batched vs individual) | Confusing |
| 6 | Live vs Saved distinction is tiny pill text | Easy to miss |
| 7 | Dense lists poor on mobile | Bad mobile UX |

## Improvement Plan

### Phase 1: Quick Controls Panel (Overview tab)
Add a "Quick Controls" card grid on Overview with the 6 most-used actions:
- **App Link** — copy / open
- **Push Notifications** — on/off toggle (subscribers count)
- **Promo Page Coupons** — how many on page, quick enable/disable all
- **Dish Visibility** — hide/show out-of-stock, feature/unfeature
- **App Features** — online ordering, table booking, promo page, loyalty switches
- **App Settings** — edit store name, WhatsApp, review link (the 3 "live" fields)

Each card: icon + title + live value + one primary action button + "Live in app" / "Saved only" badge.

### Phase 2: Consolidate Settings
Group settings into 5 labeled sections with clear visual separation:
1. Store Identity (name, address, phone, WhatsApp, review link, welcome message)
2. Ordering (dine-in, delivery, pickup, min order, delivery fee)
3. Charges & Tax (GST rate, tax on delivery fee)
4. Hours & Timezone (business hours grid, timezone)
5. Branding (theme color, logo URL)

### Phase 3: Remove Inline Styles
Move all ~100 inline `style="..."` attributes from JS render functions into CSS classes:
- `.qa-row`, `.qa-row--selected`, `.qa-row__info`, `.qa-row__meta`
- `.qa-badge`, `.qa-badge--in-stock`, `.qa-badge--low-stock`, `.qa-badge--out-of-stock`
- `.qa-toggle`, `.qa-toggle--on`, `.qa-toggle--off`
- `.qa-status--live`, `.qa-status--hidden`
- `.qa-actions`, `.qa-icon-btn`

### Phase 4: Consistent Save Behavior
- Quick Controls toggles: auto-save individually with toast confirmation (like feature toggles today)
- Settings: keep batched Save bar but make dirty state more prominent
- Add undo toast for 5 seconds on destructive actions (archive/delete)

### Phase 5: Mobile Improvements
- Stack stat cards on mobile
- Quick Controls cards become full-width on <640px
- Lists become cards instead of table-like rows

## Files to Change
1. `Admin/style.css` — add `.qa-*` quick-control CSS classes, remove redundant inline-style overrides
2. `Admin/js/features/customer-app.js` — add `_renderQuickControls()`, move inline styles to classes, add quick control handlers
3. `Admin/index.html` — add Quick Controls panel markup to Overview pane

## Success Metrics
- Common actions (toggle visibility, toggle promo page) require ≤1 click from Overview
- Zero inline `style="..."` attributes in customer-app.js render functions
- Settings page visually grouped into ≤5 sections
- Mobile-friendly at 390px width
