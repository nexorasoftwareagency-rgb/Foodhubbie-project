# Cost Optimization Strategies

## Overview

This document details cost optimization strategies for both **Firebase Functions** and **Meta WhatsApp** costs — the two dominant cost centers.

---

## Part 1: Firebase Functions Cost Optimization

### Current Projected Cost: $39.99/month (Optimized)

| Component | Monthly Cost | % of Total |
|-----------|--------------|------------|
| Webhook minInstances (5×256MB) | $29.20 | 73% |
| Task Queue Processing | $6.50 | 16% |
| Scheduled Functions | $2.00 | 5% |
| RTDB Triggers | $1.04 | 3% |
| Callable Functions | $0.25 | 1% |
| Egress/Storage | $0.04 | <1% |
| **Total** | **$39.99** | **100%** |

---

### Optimization 1: Reduce minInstances (Highest Impact)

**Current:** 5 instances × 256MB = $29.20/mo

**Options:**

| minInstances | Monthly Cost | Risk | Recommendation |
|--------------|--------------|------|----------------|
| 5 (current) | $29.20 | Very Low | Baseline |
| 3 | $17.52 | Low | **Recommended after validation** |
| 2 | $11.68 | Medium | If p99 < 200ms sustained |
| 1 | $5.84 | High | Not recommended |
| 0 | $0 | Critical | Will breach 20s SLA |

**Strategy:**
1. Start with 5 for launch
2. After 2 weeks: reduce to 3 if p99 < 300ms
3. After 1 month: reduce to 2 if p99 < 200ms
4. Monitor cold start rate daily

```typescript
// Dynamic minInstances based on time of day
// Not directly supported, but can use Cloud Scheduler to deploy config
// Or use fewer instances with higher concurrency
export const whatsappWebhook = onRequest({
  minInstances: 3,  // Reduced after validation
  maxInstances: 500,
  concurrency: 200, // Increased to compensate
}, handler);
```

**Savings: $11.68/mo (40% reduction on largest cost)**

---

### Optimization 2: Memory Right-Sizing

**Current Allocations:**

| Function | Current Memory | Recommended | Savings |
|----------|----------------|-------------|---------|
| whatsappWebhook | 256MB | 128MB* | $14.60/mo |
| processInboundMessage | 512MB | 256MB | $3.25/mo |
| sendOutboundMessage | 512MB | 256MB | $1.50/mo |
| walletGateCheck | 256MB | 128MB | $0.50/mo |
| metaCostPublisher | 256MB | 128MB | $0.20/mo |
| reports | 512MB | 256MB | $0.50/mo |

> *128MB minimum for 2nd Gen

**Validation Required:** Load test each function at lower memory

**Savings: ~$20.55/mo (if all validated)**

---

### Optimization 3: Scheduled Function Frequency Tuning

**Current Adaptive Schedule:**

| Function | Frequency | Invocations/Mo | Optimization |
|----------|-----------|----------------|--------------|
| walletGateCheck | 1min (armed) / 30min (disarmed) | ~979K | ✅ Optimal |
| metaCostPublisher | 5min | 864K | → 15min (57K) |
| promoScheduler | 15min | 2.88M* | → Event-driven (57K) |
| notificationCapReset | Daily | 3K | ✅ Optimal |

> *Fixed in optimized version

**Meta Cost Publisher: 5min → 15min**
- Meta credit changes slowly (per message)
- 15min granularity sufficient
- **Saves 576K invocations/mo**

```typescript
export const metaCostPublisher = onSchedule({
  schedule: 'every 15 minutes', // Changed from 5min
  timeZone: 'Asia/Kolkata',
}, handler);
```

**Savings: ~$0.20/mo (small but compounds)**

---

### Optimization 4: Batch RTDB Operations

**Current:** Individual writes per outlet
**Optimized:** Batch updates

```typescript
// Before: 100 outlets = 100 writes
for (const outlet of outlets) {
  await db.ref(`outlets/${outlet}/walletGate`).set(gate);
}

// After: 1 batched write
const updates = {};
for (const outlet of outlets) {
  updates[`outlets/${outlet}/walletGate`] = gate;
}
await db.ref().update(updates); // Single write
```

**Impact:** Reduces RTDB write costs (not Functions cost directly, but RTDB billing)

---

### Optimization 5: Egress Reduction

**Current:** ~5.7 GB/mo (near 5 GB free tier)

**Strategies:**
1. **Compress responses** — Enable gzip in Functions (automatic for HTTPS)
2. **Reduce log verbosity** — Structured JSON logs are verbose
3. **Filter RTDB listeners** — Use `limitToFirst`, `orderByChild`

