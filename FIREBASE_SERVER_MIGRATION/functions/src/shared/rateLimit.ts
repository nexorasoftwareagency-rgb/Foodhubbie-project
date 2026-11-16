/**
 * RTDB-native rate limiter for outbound WhatsApp messages.
 *
 * Replaces the EC2 bot's in-memory paceOutboundTo() (bot/utils.js) which
 * enforced a 4–8 second random gap per outbound chat. In Cloud Functions
 * there is no persistent process memory, so we track per-sender timestamps
 * in RTDB at bot/rateLimits/{jid}/{oid}.
 *
 * Each outbound send reads the lastSendAt, computes the required gap
 * (random 4–8s), waits if needed, then writes the new lastSendAt.
 */

import { getDB, ref, runTransaction } from './firebase/admin';

export const RATE_LIMIT_GAP_MIN_MS = 4000;
export const RATE_LIMIT_GAP_MAX_MS = 8000;

export function rateLimitPath(jid: string, oid: string): string {
  return `bot/rateLimits/${jid}/${oid}`;
}

/**
 * Acquire a rate-limit slot for sending to {jid} at outlet {oid}.
 * Resolves when the required gap since the last send has elapsed.
 * Returns the waitMs that was applied (0 if no wait needed).
 */
export async function paceOutboundTo(jid: string, oid: string): Promise<number> {
  const db = getDB();
  const now = Date.now();
  const gapMs = RATE_LIMIT_GAP_MIN_MS + Math.floor(Math.random() * (RATE_LIMIT_GAP_MAX_MS - RATE_LIMIT_GAP_MIN_MS));

  const result = await runTransaction<number | null>(
    db.ref(rateLimitPath(jid, oid)),
    (current) => {
      const lastSendAt = typeof current === 'number' ? current : 0;
      const elapsed = now - lastSendAt;
      if (elapsed >= gapMs) {
        // OK to send now; record this send time
        return now;
      }
      // Not ready yet — return null to abort, caller will wait and retry
      return null;
    },
  );

  if (result.committed) {
    return 0;
  }

  // Transaction aborted because gap not met — read current value and wait
  const snap = await db.ref(rateLimitPath(jid, oid)).once('value');
  const lastSendAt = typeof snap.val() === 'number' ? snap.val() : 0;
  const elapsed = now - lastSendAt;
  const waitMs = Math.max(0, gapMs - elapsed);

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    // After waiting, record the actual send time
    await db.ref(rateLimitPath(jid, oid)).set(Date.now());
  }

  return waitMs;
}

/**
 * Get the last send timestamp for a JID at an outlet (0 if never sent).
 */
export async function getLastSendAt(jid: string, oid: string): Promise<number> {
  const snap = await getDB().ref(rateLimitPath(jid, oid)).once('value');
  if (!snap.exists()) return 0;
  return typeof snap.val() === 'number' ? snap.val() : 0;
}
