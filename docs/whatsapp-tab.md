# WhatsApp Tab — Admin "Chat" Tab

> Status: **LIVE** — Admin Chat tab (customer↔bot conversation viewer) deployed on `app.foodhubbie.in`. E2E 18/18 verified on demo tenant. Bot unit 28/28.

---

## 1. Overview

The WhatsApp tab (rendered as **"Chat"** in the Admin nav) lets restaurant staff view and reply to WhatsApp conversations between customers and the bot. It is a **read-mostly** tab: message *history* is persisted by the bot; *replies* are sent through the existing `bot/commands` channel (`SEND_GENERIC_MESSAGE`) — no new send path.

**Key design decision (Batch 19):** the thread **list** reads a flat `chatMeta/{customerId}` mirror (~400 B per thread, no message bodies) instead of the `chats` node (~267 KB with message bodies on a live outlet). Message bodies load **only** for the one thread an operator opens.

---

## 2. File Inventory

| File | Role |
|------|------|
| `Admin/js/features/chat.js` | Chat module — thread list, conversation view, send, unread, block/unblock, bot onboarding QR, usage bar |
| `Admin/index.html` | Chat tab markup (`#tab-chat`, `#chatApp`, `#chatThreadList`, `#chatThreadView`, `#chatComposerInput`, `#chatSendBtn`, `#chatSearch`, `#chatTotalUnread`, `#chatUsageBar`) |
| `Admin/style.css` / `Admin/chat.css` | Chat tab styles (list pane, conversation pane, bubbles, avatars, empty state, print overrides) |
| `Admin/js/main.js` | Tab registration (`chat: { title: 'Chat', ... }`) + `chatOnWhatsapp` action |
| `Admin/js/ui.js` | Tab wiring: `loadChat()` on enter, `cleanupChat()` on exit, sidebar badge + nav list entry (`['chat', 'WhatsApp Chat']`) |
| `bot/chat-log.js` | **Writer**: `logChatMessage()` persists inbound + outbound messages + thread meta under `chats/{id}/` + `chatMeta/{id}` |
| `bot/index.js` | Hooks `logChatMessage` into `messages.upsert` (inbound) and the outbound send wrapper |
| `database.rules.json` | RTDB rules for `chats` / `chatMeta` (outlet-scoped read/write, `.indexOn ["lastTs"]`, `$customerId` validation) |
| `tools/backfill-chat-index.cjs` | One-time (idempotent) build of `chatMeta` from existing `chats/{id}/meta` for pre-batch-19 threads |
| `tools/backfill-chat-index.cjs` dry-run | Default mode — prints what would be written, writes nothing |
| `tests/app-notifications.check.mjs` | Static guard — duplicate DOM ids, id existence, wiring idempotency (20/20) |
| `bot/tests/unit.test.js` | Bot unit suite — 28/28 (includes chat-log / clock-pinned promo guard) |
| `tests/admin-query-chain.check.cjs` | CI step — fails the `.orderByChild` bug class across 142 files |
| `docs/whatsapp-templates.md` | Approved WABA message templates (14: 6 MARKETING + 8 UTILITY) |

---

## 3. Data Model

### `businesses/{bid}/outlets/{oid}/chats/{customerId}/`
```
meta: {
  name: string,            // customer display name
  phone: string,           // full JID (9197...@s.whatsapp.net)
  lastTs: number,          // epoch ms
  lastText: string,
  lastDir: 'customer' | 'bot',
  unread: number           // counts customer->bot only
}
messages/{msgId}: {
  from: 'customer' | 'bot',
  text: string,
  ts: number,
  type: 'text' | 'location'
}
```

### `businesses/{bid}/outlets/{oid}/chatMeta/{customerId}/` (flat mirror)
Same shape as `meta` above. This is the **list source of truth**. One row per thread, ~400 B, no message bodies.

**Thread key** = last-10-digits of the sender JID (e.g. `919724649971@s.whatsapp.net` → `9724649971`). Matches `customers/{cleanPhone}` convention. Caveat: drops country code — +1 and +91 customers with same local number share a thread.

---

## 4. Data Flow

### Inbound (customer → bot)
1. Baileys `messages.upsert` fires in `bot/index.js`
2. Text extracted (`conversation` / `extendedTextMessage` / button replies / list replies)
3. Blocklist + opt-out (STOP/START) checked first
4. `logChatMessage({ outlet, jid, msgId, from:'customer', text, name })` → writes `chats/{id}/messages/{msgId}` + bumps `chats/{id}/meta` + mirrors to `chatMeta/{id}`
5. Order flow / loyalty / discount / inventory handlers run **after** chat-log (all best-effort, never block the order path)

### Outbound (bot/staff → customer)
1. Admin opens a thread, types, hits Send
2. `_sendMessage()` pushes `{ action:'SEND_GENERIC_MESSAGE', phone, message, timestamp }` to `bot/commands`
3. Bot's command handler sends via Baileys / Meta transport
4. Outbound hook calls `logChatMessage({ ..., from:'bot', text })` → optimistic echo renders instantly, replaced on next sync
5. `SEND_GENERIC_MESSAGE` is **intentionally NOT blocked** by the promo freeze (Admins can always 1:1 reply)

### Thread list (Admin opens Chat tab)
1. `loadChat()` binds `query(Outlet.ref('chatMeta'), orderByChild('lastTs'), limitToLast(50))`
2. On snapshot: rebuilds `_chatData`, keeps any in-memory messages for the open thread
3. Renders thread list sorted by `lastTs` desc, with unread badges
4. Opens a thread → `_bindThreadMessages(customerId)` attaches `chats/{id}/messages` listener (released on thread switch / cleanup)

