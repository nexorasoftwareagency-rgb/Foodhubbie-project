# PLAN-ORDERRESTRO-PORT — Selective Feature Port from Nodedr OrderRestro

> Source of study: `reference/orderrestro/` (full clone of `Raktim94/nodedr-restaurant-pos`, release 1.9.0, AGPL-3.0).
> Target: Foodhubbie (this repo) — Firebase RTDB + Hosting, vanilla JS, EC2 bot stack.
> Date: 2026-10-26

---

## 0. Scope — What We Want / What We Do NOT Want

### IN SCOPE (5 items, per owner decision)

| # | Area | OrderRestro reference |
|---|------|----------------------|
| 1 | **CRM — Profiles, Points (loyalty) — upgrade logics** | `apps/backend/src/modules/customers/`, `orders/settlement.ts` (loyalty tender math), `orders/orders.service.ts` (earn logic), `modules/gift-cards/`, `prisma/schema.prisma` (Customer model) |
| 2 | **Staff Management — improvement logics** | `modules/attendance/`, `modules/hr/` (+ `payroll.calc.ts` pure math), `modules/users/`, schema models: Attendance, Shift, LeaveRequest, StaffPay, PayrollRun, PayrollLine |
| 3 | **Excel & PDF report export — design + logic** | `modules/reports/export.ts` (ExcelJS + PDFKit rendering), `modules/reports/csv.ts` (formula-injection guard), `modules/downloads/` |
| 4 | **Report UI** | `apps/web/app/(dashboard)/reports/page.tsx` + `components/reports/schedules-panel`, `modules/reports/reports.service.ts` (REPORT_CATALOG, permission gating) |
| 5 | **Marketing logics — review** | `modules/marketing/discounts.ts` (coupon + happy-hour pure rules), `marketing.service.ts`, schema: marketingOptOut on Customer |

### OUT OF SCOPE (explicitly rejected — do not port, do not plan)

- ❌ Inventory ingredients / recipes / waste / stock batches (their biggest module — owner said no)
- ❌ Offline-first / self-hosted / Docker / CasaOS / MSIX / updater — Foodhubbie stays Firebase cloud
- ❌ Procurement, accounting (P&L/balance sheet), KDS rebuild, reservations, verifactu, kiosk, delivery zones — not for this system
- ❌ Their auth (JWT/Passport), NestJS framework, Prisma, Next.js, React components — architecture mismatch

---

## 1. Legal & Porting Rules (read first)

- OrderRestro is **AGPL-3.0-only**. Foodhubbie is a commercial multi-tenant SaaS. **Never copy-paste their source into this repo.** Clean-room re-implementation only: study the logic, write our own code in our own style.
- Ideas, algorithms, math, data models, flows, and visual designs are **not** copyrightable — those we may adopt freely.
- **npm libraries are fine**: `exceljs` (MIT) and `pdfkit` (MIT) are open-source libraries, NOT part of OrderRestro's AGPL code. We may use the same libraries with our own rendering code.
- Every port lands in Foodhubbie conventions: vanilla JS ES modules, `shared/` for cross-app logic, RTDB paths under `businesses/{bid}/outlets/{oid}/…`, rules validated in `database.rules.json`, Playwright check per feature.

### Architecture translation table

| OrderRestro | Foodhubbie equivalent |
|---|---|
| NestJS service (DI, DTOs) | Plain JS module in `Admin/js/features/` (or `bot/` for server-side jobs on EC2) |
| Prisma + Postgres relational | RTDB JSON tree `businesses/{bid}/outlets/{oid}/<feature>` + `database.rules.json` |
| Server-authoritative compute | Compute in Admin client where possible; **money/loyalty math mirrored in bot (EC2)** since bot already writes orders server-side; rules validate shape |
| React/Next page | Vanilla JS view module + existing CSS system |
| Socket.IO events | Existing RTDB listeners (already realtime) |
| Zod schema (`packages/types`) | Plain JS validator in `shared/` (one validator per shape, imported by Admin + bot) |
| `runTransaction` on customer balance | `runTransaction` (Foodhubbie already uses it for session attaches) |

---

## 2. Feature 1 — CRM: Profiles, Points, Upgrade Logics

### 2.1 What OrderRestro does (spec extracted from source)

**Customer profile fields** (schema.prisma `Customer`):
`name, phone, email, address, birthday, anniversary, allergies, notes` + computed state:
`loyaltyPoints (Int, default 0)`, `marketingOptOut (Boolean, default false)`, `walletBalance (Decimal 12,2 — store credit)`.

**Profile view**: last **20 PAID orders** (id, orderNumber, totalAmount, billedAt) + gift cards owned.

**Loyalty EARN** (orders.service.ts):
- Config: `loyaltyEarnPerCurrency` lives on the **restaurant** (per-branch chain inherits) — e.g. 1 point per ₹100.
- Earn formula: `pointsEarned = floor(netSpend / loyaltyEarnPerCurrency)` where
  `netSpend = subtotal − discountAmount − loyaltyDiscountAmount` (tip EXCLUDED — tips never earn points).
