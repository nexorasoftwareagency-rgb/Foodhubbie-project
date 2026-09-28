# Expenses Feature Design Document (Complete)

---

## 1. Overview

**Purpose**: Enable restaurant administrators to track, categorize, and reconcile financial expenses (utilities, rent, supplier fees, miscellaneous) within the FoodHubbie ERP system. Expenses are recorded per-outlet, support receipt attachments, and feed into financial reporting and the existing ceiling/PIN gating for manual discounts.

**Scope**: Full CRUD for expenses, per-outlet isolation, category system, receipt attachment (camera/upload), expense reporting (CSV/PDF), integration with discount ceiling, and full audit trail.

**Key Constraints**:
- Expense amounts subject to the discount ceiling (% of bill) — manager PIN gating for manual overrides (already shipped).
- Every expense must be tagged to an outlet (per-outlet reporting).
- Receipts captured via camera or uploaded PDF/image; stored as base64 in Firebase Realtime Database.
- Expenses appear in a dedicated **Expenses** tab in the Admin dashboard.
- All expense edits logged with `editedBy`/`editedAt` (soft-delete pattern like restaurants).

---

## 2. Admin Tab Structure

### 2.1 Top-Level Navigation
| Path | Route | Name | Icon | Role Gate |
|------|-------|------|------|-----------|
| `Admin/#/expenses` | `/hosting/admin/expenses` | **Expenses** | 💰 | `admin` |

Added to left nav alongside: Dashboard, Customers, Analytics, Riders, POS, Tables, Catalog, Settings.

### 2.2 Sub-Tabs (within Expenses)
| Sub-Tab | Route | Purpose |
|---------|-------|---------|
| **Today** | `/expenses/today` | Quick entry for current day's expenses; sum by category |
| **History** | `/expenses/history` | Calendar-picker view of past expenses; filter by date range, category, outlet |
| **Categories** | `/expenses/categories` | Add/edit/delete expense categories; assign default budgets/alerts |
| **Reports** | `/expenses/reports` | Aggregated reports: spend by category, outlet, monthly trends; export CSV/PDF |
| **Settings** | `/expenses/settings` | Global expense settings: ceiling % (already shipped), auto-approval rules, approval workflow |

Sub-tab navigation: Horizontal pill bar beneath the Expenses tab header; active pill highlighted; **History** defaults open.

---

## 3. Feature Specification by Sub-Tab

### 3.1 Today — Rapid Entry
**Purpose**: Fast logging of today's expenses with live total.

**UI Layout**:
- **Header bar**: `Expenses – ${todayISO}  |  TOTAL: Rs. ${dayTotal.toLocaleString('en-IN')}`
- **Category chips**: Horizontal scrollable chips from `Categories` config; "+ Add new" at right opens category modal.
- **Amount input**: Large prominent `Rs.` formatted number pad (`<input type="number" step="0.01">`); `₹/Rs.` toggle via setting.
- **Memo/Description**: Multi-line text (max 200 chars).
- **Receipt upload**: Button to attach up to 3 images (JPG/PNG, < 2 MB each); images pre-converted via existing `/api/images/convert` endpoint (Sharp on EC2).
- **Submit**: Primary CTA; disabled if amount empty.

**State & Logic**:
- On submit: `POST /api/expenses` (callable) → writes `{date: todayISO, category, amount, memo, receiptUrls[], createdAt, createdBy: adminUid, outletId: currentOutlet}`.
- After submit: toast "Expense logged"; amount resets to 0; focus returns to amount input for rapid fire-entry.
- **Ceiling guard**: Before submit, compute `currentDayTotal + amount`; if > `ceiling%` of today's projected revenue (config setting), show warning: "Expense exceeds daily ceiling (X% of today's revenue). Requires manager PIN." PIN modal (same component as void-PIN) blocks until valid PIN entered.

### 3.2 History — Browse & Filter
**Purpose**: Review past expenses with powerful filtering.

