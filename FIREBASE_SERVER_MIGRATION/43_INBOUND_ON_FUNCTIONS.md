# 43 — WhatsApp inbound runs the REAL bot flow on Functions (batch 23m)

Commit `8c894ff`. Deployed: `whatsappWebhook` (already live), `onWebhookInboxMessage` (new).
**Feature flag `config/webhookInbox/enabled` ships absent, so nothing changes until an owner sets it.**

## 1. Why this batch existed

`taskqueue/processInboundMessage.ts` was the only cloud inbound handler, and it implemented **a
different product** from the live bot:

| | Cloud handler (old) | Live bot (`bot/index.js` 2632-2692) |
|---|---|---|
| Flow | `START → MENU_BROWSING → CART_REVIEW → CHECKOUT → PAYMENT` | `START → AWAITING_ORDER_INTENT → WEBVIEW` |
| Menu | plain text list | greeting image + Hinglish welcome + menu image |
| Ordering | `order <dish>` typed into chat | interactive **"Order Now" URL button** → `delivery.html` with a per-phone webview token |
| Money | COD / UPI, no tax | real cart: GST, delivery slab fee, coupons, reward tender, stock, loyalty |

Flipping the live outlet onto that handler would have replaced a working ordering experience with a
stub that cannot charge GST, apply a delivery fee, redeem a reward or deduct stock. It must never be
deployed. It and `sendOutboundMessage` remain deployed and are on the M1 deletion list.

## 2. What shipped

### 2.1 `bot/inbound-flow.js` (687 lines) — the real state machine, socket-free

`createInboundFlow({ db, resolvePath, outlet, businessId, transport, outletName, outletEmoji,
webviewHost, botPhone, developerNumber, adminNumbers, chatLog, pace, now, log })`
→ `{ handleInbound({ jid|from, id, text, pushName, fromMe? }) => { handled, reason, step } }`

Requires only `./utils`, and that module requires nothing — which is what makes it vendorable.

Ported verbatim from the bot, in the same order:

1. **Channel guard** — drops `@newsletter` / `@broadcast` / `@g.us` before blocklist, dedupe or the
   state machine. (This is the 2026-10-18 fix: the bot was replying into WhatsApp Channel posts, and
   those sends always fail, burning quota and ban-risk surface.)
2. **Blocklist** — `settings/Bot/blockedNumbers` (array of digits).
3. **Dedupe** — `bot/processed/{IST-day}/{messageId}`.
4. **Read receipt**, then the **chat-log hook** (`createChatLog`).
5. **STOP / START** — opt-out and opt-in.
6. **Auto-rejection** for the configured cases, **shop-closed** guard, **wallet gate**.
7. **Wrong-message strikes** — 3 continuous non-intent messages inside 15 min → 30-minute freeze,
   stored in RTDB (a Function has no process between invocations, so in-memory strikes would never
   accumulate). Transactional order notices keep flowing while frozen; admins never strike.
8. **Rate limit** — 40 inbound/minute.
9. **`START` → `AWAITING_ORDER_INTENT` → `WEBVIEW`** with `getOrCreateWebviewToken`
   (30-minute reuse, `crypto.randomBytes(12)`), `sendOrderFlow` / `resendMenuCTA` /
   `sendOrderCTA` and the "Order Now" CTA.

State lives at `bot/chatState/{phone10}`.

Self-check: `node bot/inbound-flow.js` → **12/12**.

### 2.2 `bot/meta-cost.js` (234 lines) — the one cost recorder, and three real bug fixes

`createMetaCost({ db, bid, oid, now, log })` → `{ record, guard, categoryForTemplate }` plus
`MARKETING_TEMPLATE_NAMES` / `istKeys` / `usageView`. Rates come from `shared/meta-cost-math.js`.

Extracting it exposed three defects in the bot's copy:

1. **It never wrote a row.** `recordMetaCost` called `resolveBusinessIdFor(outlet)` from module
   scope, where that binding does not exist — a `ReferenceError` thrown *inside its own catch*, so
   the failure was swallowed and every send went unbilled.
2. **The caps were dead.** `billableMessages` and `dailyCostPaise` were objects, so `canSend`'s
   `Number(...)` was `NaN`; `NaN > cap` is `false`, so neither the daily nor the per-message cap
   could ever block.
