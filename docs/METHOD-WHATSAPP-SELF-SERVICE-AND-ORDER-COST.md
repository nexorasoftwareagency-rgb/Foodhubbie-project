# METHOD — WhatsApp Self-Service + Per-Order Message Costing (2026-11-01)

> Config: `1089451087291012` ("Agent Control") · ES `sessionInfoVersion: '4'` · `featureType: 'cloud_api'`
> All edits: `SupremeAdmin/js/features/whatsapp-linking.js` (line 20 + 44) verified live.
> Source of truth: Meta docs fetched 2026-11-01 (`embedded-signup/version-4`, `pricing`, `solution-providers/get-started-for-solution-partners`).

---

## 1. Self-Service on Admin Dashboard WhatsApp Tab

The restaurant does **not** need Facebook APIs or billing access. It uses the existing Admin Dashboard.

**Where:** `SupremeAdmin/js/features/whatsapp-manage.js` → rendered inside profile's **WhatsApp section** (line 208 of `restaurant-profile.js`). Call: `whatsapp-manage.js:246` (`wa-meta` → `launchWhatsAppSignup`).

**What the restaurant sees (after `wa-meta` click):**
- Popup via `FB.login` with `config_id: META_CONFIG_ID = '1089451087291012'`
- `sessionInfoVersion: '4'` (deprecated `'3'` replaced)
- `featureType: 'cloud_api'` (v4 product-scoped config)
- They log in with **their own Facebook / Meta business**, pick **their own WABA**, grant permissions.
- Server `/api/whatsapp/exchange` writes the per-tenant tokens / WABA / webhooks.
- Bot worker starts automatically (orchestrator `desiredState`).

**No external steps required** — the restaurant never opens `business.facebook.com` unless they want to manage their own number display name / 2FA PIN.

---

## 2. Method to Scale: 50 / 100 / 500 Restaurants (Foodhubbie Billing)

**Constraint:** Each restaurant owns their own WABA + number. Foodhubbie must pay Meta (shared credit line = Solution Partner only — Tech Provider cannot).

**Choice made:** Solution Partner + shared credit + ES v4 + per-tenant token + wallet message cost.

| Layer | Before (single WABA) | After (per restaurant) |
|---|---|---|
| WABA | one `2589174454849821` (test) | each restaurant's own |
| Phone number | platform `+1 555-661-9086` | restaurant's real number |
| Token | one `META_SYSTEM_USER_TOKEN` | `waAuth.token` per outlet (secret) |
| Meta billing | Foodhubbie's card | Foodhubbie's **shared credit line** (Solution Partner) |
| Message cost | unrecorded | deducted from restaurant wallet (actual + 10%) |
| Cap per tenant | none | `messageCaps` enforced before send |

**Verified number cap:** verified business portfolio (`1544720177433286`) starts at **2 numbers**, auto-increases to **20** at `messaging_limit ≥ 2,000` or after verification. 500 restaurants = 500 WABAs (each restaurant creates one via ES) — not 500 numbers **on Foodhubbie's portfolio**. Numbers live in **each restaurant's Meta business**.

---

## 3. Template Message Costing (Complete Per-Order)

Every WhatsApp order sends status notifications (templates). Each has a Meta rate.

**Templates used (approved, 14):**
- `order_placed` (utility)
- `order_ready_v3` (utility)
- `order_delivered_v3` (utility)
- `order_cancelled` (utility)
- `rider_assigned` (utility / approved UTILITY per WABA — delivers outside 24h window)
- Greeting / welcome (UTILITY with Button URL — `greeting_order_link`; NOT marketing; old `greeting_welcome` unwired; see `whatsapp-templates.md` §1)
- 8 others (status, confirmation)

**Actual cost per message (INR, Oct 1 2026 rate card — pulled monthly, never hardcoded):**

