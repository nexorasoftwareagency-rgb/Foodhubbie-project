# FoodHubbie - Pricing, Terms & Technical Implementation

> **Version:** 2.0  
> **Last Updated:** 2026-11-01  
> **Status:** Active — percentage pricing in force since 2026-11-01
>
> Pricing source of truth: `shared/cost-math.js` (`PERCENT_RATES`, `APP_PLAN_NAME`).
> Recorded model: `docs/BILLING-MODEL.md`. Public copy: `website/pricing.html`.

---

## 📋 Executive Summary

FoodHubbie is a complete Restaurant ERP platform providing:
- **POS & Table Management** (dine-in, walk-in, QR ordering)
- **QR Code Ordering** (customer-facing menu, table-side ordering)
- **WhatsApp Bot** (automated ordering, promotions, customer engagement)
- **Delivery Management** (rider app, dispatch, tracking)
- **Analytics & Promotions** (campaigns, loyalty, lost sales recovery)
- **Multi-outlet, Multi-business** architecture with data isolation

---

## 💰 Pricing Structure

**Percentage plan (in force 2026-11-01).** Charged on the value of each completed order. No monthly
subscription on any channel, no per-outlet licence.

| Plan / channel | Rate | What it covers |
|---|---|---|
| **Foodhubbi-App Orders** | **3%** of order value | Delivery-app orders **plus every status notification sent to the customer on the app** |
| **WhatsApp bot ordering** | **3%** of order value | Orders placed through the outlet's own WhatsApp bot |
| **POS counter** | **1%** of order value | Walk-in / counter billing |
| **QR menu** | **1%** of order value | Dine-in table ordering |
| Unclassified / legacy (`other`, unknown source string) | 3% | Anything not tagged with a channel |
| **Promotional message** | **₹1** per message | WhatsApp marketing templates to opted-in customers |
| **Setup** | **₹500** one-time, **non-refundable**, adjusted in the first bill | Onboarding |
| **Minimum first top-up** | **₹1,000** | Prepaid wallet |
| **Free promo tokens** | 15 | Welcome pack |

- Cancelled and refunded orders are **never** billed.
- The wallet is **prepaid**: order usage plus manual charges are deducted from top-ups. Balance is
  computed over the outlet's whole order history, so changing a billing mode **re-prices history** —
  announce it before migrating a paying outlet.
- **Superseded model:** flat ₹1–5 per order (POS ₹1 · QR ₹2 · WhatsApp ₹5) and the `commission_1pct`
  option. Both remain readable as **legacy** modes so old rows still compute; no new outlet uses them.

**Included on every channel** (no add-on modules):
- POS (walk-in, dine-in, takeaway) and QR table ordering (unlimited tables, printed QR codes)
- Table management: sessions, groups/splits, KOT/KDS, table requests
- Inventory, GST/tax, service charges
- Staff accounts and roles, attendance/shifts/leave/payroll
- Customer database, loyalty points, discounts/combos with happy-hour windows
- Rider dispatch, rider app, live tracking, daily settlements
- Reports (sales, tax, customers, staff) with CSV/Excel/PDF export
- Promotions campaigns (₹1/message) and analytics

---

### WhatsApp cost model — the platform pays Meta

Each restaurant owns **its own WhatsApp Business Account (WABA), phone number and templates**. The
platform never adds tenant numbers to a FoodHubbie-owned WABA.

**Meta's WhatsApp Business Platform usage is charged to FoodHubbie's main Facebook account**, not to
each restaurant (decision recorded 2026-11-01). So the 1%/3% order rates and the ₹1 promo price must
cover Meta's per-message cost. Indicative Meta rates for India (they change quarterly):

| Category | Rate/message | Use case |
|---|---|---|
| **Utility** | ~₹0.50–0.80 | Order confirmations, status updates, OTP |
| **Authentication** | ~₹0.50–0.80 | Login OTP, verification |
| **Marketing** | ~₹1.50–2.50 | Promotions, offers, re-engagement |
| **Service** | ~₹0.50 | Customer support conversations |

