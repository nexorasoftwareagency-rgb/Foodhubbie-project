# Customer APP Tab — Planning Overview & Architecture

**Status:** Planning Phase (pre-implementation)  
**Owner:** Admin Dashboard (hosting:admin → app.foodhubbie.in)  
**Scope:** All 4 sub-tabs of the Customer APP top-level tab  
**Date:** 2026-11-10

---

## 1. Current State Summary

The Customer APP tab (`tab-customer-app`) exists on `app.foodhubbie.in` with 4 sub-tabs:

| Sub-tab | File | Status | Core Function |
|---------|------|--------|---------------|
| **Push Notifications** | `customer-app.js` → delegates to `app-notifications.js` | Basic MVP | Send push to app subscribers |
| **Promo Page Offers** | `customer-app.js` | Basic MVP | Toggle which coupons show on customer Promo Page |
| **App Visibility** | `customer-app.js` | Basic MVP | Toggle dishes/categories/features visibility in app |
| **App Settings** | `customer-app.js` | Basic MVP | Store identity, contact, ordering toggles |

**What's missing across all sub-tabs:**
- No search, filter, or sort on any list
- No bulk actions (select all, hide all, show all)
- No real-time customer-facing preview
- No scheduling (send later, start/end dates)
- No usage analytics (send counts, open rates, redemption rates)
- No form validation (phone, URL, email formats)
- No unsaved-changes warning
- No empty-state CTAs that work
- No mobile-responsive tweaks for dense lists
- No keyboard shortcuts
- No audit trail (who changed what, when)
- No role-based field gating within the tab
- No confirmation dialogs for destructive actions
- No toast notifications with action buttons (e.g., "Undo")

---

## 2. Data Model (RTDB Paths)

All writes go under the current outlet: `businesses/{bid}/outlets/{oid}/…`

| Path | Used By | Shape |
|------|---------|-------|
| `pushSubscriptions/{key}` | Push Notifications | `{ phone, name, prefs:{offers:true\|false}, updatedAt, deviceToken }` |
| `notifyLog/{key}` | Push Notifications | `{ title, body, type, audience, phone?, test, sent, failed, inbox, at, by }` |
| `discounts/{id}` | Promo Page Offers | `{ type:'coupon', couponCode, name, value, mode, minSubtotal, maxCap, globalLimit, stats, startsAt, endsAt, daysOfWeek, startTime, endTime, promoPage:bool, channel, updatedAt }` |
| `menu/dishes/{id}` | App Visibility | `{ name, price, visible:bool, categoryId, stock, updatedAt }` |
| `menu/categories/{id}` | App Visibility | `{ name, visible:bool, sortOrder, updatedAt }` |
| `settings/Store` | App Settings + Visibility | `{ storeName, address, phone, whatsappNumber, googleReviewLink, appWelcomeMessage, deliveryFee, minOrder, dineInEnabled, deliveryEnabled, pickupEnabled, loyaltyEnabled, appFeatures:{onlineOrdering,tableBooking,promoPage,loyalty} }` |
| `admins/{uid}/fcmToken` | Push Notifications (test mode) | `{ token, updatedAt }` |
| `config/tunnelUrl` | Push Notifications (API base) | `string` |

---

## 3. UX Design Principles

1. **One thing at a time:** Each sub-tab does exactly one job, done well.
2. **Instant feedback:** Toggles save immediately with toast confirmation; no "Save" button needed for individual toggles.
3. **Preview-first:** Every change shows how it looks to the customer before committing.
4. **Safe defaults:** Destructive actions (hide all, delete, disable) require confirmation.
5. **Mobile-first admin:** Admin is often used on phones; 44px touch targets, no horizontal scroll.
6. **No dead ends:** Empty states always have a clear next step (Create, Add, Import, Learn).
7. **Honest states:** Loading, error, empty, partial, success — all visually distinct.
8. **Keyboard navigable:** Every action reachable via Tab, Enter, Space, Arrow keys.

---

## 4. Sub-Tab Deep Dives

See individual planning docs:
- [01 Push Notifications](./01-PUSH-NOTIFICATIONS.md)
- [02 Promo Page Offers](./02-PROMO-PAGE-OFFERS.md)
- [03 App Visibility](./03-APP-VISIBILITY.md)
- [04 App Settings](./04-APP-SETTINGS.md)

---

## 5. Implementation Roadmap

| Phase | Sub-tabs | Focus | Est. Effort |
|-------|----------|-------|-------------|
| **P0** | All 4 | Bug fixes: stale refs, missing IDs, wrong exports, SW cache | 1 day |
| **P1** | Push Notifications | Search, filter, scheduling, templates library, delivery stats | 3 days |
| **P2** | Promo Page Offers | Bulk toggle, usage stats, offer preview, date pickers, channel mgmt | 3 days |
| **P3** | App Visibility | Search, bulk show/hide, featured dishes, category reorder, preview | 3 days |
| **P4** | App Settings | Business hours, timezone, tax, branding, validation, unsaved warning | 3 days |
| **P5** | All 4 | Audit trail, role gating, keyboard shortcuts, i18n hooks | 2 days |

**Total: ~12 days**

---

## 6. Success Metrics

- 0 console errors on all 4 sub-tabs
- All RTDB writes succeed (no 401/403)
- Each sub-tab loads < 2s on 3G
- Toggle changes persist on refresh
- Empty states always show a CTA
- Mobile: no horizontal scroll, 44px touch targets