**UI Layout**:
- **Filter bar** (sticky top):
  - Date range picker (From/To, defaults to current month).
  - Category multi-select dropdown (chips).
  - Outlet dropdown (if multi-outlet admin).
  - Approved status: All / Approved / Pending.
  - Search box (description, amount).
- **Table** (paginated, 20 rows/page, virtualized):
  | Date | Category | Description | Amount | Outlet | Receipt | Approved | Actions |
  |------|----------|-------------|--------|--------|---------|----------|---------|
  | 26/09/2026 | Utilities | Electricity bill | Rs. 12,500 | Pizza | 📎 | ✅ | ✏️ 🗑️ |
- **Row actions**: Edit (opens Edit modal), Delete (soft-delete with confirmation), View Receipt (opens full-screen).
- **Bulk actions** (checkbox column): Bulk Approve (requires PIN), Bulk Delete (soft), Export Selected.

### 3.3 Categories — Master Data
**Purpose**: Define expense categories with optional budgets.

**UI Layout**:
- **List** of categories (name, color, icon, monthly budget, alert threshold %).
- **Add/Edit modal**:
  - Name (required, unique).
  - Color picker (brand palette).
  - Icon selector (Lucide icons).
  - Monthly budget (Rs., optional).
  - Alert at % of budget (default 80%).
- **System categories** (seeded, non-deletable): Rent, Utilities, Payroll, Supplies, Marketing, Maintenance, Misc.
- **Drag-to-reorder** for display priority.

### 3.4 Reports — Analytics
**Purpose**: Financial visibility for owners/managers.

**Report Types**:
1. **Monthly Summary** — Bar chart (Chart.js) of total spend per month; table: Month | Total | vs Budget | Top 3 Categories.
2. **Category Breakdown** — Pie/donut chart + table: Category | Amount | % of Total | Budget | Alert.
3. **Outlet Comparison** — Grouped bar: Outlet | Total | Per-Category.
4. **Trend Lines** — Line chart: daily spend over selected range.

**Export**: Each report has **CSV** and **PDF** buttons (reuse `downloadCustomerExcel/PDF` patterns with report-specific data).

### 3.5 Settings — Global Config
**Fields**:
- **Ceiling %** (already exists in discount engine; read-only link to Discounts settings).
- **Auto-approve threshold**: Expenses ≤ this amount auto-approve (default Rs. 5,000).
- **Require receipt for amounts >**: (default Rs. 1,000).
- **Default currency display**: `Rs.` / `₹`.
- **Approval workflow**: Single-manager PIN / Dual-manager PIN (future).
- **Retention policy**: Days to keep soft-deleted expenses (default 90).

---

## 4. Data Model (Firebase Realtime Database)

```
/expenses/{expenseId}
{
  amount: number,              // stored in paise (integer) to avoid float errors
  categoryId: string,          // ref to /expenseCategories/{id}
  categoryName: string,        // denormalized for queries
  date: string,                // ISO date (YYYY-MM-DD) — query key
  description: string,         // memo
  receiptUrls: string[],       // base64 data URLs or storage refs
  outletId: string,            // per-outlet isolation
  status: 'approved' | 'pending' | 'rejected',
  approvedBy: string|null,     // admin UID
  approvedAt: number|null,     // timestamp
  createdAt: number,           // server timestamp
  createdBy: string,           // admin UID
  editedAt: number|null,       // last edit timestamp
  editedBy: string|null,       // last editor UID
  deletedAt: number|null,      // soft-delete
  deletedBy: string|null
}

/expenseCategories/{categoryId}
{
  name: string,
  color: string,               // hex
  icon: string,                // Lucide icon name
  monthlyBudget: number|null,  // paise
  alertThreshold: number,      // 0-100 (default 80)
  isSystem: boolean,           // seeded categories
  displayOrder: number
}
```

**Indexes** (via queries):
- `date` + `outletId` (History table)
- `categoryId` + `date` (Category breakdown)
- `status` + `date` (Pending approval list)

---

## 5. API / Callable Functions

