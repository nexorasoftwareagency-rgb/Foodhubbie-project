# WhatsApp templates - approved

Generated 2026-10-18 09:05 UTC from the live WABA `2589174454849821`
(`GET /v20.0/{WABA}/message_templates`) - Meta is the source of truth; nothing in this repo mirrors review status.
Regenerate with `node tools/gen-wa-templates.cjs`.

**14 approved** - MARKETING 6, UTILITY 8 - plus 3 not approved (by design, see foot).

## Overview

| Template | Category | Lang | Vars | Used at |
|---|---|---|---|---|
| `greeting_welcome` | MARKETING | en | 2 | **unwired by design** - the in-window greeting already sends an image; a static template would be a UX regression |
| `proactive_promo` | MARKETING | en | 1 | bot/index.js:425 + bot/promotions.js:60 - default promo shell |
| `promo_hinglish_discount` | MARKETING | en | 1 | Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js |
| `promo_hinglish_festive` | MARKETING | en | 1 | Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js |
| `promo_hinglish_offer` | MARKETING | en | 1 | Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js |
| `promo_hinglish_winback` | MARKETING | en | 1 | Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js |
| `hello_world` | UTILITY | en_US | 0 | Meta default sample - unused |
| `order_cancelled` | UTILITY | en | 2 | bot/index.js:1170 - order cancelled |
| `order_confirmed_delivery_v2` | UTILITY | en | 2 | bot/index.js:1071 - delivery confirmation |
| `order_confirmed_dinein` | UTILITY | en | 4 | bot/index.js:1059 - dine-in confirmation |
| `order_delivered_v3` | UTILITY | en | 5 | bot/index.js:1156 - order delivered |
| `order_placed` | UTILITY | en | 1 | bot/index.js:1049 - order-placed notice to customer |
| `order_ready_v3` | UTILITY | en | 3 | bot/index.js:1083 - order ready |
| `rider_assigned` | UTILITY | en | 3 | bot/index.js:1068 (isRiderChanged block) - meta transport only, non-dine-in, skipped without rider phone |

## Bodies (verbatim)

### `greeting_welcome` - MARKETING, `en`, 2 var(s)

```
Namaste *{{1}}* ji! 👋
════════════════════════
✨ *{{2}} mein aapka swagat hai!* 🍕
════════════════════════
Mazedar khana, fatafat aapke darwaze tak! 🚀
```

Used at: **unwired by design** - the in-window greeting already sends an image; a static template would be a UX regression

### `proactive_promo` - MARKETING, `en`, 1 var(s)

```
🍕 *Special Offer!*

{{1}}

_Order ke liye yahin reply karein ya QR scan karein! 🍕_
```

Used at: bot/index.js:425 + bot/promotions.js:60 - default promo shell

### `promo_hinglish_discount` - MARKETING, `en`, 1 var(s)

```
🎉 *Sirf Aapke Liye!* 🎉

{{1}}

_Yeh offer limited time ke liye hai — jaldi order karein! 🍕_
```

Used at: Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js

### `promo_hinglish_festive` - MARKETING, `en`, 1 var(s)

```
✨ *Tyohaar Special!* ✨

{{1}}

_Is tyohaar ko tasty banayein — order abhi karein! 🍕_
```

Used at: Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js

### `promo_hinglish_offer` - MARKETING, `en`, 1 var(s)

```
🍕 *Khaas Offer!* 🍕

{{1}}

_Order ke liye yahin reply karein ya QR scan karein! 🍕_
```

Used at: Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js

### `promo_hinglish_winback` - MARKETING, `en`, 1 var(s)

```
💚 *Aapko Miss Kar Rahe Hain!* 💚

{{1}}

_Wapas aa jao — aapke liye ek special surprise ready hai! 🍕_
```

Used at: Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js

### `hello_world` - UTILITY, `en_US`, 0 var(s)

```
Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.
```

Used at: Meta default sample - unused

