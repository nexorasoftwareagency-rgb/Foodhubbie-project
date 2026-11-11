# 18 — Admin read-cost model: 50 outlets × 10 opens/day × all tabs

**Date:** 2026-11-11
**Question:** 50 outlets, each Admin opened 10×/day with every tab visited — what does that cost, at Roshani Pizza's data scale?

**Answer:** **₹0/month today.** But only because Roshani Pizza is young. Two unbounded listeners turn that same workload into **₹9,300/month at 6 months and ₹19,300/month at 12 months** of normal trading. Two fixes make it flat and permanent — while a third, the obvious one, turned out to be impossible on this build (§4).

---

## 1. Measured inputs (live, not modelled)

`admin-node-sizes.cjs` against `businesses/roshani-pizza/outlets/pizza`:

| | |
|---|---|
| Whole outlet | **618.3 KB** |
| Orders | 188 docs → 128.6 KB |
| Table sessions | 158 docs → 83.2 KB |
| Chats | 24 threads → **267.2 KB** |
| Dishes / categories / combos | 22 / 6 / 4 → 11.9 KB |
| Customers | 14 → 14.7 KB |
| Tables / staff / riders | 5 / 6 / 2 → 5.3 KB |
| Settings + bot + ui | 10 + 10 + 6 → 34.2 KB |
| `walletBilling` | 1.5 KB |

Average order doc: **700 B**. Average session: **526 B**. Average chat thread: **11.1 KB**.

### What "all tabs" actually downloads

| Surface | Bytes | Bounded? |
|---|---|---|
| `chats` (Chat) | 267.2 KB | ⚠️ `limitToLast(50)` but **messages are inline**, so each thread's full history comes down |
| `orders` (Orders/KDS/Tables/Reports) | 128.6 KB | ✅ `limitToLast(500)`, `orderByChild('createdAt')` |
| `tableSessions` (Tables) | 83.2 KB | ❌ **unbounded `onValue`** |
| `customers` | 14.7 KB | unbounded |
| `guests` + `tableRequests` | 24.1 KB | unbounded |
| `tableSessionsContact` | 9.5 KB | unbounded |
| `inventory-log` | 9.5 KB | unbounded |
| `dishes` + `categories` + `combos` | 11.7 KB | ✅ (catalog is small by nature) |
| everything else (settings, bot, audit, loyalty, riders, staff, promotions, expenses, pushInbox, discounts…) | ~43 KB | mixed |
| **Total per cold open** | **~590 KB** JSON | |
| **+ RTDB protocol framing (~10 %)** | **~650 KB on the wire** | |

Only two listeners matter: `chats` (45 %) and `tableSessions` (14 %). Orders, which people assume is the expensive one, is already capped.

**`Admin/js/firebase.js` never calls `enablePersistence`.** Every page load starts from an empty cache and re-downloads all of the above.

---

## 2. The bill at today's data

500 opens/day (50 × 10). 650 KB each.

| | per day | per month |
|---|---|---|
| RTDB egress | 317 MB | **8.9 GiB** |
| Hosting (1 cold 0.55 MB + 9 warm ~0.08 MB per outlet/day) | 63 MB | 1.8 GiB |

| | used | free tier | bill |
|---|---|---|---|
| RTDB | 8.9 GiB | 10.5 GiB | **₹0** (84 % consumed) |
| Hosting | 1.8 GiB | 10.5 GiB | **₹0** (17 % consumed) |
| **Total** | | | **₹0/month** |

Comfortable — but 84 % of the RTDB allowance with a 4-day-old dataset is not a margin, it is a countdown.

---

## 3. The cliff

