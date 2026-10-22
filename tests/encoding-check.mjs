// Guard: no double-encoded UTF-8 in user-facing source.
// A few files were once written as UTF-8 but read back as cp1252, so "₹"
// became "â‚¹" and "—" became "â€"" on screen. Run: node tests/encoding-check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['menu', 'Admin', 'SupremeAdmin', 'website', 'rider-app/src', 'shared'];
const EXTS = /\.(js|mjs|html|css|txt|json)$/;

// Sequences that only exist when UTF-8 bytes were decoded as cp1252.
const MOJIBAKE = [
  'â‚¹', // ₹
  'â€"', // —
  'â€¦', // …
  'â€™', // '
  'â€œ', // "
  'â€˜', // '
  'âˆ', // →
  'âœ…', // …
  'Ã—', // ×
  'Â·', // ·
  'ðŸ', // emoji
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
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
    const hits = MOJIBAKE.filter(m => txt.includes(m));
    if (hits.length) bad.push(`${file}: ${hits.join(' ')}`);
  }
}

assert.deepEqual(bad, [], 'double-encoded UTF-8 found:\n' + bad.join('\n'));
console.log('encoding ok - no double-encoded text');
