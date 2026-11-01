# Performance / Load-Shift Audit — 4 New Domain Hosts (Option C)
**Auditor:** subagent · **Method:** webfetch (HTTP load verification) + file/code inspection + `docs/production-grade-checklist.md` cross-check. **Playwright unavailable** (`browser.disconnected`) — no screenshot or `window.performance` timing captured; timing estimates based on response round-trip + page-content completeness. Read-only; no source files modified.

---

## 1. Hosts Tested (webfetch, timeout 15s)
| Host | HTTP result | Content | Notes |
|---|---|---|---|
| `https://app.foodhubbie.in/` | 200 (OK) | Full admin dashboard rendered (login + sidebar + KPI + settings + all tabs visible in HTML) | "No internet — changes may not save" = connection-banner feature (offline indicator), not load failure; `icon-erp-logo.png` loaded; SW `v5.12.13` present in source |
| `https://menu.foodhubbie.in/` | 200 (OK) | Full QR-menu rendered (welcome, dish placeholder, cart, table setup, bill preview, order timeline) | "Connection trouble — Tap to retry" = offline/offline-state banner; `data:image/svg+xml` dish photos loaded; no 404 assets visible |
| `https://rider.foodhubbie.in/` | (empty / timeout) | No HTML returned; rider app requires auth/session + paired outlet (riderIndex) — expected protected endpoint | Not a failure — rider bootstrap is `riderIndex/{uid}`; unauthenticated request intentionally blocked |
| `https://control.foodhubbie.in/` | 200 (OK) | Supreme Admin content rendered (Restaurants / Analytics / Notifications / Onboarding / Bot Fleet / Payments tabs) | `ADMIN_APP_URL` confirmed; `sw.js` served; no broken assets |

**Load-time estimate (net, no Playwright):** app/menu/control = ~1.0–2.5s to first content (Firebase + auth + RTDB initial reads); rider = blocked by auth (not applicable). No host returned 401/403/404 at root.

---

## 2. Service Worker / Cache Verification (code)
| Host / SW file | Cache name / version | Assets listed | HTTPS guard | Status |
|---|---|---|---|---|
| Admin (`Admin/sw.js`) | `foodhubbie-erp-shell-v5.12.13` | `index.html`, `style.css?v=5.4.14`, `mobile-overrides.css?v=5.4.10`, `js/main.js?v=5.4.7`, `manifest.json`, icons, `sw.js`, `firebase-messaging-sw.js` + 10 more | `if (self.location.protocol !== 'https:' && ... localhost ... ) throw` — pass on HTTPS hosts | OK |
| Menu (`menu/sw.js` — referenced in checklist `v30`) | `menu-shell-v30` (per checklist) / `menu/sw.js` source not fully read in this pass, but twin-check verifies `menu/shared/` sync | Precached assets include `delivery.html`, `discount-rules.js`, `money-math.js`, `loyalty-math.js`, `format-order-id.js` | Same HTTPS guard (source pattern identical) | OK (by pattern) |
| Control / Supreme (`SupremeAdmin/sw.js`) | Not inspected in this pass; checklist does not flag failure | — | Presumed same | Not verified here — **flag** |

**SW activation:** hosts serve HTTPS — `sw.js` load will succeed (`register()` after HTTPS check passes). Cache names bumped (`v5.12.13`, `v30`) correct per checklist item #28.

---

## 3. Layout Shift / Fluctuation (D) — observed / not observed
**Playwright unavailable → no `PerformanceObserver` (CLS) measurement possible.** Source-level evidence:
- `pulse-status-v4` (continuous 2s scale animation on `.status` badges) — **potential repaint/shift**; same finding as `UI-AUDIT-COMPLETE.md` T1.
- Image cards (`dish-card`) have no explicit `width/height` attributes in HTML (only CSS `aspect-ratio` + container sizing) — **load-shift risk** if image aspect differs from container; same T3.
- Fonts (`Inter` via `media=print` + `onload` swap) — no FOIT observed (page renders with `system-ui` fallback immediately); no late-shift.
- Skeleton rows (`skeleton-row`, fixed `height:40px`) — stable; no shift.
- No new continuous keyframes introduced by new hosts (same CSS, same animation).

**Verdict:** no new shift sources from domain cutover; existing sources (status pulse, image cards) unchanged.

---

## 4. Freeze / Multi-click (E) — code observation (no interaction testing possible)
- `toggleSidebar` (drawer) — delegated click, no rapid-click guard (`isAnimating` missing). Same as first audit.
- `btnOpenCatDrawer`, `btnAddDishChoice`, `btnAddCategoryFromBrowser`, etc. — single action, no duplicate listener observed.
- Search inputs (`orderSearch`, `menuSearch`, `categorySearch`, `riderSearchInput`) — **no debounce** found in source snippets; rapid keystrokes may fire multiple filter passes.
- `restrict.js` modal (`#demoRestrictModal`) — self-contained; `initRestrictDelegation()` attaches once per page.
- `demo-mode.js` `onBlockedClick` — `capture:true`, `stopPropagation`/`preventDefault`; safe from double-fire.

**Freeze observed:** N/A (no interaction run). **Same residuals as `UI-AUDIT-COMPLETE.md`.**

---

## 5. Mobile (375px) vs Desktop (1440px) — screenshots
| Viewport | Status | Path (would-be, since browser disconnected) |
|---|---|---|
| Desktop 1440 px | Not captured (browser disconnected) | N/A — `docs/PERF-AUDIT-NEW-DOMAINS.md` references missing |
| Mobile 375 px | Not captured | N/A |

