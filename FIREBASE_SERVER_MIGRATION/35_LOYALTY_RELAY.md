# 35 - Loyalty earn, clawback, dine-in settlement and app redemption moved to Functions (batch 23g)

Batch 23f gave the cloud the order *money*. Loyalty was the other half of it: a
delivered app order earned **no points** while the box was down, a cancelled one
**kept** them, a settled dine-in bill never credited the guest, and a reward
redeemed in the app sat in `bot/redeemQueue` for ever. All four paths are pure
Admin SDK - there is not one socket call in them - so they belong in Functions.

Status: deployed and live-verified **41/41** on the e2e tenant, plus **12/12** for
the tier-up push that fires from a cloud accrual. The switch
`config/loyaltyRelay/enabled` is **`true`**.

## 1. What moved

| Was (inside `bot/index.js`) | Now |
|---|---|
| `accrueLoyaltyPoints`, `_writeLoyaltyAccrual`, `loyaltyEarnBase`, `loyaltyTierFor` | `bot/loyalty-engine.js` (`processLoyalty` on `Delivered`/`Served`) |
| `clawLoyaltyPoints` | `bot/loyalty-engine.js` (cancel / refund / bill void) |
| `dineInPhoneFor`, `dineInEarnBaseRs`, `accrueDineInPaidOrder` | `bot/loyalty-engine.js` (`paymentStatus: 'Paid'`) |
| `resurrectRewardTender` | `bot/loyalty-engine.js` (cancel before the accrual lookup) |
| `getLoyaltyConfig` | `bot/loyalty-engine.js` (also consumed by the order finalizer) |
| `initRedeemListener` body | `bot/redeem.js` `redeemRewardRequest` (claim-guarded, exported) |

The extraction follows the 23b/23f pattern exactly: **one module, two runners.**
`bot/loyalty-engine.js` is a socket-free factory (`createLoyaltyEngine({db,
resolvePath, loyaltyMath, moneyMath, redeem, isDineInOrder, formatOrderId,
businessIdFor, defaultOutlet, onTierUp})`) that refuses to build without its deps
and references no Baileys, no `bot/firebase`, no pm2 and no redis. `bot/index.js`
constructs one instance and keeps thin delegates (`processLoyalty`,
`dineInPhoneFor`) so every existing call site is unchanged; `scripts/copy-vendor.cjs`
copies the same bytes into `lib/vendor/` on every build, so the cloud runs the
bytes the bot runs (now **12 modules, 169.5 KB**).

`functions/src/shared/loyalty/factory.ts` supplies the deps and, like the order
finalizer factory, **pins the tenant from the event path** - never a
reverse-index lookup, because the e2e business has an outlet literally named
`pizza`. It deliberately passes **no** `onTierUp`: the tier-up push is a trigger
of its own (§4).

## 2. Three triggers

`functions/src/triggers/loyaltyRelay.ts`:

| Trigger | Event | Work |
|---|---|---|
| `onOrderLoyaltyStatus` | `onValueWritten` on `.../orders/{orderId}/status` | accrue on `delivered`/`served`, claw back on `cancelled`/`canceled`/`refunded` |
| `onOrderLoyaltyPayment` | `onValueWritten` on `.../orders/{orderId}/paymentStatus` | dine-in only: credit on `paid`, `bill-void` clawback on `unpaid` |
| `onRedeemRequest` | `onValueCreated` on `.../bot/redeemQueue/{reqId}` | validate the device, deduct `pointsSpent`, mint a `LOYAL######` code |

All three: `us-central1`, 256 MiB, 60 s, `nodejs22`,
`FIREBASE_DATABASE_URL` bound, and all three hard-skip the demo tenant
(`foodhubbie-demo`).

Leaf listeners are not cosmetic. On the whole-order node every write - a stock
stamp, `_fcmSent`, `finalizeClaim`, a rider field - would invoke the engine; on
the leaf only a real status/payment change does. Each leaf also short-circuits on
its actionable set (`delivered|served|cancelled|refunded|canceled`,
`paid|unpaid`), so a normal order costs about two invocations.

## 3. The one switch

`config/loyaltyRelay/enabled === true` means the **cloud** owns loyalty. Only that
exact value does anything:

- `isLoyaltyRelayEnabled()` in `bot/index.js` (30 s in-process cache - it is read
  on every order event) gates `processLoyalty` **and** `redeem.initRedeemListener`.
  Its catch branch sets `on: false`, so an unreadable flag leaves the bot in charge.
- The triggers' `relayEnabled()` returns `snap.val() === true` and `false` on a
  read error. Absent, `false`, unreadable → every trigger is a no-op.

A flip race is safe because both writers share the engine's own idempotency, not
because the flag is read atomically: `loyalty/accruals/{orderId}` + the
`lastAccruedOrderId` transaction (earn), the deleted accrual record +
`lastClawedOrderId` (clawback), and `bot/redeemClaims/{key}` (redemption).

