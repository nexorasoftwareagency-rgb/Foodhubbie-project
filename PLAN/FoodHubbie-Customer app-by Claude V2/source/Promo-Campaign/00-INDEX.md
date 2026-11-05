# Promo-Campaign — master index

Demo-video research pack: every tab, every flow, mapped click-by-click from the
codebase (`Admin/js/features/page-guide.js`, `menu/js/*`, `bot/*`, `rider-app/src`),
guides, plans, and pricing docs. No random walkthroughs — each file is a real-click tour.

## Files

| File | Covers |
|---|---|
| `01-TAB-TOUR-Admin.md` | All 24 Admin tabs, one by one, flow-wise + demo line each |
| `02-FLOW-qr-dinein.md` | QR scan → menu → cart → live status → help/water/bill → reviews |
| `03-FLOW-whatsapp-ordering.md` | WhatsApp order flow, coupons, delivery webview, STOP/safety |
| `04-FLOW-promotions-discounts-combos.md` | Campaigns, discounts, coupons, combos + reports |
| `05-FLOW-rider-dispatch.md` | Rider accept → pickup → OTP drop → payment |
| `06-PROMO-TACTICS.md` | Every tactic framed as owner revenue outcome |
| `07-PRICING-COST-STORY.md` | Pricing + cost facts as pitch lines |
| `08-DEMO-SCRIPT.md` | Ordered video tour: scene order, clicks, narration |

## Source truth

- Tab manuals: `Admin/js/features/page-guide.js` (21 keys) + `promotions-guide.js`
- 5 tabs have NO in-app guide (gap the demo must cover by narration): **Tables, Combos,
  Menu Browser, Chat (WhatsApp), Costs**
- `staff-management` + `security-audit` are Settings subtabs, Owner-only
- Roles: Owner/Admin = all · Manager = all-minus-settings · Cashier = dashboard/walkin/tables/orders/live/notifications · Waiter = orders/live/notifications

## Tour order for the video (see 08-DEMO-SCRIPT)

QR dine-in → WhatsApp ordering → Admin tabs (Orders→Kitchen→Tables→POS→Menu→Combos→
Discounts→Promotions→Customers→Riders→Live Tracking→Analytics→Feedback→Payments→
Expenses→Costs→Settings) → Rider dispatch → Pricing close.
