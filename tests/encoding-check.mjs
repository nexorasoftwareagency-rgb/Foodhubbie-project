// Guard: no double-encoded UTF-8 and no UTF-8 BOM in shipped source.
//
// Root cause this catches: PowerShell's Get-Content / Set-Content pair decodes
// UTF-8 as cp1252 and writes UTF-8 *with* a BOM, so "₹" becomes "â‚¹", "—"
// becomes "â€"" and every file gains a BOM. A single brand sweep did that to 72
// files on 2026-10-26 (see PROJECT_LEDGER.md). Run: node tests/encoding-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = [
  'menu',
  'Admin',
  'SupremeAdmin',
  'website',
  'rider-app/src',
  'shared',
  'bot',
  'bot-control-api',
  // Migration docs + the Functions deploy tree. Where it counts this scans the
  // BUILD output too (functions/lib): that is what gets deployed, so a
  // corrupted string there ships even if src/ is clean.
  'FIREBASE_SERVER_MIGRATION',
  // Hand-written plan/product docs (clean when adopted 2026-11-14).
  'docs',
];
// .cjs/.ts/.tsx/.jsx were missing, so the 2026-10-26 sweep left 12 corrupted
// rider-app/src/*.ts(x) files in the tree while this guard reported clean
// (the cp1252 round-trip produced printable chars in them, not C1 controls).
// .md because the docs are written through the same tools as code: on
// 2026-11-13 a corrupted AGENTS.md bullet was caught by reading a diff, not by
// this guard, and PROJECT_LEDGER.md had been sitting 81 chars corrupted.
const EXTS = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|txt|json|md)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

// Repo-root docs are outside every ROOT. AGENTS.md deliberately quotes this
// guard's own corruption signatures (the `₹` → `â‚¹` example and the Costs
// `ï£¿` range-bound bug), so those exact markers are exempt in that file only —
// any other marker, or either marker anywhere else, still fails.
const FILES = ['AGENTS.md', 'PROJECT_LEDGER.md'];
const DOC_QUOTE_EXEMPT = { 'AGENTS.md': ['â‚¹', 'ï£¿'] };

// Sequences that only exist when UTF-8 bytes were decoded as cp1252.
const MOJIBAKE = [
  'â‚¹', // ₹
  'â€"', // —
  'â€¦', // …
  'â€™', // '
  'â€œ', // "
  'â€˜', // '
  'âˆ', // →
  'â†', // → (variation seen in Admin help text)
  'â˜', // ★
  'âœ…', // …
  'Ã—', // ×
  'Â·', // ·
  'ðŸ', // emoji
  '\u00ef\u00a3\u00bf', // U+F8FF read back as cp1252 (date-range upper bound)
];
// C1 control chars are the fingerprint of a cp1252 round-trip; they never
// belong in source. U+FFFD means a byte was already lost (the tail of a
// half-written UTF-8 sequence) — unfixable once written, so fail loudly.
const C1 = /[\u0080-\u009f]/;
const REPLACEMENT = '\uFFFD';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // session_data_* is Baileys auth state, not source.
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || e.name.startsWith('session_data')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.test(e.name)) out.push(full);
  }
  return out;
}

const bad = [];

function check(file, txt) {
  const exempt = DOC_QUOTE_EXEMPT[file] || [];
  const hits = MOJIBAKE.filter((m) => !exempt.includes(m) && txt.includes(m));
  if (txt.charCodeAt(0) === 0xfeff) hits.push('UTF-8 BOM');
  if (C1.test(txt)) hits.push('C1 control chars');
  if (txt.includes(REPLACEMENT)) hits.push('U+FFFD replacement char');
  if (hits.length) bad.push(`${file}: ${hits.join(' ')}`);
}

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) check(file, fs.readFileSync(file, 'utf8'));
}
for (const file of FILES) {
  if (fs.existsSync(file)) check(file, fs.readFileSync(file, 'utf8'));
}

assert.deepEqual(bad, [], 'corrupted text found (mojibake / BOM / C1 controls / U+FFFD):\n' + bad.join('\n'));
console.log('encoding ok - no double-encoded text, no BOM, no C1 controls, no U+FFFD');
