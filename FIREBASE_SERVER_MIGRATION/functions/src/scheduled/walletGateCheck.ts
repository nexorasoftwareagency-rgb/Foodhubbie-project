/**
 * Wallet Gate Check (Scheduled Function)
 * 
 * Adaptive wallet gate publisher:
 * - Armed outlets (wallet.enforce=true): checked every minute
 * - Disarmed outlets: checked every 30 minutes
 * - Only writes to RTDB when gate value changes
 * - Uses live order mirror for armed outlets (RTDB listener)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, walletBillingRef } from '../shared/firebase/admin';
import { computeWallet, walletGate } from '../shared/wallet/compute';
import type { WalletData } from '../shared/types';

const DEMO_BID = 'foodhubbie-demo';
const INTERVAL_MINUTES = 1;
const DISARMED_CHECK_INTERVAL = 30; // Check disarmed outlets every 30 runs

// Live order mirrors for armed outlets
const orderMirrors = new Map<string, { 
  orders: Record<string, any>; 
  ref: any; 
  ready: Promise<void>;
  listener: any;
}>();

// Initialize admin
initializeAdmin().catch(err => {
  logger.error('[WalletGate] Admin init failed', { error: err.message });
});

/**
 * Get or create live order mirror for outlet
 */
async function getOrderMirror(db: any, bid: string, oid: string): Promise<Record<string, any>> {
  const key = `${bid}/${oid}`;
  let mirror = orderMirrors.get(key);
  
  if (mirror) {
    await mirror.ready;
    return mirror.orders;
  }
  
  const ref = db.ref(`businesses/${bid}/outlets/${oid}/orders`);
  const newMirror = { 
    orders: {}, 
    ref, 
    ready: Promise.resolve(),
    listener: null 
  };
  
  let resolveReady: () => void;
  newMirror.ready = new Promise(resolve => { resolveReady = resolve; });
  
  newMirror.listener = (snap: any) => {
    newMirror.orders = snap.val() || {};
    if (resolveReady) {
      resolveReady();
      resolveReady = () => {};
    }
  };
  
  orderMirrors.set(key, newMirror);
  
  try {
    ref.on('value', newMirror.listener, (err: Error) => {
      logger.error('[WalletGate] Order listener error', { key, error: err.message });
      releaseMirror(key);
    });
  } catch (err) {
    logger.error('[WalletGate] Failed to attach listener', { key, error: (err as Error).message });
    releaseMirror(key);
  }
  
  // Wait for first snapshot (with timeout)
  try {
    await Promise.race([
      newMirror.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Order snapshot timeout')), 20000))
    ]);
  } catch (err) {
    releaseMirror(key);
    throw err;
  }
  
  return newMirror.orders;
}

/**
 * Release order mirror
 */
function releaseMirror(key: string): void {
  const mirror = orderMirrors.get(key);
  if (mirror) {
    orderMirrors.delete(key);
    try { mirror.ref.off('value', mirror.listener); } catch {}
  }
}

/**
 * Check if outlet is armed (wallet.enforce === true)
 */
async function isOutletArmed(db: any, bid: string, oid: string): Promise<boolean> {
  if (bid === DEMO_BID) return false;
  
  try {
    const snap = await db.ref(`businesses/${bid}/outlets/${oid}/billing/wallet/enforce`).once('value');
    return snap.val() === true;
  } catch {
    return false;
  }
}

/**
 * Publish wallet gate for single outlet
 */
