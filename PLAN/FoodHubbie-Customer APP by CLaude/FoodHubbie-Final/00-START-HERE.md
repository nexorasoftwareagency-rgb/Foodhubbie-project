# FoodHubbie — Final package (2026-11-02)

Built on GitHub `main` @ `26322b8` (re-fetched today: unchanged). Nothing was deployed or pushed to your GitHub.

## What is inside
- `docs/FINAL-COMPATIBILITY-GUIDE.md` — what changed, deploy order, what works with what, rollback, smoke test. **Read this first.**
- `docs/FINAL-VERIFICATION-REPORT.md` — what was actually tested and what was NOT.
- `docs/PLAN-DEDICATED-CUSTOMER-APP.md` — the plan and phase notes for the restaurant app.
- `source/` — the complete final code (main + all changes), ready to use.
- `patches/foodhubbie-ALL-IN-ONE.patch` — ONE patch with every change; applies cleanly on `main` @ `26322b8`.
- `patches/step-by-step/` — the same work split in stages (loyalty, direct mode, direct ordering, pricing, tabs, payments, in-app ordering, phone privacy) if you prefer to review one at a time. Apply in that order. The file starting `00-EARLIER…` is old onboarding work already in GitHub: do NOT apply it.

## How to use (pick one)
A) Use `source/` directly as your project folder (then `git add` / commit it yourself), or
B) In a fresh clone of your repo at `main`: `git apply patches/foodhubbie-ALL-IN-ONE.patch`

## Before you deploy
1. Run the rules tests (never run by me): `npx -y firebase-tools emulators:exec --only database --project demo-foodhubbie "node tests/rules.emulator.mjs"`
2. Make sure Firebase Anonymous sign-in is ON.
3. Follow the deploy order in the compatibility guide.
