# PLAN — Onboarding flow hardening (F1 + F2), email verification (D2) and wallet gates (D4)

> **Status: PLAN ONLY.** No code changed since `b4a301a`. Nothing merged, nothing deployed, no live data written.
> Base change set: local branch `onboarding-setup-checklist` (`4c32061..b4a301a`), reviewed in `docs/PLAN-ONBOARDING-WALLET-PERCENTAGE.md`.
> Inputs: three independent agent reviews (setup-mode UX, tenant parity, wallet gates) + a read-only live-DB probe. Every load-bearing claim below was re-verified in this tree.

---

## 0. Verified facts that drive this plan

| # | Fact | Evidence |
|---|---|---|
| V1 | **The live outlet `roshani-pizza/pizza` is at −₹72.14** — paid ₹117.86, used ₹190.00, charges ₹0, 180 orders, `topUpDone: false`. | read-only Admin SDK recompute with the branch's `computeWallet` |
| V2 | The demo tenant is at **−₹910** — paid ₹3,490, used ₹1,294, charges ₹3,106, 353 orders. | same probe |
| V3 | `shared/cost-math.js` has a **top-level `await import('node:assert')`** (line 46) → `require()` throws `ERR_REQUIRE_ASYNC_MODULE`. The server must `await import()` it. | `node -e "require('./shared/cost-math.js')"` |
| V4 | `outletIndex` is **not** what builds the QR link. It is required by the `admins/$uid` create rule (`businessId == outletIndex[outlet].bid`) and the `riderIndex/$uid` validate — i.e. **staff and rider creation fail without it**. | `database.rules.json` + `riders.js:419` + `staff-management.js:116` |
| V5 | `inquiries/$id` requires `source == 'website'`; auto-approval writes `source: 'auto-onboarding'` and can write `phone: ''`. Supreme's mark-as-read then fails validation. | `database.rules.json` inquiries block |
| V6 | `adminLogin` has **no rule of its own** and inherits `businesses/$bid/.read`, which every staff role of the business can read. The plaintext owner password is visible to cashiers/waiters. | rules + `SupremeAdmin/js/features/templates/admin-creds.js:23` |
| V7 | The Admin chat QR overlay reads `bot/{outlet}/pair`; the bot writes `bot/pair`. Baileys outlets never show a QR there. | `Admin/js/features/chat.js:393` vs `bot/index.js:2086` |
| V8 | There is **no Admin-side WhatsApp connect UI**. Connection is Supreme-only (`whatsapp-manage.js`, `whatsapp-linking.js`, `restaurant-profile.js`). | code search |
| V9 | The patched `main.js` click gate is **dead on setup tabs** (`!SETUP_TABS.includes(state.currentActiveTab)` makes the condition false). | `main.js:149` |
| V10 | Spark plan allows **1,000 verification emails/day**, 10,000 verification links/day, 100 account creations/hour/IP. | Firebase Auth limits doc, 2026-10-20 |
| V11 | `locked` is already a node with an auth-only read rule; the unauthenticated menu cannot read it, so a locked outlet's table QR fails at checkout with "scan the QR again". | rules + `menu/js/session.js` |

---

## 1. F1 — Setup mode: from a status list to a guided flow

**Verdict: adding `chat` to `SETUP_TABS` would be the wrong fix.** `chat` is the customer-conversation tab, not a WhatsApp connection screen, and the connection screen it does contain is broken (V7) and Supreme-only (V8). The checklist must adapt to the product, not widen the lock to fit a wrong link.

### 1.1 What is actually broken (ranked)

