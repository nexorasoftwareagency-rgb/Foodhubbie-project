# 25 — Out-of-band "box silent" alert (batch 23a, LIVE)

Status: **shipped and live 2026-11-13 03:55 IST.** First production alert fired on
the still-open outage within 2 minutes of the first scheduled pass.

## 1. The failure this closes

The 2026-11-11 incident (`23_BOX_OFFLINE_INCIDENT.md`) was invisible for **13 hours**
because every signal we owned was written by the host that died:

* `botStatus.updatedAt` is rewritten by `bot-control-api` every 30 s — it stopped;
* `bot/status.lastSeen` is the bot's own heartbeat — it stopped in the same minute;
* nothing outside the box watched either one; a human noticed.

Nothing in the repo could have fixed that. The alert therefore runs **outside
EC2**, on managed infrastructure, and watches the box from there.

## 2. What shipped

`FIREBASE_SERVER_MIGRATION/functions/src/scheduled/platformHealth.ts` — a 2nd-gen
scheduled function, **every 5 minutes**, `us-central1`, 256 MiB, 60 s timeout,
secret `FIREBASE_DATABASE_URL`.

Two independent signals, deliberately not one:

| signal | read | why it is needed |
|---|---|---|
| newest `botStatus.updatedAt` across all 33 `outletIndex` outlets | two leaf reads per outlet (`updatedAt`, `status`) | proves the host + control API are writing. 30 s writer, so **stale after 5 min** = ten missed passes |
| `GET https://api.foodhubbie.in/api/bot/status-all` | must answer **401** | proves the HTTP edge answers — a DB writer can be alive while nginx/express is dead |

It never reads the `businesses` tree (batch-10 lesson) and never the whole
`botStatus` node (that carries `history`).

### Verdict + notification policy

`healthy` / `degraded` (one signal down) / `down` (both down). State is written to
`platformHealth/state`:

```
state, since, checkedAt, total, newestHeartbeatAt, newestAgeMin,
staleCount, staleOutlets[10], apiOk, reasons, lastNotifiedAt
```

Push (FCM, `webpush.headers.Urgency: high`) goes to **root admins with
`isSuper === true` and a token** — today exactly one (`roshanipizza@gmail.com`).
Delivery rules:

* transition into `degraded`/`down` -> push immediately;
* still broken -> **one repeat per hour**, never every pass;
* `down` -> `healthy` -> push "Platform back online";
* `healthy` -> `healthy` -> silent (no nagging).

Dead tokens (`registration-token-not-registered`, `mismatched-credential`,
`third-party-auth-error`) are stamped `admins/{uid}/fcmTokenInvalidAt` — the same
convention the bot already uses.

`platformHealth/lastNotification` keeps the last attempt
`{at, kind, repeat, state, tokens, sent, failed, errors[]}` so "did the alert
actually go out" is answerable without Cloud Logging.

### Cost

288 invocations/day = 8,640/month, ~66 tiny RTDB leaf reads per pass
(~1.9 MB/month). Both far inside the free tier. No listener, no tree read.

## 3. The landmine found on the way (fixed)

`firebase.json` had:

```json
"functions": { "code": "functions", "predeploy": ["npm --prefix functions run build"] }
```

**`code` is not a key the Firebase CLI reads** — the key is `source`. So the CLI
silently fell back to the `functions/` directory, a stale plain-JS tree whose only
function is `processDishImage` (never deployed). A `firebase deploy --only
functions` from the repo root would have **deleted all 11 live functions**
(`whatsappWebhook`, `processInboundMessage`, `sendOutboundMessage`,
`onOrderStatusChange`, `checkout`-family callables, `metaCostPublisher`, ...) and
replaced them with one dead one.

Fixed to the tree the 11 live functions actually come from:

```json
"functions": {
  "source": "FIREBASE_SERVER_MIGRATION/functions",
  "predeploy": ["npm --prefix FIREBASE_SERVER_MIGRATION/functions run build"],
  "runtime": "nodejs22"
}
```

