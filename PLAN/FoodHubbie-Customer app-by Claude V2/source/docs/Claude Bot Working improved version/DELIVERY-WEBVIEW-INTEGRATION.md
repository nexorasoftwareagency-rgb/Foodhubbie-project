# Delivery Webview — Integration Guide (Direct-Write Architecture)

> **Verified against commit `a26328a` (2026-08-05).** Both patches were
> test-applied with `git apply --check` against a brand-new, independent
> clone at this commit and applied cleanly with zero conflicts. Every
> function/export this integration depends on (`formatOrderInvoice`,
> `deductInventoryStock`, `notifyAdmin`, `saveUserProfile`,
> `discountEngine.recordDiscountUsage`, `validateCoupon`, `outletRef/get/
> push/set`, `Admin/js/features/settings.js`, `Admin/js/features/orders.js`,
> `menu/css/app.css`) was individually diffed against this commit and
> confirmed either unchanged or compatible. If you pull further changes
> before integrating, ask for another recheck — it's a fast, mechanical
> verification, not a rebuild.

## Architecture — one line
**The webview writes the order straight into Firebase, itself.** No draft, no chat
round-trip, no bot involvement at write time. Your bot's *existing* Firebase
listeners (already running, already fully tested by every order your chat
flow has ever placed) notice the new order and take it from there.

```
Customer taps "PLACE ORDER" in menu/delivery.html
        |
        v
menu/js/delivery-order.js -> writes ONE record to {outlet}/orders/{id}
        |                     (type:"Online", source:"webview_delivery", status:"Placed")
        v
bot/index.js's EXISTING orderRef.on("child_added", ...) listener fires
        |
        |- deducts stock (deductInventoryStock - reused, unmodified)
        |- saves customer profile + record (same code processOrderPlacement
        |   uses - reused, not duplicated)
        |- notifies your admin WhatsApp group (notifyAdmin - reused)
        `- sends customer: "ORDER PLACED!" + full itemized invoice
                |
                v
   You / your staff confirm the order in Admin -> status "Confirmed"
                |
                v
bot/index.js's EXISTING orderRef.on("child_changed", ...) listener fires
        |
        `- sends: Confirmed -> Ready -> Rider Assigned+OTP (Out for Delivery)
           -> Delivered - EVERY message, unchanged, exactly as it already
           does today for orders placed through WhatsApp chat.
```

Nothing about the status-update pipeline is new. The only genuinely new logic
is: (1) the webview UI, (2) the direct order-write function, and (3) about 60
lines in `bot/index.js` that run the "what `processOrderPlacement` normally
does" side-effects for orders it didn't personally place.

