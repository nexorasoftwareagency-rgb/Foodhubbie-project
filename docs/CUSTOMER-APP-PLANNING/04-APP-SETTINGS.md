# Customer APP — Sub-tab 4: App Settings

**Status:** Planning  
**File:** `Admin/js/features/customer-app.js` (pane 4)  
**Route:** `tab-customer-app` → sub-tab `settings` (`caPaneSettings`)

---

## 1. Purpose & Use Cases

**Purpose:** Configure the restaurant's app identity, contact details, ordering behavior, and fees. This is the "about my restaurant" configuration that shapes how customers experience the app.

**Primary use cases:**

| # | Use Case | Who | When |
|---|----------|-----|------|
| 1 | Set store name shown in app header | Owner | First-time setup |
| 2 | Set store address for QR cards/delivery | Owner | First-time setup or move |
| 3 | Set contact phone for WhatsApp chat | Owner | Onboarding |
| 4 | Set WhatsApp number for order notifications | Owner | When WhatsApp bot is connected |
| 5 | Set Google Review link | Owner | Wanting more reviews |
| 6 | Set welcome message | Owner | Rebranding or campaign |
| 7 | Set delivery fee | Owner | Changing delivery pricing |
| 8 | Set minimum order value | Owner | Changing order policy |
| 9 | Toggle dine-in/delivery/pickup on/off | Owner | Kitchen capacity changes |
| 10 | Enable/disable loyalty program | Owner | Running/not running loyalty |
| 11 | Reset all settings to defaults | Owner | Starting over |
| 12 | Verify settings saved correctly | Owner | After any change |

---

## 2. Current UI (What Exists)

| Element | ID | Status |
|---------|----|--------|
| Store name input | `caSettingStoreName` | ✅ |
| Store address input | `caSettingStoreAddress` | ✅ |
| Contact phone input | `caSettingStorePhone` | ✅ |
| WhatsApp number input | `caSettingWhatsAppNumber` | ✅ |
| Google Review link input | `caSettingGoogleReviewLink` | ✅ |
| Welcome message textarea | `caSettingWelcomeMessage` | ✅ |
| Delivery fee input | `caSettingDeliveryFee` | ✅ |
| Minimum order input | `caSettingMinOrder` | ✅ |
| Dine-in toggle | `caSettingDineIn` | ✅ |
| Delivery toggle | `caSettingDelivery` | ✅ |
| Pickup toggle | `caSettingPickup` | ✅ |
| Loyalty toggle | `caSettingLoyalty` | ✅ |
| Save Settings (top) | `btnSaveAppSettings` | ✅ |
| Save All App Settings (bottom) | `btnSaveAppSettingsBottom` | ✅ |
| Reset to Defaults | `btnResetAppSettings` | ✅ |

**Data source:** `Outlet.ref('settings/Store')` — single `get` on load, `update` on save

---

## 3. Gaps & UX Problems

| # | Problem | Impact |
|---|---------|--------|
| 1 | No validation | Invalid phone, URL, negative numbers accepted |
| 2 | No unsaved-changes warning | Changes can be lost on navigation |
| 3 | No inline help/tooltips | Don't know what each field does |
| 4 | No field-level save | Must save all or nothing |
| 5 | No "What changed" indicator | Don't know which fields are dirty |
| 6 | Phone not auto-formatted | Hard to read long numbers |
| 7 | URL not validated | Broken review links |
| 8 | No currency formatting for fee/min order | Hard to read amounts |
| 9 | No default values shown | Don't know what "default" means |
| 10 | Reset is destructive, no confirmation | Accidental data loss |
| 11 | No "Last saved" timestamp | Don't know when settings were last changed |
| 12 | No business hours config | Can't set when app is open |
| 13 | No timezone setting | Delivery times may be wrong |
| 14 | No tax/GST config | Can't configure tax rates |
| 15 | No branding (logo, color) | App looks generic |
| 16 | No success/error state distinction per field | Don't know if a specific field failed |

---

## 4. Planned Enhancements

