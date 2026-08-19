# Roshani Pizza Bot — Complete WhatsApp Message Drafts

Every message the bot (`bot/`) sends, rendered **exactly as a customer / admin / rider would receive it**, one copy each, in the order they occur.

> **Sample order used for realistic data**
> - Order ID: `20260809-00015` → short ID `#00015`
> - Customer: **Rajesh Kumar**, phone `9876543210`, WhatsApp `919876543210@s.whatsapp.net`
> - Address: `12, Gali No. 4, Kankarbagh, Patna`
> - Location: `25.59, 85.13`
> - Items: Margherita Pizza (Large) x2 @ ₹400 + Extra Cheese ₹50 = ₹900/line · Garlic Bread (Regular) x1 ₹90
> - Subtotal ₹990 · Delivery 5.2 km ₹50 · Discount FEAST10 (10%) −₹99 · **Total ₹941** · UPI
> - Delivery OTP: `4521` · Rider: **Arjun Singh** `9812345678` · Outlet: Pizza
> - Coupon code used: `FEAST10`

---

## PART 1 — CUSTOMER MESSAGES (WhatsApp chat with the bot)

*(In chat-order sequence. Messages marked `[image]` arrive as an image with this caption.)*

### C1. Welcome back — greeting `[image]`
```
Welcome back, *Rajesh*! 👋
Your favorite items are ready for you. 🍕
------------------------
✨ *WELCOME TO ROSHANI PIZZA* 🍕
------------------------
Delicious food, delivered fast to your doorstep! 🚀
```

### C2. Menu CTA + ordering link `[image]` (no admin footer)
```
🛒 *Ready to order?*
👇 *TAP THE LINK BELOW TO ORDER NOW* 👇
--------------------------
https://roshani-sudha-menu.web.app/pizza/delivery.html?session=9876543210&src=wa&bot=7485095436&token=a1b2c3d4e5
```

### C3. Webview step — "order"/"menu"/"pizza"/"cake" → resend menu `[image]`
```
🛒 *Ready to order?*
👇 *TAP THE LINK BELOW TO ORDER NOW* 👇
--------------------------
https://roshani-sudha-menu.web.app/pizza/delivery.html?session=9876543210&src=wa&bot=7485095436&token=a1b2c3d4e5
```

### C4. Webview step — "track"/"status"/"where"
```
📋 Type *status* to check your order status, or tap the menu link above to order again.
```

### C5. Webview step — any other message → nudge `[image]`
```
💡 *Tap below to browse & order!*
--------------------------
https://roshani-sudha-menu.web.app/pizza/delivery.html?session=9876543210&src=wa&bot=7485095436&token=a1b2c3d4e5
```

### C6. Shop closed (sent instead of greeting)
```
🌙 *ROSHANI PIZZA IS CLOSED*

Hours: 11:00 AM - 10:30 PM

See you later! 👋
```

### C7. Categories list `[image]`
```
✨ *ROSHANI PIZZA* ✨
🍽️ *SELECT CATEGORY - PIZZA*
1️⃣  Pizzas
2️⃣  Garlic Bread & Sides
3️⃣  Beverages
4️⃣  Desserts
🛒 *9* View Cart
0️⃣ *Take one step Back* 🔙
_Reply with a number to browse_
```

### C8. Dishes in category `[image]`
```
🍽️ *PIZZAS*
1️⃣  *Margherita Pizza*
2️⃣  *Farmhouse Pizza*
3️⃣  *Pepperoni Pizza*
🛒 *9* View Cart
0️⃣ *Take one step Back* 🔙
```

### C9. Select size `[image]`
```
📏 *SELECT SIZE*
1️⃣  Regular — ₹180
2️⃣  Medium — ₹260
3️⃣  Large — ₹400
0️⃣ *Take one step Back* 🔙
```

### C10. Enter quantity *(has admin footer)*
```
🔢 *STEP 4: ENTER QUANTITY* 🍕
*How many of this item would you like to order?*
_Example: Reply with 1, 2, 5, etc._
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C11. Added to cart *(has admin footer)*
```
✅ *ADDED TO CART!* 🛒
1. *Margherita Pizza* (Large)
   + Extra Cheese
   Qty: 2 x ₹450 = ₹900

