# Admin tab tour — all 24 tabs, flow-wise, real clicks

Source: `Admin/js/ui.js` TAB_DEFS + `page-guide.js` + feature files.
Format per tab: **Clicks** (exact sequence) → **Say** (demo narration line).

## 1. Dashboard
**Clicks:** Sidebar Dashboard → glance KPI cards (Today Orders / Revenue / AOV / Pending)
→ click a card → jumps to Orders filtered → hover chart points → click recent order row → drawer.
**Say:** "Ten-second triage — and the red Emergency-Stop button kills every promo instantly if one misfires."

## 2. Orders
**Clicks:** Orders → status tab (New 3 / Preparing 5 / Ready 2 / Out 4 / Delivered 28 / Cancelled 1)
→ click orange SLA card → drawer → Assign Rider → pick rider with 0 active → Update Status →
Mark Paid → Print Receipt → 80mm print. Search `98765` filters live.
**Say:** "Color tells you where money is stuck — red delayed, orange near SLA, green on track."

## 3. Kitchen (Live Ops)
**Clicks:** Kitchen → chime on new pulsing card → Accept (→ Preparing, KDS) or Reject + reason
(→ auto-WhatsApp to customer) → click accepted → Preparing → Ready → Out → Delivered,
each step auto-WhatsApps the ETA. Speaker icon toggles sound.
**Say:** "Accept in one tap, customer gets every update automatically — 'where is my order' calls die."

## 4. POS Control (walk-in)
**Clicks:** POS → category tab → click dish → pick size → pick addons → Add → +/− in cart →
tap ₹50/₹100/10% chip or type coupon PIZZA20 → View Offers → Apply → Cash+UPI split →
Submit Sale → print. Clear Cart with confirm.
**Say:** "Rush-hour billing with the best discount auto-picked — no over-discounting, split payments captured."

## 5. Tables / Dine-In (NO in-app guide — narrate fully)
**Clicks:** Tables → click table (Free/Occupied/Billing) → Open Drawer / QR modal →
advance order → Request Bill (per-table or per-group via orderGroups) → Apply coupon →
Confirm Payment → Print Bill → Close Session. Expired sessions auto-cancel.
**Say:** "One table, many independent bills — groups split without a single waiter argument, cancelled items never inflate the total."

## 6. Promotions
**Clicks:** Promotions → write message with {name} {storeName} → template picker (24) →
attach image → recipients: All-consenting / Active-30d / upload CSV → Preview →
Send test to me → Launch now or Schedule + quiet hours → watch Active progress bar →
Stop or EMERGENCY STOP ALL. Cap 300/campaign, 300/day, 8–15s pacing.
**Say:** "Repeat sales on tap — paced sends, STOP auto-honored, and campaigns refuse to start on unsafe connections."

## 7. Discounts
**Clicks:** Discounts → New Discount → name/type (Global/Category/New-Customer/Coupon) →
%/₹ value → channel (WhatsApp/POS/Both/Web/All) → schedule + per-customer/global limits +
min subtotal + exclusive group → Save → toggle on → Reports → View Code Uses → Export CSV.
Generate coupon: prefix DIWALI → word-codes, Stackable toggle.
**Say:** "Trial offers, lunch-hour fillers, coupon codes — and reports show exact redemptions and rupees saved per code."

## 8. Menu
**Clicks:** Menu → Add Dish → name/desc/category/price + image (auto-compress) →
sizes S/M/L → addon groups → Save → availability toggle. Category filter + search.
**Say:** "Right photos, right prices, right sizes — that is what converts on the QR menu."

## 9. Categories
**Clicks:** Categories → Add → name + sort order → Save → eye to hide → drag-handle reorder →
live in Menu/POS/customer instantly. Non-empty categories can't be deleted.
**Say:** "Best-sellers on top sell more — hide tomorrow's menu until launch."

## 10. Combos (NO in-app guide — narrate fully)
**Clicks:** Combos → Add Combo → pick dishes + combo price → Save → tiles appear atop POS grid → one tap adds bundle.
**Say:** "Meal-deal upsell in one tap at the counter — average ticket climbs without a word from staff."

