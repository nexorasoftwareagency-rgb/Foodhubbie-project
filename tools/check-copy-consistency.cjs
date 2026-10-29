// Copy-consistency guard for the marketing site (website/).
// Catches the drift the SEO plan calls out: pricing numbers disagreeing between
// homepage / pricing / compare / FAQs, pizza terms leaking into public copy,
// a second contact number appearing in the canonical-fact files, and pages that
// ship without a sitemap entry.
//
// Run: node tools/check-copy-consistency.cjs   (exit 1 on any failure)

const fs = require('fs');

const SITE = 'website';
const html = fs.readdirSync(SITE).filter(f => f.endsWith('.html'));
const txt = fs.readdirSync(SITE).filter(f => f.endsWith('.txt'));
const PUBLIC = [...html.map(f => `${SITE}/${f}`), ...txt.map(f => `${SITE}/${f}`), 'docs/BACKLINK-KIT.md', 'docs/OFFSITE-KIT.md'];
const CANON_FILES = ['docs/BACKLINK-KIT.md', `${SITE}/contact.html`, `${SITE}/llms.txt`];

const CANON = { phone: '+919724649971', email: 'nileshshah84870@gmail.com' };

const BANNED = [
  [/1,?500\s*(one[-\s]time\s*)?setup/i, 'setup fee must be ₹500 - found a ₹1,500 setup claim'],
  [/0%\s*commission on per-order/i, 'ambiguous "0% commission" stat - name which plan 1% applies to'],
  [/pizz[ai]/i, 'pizza terms must not appear in public copy'],
  [/no ban risk|ban[- ]free|does not cost you the number/i, 'absolute WhatsApp ban-risk claim - Meta controls account standing'],
];

const PHONE_RE = /\+91[ -]?\d{2,5}[ -]?\d{4,6}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

// Visible copy only - a claim split across tags is still a claim.
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// Per-element text: keeps a table cell's price away from the next cell's price.
const chunks = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').split(/<[^>]+>/).map(s => s.replace(/\s+/g, ' ')).filter(Boolean);

// The rupee amount stated as the setup fee, read in both directions.
const SETUP_AMOUNTS = [
  /₹\s*([\d,]+)\s*(?:one[-\s]time\s+)?(?:software\s+)?setup/i,
  /setup(?:\s+fee)?\s*(?:is|of|:|=|at|costs?)?\s*₹\s*([\d,]+)/i,
];

let bad = 0;
const fail = (f, msg) => { console.log('FAIL', f, '-', msg); bad++; };

for (const f of PUBLIC) {
  const c = fs.readFileSync(f, 'utf8');
  const t = text(c);
  for (const [re, msg] of BANNED) {
    const m = t.match(re);
    if (m) fail(f, `${msg} -> "${m[0]}"`);
  }
  for (const chunk of chunks(c)) {
    for (const re of SETUP_AMOUNTS) {
      const m = chunk.match(re);
      if (m && m[1].replace(/,/g, '') !== '500') fail(f, `setup fee must be ₹500, found ₹${m[1]} -> "${chunk.slice(0, 90)}"`);
    }
  }
}

for (const f of CANON_FILES) {
  const c = fs.readFileSync(f, 'utf8');
  for (const m of c.match(PHONE_RE) || []) {
    if (m.replace(/[ -]/g, '') !== CANON.phone) fail(f, `stray phone ${m}`);
  }
  for (const m of c.match(EMAIL_RE) || []) {
    if (m.toLowerCase() !== CANON.email) fail(f, `stray email ${m}`);
  }
}

