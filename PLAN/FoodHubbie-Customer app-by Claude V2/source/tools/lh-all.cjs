// Run Lighthouse on the 5 site pages (mobile default), print scores + CWV metrics.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chrome = process.env.CHROME_PATH || 'C:\\Users\\2nile\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe';
const pages = [
  ['home', 'https://foodhubbie-web.web.app/'],
  ['signup', 'https://foodhubbie-web.web.app/signup.html'],
  ['architecture', 'https://foodhubbie-web.web.app/architecture.html'],
  ['book', 'https://foodhubbie-web.web.app/book.html'],
  ['contact', 'https://foodhubbie-web.web.app/contact.html'],
];
const outDir = path.join(os.tmpdir(), 'opencode', 'lh');
fs.mkdirSync(outDir, { recursive: true });
const sum = [];
for (const [name, url] of pages) {
  const file = path.join(outDir, name + '.json');
  console.log('>> ' + name);
  execSync(
    `npx -y lighthouse@latest ${url} --quiet --chrome-flags="--headless=new" --output=json --output-path="${file}" --only-categories=performance,seo,accessibility,best-practices`,
    { stdio: 'ignore', env: { ...process.env, CHROME_PATH: chrome }, timeout: 300000 }
  );
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = {};
  for (const [k, v] of Object.entries(r.categories)) s[k] = Math.round((v.score || 0) * 100);
  const m = {};
  for (const [k, v] of Object.entries(r.audits)) {
    if (['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'server-response-time'].includes(k)) {
      m[k] = v.displayValue || v.numericValue;
    }
  }
  console.log('   scores: ' + JSON.stringify(s));
  console.log('   metrics: ' + JSON.stringify(m));
  sum.push({ name, ...s, ...m });
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(sum, null, 2));
console.log('summary at ' + path.join(outDir, 'summary.json'));
