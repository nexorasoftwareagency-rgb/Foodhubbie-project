# 29 - The App Notifications send route moved off EC2 (batch 23d-2)

Date: 2026-11-13. Follows 23d-1 (media) in `28_MEDIA_ENDPOINTS_ON_FUNCTIONS.md`.
The box is still down (23_BOX_OFFLINE_INCIDENT.md), so every route that can run
without pm2 or a WhatsApp socket is value delivered while the outage lasts.

## 1. Why this route, and why second

`POST /tenant-api/notify` (`bot-control-api/server.js`) is the App
Notifications tab's send button: verify the caller's ID token, resolve the
tenant from `admins/{uid}`, read that outlet's `pushSubscriptions`, honour
offers consent + quiet hours + daily caps (`bot/notification-caps.js`), write or
skip the in-app inbox (`pushInbox/{phone}`), send the FCM multicast, prune dead
tokens, append the send-history row (`notifyLog`).

It needs **no socket, no pm2, no WhatsApp number** - the only external systems
are RTDB and FCM, both already reachable from Cloud Functions. That makes it:

* the highest-value route left off the required path while the API is down:
  today the tab can read subscribers from RTDB but every send dies on
  `fetch('https://api.foodhubbie.in/tenant-api/notify')`;
* the cheapest to prove equivalent, because the control API's implementation is
  140 lines with no shared mutable state.

It is *not* the on-behalf-of-signup route (`/api/admin/approve-onboarding`)
because that one needs the current `server.js` hardening and that file is
mid-edit by another session; and not the WhatsApp/quota/template routes because
they need the tenant's Meta token and belong with Track A.

## 2. The contract, kept byte-compatible

`functions/src/api/tenantNotify.ts`, mounted at `/tenant-api/notify` with a
`GET /health` probe, identical in behaviour to the control API:

| behaviour | same as control API |
|---|---|
| auth | `Authorization: Bearer <ID token>` → 401 `Missing bearer token` / `Invalid or expired token` |
| tenant | `admins/{uid}` → `outlet` → `businessId` (stored, then `outletIndex`, then the legacy full-tree scan) → the outlet must exist under that business; 403 `Admin not linked to any outlet` / `Outlet not found for this business` |
| body | `{title, body, data?, testMode?, audience?, phone?, type?}`; 400 `title and body are required`, `title or body is too long` (>100/300), `A valid phone is required for this audience` |
| audience | `phone` filters by the 10-digit number; `all` takes every subscription |
| consent | any type except `order` drops subscribers whose `prefs.offers === false` (a record with no `prefs` counts as opted in) |
| caps | promo/offer suppressed 21:00-09:00 IST; `order` 50, `loyalty` 5, `promo` 3 per (phone, type, IST day) |
| inbox | one `pushInbox/{phone}` entry per subscribed phone, **not** written for a test send; pruned with the same `shared/push-inbox.cjs` (cap 50) |
| FCM | data-only multicast, `high` priority, `webpush.fcmOptions.link` = `menu.foodhubbie.in/{oid}/delivery.html?o=&b=&tab=notifications` |
| dead tokens | `registration-token-not-registered` / `invalid-argument` / `invalid-registration-token` delete the subscription (never the synthetic `test` entry) |
| history | `notifyLog` row `{at,type,audience,phone?,title,sent,failed,inbox,total,test,by}`, newest 20 kept, written on **both** exits (including the zero-token one) |
| response | `{ok,sent,failed,total,inbox}`; the zero-audience exit returns `{ok,sent:0,inbox:0,message:'No subscribers for this outlet'}` and **no `total` key** (the client reads `Number(total||0)`, so both paths render) |

Batch 23d-2 also extracted the token/tenant/JSON-body/route helpers into
`functions/src/shared/http/tenant.ts`, and `tenantMedia.ts` now uses them. One
implementation, so a future route (onboarding, WhatsApp, password) cannot drift
on the part that decides *which tenant* a request may touch.

## 3. Wiring: a URL key, not a host swap

Same rule as 23d-1 - the split is by **path**, driven by RTDB:

* `config/notifyUrl` = `https://us-central1-foodhubbie-10.cloudfunctions.net/tenantNotify`
  (live now, read rule = signed-in non-anonymous, same as `config/mediaUrl`).
* `Admin/js/features/app-notifications.js` `_notifyBase()`: `NOTIFY_URL` →
  `config/notifyUrl` → `TUNNEL_URL` → `config/tunnelUrl`. Deleting the function
  restores the previous behaviour without a client deploy.
* The Admin CSP already allowed the Functions origin from 23d-1, so nothing was
  added there. The function's CORS allowlist is the same 4 dashboards + rider +
  localhost, reused from `tenantMedia`.
* CORS preflight answers on the **sub-path**
  (`.../tenantNotify/tenant-api/notify`) because the runtime's cors middleware
  runs before the handler; the handler strips a leading `/tenantNotify` so both
  `/tenant-api/notify` and `/tenantNotify/tenant-api/notify` resolve.

## 4. What is deployed

| item | value |
|---|---|
| function | `tenantNotify` (us-central1, 256 MiB, 60 s, nodejs22, max 10 instances, secret `FIREBASE_DATABASE_URL`) |
| rules | `config/notifyUrl` read = `auth != null && sign_in_provider != 'anonymous'` |
| dashboard | Admin hosting rebuilt from a clean worktree at `cc1f375`, SW `v5.12.51` |
| RTDB | `config/notifyUrl` set |

`functions:list` now shows 15 v2 functions. `tenantNotify` was created (not
updated): it is a new function name, so no live route changed until the client
read the new URL key.

## 5. Live verification

### The endpoint itself - 17/17

`%TEMP%/opencode/e2e-23d2-notify.cjs` against the deployed URL, with a
throwaway Auth user + `admins` row on the e2e tenant, removed afterwards. The
outlet's `pushSubscriptions`, `notifyCaps`, `pushInbox` and `notifyLog` are
snapshotted first and restored byte-for-byte at the end (including on failure).

| # | scenario | result |
|---|---|---|
| 1 | `GET /health` without auth | 200 `{ok:true,service:'tenant-notify'}` |
| 1 | no token / junk token | 401 `Missing bearer token` / `Invalid or expired token` |
| 1 | GET on the route / unknown route | 405 / 404 |
| 2 | admin with no `outlet` / outlet not under the business | 403 with the control API's strings |
| 3 | missing title / 101-char title / phone audience with `12345` | 400 with the control API's strings |
| 4 | promo to `all` with one opted-in + one offers-off subscriber | `total:1` (consent filtered), `sent:0`, `failed:1`, `inbox:1` |
| 4 | the failed token is pruned, the offers-off subscriber is untouched | subscription `a` gone, `b` intact |
| 4 | inbox entry | title/body/`type:'promo'`/`sentAt`/`url` with `o=`+`b=` on `menu.foodhubbie.in`, and **no** inbox for the offers-off phone |
| 4 | history row | `audience:'all'`, `sent:0`, `failed:1`, `inbox:1`, `total:1`, `test:false`, `by:<uid>`, no `phone` |
| 4 | cap slot consumed | `notifyCaps/{phone}/promo/{IST day}` = 1 |
| 5 | `type:'order'` to an offers-**off** phone | `total:1`, `inbox:1` - transactional sends bypass consent, and the inbox row carries `orderId`/`status` |
| 6 | `testMode` with `admins/{uid}/fcmToken` set | `total:1`, `inbox:0`, history `audience:'test'`, and the synthetic entry is never pruned |
| 7 | four promos for one fresh phone | first three attempt (`total:1`), the fourth is suppressed (`sent:0`, `total` absent, `message:'No subscribers for this outlet'`), counter pinned at 3, inbox holds exactly 3 |
| 8 | CORS | preflight `app.foodhubbie.in` echoes the origin; a foreign origin gets no ACAO |

Quiet hours were **not** live-fired: the run happened at 17:27 IST, and faking
the clock would prove nothing about the deployed code path. The window
(21:00-09:00 IST) and all three caps are pinned on **both** sides by
`tests/functions-source.check.cjs`, so drift fails the guard instead.

