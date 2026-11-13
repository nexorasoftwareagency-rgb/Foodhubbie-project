# 28 — Media endpoints moved off EC2 to Cloud Functions (batch 23d-1)

Status: **live**. `tenantMedia` runs on `us-central1` as an HTTPS 2nd-gen function,
`config/mediaUrl` points the dashboards at it, and the rules grant that one read.
Uploads and image deletes work with EC2 still down — which is the reason this slice
went first.

## 1. Why this slice, and why now

Batch 24 (`24_WHATSAPP_OFF_EC2_DEPENDENCY.md`) splits the control API into pieces
that can leave the box independently. The media routes were picked first because
they score highest on three axes at once:

* **Pure cloud.** `POST /tenant-api/upload` and `POST /tenant-api/delete-image`
  verify an ID token, resolve `admins/{uid}` and touch Storage. No pm2, no
  Baileys socket, no Redis, no bot state — nothing that needs the box.
* **Completely dead while the box is down.** Every dish, category, combo, rider
  and store-image save in the Admin dashboard goes through these two routes. With
  EC2 unreachable since 2026-11-11 20:03 IST, tenants could not change a single
  photo. Moving them restores real functionality, not just an architecture
  diagram.
* **Small blast radius.** Two routes with an existing, well-defined contract
  (`bot-control-api/server.js`), used by one client module
  (`Admin/js/firebase.js`). If the function misbehaves, the fallback is one RTDB
  key.

`/tenant-api/notify` was deliberately **not** included: it imports
`bot/notification-caps.js`, which another session currently has modified
uncommitted. Shipping half of that file's behaviour would be worse than waiting.

## 2. The contract, kept byte-compatible

| | control API (EC2) | `tenantMedia` (Functions) |
|---|---|---|
| upload | `POST /tenant-api/upload` `{dataUrl,type,id}` | same |
| delete | `POST /tenant-api/delete-image` `{url}` | same |
| body cap | 8 MB route parser, 6 MB image | same numbers; `rawBody` first, then stream with the same cap |
| error strings | `Missing bearer token`, `Invalid or expired token`, `Admin not linked to any outlet`, `Outlet not found for this business`, `dataUrl must be a base64 image data URI`, `type and id are required`, `Unsupported image type <mime>`, `Empty image`, `Image too large (max 6 MB)`, `Not an image of this outlet`, `url is required`, `Upload failed — …`, `Delete failed — …` | identical |
| object path | `outlets/{bid}/{oid}/{plural}/{id}/original.{ext}` | same, same `mediaSeg` sanitiser |
| write | byte-for-byte, `resumable:false`, `firebaseStorageDownloadTokens` | same |
| tenancy | **token only** — never the body | same (guard asserts it) |

The plural map, the guessed plural for unknown types, the `ignoreNotFound` delete
and the 403-before-delete prefix check are copied on purpose: the dashboard prints
`body.error` to the user, so a drifted string changes UX.

Tenant resolution keeps the control API's three-step order: stored
`admins/{uid}.businessId` → `outletIndex/{outlet}.bid` → legacy full-tree scan
(only for admins created before `businessId` was stamped). The outlet must then
exist under that business.

### CORS

`onRequest({ cors: [...] })` with the four dashboard origins plus
`https://rider.foodhubbie.in` (rider app uploads exist) and localhost/127.0.0.1
regexes for `tools/serve-dist.cjs`. The runtime answers the preflight, so nothing
in the handler has to. Verified on the wire:

```
OPTIONS, Origin: https://app.foodhubbie.in  -> 204, ACAO echoed, ACAH authorization,content-type
OPTIONS, Origin: https://evil.example       -> 204, no ACAO
```

## 3. The split is by URL, not by host

`Admin/js/firebase.js` gains `mediaBase()`:

```js
window.MEDIA_URL  ->  ref('config/mediaUrl')  ->  fallback: apiBase()
```

`uploadImage`/`deleteImage` use it; every other control-API call still uses
`apiBase()` (`config/tunnelUrl` = `https://api.foodhubbie.in`). So today the
dashboards post images to Functions and everything else to EC2, and **deleting the
function changes nothing worse than before** — the client falls back to the old
host the moment `config/mediaUrl` is absent.

