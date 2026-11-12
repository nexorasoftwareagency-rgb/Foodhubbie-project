# 23 — Production EC2 box offline (INCIDENT, OPEN)

Status: **open — waiting on the owner.** Nothing in batches 20–22 caused this and
nothing in the repo can fix it: the host is unreachable and the AWS credentials on
the dev machine are rejected, so this cannot be restarted from here.

Discovered 2026-11-12 09:04 IST during a routine post-deploy check of batch 22.

## 1. Evidence

Five independent signals, three of them from different networks/processes:

| signal | value | meaning |
|---|---|---|
| `businesses/roshani-pizza/outlets/pizza/botStatus.updatedAt` | `1794407604448` = **11 Nov 2026 20:03:24 IST** | the control API writes this every **30 s**; it stopped mid-cycle |
| `…/bot/status.lastSeen` (bot heartbeat, different process) | `1794407565125` = **11 Nov 2026 20:02:45 IST** | the bot worker stopped at the same minute — two independent writers, so the host died, not one app |
| last chat activity (`chatMeta.lastTs`) | 11 Nov 2026 15:50:19 IST | normal trading until the box disappeared |
| nightly demo reseed (`metadata.seededAt`, cron `30 21 * * *` UTC) | last run **11 Nov 2026 03:00:02 IST**; **12 Nov 03:00 run missing** | the box was already gone by 03:00 IST today |
| `api.foodhubbie.in` over HTTPS | times out locally **and** returns **522 (origin timeout)** through two unrelated server-side proxies (allorigins, codetabs) | the origin is down, this is not the dev machine's network |
| TCP 22 / 80 / 443 / 4000 on `3.111.39.210`, ICMP | all fail | host-level, not a single service |
| **all 33 outlets** in `outletIndex` | `botStatus.updatedAt` stops between **20:03:15** and **20:03:24 IST** | the control API writes one outlet at a time in a single 30 s reconcile pass — it died **mid-pass**, 9 s into the sweep. Not one app, not one tenant: the host. `node tools/check-box-live.cjs` reproduces this in one command. |

DNS still resolves `api.foodhubbie.in` → `3.111.39.210`, and the box's last
recorded state was healthy: `botStatus.status = online`, uptime 16,064 s, memory
159 MB, Baileys pair `connected`. The box had restarted at **15:36:53 IST** and
ran for 4 h 26 min before it went silent.

**Offline for ~13 h at the time of the check.**

## 2. What is down

* the pizza WhatsApp bot (pm2 35) — no replies, no order flow, no OTP handover;
* the e2e bot (pm2 6) and the legacy webhook server (pm2 0);
* `bot-control-api` (pm2 2), which is `api.foodhubbie.in`:
  * tenant image uploads (`POST /tenant-api/upload`) → Admin photo changes fail;
  * App Notifications sends (`/tenant-api/notify`);
  * Supreme WhatsApp quota reads, onboarding approvals, wallet-gate publisher
    (the 60 s pass is stopped — gates stay frozen at their last published value);
* bot-side DB finalization of **APP / webview orders**: server-side re-pricing,
  discount re-validation, reward-tender burn, stock deduction, loyalty earn;
* nightly demo reseed (missed today; will happen on the next 03:00 IST run once
  the box is back).

## 3. What still works (this is why the outage is quiet)

Admin, Supreme, the customer app/menu, the website and the rider app are
**Firebase Hosting + direct RTDB/Auth**, not the box. So:

* dine-in QR ordering still writes orders, and staff still see and bill them;
* APP orders can still be placed — they land as `Placed` / `paymentStatus:
  Pending` and are **finalized when the bot returns**. The bot's `child_added`
  catch-up covers **24 h**, so orders placed inside that window are recovered.
* Loyalty is the one real casualty: earn/clawback run on `child_changed`, which
  is **not replayed**. Any bill marked `Paid` while the box was down will not
  accrue points automatically (a manual adjustment in Admin → Loyalty is the
  remedy). This is the same documented gap as "a cancel while the bot is down is
  not replayed", not a new bug.

## 4. Recovery (owner, AWS console)

Instance **`i-0c7f49065b1581542`**, region **ap-south-1**, `t3.small`,
SG `sg-0a5a73df4b5d37b38`.

1. EC2 → Instances → `i-0c7f49065b1581542` → check **Instance state** and
   **Status checks**.
2. If `stopped` → **Start instance**. If `running` but failing status checks →
   **Reboot**; if that fails, Stop → Start (or the serial console) and read
   `/var/log/syslog`.
3. ⚠️ **The public IP is not static.** `3.111.39.210` was auto-assigned; a
   stop/start gives a **new** IP, which breaks:
   * `api.foodhubbie.in` (A record → `3.111.39.210`) — fix the DNS A record, and
   * any SSH/security-group rule tied to the old address.
   **Permanent fix (decision, do it once):** allocate an **Elastic IP**, associate
   it with the instance, and point the DNS record at it. Without that, every
   restart is a silent API outage — exactly the class of failure that just cost
   13 h.
4. Then, on the box: `pm2 list` (expect 0 webhook-server, 2 bot-control-api,
   6 e2e bot, 35 pizza bot) and `bash /var/www/foodhubbie/tools/server-deploy.sh`
   only if the tree is behind (it is — `origin/server` is `ef6f108`, the box was
   at `5532f63`; batches 20–22 touch no server file, so the script will
   fast-forward and restart the workers).

### Verify the box is really back (no console needed)

```bash
node tools/check-box-live.cjs        # botStatus age < 2 min + API 401 + details
```

Manual equivalent: `businesses/roshani-pizza/outlets/pizza/botStatus.updatedAt`
must be < 2 minutes old, `bot/status.lastSeen` must move every heartbeat, and
`GET https://api.foodhubbie.in/api/bot/status-all` must answer **401** (alive,
token-gated) rather than time out.

Then check the backlog: APP/webview orders placed during the window should flip
to finalized (stock/loyalty/tender written) within a minute of the bot booting.

## 5. Gaps this exposed

* **No out-of-band alert on the box going silent.** The bot writes every 30 s and
  stops; nothing watches that from outside. A tiny uptime check (or a Firebase
  Cloud Function comparing `botStatus.updatedAt` to now, which costs nothing at
  1 check/5 min) would have caught this in 10 minutes instead of 13 hours.
* **The box's public IP is ephemeral** — see §4.3.
* **The AWS CLI credentials on the dev machine are invalid**
  (`InvalidClientTokenId` on `sts get-caller-identity`), so the state of the
  instance could not be read from here; the diagnosis had to be inferred from
  Firebase write timestamps and third-party reachability.
* Loyalty earn/clawback has no replay for events missed while the bot is down
  (pre-existing, now hit for real).

## 6. Not the cause

Batch 22 (`b5015f7`) is frontend-only — `menu/js/session.js`,
`Admin/js/features/tables.js`, two service-worker cache names, a test, a npm
script, `tools/serve-dist.cjs` and docs. It was deployed at **08:44 IST today**,
after the box had already been silent for 12 h 40 min, and `firebase deploy
--only hosting:admin,hosting:menu` touches no server. Batches 20 and 21 changed
no server file either.
