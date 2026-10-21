# Progress — Customer App Onboarding, Identity and Notifications

**Plan:** `docs/PLAN-CUSTOMER-APP-ONBOARDING.md`
**Started:** 2026-10-20
**Last updated:** 2026-10-20
**Overall status:** IMPLEMENTED + DEPLOYED (menu/rules/API/pizza bot); Admin promo E2E PASS. Remaining: real-device checks, optional Admin audience UI, inbox pruning, commit.

Status legend: `DONE` shipped and verified · `PARTIAL` exists but incomplete · `PLANNED` not started · `BLOCKED` waiting on a decision or dependency.

---

## 1. Status board

| Phase | Scope | Status | Evidence |
|-------|-------|--------|----------|
| 0 | Source audit + Zomato/Swiggy comparison + plan | DONE | `docs/PLAN-CUSTOMER-APP-ONBOARDING.md` |
| 1 | Identity foundation (local profile + `customers/{phone}/app` + rules) | DONE | `menu/js/customer.js`; rules deployed |
| 2 | Onboarding + permission priming | DONE | `maybeStartOnboarding`; one welcome page; live-tested |
| 3 | Promotions sub-tabs + Account | DONE | Offers/Notifications/Account live |
| 4 | Promo notification pipeline + inbox + deep links | DONE* | Live `{sent:1,inbox:1}`; Admin audience UI + inbox pruning not done |
| 5 | Transactional order push to customers | DONE* | Deployed; respects orderUpdates; live order transition not exercised |
| 6 | Cross-device order history | PLANNED (optional) | — |
| 7 | Verification, deploy, ledger | PARTIAL | Rules/menu/API/bot deployed; real-device + commit/ledger pending |

---

## 2. What is already done (pre-plan foundation)

These shipped before this plan and are dependencies, not part of its TODO count.

### 2.1 Install and identity

- [x] `menu/js/dynamic-manifest.js` — per-outlet `start_url`/`id`, no table token leak, FoodHubbie icon.
- [x] `menu/js/pwa-install.js` — Chromium `beforeinstallprompt`, iOS detection, install instructions, phone validation.
- [x] Promotions cards in `menu/index.html` and `menu/delivery.html` — install / iOS / notify.
- [x] `renderPromotionsScreen()` in `menu/js/app.js` and `menu/js/delivery.js` — shows cards and wires actions.
- [x] Phone stored in `fh_customer_phone`; subscription writes `pushSubscriptions/{safeToken}` with phone/outlet/business/platform/updatedAt.

### 2.2 Push and service workers

- [x] `menu/firebase-messaging-sw.js` registered at scope `firebase-messaging-sw/` (no longer clashes with `sw.js`).
- [x] Rules allow anonymous subscription create, validated token/outlet/platform/updatedAt/optional phone; admin-only read/delete.
- [x] `bot-control-api/server.js:963-1026` `POST /tenant-api/notify` — outlet-scoped FCM multicast, test mode.
- [x] Admin Promotions > App Notifications — subscriber count, compose, send, test mode.
- [x] Rider background push fixed (reference implementation for data-only notifications).
- [x] Menu SW at `menu-shell-v21`; installed-app session restore via `fh_last_table:<outlet>`.
- Release: commit `01dc0b1`; ledger `[20261020-150200-9c7d]`; deployed `database`, `hosting:menu`, `hosting:rider`; live rules tests pass.
- [ ] Real customer device push opt-in verified (blocked: needs a paired FCM device and a real send).

### 2.3 Existing data paths

- [x] QR orders: `menu/js/order.js` writes `guests/{phone}/orders/{orderId}` with `source:'QR'`.
- [x] PII separation: phone/name in `tableSessionsContact/{sessionId}`, not in public `tableSessions`.
- [x] Bot delivery profile: `customers/{phone}` with name/address/orderCount/totalSpent.
- [x] Admin customers list reads outlet `customers`.

---

## 3. Decision log