### `order_cancelled` - UTILITY, `en`, 2 var(s)

```
❌ *ORDER CANCELLED* ❌
━━━━━━━━━━━━━━━━━━━━
Aapka order #{{1}} cancel ho gaya hai. 😔
Reason: {{2}}
Koi sawaal ho toh humse baat karein. 🙏
```

Used at: bot/index.js:1170 - order cancelled

### `order_confirmed_delivery_v2` - UTILITY, `en`, 2 var(s)

```
✅ *ORDER CONFIRMED!* 🎊
━━━━━━━━━━━━━━━━━━━━
{{1}}
Your order is being prepared with love! ❤️
{{2}} ❤️
```

Used at: bot/index.js:1071 - delivery confirmation

### `order_confirmed_dinein` - UTILITY, `en`, 4 var(s)

```
🏪 *WELCOME TO {{1}}!* ✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
Your counter order has been *CONFIRMED*! 🎊
🆔 *Order ID:* #{{2}}
👤 *Customer:* {{3}}
{{4}}━━━━━━━━━━━━━━━━━━━━━━━━━━
Your delicious meal is being prepared right now! 👨‍🍳🔥
_Thank you for dining with us!_ 🙏
```

Used at: bot/index.js:1059 - dine-in confirmation

### `order_delivered_v3` - UTILITY, `en`, 5 var(s)

```
✅ *{{1}} SUCCESSFULLY!* 🏪❤️
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #{{2}}
🤝 *Payment:* {{3}}
💵 *Total Paid:* ₹{{4}}
━━━━━━━━━━━━━━━━━━━━
*Enjoy your meal!* 😋
{{5}} ❤️
```

Used at: bot/index.js:1156 - order delivered

### `order_placed` - UTILITY, `en`, 1 var(s)

```
🎉 *ORDER PLACED!* 🍕
━━━━━━━━━━━━━━━━━━━━
{{1}}
We've received your order and our team is reviewing it now. ⏳
You'll get an update as soon as it's confirmed! ❤️
```

Used at: bot/index.js:1049 - order-placed notice to customer

### `order_ready_v3` - UTILITY, `en`, 3 var(s)

```
📦 *PACKED & READY!* 🚀
━━━━━━━━━━━━━━━━━━━━
Your delicious order #{{1}} is ready and packed! 🍱
{{2}}
{{3}} ❤️
```

Used at: bot/index.js:1083 - order ready

### `rider_assigned` - UTILITY, `en`, 3 var(s)

```
🛵 *RIDER ASSIGNED!* 🎯
━━━━━━━━━━━━━━━━━━━━
Your order #{{1}} has been assigned to a rider.
📞 *Rider:* {{2}} ({{3}})
Track your order live from the app!
```

Used at: bot/index.js:1068 (isRiderChanged block) - meta transport only, non-dine-in, skipped without rider phone

## Not approved

- `otp_changed` - REJECTED, UTILITY, `en`
- `out_for_delivery_v3` - REJECTED, UTILITY, `en`
- `rider_reached` - REJECTED, UTILITY, `en`

The three OTP-bearing UTILITY templates (`out_for_delivery_v3`, `rider_reached`, `otp_changed`) were rejected
as INCORRECT_CATEGORY and stay plain text: Meta rejects OTP-bearing templates, so the OTP message is sent as
free-form text inside the 24h window instead.

## Gotchas

- Vars must not sit at the start or end of a body (Graph `100/2388299`) - guard with static lines/emoji.
- Same-name create is blocked (`100/2388024`); edit an existing template with `POST /{template-id}` sending `components` only (`PUT` unsupported).
- Hinglish shells use `language: en` (romanized Latin; `hi` means Devanagari) and carry a single `{{1}}`, so `bot/transport.js` `sendTemplate` maps `body` -> `{{1}}` unchanged.
- Promos are hard-blocked on Baileys transport, so these MARKETING shells only deliver once an outlet flips to `meta`.
