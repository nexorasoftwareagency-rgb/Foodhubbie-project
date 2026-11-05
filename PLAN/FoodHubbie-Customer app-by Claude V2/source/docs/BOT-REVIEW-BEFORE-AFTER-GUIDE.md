# Bot review — code changes, before / after, with effect

Plain-language guide. Each change shows **where** it goes, the **BEFORE** code, the **AFTER** code, what it **changes for customers/restaurants**, and **how to check it**.
Line numbers are for `bot/index.js` / `bot/promotions.js` / `menu/js/app.js` in branch `final/integrated` (they move if the file changes).
Easiest way to apply: use `patches/step-by-step/foodhubbie-bot-review.patch` (`git apply`). Use this guide when you want to review or insert by hand.

Files touched: `bot/index.js`, `bot/promotions.js`, `menu/js/app.js`, `tests/payment-sync.check.cjs`, `tests/direct-mode.check.mjs`.
Restart the bot after changing bot files. The `menu/js/app.js` change goes live with the next hosting deploy.

---
## Fix 1 — Cancelled orders lose reward codes
**What was wrong:** a customer pays part of an order with a reward code (the code is "burned" when the order is placed). If the order is cancelled before it earns points, the code was never given back, because the give-back only ran if a points record existed.
**Where:** `bot/index.js`, function `clawLoyaltyPoints` (starts ~line 1301). Three edits.

**1a. ADD a new helper just above the comment block of `clawLoyaltyPoints` (~line 1274-1296):**
```js
// R2 fairness: a burned reward code on this order goes back to active so a
// cancellation/void doesn't eat the customer's reward. The usedOnOrder guard
// means we only resurrect OUR burn - never a code spent again elsewhere.
// Idempotent, so it is safe to call from more than one place.
async function resurrectRewardTender(orderId, order, outlet) {
    try {
        const tender = order && order.loyaltyTender;
        const tenderPhone = order && order.phone ? String(order.phone).replace(/\D/g, '').slice(-10) : '';
        if (!tender || !tender.rewardKey || !/^[6-9]\d{9}$/.test(tenderPhone)) return;
        // Cold-tx seed (redeem.js pattern) - null-first attempt otherwise
        // aborts the resurrect silently.
        const resRef = db.ref(resolvePath(`customers/${tenderPhone}/rewards/${String(tender.rewardKey)}`, outlet));
        const resSeed = (await resRef.once('value').catch(() => null) || {}).val();
        await resRef.transaction((cur) => {
            const node = cur || resSeed;
            if (!node || node.usedOnOrder !== String(orderId)) return undefined;
            return { ...node, status: 'active', usedAt: null, usedOnOrder: null };
        }).catch(() => {});
    } catch (e) { console.error('[LOYALTY] resurrectRewardTender error:', e.message); }
}
```

**1b. In `clawLoyaltyPoints`, right after `const bid = resolveBusinessIdFor(outlet);` (~line 1310) ADD:**
```js
        // A cancelled order that never earned points (cancelled before delivery,
        // e.g. the customer cancelled in the app) must still give the reward back.
        if (isCancel) await resurrectRewardTender(orderId, order, outlet);
```

