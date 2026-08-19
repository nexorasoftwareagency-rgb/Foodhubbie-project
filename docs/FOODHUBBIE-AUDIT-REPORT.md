# Food-Hubbie Platform — Full End-to-End Audit Report
> Repository: `nexorasoftwareagency-rgb/Foodhubbie-project`
> Audit date: August 2026 | Auditor: Claude (Anthropic)
> Scope: `database.rules.json`, `bot/`, `webhook-server/`, `bot-control-api/`, `SupremeAdmin/`, `Admin/`, `menu/`, `functions/`, `shared/`, `tools/`
> Not deeply re-audited this pass: `rider-app/` (140 files — audited separately, no recent changes detected), `functions/` deployment status (open question, unresolved)

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Critical Findings](#3-critical-findings)
4. [High / Moderate Findings](#4-high--moderate-findings)
5. [Low / Informational Findings](#5-low--informational-findings)
6. [What's Working Well](#6-whats-working-well)
7. [Not Covered This Pass](#7-not-covered-this-pass)
8. [Recommended Priority Order](#8-recommended-priority-order)
9. [Appendix: File-by-File Reference](#9-appendix-file-by-file-reference)

---

## 1. Executive Summary

The codebase is in genuinely strong shape overall — several architectural decisions (the dual WhatsApp transport shim, the centralized `outlet-resolution.js` path resolver, the Bot Control API's real-time PM2 status watcher) are more sophisticated and lower-risk than what was originally proposed for this project. Security discipline (XSS escaping, auth-gated API routes, atomic Firebase writes) is consistently applied across old and newly-added files alike.

However, **one critical infrastructure gap** and **two critical security findings** need attention before this platform can safely onboard a third restaurant:

- **No orchestrator exists** — Supreme Admin can create a restaurant record and link a WhatsApp number, but nothing automatically starts that restaurant's bot process on the server. The core promise of the Supreme Admin dashboard (add a restaurant, it goes live) is not yet functional end-to-end.
- **`database.rules.json` contains dead-but-exploitable root nodes** — any authenticated restaurant admin, from any restaurant, can currently write to shared catalog paths (`dishes`, `categories`, `sizes`, `addons`) with no outlet-matching check, because these root paths are leftover from before the multi-tenant refactor and were never removed.
- **Several hardcoded two-outlet assumptions remain**, bypassing the otherwise well-designed central resolver — including one that would cause a **port collision and prevent the bot from starting** for any third or fourth restaurant, and two that could send **a competitor's brand name or physical address** to a new restaurant's customers.

None of these are difficult fixes. All are precisely scoped below with exact file locations and line numbers.

---

## 2. Methodology

Each file was read in full (not just grepped) for the highest-risk areas: `database.rules.json`, the Bot Control API's auth middleware, the webhook server's message routing, and every file touching outlet/business identity resolution. Lower-risk files (UI feature modules, CSS) were spot-checked for the specific defect classes already found elsewhere in the codebase (XSS escaping consistency, atomic vs. non-atomic writes, listener cleanup). Findings were cross-verified against actual usage via `grep` before being classified as live bugs vs. dead code — several initial hits (e.g., flat `orders` paths in `Admin/js`) turned out to be false alarms once traced through a central path-resolution helper.

---

## 3. Critical Findings

### 3.1 — No orchestrator service exists
**Severity: Critical — breaks the core Supreme Admin promise**
**Location:** Repository-wide search for `orchestrator` returns zero results.

**What's missing:** A permanently-running process that watches `businesses/{bid}/outlets/{oid}` in Firebase and automatically starts/stops the corresponding PM2 bot worker when a restaurant is onboarded, suspended, or its WhatsApp connection status changes.

**Impact:** Right now, when Supreme Admin's onboarding flow completes — restaurant created, WhatsApp number linked via Embedded Signup, `whatsapp.status` set to `active` in Firebase — **nothing actually starts the bot process**. A human still has to manually SSH in and run `pm2 start` for every new restaurant. This defeats the stated purpose of the Supreme Admin dashboard.

**Fix required:** Build the orchestrator as originally scoped — a Firebase `child_added`/`child_changed` listener on `businesses/` that calls PM2's programmatic API to start/stop workers, and writes the `phoneNumberIndex/{phoneNumberId}` routing entry the webhook server already depends on.

---

### 3.2 — `database.rules.json`: dead root-level nodes remain writable by any admin, cross-tenant
**Severity: Critical — real security hole, currently unexploited only because the app doesn't route traffic here**
**Location:** `database.rules.json`, lines 77–96

```json
"orders": {
  ".read": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true)",
  ".write": "auth != null && (root.child('admins').child(auth.uid).child('isSuper').val() == true || root.child('admins').child(auth.uid).child('isSupreme').val() == true)",
  ".indexOn": ["outlet", "status", "createdAt"]
},
"sizes":      { ".read": "true", ".write": "auth != null && (root.child('admins').child(auth.uid).exists())" },
"addons":     { ".read": "true", ".write": "auth != null && (root.child('admins').child(auth.uid).exists())" },
"categories": { ".read": "true", ".write": "auth != null && (root.child('admins').child(auth.uid).exists())" },
"dishes":     { ".read": "true", ".write": "auth != null && (root.child('admins').child(auth.uid).exists())" },
```

**The problem:** `sizes`, `addons`, `categories`, and `dishes` at the database root allow write access to **any** authenticated admin — no check that the admin's `outlet` field matches anything. This is different from the correctly-scoped nested versions of these exact same node names that exist under `businesses/{bid}/outlets/{oid}/dishes` etc. (lines 123–141), which **do** check `root.child('admins').child(auth.uid).child('outlet').val() == $outletId`.

**Verified via code trace:** `Admin/js/firebase.js`'s `Outlet.ref()` helper (lines 85–98) automatically redirects any non-global path to the tenant-scoped location, so the live application never actually reads or writes these root paths. **This makes it dead code from the app's perspective — but Firebase rules don't care what the app intends.** Any restaurant admin (from any restaurant on the platform) could open browser devtools on their own Admin dashboard — which already has a valid Firebase Auth session — and directly call:
```js
firebase.database().ref('dishes').set({ malicious: 'data' })
```
This would succeed under the current rules, writing to a shared root node that (if ever read by anything, now or in the future) could corrupt or leak data across restaurant boundaries.

**Fix required:** Delete lines 77–96 entirely. Nothing legitimate references these paths; they are pre-refactor leftovers that were never cleaned up when the nested per-outlet structure was built.

---

## 4. High / Moderate Findings

### 4.1 — Hardcoded pizza/cake ternaries bypass the central outlet resolver
**Severity: High — will break onboarding for restaurant #3+**

The codebase has a well-designed central resolver at `bot/helpers/outlet-resolution.js`, explicitly documented as *"THE pivot point for the multi-tenant refactor."* Several places bypass it entirely with direct string comparisons against exactly `'pizza'` or `'cake'`:

| Location | Code | Concrete impact at restaurant #3 |
|---|---|---|
| `bot/index.js:111` | `HEALTH_PORT = OUTLET === 'pizza' ? 3001 : 3002` | **Bot process fails to bind** — any outlet that isn't literally named `'pizza'` gets port 3002, colliding with whichever other non-pizza outlet already claimed it |
| `bot/index.js:632` | `storeName = ... : "Roshani Cake"` | If a new restaurant's `storeSettings.storeName` is ever unset, their customers see **"Roshani Cake"** — a competitor's brand — in the bot's greeting text |
| `bot/index.js:1979-1980` | `lat: ... (user.outlet === 'cake' ? 25.887472 : 25.887944)` | A new restaurant with missing delivery coordinates gets **Roshani's real physical address** as their delivery fee calculation origin — riders could be sent to the wrong location entirely |
| `Admin/js/features/orders.js:1069-1070` | Same coordinate fallback, duplicated | Same impact, from the Admin dashboard's order-creation path |
| `bot/index.js:11` | `OUTLET_NAME = OUTLET === 'pizza' ? 'Our Restaurant' : 'Our Restaurant'` | Both ternary branches are now identical — looks like a partial de-branding pass broke this. Every outlet currently displays the same generic placeholder name regardless of its real one. |
| `bot/reports.js:42,100,153` | `${OUTLET === 'pizza' ? '🍕' : '🎂'}` | Cosmetic only — wrong emoji/label in internal sales report headers for outlet #3+ |
| `Admin/js/features/notifications.js:28,187` | `order.outlet === 'cake' ? '🎂' : '🍕'` | Cosmetic — wrong icon on order notifications for outlet #3+ |
| `Admin/js/branding.js:111` | `state.currentOutlet === 'cake' ? 'pizza' : 'cake'` | An outlet-switcher toggle that assumes exactly two outlets exist — breaks the intended toggle behavior once a third outlet is added |

**Fix required:** Route all of these through `resolveBusinessIdFor()` / real Firebase-stored `storeSettings` data instead of literal string ternaries. The `HEALTH_PORT` and coordinate-fallback cases are functionally breaking, not cosmetic, and should be prioritized.

---

### 4.2 — Duplicate `BUSINESS_BY_OUTLET` map, currently safe but a real drift risk
**Severity: Moderate**
**Location:** `bot/helpers/outlet-resolution.js:19` and `menu/js/firebase.js:59`

Both files independently define:
```js
const BUSINESS_BY_OUTLET = { pizza: 'roshani-pizza', cake: 'roshani-cake' };
```

**Currently safe in practice:** the bot's generated delivery webview link explicitly passes `?b={businessId}&o={outletId}` (`bot/index.js:422`), and `menu/js/firebase.js` correctly prioritizes that query param over its local map. So as long as every customer arrives via a bot-generated link, both copies of the map stay irrelevant to the actual data path.

**The risk:** if any future code path generates a menu link without the `?b=` parameter (a shortened URL, a QR code generated by a different tool, manual testing), the two independent maps could silently diverge once a third restaurant is added and only one file gets updated — causing orders to write to one business ID while the bot reads from another.

**Fix required:** Have `menu/js/firebase.js` import the single source of truth from `bot/helpers/outlet-resolution.js`'s logic (or an equivalent shared module) rather than maintaining its own copy. This is the same "same fix needed in N places" class of issue previously flagged for `shared/geo/geo.js`'s triple-duplication.

---

### 4.3 — Webhook server: no signature verification on incoming POST requests
**Severity: Moderate**
**Location:** `webhook-server/index.js`, `app.post('/webhook', ...)` (line 55)

Meta's Cloud API webhook system supports HMAC signature verification via the `X-Hub-Signature-256` header, computed using the app's `APP_SECRET`. This implementation verifies the initial `GET` handshake (`hub.verify_token`) but does **not** verify the signature on subsequent `POST` message payloads.

**Impact:** anyone who discovers this webhook's public URL (the Cloudflare Tunnel address) could POST a fabricated payload shaped like a real Meta webhook event, injecting fake "customer messages" into any restaurant's bot pipeline — potentially confusing session state for a real customer's phone number, or triggering unwanted bot responses.

**Fix required:** Verify `X-Hub-Signature-256` against `META_APP_SECRET` on every incoming POST before processing, rejecting any request where the computed HMAC doesn't match.

---

### 4.4 — Redis connection churn — same bug pattern, second occurrence
**Severity: Moderate — performance, not correctness**
**Location:** `webhook-server/index.js`, lines 76–82

```js
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
await redis.publish(`bot-inbox:${routing.businessId}:${routing.outletId}`, JSON.stringify(message));
await redis.quit();
```

A brand-new Redis client is created, connected, and torn down for **every single incoming WhatsApp message**. This is the identical inefficient pattern that was already identified and fixed once in `bot-control-api/pm2-client.js` (which now correctly maintains one shared connection). At low message volume this is invisible; at real order volume across many restaurants it becomes unnecessary connection overhead and a potential rate-limiting concern on the Redis side.

**Fix required:** Instantiate one Redis client at server startup, reuse it across all incoming messages, matching the pattern already established in `pm2-client.js`.

---

## 5. Low / Informational Findings

| # | Finding | Location | Notes |
|---|---|---|---|
| 5.1 | `functions/` still present, still named `roshani-erp-functions` | `functions/package.json` | Deployment status genuinely unresolved — an open question from earlier in this audit process (`firebase functions:list` was never run to confirm). If deployed, requires Blaze plan; docs elsewhere in the project claim Spark-only, which would be inconsistent. |
| 5.2 | `getPhoneNumberId()`'s fallback path is an O(n) linear scan | `bot/transport.js:19-31` | Only triggers when the direct Firebase-stored value is missing; fine at current scale, would need indexing at hundreds of restaurants |
| 5.3 | Buffer-based image sends silently degrade to text-only on Meta transport | `bot/transport.js:66-69` | Verified no current code path actually sends Buffer images — noted for awareness if that changes |
| 5.4 | `whatsapp-graph.js`'s `createTemplate()` sample-value dictionary is hand-maintained | `bot-control-api/whatsapp-graph.js:129-137` | Minor — any new template variable label not in the dictionary falls back to using the label itself as the sample, which is a reasonable default, not a bug |

---

## 6. What's Working Well

These are worth documenting explicitly, since a security audit that only lists problems gives an inaccurate picture of overall code health:

- **`bot/transport.js`'s dual-transport shim** — `createMetaTransport()` returns an object shaped exactly like a real Baileys `sock` (`sendMessage`, `ev.on`, `user`, `ws`, `readMessages`, `sendPresenceUpdate`), meaning the entire 2066-line state machine in `bot/index.js` never needed to change during the WhatsApp Cloud API migration. Transport is toggled per-outlet via `bot/{outlet}/transport` in Firebase — reversible, low-risk, no big-bang cutover required. This is a more sophisticated migration strategy than a straightforward "remove the old library" approach.
- **`bot/helpers/outlet-resolution.js`** is well-documented, correctly designed, and explicitly calls out which nodes are intentionally platform-global (`admins`, `riders`, `logs`, `migrationStatus`, `settlements`) vs. tenant-scoped — the *design* is sound even though adoption of it isn't yet complete everywhere (see 4.1).
- **`Admin/js/firebase.js`'s `Outlet.ref()`** centralizes tenant-path resolution behind one function, which is why the apparent "flat orders path" finding turned out to be a false alarm on closer inspection — good defensive architecture.
- **`bot-control-api/whatsapp-graph.js`** fully implements Embedded Signup, number verification, and template management server-side — previously a `501` stub, now a complete, consistently-error-handled Graph API wrapper.
- **`webhook-server`'s `/api` proxy to the Bot Control API** is a clean solution to Cloudflare Quick Tunnel only exposing a single local port.
- **XSS escaping discipline held consistently** across every file checked in this pass, including the newest additions (`whatsapp-manage.js`, `profile-analytics.js`) — every instance of Meta-sourced or Firebase-sourced dynamic data is wrapped in `escapeHtml()` before `innerHTML` interpolation.
- **Every fix from the earlier standalone Supreme Admin zip review carried forward correctly** into the live repository: the Lucide icon version pin, the onboarding flow's atomic multi-path Firebase write (replacing a two-step write with no rollback), the Facebook SDK loading race-condition fix, and the CSV formula-injection guard are all present and unmodified.
- **`bot-control-api/status-watcher.js`'s real-time architecture** — Firebase-backed live status via PM2's event bus, with a correct fix for the ambiguity of parsing dashes out of `bot-{bid}-{oid}` process names (Firebase push IDs can themselves contain dashes, making naive string-splitting unreliable — this was caught and solved via index lookup instead).

---

## 7. Not Covered This Pass

- **`rider-app/`** (140 files) — was audited thoroughly earlier in this engagement with good results (atomic `acceptOrder()` transaction correctly preventing double-assignment races, proper error boundaries). No commits touching this folder appeared in recent git history, so it was not re-read line-by-line in this pass.
- **`functions/` deployment status** — genuinely unresolved. Recommend running `firebase functions:list --project <project-id>` to settle whether this is live infrastructure or dead code, since the answer changes both the Firebase billing plan implications and whether `functions/index.js` needs security review at the same depth as everything else in this report.
- **Load/performance testing** — this audit is a static code review; no runtime load testing was performed against the webhook server, Bot Control API, or orchestrator (once built).

---

## 8. Recommended Priority Order

```
1. database.rules.json — delete the dead root-level orders/sizes/addons/categories/dishes
   nodes (3-line-per-node deletion, immediate security improvement, zero app impact
   since nothing reads these paths)

2. bot/index.js HEALTH_PORT ternary — fix before onboarding restaurant #3, or the
   bot process will fail to start due to a port collision

3. bot/index.js + orders.js delivery coordinate fallbacks — fix before onboarding
   any restaurant whose storeSettings.lat/lng might ever be unset

4. bot/index.js storeName fallback — fix before onboarding restaurant #3, to avoid
   a new restaurant's customers seeing "Roshani Cake" in their greeting

5. Build the orchestrator — this is the largest single piece of work, but is the
   one blocking issue preventing Supreme Admin's onboarding flow from being
   genuinely end-to-end functional

6. webhook-server signature verification — moderate priority, real but
   lower-likelihood exploit path

7. webhook-server Redis connection reuse — moderate priority, performance only

8. menu/js duplicate BUSINESS_BY_OUTLET map — low urgency given current
   ?b= param protection, but worth consolidating before it's forgotten

9. Resolve the functions/ deployment question — informational, unblocks an
   accurate understanding of current Firebase billing plan status
```

---

## 9. Appendix: File-by-File Reference

| File | Lines | Findings |
|---|---|---|
| `database.rules.json` | 352 | 3.2 (critical) |
| `bot/index.js` | 2066 | 4.1 (multiple instances) |
| `bot/reports.js` | 176 | 4.1 (cosmetic instances) |
| `bot/transport.js` | 147 | 5.3 (informational); positive finding in §6 |
| `bot/helpers/outlet-resolution.js` | 94 | Positive finding in §6; root cause context for 4.1 |
| `Admin/js/features/orders.js` | — | 4.1 (coordinate fallback duplicate) |
| `Admin/js/features/notifications.js` | — | 4.1 (cosmetic) |
| `Admin/js/branding.js` | — | 4.1 (outlet-switcher assumption) |
| `Admin/js/firebase.js` | — | Positive finding in §6 (`Outlet.ref()` centralization) |
| `menu/js/firebase.js` | — | 4.2 |
| `webhook-server/index.js` | 93 | 4.3, 4.4; positive finding in §6 (proxy design) |
| `bot-control-api/server.js` | 702 | Routes verified against 3.1/4.3 context |
| `bot-control-api/whatsapp-graph.js` | 164 | Positive finding in §6 |
| `bot-control-api/pm2-client.js` | — | Positive finding in §6 (reference pattern for 4.4's fix) |
| `bot-control-api/status-watcher.js` | — | Positive finding in §6 |
| `SupremeAdmin/js/features/whatsapp-manage.js` | 327 | Spot-checked, clean |
| `SupremeAdmin/js/features/profile-analytics.js` | 514 | Spot-checked, clean |
| `functions/` | — | 5.1 |
| Orchestrator | N/A | 3.1 — does not exist |

---

*This report reflects a point-in-time audit. Re-run the priority-order fixes above and re-verify with a follow-up pass before onboarding restaurant #3 in production.*
