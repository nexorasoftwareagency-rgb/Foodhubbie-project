# Change Guide: Before and After

> Exact changes made by the `feat/onboarding-setup-checklist` change set, compared with `main` at commit `a4392f1`.
> Line numbers are generated from `git diff` (old = `main`, new = after the patch). Each change shows **where**, **what**, **before code**, **after code**, and **effect**.
> If your `main` has moved, line numbers will shift slightly; use the code and the nearby text to locate each change.

## 1. How much changed

| Kind | Lines added | Lines removed | Net |
|---|---:|---:|---:|
| Production code and rules | 719 | 130 | +589 |
| New tests | 248 | 0 | +248 |
| Docs and guides | 2342 | 0 | +2342 |
| **Total** | **3309** | **130** | **+3179** |

22 files touched: 14 existing files modified, 2 new production files, 3 new test files, 3 docs.

## 2. Summary by file

| File | Added | Removed | Changes | What it does |
|---|---:|---:|---:|---|
| `database.rules.json` | 4 | 3 | 4 | Lock enforced server-side for order-creating paths. |
| `bot-control-api/server.js` | 104 | 12 | 8 | Auto-approval of website sign-ups; manual approval unchanged. |
| `Admin/js/ui.js` | 54 | 12 | 6 | Setup-only mode and dashboard hooks. |
| `Admin/js/auth.js` | 5 | 4 | 2 | Use setup mode instead of the full block. |
| `Admin/js/main.js` | 4 | 2 | 2 | Locked gate only blocks operations tabs. |
| `Admin/index.html` | 46 | 1 | 3 | Dashboard alert/checklist containers and the Wallet view. |
| `Admin/js/features/costs.js` | 73 | 7 | 10 | Wallet view and percentage-aware labels. |
| `shared/cost-math.js` | 76 | 0 | 4 | Wallet, 25% rule and percentage package in one place. |
| `SupremeAdmin/js/billing-shared.js` | 14 | 2 | 3 | Percentage mode and unlock reminder. |
| `SupremeAdmin/js/features/payment-record.js` | 2 | 4 | 2 | Rate label. |
| `SupremeAdmin/js/features/payment-overview.js` | 8 | 1 | 5 | Low-balance visibility. |
| `SupremeAdmin/js/features/restaurant-profile.js` | 14 | 9 | 2 | Per-restaurant package switch. |
| `SupremeAdmin/js/features/templates/billing-card.js` | 6 | 5 | 4 | Package display and buttons. |
| `website/signup.html` | 137 | 68 | 11 | Inline validation, no duplicate submissions, correct copy and success state. |
| `Admin/js/features/setup-checklist.js` (NEW) | 110 | 0 | whole file | Dashboard setup checklist. |
| `Admin/js/features/wallet-alert.js` (NEW) | 62 | 0 | whole file | Dashboard low-balance banner. |
| `tests/signup-onboarding.check.mjs` (NEW) | 69 | 0 | whole file | Mocked-network test of the sign-up form (12 checks). |
| `tests/auto-onboarding.check.cjs` (NEW) | 80 | 0 | whole file | Runs the real server functions against a fake Admin SDK (6 checks). |
| `tests/admin-wallet-checklist.check.mjs` (NEW) | 99 | 0 | whole file | Runs real costs/checklist/alert modules against stubs (3 suites). |

## 3. Changes to existing files

### `database.rules.json`

**Database security rules.** +4 / -3 lines in 4 change(s). Lock enforced server-side for order-creating paths.

#### database.rules.json change 1 of 4: old lines 163-165 -> new lines 163-165 (+1 / -1)

**What:** `orders/$orderId` `.write`: new first condition. Writes are allowed only if the outlet is NOT `locked`, or the writer is Super/Supreme. The original rule is kept unchanged inside the parentheses.

**Effect:** A locked outlet can no longer create or change orders (staff, QR customers, WhatsApp webview, riders). Unlocked or `locked` absent: identical to before.

Before (`main`):
```json
  163 |                 ".read": "(auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true || root.child('admins').child(auth.uid).child('outlet').val() == $outletId || (root.child('riders').child(auth.uid).exists() && root.child('riders').child(auth.uid).child('outlet').val() == $outletId && (!da...
  164 |                 ".write": "(auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true || root.child('admins').child(auth.uid).child('outlet').val() == $outletId || (root.child('riders').child(auth.uid).exists() && root.child('riders').child(auth.uid).child('outlet').val() == $outletId && dat...
  165 |                 ".validate": "newData.hasChildren(['items', 'total', 'status', 'createdAt']) && newData.child('total').isNumber() && newData.child('status').isString() && newData.child('createdAt').isString() && (!newData.hasChild('subtotal') || newData.child('subtotal').isNumber()) && (!newData.hasChild('tax') || newData.child('tax').isNumber()) && (!newData.hasChild('serviceCharge') || n...
```

After:
```json
  163 |                 ".read": "(auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true || root.child('admins').child(auth.uid).child('outlet').val() == $outletId || (root.child('riders').child(auth.uid).exists() && root.child('riders').child(auth.uid).child('outlet').val() == $outletId && (!da...
  164 |                 ".write": "(root.child('businesses').child($businessId).child('outlets').child($outletId).child('locked').val() != true || (auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true))) && ((auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true |...
  165 |                 ".validate": "newData.hasChildren(['items', 'total', 'status', 'createdAt']) && newData.child('total').isNumber() && newData.child('status').isString() && newData.child('createdAt').isString() && (!newData.hasChild('subtotal') || newData.child('subtotal').isNumber()) && (!newData.hasChild('tax') || newData.child('tax').isNumber()) && (!newData.hasChild('serviceCharge') || n...
```

#### database.rules.json change 2 of 4: old lines 469-471 -> new lines 469-471 (+1 / -1)

**What:** Same gate on `tableSessions/$sessionId` `.write`.

**Effect:** Locked outlet cannot open or change table sessions (QR dine-in).

Before (`main`):
```json
  469 |                 ".read": "true",
  470 |                 ".write": "(auth != null && (root.child('admins').child(auth.uid).child('outlet').val() == $outletId || root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true)) || (root.child('businesses').child($businessId).child('outlets').child($outletId).child('disabled').val() != true && (!data.exist...
  471 |                 "orders": {
```

After:
```json
  469 |                 ".read": "true",
  470 |                 ".write": "(root.child('businesses').child($businessId).child('outlets').child($outletId).child('locked').val() != true || (auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true))) && ((auth != null && (root.child('admins').child(auth.uid).child('outlet').val() == $outlet...
  471 |                 "orders": {
```

#### database.rules.json change 3 of 4: old lines 509-511 -> new lines 509-511 (+1 / -1)

**What:** Same gate on `tableRequests/$reqId` `.write`.

**Effect:** Locked outlet cannot receive waiter/bill requests.

Before (`main`):
```json
  509 |               "$reqId": {
  510 |                 ".write": "(!data.exists() && newData.hasChildren(['tableId','type','createdAt']) && newData.child('status').val() == 'pending' && root.child('businesses').child($businessId).child('outlets').child($outletId).child('disabled').val() != true) || (auth != null && (root.child('admins').child(auth.uid).child('outlet').val() == $outletId || root.child('admins').child(auth.uid).c...
  511 |                 ".validate": "newData.hasChildren(['tableId','type','createdAt'])"
```

After:
```json
  509 |               "$reqId": {
  510 |                 ".write": "(root.child('businesses').child($businessId).child('outlets').child($outletId).child('locked').val() != true || (auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true))) && ((!data.exists() && newData.hasChildren(['tableId','type','createdAt']) && newData.child...
  511 |                 ".validate": "newData.hasChildren(['tableId','type','createdAt'])"
```

#### database.rules.json change 4 of 4: old lines 614-615 -> new lines 614-616 (+1 / -0)

**What:** `onboardingRequests`: new `".indexOn": ["status"]`.

**Effect:** The auto-approval watcher queries pending requests by status; the index keeps that query efficient and removes a Firebase warning. No access change.

Before (`main`):
```json
  614 |     "onboardingRequests": {
  615 |       ".read": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true)",
```

After:
```json
  614 |     "onboardingRequests": {
  615 |       ".indexOn": ["status"],
  616 |       ".read": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true)",
```

### `bot-control-api/server.js`

**Onboarding API (runs on EC2).** +104 / -12 lines in 8 change(s). Auto-approval of website sign-ups; manual approval unchanged.

#### bot-control-api/server.js change 1 of 8: old lines 338-345 -> new lines 338-348 (+9 / -6)

**What:** Handler header replaced. New `HttpError` class, `httpError()` helper and the start of `approveOnboardingRequest(reqKey, f, reviewerUid)`, which receives the fields instead of reading `req.body`.

**Effect:** Approval logic can now be called by both the Supreme endpoint and the new watcher.

Before (`main`):
```js
  338 | // atomically. Called from the Supreme Admin onboarding-requests page.
  339 | app.post('/api/admin/approve-onboarding', requireSuperOnly, async (req, res) => {
  340 |   const { reqKey, businessName, outletName, contactPhone, contactEmail, adminEmail, plan, template, whatsappConnect } = req.body || {};
  341 |   if (!reqKey || !businessName || !outletName || !adminEmail) {
  342 |     return res.status(400).json({ error: 'reqKey, businessName, outletName, adminEmail are required' });
  343 |   }
  344 |   try {
  345 |     // Verify the request is still pending
```

After:
```js
  338 | // atomically. Called from the Supreme Admin onboarding-requests page.
  339 | class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  340 | const httpError = (status, message) => new HttpError(status, message);
  341 | 
  342 | // Core of onboarding approval, shared by the manual Supreme Admin endpoint and
  343 | // the auto-approval watcher below. Creates the Auth user, admins/{uid} mirror and
  344 | // the outlet (locked: true until the first wallet top-up is recorded). Throws
  345 | // HttpError for expected failures; any other throw is unexpected.
  346 | async function approveOnboardingRequest(reqKey, f, reviewerUid) {
  347 |   const { businessName, outletName, contactPhone, contactEmail, adminEmail, plan, template, whatsappConnect } = f;
  348 |     // Verify the request is still pending
```

#### bot-control-api/server.js change 2 of 8: old lines 347-350 -> new lines 350-353 (+2 / -2)

**What:** `return res.status(404)...` becomes `throw httpError(404, ...)` for 'not found' and 'already approved' (409).

**Effect:** Same status codes and messages; thrown instead of returned, so the function works without an HTTP response.

Before (`main`):
```js
  347 |     const reqData = reqSnap.val();
  348 |     if (!reqData) return res.status(404).json({ error: 'Onboarding request not found' });
  349 |     if (reqData.status !== 'pending') return res.status(409).json({ error: `Request already ${reqData.status}` });
  350 | 
```

After:
```js
  350 |     const reqData = reqSnap.val();
  351 |     if (!reqData) throw httpError(404, 'Onboarding request not found');
  352 |     if (reqData.status !== 'pending') throw httpError(409, `Request already ${reqData.status}`);
  353 | 
```

#### bot-control-api/server.js change 3 of 8: old lines 361-363 -> new lines 364-366 (+1 / -1)

**What:** 422 'password missing' becomes a thrown `httpError`.

**Effect:** Watcher can detect it and retry while the browser's password write lands.

Before (`main`):
```js
  361 |     if (!adminPassword || adminPassword.length < 6) {
  362 |       return res.status(422).json({ error: 'Password secret missing or too short — ask the applicant to re-submit.' });
  363 |     }
```

After:
```js
  364 |     if (!adminPassword || adminPassword.length < 6) {
  365 |       throw httpError(422, 'Password secret missing or too short — ask the applicant to re-submit.');
  366 |     }
```

#### bot-control-api/server.js change 4 of 8: old lines 367-369 -> new lines 370-372 (+1 / -1)

**What:** 409 'email already exists' becomes a thrown `httpError`.

**Effect:** Watcher marks the request rejected instead of creating a duplicate account.

Before (`main`):
```js
  367 |       const existing = await admin.auth().getUserByEmail(adminEmail);
  368 |       return res.status(409).json({ error: `Admin email ${adminEmail} already exists (uid: ${existing.uid})` });
  369 |     } catch (err) {
```

After:
```js
  370 |       const existing = await admin.auth().getUserByEmail(adminEmail);
  371 |       throw httpError(409, `Admin email ${adminEmail} already exists (uid: ${existing.uid})`);
  372 |     } catch (err) {
```

#### bot-control-api/server.js change 5 of 8: old lines 471-473 -> new lines 474-476 (+1 / -1)

**What:** `reviewedBy` uses `reviewerUid` instead of `req.auth.uid`.

