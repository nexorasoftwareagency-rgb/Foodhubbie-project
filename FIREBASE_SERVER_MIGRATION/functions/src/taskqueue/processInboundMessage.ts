/**
 * Process Inbound WhatsApp Message (Task Queue Function)
 *
 * Handles all incoming WhatsApp messages from customers:
 * - Session management (RTDB-native, replaces Redis)
 * - Opt-out / opt-in (STOP/START/unsubscribe)
 * - Ban-proofing strikes (3 non-intent → 30-min freeze)
 * - Rate limiting (4–8s gap per outbound chat)
 * - Admin commands (!report, !status)
 * - Menu browsing, cart, checkout, payment
 * - Chat logging
 * - Outbound sends via sendOutboundMessage task queue
 *
 * Ported from bot/index.js messages.upsert handler (lines 2382–2601).
 * Socket-free: no Baileys, no Redis, no local filesystem — pure Admin SDK + RTDB.
 *
 * Payload (from onWebhookInboxMessage trigger):
 *   { bid, oid, jid, text, pushName, message, receivedAt, source }
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB } from '../shared/firebase/admin';
import {
  formatJid,
  maskJid,
  normalizePhone,
  getISTDateInfo,
  generateCorrelationId,
  formatOrderId,
} from '../shared/utils';
import { enqueueTask } from '../shared/utils/taskQueue';
import { getSession, saveSession, incrementMsgCount } from '../shared/session';
import { paceOutboundTo } from '../shared/rateLimit';
import { isJidFrozen } from '../shared/strikeTracker';
import type { ProcessInboundMessagePayload } from '../shared/types';

// Initialize admin
initializeAdmin().catch((err) => {
  logger.error('[ProcessInbound] Admin init failed', { error: err.message });
});

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const DEVELOPER_NUMBER = '9724649971';

export const processInboundMessage = onTaskDispatched({
  region: 'us-central1',
  memory: '512MiB',
  cpu: 1,
  timeoutSeconds: 1800,
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

  const { bid, oid, jid, text, pushName, message, receivedAt } = payload;
  const phone = normalizePhone(jid.replace('@s.whatsapp.net', ''));
  const isAuthorized =
    jid.startsWith(DEVELOPER_NUMBER) || await isAdminJid(jid);

  logger.info('[ProcessInbound] Processing message', {
    correlationId,
    messageId: message?.id,
    from: maskJid(jid),
    outlet: oid,
    businessId: bid,
    text: text.slice(0, 60),
  });

  try {
    // ── 1. Demo tenant hard-skip ──────────────────────────────
    if (bid === DEMO_BUSINESS_ID) return;

    // ── 2. Message ID dedupe ──────────────────────────────────
    const msgId = message?.id || `unknown_${Date.now()}`;
    const processedRef = getDB().ref(`bot/processedMessages/${msgId}`);
    const processedSnap = await processedRef.once('value');
    if (processedSnap.exists()) {
      logger.info('[ProcessInbound] Duplicate message, skipping', { correlationId, msgId });
      return;
    }
    await processedRef.set({ ts: Date.now(), jid, oid }).catch(() => {});
    // TTL: processedMessages cleaned by a separate sweep; 24h TTL set below
    await getDB().ref(`bot/processedMessages/${msgId}/_expiresAt`).set(Date.now() + 86400000).catch(() => {});

    // ── 3. Non-conversational JID filter ───────────────────────
    if (/@newsletter|@broadcast|@g\.us/.test(jid)) return;

    // ── 4. Blocklist check ─────────────────────────────────────
    const blockedSnap = await getDB()
      .ref(`businesses/${bid}/outlets/${oid}/settings/Bot/blockedNumbers`)
      .once('value');
    const blockedList = blockedSnap.val() || [];
    const blockedSet = new Set(Array.isArray(blockedList) ? blockedList.filter(Boolean) : []);
    if (blockedSet.has(jid) || blockedSet.has(phone) || [...blockedSet].some((bn) => phone.endsWith(bn) || bn.endsWith(phone))) {
      logger.info('[ProcessInbound] Blocked number, ignoring', { correlationId, phone });
      return;
    }

    // ── 5. Promotional opt-out / opt-in (before state machine) ─
    const optOutKey = phone;
    const optOutRef = getDB().ref(`bot/promotions/optout/${optOutKey}/${oid}`);

    if (/^(stop|unsubscribe|opt[\s-]?out)$/i.test(text)) {
      await optOutRef.set({ jid, optedOutAt: Date.now() });
      await enqueueOutbound(jid, oid, bid, 'text',
        '✅ You\'ve been unsubscribed from promotional messages. Reply START to opt back in anytime.',
        correlationId);
      return;
    }

    if (/^start$/i.test(text)) {
      const optoutSnap = await optOutRef.once('value');
      if (optoutSnap.exists()) {
        await optOutRef.update({ reOptInAt: Date.now() });
        await enqueueOutbound(jid, oid, bid, 'text',
          '🎉 Welcome back! You\'re re-subscribed to promotional messages.',
          correlationId);
        return;
      }
    }

    // Auto-opt-out on rejection reply from first-time contact
    const isRejectionReply = /^(who( is)?( this| dis)?\??|what('?s| is)?( this)?\??|why( me)?\??|not interested\.?|no,?\s*thanks?\.?|wrong number\.?|leave me alone\.?|don'?t (message|text|contact) me\.?|who dis\??)$/i.test(text.trim());
    if (isRejectionReply && !isAuthorized) {
      const existingSession = await getSession(jid, oid);
      if (!existingSession) {
        await optOutRef.set({ jid, optedOutAt: Date.now(), reason: 'auto-rejection-reply' });
        await enqueueOutbound(jid, oid, bid, 'text',
          `Maaf kijiye disturb karne ke liye — yeh ${await getStoreName(bid, oid)} ka WhatsApp order line hai. Aapko aage koi message nahi bheja jayega. Jab bhi order karna ho, *START* type kar dena.`,
          correlationId);
        return;
      }
    }

    // ── 6. Ban-proofing freeze check ───────────────────────────
    if (!isAuthorized && await isJidFrozen(jid, oid)) {
      logger.info('[ProcessInbound] Frozen JID, ignoring', { correlationId, jid: maskJid(jid) });
      return;
    }

    // ── 7. Session management (RTDB-native) ────────────────────
    await paceOutboundTo(jid, oid); // 4–8s gap enforcement

    let session = await getSession(jid, oid);
    if (!session) {
      const profile = await getUserProfile(phone, bid, oid);
      session = {
        step: 'START',
        current: {},
        cart: [],
        pushName,
        phone,
        lastActivity: Date.now(),
        profile: profile || null,
        name: profile?.name || null,
        hasProfile: !!profile?.name,
        msgCount: 0,
        lastReset: Date.now(),
      };
    }
    session.lastActivity = Date.now();
    await incrementMsgCount(jid, oid);

    // ── 8. Admin commands ──────────────────────────────────────
    if (isAuthorized && text.startsWith('!')) {
      const cmd = text.toLowerCase().slice(1);
      logger.info('[ProcessInbound] Admin command', { correlationId, cmd, from: maskJid(jid) });

      if (cmd === 'report' || cmd === 'sales') {
        await enqueueOutbound(jid, oid, bid, 'text', '⏳ Generating latest sales report...', correlationId);
        await sendDailyReport(jid, oid, bid, correlationId);
        return;
      }
      if (cmd === 'status') {
        await enqueueOutbound(jid, oid, bid, 'text', '🤖 WhatsApp bot is online (Cloud Functions).', correlationId);
        return;
      }
    }

    // ── 9. State machine ───────────────────────────────────────
    const step = session.step || 'START';

    switch (step) {
      case 'START':
        await handleStart(jid, oid, bid, session, text, correlationId);
        break;
      case 'MENU_BROWSING':
        await handleMenuBrowsing(jid, oid, bid, session, text, correlationId);
        break;
      case 'CART_REVIEW':
        await handleCartReview(jid, oid, bid, session, text, correlationId);
        break;
      case 'CHECKOUT':
        await handleCheckout(jid, oid, bid, session, text, correlationId);
        break;
      case 'PAYMENT':
        await handlePayment(jid, oid, bid, session, text, correlationId);
        break;
      default:
        await handleStart(jid, oid, bid, session, text, correlationId);
    }

    // ── 10. Save session ───────────────────────────────────────
    await saveSession(jid, oid, session);

    logger.info('[ProcessInbound] Message processed', {
      correlationId,
      step,
      outlet: oid,
    });

  } catch (error) {
    logger.error('[ProcessInbound] Processing failed', {
      correlationId,
      jid: maskJid(jid),
      outlet: oid,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    await enqueueOutbound(jid, oid, bid, 'text',
      '⚠️ Something went wrong. Please try again or contact support.',
      correlationId);
    throw error;
  }
});

/* ────────────────────────────────────────────────────────────
   HELPER FUNCTIONS
   ──────────────────────────────────────────────────────────── */

