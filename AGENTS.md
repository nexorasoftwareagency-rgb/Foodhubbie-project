# Project Context — Prasant Pizza ERP

## Goal
Production-ready Pizza ERP system: customer menu app (QR ordering), admin dashboard, rider dispatch. Firebase Realtime Database + Hosting (3 targets).

## Completed Audit Fixes (10 Agents)
All 10 audit agents deployed. Key fixes:
- **Firebase Rules**: Fixed C1-3 critical auth bypasses, H1, G4; added `tableSessionsContact` for PII segregation
- **PII**: Phone numbers moved to `tableSessionsContact` path (auth-gated), removed from `tableSessions` (world-readable)
- **Orders**: Written as `Pending`, promoted to `Placed` only after successful session attach; cancelled excluded from billing
- **Session Lifecycle**: `_policeExpiredSessions` cancels orders + clears arrays; expiry saves draft; `clearTrackingTimer` exported
- **Data Integrity**: `_cancelSessionForTable` adjusts totals; KPI from `_effectiveTotal()`; CSV uses `_effectiveTotal()`
- **Multi-Bill**: Groups remain independent; `requestBill` writes to `orderGroups/$groupId/status`; close rejects mixed status
- **Deployment**: `firebase deploy --only database,hosting` succeeds — 3 targets (admin, rider, menu) live
- **Soft-Delete Restaurants (PLAN-SOFT-DELETE-RESTAURANT.md)**: Implemented + verified live. Per-outlet `disabled`/`disabledAt`/`disabledBy` on `businesses/{bid}/outlets/{oid}`; 9 rule gates on unauth order/table/session/group/request writes + public `disabled` read; Supreme tabs (Active|Disabled) + Danger Zone 3-step disable modal + reactivate; Admin login gate (`Admin/js/auth.js`); menu `screenDisabled` boot gate (`menu/js/app.js`) + `placeOrder` guard. Verify: `node --check` + live REST rule tests (active outlet QR write passes, disabled outlet blocked 401, super/own-admin can write flag, cross-outlet admin denied)
- **Supreme Onboarding Wizard**: "Add Restaurant" redesigned as a 5-step wizard (Business → Plan → Admin login → WhatsApp → Review) in `SupremeAdmin/js/features/restaurant-onboarding.js` + `.obw-*` CSS block. Per-step validation with error toast + focus-to-field, plan cards, review summary (masked password), FormData retained across back-nav. Deployed + live E2E verified 2026-09-28 (screenshots: `.playwright-mcp/wizard-review*.png`).
- **Payment Management (Supreme, PLAN-SUPREME-PAYMENT-MANAGEMENT.md)**: 3rd topbar tab (indigo) → `#payments` list of every restaurant's usage/due per plan (`payment-overview.js`) + `#payments/{bid}/{oid}` record page (All time/Monthly/Yearly/Custom, ledger + running balance, popup-print receipt) (`payment-record.js`) + profile Billing card money strip & "Record payment". Money math lives once in `SupremeAdmin/js/billing-shared.js` over `shared/cost-math.js` (moved from `Admin/js/features/` — sole prior importer `costs.js` now imports `../../shared/`; `tools/build.mjs` has `supreme.shared:true`). Writes `businesses/{bid}/outlets/{oid}/billing/{payments,charges}` (validated in `database.rules.json`, write = super/supreme). Deployed + live E2E verified 2026-09-28 (Admin Costs parity exact, record in both places, QR order +₹2; screenshots: `.playwright-mcp/payments-overview.png`, `payment-record-page.png`, `receipt.png`).
- **Ban-proofing + template-migration review fixes (2026-09-29, ledger 0005)**: `bot/utils.js` exports `paceOutboundTo` (4–8s random per-chat outbound gap, wired into all 3 send wrappers) + `recordWrongMessage`/`isJidFrozen`/`clearWrongStrikes` (3 continuous non-intent msgs in AWAITING/WEBVIEW → 30-min silence: chat replies + promos/generic dropped, transactional order notices continue, admins never strike); `transport.js sendTemplate` maps `body`→`{{1}}` BODY component (proactive_promo has NO vars → code100 → text fallback); Baileys outlets guarded (`typeof sock.sendTemplate === 'function'`) with restored legacy `msg`/`img` status texts; `isDineIn && isNew`→`isDineIn`; template param counts verified vs Graph (1/4/2/3/5/2 ✅); tests 13/13. **Both pm2 bots run `transport=baileys`** (id4 = live pizza; id12 = wizard-test outlet, never paired — pre-existing). **Ban-proofing is Baileys-scope only**: when official WhatsApp Business API (meta transport, "best experience delivery" plan) is enabled post-WABA, skip `paceOutboundTo` + strike/freeze (Meta enforces its own limits) — checklist item at flip, see standing decision in PROJECT_LEDGER.md. **Promotional messaging hard-blocked on Baileys (2026-09-30)**: `runPromotionCampaign` pauses campaigns with `pauseReason:'transport-blocked'` + `sendPromotionalMessage` throws unless `isMetaTransport(sock)` (bot/utils.js) — campaigns are the top ban trigger; live E2E verified on test outlet. `SEND_GENERIC_MESSAGE` (Admin Chat / rider 1:1 service replies) intentionally NOT blocked.

