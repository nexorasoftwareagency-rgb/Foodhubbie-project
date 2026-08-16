# Food-Hubbie Supreme Admin — Feature List

Internal platform tool. Sign in with a Food-Hubbie staff Google account that has
the `isSuper` (full access) or `isSupport` (read-only) custom claim set via the
Firebase Admin SDK, mirrored in `admins/{uid}`.

Live site: `https://foodhubbie-supremeadmin.web.app` (hosting target `supreme`).

**Access levels:**
| Role | Claim | What they can do |
|------|-------|------------------|
| Full | `isSuper: true` | Everything: add restaurant, restart/stop/reconnect bots, bulk restart, export CSV |
| Read-only | `isSupport: true` | View both dashboards + analytics; all mutating actions hidden/disabled |
| None | — | Sees "Not authorized" screen |

Security boundary is server-side: the Bot Control API (`bot-control-api` on EC2)
enforces `requireSuperOnly` on every mutating route. The client-side hiding is UX only.

---

## 1. Restaurant Management (dashboard tab 1 — orange theme)

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Restaurant list | `#restaurants` | Both roles (mutate hidden for support) | Table of every business→outlet. Click a row → profile. Shows plan, contact, WhatsApp status, live bot status (real-time via Firebase listener, no polling) |
| Search by name | `#restaurants` search box | Both | Live filter by outlet or business name |
| Filter by plan | `#restaurants` plan dropdown | Both | Starter / Growth / Enterprise |
| Filter by WhatsApp | `#restaurants` WhatsApp dropdown | Both | Connected / Not connected |
| KPI tiles | `#restaurants` top | Both | Total outlets, WhatsApp connected, Needs attention (offline/errored bots) |
| Onboarding indicator | `#restaurants` table row | Both | 4 dots showing business/outlet/WhatsApp/bot-online progress for not-yet-live outlets |
| Export CSV | `#restaurants` "Export CSV" | Both | Downloads currently filtered rows (not the full set). Formula-injection guard active |
| Add Restaurant | `#restaurants` → "Add Restaurant" button | `isSuper` only | Opens `#restaurants/onboard` form (redirects read-only accounts away) |

### Add Restaurant (`#restaurants/onboard`)

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Create business + outlet | `#restaurants/onboard` form | `isSuper` only | Business name, outlet name, contact phone/email, plan. Single atomic multi-path Firebase write — no orphaned records. Then auto-opens WhatsApp Embedded Signup |

### Restaurant Profile (`#profile/{bid}/{oid}`)

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Profile header | `#profile/{bid}/{oid}` top | Both | Outlet name, business, contact, live status pill |
| Onboarding stepper | profile page (not-yet-live outlets) | Both | 4-step visual: Business → Outlet → WhatsApp → Bot online |
| Outlet details | profile "Outlet details" card | Both | Business ID, Outlet ID, Plan (copy for debugging) |
| Agent status KPIs | "WhatsApp Agent" section | Both | Agent status, uptime, memory, WhatsApp connection — all live |
| 24h sparkline | "Status over last 24h" card | Both | Status history bar chart from `botStatus/history` (last 48 transitions) |
| WhatsApp quota gauge | "WhatsApp messaging quota" card | Both | Tier + used/limit from Bot Control API (`/api/whatsapp/quota`). Shows "not wired up" if `META_SYSTEM_USER_TOKEN` unset |
| Restart bot | "Manage agent" → Restart | `isSuper` only | POST `/api/bot/restart/{bid}/{oid}` to Bot Control API → PM2 restart |
| Stop bot | "Manage agent" → Stop | `isSuper` only | Confirm dialog (danger), POST `/api/bot/stop/{bid}/{oid}` |
| (Re)connect WhatsApp | "Manage agent" → Connect/Reconnect | `isSuper` only | Re-opens Meta Embedded Signup popup |
| View analytics | "View analytics" button | Both | Deep-links to `#analytics/{bid}/{oid}` |

## 2. WhatsApp Agents (dashboard tab 2 — green theme)

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Bot Fleet grid | `#agents` | Both (checkbox hidden for read-only) | Card per outlet: name, business, live status pill, uptime, memory, 24h sparkline |
| Fleet summary | `#agents` top | Both | Online / degraded / down counts |
| Filter by status | `#agents` dropdown | Both | All / Online / Degraded / Offline-errored |
| Export CSV | `#agents` "Export CSV" | Both | Currently filtered fleet rows |
| Bulk select | `#agents` checkboxes | `isSuper` only | Check cards → bar shows count |
| Bulk restart | `#agents` "Restart selected" | `isSuper` only | Confirm dialog, parallel POSTs to `/api/bot/restart/{bid}/{oid}`, reports success/failure counts |

