# Pricing context for updating PRICING_AND_TERMS.md (facts taken from the code)

Source of truth: `shared/cost-math.js` and `shared/billing-defaults.*`. Use these facts; the wording and any new plan names are yours.

## 1. What the platform actually bills now ("Percentage package" — default for NEW restaurants)
| Source of the order | Rate | Notes |
|---|---|---|
| **Foodhubbie-App Orders** (the restaurant's own app: delivery AND pickup) | **3% of order value** (fixed) | Includes the delivery app and every status notification to the customer inside the app (placed, confirmed, ready, out for delivery, delivered…) |
| **QR menu** (table ordering) | **1%** | |
| **POS** (counter billing) | **1%** | |
| Other / manual | 1% | |
| **WhatsApp bot ordering** | label: **"Upcoming Feature in 1 month"** | Not being sold yet. The code still has 2% for WhatsApp-based/webview orders; it was deliberately left unchanged, so do not advertise a final WhatsApp price yet. |
- Cancelled and refunded orders are never billed.
- Percentage is on the order total as stored on the order (after discount; includes GST and delivery fee as part of "order total").
- Promotional (marketing) WhatsApp messages: ₹1 each, 15 free welcome tokens (unchanged).
- WhatsApp provider (Meta) message charges are separate pass-through costs (unchanged).

## 2. Wallet rules (unchanged, but should be stated in the terms)
- Prepaid wallet. **Minimum first top-up ₹1,000**, paid directly to FoodHubbie by UPI/bank; the owner records it in Supreme Admin.
- Setup fee in the defaults: ₹500, non-refundable.
- **Low-balance warning at 25%** of everything topped up so far; "finished" alert when balance reaches 0.
- Balance = total paid − order fees − promo messages − manual charges.

## 3. Old modes still in the code (existing restaurants keep them until you switch them)
- Flat per-order: QR ₹2, POS ₹1, WhatsApp/web delivery ₹5.
- "Official pack" (legacy): 1% on WhatsApp delivery only.
- **Existing restaurants are NOT changed automatically.** Switching is done per restaurant in Supreme Admin. Billing is computed from all orders, so switching a mode re-prices that restaurant's whole history in the wallet view — warn restaurants or switch at a month boundary.

## 4. Things in the current PRICING_AND_TERMS.md that no longer match
- Lines ~26-27: "Per-Customer ₹1 / customer" and "Fixed Monthly ₹750/mo (3-month intro ₹500)" — these plans are not what the billing code charges. The code bills per order (old) or percentage (new). Decide whether the monthly plans still exist; if not, remove them.
- Lines ~46-65: "Premium ₹1,250/month + Meta rates" and WhatsApp Ordering Bot "Included" — conflicts with "WhatsApp ordering = upcoming". Suggest marking it as upcoming / not yet available.
- Lines ~266-267: break-even calculator "₹1 × orders vs ₹750" — needs redoing for percentage pricing (e.g. 1% of monthly sales vs 3% for app orders).
- The public website pricing page (`website/index.html`) also still shows ₹1/₹2/₹5.
- No mention anywhere of: pickup orders, the in-app delivery code (OTP), customer phone privacy ("phone lock"), or the loyalty program rules (earn 1 point per ₹50 by default, redeem with a WhatsApp code, points expire after 180 days of inactivity). Consider adding short terms for these.

## 3-line summary you can reuse
Foodhubbie-App Orders: 3% of order value (delivery app + all in-app status updates). QR menu and POS: 1%. WhatsApp ordering: upcoming feature (pricing to be announced).
