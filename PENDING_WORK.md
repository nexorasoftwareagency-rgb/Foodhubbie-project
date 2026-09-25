# PENDING WORK — Comprehensive Issue Registry

## Legend
- **P0** = Critical (data loss, security, production crash)
- **P1** = High (incorrect behavior, UX break, dead code shipped)
- **P2** = Medium (code quality, maintainability, technical debt)
- **P3** = Low (polish, nice-to-have, future-proofing)

---

## ✅ COMPLETED (Reference — from 10-Agent Audit)

| ID | Title | Status |
|----|-------|--------|
| P1-1 | Category Discounts on Table Bills | DONE |
| P1-2 | Atomic Payment (multi-path update) | DONE |
| P1-3 | Manual Discount Audit Trail | DONE |
| P1-4 | Channel Separation (table vs pos) | DONE |
| P1-5 | Analytics Backfill Script | DONE |
| P1-6 | Offline Payment Guard | DONE |
| P1-7 | Void/Refund Flow | DONE |
| P2-1 | Walkout Audit Trail | DONE |

---

## 🔴 P0 — CRITICAL (Must Fix Before Next Deploy) — **ALL FIXED & DEPLOYED**

### P0-1: Dead Code Shipped — `showSplitPaymentPicker` exported but unused — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Dead utility function exported in production bundle |
| **Place** | `Admin/js/ui-utils.js:221-260` |
| **Issue** | `export const showSplitPaymentPicker = (total) => { ... }` — 108 lines of code, never imported anywhere |
| **Reason** | Replaced by inline smart split logic in `tables.js` (`_collectPaymentEntries`, `toggleBillSplit`, `adjustBillSplit`, `onBillSplitInput`). Old import removed from tables.js but export left behind |
| **Impact** | Bundle bloat (~2KB gzipped), confusion for future maintainers, dead code in production |
| **Fix Applied** | Deleted entire `showSplitPaymentPicker` function from `ui-utils.js` (lines 221-328) |
| **Verified** | Build passes, deploy successful, no runtime errors |

### P0-2: Dead Import — `showPaymentPicker` imported but never used in tables.js — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Unused import increases bundle size and creates false dependency |
| **Place** | `Admin/js/features/tables.js:32` |
| **Issue** | `import { ..., showPaymentPicker } from '../ui-utils.js';` — imported but never referenced in file |
| **Reason** | Old payment flow used `showPaymentPicker` for "Proceed to Payment" button. New flow uses inline Cash/UPI buttons in modal. Import not cleaned up during refactor |
| **Impact** | Bundle bloat, false dependency graph, ESLint warning (if enabled) |
| **Fix Applied** | Removed `showPaymentPicker` from import statement (line 32) |
| **Verified** | Build passes, deploy successful, no runtime errors |

### P0-3: Dead Exports on `window.__tables` — 7 unused public APIs — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Public API surface polluted with dead functions |
| **Place** | `Admin/js/features/tables.js:2601-2627` |
| **Issue** | Exported but never called via action dispatcher: `closeEditor`, `save`, `closeQr`, `bulkPrint`, `exportCsv`, `setTableBillDiscount`, `setTableBillDiscountPct` |
| **Reason** | Legacy exports from old table editor / QR modal / discount inline handlers. New flow uses inline event listeners in `openTableBillReview` or direct module calls |
| **Impact** | API surface confusion, potential accidental calls, bundle bloat |
| **Fix Applied** | Removed 7 dead exports from `window.__tables` object |
| **Verified** | Build passes, all action dispatcher calls still work |

