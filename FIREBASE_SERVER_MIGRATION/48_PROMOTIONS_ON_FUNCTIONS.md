# 48 — Promotions on Functions (batch 23q)

Status: **BUILT, DEPLOYED FLAG-OFF, LIVE E2E PASSED.**
Plan: `47_PROMOTIONS_ON_FUNCTIONS_PLAN.md` (approved decisions D1–D7).
Closes the last `SEND_PROMOTION` row of `Pending-Work.md` §4a-2.

## 1. What this batch finished

`bot/promotions.js` was the last piece of product logic that only ran on the EC2
socket host. Every other **database effect** already runs on Cloud Functions
(orders, loyalty, stock, pushes, onboarding, settlement, demo reseed, wallet gate,
operator replies, inbound).

With the box down since 2026-11-11, an owner could still author a campaign, but:

| Admin action | Before this batch | After |
|---|---|---|
| Launch (send now) | `campaigns/{id}` (`running`) + a `bot/commands` `SEND_PROMOTION` queued for ever | a slice runner sends it |
| Schedule | `campaigns/{id}` (`scheduled`, `runAt`) | picked up at `runAt` (15-min grace) |
| Resume a paused campaign | `status:'running'` | resumed from `currentIndex` |
| Stop | `status:'stopped'` — **decorative** (F2) | slice aborts within 10 sends |
| Kill switch / promo toggle | written, never read | honoured per send |
| Test send | queued for ever | sends to the owner only, never billed |

23o deliberately left `SEND_PROMOTION` untouched and unconsumed; a stub that
"sends to everyone" is the top ban trigger and ignores consent. This batch ports
the **real** engine.

Promos still cannot be **delivered** until a tenant has a real number
(`whatsapp.phoneNumberId`). The batch ships flag-off and is proven against the real
Graph failure path (§8).

## 2. The 540-second constraint

A 300-recipient campaign at the documented pacing is
`300 × 11.5 s + 9 × 90 s ≈ 71 minutes`. Event-driven and scheduled v2 functions
time out at 540 s, so it cannot be one invocation. The chosen shape is **bounded
slices + persisted `currentIndex` + a lease + a per-minute sweep** — no new
infrastructure, self-healing, same shape as `walletGateReconcile`.

## 3. Three moving parts (as built)

```
Admin writes campaigns/{id}  (status running|scheduled)
        │
        ▼
onPromotionStatus        onValueWritten on campaigns/{id}/status
        │                maintains meta/promotionsActive/{bid}/{oid}/{campaignId}
        │                = { status, runAt, nextAt, updatedAt }  (Admin-SDK only)
        │                removed on paused / terminal / deleted
        ▼
onBotCommand             existing trigger, new SEND_PROMOTION branch
        │                deletes the command, runs slice 1 (low latency)
        ▼
promotionSweep           onSchedule('* * * * *'), maxInstances 1, 512 MiB
        │                reads meta/promotionsActive once (null when idle)
        │                runs ONE slice per due entry, sequentially
        ▼
bot/promotions-engine.js the vendored slice runner (socket-free, injected)
```

Why a leaf listener on `status`: the runner writes `currentIndex`/`totalSent` on
every send; a whole-node listener would fire ~300 times per campaign and re-read
the campaign each time (the batch-11 egress class). Status changes 3–5 times.

Why an index: a per-minute sweep querying every outlet's campaigns node is
50 indexed queries/minute of pure framing (batch 14 measured 34 `.get()`s = 6.5 KB
payload billed as 29 KB). `meta/promotionsActive` is empty when nothing runs, so
an idle platform costs ~0 bytes.

## 4. The engine (one implementation, two runners)

`bot/promotions-engine.js` (775 lines) is the socket-free runner the bot adapter
and the cloud both use, copied byte-for-byte into the Functions bundle by
`functions/scripts/copy-vendor.cjs`. It requires only `./promotions-rules` (371
lines of pure decisions, zero requires) and never imports `bot/firebase`,
`bot/utils`, Baileys or `bot/index.js`.

