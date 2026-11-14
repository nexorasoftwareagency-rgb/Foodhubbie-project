# 33 - Push relay: new-order alerts, order-status pushes and tier-up (batch 23e)

Date: 2026-11-14. Follows 23d-4 (`31_ONBOARDING_WATCHER.md`). The box is still
down (`23_BOX_OFFLINE_INCIDENT.md`, `node tools/check-box-live.cjs` exit 1), so
this batch moves the last **notification** paths that only existed inside the
EC2 WhatsApp worker.

Owner decision, 2026-11-14: batch 23e is the push relay. The order-finalizer
flip (money) stays a separate, later batch — pushing a status is reversible and
costs nothing if wrong; re-pricing an order is not.

## 1. What was left behind, and why it matters

Three senders lived in `bot/index.js`. None of them needs a WhatsApp socket, a
pm2 process or an inbound message — they are pure Admin SDK reads plus FCM — so
all three went dark with the box:

| bot function | writes | what breaks while the box is down |
|---|---|---|
| `sendFCMToAdmins` | admin devices (`admins/*/fcmToken`) | nobody is alerted to a new order: the owner's phone is silent all service |
| `notifyCustomerApp` | `pushInbox/{phone}` + customer devices | the customer gets no "confirmed / out for delivery / delivered" push **and no in-app inbox row**, so the app's Orders/Notifications list stops updating mid-meal |
| `notifyTierUp` | `pushInbox/{phone}` + customer devices | a loyalty promotion is invisible: no push, no inbox row |

The app keeps accepting orders while the box is down (batch 23d-1/2 moved the
routes that matter), which made the silence worse, not better: a customer can
order and then hear nothing at all.

## 2. One file, three triggers

`FIREBASE_SERVER_MIGRATION/functions/src/triggers/pushRelay.ts`:

| export | event | mirrors |
|---|---|---|
| `onOrderPushAdmin` | `onValueCreated` on `businesses/{bid}/outlets/{oid}/orders/{orderId}` | `sendFCMToAdmins` |
| `onOrderPushCustomer` | `onValueWritten` on `.../orders/{orderId}/status` | `notifyCustomerApp` |
| `onLoyaltyTierUp` | `onValueWritten` on `.../customers/{phone}/loyalty` | `notifyTierUp` |

All three are `us-central1`, 256 MiB, 60 s, `FIREBASE_DATABASE_URL` secret — the
same shape as the other triggers in this tree.

The tenant comes from the **event path** (`{bid}` / `{oid}`), never from a
lookup. That is deliberate: `resolvePath` in the bot guesses the business from a
reverse index, and the e2e business holds an outlet literally named `pizza`, so a
guess is a cross-tenant write waiting to happen. The e2e outlet was used for the
live run precisely because it would expose that mistake.

## 3. The one switch (and why a flag, not a delete)

`config/pushRelay/enabled === true` means the Functions own the three sends.
When it is that value, `bot/index.js` stands down:

```js
async function isPushRelayEnabled() {
    try {
        const snap = await db.ref('config/pushRelay/enabled').once('value');
        return snap.val() === true;
    } catch {
        return false;
    }
}
```

Only an **explicit** `true` enables either side. Absent, `false`, or an
unreadable flag means "the bot sends exactly as before" and every trigger here
is a no-op (`if (!(await relayEnabled())) return;` is the first statement of all
three). This direction matters: a failed read can leave nobody sending for a
moment, but it can never leave **both** sending. A double push to a real phone is
the failure mode worth engineering against; a missed push is not.