> **Open risk (recorded, not modelled in code):** there is no `metaCost` ledger yet, so true margin
> per outlet is unknown. QR dine-in customers never open a 24-hour service window, so **every status
> notification to them is a billable out-of-window utility message** — check the 1% QR rate against
> that cost before scaling QR dine-in, and note that ₹1/marketing message may be at or below cost.
> Full analysis: `docs/BILLING-MODEL.md`.

---

### Rider / Delivery Economics
- **Rider app is free** for restaurant's own delivery team
- **Delivery charges:** Configured per outlet in Admin Dashboard (Settings → Delivery → Slabs)
- **Who pays:** Restaurant decides — absorb, split, or pass to customer
- **Rider payout:** Configured per outlet (per order, per km, fixed daily, hybrid)
- **Commission tracking:** Automatic per rider, per order, per period
- **Settlement:** Auto-generated weekly/monthly; rider app shows earnings

---

## 📄 Contract Terms

### 1. Service Agreement
- **Term:** Month-to-month, auto-renewal
- **Cancellation:** 30 days written notice; no refund for partial month
- **Data Ownership:** Restaurant owns all customer, order, menu data. FoodHubbie claims no IP.
- **Data Export:** Full CSV/JSON export anytime via Admin Dashboard; API access on request

### 2. Service Level Agreement (SLA)
| Tier | Uptime | Support Response | Support Hours |
|------|--------|------------------|---------------|
| All outlets (single plan) | 99.5% | 24h (business hours) | Mon–Sat 9am–7pm IST |

**Exclusions:** Force majeure, Meta/WhatsApp API outages, restaurant internet/power issues.

### 3. Data & Privacy
- **Data Residency:** India (Mumbai region, Firebase/Google Cloud)
- **Encryption:** TLS 1.3 in transit; AES-256 at rest (Firebase)
- **Access Control:** Role-based (Owner/Admin/Manager/Cashier/Captain/Kitchen/Rider)
- **Audit Logs:** All admin actions logged (90-day retention)
- **GDPR/PDPB Ready:** Right to deletion, export, consent management

### 4. Payments & Billing
- **Billing model:** Prepaid wallet. Order usage and manual charges are deducted from top-ups; there is no monthly invoice cycle.
- **Minimum top-up:** ₹1,000 (first top-up is required before an outlet goes live).
- **Setup fee:** ₹500 one-time, non-refundable, adjusted in the first bill.
- **Low balance:** warning when the remaining balance reaches 25% of everything topped up so far.
- **Payment methods:** UPI / bank transfer, recorded in Supreme Admin (Usage & Payments → Record payment).
- **Invoices:** printable receipt generated from the payment record (save as PDF from the browser).
- **Mode changes:** switching a live outlet from a legacy flat-rate mode to `percentage` recalculates usage across its **entire order history**, so the wallet balance moves on migration.
- **Cancelled/refunded orders:** never billed.

### 5. Intellectual Property
- FoodHubbie owns platform code, UI, algorithms
- Restaurant owns: menu data, customer PII, order history, branding
- No reverse engineering, reselling, or white-labeling without written agreement

### 5. Termination & Data Return
- **On termination:** 30-day read-only access for data export
- **Data deletion:** Full purge within 30 days of termination confirmation
- **No refunds** for unused portion of prepaid period

---

## 🛠 Technical Implementation

### Architecture Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                        FOODHUBBIE PLATFORM                      │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│   ADMIN     │   CUSTOMER  │   RIDER     │       BOT             │
│  (React)    │  (React)    │  (React)    │    (Node.js/Node)     │
└──────┬──────┴──────┬───────┴──────┬──────┴──────────┬───────────┘
       │             │              │                 │
       └─────────────┴──────────────┴─────────────────┘
                              │
                    ┌─────────▼────────────┐
                    │  FIREBASE REALTIME   │
                    │      DATABASE        │
                    │  (Multi-tenant)      │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌─────────┐      ┌──────────┐    ┌────────────┐
        │ FIREBASE│      │  FIREBASE│    │  CLOUD     │
        │  AUTH   │      │ STORAGE  │    │  FUNCTIONS │
        └─────────┘      └──────────┘    └────────────┘
