// Single source of truth for billing defaults (ES module for SupremeAdmin client)
// Used by: SupremeAdmin onboarding wizard

export function getBillingDefaults() {
  return {
    mode: 'per_order',
    rates: { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 500, status: 'refundable', date: new Date().toISOString() },
    tokens: { balance: 15, updatedAt: firebase.database.ServerValue.TIMESTAMP },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: firebase.database.ServerValue.TIMESTAMP, grantedBy: 'system' } },
  };
}