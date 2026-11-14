# 31 - Website signup auto-approval + 72 h unverified cleanup (batch 23d-4)

Date: 2026-11-13. Follows 23d-3 (`30_ONBOARDING_ON_FUNCTIONS.md`). The box is
still down (`23_BOX_OFFLINE_INCIDENT.md`, `node tools/check-box-live.cjs` exit
1), so this batch moves the two **background** onboarding jobs that lived in
`bot-control-api/server.js`.

## 1. What was left behind, and why it matters

`server.js` ran two jobs that have nothing to do with WhatsApp or pm2:

| job | what it did | what breaks while the box is down |
|---|---|---|
| `startAutoApproval()` | an RTDB `child_added` listener on `onboardingRequests` approve the fresh website signups automatically (15 min window, hourly cap 20) | every website signup stays `pending` for ever — the public "open your restaurant" journey dead-ends at the form even though the Supabase/Auth half succeeded |
| `runUnverifiedCleanup()` | once a day, delete an auto-onboarded tenant whose owner never verified the admin email after 72 h | the address stays taken; a real owner cannot re-register with it |

Both are `approveOnboardingRequest()` consumers, so 23d-3 had already moved the
approval core. This batch adds a scheduler around that same function — it does
not re-implement approval, and the guard fails if it ever tries to
(`the watcher reuses the endpoint approval core`).

Discovered while writing it: **the box has been down since 2026-11-11 20:03
IST, and no website signup happened during the outage** (0 pending requests at
deploy time). So nothing was stranded; the watcher arrived before the next
signup.

## 2. Polling, not a trigger

`onSchedule('*/2 * * * *')` polls `onboardingRequests` where
`status == 'pending'` through the existing `.indexOn: ["status"]`.

An `onValueCreated`/`onValueWritten` trigger was rejected on purpose: **RTDB
triggers do not replay events that happened while the function was cold,
deploying, or failing.** A signup written in that window would sit pending for
ever — exactly the bug this batch exists to remove. A poll re-reads the truth
every tick, so it is self-healing. The cost is one indexed query per 2 minutes
(and only `pending` rows are read); nothing else in the request node is
downloaded.

The worst-case approval delay is one tick (~2 min) instead of the control API's
2 s `setTimeout`. Acceptable for a signup, and the applicant's browser shows
"we're setting up your dashboard".

## 3. Ported guards (same behaviour as the control API)

| guard | behaviour |
|---|---|
| freshness | `|now - createdAt| <= 15 min`; older requests (including the pre-cutover backlog) stay `pending` for a human |
| source | `source === 'website'` only |
| hourly cap | default **20**, rolling hour; over-cap requests stay `pending` and produce exactly **one** "needs manual review" inquiry |
| duplicate login email | the approval core's 409 `already exists` → request `rejected` with `rejectReason: 'This login email is already registered.'`, `reviewedBy: 'auto-onboarding'`; the stranger's Auth account is never touched |
| signup account gone/rotated (422) | left `pending`, retried next tick |
| anything else | left `pending` + one deduped "needs manual review" inquiry naming the real error |
| ordering | oldest `createdAt` first, so a signup submitted earlier wins the cap slot |
| success | one inquiry (`New restaurant: …`) exactly like the control API: `type:'New restaurant signup'`, `source:'website'`, numeric `createdAt`, capped strings, `phone` falls back to `0000000000` |

## 4. The new part: state that used to live in the process

A Cloud Function has no process between invocations, so three things the control
API held in memory or in a Date stamp now live in RTDB under
`meta/onboardingAuto/**`:

| key | purpose |
|---|---|
| `enabled` | kill switch. `false` = evaluate **nothing**: no approval **and no cleanup** (a request added while disabled is simply picked up when re-enabled). Use `maxPerHour: 0` to pause only the approvals |
| `maxPerHour` | the cap; absent = 20. `0` = approve nothing and notify |
| `recent` | the rolling-hour approval timestamps (pruned on read) |
| `claims/{reqKey}` | a 10-minute retry-safe claim so two passes cannot both approve; released in a `finally`, the TTL only covers a crash |
| `notices/{reqKey}` | one marker per request so over-cap/failure notices are not repeated every 2 minutes |
| `cleanupAt` | the 24 h gate for the cleanup pass |
| `lastRun` | the last pass summary (also the observable tick marker used by the E2E) |
| `cleanupEnforce` | `true` turns the 72 h cleanup from observe into delete |