```

### Core Tech Stack
| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend (Admin/Customer/Rider)** | React 18, Vite, Tailwind CSS | 18.x / 5.x |
| **Bot/Backend** | Node.js 20, Baileys (WhatsApp), Firebase Admin SDK | 20.x |
| **Database** | Firebase Realtime Database (multi-tenant) | — |
| **Auth** | Firebase Auth (Email/Password, Google) | — |
| **Storage** | Firebase Storage (images, receipts) | — |
| **Messaging** | FCM (push), WhatsApp (Baileys/Meta), FCM | — |
| **Hosting** | Firebase Hosting (4 targets) | — |
| **CI/CD** | GitHub Actions → Firebase Deploy | — |

### Multi-Tenant Data Model
```
businesses/{businessId}/
  outlets/{outletId}/
    categories/{categoryId}
    dishes/{dishId}
    orders/{orderId}
    tables/{tableId}
    tableSessions/{sessionId}
    tableSessions/{sessionId}/orderGroups/{groupId}
    tableSessions/{sessionId}/orderGroups/{groupId}/orders
    tableRequests/{requestId}
    settings/{Store,Delivery,Tax,Dinein,Bot}
    riders/{riderId}
    tableAnalytics/{tableId}
    bot/commands/{commandId}
    webviewTokens/{tokenId}
    otpAttempts/{orderId}
  riders/{riderId}/
    notifications/{notificationId}
    location/{lat,lng,ts}
    stats/{totalOrders,totalEarnings}
menuBank/
  categories/{slug}
  dishes/{slug}
admins/{uid}
riders/{uid}
settlements/{riderId}
logs/
migrationStatus/
```

### Security Rules Summary
- **Admin:** Read/write own business + outlets (`businessId` match or `isSuper`/`isSupreme`)
- **Rider:** Read/write own outlet's orders, stats, location
- **Customer (QR):** Read tables, categories, dishes; create orders/sessions/requests
- **Bot:** Full outlet scope (service account)
- **PII:** `tableSessionsContact/{sessionId}` — auth-gated read/write only
- **Menu Bank:** Read auth-gated; write only own `sourceOid` (validated)

### Key Functions
| Function | Trigger | Purpose |
|----------|---------|---------|
| `onOrderUpdate` | Order write | Rider FCM (assignment, status), Admin FCM |
| `onNewOrder` | Order create | Admin FCM notification |
| `initFCMWatcher` (bot) | Order create/update | Admin FCM (new), Rider FCM (assign/status) |
| `onOrderUpdate` (bot) | Order status | Rider FCM (ready, pickup, cancelled) |
| `onNewOrder` (bot) | Order create | FCM to admins |

---

### Deployment & CI/CD
```yaml
# .github/workflows/deploy.yml (simplified)
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: Admin/dist }
      # Rider app build
      - working-directory: ./rider-app
        run: |
          npm ci
          npm run build
          # upload rider-app/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - run: firebase deploy --only hosting:admin,hosting:supreme,hosting:menu,hosting:rider
```

**Environments:** `development` (preview), `staging` (separate Firebase project), `production`

---

### Local Development
```bash
# Admin
cd Admin && npm run dev  # Vite dev server on :5173

# Rider App
cd rider-app && npm run dev  # Vite dev server on :5173

# Bot
cd bot && npm run dev  # nodemon + ts-node

