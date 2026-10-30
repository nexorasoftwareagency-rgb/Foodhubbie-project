# Onboarding, Wallet and Percentage Package: Integration Guide

> Ready-to-integrate guide for the `feat/onboarding-setup-checklist` change set (3 commits).
> Each step: command, expected result, how to verify, what to do if it fails.
> Nothing in this change set has been deployed. Items marked **NOT TESTED** were not run when the code was written (no Firebase emulator, no npm registry, no browser run).

---

## 1. What this change set does

| Area | Behaviour |
|---|---|
| Sign-up (`website/signup.html`) | Inline validation, one request per visit (retry reuses it), form locks after success, success box hidden until success. |
| Auto-approval (`bot-control-api/server.js`) | A website sign-up creates the Auth user, `admins/{uid}`, and the outlet automatically. The outlet starts `locked: true`. Supreme Admin gets a notification (`inquiries` record). Capped per hour; only sign-ups from the last 15 minutes are auto-approved; kill switch available. The manual approve endpoint still works. |
| Lock (`database.rules.json`) | While `locked`, writes to `orders`, `tableSessions`, `tableRequests` are refused (Super/Supreme exempt). |
| Setup-only mode (Admin app) | A locked owner can use Dashboard, Menu, Categories, Combos, Menu Browser, Tables, Inventory, Settings, Costs, Notifications. Other tabs show a "top up to go live" popup. A banner explains the state. |
| Setup checklist (Admin dashboard) | Derived from existing data. Last required step: wallet top-up of at least `MIN_TOPUP` (Rs 1,000). Then "Take your first order". |
| Wallet (Admin > Costs > Wallet) | Balance = total topped up minus orders, promo messages and charges. Shows history and how to top up. |
| Low balance | At or below 25% of everything topped up: "low". At or below zero: "empty". Dashboard banner for the restaurant; chip and tile in Supreme > Payments. Warning only, nothing is blocked. |
| Percentage package | Per restaurant, chosen in Supreme. 1% of order value on QR, POS and everything else, 2% on WhatsApp-based ordering. Flat per-order stays the default. |

### Files

| File | Change |
|---|---|
| `shared/cost-math.js` | `MIN_TOPUP`, `LOW_BALANCE_RATIO`, `PERCENT_RATES`, `normalizeMode`, `rateLabel`, `computeWallet`, `walletLevel`, percentage fee; self-checks |
| `database.rules.json` | 3 `.write` rules wrapped with the lock gate, plus `.indexOn: ["status"]` on `onboardingRequests` |
| `bot-control-api/server.js` | `approveOnboardingRequest()`, manual endpoint, auto-approval watcher |
| `Admin/js/ui.js`, `auth.js`, `main.js` | `SETUP_TABS`, setup mode, locked popup, dashboard hooks |
| `Admin/js/features/setup-checklist.js` | New: dashboard checklist |
| `Admin/js/features/wallet-alert.js` | New: dashboard low-balance banner |
| `Admin/js/features/costs.js`, `Admin/index.html` | Wallet sub-tab; mode and rate labels |
| `SupremeAdmin/js/billing-shared.js`, `payment-record.js`, `payment-overview.js`, `features/restaurant-profile.js`, `features/templates/billing-card.js` | Percentage mode, mode switch, low-balance chips, unlock reminder |
| `website/signup.html` | Hardened form and new copy |
| `tests/*.check.*` (3 new) and `docs/ONBOARDING-AUDIT.md` | Tests and audit report |

### Data model (no schema migration)

Nothing new is stored for onboarding progress or the wallet; both are derived. Existing nodes used:

- `businesses/{bid}/outlets/{oid}/locked` (boolean, written only by Super/Supreme)
- `.../billing/mode`: `per_order` (default) | `commission_1pct` (legacy) | `percentage` (new)
- `.../billing/payments/{id}`: top-ups recorded by Supreme (`amount`, `method`, `period`, `createdAt`, `receiptNo`)
- `.../billing/charges/{id}`: extra charges
- `onboardingRequests/{key}` (adds optional `autoApproved: true`), `onboardingSecrets/{key}`, `inquiries/{key}` (notifications)

---

## 2. Apply the change set

**STEP 1: create a branch from current `main` and apply the patch**
```
git checkout main && git pull
git checkout -b feat/onboarding-setup-checklist
git am foodhubbie-onboarding.patch
```
EXPECTED: three commits applied, no conflicts.
VERIFY: `git log --oneline -3` shows `feat(billing)`, `feat(onboarding)`, `feat(onboarding)`.
IF IT FAILS: `git am --abort`, make sure `main` is at or after `a4392f1`, resolve conflicts file by file (most likely `Admin/index.html`, `Admin/js/ui.js`).