### P0-4: Record Walkout Writes to Root Path — **✅ FIXED & RETESTED (200 OK)**
| Field | Detail |
|-------|--------|
| **Problem** | Walkouts written to root `/logs/walkouts` (no write rule) instead of outlet-scoped path — PERMISSION_DENIED, no audit trail |
| **Place** | `Admin/js/features/tables.js` `recordWalkout` / `checkAndRecordWalkout` |
| **Root Cause** | `Outlet.ref('')` returns ROOT ref; `logs` is in `Outlet.globalPaths` so writes went to `/logs/walkouts` |
| **Impact** | **Data loss** — walkouts silently failed to record |
| **Fix Applied** | Switched to `Outlet.multiUpdate(updates)` with outlet-relative keys: `logs/walkouts/{id}`, `tableSessions/{sid}/walkout`, `orders/{id}/status` |
| **Verified** | `tests/walkout-retest.spec.js` — REST PUT with admin ID token → 200 OK, read-back verified, cleanup done. E2E 11/11 pass |

### P0-5: Bot Dine-in "No valid phone" Spam — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Every dine-in QR order logged `⚠️ No valid phone` + wrote `bot/logs/{id}` — intentional (PII in `tableSessionsContact`) but spammed logs |
| **Place** | `bot/index.js` ~995-1004 (`if (!jid)` block) |
| **Fix Applied** | Silent skip for `/dine\|walk/i` types; non-dine-in still warns + writes bot/logs |
| **Deployed** | scp → `/var/www/foodhubbie/bot/` (NOT `/home/ubuntu/`), `pm2 restart bot-roshani-pizza-pizza`, MD5 verified |
| **Verified** | `node --check` pass; live bot MD5 matches local |

### P0-6: QR Coupon Discount Mismatch (claimed vs applied) — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Bot re-verify claimed ₹0 / wrong amount on webview delivery coupons — channel gate missing, `discountSource` empty, cart object vs array |
| **Place** | `menu/js/discount.js` `validateCoupon`; `menu/js/order.js` discountSource; `bot/index.js` verifyQrOrderDiscount; `bot/discount-engine.js` |
| **Fix Applied** | (1) validateCoupon: skip non-`website`/`all` channels + return `source:'coupon:CODE'`; (2) order.js: fallback `discountSource` from couponCode; (3) bot: normalize items object→array; (4) engine: `both` includes `table`, `_cartHasCategory` handles object cart |
| **Deployed** | `node tools/build.mjs` + `firebase deploy --only database,hosting:*`; bot scp + restart |
| **Verified** | `node --check` all; E2E 11/11 |
| **Known Gap** | Category discounts on QR need `categoryId` on cart lines (deferred) |

---

## 🟠 P1 — HIGH (Incorrect Behavior / UX Break)

### P1-8: No "View Bill" Access When Session Is In `billing` State — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Once table enters `billing` state, drawer only shows "Close Table (Paid)" — no way to re-open bill review modal |
| **Place** | `Admin/js/features/tables.js:670-676` (drawer button rendering) |
| **Issue** | Button logic: `sess.status !== 'billing'` → shows "Generate Bill" + "Make Payment"; `sess.status === 'billing'` → shows only "Close Table (Paid)" + "Void Payment" |
| **Reason** | Original flow: "Generate Bill" → sets status to billing → "Make Payment" opens modal. But if user dismisses modal or refreshes, no way to get back |
| **Impact** | **UX break** — staff cannot review/adjust bill after generating it; must "Void Payment" then "Generate Bill" again (2 extra clicks, confusing) |
| **Fix Applied** | Added "View Bill" button in billing state (single-bill mode) that calls `makePaymentForTable` → opens bill review modal. Also updated multi-bill group billing label from "Mark Paid" to "View Bill [Group]" for clarity. |
| **Files Changed** | `Admin/js/features/tables.js` lines 670-676 and 654 |
| **Verified** | Build passes, deploy successful |

### P1-9: Card Payment Removed from Table Bills but Still Allowed in Orders — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Inconsistent payment methods across order types |
| **Place** | `Admin/index.html:5520-5521` (Cash/UPI only) vs `Admin/js/ui-utils.js:186-220` (`showPaymentPicker` includes Card) |
| **Issue** | Table bill modal: Cash + UPI buttons only. Orders tab: `showPaymentPicker` still offers Cash/UPI/Card |
| **Reason** | Product decision to remove Card from table bills (no terminal), but orders.js wasn't updated |
| **Impact** | **Inconsistent UX** — staff sees Card option for online orders but not dine-in; potential confusion |
| **Fix Applied** | Removed Card button from `showPaymentPicker` in `ui-utils.js` (line 198). Now both table bills and orders tab use Cash/UPI only. |
| **Files Changed** | `Admin/js/ui-utils.js` |
| **Verified** | Build passes, deploy successful |

