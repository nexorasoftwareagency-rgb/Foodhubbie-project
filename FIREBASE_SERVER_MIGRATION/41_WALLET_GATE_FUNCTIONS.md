# 41 — The wallet gate publisher moved to Functions (batch 23l)

`businesses/{bid}/outlets/{oid}/walletGate` is the switch that stops a customer
ordering when a restaurant's prepaid wallet is out of money. It is public state
(`''`/absent = open, `'low'`, `'closed'`), read by the WhatsApp bot
(`bot/utils.js walletGateBlocks`), the QR menu and the Customer App before a
checkout, and by `processInboundMessage` before it hands out an order link.

Its only writer was `bot-control-api/wallet-watch.js` — a 60 s `setInterval` on
the EC2 box, which has been offline since 2026-11-11. Nothing is broken *right
now* because **no outlet is armed** (`wallet.enforce` is not `true` on any of the
21 `walletBilling` rows), but the moment Supreme arms an outlet nothing would
ever publish a gate — and an armed outlet whose balance recovered would never be
released. That is a revenue stop with no operator in the loop.

Batch 23l deletes that watcher and does the job in the cloud: **three RTDB
triggers + one hourly exact reconcile**. The box is not coming back, so unlike
23e–23h there is no dual-write flag — the EC2 writer is gone in the same commit.

## 1. What moved

| piece | where it is now |
|---|---|
| the publish decision (`walletGate()` from the wallet) | `shared/cost-math.js` (already the single source of truth) |
| the gate engine | `functions/src/shared/wallet/gate.ts` |
| order / ledger / tamper events | `functions/src/triggers/walletGate.ts` |
| hourly exact rebuild | `functions/src/scheduled/walletGateReconcile.ts` |
| the arm switch | Supreme writes `walletBilling/{bid}/{oid}/wallet.enforce` only (no HTTP) |
| deleted | `bot-control-api/wallet-watch.js`, its `require`, its `POST /api/bot/wallet-gate/:bid/:oid` route, its `startWalletWatcher()` call, the Supreme POST |
| deleted | `functions/src/shared/wallet/compute.ts` (a drifted port: wrong rates, wrong keys, and it honoured `enforce` itself — zero importers) |

`functions:list` = **34** v2 functions after the deploy: `onOrderBillingChange`,
`onWalletLedgerChange`, `onWalletGateTouched`, `walletGateReconcile`.

## 2. Why the pass could not just be ported

The EC2 watcher held a **live in-memory mirror** of every armed outlet's whole
`orders` node (batch 14: one `on('value')` per armed outlet, recomputed from
memory per pass, precisely to stop re-downloading the node every minute). A
Function has no process between invocations, and the naive port — "re-read the
orders node every pass" — is the exact egress bug class of batches 11/14/15
(live pizza alone is 128 KB of orders and grows forever).

So the cloud keeps an **incremental order-fee index** instead:

```
meta/walletWatch/{bid}/{oid} = {
  orderFeesPaise, orders, pricingKey, at, by,      // the index
  gate, balance, publishedAt,                      // what was published
}
```

* Every order write applies `orderFeePaise(billing, after) − orderFeePaise(billing, before)`
  to the index in a transaction (`applyOrderFeeDelta`) — O(1) reads, no orders node.
* `pricingKey = JSON.stringify([normalizeMode(mode), rates || null])`. A mode or
  rate change re-prices the **entire** order history (the batch-12 warning), so a
  changed key forces a full rebuild instead of a delta.
* The hourly `walletGateReconcile` rebuilds every armed index exactly from the
  orders node, which bounds any lost or duplicated delta to **one hour**.

The summary lives under `meta/`, deliberately **outside `walletBilling`**: a write
there would re-fire `onWalletLedgerChange` and the publisher would feed itself.
`meta/*` is Admin-SDK-only, so this needed **no rules change**.

Three deliberate non-changes:

* `walletGate` keeps a public `.read` and no write rule — it must stay readable
  by an anonymous menu. The `businesses/$bid` write cascade makes it
  tenant-writable, which is exactly why `onWalletGateTouched` exists.
* POS is still not gated (a counter sale is staff-initiated; unchanged policy).
* No second wallet implementation. `computeWallet` now delegates to the new
  `computeWalletFromIndex`, and `costIndexFor` / `orderFeePaise` live beside it in
  `shared/cost-math.js` — so Admin Costs, Supreme, the bot and the gate cannot
  drift by construction. `copy-vendor.cjs` vendors the module byte-for-byte
  (**18 modules / 302.7 KB**) and its load check pins the rates
  (QR 1000 / App 2000 / WhatsApp 3000 paise) plus one worked wallet.

## 3. Behaviour, as a decision table

