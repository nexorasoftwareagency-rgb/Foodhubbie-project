# Batch 15 — finish the media migration (every outlet + `menuBank`)

*Date: 2026-11-11 · branch `main` / `server`*

Batch 13 proved the mechanism on **one** outlet (live pizza) and closed with a
known gap: 90 `data:image` fields still in RTDB. This batch finishes the job —
every tenant, the shared `menuBank`, and the two rider KYC photos — and then
proves the estate has **zero** base64 left.

---

## 1. What is actually left (measured, not assumed)

`node tools/migrate-media-to-storage.cjs` (dry run, whole estate):

| | fields | size |
|---|---:|---:|
| `data:image` strings in RTDB | 88 | 1.69 MB |
| — **base64** (migratable) | **65** | **1.72 MB** |
| — inline **SVG** (text, not migratable) | 23 | 10.4 KB |

The 65 base64 fields live in **six** places, and two of them were never in the
batch-13 tool's scope at all:

| Target | Fields | Size | Branch | Note |
|---|---:|---:|---|---|
| `menuBank` (platform root) | 28 | 688.8 KB | `categories`, `dishes` | **never migrated** — read by the Admin "Get Menu" browser |
| `-p5aidfx57acc4on6ffu/-p5aidfx57acc4on6ffv` | 16 | 378.2 KB | `categories`, `dishes` | pending signup (unverified; cleanup candidate) |
| `-p5wn8ta7qeasj79wlaf/-p5wn8ta7qeasj79wlag` | 9 | 204.4 KB | `categories`, `dishes` | |
| `padmavati-test/padmavati` | 7 | 180.0 KB | `categories`, `dishes` | test outlet |
| **`roshani-pizza/pizza`** | **2** | **164.5 KB** | **`riders`** | rider `profilePhoto` + `aadharPhoto` |
| **`roshani-cake/cake`** | **3** | **105.9 KB** | **`settings/Bot`** | `imgPreparing`/`imgConfirmed`/`imgCooked` |

### Why the demo tenant is not on the list

`foodhubbie-demo/demo` holds 8 `data:image` fields, all **inline SVG**
(`svgImage()` in `tools/seed-demo-tenant.cjs` → `data:image/svg+xml;charset=utf-8,…`).
They are 5.3 KB of text, and the nightly 03:00 IST reseed regenerates them. They
are not base64 and must not be "migrated" — that would fight the seeder.

The reseed also explains why the estate shrank from 90 fields to 88 between the
batch-14 scan and this one: the demo subtree is replaced wholesale every night.

### Why the riders matter more than their size

`Admin/js/features/riders.js` holds **one `onValue` listener on the whole
`riders` node** — so every rider delta, and every Riders-tab open, re-downloads
164.5 KB of base64 KYC for one rider. That is the single worst
egress-per-kilobyte node left in the tree.

**Privacy is not weakened by moving them.** New rider photos already go to
Storage: `Admin/js/features/riders.js` calls
`uploadImage(file, { type: 'rider', id })` → `POST /tenant-api/upload` →
`outlets/{bid}/{oid}/riders/{id}/original.{ext}` with a download-token URL, and
the rider app uploads through `uploadProfilePhoto` → `getDownloadURL`, also a
token URL. The two base64 photos are simply the pre-Storage path. Moving them
puts them on the same footing as every photo uploaded since batch 13.

---

## 2. Safety review — the only way a URL could break

A Storage URL is only unsafe where code **parses** a data URI. Full sweep
(`node tools/find-datauri-parsers.cjs`, 297 source files):

| Site | Guarded? | URL branch |
|---|---|---|
| `bot/index.js:654` fast path | `startsWith('data:image/png;base64,')` | falls through |
| `bot/index.js:693` sharpen path | `startsWith('data:image')` | `fetch(image)` → buffer |
| `bot/promotions.js:115` | `startsWith('data:image')` | `{ image: { url: mediaUrl } }` |
| `bot/promotions.js:504` | same | same |
| `bot-control-api/server.js:1365` | the **upload** route (input is always a data URI) | n/a |

Every consumer that *displays* an image uses `<img src>` (`Admin` riders,
catalog, menu-bank browser; `menu` dish cards), which accepts both. Batch 13
already proved this live for 22 dishes, 5 bot status images and the payment QR.

---

## 3. Tool changes

`tools/migrate-media-to-storage.cjs` becomes estate-wide and self-verifying.

| Before | After |
|---|---|
| one outlet, `--bid`/`--oid` defaulting to pizza | **no args = whole estate** (every outlet + `menuBank`); `--bid/--oid` narrows |
| branches `settings, dishes, categories, combos` | **`+ riders`** (KYC photos) |
| one `base` path per run | per-item base: `businesses/{bid}/outlets/{oid}` or `menuBank` |
| upload root `outlets/{bid}/{oid}/migrated/…` | same for tenants; `platform/menuBank/…` for the bank |
| backup `{ base, fields }` | `{ items: [{ref, path, value}] }` — **restore still accepts the v1 file** written by batch 13 |
| no post-run check | re-scan asserts **0 base64**, and every new URL is `GET`-ed (200 + exact byte length) |
| — | `--verify` mode: estate-wide acceptance gate (0 base64, all URLs 200) |