3. **The marketing classification was wrong by construction.** In `bot/transport.js`,
   `opts.templateCategory || MARKETING_TEMPLATE_NAMES.has(name) ? 'MARKETING' : 'utility'` bills
   **any** template as MARKETING whenever `templateCategory` is set — a category string, not a
   boolean. Fixed with an explicit membership test.

Self-check: `node bot/meta-cost.js` → **6/6**.

The guard **only arms when `balancePaise` is numeric** and fails open, logging `blocked` when it
stops a send. Direction of error is deliberate: in-window replies are recorded at the **utility**
rate (₹0.115) rather than the free service tier — over-recording blocks a tenant early,
under-recording drains the shared Foodhubbie credit line and fails *everyone* with Meta error 131042.

### 2.3 `bot/chat-log-core.js` (80 lines) + `bot/chat-log.js` reduced to a thin binding

`createChatLog({ db, resolvePath, now, log })` → `{ logChatMessage }` + `customerIdFromJid`.
`bot/chat-log.js` is now a binding that keeps its old signature, so `bot/index.js` is untouched and
its `logChatMessage({ outlet, ... })` calls still work. Batches 23m's inbound flow writes chat rows
and `chatMeta` from the cloud with the same bytes the dashboard reads.

### 2.4 `bot/transport.js` rewired

The module-level `recordMetaCost`, `_metaCostGuard` and the local `MARKETING_TEMPLATE_NAMES` were
deleted; `createMetaTransport` now builds `cost = createMetaCost({ db, bid: resolveBusinessIdFor(outlet), oid: outlet, ... })`.
One cost implementation, one rate table.

### 2.5 `functions/src/shared/whatsapp/factory.ts` (257 lines)

- `makeMetaTransport({ bid, oid, phoneNumberId, accessToken, log })` — a **sock-shaped** object over
  the vendored `bot/whatsapp-send.js` + `bot/meta-cost.js`, so the extracted flow runs unchanged on
  both runners with no second implementation. `sendButton` falls back to `body + url` text;
  `sendTemplate` maps `body` → the single `{{1}}` BODY param; a non-URL image falls back to text
  (Meta cannot send base64 — harmless since batch 15, when every image became a Storage URL).
- `makeInboundFlow(bid, oid, { log, now })` — builds `createChatLog` + `createInboundFlow` and
  returns `{ flow, transport, chatLog, whatsapp }`. **`resolvePath` mirrors `bot/firebase.js`
  exactly**, because a divergence in path resolution would silently read another tenant's settings.
- Batch 23n added `tenantCredentials()`, `makeTenantTransport()` and `tenantAlertRecipients()`.

### 2.6 `functions/src/triggers/webhookInbox.ts` (148 lines) — rewritten

- **No Cloud Tasks.** The old `enqueueTask` → `onTaskDispatched` → `processInboundMessage` chain is
  gone; the trigger calls the flow **directly**. Cloud Tasks remains the right tool for retryable
  outbound work, not for an inbound message that has already been persisted.
- `initializeAdmin()` **before** any `getDB()` — the module throws otherwise, and a trigger that
  reads the DB before init fails on every cold start.
- Flag `config/webhookInbox/enabled === true`, demo tenant hard-skipped, **new entries only**
  (a pre-existing entry is never drained), 30-minute stale entries dropped.
- `extractText` covers all three wire shapes: `text.body`, `button.text` / `button.payload` and
  `interactive.button_reply` / `interactive.list_reply`. A template quick reply and an interactive
  reply carry **no** `text.body`, so a naive extractor drops every button tap — including STOP.
- `flow.handleInbound({ from, id, text, pushName })` using raw `message.from` digits; masked logging;
  the entry is deleted **after** handling.

### 2.7 `functions/src/api/whatsappWebhook.ts`

`enqueueInbox` now accepts and stores `profileName` from `contacts[].profile.name`, so the cloud chat
log has the push name the dashboard displays.

### 2.8 `functions/src/shared/wallet/metaCost.ts` rewritten

A thin binding over the vendored `bot/meta-cost.js`. Hard-coded flat rates gone, and it **no longer
writes `balancePaise`** — that node has exactly one writer (`scheduled/metaCostPublisher.ts`).

