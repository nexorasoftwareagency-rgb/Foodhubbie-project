# Batch 23q — Promotions on Functions (PLAN, not yet built)

Status: **PLAN — awaiting owner decisions (§9) before implementation.**
Date: 2026-11-23
Supersedes: nothing. Closes the last `SEND_PROMOTION` row of `Pending-Work.md` §4a-2.

---

## 1. Why this batch exists

`bot/promotions.js` (707 lines) is the last piece of product logic that only runs on
the EC2 socket host. Everything else that is a **database effect** already runs on
Cloud Functions (orders, loyalty, stock, pushes, onboarding, settlement, demo
reseed, wallet gate, operator replies, inbound).

What that means today, with the box down since 2026-11-11:

| Admin action | What happens now | What should happen |
|---|---|---|
| Launch campaign (send now) | writes `campaigns/{id}` (`status:'running'`) + a `bot/commands` `SEND_PROMOTION` | a slice runner sends it |
| Schedule campaign | writes `campaigns/{id}` (`status:'scheduled'`, `runAt`) | picked up at `runAt` |
| Resume a paused campaign | writes `status:'running'` | resumed from `currentIndex` |
| Stop a campaign | writes `status:'stopped'` | **must actually stop** (see F2) |
| Kill switch / promo toggle | writes `bot/promotions/{killSwitch,enabled}` | honoured per send |
| Test send | `SEND_PROMOTION` with `isTest:true` | sends to the owner only, never billed |

Batch 23o deliberately left `SEND_PROMOTION` **untouched and unconsumed** — a stub
that "sends to everyone" is the top ban trigger and ignores consent. This batch
ports the real engine.

**Blocker that does not block this batch:** promos cannot be *delivered* until a
tenant has a real number (`whatsapp.phoneNumberId`). This batch ships flag-off and
is proven against a fake transport + the real Graph failure path (§8).

---

## 2. What the engine does today (parity source of truth)

`runPromotionCampaign(sock, cmd, ctx)` — `bot/promotions.js:314`

```
guard: isMetaTransport(sock)        else pause 'transport-blocked'
stamp isTest on the campaign doc
list = recipients.slice(0, 300)
audit PROMO_START
campaign: status=running, startedAt, totalSent=0, totalFailed=0
acquire outlet lock (bot/promotions/lock)   else status=aborted 'lock-conflict'
startIndex = campaign.currentIndex || 0
dailySentToday = bot/promotions/dailyCount/{IST date}
safeDailyLimit = warmup ladder from bot/pair/{oid}/firstLinkedAt
for i = startIndex .. list.length-1:
   bot/promotions/enabled === false      -> pause 'promo-disabled'
   bot/promotions/killSwitch === true    -> pause 'kill-switch'
   quiet hours active                    -> sleep in-process (5-min slices, kill-switch aware)
   socket dead / crypto errors > 100     -> pause 'session-degraded'
   every 25: re-acquire lock             -> pause 'lock-lost'
   dailySentToday >= safeDailyLimit      -> pause 'daily-limit'
   token balance <= 0 / unreadable       -> pause 'no-tokens' / 'balance-unreadable'
   invalid phone                         -> log skipped 'invalid-jid', failed++
   opted out (bot/promotions/optout/{10})-> log skipped 'opted-out'
   no consent (customers/{10}/promotionalConsent || app/consent/offers, app off wins)
                                         -> log skipped 'no-consent'
   frozen chat (in-memory 3-strike map)  -> log skipped 'frozen'
   personalize {name}{storeName}{phone}{lastOrderDate}{couponCode}
   greeting prefix "Hi <name>,"
   append menuText footer; pick mainImage / extraImage
   paceBurstSend()                       (1.5s in-process min gap)
   sendWithRetry(2 attempts, 5s apart)
     template first (name || PROACTIVE_TEMPLATE, body -> {{1}})
     blocked -> throw 'promo-blocked-cost-guard' (never counted as sent)
     template error -> text/image fallback
     STOP footer appended unless the shell already carries it as a template footer
   log result to bot/promotions/logs/{campaignId}/{phone}
   circuit breaker: >=10 samples, >35% failures -> pause 'high-failure-rate'
   on success: dailyCount++, token balance -1 (transaction, clamped >= 0), optional menu image
   every 10: campaign heartbeat (currentIndex, totalSent, totalFailed)
   every 30: 60-120s batch pause, else 8-15s
end: status=done, completedAt, strip inline media, audit PROMO_DONE
catch: status=stopped + error
finally: release lock
```

