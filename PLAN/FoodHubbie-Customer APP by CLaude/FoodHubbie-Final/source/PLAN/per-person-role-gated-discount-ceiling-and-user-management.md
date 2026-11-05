# Per-Person Role-Gated Discount Ceiling + Role-Based User Management

**Status:** PLANNING — not yet implemented
**Priority:** Medium (sleeper) — G9 from `Competitor/EVALUATION.md`
**Est. effort:** 2-3 dev days
**Depends on:** existing `settings/Security` (discountCeilingPct, pinHash), `admins/` node structure, `auth.js` role model

---

## 1. Problem Statement

### What we have today (`9e0bff7` - Ceiling/PIN + void-PIN)
- **Per-outlet** discount approval ceiling (`settings/Security/discountCeilingPct` in %)
- **Single** manager PIN (`settings/Security/pinHash` SHA-256) for the entire outlet
- When a manual discount exceeds the ceiling, the till prompts for the manager PIN
- **No role gating**: any admin who can access Settings can change the ceiling *and* the PIN
- **No per-person ceilings**: one ceiling applies to all staff equally
- **No audit trail** of who approved what (only audit log entry "Settings Updated")

### What Servkro ships **[live]** (`https://servkro.com/app/staff`)
| Column | Detail |
|--------|--------|
| **Name / Role / Counter PIN / Discount ceiling / Last signed in / Actions** | Per-person row |
| **Discount ceiling** | *"The most each person can take off a bill on their own. Past it, the till asks for a manager's PIN and records both names."* |
| **Role-gated config** | *"Only an owner can set these. A manager who could raise the ceiling they are asked to approve against would not be limited by it at all, which is why the control is not on their screen."* |
| **Activity log** | *"What staff have done that is worth a record. Written by the system, and not editable from anywhere."* (immutable) |
| **Actions** | `Set PIN`, `Edit`, `New password` |

### The hole in our design
1. **Ceiling is per-outlet, not per-person** → a senior cashier and a trainee have the same limit
2. **Ceiling is editable by anyone with Settings access** → a manager can raise their own ceiling before a shift, then approve their own oversized discounts
3. **No separation of duties** → the approver (manager) can configure the rule they enforce
4. **No per-person Counter PIN** → Security page finding: *"1 member(s) of staff cannot identify themselves at the till, so their discounts and voids are recorded against whoever signed the tablet this morning"*

---

## 2. Target Design

### 2.1 Data Model (Firebase Realtime Database)

```
businesses/{bid}/outlets/{oid}/
  ├─ settings/
  │   └─ Security/
  │       ├─ discountCeilingPct          (legacy outlet-level fallback, number)
  │       ├─ pinHash                     (legacy outlet-level manager PIN hash)
  │       ├─ staffCeilings/              (NEW: per-person ceilings)
  │       │   ├─ {staffUid}/
  │       │   │   ├─ ceilingPct: 15      (number, 0 = inherit outlet ceiling)
  │       │   │   ├─ updatedAt: "2026-09-26T..."
  │       │   │   └─ updatedBy: "adminUid"
  │       │   └─ ...
  │       └─ managerPinHash              (NEW: the PIN that approves overrides - owner-only)
  │
  ├─ staff/                              (NEW: staff directory for this outlet)
  │   ├─ {staffUid}/
  │   │   ├─ email: "cashier1@outlet.com"
  │   │   ├─ displayName: "Rajesh Kumar"
  │   │   ├─ role: "cashier"             (owner | manager | cashier | waiter)
  │   │   ├─ counterPinHash: "sha256..." (optional, for till sign-in)
  │   │   ├─ discountCeilingPct: 10      (denormalized for fast read at POS)
  │   │   ├─ isActive: true
  │   │   ├─ createdAt: "2026-09-26T..."
  │   │   ├─ createdBy: "ownerUid"
  │   │   ├─ lastSignedIn: "2026-09-26T..."
  │   │   └─ passwordSetAt: "2026-09-26T..." (tracks if initial pwd set)
  │   └─ ...
  │
  └─ audit/
      ├─ staffChanges/                   (NEW: immutable log of staff/ceiling changes)
      │   ├─ {pushId}/
      │   │   ├─ action: "ceiling_update" | "pin_reset" | "role_change" | "staff_create" | "staff_disable"
      │   │   ├─ targetStaffUid: "..."
      │   │   ├─ oldValue: { ceilingPct: 10 }
      │   │   ├─ newValue: { ceilingPct: 15 }
      │   │   ├─ actorUid: "ownerUid"
      │   │   ├─ actorRole: "owner"
      │   │   ├─ timestamp: "2026-09-26T..."
      │   │   └─ note: "Raised ceiling for evening shift"
      │   └─ ...
      └─ discountApprovals/              (NEW: every ceiling override recorded)
          ├─ {pushId}/
          │   ├─ billId: "B123"
          │   ├─ staffUid: "cashierUid"
          │   ├─ staffName: "Rajesh Kumar"
          │   ├─ discountPct: 22
          │   ├─ ceilingPct: 15
          │   ├─ approverUid: "managerUid"
          │   ├─ approverName: "Priya Singh"
          │   ├─ timestamp: "2026-09-26T..."
          │   └─ billTotal: 1450
          └─ ...
```

