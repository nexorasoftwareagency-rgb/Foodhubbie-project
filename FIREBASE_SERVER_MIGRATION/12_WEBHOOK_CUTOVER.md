# 12 — Webhook Cutover (Batch 2, as built)

**Date:** 2026-11-10
**Status:** LIVE — Meta's WhatsApp callback now points at the Cloud Function.
**Commit:** `0be9833` (RTDB queue) → this batch (`webhook batching + orchestrator scope`).

---

## 1. What the checkpoint said vs. what is true

| Claim | Reality (verified 2026-11-10) |
|---|---|
| WABA `2589174454849821` is the pizza WABA | It is Meta's **"Test WhatsApp Business Account"** (`account_review_status: APPROVED`, business verified). |
| `1211796118690392` is the live pizza number | It is **`+1 555-661-9086` "Test Number"** (`platform_type: CLOUD_API`, `code_verification_status: NOT_VERIFIED`). The live pizza number `917485095436` runs on **Baileys** and has no Cloud API registration. |
| `phoneNumberIndex/1211796118690392` points at pizza | It pointed at `zz-quota-probe` / `zz-quota-outlet` — a **ghost** left by a quota-endpoint test. `Pending-Work.md` records the entry was deliberately deleted during the 2026-11-07 hygiene pass; the probe re-created it. **Deleted again** (backup: `%TEMP%/opencode/phoneNumberIndex-1211796118690392-backup.json`). |
| `wabaIndex` should map the WABA → pizza | **Not written.** Only `messages` is subscribed on the app, so template-status events are not delivered at all. Writing the mapping would create `businesses/roshani-pizza/outlets/pizza/whatsapp/templates` on a test WABA — re-creating the node the hygiene pass removed. `waLinkSuccess` writes `wabaIndex` when a real number is linked; that is the correct trigger. |

**Consequence:** no outlet currently receives Meta Cloud API traffic. The cutover changes *where* Meta delivers, not *whether* a bot answers — the pizza bot is Baileys and answers on WhatsApp Web.

---

## 2. Why the hop is RTDB, not Redis

The Functions webhook cannot reach `rediss://3.111.39.210:8443`:

- stunnel listens on `0.0.0.0:8443`, but security group `sg-0a5a73df4b5d37b38` allows only **80, 22, 443**.
- Redis has **no `requirepass`**. Opening 8443 to `0.0.0.0/0` would publish an unauthenticated database.
- A local subscriber probe confirmed the port is unreachable (connection timeout from both the dev machine and GCP).

So the function enqueues and the bot drains:

```
Meta POST → whatsappWebhook → businesses/{bid}/outlets/{oid}/webhookInbox/{pushId}
                            → bot createMetaTransport() child_added
                            → dispatchInbound() → messages.upsert
                            → snap.ref.remove()
```

Entries older than `MAX_INBOX_AGE_MS` (30 min) are dropped instead of replayed. Redis pub/sub is still subscribed by the transport so the EC2 `webhook-server` keeps working until it is retired; both paths share one `dispatchInbound()`.

**Known limit (accepted, trigger to fix):** an entry enqueued for an outlet whose bot is stopped or on Baileys is never drained. The node is bounded in practice because a meta worker deletes on start. Before the first real Meta outlet goes live, add a purge (or make the transport owner explicit).

---

## 3. Bugs fixed on the way

### 3.1 Cold-start race (message loss)

`initializeAdmin()` is called fire-and-forget at module load; `getDB()` *throws* when it has not settled. The first request of a cold start could therefore drop the first message after every scale-to-zero. The handler now `await initializeAdmin()` (memoized) before any DB call.

### 3.2 Batched payloads were truncated

The EC2 server reads `entry[0].changes[0].messages[0]`. Any additional entry/change/message in the same POST was silently dropped. The port now walks every entry → change → message and enqueues each. Proven live with a two-message POST.

### 3.3 Signature + verify token (previous commit `0be9833`)

- Verify token read from `WA_VERIFY_TOKEN` (was hardcoded `test-verify-token`).
- HMAC over `req.rawBody` (re-serializing `req.body` changes key order and fails on real traffic).

### 3.4 Secrets carried trailing newlines

All five GCP secrets had a trailing newline (`\r\r\n` on the URLs), which breaks URL parsing and any exact-match comparison. `WA_VERIFY_TOKEN` / `META_APP_SECRET` were replaced with the exact EC2 values; the rest had trailing whitespace stripped. All now verify `trailing=false`.

### 3.5 Orchestrator could stop a live worker (not yet triggered)

`desiredState()` guarded on `!outlet.whatsapp`, but a template-status write creates `whatsapp/templates/*` **without** a `status`. That flips the outlet from "not ours" (`null`) to "should not run" (`false`), and the stop branch then stops any worker with `bot.source === 'orchestrator'` — which the live pizza worker has. The guard is now `!outlet.whatsapp.status`. Guarded by `tests/orchestrator-scope.check.cjs` (8 cases).

---

## 4. Cutover

```
POST /1894358871543574/subscriptions
  object=whatsapp_business_account
  callback_url=https://whatsappwebhook-xydqit33wq-uc.a.run.app
  verify_token=<WA_VERIFY_TOKEN>
  fields=messages
→ {"success":true}
```

| | Before | After |
|---|---|---|
| Callback | `https://hall-advise-thinking-growth.trycloudflare.com/webhook` | `https://whatsappwebhook-xydqit33wq-uc.a.run.app/` |
| Hosting | `cloudflared tunnel --url http://localhost:5000` on EC2 (26 days old, random hostname) | Cloud Run (`us-central1`, `whatsappwebhook`) |
| Verification | tunnel GET | Meta's own GET → `[Webhook] Verified by Meta` at `10:45:53Z` |

Graph normalises the URL by appending `/`. `onRequest` serves every path, so both forms work.

**Rollback:** `bash /tmp/fh-cutover.sh rollback` (script kept at `%TEMP%/opencode/fh-cutover.sh`) restores the tunnel URL. The tunnel and `webhook-server` are still running.

---

## 5. Verification performed

| Check | Result |
|---|---|
| `tsc` build | clean |
| `node tests/orchestrator-scope.check.cjs` | 8/8 |
| Bot unit tests | 26/26 |
| Live E2E `functions/test/webhook-inbox.e2e.cjs` | **8/8** — signed POST → queue → real transport drain → 2 upserts (both batched messages) → ids/JIDs preserved → queue empty |
| Meta verification after cutover | `[Webhook] Verified by Meta` in Cloud Run logs |
| Ghost route | removed; `phoneNumberIndex` now holds only `123456789 → e2e` |
| EC2 after deploy | `3b35593`, apps 0/2/6/35 online, pizza `[TENANT] outlet=pizza business=roshani-pizza`, `transport=baileys`, ONLINE |

**Not proven:** a genuine customer message arriving from Meta. The test number has no real sender, and the live number is not on the Cloud API. The POST signature path is proven with the same app secret Meta uses; the delivery path is proven by Meta's verification GET.

---

## 6. Open items handed to the next batch

1. Real per-tenant WABA onboarding (Track A shared WABA / Track B per-tenant) — see `docs/PLAN-PER-TENANT-WABA.md`.
2. `webhookInbox` purge strategy before the first real Meta outlet (see §2).
3. Subscribe `message_template_status_update` only once `wabaIndex` is written by a real link.
4. Retire EC2 `webhook-server` + its two `cloudflared` quick tunnels once an outlet actually answers on the meta transport (not before — nothing else currently proves the path).
5. Storage migration for base64 media in RTDB — see `11_RTDB_COST_INCIDENT.md`.
