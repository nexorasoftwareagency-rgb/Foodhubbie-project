# Plan — One dedicated customer app per restaurant

**Status:** PROPOSED. Phase 1 is implemented on branch `feat/dedicated-customer-app`; Phases 2–5 are not started.
**Product decision (owner):** the customer app is ONE direct app for one restaurant (Zomato/Swiggy style), not limited to tables or delivery.
- First open: sign in with **phone number + name** (name is optional, used only for greetings). **No OTP.**
- After sign-in the first screen is always the restaurant's **full menu**.
- Pages: menu, cart, orders/history, loyalty card, payment history, account.

## Today (from code review)
- Two separate apps: `menu/index.html` (table QR) and `menu/delivery.html` (delivery link). Different screens, nav, order code.
- `index.html` refuses to open without a valid table token (`screenInvalid`), and re-used the last table token forever when the installed icon was opened.
- Orders: rules only accept source `QR` (table session) or `webview_delivery` (one-time token). No direct / pickup source.
- Payments: delivery orders are fixed `COD` / `Pending`. No payment history page.
- Phone is optional and lives under Promos → Account.

## Phases
| Phase | What | Status |
|---|---|---|
| 1 | Sign-in gate (first open), menu as home without a table (direct mode), table token only reused within 4 h, no-table cart shows an order-mode chooser | **Done in this branch** |
| 2a | Delivery from the direct app: cart + profile carry over to the existing delivery checkout (same tab, same origin). No rules, bot or billing change | **Done in branch `feat/direct-ordering`** |
| 2b | Pickup, and a native in-app checkout (no hop to `delivery.html`). Needs the decisions below | Not started |
| 3 | Bottom tabs for direct mode: Menu · Cart · Orders · Loyalty · Account (Orders = full phone-keyed history) | **Done in branch `feat/app-tabs`** (table app keeps its original tabs) |
| 4 | Payment history: bot mirrors payment method/status onto the customer's order record; Orders tab has an Orders / Payments switch with totals and per-order details (a payment record, not a tax invoice) | **Done in branch `feat/app-payments`** |
| 5 | Retire `delivery.html` as a separate app (redirect to the single app); migrate service-worker cache | Not started |

## Phase 1 behaviour
1. URL has a valid table token `?t=` → dine-in exactly as before.
2. URL has `?t=` but it is invalid → "invalid QR" screen (unchanged).
3. No `?t=`:
   - remembered table token younger than 4 hours → dine-in (same visit)
   - otherwise → **direct mode**: sign-in screen if no saved phone, then the full menu.
4. Direct mode cart: items can be added locally; "Place order" opens a chooser (Delivery link / "scan the QR at your table") until Phase 2.

## Known risks (unchanged by Phase 1)
- Phone-only identity: anyone who types a number can read that customer's `customers/{phone}/*` data and write order-history entries. Decision on mitigation (server-mediated reads) is open.
- Rewards already need a WhatsApp code (branch `feat/loyalty-hardening`).

## Test status
- Phase 1: Playwright run with a stubbed Firebase (see `tests/direct-mode.check.mjs`). Not run against real Firebase, a real phone, or iOS install.

## Phase 2b — decisions needed before building
Delivery orders are identified everywhere by `source === 'webview_delivery'`: the bot's server-side finalization (discount re-check, reward-code burn, stock deduction, profile save), the Admin order lists, and **billing** (`shared/cost-math.js`: ₹5 flat, or 2% in the percentage package).
- A new source (`direct_delivery` / `direct_pickup`) means touching all of those, plus new rules in `database.rules.json` (emulator-tested), plus a Pickup status flow in Admin (no rider).
- **Pricing question for the owner:** should an order placed in the restaurant's own app be billed like WhatsApp ordering (₹5 / 2%) or like other channels (₹2 / 1%)? Today's direct delivery already lands as `webview_delivery`, i.e. the WhatsApp rate. This is NOT changed by Phase 2a.

## Pricing decision (owner, 2026-11-01) — implemented in branch `feat/app-orders-pricing`
- **Foodhubbie-App Orders (Customer App)** = fixed **2%** of order value. Includes the restaurant's own app (delivery + pickup) and every order-status notification sent to the customer in the app.
- **QR menu and POS** = **1%** of order value (replaces the ₹1 / ₹2 per-order rates in this package).
- **WhatsApp bot ordering** = labelled "Upcoming feature (within 1 month)"; its pricing logic is untouched and WhatsApp work is paused.
- New restaurants start on this package (`mode: 'percentage'` in `shared/billing-defaults.*`). **Existing restaurants keep their current mode** until switched in Supreme Admin (switching re-prices their whole order history, because the wallet is computed from orders).
- App orders are recognised by `order.channel === 'app'`, written by `menu/js/delivery-order.js` when the order uses an anonymous app token. Bot/WhatsApp-issued links are not tagged.
- Not done: public website pricing page / `PRICING_AND_TERMS.md` still describe ₹1/₹2/₹5 per order and need a reviewed rewrite.

