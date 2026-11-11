# 18 — Admin read-cost model: 50 outlets × 10 opens/day × all tabs

**Date:** 2026-11-11
**Question:** 50 outlets, each Admin opened 10×/day with every tab visited — what does that cost, at Roshani Pizza's data scale?

**Answer:** **₹0/month today.** But only because Roshani Pizza is young. Two unbounded listeners turn that same workload into **₹9,300/month at 6 months and ₹19,300/month at 12 months** of normal trading. Three fixes make it flat and permanent.

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

## 4. The three fixes (each is small, together they flatten the curve)

### F1 — Client-side persistence (biggest, ~3 lines)

`Admin/js/firebase.js`, before any database operation:

```js
import { enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
// ponytail: RTDB data survives reloads; 9 of 10 opens become delta-only.
enableIndexedDbPersistence(db).catch((e) => {
  if (e.code === 'failed-precondition') console.warn('[DB] persistence disabled: multiple tabs open');
  else if (e.code === 'unimplemented') console.warn('[DB] persistence disabled: browser unsupported');
});
```

Effect: 9 of every 10 opens serve from IndexedDB and download only deltas — **317 MB/day → ~35 MB/day, a 9× cut**. It also delays every growth cliff by 9×, for free.

Caveat to accept: data renders from cache before the server confirms, and the multi-tab case must fall through gracefully (the `.catch` above).

### F2 — Bound `tableSessions`

`tables.js:2703` is `onValue(_sessRef())` on the whole node. Query `orderByChild('openedAt').startAt(now - 24h)` for the live board, and read historical sessions only when a report asks. Sessions older than 24 h are not actionable on the Tables tab.

Effect: 83 KB → ~15 KB today, and **flat forever** instead of 8.1 MB at 12 months.

### F3 — Chat list without message bodies

Split the list query from the thread read: keep `orderByChild('lastTs').limitToLast(50)` but have `chat.js` render from `meta` only, and attach the messages listener for the one thread the operator clicks.

Effect: 267 KB → ~24 KB per open (−91 %), and message history stops being a per-open cost.

### Projected result with F1+F2+F3

| | per open | per month | bill |
|---|---|---|---|
| today | ~120 KB | 1.7 GiB | **₹0** |
| 12 months | ~130 KB | 1.8 GiB | **₹0** |

Flat. 17 % of the free tier at any age.

---

## 5. Standing notes

- **`orders` is already correct** — `limitToLast(500)` in `orders.js:134` and `tables.js:2723` (the latter carries a comment from a previous fix). Do not "simplify" these back to bare `onValue`.
- **A bounded query is not bounded if the child is a container.** `limitToLast(50)` on `chats` limits *threads*, not bytes. Always ask what one row weighs.
- Opening the app once and switching tabs downloads once — listeners persist across tab switches. The 10×/day model assumes 10 fresh page loads; if operators leave the tab open all day, the real number is ~10× *lower* (paid for in live delta traffic instead, which is small: 50 orders × 700 B = 35 KB/day).
- Long-lived admin tabs poll `/version.json` every 60 s (`shared/app-update.js`) — ~480 requests/day/outlet, a few hundred KB, not a cost driver.
- Free tiers used above: RTDB 0.3515625 GiB/day then ₹95.23/GiB; Hosting 0.3515625 GiB/day then ₹14.2845/GiB (billing account `015AD6-4B5D4F-657177`, INR).

## 6. Reproduce

`node %TEMP%\opencode\admin-node-sizes.cjs` — prints every node's byte size, the all-tabs sum, per-day order growth, and the `walletBilling` size for `roshani-pizza/pizza`. Read-only.
