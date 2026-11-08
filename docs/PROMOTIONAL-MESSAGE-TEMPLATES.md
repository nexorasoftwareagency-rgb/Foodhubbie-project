# FoodHubbie — Promotional Message Templates & In-Built Buttons

**Status:** **Submitted to Meta 2026-11-08 — 6 templates PENDING review**  
**Scope:** WhatsApp promotional broadcasts (marketing templates) sent from the Admin promotions composer  
**Audience:** Product, engineering, outlet owners

---

## 0. As built (2026-11-08) — supersedes the proposals below

Six marketing templates with in-built CTA buttons were submitted to WABA
`2589174454849821` ("Test WhatsApp Business Account") for outlet
`roshani-pizza/pizza`:

| Template | Job | Status |
|---|---|---|
| `promo_cta_flash` | Flash sale / urgency | PENDING |
| `promo_cta_cart` | Abandoned cart recovery | PENDING |
| `promo_cta_winback` | Dormant customer reactivation | PENDING |
| `promo_cta_birthday` | Birthday | PENDING |
| `promo_cta_weekend` | Weekend volume | PENDING |
| `promo_cta_newitem` | New item launch | PENDING |

Every template shares one shape:

```
⚡ *FLASH SALE — Sirf Aaj!* ⚡

{{1}}

_Yeh offer sirf thodi der ke liye hai — abhi order karein! 🍕_

FOOTER:   Reply STOP to unsubscribe.
BUTTONS:  [ Order Now ]   → static app link
          [ Unsubscribe ] → quick reply
```

Four decisions taken while building it, each of which **corrects an earlier
draft in this document**:

1. **The URL button is static, not variable.** Meta allows only **one** variable
   in a URL button and it must sit at the very end of the string, so
   `?b={{1}}&o={{2}}` is invalid. Because each restaurant owns its own WABA
   (Key Decision 2026-11-01), the tenant's app link is baked in at submission
   time: `https://menu.foodhubbie.in/?b=<bid>&o=<oid>`. That also removes the
   biggest rejection surface and stops a send from ever pointing elsewhere.
2. **One body variable, not four.** The only pattern proven to pass review on
   this WABA is a single `{{1}}` (the four `promo_hinglish_*` shells). `{{1}}`
   therefore carries the whole offer sentence, which also means the bot's
   existing `body → {{1}}` mapping in `bot/transport.js` works unchanged.
3. **`Unsubscribe` quick reply, not `Not now`.** The bot already matches
   `/^(stop|unsubscribe|opt[\s-]?out)$/i`, so the button opts the customer out
   with no code change — and a one-tap opt-out is the cheapest way to protect
   the WABA quality rating that decides how many promos get delivered at all.
4. **Hinglish body copy**, matching the four approved `promo_hinglish_*` shells
   and the actual audience.

**No bot change is needed for the buttons to render.** Buttons are template-level:
sending the template by name renders them. Only `COPY_CODE` needs a send-time
code parameter. Two small bot edits were still required and shipped:

- `bot/transport.js` — the six names added to `MARKETING_TEMPLATE_NAMES`, so the
  Meta cost guard classifies them MARKETING (utility rates would understate spend).
- `bot/promotions.js` — skip the body STOP append when the chosen shell already
  carries a STOP footer, so it does not print twice.

**Admin wiring is automatic.** `loadApprovedWaTemplates()` fetches approved
templates from the outlet WABA, so these appear in the composer's *WhatsApp
delivery template* select as soon as Meta approves them (a friendly label map
was added so they read "⚡ Flash Sale — Order Now button", not `promo_cta_flash`).

**Honest limits.** The six are `PENDING`; Meta review takes up to 24 h, and this
WABA has auto-rejected variable templates before (`promo_offer`,
`announcement`, `roshani_greeting`). Promotional sending is also still
**Baileys-blocked** — nothing here changes delivery until an outlet flips to
`transport=meta`. Submission is reproducible per tenant with
`node tools/submit-wa-templates.mjs --bid <bid> --oid <oid> --waba <waba> --apply`;
the audit trail is `docs/wa-template-submission-<bid>.json`.