**Effect:** Manual path: your uid as before. Auto path: records `auto-onboarding`.

Before (`main`):
```js
  471 |       reviewedAt: now,
  472 |       reviewedBy: req.auth?.uid || null,
  473 |       adminPassword: null,
```

After:
```js
  474 |       reviewedAt: now,
  475 |       reviewedBy: reviewerUid || null,
  476 |       adminPassword: null,
```

#### bot-control-api/server.js change 6 of 8: old lines 475-478 -> new lines 478-493 (+13 / -1)

**What:** End of the old handler: `res.json(...)` becomes `return {...}`. Followed by the NEW thin manual endpoint with the same route, body and response (`ok,bid,oid,uid,email,password,loginUrl`).

**Effect:** Supreme Admin's manual Approve button behaves exactly as before.

Before (`main`):
```js
  475 | 
  476 |     res.json({ ok: true, bid, oid, uid, email: adminEmail, password: adminPassword, loginUrl: 'https://foodhubbie-admins.web.app' });
  477 |   } catch (err) {
  478 |     console.error('approve-onboarding failed', err);
```

After:
```js
  478 | 
  479 |   return { bid, oid, uid, email: adminEmail, password: adminPassword };
  480 | }
  481 | 
  482 | // Manual approval (Supreme Admin UI). Unchanged contract: same body, same response.
  483 | app.post('/api/admin/approve-onboarding', requireSuperOnly, async (req, res) => {
  484 |   const { reqKey, businessName, outletName, contactPhone, contactEmail, adminEmail, plan, template, whatsappConnect } = req.body || {};
  485 |   if (!reqKey || !businessName || !outletName || !adminEmail) {
  486 |     return res.status(400).json({ error: 'reqKey, businessName, outletName, adminEmail are required' });
  487 |   }
  488 |   try {
  489 |     const r = await approveOnboardingRequest(reqKey, { businessName, outletName, contactPhone, contactEmail, adminEmail, plan, template, whatsappConnect }, req.auth?.uid);
  490 |     res.json({ ok: true, ...r, loginUrl: 'https://foodhubbie-admins.web.app' });
  491 |   } catch (err) {
  492 |     if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  493 |     console.error('approve-onboarding failed', err);
```

#### bot-control-api/server.js change 7 of 8: old lines 482-483 -> new lines 497-574 (+76 / -0)

**What:** NEW block: constants (`ONBOARDING_AUTO_APPROVE`, `AUTO_APPROVE_MAX_PER_HOUR`), `notifySupreme()`, `autoApproveOne()` (hour cap, 15-minute freshness limit, retries, duplicate email -> rejected, notifications) and `startAutoApproval()` (listener on pending requests).

**Effect:** New website sign-ups become locked restaurants within about a minute and you get a Notifications entry. Over the hourly cap, older than 15 minutes (for example already pending when the API restarts), or on error, the request stays pending for manual review.

Before (`main`):
```js
  482 | 
  483 | app.post('/api/bot/stop/:bid/:oid', requireSuperOnly, async (req, res) => {
```

After:
```js
  497 | 
  498 | // ---- Auto-approval of website sign-ups --------------------------------------
  499 | // New restaurants are created automatically (no manual review). The owner is
  500 | // notified via an `inquiries` record (shows in Supreme > Notifications) and the
  501 | // request appears as "approved" in Supreme > Onboarding. The new outlet stays
  502 | // locked until the first wallet top-up is recorded, so spam only creates inert
  503 | // records. Guards: ONBOARDING_AUTO_APPROVE=off disables it; AUTO_APPROVE_MAX_PER_HOUR
  504 | // caps it (extra requests stay "pending" for manual review). Single-instance
  505 | // assumption, same as status-watcher.js.
  506 | const AUTO_APPROVE_ON = String(process.env.ONBOARDING_AUTO_APPROVE || 'on').toLowerCase() !== 'off';
  507 | const AUTO_APPROVE_MAX_PER_HOUR = Number(process.env.AUTO_APPROVE_MAX_PER_HOUR || 20);
  508 | const SECRET_RETRY_MS = [3000, 10000, 30000, 90000]; // step 2 (password) lands after step 1 (request)
  509 | // Only fresh sign-ups are auto-approved. On every API start the listener replays all requests that are already
  510 | // pending; older ones (stale, legacy inline-password, or over the hourly cap) must stay for manual review.
  511 | const AUTO_APPROVE_MAX_AGE_MS = 15 * 60 * 1000;
  512 | const _autoRecent = [];             // timestamps of recent auto-approvals
  513 | const _autoSeen = new Set();        // reqKeys already handled in this process
  514 | let _autoChain = Promise.resolve(); // serialise: outletCounter + duplicate-email checks must not race
  515 | 
  516 | async function notifySupreme(title, message, extra = {}) {
  517 |   try {
  518 |     await admin.database().ref('inquiries').push({
  519 |       name: title, phone: extra.phone || '', type: 'New restaurant signup', message,
  520 |       store: extra.store || '', status: 'new', source: 'auto-onboarding', createdAt: Date.now(),
  521 |     });
  522 |   } catch (e) { console.warn('[auto-onboarding] notify failed (non-fatal):', e.message); }
  523 | }
  524 | 
  525 | async function autoApproveOne(reqKey, attempt = 0) {
  526 |   const snap = await admin.database().ref(`onboardingRequests/${reqKey}`).get();
  527 |   const r = snap.val();
  528 |   if (!r || r.status !== 'pending' || r.source !== 'website') return;
  529 |   const now = Date.now();
  530 |   if (Math.abs(now - Number(r.createdAt || 0)) > AUTO_APPROVE_MAX_AGE_MS) {
  531 |     console.log(`[auto-onboarding] ${reqKey} is not a fresh sign-up; left pending for manual review`);
  532 |     return;
  533 |   }
  534 |   while (_autoRecent.length && now - _autoRecent[0] > 3600000) _autoRecent.shift();
  535 |   if (_autoRecent.length >= AUTO_APPROVE_MAX_PER_HOUR) {
  536 |     console.warn(`[auto-onboarding] hourly cap reached; ${reqKey} left pending for manual review`);
  537 |     await notifySupreme('Signup needs manual review', `Auto-approval hourly cap (${AUTO_APPROVE_MAX_PER_HOUR}) reached. ${r.businessName} (${r.adminEmail}) is waiting in Onboarding.`, { phone: r.contactPhone, store: r.outletName });
  538 |     return;
  539 |   }
  540 |   try {
  541 |     const out = await approveOnboardingRequest(reqKey, r, 'auto-onboarding');
  542 |     _autoRecent.push(Date.now());
  543 |     await admin.database().ref(`onboardingRequests/${reqKey}`).update({ autoApproved: true });
  544 |     await notifySupreme(`New restaurant: ${r.businessName}`, `${r.outletName} signed up (${r.adminEmail}) and was created automatically. It is locked until its first wallet top-up (min ₹1,000) is recorded.`, { phone: r.contactPhone, store: r.outletName });
  545 |     console.log(`[auto-onboarding] approved ${reqKey} -> ${out.bid}/${out.oid}`);
  546 |   } catch (err) {
  547 |     if (err instanceof HttpError && err.status === 422 && attempt < SECRET_RETRY_MS.length) {
  548 |       setTimeout(() => { _autoChain = _autoChain.then(() => autoApproveOne(reqKey, attempt + 1)).catch(() => {}); }, SECRET_RETRY_MS[attempt]);
  549 |       return;
  550 |     }
  551 |     if (err instanceof HttpError && err.status === 409 && /already exists/.test(err.message)) {
  552 |       await admin.database().ref(`onboardingRequests/${reqKey}`).update({
  553 |         status: 'rejected', rejectReason: 'This login email is already registered.', reviewedAt: Date.now(), reviewedBy: 'auto-onboarding',
  554 |       }).catch(() => {});
  555 |       return;
  556 |     }
  557 |     console.error(`[auto-onboarding] ${reqKey} left pending:`, err.message);
  558 |     await notifySupreme('Signup needs manual review', `${r.businessName} (${r.adminEmail}) could not be auto-approved: ${err.message}`, { phone: r.contactPhone, store: r.outletName });
  559 |   }
  560 | }
  561 | 
  562 | function startAutoApproval() {
  563 |   if (!AUTO_APPROVE_ON) { console.log('[auto-onboarding] disabled (ONBOARDING_AUTO_APPROVE=off)'); return; }
  564 |   admin.database().ref('onboardingRequests').orderByChild('status').equalTo('pending').on('child_added', (snap) => {
  565 |     const key = snap.key;
  566 |     if (_autoSeen.has(key)) return;
  567 |     _autoSeen.add(key);
  568 |     // small delay lets the browser's step-2 password write land first
  569 |     setTimeout(() => { _autoChain = _autoChain.then(() => autoApproveOne(key)).catch((e) => console.error('[auto-onboarding]', e)); }, 2000);
  570 |   }, (e) => console.error('[auto-onboarding] listener error:', e.message));
  571 |   console.log(`[auto-onboarding] watching new sign-ups (cap ${AUTO_APPROVE_MAX_PER_HOUR}/hour)`);
  572 | }
  573 | 
  574 | app.post('/api/bot/stop/:bid/:oid', requireSuperOnly, async (req, res) => {
```

#### bot-control-api/server.js change 8 of 8: old lines 1168-1169 -> new lines 1259-1261 (+1 / -0)

**What:** One call `startAutoApproval();` placed just before `startStatusWatcher(...)` at boot.

**Effect:** Turns the watcher on when the API starts (unless `ONBOARDING_AUTO_APPROVE=off`).

Before (`main`):
```js
 1168 | 
 1169 | startStatusWatcher({ admin, processName, statusOf }).catch((err) => {
```

After:
```js
 1259 | 
 1260 | startAutoApproval();
 1261 | startStatusWatcher({ admin, processName, statusOf }).catch((err) => {
```

### `Admin/js/ui.js`

**Admin shell: tabs, locked state.** +54 / -12 lines in 6 change(s). Setup-only mode and dashboard hooks.

#### Admin/js/ui.js change 1 of 6: old lines 1-1 -> new lines 1-2 (+1 / -0)

**What:** Imports `MIN_TOPUP`.

**Effect:** Popup/banner text shows the current minimum.

Before (`main`):
```js
    1 | import { haptic } from './utils.js';
```

After:
```js
    1 | import { MIN_TOPUP } from '../../shared/cost-math.js';
    2 | import { haptic } from './utils.js';
```

#### Admin/js/ui.js change 2 of 6: old lines 66-67 -> new lines 67-73 (+5 / -0)

**What:** NEW `SETUP_TABS` list after `ALL_TABS`.

**Effect:** Single place that defines what a locked restaurant may open: dashboard, menu, categories, combos, menu-browser, tables, inventory, settings, costs, notifications.

Before (`main`):
```js
   66 | const ALL_TABS = TAB_DEFS.map(t => t[0]);
   67 | const _allExcept = (skip) => ALL_TABS.filter(t => !skip.includes(t));
```

After:
```js
   67 | const ALL_TABS = TAB_DEFS.map(t => t[0]);
   68 | 
   69 | // Tabs usable while the outlet is locked ("setup mode": new restaurant before its first wallet top-up).
   70 | // Everything that takes orders or spends money (POS, orders, kitchen, riders, promotions, chat...) is excluded.
   71 | // The database rules also refuse order/table-session writes while locked; this list is the friendly UI layer.
   72 | export const SETUP_TABS = ['dashboard', 'menu', 'categories', 'combos', 'menu-browser', 'tables', 'inventory', 'settings', 'costs', 'notifications'];
   73 | const _allExcept = (skip) => ALL_TABS.filter(t => !skip.includes(t));
```

#### Admin/js/ui.js change 3 of 6: old lines 114-115 -> new lines 120-123 (+2 / -0)

**What:** Dashboard load now also loads the wallet alert (and the setup checklist from the first commit).

**Effect:** Dashboard shows low-balance banner and checklist; failures are logged and ignored.

Before (`main`):
```js
  114 |             renderOrders(state.lastOrdersSnap);
  115 |             break;
```

After:
```js
  120 |             renderOrders(state.lastOrdersSnap);
  121 |             mod('wallet-alert').then(m => m.loadWalletAlert()).catch(e => console.warn('[UI] wallet alert failed:', e));
  122 |             mod('setup-checklist').then(m => m.loadSetupChecklist()).catch(e => console.warn('[UI] setup checklist failed:', e));
  123 |             break;
```

#### Admin/js/ui.js change 4 of 6: old lines 252-253 -> new lines 260-266 (+5 / -0)

