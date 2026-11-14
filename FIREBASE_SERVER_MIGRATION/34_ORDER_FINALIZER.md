# 34 - The real order finalizer + cancel compensations (batch 23f)

Batch 23c proved the Functions-side copy of `bot/order-finalizer.js` reaches the
same numbers as the WhatsApp bot on live orders (shadow compare). Batch 23f gives
that module authority: browser-written orders are now re-priced, re-discounted,
tendered and stock-deducted **in the cloud**, and a cancelled order gives every
one of those back - all while the EC2 box is down.

Status: deployed and live-verified **55/55** on the e2e tenant. The switch
`config/orderFinalizer/enabled` is **`true`** (Functions is the backend).

## 1. What was left behind, and why it matters

Two writes still lived in `bot/index.js` and therefore died with the box:

1. **Finalization.** `menu/js/delivery.js` and `menu/js/app-checkout.js` write
   orders straight from the customer's browser, so every money field on them is a
   claim. The bot's `child_added` hook re-priced the lines from the catalog,
   re-derived tax + delivery fee from the outlet's settings, re-ran the discount,
   burned a claimed reward code, deducted stock, mirrored the customer profile and
   recorded discount usage.
2. **Cancel compensations.** `child_changed` released the discount usage, put the
   stock back and returned a burned reward code when an order was cancelled or
   refunded.

With the box down, an order placed from the app was **never finalized**: the
customer's claimed ₹1 lines stood, GST and the delivery fee stayed whatever the
phone said, a burned reward code was never returned on cancel, and stock never
moved. This is the most consequential of all the migrations - it is the money.

## 2. Two triggers, one shared pipeline

`functions/src/triggers/orderFinalizer.ts`:

| Trigger | Event | Work |
|---|---|---|
| `onWebOrderPlaced` | `onValueCreated` on `businesses/{bid}/outlets/{oid}/orders/{orderId}` | re-price, re-tax, re-discount, reward tender, stock, profile mirror, discount usage |
| `onOrderCancelledCompensate` | `onValueWritten` on `.../orders/{orderId}/status` | reward resurrect, discount usage release, stock restore |

The pipeline is not a re-implementation: `scripts/copy-vendor.cjs` copies
`bot/order-finalizer.js`, `bot/discount-engine-core.js`, `bot/order-pricing.js`,
`bot/utils.js` and the pure `shared/*` math into `lib/vendor/` byte-for-byte on
every build, so the cloud runs the same bytes the bot runs.
`functions/src/shared/order-finalizer/factory.ts` only supplies the deps - and it
**pins the tenant from the event path** (`businesses/{bid}/outlets/{oid}/…`),
never from a reverse-index lookup: the e2e business has an outlet literally named
`pizza`, so a name-based resolution would read the live tenant.

The 23c shadow triggers were refactored onto the same factory, so a shadow verdict
and a real run are produced by one construction path.

## 3. The one switch

`config/orderFinalizer/enabled === true` means the **cloud** owns finalization;
when it is that value `bot/index.js` stands down:

- `isOrderFinalizerRelayEnabled()` (30 s in-process cache - it is read on every
  order event) gates the bot's `finalizeWebOrder` call **and** both cancel
  compensations, and labels the bot's own claim `owner: 'bot'`.
- Every other state - absent, `false`, unreadable - leaves the bot in charge and
  makes both triggers no-ops. Only an explicit `true` flips either side, so a
  failed flag read can never make both writers act.

A flip race is safe in both directions because the two writers share one claim
(§4), not because the flag is read atomically.

## 4. Idempotency: one shared claim + one durable marker

`bot/order-finalizer.js` gained an at-most-once lock used by **both** writers:

- `claimFinalization(orderId, outlet, owner)` is a **cold-tx-seeded** transaction
  on `orders/{orderId}/finalizeClaim` (RTDB hands the first transaction ticket
  `null` even for an existing node - proven live 2026-10-27). The winner writes
  `{at, by}` and proceeds; every other caller returns `skipped: 'claimed'`.
- `FINALIZE_CLAIM_TTL_MS = 5 min`: an abandoned claim expires (a 60 s function
  timeout never needs five minutes), so a crashed run cannot block an order for
  ever. A hard failure additionally **releases** the claim so a later event can
  retry.
- `stockDeducted === true` short-circuits **before any side effect** with
  `skipped: 'already-finalized'`. That marker is written by the module itself, so
  it is also the correct answer when the bot finalized and the cloud trigger
  heard about the order afterwards.

