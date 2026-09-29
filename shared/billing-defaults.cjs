// Single source of truth for billing defaults (CommonJS for bot-control-api)
// Used by: SupremeAdmin onboarding wizard, bot-control-api onboarding endpoint

function getBillingDefaults() {
  const now = new Date().toISOString();
  return {
    mode: 'per_order',
    rates: { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 500, status: 'refundable', date: now },
    tokens: { balance: 15, updatedAt: now },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: now, grantedBy: 'system' } },
  };
}

function getBillingDefaultsForClient() {
  // For client-side (uses firebase.database.ServerValue.TIMESTAMP)
  return {
    mode: 'per_order',
    rates: { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 },
    setup: { amount: 500, status: 'refundable', date: new Date().toISOString() },
    tokens: { balance: 15, updatedAt: firebase.database.ServerValue.TIMESTAMP },
    tokenPacks: { welcome: { qty: 15, priceRs: 0, note: 'Free welcome pack', grantedAt: firebase.database.ServerValue.TIMESTAMP, grantedBy: 'system' } },
  };
}

module.exports = { getBillingDefaults, getBillingDefaultsForClient };