**What:** `switchTab` gate: if locked and the tab is not in `SETUP_TABS`, show the popup and stay (or fall back to dashboard on first load).

**Effect:** Locked owner cannot open POS, Orders, Kitchen, Riders, Promotions, Chat, etc.

Before (`main`):
```js
  252 |     }
  253 |     if (state.currentActiveTab === tabId) {
```

After:
```js
  260 |     }
  261 |     if (state.locked && !SETUP_TABS.includes(tabId)) {
  262 |         if (!state.currentActiveTab) return switchTab('dashboard', true);
  263 |         showLockedScreen();
  264 |         return;
  265 |     }
  266 |     if (state.currentActiveTab === tabId) {
```

#### Admin/js/ui.js change 5 of 6: old lines 456-457 -> new lines 469-474 (+4 / -0)

**What:** New `SUPPORT_WA` link and `LOCK_MSG` text constants before the locked screen.

**Effect:** One shared support link and wording for popup, banner, checklist and wallet.

Before (`main`):
```js
  456 | 
  457 | export function showLockedScreen() {
```

After:
```js
  469 | 
  470 | export const SUPPORT_WA = 'https://wa.me/919724649971?text=' + encodeURIComponent('Hi FoodHubbie Team! I want to top up my wallet (minimum \u20B9' + MIN_TOPUP + ') and go live.');
  471 | const LOCK_MSG = `Your restaurant is in <strong>setup mode</strong>. You can set up your menu, tables and settings now. To start taking orders, add a minimum wallet balance of <strong>\u20B9${MIN_TOPUP.toLocaleString('en-IN')}</strong>. Contact FoodHubbie support and we will add it once your payment is received.`;
  472 | 
  473 | // Dismissible popup shown when a locked outlet tries something that needs go-live.
  474 | export function showLockedScreen() {
```

#### Admin/js/ui.js change 6 of 6: old lines 461-479 -> new lines 478-521 (+37 / -12)

**What:** `showLockedScreen()` rewritten from a full-screen, un-closable block into a dismissible popup (Esc, backdrop, 'Continue setup'). NEW `enterSetupMode()` (banner + leave operations tab) and `leaveSetupMode()`.

**Effect:** Locked owners are no longer stuck on a dead screen; they see a banner and keep configuring.

Before (`main`):
```js
  461 |         el.id = 'locked-screen';
  462 |         el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,10,10,.92);display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:24px;';
  463 |         el.innerHTML = `
  464 |             <div style="max-width:480px;color:#fff">
  465 |                 <div style="font-size:48px;margin-bottom:16px">🔒</div>
  466 |                 <h2 style="font-size:24px;font-weight:800;margin-bottom:12px">Access Restricted</h2>
  467 |                 <p style="font-size:16px;color:rgba(255,255,255,.7);line-height:1.7;margin-bottom:24px">
  468 |                     Your restaurant is not yet activated.<br>
  469 |                     Contact <strong>Supreme Admin</strong> for permission and pay the setup fee for access.
  470 |                 </p>
  471 |                 <button class="btn btn-primary" onclick="window.open('https://wa.me/919724649971?text=Hi%20FoodHubbie%20Team!%20I%20need%20access%20to%20my%20restaurant%20dashboard.','_blank')" style="padding:12px 24px;font-size:15px">
  472 |                     Contact Supreme Admin
  473 |                 </button>
  474 |             </div>
  475 |         `;
  476 |         document.body.appendChild(el);
  477 |     }
  478 |     el.style.display = 'flex';
  479 | }
```

After:
```js
  478 |         el.id = 'locked-screen';
  479 |         el.setAttribute('role', 'dialog');
  480 |         el.setAttribute('aria-modal', 'true');
  481 |         el.setAttribute('aria-label', 'Top up required to go live');
  482 |         el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,10,10,.8);display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;';
  483 |         el.innerHTML = `
  484 |             <div style="max-width:480px;color:#fff">
  485 |                 <h2 style="font-size:22px;font-weight:800;margin-bottom:12px">Top up to go live</h2>
  486 |                 <p style="font-size:15px;color:rgba(255,255,255,.8);line-height:1.7;margin-bottom:24px">${LOCK_MSG}</p>
  487 |                 <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
  488 |                     <button type="button" class="btn btn-primary" id="lockedContactBtn" style="padding:12px 24px;font-size:15px">Contact support</button>
  489 |                     <button type="button" class="btn btn-secondary" id="lockedCloseBtn" style="padding:12px 24px;font-size:15px">Continue setup</button>
  490 |                 </div>
  491 |             </div>`;
  492 |         document.body.appendChild(el);
  493 |         el.querySelector('#lockedContactBtn').addEventListener('click', () => window.open(SUPPORT_WA, '_blank', 'noopener'));
  494 |         const close = () => { el.style.display = 'none'; };
  495 |         el.querySelector('#lockedCloseBtn').addEventListener('click', close);
  496 |         el.addEventListener('click', (e) => { if (e.target === el) close(); });
  497 |         document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.style.display !== 'none') close(); });
  498 |     }
  499 |     el.style.display = 'flex';
  500 |     el.querySelector('#lockedCloseBtn')?.focus();
  501 | }
  502 | 
  503 | // Called once the outlet is known to be locked: show a slim persistent banner and make sure
  504 | // we are not sitting on an operations tab.
  505 | export function enterSetupMode() {
  506 |     if (!document.getElementById('locked-banner')) {
  507 |         const b = document.createElement('div');
  508 |         b.id = 'locked-banner';
  509 |         b.setAttribute('role', 'status');
  510 |         b.style.cssText = 'position:sticky;top:0;z-index:60;background:#fef3c7;color:#78350f;padding:8px 14px;font-size:13px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;';
  511 |         b.innerHTML = `<span>Setup mode: add a minimum wallet balance of \u20B9${MIN_TOPUP.toLocaleString('en-IN')} to start taking orders.</span><button type="button" class="btn-secondary btn-sm" id="lockedBannerBtn">Contact support</button>`;
  512 |         (document.querySelector('.main') || document.body).prepend(b);
  513 |         b.querySelector('#lockedBannerBtn').addEventListener('click', () => window.open(SUPPORT_WA, '_blank', 'noopener'));
  514 |     }
  515 |     if (state.currentActiveTab && !SETUP_TABS.includes(state.currentActiveTab)) switchTab('dashboard', true);
  516 | }
  517 | 
  518 | export function leaveSetupMode() {
  519 |     document.getElementById('locked-banner')?.remove();
  520 |     document.getElementById('locked-screen')?.remove();
  521 | }
```

### `Admin/js/auth.js`

**Admin login and live lock listener.** +5 / -4 lines in 2 change(s). Use setup mode instead of the full block.

#### Admin/js/auth.js change 1 of 2: old lines 300-302 -> new lines 300-302 (+1 / -1)

**What:** On login, a locked outlet calls `enterSetupMode()` instead of `showLockedScreen()`.

**Effect:** Banner plus usable setup tabs after login.

Before (`main`):
```js
  300 |                         state.locked = true;
  301 |                         import('./ui.js').then(u => u.showLockedScreen());
  302 |                     }
```

After:
```js
  300 |                         state.locked = true;
  301 |                         import('./ui.js').then(u => u.enterSetupMode());
  302 |                     }
```

#### Admin/js/auth.js change 2 of 2: old lines 347-353 -> new lines 347-354 (+4 / -3)

**What:** Realtime listener: lock -> `enterSetupMode()`; unlock -> reload if the outlet was locked or the banner/popup exists.

**Effect:** When you unlock from Supreme Admin, the owner's open session reloads into full access.

Before (`main`):
```js
  347 |                         state.locked = true;
  348 |                     } else {
  349 |                         state.locked = false;
  350 |                         // If the locked screen is showing, reload to clear it
  351 |                         const lockedEl = document.getElementById('locked-screen');
  352 |                         if (lockedEl) window.location.reload();
  353 |                     }
```

After:
```js
  347 |                         state.locked = true;
  348 |                         import('./ui.js').then(u => u.enterSetupMode());
  349 |                     } else {
  350 |                         const wasLocked = state.locked;
  351 |                         state.locked = false;
  352 |                         // Unlocked while logged in (Supreme Admin recorded the top-up): reload so every tab re-initialises.
  353 |                         if (wasLocked || document.getElementById('locked-banner') || document.getElementById('locked-screen')) window.location.reload();
  354 |                     }
```

### `Admin/js/main.js`

**Admin global click handler.** +4 / -2 lines in 2 change(s). Locked gate only blocks operations tabs.

#### Admin/js/main.js change 1 of 2: old lines 5-7 -> new lines 5-7 (+1 / -1)

**What:** Imports `SETUP_TABS` from `ui.js`.

**Effect:** Needed by the click gate.

Before (`main`):
```js
    5 | import { switchOutlet, openOutletInNewTab } from './branding.js';
    6 | import { switchTab, toggleSidebar, toggleMobileCart, loadLucide } from './ui.js';
    7 | import { initGestures } from './gestures.js';
```

After:
```js
    5 | import { switchOutlet, openOutletInNewTab } from './branding.js';
    6 | import { switchTab, toggleSidebar, toggleMobileCart, loadLucide, SETUP_TABS } from './ui.js';
    7 | import { initGestures } from './gestures.js';
```

#### Admin/js/main.js change 2 of 2: old lines 145-147 -> new lines 145-149 (+3 / -1)

**What:** Click gate condition adds `&& !SETUP_TABS.includes(state.currentActiveTab)`.

**Effect:** Buttons on setup tabs (add dish, add table, save settings) work while locked; buttons elsewhere still show the popup.

Before (`main`):
```js
  145 |             const SAFE_ACTIONS = ['logout', 'toggleSidebar', 'switchOutlet', 'closeOrderDrawer', 'printReceiptById', 'chatOnWhatsapp', 'closeModal', 'closeDrawer'];
  146 |             if (state.locked && !SAFE_ACTIONS.includes(action)) {
  147 |                 e.preventDefault();
```

After:
```js
  145 |             const SAFE_ACTIONS = ['logout', 'toggleSidebar', 'switchOutlet', 'closeOrderDrawer', 'printReceiptById', 'chatOnWhatsapp', 'closeModal', 'closeDrawer'];
  146 |             // Setup tabs (menu, tables, settings...) stay editable while locked; the database rules
  147 |             // separately refuse order writes, so this gate only needs to cover the operations tabs.
  148 |             if (state.locked && !SAFE_ACTIONS.includes(action) && !SETUP_TABS.includes(state.currentActiveTab)) {
  149 |                 e.preventDefault();
```

### `Admin/index.html`

**Admin markup.** +46 / -1 lines in 3 change(s). Dashboard alert/checklist containers and the Wallet view.

#### Admin/index.html change 1 of 3: old lines 904-905 -> new lines 904-911 (+6 / -0)

**What:** Two empty containers at the top of the dashboard: `#walletAlert` and `#setupChecklist`.

**Effect:** Filled by `wallet-alert.js` and `setup-checklist.js`; hidden when empty.

Before (`main`):
```html
  904 | 
  905 |                 <!-- PROMOTIONS KILL-SWITCH WIDGET -->
```

After:
```html
  904 | 
  905 |                 <!-- WALLET LOW-BALANCE ALERT (filled by features/wallet-alert.js) -->
  906 |                 <div id="walletAlert" class="panel mt-8 mb-16" style="display:none;" role="status"></div>
  907 | 
  908 |                 <!-- SETUP CHECKLIST (filled by features/setup-checklist.js) -->
  909 |                 <div id="setupChecklist" class="panel mt-8 mb-16" style="display:none;padding:14px 16px;border-radius:10px;"></div>
  910 | 
  911 |                 <!-- PROMOTIONS KILL-SWITCH WIDGET -->
```

#### Admin/index.html change 2 of 3: old lines 5281-5283 -> new lines 5287-5290 (+2 / -1)

**What:** Costs sub-tabs: new 'Wallet' button is first and active; Overview no longer active.

**Effect:** Costs opens on the Wallet view.

Before (`main`):
```html
 5281 |             <div class="cost-subtabs">
 5282 |                 <button class="cost-subtab active" data-cost-tab="overview">Overview</button>
 5283 |                 <button class="cost-subtab" data-cost-tab="breakdown">Breakdown</button>
```

After:
```html
 5287 |             <div class="cost-subtabs">
 5288 |                 <button class="cost-subtab active" data-cost-tab="wallet">Wallet</button>
 5289 |                 <button class="cost-subtab" data-cost-tab="overview">Overview</button>
 5290 |                 <button class="cost-subtab" data-cost-tab="breakdown">Breakdown</button>
```

