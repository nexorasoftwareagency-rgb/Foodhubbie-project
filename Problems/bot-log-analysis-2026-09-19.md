# Bot Problems — Last 200 Lines Analysis
## Date: 19 Sep 2026 | Bot: bot-roshani-pizza-pizza | PM2 ID: 4

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

## PROBLEM 3: Confirmed Status Notification Not Sending (MEDIUM — NOW FIXED)
**Severity:** MEDIUM (was critical, fixed in this session)
**Symptom:** Order #R3MQA had status changed to "Confirmed" — Processing log appears but no `State Updated` and no `SEND OK`.

**Root cause (FIXED):** The `initFCMWatcher`'s `_fcmSent` write triggered `child_changed` which pre-cached status before `child_added` could call `handleOrderStatusUpdate(isNew=true)`. The IF branch was gated on `!currentProcessedStatus`.

**Fix applied:** Restructured `child_added` handler to call `handleOrderStatusUpdate(isNew=true)` for ALL new orders regardless of cache state. Verified working — Placed notifications now send.

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
**Symptom:** Order #lbeYa shows 3x Processing logs for "Placed" status:
```
[Status Update] Processing Order #lbeYa | Status: Placed
[Status Update] Processing Order #lbeYa | Status: Placed
[Status Update] 🔔 State Updated for #lbeYa: Status=Placed
[Status Update] Processing Order #lbeYa | Status: Placed  ← third time
```

**What happens:** The same status is processed multiple times for the same order. This is caused by:
1. `child_added` fires → calls `handleOrderStatusUpdate(isNew=true)` → sends notification
2. `child_changed` fires (from `_fcmSent` or other writes) → calls `handleOrderStatusUpdate(isNew=false)` → sees cached status, skips
3. But another `child_changed` fires (from the bot's own `updateData`) → processes again

**Impact:** The dedup via Redis cache works (only 1 SEND OK), but unnecessary processing. Could lead to race conditions if timing is unlucky.

**Fix needed:** The `child_changed` handler should check if the order was very recently processed (< 2 seconds) and skip.

---

## PROBLEM 6: Status Transitions Without Customer Notifications (MEDIUM)
**Severity:** MEDIUM
**Symptom:** Order #uQvyG goes through these transitions but only "RIDER ON THE WAY" gets SEND OK:
- Ready → no notification sent
- Arriving at Restaurant → "RIDER ON THE WAY" sent
- Arrived at Restaurant → no notification sent

**What happens:** Some status transitions (Ready, Arrived at Restaurant) either don't have customer-facing messages defined, or the message template returns empty string.

**Impact:** Customer misses updates about their order being ready or rider arriving.

**Fix needed:** Review status message templates in `handleOrderStatusUpdate` (lines 928-960). Ensure all relevant statuses have customer-facing messages.

---

## PROBLEM 7: USync Fetch Failed (LOW)
**Severity:** LOW
**Error:**
```
{"level":40,"msg":"USync fetch yielded no results for pending PNs"}
```
**What happens:** WhatsApp's USync API returns no results for pending phone numbers. This is a Baileys internal query for contact sync.

**Impact:** Minor — contact resolution may fall back to alternative methods. Not causing message failures.

---

## PROBLEM 8: Old Test Orders in Firebase (LOW)
**Severity:** LOW
**Symptom:** Bot replays 30+ old orders on every restart via `child_added`, including cancelled/delivered orders from weeks ago.

**What happens:** Every bot restart processes all historical orders. The `child_added` handler's time buffer (10s for online, 30min for dine-in) correctly skips them, but the processing of old orders still:
- Calls `getProcessedStatus` (Redis lookup) for each
- Logs CHILD-ADDED-TRACE entries (now removed)
- Runs the IF condition check

**Impact:** Slow bot startup. Each restart takes longer as order history grows.

**Fix needed:** Consider cleaning up old orders periodically, or adding a `processed: true` flag to orders after initial handling to skip them faster.

---

## SUMMARY

| # | Problem | Severity | Status |
|---|---------|----------|--------|
| 1 | Greeting image unsupported format | HIGH | OPEN |
| 2 | FCM admin notifications 4/4 failing | HIGH | OPEN |
| 3 | Confirmed status not sending | MEDIUM | FIXED |
| 4 | Baileys session dumps in logs | LOW | OPEN |
| 5 | Duplicate status processing | MEDIUM | OPEN |
| 6 | Missing status transition notifications | MEDIUM | OPEN |
| 7 | USync fetch failed | LOW | OPEN |
| 8 | Old orders replayed on restart | LOW | OPEN |