💰 *Subtotal: ₹900*
1️⃣  *Add another item* 🍕
2️⃣  *Proceed to Checkout* 🚀
3️⃣  *Clear Cart* 🗑️
0️⃣  *Back* 🔙
_Reply with 1, 2, 3 or 0_
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C12. Cart summary / view cart *(has admin footer)*
```
🛒 *YOUR CART SUMMARY*
1. *Margherita Pizza* (Large)
   + Extra Cheese
   Qty: 2 x ₹450 = ₹900

2. *Garlic Bread* (Regular)
   Qty: 1 x ₹90 = ₹90

💰 *Subtotal: ₹990*
1️⃣  *Add another item* 🍕
2️⃣  *Proceed to Checkout* 🚀
3️⃣  *Clear Cart* 🗑️
0️⃣  *Back* 🔙
_Reply with 1, 2, 3 or 0_
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C13. Empty cart
```
🛒 *YOUR CART IS EMPTY*
You haven't added anything to your cart yet. 🍕
1️⃣  *Browse Menu* 🍽️
🏠 *0* Main Menu
```

### C14. Coupon prompt *(has admin footer)*
```
🎟️ *HAVE A COUPON CODE?* 🎟️
If you have a discount code, reply with it now.
Otherwise, reply *0* to skip and continue to checkout.
0️⃣ *Skip — continue to checkout*
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C15. Coupon accepted
```
✅ Coupon *FEAST10* accepted! Continuing to checkout…
```

### C16. Coupon expired
```
⏰ Coupon *FEAST10* has expired. Reply *0* to skip or try another code.
```

### C17. Coupon not started yet
```
📅 Coupon *FEAST10* is not active yet. Reply *0* to skip or try another code.
```

### C18. Coupon disabled
```
❌ Coupon *FEAST10* is no longer active. Reply *0* to skip or try another code.
```

### C19. Invalid coupon code
```
❌ Invalid code *FEAST10*. Reply *0* to skip or try another code.
```

### C20. Reuse saved details *(has admin footer)*
```
👤 *REUSE YOUR SAVED DETAILS?*
Name: Rajesh Kumar
Phone: 9876543210
Address: 12, Gali No. 4, Kankarbagh, Patna
1️⃣ Yes, use these details
2️⃣ No, enter new details
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C21. Step 1 — Enter name *(has admin footer)*
```
👤 *STEP 1: ENTER YOUR FULL NAME* ✨
Please provide your name so we can address you correctly and prepare your order.
_Example: Rajesh Kumar_
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C22. Step 2 — Enter phone *(has admin footer)*
```
📞 *STEP 2: ENTER YOUR 10 DIGIT MOBILE NUMBER*
_Example: 9876543210. We will use this to contact you regarding your order._
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C23. Step 3 — Enter address *(has admin footer)*
```
🏠 *STEP 3: ENTER YOUR DELIVERY ADDRESS*
_Please provide your complete address including landmark, house number, etc._
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C24. Share location *(has admin footer)*
```
📍 *SHARE YOUR LOCATION* 🌍
Please share your *Live* or *Current* Location so we can calculate the delivery fee.
*How to share:*
1️⃣ Click the 📎 (Paperclip) or *+* button in WhatsApp
2️⃣ Select 'Location'
3️⃣ Choose 'Send Your Current Location'
_This step is mandatory for delivery calculation._
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C25. Invoice / confirm payment *(has admin footer)*
```
🧾 *INVOICE*
━━━━━━━━━━━━━━━━━━━━
1. *Margherita Pizza* (Large)
   + Extra Cheese
   Qty: 2 x ₹450 = ₹900

2. *Garlic Bread* (Regular)
   Qty: 1 x ₹90 = ₹90

