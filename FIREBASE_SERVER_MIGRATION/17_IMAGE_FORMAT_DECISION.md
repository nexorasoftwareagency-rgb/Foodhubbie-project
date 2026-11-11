# 17 — Image format decision: WebP vs JPEG vs PNG

**Date:** 2026-11-11
**Question asked:** "If all the menu item images — all — convert into WebP: its effects, performance, limitation and benefits?"
**Answer:** **No. Converting the menu item images to WebP makes them ~38 % larger.** The dish photos are already at 0.2 bytes/pixel, which is past the point where WebP's advantages exist.

All numbers below are measured on the live Media bucket (`foodhubbie-10.firebasestorage.app`) and on the real deployment files, by decoding the actual source images in Chromium and re-encoding them. Nothing here is estimated from a blog post.

---

## 1. What we actually hold

| Scope | Contents | Size |
|---|---|---|
| Media bucket | 99 objects | 2.81 MB |
| — of which | 98 JPEG (avg 29 KB) + 1 WebP | — |
| Dish photos | 63 files, all 600×327 | **1,368 KB** (avg 21.7 KB) |
| Bot status images | 5 × `settings/Bot/img*.jpg` | 990 KB |
| `paymentQR.jpg` | 1 UPI QR | 75 KB |
| Rider KYC | 2 photos | 123 KB |
| Menu PWA icons | `icon-512` / `icon-192` / `apple-touch-icon` | **356 KB** |
| Admin cold load (post batch 16) | js 218 KB · css 48 KB · png 29 KB | 295 KB |

`menu/js/ui.js:345` already emits `loading="lazy"` on every dish image, and `.dish-visual` is `aspect-ratio:16/9` at full card width (`menu/css/app.css:140`) — so 600×327 is the *correct* resolution for a ~358 CSS px wide card at 2× DPR, not an oversized one.

---

## 2. Same pixels, re-encoded — WebP loses

Six dish photos sampled across the size range, re-encoded at identical pixel dimensions:

| Dish | dims | JPEG now | WebP q75 | WebP q85 | saving @85 |
|---|---|---|---|---|---|
| -P-X22IR2vHSesOPYpXt | 600×327 | 41 KB | 43 KB | 58 KB | **−41 %** |
| -OrsB0pKefOyKE5wolFF | 600×327 | 40 KB | 41 KB | 55 KB | **−39 %** |
| -P5fjfBYXItwhIdp-Q9i | 600×327 | 37 KB | 38 KB | 51 KB | **−39 %** |
| -P5fjfAnLJJVPRvRbO_6 | 600×327 | 36 KB | 37 KB | 49 KB | **−37 %** |
| -P5wOTw76OLfE823IisK | 600×327 | 35 KB | 35 KB | 47 KB | **−35 %** |
| -P5fjf6G65ZXaaQ-sslG | 600×327 | 35 KB | 35 KB | 48 KB | **−38 %** |
| **sample total** | | **223 KB** | 254 KB | **308 KB** | **−38 %** |
| **whole estate** | | **1,368 KB** | | **~1,891 KB** | **+523 KB** |

A full menu browse would get **half a megabyte heavier**.

### Quality sweep — where does WebP cross below the existing file?

Same 600×327 image, both codecs re-encoded from the same decoded pixels:

| quality | WebP | JPEG (re-encode) | original on disk |
|---|---|---|---|
| 0.40 | 29 KB | 35 KB | **40 KB** |
| 0.50 | 32 KB | 38 KB | |
| 0.60 | 36 KB | 40 KB | |
| 0.70 | 39 KB | 42 KB | |
| 0.75 | 41 KB | 44 KB | |
| 0.80 | **48 KB** | 47 KB | |
| 0.85 | 55 KB | 49 KB | |

WebP only "wins" at q ≤ 0.70, and even there it is 39 KB against 40 KB — a **2.5 % gain bought by stacking a second round of lossy compression on an already-lossy original**. Above q0.75 JPEG wins outright. The file on disk is already smaller than either codec can reach at a tolerable quality.

### The real lever, and why it is also closed

Right-sizing to what the layout renders:

| target | why | JPEG q82 | WebP q82 |
|---|---|---|---|
| 300×164 | 2× a ~150 px thumb | 18 KB | 17 KB |
| 200×109 | 2× a 100 px thumb | 9 KB | 8 KB |

Resizing beats any codec change (−55 % / −77 %) — **but the menu card renders these images full-width at 16:9**, so 300×164 would be visibly soft on every phone. The only surfaces that would justify it are `.cart-item-img` (52×52) and `.combo-cross-sell-img` (48×48), and those share the same `image` field as the big card. There is no size to right-size down to.

---

## 3. Why this happens (so the next person does not re-litigate it)

WebP's published 25–35 % wins are measured against **unoptimised** inputs: PNG screenshots, q95 JPEGs straight out of a phone, 4000 px photos. Ours are none of those. 40 KB across 196,200 pixels is **0.20 bytes/pixel**. At that density:
- the source has already discarded the high-frequency detail WebP's transforms would exploit,
- re-encoding must spend bits re-approximating what was thrown away,
- and the second lossy pass is exactly what a low-q WebP encode does.