**STEP 2: run the local checks**
```
node shared/cost-math.js
node tests/encoding-check.mjs
node tests/check-imports.mjs
node tests/auto-onboarding.check.cjs
node tests/admin-wallet-checklist.check.mjs
node gate-verify.js
node tools/check-shared-twins.cjs
NODE_PATH=$(npm root -g) node tests/signup-onboarding.check.mjs
```
EXPECTED: every command exits 0 (`echo $?`). The signup check needs Playwright's Chromium.
IF IT FAILS: do not continue. Read the failing assertion; each test names the behaviour it protects.

**STEP 3: build the apps**
```
npm ci
npm run build:admin
npm run build:supreme
```
EXPECTED: both builds finish with no errors. **NOT TESTED** when written (npm registry was unreachable).
VERIFY: `ls Admin/dist/js/features/setup-checklist.js Admin/dist/js/features/wallet-alert.js` both exist, and `ls Admin/dist/shared/cost-math.js`.

---

## 3. Test the lock rules BEFORE deploying (required)

The rules change is 3 lines, but a wrong rule can block orders at live restaurants. **NOT TESTED** when written.

**STEP 4: run the existing emulator suite**
```
npx -y firebase-tools emulators:exec --only database --project demo-foodhubbie "node tests/rules.emulator.mjs"
```
EXPECTED: the existing cases all still pass (needs Java 21+).

**STEP 5: add and run these cases** (seed with the emulator admin bypass, like the existing cases)

| Case | Expected |
|---|---|
| Outlet `locked: true`: outlet admin creates `orders/{id}` | **Denied** |
| Outlet `locked: true`: customer creates a QR order | **Denied** |
| Outlet `locked: true`: customer creates `tableSessions/{id}` or `tableRequests/{id}` | **Denied** |
| Outlet `locked: true`: Super/Supreme admin creates an order | Allowed |
| Outlet `locked: true`: outlet admin writes `dishes`, `tables`, `settings/Store` | Allowed |
| Outlet `locked: false` or `locked` absent: QR order, session, request, staff order | Allowed (unchanged) |
| Outlet `disabled: true`: existing disabled behaviour | Unchanged |

IF A CASE FAILS: fix the rule in `database.rules.json` (the lock gate is the first clause of each `.write`), re-run all cases. Do not deploy until all pass.

---

## 4. Deploy (in this order)

**STEP 6: deploy the database rules**
```
firebase deploy --only database
```
EFFECT: every currently locked outlet immediately loses order writes. Check which outlets are locked first: Supreme > Restaurants, or `businesses/*/outlets/*/locked`.
VERIFY: place a test QR order on an unlocked outlet; it must succeed.

**STEP 7: deploy the API (auto-approval) on EC2**
```
cd /var/www/foodhubbie && git pull && pm2 restart bot-control-api && pm2 logs bot-control-api --lines 30
```
EXPECTED log line: `[auto-onboarding] watching new sign-ups (cap 20/hour)`.
Optional environment variables (set in `ecosystem-bot-control.config.js` env or on the box):

| Variable | Default | Meaning |
|---|---|---|
| `ONBOARDING_AUTO_APPROVE` | `on` | `off` disables auto-approval; requests then wait for manual approval in Supreme > Onboarding |
| `AUTO_APPROVE_MAX_PER_HOUR` | `20` | Extra sign-ups in an hour stay pending and you get a notification |

Run exactly one API instance (the watcher keeps its counters in memory).
On start the API replays requests that are already pending. Only those created in the last 15 minutes are auto-approved; older pending requests (including any legacy ones) stay in Supreme > Onboarding for manual review.

**STEP 8: deploy Admin and Supreme**
```
npm run deploy:admin
npm run deploy:supreme
```
VERIFY: open Admin as a test outlet, Dashboard shows the checklist; Costs opens on Wallet.

**STEP 9: deploy the website last**
```
firebase deploy --only hosting:website
```
Deploy it last so the new sign-up copy ("created automatically") only appears once auto-approval is live.

---

## 5. Verify end to end (staging or a test email)

