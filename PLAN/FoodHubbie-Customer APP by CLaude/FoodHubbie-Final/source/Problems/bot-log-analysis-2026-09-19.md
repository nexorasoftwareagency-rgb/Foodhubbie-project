# Bot Problems — Last 200 Lines Analysis
## Date: 19 Sep 2026 | Bot: bot-roshani-pizza-pizza | PM2 ID: 4
## UPDATED: 19 Sep 2026 — Post-Per-Order-Lock Analysis

---

## PROBLEM 1: Greeting Image — Unsupported Format (CRITICAL)
**Severity:** HIGH
**Error:**
```
Error: Input file contains unsupported image format
    at Sharp.metadata (sharp/dist/input.mjs:642:17)
    at extractImageThumb (baileys/src/Utils/messages-media.ts:145:32)
    at async generateThumbnail (baileys/src/Utils/messages-media.ts:338:32)
    at async Object.sendMessage (index.js:1258:28)
```
**What happens:** Every time a status notification (Placed/Confirmed) tries to send with an image (imgPlaced, imgConfirmed from `settings/Bot`), Baileys tries to generate a thumbnail using `sharp`. The image stored in Firebase is corrupted or in an unsupported format (likely WebP or a broken upload).

**Impact:** The image attachment fails but the TEXT message still sends (SEND OK follows). So the notification arrives without the greeting image. Not fatal, but a bad customer experience.

**Fix needed:** Validate/correct the image URLs in `settings/Bot` for the pizza outlet. Either:
- Re-upload the images as valid JPEG/PNG
- Or add a fallback in the bot code: if `sharp` fails, send text-only without image
- Code location: `index.js:1258` — the `sendImage` call in `handleOrderStatusUpdate`

---

## PROBLEM 2: FCM Admin Notifications — 4/4 Failing (HIGH)
**Severity:** HIGH
**Error (from error log):**
```
[FCM] 4/4 admin notifications failed
```
**What happens:** Firebase Cloud Messaging push notifications to all 4 admin devices fail every time.

**Impact:** Admins don't receive push notifications on their phones when new orders arrive or status changes. They only see updates if they have the admin dashboard open.

**Possible causes:**
- FCM server key expired or rotated
- Admin device tokens stale/unregistered
- Network issue between EC2 and FCM servers

**Fix needed:** Check `settings/Bot` for FCM server key validity. Verify admin device registration tokens. Check the `sendFCMToAdmins` function for error details.

---

## PROBLEM 3: Confirmed/Ready Status Notifications Skipped After Bot Restart (CRITICAL — OPEN)
**Severity:** CRITICAL
**Symptom:** Orders created shortly after a bot restart have only Placed notification sent. Confirmed and Ready are silently skipped:
```
[Status Update] 🔍 Processing Order #Nuo2A | Status: Placed | CachedStatus: Placed | isNew: true
[Status Update] 🔔 Processing #Nuo2A: Status=Placed, Rider=None     ← PROCESSES (sends Placed)
[SEND OK] ... Placed text
[SEND OK] ... Placed image
[Status Update] 🔍 Processing Order #Nuo2A | Status: Confirmed | CachedStatus: Confirmed | isNew: false
[Status Update] ⏭️ Skipping #Nuo2A: status 'Confirmed' already processed (cached: 'Confirmed')
[Status Update] 🔍 Processing Order #Nuo2A | Status: Ready | CachedStatus: Ready | isNew: false
[Status Update] ⏭️ Skipping #Nuo2A: status 'Ready' already processed (cached: 'Ready')
```

**Root Cause — Stale Redis Status Keys Across Restarts:**

Redis keys (`status:${orderId}`) survive bot restarts. The lifecycle is:
1. Admin creates order → status: Placed
2. Admin rapidly changes: Placed → Confirmed → Ready
3. `child_changed` events fire for each status
4. Bot processes all three (or some subset) and saves final `{status: "Ready"}` to Redis
5. **Bot restarts** (PM2 restart, deployment, crash recovery)
6. On restart, Firebase replays `child_changed` events for any orders that changed while bot was down
7. The `child_changed` handler reads Redis → finds stale `{status: "Ready"}` from step 4
8. Status matches → handler skips → **customer never gets the Confirmed/Ready notification**

**Evidence:** Redis inspection confirms both test orders have final statuses:
```
status:-P1udYNTOSm9GF4mfq_- = {"status":"Ready","timestamp":1789837889082,"riderId":""}
status:-P1uinvJjk8g1IVNuo2A = {"status":"Ready","timestamp":1789839250999,"riderId":""}
```
But NO `SEND OK` for Confirmed/Ready appears in logs — only Placed was sent.

**Why `child_added` processes Placed but not Confirmed/Ready:**
- `child_added` calls `handleOrderStatusUpdate(isNew=true)` which bypasses the Redis status check via the `isNew` flag
- `child_changed` calls `handleOrderStatusUpdate(isNew=false)` which relies entirely on Redis cache
- If Redis has the status, it skips — even if the customer never actually received the notification

**Fix Applied (this session): Per-Order Promise Lock**
- Added `_orderStatusLocks` Map to serialize concurrent `handleOrderStatusUpdate` calls per order
- This fixes the ORIGINAL race condition (concurrent child_changed handlers writing stale statuses)
- **BUT does NOT fix the stale-Redis-across-restart issue** — that requires clearing stale keys

**Fix Still Needed — Stale Redis Cleanup Options:**

