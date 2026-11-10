# Meta WhatsApp Cloud API Costs - Detailed Breakdown

## Pricing Reference (India, 2026)

| Category | Rate/Message | Billing Model |
|----------|--------------|---------------|
| **Marketing** | ₹0.8631 | Per delivered template message |
| **Utility** | ₹0.1150 | Per delivered template message |
| **Authentication** | ₹0.1150 | Per delivered template message |
| **Service** | ₹0.1150* | Per message (after 1,000 free/number/month) |

> *Service messages: First 1,000/month per phone number free. Effective Oct 1, 2026, service replies in 24h window also charged ₹0.115 after free tier.

---

## Volume Tier Discounts (Utility & Authentication Only)

| Monthly Volume | Discount | Effective Rate |
|----------------|----------|----------------|
| 0 - 250K | 0% | ₹0.1150 |
| 250K - 750K | 5% | ₹0.1093 |
| 750K - 2M | 10% | ₹0.1035 |
| 2M - 5M | 15% | ₹0.0978 |
| 5M - 10M | 20% | ₹0.0920 |
| 10M+ | 25% | ₹0.0863 |

> **Marketing messages have NO volume discounts.**

---

## Monthly Cost Calculation (100 Outlets × 25 WhatsApp Orders/Day)

### Base Volumes

| Category | Messages/Month | Calculation |
|----------|----------------|-------------|
| **Utility** | 675,000 | 2,500 orders/day × 9 utility/order × 30 days |
| **Authentication** | 75,000 | 2,500 orders/day × 1 auth/order × 30 days |
| **Marketing** | 22,500 | 2,500 orders/day × 0.3 marketing/order × 30 days |
| **Service (Paid)** | 50,000 | Estimated in-window replies beyond free tier |

### Tier Application

**Utility + Authentication Combined: 750,000 messages/month**
- Falls in **750K - 2M tier** → **10% discount**
- **Effective Rate: ₹0.1035/message**

**Marketing: 22,500 messages/month**
- No tier discount
- **Rate: ₹0.8631/message**

**Service: 50,000 messages/month**
- First 100,000 free (100 numbers × 1,000)
- **All 50,000 within free tier** → ₹0

---

### Monthly Cost Breakdown

| Category | Volume | Rate | Monthly Cost |
|----------|--------|------|--------------|
| **Utility** | 675,000 | ₹0.1035 | **₹69,863** |
| **Authentication** | 75,000 | ₹0.1035 | **₹7,763** |
| **Marketing** | 22,500 | ₹0.8631 | **₹19,420** |
| **Service** | 50,000 | ₹0 (free tier) | **₹0** |
| **TOTAL** | **822,500** | | **₹97,046** |

---

## Annual Cost Projection

| Month | Utility+Auth Volume | Tier | Marketing Volume | Monthly Cost | Cumulative |
|-------|---------------------|------|------------------|--------------|------------|
| 1-3 | 750K | 10% | 22.5K | ₹97,046 | ₹2.91L |
| 4-6 | 800K | 10% | 25K | ₹101,500 | ₹5.96L |
| 7-9 | 900K | 10% | 30K | ₹110,500 | ₹9.27L |
| 10-12 | 1M | 15% | 35K | ₹115,000 | **₹12.72L** |

**Annual Meta WhatsApp Cost: ~₹12.7L (≈ $15,200)**

---

## Cost Per Order

| Channel | Messages/Order | Cost/Order |
|---------|----------------|------------|
| **WhatsApp** | 10.3 | **₹6.47** |
| **QR Menu** | 0 (WhatsApp) | **₹0** (FCM only) |

> **WhatsApp channel costs ₹6.47/order in Meta fees alone.**
> QR Menu channel has **zero Meta costs** — only FCM push costs (negligible).

---

## Template Optimization Opportunities

### Current Template Count per Order: 10.3

| Template | Category | Required? | Optimization |
|----------|----------|-----------|--------------|
| Menu Catalog | Utility | ✅ Yes | Combine with Cart? |
| Cart Summary | Utility | ✅ Yes | — |
| OTP Verification | Auth | ✅ Yes | — |
| Order Confirmed | Utility | ✅ Yes | — |
| Payment Instructions | Utility | ⚠️ Optional | Merge with Confirmed? |
| Payment Received | Utility | ✅ Yes | — |
| Order Accepted | Utility | ✅ Yes | — |
| Rider Assigned | Utility | ✅ Yes | — |
| Out for Delivery | Utility | ✅ Yes | — |
| Delivered | Utility | ✅ Yes | — |
| Feedback (30%) | Marketing | ❌ Optional | **Remove or make Utility** |

