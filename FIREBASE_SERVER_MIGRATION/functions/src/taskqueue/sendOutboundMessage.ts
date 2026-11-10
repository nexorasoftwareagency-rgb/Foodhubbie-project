/**
 * Send Outbound WhatsApp Message (Task Queue Function)
 * 
 * Sends messages via Meta WhatsApp Cloud API (Graph API)
 * Handles templates, text, images, documents
 * Includes rate limiting, retry logic, and cost tracking
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import { initializeAdmin, getDB, walletBillingRef } from '../shared/firebase/admin';
import { getSecret } from '../shared/config/secrets';
import { enqueueTask } from '../shared/utils/taskQueue';
import { 
  formatJid, 
  maskJid, 
  normalizePhone,
  getISTDateInfo,
  generateCorrelationId,
  retryWithBackoff,
  sleep
} from '../shared/utils';
import { recordMetaCost } from '../shared/wallet/metaCost';
import type { 
  SendOutboundMessagePayload, 
  MetaTemplateComponent 
} from '../shared/types';

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Initialize admin
initializeAdmin().catch(err => {
  logger.error('[SendOutbound] Admin init failed', { error: err.message });
});

// Rate limiter per outlet (in-memory, per instance)
const rateLimiters = new Map<string, { tokens: number; lastRefill: number }>();

const RATE_LIMIT = 800; // Leave 20% headroom from Meta's 1000/sec
const REFILL_RATE = 1000 / 60; // Per second

/**
 * Acquire rate limit token for outlet
 */
async function acquireRateLimit(outlet: string): Promise<void> {
  let limiter = rateLimiters.get(outlet);
  const now = Date.now();
  
  if (!limiter) {
    limiter = { tokens: RATE_LIMIT, lastRefill: now };
    rateLimiters.set(outlet, limiter);
  }
  
  // Refill tokens
  const elapsed = (now - limiter.lastRefill) / 1000;
  limiter.tokens = Math.min(RATE_LIMIT, limiter.tokens + elapsed * REFILL_RATE);
  limiter.lastRefill = now;
  
  if (limiter.tokens < 1) {
    const waitMs = (1 - limiter.tokens) / REFILL_RATE * 1000;
    await sleep(waitMs);
    limiter.tokens = 0;
  } else {
    limiter.tokens -= 1;
  }
}

/**
 * Send message via Meta Graph API
 */
