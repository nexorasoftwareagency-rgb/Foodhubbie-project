#!/usr/bin/env node
/**
 * Set the Cloud Storage bucket CORS config so browser JS can read stored media.
 *
 *   node tools/set-bucket-cors.cjs
 *   node tools/set-bucket-cors.cjs --bucket other-project.firebasestorage.app
 *
 * Why this is needed
 * ------------------
 * The Firebase Storage download endpoint returns the CORS headers of the BUCKET,
 * not of the request. With no `cors` config, `fetch(objectUrl)` from a dashboard
 * origin fails with "No 'Access-Control-Allow-Origin' header is present" while
 * `<img src>` renders fine — the request that matters is CORS-exempt. The OPTIONS
 * preflight still answers `Access-Control-Allow-Origin: *`, so the gap is easy to
 * miss until something converts an image to a Blob (canvas, share, client PDF).
 *
 * Found by the batch-13 live E2E: every `<img>` was fine, `fetch()` was not.
 *
 * Auth
 * ----
 * Must run where `firebase login` has been used: patching bucket metadata needs
 * the project owner, and the admin-SDK service account is denied
 * (`storage.buckets.update`). Object read/write is unaffected — the API writes
 * objects with the service account.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Every origin a Foodhubbie dashboard/app is served from. Keep in sync when a
// new domain is added, or browser fetches from it will be blocked.
const ORIGINS = [
  'https://foodhubbie-admins.web.app',
  'https://app.foodhubbie.in',
  'https://foodhubbie-supremeadmin.web.app',
  'https://menu.foodhubbie.in',
  'https://foodhubbie-qrmenu.web.app',
  'https://rider.foodhubbie.in',
  'https://foodhubbie.in',
  'https://www.foodhubbie.in',
  'https://foodhubbie-web.web.app',
  'http://localhost:5000',
  'http://localhost:8080',
];

const CORS = [{
  origin: ORIGINS,
  method: ['GET', 'HEAD'],
  responseHeader: ['Content-Type', 'Content-Length', 'Content-Range', 'Cache-Control', 'ETag'],
  maxAgeSeconds: 3600,
}];

// firebase-tools' public installed-app OAuth client (not a secret).
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BUCKET = argOf('bucket', process.env.FIREBASE_STORAGE_BUCKET || 'foodhubbie-10.firebasestorage.app');

async function accessToken() {
  if (!fs.existsSync(CONFIGSTORE)) {
    throw new Error(`no firebase-tools session at ${CONFIGSTORE} — run \`firebase login\` first`);
  }
  const tokens = JSON.parse(fs.readFileSync(CONFIGSTORE, 'utf8')).tokens || {};
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new Error('no refresh_token in the firebase-tools session');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`token refresh failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

(async () => {
  const at = await accessToken();
  const headers = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' };
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}`;

  const before = await fetch(`${url}?fields=cors`, { headers });
  console.log('bucket ', BUCKET);
  console.log('before ', before.status, JSON.stringify(((await before.json()).cors) || null).slice(0, 200));

  const patch = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ cors: CORS }) });
  if (patch.status >= 300) {
    throw new Error(`PATCH failed ${patch.status}: ${(await patch.text()).slice(0, 300)}`);
  }

  const after = await fetch(`${url}?fields=cors`, { headers });
  const cors = (await after.json()).cors || [];
  console.log('after  ', after.status, `${cors.length} rule(s), ${(cors[0] && cors[0].origin || []).length} origin(s)`);
  console.log('done');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