### Potential Savings

| Optimization | Templates Saved | Monthly Savings |
|--------------|-----------------|-----------------|
| Merge Payment Instructions + Confirmed | 1 Utility | ₹6,986 |
| Remove Feedback (Marketing) | 0.3 Marketing | ₹5,826 |
| Combine Accepted + Rider Assigned | 1 Utility | ₹6,986 |
| **Total Potential** | **2.3 templates** | **₹19,798/mo (20%)** |

---

## Volume Tier Strategy

### Current: 750K Utility+Auth/month → 10% discount

**To reach 15% discount (2M/month):**
- Need 2.67× current volume
- 250 outlets at 25 orders/day = 1.875M/month
- 300 outlets = 2.25M/month ✅

**To reach 20% discount (5M/month):**
- 600+ outlets

### Recommendation
- **No immediate action** — 10% tier is good
- **Monitor monthly** — track combined utility+auth volume
- **At 250 outlets**, re-evaluate for 15% tier

---

## Free Tier Optimization

### Service Messages Free Tier: 100,000/month (100 numbers × 1,000)

**Current Usage: ~50,000/month (50% utilized)**

| Strategy | Impact |
|----------|--------|
| Encourage customer-initiated chats | Increases free service conversations |
| Use utility templates for proactive updates | Avoids service message charges |
| Route support to in-app chat (FCM) | Zero Meta cost |

---

## Cost Monitoring Dashboard

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| **Monthly Meta Bill** | < ₹110K | > ₹125K |
| **Utility+Auth Volume** | Track for tier | > 2M (15% tier) |
| **Marketing Volume** | < 30K | > 50K |
| **Service Paid Volume** | 0 | > 1,000 |
| **Cost per WhatsApp Order** | < ₹7 | > ₹8 |
| **Template Success Rate** | > 98% | < 95% |

### Meta Billing API Integration

```typescript
// functions/src/scheduled/metaCostPublisher.ts
// Fetch actual billing from Meta Graph API monthly
async function fetchMetaBilling(month: string): Promise<MetaBilling> {
  const response = await fetch(
    `https://graph.facebook.com/v20.0/${WABA_ID}/invoices`,
    { headers: { Authorization: `Bearer ${META_SYSTEM_USER_TOKEN}` } }
  );
  return response.json();
}
```

---

## Comparative: WhatsApp vs QR Menu Channel Costs

| Cost Component | WhatsApp Order | QR Menu Order |
|----------------|----------------|---------------|
| **Meta Template Fees** | ₹6.47 | ₹0 |
| **FCM Push** | ₹0 (included) | ~₹0.01 |
| **Payment Gateway** | ₹2-3 | ₹2-3 |
| **Firebase Functions** | ₹0.02 | ₹0.02 |
| **Total Variable Cost** | **₹8.50** | **₹2.03** |

> **QR Menu is 4× cheaper per order** in variable costs.
> **Strategic imperative:** Drive QR Menu adoption.

---

## Budget Allocation (Monthly)

| Category | Budget | Actual | Variance |
|----------|--------|--------|----------|
| **Meta WhatsApp** | ₹110,000 | ₹97,046 | -₹12,954 |
| **Firebase Functions** | ₹5,000 | ₹3,276 | -₹1,724 |
| **Firebase Hosting** | ₹1,000 | ₹420 | -₹580 |
| **Firestore/RTDB** | ₹2,000 | ₹840 | -₹1,160 |
| **Monitoring/Alerting** | ₹1,000 | ₹0 | -₹1,000 |
| **Contingency (10%)** | ₹11,900 | — | — |
| **TOTAL** | **₹130,900** | **₹101,582** | **-₹29,318** |

---

## Invoice Reconciliation

### Monthly Checklist

- [ ] Download Meta invoice from Business Manager
- [ ] Compare message counts with internal logs (`outboundTracker`)
- [ ] Verify tier discount applied correctly
- [ ] Check for unexpected marketing sends
- [ ] Reconcile service message free tier usage
- [ ] Log in `billing/metaInvoices/{month}` in RTDB
- [ ] Alert if variance > 5%

---

## Tax Implications (India)

| Component | GST Rate | Notes |
|-----------|----------|-------|
| **Meta WhatsApp Fees** | 18% (RCM) | Reverse Charge Mechanism - Meta India invoices |
| **Firebase Services** | 18% | Google India invoices |
| **Payment Gateway** | 18% | Razorpay/PhonePe |

> **Input Tax Credit available** on all B2B services. Ensure GSTIN on all invoices.