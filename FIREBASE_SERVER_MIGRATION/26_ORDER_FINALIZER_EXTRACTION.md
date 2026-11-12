# 26 — Web/app order finalizer extracted, socket-free (batch 23b)

Status: **code complete and verified against the live database; not yet running on
the box** — EC2 has been unreachable since 2026-11-11 20:03 IST
(`23_BOX_OFFLINE_INCIDENT.md`), so `bot/index.js` cannot be restarted. The module
itself was driven end to end against the production RTDB with the production
wiring; the in-bot wiring is source-guarded and ships with the next
`tools/server-deploy.sh` run.

## 1. Why this batch exists

`menu/js/delivery.js` and `menu/js/app-checkout.js` write orders straight to
Firebase from the customer's browser, so every money field on them is a claim.
The server's answer — re-price lines from the catalog, re-derive tax + delivery
fee from the outlet's settings, re-run the discount, burn a reward code, deduct
stock — lived **inline in `bot/index.js`**, a 3,000-line file that opens a
Baileys socket, a Redis client and a privileged Firebase app at import time.

Batch 23c needs that exact pipeline as a 2nd-gen RTDB trigger in Cloud
Functions. Nothing can `require()` `bot/index.js` there without dragging the
whole WhatsApp runtime into the bundle. So the pipeline moves out first, behind
injected dependencies, **with no behaviour change** — this batch is a pure
extraction. Only after 23c proves the module in shadow mode does the trigger
become authoritative.

## 2. What shipped

### `bot/order-finalizer.js` (new, 607 lines)

```js
const finalizer = createOrderFinalizer({
  db, getData, updateData, resolvePath, saveUserProfile,
  getLoyaltyConfig, discountEngine, orderPricing,
  notify?,            // WhatsApp new-order alert — optional
  defaultOutlet,
});
```

Returns:

```
finalizeWebOrder({ orderId, order, sock })
restoreOrderInventory(orderId, order)
deductInventoryStock(sock, items, outlet)
verifyRewardTender(orderId, order, outlet)
serverTaxRates(outlet)
serverDeliveryFee(order, outlet)
verifiedOrderTotals({ subtotal, discount, taxItems, taxRates, claimedTax, serviceCharge, deliveryFee })
```

Rules the module obeys, and that the guard enforces:

* imports **only** `./utils` plus the pure `../shared/*` math
  (`money-math`, `geo/geo`, `loyalty-math`), all guarded — a partial deploy
  warns and falls back rather than throwing;
* no Baileys, no Redis, no `./firebase`, no `./index`, no `./helpers`, no
  `./promotions`;
* every DB/socket capability is an injected dep; a missing one throws at build
  time (`order-finalizer: missing required dep "<name>"`) instead of failing a
  customer order at runtime;
* `sock` + `notify` are optional and never load-bearing: a dead socket cannot
  swallow a tender, a stock deduction or the discount-usage flag.

`finalizeWebOrder` returns a compact record —
`{ok, priceChanged, discount, total, tax, taxName, inventoryDeducted, tender, discountUsageRecorded}` —
explicitly so 23c can run the module in shadow mode and compare its verdict with
the order the live bot produced, without diffing whole order trees.

### `bot/index.js`

* 496 lines removed, 59 added: the local `deductInventoryStock`,
  `restoreOrderInventory`, `_serverTaxRates`, `_serverDeliveryFee`,
  `_verifiedOrderTotals`, `verifyRewardTender` and the ~206-line inline
  finalization block are gone.
* `child_added` → `orderFinalizer.finalizeWebOrder({ orderId, order, sock: currentSock })`.
* `child_changed` → `orderFinalizer.restoreOrderInventory(snap.key, order)`.
* The QR dine-in verifier keeps its own discount re-evaluation but reuses
  `orderFinalizer.serverTaxRates(OUTLET)` and `orderFinalizer.verifiedOrderTotals(...)`
  — one definition of the tax math for dine-in and delivery.
* Construction site passes all 9 deps plus the WhatsApp alert as `notify`; the
  require is guarded, so a broken/missing module logs
  `[WebOrder] order-finalizer failed to load` and the WhatsApp bot still boots.

### `bot/utils.js`

`isDineInOrder` moved here — it is used by stock restore **and** by the loyalty
paths, so it now has exactly one definition shared by both files (previously the
loyalty code checked `type === 'dine-in' || isDineIn || tableId` inline in more
than one place).

## 3. A real bug the live run found (pre-existing, now fixed)

The customer-profile transaction returned `name: undefined` on its **first**
ticket for a customer node this process had not read yet:

```
[WebOrder] Finalization error: ... contains undefined in property
'...customers.<phone>.name'
```

Admin-SDK RTDB transactions hand `cur = null` on the first ticket **even for an
existing node** — the rule already documented for the reward burn
(`20261027-080000-delivery-e2e`) and `redeem.js`. With `base = {}` and a guest
order that carries no `customerName`, `name: undefined` makes RTDB reject the
write. The rejection landed **after** the tender and stock writes, so
finalization aborted before `recordDiscountUsage` — the coupon stayed unconsumed
while the customer already had the discount.

Fix (in the module): seed the transaction from one `once('value')` read and
write `name: ... || base.name || null`, exactly like the reward burn.

