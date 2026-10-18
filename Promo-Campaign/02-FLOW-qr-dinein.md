# QR dine-in tour — real clicks, with explanations

App: QR menu (`menu/`). Token-secured: `?t=<token>` validated, table number never trusted.

## 1. Scan → Welcome
**Clicks:** Scan table QR → invalid token shows "This QR code is invalid" + Try Again;
disabled restaurant shows "Restaurant temporarily disabled". Valid first visit: welcome —
pill TABLE, big number 07, "Welcome to [Store]", "Dine In Ordering", offer cards, **START ORDERING**.
Returning visit with session skips straight to Menu (or Status if orders exist).
**Say:** "No app download — and wrong QRs get a clean message, not a staff interruption."

## 2. Split or Share (only if table already open)
**Clicks:** "Split or Share?" → **Start My Own Bill** (Group B/C…) or tap group card (Group A — N orders) or Cancel.
**Say:** "One physical table, many independent bills — no waiter arbitration."

## 3. Menu → Customize
**Clicks:** chip TABLE 07, cart badge → Running Bill strip (N orders — ₹X) → category pills +
"Search for dishes…" + **Combo Offers / Add Combo** (orig vs combo price, % OFF) → tap dish →
sheet: photo, Size options, Add-ons +₹X toggles, Special Instructions "e.g. No onion…" →
− 1 + → **ADD TO ORDER ₹X** → toast "Dish added to cart" → sticky "N items — ₹X — View Cart →".
Blocked states: "Cannot add items — bill already requested for this group"; expired combo:
"This combo is no longer active".
**Say:** "Sizes, add-ons, combos upsell with zero staff prompting — dead stock hides itself."

## 4. Cart → Place Order
**Clicks:** Cart / View Cart → "Your Cart (Table 07)" → steppers (− to 0 asks "Remove this
item from your cart?") → Your Name (required) → 10-digit Mobile (required) → Guests stepper →
Special Note → Discount Code + Apply ("✓ CODE applied — ₹X off" / "Invalid or expired
discount code", Remove to clear) → summary (This Order / GST / Service / Discount / Total +
"added to your running bill ₹X across N orders") → **PLACE ORDER** ("Placing order…").
Behind: Pending → session+group transaction → Placed; ID like 03-161126-12; phone stored
in segregated `tableSessionsContact`, never the public session.
**Say:** "Name, headcount, notes, coupon — captured without one waiter trip, PII kept private, KDS never sees a phantom order."

## 5. Live status
**Clicks:** auto-lands Status. Hero: #ID, Table 07, pulsing icon, **Order Received →
Preparing Your Order → Ready To Serve → Order Served**, elapsed MM:SS, bar Received |
Preparing | Ready | Served. **Order Timeline** with timestamps, itemized card, Running Bill
at 2+ orders, toasts ("Order Confirmed"…). Buttons: **Order More Items**, **Request Bill**,
**Need help? Call Waiter**. Tabs anytime: Menu / Cart / Status / History / Promos.
**Say:** "Live status kills 'where is my food' — and Order More mid-meal is pure extra revenue."

## 6. Help / Water / Bill
**Clicks:** Status → Need help? Call Waiter → "Need Assistance?" → **Call Waiter** /
**Request Water** / **Request Bill** / **Clean Table** → card spins (Sending) → ✓ Sent
(~30s lock anti-spam). Bill refused until all served: "Please wait until all orders are
served before requesting the bill." States: "⏳ Bill Requested — Awaiting Staff" /
"✓ Bill Paid" / "Bill Generated — ₹X".
**Say:** "One tap replaces flagging down staff — spam-proof, bill-gated, routed by table number."

## 7. Promos tab → reviews & re-engage
**Clicks:** Promos → "Stay Connected" → **Rate us on Google** ("Leave a review — it helps
a lot!") / **Follow on Instagram** / **Like us on Facebook** / **Chat on WhatsApp**
(prefilled "Hi! I just dined at [Store]") / Install App / Add to Home Screen / Get Offers
& Updates / Enable (push via phone number). Only configured links render.
**Say:** "Every served table funneled to Google stars, Instagram follows, and a WhatsApp contact — one visit becomes repeat visits at zero ad cost."