# Supreme Admin
cd SupremeAdmin && npm run dev
```

---

## 🌐 Website Updates Required

### 1. Pricing Page (`/pricing`) — ✅ rewritten 2026-11-01
- [x] Five rate cards: POS 1% · QR menu 1% · Foodhubbi-App Orders 3% · WhatsApp bot 3% · promo ₹1/message
- [x] Worked months (₹2,300 / ₹2,100 / ₹7,200) and a 4-column comparison incl. aggregator at 25%
- [x] Visible FAQ + FAQPage JSON-LD kept in sync (8 questions)
- [x] Same rate card propagated to index, compare, best-software, pos-billing, qr-ordering,
      whatsapp-ordering, signup, use-cases, riders, kds, inventory, table-management,
      restaurant-analytics, multi-outlet, billing-policy

### 2. Features Page (`/features`)
- [ ] Tabbed: Base vs Premium
- [ ] Interactive demo links (Admin demo, QR demo, Rider demo)
- [ ] Integration badges (WhatsApp, Firebase, Razorpay, Meta)

### 3. Signup Flow (`/signup`)
- [ ] Step 1: Business details → Plan selection
- [ ] Step 2: Outlet details (name, address, phone, GSTIN)
- [ ] Step 3: Payment method (UPI/Card/NetBanking)
- [ ] Step 4: Onboarding checklist (categories, dishes, tables, staff)

### 4. Documentation (`/docs`)
- [ ] Admin User Guide (POS, Tables, Inventory, Reports)
- [ ] QR Ordering Setup (table stickers, QR generation)
- [ ] WhatsApp Bot Setup (Meta verification, template approval)
- [ ] Rider App Guide (login, orders, navigation, earnings)
- [ ] API Reference (webhooks, webhook signatures)
- [ ] Troubleshooting & FAQ

### 5. Legal Pages
- [ ] Terms of Service (`/terms`)
- [ ] Privacy Policy (`/privacy`)
- [ ] Data Processing Addendum (`/dpa`)
- [ ] Cookie Policy (`/cookies`)

### 6. Meta/WhatsApp Compliance
- [ ] Template submission guide (Marketing/Utility/Authentication)
- [ ] Opt-in/opt-out management (customer consent)
- [ ] 24-hour customer care window explanation
- [ ] Rate card page (Meta rates, updated quarterly)

---

## 📅 Rollout Plan

| Phase | Timeline | Deliverables |
|-------|----------|--------------|
| **Week 1** | Legal review | Finalize Contract Terms, DPA, SLA |
| **Week 2** | Website | Pricing, Features, Signup, Docs, Legal pages |
| **Week 3** | Technical | Staging deploy, integration testing, load test |
| **Week 4** | Launch | Production deploy, monitoring, support runbook |

---

## 📞 Support & Escalation

| Channel | Contact |
|---------|---------|
| Email | support@foodhubbie.com |
| WhatsApp | Support line (business hours) |
| Portal | Dashboard → Help |

**Escalation Matrix:**
1. L1: Support bot + knowledge base (instant)
2. L2: Email/Chat (24h business hours)
3. L3: Senior Engineer (critical issues)
4. L4: Engineering Lead + Product (critical only)

---

## 📊 Metrics & Success Criteria

| Metric | Target |
|--------|--------|
| **Activation Rate** | >60% complete onboarding in 7 days |
| **Monthly Churn** | <3% |
| **Net Revenue Retention** | >110% |
| **Support CSAT** | >4.5/5 |
| **Platform Uptime** | >99.5% |
| **API Latency (p95)** | <200ms |

---

## 📝 Appendices

### A. Glossary
| Term | Definition |
|------|------------|
| **Outlet** | Physical restaurant location (kitchen + tables) |
| **Business** | Legal entity owning one or more outlets |
| **Session** | Table occupancy period (orders + billing) |
| **Order Group** | Split bill within a session (multi-bill) |
| **Menu Bank** | Platform-wide shared dish/category library |
| **KOT/KDS** | Kitchen Order Ticket / Kitchen Display System |

### B. Default Settings (per outlet)
```json
{
  "tax": { "enabled": true, "name": "GST", "rate": 5 },
  "serviceCharge": { "enabled": false, "rate": 0 },
  "delivery": { "enabled": false, "slabs": [] },
  "hours": { "open": "11:00", "close": "23:00" },
  "currency": "INR",
  "timezone": "Asia/Kolkata"
}
```

---

*End of Document — FoodHubbie Pricing & Terms v1.0*