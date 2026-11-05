# Plan: "Add Combo" → Multi-Step Flow Page (Admin Catalog)

Status: **Implemented + E2E verified 2026-10-19** — 5-step wizard live in `Admin/js/features/catalog.js` (build pattern `tools/build.mjs`, deployed `hosting:admin`). Live E2E passed: create with publish → exact RTDB payload, edit prefill (Family Pizza Combo field-for-field), delete via confirm modal. Two rendering/UX bugs found and fixed en route: (1) `cbwNext` validated the draft before `syncDraft()` → "Enter a combo name" on first click even with a filled field (fix: `syncDraft();` first line of the handler); (2) `snap.forEach(ch => combos.push(...))` aborted after the first row — `Array.push` returns a truthy number and RTDB's `forEach` stops on `return true` — so the combos table always showed 1 row no matter how many existed (fix: block body). Note: the RTDB/REST/SDK-return-different-children investigation was a red herring caused by (2).

## Current state (what exists)

`showComboModal(comboId)` (`Admin/js/features/catalog.js:976`) renders ONE tall 640px modal with 6 stacked sections: image+name, dish picker w/ qty steppers, price strip, discount, schedule, redemption caps, coupon. Everything crammed into one scroll. Entry point: `#btnAddCombo` (`data-action="addCombo"` → `Admin/js/main.js:278`). Edit reuses the same modal (`editCombo` :947).

Precedent in codebase: Supreme onboarding wizard (`SupremeAdmin/js/features/restaurant-onboarding.js`) — full-page overlay, `<section data-step="N">` + stepper rail, per-step validation, state retained across back-nav. **Reuse that pattern** (ponytail rung 2).

## Goal

Replace the single modal with a full-screen multi-step flow page. One thing per screen, live math at every step, customer-eye review before publish.

## The 5 steps

Full-screen overlay appended to body (like obw), Admin theme tokens, step rail left (stepper w/ ✓/•/lock states) on desktop, top progress dots on mobile. `Esc`/X closes with an unsaved-changes confirm (only if something was touched).

| # | Title | Contents (moved verbatim from today's modal) | Gate to Next |
|---|-------|----------------------------------------------|--------------|
| 1 | **Combo Basics** | Image upload (128px preview, keep) + Name (maxlength 50) | name non-empty |
| 2 | **Choose Items** | Dish search + checkbox list + qty steppers (`sel` map, cap 20/dish) — auto-jumps a saved filter; **live footer bar: "Original ₹X · 3 items"** | ≥1 dish selected |
| 3 | **Set Price** | Big price card: Original ₹X → **Combo ₹Y** with you-save line. Discount Type (percentage/fixed) + Value (input). Live recompute on every change (`comboPriceTotal` from `shared/cost-math.js` — same source menu uses) | 0 ≤ value; pct ≤ 100; fixed ≤ original |
| 4 | **Schedule & Limits** | Active From/Until (`<input type=date>`), Redemption Caps (max total / per customer / per day, 0 = unlimited), Coupon Code dropdown (optional) | end > start; caps ≥ 0 |
| 5 | **Review & Publish** | Summary card styled like the menu-side combo card: image thumbnail, name, `dish × qty` lines with baked prices, struck original → combo price, discount chip, date window, caps, coupon badge. **Publish** (create) / **Save Changes** (edit) button | — |

Footer: `← Back` · `Next →` (step 5: Publish). Per-step validation failure = error toast + focus the offending field (obw precedent). No partial writes — one atomic save at step 5.

## State handling

- One module-local `draft = { name, image(file/url), items: Map, discountType, discountValue, startAt, endAt, maxRedemptions, perCustomerLimit, perDayLimit, couponCode }`.
- Back-nav keeps values (plain object, no FormData needed).
- Edit path: prefill `draft` from the `combos/{id}` snapshot; unchanged payload shape.

## Data contract (unchanged)

Same RTDB write as today (`catalog.js:1347`): `{ name, items:[{dishId,qty,price}], discountType, discountValue, startAt, endAt, image, maxRedemptions|null, perCustomerLimit|null, perDayLimit|null, couponCode, sourceOid, updatedAt, createdAt }` → `combos/` push/set. **No rules change, no menu/webview change** — customers see combo cards exactly as now.

## Errors during save

Image upload failure or RTDB failure keeps you on step 5, button spinner resets, toast shows the message — same as today's submit handler (:1331–1376, reused logic).

## Files touched

| File | Change |
|---|---|
| `Admin/js/features/catalog.js` | New `showComboWizard(comboId)` (~1 screen markup + controllers). `showComboModal` deleted; `editCombo` + main.js:278 point at the wizard. ~300 lines net |
| `Admin/style.css` (or scoped `<style>` block, like today's) | `.cwn-*` classes: overlay page, stepper rail, price card, footer bar — mirror obw proportions in Admin theme |

No changes: `database.rules.json`, `menu/*`, `shared/*`, `Admin/index.html` (button/entry unchanged).

## Non-goals

- No draft persistence server-side (draft dies on close — today's modal has the same behavior).
- No combo templates/live-preview of the QR card beyond the static review summary.
- SKU-level pricing (sizes) stays out — dish base price only, same as now (`_dishPrice`).

## Verify plan

1. `node tools/build.mjs` → deploy `hosting:admin`.
2. Playwright: create a throwaway combo through all 5 steps (items: any pizza + burger; 20% off) → RTDB record fields match payload → delete it.
3. Edit an existing combo → prefills → change discount → save → move to step-3 math in RTDB.
4. Menu E2E unchanged: QR menu shows the retouched combo with correct baked prices (`_comboData` path untouched).


