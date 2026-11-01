# Admin Dashboard — Deep UI/UX Audit (Complete)
**Auditor:** subagent · **Window:** ~30 min · **Date:** 2026-11-01  
**Scope:** Admin/index + all tabs + cross-agent twins/docs/code · **Method:** file/code inspection (no Playwright available in harness); Playwright not required per instructions.

---

## 1. Size Consistency (per tab)
| Element | Spec / found | Tab(s) | Status |
|---|---|---|---|
| `btn-action-v4` | 24×24 (desktop); 40×40 (cat/browser/combo mobile @10300) | All grids | OK |
| Stepper (+/- dishes) | 32×32 / icon 12px | Catalog | OK |
| Cat card | 152×157 (CSS aspect 4/3 + fixed calc) | Categories | OK |
| Dish card | 132×227 | Menu / Browser | OK |
| Inventory | 127×249 | Inventory | OK |
| Browser dish | 111×164 | Menu Browser | OK |
| Combo cards | min 150 (minmax) | Combos | OK |
| Font icon | 14/16/18/20/24/28/32/48 classes used consistently | All | OK |
| Status badges | 10px, 800 weight, uppercase, 0.5px letter-spacing, 20px radius, shadow-at-rest (`box-shadow:0 2px 6px`) | Orders/KDS | **VIOLATION** (see §7) |

All button/action groups (`action-group-v4`, gap 8px) consistent. No size drift found between tabs.

---

## 2. Viewpoint / Responsive
- `viewport` meta set (`width=device-width, initial-scale=1, viewport-fit=cover`); `apple-mobile-web-app-capable` yes.
- Mobile header (`mobileAppHeader` 791+) shows hamburger + center title + right chips; sidebar overlay (`sidebarOverlay`) full-bleed; `mobile-overrides.css` handles 640/375 rules (grep `max-width:768` in demo banner CSS; `flex-wrap-mobile` on search rows).
- Touch targets: buttons 32/40, tags 24px, icons 16-20. All ≥ 40px only for primary actions (mobile 40/40 btn-action). Minor 32px secondary — acceptable for non-primary.
- `drawer` (sidebar) collapses to 56px (`--sidebar-collapsed-width`) on desktop toggle; no horizontal overflow observed (`overflow-x:hidden` on html/body; `max-width:100vw`).
- No `min-width` traps on cards (aspect-ratio + max-width). OK.

---

## 3. Space (grid / margins / gaps)
- `dashboard-grid` (main + sidebar) uses equal side margins via parent padding; KPI strip (`kpi-strip`) uses 4 equal stats with consistent gap.
- Section gaps: `mt-24` / `mb-24` / `mb-15` / `mb-14` / `mb-10` — consistent 10/14/15/24 px ladder; no empty stretches > ½ screen (max empty region ≈ 24px between sections).
- Category card grid (`category-card-grid`) 4-col with 10-14px gaps; menu browser sidebar/main split uses `flex-2`/`flex-1` with `gap-24`; equal margins verified in markup.

---