**Deliberately not on the request row.** `onboardingRequests/$reqId/$other` is
`.validate: "false"`, so writing an `autoClaimAt` field onto a request would
make every later Supreme client write (approve/reject/expire) invalid at the
rules layer. The claim mechanism is unchanged; only its location moved.

## 5. The 72 h cleanup

Port of `runUnverifiedCleanup`:

* candidates = approved requests with `reviewedBy === 'auto-onboarding'`, a
  stamped `bid`/`oid`, `reviewedAt` at least 72 h ago, **no order**, **no
  payment**, and an owner Auth user that is not verified;
* the demo tenant (`foodhubbie-demo`) is never a candidate; a verified owner
  always keeps the tenant; a request whose tenant is already gone is just marked
  `expired` (row hygiene, not a delete decision);
* deletion = Auth user, its `admins` mirror **only while it still points at this
  tenant**, `outletIndex/{oid}`, the outlet (or the business when it is its last
  outlet), then the request becomes `expired` / `Unverified after 72h`;
* runs at most once per 24 h (`cleanupAt`);
* **ships in observe mode**: it counts and logs candidates and deletes nothing
  until `meta/onboardingAuto/cleanupEnforce === true` (or the deploy sets
  `ONBOARDING_CLEANUP=enforce`). This is the same default as the control API and
  the reason the two live candidates below still exist.

### The two real candidates (left in place on purpose)

The first live tick reported `candidates: 2, deleted: 0`:

| request | tenant | age at probe | state |
|---|---|---|---|
| `-P5AIChS2xAvAjsuXNkB` | Apex Public School / apex-anjani | 343 h | unverified, locked, 0 orders, 0 payments |
| `-P5wLctHJt_-9WpZSs3o` | Tested by Nilesh / tested 1 | 115 h | unverified, locked, 0 orders, 0 payments |

The third auto-onboarded request (`-P5wN7u73SxRQk0meaam`, "Email Test 1") is
**verified**, so the cleanup correctly skips it. Flipping
`cleanupEnforce` would delete the two real tenants, so that is an **owner
decision**, not a deploy side effect. Observe mode stays on.

## 6. What is deployed

| item | value |
|---|---|
| function | `onboardingWatcher` (us-central1, 256 MiB, 120 s, nodejs22, `maxInstances: 1`, `schedule '*/2 * * * *'`, `timeZone Asia/Kolkata`, secret `FIREBASE_DATABASE_URL`) |
| rules/RTDB | no change — `meta/onboardingAuto` is Admin-SDK-only (not readable/writable by any client) |
| `functions:list` | 18 v2 |

`maxInstances: 1` keeps the cap window single-writer; the claim transaction is
the belt for the case where a pass overruns and two instances overlap.

## 7. Live verification

`%TEMP%/opencode/e2e-23d4-watcher.cjs` waits for the **real schedule** (no
manual invocation, no mock): after every fixture write it settles 4 s, reads
`meta/onboardingAuto/lastRun/at` as the marker, and waits for a tick whose `at`
is greater — a tick that started after the write, so it must have seen the
fixtures. Six ticks, ~14 minutes. Every fixture is restored in a `finally`,
including `meta/onboardingAuto`, `meta/outletCounter`, the pinned request rows
and the throwaway Auth users.

**Result: 55/55 PASS.** (Run 1 was 54/55; the single failure was the harness's
wallet oracle, not the watcher — see §8. After the fix the same suite ran clean
against the deployed function.)

