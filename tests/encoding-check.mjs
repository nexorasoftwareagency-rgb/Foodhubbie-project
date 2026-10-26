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
];
const EXTS = /\.(js|mjs|html|css|txt|json)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

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
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const txt = fs.readFileSync(file, 'utf8');
    const hits = MOJIBAKE.filter((m) => txt.includes(m));
    if (txt.charCodeAt(0) === 0xfeff) hits.push('UTF-8 BOM');
    if (C1.test(txt)) hits.push('C1 control chars');
    if (txt.includes(REPLACEMENT)) hits.push('U+FFFD replacement char');
    if (hits.length) bad.push(`${file}: ${hits.join(' ')}`);
  }
}

assert.deepEqual(bad, [], 'corrupted text found (mojibake / BOM / C1 controls / U+FFFD):\n' + bad.join('\n'));
console.log('encoding ok - no double-encoded text, no BOM, no C1 controls, no U+FFFD');
