# Final Verification Plan — FoodHubbie Admin (Spark Plan)

**Version:** 1.0  
**Environment:** `https://foodhubbie-admins.web.app` (Production)  
**Date:** 2026-09-27  
**Plan Version:** Spark Plan (Free Tier) — Blaze features documented in `FUTURE-PLAN-BLAZE.md`

---

## 🎯 Verification Scope

Verify **all production functionality** on Spark plan. Each test case includes:
- **Steps** to reproduce
- **Expected Result**
- **Pass/Fail** column
- **Notes** for edge cases

---

## ✅ Pre-Deployment Checks

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `npm run build` passes | ✅ | Run `node tools/build.mjs --admin` - PASSED |
| 2 | `firebase deploy --only database` succeeds | ✅ | Rules syntax valid |
| 3 | `firebase deploy --only hosting:admin` succeeds | ✅ | Hosting upload complete |
| 4 | `firebase deploy --only database` succeeds | ✅ | Rules released |
| 5 | No console errors on `https://foodhubbie-admins.web.app` | ✅ | Verified - no errors in console |
| 6 | Login works (valid credentials) | ✅ | Tested with valid admin |
| 2FA not required on Spark | ✅ N/A | Custom Claims need Blaze |

---

## 🔐 Authentication & Access Control

### 1. Login Flow
| Step | Action | Expected | Pass/Fail |
|------|--------|----------|-----------|
| 1 | Navigate to `https://foodhubbie-admins.web.app` | Login page loads | ☐ |
| 2 | Enter valid email/password | Redirect to dashboard | ☐ |
| 3 | Enter invalid credentials | Error toast: "Incorrect email or password" | ☐ |
| 3 | Enter non-existent email | "No account found with this email" | ☐ |
| 4 | Enter wrong password | "Incorrect password" | ☐ |
| 4 | Enter invalid email format | "Please enter a valid email address" | ☐ |
| 5 | Click "Forgot Password?" | Prompt for email → "Password reset email sent!" | ☐ |
| 4 | Receive reset email | Email received with valid link | ☐ |
| 4 | Click reset link | Password reset page loads | ☐ |
| 5 | Set new password | "Password updated successfully" | ☐ |
| 6 | Login with new password | Success | ☐ |

**Session Persistence:**
| Test | Expected |
|------|----------|
| Refresh page (F5) | Stay logged in |
| Close tab, reopen | Stay logged in (browserLocalPersistence) |
| Close browser, reopen | Stay logged in |
| Sign out → login again | Works |

### 2. Role-Based Access (Spark: DB Rules + Client Check)
| Role | Can Access | Cannot Access |
|------|------------|---------------|
| Supreme Admin | All outlets, all tabs | Nothing |
| Super Admin | All outlets, all tabs | Nothing |
| Owner (outlet) | Own outlet only | Other outlets, Supreme tab |
| Manager | Own outlet, limited tabs | Settings, Security Audit |
| Staff (Rider) | Rider app only | Admin panel |

**Test Matrix:**
| User | Email | Outlet | Expected Tabs Visible |
|------|-------|--------|----------------------|
| Supreme | nexorasoftware@gmail.com | All | All |
| Super | roshanisudha@gmail.com | pizza, cake | All |
| Owner | owner@pizza.com | pizza | Dashboard, Orders, Tables, Inventory, Expenses, Reports, Riders, Customers, Chat, Feedback, Payments, Settings (no Staff Mgmt, Security Audit) |
| Manager | mgr@pizza.com | pizza | POS, Tables, Orders, Expenses, Inventory, Reports, Customers, Chat, Feedback, Payments |
| Rider | rider@test.com | N/A | Rider app only |

---

## 💰 Expenses Module

### 1. Today Tab — Rapid Entry
| Step | Action | Expected |
|------|--------|----------|
| 1 | Open Expenses → Today | Shows today's date, TOTAL TODAY amount |
| 2 | Select category (Utilities) | Chip highlighted |
| 3 | Enter amount (12500) | Shows ₹12,500 |
| 4 | Add description | "Electricity bill - September" |
| 5 | Upload receipt (1.5MB JPG) | "Receipt attached" toast, icon appears |
| 6 | Click "Log Expense" | Toast "Expense logged", form clears |
| 6 | Verify in table | Row appears with correct data |
| 7 | Total Today updates | Amount increments |

**Ceiling Guard Test:**
| Setup | Ceiling | Today's Total | New Expense | Expected |
|-------|---------|---------------|-------------|----------|
| Ceiling 15% | 15% | ₹12,000 | ₹4,000 | PIN prompt (exceeds ₹15,000) |
| Ceiling 15% | 15% | ₹10,000 | ₹3,000 | Auto-approve (no PIN) |
| Ceiling 0% | 0% | Any | Any | No PIN ever |

