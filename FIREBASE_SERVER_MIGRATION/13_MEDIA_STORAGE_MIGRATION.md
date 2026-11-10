# 13 — Media Migration: base64 in RTDB → Cloud Storage

**Status:** in progress
**Started:** 2026-11-10
**Depends on:** 11 (RTDB cost incident), 12 (webhook cutover)
**Owner decision needed:** none — scope confirmed as the full media migration

---

## 1. Why this batch

Batch 11 removed the *reconnect* amplifier (a dead-socket worker re-reading the whole
`businesses` tree every ~5 min). That cut RTDB egress ~29×, from **~3.24 MB/min
(4.65 GB/day)** to **112 KB/min (~161 MB/day)**.

What is left is structural: **the payload itself**.

| What | Live size (pizza) | Read by |
|---|---:|---|
| `businesses` whole tree | 6.3 MB | orchestrator boot, `/api/bot/status-all`, daily settlement, legacy tenant resolve |
| `settings/Bot` (5 status JPEGs as base64) | 1.35 MB | bot (Admin SDK), Admin settings |
| `dishes` (22 base64 JPEGs) | 673 KB | **every menu load** (customer app, QR menu) |
| `settings/Store/paymentQR` | 103 KB | menu + receipt rendering (public read) |

Media is **2.12 MB of the 6.3 MB tree (34 %)** on a single outlet. RTDB charges
**$1.00/GB** downloaded and cannot cache any of it; Cloud Storage charges
**$0.12/GB** and serves with `max-age=31536000`. The same bytes get ~8× cheaper and
the payload that rides along with every RTDB read shrinks by a third.

Modelled for the project's workload (100 outlets × 50 orders/day = 150 000 orders/month):
2.12 MB × 100 outlets = 212 MB stored (**≈ $0.005/month**), replacing an estimated
~300 GB/month of uncacheable RTDB dish reads (**≈ $300/month**) with ~27 GB/month of
cached Storage reads (**≈ $3.24/month**). The real ratio is better than the model,
because browser caching means each device fetches a dish image roughly once.

## 2. What the survey found (this is also a live product bug)

**Cloud Storage has never been provisioned on `foodhubbie-10`.**

```
bucket name: foodhubbie-10.firebasestorage.app
exists: false
list buckets -> 200
   gcf-v2-sources-372428105696-us-central1
   gcf-v2-uploads-372428105696.us-central1.cloudfunctions.appspot.com
```

Consequences, all live right now:

1. `Admin/js/firebase.js` `uploadImage()` (line 172) has **always failed**. Every dish,
   category and combo image in production is a baked base64 data URI written by older
   code paths — which is exactly what the survey shows. The Admin still offers an image
   picker that silently does nothing.
2. `firebase.json` has **no `storage` block**, so `storage.rules` was never deployed
   and is dead configuration today.
3. Those committed rules could never have worked anyway: `isAdmin()` tests
   `request.auth.token.admin == true`, and **`setCustomUserClaims` has zero hits in the
   codebase**. Admin identity lives entirely in RTDB rules
   (`root.child('admins').child(auth.uid)`), which Storage rules cannot read.
4. The rules' paths (`/{outlet}/dishes/{dishId}/**`) do not match what `uploadImage()`
   actually writes (`outlets/{bid}/{oid}/${type}s/${id}/original.${ext}`).
5. `Admin/js/features/riders.js:400-401` calls `uploadImage(file, 'riders/profile_…')`
   with a **string** second argument, against an object signature — it would throw even
   with a working bucket. Rider profile + Aadhaar photos are broken today.

So this batch is two things at once: the egress fix **and** making image upload work.

## 3. Design

### 3.1 Writes: one server endpoint, no custom claims

Storage rules cannot read RTDB, so client-side `uploadBytes()` would require custom
claims plus a backfill for every existing admin — a second identity system to keep in
sync forever.

Instead: **the control API uploads with the Admin SDK**, which bypasses rules.

```
Admin browser ──(Firebase ID token, base64 JSON)──▶ POST /tenant-api/upload
                                                     ├─ requireTenantAdmin → req.businessId/req.outlet
                                                     ├─ Admin SDK bucket.upload
                                                     └─ { url: token download URL }
```

- Tenant is derived **from the verified token**, never from the request body, so an
  admin can only ever write under their own `outlets/{bid}/{oid}/`.
- `requireTenantAdmin` already exists and is already mounted on `/tenant-api`.
- Body limit: the global parser stays at the 100 KB default; the upload route is
  excluded from it and mounts `express.json({ limit: '8mb' })`.