## Phase 4 notes
- Source of truth: `orders/{id}.paymentMethod/paymentStatus` (set by Admin/POS at settlement or delivery). Customers cannot read delivery orders, so `bot/payment-sync.js` mirrors status, total and payment fields onto `customers/{phone}/orders/{id}` on every order change.
- The mirror only updates records that already exist (placement/accrual create them) and is idempotent.
- Fixed on the way: the loyalty accrual replaced the customer's order record (dropping time, items and payment status); it now merges.
- Limits: online payments (gateway) do not exist, so "payment" means cash/UPI/card as recorded by staff. Orders without a customer phone (anonymous table guests) have no history. Verified with stubs only — not against real Firebase.

## Phase 2b — in-app ordering (DONE in branch `feat/app-ordering`)
The app is now complete by itself: menu -> cart -> checkout -> tracking, with no hop to `delivery.html`.
(`delivery.html` stays, because WhatsApp ordering links use it.)

- **Checkout screen** (`menu/js/app-checkout.js`): Delivery or Pickup, name, phone, address + shared location (delivery), note, coupon, bill lines (GST, delivery fee from the outlet's slabs). Pay on delivery / at the counter.
- **Order** is written with `source:'APP'`, `channel:'app'`, status `Placed`, payment `Pending`, signed in anonymously (`appUid`). Billing prices `APP` orders at 3%.
- **Rules** (`database.rules.json`): create clause for APP orders (anonymous sign-in, own uid, valid phone, Placed/Pending, no rider, outlet enabled) and a cancel clause (own order, only Placed -> Cancelled).
- **Bot**: APP orders get the same server-side finalization as web orders; the customer is told through the app only (no WhatsApp); pickup orders are not offered to riders; rider name/phone and the delivery code are mirrored to the customer's order record.
- **Admin**: Pickup flow Placed -> Confirmed -> Ready -> Served (asks payment method at Served); rider assignment disabled for Pickup. **Rider app** ignores Pickup jobs.
- **Orders tab**: live steps (delivery or pickup), rider, delivery code, and "Cancel order" while Placed.

### Not verified / limits (read before deploying)
- Database rules were NOT run in the Firebase emulator (not downloadable here). The 16 new `app:` cases in `tests/rules.emulator.mjs` are written but unrun. Run them before deploying.
- Production build and live Firebase were not exercised; browser tests use a stubbed database.
- Delivery code is stored in the phone-readable customer record (same open-by-phone risk as the rest of customer data).
- Item prices in the order come from the customer's device and are not re-checked on the server (same as existing QR / webview flows).
- Existing restaurants keep their old billing mode until switched in Supreme Admin.
- Website pricing page and `PRICING_AND_TERMS.md` still show the old rates.

## Phone privacy (branch `feat/phone-privacy`) — no OTP kept
Problem: anyone who typed a customer's phone number could read that customer's orders, points and delivery code.
Fix: "first phone to use a number owns it".
- The app signs in anonymously and registers the device at `customers/{phone}/devices/{uid}`. Reads and writes of the customer's profile, orders, ratings, loyalty and rewards now need a registered device (restaurant admins and the bot are unaffected).
- Another phone joins with an 8-digit code made on the first phone (Account -> Link another phone). Code works for 10 minutes.
- Lost phone: Admin -> Customers -> "Reset phone lock"; the next phone to use the number becomes the owner.
- Old rules still deployed: the app detects it and behaves as before ("error" state), so nothing breaks while deploying.

Residual risks (cannot be fixed without a real verification step such as a WhatsApp/SMS code):
- A stranger who opens the app with a number BEFORE its real owner does becomes the owner (including for numbers that already have history).
- iPhone: the Safari tab and the installed home-screen app are separate storage, so the installed app may ask for a link code once.
- Clearing site data / reinstalling loses the device id; use a link code or ask the restaurant to reset.
- Rules were not run in the emulator (not downloadable here); 19 new `privacy:` cases are in `tests/rules.emulator.mjs`.
- Future: the WhatsApp bot can write `customers/{phone}/link` and send the code by WhatsApp, giving real verification with the same rules.
