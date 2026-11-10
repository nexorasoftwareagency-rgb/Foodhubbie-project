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

## 6. Second finding: the full `businesses` read on every reconnect (2026-11-10)

The campaign fix and the orchestrator rewrite both landed, and the 5-minute
spike **did not move**. `firebase database:profile --raw` kept showing a single
`listener-listen` on `businesses` of **5,276,512 bytes** from the EC2 box
(`3.111.39.210`), and the egress metric kept showing ~3 MB + ~2 MB every
4-5 minutes.

### How it was attributed

Guessing from source was wrong twice (the orchestrator's listener and
`status-watcher`'s fallback were both suspects and both innocent). What worked
was per-process socket accounting on the box:

```bash
sudo ss -tnpi   # bytes_received per socket + users:(("node ...",pid=N))
```

Diffing `bytes_received` per `(pid, socket)` every 5 s named the process:

```
t=90s pid=1466878 +5.06 MB   node /var/www/foodhubbie/bot/index.js
```

pid 1466878 was `bot-e2e-biz-1792987605261-e2e-outlet-1792987605261`. Its
cumulative receive went **30.37 MB -> 35.44 MB** while the neighbouring pizza
bot stayed flat at 5.71 MB since boot. Two operational traps: `ss` prints
`users:(pid=...)` on the **head** line and `bytes_received:` on the indented
netem line (line-scanning gets neither), and a read can complete between
samples, so new sockets must be counted on first sighting.

### Root cause

`bot/index.js` `startBot()` calls `initializeOutletBusinessIndex(db)` as its
first statement, and that helper does:

```js
db.ref('businesses').once('value')   // the WHOLE tree - 5.0 MB live
```

`startBot()` is not boot-only: both disconnect handlers schedule it again
(`index.js:2429` and `3059`). So **every Baileys reconnect re-downloaded the
entire database tree** to rebuild a lookup table that could not have changed.

The e2e worker's Baileys socket is dead and reconnects roughly every five
minutes, which is the exact measured cadence. The pizza worker's socket is
healthy, which is why it read once and stayed flat - the bug was invisible on
the outlet that mattered until a worker started flapping.

Cost: 5.06 MB x 12/hour x 24 = **~1.5 GB/day from one flapping worker**, and it
**multiplies by outlet count** because every outlet's images live in the same
tree. This was the bulk of the Rs 469 Nov 1-10 bill.

### Fix (commit `1fe9870`)

The reverse index maps outlet -> businessId and is immutable for the process
lifetime, so `initializeOutletBusinessIndex()` is now idempotent: it returns
immediately once built, and sets the flag only after a successful build so a
failed first attempt still retries. One guard in the shared helper, not a
guard at each of the three call sites.

Verified live after deploy: the e2e worker logged `[outlet-resolution]
Initialized reverse index with 40 outlets` **once** while printing `[TENANT]`
**twice** (boot + one reconnect) - the reconnect path now skips the read.

Guard: `bot/tests/unit.test.js` asserts repeat calls perform **zero** Firebase
reads.

### Measured before and after

Per-PID `ss -tnpi` attribution on the box, same tool, same window length:

| | before `1fe9870` | after `1fe9870` |
|---|---|---|
| e2e worker (the flapping one) | `t=90s pid=1466878 +5.06 MB` | `0.01 MB in 470 s` (2 MB/day) |
| pizza worker | flat since boot | 0.11 MB in 470 s (20 MB/day, normal traffic) |
| control API | 10.95 MB cumulative | 0.17 MB in 470 s (31 MB/day) |
| **all processes, 470 s** | ~5 MB every 5 min | **0.29 MB total** |

The e2e worker's cumulative receive was **35.44 MB** before the fix and
**5.08 MB** after a fresh restart - it now pays for exactly one boot read. Its
pointer in `startBot()` still runs on every reconnect; only the tree download
is gone.

The billing metric agrees. Minute-by-minute `sent_bytes_count` before the
deploy, repeating every 5 minutes:

```
19:52  3.77 MB     19:58  3.76 MB
19:53  1.37 MB     19:59  1.75 MB
19:56  35.1 KB     20:00  191.8 KB
19:57  35.2 KB     20:01  4.21 MB   <- deploy starts
```

and after (the 20:02/20:03 burst is the four process restarts):

```
20:02  16.66 MB   20:08  120.8 KB
20:03   5.48 MB   20:09   62.8 KB
20:04   41.3 KB   20:10   39.3 KB
20:05   36.2 KB   20:11   39.1 KB
20:06   61.7 KB   20:12   40.5 KB
20:07  160.7 KB
```

Residual is **~67 KB/min = ~96 MB/day** against **~3.24 MB/min = 4.67 GB/day**
before: a **~48x** reduction. What is left is ordinary traffic (heartbeat
writes, admin dashboard listeners, menu reads), not a poll loop.

### Measurement caveat (settled)

`gcloud`'s `sent_bytes_count` summed across series reads ~3x higher than the
profiler for the same window (4.7 GB/day vs ~1.5 GB/day). The bill matches the
profiler, so quote the profiler, and check the series count before trusting a
raw metric total.

### Also removed

Root's pm2 daemon (`/root/.pm2`) still ran `bot-roshani-cake-cake` (pid 132705,
2 months old) - the worker AGENTS.md records as deleted on 2026-10-27. It had
been deleted from *ubuntu's* pm2 only. Removed with
`sudo pm2 delete bot-roshani-cake-cake`; there is no `pm2-root` systemd unit, so
it cannot resurrect. It was not the egress source (0.25 MB) but it was a second
Baileys session for a deleted tenant and a Redis client, both of which only
invite trouble.
