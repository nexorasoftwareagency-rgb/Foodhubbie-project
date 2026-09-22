# PENDING WORK - P1 Issues (Prioritized)

## P1 Issues (Critical but not blocking)

### P1-3: Manual Discount Audit Trail (HIGH IMPACT, LOW EFFORT) - DONE
**Problem:** Manual discounts (flat Rs / %) have no discountId - no usage recorded in discountsUsage, no per-customer limit enforcement, no P&L visibility
**Fix:** Generate synthetic discountId: 'manual:flat' / 'manual:percent' in _billComputedDiscount, pass to recordDiscountUsage
**Effort:** Low | Regression Risk: None | Compatibility: Full (uses existing recordDiscountUsage)

### P1-5: Analytics Backfill Script (HIGH IMPACT, ONE-TIME) - DONE
**Problem:** Historical tableAnalytics.totalRevenue uses gross grandTotal, new code uses paidAmount (net) - dashboards mix gross (old) + net (new) = inflated revenue
**Fix:** One-time Node script: recompute tableAnalytics.totalRevenue from paid sessions using _effectiveTotal()
**Effort:** Low (one-time script) | Regression Risk: None (read-only + write to analytics only) | Compatibility: Full

### P1-6: Offline Payment Guard (HIGH IMPACT, LOW EFFORT) - DONE
**Problem:** Orders marked Paid - Firebase write fails - session rolls back - orders Paid but table billing = silent data drift
**Fix:** Disable Proceed if !navigator.onLine + Waiting for connection... banner
**Effort:** Low | Regression Risk: None | Compatibility: Full

### P1-4: Channel Separation for Table Billing (HIGH IMPACT, LOW EFFORT) - DONE
**Problem:** Table billing uses channel: pos = same as Walk-in POS - perCustomerLimit: 1 + channel: both usable 3x (WhatsApp + POS + Table)
**Fix:** 
- discountAllowsChannel now accepts 'table' channel
- evaluateDiscount uses separate table counter for per-customer limits (discountUsage.table)
- Table billing passes channel: 'table' and cart for category discounts
- getEligibleOffersForDisplay accepts cart for category filtering
- Category discounts now work on table bills
**Effort:** Low | Regression Risk: Low | Compatibility: Full

### P1-1: Category Discounts on Table Bills (MEDIUM IMPACT)
**Problem:** Category discounts appear in Active Offers panel but silently fail (empty cart: [] passed to evaluator)
Status: Partially fixed with _billCart() - needs verification + UI hint for unmatched categories

### P1-2: Atomic Payment (HIGH IMPACT, ARCHITECTURAL)
**Problem:** Orders marked Paid - crash - session stays billing - orders Paid but table billing = manual cleanup
Options:
- (a) Cloud Function on session.status=closed - NOT ALLOWED (no server-side)
- (b) runTransaction on session node with all sub-paths - client-side, atomic
- (c) Cloud Function on orders write + reconcile - NOT ALLOWED
Decision: Use runTransaction on session node (client-side, no server deps)
Effort: Medium | Regression Risk: Low (Firebase transactions are battle-tested)

### P1-7: Void/Refund Flow (MEDIUM IMPACT)
**Problem:** No void/refund for table bills - manual order-by-order cancellation + session reopen + analytics decrement
Effort: Medium (new feature)

---

## PRIORITY ORDER (Low Regression -> High Impact)

| Order | Issue | Effort | Regression Risk | Decision |
|-------|-------|--------|-----------------|----------|
| 1 | P1-3: Manual Discount Audit | Low | None | DONE |
| 2 | P1-5: Analytics Backfill | Low | None | DONE |
| 3 | P1-6: Offline Guard | Low | None | DONE |
| 4 | P1-4: Channel Separation | Low | Low | DONE |
| 5 | P1-1: Category Discount UI | Low | Low | NEXT |
| 6 | P1-2: Atomic Payment | Medium | Low | THEN (use runTransaction) |
| 7 | P1-7: Void/Refund | Medium | Medium | LAST |

---

## CONSTRAINTS
- NO Cloud Functions / Cloud Run / Server-side code
- NO EC2 for backend logic (EC2 only for WhatsApp bot + Delivery flow)
- Client-side Firebase SDK only (runTransaction, update, onValue)
- All changes in Admin JS / Bot JS / index.html / style.css
- Firebase Realtime Database only (no Firestore)
