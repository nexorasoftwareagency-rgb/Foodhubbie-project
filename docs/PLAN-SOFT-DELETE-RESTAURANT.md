# Plan: Restaurant Soft-Delete (Disable) + Reactivate

Status: Design approved — pending implementation.
Scope answers (user): per-outlet flag · **all stops (orders, dining-in, login, bot)** · soft-delete only (no hard erase).

## Data model

Add to `businesses/{bid}/outlets/{oid}/` (RTDB):

```
disabled:      true              // absent/false = active
disabledAt:    1787112345678     // epoch ms
disabledBy:    "supreme-uid"
reactivatedAt: 1787200000000     // set on reactivate
reactivatedBy: "supreme-uid"
```

- Per-outlet: the Supreme dashboard lists outlet rows; a business may own several outlets, each disabled independently.
- No migration needed — `disabled` absent = active everywhere.
- Rules already accept arbitrary fields at outlet level (`database.rules.json` has no `.validate` on `$outletId`), so **no schema change**.

## The 3-step Disable confirmation (Supreme Admin)

New **Danger Zone** card on `restaurant-profile.js` profile page. Modal = 3 sequential steps, back/close allowed at any point:

| Step | UI | Writes nothing |
|---|---|---|
| 1 | **Warning screen**: lists consequences — bot stops, QR/menu/table ordering stops, staff login blocked, hidden from Main dashboard; **all data preserved**, reactivatable anytime. | |
| 2 | **Type the outlet name** to confirm (case-insensitive match) + checkbox "I understand no data is deleted." | |
| 3 | **Final red "Disable restaurant"** button — enabled only when name matches AND checkbox ticked. Single click triggers the disable transaction. | |

Follows the existing `showBulkDeleteConfirm` typed-confirm pattern (`Admin/js/ui-utils.js:132`).

## What "Disable" does (atomic-ish)

1. **RTDB update** (`SupremeAdmin`): `outlets/{oid}` ← `{ disabled: true, disabledAt, disabledBy }`. Optionally mirrored to `suspended: true` so orchestrator stops the worker (`bot-control-api/orchestrator.js:35`).
2. **Stop bot**: POST `/api/bot/stop/{bid}/{oid}` (exists, `server.js:273`, `requireSuperOnly`) — stops the EC2 worker, **keeps session/data**. If no worker exists, skip.
3. UI moves the row to the **Disabled tab** automatically (real-time listener re-renders).

Failure handling: if the bot stop fails, the disable still succeeds (flag rules take effect); toast warns "bot stop failed, retry stop later".

## The Disabled tab (Supreme Admin)

- `restaurant-list.js` gets a tab rail: **Active | Disabled** (default Active).
- Implemented by extending `data-store.js flattenOutlets({ includeDisabled })`:
  - Active tab: default (excludes `disabled === true`)
  - Disabled tab: `includeDisabled: true` then filters `disabled === true`
  - `flattenOutlets` already feeds the list, command palette, bot fleet, and analytics picker — excluding disabled in the default path cleans **all surfaces at once**.
- Disabled tab rows show: Disabled date, outlet/business name, and a **Reactivate** button.
- **Reactivate** = 1-step confirm (non-destructive) → writes `{ disabled: false, reactivatedAt, reactivatedBy }` (keep `disabledAt` for audit) → row returns to Active tab → bot worker restarted via `/api/bot/restart/{bid}/{oid}` (or provision if no worker).
- Direct profile URL of a disabled outlet stays viewable (read-only flag banner) — Supreme must inspect before reactivating.

## Propagation — "all stops" checklist