#### Admin/index.html change 3 of 3: old lines 5299-5300 -> new lines 5306-5345 (+38 / -0)

**What:** NEW `data-cost-section="wallet"` block: balance card, how-to-top-up steps, top-up history table.

**Effect:** Restaurant sees balance, status and history; ids are filled by `costs.js`.

Before (`main`):
```html
 5299 | 
 5300 |         <div class="mob-kpi-grid" style="margin-top:12px;" data-cost-section="overview">
```

After:
```html
 5306 | 
 5307 |         <div data-cost-section="wallet" style="margin-top:12px;">
 5308 | 
 5309 |             <div class="mob-card" id="walletHero" style="padding:20px;">
 5310 |                 <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
 5311 |                     <div>
 5312 |                         <div class="text-muted-small">Wallet balance</div>
 5313 |                         <div id="walletBalance" style="font-size:36px;font-weight:800;line-height:1.2;">&#8377;0</div>
 5314 |                         <div id="walletStatus" class="text-muted-small" role="status">Loading&hellip;</div>
 5315 |                     </div>
 5316 |                     <button type="button" class="btn-primary" id="walletContactBtn">Top up via support</button>
 5317 |                 </div>
 5318 |                 <div class="cost-detail-grid" style="margin-top:16px;">
 5319 |                     <div><div class="cost-detail-label">Total topped up</div><div class="cost-detail-value" id="walletPaid">&#8377;0</div></div>
 5320 |                     <div><div class="cost-detail-label">Used (orders + promo)</div><div class="cost-detail-value" id="walletUsed">&#8377;0</div></div>
 5321 |                     <div><div class="cost-detail-label">Other charges</div><div class="cost-detail-value" id="walletCharges">&#8377;0</div></div>
 5322 |                 </div>
 5323 |             </div>
 5324 | 
 5325 |             <div class="mob-card" id="walletHow" style="padding:16px;margin-top:12px;">
 5326 |                 <h4 class="section-card-heading"><i data-lucide="wallet" class="icon-14"></i> How to top up</h4>
 5327 |                 <ol style="margin:8px 0 0 18px;padding:0;line-height:1.8;">
 5328 |                     <li>Tap <strong>Top up via support</strong> and ask for the payment details (UPI or bank transfer).</li>
 5329 |                     <li>Pay at least <strong id="walletMinLabel">&#8377;1,000</strong> and send the payment proof on WhatsApp.</li>
 5330 |                     <li>We add the balance here (you will see it in the history below). Your first top-up switches your restaurant live.</li>
 5331 |                 </ol>
 5332 |                 <div class="text-muted-small" style="margin-top:8px;">Each order, promotional message and any extra charge is deducted from this balance at the rates in <em>Breakdown</em>.</div>
 5333 |             </div>
 5334 | 
 5335 |             <div class="mob-card mob-table-card" style="margin-top:12px;">
 5336 |                 <h4 class="section-card-heading"><i data-lucide="receipt" class="icon-14"></i> Top-up history</h4>
 5337 |                 <table>
 5338 |                     <thead><tr><th>Date</th><th>Method</th><th>Receipt</th><th>Amount</th></tr></thead>
 5339 |                     <tbody id="walletHistoryBody"><tr><td colspan="4">Loading&hellip;</td></tr></tbody>
 5340 |                 </table>
 5341 |             </div>
 5342 | 
 5343 |         </div>
 5344 | 
 5345 |         <div class="mob-kpi-grid" style="margin-top:12px;" data-cost-section="overview">
```

### `Admin/js/features/costs.js`

**Admin Costs tab.** +73 / -7 lines in 10 change(s). Wallet view and percentage-aware labels.

#### Admin/js/features/costs.js change 1 of 10: old lines 17-20 -> new lines 17-22 (+4 / -2)

**What:** Imports: `get`, `state`, `SUPPORT_WA`, and cost-math `MIN_TOPUP`, `computeWallet`, `normalizeMode`, `rateLabel`.

**Effect:** Dependencies for the wallet.

Before (`main`):
```js
   17 |  */
   18 | import { Outlet, onValue, onChildAdded, onChildChanged, query, orderByChild, startAt, endAt } from '../firebase.js';
   19 | import { DEFAULT_RATES, PROMO_RATE, sourceOf, feeOf, computeCostIndex } from '../../shared/cost-math.js';
   20 | 
```

After:
```js
   17 |  */
   18 | import { Outlet, get, onValue, onChildAdded, onChildChanged, query, orderByChild, startAt, endAt } from '../firebase.js';
   19 | import { state } from '../state.js';
   20 | import { SUPPORT_WA } from '../ui.js';
   21 | import { DEFAULT_RATES, PROMO_RATE, MIN_TOPUP, sourceOf, feeOf, computeCostIndex, computeWallet, normalizeMode, rateLabel } from '../../shared/cost-math.js';
   22 | 
```

#### Admin/js/features/costs.js change 2 of 10: old lines 30-31 -> new lines 32-35 (+2 / -0)

**What:** Two new module variables `_allOrders`, `_walletWired`.

**Effect:** Hold lifetime orders (`null` loading, `false` failed) and one-time wiring flag.

Before (`main`):
```js
   30 | let _orderUnsubs = [];
   31 | 
```

After:
```js
   32 | let _orderUnsubs = [];
   33 | let _allOrders = null;       // all-time orders (one-time read) for the wallet balance; null = not loaded
   34 | let _walletWired = false;
   35 | 
```

#### Admin/js/features/costs.js change 3 of 10: old lines 106-108 -> new lines 110-112 (+1 / -1)

**What:** `_mode()` uses `normalizeMode()`.

**Effect:** Percentage mode is recognised (before it would have been treated as per-order).

Before (`main`):
```js
  106 | const _rates = () => ({ ...DEFAULT_RATES, ...(_billing && typeof _billing === 'object' ? _billing.rates || {} : {}) });
  107 | const _mode = () => (_billing && typeof _billing === 'object' && _billing.mode === 'commission_1pct') ? 'commission_1pct' : 'per_order';
  108 | 
```

After:
```js
  110 | const _rates = () => ({ ...DEFAULT_RATES, ...(_billing && typeof _billing === 'object' ? _billing.rates || {} : {}) });
  111 | const _mode = () => normalizeMode(_billing && typeof _billing === 'object' ? _billing.mode : null);
  112 | 
```

#### Admin/js/features/costs.js change 4 of 10: old lines 126-127 -> new lines 130-132 (+1 / -0)

**What:** `_render()` calls `_renderWallet()` first.

**Effect:** Wallet refreshes with every data update.

Before (`main`):
```js
  126 | 
  127 |     _setText('costMonthLabel', _rangeLabel());
```

After:
```js
  130 | 
  131 |     _renderWallet();
  132 |     _setText('costMonthLabel', _rangeLabel());
```

#### Admin/js/features/costs.js change 5 of 10: old lines 147-149 -> new lines 152-154 (+1 / -1)

**What:** Rate cell uses `rateLabel()`.

**Effect:** Breakdown shows '1% of order' / '2% of order' / 'Rs 2/order'.

Before (`main`):
```js
  147 |             <td>${_label(src)}</td>
  148 |             <td>${mode === 'commission_1pct' && src === 'webview_delivery' ? '1% of order' : _inr(rates[src] ?? rates.other)}</td>
  149 |             <td>${v.orders}</td>
```

After:
```js
  152 |             <td>${_label(src)}</td>
  153 |             <td>${rateLabel(src, mode, rates)}</td>
  154 |             <td>${v.orders}</td>
```

#### Admin/js/features/costs.js change 6 of 10: old lines 199-201 -> new lines 204-206 (+1 / -1)

**What:** Billing configuration shows 'Percentage package (1% ..., 2% ...)'.

**Effect:** Correct mode name in the Connect/billing card.

Before (`main`):
```js
  199 |             const mode = _mode();
  200 |             const modeLabel = mode === 'commission_1pct' ? 'WhatsApp Official (1% of order total)' : 'Per-order flat rates';
  201 |             const setup = b.setup || {};
```

After:
```js
  204 |             const mode = _mode();
  205 |             const modeLabel = mode === 'percentage' ? 'Percentage package (1% of order value, 2% on WhatsApp orders)' : mode === 'commission_1pct' ? 'WhatsApp Official (1% of order total)' : 'Per-order flat rates';
  206 |             const setup = b.setup || {};
```

#### Admin/js/features/costs.js change 7 of 10: old lines 240-242 -> new lines 245-247 (+1 / -1)

**What:** Rate chips use `rateLabel()`.

**Effect:** Chips show percentages in percentage mode.

Before (`main`):
```js
  240 |                         ${Object.keys(LABELS).filter(k => k in rates).map(k =>
  241 |                             `<span class="cost-rate-chip">${_label(k)}: ${mode === 'commission_1pct' && k === 'webview_delivery' ? '1% of order' : '₹' + rates[k]}</span>`).join('')}
  242 |                     </div>
```

After:
```js
  245 |                         ${Object.keys(LABELS).filter(k => k in rates).map(k =>
  246 |                             `<span class="cost-rate-chip">${_label(k)}: ${rateLabel(k, mode, rates).replace('/order', '')}</span>`).join('')}
  247 |                     </div>
```

#### Admin/js/features/costs.js change 8 of 10: old lines 266-267 -> new lines 271-328 (+56 / -0)

**What:** NEW `_renderWallet()` and `_wireWallet()`.

**Effect:** Balance, topped up, used, charges, history, status text, red/amber border for empty/low; never shows a balance if usage failed to load.

Before (`main`):
```js
  266 | 
  267 | export function loadCosts() {
```

