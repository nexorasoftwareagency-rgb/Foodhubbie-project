# Batch 14 — one wallet-gate writer, and a publisher that stops re-reading

*Date: 2026-11-10 · branch `main` / `server` · commits `6fd1da9`, `5b5aae4`, `4e38e1c`*

Batch 13 moved the media out of RTDB. This batch went back to the profiler and
found that **the wallet gate had three writers** — and that the publisher it
should have been alone was re-downloading 34 nodes every minute.

---

## 1. Where this came from

After batch 13 the egress looked like this (`firebase database:profile --raw`,
162 s window):

| | |
|---|---:|
| Rate | 29.2 KB/min |
| Projected | 41.1 MB/day |

That is already **~112× less** than the incident (3.24 MB/min → 4.65 GB/day,
see `11_RTDB_COST_INCIDENT.md` §6). But the breakdown was not "the bot's own
listeners" — it was the platform re-reading its own bookkeeping:

| Area | Share | Reader |
|---|---:|---|
| `businesses/*` | 44% | bot listeners (legitimate) |
| **`walletBilling/*`** | **40%** | EC2 `wallet-watch.js`, 33 `.get()`s every 60 s |
| **`outletIndex`** | **16%** | the same pass + the Cloud Function |

---

## 2. Bug 1 — three writers of `walletGate`

`walletGate` is customer-facing state (`low` | `closed` | open) that the bot,
the QR menu and the customer app read before taking an order. Three separate
pieces of code wrote it, and **none of them agreed**.

### 2.1 `walletGateCheck` (Cloud Function, every 1 minute) — deleted

It decided "is this outlet armed?" from

```
businesses/{bid}/outlets/{oid}/billing/wallet/enforce
```

— the node **pruned by the batch-12 billing-ledger migration**. Verified live:
that node is `ABSENT` on **0 of 33** outlets (the real flag lives at
`walletBilling/{bid}/{oid}/wallet/enforce`). So the function always believed
every outlet was disarmed, published **open**, and reopened any armed gate
within 60 s of the real publisher arming it.

It also cost 43,200 invocations/month and was the reader of `outletIndex` in
the profile (a Google IPv6 client, ~9.5 KB per pass).

### 2.2 `onWalletUpdate` (Cloud Function trigger) — deleted

This one is worse. It triggered on

```
walletBilling/{bid}/{oid}/balancePaise
```

and wrote `businesses/{bid}/outlets/{oid}/walletGate`.

**`balancePaise` is not the restaurant wallet.** It is the **Meta API credit
line** — `META_CREDIT_LINE_START_PAISE − accumulated metaUsage` — written by
`bot-control-api/meta-cost-publisher.js` every 5 minutes (and by the
`metaCostPublisher` function every 15 minutes). So this trigger published the
**customer-facing order gate from a Meta budget number**, with its own
thresholds (`< 50000` → `low`) instead of `shared/cost-math.js`, and it never
looked at `billing.wallet.enforce` — it would gate an outlet whose plan never
armed the gate. It also wrote the literal string `'open'` where the publisher
stores `''`.

It was latent only because `balancePaise` does not change for outlets that
send no Meta messages (the live fleet is on Baileys). It would have fired the
moment an outlet switched to `transport=meta` — exactly the Track A/B plan.

Its `balanceHistory` rows had **no reader** anywhere in the repo.

### 2.3 `bot-control-api/wallet-watch.js` — the real publisher, now the only one

Unchanged in role, changed in cost (§3).

---

## 3. Bug 2 — the publisher re-read everything, every minute

A pass cost 34 `.get()`s: `outletIndex` + one `walletBilling/{bid}/{oid}` per
outlet + one `walletGate` node per outlet.

The payload was only **6.5 KB**; RTDB's per-request framing made it **~29 KB**,
which is 40% of all remaining project egress — and it scales with outlet
count (5× at 100 outlets).

The fix is not to read *less*, it is to make *fewer round trips*:

- `walletBilling` and `outletIndex` are now held as **one live listener each**
  (one snapshot, then RTDB pushes only the deltas), so a steady-state pass
  costs 2 gate reads + 1 campaigns read.
- A failed or slow cache snapshot **aborts the pass** instead of publishing, so
  an outlet is never opened because its billing could not be read.

---

## 4. Bug 3 — the orchestrator downloaded the whole database at boot

`bot-control-api/orchestrator.js` discovered outlets by reading the **entire
`businesses` tree** — **3.06 MB** on 2026-11-10, growing with every outlet's
photos — on **every restart**, and bot-control-api had restarted 72 times.

The reconciler only needs four scalar leaves, and `outletIndex` (a few KB) plus
the ids pm2 already holds in each worker's spawn env cover the same outlets.

**It had to stay complete.** `outletIndex` is missing 13 tree outlets, and one
of them — the e2e tenant — is genuinely in scope (`whatsapp.status: 'active'`
AND `bot.source: 'orchestrator'`). An earlier registry-only attempt dropped
the reconcile count from 49 to 33 and would have silently stopped managing it;
that attempt was caught by the scope guard and replaced with the pm2-env
source. Live check after the fix:

```
outlets in the tree           : 49
discovered (registry + pm2)   : 39
in-scope outlets MISSED by discovery: 0
undiscovered outlets with no status  : 10      (never actionable)
```

The Admin SDK has **no `shallow()`** (that is a client-SDK `Query` method), so
a key-only tree scan is not available — the scope guard caught that too.

`readOutletState` also short-circuits: `whatsapp/status` alone decides scope
(`desiredState()` → `null` without it), so one read dismisses an outlet that is
not ours instead of four.

---

## 5. Live verification