| Function | Method | Params | Returns | Auth |
|----------|--------|--------|---------|------|
| `createExpense` | POST | `{date, categoryId, amount, description, receiptUrls[]}` | `{expenseId, createdAt}` | admin |
| `updateExpense` | PATCH | `{expenseId, patch}` | `{updatedAt}` | admin |
| `softDeleteExpense` | DELETE | `{expenseId}` | `{deletedAt}` | admin |
| `approveExpense` | POST | `{expenseId, pin}` | `{approvedAt, approvedBy}` | admin + PIN |
| `bulkApproveExpenses` | POST | `{expenseIds[], pin}` | `{count}` | admin + PIN |
| `listExpenses` | GET | `{outletId, from, to, categoryId, status, limit, cursor}` | `{items[], nextCursor}` | admin |
| `getExpenseStats` | GET | `{outletId, from, to}` | `{total, byCategory, byOutlet, pendingCount}` | admin |
| `createCategory` | POST | `{name, color, icon, monthlyBudget, alertThreshold}` | `{categoryId}` | admin |
| `updateCategory` | PATCH | `{categoryId, patch}` | `{updatedAt}` | admin |
| `deleteCategory` | DELETE | `{categoryId}` | `{deletedAt}` | admin (guarded: must reassign expenses) |
| `exportExpensesCSV` | GET | `{outletId, from, to, categoryId}` | CSV stream | admin |
| `exportExpensesPDF` | GET | `{outletId, from, to, categoryId}` | PDF blob | admin |

**Ceiling Integration** (reuse existing):
- Before `createExpense`/`updateExpense`, call `getDiscountCeiling(outletId)` → returns `{ceilingPercent, ceilingAmount}`.
- If `newDayTotal > ceilingAmount * ceilingPercent / 100`, require PIN via `verifyManagerPin(pin)` (same as void-PIN).

---

## 6. Forms

### 6.1 Add / Edit Expense Form
| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Date | date picker | required, ≤ today, ≥ outlet open date | defaults to today |
| Category | select (searchable) | required, must exist in `/expenseCategories` | chips for multi-category split (future) |
| Amount | number (paise) | required, > 0, ≤ 99,99,999 | formatted Rs. on blur |
| Description | textarea | optional, max 200 chars | |
| Receipts | file upload (max 3) | optional; if `amount > receiptThreshold` → required | JPG/PNG/PDF; pre-convert via `/api/images/convert` |
| Split across outlets? | checkbox | optional; if checked, show per-outlet amount inputs | future enhancement |

**Responsive**: On mobile (< 640px) → full-screen modal; desktop → centered modal (max-w-md).

### 6.2 Category Form
| Field | Type | Validation |
|-------|------|------------|
| Name | text | required, unique, 2-30 chars |
| Color | color picker | required, valid hex |
| Icon | icon picker | required, from Lucide set |
| Monthly Budget | number (paise) | optional, ≥ 0 |
| Alert Threshold | number (0-100) | required, default 80 |

### 6.3 Filter Form (History)
| Field | Type | Default |
|-------|------|---------|
| Date From | date | 1st of current month |
| Date To | date | today |
| Categories | multi-select | all |
| Outlet | select | current outlet |
| Status | radio (All/Approved/Pending) | All |
| Search | text | empty |

---

## 7. Functions (Business Logic)

