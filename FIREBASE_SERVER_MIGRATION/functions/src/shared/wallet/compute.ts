/**
 * Wallet Cost Computation
 * Ported from shared/cost-math.js
 * Single source of truth for billing calculations
 */

import { getISTDateInfo } from '../utils/dates';

// ============================================
// CONFIGURATION
// ============================================

export const PERCENT_RATES = {
  APP: 2,        // Customer App orders
  WHATSAPP: 3,   // WhatsApp bot orders
  QR: 1,         // QR menu orders
  POS: 1,        // POS counter orders
  OTHER: 3,      // Unknown/unclassified
} as const;

export const PROMO_COST_PER_SEND = 1; // ₹1 per promo send (covered by prepaid tokens)
export const MIN_TOP_UP_NO_WA = 1000;      // ₹1,000
export const MIN_TOP_UP_WITH_WA = 1500;    // ₹1,500
export const SETUP_FEE = 0;                // No setup fee (new model)

export type OrderSource = 'APP' | 'WHATSAPP' | 'QR' | 'POS' | 'OTHER';

export interface BillingData {
  mode?: 'percentage' | 'per_order' | 'commission_1pct';
  rates?: Record<string, number>;
  wallet?: {
    enforce: boolean;
    minTopUp?: number;
  };
  setup?: { amount: number; status: 'none' | 'pending' | 'paid' };
  payments?: PaymentRecord[];
  charges?: ChargeRecord[];
  promoTokens?: PromoTokenData;
  metaUsage?: Record<string, MetaUsageMonth>;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: string;
  period: string;
  receivedAt: number;
  recordedBy: string;
  receiptNumber?: string;
}

export interface ChargeRecord {
  id: string;
  amount: number;
  description: string;
  period: string;
  chargedAt: number;
  type: 'platform_fee' | 'promo' | 'meta_cost' | 'other';
}

export interface PromoTokenData {
  welcome: number;
  granted: number;
  balance: number;
  used: number;
}

export interface MetaUsageMonth {
  billableMessages?: Record<string, number>;
  totalCostPaise: number;
  dailyCostPaise?: Record<string, number>;
  lastSentAt?: string;
  updatedAt?: string;
}

export interface OrderData {
  orderId: string;
  total: number;
  status: string;
  paymentStatus: string;
  source?: OrderSource;
  channel?: string;
  createdAt: number;
  tax?: number;
  discount?: number;
}

export interface CampaignData {
  id: string;
  startedAt?: number;
  createdAt?: number;
  completedAt?: number;
  totalSent: number;
  isTest?: boolean;
  testPrefix?: string;
}

