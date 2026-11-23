# 45 — Operator replies leave from Functions (batch 23o)

Commit `b357e35`. Deployed: `onBotCommand` (38 v2 functions). Guard:
`tests/bot-commands.check.cjs` 41/41 (+ mutation self-test). Live E2E 36/36.
**Ships flag-off (`config/botCommands` absent), so live behaviour is unchanged.**

## 1. What this batch finished

`bot/commands` is the queue every dashboard writes when a human sends a WhatsApp message:

| Writer | Action |
|---|---|
| `Admin/js/features/chat.js` (Chat tab) | `SEND_GENERIC_MESSAGE` |
| `Admin/js/features/analytics-mobile.js` ("send report") | `SEND_GENERIC_MESSAGE` |
| `Admin/js/features/riders.js` / `rider-analytics.js` | `SEND_GENERIC_MESSAGE` |
| `Admin/js/features/promotions.js` / `notify-composer.js` | `SEND_PROMOTION` |

Only `bot/index.js` consumed it (`child_added`), which is socket-only: with the box down an
operator's reply sat in the queue for ever and the Chat tab kept showing it as queued. The reply is
pure Admin SDK + one Graph call — no socket — so it moved like 23e/23f/23g.

Leaf-first: **`SEND_GENERIC_MESSAGE` only.** `SEND_PROMOTION` is the ~700-line campaign engine
(pacing, opt-out, prepaid tokens, template shells, pause reasons); a stub that "sends to everyone" is
the top ban trigger and ignores consent. The report actions have **no client writer** (grep-verified;
the nightly `dailyReports` already owns the daily report). Unknown actions are never consumed.

## 2. `onBotCommand`

```
onValueCreated  businesses/{bid}/outlets/{oid}/bot/commands/{commandId}
us-central1 / 256 MiB / 60 s / nodejs22
secrets: FIREBASE_DATABASE_URL, WA_PERMANENT_TOKEN
```

Order of operations (every step exists to stop a specific failure):

| Step | Why |
|---|---|
| demo hard-skip | the nightly reseed churns the demo tenant; a command there must never be sent |
| `action !== 'SEND_GENERIC_MESSAGE'` → return | the campaign/report nodes must stay exactly where the bot left them |
| `initializeAdmin()` | `getDB()` throws before it, so the flag read needs it first |
| `config/botCommands/enabled === true` | unreadable = stay off, the bot keeps the job |
| `formatJid(cmd.phone)` unusable → **remove** | parity with the bot: a dead command is not a failure to retry |
| freeze read `bot/chatState/{phone10}/frozenUntil` → **remove** | ban-proofing; a Function has no in-process Map |
| **transport built before the claim** | a tenant with no `whatsapp` node must not burn `_claimedAt` — the reply would be lost for ever (23n rule; live-proven phase B) |
| cold-seeded `_claimedAt` transaction | at-most-once: RTDB triggers are at-least-once, and an admin-SDK transaction hands the first attempt `null` even for an existing node, so `cur` alone cannot detect a claim |
| text send, template **only** on `131047` | see §3 |
| `result.blocked === true` → treat as NOT sent | the Meta cost guard returns rather than throws; nothing left the building |
| chat row with the real Graph id | see §4 |
| tombstone `{_doneAt,_via,phone:null,message:null}` | see §5 |

### 2.1 Failure semantics

A failure stamps `_lastError` (300 chars) + `_failedAt` and **keeps** the node — the bot never removed
on a throw either, and a silent delete would lose the operator's text. The claim is already taken by
then, so a redelivery cannot loop: `retry` is deliberately off, because a permanent Graph rejection
(undeliverable number) must not retry for 24 hours. A human can still see the reason and delete the
node to retry by hand.

## 3. Text first, template only on 131047

`bot/transport.js` sent the approved `proactive_promo` template **first** whenever the socket was
`meta:`. That bills the MARKETING rate (Rs 0.8631) for a free-form reply the customer is allowed to
receive inside the 24-hour service window (Rs 0.115) — a real defect, not a style choice. The cloud
path attempts the text first and retries as the template only on Graph **131047**
("re-engagement message", i.e. outside the window), the one case where a template is *required*.

That is only detectable if the Graph code survives the throw. `bot/whatsapp-send.js` `_postToGraph`
previously kept just the message string; it now attaches `err.status` / `err.code` / `err.subcode` /
`err.details` / `err.fbtraceId`. The message string is unchanged, so every existing caller and its
template→text fallback behave exactly as before.

## 4. The outbound row must be persisted

