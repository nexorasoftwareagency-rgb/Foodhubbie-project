# PLAN-DOMAIN-MIGRATION.md — .web.app → foodhubbie.in subdomains

> Status: PLANNING (2026-10-31). Nothing deployed. Every phase needs owner go.
> Principle: DNS/SSL first, code flips later — `.web.app` URLs never stop working,
> so users are only switched after each hostname is verified live.

## 0. Answers to the three unknowns (from repo inspection)

1. **Is Super Admin on a separate Hosting site?** YES — `foodhubbie-supremeadmin`
   (`.firebaserc` target `supreme`, deploys `SupremeAdmin/dist`).
2. **Is delivery tracking a separate app?** NO. Delivery ordering/tracking lives
   inside the menu app (`menu/delivery.html` + `menu/js/delivery.js` webview,
   deep links from WhatsApp). The `foodhubbie-delivery` hosting site is an
   **orphan**: last deploy 2026-08-12, no `firebase.json` hosting block, nothing
   in the repo references it. Decision needed: retire (`hosting:sites:delete`)
   — do NOT build a domain for an app that doesn't exist.
3. **One repo or several?** ONE repo, one Firebase project `foodhubbie-10`,
   **7** hosting targets already wired in `.firebaserc` + `firebase.json`
   (`firebase target:apply` was already run for all of them — nothing to do there).

## 1. Final mapping (confirmed)

| Target (`.firebaserc`) | Hosting site | Today | New domain | Site exists? |
|---|---|---|---|---|
| website | `foodhubbie-web` | https://foodhubbie.in | `foodhubbie.in` (+`www`) | already live |
| admin | `foodhubbie-admins` | `…admins.web.app` | `app.foodhubbie.in` | ✅ |
| menu | `foodhubbie-qrmenu` | `…qrmenu.web.app` | `menu.foodhubbie.in` | ✅ |
| rider | `foodhubbie-riderapp` | `…riderapp.web.app` | `rider.foodhubbie.in` | ✅ |
| supreme | `foodhubbie-supremeadmin` | `…supremeadmin.web.app` | `control.foodhubbie.in` | ✅ |
| assets | `foodhubbie-assets` | `…assets.web.app` | *(unmapped for now)* | ✅ (referenced by website CSP `img-src`) |
| delivery | `foodhubbie-delivery` | `…delivery.web.app` | — | ⚠️ orphan; propose retire in P3 |
| — | bot-control-api (EC2 :4000) | behind webhook-server :5000 + Cloudflare tunnel | `api.foodhubbie.in` | ⚠️ EC2 needs a reverse proxy w/ TLS before this is viable (P3, optional) |

One hostname = one Hosting site; each is a separate Firebase custom-domain
connection. No `firebase.json` restructuring needed — targets are deployed with
the existing `--only hosting:admin,hosting:menu,hosting:rider,hosting:supreme,hosting:website` lines.

## 2. Configuration & URL inventory (verified in code)

### Runtime-configurable (flip with a DB write, ZERO redeploy)
- **QR + dine-in links**: `Admin/js/features/tables.js` `_dineInBaseUrl()` reads
  `outlets/{oid}/settings/qrBaseUrl`, falling back to `…qrmenu.web.app/`. At
  cutover write `qrBaseUrl = https://menu.foodhubbie.in/` per live outlet —
  every new QR/print/review link switches instantly. Fallback string also
  updated in a later deploy (cosmetic).
- **Bot-delivery webview base**: `bot/index.js` `WEBVIEW_DELIVERY_HOST` is a
  hardcoded const (not env) — needs one code deploy (P2).

### Hardcoded, must change in code (P2)
| File | Refs |
|---|---|
| `bot/index.js` | `WEBVIEW_DELIVERY_HOST = "https://foodhubbie-qrmenu.web.app"` (WhatsApp deep links) |
| `bot-control-api/server.js` | CORS allowlist (`admins`,`supremeadmin`), `loginUrl`, `MENU_WEB_ORIGIN` default |
| `SupremeAdmin/js/features/restaurant-profile.js` + `templates/admin-creds.js` | `ADMIN_APP_URL = 'https://foodhubbie-admins.web.app'` |
| `Admin/receipt-templates.js` | `reviewUrl` fallback |
| `menu/delivery.html` | og:image / og:url / twitter:image meta |
| `Admin/tables.js` | `qrBaseUrl` fallback string |

### Website (SEO/links, P2)
- ~50 refs across ~25 `website/*.html` pages + `llms.txt` point at
  `qrmenu`/`admins` web.app (marketing links, not canonicals — canonicals and
  sitemap already use `foodhubbie.in`).
- `firebase.json` website redirects `/demo/*` → 302 `foodhubbie-admins.web.app/demo`
  — flip to `app.foodhubbie.in/demo`.
- Guard already exists: `tools/check-domain-migration.cjs` — run after the sweep.

### Auth (console-side, P1/P2)
- ⚠️ **HAZARD: never run `firebase deploy --only auth`.** The tracked
  `firebase.json` `auth.authorizedDomains` contains only `localhost` — a deploy
  would overwrite the real authorized-domain list and lock every login out.
  Add `app./menu./rider./control.foodhubbie.in` in **Firebase Console →
  Authentication → Settings → Authorized domains** only.