━━━━━━━━━━━━━━━━━━━━
💰 Subtotal: ₹990
🚚 Delivery (5.2km): ₹50
🎁 Discount (FEAST10 10% off): -₹99
💵 *TOTAL: ₹941*
1️⃣ Confirm Order
2️⃣ Cancel
0️⃣ *Take one step Back* 🔙
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C26. Order placed successfully *(has admin footer)*
```
🎉 *ORDER PLACED SUCCESSFULLY!* 🎉
━━━━━━━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
🏪 *Shop:* Roshani Pizza
━━━━━━━━━━━━━━━━━━━━━━━━━━
*Please wait while the admin confirms your order!* ⏳
Total: ₹941
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C27. Order cancelled by customer *(has admin footer)*
```
❌ Order Cancelled. We hope to serve you next time! 🙏
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C28. Auto-cancel — order stale 5 hours
```
Sorry , Hame Maaf Kijiyega, ham aapka Order Deliver nahi kar payen, Please Order Again 🙏
```

### C29. Order reset (reply CANCEL / RESET)
```
❌ *Order Reset.* Reply with any message to start again.
```

### C30. Rate limit exceeded
```
⚠️ *Slow down!* You're sending messages too fast. Please wait a moment before trying again.
```

### C31. Cart cleared *(has admin footer)*
```
🗑️ Cart cleared. Reply with any message to start again.
--------------------------------
If you have any Doubt Contact Admin: *9724649971*
```

### C32. Promo opt-out
```
✅ You've been unsubscribed from promotional messages. Reply START to opt back in anytime.
```

### C33. Promo re-subscribe
```
🎉 Welcome back! You're re-subscribed to promotional messages.
```

---

## PART 2 — ORDER STATUS UPDATES (customer, sent as order progresses)

### S1. Status → **Placed** `[image]`
```
🎉 *ORDER PLACED!* 🍕
━━━━━━━━━━━━━━━━━━━━
🧾 *ORDER SUMMARY*
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
👤 *Customer:* Rajesh Kumar
📍 *Type:* Online
━━━━━━━━━━━━━━━━━━━━
📦 *ITEMS:*
• *Margherita Pizza* (Large) x2 - ₹900
  _Addons: Extra Cheese_
• *Garlic Bread* (Regular) x1 - ₹90

━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ₹990
📍 *Distance:* 5.2 km
🚚 *Shipping:* ₹50
🎁 *Discount (10% off):* -₹99
💵 *TOTAL AMOUNT: ₹941*
━━━━━━━━━━━━━━━━━━━━
We've received your order and our team is reviewing it now. ⏳
You'll get an update as soon as it's confirmed! ❤️
```

### S2. Status → **Confirmed** `[image]`
```
✅ *ORDER CONFIRMED!* 🎊
━━━━━━━━━━━━━━━━━━━━
🧾 *ORDER SUMMARY*
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
👤 *Customer:* Rajesh Kumar
📍 *Type:* Online
━━━━━━━━━━━━━━━━━━━━
📦 *ITEMS:*
• *Margherita Pizza* (Large) x2 - ₹900
  _Addons: Extra Cheese_
• *Garlic Bread* (Regular) x1 - ₹90

━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ₹990
📍 *Distance:* 5.2 km
🚚 *Shipping:* ₹50
🎁 *Discount (10% off):* -₹99
💵 *TOTAL AMOUNT: ₹941*
━━━━━━━━━━━━━━━━━━━━
Your order is being prepared with love! ❤️

*Progress:* [ ✅⬜⬜⬜⬜ ]
```

### S3. Dine-in counter order → **Confirmed** (no invoice)
```
🍕 *WELCOME TO ROSHANI PIZZA!* ✨
━━━━━━━━━━━━━━━━━━━━━━━━━━
Your counter order has been *CONFIRMED*! 🎊
🆔 *Order ID:* #00015
👤 *Customer:* Rajesh Kumar
🪑 *Table No:* 7
━━━━━━━━━━━━━━━━━━━━━━━━━━
Your delicious meal is being prepared right now! 👨‍🍳🔥
_Thank you for dining with us!_ 🙏
```