`createPromotionsEngine({db, resolvePath, billingPath, outlet, transport, …})` →
`{runSlice, sendPromoWithFallback, expireOldPromoLogs, promoConsent, releaseLease}`.
Only `db` + `resolvePath` are required; every other dep defaults, so a bare engine
can drive `expireOldPromoLogs()` in an E2E.

`bot/promotions.js` is now a 179-line thin adapter (was 707): the Baileys loop
delegates to the same `sendPromoWithFallback` and the same decisions, so the two
paths cannot drift while the box is still alive.

### 4.1 The lease is held by a SLICE, not a campaign (deviation from §4.2 of the plan)

The plan sketched a lease at `meta/promotionsActive/.../lease` and said "a live
lease held by any campaign aborts". The real serialiser stays where the engine
already had it — `bot/promotions/lease`, a cold-seeded transaction with a 90 s
TTL — so the bot and the cloud share one lock and no second implementation
exists.

The **holder** is a slice identity (`campaignId#engineTag#seq#t0`), not the
campaign id. This was found while preparing the live run, and it is load-bearing:

- a normal launch writes `status:'running'` (relay indexes it, sweep runs it)
  **and** a `SEND_PROMOTION` command (command handler runs it);
- a campaign-re-entrant lease would read the second runner as a *renewal* and let
  both slice the same campaign concurrently — the same recipient sent twice, and
  two token decrements;
- only renewal presents the same holder; anything else is refused until the TTL
  lapses.

`releaseLease(campaignId, holder)` is ownership-checked for the same reason: a
slice whose TTL lapsed must not hand the campaign back while a newer slice owns
it.

### 4.2 Two defects found while making the lease real

**The release could never commit.** The Admin SDK invokes a transaction with
`null` even for an existing node (proven live in this repo), and returning
`undefined` aborts before the server value arrives. The old release returned
`undefined` on that cold pass, so a lease would only ever be freed by its 90 s TTL
— and the E2E's "lease released" assertion would have failed. The release now
seeds `null` on the cold pass; a CAS mismatch re-runs it with the real value and
only then applies the ownership check.

**The breaker failure was not counted.** In `runSlice`, a send that tripped the
circuit breaker returned before `sliceSent`/`failed` were incremented, so a
campaign paused by the breaker reported `currentIndex 10 / totalFailed 9` — and
the last failed attempt was invisible on the Admin card. Outcomes are counted
before the early return now; the redundant `failed++` in the else-branch is gone.

### 4.3 The slice

`runSlice(cmd, {budgetMs = 480_000, batchSize = 30, force})`, both knobs clamped
(`budgetMs` 30 s…480 s, `batchSize` 1…30).

- Starts at `campaign.currentIndex`, sends at most `batchSize`, never starts a
  send it cannot finish (`now - t0 + PROMO_MAX_DELAY_MS > budgetMs`).
- **Every rule is checked before each send**, in the bot's order.
- `currentIndex` is written **before** the send (claim-before-send, at-most-once).
- Batch boundary → `nextSliceAt = now + 60–120 s`; budget exhaustion →
  `now + 2–15 s`; the gap costs zero function time.
- Done → `status:'done'`, `completedAt`, strip inline media, `PROMO_DONE` audit.
- Any pause → `status:'paused'` + `pauseReason` + `currentIndex` + accumulated
  counters, lease released.
- `status` is re-read every 10 sends: **`stopped` aborts the slice** (F2 fixed).
- `totalSent`/`totalFailed` **accumulate** across slices (F8): every slice is a
  resume, so zeroing them would under-report on the Admin card.