/**
 * Check if a JID is an admin (outlet match or isSuper/isSupreme).
 */
async function isAdminJid(jid: string): Promise<boolean> {
  const phone = normalizePhone(jid.replace('@s.whatsapp.net', ''));
  const adminsSnap = await getDB().ref('admins').once('value');
  const admins: Record<string, any> = adminsSnap.val() || {};
  for (const [, a] of Object.entries(admins)) {
    if (!a) continue;
    if (a.isSuper === true || a.isSupreme === true) return true;
    if (a.whatsappJid === jid || a.phone === phone) return true;
    if (a.DEVELOPER_NUMBER === phone) return true;
  }
  return false;
}

/**
 * Enqueue an outbound WhatsApp message via sendOutboundMessage task queue.
 */
async function enqueueOutbound(
  jid: string,
  oid: string,
  bid: string,
  type: 'text' | 'template' | 'image' | 'button',
  text: string,
  correlationId: string,
  template?: { name: string; language: string; components: any[] },
): Promise<void> {
  await enqueueTask('sendOutboundMessage', {
    to: jid,
    outlet: oid,
    businessId: bid,
    type,
    text,
    template,
    correlationId,
    _logChat: true,
  });
}

/**
 * Get outlet store name for branding.
 */
async function getStoreName(bid: string, oid: string): Promise<string> {
  try {
    const snap = await getDB().ref(`businesses/${bid}/outlets/${oid}/settings/Store/storeName`).once('value');
    if (snap.exists()) return String(snap.val());
  } catch {
    // ignore
  }
  return oid;
}