---

## 1. Executive summary

Promotional messages are business-initiated WhatsApp messages sent outside the 24-hour customer-service window. On WhatsApp Business API they **must** use Meta-approved message templates. Templates that include interactive buttons (URL deep-links, quick replies, copy-code) convert **40–60% better** than plain-text links and give the customer a one-tap next step instead of a link to copy.

This document covers:
1. What a promotional message should look like (anatomy + copy rules)
2. Button types and when to use each
3. Meta approval requirements and rejection reasons
4. Button implementation for Foodhubbie (Admin composer + bot sender)
5. Template catalog with buttons (copy-paste ready)
6. Opt-in / opt-out requirements
7. Sending timing, pacing, and safety
8. Implementation roadmap

---

## 2. Template anatomy

Every WhatsApp template has four moving parts:

| Part | Required | Max length | Content types |
|------|----------|------------|---------------|
| Header | Optional | 60 chars | Text, image, video, document, location |
| Body | **Yes** | 1,024 chars | Text + variables `{{1}}`, `{{2}}`, `{{3}}` |
| Footer | Optional | 60 chars | Text |
| Buttons | Optional | Up to 10 total | Quick reply, URL, phone, copy code |

**Body rules:**
- Cannot start or end with a variable (e.g. `{{1}} you have {{2}} off` is rejected)
- Variables need static framing around them: `Hi {{1}}, you have {{2}} off your next order.`
- `%`, `₹` and emoji inside variables are fine — the approved `promo_hinglish_offer` sample carries `20% off` (an earlier draft of this doc claimed otherwise)
- No URLs in body variables — use URL buttons instead
- Fallback values for every variable in case data is missing

**Foodhubbie naming convention:** `promo_hinglish_<use-case>` for Hinglish marketing templates (e.g. `promo_hinglish_offer`, `promo_hinglish_discount`, `promo_hinglish_festive`, `promo_hinglish_winback`) — all already approved on the WABA, single `{{1}}` body.

---

## 3. What a promotional message should look like

### 3.1 The anatomy of a good promo

```
Header: (image of the dish / offer banner)          ← optional but recommended
Body:  Hi Rahul! 🎉 Flash sale — 20% OFF everything
       for the next 4 hours only. Use code FLASH20
       at checkout. Hurry, it ends at 10 PM!
Footer: Reply STOP to unsubscribe                   ← required for marketing
Buttons: [Shop now → URL]   [Copy FLASH20 → copy code]
```

### 3.2 Copy rules (non-negotiable)

| Rule | Why | Example |
|------|-----|---------|
| First name first | Reads personal, not broadcast | `Hi {{name}}!` not `Hello customer!` |
| Concrete numbers beat vague | `Save 20%` not `Save big` | `₹100 off orders above ₹499` |
| One CTA per template | Multiple buttons fragment intent | Pick the ONE action you want |
| Static framing around variables | Meta rejection rule | `Hi {{1}}`, not `{{1}}` |
| STOP footer on marketing | Meta opt-out requirement | `Reply STOP to unsubscribe.` |
| Button label = destination | "Track order" must link to tracking | "Buy now" → product page, not landing page |
| 8–10 AM local send time | 60–80% open rates (Chatarmin study) | Avoid Fri afternoon / Sun morning |
| Pacing 8–15s between sends | Ban-proofing on Baileys | 60–120s pause every 30 sends |

### 3.3 Bad promo vs good promo

**Bad (rejected / ignored):**
```
{{1}} {{2}} off {{3}} click here http://example.com
```
*Why:* starts with variables, vague, URL in body, no opt-out, no button.

**Good (approved, converts):**
```
Hi {{1}}! 🎉 Flash sale — {{2}}% OFF everything for the next
{{3}} hours only. Use code {{4}} at checkout.
Reply STOP to unsubscribe.
[Shop now → URL]   [Copy {{4}} → copy code]
```