Gate order: terminal → paused → missing-campaign → scheduled (waiting / missed /
due) → `bot/promotions/enabled` → `killSwitch` → no transport ⇒ `no-number` →
non-Meta transport ⇒ `transport-blocked` → degraded ⇒ `session-degraded` → quiet
hours (defer) → lease (`waiting` / `lease-held`) → per recipient: daily ceiling →
token balance (`no-tokens` / `balance-unreadable`) → opt-out / consent / frozen ⇒
`logSkip` (skipped, never failed) → lease renew (`lock-lost`) → claim → send.

### 4.4 Quiet hours are a deferral

`quietHoursState()` (campaign-owned `quietHours:{start,end}` hours-of-day) writes
`waitingUntil` + `waitingReason:'quiet-hours'`, releases the lease, returns
`waiting` with `nextSliceAt = untilMs`. Status stays `running` — it is running,
just waiting. The bot slept in-process for up to 8 hours; a Function cannot, and
would burn 8 hours of compute for nothing. The Admin card shows one muted line
("waiting — resumes …").

### 4.5 Transport

The cloud engine receives `makePromotionTransport(bid, oid)`, which wraps the
existing `makeTenantTransport` (Meta only). No number → `transportError` (a value,
not a throw) → the engine pauses `no-number` instead of crashing. `isDegraded` is
constant `false` (a cloud transport is always Meta). `isFrozen` is RTDB-backed
(`bot/chatState/{phone10}/frozenUntil`) because a Function has no process between
invocations.

### 4.6 Pacing (unchanged)

`8–15 s` per message, `60–120 s` every 30, 300/day cap, warm-up ladder
`20→40→60→100→150→200→250` from `bot/pair/{oid}/firstLinkedAt`. The Admin guide
already states these numbers; they are the documented anti-ban posture. Wall
clock for 300 recipients stays ~70–90 min, spread over ~10 slices.

## 5. Parity matrix — result

All 31 rows of the plan's §5 are implemented. The four that changed shape:

| # | Bot | Cloud |
|---|---|---|
| 5 | outlet lock, no TTL | lease, 90 s TTL, renewed per send, **slice-owned** |
| 11 | quiet hours → in-process sleep | **defer** to `untilMs` |
| 12 | socket dead → `session-degraded` | n/a (no socket); transport error → failure path |
| 28 | counters zeroed on resume (F8) | **accumulated** across slices |

## 6. Findings — status

- **F1** (`cryptoErrorCount` passed by value, never fired) — not ported (no socket).
- **F2** ("Stop" was decorative) — **fixed**: the slice re-reads status every 10
  sends and aborts.
- **F3** (quiet hours slept in-process) — **fixed** by deferral.
- **F4** (dead constants `PROMO_PAUSE_MS`, `PROMO_SOCKET_DEAD_GRACE_MS`) — deleted.
- **F5** (`bot/commands` accumulated one `SEND_PROMOTION` per campaign) — **fixed**:
  the cloud branch deletes the command after running it.
- **F6** (a quiet-hours wait looked stalled) — **fixed**: the card line.
- **F7** (₹0.137 gross margin per promo) — unchanged, recorded in the plan.
- **F8** (resume zeroed the counters) — **fixed** in the shared engine.
- **New F9** (release could never commit; see §4.2) — **fixed**.
- **New F10** (breaker failure not counted; see §4.2) — **fixed**.
- **New F11** (campaign-re-entrant lease allowed two runners of the same campaign;
  see §4.1) — **fixed**.

## 7. Files