RTDB `config/mediaUrl` is set to
`https://us-central1-foodhubbie-10.cloudfunctions.net/tenantMedia`.

**CSP has to allow the new origin, or nothing leaves the page.** The admin target's
`connect-src` listed `https://api.foodhubbie.in` but not the Functions host, so the
deployed dashboard would have blocked every upload before the request was sent —
the exact failure the promo API hit on 2026-11-08. The origin was added to the five
admin CSP blocks (`index.html`, `sw.js` ×2, `**/*.js`, `**/*.html`); Supreme does not
upload images today and the other targets were left untouched. The guard now fails
if any admin CSP block drops the origin, because this is a silent client-side
failure that no server test can see.

**The rule was the hidden half of the cutover.** `config/` only had a `tunnelUrl`
entry, so `config/mediaUrl` was default-deny for clients; `mediaBase()` swallows
its read error and falls back, and the cutover would have looked deployed while
every upload still went to the down box. `database.rules.json` now grants

```
config/mediaUrl .read: auth != null && auth.token.firebase.sign_in_provider != 'anonymous'
```

— the exact `config/tunnelUrl` rule. Live matrix with real tokens:
non-anonymous **200**, anonymous **401**, no token **401**. The guard now asserts
the rule exists *and* keeps the non-anonymous condition, so this cannot silently
regress.

## 4. What is deployed

```
tenantMedia   us-central1   512MiB   60s   concurrency 10   maxInstances 10
  https://us-central1-foodhubbie-10.cloudfunctions.net/tenantMedia
  routes: GET /health · POST /tenant-api/upload · POST /tenant-api/delete-image
  secrets: [FIREBASE_DATABASE_URL]
```

`firebase deploy --only functions:tenantMedia` → **Successful create operation**;
`firebase functions:list` shows it alongside the existing 14. The deploy log's
`Can't determine Firebase Database URL` lines are the same preflight noise as
23a/23c (the URL is bound at runtime through `secrets`).

Deployed: `database` (the new rule) and `hosting:admin`
(`mediaBase()` + `CACHE_NAME` `v5.12.48` + the CSP origin; any Admin-served file
change needs the bump). Live version stamps:
`167db46.20261113T024105Z`, then `102edbb.20261113T024417Z` with the CSP fix.

`/health` is unauthenticated on purpose: no DB read, no bucket call, just
`{ok, service, bucket}` so a probe can tell "function gone" from "auth broken".

## 5. Live verification

### The endpoint itself — 18/18

`%TEMP%/opencode/e2e-23d1-media.cjs` against the deployed URL, with a throwaway
Firebase Auth user + `admins` row on the e2e tenant, deleted afterwards:

| # | scenario | result |
|---|---|---|
| 1 | `GET /health` without auth | 200 `{ok:true,bucket:foodhubbie-10.firebasestorage.app}` |
| 1 | no token / junk token | 401 `Missing bearer token` / `Invalid or expired token` |
| 1 | unknown route, `GET` on upload | 404 / 405 |
| 2 | admin with no `outlet` | 403 `Admin not linked to any outlet` |
| 2 | outlet missing under the business | 403 `Outlet not found for this business` |
| 3 | upload a 1×1 PNG as `dish` | 200, `path` under the caller's own `outlets/{bid}/{oid}/dishes/{id}/original.png`, `bytes` exact |
| 3 | fetch the returned URL | 200, sha256 identical, `content-type: image/png` |
| 3 | second upload as `category` | its own object |
| 4 | missing `type`/`id`, non-image data URI, `image/tiff` | 400 with the control API's strings |
| 4 | ~6.3 MB image (≈8.4 MB base64 body) | 413 before the image cap |
| 5 | delete another outlet's object | 403 `Not an image of this outlet` |
| 5 | non-Storage url | 400 `url is required` |
| 5 | delete own object | 200, the URL then 403/404 |
| 5 | delete it again | 200 (`ignoreNotFound`) |
| 6 | preflight | dashboard origin allowed, foreign origin no ACAO |

