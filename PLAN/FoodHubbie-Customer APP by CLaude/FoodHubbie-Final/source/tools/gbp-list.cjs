// Dump full business list + per-business status from Profile Manager.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  console.log('LIST:\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 2500));
  await page.screenshot({ path: 'website/gbp-list.png', fullPage: true });
  console.log('screenshot: website/gbp-list.png');
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