| # | Sev | Problem | Why it matters |
|---|---|---|---|
| F1-1 | **P1** | The WhatsApp step links to `chat`, which is locked **and** has no working connect UI. | The one optional step a new owner might act on shows the paywall, then a dead QR. |
| F1-2 | **P1** | The top-up step is the only blocking step, but `support \|\| canOpen` replaces its "Do this next" button with "Contact support". | The single step that unlocks the restaurant is the only row that can never be highlighted. |
| F1-3 | **P1** | The checklist renders on **live** outlets too. `topUpDone` is `paid >= 1000`, so `roshani-pizza` (paid ₹117.86) sees "Top up ₹1,000 to go live" on a live dashboard. | False billing prompt on the owner's own live restaurant. |
| F1-4 | P2 | "Add your first menu item" dead-ends: a new tenant has no categories, and the Add Dish modal cannot save without one. There is no category step. | Hard stop inside a modal with no route to the fix. |
| F1-5 | P2 | Table QRs printed during setup are unusable; the menu app has no `locked` gate, so the customer builds a cart and gets "Could not start session. Please scan the QR code again." | Blames the customer for a restaurant-side state. |
| F1-6 | P2 | `canOpen === false` renders no button and no explanation (role-denied, or needs-live). | Silent dead row. |
| F1-7 | P2 | Managers never see the checklist (`canAccessTab('settings')` gate; managers exclude settings). | The person doing setup on-site sees nothing. |
| F1-8 | P2 | Locked dashboard still shows dead operational controls: promo kill switch (no listener), "Bot offline", "View All" → Orders popup, "Manage" → Riders popup. | First screen is a minefield of paywalls and broken toggles. |
| F1-9 | P3 | `state.locked` survives logout; the unlock reload discards unsaved Settings; the URL hash keeps the blocked tab; the mobile banner slides under the fixed header; `leaveSetupMode` has zero callers. | Confusing edge states. |

### 1.2 The redesigned flow

**Principle: one primary action at a time, and every primary action is achievable by the person clicking it.**

Panel layout:
1. **Hero** — the next required step only: title, one-line why, primary button. If the next step is top-up, the primary is "Contact support to top up" and the secondary is "See wallet".
2. **Progress** — `n of 7 done`, one bar.
3. **Compact list** — read-only status (tick / empty / checking), no duplicate buttons. Optional steps are marked.

Steps (7, in the real dependency order):

| # | Step | Required | Done when | Primary action |
|---|---|---|---|---|
| 1 | Restaurant name and address | yes | `settings/Store.storeName` **and** `address` | Settings → General, focus the first empty field (`#settingStoreName` / `#settingStoreAddress`) |
| 2 | Create a menu category | yes | `categories` non-empty | Categories tab, open `#btnAddCategory` |
| 3 | Add your first dish | yes | `dishes` non-empty | Menu tab, open `#btnAddDishChoice` |
| 4 | Add tables for QR ordering | no | `tables` non-empty | Tables tab, open `[data-action="openAddTable"]` |
| 5 | Connect WhatsApp ordering | no | `whatsapp/status === 'active'` | **Support handoff** (no tab) |
| 6 | Top up your wallet (min ₹1,000) | yes | `billing` paid ≥ 1,000 | Costs → Wallet; primary "Contact support", secondary "See wallet" |
| 7 | Take your first order | no | `orders` non-empty | POS, only after unlock; before unlock: disabled with "Available after you go live" |

WhatsApp step copy:
- `status: 'pending'` → "We're connecting your WhatsApp — we'll message you when it's ready." (no button)
- otherwise → "WhatsApp ordering is connected by FoodHubbie." + **"Ask us to connect it"** → `wa.me` prefilled with the outlet name.

Deep-link helper (reuse the existing `notifications.js` highlight pattern):
`gotoStep(task)` → `await switchTab(tab)` → optional subtab click → `focus()` + `scrollIntoView` + a 5 s highlight class → optional open-modal click after a tick.

Locked dashboard:
- Hide the promo kill widget, the bot-status card and the operational "View All / Manage" links while locked.
- Keep: setup checklist, wallet alert, and a short "what unlocks when you go live" list (orders, POS, KDS, riders, reports).
- The checklist renders **only when `state.locked`** (fixes F1-3). After unlock, the wallet alert owns the low-balance message.

`SETUP_TABS`:
- **Do not add `chat`.**
- **Add `discounts`** — a new outlet can prepare offers before going live; the tab has no operational side effects.
- Leave `promotions` out (campaign sends need a live bot and spend tokens).

### 1.3 Implementation (as built)