### P1-10: Inline Event Listener Re-wiring on Every Modal Open — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Event listeners attached repeatedly (guarded by `dataset.wired` but logic still runs) |
| **Place** | `Admin/js/features/tables.js:1015-1077` (inside `openTableBillReview`) |
| **Issue** | Payment method buttons, split toggle, +/- buttons, click-outside, discount inputs — all wired inside modal open function |
| **Reason** | Modal HTML exists in DOM from start; wiring deferred to first open. But logic executes on every `openTableBillReview` call |
| **Impact** | Minor performance hit, harder to debug, potential double-fire if guard fails |
| **Fix Applied** | Moved all bill review modal wiring to `_wireBillReviewModal()` function called once at `loadTableManagement` init. Removed ~80 lines of wiring from `openTableBillReview`. Now only resets state and renders. |
| **Files Changed** | `Admin/js/features/tables.js` — new `_wireBillReviewModal()` function, simplified `openTableBillReview` |
| **Verified** | Build passes, deploy successful |

### P1-11: Duplicate `loadLucide` Call in `_renderTableDrawer` — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Lucide icons initialized twice per render cycle |
| **Place** | `Admin/js/features/tables.js:693-694` vs `_renderAll` at line 710 |
| **Issue** | `_renderTableDrawer` calls `await loadLucide(); window.lucide.createIcons({ root: drawer });` while `_renderAll` also calls consolidated `loadLucide()` + `createIcons()` |
| **Reason** | Consolidation in `_renderAll` (rAF debounce) added but drawer-specific call not removed |
| **Impact** | Double DOM traversal for icons, potential flicker, wasted CPU |
| **Fix Applied** | Removed `await loadLucide(); if (window.lucide) window.lucide.createIcons({ root: drawer });` from `_renderTableDrawer` |
| **Verified** | Build passes, icons still render correctly via `_renderAll` consolidation |

### P1-12: Wrong CSS Class Name — `walkin-offers-panel` Used for Table Bills — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | POS-specific class name reused for table bill offers panel |
| **Place** | `Admin/index.html:5555` (`<div id="tableBillOffersPanel" class="walkin-offers-panel hidden">`) |
| **Issue** | Class `walkin-offers-panel` implies walk-in POS context, but used for table bill modal |
| **Reason** | Copy-paste from POS offers panel during refactor; not renamed |
| **Impact** | CSS confusion, potential style collisions, misleading for maintainers |
| **Fix Applied** | Changed HTML class to `bill-offers-panel`; added `.bill-offers-panel` selector alongside `.walkin-offers-panel` in `style.css:8163` |
| **Verified** | DOM shows `class="bill-offers-panel hidden"`; styles apply correctly |

### P1-13: Inconsistent Naming — `setBillDiscount` vs `setTableBillDiscount` — **✅ FIXED (in P0-3)**
| Field | Detail |
|-------|--------|
| **Problem** | Two naming conventions for same domain (table bill discounts) |
| **Place** | `tables.js:1273` (`setTableBillDiscount`) vs `tables.js:2624` (`setBillDiscount` in window.__tables) |
| **Issue** | Internal function: `setTableBillDiscount`; exported alias: `setBillDiscount` |
| **Reason** | Export alias shortened for brevity but breaks consistency |
| **Impact** | Cognitive load, grep fails, potential bugs if new code uses wrong name |
| **Fix Applied** | Removed dead aliases `setBillDiscount` / `setBillDiscountPct` from `window.__tables` in P0-3. Codebase now consistently uses `setTableBillDiscount` / `setTableBillDiscountPct` everywhere. |
| **Verified** | Grep shows zero references to old names; all internal calls use consistent naming |

