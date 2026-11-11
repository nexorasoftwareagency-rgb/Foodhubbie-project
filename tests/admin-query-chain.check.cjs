'use strict';
/**
 * Guard: a database Reference has no query methods.
 *
 * The modular Firebase SDK puts ordering/filtering on `query(ref, ...)`, not on
 * the reference. `Outlet.ref('x').orderByChild('y')` throws
 * "orderByChild is not a function" at runtime — and because the listen happens
 * inside a try/catch in switchTab, the tab just renders empty instead of
 * failing loudly. That exact line in Admin/js/features/chat.js shipped in
 * 7d084f5 and left the Chat tab empty for months (found 2026-11-11, batch 19).
 *
 * Rule: `.orderByChild(` / `.limitToLast(` / `.startAt(` / `.endAt(` /
 * `.endBefore(` / `.equalTo(` must never be chained directly onto a
 * `ref(...)` call. Wrap it: query(ref(...), orderByChild('x'), limitToLast(n)).
 *
 * Run: node tests/admin-query-chain.check.cjs   (npm run test:admin-query-chain)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['Admin/js', 'SupremeAdmin/js', 'menu/js', 'website', 'rider-app/src'];
const QUERY_METHODS = ['orderByChild', 'orderByKey', 'orderByValue', 'limitToFirst', 'limitToLast', 'startAt', 'endAt', 'endBefore', 'equalTo'];

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      walk(rel, out);
    } else if (/\.(js|mjs|ts)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

let files = 0;
const problems = [];

for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    files++;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // Strip line comments so the documentation of this very rule never trips it.
      const code = line.replace(/\/\/.*$/, '');
      const m = code.match(/ref\s*\([^;]*?\)\s*\.\s*([A-Za-z]+)\s*\(/);
      if (m && QUERY_METHODS.includes(m[1])) {
        problems.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (problems.length) {
  console.error(`\nReference method misuse (a Reference has no .${QUERY_METHODS.join('/.')}):\n`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nUse query(ref(...), orderByChild(...), limitToLast(...)) instead.\n');
  process.exit(1);
}
console.log(`admin-query-chain ok — ${files} files, no Reference chained with a query method`);