### 2.2 Roles & Permissions Matrix

| Action | Supreme Admin | Super Admin | **Owner** | **Manager** | **Cashier** | **Waiter** |
|--------|---------------|-------------|-----------|-------------|-------------|------------|
| Create staff account | ✓ | ✓ | ✓ (own outlet) | ✗ | ✗ | ✗ |
| Set/change staff role | ✓ | ✓ | ✓ (own outlet) | ✗ | ✗ | ✗ |
| Set **any** staff's discount ceiling | ✓ | ✓ | ✓ (own outlet) | ✗ | ✗ | ✗ |
| Set **own** discount ceiling | — | — | ✓ | ✗ | ✗ | ✗ |
| Set manager approval PIN (owner PIN) | ✓ | ✓ | ✓ (own outlet) | ✗ | ✗ | ✗ |
| Reset staff Counter PIN | ✓ | ✓ | ✓ | ✓ (own outlet) | ✗ | ✗ |
| Reset staff login password | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Approve discount override** (enter manager PIN at POS) | ✓ | ✓ | ✓ | **✓** | ✗ | ✗ |
| View staff audit log | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| View Security audit page | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Sign in at counter (Counter PIN) | — | — | ✓ | ✓ | ✓ | ✓ |

> **Key rule**: A role **cannot** configure the ceiling/PIN of a role **equal or higher** than itself. Owner configures Manager; Manager cannot configure Owner. Cashier/Waiter configure nothing.

### 2.3 POS Approval Flow (unchanged for cashier, new for approver)

```
Cashier enters manual discount > ceilingPct
    │
    ▼
POS prompts: "This 22% discount exceeds your 15% ceiling. Manager approval required."
    │
    ▼
Manager scans their Counter PIN (or enters Manager PIN)
    │
    ├── PIN valid & role >= manager → APPROVED
    │       ├─ Record in audit/discountApprovals/{pushId} with both names
    │       └─ Bill proceeds
    │
    └── PIN invalid / role < manager → REJECTED
            ├─ Show: "Approval denied. Insufficient privileges."
            └─ Bill stays at original total
```

### 2.4 Staff Account Creation Flow

1. **Owner** (or Supreme/Super Admin) goes to **Settings → Staff Management** (new sub-tab)
2. Clicks **Add Staff** → modal: Email, Name, Role (cashier/manager/waiter), initial password
3. System:
   - Creates Firebase Auth user (`createUserWithEmailAndPassword`) — **owner never sees the password**
   - Writes `businesses/{bid}/outlets/{oid}/staff/{uid}` with role, displayName, `passwordSetAt: serverTimestamp()`
   - Sends **password reset email** to the staff's email (staff sets their own password)
   - Logs `audit/staffChanges` with `action: "staff_create"`
4. Staff receives email → clicks link → sets password → first login
5. On first login: staff prompted to set **Counter PIN** (4-6 digits) for till sign-in
6. Owner can later: edit role, set per-person ceiling, reset Counter PIN, disable account

---

## 3. Implementation Plan

### Phase 1: Data Model & Security Rules (0.5 day)

**Files to create/modify:**
- `database.rules.json` — new rules for `staff/`, `settings/Security/staffCeilings/`, `audit/`
- `Admin/js/firebase.js` — export new ref paths