```
const custSeed = ((await custRef.once('value').catch(() => null)) || {}).val();
custRef.transaction((existing) => { const base = existing || custSeed || {}; ... })
```

Regression assertions added to the E2E: `finalization completed for an untouched
customer node` and `customer profile counters survive the cold tx`.

This bug existed in `bot/index.js` before the extraction — the extraction did
not introduce it, and it would have hit every first order from a new phone
number once the box was restarted.

## 4. Verification

### Live E2E: 44/44, exit 0, fixtures byte-identical

`%TEMP%/opencode/e2e-finalizer.cjs` — runs the real module with the production
`bot/firebase` wiring (`getData`/`updateData`/`resolvePath`, 30 s cache, the real
`discount-engine` + `order-pricing`) against the e2e fixture tenant
`businesses/e2e-biz-1792987605261/outlets/e2e-outlet-1792987605261`.
`saveUserProfile` is recorded rather than written — the profile mirror is
unchanged by this batch and its default outlet arg would land in the live pizza
tenant.

| # | scenario | assertion |
|---|---|---|
| 1 | honest delivery order | ₹751.85 unchanged, GST ₹34.85, stock −2/−1, `inventoryDeducted {i-marg:2,i-farm:1}`, profile mirror called once for `919300000091@s.whatsapp.net` |
| 2 | tampered price (₹1 dish) | flagged `priceChanged`, catalog subtotal ₹398, line price 199, total ₹417.90, no `priceReview` when every line matched |
| 3 | zeroed GST + 23 km delivery paying the ₹20 slab | server 5 % wins (₹14.95), fee ₹80, total ₹393.95, `taxItems[0].rate = 5` written back |
| 4 | pickup claiming a ₹99 fee | fee 0, total ₹208.95 on the order |
| 5 | coupon, client claims ₹500 off | re-evaluated to ₹70 (10 % of 697, whole-rupee engine), tax ₹31.35, total ₹678.35, `stats.usedCount 1` / `totalDiscountGiven 70`, one usage row `channel:'webview'` |
| 6 | reward tender + replay | ₹200 honoured → `totalDue` ₹113.95, reward burned with `usedOnOrder`; replay ignored, no `totalDue` written, first burn intact |
| 7 | multi-line same dish | two lines aggregate to **3**, not 2; stock 10 → 7 |
| 8 | cancel / restore | restores once, second call + dine-in call are no-ops, stock back to 10 |
| 9 | QR verifier math | 900 + 45 + 50 = 995 with taxName GST; legacy fallback 115; empty `taxRates` = no tax (never the client claim) |
| 10 | `notify` callback | called once with `('NEW', orderId, sock)` — the 23c build has no notify and works |

Engine nuance worth recording: `shared/discount-rules.js` rounds the applied
discount to whole rupees (`Math.round` in `evaluateDiscounts`), so a 10 % coupon
on ₹697 is ₹70, not ₹69.70 — tax ₹31.35, total ₹678.35. The expectations follow
the engine (which is also what the live menu displays), not naive arithmetic.

### Guards

* `tests/order-finalizer.check.cjs` — **52/52**. Pins: socket-free imports,
  missing-dep throw, exactly one `finalizeWebOrder(` call site in `index.js`, no
  leftover local helpers, all 9 deps wired, one `isDineInOrder` definition, the
  shadow-compare fields, and the legacy/tax math. Wired as
  `npm run test:order-finalizer` + a CI step.
* `tests/payment-sync.check.cjs` — repointed at the module (consent field,
  re-pricing order, server tax/fee, discount + stock flags) without weakening
  intent; `CHECK PRICES` still asserted in `index.js` where the restaurant alert
  is composed. **OK**.
* `bot/tests/unit.test.js` **28/28**, `tests/session-lifecycle.check.cjs`
  **16/16**, `tests/tables-session-window.check.cjs` **8/8**,
  `tests/admin-query-chain.check.cjs` **142 files**,
  `tests/encoding-check.mjs` OK, `tools/check-shared-twins.cjs` OK.

## 5. Honest limits

* The box is down. The module ran against the production database with the
  production wiring, but **inside the pm2 pizza bot it has never run**. The
  `bot/index.js` wiring is source-guarded only; the first real order after
  `server-deploy.sh` is the live proof.
* Until then the existing (pre-23b) code on the box still finalizes orders — the
  outage delayed this batch rather than creating a gap.
* 23c will run this module in **shadow mode** first (compute + compare with the
  bot's record, no writes) before the trigger is allowed to write. This batch
  deliberately did not flip any authority.
* A cancel that happens while the bot is down is still not replayed
  (`child_changed` only) — unchanged by this batch and tracked separately.

## 6. Deploy / rollback

Files changed: `bot/order-finalizer.js` (new), `bot/index.js`, `bot/utils.js`,
`tests/order-finalizer.check.cjs` (new), `tests/payment-sync.check.cjs`,
`package.json`, `.github/workflows/ci.yml`.

Deploy with `bash /var/www/foodhubbie/tools/server-deploy.sh` on EC2 once it is
reachable (the script `node --check`s every changed file and restarts the
running pm2 apps). Rollback: `git reset --hard <previous sha>` on the box, or
restore `bot/index.js` alone — the module is additive and nothing else imports
it yet.
