# Customer APP — Sub-tab 1: Push Notifications

**Status:** Planning  
**File:** `Admin/js/features/app-notifications.js` + pane markup in `Admin/index.html`  
**Route:** `tab-customer-app` → sub-tab `notification` (`caPaneNotification`)

---

## 1. Purpose & Use Cases

**Purpose:** Let the restaurant owner/manager send push notifications to customers who have the restaurant's app installed and notifications enabled. This is the primary channel for re-engaging customers outside WhatsApp.

**Primary use cases:**

| # | Use Case | Who | When | Type |
|---|----------|-----|------|------|
| 1 | Broadcast a promo/offer to all subscribers | Owner | New dish launch, festival discount | `promo` |
| 2 | Send loyalty points update to one customer | Staff | Customer redeemed points, tier-up | `loyalty` |
| 3 | Announce store hours change / closure | Owner | Holiday, maintenance, weather | `system` |
| 4 | Order status update to one customer | Staff | Order delayed, ready for pickup, out for delivery | `order` (transactional) |
| 5 | Test that push works before a campaign | Owner | Before first real send | `test` mode |
| 6 | Review past sends and delivery rates | Owner | Weekly review, debugging | History view |
| 7 | Copy app link to share with customers | Owner | Printing QR cards, WhatsApp status | Link copy |

**Rules (mirrored from bot-control-api `/tenant-api/notify`):**
- `order` → one customer only, ignores offers opt-in, never paused by quiet hours
- `promo`/`loyalty`/`system` → marketing: only customers with offers on, suppressed 21:00–09:00 IST, max 3 per customer per IST day
- `test` → admin's own device only, never gates on subscriber list

---

## 2. Current UI (What Exists)

| Element | ID | Status |
|---------|----|--------|
| Subscriber count stat | `pushSubCount` | ✅ |
| Offers reachable stat | `pushOffersReach` | ✅ |
| Last updated stat | `pushSubUpdated` | ✅ |
| Empty state panel | `pushEmptyState` | ✅ |
| App link input (readonly) | `pushAppLink` | ✅ |
| Copy app link button | `btnCopyPushAppLink` | ✅ |
| Refresh subscribers button | `caRefreshSubs` (shared header) | ✅ |
| Audience chips (all / one) | `pushAudience` radios | ✅ |
| One-customer phone input | `pushNotifPhone` + datalist `pushSubPhones` | ✅ |
| Reach line text | `pushReachLine` | ✅ |
| Type chips (promo/loyalty/system/order) | `pushNotifType` radios | ✅ |
| Type hint text | `pushTypeHint` | ✅ |
| Title input (100 char) | `pushNotifTitle` | ✅ |
| Body textarea (300 char) | `pushNotifBody` | ✅ |
| Char counts | `pushTitleCount`, `pushBodyCount` | ✅ |
| Test mode checkbox | `pushNotifTestMode` | ✅ |
| Test hint text | `pushTestHint` | ✅ |
| Preview card | `pushPreview` | ✅ |
| Preview icon | `pushPreviewIcon` | ✅ |
| Preview title/body | `pushPreviewTitle`, `pushPreviewBody` | ✅ |
| Preflight blocker | `pushPreflight` | ✅ |
| Send button | `btnSendPushNotif` | ✅ |
| Result panel | `pushSendResult` | ✅ |
| Send history section | `pushHistory` + `pushHistoryList` | ✅ |
| Quick templates (5) | `.tpl-btn` | ✅ |

---

## 3. Gaps & UX Problems

| # | Problem | Impact |
|---|---------|--------|
| 1 | No search/filter on subscriber list | Can't find a specific customer among 100+ subscribers |
| 2 | No scheduling (send later) | Must be present to send |
| 3 | No drafts | Can't compose and finish later |
| 4 | No campaign management | Can't view/edit/cancel scheduled sends |
| 5 | No delivery analytics | Don't know how many actually received vs. in-app only |
| 6 | No rich media | Can't attach images to push |
| 7 | No deep link configuration | Notification opens app home, not a specific page |
| 8 | No quiet hours customization | Fixed 21:00–09:00 IST, can't override |
| 9 | No frequency capping config | Fixed max 3/day, can't change |
| 10 | No opt-out management | Can't see who opted out of offers |
| 11 | Empty state shown even with subscribers | Wrong placement — `pushEmptyState` toggled by subscriber count but sits above composer |
| 12 | Templates hardcoded | Can't create/edit/delete custom templates |
| 13 | No "send to segment" | Only all or one customer |
| 14 | No keyboard shortcuts | Must click everything |
| 15 | No undo after send | Can't recall a wrong notification |

---

## 4. Planned Enhancements

### 4.1 Search & Filter
- Search subscribers by phone or name
- Filter by: all, offers-on, offers-off, active in last 7/30 days
- Show filter chips with counts

### 4.2 Scheduled Sends
- Date/time picker (IST)
- "Send now" vs "Schedule" toggle
- Scheduled sends listed in a separate panel with cancel option

### 4.3 Drafts
- Auto-save draft every 30s while typing
- Draft indicator on compose tab
- Load/resume draft on return