| File | Change |
|---|---|
| `Admin/js/features/setup-checklist.js` | Rewritten: 7 dependency-ordered steps, required-only hero, derived progress, CSS marks, `gotoStep` deep links, `openSupport` hand-off, `canGo` (no `needsLive` while locked), audience gate on `canAccessTab('menu')`, render only when `state.locked` |
| `Admin/js/ui.js` | `SETUP_TABS` += `discounts`; `supportWa(text)` next to `SUPPORT_WA`; `enterSetupMode` adds `body.setup-mode`, rewrites the hash, dims closed nav; `leaveSetupMode` restores everything |
| `Admin/js/auth.js` | Clear `state.locked` + `currentActiveTab` + `leaveSetupMode()` on logout; unlock reload guarded by `state.settingsDirty` (toast instead) |
| `Admin/js/main.js` | Dead action-level gate + `SAFE_ACTIONS` removed (the comment explains why); dashboard shortcuts get `setup-hide` in `index.html` |
| `Admin/js/features/chat.js` | `bot/${outlet}/pair` → `bot/pair` (V7; fixes the QR overlay for Baileys in normal operation) |
| `Admin/js/features/wallet-alert.js` | Silent while `state.locked` — the checklist owns the wallet message, no duplicate/contradictory alert |
| `Admin/style.css` | Self-contained `.setup-*` block, `.setup-flash`, `body.setup-mode` widget hiding, `.is-setup-locked`, mobile + reduced-motion rules |
| `Admin/index.html`, `Admin/sw.js` | `setup-hide` on two dashboard shortcuts; `style.css?v=5.4.8`; shell `v5.12.5` |
| `menu/js/*`, `database.rules.json` | **Not in this change set** — the menu-side "not accepting orders yet" screen belongs to D4 (phase 3), not F1 |

Verification actually run: encoding, imports, shared twins, `auto-onboarding` 10/10, `admin-wallet-checklist` 3 suites (checklist 14 cases incl. the deep-link contract), `signup-onboarding` 12/12, `gate-verify` PASS, both builds, and a real built-app boot in `?demo=1` (0 console errors, 7 steps, banner, wallet alert hidden, 14 nav tabs dimmed / 11 open, all five deep-link targets present).

---

## 2. F2 — Tenant parity: the auto-approved tenant must equal the wizard tenant

**Verdict: `outletIndex` is one of four real gaps, and my earlier rationale for it was wrong.** It does not build the QR link (V4); it is the rule dependency for **staff and rider creation**. The full review found three more production-grade issues.

### 2.1 Gap list

| # | Sev | Gap | Consequence |
|---|---|---|---|
| G1 | **P1** | `outletIndex/{oid}` missing | Owner cannot add staff (`admins/$uid` create rule fails) and cannot add riders (`riderIndex` validate fails). Both fail **after** the Auth user is created → orphan accounts. |
| G2 | **P1** | Duplicate-email guard is not idempotent | If the tenant write fails after the Auth user is created, every retry returns 409 → the watcher marks the request **rejected** and never retries. Orphan Auth user + orphan `admins/{uid}`. |
| G3 | **P1** | `inquiries` writes an out-of-schema record (`source:'auto-onboarding'`, `phone:''`) | Supreme can never mark the notification read → permanent "new" badge. |
| G4 | P2 | `adminLogin` never written | Supreme profile shows "No admin login stored yet". |
| G5 | P2 | `adminLogin.password` is world-readable to the tenant's staff (V6) | The owner's plaintext password is exposed to every cashier/waiter. Pre-existing, but auto-approval would spread it to every new tenant. |
| G6 | P2 | `whatsappConnect` is accepted and discarded | Supreme cannot tell a Meta applicant from a QR one. |
| G7 | P2 | `autoApproved: true` is out of schema (`$other:false`) | Any future client write to that request is rejected. Redundant with `reviewedBy:'auto-onboarding'`. |
| G8 | P3 | `adminName` is collected and thrown away | `admins/{uid}.name` gets the outlet name instead of the person's name. |
| G9 | P3 | Wizard tenants are created **unlocked**; website tenants are locked | Two onboarding paths, two commercial rules. Needs an owner decision, not a code guess. |

### 2.2 Exact writes

Inside the existing multi-path `update()` in `approveOnboardingRequest`:

```js
const now = admin.database.ServerValue.TIMESTAMP;
await admin.database().ref().update({
  [`businesses/${bid}`]: {
    name: businessName,
    contactPhone: contactPhone || null,
    contactEmail: contactEmail || null,
    plan: plan || 'starter',
    createdAt: now,
    outlets: {
      [oid]: {
        name: outletName,
        contactPhone: contactPhone || null,
        createdAt: now,
        ...(outletNo ? { outletNo } : {}),
        // Template data FIRST; identity/security fields after it. A stray key in an
        // operator-authored template must never unlock the outlet or rewrite its login.
        ...(tplDefaults || {}),
        whatsapp: { status: 'pending', ...(whatsappConnect ? { requestedConnect: whatsappConnect } : {}) },
        locked: true,
        adminLogin: { email: adminEmail, updatedAt: now },   // email only — never the plaintext password (G5)
        billing: getBillingDefaults(),
        settings: { ...(tplDefaults?.settings || {}), features: { ...(tplDefaults?.settings?.features || {}), discountApproval: false } },
      },
    },
  },
  // staff + rider rules validate against this
  [`outletIndex/${oid}`]: { bid, name: outletName, createdAt: now },
  ...bankUpdates,
});
```

