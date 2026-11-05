# FoodHubbie Onboarding Audit and Redesign (2026-10-28)

Audited from the public repo at commit `a4392f1` (`main`). Nothing was run against production. The live pricing page was not reachable from the audit environment, so no price is stated here or hardcoded in code.

## 1. Verified architecture
| Area | Finding |
|---|---|
| Stack | Vanilla-JS ES-module SPAs (Admin, SupremeAdmin, menu), React/Vite rider app, Node WhatsApp bot (Baileys), `bot-control-api` (Express + Firebase Admin SDK) |
| Data / auth | Firebase Realtime Database + Firebase Auth. Tenant path: `businesses/{bid}/outlets/{oid}`. Roles in `admins/{uid}` |
| Hosting | Firebase Hosting targets; build via `tools/build.mjs` (esbuild); bot on EC2/PM2 |
| Tests | Playwright specs in `tests/` (configured against the live admin URL), many `*.check.mjs` scripts, bot unit tests, `gate-verify.js`. CI runs encoding guard, bot unit tests, gate-verify only |
| Not verified | Live behaviour, live DB rules state, deployment credentials, Supreme Admin UI run-through |

## 2. Actual onboarding journey
1. `website/signup.html`: one-page form (business, outlet, phone, emails, admin name, password, plan, WhatsApp option, terms).
2. Browser POSTs `onboardingRequests` (no password) then PUTs password to write-only `onboardingSecrets/{key}`. Both are unauthenticated writes allowed by rules.
3. Supreme Admin reviews in `SupremeAdmin/js/features/onboarding-requests.js` and approves via `POST /api/admin/approve-onboarding` (`bot-control-api/server.js`): creates Auth user, `admins/{uid}`, outlet with `locked: true`, billing defaults; deletes the secret.
4. Owner logs in to Admin. `Admin/js/auth.js` sets `state.locked`; `showLockedScreen()` blocks every non-safe click until Supreme Admin sets `locked: false` (setup fee).
5. Unlocked owner lands on a dashboard with no guidance. No setup checklist existed.

## 3. Product decisions (owner, 2026-10-28)
1. No manual approval. Sign-ups are created automatically; the owner is notified in Supreme Admin and keeps full control (lock, unlock, disable).
2. The lock must be enforced in the database rules, not only in the browser.
3. A locked restaurant gets setup-only access (menu, tables, settings, wallet), not a dead screen.
4. The last required setup step is a wallet top-up of at least Rs 1,000. The restaurant pays FoodHubbie directly (UPI/bank), contacts Supreme Admin, who records the payment. The balance is shown and used in the Cost tab, which was redesigned as a wallet.

5. Low-balance rule: warn when the wallet is at or below 25% of everything topped up so far; orders stop only at zero (stopping is not enforced yet, see section 7).
6. New percentage package, chosen per restaurant in Supreme Admin: 1% of order value on QR, POS and all other features, 2% on WhatsApp-based ordering. Flat per-order stays the default; existing restaurants are unchanged until you switch them. Making this package visible on the website and pricing pages comes later.

## 4. Findings and status
| # | Finding | Status |
|---|---|---|
| 1 | "Application received!" box had no CSS and was always visible | Fixed |
| 2 | Retry created duplicate requests; form re-enabled after success | Fixed |
| 3 | `alert()` validation, no inline errors | Fixed |
| 4 | Email ownership not verified; applicant picks the password | **Open, higher risk now** because approval is automatic. See section 7 |
| 5 | Password held in `onboardingSecrets` until approval; manual approval API returns it | Auto path never returns or logs it. Manual endpoint unchanged. Still stored until approval (seconds now) |
| 6 | Unauthenticated writes, no rate limit | Partly mitigated: auto-approval capped at 20/hour (env `AUTO_APPROVE_MAX_PER_HOUR`), extras stay pending, new outlets are locked and inert. Rules-level rate limiting / App Check still open |
| 7 | Lock enforced only in the browser | Fixed for orders, table sessions and table requests (rules). See limits in section 7 |
| 8 | Locked owners could do nothing | Fixed: setup-only mode |
| 9 | No setup checklist | Done |
| 10 | Address / menu / tables never prompted | Done (checklist) |
| 11 | E2E tests target production | Open |
| 12 | Plan doc stale | Open |
| 13 | Cost tab had usage only, no balance | Fixed: Wallet view |