**1c. BEFORE (~line 1333, after `await accrualRef.remove();`) — the old inline block:**
```js
        // R2 fairness: a burned reward code on this order goes back to active
        // so a cancellation/void doesn't eat the customer's reward. ...
        const tender = order.loyaltyTender;
        const tenderPhone = order.phone ? String(order.phone).replace(/\D/g, '').slice(-10) : '';
        if (tender && tender.rewardKey && /^[6-9]\d{9}$/.test(tenderPhone)) {
            const resRef = db.ref(resolvePath(`customers/${tenderPhone}/rewards/${String(tender.rewardKey)}`, outlet));
            const resSeed = (await resRef.once('value').catch(() => null) || {}).val();
            await resRef.transaction((cur) => {
                const node = cur || resSeed;
                if (!node || node.usedOnOrder !== String(orderId)) return undefined;
                return { ...node, status: 'active', usedAt: null, usedOnOrder: null };
            }).catch(() => {});
        }
```
**AFTER (replace that whole block with one line):**
```js
        await resurrectRewardTender(orderId, order, outlet);
```
**Effect:** a customer who cancels in the app (or the restaurant cancels) before delivery now gets the reward code back as "active". Orders that did earn points behave as before (the line in 1c still runs for the void/refund path). Safe to run twice (it only restores a code that was burned by *this* order).
**Check:** `node tests/payment-sync.check.cjs` (source guard). Live: redeem a reward, place an app order using it, cancel while "Placed" → the reward shows active again in the app's Loyalty tab.

---
## Fix 2 — Notifications open the wrong page
**What was wrong:** the tap-link in a push notification always pointed to `delivery.html` (the WhatsApp page), even for app customers.
**Where:** `bot/index.js`, function `notifyCustomerApp` (~line 1423) and `menu/js/app.js`, function `bootDirect` (~line 291).

**2a. BEFORE (`bot/index.js`):**
```js
        const url = `${WEBVIEW_DELIVERY_HOST}/${outlet}/delivery.html?b=${bid}&o=${outlet}&order=${encodeURIComponent(order.orderId || orderId)}&tab=notifications`;
```
**AFTER:**
```js
        // Restaurant-app customers land back in the app's Orders tab; delivery.html is
        // only for WhatsApp-bot links.
        const url = order.source === 'APP'
            ? `${WEBVIEW_DELIVERY_HOST}/?b=${bid}&o=${outlet}&tab=orders`
            : `${WEBVIEW_DELIVERY_HOST}/${outlet}/delivery.html?b=${bid}&o=${outlet}&order=${encodeURIComponent(order.orderId || orderId)}&tab=notifications`;
```

**2b. BEFORE (`menu/js/app.js`, inside `if (isSignedIn()) { ... }`):**
```js
        UI.showScreen('screenMenu');
    } else {
```
**AFTER:**
```js
        UI.showScreen('screenMenu');
        // Notification tap: bot links to /?tab=orders
        if (new URLSearchParams(window.location.search).get('tab') === 'orders') {
            UI.showScreen('screenOrders');
            renderOrdersTab();
        }
    } else {
```
**Effect:** tapping "Out for delivery" etc. opens the restaurant's app straight on the Orders tab (live tracking, rider, delivery code). WhatsApp-bot customers are unchanged. If the customer isn't signed in on that phone, they get the normal sign-in screen.
**Check:** `node tests/direct-mode.check.mjs` (scenario "notification tap (?tab=orders) opens the Orders tab"). Live: place an app order, let the restaurant confirm it, tap the push.

---
## Fix 3 — Offers switch ignored
**What was wrong:** (a) when an order was finalized the bot set `promotionalConsent: true` for every customer; (b) promotions only looked at that field and never at the app's "Offers" switch. So a customer who turned Offers off could still receive promotions.
**Where:** `bot/index.js` (~line 2557) and `bot/promotions.js`, function `hasPromoConsent` (~line 165).

**3a. BEFORE (`bot/index.js`, customer record update when an order is finalized):**
```js
                                promotionalConsent: true,
```
**AFTER:**
```js
                                // App customers choose Offers on/off themselves (customers/{phone}/app.consent);
                                // never force it on for them. Web/WhatsApp keeps its existing behaviour.
                                promotionalConsent: order.source === 'APP' ? (base.app?.consent?.offers === true || base.promotionalConsent === true) : true,
```