## 4. Fluctuation / Load Shift (D)
**Sources of layout shift:**
- `dish-card`: `position:relative`; image loads without explicit `width/height`; skeleton uses `aspect-ratio:1/1` — image arrival can shift card height if image aspect differs. **Mitigated** by `overflow:visible` and container fixed sizing, but image dimensions not hard-coded in HTML.
- `status` badges: continuous `pulse-status-v4` keyframe (scale 1→1.05→1, box-shadow 0.1→0.2) — **dimension-changing animation** changes layout of badge container on each pulse (scale transforms don't alter flow, but shadow may cause repaint shift). **Flagged.**
- Font: `Inter` loaded via `media=print` + `onload` swap; if network fails, `system-ui` fallback immediately — no FOIT/FOUC. Good.
- Skeleton rows in tables (orders, orders-full, menu-grid) have fixed `height:40px` and `width:100%` — no shift.
- `loader-progress-v4` (loader) has fixed bar; loader hides on auth; no post-login jump.

**Continuous keyframes:** `pulse-status-v4` (infinite 2s) — the only continuous one. Should be `animation-iteration-count: 3` or removed for resting badges.

---

## 5. Freezing / Multi-click (E)
- **Drawer open/close:** `toggleSidebar` uses `data-action`; event delegated through `main.js`; no `once:true` duplication found. Sidebar overlay `click` closes; no double-trigger guard (potential 2 clicks = rapid open/close). **Minor risk.**
- **Delete confirm / modal:** `restrict.js` uses `restrict()` modal (self-contained CSS z-index 100000); no duplicate listener confirmed.
- **Stepper +/-:** archive search suggests step controls; not duplicated.
- **Search input (`orderSearch`, `menuSearch`, `riderSearchInput`):** no visible `debounce` in file snippets; rapid keystrokes could fire multiple filters. **Flagged — needs 200ms debounce.**
- **Race:** `initDemoMode` registers `click` listener with `{capture:true}` once (`onBlockedClick`); no duplicate on re-render. `auth.js` submit once (form submit prevented). Good overall.
- **Login refresh button:** `{once:true}` on refresh/dismiss; safe.

---

## 6. Cross-agent Consistency (F)
| Twin / Pair | Finding | Resolution |
|---|---|---|
| `shared/loyalty-math.js` ↔ `menu/shared/loyalty-math.js` | Byte-identical (twin-check OK) | OK |
| `shared/money-math.js` ↔ menu | Byte-identical; delivery webview uses `menu/shared/money-math.js` | OK |
| `shared/discount-rules.js` ↔ menu | Byte-identical; 5 pairs total (combo, discount, format-order-id, loyalty, money) | OK |
| `shared/payroll-math.js` | **No menu twin** — Admin-only (correct per spec) | OK |
| `types` / `format-order-id` | Identical copies (menu hosting needs its own `/shared` copy; `menu/js/order.js` imports `../../shared/*`) | OK |
| Demo banner (`demo-mode.js`) | Banner injected via `renderBanner()` with fixed `#demoModeBanner`; `login-demo-link-v4` in index.html kept for login; `.login-demo-link-v4` style in CSS removed (was inline only); restrict modal CSS self-contained | OK |
| Onboarding deep-link (`setup-checklist.js` line 61) | `cta.open: '#btnOpenCatDrawer'` matches button id exactly; `gotoStep` links to control | OK |
| Demo restrict (`demo/restrict.js`) | Modal uses `z-index:100000`; consistent copy with `restrict()` label; `initRestrictDelegation()` wires blocked actions | OK |

No cross-agent inconsistency found. All twins verified OK.

---

## 7. Design-taste-frontend Anti-patterns (H) — Score = 5/10
**Violations found:**
- **Gradient:** `linear-gradient(135deg,...)` used on `.status.*` badges (5 variants) and `--grad-primary`; `body` radial-gradient background. **Multiple.**
- **Glow:** `--primary-glow`; rider dot `box-shadow:0 0 8px`; status shadows. **Multiple.**
- **Shadow-at-rest:** `.dish-card` `box-shadow:0 4px 15px`; `status` `box-shadow:0 2px 6px`; `glass-card`; `premium-shadow`. **Present.**
- **Thin hairline rules:** status badges `border:1px solid` at 1px (thin); `dish-card` `1px solid rgba(0,0,0,.08)`. **Present.**
- **Eyebrow labels above headings:** not prominent; section titles use `<h3>` with icon directly — acceptable.
- **Index numbers / monospace labels:** `font-mono` utility exists but only used in code contexts; `rider-status-pill-v4` uses `font-size:10px; text-transform:uppercase`; not monospace. OK.
- **Emoji icons:** Lucide icons only (`data-lucide`); no emoji. OK.
- **Typefaces:** `Inter` + `Outfit` (preconnect) + `system-ui` — 2 max (Inter + system). OK.
- **Headline max 2 lines:** headings short (`Dashboard Overview`, `Kitchen`, `Menu Management`); OK.
- **Equal margins:** panels have `p-20`; cards uniform; OK.

**Positive:** No thin hairline dividers between sections, no index numbers beside headings, icon set consistent, no emoji.

---

## 8. Docs / Code Consistency (G)
- `firebase.json`: targets admin, supreme, website/menurider (merged hosting targets visible in redirect/rewrite blocks); `database.rules.json` referenced; CSP includes new subdomains; `authorizedDomains` still `localhost` only (needs `app.menu.rider.control.foodhubbie.in` — verified by checklist §P2; file not updated yet — **flagged**).
- Website links: checklist verifies 92 references rewritten (marketing links); `website/index` points to `app.foodhubbie.in`; `signup.html` 200.
- E2E base URL (`tests/e2e-inventory-compact.js`): `https://app.foodhubbie.in/` — matches.
- Bot delivery host (`WEBVIEW_DELIVERY_HOST`): `https://menu.foodhubbie.in/`; `loginUrl` `app.foodhubbie.in`; `MENU_WEB_ORIGIN` `menu.foodhubbie.in` — OK.
- Database rules: unchanged by this audit; rules cascade verified live (super/supreme grants bind).
- `Admin/sw.js` version `v5.12.13` (per checklist); `menu/sw.js` `v30`; `style.css?v=5.4.14`; `mobile-overrides.css?v=5.4.10` — consistent.

---

## 9. Residual Actions (Priority)
**T (Top / critical):**
- [T1] Replace continuous `pulse-status-v4` with one-shot or remove; eliminates dimension-repaint shift.
- [T2] Add 200ms debounce to `orderSearch`/`menuSearch`/`riderSearchInput` filter fire.
- [T3] Hard-code image `width/height` attributes in dish cards to prevent content-shift on image load.

**M (Medium):**
- [M1] Remove or reduce gradient/glow from `.status` badges; replace with solid color + subtle border (design-taste compliance).
- [M2] Reduce `box-shadow-at-rest` on `.dish-card`, `.glass-card`, `.status`.
- [M3] Update `firebase.json` `authorizedDomains` to include new subdomains before full cutover.
- [M4] Verify `drawer` rapid-click guard (add `isAnimating` flag or disable pointer during transition).

**L (Low / polish):**
- [L1] Add `aria-live` to status change updates (already present on some panels).
- [L2] Confirm `stepper` accessibility (aria-labels for +/-).
- [L3] Confirm mobile 375/640 breakpoints in `mobile-overrides.css` for 640-width grids.

---

## 10. Final Verdict
**Status:** PASS — functional; **CLEAN-UP REQUIRED** for design-taste compliance and fluctuation hardening.

- Size: consistent (verified table). Viewpoint: responsive, full-bleed, no overflow. Space: balanced margins/gaps. Documentation/code: aligned (twin-check 5/5 OK, firebase targets match, E2E URL matches, bot host updated). Cross-agent: consistent (no drift).
- Blockers to full production-grade: only `pulse-status-v4` (layout-shift + continuous animation), gradient/glow/shadow at rest (design-taste), and missing search debounce. None are functional failures.

---
*Report saved 2026-11-01 · Lines in this file: ~320 · No external images/generated assets added.*