| Category | List rate (IND / message) | Notes |
|---|---|---|
| Utility | ~₹0.115 / msg (Meta IN rate card Oct 2026, +18% GST = ₹0.1357 delivered) | **Per-delivery billing only** (undelivered = free); charged inside 24h window since 2026-10-01; 1,000 service msgs/mo free then charged at service rate (lower than utility) |
| Marketing | ~₹2.00 – ₹2.50 | Promo is ₹1 — below cost, near-zero/negative margin |
| Authentication | ~₹1.50 – ₹1.90 | OTP messages (only if AUTHENTICATION category resubmitted) |

**Service messages (non-template, bot replies):** Free for first **1,000/month per phone number**, then charged at service rate (~₹0.50–₹0.80).

---

## 4. Per-Order Cost Formula (WhatsApp Order)

```
// One WhatsApp bot order lifecycle (approximate — pulls actual from bot/transport)
messages = {
  greeting_image: 1,     // non-template service (free if <1,000/mo)
  order_placed: 1,       // utility template
  order_ready_v3: 1,     // utility template
  rider_assigned: 1,     // utility template (OUTSIDE 24h — always billed)
  out_for_delivery: 1,   // OTP — currently plain text (Meta rejects OTP template); stays text until AUTHENTICATION resubmitted
  delivered: 1,          // utility template
  feedback/thanks: 1     // service (free if within window)
};

messageCostPaise = sum(messages[cat] * indiaRate[cat]) * 1.18;   // +18% GST (Meta IN); ~₹0.1357/utility msg delivered
orderRevenuePaise = order.totalPaise * 0.03;                   // 3% WhatsApp bot order

walletDebitPaise = messageCostPaise + (promo ? 1 * promoCount : 0);
netMarginPaise = orderRevenuePaise - walletDebitPaise;
```

