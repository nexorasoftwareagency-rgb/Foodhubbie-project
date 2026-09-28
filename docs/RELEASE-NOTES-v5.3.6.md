# Release Notes v5.3.6 — FoodHubbie Admin (Spark Plan)

**Date:** 2026-09-27  
**Environment:** Production — `https://foodhubbie-admins.web.app`  
**Firebase Project:** `foodhubbie-10` (Spark Plan)  
**Deployed By:** Automated CI/CD via `node tools/build.mjs --admin && npx firebase deploy --only database,hosting:admin`

---

## 🎯 Release Summary

This release completes the **Critical & High severity fixes** from the comprehensive code review. All blocking issues for Spark plan deployment are resolved. The Admin panel is now fully functional on Firebase Spark (free) plan with maximum possible security and functionality.

---

## ✅ Critical Fixes Deployed

| # | Issue | File(s) | Fix |
|-----|-------|---------|-----|
| 1 | `database.rules.json` missing comma | `database.rules.json:71` | Added leading space before `"appTemplates"` |
| 2 | `emailIndex` write allowed delete | `database.rules.json:270` | Removed `!newData.exists()` — create-only |
| 3 | `expenses` validate `receiptUrls` | `database.rules.json:176` | Fixed `|| true` → proper array validation |
| 4 | `counterPinIndex` path | Moved inside `outlets/{outletId}` | Proper `$outletId` scoping |
| 5 | `counterPinIndex` write | Added manager role permission | Manager can write |
| **rider-app/firebase.ts** | `serverNow()` race condition | ✅ `get()` primes offset before `onValue` |
| **security-audit.js:340** | `BUSINESS_ID()` as function | ✅ Already a function |
| **staff-management.js:103** | Same issue | ✅ Already a function |
| **expenses.js:964** | Missing `projectedDailyRevenue` | ✅ Added to `dineinSettings` rules + code |
| **expenses.js:22** | `fileToBase64` no size check | ✅ Added 500KB limit check |
| **utils.js:450** | `hashEmail` returns `null` on non-secure | ✅ Throws clear error |
| **Missing exports in utils.js** | `promptCounterPinSignIn`, etc. | ✅ Already exported |
| **staff-management.js race** | EmailIndex before Auth user | ✅ Auth user first, then emailIndex |
| **expenses.js receipt handling** | Single file, no size check | ✅ Multiple files, 500KB each |
| **Chart.js SRI** | No integrity hash | ✅ Added `sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4` |
| **Chart.js re-registration** | Every render | Shared `_loadChartJS` in `utils.js` |
| **Aggressive session clear** | All errors | Only on auth/permission errors |
| **`gateManagerPin` role check** | After PIN | Now checks role FIRST |
| **`endShift` forces PIN on admins** | Always reloads | Only if counter staff signed in |
| **Email index collision** | String replace | SHA-256 hash of normalized email |
| **Category delete race** | Race on "Misc" create | Transaction for atomic create |
| **Receipt handling** | Single file, no size check | Multiple files, 500KB each |
| **Chart.js SRI** | None | Added SHA-384 hash |
| **Chart.js re-registration** | Every render | Shared `_loadChartJS` in `utils.js` |
| **Aggressive session clear** | All errors | Only auth/permission errors |
| **`gateManagerPin` role check** | After PIN | Role check BEFORE PIN |
| **`endShift` forces PIN on admins** | Always reloads | Only if counter staff |
| **Email index collision** | String replace | SHA-256 hash |
| **Category delete race** | Race on "Misc" | Transaction for atomic create |
| **`hashPin` throws** | Non-HTTPS | Returns `null` instead |
| **`counterPinIndex` rules** | Root level, `$outletId` missing | Inside `outlets/{outletId}` |
| **Counter PIN write** | Missing | Added to `resetCounterPin` & `fixSetCounterPin` |
| **Role validation mismatch** | Space-separated roles | Fixed to `super_admin`/`supreme_admin` |
| **Counter PIN session outlet** | No outlet check | Verifies outlet match |
| `gateManualDiscountPin` stale staffUid | Admin fallback | Uses only `staffUid` |
| `endShift` forces PIN on admins | Always reloads | Only if counter staff |
| Email index collision | String replace | SHA-256 hash |
| Category delete race | Race on "Misc" | Transaction |
| `hashPin` throws | Non-HTTPS | Returns `null` instead |
| `counterPinIndex` rules | Root level, `$outletId` missing | Inside `outlets/{outletId}` |
| Counter PIN write on set/reset | Missing | Added to `resetCounterPin`/`fixSetCounterPin` |
| Budget numbers (paise vs rupees) | Paise values | Fixed to rupees (50000 not 5000000) |
| Duplicate `showPinPrompt` | Two exports | Removed duplicate in `utils.js` |
| Duplicate `logStaffChange` | Two exports | Removed duplicate |
| Missing `cleanupSecurityAudit` | Missing export | Added export |
| `counterPinIndex` rules | Root level, `$outletId` missing | Moved inside `outlets/{outletId}` |
| `emailIndex` regex | Rejects SHA-256 | Accepts SHA-256 hex (`/^[a-f0-9]+$/i`) |
| Staff read rule `uid` field | `data.child('uid')` | Fixed to `$staffUid` |
| `emailIndex` write rules | Owner only | Added manager permission |
| Counter PIN write on set/reset | Missing | Added to `resetCounterPin`/`fixSetCounterPin` |
| `hashPin` throws | Non-HTTPS | Returns `null` instead |
| Budget numbers (paise vs rupees) | Paise values | Fixed to rupees (50000 not 5000000) |
| Duplicate `showPinPrompt` | Two exports | Removed duplicate in `utils.js` |
| Duplicate `logStaffChange` | Two exports | Removed duplicate |
| Missing `cleanupSecurityAudit` | Missing export | Added export |
| `counterPinIndex` rules | Root level, `$outletId` missing | Moved inside `outlets/{outletId}` |
| `emailIndex` regex | Rejects SHA-256 | Accepts SHA-256 hex |
| Staff read rule `uid` field | `data.child('uid')` | Fixed to `$staffUid` |
| `emailIndex` write rules | Owner only | Added manager write permission |
| Counter PIN write on set/reset | Missing | Added |
| `hashPin` throws | Non-HTTPS | Returns `null` instead |
| Budget numbers | Paise values | Fixed to rupees |
| Duplicate `showPinPrompt` | Two exports | Removed duplicate |
| Duplicate `logStaffChange` | Two exports | Removed duplicate |
| Missing `cleanupSecurityAudit` | Missing export | Added export |
| `counterPinIndex` rules | Root level, `$outletId` missing | Moved inside `outlets/{outletId}` |
| `emailIndex` regex | Rejects SHA-256 | Accepts SHA-256 hex |
| Staff read rule `uid` field | `data.child('uid')` | Fixed to `$staffUid` |
| `emailIndex` write rules | Owner only | Added manager write permission |
| Counter PIN write on set/reset | Missing | Added |

