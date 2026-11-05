# PLAN — Customer Loyalty Points, Rankings & Management

## Objective
Add a per-restaurant loyalty system inside the customer app's Account tab:
- Earn loyalty points on every placed order (1 point per ₹100 spent).
- View total spent, order count, current tier, points balance, and a progress bar to the next tier.
- Rate delivered/served orders (1–5★) — ratings feed tier eligibility and perks.
- Rankings: per-outlet top customers leaderboard visible to the restaurant (Admin) and the customer's own rank.
- Admin manages tiers, earn/redeem rates, and reward catalog; points never expire.

## Research basis (summarized)
Source: QSR Magazine (2024/2026), NRN, BonusQR, Entrepreneur, Restaurant Velocity 2026, Antavo tier study.

- **Structure fit:** Pizza/delivery ($22–$30 ticket) → **points per dollar** (1 point per $1 / ₹100). Flat "points per visit" suits sub-₹15 QSR; tiered suits $30+ destination restaurants.
- **Tiered beats flat:** tiered programs avg 48% member engagement vs 35% flat; top tier spends 2.5× more per transaction, visits 3× more frequently.
- **Redemption target:** healthy rate 15–25%. 1–8% means threshold too high or earn too slow.
- **Simplicity rule:** customer must understand the whole program in under 30 seconds. Max 2–3 tiers, one metric (total spend).
- **Perk categories:** financial (faster earning, discounts), experiential (early menu access), convenience (priority), recognition (badge/rank).
- **Loyalty stack:** transactional (points) → personal (birthday/win-back WhatsApp) → emotional (staff remember regular, advocacy).
- **Win-back:** WhatsApp to inactive 30–45 day customers returns 12–20% within 14 days.

## Decisions (binding)
| # | Decision |
|---|----------|
| L1 | One loyalty program per outlet. Customers are loyal to a kitchen, not the platform. |
| L2 | Earn: 5 loyalty points per ₹100 spent on non-cancelled, non-refunded orders. Integer floor. Rate is admin-configurable (`loyalty/config.earnRatePaisePerPoint`, default 2000 paise per point = 5 per ₹100). |
| L3 | Points accrue only on orders with status Delivered/Served (final). Pending/Preparing/Ready do not award until final. |
| L4 | Tiers (per outlet): Bronze (0–999 pts), Silver (1,000–4,999), Gold (5,000+). Configurable by Admin later (L9). |
| L5 | Tier benefits: Bronze = 1× earn; Silver = 1.25× earn + birthday treat; Gold = 1.5× earn + priority seating + free item after N orders. |
| L6 | Ratings: 1–5★ on Delivered/Served orders. One rating per order; cannot change after save. |
| L7 | Rankings: outlet-level leaderboard by lifetime points (top 50). Customer sees own rank + tier. |
| L8 | Points never expire. Cancelled/refunded orders reverse any pending points. |
| L9 | Admin can configure earn rate, tier thresholds, and reward catalog in future; v1 hardcodes L2–L5. |
| L10 | Phone is the loyalty key (customers/{phone}/loyalty). No separate signup; identity from existing onboarding. |

## Data model (Firebase Realtime Database)

```
businesses/{bid}/outlets/{oid}/
  loyalty/
    config: { earnRatePaisePerPoint: 2000, tiers: { bronze: {min:0,label:'Bronze',multiplier:1}, silver:{min:1000,label:'Silver',multiplier:1.25}, gold:{min:5000,label:'Gold',multiplier:1.5} }, rewards: [...] }
    rankings: { $phone: { phone, outlet, business, lifetimePoints, totalSpent, tier, rank, updatedAt } }  // mirrored for leaderboard queries
  customers/{phone}/
    loyalty: { phone, outlet, business, lifetimePoints, totalSpent, orderCount, tier, tierReachedAt, lastOrderAt, updatedAt }  // canonical record (plan L10)
    orders/{orderId}: { orderId, total, status, pointsEarned, placedAt, deliveredAt }
    ratings/{orderId}: { rating 1-5, comment, orderId, createdAt }
```

### Rules additions (`database.rules.json`)
Under `businesses/{bid}/outlets/{oid}`:

- `customers/$phone/loyalty` (canonical record):
  - `.read`: `$phone.matches(/^[6-9][0-9]{9}$/)` (customer reads own phone; admin/rider read via auth)
  - `.write`: admin/outlet write (server writes it; the customer never writes points)
  - `.validate`: required fields phone/outlet/business/lifetimePoints/totalSpent/orderCount/tier/updatedAt; tier in [bronze,silver,gold]; lifetimePoints ≥ 0.
- `loyalty/rankings/$phone`:
  - `.read`: admin/outlet only — the leaderboard holds other customers' phones and spend, so customers do not read it. The bot stores each customer's `rank` in their own entry.
  - `.write`: admin/outlet only (server-maintained, customers never write rankings directly)
  - `.indexOn`: lifetimePoints
- `customers/{phone}/orders/$orderId`:
  - `.read`: `$phone.matches(...)` self; admin outlet read
  - `.write`: self-write with orderId match + outlet match + status/placedAt/total validation
- `customers/{phone}/ratings/$orderId`:
  - `.read`: self + admin outlet
  - `.write`: self-write; rating 1–5; one rating per orderId; createdAt number; comment ≤ 500 chars