---

## 4. Button types

### 4.1 Quick reply (reply button)
- Up to **3 buttons** per message
- Label max **20 characters**, must be unique per message
- ID max **256 characters**
- User tap → `button_reply` webhook with `id` + `title`
- Best for: "Yes/No", "Track order", "Reorder", "Not now"

**Example payload:**
```json
{
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Hi {{1}}, your cart is waiting. Complete it now?" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "resume_checkout", "title": "Resume" } },
        { "type": "reply", "reply": { "id": "not_now", "title": "Not now" } }
      ]
    }
  }
}
```

### 4.2 URL button (CTA)
- **Up to 2 URL buttons** per template
- Drives traffic out of WhatsApp to a deep link
- Best for: "Order Now", "View menu", "Reorder"
- **At most ONE variable, and it must be the last thing in the URL.**
  `https://x.com/?b={{1}}&o={{2}}` is rejected; `https://x.com/?ref={{1}}` is fine.
  Foodhubbie sidesteps this by baking the tenant link in statically.

**Template-creation syntax:**
```json
{
  "type": "BUTTONS",
  "buttons": [
    { "type": "URL", "text": "Order Now", "url": "https://menu.foodhubbie.in/?b=roshani-pizza&o=pizza" }
  ]
}
```

With a variable (single, at the very end — `example` is then required):
```json
{ "type": "URL", "text": "Order Now", "url": "https://menu.foodhubbie.in/?ref={{1}}", "example": ["diwali"] }
```

### 4.3 Copy code button (marketing only)
- **1 copy code button** per marketing template
- One-tap copies a promo code to the clipboard
- Code max **20 characters**, supplied at **send** time
- Best for: discount codes (FLASH20, BDAY15, COMEBACK20)

**Template-creation syntax** — declared as a `COPY_CODE` component, *not* `cta_url`:
```json
{ "type": "COPY_CODE", "example": "FLASH20" }
```

At send time the actual code is passed as a `button` component with
`sub_type: "copy_code"` (see Meta's send-template reference for the exact
parameter object). This is the only button type that needs a send-time
parameter — URL and quick-reply buttons render from the template itself.

**Button grouping rule:** quick replies must be grouped together and non-quick-reply
buttons grouped together. `URL, QUICK_REPLY` is valid; `QUICK_REPLY, URL, QUICK_REPLY`
is rejected.

---

## 5. Meta approval requirements

### 5.1 Categories and pricing (US rates)

| Category | Use case | Cost per delivered message |
|----------|----------|---------------------------|
| Marketing | Promos, newsletters, cart reminders, back-in-stock, upsell | ~$0.0250 |
| Utility | Order confirmation, shipping update, refund, appointment reminder | ~$0.0034 |
| Authentication | OTPs, 2FA, login codes | ~$0.0034 |
| Service | Free-form replies inside 24h window (no template) | Free first 1,000/mo, then utility rate |

### 5.2 Marketing opt-out requirement (critical)

**Meta now requires an official one-click unsubscribe button in marketing templates.** "Reply STOP" alone no longer satisfies the requirement via the API. Every Foodhubbie marketing template must include a STOP footer, and the bot already appends:

```
------------------------
_Reply STOP to unsubscribe._
```

### 5.3 Common rejection reasons (avoid these)

| Reason | Symptom | Fix |
|--------|---------|-----|
| Wrong category | Upsell phrase in a utility template | Strip promotional add-on; submit as marketing |
| Variable at start/end | `{{1}} you have {{2}} off` | Wrap in static text: `Hi {{1}}, you have {{2}} off` |
| Prohibited content | Alcohol, tobacco, gambling, adult, etc. | Don't use WhatsApp for regulated goods |
| Misleading buttons | "Yes" that links to checkout | Button label must match destination |
| Duplicate template | Same body under new name | Edit existing template instead |
| Variable count mismatch | Declared `{{4}}`, provided 3 samples | One realistic sample per variable |

