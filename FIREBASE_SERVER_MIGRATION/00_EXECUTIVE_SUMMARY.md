# Firebase Server Migration - Executive Summary

## Project: Foodhubbie ERP
**Date:** November 9, 2026  
**Analysis Version:** 1.0  
**Prepared For:** Foodhubbie Platform Team

---

## 🎯 Scope

**Migration Target:** Move from EC2-based server architecture to Firebase Functions 2nd Gen (serverless) for Meta WhatsApp Cloud API workloads.

**Workload Profile:**
- **100 Outlets** (restaurants)
- **50 Orders/Day/Outlet** = **5,000 Orders/Day** = **150,000 Orders/Month**
  - 25 orders/day via **WhatsApp** (Meta Cloud API)
  - 25 orders/day via **QR Menu** (Customer App / Web)
- **100 WhatsApp Business Numbers** (1 per outlet)

---

## 💰 Cost Comparison (Monthly)

| Architecture | Compute Cost | Meta WhatsApp Cost | Total Monthly | Annual |
|--------------|--------------|-------------------|---------------|--------|
| **Current EC2** | ~$413 (c6i.2xlarge) | ₹111,420 | **~₹146,096** | **₹17.5L** |
| **Firebase Functions** | **~$39** | ₹111,420 | **~₹115,956** | **₹13.9L** |
| **Savings** | **₹30,140/mo (21%)** | — | **₹3.6L/year** | — |

> **Meta WhatsApp costs dominate (96% of total).** Compute optimization saves ₹3.6L/year but the real leverage is in template optimization.

---

## 🏗️ Recommended Architecture: Firebase Functions 2nd Gen

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIREBASE FUNCTIONS (2nd Gen)                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Webhook Receive │  │ Order Processor │  │  Scheduled      │ │
│  │ (HTTPS)         │──│ (Task Queue)    │  │  Functions      │ │
│  │ minInstances: 5 │  │ Concurrency: 80 │  │  (Wallet,       │ │
│  │ Concurrency: 100│  │ RateLimit: 500/s│  │   Costs,        │ │
│  └─────────────────┘  └─────────────────┘  │   Reports,      │ │
│                                            │   Promos)       │ │
│  ┌─────────────────┐  ┌─────────────────┐  └─────────────────┘ │
│  │ Callable Funcs  │  │  RTDB Triggers  │                       │
│  │ (Admin API)     │  │  (Orders,       │                       │
│  └─────────────────┘  │   Wallet,       │                       │
│                       │   Promos)       │                       │
│                       └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                    RTDB / Firestore
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    CLIENT APPLICATIONS                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ WhatsApp    │  │ QR Menu     │  │ Admin       │             │
│  │ (Meta API)  │  │ (Customer   │  │ Dashboard   │             │
│  └─────────────┘  │  App)       │  │ (Supreme)   │             │
│                   └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 Migration Checklist

| Phase | Component | Status | Effort |
|-------|-----------|--------|--------|
| **1** | Webhook Receive (HTTPS) | 📋 Planned | 16 hrs |
| **2** | Order Processor (Task Queue) | 📋 Planned | 24 hrs |
| **3** | Scheduled Functions (Wallet, Costs, Reports, Promos) | 📋 Planned | 16 hrs |
| **4** | Callable Functions (Admin API) | 📋 Planned | 12 hrs |
| **5** | RTDB Triggers | 📋 Planned | 8 hrs |
| **6** | Shared Libraries Migration | 📋 Planned | 8 hrs |
| **7** | Testing & Load Testing | 📋 Planned | 16 hrs |
| **8** | Deployment & Cutover | 📋 Planned | 8 hrs |
| **Total** | | | **~108 hrs** |

---

## 🔑 Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Firebase Functions 2nd Gen** | 20-25× cheaper per order, auto-scales, zero ops, multi-AZ |
| **No EC2 needed** | No Baileys WebSocket; all workloads request-driven |
| **Task Queue for Order Processing** | Handles bursts, retries, rate limiting natively |
| **minInstances=5 on Webhook** | Guarantees <20s Meta ack SLA; costs ~$15/mo extra |
| **Keep Redis for Sessions** | Firebase Functions don't support persistent connections |
| **Meta WhatsApp cost dominates** | ₹111K/mo vs ₹3K Functions — optimize templates, not compute |

---

## 📁 Documentation Structure

```
FIREBASE_SERVER_MIGRATION/
├── 00_EXECUTIVE_SUMMARY.md           # This file
├── 01_WORKLOAD_ANALYSIS.md           # Detailed order flow & message counts
├── 02_META_WHATSAPP_COSTS.md         # Per-message pricing, volume tiers
├── 03_FIREBASE_FUNCTIONS_COSTS.md    # GB-s, CPU-s, invocation calculations
├── 04_EC2_ALTERNATIVE_COSTS.md       # Server sizing, reserved instances
├── 05_ARCHITECTURE_DESIGN.md         # Function specs, triggers, configs
├── 06_MIGRATION_PLAN.md              # Phase-by-phase migration steps
├── 07_CODE_MAPPING.md                # Current files → Firebase Functions
├── 08_RISKS_MITIGATION.md            # Cold starts, rate limits, debugging
├── 09_COST_OPTIMIZATION.md           # Template optimization, volume tiers
├── 10_DEPLOYMENT_GUIDE.md            # CI/CD, secrets, environments
├── functions/                        # Starter Firebase Functions project
│   ├── package.json
│   ├── tsconfig.json
│   ├── firebase.json
│   ├── .firebaserc
│   └── src/
│       ├── index.ts
│       ├── api/
│       ├── scheduled/
│       ├── taskqueue/
│       ├── triggers/
│       ├── lib/
│       └── shared/
└── scripts/
    ├── deploy.sh
    ├── load-test.sh
    └── cost-monitor.sh
```

---

## 🚀 Next Steps

1. **Review & Approve** this analysis with stakeholders
2. **Provision Firebase Project** (Blaze plan required)
3. **Create Starter Functions Project** (in `functions/` folder)
4. **Begin Phase 1** - Webhook Receive function
5. **Run Load Tests** against staging
6. **Gradual Cutover** with traffic splitting

---

**Contact:** Platform Engineering Team  
**Status:** Awaiting Approval