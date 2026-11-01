/**
 * loyalty-evaluator.js
 * -----------------------------------------------------------------------
 * Proposed starter module — mirrors the existing discount-evaluator.js
 * pattern described in the Foodhubbie README. Pure business logic, no
 * Firebase SDK calls here — the caller (bot/index.js order-status
 * listener, or Admin pos.js at checkout) passes in config + member state
 * and gets back a plain-object result it can write atomically.
 *
 * This is a DRAFT starting point, not a copy of your real codebase —
 * I don't have read access to your actual discount-evaluator.js, so I've
 * matched the schema/behavior described in the spec doc and your README's
 * documented patterns. Review against your real discount-evaluator.js
 * before merging, especially the stacking-exclusion logic.
 * -----------------------------------------------------------------------
 */

/**
 * Compute points earned for a delivered/served order.
 * @param {Object} params
 * @param {number} params.subtotalAfterDiscount - order subtotal after any coupon/discount applied
 * @param {Object} params.loyaltyConfig - the outlet's loyalty/config node
 * @param {string} params.currentTierId - member's current tier id (e.g. "bronze")
 * @returns {{ pointsEarned: number, basePoints: number, tierMultiplier: number }}
 */
function calculateEarnedPoints({ subtotalAfterDiscount, loyaltyConfig, currentTierId }) {
  if (!loyaltyConfig || loyaltyConfig.enabled === false) {
    return { pointsEarned: 0, basePoints: 0, tierMultiplier: 1 };
  }
  const tier = (loyaltyConfig.tiers || []).find(t => t.id === currentTierId) || { multiplier: 1 };
  const basePoints = Math.floor(subtotalAfterDiscount * (loyaltyConfig.pointsPerRupee || 1));
  const pointsEarned = Math.floor(basePoints * (tier.multiplier || 1));
  return { pointsEarned, basePoints, tierMultiplier: tier.multiplier || 1 };
}

/**
 * Determine the correct tier for a given lifetime spend.
 * Tiers in config should be sorted ascending by minLifetimeSpend; this
 * does not assume that and sorts defensively.
 */
function resolveTierForSpend({ lifetimeSpend, loyaltyConfig }) {
  const tiers = [...(loyaltyConfig.tiers || [])].sort(
    (a, b) => a.minLifetimeSpend - b.minLifetimeSpend
  );
  let resolved = tiers[0] || { id: "bronze", name: "Bronze", multiplier: 1 };
  for (const t of tiers) {
    if (lifetimeSpend >= t.minLifetimeSpend) resolved = t;
  }
  return resolved;
}

/**
 * Compute the maximum redeemable value for an order, applying both the
 * points-balance cap and the order-value percentage cap (Zomato-Piggybank
 * style — prevents a single large order from being heavily subsidized).
 */
function calculateMaxRedemption({ memberPoints, subtotal, loyaltyConfig }) {
  if (!loyaltyConfig || loyaltyConfig.enabled === false) {
    return { maxRedeemableValue: 0, maxRedeemablePoints: 0, eligible: false };
  }
  if (memberPoints < (loyaltyConfig.minRedeemPoints || 0)) {
    return { maxRedeemableValue: 0, maxRedeemablePoints: 0, eligible: false };
  }
  const pointsValueCap = memberPoints * (loyaltyConfig.redemptionValuePerPoint || 0.5);
  const orderPercentCap = subtotal * ((loyaltyConfig.maxRedeemPercentOfOrder || 10) / 100);
  const maxRedeemableValue = Math.min(pointsValueCap, orderPercentCap);
  const maxRedeemablePoints = Math.floor(
    maxRedeemableValue / (loyaltyConfig.redemptionValuePerPoint || 0.5)
  );
  return { maxRedeemableValue, maxRedeemablePoints, eligible: maxRedeemableValue > 0 };
}

/**
 * Validate a requested redemption (customer/staff asked to redeem N points).
 * Returns { valid, redeemedValue, error }.
 */
function validateRedemptionRequest({ requestedPoints, memberPoints, subtotal, loyaltyConfig }) {
  const { maxRedeemablePoints, eligible } = calculateMaxRedemption({
    memberPoints,
    subtotal,
    loyaltyConfig,
  });
  if (!eligible) {
    return { valid: false, redeemedValue: 0, error: "Not eligible to redeem on this order" };
  }
  if (requestedPoints > memberPoints) {
    return { valid: false, redeemedValue: 0, error: "Insufficient points balance" };
  }
  if (requestedPoints > maxRedeemablePoints) {
    return {
      valid: false,
      redeemedValue: 0,
      error: `Redemption capped at ${maxRedeemablePoints} points for this order`,
    };
  }
  const redeemedValue = requestedPoints * (loyaltyConfig.redemptionValuePerPoint || 0.5);
  return { valid: true, redeemedValue, error: null };
}

/**
 * Check whether a member's points should expire based on inactivity.
 */
function isExpired({ lastEarnedAt, loyaltyConfig, now = Date.now() }) {
  if (!lastEarnedAt || !loyaltyConfig.pointsExpiryMonths) return false;
  const msPerMonth = 30 * 24 * 60 * 60 * 1000;
  return now - lastEarnedAt > loyaltyConfig.pointsExpiryMonths * msPerMonth;
}

module.exports = {
  calculateEarnedPoints,
  resolveTierForSpend,
  calculateMaxRedemption,
  validateRedemptionRequest,
  isExpired,
};
