# 36 - Rider assignment / status pushes moved to Functions (batch 23h)

The last push path that still touched the EC2 worker was the rider one. The box
has been offline since 2026-11-11, so a rider could be assigned an order and
never be told, and a rider waiting to collect heard nothing when the kitchen
marked it ready or the order was cancelled. Both sends were pure Admin SDK + FCM
inside the bot's `orders` `child_changed` listener — no socket, no pm2 — so they
belong in the cloud like the admin/customer/tier-up sends that moved in 23e.

## 1. What moved

`bot/index.js` used to hold three things:

1. `sendFCMToRider(riderId, title, body, data, outlet)` — read
   `riders/{uid}/fcmToken`, send a **data-only** message (the rider app's own
   `/sw.js` builds the notification: custom tag/vibrate + deep link; a
   `notification` payload would make the SDK auto-display a second, untagged
   popup), prune the token on a per-token FCM failure and stamp
   `fcmTokenInvalidAt`.
2. Two copies of the same email → UID resolution block (order assignment and
   status change), where `order.riderId` is either a Firebase UID (rider app) or
   the email the admin picker stored.
3. The copy strings for `assigned`, `ready|packed|cooked`, `cancelled`.

All three now live in **`bot/rider-push.js`** — socket-free, dependency-injected
(`createRiderPush({db, resolvePath, getRiderByEmail, isDeadPushCode, messaging,
formatOrderId, log})`) exactly like `order-finalizer.js` (23b/23f) and
`loyalty-engine.js` (23g). `copy-vendor.cjs` copies the file byte-for-byte into
`lib/vendor/bot/`, and the predeploy guard asserts the vendored copy loads and
still maps `cooked → ready`, so the two runners cannot send different text.

## 2. Two triggers

| trigger | listens on | fires |
|---|---|---|
| `onRiderAssigned` | `businesses/{bid}/outlets/{oid}/orders/{orderId}/riderId` | an order is assigned a rider → "New Order Assigned!" |
| `onRiderStatus` | `businesses/{bid}/outlets/{oid}/orders/{orderId}/status` | `ready` / `packed` / `cooked` → "ready for pickup"; `cancelled` → "has been cancelled" |

Both `onValueWritten`, `us-central1`, 256 MiB, 60 s, nodejs22, with
`FIREBASE_DATABASE_URL` in `secrets`. The tenant is pinned **from the event
path** (`businesses/${bid}/outlets/${oid}`) in
`shared/rider/factory.ts` — never a reverse-index guess, because the e2e business
holds an outlet literally named `pizza`.

## 3. The one switch

`config/riderRelay/enabled === true` means the Functions own the pushes. The bot
reads the same flag through `isRiderRelayEnabled()` (30 s in-process cache, since
the rider branch runs on every order change) and returns early from its rider
branch — it still tracks `orderState`, it just never sends.

Only an explicit `true` enables either side. Absent, `false`, a string, or an
unreadable path means the bot keeps its old behaviour **and** both triggers are
no-ops, so a failed flag read can never make both senders fire. This is the same
kill-switch contract as 23e/23f/23g.

## 4. At-most-once is durable, not in-memory

The bot kept its "already pushed" state in `orderState` — a `Map` — so a process
restart lost it and every replay pushed again. The triggers keep the marker on
the order node instead:

| path | shape | meaning |
|---|---|---|
| `_riderFcm/assigned` | `{rider, at, by}` | transaction claims only when the recorded rider differs from the one in this event |
| `_riderFcm/status` | `{status, at, by}` | transaction claims only when the recorded status differs from the one in this event |
| `_riderFcm/last` | `{event, uid, sent, reason, at, by}` | what the most recent push actually did |

`_riderFcm/last` exists for support: "did the rider actually get told?" — it is
also the only live evidence that an **email** riderId resolved to a real UID.
A lost claim is a silent no-op. A send failure is recorded and never retried:
the bot never retried either, and a duplicated "your order is ready" is worse
than a missed one.

## 5. Deliberate deviations from the bot (all recorded, none accidental)

