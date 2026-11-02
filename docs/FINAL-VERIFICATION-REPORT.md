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