| File | Change |
|---|---|
| `bot/promotions-rules.js` | **NEW** — pure decisions (371 lines, zero requires): `PAUSE_REASONS`, `quietHoursState`, `scheduledState`, `normalizeRecipients`, `warmupDailyLimit`, `failureRateExceeded`, `hasInlineMedia`, `campaignAgeMs`, `istDateStr`. |
| `bot/promotions-engine.js` | **NEW** — the slice runner (775 lines): `runSlice`, `sendPromoWithFallback`, `expireOldPromoLogs`, `promoConsent`, `releaseLease`. |
| `bot/promotions.js` | rewritten as a 179-line thin adapter (was 707). |
| `bot/index.js` | `isPromotionsRelayEnabled()` (30 s cache, `catch → false`) gates 4 sites — the `SEND_PROMOTION` branch (returns **before** `snap.ref.remove()`), scheduled pickup, resume-on-reconnect, daily expiry. The listener itself stays. |
| `functions/src/triggers/promotionRelay.ts` | **NEW** — `onPromotionStatus` index maintenance. |
| `functions/src/scheduled/promotionSweep.ts` | **NEW** — per-minute dispatcher + daily 30-day expiry claim. |
| `functions/src/shared/promotions/factory.ts` | **NEW** — `makePromotionEngine`, `makePromotionTransport`, `promotionBillingPath`, `PROMO_RULES`, `skipTransport`. |
| `functions/src/triggers/botCommands.ts` | new `SEND_PROMOTION` branch (own flag, clamp, delete-then-run, `force:true`). |
| `functions/src/index.ts` | exports `promotionSweep` + `onPromotionStatus`. |
| `functions/scripts/copy-vendor.cjs` | +2 modules → **24 modules / 414.4 KB** with 23q load assertions. |
| `Admin/js/features/promotions.js` | `no-number` / `session-degraded` / `lock-lost` pause copy + the quiet-hours waiting line. |
| `Admin/sw.js` | `v5.12.79`. |
| `tests/promotions-cloud.check.cjs` | **NEW** guard (58 checks, 9 mutations). |
| `tests/bot-commands.check.cjs` | revised for the 23q branch (47 checks). |
| `package.json` + `.github/workflows/ci.yml` | `test:promotions-cloud` + CI step. |

**No `database.rules.json` change.** `meta/*` is default-deny (Admin SDK only);
`bot/promotions/*` already grants admins with `.indexOn ["status","runAt"]`;
`campaigns/{id}` has no `.validate`, so `waitingUntil` needs no rule.

## 8. Verification

### 8.1 Guards

- `tests/promotions-cloud.check.cjs` — **58 checks** (real engine against an
  in-memory RTDB + fake transport), `--self-test` **67/67** (9 mutations caught).
  Covers: claim-before-send, resume from `currentIndex`, batch/budget boundaries,
  stop-within-10, consent (app-off wins), quiet-hour deferral, circuit breaker,
  cost-guard pause, token decrement, warm-up ladder, per-slice accumulation,
  done-strips-media, the live lease held by **another campaign** and by **another
  slice of the same campaign**, an expired lease, a stale slice not releasing a
  newer holder's lease, and every promotion writer queuing into the **tenant**
  `bot/commands` path (never the platform root).
- `tests/bot-commands.check.cjs` — **47/47** (the generic-message contract plus
  the 23q branch: flag, clamp, delete-then-run, demo skip).
- `tests/functions-source.check.cjs` — **198/198**; `bot/tests/unit.test.js` —
  **28/28**; `tools/check-shared-twins.cjs` — **8/8**; the batch's 18 touched
  files are encoding-clean (no mojibake / BOM / C1 / U+FFFD — the repo-wide
  `test:encoding` run is red on two files another session committed).
- `functions` `npm run build` (copy-vendor load check + `tsc`); vendored
  `promotions-engine.js` / `promotions-rules.js` byte-identical to source
  (SHA-256 checked).

### 8.2 Live E2E — `e2e-23q-promotions.cjs`

Runs the REAL deployed triggers and fires the REAL Cloud Scheduler job
(`jobs:run`) on the e2e tenant, then restores every fixture byte-identically.

**Result: 52/52, exit 0, `fixtures restored byte-identically`.**

