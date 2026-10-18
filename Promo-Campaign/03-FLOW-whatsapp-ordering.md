# WhatsApp ordering tour — real message flows, with explanations

Transports: Baileys QR (live) for chat/orders · Meta Cloud API for promotional campaigns.
Ordering itself happens in a webview link, never raw chat.

## 1. First contact
**Flow:** Customer texts hi → plain Hinglish welcome + "type Menu/Order" → state AWAITING.
Texts `menu`/`order` → greeting image + 2s pause + menu image + order link/button → WEBVIEW.
First-contact never blasts CTA (spam-classifier safety); closed shop → hours message.
**Say:** "Polite first hello — never a spam blast, so the number stays clean."

## 2. Ordering in webview (delivery)
**Clicks:** Tap one-time WhatsApp link (`?session=&src=wa&bot=&token=`, 30-min, single-use;
used/expired → "Link Unavailable" + Chat with Bot) → "Location Required" → Enable →
fee from distance slabs → browse/customize/cart as dine-in → Name / Mobile /
Delivery Address / Note / Discount Code → ENABLE LOCATION TO ORDER → PLACE ORDER →
"Placing your order…" → "Order Placed! Total ₹X — Check WhatsApp for updates" + Back to WhatsApp.
**Say:** "Delivery without building a delivery app — GPS-gated fee, single-use links, COD with the rider."

## 3. Coupons at checkout
**Flow:** Customer types code → client claims `coupon:{CODE}` → server re-validates via
discount engine (channel whatsapp, real customer, per-customer limits) → corrects
discount/total on the order; failures zero the discount, never honor the claim.
**Say:** "Codes work — abuse doesn't. Server re-checks every rupee."

## 4. Order updates (S1–S9 chain)
**Flow:** Order placed → bot sends status chain with invoice block (items, subtotal,
distance, shipping, Discount x% off, total) + progress bars + food joke on Delivered.
Admin gets new-order text + push; rider assigned → rider messages; stale >5h auto-cancelled.
**Say:** "Customer watches the invoice travel to their door — restaurant never chases."

## 5. STOP / safety (demo this — it sells trust)
**Flow:** `STOP` → opt-out recorded + confirmation; `START` → re-opt-in. Rejection-first-contact
("who is this") → one apology + auto-opt-out, no CTA. 3 non-intent messages → 30-min
silence (order notices still flow). Chat pacing 4–8s/chat; promos Meta-only hard-blocked
on Baileys; 8–15s promo pacing + 60–120s pause/30 + 300/day cap + warmup ramp.
**Say:** "STOP is honored everywhere, instantly — and promo campaigns refuse to start on
unsafe connections. That is why the number never gets banned."
