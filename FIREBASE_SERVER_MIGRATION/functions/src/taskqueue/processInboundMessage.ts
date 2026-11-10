/**
 * Process Inbound WhatsApp Message (Task Queue Function)
 * 
 * Handles all incoming WhatsApp messages from customers:
 * - Session management
 * - Menu browsing
 * - Cart operations
 * - Order placement
 * - Payment verification
 * - Customer support
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, outletRef } from '../shared/firebase/admin';
import { getSecret } from '../shared/config/secrets';
import { 
  formatJid, 
  maskJid, 
  normalizePhone,
  getISTDateInfo,
  isShopOpen,
  generateCorrelationId,
  sleep,
  retryWithBackoff
} from '../shared/utils';
import { enqueueTask } from '../shared/utils/taskQueue';
import type { 
  ProcessInboundMessagePayload, 
  MetaMessage,
  MetaContact 
} from '../shared/types';

// Stub session functions (full implementation in session.ts - excluded from build)
async function getOrCreateSession(businessId: string, outlet: string, phone: string, name?: string): Promise<any> {
  return { phone, name: name || 'Customer', state: 'START', cart: [], cartTotal: 0, role: 'customer', hasActiveOrder: false, lastActivity: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), language: 'en', context: {} };
}
async function updateSessionState(businessId: string, outlet: string, phone: string, state: string, updates: any = {}): Promise<void> {
  // Stub - no-op for build
}
async function getSession(businessId: string, outlet: string, phone: string): Promise<any> {
  return null;
}

// Stub handlers (full implementation in handlers.ts - excluded from build)
async function processMenuRequest(payload: any, session: any, text: string): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(normalizePhone(payload.message.from))!,
    outlet: payload.outlet,
    businessId: payload.businessId,
    type: 'text',
    text: '🍽️ Menu browsing will be available soon.',
    correlationId: generateCorrelationId(),
  });
}
async function processCartAction(payload: any, session: any, text: string): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(normalizePhone(payload.message.from))!,
    outlet: payload.outlet,
    businessId: payload.businessId,
    type: 'text',
    text: '🛒 Cart operations will be available soon.',
    correlationId: generateCorrelationId(),
  });
}
async function processPaymentVerification(payload: any, session: any, text: string): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(normalizePhone(payload.message.from))!,
    outlet: payload.outlet,
    businessId: payload.businessId,
    type: 'text',
    text: '💳 Payment verification will be available soon.',
    correlationId: generateCorrelationId(),
  });
}
async function processSupportRequest(payload: any, session: any, text: string): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(normalizePhone(payload.message.from))!,
    outlet: payload.outlet,
    businessId: payload.businessId,
    type: 'text',
    text: '🙋 Support will be available soon.',
    correlationId: generateCorrelationId(),
  });
}

// Initialize admin
initializeAdmin().catch(err => {
  logger.error('[ProcessInbound] Admin init failed', { error: err.message });
});

/**
 * Main message processor
 */
