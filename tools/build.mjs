import * as esbuild from 'esbuild';
import { PurgeCSS } from 'purgecss';
import { readFile, writeFile, readdir, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { join, dirname, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const JS_EXTS = new Set(['.js', '.mjs']);
const CSS_EXTS = new Set(['.css']);
const COPY_EXTS = new Set(['.html', '.json', '.txt', '.png', '.jpeg', '.jpg', '.svg', '.ico', '.webp', '.woff', '.woff2']);

const TARGETS = {
  admin: { src: join(root, 'Admin'), dist: join(root, 'Admin', 'dist'), shared: true },
  supreme: { src: join(root, 'SupremeAdmin'), dist: join(root, 'SupremeAdmin', 'dist'), shared: false },
};

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

async function buildTarget(name, { src: srcDir, dist: distDir, shared }) {
  console.log(`\nBuilding: ${name} — ${srcDir} → ${distDir}`);

  // Clean dist
  if (existsSync(distDir)) {
    const { rmSync } = await import('fs');
    rmSync(distDir, { recursive: true, force: true });
  }

  const allFiles = await walk(srcDir);
  const jsFiles = allFiles.filter(f => JS_EXTS.has(extname(f)));
  const cssFiles = allFiles.filter(f => CSS_EXTS.has(extname(f)));
  const copyFiles = allFiles.filter(f => !JS_EXTS.has(extname(f)) && !CSS_EXTS.has(extname(f)));

  // Minify CSS
  for (const file of cssFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    await mkdir(dirname(out), { recursive: true });
    await esbuild.build({ entryPoints: [file], outfile: out, minify: true, allowOverwrite: true });
    console.log(`  CSS: ${rel}`);
  }

  // Purge unused CSS
  if (cssFiles.length) {
    console.log('  PurgeCSS: scanning HTML + JS...');
    const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
    const contentFiles = [...htmlFiles, ...jsFiles];

    for (const file of cssFiles) {
      const rel = relative(srcDir, file);
      const out = join(distDir, rel);
      const purged = await new PurgeCSS().purge({
        content: contentFiles.map(f => ({ raw: readFileSync(f, 'utf8'), extension: extname(f) })),
        css: [{ raw: await readFile(out, 'utf8') }],
        safelist: {
          standard: [
            /^active$/, /^hidden$/, /^open$/, /^seamless-mode/, /^fade-out/,
            /^connected$/, /^disconnected$/, /^connecting$/, /^loading-/,
            /^flex$/, /^dragover$/, /^swal2-/, /^modal-/, /^toast-/, /^notif-/,
            /^tab-/, /^sidebar-/, /^menu-/, /^dropdown-/, /^drawer-/,
            /^order-/, /^table-/, /^kds-/, /^pos-/, /^mob-/, /^rider-/,
            /^btn-/, /^icon-/, /^admin-/, /^report-/, /^discount-/, /^channel-/,
            /^promo-/, /^settings-/, /^catalog-/, /^inventory-/, /^chat-/,
            /^dynamic-modal/, 'dynamic-modal-overlay', 'dynamic-modal-box',
            'dynamic-modal-title', 'dynamic-modal-text', 'dynamic-modal-actions',
            'dynamic-modal-icon', 'dynamic-modal-scroll', 'dynamic-modal-input',
            'btn-confirm', 'btn-cancel',
            'top-spender-card', 'spender-name', 'spender-phone', 'spender-total', 'spender-meta',
            'top-item-card', 'top-item-rank', 'top-item-name', 'top-item-count',
            'top-item-bar-bg', 'top-item-bar-fill', 'top-item-row', 'top-cust-row',
            'dashboard-grid', 'dashboard-main', 'dashboard-sidebar',
            'kpi-card-v4', 'priority-card-v4', 'priority-order-list',
            'priority-section', 'recent-section', 'premium-stat-row',
          ],
        },
      });
      if (purged[0]?.css) {
        await writeFile(out, purged[0].css);
        const before = (await readFile(file, 'utf8')).length;
        const after = purged[0].css.length;
        console.log(`  Purge: ${rel} (${formatSize(before)} → ${formatSize(after)}, -${Math.round((1 - after / before) * 100)}%)`);
      }
    }
  }

  // Minify JS
  for (const file of jsFiles) {
    const rel = relative(srcDir, file);
    const out = join(distDir, rel);
    await mkdir(dirname(out), { recursive: true });
    await esbuild.build({
      entryPoints: [file],
      outfile: out,
      minify: true,
      format: 'esm',
      allowOverwrite: true,
      treeShaking: false,
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

  // Emit shared/ into dist (only for Admin, which imports ../../shared/*)
  if (shared) {
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
  }

  // User manual (admin only): markdown is the source of truth in docs/
  if (name === 'admin') {
    const mdPath = join(root, 'docs', 'MANAGER-PIN-USER-MANUAL.md');
    if (existsSync(mdPath)) {
      await writeFile(join(distDir, 'manual.html'), manualPage(mdToHtml(await readFile(mdPath, 'utf8'))));
      console.log('  MANUAL: docs/MANAGER-PIN-USER-MANUAL.md → dist/manual.html');
    }
  }

  // Report savings
  let origSize = 0, newSize = 0;
  for (const f of allFiles) {
    const rel = relative(srcDir, f);
    const out = join(distDir, rel);
    origSize += (await readFile(f)).length;
    if (existsSync(out)) newSize += (await readFile(out)).length;
  }
  console.log(`Done: ${formatSize(origSize)} → ${formatSize(newSize)} (saved ${formatSize(origSize - newSize)})`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// --- User manual: docs/MANAGER-PIN-USER-MANUAL.md -> dist/manual.html (admin only).
// Subset renderer for exactly the constructs that manual uses; no markdown dep.
const mdEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mdSlug = t => t.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function mdInline(src) {
  const stash = [];
  const t = src.replace(/`([^`]+)`/g, (_, c) => { stash.push(c); return `\u0000${stash.length - 1}\u0000`; });
  return mdEsc(t)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${mdEsc(stash[i])}</code>`);
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const isStart = l => /^(```|#{1,6}\s|\||>|\s*-\s|\s*\d+\.\s|-{3,}\s*$)/.test(l);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${mdEsc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^#{1,6}\s/.test(l)) {
      const m = l.match(/^(#{1,6})\s+(.*)$/);
      out.push(`<h${m[1].length} id="${mdSlug(m[2])}">${mdInline(m[2])}</h${m[1].length}>`);
      i++; continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<div class="scroll"><table><thead><tr>'
        + head.map(c => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }
    if (/^>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${mdInline(buf.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^\s*-\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*-\s+/, ''));
      out.push(`<ul>${items.map(x => `<li>${mdInline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ''));
      out.push(`<ol>${items.map(x => `<li>${mdInline(x)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !isStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${mdInline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

function manualPage(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>User Manual — Manager PIN &amp; Discount Approval Ceiling</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;padding:40px 20px 96px;background:#f8fafc;color:#0f172a;font-family:'Inter',system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.65}
.wrap{max-width:900px;margin:0 auto}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.brand{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#E84908}
.back{font-size:14px;font-weight:600;color:#E84908;text-decoration:none;border:1.5px solid rgba(232,73,8,.2);border-radius:9px;padding:7px 13px;background:#fff}
.back:hover{background:#fef0e8}
article{background:#fff;border:1.5px solid rgba(232,73,8,.12);border-radius:16px;padding:36px clamp(18px,4vw,46px);box-shadow:0 8px 30px rgba(15,23,42,.06)}
h1{font-size:clamp(25px,4vw,35px);line-height:1.2;margin:0 0 16px}
h2{font-size:clamp(19px,2.6vw,25px);line-height:1.3;margin:44px 0 14px;padding-top:24px;border-top:1.5px solid rgba(232,73,8,.12)}
article>h2:first-child{border-top:0;padding-top:0;margin-top:8px}
h3{font-size:17px;margin:28px 0 10px}
p{margin:12px 0}
a{color:#E84908}
ul,ol{margin:12px 0;padding-left:22px}
li{margin:7px 0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.875em;background:#f1f5f9;border:1px solid rgba(232,73,8,.1);border-radius:5px;padding:1px 6px;white-space:nowrap}
pre{background:#0f172a;color:#e2e8f0;padding:16px 18px;border-radius:10px;overflow-x:auto}
pre code{background:none;border:0;padding:0;color:inherit;font-size:14px;line-height:1.6;white-space:pre}
blockquote{margin:18px 0;padding:13px 18px;background:#fef0e8;border-left:4px solid #E84908;border-radius:0 10px 10px 0;font-weight:500}
blockquote p{margin:0}
hr{border:0;border-top:1.5px solid rgba(232,73,8,.14);margin:34px 0}
.scroll{overflow-x:auto;margin:18px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{border:1px solid rgba(232,73,8,.16);padding:9px 12px;text-align:left;vertical-align:top}
th{background:#fef0e8;font-weight:700}
tbody tr:nth-child(even){background:#f8fafc}
@media(max-width:640px){body{padding:24px 12px 64px}article{padding:22px 14px;border-radius:12px}code{white-space:normal}}
</style>
</head>
<body>
<div class="wrap">
<header class="topbar">
<p class="brand">FoodHubbie ERP &middot; Admin</p>
<a class="back" href="./">&larr; Back to dashboard</a>
</header>
<article>
${body}
</article>
</div>
</body>
</html>
`;
}

// Parse CLI args: --admin, --supreme, or both
const args = process.argv.slice(2);
const targets = args.length
  ? args.filter(a => a.startsWith('--')).map(a => a.slice(2))
  : Object.keys(TARGETS);

const invalid = targets.filter(t => !TARGETS[t]);
if (invalid.length) {
  console.error(`Unknown target: ${invalid.join(', ')}. Valid: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}

Promise.all(targets.map(t => buildTarget(t, TARGETS[t])))
  .then(() => console.log('\nAll targets built.'))
  .catch(e => { console.error(e); process.exit(1); });
