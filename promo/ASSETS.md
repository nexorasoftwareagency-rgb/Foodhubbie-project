# Asset Inventory

All marketing images are **real product screenshots** with a branded frame. No stock photos, no mock UI, no invented numbers.

## Ready

| Asset | Size | Path | Used for |
|---|---|---|---|
| Social card | 1080×1350 (@2x) | `website/assets/social/restaurant-os-1080x1350.png` | X post, Threads 1/2, LinkedIn |
| PH gallery 1 — POS | 1270×760 (@2x) | `promo/assets/ph-gallery-1.png` | Product Hunt, directory listings |
| PH gallery 2 — tables | 1270×760 (@2x) | `promo/assets/ph-gallery-2.png` | Product Hunt |
| PH gallery 3 — analytics | 1270×760 (@2x) | `promo/assets/ph-gallery-3.png` | Product Hunt |
| PH gallery 4 — promotions | 1270×760 (@2x) | `promo/assets/ph-gallery-4.png` | Product Hunt |
| Logo / thumbnail | 240×240 (@2x) | `promo/assets/logo-240.png` | Product Hunt thumbnail, directory avatars |
| Demo walkthrough video | 32s · 1280×720 (~1MB) | `promo/assets/demo-walkthrough-32s.mp4` | Product Hunt, X/Threads, directory listings |
| Demo video poster | 1280×720 | `promo/assets/demo-poster.png` | Video placeholder before autoplay |

Video: real 2m16s screen recording of the live admin (dashboard → KDS confirm
→ Ready toast → table card ₹352.03 → analytics), trimmed to 32s. Owner email
masked to `owner@foodhubbie.app`.

Screenshot sources live in `website/assets/shots/`. Six shots replaced
2026-10-21 with real-data captures (1440×900, email masked, owner's own demo
outlet data): `admin-dashboard.webp`, `dashboard.webp` (₹213/₹352/₹691
KPIs), `live-orders.webp` (KDS, 3 populated columns), `table-management.webp`
(3 occupied tables, ₹647 today), `orders.webp` (Placed/PREPARING/Ready rows),
`analytics-3.webp` (7-day revenue trend). `analytics-1/2.webp` still ₹0 —
do not gallery them.

## Missing (highest value first)

| Asset | Why it matters | How to make it |
|---|---|---|
| 20–30s screen recording: scan table QR → order lands in dashboard → kitchen ticket → bill | Demos convert; a static gallery doesn't | Record the live admin + menu on one phone and one laptop, same order, then trim |
| One real customer quote (with permission) | Only proof that isn't our own claim | Ask the first paying outlet; use their words, not ours |
| Google review screenshot | Social proof for directories | Ask after 2–3 weeks of live use |
| 60s founder intro (face + voice) | Trust for cold WhatsApp/email | Phone camera, one take, no script reading |

## Screenshots that must NOT be used

Rejected during gallery build — keep this list so nobody reuses them:

| Shot | Problem |
|---|---|
| `analytics-1.webp`, `analytics-2.webp` | ₹0 / 0 orders (analytics-3 now has real 7D data, safe) |
| `whatsapp-bot.webp` | Chat list pixelated for PII — unreadable, looks broken in a gallery |
| anything showing `roshanpizza@gmail.com` or a real customer phone | PII rule |
| any dashboard/table shot with a real customer name | Released only for internal docs; keep customer PII out of marketing galleries |

## Regenerating

Frames are HTML rendered by Playwright at 2x:

- Social card source: `%TEMP%\opencode\social-card.html` → `%TEMP%\opencode\shoot-card2.cjs`
- Gallery frames: `%TEMP%\opencode\ph-gallery-{1..4}.html` → `%TEMP%\opencode\shoot-ph.cjs`

Both scripts take screenshots from `website/assets/shots/*.webp` and write PNGs. The temp files are disposable — if they're gone, rebuild from the specs in this file (dark `#0E0F12` background, `#E84908` accent, Inter, orange radial glow top-right, shot inset 56px with 16px radius).

## Rules

1. Every number visible in an image must be plausible and non-PII (₹1,125 revenue / 9 orders from a demo outlet is fine; a real customer's phone number is not).
2. No "zero ban risk" text inside images — the card footer says "Official WhatsApp Cloud API · consent-only campaigns · STOP honoured" instead.
3. Keep the pricing line identical everywhere: "₹1–5 per order. No monthly fee. ₹500 one-time setup."