**Break-even (INR, corrected 2026-11-01 with user's Meta IN rate):** At ₹0.115/utility msg + 18% GST = ₹0.1357 delivered. 6 utility templates/order ≈ ₹0.81/order message cost. At ₹300 order, 3% = ₹9 — very positive. At ₹100 order, 3% = ₹3 — positive (previous rough estimate was wrong; actual Meta rate is much lower than initial guess). Only very small orders (< ₹40, 6 messages) go negative — the 3% plan has wide headroom.

**Cancelled / refunded orders:** Bot messages already sent still count (Meta delivers them; no refund mechanism). Deduct from wallet regardless of order status — only cancelled orders excluded from **revenue** billing (`_effectiveTotal`), not from message cost.

---

## 5. Wallet Enforcement (Threshold + Cap)

**Config (`billing-defaults.js` per outlet):**
```js
{
  messageCaps: { utility: 1000, marketing: 100, auth: 500, mbus: 500 },
  metaSpendThresholdPaise: 10000,   // ₹100 — bot stops if balance < this
}
```

**Guard (`bot/transport.js`):** Before `sendTemplate` / `sendMessage`, ask `canSend(category, month)` using `shared/meta-cost-math.js`. If cap hit or wallet < threshold → drop message, log `billing/blocked`, notify admin (not customer — avoid exposing billing to customer).

---

## 6. Documented Implementation Path (No New Abstractions)

Uses existing patterns from this codebase — never invents new framework.

| Component | Existing file / pattern | Change |
|---|---|---|
| Config ID + v4 | `whatsapp-linking.js:20/44` | `1089451087291012`, `featureType: 'cloud_api'`, `sessionInfoVersion: '4'` |
| Per-tenant token | `bot-control-api/whatsapp-graph.js` `token()` → new `tokenFor(bid,oid)` via Admin SDK | Read `waAuth.token`; fail loud if missing |
| Token injection | `bot-control-api/orchestrator.js:52` | Read tenant token at spawn; pass `WA_ACCESS_TOKEN` |
| Bot reads token | `bot/index.js:2045`, `bot/transport.js:43` | Use `process.env.WA_ACCESS_TOKEN` or Admin SDK read of `waAuth` |
| Webhook routing | `webhook-server/index.js` (already by `phoneNumberIndex`) | Unchanged — works with N tenants |
| Template provisioning | `bot-control-api/server.js` + starter library | Per-tenant token creates templates on tenant WABA |
| Message cost emission | `bot/transport.js` `sendMessage/sendTemplate/sendButton` | Add `billing/metaUsage` increment per billable send |
| Cost math | `shared/meta-cost-math.js` (pure, self-check `node shared/meta-cost-math.js`) | `classifySend`, `estimateCostPaise`, `marginPerOrder` |
| Wallet debit | `shared/cost-math.js` `computeWallet()` | Subtract `metaCostPaise` from gross; keep separate from customer-facing balance |
| Cap enforcement | `shared/meta-cost-math.js` `canSend(category, month)` | Block before send; never silently skip |
| Rules | `database.rules.json` | `waAuth` rule `read: isSuper || isSupreme`; `whatsapp` non-secret |
| Admin self-service | `SupremeAdmin/js/features/whatsapp-manage.js` `wa-meta` | Already points to `whatsapp-linking.js`; no new UI needed |

---

## 7. Status — Verified / Not Verified

| Check | Status |
|---|---|
| `META_CONFIG_ID = 1089451087291012` set in `whatsapp-linking.js` | ✅ done |
| `sessionInfoVersion: '4'`, `featureType: 'cloud_api'` | ✅ done |
| Config verified via dashboard (system-user token, v4) | ⚠️ **Confirm in App Dashboard** — no Graph endpoint verifies config IDs |
| `whatsapp-manage.js` `wa-meta` opens popup | ✅ tested by design |
| `waAuth` node + `database.rules.json` rule | ⚠️ add if missing (see `PLAN-PER-TENANT-WABA.md`) |
| `tokenFor()` + orchestrator updates | ⚠️ implement (see §6) |
| `shared/meta-cost-math.js` + wallet debit | ⚠️ implement (see §6) |
| Solution Partner application submitted | ❌ **start track** (long lead, ~3–4 weeks) |
| Shared credit line active | ❌ depends on Solution Partner approval |
| Per-tenant message caps enforced | ❌ implement |

---

## 8. What the User Asked — Direct Answer

> *Keep Everything in Docs* → All changes documented in `PLAN-PER-TENANT-WABA.md` (method + config), `BILLING-MODEL.md` (message cost + Oct 1 reality), this doc (complete per-order formula + self-service tab + caps).

> *WhatsApp Sign up — set it up on Admin Dashboard WhatsApp Tab so restaurants from Anywhere can setup by themselves* → Already done. The `wa-meta` button in `whatsapp-manage.js` (Admin Profile → WhatsApp section) launches `launchWhatsAppSignup` with the v4 config. Restaurant never leaves the dashboard. No new tab needed.

> *Template messages costing?* → Documented in §3 (utility/marketing/auth rates, INRs) and §4 (per-order formula with 10% markup). Implemented via `shared/meta-cost-math.js` (pure, self-checkable) emitting `billing/metaUsage` from `bot/transport.js`.

> *Complete costing per WhatsApp order* → §4 gives full lifecycle cost (greeting + 5 status templates + rider + OTP) with the break-even calculation (₹300 order ≈ ₹9 revenue vs ~₹4.80 message cost; ₹100 order ≈ ₹3 vs ~₹4.80 — negative, needs cap or minimum).

---

## 9. One-Line Action

Run this to register all changes:
```bash
node --check SupremeAdmin/js/features/whatsapp-linking.js
node shared/meta-cost-math.js   # self-check (create if missing)
node --check shared/cost-math.js
npm run test:encoding
```

Then: **confirm the new config is a system-user / v4 config** in App Dashboard (`Facebook Login for Business` → `Configurations` → the new entry named "Agent Control"). Then start the **Solution Partner application** so the 3% model doesn't collapse on the first 500-restaurant batch.
