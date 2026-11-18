# WhatsApp Tab — Admin "Chat" Tab

> Status: **LIVE** — Admin Chat tab (customer↔bot conversation viewer) deployed on `app.foodhubbie.in`. Live E2E on the production demo tenant (`app.foodhubbie.in/demo`): thread list, filters, labels CRUD + assignment, archive, block/unblock and the 24 h reply-window guard all verified, 0 console errors. Guard: `tests/chat-tab.check.cjs` (42+ checks).

---

## 1. Overview

The WhatsApp tab (rendered as **"Chat"** in the Admin nav) lets restaurant staff view and reply to WhatsApp conversations between customers and the bot. It is a **read-mostly** tab: message *history* is persisted by the bot; *replies* are sent through the existing `bot/commands` channel (`SEND_GENERIC_MESSAGE`) — no new send path.

**Key design decision (Batch 19):** the thread **list** reads a flat `chatMeta/{customerId}` mirror (~400 B per thread, no message bodies) instead of the `chats` node (~267 KB with message bodies on a live outlet). Message bodies load **only** for the one thread an operator opens.

**Customer-data pattern (WhatsApp Business parity, batch 24):** the tab now manages customers the way WhatsApp Business does — **labels/customer lists** (max 20), **archive**, a **persisted block list**, and an explicit **24 h customer-service reply window** that tells the operator when a free-form reply stops being free. All per-thread Admin state lives in a **separate node** (`chatState/{customerId}`) because the bot rewrites `chatMeta/{id}` with `set()` on every inbound message and would wipe anything stored there.

---

## 2. File Inventory

| File | Role |
|------|------|
| `Admin/js/features/chat.js` | Chat module — thread list, conversation view, send, unread, block/unblock, bot onboarding QR, usage bar |
| `Admin/js/chat-contacts-math.js` | **Pure** contact logic (no Firebase/DOM → Node-testable): `normalizePhone`, `replyWindow`, `windowLabel`, `labelId`, `stripLabelFromState`, `MAX_LABELS = 20`, `CUSTOMER_WINDOW_MS = 24 h` |
| `Admin/js/chat-contacts.js` | **I/O singleton** shared by `chat.js` + `settings.js`: block list, label library, per-thread state, live `onValue` subscriptions re-bound on outlet change |
| `Admin/index.html` | Chat tab markup (`#tab-chat`, `#chatApp`, `#chatThreadList`, `#chatThreadView`, `#chatComposerInput`, `#chatSendBtn`, `#chatSearch`, `#chatTotalUnread`, `#chatUsageBar`) + filters (`#chatFilterTabs`), label chips (`#chatLabelChips`), load-more (`#chatLoadMore`), window badge/notice (`#chatThreadWindow`, `#chatWindowNotice`), thread labels (`#chatThreadLabels`) and the two modals (`#chatLabelsModal`, `#blockedContactsModal`) |
| `Admin/style.css` / `Admin/chat.css` | Chat tab styles (list pane, conversation pane, bubbles, avatars, empty state, label chips, window badge, print overrides) |
| `Admin/js/main.js` | Tab registration (`chat: { title: 'Chat', ... }`) + `chatOnWhatsapp` action |
| `Admin/js/ui.js` | Tab wiring: `loadChat()` on enter, `cleanupChat()` on exit, sidebar badge + nav list entry (`['chat', 'WhatsApp Chat']`) |
| `bot/chat-log.js` | **Writer**: `logChatMessage()` persists inbound + outbound messages + thread meta under `chats/{id}/` + `chatMeta/{id}` |
| `bot/index.js` | Hooks `logChatMessage` into `messages.upsert` (inbound) and the outbound send wrapper |
| `database.rules.json` | RTDB rules for `chats` / `chatMeta` (outlet-scoped read/write, `.indexOn ["lastTs"]`, `$customerId` validation) **+ `chatLabels` / `chatState`** (outlet-scoped, label-integrity validated) |
| `tools/backfill-chat-index.cjs` | One-time (idempotent) build of `chatMeta` from existing `chats/{id}/meta` for pre-batch-19 threads |
| `tools/backfill-chat-index.cjs` dry-run | Default mode — prints what would be written, writes nothing |
| `tests/chat-tab.check.cjs` | Chat-tab guard (42+ checks): DOM ids exist, modals live **after `</main>`** (a modal inside a hidden tab pane can never be seen), `.modal.active` pattern, map-shaped labels, rules use no Firestore-only helpers, 24 h window math, behavioural assertions on the pure module |
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

