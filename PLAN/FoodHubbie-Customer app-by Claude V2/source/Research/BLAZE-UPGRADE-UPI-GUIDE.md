# Firebase Blaze Upgrade — Complete Guide (UPI, India)

**Date:** 2026-09-27 · **Status:** RESEARCH COMPLETE · **Sources:** cloud.google.com/billing/docs (UPI India, payment methods, billing cycle), firebase.google.com/docs/projects/billing/firebase-pricing-plans

> Research only — no codebase changes. Companion docs: `FIREBASE-STORAGE-USAGE.md`, `PER-RESTAURANT-COST.md`.

---

## 1. What "upgrade to pay-as-you-go" actually does

- Upgrading `foodhubbie-10` to **Blaze** links the Firebase project to a **Cloud Billing account** (Google Cloud console, not the Firebase console) — from then on all usage (RTDB, Storage, Hosting) accrues to that billing account.
- **Free allowances are kept, not lost:** RTDB 1 GB storage + 10 GB/mo download, Hosting 10 GB + ~10.9 GB/mo transfer, Storage 5 GB — all stay free on Blaze; you only pay *beyond* them.
- **Budget alerts do not cap usage.** They are notifications only. A runaway script can spend real money. Set alerts at 50% / 90% / 100% of a chosen budget.
- If you are on the **$300 Google Cloud free trial**, linking its billing account auto-upgrades the project to Blaze and the credits pay the bills until they expire.

---

## 2. Why it asked for ₹1,000 first — and where to pay it

**Root cause:** for India billing addresses paying in INR, Google requires a **one-time prepayment (typically ₹500–₹1,000)** before UPI can be registered/used as the payment method on a Postpay (pay-later, monthly) Cloud Billing account. The prompt you saw is that prepayment requirement. It is **not** a Google Cloud "activation fee" — it is prepaid credit added to your balance, **refunded if unused when the account is closed**.

The upgrade flow doesn't tell you where to pay because the payment lives on a *different page*: the **Cloud Billing → Payment overview** page, under a **"Prepayment pending"** banner.

### Where exactly to pay (step-by-step)

1. Open the **Google Cloud console**: <https://console.cloud.google.com/billing> (sign in with the same Google account as Firebase).
2. Select the **Cloud Billing account** created during the upgrade (the one showing *Prepayment pending*).
3. On the **Payment overview** page, find the **"Prepayment pending" banner** → click **Pay now**.
   - (If no banner: in the **Your balance** card, click **Make a payment** / **Pay early**.)
4. On the **Make a payment** page, change **Payment method** → select **Pay with UPI**.
5. Enter the amount (the required ₹1,000, or more) → **Continue**.
6. Review → **Pay now** → **a QR code is displayed**.
7. On your phone: open your UPI app (GPay / PhonePe / Paytm / BHIM) → **scan the QR** → complete payment.
8. Balance updates → the prepayment requirement clears → UPI is now a valid payment method (auto-recurring via UPI mandate, or keep paying manually).
9. Return to Firebase console → **Upgrade** the project → it now links this billing account and Blaze activates.

**Requirements for UPI:** billing address + bank account in India, pay in INR, registered UPI account.

### After activation — gotchas

- **RBI recurring rules:** banks may decline *automatic card* charges > ₹15,000; manual UPI payment avoids this. If an automatic UPI-mandate payment fails verification, the billing account can be **suspended** (source: Google Cloud community thread, Apr 2026) — keep the prepayment topped up or pay manually each cycle.
- Verify: Firebase console → Project settings → **Usage and billing** shows *Blaze plan*; Cloud Billing → Payment overview shows active payment method.
- Immediately create a **budget alert** (Cloud Billing → Budgets & alerts, or Firebase → Usage and billing): suggested **$10 / $50 / $100** (or ₹850 / ₹4,200 / ₹8,500).

---

## 3. UPI vs alternatives

| Method | Notes |
|---|---|
| **UPI** (recommended here) | India only, INR, QR-scan payment, prepayment ₹500–1,000 first |
| Credit/debit card | Works immediately, no prepayment — but RBI >₹15k auto-decline risk |
| AutoPay (UPI mandate) | Recurring; must ensure mandate never fails or account suspends |

---

## 4. Post-upgrade checklist (for this project)

- [ ] Pay the ₹1,000 prepayment via Payment overview → Pay now → UPI QR
- [ ] Complete Blaze upgrade for `foodhubbie-10`
- [ ] Set budget alerts ($10 / $50 / $100)
- [ ] Enable Firebase Storage (bucket now provisionable on Blaze) → see `FIREBASE-STORAGE-USAGE.md`
- [ ] Re-run cost model: `node Research/scripts/cost-calc.js` → see `PER-RESTAURANT-COST.md`
