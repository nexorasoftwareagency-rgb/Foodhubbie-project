/**
 * Utility Functions
 * Shared helpers for formatting, dates, validation, etc.
 */

import crypto from 'crypto';
import { IST_OFFSET } from './dates';

// Re-export all date utilities
export * from './dates';

// ============================================
// STRING FORMATTING
// ============================================

/**
 * Format order ID for display
 * Input: "20261109-123" or "DD-061126-16"
 * Output: "091126-123" or "DD-061126-16"
 */
export function formatOrderId(id: string | number | object): string {
  if (!id) return 'N/A';
  const str = typeof id === 'string' ? id : (id && (id as any).orderId || (id as any).id) || '';
  if (!str) return 'N/A';
  
  // Already formatted: "DD-061126-16"
  if (/^(?:.+-)?\d{6}-\d+$/.test(str)) return str;
  
  // Raw timestamp format: "20261109123456" or "20261109-123"
  const match = String(str).match(/^(\d{4})(\d{2})(\d{2})-?(\d+)$/);
  if (match) {
    return `${match[3]}${match[2]}${match[1].slice(2)}-${Number(match[4])}`;
  }
  
  return String(str).slice(-6).toUpperCase();
}

/**
 * Format phone number to JID
 * Input: "9876543210" or "919876543210"
 * Output: "919876543210@s.whatsapp.net"
 */
export function formatJid(phone: string | number | null | undefined): string | null {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, '');
  if (clean.startsWith('0')) clean = clean.substring(1);
  if (clean.length === 10) clean = '91' + clean;
  return (clean.length >= 10) ? `${clean}@s.whatsapp.net` : null;
}

/**
 * Mask JID for logging
 * Input: "919876543210@s.whatsapp.net"
 * Output: "91****3210@s.whatsapp.net"
 */
export function maskJid(jid: string | null | undefined): string {
  if (!jid || !jid.includes('@')) return jid || 'unknown';
  const [phone, domain] = jid.split('@');
  if (phone.length <= 4) return `****@${domain}`;
  return `${phone.substring(0, 2)}****${phone.slice(-4)}@${domain}`;
}

/**
 * Normalize phone to 10-digit Indian format
 * Input: "919876543210", "+91 98765 43210", "9876543210"
 * Output: "9876543210"
 */
export function normalizePhone(phone: string): string {
  let clean = String(phone).replace(/\D/g, '');
  if (clean.startsWith('91') && clean.length === 12) clean = clean.slice(2);
  if (clean.startsWith('0')) clean = clean.slice(1);
  return clean.slice(-10);
}

/**
 * Generate random string
 */
export function randomString(length: number = 8, charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'): string {
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
}

/**
 * Generate numeric OTP
 */
export function generateOtp(length: number = 6): string {
  return randomString(length, '0123456789');
}

// ============================================
// CRYPTO / HASHING
// ============================================

/**
 * HMAC SHA256 for webhook verification
 */
export function hmacSha256(payload: string | Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify Meta webhook signature
 */
export function verifyMetaSignature(payload: string | Buffer, signature: string, appSecret: string): boolean {
  const expected = hmacSha256(payload, appSecret);
  return timingSafeEqual(signature, expected);
}

/**
 * Timing-safe string comparison
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * SHA256 hash
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Generate correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${randomString(8)}`;
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate Indian phone number (10 digits, starts with 6-9)
 */
export function isValidIndianPhone(phone: string): boolean {
  const clean = normalizePhone(phone);
  return /^[6-9]\d{9}$/.test(clean);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate positive number
 */
export function isPositiveNumber(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate non-negative number
 */
export function isNonNegativeNumber(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// ============================================
// OBJECT UTILITIES
// ============================================

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Omit keys from object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result;
}

/**
 * Pick keys from object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach(key => {
    if (key in obj) result[key] = obj[key];
  });
  return result;
}

/**
 * Check if object is empty
 */
export function isEmpty(obj: any): boolean {
  if (obj == null) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

/**
 * Flatten object with dot notation
 * { a: { b: 1, c: { d: 2 } } } => { 'a.b': 1, 'a.c.d': 2 }
 */
export function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

// ============================================
// ASYNC UTILITIES
// ============================================

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000, shouldRetry = () => true } = options;
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.random() * 1000;
      await sleep(delay + jitter);
    }
  }
  
  throw lastError!;
}

/**
 * Run promises with concurrency limit
 */
export async function promisePool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of items) {
    const promise = fn(item).then(result => {
      results.push(result);
    });
    
    executing.push(promise);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      const idx = executing.findIndex(p => p === Promise.race(executing));
      if (idx > -1) executing.splice(idx, 1);
    }
  }
  
  await Promise.all(executing);
  return results;
}

/**
 * Timeout wrapper for promises
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError = new Error('Operation timed out')): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(timeoutError), ms))
  ]);
}

// ============================================
// EXPORTS
// ============================================

export default {
  formatOrderId,
  formatJid,
  maskJid,
  normalizePhone,
  randomString,
  generateOtp,
  hmacSha256,
  timingSafeEqual,
  sha256,
  generateCorrelationId,
  isValidIndianPhone,
  isValidEmail,
  isValidUrl,
  isPositiveNumber,
  isNonNegativeNumber,
  deepClone,
  omit,
  pick,
  isEmpty,
  flattenObject,
  sleep,
  retryWithBackoff,
  promisePool,
  withTimeout,
};