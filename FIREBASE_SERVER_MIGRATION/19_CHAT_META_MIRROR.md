# 19 — Chat list without message bodies: the `chatMeta` mirror

**Date:** 2026-11-11
**Question:** The Chat tab costs 267 KB of RTDB reads per Admin open while needing 9.4 KB of it — can that be fixed without touching the Firestore-shaped data model?

**Answer:** Yes. The bot now mirrors each thread's meta row to a flat `chatMeta` node (~400 B per thread, no message bodies). The Admin list reads that; message bodies load only for the thread an operator opens. **267 KB → 9.4 KB (−96 %) on a live outlet**, and the same cut applies to the WhatsApp analytics card, which was pulling the whole `chats` node for one timestamp per thread.

Two pre-existing production bugs were found and fixed on the way (§5): the **Chat tab list had been throwing on every open since `7d084f5`** and rendered empty, and the demo seeder wrote the bot pair node to a path nothing reads, so the public demo hid its own seeded conversations.

---

## 1. Why a query tweak cannot do it

`chat.js` did `onValue(chats.orderByChild('lastTs').limitToLast(50))`. `limitToLast(50)` bounds the number of **threads**, not bytes: RTDB returns whole children, so each row arrives with its entire `messages` subtree.

Measured across the 24 live threads on `roshani-pizza/pizza`:

| part | bytes | share |
|---|---|---|
| `meta` | **9.4 KB** | 3.5 % |
| `messages` | **257.1 KB** | 96.1 % |
| other | 0.5 KB | 0.4 % |

Per thread: **11.1 KB average**, the largest 126 KB (250 messages). The meta row already carries everything the list renders — `name`, `phone`, `lastTs`, `lastText`, `lastDir`, `unread` — so the preview text a customer last sent is *already* in the cheap row.

RTDB has no "select these fields" projection. The only way to read 9 KB instead of 267 KB is for those 9 KB to live at their own path. Hence a mirror, not a query change.

## 2. Design

```
businesses/{bid}/outlets/{oid}/
  chatMeta/{customerId}/          <- Admin list + analytics read ONLY this
      { name, phone, lastTs, lastText, lastDir, unread }
  chats/{customerId}/
      meta/                       <- still written (cached older shells read it)
      messages/{msgId}            <- read only for the one open thread
```

- **Writer:** `bot/chat-log.js`, the sole writer of chat meta. After its existing `chats/{id}/meta` transaction it writes the transaction's own snapshot to `chatMeta/{id}`. One extra small write per message; the two nodes can never disagree because the mirror is the snapshot, not a recomputation.
- **List reader:** `Admin/js/features/chat.js` binds `query(chatMeta, orderByChild('lastTs'), limitToLast(50))`. No message bodies.
- **Thread reader:** `_bindThreadMessages(customerId)` attaches `chats/{id}/messages` for the selected thread only, and is released on thread switch and on `cleanupChat()`.
- **Unread clear:** writes both `chatMeta/{id}/unread` and `chats/{id}/meta/unread`, so the mirror and the nested copy stay consistent.
- **Second reader:** `Admin/js/features/wa-analytics.js` (WhatsApp Bot analytics card, mounted from the Reports tab) only needs `meta.lastTs` per thread; it now reads `chatMeta` and tolerates either shape. That card used to drag the full 267 KB on every Reports open too.
- **Rules:** `chatMeta` has exactly the `chats` grants (`.read`/`.write` identical, verified programmatically), `.indexOn: ["lastTs"]` for the list query, and a `$customerId` validate copied from `chats/{id}/meta` so a malformed row cannot be written.

`chats/{id}/meta` stays dual-written: an admin whose browser is still running the previous shell reads it, and dropping it later is its own small batch.

## 3. Backfill

`tools/backfill-chat-index.cjs` (dry-run default, `--apply`, optional `--bid/--oid`) walks every `businesses/*/outlets/*/chats/*/meta` and writes the mirror row. A meta written by an older bot build can be missing fields, so the script normalises to the six validated keys (defaults identical to `chat-log.js`) — a mirror row that failed validation would silently drop that thread from the list.

Live run: **27 threads** (24 pizza + 3 demo), **10.0 KB**, verified read-back 27/27, idempotent on re-run ("24 already correct").

## 4. Measured result

| | before | after |
|---|---|---|
| Chat list (24 threads) | 267.2 KB | **9.4 KB** |
| WhatsApp analytics card | 267.2 KB | **9.4 KB** |
| Opening one thread | 0 extra (already downloaded) | 11.1 KB average, that thread only |
| Demo tenant, Chat tab activation (all WS frames) | — | **1.9 KB** |

Per-open saving on a live outlet: **~515 KB across the two surfaces** — and it stops growing with conversation history, because the list no longer contains history.

## 5. Two production bugs found while verifying

**(a) The Chat tab list had been dead since `7d084f5` ("Firebase optimization (limitToLast 50)").** That commit added `.orderByChild('lastTs').limitToLast(50)` to `_chatRef('')`, but `Outlet.ref()` returns a modular **Reference**, which has no query methods:

```
u.ref(...).orderByChild is not a function
```

`switchTab` catches load errors, so the tab painted its shell and an empty list — no crash, no red banner, nothing to notice unless you were looking for conversations. Confirmed in a real browser: clicking Chat logged the TypeError and `#chatThreadList` stayed empty. Fixed properly with `query(ref, orderByChild('lastTs'), limitToLast(50))`; ordering now also uses the new `.indexOn`.

