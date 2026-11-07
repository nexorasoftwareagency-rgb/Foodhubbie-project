// Single source of truth for billing defaults (CommonJS for bot-control-api)
// Used by: SupremeAdmin onboarding wizard, bot-control-api onboarding endpoint
//
// Pricing (FINAL, 2026-11-02): 'percentage' is the default mode —
// WhatsApp-based 3% · Customer App 2% · POS + QR menu 1% · unknown 3% (see shared/cost-math.js).
// The `rates` row below is only read by the legacy 'per_order' mode.
// Setup fee was removed 2026-11-01 (wallet-minimum model): new outlets start
// with amount 0 / status 'none'. Existing rows keep their stored setup record.

function getBillingDefaults() {
  const now = new Date().toISOString();
  return {
    mode: 'percentage', // percentage package: QR/POS 1%, Customer App 2%, WhatsApp 3%
    rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 0, status: 'none', date: now },
    tokens: { balance: 15, updatedAt: now },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: now, grantedBy: 'system' } },
    // Per-tenant Meta message caps (S1 liability guard) — must match
    // shared/billing-defaults.js; bot/transport.js reads these before a send.
    messageCaps: { monthlyPaise: 500000, dailyPaise: 50000, maxMessages: 10000 },
    metaSpendThresholdPaise: 10000, // ₹100 - bot stops if balance < this
  };
}

function getBillingDefaultsForClient() {
  // For client-side (uses firebase.database.ServerValue.TIMESTAMP)
  return {
    mode: 'percentage', // percentage package: QR/POS 1%, Customer App 2%, WhatsApp 3%
    rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 0, status: 'none', date: new Date().toISOString() },
    tokens: { balance: 15, updatedAt: firebase.database.ServerValue.TIMESTAMP },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: firebase.database.ServerValue.TIMESTAMP, grantedBy: 'system' } },
    // Kept identical to the ESM getBillingDefaults() above.
    messageCaps: { monthlyPaise: 500000, dailyPaise: 50000, maxMessages: 10000 },
    metaSpendThresholdPaise: 10000, // ₹100 - bot stops if balance < this
  };
}

module.exports = { getBillingDefaults, getBillingDefaultsForClient };