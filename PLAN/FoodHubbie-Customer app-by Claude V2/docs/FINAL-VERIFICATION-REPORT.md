# FoodHubbie — Final Verification Report (2026-11-02)

Honesty rule: only what is marked **RAN** was actually executed in this session. Nothing was deployed or pushed.

## A. Source of truth
- Re-fetched GitHub: `origin/main` = `26322b8` (unchanged). Branch `final/integrated` = main + 9 commits (loyalty + app chain + privacy + merge fix). 32 files changed, ~1,900 lines added.

## B. Checks that RAN and PASSED on `final/integrated`
| Check | What it proves |
|---|---|
| `node shared/cost-math.js` | billing maths incl. APP 3%, 1% default, flat mode |
| `node tests/payment-sync.check.cjs` | bot mirrors payment, rider, delivery code; idempotent; bot source guards |
| `node tests/loyalty-redeem.check.cjs` | WhatsApp-code redemption, expiry, wrong-code counter, no double deduction |
| `node tests/auto-onboarding.check.cjs` | onboarding cleanup rules |
| `node tools/check-shared-twins.cjs` | `shared/` and `menu/shared/` files identical |
| `node tests/customer-profile.check.mjs` | customer profile wiring (test updated to 5000 earn default) |
| `node tests/signup-onboarding.check.mjs`, `encoding-check`, `check-imports`, `admin-wallet-checklist` | unchanged areas still pass |
| `node tests/direct-mode.check.mjs` (real Chromium, stubbed Firebase) | 18 scenarios: sign-in, menu first, tabs, payments view, **pickup order, delivery order (slab fee, GST, COD), validation, tracking + delivery code, cancel, privacy first-owner, privacy locked + link code, link-code creation, table app unchanged** |
| `node --check` on every JS/MJS/CJS file | no syntax errors; `database.rules.json` is valid JSON |
| `foodhubbie-ALL-IN-ONE.patch` applied to a fresh copy of `origin/main` | applied with no conflicts; cost-math, payment-sync, loyalty-redeem, shared-twins, customer-profile and all 18 browser scenarios passed there too |

## C. NOT verified (be careful)
1. **Firebase rules were never run in the emulator** (the emulator download is blocked here). 60 cases exist in `tests/rules.emulator.mjs` (16 `app:` + 19 `privacy:` are new); they are written but unrun. Run them before deploying (command in the guide). This is the most important open item: the rules decide who can read/write customer data and place app orders.
2. **Production build and Playwright suite** (`npm ci` is blocked): rider app, Admin and SupremeAdmin bundles were not built; only syntax-checked.
3. **No live Firebase, WhatsApp, Razorpay or real phones.** Browser tests use a stubbed database, so real latency, real anonymous auth and iOS behaviour are untested.
4. These existing checks need npm packages that could not be installed, so they could not run here (they fail the same way on untouched `origin/main`): `admin-scope-rules`, `phase5-*-isolation`, `check-sw`, `discount-evaluator`, `attribution-check`, `notify-dedupe-check`, `optimistic-ui-check`, `fcm-push-check`. `admin-mirror-guard-check` fails on untouched `origin/main` as well (pre-existing).
5. Concurrency edge: two phones claiming the same brand-new number in the same instant could both register (rare).

## D. Integration findings (found by merging everything together)
- Merge conflict in `menu/js/customer.js` imports (resolved: both `update` and `ensureAnonAuth` imported).
- **Bug found and fixed:** after a wrong WhatsApp code the browser tried to clear an error flag that the database rules forbid it to write, so the next attempt would have shown "Wrong code" instantly. Now the bot counts `wrongTries` and the app waits for the counter to rise (test added).
- Test expectation updated: earn default is 5000 paise/point (approved loyalty change), the old check still said 2000.
- Reward redemption requests (`bot/redeemQueue`) and the new privacy rules are independent; redemption still works because the bot (admin access) writes the reward record and the owner device reads it.

## E. Decisions you may want to revisit
- Phone privacy: kept "no OTP" as you asked; trade-offs listed in the guide (first-phone-wins, iPhone storage split).
- Pickup/delivery payment: pay on delivery / at the counter only (no online payment in the app yet).
- Item prices are client-supplied (existing behaviour).

## F. Bot code review (2026-11-02)
Read every bot change in this release plus the code paths they touch. **Fixed (commit `fix(bot): review fixes…`, covered by source-guard tests + the browser test for the notification link):**
1. Customer cancels an app order before it earns points -> the burned reward code was never returned (the return only ran if points had been earned). Now returned on any cancel.
2. Push notifications for app orders opened `delivery.html` (the WhatsApp page). Now they open the app's Orders tab (`/?tab=orders`).
3. Promotional consent: the bot forced `promotionalConsent=true` for every web/app order, and promotions ignored the app's "Offers" switch. Now app orders never force it on, and a customer who switches Offers off is never messaged.
4. An app/web order placed while the bot was down or restarting was never finalized (no stock deduction, customer-claimed discount never re-checked). Now recent (24h) still-"Placed" unfinalized orders are finalized when the bot sees them.

**Found, NOT fixed (your decision):**
- **Loyalty redemption needs WhatsApp.** The redemption code is sent on WhatsApp, but app customers are deliberately not messaged on WhatsApp and WhatsApp work is pending, so in-app redemption fails with "otp unavailable" until the bot's WhatsApp is live. Option: since the phone-privacy lock now proves the request comes from the owner's registered phone, redemption could be approved by the bot after checking that device instead of a WhatsApp code (needs a small rules + bot change).
- Stock is not put back when an order is cancelled (true for every cancel, existing behaviour; bigger now because customers can cancel). Reward and loyalty points ARE returned.
- Item prices are taken from the customer's phone (existing web/QR behaviour); only the discount, tax and total are re-checked.
- Discount-usage counters are not reversed on cancel (not verified in detail).
- Push de-duplication reads then writes, so two near-simultaneous events could in rare cases send the same push twice.
- The bot's new payment/tracking mirror adds 1-2 small database reads on every order change.
