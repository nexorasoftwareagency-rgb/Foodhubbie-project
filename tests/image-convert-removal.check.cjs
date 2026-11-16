#!/usr/bin/env node
/**
 * Image-convert removal guard (batch 23k).
 *
 *   node tests/image-convert-removal.check.cjs
 *
 * `/api/images/convert` and `/api/images/convert-batch` were DELETED, not
 * ported to Functions. The pre-pass fetched the template status images,
 * converted them to PNG and wrote base64 into `bot/{key}Png` — a node the bot
 * never reads (it reads `settings/Bot`), for a tenant estate that carries zero
 * `*Png` keys, and base64 in RTDB is what batches 13/15 removed. Template
 * defaults already ship https JPEG URLs and the bot converts/falls back at
 * send time. Full evidence: FIREBASE_SERVER_MIGRATION/39_IMAGE_CONVERT_ROUTES.md.
 *
 * This guard stops the optimisation from being reinvented on the box, in the
 * wizard, or in the Functions bundle. Static only — no network, no credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// Scan code, not prose: the wizard and server both keep a comment naming the
// removed route so the next reader finds doc 39.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERVER = 'bot-control-api/server.js';
const SERVER_PKG = 'bot-control-api/package.json';
const WIZARD = 'SupremeAdmin/js/features/restaurant-onboarding.js';
const BOT = 'bot/index.js';
const SEED_TEMPLATES = 'tools/seed-templates.cjs';
const FN_PKG = 'FIREBASE_SERVER_MIGRATION/functions/package.json';
const DOC = 'FIREBASE_SERVER_MIGRATION/39_IMAGE_CONVERT_ROUTES.md';

const server = stripComments(read(SERVER));
const serverPkg = JSON.parse(read(SERVER_PKG));
const wizard = stripComments(read(WIZARD));
const bot = read(BOT);

let pass = 0;
const ok = (label, cond, detail) => {
  if (!cond) {
    console.error('  FAIL  ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
    process.exitCode = 1;
    return;
  }
  pass++;
  console.log('  ok  ' + label);
};

// --- 1. The control API no longer serves either route ----------------------
ok('control API has no /api/images/convert route', !/['"`]\/api\/images\/convert['"`]/.test(server));
ok('control API has no /api/images/convert-batch route', !/convert-batch/.test(server));
ok("control API no longer requires 'sharp'", !/require\(\s*['"]sharp['"]\s*\)/.test(server));
ok('bot-control-api package.json drops the sharp dependency', !('sharp' in (serverPkg.dependencies || {})));

// --- 2. The wizard no longer calls it or writes *Png -----------------------
ok('onboarding wizard makes no convert-batch request', !/convert-batch/.test(wizard));
ok('onboarding wizard builds no imagesToConvert list', !/imagesToConvert/.test(wizard));
ok('onboarding wizard writes no `${key}Png` RTDB field', !/\$\{[^}]*\}Png/.test(wizard));

// --- 3. Nothing else in the app writes a *Png status key -------------------
// customer-app.js legitimately composes a QR PNG in the browser; that string
// never names a status image and never reaches RTDB as base64.
const CLIENT_DIRS = ['Admin/js', 'SupremeAdmin/js', 'menu/js', 'shared'];
const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
};
const offenders = [];
for (const dir of CLIENT_DIRS) {
  for (const file of walk(dir)) {
    const code = stripComments(read(file));
    if (/img[A-Za-z]*Png/.test(code)) offenders.push(file);
    // A bare `${...}Png` key build is the exact shape the pre-pass used.
    if (/\$\{[^}]{0,40}\}Png\b/.test(code)) offenders.push(file);
  }
}
ok('no client writes an img*Png / ${key}Png status field', offenders.length === 0, offenders);

// --- 4. The premise: template defaults are https URLs, not base64 ----------
const seed = read(SEED_TEMPLATES);
ok(
  'template defaults still ship https status-image URLs',
  /imgConfirmed:\s*'https:\/\//.test(seed)
);

// --- 5. sharp stays out of the Functions bundle ----------------------------
const fnPkg = JSON.parse(read(FN_PKG));
ok('functions/package.json does not depend on sharp', !('sharp' in (fnPkg.dependencies || {})));
ok('functions/package.json does not depend on sharp (dev)', !('sharp' in (fnPkg.devDependencies || {})));

// --- 6. The bot's read-side tolerance is deliberate and stays -------------
// A legacy `*Png` value (none exist today) still sends; do not "clean up" the
// bot without reading doc 39 — the fast path is what makes such a value safe.
ok('bot still prefers a legacy *Png value when present', /imgPlacedPng \|\| botSettings\.imgPlaced/.test(bot));
ok(
  'bot keeps the pre-converted PNG fast path',
  /startsWith\('data:image\/png;base64,'\)/.test(bot)
);

// --- 7. The decision is recorded ------------------------------------------
ok('decision doc exists', exists(DOC));
if (exists(DOC)) {
  const doc = read(DOC);
  ok('doc records the delete-not-port decision', /delete|deleted|remove|removed/i.test(doc));
  ok('doc names the dead write target', /bot\/\{key\}Png|bot\/\$\{key\}Png|`bot\/\{key\}Png`/.test(doc));
}

if (process.exitCode) {
  console.error(`\nimage-convert removal guard: FAILED (${pass} passed)`);
} else {
  console.log(`\nimage-convert removal guard: ${pass}/${pass} passed`);
}
