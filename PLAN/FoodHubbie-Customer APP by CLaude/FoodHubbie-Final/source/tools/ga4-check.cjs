// Verify GA4 beacon fires on the live site.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launch({ headless: true });
  const page = await ctx.newPage();
  const hits = [];
  page.on('request', (r) => { if (/google-analytics|gtag|firebaseio.*config|app-check/.test(r.url())) hits.push(r.url().slice(0, 120)); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  await page.goto('https://foodhubbie-web.web.app/', { waitUntil: 'networkidle', timeout: 45000 });
  await sleep(5000);
  console.log('HITS: ' + JSON.stringify(hits, null, 1));
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
