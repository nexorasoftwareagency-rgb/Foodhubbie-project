/**
 * Firebase Admin SDK Singleton
 * Initializes and provides access to Firebase Admin services
 */

import admin from 'firebase-admin';
import { getDatabase, getDatabaseWithUrl } from 'firebase-admin/database';
import { getSecret } from '../config/secrets';

// Global admin app instance
let adminApp: admin.app.App | null = null;
let adminDb: admin.database.Database | null = null;
let auth: admin.auth.Auth | null = null;
let messaging: admin.messaging.Messaging | null = null;
// Cold starts can fan several callers in at once; share one initialization.
let initPromise: Promise<admin.app.App> | null = null;

/** FIREBASE_DATABASE_URL is bound as an env var (declared in the function's
 *  `secrets` list), which avoids a Secret Manager round-trip per cold start. */
async function resolveDatabaseUrl(): Promise<string | undefined> {
  const fromEnv = (process.env.FIREBASE_DATABASE_URL || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromSecret = (await getSecret('FIREBASE_DATABASE_URL')).trim();
    return fromSecret || undefined;
  } catch {
    return undefined;
  }
}

async function doInitialize(): Promise<admin.app.App> {
  const databaseUrl = await resolveDatabaseUrl();

  try {
    adminApp = admin.app();
  } catch {
    adminApp = null; // no default app yet (local/emulator) — create one below
  }

  if (!adminApp) {
    adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...(databaseUrl ? { databaseURL: databaseUrl } : {}),
    });
  }

  // Cloud Functions pre-creates the default app, so taking the `admin.app()`
  // branch is the NORMAL path — every handle must be wired here, not only on
  // the create branch. (Bug fixed 2026-11-10: this branch returned early, so
  // adminDb stayed null and getDB() threw on every cold start.)
  adminDb = databaseUrl ? getDatabaseWithUrl(databaseUrl, adminApp) : getDatabase(adminApp);
  auth = adminApp.auth();
  messaging = adminApp.messaging();

  console.log('[Admin] Firebase Admin SDK initialized', {
    projectId: adminApp.options.projectId || process.env.GCLOUD_PROJECT,
    databaseUrl: databaseUrl || '(from app config)',
  });
  return adminApp;
}

/**
 * Initialize Firebase Admin SDK
 * Called once on cold start; safe to call concurrently.
 */
export function initializeAdmin(): Promise<admin.app.App> {
  if (adminApp && adminDb) return Promise.resolve(adminApp);
  if (!initPromise) {
    initPromise = doInitialize().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/**
 * Get Admin App instance
 */
export function getAdminApp(): admin.app.App {
  if (!adminApp) {
    throw new Error('Admin SDK not initialized. Call initializeAdmin() first.');
  }
  return adminApp;
}

/**
 * Get Realtime Database instance
 */
export function getDB(): admin.database.Database {
  if (!adminDb) {
    throw new Error('Admin SDK not initialized. Call initializeAdmin() first.');
  }
  return adminDb;
}

/**
 * Get Auth instance
 */
export function getAuth(): admin.auth.Auth {
  if (!auth) {
    throw new Error('Admin SDK not initialized. Call initializeAdmin() first.');
  }
  return auth;
}

/**
 * Get Messaging (FCM) instance
 */
export function getMessaging(): admin.messaging.Messaging {
  if (!messaging) {
    throw new Error('Admin SDK not initialized. Call initializeAdmin() first.');
  }
  return messaging;
}

/**
 * Get Database Reference with path
 */
export function ref(path: string): admin.database.Reference {
  return getDB().ref(path);
}

/**
 * Get Database Reference with outlet-scoped path
 */
export function outletRef(bid: string, oid: string, ...paths: string[]): admin.database.Reference {
  return getDB().ref(`businesses/${bid}/outlets/${oid}/${paths.join('/')}`);
}

/**
 * Get Wallet Billing Reference
 */
export function walletBillingRef(bid: string, oid: string, ...paths: string[]): admin.database.Reference {
  return getDB().ref(`walletBilling/${bid}/${oid}/${paths.join('/')}`);
}

/**
 * Server value for timestamp
 */
export const serverTimestamp = admin.database.ServerValue.TIMESTAMP;

/**
 * Run a transaction with retry logic
 */
export async function runTransaction<T>(
  ref: admin.database.Reference,
  updater: (current: T | null) => T | null,
  maxRetries = 3
): Promise<{ committed: boolean; snapshot: admin.database.DataSnapshot }> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await ref.transaction(updater);
      if (result.committed) return result;
      lastError = new Error('Transaction aborted');
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 100 * attempt));
      }
    }
  }
  
  throw lastError || new Error('Transaction failed after retries');
}