### 5.4 Review timing

- Meta review: up to 24 hours (automated + manual)
- Appeal: decided within 24 hours
- **Submit templates days before a campaign**, not the day of

---

## 6. Foodhubbie implementation

### 6.1 Current state

**Admin side** (`Admin/js/features/promotions-templates.js`):
- 25 pre-built text templates across 8 categories (Welcome, Discounts, Weekend, Re-engagement, Referral, New Menu, Birthday, Flash)
- Template picker modal renders cards with `Use` button
- `promoWaTemplate` select loads approved Meta WABA templates (e.g. `proactive_promo`, 4 Hinglish shells)
- Tokens: `{name}`, `{phone}`, `{lastOrderDate}`, `{storeName}`, `{offer}`, `{discount}`, `{percent}`, `{amount}`, `{minOrder}`, `{itemName}`, `{description}`, `{festival}`, `{season}`, `{hours}`, `{couponCode}`

**Bot side** (`bot/promotions.js`):
- `sendPromotionalMessage()` sends via Meta `sendTemplate` first, falls back to text/image
- Blocks on Baileys transport (promos are official-API only — ban-risk)
- Blocks on frozen JIDs (3-strike silence)
- Appends STOP footer when `sendStopMsg` is true
- Paces sends 8–15s, pauses 60–120s every 30 sends
- Daily warmup limits: 20→40→60→100→150→200→250, cap 300

**Costs** (`shared/cost-math.js`):
- Promo messages: ₹1/token (platform fee), Meta conversation charges separate
- Prepaid promo tokens cover sends oldest-first; only uncovered sends bill

### 6.2 Gap: no in-built buttons on Admin templates

The existing 25 Admin templates are **plain text only**. They lack:
- URL deep-link buttons ("Shop now", "Track package")
- Quick-reply buttons ("Resume", "Not now", "Reorder")
- Copy-code buttons (FLASH20, BDAY15)

**Improvement plan:** add a `buttons` array to each template definition, rendered in the template picker, and passed through to `sendPromotionalMessage()`.

---

## 7. Button implementation plan

> **Superseded by §0.** The plan below put a `buttons` array on the 25 Admin text
> templates and passed it through `sendPromotionalMessage()`. That is not how the
> API works: buttons belong to the **approved template on the WABA**, so a
> plain-text send can never carry them. The shipped design keeps the 25 text
> templates as a body library and attaches buttons by selecting an approved
> `promo_cta_*` shell in the *WhatsApp delivery template* dropdown.

### 7.1 Admin template schema (extensions to `promotions-templates.js`)

```js
{
  title: 'Flash Sale',
  body: '⚡ FLASH SALE ⚡ {name}, get {offer} for the next {hours} hours ONLY!',
  note: 'Use with a short-lived discount for urgency',
  buttons: [
    { type: 'url', id: 'shop_now', label: 'Shop now', urlTemplate: 'https://menu.foodhubbie.in/?b={{bid}}&o={{oid}}&sale=flash' },
    { type: 'copy_code', id: 'copy_code', label: 'Copy {{couponCode}}', codeTemplate: '{couponCode}' },
    { type: 'quick_reply', id: 'not_now', label: 'Not now' }
  ]
}
```

Constraints enforced at render time:
- Max 10 buttons total
- Max 1 URL button
- Max 1 copy-code button
- Max 3 quick-reply buttons
- Quick-reply label ≤ 20 chars, unique per template

### 7.2 Template picker UI changes

Each template card gains a button row below the body:
```
[Shop now →]   [Copy FLASH20 →]   [Not now]
```
Clicking "Use" loads the body into the composer AND sets the `waTemplateName` / button config on the campaign record.

### 7.3 Bot sender changes (`bot/promotions.js`)

`sendPromotionalMessage()` gains a `buttons` parameter:

```js
async function sendPromotionalMessage(sock, jid, text, mediaUrl, sendStopMsg, outlet, waTemplateName, buttons = []) {
  // ... existing meta transport + freeze checks ...
  
  if (isMetaSock && typeof sock.sendTemplate === 'function' && buttons.length > 0) {
    // Build interactive template send with buttons
    await sock.sendTemplate(jid, {
      name: waTemplateName || 'proactive_promo',
      language: 'en',
      body: finalText,
      buttons: buttons.map(b => ({
        type: b.type === 'url' ? 'cta_url' : b.type === 'copy_code' ? 'copy_code' : 'reply',
        ...(b.type === 'url' ? { parameters: { display_text: b.label, url: resolveUrl(b.urlTemplate) } } : {}),
        ...(b.type === 'copy_code' ? { parameters: { display_text: b.label, code: resolveCode(b.codeTemplate) } } : {}),
        ...(b.type === 'quick_reply' ? { reply: { id: b.id, title: b.label } } : {}),
      })),
      _logChat: false,
    });
    // ...
  }
  // ... existing text/image fallback ...
}
```

URL resolution replaces `{{bid}}`, `{{oid}}`, `{{itemId}}`, `{{couponCode}}` from campaign context.

### 7.4 Campaign record schema (RTDB `bot/promotions/{campaignId}`)

```json
{
  "waTemplateName": "promo_hinglish_offer",
  "waTemplateLanguage": "en",
  "buttons": [
    { "type": "url", "label": "Shop now", "urlTemplate": "https://menu.foodhubbie.in/?b={{bid}}&o={{oid}}" }
  ],
  "sendStopMsg": true,
  "sendMenuCta": true,
  "isTest": false,
  "startedAt": "...",
  "createdAt": "..."
}
```

---

## 8. Template catalog with buttons (copy-paste ready)

> **Read §0 first.** The six shipped shells use the single-`{{1}}` Hinglish shape
> in §0. The catalog below is **body-copy inspiration** — its multi-variable
> bodies (`Hi {{1}}, {{2}}% off for {{3}} hours`) are valid on a WABA with a
> clean review record, but this one has auto-rejected variable templates before,
> so submit them one variable at a time and only after the `promo_cta_*` set
> clears review.

### 8.1 New Customer Offers

| Template | Body | Buttons |
|----------|------|---------|
| Welcome Offer | `Hey {name}! 🎉 Enjoy {offer} on your first order.` | URL "Shop now", Copy code |
| First Order Discount | `Hi {name}! Your first order = {discount}% OFF.` | URL "Order now" |
| New Customer Bundle | `Welcome {name}! {offer} on your first 3 orders.` | URL "View bundle" |

### 8.2 Discounts & Sales

| Template | Body | Buttons |
|----------|------|---------|
| Flash Sale | `⚡ {name}, {offer} for the next {hours} hours ONLY!` | URL "Shop now", Copy code, Quick reply "Not now" |
| Percentage Off | `{name}, you get {percent}% OFF your entire order today!` | URL "Shop now" |
| Buy One Get One | `B1G1 FREE, {name}! Order any large, get another FREE.` | URL "Order now" |
| Clearance Sale | `Psst, {name}! Selected items UP TO {percent}% OFF!` | URL "Shop clearance" |

### 8.3 Weekend & Seasonal

| Template | Body | Buttons |
|----------|------|---------|
| Weekend Special | `Weekend = treat time, {name}! {offer} Sat & Sun only.` | URL "Order now" |
| Festival Offer | `Happy {festival}, {name}! {offer} on orders above ₹{minOrder}.` | URL "Celebrate" |
| Monsoon Special | `Rainy day = food day, {name}! {offer} on your order.` | URL "Order now" |
| Summer Cooler | `Beat the heat, {name}! Drink + {percent}% OFF meal.` | URL "Order drinks" |

### 8.4 Re-engagement & Win-back

