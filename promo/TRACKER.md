# Promotion Tracker

Status as of **2026-10-21**. Update the row, then append a line to the log.

## Channels

| # | Channel | Type | Cost | Status | Next action | Owner | Result |
|---|---|---|---|---|---|---|---|
| 1 | X (Twitter) | Social | Free | READY | Post `COPY.md` â†’ X #1 with `assets/restaurant-os-1080x1350.png` (or `website/assets/social/restaurant-os-1080x1350.png`) | Owner | â€” |
| 2 | Threads | Social | Free | READY | Post 1/2 + image, then reply 2/2 | Owner | â€” |
| 3 | LinkedIn (personal) | Social | Free | READY | Post `COPY.md` â†’ LinkedIn | Owner | â€” |
| 4 | Product Hunt | Launch | Free | BLOCKED â€” needs account + 1â€“2 days lead time | Create account, pick launch date, upload gallery from `assets/` | Owner | â€” |
| 5 | AlternativeTo | Directory | Free | BLOCKED â€” needs account | Submit as alternative to Petpooja / Posist / Zomato POS | Owner | â€” |
| 6 | Capterra | Directory | Free | BLOCKED â€” needs account | Submit listing (category: Restaurant POS / Restaurant Management) | Owner | â€” |
| 7 | GetApp | Directory | Free | BLOCKED â€” needs account | Same listing copy as Capterra | Owner | â€” |
| 8 | SoftwareSuggest | Directory (India) | Free | BLOCKED â€” needs account | Submit; Indian buyers, best fit | Owner | â€” |
| 9 | Techjockey | Directory (India) | Free | BLOCKED â€” needs account | Submit; expect a sales call from them | Owner | â€” |
| 10 | SaaSHub | Directory | Free | BLOCKED â€” needs account | 160-char blurb | Owner | â€” |
| 11 | BetaList | Launch | Free (paid queue optional) | BLOCKED â€” needs account | Only worth it if launch is framed as "new" | Owner | â€” |
| 12 | Indie Hackers | Community | Free | BLOCKED â€” needs account | Post the pricing-model story, not an ad | Owner | â€” |
| 13 | Hacker News (Show HN) | Community | Free | TODO â€” one shot, needs a real story | Draft Show HN post first, then pick a weekday morning IST | Owner | â€” |
| 14 | r/restaurateur | Community | Free | TODO â€” 7-day account age/karma warm-up first | Answer 3 threads, no links | Owner | â€” |
| 15 | r/restaurantowners | Community | Free | TODO â€” same warm-up | Answer threads on POS/QR problems | Owner | â€” |
| 16 | r/smallbusiness | Community | Free | TODO â€” same warm-up | Only if a thread is India-relevant | Owner | â€” |
| 17 | Google Business Profile | Local | Free | BLOCKED â€” needs owner verification | Set up profile, add `/pricing` link, first post | Owner | â€” |
| 18 | WhatsApp (own network) | Direct | Free | READY | Send the Hinglish DM to 20 known restaurant owners | Owner | â€” |
| 19 | Demo follow-up email | Direct | Free | READY | Send within 24h of every demo | Owner | â€” |
| 20 | Review ask | Proof | Free | TODO â€” only after a real paying outlet | Ask for a Google review, not a testimonial we write | Owner | â€” |
| 21 | Backlink kit outreach | SEO | Free | BLOCKED â€” needs owner sign-off | `docs/BACKLINK-KIT.md` targets | Owner | â€” |
| 22 | Paid ads | Paid | â‚¹ | SKIP until a case study exists | â€” | â€” | â€” |
| 23 | Country pricing pages | SEO | â€” | SKIP (India-only) | â€” | â€” | â€” |

## Asset status

| Asset | Path | Status |
|---|---|---|
| Social card 1080Ã—1350 | `website/assets/social/restaurant-os-1080x1350.png` | DONE |
| Product Hunt gallery Ã—4 (1270Ã—760) | `promo/assets/ph-gallery-{1..4}.png` | DONE |
| Logo 240Ã—240 | `promo/assets/logo-240.png` | DONE |
| Product Hunt thumbnail 240Ã—240 | `promo/assets/logo-240.png` (same file) | DONE |
| Show HN text | `COPY.md` â†’ Show HN | DONE |
| Demo video / screen recording | â€” | TODO â€” highest-value missing asset |
| Real customer photo/quote | â€” | BLOCKED â€” needs a paying outlet's permission |

## Weekly KPIs

| Week | Qualified conversations | Demo bookings | Demos done | Trial signups | Paying outlets | Notes |
|---|---|---|---|---|---|---|
| W1 (2026-10-21 â†’ 10-27) | | | | | | |
| W2 | | | | | | |
| W3 | | | | | | |
| W4 | | | | | | |

## Log (append-only)

**2026-10-21**
- Site audit fixes shipped (`24d390a`): removed both "zero ban risk" claims + the FAQ JSON-LD that repeated it; removed the leftover "if that is lower" WhatsApp wording; pricing now states the â‚¹1 promo fee excludes Meta's conversation charges; deleted the dead placeholder testimonial block.
- Social card generated: `website/assets/social/restaurant-os-1080x1350.png` (real POS screen, â‚¹1â€“5/order footer, no unbackable claims).
- Product Hunt gallery generated: 4 frames (POS, tables, analytics with real â‚¹1,125/9 orders, consent-based promotions). Rejected frames: `admin-dashboard` (â‚¹0 revenue + CANCELLED rows), `analytics-1/2` (â‚¹0), `whatsapp-bot` (pixelated chat list), `orders` (mostly CANCELLED rows), `live-orders`/`table-management` empty states.
- `promo/` workspace created: README (ground rules + ritual + KPIs), this tracker, `COPY.md`, `ASSETS.md`.
- Policy pages live (`/billing-policy`, `/refund-policy`, `/whatsapp-policy`) â€” these are the links to use when a directory asks for terms/refund URLs.

## 2026-10-21 (session 3, cont.)
- Demo walkthrough video produced: `promo/assets/demo-walkthrough-32s.mp4` + poster (real 2m16s admin recording trimmed to 32s, owner email masked).
- 6 site screenshots replaced with real-data captures (dashboard / KDS / tables / orders / 7D analytics, email masked); deployed + verified live.
- Next: Product Hunt draft using PH gallery 1–4 + demo video; launch checklist in docs/PLAN-PROMOTE-SAAS.md.
