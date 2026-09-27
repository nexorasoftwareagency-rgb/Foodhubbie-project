# Manager PIN & Discount Approval Ceiling — User Manual

Covers the two gates shipped together:

| Gate | What it protects | Where |
|---|---|---|
| **Approval ceiling** | Human-typed discounts above a set **% of the bill** | Table bills (`Confirm Payment`) and POS walk-in sales (`Record Sale`) |
| **Void PIN** | Every payment void | Table card → `Void Payment` |

Both use the **same Manager PIN**, both fail **open** by design (see [§10](#10-limitations-you-must-know)).

> **Worked example used throughout:** ceiling = **15%**, bill subtotal = **₹1,000**.

---

## 1. What this feature does

A **manual discount** is one a staff member types in by hand (an amount or a percentage), as opposed to a coupon, a first-order offer, or a category offer that the system applies on its own.

Before this feature, a staff member could type `900` off a `1,000` bill and nothing asked a second person. Now:

- discounts **at or below** the ceiling → no change, nothing asked
- discounts **above** the ceiling → a manager must type the PIN before the payment goes through
- **every void** (money already taken, being given back) → the manager must type the PIN

Every approval is written to the audit log with who approved it.

---

## 2. What this is NOT

| | Ceiling / Manager PIN | **Max cap** (already existed) |
|---|---|---|
| Where | Settings tab → *Discount Approval* | Discount editor → *Max cap (₹, optional)* |
| Applies to | **Manual** discounts only, at settlement | **Auto** discounts (coupons, offers), per definition |
| Question it answers | "Is a *person* allowed to give this much away?" | "How much can *this one offer* ever give away?" |
| Unit | % of the bill | flat ₹ |

They are independent. An auto discount can be capped by **Max cap** and still never ask for a PIN. A manual discount is never bounded by **Max cap**.

---

## 3. Where the settings live

**Admin app → Settings tab → *Discount Approval* group** (directly below *Delivery Security*).

```
Discount Approval
├── Approval Ceiling (% of bill)   [ e.g. 15 ]
└── Manager PIN                    [ •••• ]
```

Then press **Save Settings**.

**Important:** settings are **per outlet**. Each outlet has its own ceiling and its own PIN, stored at:

```
businesses/{businessId}/outlets/{outletId}/settings/Security/
├── discountCeilingPct   e.g. 15
└── pinHash              e.g. 2bb80d537b1da3e38bd30361aa35775aa0e7f9fb...
```

Only the **hash** of the PIN is stored — never the PIN itself. Only admins can read this node (riders cannot).

---

## 4. Configuring it — every save outcome

Press **Save Settings** with the *Discount Approval* fields filled as follows:

| Ceiling field | PIN field | Result |
|---|---|---|
| `15` | `4711` | Saved. Ceiling 15%, PIN set. Gate active. |
| `15` | *(blank)* | Ceiling saved as 15. **Existing PIN kept** — a blank field never wipes it. |
| `0` | `4711` | Ceiling saved as 0 → ceiling **off**. PIN still stored, still required for voids. |
| *(blank)* | *(blank)* | Ceiling saved as 0 (blank → 0), PIN unchanged. Feature off for discounts. |
| `150` | `4711` | Clamped to **100**. Never stored above 100. |
| `-5` | `4711` | Clamped to **0**. |
| `15` | `123` | **Rejected** → toast *"Manager PIN must be 4 to 12 digits."* **Nothing is saved** (not even the ceiling). |
| `15` | `1234567890123` | **Rejected** → same toast, too many digits. Nothing saved. |
| `15` | `abcd` | **Rejected** → same toast, digits only. Nothing saved. |
| `15` | `4711` on **non-HTTPS** | **Rejected** → toast *"PIN could not be hashed — the app must run over HTTPS."* Nothing saved. |

**Changing the PIN:** type a new 4–12 digit number into the field and Save. The placeholder tells you the current state:

- `PIN set — enter a new one to change it` → a PIN exists
- `e.g. 4711` → no PIN exists yet

---

## 5. How the ceiling is calculated

```
discount % = discount ÷ subtotal × 100
PIN required  ⇔  ceiling > 0  AND  subtotal > 0  AND  discount % > ceiling
```

With **ceiling = 15%** and **subtotal = ₹1,000**:

| You apply | Amount | % of bill | PIN asked? | Why |
|---|---|---|---|---|
| Manual ₹50 | ₹50 | 5% | No | below ceiling |
| Manual ₹150 | ₹150 | 15.0% | **No** | *exactly* at ceiling — the test is strictly `>` |
| Manual ₹151 | ₹151 | 15.1% | **Yes** | first value above ceiling |
| Manual ₹500 | ₹500 | 50% | **Yes** | above ceiling |
| Percent 10% | ₹100 | 10% | No | below ceiling |
| Percent 15% | ₹150 | 15% | No | exactly at ceiling |
| Percent 16% | ₹160 | 16% | **Yes** | above ceiling |
| Coupon ₹300 (auto) | ₹300 | 30% | **No** | auto discounts are never gated |
| First-order 20% (auto) | ₹200 | 20% | **No** | auto discounts are never gated |
| Category 25% (auto) | ₹250 | 25% | **No** | auto discounts are never gated |
| Manual ₹900, ceiling `0` | ₹900 | 90% | **No** | ceiling disabled |
| Any discount, subtotal ₹0 | — | — | **No** | zero bill, nothing to approve |

Different bill size, same ceiling — the ceiling is a **percentage, not a flat amount**:

| Subtotal | Ceiling 15% | PIN needed above |
|---|---|---|
| ₹200 | 15% | ₹30.01 |
| ₹1,000 | 15% | ₹150.01 |
| ₹10,000 | 15% | ₹1,500.01 |

---

## 6. Discount gate — every possible outcome

Triggered from two places, both automatic:

- **Table bill** → you click **Confirm Payment**
- **POS walk-in** → you click **Record Sale**

### 6.1 Outcomes before any PIN is shown

| # | Situation | What you see | Does the payment proceed? |
|---|---|---|---|
| 1 | Discount is **auto** (coupon, first-order, global, category offer) | nothing | **Yes** — gate skipped entirely, no settings read |
| 2 | Manual discount, ceiling = **0** (or blank) | nothing | **Yes** — ceiling off |
| 3 | Manual discount **at or below** ceiling | nothing | **Yes** |
| 4 | Discount is 0 (nothing applied) | nothing | **Yes** |
| 5 | Settings can't be read (offline, permission) | browser console warning | **Yes** — fail open |
| 6 | Manual discount **above** ceiling | PIN prompt (see 6.2) | depends on 6.2 |

### 6.2 Outcomes once the PIN prompt is shown

The prompt reads **"Manager Approval"**, has a password field and two buttons: **Cancel** and **Approve**. It also states what you are approving:

> **This 15.1% discount is above the 15% approval ceiling.**

The percentage is rounded to one decimal place, so ₹151 off a ₹1,000 bill shows `15.1` and ₹500 off shows `50.0`. The ceiling is the value saved in Settings.

| # | You do | What you see | Result |
|---|---|---|---|
| 7 | Type the correct PIN, press **Approve** (or **Enter**) | prompt closes | **Payment proceeds.** Audit entry `discount.pin.approved` written with who approved it, the discount, the subtotal and the ceiling. |
| 8 | Type a **wrong** PIN, press **Approve** | toast *"Incorrect manager PIN. Try again."*; prompt closes and **reopens** | **Nothing happens.** Try again or cancel. |
| 9 | Type wrong PIN several times, then the right one | wrong → toast each time, then proceeds | **Payment proceeds** on the correct attempt. |
| 10 | Press **Cancel** | prompt closes | **Payment aborted.** Nothing is written. The bill review / cart stays exactly as it was. |
| 11 | Press **Escape** | prompt closes | Same as Cancel — aborted. |
| 12 | Click **outside** the prompt | prompt closes | Same as Cancel — aborted. |
| 13 | Press **Approve** with an **empty** field | prompt closes | Same as Cancel — **aborted** (an empty field is not a PIN). |
| 14 | Press **Enter** with an empty field | nothing happens | Prompt stays open. |
| 15 | Ceiling is on but **no PIN has ever been set** | toast *"Manager PIN is required for this action but none is set — configure it in Settings."* | **Yes** — fail open, so a half-configured setup never blocks billing. |
| 16 | Browser lacks crypto (site opened over plain `http://` IP) | console warning | **Yes** — fail open. |

### 6.3 After you approve

**Table bill:** the payment-method step follows. If you approve the PIN but then don't select a payment method, nothing is written and you will be asked for the PIN **again** the next time you click *Confirm Payment* — approval is not cached.

**POS:** the order is written immediately. If you cancel the PIN, **your cart is preserved** — nothing is cleared, you can adjust the discount and try again.

---

## 7. Void gate — every possible outcome

Reachable from all four entry points — the table card button, the table drawer button, the delegated action and the `window.__tables` export — but they all run **one** function, so the gate applies to every void.

Flow: click **Void Payment** → confirmation dialog → **PIN prompt**. The prompt states what you are authorising:

> **Authorise voiding this table bill. This cannot be undone.**

For a split/group bill the same message reads `group bill` instead of `table bill`.

| # | You do | Result |
|---|---|---|
| 1 | Click **Void Payment**, then **Cancel** on the confirmation | Nothing happens. No PIN asked. |
| 2 | Confirm, then type the **correct** PIN | **Void executes.** Orders revert to *Served*, discount usage is reverted. Audit entry `void.pin.approved` written with the table and group. |
| 3 | Confirm, then type a **wrong** PIN | toast *"Incorrect manager PIN. Try again."*, prompt reopens. Nothing changed. |
| 4 | Confirm, then **Cancel** / **Esc** / click outside / empty **Approve** | **Void aborted.** Payment stays void-free, orders untouched. |
| 5 | Confirm, but **no PIN is set** | toast *"Manager PIN is required for this action but none is set — configure it in Settings."* → **void proceeds** (fail open). |
| 6 | Confirm, settings unreadable | console warning → **void proceeds** (fail open). |

The confirmation dialog comes **first**, so you always know what you are authorising before you are asked for the PIN.

---

## 8. Every message you can see

| Message | Level | Meaning | What to do |
|---|---|---|---|
| `Manager PIN is required for this action but none is set — configure it in Settings.` | warning (5s) | Ceiling or void gate is on but no PIN exists | Set a PIN in Settings → *Discount Approval* |
| `Incorrect manager PIN. Try again.` | error (3s) | Wrong PIN typed | Re-enter, or cancel |
| `Manager PIN must be 4 to 12 digits.` | error | PIN field had a bad value on save | Use 4–12 digits only |
| `PIN could not be hashed — the app must run over HTTPS.` | error | Browser refused crypto on insecure origin | Open the app over `https://` |
| `Processing...` (POS button) | spinner | Sale is running — including the PIN prompt | Cancel the prompt to stop |
| Browser console: `approval settings unreadable` | console | `settings/Security` couldn't be read | Check connection/rules; action fails open |
| Browser console: `PIN hashing unavailable — failing open` | console | `crypto.subtle` missing | Use HTTPS |

---

## 9. The audit trail

Every successful approval writes one row to `businesses/{businessId}/outlets/{outletId}/logs/audit`:

| Field | Discount approval | Void approval |
|---|---|---|
| `action` | `discount.pin.approved` | `void.pin.approved` |
| `uid` | who typed the PIN | who typed the PIN |
| `adminEmail` | their email | their email |
| `outlet` | outlet id | outlet id |
| `timestamp` | server time | server time |
| `details.discountValue` | e.g. `151` | — |
| `details.subtotal` | e.g. `1000` | — |
| `details.ceilingPct` | e.g. `15` | — |
| `details.tableId` | — | e.g. `t1` |
| `details.groupId` | — | group id, or `session` |

Failed attempts are **not** logged (only the approval is), so the trail stays readable.

---

## 10. Limitations you must know

1. **This is not a security boundary.** There are no Cloud Functions on this plan, so the PIN is checked **inside the browser**. Anyone who opens devtools can bypass it. Treat it as *accountability* — you will see who approved what — not as protection against someone determined to bypass it.
2. **The stored hash can be cracked.** A 4-digit PIN has only 10,000 combinations; the SHA-256 hash stops casual shoulder-surfing of the database, not a determined attacker who can read it. Longer PINs (up to 12 digits) are meaningfully better.
3. **Fail open is deliberate.** Unreadable settings, no PIN configured, or no crypto all **allow the action** with a warning. The reason: a misconfigured ceiling must never stop a restaurant from taking payment mid-service. The flip side — if you never set a PIN, the ceiling does nothing.
4. **Set both fields, or neither.** A ceiling with no PIN is a warning on every large discount and no actual control.
5. **Per outlet.** Changing the PIN on one outlet does not change it on another.
6. **Not live-tested.** Verified by unit checks, build and static inspection; not exercised end-to-end against a live database.

---

---

# Expenses Module — User Manual

The **Expenses** module lets restaurant admins log, categorize, track, and report on business expenses (rent, utilities, payroll, supplies, etc.). It lives in the Admin dashboard as a top-level tab with five sub-tabs.

## 1. Overview & Navigation

**Location:** Admin dashboard → **Expenses** tab (💰 icon) in the left sidebar.

**Sub-tabs:**

| Sub-tab | Purpose |
|---------|---------|
| **Today** | Rapid entry for today's expenses; live category totals |
| **History** | Filterable history with date range, category, status, search |
| **Categories** | Manage expense categories, budgets, alert thresholds |
| **Reports** | Charts & tables: monthly, category, outlet, trends; export CSV/PDF |
| **Settings** | Auto-approve threshold, receipt threshold, currency, retention, workflow |

## 2. Top Bar Controls

**Located at the top-right of the Expenses tab header:**

- **Sub-tab pills** — Today / History / Categories / Reports / Settings
- **Add Expense (+)** — opens the Add Expense modal
- **Categories** — shortcut to Categories modal
- **Export Excel / Export PDF** — exports the currently visible data (filtered by sub-tab)
- **Manual (book icon)** — opens this manual at the Expenses section

## 2. Today — Rapid Entry

Fast logging for today's expenses with live totals.

**Header:** Shows today's date and **TOTAL TODAY** amount.

**Category chips:** Horizontal scrollable chips showing each category with its color/icon. Each chip shows the category's total for today. Tap "+ Add new" to create a new category inline.

**Form fields:**
- **Date** — defaults to today (cannot pick future dates)
- **Category** — dropdown from your categories list
- **Amount** — Rs. formatted number pad (step 0.01)
- **Description** — optional, max 200 chars
- **Receipt** — optional image/PDF upload (max 3 files, 2 MB each)

**Submit** — logs expense, clears amount for rapid re-entry, focuses amount for next entry

**Ceiling guard:** If the day's total + new amount exceeds the **discount ceiling %** of today's projected revenue, a Manager PIN is required before saving.

## 2. History — Browse & Filter

**Filter bar (sticky):** Date range (From/To), Category multi-select, Outlet dropdown, Status (All/Approved/Pending), Search box.

**Table columns:** Date | Category | Description | Amount | Outlet | Receipt (icon) | Status (badge) | Actions (Edit/Delete).

**Row actions:** Edit (opens pre-filled modal), Delete (soft-delete with confirmation), View Receipt (opens full-screen preview).

**Bulk actions:** Select multiple rows → Bulk Approve (requires PIN), Bulk Delete, Export Selected.

## 3. Categories — Master Data

**List view:** Name, color, icon, monthly budget, alert threshold %.

**Add/Edit modal fields:**
- Name (required, unique)
- Color picker (brand palette)
- Icon selector (Lucide icons: zap, home, truck, wrench, credit-card, utensils, wifi, dollar-sign)
- Monthly budget (optional, in Rs.)
- Alert threshold % (default 80%)

**System categories** (seeded, non-deletable): Rent, Utilities, Payroll, Supplies, Marketing, Maintenance, Misc.

**Drag-to-reorder** for display priority.

## 4. Reports — Analytics

Four report cards with Chart.js charts and exportable tables:

1. **Monthly Summary** — Bar chart (Actual vs Budget) + table: Month | Total | Budget | Variance
2. **Category Breakdown** — Doughnut chart + table: Category | Amount | % of Total | Budget | Alert status (Over Budget / On Track)
3. **Outlet Comparison** — Horizontal bar chart + table: Outlet | Total | This Month | Last Month
4. **Trend Lines** — Line chart of daily spend over selected range

**Export:** Each report has **CSV** and **PDF** buttons (top-right of Reports sub-tab).

## 4. Settings — Global Config

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-approve Threshold | Rs. 5,000 | Expenses ≤ this amount auto-approve; above requires Manager PIN |
| Require Receipt Above | Rs. 1,000 | Receipt upload required for expenses above this amount |
| Default Currency Display | Rs. | Choose Rs. or ₹ symbol |
| Retention Policy (days) | 90 | Days to keep soft-deleted expenses |
| Approval Workflow | Single Manager PIN | Single or Dual Manager PIN (future) |

All settings are saved to `businesses/{bid}/outlets/{oid}/settings/Expenses` and are per-outlet.

## 5. Receipt Handling

- Receipts are converted to **base64 data URLs** client-side and stored directly in the expense record under `receiptUrls[]` array.
- **No Firebase Storage** - receipts live in Realtime Database as base64 strings.
- Supported: JPG, PNG, PDF (max 2 MB each, max 3 per expense).
- Click the 📎 receipt icon in any table → opens **Receipt Preview modal** (full-screen, zoomable).
- Modal has a **Download** button (downloads the base64 as PNG).

## 5. Ceiling Integration

The expense ceiling shares the **Discount Approval ceiling** from Settings → Discount Approval:

- Before saving an expense, the system checks: `dayTotal + newAmount > ceiling% × projectedRevenue`
- If exceeded → Manager PIN required (same PIN as discount/void gates).
- Auto-approve threshold (Settings → Expenses) bypasses PIN for small expenses.

## 6. Export — CSV & PDF

- **Excel:** SheetJS export with columns: Date, Category, Description, Amount, Outlet, Receipt, Status
- **PDF:** Branded report with hero gradient, KPI cards (Total Expenses, Total Entries, Avg Expense), section label, ink-header table, warm zebra rows, Grand Total footer row, Page X of Y footer on every page, PDF metadata
- Available from: Main tab header (all data), Reports sub-tab (report-specific), Today/History tables (filtered data)

## 6. Soft Delete & Audit

- Deleting an expense → soft delete (`deletedAt`, `deletedBy`). Excluded from reports unless `includeDeleted=true`.
- All writes/edits/deletes emit to `/auditLogs/expenses/{logId}` with `{action, before, after, by, at}`.
- Category delete → reassigns expenses to "Misc" category before deleting.

## 7. Keyboard & Accessibility

- **Enter** in Add Expense modal amount field → submits form
- **Escape** in any modal → closes modal
- **Tab** navigation through all form fields
- ARIA labels on all buttons, inputs, and icons
- Color contrast ≥ 4.5:1 (WCAG AA)

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Categories not loading in dropdown | No categories created yet | Go to Categories sub-tab → "Seed Default Categories" or add manually |
| Receipt upload fails | File too large (>2MB) or unsupported type | Use JPG/PNG/PDF under 2MB |
| PIN prompt appears on small expense | Auto-approve threshold set too low | Increase Auto-approve Threshold in Settings |
| Ceiling PIN keeps appearing | Day total + new expense exceeds ceiling % of projected revenue | Check ceiling % in Settings → Discount Approval |
| Categories not showing in Reports | No expenses logged for those categories | Log at least one expense per category |
| PDF export missing branding | PDF lib not loaded | Refresh page; check console for errors |

---

## 11. Quick troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Never get asked for a PIN on a huge discount | Ceiling is `0`, or the discount is a coupon/offer rather than a manual one | Set a ceiling > 0; check the discount is typed in manually |
| Asked for a PIN on a small discount | Ceiling is set very low (e.g. `1`) | Raise the ceiling |
| *"…none is set…"* toast every time | Ceiling configured, PIN never saved | Save a 4–12 digit PIN |
| PIN rejected even though you typed it right | You changed it on a **different outlet** | Settings are per outlet |
| Settings won't save at all | Bad PIN value (too short/long/non-numeric) | Fix the PIN field — the whole save aborts on it |
| Approving the PIN then being asked again | Payment method wasn't selected before the PIN | Select the payment method, then confirm |

---

## 🔐 Staff Management Module — User Manual

The **Staff Management** module lets restaurant admins create, edit, and manage staff accounts with role-based access control.

## 1. Overview & Navigation

**Location:** Admin dashboard → **Settings** tab → **Staff Management** sub-tab.

**Features:**
- Create staff accounts with role-based permissions
- Email/password authentication via Firebase Auth
- Counter PIN for shift sign-in
- Discount ceiling per staff member
- Audit trail for all changes
- Soft delete with audit trail

## 1. Creating a Staff Account

**Steps:**
1. Go to Settings → Staff Management sub-tab
2. Click **"Add Staff"**
3. Fill in the form:
   - **Name** (required)
   - **Email** (required, unique per outlet)
   - **Phone** (optional)
   - **Role** — Owner, Manager, Cashier, Waiter, Kitchen, Rider
   - **Outlet** — assigned outlet
   - **Discount Ceiling %** — personal ceiling (0 = inherit outlet ceiling)
2. Click **Create Staff**
3. System creates Firebase Auth user + staff record
3. Temporary password generated and shown **once** — share securely
4. Staff receives welcome email with temporary password

**Validation:**
- Email must be unique per outlet
- Phone: 10 digits
- Role must be selected
- Outlet must be selected

## 2. Managing Staff

**List View:** Shows all staff with name, role, outlet, status, last signed in

**Actions per row:**
- **Edit** — change name, role, outlet, discount ceiling, status
- **Reset Counter PIN** — generates new 4-digit PIN, shows once
- **Disable/Enable** — toggle active status
- **Reset Password** — sends password reset email
- **View Audit Log** — shows all changes

**Role Permissions:**
| Action | Owner | Manager | Cashier | Waiter | Kitchen | Rider |
|--------|-------|---------|--------|--------|-------|
| Create Staff | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit Staff | ✅ | Own outlet | ❌ | ❌ | ❌ |
| Delete Staff | ✅ | Own outlet | ❌ | ❌ | ❌ |
| Reset Counter PIN | ✅ | Own outlet | ❌ | ❌ | ❌ |
| Change Discount Ceiling | ✅ | Own outlet | ❌ | ❌ | ❌ |
| Reset Password | ✅ | Own outlet | ❌ | ❌ | ❌ |
| View Audit Log | ✅ | Own outlet | ❌ | ❌ | ❌ |

## 3. Counter PIN Shift Sign-In

**Purpose:** Staff sign in for a shift using a 4-digit PIN instead of email/password.

**Flow:**
1. Staff clicks **"Start Shift"** on POS/Table app
2. Enters 4-digit PIN
3. System verifies against `counterPinIndex` (reverse index: hash → UID)
3. On success: stores `counterStaffUid` in sessionStorage, updates `lastSignedIn`
4. Shift active until **"End Shift"** clicked or browser closed

**Security:**
- PIN verified via reverse index (`counterPinIndex/{hash}` → UID) — no full scan
- Timing attack resistant (early exit on first match)
- Staff must be active (`isActive !== false`)
- PIN hash must match current `counterPinHash` in staff record
- Outlet validated: staff must belong to current outlet

**End Shift:**
- Clears `counterStaffUid` from sessionStorage
- Updates `lastSignedIn` timestamp
- Shows toast "Shift ended"

---

## 🔐 Security Audit Module — User Manual

The **Security Audit** module automatically checks your restaurant's security posture and provides one-click fixes.

**Location:** Admin → Settings → Security Audit sub-tab

### 1. Automated Checks

| Check | Severity | Description |
|-------|----------|-------------|
| Staff with no Counter PIN | Critical | Staff can't sign in for shifts |
| No Manager PIN configured | Critical | Ceiling/void gates non-functional |
| Staff with ceiling = 0 but role allows discounts | High | Cashiers/Managers can give unlimited discounts |
| Inactive staff > 90 days | Medium | Stale accounts |
| Multiple owners per outlet | High | Only one owner per outlet |

### 2. Automated Fixes

| Finding | Fix Action | What it does |
|---------|------------|--------------|
| Missing Counter PIN | **Set Counter PIN** | Generates 4-digit PIN, shows modal with PIN |
| Missing Manager PIN | **Set Manager PIN** | Opens Staff Management, focuses PIN field |
| Zero ceiling on discount role | **Set Outlet Ceiling** | Opens Staff Management, focuses ceiling field |
| Multiple owners | **Demote Extra Owners** | Shows list → confirm → demotes to Manager |

**All fixes require Manager PIN confirmation** (same PIN as discount/void gates).

---

## 📋 Security Audit Manual Verification Checklist

| Check | Status |
|-------|--------|
| All staff have Counter PIN | ☐ |
| Manager PIN configured | ☐ |
| No zero-ceiling discount roles | ☐ |
| Only one owner per outlet | ☐ |
| No stale active staff (>90 days) | ☐ |
| Audit log accessible | ☐ |

---

## 📋 Change Password — User Manual

**Location:** Settings → Security Audit tab → **Change Password** section

### How to change your password:

1. Go to **Settings** → **Security Audit** sub-tab
2. Scroll to **Change Password** section
3. Fill in:
   - **Current Password** — your current login password
   - **New Password** — minimum 8 characters
   - **Confirm New Password** — must match exactly
4. Click **Update Password**
5. System will:
   - Re-authenticate with current password
   - Update password in Firebase Auth
   - Clear all password fields
   - Show success toast

**Password Requirements:**
- Minimum 8 characters
- Must match confirmation field
- Real-time match indicator (green ✓ / red ✗)

**Security:** Requires re-authentication with current password before changing (Firebase requirement).

---

## 📋 Forgot Password Flow

**Location:** Login page → **"Forgot Password?"** link

1. Click **"Forgot Password?"** on login screen
2. Enter registered email address
3. Click **Send Reset Email**
4. Check email inbox (check spam folder)
4. Click reset link in email
5. Set new password (min 8 characters)
5. Return to login, sign in with new password

**Note:** Reset link expires in 1 hour. Link can only be used once.

---

## 📋 Forgot Counter PIN Flow

1. Go to POS / Tables app
2. Click **"Forgot PIN?"** on Counter PIN prompt
3. Enter registered email
3. System sends reset email with temporary PIN
4. Use temporary PIN to sign in
5. System prompts to set new PIN immediately

---

## 📋 Counter PIN Shift Sign-In — Quick Reference

| Action | Steps |
|--------|-------|
| **Start Shift** | Click "Start Shift" → Enter 4-digit PIN → System verifies via `counterPinIndex` reverse index → Stores `counterStaffUid` in sessionStorage → Updates `lastSignedIn` |
| **End Shift** | Click "End Shift" → Clears `counterStaffUid` from sessionStorage → Updates `lastSignedIn` timestamp |
| **Forgot PIN** | Click "Forgot PIN?" → Enter email → System sends reset email with temporary PIN → Sign in with temp PIN → Prompted to set new PIN |

**Security Notes:**
- PIN verified via reverse index (`counterPinIndex/{hash}` → UID) — O(1) lookup, no full scan
- Timing attack resistant (early exit on first match)
- Staff must be active (`isActive !== false`)
- PIN hash must match current `counterPinHash` in staff record
- Outlet validated: staff must belong to current outlet

---

## 📋 Forgot Password Flow

1. Click **"Forgot Password?"** on login page
2. Enter registered email address
3. Click **"Send Reset Email"**
4. Check email (check spam folder)
5. Click reset link in email (valid for 1 hour, single use)
6. Set new password (min 8 characters)
6. Return to login, sign in with new password

---

## 📋 Change Password (Logged In)

**Location:** Settings → Security Audit tab → **Change Password** section

1. Enter **Current Password**
2. Enter **New Password** (min 8 chars)
3. Enter **Confirm New Password** (must match)
4. Click **Update Password**
5. System re-authenticates with current password
5. Updates password in Firebase Auth
5. Clears all fields
5. Shows success toast

**Real-time match indicator:** Green ✓ when passwords match, red ✗ when they don't.

---

## 📋 Email Index & Counter PIN Index — Technical Details

### Email Index (`emailIndex/{hash}`)
- **Key:** SHA-256 hash of normalized email (lowercase, trimmed)
- **Value:** Staff UID
- **Uniqueness:** Enforced by Firebase Rules (write only if `!data.exists()`)
- **Write access:** Owner + Manager roles

### Counter PIN Index (`counterPinIndex/{hash}`)
- **Key:** SHA-256 hash of 4-digit PIN
- **Value:** Staff UID
- **Write access:** Owner + Manager roles
- **Read:** Admin + Outlet staff
- **Updated on:** PIN creation, PIN reset, staff disable/enable

---

## 📋 Budget Numbers — Rupees (Not Paise)

All budget amounts in the system are stored and displayed in **Rupees (₹)**, not paise.

| Category | Monthly Budget (₹) |
|----------|-------------------|
| Rent | 50,000 |
| Utilities | 10,000 |
| Payroll | 2,00,000 |
| Supplies | 5,000 |
| Marketing | 10,000 |
| Maintenance | 3,000 |
| Misc | 2,000 |

> **Note:** Earlier versions stored amounts in paise. All new code uses Rupees. The `fmtMoney()` formatter handles display.

---

## 📋 Quick Reference — Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Submit expense form | Enter (in amount field) |
| Close any modal | Escape |
| Next field | Tab |
| Previous field | Shift + Tab |
| Open Forgot Password | F (on login page) |
| Open Add Expense | Ctrl/Cmd + E (Expenses tab) |
| Open Settings | Ctrl/Cmd + , |
| Close modal | Escape |

---

## 📋 Quick Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Manager PIN required but none set" | Ceiling > 0 but no PIN saved | Set PIN in Settings → Discount Approval |
| "Incorrect manager PIN" | Wrong PIN entered | Re-enter or Cancel |
| "PIN could not be hashed" | Running on HTTP, not HTTPS | Use `https://` or `localhost` |
| Categories not in dropdown | None created yet | Go to Categories sub-tab → "Seed Default Categories" |
| Receipt upload fails | File > 500KB or wrong type | Use JPG/PNG/PDF under 500KB |
| Ceiling PIN on small expense | Auto-approve threshold too low | Increase threshold in Settings → Expenses |
| PDF export missing branding | Chart.js not loaded | Refresh page, check console |
| Categories missing in Reports | No expenses in that category | Log at least one expense per category |
| Ceiling PIN keeps appearing | Day total + new expense > ceiling% of projected revenue | Check ceiling % in Discount Approval settings |

---

## 📋 Blaze Plan Features (Future)

> **Note:** These features require Firebase Blaze plan (pay-as-you-go) and Cloud Functions. They are **not available on the free Spark plan** but are designed for future migration.

| Feature | Description | Files to Modify |
|---------|-------------|-----------------|
| **Custom Claims for Roles** | Server-side role tokens via Cloud Functions | `functions/src/auth-triggers.ts`, `staff-management.js` |
| **Server-side PIN Verification** | PIN checked in Cloud Function, not browser | `functions/src/pin-verification.ts` |
| **Server-side Expense Ceiling** | Ceiling enforced in Cloud Function | `functions/src/expense-ceiling.ts` |
| **OTP Rate Limiting** | Rate limit per phone/IP in Cloud Function | `functions/src/otp-rate-limit.ts` |
| **Custom Claims Sync** | Sync role changes to Custom Claims | `functions/src/auth-triggers.ts` |

> **Migration Path:** When upgrading to Blaze plan, deploy Cloud Functions, update database rules to use `auth.token.claims.role`, and remove client-side PIN/ceiling checks.

---

*End of Manual — Last updated: 2026-09-27 | Version 5.3.6*