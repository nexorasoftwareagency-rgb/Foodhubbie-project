# 37 - Daily rider settlement moved to a scheduled Function (batch 23i)

The settlement job is the quietest piece of money bookkeeping on the platform:
every night it turns "this rider collected Rs 2,480 in cash" into a settlement
record the admin can review and pay, and the rider can confirm in the app. It
lived in `bot-control-api/server.js` behind a `setInterval` on the EC2 box. The
box has been offline since 2026-11-11, so **no rider has been settled for five
days** — `meta/dailySettlementLastRun` still read `2026-11-10`.

Nothing about the job needs a socket, so it belongs in the cloud like everything
else in this migration.

## 1. What moved

`runDailySettlement(admin)` → `runSettlement(db)`, one pass:

1. take the day (see §3), then
2. for every rider: `pendingCash = max(0, riderStats.totalEarnings - sum(settlements.amountCollected))`,
3. if `pendingCash > 0`, push ONE settlement record under `settlements/{uid}`,
4. write a small support summary of the pass.

**No money moves.** This is record-keeping that mirrors the rider app's "Confirm
Received" flow — identical to what the Admin dashboard's manual settlement
writes, with a different `settledByAdmin` label and a `source` tag so the origin
is obvious in the ledger:

```json
{
  "amountCollected": 2480,
  "ordersClearedCount": 12,
  "settledByAdmin": "Auto-Settlement (Daily Cron)",
  "timestamp": 1794712455198,
  "source": "daily-auto-settlement"
}
```

`riderAck` is written as `null` in source (byte-fidelity with the control API)
but RTDB stores no nulls, so the key is **absent** until the rider confirms —
exactly the shape of every live settlement record today (checked against the two
real records on `roshani-pizza/pizza`).

## 2. Enumeration: `riderIndex`, never the `businesses` tree

The control API did:

```js
const businessesSnap = await admin.database().ref('businesses').get();   // ~3-5 MB
```

and then walked every outlet and every rider — the exact egress bug the platform
has now paid for three times (batch 11: a 5 MB tree read on every bot reconnect;
batch 14: the orchestrator downloading the database at boot; batch 15: base64
media). A nightly scheduled job doing it is worse than a one-off: it is every
day, forever, growing with tenant count and menu images.

Riders have been outlet-scoped since 2026-10-28 and **every** rider write path
also stamps the registry (`Admin/js/features/riders.js`, rider-app
`registerRider`, onboarding):

```
riderIndex/{uid} = { bid, outlet }
```

so the index IS the canonical list and a pass costs a few KB. A pass today: 2
index entries (both `roshani-pizza/pizza`), 2 KB total.

An index entry can outlive the rider record (a hand-written DB edit), so the job
checks `riders/{uid}` exists and skips otherwise — the old tree walk could not
have that problem because it enumerated `riders` directly.

## 3. The day claim is the shared, pre-existing one

`meta/dailySettlementLastRun` holds the **UTC date string** of the last pass.
Both runners use the same path and the same date convention, which is what makes
the migration safe:

* whoever runs first stamps the day and does the work;
* the other sees `lastRun === today` and returns immediately.

If the box ever comes back, its 23:00 **server time** tick (23:00 UTC = 04:30
IST) reads the stamp the cloud wrote at 17:30 UTC the same UTC day and stands
down. Exactly one pass per UTC day, whichever side runs first, with no flag and
no coordination.

One improvement over the original: the stamp is taken with a **transaction**, so
two invocations cannot both believe they own the day. The original did
read-then-`set()`.

The stamp is taken **before** the work, matching the original at-most-once
semantics: a crashed pass loses that day (they get settled tomorrow), it can
never settle a rider twice.

## 4. Everything that is deliberately skipped

| condition | reason |
|---|---|
| `bid === 'foodhubbie-demo'` | the nightly reseed writes seeded riders with seeded earnings; a settlement there is noise at best, and the public demo must not look like a real ledger |
| index entry with no `riders/{uid}` node | stale registry row, nothing to settle |
| `pendingCash <= 0` | already settled (or never earned) — a re-run of a past day is a no-op for free |
| `bid`/`outlet` missing from the index entry | cannot build a tenant path |

## 5. Schedule — one deliberate deviation

The control API ran at `DAILY_SETTLEMENT_HOUR` (default 23) **server time**,
i.e. 04:30 IST. The Function runs at **23:00 IST** (`0 23 * * *`,
`timeZone: 'Asia/Kolkata'`): the owner reads the record at close of business, not
at half past four in the morning. Recorded, not accidental.

`maxInstances: 1` + the transactional claim means two concurrent passes cannot
race; the job is far under its 120 s budget (2 riders, ~6 reads each).

## 6. What is deployed

```
firebase deploy --only functions:dailySettlement
```

`functions[dailySettlement(us-central1)] Successful create operation.` —
`functions:list` now reports **29 v2 functions**. Cloud Scheduler created

```
firebase-schedule-dailySettlement-us-central1
  schedule  0 23 * * *
  timezone  Asia/Kolkata
  state     ENABLED
  httpTarget https://us-central1-foodhubbie-10.cloudfunctions.net/dailySettlement
  first scheduleTime 2026-11-15T17:30:00Z   (= 23:00 IST)
```

read back over the Cloud Scheduler REST API with the owner's CLI token, so it is
the live job, not the deploy log.

Deploying changed no behaviour on its own: nothing had pending cash, and the day
claim still read `2026-11-10`.

## 7. Live verification — 26/26