**(b) The demo seeded its bot pair where nothing reads it.** `seed-demo-tenant.cjs` wrote `bot/{oid}/pair`, while `chat.js _checkBotStatus()` reads `bot/pair`; with no `bot/pair` the demo outlet shows the full-screen "Connect Your WhatsApp Bot" onboarding **over** its 3 seeded conversations. The seeder now writes `bot/pair` (and no longer writes the stray `bot/demo` node). Safe by construction: `outlet.whatsapp` is still absent, so `bot-control-api`'s orchestrator never spawns a worker for the demo.

Guard added: `tests/admin-query-chain.check.cjs` (`npm run test:query-chain`, a CI step) scans `Admin/js`, `SupremeAdmin/js`, `menu/js`, `website`, `rider-app/src` for any `ref(...)` chained with `orderByChild`/`limitToLast`/`startAt`/`endAt`/`endBefore`/`equalTo` — **142 files, 0 hits**. The regex was meta-tested against the historical line and does catch it.

## 6. Verification

Local E2E (`%TEMP%\opencode\e2e-chatmeta.cjs`) against the **real demo tenant** with the built shell served from `tools/serve-dist.cjs` (zero Hosting egress), **18/18**:

- 3 threads render from `chatMeta` with correct names, previews and per-thread unread badges (sum 3)
- **no message body of an unopened thread crosses the WebSocket** — proven with marker strings that exist only in `messages` ("out for delivery with Arjun", "extra cheese is ₹49"), never in `meta`
- opening Kabir's thread downloads Kabir's bodies and **not** Diya's, and both bodies render
- `chatMeta/{id}/unread` and `chats/{id}/meta/unread` both go to 0; sidebar badge 3 → 1
- WhatsApp Bot analytics reads `chatMeta` and downloads no bodies
- 0 page errors; demo fixtures restored to the seeded state

Guards: bot unit **28/28**, twins **8/8**, encoding, query-chain 142 files, rules JSON validated (chatMeta grants byte-identical to chats, `indexOn` present, demo clause count unchanged at 25).

## 7. Deploy order (why this one is rules → backfill → bot → Admin)

1. `firebase deploy --only database` — Admin cannot read a node its rules deny.
2. `node tools/backfill-chat-index.cjs --apply` — without mirror rows the list is empty for existing threads.
3. bot (`tools/server-deploy.sh`) — starts keeping the mirror current.
4. `firebase deploy --only hosting:admin` — switches the list to the mirror.

Any other order leaves a window where the list is empty (2 before 1), stale (4 before 3), or reads a node that does not exist.

## 8. Deployed live (2026-11-11)

Executed in that exact order:

| step | result |
|---|---|
| `firebase deploy --only database` | rules released (the `chatMeta` block was already in HEAD via `70dac7d`) |
| `node tools/backfill-chat-index.cjs --apply` | **27 rows / 10.0 KB** written, read-back **27/27**, re-run reports `24 already correct` (idempotent) |
| `bash tools/server-deploy.sh` on EC2 | box `4e38e1c → 5532f63`, pm2 2/6/35 restarted, pizza bot **online, baileys**, `[TENANT] outlet=pizza business=roshani-pizza` |
| `firebase deploy --only hosting:admin` | live version `5532f63.20261111T100628Z`, SW `v5.12.45` |

**Live E2E 18/18** against `https://foodhubbie-admins.web.app/demo` — the same suite that passed locally, unmodified apart from `E2E_URL`: 3 rows from `chatMeta`, body-only markers absent from the WebSocket, per-thread load, unread cleared in both nodes, badge 3 → 1, analytics on the mirror, 0 page errors, chat-list activation **1.9 KB**, fixtures restored.

**The deployed bot writes the mirror.** Ran the real `/var/www/foodhubbie/bot/chat-log.js` on the box against the demo tenant with a throwaway JID: after one customer message and one bot reply the mirror row was `{lastDir:'bot', lastText:'reply from bot', unread:1}`, byte-identical to the nested `chats/9999900001/meta`, with both messages written. Probe thread deleted; `chatMeta` back to its 3 seeded rows.

**The nightly reseed would have undone bug 5b's fix**, so the cron copy was patched too: `/home/ubuntu/demo-seed/tools/seed-demo-tenant.cjs` (cron `30 21 * * *` UTC = 03:00 IST) still wrote `[OID]: { pair: bot.pair }`. Patched to `pair: bot.pair,` with backup `.bak-20261111-chatmeta` and `node --check` OK. The box copy stays a surgical patch (its `shared/*` copies are stale; a full replace would break the cron) — the repo copy is the source of truth for future reseeds.

## 9. Reproduce

| Script (`%TEMP%\opencode`) | Proves |
|---|---|
| `chat-shape.cjs` | the meta/messages split (9.4 KB vs 257.1 KB) that decimals the whole fix |
| `demo-chats.cjs` / `demo-msgs.cjs` | the demo fixtures and the body-only marker strings the E2E uses |
| `e2e-chatmeta.cjs` | the full 18-check E2E: list from mirror, no leaked bodies, per-thread load, unread clear, analytics reader, fixture restore |
| `debug-chat.cjs` | dumps tab state + console when a Chat render fails (this is how bug 5a was found) |
| `check-chatmeta.cjs` | order-insensitive compare of every mirror row against its source meta |

## 10. Limits (honest)

- **Chat-log writes stay best-effort**, one message at a time: a message written while the bot is down is not replayed into `chatMeta` (or `chats`). Same pre-existing behaviour, unchanged by this batch.
- **Inbound-only history is preserved as-is**: `messages` ordering and rendering are untouched; only *when* they are downloaded changed.
- **`chats/{id}/meta` is still written** (dual write). Removing it needs a follow-up once no cached shell can be open — that also removes one small write per message.
- **`tableSessions` is still unbounded** (`83.2 KB` today, growing forever). That is F3 in `18_ADMIN_READ_COST_MODEL.md`, deliberately not in this batch: it needs `.indexOn openedAt` and a decision about which history the Tables tab still needs.