1. **Leaf listeners, not the whole order node.** The bot listened on
   `orders/{id}` `child_changed`, so every unrelated stamp (`_fcmSent`,
   `finalizeClaim`, `stockDeducted`, `paymentStatus`, KOT) ran the rider branch.
   The triggers listen only on the two leaves that can produce a rider event, so
   an unrelated write cannot even wake a rider sender.
2. **An order created already carrying a rider now pushes.** The bot's
   `child_added` only recorded `orderState`; assignment only pushed when
   `riderId` changed later. A dashboard or app order that arrives with the rider
   already set used to be silent.
3. **A WhatsApp JID in `riderId` is skipped, not used as an RTDB key.** WhatsApp
   rider pushes (`bot/rider.js`) still ride the socket; the FCM path used to
   build `riders/9199…@s.whatsapp.net/fcmToken`, which RTDB rejects (a key may
   not contain `.`), so every such order threw inside the guarded send and
   logged. It is now a clean `not-a-device-rider` no-op.
4. **An unresolvable email is dropped**, not used as the path key (same reason).
   Old code fell back to `rider?.uid || riderUid` and then threw.

## 6. What is deployed

```
firebase deploy --only functions:onRiderAssigned,functions:onRiderStatus
```

Both created; `firebase functions:list` reports **28 v2 functions**, both new
ones with `google.firebase.database.ref.v1.written` at 256 MiB / nodejs22.
Deploying alone changed no behaviour: `config/riderRelay` did not exist yet, so
both triggers were no-ops and the (already stopped) bot was irrelevant.

The demo tenant is hard-skipped in both triggers: the nightly reseed writes ~353
fake orders with seeded riders and none of it should reach a device.

## 7. Live verification — 20/20

`%TEMP%/opencode/e2e-23h-rider-relay.cjs` on the **e2e tenant** with a synthetic
rider (`e2e23h-rider-<ts>`, email `e2e23h.<ts>@example.com`) and a **synthetic**
FCM token. Safety: no order carries a `phone` (the 23e customer push cannot
fire), every order is `source:'QR'` (the 23f finalizer must ignore it) and
`_fcmSent:true` (the 23e admin alert cannot page a real device). The token is
fake, so the only thing FCM can reject is that one fake token.

| # | assertion |
|---|---|
| A1 | flag absent + a real `riderId` write → no `_riderFcm` (first invocation, cold start included) |
| B1 | flag on → the assignment push is recorded on the order |
| B2 | an **EMAIL** riderId resolved to the real rider UID (`last.uid === RIDER_UID`) |
| B3 | a synthetic token is rejected and recorded honestly: `sent:false`, `reason:'fcm-error'` |
| B4 | `last.by === 'cloud'` (proves the trigger wrote it, not the bot) |
| B5 | the durable claim stores the raw riderId from the event |
| C1 | `status:'ready'` pushes |
| C2 | the status push targets the same resolved rider |
| C3 | a non-actionable status (`confirmed`) pushes nothing |
| C4 | replaying an earlier status (`confirmed → ready`) aborts on the durable claim — `last.at` unchanged |
| C5 | `picked up` is not a rider event (claim still reads `ready`) |
| C6 | `cancelled` pushes |
| C7 | the claim advanced to `cancelled` |
| C8 | the 23f finalizer ignored the non-web order (total 250, source QR, no `finalizeClaim`/`stockDeducted`) |
| C9 | no customer inbox row was written |
| D1 | flag `false` on a **warm** trigger → the next `riderId` write pushes nothing |
| E1 | the demo tenant is skipped with the flag on |
| E2 | control: the demo rider node was never involved |
| F1 | every fixture removed |
| F2 | the relay left **ON** |

Observed detail worth keeping: the synthetic token was rejected with
`messaging/invalid-argument` and the token was **kept**
(`fcmTokenInvalidAt` unset) — live confirmation that the never-prune list is
doing its job, since pruning on `invalid-argument` would wipe a healthy
subscriber list on one malformed payload.

## 8. The claim is what makes a replay safe, proven live

C4 is the interesting one. Sequence on one order:

