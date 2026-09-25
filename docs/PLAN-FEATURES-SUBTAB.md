# Plan: Settings ▸ Features Sub-Tab (per-feature on/off + manual + hard-refresh activation)

Status: Implemented + verified. Not yet deployed to production hosting.

Scope answers (user): flag gates **ceiling + discount PIN + void-PIN together** ·
missing flag = **OFF for all** (no migration) · post-save = **full hard refresh**.

## Data model

`businesses/{bid}/outlets/{oid}/settings/features/discountApproval` (boolean).

- Missing ⇒ OFF. Deliberately opposite of the `taxEnabled !== false` convention (`settings.js:151`), which defaults true.
- **No rules change** — inherits `settings/.read` (admins) / `.write` (admins) already in `database.rules.json`.
- **No PurgeCSS safelist** — panel markup lives in `Admin/index.html`, which PurgeCSS already scans.

## Gates (one guard, all callers)

`Admin/js/utils.js` — `state` already imported at `:2`, no cycle (`state.js` imports nothing):

- `:226 gateManagerPin` (void-PIN) — called by `tables.js:1784`
- `:257 gateManualDiscountPin` — called by `tables.js:1657`, `pos.js:924`

```js
if (!state.features.discountApproval) return true;   // off → no prompt, no read
```

Fail-open contract untouched: the flag OFF is an *explicit* short-circuit placed before any
read, not a change to the fail-open rules. `gateManualDiscountPin` skips before the ceiling
read, so the common OFF path costs zero RTDB reads.

## Boot load

- `Admin/js/state.js`: `features: { discountApproval: false }`
- `Admin/js/features/settings.js` `loadStoreSettings()` — 6th element of the `Promise.all` at `:93`:

```js
state.features.discountApproval = featSnap.val()?.discountApproval === true;
```

Strict `=== true` ⇒ missing node is OFF (see scope answer).

## Save + hard refresh

- `settings.js` `saveStoreSettings()` — next to the Security writes at `:336-337`:

```js
updates[tenantPath(Outlet.current, 'settings/features/discountApproval')] = isChecked('featureDiscountApproval');
```

- After the success toast: **only if the value changed** from what was loaded →

```js
if (await showConfirm(msg, '🔁 Hard Refresh Required')) await completeSiteRefresh(msg);
```

- `Admin/js/pwa.js:10` — optional param added: `async (message = default)`, passed through to
  `showConfirm`. Existing `case 'completeSiteRefresh'` (`main.js:284`) is unaffected (default arg).
- The "Discount Approval" inputs in the General panel are `disabled` while the flag is OFF,
  with a one-line hint pointing at the Features tab.

## Default OFF on restaurant creation

`SupremeAdmin/js/features/restaurant-onboarding.js`, inside the `[oid]` object **after**
`...(tplDefaults || {})` (verified: no template object carries a `settings` key → no collision):

```js
settings: { features: { discountApproval: false } },
```

A separate multi-path key is *not* an option — it would overlap `businesses/${bid}` inside the
same `update()` and Firebase rejects overlapping paths.

## UI

Existing subtab pattern `Admin/index.html:1889` (`.settings-subtabs`), switched by
`settings.js` subtab handler via `[data-settings-section]`, initial visibility shows only `general`.

- `<button class="settings-subtab" data-subtab="features">Features</button>`
- `<div class="glass-card p-20 grid-full" data-settings-section="features">` → **one hand-written
  feature card**. No registry/loop: one feature today would be a speculative abstraction; a second
  feature duplicates the pattern.

Card = title · live status · what it does · benefits · toggle · link to the full manual.

Manual source of truth stays `docs/MANAGER-PIN-USER-MANUAL.md`, rendered to
`Admin/dist/manual.html` by `tools/build.mjs` (admin target only).

## Files changed (6 + this record + ledger)

| File | Change |
|---|---|
| `Admin/js/state.js` | `features` default |
| `Admin/js/utils.js` | 2 guards |
| `Admin/js/features/settings.js` | load · save write · refresh popup · input greying |
| `Admin/index.html` | subtab + panel |
| `Admin/js/pwa.js` | message param |
| `SupremeAdmin/js/features/restaurant-onboarding.js` | default `false` |

## Verification

1. `node --check` × 6
2. `node tools/build.mjs --admin` exit 0
3. `node tests/discount-evaluator.check.mjs` 9/9
4. `dist/index.html` has `data-subtab="features"` + panel; `dist/js/main.js` carries `discountApproval`
5. Browser: OFF → save → popup → hard refresh → >ceiling discount settles with **no PIN prompt**;
   ON → prompt returns. Stray screenshots deleted before commit.
6. Commit pathspec-only: `git commit -m "..." -- <paths>` (parallel editor active — never `git add -A`).

## Known consequences

- **Deploy turns the feature OFF for the live tenant immediately** (missing = OFF by scope
  answer). Re-enable once from Settings ▸ Features if the ceiling/PIN/void-PIN gates are wanted back.
- No production deploy in this pass (`firebase deploy --only hosting:admin` is a separate,
  deliberate step).
