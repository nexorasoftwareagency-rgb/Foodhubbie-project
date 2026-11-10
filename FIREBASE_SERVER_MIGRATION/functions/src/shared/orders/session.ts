/**
 * Session Management
 * Handles customer session state for WhatsApp ordering
 */

import { getDB, outletRef } from '../firebase/admin';
import { normalizePhone, getISTDateInfo, generateCorrelationId } from '../utils';
import { getSecret } from '../config/secrets';

export interface SessionData {
  phone: string;
  name?: string;
  state: 'START' | 'MENU' | 'CART' | 'CHECKOUT' | 'PAYMENT' | 'AWAITING_PAYMENT' | 'SUPPORT' | 'COMPLETED';
  cart: CartItem[];
  cartTotal: number;
  tableId?: string;
  sessionId?: string;
  role?: 'customer' | 'admin' | 'staff';
  hasActiveOrder: boolean;
  lastActivity: number;
  createdAt: number;
  updatedAt: number;
  language?: string;
  context?: Record<string, any>;
}

export interface CartItem {
  dishId: string;
  name: string;
  quantity: number;
  price: number;
  size?: string;
  addons?: Array<{ id: string; name: string; price: number }>;
  comboId?: string;
  isCombo?: boolean;
  comboQuantity?: number;
}

/**
 * Get or create session for customer
 */
export async function getOrCreateSession(
  businessId: string,
  outlet: string,
  phone: string,
  name?: string
): Promise<SessionData> {
  const db = getDB();
  const normalizedPhone = normalizePhone(phone);
  const sessionRef = outletRef(businessId, outlet, 'sessions', normalizedPhone);
  
  const snap = await sessionRef.once('value');
  let session = snap.val() as SessionData | null;
  
  if (!session) {
    // Create new session
    const now = Date.now();
    session = {
      phone: normalizedPhone,
      name: name || 'Customer',
      state: 'START',
      cart: [],
      cartTotal: 0,
      role: 'customer',
      hasActiveOrder: false,
      lastActivity: now,
      createdAt: now,
      updatedAt: now,
      language: 'en',
      context: {},
    };
    
    await sessionRef.set(session);
    logger.info('[Session] Created new session', { businessId, outlet, phone: maskPhone(normalizedPhone) });
  } else {
    // Update last activity
    await sessionRef.update({ 
      lastActivity: Date.now(),
      updatedAt: Date.now(),
      ...(name && !session.name ? { name } : {}),
    });
    session.lastActivity = Date.now();
    session.updatedAt = Date.now();
  }
  
  return session!;
}

/**
 * Get existing session
 */
export async function getSession(
  businessId: string,
  outlet: string,
  phone: string
): Promise<SessionData | null> {
  const db = getDB();
  const normalizedPhone = normalizePhone(phone);
  const snap = await outletRef(businessId, outlet, 'sessions', normalizedPhone).once('value');
  return snap.val() as SessionData | null;
}

/**
 * Update session state
 */
export async function updateSessionState(
  businessId: string,
  outlet: string,
  phone: string,
  state: SessionData['state'],
  updates: Partial<SessionData> = {}
): Promise<void> {
  const db = getDB();
  const normalizedPhone = normalizePhone(phone);
  
  await outletRef(businessId, outlet, 'sessions', normalizedPhone).update({
    state,
    ...updates,
    updatedAt: Date.now(),
  });
}

/**
 * Update session cart
 */
export async function updateSessionCart(
  businessId: string,
  outlet: string,
  phone: string,
  cart: CartItem[]
): Promise<void> {
  const db = getDB();
  const normalizedPhone = normalizePhone(phone);
  
  const total = cart.reduce((sum, item) => 
    sum + (item.price * item.quantity) + 
    (item.addons?.reduce((s, a) => s + a.price * item.quantity, 0) || 0), 0
  );
  
  await outletRef(businessId, outlet, 'sessions', normalizedPhone).update({
    cart,
    cartTotal: total,
    updatedAt: Date.now(),
  });
}

/**
 * Add item to cart
 */
export async function addToCart(
  businessId: string,
  outlet: string,
  phone: string,
  item: CartItem
): Promise<SessionData> {
  const session = await getSession(businessId, outlet, phone);
  if (!session) throw new Error('Session not found');
  
  const cart = [...(session.cart || []), item];
  await updateSessionCart(businessId, outlet, phone, cart);
  
  return { ...session, cart, cartTotal: cart.reduce((s, i) => s + i.price * i.quantity, 0) };
}

