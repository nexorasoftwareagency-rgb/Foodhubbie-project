# 38 - Nightly demo reseed moved to a scheduled Function (batch 23j)

The public demo at `app.foodhubbie.in/demo` is a writable sandbox seeded from the
live Roshani Pizza catalog (`AGENTS.md`, "Public demo = the real dashboard").
Since the box went dark on 2026-11-11 the nightly reseed at 03:00 IST has not
run — and it would not have worked if the box came back: `tools/seed-demo-tenant.cjs`
still `require`d `Admin/js/demo/demo-data.js`, the file deleted on 2026-10-29 with
the old static tour. So this batch had two jobs:

1. make the reseed **runnable again** (the fixtures had no surviving home), and
2. put it on Functions so it no longer depends on EC2 at all.

## 1. What moved

`tools/seed-demo-tenant.cjs` was a thin CLI over `buildTenant(now)` plus a
Firebase Admin write. It is now three files:

| file | role | runs where |
|---|---|---|
| `tools/demo-fixtures.cjs` | the 11 static catalog arrays (`DEMO_OUTLET`, `DISHES`, `RIDERS`, `CUSTOMERS`, `STAFF`, `INVENTORY`, `PROMOTIONS`, `DISCOUNTS`, `FEEDBACK`, `CHATS`, `TABLES`) recovered from the deleted `demo-data.js` | — |
| `tools/demo-seed-core.cjs` | `createDemoSeedCore({ now, money, fixtures, live }).buildTenant()` — the pure builder, `now` injected, no `fs`, no `firebase-admin`, no `Date.now()` | Functions **and** CLI |
| `tools/seed-demo-tenant.cjs` | thin CLI: dry-run by default, `--apply`, `DEMO_SEED_NOW` freezes the clock | dev machine only |

`FIREBASE_SERVER_MIGRATION/functions/src/shared/demo/factory.ts` is the only
construction path inside the bundle (`buildDemoTenant({ now, dbUrl })`,
`demoDbUrl()`), and `functions/src/scheduled/demoReseed.ts` is the job.
`copy-vendor.cjs` vendors the core + fixtures + `shared/payroll-math.js`
(16 modules, 264.9 KB) and **load-checks the builder at build time** against a
stub catalog, so a broken bundle fails `npm run build` instead of failing at
03:00 IST.

## 2. Determinism

The builder takes `now` as its only clock. Same `now` → same bytes: the CLI
produces an identical SHA across runs, and the live pass builds 363 orders /
22 dishes / 4 combos / a payroll run whose net is 41,113 paise. The seeded
`settings/Store.storeName` is `Demo Dashboard`, `settings/Delivery.backupCode`
is 4 digits (`'2026'` — anything else silently fails every Save Settings in the
dashboard), and money is written to the server-only `walletBilling` root, never
inside the tenant.

Two things are **asserted absent**, not written: `outletIndex/demo` (it is the
QR/menu resolver — a seeded entry would let a real customer order from the
sandbox) and the outlet's `whatsapp` node (`bot-control-api` spawns a worker for
any outlet that has one). Both are removed/asserted in the job and pinned by the
guard.

## 3. The 20 h claim

Taken with a transaction on `meta/demoReseed/last.at` **before** the work, like
the rider settlement's day claim. Two differences from 23i:

* the window is **20 h**, not 24 h, so a manual re-run the next morning still
  works while a second scheduled fire inside the same day never does;
* only the scheduled Function consults it — the CLI ignores it, so an operator
  reseeding by hand always succeeds.

The callback must **claim on the cold `null` pass** (returning `undefined` there
aborts the whole transaction — the batch-23g lesson) and only abort when the
server value is recent. A failure keeps the claim and writes
`{ran:false, reason:'error', error}`: the demo keeps yesterday's data, and the
job does not retry in a loop.

There is deliberately **no feature flag**. 23e–23h needed one because a surviving
bot counterpart had to be switched off in lockstep; the reseed's only other
writer is a cron on a dead box, and the claim is the shared lock.

## 4. The 500-event trigger budget (found live)

The first live run was rejected:

```
meta/demoReseed/last = {ran:false, reason:'error',
  error:'TOO_MANY_TRIGGERS: This request would cause too many functions to be triggered.'}
```

RTDB refuses a write that would fire more than **500 Cloud Functions v2 in one
region**. Twelve deployed triggers watch the order path (3 `created` on
`orders/{id}`, 5 `written` on `status`, plus `paymentStatus`, `riderId`, and the
two shadow/flip listeners), so one order is ~10 events and a whole-tenant `set()`
of 353 orders is ~3,500. The tenant was verified intact after the rejection — the
write is atomic, nothing half-landed.

**Second live run failed the same way**, and that was the useful surprise: the
retry omitted `orders` from the parent `set`, but a `set` of the parent without
the child **deletes** the child, and each deletion fires the `status` triggers
with `after = null`. Deletion spends the same budget. This is now recorded in
`FIREBASE_SERVER_MIGRATION/24_WHATSAPP_OFF_EC2_DEPENDENCY.md`'s neighbourhood and
in the guard.

