/**
 * Publish the demo under the MARKETING site so the public link is
 * https://www.foodhubbie.in/demo (the apt "Demo URL and Link").
 *
 * Why a copy instead of a rewrite across hosting sites: a Firebase Hosting
 * rewrite can only serve files from its own `public` dir (or a function / Cloud
 * Run), so `foodhubbie-web` (public: website/) cannot point at Admin/dist.
 * A 301 to foodhubbie-admins.web.app/demo would work but leaks the backend
 * domain into the address bar, so the demo is mirrored instead.
 *
 * Single source of truth: everything is generated from Admin/dist + the repo
 * `shared/` modules after `npm run build:admin`. The output dir is gitignored
 * and tools/check-demo-nav.cjs fails if the mirror drifts from the build.
 *
 * Run: node tools/build-demo-site.mjs   (npm run build:demo-site)
 */

import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'Admin', 'dist');
const OUT = join(root, 'website', 'demo');

if (!existsSync(join(DIST, 'demo.html'))) {
    console.error('Admin/dist/demo.html is missing — run `npm run build:admin` first.');
    process.exit(1);
}

// Rebuild from scratch so a removed demo module cannot linger in the mirror.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// --- 1. shell -----------------------------------------------------------------
// Asset URLs are rewritten to absolute /demo/* paths so the page works at both
// /demo (rewrite) and /demo/ (directory index) without relative-path surprises.
let html = readFileSync(join(DIST, 'demo.html'), 'utf8');
const rewrites = [
    ['href="style.css', 'href="/demo/style.css'],
    ['href="icon-erp-logo.png', 'href="/demo/icon-erp-logo.png'],
    ['src="icon-erp-logo.png', 'src="/demo/icon-erp-logo.png'],
    ['src="js/demo/main.js', 'src="/demo/js/demo/main.js'],
];
for (const [from, to] of rewrites) {
    if (!html.includes(from)) {
        console.error(`FATAL: Admin/dist/demo.html no longer contains ${from} — update tools/build-demo-site.mjs`);
        process.exit(1);
    }
    html = html.split(from).join(to);
}
writeFileSync(join(OUT, 'index.html'), html);

// --- 2. assets ----------------------------------------------------------------
cpSync(join(DIST, 'style.css'), join(OUT, 'style.css'));
cpSync(join(DIST, 'icon-erp-logo.png'), join(OUT, 'icon-erp-logo.png'));
cpSync(join(DIST, 'js', 'demo'), join(OUT, 'js', 'demo'), { recursive: true });
// The demo imports ../../shared/* → /demo/shared/* here.
cpSync(join(DIST, 'shared'), join(OUT, 'shared'), { recursive: true });

// --- 3. assert the boundary survived the copy ---------------------------------
const outHtml = readFileSync(join(OUT, 'index.html'), 'utf8');
if (/firebase/i.test(outHtml)) {
    console.error('FATAL: mirrored demo shell references firebase — refusing to publish.');
    process.exit(1);
}
if (!outHtml.includes('/demo/js/demo/main.js')) {
    console.error('FATAL: mirrored shell does not point at /demo/js/demo/main.js.');
    process.exit(1);
}

const count = (dir) => readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
const kb = (p) => (statSync(p).size / 1024).toFixed(1);

console.log(`  demo mirror: website/demo  (${count(OUT)} files, index.html ${kb(join(OUT, 'index.html'))}KB)`);
console.log('  served at: /demo  →  /demo/index.html');
console.log('build-demo-site OK');