Dedupe stays sha256, scoped **per target**: identical payloads inside one
tenant (or inside `menuBank`) cost one object, but a tenant never points at
another tenant's object. See §5 for why whole-run dedupe was rejected.

Deliberate non-changes:

- **Inline SVG is skipped and reported**, never uploaded — it is text, it is
  tiny, and the demo seeder rewrites it nightly.
- **No deletion of tenants.** `-p5aidfx…` is a cleanup candidate in observe
  mode; if it is ever expired its migrated objects become orphans (~380 KB).
  That is cheaper than leaving 378 KB in a tree that every bot boot downloads.

---

## 4. Acceptance criteria

1. `--verify` reports **0 base64** fields under `businesses` and `menuBank`.
2. Every migrated URL returns `200` with the exact original byte length
   (byte-for-byte upload — a payment QR must stay scannable).
3. `businesses` JSON drops from **2.89 MB** to ~1.2 MB.
4. Live UI: Admin → Riders shows Nilesh's photo + Aadhaar; Admin → Catalog →
   "Get Menu" renders `menuBank` thumbnails; Admin → Settings shows the cake
   bot's status images; the customer menu still shows dishes.
5. Guards green: `bot/tests/unit.test.js`, `tests/orchestrator-scope.check.cjs`,
   `tests/encoding-check.mjs`, twins, `test:server-branch`.
6. EC2 redeployed through `tools/server-deploy.sh` (bot + control API).

---

## 5. As built — 2026-11-11 07:40 UTC

**Result: 0 base64 fields left in the entire estate. 65 fields → 65 objects,
1290.1 KB of payload out of RTDB.**

```
businesses   2.89 MB -> 1.19 MB   (-1.70 MB, -59 %)
menuBank      688 KB ->     15 KB  (-673 KB, -98 %)
```

The migration ran with `--apply`: 65 uploads, 65 field rewrites across 22 RTDB
parents, then the tool's own post-checks:

```
rescan: 0 base64 field(s) left
objects verified: 65/65 serve their exact bytes
```

`--verify` (the standing acceptance gate) afterwards:

```
base64 fields left : 0
inline SVG fields  : 23   (not migratable — text, regenerated nightly)
Storage URLs found : 131 (99 unique)
URLs reachable     : 99/99
PASS
```

Browser proof (real Chromium, not just HTTP 200): all **99** unique URLs
rendered as actual images — `naturalWidth > 0` — for every scope
(`menuBank` 6 categories + 22 dishes, each tenant's categories/dishes, cake
`settings` ×3, pizza `riders` ×2, pizza `settings` ×6, pizza combos ×1).
Admin demo → Menu → **Get Menu** showed the 22 migrated `menuBank` photos; the
only placeholders were dishes that never had an image. 0 console errors.

### Two bugs the dry run caught before anything was written

1. **Wrong tenant ref.** The first generalized version built
   `businesses/{bid}/{oid}` (no `/outlets/`), so the outlet scan silently
   returned null and only `menuBank` was found — a run that looked successful
   and would have migrated 28 of 65 fields. The dry-run totals disagreeing with
   the measured inventory (28 vs 65) is what exposed it.
2. **Dead URL check in `--verify`.** `walk()` only collected `data:image/`
   strings, so the "is every Storage URL reachable" pass had nothing to test
   and printed `0/0`. `walk()` now returns every string and the callers filter.

### One deliberate deviation from the plan above

Dedupe is **per target**, not estate-wide. On this data, whole-run dedupe would
have collapsed 65 fields into 33 objects — the 32 duplicates are all
`menuBank` ↔ tenant pairs, i.e. exactly the case where one tenant's
"replace dish photo" (`/tenant-api/delete-image` on the old URL) would delete
an object another tenant's dish still points at. 32 extra objects cost ~774 KB
of a 5 GB bucket; the coupling would cost a support incident.

### Non-changes, restated

- 23 inline SVG fields stay (10.4 KB, text, demo seeder rewrites them nightly).
- No tenant was deleted; `-p5aidfx…` remains a cleanup candidate in observe mode.
- `tools/inventory-media.cjs` deleted — the migration tool's dry run now prints
  the same per-target numbers plus the SVG split, so it is the single source.
  `tools/find-datauri-parsers.cjs` kept: it is the only thing that can re-prove
  §2 if someone later adds a data-URI parser.
- `backup/` added to `.gitignore` (the run's backup is 1.7 MB of base64).

### Egress after (no regression)

`firebase database:profile --raw` (61 s window, stream aborts early — quote the
captured timestamps only): **13.9 KB total → 13.7 KB/min → 19.2 MB/day**, versus
12.3 KB/min after batch 14. Same floor within measurement noise.

The profile is now **entirely** status plumbing: 10.0 KB of the 13.9 KB is
`listener-broadcast` fanout of `businesses/{bid}/outlets/{oid}/bot/status` and
`…/botStatus` (85 events / 61 s, ~110–180 B each, 1–2 listeners). No media path
appears at all. If this is ever worth another pass, the lever is write-on-change
for the status nodes — not the database shape.