### `businesses/{bid}/outlets/{oid}/chatLabels/{labelId}/` (label library)
```
{
  name: string,             // display name ("VIP", "Festival orders")
  color: string,            // '#ef4444' — one of 8 palette colours
  createdAt: number
}
```
Max **20 labels** (WhatsApp Business parity). The cap is enforced **client-side** (hard throw + visible error); the rules enforce tenancy and label integrity only. Label id = slug of the name (`labelId()` in the pure module), so renaming a label keeps its id (and every thread that carries it).

### `businesses/{bid}/outlets/{oid}/chatState/{customerId}/` (per-thread Admin state)
```
{
  labels: { [labelId]: true },   // MAP, not an array (see below)
  archived: boolean
}
```
**Why a map and not an array:** Realtime Database rules have **no `isArray`, no `size()` and no `hasOnly()`** (those are Firestore helpers — `firebase deploy` rejects a ruleset that uses them). An array's length therefore cannot be bounded by rules at all. With a map, every label id is its own rules path, so the rules can enforce a **real integrity guarantee**: a thread can only carry a label that exists in `chatLabels`.

**Label deletion order is threads-first, library-last** — because the rules require an assigned label to still exist in the library. `stripLabelFromState()` (pure) removes the label from every thread before `chatLabels.remove()` runs.

### `businesses/{bid}/outlets/{oid}/settings/Bot/blockedNumbers` (persisted block list)
A JSON array of **digit-only** phone numbers (e.g. `["919000000999"]`), **not** JIDs. The bot's `isBlockedJid()` strips non-digits and compares with `endsWith`, so a stored JID (`919000000999@s.whatsapp.net`) would never match and the block would silently do nothing. The Chat tab and the Settings tab share one implementation (`Admin/js/chat-contacts.js`) so the two screens can never drift.

### 24 h customer-service reply window (derived, not stored)
The window is **derived** from the thread's last **customer** message (`chats/{id}/messages`, `from === 'customer'`), not from the last message of any direction — our own reply does **not** extend it. State is one of `open` / `closed` / `unknown` (bodies not loaded yet → "unknown", never "closed"). Outside the window a free-form reply is billed as a **service message** on the official WhatsApp API (and is rejected outright once the 24 h window has fully closed), so the Send button asks for a **second deliberate confirmation** before sending.

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

### Contact management (batch 24)
1. `Admin/js/chat-contacts.js` subscribes (live `onValue`) to `settings/Bot/blockedNumbers`, `chatLabels` and `chatState`; subscriptions are released and re-bound on outlet change.
2. **Block** → `blockedContacts.block(phone)` writes the **digit-only** number into `settings/Bot/blockedNumbers`; the bot's live listener ignores that contact from then on. **Unblock** removes it.
3. **Create label** → `chatLabels.create(name)` (max 20) → the chip row re-renders with a live per-label chat count.
4. **Assign label** → `chatState.toggleLabel(customerId, labelId)` writes `labels/{labelId}: true` (map). The thread shows the label tag; the chip filter narrows the list.
5. **Archive** → `chatState.setArchived(customerId, true)`; the thread leaves the "All"/"Unread" lists and appears under "Archived". The menu item text follows the state ("Archive chat" ↔ "Unarchive chat").
6. **Delete label** → the label is stripped from every thread first (`stripLabelFromState`), then the library entry is deleted — the order the rules require.
7. **Reply outside the 24 h window** → the first Send click shows a warning + amber button ("click again to send anyway"); the second click sends. Inside the window the send is immediate.

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

### `chatLabels` + `chatState` (batch 24)
Both nodes carry the **same outlet-scoped grant** as `chats`/`chatMeta` (outlet admin, super, supreme):

```
.read / .write: auth != null && (
  root.child('admins').child(auth.uid).child('outlet').val() == $outletId
  || root.child('admins').child(auth.uid).child('isSuper').val() == true
  || root.child('admins').child(auth.uid).child('isSupreme').val() == true
)
```