Scheduled pickup (`pickupScheduledPromotions`, 607) — `orderByChild('runAt').startAt(1).endAt(now)`,
`status === 'scheduled'` only, >15 min late → `expired` + strip media, else flip to
`running` and push a `SEND_PROMOTION` command.

Resume (`resumeStuckPromotions`, 573) — every `status === 'running'` campaign on
reconnect, re-dispatched from `currentIndex`; no recipients → `stopped`.

Expiry (`expireOldPromoLogs`, 649) — 30-day TTL on logs and terminal campaigns,
inline base64 media stripped after 24 h on `paused`/`stopped`/`aborted`.

---

## 3. The hard constraint: 540 seconds

Event-driven and scheduled v2 functions time out at **540 s**. A 300-recipient
campaign at the engine's own pacing is `300 × 11.5 s + 9 × 90 s ≈ 71 minutes`.
It cannot be one invocation.

Three options were considered:

| Option | Why not |
|---|---|
| One HTTP function with a 60-min timeout | still short of 71 min; nothing can reliably call-and-wait; no self-healing |
| Cloud Tasks fan-out (one task per recipient, `scheduleTime` = paced) | a new queue + IAM surface, and 300 tasks × 50 outlets is a billing/ops story of its own; the `enqueueTask` path was explicitly retired for inbound |
| **Bounded slices + persisted `currentIndex` + lease + sweep** | **chosen** — no new infrastructure, self-healing, and the same shape as `walletGateReconcile` |

---

## 4. Design

### 4.1 Three moving parts

```
Admin writes campaigns/{id} (status running|scheduled)
        |
        v
onPromotionStatus        leaf trigger on campaigns/{id}/status
        |                maintains meta/promotionsActive/{bid}/{oid}/{campaignId}
        |                = { status, runAt, nextAt, updatedAt }   (Admin-SDK only)
        v
onBotCommand             existing trigger, new SEND_PROMOTION branch
        |                deletes the command, runs slice 1 (low latency)
        v
promotionSweep           onSchedule('* * * * *'), maxInstances 1
                         reads meta/promotionsActive once (usually null, ~0 bytes)
                         runs one slice per due entry
        |
        v
bot/promotions-engine.js  the slice runner (socket-free, injected)
```

**Why a leaf listener on `status` and not the campaign node:** the runner writes
`currentIndex`/`totalSent`/`lastHeartbeat` on every send. A whole-node listener
would fire ~300 times per campaign and re-read the campaign each time (the batch-11
egress bug class). Status transitions happen 3–5 times per campaign.

**Why an index at all:** a per-minute sweep that queries every outlet's campaigns
node is 50 indexed queries/minute ≈ 14 MB/day of pure framing (batch 14 measured
34 `.get()`s = 6.5 KB payload billed as 29 KB). `meta/promotionsActive` is empty
when nothing is running, so an idle platform costs ~0 bytes.

### 4.2 The lease (one campaign per outlet, at a time)

The bot serialises campaigns with `bot/promotions/lock` (a campaignId with no TTL,
released in `finally`). A Function can be killed without running `finally`, so the
cloud lease carries a TTL:

```
meta/promotionsActive/{bid}/{oid}/lease = { campaignId, until, at }
```

Take it in a cold-seeded transaction: a live lease held by **any** campaign aborts
the slice (`reason: 'busy'`). Renewed **before every send** with
`until = now + 90 s`, so a killed slice is recoverable within 90 s and the next
sweep takes over. 300 renewals per campaign is a rounding error.

### 4.3 The slice

```js
runSlice(cmd, { budgetMs = 480_000, batchSize = 30 })
```