Sessions and chat threads both grow forever and both sit on unbounded listeners. At 50 orders/day (≈42 sessions/day, matching Roshani's 158-session / 188-order ratio):

| Age of outlet | sessions | per-open `tableSessions` | per-open `chats` (500 msgs/thread) | per open (wire) | RTDB/month | bill |
|---|---|---|---|---|---|---|
| today | 158 | 83 KB | 267 KB | 0.65 MB | 8.9 GiB | **₹0** |
| 6 months | 7,644 | 4.0 MB | 2.8 MB | 7.8 MB | 108 GiB | **₹9,300** |
| 12 months | 15,330 | 8.1 MB | 5.5 MB | 15.3 MB | 213 GiB | **₹19,300** |

Chat growth is the sharper edge: `chat.js:362` queries `orderByChild('lastTs').limitToLast(50)` and gets **whole thread objects, messages included**. Ten thousand messages of history per active customer rides along on every single open.

**This is the same failure mode as the ₹469 RTDB incident** — an unbounded read multiplied by a periodic trigger. There the multiplier was a 60 s sweep; here it is 500 daily opens.

---

## 4. Fixes — and one that looked obvious and is impossible

### F1 — Client-side persistence: **impossible on this build** (verified, do not retry)

The standard fix is `enableIndexedDbPersistence(db)` so repeat opens read from IndexedDB and download only deltas. **It cannot be used here.** Admin imports the Firebase SDK from the gstatic CDN, and that browser bundle contains no IndexedDB persistence code at all:

| build | `indexedDB` in file | `enableIndexedDbPersistence` export |
|---|---|---|
| 10.7.1 ESM (the one we use) | absent | **no** |
| 10.7.1 compat | absent | no |
| 11.10.0 ESM / compat | absent | no |
| 12.0.0 ESM / compat | absent | no |

Verified by fetching each file and searching it. `firebase-database.js` 10.7.1 (182 KB) has **zero** dynamic imports and exactly one static import (`firebase-app.js`), so there is no lazily-loaded persistence chunk either — the CDN build ships only the `persistenceKey` config plumbing.

Tried in a real browser before shipping: the import throws `The requested module ... does not provide an export named 'enableIndexedDbPersistence'`, which takes the entire `firebase.js` module down — the app renders its static shell but **cannot talk to the database at all** (0 bytes over the WebSocket, 41 nav entries, no data). Reverted; app re-verified healthy (402 KB over WebSocket, sign-in and order data intact, 0 page errors on the demo tenant).

Getting persistence would mean importing the SDK from npm through a bundler instead of the CDN. `tools/build.mjs` only minifies today, so that is a build-system change (bundler, module graph, loss of CDN caching) — not worth it, because F2 below removes 96 % of the same bytes for less work.

**Do not re-add this import.** If persistence is ever wanted, bundle the SDK first.

### F2 — Give `chats` a meta-only mirror (96 % of the problem)

Measured split across the 24 live threads:

| part | bytes | note |
|---|---|---|
| `meta` | **9.4 KB** | 0.39 KB/thread — `lastDir`, `lastText`, `lastTs`, `name`, `phone`, `unread` |
| `messages` | **257.1 KB** | **96 %** of all chat bytes |

`chat.js:362` does `onValue(chats.orderByChild('lastTs').limitToLast(50))`. RTDB queries cannot select a sub-path per child, so any query on `chats` drags `messages` along — `limitToLast(50)` bounds *threads*, not bytes.

This is a data-shape change, not a query tweak: the bot already writes `chats/{id}/meta/lastText|lastTs|unread` on every message, so also mirror it to a flat `chatIndex/{customerId}` node. Admin listens to `chatIndex` for the list — the preview still works, because `lastText` lives in `meta` — and attaches the `messages` listener only for the thread an operator actually opens. Backfill once from each thread's existing `meta`.

Effect: **267 KB → 9.4 KB (−96 %)**, and message history stops being a per-open cost permanently.

Cost: bot write + Admin read + a backfill. The highest-value fix in the model.

### F3 — Bound `tableSessions`

`tables.js:2703` is `onValue(_sessRef())` on the whole node, and nothing ever deletes a session. Query the live board by `openedAt` within the last 24 h (needs `.indexOn` in `database.rules.json`), and read history only when a report asks for it.

Effect: 83 KB → ~15 KB today, and **flat forever** instead of 8.1 MB at 12 months. Smaller win than F2, and a smaller change.

### Projected result with F2 + F3

| | per open | per month | bill |
|---|---|---|---|
| today | ~290 KB | 4.1 GiB | **₹0** |
| 12 months | ~300 KB | 4.2 GiB | **₹0** |

Flat at ~40 % of the free tier at any age, with no build-system change.

---

## 5. Standing notes

- **`orders` is already correct** — `limitToLast(500)` in `orders.js:134` and `tables.js:2723` (the latter carries a comment from a previous fix). Do not "simplify" these back to bare `onValue`.
- **A bounded query is not bounded if the child is a container.** `limitToLast(50)` on `chats` limits *threads*, not bytes. Always ask what one row weighs.
- **The Admin SDK is CDN-loaded, and the CDN build has no IndexedDB persistence** (any version, ESM or compat). Any "just enable offline persistence" advice does not apply to this codebase. See F1.
- Verified cold-load data point after the revert: the **demo** tenant (353 `DD-` orders, 22 dishes, 4 combos) pulls **402 KB** over the RTDB WebSocket in 48 frames — same order of magnitude as the 590 KB Roshani estimate, which is the sanity check the model needed.
- Opening the app once and switching tabs downloads once — listeners persist across tab switches. The 10×/day model assumes 10 fresh page loads; if operators leave the tab open all day, the real number is ~10× *lower* (paid for in live delta traffic instead, which is small: 50 orders × 700 B = 35 KB/day).
- Long-lived admin tabs poll `/version.json` every 60 s (`shared/app-update.js`) — ~480 requests/day/outlet, a few hundred KB, not a cost driver.
- Free tiers used above: RTDB 0.3515625 GiB/day then ₹95.23/GiB; Hosting 0.3515625 GiB/day then ₹14.2845/GiB (billing account `015AD6-4B5D4F-657177`, INR).

## 6. Reproduce

| Script (`%TEMP%\opencode`) | Proves |
|---|---|
| `admin-node-sizes.cjs` | every node's byte size, the all-tabs sum, per-day order growth, `walletBilling`. Read-only. |
| `chat-shape.cjs` | the `meta` vs `messages` split that decimals F2 (9.4 KB vs 257.1 KB) |
| `verify-persistence.cjs` | the failed F1 attempt — counts real RTDB WebSocket bytes across cold load, reload, and a second tab. Reusable as a general "did this reduce reads?" harness. |
| `verify-revert.cjs` | app liveness after a revert (nav entries, sign-in, real order data, WebSocket bytes > 0, page errors) |