---

## 🟡 P2 — MEDIUM (Code Quality / Technical Debt)

### P2-2: Modal Event Wiring Should Be at Init, Not Modal Open
| Field | Detail |
|-------|--------|
| **Problem** | Event wiring logic lives in `openTableBillReview` instead of module initialization |
| **Place** | `Admin/js/features/tables.js:1017-1077` |
| **Issue** | 60 lines of `addEventListener` setup inside async function that runs on every bill review |
| **Reason** | Modal HTML exists in DOM at page load; wiring deferred to avoid race with DOMContentLoaded. But proper fix is `loadTableManagement` → wire once |
| **Impact** | Harder to test, violates separation of concerns, runs unnecessary logic |

### P2-3: `_renderAll` rAF Debounce + Individual Render Calls Race — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | `_renderAll` debounced but individual renders (`_renderTableDrawer`) called directly, bypassing debounce |
| **Place** | `Admin/js/features/tables.js:691-706` (_renderAll), lines 763, 782, 787 (direct calls) |
| **Issue** | Firebase listeners → `_renderAll()` (rAF debounced). User clicks → `_renderTableDrawer()` (immediate). Both execute in same frame = double render, potential flicker |
| **Reason** | Refactor added debounce to `_renderAll` but didn't make individual renders go through same pipeline |
| **Impact** | Potential double-render, wasted CPU, visual flicker when user interacts during listener updates |
| **Fix Applied** | Replaced boolean flag with rAF ID tracking. Added `_flushRenderAll()` that cancels pending rAF and runs all renders immediately. Replaced 3 direct `_renderTableDrawer()` calls with `_flushRenderAll()`. |
| **Files Changed** | `Admin/js/features/tables.js` — new `_flushRenderAll()` function, updated `_renderAll` to use rAF ID, updated `_deleteTable`, `_openTableDrawer`, `_closeTableDrawer` |
| **Verified** | Build passes, deploy successful |

### P2-4: `getCategories()` Import Used Only Once (Line 1423) — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Module import for single use case |
| **Place** | `Admin/js/features/tables.js:37` (import) and line 1423 (usage in `_renderTableBillOffers`) |
| **Issue** | `import { getCategories } from './catalog.js';` used only to resolve category IDs to names for "Requires items from" mismatch message |
| **Reason** | Added for discount evaluation display; `getCategories()` just returns `state.categories` which is already imported via `state` |
| **Impact** | Unnecessary module coupling, slightly larger bundle |
| **Fix Applied** | Removed `getCategories` import; replaced `getCategories().find(...)` with `(state.categories || []).find(...)` |
| **Files Changed** | `Admin/js/features/tables.js` (removed import, inlined usage) |
| **Verified** | Build passes, deploy successful, no external callers of getCategories in tables.js |

### P2-5: Hardcoded Split Default — `_billSplitMethod = 'Cash'` — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Split payment defaults to Cash every modal open, doesn't remember last used |
| **Place** | `Admin/js/features/tables.js:966, 1023, 1161` |
| **Issue** | `_billSplitMethod` reset to `'Cash'` on every `openTableBillReview` and `_renderTableBillReview` |
| **Reason** | Simplicity — no persistence layer for UI preferences |
| **Impact** | Minor UX friction for staff who prefer UPI as primary |
| **Fix Applied** | Added `sessionStorage` persistence: |
| | - `_saveSplitMethod(method)` / `_loadSplitMethod()` helpers |
| | - `_billSplitMethod = _loadSplitMethod()` in `openTableBillReview` |
| | - `_saveSplitMethod(_billSplitMethod)` when payment method clicked |
| | - `_renderTableBillReview` no longer resets to 'Cash' |
| | - Payment method buttons activate based on `_billSplitMethod` |
| **Files Changed** | `Admin/js/features/tables.js` (lines 966, 1023, 1169, 1177, 2502) |
| **Verified** | Build passes, deploy successful |

