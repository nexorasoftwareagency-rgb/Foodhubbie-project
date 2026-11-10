/**
 * Secret Manager Client
 * Securely accesses secrets from Google Cloud Secret Manager
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const PROJECT_ID = 'foodhubbie-10';

// Cache for secret values (5 min TTL)
const secretCache = new Map<string, { value: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get secret value from Secret Manager
 * Uses caching to avoid repeated API calls
 */
export async function getSecret(name: string): Promise<string> {
  const cached = secretCache.get(name);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }

  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
    });

    const value = version.payload?.data?.toString() || '';
    
    if (!value) {
      throw new Error(`Secret ${name} is empty`);
    }

    secretCache.set(name, { value, expiry: Date.now() + CACHE_TTL });
    return value;
  } catch (error) {
    console.warn(`[SecretManager] Secret ${name} not available, using empty fallback:`, (error as Error).message);
    secretCache.set(name, { value: '', expiry: Date.now() + CACHE_TTL });
    return '';
  }
}

/**
 * Get multiple secrets at once
 */
export async function getSecrets(names: string[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        results[name] = await getSecret(name);
      } catch (error) {
        console.error(`[SecretManager] Failed to get secret ${name}:`, error);
        throw error;
      }
    })
  );
  return results;
}

/**
 * Clear secret cache (useful for rotation)
 */
export function clearSecretCache(name?: string): void {
  if (name) {
    secretCache.delete(name);
  } else {
    secretCache.clear();
  }
}

/**
 * Pre-warm secrets on cold start
 */
export async function warmSecrets(names: string[]): Promise<void> {
  await Promise.all(names.map(name => getSecret(name).catch(() => {})));
}

// Pre-defined secret names for type safety
export const SECRET_NAMES = {
  META_VERIFY_TOKEN: 'META_VERIFY_TOKEN',
  META_SYSTEM_USER_TOKEN: 'META_SYSTEM_USER_TOKEN',
  WA_PERMANENT_TOKEN: 'WA_PERMANENT_TOKEN',
  FIREBASE_DATABASE_URL: 'FIREBASE_DATABASE_URL',
  RAZORPAY_WEBHOOK_SECRET: 'RAZORPAY_WEBHOOK_SECRET',
  PHONEPE_WEBHOOK_SECRET: 'PHONEPE_WEBHOOK_SECRET',
  SLACK_ALERT_WEBHOOK: 'SLACK_ALERT_WEBHOOK',
  SENDGRID_API_KEY: 'SENDGRID_API_KEY',
  VAPID_PUBLIC_KEY: 'VAPID_PUBLIC_KEY',
  VAPID_PRIVATE_KEY: 'VAPID_PRIVATE_KEY',
} as const;

export type SecretName = typeof SECRET_NAMES[keyof typeof SECRET_NAMES];

/**
 * Get secret with type-safe name
 */
export async function getSecretSafe(name: SecretName): Promise<string> {
  return getSecret(name);
}

/**
 * Required secrets for each function group
 */
export const REQUIRED_SECRETS = {
  webhook: [
    SECRET_NAMES.META_VERIFY_TOKEN,
    SECRET_NAMES.META_SYSTEM_USER_TOKEN,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
  ],
  metaApi: [
    SECRET_NAMES.META_SYSTEM_USER_TOKEN,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
  ],
  payments: [
    SECRET_NAMES.RAZORPAY_WEBHOOK_SECRET,
    SECRET_NAMES.PHONEPE_WEBHOOK_SECRET,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
  ],
  notifications: [
    SECRET_NAMES.SLACK_ALERT_WEBHOOK,
    SECRET_NAMES.SENDGRID_API_KEY,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
  ],
  fcm: [
    SECRET_NAMES.VAPID_PUBLIC_KEY,
    SECRET_NAMES.VAPID_PRIVATE_KEY,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
  ],
  all: [
    SECRET_NAMES.META_VERIFY_TOKEN,
    SECRET_NAMES.META_SYSTEM_USER_TOKEN,
    SECRET_NAMES.WA_PERMANENT_TOKEN,
    SECRET_NAMES.FIREBASE_DATABASE_URL,
    SECRET_NAMES.RAZORPAY_WEBHOOK_SECRET,
    SECRET_NAMES.PHONEPE_WEBHOOK_SECRET,
    SECRET_NAMES.SLACK_ALERT_WEBHOOK,
    SECRET_NAMES.SENDGRID_API_KEY,
    SECRET_NAMES.VAPID_PUBLIC_KEY,
    SECRET_NAMES.VAPID_PRIVATE_KEY,
  ],
} as const;

export default {
  getSecret,
  getSecrets,
  clearSecretCache,
  warmSecrets,
  getSecretSafe,
  SECRET_NAMES,
  REQUIRED_SECRETS,
};