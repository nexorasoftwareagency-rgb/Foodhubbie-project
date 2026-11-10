/**
 * Meta Cost Publisher (Scheduled Function)
 * 
 * Computes and publishes Meta credit balance for each outlet
 * Runs every 15 minutes (reduced from 5 min for cost optimization)
 * Writes balancePaise to walletBilling/{bid}/{oid}
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, walletBillingRef } from '../shared/firebase/admin';

const DEMO_BID = 'foodhubbie-demo';
const START_PAISE = 100000; // ₹1,000 starting credit per outlet per month
const INTERVAL_MINUTES = 15;

// Initialize admin
initializeAdmin().catch(err => {
  logger.error('[MetaCost] Admin init failed', { error: err.message });
});

/**
 * Compute balance from starting credit minus this month's meta cost
 */
function computeBalance(billing: any, metaUsage: any): number {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  const monthKey = istDate.toISOString().slice(0, 7); // YYYY-MM
  
  const usage = (metaUsage && metaUsage[monthKey]) || {};
  const totalCost = Number(usage && usage.totalCostPaise) || 0;
  
  return Math.max(0, START_PAISE - totalCost);
}

/**
 * Check if outlet should have balance published
 */
function shouldPublish(bid: string, billing: any): boolean {
  if (bid === DEMO_BID) return false;
  return !!billing; // Only publish if billing data exists
}

/**
 * Publish balance for single outlet
 */
async function publishBalance(db: any, bid: string, oid: string): Promise<number | null> {
  const billingSnap = await walletBillingRef(bid, oid).once('value');
  const billing = billingSnap.val() || null;
  
  if (!shouldPublish(bid, billing)) return null;
  
  const usageSnap = await db.ref(`walletBilling/${bid}/${oid}/metaUsage`).once('value').catch(() => null);
  const metaUsage = usageSnap?.val() || null;
  
  const balance = computeBalance(billing, metaUsage);
  
  const balanceRef = db.ref(`walletBilling/${bid}/${oid}/balancePaise`);
  
  // Only write when changed (avoid quota churn)
  const existingSnap = await balanceRef.once('value');
  const existing = Number(existingSnap.val());
  
  if (!Number.isFinite(existing) || Math.abs(existing - balance) >= 1) {
    await balanceRef.set(balance);
    logger.info('[MetaCost] Balance updated', { 
      bid, oid, balance, 
      startCredit: START_PAISE,
      monthKey: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7)
    });
  }
  
  return balance;
}

/**
 * Main scheduled function - runs every 15 minutes
 */
export const metaCostPublisher = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Asia/Kolkata',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets: ['FIREBASE_DATABASE_URL'],
}, async () => {
  const db = getDB();
  
  logger.info('[MetaCost] Starting publish pass');
  
  try {
    const indexSnap = await db.ref('outletIndex').once('value');
    const index = indexSnap.val() || {};
    
    let published = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const [oid, meta] of Object.entries(index)) {
      const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
      if (!bid) continue;
      
      try {
        const balance = await publishBalance(db, bid, oid);
        if (balance !== null) published++;
        else skipped++;
      } catch (error) {
        errors++;
        logger.warn('[MetaCost] Outlet error', { 
          bid, oid, error: (error as Error).message 
        });
      }
    }
    
    logger.info('[MetaCost] Publish completed', { published, skipped, errors });
    
    // Record metrics
    try {
      const { recordMetric } = await import('../shared/utils/metrics');
      await recordMetric('meta_cost_published', published);
      await recordMetric('meta_cost_skipped', skipped);
      await recordMetric('meta_cost_errors', errors);
    } catch {}
    
  } catch (error) {
    logger.error('[MetaCost] Fatal error', { error: (error as Error).message });
    throw error;
  }
});

/**
 * Self-check
 */
if (require.main === module) {
  const assert = require('assert');
  
  // No usage = full credit
  assert.equal(computeBalance({}, {}), START_PAISE);
  
  // Usage reduces balance
  const used = { '2026-11': { totalCostPaise: 2500 } };
  assert.equal(computeBalance({}, used), START_PAISE - 2500);
  
  // Balance floored at 0
  assert.equal(computeBalance({}, { '2026-11': { totalCostPaise: START_PAISE + 5000 } }), 0);
  
  console.log('Meta cost publisher self-check passed!');
}