- Starts at `campaign.currentIndex`, sends at most `batchSize` recipients.
- Stops early when `elapsed >= budgetMs - PROMO_MAX_DELAY_MS` (never start a send
  that cannot finish).
- **Every rule from §2 is checked before each send**, in the same order.
- `currentIndex` is written **before** the send (claim-before-send, at-most-once —
  the 23o decision). A timeout loses at most the in-flight message; it never
  double-sends and never bills a message nobody received.
- On batch boundary (`batchSize` reached): write progress, set
  `nextAt = now + randomBetween(60s, 120s)`, release the lease, return.
  **The batch pause becomes the inter-slice gap — it costs zero function time.**
- On budget exhaustion: `nextAt = now + randomBetween(2s, 15s)`, release, return.
- Done: `status:'done'`, `completedAt`, strip inline media, `PROMO_DONE` audit.
- Any pause: `status:'paused'` + `pauseReason` + `currentIndex` + counters, release.
- Campaign `status` is re-read every 10 sends: **`stopped` aborts the slice** (F2).

### 4.4 Quiet hours become a deferral, not a sleep

The bot sleeps in-process for up to 8 hours. A Function cannot. Instead:

```
quietHoursState({start,end}, now) -> { active, untilMs }
```

- Active → write `waitingUntil` on the campaign, `nextAt = untilMs`, release the
  lease, return. Status stays `running` (it *is* running, just waiting).
- The sweep wakes it at `untilMs`.
- Admin shows one muted line on the card: "Waiting for quiet hours to end" (F6).

This is strictly better than the bot: a sleeping function would burn 8 hours of
compute for nothing.

### 4.5 Transport

`bot/promotions-engine.js` exports `sendPromoWithFallback(sock, jid, opts)` — the
exact template-then-text/image body currently inlined in `sendPromotionalMessage`
(`bot/promotions.js:76-132`), minus the socket/freeze/tracker checks which stay at
the call site. `bot/promotions.js` delegates to it (deleting its copy), and the
cloud passes `makeMetaTransport()` (which already implements `sendTemplate` with
`body → {{1}}` and the cost guard).

The engine receives:

```js
createPromotionsEngine({
  db, resolvePath, billingPath, outlet,
  sendPromo,                       // (jid, opts) -> {ok, error}
  isFrozen,                        // (phone) -> bool   RTDB in the cloud
  getStore, getCustomer,
  now, sleep, log, random,
})
```

**Nothing here imports `bot/firebase`, `bot/utils`, Baileys or `bot/index.js`** —
the 23b/23f/23g rule.

### 4.6 Pacing (unchanged)

`8–15 s` per message, `60–120 s` every 30, `300/day` cap, warmup ladder
`20→40→60→100→150→200→250` from `bot/pair/{oid}/firstLinkedAt`.

The Admin guide already tells owners these numbers (`promotions-guide.js:32`), and
they are the documented anti-ban posture. Keeping them means **zero behaviour
change** and no copy update. Wall clock for 300 recipients: ~70–90 min (the bot
takes ~71 min), spread over ~10 slices.

`paceBurstSend()` (1.5 s in-process) is a no-op in a request-scoped runtime and is
not called — the 8–15 s delay subsumes it.

---

## 5. Parity matrix