**Security Rules (key points):**
```json
{
  "rules": {
    "businesses": {
      "$bid": {
        "outlets": {
          "$oid": {
            "staff": {
              "$uid": {
                ".read": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() === true || root.child('admins').child(auth.uid).child('outlet').val() == $oid || data.child('uid').val() == auth.uid)",
                ".write": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() === true || (root.child('admins').child(auth.uid).child('role').val() == 'owner' && root.child('admins').child(auth.uid).child('outlet').val() == $oid))"
              }
            },
            "settings": {
              "Security": {
                "staffCeilings": {
                  "$uid": {
                    ".write": "auth != null && root.child('admins').child(auth.uid).child('role').val() == 'owner' && root.child('admins').child(auth.uid).child('outlet').val() == $oid"
                  }
                },
                "managerPinHash": {
                  ".write": "auth != null && root.child('admins').child(auth.uid).child('role').val() == 'owner' && root.child('admins').child(auth.uid).child('outlet').val() == $oid"
                }
              }
            },
            "audit": {
              "staffChanges": {
                ".read": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() === true || root.child('admins').child(auth.uid).child('role').val() == 'owner')",
                ".write": "false"  // server-side only via Admin SDK / Cloud Function
              },
              "discountApprovals": {
                ".write": "auth != null"  // POS writes on approval
              }
            }
          }
        }
      }
    }
  }
}
```

> **Note:** `audit/staffChanges` should be **append-only, never deletable**. Enforce via rules (no `.write` for clients) + Cloud Function for audit entries, OR write via `set` with `serverTimestamp` and rule `.write: "!data.exists()"`. Simpler: write from admin JS but rule `.validate: "newData.hasChildren(['action','targetStaffUid','actorUid','timestamp'])"` and `.write: "auth != null && root.child('admins').child(auth.uid).child('role').val() == 'owner'"`.

### Phase 2: Staff Management UI (Settings → Staff Management sub-tab) (1 day)

**New files:**
- `Admin/js/features/staff-management.js` — all CRUD + UI
- HTML additions in `Admin/index.html` (Settings tab, new sub-tab "Staff")

**UI Structure:**
```
Settings → Staff Management (new sub-tab)
├── Toolbar: [Add Staff] button (only for Owner/Super/Supreme)
├── Staff Table:
│   Name | Role | Counter PIN | Discount Ceiling | Last Signed In | Status | Actions
│   ─────────────────────────────────────────────────────────────────────────────
│   Rajesh Kumar | Cashier | SET | 10% | 2h ago | Active | [Edit] [Reset PIN] [Disable]
│   Priya Singh | Manager | SET | 20% | 1d ago | Active | [Edit] [Reset PIN] [Disable]
│   Amit Shah | Waiter | NOT SET | 0% (inherit) | Never | Active | [Edit] [Set PIN] [Disable]
└── Pagination (if >20)
```

**Add/Edit Staff Modal:**
```
┌─────────────────────────────────────┐
│ Add Staff Member                    │
├─────────────────────────────────────┤
│ Email*          [________________]  │
│ Full Name*      [________________]  │
│ Role*           [Cashier ▼]         │
│                (Cashier / Manager  │
│                 / Waiter)           │
│ Initial Password* [________________]│
│                (auto-sent reset)    │
│ [Cancel]          [Create Account]  │
└─────────────────────────────────────┘
```