The shipped `writeTenant()` is therefore **three phases**, every `orders` write
bounded by `ORDERS_PER_WRITE = 25` (~250 events, half the cap):

1. chunk-delete yesterday's orders (`update({ key: null, ... })` in batches);
2. one atomic `set` of the tenant **without** `orders` (only the 8 customer
   `loyalty` writes fire);
3. chunk-create the new orders.

## 5. Two triggers had no demo guard

Found by reading the trigger inventory during the same investigation: unlike
23e–23h, `onOrderStatusChange` (legacy) and both 23c shadow triggers never
skipped the demo tenant. A reseed would therefore have:

* stamped `placedAt`/`confirmedAt`/… onto seeded orders — the demo would stop
  being the bytes the builder produced;
* dry-run the real finalizer ~170 times and written a shadow verdict per
  web-source order.

Both now hard-skip `foodhubbie-demo` with their own `DEMO_BUSINESS_ID` constant
(no shared import to drift), and the guard walks **every** module that declares
an `orders/` ref and fails if one lacks the skip. Mutation-tested: removing one
guard line fails the check naming that file.

## 6. Schedule

`onSchedule('0 3 * * *', { timeZone: 'Asia/Kolkata', maxInstances: 1 })` —
03:00 IST, matching the old cron's effective time (`30 21 * * *` UTC). Live
scheduler job `firebase-schedule-demoReseed-us-central1`, `ENABLED`, next fire
`2026-11-16T21:30:01Z`. `maxInstances: 1` plus the claim means there is never a
second concurrent pass.

## 7. What is deployed

```
firebase deploy --only functions:demoReseed,functions:onOrderStatusChange,functions:onWebOrderPlacedShadow,functions:onWebOrderFinalizedShadow
  functions[demoReseed(us-central1)]                 Successful update operation.
  functions[onOrderStatusChange(us-central1)]        Successful update operation.
  functions[onWebOrderPlacedShadow(us-central1)]     Successful update operation.
  functions[onWebOrderFinalizedShadow(us-central1)]  Successful update operation.
  Deploy complete!
```

`firebase functions:list` = **30 v2 functions**, 12 of them on the order path.
No rules change, no hosting change (the demo dashboard reads the same shapes).

### The CPU quota ceiling (hit during this deploy)

Right after the four-function deploy, a follow-up deploy of `onOrderStatusChange`
(to fix a comment encoding) failed twice with:

```
Could not create or update Cloud Run service onorderstatuschange, Container Healthcheck failed.
Quota exceeded for total allowable CPU per project per region.
```

**It is transient, not a hard block.** The same command succeeded ~2.5 minutes
later with no change. Twenty-nine successful function deploys in a row and this
failure pattern say the project sits at the **Cloud Run "total allowable CPU per
project per region"** ceiling in `us-central1`: an update provisions a new
revision while the old one still holds its CPU, so back-to-back deploys of 1-vCPU
functions can overflow the quota until Cloud Run retires the previous revisions.

Operational consequences worth knowing before the next batch:

* a deploy that fails this way leaves the **previous revision serving** — the
  function is not broken, the new code is simply not live;
* recovery is "wait a few minutes and retry" — do not start deleting functions
  to make room reflexively;
* the two 23c shadow triggers are the only **deletable** CPU here. `placedAt` /
  `confirmedAt` / `deliveredAt` are read by `Admin/js/features/orders.js` and the
  rider app, so the legacy `onOrderStatusChange` is still load-bearing and must
  not be removed as a "cleanup";
* a real quota increase (IAM & Admin → Quotas → Cloud Run API → *Total allowable
  CPU per project per region*) is the durable fix if the function count keeps
  growing.

## 8. Live verification — 35/35

`%TEMP%/opencode/e2e-23j-demo-reseed.cjs` fires the **real** Cloud Scheduler job
(`jobs:run` through the owner's `firebase login` refresh token — same delivery
path as the cron; no manual invoke, no mock) and waits on `meta/demoReseed/last`
as the oracle.

| phase | checks |
|---|---|
| A seed | a stale order + a stale category written, claim opened with `at:0` so the pass is due |
| B fire | `ran:true`; finished in **3 s**; resolved the demo Auth user (`oAoW5tN0etX95EKHA50BFgzGkim1`, kept usable); built 22 dishes / 4 combos; payload is a full tenant; payroll built with the real math; summary stamped with the UTC day; `orderWrites >= 10` (i.e. the chunking actually engaged — 363 orders → 15 writes) |
| C wire | the stale order **and** the stale category are gone (whole-tenant replace); 363 orders match the summary; 22 dishes / 4 combos / 8 customers; `storeName` = `Demo Dashboard`; `backupCode` 4 digits; money on `walletBilling`; welcome token pack intact; **no** tenant-writable `billing` node; **no** `outletIndex/demo`; **no** outlet `whatsapp`; demo admin mirror points at the tenant |
| C14/C14b/C15 trigger proof | after a 25 s settle: shadow row **count unchanged** (4 pre-existing rows from earlier E2E work survive; the check compares counts, not existence) and **no** row names a freshly seeded order; **no** seeded order carries `placedAt`/`confirmedAt`/`deliveredAt`/`cancelledAt`/`refundedAt` |
| D claim | a second fire inside 20 h does not rewrite the summary and does not reseed |
| E demo | `app.foodhubbie.in/demo` signs in as the demo tenant, **23 tabs** render, dashboard recent-orders has 5 rows, banner present, seeded store name visible, **0 console/page errors** |

