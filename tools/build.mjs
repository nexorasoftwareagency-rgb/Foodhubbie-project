import * as esbuild from 'esbuild';
import { PurgeCSS } from 'purgecss';
import { readFile, writeFile, readdir, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'Admin');
const distDir = join(root, 'Admin', 'dist');

const JS_EXTS = new Set(['.js', '.mjs']);
const CSS_EXTS = new Set(['.css']);
const COPY_EXTS = new Set(['.html', '.json', '.txt', '.png', '.jpeg', '.jpg', '.svg', '.ico', '.webp', '.woff', '.woff2']);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  console.log(`Building: ${srcDir} → ${distDir}`);

  // Clean dist
  if (existsSync(distDir)) {
    // rm -rf equivalent
    const { rmSync } = await import('fs');
    rmSync(distDir, { recursive: true, force: true });
  }

  const allFiles = await walk(srcDir);
  const jsFiles = allFiles.filter(f => JS_EXTS.has(extname(f)));
  const cssFiles = allFiles.filter(f => CSS_EXTS.has(extname(f)));
  const copyFiles = allFiles.filter(f => !JS_EXTS.has(extname(f)) && !CSS_EXTS.has(extname(f)));

  // Minify CSS first (needed for PurgeCSS)
  for (const file of cssFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    await mkdir(dirname(out), { recursive: true });
    const result = await esbuild.build({
      entryPoints: [file],
      outfile: out,
      minify: true,
      allowOverwrite: true,
    });
    console.log(`  CSS: ${rel}`);
  }

  // Purge unused CSS
  console.log('  PurgeCSS: scanning HTML + JS...');
  const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
  const jsFilesForScan = allFiles.filter(f => JS_EXTS.has(extname(f)));
  const contentFiles = [...htmlFiles, ...jsFilesForScan];
  
  for (const file of cssFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    const purged = await new PurgeCSS().purge({
      content: contentFiles.map(f => ({ raw: readFileSync(f, 'utf8'), extension: extname(f) })),
      css: [{ raw: await readFile(out, 'utf8') }],
      safelist: {
        standard: [
          /^active$/,
          /^hidden$/,
          /^open$/,
          /^seamless-mode/,
          /^fade-out/,
          /^connected$/,
          /^disconnected$/,
          /^connecting$/,
          /^loading-/,
          /^flex$/,
          /^dragover$/,
          /^swal2-/,
          /^modal-/,
          /^toast-/,
          /^notif-/,
          /^tab-/,
          /^sidebar-/,
          /^menu-/,
          /^dropdown-/,
          /^drawer-/,
          /^order-/,
          /^table-/,
          /^kds-/,
          /^pos-/,
          /^mob-/,
          /^rider-/,
          /^btn-/,
          /^icon-/,
          /^admin-/,
          /^report-/,
          /^discount-/,
          /^promo-/,
          /^settings-/,
          /^catalog-/,
          /^inventory-/,
          /^chat-/,
          /^dynamic-modal/,
          'dynamic-modal-overlay',
          'dynamic-modal-box',
          'dynamic-modal-title',
          'dynamic-modal-text',
          'dynamic-modal-actions',
          'dynamic-modal-icon',
          'dynamic-modal-scroll',
          'dynamic-modal-input',
          'btn-confirm',
          'btn-cancel',
          'top-spender-card',
          'spender-name',
          'spender-phone',
          'spender-total',
          'spender-meta',
          'top-item-card',
          'top-item-rank',
          'top-item-name',
          'top-item-count',
          'top-item-bar-bg',
          'top-item-bar-fill',
          'top-item-row',
          'top-cust-row',
          'dashboard-grid',
          'dashboard-main',
          'dashboard-sidebar',
          'kpi-card-v4',
          'priority-card-v4',
          'priority-order-list',
          'priority-section',
          'recent-section',
          'premium-stat-row',
        ],
      },
    });
    if (purged[0]?.css) {
      await writeFile(out, purged[0].css);
      const before = (await readFile(file, 'utf8')).length;
      const after = purged[0].css.length;
      console.log(`  Purge: ${rel} (${formatSize(before)} → ${formatSize(after)}, -${Math.round((1 - after/before) * 100)}%)`);
    }
  }

  // Minify JS
  for (const file of jsFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    await mkdir(dirname(out), { recursive: true });
    const result = await esbuild.build({
      entryPoints: [file],
      outfile: out,
      minify: true,
      format: 'esm',
      allowOverwrite: true,
    });
    console.log(`  JS: ${rel}`);
  }

  // Copy other files
  for (const file of copyFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    await mkdir(dirname(out), { recursive: true });
    await copyFile(file, out);
  }

  // Emit shared/ into dist (Admin source imports ../../shared/*)
  const sharedDir = join(root, 'shared');
  if (existsSync(sharedDir)) {
    for (const file of await walk(sharedDir)) {
      const rel = relative(sharedDir, file);
      const out = join(distDir, 'shared', rel);
      await mkdir(dirname(out), { recursive: true });
      if (JS_EXTS.has(extname(file)) && extname(file) !== '.cjs') {
        await esbuild.build({ entryPoints: [file], outfile: out, minify: true, format: 'esm', allowOverwrite: true });
      } else {
        await copyFile(file, out);
      }
    }
    console.log('  SHARED: copied to dist/shared');
  }

  // Report savings
  let origSize = 0, newSize = 0;
  for (const f of allFiles) {
    const rel = relative(srcDir, f);
    const out = join(distDir, rel);
    origSize += (await readFile(f)).length;
    if (existsSync(out)) newSize += (await readFile(out)).length;
  }
  console.log(`\nDone: ${formatSize(origSize)} → ${formatSize(newSize)} (saved ${formatSize(origSize - newSize)})`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Need readFileSync for PurgeCSS content
import { readFileSync } from 'fs';

main().catch(e => { console.error(e); process.exit(1); });