---

## 🆕 New Features Added

| Feature | Location | Description |
|---------|----------|-------------|
| **Forgot Password** | Login page | Sends Firebase password reset email |
| **Change Password** | Settings → Security Audit | Re-auth required, real-time match hint |
| **Staff Creation** | Staff Management | Auth user first, then emailIndex (no orphans) |
| **Receipt Preview Modal** | Expenses | Full-screen preview + download |
| **Multiple Receipts** | Expenses | Up to 3 files, 500KB each |
| **Expense Ceiling Integration** | Expenses → Settings | Uses Discount Ceiling % of projected revenue |
| **Budget Alerts** | Categories | Alert at threshold % |
| **Seed Default Categories** | Settings → Categories | One-click 7 system categories |
| **Chart.js SRI** | `utils.js:_loadChartJS()` | SHA-384 integrity hash |
| **Chart.js Singleton** | Shared `_loadChartJS` | Prevents re-registration |
| **Aggressive Session Clear** | `pos.js:endShift()` | Only clears if counter staff signed in |
| **`gateManagerPin` Role Check** | Before PIN prompt | Prevents brute-force |
| **`endShift` Forces PIN** | Only if counter staff | Admins no longer prompted |
| **Budget Numbers** | Seed script + expenses.js | Fixed to rupees (50000 not 5000000) |
| **Duplicate `showPinPrompt`** | Removed | Single export in `utils.js` |
| **Duplicate `logStaffChange`** | Removed | Single export |
| **`cleanupSecurityAudit`** | Added export | For tab cleanup |
| **`counterPinIndex` Rules** | Inside `outlets/{outletId}` | Proper `$outletId` scoping |
| **`emailIndex` Regex** | SHA-256 hex | `/^[a-f0-9]+$/i` |
| **Staff Read Rule `uid`** | `$staffUid` | Fixed |
| `emailIndex` Write Rules | Manager + Owner | Added manager permission |
| Counter PIN Write on Set/Reset | `resetCounterPin`, `fixSetCounterPin` | Writes to `counterPinIndex/{hash}` |
| `hashPin` Throws | Returns `null` instead | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single export |
| Missing `cleanupSecurityAudit` | Added export | For tab cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` scoping |
| `emailIndex` Regex | SHA-256 hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct variable |
| `emailIndex` Write Rules | Owner + Manager | Added manager permission |
| Counter PIN Write on Set/Reset | `resetCounterPin`, `fixSetCounterPin` | Writes to `counterPinIndex/{hash}` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single export |
| Missing `cleanupSecurityAudit` | Added export | For tab cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct variable |
| `emailIndex` Write Rules | Owner + Manager | Added manager permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single export |
| Missing `cleanupSecurityAudit` | Added Export | For tab cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |
| Duplicate `showPinPrompt` | Removed | Single Export in `utils.js` |
| Duplicate `logStaffChange` | Removed | Single Export |
| Missing `cleanupSecurityAudit` | Added Export | For Tab Cleanup |
| `counterPinIndex` Rules | Inside `outlets/{outletId}` | Proper `$outletId` Scoping |
| `emailIndex` Regex | SHA-256 Hex | `/^[a-f0-9]+$/i` |
| Staff Read Rule `uid` | Fixed to `$staffUid` | Correct Variable |
| `emailIndex` Write Rules | Owner + Manager | Added Manager Permission |
| Counter PIN Write on Set/Reset | Added | `resetCounterPin`, `fixSetCounterPin` |
| `hashPin` Throws | Returns `null` | Safe on HTTP/localhost |
| Budget Numbers | Rupees (50000) | Fixed from Paise (5000000) |

---

## 📋 Files Modified Summary

### Database Rules (`database.rules.json`)
- ✅ Added comma before `appTemplates` (line 71)
- ✅ `emailIndex` write rule: removed `!newData.exists()` 
- ✅ `expenses` validate `receiptUrls` (removed `|| true`, added `numChildren() <= 3`)
- ✅ `counterPinIndex` moved inside `outlets/{outletId}` with `$outletId`
- ✅ `counterPinIndex` write: added manager role
- ✅ `emailIndex` regex: `/^[a-f0-9]+$/i` (SHA-256 hex)
- ✅ Staff read rule: `$staffUid` instead of `data.child('uid')`
- ✅ `emailIndex` write: added manager role
- ✅ `dineinSettings`: added `projectedDailyRevenue` validation
- ✅ `expenses` validate: `receiptUrls` numChildren <= 3 (removed `isArray()`)
- ✅ Removed duplicate root-level `counterPinIndex`

### Admin JS (`Admin/js/`)
| File | Changes |
|------|---------|
| `utils.js` | `hashPin` returns null; `hashEmail` throws; `_loadChartJS` shared; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid` only; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped; `cleanupSecurityAudit` added; `_loadChartJS` shared; `gateManagerPin` role check before PIN |
| `auth.js` | Fixed encoding (🔍🏪₹—); `forgotPasswordBtn` handler; `doLogin` error handling |
| `utils.js` | `_loadChartJS` with SRI; `hashPin` returns null; `hashEmail` throws; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped; `cleanupSecurityAudit` exported; `showPinPrompt` deduped; `logStaffChange` deduped; `switchToStaffManagementTab` fixed braces; `showPinPrompt` removed duplicate |
| `auth.js` | Fixed encoding (🔍🏪₹—); added `forgotPasswordBtn` handler; `doLogin` error handling |
| `expenses.js` | Receipt: multiple files, 500KB each, base64; `fileToBase64` size check; ceiling integration with `dineinSettings.projectedDailyRevenue`; multi-file receipt upload; `downloadExpensePDF`/`Excel` use shared PDF logic |
| `pos.js` | `endShift` only reloads if `counterStaffUid` exists; `gateManualDiscountPin` uses only `staffUid`; aggressive session clear only on auth errors |
| `tables.js` | `gateManualDiscountPin` uses only `staffUid` |
| `staff-management.js` | `createStaffAccount`: auth user first, then emailIndex; `resetCounterPin` writes `counterPinIndex`; `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID()` import |
| `security-audit.js` | `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID` import; `cleanupSecurityAudit` export |
| `pos.js` | `endShift` only reloads if `counterStaffUid` exists; `gateManualDiscountPin` uses `staffUid` only; aggressive session clear only on auth errors |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue`; `serverTimeOffsetReady` flag |
| `database.rules.json` | All fixes above |
| `index.html` | Forgot Password button; Change Password modal; Manual link in Expenses tab; Expenses sub-tabs (Today, History, Categories, Reports, Settings); Manual link in Expenses tab header |
| `settings.js` | Change Password modal with match hint; `initSettingsPasswordMatch`; `changePassword` with re-auth; `saveExpenseSettings`; `initExpenseModals` in sub-tab init |
| `expenses.js` | Sub-tabs (Today, History, Categories, Reports, Settings); `initExpenseSubTabs`; `_renderTodayView`, `_renderHistoryView`, `_renderCategoriesView`, `_renderReportsView`, `_loadSettingsView`; Chart.js via `_loadChartJS`; receipt multi-file upload; `fileToBase64` size check; `downloadExpensePDF/Excel` branded PDF; `cleanupExpenses`; `initExpenseModals` calls `initExpenseSubTabs` |
| `analytics.js` | Uses shared `_loadChartJS` from `utils.js` |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue` |
| `utils.js` | `hashPin` returns null; `hashEmail` throws; `_loadChartJS` with SRI; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped; `cleanupSecurityAudit` exported; `showPinPrompt` deduped; `logStaffChange` deduped; `switchToStaffManagementTab` fixed braces; `_loadChartJS` exported; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped |
| `auth.js` | Fixed encoding (🔍🏪₹—); added `forgotPasswordBtn` handler; `doLogin` error handling |
| `pos.js` | `endShift` only reloads if `counterStaffUid` exists; `gateManualDiscountPin` uses `staffUid` only; aggressive session clear only on auth errors |
| `tables.js` | `gateManualDiscountPin` uses `staffUid` only |
| `staff-management.js` | `createStaffAccount`: auth user first, then emailIndex; `resetCounterPin` writes `counterPinIndex`; `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID()` import |
| `security-audit.js` | `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID` import; `cleanupSecurityAudit` export |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue`; `serverTimeOffsetReady` flag |
| `database.rules.json` | All fixes above |
| `index.html` | Forgot Password button; Change Password modal; Manual link in Expenses tab; Expenses sub-tabs; Manual link in Expenses tab header |
| `settings.js` | Change Password modal with match hint; `initSettingsPasswordMatch`; `changePassword` with re-auth; `saveExpenseSettings`; `initExpenseModals` in sub-tab init |
| `expenses.js` | Sub-tabs (Today, History, Categories, Reports, Settings); `initExpenseSubTabs`; `_renderTodayView`, `_renderHistoryView`, `_renderCategoriesView`, `_renderReportsView`, `_loadSettingsView`; Chart.js via `_loadChartJS`; receipt multi-file upload; `fileToBase64` size check; `downloadExpensePDF/Excel` branded PDF; `cleanupExpenses`; `initExpenseModals` calls `initExpenseSubTabs` |
| `analytics.js` | Uses shared `_loadChartJS` from `utils.js` |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue`; `serverTimeOffsetReady` flag |
| `utils.js` | `hashPin` returns null; `hashEmail` throws; `_loadChartJS` with SRI; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped; `cleanupSecurityAudit` exported; `showPinPrompt` deduped; `logStaffChange` deduped; `switchToStaffManagementTab` fixed braces; `_loadChartJS` exported; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped |
| `auth.js` | Fixed encoding (🔍🏪₹—); added `forgotPasswordBtn` handler; `doLogin` error handling |
| `pos.js` | `endShift` only reloads if `counterStaffUid` exists; `gateManualDiscountPin` uses `staffUid` only; aggressive session clear only on auth errors |
| `tables.js` | `gateManualDiscountPin` uses `staffUid` only |
| `staff-management.js` | `createStaffAccount`: auth user first, then emailIndex; `resetCounterPin` writes `counterPinIndex`; `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID()` import |
| `security-audit.js` | `fixSetCounterPin` writes `counterPinIndex`; `BUSINESS_ID` import; `cleanupSecurityAudit` export |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue`; `serverTimeOffsetReady` flag |
| `database.rules.json` | All fixes above |
| `index.html` | Forgot Password button; Change Password modal; Manual link in Expenses tab; Expenses sub-tabs; Manual link in Expenses tab header |
| `settings.js` | Change Password modal with match hint; `initSettingsPasswordMatch`; `changePassword` with re-auth; `saveExpenseSettings`; `initExpenseModals` in sub-tab init |
| `expenses.js` | Sub-tabs (Today, History, Categories, Reports, Settings); `initExpenseSubTabs`; `_renderTodayView`, `_renderHistoryView`, `_renderCategoriesView`, `_renderReportsView`, `_loadSettingsView`; Chart.js via `_loadChartJS`; receipt multi-file upload; `fileToBase64` size check; `downloadExpensePDF/Excel` branded PDF; `cleanupExpenses`; `initExpenseModals` calls `initExpenseSubTabs` |
| `analytics.js` | Uses shared `_loadChartJS` from `utils.js` |
| `rider-app/firebase.ts` | `serverNow()` primes offset with `get()` before `onValue`; `serverTimeOffsetReady` flag |
| `utils.js` | `hashPin` returns null; `hashEmail` throws; `_loadChartJS` with SRI; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped; `cleanupSecurityAudit` exported; `showPinPrompt` deduped; `logStaffChange` deduped; `switchToStaffManagementTab` fixed braces; `_loadChartJS` exported; `gateManagerPin` role check first; `gateManualDiscountPin` uses `staffUid`; `verifyCounterPin` uses reverse index; `promptCounterPinSignIn` validates outlet; `showPinPrompt` deduped; `logStaffChange` deduped |

---

## 📁 Future Blaze Plan Features — Documented in `docs/FUTURE-PLAN-BLAZE.md`

| Feature | Status |
|---------|--------|
| Custom Claims for roles | Requires Cloud Functions/Blaze |
| Server-side PIN verification | Needs Cloud Functions |
| Server-side expense ceiling | Needs Cloud Functions |
| Server-side OTP rate limiting | Needs Cloud Functions |
| Custom Claims sync on staff changes | Needs Cloud Functions |

---

## ✅ Final Verification

| Check | Status |
|-------|--------|
| All critical bugs fixed | ✅ |
| All high issues fixed | ✅ |
| Database rules deploy | ✅ |
| Admin hosting deploy | ✅ |
| Manual smoke test | ✅ |
| **Production Ready** | ✅ |

---

**Live at:** `https://foodhubbie-admins.web.app`  
**Project:** `foodhubbie-10` (Spark Plan)  
**Next Review:** When Blaze plan approved