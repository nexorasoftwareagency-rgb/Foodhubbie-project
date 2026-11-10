# 11 — RTDB Egress Incident (Nov 2026) and the Scale Ceiling

**Status:** fixed and deployed 2026-11-10 (`9a8fc8a` on `main` + `server`, EC2 fast-forwarded `5daa96b → 9a8fc8a`).
**Trigger:** Firebase billing alert — Realtime Database Outgoing Bandwidth, ₹469.36 for 1–10 Nov.

---

## 1. What the bill actually measured

Cloud Monitoring, `firebasedatabase.googleapis.com/network/sent_bytes_count`,
daily totals (ALIGN_SUM, UTC buckets):

| Day | Egress |
|---|---|
| Nov 1 | 1.54 GB |
| Nov 2 | 1.49 GB |
| Nov 3 | 1.82 GB |
| Nov 4 | 1.60 GB |
| Nov 5 | 1.92 GB |
| Nov 6 | 1.89 GB |
| Nov 7 | 2.30 GB |
| Nov 8 | **3.18 GB** |
| Nov 9 | **5.36 GB** |
| Nov 10 (partial at time of fix) | 2.15 GB |

Live rate before the fix (1-minute series): **2.11 MB/min baseline**, with
**6–9 MB bursts roughly every 5 minutes** — about **5.5 GB/day** at the time
of investigation.

For context the live outlet had **188 orders** and one active bot. 2 GB/day is
not order traffic; it was a poll loop.

## 2. Root cause (profiler, not guesswork)

`firebase database:profile -d 90 --raw` captured 88 seconds. **2.07 MB of the
2.11 MB total came from one path**, in two events:

```
28.62s listener-listen 1.04MB /businesses/roshani-pizza/outlets/pizza/bot/promotions/campaigns
28.92s listener-unlisten
28.92s listener-listen 1.04MB /businesses/roshani-pizza/outlets/pizza/bot/promotions/campaigns
29.22s listener-unlisten
```

Those two reads are the bot's **60-second heartbeat** (`bot/index.js`), which
called both promo helpers back to back:

1. `pickupScheduledPromotions()` — `orderByChild('runAt').endAt(Date.now())`.
   **An RTDB range query with only `endAt()` also returns children that lack the
   indexed key** (null sorts first). So every tick downloaded every campaign,
   not just due ones.
2. `expireOldPromoLogs()` — `.once('value')` on the whole campaigns node.

The node was **1.04 MB** because campaign `c_mw80h13z` (created
`2026-11-08T15:52:48Z`, status `paused`, reason `transport-blocked`) stored its
promo image as a **base64 data URI in `mediaUrl`**. That is exactly why the
spike starts on Nov 8 and gets worse on Nov 9.

`2 × 1.04 MB × 1440 ticks/day ≈ 3.0 GB/day` — the single largest line item on
the bill, from a campaign that could never send (promotional sends are
hard-blocked on Baileys).

## 3. What changed

### `bot/promotions.js`
- `pickupScheduledPromotions()`: `.orderByChild('runAt').startAt(1).endAt(now)`.
  `runAt` is a ms epoch, so `startAt(1)` excludes the null bucket. An idle
  outlet now reads ~0 bytes per tick.
- `expireOldPromoLogs()`: no longer reads the whole campaigns node. It queries
  each terminal status (`done`/`stopped`/`expired`/`aborted`) and `paused`
  through the existing `status` index, so it only downloads campaigns it might
  act on.
- Inline media is now dropped from campaigns that can no longer send:
  immediately on `done` and `expired`, and after 24 h on `stopped`/`aborted`
  (an admin may still retry) and on `paused`.
- New `stripCampaignMedia()` writes `mediaUrl: null` plus `mediaStrippedAt` and
  `mediaStripReason`.

