// ponytail: one-file guard — run after the custom domain flip, before deploy
// Fails if any canonical / sitemap / llms / doc URL still points at foodhubbie-web.web.app
const fs = require('fs');
const path = require('path');

const OLD = 'https://foodhubbie-web.web.app';
const OLD_WWW = 'https://www.foodhubbie.in';
const ROOT = process.cwd();
const EXT = ['.html', '.xml', '.txt', '.md'];
const SKIP = new Set(['node_modules', '.git', '.firebase', '.playwright-mcp', '.pw-profile', 'wa-user-data', 'wa-user-data2', '.wa-sales-auth', '.agent', '.agents']);
// Append-only history: these legitimately record the pre-migration URL and must
// not be rewritten to make a guard pass. README.md describes the live
// www → apex → /demo redirect chain — a factual mention, not a stale link.
const SKIP_FILES = new Set([
  'PROJECT_LEDGER.md',
  path.join('docs', 'META-PLATFORM-AUDIT.md'),
  'README.md',
]);

let hits = 0;
let files = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (SKIP_FILES.has(path.relative(ROOT, full))) continue;
    if (!EXT.includes(path.extname(entry.name).toLowerCase())) continue;
    files++;
    let src;
    try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
    for (const needle of [OLD, OLD_WWW]) {
      let idx = src.indexOf(needle);
      while (idx !== -1) {
        hits++;
        const line = src.slice(0, idx).split('\n').length;
        console.log(`  ${path.relative(ROOT, full)}:${line} — still references ${needle}`);
        idx = src.indexOf(needle, idx + 1);
      }
    }
  }
}

walk(ROOT);
console.log(`\nScanned ${files} files. ${hits} reference(s) of ${OLD} or ${OLD_WWW} remain.`);
process.exit(hits === 0 ? 0 : 1);
