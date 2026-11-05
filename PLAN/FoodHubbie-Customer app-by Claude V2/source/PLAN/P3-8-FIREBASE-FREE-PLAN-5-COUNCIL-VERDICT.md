# P3-8 — Firebase Free Plan Capability Analysis → 5-Council Verdict

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Plan:** Spark (free, no billing enabled)

---

## Part 1 — The Evidence Base

### 1.1 Our infrastructure (measured, live DB)

| Metric | Measured value |
|---|---|
| Total RTDB size | **4.81 MB** / 37,734 nodes |
| Businesses / real outlets | 7 / 2 active (pizza, cake) |
| Orders (all time, test period) | 121 over 34 active days — **avg 3.6/day, peak 25/day** |
| Order record size | ~687 bytes |
| QR menu initial payload | **730 KB** (categories 73 KB + dishes **657 KB**) |
| Dish image storage | **base64 inlined in RTDB** — 22/22 dishes, avg **30.5 KB each** |
| Admin tab initial payload | ~731 KB + orders query (limitToLast 500) |
| `logs/` node | 811 KB / **25,172 nodes = 67% of all nodes** (audit alone: 3,817 entries) |
| Cloud Functions used | **0** (bot runs on EC2, webhook-server separate) → Functions quota irrelevant |
| Phone Auth used | **0** (email/password only) → phone-auth quota irrelevant |
| Admin listeners | ~30 `onValue` per dashboard session (orders, tables, sessions, KDS, catalog, inventory, riders, promos…) |

### 1.2 Spark plan hard limits (firebase.google.com/pricing, 2026)

| Resource | Spark limit | Consequence of exceeding |
|---|---|---|
| RTDB storage | **1 GB** | **Database disabled** |
| RTDB download | **10 GB/month** | Database disabled |
| RTDB simultaneous connections | **100** | Connections rejected |
| Hosting bandwidth | **360 MB/day** (~10.9 GB/mo) | Site stops serving |
| Hosting storage | 10 GB | Deploy fails |
| Cloud Functions | not available | n/a (we use none) |

Spark = hard cut-off, **not** overage billing. One limit breached → ERP goes dark for everyone.

### 1.3 Real-world restaurant volumes (researched)

| Source | Finding |
|---|---|
| Pizza market report 2026 | Chain pizza store: **160+ orders/day/unit**; delivery+takeaway = 71% of US pizza transactions |
| Restolabs 4M-order dataset 2026 | AOV $38.96; 60.1% pickup+dine-in; peak Fri 5:30–8:30 PM; 2,126 locations → **~52 orders/location/day** platform average |
| Gitnux 2026 | 57% adults dine out weekly; table turn 45 min; 65% seat occupancy at peak |
| US Foods 2023 | 4.5 delivery/takeaway orders per customer/month |

**Model restaurant:** quiet independent = 30–50 orders/day · busy independent = 100/day · chain unit = 160+/day. Peak-hour concurrency: 10–30 open customer menu tabs + admin + KDS tablet + riders.

---

## Part 2 — Quota Math (the numbers that decide)

### Per busy restaurant, per month (current code)

```
Menu loads:  150 scans/day × 730 KB  = 110 MB/day  = 3.3 GB/month   ← ONE restaurant
Admin/KDS:   ~500 KB deltas/day      =  15 MB/day  = 0.45 GB/month
Riders:      3 apps × 20 MB/day      =  60 MB/day  = 1.8 GB/month
────────────────────────────────────────────────────────────────────
Total ≈ 5.5 GB/month per BUSY restaurant   (10 GB budget shared by ALL)

Connections during Friday peak (one restaurant):
  20 customer menu tabs + 2 admin + 1 KDS + 3 riders + bot + webhook ≈ 27
```

### Scaling wall — what breaks first, at how many restaurants

| # | Limit | Breaks at (current code) | Breaks at (images externalized) |
|---|---|---|---|
| 1 | **100 connections** | **~3 busy restaurants** | same (unchanged by image fix) |
| 2 | **10 GB/month download** | **~2 restaurants** | ~25–30 restaurants |
| 3 | **1 GB storage** | hundreds (months of orders accumulate: 100 rest × 3K orders/mo × 687 B = 210 MB/mo → full in ~5 months) | worse without images, same trajectory |
| 4 | **Hosting 360 MB/day** | ~2,000 QR scans/day total | same |

**Headline: at 100s of restaurants, Spark dies at single-digit restaurant count — the connection cap alone (100) is hit by ~3 simultaneously-busy restaurants, and there is no mitigation inside the free plan.**

---

## Part 3 — 5-Council Verdict

### 🏛️ Council 1 — Infrastructure & Quotas
**Vote: ❌ NOT VIABLE on Spark beyond pilot**

The arithmetic is unforgiving. Two independent walls — 100 simultaneous connections and 10 GB/month download — are hit at 2–3 busy restaurants with zero mitigation available on Spark. This isn't "we might get throttled": exceeding a Spark RTDB limit **disables the database**. A disabled RTDB = no orders, no KDS, no billing, for every tenant at once. Cloud Functions and Phone Auth quotas are irrelevant (we use neither). Hosting's 360 MB/day is the least of our problems but also dies at ~2,000 scans/day.
*First limit to fail: connections, at ~3 concurrent busy restaurants.*

### 🍽️ Council 2 — Restaurant Operations
**Vote: ⚠️ VOLUME REALITY is 10–40× our test load**

