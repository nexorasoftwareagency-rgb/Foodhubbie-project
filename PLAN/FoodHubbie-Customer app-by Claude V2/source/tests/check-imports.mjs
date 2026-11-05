import fs from 'fs';
import path from 'path';

const utilsSrc = fs.readFileSync('Admin/js/utils.js', 'utf8');
const exported = new Set();
for (const m of utilsSrc.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
for (const m of utilsSrc.matchAll(/export\s*\{([^}]+)\}/g)) {
  m[1].split(',').forEach(part => {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) exported.add(name);
  });
}

let bad = 0;
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
for (const file of walk('Admin/js')) {
  if (file.endsWith(path.join('js', 'utils.js'))) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](?:\.\.?\/)+utils\.js['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !exported.has(name)) { console.log('MISSING export:', name, '→ imported by', file); bad++; }
    }
  }
}
console.log(bad === 0 ? 'All utils.js imports resolve ✓' : `${bad} missing import(s)`);
