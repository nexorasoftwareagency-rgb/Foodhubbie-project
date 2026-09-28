# Per-Restaurant Cost on Firebase Blaze

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Basis:** P3-8 measurements (live DB) + firebase.google.com/pricing 2026

> Research only — no codebase changes. Recompute anytime: `node Research/scripts/cost-calc.js`

---

## 1. Pricing table used (Blaze, us-central1)

| Resource | Free allowance (kept on Blaze) | Paid rate |
|---|---|---|
| RTDB download | 10 GB/month (360 MB/day) | **$1/GB** |
| RTDB storage | 1 GB | **$5/GB-month** |
| RTDB connections | — | included (200K/database) |
| Hosting transfer | ~10.9 GB/mo (360 MB/day) | $0.15/GB |
| Hosting storage | 10 GB | $0.026/GB |
| Storage download (legacy bucket) | 1 GB/day (~30 GB/mo) | $0.12/GB |
| Storage stored | 5 GB | $0.026/GB |

---

## 2. Usage model per restaurant (from P3-8)

Measured facts: menu payload **730 KB/scan** (657 KB base64 images) today; order record **687 B**; admin/KDS deltas ~500 KB/day; riders ~20 MB/day/app.

Assumption tiers: **quiet** 40 orders/day & 60 scans/day · **busy** 100 orders/day & 150 scans/day (P3-8 model restaurant).

### Two scenarios

**A. Current code (images in RTDB)** — per busy restaurant/month:
```
Menu:   150 scans × 730 KB × 30d = 3.3 GB
Admin:  0.5 GB/mo   ·  Riders: 1.8 GB/mo   →  ≈ 5.5 GB/mo RTDB download
```

