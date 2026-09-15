# ACCESS.md — Foodhubbie Project Complete Access Reference

> Generated: 2026-09-15 | All credentials, endpoints, and infrastructure in one place.

---

## 1. GitHub Repository

| Field | Value |
|-------|-------|
| Repo | `nexorasoftwareagency-rgb/Foodhubbie-project` |
| URL | https://github.com/nexorasoftwareagency-rgb/Foodhubbie-project |
| Branch | `main` |
| Last Push | `2026-08-19` (commit `8796871`) |
| Latest Commit | `4966860` (2026-09-15, unpushed until session) |

---

## 2. Firebase Project

| Field | Value |
|-------|-------|
| Project ID | `foodhubbie-10` |
| Console | https://console.firebase.google.com/project/foodhubbie-10 |
| Logged In As | `nexorasoftwareagency@gmail.com` |

### Hosting Targets (7 sites)

| Target | Site ID | URL | Last Deployed |
|--------|---------|-----|---------------|
| admin | `foodhubbie-admins` | https://foodhubbie-admins.web.app | 2026-09-10 |
| rider | `foodhubbie-riderapp` | https://foodhubbie-riderapp.web.app | 2026-09-10 |
| menu | `foodhubbie-qrmenu` | https://foodhubbie-qrmenu.web.app | 2026-09-10 |
| supreme | `foodhubbie-supremeadmin` | https://foodhubbie-supremeadmin.web.app | 2026-09-10 |
| assets | `foodhubbie-assets` | https://foodhubbie-assets.web.app | 2026-09-10 |
| website | `foodhubbie-web` | https://foodhubbie-web.web.app | 2026-09-10 |
| delivery | `foodhubbie-delivery` | https://foodhubbie-delivery.web.app | 2026-08-12 ⚠️ STALE |

### Default Hosting
| Site | URL | Last Deploy |
|------|-----|-------------|
| `foodhubbie-10` | https://foodhubbie-10.web.app | 2026-08-12 |

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

## 3. AWS EC2 Instance

| Field | Value |
|-------|-------|
| Instance ID | `i-0c7f49065b1581542` |
| Public IP | `3.111.39.210` |
| Private IP | `172.31.9.124` |
| Instance Type | `t3.small` |
| Region | `ap-south-1` (Mumbai) |
| AMI | `ami-07e5ce642bbc48c0d` (Ubuntu) |
| Security Group | `sg-0a5a73df4b5d37b38` |
| Key Name | `foodhubbie-key` |
| Key File | `D:\Foodhubbie Project\foodhubbie-key.pem` |
| OS | Ubuntu 24.04 LTS |
| Uptime | 34+ days |
| Node.js | v20.20.2 |

### SSH Access
```bash
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210
```

### Security Group Inbound Rules
| Protocol | Port | Source |
|----------|------|--------|
| TCP | 22 (SSH) | `223.185.61.40/32` (current) |
| TCP | 8080 | `0.0.0.0/0` |
| TCP | 3000 | `0.0.0.0/0` |
| TCP | 443 | `0.0.0.0/0` |
| TCP | 80 | `0.0.0.0/0` |

> ⚠️ SSH IP is dynamic. If connection times out:
> ```bash
> curl -4 -s ifconfig.me  # get your IPv4
> aws ec2 authorize-security-group-ingress --group-id sg-0a5a73df4b5d37b38 --protocol tcp --port 22 --cidr YOUR_IP/32
> ```

### PM2 Services (Live)
| App | PID | Port | Uptime | Memory | Status |
|-----|-----|------|--------|--------|--------|
| `bot-control-api` | 101862 | :4000 | 29 days | 83 MB | ✅ online |
| `webhook-server` | 107953 | :5000 | 28 days | 67 MB | ✅ online |
| `bot-roshani-pizza-pizza` | 459457 | — | 2 days | 155 MB | ✅ online |
| `bot-roshani-cake-cake` | — | — | — | — | ⛔ not running |

### EC2 File Locations
| Path | Contents |
|------|----------|
| `/var/www/foodhubbie/` | Project root |
| `/var/www/foodhubbie/bot/` | WhatsApp bot source |
| `/var/www/foodhubbie/bot-control-api/` | Express API (:4000) |
| `/var/www/foodhubbie/webhook-server/` | Webhook proxy (:5000) |
| `/var/www/foodhubbie/.env` | Environment variables |
| `/var/www/foodhubbie/ecosystem.config.js` | PM2 config |
| `/var/www/foodhubbie/bot/session_data_pizza/` | Baileys session |
| `/var/www/foodhubbie/bot/service-account.json` | Firebase Admin SDK |