| Part | Proves |
|---|---|
| A | flag absent **and** `enabled:false` → the relay writes nothing, the campaign is untouched |
| B | flag on, tenant has no number → `paused` / `no-number`, nothing sent, no ledger node |
| C | two real Graph attempts recorded as failed, `currentIndex` at the end, tokens untouched, log rows carry the Graph error, no usage bump, **lease released**, index entry removed |
| C2 | ten straight failures → `paused` / `high-failure-rate`, `totalFailed 10` / `currentIndex 10` / `totalSent 0`, a paused campaign is never re-indexed |
| D | quiet hours → `status:'running'` + future `waitingUntil` + **nothing sent** (deferral, not a sleep) |
| E/E2 | a `scheduled` campaign >15 min late → `expired` / `missed-window` with a positive `lateBy`; a future one stays `scheduled` with its `runAt` in the index and never starts |
| F | `tokens.balance 0` → `paused` / `no-tokens`, nothing sent |
| G | `killSwitch:true` → `paused` / `kill-switch` |
| H | an admin Stop is honoured **before any send** in a fresh slice |
| I | 3 recipients across **≥2 slices** with `sliceBudgetMs:30000`: `currentIndex` never moves backwards, every attempt counted, a budget-exhausted slice carries no `nextSliceAt`, the **lease is released between slices**, index entry removed when done |
| J | the demo tenant is never indexed and never touched |
| K | the daily expiry claim removes a 31-day-old log bucket + campaign and keeps a fresh one |
| L | a command-only `SEND_PROMOTION` self-test (`isTest`) creates its campaign, makes **one** real Graph attempt, leaves **no** command node and no tombstone, and charges **no** prepaid token |
| L2 | `SEND_GENERIC_MESSAGE` is untouched while `config/botCommands` is off — the two switches are independent |
| M | the index empties once every campaign disappears |

**The first run failed exactly one assertion, and the failure was the harness,
not the product.** Part L wrote its `SEND_PROMOTION` command to the **platform
root** `bot/commands`, while `onBotCommand` listens on
`businesses/{bid}/outlets/{oid}/bot/commands` — the command could never be
drained. The real writers had always been tenant-scoped
(`Outlet.ref('bot/commands')` in chat.js/promotions.js/riders.js and
`tenantRef(outlet, 'bot/commands')` in rider-analytics.js), so the harness was
corrected to `${T}/bot/commands`. That gap is now a permanent guard: the new
`every promotion writer queues into the TENANT bot/commands path` check in
`tests/promotions-cloud.check.cjs` pins the trigger ref **and** the two client
writers, so neither side can drift to the root again. (A retry between runs
aborted on a `401 UNAUTHENTICATED` from `jobs:run`: the CLI's cached access
token had expired. `firebase projects:list` refreshed it; no product change.)

### 8.3 What cannot be proven here

- **Real delivery** — needs a real `phoneNumberId` on the WABA (owner blocker).
- **Meta quality rating / messaging-limit tier** — only observable with live
  traffic over days.
- **Real per-message marketing billing** — `metaUsage` is recorded from our own
  rate table, not from an invoice; reconcile with the BigQuery export (batch 21)
  once a number is live.

## 9. Rollout

1. Deployed `functions:onPromotionStatus,onBotCommand,promotionSweep` — surface
   **38 → 40** v2 functions.
2. `config/promotionsRelay` stays **absent** → all three are no-ops; the bot keeps
   its branch. `config/botCommands/enabled` (a boolean) is a *separate* switch
   from `config/promotionsRelay` (an object) — generic replies and promos flip
   independently.
3. When a tenant has a real `whatsapp.phoneNumberId`:
   `config/promotionsRelay = { enabled: true, by: '<owner>', doc: '48' }`.
4. First real campaign: watch `bot/promotions/logs`,
   `walletBilling/.../metaUsage`, and the Meta quality rating for 24 h.
5. Only then consider tightening pacing (D1) or raising the 300 cap.

## 10. Deletion-list impact

After this batch `bot/commands` has **no** live writer for `SEND_PROMOTION` and
the bot's listener has no live job for it — the promotions side of the EC2 prune
(M3) is clear. The socket itself still needs the box (inbound + generic replies
until the callback flip).
