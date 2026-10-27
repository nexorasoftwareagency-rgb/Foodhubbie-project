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
| 18 | WhatsApp (own network) | Direct | Free | IN PROGRESS | 16 cold DMs sent 2026-10-22 (daily cap 15 — stop for today). Resume 23/10: `node tools/wa-sales-agent.cjs send --n 5`. Replies: `node tools/wa-sales-agent.cjs check-baileys --min 10` (reads on the paired sales session — no WhatsApp Web QR needed). dm2 auto-due 25/10, dm3 on 29/10. Daily view: `status` | Owner | 536 leads (470 reachable) · 16 contacted · 3 unreachable · 1 duplicate · 0 replies yet |
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
| Demo video 32s | `promo/assets/demo-walkthrough-32s.mp4` + `demo-poster.png` | DONE |
| Real customer photo/quote | — | BLOCKED — needs a paying outlet's permission |

## Weekly KPIs

| Week | Qualified conversations | Demo bookings | Demos done | Trial signups | Paying outlets | Notes |
|---|---|---|---|---|---|---|
| W1 (2026-10-21 → 10-27) | 25 cold DMs sent, 0 replies yet | 0 | 0 | 0 | 0 | DMs went out 22/10 15:38–16:53 IST; day-3 follow-ups due 25/10; daily cap 15 |
| W2 | | | | | | |
| W3 | | | | | | |
| W4 | | | | | | |

## Log (append-only)

**2026-10-22**
- WhatsApp outreach went live on the lead list: 25 cold DMs sent (24 `dm1` + 1 owner-copy broadcast) + 7 unreachable + 1 duplicate. Workbook now holds 536 leads (470 reachable), CRM ids LD001..LD536; all 24 contacted leads carry `attempts=1` + `last contact 22/10/2026`, so the day-3 and day-7 follow-ups arm themselves (25/10, 29/10).
- **Rail fix**: `--n N` checked the daily cap only once, so a staggered batch could overshoot it (today: 25 outbound against a 15 cap). The cap is now re-checked before every additional send and the run stops there. `status` reports cold DMs vs replies-to-inbound separately.
- **New `check-baileys`**: reads replies on the same paired sales session we DM from — no WhatsApp Web QR needed (the `check` command still needs a paired web profile, which does not exist locally). Verified live: the socket receives inbound events (a group `senderKeyDistributionMessage` + a protocol frame + a text-bearing `@newsletter` broadcast + an `@lid` personal contact) and correctly ignores them (group/non-allowlist traffic never touches a lead). One `@lid` personal contact replied with discount questions — correctly ignored as non-allowlist; no lead replies yet at 15:38–16:15 IST; restaurant owners reply later in the day.
- **New `status`**: one-line daily snapshot — outbound vs cap, lead statuses by bucket, what is due (needsHuman / dm2 / dm3 / fresh) and the next three targets. Removes the need to open the spreadsheet to answer "what is due now".
- `promo/TRACKER.md` mojibake repaired (34 lines): em dashes, arrows and rupee signs had been double-encoded by a non-UTF-8 write.

**2026-10-21**
- Site audit fixes shipped (`24d390a`): removed both "zero ban risk" claims + the FAQ JSON-LD that repeated it; removed the leftover "if that is lower" WhatsApp wording; pricing now states the ₹1 promo fee excludes Meta's conversation charges; deleted the dead placeholder testimonial block.
- Social card generated: `website/assets/social/restaurant-os-1080x1350.png` (real POS screen, ₹1–5/order footer, no unbackable claims).
- Product Hunt gallery generated: 4 frames (POS, tables, analytics with real ₹1,125/9 orders, consent-based promotions). Rejected frames: `admin-dashboard` (₹0 revenue + CANCELLED rows), `analytics-1/2` (₹0), `whatsapp-bot` (pixelated chat list), `orders` (mostly CANCELLED rows), `live-orders`/`table-management` empty states.
- `promo/` workspace created: README (ground rules + ritual + KPIs), this tracker, `COPY.md`, `ASSETS.md`.
- Policy pages live (`/billing-policy`, `/refund-policy`, `/whatsapp-policy`) — these are the links to use when a directory asks for terms/refund URLs.

## 2026-10-21 (session 3, cont.)
- Demo walkthrough video produced: `promo/assets/demo-walkthrough-32s.mp4` + poster (real 2m16s admin recording trimmed to 32s, owner email masked).
- 6 site screenshots replaced with real-data captures (dashboard / KDS / tables / orders / 7D analytics, email masked); deployed + verified live.
- Next: Product Hunt draft using PH gallery 1–4 + demo video; launch checklist in docs/PLAN-PROMOTE-SAAS.md.
- Demo video embedded on homepage (hero flow, click-to-play, poster 200/1002KB total); deployed + verified playing on live site (`a1e8d10`).
- Remaining launch actions are owner-gated (accounts, posts, warm-up) — see channel table.
- gmaps lead-scrape pipeline added: `tools/gmaps-lead-scraper.cjs` (Node/Playwright, no new deps; geo-narrow query + pacing; deep mode pulls phone/website/address). Output in `promo/leads/` (gitignored — real business contacts). Proof: 19 real Ahmedabad venues scraped + phones.
- Rule of use: founder-sent individual WhatsApp/calls only, never the bot/promo transport (consent-only ground rule).
- Lead workbook created: `Restaurant Lead Data/restaurant-leads.xlsx` (READ ME + 29-col Leads tracker w/ dropdowns + Pitch Kit DM scripts). 19 scraped Ahmadabad leads prefilled (status New). Regenerate after new scrapes via `python tools/build-lead-workbook.py`. Folder gitignored (business contacts).
- WhatsApp sales agent built (`tools/wa-sales-agent.cjs` + `tools/wa-lead-io.py`): two engines — Baileys (send, session persists in `.wa-sales-auth`, gitignored) + WA Web Playwright (read replies / send fallback). CRM ids LD001..LD064 assigned in workbook. Rails: allowlist-only, 1 DM default (--n staggered), daily cap 15, composing 4-9s + 2-5 min stagger, opt-out freeze, FAQ auto-answer (else needsHuman), every run writes wa-log.csv + updates workbook then closes. Fresh data batch: 64 leads / 52 phones across 5 areas; AE pitch-kit mojibake fixed.
