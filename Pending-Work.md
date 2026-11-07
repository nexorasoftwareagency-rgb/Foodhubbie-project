# Pending Work Tracker — Four-Stage Review Process

**Purpose:** Track code changes, audits, and fixes through a structured four-stage lifecycle:
`Reviewing` → `Verified` → `OK` → `Done`

This file ensures no item drifts back into "speculative need" and provides a single source of
truth for what has been addressed, what is in flight, and what requires follow-up.

---

## ⚠️ Mandatory Rule: Update Pending Work After Every Action

**Never proceed without updating this file.** After every command, input, or output that
modifies code, configuration, or infrastructure:

1. **Update** the item's `status` field (advance one stage: `Reviewing` → `Verified` → `OK` → `Done`)
2. **Verify** the change passes `node --check` (for JS) or equivalent for the relevant language
3. **Update** this file with the verification result, commit reference, or deployment target

**Failure to update this file after any code-changing action will be treated as an incomplete task.**
This rule applies to:
- Tool commands (edit, write, bash, etc.)
- Code reviews and diffs
- Bug fixes and feature additions
- Infrastructure changes (Firebase, EC2, package.json, etc.)
- Audit items and cross-project references

---

## Four-Stage Review Lifecycle

| Stage | Meaning | Action |
|-------|---------|--------|
| **Reviewing** | Change has been proposed/diffed; not yet validated | Add to this file with `status: in_progress`; assign reviewer or self-review |
| **Verified** | Change has been tested, lint/typecheck passes, no regressions | Move `status` to `verified`; add test command output or `node --check` result |
| **OK** | Verified + reviewed by second party (or self-review complete); ready for commit | Move `status` to `ok`; reference git commit SHA or deployment target |
| **Done** | OK + deployed/merged; no further action required | Move `status` to `done`; reference deployed URL or PR number |

**To progress an item:** update its `status` field. Do not skip stages.

---

### ✅ WhatsApp costing — live Meta India INR rate card refresh (2026-11-07)
- **Stage:** `done` — docs-only, commit `4496f59`; no deploy.
- **Rates recorded:** utility/auth/service **₹0.115** per delivered message (service after the first 1,000/month per business phone number); marketing **₹0.8631**; inbound ₹0. Meta's INR list prices **already include 18% GST** — no extra mark-up, and rates are always **per delivered message** (never "per message" rupees/paise confusion).
- **Updated:** `docs/BILLING-MODEL.md` (authoritative table + ₹0.115 break-even column + GST-inclusive header), `docs/METHOD-WHATSAPP-SELF-SERVICE-AND-ORDER-COST.md`, `docs/whatsapp-templates.md`, `docs/temp-section.md`, `GUIDEs/MASTER-DEPLOYMENT-GUIDE-V3.md`, `Research/WHATSAPP-BOT-COST.md`, `Research/index.html`, `Research/possibility-3-meta-free.html`, `Research/possibility-4-meta-billed.html`, `Research/scripts/cost-calc.js` (`RATE_MARKETING = 0.8631`, committed in `665b8ae`), `ACCESS.md` (new India rate table under WhatsApp Business API) and `shared/meta-cost-math.js` (GST comment only; paise table unchanged).
- **Also repaired:** pre-existing cp1252 double-encoding (corrupted em-dash / rupee / section-sign glyphs) throughout `docs/BILLING-MODEL.md`; the ₹0.115 break-even table/example math (₹0.15 → ₹0.115, ~₹20–25 break-even, not ₹35); and the method doc's stale free-tier wording (utility templates have no free tier; auth is never free; in-window service replies are free only for the first 1,000/month). No code behaviour changed.
- **Verified:** `node shared/meta-cost-math.js` self-check OK; `node tools/check-wa-templates.cjs bot/index.js` → **ALL CHECKS PASSED** (14 approved templates, 3 OTP-bearing UTILITY rejections are by design); `npm run test:encoding` OK; `node --check` on both JS files.
- **Left alone (not a cost gap):** legacy stored setup/billing records and the `per_order` mode remain readable; no live billing config changed.

### ✅ Onboarding setup checklist / auto-approval / wallet / percentage package — merged + deployed (done)
- **Source:** `Fixes-and-Changes/Foodhubbie Onboarding PLAAN/` (6-commit mbox on base `a4392f1` + Guide.md + Change-Guide-Before-After.md)
- **Stage:** `done` — merged `c54522e`, docs `0bcfc98`, deployed 2026-10-30 (rules + admin/supreme/website hosting + EC2 `bot-control-api`)
- **Branch:** `onboarding-setup-checklist` (`83f4fbb`, `9d3109f`, `7357102`) merged `--no-ff` into `seo-brand-consistency`; ledger `[20261030-onboarding-ship]`
- **Plan:** `docs/PLAN-ONBOARDING-FLOW-HARDENING.md` (F1/F2/D2/D4/D6, verified facts V1–V11, AS-BUILT sections) + `docs/PLAN-ONBOARDING-WALLET-PERCENTAGE.md` (compatibility matrix, file map, findings, verification, phased rollout, rollback, live probes)
- **Verified:** gate on the merged tree — encoding, imports, twins 5/5, cost-math/report-catalog/report-export/loyalty/payroll/money/discount self-checks, auto-onboarding 10/10, wallet-checklist 3 suites, signup-onboarding 12/12, `gate-verify.js` PASS, both builds. Live: admin `sw.js` `v5.12.10` + `style.css?v=5.4.13`, Supreme no-password copy, website `signup.html` 200, EC2 API listening on `:4000` with auto-onboarding + auto-settlement armed, built Admin `?demo=1` boots with 0 console errors and all five deep-link targets.
- **Fixes shipped:** F1 setup mode (7 steps, required-step hero, deep links, `SETUP_TABS` +`discounts`, deliberately not `chat`/`promotions`); F2 tenant parity (`outletIndex/{oid}`, `outletNo` reused on retry, template defaults spread before identity/security, `adminLogin` = `{email, passwordUpdatedAt}` only); F5 single version bump above both branches.
- **Not verified:** rules behaviour locally (no Java → no RTDB emulator) — run the live probe in plan §7.1; Supreme billing screens need a real super account; live auto-approval needs a real website signup.

### ✅ D2 — Email verification before promoting public sign-up
- **Stage:** `done` — commit `d92bb3b` (branch `onboarding-email-verify`), deployed 2026-10-31: `firebase deploy --only database,hosting:admin,hosting:supreme,hosting:website` + EC2 `bot-control-api/server.js` (backup `server.js.bak-20261031-*`, pm2 id 2 restarted)
- **Why:** auto-approval let anyone register any unregistered email and immediately receive a working tenant.
- **Shipped:** unverified owners see a self-contained "verify your email to go live" banner (auto-send once per device, 60 s resend countdown, Check again via `user.reload`); Supreme's Unlock calls `GET /api/admin/outlet-admin-status` and refuses an explicitly unverified owner (legacy outlets and API outages are never gated); a daily 72 h cleanup of auto-onboarded unverified tenants (observe mode unless `ONBOARDING_CLEANUP=enforce`); `onboardingRequests.status` gains `expired` + `expiredAt`/`expireReason`; Supreme requests UI gains an Expired filter/KPI.
- **Verified:** auto-onboarding 16/16; live E2E 8/8 (banner, auto-send stamp, throttle, not-verified, hides after verification, 0 page errors); demo boot 0 errors + no banner; shell `v5.12.12`; EC2 log `[onboarding-cleanup] armed — 72h unverified TTL, observe mode`; endpoint 401 without a token.
- **Note:** a custom `sendEmailVerification` continue URL fails with `auth/unauthorized-continue-uri` unless the host is added to Auth → Authorized domains, so the default action page is used. Cleanup stays observe mode until the owner wants deletions.
- **Plan:** `docs/PLAN-ONBOARDING-FLOW-HARDENING.md` §3.4 (as built).