### WhatsApp bot onboarding (Admin connects a number)
1. `_checkBotStatus()` listens to `bot/pair` (Baileys QR pair) + `whatsapp/status` (Meta Embedded Signup)
2. If neither is connected → shows QR onboarding modal ("Connect Your WhatsApp Bot")
3. Baileys path: scan QR with WhatsApp Linked Devices
4. Meta path: Supreme Admin → WhatsApp number wizard (`whatsapp-manage.js`) → Embedded Signup popup (`whatsapp-linking.js`) → server-side `/api/whatsapp/exchange`

---

## 5. Database Rules

Both `chats` and `chatMeta` share identical grants:

```
.read: auth != null && (
  root.child('admins').child(auth.uid).child('outlet').val() == $outletId
  || root.child('admins').child(auth.uid).child('isSuper').val() == true
  || root.child('admins').child(auth.uid).child('isSupreme').val() == true
)
.write: same as .read
```

Validation (`$customerId` level):
- Must have children: `name`, `phone`, `lastTs`, `lastText`, `lastDir`, `unread`
- `lastTs` must be number, `unread` must be number
- Messages `$msgId`: must have `from`/`text`/`ts`/`type`; `from` must be `customer` or `bot`; `ts` must be number

Index: `.indexOn ["lastTs"]` on both nodes (required for `orderByChild('lastTs')` in the list query).

**Rules deploy order (critical):** `database` deploy must happen **before** the Admin shell that reads `chatMeta`, otherwise the list is empty. Full order: `rules → backfill → bot → Admin`.

---

## 6. Deploy Order

```
1. firebase deploy --only database          # chatMeta rules + .indexOn
2. node tools/backfill-chat-index.cjs --apply  # mirror pre-batch-19 threads
3. (EC2) tools/server-deploy.sh              # bot/chat-log.js + bot/index.js hooks
4. firebase deploy --only hosting:admin      # Admin shell + chat.js
```

Any other order leaves the list empty, stale, or reading a node that does not exist.

---

## 7. Test Status

| Suite | Result | Notes |
|-------|--------|-------|
| `tests/app-notifications.check.mjs` | 20/20 | Duplicate DOM ids, id existence, wiring idempotency, quiet-hours gate, send history |
| `bot/tests/unit.test.js` | 28/28 | Bot unit incl. chat-log / clock-pinned promo guard |
| `tests/admin-query-chain.check.cjs` | CI step | Fails the `.orderByChild` bug class across 142 files |
| Live E2E | 18/18 | On `foodhubbie-admins.web.app/demo`: list from mirror, body-only markers prove no unopened thread's messages cross WS, unread cleared both nodes, badge 3→1, chat-list activation 1.9 KB |
| Deployed-bot proof (EC2) | pass | Throwaway thread → `unread:1` after 1 customer + 1 bot msg, mirror === nested |

**Two pre-existing production bugs fixed during chat work:**
1. Chat list threw on every open since `7d084f5` — `Outlet.ref()` returns a modular `Reference` with no `.orderByChild` ("`u.ref(...).orderByChild is not a function`"). Fixed: ordering now goes through `query()`.
2. `tools/seed-demo-tenant.cjs` wrote bot pair to `bot/{oid}/pair` while `chat.js` reads `bot/pair` — demo covered its own seeded conversations with "Connect Your WhatsApp Bot" onboarding. Fixed: nightly EC2 cron copy patched same way (backup `.bak-20261111-chatmeta`).

---

## 8. Known Limits

| Limit | Detail |
|-------|--------|
| Thread key drops country code | +1 and +91 customers with same local 10 digits share a thread. Matches `customers/{cleanPhone}` convention; revisit only if non-IN numbers appear. |
| Message types | Only `text` and `location` rendered; other types show `<media>`. |
| Reply path | Replies go through `bot/commands` → `SEND_GENERIC_MESSAGE` — subject to the same transport/pacing as bot outbound. No read-receipts, typing indicators, or media send from Admin. |
| Block/unblock | Stored in `window.__blockedNumbers` (in-memory per page session) — not persisted to RTDB. Refresh clears blocks. |
| Bot status | Baileys (`bot/pair`) + Meta (`whatsapp/status` = 'active'). Supreme-managed WABA outlets skip Baileys pair chain. |
| Read-only tab | Admin cannot delete threads or edit messages. Moderation = block/unblock contact only. |

---

## 9. Related Docs

- `docs/whatsapp-templates.md` — Approved WABA message templates (14 templates, 6 MARKETING + 8 UTILITY)
- `docs/BILLING-MODEL.md` §4 — WhatsApp message cost model (utility ₹0.115, marketing ₹0.8631, service free tier 1,000/mo)
- `FIREBASE_SERVER_MIGRATION/11_RTDB_COST_INCIDENT.md` — RTDB egress incident (chats was 267.2 KB of the 618.3 KB outlet; `chatMeta` mirror reduced list load to 9.4 KB)
- `FIREBASE_SERVER_MIGRATION/14_WALLET_GATE_SINGLE_WRITER.md` — Wallet gate single-writer (unrelated to chat but same RTDB egress cleanup batch)

---

## 10. Quick Reference

**Open the tab:** Admin → sidebar → "WhatsApp Chat" (`#tab-chat`)

**Send a reply:** Open a thread → type in composer → Enter or click Send

**Block a contact:** Thread 3-dot menu → "Block Contact" (or list 3-dot → "Blocked Contacts")

**Connect a bot:** If not connected → QR onboarding modal appears → scan with WhatsApp Linked Devices (Baileys) OR Supreme Admin → WhatsApp number → Embedded Signup (Meta)

**Backfill (one-time):** `node tools/backfill-chat-index.cjs --apply`

**Rules guard:** `node tools/check-server-branch.cjs` (CI: server must be ancestor of main)