| event | armed? | what happens |
|---|---|---|
| order created / cancelled / re-priced | no | one billing read, then return **before** the transaction and the publish |
| order created / cancelled / re-priced | yes | delta in a cold-tx-seeded transaction (`cur && cur.pricingKey === key ? cur : seed`), clamp at ≥ 0, then publish |
| order write that changes no money (`_fcmSent`, a finalize claim, a KOT stamp) | either | `delta` **and** `countDelta` are 0 → no transaction, no publish |
| top-up / payment / charge / token pack | yes | `onWalletLedgerChange` republishes |
| `metaCostPublisher` writes `balancePaise` every 15 min | no → no | **skipped** (`!isArmed(before) && !isArmed(after)`) — never a republish storm |
| arm / disarm | — | the same trigger: seeds the index and publishes, or removes the gate **and** the summary |
| anybody else writes the gate | — | `onWalletGateTouched` recomputes; its own publish is recognised by `summary.gate` and not re-processed |
| any event on `foodhubbie-demo` | — | hard skip (the nightly reseed writes 363 fake orders) |
| hourly reconcile | yes | exact rebuild + publish, `rebuilt`/`gated` counted |
| hourly reconcile | no | removes a stale gate and a stale summary, `cleared` counted |
| hourly reconcile, billing row gone | — | the orphan's summary is swept |

`publishGate` is the **only** publish path. It writes the gate only when the
computed value differs from the stored one, so a steady wallet costs reads and no
write; `sumRef.update({gate, balance, publishedAt})` keeps the support view.

## 4. Why there is no `config/*/enabled` flag

23e/23f/23g/23h needed one because both runners existed and either could act.
Here the box's writer is **deleted**, so there is nothing to hand over: the only
safety property needed is "publish nothing unless an operator armed the outlet",
which `isArmed()` enforces (and the demo skip). Every other flag state would be a
second way for the platform to silently stop gating an armed tenant.

## 5. Evidence

**Local, before deploy**

* `node shared/cost-math.js` → `cost-math OK` (the new self-checks assert
  `computeWallet === computeWalletFromIndex` with the index it just computed,
  `orderFeePaise` = 1000 paise on ₹1,000 QR, 0 on cancelled, 200 on a legacy
  `per_order` row, and `costIndexFor` honouring a legacy rate table).
* `%TEMP%/opencode/e2e-23l-engine.cjs` — the compiled `lib/` against a fake RTDB
  that models the cold-null transaction and empty-parent pruning: **47/47**.
  Covers `isArmed` (only `wallet.enforce === true`, demo never), unarmed publish
  writes no gate/summary and clears a stale one, index seed exact, delta on a new
  order, no transaction on a non-billing write, cancel reverses and re-opens,
  replay no-op, stale cancel clamps at 0, top-up/charge, mode switch rebuilds,
  reconcile repair, orphan sweep, disarm, and "reconcile never read the
  `businesses` tree".
* `node tests/wallet-gate.check.cjs` → **55/55** (`npm run test:wallet-gate`, a CI
  step): behaviour + source pins (one publisher, `meta/` summary, demo skip,
  `compute.ts` stays deleted, no second wallet import, the Supreme arm writes only
  `walletBilling`, the EC2 watcher and its route stay gone).
* `npm run build` in `functions` → copy-vendor **18 modules / 302.7 KB**, load
  check OK, `tsc` clean, `lib/index.js` exports 34.

**Live, on the e2e tenant** (`%TEMP%/opencode/e2e-23l-wallet-gate.cjs`, real
deployed triggers and the real Cloud Scheduler job via `jobs:run`): **25/25**.

Order of the run: baseline 4 billed orders / 2,748 paise / balance ₹172.52 →
a hand-written gate on an unarmed outlet is removed → arming seeds the index
(4 / 2,748) and records the `pricingKey` and `gate:''` → an order write that
changes no money publishes nothing for 12 s → a ₹100 QR order adds exactly 100
paise → ₹10,000 → `low` → ₹20,000 → `closed` → a ₹500 payment re-opens →
a ₹1,000 manual charge closes → removing the charge re-opens → cancelling the
₹20,000 order gives its 20,000 paise back → arming the demo writes nothing →
corrupting the index to 999,999 is rebuilt to 12,848 by the **real scheduler**
(`reconcile {armed:1, outlets:20, demoSkipped:1, errors:0}`) → disarming removes
the gate and the summary → a ghost `walletBilling` row with no `businesses` node
has its summary swept (`cleared` increments). All fixtures byte-identical
afterwards; the live pizza billing and gate untouched; **nothing armed anywhere**.

**Deploy state**: `firebase functions:list` shows all four v2 /
us-central1 / 256 MiB / nodejs22 / `FIREBASE_DATABASE_URL`; the scheduler job
`firebase-schedule-walletGateReconcile-us-central1` is ENABLED, `7 * * * *`
`Asia/Kolkata`, and it has since fired on its own schedule and rewritten
`meta/walletWatch/reconcile` (`{armed:0, outlets:20, demoSkipped:1, cleared:0,
errors:0}` with a fresh `at`).