### 7.1 Core Functions (callable)
```typescript
// createExpense.ts
async function createExpense(data, context) {
  assertAdmin(context);
  const { date, categoryId, amount, description, receiptUrls } = data;
  const outletId = context.auth.token.outletId; // from custom claims
  
  // Ceiling check
  const dayTotal = await getDayTotal(outletId, date);
  const ceiling = await getCeiling(outletId);
  if (dayTotal + amount > ceiling) {
    throw new HttpsError('permission-denied', 'CEILING_EXCEEDED', { ceiling, dayTotal });
  }
  
  // Write
  const ref = db.ref(`expenses`).push();
  await ref.set({
    amount,
    categoryId,
    categoryName: (await getCategory(categoryId)).name,
    date,
    description: description || '',
    receiptUrls: receiptUrls || [],
    outletId,
    status: amount <= AUTO_APPROVE_THRESHOLD ? 'approved' : 'pending',
    approvedBy: amount <= AUTO_APPROVE_THRESHOLD ? context.auth.uid : null,
    approvedAt: amount <= AUTO_APPROVE_THRESHOLD ? Date.now() : null,
    createdAt: Date.now(),
    createdBy: context.auth.uid,
  });
  return { expenseId: ref.key, createdAt: Date.now() };
}

// approveExpense.ts
async function approveExpense(data, context) {
  assertAdmin(context);
  const { expenseId, pin } = data;
  if (!await verifyManagerPin(pin, context.auth.uid)) {
    throw new HttpsError('permission-denied', 'INVALID_PIN');
  }
  await db.ref(`expenses/${expenseId}`).update({
    status: 'approved',
    approvedBy: context.auth.uid,
    approvedAt: Date.now(),
    editedAt: Date.now(),
    editedBy: context.auth.uid,
  });
  return { approvedAt: Date.now() };
}
```

### 7.2 Helper Functions
- `getDayTotal(outletId, date)` → sums `amount` for `date` + `outletId`.
- `getCeiling(outletId)` → reads from Discounts settings (already exists).
- `verifyManagerPin(pin, adminUid)` → uses existing void-PIN logic.
- `reassignCategoryExpenses(oldCatId, newCatId)` → batch update on category delete.

---

## 8. Usage Scenarios

### 8.1 Daily Expense Logging (Owner/Manager)
1. Opens **Expenses → Today**.
2. Taps category chip (e.g., "Utilities").
3. Enters amount (Rs. 12,500).
4. Adds memo ("Electricity bill Sep").
5. Uploads receipt photo (camera).
6. Taps **Log Expense** → toast "Expense logged".
7. Repeats for 5-10 items in < 2 minutes.

### 8.2 Month-End Review (Accountant)
1. Opens **Expenses → History**.
2. Sets date range to last month.
3. Filters by "Pending" status.
4. Sees 3 expenses > ceiling awaiting PIN.
4. Taps **Bulk Approve**, enters manager PIN → all approved.
5. Exports **Monthly Summary PDF** → emails to owner.

### 8.3 Category Budget Alert
1. System runs nightly Cloud Function.
2. For each category with `monthlyBudget`, computes month-to-date spend.
3. If spend > `alertThreshold%`, creates notification in `notifications` collection.
4. Admin sees badge on **Expenses** tab; taps to view **Reports → Category Breakdown**.

### 8.4 Receipt Audit
1. During tax prep, accountant opens **History**.
2. Filters by category "Supplies", date range FY.
3. Clicks receipt icons → views full-screen images.
4. Exports selected rows CSV for CA.

---

## 9. Integration Points

| System | Integration |
|--------|-------------|
| **Discount Ceiling** | Reads `ceilingPercent`/`ceilingAmount` from Discounts config; blocks or PIN-gates expenses exceeding daily limit. |
| **Void PIN** | Reuses `verifyManagerPin()` for approval workflow. |
| **Image Conversion** | Uses `/api/images/convert` (Sharp) for receipt pre-conversion; falls back to base64. |
| **Notifications** | Budget alerts → `notifications` collection; FCM to admin devices. |
| **Audit Log** | All writes/edits/deletes emit to `/auditLogs/expenses/{logId}` with `{action, before, after, by, at}`. |
| **Soft Delete** | Mirrors restaurant soft-delete: `deletedAt`/`deletedBy`; excluded from reports unless `includeDeleted=true`. |
| **PDF/Excel Export** | Reuses `downloadCustomerPDF/Excel` patterns; report-specific formatters. |

---

## 10. Validation Rules