### 2.9 `functions/scripts/copy-vendor.cjs`

**22 modules / 363.3 KB.** Adds `bot/inbound-flow.js`, `bot/whatsapp-send.js`, `bot/meta-cost.js`,
`bot/chat-log-core.js`. `verifyLoad()` gained load assertions for all four plus the
`DEFAULT_RATE_TABLE` 115/86 pins, template classification (`promo_cta_flash` → marketing,
`rider_assigned` → utility) and `customerIdFromJid` keying.

`bot/chat-log.js` is deliberately **not** vendored — it requires `./firebase`, which a Function must
not load.

## 3. The rollout order is load-bearing

**`config/webhookInbox/enabled` FIRST, Meta callback SECOND. Never the reverse.**

With the flag off, an inbox entry is orphaned: the `onValueCreated` trigger already fired and
returned, and **no later write re-fires it**. Flipping the flag afterwards does *not* drain the
backlog. The live E2E proved this rather than assuming it (P6: a pre-flip entry survived a flag-on
pass untouched).

## 4. Verification

**Guard battery, 0 failures:** `webhook-inbox` 21/21 · `process-inbound` 14/14 ·
`functions-source` 198/0 · `order-finalizer` 105/0 · `loyalty-engine` 44/0 · `rider-notify` 23/0 ·
`daily-settlement` 30/0 · `wallet-gate` 61/61 · `egress-guard` 20/20 · `bot/tests/unit.test.js` ok ·
`bot/inbound-flow.js` 12/12 · `bot/meta-cost.js` 6/6 · twins 8 pairs byte-identical ·
`tests/encoding-check.mjs` ok.

**Built-bundle verification** (`%TEMP%/opencode/verify-vendor-bundle.cjs`): every new vendored module
resolves and exports from `lib/vendor/`; `createInboundFlow({})` throws `db is required`;
source↔bundle byte-identical for `inbound-flow.js`, `meta-cost.js`, `chat-log-core.js`,
`whatsapp-send.js`, `utils.js`. **`verifyLoad()` only proves the SOURCE tree resolves** — the bundle
must be re-proved after any vendor-list change.

**Live E2E 15/15** (`%TEMP%/opencode/e2e-23m-inbound.cjs`) against the real deployed webhook and the
real RTDB trigger, every fixture restored byte-identically:

| Phase | Proof |
|---|---|
| P1 | GET verify challenge echoes `hub.challenge` |
| P2 | wrong `hub.verify_token` → 403 |
| P3 | bad HMAC signature → acks 200, writes nothing |
| P4 | signed POST lands **one** inbox entry: `message.from`, `id`, `profileName`, `source:'meta-webhook'`, numeric `receivedAt` |
| P5 | flag off → the entry is untouched |
| P6 | flag on → drains the **new** entry; a pre-flip entry is provably **not** drained |
| P6 | unconfigured tenant (no `whatsapp` node) → no chat state written |
| P7 | blocklisted sender drains with **zero** Meta usage rows |
| P8 | unblocked `START` drains |

Cloud Logging then showed the send leg end to end:

```
[Inbound] [IN] 91****0001@s.whatsapp.net: "START"
WhatsApp send failed: {"error":{"message":"Unsupported post request.
  Object with ID '123456789' does not exist ...","code":100,"error_subcode":33}}
```

The number id is a placeholder, so only delivery is blocked — by the Meta asset assignment (below),
not by this code.

## 5. What is still blocked, and by what

`META_SYSTEM_USER_TOKEN` and `WA_PERMANENT_TOKEN` resolve to the same token, and `debug_token` shows
`type: SYSTEM_USER`, `expires_at: 0`, all five scopes present, **every `granular_scopes` list empty**;
`GET /me/businesses` → `[]`. The system user was re-created 2026-11-09 — one day *after* the
2026-11-08 template submission succeeded — and the assets were never re-assigned.

**Owner fix (~2 min, Business Manager admin):** Business Settings → Users → System users →
`Conversions API System User` → Add assets → WhatsApp Accounts → `2589174454849821` → **Full
control**; Apps → `Foodhubbie` → **Full control**. No new token is needed; the existing secret starts
working immediately. Verify with `GET /{WABA}/message_templates` returning the 17 templates.
