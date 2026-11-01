# Foodhubbie — Loyalty Module Specification (Proposal)

**Status:** Not yet built. Confirmed via full README review (20-tab reference) and repo search — no `loyalty.js`, no Loyalty tab, no loyalty schema exists in the documented codebase as of this review.

**Design goals:**
1. Reuse the existing Discounts engine's logic shape (`discount-evaluator.js`) rather than duplicating it
2. Fit the existing per-outlet Firebase RTDB schema (`pizza/`, `cake/` partitions)
3. No WhatsApp dependency — tier-upgrade / points notifications go through the **Foodhubbie-App Orders** in-app channel (per current WhatsApp-paused decision)
4. Server/admin-only writes to points balances — never client-writable, to prevent tampering (this is effectively a currency)

---

## 1. Firebase Schema Additions

Added under each outlet partition (`{outlet}/loyalty/`), parallel to the existing `discounts/` and `discountsUsage/` nodes:

```
{outlet}/loyalty/
  config/
    enabled: true
    pointsPerRupee: 1          # 1 point per ₹1 of subtotal (after discounts)
    redemptionValuePerPoint: 0.5   # ₹0.50 redeemed per point
    minRedeemPoints: 100       # floor before redemption is allowed
    maxRedeemPercentOfOrder: 10    # Zomato-style cap — redemption can't exceed 10% of order value
    pointsExpiryMonths: 12
    birthdayBonusPoints: 50
    tiers: [
      { id: "bronze", name: "Bronze", minLifetimeSpend: 0,     multiplier: 1.0, badgeColor: "#A67C52" },
      { id: "silver", name: "Silver", minLifetimeSpend: 5000,  multiplier: 1.25, badgeColor: "#A8A8A8" },
      { id: "gold",   name: "Gold",   minLifetimeSpend: 15000, multiplier: 1.5,  badgeColor: "#D4A017" }
    ]

  members/{phone}/
    points: 340
    lifetimeSpend: 8200
    tier: "silver"
    tierUpdatedAt: 1730000000000
    lastEarnedAt: 1730000000000
    lastRedeemedAt: null
    birthdayMonth: 5            # optional, if customer shared DOB

  ledger/{entryId}/
    phone: "9876543210"
    orderId: "20261101-0042"
    type: "earn" | "redeem" | "expire" | "bonus" | "adjustment"
    points: 42                  # positive for earn/bonus, negative for redeem/expire
    balanceAfter: 340
    reason: "Order delivered" | "Tier upgrade bonus" | "Manual adjustment by admin" | "Points expired (12mo inactivity)"
    createdAt: 1730000000000
    createdBy: "system" | "{adminUid}"
```

**Order document additions** (new optional fields on existing `orders/{orderId}`):
```
pointsEarned: 42
pointsRedeemed: 0
loyaltyDiscountAmount: 0
```

**database.rules.json addition:**
```
/{outlet}/loyalty/members/{phone}
  .read  → auth.token.superAdmin === true OR auth.token.owner === true OR any authenticated admin OR (customer's own uid, if customer auth is added later)
  .write → superAdmin OR owner OR bot service account only  # never client-writable — prevents point tampering

/{outlet}/loyalty/ledger/{entryId}
  .read  → any authenticated admin
  .write → superAdmin OR owner OR bot service account only
```

---

## 2. Admin Dashboard — New "Loyalty" Tab

Placement: **Marketing group**, next to Discounts (`tab-discounts`), since it's the same category of spend-driving tool.

| Sub-view | Purpose |
|---|---|
| **Overview** | KPI cards: Active members, Points outstanding (₹ liability = points × redemption value — important for finance), Redemption rate, Avg. points balance |
| **Program Settings** | Edit `loyalty/config`: points-per-rupee, redemption value, max redemption %, tier thresholds/multipliers, expiry window, birthday bonus |
| **Members** | Sortable grid: phone, name, points, tier badge, lifetime spend, last activity — mirrors the existing Customers tab grid pattern |
| **Ledger** | Searchable/filterable transaction log (earn/redeem/expire/bonus/adjustment), exportable to CSV like Inventory already does |
| **Manual Adjustment** | Admin can grant/deduct points with a required reason (customer service recoveries, goodwill gestures) — every adjustment writes a ledger entry |

**KPIs to surface** (per the research above): Redemption Rate and Program ROI are the two that tell you if it's working — ROI = (incremental revenue from members) − (points redeemed value + any platform cost). Worth adding both to the existing Analytics tab as a "Loyalty" panel alongside the current revenue charts.

---

## 3. Core Logic

### Earning points
Triggered on order status → `Delivered` / `Served` (same trigger point as existing `stockDeducted`/`settled` flags):
```
basePoints = floor(subtotal_after_discount * config.pointsPerRupee)
tierMultiplier = tiers[currentTier].multiplier
pointsEarned = floor(basePoints * tierMultiplier)
```
Written via a Firebase **transaction** on `members/{phone}/points` (never a plain `set`) to avoid race conditions if a customer orders from two outlets near-simultaneously. Ledger entry written in the same atomic multi-path update, mirroring the pattern your Settings tab already uses for its 4-node atomic save.

### Tier recalculation
After each earn, recompute `lifetimeSpend` and compare against `config.tiers` thresholds. On upgrade: write new tier, push an **in-app notification** ("🎉 You're now Silver — 1.25× points on every order"), never a WhatsApp message.

### Redemption
At checkout (POS, QR Menu, or App order — wherever `discount-evaluator.js` currently runs):
```
maxRedeemableValue = min(
  member.points * config.redemptionValuePerPoint,
  subtotal * (config.maxRedeemPercentOfOrder / 100)
)
```
Stacking rule: by default, loyalty redemption and a coupon discount are **mutually exclusive** on the same order (same "exclusive group" concept your discount engine already supports) — configurable later if you want to allow stacking.

### Expiry
A scheduled job (reuse the existing 5-minute heartbeat pattern from `bot/index.js`) checks for members whose `lastEarnedAt` is older than `config.pointsExpiryMonths` and writes an `expire` ledger entry zeroing their balance. Runs once daily, not every heartbeat tick.

---

## 4. Why this shape specifically

- Ledger-based (not just a mutable balance) because you need an audit trail for anything that behaves like currency — this also gives you the Redemption Rate and ROI metrics for free, since they're just ledger queries.
- Server/admin-only writes close the obvious exploit (a compromised client rewriting their own points node).
- Tier multipliers reuse your existing `customers/{phone}` LTV data as the tier threshold — no new tracking needed, just a new read.
- Redemption cap at the order level (not a flat points-per-order cap) matches the Zomato Piggybank precedent and protects margin on large orders specifically.
