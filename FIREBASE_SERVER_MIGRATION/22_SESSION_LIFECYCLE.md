# 22 — Dine-in session lifecycle: 3 h scan / 24 h order / free on payment

Status: built, verified live, deployed 2026-11-12.
Owner decision (2026-11-12): **"recomended + 2hr to 3hrs"** — the literal 24 h
lock with auto-close on full payment, and the scan-with-no-order window raised
from 2 h to 3 h.

Scope: `menu/js/session.js` (the four TTL writers), `Admin/js/features/tables.js`
(the expiry sweep + the multi-bill auto-close). No rules change, no bot change,
no migration.

Builds on batch 20 (`20_TABLES_SESSION_WINDOW.md`), which had already bounded the
Admin `tableSessions` read to 25 h and flagged this policy gap as "a separate
batch".

## 1. The bug the old timer shipped

Every writer used one flat TTL:

| `menu/js/session.js` | write | old TTL | new TTL |
|---|---|---|---|
| `joinOrCreateSession` | create (a QR scan landing on a free table) | 2 h | **3 h** |
| `attachOrderToSession` | an order joined the bill | 2 h | **24 h** |
| `touchSession` | heartbeat on an app tap | 2 h | follows the session |
| `saveCheckoutContact` | contact saved at checkout | 2 h | follows the session |

`touchSession()` is called from **8 user-action sites only** — there is no
interval. A party that orders and then eats for two hours without tapping the
phone goes idle, and `_policeExpiredSessions()` then did this:

```js
// old
orderIds.forEach(oid => {
    if (paidOrderIds.has(oid)) return;
    update(_ordersRef(oid), { status: 'Cancelled', cancelledReason: 'Session expired' });
});
```

It cancelled **every** unpaid order in the session — `Placed`, `Preparing`,
`Ready`, **and `Served`**. That is not a phantom cleanup, it is revenue
deletion, because `_billSubtotal()` ignores cancelled orders:

```js
return orders.filter(o => o.status !== 'Cancelled')
             .reduce((sum, o) => sum + Number(o.total || 0), 0);
```

So a table that had eaten ₹1,400 worth of food past the timer showed a **₹0
bill**: the food was served, the guests were still sitting there, and staff
could no longer collect it. The KDS card vanished at the same time, so nobody
was prompted to check.

Two more defects in the same sweep:

* it only matched `status === 'active'`, so a session in **`billing`** (bill
  requested, never paid) was **never** expired and its table was blocked for
  ever;
* it ran only inside the Admin Tables tab (`setInterval(..., 30000)`), so with
  the dashboard closed nothing expired at all — the opposite failure.

## 2. What shipped

### 2.1 Two windows, chosen by whether the session has an order

```js
export const SCAN_WINDOW_MS  = 3 * 60 * 60 * 1000;   // scanned, nothing ordered
export const ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;  // the bill must survive the meal
export function sessionWindowMs(hasOrders) { return hasOrders ? ORDER_WINDOW_MS : SCAN_WINDOW_MS; }
```

* creation → `sessionWindowMs(false)` (3 h)
* an order attaching → `sessionWindowMs(true)` (24 h)
* the two extenders (`touchSession`, `saveCheckoutContact`) follow whatever the
  session already holds via a local `_sessionHasOrders()` mirror, so a heartbeat
  can never shorten a 24 h bill back to 3 h.

A no-order scan therefore frees its table in 3 h; a real meal keeps the bill for
24 h.

### 2.2 The sweep never cancels a served order

```js
const POLICEABLE_STATUS = new Set(['active', 'billing']);
```

* `billing` is now covered, so a stuck bill no longer blocks the table for ever.
* Unreached orders (`Pending`/`Placed`/`Preparing`/`Ready`) are still cancelled
  with `cancelledReason: 'Session expired'` — the kitchen must not keep cooking
  for an abandoned table.
* **`Served` / `Delivered` are skipped**: the food was eaten, so that is a debt,
  not a phantom. `checkAndRecordWalkout()` then records it in `logs/walkouts`
  (`reason: 'Session expired with unpaid orders'`, subtotal, order ids) and flips
  the orders to `status/paymentStatus = 'Walkout'`.
* The walkout is recorded **before** the table pointer is cleared, because
  `checkAndRecordWalkout` resolves the session through the table.
* `Walkout` orders are excluded from the dine-in KDS queue (`_dineInOrders`), so
  they stop nagging the kitchen but stay in the record.

### 2.3 The last paid group frees the table

Full-table payment already closed the session and freed the table in one atomic
multi-path update. A **multi-bill** (order groups) had no such path: each group
paid independently and the session stayed open, so with a 24 h window the table
would have looked occupied for the rest of the day.

`_freeTableIfLastGroupPaid(tableId, sess, paidGroupId, now)` runs after a
successful group payment and, only when every non-empty group is paid, writes
`session.status='closed'` + `closedAt` and `tables/{id} = free, currentSession=null`.
The group that was just paid is overridden locally, because the live listener may
not have delivered its own write yet. A failure to close is logged and never
reported as a failed payment — the money is already recorded and staff can still
close the table by hand.