The cancel side needs no claim of its own: each inner operation already carries
one (`discountUsageReversed`, `stockRestored`, and `usedOnOrder === orderId` for
the reward resurrect).

## 5. Deliberate deviations from the bot

1. **The cancel trigger listens on the `status` leaf**, not the whole order node.
   A payment mirror, a KOT stamp or a rider field cannot even invoke it.
2. **The demo tenant is hard-skipped** in both triggers. `foodhubbie-demo` is a
   public sandbox whose 353 orders are rewritten by the 03:00 IST reseed; it must
   never be treated as a shop.
3. **Stale cancel events are ignored**: after the leaf event, the trigger re-reads
   the order and returns when `order.status` is no longer the value it was
   notified about.
4. **The WhatsApp "NEW ORDER" text stays in the bot** - it is socket-only. While
   the flag is on, `alertAdminFinalizedWebOrder` sends it keyed on
   `orders/{id}/_adminWaNotified` (a durable claim, same shape as `_fcmSent`)
   once `stockDeducted === true`, so the alert carries the **corrected** total,
   never the customer's claim. With the box down no alert is sent at all, which is
   the same behaviour as every other WhatsApp message.
5. **`resurrectRewardTender` was ported into the cloud trigger** (the bot's own
   version lives in `processLoyalty`, which is still batch 23g). Both are
   `usedOnOrder`-guarded transactions, so when the box returns and the bot also
   runs its compensation, the code is returned once.

## 6. What is deployed

```
functions[onWebOrderPlaced(us-central1)]            Successful update operation.
functions[onOrderCancelledCompensate(us-central1)]  Successful update operation.
Deploy complete!
```

`functions:list` = **23** v2 functions. Both are `us-central1`, 256 MiB, 60 s,
`nodejs22`, with `FIREBASE_DATABASE_URL` bound. No rules change was needed: every
write is Admin SDK, and the app already reads `loyaltyTender`, `totalDue`,
`discount`, `tax`, `deliveryFee` and `total` off its own order.

The live switch:

```json
config/orderFinalizer = {
  "enabled": true,
  "by": "batch-23f",
  "doc": "FIREBASE_SERVER_MIGRATION/34_ORDER_FINALIZER.md",
  "since": 1794684642817
}
```

## 7. Live verification - 55/55

`%TEMP%/opencode/e2e-23f-order-finalizer.cjs` on the e2e tenant (every order
created with `_fcmSent: true` so the 23e admin push returns at its claim and the
owner's real device is never paged; both customer phones have zero
pushSubscriptions on that outlet).

Fixtures: inventory `Margherita`/`Farmhouse` at 10 each, one flat ₹50 global
discount (`minSubtotal 500`, `globalLimit 5`), one active reward code worth 200
points.

**Flag absent (Phase 0)** - a tampered delivery order created with the flag
missing: no `finalizeClaim`, no `stockDeducted`, subtotal still the client's ₹3,
stock still 10/10, discount usage 0. The triggers are genuinely inert.

**Tampered delivery order, flag on (Phase 1)** - the client claimed ₹1 lines,
0 % GST, no delivery fee, ₹3 total, plus a reward code:

| Field | Client claim | Server (cloud) |
|---|---|---|
| subtotal | 3 | **697** (398 + 299 from the catalog) |
| discount | 0 | **50** (the shared engine) |
| tax | 0 | **32.35** (5 % on 647, from `dineinSettings`) |
| deliveryFee | 0 | **20** (1.11 km → the ₹20 slab) |
| total | 3 | **699.35** |
| loyaltyTender | - | **20000 paise** burned server-side |
| totalDue | - | **499.35** |
| stock | - | **{inv-marg: 2, inv-farm: 1}** (10→8, 10→9) |

Plus `finalizeClaim.by === 'cloud'`, `discountUsageRecorded === true`, one
`discountsUsage` row (`channel: 'webview'`, ₹50), customer counter 1, discount
stats 1 / ₹50, reward `status: 'used'` with `usedOnOrder` = this order, and no
`priceReview` (every line matched).

**At-most-once (Phase 2)** - (a) a real `finalizeWebOrder({owner:'bot'})` replay
of the finalized order returns `skipped: 'already-finalized'` and takes no stock
twice; (b) an order created with a **live claim already held by the bot**
(`finalizeClaim {at: now, by: 'bot'}`) is skipped entirely by the deployed
trigger: no `stockDeducted`, no money rewrite (subtotal still 3), no stock, and
the held claim is not overwritten.