### S4. Status → **Ready / Packed** `[image]`
```
📦 *PACKED & READY!* 🚀
━━━━━━━━━━━━━━━━━━━━
Your delicious order #00015 is ready and packed! 🍱
Waiting for the rider to pick it up. 🛵

*Progress:* [ ✅👨‍🍳🔥📦 ]
```

### S5. Status → **Out for Delivery** `[image]`
```
🛵 *OUT FOR DELIVERY!* 🚀
━━━━━━━━━━━━━━━━━━━━
Our rider is on the way to your location! 🛵💨
🆔 Order: #00015
🔑 *OTP:* 4521 (Share with rider only)
📞 *Rider:* Arjun Singh (9812345678)
💰 *Total:* ₹941

*Progress:* [ ✅👨‍🍳🔥📦🚀 ]
```

### S6. New delivery OTP (OTP changed while out for delivery) `[image]`
```
🔑 *NEW DELIVERY OTP!* 🔄
━━━━━━━━━━━━━━━━━━━━
Your previous code is now invalid. Please use the new one below for your delivery #00015:
🔑 *NEW OTP:* 7843
📞 *Rider:* Arjun Singh (9812345678)
💰 *Total:* ₹941
_Share this code ONLY with the rider upon arrival._
```

### S7. Status → **Reached drop location** `[image]`
```
📍 *RIDER HAS REACHED!* 🚨
━━━━━━━━━━━━━━━━━━━━
Our rider has arrived at your location for order #00015.
🔑 *OTP:* 4521 (Please share with rider)
Please be ready to receive your order. Thank you! 🙏
```

### S8. Status → **Delivered** (or **Served** for dine-in) `[image]`
```
✅ *DELIVERED SUCCESSFULLY!* 🍕❤️
━━━━━━━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
🤝 *Payment:* UPI
💵 *Total Paid:* ₹941
━━━━━━━━━━━━━━━━━━━━━━━━━━
*Enjoy your meal!* 😋
Why did the pizza go to the doctor? It was feeling a bit 'cheesy'! 🍕
```

### S9. Status → **Cancelled**
```
❌ *ORDER CANCELLED* ❌
━━━━━━━━━━━━━━━━━━━━
We're sorry, your order #00015 has been cancelled.
Reason: Store Busy / Technical Issue
If you have any questions, please contact us. 🙏
```

---

## PART 3 — ADMIN MESSAGES (to admin WhatsApp numbers)

### A1. New order received
```
🔔 *NEW ORDER RECEIVED!* 🔔

🆔 ID: #00015
👤 Customer: Rajesh Kumar
📞 Phone: 9876543210
📍 Address: 12, Gali No. 4, Kankarbagh, Patna

📦 Items:
• Margherita Pizza (Large) x2
• Garlic Bread (Regular) x1

💰 Total: ₹941
💳 Method: UPI
```

### A2. Order update (existing order changed)
```
📦 *ORDER UPDATE* 📦

🆔 ID: #00015
👤 Customer: Rajesh Kumar
📞 Phone: 9876543210
📍 Address: 12, Gali No. 4, Kankarbagh, Patna

📦 Items:
• Margherita Pizza (Large) x2
• Garlic Bread (Regular) x1

💰 Total: ₹941
💳 Method: UPI
```

### A3. Lost sale / abandoned cart (customer cancelled at checkout)
```
⚠️ *LOST SALE / ABANDONED* ⚠️
━━━━━━━━━━━━━━━━━━━━
👤 *Customer:* Rajesh Kumar
📞 *Phone:* 9876543210
💰 *Potential Total:* ₹941
🏪 *Outlet:* PIZZA
━━━━━━━━━━━━━━━━━━━━
_User cancelled at final checkout step._
```

### A4. Rider on the way to restaurant
```
🛵 *RIDER ON THE WAY TO RESTAURANT* 🛵
━━━━━━━━━━━━━━━━━━━━
🆔 ID: #00015
👤 Customer: Rajesh Kumar
📞 Phone: 9876543210
🛵 Rider: Arjun Singh
📞 Rider Phone: 9812345678
━━━━━━━━━━━━━━━━━━━━
_Get the order ready for pickup._
```

