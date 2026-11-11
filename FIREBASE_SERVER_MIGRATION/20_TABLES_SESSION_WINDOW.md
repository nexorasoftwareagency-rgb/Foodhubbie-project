# 20 — Bounded `tableSessions` read in the Admin Tables tab (F3)

Status: built, verified, deployed 2026-11-11.
Scope: `Admin/js/features/tables.js` only — no rules, no writer, no bot, no migration.

## 1. What was being downloaded

`_attachListeners()` bound `onValue(_sessRef())` — the **whole** `tableSessions`
node — and re-downloaded it on every write to that node (a QR scan, a heartbeat
`expiresAt` touch, an order attach, a bill request, a payment). Measured on the
live outlet `businesses/roshani-pizza/outlets/pizza`:

```
sessions total          159 docs   83.7 KB
```

Average doc 0.5 KB, heaviest field `orderGroups` (21 %). Nothing in the tab
reads history: there is no session-history view. The tab needs

* the **live** sessions (floor grid, drawer, KDS, `_policeExpiredSessions`), and
* **today's** sessions (the "Revenue today" KPI sums `paidAt >= todayStart`).

So the node was being read in full for a subset that is bounded by the day.

## 2. The lifetime policy (an explicit non-change here)

The owner's stated policy is: **a session that gets an order has a 24-hour
window to close; a QR scan with no order auto-closes in 2 hours.** It is *not*
what the code does today — all four writers use the same 2-hour TTL:

| `menu/js/session.js` | write | TTL |
|---|---|---|
| 145 | `createSession` | `now + 7200000` |
| 457 | `attachOrderToSession` (order placed) | `now + 7200000` — refreshes, does not extend |
| 485 | `touchSession` heartbeat (60 s while the app is open) | `now + 7200000` |
| 526 | `saveCheckoutContact` | `now + 7200000` |

Implementing the split changes order auto-cancellation and table freeing
(customer-facing), so it is a **separate batch** by owner decision. This batch
is read-only and sizes its window to be correct **either way** — see §3.

## 3. Design: 25-hour window + a live tail for linked outliers

```js
const SESSION_WINDOW_MS = 25 * 60 * 60 * 1000; // 24h max lifetime + 1h margin

_sessionsListener = onValue(
    query(_sessRef(), orderByChild('openedAt'), startAt(Date.now() - SESSION_WINDOW_MS)),
    ...
);
```

Why 25 h and not 2 h: the **"Revenue today" KPI spans midnight**. At 00:01 a
session paid a minute ago may have opened 24 h earlier (if the 24 h rule ships).
25 h covers the whole current day plus margin under either policy. A 2 h window
would silently under-count today's revenue.

Twenty-five hours alone is not sufficient, because a session can outlive it
without being `active` — a **`billing` bill is never auto-expired**
(`_policeExpiredSessions` only touches `status === 'active'`). If staff leave a
bill open past the window, the table still points at it. So:

```js
_syncExtraSessions()
  // for every tables/*/currentSession not in the window:
  //   one onValue(tableSessions/{id}) tail, released when the table is freed
```

* The tail is **bounded by the floor plan** (one listener per linked session
  that is outside the window — normally zero), never by history.
* A table change re-runs the sync; a window snapshot re-applies the reconciled
  values (`_applyExtraSessions`) and releases any duplicate tail.
* `cleanupTables()` releases every tail.

No rules change: `tableSessions` already declares
`".indexOn": ["status", "openedAt", "tableId"]` (`database.rules.json:492`),
so the query is server-side.

## 4. Measured result (live, 2026-11-11)

```
LIVE pizza (roshani-pizza/pizza)
  OLD listener            159 docs   83.7 KB   <- on every write
  NEW 25h window            1 doc     0.5 KB
  reduction                          171x
  tables linked sessions    1        outside window: 0
  no numeric openedAt       0

DEMO (foodhubbie-demo/demo)
  OLD                       6 docs   2.2 KB
  NEW                       6 docs   2.2 KB   (all opened today, correctly inside)

E2E outlet                  0 docs   0 KB
```

Cost model (50 outlets × 10 Tables opens/day, Roshani scale):