## 4. The tier-up push now actually fires

Batch 23e shipped `onLoyaltyTierUp` with an honest limit: *"deployed but dormant -
nothing advances a tier while `processLoyalty` is bot-side."* Batch 23g removes
that boundary, so the chain is live end to end:

```
order status write -> onOrderLoyaltyStatus -> accrual -> tier silver
-> onLoyaltyTierUp -> pushInbox row + notifyCaps loyalty slot + FCM
```

Dedupe is unchanged and deterministic: the inbox key is
`tier_{tier}_{tierReachedAt}`, so a replay of the same loyalty write pushes
nothing a second time. The relay never sends FCM itself (`tests/loyalty-engine.check.cjs`
pins the absence of `messaging` in the file) - one sender, one cap.

## 5. At-most-once redemption

`redeemRewardRequest({db, resolvePath, OUTLET, key, req, owner})` is the only
writer. It takes a **cold-tx-seeded** claim on
`bot/redeemClaims/{key}` (`CLAIM_TTL_MS = 5 min`), so the bot and the cloud can
never spend one request twice; the loser returns `{ok:false, skipped:'claimed'}`.
Cost comes from `loyalty/config`, never from the client; `pointsSpent` is deducted
in a transaction, `lifetimePoints` is untouched (spending never demotes), and a
rejection writes a `rejected` reward node as its audit trail - exactly what the bot
did.

## 6. What is deployed

```
functions[onOrderLoyaltyStatus(us-central1)]   Successful create operation.
functions[onOrderLoyaltyPayment(us-central1)]  Successful create operation.
functions[onRedeemRequest(us-central1)]        Successful create operation.
Deploy complete!
```

`functions:list` = **26** v2 functions. No rules change: every write is Admin SDK
and the app already reads `customers/{phone}/loyalty` and
`customers/{phone}/rewards` through its device binding.

The live switches:

```json
config/loyaltyRelay   = { "enabled": true, "by": "batch-23g" }
config/orderFinalizer = { "enabled": true, "by": "batch-23f", … }
config/pushRelay      = { "enabled": true, "by": "batch-23e", … }
```

## 7. Live verification - 41/41

`%TEMP%/opencode/e2e-23g-loyalty-relay.cjs` on the e2e tenant. Every order is
created with `_fcmSent: true` **and** a non-web `source`, so the 23e push triggers
return at their claim and the 23f finalizer never touches these orders: nothing is
billed, no stock moves, no real device is paged.

**A. Flag off** - a `Delivered` write leaves no loyalty node and no accrual. The
deploy alone changes nothing.

**B. Flag on** - re-writing the *same* order to `delivered` earns 15 pts
(₹300 / ₹20). The only difference is the flag, which proves the trigger ran rather
than something else having produced the write.

**C. Delivery earn** - subtotal 500, discount 50: `earnBase` **450** (tax and
delivery fee never earn), **22 pts**, customer node `points`/`lifetimePoints` 22,
`orderCount` 1, `business` stamped, leaderboard mirror written, customer order
history row written. A replayed `Delivered` write earns nothing twice.

**D. Clawback** - `Cancelled` writes a clawback row with `reason: 'cancelled'`,
deletes the accrual lock, reverses the balance to 0 and the order counter to 0. The
same order re-delivered earns 22 again (the lock is genuinely released), then
`Refunded` claws back with `reason: 'refunded'`.

**E. Dine-in** - an unpaid `Served` order earns nothing. Flipping
`paymentStatus: 'Paid'` credits **20 pts** to the phone resolved from
`tableSessionsContact` (the order itself carries no phone - by design).
`Unpaid` claws back with `reason: 'bill-void'`.

**F. Redemption** - a queued request mints an `active` reward with a `LOYAL######`
code, `cost` **200** from `loyalty/config` (never the client), `pointsSpent` 200,
`lifetimePoints` untouched at 250, the queue entry consumed and
`bot/redeemClaims/{key}.by === 'cloud'`. Re-writing the same queue key cannot spend
twice. An unlinked device is rejected with `reason: 'device not linked'` and spends
nothing.

**G. Flag off again** - a `Delivered` write earns nothing and a `Cancelled` write
claws nothing. The switch is what stops the cloud.

**H. Demo tenant** - a `Delivered` order in `foodhubbie-demo` writes no loyalty
node and no accrual.

Cleanup: `cleanup: no residue` - `loyalty/accruals` null, `loyalty/rankings` back to
its one pre-existing row, `loyalty/clawbacks` back to the three pre-existing
`…-271026-*` rows, `bot/redeemQueue` and `bot/redeemClaims` null, and the demo
customer node gone. The flag is left `{enabled:true, by:'batch-23g'}`.

## 8. Tier-up tie-in - 12/12

`%TEMP%/opencode/e2e-23g-tierup.cjs`. A bronze customer at 990 lifetime points
with one **synthetic** token, delivery order ₹400:

- the cloud accrual promotes them to **silver** at 1010 (`points` follows),
- `pushInbox/{phone}/tier_silver_<stamp>` is written with title `Silver`,
  `type: 'loyalty'` (its own cap, not an order update) and the
  `/delivery.html?….tab=account` URL a WhatsApp-only customer expects,
- the key is `^tier_silver_\d+$` (deterministic per tier event),
- exactly **one** `notifyCaps/{phone}/loyalty/{IST day}` slot is consumed,
- the synthetic token is **not** pruned (`messaging/invalid-argument` is not a
  permanent dead-token code - pruning it would wipe healthy lists),
- replaying the status pushes nothing and leaves the cap at 1.

## 9. The lesson this batch paid for

The guard's in-memory RTDB fake was too kind. It ran one `fn(null)` and one
`fn(real)` and committed whatever the second returned, so the
"bot and cloud copy of one request can only spend once" case passed at **0 winners**
- both writers saw a cold `null` and both wrote, and the fake called the second a
success. The real Admin SDK hands the first attempt `null`, compares, and on a
mismatch **re-runs the callback with the server value before committing**. That
retry is the whole reason a cold-tx `cur || seed` claim works. The fake now models
both attempts (and the CAS-mismatch retry), which is what makes the race test
meaningful.

Two smaller findings from the same run: the test's own point budget was too small
for a 200-point reward plus the race case (a harness bug, not a product bug), and
the `_loyaltyRelayCache` source pin had to match the real assignment
(`_loyaltyRelayCache = {at, on: snap.val() === true}`), not an imaginary
`_cache.on = …` line.

## 10. Honest limits

- **RTDB triggers do not replay events missed while a function was cold,
  deploying or failing.** An order that reached `Delivered` during a cold deploy
  needs its status re-written to earn. The bot had the identical gap; this is
  recorded in doc 24 §6 and is the reason the onboarding watcher was built as a
  poll, not a trigger.
- **A rejected redemption leaves a `rejected` reward node** as its audit trail -
  intentional, and identical to the bot's behaviour, but it means a customer who
  taps redeem without the points will accumulate rejected rows.
- **`bot/redeemClaims/{key}` is a permanent node per redemption** (two scalars,
  5 min TTL enforced by the reader, not by RTDB).
- **Loyalty is still per-outlet config.** A customer who orders at two outlets of
  one business has two independent balances - that is the existing shape
  (`loyalty/config` lives under the outlet) and was not changed here.
- **The WhatsApp bot still holds its own copy of the engine** and will run it the
  moment the flag is flipped off. If the box is ever restored, check
  `config/loyaltyRelay/enabled` first: `true` = the cloud keeps ownership and the
  bot only sends WhatsApp texts.

## 11. Blast radius of leaving it on

- Every non-demo tenant now earns, claws back, settles dine-in bills and redeems
  rewards **in the cloud**, within seconds and with the box down. The code path is
  the same module the bot used, so no number changes.
- `onLoyaltyTierUp` starts firing for real - customers crossing a tier now get the
  inbox row and push they were promised in batch 23e.
- If the flag is flipped to `false` (or the node deleted), all three triggers
  become no-ops and the bot resumes exactly as before: no data migration, no
  replay, no reconciliation.

## 12. Files

| File | Role |
|---|---|
| `bot/loyalty-engine.js` | **new** - socket-free `createLoyaltyEngine`: config, accrual, clawback, dine-in settlement, bill-discount split, reward resurrect, `isDineIn` |
| `bot/index.js` | engine wiring + `isLoyaltyRelayEnabled` (30 s cache), thin `processLoyalty`/`dineInPhoneFor` delegates, the `[finalizerRelay, loyaltyRelay]` gate, gated `initRedeemListener`; `releaseOrderDiscountUsage` and `alertAdminFinalizedWebOrder` kept intact (23f) |
| `bot/redeem.js` | `redeemRewardRequest` + `CLAIM_TTL_MS` + `bot/redeemClaims/{key}`; `initRedeemListener` is a thin wrapper |
| `functions/src/triggers/loyaltyRelay.ts` | **new** - the three triggers, flag, demo skip, actionable sets |
| `functions/src/shared/loyalty/factory.ts` | **new** - tenant-pinned engine construction (no `onTierUp`) |
| `functions/src/index.ts` | exports the three triggers |
| `functions/scripts/copy-vendor.cjs` | vendors `bot/loyalty-engine.js` and `bot/redeem.js` (12 modules) |
| `tests/loyalty-engine.check.cjs` | **new** - 44 checks: engine behaviour against a CAS-accurate fake RTDB, the redemption claim race, and the source pins for both sides |
| `tests/order-finalizer.check.cjs` | 105 checks (unchanged; it caught that the 23g splice had eaten `alertAdminFinalizedWebOrder`) |
| `FIREBASE_SERVER_MIGRATION/24_WHATSAPP_OFF_EC2_DEPENDENCY.md` | §6 inventory updated |
