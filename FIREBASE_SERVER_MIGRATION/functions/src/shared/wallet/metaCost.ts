/**
 * Meta Cost Tracking
 * Records Meta WhatsApp API costs per outlet
 */

import { getDB, walletBillingRef } from '../firebase/admin';

/**
 * Record Meta API cost for an outlet
 */
export async function recordMetaCost(
  businessId: string,
  outlet: string,
  type: string
): Promise<void> {
  try {
    const db = getDB();
    const now = Date.now();
    const costPaise = type === 'template' ? 115 : type === 'text' ? 115 : 86; // Approximate paise

    // Update metaUsage in walletBilling
    const monthKey = new Date(now).toISOString().slice(0, 7);
    const usageRef = walletBillingRef(businessId, outlet, 'metaUsage', monthKey);

    await usageRef.transaction((current: any) => {
      const c = current || { billableMessages: {}, totalCostPaise: 0, lastSentAt: null, updatedAt: null };
      c.billableMessages[type] = (c.billableMessages[type] || 0) + 1;
      c.totalCostPaise += costPaise;
      c.lastSentAt = new Date(now).toISOString();
      c.updatedAt = new Date(now).toISOString();
      return c;
    });

    // Update balancePaise
    const balanceRef = walletBillingRef(businessId, outlet, 'balancePaise');
    await balanceRef.transaction((current: any) => {
      const val = typeof current === 'number' ? current : 0;
      return Math.max(0, val - costPaise);
    });
  } catch (error) {
    console.error('[MetaCost] Failed to record cost', { error: (error as Error).message });
  }
}

export default {
  recordMetaCost,
};
