# FoodHubbie — Final package v2 (2026-11-02, includes the bot review)

Built on GitHub `main` @ `26322b8` (re-fetched twice: unchanged). Nothing was deployed or pushed.

- `docs/FINAL-COMPATIBILITY-GUIDE.md` — read first: deploy order, what works with what, rollback, smoke test.
- `docs/FINAL-VERIFICATION-REPORT.md` — what was tested / not tested; section F = bot review (4 fixes, open items).
- `docs/PRICING-CONTEXT-FOR-TERMS.md` — facts for you to update PRICING_AND_TERMS.md yourself.
- `docs/PLAN-DEDICATED-CUSTOMER-APP.md` — plan and phase notes.
- `source/` — complete final code.
- `patches/foodhubbie-ALL-IN-ONE.patch` — every change in one patch (applies cleanly on `main` @ `26322b8`).
- `patches/step-by-step/` — the same work in 9 stages (loyalty, direct mode, direct ordering, pricing, tabs, payments, in-app ordering, phone privacy, bot review).

Before deploying: run the rules tests (never run by me): `npx -y firebase-tools emulators:exec --only database --project demo-foodhubbie "node tests/rules.emulator.mjs"`