async function sendViaGraphApi(
  payload: SendOutboundMessagePayload,
  accessToken: string,
  phoneNumberId: string
): Promise<{ success: boolean; messageId?: string; error?: string; blocked?: boolean }> {
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`;
  
  let body: any = {
    messaging_product: 'whatsapp',
    to: payload.to.replace('@s.whatsapp.net', ''),
    type: payload.type,
  };
  
  switch (payload.type) {
    case 'template':
      body.template = {
        name: payload.template!.name,
        language: { code: payload.template!.language },
        components: payload.template!.components,
      };
      break;
    case 'text':
      body.text = { body: payload.text! };
      break;
    case 'image':
      body.image = { 
        link: payload.image!.url,
        caption: payload.image!.caption 
      };
      break;
    case 'document':
      body.document = { 
        link: payload.document!.url,
        filename: payload.document!.filename,
        caption: payload.document!.caption 
      };
      break;
    case 'location':
      body.location = {
        latitude: payload.location!.latitude,
        longitude: payload.location!.longitude,
        name: payload.location!.name,
        address: payload.location!.address,
      };
      break;
    case 'contacts':
      body.contacts = payload.contacts;
      break;
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      const error = data.error;
      logger.warn('[SendOutbound] Graph API error', {
        status: response.status,
        error: error?.message,
        code: error?.code,
        subcode: error?.error_subcode,
        fbtrace_id: error?.fbtrace_id,
      });
      
      // Check for cost guard block (custom response from our meta cost guard)
      if (data.blocked === true) {
        return { success: false, blocked: true, error: 'cost_guard_blocked' };
      }
      
      // Check for rate limit
      if (error?.code === 4 || error?.code === 17 || error?.code === 32) {
        return { success: false, error: 'rate_limited' };
      }
      
      return { success: false, error: error?.message || `HTTP ${response.status}` };
    }
    
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    logger.error('[SendOutbound] Network error', { error: (error as Error).message });
    return { success: false, error: 'network_error' };
  }
}

/**
 * Get phoneNumberId for outlet
 */
async function getPhoneNumberId(businessId: string, outlet: string): Promise<string | null> {
  try {
    const db = getDB();
    const snap = await db.ref(`businesses/${businessId}/outlets/${outlet}/whatsapp/phoneNumberId`).once('value');
    return snap.val() || null;
  } catch {
    return null;
  }
}

/**
 * Main outbound message sender
 */
export const sendOutboundMessage = onTaskDispatched({
  region: 'us-central1',
  memory: '512MiB',
  cpu: 1,
  timeoutSeconds: 60,
  minInstances: 0,
  maxInstances: 10,
  concurrency: 10,
  rateLimits: {
    maxDispatchesPerSecond: 200,
    maxConcurrentDispatches: 500,
  },
  retryConfig: {
    maxAttempts: 3,
    minBackoffSeconds: 10,
    maxBackoffSeconds: 300,
    maxDoublings: 4,
  },
  secrets: [
    'WA_PERMANENT_TOKEN',
    'META_SYSTEM_USER_TOKEN',
    'FIREBASE_DATABASE_URL',
  ],
  labels: {
    'worker-type': 'outbound-sender',
  },
}, async (req) => {
  const payload = req.data as SendOutboundMessagePayload;
  const correlationId = payload.correlationId || generateCorrelationId();
  
  (globalThis as any).__correlationId = correlationId;
  
  const { to, outlet, businessId, type } = payload;
  
  logger.info('[SendOutbound] Sending message', {
    correlationId,
    to: maskJid(to),
    outlet,
    businessId,
    type,
  });

  try {
    // 1. Get phoneNumberId
    const phoneNumberId = await getPhoneNumberId(businessId, outlet);
    if (!phoneNumberId) {
      throw new Error('No phoneNumberId configured for outlet');
    }
    
    // 2. Get access token
    const accessToken = await getSecret('META_SYSTEM_USER_TOKEN');
    if (!accessToken) {
      throw new Error('No Meta system user token available');
    }
    
    // 3. Acquire rate limit
    await acquireRateLimit(outlet);
    
    // 4. Send with retry
    const result = await retryWithBackoff(
      () => sendViaGraphApi(payload, accessToken, phoneNumberId),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        shouldRetry: (error) => error.message === 'rate_limited' || error.message === 'network_error',
      }
    );
    
    if (!result.success) {
      if (result.blocked) {
        logger.warn('[SendOutbound] Blocked by cost guard', { correlationId, outlet });
        // Re-queue with delay for cost guard blocks
        await enqueueTask('sendOutboundMessage', payload, { delaySeconds: 60 });
        return;
      }
      throw new Error(result.error || 'Send failed');
    }
    
    // 5. Log successful send
    logger.info('[SendOutbound] Message sent', {
      correlationId,
      messageId: result.messageId,
      to: maskJid(to),
      outlet,
      type,
    });
    
    // 6. Record Meta cost (fire and forget)
    recordMetaCost(businessId, outlet, type).catch(err => {
      logger.error('[SendOutbound] Failed to record Meta cost', { error: err.message });
    });
    
    // 7. Update outbound tracking in RTDB
    await logOutboundMessage(businessId, outlet, to, type, result.messageId!);
    
  } catch (error) {
    logger.error('[SendOutbound] Send failed', {
      correlationId,
      to: maskJid(to),
      outlet,
      error: (error as Error).message,
    });
    
    // Log failed attempt
    await logFailedMessage(businessId, outlet, to, type, (error as Error).message);
    
    throw error; // Trigger retry
  }
});

/**
 * Log successful outbound message
 */
async function logOutboundMessage(
  businessId: string,
  outlet: string,
  to: string,
  type: string,
  messageId: string
): Promise<void> {
  try {
    const db = getDB();
    const phone = normalizePhone(to);
    const now = Date.now();
    const ist = getISTDateInfo(new Date(now));
    const bucket = ist.dateStr;
    
    // Update notification cap counter
    await db.ref(`businesses/${outlet}/notifyCaps/${phone}/outbound/${bucket}`).transaction(current => (current || 0) + 1);
    
    // Log message
    await db.ref(`businesses/${businessId}/outlets/${outlet}/outboundLog`).push({
      messageId,
      to: phone,
      type,
      status: 'sent',
      timestamp: now,
      dateStr: bucket,
    });
  } catch (error) {
    logger.error('[SendOutbound] Failed to log outbound', { error: (error as Error).message });
  }
}

/**
 * Log failed outbound message
 */
async function logFailedMessage(
  businessId: string,
  outlet: string,
  to: string,
  type: string,
  error: string
): Promise<void> {
  try {
    const db = getDB();
    const phone = normalizePhone(to);
    const now = Date.now();
    const ist = getISTDateInfo(new Date(now));
    const bucket = ist.dateStr;
    
    await db.ref(`businesses/${businessId}/outlets/${outlet}/outboundLog`).push({
      to: phone,
      type,
      status: 'failed',
      error,
      timestamp: now,
      dateStr: bucket,
    });
  } catch (err) {
    logger.error('[SendOutbound] Failed to log failure', { error: (err as Error).message });
  }
}

/**
 * Send template message (helper for other functions)
 */
export async function sendTemplateMessage(
  to: string,
  outlet: string,
  businessId: string,
  templateName: string,
  language: string,
  components: MetaTemplateComponent[],
  correlationId: string
): Promise<{ success: boolean; messageId?: string }> {
  return enqueueTask('sendOutboundMessage', {
    to,
    outlet,
    businessId,
    type: 'template',
    template: { name: templateName, language, components },
    correlationId,
  }) as any;
}

/**
 * Send text message (helper for other functions)
 */
export async function sendTextMessage(
  to: string,
  outlet: string,
  businessId: string,
  text: string,
  correlationId: string
): Promise<string> {
  return enqueueTask('sendOutboundMessage', {
    to,
    outlet,
    businessId,
    type: 'text',
    text,
    correlationId,
  }) as any;
}

/**
 * Send image message (helper for other functions)
 */
export async function sendImageMessage(
  to: string,
  outlet: string,
  businessId: string,
  imageUrl: string,
  caption: string,
  correlationId: string
): Promise<string> {
  return enqueueTask('sendOutboundMessage', {
    to,
    outlet,
    businessId,
    type: 'image',
    image: { url: imageUrl, caption },
    correlationId,
  }) as any;
}

// Export helpers
export { sendViaGraphApi, acquireRateLimit, getPhoneNumberId };