| # | Bot rule | Cloud | Test |
|---|---|---|---|
| 1 | `isMetaTransport` else pause `transport-blocked` | transport is always Meta; missing number → pause `no-number` | E2E |
| 2 | `isTest` stamped, never billed | same | harness + E2E |
| 3 | recipients capped 300 | same | harness |
| 4 | `PROMO_START` / `PROMO_DONE` audit | same | E2E |
| 5 | outlet lock | lease (90 s TTL, renewed per send) | harness |
| 6 | resume from `currentIndex` | same, plus slice boundaries | harness + E2E |
| 7 | warmup daily limit | `warmupDailyLimit()` shared | harness |
| 8 | `dailyCount/{IST date}` | same | E2E |
| 9 | `enabled` toggle → `promo-disabled` | same | E2E |
| 10 | kill switch → `kill-switch` | same | E2E |
| 11 | quiet hours → sleep | → defer to `untilMs` (F3) | harness + E2E |
| 12 | socket dead → `session-degraded` | n/a (no socket); transport error → failure path | — |
| 13 | lock lost → `lock-lost` | lease lost → `busy`, slice aborts | harness |
| 14 | daily limit → `daily-limit` | same | E2E |
| 15 | token balance → `no-tokens` / `balance-unreadable` | same, read once per slice and decremented locally | E2E |
| 16 | invalid phone → `invalid-jid` | same | harness |
| 17 | opt-out → `opted-out` | same (read the optout node once per slice) | E2E |
| 18 | consent → `no-consent` | same rule, incl. app-off-wins | E2E |
| 19 | frozen → `frozen` | RTDB `bot/chatState/{10}/frozenUntil` (23o pattern) | E2E |
| 20 | personalization tokens | same (store read cached per slice) | harness |
| 21 | greeting prefix | same | harness |
| 22 | menu footer + extra image | same | E2E |
| 23 | template first, `blocked` → cost-guard pause | same (`makeMetaTransport`) | E2E |
| 24 | STOP footer unless shell carries it | same (`TEMPLATES_WITH_STOP_FOOTER`) | harness |
| 25 | 2 attempts, 5 s apart | same | harness |
| 26 | per-recipient log row | same | E2E |
| 27 | circuit breaker 10 samples / 35% | same | E2E (Graph 100 on a placeholder number) |
| 28 | `totalSent`/`totalFailed` (F8: zeroed on every resume) | **accumulated** across slices, never zeroed | E2E |
| 29 | scheduled pickup, 15-min grace → `expired` | sweep, same grace | E2E |
| 30 | 30-day log/campaign TTL, media strip | sweep, daily | harness |
| 31 | **stop is decorative (F2)** | **honoured** | E2E |

---

## 6. Findings (real defects found while planning)

**F1 — `cryptoErrorCount` is passed by value and is always 0 at campaign start.**
`bot/index.js:512` passes `cryptoErrorCount` in the ctx object; `runPromotionCampaign`
destructures the number and compares it inside the loop. A primitive copy never
updates, so the `cryptoErrorCount > 100` half of the `session-degraded` guard has
never fired. Only `isSocketDead(sock)` works. Not ported (no socket).

**F2 — "Stop campaign" does not stop a running campaign.**
`Admin/js/features/promotions.js:741` writes `status:'stopped'`, but the bot's loop
never re-reads the campaign status: it keeps sending, then overwrites the doc with
`status:'done'`. A stop during a 300-recipient campaign has been cosmetic. The cloud
runner re-reads `status` every 10 sends and aborts. This is a **user-visible fix**,
worth a line in the release note.

**F3 — quiet hours sleep inside the process.** Up to 8 hours of blocked execution,
kill-switch-polled every 5 minutes. A deferral is equivalent and free.

**F4 — two dead constants**: `PROMO_PAUSE_MS` (30 s) and
`PROMO_SOCKET_DEAD_GRACE_MS` (5 s) are declared and never read. Deleted.

**F5 — `bot/commands` accumulates one `SEND_PROMOTION` node per campaign.** 23o
leaves them untouched by design. The cloud branch deletes the command (the campaign
doc is the source of truth and carries every field), so the queue stops growing.

**F6 — a `running` campaign waiting for quiet hours looks stalled.** One muted line
on the card fixes it.

**F7 — margin.** A marketing message costs **₹0.8631** on Meta India; the token
price is **₹1.00**. Gross margin per delivered promo is **₹0.137 (13.7 %)** — a
300-recipient campaign nets ₹41 before function/RTDB cost (~₹0.20). Stated here so
the rate card is not mistaken for profit. Not changed by this batch.

**F8 — a resume resets the campaign counters.** `runPromotionCampaign` writes
`totalSent: 0, totalFailed: 0` on entry (`bot/promotions.js:346-348`) and then
reports only the current session's locals. Resuming a campaign that paused at
recipient 150 shows `totalSent` starting again from 0, so the Admin card
under-reports. **Load-bearing for the cloud design**: every slice is a resume, so
the slice runner must *accumulate* — `totalSent = Number(doc.totalSent||0) + sent`
— and never zero the doc. Same fix applied to the bot path (it is a one-line change
in the same file this batch already touches).

