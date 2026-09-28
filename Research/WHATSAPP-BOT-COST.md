# WhatsApp Agent: Bot Cost vs Without-Bot Cost (Blaze pay-as-you-go)

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Basis:** measured DB counters + EC2 PM2 inventory + Meta India rate card (Sep 2026)

> Research only — no codebase changes. Re-run: `node Research\scripts\cost-calc.js` (bot matrix prints at the end) · `--fixed` = images externalized · `--mktg=N` = promo msgs/day/order.

---

## 1. What the WhatsApp Agent actually costs — 3 components

| # | Component | With bot | Without bot | Evidence |
|---|---|---|---|---|
| 1 | **EC2 server** | t3.small $15 / t3.large $61 / t3.xlarge $122 (sized by outlet count) | **$0** — box terminates | ACCESS.md PM2 list: EC2 runs **only** the WhatsApp stack — `bot-*` workers (155 MB/outlet), `webhook-server` :5000, `bot-control-api` :4000, Redis, tunnel. Nothing else lives there (Admin/menu/rider = Firebase Hosting) |
| 2 | **Firebase RTDB (bot listeners)** | **+0.5 GB/mo/outlet** (est — bot holds order/session listeners + writes usage/chat/message nodes) | $0 | P3-9: `whatsapp/usage` counters exist (8 days), `chats/` currently absent, `bot/` node 8 KB |
| 3 | **Meta WhatsApp API fees** | per-message, India rate card (§2) | **$0** | measured: 132 Meta sends over 8 active days, peak 46/day (test outlet) |

Menu scans / Admin / Rider Firebase traffic is the same in both scenarios (rider app + customer menu are independent of the bot).

---

## 2. Meta WhatsApp India rate card (Sep 2026) — what changes in 4 days

| Type | India rate | Notes |
|---|---|---|
| Utility (order confirmations, status) | **₹0.115/msg** | in-window free **until Oct 1 2026** |
| Authentication (OTP) | ₹0.115/msg | same rate as utility |
| Service (replies in 24-hr window) | ₹0.115/msg | **free until Oct 1 2026**; first 1,000/mo/WABA free (≈ per outlet number) |
| Marketing (promos/campaigns) | **₹0.86/msg** | never free |

⚠️ **Oct 1, 2026 (4 days): Meta starts billing service messages + in-window utility** — the free-ride era ends. Rates converge at utility ₹0.115 for service; marketing stays ₹0.86. (Sources: dragapp rate card eff. Jul 1 2026, whautomate, saysimple, go4whatsup.)

### 2a. VERIFIED: "customer messaged first → free within 24-hr window" (Sep 27, 2026)

Claim: *Meta does not charge when the customer messages first and the bot replies inside the 24-hour window.*

| Period | Verdict | What's free | What's billed |
|---|---|---|---|
| **Now → Sep 30, 2026** | ✅ **TRUE** — replies cost ₹0 | All service replies in-window (free since Nov 1 2024) **and** utility templates sent in-window (free since Jul 1 2025), unlimited, per 24-hr window opened by the customer | Marketing templates; utility templates outside the window; inbound customer messages are always free anyway |
| **From Oct 1, 2026** | ⚠️ **CHANGES** — replies become billed | First **1,000 service msgs/mo per business phone number** (≈ per outlet WABA, resets monthly); inbound customer msgs always free; **CTWA/ad entry points keep a free 72-hr window** (any message type) | Service replies after the 1,000 free → **₹0.115/msg (India, utility-equivalent)**; in-window utility templates also become billable again; auth always billed; marketing ₹0.86 |

- So the claim is **true for 4 more days**, then holds only up to the free quota (1,000/number/mo ≈ 33 msgs/day/outlet — covers the customer-first bot at low order volumes; over quota = ₹0.115).
- Proactive/biz-first templates (bot messages first, outside any window) were **never** free — always utility ₹0.115.
- Sources (multi-sourced Sep 2026): Twilio help notice (Sep 17 2026), yCloud (Sep 4 2026), Wati, sendiee (India: "₹0.115 each in India after the first 1,000 free replies per phone number"), myoperator (India service rate free → chargeable Oct 1 at utility rate), saysimple, wawcd.
- C1 in the model = this regime (customer-first till Sep 30: Meta = promos only); C2 = from Oct 1 (service after free quota @ ₹0.115).

**Baileys mode (QR-linked number): Meta fee = ₹0** — no Cloud API involved, no conversation billing. That's the bot's `transport.js` alternative (`getTransportMode`); trade-off = unofficial (ban risk), so production cost planning uses Meta rates.

---

## 3. Cost model assumptions (labeled)