// Every page that declares a canonical must be in the sitemap; sitemap must not list a
// missing page. Pages without a canonical (404, GSC verification token) are not indexable.
// ORIGIN: migrated 2026-10-26 — canonical is the apex (www 301s here); was foodhubbie-web.web.app.
const ORIGIN = 'https://foodhubbie.in';
const sitemap = fs.readFileSync(`${SITE}/sitemap.xml`, 'utf8');
const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
const listed = new Set(locs.map(u => u.replace(ORIGIN, '').replace(/^\//, '').replace(/\/$/, '')));
for (const f of html) {
  const c = fs.readFileSync(`${SITE}/${f}`, 'utf8');
  const canon = c.match(/<link rel="canonical" href="https:\/\/foodhubbie\.in\/(.*?)"/);
  if (!canon) continue;
  const slug = canon[1].replace(/\/$/, '');
  if (!listed.has(slug)) fail(`${SITE}/sitemap.xml`, `missing page ${slug}`);
}
for (const slug of listed) {
  if (slug && !fs.existsSync(`${SITE}/${slug}.html`) && !fs.existsSync(`${SITE}/${slug}/index.html`)) {
    // /demo and /demo/tour (rewrite to the same mirror) are generated from
    // Admin/dist by tools/build-demo-site.mjs and are gitignored, so a fresh
    // clone has nothing to stat; tools/check-demo-nav.cjs proves the built
    // mirror exists and is current.
    if (slug !== 'demo' && slug !== 'demo/tour') fail(`${SITE}/sitemap.xml`, `lists missing page ${slug}`);
  }
}

// FAQPage structured data must repeat the visible <details> copy verbatim - Google requires
// the marked-up answer to be on the page.
const entities = (s) => s.replace(/&amp;/g, '&').replace(/&rsquo;/g, '\u2019').replace(/&nbsp;/g, ' ').replace(/&#8377;/g, '\u20B9').replace(/\s+/g, ' ').trim();
for (const f of html) {
  const c = fs.readFileSync(`${SITE}/${f}`, 'utf8');
  const faq = [...c.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1])).find(b => b['@type'] === 'FAQPage');
  if (!faq) continue;
  const visible = entities(text(c));
  for (const q of faq.mainEntity || []) {
    const a = entities(q.acceptedAnswer.text);
    if (!visible.includes(a)) fail(`${SITE}/${f}`, `FAQPage answer not visible on the page -> "${a.slice(0, 70)}..."`);
  }
}

// Page structure - the checks a manual audit would redo by hand every time.
const site = {};
for (const f of html) site[f] = fs.readFileSync(`${SITE}/${f}`, 'utf8');
const titles = new Map(), descs = new Map();
for (const f of html) {
  const c = site[f];
  const canon = c.match(/<link rel="canonical" href="https:\/\/foodhubbie\.in\/(.*?)"/);
  if (!canon) continue; // 404 + GSC verification token are not indexable pages
  const t = (c.match(/<title>(.*?)<\/title>/s) || [])[1] || '';
  const d = (c.match(/<meta name="description" content="(.*?)"/s) || [])[1] || '';
  if ([...c.matchAll(/<h1[^>]*>/g)].length !== 1) fail(`${SITE}/${f}`, 'must have exactly one <h1>');
  if (t.length < 25 || t.length > 60) fail(`${SITE}/${f}`, `title is ${t.length} chars (want 25-60)`);
  if (d.length < 70 || d.length > 160) fail(`${SITE}/${f}`, `meta description is ${d.length} chars (want 70-160)`);
  for (const [map, val, what] of [[titles, t, 'title'], [descs, d, 'description']]) {
    if (!val) { fail(`${SITE}/${f}`, `missing ${what}`); continue; }
    if (map.has(val)) fail(`${SITE}/${f}`, `duplicate ${what} (also on ${map.get(val)})`);
    else map.set(val, f);
  }
  if (!/<meta property="og:title"/.test(c)) fail(`${SITE}/${f}`, 'missing og:title');
  if (!/<meta property="og:image"/.test(c)) fail(`${SITE}/${f}`, 'missing og:image');
  for (const img of [...c.matchAll(/<img\b[^>]*>/g)].map(m => m[0])) {
    if (!/\balt=/.test(img)) fail(`${SITE}/${f}`, `image without alt -> ${img.slice(0, 90)}`);
  }
}
// No orphan pages: every indexable page must be linked from at least one other page.
for (const f of html) {
  const slug = f.replace('.html', '');
  if (slug === 'index' || slug === '404' || slug.startsWith('google')) continue;
  const linked = html.some(o => o !== f && new RegExp(`href="[^"]*/?${slug}(?:\\.html)?["#]`).test(site[o]));
  if (!linked) fail(`${SITE}/${f}`, 'orphan page - not linked from any other page');
}

console.log(bad ? `FAILED: ${bad} problem(s)` : `OK: ${PUBLIC.length} files + ${locs.length} sitemap urls consistent`);
process.exit(bad ? 1 : 0);