---

## 7. Files

| File | Change |
|---|---|
| `bot/promotions-rules.js` | **NEW** — pure constants + `warmupDailyLimit`, `quietHoursState`, `failureRateExceeded`, `hasInlineMedia`, `campaignAgeMs`, `normalizeRecipient`, `PAUSE_REASONS`, `istDateStr`. Requires nothing. |
| `bot/promotions-engine.js` | **NEW** — `createPromotionsEngine(...)`, `runSlice`, `sendPromoWithFallback`, `expireOldPromoLogs`. Requires nothing (injected). |
| `bot/promotions.js` | delegate `sendPromotionalMessage` to `sendPromoWithFallback`; delete F4 constants. Loop unchanged (legacy Baileys path). |
| `bot/index.js` | `isPromotionsRelayEnabled()` (30 s cache, `catch → false`); gate the `SEND_PROMOTION` branch (return **before** `snap.ref.remove()`), `pickupScheduledPromotions`, `resumeStuckPromotions`, `expireOldPromoLogs`. |
| `functions/src/triggers/promotionRelay.ts` | **NEW** — `onPromotionStatus` (index maintenance) + `runSliceFor`. |
| `functions/src/triggers/botCommands.ts` | new `SEND_PROMOTION` branch (own flag, delete-then-run). |
| `functions/src/scheduled/promotionSweep.ts` | **NEW** — `onSchedule('* * * * *')`, `maxInstances: 1`, slice dispatch + daily expiry. |
| `functions/src/shared/promotions/factory.ts` | **NEW** — `makePromotionEngine(bid, oid)`, `makePromotionTransport(bid, oid)` (returns null when no number). |
| `functions/scripts/copy-vendor.cjs` | +2 modules (`promotions-rules.js`, `promotions-engine.js`). |
| `functions/src/index.ts` | export the two new functions. |
| `Admin/js/features/promotions.js` | `PAUSE_REASON_SHORT/FULL` +`no-number`; `waitingUntil` line (F6). |
| `Admin/sw.js` | bump (any Admin JS change). |
| `tests/promotions-cloud.check.cjs` | **NEW** guard (§8). |
| `package.json` + `.github/workflows/ci.yml` | `test:promotions-cloud` + CI step. |

**No `database.rules.json` change.** `meta/*` is default-deny (Admin SDK only);
`bot/promotions/*` already grants admins and has `.indexOn ["status","runAt"]`;
`campaigns/{id}` has no `.validate`, so `waitingUntil` needs no rule.

---

## 8. Verification

### 8.1 Guard — `tests/promotions-cloud.check.cjs`

Behaviour (real engine against an in-memory RTDB + a fake transport):
1. slice sends exactly `batchSize`, writes `currentIndex`, sets `nextAt` in 60–120 s
2. `currentIndex` is written **before** the send (claim-before-send)
3. resume starts at `currentIndex`, never at 0
4. lease: a live lease held by another campaign aborts (`busy`); an expired lease is taken
5. `stop` (status `stopped`) aborts within 10 sends
6. opt-out / no-consent / frozen / invalid-jid skip without consuming a token
7. consent: app `offers === false` wins over `promotionalConsent === true`
8. daily limit pauses with `daily-limit`; token balance 0 pauses `no-tokens`; unreadable pauses `balance-unreadable`
9. quiet hours defer (`waitingUntil`, no send) and wake after `untilMs`
10. circuit breaker pauses `high-failure-rate` after 10 failures
11. cost-guard block pauses `meta-cost-guard` immediately
12. `isTest` never decrements a token and never writes `dailyCount`
13. warmup ladder day 0/3/9/30 → 20/100/250/300
14. done strips inline media, writes `PROMO_DONE`

Source pins: leaf listener on `status`, `meta/promotionsActive` only, demo skip in
all three functions, one flag `config/promotionsRelay/enabled === true`, bot gates
the **branch** and not the listener, no `businesses` tree read, pacing constants
identical to `bot/promotions.js`, `STOP` footer set identical.