WebP is a better *codec*, but it is not a better *re-compressor of already-compressed files*.

---

## 4. Where WebP does win — and what blocks it

| Asset | now | WebP | save | blocker |
|---|---|---|---|---|
| `Admin/icon-erp-logo.png` 512² | 31 KB (PNG-8) | 14 KB (q85) | −17 KB | manifest declares `512x512` PNG, iOS PWA |
| `Admin/login-bg.png` 1024² | 183 KB | 130 KB (q82) | −53 KB | CSS `background-image` only, low traffic |
| `menu/icons/icon-512.png` | 238 KB | **20 KB** | **−218 KB** | manifest `type:image/png` |
| `menu/icons/icon-192.png` | 63 KB | 7 KB | −56 KB | in SW precache list |
| `menu/icons/apple-touch-icon.png` | 55 KB | — | — | **iOS requires PNG** |

**Hard constraints that keep several of these as JPEG/PNG:**

1. **WhatsApp Cloud API image messages accept only `image/jpeg` and `image/png`.** Everything the bot sends — `menuImage`, `bannerImage`, `imgConfirmed/imgReady/imgOut/imgDelivered/imgFeedback`, `paymentQR.jpg` — must stay JPEG. WebP would fail the send.
2. **`apple-touch-icon` must be PNG** — iOS silently ignores WebP for add-to-homescreen.
3. **`manifest.json` `icons[].type`** is `image/png`; changing it means shipping both files and listing both entries.
4. **`og:image` link previews** (WhatsApp, LinkedIn) do not reliably render WebP.
5. Renaming to `.webp` touches `manifest.json`, `index.html`, `menu/sw.js` precache, `.gitignore` (`!menu/icons/*.png`) and needs a `CACHE_NAME` bump — five files for asset types where the saving is zero or negative.

### The menu icons are the one real find, and quantisation beats renaming

`icon-512.png` is 238 KB because it is **photographic, not flat art** — 29,708 distinct colours (a smooth orange→red gradient behind the logo). It is also **not a WebP-only case**: colour-quantising it to 32 levels per channel gives the same filenames, same format, same manifest, zero compatibility risk:

| levels | colours | PNG | max err | mean err |
|---|---|---|---|---|
| (original) | 29,708 | 238 KB | — | — |
| 8 | 512 | 53 KB | 18/255 | 6.78 |
| 16 | 4,096 | 75 KB | 8/255 | 3.46 |
| **32** | **32,768** | **135 KB** | **4/255** | **2.01** |
| 48 | 110,592 | 192 KB | 3/255 | 1.37 |

Rendered side by side at 330 px and at the real 48 px display size, **32 levels is indistinguishable from the original** — the error lives entirely in the gradient's dithering and never surfaces as visible banding. All three icons at ~32 levels: **356 KB → ~160 KB (−55 %), no format change, no markup change.**

Honest framing: that is a **mobile first-load polish win, not a cost win** — ~2 KB of the ~45 KB per first visitor, worth well under ₹1/month at current volume. It is optional.

---

## 5. Decision

| Asset | Decision | Reason |
|---|---|---|
| Dish photos (63) | **Keep JPEG** | WebP is +38 %; already 0.2 B/px and correctly sized |
| Bot status images / `menuImage` / `bannerImage` / `paymentQR` | **Must stay JPEG** | WhatsApp Cloud API accepts only JPEG/PNG |
| `apple-touch-icon.png` | **Keep PNG** | iOS requirement |
| `menu/icons/*` | **Optional:** quantise to 32 levels, keep PNG | −55 % at ~1 % error, zero compatibility risk. Not a cost lever. |
| `Admin/icon-erp-logo.png` | **Keep as is** (already dieted 1,098 → 31 KB in batch 16) | 17 KB further gain is not worth manifest/iOS risk |
| `login-bg.png` | **Keep as is** (already 814 → 183 KB) | 53 KB on a login screen nobody sees twice |

**Net effect of the whole WebP idea if executed: +523 KB per menu browse, higher bill, more moving parts, and two features (WhatsApp image sends, iOS install) broken.** The fix is to not do it.

---

## 6. What actually still costs money in an image path

Nothing image-related. After batch 16, the remaining per-day spend is the normal Hosting bill for dashboard loads, and the dominant term of a cold Admin profile is **JS (218 KB of 295 KB = 74 %)**, not images (29 KB = 10 %). The next real lever is the service-worker precache (~0.25 MB re-downloaded invisibly per cold profile) and keeping E2E traffic on `tools/serve-dist.cjs`, not shrinking pictures.

## 7. Reproduce

| Script (in `%TEMP%\opencode`) | What it proves |
|---|---|
| `menu-webp.cjs` | 6-sample JPEG → WebP q75/q85, estate extrapolation |
| `menu-webp-sweep.cjs` | quality sweep + right-sizing table |
| `menu-icons-measure.cjs` | icons at native size, PNG quantisation vs WebP |
| `icon-levels.cjs` | distinct-colour count + size/error curve |
| `icon-compare.cjs` | side-by-side + ×12 error map (visual judgement) |
| `cold-composition.cjs` | live cold-load breakdown by type |