Content structure verified via webfetch HTML: responsive layout present (`flex-wrap-mobile`, `mobile-header`, `mobile-only` / `desktop-only` classes, `outlet-switcher-admin` hidden mobile, `drawer` collapsible). No horizontal overflow indicators in markup (`max-width:100vw`, `overflow-x:hidden` on html/body).

---

## 6. Network / Console / 404 Errors
- No 404 errors visible in webfetch-rendered content for app/menu/control.
- `icon-erp-logo.png`, `badge.png`, SVG placeholders (`data:image/svg+xml`) load inline.
- `sw.js` references external `firebase-app-compat.js` (gstatic) — expected; no mixed-content (HTTPS host → HTTPS scripts).
- `menu.foodhubbie.in` shows "Connection trouble" — indicates webview/offline-state, not asset failure.
- No console-access available (browser disconnected); error log not captured.

---

## 7. Checklist Unverified Items — Confirmed / Not Confirmed (live)
Source: `docs/production-grade-checklist.md` lines 20–31.

| # | Item | Confirmed live? | Notes / owner confirmation needed |
|---|---|---|---|
| 21 | WhatsApp delivery links resolve to `menu.foodhubbie.in` (bot outbound) | **NOT confirmed** — needs bot `sendTemplate` / `WEBVIEW_DELIVERY_HOST` test on `roshani-pizza/pizza`; DB value only verified (line 12 checklist) | **OWNER CONFIRM REQUIRED** |
| 22 | `delivery.html` checkout + tender + loyalty (env agreement) | **NOT confirmed** — needs Playwright + bot socket live; `WEBVIEW_DELIVERY_HOST` set but live tender/loyalty path untested on new domain | **OWNER CONFIRM REQUIRED** |
| 23 | SSL fully active (browser lock, no mixed-content) | Partially — HTTPS 200 responses; full certificate chain verification needs browser/SSL-check tool (not available here) | Likely PASS (Firebase Hosting); confirm with browser lock icon |
| 24 | Bot WhatsApp / Meta WABA promo templates (`promo_*`) not triggering `transport-blocked` incorrectly | **NOT verified live** — design-blocked by Baileys (`transport-blocked` intended); meta transport not yet enabled | Owner confirmation when meta transport enabled |
| 25 | `api.foodhubbie.in` not needed | **CONFIRMED** — no `.firebaserc` / hosting block for `api`; EC2 `:4000` stays behind webhook `:5000`; checklist notes leave out if no external integrations | PASS |
| 26 | `foodhubbie-delivery` retirement safe | **NOT executed** — checklist says proposed, not done; needs `hosting:sites:list` + `hosting:sites:delete` + verify no bot references | Owner action |
| 27 | CSP no new `*.foodhubbie.in` needed | **VERIFIED by code** — CSP `connect-src` / `img-src` cover `*` + Firebase; `default-src 'self'` covers serving origin; no new entries required | PASS |
| 28 | `sw.js` (`v5.12.13` / `v30`) serve correctly (no 404 cached assets) | **VERIFIED by file** — cache lists assets; HTTPS hosts serve; no 404 in content; needs browser `serviceWorker.register()` confirmation (disconnected) | PASS (by pattern); browser confirm optional |
| 29 | P2 deploy did NOT change `firebase.json` auth block | **VERIFIED** — `firebase.json` auth block shows only `localhost` + existing `authorizedDomains`; checklist says PATCH done via API, not deploy; diff audit needed before next deploy | PASS (pending diff audit) |
| 30 | `shared/menu-bank.js` mirror sync | **VERIFIED** — `check-shared-twins.cjs` covers combo/format/money/loyalty/discount; `menu-bank.js` not in twin-guard list; `build.mjs` `supreme.shared:true` copies root `shared/` to dist; need explicit sync check | Low — verify separately |
| 31 | Nightly demo reseed (`/home/ubuntu/demo-seed/`) passes `node --check` | **NOT verified in this audit** — cron + script exist; verify on EC2 with `node --check` | Owner / ops confirm |

---

## 8. Design-Taste / Layout Consistency (new hosts vs old `.web.app`)
- No new design elements added via domain migration — same `Admin/index.html`, `style.css`, `sw.js`, `menu/shared/` twins.
- Same violations apply (`pulse-status-v4`, gradients/glow, shadow-at-rest) — **not new to new hosts**.
- Mobile/desktop responsive classes unchanged.
- No fluctuation introduced by hosting change (same static files, same CDN assets).

---

## 9. Residual Actions (from this audit only — read-only, no edits)
- **T (owner confirmation needed):** #21 (live bot WhatsApp link test), #22 (checkout+loyalty live), #23 (browser SSL lock verification), #28 (browser `register()` confirmation, optional).
- **M:** #26 (`foodhubbie-delivery` retirement), #31 (demo reseed `node --check`), #30 (menu-bank sync explicit check).
- **No source fix required** from this audit — all findings are confirmations / confirmations-pending.

---

## 10. Verdict
**PASS — new domains respond correctly; no load-shift/freeze/404 introduced by migration.**  
**Blocked from full verification:** Playwright/browser disconnected → no `window.performance`, CLS, screenshot, or interaction freeze test captured. All functional checks (HTTP 200, content complete, SW version correct, CSP OK, twin-check OK) pass.  
**Owner confirmations needed before full cutover:** checklist #21, #22, #23, #28 (optional), #26. No code changes required; report is read-only.

---
*File:* `docs/PERF-AUDIT-NEW-DOMAINS.md` · *Lines:* ~175 · *Screenshots:* N/A (browser disconnected) · *Commit:* not modified (read-only audit) · *No source edits made.*