### 8.2 Live E2E (e2e tenant, flag on only for the run, then restored to absent)

- flag absent → nothing runs (campaign stays `scheduled`/`running`, index untouched)
- demo tenant → skipped in all three functions
- no `whatsapp` node → pause `no-number`, **no** token decrement
- temporary `whatsapp` node with the placeholder phone id → Graph **code 100 /
  subcode 33** → failures counted, 10 failures → pause `high-failure-rate`
  (this proves the real Graph leg and the circuit breaker without a real number)
- 5 recipients, `sliceBudgetMs: 20000` → ≥2 slices, `currentIndex` monotonic,
  `nextAt` respected, no duplicate log rows
- consent / opt-out / frozen / invalid-jid skips → `logs/{campaign}/{phone}.reason`
- kill switch mid-campaign → pause `kill-switch` at the next check
- stop mid-campaign → slice aborts, no further log rows
- scheduled campaign with `runAt` in the past (< 15 min) → runs; 20 min late → `expired` + media stripped
- `waitingUntil` set when quiet hours are active, no sends
- token balance 3 → 3 sends → pause `no-tokens`
- every fixture restored byte-identically; `config/promotionsRelay` removed

### 8.3 What cannot be proven here

- **Real delivery** — needs a real `phoneNumberId` on the WABA (owner blocker).
- **Meta quality rating / messaging-limit tier behaviour** — only observable with
  live traffic over days.
- **Real per-message marketing billing** — `metaUsage` is recorded from our own
  rate table, not from an invoice; reconcile with the BigQuery export (batch 21)
  once a number is live.

---

## 9. Owner decisions requested

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Pacing**: keep 8–15 s / 60–120 s every 30, or tighten for speed? | **Keep.** Meta's throughput is 80 msg/s; the pacing exists to protect quality rating, and a new number has no history. Wall clock ~70–90 min for 300. |
| D2 | **One campaign per outlet at a time** (the bot's global lock)? | **Keep serial.** Two concurrent campaigns double the report rate on one number. |
| D3 | **Quiet hours**: defer (wake at `untilMs`) instead of sleeping? | **Yes.** Equivalent outcome, zero idle compute, and a Function cannot sleep 8 h. |
| D4 | **`config/promotionsRelay` knobs** `sliceBudgetMs` (default 480 000) and `batchSize` (default 30), clamped. | **Yes** — needed for the live E2E and for ops tuning. Pacing itself stays fixed so ban safety cannot be weakened. |
| D5 | **`no-number` pause reason + "waiting for quiet hours" card line** (small Admin change). | **Yes.** Without it a campaign on an unconnected outlet shows a raw slug or nothing. |
| D6 | **Delete the bot's `bot/commands` listener** now that `SEND_PROMOTION` is cloud-owned? | **Not in this batch.** It has zero remaining writers, but deleting it belongs to the EC2 prune (M3) where it can be verified on the box. |
| D7 | **Ship flag-off** (`config/promotionsRelay` absent) and flip when a number exists? | **Yes.** Identical to 23o/23p: deployed surface, zero live behaviour change. |

---

## 10. Rollout

1. Deploy `functions:onPromotionStatus,onBotCommand,promotionSweep` (surface 38 → 40).
2. `config/promotionsRelay` stays **absent** → all three no-op; the bot keeps its branch.
3. When a tenant has a real `whatsapp.phoneNumberId`:
   `config/promotionsRelay = { enabled: true, by: '<owner>', doc: '47' }`.
4. First real campaign: watch `bot/promotions/logs`, `walletBilling/.../metaUsage`,
   and the Meta quality rating for 24 h.
5. Only then consider tightening pacing (D1) or raising the 300 cap.

## 11. Deletion-list impact

After this batch, `bot/commands` has **no** live writer and the bot's listener has
**no** live job. That removes the last blocker on the EC2 prune (`PLAN/BACKEND-ARCHITECTURE.md`
§9, M3) *from the promotions side*; the socket itself still needs the box.
