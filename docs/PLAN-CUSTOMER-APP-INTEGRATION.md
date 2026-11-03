# Plan — Customer App integration (Claude package) on top of main + latest work

**Date:** 2026-11-02 · **Status:** DONE — local verification green, live E2E on the e2e outlet, deployed.
**Source package:** `PLAN/FoodHubbie-Customer APP by CLaude/FoodHubbie-Final/` (built on `main@26322b8`)
**Branch:** `feat/customer-app-integration` (based on `e0aeb87` = main + domain migration, percentage billing,
loyalty Phase 2.5, wallet model, audit fixes, marketing/WA-upcoming commits)

## Decisions (owner, 2026-11-02)

1. **Base:** apply the package on `main` **and** include every latest change already on `seo-brand-consistency`
   (custom domains `app/menu/rider/control.foodhubbie.in`, UI audit fixes, encoding fix, loyalty Phase 2.5,
   wallet minimum model). `main` fast-forwards after verification.
2. **Billing rates — FINAL, everywhere:**
   | Source | Rate |
   |---|---|
   | WhatsApp-based orders (bot, webview delivery links) | **3 %** |
   | Customer App orders (`source:'APP'` / `channel:'app'`) | **2 %** |
   | QR menu | **1 %** |
   | POS counter | **1 %** |
   | Unknown / legacy / other | **3 %** (safe default, highest) |
   Promo stays ₹1/token. **Setup fee: none** — removed 2026-11-01 with the wallet-minimum model
   (new tenants get `setup:{amount:0,status:'none'}`; existing stored setup records are left untouched).
   Wallet minimum: first top-up ₹1,000, or ₹1,500 when the outlet uses WhatsApp. Flat `per_order` mode stays
   readable for old rows only.
3. **Phone privacy:** accept first-phone-wins (no OTP), as documented by the package.
4. **Deploy:** full live deploy after local verification + rules emulator + builds.
5. **Rules emulator:** portable Temurin 21 JRE in `%TEMP%` (no system install).
6. **Loyalty:** apply package defaults (1 pt/₹50 = 5000 paise, 180-day expiry) **only where unset**; never
   overwrite configured outlets or existing balances.
7. Concurrent agent work already committed (`cccff3e` walletGate) must be preserved.

## Integration order (as executed)

1. Branch `feat/customer-app-integration` from `e0aeb87`; applied `patches/foodhubbie-ALL-IN-ONE.patch`
   with `git apply --3way` and resolved 9 conflicts keeping both sides:
   - `shared/cost-math.js` — package APP source + our percentage plan/encoding/walletGate; final rates.
   - `shared/billing-defaults.{js,cjs}` — wallet minimum + package APP defaults + final rates.
   - `database.rules.json` — union: package `app:` / privacy rules + our loyalty `rankings`/`adjustments` + `walletGate`.
   - `bot/index.js` — kept env-overridable `menu.foodhubbie.in`; added payment-sync + redeem hooks.
   - `Admin/js/features/costs.js` — walletGate + Customer App labels + final rates.
   - `Admin/js/features/loyalty.js` — package redemption/expiry on top of Phase 2.5.
   - `SupremeAdmin/js/features/restaurant-profile.js` — kept `app.foodhubbie.in`.
   - `menu/sw.js` — v31 (`./js/app-checkout.js` precached).
2. New files: `bot/payment-sync.js`, `menu/js/app-checkout.js`, `tests/direct-mode.check.mjs`,
   `tests/payment-sync.check.cjs`, `tests/loyalty-redeem.check.cjs`, docs.
3. Billing rate sweep across 25 files (Admin/Supreme labels, website + JSON-LD, pricing docs, seeders, sales agent).
4. Verification (all green, see `docs/FINAL-VERIFICATION-REPORT.md`):
   - `node tests/rules.emulator.mjs` under the Firebase database emulator (portable Temurin 21): **60/60**.
   - `node tests/direct-mode.check.mjs`: **18/18** browser scenarios.
   - `node shared/cost-math.js`, twins 5/5, payment-sync, loyalty-redeem, customer-profile, bot unit 18/18,
     auto-onboarding 16/16, encoding check.
   - `npm run build` (Admin + Supreme) and `rider-app npm run build`.
5. Commit + push branch; live E2E on the e2e outlet; deploy rules + hosting (menu/admin/supreme/rider/website) + bot restart.
6. Fast-forward `main`.

## Out of scope / explicitly not doing

- Copying `source/` wholesale (stale docs/website/`.web.app` URLs).
- Enabling WhatsApp ordering (label stays "Upcoming"; billing maths stays live at 3 %).
- OTP-based phone verification.

## Customer-app feature surface (what ships)

- **Direct mode** (no table token, bare `menu.foodhubbie.in` link): sign-in screen (phone first, name optional),
  full menu, app tabs (Menu, Cart, Orders, Loyalty, Account).
- **Sign-in** = Firebase anonymous auth + first-phone-wins device registration under
  `customers/{phone}/devices/{uid}` (no OTP). Second device joins with an 8-digit link code.
- **In-app checkout** (`menu/js/app-checkout.js`): pickup (no address/fee) and delivery (location + address,
  slab fee), COD/pay-at-counter only. Orders are written with `source:'APP'`, `channel:'app'`, routed through
  `Pending` → session-independent app finalization in the bot (discounts, reward tender, stock, profile).
- **Orders tab**: live tracking with delivery steps, rider name/phone, delivery code, cancel while `Placed`.
- **Loyalty tab**: balance, tier, rewards, in-app redemption request → WhatsApp code (bot `redeem.js`),
  expiry (`expiryDays`, default 180).
- **Account tab**: profile/consent, device/link-code management, notification toggle.
- **Table (dine-in) mode is unchanged** — the original QR flow, tabs and session attach still apply.
