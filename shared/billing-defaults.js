// Single source of truth for billing defaults (ESM for browser: SupremeAdmin wizard)
// Used by: SupremeAdmin onboarding wizard — build.mjs emits this file into every
// dist as dist/shared/billing-defaults.js (root shared/ overwrites src copies).
// Keep in lockstep with billing-defaults.cjs (server: bot-control-api).
//
// Pricing (2026-11-01): 'percentage' is the default mode —
// Foodhubbi-App Orders 3% · WhatsApp bot 3% · POS + QR menu 1% (see shared/cost-math.js).
// The `rates` row below is only read by the legacy 'per_order' mode.

export function getBillingDefaults() {
  return {
    mode: 'percentage',
    rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 500, status: 'non_refundable', date: new Date().toISOString() },
    tokens: { balance: 15, updatedAt: firebase.database.ServerValue.TIMESTAMP },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: firebase.database.ServerValue.TIMESTAMP, grantedBy: 'system' } },
  };
}
