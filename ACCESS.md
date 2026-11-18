# ACCESS.md — Foodhubbie Project Access Reference

> Generated: 2026-09-15 | Updated: 2026-11-18 (AWS/EC2 credentials retired — see §3)
> Firebase, Meta and application endpoints live here. **No cloud-provider secret is stored in this file.**
> AWS credentials for the replacement account live only in `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` (gitignored, never committed).

---

## 1. GitHub Repository

| Field | Value |
|-------|-------|
| Repo | `nexorasoftwareagency-rgb/Foodhubbie-project` |
| URL | https://github.com/nexorasoftwareagency-rgb/Foodhubbie-project |
| Branch | `main` |
| Server deploy branch | `server` (always an ancestor of `main`) |

---

## 2. Firebase Project

| Field | Value |
|-------|-------|
| Project ID | `foodhubbie-10` |
| Console | https://console.firebase.google.com/project/foodhubbie-10 |
| Logged In As | `nexorasoftwareagency@gmail.com` |

### Hosting Targets (5 live — foodhubbie.in subdomains only)

| Target | Site ID | URL | Status |
|--------|---------|-----|--------|
| admin | `foodhubbie-admins` | https://app.foodhubbie.in | ✅ Live |
| rider | `foodhubbie-riderapp` | https://rider.foodhubbie.in | ✅ Live |
| menu | `foodhubbie-qrmenu` | https://menu.foodhubbie.in | ✅ Live |
| supreme | `foodhubbie-supremeadmin` | https://control.foodhubbie.in | ✅ Live |
| website | `foodhubbie-web` | https://foodhubbie.in | ✅ Live |
| assets | `foodhubbie-assets` | (no custom domain — asset storage only) | — |

### Retired / Not deployed
| Site | URL | Reason |
|------|-----|--------|
| delivery | `foodhubbie-delivery.web.app` | Orphan — last deploy 2026-08-12, retired |
| default | `foodhubbie-10.web.app` | Retired — all traffic on foodhubbie.in subdomains |

### Deployment rule (effective immediately)
**Only deploy to foodhubbie.in subdomains. No web.app domains.**

```bash
# All hosting targets
firebase deploy --only database,hosting

# Specific targets
firebase deploy --only hosting:admin,hosting:menu,hosting:rider,hosting:supreme,hosting:website
firebase deploy --only database
```

### Firebase CLI
```bash
npx -y firebase-tools@latest deploy --only database,hosting
npx -y firebase-tools@latest deploy --only hosting:admin,hosting:supreme
npx -y firebase-tools@latest deploy --only database
```

### Firebase Config Files
| File | Path |
|------|------|
| `.firebaserc` | `D:\Foodhubbie Project\.firebaserc` |
| `firebase.json` | `D:\Foodhubbie Project\firebase.json` |
| `database.rules.json` | `D:\Foodhubbie Project\database.rules.json` |
| Admin SDK Key | `D:\Foodhubbie Project\Credentials\foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json` |

---

## 3. AWS / EC2 — RETIRED 2026-11-18

The first AWS account and its EC2 instance are **decommissioned and no longer used**. The access key from that account is already rejected by AWS (`InvalidClientTokenId`).

**Nothing about that account is needed to run Foodhubbie today:**

- Every database effect (orders, loyalty, stock, payments, push, media, onboarding, settlement, demo reseed, wallet gate) runs on **Firebase Cloud Functions**.
- EC2 exists only to hold the long-lived Baileys WhatsApp socket. It is currently offline, and when it is rebuilt it will be a **brand-new instance in a brand-new AWS account**.