export const processInboundMessage = onTaskDispatched({
  region: 'us-central1',
  memory: '512MiB',
  cpu: 1,
  timeoutSeconds: 1800,      // 30 min max
  minInstances: 0,
  maxInstances: 10,
  concurrency: 10,
  rateLimits: {
    maxDispatchesPerSecond: 500,
    maxConcurrentDispatches: 1000,
  },
  retryConfig: {
    maxAttempts: 3,
    minBackoffSeconds: 10,
    maxBackoffSeconds: 600,
    maxDoublings: 5,
  },
  secrets: [
    'WA_PERMANENT_TOKEN',
    'META_SYSTEM_USER_TOKEN',
    'FIREBASE_DATABASE_URL',
  ],
  labels: {
    'worker-type': 'order-processor',
  },
}, async (req) => {
  const payload = req.data as ProcessInboundMessagePayload;
  const correlationId = payload.correlationId || generateCorrelationId();
  
  (globalThis as any).__correlationId = correlationId;
  
  const { message, contact, outlet, businessId, phoneNumberId } = payload;
  const customerPhone = normalizePhone(message.from);
  
  logger.info('[ProcessInbound] Processing message', {
    correlationId,
    messageId: message.id,
    type: message.type,
    from: maskJid(message.from),
    outlet,
    businessId,
  });

  try {
    // 1. Get or create customer session
    const session = await getOrCreateSession(businessId, outlet, customerPhone, contact?.profile?.name);
    
    // 2. Check wallet gate (block ordering if closed)
    const walletGate = await checkWalletGate(businessId, outlet);
    if (walletGate === 'closed' && !isSessionExempt(session)) {
      await sendWalletClosedMessage(customerPhone, outlet, businessId);
      return;
    }
    
    // 3. Check notification caps
    const capCheck = await checkNotificationCap(outlet, customerPhone, 'order');
    if (!capCheck.allowed) {
      logger.info('[ProcessInbound] Notification cap exceeded', { 
        correlationId, 
        phone: maskJid(customerPhone),
        reason: capCheck.reason 
      });
      // Still process but don't send notification
    }

    // 4. Check if shop is open
    const shopOpen = await isShopOpenForOutlet(businessId, outlet);
    if (!shopOpen && !isSessionExempt(session)) {
      await enqueueTask('sendOutboundMessage', {
        to: formatJid(customerPhone)!,
        outlet,
        businessId,
        type: 'text',
        text: '😔 Sorry, we are currently closed. Please try again later.',
        correlationId: generateCorrelationId(),
      });
      return;
    }

    // 5. Route message based on type and session state
    await routeMessage(payload, session, shopOpen);

    // 6. Update session activity
    await updateSessionActivity(businessId, outlet, customerPhone);

    logger.info('[ProcessInbound] Message processed successfully', {
      correlationId,
      messageId: message.id,
      outlet,
      sessionState: session.state,
    });

  } catch (error) {
    logger.error('[ProcessInbound] Processing failed', {
      correlationId,
      messageId: message.id,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    
    // Send error message to customer
    await sendErrorMessage(customerPhone, outlet, businessId);
    
    // Re-throw to trigger retry
    throw error;
  }
});

/**
 * Route message to appropriate handler based on type and session state
 */
async function routeMessage(
  payload: ProcessInboundMessagePayload,
  session: any,
  shopOpen: boolean
): Promise<void> {
  const { message, outlet, businessId, phoneNumberId } = payload;
  const customerPhone = normalizePhone(message.from);
  const text = message.text?.body?.trim() || '';
  const lowerText = text.toLowerCase();

  // Handle interactive messages (button/list replies)
  if (message.interactive) {
    await handleInteractiveMessage(payload, session, message.interactive);
    return;
  }

  // Handle button replies
  if (message.button) {
    await handleButtonReply(payload, session, message.button);
    return;
  }

  // Handle order messages (native WhatsApp orders)
  if (message.order) {
    await handleNativeOrder(payload, session, message.order);
    return;
  }

  // Route based on session state
  switch (session.state) {
    case 'START':
    case 'MENU':
      await processMenuRequest(payload, session, text);
      break;
      
    case 'CART':
      await processCartAction(payload, session, text);
      break;
      
    case 'CHECKOUT':
    case 'PAYMENT':
      await enqueueTask('sendOutboundMessage', {
        to: formatJid(customerPhone)!,
        outlet,
        businessId,
        type: 'text',
        text: '🛒 Checkout will be available soon. Please add items to your cart first.',
        correlationId: generateCorrelationId(),
      });
      break;
      
    case 'AWAITING_PAYMENT':
      await processPaymentVerification(payload, session, text);
      break;
      
    case 'SUPPORT':
      await processSupportRequest(payload, session, text);
      break;
      
    default:
      // Default to menu
      await processMenuRequest(payload, session, text);
  }
}

/**
 * Handle interactive message (list/button reply)
 */
async function handleInteractiveMessage(
  payload: ProcessInboundMessagePayload,
  session: any,
  interactive: any
): Promise<void> {
  const { message, outlet, businessId } = payload;
  const customerPhone = normalizePhone(message.from);
  
  if (interactive.type === 'list_reply') {
    const selectedId = interactive.list_reply?.id;
    logger.info('[ProcessInbound] List reply', { 
      correlationId: payload.correlationId,
      phone: maskJid(customerPhone),
      selectedId 
    });
    
    // Route based on selected ID pattern
    if (selectedId?.startsWith('cat_')) {
      // Category selected
      await processMenuRequest(payload, session, `category:${selectedId}`);
    } else if (selectedId?.startsWith('dish_')) {
      // Dish selected
      await processMenuRequest(payload, session, `dish:${selectedId}`);
    } else if (selectedId?.startsWith('action_')) {
      // Action selected
      await processCartAction(payload, session, `action:${selectedId}`);
    }
  } else if (interactive.type === 'button_reply') {
    const selectedId = interactive.button_reply?.id;
    logger.info('[ProcessInbound] Button reply', { 
      correlationId: payload.correlationId,
      phone: maskJid(customerPhone),
      selectedId 
    });
    
    await handleButtonReply(payload, session, { payload: selectedId, text: interactive.button_reply?.title });
  }
}

/**
 * Handle button reply (legacy)
 */
async function handleButtonReply(
  payload: ProcessInboundMessagePayload,
  session: any,
  button: any
): Promise<void> {
  const { message, outlet, businessId } = payload;
  const customerPhone = normalizePhone(message.from);
  const buttonId = button.payload || button.text;
  
  logger.info('[ProcessInbound] Button reply', { 
    correlationId: payload.correlationId,
    phone: maskJid(customerPhone),
    buttonId 
  });
  
  // Route button actions
  if (buttonId?.startsWith('menu_')) {
    await processMenuRequest(payload, session, `menu:${buttonId}`);
  } else if (buttonId?.startsWith('cart_')) {
    await processCartAction(payload, session, `cart:${buttonId}`);
  } else if (buttonId?.startsWith('order_')) {
    await enqueueTask('sendOutboundMessage', {
      to: formatJid(customerPhone)!,
      outlet,
      businessId,
      type: 'text',
      text: '🛒 Order placement via buttons will be available soon.',
      correlationId: generateCorrelationId(),
    });
  } else if (buttonId?.startsWith('pay_')) {
    await processPaymentVerification(payload, session, `pay:${buttonId}`);
  } else if (buttonId?.startsWith('support_')) {
    await processSupportRequest(payload, session, `support:${buttonId}`);
  }
}

/**
 * Handle native WhatsApp order
 */
async function handleNativeOrder(
  payload: ProcessInboundMessagePayload,
  session: any,
  order: any
): Promise<void> {
  logger.info('[ProcessInbound] Native order received', {
    correlationId: payload.correlationId,
    orderId: order.id,
    items: order.product_items?.length,
  });
  
  // Convert native order to our format and process
  const customerPhone = normalizePhone(payload.message.from);
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(customerPhone)!,
    outlet: payload.outlet,
    businessId: payload.businessId,
    type: 'text',
    text: '🛒 Native WhatsApp orders will be supported soon.',
    correlationId: generateCorrelationId(),
  });
}