Guard `tests/demo-reseed.check.cjs` = **50/50** (`npm run test:demo-reseed`,
CI step): schedule/tz/maxInstances, the 20 h claim on the cold pass, the
failure-keeps-claim branch, determinism, every write path is one of the demo
paths, `ORDERS_PER_WRITE <= 40` **and** the chunked delete loop precedes the
atomic set, `writtenOrders === stats.orders`, `outletIndex` only removed,
`whatsapp` never written, `backupCode` 4 digits, the builder has no wall clock,
copy-vendor vendors + load-checks the builder, and every order-path trigger
hard-skips the demo. `tests/functions-source.check.cjs` 188/188.

## 9. Honest limits

* **A missed pass is not retried.** The claim is stamped before the work; a
  crash loses that night and the demo keeps yesterday's data (same
  at-most-once choice as 23i).
* **The reseed wipes writes made in the sandbox.** It is a full replace by
  design; anything a visitor saved disappears at 03:00 IST.
* **The five pre-existing shadow rows** under
  `migrationShadow/orderFinalizer/foodhubbie-demo` still sit there from earlier
  E2E work. They are observation data about deleted fake orders; nothing reads
  them. Left in place deliberately (deleting them would also fire nothing, but
  they are the only evidence the old bug existed).
* **The box's own cron is still armed.** `/home/ubuntu/demo-seed/` has its own
  copy and crontab entry; if the box returns both would run, and the two claims
  are **not** shared (the box's seeder is a plain write, no claim). When the box
  returns: delete `/home/ubuntu/demo-seed/` and its crontab line, or the box will
  reseed at 03:00 IST as well as the Function.
* **`onOrderStatusChange` and the shadows are deleted-in-waiting.** They are
  legacy/shadow surface kept for observation; the demo skip is the only change
  made to them here.
* **The public demo still has no rate limit.** The reseed restores data, not
  behaviour.
* **The project is at its Cloud Run CPU ceiling** (see §7). Deploys can fail
  transiently with `Quota exceeded for total allowable CPU per project per
  region`; the previous revision keeps serving, and a retry a few minutes later
  succeeds. A durable fix needs a quota increase.

## 10. What this leaves on the box

Removed from the "cannot move" list: the nightly demo reseed.

Still on the box: the Baileys socket worker + the `rider_assigned` WhatsApp
template + the WhatsApp daily/weekly/monthly reports (`bot/reports.js`),
`/api/whatsapp/*`, `/api/bot/*`, `wallet-watch.js` (live-listener design, sole
writer of `walletGate`, no outlet armed today), and
`/api/images/convert-batch` (`sharp`).

`wallet-watch` is the only *writing* job left that has a Functions-shaped
question attached; `/api/images/convert-batch` is the only one left that needs a
binary dependency.

## 11. Files

| file | role |
|---|---|
| `tools/demo-fixtures.cjs` | **new** — the 11 static fixture arrays, recovered from the deleted `demo-data.js` |
| `tools/demo-seed-core.cjs` | **new** — `createDemoSeedCore({ now, money, fixtures, live })`, the pure builder both runners use |
| `tools/seed-demo-tenant.cjs` | rewritten as a thin CLI over the core (dry-run default, `--apply`, `DEMO_SEED_NOW`) |
| `FIREBASE_SERVER_MIGRATION/functions/src/shared/demo/factory.ts` | **new** — `buildDemoTenant({ now, dbUrl })`, resolves the vendored core from `lib/vendor` |
| `FIREBASE_SERVER_MIGRATION/functions/src/scheduled/demoReseed.ts` | **new** — the job: `0 3 * * *` Asia/Kolkata, 20 h claim, three-phase `writeTenant`, `ORDERS_PER_WRITE = 25`, Auth-user sync, forbidden-node removal |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/onOrderStatusChange.ts` | gained the `DEMO_BUSINESS_ID` skip (it writes `placedAt` onto what it observes) |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderFinalizerShadow.ts` | gained the `DEMO_BUSINESS_ID` skip on both shadow triggers |
| `FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs` | vendors core + fixtures + payroll math (16 modules, 264.9 KB) and load-checks the builder |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports `demoReseed` (30 v2 functions) |
| `tests/demo-reseed.check.cjs` | **new** — 50 static pins, mutation-tested against a removed trigger guard |
| `package.json`, `.github/workflows/ci.yml` | `test:demo-reseed` + CI step |