### P2-6: No Keyboard Support for Split Payment Controls — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | +/- buttons and payment method buttons not keyboard accessible |
| **Place** | `Admin/index.html:5529-5548` (split section) + `5520-5521` (payment methods) |
| **Issue** | Buttons lack `tabindex`, `keydown` handlers for ArrowUp/Down/Enter |
| **Reason** | Mouse-first design; accessibility not prioritized |
| **Impact** | **Accessibility violation** (WCAG 2.1), power users can't use keyboard |
| **Fix Applied** | Added comprehensive keyboard support in `_wireBillReviewModal()`: |
| | - `tabindex="0"` on all interactive elements |
| | - Payment method buttons: ArrowLeft/Right to switch, Enter/Space to select |
| | - Split toggle: Enter/Space to toggle |
| | - Split +/- buttons: ArrowUp/Down for increment/decrement |
| | - Primary amount input: ArrowUp/Down for increment/decrement, Enter to confirm |
| | - Focus trap in modal: Tab cycles within modal, Escape closes modal |
| **Files Changed** | `Admin/js/features/tables.js` — `_wireBillReviewModal()` extended with ~120 lines of keyboard handlers |
| **Verified** | Build passes, deploy successful |

### P2-7: Mobile Modal Untested — **✅ FIXED (CSS Updated)**
| Field | Detail |
|-------|--------|
| **Problem** | Invoice panel item list rendered in tiny area (~35vh) on mobile |
| **Place** | `Admin/style.css:10173-10191` (mobile media query) |
| **Issue** | `.bill-invoice-panel` had `max-height: 35vh` — too small for item list on phones |
| **Reason** | Conservative initial value; didn't account for actual content height needs |
| **Impact** | **Mobile UX broken** — users can't see/read item list on bill payment modal |
| **Fix Applied** | Increased `max-height: 35vh` → `55vh`, added `flex: 1` and `min-height: 200px` for better space allocation |
| **Files Changed** | `Admin/style.css` (lines 10177-10181) |
| **Verified** | Build passes, deploy successful |

### P2-8: Void Bill Discount Analytics Gap (M5) — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | Voiding a table/group bill does not fully reverse bill-level discount in analytics/reports |
| **Place** | `Admin/js/features/tables.js` `voidTableBill` (~1742-1873); `Admin/js/features/discount-evaluator.js` `recordDiscountUsage`; `Admin/js/features/discountsReports.js` |
| **Issue** | (1) Void only calls `recordDiscountUsage(..., isVoid: true)` when `discountId` is set — **manual bill discounts with no `discountId` are never usage-tracked, so void cannot reverse them**. (2) `discountsReports` sums `amountGiven` but renders rows as `-${amountGiven}` — void rows store **negative** `amountGiven`, so UI shows double-negative (`-₹-50`). (3) `tableAnalytics.totalRevenue` is reduced by session `subtotal` on void, not by `subtotal − billDiscount`, so revenue KPI can disagree with paid history. |
| **Reason** | `recordDiscountUsage` requires a discount definition; manual payment-modal bill discount often writes only `sess.discount`/`g.discount` + label without `discountId` |
| **Impact** | Discount reports under-count void reversals for manual bill discounts; void rows display wrong; table revenue KPI may drift from cash collected |
| **Status** | **✅ FIXED (this session)** |
| **Fix Applied** | (a) `_billComputedDiscount` + POS manual now set synthetic `discountId` (`manual:flat`/`manual:percent`) + `discountLabel: 'Manual Discount'` → usage row written on settle, reversed on void. (b) Reports/usage rows render `Math.abs(amountGiven)` with green `void` badge (`+₹X void`) instead of `-₹-50`. (c) `tableAnalytics` void subtracts `paidAmount` (or `subtotal − discount` for legacy closed sessions); group-only sessions skip analytics reverse (group pay never credited it). (d) `recordDiscountUsage` writes both `source` and `discountSource` fields (bot too) so type filters/void badge resolve. (e) KPI redemptions count excludes void rows; savings stay signed (pairs net to 0). |
| **Files Changed** | `Admin/js/features/tables.js`, `discountsReports.js`, `discounts.js`, `discount-evaluator.js`, `pos.js`, `Admin/style.css`, `bot/discount-engine.js` |
| **Verified** | `node --check` clean ×6; build + firebase deploy OK; bot scp MD5 match + pm2 restart; E2E 11/11 |