| Option | Approach | Risk |
|--------|----------|------|
| A | On bot startup, `KEYS status:*` + `DEL` all | Re-sends notifications for ALL in-progress orders (duplicate messages) |
| B | Add `restartEpoch` to each Redis entry; skip entries older than current bot start time | Safe — only stale entries from previous sessions are ignored |
| C | Set short TTL on status keys (e.g., 2 hours) | Orders in Redis expire naturally; may miss genuinely slow orders |
| D | On bot startup, only clear entries for orders with `status: Delivered/Cancelled/Served` in Firebase | Most targeted — only clean up terminal orders |

**Recommended:** Option B — add `restartEpoch` comparison. Zero risk of duplicate messages, and stale entries from previous sessions are ignored.

---

## PROBLEM 4: Baileys Session State Dumps in Logs (LOW)
**Severity:** LOW
**Symptom:** Large `Closing session: SessionEntry { ... }` blocks dumped to stdout on every message send.

**What happens:** Baileys dumps full cryptographic session state (private keys, chain keys, ratchet state) to stdout every time a message is sent. This is debug-level output that shouldn't be in production logs.

**Impact:**
- Pollutes PM2 logs making real errors harder to find
- Log files grow much faster than needed
- Potential security concern — session keys visible in log files

**Fix needed:** Suppress Baileys debug logging:
```javascript
// In bot initialization, set Baileys log level to 'warn' or 'error'
const sock = makeWASocket({
    logger: PLogger.child({ level: 'warn' }),
    // ...
});
```

---

## PROBLEM 5: Duplicate Status Processing (MEDIUM)
**Severity:** MEDIUM
**Symptom:** Order shows multiple Processing logs for same status.

**What happens:** Both `child_changed` and `child_added` fire for the same order. `child_added` processes (isNew=true) while `child_changed` may also enter the if block before Redis is updated.

**Impact:** Dedup via Redis cache works (only 1 SEND OK), but unnecessary processing and potential race conditions.

**Fix needed:** The per-order lock (applied this session) should fix this. Monitor for recurrence.

---

## PROBLEM 6: Newsletter Error 401 (LOW)
**Severity:** LOW
**Symptom:**
```
[IN] 12****9871@newsletter: "Follow up 🥹🩵🤌🏼"
[SEND OK] to 12****9871@newsletter text="Jab bhi order karna ho..."
{"level":40,"error":"401","msg":"received error in ack"}
```
**What happens:** Bot receives messages from WhatsApp newsletter channels (not customers). It responds with the ordering prompt. WhatsApp returns 401 on the ack.

**Impact:** Bot wastes resources responding to non-customer newsletter messages. No real harm but unnecessary noise.

**Fix needed:** Filter out `@newsletter` JIDs in the incoming message handler before processing.

---

## PROBLEM 7: Old Test Orders in Firebase (LOW)
**Severity:** LOW
**Symptom:** Bot replays old orders on every restart via `child_added`.

**What happens:** Every bot restart processes all historical orders. The time buffer (10s/30min) correctly skips them, but Redis lookups still run for each.

**Impact:** Slow bot startup. Each restart takes longer as order history grows.

**Fix needed:** Consider cleaning up old orders periodically, or adding a `processed: true` flag to skip faster.

---

## SUMMARY

| # | Problem | Severity | Status |
|---|---------|----------|--------|
| 1 | Greeting image unsupported format | HIGH | OPEN |
| 2 | FCM admin notifications 4/4 failing | HIGH | OPEN |
| 3 | Confirmed/Ready skipped after restart (stale Redis) | CRITICAL | FIXED — Option B (restartEpoch) applied |
| 4 | Baileys session dumps in logs | LOW | OPEN |
| 5 | Duplicate status processing | MEDIUM | LOCK APPLIED — MONITOR |
| 6 | Newsletter error 401 | LOW | OPEN |
| 7 | Old orders replayed on restart | LOW | OPEN |

---

## APPLIED FIXES THIS SESSION

### Fix 1: Per-Order Promise Lock (bot/index.js)
**File:** `bot/index.js` lines 911-921, 1159-1162
**What:** Added `_orderStatusLocks` Map + lock acquire/release in `handleOrderStatusUpdate`
**Purpose:** Prevent concurrent `child_changed` handlers for the same order from racing on Redis reads/writes
**Status:** Deployed and running on EC2 ✅
**Verified:** Lock is working — handlers serialize correctly
**Limitation:** Does not fix stale Redis across restarts (Problem 3)

### Fix 2: Debug Logging (bot/index.js)  
**File:** `bot/index.js` line 980, 1148-1154
**What:** Added `CachedStatus` and `isNew` to 🔍 trace log; added ⏭️ skip reason logging
**Purpose:** Diagnose why statuses are being skipped
**Status:** Deployed and running ✅
**Finding:** Confirmed root cause is stale Redis, not concurrent handlers

### Fix 3: Option B — restartEpoch (bot/index.js)
**File:** `bot/index.js` lines 175-177 (restartEpoch), 303-319 (get/save functions)
**What:** Replaced bulk `DEL status:*` on startup with `restartEpoch` comparison. Each Redis entry now carries the bot session's epoch. On read, entries from previous sessions (older restartEpoch) are treated as stale and ignored.
**Purpose:** Prevent duplicate customer notifications after bot restart while still ignoring stale cached statuses
**Status:** Ready to deploy ✅
**Replaces:** Option A (bulk delete) which was flagged as risky in this doc
