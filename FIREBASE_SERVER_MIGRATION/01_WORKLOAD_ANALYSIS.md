# Workload Analysis - 100 Outlets × 50 Orders/Day

## Overview

| Metric | Value |
|--------|-------|
| **Outlets** | 100 |
| **Orders/Day/Outlet** | 50 |
| **WhatsApp Orders/Day/Outlet** | 25 |
| **QR Menu Orders/Day/Outlet** | 25 |
| **Total Orders/Day** | **5,000** |
| **Total Orders/Month** | **150,000** |
| **WhatsApp Numbers** | 100 (1 per outlet) |

---

## 📱 WhatsApp Order Flow (25 orders/day/outlet)

### Customer Journey - Message Breakdown

| Step | Trigger | Direction | Template Name | Category | Count/Order |
|------|---------|-----------|---------------|----------|-------------|
| 1 | Customer initiates | Inbound | — | Free Entry Point | 0 |
| 2 | Bot sends Menu | Outbound | `menu_catalog` | **Utility** | 1 |
| 3 | Customer selects items | Inbound | — | Interactive/Text | 0 |
| 4 | Bot sends Cart Summary | Outbound | `cart_summary` | **Utility** | 1 |
| 5 | Customer confirms | Inbound | — | Button/Text | 0 |
| 6 | Bot sends OTP | Outbound | `otp_verification` | **Authentication** | 1 |
| 7 | Customer sends OTP | Inbound | — | Text | 0 |
| 8 | Bot confirms Order | Outbound | `order_confirmed` | **Utility** | 1 |
| 9 | Bot sends Payment Info | Outbound | `payment_instructions` | **Utility** | 1 |
| 10 | Payment Webhook → Paid | Outbound | `payment_received` | **Utility** | 1 |
| 11 | Kitchen Accepts | Outbound | `order_accepted` | **Utility** | 1 |
| 12 | Rider Assigned | Outbound | `rider_assigned` | **Utility** | 1 |
| 13 | Out for Delivery | Outbound | `out_for_delivery` | **Utility** | 1 |
| 14 | Delivered | Outbound | `delivered` | **Utility** | 1 |
| 15 | Feedback Request (30%) | Outbound | `feedback_request` | **Marketing** | 0.3 |

**Total Outbound per WhatsApp Order: 10.3 messages**
- **Utility: 9**
- **Authentication: 1**
- **Marketing: 0.3**

### Monthly Volume (WhatsApp Only)

| Category | Messages/Month | Calculation |
|----------|----------------|-------------|
| **Utility** | **675,000** | 2,500 orders/day × 9 × 30 days |
| **Authentication** | **75,000** | 2,500 orders/day × 1 × 30 days |
| **Marketing** | **22,500** | 2,500 orders/day × 0.3 × 30 days |
| **Service (in-window)** | **~50,000** | Estimated customer replies |
| **Free Tier (Service)** | **100,000** | 100 numbers × 1,000/month |

---

## 🌐 QR Menu Order Flow (25 orders/day/outlet)

### Customer Journey - No WhatsApp Messages

QR Menu orders are placed via **Customer App / Web App** — **zero WhatsApp messages** for the ordering flow.

### Backend Processing (Same as WhatsApp)

| Process | Trigger | Firebase Function |
|---------|---------|-------------------|
| Order Received | HTTPS Callable | `placeOrder` |
| Payment Verification | Webhook/Callback | `verifyPayment` |
| Order Confirmed | RTDB Trigger | `onOrderStatusChange` |
| Kitchen Notification | FCM Push | `sendKitchenNotification` |
| Rider Assignment | RTDB Trigger | `onRiderAssigned` |
| Status Updates | FCM Push | `sendCustomerNotification` |
| Loyalty Accrual | RTDB Trigger | `onOrderDelivered` |

### Monthly Volume (QR Menu)

| Event | Count/Month | Notes |
|-------|-------------|-------|
| **Orders Placed** | 75,000 | 2,500/day × 30 |
| **Payment Verifications** | 75,000 | Via Razorpay/PhonePe webhook |
| **Status Changes** | 600,000 | ~8 statuses/order |
| **FCM Push Notifications** | 300,000 | Customer + Kitchen + Rider |
| **Loyalty Accruals** | 75,000 | On delivery |

---

## 🔄 Combined Monthly Workload

### Inbound Events (Trigger Functions)

