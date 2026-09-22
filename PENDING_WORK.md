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

### P1-1: Category Discounts on Table Bills (MEDIUM IMPACT) - DONE
**Problem:** Category discounts appear in Active Offers panel but silently fail (empty cart: [] passed to evaluator)
**Fix:**
- getEligibleOffersForDisplay accepts includeNonMatchingCategories parameter
- _renderTableBillOffers passes includeNonMatchingCategories: true for table bills
- Category discounts that don't match cart show 'Requires items from: [category names]' hint
- Non-matching category discounts shown as disabled with hint
- POS unchanged (default includeNonMatchingCategories=false)
**Effort:** Low | Regression Risk: Low | Compatibility: Full (POS unchanged)

### P1-2: Atomic Payment (HIGH IMPACT, ARCHITECTURAL) - DONE
**Problem:** Orders marked Paid - crash - session stays billing - orders Paid but table billing = manual cleanup
**Fix:**
- Multi-path update() already provides atomic payment (Firebase RTDB multi-path updates are atomic)
- Removed unreliable navigator.onLine check, use Firebase isConnected()
- Fixed duplicate isConnected() calls (use cached isOnline)
- Added cleanup for retry button listener in closeTableBillReview()
- Removed duplicate backfill scripts (root/Admin/) - kept only in bot/
**Effort:** Low | Regression Risk: Low | Compatibility: Full

### P1-7: Void/Refund Flow (MEDIUM IMPACT) - DONE
**Problem:** No void/refund for table bills - manual order-by-order cancellation + session reopen + analytics decrement
**Fix:**
- Added voidTableBill(tableId, groupId) to revert paid bills to billing state
- Supports both group-level and full-table voids
- Reverts order statuses from Paid ? Served via transactions
- Decrements analytics (totalOrders, totalRevenue)
- Reverts discount usage records (negative amountGiven)
- UI: 'Void Payment' button in table drawer for paid tables
- Confirmation dialog with warning
- Atomic multi-path updates via outletRef.update()
- Cleanup of connection listeners on modal close
**Effort:** Medium | Regression Risk: Low | Compatibility: Full

---

## PRIORITY ORDER (Low Regression -> High Impact)

| Order | Issue | Effort | Regression Risk | Decision |
|-------|-------|--------|-----------------|----------|
| 1 | P1-3: Manual Discount Audit | Low | None | DONE |
| 2 | P1-5: Analytics Backfill | Low | None | DONE |
| 3 | P1-6: Offline Guard | Low | None | DONE |
| 4 | P1-4: Channel Separation | Low | Low | DONE |
| 5 | P1-1: Category Discount UI | Low | Low | DONE |
| 6 | P1-2: Atomic Payment | Low | Low | DONE |
| 7 | P1-7: Void/Refund Flow | Medium | Low | DONE |

---

## CONSTRAINTS
- NO Cloud Functions / Cloud Run / Server-side code
- NO EC2 for backend logic (EC2 only for WhatsApp bot + Delivery flow)
- Client-side Firebase SDK only (runTransaction, update, onValue)
- All changes in Admin JS / Bot JS / index.html / style.css
- Firebase Realtime Database only (no Firestore)