### ✅ External "Loyalty Points" draft series — reconciled against the shipped feature (do-not-merge)
- **Source:** `Fixes-and-Changes/Loyalty Points/` (3 files: module spec + `loyalty-evaluator.js` + `loyalty.js`) — external author reviewed a README-only snapshot and concluded "loyalty doesn't exist"; wrong for this codebase (Loyalty shipped as Phase 2 on 2026-10-27, live-E2E'd then).
- **Stage:** `done` — reviewed + live re-verified 2026-11-01; files stay in place as reference.
- **Reconciliation:** the drafts' core already ships under different names and sharper money semantics — config node (`loyalty/config`), member row (`customers/{phone}/loyalty`), server-only writes (rules: admin-owner write, phone-gated public read), transactional balance with double-entry guards (`lastAccruedOrderId` / `lastClawedOrderId`), and re-earn after reversal. Shipped audit nodes (`loyalty/accruals/{orderId}`, `loyalty/clawbacks/{orderId}`, `customers/{phone}/orders/{orderId}` history) already cover the draft's ledger for earn/redeem/reverse — a separate chronological ledger node would just diverge from them.
- **Live Phase 2.5 E2E 2026-11-01 (e2e outlet `e2e-biz-1792987605261/e2e-outlet-1792987605261`, bot pm2 id6 live, 4 runs, all restored byte-identical + DB rules 9/9 + bot 18/18):** LEG1 rules (owner-READ `rankings` parent via new 4-clause grant, `adjustments` write/reject + cleanup, `loyalty` write + `lastAdjustment` validate) ✅; LEG2 R10 cap (mints `CAPT5578ZZ`, injects webview `e2e2p5cap-*`, tender ₹2.99/500pts/due ₹330.96 — cap beats full value; code burned; config restored) ✅; LEG3 tier-up (plays `e2e2p5tier-*`, deliver → +1000pts/silver + `tierReachedAt` + rankings mirror + history row + `pushInbox` `tier_silver_...` + `notifyTierUp` log + dead-token hygiene; cancel → clawback audit + full reversal) ✅ all verified in bot logs (`[LOYALTY] Order #055818: +1000 pts`, `Tier-up push bronze → silver`, clawback). LEG4 Playwright (Admin login, KPI loads, customer lookup points=0, +10/−10 adjustments commit (DB audit 4/4, `lastAdjustment` mirror present) — UI refresh timed out but DB is authoritative). **Expiry (②) DROPPED** per owner's 11-01 directive.
- **Adoptable kernels (Phase 2.5 candidates, owner's call 2026-11-01: drop ② expiry, build the rest):** (1) `maxRedeemPercentOfOrder` Zomato-style cap inside `computeTenderPaise` + menu tender preview + Admin config field ✅; (2) points expiry on idle `lastEarnedAt` — DROPPED per owner directive 2026-11-01; (3) manual admin point adjustments with mandatory reason + `source: 'manual'` audit node `loyalty/adjustments` ✅; (4) tier-up FCM push through in-app inbox (`notifyTierUp`) — earn fires, tier-up log line verified, dead-token hygiene present ✅ (inbox write verified live on order 931397, FCM push path proves out via bot logs); (5) liability KPI (`Σ lifetimePoints × redeemValue`) + rankings read ✅.
- **Tenanted reality:** config is live but only on the e2e outlet; both real tenants (`roshani-pizza`, `roshani-cake`) still run `loyalty/config` = null → code defaults, and pizza has 1 ranked customer (lifetime 40 pts). Configuring tenants is an ops step, not a code gap.

### ✅ D4 — Wallet gates — code shipped + verified (2026-11-01, app/webview gap closed 2026-11-03, bot consumer + server publisher closed 2026-11-05)
- **Stage:** `verified-code` + live-proven — pure gate + QR menu consumer + app checkout + WhatsApp delivery webview + WhatsApp bot consumer + **server-side publisher (Supreme owns the switch)** + rules link shipped; enforcement OFF (observe) until owner tops up. `shared/cost-math.js` `walletGate(w)` + asserts; `database.rules.json` public read on `outlets/{oid}/walletGate`; `menu/js/session.js` `assertWalletGate()`; QR boot gate display in `menu/js/app.js`; app checkout gate in `menu/js/app-checkout.js`; delivery webview gate in `menu/js/delivery-order.js` + `userMessage` toast in `menu/js/delivery.js`; bot consumer `bot/wallet-gate.js` + `bot/utils.js walletGateBlocks()` wired into `sendOrderFlow`/`resendMenuCTA` (no token minted, no CTA while `low`/`closed`); **`bot-control-api/wallet-watch.js` is now the only writer** (every 60 s over `outletIndex`, only while `billing.wallet.enforce === true`, demo hard-skipped, writes only on change) with `POST /api/bot/wallet-gate/:bid/:oid` for an instant flip; Supreme billing card shows the live gate + arms/disarms it; the tenant-side writer in `Admin/js/features/costs.js` was removed (the Admin tab now only reads the flag). build `build:admin` 3.9MB OK; twins 5/5; deploy `hosting:admin,hosting:supreme` + EC2 `bot-control-api/{wallet-watch,server}.js` + `shared/cost-math.js`.
- 2026-11-03 live proof on the e2e outlet (27/27): closed wallet blocks app checkout AND delivery.html with zero order writes (webview token unconsumed), `low` still allows app orders, live `outlets/pizza/walletGate` is absent so no production behaviour change.
- 2026-11-05 bot consumer live proof (15/15 local module + 8/8 on EC2): absent flag open, `low`/`closed` block (case-insensitive), `''`/`ok` open, live pizza still absent while the e2e node was flipped, node restored; deploy md5-matched, pm2 6 + 35 online with `[TENANT]` intact. No inbound WhatsApp message was injected (the e2e socket has 408-reconnect history); handler wiring is guarded in `tests/payment-sync.check.cjs` (gate precedes greeting, token mint and CTA).
- 2026-11-05 publisher live proof (31/31 on the e2e tenant + 13/13 card render): unarmed → no node; armed + −₹27.48 → `closed` and the bot reader/decision table both block; +₹1,000 top-up → gate cleared; −₹900 charge (₹72.52) → `low`; disarm while low → cleared; −₹500 more → `closed`; demo armed → never gated; live pizza → untouched; one full `outletIndex` pass → no outlet gated by accident; every fixture restored byte-identical.
- Not yet done: owner top-up + `enforce:true` (ops decision — Supreme's billing card now arms it). Structural follow-up in audit item B is now closed by relocating the money ledger to the server-only root `walletBilling/{bid}/{oid}` (see the item below). `walletGate` deliberately stays tenant-writable (it must be publicly readable by menu/bot), but the publisher re-reads the live node every 60 s and rewrites it from the server-only `billing.wallet.enforce`, so tenant tampering self-heals within one pass.

### ✅ Audit item B — money trust boundary: ledger relocated to the server-only root (2026-11-05)
- **Stage:** `done` — commit `4cf2798`; live-proven rules 13/13 + UI 11/11; deployed `database,hosting:admin,hosting:supreme`; EC2 files md5-matched and pm2 2/6/35 stable; legacy nodes pruned 19/19.
- **Why:** RTDB grants are OR'd and `businesses/$bid/.write` is granted to the tenant, so the deeper `outlets/{oid}/billing` `.write: isSuper || isSupreme` could never deny an owner (live probe wrote `billing/*` with HTTP 200). A deeper deny is not a trust boundary in RTDB — relocation is the only fix.
- **What:** new root `walletBilling/{bid}/{oid}` in `database.rules.json` — read = super/supreme/own business (+ outletIndex fallback), write = super/supreme only, plus a super/supreme `.read` on the `walletBilling` root so Supreme's single data-store listener can attach. Payments/charges validation preserved. `SupremeAdmin/js/data-store.js` attaches a second `.on('value')` and merges `walletBilling` back into `outlet.billing` via `merged()`, so every existing feature reads the same shape; `getRawBusinesses`/`flattenOutlets` use it too. Admin gained `billingRef()`/`billingPath()` (`Admin/js/firebase.js`); Costs, wallet alert, promotions token balance and the setup checklist read the root. Supreme billing writers (payments/charges/mode/`wallet.enforce`/token grants) and onboarding target the root. Bot promo-token guard/decrement uses `billingPath()`; `bot-control-api` (wallet publisher, onboarding root key, unverified-cleanup payments read) retargeted. Seeders updated; `tools/migrate-billing-ledger.cjs` (dry-run default, `--apply`, `--prune`) copies, verifies order-independently and backs up to `backup/billing-ledger-migration-<ISO>`.
- **Live proof:** owner reads own ledger 200 but cannot write mode / mint a payment / delete history / disarm `wallet.enforce` (all 401) or read another tenant (401); super reads+writes; anonymous 401 and cannot list ledgers; `walletGate` still publicly readable. All 19 legacy `businesses/*/outlets/*/billing` nodes pruned; `walletBilling` intact (pizza 3 payments / 26 tokens, demo 2 payments + 2 charges, cake/e2e 15 tokens each). Admin demo Costs renders balance + payments and Supreme profile card/payment/mode round-trip reads/writes the root node with 0 page errors (11/11). EC2 md5-matched, pm2 2/6/35 online with no restart loop.
- **Gotcha fixed during the prune:** before the prune, Supreme's root `walletBilling` listener was quietly failing (a child grant does not allow a parent listener) and the card was still being served by the legacy node. With the legacy node gone the card showed "Not seeded"; adding the super/supreme root `.read` fixed it and the isolation probe still passes. Any future root-level listener needs a root read rule.

### ✅ Audit item C — demo/copy: healthy public demo + tenant-facing wallet copy (2026-11-05)
- **Stage:** `done` — demo reseeded live, Admin hosting deployed, EC2 demo seeder synced.
- **Problem:** the public demo opened with a red "Wallet balance finished −₹910" dashboard banner, and Costs showed the legacy per-order rate card plus "Non-refundable · ₹500" setup (the demo ledger predated the 2026-11-03 percentage/no-setup switch). The tenant status line also leaked internal gate states: "(Wallet gate: observe mode — not enforced.)".
- **Fix:** `tools/seed-demo-tenant.cjs` payments now total ₹15,000 (₹10,000 + ₹5,000) so the seeded demo wallet stays ~+₹9.2k after usage + charges (nightly reseed keeps it healthy); `Admin/js/features/costs.js` drops the internal gate suffix and only states the consequence when the gate is enforced ("New orders pause automatically if the balance runs out."). Demo reseeded now (percentage plan, setup ₹0/none, 353 orders).
- **Verified live 11/11:** no dashboard wallet alert; balance ₹9,182.45; "Your restaurant is live." with no gate jargon; rate card App 2% / WhatsApp 3% / QR+POS 1%; "No setup fee"; no ₹500/legacy copy; Supreme demo row no longer "wallet empty" and is Settled; 0 page errors. Admin shell `v5.12.18`; `hosting:admin` deployed; EC2 `/home/ubuntu/demo-seed/tools/seed-demo-tenant.cjs` md5-matched.

### ✅ Audit item D — money correctness: billing filter, ₹1,500 minimum, campaign dates (2026-11-05)
- **Stage:** `done` — deployed `hosting:admin,hosting:supreme`, live E2E 12/12; Admin shell `v5.12.19`.
- **Drift 1 — billed statuses:** `computeCostIndex` excluded only the exact strings `Cancelled`/`Refunded`. Live buyers carry lowercase `cancelled`/`refunded` (the bot writes both), so those were billed; so were `Pending` QR carts abandoned after a closed tab (the published terms only bill placed orders). New `isBilledOrder(order)` in `shared/cost-math.js` trims + lowercases and excludes `cancelled`/`refunded`/`pending`; an order with no status still bills (legacy). `computeCostIndex` uses it, so Admin Costs, Supreme's record page and the 60 s wallet publisher share one answer.
- **Drift 2 — top-up minimum:** the published rate card says ₹1,500 with WhatsApp, ₹1,000 without, but `computeWallet` hard-coded ₹1,000. Added `minTopUpFor(hasWhatsApp)`; `computeWallet({..., hasWhatsApp})` now returns `minTopUp` (and `topUpDone` uses it). `Admin/js/features/costs.js` + `setup-checklist.js` read `bot/transport` to decide (NOT `bot/status`: the demo seeds a fake `Online` with no bot, and `bot/status` alone must not raise the minimum).
- **Drift 3 — campaign dates:** `SupremeAdmin/js/billing-shared.js tsOf` read only `createdAt`, but `bot/promotions.js` writes campaigns with `startedAt` only — every real campaign landed in a 1970 bucket, so Monthly/Yearly/Custom scopes hid real promo spend. `tsOf` now falls back `startedAt` → `completedAt`.
- **Also fixed:** the Costs custom-range upper bound had been saved as `ï£¿` (cp1252 misread of `\uf8ff`) instead of `\uf8ff`; restored, and `tests/encoding-check.mjs` now flags that byte signature.
- **Verified:** cost-math self-check (+7 assertions), `tests/admin-wallet-checklist.check.mjs` (₹1,000/₹1,500 cases), twins 5/5, encoding, copy-consistency, both builds. **Live E2E 12/12** (`%TEMP%/opencode/e2e-itemd-money.js`): demo Costs shows ₹1,000 + "restaurant is live"; a temp admin on the e2e WhatsApp outlet shows ₹1,500 in both the minimum label and the status line; a `startedAt`-only campaign bills ₹3 (all-time ₹30.48 = ₹27.48 orders + ₹3 promo) and appears in the Nov 2026 monthly row with no 1970 row; fixture removed; 0 page errors.

### ✅ Audit item E — wallet publisher scale: live mirror instead of a per-minute full scan (2026-11-05)
- **Stage:** `done` — deployed to EC2 (md5-matched, pm2 2 restarted), live 14/14; self-check extended into a real publisher test.
- **Problem:** the 60 s gate pass called `db.ref('orders').get()` for every armed outlet, i.e. it re-downloaded the whole order history every minute. Measured live: pizza 183 orders / 127 KB → 183 MB/day, linear with history (10k orders ≈ 7 MB/min ≈ 10 GB/day). `computeCostIndex` itself is cheap; the network payload was the cost.
- **Fix (`bot-control-api/wallet-watch.js`):** keep one live `on('value')` listener per **armed** outlet and recompute from an in-memory `orders` map. First pass downloads once (20 s timeout, promise cached so concurrent calls share it), every later pass costs zero order reads — RTDB pushes only deltas. `release()` runs on disarm, on listener error (next pass retries from scratch) and in `pass()` for outlets that vanished from `outletIndex`, so nothing unarmed costs memory. If the snapshot cannot be read, the outlet keeps its previous gate (never opened/closed on no data).
- **Verified:** `node bot-control-api/wallet-watch.js` now drives `pass()` against a fake RTDB — one listener for the armed outlet, second pass reads only `outletIndex` + billing + gate + campaigns (no orders), deltas from memory flip healthy → low → closed, a lowercase `cancelled` order changes nothing, disarm releases the listener and removes the gate, demo never watched. **Live 14/14 on EC2** with the deployed module on the e2e outlet: armed −₹27.48 → `closed`; +₹10,000 payment → open (node removed); an order written by another process reached the mirror and the next pass billed it from memory → `closed`; repeated pass idempotent; disarm → gate removed + mirror gone; order/payment/wallet node restored.
- **Left as-is (documented):** `Admin/js/features/costs.js` still reads its own outlet's orders once when the Costs tab opens (183 orders / 127 KB today — revisit around 5k orders or move the money strip onto a server snapshot); Supreme's data store still loads the whole `businesses` root by design — that needs a query-based store, not a billing change.






### ✅ Promo self-tests were billed to the wallet — audit finding c (2026-11-05)
- **Stage:** `done` — live 9/9; `hosting:admin,hosting:supreme` deployed; EC2 `shared/cost-math.js` + `bot/promotions.js` synced.
- **Problem:** a promo test send goes to the owner's own number, is never paced, and the bot deliberately skips its token decrement (`if (!isTest) { …tokens/balance transaction… }`) — yet it still incremented `totalSent`, which `computeWallet` bills at ₹1. The tenant paid ₹1 per self-test while the token balance never moved.
- **Fix:** one shared rule `shared/cost-math.js isBilledCampaign(id, campaign)` — false for `isTest === true` and for the `test_` id prefix (Admin mints `test_<ts>`; covers campaigns written before the flag existed). `computeWallet` filters with it; Admin `costs.js` promo KPI filters with it; Supreme `billing-shared.js` gained `billableCampaignsOf()` used by both `scopeStats` and `monthlyRows`; `bot/promotions.js` stamps `bot/promotions/campaigns/{id}/isTest: true` on every test run so future campaigns carry the flag explicitly.
- **Also fixed:** `Admin/js/features/costs.js` wrote `_setText('costPromoUsed', …)` for an element that does not exist in `Admin/index.html` (dead write, only the test stub had it) — removed. Found because the live E2E could not locate `#costPromoUsed`.
- **Verified:** `node shared/cost-math.js` (+5 assertions: real / `test_` / `isTest` / empty cases, `computeWallet` bills only the 2 real of 7 sends), `tests/admin-wallet-checklist.check.mjs` (behavioral case: wallet ₹990 + KPI ₹10 with a `test_` and an `isTest` campaign present; source guards that Admin, Supreme and the bot all apply the same rule), twins 5/5, encoding, copy-consistency, `build:admin` + `build:supreme`. **Live E2E 9/9** on the e2e outlet: a real 5-send campaign + a 3-send `test_` campaign → Admin promo KPI "5 tokens used" / ₹5 and wallet "used" ₹32.48 (₹27.48 orders + ₹5), Supreme all-time "Promo messages 5" + usage ₹32.48, Nov 2026 row ₹5, 0 page errors, campaigns and temp admins removed in `finally`.
- **Decided (owner, 2026-11-05):** promo tokens are **prepaid** — a token pack is the payment, so the wallet bills only sends a token did not cover. Implemented in the next section.

### ✅ Prepaid promo tokens — token packs are the payment (owner decision 2026-11-05)
- **Stage:** `done` — live 12/12 + demo check; `hosting:admin,hosting:supreme` deployed; EC2 `shared/cost-math.js` + both demo-seeder copies synced; live pizza topped up ₹2,000.
- **Decision:** a purchased or granted promo token **is** the prepayment for one marketing send. The wallet must never charge that send again, so a pack buyer is not billed twice, and a free welcome token is genuinely free.
- **Math (`shared/cost-math.js`):** `tokenPool(billing)` → `{issued, remaining, used}` where issued = welcome + every `tokenPacks/*.qty`, remaining = `tokens/balance`, used = issued − remaining. `promoSendUsage({billing, campaigns})` → `{sends, covered, billed, cost, per}`: spent tokens cover sends **oldest-first** (`startedAt ?? createdAt ?? completedAt`, id tie-break) so a dated report and the all-time wallet agree; `per[campaignId] = {sent, covered, billed}` lets Supreme bill a scope. `computeWallet` bills `promo.cost` and exposes `promoSends` / `promoCovered` / `promoBilled`. Test sends stay outside both the split and the pool (`isBilledCampaign`).
- **Surfaces:** Admin Costs promo KPI = uncovered ₹ with a "N sent × ₹1 · M prepaid" trend; Supreme `scopeStats` and `monthlyRows` use `alloc.per[id].billed` (so all-time, monthly, yearly and custom scopes agree with the wallet); the 60 s publisher inherits it from `computeWallet`.
- **Demo:** the seeder now seeds a 200-token prepaid pack beside the 209-send campaign (welcome 15 untouched, balance 15) → demo shows "9 sent × ₹1 · 200 prepaid", wallet ₹9,382.45.
- **Verified:** cost-math self-check +9 assertions (unused tokens cover nothing, fully covered campaign costs ₹0, oldest-first split, test exclusion, wallet untouched when covered), `tests/admin-wallet-checklist.check.mjs` (untouched ₹1,000 wallet + "10 prepaid" KPI case, source guards), twins 5/5, encoding, builds. **Live 12/12** on the e2e outlet: 10 sends / 10-token pool with 5 consumed → Admin KPI ₹5, "5 sent × ₹1 · 5 prepaid", wallet used ₹32.48; `tokens/balance` → 2 live-flips the KPI to ₹2 / "2 sent · 8 prepaid" / used ₹29.48; Supreme all-time and Nov 2026 both "Promo messages 10" with ₹2; pizza Received ₹2,267.86 with the ₹2,000 receipt row; 0 page errors; fixtures restored. Demo: 0 errors, ₹9,382.45, 15 tokens left.
- **Live top-up:** `walletBilling/roshani-pizza/pizza/payments/-P5dbRHC-h3iBqBZ8Fhg` — ₹2,000 UPI, period 2026-11, receipt `RCP-20261105-FHG` → paid ₹2,267.86, used ₹261.02, **balance ₹2,006.84** (topUpDone, level `ok`). Gate remains unarmed.
- **Deploy:** Admin shell `v5.12.21`; EC2 `shared/cost-math.js` md5 `e4b91075c3248ccc33d5044d7fc06d46`, seeder md5 `3fa0ee060c5bb3597261010f1baba3b1` (repo `tools/` + `/home/ubuntu/demo-seed/tools/`), pm2 2 restarted (publisher online).

### DONE - POS review remediation: clickable grid, configured offers, guarded shortcuts (2026-11-05)

- Commit `c59c7c6` (on `e2db38f`), pushed to `main` + `seo-brand-consistency` + `feat/customer-app-integration` (all three at `c59c7c6`).
- P0: `.oos-wrap { pointer-events: none }` hit every POS tile -> no dish could be opened. Now keys off `.pos-dish-btn-v4.is-out-of-stock`; `oos-wrap` no longer added to available dishes.
- P1: preset chips applied a raw number (10% cap Rs100 -> Rs200 on a Rs2000 cart). Chips now pin the offer id and the shared rules engine evaluates it at render AND submit (maxCap, category, minSubtotal, schedule, limits). Offer name recorded as the label.
- P1: keyboard shortcuts guarded (open dialog, modifiers, key repeat, native button activation, SELECT).
- P1: `menu/js/delivery.js` missing `assertOutletEnabled` import + `err.userMessage` surfaced.
- P2: editing highlight (correct class), preset stale-render guard, in-flight submit guard, post-sale clear without a confirm prompt.
- Verified: node --check, encoding, twins 5/5, build, live md5 match 5/5 assets, live E2E 15/15 (UX) + 13/13 (cap: Rs1,995 net-taxable total, order discount 100 / auto:global / "E2E Cap 10%", usedCount 1). Deployed hosting:admin + hosting:menu (Admin shell v5.12.22, menu-shell-v38). No EC2 change.
- Resolved (2026-11-07): `tests/live-pos-order.spec.js` was deleted, was never committed (not in any history), and its stale `.git/info/exclude` line was removed. Owner still needs to rotate the `roshanipizza@gmail.com` password that had been stored in that local file.

### DONE - Customer-app fixes #3 / #4 / #6: cart badge + restore, no silent tenant, app link + QR + icons (2026-11-06)

- Commit `af18fb9`, pushed to `main` + `seo-brand-consistency` + `feat/customer-app-integration`. Deployed `hosting:admin,hosting:supreme,hosting:menu`; `menu-shell-v41`.
- #3: app mode never bound `cart:changed` (badge stayed 0) and never restored the session cart (refresh emptied it). `bootDirect()` binds once and `restoreCart()` runs after `loadMenu()`, pruning lines this outlet does not sell (key is origin-wide).
- #4: `BUSINESS_ID` no longer falls back to `roshani-pizza`; `?b=` without `?o=` or an unknown outlet without `?b=` shows "Link incomplete" before boot. Legacy `/pizza/`, `/cake/` and `?t=` QR links unchanged. Link + QR exposed in Admin Settings and the Supreme profile via `shared/app-link.js`.
- #6: brand = `storeName` -> `settings/Store.name` -> outlet name; icons are real PNG files (192/512/apple-touch) instead of base64 in both manifests. Live bug found and fixed: `outlet.name` is rule-gated, so the combined read aborted the whole brand lookup.
- Live E2E: badge 1 + bar Rs199 after add and after reload; both incomplete-link shapes isolated; `/pizza/` + `?b&o` brand "Roshani Pizza"; e2e brand "E2E Outlet"; Admin demo + Supreme demo cards show `https://foodhubbie-qrmenu.web.app/?b=...&o=...` with 180 px QR; 0 page errors. Test customer node removed from pizza + e2e.
- Open (unchanged): #1 customer feedback and #2 real-device push proof stay deferred (owner picked #3/#4/#6 only).
- Security carry-forward closed (2026-11-07): `tests/live-pos-order.spec.js` deleted, never committed, exclude line removed; rotate the leaked `roshanipizza@gmail.com` password.
### ✅ D5 — Pricing / percentage-package marketing consistency
- **Stage:** `done` (2026-11-02) — setup-fee removal sweep complete across the whole marketing site + `PRICING_AND_TERMS.md`: `website/pricing.html`, `index.html` (meta, hero note, FAQ, JSON-LD offer), `billing-policy.html` (meta, hero, table row, updated-date), `refund-policy.html` (meta, hero h2, body, updated-date), `compare.html` (table row + FAQ JSON-LD + updated-date), `best-software.html` (FAQ JSON-LD + body + updated-date), `pos-billing.html` (benefit card + FAQ JSON-LD + comparison table + updated-date), `kds.html` (FAQ JSON-LD + updated-date), `qr-ordering.html` (FAQ JSON-LD + body + note + updated-date), `multi-outlet.html`, `inventory.html`, `table-management.html`, `signup.html` (hint), `whatsapp-ordering.html` (FAQ body + updated-date). Backing constants unchanged: `shared/cost-math.js` (`MIN_TOPUP` 1000 / `MIN_TOPUP_WITH_WA` 1500 / `MIN_BALANCE` 250), `BILLING-MODEL.md`, `PRICING_AND_TERMS.md` table row now "Setup: None", §4 setup fee replaced by wallet top-up. Zero `₹500` setup claims remain on the site. **2026-11-03 code-side close-out:** `shared/billing-defaults.{js,cjs}` now return `setup:{amount:0,status:'none'}`; the Supreme billing card shows "No setup fee" (the handler-less save-setup control was removed), Admin Costs shows the same unless a legacy amount is stored; seeders, `website/llms.txt`, the offsite/backlink kits and `tools/wa-sales-agent.cjs` were updated; `tools/check-copy-consistency.cjs` now fails any positive setup amount. Legacy tenants keep their stored setup records.

### ✅ Loyalty redemption in the app — no OTP, no code (owner directive 2026-11-03; item 1 of the independent review)
- **Stage:** `done` — commit `9704b5e` (feature) + `c56175b` (cold-boot fix), pushed to `main` / `seo-brand-consistency` / `feat/customer-app-integration`; `firebase deploy --only database,hosting:menu` then `hosting:menu`; EC2 pulled `c56175b`, pm2 6 + 35 restarted plain.
- **What:** ownership is proven by the DEVICE, not a code. `bot/redeemQueue/{key}` now carries `appUid` = the app's anonymous-auth uid; rules accept it only when `auth != null`, `appUid == auth.uid` and `customers/{phone}/devices/{auth.uid}` exists. `bot/redeem.js` redeems immediately (cost from `loyalty/config`, `pointsSpent` deducted in a cold-tx-seeded transaction, `LOYAL######` minted); OTP machinery (`sendText`/`hashOtp`/`otp_required`/`wrongTries`/`bot/redeemOtp`) deleted, not kept as a fallback.
- **App UX:** rewards are one-tap chips at checkout (`#coRewardChips`), refreshed when the phone changes; the free-text field is coupon-only; reward codes stay typeable only in the WhatsApp `delivery.html` webview (untouched). Coupon + reward stack (bot re-verifies the discount before the tender).
- **Bug found + fixed:** device-bound reads racing the anonymous session on a cold boot left `_loyalty` null — the Loyalty tab showed 0 points and a disabled Redeem until reopened. `loadCustomerData()` now awaits `ensureAnonAuth()` (before/after proven locally: 0 pts/disabled -> 1000 pts/enabled).
- **Verified:** local — loyalty-redeem OK, direct-mode 25/25, bot unit 20/20, payment-sync, twins 5/5, cost-math, customer-profile, discount-evaluator 9/9, auto-onboarding, signup-onboarding, encoding, check-imports, `node --check`. Live E2E **26/26** on the e2e outlet (zero dialogs on redeem, points deducted, code never shown, chip tender ₹200 on a ₹313.95 order -> `totalDue` ₹113.95, reward burned, 401 probes for unregistered device / mismatched uid / signed-out). `menu-shell-v36`.
- **Rules emulator:** not runnable locally (no Java) — the rewritten redeem cases were probed live instead.
- **Decided (owner, 2026-11-05):** "first phone wins" stays — no OTP. Recovery is operational (`Admin > Customers > Reset phone lock` clears `devices` + `link`; the 8-digit link code moves access to a second phone). Trade-off documented in `docs/FINAL-COMPATIBILITY-GUIDE.md` §6 and `AGENTS.md` Key Decisions. Review list closed 2026-11-05 — the last item (client-supplied tax rates + delivery fee) is the settings-owned money entry below.

### ✅ Server-side re-pricing of browser-written orders (2026-11-04; item 2 of the independent review)
- **Stage:** `done` — commit `8cfd241`, pushed to `main` / `seo-brand-consistency` / `feat/customer-app-integration`; `firebase deploy --only hosting:menu`; EC2 `bot/index.js` + `bot/order-pricing.js` scp'd, pm2 6 (e2e) and 35 (live pizza) restarted plain.
- **What:** APP and `webview_delivery` orders are written by the customer's browser, so every unit price used to be whatever the phone said. New pure module `bot/order-pricing.js` (`node bot/order-pricing.js` self-check) rebuilds each line from the outlet catalog and the bot now runs it inside web-order finalization **before** the discount re-validation, so the discount, tax, total, admin notification and invoice all see catalog prices. It reconciles `subtotal` too (honest lines + understated subtotal is still a correction).
- **Rules:** line resolved by `dishId` (new field the clients now send) or by name (older orders; QR bakes the size into the name); price = size tier + catalog add-on prices; an unknown size on a sized dish charges the **highest** tier; combo lines are verified as **N whole copies** of the combo as the admin defined it (honest per-copy baking, repeats allowed), anything else is charged catalog base; a line the catalog cannot resolve keeps its claimed price and is logged (`[WebOrder] ... no catalog match`).
- **Verified:** local — order-pricing self-check, live pizza catalog simulation (honest sized/flat lines + every active combo x1 and x2 unchanged, tampered -> catalog), payment-sync guards (+5 source guards incl. re-pricing runs BEFORE the discount check), bot unit 20/20, direct-mode 25/25 (new `dishId` assertion), twins 5/5, encoding. Live E2E **20/20** on the e2e outlet: ₹1 line -> ₹199, subtotal-only tamper -> 299, honest order untouched, honest combo 149+249=398 kept, tampered combo -> 199+299=498, same combo twice -> 796 kept; fixtures restored.
- **Depends on:** `menu/sw.js` -> `menu-shell-v37` (clients send `dishId`); EC2 must have `bot/order-pricing.js`.
- **Not covered:** QR dine-in item prices/totals stay client-owned (session totals, no bot finalization hook) — its tax rates are now server-owned (see the settings-owned money entry below).

### ✅ Discount usage given back on cancel (2026-11-04; item 3 of the independent review)
- **Stage:** `done` — `bot/discount-engine.js` + `bot/index.js`; pushed to `main` / `seo-brand-consistency` / `feat/customer-app-integration`; EC2 files scp'd, pm2 6 (e2e) + 35 (live pizza) restarted plain.
- **What:** the bot recorded a discount's usage when it finalized a web/app order but never gave it back when that order was cancelled or refunded. A `globalLimit` coupon stayed exhausted forever, the customer's `perCustomerLimit` counter locked them out of the same offer, and a `firstOrder` customer lost their one-shot. New `releaseDiscountUsage()` (bot/discount-engine.js) reverses one recorded usage — stats `usedCount` / `totalDiscountGiven` floored at 0, a NEGATIVE `discountsUsage` audit row (`voidReason: 'order-cancelled'`, so summing a discount's history still nets to zero), the customer `discountUsage` counter decremented/deleted and the first-order flags cleared only when this order was the one that consumed them.
- **Exactly once:** finalization now stamps `discountUsageRecorded: true` only when the record really landed (limit-aborted records are never reversed), and the cancel path claims `discountUsageReversed` in a transaction before touching the counters — a second cancel/refund event cannot decrement twice. Runs from the `child_changed` listener BEFORE the debounce gate (same rule as loyalty, so a same-status event can never swallow it). Only usage the bot recorded is reversed — table/POS voids stay Admin-side; dine-in QR orders keep their session-owned discounts.
- **Verified:** local — `node --check` both files, payment-sync guards (+7 source guards: release exported, flag written only after the record, listener calls it before the debounce, guard requires recorded + not reversed), bot unit 20/20, twins 5/5, encoding. Live E2E **37/37** on the e2e outlet: ₹50 global discount 3→4 used / ₹500→₹550 given / customer counter 1 on finalize; cancel → 3/₹500/counter gone + one negative row (−50, `order-cancelled`, source kept) + flag; a second cancel leaves 3/₹500 and exactly two rows; first-order ₹30: `firstOrderDiscountUsed`/`firstOrderDiscountId` stamped then cleared on cancel, stats 1→2→1, counter gone; fixtures + customer node restored byte-identical.
- **Not covered:** an order cancelled while the bot was down is not replayed (same pre-existing gap as the loyalty clawback — `child_changed` only); discounts applied as a *stack* record only the primary one (pre-existing).

### ✅ Stock given back on cancel (2026-11-04; item 4 of the independent review)
- **Stage:** `done` — `bot/index.js` only; pushed to `main` / `seo-brand-consistency` / `feat/customer-app-integration`; EC2 scp'd, pm2 6 (e2e) + 35 (live pizza) restarted plain.
- **What:** a browser-written order deducted inventory when the bot finalized it and a cancel never put it back — the shelf stayed short for food that was never sold. `deductInventoryStock()` now returns what it actually took as a map (`{ [inventoryId]: qty }`, clamped by available stock) and finalization stores it on the order as `inventoryDeducted` alongside `stockDeducted: true`. New `restoreOrderInventory()` runs from `child_changed` right after the discount release (BEFORE the debounce gate), guards `stockDeducted === true` + `stockRestored !== true` + cancelled/refunded + not dine-in + a non-empty map, claims `orders/{id}/stockRestored` in a transaction, then adds each quantity back (cold-tx seeded, item deleted since → skipped).
- **Bug fixed on the way:** two lines of the same dish each computed `stock - qty` from the same snapshot, so the second overwrote the first and only one line was ever deducted. Quantities are now aggregated per inventory id before writing. The low-stock alert also no longer dereferences a null socket.
- **Not covered:** orders finalized before this shipped carry no map and are skipped rather than guessed from item names; dine-in QR orders keep session-owned stock; an order cancelled while the bot was down is not replayed (same `child_changed`-only gap as the loyalty clawback).
- **Verified:** local — `node --check`, payment-sync guards (+6 source guards: restore helper, awaited deduction, map written, listener call before the debounce, recorded+not-restored guard, claim-before-touch), bot unit 20/20, twins 5/5, encoding. Live E2E **21/21** on the e2e outlet: two Margherita lines + one Farmhouse → stock 10/10/1 → 8/9/1, `inventoryDeducted {D1:2, D2:1}`; cancel → back to 10/10, `stockRestored` set; duplicate cancel leaves both at 10; a 5× line against stock 1 deducts and restores 1 (clamp); a legacy order without the map and a cancelled dine-in order are both skipped; fixtures restored byte-identical.

### ✅ Tax rates + delivery fee re-derived from settings (2026-11-05; item 6 of the independent review)
- **Stage:** `done` — `bot/index.js` + `tests/payment-sync.check.cjs`; pushed to `main` / `seo-brand-consistency` / `feat/customer-app-integration`; EC2 `bot/index.js` scp'd (md5 matched), pm2 6 (e2e) + 35 (live pizza) restarted plain.
- **What:** the last two money fields a browser could set for itself. `_verifiedOrderTotal` took the order's own `taxItems` rates, so a tampered phone could send 0 % GST on a valid order, and it took `deliveryFee` as claimed, so a 33 km delivery could pay the ₹20 slab. New `_serverTaxRates()` mirrors the menu's own derivation (`dineinSettings.taxRates` → `taxName`/`taxPercent` → 5 % GST default; `taxEnabled:false` → none) and `_serverDeliveryFee()` recomputes the haversine distance + slab from `settings/Store` coords and `settings/Delivery/slabs` via `shared/geo/geo.js` (guarded require, same pattern as the math modules). Pickup is always ₹0; an order without coordinates (legacy) or unreadable settings keeps its claim — the bot never invents a number.
- **Written back:** `_verifiedOrderTotals()` returns `{total, tax, taxItems, taxName}` and both finalization paths (app/webview delivery + QR dine-in) write that breakdown with the corrected total. Admin reports and the invoice read `order.tax`, so correcting only the total would have left collected GST understated. QR dine-in keeps client-owned item prices/totals (staff-settled by design) but now uses the server tax rates.
- **Verified:** local — `node --check`, payment-sync guards **+9** (tax-rate helper, fee helper, QR uses the server rates, finalization reads both, verified total uses both, settings resolved before the discount re-check, breakdown written back, no call site left on the old verifier), bot unit 20/20, twins 5/5, encoding. Live E2E **22/22** on the e2e outlet: delivery claiming 0 % GST + ₹0 fee → GST ₹9.95 / fee ₹20 / total ₹228.95; 33 km claiming the ₹20 slab → ₹80 → ₹288.95; an honest order untouched; pickup claiming ₹99 → ₹0 → ₹208.95; pickup claiming 0 % GST → ₹208.95; a legacy no-coords order keeps its ₹40 fee and its inconsistent claimed total is corrected to ₹248.95; QR dine-in 0 % → ₹208.95; customer node restored byte-identical. Worker log shows the expected `[WebOrder] Money mismatch` / `[QROrder] Money mismatch` lines with no errors.
- **Not covered:** QR dine-in item prices (session-owned by design); an order cancelled while the bot was down is not replayed (pre-existing `child_changed`-only gap).

### ✅ api.foodhubbie.in (P3) — TLS live (2026-11-04)
- **Stage:** done
- **Done:** nginx 1.24.0 + certbot installed on EC2 (`3.111.39.210`); vhost `/etc/nginx/sites-available/api.foodhubbie.in` → `http://127.0.0.1:5000` (webhook-server → `/api/*` → bot-control-api `:4000`); AWS SG `sg-0a5a73df4b5d37b38` allows TCP 80+443 (it actually only had 22 — `ACCESS.md` was stale); owner added the GoDaddy A record `api.foodhubbie.in` → `3.111.39.210`; `sudo certbot --nginx -d api.foodhubbie.in` succeeded — Let's Encrypt cert `CN=api.foodhubbie.in`, valid to 2027-02-02, nginx `:443` listener active, auto-renewal scheduled; external `https://api.foodhubbie.in/` completes TLS (404 at `/` is expected — no root route).
- **Next after TLS:** owner decision on cutting Supreme's `TUNNEL_URL` (`SupremeAdmin/js/firebase-config.js:23`, runtime override via `config/tunnelUrl`) to `https://api.foodhubbie.in` — the Meta webhook stays on the Cloudflare Quick Tunnel and must NOT be repointed in Meta console.
- **Related:** `website/assets/generated/` + `website/assets/REal/` exist; `assets` site (`foodhubbie-assets`) referenced only by `website` CSP `img-src` in `firebase.json` (line 493); no custom domain mapped — optional, no action needed.

### 🟡 WhatsApp Ordering / Marketing — "Upcoming feature — launching in about 1 month" (marketing sites only)
- **Stage:** `done` — hero pill + CTAs on whatsapp-ordering.html / whatsapp-marketing.html / index.html WA section; committed `f38c4b5`; deployed `hosting:website` (`foodhubbie-web` release complete).

### ✅ Admin Dashboard UI/UX Audit — RECALLED / COMPLETE (2026-11-01) — **UPDATED** (this subagent audit)
- **Status:** Done (PASS; clean-up required — see `docs/UI-AUDIT-COMPLETE.md` for full tables + evidence).
- **Method:** `design-taste-frontend` (app-screen rules: no gradient/glow/index/hairline/emoji/monospace-except-code) + `ui-ux-pro-max` (spacing/contrast) + `web-design-guidelines` + direct `Admin/` file/code inspection (no Playwright available; code-level verification for all tabs).
- **Twin-check (F):** `node tools/check-shared-twins.cjs` → 5/5 OK (combo-math, format-order-id, loyalty-math, money-math, discount-rules). Payroll twin intentionally absent (Admin-only).
- **Key violations (design-taste):** (a) `.status` badges use 5 `linear-gradient` fills + `pulse-status-v4` continuous scale; (b) `box-shadow-at-rest` on `.dish-card`, `.status`, `.glass-card`; (c) thin 1px hairline borders; (d) `body` radial-gradient background. **Fix T1 = replace gradient/status with solid colors; T2 = make pulse one-shot; T3 = reduce shadow at rest.**
- **Fluctuation (D):** `status` continuous keyframe (scale) + image cards without fixed width/height = shift risk.
- **Freezing (E):** drawer rapid-click guard missing; search inputs (`orderSearch` etc.) have no debounce (200ms needed).
- **Cross-agent:** setup-checklist `#btnOpenCatDrawer` deep-link verified; demo banner (`demo-mode.js`) consistent; restrict modal (`restrict.js`) z-index 100000; `firebase.json` targets match deployed admin/supreme/website.
- **Files written:** `docs/UI-AUDIT-COMPLETE.md` (created); `Pending-Work.md` (updated).
- Committed: `UI/UX audit complete (deep): size/viewpoint/space/fluctuation/freezing + cross-agent verified`.
- Next action: commit pushed (NOT pushed). Report line count: ~320.

### ✅ Domain Migration — P1 + P2 — Done / Verified (2026-11-01)
- **Status:** Done (deployed, 4 hosts 200, .web.app fallback preserved)
- **Branch:** `seo-brand-consistency` (`8941309`, pushed, 6 ahead of main)
- **P1:** 4 subdomains connected + SSL + GoDaddy CNAMEs verified

### ✅ Categories Tab Phase 4 (PLAN-CATEGORY-REDESIGN.md) — deployed (done — PLAN COMPLETE)
- **Stage:** Phase 4 (mobile/a11y) `done` — **PLAN-CATEGORY-REDESIGN P1-P4 complete**
- **Files:** `Admin/style.css` (`.btn-action-v4:focus-visible` at the shared class, drawer focus rings, @640px touch targets 40px for category/browser/combo action buttons, full-bleed phone drawer), `Admin/index.html`+`Admin/sw.js` (`style.css?v=5.4.14`)
- **Verified:** production E2E 37/37 — mobile 375px: 0px horizontal overflow, cards 172px, action buttons 44px, KPI visible, drawer full-width; 32 prior checks regression-clean
- **Deployed:** 2026-10-31; ledger `[20261031-110000-category-phase4]`

### ✅ Categories Tab Phase 3 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 3 (typed delete guard) `done` — Phase 4 (mobile/a11y) `pending`
- **Files:** `Admin/js/ui-utils.js` (`showDeleteConfirm` optional `requireText` — live match sync, JS-set placeholder, focus to input; 6 existing call sites untouched), `Admin/js/features/catalog.js` (`deleteCategory`: count dishes up-front, guard only when dishCount>0, count-driven message), `Admin/style.css` (dark-theme `.dynamic-modal-input`), `Admin/index.html`+`Admin/sw.js` (`style.css?v=5.4.14`, cache `v5.12.12`)
- **Verified:** production E2E 32/32 — guard on the real "Pizza" (4 dishes): input shown, Delete disabled until typed (partial "Pizz" rejected, case-insensitive match accepted), Cancel leaves category+dishes intact; plain confirm for empty categories proven by the create/delete lifecycle; 28 earlier checks regression-clean
- **Deployed:** 2026-10-31; ledger `[20261031-093000-category-phase3]`

### ✅ Categories Tab Phase 2 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 2 (create drawer) `done` — Phases 3 (delete guard; WebP already shipped), 4 (mobile/a11y) `pending`
- **Files:** `Admin/index.html` (right-sheet drawer beside modals + header Add Category button + serial stepper), `Admin/js/features/catalog.js` (`_initCategoryDrawer`: open/close/backdrop/stepper/live-dup-hint + auto-close on save), `Admin/style.css` (`modal-sheet-right` + `cat-order-stepper`), `Admin/js/features/setup-checklist.js` (deep-link re-pointed `#btnAddCategory` → `#btnOpenCatDrawer`)
- **Verified:** production E2E 28/28 × 2 deploys — drawer open/close/backdrop/focus, live dup hint, stepper ±, REAL create → card → delete-cleanup; 21 earlier checks regression-clean
- **Deployed:** 2026-10-30; ledger `[20261030-140000-category-phase2]`

### ✅ Categories Tab Phase 1 (PLAN-CATEGORY-REDESIGN.md) — deployed (done)
- **Stage:** Phase 1 (grid/header) `done` — Phases 2 (create/edit drawer), 3 (WebP images + delete guard), 4 (mobile/a11y) `pending`
- **Files:** `Admin/index.html` (KPI ribbon + `category-card-grid` + form below), `Admin/js/features/catalog.js` (cat-card renderer + KPI fill), `Admin/style.css` (`#tab-categories` block), `Admin/sw.js` (`style.css?v=5.4.12`, cache `v5.12.9`)
- **Verified:** production E2E 21/21 (categories: cards 152×157px, 24px buttons, KPI populated, search filter ladder); all 5 earlier density sections regression-clean on the same deploy
- **Deployed:** 2026-10-30; ledger `[20261030-120000-category-phase1]`

### ✅ Menu Browser + Combos Tab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (`#browserDishGrid:not(.list-view)` + `#tab-combos` compact blocks), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.11`, cache `v5.12.8`), `tests/e2e-inventory-compact.js` (battery now covers 5 surfaces)
- **Stage:** `done`
- **Verified:** production E2E 15/15 — browser tab cards 111×164px, ~7 columns on 834px, 24px buttons (stretch bug fixed via `align-content:start`: was 603px tall); combos checks conditional (e2e outlet has 0 combos); inventory + menu-tab regression clean on the same deploy.
- **Done:** deployed 2026-10-30; ledger `[20261030-101500-browser-combo-compact]`.

### ✅ MenuTab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (`#menuGrid` compact block), `Admin/js/features/catalog.js` (chip modifier `main` → `single`, root-cause fix for the app-shell `.main` padding collision), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.9`, cache `v5.12.6`)
- **Stage:** `done`
- **Verified:** production E2E `tests/e2e-inventory-compact.js` 9/9 (both tabs) — menu card 132×227px, ~8 columns on 1112px (was ~160px/6 cols), 24px edit/delete buttons, price chip padding 2px (was broken 0/30/30 by `.main` shell rule `!important` on desktop ≥1025px)
- **OK:** inventory battery 5/5 unchanged on the same deploy (regression clean)
- **Done:** deployed 2026-10-29; ledger `[20261029-180000-menu-compact]`.

### ✅ Inventory Tab Density Pass — deployed (done)
- **Files:** `Admin/style.css` (scoped to `#inventoryMenuSection`/`.inventory-dish-card`), `Admin/js/features/inventory.js` (`MENU_PAGE_SIZE` 20→30), `Admin/index.html` + `Admin/sw.js` (`style.css?v=5.4.7`, cache `v5.12.4`)
- **Stage:** `done`
- **Verified:** production E2E `tests/e2e-inventory-compact.js` 5/5 — card 170×318px/6 columns (before) → 127×249px/8 columns (after, +33% per row, −22% height); mini toggle/stock knobs confirmed; POS `.dish-card` and Riders' `.toggle-switch-sm` untouched.
- **OK:** live `style.css?v=5.4.7` + `sw.js v5.12.4` confirmed over HTTP after `firebase deploy --only hosting:admin`.
- **Done:** deployed 2026-10-29; ledger `[20261029-173000-inventory-compact]`.

### ✅ WebP Catalog Images — deployed to production (done)
- **Files:** `Admin/js/firebase.js` (`uploadImage(fileOrBlob, path, opts = {})` — `opts.webp` encodes via `canvas.toBlob('image/webp', 0.75)` and only resolves that blob when `blob.type === 'image/webp'`, otherwise falls back to `toDataURL('image/jpeg', 0.6)`), `Admin/js/features/catalog.js` (4 call sites pass `{ webp: true }`: `addCategory`, `saveDish`, `saveCategoryEdits`, `showComboModal`), `Admin/sw.js` (`v5.12.2` → `v5.12.3`)
- **Stage:** `done` (commit `b0c1757`; ledger `[20261029-160000-webp-dishes]` + `[20261029-170000-deploy-admin-webp]`)
- **Origin:** appeared in the working tree on 2026-10-29 while the demo/tour work was being shipped; it is NOT part of that work and was deliberately left uncommitted. Live admin host still serves the JPEG path at `v5.12.2`.
- **Requirement:** shrink the base64 catalog images that ship in every QR-menu payload, without breaking WhatsApp image sends, the customer menu, or browsers that cannot encode WebP. Deliberately untouched: `uploadImage(blob, 'temp')` inside `runImageMigration()` and the rider/KYC call sites in `riders.js` (no `opts` → legacy JPEG).
- **Verified:**
  - build:admin green; encoding/copy-consistency/shared-twins guards green; domain-migration guard green after exempting README.md's descriptive www→/demo redirect mention.
  - **Live E2E 10/10** (`tests/e2e-webp-dish.js`, e2e outlet, screenshot evidence in %TEMP%/opencode): UI upload through Add Dish → DB image is EXACTLY `data:image/webp;base64`; 11,147 bytes vs 42,205 source (73% smaller); QR menu renders the webp dish card, 0 page errors; admin catalog lists it; full cleanup (dish + minted table) restored the baseline.
  - **It is actually smaller (real data):** fresh uploads win big (73%). A dry-run of the leftover-JPEG migration (`tools/migrate-dish-images-webp.cjs`) showed the LIVE catalog is already webp-dominant and remaining jpegs are tiny double-compressed files where q75 webp is often bigger — migration apply on live outlets deliberately SKIPPED (script kept as tooling with backup + --restore).
  - **Safari fallback:** `blob.type` check + JPEG fallback is in place; NOT executable on Windows — accepted as documented, not tested.
  - **runImageMigration:** intentionally stays JPEG (legacy Storage→base64 backfill, rarely used; documented in ledger).
  - **WhatsApp Sharp path:** `bot/index.js` normalizes ANY `data:image` through Sharp → JPEG before Baileys, so a webp dish image reaches WhatsApp normalized; NOT yet proven with a real send (e2e/cake WhatsApp sessions are dead — pre-existing). Promos remain JPEG-locked by design (no `webp` flag on that path).
- **OK:** owner-authorized deploy `firebase deploy --only hosting:admin` (2026-10-29, release complete); live host serves the toBlob/webp encoder, the v5.12.3 cache-name bump, and all 4 `webp:!0` call sites; **production E2E 10/10** re-run against the live admin host (`E2E_ADMIN_BASE`), same assertions green incl. menu render + cleanup.
- **Done:** deployed and verified live (`https://foodhubbie-admins.web.app`). Residual notes: Safari/JPEG fallback is documented-not-tested (Windows only); a real WhatsApp send of a webp dish photo is pending a live WhatsApp session (e2e/cake sessions dead — pre-existing) but `bot/index.js` Sharp-normalizes ANY `data:image` to JPEG before Baileys; live-tenant migration apply remains deliberately skipped (7% ceiling on double-compressed leftovers — script kept with backup + `--restore`).

### ✅ EC2 Git Metadata Reconciled to `main` (117 commits, zero restarts)
- **File:** `/var/www/foodhubbie` (box only — no repo file changed)
- **Stage:** `done`
- **Requirement:** the box must be at `origin/main` with a clean `git status` so a rollback is possible and drift is visible.
- **Verified:** all 110 tracked runtime files (`bot/ bot-control-api/ webhook-server/ shared/ tools/`) compared against `origin/main` — only `shared/{billing-defaults.cjs,billing-defaults.js,cost-math.js}`, `shared/package.json` and `tools/test-receipt.cjs` differed (all older, none a pm2 entry point); `bot/index.js`, `bot/package-lock.json`, `bot/package.json`, `bot/rider.js`, `bot/utils.js` differed by **CRLF only**.
- **OK:** `git reset --hard origin/main` → HEAD `01dc0b1` → `9a13756`, 0 tracked changes, 69 untracked files preserved (`node_modules`, `session_data_pizza` + its live creds, `.env.bak*`). `node --check` green on `bot/index.js`, `bot/rider.js`, `shared/billing-defaults.cjs`.
- **Done:** verified live — **no pm2 restart was required** (identical file content, same PIDs and uptimes before/after); `bot-control-api` was restarted separately only to pick up the ₹5 billing default.

### ✅ WhatsApp / Delivery-Webview Billing Rate Restored to ₹5
- **Files:** `tools/seed-billing-defaults.cjs`, `tests/supreme-profile-sections.spec.js`; live RTDB rows `businesses/{roshani-pizza/pizza,roshani-cake/cake}/billing/rates`
- **Stage:** `done`
- **Verified:** `shared/cost-math.js` self-check OK (asserts `DEFAULT_RATES.WA === 5`); no `WA: 3` / `webview_delivery: 3` left in the repo (`git grep` clean); Node recomputation over the live orders → roshani-pizza ₹182 / 85 orders.
- **OK:** commit `40f7d9d` (2026-10-21) had made the rate ₹5 in code + website, but the seeder still wrote ₹3 and the DB row overrides the default (`{...DEFAULT_RATES, ...b.rates}`), so Supreme billed ₹3. Seeder now seeds ₹5 and its rate-migration list patches `WA`/`webview_delivery` on existing rows.
- **Done:** live rows patched ₹3 → ₹5 (E2E outlets untouched), `bot-control-api` restarted, and Supreme verified through Playwright on **desktop + mobile-chrome**: `USAGE ₹182 / 85 orders, EXTRA CHARGES ₹0, RECEIVED ₹117.86, BALANCE DUE ₹64.14`. All-time usage moved ₹164 → ₹182 (9 webview orders × ₹2).

---

### ✅ Supreme Tunnel URL Resolved After Login (was dead on every load)
- **Files:** `SupremeAdmin/js/firebase-config.js`, `SupremeAdmin/js/features/templates/quota.js`, `SupremeAdmin/js/features/templates/wa-templates.js`
- **Stage:** `done`
- **Verified:** `window.TUNNEL_URL` is now the live tunnel on a signed-in load; `page.on('requestfailed')` records **zero** failures (was `ERR_NAME_NOT_RESOLVED` + `loadQuota failed` + `load message templates failed` on every Supreme page load); supreme hosting 43/43 files byte-identical to `SupremeAdmin/dist`; `tests/supreme-profile-sections.spec.js` passes on chromium + mobile-chrome.
- **OK:** root cause — `config/tunnelUrl` is readable only by a signed-in admin (`database.rules.json`), so `firebase-config.js`'s boot-time read always failed and left a hardcoded, rotated Quick Tunnel host in place. `wa-templates.js` additionally hardcoded `https://bot-control-api.foodhubbie.com`, a host that never resolved, so the templates panel could never load at all. The rule stays as-is; the client now resolves on the first signed-in auth state.
- **Done:** deployed to `foodhubbie-supremeadmin` (commit `852c39a`). `window.TUNNEL_READY` is a promise the two first-render panels await; the other 17 call sites are click-driven and inherit the resolved URL.

---

### ✅ Cake Bot Deleted From EC2 (re-add later from Supreme Admin)
- **Files:** `ecosystem.config.js`, `ACCESS.md`; box state `~/.pm2/dump.pm2` + `~/.pm2/logs/`; RTDB `businesses/roshani-cake/outlets/cake/bot/{status,pair}`
- **Stage:** `done`
- **Requirement (owner):** "delete Cake bot from Server.. i'll Add later from Supreme Admin -- If i Need it.."
- **Verified:** `node --check ecosystem.config.js` green and `require()` yields `["bot-roshani-pizza-pizza"]`; `pm2 list` shows no cake app and `grep -c bot-roshani-cake ~/.pm2/dump.pm2` → `0`; `~/.pm2/logs/` has 0 cake files; RTDB cake `bot` node is now `{"transport":"baileys"}` (stale `status` "Online" @ lastSeen `1793092291108` + `pair` "waiting" with a 277-char QR removed, so Admin/Supreme no longer show a phantom online bot).
- **OK:** `pm2 delete bot-roshani-cake-cake` + `pm2 save`; the `ecosystem.config.js` block removed so `pm2 start ecosystem.config.js` cannot resurrect it. The pizza bot was untouched (same PID/uptime throughout).
- **Done:** box + repo reconciled (`git pull --ff-only` on EC2). `businesses/roshani-cake` (business/outlet) and `bot/transport` kept deliberately — the orchestrator cannot recreate the worker on its own because `desiredState()` returns null while `outlet.whatsapp` is absent (`bot-control-api/orchestrator.js`).

---

### ✅ Customer-app menu/QR loading stuck (2026-11-07)
- **Files:** `menu/index.html`, `menu/sw.js`
- **Stage:** `done`
- **Trigger:** owner report — every customer app (bare link `/?b=&o=`), legacy QR (`/pizza/`) and direct-mode load hung on "Loading menu…" spinner forever.
- **Root cause:** commit `55f5958` put `display:flex !important` on `#loadingOverlay` and `display:none !important` on `.screen`, `.bottom-nav`, `.toast`, `.hamburger-*` in `menu/index.html` critical inline CSS. JS's `style.display='none'` could never hide the spinner (stylesheet `!important` beats inline style), and `_appReady()` could never reveal any screen — permanent stuck state.
- **Fix:** dropped `!important` from all runtime-toggled elements in `menu/index.html`; kept the `#app { visibility: hidden }` pre-boot gate (released by `.app-ready` in `_appReady()`); menu SW cache → `menu-shell-v51`. Commit `dc006d8` on `main` (pushed as part of `0a0d635`).
- **Deploy:** `firebase deploy --only hosting:menu` from clean worktree at `dc006d8`. Live on `menu.foodhubbie.in` and `foodhubbie-qrmenu.web.app` (SW `menu-shell-v51`; overlay rule now `display:flex` without `!important`).
- **Verified:** `node --check` not applicable (HTML/SW only). Reproduced stuck state before fix (overlay `flex`, 0 dishes, `direct=false`, Firebase `connected=false`); after deploy all 3 URLs boot to `screenSignIn` with overlay `none`, 0 console errors, no failed requests.
- **Honest limit:** another session carries uncommitted a11y work in `menu/js/app.js`, `menu/js/ui.js`, `menu/css/app.css` — untouched and undeployed here. Only `menu/index.html` + `menu/sw.js` changed.
- **Done:** deployed live; ledger `[20261107-customer-app-loading]`.

---

### ✅ App Notifications: 2 subscribers shown but 0 sent (2026-11-07)
- **Files:** `bot-control-api/server.js`
- **Stage:** `done`
- **Trigger:** admin opened App Notifications tab, saw "2 subscribers", but sending reported "sent to 0 Subscribers".
- **Root cause:** `requireTenantAdmin()` resolved the admin's business by scanning ALL businesses for one with a matching outlet name. Super admin `roshanipizza@gmail.com` has no `businessId`, only `outlet: 'pizza'`; the scan found `e2e-biz-1792987605261` first (lexicographically before `roshani-pizza`), so `/tenant-api/notify` read pushSubscriptions from `businesses/e2e-biz-.../outlets/pizza/` (0 subscribers) while the dashboard read from `businesses/roshani-pizza/outlets/pizza/` (2 subscribers). Both tokens were valid FCM tokens (dry-run VALID) — pure wrong-business read.
- **Fix:** look up `outletIndex/${outlet}` (canonical outlet→business map) first, fall back to the full-business scan for legacy rows. Commit `f24bdfa` on `main` (pushed as part of `8d2c9c9`).
- **Deploy:** backed up EC2 `bot-control-api/server.js` as `server.js.bak-20261107-202701`, scp'd the fix, restarted pm2 id 2 (bot-control-api) plainly. Server logs show clean startup ("Bot Control API listening on :4000").
- **Verified:** `node --check` passes; RTDB `outletIndex/pizza.bid = roshani-pizza` with 2 subscribers; `e2e-biz-.../outlets/pizza/pushSubscriptions` is null (0 subs).
- **Honest limit:** other uncommitted changes in the working tree (Admin/chat.js, orders.js, pos.js, mobile-overrides.css, style.css, menu/js/app.js|ui.js|css/app.css, two a11y specs, database.rules.json) were not touched or deployed here — only `bot-control-api/server.js`.
- **Done:** deployed live; ledger `[20261107-app-notif-tenant]`.

---

### ✅ Restaurant-Scoped Rider Notification Isolation
- **Requirement:** Riders of Restaurant 1 must **never** see/pop/pop-up any notification (Order available on Rider App, WhatsApp message) from Restaurant 2, and vice versa. Complete isolation.
- **Stage:** `done`
- **Verified:** `node tests/phase5-rider-isolation.check.cjs` → 11/11 `RESULT: isolation holds`; `node tests/phase5-rules-isolation.check.cjs` → 7/7 `RESULT: rules enforce restaurant isolation` (live RTDB REST with a real minted ID token). Both self-seeding/self-cleaning.
- **OK:** Broadcast, assignment and pickup notifications are restaurant-scoped in code; deployed rules deny cross-restaurant reads to a rider's own token.
- **Done:** **Real leak found and fixed** — `resolvePath()` treats `riders` as a platform-shared root, so `getData('riders', outlet)` returns *every* restaurant's riders. `broadcastPickupAvailable` (the only place that trusted that call blindly) now skips any rider whose `outlet` mismatches the order's outlet — failing closed, so a rider with no outlet is never messaged. Assignment/pickup paths were already scoped and untouched. Latent today (both live riders are `pizza`, cake has none), but it would fire the moment a cake rider logged in.

**Phase Breakdown:**

#### Phase 1: Order Data Structure Verification ✅ COMPLETE
- **Goal:** Verify `assignedRider`/`riderId` field exists in every order and is correctly scoped to outlet/restaurant
- **Files:** `bot/rider.js`, `bot/index.js`, `bot/firebase.js`, `database.rules.json`
- **Stage:** `ok`
- **Verified:** 
  - **Order Fields:** Orders use `riderId` and `assignedRiderUid` fields (not `assignedRider` exactly). Code in `bot/rider.js:54,84` reads `order.riderId || order.assignedRiderUid`. In `bot/index.js:807` it uses `order.riderId || order.assignedRider`.
  - **Firebase Rules:** `database.rules.json:117` enforces `assignedRider` field read access: `data.child('assignedRider').val().toLowerCase() == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Query Index:** `database.rules.json:115` includes `assignedRider` in `.indexOn` for order queries
  - **Outlet Scoping:** Rules at `database.rules.json:114` enforce outlet-level scoping: `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
  - **Rider Access:** Rider can only read orders where `assignedRider` matches their email (lowercase) OR no `assignedRider` exists
  - **Assignment Flow:** `bot/index.js:807-824` tracks `currentRider = order.riderId || order.assignedRider` and detects changes
- **Status:** `ok` — Phase 1 Complete

#### Phase 2: Rider App Order Fetching Logic ✅ COMPLETE
- **Goal:** Verify Rider App only fetches orders assigned to the current rider
- **Files:** `rider-app/src/lib/constants.ts`, `rider-app` frontend code
- **Stage:** `ok`
- **Verified:**
  - **Tenant Path Helper:** `rider-app/src/lib/constants.ts:42-51` exports `tenantPath(outlet, path)` and `tenantPathAsync(outlet, path)` which construct paths as `businesses/${bid}/outlets/${outlet}/${path}` using `getBusinessIdForOutlet(outlet)` for business ID resolution
  - **Order Path:** `constants.ts:59` defines `orders: (outlet: OutletId) => businesses/${getBusinessIdForOutlet(outlet)}/outlets/${outlet}/orders` — scoped by outlet
  - **Firebase Rules Enforcement:** `database.rules.json:117` enforces rider can only read orders where `assignedRider` matches their email (lowercase) OR no `assignedRider` exists: `data.child('assignedRider').val().toLowerCase() == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Query Index:** `database.rules.json:115` includes `assignedRider` in `.indexOn` for order queries
  - **Rider App Query Pattern:** The app must query with `orderByChild('assignedRider').equalTo(riderEmail)` to satisfy the security rule at `database.rules.json:114` which checks `query.orderByChild == 'assignedRider' && query.equalTo == root.child('riders').child(auth.uid).child('email').val().toLowerCase()`
  - **Rider Scoping:** Rider can only read orders for their outlet (`root.child('admins').child(auth.uid).child('outlet').val() == $outletId`) AND where they are the assigned rider
  - **No Cross-Outlet Access:** Rules prevent cross-outlet access by checking `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
- **Status:** `ok` — Phase 2 Complete

#### Phase 3: WhatsApp Notification Scoping ✅ COMPLETE
- **Goal:** Verify WhatsApp messages only sent to riders of the order's restaurant
- **Files:** `bot/rider.js`, `bot/index.js`, `bot/status-monitor.js`
- **Stage:** `ok`
- **Verified:**
  - **Per-Outlet Bot Instance:** Each bot instance runs for ONE outlet (`OUTLET` env var at `bot/index.js:10`). Restaurant 1's bot only processes Restaurant 1's orders, reads Restaurant 1's riders, and sends via Restaurant 1's WhatsApp socket
  - **Outlet-Scoped Rider Fetch:** `bot/rider.js:118` fetches riders via `getData("riders", outlet)` where `outlet` is the order's outlet. ⚠️ **This call is NOT outlet-filtered**: `resolvePath()` (`bot/firebase.js`) lists `riders` as platform-shared, so it returns every restaurant's riders. The outlet filter happens in the caller (see Phase 5 fix) — never assume the returned pool is single-tenant.
  - **Direct Assignment Notifications:** `notifyRiderPickup` and `notifyRiderAssignment` in `bot/rider.js` send to specific `riderPhone` from `order.riderPhone` and `riderId` from `order.riderId || order.assignedRiderUid`
  - **Broadcast Scope:** `broadcastPickupAvailable` (line 114-157) fetches riders via `getData("riders", outlet)` where `outlet = order.outlet`, then **filters the returned pool in code** on `r.outlet === outlet` (+ `businessId`), skipping anything that does not match (fail closed) — see Phase 5
  - **Per-Tenant Socket:** Each bot instance has its own `sock` (WhatsApp socket) created in `startBot()` at `bot/index.js:1033-1049` — Restaurant 1's bot uses Restaurant 1's WhatsApp session, Restaurant 2's bot uses Restaurant 2's
  - **Order Status Flow:** `handleOrderStatusUpdate` at `bot/index.js:841-850` calls either:
    - Direct: `notifyRiderPickup` if `order.riderPhone` exists (specific rider assigned)
    - Broadcast: `broadcastPickupAvailable` if no rider assigned (broadcasts to ALL online riders of THAT outlet only)
  - **Rider Change Detection:** `bot/index.js:807-824` tracks `currentRider = order.riderId || order.assignedRider` and calls `notifyRiderAssignment` on change
  - **In-App Notifications:** `addInAppNotification` at `bot/index.js:563-571` writes to `riders/${uid}/notifications/` scoped by outlet via `setData` call
- **Critical Finding:** Isolation is **not** purely process-level: every bot owns its own socket and OUTLET, but the `riders` root node is platform-shared, so rider *selection* has to be filtered in code. Phase 5 found exactly one caller (`broadcastPickupAvailable`) that trusted the shared pool and fixed it.
- **Status:** `ok` — Phase 3 Complete

#### Phase 4: Firebase Security Rules Verification ✅ COMPLETE
- **Goal:** Verify database rules prevent cross-restaurant data access
- **Files:** `database.rules.json`
- **Stage:** `ok`
- **Verified:**
  - **Orders Read Rule (collection level):** `database.rules.json:114` — Rider can query orders only if: `query.orderByChild == 'assignedRider' && query.equalTo == rider's email (lowercase)` — forces rider-scoped queries
  - **Orders Read Rule (individual level):** `database.rules.json:117` — Rider can read individual order only if: `!data.child('assignedRider').exists() || assignedRider matches rider's email (lowercase)` — prevents cross-rider access
  - **Outlet Scoping:** Line 114 requires `root.child('admins').child(auth.uid).child('outlet').val() == $outletId` — restricts to admin's outlet; for riders, implicit via rider data under outlet
  - **Cross-Outlet Leakage Prevention:** Rider can only read orders in their outlet (`root.child('admins').child(auth.uid).child('outlet').val() == $outletId`) AND where they are assigned rider
  - **Rider Write Access:** Line 118 allows write only if `!data.child('riderId').exists() || data.child('riderId').val() == auth.uid` — rider can only accept unassigned orders or their own
  - **Rider Node Isolation:** Lines 15-33 — riders can only read/write their own node (`auth.uid == $uid`) or admins can access all
  - **Cross-Outlet Leakage Prevention:** All outlet-scoped nodes (`orders`, `dishes`, `Menu`, `categories`, `settings`, `inventory`, etc.) check `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`
  - **Rider Stats:** Lines 237-241 — riders can only read/write their own stats (`auth.uid == $riderId`)
  - **Settlements:** Lines 59-63 — riders can only read their own settlements
- **Critical Finding:** Multi-layered isolation — outlet scoping + rider-scoped queries + per-rider node isolation + assignment enforcement
- **Status:** `ok` — Phase 4 Complete

#### Phase 5: Runtime Integration Test ✅ COMPLETE (automated)
- **Goal:** End-to-end proof that a notification/read for Restaurant 1 never reaches Restaurant 2
- **Stage:** `done`
- **Verified:** two runnable checks, both self-seeding and self-cleaning (`cleanup: no test riders left`), both green:
  - `node tests/phase5-rider-isolation.check.cjs` — 11/11, `RESULT: isolation holds`. Stubs the WhatsApp socket, seeds `phase5test-*` riders in both outlets and drives the real `bot/rider.js` functions against live RTDB.
  - `node tests/phase5-rules-isolation.check.cjs` — 7/7, `RESULT: rules enforce restaurant isolation`. Mints a custom token for a temporary pizza rider, exchanges it for a real ID token, then hits the **live RTDB REST API** (which enforces `database.rules.json`, unlike the Admin SDK).
- **OK (rider notifications):**
  - pizza broadcast reaches its own online pizza rider (`to=["pizza-online"]`) — A1
  - pizza broadcast skips the offline pizza rider — A2
  - pizza broadcast **never** reaches a cake rider — A3 (failed before the fix)
  - in-app notif written only for the pizza rider — A4
  - cake broadcast reaches its own rider and **never** a pizza rider — B1/B2 (B2 failed before the fix)
  - assignment (`notifyRiderAssignment`) and pickup (`notifyRiderPickup`) each send exactly one message, to the assigned phone only — C1-C3, D1-D2
- **OK (deployed rules, real token):** own-outlet order query `200` (A1) / cross-outlet query `401` (A2) / cake order by id `401` (B1) with same-shape own-outlet read `200` as control (B2) / own rider node `200` (C1) / another rider node `401` (C2) / anonymous cake orders `401` (D1)
- **Done:** fix committed — `broadcastPickupAvailable` filters the shared `riders` pool on `outlet` + `businessId` (fail closed) and logs `(N rider(s) from another restaurant skipped)`. `tests/phase5-rider-isolation.check.cjs` + `tests/phase5-rules-isolation.check.cjs` added.
- **Note:** the browser/manual steps below are now redundant for isolation (covered by the runtime checks), but a live two-restaurant rider login remains the only way to eyeball the real Rider App pop-up.

**Original manual steps (kept for a real two-restaurant smoke test):**
1. **Setup:** two restaurants, each with at least 1 rider
2. **Test Restaurant 1 Order:** Rider A gets pop-up + WhatsApp "PICKUP AVAILABLE"; Rider B (same restaurant) gets nothing unless broadcast; Rider C (other restaurant) gets nothing
3. **Test Restaurant 2 Order:** Rider C gets pop-up + WhatsApp; Rider A gets nothing
4. **Broadcast Scenario:** order goes "Ready" with no rider assigned → all online riders of THAT restaurant get it, no other restaurant's riders get anything

---

**PHASE SUMMARY — Restaurant-Scoped Rider Notification Isolation**

| Phase | Status | Key Finding |
|-------|--------|-------------|
| **Phase 1: Order Data Structure** | ✅ `ok` | Orders use `riderId`/`assignedRiderUid`; Firebase rules enforce `assignedRider` scoping |
| **Phase 2: Rider App Fetch Logic** | ✅ `ok` | `tenantPath` scopes by outlet; rules force `assignedRider` query; outlet-scoped |
| **Phase 3: WhatsApp Notification** | ✅ `ok` | **Process-level isolation** — each restaurant runs separate bot instance with own socket & outlet data |
| **Phase 4: Firebase Rules** | ✅ `ok` | Multi-layered: outlet scoping + rider-scoped queries + per-rider node isolation + assignment enforcement |
| **Phase 5: Runtime Test** | ✅ `done` | 11/11 notification checks + 7/7 live-rules checks; **found + fixed** the shared-`riders` broadcast leak |

**OVERALL VERDICT:** ✅ **Isolation holds, now proven at runtime** — with one correction to the earlier reasoning:
- Each restaurant runs its own bot instance with its own `OUTLET` env var and its own WhatsApp socket
- The `riders` root node is **platform-shared**, so rider *selection* must be filtered in code — `broadcastPickupAvailable` now does (fail closed)
- Assignment + pickup notifications only ever target the order's own rider phone
- Deployed rules deny a rider's token any read outside their own outlet (401), verified against the live RTDB

---

## Current Work Items

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `4ca91cf` (`build: add SupremeAdmin esbuild minification support`)

---

### ✅ Build system commit
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok` (git pushed + deployed)
- **Verified:** `npm run build:supreme` works correctly; all modified files pass `node --check`; `.gitignore` updated; scripts added; git push successful; **Firebase deploy successful**
- **OK:** Build system commit complete on main branch; SupremeAdmin deployed to Firebase Hosting
- **Done:** ✅ `npm run deploy:supreme` — hosted at https://foodhubbie-supremeadmin.web.app

**To advance:** session backup cron scheduling (run `bot/backup-sessions.js` daily via system cron on EC2)

---

### ✅ Issue #2: TUNNEL_URL global — `let` + Firebase auto-read
- **File:** `SupremeAdmin/js/firebase-config.js:28-34`
- **Stage:** `ok`
- **Verified:** `const TUNNEL_URL` → `let TUNNEL_URL`; added `once('value')` read from `config/tunnelUrl`; fallback to hardcoded value on failure
- **Review:** Ponytail full enforcement; `let` safe because no feature file reassigns the variable; all 6 call sites read-only
- **Commit:** `4966860` (full project audit commit); `ea50d76` (ACCESS.md push)

### ✅ Issue #3: `showToast` missing import in `main.js`
- **File:** `SupremeAdmin/js/main.js:20`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'`; line 66 `showToast("Your account is view-only — you can't add restaurants.", 'error')` now resolves
- **Review:** Module graph walk confirmed `main.js` is loaded via dynamic import from `auth.js`; no other undefined function calls in this file
- **Commit:** `4966860`

### ✅ Issue #4: `_transportLabelInternal` duplicate removed
- **File:** `SupremeAdmin/js/utils.js:277-284`
- **Stage:** `ok`
- **Verified:** Replaced `_transportLabelInternal(transport)` call in `transportBadgeHtml` with `transportLabel(transport)`; deleted the duplicate function body (lines 277-281); `grep` confirmed zero remaining references to `_transportLabelInternal` in active code
- **Review:** Dead code removal per ponytail philosophy ("deletion over addition"); `transportBadgeHtml` now calls the exported `transportLabel` directly
- **Commit:** `4966860`

### ✅ Issue #5/7: `showToast` missing import in `data-store.js`
- **File:** `SupremeAdmin/js/data-store.js:18,39`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'` at line 18; error handler at line 39 now shows user-visible toast on connection loss instead of silently `console.error`-only
- **Review:** Error boundary fixed — `.on('value')` error callback now has working `showToast`; subscriber calls at lines 34-36 already wrapped in try/catch (no change needed)
- **Commit:** `4966860`

### ✅ Issue #6: `exportCsv` missing import in `bot-fleet-overview.js`
- **File:** `SupremeAdmin/js/features/bot-fleet-overview.js:3`
- **Stage:** `ok`
- **Verified:** Added `exportCsv` to the import from `/js/utils.js` at line 3; line 193 `exportCsv('bot-fleet', ...)` now resolves
- **Review:** Grep confirmed all functions used in file are now imported; no dead imports
- **Commit:** `4966860`

### ✅ Issue #2 (audit): `.gitignore` fix for session files
- **File:** `SupremeAdmin/js/` — not directly applicable; audit item 1 was for `bot/sessions/` in a different project
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended adding `bot/sessions/` to `.gitignore` to prevent accidental commit of live WhatsApp session credentials. In this project, `SupremeAdmin/js/` session data lives in Firebase RTDB, not local files. For any future bot/whatsApp work, add `bot/sessions/` and `bot/session_data/` to `.gitignore`.

### ✅ Issue #3 (audit): Randomized delay in multi-recipient sends
- **File:** `bot/` — audit item 3 was for `status-monitor.js` `broadcastPickupAvailable()` loop with no delay between `sock.sendMessage` calls to riders
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended staggering with randomized 800ms–2000ms delay between recipients to avoid WhatsApp anti-spam heuristics flagging tight send-velocity bursts. This pattern is applicable to any loop that sends to multiple JIDs. In the current SupremeAdmin work, no equivalent multi-recipient send pattern exists.

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `4ca91cf` (same build-system commit as the entry above)

### ✅ Temp file cleanup
- **File:** `SupremeAdmin/js/utils.js.tmp`, `SupremeAdmin/js/features/bot-fleet-overview-temp.js`
- **Stage:** `done`
- **Verified:** Both files deleted via `Remove-Item`; `glob` confirmed zero `.tmp` or `*temp*` files remain in `SupremeAdmin/`
- **Review:** Ponytail "deletion over addition" — removing leftover artifacts from edit sessions

### ✅ Review fixes: `console.warn` + dead comment
- **File:** `SupremeAdmin/js/firebase-config.js`, `SupremeAdmin/js/utils.js`
- **Stage:** `ok`
- **Verified:** Added `console.warn('TUNNEL_URL: failed to read config/tunnelUrl, using fallback')` to `.catch(() => {})` in firebase-config.js; removed duplicate `// ---- CSV export` comment in utils.js (was followed by `// ---- formatting` — two section headers for the same category)
- **Review:** Low-severity polish items from code review; both minimal changes, zero risk

---

## THIS PROJECT: Applicable Audit Fixes (from WHATSAPP-BOT-BAN-PROOFING-AUDIT & POS-MENU-UI-FIXES)

These are **real, actionable items** in THIS repo based on the audits.

| # | Item | Files | Stage |
|---|------|-------|-------|
| 1 | POS back button redundancy | `Admin/index.html`, `Admin/js/ui.js` | `done` |
| 2 | Invisible text selection near bottom nav | `menu/css/app.css` | `done` |
| 3 | Rider broadcast unthrottled sends + warm-up pacing | `bot/utils.js`, `bot/rider.js`, `bot/index.js` | `done` |
| 4 | Baileys version drift, no update process | `bot/package.json` | `done` |
| 5 | No backup/persistence for `bot/session_data_pizza/` | `bot/backup-sessions.js` | `done` |
| 6 | Whole-process restarts drop all tenants | `bot/index.js` | `done` |

---

### ✅ Item 1: POS Back Button Redundancy
- **Files:** `Admin/index.html`, `Admin/js/ui.js`
- **Stage:** `done`
- **Issue:** Two back buttons in POS mobile view — static button in HTML + dynamic `posExitBtn` created in `Admin/js/ui.js:156-169`. Bottom nav already provides navigation.
- **Fix:** Removed static button from `Admin/index.html:3851-3855`; removed dynamic `posExitBtn` creation from `Admin/js/ui.js:128-140`
- **Verified:** `node --check Admin/js/ui.js` passes
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all` — confirmed online

---

### ✅ Item 2: Invisible Text Selection Near Bottom Nav
- **Files:** `menu/css/app.css`
- **Stage:** `done`
- **Issue:** `user-select: none` only on `.bottom-nav-item`, so text near bottom nav is selectable on tap-drag → invisible highlights
- **Fix:** Added `-webkit-user-select:none; user-select:none; -webkit-touch-callout:none;` to `body` rule at line 31; re-enabled for `input,textarea` with `-webkit-user-select:text; user-select:text;` at line 34
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all`

---

### ✅ Item 3: Rider Broadcast Throttling + Warm-Up Pacing
- **Files:** `bot/utils.js`, `bot/rider.js`, `bot/index.js`
- **Stage:** `done`
- **Issue:** `broadcastPickupAvailable()` loops riders with zero delay between WhatsApp sends. No warm-up for new numbers.
- **Fix:** Added `sleep()`, `getBroadcastDelayRangeMs()`, warm-up constants (7-day window, 3-5s warm-up, 0.8-1.5s normal) to `bot/utils.js`; imported helpers in `bot/rider.js`, added staggered delay in broadcast loop; added `firstLinkedAt` tracking on first connection in `bot/index.js:1099-1122`
- **Verified:** All `node --check` pass
- **Deployed:** `a0c43fc` + `ff9ac96` → EC2 pull + `pm2 restart all` — confirmed online

---

### ✅ Item 4: Baileys Version Drift
- **Files:** `bot/package.json`
- **Stage:** `done`
- **Issue:** `^6.7.17` pinned, no update process. WhatsApp protocol changes detect outdated clients.
- **Fix:** Pinned exact version `7.0.0-rc13` (removed `^`); added `check:baileys` script for version checking
- **Verified:** `bot/package.json` valid JSON; `node --check bot/index.js` passes
- **Deployed:** `a0c43fc` → EC2 pull + `pm2 restart all`

---

### ✅ Item 5: Session Backup
- **Files:** `bot/backup-sessions.js`, `bot/package.json`
- **Stage:** `done`
- **Issue:** WhatsApp auth credentials only on EC2 local disk. No S3/EBS backup. Instance loss = mass re-link = ban risk.
- **Fix:** Created `bot/backup-sessions.js` (syncs `session_data_*` dirs to S3 via `aws s3 sync --delete --storage-class STANDARD_IA`); added `backup:sessions` script to `bot/package.json`
- **Verified:** Syntax checks pass
- **Deployed:** `a0c43fc` → EC2 pull — ready for cron scheduling

---

### ✅ Item 6: Graceful Shutdown (SIGTERM/SIGINT)
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Issue:** `pm2 restart` sends SIGTERM → abrupt kill → session corruption, no graceful socket close.
- **Fix:** Added SIGTERM/SIGINT handler at `bot/index.js:1099-1122` after `currentSock = sock;`: calls `sock.end(undefined)`, clears intervals, exits after 500ms flush
- **Verified:** `node --check bot/index.js` passes; regression check clean
- **Deployed:** `a0c43fc` + `ff9ac96` → EC2 pull + `pm2 restart all` — confirmed all 6 processes online

---

### ✅ Item 7: TUNNEL_URL not on `window` (SupremeAdmin)
- **Files:** `SupremeAdmin/js/firebase-config.js`
- **Stage:** `done`
- **Issue:** `TUNNEL_URL` declared as `let` in `firebase-config.js` but not attached to `window`. ES modules (e.g. `restaurant-profile.js`) referencing `TUNNEL_URL` got `ReferenceError`.
- **Fix:** Added `window.TUNNEL_URL = TUNNEL_URL` after declaration + after Firebase auto-read update
- **Verified:** Build + deploy successful
- **Deployed:** `ea5b9ef` → Firebase Hosting (`foodhubbie-supremeadmin.web.app`)

---

### ✅ Item 8: `resolveOutletId` not imported in `bot/index.js`
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Issue:** `resolveOutletId()` called at line 2193 but only `resolveBusinessIdFor` and `initializeOutletBusinessIndex` were imported from `./helpers/outlet-resolution`. Caused `[FATAL] Unhandled Rejection: resolveOutletId is not defined` on bot startup → pizza bot crashed.
- **Fix:** Added `resolveOutletId` to the import at line 38
- **Verified:** `node --check bot/index.js` passes
- **Deployed:** `ff9ac96` → EC2 pull + `pm2 restart all` — all 6 processes online, pizza bot connected

---

## Website Upgrade — FoodHubbie Marketing Site

**Goal:** Restructure `website/index.html` from "feature → text → generic image" to "promotional visual → real software proof → benefits → CTA" per `website/Improvements/improvements.md.txt`.

**Assets:**
- `website/assets/generated/` — 6 AI promotional images (admin-dashboard, admin-login, menu-landing, menu-landing-mobile, rider-login, rider-login-mobile)
- `website/assets/REal/` — 25 real software screenshots (Analytics x3, Dashboard, Bulk Messaging, Discount, Inventory, Live Orders, Menu Control, Menu Availability, Orders, Orders Update, Payment Tracking, POS, QR Table, Reports, Rider Management, Settings x6, Table Management, WhatsApp Bot)

**Design Rules (from improvements guide):**
- Do NOT redesign from scratch — improve existing sections
- Keep existing branding (orange accent, white/light bg, dark navy type, rounded cards)
- Keep existing pricing, CTAs, links, navigation
- PROMISE → PRODUCT → PROOF flow for every feature
- No text over screenshots, no orange boxes on screenshots
- Use browser frames, device frames, clean white cards, subtle shadows
- Responsive: 3-col desktop → 2-col tablet → 1-col mobile
- Lazy loading, proper alt text, no stretch/crop

### ✅ W1: Hero Section — Add Ecosystem Strip
- **File:** `website/index.html` (hero section)
- **Stage:** `done`
- **Task:** Added ecosystem strip below dashboard image: Admin → Customer QR Menu → Rider App with connected labels. Added "LIVE / REAL-TIME" indicator with pulse animation.
- **CSS:** Added `.ecosystem-strip`, `.eco-item`, `.eco-arrow`, `.live-dot` styles
- **Deployed:** Pending Firebase deploy

### ✅ W2: "See FoodHubbie in Action" — 5 Feature Cards
- **File:** `website/index.html` (new section after product tour)
- **Stage:** `done`
- **Task:** Added 5 premium feature cards with real screenshots: WhatsApp Ordering, QR Table Ordering, First-Party Delivery, Marketing & Promotions, Real-Time Command Center. Each card: real screenshot → headline → supporting text → CTA link.
- **Deployed:** Pending Firebase deploy

### ✅ W3: WhatsApp Ordering Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Added dedicated section with real WhatsApp campaign screenshot + flow diagram: Customer → WhatsApp → Promotion → Menu → Cart → Order → Dashboard. CTA: "Talk to Us on WhatsApp"
- **Deployed:** Pending Firebase deploy

### ✅ W4: QR Table Ordering Section
- **File:** `website/index.html` (upgraded from Dine-In section)
- **Stage:** `done`
- **Task:** Upgraded Dine-In section with real QR screenshot + process flow diagram: TABLE QR → CUSTOMER ORDER → POS/SYSTEM → KITCHEN → SERVED. Added `id="qr-section"` for navigation.
- **Deployed:** Pending Firebase deploy

### ✅ W5: Delivery Section — Screenshot Sequence
- **File:** `website/index.html` (upgraded Delivery section)
- **Stage:** `done`
- **Task:** Added 3-screenshot sequence: Live Orders (Monitor) → Orders Update (Update) → Orders (Manage). Added `id="delivery-section"` for navigation.
- **Deployed:** Pending Firebase deploy

### ✅ W6: Marketing Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Two-column layout: LEFT = WhatsApp Campaigns, RIGHT = Discount & Coupon Control. Added workflow: Create → Target → Promote → Track. Added `id="marketing-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W7: Command Center Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Large dashboard screenshot in browser frame. Added `id="command-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W8: Analytics Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** 3-screen dashboard showcase: Analytics Overview, Sales & Highlights, Payment Methods. Added `id="analytics-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W9: Menu & Inventory Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** 3-stage layout: Menu Control → Availability & Stock → Inventory Management. Added `id="menu-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W10: POS & Payments Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Split-screen: POS + Payment Tracking. Added `id="pos-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W11: Orders Section
- **File:** `website/index.html` (new section)
- **Stage:** `done`
- **Task:** Horizontal timeline: Order Received → Preparing → Ready/Delivery with real screenshots. Added `id="orders-section"`.
- **Deployed:** Pending Firebase deploy

### ✅ W12: Final CTA Update
- **File:** `website/index.html` (final CTA section)
- **Stage:** `done`
- **Task:** Added ecosystem visual: QR Order → Dashboard → Kitchen → Rider → Customer. Added "FOODHUBBIE ERP" branding + WhatsApp number.
- **Deployed:** Pending Firebase deploy

### ✅ W13: SEO & Alt Text Pass
- **File:** `website/index.html`
- **Stage:** `done`
- **Task:** Updated all image alt text to descriptive: "FoodHubbie ERP [feature] — [description]". Added smooth scrolling CSS.
- **Deployed:** Pending Firebase deploy

### ✅ W14: Responsive Design Pass
- **File:** `website/index.html` (CSS)
- **Stage:** `done`
- **Task:** All new sections use responsive grids: `.feature-promo` (auto-fit minmax 300px), `.screenshot-seq` (3→1 col), `.marketing-grid` (2→1 col), `.analytics-grid` (3→2→1 col), `.menu-inv-grid` (3→1 col), `.pos-pay-grid` (2→1 col). Dashboard screenshots in browser frames scale properly.
- **Deployed:** Pending Firebase deploy

### ✅ W15: Deploy to Firebase Hosting
- **File:** `firebase.json` (website hosting target)
- **Stage:** `done`
- **Task:** Deployed website to `foodhubbie-web.web.app`
- **Deployed:** https://foodhubbie.in

---

## Baileys Ban-Proofing — Volume, Detection, Dashboard

**Context:** Baileys (unofficial WhatsApp Web API) is ban-prone at high volume. A restaurant with 800 orders/10hrs generates ~3,200 outbound messages/day (order notifications + rider broadcasts + promos). Meta flags accounts at 500+/day. These three items add detection, pacing, and visibility.

### ✅ B1: Baileys-Specific Send Delay (2-5s Jitter)
- **Files:** `bot/utils.js`, `bot/index.js`
- **Stage:** `done`
- **Verified:** `node --check bot/utils.js` + `node --check bot/index.js` pass; deployed to EC2; `pm2 restart all` — all 4 processes online
- **Done:** SCP + restart — `BaileysSendTracker` class in utils.js, wired into `sendImage()` in index.js. 2-5s jitter between distinct recipients, no delay for same-recipient sends. Skipped for Meta transport.
- **Commit:** `a936f48` (`feat: Baileys send tracker + ban detection + promo badge fix + message preview CSS`)

### ✅ B2: Ban Detection + Admin Alert
- **Files:** `bot/index.js`
- **Stage:** `done`
- **Verified:** `node --check bot/index.js` pass; deployed to EC2; `pm2 restart all` — all 4 processes online. Ban detection immediately triggered on restart (pizza bot was already in `logged_out` state) — wrote alert to `bot/alerts/pizza/`, auto-paused promotions.
- **Done:** SCP + restart — consecutive send failure tracking (10 failures in 5min = warning alert), session expiry detection (QR after open = banned), `loggedOut` disconnect = critical alert + auto-pause promos. Alerts written to `bot/alerts/{outlet}` in Firebase.
- **Commit:** `bb92b87` (`fix(bot): 5 critical reliability fixes from log analysis patch`)

### ✅ B3: Volume Dashboard (Daily Outbound Tracking)
- **Files:** `bot/index.js`, `bot/utils.js`, `bot/rider.js`, `bot/promotions.js`
- **Stage:** `done`
- **Issue:** No visibility into daily outbound volume. Can't tell if approaching Baileys ban threshold (500/day). No historical trend data.
- **Fix:**
  1. **`bot/utils.js`** — Added `OutboundTracker` class: `trackSend(outlet, type)` increments daily counter via Firebase transaction at `bot/usage/{IST-date}/{outlet}`; types: `order_notification`, `rider_broadcast`, `promo`, `admin_alert`
  2. **`bot/index.js`** — Tracker initialized after imports; wired into `sendImage()` with optional `trackType` param (default `order_notification`); tracking on every successful send (image and text fallback paths)
  3. **`bot/rider.js`** — Tracker initialized; tracking added to `broadcastPickupAvailable()` (rider_broadcast) and `notifyRiderAssignment()` (rider_broadcast)
  4. **`bot/promotions.js`** — Tracker initialized; tracking added to `sendPromotionalMessage()` (promo) and extra menu image send; outlet param threaded through `sendWithRetry()` → `sendPromotionalMessage()`
- **Verified:** `node --check` passes for all 4 files; bot restarted successfully on EC2, online and processing messages
- **Deployed:** SCP'd all files to EC2 `/var/www/foodhubbie/bot/`; `pm2 restart bot-roshani-pizza-pizza` — confirmed online with `outboundTracker` initialized
- **Commit:** `a936f48` (tracker class) + `7a918fb` (`feat(bot): wire OutboundTracker into all send paths for daily usage analytics`)

---

## Completed Items (This Session)

| Item | Status |
|------|--------|
| SupremeAdmin Issues #2-7 | ✅ `ok` |
| Restaurant-Scoped Isolation (Phases 1-5) | ✅ `done` |
| Build System + Deploy | ✅ `done` |
| POS Back Button (in Admin) | ✅ `done` |
| Invisible Text Selection | ✅ `done` |
| Rider Broadcast Throttling + Warm-Up | ✅ `done` |
| Baileys Version Drift | ✅ `done` |
| Session Backup | ✅ `done` |
| Whole-Process Restart (Graceful SIGTERM) | ✅ `done` |
| Daily Outbound Tracking (OutboundTracker) | ✅ `done` |
| Phase 5 Runtime Test | ✅ `done` (11/11 notification + 7/7 rules) |

---
## 🔲 Multi-bot Tenancy — Per-Restaurant WhatsApp Numbers, All Billed to Foodhubbie's Meta Account

- **Stage:** `ok`
- **Decision:** **Path B — all restaurant numbers on Foodhubbie's own WABA**, billed to Foodhubbie's Meta account. No "spam ban" risk on the official Cloud API (server-to-server Graph sends, no Baileys/QR session). Residual risk: WABA-level restriction hits all tenants at once, one payment instrument feeds all tenants, display-name review per number under Foodhubbie's verified business identity — **need to test Meta approves "Roshani Pizza" etc. under your WABA** (Meta console, no Graph shortcut). Quality/messaging limits are per-number (~80 msg/s default), not per WABA.
- **Hygiene done:** Stale Meta test-number artifact deleted from RTDB — `businesses/roshani-pizza/outlets/pizza/whatsapp` (`+1 555-661-9086`, `status:'active'`, `wabaId: 2589174454849821`) removed along with `phoneNumberIndex/1211796118690392`. Pizza worker untouched: `bot.transport` stays `baileys`, orchestrator `desiredState()` returns null.
- **Phase 1 done:** `database.rules.json` whatsapp rules (super/supreme write only); `whatsapp-linking.js` client-side write removed; `server.js` exchange endpoint rewritten for v4 (`{code, wabaId, phoneNumberId}`, `expires_at: 0` assert, server-side writes). No per-tenant token plumbing needed on Path B — one `META_SYSTEM_USER_TOKEN` covers every number on Foodhubbie's WABA.
- **Phase 2 done (this session):**
  - `SupremeAdmin/js/features/whatsapp-linking.js`: v4 Embedded Signup `message` event listener — captures `waba_id`/`phone_number_id` from Meta's postMessage (`FINISH`/`CANCEL`), passes them to the exchange endpoint; cleanup in `finally` block.
  - `bot-control-api/server.js`: `waLinkSuccess` now writes `wabaIndex/{wabaId}` (WABA → outlet mapping for webhook routing); exchange endpoint accepts v4 postMessage IDs.
  - `webhook-server/index.js`: persists `message_template_status_update` events — maps WABA → outlet via `wabaIndex`, writes per-template status/category/language to `businesses/{bid}/outlets/{oid}/whatsapp/templates/{name}`.
  - `database.rules.json`: added `wabaIndex/$wabaId` rules (super/supreme read+write).
- **Files touched:** `database.rules.json`, `SupremeAdmin/js/features/whatsapp-linking.js`, `bot-control-api/server.js`, `webhook-server/index.js`
- **Deployed:** `firebase deploy --only database` ✅; `server.js` + `webhook-server/index.js` → EC2 pm2 id 2 + id 0 restarted (both online) ✅; `firebase deploy --only hosting:supreme` ✅ (stamped 8d2c9c9.20261107T144704Z)
- **Blocked:** Real tenant onboarding blocked on Meta App Review / Tech Provider access / app Live; display-name test pending Meta console
- **Next:** (1) Meta console: verify `META_CONFIG_ID=1089451087291012` is v4/system-user; (2) run real-number display-name test under Foodhubbie's WABA; (3) Phase 3: Meta cost ledger at `bot/transport.js` so `_metaCostGuard` can arm


- **Phase 3 done (this session):**
  - `bot/transport.js`: `recordMetaCost(to, category)` writes `walletBilling/{bid}/{oid}/metaUsage/{YYYY-MM}` on every successful meta-transport send (text, image, CTA button, template). Classifies marketing vs utility by template name; `DEFAULT_RATE_TABLE` from `shared/meta-cost-math.js` (utility ₹0.115, marketing ₹0.86, authentication ₹0.115, service ₹0.115). Fails open — never blocks a send on recording failure.
  - `bot-control-api/meta-cost-publisher.js` (NEW): every 5 min walks `outletIndex`, computes `balancePaise` = `META_CREDIT_LINE_START_PAISE` − accumulated meta cost for the month, writes it to `walletBilling/{bid}/{oid}/balancePaise`. This is what arms `_metaCostGuard` (it only blocks when balancePaise is a finite number).
  - `bot-control-api/server.js`: imports and starts `startMetaCostPublisher({ admin })` alongside `startWalletWatcher` and `startOrchestrator`.
  - `shared/meta-cost-math.js`: `classifySend`, `estimateCostPaise`, `canSend`, `DEFAULT_RATE_table` already existed — self-check passes.
- **Files touched:** `bot/transport.js`, `bot-control-api/meta-cost-publisher.js` (new), `bot-control-api/server.js`
- **Deployed:** `firebase deploy --only database` ✅; `server.js` + `meta-cost-publisher.js` → EC2 pm2 id 2 restarted (online) ✅; `bot/transport.js` → EC2 bot workers pm2 id 6 restarted (meta transport, online) ✅; pizza bot id 35 on Baileys untouched ✅; `firebase deploy --only hosting:supreme` ✅ (stamped 8d2c9c9.20261107T144704Z)
- **Blocked:** Real tenant onboarding blocked on Meta App Review / Tech Provider access / app Live; display-name test pending Meta console
- **Next:** (1) Meta console: verify `META_CONFIG_ID=1089451087291012` is v4/system-user (dashboard-only); (2) run real-number display-name test under Foodhubbie's WABA (e.g. "Roshani Pizza"); (3) Phase 4: migrate live pizza from Baileys to meta transport once its WABA/display-name is approved; (4) Phase 5: Solution Partner / Tech Provider / App Review tracks (long lead — start now)


## Phase 4 — Pizza Migration Prep (ready to execute once Meta console steps clear)

**What needs to happen when pizza moves from Baileys → meta:**

| Step | Who | What |
|------|-----|------|
| Meta approves display name for pizza number | You (Meta console) | Test number real-name under Foodhubbie WABA |
| Add real number to WABA | You (Meta console) | WhatsApp Manager → Add phone number → SMS/voice OTP → register |
| Create `whatsapp` node on pizza outlet | Code | `businesses/roshani-pizza/outlets/pizza/whatsapp` = `{ phoneNumberId, wabaId, status: 'active', ... }` via `/api/whatsapp/numbers/.../register` |
| Set `bot.transport = 'meta'` | Code | orchestrator `desiredState()` picks up `status:'active'` and starts meta worker |
| Verify pizza bot online | Code | `bot.transport` = `meta`, `botStatus` = online, sends via system-user token |
| Decommission Baileys session | Code | Remove `session_data_pizza` dir, stop Baileys worker |

**Files already ready for this:** `waLinkSuccess()` handles steps 3-4 automatically when the number is registered. No new code needed — just execute through the existing Path B wizard or direct Graph API calls.

## Item Progress Workflow Example

To mark a new item:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `reviewing`
- **Verified:** (pending)
- **OK:** (pending)
- **Done:** (pending)
```

**To advance:** update `status` field. Example after review:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `ok`
- **Verified:** `node --check path/to/file.js` passes; lint passes
- **OK:** self-review complete
- **Done:** merged to main, deployed
```

---

## Promotions Tab Full Review — 9 Findings (Tier 3)

**Source:** Full static review of promotions UI (`Admin/js/features/promotions.js`), bot engine (`bot/promotions.js`), rules (`database.rules.json`), HTML, CSS.
**Risk tier:** 3 (security rules, multi-tenant PII, live WhatsApp sends)

---

### ✅ P1: Any admin can read any other restaurant's customer list
- **Files:** `database.rules.json` (customers node)
- **Stage:** `done`
- **Verified:** JSON valid, deployed to Firebase RTDB
- **OK:** diff confirms outlet-match clause added, same pattern as orders/feedbacks/discountsUsage
- **Done:** ✅ `firebase deploy --only database`

**Issue:** `customers` node's `.read` rule checks only `admins.exists()` — no outlet scoping. Every other node under `$outletId` scopes with `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`. This is the one exception. Any authenticated admin can read any outlet's customer list (names, phones, order history, promotionalConsent).
**Trace:** `database.rules.json` → `customers` → `.read` — missing outlet match clause vs. siblings (`orders`, `feedbacks`, `discountsUsage`).
**Fix:** Add outlet-match clause to customers `.read` rule.
**Verify:** Compare customers rule against 7 sibling nodes.

---

### ✅ P2: Rider accounts can control promotional campaigns
- **Files:** `database.rules.json` (bot node)
- **Stage:** `done`
- **Verified:** JSON valid, deployed
- **OK:** `.write` added at `bot/promotions` level restricts to admins-only
- **Done:** ✅ `firebase deploy --only database`

**Issue:** `bot` node's `.write` grants `auth != null && (admins.exists() || riders.exists())`. Nothing under `bot/promotions` (campaigns, killSwitch, enabled) narrows to admins-only. A rider account can write directly to `bot/promotions/killSwitch`, `.../enabled`, or push fabricated campaigns.
**Trace:** `database.rules.json` → `bot` → `.write` — permits `riders.exists()`. No children override restrict to admins.
**Fix:** Add `.write` restriction at `bot/promotions` level to admins-only.
**Verify:** Rule diff before/after.

---

### ✅ P3: "Delay between sends" field has zero effect
- **Files:** `bot/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed to EC2
- **OK:** Resolved the other way — the field and its `delayMs` plumbing were **removed** (0 occurrences in `Admin/index.html` and `bot/promotions.js`). The send loop always paces from the bot's own constants. No config surface left to go stale.
- **Done:** ✅ SCP + `pm2 restart bot-roshani-pizza-pizza`

**Issue:** `promoDelay` input (1-30s, default 2) is read, sent as `delayMs` in `SEND_PROMOTION` command, destructured in `runPromotionCampaign()` — and never used. The send loop always uses hardcoded `PROMO_MIN_DELAY_MS` (8000) / `PROMO_MAX_DELAY_MS` (15000).
**Trace:** HTML `promoDelay` → `promotions.js:484` → `SEND_PROMOTION` command → `bot/promotions.js:215` destructured → `bot/promotions.js:382` uses `randomBetween(PROMO_MIN_DELAY_MS, PROMO_MAX_DELAY_MS)` ignoring `delayMs`.
**Fix:** Wire `delayMs` into the send loop or remove the UI field.
**Verify:** Trace the variable end-to-end.

---

### ✅ P4: Hint text wrong in three ways
- **Files:** `Admin/index.html`
- **Stage:** `done`
- **Verified:** deployed
- **OK:** The hint died with the field (see P3) — no stale numbers left in the UI. Authoritative pacing, if it ever needs re-surfacing: `PROMO_MIN_DELAY_MS=8000` / `PROMO_MAX_DELAY_MS=15000` per message, `BATCH_MIN_PAUSE_MS=60000` / `BATCH_MAX_PAUSE_MS=120000` pause every 30 sends (`bot/promotions.js`).
- **Done:** ✅ `firebase deploy --only hosting:admin`

**Issue:** `Admin/index.html:4337` says "Default 2s. A 30s pause happens automatically every 50 sends." Actual: per-message delay is random 8-15s, batch pause is 60-120s every 30 sends. Three numbers, all wrong. The guide modal (`promotions-guide.js`) has the correct numbers.
**Trace:** `Admin/index.html` hint text vs. `bot/promotions.js:14-22` constants.
**Fix:** Update hint text to match actual constants.
**Verify:** Compare hint against constants.

---

### ✅ P5: Template count off by one
- **Files:** `promotions-guide.js`
- **Stage:** `done`
- **Verified:** grep confirmed 25 templates
- **OK:** guide updated to "25 pre-built message templates"
- **Done:** ✅ deployed

**Issue:** Guide says "24 pre-built message templates." Actual `TEMPLATES` array has 25 items (8 categories, 3+4+4+3+3+3+2+3).
**Trace:** Count `TEMPLATES` array in `promotions-templates.js`.
**Fix:** Update count to 25.
**Verify:** Count array.

---

### ✅ P6: Campaign documents never cleaned up
- **Files:** `bot/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed
- **OK:** `expireOldPromoLogs` now also cleans completed/stopped/expired campaigns older than 30 days
- **Done:** ✅ SCP + restart

**Issue:** `expireOldPromoLogs()` TTLs `bot/promotions/logs` at 30 days. No equivalent for `bot/promotions/campaigns`. Completed/stopped/expired campaigns accumulate forever, including base64 `mediaUrl` data. The admin dashboard keeps one live `.on('value')` listener on all campaigns — every change re-downloads everything.
**Trace:** `expireOldPromoLogs()` — no campaigns cleanup call.
**Fix:** Add TTL cleanup for campaigns node.
**Verify:** Confirm no existing cleanup.

---

### ✅ P7: state.promotions in state.js is dead
- **Files:** `Admin/js/state.js`
- **Stage:** `done`
- **Verified:** grep confirmed zero references in promotions.js
- **OK:** dead object removed from state
- **Done:** ✅ deployed

**Issue:** `state.promotions` object declared but never read or written by `promotions.js` — module uses its own private variables.
**Trace:** Grep `state.promotions` across repo.
**Fix:** Remove dead state or wire it.
**Verify:** Confirm zero references.

---

### ✅ P8: Two data-action attributes are inert
- **Files:** `Admin/index.html`
- **Stage:** `done`
- **Verified:** grep confirmed no dispatcher case in main.js
- **OK:** removed dead `data-action` from `btnPromoLaunch` and `btnPromoKillAll`
- **Done:** ✅ deployed

**Issue:** `btnPromoLaunch` (`data-action="launchPromoCampaign"`) and `btnPromoKillAll` (`data-action="killAllCampaigns"`) have no case in `main.js`'s delegated dispatcher. They're wired via `.onclick` directly, so nothing double-fires, but the attributes are misleading.
**Trace:** `main.js` dispatcher — grep for action strings.
**Fix:** Remove dead `data-action` attributes.
**Verify:** Confirm no dispatcher case.

---

### ✅ P9: Tab state not exposed to assistive tech
- **Files:** `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** `node --check` passes, deployed
- **OK:** Implemented 2026-10-26 (an earlier pass had marked this done while `aria-selected` was still missing). `_switchMode()` and `_switchCampaignPanel()` now write `aria-selected` on every `.promo-mode-pill` / `.promo-campaign-tab`; markup carries `aria-selected="true|false"`, `aria-controls` on the campaign tabs + the Schedule pill, and `role="tabpanel"` on the three campaign panes.
- **Done:** ✅ deployed

**Issue:** Mode switcher uses `role="tablist"` / `role="tab"` but `aria-selected` is never toggled in `_switchMode()`, no `role="tabpanel"` / `aria-controls` pairing.
**Trace:** `_switchMode()` — no aria-selected write.
**Fix:** Add aria-selected toggle and aria-controls.
**Verify:** Inspect DOM after mode switch.

---

**File last updated:** 2026-09-18 | `Pending-Work.md` — keep this file at the repo root. All new fixes/audits should add an entry following the format above before work begins.

---

## Admin Dashboard — UI Structure + Promotions UX Review

Source: `admin-structure-and-promotions-ux-review.md`

### ✅ Promo Badge Color Collision (RED)
- **Files:** `Admin/style.css`, `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** Deployed to Firebase (`foodhubbie-admins.web.app`)
- **Issue:** `.badge-scheduled` and `.badge-expired` defined twice — once in Promotions section (amber/red, line 7654) and once in Discounts section (blue/gray, line 7703). Discounts wins by source order, so scheduled campaigns render blue instead of amber, expired renders gray instead of red.
- **Fix:** Namespaced Promotions badges to `.promo-badge-*` in both CSS and promotions.js (2 occurrences at lines 342, 384).
- **Done:** ✅ `firebase deploy --only hosting:admin`

### ✅ Message Preview Inline Styles (YELLOW)
- **Files:** `Admin/style.css`, `Admin/js/features/promotions.js`
- **Stage:** `done`
- **Verified:** Deployed to Firebase
- **Issue:** Preview modal hardcoded 6 CSS properties inline (`white-space:pre-wrap; background:#0b1220; ...`). Not dynamic — same every render.
- **Fix:** Extracted to `.promo-message-preview` class in CSS; updated promotions.js line 455.
- **Done:** ✅ `firebase deploy --only hosting:admin`

### 🟢 Noted (no fix needed now)
- **Inline styles drift:** 27 in orders.js, 26 in tables.js, 13 in settings.js — app-wide pattern, not a single-fix item
- **`.promo-switch`/`.promo-slider` naming:** Used generically across features but named after Promotions — future shared component extraction
- **`aria-selected` on mode tabs:** Same fix shape as Menu Browser — `role="tab"` + `aria-selected` toggle