**Edit Staff Modal (pre-filled):**
- Email (read-only, can't change)
- Name (editable)
- Role dropdown (Owner can't demote themselves; Manager can't promote to Owner)
- Discount ceiling % (0 = inherit outlet ceiling; Owner-only field)
- [Reset Counter PIN] button → sends PIN reset email / generates temp PIN
- [Disable Account] button (soft delete: `isActive: false`)

### Phase 3: Per-Person Ceiling Logic at POS (0.5 day)

**Files to modify:**
- `Admin/js/utils.js` — `needsPinApproval()` and `promptManagerPin()`
- `Admin/js/features/pos.js` — POS manual discount flow
- `Admin/js/features/tables.js` — Table billing manual discount flow

**Logic change in `needsPinApproval(discountValue, subtotal, staffUid)`:**
```javascript
// OLD: read outlet ceiling from settings/Security/discountCeilingPct
// NEW:
async function getEffectiveCeiling(staffUid) {
  // 1. Try per-person ceiling
  const staffSnap = await get(ref(db, `businesses/${bid}/outlets/${oid}/staff/${staffUid}`));
  if (staffSnap.exists()) {
    const staff = staffSnap.val();
    if (typeof staff.discountCeilingPct === 'number' && staff.discountCeilingPct > 0) {
      return staff.discountCeilingPct;
    }
  }
  // 2. Fallback to outlet-level ceiling (legacy)
  const secSnap = await get(ref(db, `businesses/${bid}/outlets/${oid}/settings/Security`));
  return secSnap.val()?.discountCeilingPct || 0;
}
```

**Approval PIN check:**
- Read `settings/Security/managerPinHash` (owner-set, not the legacy `pinHash`)
- Verify against entered PIN via `hashPin()`
- Verify **approver role >= manager** (read from `staff/{approverUid}/role`)

### Phase 4: Audit Logging (0.5 day)

**Files to create:**
- `Admin/js/utils.js` — `logStaffChange(action, targetUid, oldVal, newVal, note)`
- `Admin/js/features/pos.js` — log discount approval in `audit/discountApprovals`

**Every ceiling override logs:**
```javascript
await push(ref(db, `businesses/${bid}/outlets/${oid}/audit/discountApprovals`), {
  billId,
  staffUid: state.adminData?.uid,          // cashier who entered discount
  staffName: state.adminData?.name,
  discountPct: (discountValue / subtotal) * 100,
  ceilingPct: effectiveCeiling,
  approverUid: approverUid,                // manager who entered PIN
  approverName: approverName,
  timestamp: serverTimestamp(),
  billTotal: subtotal
});
```

### Phase 5: Security Audit Page (mirrors Servkro's `/app/security`) (0.5 day)

**New file:** `Admin/js/features/security-audit.js` — new tab **Security Audit** under Settings

**Checks (automated, runs on load + daily):**
| Check | Severity | Fix Action |
|-------|----------|------------|
| Staff with no Counter PIN | Medium | [Set PIN] → opens staff edit modal |
| Staff with `discountCeilingPct == 0` AND role != waiter | Low | [Set Ceiling] |
| Owner/Manager with `discountCeilingPct > managerPinCeiling` | High | [Fix] |
| Inactive staff with `isActive: true` but `lastSignedIn > 90 days` | Low | [Disable] |
| No `managerPinHash` set (owner PIN missing) | Critical | [Set Manager PIN] |
| Staff role = owner but multiple owners exist | Medium | [Review] |

**Page sections:**
1. **Summary counters**: Outstanding / Critical / High / Medium / Low
2. **Findings list** — each with severity badge, plain-English description, one-click fix
3. **"What this page could not check"** — e.g., "Could not verify server-side PIN enforcement", "Session records not accessible"
4. **Footer**: `Checked {date} - running in production mode`

### Phase 6: Role-Based Login & Counter PIN (0.5 day)

**Files to modify:**
- `Admin/js/auth.js` — extend `onAuthStateChanged` to read staff role, load outlet context
- `Admin/js/utils.js` — `verifyCounterPin(staffUid, enteredPin)` for till sign-in
- POS/Table billing — Counter PIN prompt on shift start / first manual action

**Counter PIN flow:**
1. Staff opens POS/Table billing → if no active session, prompt **Counter PIN**
2. Verify against `staff/{uid}/counterPinHash`
3. On success: set `sessionStorage.counterStaffUid = uid`, `lastSignedIn = now`
4. All subsequent manual discounts/voids tagged with this `staffUid`
5. On shift end / logout: clear session

**Role-based UI hiding:**
- Settings → Staff Management tab: hide for role < owner
- Settings → Security Audit tab: hide for role < owner
- Settings → Security (discount ceiling + manager PIN): hide for role < owner
- Features → Discount Approval toggle: hide for role < owner

---

## 4. Migration Strategy (Zero-Downtime)

| Step | Action |
|------|--------|
| 1 | Deploy new security rules (backward compatible — old paths still work) |
| 2 | Deploy `staff-management.js` + UI (hidden behind feature flag `staffManagement`) |
| 3 | **One-time migration script** (run in browser console or Cloud Function): |
|   | `for each outlet: read settings/Security/discountCeilingPct → write to staffCeilings/{eachExistingAdminUid}/ceilingPct` |
|   | `for each existing admin in admins/: if role != supreme/super → create staff/{uid} with role='manager' (default)` |
| 4 | Enable feature flag for target outlets |
| 5 | Communicate: "Per-person ceilings now live. Owner must set Manager PIN." |
| 6 | After 2 weeks: deprecate legacy `settings/Security/discountCeilingPct` and `pinHash` (keep as fallback) |

---

## 5. Test Plan

| Scenario | Expected |
|----------|----------|
| Cashier (ceiling 10%) enters 15% discount → manager approves with PIN | Approved, audit log has both names |
| Cashier (ceiling 10%) enters 15% discount → waiter tries to approve | Rejected: "Insufficient privileges" |
| Manager (ceiling 20%) enters 25% discount → owner approves | Approved |
| Manager tries to edit own ceiling via Settings | UI field disabled / 403 from rules |
| Owner sets Manager PIN → manager approves with that PIN | Works |
| Staff with no Counter PIN opens POS | Prompted to set PIN on first use |
| Owner disables staff account | Staff cannot sign in; `isActive: false` |
| Security Audit page loads | Shows real findings with one-click fixes |
| Supreme Admin creates staff for another outlet | Works, staff scoped to that outlet |

---

## 6. Open Questions / Decisions Needed

1. **Counter PIN length**: 4 digits (Servkro) vs 6 digits (more secure)? → **4 digits** (usability, matches existing manager PIN)
2. **Staff authentication**: Firebase Auth (email/password) vs custom? → **Firebase Auth** (already used, password reset built-in)
3. **Manager PIN vs Owner PIN**: One PIN (`managerPinHash`) that both Owner and Manager can use to approve? → **Yes, single approval PIN** (owner sets it, manager uses it). Simpler than two PINs.
4. **Waiter role needs ceiling?** → **No, inherit 0** (waiters don't do manual discounts). UI shows "Inherit (0%)".
5. **Audit log retention?** → **Forever** (immutable). No TTL.
6. **Cloud Function for audit?** → **No, client writes with strict rules** (simpler, no Functions cost). Rule: `.write: "auth != null && newData.hasChildren(['action','targetStaffUid','actorUid','timestamp'])"`
7. **Multi-outlet staff** (same person works at two outlets)? → **Separate staff record per outlet** (simpler, matches outlet isolation). Email can be same; UID differs.

---

## 7. File Inventory (What to Create / Modify)

| File | Action | Description |
|------|--------|-------------|
| `database.rules.json` | **Modify** | Add rules for `staff/`, `staffCeilings/`, `managerPinHash`, `audit/` |
| `Admin/js/firebase.js` | **Modify** | Export `tenantPath` helpers for new paths |
| `Admin/js/features/staff-management.js` | **Create** | Full CRUD UI + logic for staff directory |
| `Admin/js/features/security-audit.js` | **Create** | Automated posture auditor (Servkro parity) |
| `Admin/js/utils.js` | **Modify** | `getEffectiveCeiling()`, `verifyCounterPin()`, `logStaffChange()` |
| `Admin/js/features/pos.js` | **Modify** | POS discount approval flow + audit logging |
| `Admin/js/features/tables.js` | **Modify** | Table billing discount approval flow |
| `Admin/js/auth.js` | **Modify** | Counter PIN session, role-based UI gating |
| `Admin/index.html` | **Modify** | Staff Management sub-tab HTML, Security Audit tab HTML |
| `Admin/js/main.js` | **Modify** | Register new feature modules, tab routing |

---

## 8. Acceptance Criteria

1. ✅ Owner can create staff accounts with email/password + role
2. ✅ Staff receive password reset email, set own password
3. ✅ Staff sign in at counter with 4-digit Counter PIN
4. ✅ Per-person discount ceiling enforced at POS & Table billing
5. ✅ Ceiling override requires Manager/Owner PIN + records both names
6. ✅ Owner-only can edit ceilings, set Manager PIN, change roles
7. ✅ Security Audit page shows findings with one-click fixes
8. ✅ Immutable audit log for every staff change + discount approval
9. ✅ Legacy outlet-level ceiling still works as fallback
10. ✅ Zero-downtime migration for existing outlets

---

## 9. Related Plans / Dependencies

- `PLAN/expenses-module.md` (G1) — shares Staff directory for expense attribution
- `PLAN/shift-cash-drawer.md` (G2) — shares Counter PIN / shift sign-in
- `PLAN/feedback-routing.md` (G6) — separate
- `PLAN/virtual-qr.md` (G7) — separate

---

**Next step:** Review with team → approve → create GitHub issue → start Phase 1.