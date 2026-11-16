/**
 * RTDB-native strike tracker for WhatsApp ban-proofing.
 *
 * Replaces the EC2 bot's in-memory isJidFrozen / recordWrongMessage /
 * clearWrongStrikes (bot/utils.js). When a customer sends 3 continuous
 * non-intent messages while in AWAITING/WEBVIEW state, they are frozen
 * for 30 minutes — chat replies and promos are dropped, but transactional
 * order notices still go through. Admins never strike.
 *
 * State is stored at bot/strikes/{jid}/{oid}:
 *   { count: number, lastStrikeAt: number, frozenUntil: number }
 */

import { getDB, ref, runTransaction } from './firebase/admin';

export const STRIKE_THRESHOLD = 3;
export const FREEZE_MS = 30 * 60 * 1000; // 30 minutes

export function strikePath(jid: string, oid: string): string {
  return `bot/strikes/${jid}/${oid}`;
}

export interface StrikeState {
  count: number;
  lastStrikeAt?: number;
  frozenUntil?: number;
}

/**
 * Check if a JID is currently frozen (within the 30-min freeze window).
 */
export async function isJidFrozen(jid: string, oid: string): Promise<boolean> {
  const snap = await getDB().ref(strikePath(jid, oid)).once('value');
  if (!snap.exists()) return false;
  const raw = snap.val();
  const frozenUntil = raw && typeof raw === 'object' ? Number((raw as any).frozenUntil || 0) : 0;
  return frozenUntil > 0 && Date.now() < frozenUntil;
}

/**
 * Record a non-intent message strike. Returns the new strike count.
 * If count reaches STRIKE_THRESHOLD, sets frozenUntil = now + 30min.
 */
export async function recordWrongMessage(jid: string, oid: string): Promise<number> {
  const db = getDB();
  const now = Date.now();
  const result = await runTransaction<StrikeState | null>(
    db.ref(strikePath(jid, oid)),
    (current) => {
      const state: StrikeState = (current as StrikeState) || { count: 0 };
      const count = Number(state.count || 0) + 1;
      const frozenUntil = count >= STRIKE_THRESHOLD ? now + FREEZE_MS : Number(state.frozenUntil || 0);
      return { count, lastStrikeAt: now, frozenUntil };
    },
  );
  if (!result.committed) {
    // Retry: read and return current count
    const snap = await db.ref(strikePath(jid, oid)).once('value');
    return Number((snap.val() as StrikeState)?.count || 0);
  }
  return Number((result.snapshot.val() as StrikeState)?.count || 0);
}

/**
 * Clear strikes for a JID (e.g. after an intent message resets the count).
 */
export async function clearWrongStrikes(jid: string, oid: string): Promise<void> {
  await getDB().ref(strikePath(jid, oid)).set({ count: 0, frozenUntil: 0 });
}

/**
 * Get the current strike state for debugging/monitoring.
 */
export async function getStrikeState(jid: string, oid: string): Promise<StrikeState | null> {
  const snap = await getDB().ref(strikePath(jid, oid)).once('value');
  if (!snap.exists()) return null;
  return (snap.val() as StrikeState) || null;
}