```
status: Placed → ready      claim {status:'ready'}  push, last.at = T
status: ready  → confirmed   no rider event         claim untouched
status: confirmed → ready    claim already 'ready'  transaction aborts, last.at = T
status: ready  → picked up   no rider event         claim untouched
status: picked up → cancelled claim {status:'cancelled'} push
```

Before this batch the same replay depended on `orderState`, which a worker
restart erased — and the box restarts often. The marker now survives everything.

## 9. Honest limits

* **`sent:true` is not live-proven for riders.** The only rider token on the
  estate belongs to a real device (`sid`-unknown, pizza outlet), and the rule is
  never to page a real rider. `sent:false + real FCM error` proves the wiring,
  the resolution and the payload shape; the success branch is covered by the
  fake-FCM behaviour test in `tests/rider-notify.check.cjs`.
* **A send failure is not retried**, same as the bot. A rider can still miss a
  push (app uninstalled, OS killed the worker, transient FCM 5xx).
* **A missed event is not replayed.** RTDB triggers do not replay events that
  happened while a function was cold/deploying/failing. Same gap the bot had
  (its listener was also event-only).
* **`ready`, `packed` and `cooked` each push once.** That is pre-existing bot
  behaviour (each is a separate status transition and each mapped to `ready`),
  kept deliberately — a kitchen that steps ready → packed → cooked sends three
  "ready for pickup" notifications. Worth revisiting as product behaviour, not
  as a migration bug.
* **`_riderFcm/*` lives on the order node** and is admin-SDK written; no rules
  change was needed. It is visible to the tenant admin (same read grant as the
  order) and harmless.
* **The `rider_assigned` WhatsApp TEMPLATE stays in the bot** (`isRiderChanged`
  in `bot/index.js`): it rides the Baileys socket and cannot follow. Riders who
  work over WhatsApp still learn their assignment from that message only when
  the worker is running.

## 10. Blast radius of leaving it on

`config/riderRelay = {enabled:true, by:'batch-23h', doc:…, since:…}`. The bot
already has no live process (the box is down), so there is no double-send
surface today; if the box comes back, the bot reads the flag and stands down.
The only estate-level writes are `_riderFcm/*` on orders that actually have a
rider — a handful of scalar nodes, no listeners.

## 11. What this leaves on the box

Removed from the "cannot move" list: rider FCM pushes. Still on the box:

* Baileys worker + `rider_assigned` WhatsApp template (socket-only)
* `/api/whatsapp/*`, `/api/bot/*` (pm2 + per-tenant Meta credentials)
* `wallet-watch.js` (live-listener design; no outlet armed today)
* daily settlement, nightly demo reseed (cron; both tolerate a missed run)
* `/api/images/convert-batch` (sharp; already non-fatal)

## 12. Files

| file | role |
|---|---|
| `bot/rider-push.js` | **new** — the one rider sender: copy, email→UID, data-only payload, dead-token prune |
| `bot/index.js` | `isRiderRelayEnabled` (30 s cache), guarded `riderPush` require, rewritten `child_changed` rider branch; the WhatsApp `rider_assigned` template untouched |
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/riderRelay.ts` | **new** — the two triggers, flag, demo skip, durable claims, `_riderFcm/last` |
| `FIREBASE_SERVER_MIGRATION/functions/src/shared/rider/factory.ts` | **new** — `makeRiderPush(bid, oid)`, tenant from the event path, lazy messaging handle |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports both triggers (28 v2 functions) |
| `FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs` | vendors `bot/rider-push.js` (13 modules, 176.6 KB) + copy/status load assertions |
| `tests/rider-notify.check.cjs` | **new** — 23 checks: real module against a fake RTDB/FCM, socket-free pin, one switch, leaf refs, claims, demo skip, vendor entry |
| `tests/fcm-dead-token-codes.check.cjs` | repointed at `bot/rider-push.js` (the prune path moved, the contract did not) |
| `bot/tests/unit.test.js` | data-only pin follows the code into `bot/rider-push.js` |
| `.github/workflows/ci.yml` | new CI step for the rider guard |
