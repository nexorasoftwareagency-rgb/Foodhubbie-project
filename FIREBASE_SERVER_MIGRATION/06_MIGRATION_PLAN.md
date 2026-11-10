# Migration Plan - EC2 to Firebase Functions 2nd Gen

## Timeline Overview

| Phase | Duration | Focus | Deliverable |
|-------|----------|-------|-------------|
| **0** | Week 0 | Preparation | Project setup, CI/CD, secrets |
| **1** | Week 1-2 | Core Messaging | Webhook + Order Processor |
| **2** | Week 3 | Scheduled Jobs | Wallet, Costs, Reports, Promos |
| **3** | Week 4 | Admin API + Triggers | Callable functions, RTDB triggers |
| **4** | Week 5 | Cutover | 100% traffic, EC2 decommission |
| **5** | Week 6 | Stabilization | Monitoring, docs, handoff |

**Total: 6 weeks**

---

## Phase 0: Preparation (Week 0)

### Goals
- Provision Firebase project on Blaze plan
- Set up Functions 2nd Gen project structure
- Configure CI/CD pipeline
- Migrate secrets to Secret Manager
- Set up monitoring/alerting baseline

### Tasks

| Task | Owner | Effort | Dependencies |
|------|-------|--------|--------------|
| Create Firebase project (prod + staging) | DevOps | 4 hrs | Billing account |
| Enable Blaze billing | Finance | 1 hr | Budget approval |
| Set up Secret Manager secrets | DevOps | 4 hrs | Secret values from EC2 |
| Create Functions project skeleton | Backend | 8 hrs | Node 20, TypeScript |
| Configure ESLint, Prettier, Jest | Backend | 4 hrs | - |
| Set up GitHub Actions CI/CD | DevOps | 8 hrs | Firebase CLI, GCP SA |
| Configure Cloud Monitoring dashboards | DevOps | 8 hrs | Metrics design |
| Document current EC2 processes | Backend | 8 hrs | PM2 list, configs |
| **Total** | | **45 hrs** | |

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/firebase-functions.yml
name: Firebase Functions CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  FIREBASE_PROJECT_STAGING: foodhubbie-staging
  FIREBASE_PROJECT_PROD: foodhubbie-prod

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'npm' }
      - run: cd functions && npm ci
      - run: cd functions && npm run lint
      - run: cd functions && npm run test:ci
      - run: cd functions && npm run build

  deploy-staging:
    needs: lint-and-test
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'npm' }
      - run: cd functions && npm ci
      - uses: google-github-actions/auth@v2
        with: credentials_json: ${{ secrets.GCP_SA_KEY_STAGING }}
      - run: npx firebase deploy --project ${{ env.FIREBASE_PROJECT_STAGING }} --only functions
      - run: npx firebase functions:log --project ${{ env.FIREBASE_PROJECT_STAGING }} --limit 50

  deploy-production:
    needs: lint-and-test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }}, cache: 'npm' }
      - run: cd functions && npm ci
      - uses: google-github-actions/auth@v2
        with: credentials_json: ${{ secrets.GCP_SA_KEY_PROD }}
      - run: npx firebase deploy --project ${{ env.FIREBASE_PROJECT_PROD }} --only functions
      - run: npx firebase functions:log --project ${{ env.FIREBASE_PROJECT_PROD }} --limit 50