### P2-9: Coupon Discount Base Amount Inconsistency (M7) — **✅ FIXED (policy locked)**
| Field | Detail |
|-------|--------|
| **Problem** | Coupon % / min-subtotal base is food `subtotal` only across runtimes — may not match billable total or stacking expectations |
| **Place** | `menu/js/discount.js` `validateCoupon`; `Admin/js/features/discount-evaluator.js` `_discountAmount` + `minSubtotal`; `bot/discount-engine.js` same |
| **Issue** | All three already compute `amount = subtotal * value%` and gate `minSubtotal` against **food subtotal** (excl. tax/SC/delivery) with cap `min(total, subtotal)` — but no shared helper, no locked stacking policy, and three near-copies can drift (already drifted on channel gates until P0-6). |
| **Reason** | Editor hint says “% off subtotal”; product never formally locked base = food-only vs pre-tax bill vs post-stack remainder |
| **Impact** | Customer-visible coupon ₹ may differ from staff expectation on bills with heavy tax/SC; stacking two % coupons can over-discount relative to “% off order total” wording; future channel fix may re-split the three engines |
| **Status** | **✅ FIXED (policy locked this session)** |
| **Fix Applied** | **Decision:** base = **food subtotal only** (matches editor `% off subtotal` hint); `minSubtotal` gates against food subtotal; grand total capped at `Math.min(total, subtotal)`; **stacking uses full food subtotal per discount** (not remainder). Cross-linked comments at all three formula sites (`// P2-9 policy (locked)… keep in sync`). `discountAmount` exported from `bot/discount-engine.js`. Editor hint already reads `% off subtotal` / `₹ off subtotal`. No cross-runtime module extracted (menu hosting cannot reach `repo-root/shared/`; CJS bot vs ESM menu). |
| **Files Changed** | `menu/js/discount.js`, `Admin/js/features/discount-evaluator.js`, `bot/discount-engine.js`, `bot/tests/unit.test.js` |
| **Verified** | `node --check` ×3 clean; `node --test bot/tests/unit.test.js` **12/12** including `discountAmount: food-subtotal base, maxCap, stacking cap` |

---

## 🟢 P3 — LOW (Polish / Future-Proofing)

### P3-1: FCM Token Refresh — **✅ FIXED (Race Condition Resolved)**
| Field | Detail |
|-------|--------|
| **Problem** | FCM re-registration on Service Worker activation untested |
| **Place** | `Admin/js/fcm-init.js:47-59` |
| **Issue** | `controllerchange` listener only logged, never called `refreshFCMToken` — token only refreshed on next admin login click |
| **Reason** | Missing token refresh logic in `controllerchange` handler; `auth.currentUser` could be null during SW activation before auth state restored |
| **Impact** | Silent push notification failures after SW update until next login |
| **Fix Applied** | Added `getAuthReady()` promise that waits for `onAuthStateChanged`, then calls `refreshFCMToken(user.uid)` in `controllerchange` handler |
| **Files Changed** | `Admin/js/fcm-init.js` (added `getAuthReady()`, updated `controllerchange` handler) |
| **Verified** | Build passes, deploy successful |

### P3-2: Sharp JPEG→PNG Conversion — Code Exists, **NEEDS EC2 VERIFICATION**
| Field | Detail |
|-------|--------|
| **Problem** | Image conversion fix in bot codepath untested with real notification |
| **Place** | `bot/index.js:587-623` |
| **Issue** | Code converts JPEG to PNG for WhatsApp media messages; no end-to-end test |
| **Reason** | Requires real WhatsApp message send from running bot on EC2 |
| **Impact** | Potential broken images in customer notifications |
| **Fix Applied** | Code already in place (lines 587-623): converts JPEG→PNG for Baileys thumbnail |
| **Verification Needed** | Run on EC2, trigger image send via WhatsApp, check logs for conversion messages |
| **Files** | `bot/index.js` (lines 587-623) |
| **Next Step** | SSH to EC2, trigger image send via WhatsApp, verify logs |