After:
```js
  271 | 
  272 | function _renderWallet() {
  273 |     if (!document.getElementById('walletBalance')) return;
  274 |     _setText('walletMinLabel', _inr(MIN_TOPUP));
  275 |     if (_billing === false) {
  276 |         _setText('walletBalance', '\u2014');
  277 |         _setText('walletStatus', 'Wallet details are not available right now. Please try again or contact support.');
  278 |         return;
  279 |     }
  280 |     if (_allOrders === false) {
  281 |         // never show a balance computed without the usage side: it would be overstated
  282 |         _setText('walletBalance', '\u2014');
  283 |         _setText('walletStatus', 'Could not load your usage just now. Reload to see your balance.');
  284 |         return;
  285 |     }
  286 |     if (_allOrders === null || _billing === null) { _setText('walletStatus', 'Calculating\u2026'); }
  287 |     const w = computeWallet({ billing: _billing || {}, orders: _allOrders || {}, campaigns: _campaigns || {} });
  288 |     const el = document.getElementById('walletBalance');
  289 |     if (el) {
  290 |         el.textContent = (w.balance < 0 ? '\u2212' : '') + _inr(Math.abs(w.balance));
  291 |         el.style.color = w.balance < 0 ? '#dc2626' : '';
  292 |     }
  293 |     _setText('walletPaid', _inr(w.paid));
  294 |     _setText('walletUsed', _inr(w.used));
  295 |     _setText('walletCharges', _inr(w.charges));
  296 |     if (_allOrders !== null && _billing !== null) {
  297 |         let msg;
  298 |         if (!w.topUpDone) msg = `Top up at least ${_inr(MIN_TOPUP)} to go live.`;
  299 |         else if (state.locked) msg = 'Top-up received. Your restaurant is being switched live.';
  300 |         else if (w.level === 'empty') msg = 'Your wallet balance is finished. Please top up now to avoid interruption.';
  301 |         else if (w.level === 'low') msg = `Low balance: 25% or less of your top-ups is left. Please top up soon.`;
  302 |         else msg = 'Your restaurant is live.';
  303 |         _setText('walletStatus', msg);
  304 |         const hero = document.getElementById('walletHero');
  305 |         if (hero) hero.style.borderLeft = w.level === 'empty' ? '4px solid #dc2626' : w.level === 'low' ? '4px solid #f59e0b' : '';
  306 |     }
  307 |     const body = document.getElementById('walletHistoryBody');
  308 |     if (body) {
  309 |         const pays = Object.values((_billing && _billing.payments) || {})
  310 |             .map(p => ({ ...p, ts: typeof p.createdAt === 'number' ? p.createdAt : Date.parse(p.createdAt) || 0 }))
  311 |             .sort((a, b) => b.ts - a.ts);
  312 |         const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  313 |         body.innerHTML = pays.length ? pays.map(p => `<tr>
  314 |             <td>${p.ts ? new Date(p.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2014'}</td>
  315 |             <td>${esc(p.method || '\u2014')}</td>
  316 |             <td>${esc(p.receiptNo || '\u2014')}</td>
  317 |             <td>${_inr(p.amount)}</td>
  318 |         </tr>`).join('') : '<tr><td colspan="4">No top-ups yet</td></tr>';
  319 |     }
  320 | }
  321 | 
  322 | function _wireWallet() {
  323 |     if (_walletWired) return;
  324 |     _walletWired = true;
  325 |     document.getElementById('walletContactBtn')?.addEventListener('click', () => window.open(SUPPORT_WA, '_blank', 'noopener'));
  326 | }
  327 | 
  328 | export function loadCosts() {
```

#### Admin/js/features/costs.js change 9 of 10: old lines 270-272 -> new lines 331-334 (+2 / -1)

**What:** `loadCosts()` wires the wallet and resets `_allOrders`.

**Effect:** Fresh calculation each time the tab opens.

Before (`main`):
```js
  270 |     _wireRange();
  271 |     _billing = null; _campaigns = null;
  272 |     _range = _range || _monthRange(0);
```

After:
```js
  331 |     _wireRange();
  332 |     _wireWallet();
  333 |     _billing = null; _campaigns = null; _allOrders = null;
  334 |     _range = _range || _monthRange(0);
```

#### Admin/js/features/costs.js change 10 of 10: old lines 280-281 -> new lines 342-347 (+4 / -0)

**What:** One-time read of all orders after the listeners; failure sets `_allOrders = false`.

**Effect:** Balance = lifetime top-ups minus lifetime usage. One extra read of `orders` per Costs visit.

Before (`main`):
```js
  280 | 
  281 |     _render();
```

After:
```js
  342 | 
  343 |     // All-time orders, read once per visit, so the wallet balance is lifetime paid minus lifetime usage.
  344 |     get(Outlet.ref('orders')).then(snap => { _allOrders = snap.val() || {}; _scheduleRender(); })
  345 |         .catch(() => { _allOrders = false; _scheduleRender(); }); // false = could not load
  346 | 
  347 |     _render();
```

### `shared/cost-math.js`

**Shared billing math (Admin + Supreme).** +76 / -0 lines in 4 change(s). Wallet, 25% rule and percentage package in one place.

#### shared/cost-math.js change 1 of 4: old lines 5-6 -> new lines 5-7 (+1 / -0)

**What:** Header comment mentions the percentage package.

**Effect:** Documentation only.

Before (`main`):
```js
    5 |  *   Official pack: commission_1pct mode (1% of delivery-webview revenue) overrides the flat fee
    6 |  *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
```

After:
```js
    5 |  *   Official pack: commission_1pct mode (1% of delivery-webview revenue) overrides the flat fee
    6 |  *   Percentage package: 'percentage' mode = 1% of order value on every source, 2% on WhatsApp-based ordering
    7 |  *   Promo (marketing) message = ₹1 · cancelled/refunded orders never bill
```

#### shared/cost-math.js change 2 of 4: old lines 12-13 -> new lines 13-65 (+51 / -0)

**What:** NEW: `MIN_TOPUP` (1000), `LOW_BALANCE_RATIO` (0.25), `PERCENT_RATES`, `normalizeMode`, `percentOf`, `rateLabel`, `computeWallet`, `walletLevel`.

**Effect:** Single source for the minimum, the 25% threshold, the 1%/2% rates and the balance formula. Change numbers here only.

Before (`main`):
```js
   12 | export const COMMISSION_PCT = 0.01;
   13 | 
```

After:
```js
   13 | export const COMMISSION_PCT = 0.01;
   14 | // Minimum first wallet top-up before a restaurant goes live (paid to FoodHubbie directly by UPI/bank;
   15 | // Supreme Admin records it under billing/payments).
   16 | export const MIN_TOPUP = 1000;
   17 | // Low-balance warning: balance at or below this share of everything topped up so far.
   18 | export const LOW_BALANCE_RATIO = 0.25;
   19 | 
   20 | // Billing modes (outlet billing.mode): 'per_order' flat rates (default), 'commission_1pct' (legacy: 1% on
   21 | // WhatsApp delivery only) and 'percentage' (percentage package: share of order value on every order).
   22 | export const PERCENT_RATES = { default: 0.01, webview_delivery: 0.02, WA: 0.02 }; // 1% everything, 2% WhatsApp-based ordering
   23 | export function normalizeMode(mode) {
   24 |     return mode === 'percentage' ? 'percentage' : mode === 'commission_1pct' ? 'commission_1pct' : 'per_order';
   25 | }
   26 | export const percentOf = (src) => PERCENT_RATES[src] ?? PERCENT_RATES.default;
   27 | /** Human label for a source's rate under a mode, e.g. "2% of order" or "\u20B92/order". */
   28 | export function rateLabel(src, mode, rates = DEFAULT_RATES) {
   29 |     const m = normalizeMode(mode);
   30 |     if (m === 'percentage') return `${Math.round(percentOf(src) * 1000) / 10}% of order`;
   31 |     if (m === 'commission_1pct' && src === 'webview_delivery') return '1% of order';
   32 |     return `\u20B9${rates[src] ?? rates.other ?? 0}/order`;
   33 | }
   34 | 
   35 | const _n = (x) => Number(x) || 0;
   36 | const _r2 = (x) => Math.round(x * 100) / 100;
   37 | 
   38 | /**
   39 |  * Prepaid wallet view of the existing billing ledger.
   40 |  * balance = paid - (order fees + promo sends + manual charges). Same numbers as Supreme's "due", sign flipped.
   41 |  * `billing` = outlet.billing node, `orders` = all outlet orders, `campaigns` = bot.promotions.campaigns.
   42 |  */
   43 | export function computeWallet({ billing, orders, campaigns } = {}) {
   44 |     const b = billing || {};
   45 |     const rates = { ...DEFAULT_RATES, ...(b.rates || {}) };
   46 |     const mode = normalizeMode(b.mode);
   47 |     const idx = computeCostIndex(orders || {}, rates, mode);
   48 |     let promoSent = 0;
   49 |     for (const c of Object.values(campaigns || {})) promoSent += _n(c && c.totalSent);
   50 |     const sum = (node) => Object.values(node || {}).reduce((a, x) => a + _n(x && x.amount), 0);
   51 |     const paid = _r2(sum(b.payments));
   52 |     const charges = _r2(sum(b.charges));
   53 |     const used = _r2(idx.total + promoSent * PROMO_RATE);
   54 |     return { paid, charges, used, balance: _r2(paid - used - charges), topUpDone: paid >= MIN_TOPUP, minTopUp: MIN_TOPUP, level: walletLevel({ paid, used, charges }) };
   55 | }
   56 | 
   57 | /** 'none' (never topped up) | 'ok' | 'low' (balance <= 25% of total topped up) | 'empty' (balance <= 0). */
   58 | export function walletLevel({ paid = 0, used = 0, charges = 0 } = {}) {
   59 |     const p = _n(paid);
   60 |     if (p <= 0) return 'none';
   61 |     const bal = p - _n(used) - _n(charges);
   62 |     if (bal <= 0) return 'empty';
   63 |     return bal <= p * LOW_BALANCE_RATIO ? 'low' : 'ok';
   64 | }
   65 | 
```

#### shared/cost-math.js change 3 of 4: old lines 23-24 -> new lines 75-79 (+3 / -0)

**What:** `feeOf()`: new `percentage` branch returns order total x rate, rounded to paise.

**Effect:** Percentage restaurants are billed 1% (QR, POS, other) or 2% (WhatsApp).

Before (`main`):
```js
   23 |     const src = sourceOf(order);
   24 |     if (mode === 'commission_1pct' && src === 'webview_delivery') {
```

After:
```js
   75 |     const src = sourceOf(order);
   76 |     if (mode === 'percentage') {
   77 |         return Math.round((Number(order.total) || 0) * percentOf(src) * 100) / 100;
   78 |     }
   79 |     if (mode === 'commission_1pct' && src === 'webview_delivery') {
```

#### shared/cost-math.js change 4 of 4: old lines 57-58 -> new lines 112-134 (+21 / -0)

**What:** Self-checks for percentage fees, rounding, mode normalisation, labels, wallet and 25% boundaries.

**Effect:** `node shared/cost-math.js` fails if the maths drifts.

Before (`main`):
```js
   57 |     assert.equal(DEFAULT_RATES.WA, 5, 'WhatsApp order ₹5');
   58 |     console.log('cost-math OK');
```

After:
```js
  112 |     assert.equal(DEFAULT_RATES.WA, 5, 'WhatsApp order ₹5');
  113 |     const w = computeWallet({
  114 |         billing: { payments: { a: { amount: 1000 }, b: { amount: 500 } }, charges: { c: { amount: 200 } } },
  115 |         orders: { a: o(100, 'QR'), b: o(100, 'POS'), c: o(100, 'QR', 'Cancelled') },
  116 |         campaigns: { x: { totalSent: 10 } },
  117 |     });
  118 |     assert.equal(w.paid, 1500); assert.equal(w.used, 13, 'QR2 + POS1 + 10 promo'); assert.equal(w.charges, 200);
  119 |     assert.equal(w.balance, 1287, 'paid - used - charges'); assert.equal(w.topUpDone, true);
  120 |     assert.equal(computeWallet({ billing: { payments: { a: { amount: 999 } } } }).topUpDone, false, 'below minimum');
  121 |     assert.equal(computeWallet({}).balance, 0, 'empty is zero');
  122 |     // percentage package: 1% QR/POS/other, 2% WhatsApp (webview + WA); cancelled still excluded
  123 |     const pk = computeCostIndex({ a: o(1000, 'QR'), b: o(500, 'POS'), c: o(1000, 'webview_delivery'), d: o(200, 'WA'), e: o(100, 'other'), f: o(9999, 'QR', 'Cancelled') }, DEFAULT_RATES, 'percentage');
  124 |     assert.equal(pk.total, 10 + 5 + 20 + 4 + 1, '1% QR/POS/other + 2% WhatsApp');
  125 |     assert.equal(feeOf({ total: 333.33, source: 'QR' }, DEFAULT_RATES, 'percentage'), 3.33, 'rounded to paise');
  126 |     assert.equal(normalizeMode('percentage'), 'percentage'); assert.equal(normalizeMode('junk'), 'per_order'); assert.equal(normalizeMode('commission_1pct'), 'commission_1pct');
  127 |     assert.equal(rateLabel('webview_delivery', 'percentage'), '2% of order'); assert.equal(rateLabel('QR', 'percentage'), '1% of order'); assert.equal(rateLabel('QR', 'per_order'), '\u20B92/order');
  128 |     const wp = computeWallet({ billing: { mode: 'percentage', payments: { a: { amount: 1000 } } }, orders: { a: o(1000, 'webview_delivery') } });
  129 |     assert.equal(wp.used, 20, 'wallet uses the percentage package');
  130 |     // low balance: <= 25% of everything topped up
  131 |     assert.equal(walletLevel({ paid: 0 }), 'none'); assert.equal(walletLevel({ paid: 1000, used: 500 }), 'ok');
  132 |     assert.equal(walletLevel({ paid: 1000, used: 750 }), 'low', 'exactly 25% left'); assert.equal(walletLevel({ paid: 1000, used: 749 }), 'ok');
  133 |     assert.equal(walletLevel({ paid: 1000, used: 900, charges: 100 }), 'empty'); assert.equal(walletLevel({ paid: 1000, used: 1200 }), 'empty');
  134 |     console.log('cost-math OK');
```

### `SupremeAdmin/js/billing-shared.js`

**Supreme billing helpers.** +14 / -2 lines in 3 change(s). Percentage mode and unlock reminder.

#### SupremeAdmin/js/billing-shared.js change 1 of 3: old lines 10-12 -> new lines 10-12 (+1 / -1)

**What:** Imports `MIN_TOPUP`, `normalizeMode`.

**Effect:** Dependencies.

Before (`main`):
```js
   10 |  */
   11 | import { DEFAULT_RATES, PROMO_RATE, computeCostIndex } from '/shared/cost-math.js';
   12 | import { escapeHtml, showToast } from '/js/utils.js';
```

After:
```js
   10 |  */
   11 | import { DEFAULT_RATES, PROMO_RATE, MIN_TOPUP, computeCostIndex, normalizeMode } from '/shared/cost-math.js';
   12 | import { escapeHtml, showToast } from '/js/utils.js';
```

#### SupremeAdmin/js/billing-shared.js change 2 of 3: old lines 68-70 -> new lines 68-70 (+1 / -1)

**What:** `billingOf()` uses `normalizeMode(b.mode)`.

**Effect:** Supreme totals and ledger use percentage fees for percentage restaurants.

Before (`main`):
```js
   68 |     rates: { ...DEFAULT_RATES, ...(b.rates || {}) },
   69 |     mode: b.mode === 'commission_1pct' ? 'commission_1pct' : 'per_order',
   70 |     raw: b,
```

After:
```js
   68 |     rates: { ...DEFAULT_RATES, ...(b.rates || {}) },
   69 |     mode: normalizeMode(b.mode),
   70 |     raw: b,
```

#### SupremeAdmin/js/billing-shared.js change 3 of 3: old lines 210-211 -> new lines 210-223 (+12 / -0)

**What:** After a payment is saved: reads `locked` and total paid; if locked and total >= minimum, shows a toast.

**Effect:** Reminds you to unlock after the first qualifying top-up. Does not unlock automatically.

Before (`main`):
```js
  210 |         showToast(`Payment of ${inr(amount)} recorded.`, 'success');
  211 |         done({ amount, method, period: per, note, receiptNo, createdAt: now, id: ref.key });
```

After:
```js
  210 |         showToast(`Payment of ${inr(amount)} recorded.`, 'success');
  211 |         // First-top-up hint: a locked restaurant that has now paid the minimum is ready to go live.
  212 |         try {
  213 |           const base = `businesses/${bid}/outlets/${oid}`;
  214 |           const [lk, pays] = await Promise.all([
  215 |             firebase.database().ref(`${base}/locked`).once('value'),
  216 |             firebase.database().ref(`${base}/billing/payments`).once('value'),
  217 |           ]);
  218 |           const total = Object.values(pays.val() || {}).reduce((a, p) => a + Number((p && p.amount) || 0), 0);
  219 |           if (lk.val() === true && total >= MIN_TOPUP) {
  220 |             showToast(`Wallet reached ${inr(total)} (minimum ${inr(MIN_TOPUP)}). Unlock this restaurant from its profile to take it live.`, 'success');
  221 |           }
  222 |         } catch (_) { /* hint only */ }
  223 |         done({ amount, method, period: per, note, receiptNo, createdAt: now, id: ref.key });
```

### `SupremeAdmin/js/features/payment-record.js`

**Supreme payment record page.** +2 / -4 lines in 2 change(s). Rate label.

#### SupremeAdmin/js/features/payment-record.js change 1 of 2: old lines 15-17 -> new lines 15-17 (+1 / -1)

**What:** Imports `rateLabel`.

**Effect:** Dependency.

Before (`main`):
```js
   15 | } from '/js/billing-shared.js';
   16 | import { PROMO_RATE } from '/shared/cost-math.js';
   17 | 
```

After:
```js
   15 | } from '/js/billing-shared.js';
   16 | import { PROMO_RATE, rateLabel } from '/shared/cost-math.js';
   17 | 
```

#### SupremeAdmin/js/features/payment-record.js change 2 of 2: old lines 225-229 -> new lines 225-227 (+1 / -3)

**What:** Five-line rate expression replaced by `rateLabel(...)`.

**Effect:** Shows '1% of order' / '2% of order' for percentage restaurants.

Before (`main`):
```js
  225 |     if (!b.orders) continue;
  226 |     const rate = src === 'webview_delivery' && stats.mode === 'commission_1pct'
  227 |       ? '1% of sales'
  228 |       : `₹${stats.rates[src] ?? stats.rates.other}/order`;
  229 |     rows.push({ label: SRC_LABEL[src] || src, count: String(b.orders), rate, amount: b.cost });
```

After:
```js
  225 |     if (!b.orders) continue;
  226 |     const rate = rateLabel(src, stats.mode, stats.rates);
  227 |     rows.push({ label: SRC_LABEL[src] || src, count: String(b.orders), rate, amount: b.cost });
```

### `SupremeAdmin/js/features/payment-overview.js`

**Supreme Payments tab.** +8 / -1 lines in 5 change(s). Low-balance visibility.

#### SupremeAdmin/js/features/payment-overview.js change 1 of 5: old lines 11-12 -> new lines 11-13 (+1 / -0)

**What:** Imports `walletLevel`.

**Effect:** Dependency.

Before (`main`):
```js
   11 | import { scopeStats, inr, currentYm, monthLabel } from '/js/billing-shared.js';
   12 | 
```

After:
```js
   11 | import { scopeStats, inr, currentYm, monthLabel } from '/js/billing-shared.js';
   12 | import { walletLevel } from '/shared/cost-math.js';
   13 | 
```

#### SupremeAdmin/js/features/payment-overview.js change 2 of 5: old lines 89-90 -> new lines 90-92 (+1 / -0)

**What:** Each row gets `level` (none/ok/low/empty) and `locked`.

**Effect:** Data for chips and tile.

Before (`main`):
```js
   89 |         orders: all.orders, usage: all.usage, paid: all.paid, due: all.due,
   90 |         monthUsage: month.usage, monthPaid: month.paid,
```

After:
```js
   90 |         orders: all.orders, usage: all.usage, paid: all.paid, due: all.due,
   91 |         level: walletLevel({ paid: all.paid, used: all.usage, charges: all.charges }), locked: outlet.locked === true,
   92 |         monthUsage: month.usage, monthPaid: month.paid,
```

#### SupremeAdmin/js/features/payment-overview.js change 3 of 5: old lines 100-101 -> new lines 102-104 (+1 / -0)

**What:** Counts `lowWallets`.

**Effect:** KPI value.

Before (`main`):
```js
  100 |   const owing = allRows.filter((r) => r.due > 0.009).length;
  101 |   const monthUsage = Math.round(allRows.reduce((s, r) => s + r.monthUsage, 0) * 100) / 100;
```

After:
```js
  102 |   const owing = allRows.filter((r) => r.due > 0.009).length;
  103 |   const lowWallets = allRows.filter((r) => r.level === 'low' || r.level === 'empty').length;
  104 |   const monthUsage = Math.round(allRows.reduce((s, r) => s + r.monthUsage, 0) * 100) / 100;
```

#### SupremeAdmin/js/features/payment-overview.js change 4 of 5: old lines 115-116 -> new lines 118-123 (+4 / -0)

**What:** NEW KPI tile 'Low / empty wallets'.

**Effect:** You see how many restaurants are at or below 25%.

Before (`main`):
```js
  115 |     </div>
  116 |     <div class="glass-card kpi-tile">
```

After:
```js
  118 |     </div>
  119 |     <div class="glass-card kpi-tile ${lowWallets > 0 ? 'accent-offline' : ''}">
  120 |       <div class="kpi-label"><svg data-lucide="wallet" style="width:13px;height:13px"></svg> Low / empty wallets</div>
  121 |       <div class="kpi-value">${lowWallets} <small>at or below 25% left</small></div>
  122 |     </div>
  123 |     <div class="glass-card kpi-tile">
```

#### SupremeAdmin/js/features/payment-overview.js change 5 of 5: old lines 162-164 -> new lines 169-171 (+1 / -1)

**What:** Name cell adds 'locked', 'low balance' and 'wallet empty' chips.

**Effect:** Spot restaurants to chase for a top-up.

Before (`main`):
```js
  162 |     <tr class="${r.disabled ? 'row-stale' : ''}">
  163 |       <td><strong>${escapeHtml(r.outletName)}</strong>${r.disabled ? ' <span class="transport-badge unknown">disabled</span>' : ''}</td>
  164 |       <td>${escapeHtml(r.businessName)}</td>
```

After:
```js
  169 |     <tr class="${r.disabled ? 'row-stale' : ''}">
  170 |       <td><strong>${escapeHtml(r.outletName)}</strong>${r.disabled ? ' <span class="transport-badge unknown">disabled</span>' : ''}${r.locked ? ' <span class="transport-badge unknown">locked</span>' : ''}${r.level === 'empty' ? ' <span class="transport-badge" style="color:var(--status-offline,#dc2626)">wallet empty</span>' : r.level === 'low' ? ' <span class="transport-badge" style="color:...
  171 |       <td>${escapeHtml(r.businessName)}</td>
```

### `SupremeAdmin/js/features/restaurant-profile.js`

**Supreme restaurant profile.** +14 / -9 lines in 2 change(s). Per-restaurant package switch.

#### SupremeAdmin/js/features/restaurant-profile.js change 1 of 2: old lines 983-994 -> new lines 983-999 (+12 / -7)

**What:** `billing-toggle-mode` (2-way toggle) replaced by `BILLING_MODE_INFO` and `billing-set-mode` (reads `data-mode`, confirms with a description, writes `billing.mode`).

**Effect:** You can choose Flat, Percentage package or WhatsApp-1% per restaurant, with a clear confirmation.

Before (`main`):
```js
  983 | // ---- Billing & promo tokens ----------------------------------------------
  984 | registerAction('billing-toggle-mode', async () => {
  985 |   if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  986 |   const b = lastRaw?.[currentBid]?.outlets?.[currentOid]?.billing;
  987 |   if (!b) return showToast('Billing not seeded — run tools/seed-billing-defaults.cjs.', 'error');
  988 |   const next = b.mode === 'commission_1pct' ? 'per_order' : 'commission_1pct';
  989 |   const ok = await showConfirm({
  990 |     title: next === 'commission_1pct' ? 'Switch to 1% of sales?' : 'Switch to per-order billing?',
  991 |     body: next === 'commission_1pct'
  992 |       ? `WhatsApp delivery orders are billed at 1% of order value instead of the flat ₹${b.rates?.WA ?? 3}. QR, POS and other sources stay per-order.`
  993 |       : `Every source goes back to flat per-order rates (QR ₹${b.rates?.QR ?? 2} · POS ₹${b.rates?.POS ?? 1}, WhatsApp delivery ₹${b.rates?.WA ?? 3}).`,
  994 |     confirmLabel: 'Switch mode',
```

After:
```js
  983 | // ---- Billing & promo tokens ----------------------------------------------
  984 | const BILLING_MODE_INFO = {
  985 |   per_order: { label: 'flat per-order billing', body: (b) => `Every source is billed at flat per-order rates (QR \u20B9${b.rates?.QR ?? 2} \u00B7 POS \u20B9${b.rates?.POS ?? 1} \u00B7 WhatsApp \u20B9${b.rates?.WA ?? 5}).` },
  986 |   percentage: { label: 'the percentage package', body: () => 'Every order is billed as a share of its value: 1% on QR, POS and all other features, 2% on WhatsApp-based ordering. Cancelled and refunded orders are not billed. Promo messages stay per token.' },
  987 |   commission_1pct: { label: '1% of sales (WhatsApp only)', body: () => 'WhatsApp delivery orders are billed at 1% of order value. QR, POS and other sources stay per-order.' },
  988 | };
  989 | registerAction('billing-set-mode', async (btn) => {
  990 |   if (isReadOnly()) return showToast("Your account is view-only.", 'error');
  991 |   const b = lastRaw?.[currentBid]?.outlets?.[currentOid]?.billing;
  992 |   if (!b) return showToast('Billing not seeded \u2014 run tools/seed-billing-defaults.cjs.', 'error');
  993 |   const next = btn?.dataset?.mode;
  994 |   const info = BILLING_MODE_INFO[next];
  995 |   if (!info) return showToast('Unknown billing mode.', 'error');
  996 |   const ok = await showConfirm({
  997 |     title: `Switch to ${info.label}?`,
  998 |     body: `${info.body(b)} This applies to all of this restaurant's orders in reports and the wallet, including past orders in the selected period.`,
  999 |     confirmLabel: 'Switch mode',
```

#### SupremeAdmin/js/features/restaurant-profile.js change 2 of 2: old lines 998-1003 -> new lines 1003-1008 (+2 / -2)

**What:** Success toast uses the chosen mode's label.

**Effect:** Feedback matches the chosen package.

Before (`main`):
```js
  998 |     await firebase.database().ref(`businesses/${currentBid}/outlets/${currentOid}/billing`).update({ mode: next });
  999 |     showToast(`Billing mode → ${next === 'commission_1pct' ? '1% of sales' : 'per order'}.`, 'success');
 1000 |   } catch (err) {
 1001 |     console.error('billing mode switch failed', err);
 1002 |     showToast('Mode switch failed — check the console.', 'error');
 1003 |   }
```

After:
```js
 1003 |     await firebase.database().ref(`businesses/${currentBid}/outlets/${currentOid}/billing`).update({ mode: next });
 1004 |     showToast(`Billing mode \u2192 ${info.label}.`, 'success');
 1005 |   } catch (err) {
 1006 |     console.error('billing mode switch failed', err);
 1007 |     showToast('Mode switch failed \u2014 check the console.', 'error');
 1008 |   }