```typescript
// Reduce log size
const logger = createLogger('webhook');
// Instead of logging full payload:
logger.info('Message received', { 
  messageId: msg.id, 
  type: msg.type,
  from: maskPhone(msg.from) 
});
// NOT: logger.info('Message received', { payload: req.body });
```

**Target:** < 4 GB/mo (20% buffer)

---

### Functions Cost Optimization Summary

| Optimization | Monthly Savings | Effort | Risk |
|--------------|-----------------|--------|------|
| minInstances 5→3 | $11.68 | Low | Low |
| minInstances 3→2 | $5.84 | Low | Medium |
| Memory 256→128MB (webhook) | $14.60 | Medium | Medium |
| Memory 512→256MB (workers) | $4.75 | Medium | Low |
| Meta Cost 5→15min | $0.20 | Low | None |
| **Total Potential** | **$33.07/mo** | | |
| **Optimized Cost** | **~$6.92/mo** | | |

> **Realistic Target: $15-20/mo** (conservative minInstances=3, memory validated)

---

## Part 2: Meta WhatsApp Cost Optimization

### Current Projected Cost: ₹97,046/month

| Category | Volume | Rate | Cost |
|----------|--------|------|------|
| Utility | 675,000 | ₹0.1035* | ₹69,863 |
| Authentication | 75,000 | ₹0.1035* | ₹7,763 |
| Marketing | 22,500 | ₹0.8631 | ₹19,420 |
| Service | 50,000 | Free tier | ₹0 |
| **Total** | **822,500** | | **₹97,046** |

> *With 10% volume discount (750K tier)

---

### Optimization 1: Template Consolidation (Highest Impact)

**Current Templates per Order: 10.3**

| Template | Category | Required | Optimization |
|----------|----------|----------|--------------|
| Menu Catalog | Utility | Yes | Keep |
| Cart Summary | Utility | Yes | Keep |
| OTP Verification | Auth | Yes | Keep |
| Order Confirmed | Utility | Yes | Keep |
| Payment Instructions | Utility | **Optional** | **Merge with Confirmed** |
| Payment Received | Utility | Yes | Keep |
| Order Accepted | Utility | Yes | Keep |
| Rider Assigned | Utility | Yes | Keep |
| Out for Delivery | Utility | Yes | Keep |
| Delivered | Utility | Yes | Keep |
| Feedback (30%) | Marketing | **Optional** | **Remove or Utility** |

**Savings Calculation:**

| Change | Templates Saved | Monthly Savings |
|--------|-----------------|-----------------|
| Merge Payment Instructions | 1 Utility × 75K = 75K | ₹7,763 |
| Remove Feedback (Marketing) | 0.3 Mktg × 75K = 22.5K | ₹19,420 |
| Combine Accepted + Rider | 1 Utility × 75K = 75K | ₹7,763 |
| **Total** | **2.3 templates** | **₹34,946/mo (36%)** |

**Implementation:**
```typescript
// Combined template: "Order Confirmed + Payment Info"
// Variables: {{1}} order_id, {{2}} amount, {{3}} payment_link
// Category: Utility (single template)
```

---

### Optimization 2: Volume Tier Advancement

**Current:** 750K Utility+Auth → 10% discount

**Target:** 2M → 15% discount (₹0.0978 vs ₹0.1035)

**Gap:** Need 1.25M more utility+auth messages/month

**Strategies:**
1. **Grow to 250 outlets** — Natural growth
2. **Add utility templates** — e.g., "Order Ready for Pickup", "Kitchen Started"
3. **QR Menu → WhatsApp fallback** — Some QR orders notify via WhatsApp

**Savings at 15% tier:** 
- Current: 750K × ₹0.1035 = ₹77,625
- At 15%: 750K × ₹0.0978 = ₹73,350
- **Savings: ₹4,275/mo** (grows with volume)

---

### Optimization 3: Free Service Tier Maximization

**Current:** 50K paid service messages (est.)

**Free Tier:** 100 numbers × 1,000 = 100,000/month

**Utilization:** 50% (50K of 100K)

**Strategies:**
1. **Route support to in-app chat** — Zero Meta cost
2. **Use utility templates for proactive updates** — Not service messages
3. **Customer-initiated conversations** — Free entry point

```typescript
// Instead of service message for "Your order is ready"
// Use utility template "order_ready_for_pickup"
await sendTemplate(to, {
  name: 'order_ready_for_pickup',
  language: 'en',
  components: [{ type: 'body', parameters: [{ type: 'text', text: orderId }] }]
});
```

**Target:** 0 paid service messages

---

### Optimization 4: Marketing Template Optimization

**Current:** 22,500 marketing messages/mo (feedback only)