/**
 * Check wallet gate for outlet
 */
async function checkWalletGate(businessId: string, outlet: string): Promise<'open' | 'low' | 'closed'> {
  try {
    const db = getDB();
    const snap = await db.ref(`businesses/${businessId}/outlets/${outlet}/walletGate`).once('value');
    const gate = snap.val();
    return gate || 'open';
  } catch {
    return 'open'; // Fail open
  }
}

/**
 * Check if session is exempt from wallet gate
 */
function isSessionExempt(session: any): boolean {
  // Admin/staff sessions, existing orders in progress
  return session.role === 'admin' || session.role === 'staff' || session.hasActiveOrder;
}

/**
 * Send wallet closed message
 */
async function sendWalletClosedMessage(
  phone: string,
  outlet: string,
  businessId: string
): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(phone)!,
    outlet,
    businessId,
    type: 'text',
    text: '😔 Sorry, we\'re currently not accepting new orders. Please try again later.',
    correlationId: generateCorrelationId(),
  });
}

/**
 * Check if shop is open for outlet
 */
async function isShopOpenForOutlet(businessId: string, outlet: string): Promise<boolean> {
  try {
    const db = getDB();
    const snap = await db.ref(`businesses/${businessId}/outlets/${outlet}/settings/Store`).once('value');
    const settings = snap.val();
    if (!settings) return true;
    return isShopOpen(settings.openTime, settings.closeTime);
  } catch {
    return true; // Fail open
  }
}

/**
 * Check notification cap
 */
async function checkNotificationCap(
  outlet: string,
  phone: string,
  type: 'order' | 'promo' | 'loyalty'
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const db = getDB();
    const now = Date.now();
    const ist = getISTDateInfo(new Date(now));
    const bucket = ist.dateStr; // YYYY-MM-DD
    
    const caps = { order: 50, promo: 3, loyalty: 5 };
    const cap = caps[type] || caps.order;
    
    const snap = await db.ref(`businesses/${outlet}/notifyCaps/${phone}/${type}/${bucket}`).once('value');
    const current = Number(snap.val() || 0);
    
    if (current >= cap) {
      return { allowed: false, reason: 'daily_cap' };
    }
    
    // Quiet hours for promo
    if (type === 'promo' && (ist.hour >= 21 || ist.hour < 9)) {
      return { allowed: false, reason: 'quiet_hours' };
    }
    
    // Increment
    await db.ref(`businesses/${outlet}/notifyCaps/${phone}/${type}/${bucket}`).set(current + 1);
    return { allowed: true };
  } catch {
    return { allowed: true }; // Fail open
  }
}

/**
 * Update session activity timestamp
 */
async function updateSessionActivity(
  businessId: string,
  outlet: string,
  phone: string
): Promise<void> {
  try {
    const db = getDB();
    await db.ref(`businesses/${businessId}/outlets/${outlet}/sessions/${phone}/lastActivity`).set(Date.now());
  } catch {
    // Ignore
  }
}

/**
 * Send error message to customer
 */
async function sendErrorMessage(
  phone: string,
  outlet: string,
  businessId: string
): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: formatJid(phone)!,
    outlet,
    businessId,
    type: 'text',
    text: '⚠️ Something went wrong. Please try again or contact support.',
    correlationId: generateCorrelationId(),
  });
}

// Export for testing
export { routeMessage, handleInteractiveMessage, handleButtonReply };