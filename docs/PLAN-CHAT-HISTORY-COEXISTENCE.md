# Plan — WhatsApp Coexistence + Chat History Tab

**Status:** ⬜ planned (not started)
**Date:** 2026-08-17
**Owner directive:** *"can i manage and operate the WhatsApp + Coexistence feature use and directly connect from supreme admin with least taps and clicks...and also plan to make a new tab with same WhatsApp real app ui and ux in Admin Dashboard of the restaurant... Build a Chat history tab."*

---

## 0. The two features, and which is real code vs which is guidance

There are **two distinct asks**. They must not be conflated:

| Feature | What it really is | Who can build it |
|---|---|---|
| **A. Coexistence management in Supreme Admin** | Meta's *WhatsApp Business App + Cloud API on the same number* feature. It is **enabled on Meta's side** (Business App v2.24.17+, onboarding flow in WhatsApp Manager with QR scan + consent). There is **no Graph API toggle** for coexistence — it is an app-side/dashboard-side flow. | We can: **detect** coexistence status (webhook `origin` field), **surface** a status card, and **guide** the owner through enabling it with the fewest taps. We cannot programmatically flip it. |
| **B. Chat history tab in Admin dashboard** | A WhatsApp-UI-style conversation viewer for restaurant staff, reading real bot conversations. The bot currently stores **zero** message content, so this needs **new persistence + a new tab + reply wiring**. | Fully ours. This is the main build. |

**Key honest framing for Feature A:** "least taps and clicks" for coexistence = one button in Supreme Admin that shows current status and walks the owner through the 3-tap Meta flow with a deep link. We record intent/status in Firebase so the dashboard reflects it. Anything claiming a magic "enable coexistence" API call would be fiction.

---

## 1. Feature A — Coexistence status + guided enable (Supreme Admin)

### 1.1 Reality check (verified via web research, 2026)
- WhatsApp Coexistence lets one number run on the **WhatsApp Business App AND the Cloud API simultaneously**. Messages sent from either side are mirrored to the other in real time via webhooks.
- **Enabling** requires: WhatsApp Business app version ≥ 2.24.17, the number actively used in the Business App, a Solution Partner / Tech Provider onboarding flow, supported country code. It is done **in the WhatsApp Business App / WhatsApp Manager**, not via API.
- **What webhooks give us:** Meta messages delivered under coexistence carry an `origin` field (`origin.type` = `"business_app"` | `"update"`). We can capture this in `webhook-server` to know the number is in coexistence mode.
- **Free API sends:** messages sent from the Business App are free; API sends are billed. Throughput capped (~5 mps) while coexistence is on.
- **Trade-offs to surface to the owner:** disappearing messages, view-once, live-location, broadcast lists, edit/revoke all disable in the app while coexistence is active.

### 1.2 What we build (Supreme Admin)
New card in the WhatsApp section (`restaurant-profile.js` → WhatsApp → `whatsapp-manage.js`), shown only when a number is **connected**:

1. **Status line** — reads `outlet.whatsapp.coexistence` (written by webhook detection):
   - `"Business App mirroring is ON"` (green pill) — staff can see bot chats on their phone app.
   - `"Business App mirroring is OFF"` (grey pill) + an **Enable** button.
2. **Enable flow (least taps, 3 taps):** the Enable button opens a small expandable with exactly:
   1. Tap the deep link → opens WhatsApp Manager / Business App onboarding.
   2. Scan the QR with the restaurant's WhatsApp Business App.
   3. Confirm chat-history consent.
   Then a "I've enabled it" button that flips the UI to ON (records `coexistence.enabledAt` + `by` for audit). The webhook `origin` detection then confirms it automatically on the next mirrored message.
3. **Trade-off note** — one-line copy: "While mirroring is on, disappearing messages / view-once / live-location are disabled in the app."