**RTDB bytes** (`firebase database:profile --raw`, 150 s, 360 events) — quoted
per listener, which is what the wallet gate actually costs:

| event | path | bytes |
|---|---|---|
| `listener-listen` | `walletBilling` | **11,098** |
| `listener-listen` | `businesses/e2e-…/outlets/e2e-…/orders` | **5,605** |
| `listener-listen` | `outletIndex` | **3,171** |
| writes | `meta/walletWatch/e2e-…/e2e-…` | 215–576 each |

That is the whole design in one table: the estate billing root is ~11 KB (read
once by the reconcile, `platformHealth`-style once-per-pass callers share the same
cost), the reconcile reads **one orders node per armed outlet** — only the armed
e2e outlet appears, at 5.6 KB — and the bookkeeping the publisher writes is a few
hundred bytes. Steady state with **zero armed outlets** (production today) is
~11 KB/hour.

One attribution note, because the raw capture also contains
`realtime-read businesses = 1,285,285 B` and
`realtime-read businesses/foodhubbie-demo/outlets/demo = 493,844 B`:
both report `userAgent Firebase/5/12.7.0/**win32**/AdminNode` from a consumer
IPv6 address, i.e. a **local dev script** (a parallel session's dashboard
verification), not a deployed Function — Cloud Run clients appear as
`2600:1900:…` / `linux/AdminNode` in the same capture. The Functions bundle has
exactly one remaining full-tree read, `tenantFromToken`'s legacy fallback in
`shared/http/tenant.ts` (stored `admins.businessId` → `outletIndex` → full scan),
and it is unreachable today: all **14** tenant admins carry `businessId`, and the
supers' outlet resolves through `outletIndex`. Keep it that way; if a future
route ever needs a business for an unindexed outlet, do not re-introduce the scan.

## 6. Honest limits

* **≤ 1 h of drift.** A lost or duplicated delta (a dropped event, a crash
  between the transaction and the publish) is repaired by the next hourly pass.
  The index also clamps at 0 and logs, rather than going negative.
* **Missed events are not replayed** — RTDB triggers do not backfill, the same
  gap every batch-23 runner has. The reconcile is what makes that survivable here.
* **One billing read per order event, even unarmed** (~0.4 KB × ~10 writes per
  order). It is what lets a rate/charge change be seen without a second signal;
  the alternative was a bigger read.
* `onOrderBillingChange` listens on the **whole order node** on purpose: a new
  order, a cancellation, a re-price and a re-opened order each change a different
  field, and leaf listeners cannot cover all of them.
* **An armed outlet pays for its own bookkeeping**: a publish reads billing +
  campaigns + gate + summary and rewrites the summary. That is a few KB per
  billable event, only while armed.
* **The reconcile is linear in armed outlets** (one orders read each) and reads
  the whole `walletBilling` root (~11 KB) per pass. At 10 armed outlets with
  pizza-sized histories that is ~1.3 MB/hour; exactness is the point, so it is
  not batched by staleness.
* **A tenant can still fight the publisher.** `walletGate` is tenant-writable by
  rules cascade; the trigger overwrites each write, so a hostile loop costs them
  a trigger invocation per write but cannot win. It never becomes a gate that
  lets orders through: an unwritten gate is `''`/absent = open, and only an
  **armed** outlet is ever closed — so the attack surface is "close my own
  orders", not "open them".
* `walletGateReconcile` runs with `maxInstances: 1` and a 300 s timeout; a pass
  that outgrows it would skip outlets (`errors` counted), not corrupt them.

## 7. What this changes for the rest of the estate

`24_WHATSAPP_OFF_EC2_DEPENDENCY.md` §6 keeps a list of what legitimately stays on
the box. `wallet-watch.js` leaves it. What remains is the socket-only WhatsApp
surface (`bot/index.js` + session data, `/api/whatsapp/*`, `/api/bot/*`, the
`rider_assigned` template and the WhatsApp reports) — nothing else.

Two operational consequences worth stating:

1. **Arming is now instantaneous and has no timeout path.** Supreme writes
   `walletBilling/{bid}/{oid}/wallet.enforce`; the ledger trigger publishes within
   seconds. There is no HTTP endpoint to call and no "wait for the next pass".
   The old `POST /api/bot/wallet-gate/:bid/:oid` route is deleted.
2. **The demo outlet is never gated**, so the nightly reseed can keep writing 363
   orders without a visitor ever seeing "ordering paused".

## 8. Lesson recorded

Batch 14 established "never a second writer" for this node — it was written by a
Cloud Function, a billing trigger *and* the EC2 watcher, and the two Functions
disagreed with the watcher. 23l keeps the property from the other side: there is
exactly one publisher, its bookkeeping is outside the node it publishes, and it
reads the estate in one place (`walletBilling`) instead of the `businesses` tree.
The profiler above is the check that this stays true — a 1.29 MB `businesses` row
in a wallet-gate capture is a bug, not a cost of doing business.