Notes:
- `adminLogin` must be nested inside the outlet object — a sibling `businesses/{bid}` + `outlets/{oid}/adminLogin` pair is ancestor/descendant and Firebase rejects it.
- Do **not** add `disabled:false` to `outletIndex`; absent means enabled.
- `adminLogin` gets `{email}` only. Supreme keeps its "Update password" action (it calls `/api/admin/update-password`); the password is never stored at rest. A one-time cleanup should null existing `adminLogin/password` values (dry-run first).
- `requireEmailVerification: true` was in the draft of this snippet but belongs to D2 (§3) and is **not** shipped in this change set.

Retry safety (G2) — shipped:

```js
// bid/oid are decided first but only STAMPED after the duplicate-email check: the stamp is
// the "this request may own an Auth user" marker. Stamping earlier would let a first attempt
// that dies on a duplicate leave a marker behind, and attempt 2 would adopt a stranger's
// account instead of rejecting it.
const isRetry = Boolean(reqData.bid && reqData.oid);
const bid = reqData.bid || admin.database().ref('businesses').push().key.toLowerCase();
const oid = reqData.oid || admin.database().ref(`businesses/${bid}/outlets`).push().key.toLowerCase();

// duplicate check: reject on a first attempt, tolerate our own half-done one
try {
  await admin.auth().getUserByEmail(adminEmail);
  if (!isRetry) throw httpError(409, `Admin email ${adminEmail} already exists`);
} catch (err) {
  if (err instanceof HttpError) throw err;
  if (err.code !== 'auth/user-not-found') throw err;
}

if (!isRetry) await admin.database().ref(`onboardingRequests/${reqKey}`).update({ bid, oid });
```

The draft of this plan proposed detecting "our own half-done attempt" by reading `admins/{uid}.outlet`. That read is unnecessary and ambiguous (an existing account may legitimately have an outlet): the request's own `bid`/`oid` stamp is the exact, local marker. A retry also reuses the `outletNo` a previous attempt already assigned (a retry that never reached the outlet write allocates one, which only leaves a gap in the label sequence — never a duplicate).

`notifySupreme` (G3) — shipped:

```js
const phone = String(extra.phone || '').trim();
await admin.database().ref('inquiries').push({
  name: String(title).slice(0, 80),
  phone: phone.length >= 5 && phone.length <= 15 ? phone : '0000000000',
  type: 'New restaurant signup',
  message: String(message).slice(0, 2000),
  store: String(extra.store || '').slice(0, 80),
  source: 'website',              // rules require exactly this
  createdAt: Date.now(),
});
```

`status` is **omitted on purpose**: `inquiries/$id` only allows absent or `'read'`, so writing `status: 'new'` (as the earlier draft did) made the record impossible to mark read.

Drop `autoApproved: true` (G7). Use `adminName` for `admins/{uid}.name` (G8). Record `requestedConnect` (G6).

### 2.3 Tests

`tests/auto-onboarding.check.cjs` — 10 cases, all green:
1. Happy path: `outletIndex/{oid} === {bid, name, createdAt}`, `adminLogin` has **no** password, secret burned, `reviewedBy === 'auto-onboarding'`, inquiry shape valid.
2. Template data cannot override `locked` / `adminLogin` / `whatsapp`.
3. Missing password → retried, left pending, Supreme told.
4. Duplicate email → rejected, nothing created, **no `bid`/`oid` stamp left behind**.
5. Retry with stamped ids → resumes, one tenant, existing Auth user adopted.
6. Retry with an outlet already written → the previous `outletNo` is reused, counter untouched.
7. Hourly cap → left pending.
8. Already-approved / non-website requests ignored.
9. Short password never creates an account.
10. Requests pending before the API started (old / legacy) are not auto-approved.

