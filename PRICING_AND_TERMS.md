# FoodHubbie - Pricing, Terms & Technical Implementation

> **Version:** 1.0  
> **Last Updated:** August 2026  
> **Status:** Active

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

### Base Plan — Restaurant Operations Core
| Model | Price | Best For |
|-------|-------|----------|
| **Per-Customer** | **₹1 / customer** (orders placed) | New/growing restaurants, <750 orders/mo |
| **Fixed Monthly** | **₹750/mo** (after 3-month intro @ ₹500/mo) | Established restaurants, >750 orders/mo |

**Break-even:** 750 orders/month. Restaurant chooses model at signup; can switch monthly.

**What's Included:**
- POS (walk-in, dine-in, takeaway)
- QR Table Ordering (unlimited tables, QR codes)
- Table Management (groups, splits, billing, KOT/KDS)
- Inventory basics, tax/GST, service charges
- Staff accounts (cashier, captain, kitchen, manager)
- Basic analytics (sales, items, categories, lost sales)
- Inventory tracking (stock alerts, wastage)
- Customer database (walk-in + QR + WhatsApp)
- Basic reports (daily, weekly, monthly, CSV/PDF)
- Multi-language (English, Hindi, regional)
- Multi-outlet (per outlet pricing)

---

### Premium Plan — WhatsApp Automation Suite
**₹1,250/month + Meta WhatsApp API rates (pass-through)**

| Component | Pricing | Notes |
|-----------|---------|-------|
| **WhatsApp Ordering Bot** | Included | 24/7 automated ordering via WhatsApp |
| **Promotional Campaigns** | Meta WhatsApp API rates (pass-through) | Marketing/Utility/Authentication categories per Meta pricing |
| **Rider Delivery App** | Included | Restaurant's own riders use app; dispatch, tracking, OTP |
| **Promotional Campaign Manager** | Included | Templates, scheduling, targeting, ROI tracking |
| **Advanced Analytics** | Included | Cohort, LTV, retention, lost sales, rider performance |

**WhatsApp Message Categories & Meta Rates (India, indicative):**
| Category | Rate/Message | Use Case |
|----------|--------------|----------|
| **Utility** | ~₹0.50–0.80 | Order confirmations, status updates, OTP |
| **Authentication** | ~₹0.50–0.80 | Login OTP, verification |
| **Marketing** | ~₹1.50–2.50 | Promotions, offers, re-engagement |
| **Service** | ~₹0.50 | Customer support conversations |

> **Note:** Meta rates change quarterly. Restaurant pays actual Meta invoice + ₹1,250/mo platform fee. No markup.

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
- **Data Export:** Full CSV/JSON export anytime via Admin Dashboard; API access on Premium

### 2. Service Level Agreement (SLA)
| Tier | Uptime | Support Response | Support Hours |
|------|--------|------------------|---------------|
| Base | 99.5% | 24h (business hours) | Mon–Sat 9am–7pm IST |
| Premium | 99.9% | 4h (business hours) + WhatsApp | Mon–Sun 9am–10pm IST |

**Exclusions:** Force majeure, Meta/WhatsApp API outages, restaurant internet/power issues.

### 3. Data & Privacy
- **Data Residency:** India (Mumbai region, Firebase/Google Cloud)
- **Encryption:** TLS 1.3 in transit; AES-256 at rest (Firebase)
- **Access Control:** Role-based (Owner/Admin/Manager/Cashier/Captain/Kitchen/Rider)
- **Audit Logs:** All admin actions logged (90-day retention)
- **GDPR/PDPB Ready:** Right to deletion, export, consent management

### 4. Payments & Billing
- **Billing Cycle:** Monthly in advance (1st of month)
- **Payment Methods:** UPI, Card, Net Banking, Wallet (Razorpay/Stripe)
- **Auto-retry:** 3 attempts over 7 days; then suspension
- **Invoices:** GST-compliant, auto-generated, emailed + dashboard
- **Late Fee:** 2%/month after 15 days overdue

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

### 1. Pricing Page (`/pricing`)
- [ ] Two-column comparison (Base vs Premium)
- [ ] Toggle: Per-Customer vs Fixed Monthly
- [ ] Break-even calculator (₹1 × orders vs ₹750)
- [ ] Premium: WhatsApp rate estimator (orders/mo × ₹0.50–2.50)
- [ ] FAQ accordion (data ownership, Meta rates, rider costs)

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

| Channel | Base | Premium |
|---------|------|---------|
| Email | support@foodhubbie.com | priority@foodhubbie.com |
| WhatsApp | — | +91-XXXXX-XXXXX (business hours) |
| Phone | — | +91-XXXXX-XXXXX (Mon–Sun 9am–10pm) |
| Portal | Dashboard → Help | Dashboard → Help → Priority |

**Escalation Matrix:**
1. L1: Support bot + knowledge base (instant)
2. L2: Email/Chat (Base: 24h, Premium: 4h)
3. L3: Senior Engineer (Premium: 2h)
4. L4: Engineering Lead + Product (Critical only)

---

## 📊 Metrics & Success Criteria

| Metric | Target |
|--------|--------|
| **Activation Rate** | >60% complete onboarding in 7 days |
| **Monthly Churn** | <3% (Base), <1.5% (Premium) |
| **Net Revenue Retention** | >110% |
| **Support CSAT** | >4.5/5 |
| **Platform Uptime** | >99.9% (Premium), >99.5% (Base) |
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