**Cost:** ₹19,420/mo

**Strategies:**
1. **Remove feedback template** — Save ₹19,420
2. **If marketing needed:** Use CTA templates (same rate, better conversion)
3. **Segment audiences** — Only send to engaged users

---

### Optimization 5: Per-Outlet Template Management

**Current:** Same templates for all outlets

**Optimization:** Outlet-specific templates only where needed

```typescript
// functions/src/shared/whatsapp/templates.ts
export const OUTLET_TEMPLATES = {
  // Shared (all outlets)
  menu_catalog: { category: 'utility', required: true },
  cart_summary: { category: 'utility', required: true },
  otp_verification: { category: 'authentication', required: true },
  order_confirmed: { category: 'utility', required: true },
  payment_received: { category: 'utility', required: true },
  order_accepted: { category: 'utility', required: true },
  rider_assigned: { category: 'utility', required: true },
  out_for_delivery: { category: 'utility', required: true },
  delivered: { category: 'utility', required: true },
  
  // Optional per outlet
  payment_instructions: { category: 'utility', required: false },
  feedback: { category: 'marketing', required: false },
  promo_flash: { category: 'marketing', required: false },
};

// Only register required + outlet-opted-in templates
```

**Savings:** Avoids unused template approvals, cleaner management

---

### Meta Cost Optimization Summary

| Optimization | Monthly Savings | Annual Savings | Effort |
|--------------|-----------------|----------------|--------|
| Template consolidation (2.3 templates) | ₹34,946 | ₹419,352 | Medium |
| Volume tier advancement (at scale) | ₹4,275+ | ₹51,300+ | Low (growth) |
| Service tier maximization | ₹5,750 | ₹69,000 | Low |
| Marketing template removal | ₹19,420 | ₹233,040 | Low |
| **Total Potential** | **₹64,391/mo** | **₹772,692/yr** | |

> **Optimized Meta Cost: ₹32,655/mo (66% reduction)**

---

## Part 3: Combined Cost Projection (Optimized)

### Monthly Costs (After All Optimizations)

| Component | Current | Optimized | Savings |
|-----------|---------|-----------|---------|
| **Firebase Functions** | $39.99 | **$15-20** | $20-25 |
| **Meta WhatsApp** | ₹97,046 | **₹32,655** | ₹64,391 |
| **Firebase Hosting** | $5 | $5 | — |
| **Firestore/RTDB** | $10 | $10 | — |
| **Total (USD equiv.)** | **~$1,390** | **~$570** | **~$820 (59%)** |

### Annual Projection

| Scenario | Annual Cost | vs Current |
|----------|-------------|------------|
| **Current** | $16,680 | Baseline |
| **Functions Optimized Only** | $15,240 | -$1,440 |
| **Meta Optimized Only** | $8,940 | -$7,740 |
| **Fully Optimized** | **$6,840** | **-$9,840 (59%)** |

---

## Part 4: Implementation Priority

### Quick Wins (Week 1-2)
| Optimization | Savings | Effort |
|--------------|---------|--------|
| Remove feedback marketing template | ₹19,420/mo | 1 day |
| Maximize service free tier | ₹5,750/mo | 2 days |
| Meta Cost Publisher 5→15min | $0.20/mo | 30 min |

### Medium Term (Month 1-2)
| Optimization | Savings | Effort |
|--------------|---------|--------|
| Template consolidation (merge payment) | ₹7,763/mo | 1 week |
| Template consolidation (combine accepted+rider) | ₹7,763/mo | 1 week |
| Reduce minInstances 5→3 | $11.68/mo | 1 day (after validation) |
| Memory right-sizing | $20/mo | 1 week (testing) |

### Long Term (Quarter 1-2)
| Optimization | Savings | Effort |
|--------------|---------|--------|
| Volume tier advancement | ₹4,275+/mo | Growth-dependent |
| minInstances 3→2 | $5.84/mo | After validation |
| Advanced batching | RTDB cost | Ongoing |

---

## Monitoring Dashboard (Cost)

### Firebase Functions Cost Tracking

```sql
-- BigQuery: Daily Functions Cost
SELECT 
  DATE(usage_start_time) as day,
  SUM(CASE WHEN sku_description LIKE '%Invocation%' THEN cost END) as invocation_cost,
  SUM(CASE WHEN sku_description LIKE '%GB-Second%' THEN cost END) as gb_second_cost,
  SUM(CASE WHEN sku_description LIKE '%CPU-Second%' THEN cost END) as cpu_second_cost,
  SUM(CASE WHEN sku_description LIKE '%Min Instance%' THEN cost END) as min_instance_cost,
  SUM(cost) as total_cost
FROM `project.billing.gcp_billing_export`
WHERE service_description = 'Cloud Functions'
  AND usage_start_time >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY day
ORDER BY day DESC;
```

