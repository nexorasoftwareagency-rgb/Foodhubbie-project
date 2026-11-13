# 27 — Web/app order finalizer in Cloud Functions, SHADOW mode (batch 23c)

Status: **live and running** on `foodhubbie-10`, `us-central1`, as two 2nd-gen RTDB
triggers. It never writes to an order, a stock count, a reward code or a billing
row — only to `migrationShadow/orderFinalizer/...`. Authority stays with the
WhatsApp bot until this shadow data proves the module on real traffic.

## 1. Why this batch exists

Batch 23b extracted the browser-order finalizer out of `bot/index.js` into
`bot/order-finalizer.js` (`26_ORDER_FINALIZER_EXTRACTION.md`) precisely so a
Cloud Functions trigger could run it. Batch 23c is that trigger — but in
**shadow mode**: the bot still finalizes every order, and the function
independently computes what the bot *should* do, records it, and later compares
it with what the bot *did*.

Flipping straight to an authoritative trigger would have been a one-way bet on a
module that has never executed inside a Function, against live customer money,
with the box down and no way to roll back a wrong tender or stock count.

## 2. Why two stages (the design that actually proves something)

A single trigger on "order finalized" would read the order **after** the bot has
already rewritten its prices, tax, fee and stock — compare the module against
corrected values and always report a match. It would prove nothing.

So the claim is captured **before** the bot touches it:

| stage | trigger | when | what is stored |
|---|---|---|---|
| 1 | `onWebOrderPlacedShadow` (`onValueCreated`) | order created by the browser | the dry-run verdict computed from the client's claim |
| 2 | `onWebOrderFinalizedShadow` (`onValueWritten`) | `…/orders/{orderId}/stockDeducted` flips to `true` | `{matched, diffs, actual}` against the order the bot produced |

Both write one row at `migrationShadow/orderFinalizer/{bid}/{oid}/{orderId}`:

```
{
  bid, oid, orderId,
  source, channel, orderType,
  claimed: { subtotal, discount, deliveryFee, tax, total, itemCount },
  stage: 'placed' | 'finalized' | 'skipped' | 'error',
  at, finalizedAt,
  verdict: {  // stage 1, the dry run
    ok, dryRun, priceChanged, subtotal, discount, discountId,
    deliveryFee, tax, taxItems, taxName, total,
    inventoryDeducted, tender, discountUsageRecorded
  },
  matched, diffs, actual, reason, error
}
```

`diffs` entries carry `{field, shadow, actual}` so a mismatch is auditable
without reading both trees.

### Races are recorded, never guessed

* `status !== 'Placed'` at creation (a pre-bot cancellation) → `stage:'skipped'`,
  `reason:'status:<status>'`. There is no verdict to compare later.
* `stockDeducted === true` already (the bot won the race) → `stage:'skipped'`,
  `reason:'already-finalized'`. A dry run at that point would read a used reward
  code and bumped discount counters and could report a **false** mismatch, so the
  row records the skip instead of inventing proof.
* No stage-1 row / no verdict at finalize → `stage:'finalized'` with
  `matched:null` and `reason:'no-shadow-row' | 'no-shadow-verdict'`. Never a pass.

## 3. How the function runs the bot's module (no re-implementation)

`functions/scripts/copy-vendor.cjs` copies the modules **byte for byte** from the
repo into gitignored `lib/vendor/` as a pre-`tsc` build step
(`functions/package.json`: `"build": "node scripts/copy-vendor.cjs && tsc"`), and
the trigger `require()`s them at runtime:

```
lib/vendor/bot/order-finalizer.js
lib/vendor/bot/utils.js
lib/vendor/bot/order-pricing.js
lib/vendor/bot/discount-engine-core.js
lib/vendor/shared/{money-math,loyalty-math,discount-rules}.js
lib/vendor/shared/geo/geo.js
```

**The ESM marker is load-bearing.** `functions/package.json` is CommonJS, so
`shared/*.js` (`export function …`) would parse as CJS and every guarded require
inside the finalizer would silently fall back to its frozen legacy math — the
shadow would then compare the wrong numbers and still "pass". The build writes
`lib/vendor/shared/package.json {"type":"module"}` and
`lib/vendor/bot/package.json {"type":"commonjs"}` so `require(esm)` resolves the
real shared math on the nodejs22 runtime.

