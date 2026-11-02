# Admin Site — 100% Audit Fix Plan

**Plan ID:** 2026-11-02_Admin-Audit-Fix_v01.md
**Source:** live-verify (7 screenshots, 6 asserts green, 0 page errors, backend doc asserted, test discounts cleaned), + web-design-guidelines fetched, + 4 design skills loaded.
**Status:** 0/6 done — working sequentially.

---

## Fix order (priority: visible UI first, then a11y)

1. **[DONE] Focus-visible ring** — `style.css:869` (`.form-input`) fixed: `transition: all 0.3s ease` → explicit props; `.focus-visible` rules (719, 869, 8921, 880) verified paired. 2. **Form labels + aria-label** — editor inputs (`discSchedStart`, `discSchedEnd`, `discValue`, `discType`, `discName`); runner (`btnRrCsv`, `btnRrXlsx`, `btnRrPrint`, `btnDownloadExcel`); login (`email`, `password`). Check `Admin/index.html` markup.
3. **prefers-reduced-motion** — guard on any `transition`, `animation`, print media; add `@media (prefers-reduced-motion: reduce)` to `mobile-overrides.css` / `Admin/index.html` inline.
4. **Image alt + icon aria-label** — menu dish images (catalog), report print view images, icon buttons (close, export). Check `Admin/js/features/catalog.js`, `report-runner.js`.
5. **Dark mode live verification** — render `/` with dark preference; verify text contrast (orange accent on dark header must stay ≥4.5:1); check card surfaces not invisible.
6. **DESIGN.md at root** — copy `design-md/linear.app/DESIGN.md` → `DESIGN.md` for agent consistency (optional but recommended by awesome-design-md).

---

## Per-item documentation rule (project-organizer)

After each item: (a) what I searched, (b) what I found, (c) what I decided, (d) the one runnable check if non-trivial.