| Template | Body | Buttons |
|----------|------|---------|
| We Miss You | `We miss you, {name}! Come back for {offer}.` | URL "Order now", Quick reply "Not now" |
| Come Back Offer | `Hi {name}! We saved {offer} for your next order.` | URL "Redeem" |
| Last Order Reminder | `Hey {name}! Your cart is waiting. Get {offer}.` | URL "Resume checkout" |

### 8.5 Referral & Loyalty

| Template | Body | Buttons |
|----------|------|---------|
| Refer a Friend | `Share the love, {name}! You BOTH get {offer}.` | URL "Refer now" |
| Loyalty Bonus | `You're a rockstar, {name}! Enjoy {offer} as thanks.` | URL "View rewards" |
| VIP Appreciation | `Dear {name}, exclusive VIP treat — {offer}. Valid 7 days.` | URL "Claim VIP perk" |

### 8.6 New Menu & Launches

| Template | Body | Buttons |
|----------|------|---------|
| New Item Launch | `Something yummy, {name}! Try {itemName} — {description}.` | URL "View menu" |
| Seasonal Menu | `Introducing our {season} menu, {name}! {offer}.` | URL "View menu" |
| Chef's Special | `Chef made {itemName} JUST for you, {name}! {description}.` | URL "Try it" |

### 8.7 Birthday & Special Days

| Template | Body | Buttons |
|----------|------|---------|
| Birthday Offer | `HAPPY BIRTHDAY {name}! {offer} on us! Valid 3 days.` | URL "Claim gift" |
| Anniversary Offer | `Happy Anniversary, {name}! Celebrate with {offer}.` | URL "Order now" |

### 8.8 Urgent & Flash Deals

| Template | Body | Buttons |
|----------|------|---------|
| Flash Sale | `⚡ FLASH SALE ⚡ {name}, {offer} for {hours} hours ONLY!` | URL "Shop now", Copy code |
| Slow Hour Boost | `Hey {name}! Afternoon slump? {offer} on delivery now.` | URL "Order now" |
| Last Minute Deal | `Tonight only, {name}! {offer} in the next {hours} hours.` | URL "Order dinner" |

---

## 9. Opt-in / opt-out requirements

### 9.1 Opt-in (before sending)
- Explicit, named opt-in stating business name, WhatsApp channel, message type
- Pre-checked checkboxes do **not** count
- Record date and source of every opt-in (`customers/{phone}/app/consent/offers`)
- Foodhubbie already enforces `promotionalConsent === true` + `bot/promotions/optout/{last10}` keys

### 9.2 Opt-out (on every marketing message)
- STOP footer appended automatically by bot
- `Reply STOP to unsubscribe.` — honored automatically
- STOP replies exclude customer from future campaigns
- Customers can toggle Offers off in the rider/customer app

---

## 10. Sending timing & pacing

| Parameter | Value | Source |
|-----------|-------|--------|
| Best send time | 8–10 AM local (e-commerce) | Chatarmin KPI study |
| B2B send time | Tue–Thu mid-morning | Mirrors email best practice |
| Avoid | Fri afternoon, Sun morning | Lower intent, higher ignore |
| Event reminders | 1 hour before | Works regardless of time |
| Inter-send delay | 8–15s random | Ban-proofing (Baileys) |
| Batch pause | 60–120s every 30 sends | Ban-proofing |
| Daily warmup | 20→40→60→100→150→200→250 | Cap 300/campaign |
| Meta marketing limit | Per-user, adapts to engagement | Error 131049 if over-limited |

---

## 11. Implementation roadmap

| Phase | Task | Status |
|-------|------|--------|
| 1 | Design 6 button templates (single `{{1}}`, static CTA URL, Unsubscribe quick reply) | ✅ 2026-11-08 |
| 2 | Submit to Meta WABA `2589174454849821` | ✅ 2026-11-08 — all 6 `PENDING` |
| 3 | Classify them MARKETING in the bot cost guard | ✅ `bot/transport.js` `MARKETING_TEMPLATE_NAMES` |
| 4 | Avoid a duplicate STOP footer | ✅ `bot/promotions.js` `TEMPLATES_WITH_STOP_FOOTER` |
| 5 | Friendly labels in the composer template select | ✅ `Admin/js/features/promotions-templates.js` |
| 6 | Meta review outcome | ⏳ ≤24 h — check with the status query below |
| 7 | Quick-reply `button_reply` handling | ⏳ not needed for `Unsubscribe` (the bot already matches the text); needed only if a `Not now`-style reply is added |
| 8 | Live send proof | ⏳ blocked — promos are hard-blocked on Baileys until an outlet flips to `transport=meta` |

