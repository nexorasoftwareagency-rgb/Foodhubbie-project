// One-page Lighthouse run: prints perf score + key metrics.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const name = process.argv[2] || 'home';
const url = process.argv[3] || 'https://foodhubbie-web.web.app/';
const chrome = 'C:/Users/2nile/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const file = path.join(os.tmpdir(), 'opencode', 'lh', name + '.json');
execSync(`npx -y lighthouse@latest ${url} --quiet --chrome-flags="--headless=new" --output=json --output-path="${file}" --only-categories=performance,seo`, { stdio: 'ignore', env: { ...process.env, CHROME_PATH: chrome }, timeout: 300000 });
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
let line = 'perf=' + Math.round(r.categories.performance.score * 100);
for (const k of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']) line += ' ' + k + '=' + (r.audits[k].displayValue || r.audits[k].numericValue);
console.log(line);
