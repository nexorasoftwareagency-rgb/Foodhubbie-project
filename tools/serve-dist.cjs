#!/usr/bin/env node
/**
 * Serves a built dashboard on localhost so Playwright/E2E/screenshot work never bills Hosting egress.
 *
 *   node tools/serve-dist.cjs admin            -> http://127.0.0.1:5055/index.html?demo=1
 *   node tools/serve-dist.cjs supreme [port]
 *
 * Why: every fresh browser context has an empty cache, so a cold load re-downloads the whole
 * shell PLUS the Service Worker precache list (~2.2 MB before the asset diet, ~0.55 MB after).
 * Two thousand of those is 4.5 GB of billable Hosting egress. Run visual/UI checks here; only
 * use the live site when the test itself is about the deployment (rules, headers, version.json).
 *
 * `localhost` is an authorized Firebase Auth domain, so `?demo=1` sign-in works against the
 * real backend here — the static shell is local, the data is still production.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TARGETS = {
  admin: { dir: 'Admin/dist', entry: 'index.html?demo=1' },
  supreme: { dir: 'SupremeAdmin/dist', entry: 'index.html' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.map': 'application/json',
};

const name = (process.argv[2] || 'admin').toLowerCase();
const target = TARGETS[name];
if (!target) {
  console.error(`unknown target "${name}" - use: ${Object.keys(TARGETS).join(' | ')}`);
  process.exit(1);
}
const ROOT = path.resolve(__dirname, '..', target.dir);
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`${target.dir} has no index.html - run: node tools/build.mjs --${name}`);
  process.exit(1);
}
const port = Number(process.argv[3] || (name === 'admin' ? 5055 : 5056));

http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  let file = path.resolve(ROOT, '.' + (clean === '/' ? '/index.html' : clean));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html'); // SPA fallback
  const buf = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}).listen(port, '127.0.0.1', () => {
  console.log(`${name}: http://127.0.0.1:${port}/${target.entry}`);
  console.log('(local static shell, real Firebase backend — zero Hosting egress)');
});
