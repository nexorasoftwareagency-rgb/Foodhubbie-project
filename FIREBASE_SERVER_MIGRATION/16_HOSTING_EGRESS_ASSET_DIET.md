# 16 — Hosting Egress: why the bill moved ₹80, and the asset diet

**Status:** shipped 2026-11-11 (`hosting:admin` deployed, SW `v5.12.44`).
**Trigger:** owner observed the Firebase bill increase ~₹80 in one night, after batch 15 had
already cut RTDB egress to ~32 MB/day.

---

## 1. Answer first: what the ₹80 is

Overnight usage was **₹0**. Between 00:00 and 08:00 IST on 11 Nov:

| Service | Used | Free allowance | Billable |
|---|---:|---|---:|
| Realtime Database (outgoing) | 78.1 MB | 360 MB / day | — |
| Hosting (egress) | 113.7 MB | 360 MB / day | — |
| Storage (egress) | 7.9 MB | 5 GB / month | — |
| Cloud Run / Functions | 240 req / 240 exec | 2M / month | — |

Nothing in those hours is billable, so the ₹80 is **settlement lag**: Cloud Billing posts
previous days' usage to the invoice over the following day or two. The usage being posted is the
Nov 8–10 peak (RTDB 2.1 → 3.4 → 5.0 GB/day, Hosting 3.0 → 3.7 → 5.0 GB/day).

**Which line is still growing is not RTDB — it is Hosting.** Rolling 24 h at the time of
investigation:

| Service | 24 h | Note |
|---|---:|---|
| Hosting `foodhubbie-admins` | **4,567.3 MB** | 99 % of all Hosting |
| Hosting `foodhubbie-qrmenu` | 39.8 MB | real customers |
| Hosting web / rider / supreme / assets | 10.5 MB | negligible |
| RTDB | 2,381.6 MB | mostly the Nov 10 incident tail; own baseline now 1.32 MB/h |
| Storage | 17.1 MB | post-migration media |

So the remaining spend was **dashboard egress on one site**, and the fix below removes ~75 % of
it per page load.

### Pricing used (Cloud Billing Catalog, billing account `015AD6-4B5D4F-657177`, INR)

```
Firebase Hosting  Outgoing Bandwidth   0+ free  |  0.3515625+  ₹14.2845 / GiBy
Firebase RTDB     Outgoing Bandwidth   0+ free  |  0.3515625+  ₹95.2300 / GiBy
```

**Do not quote metric-derived rupees for RTDB as invoice lines.** Doc 11 already recorded that
`sent_bytes_count` runs ~3× higher than the profiler's own byte accounting for the same window,
and that reconciles the gap here: Nov 1–10 measures 23.7 GiB, which prices at ~₹1.7 k, while the
actual alert said **₹469.36 for 1–10 Nov** (≈ ÷3.7). Treat metric bytes as a *relative* signal for
RTDB; use them as absolute for Hosting, where the mechanism was reproduced physically (§2).

---

## 2. The measurement that made the cause visible

A controlled 10 cold loads of `https://app.foodhubbie.in/demo` at 08:06–08:08 IST reported
**9.76 MB** of browser `transferSize`, while the hosting metric recorded **22.43 MB** for the same
minutes. The 2.3× is not metric inflation — it is the **Service Worker**:

- the page itself downloads ~0.98 MB, of which **731 KB is `icon-erp-logo.png?v=3`**;
- the SW install then precaches 44 assets (~0.97 MB) in the same fresh profile,
  **731 KB of which is `icon-erp-logo.jpeg`** — the same artwork, second copy, second format.

