/**
 * RTDB-native session management for Cloud Functions.
 *
 * Replaces the EC2 bot's Redis-backed session state (getSession/saveSession
 * in bot/index.js) with RTDB storage at bot/sessions/{jid}/{oid}.
 *
 * Sessions are short-lived conversation state for WhatsApp customers:
 * step (START, MENU_BROWSING, CART_REVIEW, CHECKOUT, PAYMENT, ...),
 * cart contents, pushName, phone, address, location, msgCount, lastActivity.
 *
 * No Redis, no pm2, no local filesystem — pure Admin SDK + RTDB.
 */

import { getDB, ref, runTransaction } from './firebase/admin';

export interface BotSession {
  step: string;
  current?: Record<string, any>;
  cart?: Array<{ dishId: string; name: string; price: number; qty: number; size?: string; addons?: string[] }>;
  pushName?: string;
  phone?: string;
  address?: string;
  location?: { latitude: number; longitude: number };
  msgCount?: number;
  lastReset?: number;
  profile?: Record<string, any> | null;
  name?: string | null;
  hasProfile?: boolean;
  lastActivity?: number;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function sessionPath(jid: string, oid: string): string {
  return `bot/sessions/${jid}/${oid}`;
}

/**
 * Read a session. Returns null if none exists.
 */
export async function getSession(
  jid: string,
  oid: string,
): Promise<BotSession | null> {
  const db = getDB();
  const snap = await db.ref(sessionPath(jid, oid)).once('value');
  if (!snap.exists()) return null;
  return (snap.val() as BotSession) || null;
}

/**
 * Save (upsert) a session. Merges with existing data so partial updates work.
 */
export async function saveSession(
  jid: string,
  oid: string,
  session: Partial<BotSession>,
): Promise<void> {
  const db = getDB();
  const snap = await db.ref(sessionPath(jid, oid)).once('value');
  const existing: Partial<BotSession> = snap.exists() ? (snap.val() as BotSession) : {};
  const merged: BotSession = {
    step: existing.step || 'START',
    ...existing,
    ...session,
    lastActivity: Date.now(),
  };
  await db.ref(sessionPath(jid, oid)).set(merged);
}

/**
 * Increment the message counter and enforce a 1-minute reset window.
 * Returns the new msgCount.
 */
export async function incrementMsgCount(jid: string, oid: string): Promise<number> {
  const db = getDB();
  const now = Date.now();
  const snap = await db.ref(sessionPath(jid, oid)).once('value');
  const existing: Partial<BotSession> = snap.exists() ? (snap.val() as BotSession) : {};
  const lastReset = Number(existing.lastReset || 0);
  const msgCount = (now - lastReset > 60000) ? 1 : Number(existing.msgCount || 0) + 1;
  await db.ref(sessionPath(jid, oid)).set({
    ...existing,
    msgCount,
    lastReset: (now - lastReset > 60000) ? now : lastReset,
    lastActivity: now,
  } as BotSession);
  return msgCount;
}

/**
 * Delete a session (e.g. after order completion or opt-out).
 */
export async function deleteSession(jid: string, oid: string): Promise<void> {
  const db = getDB();
  await db.ref(sessionPath(jid, oid)).remove().catch(() => {});
}

/**
 * Get the last activity timestamp for a session, or 0 if none.
 */
export async function getLastActivity(jid: string, oid: string): Promise<number> {
  const snap = await getDB().ref(sessionPath(jid, oid)).once('value');
  if (!snap.exists()) return 0;
  return Number((snap.val() as BotSession)?.lastActivity || 0);
}
