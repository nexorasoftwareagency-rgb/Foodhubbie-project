/**
 * Media endpoints (batch 23d-1) — the first slice of the control API to leave
 * EC2.
 *
 * `POST /tenant-api/upload` and `POST /tenant-api/delete-image` are pure cloud
 * operations: verify the caller's ID token, resolve the tenant from
 * `admins/{uid}`, then write/delete an object in the media bucket. They have no
 * pm2, no socket and no bot dependency, so they are the cheapest thing to move
 * off the box — and the most valuable while it is down, because every dish,
 * category, combo and status-image save in the Admin dashboard (plus rider KYC
 * uploads) goes through them.
 *
 * Contract is byte-compatible with `bot-control-api/server.js`: same paths, same
 * bodies, same status codes, same error strings (`Admin/js/firebase.js` prints
 * `body.error` straight to the user). The tenant always comes from the VERIFIED
 * token and never from the body, so an admin can only ever write under its own
 * `outlets/{bid}/{oid}/` prefix. Objects are stored byte-for-byte (no re-encode,
 * so a payment QR stays scannable and a PNG keeps alpha) and served through a
 * per-object download token; the bucket itself denies all client access
 * (`storage.rules`).
 *
 * Wiring: `config/mediaUrl` in RTDB points the dashboards here. The client falls
 * back to `config/tunnelUrl` when it is absent, so nothing breaks if this
 * function is deleted.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import crypto from 'crypto';
import { initializeAdmin, getDB, getAuth, getAdminApp } from '../shared/firebase/admin';

const MEDIA_BUCKET = (process.env.FIREBASE_STORAGE_BUCKET || 'foodhubbie-10.firebasestorage.app').trim();
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// Object paths are browsed by humans when debugging; spell them properly.
const PLURAL: Record<string, string> = {
  dish: 'dishes',
  category: 'categories',
  combo: 'combos',
  setting: 'settings',
  rider: 'riders',
};

/**
 * CORS allowlist — mirrors the control API's list, plus the localhost origins
 * `tools/serve-dist.cjs` uses (localhost is a browser-side call that still needs
 * a valid ID token, so this adds no reach to an anonymous caller).
 */
const DASHBOARD_ORIGINS: Array<string | RegExp> = [
  'https://foodhubbie-admins.web.app',
  'https://foodhubbie-supremeadmin.web.app',
  'https://app.foodhubbie.in',
  'https://control.foodhubbie.in',
  'https://rider.foodhubbie.in',
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function mediaSeg(s: any): string {
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function mediaPrefix(bid: string, oid: string): string {
  return `outlets/${mediaSeg(bid)}/${mediaSeg(oid)}/`;
}

function mediaPublicUrl(filePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${MEDIA_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

function mediaPathFromUrl(url: any): string | null {
  const m = /\/o\/([^?#]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * `requireTenantAdmin`, unchanged in behaviour: token → `admins/{uid}` → outlet →
 * business (stored value first, then the canonical `outletIndex`, then the legacy
 * full-tree scan) → the outlet must really exist under that business.
 */
async function tenantFromToken(req: any): Promise<{ bid: string; oid: string; uid: string }> {
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

async function readJsonBody(req: any): Promise<any> {
  const raw: Buffer | null = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
  if (raw) {
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large (max 8 MB)');
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
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large (max 8 MB)');
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
function routeOf(req: any): string {
  let path = String(req.path || '');
  if (!path) {
    try {
      path = new URL(String(req.url || '/'), 'https://local').pathname;
    } catch {
      path = '/';
    }
  }
  path = path.replace(/^\/+tenantMedia(?=\/|$)/, '').replace(/\/+$/, '');
  return path || '/';
}

async function handleUpload(req: any, res: any): Promise<void> {
  const { bid, oid } = await tenantFromToken(req);
  const body = await readJsonBody(req);
  const { dataUrl, type, id } = body || {};

  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'dataUrl must be a base64 image data URI');
  if (!type || !id) throw new HttpError(400, 'type and id are required');

  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new HttpError(400, `Unsupported image type ${mime}`);

  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new HttpError(400, 'Empty image');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image too large (max 6 MB)');

  const filePath = `${mediaPrefix(bid, oid)}${PLURAL[type] || `${mediaSeg(type)}s`}/${mediaSeg(id)}/original.${ext}`;
  const token = crypto.randomUUID();
  await getAdminApp().storage().bucket(MEDIA_BUCKET).file(filePath).save(buf, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  logger.info('[Media] upload', { bid, oid, filePath, bytes: buf.length });
  res.json({ ok: true, url: mediaPublicUrl(filePath, token), path: filePath, bytes: buf.length });
}

async function handleDelete(req: any, res: any): Promise<void> {
  const { bid, oid } = await tenantFromToken(req);
  const body = await readJsonBody(req);
  const filePath = mediaPathFromUrl(body && body.url);
  if (!filePath) throw new HttpError(400, 'url is required');
  if (!filePath.startsWith(mediaPrefix(bid, oid))) {
    throw new HttpError(403, 'Not an image of this outlet');
  }
  await getAdminApp().storage().bucket(MEDIA_BUCKET).file(filePath).delete({ ignoreNotFound: true });
  res.json({ ok: true });
}

export const tenantMedia = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    cpu: 1,
    timeoutSeconds: 60,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 10,
    ingressSettings: 'ALLOW_ALL',
    cors: DASHBOARD_ORIGINS,
    secrets: ['FIREBASE_DATABASE_URL'],
    labels: { 'critical-path': 'true' },
  },
  async (req, res) => {
    const route = routeOf(req);
    res.set('Cache-Control', 'no-store');
    try {
      // Cheap liveness probe: no auth, no DB, no bucket.
      if (route === '/health' && req.method === 'GET') {
        res.json({ ok: true, service: 'tenant-media', bucket: MEDIA_BUCKET });
        return;
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      await initializeAdmin();
      if (route === '/tenant-api/upload') {
        await handleUpload(req, res);
        return;
      }
      if (route === '/tenant-api/delete-image') {
        await handleDelete(req, res);
        return;
      }
      throw new HttpError(404, `Unknown route ${route}`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) {
        logger.error('[Media] request failed', { route, method: req.method, error: (err as Error).message });
        res.status(500).json({
          error: route === '/tenant-api/delete-image'
            ? `Delete failed — ${(err as Error).message}`
            : `Upload failed — ${(err as Error).message}`,
        });
        return;
      }
      res.status(status).json({ error: (err as Error).message });
    }
  },
);
