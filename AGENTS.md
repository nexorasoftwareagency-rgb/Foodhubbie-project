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
- `tools/build.mjs` — Builds `Admin/dist`; ALSO copies repo-root `shared/` → `dist/shared/` (Admin js imports `../../shared/*`; never delete `shared/` and don't add an `Admin/shared/` duplicate)

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