Optional live rules probe (client idTokens): a throwaway outlet without `outletIndex` → `riderIndex` write 401 and `admins` create 401; add the index → 200. This converts G1 from "read the rules" to "proven".

---

## 3. D2 — Firebase email verification on the free plan

**Answer: yes.** On Spark, Firebase Auth allows **1,000 address-verification emails/day** and **10,000 verification links/day** (V10). The built-in sender needs no SMTP and no Cloud Functions. Account creation is capped at 100/hour/IP — our auto-approval cap is 20/hour, so no conflict.

### 3.1 Flow

1. Signup creates the Auth user (unverified) + the locked tenant, as today.
2. On first login, the Admin app sees `!auth.currentUser.emailVerified` and shows a banner: "Verify your email — we sent a link to `a@x.com`." + **Resend** (throttled 1/min) + "Check again".
3. `sendEmailVerification(auth.currentUser, { url: 'https://foodhubbie-admins.web.app/' })` sends the built-in email. The owner can still set up the menu, tables and settings while unverified.
4. **Go-live requires verification**: Supreme's unlock action checks `getUser(uid).emailVerified` (new tiny `GET /api/admin/outlet-admin-status?bid&oid` returning `{email, emailVerified}`) and refuses with a clear message.
5. **Cleanup**: a daily sweep deletes tenants that are still unverified after 72 h — Auth user, `admins/{uid}`, `businesses/{bid}` (if this is its only outlet), `outletIndex/{oid}`, and marks the request `expired`. Scoped to `reviewedBy === 'auto-onboarding'`, never `foodhubbie-demo`, never a tenant with orders or payments. Log-only unless `ONBOARDING_CLEANUP=enforce`.

### 3.2 Why this shape

- The user chooses the password and logs in immediately, so the client can send the verification email — no SMTP, no server mail, no Blaze.
- Verification happens **before money changes hands** (Supreme unlock), so a squatted email never becomes a live restaurant.
- The 72 h cleanup frees the email address for the real owner.
- We do **not** use email-link sign-in: Spark allows only **5/day** (the docs are explicit), which would break the flow.

### 3.3 Limits

- Built-in emails come from `noreply@<project>.firebaseapp.com`; some inboxes will file them as spam. Copy must say "check spam".
- 1,000/day is plenty for onboarding; resend is client-throttled.
- This does not stop someone from verifying an email they control — it stops them from claiming an email they do not control.

### 3.4 As built (2026-10-31) — commit `c1e7a67`, deployed

Shipped as planned, with four changes forced by the live run:

- **No continue URL.** `sendEmailVerification(user)` uses Firebase's default action page. `{ url: 'https://foodhubbie-admins.web.app/' }` failed every send with `auth/unauthorized-continue-uri` — that host is not in Auth → Settings → Authorized domains. The default page always works and needs no account config; the banner's "Check again" is the return path.
- **Banner is self-contained** (`Admin/js/features/email-verify.js`): the module creates `#emailVerifyBanner` and its inline styles, so `Admin/index.html` and `Admin/style.css` were not touched. It auto-sends once per device (`localStorage` `fh:emailVerifySent:{uid}`), then shows a 60 s countdown on **Resend** (the countdown must also start after the automatic send — the first live E2E caught it missing), and **Check again** calls `user.reload()`. Hidden for `isSuper`/`isSupreme`/`isDemo` and in demo mode.
- **Unlock gate** (`SupremeAdmin/js/features/restaurant-profile.js` → `GET /api/admin/outlet-admin-status?bid&oid`, `requireSuperOnly`): refuses only on an explicit `emailVerified: false`; `null` (no `adminLogin.email` — every legacy outlet) is never gated; a network/5xx answer warns and unlocks, so an API outage cannot trap a tenant. `missing: true` (Auth user gone) counts as unverified.
- **Cleanup** (`runUnverifiedCleanup`): first pass 10 min after boot, then every 24 h, `unref()`ed. Observe mode by default (`ONBOARDING_CLEANUP=enforce` deletes). Removes the Auth user, the `admins/{uid}` row **only while it still points at that outlet**, the outlet (or the business when it is the only outlet) and `outletIndex/{oid}`, then marks the request `expired`. Skips manual approvals, the demo tenant, and any tenant with an order or a payment; a tenant that is already gone only gets its request marked.

