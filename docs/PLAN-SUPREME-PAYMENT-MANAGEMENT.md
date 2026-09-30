# Plan: Supreme "Payment Management" — v4 FINAL (direct list + Payment Record Page)

Status: **DONE 2026-09-28.** All 10 steps executed, deployed (`database` + `hosting:admin` + `hosting:supreme`), live E2E verified (Admin Costs parity exact, record payment in tab + profile, receipt, QR +₹2). See PROJECT_LEDGER.md entry `[20260928-0947-a7f3]`.
Build order: steps 1→10, one by one, each verified before the next.

---

## #Verify (done)

- Usage math exists & live: `Admin/js/features/cost-math.js` (QR ₹2 · POS ₹1 · webview/WA ₹3 · other ₹2 · promo ₹1 · 1% mode · Cancelled/Refunded excluded) → Admin Costs tab KPI.
- Supreme profile `renderBillingCard` = config only (rates/mode/setup/tokens) — no usage ₹, no payments.
- `billing` node seeded in prod; rules: read = super/supreme or own-outlet admin, write = super/supreme only → both pay places are Supreme (tab + profile).
- No payments/receipts anywhere yet. All inputs (orders, billing, campaigns) live in the single data-store snapshot → zero new listeners.
- createdAt = ISO string → month scope = prefix `YYYY-MM-` (same as costs.js `startAt`).

## Pages

### 1. Tab — `#payments` (`payment-overview.js`) — direct complete list
- KPIs: **Outstanding (all outlets, all-time) + owing count** · **Usage (this month)** · **Collected (this month)** · restaurants (+ disabled count).
- Table: Outlet | Business | Plan chip | Orders | **Usage (all time)** | **Paid (all time)** | **Due (all time** — red amount, green "Settled" at zero**)** | **Record →** (this outlet's Record page). All-time ₹ on purpose: parity with the Admin Costs tab and the profile Billing card; plan/status filters + per-plan due rollup strip above the table.
- Record payment modal lives on the Record page and the profile Billing card (no direct modal from the tab).

### 2. Payment Record Page — `#payments/{bid}/{oid}` (`payment-record.js`) — NEW requirement
Complete per-restaurant statement:
- Header: business · outlet · plan pill · **Back** to list.
- **Scope selector**: `All time | Monthly | Yearly | Custom` (+ From/To date inputs when Custom; default All time).
- **KPIs for scope**: Used (usage + charges) · Paid · **Balance**.
- **Breakdown table** (Monthly/Yearly modes): Period | Usage | Charges | Paid | Due — rows newest first; clicking a row scopes the transactions below to that period.
- **Transactions** (scope-filtered): Date·time | Payment/Charge | Description | Method | Amount | **Balance after** | **Receipt** (payments) — balance = usage(scope) + cumCharges − cumPaid up to that row; final row = Balance KPI.
- Buttons: **Record payment** · **Add charge** (shared modals).

### 3. Profile Billing card (`restaurant-profile.js`) — second pay place
- Money strip: Usage (MTD) · Paid · **Due (all time)**.
- Buttons: **Payment record →** (navigates to page 2 — "clicking on their Cost Tracker in Profile") · **Record payment** (shared modal).

## Shared money module — `SupremeAdmin/js/billing-shared.js` (new)
- `usageOf(outlet, scope)` = `computeCostIndex(ordersIn(scope), billing.rates, billing.mode).total + promoIn(scope) + 0`; `chargesIn`, `paidIn`, `dueOf` — scope = `{type:'all'|'month'|'ymd'|'range', …}`.
- `promoIn(scope)` = Σ campaigns `totalSent × PROMO_RATE` attributed by campaign `createdAt` in scope (`ponytail:` approximation — sends may spread past creation; same rate as Admin Costs).
- `recordPaymentModal({bid, oid, due})`, `addChargeModal(...)`, `ledgerRows(outlet, scope)` (sorted transactions + running balance), `receiptHtml(...)` → **popup print window** (user-gesture OK, zero deps, no print-CSS wrestling).
- Writes: push to `billing/payments` / `billing/charges`; `receiptNo = RCP-<yyyymmdd>-<3 chars key>`.

## Data + rules
- Children under existing `billing`: `payments/{push}` {amount, method UPI|Cash|Card|Bank, note, period, receiptNo, createdAt, createdBy} · `charges/{push}` {amount, reason, period, createdAt, createdBy}.
- `database.rules.json`: add `.validate` under `billing/payments/$id` and `billing/charges/$id` only (allow delete via `newData.val() == null ||`). Read/write blocks untouched.

## Files
| File | Change |
|---|---|
| `shared/cost-math.js` | **moved** from `Admin/js/features/cost-math.js` (self-check kept) |
| `tools/build.mjs` | `supreme.shared = true` |
| `Admin/js/features/costs.js` | import `../../shared/cost-math.js` |
| `SupremeAdmin/index.html` | 3rd `dash-tab dash-payment` (`wallet`) + subnav → `#payments` |
| `SupremeAdmin/js/main.js` | routes `#payments`, `#payments/{bid}/{oid}` → `dashboard:'payment'`; `DASHBOARD_HOME` |
| `SupremeAdmin/css/style.css` | indigo `--accent-payment` trio |
| `SupremeAdmin/js/billing-shared.js` | **new** — math + 2 modals + ledger rows + receipt |
| `SupremeAdmin/js/features/payment-overview.js` | **new** — list page |
| `SupremeAdmin/js/features/payment-record.js` | **new** — record page |
| `SupremeAdmin/js/features/restaurant-profile.js` | money strip + 2 buttons in Billing card |
| `database.rules.json` | validates only |

Menu / bot / Admin Costs UI: untouched.

## Execution order (one by one)
1. Move cost-math → `shared/` + build flag + Admin import · verify: self-check + both builds
2. Rules `.validate` + `JSON.parse`
3. `billing-shared.js` (math + modals + receipt) · `node --check`
4. Nav skeleton (index.html, main.js, style.css) + empty route render
5. `payment-overview.js` full list
6. `payment-record.js` full page
7. Profile Billing card integration
8. Full builds (`--admin --supreme`) + `node --check` all
9. Deploy: `database`, `hosting:admin`, `hosting:supreme`
10. E2E (temp super: list parity with Admin Costs KPI · record in tab · record in profile · monthly/yearly/custom scopes correct · receipt prints · live +₹2 on test QR order · cleanup) → screenshots → `PROJECT_LEDGER.md`
