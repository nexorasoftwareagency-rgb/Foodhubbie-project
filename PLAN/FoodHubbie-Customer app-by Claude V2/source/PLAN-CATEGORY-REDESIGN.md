# PLAN-CATEGORY-REDESIGN — Complete UI/UX Update of the Categories Tab

**Status:** PLAN (awaiting owner go) · **Created:** 2026-10-30 · **Scope:** Admin `#tab-categories` only
**Owner ask:** "Create a plan — for complete UI and UX update or redesign of category tab."

---

## 1 · Current-state audit (verified 2026-10-30)

Markup: `Admin/index.html` 1327-1461 · Logic: `Admin/js/features/catalog.js` (`loadCategories` L16-79, `addCategory` L90+, addons editor L620+, edit/delete actions) · Styles: `Admin/style.css` (`.category-grid` L1495, `.category-preview-img`, `.category-addons-container`).

| # | Area | Today | Problem |
|---|------|-------|---------|
| A | Layout | Two plain glass-cards side by side: Create-form (left) + Active list (right) | Form occupies permanent 50% width even when unused; empty state on the right is a bare skeleton |
| B | List rows | `premium-row-v4` identity chips (40px avatar, name, "Serial · dishes · addons") appended into `.category-grid` — a **130px-minmax grid** | Rows and grid fight: a wide row crammed into ~130px columns; sub text truncates; inconsistent geometry vs the row-based look (other tabs are rows or cards, never both) |
| C | Create form | Photo + Name + Serial share one squeezed row; addons builder below | Cramped; serial ("order") is unexplained; no validation feedback until save fails |
| D | Category images | Uploaded as whatever `btnChangeCatPhoto` produces (`#catFile`) | These are **QR-menu-bound images** → not part of the WebP sweep (WhatsApp-promo exemption doesn't apply here, but category thumbs were never touched by any density/image pass) |
| E | Search | `#categorySearch` in header | Verify it filters `#categoryList` — if dead, wire it (search input exists in several tabs and some are decorative) |
| F | Add-ons builder | Rows of name+price, shared code path with dish addons | Works, but visually floats unanchored in the card |
| G | Sync | "Migrate" button (dish-addon sync) sits in the tab header | Dangerous-looking icon next to search; deserves a footnote, not a headline |
| H | Mobile | `.dashboard-grid` collapses; 130px grid stays | Squared avatars wrap badly on narrow screens |

Data lives at `outlets/{oid}/categories/{cid}` (`{name, image?, order|sort, addons?}`); menu/QR and the Menu Browser sidebar both consume it — **display-order and image changes here are customer-facing; naming must not be touched** (`d.category` matches by string).

## 2 · Design direction (NH-10 v4 system, consistent with the 3 tabs compacted on 10-29/30)

One-column flow, not cards-vs-rows split:
1. **Tab header** — search (left), Migrate demoted to an icon-with-tooltip beside it, Add Category as the single primary button (opens the drawer below) instead of a permanent half-panel.
2. **Category grid — real cards this time**: `repeat(auto-fill, minmax(150px, 1fr))`, 16:9 image (matches `#menuGrid`/browser density pass), name, count chips (dishes · addons · serial), kebab/footer with Edit + Delete (24px `btn-action-v4`, same as Menu tab). Every category visible on one screen — the "more at once" principle the owner asked for on Inventory/Menu/Browser/Combos applies here too.
3. **Create/Edit lives in a slide-in drawer** (pattern already used by dish/combo modals) — photo cropper-lite (center-fill preview), name with live duplicate check against `state.categories`, serial stepper, add-on rows grouped in a labelled sub-card. Reusing the drawer dodges a new rail system (ponytail: no unrequested abstraction).
4. **Header ribbon on the grid** — "X categories · Y dishes mapped · Z unmapped" KPI strip (reuses `kpi-card-v4` micro-style, 3 inline pills, not full cards).

## 3 · Phased execution (each phase: build → deploy → measured E2E → ledger)

| Phase | Work | Files | Verify |
|---|---|---|---|
| **P1 — Grid & header** (core visible win) | Replace two-column glass layout with header + ribbon + compact card grid (§2.1-2.2, 2.4). Search wired (fix or wire E). Cache bumps. | `index.html` (tab block), `catalog.js` (renderer only — same data listeners), `style.css` new `#tab-categories` block, `sw.js` | `tests/e2e-category-redesign.js`: cards <170px & ≥1 row of ≥4, name/count visible, search filters live, screenshots |
| **P2 — Create/Edit drawer** | Form moves into drawer opened by header button + Edit card button; duplicate-name toast at trust boundary; serial stepper; addons sub-card restyle | `index.html` (form block), `catalog.js` (`addCategory`/`editCategory` bring-up, save flow unchanged), `style.css` drawer reuse | E2E: open drawer → create cat → card appears (live RTDB, e2e tenant) → edit → duplicate blocked |
| **P3 — Image UX + delete guard** | Category images through `uploadImage(..., {webp:true})` (QR-menu-bound, legal for WebP — **not** WhatsApp-promo class); delete confirm modal already exists — add type-the-name confirm when `dishCount > 0` (protects customer menu) | `catalog.js` image path, `index.html` | E2E: upload 40KB PNG → stored `data:image/webp` + smaller; empty-cat delete passes, populated-cat requires name |
| **P4 — Mobile + a11y polish** | Sidebar-less tab → straight stack at ≤1024px; focus-visible rings on cards/kebab; `aria-live` on count ribbon; touch targets ≥40px on mobile overrides | `mobile-overrides.css`, `style.css` | E2E 375px viewport battery + tap sizes; `web-design-guidelines` audit pass |

Estimated: P1 ≈ one session, P2 ≈ slightly more, P3-P4 each small. Each phase is independently shippable.

## 4 · Non-goals / guards
- **No data-model changes** — `categories/{cid}` shape stays; QR menu + webview + bot discount-engine read it as-is.
- **No renames** of category names/images in DB; render-only.
- **Menu Browser sidebar** (`browserCategoryList`, menu-browser.js) shares `state.categories` — untouched; its own skeleton/UX follows this plan's language only if owner asks.
- Other agents' uncommitted work (`.gitignore`, `Promo-Campaign/` deletions, `website/promo`) stays out of every commit here.
- Never block on `loadCategories` listeners these flows already own (`_categoriesUnsub`, `updateActiveDishModalCategories` fan-out preserved).

## 5 · Risks & mitigations
- **Dish modal depends on category list fan-out** (`updateActiveDishModalCategories`) — renderer rewrite must keep the call on every snapshot render (P1 test asserts dropdown still populated).
- **`.category-grid` minmax 130px is also referenced elsewhere?** Verified single consumer — safe to restyle.
- WebP on category images: Safari fallback already handled by `uploadImage`'s JPEG fallback (shipped with the 10-29 WebP sweep — reuse, no new encoder).
- Cache discipline: every deployed phase bumps `style.css?v=` + `CACHE_NAME` (burned twice on 10-29 — PowerShell edits corrupt files; **edit tool only**, encoding check gates every build).