```

### `SupremeAdmin/js/features/templates/billing-card.js`

**Supreme billing card.** +6 / -5 lines in 4 change(s). Package display and buttons.

#### SupremeAdmin/js/features/templates/billing-card.js change 1 of 4: old lines 5-6 -> new lines 5-7 (+1 / -0)

**What:** Imports `normalizeMode`.

**Effect:** Dependency.

Before (`main`):
```js
    5 | import { escapeHtml } from '/js/utils.js';
    6 | import { scopeStats, inr, currentYm, monthLabel, recordPaymentModal, printReceipt } from '../../billing-shared.js';
```

After:
```js
    5 | import { escapeHtml } from '/js/utils.js';
    6 | import { normalizeMode } from '/shared/cost-math.js';
    7 | import { scopeStats, inr, currentYm, monthLabel, recordPaymentModal, printReceipt } from '../../billing-shared.js';
```

#### SupremeAdmin/js/features/templates/billing-card.js change 2 of 4: old lines 26-28 -> new lines 27-29 (+1 / -1)

**What:** `mode` uses `normalizeMode`.

**Effect:** Percentage mode recognised.

Before (`main`):
```js
   26 | 
   27 |   const mode = b.mode === 'commission_1pct' ? 'commission_1pct' : 'per_order';
   28 |   const rates = b.rates || {};