/**
 * Update cart item quantity
 */
export async function updateCartQuantity(
  businessId: string,
  outlet: string,
  phone: string,
  itemIndex: number,
  quantity: number
): Promise<void> {
  const session = await getSession(businessId, outlet, phone);
  if (!session) throw new Error('Session not found');
  
  const cart = [...session.cart];
  if (cart[itemIndex]) {
    cart[itemIndex].quantity = Math.max(1, quantity);
    await updateSessionCart(businessId, outlet, phone, cart);
  }
}

/**
 * Remove item from cart
 */
export async function removeFromCart(
  businessId: string,
  outlet: string,
  phone: string,
  itemIndex: number
): Promise<void> {
  const session = await getSession(businessId, outlet, phone);
  if (!session) throw new Error('Session not found');
  
  const cart = [...session.cart];
  cart.splice(itemIndex, 1);
  await updateSessionCart(businessId, outlet, phone, cart);
}

/**
 * Clear cart
 */
export async function clearCart(
  businessId: string,
  outlet: string,
  phone: string
): Promise<void> {
  const db = getDB();
  const normalizedPhone = normalizePhone(phone);
  
  await outletRef(businessId, outlet, 'sessions', normalizedPhone).update({
    cart: [],
    cartTotal: 0,
    state: 'MENU',
    updatedAt: Date.now(),
  });
}

/**
 * Set table ID for session
 */
export async function setSessionTable(
  businessId: string,
  outlet: string,
  phone: string,
  tableId: string
): Promise<void> {
  await updateSessionState(businessId, outlet, phone, 'MENU', { tableId });
}

/**
 * Mark session as having active order
 */
export async function setActiveOrder(
  businessId: string,
  outlet: string,
  phone: string,
  hasOrder: boolean
): Promise<void> {
  await updateSessionState(businessId, outlet, phone, 'MENU', { hasActiveOrder: hasOrder });
}

/**
 * Clean up old sessions (run via scheduled function)
 */
export async function cleanupOldSessions(
  businessId: string,
  outlet: string,
  maxAgeHours: number = 24
): Promise<number> {
  const db = getDB();
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  
  const snap = await outletRef(businessId, outlet, 'sessions').once('value');
  const sessions = snap.val() || {};
  
  let deleted = 0;
  const updates: Record<string, any> = {};
  
  for (const [phone, session] of Object.entries(sessions)) {
    const s = session as SessionData;
    if (s.lastActivity < cutoff && !s.hasActiveOrder) {
      updates[phone] = null;
      deleted++;
    }
  }
  
  if (deleted > 0) {
    await outletRef(businessId, outlet, 'sessions').update(updates);
    logger.info('[Session] Cleaned up old sessions', { businessId, outlet, deleted });
  }
  
  return deleted;
}

/**
 * Get session for QR/table ordering
 */
export async function getOrCreateTableSession(
  businessId: string,
  outlet: string,
  tableId: string,
  sessionId: string
): Promise<SessionData> {
  const db = getDB();
  const sessionRef = outletRef(businessId, outlet, 'tableSessions', sessionId);
  
  const snap = await sessionRef.once('value');
  let session = snap.val() as SessionData | null;
  
  if (!session) {
    const now = Date.now();
    session = {
      phone: `table_${tableId}`,
      name: `Table ${tableId}`,
      state: 'MENU',
      cart: [],
      cartTotal: 0,
      tableId,
      sessionId,
      role: 'customer',
      hasActiveOrder: false,
      lastActivity: now,
      createdAt: now,
      updatedAt: now,
      language: 'en',
      context: { tableId, sessionId },
    };
    
    await sessionRef.set(session);
  }
  
  return session!;
}

// Simple logger for this module
const logger = {
  info: (msg: string, meta?: any) => console.log(`[Session] ${msg}`, meta || ''),
  error: (msg: string, meta?: any) => console.error(`[Session] ${msg}`, meta || ''),
};

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.substring(0, 2)}****${phone.slice(-4)}`;
}

export default {
  getOrCreateSession,
  getSession,
  updateSessionState,
  updateSessionCart,
  addToCart,
  updateCartQuantity,
  removeFromCart,
  clearCart,
  setSessionTable,
  setActiveOrder,
  cleanupOldSessions,
  getOrCreateTableSession,
};