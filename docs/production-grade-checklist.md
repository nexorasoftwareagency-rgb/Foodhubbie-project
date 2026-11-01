# P2 — Production-Grade Domain Migration Checklist (after deploy 8941309)

> Created 2026-11-01. Must complete before cutting over user traffic fully from `.web.app`.

## Verified (LIVE — all respond 200)
- [x] `https://app.foodhubbie.in` → admin login loads (new auth domain)
- [x] `https://menu.foodhubbie.in` → QR menu loads (DB `qrBaseUrl` switches live links)
- [x] `https://rider.foodhubbie.in` → rider app loads
- [x] `https://control.foodhubbie.in` → supreme loads (new auth domain)
- [x] `.web.app` URLs remain live as fallbacks (`foodhubbie-admins.web.app` responds; others intact)
- [x] DB `qrBaseUrl` set to `https://menu.foodhubbie.in/` for all 19 outlets (includes `roshani-pizza/pizza`, `roshani-cake/cake`, `foodhubbie-demo/demo`, e2e outlets)
- [x] Auth `authorizedDomains` includes all 4 (`app/menu/rider/control`) + existing (`foodhubbie-10.*.app/web`, `supremeadmin.web.app`); PATCH 200 confirmed
- [x] Bot `WEBVIEW_DELIVERY_HOST` now `https://menu.foodhubbie.in/` (env-overridable); bot API CORS includes new admin/control hosts; loginUrl points to `app.foodhubbie.in`; `MENU_WEB_ORIGIN` defaults to `https://menu.foodhubbie.in/`
- [x] Supreme `ADMIN_APP_URL` = `https://app.foodhubbie.in` (profile + admin-creds templates)
- [x] Admin receipt `reviewUrl` + tables `qrBaseUrl` fallback = `https://menu.foodhubbie.in/`
- [x] Menu `delivery.html` OG meta (`og:image`, `og:url`, `twitter:image`) updated
- [x] Website marketing links (92 references across 25 files) rewritten to new subdomains; `firebase.json` demo redirect → `https://app.foodhubbie.in/demo`; `check-domain-migration.cjs` passes 0 hits
- [x] E2E battery base URL (`tests/e2e-inventory-compact.js`) points to `https://app.foodhubbie.in/`

## Open — Production-Grade checks (before full user cutover)
- [ ] Confirm live `qrBaseUrl` changes cause real WhatsApp delivery links to resolve to `menu.foodhubbie.in` (test on `roshani-pizza/pizza` via bot outbound message — not just DB value)
- [ ] Test `delivery.html` checkout + tender + loyalty: `WEBVIEW_DELIVERY_HOST` + `qrBaseUrl` must agree; check `bot/index.js` reads correct env on EC2 (`pm2 env` for bot workers)
- [ ] Confirm `menu.foodhubbie.in` SSL certificate fully active (Firebase console shows green; browser lock icon; no mixed-content warnings on delivery checkout)
- [ ] Confirm bot webhook + Meta WABA delivery: promotional templates (`promo_*`) must NOT trigger `transport-blocked` on Baileys (blocked by design since 2026-10-30); verify `runPromotionCampaign` pauses with `transport-blocked` when trying on Baileys (no error thrown — just paused)
- [ ] Confirm `api.foodhubbie.in` not needed (EC2 `:4000` behind webhook-server `:5000` + tunnel; no TLS reverse proxy yet) — leave out of production if no external integrations demand it
- [ ] Confirm `foodhubbie-delivery` site retirement safe: check `firebase hosting:sites:list` to confirm no live traffic (stale Aug 12); if empty, delete site (`hosting:sites:delete foodhubbie-delivery`) — do NOT delete `.firebaserc` target yet; verify no bot code references it
- [ ] Check CSP in `firebase.json`/`Admin/style.css` does not need `*.foodhubbie.in` additions (`'self'` covers the serving origin; `connect-src` covers Firebase domains; `img-src` covers `*` and `firebasestorage` — no new entries needed for subdomain hosting)
- [ ] Confirm `Admin/sw.js` (`v5.12.13`) and `menu/sw.js` (`v30`) serve correctly on new hosts (no 404 for cached assets; `sw.js` requires HTTPS — both new hosts serve HTTPS, so OK)
- [ ] Verify P2 deploy did NOT include a new `firebase.json` auth block change (only hosting targets + redirects changed; `auth.authorizedDomains` updated via API, not file deploy) — audit `firebase.json` diff before next deploy
- [ ] Confirm `Shared/menu-bank.js` mirror (`shared/menu-bank.js`) remains in sync with `Admin/shared/menu-bank.js` — not changed in P2; check if future deploy needs it
- [ ] Confirm nightly demo reseed (`/home/ubuntu/demo-seed/`, cron `30 21 * * *` UTC) runs with current `firebase.json` / `.firebaserc` (re-seeds `businesses/foodhubbie-demo` only, never `outletIndex/demo` or `outlet.whatsapp`); verify it passes `node --check`

## Decision / Risk notes for owner approval
- **Delivery site retirement** (`foodhubbie-delivery`) — proposed but NOT executed; needs explicit go (`hosting:sites:delete` + `.firebaserc` cleanup)
- **`api.foodhubbie.in`** — NOT configured; requires nginx/caddy TLS proxy on EC2 (`3.111.39.210`) before exposing; current bot-control-api (:4000) stays behind webhook-server (`:5000`); leave separate domain out unless needed
- **Promo campaigns blocked** on Baileys (`transport-blocked` pause + `isMetaTransport` guard) — stays blocked; picker only changes delivery when `meta` transport enabled; WABA templates (17 total) + `greeting_welcome` remain as-is; `sendPromotionalMessage` requires meta transport
- **Billing rate change** (percentage plan 3%/1%/1%/3% + ₹1000 top-up + ₹500 setup) is a separate P1 billing item; NOT affected by domain migration (cost math unchanged: `shared/cost-math.js` `PERCENT_RATES` lives independently of hosting URLs)
- **Ponytail** (laziness ladder): no new abstraction added; one shared URL constants file (`shared/url-defaults.js` idea) deferred to future refactor; existing per-app constants kept minimal; no new dependency added; no unrequested feature added