### The real client path - 12/12

`%TEMP%/opencode/e2e-23d2-client.cjs` at `https://app.foodhubbie.in/demo`
(deployed Hosting bundle, real production ID token, real CORS origin) with one
seeded fake subscriber on the demo tenant:

* Customer APP → Push Notifications lists the seeded subscriber (`1`);
* the send button enables for `all`, the confirm dialog appears and is accepted;
* the result panel reads "No push delivered, but 1 saved to the in-app inbox -
  customers will see it in the app." and contains no `NaN`/`undefined`;
* `window.NOTIFY_URL` is the Functions host, the POST goes to
  `.../tenantNotify/tenant-api/notify`, and **zero** POSTs go to
  `api.foodhubbie.in`;
* the demo inbox holds exactly that send (`type:'promo'`, `tab=notifications`
  link), `notifyLog` holds one row (`audience:'all'`, `total:1`, `failed:1`,
  `by` = the demo uid), and the dead seeded token is gone;
* 0 console errors; the demo tenant is restored byte-for-byte afterwards.

## 6. A live bug this batch found and fixed

The first client run failed with
`ReferenceError: _loadPushSubscriptions is not defined` — and it replaced the
**success** result with an error message. The send path called
`_loadPushSubscriptions()` / `_loadHistory()`; the real functions are
`loadPushSubscriptions()` / `loadHistory()` (no underscore). Every send from the
tab therefore threw after the FCM response and rendered a bogus error, and the
subscriber/history lists never refreshed. It shipped unnoticed because the
control API has been down since 2026-11-11, so the same code path could only
reach its catch block anyway. Fixed in `cc1f375` (`await loadPushSubscriptions();
await loadHistory();`), SW bumped to `v5.12.51`, and the guard now pins both
names plus "no `_loadHistory`" so a rename cannot reintroduce the phantom call.

## 7. Honest limits

* **Quiet hours unproven live** (above). The parity guard is the substitute.
* `loyalty` and `system` types collapse to the **promo** cap and consent rules
  because the server maps `type === 'order' ? 'order' : 'promo'` - that is the
  control API's behaviour, kept deliberately (parity), not a new decision. If
  the tenant wants a 5-send loyalty cap, both sides must change together.
* The zero-audience response omits `total`; the client tolerates it. Anything
  new reading this endpoint must do the same.
* **`wallet-watch` stays on EC2** (decision from batch 14): it keeps live
  listeners to avoid re-reading orders every minute, and no outlet is armed.
  Moving it to a 1-minute scheduled function would regress that.
* FCM delivery was exercised only with deliberately fake tokens (sent 0, pruned)
  and with test mode. A real OS notification on a real device is still the
  2026-11-07 FCM audit's honest limit, unchanged by this batch.
* The route is not yet the **only** notify implementation: `server.js` keeps its
  copy until the box is back and 23d finishes. While `config/notifyUrl` points
  at the function, the dashboard uses the function; the bot's own
  `notifyCustomerApp`/`notifyTierUp`/`sendFCMToAdmins` are separate and still
  need the box.

## 8. Files

* `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts` - the endpoint.
* `FIREBASE_SERVER_MIGRATION/functions/src/shared/http/tenant.ts` - shared
  token/tenant/body/route helpers; `tenantMedia.ts` refactored onto it.
* `FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs` - ships
  `shared/push-inbox.cjs` (+ load check on its cap).
* `Admin/js/features/app-notifications.js` - `_notifyBase()` notifyUrl →
  tunnelUrl; the phantom-name fix.
* `database.rules.json` - `config/notifyUrl` read.
* `Admin/sw.js` - `v5.12.51`.
* `tests/functions-source.check.cjs` - 83 checks (tenant helper + caps parity).
* `tests/app-notifications.check.mjs` - adds "the send path refreshes through
  functions that exist".
* Harnesses: `%TEMP%/opencode/e2e-23d2-notify.cjs`, `e2e-23d2-client.cjs`.