| Rule | Location | Error Message |
|------|----------|---------------|
| Amount > 0 | Client + Server | "Amount must be greater than zero." |
| Date ≤ today | Client + Server | "Cannot log future expenses." |
| Category exists | Server | "Invalid category." |
| Receipt required if amount > threshold | Client + Server | "Receipt required for expenses above Rs. X." |
| Ceiling exceeded → PIN required | Server | "Daily ceiling exceeded. Manager PIN required." |
| PIN valid | Server | "Invalid manager PIN." |
| Category name unique | Server | "Category already exists." |
| Budget ≥ 0 | Client + Server | "Budget cannot be negative." |
| Alert threshold 0-100 | Client | "Threshold must be between 0 and 100." |

---

## 11. Edge Cases

| Scenario | Handling |
|----------|----------|
| Offline admin dashboard | Queue locally (IndexedDB); sync on reconnect; show pending badge. |
| Multi-outlet admin | Outlet filter in History; Today defaults to current outlet; switcher in header. |
| Category deleted with existing expenses | Block delete; force reassign or archive category (soft-delete). |
| Receipt upload fails | Retry 2x; on final failure, log expense without receipt; flag in audit. |
| Ceiling config changed mid-day | Re-evaluate on next submit; past expenses unchanged. |
| Manager PIN changed | Invalidate cached PIN; re-prompt on next approval. |
| Large receipt images (> 2 MB) | Auto-resize via Sharp; reject if still > 2 MB after compression. |
| Concurrent edits | Last-write-wins with `editedAt`; show toast "Changes saved by another user" if stale. |

---

## 12. UI/UX Consistency (Per Existing Patterns)

- **Color palette**: Brand `#E84908` for primary actions; category colors from seeded palette.
- **Typography**: Inter (already loaded); headings 18px bold, body 14px.
- **Spacing**: 8px base unit; cards 16px padding; modals 24px.
- **Icons**: Lucide (already in bundle); expense tab = `dollar-sign`, receipt = `file-image`, approved = `check-circle`.
- **Toasts**: Use existing `showToast()` queue (`_toastQueue` FIFO).
- **Loading states**: Skeleton rows in History; button spinner on submit.
- **Accessibility**: All forms keyboard-navigable; ARIA labels; color contrast ≥ 4.5:1.

---

## 13. Testing Checklist

| Test | Type |
|------|------|
| Create expense with all fields | E2E (Playwright) |
| Create expense exceeding ceiling → PIN prompt | E2E |
| Edit expense → audit log entry | Unit + E2E |
| Soft-delete expense → excluded from reports | Unit |
| Category budget alert triggers notification | Unit (Cloud Function) |
| CSV export matches table data | E2E |
| PDF export renders correctly (branding, totals) | Visual (Chromium) |
| Multi-outlet filter works | E2E |
| Receipt upload + conversion | E2E |
| Offline queue sync | Integration |

---

## 14. Deployment Steps

1. **Deploy callable functions** (`createExpense`, `approveExpense`, etc.) → `firebase deploy --only functions`.
2. **Deploy database rules** (expenses read/write gated by admin + outlet) → `firebase deploy --only database`.
3. **Build Admin** (`node tools/build.mjs --admin`) → includes new `Expenses` tab JS/CSS.
4. **Deploy Admin hosting** (`firebase deploy --only hosting:admin`).
5. **Seed default categories** via script (`tools/seed-expense-categories.cjs`).
6. **Verify** in staging: log expense, approve, export report.

---

## 15. Future Enhancements (Post-MVP)

- **Split expense across outlets** (single receipt, multiple outlet allocations).
- **Recurring expenses** (monthly rent, subscriptions) with auto-create.
- **Vendor management** (link expenses to vendor master data).
- **Approval workflow** (dual-manager, email/WhatsApp notification).
- **Mobile app** (rider/owner quick-capture via camera).
- **Integration with accounting** (Tally, Zoho Books export).

---

*This document serves as the single source of truth for the Expenses feature. Implementation should follow the exact data model, API contracts, and UI patterns specified above.*
