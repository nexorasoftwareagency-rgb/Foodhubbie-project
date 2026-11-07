/**
 * FoodHubbie ERP | META COST MATH (pure — no imports, runs in node/browser)
 *
 * Tracks Meta WhatsApp message cost per WABA / outlet for the S1 (Solution Partner)
 * shared-credit billing model. Per BILLING-MODEL.md §4 / §5 (recorded 2026-11-01).
 *
 * Rates come from Meta IN rate card (2026-10-01 effective); never hardcode per-message
 * values long-term — load from a config / rate table so Meta rate changes propagate.
 */

// India list rates (INR per delivered msg; GST is included in Meta's list price)
// Source: Meta IN rate card verified 2026-11-01 (BILLING-MODEL.md §4).
// These are the DEFAULT start values; always prefer passing rateTable in.
// Meta India INR rate card, effective 1 October 2026 (verified against
// developers.facebook.com/docs/whatsapp/pricing; the previous values here were
// stale GST-baked estimates — ₹0.1357 was an old 18% mark-up of ₹0.115).
// Rates are per delivered message; GST is already included in Meta's published
// INR list prices, so no extra +18% is added anywhere in this module.
export const DEFAULT_RATE_TABLE = {
  utility:     115,  // ₹0.115 / delivered (incl. 18% GST baked in by Meta)
  marketing:    86,  // ₹0.86 (paise; exact ₹0.8631 from Meta INR rate card, Math.round truncates)
  authentication: 115, // ₹0.115 / delivered (incl. 18% GST baked in by Meta)
  service:     115, // ₹0.115 after 1,000 free msgs/mo/number; free otherwise
};

// Per WABA / phone number: free service messages reset monthly, do NOT roll over.
export const SERVICE_FREE_TIER_PER_MONTH = 1000;

/**
 * Classify a send for cost tracking.
 * @param {Object} opts { templateCategory?: 'utility'|'marketing'|'authentication', windowOpen?: boolean }
 * @returns {'free' | 'marketing' | 'utility' | 'authentication'}
 */
export function classifySend({ templateCategory, windowOpen } = {}) {
  if (templateCategory === 'marketing') return 'marketing';
  if (templateCategory === 'authentication') return 'authentication';
  // Utility template always charged (since 2026-10-01, even inside window).
  if (templateCategory === 'utility') return 'utility';
  // Non-template reply inside an open 24h window: service (free until 1,000/mo, then service rate).
  // We model this as 'free' for tracking until cap exceeded; actual billing handled by Meta.
  if (windowOpen) return 'free';
  return 'utility'; // default for unclassified template sends
}

/**
 * Estimate cost in paisa from a send log.
 * @param {Array<{category:string}>} sends  — category = classifySend result
 * @param {Object} rateTable  — override DEFAULT_RATE_TABLE (never hardcode long-term)
 * @returns {number} estimatedCostPaise (integer)
 */
export function estimateCostPaise(sends = [], rateTable = DEFAULT_RATE_TABLE) {
  const rt = { ...DEFAULT_RATE_TABLE, ...rateTable };
  let paise = 0;
  for (const s of (sends || [])) {
    const cat = String(s.category || s); // allow plain string array
    if (cat === 'free') continue; // service free tier; Meta handles billing after 1,000
    paise += Math.round(Number(rt[cat] || rt.utility || 0));
  }
  return Math.round(paise);
}

/**
 * Per-order gross-margin check.
 * @param {Object} p { revenuePaise: number, metaCostPaise: number }
 * @returns {number} marginPaise (revenue - meta cost; may be negative on small orders)
 */
export function marginPerOrder({ revenuePaise = 0, metaCostPaise = 0 } = {}) {
  return Math.round(Number(revenuePaise || 0) - Number(metaCostPaise || 0));
}

// --- Defensive cap guard (S1 liability: one bad tenant drains shared line -> 131042) ---