| phase | tick summary (real, from `lastRun`) | proven |
|---|---|---|
| A | `approved:[valid]`, `rejected:[dupe]`, `failed:[ghost 422]`, `pending:5`, `skipped:2` | tenant created **locked**, `adminLogin` email+`updatedAt` only, `outletNo` from the counter, `whatsapp.status:'pending'`, `discountApproval:false`, wallet defaults on the **server-only** `walletBilling` (canonical-equal to `getBillingDefaults()`), `outletIndex`, owner mirror, counter +1, claim released, `recent` recorded, exactly one success inquiry with rule-legal fields; duplicate email → `rejected` with the control-API reason and **no** `bid` stamp; 40-min-old, `source:'admin'` and ghost-account requests all stay `pending`; the 422 writes no inquiry |
| B | `enabled:false`, `pending:1`, `skipped:1` | the kill switch approves nothing; a perfectly valid fresh signup stays `pending` |
| C | two ticks, `cap:0`, `overCap:[capped]` | cap 0 leaves it `pending`; one `notices/{key}` marker; exactly one cap inquiry; the second tick does **not** duplicate either |
| D | `cleanup:{ran:true, enforce:false, candidates:1, deleted:0}` | observe mode counts the synthetic unverified tenant and deletes nothing; a verified owner and a tenant with an order are never counted; `cleanupAt` re-stamped |
| E | `cleanup:{ran:true, enforce:true, candidates:1, deleted:1}` | only the unverified synthetic tenant is deleted (business, `outletIndex`, `admins` mirror, Auth user) and its request becomes `expired` / `Unverified after 72h`; the verified owner, the tenant with an order, and the two **real** (temporarily pinned) tenants all survive |

The two real candidates are pinned out of scope for phases D/E by swapping
`reviewedBy` to `e2e-pinned` (restored byte-identically afterwards), so a bug in
the cleanup code could never delete a real tenant during the test.

Post-run: all five `meta/onboardingAuto` keys restored, `meta/outletCounter`
restored, no fixture request/tenant/Auth user/admin mirror/inquiry left, the
real candidates back to `reviewedBy: 'auto-onboarding'`, `menuBank` untouched.

### The total kill switch (re-checked after the fix)

The `enabled:false` gate (§8) was the only code change made after the 55/55 run,
so it got its own two-tick live check against the **re-deployed** function —
`%TEMP%/opencode/e2e-23d4-killswitch.cjs`, **15/15 PASS**:

| tick | state written | proven |
|---|---|---|
| K1 | `enabled:false`, `cleanupEnforce:true`, no `cleanupAt` gate, one qualifying candidate (80 h old, no order, no payment, real Auth user, `outletIndex`, admin mirror) | the pass runs with `enabled:false` but reports `cleanup:{ran:false,enforce:true,candidates:0,deleted:0}`; tenant, `outletIndex`, Auth user and request row all survive; `cleanupAt` is **not** stamped |
| K2 | `enabled:true` (same candidate, same enforce flag, gate still open) | the next tick runs the cleanup and deletes **exactly** that tenant: business, `outletIndex`, Auth user and admin mirror gone, request `expired` / `Unverified after 72h`; the real candidates (pinned for the run) untouched |

`meta/onboardingAuto` was restored byte-identically (all five keys) and every
fixture removed. K1 and K2 together are the proof that matters: K1 alone could
be a broken candidate test, K2 alone could be the old behaviour — only the pair
shows the switch is what decides.

## 8. Details the live runs settled

* **`lastRun` is the tick marker.** Every pass writes `meta/onboardingAuto/lastRun`
  with `at` = pass start; that is the only reliable way to prove *which* tick
  consumed a fixture. An assertion based on wall-clock waiting is flaky because
  the schedule drifts a few seconds.
* **RTDB drops empty arrays.** A summary with no approvals simply has no
  `approved` key. Read it as `Array.isArray(v) ? v : []` — an assertion on
  `.length` of `undefined` fails otherwise.
* **The wallet assertion needs a canonical compare.** Two traps, both in the
  harness rather than the product: `getBillingDefaults()` stamps **three**
  timestamps (`setup.date`, `tokens.updatedAt`, `tokenPacks.welcome.grantedAt`)
  and RTDB returns object keys **alphabetically** while the module emits them in
  source order. Comparing `JSON.stringify(wallet)` with
  `JSON.stringify(getBillingDefaults())` can therefore never match. The live
  node was proven identical under a recursively sorted compare with the three
  dates removed (and with each date asserted as an ISO string) — the deployed
  function really writes exactly the module's output.
