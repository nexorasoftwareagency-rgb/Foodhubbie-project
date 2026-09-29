// Single source of truth for billing defaults (ESM for browser: SupremeAdmin wizard)
// Used by: SupremeAdmin onboarding wizard — build.mjs emits this file into every
// dist as dist/shared/billing-defaults.js (root shared/ overwrites src copies).
// Keep in lockstep with billing-defaults.cjs (server: bot-control-api).

export function getBillingDefaults() {
  return {
    mode: 'per_order',
    rates: { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 500, status: 'non_refundable', date: new Date().toISOString() },
    tokens: { balance: 15, updatedAt: firebase.database.ServerValue.TIMESTAMP },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: firebase.database.ServerValue.TIMESTAMP, grantedBy: 'system' } },
  };
}