- Google sign-in exists on **Supreme only** (`googleSignIn.authorizedRedirectUris`
  = supremeadmin handler). After connecting `control.foodhubbie.in`, add
  `https://control.foodhubbie.in/__/auth/handler` (console + a controlled
  firebase.json auth update, or leave Google sign-in on the .web.app URL).
- Admin, rider, menu-customer flows: email/password or none — authorized
  domains cover them.
- Sessions are per-origin (Firebase Auth storage is per-origin): admin and
  supreme logins do not interfere; no cross-subdomain cookie sharing exists or
  is needed. Restaurant owners may need to log in once on the new URL.

### Unaffected (no action)
- `database.rules.json` — zero origin checks. CSP headers — `'self'` covers
  the new origin once serving there. Service workers / cache versions —
  relative URLs. GA4 config. Meta webhook — Cloudflare tunnel, EC2-hosted,
  unaffected by Hosting domains.

## 3. Phases

### P1 — Console + DNS (owner hands on, agent guides) — no code changes
1. Owner connects in Firebase Console → Hosting → each site → Add custom domain:
   - `app.foodhubbie.in` → `foodhubbie-admins`
   - `menu.foodhubbie.in` → `foodhubbie-qrmenu`
   - `rider.foodhubbie.in` → `foodhubbie-riderapp`
   - `control.foodhubbie.in` → `foodhubbie-supremeadmin`
2. GoDaddy DNS: add EXACTLY the records Firebase shows per hostname (CNAME to
   its unique target, or the A records 199.36.158.5/.100 if apex-style are
   offered). **Do not touch**: `@` A record, root TXT records, `www` CNAME.
   Do NOT reuse one target for several hostnames.
3. Wait for each Firebase custom domain to show Connected + SSL issued
   (TXT-first verification avoids temporary downtime).
4. Smoke-test each `https://<subdomain>` (loads, login works) BEFORE P2.

### P2 — Code/config cutover (agent, all reversible, .web.app still live)
1. DB: write `settings/qrBaseUrl = 'https://menu.foodhubbie.in/'` on live outlets.
2. Code sweep (single commit): bot `WEBVIEW_DELIVERY_HOST` (env-overridable),
   bot-control-api CORS + loginUrl + `MENU_WEB_ORIGIN` default (scp + pm2 restart),
   Supreme `ADMIN_APP_URL` ×2, admin `reviewUrl` + `qrBaseUrl` fallbacks,
   `menu/delivery.html` OG tags. Track both URLs in a `shared/url-defaults.js`
   or constants so the sweep is one-file-per-app, grep-verifiable.
3. Website sweep: `firebase.json` demo redirects + all `website/*.html` refs;
   run `node tools/check-domain-migration.cjs` (must exit 0).
4. Console: authorized domains + (optional) Google handler on control.
5. Deploy: `firebase deploy --only hosting:admin,hosting:menu,hosting:website,hosting:supreme,hosting:rider` + bot deploys on EC2.
6. Verify: battery `tests/e2e-inventory-compact.js` vs `app.foodhubbie.in`,
   QR scan on a test table, WhatsApp deep-link smoke test, rider login,
   supreme login + onboarding link.

### P3 — Optional/later (decisions, not blockers)
- `api.foodhubbie.in`: needs EC2 reverse proxy with TLS (nginx/caddy+certbot or
  Cloudflare proxied A-record) + tightened SG. Only worth it once external
  integrations demand a marketing-safe API host; today only Meta uses the
  tunnel.
- Retire `foodhubbie-delivery` site (confirm empty → `firebase hosting:sites:delete`).
- Map `assets` domain (only if asset URLs are ever customer-facing).
- After 2 weeks of stable traffic on new hosts: keep `.web.app` redirects
  (Firebase keeps serving them — leave as fallback indefinitely; do not delete).

### P4 — Verification checklist (each blank until tested live)
- [ ] app.foodhubbie.in login (owner + demo) & Roshani tab loads
- [ ] menu.foodhubbie.in QR scan → order → session attach
- [ ] WhatsApp delivery deep link opens menu.foodhubbie.in webview & orders
- [ ] rider.foodhubbie.in login + order accept → Delivered (earns loyalty)
- [ ] control.foodhubbie.in supreme sign-in (incl. Google if enabled)
- [ ] demo: app.foodhubbie.in/demo boots 0 console errors
- [ ] bot-control-api accepts an idToken from an app.* origin (CORS)
- [ ] Old `.web.app` URLs still answer on all 5 sites (fallback intact)

## 4. Risks / rules for this migration
- Never `firebase deploy --only auth` (authorizedDomains wipe) — console only.
- Never bundle custom-domain connects with code deploys in one go —
  DNS/SSL first, code second, verify between.
- All phases reversible: `.web.app` never stops serving; every P2 change is a
  config/string swap, and DB `qrBaseUrl` can be reverted per-outlet instantly.
- Owner authorization required before every deploy in P2 (standing rule).
