# FoodHubbie — Customer App integration: final verification report

**Date:** 2026-11-02
**Branch:** `feat/customer-app-integration` (rebased onto `seo-brand-consistency` = `main` + all latest work)
**Package source:** `PLAN/FoodHubbie-Customer APP by CLaude/FoodHubbie-Final/` (`patches/foodhubbie-ALL-IN-ONE.patch`, applied with `git apply --3way`)
**Status:** VERIFIED and DEPLOYED — every check below was actually executed in this session.

Billing rates in force everywhere: **WhatsApp 3 % · Customer App 2 % · QR 1 % · POS 1 % · unknown/legacy 3 %**
(promo stays ₹1/token; the old flat `per_order` / `commission_1pct` modes stay readable for historical rows only).

---

## A. What shipped

### Customer app (installed PWA / bare menu link, no table token)
- **Sign-in:** phone first, name optional. Firebase **anonymous auth** + **first-phone-wins** device
  registration under `customers/{phone}/devices/{uid}` — no OTP (owner decision). A second phone joins the
  same number with an 8-digit link code (10-minute TTL) created by the owner device.
- **Full menu → cart → in-app checkout** (`menu/js/app-checkout.js`): **pickup** (no address, no fee) or
  **delivery** (geolocation + address, fee from the outlet's distance slabs), COD / pay-at-counter.
  Orders are written straight to `{outlet}/orders` with `source:'APP'`, `channel:'app'`, `status:'Placed'`,
  `paymentStatus:'Pending'`; the bot finalizes them server-side (discount re-check, reward tender, stock,
  customer profile, payment mirror).
- **Orders tab:** live tracking (delivery steps, rider name/phone, delivery code), cancel while `Placed`.
- **Loyalty tab:** balance, tier, rewards, in-app redemption request → WhatsApp code (`bot/redeem.js`),
  expiry (`expiryDays`, default 180). Earn/clawback stay server-side.
- **Account tab:** profile + consent, device/link-code management, notification toggle.
- **Table (dine-in) QR mode is unchanged** — original tabs, session attach and lifecycle untouched.

### Billing and loyalty
- `shared/cost-math.js` recognises App orders by `source:'APP'` **or** `channel:'app'` in percentage mode.
- Loyalty Phase 2.5 merged into the package's config form: `maxRedeemPercentOfOrder` (R10 cap) and
  `expiryDays` (180) in Admin, defaults, bot and customer-app fallbacks. Defaults apply **only where unset**;
  configured outlets and existing balances are never overwritten.
- Menu checkout preview and the bot now compute the **same** tender (R10 cap applied in
  `menu/js/app-checkout.js`), so "To pay" always equals the final bill.

### Phone privacy (rules)
- Anonymous device can read/write only its own `customers/{phone}` slice after registering; a second
  anonymous uid is denied profile/history and cannot self-register without the link code.
- `tableSessionsContact` PII split and the wallet gate from the concurrent work are preserved.

---

## B. Verification matrix (all RAN, all PASS)

| Check | Result | What it proves |
|---|---|---|
| `node tests/rules.emulator.mjs` (portable Temurin 21, database emulator) | **60/60** | App-order writes, privacy (profile/history/devices/link code), loyalty rankings/adjustments, walletGate, disabled/locked gates |
| `node C:/.../e2e-customer-app.js` (live hosting + live bot + live DB) | **43/43** | Full customer-app lifecycle, see §C |
| `node tests/direct-mode.check.mjs` (real Chromium, stubbed DB) | **18/18** | Sign-in, menu-first, tabs, checkout validation, pickup/delivery orders, tracking, cancel, privacy, table mode unchanged |
| `node bot/tests/unit.test.js` | **18/18** | Bot unit suite |
| `node tools/check-shared-twins.cjs` | **5/5** | `shared/` ↔ `menu/shared/` byte-identical (combo, discount, order-id, money, loyalty) |
| `node shared/cost-math.js` | PASS | Billing maths incl. APP 2 %, WA 3 %, QR/POS 1 %, unknown 3 % |
| `node shared/loyalty-math.js` | PASS | Earn base, two-stage floor, tender cap (R10), bill-discount distribution |
| `node tests/payment-sync.check.cjs` | PASS | Payment/rider/delivery-code mirror is idempotent and bot-guarded |
| `node tests/loyalty-redeem.check.cjs` | PASS | WhatsApp-code redemption, expiry, wrong-code counter, no double deduction |
| `node tests/auto-onboarding.check.cjs` | **16/16** | Onboarding cleanup (D2) untouched |
| `node tests/customer-profile.check.mjs` | PASS | Profile wiring, 5000 paise earn default where unset |
| `node tests/signup-onboarding.check.mjs`, `check-imports`, `discount-evaluator`, `admin-wallet-checklist` | PASS | Unrelated areas still green after the rate sweep |
| `node tests/encoding-check.mjs` | PASS | No mojibake / BOM / C1 controls / U+FFFD |
| `node --check` on changed JS + `database.rules.json` JSON parse | PASS | Syntax and rule-file validity |
| `npm run build` (Admin + SupremeAdmin) | PASS | Production bundles build |
| `cd rider-app && npm run build` | PASS | Rider app builds |

---

## C. Live end-to-end (43/43) — e2e outlet, real hosting, real bot, real database

Test identity `9300000011` (privacy second phone `9300000012`); outlet repo-synced to the deployed commit.

**A. Phone privacy (7)** — two real anonymous Firebase users created; first device registers itself and can
read profile + history; the second uid is denied profile, history and self-registration.

**B. Sign-in + delivery order (17)** — bare link opens sign-in; phone + name signs in; dedicated app tabs
render; checkout prefilled; geolocation applies the ₹20 slab; order lands in Orders; `source APP` /
`channel app`; delivery, `Placed`, cash pending; anonymous `appUid` recorded; money
**₹199 + ₹9.95 GST + ₹20 fee = ₹228.95**; bot `stockDeducted`; device registered under the phone **and
matches `appUid`** (the concurrency fix); server-side profile; customer history mirror correct.

**C. Delivered / paid (5)** — bot mirrors `Paid` + method + `paidAt`; loyalty earns **9 pts** (₹199 ÷ ₹20/pt);
accrual audit uses the pre-tax earn base; leaderboard mirror written; Orders tab updates live.

**D. Cancelled → clawback (3)** — audit reason `cancelled`; points **9 → 0**; accrual idempotency lock removed.

**E. Pickup + reward tender, then cancel (9)** — pickup hides the address block; preview shows tender ₹200 →
"To pay ₹8.95" (displayed ₹9); pickup order written (`Pickup`, no fee, **₹199 + ₹9.95 = ₹208.95**); bot burns
the code and writes `loyaltyTender` 200 + `totalDue` 8.95; reward marked `used` on that order; customer cancels
while `Placed` (rules allow); **reward returns to `active` with `usedOnOrder`/`usedAt` removed**; Orders tab
shows the cancellation.

**F. Error hygiene (2)** — zero uncaught page errors, zero Firebase `permission_denied` / fatal console errors.

Screenshots: `%TEMP%/opencode/e2e-app-placed.png`, `e2e-app-orders.png`.

---

## D. Bugs found during live verification (fixed before deploy)

1. **Concurrent anonymous sign-in created multiple users.** Several first-use callers (device registration,
   profile sync, checkout) raced `signInAnonymously`; each got a different uid, so the device registered under
   one uid while the order was written by another → `permission_denied`, missing profile/mirror. Fixed in
   `menu/js/firebase.js`: one in-flight promise + `auth.authStateReady()`. This was the only E2E failure that
   required a product-code fix.
2. **Checkout preview ignored the R10 redemption cap.** The bot capped the tender at
   `maxRedeemPercentOfOrder`, the app preview did not, so "To pay" could differ from the final bill. Fixed in
   `menu/js/app-checkout.js` (`computeCheckout` + `currentTotals`).
3. **Cancelled-before-finalize order could still be finalized.** `child_added` finalized any `source` order
   without `stockDeducted`, so an order the customer cancelled before the bot saw it could deduct stock and
   burn a reward. Added `shouldFinalizeWebOrder()` (source + `!stockDeducted` + `status === 'Placed'`), used by
   both finalization call sites.
4. **Reward code not released when a `Placed` order was cancelled before accrual.** The release code sat after
   the accrual lookup, which returns early when nothing accrued. Moved the release before the lookup and kept
   the cold-transaction seed (`cur || seed`) so the resurrect cannot abort on a null first attempt.

Test-only fixes: the E2E helper now opens the Menu tab before adding a dish and detects the new pickup order
from the customer-history diff (stale Orders cards); the release assertion accepts missing `usedOnOrder`/`usedAt`
fields, because RTDB deletes keys written as `null`.

---

## E. Deployment

- **Firebase:** `database` rules + hosting `admin`, `supreme`, `menu`, `rider`, `website` deployed to
  `foodhubbie-10`. Menu hosting was redeployed after the anonymous-auth fix.
- **Admin rebuild:** the concurrent pixel/ARIA audit commit (`a2ff531`) was not part of the first build, so
  Admin was rebuilt from the final branch and redeployed. That commit had introduced a UTF-8 BOM in
  `Admin/style.css`, which the encoding guard rejects; the BOM is removed and the shell is bumped to
  **`foodhubbie-erp-shell-v5.12.16` / `style.css?v=5.4.16`** so clients pick it up.
- **Menu service worker:** `menu-shell-v32` (precaches `app-checkout.js`, forces the fixed shell).
- **EC2** (`/var/www/foodhubbie`, pm2): `bot/index.js` synced and ids **1** (pizza, meta transport) and **6**
  (e2e outlet, Baileys) restarted clean; **2** (bot-control-api) restarted earlier in the deploy.
- **Not changed:** WhatsApp ordering stays labelled "Upcoming" (billing maths is live at 3 %); no OTP flow.

---

## F. Known limitations (honest scope)

- **Push notification delivery** (FCM → real device) is not verifiable headless. The server side
  (`pushSubscriptions`, notification inbox, dead-token cleanup) is tested; the last mile needs a physical
  phone.
- **No online payment gateway** — the app collects cash/UPI at delivery or pickup by design.
- **iOS PWA** install/notification behaviour is untested on hardware; the UI has the iOS install hint path.
- **E2E outlet bot socket is dead** (Baileys 408 loop, pre-existing). App orders are finalized from DB
  listeners and all 43 live checks passed; the live pizza outlet runs `transport=meta` and is unaffected.
- **First-phone-wins** means a brand-new number claimed on two phones in the same instant can rarely register
  both; the link code is the recovery path. This is the accepted no-OTP trade-off.
- Item prices remain client-supplied (pre-existing behaviour); totals, discount, tender and stock are
  re-verified server-side by the bot.