Neither happens for a returning visitor (cache + installed SW), but **every** fresh browser
profile pays both: Playwright `newContext()`, crawlers, CI, first-ever visitors. At 2.24 MB per
cold profile, the 4.57 GB day was ≈ **2,040 cold profiles** — and the hourly curve confirmed it
(0 MB overnight, 200–714 MB/h only during working hours, minute-for-minute with a parallel
agent session's Playwright scripts).

**Rule of thumb:** a cold admin load is ~2.2× the number a page-side measurement reports,
because the SW precache bytes are invisible to `performance` entries.

---

## 3. What was actually wrong

| File | Before | Rendered at | Waste |
|---|---:|---|---|
| `Admin/icon-erp-logo.png` | 1,098 KB (1254×1254, 0.71 B/px) | 48 px and 40 px `<img>`, 32 px favicon | 731 KB per page load |
| `Admin/icon-erp-logo.jpeg` | 1,098 KB (identical art) | SW notification icon, favicon, apple-touch | 731 KB per SW install |
| `Admin/login-bg.png` | 814 KB (1024×1024 JPEG behind a full-bleed background) | login screen | 811 KB on first paint |

A 1254² PNG for a 48 px logo, duplicated in two formats, precached **and** page-loaded.

---

## 4. The fix

Filenames and formats are unchanged, so **no HTML/JS/manifest/CSS edit was needed** — only the
mandatory SW cache bump.

| File | After | How |
|---|---:|---|
| `icon-erp-logo.png` | **31 KB** (512×512) | downscaled from the original, then 8-level quantised (55 colours) — the art is flat vector, so it survives palette reduction |
| `icon-erp-logo.jpeg` | **9 KB** (192×192, q0.9) | notification/apple-touch size is all it needs |
| `login-bg.png` | **183 KB** (1024×1024, q0.82) | recompressed; still a JPEG payload under a `.png` name (pre-existing, untouched) |

512×512 keeps `manifest.json`'s declared `sizes: "512x512"` maskable icon honest.
Backups of the three originals: `backup/media-diet-<stamp>/` (gitignored).

`Admin/sw.js` `CACHE_NAME` → `foodhubbie-erp-shell-v5.12.44`, `node tools/build.mjs --admin`
(3.6 MB → 2.7 MB dist), `firebase deploy --only hosting:admin`.

### Measured result

| | Before | After |
|---|---:|---:|
| Page transfer per cold load (`transferSize`) | 0.976 MB | **0.296 MB** |
| 10 cold loads, browser-reported | 9.76 MB | **2.90 MB** |
| 10 cold loads, hosting metric | 22.43 MB | ~6.5 MB (extrapolated; the post-fix window was polluted by a parallel session, see §6) |
| Logo bytes per cold profile (page + SW) | 1,462 KB | **40 KB** |
| Per cold profile, all-in | ~2.24 MB | **~0.55 MB** |

Live wire check after deploy:

```
/icon-erp-logo.png?v=3   31,559 B   (was 731 KB)
/icon-erp-logo.jpeg       9,285 B   (was 731 KB)
/login-bg.png           187,773 B   (was 811 KB)
/sw.js                  foodhubbie-erp-shell-v5.12.44
```

Verified locally and live: demo boots, 25 nav tabs, logo `naturalWidth` 512, cache
`foodhubbie-erp-shell-v5.12.44` with 57 runtime entries, **0 console errors**.

---

## 5. Stop producing the traffic in the first place

`tools/serve-dist.cjs` serves a built dashboard on localhost, so UI/E2E/screenshot work never
touches Firebase Hosting:

```
node tools/serve-dist.cjs admin      # http://127.0.0.1:5055/demo   (?demo=1 works)
node tools/serve-dist.cjs supreme    # http://127.0.0.1:5056
```

`localhost` is an authorised Firebase Auth domain, so the demo signs in against the **real**
backend — only the static shell is local. Proven: 25 nav tabs, 0 console errors.
Use the live site only when the test is *about* the deployment (rules, headers, `version.json`,
service worker behaviour).

This matters more than it looks: a 20-context Playwright suite is ~45 MB of billable egress
before the diet and ~11 MB after, and this repo runs such suites repeatedly per session.

---

## 6. Honest limits

- The post-fix metric window could not be isolated: a parallel agent session
  (`measure-reward-card.cjs`, `final-live-shots.cjs`, `scan-clip-overlap.cjs`) was driving
  Chrome at 08:11–08:12 and 08:22–08:23 (35 MB and 47 MB per minute), which swamps a 2.9 MB test.
  The per-load numbers above are deterministic (same script, same URL, measured twice) and the
  precache byte sum is exact, so the 4× reduction does not depend on that window.
- Web fonts/CDN assets (unpkg, jsdelivr) are cached by the SW but still cost their own origins,
  not Hosting.
- Not addressed here: `menu/icons/*` is 356 KB for a PWA install (238 + 63 + 55), and the menu
  site's 39.8 MB/day is genuine customer traffic — worth a pass, not urgent.
- `Admin/robots.txt` is `Allow: /`, so `/demo` is crawlable. Crawlers that execute JS pull the
  full shell. A `noindex` on the demo path is a cheap future lever.
- Invoice-exact numbers need a BigQuery billing export; none exists on this project, and the
  Budgets API is disabled in the OAuth client project, so reconstruction is the only option today.