| Date | Decision | Status |
|------|----------|--------|
| 2026-10-20 | Sub-tabs: Offers / Notifications / Account | Accepted |
| 2026-10-20 | Onboarding is skippable and never blocks ordering | Accepted |
| 2026-10-20 | Phone required only for notifications/account/recovery | Accepted |
| 2026-10-20 | Location only for delivery; reuse existing dialog | Accepted |
| 2026-10-20 | Offers consent default OFF; order updates default ON after opt-in | Accepted |
| 2026-10-20 | Profile node: `customers/{phone}/app` | Accepted |
| 2026-10-20 | Server-persisted `pushInbox` | Accepted |
| 2026-10-20 | No OTP in this pass; copy says "ID", not "verified" | Accepted |

Any proposal accepted here becomes the implementation contract in the plan (section 2).

---

## 4. Task checklist

### Phase 1 — Identity foundation

- [ ] Add local profile shape (`fh_customer_profile`) and migrate `fh_customer_phone`.
- [ ] Name validation (2-60 chars, no script restriction); phone validation reuse.
- [ ] Consent shape (`offers`, `orderUpdates`, `version`).
- [ ] Server sync to `customers/{phone}/app` with one retry; never block UI on failure.
- [ ] Add rules for `customers/$phone/app` (read by exact phone; validated anon write; admin write).
- [ ] Align `pushSubscriptions.phone` rule to `/^[6-9][0-9]{9}$/`.
- [ ] Show `app.name` as fallback in Admin customers list (if not already).
- [ ] Add `tests/customer-profile.check.mjs`.
- [ ] Verify: reload persistence, invalid input, anon parent-read denial, bot fields protected.

### Phase 2 — Onboarding and permissions

- [ ] Create `menu/js/onboarding.js` with the step machine.
- [ ] Value pages (3), skip/back, progress, focus trap, reduced motion.
- [ ] Identity page (name + mobile + consent), inline errors, save + greeting.
- [ ] Notification priming; `Notification.requestPermission()` only on tap.
- [ ] Permission states: not enabled / enabled / blocked / install-required.
- [ ] Install step (Chromium prompt, iOS instructions); iOS order before notifications.
- [ ] Delivery location step reusing the existing dialog; no location on dine-in.
- [ ] First-run gate (`fh_onboarded_v1`), migration path for existing phone.
- [ ] Suppress onboarding on invalid/disabled/expired screens and during checkout.
- [ ] Deep-link handoff (`?screen=notifications`, `?order=`).

### Phase 3 — Promotions sub-tabs and Account

- [ ] Add tab markup + panes to `menu/index.html` and `menu/delivery.html`.
- [ ] Accessible tab behavior (`role=tablist`, arrows, Home/End, focus).
- [ ] Offers pane keeps `promotionsLinksContainer`.
- [ ] Notifications pane: state card, prefs, inbox list, empty state.
- [ ] Account pane: identity card, masked phone, edit, switch/clear, install, location, privacy.
- [ ] Move install/iOS/notify cards into Account; remove from Offers.
- [ ] Foreground banner and bottom-nav badge.
- [ ] CSS using existing tokens; 44px targets; visible focus.

### Phase 4 — Promo notification pipeline

- [ ] `/tenant-api/notify`: `audience` filter (`all` | `offers`).
- [ ] Fix `webpush.fcmOptions.link` to `MENU_WEB_ORIGIN`, not Admin.
- [ ] Write `pushInbox/{phone}/{pushId}` per unique phone; prune old entries.
- [ ] Clean invalid tokens returned by FCM.
- [ ] Extend `pushSubscriptions` optional `name`/`prefs` rules.
- [ ] Add `pushInbox` rules (exact-phone read, admin write, `indexOn sentAt`).
- [ ] Admin audience select, counts, preview, character limits.
- [ ] SW click routing and campaign tag.
- [ ] App `onMessage` foreground handler + inbox refresh.
- [ ] Verify: offer-only excludes non-consenting, inbox appears, click lands correctly, cross-outlet 401.

### Phase 5 — Transactional order push

- [ ] Bot resolves phone for delivery orders and QR sessions.
- [ ] Send data-only FCM on Placed / Ready / Delivered / rider assigned.
- [ ] Dedupe by `orderId + status`; one push per transition.
- [ ] Write `pushInbox` entry with `kind:"order"` and `orderId`.
- [ ] Respect `prefs.orderUpdates`; never block the order transition.
- [ ] No phone/token values in logs.
- [ ] Verify: one push per transition, no subscription = no failure, WhatsApp unchanged.