`window.__tables.policeExpiredSessions` was added so an operator (or an E2E) can
run the sweep without waiting for the 30 s tick.

## 3. Live verification — 30/30

`e2e-session-lifecycle.cjs` (Playwright + Admin SDK) against the demo tenant with
the real rules, the admin build served locally (`tools/serve-dist.cjs admin`,
5055) and the unbuilt menu source (`menu`, 5057). Every node touched is backed up
first and restored byte-identically at the end.

| # | scenario | result |
|---|---|---|
| S1 | fresh QR scan on `table_03`, add a dish to the cart, no order | session `active`, `expiresAt` in **3.000 h** |
| S2 | place the order | `expiresAt` in **24.000 h**, order `Placed` ₹130.91 |
| S3 | seeded session 3 h old, `expiresAt` in the past, one **Served/Unpaid** ₹250 order | order → **`Walkout`** (not `Cancelled`), session `expired` + `expiredAt`, `orders` cleared, table **free**, walkout row with `subtotal 250` and reason "Session expired with unpaid orders" |
| S4 | two-group `billing` session on `table_08` | paying group A: group `paid`, table still `billing`, session still open; paying group B: session `closed` + `closedAt`, table **free**, `currentSession null`, both orders `Paid` |

Assertions after cleanup: `tables` node byte-identical, `logs/walkouts`
restored, no leftover sessions/orders/contacts, 0 page errors and 0 console
errors on both surfaces.

Guard: `tests/session-lifecycle.check.cjs` — **16 checks**
(`npm run test:session-lifecycle`, CI step). It pins the two windows, the four
writer call sites, the absence of the old `7200000` literal, `POLICEABLE_STATUS`,
the served-order skip, walkout-before-pointer-clear, `_freeTableIfLastGroupPaid`
and its call site, the untouched full-table payment path, and the KDS exclusion.
Mutation self-test against `git show HEAD:` copies of both files fails **14/16**
(the two that still pass are genuinely pre-existing behaviours:
`cancelledReason` and the full-table payment block).

Other gates: `tables-session-window` 8/8, `admin-query-chain` 142 files,
`menu-cart-refresh` OK, encoding (no BOM/C1/mojibake), `tools/build.mjs --admin`.

## 4. Why 3 h / 24 h and not something else

* **3 h for a scan with no order**: long enough that a party browsing the menu
  slowly, or a table that scanned while waiting to be seated, is not kicked out
  mid-decision; short enough that an abandoned scan frees the table the same
  evening. The previous 2 h was the owner's complaint.
* **24 h once an order exists**: exactly the owner's stated policy. It is
  deliberately longer than any meal, because the failure mode it replaces (a
  ₹0 bill for served food) costs money, while a table held an extra hour costs
  nothing that the auto-close and the 3 h scan window do not already handle.
* **Payment is the real terminator**: full-table payment closes and frees
  atomically, and now the last group of a split bill does too, so the 24 h limit
  only ever touches tables staff never settled.

## 5. Limits (honest)

* **The next party can join an unsettled table within its 24 h window.**
  `joinOrCreateSession` joins any session that is not `closed`/`expired`. With a
  longer window this is more likely: a table whose party left without paying
  shows the previous party's bill to whoever scans next. This is the accepted
  cost of the owner's option A; the mitigations are the auto-close on payment,
  the walkout path, and staff closing the table. A shorter window would instead
  bring back the revenue bug.
* **The sweep still only runs while the Admin Tables tab is open** (30 s tick).
  With a 24 h window this matters much less — an expired session waits for the
  next dashboard open instead of killing a live bill — but it is not a server
  job. Moving expiry into a Cloud Function is a separate batch, and it would need
  a decision on who pays for the invocations.
* **A cancel while the dashboard is closed is not replayed** — unchanged,
  pre-existing (`child_changed`-only listeners on the bot side are unrelated;
  this is the Admin-side sweep).
* **`Walkout` is counted in `_billSubtotal`** (only `Cancelled` is excluded), so
  a walkout bill can still be settled if the guest returns. It is excluded from
  the KDS queue only.
* Demo tenant sessions are seeded with `status: 'open'` and no `expiresAt`, which
  the sweep deliberately ignores — fixtures, not a supported state.

## 6. Deploy

Frontend only: `hosting:admin` + `hosting:menu`.
`Admin/sw.js` → `foodhubbie-erp-shell-v5.12.47`, `menu/sw.js` → `menu-shell-v64`.
`server`/EC2 unchanged (the `server` branch is fast-forwarded to the commit only
to satisfy the `check-server-branch` invariant).

**Customer-visible change to flag to outlets:** a table that orders is no longer
released after 2 h, and a table with no order is released after 3 h instead of
2 h. Nothing is cancelled before its window, and served food is never cancelled
at all.

## 7. Reproduce

```bash
node tests/session-lifecycle.check.cjs
node tools/build.mjs --admin
node tools/serve-dist.cjs admin     # http://localhost:5055/index.html?demo=1
node tools/serve-dist.cjs menu      # http://localhost:5057/index.html?b=…&o=…&t=…
node e2e-session-lifecycle.cjs      # 30 checks; fixtures restored
```