Validation:
- `chatLabels/$labelId` → must have a `name` (string, 1–24 chars)
- `chatState/$customerId` → `archived` (if present) must be a **boolean**
- `chatState/$customerId/labels/$labelId` → must be a **boolean** flag **and** the label must exist in `chatLabels`:
  `newData.isBoolean() && root.child('businesses').child($businessId).child('outlets').child($outletId).child('chatLabels').child($labelId).exists()`

**Rules deploy order (critical):** `database` deploy must happen **before** the Admin shell that reads `chatMeta`, otherwise the list is empty. Full order: `rules → backfill → bot → Admin`.

---

## 6. Deploy Order

```
1. firebase deploy --only database          # chatMeta rules + .indexOn (+ chatLabels/chatState)
2. node tools/backfill-chat-index.cjs --apply  # mirror pre-batch-19 threads
3. (EC2) tools/server-deploy.sh              # bot/chat-log.js + bot/index.js hooks
4. firebase deploy --only hosting:admin      # Admin shell + chat.js
```

Any other order leaves the list empty, stale, or reading a node that does not exist.

**Served-file rule:** the Admin Service Worker is network-first for app code, but any file the SW **precaches** (`Admin/sw.js` `ASSETS_TO_CACHE`) must be re-bumped in the same change — otherwise a returning browser mixes an old cached module with a fresh one. Batch 24 bumped the shell to `foodhubbie-erp-shell-v5.12.63` and added `chat.css?v=5.3.34`.

**Modal placement rule:** the two chat modals live **after `</main>`**, not inside `#tab-settings`. A modal nested in a hidden tab pane inherits `display:none` and can never be opened — this was one of the bugs the batch-24 E2E caught.

---

## 7. Test Status

| Suite | Result | Notes |
|-------|--------|-------|
| `tests/chat-tab.check.cjs` | 42+ checks | DOM ids exist, modals after `</main>`, `.modal.active` pattern, map-shaped labels, rules free of Firestore-only helpers, 24 h window math, behavioural assertions on the pure module |
| `tests/app-notifications.check.mjs` | 20/20 | Duplicate DOM ids, id existence, wiring idempotency, quiet-hours gate, send history |
| `bot/tests/unit.test.js` | 28/28 | Bot unit incl. chat-log / clock-pinned promo guard |
| `tests/admin-query-chain.check.cjs` | CI step | Fails the `.orderByChild` bug class across 142 files |
| Live E2E (batch 24) | pass | On `app.foodhubbie.in/demo` (production tenant + production rules): label created → assigned to a thread → chip filter narrows the list → thread archived → "Archived" filter shows it; block writes `919000000999` (digits) and the button flips to "Unblock Contact"; the 30 h-old fixture thread shows "Reply window closed" + the amber two-step Send guard; 0 console errors. Every fixture restored **byte-identically** afterwards. |
| Rules probe (batch 24) | 5/5 | Real client token: map write ✅, no-labels write ✅, bogus label id → 401, non-boolean `archived` → 401, array-shaped labels → 401, label-library write ✅ |
| Live E2E (batch 19) | 18/18 | On the Admin demo: list from mirror, body-only markers prove no unopened thread's messages cross WS, unread cleared both nodes, badge 3→1, chat-list activation 1.9 KB |
| Deployed-bot proof (EC2) | pass | Throwaway thread → `unread:1` after 1 customer + 1 bot msg, mirror === nested |

**Pre-existing production bugs fixed during chat work:**
1. Chat list threw on every open since `7d084f5` — `Outlet.ref()` returns a modular `Reference` with no `.orderByChild` ("`u.ref(...).orderByChild is not a function`"). Fixed: ordering now goes through `query()`.
2. `tools/seed-demo-tenant.cjs` wrote bot pair to `bot/{oid}/pair` while `chat.js` reads `bot/pair` — demo covered its own seeded conversations with "Connect Your WhatsApp Bot" onboarding. Fixed: nightly EC2 cron copy patched same way (backup `.bak-20261111-chatmeta`).