All fixtures removed: Auth user count back to 184, no `admins/e2e-media-*` row, no
objects under the e2e prefix.

### The real client path — 8/8

`%TEMP%/opencode/e2e-23d1-client.cjs` on the **built** dashboard served locally
(`tools/serve-dist.cjs admin`, zero Hosting egress) with the live demo sign-in, then
the app's own exported `uploadImage` / `deleteImage`:

* signed in as `demo@foodhubbie.in` (a real non-anonymous ID token; `outlet:demo`,
  `businessId:foodhubbie-demo`);
* `window.MEDIA_URL` resolved to the Functions host — i.e. the
  `config/mediaUrl` read succeeded through the new rule;
* upload → a Storage URL under `outlets/foodhubbie-demo/demo/dishes/…`, bytes
  fetched back identical;
* `deleteImage` removed it and the URL stopped serving;
* the browser's POSTs went to `…cloudfunctions.net`, **none** to
  `api.foodhubbie.in`;
* 0 console errors, 0 objects left behind.

Object bytes are read from Node rather than the browser on purpose: a browser
`fetch()` of a Storage download URL needs the **bucket's** CORS allowlist (which
lists `http://localhost:5000/8080`, not this test port). `<img>` and the product's
own uploads do not use that fetch; the control API never did either.

## 6. Guards

* `tests/functions-source.check.cjs` — **64/64**. Adds: `index.ts` exports
  `tenantMedia`; both routes exist; the admin row comes from the *verified* uid;
  no `body.bid/businessId/outlet`; the no-outlet 403; the delete prefix check; the
  8 MB/6 MB caps; the bucket default; `resumable:false` + download token; the four
  CORS origins + the wired allowlist; the storage rules still deny all client
  access; `Admin/js/firebase.js` reads `config/mediaUrl` and both image functions
  use `mediaBase()`; **`database.rules.json` grants the non-anonymous read**; and
  **every admin CSP block allows the Functions origin**.
* The rest of the battery re-run clean (see §7).

## 7. Honest limits

* **The box is still the host for everything else.** Notifications, WhatsApp
  numbers/quota/templates, onboarding approve/status, password update, the image
  *convert* endpoint, `wallet-watch`, the cleanup cron, the demo reseed and the
  bot itself are all still EC2. This batch moves images only.
* **One function, three routes.** Splitting further buys nothing at this size;
  `/health` rides along.
* **The legacy full-tree scan survived.** Non-super admins created before
  `businessId` was stamped still trigger `businesses` `.get()` on their first
  upload after a cold start. It is keyed on the admin row, not on every request,
  and the same branch exists in the control API — removing it needs an admin-data
  sweep, not a code change here.
* **No rate limiting.** Neither host had any; an authenticated admin can upload in
  a loop. Bounded by 6 MB per object and Storage pricing, not by code.
* **`api.foodhubbie.in` must keep its DNS** even after every route moves, because
  clients that cached an older shell still call it for non-media routes. Do not
  retire the hostname until the SW fleet has rolled over.
* **CORS list is per-deployment.** A new dashboard origin needs this function
  redeployed (the control API had the same property).
* **`analysis` of the object is not set beyond content type + cache-control**; the
  control API didn't either, so no change in searchability or headers.

## 8. Files

New: `FIREBASE_SERVER_MIGRATION/functions/src/api/tenantMedia.ts`.

Changed: `FIREBASE_SERVER_MIGRATION/functions/src/index.ts` (export),
`Admin/js/firebase.js` (`mediaBase()` + both image calls), `Admin/sw.js`
(`v5.12.48`), `database.rules.json` (`config/mediaUrl` read),
`firebase.json` (admin CSP `connect-src`), `tests/functions-source.check.cjs`.

Rollback: `firebase functions:delete tenantMedia` **and** remove
`config/mediaUrl` — the client then falls back to `config/tunnelUrl`, exactly the
pre-batch behaviour. The rule can stay; an unread key costs nothing. Nothing was
written to RTDB by this batch except `config/mediaUrl`.
