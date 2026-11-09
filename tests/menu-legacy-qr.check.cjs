#!/usr/bin/env node
/**
 * Legacy QR guard (menu-legacy-qr): a table QR printed before 2026-09-22 puts
 * the outlet in the path (`/pizza/?t=…`) or nothing at all (`/?t=…`), because
 * `_qrUrlForTable` only started emitting `&o=&b=` on 2026-09-22.
 *
 * Commit 4859e05 deleted the browser-side BUSINESS_BY_OUTLET map, so those URLs
 * read `businesses//…` → PERMISSION_DENIED, which boot() reported as a
 * connection problem the customer retried forever.
 *
 * Static — asserts the resolution logic, the honest failure copy, and that the
 * QR builder keeps emitting a complete link. Run: node tests/menu-legacy-qr.check.mjs
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const firebase = readFileSync(join(root, 'menu/js/firebase.js'), 'utf8');
const app = readFileSync(join(root, 'menu/js/app.js'), 'utf8');
const bot = readFileSync(join(root, 'bot/helpers/outlet-resolution.js'), 'utf8');
const tables = readFileSync(join(root, 'Admin/js/features/tables.js'), 'utf8');

let n = 0, failed = 0;
const ok = (cond, msg) => {
  n++;
  if (cond) console.log(`  ok ${n} - ${msg}`);
  else { failed++; console.log(`  NOT OK ${n} - ${msg}`); }
};

// --- 1. the browser fallback map exists and matches the bot twin ---
const MENU_MAP = firebase.match(/const BUSINESS_BY_OUTLET\s*=\s*\{([^}]*)\}/);
ok(!!MENU_MAP, 'menu/js/firebase.js carries the legacy outlet→business map');
const menuPairs = new Map(
  [...(MENU_MAP ? MENU_MAP[1] : '').matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]])
);
const BOT_MAP = bot.match(/const BUSINESS_BY_OUTLET\s*=\s*\{([^}]*)\}/);
const botPairs = new Map(
  [...(BOT_MAP ? BOT_MAP[1] : '').matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]])
);
ok(menuPairs.size > 0 && [...menuPairs].every(([k, v]) => botPairs.get(k) === v),
  `menu map agrees with bot/helpers/outlet-resolution.js (${[...menuPairs].map(([k, v]) => `${k}→${v}`).join(', ')})`);

// --- 2. resolution order: explicit ?b= wins, then the map, then nothing ---
ok(/export const BUSINESS_ID = _queryBusiness \|\| BUSINESS_BY_OUTLET\[OUTLET\] \|\| ''/.test(firebase),
  "BUSINESS_ID = ?b= || legacy map || '' (no silent roshani-pizza fallback)");
ok(/export const OUTLET = _queryOutlet \|\| pathOutlet \|\| ''/.test(firebase),
  'OUTLET has no silent default outlet');
ok(!/\|\|\s*'roshani-pizza'/.test(firebase), 'firebase.js holds no hardcoded business fallback');

// --- 3. incomplete links still refuse to boot against a guessed tenant ---
ok(/export const LINK_INCOMPLETE = \(!BUSINESS_ID \|\| !OUTLET\) && !_qs\.get\('t'\)/.test(firebase),
  'LINK_INCOMPLETE = no business OR no outlet, bypassed only by ?t= (legacy map can satisfy it)');

// --- 4. a ?t= link that still names no tenant fails HONESTLY, not as offline ---
ok(/import \{[^}]*BUSINESS_ID[^}]*\} from '\.\/firebase\.js'/.test(app),
  'app.js imports BUSINESS_ID for the tenant guard');
const guardIdx = app.indexOf('if (_tokenAttempted && (!BUSINESS_ID || !OUTLET))');
const bootIdx = app.indexOf('async function boot()');
const initIdx = app.indexOf('initSession().catch('); // the real call, not the mention in a comment
ok(guardIdx > 0 && bootIdx > 0 && guardIdx > bootIdx && initIdx > 0 && guardIdx < initIdx,
  'guard runs inside boot() before initSession() (where PERMISSION_DENIED was thrown)');
ok(/function _showOutdatedQr\(/.test(app), '_showOutdatedQr() exists');
ok(/_showOutdatedQr\(\)/.test(app), 'boot() calls _showOutdatedQr()');
ok(/This QR code is outdated/.test(app), 'tells the customer the QR is outdated');
ok(/getElementById\('invalidRetry'\)/.test(app) && /retry\.classList\.add\('hidden'\)/.test(app),
  'hides the "Try Again" button (a retry can never work)');

// --- 5. newly printed QRs keep carrying b= and o= (the shape that works) ---
ok(/_qrUrlForTable/.test(tables) && /o=\$\{encodeURIComponent\(Outlet\.current\)\}&b=\$\{encodeURIComponent\(BUSINESS_ID\(\)\)\}&t=/.test(tables),
  'Admin QR builder still emits ?o=&b=&t= (never regress to token-only)');

console.log(`\nmenu-legacy-qr ${n - failed}/${n} passed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