The flag is read fresh on every event (`.once`, never a cached `getData` — the
bot's 30 s cache would keep sending for half a minute after a flip), and each
trigger also refreshes it per invocation, so no hot instance can hold a stale
"on".

`initFCMWatcher` had to change with it. Its `child_added` handler always claimed
`orders/{id}/_fcmSent` after calling the sender; while delegating, that claim
would mute the very trigger that is supposed to send. It is now `async`, reads
the sender's return value, and claims **only when the bot did not delegate**:

```js
const result = await sendFCMToAdmins(snap.key, order).catch(() => {});
if (result !== 'relay') snap.ref.child('_fcmSent').set(true).catch(() => {});
```

## 4. Idempotency

Retries are normal for both sides (RTDB triggers are at-least-once; the bot
re-runs `startBot()` on every Baileys reconnect), so each path has one dedupe
marker and it is the *existing* marker, not a new one:

| path | marker | behaviour on replay |
|---|---|---|
| admin alert | `orders/{id}/_fcmSent`, claimed by **transaction** before the multicast | second sender / second invocation returns at the claim |
| customer status | the inbox row itself, key `{orderId}_{status}` | row exists → return, no send |
| tier up | inbox key `tier_{newTier}_{tierReachedAt}` | row exists → return, no send |

The admin claim is taken **before** the send on purpose: a crash between claim and
multicast can lose one alert, but can never page twice. The customer row is
written **before** its multicast (bot parity), so an inbox row can exist with no
delivered push — the app shows the update, and the honest limit is recorded in
section 9.

## 5. Four deliberate deviations from the bot

Each one is a small improvement that the event model makes free; none changes
what the customer sees on the happy path.

1. **The customer trigger listens on `.../orders/{orderId}/status`, not the whole
   order node.** The bot's `child_changed` fired for every field, then filtered.
   A payment mirror, a KOT stamp or a rider assignment no longer invokes a sender
   at all — not even the cap read. `before`/`after` on the leaf is also the exact
   question ("did the status really change?"), so the gate is
   `!statusAfter || (before.exists() && statusAfter === statusBefore)`.
2. **The inbox-exists check runs before the cap.** In the bot, a duplicate event
   could consume a transactional `notifyCaps` slot and then find the row and
   return — spending a cap for a push that never goes out. Checking the marker
   first removes that leak without changing successful behaviour.
3. **The tier-up inbox key derives from `tierReachedAt`, not `Date.now()`.** The
   bot's key made a replay look like a new promotion. `tierReachedAt` is written
   by `processLoyalty` at the moment the rank changed, so it is stable for the
   event and distinct between two real promotions.
4. **`tenantNotify` no longer prunes on `messaging/invalid-argument`.** The caps
   and the dead-token classification were extracted into
   `src/shared/notify/caps.ts` so the endpoint and the relay cannot drift. That
   moved the prune list to the four *permanent* codes only
   (`registration-token-not-registered`, `invalid-registration-token`,
   `mismatched-credential`, `third-party-auth-error`). `invalid-argument` is a
   **payload** error as much as a token error — it fails every token in a
   multicast — so pruning on it could wipe a healthy subscriber list because of
   one bad field. `messaging/unknown` and an absent code are also never pruned.

## 6. The demo tenant is hard-skipped

`bid === 'foodhubbie-demo'` returns at the top of all three triggers.

The nightly demo reseed (03:00 IST, `tools/seed-demo-tenant.cjs`) writes **353
orders**, and the admin audience is "super/supreme plus this outlet" — the
owner's real, logged-in device is `isSuper`. Without the skip, leaving this relay
on would push **353 order alerts to the owner's phone every night**, forever, and
fill the demo inbox with fake customer statuses. The skip is on the business id,
not on a settings flag, so a reseed cannot re-enable it.

This is recorded as a code comment at each early return site; the guard also pins
`bid === DEMO_BUSINESS_ID` in all three.

## 7. What is deployed

```
firebase deploy --only functions:onOrderPushAdmin,functions:onOrderPushCustomer,functions:onLoyaltyTierUp
```

`functions:list` (21 functions total) confirms the event types, which is the part
a source read cannot prove:

| function | type | event |
|---|---|---|
| `onOrderPushAdmin` | v2 | `google.firebase.database.ref.v1.created` |
| `onOrderPushCustomer` | v2 | `google.firebase.database.ref.v1.written` |
| `onLoyaltyTierUp` | v2 | `google.firebase.database.ref.v1.written` |

`tenantNotify` was re-deployed afterwards so the deployed code is the shared-caps
version the guard reads (it had been serving its inline copy).

The deploy log prints `Can't determine Firebase Database URL` for the older
prototype functions (`onboardingApprove`, `qrMenuOrder`, …). That noise comes from
the CLI analysing unrelated exports; it is not a failure and the three triggers
are created/updated successfully.

No RTDB rules change, no hosting change: every write in this batch is Admin SDK,
and the app already reads `pushInbox/{phone}` (its only requirement is the row
shape, verified against `menu/js/customer.js`).

## 8. Live verification — 39/39

`%TEMP%/opencode/e2e-23e-pushrelay.cjs`, real Firebase, real triggers, synthetic
subscription tokens, every non-demo order created with `_fcmSent: true` (see the
safety model in section 9).

| part | claim | result |
|---|---|---|
| A | flag OFF is a total no-op: no inbox row on creation, no row on a status change, no cap consumed, token untouched | 4/4 |
| B | flag ON relays to the customer: APP status push (title/type/status/orderId, app Orders URL, cap 1), invalid token kept, webview creation push (`delivery.html?…&order=` deep link, cap 2), same-status rewrite does not rewrite the row or spend a slot, dine-in silent, invalid phone silent, `_fcmSent` respected, no admin token touched, demo tenant silent | 19/19 |
| C | loyalty: silver promotion with a deterministic `tier_silver_{ts}` key and the WhatsApp-only URL, cap 1, replay silent, gold with an app profile lands on `tab=loyalty` with the `1.5×` body, cap 2, downgrade silent | 9/9 |
| D | flipping the flag back off stops the relay again (no push, no cap, token kept) | 1/1 |
| E | restore: no `E2E23E` keys anywhere (orders, shadow, subs, inbox, caps, loyalty, demo), scratch phone clean, every admin token record byte-identical to the baseline, relay left ON with provenance | 6/6 |

Trigger latency was within a few seconds throughout; the first invocation after
deploy cold-started (~12 s), which only affects the very first event.

The compiled module the runtime actually executes was checked separately, because
a source read cannot prove the build:

```
IST bucket: 2026-11-14   quiet now: false   caps: {"order":50,"loyalty":5,"promo":3}
PRUNE  "messaging/registration-token-not-registered"
PRUNE  "messaging/invalid-registration-token"
PRUNE  "messaging/mismatched-credential"
PRUNE  "messaging/third-party-auth-error"
keep   "messaging/invalid-argument"
keep   "messaging/unknown"
keep   ""
```

## 9. Honest limits

1. **The admin alert path was not live-fired.** The only `isSuper` with a real FCM
   token is the owner's own device, so any un-suppressed order creation would
   page it. What is proven instead: the trigger ran for every test order and
   returned at the `_fcmSent` claim (flag intact, 8 admin token records
   byte-identical to the baseline), the audience/filter/payload are pinned by the
   guard, and the payload shape is the one `Admin/sw.js` already consumes
   (`type:'new_order'`, `data.orderId`, data-only so the SDK cannot also render
   its own untagged popup).
2. **Dead-token pruning was not live-fired either.** Every synthetic token returns
   `messaging/invalid-argument` — proved with three shapes (a 19-char string, 152
   `f` characters, a 160-char base64 blob) — and that code is deliberately never
   pruned. The live assertion is therefore the safe direction: **the subscriber
   survives** a failed send. The prune branch itself is statically verified
   (four permanent codes prune; unknown/empty/invalid-argument keep) and needs a
   genuine dead device token to exercise, which this environment must not create.
3. **Loyalty tier-up is deployed but dormant in production.** `processLoyalty`
   (which computes points and writes `tier`/`tierReachedAt`) is still bot-side, so
   while the box is down nothing advances a tier. The trigger is ready for the
   box's return; it is not a backfill.
4. **Order finalization is still bot-side (23b/23c).** This batch pushes statuses;
   it does not produce them. An APP order is written `Placed` by the app and only
   the finalizer (bot now, Functions after a later batch) re-prices it, deducts
   stock and sets `paymentStatus`. Status changes made in the Admin dashboard do
   fire customer pushes today.
5. **An inbox row can exist with zero delivered pushes**, because the row is
   written before the multicast resolves (bot parity). The app then shows the
   update in its list even if the device never got a notification — which is the
   better failure for a customer waiting on food.
6. **A crash between the admin `_fcmSent` claim and the multicast loses that one
   alert.** Deliberate: the alternative orders the failure the other way and pages
   twice.
7. **A cap slot is spent per phone per attempted send**, including a send that
   then fails; the bot behaved identically, and the caps are per type per IST day.
8. **The demo reseed still rewrites the demo tenant**; the skip protects the
   owner's device and keeps the demo inbox empty, but it also means the demo can
   never demonstrate a real push. Accepted: the demo is a data sandbox.

## 10. Blast radius of leaving it on

`config/pushRelay` is now:

```json
{ "enabled": true, "since": 1794645409679, "by": "batch-23e",
  "doc": "FIREBASE_SERVER_MIGRATION/33_PUSH_RELAY.md" }
```

The live pizza outlet holds **3 real subscriptions** (phone `9724649971`, all with
`orderUpdates: true`), so those devices now receive order-status and tier pushes
**from the cloud**. That is the point of the batch. The e2e outlet holds 0
subscriptions, so it stays a silent test surface.

When the box returns, the bot must stay silent for these three paths — it will,
because the flag is `true`, and that is the first thing to re-check after the
deploy (`node tools/check-box-live.cjs`, then confirm no duplicate pushes on one
status change).

## 11. Files

| file | change |
|---|---|
| `FIREBASE_SERVER_MIGRATION/functions/src/triggers/pushRelay.ts` | new — the three triggers |
| `FIREBASE_SERVER_MIGRATION/functions/src/shared/notify/caps.ts` | shared IST caps + `DEAD_PUSH_CODES` (no `invalid-argument`) |
| `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts` | refactored onto the shared module; re-deployed |
| `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` | exports the three triggers |
| `bot/index.js` | `isPushRelayEnabled()`; the three senders stand down; `initFCMWatcher` claims `_fcmSent` only when it actually sent |
| `tests/functions-source.check.cjs` | 170 checks — the batch-23e section pins the switch, the demo skip, both listener paths, the dedupe-before-cap order, the admin claim, the URLs, the caps module and the bot side of the switch |
| `%TEMP%/opencode/e2e-23e-pushrelay.cjs` | the 39-check live harness (idempotent, restores fixtures, leaves the relay ON) |

`batchCheckAndConsumeCaps` (the parallel caps pass inside `tenantNotify`) landed
in the same tree as commit `2705b99` and composes on this extraction — one module,
one set of numbers, one IST bucket, shared by the endpoint and the relay.