`copy-vendor.cjs --check` also compares sha256 of every vendored file against the
repo, and **`verifyLoad()`** proves the tree actually loads: it builds the
finalizer, asserts the shared `discountAmount` is in use, forces the tax path
through `verifiedOrderTotals` (1000 − 100 at 5 % + ₹50 service charge must be
995/45 — the legacy fallback produces a different number) and round-trips
`compareFinalization` on an identical record. A build that copies bytes but
breaks the module type fails instead of deploying.

### Tenancy

`resolvePath` is pinned by the **event path** (`bid`/`oid` from
`businesses/{bid}/outlets/{oid}/orders/{orderId}`), never by the bot's
outlet→business reverse index — the e2e business has an outlet literally named
`pizza`, and an index scan would land on the live tenant.

The bot's own `getData` 30 s cache is deliberately *not* used: a Function
instance serves whichever outlet invoked it, and a cross-tenant cache is a money
bug waiting to happen. Every read goes to RTDB.

## 4. What is deployed

```
onWebOrderPlacedShadow     us-central1   256MiB   60s   secrets:[FIREBASE_DATABASE_URL]
  ref: businesses/{bid}/outlets/{oid}/orders/{orderId}                 (onValueCreated)
onWebOrderFinalizedShadow  us-central1   256MiB   60s   secrets:[FIREBASE_DATABASE_URL]
  ref: businesses/{bid}/outlets/{oid}/orders/{orderId}/stockDeducted    (onValueWritten)
```

Deploy (single functions, so no other function is re-uploaded):

```
firebase deploy --only functions:onWebOrderPlacedShadow,functions:onWebOrderFinalizedShadow
```

Both answered **Successful create operation**. `firebase functions:list` confirms
**14** v2 functions (12 before this batch), both new rows showing the right event
type — `…ref.v1.created` for the placed stage, `…ref.v1.written` for the finalize
stage — `us-central1`, 256 MB, nodejs22. The deploy log's
`Can't determine Firebase Database URL` lines are
preflight noise — the URL is bound at runtime through the `secrets` list (same as
`platformHealth`, batch 23a).

Cost: at most 2 invocations per browser order, each a handful of small RTDB reads
(dishes, combos, settings, discount, loyalty). No `businesses` tree read, no
order-history scan.

**Kill switch**: `migrationFlags/orderFinalizerShadow/enabled = false` stops both
triggers (missing or any other value = enabled). It is read once per container per
60 s, and a read failure keeps the observer **enabled** — it cannot change
anything, so a blind spot is worse than a duplicate observation.

**Rules**: `migrationShadow` and `migrationFlags` have no entry in
`database.rules.json` — default deny for every client, and the Admin SDK bypasses
rules. Nothing was deployed to the database for this batch. A future dashboard
will need an explicit `isSuper || isSupreme` read rule; today the data is only
reachable from a privileged SDK context.

## 5. Live verification

Fixture tenant `businesses/e2e-biz-1792987605261/outlets/e2e-outlet-1792987605261`
(Margherita ₹199, Farmhouse ₹299, GST 5 %, slabs 3 km → ₹20).

`%TEMP%/opencode/e2e-23c-shadow.cjs` — **12/12, exit 0**, all fixtures restored
(order absent, shadow row absent, inventory node byte-identical — it was absent
before the run).

| # | scenario | result |
|---|---|---|
| 1 | create an `APP` delivery order claiming Margherita at **₹1** (×2) + Farmhouse ₹299, subtotal ₹301, total ₹336.05 | deployed trigger writes `stage:'placed'`, `verdict.dryRun:true`, `priceChanged:true` |
| 1 | verdict figures | subtotal **₹697**, GST **₹34.85**, fee **₹20**, total **₹751.85** |
| 1 | stock | `inventoryDeducted {i-marg:2, i-farm:1}` computed, **stock untouched 10/10** |
| 1 | the order node | byte-identical to the client's claim after the dry run |
| 2 | the bot finalizes (the real module + real Firebase wiring, run locally because the box is down) | `ok:true`, total ₹751.85, stock really moved 10/10 → **8/9** |
| 3 | finalize trigger on the `stockDeducted` flip | `matched:true`, `actual` subtotal ₹697 / tax ₹34.85 / total ₹751.85 |
| 4 | tamper the final total to ₹1 and re-flip the flag | `matched:false`, `diffs:['total']`, shadow ₹751.85 vs actual ₹1 |

Two notes from building this:

* **RTDB drops empty arrays.** A match writes `diffs: []`, which comes back as
  `undefined`. The first E2E run failed on `assert.deepEqual(row.diffs, [])`
  (11/12) — the trigger was correct, the assertion was wrong. Assert
  `!diffs || diffs.length === 0`, never strict `[]`.