- Stored **byte-for-byte, no re-encode**: a payment QR must stay scannable and a PNG must
  keep its alpha channel. Size is already controlled at the source (Admin caps settings
  images at 500 KB, the rider app compresses to 300 KB, the endpoint rejects >6 MB).
  An earlier draft planned a Sharp JPEG re-encode; dropping it is deliberate (§7.4).

### 3.2 Reads: token URLs, deny-all rules

`getDownloadURL()` returns a URL carrying a `firebaseStorageDownloadTokens` value. That
endpoint serves the object **when the token is present, regardless of rules**, which
means no read rule is needed at all — and, critically, **rider Aadhaar photos are not
public**.

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Everything is written by the control API (Admin SDK, bypasses rules) and read
    // through per-object download tokens. No browser ever needs direct access.
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

Client code that must change: `uploadImage()` (→ API call), `deleteImage()` (→ API
call), `riders.js` call sites (→ object signature). Everything else already accepts a
URL:

- `bot/index.js` `sendImage` fetches non-`data:` strings and re-encodes via Sharp
  (lines 707-724) — **no bot change**.
- Menu / Admin `<img src>` — no change.
- `Admin/receipt-templates.js:196` renders `store.paymentQR` as `<img src>` — no change.
- `settings.js` save reads back `previewEl.src` — already URL-agnostic.

### 3.3 Bucket