`makeMetaTransport` does not write chat rows (the bot did that from a central hook in `bot/index.js`),
and `chat.js` renders an optimistic `pending` bubble. Without a write the operator's message vanishes
on reload. The trigger writes `chats/{customerId}/messages/{safeMsgId}` + the `chatMeta/{customerId}`
mirror through the **vendored** `bot/chat-log-core.js` (same bytes the dashboard reads), keyed by the
REAL Graph id `messages[0].id` (`wamid.*` — dots replaced with `_`, the core's existing rule). The
graph id is also why `_postToGraph` must return the response body.

## 5. Success leaves a tombstone, never a delete

Deleting the node would let a late duplicate **re-create** `_claimedAt` under the removed key and send
twice. The tombstone keeps `action` / `_claimedAt` / `_doneAt` / `_via` and drops `phone` + `message`
(RTDB deletes a null field), so it holds no message content and no customer number. Accumulation is
~80 bytes per operator reply; that is accepted and recorded as an honest limit rather than adding a
prune race that could delete a live command.

## 6. One writer per path — the bot side

`bot/index.js` gained `isBotCommandRelayEnabled()` (30 s cache, `catch -> false`) and gates **the
branch, not the listener**:

```js
if (cmd.action === "SEND_GENERIC_MESSAGE") {
    if (await isBotCommandRelayEnabled()) { ...; return; }   // <- before the shared remove()
    ...original body...
}
// SEND_PROMOTION handling is untouched
await snap.ref.remove();   // shared, still runs for everything the bot actually handled
```

Gating the listener would silently kill campaigns while the cloud trigger implements none of them.
The `return` is load-bearing: the shared `snap.ref.remove()` sits after the branch chain, so a plain
fall-through would delete a cloud-owned command.

## 7. Two real defects found while shipping

1. **`lib/vendor` path** — the trigger used `path.join(__dirname, '../../vendor')`, copied from a
   `shared/` module. A trigger compiles to `lib/triggers/`, so that resolves to `functions/vendor`
   (nonexistent): `tsc` stayed green, the deploy uploaded, and the whole bundle failed to load
   (`Cannot find module .../functions/vendor/bot/utils.js`) — the deploy died with every *other*
   function's cold-start noise on screen. Fixed to `../vendor`, and the guard now pins it.
   **Lesson: a vendored require path is compile-clean and only fails at bundle load.**
2. **Graph error codes were dropped** (§3) — without them 131047 is undetectable and every
   outside-window reply fails instead of falling back.

## 8. Verification

Guard `tests/bot-commands.check.cjs` 41/41 (`npm run test:bot-commands`, CI step after
`daily-reports`): source pins for every guard in §2, the tombstone/claim/delete-on-success rules, the
`131047` seam, the vendored list, the bot-side gate ordering, the export, and the vendor path. The
mutation self-test (delete-on-success + no gate + template-first) fails 38/41; reverting only the bot
gate fails exactly the two ordering checks.

Live E2E 36/36 (`%TEMP%/opencode/e2e-23o-bot-commands.cjs`), e2e tenant, real deployed trigger for
A–E/K/L and the **compiled** handler with a stubbed `fetch` for F–J (a real Graph success is
impossible while the system user owns no assets, §10):

| Phase | Proves |
|---|---|
| A | flag absent → command untouched, no chat row, after 50 s |
| B | flag on, no `whatsapp` node → `_lastError: no transport:...`, **no `_claimedAt`** |
| C | flag on + `whatsapp` node → claim taken, real Graph attempt failed (`send failed:...`), not tombstoned |
| D | `SEND_PROMOTION` untouched |
| E | demo tenant untouched |
| F | stubbed 200 → one text call, tombstone `_via:'text'`, phone/message gone, claim kept, chat row under the **real** `wamid` id, `chatMeta` mirror written |
| G | replay → zero HTTP calls, tombstone unchanged |
| H | first call 131047 → second call is `type:'template'` `proactive_promo`, `_via:'template'`, chat row |
| I | `balancePaise:100` → zero HTTP calls, `blocked by the Meta cost guard`, not tombstoned, no chat row |
| J | `frozenUntil` in the future → zero HTTP calls, command dropped |
| K | live, unusable phone → command removed |
| L | live, the claimed command deleted and re-created identically → no second send attempt |

Every fixture restored byte-identically (`bot`, `whatsapp`, `chats`, `chatMeta`, `walletBilling`,
flag), and `config/botCommands` left **absent**.

Wider sweep after the change: functions-source 198/0, egress-guard 20/20, webhook-inbox 21/21,
order-status-alert 25/25, daily-reports 27/27, bot unit 28/28, twins 8 pairs, admin-query-chain 151
files, encoding ok, `npm run build` (copy-vendor 22 modules / 363.9 KB, load check OK), and the bundle
re-proved with `%TEMP%/opencode/verify-vendor-bundle.cjs`.

## 9. Rollout

1. Owner assigns WABA `2589174454849821` + App `Foodhubbie` to `Conversions API System User`
   (**Full control** on both). No new token: the existing one is valid, `expires_at 0`.
2. Meta callback → `https://us-central1-foodhubbie-10.cloudfunctions.net/whatsappWebhook`, THEN
   `config/webhookInbox/enabled = true` **first**, callback second — never the reverse (23m §).
3. Once a tenant has a real number: `config/botCommands/enabled = true`, then
   `config/orderStatusAlert` / `config/dailyReports` / `config/webhookInbox`. Each is independent.
4. The bot's `SEND_GENERIC_MESSAGE` branch stays in place behind the flag; a revived box needs the
   flag OFF or the two owners race (the claim makes that safe, not silent).

## 10. Honest limits

- **A real Graph success was never live-fired** (the system user owns zero assets, so even a real
  phoneNumberId answers code 100). F/H prove the success path end to end against the real RTDB with
  only the HTTP leg stubbed; the live leg proves the Graph call actually happens and that the failure
  semantics hold.
- A **crashed invocation** between the claim and the send leaves a claimed command with no
  `_doneAt` and no `_lastError`. It is never retried automatically (at-most-once by design); the
  operator sees a stuck row and can delete + resend.
- **One small billing read per command** (`walletBilling/{bid}/{oid}` via the cost guard), the same
  cost every other cloud sender pays. No orders/`chats` node is read.
- The tombstone accumulates (~80 B per operator reply) by design (§5).
- Campaigns still need the EC2 socket or the promotions batch; `SEND_PROMOTION` is deliberately inert
  on Functions.