Our measured 3.6 orders/day is a test artifact — real units do 50–160/day (Restolabs avg 52/location/day; chain pizza 160+/day). Friday 5:30–8:30 PM peak means 10–30 simultaneous menu tabs *per restaurant* — each an RTDB connection held open for the whole visit (our menu app keeps listeners alive for order tracking). Operations say the free plan fails exactly when restaurants make money: peak hours. Weekday-morning averages are irrelevant; quota math is done against the peak.
*Operational verdict: plan sized for a demo, not for a dinner rush — let alone hundreds of rushes.*

### 🏗️ Council 3 — Product & Architecture
**Vote: ⚠️ 4 code-level fixes buy ~10× headroom (do regardless of plan)**

Findings, ranked by quota impact:
1. **Base64 images in RTDB (worst offender):** 657 KB of our 730 KB menu payload is inline JPEG data — every scan re-downloads every dish image, uncached, from the quota-billed RTDB. Move to Firebase Storage (or Hosting assets) with URLs → menu payload 730 KB → **~75 KB** (10× bandwidth saving). *Storage is also 10× cheaper on this axis.*
2. **`logs/` = 67% of all nodes** and grows unbounded (audit: 3,817 entries). Prune/archive to EC2 or cold storage monthly — storage limit is a time bomb at scale, node count also slows console/queries.
3. **~30 `onValue` listeners per admin tab** — each open dashboard re-broadcasts every write. Fine at 3 tabs; 100 restaurants × 3 tabs = 300 listeners on 100-connection budget. Nothing to fix pre-Blaze, but audit before scale.
4. **Orders query limitToLast(500)** initial payload grows linearly with history — paginate or date-gate (already partially done).
*These fixes are plan-independent hygiene. They move the bandwidth wall from ~2 → ~25 restaurants, but cannot move the connection wall.*

### 🔐 Council 4 — Security & Rules
**Vote: ⚠️ RULES ARE SOUND; ANONYMOUS READS ARE A QUOTA SURFACE**

Post-10-agent-audit rules are tight (PII gated, disabled-outlet gates, auth-bound writes). But: the QR menu is **anonymous by design** — anyone with a QR URL holds an RTDB connection and pulls 730 KB, unauthenticated, billed against our quota. There is no App Check enforcement on the menu app, so a shared/leaked URL or a link-scanner bot burns bandwidth we pay for (in quota terms: we can't afford to be scanned). App Check + image externalization + rate-limiting rules (`.validate` on session creation frequency) are the pre-scale hardening steps.
*Security doesn't block the plan decision; it amplifies quota risk from outside.*

### 📈 Council 5 — Business & Growth ("100s of restaurants joined")
**Vote: 🟢 VIABLE ON BLAZE — and Blaze is cheap insurance**

The right question isn't "can free support 100s?" (No: ~3 restaurants, hard stop). It's "what does the paid plan cost at 100s?" Rough Blaze math at 100 busy restaurants *with* image externalization:

| Item | Free allowance | Est. usage @100 rest | Blaze cost |
|---|---|---|---|
| RTDB download | 10 GB/mo | 60–100 GB/mo | $50–90/mo |
| RTDB storage | 1 GB | 0.5–1 GB | $0–5/mo |
| Hosting bandwidth | ~10.9 GB/mo | ~30 GB/mo | ~$3/mo |
| Connections | 100 | ~1,000–3,000 | included (200K cap) |
| **Total** | | | **~$60–100/month** |

Blaze keeps the free allowances and removes every wall. At 100 restaurants that's **<$1/restaurant/month** — the cost of one rejected order. Even *without* the image fix, Blaze at 100 restaurants ≈ $300–500/mo, still viable; the fix just makes margins and latency better.

---

## ⚖️ COMBINED VERDICT

| Question | Answer |
|---|---|
| Can Spark run a **single-restaurant pilot**? | **YES** — we're at 4.81 MB / ~15 connections; comfortable |
| Can Spark run **5–10 restaurants**? | **NO** — dies at ~3 (connections) |
| Can Spark run **100s of restaurants**? | **ABSOLUTELY NOT** — 10–30× over on every axis |
| Should we enable **Blaze now**? | **YES** — free allowances stay, hard caps vanish; enable *before* onboarding restaurant #4, with budget alerts at $10/$50/$100 |
| Must-fix code items (plan-independent) | ① externalize dish images out of RTDB — ❌ won't do (user: free plan, 2026-09-28) ② monthly `logs/` pruning — ✅ DONE (30d auto-prune, `ad541aa`, P3-9) ③ App Check on menu app — ❌ won't do (user: 2026-09-28 — DB-wide enforcement re-adds reCAPTCHA weight to admin + console setup) ④ paginate orders query — ✅ DONE (tables listener bounded, orders already date-gated+paged, P3-10) |

**One-sentence verdict:** Free plan is a demo-grade sandbox that fails at ~3 busy restaurants; the product is fully viable for 100s of restaurants on Blaze at ~$60–100/month — upgrade before scaling, and ship the image-externalization fix regardless.

---

*Measured via `bot/p38-measure.js` and `bot/p38-payload.js` (re-runnable). Sources: firebase.google.com/pricing + /docs/database/usage/limits (2026), Restolabs 2026 Online Ordering Behaviour Report (4M orders / 2,126 locations), Pizza Restaurants Market 2026, Gitnux Restaurant Statistics 2026, US Foods Diner Dispatch 2023.*