## Relevant Files
- `menu/js/app.js` — Customer app (QR ordering, cart, customization)
- `menu/js/order.js` — Order lifecycle (Pending→Placed, attach to session)
- `menu/js/session.js` — Session creation, PII handling
- `Admin/js/features/tables.js` — Table management, session policing, `_effectiveTotal()`
- `Admin/js/features/orders.js` — Order management, KDS
- `Admin/js/features/promotions.js` — Promotion engine
- `Admin/js/features/pos.js` — Point of sale
- `Admin/js/features/catalog.js` — Menu catalog
- `Admin/js/main.js` — Admin app shell
- `menu/js/ui.js` — Customer UI components
- `database.rules.json` — Firebase security rules (all fixes applied)
- `shared/` — Shared Firebase config, formatters, DOM helpers
- `tools/build.mjs` — Builds `Admin/dist` + `SupremeAdmin/dist` (`supreme.shared:true`); ALSO copies repo-root `shared/` → `dist/shared/` (Admin js imports `../../shared/*`, Supreme `/shared/*`; never delete `shared/` and don't add an `Admin/shared/` duplicate)

## Key Decisions
- `_effectiveTotal(sess)` replaces `sess.grandTotal` everywhere (table card, drawer, CSV, KPI)
- PII → `tableSessionsContact` with `auth != null` read
- `runTransaction` kept for session attaches (atomic)
- `_toastQueue` FIFO prevents message loss

## Ponytail — Laziness Ladder

**Active every response. Default: full.** Switch: `/ponytail lite|full|ultra|off`.

Stop at the first rung that holds:
1. **Does this need to exist?** Speculative need = skip it (YAGNI)
2. **Already in this codebase?** Reuse helper/util/pattern that already lives here
3. **Stdlib does it?** Use it
4. **Native platform feature covers it?** (`<input type="date">` over a picker lib)
5. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do
6. **Can it be one line?** One line
7. **Only then:** minimum code that works

**Bug fix = root cause, not symptom.** Grep every caller before editing. One guard in the shared function beats a guard in every caller.

**Rules:**
- No unrequested abstractions (single-impl interface, factory for one product, config for invariant)
- No boilerplate, no scaffolding "for later"
- Deletion over addition. Boring over clever
- Fewest files possible. Shortest working diff wins
- Mark simplifications: `// ponytail: this exists — upgrade when X`
- Non-trivial logic leaves **one** runnable check (`assert` or small `test_*.py`)

**When NOT lazy:** input validation at trust boundaries, error handling preventing data loss, security, accessibility, anything explicitly requested. Never lazy about reading the problem first.