**3b. BEFORE (`bot/promotions.js`):**
```js
        const snap = await db.ref(resolvePath(`customers/${cleanPhone}/promotionalConsent`, OUTLET)).once('value');
        return snap.val() === true;
```
**AFTER:**
```js
        const [snap, appSnap] = await Promise.all([
            db.ref(resolvePath(`customers/${cleanPhone}/promotionalConsent`, OUTLET)).once('value'),
            db.ref(resolvePath(`customers/${cleanPhone}/app/consent/offers`, OUTLET)).once('value'),
        ]);
        // The customer's own "Offers" switch in the restaurant app wins both ways:
        // switched off = never message (even if an order once flagged consent);
        // switched on = allowed.
        if (appSnap.val() === false) return false;
        return snap.val() === true || appSnap.val() === true;
```
**Effect:** Offers OFF in the app = no promotional WhatsApp, immediately, even for people who ordered before. Offers ON in the app = allowed. Customers who never used the app are unchanged (old rule). Cost: one extra small database read per recipient when a campaign runs.
**Check:** `node tests/payment-sync.check.cjs` (source guards). Live: turn Offers off in the app, run a test campaign to that number → logged as "no-consent" skip.

---
## Fix 4 — Orders missed while the bot was down
**What was wrong:** the bot only finalized (re-check discount, deduct stock, save customer, notify the restaurant) orders it saw "arrive" within ~10 seconds of its own start-up time. An app/web order placed while the bot was off or restarting was never finalized, so the customer's own discount stayed unchecked and stock was never deducted.
**Where:** `bot/index.js`, the order `child_added` listener (~line 2440).

**BEFORE:**
```js
        const isNewOrder = orderTime > startupTime - timeBuffer;
```
**AFTER:**
```js
        // Catch-up: a web/app order placed while the bot was down or restarting still
        // needs server-side finalization (discount re-check, stock, profile). Only
        // recent, still-'Placed' orders that were never finalized qualify.
        const missedWebOrder = isWebOrderSource(order) && !order.stockDeducted &&
            String(order.status || '').toLowerCase() === 'placed' &&
            orderTime > Date.now() - 24 * 3600 * 1000;
        const isNewOrder = orderTime > startupTime - timeBuffer || missedWebOrder;
```
**Effect:** after a restart the bot finalizes app/web orders from the last 24 hours that are still "Placed" and were never finalized. Guarded by `stockDeducted`, so nothing is finalized twice. Side effect to know: a delivery-webview customer whose order was missed may receive their "Order placed" WhatsApp message late (app customers get no WhatsApp). Orders older than 24 hours or already confirmed are left alone.
**Check:** `node tests/payment-sync.check.cjs` (source guard). Live: stop the bot, place an app order, start the bot → within seconds the order gets `stockDeducted: true` and the restaurant is notified.

---
## Tests added with these changes
- `tests/payment-sync.check.cjs`: 6 source guards (reward helper, cancel hook, app push link, catch-up, consent rules, promotions).
- `tests/direct-mode.check.mjs`: scenario "notification tap (?tab=orders) opens the Orders tab".
Run: `node tests/payment-sync.check.cjs` and `node tests/direct-mode.check.mjs` (the second needs Playwright).
Not run live: real WhatsApp, real Firebase, real push — see the verification report.

## Cosmetic
The new helper was first placed inside an existing comment block; it now sits above the whole block (`bot: keep the clawback comment block together`). No behaviour change.

---
# Open items (your decision) — not changed
* **Loyalty redemption needs WhatsApp.** The redemption code goes out on WhatsApp, and app customers are deliberately not messaged there. Until WhatsApp is working, in-app redemption will fail. One option is to approve it from the customer's registered phone (the phone-lock check) instead of a WhatsApp code; that needs a small rules and bot change.
* **Stock isn't returned on cancel.** This was already true for every cancel, but it matters more now that customers can cancel themselves. Reward codes and points are returned.
* **Item prices come from the customer's phone.** Only the discount, tax and total are re-checked on the server.
* **Cancelled orders' discount usage.** I didn't check whether discount-usage counters are reversed on cancel.