### Meta WhatsApp Cost Tracking

```typescript
// functions/src/scheduled/metaCostReconciliation.ts
export const reconcileMetaCosts = onSchedule({
  schedule: '0 2 1 * *', // 2 AM IST, 1st of month
  timeZone: 'Asia/Kolkata',
}, async () => {
  // 1. Fetch Meta invoice via Graph API
  const invoice = await fetchMetaInvoice(lastMonth);
  
  // 2. Calculate internal counts
  const internalCounts = await getInternalMessageCounts(lastMonth);
  
  // 3. Compare
  const variance = (invoice.amount - internalCounts.estimatedCost) / invoice.amount;
  
  if (Math.abs(variance) > 0.05) {
    await alertTeam(`⚠️ Meta cost variance: ${(variance*100).toFixed(1)}%`);
  }
  
  // 4. Store for trend analysis
  await db.ref(`billing/metaCostReconciliation/${lastMonthKey}`).set({
    metaInvoice: invoice.amount,
    internalEstimate: internalCounts.estimatedCost,
    variance,
    breakdown: internalCounts.breakdown,
    timestamp: Date.now()
  });
});
```

---

## Cost Governance Policies

### Policy 1: New Template Approval
- All new templates require **cost impact analysis**
- Marketing templates require **business justification + ROI estimate**
- Utility templates preferred over Marketing

### Policy 2: Function Deployment
- All new functions require **cost estimate** in PR description
- `minInstances > 0` requires **architect approval**
- Memory > 256MB requires **load test evidence**

### Policy 3: Monthly Cost Review
- Finance + Engineering review **first Monday of month**
- Variance > 10% triggers **root cause analysis**
- Optimization ideas tracked in backlog

### Policy 4: Quarterly Optimization Sprint
- Dedicated 1-week sprint per quarter
- Focus: Right-sizing, consolidation, tier advancement
- Target: 10% cost reduction per quarter

---

## ROI Calculation

### Investment (Migration + Optimization)

| Phase | Effort | Cost (@$100/hr) |
|-------|--------|-----------------|
| Migration (386 hrs) | 386 hrs | $38,600 |
| Optimization Sprint 1 | 80 hrs | $8,000 |
| Optimization Sprint 2 | 80 hrs | $8,000 |
| **Total Investment** | **546 hrs** | **$54,600** |

### Returns (Annual Savings)

| Source | Annual Savings |
|--------|----------------|
| Functions optimization | $240-300 |
| Meta WhatsApp optimization | $9,300+ |
| EC2 decommission (ops) | $36,000 |
| **Total Annual** | **$45,540+** |

### Payback Period

```
Investment: $54,600
Annual Savings: $45,540
Payback: 1.2 months
3-Year NPV (10% discount): ~$105,000
```

> **Strong positive ROI** — Migration pays for itself in 6 weeks.

---

## Decision Matrix: When to Stop Optimizing

| Metric | Threshold | Action |
|--------|-----------|--------|
| Functions cost < $15/mo | Achieved | Stop Functions optimization |
| Meta cost < ₹35K/mo | Achieved | Stop template consolidation |
| Optimization effort > savings | > 6 months payback | Defer |
| Team capacity < 20% | Sustained | Pause |

---

## Appendix: Cost Calculation Formulas

### Functions Cost Formula
```
Monthly Cost = 
  (Invocations - 2M) × $0.40/M
  + (GB-s - 400K) × $0.0000025
  + (CPU-s - 200K) × $0.000024
  + minInstances × 730 hrs × $/hr
  + max(0, Egress - 5GB) × $0.12/GB
  + max(0, Storage - 0.5GB) × $0.026/GB
```

### Meta WhatsApp Cost Formula
```
Monthly Cost = 
  UtilityMessages × UtilityRate(tier)
  + AuthMessages × AuthRate(tier)
  + MarketingMessages × MarketingRate
  + max(0, ServiceMessages - 100K) × ServiceRate
```

### Volume Tier Rates (India 2026)
| Tier | Utility+Auth Volume | Discount | Effective Rate |
|------|---------------------|----------|----------------|
| 1 | 0 - 250K | 0% | ₹0.1150 |
| 2 | 250K - 750K | 5% | ₹0.1093 |
| 3 | 750K - 2M | 10% | ₹0.1035 |
| 4 | 2M - 5M | 15% | ₹0.0978 |
| 5 | 5M - 10M | 20% | ₹0.0920 |
| 6 | 10M+ | 25% | ₹0.0863 |