### P3-3: Session Expiry Walkout Auto-Detection — **✅ FIXED**
| Field | Detail |
|-------|--------|
| **Problem** | `checkAndRecordWalkout` integrated in `_policeExpiredSessions` but never triggered in real scenario |
| **Place** | `Admin/js/features/tables.js:436-481` (`_policeExpiredSessions`) |
| **Issue** | Auto-detects walkouts when session expires with unpaid served orders; needs real expired session |
| **Reason** | Logic existed (`checkAndRecordWalkout` function) but was never called from `_policeExpiredSessions` |
| **Impact** | Walkouts not auto-recorded; manual "Record Walkout" button works but auto-detection missing |
| **Fix Applied** | Added `checkAndRecordWalkout(linkedTable.id, id)` call in `_policeExpiredSessions` after freeing table (line ~480) |
| **Files Changed** | `Admin/js/features/tables.js` (line ~480) |
| **Verified** | Build passes, deploy successful |

### P3-4: CI/CD Pipeline — **✅ WORKFLOW CREATED**
| Field | Detail |
|-------|--------|
| **Problem** | No automated build/test/deploy pipeline |
| **Place** | `.github/workflows/ci-cd.yml` |
| **Issue** | Deploy requires manual: `node tools/build.mjs` → `cmd /c npx firebase deploy` |
| **Reason** | Never prioritized; small team, manual deploys "work" |
| **Impact** | Human error risk, no regression testing, no preview deployments |
| **Fix Applied** | Created GitHub Actions workflow with: |
| | - `lint` job: build verification, console.error check |
| | - `test` job: Playwright tests (needs secrets) |
| | - `deploy-preview`: PR → 7-day Firebase preview channel |
| | - `deploy-production`: main branch → production deploy + database rules |
| | - `bot-docker`: Docker image build for bot |
| **Files Created** | `.github/workflows/ci-cd.yml`, `SECRETS.md`, updated `package.json` |
| **Verified** | Build passes locally, workflow syntax valid |
| **Next Step** | Add secrets in GitHub: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_TOKEN` |

### P3-5: No Automated E2E Test Suite — **✅ FRAMEWORK CREATED**
| Field | Detail |
|-------|--------|
| **Problem** | Playwright used ad-hoc; no reusable test suite |
| **Place** | No `tests/`, `e2e/`, or `playwright.config.js` in repo |
| **Issue** | Critical flows (QR order → kitchen → serve → bill → payment) tested manually each release |
| **Reason** | Time constraints; Playwright MCP used for debugging not test authoring |
| **Impact** | Regression risk on every deploy; no confidence in refactors |
| **Fix Applied** | Created complete Playwright E2E test infrastructure: |
| | - `playwright.config.js` - config with desktop + mobile projects |
| | - `tests/global-setup.js` / `global-teardown.js` - env prep/cleanup |
| | - `tests/utils.js` - reusable helpers (login, navigation, KDS, payment) |
| | - `tests/critical-flows.spec.js` - 20 tests covering: |
| |   • QR Menu → Order → Cart → Place Order |
| |   • Admin: KDS Accept → Ready → Serve |
| |   • Admin: Bill Generate → Payment Modal → Confirm |
| |   • Admin Dashboard: Tables/Orders/KDS tabs load |
| | - `package.json` - test scripts (`npm test`, `npm run test:headed`) |
| **Files Created** | `playwright.config.js`, `tests/` (5 files), `package.json` |
| **Verified** | Playwright installed, test framework runs, 4 admin dashboard tests pass |
| **Known Issues** | QR menu test selectors need tuning; test isolation (orderId sharing) needs fixtures |

### P3-6: `database.rules.json` — `logs` Read Rule May Be Too Permissive — **✅ VERIFIED NO PII LEAK**
| Field | Detail |
|-------|--------|
| **Problem** | Walkout logs readable by any admin of the outlet |
| **Place** | `database.rules.json:153` (`.read` same as `.write`) |
| **Issue** | Walkout logs contain PII (customer phone from session contact path) — should be restricted to Super/Outlet Admin only |
| **Reason** | Copied inventory/orders rule pattern without considering PII sensitivity |
| **Impact** | **Privacy risk** — outlet admins can see walkout customer details |
| **Finding** | **No PII in walkout logs** — `recordWalkout` maps orders to `{ id, total, status }` only, no `customerPhone`. Rules already correctly restrict to outlet admin + super/supreme. |
| **Status** | **✅ VERIFIED — No Fix Needed** |

### P3-7: Stale comment at `bot/index.js:1599` names a relabeled discount option — **⏳ PENDING**
| Field | Detail |
|-------|--------|
| **Priority** | P3 — Low (comment only; zero behavior) |
| **Problem** | Comment still quotes the discount channel option by its OLD label |
| **Place** | `bot/index.js:1599` |
| **Issue** | `// channel: 'website' — matches the "Website/App only" option` — task `20260925-151619-0a72` relabeled that option to **"QR / WhatsApp Webview only"** in `Admin/index.html` `#discChannel`. The value `website` is unchanged, so the comment's substance still holds (use `website`; `whatsapp`/`pos` correctly do not apply) — only the quoted label is now wrong. |
| **Why deferred** | `bot/index.js` carries ~800 lines of another workstream's in-flight WIP (83 insertions, 717 deletions). Line 1599 sits in a clean block (their hunks jump 1139 → 1646), but touching the file risked sweeping their work into the commit. |
| **Fix Required** | Update the quoted label. Stage with a filtered `git apply --cached` patch keeping only that hunk — same technique used for `Admin/index.html` in `20260925-151619-0a72`. **Re-check hunk offsets first** — their edits are still moving. |
| **Files** | `bot/index.js` (one line) |
| **Verified** | n/a — comment-only change, `node --check` + `grep` suffice |

