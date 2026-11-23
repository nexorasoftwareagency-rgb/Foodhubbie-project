# 46 — Business App replies reach the Admin Chat thread (batch 23p)

Commit `98f4dbc`. Deployed: `whatsappWebhook` (38 v2 functions), `database` rules,
`hosting:admin` (`98f4dbc.20261123T113002Z`, shell `v5.12.78`, `chat.css?v=5.3.35`).
Guard: `tests/coexistence-echo.check.cjs` 32/32 (+ mutation self-test). Live E2E 33/33
(signed POST against the deployed function) + live UI 17/17 (deployed `/demo`).
**No flag — this is inbound plumbing, and it only fires on a payload Meta never sent
us before.**

## 1. What this batch finished

Path B puts every restaurant number on Foodhubbie's WABA and runs the bot on the Cloud
API. **Coexistence** is what keeps the owner in the loop: the same number stays logged
into the WhatsApp Business App on the owner's phone, so they can answer a guest by hand
while the Cloud API also serves the number.

When staff send from the Business App, Meta delivers the restaurant's own outbound
message to the webhook in a **separate change**:

```jsonc
{
  "field": "smb_message_echoes",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "9197…", "phone_number_id": "1211…" },
    "message_echoes": [
      { "from": "9197…", "to": "9198…", "id": "wamid.…", "timestamp": "1795…",
        "type": "text", "text": { "body": "Jain pizza bhej diya" } }
    ],
    "messages": []            // <-- EMPTY, always
  }
}
```

Two things made this dangerous rather than merely invisible:

1. **The webhook ignored it.** `value.messages` is empty, so the old code hit
   `messages.length === 0` and returned. The owner's reply left no trace in the
   dashboard — and an operator looking at the thread saw an unanswered guest and
   answered the same person again.
2. **`message_echoes` carries `from` = the BUSINESS number.** Feeding it to
   `enqueueInbox` would hand the business's own number to the inbound state machine
   as if a customer had written: the bot would answer itself, in a loop, and burn
   sends (the 23m channel-guard lesson, one layer up).

## 2. The branch

`FIREBASE_SERVER_MIGRATION/functions/src/api/whatsappWebhook.ts`

Order inside `for (const item of changes)`:

```
message_template_status_update   -> persist template status, continue
statuses                         -> log only, continue
message_echoes                   -> NEW: log to the thread as from:'app'
                                    continue ONLY when messages is empty
messages                         -> route to webhookInbox (unchanged)
```

**Routing comes from `phoneNumberIndex/{metadata.phone_number_id}` — never from a
payload claim.** An echo's `from` is the business number, so it cannot identify the
tenant; the phone-number id is the same routing key every inbound message already uses.
An unrouted phone id logs a warning and writes nothing.

Per echo:

| Check | Behaviour |
|---|---|
| `echo.revoke` | skipped — staff deleted a message on the phone; the thread keeps the original (WhatsApp itself shows "This message was deleted") |
| `echo.edit` | skipped — not a new message |
| `echo.type === 'reaction'` | skipped — not a message |
| no `echo.to` | skipped (logged) — there is no thread to write to |
| otherwise | `chatLog.logChatMessage({ jid: to, msgId: id, from: 'app', text: echoText(echo) })` |

`echoText()` reuses the inbound extractor's fallbacks, because a WhatsApp message does
not always carry `text.body`: `text.body` → `image/video/document.caption` →
`button.text` (template quick reply) → `interactive.button_reply.title` →
`interactive.list_reply.title` → `location` → `<media>`.

**Batched payloads still work.** The echo branch `continue`s only when
`change.messages` is empty. If Meta ever sends one change carrying both, the echo is
logged and the customer message still reaches `webhookInbox` (proven live, I1/I2).

## 3. `from:'app'` in the chat log

`bot/chat-log-core.js` (the one writer the bot and Functions share):

- `from:'app'` is **outgoing**.
- It **clears `unread`** (`unread: 0`). The staff who sent the reply have plainly read
  the thread; a stale badge would send the dashboard operator in to answer a customer
  twice. A `bot` reply deliberately keeps `unread` as-is — the bot answering is not a
  human reading.
- `lastDir: 'app'` is stored, so the list can show it.
- The `chatMeta/{customerId}` mirror is written from the same transaction snapshot, so
  the list row and the thread cannot disagree.

## 4. Coexistence is now observable

An echo is the **definitive** proof the number is in coexistence mode, so the branch
calls `recordCoexistence(bid, oid)`:

```
businesses/{bid}/outlets/{oid}/whatsapp/coexistence = { mode: 'business_app', lastSeenAt }
```

The competing signal (an inbound message carrying `origin.type === 'business_app'`) is
kept and shares the same helper. The Supreme WhatsApp card reads the node.

## 5. Admin Chat

`Admin/js/features/chat.js`:

```js
const isBot = m.from === 'bot';
const isApp = m.from === 'app';
const isOut = isBot || isApp;          // same bubble side, same ticks
```

