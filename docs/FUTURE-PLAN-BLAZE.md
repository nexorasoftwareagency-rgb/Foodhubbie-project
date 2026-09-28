# Future Plan — Blaze Plan Features

This document outlines features that require **Firebase Blaze Plan (pay-as-you-go)** and **Cloud Functions**.
These are **removed from the current Spark plan codebase** but documented here for future implementation.

---

## 🚫 Currently Removed from Spark Codebase

The following features have been **removed from the Spark plan codebase** but are fully designed for Blaze plan implementation:

---

## 1. Custom Claims for Role-Based Access Control

### Current (Spark):
- Roles stored in Realtime Database (`staff/{uid}/role`)
- Client-side enforcement + Database rules
- Vulnerable to client-side tampering

### Future (Blaze):
```javascript
// Cloud Function: setCustomClaims(uid, { role: 'manager', outlet: 'pizza' })
// Triggered on: staff creation, role change, staff disable

// Client: auth.currentUser.getIdTokenResult().then(r => r.claims.role)
// Database rules: auth.token.claims.role == 'manager'
```

**Files to modify (Blaze):**
- `Admin/js/features/staff-management.js` - `createStaffAccount()` → call Cloud Function
- `Admin/js/features/security-audit.js` - Add audit for Custom Claims sync
- `database.rules.json` - Replace `root.child('admins')...` with `auth.token.claims.role`
- `functions/src/auth-triggers.ts` - New Cloud Function

---

## 2. Server-Side PIN Verification

### Current (Spark):
- Client-side PIN verification via `gateManagerPin()`
- Vulnerable to client-side bypass (devtools, network interception)

### Future (Blaze):
```typescript
// Cloud Function: verifyManagerPin(pin, action, context)
// - Rate limiting (5 attempts / 15 min)
// - Audit logging to /audit/pinAttempts
// - Returns { success: boolean, token?: string } // short-lived JWT for sensitive ops

// Client: const result = await httpsCallable('verifyManagerPin')({ pin, action })
// if (!result.data.success) throw new Error('PIN verification failed')
```

**Files to modify:**
- `Admin/js/utils.js` - `gateManagerPin()` → callable HTTPS function
- `Admin/js/utils.js` - `verifyCounterPin()` → callable function
- `Admin/js/features/pos.js` / `tables.js` - Call Cloud Function instead of local hash
- `functions/src/pin-verification.ts` - New Cloud Function with rate limiting

---

### 3. Server-Side Expense Ceiling Enforcement

### Current (Spark):
- Client-side check in `expenses.js:950-991`
- Fails open on error (ceiling bypass possible)
- Relies on `dineinSettings.projectedDailyRevenue` (may not exist)

### Future (Blaze):
```typescript
// Cloud Function: enforceExpenseCeiling(outletId, amount, categoryId)
// - Reads outlet's daily revenue projection
// - Aggregates today's expenses server-side
// - Returns { allowed: boolean, requiresPin: boolean, ceilingAmount: number }
// - Called from: expenses.js, pos.js, tables.js (via callable)

// Cloud Scheduler: Daily job to recalculate projected revenue
// Cloud Function: dailyExpenseReport(outletId) → email to owner
```

**Files to modify:**
- `Admin/js/features/expenses.js` - Remove client ceiling check, call Cloud Function
- `Admin/js/features/pos.js` / `tables.js` - Call Cloud Function
- `functions/src/expense-ceiling.ts` - New Cloud Function
- `database.rules.json` - Add `expenseCeiling` validation on write

---

## 📁 Files to Remove/Comment on Spark (Blaze-only)

```
functions/
├── src/
│   ├── auth-triggers.ts          # Custom Claims on staff create/update
│   ├── pin-verification.ts       # verifyManagerPin, verifyCounterPin
│   ├── expense-ceiling.ts        # enforceExpenseCeiling
│   ├── expense-reports.ts        # scheduled daily reports
│   ├── staff-triggers.ts         # emailIndex, counterPinIndex maintenance
│   ├── expense-reports.ts        # scheduled daily/weekly reports
│   └── index.ts                  // exports all functions
├── package.json
├── tsconfig.json
└── tsconfig.dev.json
```

---

## 📋 Implementation Checklist (Blaze Migration)

| Phase | Task | Files | Est. Effort |
|-----|------|-------|-------------|
| 1 | Setup Firebase Functions (TypeScript) | `functions/` | 2h |
| 2 | Custom Claims on staff create/update | `staff-management.js`, `functions/auth-triggers.ts` | 4h |
| 3 | Server-side PIN verification | `utils.js`, `pos.js`, `tables.js`, `functions/pin-verification.ts` | 6h |
| 3 | Expense ceiling enforcement | `expenses.js`, `pos.js`, `tables.js`, `functions/expense-ceiling.ts` | 6h |
| 4 | Deploy rules with Custom Claims | `database.rules.json` | 2h |
| 5 | E2E testing | Manual + automated | 4h |
| **Total** | | | **~20h** |

---

## 🔒 Security Notes for Blaze Migration

1. **Remove all client-side PIN verification** - move to Cloud Functions
2. **Remove client-side ceiling checks** - enforce server-side
3. **Add rate limiting** to PIN verification (5 attempts / 15 min)
3. **Add audit logging** for all PIN attempts (success/fail)
4. **Remove client-side ceiling checks** from `expenses.js`, `pos.js`, `tables.js`
5. **Update database rules** to use `auth.token.claims.role` instead of `root.child('admins')...`

---

*Document Version: 1.0*
*Last Updated: 2026-09-27*
*Status: Ready for Blaze Plan Migration*