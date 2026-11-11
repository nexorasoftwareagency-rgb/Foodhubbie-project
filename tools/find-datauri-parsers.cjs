#!/usr/bin/env node
/**
 * Batch 15 pre-flight: find code that PARSES a data URI. Those are the only
 * places a Storage URL would break, so they must be reviewed before the rewrite.
 * Read-only. Run from the repo root.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOTS = ['Admin/js', 'SupremeAdmin/js', 'menu/js', 'bot', 'bot-control-api', 'shared', 'website', 'rider-app/src'];
const SKIP = /(node_modules|[\\/]dist[\\/]|[\\/]lib[\\/]|\.min\.js$)/;

const PATTERNS = [
  { name: 'split data URI', re: /split\(\s*['"]?,[\s\S]{0,20}\)\s*\[\s*1\s*\]/ },
  { name: 'strip data URI prefix', re: /replace\(\s*\/\^data:/ },
  { name: 'test for data: prefix', re: /(startsWith|indexOf|includes)\(\s*['"]data:/ },
  { name: 'regex on data:image', re: /\/\^?data:image/ },
  { name: 'base64 decode', re: /Buffer\.from\([^)]*['"]base64['"]/ },
];

const files = [];
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) files.push(p);
  }
}
for (const r of ROOTS) walk(r);

const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    // ignore pure comments to keep the report actionable
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const p of PATTERNS) {
      if (p.re.test(line)) hits.push({ f, n: i + 1, kind: p.name, line: trimmed.slice(0, 120) });
    }
  });
}

console.log(`scanned ${files.length} source files\n`);
if (!hits.length) {
  console.log('No data-URI parsing found. A Storage URL is safe everywhere.');
  process.exit(0);
}
const byKind = {};
for (const h of hits) (byKind[h.kind] = byKind[h.kind] || []).push(h);
for (const [kind, rows] of Object.entries(byKind)) {
  console.log(`=== ${kind} (${rows.length}) ===`);
  for (const r of rows) console.log(`  ${r.f}:${r.n}  ${r.line}`);
  console.log('');
}
process.exit(0);