### A5. Rider arrived at restaurant
```
🛵 *RIDER ARRIVED AT RESTAURANT* 🛵
━━━━━━━━━━━━━━━━━━━━
🆔 ID: #00015
🛵 Rider: Arjun Singh
━━━━━━━━━━━━━━━━━━━━
_Hand over the order for pickup._
```

### A6. Low stock alert (auto after order deducts stock past threshold)
```
⚠️ *LOW STOCK ALERT* ⚠️
━━━━━━━━━━━━━━━━━━━━
📦 Item: *Mozzarella Cheese*
📉 Current Stock: *2*
🚩 Threshold: *5*

_Please refill stock from Admin Panel immediately!_
```

### A7. Daily sales report (auto 9:30 PM IST / catch-up 1:30 AM)
```
📊 *ROSHANI PIZZA — DAILY SALES REPORT* 🍕

📅 Sales Date: *9 August 2026*
⏰ Generated: 21:30 IST

🍕 *PIZZA OUTLET:*
   📦 Total Orders: 48
   💰 Real Sales: ₹18,540
   📊 Breakdown:
      ▫️ Delivered: 31
      ▫️ Confirmed: 4
      ▫️ Placed: 6
      ▫️ Cancelled: 5
      ▫️ Out for Delivery: 2

💵 *TOTAL REVENUE:* ₹18,540
📦 *TOTAL ORDERS:* 48

_Sent automatically by Roshani Pizza Bot_
```

### A8. Weekly sales report (last 7 days)
```
📊 *ROSHANI PIZZA — WEEKLY SALES REPORT* 🍕

📅 Week: 2/8/2026 - 9/8/2026

🍕 *PIZZA OUTLET:*
   📦 Orders: 312
   💰 Revenue: ₹1,24,700

💵 *WEEKLY TOTAL:* ₹1,24,700
📦 *TOTAL ORDERS:* 312

_Sent automatically by Roshani Pizza Bot_
```

### A9. Monthly sales report (current month)
```
📈 *ROSHANI PIZZA — MONTHLY SALES REPORT* 🍕

📅 Month: August 2026

🍕 *PIZZA OUTLET:*
   📦 Orders: 1,248
   💰 Revenue: ₹5,02,340

💵 *MONTHLY TOTAL:* ₹5,02,340
📦 *TOTAL ORDERS:* 1,248

_Sent automatically by Roshani Pizza Bot_
```

### A10. Daily report generation failed
```
⚠️ *Daily report failed to generate* for Roshani Pizza (today).
Check `pm2 logs pizza-bot` for details.
```

### A11. Admin command `!status` (bot status dashboard)
```
🤖 *BOT STATUS DASHBOARD*
━━━━━━━━━━━━━━━━━━━━
✅ Status: *Online*
⏱️ Uptime: *1240 mins*
📊 Orders in Memory: *48*
🔗 Socket JID: *917485095436@s.whatsapp.net*
━━━━━━━━━━━━━━━━━━━━
```

### A12. Admin command `!ping`
```
🏓 *Pong!* Bot is active and listening.
```

### A13. Admin command `!report` / `!sales` (acknowledgement)
```
⏳ Generating latest sales report...
```

### A14. Admin FCM push notification (admin web app / browser notification)
```
Title: 🆕 New Order #00015
Body:  Rajesh Kumar · ₹941 · PIZZA
```

### A15. Generic message (sent from Admin Dashboard → single phone)
```
[Any free-form text typed by the admin in the dashboard.]
```

---

## PART 4 — RIDER MESSAGES (WhatsApp + in-app)