* The stage-2 trigger has to observe a fresh write, so the tamper test sets
  `stockDeducted:false`, waits for that to land, then writes
  `{stockDeducted:true, total:1}`. Writing the same value twice is not a change
  event.

### Guards

* `tests/order-finalizer.check.cjs` — **93/93**. Adds: the `dryRun` signature,
  every write site guarded by `shadow` (priceReview, re-priced items,
  verified-total write-back, discount correction, stock flag, WhatsApp alert,
  profile mirror, discount-usage record), `deductInventoryStock`/`verifyRewardTender`
  honouring `{dryRun}`, `compareFinalization` purity and its per-field diffs,
  the engine-core split (`discount-engine-core.js` has no `./firebase` import,
  cache keyed by the **resolved** path, the bot shim stays a shim).
* `tests/functions-source.check.cjs` — **40/40**. Adds: `index.ts` exports both
  triggers, the build runs `copy-vendor.cjs`, the vendor list, the ESM marker,
  `verifyLoad`, `onValueCreated` / `stockDeducted` refs, `dryRun: true` and no
  `dryRun: false`, the kill-switch path, `WEB_SOURCES`, the secret binding and
  that the trigger loads the vendored copy rather than a re-implementation.
* `tests/payment-sync.check.cjs` OK (guard moved to the module + engine core),
  `bot/tests/unit.test.js` **28/28**, `tests/session-lifecycle.check.cjs` **16/16**,
  `tests/tables-session-window.check.cjs` **8/8**,
  `tests/admin-query-chain.check.cjs` **142 files**, encoding OK, twins OK,
  `npm run build` OK, `copy-vendor --check` OK (8 modules, 132.0 KB).

### A pre-existing bug 23b fixed, re-confirmed here

The dry run exercises the same profile transaction the bot uses. Its cold-ticket
`name: undefined` rejection (`26_ORDER_FINALIZER_EXTRACTION.md` §3) does not fire
in the shadow because the transaction is seeded from `once('value')`. If it had
survived, stage 1 would have thrown for every guest order and recorded
`stage:'error'` instead of a verdict.

## 6. Honest limits

* **No authority.** The bot still finalizes; the function only observes. Flipping
  it authoritative needs (a) the box back, (b) a real-traffic window of
  `stage:'finalized'` rows with `matched:true`, and (c) a batch that decides what
  happens to `skipped` rows.
* **The box is down**, so the "bot finalized" half of every live row today comes
  from running the module locally. Rows produced while no bot exists are honest
  about it: `stockDeducted` never flips, so they stay at `stage:'placed'`.
* **Shadow traffic is not all traffic.** Only `source ∈ {webview_delivery, APP}`
  is observed — WhatsApp-bot and QR dine-in orders are finalized by other paths
  and are out of scope for this trigger.
* **The stage-1 dry run is not free**: it does the same RTDB reads as the real
  finalization (catalog, settings, discount, loyalty). That is the price of
  proving the pipeline, and it is bounded by order volume.
* **A skipped row is not a pass.** `already-finalized` and `no-shadow-row` record
  missing proof; they must never be counted as a match when this data is scored.
* **Two triggers, no shared dedupe**: an order created *and* canceled before any
  finalization leaves a `skipped` row behind forever. `migrationShadow` has no
  TTL; pruning it is a later job (it is tiny — one row per browser order).

## 7. Next step (23d)

With the module proven in shadow, 23d moves the HTTP endpoints, `wallet-watch`,
the cleanup cron and the demo reseed off EC2, leaving only the Baileys worker on
the box. The trigger becomes authoritative in its own batch, after the box is
reachable and a real-traffic matched window exists.

## 8. Files

Changed: `bot/order-finalizer.js` (dry-run + `compareFinalization`),
`bot/discount-engine.js` (shim over the new core), `bot/discount-engine-core.js`
(new), `tests/order-finalizer.check.cjs`, `tests/payment-sync.check.cjs`,
`tests/functions-source.check.cjs`,
`FIREBASE_SERVER_MIGRATION/functions/{package.json,src/index.ts}`,
`FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs` (new),
`FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderFinalizerShadow.ts` (new).

Rollback: set `migrationFlags/orderFinalizerShadow/enabled = false` (instant, no
deploy), or `firebase functions:delete onWebOrderPlacedShadow
onWebOrderFinalizedShadow`. Nothing outside `migrationShadow` was ever written, so
neither option needs a data repair.