## Why this doesn't need a rewrite of Admin or rider-app
Both already read/write orders keyed purely by `type` and `status` —
`type: "Online"` orders already run the full
`Placed -> Confirmed -> Ready -> Arriving at Restaurant -> Picked Up -> Out
for Delivery -> Reached Drop Location -> Delivered` pipeline in
`Admin/js/features/orders.js`, with rider assignment and OTP already wired.
They have no idea (and don't need to know) whether an order came from a
WhatsApp conversation or a webview — the order record looks identical either
way.

## Files — what each one does

### `menu/js/geo.js` (new — verbatim copy)
An exact copy of `shared/geo/geo.js` (the same file `Admin/shared/geo/geo.js`
already is — this project already reuses this file client-side, so this
follows an established pattern, not a new one). Two functions:
- `calculateDistance(lat1, lon1, lat2, lon2)` — Haversine formula, returns km.
- `getFeeFromSlabs(distance, slabs)` — walks your `settings/Delivery.slabs`
  array (`[{km, fee}, ...]`) and returns the fee for the matching distance
  tier.

### `menu/js/delivery-order.js` (new)
One exported function: `placeDeliveryOrder({ cartLines, customerName,
customerPhone, address, location, note, discount })`.

Step by step:
1. **Validates** inputs (non-empty cart, name, 10-digit phone, address, and
   — critically — a `location` object with real `lat`/`lng`; throws if
   missing, which is what makes location a hard requirement, not optional).
2. **Reads** `settings/Delivery` and `settings/Store` from Firebase (both
   now publicly readable — see the rules patch) to get your delivery fee
   slabs and outlet coordinates.
3. **Computes delivery fee** via `calculateDistance` + `getFeeFromSlabs` —
   the identical calculation `bot/index.js`'s `handleCheckoutFinal()` already
   does for chat orders.
4. **Builds `items`** in the exact shape `bot/index.js`'s `user.cart` /
   `processOrderPlacement()` already use (`quantity`, `unitPrice`, `total`,
   `addons: [{name, price}]`) — this is what lets `formatOrderInvoice()` and
   every other bot function that reads `order.items` work without any
   changes.
5. **Computes subtotal/total**, applies the discount amount if a coupon was
   validated (see `discount.js` below).
6. **Writes the order**: `push()` to get a Firebase key, then one `set()`
   with `status: "Placed"` directly (your QR app's `order.js` does a two-step
   Pending→Placed write because it also has to attach the order to a table
   session; delivery has no session to attach to, so one write is enough and
   there's no window where the order exists half-formed).

### `menu/js/delivery.js` (rewritten)
Structured exactly like `menu/js/app.js`, section for section:
- **Boot** — restores any saved cart, requests location permission
  immediately (`requestLocationPermission()`), loads categories/dishes,
  shows the bottom nav.
- **Menu screen** — `renderMenuScreen()` / search — identical logic to
  `app.js`, calling the same `UI.renderCategoryPills` / `UI.renderDishList`.
- **Customize screen** — `openCustomize()` / `renderCustomizeScreen()` —
  copied verbatim from `app.js`; sizes, add-ons, quantity, special
  instructions all work exactly the same.
- **Cart screen** — `renderCartScreen()` calls `UI.updateCartTotals(...)`
  with `taxEnabled: false` (Online orders in this codebase never carry tax —
  confirmed from `processOrderPlacement`'s order schema, which has no tax
  fields — only Dine-in does, via `dineinSettings`).
- **Discount code** — `btnApplyDiscount` handler calls `validateCoupon()`
  from `menu/js/discount.js`, **completely unmodified**, the same function
  your dine-in app already uses. `M.appliedDiscount` is cleared automatically
  whenever the cart changes (`clearDiscountIfCartChanged()`), matching
  `app.js`'s behavior — a discount validated against one subtotal shouldn't
  silently carry over to a different one.
- **Location gating** — `requestLocationPermission()` fires on `boot()`.
  If granted: `M.location` is set, the banner hides, "PLACE ORDER" enables.
  If denied: a dismissible-but-persistent banner appears with a
  "Enable Location" retry button, and `updatePlaceOrderAvailability()` keeps
  the Place Order button disabled + relabeled "ENABLE LOCATION TO ORDER"
  until location is granted.
- **Promotions screen** — `renderPromotionsScreen()`, calls
  `UI.renderPromotionsLinks()`, identical to `app.js`.
- **Place Order** — validates the checkout form, calls
  `placeDeliveryOrder()`, clears the cart and shows a success toast on
  success. No chat handoff, no `wa.me` link, no draft.

### `menu/delivery.html` (rewritten)
Same screen structure and CSS classes as `menu/index.html`
(`screenMenu`, `screenCustomize`, `screenCart`, `screenPromotions`,
`bottomNav`) — same `<link rel="stylesheet" href="css/app.css">`, so it's
visually identical to your dine-in app. Differences:
- **Removed:** `screenTracking`, `screenHistory`, the "Guests" stepper, and
  everything table/session/waiter-request related (none of it exists in this
  file at all — not hidden, not stubbed, just not present).
- **Added:** `Address` field and `#locationBanner` (the permission-request
  UI) — Delivery Address lives inside the same `#checkoutFieldsWrap` block
  your cart screen already uses for Name/Phone.
- **Bottom nav:** Menu / Cart / Promos only.

### `bot/index.js` (2 small, targeted edits — patch attached)
1. **Removed** the earlier `ORDER:<code>` chat-handoff hook (abandoned
   approach — no longer applicable since the site writes the order
   directly).
2. **Inside `orderRef.on("child_added", ...)`**, before the existing
   `handleOrderStatusUpdate(...)` call: if `order.source ===
   "webview_delivery" && !order.stockDeducted`, run the finalization steps
   listed in the architecture diagram above — all calling **existing**
   functions (`deductInventoryStock`, `saveUserProfile`, `notifyAdmin`,
   `discountEngine.recordDiscountUsage`), none newly written.
3. **Inside `handleOrderStatusUpdate`'s `"placed"` branch**: when
   `order.source === "webview_delivery"`, the message now includes the full
   itemized invoice via `formatOrderInvoice(id, order)` — the same formatter
   already used one branch down for the `"confirmed"` status. Chat-originated
   orders are untouched — they still get the original generic message,
   since they already received a detailed receipt from
   `processOrderPlacement()` moments earlier.

### `database.rules.json` (2 small edits — patch attached)
1. **`{outlet}/orders/$orderId`** — extended the existing anonymous
   create-only clause (currently `source == 'QR'`) to also allow
   `source == 'webview_delivery' && type == 'Online' && status ==
   'Placed'` — same pattern, same trust model your QR app's direct writes
   already use.
2. **`{outlet}/settings/Delivery`** — now `.read: true` (was admin/rider-only),
   so the webview can read your delivery fee slabs. Confirmed this node only
   contains fee tiers and backup contact info — nothing sensitive — and it's
   nested correctly under `$outletId` (verified against the parsed rules
   tree, not just the text).
3. Removed the now-unused `cartDrafts` rule from the earlier (abandoned)
   handoff design.

## What you should verify before going live
1. **Firebase deploy the rules**: `firebase deploy --only database`.
2. **Restart** `pizza-bot` / `cake-bot` in PM2 after applying the
   `bot/index.js` patch.
3. **Outlet coordinates**: `delivery-order.js` falls back to hardcoded
   lat/lng if `settings/Store.lat`/`.lng` aren't set in Firebase — check
   those fields exist and are accurate for both outlets, or delivery fee
   will be computed from the wrong point.
4. **Where the link is shared** with customers is still open — same
   question as before, still unanswered: bot menu command, broadcast
   button, or something else?

## Known trade-offs (flagging, not blocking)
- **Client-computed pricing.** Like your existing QR dine-in flow, the
  delivery webview computes subtotal/fee/discount client-side and writes it
  directly — there's no server-side recomputation before the write. This
  matches your project's existing trust model (the QR app has worked this
  way in production already), but it's worth knowing: a customer editing
  requests in the browser devtools could theoretically alter their own
  total before it's written. If you'd like a belt-and-suspenders check
  later, the bot's new `child_added` hook is the natural place to add a
  server-side recompute-and-correct step — happy to add it if you want it.
- **No hard delivery radius cutoff** — matches existing behavior
  (`getFeeFromSlabs` charges the last slab's fee for any distance beyond
  your furthest tier, it doesn't reject the order).