**Where the new account's details go:** `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md`
(inside the gitignored `Credentials/` folder — create it from the template in that file's header; never commit it).

**Architecture, provisioning runbook and verification gates:** `PLAN/BACKEND-ARCHITECTURE.md` §4–§5.

**Decommissioned identifiers** (recorded for audit only; nothing uses them): account, instance, Elastic IP, key-pair name, security group and SSH endpoints were removed from this file on 2026-11-18. `FIREBASE_SERVER_MIGRATION/42_AWS_CREDENTIAL_RETIREMENT.md` lists every artifact that existed, where it was found, and what happened to it.

> Do **not** re-enter an EC2 host's raw IP anywhere in this repo. The socket host must be reached through `api.foodhubbie.in`, which will point at a **reserved Elastic IP** (mandatory — a stop/start must never change the address).

---

## 4. WhatsApp Business API (Meta)

| Field | Value |
|-------|-------|
| Meta App ID | `1894358871543574` |
| App Secret | `<see Credentials/Wa app secret.txt>` |
| WABA ID | `2589174454849821` |
| WABA Name | Test WhatsApp Business Account |
| Phone Number ID | `1211796118690392` |
| System User Token | `<see .env or Credentials/ folder>` |
| Token Expiry | Never (permanent) |
| META_CONFIG_ID | `1624840945941910` |
| Verify Token | `<see .env>` |

### Message Rates — India, effective 1 Oct 2026
| Category | Rate (per delivered message) |
|----------|------------------------------|
| Utility (order/status templates) | **₹0.115** |
| Authentication (OTP) | **₹0.115** |
| Service (in-window replies, after the first 1,000/month per phone number) | **₹0.115** |
| Marketing (promos) | **₹0.8631** |
| Inbound customer message | **₹0** |

Meta's INR list prices **already include 18% GST** — never add another 18%. The 1,000 free service messages reset monthly per business phone number and do not roll over. Source of truth: `docs/BILLING-MODEL.md` §4; code: `shared/meta-cost-math.js`.

### WABA Templates
| Template | Status | Type |
|----------|--------|------|
| `promo_cta_*` (6 shells) | PENDING | MARKETING |
| `promo_hinglish_*` (4 shells) | APPROVED | MARKETING |
| `rider_assigned` | APPROVED | UTILITY |
| `bot_live_update` | APPROVED | MARKETING |
| `hello_world` | APPROVED | UTILITY |

### Test Numbers
| From | To |
|------|----|
| `+1 555 661 9086` | `+91 97246 49971` |

### Webhook
| Field | Value |
|-------|-------|
| Public endpoint | `https://api.foodhubbie.in/webhook` (socket host, behind Caddy TLS) |
| Verify Token | `<see .env>` |

---

## 5. Bot Configuration

| Field | Value |
|-------|-------|
| Database URL | `https://foodhubbie-10-default-rtdb.firebaseio.com` |
| Redis | `redis://127.0.0.1:6379` (optional, in-memory fallback) |
| Webhook Port | `5000` |
| Bot Control Port | `4000` |
| Service Account Path | `/var/www/foodhubbie/bot/service-account.json` |

### PM2 Ecosystem
```javascript
// ecosystem.config.js
apps: [
  { name: 'bot-roshani-pizza-pizza', script: 'index.js', cwd: './bot', env: { OUTLET: 'pizza' } }
]
```

`BUSINESS_ID` is **required** in `/var/www/foodhubbie/.env` — without it the reverse index can resolve the wrong tenant.

---

## 6. Webhook Server

| Field | Value |
|-------|-------|
| Port | `:5000` |
| Path | `/webhook` |
| Proxy | `/api/*` → `:4000` (bot-control-api) |

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook` | Meta webhook receiver |
| ALL | `/api/*` | Proxy to bot-control-api :4000 |

---

## 7. Bot Control API

| Field | Value |
|-------|-------|
| Port | `:4000` |
| Auth | Firebase ID token (`Authorization: Bearer <token>`) |

### Key Routes
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/bot/provision/:bid/:oid` | Start PM2 bot worker |
| POST | `/api/bot/stop/:bid/:oid` | Stop bot worker |
| POST | `/api/bot/restart/:bid/:oid` | Restart bot worker |
| POST | `/api/bot/delete/:bid/:oid` | Delete bot worker |
| POST | `/api/bot/transport/:bid/:oid` | Switch transport (meta/qr) |
| POST | `/api/bot/rescan/:bid/:oid` | Re-scan QR code |
| GET | `/api/whatsapp/quota/:bid/:oid` | Get send quota |
| GET | `/api/whatsapp/templates/:bid/:oid` | List WABA templates |
| GET | `/api/whatsapp/numbers/:bid/:oid` | List phone numbers |
| POST | `/api/whatsapp/exchange` | Embedded Signup OAuth |
| POST | `/api/admin/update-password` | Update admin password |

---

## 8. Local File Structure

| Path | Purpose |
|------|---------|
| `D:\Foodhubbie Project\` | Project root |
| `Admin\` | Admin dashboard (built → `Admin/dist\`) |
| `SupremeAdmin\` | Supreme admin dashboard |
| `menu\` | Customer QR ordering app |
| `rider-app\` | Rider app (React + Vite) |
| `bot\` | WhatsApp bot source |
| `bot-control-api\` | Express API for PM2 control |
| `webhook-server\` | Webhook receiver + proxy |
| `shared\` | Shared Firebase config |
| `tools\` | Build + seed scripts |
| `docs\` | Documentation |
| `GUIDEs\` | Deployment guides |
| `Credentials\` | API keys + secrets (gitignored) |
| `website\` | Landing page |
| `ecosystem.config.js` | PM2 process config |
| `.env` | Environment variables (gitignored) |

---

## 9. Deploy Commands Quick Reference

```bash
# Firebase (all)
firebase deploy --only database,hosting

# Firebase (specific)
firebase deploy --only hosting:admin,hosting:supreme
firebase deploy --only database

# Bot / control API / webhook server — run ON the socket host only:
bash /var/www/foodhubbie/tools/server-deploy.sh
# (fast-forwards origin/server, node --checks changed JS, restarts pm2, gates on /api/bot/status-all → 401)
# Never scp individual files: hand edits make the next deploy abort by design.

# Server status
ssh ubuntu@api.foodhubbie.in "pm2 list && ss -tlnp | grep -E '4000|5000'"

# Build admin
cd Admin && node ../tools/build.mjs
```

---

## 10. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| AWS account + EC2 credentials retired | DONE 2026-11-18 | Old keys rejected by AWS; all local copies deleted. New account template: `Credentials/AWS-NEW-ACCOUNT-CREDENTIALS.md` |
| Socket host offline since 2026-11-11 | OPEN | Owner-side rebuild in a new AWS account. Every database effect keeps working without it — see `PLAN/BACKEND-ARCHITECTURE.md` |
| `api.foodhubbie.in` on an ephemeral address | OPEN | The rebuild must allocate an **Elastic IP** before touching DNS |
| Delivery site stale | ⚠️ | Last deploy 2026-08-12, no matching `firebase.json` block |
| Website target | ⚠️ | `firebase.json` block exists; verify before deploy |
