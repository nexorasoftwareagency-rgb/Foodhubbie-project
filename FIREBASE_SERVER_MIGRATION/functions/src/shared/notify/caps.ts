/**
 * Push caps + dead-token classification — the Functions-side mirror of
 * `bot/notification-caps.js`.
 *
 * Batch 23d-2 put this logic inline in `tenantNotify.ts`; batch 23e needs the
 * exact same caps for the push relay, so it moved here. One copy in the cloud
 * tree means the notify endpoint and the relay cannot drift apart, and
 * `tests/functions-source.check.cjs` pins every number against the bot module.
 *
 * Behaviour kept identical to the bot on purpose:
 *   - per (outlet, phone, type) counter under
 *     `businesses/{bid}/outlets/{oid}/notifyCaps/{phone}/{type}/{IST date}`
 *   - `order` 50 / `loyalty` 5 / `promo` 3 per IST day
 *   - quiet hours 21:00-09:00 IST apply to promo only (transactional and
 *     loyalty pushes always go through)
 *   - a cap-store failure never blocks a notification
 *   - `batchCheckAndConsumeCaps` = the same counters for outlet-wide sends:
 *     parallel leaf reads, one write wave, identical increments
 */

import { logger } from 'firebase-functions/v2';
import { getDB } from '../firebase/admin';

export const IST_OFFSET_MS = 5 * 3600000 + 30 * 60000;
export const CAPS: Record<string, number> = { order: 50, loyalty: 5, promo: 3 };

/** IST calendar date (`YYYY-MM-DD`) — the counter bucket. */
export function istBucketKey(ts: number = Date.now()): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Marketing quiet hours in IST. Transactional `order` pushes ignore this. */
export function isQuietHours(ts: number = Date.now()): boolean {
  const h = new Date(ts + IST_OFFSET_MS).getUTCHours();
  return h >= 21 || h < 9;
}

/**
 * Returns `{ allowed }` for a notification of `type` to `phone` at the outlet,
 * incrementing the counter when allowed. Never throws: a broken counter must
 * not silence an order update.
 */
export async function checkAndConsumeCap(
  bid: string,
  oid: string,
  phone: string,
  type: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) return { allowed: true };
  if ((type === 'promo' || type === 'offer') && isQuietHours()) {
    return { allowed: false, reason: 'quiet_hours' };
  }
  const cap = CAPS[type] ?? CAPS.order;
  const bucket = istBucketKey();
  const capRef = getDB().ref(`businesses/${bid}/outlets/${oid}/notifyCaps/${phone}/${type}/${bucket}`);
  try {
    const current = Number((await capRef.get()).val() || 0);
    if (current >= cap) return { allowed: false, reason: 'daily_cap' };
    await capRef.set(current + 1);
    return { allowed: true };
  } catch (e) {
    logger.warn('[Notify] cap check failed', { error: (e as Error).message });
    return { allowed: true };
  }
}

/**
 * Broadcast variant for outlet-wide sends: the same leaf reads and writes the
 * sequential per-phone loop would do, issued in PARALLEL instead of one round
 * trip per recipient (a 100-subscriber promo used to pay 200 sequential RTDB
 * round trips inside the 60 s request). Bytes are identical to the loop —
 * only the latency collapses, to two waves.
 *
 * `phones` may contain duplicates: each occurrence consumes one increment,
 * exactly like the loop it replaces (a customer with two devices counts
 * twice). Returns the set of phones allowed to receive; quiet hours suppress
 * every promo recipient without touching the store, and any store failure
 * fail-opens (a broken counter must not silence an outlet-wide send).
 */
export async function batchCheckAndConsumeCaps(
  bid: string,
  oid: string,
  phones: string[],
  type: string,
): Promise<Set<string>> {
  const valid = phones.filter((p) => /^[6-9]\d{9}$/.test(p));
  if (valid.length === 0) return new Set<string>();
  if ((type === 'promo' || type === 'offer') && isQuietHours()) {
    logger.info(`[Notify] quiet hours — suppressed all ${valid.length} ${type} recipients`);
    return new Set<string>();
  }
  const cap = CAPS[type] ?? CAPS.order;
  const bucket = istBucketKey();
  const paths = valid.map(
    (p) => `businesses/${bid}/outlets/${oid}/notifyCaps/${p}/${type}/${bucket}`,
  );
  let current: number[];
  try {
    current = await Promise.all(
      paths.map(async (p) => Number((await getDB().ref(p).get()).val() || 0)),
    );
  } catch (e) {
    logger.warn('[Notify] batch cap read failed', { error: (e as Error).message });
    return new Set<string>(valid);
  }
  const allowed = new Set<string>();
  const seen = new Map<string, number>();
  const bumped: Array<{ path: string; value: number }> = [];
  valid.forEach((phone, i) => {
    let cur = seen.get(phone);
    if (cur === undefined) cur = current[i];
    if (cur >= cap) {
      logger.info(`[Notify] suppressed for ${phone}: daily_cap`);
      return;
    }
    seen.set(phone, cur + 1);
    allowed.add(phone);
    bumped.push({ path: paths[i], value: cur + 1 });
  });
  if (bumped.length > 0) {
    try {
      await Promise.all(bumped.map((b) => getDB().ref(b.path).set(b.value)));
    } catch (e) {
      logger.warn('[Notify] batch cap write failed', { error: (e as Error).message });
    }
  }
  return allowed;
}

/**
 * Token failures that mean "this token will never work again".
 *
 * `messaging/invalid-argument` is deliberately NOT here. It is a message-level
 * rejection, so one malformed payload fails EVERY token in the batch with it;
 * pruning on it would delete an outlet's whole subscriber list for a single bad
 * send. (The 23d-2 inline list included it — fixed with the extraction.)
 */
export const DEAD_PUSH_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/mismatched-credential',
  'messaging/third-party-auth-error',
]);

export function isDeadPushCode(code: string | null | undefined): boolean {
  return DEAD_PUSH_CODES.has(code || '');
}