## 11. Menu Browser (NO in-app guide)
**Clicks:** Menu Browser → All or category → search dish → grid preview of photos/prices.
**Say:** "Zero-risk QA — catch the bad photo before the customer does."

## 12. Inventory
**Clicks:** Inventory → Add Item → set threshold → Edit to Adjust (+ adds / − deducts, logged) →
Low Stock filter → View History → Export CSV → Import → preview → apply. Toggle off grays linked POS dishes.
**Say:** "No mid-service stockouts, no over-ordering — and linked dishes vanish from POS the moment stock dies."

## 13. Riders
**Clicks:** Riders → Add Rider → name/phone/email/vehicle + photo → Save → assign in Orders →
Settle Wallet (payout logged) → Block on exit → key icon resets password.
**Say:** "Closest idle rider gets the order — wallet settlement keeps every COD rupee reconciled."

## 14. Customers
**Clicks:** Customers → search name/phone → click card (orders/spent/last-order/consent ✓) →
expand history → click order → drawer → phone icon → WhatsApp follow-up. Export Excel/PDF.
**Say:** "Your consent list IS your promo audience — and the high-spender who went quiet is one click away."

## 15. WhatsApp Chat (NO in-app guide — narrate fully)
**Clicks:** WhatsApp → unread thread first → read bot/customer history → type reply → Send
(via bot, paced) → unread clears. Watch daily usage bar.
**Say:** "Human takeover rescues stuck orders live — that reply is what saves the refund and earns the 5-star."

## 16. Analytics (Reports)
**Clicks:** Analytics → Today / 7 / 30 days → tabs Sales-Overview / Order-Trends / Top-Items /
Category / Hourly-Heatmap (+ WA-bot KPIs) → hover/legend → Refresh → Export PDF/Excel.
**Say:** "Winners, losers, dead hours — this tells you what to promote, discount, or delist."

## 17. Rider Insights
**Clicks:** Rider Insights → set range → sort by on-time → hover earnings → click stars → read comments.
**Say:** "Reward the fast, coach the slow — hotter food, higher rating, more orders."

## 18. Feedback
**Clicks:** Feedback → donut (avg center) → filter 1★ → expand → respond icon → WhatsApp the customer.
**Say:** "Negatives answered in minutes don't become public one-stars."

## 19. Live Tracking
**Clicks:** Live Tracking → green/blue/red markers → click order panel → map focuses →
click rider → follow route + ETA → Refresh. 5–10s positions, 30s auto-refresh.
**Say:** "See the delay before the customer calls — reassign or ring first."

## 20. Notifications
**Clicks:** Notifications → compose title/body + deep-link (orders/menu) → preview card →
audience All / Recent-30d / segment → Send Now or Schedule → history analytics
(sent/delivered/opened). Bell sheet for inbox.
**Say:** "Free re-engagement that drops the customer straight into the order flow."

## 21. Payments
**Clicks:** Payments → date + method filter (Cash/Card/UPI/Wallet) → totals bar →
click row → order drawer → reconcile vs statements.
**Say:** "Pending and refunded leakage, caught in minutes instead of month-end."

## 22. Expenses (feature-flagged)
**Clicks:** Expenses → Today total + chips → Add Expense (date/category/amount/desc →
auto-approved under threshold, Manager PIN over ceiling) → History filter/approve →
Categories manage → Reports actual-vs-budget → Export → Settings tune.
**Say:** "True profit is sales minus THIS — overspend flags red before the month does."

## 23. Costs (NO in-app guide — narrate fully)
**Clicks:** Costs → This Month → QR/POS/WhatsApp breakdown (counts × rates, promo tokens × ₹1) → verify vs billing.
**Say:** "Every platform rupee itemized — shift expensive channels to cheap ones with proof."

## 24. Settings (+ Owner-only subtabs)
**Clicks:** Settings → store info → delivery fees (base/free-threshold/per-km + slabs) →
branding colors + preview → WhatsApp QR link → promos toggle → packaging/service%/tax →
Save. Subtabs: Staff (add/role/ceiling/PIN/disable) → Security Audit (Re-check → Fix).
**Say:** "Delivery fee and tax set here touch the margin of EVERY order — and ceilings plus Manager PIN stop till-abuse cold."