## 3. Analytics

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Platform-wide analytics | `#analytics` | Both | Combined daily orders + revenue (30 days) across all outlets from `outlets/{oid}/dailyStats/{date}` |
| Outlet picker | `#analytics` dropdown | Both | Jump to any single outlet's analytics (rebuilt live so new restaurants appear without reload) |
| Outlet drill-down | `#analytics/{bid}/{oid}` | Both | Scoped orders + revenue for one outlet; linked from profile page |
| 30-day bar chart | analytics page | Both | Inline SVG (no chart library), zero new dependencies |

## 4. Global / cross-page

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Command palette | ⌘K / Ctrl+K or "Jump to…" button | Both | Fuzzy-search restaurants/outlets → open profile. Reuses live data store |
| Dashboard switcher | Top bar "Restaurant Management" / "WhatsApp Agents" | Both | Theme + content reskin (orange vs WhatsApp green) |
| Live data store | everywhere | Both | ONE Firebase listener on `businesses` for the whole session; all pages subscribe to it |
| Role gating | everywhere | Both | `isSupport` = read-only, buttons hidden/disabled; server enforces independently |

---

## Data model (Firebase RTDB)

| Path | Written by | Read by |
|------|-----------|---------|
| `businesses/{bid}` | Supreme Admin onboarding | Supreme Admin (both roles) |
| `businesses/{bid}/outlets/{oid}` | Supreme Admin onboarding | Supreme Admin |
| `businesses/{bid}/outlets/{oid}/whatsapp` | WhatsApp Embedded Signup flow | Supreme Admin + bot-control-api |
| `businesses/{bid}/outlets/{oid}/botStatus` | bot-control-api status-watcher (PM2 events + 30s reconcile) | Supreme Admin (live) |
| `businesses/{bid}/outlets/{oid}/botStatus/history` | status-watcher (capped 48 transitions) | Supreme Admin sparklines |
| `businesses/{bid}/outlets/{oid}/dailyStats/{date}` | bot/order pipeline | Supreme Admin analytics |
| `admins/{uid}` | Admin SDK (claims mirror) | bot-control-api auth |

## Not yet wired (flagged)

- **TUNNEL_URL** — set to last-known Quick Tunnel URL; rotates on reboot (cron renews server-side). Restart/stop/quota need the tunnel reachable.
- **META_CONFIG_ID** — WhatsApp Embedded Signup config ID still `REPLACE_ME`; without it the Path A popup won't launch (Path B works without it).
- **META_SYSTEM_USER_TOKEN / META_APP_SECRET** — unset on EC2 → quota + template GET return 501; set in ecosystem-bot-control.config.js to unlock Path B + quota.
- **Quota `used` count** — always 0 (Meta exposes tier cap only; needs a send-log counter for a real numerator — G5).

## SHIPPED — bot provisioning, WhatsApp numbers, templates (owner directive)

Full plan: `docs/PLAN-PROVISION-BOTS-NUMBERS-TEMPLATES.md`. Built + deployed (F1–F4, G1–G4, C1–C4 ✅; G5 usage counter ⬜). Verified in `docs/SUPREME-ADMIN-PROGRESS.md`.

| Feature | Where in dashboard | Access | Usage |
|---------|-------------------|--------|-------|
| Provision bot on EC2 | `#profile/{bid}/{oid}` → "Start bot worker" | `isSuper` | POST `/api/bot/provision` → pm2.start a fresh `bot-{bid}-{oid}` worker (env OUTLET/BUSINESS_ID/HEALTH_PORT) → existing QR modal. New restaurants go live without SSH. |
| Decommission bot | `#profile/{bid}/{oid}` → Manage agent | `isSuper` | POST `/api/bot/delete` → pm2.delete + remove session dir. |
| Onboarding QR path | `#restaurants/onboard` | `isSuper` | Choose "WhatsApp Web (QR)" instead of the Meta popup → provision + pair. |
| WhatsApp number wizard | `#profile/{bid}/{oid}` → "Connect Official WhatsApp number" | `isSuper` | Stepper: platform-managed (no popup) or Meta popup → add/pick number → send/verify code → register (auto 6-digit pin). Writes `outlet.whatsapp` + `phoneNumberIndex` + sets `bot.transport='meta'`. |
| Number management | `#profile/{bid}/{oid}` → number card | Both (mutate isSuper) | Display number, verified name, quality rating, messaging tier + used/limit, re-verify, deregister. |
| Message templates | `#profile/{bid}/{oid}` → "Message templates" card | Both (mutate isSuper) | List WABA templates, create from library, APPROVED/PENDING/REJECTED badges. |
| Onboarding templates | `#restaurants/onboard` → "Start from template" | `isSuper` | Pizza / Cake / Cloud Kitchen / Custom; one click seeds settings, categories, dishes, delivery, tax, hours. |
| Admin message-template library | `appTemplates/whatsappTemplates/` (seed script) | — | Starter set (order-confirmed, delivered, promo, feedback) as Meta template JSON. |