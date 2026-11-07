# Plan — Path B Companion Mode (WhatsApp Business App + Cloud API)

**Status:** ✅ implemented (detection + guide) · deployed 2026-08-17  
**Applies to:** Path B — all restaurant numbers on Foodhubbie's own WABA, billed to Foodhubbie's Meta account  
**Related:** `docs/PLAN-CHAT-HISTORY-COEXISTENCE.md` (Feature A = coexistence status card; Feature B = chat history tab)  
**Confirmed fact:** companion mode uses **QR scan** — there is no API toggle for it

---

## 0. What companion mode means in Path B

In Path B, Foodhubbie's WABA holds every restaurant's number, and Foodhubbie pays Meta for every message. The restaurant's number runs on **two surfaces at once**:

| Surface | Runs on | Used by | Bills to |
|---|---|---|---|
| Cloud API bot | Foodhubbie's EC2 server (`bot/index.js` meta transport) | order notifications, promos, rider messages | Foodhubbie's Meta account |
| WhatsApp Business App | Restaurant's own phone (Delhi) | restaurant staff watching/replying to customer chats | free (Business App sends are free) |

This is officially called **WhatsApp Business App + Cloud API coexistence**. Meta mirrors messages in both directions: anything the bot sends shows in the phone app, anything staff type on the phone arrives at the bot via webhook.

---

## 1. The QR scan is mandatory

There is **no API endpoint** to enable coexistence. Meta requires an app-side flow:

> **The restaurant owner must physically scan a QR code** shown in **WhatsApp Manager** (web.facebook.com/wa-manager/) using **WhatsApp Business App** on their phone (`Linked Devices → Link a device → scan QR`).

Steps:
1. Platform links the number on Cloud API (Path B wizard or Embedded Signup).
2. Restaurant owner installs WhatsApp Business App (≥ v2.24.17) on their phone and registers the same number.
3. Owner opens WhatsApp Manager on a PC/browser, finds their number, clicks the link option → Meta displays a **QR code**.
4. Owner scans that QR with their Business App phone.
5. Owner confirms chat-history consent.
6. Number is now live on **both** Cloud API (bot) and WhatsApp Business App (phone).

Without step 4 (QR scan), companion mode cannot exist.

---

## 2. Cross-city flow — Delhi restaurant, Bihar platform

Delhi and Bihar are **both in India (+91, IST UTC+5:30)** — no time-zone or country-code mismatch. Geography is not a blocker. The only physical requirement is **someone answers the restaurant's Delhi phone during setup** to receive the verification OTP.

### Who does what, where

| # | Step | Who | Where | What happens |
|---|---|---|---|---|
| 1 | Add restaurant | Platform (you) | Bihar (Supreme Admin) | Create business + outlet records in Firebase |
| 2 | Add number to your WABA | Platform (you) | Bihar | Graph API adds `+91 Delhi number` to Foodhubbie's WABA |
| 3 | SMS/voice OTP | **Restaurant owner** | **Delhi** | Meta sends OTP to the Delhi phone; owner reads it and shares it |
| 4 | Verify code + register | Platform (you) | Bihar | Submit OTP + 6-digit 2FA PIN via Graph API; number goes `active` |
| 5 | Bot worker starts | Orchestrator | EC2 (cloud) | `bot-{bid}-{oid}` starts, `transport=meta`, sends via your system-user token |
| 6 | Day-to-day messaging | Bot | Cloud | Order notifications, promos, rider messages — all billed to Foodhubbie's Meta account |
| 7 | **Restaurant watches** | Restaurant owner | **Delhi** | WhatsApp Business App on their phone sees incoming messages + can reply |
| 8 | Billing | Meta → Foodhubbie | — | Meta bills your Meta account; restaurant pays nothing |

### The one Delhi touchpoint

Step 3 is the **only** step requiring physical access to the Delhi phone (to read the OTP). After that, the number runs entirely from your Bihar server. The restaurant doesn't need to touch it again unless they want companion mode.

---

## 3. What the Delhi restaurant can do from their phone (after QR scan)

| Can do | Cannot do |
|---|---|
| Watch all incoming customer messages in real time | Manage message templates |
| Reply to customers from the phone | Run broadcast campaigns |
| See bot-sent order notifications mirrored in the app | View WhatsApp analytics/metrics |
| Send free-form messages within the 24h window | Change the WABA or number settings |

### Constraints
- **WhatsApp Business App ≥ v2.24.17** required on the Delhi phone
- **One phone only** — the Business App is active on one device at a time with that number
- While linked, **disappearing messages, view-once media, and live location** are disabled in the Business App (Meta restriction)

---

## 4. What the code already does

| File | What it handles |
|---|---|
| `webhook-server/index.js:131-139` | Detects `message.origin.type === 'business_app'` → writes `outlet.whatsapp.coexistence = { mode, lastSeenAt }` |
| `SupremeAdmin/js/features/whatsapp-manage.js` | Shows status pill (ON/OFF) + Enable button + 3-tap guide + "I've enabled it" record |
| `database.rules.json` | `whatsapp.coexistence` inherits the `whatsapp` node rules (super/supreme write only) |

The coexistence status is **detected** from webhooks (when a mirrored message arrives from the phone), not set by API. The dashboard guides the owner through the QR flow and records intent (`coexistence.enabledAt` + `by`), but Meta handles the actual enablement.

---

## 5. Billing implications (Path B)

- **All Cloud API sends billed to Foodhubbie's Meta account** — utility ₹0.115/message, marketing ₹0.8631/message (after first 1,000 free service messages/month per number).
- **Business App sends are free** — when Delhi staff reply from their phone, Meta does not charge for those sends.
- **24-hour window:** within 24h of a customer's inbound message, the bot can send free-form replies (service conversation). Beyond that, only approved templates can be proactive-sent — those bill at utility/marketing rates.
- The Delhi restaurant **never sees a Meta bill** — all costs roll up to your Foodhubbie Meta account in Bihar.

---

## 6. Risks / honest limits

| Risk | Impact | Mitigation |
|---|---|---|
| OTP step needs Delhi phone | setup can't complete without owner cooperation | schedule setup when the owner is reachable |
| WABA-level restriction hits all tenants | one Meta restriction disables every restaurant number | monitor WABA health; keep per-number backups |
| One payment instrument | one card failure blocks all sends | keep the payment method valid; monitor `131042` errors |
| Display-name review per number | Meta may reject "Roshani Pizza" under Foodhubbie's WABA | run a real-number display-name test before onboarding live tenants |
| Companion mode requires QR scan | can't enable remotely without owner | document the 5-step flow; schedule a setup call |

---

## 7. Build order (already done)

1. **Coexistence detection** — `webhook-server/index.js` writes `outlet.whatsapp.coexistence` on `origin.type: business_app`
2. **Status card + guide** — `whatsapp-manage.js` shows ON/OFF pill + 3-tap QR guide
3. **Rules** — `whatsapp` node (and coexistence under it) is super/supreme-write only

No remaining code work for companion mode itself. The remaining Path B work is Phase 3 (Meta cost ledger) and Phase 4 (migration of live pizza from Baileys to meta).

---

## 8. Decision log

- **2026-11-07:** Path B confirmed — all numbers on Foodhubbie's WABA, billed to Foodhubbie's Meta account. Companion mode supported via QR scan; no API toggle exists.
- **Open check:** Meta must approve third-party display names (e.g. "Roshani Pizza") under Foodhubbie's WABA — test on one real number before any live tenant.