`foodhubbie-10.firebasestorage.app`, location **ASIA-SOUTH1** (customers and the EC2 bot
are both in India; Firebase Functions' `us-central1` only stores the source).
Created through the GCS JSON API with the existing service account — `gcloud` is not
installed anywhere in this setup.

## 4. Steps

| # | Step | Gate |
|---|---|---|
| 1 | Create the bucket, add the `storage` block to `firebase.json` | `bucket.exists() === true` |
| 2 | New `storage.rules` (deny-all) + `firebase deploy --only storage` | ruleset id returned |
| 3 | `POST /tenant-api/upload` + `POST /tenant-api/delete-image` | 401 without token, 200 with |
| 4 | `uploadImage()` / `deleteImage()` → API; fix the two `riders.js` calls | `node --check` |
| 5 | `previewSettingsImage()` uploads instead of FileReader | save stores an `https://` URL |
| 6 | `tools/migrate-media-to-storage.cjs` — dry-run, backup, `--apply` | dry-run lists exact paths |
| 7 | Apply on the live pizza outlet | `settings/Bot` ≤ ~2 KB |
| 8 | Live E2E | see §5 |

### 4.1 Migration script shape

Walks `businesses/{bid}/outlets/{oid}` for **any** string starting with `data:image/`,
so no field list can go stale. Stores each at a path that mirrors its RTDB location:

```
outlets/{bid}/{oid}/migrated/dishes/-OrsBLj9…/image.jpg
outlets/{bid}/{oid}/migrated/settings/Bot/imgConfirmed.jpg
outlets/{bid}/{oid}/migrated/settings/Store/paymentQR.jpg
```

- Dry-run by default; `--apply` writes.
- Backup of the affected nodes is written before the first write.
- Idempotent: values that are already URLs are skipped, so re-running is safe.
- One `update()` per parent node (never a whole-outlet `set()`), so a partial run cannot
  drop data.

### 4.2 Rollback

1. `git revert` the Admin/API commit, redeploy `hosting:admin`, `scp` the previous
   `server.js` (backup taken before deploy).
2. Restore the RTDB media nodes from the backup JSON written by the migration script:
   `node tools/restore-media-backup.cjs <file>` (same script, `--restore`).
3. The bucket is additive — deleting it is optional and only removes the new copies.

## 5. Verification plan

| Check | Expected |
|---|---|
| Anonymous read of an object **without** a token | `400` (the endpoint rejects a missing/bad token; plain GCS URLs give `403`) |
| Anonymous read **with** the token URL | `200`, `content-type: image/jpeg`, `cache-control: public, max-age=31536000` |
| Browser `fetch()` from a dashboard origin | `200` with `access-control-allow-origin` (needs bucket CORS — §7.5) |
| `POST /tenant-api/upload` with no token | `401` |
| `POST /tenant-api/upload` with a token for outlet A, path for outlet B | impossible by construction (bid/oid come from the token) |
| Admin dish image upload | dish `image` becomes `https://firebasestorage…`, `<img>` renders, menu shows it after reload |
| `settings/Bot` size after migration | ≤ ~2 KB (from 1.35 MB) |
| `dishes` size after migration | ≤ ~20 KB (from 673 KB) |
| Bot status image send | `[SEND OK] … type=image`, no `Image Send Error` |
| Receipt `paymentQR` | QR image renders in the print preview |
| Rider create/edit with photo | rider record holds a token URL, Admin `<img>` renders it |

## 6. Cost model (100 outlets)

| | Today (RTDB) | After (Storage) |
|---|---:|---:|
| Stored | 6.3 MB / outlet in the tree | 212 MB total, $0.005/mo |
| Egress | $1.00/GB, uncacheable | $0.12/GB, `max-age=31536000` |
| Modeled monthly media egress | ~300 GB → ~$300 | ~27 GB → ~$3.24 |

Storage operations: a few hundred writes/month (free tier: 5 000/day) and reads billed
per 10 000 (free tier: 50 000/day). Effectively **$0**.

## 7. As built

### 7.1 Provisioning (the real blocker)

The bucket could not simply be created: **the `firebasestorage.googleapis.com` API had
never been enabled on `foodhubbie-10`**. That single fact explains the whole symptom set —
no bucket, no rules deployment, `uploadImage()` failing since it shipped, all media still
base64.

Paths tried, in order:

| Attempt | Result |
|---|---|
| GCS `buckets.insert` with the service account | `403` — "Another user owns the domain `foodhubbie-10.firebasestorage.app`" (GCS treats `*.firebasestorage.app` as a domain-verified name) |
| Enable the API with the **service account** | `403 PERMISSION_DENIED` — an admin-SDK service account cannot enable APIs |
| `firebase deploy --only storage` before provisioning | would fail — the CLI only GETs `projects/{id}/defaultBucket` and tells you to click "Get Started" |
| Enable the API with the **owner's own CLI session** (`serviceusage…:enable`) | `200`, operation completed |
| `POST firebasestorage.googleapis.com/v1alpha/projects/foodhubbie-10/defaultBucket` | `200` → bucket `foodhubbie-10.firebasestorage.app`, `ASIA-SOUTH1`, linked |

No console click was required. `POST defaultBucket` needs a `location`; `{}` returns
`400 INVALID_ARGUMENT`.

### 7.2 Behaviour proven live

`POST /tenant-api/upload` against the running control API on EC2, with a real Firebase ID
token minted for a throwaway owner of the e2e outlet — **13/13**:

| Check | Result |
|---|---|
| upload with no token | `401` |
| upload with token | `200` + token URL |
| path is tenant-scoped | `outlets/e2e-biz-…/e2e-outlet-…/dishes/…/original.png` |
| token URL read anonymously | `200`, `image/png`, `cache-control: public, max-age=31536000` |
| same object **without** the token | `403` |
| plain GCS URL | `403` (uniform bucket-level access) |
| non-image payload | `400` |
| delete an image of another outlet | `403` |
| delete own image, twice | `200`, `200` (`ignoreNotFound`) |
| deleted object no longer served | `403` |

Fixture admin (Auth user + `admins/{uid}`) deleted afterwards.

### 7.3 Migration applied (pizza)

36 image fields, **1.59 MB of decoded bytes** (2.12 MB of base64), 34 unique payloads
(sha256 dedupe — the five bot status images are byte-identical and cost one object).

| Node | Media bytes before (base64 as stored) | Node size after | |
|---|---:|---:|---|
| `settings/Bot` | 1 352 155 B | **1 404 B** | 964× smaller |
| `dishes` | 670 078 B | **7 847 B** | 85× smaller |
| `categories` | 74 446 B | **1 915 B** | |
| `combos` | 30 990 B | **2 171 B** | |
| `settings/Store` | 103 671 B | **1 078 B** | |

Total media removed: **2 230 112 B** (2.13 MB of base64 → 1.59 MB of objects).

- `data:image/` remaining in `settings`/`dishes`/`categories`/`combos`: **0**
- 36 stored URLs fetched: **36 × `200`, all `image/jpeg`**
- `paymentQR` verified byte-identical (77 083 B, JPEG magic `ffd8ff`) — no re-encode, so it
  still scans

Backup of every replaced value: `/var/www/foodhubbie/backup/media-roshani-pizza-pizza-*.json`
(`--restore` reverts).

### 7.4 Deliberate non-changes

- **No bot change.** `sendImage` already takes the non-`data:` branch: it `fetch`es the
  URL and re-encodes JPEG→PNG for Baileys thumbnails (lines 707-724), with a text fallback
  on any failure.
- **No menu change.** `img-src` already allows `https://*` and
  `https://*.firebasestorage.googleapis.com`.
- **Rider photos are not public.** Everything is deny-all and served by download token;
  the one rule exception is `riders/{uid}/**`, where the rider app uploads its own photo
  as a Firebase Auth user whose uid *is* the rider id — something Storage rules can verify
  without claims.
- **`deleteImage` on a legacy `data:` URI is a no-op** — there is no object to delete.
- The demo tenant keeps its generated SVG data URIs (a few hundred bytes each); it copies
  the live catalog verbatim, so dish photos now arrive as URLs.
- **No Sharp re-encode of uploads** (the §3.1 draft proposed one). Storing the original
  bytes keeps a payment QR scannable and a PNG's alpha intact; all three clients already
  cap size, and the endpoint rejects >6 MB.
- **The rider app needed no change** — `rider-app/src/lib/firebase.ts` already sets
  `storageBucket: "foodhubbie-10.firebasestorage.app"`, so `getStorage(app)` resolves to
  the same bucket the rules were deployed to.

### 7.5 Bucket CORS (found by the live E2E)

`<img src>` worked everywhere from the first upload, so the gap stayed invisible until the
E2E tried `fetch(objectUrl)` from the dashboard: **`blocked by CORS policy`**. A `curl` with
an `Origin` header proved it — the GET response carried no `access-control-allow-origin`,
while the OPTIONS preflight did answer `Access-Control-Allow-Origin: *`.

The Firebase Storage download endpoint returns the **bucket's** CORS config, and a new
bucket has none. Currently nothing in the product converts an image to a Blob, but that is
exactly the kind of latent trap that surfaces later (canvas compositing, share sheets,
client-side PDFs), so the bucket is now configured explicitly:

```
tools/set-bucket-cors.cjs   # idempotent; prints before/after
```

- Origins: the 9 production hosts (admin, app, supreme, menu, qrmenu, rider, website ×2)
  plus `localhost:5000/8080`.
- Methods `GET, HEAD`; exposes `Content-Type/Length/Range/Cache-Control/ETag`; `maxAgeSeconds: 3600`.
- **Requires the project owner's `firebase login` session** — patching bucket metadata is
  denied to the admin-SDK service account. That is why this is a local tool, not an API route.

Verified after patching: an allowed origin gets
`access-control-allow-origin: https://foodhubbie-admins.web.app`, an unknown origin gets
none (CORS is not a blanket `*`), and the browser `fetch()` in the E2E returned the exact
70 bytes.

### 7.6 Live browser E2E — 29/29

Throwaway super admin (`admins/{uid}` + Auth user, deleted afterwards), real deployed
hosting, Chromium via Playwright.

| Part | Check | Result |
|---|---|---|
| 0 | deployed `/js/firebase.js` calls `/tenant-api/upload`, no `firebase-storage.js`, no `uploadBytes` | 4/4 |
| A | 5 bot status previews + payment QR are Storage URLs and decode (`1900×1060`, `894×875`) | 6/6 |
| A | all 22 catalog dish cards hold Storage URLs; **21/21 unique URLs serve a decodable image** | 4/4 |
| B | `uploadImage()` → token URL under `outlets/roshani-pizza/pizza/dishes/…` | 3/3 |
| B | stored object: `200`, `image/png`, `max-age=31536000`, **bytes identical (70)** | 4/4 |
| B | browser `fetch()` is CORS-allowed; `deleteImage()` → object `403` afterwards | 3/3 |
| C | public menu (delivery, no auth): 22/22 dish cards, 21 unique Storage URLs all decode, 0 console errors | 5/5 |
| D | 0 console errors on the Admin page across A+B | 1/1 |

Notes from running it:

- The UI uses `loading="lazy"`, so offscreen cards report `naturalWidth: 0` by design.
  Coverage is therefore proven twice: card `src` is a Storage URL, **and** every collected
  URL is loaded through a throwaway `new Image()`.
- Two dishes legitimately share one photo (21 unique URLs across 22 cards), so coverage is
  counted per card, never per unique URL.
- Cleanup verified afterwards: `admins/{uid}` gone, Auth user deleted, bucket holds exactly
  the 34 migrated objects, 0 `e2e-*` leftovers, token file removed from EC2 and locally.