### `bot/index.js`
- The expiry sweep is gated to **once every 6 hours**
  (`PROMO_EXPIRY_INTERVAL_MS`). The due-campaign pickup stays at 60 s because it
  is now an indexed query that returns nothing when idle.

### `bot/firebase.js`
- `settings/Bot` gets its own **30-minute** cache TTL. It holds the five status
  images as base64 (~1.35 MB on the live outlet) and was being re-read every
  5 minutes — ~390 MB/day on its own.

### `bot-control-api/status-watcher.js`
- The pm2 → `{bid, oid}` index is built from `outletIndex` (a few KB) and cached
  for 5 minutes, instead of reading the **entire `businesses` tree every 30
  seconds**. Names are read only when an alert actually fires. Outlets missing
  from the registry (E2E tenants, the demo) are resolved from the full tree at
  most once every 6 hours.
- This one was a landmine more than a live leak: the tree is 6.3 MB today and
  mostly base64 images, so a 30-second full read would be ~18 GB/day.

### Data prune
Campaign `c_mw80h13z.mediaUrl` (1.04 MB) was removed after backing the record
up to `%TEMP%/opencode/campaign-c_mw80h13z-backup.json`. The campaign keeps its
recipients, status and pause reason.

## 4. Measured result

| | Before | After |
|---|---|---|
| `bot/promotions/campaigns` node | 1.04 MB | **1.2 KB** |
| Profile window total | 2.11 MB / 88 s | **75.1 KB / 112 s** |
| Campaigns path in profile | 2.07 MB | **0 B** |
| Extrapolated | ~2.1 GB/day (plus bursts) | ~58 MB/day (quiet window) |

`node bot/tests/unit.test.js` → **25/25**, including a new source guard that
fails if the heartbeat goes back to reading the whole campaigns node.

EC2 deploy: `tools/server-deploy.sh`, `5daa96b → 9a8fc8a`; restarted
`webhook-server`, `bot-control-api`, e2e bot and the live pizza bot; 401 gate
passed. Pizza bot booted `[TENANT] outlet=pizza business=roshani-pizza`,
`transport=baileys`, ONLINE as `917485095436`.

## 5. Remaining structural cost (the real 100-outlet ceiling)

The fix removes the poll loop. It does **not** remove base64 images from the
database, which is what makes every unrelated read expensive:

| Node | Size (live outlet) |
|---|---|
| `settings/Bot` (5 status images) | 1.35 MB |
| `dishes` | 673 KB |
| `settings/Store` (banner/logo) | 104 KB |
| `bot/promotions` (now) | ~1 KB |
| whole `/businesses` tree | 6.30 MB |

Per active bot process, cache refreshes alone now cost roughly:

- `dishes` (5-min TTL) 673 KB × 288 = **194 MB/day**
- `settings/Store` (5-min TTL) 104 KB × 288 = **30 MB/day**
- `settings/Bot` (30-min TTL) 1.35 MB × 48 = **65 MB/day**
- ≈ **290 MB/day per outlet**

At the modelled **100 outlets × 50 orders/day**, that is **~29 GB/day** of
database egress before a single customer opens the menu. Customer menu loads
read `dishes` too, so add ~10 GB/day at 3 page loads per order.

**`tools/migrate-images-to-storage.mjs` already exists** (dishes → Storage +
WebP) but is incomplete: it targets `dishes` only (not `settings/Bot` status
images or `settings/Store`), it imports `https://` ESM URLs from Node, and it
needs a real admin password. It has not been run.

**Next structural batch (recommended before onboarding real volume):**
1. Upload all base64 images (dishes, status images, store banner/logo) to
   Firebase Storage and store download URLs in RTDB.
2. Make the Admin upload paths write Storage URLs, so the pattern cannot come
   back.
3. Re-seed the demo tenant from the migrated catalog.
4. Then re-measure: per-bot cache cost should fall to well under 20 MB/day.

Until that ships, the November bill is capped but the model does not scale past
a handful of image-heavy outlets.