### R1. Ready for pickup (assigned rider, WhatsApp)
```
🛵 *READY FOR PICKUP* 🛵
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
🧾 *INVOICE DETAILS:*
• *Margherita Pizza* (Large) x2 - ₹900
  _Addons: Extra Cheese_
• *Garlic Bread* (Regular) x1 - ₹90
━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ₹990
🚚 *Delivery:* ₹50
🎁 *Discount (10% off):* -₹99
💵 *TOTAL: ₹941* (UPI)
━━━━━━━━━━━━━━━━━━━━
👤 *CUSTOMER INFO:*
*Name:* Rajesh Kumar
*Phone:* 9876543210
*Address:* 12, Gali No. 4, Kankarbagh, Patna
*Distance:* 5.2 km
📍 *Location:* https://www.google.com/maps?q=25.59,85.13
━━━━━━━━━━━━━━━━━━━━
🔑 *DELIVERY OTP:* 4521
━━━━━━━━━━━━━━━━━━━━
_The order is packed and waiting. Please arrive at the outlet immediately!_
```

### R2. New order assigned (WhatsApp)
```
🔔 *NEW ORDER ASSIGNED* 🔔
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
🧾 *INVOICE DETAILS:*
• *Margherita Pizza* (Large) x2 - ₹900
  _Addons: Extra Cheese_
• *Garlic Bread* (Regular) x1 - ₹90
━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ₹990
🚚 *Delivery:* ₹50
🎁 *Discount (10% off):* -₹99
💵 *TOTAL: ₹941* (UPI)
━━━━━━━━━━━━━━━━━━━━
👤 *CUSTOMER INFO:*
*Name:* Rajesh Kumar
*Phone:* 9876543210
*Address:* 12, Gali No. 4, Kankarbagh, Patna
*Distance:* 5.2 km
📍 *Location:* https://www.google.com/maps?q=25.59,85.13
━━━━━━━━━━━━━━━━━━━━
🚀 *Please reach the outlet for pickup!*
```

### R3. Pickup available — broadcast to all online riders (WhatsApp)
```
🔔 *PICKUP AVAILABLE* 🔔
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #00015
🏪 *Outlet:* PIZZA
🧾 *INVOICE DETAILS:*
• *Margherita Pizza* (Large) x2 - ₹900
  _Addons: Extra Cheese_
• *Garlic Bread* (Regular) x1 - ₹90
━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ₹990
🚚 *Delivery:* ₹50
🎁 *Discount (10% off):* -₹99
💵 *TOTAL: ₹941* (UPI)
━━━━━━━━━━━━━━━━━━━━
👤 *CUSTOMER INFO:*
*Name:* Rajesh Kumar
*Phone:* 9876543210
*Address:* 12, Gali No. 4, Kankarbagh, Patna
*Distance:* 5.2 km
📍 *Location:* https://www.google.com/maps?q=25.59,85.13
━━━━━━━━━━━━━━━━━━━━
🚀 *Go to Rider Portal now to Accept!*
```

### R4. In-app notification — new order assigned (rider app)
```
Title: New Order Assigned!
Body:  You have been assigned to order #00015.
```

### R5. In-app notification — order ready for pickup (rider app)
```
Title: Order Ready for Pickup!
Body:  Order #00015 is packed and waiting for you.
```

### R6. In-app notification — new pickup available (rider app)
```
Title: New Pickup Available!
Body:  Order #00015 is ready for pickup.
```

---

## PART 5 — PROMOTIONAL CAMPAIGN MESSAGES

*Template-driven. `{name}`, `{storeName}`, `{phone}`, `{couponCode}`, `{lastOrderDate}` are replaced per recipient. Optional pieces: greeting prefix, menu footer, image, closing line, STOP footer.*

### P1. Full campaign message (text + image + menu footer + closing + STOP)
```
Hi Rajesh,

🍕 *MEGA MONDAY DEAL* 🍕
Get 1 Large Margherita FREE with any Large Pizza order!
Use code *FEAST10* at checkout to save 10% extra.

Your last order was 02 Aug 2026 — come back for more!

━━━━━━━━━━━━━━━━
📖 *FULL MENU:* https://roshani-sudha-menu.web.app/pizza/delivery.html

Thank you for choosing Roshani Pizza! ❤️

_Reply STOP to unsubscribe._
```

### P2. Greeting-only campaign (no image, no menu)
```
Hi Rajesh,

We miss you! 🍕 Use code *SAVE10* on your next order at Roshani Pizza.

_Reply STOP to unsubscribe._
```