---

## 📊 SUMMARY MATRIX

| Priority | Count | Must-Fix Before Deploy |
|----------|-------|------------------------|
| **P0** | 6 | ✅ YES (all 6 — P0-4/5/6 fixed this session) |
| **P1** | 6 | ✅ YES (all 6) |
| **P2** | 9 | ⚠️ Recommended (9/9 done) |
| **P3** | 7 | 📋 Backlog (5/7 done) |

**Total Active Issues: 14** (0 P0 + 0 P1 + 0 P2 open + 2 P3 remaining)

---

## 🎯 RECOMMENDED FIX ORDER (Next Session)

```bash
# 1. P3-2: Verify Sharp conversion with real WhatsApp message
# (P2-8 M5 + P2-9 M7 done this session — all P0/P1/P2 closed)
```
```

---

## 📝 NOTES FOR NEXT AGENT

- **Build before test**: Always run `node tools/build.mjs` then `cmd /c "npx firebase deploy --only hosting:admin"` — dist must match source
- **Service Worker**: Clear caches + unregister SW in Playwright before testing (`navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()))`)
- **Table 02**: Currently FREE (was billing, paid via test). Use fresh table for next E2E.
- **Auth**: `roshanipizza@gmail.com` / `Ns@9724649971` for admin login
- **QR Menu**: `https://foodhubbie-qrmenu.web.app/?o=pizza&b=roshani-pizza&t=2135N2D5F5E3H6J4` (Table 02)
- **M5 = P2-8** (void billDiscount analytics — FIXED); **M7 = P2-9** (coupon base — FIXED, food-subtotal policy locked). Bot deploy path is `/var/www/foodhubbie/bot/` (PM2 script path) — not `/home/ubuntu/`.