```

---

## Phase 1: Core Messaging (Week 1-2)

### Goals
- Deploy WhatsApp webhook receiver
- Deploy order processor task queue
- Achieve message processing parity with EC2
- Validate <500ms webhook response

### Week 1: Webhook Function

| Day | Task | Owner | Acceptance Criteria |
|-----|------|-------|---------------------|
| Mon | Implement signature verification | Backend | All test vectors pass |
| Tue | Implement payload parsing + enqueue | Backend | 100% messages enqueued |
| Wed | Deploy with minInstances=5 | DevOps | Function warm, <100ms cold start |
| Thu | Mirror 10% traffic via Cloudflare | DevOps | 10% webhooks to Functions |
| Fri | Load test (k6) | QA | 500 concurrent, p95 < 500ms |

**Deliverable:** `whatsappWebhook` function processing 10% live traffic

### Week 2: Order Processor

| Day | Task | Owner | Acceptance Criteria |
|-----|------|-------|---------------------|
| Mon | Port message routing logic | Backend | All message types handled |
| Tue | Port session management | Backend | Session parity with EC2 |
| Wed | Port menu/cart/order flows | Backend | E2E order flow works |
| Thu | Implement outbound send queue | Backend | Replies sent via Graph API |
| Fri | Increase mirror to 50% | DevOps | 50% traffic, zero message loss |

**Deliverable:** `processInboundMessage` + `sendOutboundMessage` at 50% traffic

### Migration Strategy: Traffic Mirroring

```nginx
# Cloudflare Workers script for traffic splitting
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/whatsappWebhook') {
      const percent = Math.random() * 100;
      const target = percent < 50 
        ? 'https://us-central1-foodhubbie-prod.cloudfunctions.net/whatsappWebhook'
        : 'https://api.foodhubbie.in/webhook';
      
      return fetch(target, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
    }
    return fetch(request);
  }
};
```

### Validation Checklist (Phase 1)

- [ ] Webhook signature verification: 100% pass rate
- [ ] Webhook response time: p99 < 500ms
- [ ] Message enqueue rate: 100%
- [ ] Order flow completion: 100% parity
- [ ] Outbound message delivery: 100% parity
- [ ] Session continuity: No session resets
- [ ] Error rate: < 0.1%
- [ ] Dead letter queue: < 5 messages/day

---

## Phase 2: Scheduled Functions (Week 3)

### Goals
- Deploy all scheduled functions with optimized schedules
- Validate wallet gate, cost publisher, reports, promos
- Achieve output parity with EC2

### Tasks

| Day | Function | Owner | Validation |
|-----|----------|-------|------------|
| Mon | `walletGateCheck` (adaptive) | Backend | Wallet gate matches EC2 for 100 outlets |
| Tue | `metaCostPublisher` | Backend | Balance matches EC2 ±1 paise |
| Wed | `dailyReports` | Backend | Report content matches EC2 |
| Thu | `weeklyReports`, `monthlyReports` | Backend | Report content matches EC2 |
| Fri | `promoScheduler` (event-driven) | Backend | Campaign sends match EC2 schedule |

### Adaptive Wallet Gate Implementation

```typescript
// functions/src/scheduled/walletGateCheck.ts
export const walletGateCheck = onSchedule({
  schedule: 'every 1 minutes',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async () => {
  const db = getAdminDB();
  
  // Get all outlets with wallet.enforce === true
  const armedOutletsSnap = await db.ref('outletIndex')
    .orderByChild('wallet/enforce')
    .equalTo(true)
    .once('value');
  
  const armedOutlets = [];
  armedOutletsSnap.forEach(child => {
    const meta = child.val();
    if (meta?.bid) armedOutlets.push({ bid: meta.bid, oid: child.key });
  });
  
  // Check disarmed outlets every 30 minutes
  const now = Date.now();
  const checkDisarmed = (now / 60000) % 30 === 0;
  
  let outletsToCheck = armedOutlets;
  if (checkDisarmed) {
    const allSnap = await db.ref('outletIndex').once('value');
    outletsToCheck = [];
    allSnap.forEach(child => {
      const meta = child.val();
      if (meta?.bid) outletsToCheck.push({ bid: meta.bid, oid: child.key });
    });
  }
  
  // Process in batches of 10
  for (let i = 0; i < outletsToCheck.length; i += 10) {
    const batch = outletsToCheck.slice(i, i + 10);
    await Promise.all(batch.map(checkAndPublishWalletGate));
  }
});
```

### Validation Checklist (Phase 2)

- [ ] Wallet gate: 100% match for armed outlets
- [ ] Wallet gate: Disarmed outlets checked every 30 min
- [ ] Meta cost balance: ±1 paise vs EC2
- [ ] Daily reports: Row-for-row match
- [ ] Weekly reports: Row-for-row match
- [ ] Monthly reports: Row-for-row match
- [ ] Promo campaigns: Same send times, same recipients
- [ ] No duplicate promo sends

---

## Phase 3: Admin API + Triggers (Week 4)

### Goals
- Deploy all callable functions for Admin/Supreme
- Deploy RTDB triggers for event-driven processing
- Migrate Admin dashboard to call Functions

### Tasks

| Day | Component | Owner | Validation |
|-----|-----------|-------|------------|
| Mon | `botControl` (restart, status, transport) | Backend | Dashboard controls work |
| Tue | `onboardingApprove` | Backend | New outlet created correctly |
| Wed | `transportSwitch`, `passwordReset` | Backend | Transport switches, passwords reset |
| Thu | RTDB Triggers (orders, wallet, promos) | Backend | Events fire correctly |
| Fri | Admin dashboard integration | Frontend | All Admin features work via Functions |

### Trigger Implementation Example

```typescript
// functions/src/triggers/onOrderStatusChange.ts
export const onOrderStatusChange = onValueWritten({
  region: 'us-central1',
  memory: '256MiB',
  ref: 'businesses/{bid}/outlets/{oid}/orders/{orderId}/status',
  secrets: ['FIREBASE_DATABASE_URL'],
}, async (event) => {
  const { bid, oid, orderId } = event.params;
  const before = event.data.before.val();
  const after = event.data.after.val();
  
  if (before === after) return; // No change
  
  const logger = createLogger(`order-status-${orderId}`);
  logger.info(`Status changed: ${before} -> ${after}`, { bid, oid, orderId });
  
  // Handle specific transitions
  switch (after) {
    case 'Placed':
      await enqueueTask('processOrderEvent', { orderId, bid, oid, event: 'placed' });
      break;
    case 'Confirmed':
      await notifyCustomer(orderId, bid, oid, 'order_confirmed');
      await notifyKitchen(orderId, bid, oid);
      break;
    case 'Delivered':
      await processLoyaltyAccrual(orderId, bid, oid);
      await notifyCustomer(orderId, bid, oid, 'delivered');
      break;
    case 'Cancelled':
      await processCancellation(orderId, bid, oid, before);
      break;
  }
});
```

### Validation Checklist (Phase 3)

- [ ] Bot restart/status/transport: Works from Supreme dashboard
- [ ] Onboarding: Creates outlet + admin user + auth mirror
- [ ] Transport switch: Updates RTDB, triggers worker restart
- [ ] Password reset: Updates Auth + RTDB adminLogin
- [ ] Order status trigger: Fires on all transitions
- [ ] Wallet trigger: Recomputes gate on balance change
- [ ] Promo trigger: Queues campaign on create
- [ ] Admin dashboard: 100% feature parity

---

## Phase 4: Cutover (Week 5)

### Goals
- 100% traffic to Firebase Functions
- Decommission EC2 API processes
- Validate production stability

### Cutover Checklist

| Step | Action | Owner | Rollback Time |
|------|--------|-------|---------------|
| 1 | Increase mirror to 100% | DevOps | 5 min (Cloudflare) |
| 2 | Monitor for 2 hours | All | - |
| 3 | Stop EC2 bot-control-api PM2 | DevOps | 10 min (PM2 restart) |
| 4 | Stop EC2 scheduled jobs | DevOps | 10 min |
| 5 | Verify no message loss | QA | - |
| 6 | Update DNS if needed | DevOps | 5 min |
| 7 | 48-hour stability watch | All | - |

### Rollback Procedure

```bash
# 1. Revert Cloudflare Worker to 0% Functions
# 2. Restart EC2 PM2 processes
pm2 restart ecosystem.config.js --env production

# 3. Verify EC2 health
curl https://api.foodhubbie.in/health

# 4. Notify team
slack-cli post "#platform-alerts" "🔄 ROLLBACK: Traffic reverted to EC2"
```

### Go/No-Go Criteria

| Metric | Threshold | Current |
|--------|-----------|---------|
| Webhook p99 latency | < 500ms | TBD |
| Order processing success | > 99.9% | TBD |
| Message delivery rate | > 99.9% | TBD |
| Error rate | < 0.1% | TBD |
| Wallet gate accuracy | 100% match | TBD |
| Report accuracy | 100% match | TBD |
| Team confidence | Unanimous | TBD |

---

## Phase 5: Stabilization (Week 6)

### Goals
- Production monitoring baseline
- Documentation complete
- Knowledge transfer
- Cost optimization review

### Tasks

| Task | Owner | Effort |
|------|-------|--------|
| Finalize Cloud Monitoring dashboards | DevOps | 8 hrs |
| Set up budget alerts ($100/mo Functions) | DevOps | 2 hrs |
| Document all function configs | Backend | 8 hrs |
| Create runbooks for common issues | Backend | 8 hrs |
| Cost analysis (1 week data) | Finance | 4 hrs |
| Team training session | All | 4 hrs |
| Retrospective meeting | All | 2 hrs |
| **Total** | | **36 hrs** |

---

## Resource Allocation

| Role | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Total |
|------|---------|---------|---------|---------|---------|---------|-------|
| **Backend Engineer** | 20 hrs | 60 hrs | 30 hrs | 40 hrs | 20 hrs | 16 hrs | 186 hrs |
| **DevOps Engineer** | 20 hrs | 16 hrs | 8 hrs | 8 hrs | 16 hrs | 10 hrs | 78 hrs |
| **Frontend Engineer** | 0 hrs | 0 hrs | 0 hrs | 24 hrs | 8 hrs | 4 hrs | 36 hrs |
| **QA Engineer** | 0 hrs | 16 hrs | 8 hrs | 8 hrs | 16 hrs | 8 hrs | 56 hrs |
| **Engineering Manager** | 5 hrs | 5 hrs | 5 hrs | 5 hrs | 5 hrs | 5 hrs | 30 hrs |
| **Total** | **45 hrs** | **97 hrs** | **51 hrs** | **85 hrs** | **65 hrs** | **43 hrs** | **386 hrs** |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Meta webhook 20s SLA breach | Medium | High | minInstances=5, load test at 2× peak |
| Message loss during cutover | Low | Critical | Mirror traffic, verify counts, DLQ |
| Scheduled function cost overrun | Medium | Medium | Adaptive schedules, budget alerts |
| RTDB trigger infinite loops | Low | High | Idempotency keys, change detection |
| Cold start latency spikes | Medium | Medium | minInstances on critical paths |
| Secret rotation failure | Low | High | Automated rotation, fallback secrets |
| Team knowledge gap | Medium | Medium | Pair programming, documentation |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Migration completion** | 100% functions deployed | Function count |
| **Traffic cutover** | 100% to Functions | Cloudflare analytics |
| **Message processing parity** | 100% | Message count comparison |
| **Latency (webhook p99)** | < 500ms | Cloud Monitoring |
| **Error rate** | < 0.1% | Cloud Monitoring |
| **Monthly Functions cost** | < $50 | Billing export |
| **Ops time reduction** | > 90% | Time tracking |
| **Team satisfaction** | > 4/5 | Survey |

---

## Communication Plan

| Audience | Channel | Frequency | Content |
|----------|---------|-----------|---------|
| **Engineering Team** | Slack #migration | Daily | Standup updates, blockers |
| **Engineering Lead** | Email | Weekly | Progress report, risks |
| **Product/Business** | Email | Bi-weekly | Timeline, impact |
| **On-call** | PagerDuty | Real-time | Alerts, incidents |
| **All Hands** | Meeting | Month-end | Demo, retrospective |

---

## Post-Migration: Continuous Improvement

### Month 1
- [ ] Optimize cold starts (minInstances tuning)
- [ ] Reduce scheduled function invocations further
- [ ] Implement structured logging correlation IDs

### Month 2
- [ ] Migrate remaining Baileys bots to Cloud Run (if needed)
- [ ] Implement Meta billing reconciliation automation
- [ ] Add distributed tracing (OpenTelemetry)

### Month 3
- [ ] Cost optimization review
- [ ] Performance benchmarking
- [ ] Architecture decision records (ADRs)