- Earn fires **only once the sale is actually PAID** (not on order open).
- Balance update is an **atomic increment** (race-free, no read-then-write window).
- Customer can be **attached at billing time** (walk-ins don't need a name up front — staff attaches when the guest pays; falls back to QR-order-attached customer).

**Loyalty REDEEM** (settlement.ts — the important design insight):
- Points are a **form of TENDER, not a price reduction**. `loyaltyDiscountAmount = min(max(requested,0), totalAmount)`.
- Because it's tender, **redeeming does NOT change the tax** (unlike coupon discount which spreads pro-rata over lines and scales the tax breakup).
- Final due: `totalDue = totalAmount − loyaltyDiscountAmount + tip + deliveryFee`.
- **Redemption requires a customer attached** (400 error otherwise).
- **Lock discipline**: once any payment is taken on a bill, discount/tip/loyalty edits are REJECTED ("locked once a payment has been taken").

**Gift cards** (`modules/gift-cards/`): owned per customer, redemption tracked (`GiftCardRedemption`), balance discipline = rounded read-modify-write `set` (never DB-side increment).

### 2.2 What Foodhubbie has today (verify on start)

- Customers area exists in Admin (role menus reference it); promo/coupon engine exists (`Admin/js/features/promotions.js`); wallet/credit **not** known to exist.
- Bot orders write via EC2 (server-side) — the natural place for earn-on-paid logic.

### 2.3 Build plan (clean-room, Foodhubbie-native)

1. **RTDB model** — `businesses/{bid}/outlets/{oid}/customers/{customerId}`:
   `{ name, phone, email, birthday, anniversary, allergies, notes, loyaltyPoints, marketingOptOut, walletBalance, createdAt, lastOrderAt }`
   + `customersByPhone/{phone -> customerId}` index (phone is the join key for WhatsApp).
   Rules: read/write = outlet admin + super; `marketingOptOut` writable only by admin/super (bot must not flip it).
2. **Config** — `businesses/{bid}/outlets/{oid}/settings/Loyalty = { earnPerCurrency, redeemValuePerPoint, minRedeemPoints, enabled }` (per-outlet, editable in Admin Settings).
3. **Earn logic** — implement in **bot order-close path** (server-authoritative): on order → `Placed`/paid, `pointsEarned = floor(netSpend / earnPerCurrency)`, `runTransaction` increment on `customers/{id}/loyaltyPoints`. Write `loyaltyEarned` onto the order record for audit.
4. **Redeem logic** — tender-style: `loyaltyDiscountAmount = min(points × redeemValuePerPoint, totalDue)`; **tax unchanged**; block redemption when no customer attached; **lock** discount/tip/points once any payment recorded (mirror their lock discipline).
5. **Profile UI** — customer card in Admin: fields above + last 20 orders + points balance + wallet balance + opt-out badge; edit form; hard-delete detaches (orders keep `customerId` history but profile gone).
6. **Wallet credit** (optional phase 1b) — store credit as tender, same lock rules, `set`-not-`increment` for balances.
7. **Gift cards** (optional phase 1c) — code + balance + redemption log; balance via `runTransaction`.

**Verification**: unit check for earn/redeem math (`test-loyalty.mjs`); Playwright E2E: attach customer → pay → points incremented → redeem on next order → tax breakup unchanged; rules test (opt-out not writable by bot identity).

---

## 3. Feature 2 — Staff Management Improvements

### 3.1 What OrderRestro does (spec)

**Attendance**: clock in / clock out per staff per day; payroll derives from **clocked hours** (not shift schedule).

**Shifts**: scheduling with **clash checks** (same staff double-booked detection) across the week.

**Leave**: `LeaveRequest` with approval; **UNPAID leave days** feed payroll deductions; paid leave doesn't.

**Payroll** (`payroll.calc.ts` — pure, unit-tested, money in major units, round2 everywhere):
- `MONTHLY` staff: `basePay = rate × (periodDays / daysInMonth(periodStart))` — a full calendar month pays exactly the rate. Unpaid-leave deduction: `rate / daysInMonth` **per unpaid day**.
- `HOURLY` staff: `basePay = rate × hoursWorked` (no leave deduction — hourly is unpaid by nature).
- **Tip pool**: split **proportional to hours worked**; the **last recipient absorbs rounding** so shares sum to the pool exactly (no lost rupees).
- Output line: `{ userId, hoursWorked, basePay, tipShare, unpaidLeaveDeduction, netPay }` where `netPay = basePay + tipShare − unpaidLeaveDeduction`.
- `daysInclusive(start,end)` and `daysInMonthOf(date)` helpers; period = `YYYY-MM-DD` strings.

**PayrollRun / PayrollLine**: a run snapshot for a period (immutable once closed) with per-staff lines — audit-friendly.

### 3.2 What Foodhubbie has today

`staff-management.js` exists (account creation, role/outlet assignment, password mirror writes). Attendance/shifts/leave/payroll: not present.

### 3.3 Build plan

1. **RTDB model** — `businesses/{bid}/outlets/{oid}/staff/{uid}` (exists) extended with
   `{ payType: 'MONTHLY'|'HOURLY', rate, active }`;
   new nodes: `attendance/{date}/{uid} = { inAt, outAt, minutes }`,
   `shifts/{weekId}/{uid} = [{day, startMinute, endMinute, station}]`,
   `leave/{requestId} = { uid, from, to, paid, status }`,
   `payrollRuns/{periodId} = { periodStart, periodEnd, tipPool, lines:{uid:{...PayLineResult}}, closedAt, closedBy }`.
2. **Pure payroll module** — `shared/payroll-math.js` (own implementation): `daysInclusive`, `daysInMonthOf`, `computePayroll(periodStart, periodEnd, tipPool, staff[])` with last-recipient-absorbs-rounding tip split + round2. **One runnable check** (`test_payroll.mjs`) — this is exactly the "non-trivial logic leaves one runnable check" rule.
3. **Clock in/out UI** — Admin Staff page: per-staff Today card (In/Out buttons writing `attendance/{date}/{uid}`); auto-minute computation on Out.
4. **Shift planner** — weekly grid; **clash check** client-side before save (same uid overlapping minutes on same day → block with toast).
5. **Leave** — request list + approve/reject; approved UNPAID days feed the payroll run input.
6. **Payroll run** — pick period → preview lines → **Close run** (immutable snapshot write, `closedAt` stamped); CSV export of lines (reuses Feature 3 export code).
7. **Tip pool wiring** — end-of-period tip total (from orders' tips) becomes `tipPool` input; per-staff share by clocked hours.

**Verification**: `test_payroll.mjs` (monthly proration, unpaid-leave deduction, hourly, tip rounding absorption); Playwright: clock in → out → run payroll for the day → line matches manual math; clash check blocks double-shift.

### Phase 3 — AS BUILT (2026-10-27, ledger 20261027-034500-phase3-staff)

- **`shared/payroll-math.js` shipped** (self-check inline via `node shared/payroll-math.js` instead of a separate test file — same pattern as money-math/discount-rules): `daysInclusive`, `daysInMonthOf`, `computePayroll`. MONTHLY `rate × periodDays/daysInMonth(periodStart)`, unpaid-leave deduction `rate/daysInMonth` per day; HOURLY `rate × rawMinutes/60` (leave never deducts); tip pool ∝ clocked minutes, **last eligible recipient absorbs rounding** (shares sum to pool exactly); `netPay` NOT floored at 0 (audit lines must show impossible negatives from bad inputs). Hostile-input coercion throughout. Admin-only consumer — no menu twin.
- **Nodes as planned** (§3.3.1), with deltas: `shifts/{weekId}/{uid}` stores `{uid: [{day 0=Mon..6=Sun, startMinute, endMinute}]}` (station dropped — YAGNI); `payrollRuns/{periodId}` periodId = `{start}__{end}`; `staff/{uid}` gained `payType`+`rate` (blank/0 rate = excluded from payroll). Rules: attendance/shifts/leave/payrollRuns all super/supreme/owner-manager-on-outlet; payrollRuns write blocked once `closedAt` exists; deployed.
- **UI**: 4 new sm-subtabs inside Settings → Staff Management (Attendance | Shifts | Leave | Payroll), lazy `init*Page()` per page; staff modal gained Pay Type + Pay Rate; `loadStaffList()` refreshes visible Phase 3 pages when the staff cache lands late. Shift grid cells support up to 3 shifts/day via a "+" button and ALWAYS render one editable pair — a single-shift-per-cell grid makes the clash check dead code. Tip pool is a **manual input** (orders carry no tip field — grep-verified; §3.3.7's auto-wiring has nothing to wire from).
- **Immutability is two-layer** (RTDB rules cascade finding, ledger): `businesses/$bid/.write` grants business admins everything below (live-proven: owner wrote `billing/*` past its super/supreme-only rule), so the rules `closedAt` guard only binds non-business-admin writers — E2E-proven binding for a manager WITHOUT `businessId` (HTTP 401). The enforceable layer for the UI is the client guard in `closePayrollRun` (refuses an existing run). Business admins remain trusted for their business — same trust level billing already has.
- **E2E 27/27 live** (`%TEMP%/opencode/e2e-staff.js` + idempotent `seed-e2e-staff.js`): clock in/out land in DB; shift save + clash toast (DB unchanged) + 2-shift save; unpaid leave approved; payroll pins EXACT — Ramesh 20.00h/₹4,000/₹171.43/₹4,171.43 · Sunita 15.00h/₹900/₹128.57/₹1,028.57 (absorbs rounding) · Amit 0h/₹2,580.65/−₹1,290.32/₹1,290.33; run snapshot `2026-10-20__2026-10-23` with closedAt + tipPool 300; UI re-close refused; closedAt intact. Admin SW → v5.11.2.

---

## 4. Feature 3 — Excel & PDF Report Export (design + logic)

### 4.1 What OrderRestro does (spec from `export.ts` / `csv.ts` — the design to match)

**Unified pipeline**: one `ReportResult { title, columns[], rows[][] }` → three renderers (`csv | xlsx | pdf`) behind one `renderReport()` entry. UI never knows the difference.

**XLSX (ExcelJS)**:
- Worksheet named `title.slice(0, 31)` (Excel's 31-char sheet-name limit).
- Row 1: title, **bold size 14**. Row 2: subtitle (grey `666666`). Row 3: blank spacer.
- Row 4: header — **bold, white text on solid brand fill** (`FF7A1F3D` — we use Foodhubbie's brand color instead).
- **Column widths auto-fit**: `max(header length, widest of first 200 data rows) + 2`, clamped **10…48** (200-row cap = fast on big reports).
- **Freeze panes at row 4** (`{ state:'frozen', ySplit:4 }`) — headers stay visible while scrolling.

**PDF (PDFKit)**:
- **A4; landscape automatically when > 6 columns**, portrait otherwise; margin 36.
- Title 16 bold + subtitle 9 grey, then table.
- Cells: Helvetica 8.5, per-column fixed width, **word-wrap within column**; row height = tallest cell; hairline separator under each row (0.5 grey; header separator 1.0 brand color, bold).
- **Header row repeats on every page break**; empty state: "No data for this period."

**CSV**: minimal writer with the **spreadsheet-injection guard** — any cell string starting with `= + - @ \t \r` gets a `'` prefix (prevents formula injection when opened in Excel). **Same guard applied to XLSX cells too** (not just CSV) — their `cell()` does it for both.

**Downloads module**: files generated server-side, served with correct MIME (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/pdf`, `text/csv; charset=utf-8`) and filename `report-key_from_to.ext`.

### 4.2 Foodhubbie constraint → design decision

Foodhubbie has **no server** for Admin (Firebase Hosting static, Spark free tier). Two options:

- **(A) Browser-side generation (recommended)** — `exceljs` ships a browser bundle; PDF via the **existing print-to-PDF pattern** (Foodhubbie already uses popup-print for receipts in Supreme payment-record). Zero server, zero cost, works offline-in-browser. PDF = styled print view (`window.print()`), XLSX = exceljs in-browser → `Blob` download.
- **(B) EC2 worker** — bot-control-api generates files (exceljs/pdfkit in Node) and returns them. More moving parts, needs auth'd file transfer; only if (A) hits limits (very large reports).

**Decision: Option A.** Keep the same *design* (title/subtitle/brand header/frozen panes/auto-width/landscape-if-wide) but render in browser.

### 4.3 Build plan

1. `Admin/js/features/report-export.js` — `renderReport(result, format)`:
   - `csv`: own writer **with the formula-injection guard** (port the *idea*).
   - `xlsx`: exceljs browser build, layout spec above with Foodhubbie brand fill; same guard on cells.
   - `pdf`: styled print view (A4 CSS, landscape media query when >6 cols, repeating header via `thead`, hairline row rules) → `window.print()`.
2. Wire into existing analytics CSV path (`analytics.js` / `analytics-mobile.js`) so every report gets all three formats from one code path.
3. Filename convention: `${reportKey}_${from}_${to}.ext`.

**Verification**: generate each format for a small dataset; open XLSX (widths, frozen header, no formula execution on a `=cmd` cell), print-preview PDF (header repeats, landscape on wide report), CSV opens clean in Excel.

### Phase 5 — AS BUILT (2026-10-27, ledger 20261027092137-phase5-export)

- **Option A as planned** — browser-side, zero server. ONE entry: `renderReport(result, format, meta)` in `Admin/js/features/report-export.js`; meta = `{key, title, from, to, subtitle?}` (subtitle defaults to "{n} rows · from → to").
- **Pure core** `shared/report-export.js` (self-check `node shared/report-export.js`): `guardSpreadsheetCell` (`'` prefix on strings starting `= + - @ \t \r`), `toCsvMatrix` (RFC-4180, CRLF, BOM left to the caller), `autoWidths` (max(header, widest of first 200 rows)+2, clamp 10…48; numbers measured by en-IN 2dp display +1 for ₹), `needsLandscape` (>6 cols). Admin-only — no menu twin.
- **XLSX** = exceljs@4.4.0 lazy CDN (`ensureExcelJS()`, same pattern as `Admin/js/xlsx.js` — untouched): sheet name sanitized + `slice(0,31)`; title bold 14 / subtitle grey 666666 / blank spacer / header bold white on **FFE84908** (Foodhubbie brand); data from row 5, strings guarded, raw numbers, money cols `numFmt '#,##0.00'` (exceljs writes built-in numFmtId=4); auto widths; `views [{state:'frozen', ySplit:4}]`; `writeBuffer()` → Blob → `${key}_${from}_${to}.xlsx`.
- **PDF** = styled print view (spec's PDFKit design mapped to CSS): fills `#reportPrintArea` (direct child of body), A4 via per-print injected `@page` (landscape iff >6 cols, margin 12mm), title 16pt + subtitle 9pt grey, 8.5pt table, `thead` repeats on page breaks natively, hairline 0.5pt row rules, header rule 1pt brand; `body.printing-report` + `window.print()`, cleanup on `afterprint` + 5s fallback. Old runner print CSS kept as the manual Ctrl+P fallback.
- **CSV** = shared `toCsvMatrix` + BOM; guard applies to CSV AND XLSX strings alike.
- **Wiring**: runner gained `#btnRrXlsx` (same roleLevel≥1 gate; CSV/Print rerouted through renderReport); `analytics.js downloadExcel` rewritten onto the pipeline (same 10 columns, key `sales-report`) — **fixes a live spreadsheet-injection hole** in the old `json_to_sheet` path; `downloadPDF` (jsPDF+autotable) intentionally kept.
- **Verification (live, e2e outlet)**: E2E 52/52 (`%TEMP%/opencode/e2e-reports.js`) — XLSX zip inspected (frozen ySplit=4, FFE84908, guarded `'=E2E_INJECT` seeded dish), CSV guard, print view in print-media emulation (portrait for 6 cols; `needsLandscape` covered by the pure self-check, 6→false / 7→true — no catalog report exceeds 6 columns), analytics XLSX via the same pipeline, permission gate still hides all exports from level-0. SW v5.11.4, css ?v=5.4.10, PurgeCSS +`/^rp-/`.

---

## 5. Feature 4 — Report UI

### 5.1 What OrderRestro does (spec from `page.tsx` + REPORT_CATALOG)

- **Catalog-driven**: `REPORT_CATALOG = [{key, title, group}]` — 18 reports in groups: Sales, Tax, Analytics, Customers, Staff, Operations, Inventory. UI renders the catalog (grouped), never hardcodes report names.
- **One generic page**: pick report (key) + date range (default **last 30 days**, `from ≤ to` enforced) → `GET /reports/{key}?from&to` → `{ columns[], rows[][] }` → generic table. No per-report pages.
- **Grouped sidebar** via `[...new Set(catalog.map(c => c.group))]`.
- **Export buttons gated by permission**: `data.export` permission required to see Download; Print button present; chrome wrapped in `print:hidden` so print output is the table only.
- **Loading/error states**: skeleton while loading, error banner with retry (`retry:false` on query).
- **Scheduled email reports** (`report-schedules`): daily/weekly/monthly via own SMTP — a schedules panel on the same page.

### 5.2 Build plan (Foodhubbie-native)

1. **`REPORT_CATALOG` in `shared/`** — one array `{key, title, group}`; Admin Reports page renders groups from it (matches our existing analytics reports: peak hours, sales by item, payment methods, top customers, table turnover, staff sales… map ours onto the group taxonomy).
2. **Reports page rebuild** — group sidebar + date range (default 30d, from≤to) + generic table renderer + skeleton/error states. Reuse existing Admin CSS system.
3. **Permission gate** — export/print buttons visible only to roles with export rights (our custom-claims roles; mirror their `reports.access` vs `dashboard.sales.view` split: **revenue-bearing reports need an extra sales-view flag** so e.g. inventory staff can't see sales figures — adopt the *idea* with our claims).
4. **Print chrome** — `@media print` hides nav/filters; table fills page.
5. **(Later, optional)** scheduled email via EC2 bot worker + existing SMTP patterns — only if owner wants it.

**Verification**: Playwright — switch reports, invalid range blocked, export buttons hidden for a no-export role, print preview shows table only.

### Phase 4 — AS BUILT (2026-10-27, ledger 20261027-035900-phase4-report-ui)

- **Third subtab, not a rebuild**: the runner lives at `.analytics-subtab[data-analytics-tab="runner"]` ("Reports") beside Revenue | WhatsApp Bot; panel `#reportsRunnerPanel`; `_switchAnalyticsPanel` gains a 'runner' branch (lazy `import('./report-runner.js')` + mount, unmount on leave). Existing Revenue analytics untouched.
- **`shared/report-catalog.js`** (pure, self-check green): REPORT_CATALOG 10 entries `{key,title,group,revenue,req?,snapshot?}` + REPORT_GROUPS + `runReport(key,data) → {columns,rows,colTypes}` with RAW numbers; colTypes 'text'|'num'|'money' drive alignment + Phase 5 export styling. Revenue basis 'Delivered'||'Served'; IST day/hour keys; phone via tableSessionsContact; payment buckets cash/upi/else-COD. `sales-by-category` dropped (cart items carry no category). No menu twin (Admin-only).
- **Runner** (`Admin/js/features/report-runner.js`): group pills + report list from the catalog, default last-30-days IST range, from≤to toast-block, orders via the Revenue analytics query window (UTC-padded createdAt startAt/endAt + IST filter), per-report `req` extras fetched once per range (contacts/dishes/staff/attendance), generic table with skeleton/error+retry/empty states, CSV (BOM, raw numbers, filename `${key}_${from}_${to}.csv`), print via global + scoped `@media print` chrome-strip.
- **Permission gate** (tab-roles ponytail): isSuper/level≥1 sees Sales/Tax/Customers + CSV/Print; level 0 sees Staff/Operations/Inventory only. E2E-proven with a custom level-0 'viewer' role in settings/roles.
- **E2E 35/35** (`%TEMP%/opencode/e2e-reports.js`): every report asserted against a DB-computed oracle; cancelled excluded from money + present in funnel; CSV bytes checked; print emulation checked; zero page errors.
- **Deferred**: scheduled email reports (§5.1 last bullet) — later/optional per owner.

---

## 6. Feature 5 — Marketing Logics (review + adopt)

### 6.1 What OrderRestro does (spec from `discounts.ts` — pure, unit-tested rules)

**CouponRule**: `{ kind: PERCENT|FLAT, value, minOrderAmount, maxDiscount|null, validFrom|null, validUntil|null, usageLimit|null, usedCount, isActive }`.

**`evaluateCoupon(coupon, subtotal, now)` → `{ok:true, amount} | {ok:false, reason}`** with **human-readable rejection reasons**:
- not active → "This coupon is not active"
- before validFrom → "not valid yet"; after validUntil → "has expired"
- usedCount ≥ usageLimit → "fully used"
- subtotal < minOrderAmount → "Minimum order for this coupon is ₹X"
- computed amount ≤ 0 → "gives no discount on this order"

**`discountAmount(kind, value, subtotal, maxDiscount)`**: percent or flat; capped by `maxDiscount` **and never more than the subtotal itself**; round2.

**Happy-hour PromotionRule**: `{ kind, value, daysOfWeek[0-6], startMinute, endMinute, isActive }` — `promotionActive(p, day, minute)` window check; `toMinutes('HH:MM')` helpers. Time-of-day + day-of-week automatic discounts, no code needed.

**Campaign audience**: `marketingOptOut` customers are **excluded from every campaign audience** (flag on Customer, default false).

**Campaigns**: email (own SMTP) / SMS / WhatsApp with opt-out enforcement.

### 6.2 Review vs Foodhubbie today — gaps & adoptions

| Their capability | Foodhubbie today | Adopt? |
|---|---|---|
| Coupon caps (`maxDiscount`, never > subtotal) | Coupons exist (`discCoupon*`, prefix codes) — verify cap logic | ✅ Add caps if missing |
| Human-readable rejection reasons surfaced to customer | Verify what bot/checkout says on invalid coupon | ✅ Port the reason strings pattern |
| `usageLimit` + `usedCount` per coupon | Verify | ✅ Add if missing |
| `validFrom/validUntil` windows | Verify | ✅ Add if missing |
| Happy-hour windows (day-of-week + minute range) | Happy-hour **not** present (promotions.js is campaign-shaped) | ✅ New: `promotions/{id} = {kind,value,daysOfWeek,startMinute,endMinute,isActive}` + window check in order pricing path (bot + Admin POS) |
| `marketingOptOut` enforced on every campaign audience | Bot campaigns exist (Baileys-blocked promos, meta transport, Hinglish shells) — **opt-out flag not known** | ✅ Add flag to customer profile + filter in `runPromotionCampaign` audience build (respects India DND/consent norms, complements COMPLIANCE posture) |
| Discount math shared with bill totals | `_effectiveTotal()` discipline exists | ✅ Route coupon amount through the same shared money module (Feature-3-adjacent `shared/money-math.js`) |

**Note**: their `discounts.ts` is pure + spec'd with tests — the *shape* (rule object, evaluate → {ok,amount|reason}) is the design we re-implement in `shared/discount-rules.js` with our own code.

### 6.3 Build plan

1. `shared/discount-rules.js` — own `CouponRule`/`PromotionRule` shapes + `evaluateCoupon()` + `promotionActive()` + `discountAmount()` (round2, caps). One runnable check file.
2. Wire `evaluateCoupon` into bot order flow + Admin POS coupon entry (single source of truth — no divergent re-implementations).
3. Happy-hour admin UI (small: list + form with day checkboxes + time range) writing `promotions/{id}`; pricing path consults active windows.
4. `marketingOptOut` on customer profiles (Feature 1) + audience filter in promotions engine + bot `runPromotionCampaign`.
5. Coupon caps + usage counters (`usedCount` via `runTransaction` on redemption).

**Verification**: `test_discount-rules.mjs` (caps, expiry, usage limit, min order, window edges); Playwright: apply valid/invalid coupon in POS → reason toast; happy-hour window toggles discount on/off; opted-out customer absent from campaign preview.

### Phase 6 — AS BUILT (2026-10-27, ledger 20261027153446-phase6-marketing)

- **Review verdict**: §6.2 was already ~5/7 shipped before this phase ran (P2-9 discount engine + Feature 1 CRM + the bot’s consent model). Caps, windows, usage counters, human reasons, and opt-out enforcement all verified present; see ledger for the map. The opt-out model is STRICTER than the spec: explicit `promotionalConsent === true` required (opt-IN), plus `bot/promotions/optout` keys, enforced per-recipient in the bot send loop and the Admin audience build.
- **The one gap — happy-hour windows — adopted with a deviation from §6.3**: NO separate `promotions/{id}` node. Any discount on the existing `discounts` node can now carry `daysOfWeek` ([0=Sun…6=Sat]) + `startTime`/`endTime` ('HH:MM', IST); new pure `inSchedule(d, now)` delegates to the existing `promotionActive`, gates `evaluateDiscounts` candidates, and `couponStatus` returns `not_in_window` (+ human reason) outside the window. Bot order flow, Admin POS preview, and menu webview coupon validation honor windows by construction — one engine, no second pricing path.
- **Admin editor**: step 2 of the discount wizard gained the weekly window (day checkboxes + time range, end-exclusive hint), with validation (both times, end>start), review row, card display, and nulls on clear.
- **Verification (live, e2e outlet)**: E2E 11/11 — engine test through the real `bot/discount-engine.js` (inside applies / outside excluded / coupon reason / unscheduled regression; time-of-day-safe window math) + Playwright authoring round-trip (save → DB exact, card display, repopulate, clear → nulls, end≤start blocked). Twins 5/5, menu SW v29, Admin SW v5.11.5, bot tests 17/17.

---

## 7. Delivery Order & Dependencies

```
Phase 0  Repo rules note (AGPL clean-room) — done by this doc
Phase 1  shared/money-math.js + shared/discount-rules.js  (pure, tested)     ← foundation
Phase 2  Feature 1 CRM/loyalty (RTDB model → bot earn → Admin UI → redeem)
Phase 3  Feature 2 Staff (attendance → shifts → leave → payroll run)
Phase 4  Feature 4 Report UI shell + catalog (uses existing analytics data)
Phase 5  Feature 3 Export engine (csv → xlsx → print-pdf) wired into Phase 4 page
Phase 6  Feature 5 Marketing (happy-hour + opt-out + coupon caps) — reuses Phase 1 modules
```

Rationale: pure math modules first (everything depends on them); Report UI before export engine (UI defines the `ReportResult` shape the exporters consume); marketing last (depends on CRM profiles for opt-out + money-math for caps).

### Phase 1 — AS BUILT (2026-10-26)

- **`shared/discount-rules.js` shipped** — the P2-9 formula + eligibility/stacking/exclusivity core extracted from the three drifting copies (`Admin/js/features/discount-evaluator.js`, `bot/discount-engine.js`, `menu/js/discount.js`), which had already diverged (admin matched coupons by `d.couponCode` truthiness instead of `type === 'coupon'`; the table-channel per-customer counter existed only admin-side). Engines keep only Firebase I/O. Added OrderRestro-derived clean-room upgrades: `couponStatus` + `COUPON_STATUS_TEXT` (human-readable rejection reasons), `promotionActive`/`toMinutes` happy-hour windows (Phase 6 will wire the UI), `round2`.
- **Menu twin**: `menu/shared/discount-rules.js` is a byte-identical copy (menu hosting cannot reach repo-root `/shared`; same pattern as combo-math.js), precached in `menu/sw.js` (cache bumped to `menu-shell-v25`), guarded by `tools/check-shared-twins.cjs`.
- **Bot require**: `bot/discount-engine.js` does `require('../shared/discount-rules.js')` (require(esm), needs Node ≥ 22.12 on EC2 — **verify on next deploy window**). Graceful degradation if it fails: the 4-line amount formula keeps working from a frozen local copy, full evaluation returns null (no discount rather than a wrong discount), warn in pm2 logs. The module is deliberately top-level-await-free so require(esm) works.
- **`shared/money-math.js` — RE-INSTATED as Phase 1b** (initial deferral was based on a faulty repo grep): Foodhubbie DOES have tax + service-charge math in production — `menu/js/order.js` (CGST Sec 15(3)(a): discount excluded from taxable value), `Admin/js/features/pos.js` (same model, hand-rolled copy), `menu/js/delivery-order.js` (DIFFERENT model: no tax, discount base includes delivery fee), and `bot/index.js` re-verify (recomputes discount but reuses the client-claimed tax — undercharge edge case when a client over-claims a discount). Two local `round2` copies in menu alone. Real consumers, real drift — same disease the discount extraction cured.
- **Verification**: `node shared/discount-rules.js` (inline self-check), `node --test bot/tests/unit.test.js` 16/16, `node tests/discount-evaluator.check.mjs` 9/9 (check-test plugin extended to resolve `shared/*` — production imports are runtime-URL-relative since build.mjs minifies per-file without bundling), sync guard OK, `npm run build:admin` clean with `dist/shared/discount-rules.js` emitted. Admin SW cache bumped `v5.10.3`→`v5.10.4`.

### Phase 1b — AS BUILT (2026-10-26)

- **`shared/money-math.js` shipped** — `round2` (EPSILON-guarded half-up, same convention as discount-rules.js), `computeOrderTotals({subtotal, discount, taxRates, serviceChargeEnabled, serviceChargeRate, deliveryFee})`, and `recomputeTaxOnTaxable(taxable, taxItems)` for the bot's re-verify. Model (owner-locked): discount off the food subtotal first → GST on the net taxable value (CGST Sec 15(3)(a)); per-rate lines rounded 2dp, tax = their rounded sum; **service charge on the FULL subtotal, dine-in only**; **delivery fee outside the taxable value, never taxed**; total floors at 0. Trust-boundary coercion throughout (string/undefined money → 0, never NaN). Inline self-check: `node shared/money-math.js`.
- **Owner decision (2026-10-26)**: delivery orders use the SAME tax model as dine-in, but service charge stays dine-in-only, never on delivery. `menu/js/delivery-order.js` now reads `dineinSettings` (added to its existing parallel fetch — zero extra RTT) and writes `tax`/`taxItems`/`taxName` on delivery orders. **Deploy note: delivery customers' totals change (tax added) — flag to outlets.**
- **Five drifting copies consolidated**: `menu/js/order.js` (placement), `menu/js/delivery-order.js` (placement), `menu/js/ui.js updateCartTotals` (live cart display — now computed by the same function that charges, so display can never drift from invoice again), `Admin/js/features/pos.js` ×2 (walk-in display block + walk-in placement block). All local `round2` copies deleted; POS keeps its deliberate integer `Math.round` on the manual discount input only (display/UX choice, not money math).
- **Bot re-verify gap fixed** (`bot/index.js`): new `_verifiedOrderTotal()` helper + guarded `require('../shared/money-math.js')` (same graceful-degradation pattern as discount-engine: legacy formulas on partial deploy, warn in pm2). QR verify + webview verify + webview fail-safe all recompute tax from the order's OWN `taxItems[].rate` on the CORRECTED taxable value — the client-claimed `order.tax` is no longer reused (undercharge edge case closed). Legacy fallback for orders predating `taxItems` keeps the old formulas byte-compatible. Also fixed a latent bug found while porting: the webview verify + fail-safe used whole-rupee `Math.round` (a ₹140.50 total was silently "corrected" to ₹141); both now keep paise.
- **Residual trust assumption (documented, accepted)**: the verify recomputes tax AMOUNTS from the order's stored RATES — those rates are client-written, consistent with the invoice the customer already saw. Re-deriving rates (and subtotal) server-side would need `dineinSettings` reads plus addon prices on QR items (QR items carry addon names only) — out of Phase 1b scope; the verify's charter remains discount integrity.
- **Twin guard generalized**: `tools/check-discount-rules-sync.cjs` → `tools/check-shared-twins.cjs`, now guarding ALL four twin pairs (`combo-math.js`, `discount-rules.js`, `format-order-id.js`, `money-math.js`) — combo-math and format-order-id were previously hand-synced with no guard. `menu/sw.js` precaches `./shared/money-math.js`, cache bumped `menu-shell-v25`→`v26`.
- **Rules**: no changes needed — the orders `.validate` already accepts optional numeric `tax` and ignores unknown children (`taxItems`/`taxName` pass through, same as QR orders today).
- **Verification**: `node shared/money-math.js` OK (20 assertions incl. SC-on-full-subtotal pin, delivery-no-SC pin, verify==placement parity); twin guard 4/4 OK; `node --check bot/index.js` OK; `node --test bot/tests/unit.test.js` 16/16; `node tests/discount-evaluator.check.mjs` 9/9; `npm run build:admin` clean with `dist/shared/money-math.js` emitted; `npm run test:encoding` OK; esbuild parse clean on all touched menu files. Admin SW cache bumped `v5.10.4`→`v5.10.5` (pos.js changed).

### Phase 2 — AS BUILT (2026-10-27)

Loyalty upgrades per R1/R2/R3/R8/R9. Everything monetary is Admin-configurable in `loyalty/config` (formulas stay fixed); zero rules changes (orders validate allows extra children, config validate allows extras).

- **`shared/loyalty-math.js` shipped** (+ byte-identical `menu/shared/` twin, guard now 5 pairs): `computeEarnBase(order)` (R1: `subtotal − discount`, legacy fallback `order.total`), `computeEarnPoints` (two-stage floor preserved exactly: floor(base/rate) → ×tier mult → floor), `tierForPoints` (inclusive mins), `computeTenderPaise` (R2/R9: `min(points × value, due − minSpend)`, paise integers), `distributeBillDiscountPaise` (largest-remainder bill-discount split, shares sum exactly). Inline self-check: `node shared/loyalty-math.js`.
- **Bot earn rework** (`bot/index.js`): `accrueLoyaltyPoints` now earns on the R1 base and SKIPS dine-in (settlement path below); shared tail `_writeLoyaltyAccrual` (idempotency → tier mult → accrual record → tx incl. `lastClawedOrderId:null` → rankings mirror → customer order history) is the single writer for both earn paths.
- **Dine-in accrual (was structurally missing — QR customers never earned)**: bot-side, fired by the existing orders `child_changed` listener when `paymentStatus` flips to `'Paid'` (table/group settlement). Rank computation requires reading the full `loyalty/rankings` parent — rules deny that to everyone except the Admin SDK bot, so Admin-side accrual is impossible without breaking the PII/rankings design. Classification = `type==='dine-in' || isDineIn || tableId` (NOT sessionId — webview delivery orders carry a chat sessionId). Phone resolved from `tableSessionsContact/{sessionId}` (order records carry no phone by design). Bill-level discount split across covered orders via `distributeBillDiscountPaise` so no order earns on value a sibling's share paid off.
- **Clawback (R3)**: `clawLoyaltyPoints` reverses on `cancelled`/`refunded` status OR a dine-in `paymentStatus` flip back to `'Unpaid'` (bill void). Deletes the accrual record (audit copy under `loyalty/clawbacks/{orderId}`), clears `lastAccruedOrderId` (void→repay re-earns), tx-guarded by `lastClawedOrderId`; also resurrects a burned reward code whose order died (`usedOnOrder` guard). Accrual lookup happens BEFORE the config read — unpaid dine-in orders hit this path on every routine update.
- **Single entry point**: `processLoyalty(orderId, order)` (claw → accrue → dine-in earn) called in the `child_changed` handler BEFORE the debounce gate — a paymentStatus-only flip shares `order.status` with the prior event and the debounce must never eat an accrual. `notifyCustomerApp` is notification-only now (its early-return used to swallow dine-in accruals entirely).
- **Reward tender (R2, delivery webview only)**: checkout tries coupon first, then the customer's own active `LOYAL…` code (`validateRewardCode` in customer.js — read-only, rules deny menu writes). Client sends ONLY `rewardCode:{key,code}` on the order; `verifyRewardTender` (bot, after discount re-verification so the tender rides the VERIFIED total) validates code+phone, burns the code in a transaction FIRST (replay-proof), then writes `loyaltyTender` + `totalDue = total − tender`. Tender never touches taxable value (GST tender view, R2). `minSpendAfterRedemption` caps it (R9). Dine-in excluded by design — staff honor redemption via the existing manual discount (documented limitation). Invoice (`formatOrderInvoice`) + admin notification show TOTAL → tender → PAYABLE.
- **Admin loyalty settings**: new fields `redeemValuePaisePerPoint` (default ₹1/pt), `minSpendAfterRedemption` (default 0), toggles `earnEnabled` / `dineInEarnEnabled` / `clawbackEnabled`; R8 live "effective value back" display per tier (`pointValue ÷ earnRate × mult`); the three `set()` payload builders deduped into `buildConfigPayload()` — `set()` overwrites the whole node, so every writer must carry all fields.
- **Delivery cart display fix (pre-existing bug found during tender work)**: the webview cart passed `taxEnabled=false` so the displayed total OMITTED the GST that `placeDeliveryOrder` charges since Phase 1b — display now reads the same `dineinSettings` the placement charges. Required anyway so the tender preview computes on the real base.
- **CRITICAL RECOVERY — delivery webview was dead in the repo**: commit `be443ba` (2026-10-23) truncated `menu/js/delivery.js` 844→63 lines (destroyed boot/cart/checkout wiring; `placeDeliveryOrder` had zero callers), and the intended fix had itself been built on `8600837` (2026-10-21) which introduced a duplicate-identifier syntax error. Restored the last valid full version `84960e6` (909 lines) and re-applied the intended cross-sell change cleanly (rows keep the `name:` shape `showComboSheet` renders; the broken commit's `dishId` idea was wrong). **The live host has been serving the broken build since the menu deploy on/after 2026-10-21 — `firebase deploy --only hosting:menu` restores delivery ordering.**
- **Verification**: `node shared/loyalty-math.js` OK; twins 5/5; `node --check` clean on bot/index.js, bot/utils.js, bot/discount-engine.js, Admin loyalty.js + tables.js, all touched menu files; `node --test bot/tests/unit.test.js` 17/17 (new loyalty-math cases); `npm run build:admin` clean; `npm run test:encoding` OK; `tools/check-schema.cjs` OK. `menu/sw.js` → `menu-shell-v27` (precaches both new twins). `tools/check-copy-consistency.cjs` FAILs are pre-existing `website/` local edits, untouched by this phase.
- **Phase 1 review finding fixed**: `bot/discount-engine.js recordDiscountUsage` now maintains the customer counters the evaluator enforces (`discountUsage[discountId]`, `firstOrderDiscountUsed`/`firstOrderDiscountId`) — POS wrote them, the bot never did, so a WhatsApp/webview guest could reuse a per-customer-limited discount indefinitely. Cold-tx seed pattern (read before transaction) prevents a null first attempt from wiping the customer record.
- **Void bug fixed (pre-existing, blocks dine-in clawback)**: `voidTableBill` filtered/guarded on `order.status === 'Paid'` but payment writes `paymentStatus` — full-table void was dead code ("No paid orders to void" forever) and voided bills stayed revenue-counted. All three spots now use `paymentStatus`.
- **Waived for Phase 2 (documented)**: dine-in tender at the bill (staff manual discount); WA-chat redemption; post-placement toast on tender rejection (WA confirmation is the source of truth); reward-code refund on cancellation is handled by the clawback resurrect, but a PARTIALLY redeemable code (tender hit the cap) still burns fully — accepted.
- **LIVE E2E (2026-10-27, ledger 20261027-080000-delivery-e2e)**: full lifecycle verified on the e2e outlet after EC2 Node 22 upgrade + bot/shared deploy — browser cart math exact (₹298 + GST ₹15 + fee ₹20 → tender −₹200 → payable ₹133), bot wrote `loyaltyTender`/`totalDue`/burn, Delivered → +14 pts, Cancelled → clawback + code resurrect. Four bugs found + fixed en route (socket-gated finalization; cold-tx null aborts on burn/resurrect; accrual tx omitting `points`; claw not decrementing `points`) — details in the ledger entry.
- **Direct-mode delivery ordering LIVE (2026-10-27, ledger 20261027-031000-direct-mode-delivery)**: resolves the E2E finding that bare `delivery.html?b=&o=` could browse but never order (order rules require an unused `webviewToken`). Owner chose the trusted-path mint: Firebase **Anonymous Auth** enabled project-wide (Identity Toolkit admin REST); `webviewTokens/$tokenId/.write` gained a create-only anon branch (`sign_in_provider=='anonymous' && !data.exists() && phone=='anonymous' && used==false && anonUid==auth.uid`); the 3 bare `auth != null` gates (`config/tunnelUrl`, `outlets/.../locked`, `outletIndex`) tightened with `sign_in_provider != 'anonymous'` (blast radius audited — no PII reachable by anon uids). Menu mints lazily at checkout (`mintAnonWebviewToken()` in `menu/js/firebase.js`, called from `delivery.js` when `!M.token`); `menu-shell-v28`. Bare-URL live E2E ALL PASSED — order money exact, anon token minted + used-flipped, bot tender/burn/stock all processed. The QR dine-in app remains fully no-auth.

## 8. Non-Goals Guardrail

If during any phase an OrderRestro pattern tempts a scope expansion (inventory, offline, procurement…), it is **out of scope by owner decision** — record it in PROJECT_LEDGER.md as rejected, don't build it.

## 9. Research Findings (2026-10-26 — internet-sourced logic validation)

Sources: joy.so loyalty-point-cost study (95 Shopify storefronts, 2026), Economic Times (GST law committee view on loyalty points), Shopify discount-combination docs, Voucherify/Broadleaf stacking analyses, Rivo/Yotpo/Smile.io refund policies, Toast/Square tip-pooling docs, proration references (Shiftbase/Omnicalculator/SAP).

| # | Finding | Source | Decision for Foodhubbie |
|---|---------|--------|------------------------|
| R1 | **Earn base must be a deliberate choice** — GMV vs net-of-discount vs amount-paid; exclude taxes, shipping, gift cards, refunded amounts; "awarding on pre-discount value while allowing a discount on the same order increases generosity — it should not be accidental" | joy.so | Phase 2: earn on `subtotal − discount` ONLY (exclude tax, service charge, delivery fee). Today the bot earns on `order.total` which includes tax+SC+delivery → points inflate ~5-10% per order. Also earns on `delivered`/`served` (final states) — keep. |
| R2 | **India GST: loyalty redemption = mode of payment, NOT a discount** — "GST must be paid on total value of supply irrespective of the fact that loyalty points are utilised" | Economic Times (GST law committee); PwC commentary | Phase 2: redeem as TENDER applied after tax computation — never reduces taxable value, never printed as a discount line. Matches OrderRestro settlement.ts exactly. (Final treatment = outlet's CA's call; design follows the tender view.) |
| R3 | **Refund clawback is the industry norm** — Rivo/Yotpo/Smile auto-reverse points on refunds/cancellations; Square's manual-only clawback is a documented pain point | Rivo/Yotpo/Smile docs, Square community | Phase 2: reverse the accrual when a Delivered/Served order is later Cancelled/Refunded — idempotent via the existing `loyalty/accruals/{orderId}` record (status → 'reversed', deduct pointsEarned/totalSpent/orderCount). |
| R4 | **Stacking sequence is a merchant decision** — Shopify compounds percent-before-fixed "to give the customer the best deal"; Broadleaf/Voucherify stress it must be explicit | Shopify docs, Voucherify, Broadleaf | KEEP Foodhubbie's P2-9 (each discount off full subtotal, additive, capped at subtotal) — deliberately more generous than compounding with multiple percents, simpler, locked + test-pinned. Document as intentional; Phase 6 happy-hour uses the same base. |
| R5 | **Monthly-pay proration: calendar-days method is standard** (monthly ÷ days-in-month × payable days incl. weekly offs); SAP uses a constant-30 variant; ÷26 daily-rate is for daily-wage contexts, not monthly salaried staff | Shiftbase, OmniCalculator, SAP community, ADP | Phase 3: keep the OrderRestro-style `daysInMonth` proration — matches the Indian monthly-rated convention. |
| R6 | **Tip pools: proportional-to-hours is the standard method**; implementation detail that matters: rounding absorption so shares sum exactly; policy must be written/disclosed | Toast ("Proportionally by hours worked"), Square, Baker Tilly, r/restaurant | Phase 3: keep hours-proportional split + last-recipient-absorbs-rounding; add the written-policy note to the payroll UI. |
| R7 | **Breakage is an estimate, not a target** — retail breakage 20-30% typical; aggressive expiry erodes trust; IFRS 15/ASC 606 treat loyalty awards as a performance obligation (finance owns the policy) | joy.so, mycred | No points expiry for launch (simpler, trust-building). If added later: 12-month rolling + reminders. Record as a deliberate non-feature. |
| R8 | **Show effective cashback, not point counts** — `effective cashback = points-per-currency × value-per-point`; nominal generosity ≠ realized cost; tier multipliers observed 1.25×-3× | joy.so | Phase 2 Admin loyalty settings: display the implied % back live as either side of the exchange rate is edited (Foodhubbie tiers 1/1.25/1.5 are conservative vs observed range — fine). |
| R9 | **Redemption guardrail checklist**: max redeemed value per order, minimum spend after redemption, explicit discount-code compatibility, refund reversals | joy.so | Phase 2: tender cap at totalDue (✓ by design); add optional `minSpendAfterRedemption` config; decide explicitly that points STACK with coupons (tender ≠ discount) but consider a combined cap. |

### Codebase facts corrected/confirmed during research (2026-10-26)

- `menu/js/order.js` placeOrder: `taxable = subtotal − discount` → tax on net (CGST Sec 15(3)(a) ✓), service charge on FULL subtotal, `total = taxable + tax + SC`.
- `Admin/js/features/pos.js`: same model, third hand-rolled copy.
- `menu/js/delivery-order.js`: **different model** — no tax, no SC, `total = subtotal + deliveryFee − discount`, discount capped at `subtotal + deliveryFee`. Whether delivery should charge GST like dine-in is an OWNER business decision (flagged, not decided).
- `bot/index.js` QR re-verify: recomputes the discount server-side but **reuses the client-claimed `order.tax`** — if the server corrects an over-claimed discount upward, tax is not recomputed on the higher taxable value → undercharge edge case. Phase 1b fixes this by recomputing from `order.taxItems[].rate`.
- Two local `round2` copies in menu (order.js, delivery-order.js); POS rolls its own inline rounding.
- Loyalty earn today: fires on `delivered`/`served`, base `order.total`, paise-per-point + tier multiplier, idempotent via `loyalty/accruals/{orderId}` — solid skeleton, earn-base and clawback are the gaps (R1/R3).