An app reply renders as an outgoing bubble with a green **"via app"** pill
(`.chat-src-app`, `title="Sent from the WhatsApp Business App"`), so the operator knows
the guest has already been answered and by whom. The thread preview treats `app` as
outgoing (the leading tick glyph), and `unread` stays 0.

`database.rules.json`: the message `.validate` allows `'customer' | 'bot' | 'app'`.
Without it every echo write is a permission denial.

## 6. Guard

`tests/coexistence-echo.check.cjs` — **32 checks**, `npm run test:coexistence-echo`,
CI step. It pins the webhook source (branch order, routing key, the three skips, the
`messages.length === 0` continue, no `enqueueInbox` on the echo path, both coexistence
call sites), runs the **real** `bot/chat-log-core.js` against a fake RTDB (outgoing
classification, unread cleared for `app` and preserved for `bot`, mirror equality), and
pins the Admin render + the rules value.

`tests/chat-tab.check.cjs` was pointed at `bot/chat-log-core.js` — it still read the
15-line `bot/chat-log.js` binding, so the "one writer" claims it makes were checking a
file that no longer contains the logic.

Mutation self-test (`%TEMP%/opencode/mutate-coexistence.cjs`): baseline exit 0;
echo-branch-removed / unread-not-cleared / app-rendered-incoming each exit 1.

## 7. Live verification

**33/33** — `%TEMP%/opencode/e2e-23p-coexistence-echo.cjs`, signed `POST` with
`X-Hub-Signature-256` over the exact bytes, against
`https://us-central1-foodhubbie-10.cloudfunctions.net/whatsappWebhook`, e2e tenant,
own thread `9000000042`:

- GET challenge answers; a wrong verify token is refused.
- The echo lands as `from:'app'` with the text preserved and a numeric `ts`; the thread
  meta reads `lastDir: 'app'`, keeps the **full jid** as `phone`, and `unread` goes
  **2 → 0**; the `chatMeta` mirror equals `chats/{id}/meta`.
- The echo **never** reaches `webhookInbox`; `whatsapp/coexistence` is recorded.
- Caption / `<media>` / template quick reply / interactive reply all resolve.
- `revoke` + `edit` + `reaction` write nothing and do not overwrite the preview.
- An echo with no `to` writes nothing; an unrouted phone id writes no thread and no
  inbox row; an unsigned POST is answered 200 and dropped.
- An echo batched **with** a customer message still enqueues exactly one
  `source:'meta-webhook'` inbox row, and it is the customer's.
- Every fixture restored byte-identically.

**17/17** — `%TEMP%/opencode/e2e-23p-chat-ui.cjs` on the deployed
`https://foodhubbie-admins.web.app/demo`: a seeded `from:'app'` message renders as
`.out`, carries exactly one styled `.chat-src-app` pill reading "via app", shows ticks,
has **no** unread badge, an ordinary bot reply in the same thread carries no pill,
**0 page/console errors**, thread restored byte-identically.

A note for anyone re-running the E2E: the message write and the meta transaction are
two round trips, so reading `chats/{id}/meta` as soon as the message appears races the
transaction. The E2E now polls `lastDir === 'app'` and requires the mirror to be
non-null. The code was always correct — the first run failed on its own timing.

## 8. Deploy

- `functions:whatsappWebhook` — deployed.
- `firebase deploy --only database` — message `from` may be `app`.
- `firebase deploy --only hosting:admin` — `v5.12.78`, `chat.css?v=5.3.35`.

Wire-verified: `sw.js` reports `foodhubbie-erp-shell-v5.12.78` and precaches
`./chat.css?v=5.3.35`; `index.html` requests `chat.css?v=5.3.35`; `version.json` is
`98f4dbc.20261123T113002Z`; the deployed `chat.js` carries `chat-src-app` and the
deployed `chat.css` carries `.chat-src-app`.

## 9. Honest limits

- **No real echo has ever been observed.** The system user owns zero Meta assets
  (`granular_scopes` empty, `me/businesses` → `[]`), so no number is live on this WABA
  and no coexistence session exists to echo. The proof path is a **signed synthetic
  POST** that is byte-identical to Meta's shape. The first real echo is the moment a
  number is paired.
- **A `revoke` keeps the original bubble.** WhatsApp shows "This message was deleted";
  the dashboard shows the message that was deleted. Best-effort by choice — rewriting
  chat history on a revoke would let one tap erase what an operator already read.
- **An `edit` is not applied** for the same reason: the thread keeps the original text.
- **Echoes are best-effort**, exactly like the rest of the chat log: a failed write is
  logged and never fails the webhook (which has already answered 200).
- **No echo → inbox, ever.** If a future batch needs the bot to react to something the
  owner did on the phone, that is a new decision, not a bug in this branch.
- **`whatsapp/coexistence` is written by two paths** (echo and inbound
  `origin.type === 'business_app'`) through one helper, so a tenant can never end up
  with a half-recorded state — but there is no "coexistence is OFF" signal in the
  webhook. Meta does not send one; a number that leaves coexistence keeps a stale
  `lastSeenAt` until someone clears it.
