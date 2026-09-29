# Plan: Website Admin Onboarding → Supreme Admin Approval + Locked State + WhatsApp Bot Onboarding

**Status:** DONE — all 8 steps implemented + verified live (2026-09-29)
**Created:** 2026-09-28
**Updated:** 2026-09-29 (verification pass: fixed reject-path rules bug — `$reqId` validate forced `status == 'pending'` and `rejectReason`/`reviewedAt`/`reviewedBy` hit `$other: false`, so the Reject button always 401'd; approved/rejected now allowed for super/supreme only, review fields allowlisted)

---

## 1. Overview & Goals

**Three features in one plan:**

1. **Website self-registration** — Restaurant owners fill a signup form on the public website. Application lands in `onboardingRequests` (pending). Supreme Admin reviews and approves → creates outlet + Auth user + billing.

2. **Locked state** — After approval, the outlet is created with `locked: true`. The restaurant admin can log into the Admin Dashboard but **cannot use anything**. All add/edit actions show a popup: *"Contact Supreme Admin for Permission and Pay the Setup Fee for Access."* Supreme Admin unlocks → `locked: false` → full access.

3. **WhatsApp bot onboarding from Admin app** — Rename "Chats" tab → "WhatsApp" tab. When no bot is connected, show a step-by-step onboarding guide with QR pairing flow. Restaurant can add their WhatsApp as a co-existence bot number directly from the tab.

**Non-goals:** Email notifications, payment collection during signup, OTP verification, multi-outlet signup.

---

## 2. Current State (what exists)

| Component | Location | Reuse |
|-----------|----------|-------|
| 5-step onboarding wizard | `SupremeAdmin/js/features/restaurant-onboarding.js` | Data collection, bid/oid generation, outletNo allocation, multi-path write, template mirror |
| Outlet admin creation | `bot-control-api/server.js` `/api/admin/update-password` | Auth user creation + `admins/{uid}` mirror |
| Website inquiry form | `website/book.html` → `inquiries` node | Unauth write pattern (`source: 'website'`), form styling |
| Supreme Admin routes | `SupremeAdmin/js/main.js` hash router | Add `#onboarding` route |
| Soft-delete gate | `Admin/js/auth.js` lines 208–263 — `disabled` boolean blocks login + realtime sign-out | **Template for locked state** |
| `showAccessDenied()` | `Admin/js/auth.js` line 400 | Blocked UI modal |
| `state` object + `loadOutletGates()` | `Admin/js/state.js` + `auth.js` line 358 | Per-outlet flags pattern |
| Role-based tab gating | `Admin/js/ui.js` `canAccessTab()` + `refreshNavVisibility()` | Hide nav items |
| QR pairing (Supreme Admin) | `SupremeAdmin/js/features/restaurant-profile.js` `openPairModal()` | QR display pattern — replicate in Admin app |
| `bot/pair` node | Written by `bot/index.js`, read by Supreme Admin | QR code source — subscribe from Admin app too |
| `bot-status.js` | `Admin/js/bot-status.js` — global listener, `botStatusChange` event | Bot online/offline indicator |
| Chats tab | `Admin/js/features/chat.js` — WhatsApp-style conversation viewer | Rename to WhatsApp tab, add onboarding |

---

## 3. Feature 1: Website Self-Registration

### Data Model: `onboardingRequests`

```
onboardingRequests/{pushKey} = {
  businessName:    string,
  outletName:      string,
  contactPhone:    string,
  contactEmail:    string,
  adminEmail:      string,
  adminPassword:   string,        // removed on approval
  plan:            'starter' | 'growth' | 'enterprise',
  template:        string,
  whatsappConnect: 'qr' | 'meta',
  source:          'website',
  status:          'pending' | 'approved' | 'rejected',
  createdAt:       number,
  reviewedAt:      number,
  reviewedBy:      string,
  rejectReason:    string,
  bid:             string,        // filled on approval
  oid:             string
}
```

### Website: `website/signup.html` (NEW)

Form fields: Business name, Outlet name, Contact phone, Contact email, Admin email, Admin password, Confirm password, Plan (radio), WhatsApp (radio: QR/Meta).

Submit → `onboardingRequests.push()` with `source: 'website'`, `status: 'pending'`.

Success message: *"Application received! We'll review and contact you within 24 hours."*

Links: `index.html` CTA → signup, `book.html` → signup.

### Supreme Admin: `#onboarding` route (NEW)

- Route in `main.js`, sub-nav link with pending count badge
- List pending requests (live listener, ordered by createdAt desc)
- Filter tabs: Pending | Approved | Rejected | All
- KPI strip: Pending count, Approved this week, Rejected this week
- Row actions: View (expand details), Approve (2-step confirm), Reject (reason modal)

### Approval → creates outlet with `locked: true`

The bot-control-api `/api/admin/approve-onboarding` endpoint:
1. Verify super admin
2. Generate bid/oid, allocate outletNo
3. Create Auth user + `admins/{uid}` mirror
4. Write `businesses/{bid}/outlets/{oid}` with **`locked: true`**
5. Mirror template
6. Update `onboardingRequests/{reqKey}`: `status: 'approved'`, `bid`, `oid`, `adminPassword: null`
7. Return `{ bid, oid, email, password, loginUrl }`

### Reject → status: 'rejected' + reason

---

## 4. Feature 2: Locked State (Admin App)

### New field on outlet: `locked`

```
businesses/{bid}/outlets/{oid}/locked = true | false
```

- `true` = outlet admin can log in but cannot use anything
- `false` = full access (default for wizard-created outlets)
- Set to `true` on website-signup approval
- Set to `false` when Supreme Admin unlocks

### Auth gate change (`Admin/js/auth.js`)

**Current:** `disabled: true` → block login entirely (access denied screen).

**New:** Add `locked` check AFTER the `disabled` check:

```js
// --- Locked-outlet gate (can log in, but can't use anything) ---
if (!adminData.isSuper && !adminData.isSupreme && adminData.outlet) {
    const lockedSnap = await firebase.database().ref(`businesses/${bid}/outlets/${oid}/locked`).once('value');
    if (lockedSnap.val() === true) {
        state.locked = true;  // global flag
    }
}
```

**Realtime listener:** Subscribe to `businesses/{bid}/outlets/{oid}/locked` — if it flips to `false` while logged in, clear `state.locked` and refresh UI.

### Locked screen (`Admin/js/ui.js` or new `locked.js`)

When `state.locked === true`:
- Show a full-screen overlay/modal: *"Your restaurant is not yet activated. Contact Supreme Admin for Permission and Pay the Setup Fee for Access."*
- Hide all navigation tabs (or show them but intercept actions)
- Show a "Contact Supreme Admin" button (opens WhatsApp to supreme admin number)
- Allow logout only

### Global action interceptor (`Admin/js/main.js`)

When `state.locked === true`, intercept ALL add/edit/create/update/delete actions:

```js
// In the global click handler, before dispatching:
if (state.locked && isMutatingAction(action)) {
    showLockedPopup();
    return;
}
```

`isMutatingAction(action)`: returns true for actions like `save-order`, `add-item`, `edit-table`, `save-settings`, `add-staff`, `update-menu`, etc. — anything that writes data.

**Popup:** Modal with title *"Access Restricted"*, body *"Contact Supreme Admin for Permission and Pay the Setup Fee for Access."*, single OK button.

### Supreme Admin unlock

In Supreme Admin restaurant profile or onboarding list:
- "Unlock Access" button → sets `locked: false`
- Realtime listener in Admin app picks it up → clears `state.locked` → full access

---

## 5. Feature 3: WhatsApp Bot Onboarding (Admin App)

### Rename: "Chats" → "WhatsApp"

- `Admin/index.html` line 595–605: rename tab label, icon, `data-tab="chat"` → `data-tab="whatsapp"`
- `Admin/js/features/chat.js` → rename to `whatsapp.js` (or keep filename, just rename UI)
- Sidebar badge `#badge-chat` → `#badge-whatsapp`
- All internal references updated

### WhatsApp tab layout (new)

When bot IS connected: show existing chat interface (current `chat.js`).

When bot is NOT connected: show **onboarding card**:

```
┌─────────────────────────────────────────────┐
│  📱 Connect Your WhatsApp Bot               │
│                                             │
│  Step-by-step guide:                        │
│  1. Open WhatsApp on your restaurant phone  │
│  2. Go to Settings → Linked Devices         │
│  3. Click "Link a Device"                   │
│  4. Scan the QR code below                  │
│                                             │
│  ┌─────────────────────┐                    │
│  │                     │                    │
│ │    QR CODE          │                    │
│  │   (bot/pair/qr)     │                    │
│  │                     │                    │
│  └─────────────────────┘                    │
│                                             │
│  Status: Waiting for scan...                │
│                                             │
│  📖 Full Manual & Guide                     │
│  (expandable section with detailed steps)   │
│                                             │
│  Having trouble? Contact Supreme Admin      │
└─────────────────────────────────────────────┘
```

### QR pairing in Admin app

Subscribe to `bot/{outlet}/pair` (same node Supreme Admin reads):
- When `pair.qr` is present → render QR code
- When `pair.status === 'connected'` → switch to chat interface
- Show status text: waiting / connected / banned / logged_out

### Manual/guide section

Expandable section with:
- Screenshots (text descriptions for now)
- Common issues (QR expired, banned number, etc.)
- Link to contact Supreme Admin

---

## 6. Security Rules

### Add to `database.rules.json`

```json
"onboardingRequests": {
  ".read": "auth != null && (auth.token.isSuper === true || auth.token.isSupreme === true)",
  "$reqId": {
    ".write": "auth == null && newData.child('source').val() == 'website'",
    ".validate": "newData.hasChildren(['businessName','outletName','adminEmail','adminPassword','plan','source','status','createdAt']) && newData.child('status').val() === 'pending'"
  }
}
```

### `locked` field rules

Add to existing outlet rules:
```json
"locked": {
  ".write": "auth != null && (auth.token.isSuper === true || auth.token.isSupreme === true)",
  ".read": "auth != null"
}
```

Only Supreme Admin can write `locked`. Outlet admins can read it (to know their status).

---

## 7. bot-control-api — `/api/admin/approve-onboarding`

### New endpoint

```
POST /api/admin/approve-onboarding
Authorization: Bearer <super admin token>
Body: { reqKey, businessName, outletName, contactPhone, contactEmail, adminEmail, adminPassword, plan, template, whatsappConnect }
```

### Server-side flow (atomic)

1. Verify super admin (`requireSuperOnly`)
2. Generate bid/oid (`push().key.toLowerCase()`)
3. Allocate outletNo (transaction on `meta/outletCounter`)
4. Create Auth user (`admin.auth().createUser` or `getUserByEmail` + `updateUser`)
5. Write `admins/{uid}` mirror
6. Write `businesses/{bid}/outlets/{oid}` with **`locked: true`**
7. Mirror template (categories/dishes from `appTemplates/{template}`)
8. Update `onboardingRequests/{reqKey}`: `status: 'approved'`, `bid`, `oid`, `adminPassword: null`
9. Return `{ bid, oid, email, password, loginUrl }`

### Error handling
- If Auth user creation fails → rollback
- If `status !== 'pending'` → 409 Conflict
- Idempotent on retry

---

## 8. Build Order

### Step 1: Data model + rules
- Add `onboardingRequests` + `locked` rules to `database.rules.json`
- Deploy rules
- Verify: unauth write to `onboardingRequests` with `source: 'website'` succeeds; read denied unauth

### Step 2: Website signup form
- Create `website/signup.html`
- Add link from `website/index.html` CTA
- Add link from `website/book.html`
- Test: submit form → verify data in `onboardingRequests`

### Step 3: bot-control-api endpoint
- Add `/api/admin/approve-onboarding` to `bot-control-api/server.js`
- Test: call with curl → verify Auth user created, outlet created with `locked: true`, request updated

### Step 4: Supreme Admin onboarding page
- Add `#onboarding` route to `main.js`
- Create `SupremeAdmin/js/features/onboarding-requests.js`
- Add sub-nav link with pending count badge
- Add approve/reject modals
- Build + deploy

### Step 5: Admin app locked state
- Add `locked` check in `auth.js` (after `disabled` check)
- Add `state.locked` flag + realtime listener
- Add locked screen overlay in `ui.js`
- Add global action interceptor in `main.js`
- Add "Contact Supreme Admin" button
- Build + deploy

### Step 6: Supreme Admin unlock
- Add "Unlock Access" button in restaurant profile (or onboarding list)
- Sets `locked: false`
- Verify: Admin app realtime listener picks it up → full access

### Step 7: WhatsApp tab rename + onboarding
- Rename "Chats" → "WhatsApp" in `index.html`
- Create `Admin/js/features/whatsapp.js` (or modify `chat.js`)
- Add bot-not-connected onboarding card with QR pairing
- Subscribe to `bot/{outlet}/pair`
- Add manual/guide section
- Build + deploy

### Step 8: End-to-end test
- Submit signup from website
- Approve from Supreme Admin → outlet created with `locked: true`
- Log in to Admin app → see locked screen
- Try to add/edit → see popup
- Supreme Admin unlocks → `locked: false`
- Log in again → full access
- WhatsApp tab → see onboarding → scan QR → bot connected → chat interface

---

## 9. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `website/signup.html` | **CREATE** | Restaurant signup form |
| `website/index.html` | MODIFY | Add "Register Your Restaurant" CTA |
| `website/book.html` | MODIFY | Add link to signup |
| `database.rules.json` | MODIFY | Add `onboardingRequests` + `locked` rules |
| `bot-control-api/server.js` | MODIFY | Add `/api/admin/approve-onboarding` endpoint |
| `SupremeAdmin/js/main.js` | MODIFY | Add `#onboarding` route + sub-nav link |
| `SupremeAdmin/js/features/onboarding-requests.js` | **CREATE** | List + approve/reject UI |
| `SupremeAdmin/js/features/restaurant-profile.js` | MODIFY | Add "Unlock Access" button |
| `Admin/js/auth.js` | MODIFY | Add `locked` check + `state.locked` flag |
| `Admin/js/state.js` | MODIFY | Add `locked: false` to state |
| `Admin/js/ui.js` | MODIFY | Add locked screen overlay |
| `Admin/js/main.js` | MODIFY | Add global action interceptor for locked state |
| `Admin/index.html` | MODIFY | Rename "Chats" → "WhatsApp" tab |
| `Admin/js/features/chat.js` | MODIFY | Add WhatsApp onboarding card + QR pairing |
| `Admin/js/features/whatsapp.js` | **CREATE** | WhatsApp tab with onboarding + chat |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Spam/fake signup requests | Phone verification (OTP) — out of scope for v1 |
| Password stored in `onboardingRequests` | Removed on approval; rules gate read to isSuper only |
| Duplicate admin email | Check `admins/{uid}` before approval; reject if exists |
| Partial creation on approval failure | Server-side atomic flow; rollback on error |
| Locked state bypassed by direct Firebase write | Rules gate `locked` write to isSuper only |
| QR pairing conflicts (Supreme + Admin both showing QR) | Same `bot/pair` node — last writer wins; both show same QR |

---

## 11. Future Enhancements (out of scope)

- OTP phone verification during signup
- Email notification with credentials on approval
- Payment collection during signup
- Multi-outlet signup from one form
- Auto-approve for trusted domains
- Bot health monitoring dashboard