```

After:
```js
   27 | 
   28 |   const mode = normalizeMode(b.mode);
   29 |   const rates = b.rates || {};
```

#### SupremeAdmin/js/features/templates/billing-card.js change 3 of 4: old lines 39-41 -> new lines 40-42 (+1 / -1)

**What:** 'Pricing mode' cell shows 'Percentage package (1% / 2% WhatsApp)'.

**Effect:** Correct display.

Before (`main`):
```js
   39 |       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px">
   40 |         <div class="detail-cell"><div class="detail-label">Pricing mode</div><div class="detail-value">${mode === 'commission_1pct' ? '1% of sales' : 'Per order'}</div></div>
   41 |         <div class="detail-cell"><div class="detail-label">Setup fee</div><div class="detail-value">₹${b.setup?.amount ?? 500} · ${escapeHtml(String(b.setup?.status || '—'))}</div></div>
```

After:
```js
   40 |       <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px">
   41 |         <div class="detail-cell"><div class="detail-label">Pricing mode</div><div class="detail-value">${mode === 'percentage' ? 'Percentage package (1% / 2% WhatsApp)' : mode === 'commission_1pct' ? '1% of sales' : 'Per order'}</div></div>
   42 |         <div class="detail-cell"><div class="detail-label">Setup fee</div><div class="detail-value">₹${b.setup?.amount ?? 500} · ${escapeHtml(String(b.setup?.status || '—'))}</div></div>
```

#### SupremeAdmin/js/features/templates/billing-card.js change 4 of 4: old lines 58-62 -> new lines 59-63 (+3 / -3)

**What:** Single toggle button replaced by one 'Switch to ...' button for each mode that is not current.

**Effect:** One click to any package.

Before (`main`):
```js
   58 |       <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
   59 |         <button class="btn btn-ghost btn-sm" data-action="billing-toggle-mode" ${ro} title="${mode === 'per_order' ? 'Charge WhatsApp delivery orders at 1% of order value instead of the flat rate' : 'Go back to flat per-order rates'}">
   60 |           ${mode === 'per_order' ? 'Switch to 1% of sales' : 'Switch to per-order'}
   61 |         </button>
   62 |         <select id="billingSetupStatus" class="text-input" style="width:auto" data-billing-draft="setup" ${ro}>
```

After:
```js
   59 |       <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
   60 |         ${[['per_order', 'Flat per-order'], ['percentage', 'Percentage package (1% / 2% WhatsApp)'], ['commission_1pct', 'WhatsApp 1% only']]
   61 |           .filter(([m]) => m !== mode)
   62 |           .map(([m, label]) => `<button class="btn btn-ghost btn-sm" data-action="billing-set-mode" data-mode="${m}" ${ro} title="${roTitle}">Switch to ${label}</button>`).join('\n        ')}
   63 |         <select id="billingSetupStatus" class="text-input" style="width:auto" data-billing-draft="setup" ${ro}>
```

### `website/signup.html`

**Public sign-up page.** +137 / -68 lines in 11 change(s). Inline validation, no duplicate submissions, correct copy and success state.

#### website/signup.html change 1 of 11: old lines 36-37 -> new lines 36-45 (+8 / -0)

**What:** CSS: `.field-error`, `[aria-invalid]`, `.form-status`, `.success` (hidden until `.show`), `.is-done` hides the fields.

**Effect:** Fixes the always-visible 'Application received!' box and styles the new messages.

Before (`main`):
```html
   36 | 
   37 |   footer{margin-top:56px}