**Bugs found and fixed by the batch-24 E2E (before deploy):**
1. Label deletion read a variable from inside a write-loop callback → `ReferenceError`. Fixed: pure `stripLabelFromState()`.
2. `loadChat()` never wired the labels modal → opening it did nothing. Fixed: `_wireLabelsModal()` is now called from `loadChat`.
3. The modals used the `hidden` attribute instead of the Admin's `.modal` + `.active` pattern → invisible/unclickable.
4. Both modals were nested inside the hidden `#tab-settings` pane → moved after `</main>`.
5. The Send button kept its amber warning after a normal send → cleared.
6. The archive menu item had a static label ("Archive chat") even when the thread was archived → now follows the state ("Unarchive chat").

---

## 8. Known Limits

| Limit | Detail |
|-------|--------|
| Thread key drops country code | +1 and +91 customers with same local 10 digits share a thread. Matches `customers/{cleanPhone}` convention; revisit only if non-IN numbers appear. |
| Message types | Only `text` and `location` rendered; other types show `<media>`. |
| Reply path | Replies go through `bot/commands` → `SEND_GENERIC_MESSAGE` — subject to the same transport/pacing as bot outbound. No read-receipts, typing indicators, or media send from Admin. |
| Label cap | 20 labels, enforced **client-side** only (the rules cannot bound an array/map size in RTDB). A tenant admin who bypasses the UI could exceed it; the rules still guarantee every assigned label exists in the library. |
| Reply-window accuracy | The window is derived from the **loaded** message bodies of the open thread. A thread whose bodies have not loaded yet shows "unknown", not "closed". On the **official** Meta API a closed window is rejected by the API itself — the UI guard is an advisory warning, not an enforcement. |
| Block list scope | `settings/Bot/blockedNumbers` is **outlet-scoped** and digit-only; the bot matches with `endsWith`, so a stored number also blocks that number's other JIDs (country-code variants). |
| Bot status | Baileys (`bot/pair`) + Meta (`whatsapp/status` = 'active'). Supreme-managed WABA outlets skip Baileys pair chain. |
| Read-only tab | Admin cannot delete threads or edit messages. Moderation = block/unblock, labels and archive only. |
| Archived threads | Archive is a **view-level** state — the bot keeps receiving and logging messages; archived threads still count in the usage/unread totals until read. |

---

## 9. Related Docs

- `docs/whatsapp-templates.md` — Approved WABA message templates (14 templates, 6 MARKETING + 8 UTILITY)
- `docs/BILLING-MODEL.md` §4 — WhatsApp message cost model (utility ₹0.115, marketing ₹0.8631, service free tier 1,000/mo)
- `FIREBASE_SERVER_MIGRATION/11_RTDB_COST_INCIDENT.md` — RTDB egress incident (chats was 267.2 KB of the 618.3 KB outlet; `chatMeta` mirror reduced list load to 9.4 KB)
- `FIREBASE_SERVER_MIGRATION/14_WALLET_GATE_SINGLE_WRITER.md` — Wallet gate single-writer (unrelated to chat but same RTDB egress cleanup batch)

---

## 10. Quick Reference

**Open the tab:** Admin → sidebar → "WhatsApp Chat" (`#tab-chat`)

**Send a reply:** Open a thread → type in composer → Enter or click Send. Outside the 24 h window the button asks for a second click.

**Filter chats:** the "All / Unread / Archived" tabs; a label chip narrows the list to one customer list; "Load older chats" raises the query limit by 50 and re-binds the listener.

**Manage labels:** list 3-dot → "Manage labels" → create / rename / delete (max 20). Assign to a thread: thread 3-dot → "Labels".

**Archive a chat:** thread 3-dot → "Archive chat" (the item becomes "Unarchive chat" when archived).

**Block a contact:** Thread 3-dot menu → "Block Contact" (or list 3-dot → "Blocked Contacts"). Blocks are **persisted** to `settings/Bot/blockedNumbers` and take effect for the bot immediately.

**Connect a bot:** If not connected → QR onboarding modal appears → scan with WhatsApp Linked Devices (Baileys) OR Supreme Admin → WhatsApp number → Embedded Signup (Meta)

**Backfill (one-time):** `node tools/backfill-chat-index.cjs --apply`

**Guards:** `node tests/chat-tab.check.cjs` (chat tab), `node tests/customer-public-reads.check.cjs` (public-read contract), `node tools/check-server-branch.cjs` (CI: server must be ancestor of main)