/**
 * Batch update multiple paths atomically
 */
export async function batchUpdate(updates: Record<string, any>): Promise<void> {
  const db = getDB();
  const chunkSize = 500; // RTDB limit per update
  const entries = Object.entries(updates);
  
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = Object.fromEntries(entries.slice(i, i + chunkSize));
    await db.ref().update(chunk);
  }
}

/**
 * Get data once with timeout
 */
export async function getDataOnce<T>(ref: admin.database.Reference, timeoutMs = 10000): Promise<T | null> {
  const timeout = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Database read timeout')), timeoutMs)
  );
  
  const snapshot = await Promise.race([ref.once('value'), timeout]);
  return snapshot.val() as T | null;
}

/**
 * Listen to value changes with automatic cleanup
 */
export function listenValue(
  ref: admin.database.Reference,
  callback: (snapshot: admin.database.DataSnapshot) => void,
  onError?: (error: Error) => void
): () => void {
  const handler = ref.on('value', callback, onError);
  return () => ref.off('value', handler);
}

/**
 * Listen to child events with automatic cleanup
 */
export function listenChildren(
  ref: admin.database.Reference,
  callbacks: {
    child_added?: (snapshot: admin.database.DataSnapshot) => void;
    child_changed?: (snapshot: admin.database.DataSnapshot) => void;
    child_removed?: (snapshot: admin.database.DataSnapshot) => void;
    child_moved?: (snapshot: admin.database.DataSnapshot) => void;
  },
  onError?: (error: Error) => void
): () => void {
  const handlers: Array<() => void> = [];
  
  if (callbacks.child_added) {
    (ref as any).on('child_added', callbacks.child_added, onError);
    handlers.push(() => (ref as any).off('child_added', callbacks.child_added));
  }
  if (callbacks.child_changed) {
    (ref as any).on('child_changed', callbacks.child_changed, onError);
    handlers.push(() => (ref as any).off('child_changed', callbacks.child_changed));
  }
  if (callbacks.child_removed) {
    (ref as any).on('child_removed', callbacks.child_removed, onError);
    handlers.push(() => (ref as any).off('child_removed', callbacks.child_removed));
  }
  if (callbacks.child_moved) {
    (ref as any).on('child_moved', callbacks.child_moved, onError);
    handlers.push(() => (ref as any).off('child_moved', callbacks.child_moved));
  }
  
  return () => handlers.forEach(off => off());
}

/**
 * Increment a numeric value atomically
 */
export async function incrementValue(ref: admin.database.Reference, delta: number = 1): Promise<number> {
  const result = await runTransaction<number | null>(ref, (current) => {
    const val = typeof current === 'number' ? current : 0;
    return val + delta;
  });
  return result.snapshot.val() as number;
}

/**
 * Decrement a numeric value atomically (floor at 0)
 */
export async function decrementValue(ref: admin.database.Reference, delta: number = 1): Promise<number> {
  const result = await runTransaction<number | null>(ref, (current) => {
    const val = typeof current === 'number' ? current : 0;
    return Math.max(0, val - delta);
  });
  return result.snapshot.val() as number;
}

/**
 * Set value with TTL (using separate cleanup or RTDB TTL if available)
 */
export async function setWithTTL(
  ref: admin.database.Reference,
  value: any,
  ttlMs: number
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  await ref.set({
    ...value,
    _expiresAt: expiresAt,
    _createdAt: Date.now(),
  });
  
  // Schedule cleanup (in production, use Cloud Scheduler or TTL feature)
  setTimeout(async () => {
    const snap = await ref.once('value');
    if (snap.exists() && snap.val()._expiresAt <= Date.now()) {
      await ref.remove().catch(() => {});
    }
  }, ttlMs + 60000); // Extra minute buffer
}

export default {
  initializeAdmin,
  getAdminApp,
  getDB,
  getAuth,
  getMessaging,
  ref,
  outletRef,
  walletBillingRef,
  serverTimestamp,
  runTransaction,
  batchUpdate,
  getDataOnce,
  listenValue,
  listenChildren,
  incrementValue,
  decrementValue,
  setWithTTL,
};