### 1.3 Detection wiring (webhook-server)
- In `webhook-server/index.js`, after parsing `change.messages[0]`: read `msg.origin?.type`. If `"business_app"` or `"update"` → `admin.database().ref(\`businesses/${bid}/outlets/${oid}/whatsapp\`).update({ coexistence: { mode: 'business_app', lastSeenAt: Date.now() } })` (best-effort, `.catch(()=>{})`). If no `origin` for several consecutive messages, leave as-is (do not auto-flip OFF — owner may have disabled it in-app, which we can't see).
- **No new endpoint needed** for the status card — SupremeAdmin already reads the shared `businesses` snapshot.

### 1.4 Files touched (Feature A)
| File | Change |
|---|---|
| `webhook-server/index.js` | Detect `origin.type` → write `outlet.whatsapp.coexistence` |
| `SupremeAdmin/js/features/whatsapp-manage.js` | Status pill + Enable expandable + "I've enabled it" action |
| `SupremeAdmin/css/style.css` | 2 small classes (mirroring pill) |
| `docs/WHATSAPP-ONBOARDING-FULL-FLOW.md` | One-line note that coexistence is app-side, we only detect/guide |

**Verification (A):** send a synthetic webhook with `origin.type:"business_app"` → `outlet.whatsapp.coexistence` appears in Firebase; Supreme Admin card flips to ON on next re-render.

---

## 2. Feature B — Chat History tab in Admin dashboard (the main build)

### 2.1 Current state (verified by reading code)
- **The bot stores NO message content.** Inbound (`bot/index.js:1262` `messages.upsert`) and outbound (`bot/index.js:1028` `sendMessage` patch) only `console.log`. The only persisted "message-like" data is `bot/logs/{orderId}` (send diagnostics, not conversation).
- **Existing building blocks we reuse (do not reinvent):**
  - Inbound choke point: `bot/index.js:1262` — has `sender` JID, `text`, `pushName`, `msg.id`.
  - Outbound choke point: `bot/index.js:1028-1050` — has `jid`, `content.text/caption`.
  - **Reply channel already exists:** `SEND_GENERIC_MESSAGE` command → `bot/commands/{id}` `{ action:'SEND_GENERIC_MESSAGE', phone, message }` → handled at `bot/index.js:301-320` (template first, text fallback). The Admin side already writes these commands today.
  - Tenant path helpers: `bot/firebase.js` `resolvePath`; Admin `Outlet.ref()`.
  - Admin tab pattern: nav `<li>` + `#tab-{id}` div + `ui.js` `switchTab` case + `features/{name}.js`; dynamic import picks it up automatically; build via `tools/build.mjs` (PurgeCSS safelist needed for dynamic `chat-*` classes).

### 2.2 Data model (new Firebase node)
All under `businesses/{bid}/outlets/{oid}/`:

```
chats/
  {customerId}/                          # customerId = last-10-digits of sender (matches customers/ keys)
    meta/                                # one write per message
      { name, phone, lastTs, lastText, lastDir, unread }
    messages/
      {msgId}
        { from: 'customer'|'bot', text, ts, type, orderId? }
```

- `customerId`: `sender.replace(/[^0-9]/g,'').slice(-10)` — **same convention as `customers/{cleanPhone}`** and the opt-out keys. Guarantees both Baileys JIDs (`9197...@s.whatsapp.net`) and Meta `from` (`9197...`) map to one thread.
- `msgId`: `msg.key.id` (inbound) / `result.key.id` (outbound) — dedup for free.
- `unread`: incremented by bot on **customer→bot** messages; cleared when an admin opens the thread (read marker).
- `from`: `'customer'` = inbound, `'bot'` = outbound.
- `type`: `'text'` | `'location'` | `'image'` | `'order'` (for future media; MVP stores text + location, everything else as `text: '<media>'`).

**PII segregation (critical, mirrors `tableSessionsContact` decision):** chat content contains customer phone numbers + message text. The node must be **auth-gated to admins only** — see §2.5 rules. It is NOT world-readable and NOT readable by riders.

### 2.3 Bot persistence — two hooks (exact locations)

**Hook 1 — inbound, `bot/index.js` `messages.upsert` handler (after line 1293 `if (msg.key.fromMe) return;`, after dedup ~1298):**
```js
const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
const customerId = sender.replace(/[^0-9]/g, '').slice(-10);
const msgId = msg.key?.id || `${Date.now()}`;
// write message + bump meta (best-effort, fire-and-forget)
db.ref(resolvePath(`chats/${customerId}/messages/${msgId}`, OUTLET))
  .set({ from: 'customer', text: text || '<media>', ts: Date.now(), type: 'text' })
  .catch(() => {});
bumpChatMeta(OUTLET, customerId, { name: pushName, phone: sender, lastText: text || '<media>', lastDir: 'customer' }, true); // +1 unread
```
Do this **after** the promo opt-out handler so STOP/START messages still get logged (they're customer messages too — the opt-out branch returns early, so place the chat write *before* the opt-out check but after dedup, so STOP/START still appear in chat).

**Hook 2 — outbound, `bot/index.js:1028` `sendMessage` patch (inside the `try`, after a successful send, next to the existing quota code at 1040-1044):**
```js
const jidDigits = String(jid).replace(/[^0-9]/g, '').slice(-10);
if (jidDigits && jidDigits !== OUTLET.replace(/[^0-9]/g,'').slice(-10)) {
  const text = content?.text || content?.caption || '';
  db.ref(resolvePath(`chats/${jidDigits}/messages/${msgId}`, OUTLET))
    .set({ from: 'bot', text: text || '<media>', ts: Date.now(), type: 'text' })
    .catch(() => {});
  bumpChatMeta(OUTLET, jidDigits, { lastText: text || '<media>', lastDir: 'bot' }, false);
}
```
Guard: skip if the jid is an **admin number** (already known via `getCachedAdminJids()`) so admin↔bot test chatter doesn't pollute customer threads; skip if jid is the outlet's own number.

**Helper `bumpChatMeta`** — single small function (in `bot/index.js` or a new `bot/chat-log.js`; prefer a tiny module so it's testable): transaction on `chats/{id}/meta` merging `{name,phone,lastTs,lastText,lastDir}` and incrementing `unread` only when `dir==='customer'`. Fire-and-forget with `.catch(()=>{})` — **chat persistence must never break the order flow** (same best-effort pattern as the quota counter at 1042).

**What we deliberately do NOT store:** media blobs, group chats, admin↔bot chatter, promo-campaign bulk sends (they already have `bot/promotions/logs`).

### 2.4 Admin "Chat" tab — WhatsApp-like UI

**Registration (3 places, existing pattern):**
1. `Admin/index.html` — new sidebar `<li id="menu-chat">` with `<button data-action="switchTab" data-tab="chat">`, icon `messages-square`, badge `#badge-chat` (total unread across threads).
2. `Admin/index.html` — new `<div id="tab-chat" class="tab-content hidden">`.
3. `Admin/js/ui.js` — `switchTab` case: `case 'chat': { const { loadChat } = await mod('chat'); loadChat(); break; }`.
4. `Admin/js/main.js` — if the reply/read actions are wired globally, add a small `data-action` case; otherwise keep everything tab-local (tables.js pattern).

**New file `Admin/js/features/chat.js`** — exports `loadChat()` + `cleanupChat()`. Conventions: import `{ db, Outlet, ref, onValue, onChildAdded, set, update }` from `../firebase.js`, `escapeHtml` from `../utils.js`, `showToast` from `../ui-utils.js`, `state` from `../state.js`.

**Layout — two-pane WhatsApp-mobile layout (desktop) / stacked (mobile):**
```
┌─────────────────────────┬──────────────────────────────┐
│ CHATS        [search 🔍] │  (thread header) name · phone │
│ ┌─────────────────────┐ │ ┌──────────────────────────┐ │
│ │[avatar] Name     9:41│ │ │   customer message     │ │
│ │  last msg…       2 ✓ │ │ │       9:41             │ │
│ │[avatar] Name     ✓✓ │ │ │        bot reply        │ │
│ │  last msg…     2 ✓✓  │ │ │           ✓✓ 9:42       │ │
│ └─────────────────────┘ │ └──────────────────────────┘ │
│ …more threads           │  [ type a message …     ➤ ]  │
└─────────────────────────┴──────────────────────────────┘
```
- **Left pane (thread list):** avatar circle (initials, deterministic hue from customerId), name (from `customers/{id}.name` or `meta.name`), last message preview (2-line clamp), time (`getISTDateString`/relative), unread badge (green `#25D366` pill, count from `meta.unread`). Search box filters by name/phone.
- **Right pane (thread):** bubbles — customer = white/light (`#ffffff` bg, `#111` text), bot = WhatsApp green (`#DCF8C6` bg, `#111` text); time under bubble; **day separators** (Today / Yesterday / date) like WhatsApp; **read receipts**: `✓` (sent) / `✓✓` (delivered) — we only track sent for MVP; style `✓✓` on bot messages once a customer message after it exists (approximation, note in UI copy as "replied").
- **Composer:** input + send button (`➤`). Send = **reuse the existing command channel**: `push to bot/commands` with `{ action:'SEND_GENERIC_MESSAGE', phone: <customer's raw jid>, message: <text> }`, then delete the command node after ack (existing pattern at `bot/index.js:277-330`). Optimistic echo: render the bot bubble immediately with `ts:now`; the bot's outbound hook will persist the real one.
- **Read/clear:** opening a thread → `update chats/{id}/meta { unread: 0 }` + store `readAt` for read-receipt approximations. `cleanupChat()` detaches all listeners.
- **Empty state:** "No conversations yet. When customers message the bot, threads appear here." + the number's `wa.me` link to share.
- **Accessibility:** keyboard focus on search + composer, `aria-label` on buttons, visible focus rings, `prefers-reduced-motion` respected (no bounce animations).

**CSS — `chat-*` classes** in a new `Admin/chat.css` (imported in index.html after style.css; keeps the ~7000-line style.css untouched and lets PurgeCSS/features stay clean). Add `/^chat-/` to the PurgeCSS safelist in `tools/build.mjs`. Design tokens borrowed from the existing `:root` (`--primary`, surfaces) + WhatsApp's own palette for bubbles/ticks so it reads unmistakably as "WhatsApp" inside the orange-branded Admin.

**Signature element:** the two-pane mobile-chat layout with WhatsApp-green bubbles + day separators inside a dashboard that is otherwise tables/cards. That contrast *is* the design statement — staff recognize it as chat instantly, no label needed.

### 2.5 Security rules (`database.rules.json`)
Add under the tenant `outlets/{oid}` (sibling of the existing `bot` node), **admin-only** (NOT riders — chat is staff/PII, not dispatch data):
```json
"chats": {
  ".read": "auth != null && root.child('admins').child(auth.uid).exists()",
  ".write": "auth != null && root.child('admins').child(auth.uid).exists()",
  "$customerId": {
    "meta": { ".indexOn": ["lastTs"] },
    "messages": {
      "$msgId": {
        ".validate": "newData.hasChildren(['from','text','ts']) && newData.child('from').val() in ['customer','bot'] && newData.child('ts').isNumber()"
      }
    }
  }
}
```
- Admin dashboard reads via `Outlet.ref('chats')` (firebase.js `BUSINESS_ID()`/`Outlet.ref` already tenant-scope correctly).
- The bot writes with admin service-account (bypasses rules — as today for `bot/`).

### 2.6 Build & deploy (B)
1. `npm run build` (esbuild + PurgeCSS) — new `chat.js` auto-picked up, `chat-*.css` minified.
2. Deploy: `firebase deploy --only database` (rules) + `firebase deploy --only hosting:admin` (Admin).
3. Bot: scp `bot/index.js` (+ new `bot/chat-log.js` if created) → EC2, `node -c`, `pm2 restart bot-roshani-pizza-pizza` (and cake when relevant).
4. Verify: message the number → thread appears in Admin Chat tab in <2s; reply from tab → customer receives it; unread badge decrements on open.

### 2.7 Verification checklist (B)
- [x] Inbound message → `chats/{id}/messages` + `meta` written, `unread` incremented
- [x] Outbound reply → `from:'bot'` record written
- [ ] Admin thread list renders, search filters, unread badge counts (structural wiring mirrors verified patterns; browser render pending)
- [ ] Open thread → unread cleared; day separators correct (Today/Yesterday/date) (browser render pending)
- [ ] Send reply via composer → `bot/commands` created → bot sends (template path on meta, text fallback) → echo bubble renders (composer path wired to existing SEND_GENERIC_MESSAGE; live send pending a real customer thread)
- [x] Admin↔bot chatter does NOT create threads; group/other-jid messages ignored
- [x] Rules: rider token cannot read `chats`; anonymous cannot
- [x] Cleanup on tab switch (no duplicate listeners)
- [x] PurgeCSS did not strip `chat-*` classes (build output check)

---

## 3. Build order

1. **Phase B1 (bot persistence)** — `bumpChatMeta` helper + inbound/outbound hooks + rules. *This unlocks everything.* Verify against live DB via a test message.
2. **Phase B2 (Admin Chat tab)** — HTML nav/div, `chat.js`, `chat.css`, ui.js case, PurgeCSS safelist. Verify with Playwright-free manual checks (or Playwright if available): message → thread → reply.
3. **Phase A (coexistence)** — webhook-server `origin` detection + Supreme Admin status card. Independent of B; can be done anytime but ships last since it's guidance, not critical path.
4. **Deploy** — rules → hosting:admin → bot on EC2 → webhook-server on EC2. One commit per phase (matches repo convention).

---

## 4. Risks / gotchas
- **Chat persistence must be best-effort.** A slow DB write inside `messages.upsert` could delay order processing — always fire-and-forget `.catch(()=>{})` (the quota counter at `index.js:1042` is the precedent).
- **`SEND_GENERIC_MESSAGE` needs the customer's full JID.** `meta.name` stores the raw sender (`9197...@s.whatsapp.net` for Baileys, `9197...` for Meta). Store the full `jid` in `meta.phone` at write time (not just 10-digit id) so the reply channel has a valid target. The existing handler already calls `formatJid(cmd.phone)`.
- **Outside 24h window:** meta-transport proactive text replies get 131047 → the command handler already falls back to the approved template (`bot_live_update`) at `index.js:304-314`. Reuse; don't add a new send path.
- **Coexistence cannot be API-enabled.** Scope the Supreme Admin UI as status + guidance + intent record, never a fake toggle. If the owner's number is already on the Business App, coexistence is genuinely useful (staff see bot chats on their phone); the Chat tab covers the dashboard side regardless.
- **Message volume:** one write per message is fine at pizza-shop scale. No aggregation/caching needed (ponytail: add when it measurably hurts).
- **`unread` is per-outlet, not per-admin.** Multiple staff may clear each other's badges. Acceptable for MVP; per-admin `readAt` markers are the upgrade if it matters (note in code).

## 5. Skipped (YAGNI) — add when asked
- Media/blob storage in threads (store `<media>` placeholder text).
- Delivery/read *receipts* beyond sent/replied approximation (needs Graph `messages/{id}` status webhooks — we already receive `statuses` in webhook-server but don't route them to threads).
- Group chats, archived threads, message search beyond the thread-list filter, bulk delete/export.