export interface WalletResult {
  balance: number;
  balancePaise: number;
  received: number;
  used: number;
  pending: number;
  walletGate: 'open' | 'low' | 'closed';
  minTopUp: number;
  promoTokens: {
    issued: number;
    remaining: number;
    used: number;
  };
  promoSends: {
    sends: number;
    covered: number;
    billed: number;
    cost: number;
    per: number;
  };
  metaCost: {
    balancePaise: number;
    usage: Record<string, MetaUsageMonth>;
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Round to 2 decimal places (half-up with epsilon)
 */
export function round2(value: number): number {
  const EPSILON = 1e-10;
  return Math.round((value + EPSILON) * 100) / 100;
}

/**
 * Normalize order source to standard format
 */
export function normalizeSource(source?: string): OrderSource {
  if (!source) return 'OTHER';
  const upper = source.toUpperCase();
  if (upper === 'APP' || upper === 'CUSTOMER_APP') return 'APP';
  if (upper === 'WA' || upper === 'WHATSAPP' || upper === 'BOT') return 'WHATSAPP';
  if (upper === 'QR' || upper === 'QR_MENU' || upper === 'DINE_IN') return 'QR';
  if (upper === 'POS' || upper === 'COUNTER' || upper === 'WALKIN') return 'POS';
  return 'OTHER';
}

/**
 * Get rate for order source
 */
export function getRateForSource(source: OrderSource, billing: BillingData): number {
  // Percentage mode (new default)
  if (!billing.mode || billing.mode === 'percentage') {
    return PERCENT_RATES[source] || PERCENT_RATES.OTHER;
  }
  
  // Legacy per_order mode
  if (billing.mode === 'per_order' && billing.rates) {
    return billing.rates[source] || billing.rates.OTHER || PERCENT_RATES.OTHER;
  }
  
  // Legacy commission_1pct mode
  if (billing.mode === 'commission_1pct') {
    return 1;
  }
  
  return PERCENT_RATES[source] || PERCENT_RATES.OTHER;
}

/**
 * Check if order should be billed
 * Excludes cancelled, refunded, pending orders
 */
export function isBilledOrder(order: OrderData): boolean {
  const status = String(order.status || '').trim().toLowerCase();
  const paymentStatus = String(order.paymentStatus || '').trim().toLowerCase();
  
  // Exclude cancelled/refunded/pending
  if (['cancelled', 'refunded', 'pending'].includes(status)) return false;
  if (['cancelled', 'refunded', 'pending'].includes(paymentStatus)) return false;
  
  return true;
}

/**
 * Check if campaign should be billed
 * Excludes test campaigns
 */
export function isBilledCampaign(campaign: CampaignData): boolean {
  if (campaign.isTest === true) return false;
  if (campaign.testPrefix && String(campaign.id).startsWith(campaign.testPrefix)) return false;
  if (String(campaign.id).startsWith('test_')) return false;
  return true;
}

/**
 * Compute minimum top-up based on WhatsApp status
 */
export function minTopUpFor(hasWhatsApp: boolean): number {
  return hasWhatsApp ? MIN_TOP_UP_WITH_WA : MIN_TOP_UP_NO_WA;
}

/**
 * Get order source with channel fallback
 */
export function getOrderSource(order: OrderData): OrderSource {
  if (order.source) return normalizeSource(order.source);
  if (order.channel) return normalizeSource(order.channel);
  return 'OTHER';
}

// ============================================
// PROMO TOKEN POOL
// ============================================

/**
 * Compute promo token pool from billing data
 */
export function tokenPool(billing: BillingData): {
  issued: number;
  remaining: number;
  used: number;
} {
  const tokens = billing.promoTokens || { welcome: 0, granted: 0, balance: 0, used: 0 };
  const issued = (tokens.welcome || 0) + (tokens.granted || 0);
  const remaining = tokens.balance || 0;
  const used = Math.max(0, issued - remaining);
  return { issued, remaining, used };
}

/**
 * Compute promo send usage with prepaid token coverage
 * Applies tokens oldest-send-first
 */
export function promoSendUsage(params: {
  billing: BillingData;
  campaigns: Record<string, CampaignData>;
}): {
  sends: number;
  covered: number;
  billed: number;
  cost: number;
  per: number;
} {
  const { billing, campaigns } = params;
  
  // Get billable campaigns (exclude tests)
  const billableCampaigns = Object.values(campaigns).filter(c => isBilledCampaign(c));
  
  // Sort by start time (oldest first) for token allocation
  billableCampaigns.sort((a, b) => {
    const timeA = a.startedAt || a.createdAt || a.completedAt || 0;
    const timeB = b.startedAt || b.createdAt || b.completedAt || 0;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id).localeCompare(String(b.id));
  });
  
  const { issued, remaining } = tokenPool(billing);
  let tokensAvailable = remaining;
  let covered = 0;
  let billed = 0;
  
  for (const campaign of billableCampaigns) {
    const sends = campaign.totalSent || 0;
    const cover = Math.min(sends, tokensAvailable);
    covered += cover;
    billed += sends - cover;
    tokensAvailable = Math.max(0, tokensAvailable - cover);
  }
  
  const cost = billed * PROMO_COST_PER_SEND;
  const per = PROMO_COST_PER_SEND;
  
  return { sends: billableCampaigns.reduce((sum, c) => sum + (c.totalSent || 0), 0), covered, billed, cost, per };
}

// ============================================
// WALLET COMPUTATION
// ============================================

/**
 * Compute wallet state from billing, orders, and campaigns
 */
export function computeWallet(params: {
  billing: BillingData | null;
  orders: Record<string, OrderData>;
  campaigns: Record<string, CampaignData>;
  hasWhatsApp?: boolean;
}): WalletResult {
  const { billing, orders, campaigns, hasWhatsApp = false } = params;
  const b = billing || {};
  
  // 1. Calculate received (payments)
  const received = (b.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  
  // 2. Calculate used (order costs + promo costs + charges)
  const orderCosts = calculateOrderCosts(orders, b);
  const promoUsage = promoSendUsage({ billing: b, campaigns });
  const charges = (b.charges || []).reduce((sum, c) => sum + (c.amount || 0), 0);
  const metaCost = calculateMetaCost(b);
  
  const used = round2(orderCosts + promoUsage.cost + charges + metaCost / 100);
  
  // 3. Balance
  const balance = round2(received - used);
  const balancePaise = Math.round(balance * 100);
  
  // 4. Wallet gate
  const walletGateResult = walletGate({ balance, enforce: b.wallet?.enforce });
  
  // 5. Min top-up
  const minTopUp = minTopUpFor(hasWhatsApp);
  
  // 6. Promo tokens
  const tokens = tokenPool(b);
  
  return {
    balance,
    balancePaise,
    received,
    used,
    pending: 0, // Could calculate pending orders
    walletGate: walletGateResult,
    minTopUp,
    promoTokens: tokens,
    promoSends: promoUsage,
    metaCost: {
      balancePaise: b.metaUsage ? calculateMetaBalance(b) : 0,
      usage: b.metaUsage || {},
    },
  };
}

/**
 * Calculate order costs
 */
function calculateOrderCosts(orders: Record<string, OrderData>, billing: BillingData): number {
  let total = 0;
  
  for (const order of Object.values(orders)) {
    if (!isBilledOrder(order)) continue;
    
    const source = getOrderSource(order);
    const rate = getRateForSource(source, billing);
    const orderTotal = Number(order.total) || 0;
    const cost = round2(orderTotal * rate / 100);
    total += cost;
  }
  
  return round2(total);
}

/**
 * Calculate Meta cost in rupees
 */
function calculateMetaCost(billing: BillingData): number {
  if (!billing.metaUsage) return 0;
  
  let totalPaise = 0;
  for (const month of Object.values(billing.metaUsage)) {
    totalPaise += month.totalCostPaise || 0;
  }
  
  return totalPaise / 100;
}

/**
 * Calculate Meta balance in paise
 */
function calculateMetaBalance(billing: BillingData): number {
  // This would be computed by meta-cost-publisher
  // Return stored value or 0
  return 0;
}

/**
 * Determine wallet gate from balance
 */
export function walletGate(wallet: { balance: number; enforce?: boolean }): 'open' | 'low' | 'closed' {
  if (!wallet.enforce) return 'open';
  if (wallet.balance <= 0) return 'closed';
  if (wallet.balance < 500) return 'low'; // ₹500 threshold
  return 'open';
}

/**
 * Compute cost index (summary for dashboard)
 */
export function computeCostIndex(params: {
  billing: BillingData | null;
  orders: Record<string, OrderData>;
  campaigns: Record<string, CampaignData>;
  hasWhatsApp?: boolean;
}): {
  wallet: WalletResult;
  breakdown: {
    orders: { count: number; cost: number; bySource: Record<OrderSource, { count: number; cost: number }> };
    promos: { sends: number; covered: number; billed: number; cost: number };
    charges: number;
    metaCost: number;
  };
} {
  const wallet = computeWallet(params);
  
  const { billing, orders, campaigns } = params;
  const b = billing || {};
  
  // Order breakdown by source
  const bySource: Record<OrderSource, { count: number; cost: number }> = {
    APP: { count: 0, cost: 0 },
    WHATSAPP: { count: 0, cost: 0 },
    QR: { count: 0, cost: 0 },
    POS: { count: 0, cost: 0 },
    OTHER: { count: 0, cost: 0 },
  };
  
  let orderCount = 0;
  let orderCost = 0;
  
  for (const order of Object.values(orders)) {
    if (!isBilledOrder(order)) continue;
    
    const source = getOrderSource(order);
    const rate = getRateForSource(source, b);
    const orderTotal = Number(order.total) || 0;
    const cost = round2(orderTotal * rate / 100);
    
    bySource[source].count++;
    bySource[source].cost = round2(bySource[source].cost + cost);
    orderCount++;
    orderCost += cost;
  }
  
  const promoUsage = promoSendUsage({ billing: b, campaigns });
  const charges = (b.charges || []).reduce((sum, c) => sum + (c.amount || 0), 0);
  const metaCost = calculateMetaCost(b);
  
  return {
    wallet,
    breakdown: {
      orders: { count: orderCount, cost: round2(orderCost), bySource },
      promos: { sends: promoUsage.sends, covered: promoUsage.covered, billed: promoUsage.billed, cost: promoUsage.cost },
      charges: round2(charges),
      metaCost: round2(metaCost),
    },
  };
}

// ============================================
// SELF-CHECK
// ============================================

if (require.main === module) {
  const assert = require('assert');
  
  // Test round2
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(1.004), 1.00);
  assert.equal(round2(100/3), 33.33);
  
  // Test normalizeSource
  assert.equal(normalizeSource('app'), 'APP');
  assert.equal(normalizeSource('whatsapp'), 'WHATSAPP');
  assert.equal(normalizeSource('qr'), 'QR');
  assert.equal(normalizeSource('pos'), 'POS');
  assert.equal(normalizeSource('unknown'), 'OTHER');
  
  // Test isBilledOrder
  assert.equal(isBilledOrder({ status: 'Delivered', paymentStatus: 'Paid' } as any), true);
  assert.equal(isBilledOrder({ status: 'Cancelled', paymentStatus: 'Paid' } as any), false);
  assert.equal(isBilledOrder({ status: 'Delivered', paymentStatus: 'Refunded' } as any), false);
  assert.equal(isBilledOrder({ status: 'Pending', paymentStatus: 'Pending' } as any), false);
  
  // Test minTopUpFor
  assert.equal(minTopUpFor(false), 1000);
  assert.equal(minTopUpFor(true), 1500);
  
  // Test walletGate
  assert.equal(walletGate({ balance: 1000, enforce: true }), 'open');
  assert.equal(walletGate({ balance: 100, enforce: true }), 'low');
  assert.equal(walletGate({ balance: -50, enforce: true }), 'closed');
  assert.equal(walletGate({ balance: -50, enforce: false }), 'open');
  
  // Test promo token pool
  const billing = {
    promoTokens: { welcome: 15, granted: 10, balance: 5, used: 20 },
  };
  const pool = tokenPool(billing);
  assert.equal(pool.issued, 25);
  assert.equal(pool.remaining, 5);
  assert.equal(pool.used, 20);
  
  console.log('All wallet compute tests passed!');
}