`%TEMP%/opencode/e2e-23i-daily-settlement.cjs`. The function is fired **through
Cloud Scheduler (`jobs:run`)**, which is the same delivery path the cron uses
(Scheduler → HTTP target → the deployed function) — not a local re-implementation
of the logic.

Fixtures on the e2e tenant, plus one demo index entry:

| rider | seeded | expected |
|---|---|---|
| A | earnings 500, nothing settled | one record, `amountCollected` 500 |
| B | earnings 300, 120 already settled | one new record, 180 |
| C | earnings 100, 100 already settled | nothing |
| D | index entry, no `riders` node | skipped, nothing written anywhere |
| demo | index entry with `bid: foodhubbie-demo` | skipped |

| # | assertion |
|---|---|
| A1 | five index entries + three rider records + stats seeded |
| B1 | the deployed function ran (`meta/dailySettlement/last.ran = true`, fresh `at`) |
| B2 | exactly two settlements created |
| B3 | the demo index entry was skipped (`skipped.demo === 1`) |
| B4 | the stale index entry was skipped (`skipped.noRider === 1`) |
| B5 | the fully-settled rider was skipped (`skipped.noPending >= 1`) |
| B6 | rider A: exactly one record |
| B7 | the record shape is the documented one (5 persisted keys, no `riderAck`) |
| B8 | `amountCollected === 500` |
| B9 | `ordersClearedCount === riderStats.totalOrders` (7) |
| B10 | `timestamp` is a fresh epoch ms |
| B11 | rider B: its one old record plus exactly one new one |
| B12 | exactly one `daily-auto-settlement` row for rider B |
| B13 | rider B settled **180**, not 300 — already-paid cash is not double-counted |
| B14 | the fully-settled rider got no second record |
| B15 | the stale index entry produced no settlement anywhere |
| B16 | the demo tenant was hard-skipped |
| B17 | the day claim is stamped with the UTC date and equals the summary's day |
| C1 | a second `jobs:run` wrote no summary — it refused before working |
| C2 | no duplicate record for rider A |
| C3 | no duplicate record for rider B |
| D1 | both live pizza riders byte-identical (pending was Rs 0 each, so nothing was written) |
| E1 | every seeded settlement node removed |
| E2 | `riderIndex` byte-identical to baseline |
| E3 | `meta/dailySettlementLastRun` restored to `2026-11-10` |
| E4 | the summary node restored |

The first run of this harness scored 25/26: the guard expected `riderAck: null`
to survive the write. It does not — RTDB stores no nulls — and the two live
manual records confirm the real shape has no `riderAck` until the rider taps
"Confirm Received". **The assertion was wrong, not the code** (the source keeps
`riderAck: null` for byte-fidelity with the control API); fixed and re-run
green.

The E2E restores the day claim on purpose, so tonight's real 23:00 IST pass runs
for production instead of being eaten by a test invocation. Nothing was pending
on either live rider, so that pass is expected to create zero records.

## 8. Honest limits

* **A crashed pass loses the day.** The stamp is taken before the work (original
  semantics, at-most-once). A rider is settled tomorrow instead; nothing is
  double-paid. If that is ever unacceptable, move the stamp after the loop and
  make each record idempotent with a `settledForDay` key — do not "just" remove
  the stamp.
* **A rider missing from `riderIndex` is invisible.** Every current write path
  stamps it, but a hand-written DB rider would never be settled. The old tree
  walk would have found it. This is the price of not downloading the database;
  `Admin/js/features/riders.js` is the only creator and it writes both.
* **`ordersClearedCount` is the rider's ALL-TIME order count**, not the number of
  orders this settlement clears — a pre-existing quirk of the control API, kept
  byte-identical. The Admin manual flow writes a real per-settlement count into
  the same field, so the two sources already disagreed before this batch.
* **No notification.** The original produced no WhatsApp message either (settling
  is visible in the Admin Riders tab and the rider app). Not a regression, but a
  nightly "you have Rs 2,480 to settle" ping is an obvious product idea.
* **The control API still contains its own copy** of the job. It is harmless
  (shared day claim, and it is dead while the box is down) and it was left
  untouched so the box's code stays deployable if it ever returns. When the box
  is retired, delete it there and nowhere else.
* **Timezone of the day key is UTC, not IST.** Kept deliberately for compatibility
  with the control API's comparison. The practical effect of UTC vs IST here is
  one boundary hour around midnight, where a stamp can look like "yesterday"
  — irrelevant for a 23:00 IST job.

## 9. What this leaves on the box

Removed from the "cannot move" list: daily settlement.

Still on the box: the Baileys socket worker + `rider_assigned` WhatsApp template,
`/api/whatsapp/*`, `/api/bot/*`, `wallet-watch.js` (live-listener design, gate has
one writer, no outlet armed today), the nightly demo reseed (cron), and
`/api/images/convert-batch` (`sharp`).

## 10. Files

| file | role |
|---|---|
| `FIREBASE_SERVER_MIGRATION/functions/src/scheduled/dailySettlement.ts` | **new** — the job: `0 23 * * *` Asia/Kolkata, transactional shared day claim, `riderIndex` enumeration, demo/stale/no-pending skips, byte-compatible record, support summary |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports `dailySettlement` (29 v2 functions) |
| `tests/daily-settlement.check.cjs` | **new** — 30 static pins: cron/tz/instance, `riderIndex` only (never the `businesses` tree), the shared claim on both sides, demo skip, record shape, `riderStats`/`riders` never written, export present |
| `package.json`, `.github/workflows/ci.yml` | `test:daily-settlement` + CI step |
| `bot-control-api/server.js` | unchanged on purpose: its `runDailySettlement` stays behind the same day claim |