### Phase 6 — Cross-device history (optional)

- [ ] Decide QR-only vs QR + delivery visibility.
- [ ] Add phone-keyed order index and read rule.
- [ ] Render history in Account.
- [ ] Verify on a second browser with the same phone.

### Phase 7 — Verification and release

- [ ] `node --check` all changed JS; JSON parse rules.
- [ ] `tests/customer-profile.check.mjs` passes.
- [ ] Live REST rules matrix passes; test nodes deleted.
- [ ] Playwright onboarding/tabs/permission states pass.
- [ ] Real-device Android + iOS checks pass.
- [ ] Admin send + order push checks pass.
- [ ] Bump `menu/sw.js` cache name.
- [ ] Deploy rules, menu, server, bot, Admin in that order.
- [ ] Live smoke test, update this tracker, add ledger entry.

---

## 5. Verification log

| Date | Check | Result | Notes |
|------|-------|--------|-------|
| 2026-10-20 | Source audit | DONE | Code paths and docs traced; see plan section 3. |
| 2026-10-20 | Zomato/Swiggy comparison | DONE | Plan section 4. |
| 2026-10-20 | Plan + tracker written | DONE | This file + `PLAN-CUSTOMER-APP-ONBOARDING.md`. |
| 2026-10-20 | Identity rules | PASS | Valid app write persisted; mismatched phone 401; anon pushInbox read null; anon write 401. Test nodes removed. |
| 2026-10-20 | Onboarding/tabs/account | PASS | Live Playwright: onboarding, Offers/Notifications/Account, account save, switch styling. |
| 2026-10-20 | Promo end-to-end | PASS | Admin test offer -> `{"ok":true,"sent":1,"failed":0,"total":1,"inbox":1}`; inbox persisted; test nodes removed. |
| 2026-10-20 | Order push | PARTIAL | Code deployed, respects `prefs.orderUpdates`; live order transition not exercised. |
| 2026-10-20 | Real-device Android + iOS | PENDING | Needs paired FCM device; Playwright token only. |
| 2026-10-20 | Deploy | DONE | `database`, `hosting:menu`; EC2 API id 9 + pizza bot id 4 restarted. |
| 2026-10-20 | Commit + ledger | PENDING | Not committed yet. |

---

## 6. Known risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Phone-keyed public profile/inbox allows enumeration | Privacy | Minimal data only; no address/location/order totals; monitor; move behind signed API if abused. |
| No OTP means "login" is only an identifier | Account takeover by phone knowledge | Never call it verified; shared-device clear/switch; no sensitive data in public nodes. |
| iOS notification prompt outside standalone | Permission request fails silently | Install-first branch; show instructions; never dead button. |
| Existing users have `fh_customer_phone` but no name | Onboarding re-asks | Migration skips identity, marks complete, asks name only from Account. |
| Two notification sources (SW + foreground) | Double popup | Data-only payload; SW owns background, app owns foreground; unique tags. |
| Promo + order push + WhatsApp | Notification fatigue | Separate toggles; cap order pushes to transitions; offers opt-in only. |
| FCM tokens expire | Silent delivery loss | Clean invalid tokens on send; refresh token on each app open; Account shows state. |
| Shared working tree | Committing another session's WIP | Stage only in-scope files; never `git add -A`; inspect `git diff --cached` before commit. |
| `menu/` hosting serves only `menu/` | `/shared` imports 404 | Keep imports inside `menu/`; use `menu/shared/config/vapid.js` copy. |

---

## 7. Next actions

1. Verify real background push on Android + installed iOS; verify one live order transition (Placed/Ready/Delivered) writes inbox + FCM.
2. Optional: Admin audience/phone picker, `pushInbox` pruning (20-50), token-state Account badge.
3. Commit only in-scope files and append the ledger entry; then update this tracker to DONE.

Detailed phase checklists below are the original plan and were not all ticked; use the status board + verification log above as the current source of truth.