Verified: `tests/auto-onboarding.check.cjs` 16/16 (status helper, observe, enforce, every spare rule, sibling outlet, re-pointed mirror); live E2E 8/8 on the deployed Admin with a throwaway unverified user (banner + address, auto-send stamp, 60 s throttle, "not verified yet", banner hides after `emailVerified:true`, 0 page errors; user and `admins` row deleted); built `?demo=1` boots with 0 console errors and no banner; shell `v5.12.11`; EC2 logs `[onboarding-cleanup] armed — 72h unverified TTL, observe mode`.

---

## 4. D4 — Wallet gates: pause the bot at 10%, close ordering at 0

### 4.1 Blocker: the live ledger is already negative

`roshani-pizza/pizza` is at **−₹72.14** (V1). Shipping "≤ 0 ⇒ ordering closed" in enforcing mode **turns off the owner's own QR ordering on deploy**, and pauses the live bot. The demo tenant is at −₹910 (V2).

Therefore:
1. The writer ships in **observe mode** (`enforce: false`). It computes and records the state, but `orderGate` stays `open`.
2. The live ledger is reconciled (was ₹190 of usage genuinely unpaid, or are payments under-recorded?).
3. Only then is `enforce` flipped per outlet from Supreme.

Also note: `topUpDone` is `paid >= 1000`, so the live outlet currently fails it — the reason F1-3 (false "top up ₹1,000" prompt) must be fixed before this ships.

### 4.2 Thresholds

| Gate | Condition | Rationale |
|---|---|---|
| Warning (existing) | `balance <= paid × 0.25` | Early warning; unchanged |
| **Bot pause** | `balance <= ₹100` | Flat 10% of `MIN_TOPUP`. A hard gate must be predictable; 10% of lifetime paid grows forever and would cut off a tenant holding thousands in credit |
| **Ordering closed** | `balance <= ₹0` | The owner's rule |

`botStopPaise` is per-outlet overridable.

### 4.3 Data model

```jsonc
// PUBLIC — enforcement signal, boolean only, no money
businesses/{bid}/outlets/{oid}/orderGate = {
  "bot": "open" | "paused",
  "orders": "open" | "closed",
  "reason": "billing" | null,
  "at": 1790000000000
}

// PRIVATE — inherits billing's auth-gated read
businesses/{bid}/outlets/{oid}/billing/gate = {
  "computed": "open" | "bot_paused" | "closed",
  "enforce": false,
  "balancePaise": -7214, "paidPaise": 11786, "usedPaise": 19000, "chargesPaise": 0,
  "botStopPaise": 10000,
  "at": 1790000000000, "by": "wallet-gate"
}
```

Absent node = open. Every rule reads `orderGate/orders != 'closed'`, matching the existing `disabled != true` idiom, so the deploy order is safe.

### 4.4 Enforcement matrix

| Surface | Enforced by | Behaviour |
|---|---|---|
| QR boot | menu client | full-screen "Not accepting orders right now" |
| QR order create + `Pending→Placed` | rules | 401 |
| Dine-in session create | rules | 401 |
| Table request | rules | 401 |
| Delivery boot + order create | menu client + rules | same screen / 401 |
| WhatsApp bot inbound | bot (`orderGate` listener) | new messages dropped; in-flight flow completes; transactional order notices continue |
| POS / walk-in | **not gated** | staff must bill; ₹1 fee accrues as debt |
| Admin dashboard | **not gated** | staff can log in and see why |
| Open sessions / placed orders | **not gated** | staff can close the bill |

### 4.5 The "404 page" — what is actually possible

A real HTTP 404/503 for a QR scan is **not achievable on this stack**:
- `firebase.json` rewrites every menu path to `/index.html` (200).
- Hosting has no request-time access to RTDB, so a static 404 cannot be conditional on a database value.
- A dynamic status code needs Cloud Functions or Cloud Run (Blaze).

**Recommendation: an in-app screen at HTTP 200.** The customer sees exactly what the owner asked for, plus the outlet name, a support link and a working "Try Again" button. A static 404 would lose all of that for a status code that no diner ever sees.