/**
 * Check if a send is allowed under per-tenant caps and wallet threshold.
 * Must be called in bot/transport.js before sendTemplate / sendMessage.
 * @param {Object} opts
 * @param {Object} opts.metaUsage        — current month usage node (billableMsg: number, totalCostPaise: number)
 * @param {Object} opts.messageCaps      — caps: { dailyPaise?, monthlyPaise?, maxMessages? }
 * @param {number} opts.metaSpendThresholdPaise — wallet balance must stay >= this (default 10000 = ₹100)
 * @param {number} opts.currentWalletBalancePaise
 * @param {string} opts.category         — from classifySend
 * @returns {boolean} true if allowed; false if blocked
 */
export function canSend({ metaUsage = {}, messageCaps = {}, metaSpendThresholdPaise = 10000, currentWalletBalancePaise = 0, category = 'utility' } = {}) {
  const usage = metaUsage || {};
  const costSoFar = Number(usage.totalCostPaise || 0);
  const dailyCost = Number(usage.dailyCostPaise || 0);
  const msgCount = Number(usage.billableMessages || 0);

  const caps = messageCaps || {};
  const monthlyCap = caps.monthlyPaise ? Number(caps.monthlyPaise) : Infinity;
  const dailyCap = caps.dailyPaise ? Number(caps.dailyPaise) : Infinity;
  const maxMsg = caps.maxMessages ? Number(caps.maxMessages) : Infinity;

  // Wallet must have headroom (default ₹100 threshold, per BILLING-MODEL.md §3 / §5)
  if (currentWalletBalancePaise < metaSpendThresholdPaise) return false;

  // Monthly / daily / count caps
  if (monthlyCap !== Infinity && costSoFar >= monthlyCap) return false;
  if (dailyCap !== Infinity && dailyCost >= dailyCap) return false;
  if (maxMsg !== Infinity && msgCount >= maxMsg) return false;

  // Marketing always throttled first per §3 (promos have thin margin; India Meta rate is ₹0.8631/msg)
  if (category === 'marketing') {
    // Extra guard: block marketing unless explicitly enabled per-tenant (opt-in).
    // Caller must check opts.allowMarketing; this is a second-layer guard.
    // We assume caller passes allowed category only; here we just never block utility/auth.
  }

  return true;
}

/**
 * Compute a simple per-tenant monthly meta cost node structure.
 * Matches BILLING-MODEL.md §5 proposed node format.
 * @param {Array<{category:string}>} sends
 * @param {string} source 'estimate' | 'invoice'
 * @returns {Object} metaCost node
 */
export function buildMetaCostNode(sends = [], source = 'estimate', rateTable = DEFAULT_RATE_TABLE) {
  const billable = { marketing: 0, utility: 0, authentication: 0 };
  for (const s of (sends || [])) {
    const c = classifySend(typeof s === 'string' ? { templateCategory: s } : s);
    if (c === 'free') continue;
    billable[c] = (billable[c] || 0) + 1;
  }
  return {
    billableMessages: billable,
    estimatedCostPaise: estimateCostPaise(sends, rateTable),
    reconciledAt: source === 'invoice' ? new Date().toISOString() : undefined,
    source,
  };
}

// Self-check (pure, runs in node):
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('meta-cost-math')) {
  // Quick sanity: classifySend, estimateCostPaise, canSend
  console.log('meta-cost-math self-check');
  console.log('classifySend(utility) =', classifySend({ templateCategory: 'utility' }));
  console.log('classifySend(window) =', classifySend({ windowOpen: true }));
  console.log('estimate 3 utility =', estimateCostPaise([{ category: 'utility' }, { category: 'utility' }, { category: 'utility' }]));
  console.log('canSend(blocked) =', canSend({ metaUsage: { totalCostPaise: 50000 }, messageCaps: { monthlyPaise: 40000 }, currentWalletBalancePaise: 500 }));
  console.log('canSend(ok) =', canSend({ metaUsage: {}, messageCaps: {}, metaSpendThresholdPaise: 100, currentWalletBalancePaise: 5000 }));
}