1. Register a test restaurant at `/signup`. EXPECTED: success box appears, form hides.
2. Within about a minute: Supreme > Notifications shows "New restaurant: ...", Supreme > Onboarding shows it as approved.
3. Log in to Admin with the test email. EXPECTED: yellow setup banner; checklist with Top up as the last required step; Menu, Tables, Settings usable; POS shows the "Top up to go live" popup.
4. In Supreme > Restaurant profile > Billing > **Record payment** for Rs 1,000. EXPECTED: toast reminding you to unlock.
5. **Unlock** the restaurant (restaurant profile). EXPECTED: the test Admin session reloads; banner gone; wallet shows Rs 1,000; checklist top-up step ticked.
6. Place a test order. EXPECTED: succeeds; wallet balance drops by the fee.
7. Optional: switch the test restaurant to the percentage package. EXPECTED: Cost tab Breakdown shows "1% of order" / "2% of order".

---

## 6. Day-to-day operation (Supreme Admin)

| Task | How |
|---|---|
| New restaurant paid its first top-up | Restaurant profile > Billing > **Record payment** (UPI / Bank / Cash). At Rs 1,000 or more you are reminded to unlock. Then **Unlock**. |
| Top up an existing restaurant | Same **Record payment**. It appears in the restaurant's Wallet history. |
| Add a one-off cost | Payment record page > **Add charge**. It reduces the wallet. |
| Switch a restaurant to the percentage package | Restaurant profile > Billing > "Switch to Percentage package". Confirm. |
| See who is running low | Supreme > Payments: "Low / empty wallets" tile and per-row chips. |
| Pause auto-approval | Set `ONBOARDING_AUTO_APPROVE=off`, restart the API. |
| Stop a restaurant entirely | Existing Danger Zone > disable. |
| Change the minimum top-up | Edit `MIN_TOPUP` in `shared/cost-math.js` and redeploy Admin and Supreme. |
| Change percentage rates | Edit `PERCENT_RATES` in `shared/cost-math.js` and redeploy Admin and Supreme. |

How the balance is computed: `balance = payments - (order fees + promo messages x Rs 1 + charges)`. Cancelled and refunded orders are not billed. Supreme's "due" is the same number with the sign flipped.

---

## 7. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| New sign-up stays "pending" | Hourly cap reached, auto-approval off, request older than 15 minutes when the API saw it (for example pending before a restart), password write missing, or API not restarted | Check `pm2 logs bot-control-api`; approve manually in Supreme > Onboarding |
| Sign-up marked "rejected: email already registered" | Login email already exists in Firebase Auth | Ask the owner to use another email, or log in |
| Restaurant says orders fail after rules deploy | Outlet is still `locked` | Record the top-up, then unlock |
| Wallet shows a dash and "Could not load your usage" | Orders read failed or was denied | Reload; check the admin has `orders` read access |
| Checklist or banner missing | Role lacks Settings/Costs access (by design) or Admin not rebuilt | Check role tabs; run `npm run build:admin` and redeploy |
| Percentage package not applied in Supreme | Supreme not redeployed | `npm run deploy:supreme` |
| Rates look wrong after a switch | Fees are computed from orders at view time, so a switch re-prices past orders in the period shown | Switch at the start of a billing period |

---

## 8. Rollback

1. Rules: `git revert` the commit touching `database.rules.json`, then `firebase deploy --only database`. Locked outlets can create orders again.
2. API: `git revert`, `pm2 restart bot-control-api`; or just set `ONBOARDING_AUTO_APPROVE=off`.
3. Apps and website: revert and redeploy (`deploy:admin`, `deploy:supreme`, `hosting:website`).
4. Data: nothing was migrated. Restaurants switched to `percentage` can be switched back in Supreme; `billing.mode` is the only new value.

---

## 9. Known limits (read before relying on this)

- **Lock is partial.** It blocks orders, table sessions and table requests only. The WhatsApp bot and promo sending run server-side with admin credentials and are not stopped by rules.
- **No hard stop at zero.** At or below zero the restaurant sees "wallet balance finished", but orders still go through.
- **No push for low balance.** Supreme sees it in Payments; there is no notification.
- **Email is not verified.** Auto-approval lets anyone register any unregistered email with a password they choose. Mitigations: hourly cap, locked outlets. Recommended next step: send a set-password link instead of storing a chosen password.
- **Wallet is computed in the browser** from all orders (one read, cached 5 minutes on the dashboard). Fine for new restaurants; move to a server-maintained balance for large histories.
- **Public pages not updated.** `website/pricing.html` and `PRICING_AND_TERMS.md` still describe a Rs 500 one-time setup with no minimum balance, and do not mention the percentage package.
- **Existing Playwright specs** in `tests/` target the live production URL; they were not run.
