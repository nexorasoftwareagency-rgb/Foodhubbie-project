# Promotion Tracker

Status as of **2026-10-21**. Update the row, then append a line to the log.

## Channels

| # | Channel | Type | Cost | Status | Next action | Owner | Result |
|---|---|---|---|---|---|---|---|
| 1 | X (Twitter) | Social | Free | READY | Post `COPY.md` → X #1 with `assets/restaurant-os-1080x1350.png` (or `website/assets/social/restaurant-os-1080x1350.png`) | Owner | — |
| 2 | Threads | Social | Free | READY | Post 1/2 + image, then reply 2/2 | Owner | — |
| 3 | LinkedIn (personal) | Social | Free | READY | Post `COPY.md` → LinkedIn | Owner | — |
| 4 | Product Hunt | Launch | Free | BLOCKED — needs account + 1–2 days lead time | Create account, pick launch date, upload gallery from `assets/` | Owner | — |
| 5 | AlternativeTo | Directory | Free | BLOCKED — needs account | Submit as alternative to Petpooja / Posist / Zomato POS | Owner | — |
| 6 | Capterra | Directory | Free | BLOCKED — needs account | Submit listing (category: Restaurant POS / Restaurant Management) | Owner | — |
| 7 | GetApp | Directory | Free | BLOCKED — needs account | Same listing copy as Capterra | Owner | — |
| 8 | SoftwareSuggest | Directory (India) | Free | BLOCKED — needs account | Submit; Indian buyers, best fit | Owner | — |
| 9 | Techjockey | Directory (India) | Free | BLOCKED — needs account | Submit; expect a sales call from them | Owner | — |
| 10 | SaaSHub | Directory | Free | BLOCKED — needs account | 160-char blurb | Owner | — |
| 11 | BetaList | Launch | Free (paid queue optional) | BLOCKED — needs account | Only worth it if launch is framed as "new" | Owner | — |
| 12 | Indie Hackers | Community | Free | BLOCKED — needs account | Post the pricing-model story, not an ad | Owner | — |
| 13 | Hacker News (Show HN) | Community | Free | TODO — one shot, needs a real story | Draft Show HN post first, then pick a weekday morning IST | Owner | — |
| 14 | r/restaurateur | Community | Free | TODO — 7-day account age/karma warm-up first | Answer 3 threads, no links | Owner | — |
| 15 | r/restaurantowners | Community | Free | TODO — same warm-up | Answer threads on POS/QR problems | Owner | — |
| 16 | r/smallbusiness | Community | Free | TODO — same warm-up | Only if a thread is India-relevant | Owner | — |
| 17 | Google Business Profile | Local | Free | BLOCKED — needs owner verification | Set up profile, add `/pricing` link, first post | Owner | — |
| 18 | WhatsApp (own network) | Direct | Free | READY | Send the Hinglish DM to 20 known restaurant owners | Owner | — |
| 19 | Demo follow-up email | Direct | Free | READY | Send within 24h of every demo | Owner | — |
| 20 | Review ask | Proof | Free | TODO — only after a real paying outlet | Ask for a Google review, not a testimonial we write | Owner | — |
| 21 | Backlink kit outreach | SEO | Free | BLOCKED — needs owner sign-off | `docs/BACKLINK-KIT.md` targets | Owner | — |
| 22 | Paid ads | Paid | ₹ | SKIP until a case study exists | — | — | — |
| 23 | Country pricing pages | SEO | — | SKIP (India-only) | — | — | — |

## Asset status

| Asset | Path | Status |
|---|---|---|
| Social card 1080×1350 | `website/assets/social/restaurant-os-1080x1350.png` | DONE |
| Product Hunt gallery ×4 (1270×760) | `promo/assets/ph-gallery-{1..4}.png` | DONE |
| Logo 240×240 | `promo/assets/logo-240.png` | DONE |
| Product Hunt thumbnail 240×240 | `promo/assets/logo-240.png` (same file) | DONE |
| Show HN text | `COPY.md` → Show HN | DONE |
| Demo video / screen recording | — | TODO — highest-value missing asset |
| Real customer photo/quote | — | BLOCKED — needs a paying outlet's permission |

## Weekly KPIs

| Week | Qualified conversations | Demo bookings | Demos done | Trial signups | Paying outlets | Notes |
|---|---|---|---|---|---|---|
| W1 (2026-10-21 → 10-27) | | | | | | |
| W2 | | | | | | |
| W3 | | | | | | |
| W4 | | | | | | |

## Log (append-only)

**2026-10-21**
- Site audit fixes shipped (`24d390a`): removed both "zero ban risk" claims + the FAQ JSON-LD that repeated it; removed the leftover "if that is lower" WhatsApp wording; pricing now states the ₹1 promo fee excludes Meta's conversation charges; deleted the dead placeholder testimonial block.
- Social card generated: `website/assets/social/restaurant-os-1080x1350.png` (real POS screen, ₹1–5/order footer, no unbackable claims).
- Product Hunt gallery generated: 4 frames (POS, tables, analytics with real ₹1,125/9 orders, consent-based promotions). Rejected frames: `admin-dashboard` (₹0 revenue + CANCELLED rows), `analytics-1/2` (₹0), `whatsapp-bot` (pixelated chat list), `orders` (mostly CANCELLED rows), `live-orders`/`table-management` empty states.
- `promo/` workspace created: README (ground rules + ritual + KPIs), this tracker, `COPY.md`, `ASSETS.md`.
- Policy pages live (`/billing-policy`, `/refund-policy`, `/whatsapp-policy`) — these are the links to use when a directory asks for terms/refund URLs.