* **The ghost account is a silent retry.** The control API retried a 422 four
  times (3/10/30/90 s) and then raised a "needs manual review" inquiry. A 2-min
  poll is already the retry, so this port leaves the request `pending` and
  silent: it stays visible in Supreme's Pending list, and once it ages past
  15 min it is skipped like any other stale request. Recorded as a deliberate
  deviation, not a bug.
* **`409 'This login already belongs to another outlet.'` is not the reject
  branch.** The watcher terminalises only the duplicate-*email* 409 (matched on
  `already exists`, exactly like the control API). The "belongs to another
  outlet" 409 falls into the generic path and leaves the request `pending` for a
  human — which is the safer outcome for an account that may be a real,
  already-active owner.
* **A claim is released even when approval throws.** `finally` removes
  `claims/{key}` on success, rejection, 422 and unexpected errors, so the next
  tick can retry immediately; only a hard crash leaves the 10-min TTL to
  expire.
* **The kill switch was not total at first, and that was a real hole.** The
  first build ran `runCleanup()` on every pass regardless of `enabled`, so an
  operator who set `enabled:false` during an incident would stop approvals while
  a cleanup armed with `cleanupEnforce:true` kept deleting tenants once every
  24 h — the exact opposite of what a single "off" switch promises. Fixed before
  the batch was committed: `enabled:false` now skips both (the summary still
  reports `cleanup:{ran:false,enforce:<flag>,candidates:0,deleted:0}`), and
  `maxPerHour:0` is the documented knob for "pause approvals, keep the cleanup
  schedule". The guard pins the gate
  (`enabled:false also stops the cleanup`). Found by reading the code against
  this document, not by a test — the E2E's phase B never asserted cleanup
  behaviour because the 24 h gate made `ran:false` in that pass anyway.

## 9. Honest limits

* **Cleanup is observe-only until an owner says otherwise.** Two real unverified
  tenants (343 h and 115 h) are candidates right now. Deleting them is a
  business decision: flip `meta/onboardingAuto/cleanupEnforce` to `true` (the
  next tick inside the 24 h gate deletes them) or leave observe mode.
* **There is no dry-run mode.** An approval creates a real tenant, so a
  `dryRun` flag on the pass was written, reviewed and **removed**: any code path
  that can approve must never be reachable from a "rehearsal". The only safe
  rehearsal is `meta/onboardingAuto/enabled:false` (nothing approves) plus the
  cleanup's observe mode, which is what the E2E uses for its negative phases.
* **The control-API copy still exists.** `server.js` keeps
  `startAutoApproval`/`runUnverifiedCleanup` until the box is back and 23d
  finishes; the two would then race. Turn the control-API copy off (env
  `ONBOARDING_AUTO_APPROVE=off`, `ONBOARDING_CLEANUP` unset) when the box
  returns, or delete it with the rest of the onboard-side job.
* **The watcher cannot create an Auth account.** It only adopts `authUid` from a
  browser signup (or replays a legacy password). A request without a signup
  account is a 422 forever, by design.
* **One pass is bounded by the 120 s timeout.** A hundred pendings in one tick
  would not finish; `maxInstances: 1` means the next tick starts after the
  current one, and the cap (20) keeps the realistic workload far below that.
* **No WhatsApp/bot involvement.** Nothing here touches the Baileys worker, so
  it does not change `24_WHATSAPP_OFF_EC2_DEPENDENCY.md`.

## 10. Files

* `FIREBASE_SERVER_MIGRATION/functions/src/scheduled/onboardingWatcher.ts` —
  `runOnboardingWatcher()`, `claimRequest()`, `notifyOnce()`, `pushInquiry()`,
  `runCleanup()`, the scheduled export.
* `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` — exports
  `onboardingWatcher` next to `platformHealth`.
* `tests/functions-source.check.cjs` — 141 checks (was 117): the 23d-4 block
  cross-checks the inquiry payload against the **live** `inquiries/$id` rule
  keys, and pins the claim/notice/cap/cleanup gates, the total kill switch and
  the absence of bookkeeping fields on the request row.
* Harness: `%TEMP%/opencode/e2e-23d4-watcher.cjs` (6 real schedule ticks).