## 5. What changed (branch `feat/onboarding-setup-checklist`)
- `website/signup.html`: findings 1-3; copy now says the dashboard is created automatically and a Rs 1,000 minimum wallet is needed to go live.
- `bot-control-api/server.js`: approval logic extracted into `approveOnboardingRequest()` (manual endpoint behaviour unchanged) plus an auto-approval watcher. Creates the outlet locked, writes a Supreme notification (`inquiries`), retries while the browser's password write lands, rejects duplicate emails, caps per hour, kill switch `ONBOARDING_AUTO_APPROVE=off`.
- `database.rules.json` (3 lines): writes to `orders`, `tableSessions`, `tableRequests` are refused while the outlet is `locked`, except for Super/Supreme admins.
- `Admin/js/ui.js`, `auth.js`, `main.js`: setup mode. Allowed tabs: dashboard, menu, categories, combos, menu browser, tables, inventory, settings, costs, notifications. Slim banner, dismissible "top up to go live" popup, auto-reload when unlocked.
- `Admin/js/features/setup-checklist.js` (+ `index.html`, `ui.js`): dashboard checklist. Last required step is the Rs 1,000 top-up (done when total recorded payments reach the minimum), then "first order".
- `shared/cost-math.js`: `MIN_TOPUP` and `computeWallet()` (balance = paid - orders - promo - charges; same ledger as Supreme's "due", sign flipped).
- `Admin/js/features/costs.js` + `index.html`: new default "Wallet" sub-tab (balance, topped up, used, charges, how to top up, top-up history). Existing Overview/Breakdown/Feed/Connect kept.
- Percentage package: `shared/cost-math.js` (`percentage` mode, `PERCENT_RATES`, `rateLabel`, `normalizeMode`), used by the Admin Cost tab, Supreme billing math, payment record and billing card. Supreme restaurant profile: "Switch to ..." buttons (`billing-set-mode`) with a confirmation that states the effect.
- Low balance (`walletLevel`, `LOW_BALANCE_RATIO = 0.25`): dashboard banner in Admin (`features/wallet-alert.js`), colour and message in the Wallet view, and in Supreme > Payments a "low balance" / "wallet empty" chip per restaurant plus a "Low / empty wallets" tile.
- `SupremeAdmin/js/billing-shared.js`: after recording a payment that brings a locked restaurant to the minimum, shows a reminder to unlock it.

## 6. Test report
| Check | Result |
|---|---|
| `node tests/signup-onboarding.check.mjs` (mocked network; needs Playwright chromium) | Passed 12/12 |
| `node tests/auto-onboarding.check.cjs` (real server functions, fake Admin SDK) | Passed 6/6 |
| `node tests/admin-wallet-checklist.check.mjs` (real modules, stubbed Firebase/DOM) | Passed 12/12 |
| `node shared/cost-math.js` | Passed |
| `node tests/encoding-check.mjs`, `node tests/check-imports.mjs`, `node tools/check-shared-twins.cjs` | Passed |
| `node gate-verify.js` | Passed (live DB gate skipped) |
| `database.rules.json` parses as JSON | Passed |
| Percentage package and 25% rule (`node shared/cost-math.js`, wallet/alert test) | Passed |
| Supreme Admin screens (mode switch, chips) | Syntax-checked only, **not run** |
| Database rules behaviour (emulator) | **Not run**: emulator not installable here. Test before deploying |
| `npm run build:admin` | **Blocked**: npm registry unreachable here |
| Admin app in a real browser (setup mode, banner, tab gating, wallet) | **Not run** |
| Live auto-approval against real Firebase | **Not run** |
| Existing Playwright specs | Not run (target production) |

## 7. Known limits and risks
- **Rules untested.** The lock gate was verified by reading and JSON validation only. Run it in the Firebase emulator (`tests/rules.emulator.mjs`) before deploying, including: locked outlet admin cannot create orders/sessions/requests; unlocked outlet unchanged; Supreme can write either way; public QR ordering on an unlocked outlet unchanged.
- **Lock covers orders, table sessions and table requests only.** Other writes (settings, menu, inventory) stay open by design. The WhatsApp bot and promos run on the server with admin credentials and are not blocked by rules. If you need promo sending stopped for locked outlets, that is a bot-side check.
- **Warning only, no hard stop.** At 25% left the restaurant sees a warning and you see a chip in Supreme > Payments. Nothing stops orders at zero yet, and you do not get a push notification (the Payments tab is where you see it). A hard stop at zero would need the same rules approach as the lock plus a server-maintained balance.
- **Changing a restaurant's package re-prices its past orders** in reports and the wallet for any period shown, because fees are computed from orders, not stored. Switch at the start of a billing period.
- **Public visibility of the percentage package** (website pricing, `llms.txt`, plan pages) is not done yet.
- **Email still unverified.** With auto-approval, anyone can register any unregistered email with a password of their choice. Mitigations in place are small (hour cap, locked outlets). Recommended next step: send a password-set link to the email instead of storing a chosen password, or require email verification.
- **Wallet is computed in the browser** from all orders (one read when the Cost tab opens). Fine for new restaurants; for large order histories it should move to a server-maintained balance.
- **Public pricing copy conflicts.** `website/pricing.html` and `PRICING_AND_TERMS.md` describe a Rs 500 one-time setup and no minimum balance. They were not changed. Please decide the public wording.
- **Auto-approval needs the API process restarted** and assumes a single instance, like the status watcher. It only approves sign-ups from the last 15 minutes, so requests already pending when the API (re)starts stay for manual review (found and fixed in the final recheck).

## 8. Deployment order (nothing was deployed)
1. Run the rules emulator test; fix anything it finds.
2. Deploy rules: `firebase deploy --only database`. Existing locked outlets immediately lose order writes.
3. Deploy `bot-control-api` (restart via PM2). Optional env: `ONBOARDING_AUTO_APPROVE=off` to disable, `AUTO_APPROVE_MAX_PER_HOUR`.
4. `npm run build:admin && npm run deploy:admin`, `npm run build:supreme && npm run deploy:supreme`.
5. Deploy the website (`signup.html`) last, so the new copy only appears once auto-approval is live.
Rollback: revert the commit and redeploy; rules rollback restores order writes for locked outlets.