### Deploy to EC2
```bash
# Copy files
scp -i "D:\Foodhubbie Project\foodhubbie-key.pem" bot\index.js ubuntu@3.111.39.210:/var/www/foodhubbie/bot/index.js

# Restart services
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "cd /var/www/foodhubbie && pm2 restart all"

# Check status
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "pm2 list && ss -tlnp | grep -E '4000|5000'"
```

---

## 4. AWS Account

| Field | Value |
|-------|-------|
| Account ID | `772603145096` |
| Console | https://772603145096.signin.aws.amazon.com/console |
| IAM User | `nilesh-admin` |
| Password | `<see Credentials/ folder>` |
| Region | `ap-south-1` (Mumbai) |

### AWS CLI Credentials
```
AWS_ACCESS_KEY_ID: <see Credentials/ folder or AWS Console>
AWS_SECRET_ACCESS_KEY: <see Credentials/ folder or AWS Console>
```

---

## 5. WhatsApp Business API (Meta)

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

### WABA Templates
| Template | Status | Type |
|----------|--------|------|
| `bot_live_update` | APPROVED | MARKETING |
| `hello_world` | APPROVED | UTILITY |
| `roshani_greeting` | REJECTED | — |

### Test Numbers
| From | To |
|------|----|
| `+1 555 661 9086` | `+91 97246 49971` |

### Webhook
| Field | Value |
|-------|-------|
| EC2 Endpoint | `http://3.111.39.210:5000/webhook` |
| Verify Token | `<see .env>` |
| Cloudflare Tunnel | `https://photos-whenever-specifics-internationally.trycloudflare.com/webhook` |

---

## 6. Bot Configuration

| Field | Value |
|-------|-------|
| Database URL | `https://foodhubbie-10-default-rtdb.firebaseio.com` |
| Redis | `redis://127.0.0.1:6379` |
| Webhook Port | `5000` |
| Bot Control Port | `4000` |
| Service Account Path | `/var/www/foodhubbie/bot/service-account.json` |

### PM2 Ecosystem
```javascript
// ecosystem.config.js
apps: [
  { name: 'bot-roshani-pizza-pizza', script: 'index.js', cwd: './bot', env: { OUTLET: 'pizza' } },
  { name: 'bot-roshani-cake-cake', script: 'index.js', cwd: './bot', env: { OUTLET: 'cake' } }
]
```

---

## 7. Webhook Server

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

## 8. Bot Control API

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

## 9. Local File Structure

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
| `Credentials\` | API keys + secrets |
| `website\` | Landing page (new) |
| `ecosystem.config.js` | PM2 process config |
| `.env` | Environment variables |
| `foodhubbie-key.pem` | EC2 SSH key |

---

## 10. Deploy Commands Quick Reference

```bash
# Firebase (all)
firebase deploy --only database,hosting

# Firebase (specific)
firebase deploy --only hosting:admin,hosting:supreme
firebase deploy --only database

# EC2 (bot)
scp -i "D:\Foodhubbie Project\foodhubbie-key.pem" bot\index.js ubuntu@3.111.39.210:/var/www/foodhubbie/bot/index.js
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "cd /var/www/foodhubbie && pm2 restart all"

# EC2 (bot-control-api)
scp -i "D:\Foodhubbie Project\foodhubbie-key.pem" bot-control-api\server.js ubuntu@3.111.39.210:/var/www/foodhubbie/bot-control-api/server.js
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "pm2 restart bot-control-api"

# EC2 (webhook-server)
scp -i "D:\Foodhubbie Project\foodhubbie-key.pem" webhook-server\index.js ubuntu@3.111.39.210:/var/www/foodhubbie/webhook-server/index.js
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "pm2 restart webhook-server"

# EC2 (status check)
ssh -i "D:\Foodhubbie Project\foodhubbie-key.pem" ubuntu@3.111.39.210 "pm2 list && ss -tlnp | grep -E '4000|5000'"

# Build admin
cd Admin && node ../tools/build.mjs
```

---

## 11. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| SSH IP dynamic | ⚠️ | Home IP changes; re-add to SG via AWS CLI when blocked |
| Cake bot not running | ⚠️ | No WhatsApp linked to cake outlet |
| 55 uncommitted files | ✅ FIXED | Committed + pushed in this session (`4966860`) |
| Delivery site stale | ⚠️ | Last deploy 2026-08-12, no matching `firebase.json` block |
| Cloud Functions deleted | ✅ | `functions/` removed locally + committed |
| Website target | ⚠️ | In `firebase.json` but `website/` dir is new/untracked |