/**
 * Get user profile by phone.
 */
async function getUserProfile(phone: string, bid: string, oid: string): Promise<any> {
  try {
    const snap = await getDB().ref(`businesses/${bid}/outlets/${oid}/customers/${phone}`).once('value');
    return snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
}

/**
 * Send daily sales report to admin via WhatsApp.
 */
async function sendDailyReport(jid: string, oid: string, bid: string, correlationId: string): Promise<void> {
  try {
    const todayStart = getISTDateInfo(new Date());
    const periodStart = todayStart.timestamp - (todayStart.hour * 3600 + todayStart.minute * 60 + todayStart.second) * 1000;

    const ordersSnap = await getDB().ref(`businesses/${bid}/outlets/${oid}/orders`)
      .orderByChild('createdAt')
      .startAt(periodStart)
      .endAt(Date.now())
      .once('value');
    const orders = ordersSnap.val() || {};

    let orderCount = 0;
    let totalSales = 0;
    for (const [, order] of Object.entries(orders)) {
      const o = order as any;
      if (!o || !o.createdAt) continue;
      orderCount++;
      totalSales += Number(o.total || 0);
    }

    const body =
      `📊 *Daily Sales Report*\n` +
      `*${await getStoreName(bid, oid)}*\n\n` +
      `Orders: ${orderCount}\n` +
      `Sales: ₹${totalSales.toFixed(2)}`;

    await enqueueOutbound(jid, oid, bid, 'text', body, correlationId);
  } catch (err) {
    logger.error('[ProcessInbound] Daily report failed', { error: (err as Error).message });
    await enqueueOutbound(jid, oid, bid, 'text', '⚠️ Report generation failed.', correlationId);
  }
}

/* ────────────────────────────────────────────────────────────
   STATE MACHINE HANDLERS
   ──────────────────────────────────────────────────────────── */

async function handleStart(jid: string, oid: string, bid: string, session: any, text: string, correlationId: string): Promise<void> {
  const storeName = await getStoreName(bid, oid);

  // Greeting + menu + order CTA
  await enqueueOutbound(jid, oid, bid, 'text',
    `👋 Welcome to *${storeName}*!\n\nBrowse our menu and place an order via WhatsApp.\n\nReply with:\n• *menu* — See today's dishes\n• *cart* — View your cart\n• *order* — Place a new order`,
    correlationId);

  session.step = 'MENU_BROWSING';
}

async function handleMenuBrowsing(jid: string, oid: string, bid: string, session: any, text: string, correlationId: string): Promise<void> {
  const lower = text.toLowerCase().trim();

  if (lower === 'menu') {
    // Fetch dishes from catalog
    let dishesText = '🍽️ *Today\'s Menu*\n\n';
    try {
      const dishesSnap = await getDB().ref(`businesses/${bid}/outlets/${oid}/dishes`).once('value');
      const dishes = dishesSnap.val() || {};
      let count = 0;
      for (const [id, dish] of Object.entries(dishes)) {
        const d = dish as any;
        if (!d || d.disabled) continue;
        count++;
        if (count > 10) break;
        dishesText += `• ${d.name || id} — ₹${Number(d.price || 0)}\n`;
      }
      if (count === 0) dishesText += 'No dishes available.\n';
    } catch {
      dishesText += 'Menu unavailable.\n';
    }
    dishesText += '\nReply *order <dish name>* to add an item to your cart.';
    await enqueueOutbound(jid, oid, bid, 'text', dishesText, correlationId);
  } else if (lower.startsWith('order ')) {
    const dishName = lower.slice(6).trim();
    await enqueueOutbound(jid, oid, bid, 'text',
      `🛒 Adding "${dishName}" to your cart. Reply *cart* to view, or *checkout* to proceed.`,
      correlationId);
    session.cart.push({ name: dishName, price: 0, qty: 1 });
    session.step = 'CART_REVIEW';
  } else if (lower === 'cart') {
    await handleCartReview(jid, oid, bid, session, text, correlationId);
  } else {
    await enqueueOutbound(jid, oid, bid, 'text',
      'Reply *menu* to see dishes, *cart* to view your cart, or *order <dish>* to add an item.',
      correlationId);
  }
}

async function handleCartReview(jid: string, oid: string, bid: string, session: any, text: string, correlationId: string): Promise<void> {
  const lower = text.toLowerCase().trim();

  if (lower === 'cart') {
    if (session.cart.length === 0) {
      await enqueueOutbound(jid, oid, bid, 'text',
        'Your cart is empty. Reply *menu* to browse dishes.', correlationId);
    } else {
      let cartText = '🛒 *Your Cart*\n\n';
      let total = 0;
      for (const item of session.cart) {
        cartText += `• ${item.name} ×${item.qty} — ₹${Number(item.price || 0) * item.qty}\n`;
        total += Number(item.price || 0) * item.qty;
      }
      cartText += `\nTotal: ₹${total.toFixed(2)}\nReply *checkout* to proceed.`;
      await enqueueOutbound(jid, oid, bid, 'text', cartText, correlationId);
    }
  } else if (lower === 'checkout') {
    if (session.cart.length === 0) {
      await enqueueOutbound(jid, oid, bid, 'text',
        'Your cart is empty. Reply *menu* to browse dishes.', correlationId);
    } else {
      session.step = 'CHECKOUT';
      await enqueueOutbound(jid, oid, bid, 'text',
        '📍 Please provide your delivery address or reply *pickup* for counter collection.',
        correlationId);
    }
  } else {
    await enqueueOutbound(jid, oid, bid, 'text',
      'Reply *cart* to view your cart, *checkout* to proceed, or *menu* to browse more.', correlationId);
  }
}

async function handleCheckout(jid: string, oid: string, bid: string, session: any, text: string, correlationId: string): Promise<void> {
  const lower = text.toLowerCase().trim();

  if (lower === 'pickup') {
    session.address = 'Counter pickup';
    session.step = 'PAYMENT';
    await enqueueOutbound(jid, oid, bid, 'text',
      '💳 Payment: Reply *cod* for Cash on Delivery or *upi* for UPI.', correlationId);
  } else {
    session.address = text;
    session.step = 'PAYMENT';
    await enqueueOutbound(jid, oid, bid, 'text',
      `📍 Delivery to: ${text}\n💳 Payment: Reply *cod* for Cash on Delivery or *upi* for UPI.`, correlationId);
  }
}

async function handlePayment(jid: string, oid: string, bid: string, session: any, text: string, correlationId: string): Promise<void> {
  const lower = text.toLowerCase().trim();

  if (lower === 'cod' || lower === 'upi') {
    const total = session.cart.reduce((sum: number, item: any) => sum + Number(item.price || 0) * item.qty, 0);
    const orderId = formatOrderId(`${oid}-${Date.now()}`);

    // Write order to RTDB
    await getDB().ref(`businesses/${bid}/outlets/${oid}/orders/${orderId}`).set({
      orderId,
      customerPhone: session.phone,
      customerName: session.name || 'Customer',
      address: session.address,
      items: session.cart,
      total,
      paymentMethod: lower === 'cod' ? 'COD' : 'UPI',
      status: 'Placed',
      paymentStatus: 'Pending',
      source: 'WA',
      channel: 'whatsapp',
      createdAt: Date.now(),
      outlet: oid,
      business: bid,
    });

    // Clear cart
    session.cart = [];
    session.step = 'START';

    await enqueueOutbound(jid, oid, bid, 'text',
      `✅ Order *#${orderId}* placed!\nTotal: ₹${total.toFixed(2)}\nPayment: ${lower === 'cod' ? 'Cash on Delivery' : 'UPI'}\nWe'll confirm shortly.`,
      correlationId);
  } else {
    await enqueueOutbound(jid, oid, bid, 'text',
      'Reply *cod* for Cash on Delivery or *upi* for UPI.', correlationId);
  }
}

// Export for testing
// (routeMessage, handleInteractiveMessage, handleButtonReply were stub-only;
//  the new implementation is fully self-contained in this module.)