Guard: `tests/functions-source.check.cjs` (**19 checks**, `npm run
test:functions-source`, CI step) — asserts `source` is set, `code` is gone, the
source tree is the nodejs22 TS one, `platformHealth` is exported + wired, the
evaluator stays dependency-free, and the pass never reads the `businesses` tree
or the whole `botStatus` node.

## 4. Verification

| check | result |
|---|---|
| `tsc` | clean |
| `node scripts/health-selfcheck.cjs` (runs the **compiled** decision table) | **24/24** — healthy, the real 782-min incident, hourly repeat gate, recovery, degraded-both-ways, 3-of-33 stale stays healthy, first run, empty index, exact threshold |
| dry run against the live DB (`node scripts/health-live.cjs`) | `state=down`, 33 outlets, newest heartbeat 1,903 min old, `apiOk=false`, would notify |
| deploy | `functions[platformHealth(us-central1)] Successful create operation` |
| first scheduled pass (2026-11-13 03:55:00 IST) | `state=down`, `newestAgeMin=1912`, `lastNotification {kind:down, tokens:1, sent:1, failed:0, errors:[]}` — **push accepted by FCM** |
| second pass (04:00:01 IST) | `checkedAt` moved, `lastNotifiedAt` did **not** — no spam |
| `tests/functions-source.check.cjs` | 19/19 |

Not proven here: presentation on the owner's device (FCM accepted the send; the
browser must be registered — the admin token was minted 2026-11-07 and FCM
accepted it), and the recovery push (cannot fire until the box returns — the
transition is covered by the self-check and will be observed on restart).

## 5. Incident impact re-measured (good news)

Scanned every outlet's orders while the box is still down:

* APP / webview orders stuck unfinalized: **0**;
* bills marked `Paid` since 11 Nov 20:03 IST (loyalty earn would have been lost): **0**.

The outage started after closing and the next trading day had no recorded sales,
so it is a **risk, not a loss**. The remaining outage effects are the missed
nightly demo reseed and the paused 60 s wallet-gate publisher (no outlet is armed).

## 6. What this does not cover yet

* **Host alive, bot dead** — `botStatus.status` would flip to `offline` within
  30 s and this function records it in `staleOutlets`, but it does not push for
  it. A per-bot alert is the next increment (only `roshani-pizza/pizza` runs a
  bot; `roshani-cake` and a disabled outlet still carry `bot/transport=baileys`
  and would false-positive, so the rule needs a "bot expected" signal first).
* **Elastic IP** — still an owner console action (`23_BOX_OFFLINE_INCIDENT.md`
  §4.3). This alert makes the failure visible in minutes; it does not stop the
  IP change from breaking DNS on every stop/start.
* The alert repeats hourly while down by design; mute by disarming the scheduler
  job if that becomes noisy.

## 7. Next batch

**23b** — extract the web/app order finalization out of `bot/index.js` into a
socket-free module so it can run as an RTDB trigger. Dependency map measured from
the code (all of it already standalone CJS except the three socket calls):

| piece | today | portable? |
|---|---|---|
| `orderPricing.repriceOrder` + `buildPriceReview` | `bot/order-pricing.js` | yes (pure) |
| `discountEngine.evaluateDiscount` / `recordDiscountUsage` | `bot/discount-engine.js` | yes (needs `shared/discount-rules.js`) |
| `_verifiedOrderTotals` | `bot/index.js` | yes (needs `shared/money-math.js`) |
| `_serverTaxRates` / `_serverDeliveryFee` | `bot/index.js` | yes (settings + `shared/geo`) |
| `verifyRewardTender` | `bot/index.js` | yes (transactions only) |
| `deductInventoryStock` / `restoreOrderInventory` | `bot/index.js` | yes (alert is guarded when no socket) |
| customer profile mirror | inline in the listener | yes |
| `notifyAdmin`, `handleOrderStatusUpdate` | `bot/index.js` | **no** — WhatsApp-only, stays on the box |

No APP/webview order was stuck during this outage, so 23b can be done with the
usual live-E2E discipline rather than as an emergency.