```

After:
```html
   36 | 
   37 |   .field-error{color:#b91c1c;font-size:13px;margin-top:4px;line-height:1.4}
   38 |   input[aria-invalid="true"]{border-color:#b91c1c}
   39 |   .form-status{font-size:14px;line-height:1.5;margin:14px 0 0;color:#b91c1c}
   40 |   .form-status:empty{display:none}
   41 |   .form-card.is-done .form-fields{display:none}
   42 |   .success{display:none;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:12px;padding:18px 20px;line-height:1.6;font-size:15px}
   43 |   .success.show{display:block}
   44 | 
   45 |   footer{margin-top:56px}
```

#### website/signup.html change 2 of 11: old lines 82-84 -> new lines 90-92 (+1 / -1)

**What:** Intro sentence: dashboard is created automatically; Rs 1,000 minimum wallet to go live.

**Effect:** Public wording matches auto-approval and the wallet rule.

Before (`main`):
```html
   82 |     <h1>Register Your Restaurant on FoodHubbie</h1>
   83 |     <p class="sub">Fill in your details and our team will review your application. Once approved, you'll get access to your restaurant dashboard.</p>
   84 |   </div>
```

After:
```html
   90 |     <h1>Register Your Restaurant on FoodHubbie</h1>
   91 |     <p class="sub">Fill in your details and we'll create your restaurant dashboard automatically. You can set up your menu and tables right away; to go live, add a minimum wallet balance of ₹1,000 by contacting us.</p>
   92 |   </div>
```

#### website/signup.html change 3 of 11: old lines 88-89 -> new lines 96-98 (+1 / -0)

**What:** Wraps all fields in `<div class="form-fields">`.

**Effect:** Lets the success state hide the form.

Before (`main`):
```html
   88 |   <form class="form-card" id="signupForm" onsubmit="return handleSubmit(event)">
   89 |     <div class="row">
```

After:
```html
   96 |   <form class="form-card" id="signupForm" onsubmit="return handleSubmit(event)">
   97 |   <div class="form-fields">
   98 |     <div class="row">
```

#### website/signup.html change 4 of 11: old lines 127-129 -> new lines 136-138 (+1 / -1)

**What:** Admin password: `minlength` 6 -> 8, `autocomplete="new-password"`.

**Effect:** Stronger minimum on the client (rules still accept 6+).

Before (`main`):
```html
  127 |         <label for="fPassword">Admin Password *</label>
  128 |         <input type="password" id="fPassword" required minlength="6" placeholder="Min 6 characters">
  129 |       </div>
```

After:
```html
  136 |         <label for="fPassword">Admin Password *</label>
  137 |         <input type="password" id="fPassword" required minlength="8" autocomplete="new-password" placeholder="Min 8 characters">
  138 |       </div>
```

#### website/signup.html change 5 of 11: old lines 131-133 -> new lines 140-142 (+1 / -1)

**What:** Confirm password: same change.

**Effect:** Same.

Before (`main`):
```html
  131 |         <label for="fPassword2">Confirm Password *</label>
  132 |         <input type="password" id="fPassword2" required minlength="6" placeholder="Re-enter password">
  133 |       </div>
```

After:
```html
  140 |         <label for="fPassword2">Confirm Password *</label>
  141 |         <input type="password" id="fPassword2" required minlength="8" autocomplete="new-password" placeholder="Re-enter password">
  142 |       </div>
```

#### website/signup.html change 6 of 11: old lines 172-179 -> new lines 181-190 (+7 / -5)

**What:** Adds `#formStatus` live region, button text 'Register Restaurant', closes the wrapper, success box gets `role="status"` and new text.

**Effect:** Accessible error line; success copy explains next steps.

Before (`main`):
```html
  172 | 
  173 |     <button type="submit" class="submit-btn" id="submitBtn">Submit Application</button>
  174 | 
  175 |     <div class="success" id="successMsg">
  176 |       ✅ <b>Application received!</b><br>
  177 |       Our team will review your registration and contact you within 24 hours.<br>
  178 |       Once approved, you can log in to your dashboard with the email and password you provided.
  179 |     </div>
```

After:
```html
  181 | 
  182 |     <div class="form-status" id="formStatus" role="alert" aria-live="polite"></div>
  183 |     <button type="submit" class="submit-btn" id="submitBtn">Register Restaurant</button>
  184 |   </div>
  185 | 
  186 |     <div class="success" id="successMsg" role="status" tabindex="-1">
  187 |       ✅ <b>Registration received!</b><br>
  188 |       Your restaurant account is being created. In a few minutes you can log in to your dashboard with the email and password you chose.<br>
  189 |       Set up your menu and tables first. To start taking orders, add a minimum wallet balance of ₹1,000 by contacting FoodHubbie support from the dashboard.
  190 |     </div>
```

#### website/signup.html change 7 of 11: old lines 221-249 -> new lines 232-311 (+74 / -23)

**What:** `handleSubmit` start: new state (`_reqKey`, `_submitting`, `_done`), `fieldError()`, `validateForm()`, early returns, field-level messages, focus on the first error.

**Effect:** No more `alert()`; no network call while invalid; double clicks ignored.

Before (`main`):
```html
  221 | 
  222 |   async function handleSubmit(e) {
  223 |     e.preventDefault();
  224 |     var businessName = document.getElementById('fBusiness').value.trim();
  225 |     var outletName = document.getElementById('fOutlet').value.trim();
  226 |     var contactPhone = document.getElementById('fPhone').value.trim();
  227 |     var contactEmail = document.getElementById('fEmail').value.trim();
  228 |     var adminEmail = document.getElementById('fAdminEmail').value.trim();
  229 |     var adminName = document.getElementById('fAdminName').value.trim();
  230 |     var adminPassword = document.getElementById('fPassword').value;
  231 |     var adminPassword2 = document.getElementById('fPassword2').value;
  232 |     var plan = document.querySelector('input[name="plan"]:checked');
  233 |     var whatsappConnect = document.querySelector('input[name="whatsapp"]:checked');
  234 |     var terms = document.getElementById('fTerms');
  235 | 
  236 |     if (!businessName || !outletName || !contactPhone || !contactEmail) return false;
  237 |     if (!adminEmail || !adminName || !adminPassword) return false;
  238 |     if (adminPassword !== adminPassword2) {
  239 |       alert('Passwords do not match.');
  240 |       return false;
  241 |     }
  242 |     if (!plan || !whatsappConnect) {
  243 |       alert('Please select a plan and WhatsApp option.');
  244 |       return false;
  245 |     }
  246 |     if (!terms || !terms.checked) {
  247 |       alert('Please accept the billing, refund, WhatsApp and privacy policies.');
  248 |       terms.focus();
  249 |       return false;
```

After:
```html
  232 | 
  233 |   var DB_URL = 'https://foodhubbie-10-default-rtdb.firebaseio.com';
  234 |   // Submission state. A request is created at most once per page visit: if the
  235 |   // password save (step 2) fails, a retry re-sends only step 2 for the same
  236 |   // request instead of creating a duplicate application.
  237 |   var _reqKey = null;
  238 |   var _submitting = false;
  239 |   var _done = false;
  240 | 
  241 |   function fieldError(id, msg) {
  242 |     var input = document.getElementById(id);
  243 |     var errId = id + 'Err';
  244 |     var old = document.getElementById(errId);
  245 |     if (old) old.remove();
  246 |     if (!input) return;
  247 |     if (!msg) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); return; }
  248 |     var div = document.createElement('div');
  249 |     div.className = 'field-error';
  250 |     div.id = errId;
  251 |     div.textContent = msg;
  252 |     input.setAttribute('aria-invalid', 'true');
  253 |     input.setAttribute('aria-describedby', errId);
  254 |     input.insertAdjacentElement('afterend', div);
  255 |   }
  256 | 
  257 |   function validateForm(v) {
  258 |     // Returns [{id, msg}] in DOM order. Mirrors database.rules.json limits.
  259 |     var errs = [];
  260 |     var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  261 |     if (v.businessName.length < 2) errs.push({ id: 'fBusiness', msg: 'Enter your business name (at least 2 characters).' });
  262 |     if (v.outletName.length < 2) errs.push({ id: 'fOutlet', msg: 'Enter your outlet name (at least 2 characters).' });
  263 |     var digits = v.contactPhone.replace(/[^0-9]/g, '');
  264 |     if (digits.length < 10 || v.contactPhone.length > 15) errs.push({ id: 'fPhone', msg: 'Enter a valid phone number (10 to 15 digits).' });
  265 |     if (!emailRe.test(v.contactEmail)) errs.push({ id: 'fEmail', msg: 'Enter a valid contact email address.' });
  266 |     if (!emailRe.test(v.adminEmail)) errs.push({ id: 'fAdminEmail', msg: 'Enter a valid email address for your dashboard login.' });
  267 |     if (v.adminName.length < 1) errs.push({ id: 'fAdminName', msg: 'Enter the admin name.' });
  268 |     if (v.adminPassword.length < 8) errs.push({ id: 'fPassword', msg: 'Use at least 8 characters.' });
  269 |     else if (v.adminPassword.length > 128) errs.push({ id: 'fPassword', msg: 'Use at most 128 characters.' });
  270 |     if (v.adminPassword !== v.adminPassword2) errs.push({ id: 'fPassword2', msg: 'Passwords do not match.' });
  271 |     if (!v.plan) errs.push({ id: 'planGroup', msg: 'Select a plan.' });
  272 |     if (!v.whatsappConnect) errs.push({ id: 'planGroup', msg: 'Select a WhatsApp option.' });
  273 |     if (!v.terms) errs.push({ id: 'fTerms', msg: 'Please accept the policies to continue.' });
  274 |     return errs;
  275 |   }
  276 | 
  277 |   async function handleSubmit(e) {
  278 |     e.preventDefault();
  279 |     if (_submitting || _done) return false;
  280 | 
  281 |     var plan = document.querySelector('input[name="plan"]:checked');
  282 |     var wa = document.querySelector('input[name="whatsapp"]:checked');
  283 |     var v = {
  284 |       businessName: document.getElementById('fBusiness').value.trim(),
  285 |       outletName: document.getElementById('fOutlet').value.trim(),
  286 |       contactPhone: document.getElementById('fPhone').value.trim(),
  287 |       contactEmail: document.getElementById('fEmail').value.trim(),
  288 |       adminEmail: document.getElementById('fAdminEmail').value.trim(),
  289 |       adminName: document.getElementById('fAdminName').value.trim(),
  290 |       adminPassword: document.getElementById('fPassword').value,
  291 |       adminPassword2: document.getElementById('fPassword2').value,
  292 |       plan: plan ? plan.value : '',
  293 |       whatsappConnect: wa ? wa.value : '',
  294 |       terms: document.getElementById('fTerms').checked
  295 |     };
  296 | 
  297 |     ['fBusiness','fOutlet','fPhone','fEmail','fAdminEmail','fAdminName','fPassword','fPassword2','planGroup','fTerms']
  298 |       .forEach(function (id) { fieldError(id, ''); });
  299 |     var status = document.getElementById('formStatus');
  300 |     status.textContent = '';
  301 | 
  302 |     var errs = validateForm(v);
  303 |     if (errs.length) {
  304 |       errs.forEach(function (er) {
  305 |         // planGroup is a div, not an input: show its message in the status line instead.
  306 |         if (er.id === 'planGroup') status.textContent = er.msg; else fieldError(er.id, er.msg);
  307 |       });
  308 |       var first = errs.find(function (er) { return er.id !== 'planGroup'; });
  309 |       var target = document.getElementById(first ? first.id : 'planGroup');
  310 |       if (target && target.focus) target.focus();
  311 |       return false;
```

#### website/signup.html change 8 of 11: old lines 252-253 -> new lines 314-316 (+1 / -0)

**What:** Disables the button and sets `_submitting` before the requests.

**Effect:** Prevents duplicate submissions.

Before (`main`):
```html
  252 |     var btn = document.getElementById('submitBtn');
  253 |     btn.disabled = true;
```

After:
```html
  314 |     var btn = document.getElementById('submitBtn');
  315 |     _submitting = true;
  316 |     btn.disabled = true;
```

#### website/signup.html change 9 of 11: old lines 256-288 -> new lines 319-353 (+31 / -29)

**What:** Step 1 (create request) runs only if `_reqKey` is empty; step 2 (password) always runs.

**Effect:** A retry after a failed password save does not create a second application.

Before (`main`):
```html
  256 |     try {
  257 |       // Step 1: public request WITHOUT the password (readable by Supreme reviewers).
  258 |       var res = await fetch('https://foodhubbie-10-default-rtdb.firebaseio.com/onboardingRequests.json', {
  259 |         method: 'POST',
  260 |         headers: { 'Content-Type': 'application/json' },
  261 |         body: JSON.stringify({
  262 |           businessName: businessName,
  263 |           outletName: outletName,
  264 |           contactPhone: contactPhone,
  265 |           contactEmail: contactEmail,
  266 |           adminEmail: adminEmail,
  267 |           adminName: adminName,
  268 |           plan: plan.value,
  269 |           whatsappConnect: whatsappConnect.value,
  270 |           template: '',
  271 |           source: 'website',
  272 |           status: 'pending',
  273 |           termsVersion: TERMS_VERSION,
  274 |           termsAcceptedAt: Date.now(),
  275 |           createdAt: Date.now()
  276 |         })
  277 |       });
  278 |       if (!res.ok) throw new Error('Save failed: ' + res.status);
  279 |       var saved = await res.json();
  280 |       var reqKey = saved && saved.name;
  281 |       if (!reqKey) throw new Error('Save returned no key');
  282 |       // Step 2: password goes to the write-only secrets node (no client read rule —
  283 |       // only the approval backend reads it via Admin SDK, then deletes it).
  284 |       var secRes = await fetch('https://foodhubbie-10-default-rtdb.firebaseio.com/onboardingSecrets/' + encodeURIComponent(reqKey) + '.json', {
  285 |         method: 'PUT',
  286 |         headers: { 'Content-Type': 'application/json' },
  287 |         body: JSON.stringify({ password: adminPassword, createdAt: Date.now() })
  288 |       });
```

After:
```html
  319 |     try {
  320 |       if (!_reqKey) {
  321 |         // Step 1: the public request, WITHOUT the password (readable by Supreme reviewers).
  322 |         var res = await fetch(DB_URL + '/onboardingRequests.json', {
  323 |           method: 'POST',
  324 |           headers: { 'Content-Type': 'application/json' },
  325 |           body: JSON.stringify({
  326 |             businessName: v.businessName,
  327 |             outletName: v.outletName,
  328 |             contactPhone: v.contactPhone,
  329 |             contactEmail: v.contactEmail,
  330 |             adminEmail: v.adminEmail,
  331 |             adminName: v.adminName,
  332 |             plan: v.plan,
  333 |             whatsappConnect: v.whatsappConnect,
  334 |             template: '',
  335 |             source: 'website',
  336 |             status: 'pending',
  337 |             termsVersion: TERMS_VERSION,
  338 |             termsAcceptedAt: Date.now(),
  339 |             createdAt: Date.now()
  340 |           })
  341 |         });
  342 |         if (!res.ok) throw new Error('Save failed: ' + res.status);
  343 |         var saved = await res.json();
  344 |         if (!saved || !saved.name) throw new Error('Save returned no key');
  345 |         _reqKey = saved.name;
  346 |       }
  347 |       // Step 2: the password goes to the write-only secrets node (no client read rule;
  348 |       // only the approval backend reads it via the Admin SDK, then deletes it).
  349 |       var secRes = await fetch(DB_URL + '/onboardingSecrets/' + encodeURIComponent(_reqKey) + '.json', {
  350 |         method: 'PUT',
  351 |         headers: { 'Content-Type': 'application/json' },
  352 |         body: JSON.stringify({ password: v.adminPassword, createdAt: Date.now() })
  353 |       });
```

#### website/signup.html change 10 of 11: old lines 291-295 -> new lines 356-361 (+3 / -2)

**What:** Error path shows a message in `#formStatus`, re-enables the button as 'Retry Submit'.

**Effect:** Entered data is kept; clear recovery.

Before (`main`):
```html
  291 |       console.warn('Save failed', err);
  292 |       alert('Submission failed — please check your connection and try again.');
  293 |       btn.disabled = false;
  294 |       btn.textContent = 'Submit Application';
  295 |       return false;
```

After:
```html
  356 |       console.warn('Save failed', err);
  357 |       status.textContent = 'We could not submit your application. Your details are still filled in. Check your connection and press Submit again.';
  358 |       _submitting = false;
  359 |       btn.disabled = false;
  360 |       btn.textContent = _reqKey ? 'Retry Submit' : 'Register Restaurant';
  361 |       return false;
```

#### website/signup.html change 11 of 11: old lines 297-304 -> new lines 363-373 (+9 / -6)

**What:** Success path: marks done, clears both password fields, hides the form, shows and focuses the success box.

**Effect:** No resubmission, no password left in the page.

Before (`main`):
```html
  297 | 
  298 |     document.getElementById('successMsg').classList.add('show');
  299 | 
  300 |     setTimeout(function () {
  301 |       btn.disabled = false;
  302 |       btn.textContent = 'Submit Application';
  303 |     }, 3000);
  304 |     return false;
```

After:
```html
  363 | 
  364 |     // Success: lock the form for good (no resubmission) and drop the passwords from the DOM.
  365 |     _done = true;
  366 |     _submitting = false;
  367 |     document.getElementById('fPassword').value = '';
  368 |     document.getElementById('fPassword2').value = '';
  369 |     document.getElementById('signupForm').classList.add('is-done');
  370 |     var ok = document.getElementById('successMsg');
  371 |     ok.classList.add('show');
  372 |     ok.focus();
  373 |     return false;
```

## 4. New files (no "before")

### `Admin/js/features/setup-checklist.js` (NEW, 110 lines)

Dashboard setup checklist. Derived from existing data (store profile, dishes, tables, WhatsApp status, billing, orders); read-only. Top-up is the last required step. Effect: new owners see what is left and a next action; nothing is stored.

| Line | Definition |
|---:|---|
| 18 | `async function exists(path) {` |
| 27 | `async function collectTasks() {` |
| 61 | `function render(el, tasks) {` |
| 94 | `export async function loadSetupChecklist() {` |

### `Admin/js/features/wallet-alert.js` (NEW, 62 lines)

Dashboard low-balance banner. Skips restaurants that never topped up (no extra read). Reads orders once, cached 5 minutes. Effect: owner is warned at or below 25% left and at zero.

| Line | Definition |
|---:|---|
| 20 | `async function loadWallet() {` |
| 40 | `export async function loadWalletAlert() {` |

### `tests/signup-onboarding.check.mjs` (NEW, 69 lines)

Mocked-network test of the sign-up form (12 checks).

### `tests/auto-onboarding.check.cjs` (NEW, 80 lines)

Runs the real server functions against a fake Admin SDK (6 checks).

| Line | Definition |
|---:|---|
| 11 | `function makeFake(db0, users0) {` |

### `tests/admin-wallet-checklist.check.mjs` (NEW, 99 lines)

Runs real costs/checklist/alert modules against stubs (3 suites).

| Line | Definition |
|---:|---|
| 12 | `export const limitToLast = () => null, query = (p) => p;` |
| 13 | `export const get = async (p) => { const v = globalThis.DATA[p]; if (v === 'ERR') throw new` |
| 14 | `export const onValue = (p, cb) => { cb({ val: () => globalThis.DATA[p] ?? null }); return ` |
| 15 | `export const onChildAdded = () => () => {}, onChildChanged = () => () => {}, orderByChild ` |

## 5. Wiring map: which change depends on which

| If you take only... | You also need |
|---|---|
| Setup checklist (`setup-checklist.js`) | `Admin/index.html` change 1, `ui.js` change 3, `shared/cost-math.js` (wallet) |
| Wallet view | `costs.js` (all), `Admin/index.html` changes 2-3, `shared/cost-math.js` |
| Setup-only lock (UI) | `ui.js` changes 2, 4, 5, 6; `auth.js` both; `main.js` both |
| Lock enforced in rules | `database.rules.json` (3 changes). Independent of the UI, but test with the emulator first |
| Auto-approval | `server.js` all 8 changes only; restart the API |
| Percentage package | `shared/cost-math.js`, `costs.js` changes 3, 5-7, all four Supreme files |
| Low-balance warning | `shared/cost-math.js`, `wallet-alert.js`, `ui.js` change 3, `Admin/index.html` change 1, `payment-overview.js` |
| Sign-up form | `website/signup.html` only |