### 2. History Tab — Filter & Bulk Actions
| Filter | Test | Expected |
|--------|------|----------|
| Date From/To | Sep 1 - Sep 30 | Only Sept expenses |
| Category | Utilities | Only Utilities rows |
| Status | Pending | Only pending rows |
| Search "Electric" | Matches "Electricity" | Rows filtered |
| Bulk select 3 rows | Click "Bulk Approve" | PIN prompt → all approved |
| Bulk delete | Select rows → Delete | Soft delete, toast "X expenses deleted" |

### 3. Categories Management
| Action | Expected |
|--------|----------|
| Add "Equipment Rental" (orange, 🔧, ₹15,000 budget) | Appears in list, available in Today dropdown |
| Edit "Utilities" budget 10000→15000 | Updated in list, Reports reflect new budget |
| Delete "Old Marketing" (has expenses) | Confirm → expenses reassigned to "Misc" |
| Drag "Misc" to bottom | Order persists |

### 4. Reports
| Report | Verify |
|--------|--------|
| Monthly Summary | Bar chart (Actual vs Budget), table with variance |
| Category Breakdown | Doughnut chart + table with % and budget status |
| Outlet Comparison | Horizontal bars, table with This/Last Month |
| Trend Lines | Daily line chart |
| Export CSV | File downloads, correct data |
| Export PDF | Branded PDF with charts, KPI cards, grand total |

### 5. Settings
| Setting | Test |
|---------|------|
| Auto-approve threshold ₹5,000 → ₹10,000 | Expenses ≤ ₹10k auto-approve |
| Receipt threshold ₹1,000 → ₹2,000 | Expenses >₹2k require receipt |
| Currency "Rs." → "₹" | All displays use ₹ |
| Retention 90 → 180 days | Soft-deleted retained longer |
| Workflow "Single" → "Dual" | (Future) Dual PIN not implemented |

### 6. Ceiling Integration (Discount Ceiling)
| Scenario | Ceiling | Today's Expenses | New Expense | Expected |
|----------|---------|------------------|-------------|----------|
| Ceiling 15% | 15% | ₹12,000 | ₹4,000 | PIN required |
| Ceiling 15% | 15% | ₹10,000 | ₹3,000 | Auto-approve |
| Ceiling 0% | 0% | Any | Any | No PIN ever |

### 7. Receipt Handling
| Test | Expected |
|------|----------|
| Upload 1.5MB JPG | "Receipt attached" |
| Upload 3MB PNG | "File too large (>500KB)" |
| Upload PDF | Works (base64) |
| Click 📎 in table | Preview modal opens |
| Download in preview | Downloads as PNG |

### 8. Soft Delete & Audit
| Action | Verify |
|--------|--------|
| Delete expense | Soft delete (`deletedAt` set) |
| Expense in History | Hidden from table |
| Export CSV | Deleted expenses excluded |
| Audit log | Entry with `action: 'expense_delete'` |

---

## 👥 Staff Management

### 1. Create Staff
| Step | Expected |
|------|----------|
| Name "Rajesh Kumar" | Required |
| Email "rajesh@test.com" | Valid email |
| Phone "9876543210" | 10 digits |
| Role "Manager" | Dropdown |
| Outlet "pizza" | Selected |
| Click "Create" | Toast "Staff account created", temp password shown |
| Verify in table | Row appears with role "Manager" |
| Auth user created | Check Firebase Auth console |

### 2. Edit Staff
| Action | Expected |
|--------|----------|
| Click ✏️ on row | Modal opens with current data |
| Change role to "Manager" | Save → Toast "Staff updated" |
| Change outlet | Dropdown shows available outlets |
| Change password | "Reset Password" → email sent |

### 3. Role Permissions (Spark: Client + Rules)
| Actor | Can Create Staff | Can Edit Staff | Can Delete Staff | Can Reset PIN |
|-------|-----------------|---------------|-----------------|--------------|
| Supreme | ✅ All | ✅ All | ✅ All | ✅ All |
| Super | ✅ All | ✅ All | ✅ All | ✅ All |
| Owner | Own outlet | ✅ Own | ❌ | ✅ Own |
| Manager | ❌ | ❌ | ❌ | ❌ |

### 3. Counter PIN Shift Sign-In
| Step | Expected |
|------|----------|
| Click "Start Shift" | Modal "Enter 4-digit Counter PIN" |
| Enter correct PIN | Toast "Shift started", sessionStorage set |
| Enter wrong PIN | "Invalid Counter PIN" |
| End shift | "Shift ended. Counter PIN cleared." |
| Counter PIN in sessionStorage | `counterStaffUid` set |
| Discount ceiling | Uses counter staff's ceiling |

---

## 🔐 Security Audit

### 1. Run Audit
| Step | Expected |
|------|----------|
| Click "Re-check" | Spinner → findings populate |
| Critical count | Red badge |
| High count | Orange badge |
| Medium count | Yellow badge |
| Low count | Blue badge |
| Findings list | Expandable cards with fix buttons |

### 2. Auto-Fix Actions
| Finding | Fix Action | Expected |
|---------|------------|----------|
| Missing Counter PIN | "Set Counter PIN" | Generates 4-digit PIN, shows modal |
| Missing Manager PIN | "Set Manager PIN" | Opens Staff Management tab, focuses PIN field |
| Zero ceiling | "Set Outlet Ceiling" | Opens Staff Management, focuses ceiling field |
| Multiple owners | "Demote Extra Owners" | Lists owners → confirm → demotes to Manager |