**Honest APP pickup (Phase 3)** - ₹99 Garlic Bread, pickup, untouched where it
should be: subtotal 99, discount **0** (₹99 cannot reach `minSubtotal 500`),
fee 0, tax 4.95, total 103.95; the customer node is mirrored with
`orderCount: 1` and `promotionalConsent` **not** forced true (the app chooses its
own consent).

**Never-finalized sources (Phase 4)** - a QR dine-in `Placed` order and a
`webview_delivery` order in the **demo** tenant both end with no claim and no
`stockDeducted`, and the QR order moves no stock.

**Cancel compensates (Phase 5)** - writing `status: 'cancelled'`:
`stockRestored` and `discountUsageReversed` claimed, inventory back to **10/10**,
discount stats back to **0 / ₹0**, the reward code `active` again with
`usedOnOrder` cleared, the customer usage counter deleted, and exactly one
negative `discountsUsage` row (`voidReason: 'order-cancelled'`) so the history nets
to zero.

**Duplicate terminal event (Phase 6)** - writing `status: 'refunded'` afterwards
compensates nothing twice: stock stays 10/10, stats 0, reward still active, and
still exactly one negative audit row.

**Bonus:** the 23c shadow record for the cloud-finalized order reports
`diffs: []` - the shadow and the real run agree.

## 8. Honest limits

- **A hard failure inside the pipeline releases the claim**, so a later event can
  retry - but the side effects that already landed are the same partial set a bot
  retry would see today. The claim prevents concurrent duplicates, not a crash
  halfway through. Making every write individually resumable is a larger change
  and was not attempted.
- **A cancel that happens while no trigger can run is still not replayed.** The
  cancel path is `onValueWritten` only; RTDB triggers do not replay events missed
  while the function was failing. (The placed path does replay: `onValueCreated`
  fires once and retries on throw.) This is the same gap the bot had and is
  recorded in doc 24 §6.
- **The WhatsApp admin alert is not sent while the box is down** - it is
  socket-only by nature. FCM/Admin-dashboard notifications still work (23e).
- **Loyalty earn/clawback is still bot-side** (`processLoyalty`), so a delivered
  web order earns nothing until batch 23g ships. The reward *tender* and the
  reward *resurrect* are already cloud-side, which is what the money needs.
- **`orders/{id}/finalizeClaim` is a permanent field** on finalized orders. It is
  small (two scalars) and it is the audit trail of who finalized what
  (`by: 'cloud' | 'bot' | 'server'`).
- The demo skip means a demo-tenant order is never finalized even if a visitor
  places one - by design, it is a sandbox with seeded data.

## 9. Blast radius of leaving it on

- Every browser-written order in every tenant except `foodhubbie-demo` is now
  finalized by the cloud within seconds of creation. Money, stock, reward codes
  and discount limits are written by a function instead of the bot; the code path
  is the same module, so the numbers do not change.
- The bot no longer finalizes or compensates while the flag is `true`. If the box
  is ever restored, check `config/orderFinalizer/enabled` first: `true` = cloud
  keeps ownership and the bot only sends WhatsApp texts (order status, admin
  alert). Flip it to `false` (or delete the node) to hand everything back.
- If the flag were flipped off with these triggers still deployed, the triggers
  become no-ops and the bot resumes exactly as before - no data migration, no
  replay.

## 10. Files

| File | Role |
|---|---|
| `bot/order-finalizer.js` | shared pipeline + the new `finalizeClaim` lock, `owner` param, `skipped` result field |
| `bot/index.js` | `isOrderFinalizerRelayEnabled` (30 s cache), finalize/compensation stand-down, `alertAdminFinalizedWebOrder` (`_adminWaNotified`) |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderFinalizer.ts` | the two real triggers, flag, demo skip, reward/discount/stock compensation |
| `FIREBASE_SERVER_MIGRATION/functions/src/shared/order-finalizer/factory.ts` | tenant-pinned finalizer construction, shared with the shadow |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderFinalizerShadow.ts` | 23c shadow, refactored onto the factory |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports the two new triggers |
| `tests/order-finalizer.check.cjs` | **105** checks (claim TTL, claim-before-side-effects ordering, bot stand-down, admin alert claim) |
| `tests/functions-source.check.cjs` | **188** checks (23f section: flag, demo skip, both paths, sources, owner label, throw-on-hard-failure, compensation claims, the factory and the shadow reuse) |