| Surface | Gate | Mechanism |
|---|---|---|
| QR / webview orders | Block new creates + Pending→Placed promotion | Rules: add `!disabled` to unauth write clauses on `orders/$orderId` (`rules:102`) |
| Menu app UI | Show "Restaurant temporarily disabled" | `menu/js/order.js` + `session.js` read `outlets/{oid}/disabled` before allowing order/session |
| Table dining-in | Block session create, in-session orders, table requests | Rules: add `!disabled` to unauth clauses on `tableSessions/$s` (`240`), `tableSessions/$s/orders` (`242`), `orderGroups` (`246-248`), `tables/$t` (`231`), `tableRequests` (`280`) |
| Staff login (Admin app) | Block non-super login when outlet disabled | `Admin/js/auth.js` `onAuthStateChanged`: after `adminData` resolves, if `!isSuper && !isSupreme`, read `outlets/{oid}/disabled` (bid from `adminData.businessId` else `BUSINESS_BY_OUTLET[outlet]`); if true → ACCESS DENIED "restaurant disabled", `signOut()`. Reload of an already-logged-in session re-runs the gate. |
| Bot | Stop worker | `/api/bot/stop` + orchestrator `suspended` flag |
| Command palette / bot fleet / analytics | Exclude disabled | Free via `flattenOutlets` default filter |
| Rules read-access to the flag | Allow anonymous menu app to read `disabled` | Add `"disabled": { ".read": "true" }` under `$outletId` — exposes one boolean, nothing else |

## Security-rule edits (all under `businesses/{bid}/outlets/{oid}`)

Add to the **unauth** clauses only (admin/super auth-gated clauses stay unchanged — existing order management still allowed for the right outlet):

```
&& !root.child('businesses').child($businessId).child('outlets').child($outletId).child('disabled').val() == true
```

Locations:
- `orders/$orderId/.write` QR + webview create + Pending→Placed branches (`:102`)
- `tableSessions/$sessionId/.write` unauth branch (`:240`)
- `tableSessions/$sessionId/orders/.write` (`:242`)
- `tableSessions/$sessionId/orderGroups/$groupId/.write` + its `orders` + `status` unauth branches (`:246-251`)
- `tables/$tableId/.write` session-transition branch (`:231`)
- `tableRequests/$reqId/.write` create branch (`:280`)
- New `"disabled": { ".read": "true" }` under `$outletId`

Cancellations by riders/admins remain permitted (their clauses are auth-gated, not touched).

## Files to touch

| File | Change |
|---|---|
| `database.rules.json` | `disabled` gate on unauth order/table/session writes; `"disabled": { ".read": "true" }` |
| `SupremeAdmin/js/data-store.js` | `flattenOutlets({ includeDisabled })` + emit `disabled`, `disabledAt` |
| `SupremeAdmin/js/features/restaurant-list.js` | Active/Disabled tabs, Disabled tab UI, Reactivate button |
| `SupremeAdmin/js/features/restaurant-profile.js` | Danger Zone card + 3-step disable modal + reactivate action |
| `Admin/js/auth.js` | Login gate: deny non-super login when outlet disabled |
| `menu/js/order.js`, `menu/js/session.js` | Check `disabled` → block order/session with clear message |
| `SupremeAdmin/js/features/command-palette.js` | (free via flattenOutlets) verify no other outlet source |
| `bot-control-api/orchestrator.js` | Verify `suspended` already stops worker (no change expected) |

## Verification (Tier 3)

- Rules: deploy + hit each unauth write path (QR order, session create, in-session order, table request) with a disabled outlet → expect PERMISSION_DENIED; admin paths still work; menu `disabled` field readable.
- Menu app: disabled outlet shows blocked UI, no order can be placed.
- Admin login: staff account of disabled outlet → ACCESS DENIED; supreme/super unaffected.
- Reactivate: row returns to Active, staff login works, ordering resumes, bot restarts.
- Real-time: disabling from profile page moves row to Disabled tab without reload.
- Deploy `--only database,hosting` + Supreme Admin hosting target.

## Risk & pre-mortem

- Rules gate must not break the anonymous QR flow (biggest regression risk). Test QR create against an ACTIVE outlet still passes after the edit.
- Reactivation must not silently leave the bot dead — verify worker/session exists before offering reactivate; warn if not.
- Writing `disabled` requires the Supreme's rules read — `restaurant-profile.js` runs as Supreme (Super/Supreme read + write allowed at `$businessId`), so the flag write is permitted.

## Out of scope (unless asked)

- Permanent hard-delete (full `remove()` of business/outlet). Would be a separate, super-only, typed-confirm action.
- Disabling whole business (per-outlet chosen).