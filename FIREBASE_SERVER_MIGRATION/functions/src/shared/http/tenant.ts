/**
 * Shared HTTP plumbing for the control-API routes that moved to Functions
 * (batch 23d). Behaviour is copied from `bot-control-api/server.js` — same
 * status codes, same error strings — so the dashboards need no knowledge of
 * which host answered.
 */

import { getAuth, getDB } from '../firebase/admin';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * `requireTenantAdmin`, unchanged in behaviour: token → `admins/{uid}` → outlet
 * → business (stored value first, then the canonical `outletIndex`, then the
 * legacy full-tree scan) → the outlet must really exist under that business.
 */
export async function tenantFromToken(req: any): Promise<{ bid: string; oid: string; uid: string }> {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Missing bearer token');

  let decoded: any;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const db = getDB();
  const row = (await db.ref(`admins/${decoded.uid}`).get()).val() || {};
  if (!row.outlet) throw new HttpError(403, 'Admin not linked to any outlet');

  let bid: string | null = row.businessId || null;
  if (!bid) {
    const idx = (await db.ref(`outletIndex/${row.outlet}`).get()).val();
    bid = (idx && idx.bid) || null;
    if (!bid) {
      // ponytail: legacy rows only (super admins / staff created before
      // `businessId` was stamped). Remove once no such admin can exist.
      const bizs = (await db.ref('businesses').get()).val() || {};
      bid = Object.keys(bizs).find((b) => bizs[b]?.outlets?.[row.outlet]) || null;
    }
  }
  if (!bid) throw new HttpError(403, 'Admin not linked to any outlet');

  const outletSnap = await db.ref(`businesses/${bid}/outlets/${row.outlet}`).get();
  if (!outletSnap.exists()) throw new HttpError(403, 'Outlet not found for this business');

  return { bid, oid: row.outlet, uid: decoded.uid };
}

export async function readJsonBody(req: any, maxBytes: number, tooLargeMessage: string): Promise<any> {
  const raw: Buffer | null = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
  if (raw) {
    if (raw.length > maxBytes) throw new HttpError(413, tooLargeMessage);
    if (!raw.length) return {};
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'Body must be JSON');
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;

  // Last resort: drain the stream with the same hard cap.
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) throw new HttpError(413, tooLargeMessage);
    chunks.push(chunk as Buffer);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

/** Path of the request, relative to this function (accepts a raw function URL). */
export function routeOf(req: any, functionName: string): string {
  let path = String(req.path || '');
  if (!path) {
    try {
      path = new URL(String(req.url || '/'), 'https://local').pathname;
    } catch {
      path = '/';
    }
  }
  path = path.replace(new RegExp(`^/+${functionName}(?=/|$)`), '').replace(/\/+$/, '');
  return path || '/';
}