| Source | Events/Month | Function Type |
|--------|--------------|---------------|
| **WhatsApp Webhook** | 12,500 inbound msgs/day × 30 = **375,000** | HTTPS |
| **QR Menu Orders** | 2,500/day × 30 = **75,000** | Callable |
| **Payment Webhooks** | 75,000 | HTTPS |
| **RTDB Order Changes** | 150,000 orders × 8 = **1,200,000** | Trigger |
| **RTDB Wallet Changes** | 100 outlets × ~1,000 = **100,000** | Trigger |
| **Promo Campaign Triggers** | ~100,000 | Trigger |
| **Scheduled Functions** | See below | Scheduled |

### Scheduled Functions Load

| Function | Frequency | Invocations/Month |
|----------|-----------|-------------------|
| **Wallet Gate** | 1 min × 100 outlets | **4,320,000** |
| **Meta Cost Publisher** | 5 min × 100 outlets | **864,000** |
| **Daily Reports** | 1/day × 100 outlets | **3,000** |
| **Weekly Reports** | 1/week × 100 outlets | **400** |
| **Monthly Reports** | 1/month × 100 outlets | **100** |
| **Promo Campaign Runner** | 15 min × 100 outlets | **2,880,000** |
| **Notification Cap Reset** | Daily (IST midnight) | **3,000** |

**Total Scheduled Invocations: ~8,067,500/month**

---

## 📊 Peak Load Analysis

### WhatsApp Webhook Peak (Lunch/Dinner Rush)

| Metric | Value |
|--------|-------|
| **Peak Hours** | 12:00-14:00, 19:00-21:00 IST |
| **Orders/Hour (Peak)** | ~1,500 (30% of daily in 2 hours) |
| **Inbound Messages/Hour** | ~7,500 (5 msg/order) |
| **Concurrent Webhook Requests** | ~50-100 (burst) |
| **Required Concurrency** | 100-200 |

### Order Processing Peak

| Metric | Value |
|--------|-------|
| **Peak Tasks/Hour** | ~7,500 (matches inbound) |
| **Avg Processing Time** | 2-3 seconds (3-5 Graph API calls) |
| **Required Task Queue Workers** | 50-100 concurrent |
| **Graph API Rate Limit** | 1,000 req/sec (Meta limit) |

### QR Menu Peak

| Metric | Value |
|--------|-------|
| **Peak Orders/Hour** | ~1,500 |
| **Concurrent HTTPS Requests** | ~200-500 |
| **Payment Webhook Burst** | ~500/min |

---

## 💾 Data Transfer Estimates

### Firebase Functions Egress

| Operation | Requests/Month | Avg Response | Monthly Egress |
|-----------|----------------|--------------|----------------|
| Webhook Receive | 375,000 | 200 bytes | 75 MB |
| Order Processor | 375,000 | 500 bytes | 188 MB |
| Callable (QR Menu) | 75,000 | 1 KB | 75 MB |
| Payment Webhooks | 75,000 | 1 KB | 75 MB |
| Scheduled Functions | 8M | 500 bytes | 4 GB |
| RTDB Triggers | 1.4M | 1 KB | 1.4 GB |
| **Total** | | | **~5.7 GB/month** |

> **Within 5 GB free tier** (barely - need monitoring)

### Meta Graph API Egress (Not billed to Firebase)

| Operation | Requests/Month | Avg Request | Monthly Egress |
|-----------|----------------|-------------|----------------|
| Send Template | 772,500 | 2 KB | 1.5 GB |
| Media Upload | ~5,000 | 500 KB | 2.5 GB |
| **Total** | | | **~4 GB/month** |

---

## 🎯 Capacity Planning Summary

| Resource | Required | Firebase Limit | Headroom |
|----------|----------|----------------|----------|
| **HTTPS Concurrency** | 200 | 1,000/function | 5× |
| **Task Queue Concurrency** | 100 | 80/instance × N | Auto-scale |
| **Scheduled Invocations** | 8M | Unlimited | ✅ |
| **RTDB Triggers** | 1.4M | Unlimited | ✅ |
| **GB-seconds** | ~2.6M | 400K free + paid | ✅ |
| **CPU-seconds** | ~1.5M | 200K free + paid | ✅ |
| **Egress** | 5.7 GB | 5 GB free | ⚠️ Monitor |

---

## 📈 Growth Projections

| Outlets | Orders/Day | Functions Cost/Mo | Meta Cost/Mo |
|---------|------------|-------------------|--------------|
| 100 (Current) | 5,000 | $39 | ₹111K |
| 250 | 12,500 | $95 | ₹278K |
| 500 | 25,000 | $185 | ₹555K |
| 1,000 | 50,000 | $365 | ₹1.11M |

> Functions cost grows sub-linearly (scheduled functions dominate, not per-order).