Screen copy (never mention billing, wallet or the owner's account):
> **Not accepting orders right now**
> {Restaurant} has paused online ordering temporarily. Please ask a staff member, or contact the restaurant directly.
> [Try Again]

Reuse the existing `#screenDisabled` markup pattern; new id `#screenPaused`; the `disabled` copy stays separate (platform kill switch vs wallet gate).

### 4.6 Recovery

```
Supreme records payment → billing/payments write
  → bot-control-api payments listener (~100 ms)
  → computeWallet > 0 → one update(): orderGate open + billing/gate computed=open
  → bot listener resumes instantly · next menu boot reads open
```

No change to the Supreme payment modal.

### 4.7 Edge cases

| Case | Decision |
|---|---|
| Open dine-in sessions when the gate flips | keep open; block new orders only |
| Order in `Pending` at the flip | client cancels it; excluded from billing |
| Delivery webview | gate it (₹5/order is the most expensive channel) |
| POS | never gate |
| Bot in-flight | finish the current handler; drop new inbound |
| Grace period | none initially (owner asked for a hard stop); a 2-scan grace is ~3 lines if wanted later |
| Multiple outlets | per outlet, automatic |
| Percentage mode | no special case; `computeWallet` already honours it |
| Demo tenant | hard skip (`bid === 'foodhubbie-demo'`) + `enforce:false` |
| "10%" meaning | flat ₹100 for the bot, ₹0 for ordering |
| Negative balances | allowed; gate closed |
| bot-control-api down | gate goes stale; Baileys bots keep running — documented limitation, do not add a second writer |

### 4.8 Implementation

| # | File | Change | ~LOC |
|---|---|---|---|
| 1 | `shared/cost-math.js` | `BOT_STOP_PAISE = 100` + pure `gateFor({ wallet, enforce, botStopPaise })`; extend the self-check with boundary asserts | +25 |
| 2 | `bot-control-api/wallet-gate.js` (new) | boot scan; `billing/payments` + `billing/charges` listeners; 5-min interval; demo skip; transition logs | ~90 |
| 3 | `bot-control-api/server.js` | `startWalletGate({ admin })` next to the status watcher | +2 |
| 4 | `database.rules.json` | `orderGate` public read + super/supreme write; `orders != 'closed'` on 3 order branches + session create + table request | +8 |
| 5 | `menu/js/session.js` | read `disabled` + `orderGate/orders` in one `Promise.all`; `OUTLET_PAUSED` | +8 |
| 6 | `menu/js/app.js` | handle `OUTLET_PAUSED` → `#screenPaused`; live `onValue(orderGate)` | +12 |
| 7 | `menu/index.html` | `#screenPaused` block | +9 |
| 8 | `menu/js/delivery.js` | boot gate + checkout guard | +6 |
| 9 | `menu/sw.js` | `menu-shell-v29` → `v30` | 1 |
| 10 | `bot/index.js` | `orderGate` listener + inbound guard | +12 |
| 11 | `Admin/js/features/wallet-alert.js` | third state "Ordering paused — top up to resume" | +15 |
| 12 | `SupremeAdmin/js/features/payment-record.js` | show `billing/gate` + `enforce` toggle (super only) | +20 |

**Implementation gotcha (V3):** `bot-control-api` is CJS and `shared/cost-math.js` has top-level await. `require()` throws `ERR_REQUIRE_ASYNC_MODULE`; use `const { computeWallet } = await import('../shared/cost-math.js')` in an async init. Do not copy the `bot/discount-engine.js` `require(esm)` pattern — that file has no TLA.

### 4.9 Rollout

1. Ship `cost-math` + `wallet-gate.js` in observe mode (`enforce:false`). No UI, no rules change. Watch `billing/gate.computed` against the dashboard for a few days.
2. Reconcile the live ledger (V1) — owner decision.
3. Ship rules + menu + bot (all read a node that is `open`).
4. Flip `enforce:true` per outlet from Supreme, one at a time.

---

## 5. D3 / D5 — pricing

Owner decision recorded:
- **₹500** = one-time setup assistance (operator-assisted onboarding).
- **₹1,000** = minimum wallet balance required to start taking orders (usable for order fees; not a setup fee).

Action now: **do not change marketing copy in this change set.** Add a Pending-Work item to reconcile, in one pass:
- `website/pricing*`, `PRICING_AND_TERMS.md`, `llms.txt`, `website/signup.html`, `SupremeAdmin` plan cards.
- Make the two numbers explicitly different things ("setup assistance" vs "wallet balance to start").
- Percentage package visibility (D5) in the same pass.

---

## 6. D6 — what `SETUP_TABS` is (plain explanation)

When an outlet is **locked** (created but not yet topped up), the Admin app runs in **setup mode**:
- A slim banner says "Setup mode: add ₹1,000 to start taking orders."
- Most tabs are blocked with a "Top up to go live" popup.
- A short allowlist of tabs stays usable so the owner can actually prepare the restaurant.

`SETUP_TABS` is that allowlist. Today it is:

```
dashboard, menu, categories, combos, menu-browser, tables,
inventory, settings, costs, notifications
```

Everything else — Orders, POS, Kitchen Display, Riders, Customers, Loyalty, Chat, Reports, Payments, Expenses, Feedback, Live Tracker — is operations, so it is blocked until the wallet is funded.

The original question was whether to add two tabs:
- **`chat`** — the checklist's WhatsApp step pointed here. But `chat` is the customer-conversation tab; there is no working connect screen (V7, V8), and the real connection is done by Supreme. **Do not add it** — fix the checklist to hand off to support instead.
- **`discounts`** — safe to configure before going live (no messages sent, no orders created). **Add it.**

So the answer is: `SETUP_TABS` stays almost the same; the checklist stops pretending the owner can connect WhatsApp themselves.

---

## 7. Delivery order (when approved)

| Phase | Content | Gate |
|---|---|---|
| 0 | F1 UX + F2 parity on the branch | all checks below green |
| 1 | D2 email verification (client banner + Supreme check + cleanup job) | Spark quota confirmed; cleanup dry-run |
| 2 | D4 writer in observe mode | live `billing/gate.computed` matches the dashboard |
| 3 | D4 rules + menu + bot | live rules probe |
| 4 | Reconcile the live ledger, then flip `enforce` per outlet | owner sign-off |
| 5 | D3/D5 marketing pass | copy review |

### Verification for phases 0–1

```
node shared/cost-math.js
node tests/encoding-check.mjs
node tests/check-imports.mjs
node tests/auto-onboarding.check.cjs          # 10/10 (parity + retry cases)
node tests/admin-wallet-checklist.check.mjs   # 3 suites
node tests/signup-onboarding.check.mjs        # 12/12
node tools/check-shared-twins.cjs             # 5/5
node gate-verify.js                           # PASS
node tools/build.mjs --admin && node tools/build.mjs --supreme
```

Plus the browser probes already proven: built Admin in `?demo=1`, setup mode 7/7 steps, Supreme boot 0 errors.

**Phase 0 status: implemented and verified on `onboarding-setup-checklist`** (`83f4fbb`, `9d3109f`, `7357102`). Merging into `seo-brand-consistency` conflicts only on two version lines — resolved by one bump above both branches: shell `v5.12.10`, `style.css?v=5.4.13`. The merged tree was re-verified (all checks + both builds + built-app boot 0 errors, all deep-link targets present after the Categories redesign).

### Rollback

| Layer | Rollback |
|---|---|
| Rules | redeploy the previous `database.rules.json` |
| wallet-gate | set `enforce:false` (instant), then remove the module |
| Bot | remove the `orderGate` listener |
| Menu | redeploy the previous hosting build |
| Email verification | remove the banner + the cleanup flag; existing tenants unaffected |

---

## 8. Decisions needed before implementation

| # | Decision | Recommendation |
|---|---|---|
| D4-1 | **Live ledger is −₹72.14.** Was ₹190 of usage unpaid, or are payments under-recorded? | Reconcile before any enforcement; ship observe-only until then |
| D4-2 | Bot pause threshold: flat ₹100 or 10% of lifetime paid? | Flat ₹100 |
| D4-3 | Gate delivery webview at ₹0 too? | Yes (₹5/order) |
| D4-4 | Bot at 10%: silence or one canned reply? | Silence (cheapest, no ban surface) |
| D4-5 | POS gated at ₹0? | No — staff must bill; debt accrues |
| D2-1 | Delete unverified tenants after 72 h? | Yes, scoped to auto-approved, no orders/payments, never demo |
| F1-1 | Add `discounts` to `SETUP_TABS`? | Yes |
| F1-2 | 7-step checklist (adds "Create a category")? | Yes |
| F2-1 | Stop storing plaintext `adminLogin.password` everywhere (incl. the wizard)? | Yes — email only + reset-password action |
| F2-2 | Wizard-created tenants: should they also start locked? | Owner call; website tenants are locked, wizard tenants are not |