### P3. Coupon-generated campaign (auto-generated code per recipient)
```
Hi Rajesh,

Special gift just for you — coupon *PIZZA42* is active on your next order! 🎁
Valid once. Order today at https://roshani-sudha-menu.web.app/pizza/delivery.html

_Reply STOP to unsubscribe._
```

---

## PART 6 — INVALID INPUT HELP MESSAGES (customer)

### H1. Invalid input at Category step
```
⚠️ *Invalid Selection.* Please reply with a *Category Number* from the list above.

🛒 *9* View Cart
🏠 *0* Main Menu
```

### H2. Invalid input at Dish step
```
⚠️ *Invalid Selection.* Please reply with an *Item Number* from the list above.

🛒 *9* View Cart
🔙 *0* Back to Categories
```

### H3. Invalid input at Size step
```
⚠️ *Invalid Selection.* Please select a *Size Number* (1, 2, etc.) from the options above.
```

### H4. Invalid input at Addons step
```
⚠️ *Invalid Selection.* Reply with an *Add-on Number* to add it, or *0* (Zero) if you are *DONE*.
```

### H5. Invalid input at Quantity step
```
⚠️ *Invalid Selection.* Please enter a quantity between *1* and *50*.
```

### H6. Invalid input at Location step
```
⚠️ *Invalid Selection.* To continue, please share your *Live/Current Location* using the 📎 (Paperclip) or + button in WhatsApp and selecting 'Location'.
```

### H7. Invalid input at Confirm-payment step
```
⚠️ *Invalid Selection.* Please reply with *1* to Confirm Order or *2* to Cancel.
```

### H8. Invalid input at Payment-method step
```
⚠️ *Invalid Selection.* Please reply with *1* for Cash or *2* for UPI.
```

### H9. Invalid input at Cart step
```
⚠️ *Invalid Selection.* Please reply with *1* to Proceed to Checkout or *2* to Clear Cart.
```

### H10. Invalid input at Coupon step
```
⚠️ *Invalid Selection.* If you have a coupon code, reply with it. Otherwise reply *0* to skip and continue.
```

### H11. Invalid input at Reuse-profile step
```
⚠️ *Invalid Selection.* Please reply with *1* to use your saved details or *2* to enter new ones.
```

### H12. Invalid input at any other step
```
⚠️ *Invalid Selection.* Please follow the instructions in the message above or reply *RESET* to start over.
```

### H13. Invalid reply in "Added to cart" step
```
⚠️ Reply *1* to add more, *2* to view cart or *0* to go back.
```

### H14. Invalid reply in "Empty cart" step
```
⚠️ Reply *1* to browse menu or *0* to go back.
```

### H15. Main menu (reply 0 at category)
```
🏠 *Main Menu* — Send any message to restart.
```

---

## PART 7 — ERROR / EDGE-CASE MESSAGES

### E1. No categories available
```
❌ No categories available right now.
```

### E2. No items in category
```
❌ No items in this category.
```

### E3. Generic processing error
```
❌ Something went wrong. Please try again.
```

### E4. Order placement error
```
❌ Error placing your order. Please try again.
```

### E5. Delivery fee calculation error
```
❌ Error calculating delivery fee. Please try again.
```

---

## Source reference (file → message)

| File | Messages |
|------|----------|
| `bot/index.js` | C1–C33, S1–S9, A1–A15, H1–H15, E1–E5 (chat flows, status pipeline, admin notifies) |
| `bot/utils.js` | `formatOrderInvoice` (used in S1/S2 invoice block), `formatCartSummary` (C11/C12/C25), `getFunnyFoodJoke` (S8), `getFoodFunnyProgress` (S2/S4/S5) |
| `bot/reports.js` | A7–A9 (daily/weekly/monthly sales reports) |
| `bot/promotions.js` | P1–P3 (promo campaigns), C32/C33 opt-out/opt-in handled in index.js |
| `bot/rider.js` | R1–R3 (pickup / assignment / broadcast), plus the WhatsApp-side triggers for R4–R6 |
| `bot/discount-engine.js` | (no user-facing messages) |
