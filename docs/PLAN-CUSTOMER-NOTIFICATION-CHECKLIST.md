# PLAN — Customer Notification Checklist (Admin → Customers tab)

**Status:** proposed — research + UX plan, awaiting owner approval before any build.
**Date:** 2026-11-20 · **Author:** coding agent · **Scope:** Admin dashboard only (no rules change unless stated).

---

## 1. What the owner asked for

> "Select customers via checkboxes → choose **Send customer app notification** *or* **Send WhatsApp promotional messages** → that option opens/prefills selected-customer details to generate/create the message → send (same flow both channels)."

So: the Customers tab gains a **selection + batch-action + one shared composer** flow, and the
composer is prefilled from the selected guests. Both channels run the same shape:
pick audience → see who is actually eligible → write/generate the message → preview → confirm → send → honest result.

---

## 2. Research — how this is done elsewhere (external)

Sources fetched 2026-11-20: [Eleken — Bulk Actions UX (Feb 2026)](https://eleken.co/blog-posts/bulk-actions-ux),
[HashiCorp Helios — Table multi-select](https://helios.hashicorp.design/patterns/table-multi-select),
[builtux — Bulk Action Bar UX](https://builtux.com/bulk-action-bar-ux-multi-select-tables-saas-2026),
[Meta — Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits),
[OneSignal — Push best practices](https://onesignal.com/blog/onesignal-guide-push-notification-best-practices-2026),
[Braze — Push best practices](https://www.braze.com/resources/articles/push-notifications-best-practices).

### 2.1 Bulk-action rules that survived the research

| Rule | Why it matters here |
|---|---|
| **Checkboxes are always visible** — never hover-only | 8 guests, a dense table; a hidden checkbox is a hidden feature |
| **≥24×24 desktop / 44×44 touch target** | The Admin is used on a phone (the Customers table already has a phone layout) |
| **Contextual action bar next to the selection, persistent while scrolling** | "What now?" must be one glance, not a hunt |
| **Three selection scopes, each explicit** | Row checkbox (one guest) · header checkbox (this page) · "Select all N matching filters" (the whole filtered set) |
| **The count is announced** (`role="status"`) | "12 guests selected of 34 matching" — also the accessibility contract |
| **Eligibility is transparent BEFORE the action** | Disable + say why, or mark the ineligible rows — never "click Apply and nothing happens" |
| **Confirm irreversible things; undo what can be undone** | A WhatsApp campaign cannot be recalled; a push can be acknowledged but not pulled back |
| **Result summary: what succeeded, what failed, what was skipped and why** | The existing push tab already does this ("N skipped — daily limit"); the checklist must too |
| **Mobile = sticky bottom bar, one-column reflow** | Matches the phone layout already shipped for this table |

### 2.2 WhatsApp constraints that shape the design

- **Per-user marketing limit is adaptive** (Meta): WhatsApp limits how many marketing templates one
  user may receive from a business, based on that user's recent read rate and inbox activity. A capped
  user returns **error 131049** and **Meta asks you to wait ≥24 h before resending** to them.
  → The bot must own the send loop; the UI must never offer "retry now" for a capped user.
- **Marketing templates must be approved**; **US (+1) numbers get no marketing templates.**
- **Marketing messages inside the 24 h service window don't count toward the limit** — so a service
  message (order ready) is never blocked by marketing fatigue.
- **Quality rating + messaging tier** gate reach; we cannot see either from the Admin.

### 2.3 Push constraints

- Device reach is an **upper bound**: a subscriber can have notifications blocked, a dead token, or be
  over a daily cap. Every reputable tool (OneSignal, Braze) shows "up to N" rather than "N".
- The audience/segment/consent filters are applied **server-side**, and the UI reports the resulting count.

### 2.4 One honest gap in the research

There is **no AI/LLM service anywhere in this repository** (no Gemini/OpenAI dependency, no AI endpoint).
So "generate the message" will be a **deterministic generator**: real customer data (favourite dish,
last visit, points, store name) + a segment-appropriate pattern + the bot's existing personalization
tokens. It is not AI copy, and the UI must not pretend otherwise.

---

## 3. Research — what our own code already gives us (reuse before build)

| Need | Existing asset | Gap |
|---|---|---|
| **App push send** | `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts` — Cloud Function. Enforces offers consent, quiet hours 21:00–09:00 IST, per-phone daily caps (`order 50 / loyalty 5 / promo 3`), writes the in-app inbox + `notifyLog` history, prunes dead tokens. | **Audience is `all` or ONE `phone`.** Multi-select needs a new `audience:'phones'` + `phones:[]`. |
| **WhatsApp promo send** | `Admin/js/features/promotions.js` → writes `bot/promotions/campaigns/{id}` + pushes `bot/commands` `SEND_PROMOTION`; the bot enforces meta-transport-only, promo toggle, kill switch, quiet hours, daily limit, prepaid tokens, opt-out, consent, frozen chat, pacing 8–15 s. | `recipients` is just an array of phones → the checklist can hand it the selected phones. **No per-guest list input exists yet.** |
| **Personalization tokens** | `bot/promotions.js personalizeTemplate` supports `{name}`, `{storeName}`, `{phone}`, `{lastOrderDate}` (resolved per recipient at send time). | No token for a dish/points — the generator can only use those four + prose. |
| **Consent / opt-out** | `bot/promotions.js hasPromoConsent` (app offers switch wins both ways; else `promotionalConsent===true || app.consent.offers===true`; no signal = blocked) + `bot/promotions/optout/{last10}`. Mirrored in `Admin/js/features/promotions.js` and in `customer-profile-view.js consentState`. | None — reuse exactly, never re-derive. |
| **Push composer UI** | `Admin/js/features/app-notifications.js` (Customer APP tab): draft autosave, template library, quiet-hours/cap honesty, history, 5 s undo. | Audience is all/one only. |
| **WA composer UI** | `Admin/js/features/promotions.js`: approved WABA template picker, media, STOP footer, token pre-flight, campaign cards + per-recipient log. | Recipient source is a filter or a CSV/XLSX upload — not a guest selection. |
| **The dashboard to extend** | `Admin/js/features/customers-view.js` (pure view) + `Admin/js/features/customers.js` (controller), shipped 2026-11-20 (`41a3f03`): rows, chips, KPI tiles, pager, density, `nextBestAction`, duplicate badge. | No selection layer. |

**Architecture constraints (standing decisions):** Cloud Functions own every database effect; EC2 owns
the WhatsApp transport only; **one writer per path**. The checklist therefore never sends a WhatsApp
message itself — it writes the campaign doc + command exactly as the Promotions tab does, and the bot
worker sends. For push it calls the Function once (one request for the whole batch, not N requests).

---

## 4. The design

### 4.1 Screen A — the Customers table gains a selection column

```
┌──┬──────────────────────────────┬─────────┬──────────┬────────┬───────────┐
│☐ │ Customer                     │ Phone   │ Value    │Segment │ Next step │
├──┼──────────────────────────────┼─────────┼──────────┼────────┼───────────┤
│☑ │ Aarav Sharma                 │ 9000…01 │ ₹1,240   │Champion│ Keep up  │
│☑ │ Ishita Rai                   │ 9000…04 │ ₹980     │Champion│ Keep up  │
│☐ │ Aditya Menon                 │ 9000…08 │ ₹410     │Promising│ Welcome │
└──┴──────────────────────────────┴─────────┴──────────┴────────┴───────────┘
```

- A **leading checkbox column** (24×24 desktop, 44×44 on touch) on every row.
- A **header checkbox** selects the current page. When the filtered set is larger than the page, a
  line appears: *"All 34 matching guests are selected"* / *"Select all 34 matching guests"* — the
  three scopes are explicit.
- Selection is a `Set` of phone numbers that **survives paging, filtering and sorting**, and the count
  is always visible.
- The checkbox column **folds away on the phone** (<640 px) in favour of a tap-on-row toggle? **No** —
  research says never hide the affordance. Instead: on phones the checkbox sits in the sticky customer
  cell (the identity column is already pinned), so it stays reachable while the other columns scroll.
- Ineligible guests are **not greyed out and not disabled** — they are selectable, and the composer
  explains why they will not receive the message. (Disabled rows hide the reason until hover; the
  research is explicit that a disabled action must explain itself.)

### 4.2 Screen B — the contextual action bar

Appears the moment N > 0, directly under the table header (desktop) / fixed to the bottom (phone):

> **12 guests selected** · 34 matching · *9 can get a push · 7 can get WhatsApp*
> `[ Send app notification ]` `[ Send WhatsApp message ]` `[ Clear selection ]`

- The counts are **live and honest** (computed from the snapshot, same rules the server uses).
- `role="status"` on the count so a screen reader announces changes.
- The bar persists while the user scrolls; it does not fly away.

### 4.3 Screen C — ONE composer modal, two channels

```
┌──────────────────────────────────────────────────────────────────────┐
│ Notify 12 selected guests                          [Customer APP][WA] │
├──────────────────────────────────────────────────────────────────────┤
│ AUDIENCE                                                               │
│  chips: Aarav Sharma · Ishita Rai · Aditya Menon  (+9 more)  [expand] │
│  Most-ordered dish: Margherita Pizza · Last visit 9 days ago           │
│  Segment mix: 8 Champions, 3 Promising, 1 Lapsed · Store: Roshani     │
│  Reach: 9 of 12 have an app device · 3 have offers off · 1 opted out  │
├──────────────────────────────────────────────────────────────────────┤
│ MESSAGE                                        [ Generate message ]  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Hi {name}, Margherita Pizza is back on the menu at {storeName}. │  │
│  │ Your last visit was {lastOrderDate}.                          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  [Title (push only)] [Type: Offer ▾] [Template ▾] [image] [STOP ☐]  │
│  preview: ┌ phone frame / WhatsApp bubble ┐   48/300                │
├──────────────────────────────────────────────────────────────────────┤
│ Pre-flight: 9 will get this · 3 skipped (no device / offers off)      │
│                              [Cancel]        [ Send to 9 guests ]     │
└──────────────────────────────────────────────────────────────────────┘
```

**Channel tabs** = the same flow for both channels, as asked.

**The audience panel is the "prefilled selected-customer details"** the owner asked for: the actual
guests (name + phone chips), plus the facts a human would otherwise have to look up one by one
(favourite dish, days since last visit, segment mix, points, store name), plus **who will actually
receive it and who will not, with the reason**.

**"Generate message"** (deterministic, no AI): picks the pattern that matches the audience's dominant
segment —

| Dominant segment | Pattern |
|---|---|
| Lapsed / At risk | "We miss you" — favourite dish + "it's back" + no discount promise (the profile rule: a service message never promises a discount) |
| New (no visits) | "Welcome" — first-order guidance |
| Champions / Promising | "Thank you" + points/loyalty nudge |
| Any (promo intent) | Offer template with the approved WABA shell + `{name}`/`{storeName}` |

…fills it with **real data** and leaves the four bot-supported tokens (`{name}`, `{storeName}`,
`{phone}`, `{lastOrderDate}`) live so the message personalizes per guest at send time. The user can
edit it; the generator never overwrites an edited message without asking.

### 4.4 Screen D — the result

- **App push**: *"Sent to 7 devices · 1 failed · 2 skipped (daily limit) · 8 saved to the in-app inbox"*
  — the server's own numbers, then the same 5-second undo the existing tab offers (with the honest
  copy: a delivered push **cannot be pulled back**).
- **WhatsApp**: *"Campaign c_x queued for 7 recipients · 2 skipped (no consent) · 2 skipped (opted out)"*
  + a **Stop campaign** link (the bot pauses the campaign; already-sent messages are not recalled).

---

## 5. The two channel contracts

### 5.1 Customer APP push — one Function call for the batch

**Change (Cloud Function, one file):** `tenantNotify.ts` accepts a third audience.

```
POST /tenant-api/notify
{ "title": "...", "body": "...", "type": "promo|loyalty|system|order",
  "audience": "phones", "phones": ["9000000201", ...],   // NEW (max 500)
  "data": { ... } }
```

- The Function keeps **every** guard: offers consent (non-order types), quiet hours, per-phone daily
  caps (`batchCheckAndConsumeCaps`), inbox write, `notifyLog` history row (one row for the batch,
  `audience:'phones'`), dead-token pruning.
- The client makes **ONE** request for N guests (not N requests — N requests would consume N history
  rows, N inbox sweeps and N cap passes).
- **No rules change**: the Function writes with the Admin SDK, the tenant comes from the verified token.

### 5.2 WhatsApp promotional message — the existing campaign path, fed by the selection

- The composer writes `bot/promotions/campaigns/{id}` with `recipients` = the selected **eligible**
  phones (max 300 — `PROMO_MAX_PER_CAMPAIGN`), plus `template`, `waTemplateName`, `mediaUrl`,
  `sendStopMsg`, `greeting`, `requestedBy` — **the same doc shape the Promotions tab writes**.
- Then it pushes `bot/commands` `SEND_PROMOTION` — **the same command the Promotions tab pushes**.
- The bot owns: meta-transport-only (Baileys → campaign pauses with `transport-blocked`), promo
  toggle, kill switch, quiet hours, daily limit, prepaid promo tokens, opt-out, consent, frozen chats,
  and the 8–15 s pacing.
- **The composer must say so before the send**: on Baileys the campaign will pause; promo token
  balance vs. recipients; the transport state.

### 5.3 The eligibility matrix (one source of truth, shown in the UI)

| Channel | Reachable | Blocked (with the reason shown) |
|---|---|---|
| App push (offer/loyalty/system) | has a `pushSubscriptions` row for that phone with a token | no device token · offers switch off · over the daily cap (3/day) · quiet hours (21:00–09:00 IST) |
| App push (order type) | any subscribed device | no device token — **no consent, no quiet hours, no cap** (transactional) |
| WhatsApp | `hasPromoConsent` true · not in `bot/promotions/optout` · promo enabled · transport = meta · tokens available | offers off / no consent · opted out (STOP) · promo sending off · Baileys transport (would pause) · no promo tokens · daily limit reached |

The **same rules the server/bot enforce** are used for the preview counts, so the number the owner
sees is the number that gets sent (or the honest reason it won't be).

---

## 6. Files (fewest possible) and build order

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | **Function**: `audience:'phones'` + `phones[]` (max 500), one history row, caps unchanged | `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts` | `tests/functions-source.check.cjs` + live E2E (multi send, caps, consent, quiet hours, dead token) |
| 2 | **Shared push client** (extract from `app-notifications.js`, now 2 callers) | NEW `Admin/js/features/notify-shared.js`; `app-notifications.js` imports it | source guard; existing push tab still works |
| 3 | **Selection layer**: checkbox column, header checkbox, "select all N matching", action bar, selection state | `customers-view.js` (pure), `customers.js`, `Admin/index.html` | `tests/customer-dashboard.check.mjs` (extended) + browser E2E |
| 4 | **Eligibility engine** (pure, injected maths — same rules as §5.3) | `customers-view.js` or a new pure `notify-eligibility.js` | node guard with a fixture matrix |
| 5 | **Composer modal — Customer APP channel** | NEW `Admin/js/features/notify-composer.js` | node guard + browser E2E (generate → preview → send → result) |
| 6 | **Composer modal — WhatsApp channel** (same shell, channel tab) | same file + `Admin/js/features/promotions.js` (extract the launch into a shared function so both entry points write the same doc) | node guard + browser E2E (campaign doc shape asserted) |
| 7 | **Visual pass** at 1440 / 1280 / 390, SW bump, deploy | `Admin/sw.js` + `Admin/dist` | `tools/serve-dist.cjs` + live E2E on the demo tenant |

Guards to add: `tests/notify-composer.check.mjs` (composer contract: no secrets, no direct WhatsApp
send from the client, consent/cap/quiet-hours reasons present, the generator never promises a
discount, one Function call per batch) + a browser guard for the whole flow + the existing
`test:customer-dashboard` / `test:app-notifications` / `test:functions-source` kept green.

---

## 7. Risks and honest limits (to be shown in the UI, not hidden)

1. **A WhatsApp campaign cannot be recalled.** The confirm dialog says so; the result offers
   "Stop campaign" (stops the remaining sends only).
2. **Push reach is an upper bound** — the server's cap/quiet-hours/inbox results are reported after
   the send, never predicted as a promise ("up to 9").
3. **Marketing sends are silent 21:00–09:00 IST** — the composer disables the send and says why
   (the existing tab already does this; the checklist reuses the same rule).
4. **Meta's per-user marketing limit (131049)** is invisible to us; the bot's pacing is what protects
   us. We never offer a "retry now".
5. **The generator is not AI.** It composes real customer data into a segment-appropriate pattern.
6. **The selection is by phone** — the identity key. A duplicated name on two numbers is two guests.
7. **Bulk WhatsApp is not "one message per guest sent instantly"** — the bot paces 8–15 s per send
   (ban-proofing) and honours a daily limit; a 300-guest campaign takes a while, and the campaign card
   (Promotions tab) shows its progress.
8. **Only the demo tenant is written during verification.** No live-pizza write, ever.

---

## 8. Open decisions for the owner

1. **Composer placement** — a modal in the Customers tab (recommended: one flow, both channels, stays
   in context) **vs.** a hand-off to the existing Promotions tab ("12 guests selected → continue in
   Promotions", less new UI but two flows).
2. **Message generation** — deterministic patterns from real customer data (recommended; no AI service
   exists in this repo) **vs.** adding an AI copy service (new dependency, new cost, new privacy
   surface).
3. **Transactional sends** — allow "Order update" type in the checklist (bypasses consent + quiet
   hours + caps, for telling a guest their order is ready) **vs.** offers-only.
4. **"Select all N matching"** — allowed across the whole filtered set (recommended, with the count in
   the label) **vs.** current page only.

---

## 9. Explicitly out of scope

- Bulk **email/SMS** (no channel exists).
- Batch **WhatsApp from the list itself** (the consent/cap/pacing owner is the bot; the list only picks the audience).
- Any change to the **EC2 box**, the **bot worker**, the **WhatsApp transport**, or the **M1 Functions prune**.
- Any **AI** dependency.
- Live-pizza writes; the verification tenant is the public demo (`foodhubbie-demo`).
