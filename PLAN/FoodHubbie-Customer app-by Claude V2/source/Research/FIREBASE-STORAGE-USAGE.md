# Firebase Cloud Storage — Usage & Cost on Blaze

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Sources:** firebase.google.com/pricing, firebase.google.cn/pricing (mirror, checked), cloud.google.com/storage/pricing, P3-8 verdict

> Research only — no codebase changes.

---

## 1. Why Storage matters to us

Today `uploadImage` (`Admin/js/firebase.js:157`) stores dish images as **base64 data URLs inside RTDB** because Storage is unavailable on Spark (bucket 404s; Sept-2024 Firebase rule: Storage requires Blaze). Consequences (from P3-8):

- Menu payload **730 KB/scan**, of which **727 KB is base64 image data** (meta only 3.4 KB).
- Every QR scan re-downloads every image from RTDB — quota-billed, uncached.
- Moving images to Storage/Hosting URLs drops payload to **~75 KB** (10× saving) and shifts image bytes to a **10× cheaper + CDN-cacheable** axis.

**Blaze unlocks Storage** — `runImageMigration` (`Admin/js/features/catalog.js:796`) already exists to migrate; the reverse migration (base64 → Storage URL) would be the follow-up once Blaze is live.

---

## 2. Storage pricing (Blaze, 2026)

Free allowances are **per project, calculated daily**, and only for buckets in **us-central1, us-west1, us-east1** (choose us-central1 when creating the bucket!).

### New buckets (`*.firebasestorage.app` / default)

| Item | Free | Then |
|---|---|---|
| GB stored | **5 GB-months** | Cloud Storage pricing (~$0.020/GB-mo regional standard) |
| GB downloaded | **100 GB/month** | Cloud Storage pricing (~$0.12/GB premium egress from US) |

### Legacy buckets (`*.appspot.com`)

| Item | Free | Then |
|---|---|---|
| GB stored | 5 GB | **$0.026/GB** |
| GB downloaded | 1 GB/day (~30 GB/mo) | **$0.12/GB** |
| Upload ops | 20K/day | $0.05/10K |
| Download ops | 50K/day | $0.004/10K |

**Our bucket** (created with the project) is the legacy `*.appspot.com` one → use the legacy row: free 5 GB stored + 1 GB/day download. Egress above that: $0.12/GB.

---

## 3. Will Storage even register on our bill? (No, at our scale)

Our image corpus: **22 dishes × ~30.5 KB avg = ~0.7 MB** today. Even at 1,000 dishes × 100 KB = **100 MB** — far under the 5 GB free storage.

Egress estimate per busy restaurant (150 scans/day × ~730 KB images if they lived in Storage):

```
150 scans × 0.73 MB = 110 MB/day = 3.3 GB/month  per busy restaurant
```

- **Free tier covers it:** legacy 1 GB/day egress = ~30 GB/mo ≈ **9 busy restaurants** before Storage egress costs a cent; new-bucket 100 GB/mo ≈ **30 busy restaurants**.
- Beyond free: 3.3 GB/mo × $0.12/GB = **$0.40/restaurant/month** (legacy) — still ~3× cheaper than RTDB's $1/GB, and cacheable via CDN headers so real egress is lower.

**Verdict:** Storage cost is noise at our scale. The real win is getting 727 KB/scan out of RTDB (RTDB download is the expensive wall).

---

## 4. Cost-comparison: images in RTDB vs Storage (per busy restaurant, per month)

| Axis | Images in RTDB (today) | Images in Storage (after Blaze) |
|---|---|---|
| Download price | **$1/GB** (RTDB) | **$0.12/GB** (or free ≤1 GB/day legacy) |
| Egress per busy rest | 3.3 GB → **$3.30** | 3.3 GB → **free** (≤30 GB/mo), else $0.40 |
| Menu payload | 730 KB/scan | ~75 KB/scan |
| CDN caching | none (RTDB wire) | yes (URLs, `Cache-Control`) |

---

## 5. Enabling Storage (post-upgrade only — not done now)

1. Blaze active (see `BLAZE-UPGRADE-UPI-GUIDE.md`).
2. Firebase console → Storage → **Get started** → create bucket (default `*.appspot.com`, region **us-central1** to keep free tier).
3. Rules: keep write auth-gated as per existing audit standards.
4. Migrate base64 → upload → store URL in `dishes/{id}/imageUrl`; strip base64 from RTDB.
5. Verify: `node Research/scripts/cost-calc.js --fixed` (Storage egress line appears)