async function publishWalletGate(db: any, bid: string, oid: string, armed: boolean, orders: Record<string, any>): Promise<{ gate: string; balance: number }> {
  // Get billing data from walletBilling (server-only root)
  const billingSnap = await walletBillingRef(bid, oid).once('value');
  const billing = billingSnap.val() || null;
  
  let nextGate = '';
  let balance = 0;
  
  if (armed) {
    // Get campaigns for promo cost calculation
    const campSnap = await db.ref(`businesses/${bid}/outlets/${oid}/bot/promotions/campaigns`).once('value').catch(() => null);
    const campaigns = campSnap?.val() || {};
    
    // Check if outlet has WhatsApp
    const waSnap = await db.ref(`businesses/${bid}/outlets/${oid}/whatsapp`).once('value').catch(() => null);
    const hasWhatsApp = !!(waSnap?.val()?.phoneNumberId);
    
    // Compute wallet
    const wallet = computeWallet({
      billing,
      orders,
      campaigns,
      hasWhatsApp,
    });
    
    nextGate = wallet.walletGate;
    balance = wallet.balance;
  } else {
    // Disarmed or demo - clear gate and release mirror
    nextGate = '';
    balance = 0;
    releaseMirror(`${bid}/${oid}`);
  }
  
  // Only write if changed
  const gateRef = db.ref(`businesses/${bid}/outlets/${oid}/walletGate`);
  const currentSnap = await gateRef.once('value');
  const current = currentSnap.exists() ? String(currentSnap.val() || '').trim().toLowerCase() : '';
  
  if (nextGate !== current) {
    if (nextGate) {
      await gateRef.set(nextGate);
    } else {
      await gateRef.remove();
    }
    logger.info('[WalletGate] Published', { bid, oid, gate: nextGate || 'open', balance });
  }
  
  return { gate: nextGate, balance };
}

/**
 * Main scheduled function - runs every minute
 */
export const walletGateCheck = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Asia/Kolkata',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
  secrets: ['FIREBASE_DATABASE_URL'],
}, async () => {
  const db = getDB();
  const runNumber = Math.floor(Date.now() / 60000);
  const checkDisarmed = runNumber % DISARMED_CHECK_INTERVAL === 0;
  
  logger.info('[WalletGate] Starting check', { runNumber, checkDisarmed });
  
  try {
    // Get all outlets from outletIndex
    const indexSnap = await db.ref('outletIndex').once('value');
    const index = indexSnap.val() || {};
    
    const outlets: Array<{ bid: string; oid: string }> = [];
    
    for (const [oid, meta] of Object.entries(index)) {
      const bid = typeof meta === 'string' ? meta : (meta as any)?.bid;
      if (bid) {
        outlets.push({ bid, oid });
      }
    }
    
    logger.info('[WalletGate] Outlets found', { count: outlets.length, checkDisarmed });
    
    // Process outlets
    let armedCount = 0;
    let processed = 0;
    let changed = 0;
    const errors: string[] = [];
    
    // Process in batches of 10 to avoid overwhelming
    for (let i = 0; i < outlets.length; i += 10) {
      const batch = outlets.slice(i, i + 10);
      
      await Promise.all(batch.map(async ({ bid, oid }) => {
        try {
          const armed = await isOutletArmed(db, bid, oid);
          
          if (armed) {
            armedCount++;
            const orders = await getOrderMirror(db, bid, oid);
            const result = await publishWalletGate(db, bid, oid, true, orders);
            if (result.gate) changed++;
          } else if (checkDisarmed) {
            const result = await publishWalletGate(db, bid, oid, false, {});
            if (result.gate) changed++;
          }
          processed++;
        } catch (error) {
          errors.push(`${bid}/${oid}: ${(error as Error).message}`);
          logger.error('[WalletGate] Outlet error', { bid, oid, error: (error as Error).message });
        }
      }));
    }
    
    logger.info('[WalletGate] Check completed', { 
      processed, 
      armed: armedCount, 
      changed, 
      errors: errors.length 
    });
    
    // Record metrics
    try {
      const { recordMetric } = await import('../shared/utils/metrics');
      await recordMetric('wallet_gate_checks_total', processed);
      await recordMetric('wallet_gate_armed_outlets', armedCount);
      await recordMetric('wallet_gate_changes', changed);
      if (errors.length > 0) {
        await recordMetric('wallet_gate_errors', errors.length);
      }
    } catch {}
    
  } catch (error) {
    logger.error('[WalletGate] Fatal error', { error: (error as Error).message });
    throw error;
  }
});

/**
 * Manual wallet gate publish (callable)
 */
export async function publishWalletGateForOutlet(bid: string, oid: string): Promise<{ gate: string; balance: number }> {
  const db = getDB();
  const armed = await isOutletArmed(db, bid, oid);
  
  let orders: Record<string, any> = {};
  if (armed) {
    orders = await getOrderMirror(db, bid, oid);
  }
  
  return publishWalletGate(db, bid, oid, armed, orders);
}

// Export for testing
export { getOrderMirror, isOutletArmed, publishWalletGate, releaseMirror };