### 4.1 Validation
- Phone: 10-digit Indian mobile, auto-format as +91 XXXXX XXXXX
- URL: valid http/https for Google Review link
- Numbers: delivery fee ≥ 0, minimum order ≥ 0, integers only
- Required: store name (can't save empty)
- Inline error messages under each field

### 4.2 Unsaved Changes
- Track dirty state per field and overall
- Show "Unsaved changes" indicator near Save button
- Browser `beforeunload` warning if dirty
- Warning toast when navigating away with unsaved changes

### 4.3 Auto-formatting
- Phone: auto-insert spaces/dashes as user types
- Currency: show ₹ symbol, format with commas
- URL: auto-prepend https:// if missing

### 4.4 Field-Level Save
- Each field saves individually on blur (debounced 500ms)
- Toast per field: "Store name saved"
- Overall Save button still exists for explicit save all

### 4.5 Dirty Indicators
- Blue dot or asterisk on changed fields
- "Last saved: just now" timestamp under Save button
- Show original value on hover

### 4.6 New Sections
- **Business Hours:** Per-day open/close times, break times
- **Timezone:** IST default, configurable
- **Tax/GST:** GST rate %, applicable on delivery fee?
- **Branding:** App theme color, logo URL, accent color
- **Order Limits:** Max order value, max items per order

### 4.7 Reset Improvements
- Confirmation dialog before reset
- "Reset to defaults" shows what defaults will be
- Option to reset individual sections (e.g., just fees)

### 4.8 Help & Guidance
- Tooltips on each field explaining impact
- "Learn more" links to docs
- Example values as placeholder text

### 4.9 Keyboard Shortcuts
- `Ctrl+S` → Save all settings
- `Tab` → Navigate fields logically
- `Escape` → Cancel unsaved edit on current field

---

## 5. Data Model Changes

### Extended: `settings/Store`
```
+ businessHours: {
    monday: { open: "09:00", close: "22:00", closed: false },
    ...
    breakStart: "15:00", breakEnd: "16:00"
  }
+ timezone: "Asia/Kolkata"
+ gstRate: 5 (percent, default 5)
+ taxOnDeliveryFee: false
+ maxOrderValue: null (no limit)
+ maxItemsPerOrder: null (no limit)
+ themeColor: "#E84908"
+ logoUrl: null
```

---

## 6. Implementation Tasks

### Frontend (customer-app.js pane 4)

1. **Validation** — phone, URL, numbers with inline errors
2. **Unsaved changes tracking** — dirty state, beforeunload warning
3. **Debounced per-field save** — 500ms on blur, toast per field
4. **Auto-format** — phone spacing, currency display
5. **Dirty indicators** — blue dot on changed fields, "Last saved" timestamp
6. **Confirmation on reset** — dialog before destructive reset
7. **Business hours section** — per-day open/close, break times
8. **Timezone selector** — IST default
9. **Tax/GST section** — rate, apply to delivery fee toggle
10. **Branding section** — theme color picker, logo URL
11. **Order limits section** — max order value, max items
12. **Tooltips** — on each field explaining impact
13. **Keyboard shortcuts** — Ctrl+S save, Escape cancel field edit

### Styles (style.css)

- `.ca-field--error` — red border + error message
- `.ca-field--dirty` — blue indicator dot
- `.ca-field--saved` — green check briefly
- `.ca-error-text` — small red error message
- `.ca-saved-badge` — "Saved" green pill
- `.ca-business-hours-grid` — 7-day hours layout
- `.ca-color-picker` — theme color input

---

## 7. Acceptance Criteria

- [ ] Can save store name, address, phone, WhatsApp, review link, welcome message
- [ ] Can set delivery fee and minimum order
- [ ] Can toggle dine-in/delivery/pickup/loyalty
- [ ] Validation rejects invalid phone, URL, negative numbers
- [ ] Inline error messages show under invalid fields
- [ ] Unsaved changes indicator shows when fields are modified
- [ ] Beforeunload warning when navigating away with unsaved changes
- [ ] Per-field debounced save works (blur → 500ms → save)
- [ ] Reset requires confirmation
- [ ] "Last saved" timestamp updates after save
- [ ] Ctrl+S saves all settings
- [ ] 0 console errors
- [ ] Mobile: form usable on 360px width

---

## 8. Files to Modify

| File | Change |
|------|--------|
| `Admin/js/features/customer-app.js` | Pane 4: validation, dirty tracking, debounced save, formatting, new sections |
| `Admin/index.html` | Add business hours, timezone, tax, branding, order limits sections |
| `Admin/style.css` | Error states, dirty indicators, saved badges, business hours grid |
| `database.rules.json` | Write rules for new settings/Store sub-fields |
