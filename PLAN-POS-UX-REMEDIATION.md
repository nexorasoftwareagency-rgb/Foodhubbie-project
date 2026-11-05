# POS UI/UX Remediation Plan

**Source:** Code review of `Admin/js/features/pos.js`, `Admin/index.html` (POS tab), `Admin/style.css`
**Status:** Planning — not started
**Method:** One item at a time, verified with `node --check` + visual/logic review before moving to the next

---

## Items

| # | ID | Issue | Severity | File(s) | Status |
|---|----|-------|----------|---------|--------|
| 1 | POS-01 | Stale/dead CSS classes (`.pos-dish-btn`, `.walkin-dish-card`, `.dish-emoji`, `.dish-controls`, etc.) never applied to live v4 markup; OOS styles missing for v4 cards | Medium | `Admin/style.css`, `Admin/js/features/pos.js` | Done |
| 2 | POS-02 | Discount preset chips hardcoded (`₹50`, `₹100`, `10%`) instead of derived from eligible offers catalog | Low | `Admin/index.html`, `Admin/js/features/pos.js` | Done |
| 3 | POS-03 | No visual indication when editing an existing cart item (missing `editing` state class, no pre-population of size/addons/qty in modal) | Low | `Admin/js/features/pos.js`, `Admin/index.html` | Done |
| 4 | POS-04 | No keyboard shortcuts for counter POS workflow (`Enter` submit, `Esc` close, `c` clear cart) | Medium | `Admin/js/features/pos.js`, `Admin/js/ui.js` | Done |
| 5 | POS-05 | Fragile focus management in selection modal (`requestAnimationFrame` race may leave keyboard users without focus target) | Low | `Admin/js/features/pos.js` | Done |
| 6 | POS-06 | Order-ID generation logic duplicated from `menu/js/order.js` (`generateOrderId()`) — drift risk | Low | `Admin/js/features/pos.js`, `menu/js/order.js` | Deferred |
| 7 | POS-07 | `recordDiscountUsage` failure swallowed silently — discount abuse / limit exceedance undetected | Low | `Admin/js/features/pos.js` | Done |

---

## Definition of Done per item

- `node --check` passes on all touched JS files
- No regressions in existing behavior (logic identical unless intentional UX improvement)
- Git diff shows only the intended change for that item
- Item marked complete in this PLAN before starting the next

---

## Notes

- Do not batch multiple items into one commit/PR. Each item gets its own verification step.
- POS tab is live on `Admin` hosting target; changes affect the walk-in sales flow directly.
- The wallet gate (`assertWalletGate`) and outlet gate (`assertOutletEnabled`) were recently added — do not touch those.