### Rewards catalog (v1 — Admin-configurable later)
```
rewards: [
  { id: 'free-samosa', label: 'Free Samosa', cost: 200, type: 'item', limitPerMonth: 1 },
  { id: '10pct-off', label: '10% Off Next Order', cost: 500, type: 'discount', code: 'LOYAL10' },
  { id: 'free-dessert', label: 'Free Dessert', cost: 800, type: 'item', limitPerMonth: 1 }
]
```
v1 hardcodes catalog; redemption tracked per customer per month to prevent abuse.

## Customer Tab UI (Account screen additions)

Sections (after profile/prefs in `accountProfileCard`):

1. **Loyalty strip** (money-strip style, already used in Supreme payments):
   - Tier badge (Bronze/Silver/Gold) with color
   - Points balance large
   - Progress bar → next tier (points needed shown)
   - "Total spent ₹X · N orders" chips

2. **Order history** (existing `renderCustomerStatsAndHistory`):
   - Order id, status pill, time, total, items summary
   - For Delivered/Served orders not yet rated: star rating UI (1–5★) + optional comment + Save
   - Rated orders show "Rated ★N" chip (read-only)

3. **Rewards** (v1 placeholder):
   - List of redeemable rewards with cost and "Redeem" button (disabled if insufficient points; generates a coupon code for checkout)

### Bottom nav
- `screenHistory` already exists ("History" tab). Loyalty stats live in Account (Promos → Account). Keep History = per-visit orders; Account = lifetime loyalty. No nav change needed.

## Server-side accrual (bot)

In `bot/index.js` `notifyCustomerApp` / order status listener:
- On order transition to `Delivered` or `Served`:
  - Compute `pointsEarned = floor(total * 100 / earnRatePaisePerPoint) * tierMultiplier` (default 5 points per ₹100)
  - Transaction on `businesses/{bid}/outlets/{oid}/customers/{phone}/loyalty`:
    - `lifetimePoints += pointsEarned`
    - `totalSpent += total`
    - `orderCount += 1`
    - `lastOrderAt = now`
    - recompute `tier` from thresholds; if tier changed, set `tierReachedAt`
  - Write `customers/{phone}/orders/{orderId}` with `pointsEarned`, `status`, `placedAt`, `deliveredAt`
  - Update `loyalty/rankings/{phone}` mirror (includes `rank`, computed server-side)
  - Send WhatsApp/FCM: "You earned N points! Total ₹X spent. Next reward at Silver tier."

## Rankings / leaderboard

**Customer view (Account):**
- "Your rank: #N of M regulars at this kitchen"
- Shows own tier + points + progress bar

**Admin view (SupremeAdmin / Admin Customers tab):**
- Leaderboard table: Rank | Name | Phone | Tier | Points | Total Spent | Orders | Last Visit
- Filter by tier; export CSV

**Ranking computation:**
- Server-maintained via Cloud Function equivalent — since no Functions on Spark, recompute on each order finalization (transaction updates `rankings/{phone}`). For v1, Admin reads `customers/*` under loyalty and sorts client-side (≤ hundreds of customers per outlet — acceptable).

## Edge cases & guards
- **Cancelled/refunded after points awarded:** reverse points in transaction (lifetimePoints − pointsEarned, totalSpent − total, orderCount − 1). Tier does not auto-downgrade on reversal (status retained once reached) — simpler, customer-friendly.
- **Double accrual:** idempotent keyed by `orderId`; accrual runs once on Delivered/Served transition (guard: only when status changes into final state).
- **Phone change:** loyalty is phone-keyed; if customer updates phone, old records orphaned (accepted — matches existing identity model). Add "Merge loyalty" admin action later if needed.
- **Concurrent orders:** Firebase transactions prevent lost updates on points/totalSpent.
- **Anonymous/order without phone:** no points (phone required). Order still placed.

## Admin management (future, v2)
- Configure earn rate (paise per point), tier thresholds, multipliers
- Reward catalog + costs + monthly limits
- Manual points adjustment (audit-logged: admin, reason, delta)
- Tier override (force Bronze/Silver/Gold)
- CSV export of loyalty customers

## File changes
1. `database.rules.json` — loyalty rules under outlet node
2. `bot/index.js` — accrual on Delivered/Served; win-back hook
3. `menu/js/customer.js` — loyalty strip, rankings, rating UI, rewards list
4. `menu/css/app.css` — loyalty strip, tier badge, progress bar, rating stars
5. `SupremeAdmin/js/features/customers.js` (or new `loyalty.js`) — leaderboard table + config

## Non-goals (v1)
- Cross-outlet / platform-wide points (L1: per-kitchen)
- Paid membership tier (L4 tiers are free)
- Points transfer / partner redemption
- Real-time leaderboard WebSocket (client-side sort is fine)

## Validation checklist
- [ ] Rules JSON parses; anon customer can read own loyalty, cannot write rankings
- [ ] Placing a delivered order adds points + tier recompute
- [ ] Cancelled order reverses pending points
- [ ] Rating a delivered order saves 1–5★, one per order
- [ ] Account tab shows tier badge, points, progress bar, total spent
- [ ] Customer sees own rank #N