### 4.4 Templates Library
- Custom templates: create, edit, delete, favorite
- Template variables: `{{storeName}}`, `{{couponCode}}`, `{{orderId}}`
- Template categories: Promo, Loyalty, System, Order

### 4.5 Rich Media & Deep Links
- Optional image URL upload/preview
- Deep link field (app route: `/menu`, `/orders`, `/promo`, `/loyalty`)
- Preview shows how it looks on phone

### 4.6 Delivery Analytics
- Sent vs. delivered vs. in-app-only counts
- Per-send breakdown in history
- 7-day trend mini-chart (sent count by day)

### 4.7 Quiet Hours & Frequency Config
- Per-outlet quiet hours setting (default 21:00–09:00 IST)
- Max marketing sends per customer per day (default 3)
- Override toggle for urgent system messages

### 4.8 Segment Builder
- "Customers who ordered in last 30 days"
- "Customers with loyalty tier silver+"
- "Customers who opted into offers"
- Custom phone list (paste-separated)

### 4.9 Keyboard Shortcuts
- `Ctrl+Enter` → Send
- `Ctrl+.` → Toggle test mode
- `Escape` → Clear composer
- `1|2|3|4` → Switch type (promo/loyalty/system/order)

### 4.10 Undo After Send
- 5-second undo toast after successful send
- Undo marks the notifyLog entry as `recalled:true`

---

## 5. Data Model Changes

### New path: `pushScheduled/{key}`
```
{
  title, body, type, audience, phone?, scheduledAt (IST ms),
  status: 'pending'|'sending'|'sent'|'cancelled'|'failed',
  createdAt, updatedAt, by (admin uid)
}
```

### New path: `pushDrafts/{key}`
```
{
  title, body, type, audience, phone?, updatedAt
}
```

### New path: `pushTemplates/{key}`
```
{
  name, title, body, type, category, isFavorite, createdAt, updatedAt
}
```

### Extended: `pushSubscriptions/{key}`
```
+ optOutAt (null or timestamp)
+ totalReceives (counter)
+ lastReceiveAt (null or timestamp)
```

---

## 6. API Contract (bot-control-api `/tenant-api/notify`)

**Existing fields:** `title, body, type, audience, phone, testMode, data`

**New optional fields:**
- `scheduledAt` (ISO string or epoch ms) — if present, server queues instead of sending
- `imageUrl` (string) — rich media
- `deepLink` (string) — app route to open on tap
- `quietHoursOverride` (bool) — for urgent system messages

**Server response adds:**
- `scheduled: true/false`
- `scheduledAt` (if scheduled)

---

## 7. Implementation Tasks

### Frontend (Admin/js/features/app-notifications.js)

1. **Search box** above subscriber stats — filter `_subs` in memory
2. **Filter chips** — all / offers-on / offers-off / recent
3. **Schedule toggle** — date/time input, shows when "Send later" selected
4. **Draft auto-save** — localStorage keyed by outlet, on input debounce 300ms
5. **Draft restore** — on initPushUI, if draft exists, populate composer
6. **Template library UI** — button to open template picker modal
7. **Template CRUD** — save current as template, insert template, delete template
8. **Image URL field** — optional, with preview in notification card
9. **Deep link field** — select (none/menu/orders/promo/loyalty) or custom URL
10. **Quiet hours display** — show current quiet hours status in preflight
11. **History enhancement** — show scheduled vs sent, delivery rate %
12. **Undo toast** — 5s undo after send, marks notifyLog entry recalled
13. **Keyboard shortcuts** — global keydown listener
14. **Empty state relocation** — move below composer, only show when 0 subscribers

### Backend (bot-control-api/server.js)

1. **Scheduled send endpoint** — validate scheduledAt is future, write to `pushScheduled`
2. **Scheduler processor** — every minute, check `pushScheduled` for due items, send them
3. **Cancel scheduled** — DELETE `/tenant-api/notify/scheduled/:key`
4. **List scheduled** — GET `/tenant-api/notify/scheduled`
5. **Extended notify response** — include `scheduled` flag

---

## 8. Acceptance Criteria

- [ ] Can send a promo to all subscribers and see it in history
- [ ] Can send an order update to one customer by phone
- [ ] Test mode sends only to admin's device
- [ ] Scheduled send appears in scheduled list and fires at time
- [ ] Cancel scheduled send removes it
- [ ] Search filters subscriber list in real-time
- [ ] Template insert populates title+body
- [ ] Draft persists across page reload
- [ ] Undo toast appears after send and works
- [ ] Quiet hours block promo sends in 21:00–09:00 IST window
- [ ] Order type forces one-customer audience
- [ ] 0 console errors on all interactions
- [ ] Mobile: composer usable on 360px width

---

## 9. Files to Modify

| File | Change |
|------|--------|
| `Admin/js/features/app-notifications.js` | Search, schedule, drafts, templates, media, analytics, keyboard, undo |
| `Admin/index.html` | Add schedule UI, template modal, image/deep link fields, history enhancements |
| `Admin/style.css` | Styles for new components (schedule picker, template modal, analytics) |
| `bot-control-api/server.js` | Scheduled send endpoint, scheduler processor, cancel/list |
| `database.rules.json` | Write rules for `pushScheduled`, `pushDrafts`, `pushTemplates` |
| `shared/discount-rules.js` | No change needed |