Check review status at any time:

```bash
node -e "fetch('https://graph.facebook.com/v21.0/2589174454849821/message_templates?limit=100',{headers:{Authorization:'Bearer '+process.env.WA_PERMANENT_TOKEN}}).then(r=>r.json()).then(j=>j.data.filter(t=>t.name.startsWith('promo_cta_')).forEach(t=>console.log(t.status,t.name)))"
```

---

## 12. Key decisions recorded

- **Promo CTA buttons live on the WABA template, never on the text send** (2026-11-08) — buttons are template-level, so sending an approved template by name renders them with no bot change. Only `COPY_CODE` needs a send-time parameter. Do not add a `buttons` array to the 25 Admin text templates; it can never reach the customer.
- **Static per-tenant CTA URL** (2026-11-08) — Meta allows one URL variable and only at the end of the string, so `?b={{1}}&o={{2}}` is impossible. Each restaurant owns its own WABA, so the app link is baked in at submission time. Never try to parameterise both `b` and `o` in a URL button.
- **`Unsubscribe` quick reply is the opt-out** (2026-11-08) — matches the bot's existing `/^(stop|unsubscribe|opt[\s-]?out)$/i`, so it works with no code change and protects the WABA quality rating.
- **Promotional messaging is Baileys-blocked** (2026-09-30) — only Meta transport sends promos; Baileys sends `transport-blocked` pause reason
- **Prepaid promo tokens** (2026-11-05) — one purchased/granted token pays for one already-sent campaign message; tokens applied oldest-send-first
- **Hinglish shells** (2026-10-17) — 4 approved marketing templates on WABA: `promo_hinglish_offer/discount/festive/winback`, all `language: en`, single `{{1}}` body
- **Opt-out enforcement** — explicit `customers/{phone}/promotionalConsent === true` required + `bot/promotions/optout/{last10}` keys, enforced in bot send loop AND Admin audience build
- **STOP footer required** on all marketing templates (Meta requirement since 2025)

---

## 13. References

- [Meta: Interactive reply buttons messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages)
- [Meta: Template components reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)
- [Meta: Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [Meta: Template review](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)
- [WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [getkanal: 25 WhatsApp Business Templates (2026)](https://getkanal.com/blog/whatsapp-business-templates)
- [Blueticks: 7 WhatsApp Campaign Messages That Get Replies](https://blueticks.co/blog/whatsapp-campaign-templates-that-convert)
- [Chatarmin: WhatsApp Marketing Examples 2026](https://chatarmin.com/en/blog/whatsapp-marketing-examples)
- [Klaviyo: 8 WhatsApp Marketing Campaign Best Practices](https://www.klaviyo.com/blog/whatsapp-marketing-best-practices)

---

## 14. Related Foodhubbie files

- `Admin/js/features/promotions.js` — campaign composer, recipient picker, kill switch
- `Admin/js/features/promotions-templates.js` — 25 text templates + picker + WABA template loader
- `Admin/js/features/promotions-guide.js` — 6-step how-to guide modal
- `bot/promotions.js` — campaign runner, opt-out, consent, pacing, `sendPromotionalMessage()`
- `shared/cost-math.js` — billing: `isBilledCampaign`, `tokenPool`, `promoSendUsage`, `computeWallet`
- `promo/README.md` — promotion workspace ground rules, KPIs, stop rule
- `tests/promo-tabs-a11y.spec.js` — promotions tab accessibility
