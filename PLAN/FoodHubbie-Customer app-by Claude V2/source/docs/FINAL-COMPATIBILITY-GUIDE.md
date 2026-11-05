# FoodHubbie — Final Compatibility Guide

Release built on top of GitHub `main` at commit `26322b8` (re-fetched on 2026-11-02; `main` had not moved, so everything applies cleanly).
Branch with everything together: `final/integrated`. Nothing has been deployed, pushed or merged to your GitHub by me.

## 1. What is in this release (plain language)
| # | Feature | Where it lives |
|---|---------|----------------|
| 1 | Loyalty hardening: points no longer wiped by a bug, WhatsApp code (OTP) to redeem, points expiry (default 180 days), default earn 1 point per ₹50 | `bot/redeem.js`, `bot/index.js`, `Admin/js/features/loyalty.js`, `menu/js/customer.js` |
| 2 | One dedicated app per restaurant: first open = sign in with phone (+ optional name, no OTP), then the full menu | `menu/js/app.js`, `menu/index.html`, `menu/js/session.js` |
| 3 | Pricing: "Foodhubbie-App Orders" 3%, POS and QR menu 1%, WhatsApp ordering labelled "Upcoming Feature in 1 month" | `shared/cost-math.js`, billing labels |
| 4 | App tabs: Menu, Cart, Orders, Loyalty, Account; Orders / Payments history | `menu/js/customer.js` |
| 5 | Payment history kept in sync by the bot | `bot/payment-sync.js` |
| 6 | Complete in-app ordering (Delivery + Pickup), live tracking, rider + delivery code, cancel while "Placed"; Admin pickup flow; riders ignore pickup | `menu/js/app-checkout.js`, `bot/index.js`, `Admin/js/features/orders.js`, `rider-app/…/orderService.ts`, `database.rules.json` |
| 7 | Phone privacy without OTP: first phone to use a number owns it; link another phone with a code; Admin "Reset phone lock" | `menu/js/customer.js`, `database.rules.json`, `Admin/js/features/customers.js` |

## 2. Deploy order (this matters)
1. **Back up** current database rules (Firebase console → Realtime Database → Rules → copy) and note the current hosting version.
2. **Run the rules tests first** (never run by me, see report):
   `npx -y firebase-tools emulators:exec --only database --project demo-foodhubbie "node tests/rules.emulator.mjs"` (needs Java 21+). All cases must pass, including the `app:` and `privacy:` groups.
3. In Firebase console confirm **Authentication → Sign-in method → Anonymous is ON** (the app orders and the phone privacy both use it).
4. Deploy **database rules + customer app hosting together** (same sitting).
5. Restart the **WhatsApp bot** with the new code.
6. Deploy **Admin** and **SupremeAdmin** hosting.
7. Rebuild/publish the **rider app**.
8. Test with one real test order of each kind (see section 5).

## 3. What works with what (compatibility matrix)
| Combination | Result |
|---|---|
| New app + OLD rules | Menu, QR and sign-in work. **In-app checkout fails** ("Could not place your order") because old rules do not know app orders. Privacy shows no lock (safe fallback). → deploy rules first/together. |
| OLD app (cached) + NEW rules | QR/table ordering still works. The old app cannot read customer history/points (privacy lock) until it refreshes (service-worker cache is bumped to v31, refreshes on next open). |
| New app/rules + OLD bot | App orders are not finalized (no stock deduction/loyalty), no rider/OTP mirror, WhatsApp may be sent. → restart the bot. |
| New bot + old app | Fine: bot treats `webview_delivery` exactly as before; APP logic only triggers on `source:'APP'`. |
| WhatsApp ordering / `delivery.html` | **Unchanged.** `delivery.html` is deliberately kept for WhatsApp links. Only a tiny tag (`channel:'app'` for anonymous-token direct orders) was added. |
| QR / table / POS flows | Unchanged except POS/QR billing now 1% only for restaurants switched to percentage mode. |
| Existing restaurants' billing | **Unchanged** until you switch their mode in Supreme Admin. New restaurants default to percentage mode. |
| Existing data | No migration needed. All new fields/nodes are additive: `source:'APP'`, `orderMode`, `riderName/riderPhone/deliveryOtp` (customer copy), `customers/{phone}/devices`, `customers/{phone}/link`, loyalty `pointsSpent`. |

## 4. Rollback
- Rules: paste back the rules you backed up in step 1. Hosting: roll back to the previous version in Firebase Hosting. Bot: start the previous bot code.
- Data written by this release is harmless to the old code (extra fields are ignored).
- If you roll back rules but keep the new app, in-app checkout stops working (see matrix).

## 5. After-deploy smoke test (10 minutes)
1. Open the restaurant app in a private window → sign in with a test number → menu is first screen.
2. Add a dish → Place order → **Pickup** → order appears in Admin as "Pickup"; move it Confirmed → Ready → Served (asks payment method).
3. Repeat with **Delivery** (share location, enter address); assign a rider; check the customer's Orders tab shows rider + delivery code.
4. Cancel a new order while "Placed" → cancelled; try after Confirmed → refused.
5. Open the app with the same number on a second phone/browser → it must say the number is on another phone; make a code on the first (Account → Link another phone), enter it on the second → unlocks.
6. Admin → Customers → "Reset phone lock" for the test number.
7. Wallet/Costs: the APP order is billed 3%.
8. Loyalty: redeem a reward → WhatsApp code arrives → enter it. (Needs a live WhatsApp session.)

## 5b. Bot notes
- Restart the bot after deploying (step 5). On restart it will finalize any recent app/web order it missed while down.
- Until WhatsApp is working again: in-app loyalty **redemption** will fail (code is sent on WhatsApp); everything else in the app works without WhatsApp.
- Push links for app orders now open the app (`/?tab=orders`), not `delivery.html`.

## 6. Known limits — please read
- **Phone privacy is "first phone wins", not verification.** A stranger who opens the app with someone's number *before* the real owner can become the owner (and see old history for that number). Only a real verification step (WhatsApp/SMS code) fixes this; the code path is prepared (the bot can write `customers/{phone}/link` and send the code on WhatsApp) but WhatsApp work is pending.
- iPhone: Safari and the installed home-screen app are separate storage; the installed app may ask for a link code once. Clearing site data/reinstalling does the same.
- Item prices in orders are sent by the customer's phone and are not re-checked on the server (same as the existing QR and web flows).
- The delivery code is stored in the customer's own record (visible only to the registered phone after this release).
- Website pricing page and `PRICING_AND_TERMS.md` still show the old ₹1/₹2/₹5 rates.
- Bot `handleOrderStatusUpdate` still returns early on a dead WhatsApp socket for non-app orders (existing behaviour).
- WhatsApp bot ordering is marked "Upcoming" only as a label; its 2% rate in the billing maths is untouched.