### 3. Verification
| Check | Expected |
|-------|----------|
| Fix runs without error | Toast "X owner(s) demoted to Manager" |
| Demoted owners | Role changed to "Manager" in table |
| Audit log | Entry `action: 'role_change'` |

---

## 🛡 Security Audit Findings (Manual Verification)

| Finding | Severity | Current Status |
|---------|----------|----------------|
| No Manager PIN | Critical | Fixed if PIN set |
| No Counter PIN | Critical | Fixed if PIN set |
| Zero ceiling | High | Fixed if ceiling set |
| Multiple owners | High | Fixed by demotion |
| Stale staff (>90d) | Medium | Manual review |
| No receipt threshold | Low | Set in Settings |

---

## 📊 Reports & Analytics

### 1. Analytics Dashboard
| Metric | Verify |
|---------|--------|
| Total Revenue | Matches orders sum |
| Orders Today | Count matches Orders tab |
| Avg Order Value | Revenue / Orders |
| Top Items | Matches order items |

### 2. Expense Reports
| Report | Verify |
|--------|--------|
| Monthly Summary CSV | Opens in Excel, correct columns |
| Category Breakdown PDF | Branded, charts rendered |
| Outlet Comparison | All outlets listed |

---

## 🏪 POS (Walk-in)

### 1. Cart Operations
| Action | Expected |
|--------|----------|
| Add item | Appears in cart, total updates |
| Change qty +/- | Subtotal updates |
| Add addon | Addon price added |
| Remove item | Removed from cart |
| Apply coupon | Discount applied |
| Clear coupon | Discount removed |

### 2. Checkout
| Payment | Expected |
|---------|----------|
| Cash | Order created, receipt prints |
| UPI | QR shown, wait for payment |
| COD | Order placed, status "Pending" |
| Cancel | Cart preserved |

### 3. Counter PIN
| Scenario | Expected |
|----------|----------|
| No counter staff | PIN prompt on first sale |
| Valid PIN | Sale proceeds |
| Wrong PIN | Error, retry |
| End shift | Session cleared, PIN re-prompted |

---

## 🏪 Tables Management

| Feature | Test |
|---------|------|
| Add table | Appears on floor plan |
| Edit table | Capacity/number changes |
| Delete table | Removed (if no active session) |
| QR code | Opens modal, print works |
| Floor plan drag | Position persists |
| QR print bulk | PDF generated |

---

## 📦 Inventory

| Feature | Test |
|---------|------|
| Add item | Appears in list |
| Stock adjust +/- | Stock updates |
| Low stock alert | Badge on tab |
| Stock history | Shows all changes |
| CSV export | Downloads correctly |

---

## 📦 Inventory

| Feature | Test |
|---------|------|
| Add item | Appears in list |
| Stock adjust +/- | Stock updates |
| Low stock alert | Badge on tab |
| Stock history | Shows all changes |
| CSV export | Downloads correctly |

---

## 🛵 Riders

| Feature | Test |
|---------|------|
| Add rider | Appears in list |
| Assign order | Rider gets notification |
| Track location | Map updates |
| Settle wallet | Balance updates |
| Performance report | Shows metrics |

---

## 💬 Chat / Feedback

| Feature | Test |
|---------|------|
| New chat | Appears in list |
| Reply | Customer receives |
| Mark read | Unread count updates |
| Export chat | CSV download |

---

## 📱 Mobile / Responsive

| Viewport | Test |
|----------|------|
| Desktop (1920px) | All tabs visible |
| Tablet (768px) | Sidebar collapsible |
| Mobile (375px) | Bottom nav works, tables scroll |

---

## 🌐 Offline / Edge Cases

| Scenario | Expected |
|----------|----------|
| Offline → Online | Queue syncs, toast "Synced" |
| Slow network | Loading skeletons |
| Session expiry | Redirect to login |
| Concurrent edit | Toast "Changes saved by another user" |
| Large dataset (1000+ rows) | Virtual scroll works |

---

## 📋 Final Sign-Off

| Checklist | ✅ |
|-----------|----|
| All critical bugs fixed | ☐ |
| All high issues fixed | ☐ |
| All medium issues addressed | ☐ |
| Database rules deploy | ☐ |
| Hosting deploy | ☐ |
| Manual smoke test passed | ☐ |
| **Production ready** | ☐ |

---

## 📋 Post-Deployment Monitoring (First 48h)

| Metric | Target | Alert If |
|--------|--------|----------|
| Login success rate | >99% | <95% |
| Error rate (JS) | <0.1% | >1% |
| API latency (p95) | <500ms | >2s |
| Auth errors | 0 | >0 |
| Database rules errors | 0 | >0 |

---

**Sign-off:**
- Developer: _________________ Date: _______
- QA Lead: _________________ Date: _______
- Product Owner: _________________ Date: _______