- **Msgs/outlet/day = 4 × orders/day** (lifecycle + chat replies) — calibrated on measured 132 sends/8 days vs test-outlet order volume.
- **Marketing = 0.1 × orders/day** (`--mktg=` to change; each +100 promo msgs/day/outlet = +$29/mo at 1 outlet's scale, ×30 days × ₹0.86).
- Free service tier: first 1,000 msgs/mo **per outlet WABA** deducted before billing.
- ₹88/$ · server tiers as §6 · bot Firebase +0.5 GB/mo/outlet (estimate — re-measure after 2 months of real usage).

---

## 4. The matrix — WITHOUT bot vs WITH bot (current code, images in RTDB)

**WITHOUT bot** = Firebase only (server $0, Meta $0). **WITH bot** = Firebase(+bot) + EC2 + Meta.

| orders/day | rest | WITHOUT bot | WITH bot total | **BOT COST** (delta) | $/rest with bot |
|---|---|---|---|---|---|
| 10 | 10 | **$16/mo** | $42 | **$26** | $4.20 |
| 10 | 50 | **$125/mo** | $238 | **$113** | $4.76 |
| 10 | 100 | **$261/mo** | $488 | **$227** | $4.88 |
| 50 | 10 | **$30/mo** | $130 | **$100** | $12.98 |
| 50 | 50 | **$194/mo** | $680 | **$486** | $13.60 |
| 50 | 100 | **$400/mo** | $1,372 | **$972** | $13.72 |
| 100 | 10 | **$47/mo** | $240 | **$193** | $24.03 |
| 100 | 50 | **$281/mo** | $1,233 | **$951** | $24.65 |
| 100 | 100 | **$575/mo** | **$2,477** | **$1,902** | $24.77 |

*WITHOUT-bot column = the NO-BOT RUN SHEET (§4b): Firebase RTDB + Hosting only; server $0, Meta $0, Auth/Functions/Storage $0. With images externalized (`--fixed`): without-bot $13–316; bot delta unchanged.*

### Where the bot money goes (100 orders × 100 rest, worst cell)

```
Meta API   $1,731/mo  (70%)  ← the bot's real cost
Firebase     $625/mo  (25%)
EC2 server   $122/mo  ( 5%)
                      $2,477 total  vs $575 without bot
```

---

## 4b. NO-BOT RUN SHEET — remove bots completely, everything else itemized

**"Customer messages first to order via bot"** — that channel disappears with the bot. Everything else (QR menu ordering, cart, table sessions, KDS, orders, riders, POS, promos, analytics, admin, rules) runs **serverlessly on Firebase Hosting + RTDB** — all functions keep working, orders just come only from QR/POS.

| Line item | 10 rest | 50 rest | 100 rest (at 10/50/100 orders per rest) |
|---|---|---|---|
| **EC2 server** | **$0** | **$0** | **$0** — box exists only for bots |
| **Meta WhatsApp API** | **$0** | **$0** | **$0** |
| **Firebase RTDB** (menu+admin+rider+orders+KDS) | $16–47 | $125–281 | $253–575 |
| **Firebase Hosting** (menu shell 388 KB/scan + dashboards) | $0–1 | $3–12 | $8–26 |
| **Auth / Cloud Functions / Storage-at-rest / Analytics** | **$0** | **$0** | **$0** — email/password auth free, 0 Functions, images still base64 in RTDB, Analytics free |
| **TOTAL $/mo** | **$16–47** | **$125–281** | **$261–575** |
| **$/restaurant/month** | **$1.63–4.70** | **$2.49–5.63** | **$2.61–5.75** |

*(ranges = 10→100 orders/day per restaurant, current code. **Images in Firebase Storage instead** (`--fixed`): $13–18 / $110–150 / $232–316 — see `FIREBASE-STORAGE-USAGE.md`. Full grid: `node Research\scripts\cost-calc.js` → NO-BOT RUN SHEET.)*

**No-bot totals are exactly the WITH-bot Firebase column minus bot listeners** — i.e. removing the bot saves server + Meta + a hair of RTDB, never the menu/admin/rider traffic.

---

## 5. Verdict — Bot cost vs Without-bot cost

| Question | Answer |
|---|---|
| Does WhatsApp **not being activated** save money? | **Yes — the entire bot delta ($26–1,902/mo).** Server → $0 (EC2 exists only for the bot), Meta → $0, bot listeners → $0 |
| Biggest cost driver? | **Meta per-message fees ≈ 70% of the with-bot bill** at busy volumes — not Firebase, not the server |
| Is Firebase affected by the bot? | Marginally (+0.5 GB/outlet ≈ +$5/10 rest); menu/admin/rider traffic is identical with or without |
| Cheapest way to run the bot? | **Baileys (QR) mode = ₹0 Meta fees** → with-bot total ≈ Firebase+server only (e.g. 100×100: $746 vs $2,477) — unofficial, ban risk, fine for pilots |
| Cheapest compliant way? | Meta Cloud API + keep replies inside the 24-hr window + service volume ≤1,000/mo/outlet + marketing only when campaigns run (`--mktg=0` → Meta ≈ $0.115-basis utility only) |
| 10-rest pilot, 10 orders/day | without bot **$16/mo** · with bot (Meta) **$42/mo** · with bot (Baileys) **~$36/mo** |

**One sentence:** switching the WhatsApp agent OFF cuts the bill **61% at small scale and 77% at 100 busy restaurants** ($2,477 → $575/mo), and when it's ON the Meta message fees — not Firebase, not the server — are the bill.

---

*Model: `node Research\scripts\cost-calc.js [--fixed] [--mktg=N]`. Measurements: P3-9 (`whatsapp/usage` counters, PM2 inventory in ACCESS.md). Rates: Meta India rate card Sep 2026 (see §2 sources); ₹88/$.*
