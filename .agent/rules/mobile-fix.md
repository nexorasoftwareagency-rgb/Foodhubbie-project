## mobile-fix — Admin Panel Mobile Responsiveness

Before any session modifying the Admin panel, read and apply these rules.

### Project Context
- Repo: `nexorasoftwareagency-rgb/roshani-pizza-bot`
- Admin panel is at `Admin/index.html` (124KB), `Admin/style.css` (172KB), `Admin/mobile-overrides.css` (40KB)
- Stack: Vanilla HTML + CSS + JavaScript, Firebase backend
- Current mobile score: ~38%

### Rules

**Rule 1: Always read files before editing.** Use the `Read` tool to read the full file before any `Edit` operation. Never guess file contents.

**Rule 2: Use exact `oldString`/`newString` edits.** Never rewrite entire files. Match exact whitespace and formatting from the file.

**Rule 3: Prioritize CSS-only fixes over JS changes.** The 5 critical fixes are designed to be mostly CSS. Only touch JS when explicitly required.

**Rule 4: Never touch Firebase config, auth, or business logic.** Only modify presentation layer (HTML/CSS/JS UI).

**Rule 5: No regression on desktop.** All fixes must be inside `@media (max-width: 768px)` blocks. Desktop (≥769px) must remain unchanged.

### The 6 Fixes (in order)

| # | Fix | Files | Type |
|---|-----|-------|------|
| 0 | Viewport, text-size-adjust & image overflow | `style.css` | CSS |
| 1 | Touch targets → 44px minimum (WCAG 2.5.5) | `style.css`, `mobile-overrides.css` | CSS |
| 2 | Responsive tables → stacked cards with data-label | `index.html`, `mobile-overrides.css`, `main.js` | HTML+CSS+JS |
| 3 | Bottom sheet modals | `style.css`, `mobile-overrides.css`, `gestures.js` | CSS+JS |
| 4 | Bottom navigation bar (5 items) | `index.html`, `mobile-overrides.css`, `main.js` | HTML+CSS+JS |
| 5 | Sidebar → slide-out drawer with hamburger | `index.html`, `mobile-overrides.css`, `main.js` | HTML+CSS+JS |

**Execution order:** 0 → 1 → 2 → 4 → 5 → 3 (Fix 3 last because modals are less frequently accessed).

### Fix 0 — Viewport & Image Overflow (Already Partially Done)

**Already in codebase (do NOT change):**
- `index.html` line 6: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`
- `style.css` line 136: `* { box-sizing: border-box; }`
- `style.css` line 152: `body { overflow: hidden; max-width: 100vw; }`
- `style.css` line 157: `html { overflow-x: hidden; }`

**Missing (must add):**
1. `-webkit-text-size-adjust: 100%` and `text-size-adjust: 100%` to the `html` block in `style.css` (~line 157)
2. `img, video, iframe, embed, object, svg { max-width: 100%; height: auto; }` after the `*` block in `style.css` (~line 140)

### Fix 1 — Touch Targets 44px

Add inside `@media (max-width: 768px)` in both CSS files:
```css
button, .btn, [role="button"], .clickable, .action-btn,
input, select, textarea, .nav-link, .tab-item,
.kpi-card, .menu-item, .order-row,
.modal-close, .sidebar-link, .bottom-nav-item {
  min-height: 44px;
  min-width: 44px;
}
```

### Fix 2 — Responsive Tables

1. Add `data-label="ColumnName"` to every `<td>` in every `<table>` in `index.html`
2. Add JS in `main.js` or `ui.js` to toggle `.mobile-card-table` class on all `<table>` elements at ≤768px
3. Ensure `.mobile-card-table` CSS exists in `mobile-overrides.css` (thead hidden, tr→block card, td→flex with ::before for label)

Tables to fix: Recent Orders, Orders history, Riders, Customers, Lost Sales, Feedback.

### Fix 3 — Bottom Sheet Modals

1. On mobile (≤768px), modals become bottom sheets:
   - `align-items: flex-end`
   - `border-radius: 24px 24px 0 0`
   - `max-height: 92vh`
   - `animation: slideUp 0.3s ease-out`
2. Add drag-to-dismiss gesture in `gestures.js`
3. Overlay click dismisses modal

### Fix 4 — Bottom Navigation

1. Add `<nav class="bottom-nav">` with 5 items (Dashboard, Orders, Menu, Riders, More) before `</body>` in `index.html`
2. Add bottom nav CSS in `mobile-overrides.css` (fixed, 65px, safe-area, flex, glass effect)
3. Wire tab switching in `main.js`
4. Add `padding-bottom` to main content to offset nav

### Fix 5 — Sidebar Drawer

1. Add hamburger button to mobile header in `index.html`
2. Sidebar becomes slide-out drawer: `translateX(-100%)`, `85vw` width, `max-width: 320px`
3. Add overlay behind sidebar
4. Wire hamburger + overlay + Escape key to toggle in `main.js`
5. `body.sidebar-active { overflow: hidden; }`

### Verification Checklist

- [ ] iOS Safari does not auto-enlarge form text (Fix 0)
- [ ] No image overflows its container (Fix 0)
- [ ] All tap targets ≥44×44px on mobile (Fix 1)
- [ ] All data tables stacked as cards at ≤768px (Fix 2)
- [ ] All modals slide up from bottom, swipe-dismiss (Fix 3)
- [ ] Bottom nav visible, taps switch tabs (Fix 4)
- [ ] Hamburger toggles sidebar drawer (Fix 5)
- [ ] Desktop (≥769px) layout is unchanged