```
  old:  41,832.5 KB/day   (~41.8 MB/day)
  new:     244.6 KB/day
```

More important than the daily number: the old read grew with **history**
(batch 18 measured the 6/12-month cliffs at ₹9,300/₹19,300 per month across the
estate), while the new read is a function of **sessions per day** and stays flat.

The wire proof from the browser (Playwright, client→server frame):

```json
{"t":"d","d":{"r":21,"a":"q","b":{"p":"/businesses/foodhubbie-demo/outlets/demo/tableSessions",
 "q":{"sp":1794308371960,"sin":true,"i":"openedAt"},"t":2,"h":""}}}
```

`i` = index (`openedAt`), `sp` = startAt value, `sin` = inclusive. No
whole-node listen is opened.

## 5. Correctness — what consumes `_sessions`

Everything is preserved by construction, because the window is a superset of
what the tab rendered before:

| consumer | needs | covered by |
|---|---|---|
| `_renderKpis` active sessions/guests/avg time | sessions linked to a table | window + tail |
| `_renderKpis` revenue today (`paidAt >= todayStart`) | today's sessions | 25 h window |
| floor grid / drawer / bill review | the linked session | window + tail |
| `_renderKDS` / live orders | `orders` listener (unchanged, `limitToLast(500)`) | — |
| `_policeExpiredSessions` | `active` sessions past `expiresAt` | window + tail |

## 6. Verification

* **Live payload measurement** (`f3-measure.cjs`, admin SDK, read-only):
  83.7 KB → 0.5 KB on live pizza; demo unchanged; zero sessions missing a
  numeric `openedAt`; zero linked sessions outside the window.
* **Browser E2E 17/17** (`f3-e2e.cjs`) on the built shell served locally
  (`tools/serve-dist.cjs admin`, real Firebase, demo tenant only):
  exactly one bounded query frame; `startAt ≈ now − 25 h`; no whole-node
  listen; KPI sessions/guests = seeded baseline; **reconciliation:** a session
  with `openedAt = now − 30 h` linked live to a free table appears without a
  reload (KPI +1 session, +7 guests, card `0 Orders · 1800 min`, drawer opens
  it); after freeing the table the KPI returns to baseline and the card is
  gone; a Tables → Dashboard → Tables hop re-attaches cleanly; 0 page errors,
  0 console errors. Fixture (`sess_f3_recon` + `table_04`) restored
  byte-identically.
* **Guard** `tests/tables-session-window.check.cjs` (8 checks,
  `npm run test:tables-window`, CI step). Mutation self-test: restoring the old
  `onValue(_sessRef())` makes 2 checks fail (exit 1).
* `node --check` (ESM copy), encoding, query-chain (142 files), shared twins 8/8.

## 7. Limits (honest)

* A tab left open for days keeps every session created **after** it opened
  (the `startAt` is fixed at attach). That is a function of tab uptime, not of
  history; an admin reload returns to one day.
* A session opened **more than 25 h ago** and paid **today** without being
  linked to a table at read time is not in "Revenue today". This is a narrow
  edge (the bill is normally linked until it is closed, which is when `paidAt`
  is written) and it sits on top of a much larger pre-existing gap: 101 of 159
  live sessions carry no `paidAt` at all.
* The reconciled tail is live but not part of the windowed snapshot; if the
  table keeps pointing at the session it stays correct. If the pointer is
  cleared, the tail is released and the session leaves the UI — which is the
  same behaviour as before.
* No history view exists, so nothing is lost. If a "past sessions" screen is
  ever added it must query on its own (bounded) terms.

## 8. Deploy

Frontend only (`hosting:admin`); `Admin/sw.js` → `v5.12.46`. `server`/EC2
unchanged (the `server` branch is fast-forwarded to satisfy the
`check-server-branch` invariant). Live numbers in `AGENTS.md`.

## 9. Reproduce

```bash
node tests/tables-session-window.check.cjs
node tools/build.mjs --admin
node tools/serve-dist.cjs admin          # http://localhost:5055/index.html?demo=1
$env:NODE_PATH="D:\Foodhubbie Project\node_modules"
node f3-measure.cjs                       # live payload, read-only
node f3-e2e.cjs                           # 17 checks, fixtures auto-removed
```
