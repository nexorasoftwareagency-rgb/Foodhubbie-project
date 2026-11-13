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
import { initializeAdmin, getAdminApp } from '../shared/firebase/admin';
import { HttpError, readJsonBody as readJsonBodyShared, routeOf as routeOfShared, tenantFromToken } from '../shared/http/tenant';

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

/** Media-local wrappers: same caps and messages the control API used. */
const readJsonBody = (req: any) =>
  readJsonBodyShared(req, MAX_BODY_BYTES, 'Payload too large (max 8 MB)');
const routeOf = (req: any) => routeOfShared(req, 'tenantMedia');

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