### 5.1 The gate now holds (the whole point)

`padmavati-test/padmavati` — a registered test outlet with 0 orders, no bot and
no money. The only mutation was one boolean; the ledger was restored
byte-identically.

| Step | Expected | Result |
|---|---|---|
| Arm `wallet.enforce` | a non-empty gate is published | `closed` in **10 s** |
| Hold 150 s (2.5 passes) | a second writer would reopen it | still `closed` ✓ |
| Disarm | the gate is released | removed in **30 s** ✓ |
| Ledger | unchanged | **byte-identical** ✓ |

With `walletGateCheck` still deployed, step 2 would have failed within 60 s.

### 5.2 Egress, measured the same way

| | before batch 14 | after | |
|---|---:|---:|---:|
| `walletBilling/*` | 32,546 B | **0** | the publisher holds a listener |
| `outletIndex` | 12,684 B | **0** | registry + pm2 env |
| `businesses/*` | 35,570 B | 50,427 B | the bot's own listeners |
| **total** | **29.2 KB/min** | **12.3 KB/min** | **2.4× less** |
| **projected** | **41.1 MB/day** | **17.3 MB/day** | |

Cumulative against the original incident: **3.24 MB/min → 12.3 KB/min = 263×
less** (4.65 GB/day → 17.3 MB/day).

The remaining 12.3 KB/min is entirely `businesses/*` — the bot's own status,
pair, order and campaign listeners. That is the operational floor.

> Measurement note: `firebase database:profile --raw` aborts its own stream
> early ("Unexpected error from response stream"), so the window is the
> timestamps actually captured (162–240 s), not the requested duration. Two
> windows were contaminated by one-off diagnostic scripts run on the box
> (`bot/p38-payload.js` reads `menuBank`, `bot/backfill-analytics.js` reads the
> whole tree) — those appear as single reads over 20 KB and are excluded from
> the steady-state figures above.

### 5.3 Guards

| Guard | Result |
|---|---|
| `node bot-control-api/wallet-watch.js` (self-check) | OK — 3 listeners, steady pass reads no billing/index/orders, a billing delta re-arms, disarming releases only the orders mirror |
| `node tests/orchestrator-scope.check.cjs` | **16/16** (2 new: *boot never reads the businesses tree, only the four leaves*; *an outlet missing from outletIndex is still discovered from its pm2 worker*) |
| `node bot/tests/unit.test.js` | **28/28** (see §6) |
| `npm run test:encoding` | OK |
| `node tools/check-shared-twins.cjs` | 8/8 OK |
| `npm run test:server-branch` | OK |
| `firebase functions:list` | 12 functions — `walletGateCheck` and `onWalletUpdate` gone |

---

## 6. Drive-by fix: the bot guard was clock-dependent

`bot/tests/unit.test.js` failed for ~12 hours every day. The failing case calls
`checkAndConsumeCap(..., 'promo', ...)`, and promo pushes are **suppressed
during IST quiet hours (21:00–09:00)** — so between 21:00 and 09:00 IST the
assertion could never see the write it expected. It passed during the day and
failed at night, which is how it stayed unnoticed.

The test now pins the clock to a fixed afternoon instant around that one call.

---

## 7. Deliberate non-changes

- **The bot is untouched.** It does not read `walletGate` — it reads the
  wallet through `walletGateBlocks()`, which treats `low`/`closed` as blocking
  and everything else as open.
- **`walletBilling` stays server-only.** The publisher reads it with the Admin
  SDK; nothing about the trust boundary changed.
- **`GET /api/bot/status-all` still reads the whole tree** (~3 MB). It is behind
  `requireAuth`, so the deploy probe's 401 never triggers it, and the Fleet
  page no longer polls it. Fixing it would mean N small reads instead — worth
  it only if the Fleet page returns to polling.
- **`runDailySettlement` still reads the whole tree once a day** (23:00). Same
  reasoning: 3 MB/day against a 17.3 MB/day total.
- **`onOrderStatusChange`** (the remaining trigger) writes order timestamps,
  not the gate, and is left alone.

---

## 8. What is still on the table

| Item | Size | Note |
|---|---:|---|
| base64 still in `businesses` | **1.76 MB** / 90 fields | batch 13 migrated the live pizza outlet only; 7 outlets still hold images (demo 38 fields, `-p5aidfx…` 21, `-p5wn8ta…` 14+5, `padmavati-test` 7, `roshani-cake` 3, `roshani-pizza` 2) |
| base64 in `menuBank` | **705 KB** / 28 fields | the shared platform menu bank was never migrated |
| `businesses` tree | 2.89 MB | what is left after the base64 is removed |
| `roshani-pizza/pizza` still holds 2 base64 fields | — | batch 13 missed two paths |

The natural next batch is **13b: finish the media migration** — the same
`tools/migrate-media-to-storage.cjs` run against every remaining outlet plus
`menuBank`.

---

## 9. Files

| File | Change |
|---|---|
| `bot-control-api/wallet-watch.js` | `walletBilling` + `outletIndex` as listeners; a failed snapshot aborts the pass |
| `bot-control-api/orchestrator.js` | boot discovery from `outletIndex` + pm2 spawn env; `readOutletState` short-circuits on `whatsapp/status` |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/onWalletUpdate.ts` | **deleted** |
| `FIREBASE_SERVER_MIGRATION/functions/src/scheduled/walletGateCheck.ts` | **deleted** |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports removed, with a note not to re-add a second writer |
| `tests/orchestrator-scope.check.cjs` | +2 checks (no tree read at boot; an unregistered outlet is still discovered) |
| `bot/tests/unit.test.js` | the quiet-hours-dependent test now pins the clock |