**B. After image externalization (P3-8 must-fix #1)** — per busy restaurant/month:
```
Menu:   150 scans × 75 KB × 30d  = 0.34 GB
Admin:  0.5 GB/mo   ·  Riders: 1.8 GB/mo   →  ≈ 2.6 GB/mo RTDB download
(+ images move to Storage: 3.3 GB/mo egress → FREE under 1 GB/day legacy cap)
```

---

## 3. The math — what one restaurant costs

Because free allowances (10 GB RTDB, ~30 GB Storage egress) are **project-wide shared pools**, the marginal cost depends on total restaurant count:

| Restaurants (busy) | RTDB download needed | Billable RTDB GB | Cost/mo (current code) | Cost/mo (images externalized) |
|---|---|---|---|---|
| 1 | 5.6 GB | 0 GB | **$0** (inside free 10 GB) | **$0** |
| 3 | 16.7 GB | 6.75 GB | **$6.75** | **$0** |
| 5 | 27.9 GB | 17.9 GB | **$17.93** | **$3.19** |
| 10 | 55.9 GB | 45.9 GB | **$46.99** | **$17.86** |
| 50 | 279 GB | 269 GB | **$281.49** | **$150.23** |
| 100 | 559 GB | 549 GB | **$574.62** | **$315.69** |

Storage egress after fix: stays under legacy 1 GB/day free until ~30 busy restaurants, then $0.12/GB (≈$0.40/rest). Costs above include Hosting transfer (menu shell 388 KB/scan) — $0.13–$26/mo.

**Storage (bytes at rest):** 100 rest × 3K orders/mo × 687 B ≈ 210 MB/mo → **$0/mo for years** under the 1 GB free (beyond: $5/GB-mo — prune `logs/` as P3-8 #2 says: it's 67% of all nodes).

**Hosting:** menu shell 388 KB/scan + staff dashboards → free ≤10.9 GB/mo (~10 rest), then $0.15/GB — up to **$26/mo at 100 busy restaurants**.

---

## 4. Headline numbers

| Scale | Current code | Images externalized |
|---|---|---|
| **1 restaurant** | **$0/mo** (free allowances cover it) | **$0/mo** |
| **3 restaurants** | **$6.75/mo** — *first real bill appears here* | **$0/mo** |
| **10 restaurants** | **$46.99/mo** ≈ **$4.70/rest** | **$17.86/mo** ≈ **$1.79/rest** |
| **100 restaurants** | **$574.62/mo** ≈ **$5.75/rest** | **$315.69/mo** ≈ **$3.16/rest** |
| P3-8 council estimate @100 (range) | — | $60–100/mo (their assumption: leaner deltas) |

**Blaze subscription: ₹0.** There is no monthly plan fee — the ₹1,000 UPI prepayment is prepaid balance, not a charge. You pay only measured usage above free tiers.

**One-sentence answer:** one quiet restaurant costs **$0/mo**, a busy one **$1.79–5.75/mo** depending on the image fix; upgrade is free, and the first real bill ($6.75) appears only at ~3 restaurants once 10 GB of monthly RTDB download is shared across all of them.

---

## 5. Cost levers (ranked by impact)

1. **Externalize images out of RTDB** — halves download cost + 10× payload cut (P3-8 must-fix #1).
2. **Prune `logs/` monthly** — 67% of nodes; keeps RTDB storage at/near free 1 GB ($5/GB is the steepest rate on the sheet).
3. **Budget alerts $10/$50/$100** — alerts only, do not cap; pair with `.validate` rate rules on anonymous session creation.
4. **App Check on menu** — stops leaked-URL scanners burning paid bandwidth (anonymous QR reads are billed to us).

---

## 6. Full cost matrix — orders/day × restaurants (incl. EC2 server)

**Model:** orders/day per restaurant {10, 50, 100} × restaurant count {10, 50, 100} · scans/day = 1.5 × orders (P3-8 calibration) · server sized by restaurant count (P3-8 SSM measurement: t3.small 2 GB caps at ~10 outlets) · USD on-demand us-east-1 · ₹ ≈ 88/USD (approx).

**Server tiers:** 10 rest → **t3.small $15/mo** · 50 rest → **t3.large $61/mo** · 100 rest → **t3.xlarge $122/mo** (runs bots + webhook-server on one box).

### 6a. Current code (images in RTDB)

| orders/day | restaurants | Server | Firebase (RTDB+Hosting) | **TOTAL $/mo** | **$/restaurant** |
|---|---|---|---|---|---|
| 10 | 10 | t3.small $15 | $16.28 | **$31.48** | **$3.15** |
| 10 | 50 | t3.large $61 | $124.55 | **$185.25** | **$3.71** |
| 10 | 100 | t3.xlarge $122 | $260.74 | **$382.24** | **$3.82** |
| 50 | 10 | t3.small $15 | $29.55 | **$44.75** | **$4.48** |
| 50 | 50 | t3.large $61 | $194.30 | **$255.00** | **$5.10** |
| 50 | 100 | t3.xlarge $122 | $400.24 | **$521.74** | **$5.22** |
| 100 | 10 | t3.small $15 | $46.99 | **$62.19** | **$6.22** |
| 100 | 50 | t3.large $61 | $281.49 | **$342.19** | **$6.84** |
| 100 | 100 | t3.xlarge $122 | $574.62 | **$696.12** | **$6.96** |

### 6b. After image externalization (P3-8 fix #1)

| orders/day | restaurants | Server | Firebase (RTDB+Hosting) | **TOTAL $/mo** | **$/restaurant** |
|---|---|---|---|---|---|
| 10 | 10 | t3.small $15 | $13.34 | **$28.54** | **$2.85** |
| 10 | 50 | t3.large $61 | $109.82 | **$170.52** | **$3.41** |
| 10 | 100 | t3.xlarge $122 | $231.61 | **$353.11** | **$3.53** |
| 50 | 10 | t3.small $15 | $14.81 | **$30.02** | **$3.00** |
| 50 | 50 | t3.large $61 | $126.87 | **$187.57** | **$3.75** |
| 50 | 100 | t3.xlarge $122 | $268.98 | **$390.48** | **$3.90** |
| 100 | 10 | t3.small $15 | $17.86 | **$33.06** | **$3.31** |
| 100 | 50 | t3.large $61 | $150.23 | **$210.93** | **$4.22** |
| 100 | 100 | t3.xlarge $122 | $315.69 | **$437.19** | **$4.37** |

### Reading the matrix

- **Your total cost to run N restaurants** = Firebase + one EC2 box: **$28–696/month** across every cell — worst case (100 busy restaurants, current code) **$696/mo ≈ ₹61k/mo ≈ $6.96/rest**.
- **Image fix saves ~$30–260/mo** at scale (halves Firebase) — same server bill.
- **Server is flat per tier**, not per restaurant: it's the smaller half of the bill until ~10 restaurants.
- At 10 orders/day the Firebase bill stays near the free 10 GB floor; the server dominates.
- Savings not modeled: EC2 1-yr reserved/Compute SP = **~37% off server** (t3.large $61 → $39/mo); t3a (AMD) ~7% cheaper.

---

*Re-runnable model: `node Research/scripts/cost-calc.js [--fixed]`. Inputs trace to PLAN/P3-8-FIREBASE-FREE-PLAN-5-COUNCIL-VERDICT.md; EC2 on-demand rates: aws.amazon.com/ec2/pricing + holori/vantage (Sep 2026).*
